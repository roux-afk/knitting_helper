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
 await db.pool.query('INSERT INTO photos(owner_id,project_id,filename) VALUES($1,$2,$3)',[db.OWNER,id,filename]);
 await account.execute({type:'timer.start',id:id!},randomUUID());
 const saved=await archive.exportArchive();assert.equal(saved.tables.projects[0].price,'1234.56');
 await account.execute({type:'settings.save',rate:800},randomUUID());
 const result=await archive.restoreArchive(saved);assert.equal(result.photos,1);
 const restored=await archive.exportArchive();assert.equal(restored.tables.projects[0].id,id);assert.equal(restored.tables.profiles[0].hourly_rate,'125');
 assert.equal(restored.tables.sessions[0].ended_at,saved.exported_at);
 const newName=restored.tables.photos[0].filename;assert.notEqual(newName,filename);assert.deepEqual(await readFile(join(dir,'photos',newName)),photo);
 const {readdir}=await import('node:fs/promises');assert.ok((await readdir(join(dir,'backups'))).some(n=>n.startsWith('before-restore-')));
 const raw=await db.pool.query('SELECT price AS stored_price FROM projects WHERE id=$1',[id]);assert.equal(raw.rows[0].stored_price,123456);
});
test('поврежденный архив и путь фотографии не меняют текущие данные',async()=>{
 const before=await archive.exportArchive();const bad=structuredClone(before);bad.tables.projects[0].quantity=-1;
 await assert.rejects(archive.restoreArchive(bad),/поврежден/);
 const traversal=structuredClone(before);traversal.tables.photos[0].filename='../outside.jpg';
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
