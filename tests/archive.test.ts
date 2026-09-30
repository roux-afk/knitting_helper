import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
let dir:string;let db:typeof import('../src/lib/db');let archive:typeof import('../src/lib/archive');let account:typeof import('../src/lib/accounting');
before(async()=>{dir=await mkdtemp(join(tmpdir(),'knitting-archive-test-'));process.env.KNITTING_DATA_DIR=dir;db=await import('../src/lib/db');archive=await import('../src/lib/archive');account=await import('../src/lib/accounting');});
after(async()=>{await db.pool.end();await rm(dir,{recursive:true,force:true});});
test('архив переносит фото, точные суммы и UUID, восстановление сохраняет предыдущую мастерскую',async()=>{
 const {id}=await account.execute({type:'project.create',title:'Архив',category:'Шапка',quantity:1,purpose:'self',rate:125.25,price:1234.56,other_cost:0,notes:'',historical:false,start_date:null,end_date:null},randomUUID());
 const filename=`${randomUUID()}.jpg`;await mkdir(join(dir,'photos'));
 const photo=await sharp({create:{width:4,height:4,channels:3,background:'#888888'}}).jpeg().toBuffer();await writeFile(join(dir,'photos',filename),photo);
 await db.pool.query('INSERT INTO attachments(owner_id,project_id,filename,is_cover) VALUES($1,$2,$3,1)',[db.OWNER,id,filename]);
 await account.execute({type:'timer.start',id:id!},randomUUID());
 const saved=await archive.exportArchive();assert.equal(saved.tables.projects[0].price,'1234.56');
 await account.execute({type:'settings.save',rate:800},randomUUID());
 const result=await archive.restoreArchive(saved);assert.equal(result.photos,1);
 const restored=await archive.exportArchive();assert.equal(restored.tables.projects[0].id,id);assert.equal(restored.tables.profiles[0].hourly_rate,'125');
 assert.equal(restored.tables.sessions[0].ended_at,saved.exported_at);
 assert.equal(saved.version,2);assert.equal(restored.tables.attachments[0].is_cover,true);
 const newName=restored.tables.attachments[0].filename;assert.notEqual(newName,filename);assert.deepEqual(await readFile(join(dir,'photos',newName)),photo);
 const {readdir}=await import('node:fs/promises');assert.ok((await readdir(join(dir,'backups'))).some(n=>n.startsWith('before-restore-')));
 const raw=await db.pool.query('SELECT price AS stored_price FROM projects WHERE id=$1',[id]);assert.equal(raw.rows[0].stored_price,123456);
});
test('поврежденный архив и путь фотографии не меняют текущие данные',async()=>{
 const before=await archive.exportArchive();const bad=structuredClone(before);bad.tables.projects[0].quantity=-1;
 await assert.rejects(archive.restoreArchive(bad),/поврежден/);
 const traversal=structuredClone(before);traversal.tables.attachments[0].filename='../outside.jpg';
 await assert.rejects(archive.restoreArchive(traversal),/фотограф/);
 const after=await archive.exportArchive();assert.deepEqual(after.tables,before.tables);
});
test('новая схема создает снимок, более старая программа отказывается открывать ее',async()=>{
 const {cp,readdir}=await import('node:fs/promises');
 const schema=join(dir,'schema');await cp('db/sqlite',schema,{recursive:true});
 await writeFile(join(schema,'002_test.sql'),'CREATE TABLE upgrade_probe(id INTEGER PRIMARY KEY) STRICT;');
 await db.pool.end();process.env.KNITTING_SCHEMA_DIR=schema;
 await db.pool.query('SELECT 1 FROM upgrade_probe');
 assert.ok((await readdir(join(dir,'backups'))).some(n=>n.startsWith('before-upgrade-')));
 await db.pool.end();delete process.env.KNITTING_SCHEMA_DIR;
 await assert.rejects(db.pool.query('SELECT 1'),/более новой версией/);
 // Even after a failed open, the supported application can open the DB again.
 process.env.KNITTING_SCHEMA_DIR=schema;
 assert.equal((await db.pool.query('SELECT count(*) count FROM projects')).rows[0].count,1);
});

test('архив версии 1 с таблицей photos восстанавливается как вложения, старейшее фото — обложка',async()=>{
 const current=await archive.exportArchive();const {attachments,...tables}=current.tables;
 const [first]=attachments;const second={...first,id:randomUUID(),filename:`${randomUUID()}.jpg`,created_at:'2099-01-01T00:00:00.000Z'};
 const {sort_order:_a,is_cover:_b,kind:_c,media_type:_d,original_name:_e,caption:_f,template_id:_g,yarn_id:_h,...photo}=first as Record<string,unknown>;
 const {sort_order:_i,is_cover:_j,kind:_k,media_type:_l,original_name:_m,caption:_n,template_id:_o,yarn_id:_p,...photo2}=second as Record<string,unknown>;
 const v1={...current,version:1 as const,tables:{...tables,photos:[photo,photo2]},files:{...current.files,[second.filename]:current.files[first.filename]}};
 const result=await archive.restoreArchive(v1);assert.equal(result.photos,2);
 const restored=(await archive.exportArchive()).tables.attachments;
 assert.equal(restored.length,2);assert.deepEqual(restored.map(a=>a.is_cover),[true,false]);assert.deepEqual(restored.map(a=>a.sort_order),[0,1]);
 assert.ok(restored.every(a=>a.kind==='photo'&&a.media_type==='image/jpeg'));
});
test('PDF в архиве проверяется по сигнатуре',async()=>{
 const current=await archive.exportArchive();const bad=structuredClone(current);
 bad.tables.attachments[0].media_type='application/pdf';
 await assert.rejects(archive.restoreArchive(bad),/повреждены/);
});
test('миграция 002 переносит photos во вложения и сохраняет обложку',async()=>{
 const {readFileSync}=await import('node:fs');const {mkdtemp}=await import('node:fs/promises');
 const folder=await mkdtemp(join(tmpdir(),'knitting-migrate-'));const handle=db.openDatabase(join(folder,'m.sqlite'));
 try{
  handle.exec(readFileSync('db/sqlite/001_initial.sql','utf8'));
  const owner='00000000-0000-4000-8000-000000000001',project=randomUUID();
  handle.prepare("INSERT INTO projects(id,owner_id,title,category,purpose,rate) VALUES(?,?,?,?,?,?)").run(project,owner,'P','Шапка','self',100);
  const ids=[randomUUID(),randomUUID()];
  ids.forEach((id,i)=>handle.prepare('INSERT INTO photos(id,owner_id,project_id,filename,created_at) VALUES(?,?,?,?,?)').run(id,owner,project,`${randomUUID()}.jpg`,`2026-01-0${i+1}T00:00:00.000Z`));
  handle.exec(readFileSync('db/sqlite/002_attachments.sql','utf8'));
  const rows=handle.prepare('SELECT id,sort_order,is_cover,kind,media_type FROM attachments ORDER BY sort_order').all();
  assert.deepEqual(rows.map(r=>r.id),ids);assert.deepEqual(rows.map(r=>r.is_cover),[1,0]);assert.ok(rows.every(r=>r.kind==='photo'&&r.media_type==='image/jpeg'));
  assert.throws(()=>handle.prepare('INSERT INTO attachments(owner_id,filename) VALUES(?,?)').run(owner,'x.jpg'),/CHECK/);
  assert.throws(()=>handle.prepare('INSERT INTO attachments(owner_id,project_id,filename,is_cover) VALUES(?,?,?,1)').run(owner,project,'y.jpg'),/UNIQUE/);
  assert.equal(handle.prepare("SELECT count(*) c FROM sqlite_master WHERE name='photos'").get()!.c,0);
 }finally{handle.close();await rm(folder,{recursive:true,force:true});}
});
