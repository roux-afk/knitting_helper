import {mkdir,readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {OWNER,pool,openDatabase,DomainError,type PoolClient} from './db';
import {dataDirectory,photosDirectory} from './storage';
import {encodeColumn} from './units';

export const archiveTables=['profiles','templates','projects','yarns','receipts','movements','historical_usage','sessions','attachments','operations','events','import_batches','import_items'] as const;
const fileName=/^[a-f0-9-]{36}\.(jpg|pdf)$/i;
const limits:Record<string,number>={'image/jpeg':10*1024*1024,'application/pdf':25*1024*1024};
const signatures:Record<string,number[]>={'image/jpeg':[255,216,255],'application/pdf':[37,80,68,70]};
type Archive={format:'knitting-tracker';version:1|2;exported_at:string;tables:Record<string,Record<string,any>[]>;files:Record<string,string>};
export async function archiveSnapshot(c:PoolClient):Promise<Archive>{
 const tables:Archive['tables']={},files:Archive['files']={};
 for(const table of archiveTables)tables[table]=(await c.query(`SELECT * FROM ${table} WHERE ${table==='profiles'?'id':'owner_id'}=$1 ORDER BY rowid`,[OWNER])).rows;
 for(const file of tables.attachments){if(!fileName.test(file.filename))throw new DomainError('Некорректное имя файла.');files[file.filename]=(await readFile(resolve(photosDirectory,file.filename))).toString('base64');}
 return {format:'knitting-tracker',version:2,exported_at:new Date().toISOString(),tables,files};
}
export async function exportArchive(){const c=await pool.connect();try{await c.query('BEGIN');const result=await archiveSnapshot(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}

// Version 1 stored project photos in `photos`; they become photo attachments, the oldest one is the cover.
function upgradeArchive(archive:Archive):Archive{
 if(archive.version!==1)return archive;
 const photos=Array.isArray((archive.tables as any).photos)?(archive.tables as any).photos as Record<string,any>[]:[];
 const position=new Map<string,number>();
 const attachments=photos.map(p=>{
  if(!p||typeof p!=='object'||typeof p.project_id!=='string')throw new DomainError('Фотографии в архиве повреждены.');
  const n=position.get(p.project_id)??0;position.set(p.project_id,n+1);
  return {id:p.id,owner_id:p.owner_id,project_id:p.project_id,kind:'photo',media_type:'image/jpeg',filename:p.filename,created_at:p.created_at,sort_order:n,is_cover:n===0};
 });
 const {photos:_removed,...tables}=archive.tables as Record<string,any>;
 return {...archive,version:2,tables:{...tables,attachments}};
}
// Validate against a fresh application schema, never execute SQL from an archive.
export async function validateArchive(input:unknown):Promise<Archive>{
 let archive=input as Archive;
 if(!archive||archive.format!=='knitting-tracker'||![1,2].includes(archive.version)||!archive.tables||!archive.files||typeof archive.files!=='object'||Array.isArray(archive.files))throw new DomainError('Это не поддерживаемый архив мастерской.');
 archive=upgradeArchive(archive);
 if(archive.tables.profiles?.length!==1||archive.tables.profiles[0].id!==OWNER)throw new DomainError('В архиве должен быть один профиль мастерской.');
 const dir=await mkdtemp(join(tmpdir(),'knitting-validate-'));const db=openDatabase(join(dir,'validate.sqlite'));
 try{
  const schema=resolve(/* turbopackIgnore: true */ process.env.KNITTING_SCHEMA_DIR||'db/sqlite');
  for(const file of (await readdir(/* turbopackIgnore: true */ schema)).filter(f=>f.endsWith('.sql')).sort())db.exec(await readFile(/* turbopackIgnore: true */ resolve(schema,file),'utf8'));
  db.exec('DELETE FROM profiles');
  for(const table of archiveTables){
   const rows=archive.tables[table];if(!Array.isArray(rows)||rows.length>500000)throw new DomainError(`Неверные данные раздела ${table}.`);
   const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name));
   for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!columns.has(k)))throw new DomainError(`Неизвестные поля раздела ${table}.`);
    if(table!=='profiles'&&row.owner_id!==OWNER)throw new DomainError('Архив содержит записи другого профиля.');
    const keys=Object.keys(row);db.prepare(`INSERT INTO ${table}(${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>encodeColumn(k,row[k])) as any[]);
   }
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new DomainError('Связи записей архива повреждены.');
  if(db.prepare('SELECT receipt_id FROM movements GROUP BY receipt_id HAVING SUM(grams)<0 LIMIT 1').get())throw new DomainError('Архив содержит отрицательные остатки.');
  // A snapshot may legitimately contain a running timer; pause it at export time.
  const snapshotTime=Date.parse(archive.exported_at);
  if(!Number.isFinite(snapshotTime))throw new DomainError('Дата архива повреждена.');
  for(const s of archive.tables.sessions)if(s.started_at&&!s.ended_at){if(Date.parse(s.started_at)>snapshotTime)throw new DomainError('В архиве неверное время таймера.');}
  for(const file of archive.tables.attachments){
   if(!fileName.test(file.filename)||typeof archive.files[file.filename]!=='string')throw new DomainError('В архиве отсутствует фотография или файл.');
   const bytes=Buffer.from(archive.files[file.filename],'base64'),signature=signatures[file.media_type];
   const extension=file.filename.slice(-3).toLowerCase(),expected=file.media_type==='application/pdf'?'pdf':'jpg';
   if(!signature||extension!==expected||bytes.length>limits[file.media_type]||bytes.length<signature.length||signature.some((b,i)=>bytes[i]!==b))throw new DomainError('Фотография или файл в архиве повреждены.');
  }
  return archive;
 }catch(e){if(e instanceof DomainError)throw e;throw new DomainError('Архив поврежден или содержит недопустимые значения. Данные не изменены.');}
 finally{db.close();await rm(dir,{recursive:true,force:true});}
}
export async function restoreArchive(input:unknown){
 const archive=await validateArchive(input);const c=await pool.connect();const staged:string[]=[];let committed=false;
 try{
  await c.query('BEGIN IMMEDIATE');
  const previous=await archiveSnapshot(c);const backupDir=resolve(dataDirectory,'backups');await mkdir(backupDir,{recursive:true});
  await writeFile(resolve(backupDir,`before-restore-${Date.now()}.json`),JSON.stringify(previous),{mode:0o600,flag:'wx'});
  await mkdir(photosDirectory,{recursive:true});
  const photos=archive.tables.attachments.map(p=>({...p}));
  for(const photo of photos){const old=photo.filename;photo.filename=`${randomUUID()}.${old.slice(-3).toLowerCase()}`;const path=resolve(photosDirectory,photo.filename);await writeFile(path,Buffer.from(archive.files[old],'base64'),{mode:0o600,flag:'wx'});staged.push(path);}
  await c.query('DROP TRIGGER immutable_movements_update');await c.query('DROP TRIGGER immutable_movements_delete');
  for(const table of [...archiveTables].reverse())await c.query(`DELETE FROM ${table}`);
  for(const table of archiveTables)for(const row of table==='attachments'?photos:archive.tables[table]){
   const data={...row};if(table==='sessions'&&data.started_at&&!data.ended_at)data.ended_at=archive.exported_at;
   const keys=Object.keys(data);await c.query(`INSERT INTO ${table}(${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>encodeColumn(k,data[k])));
  }
  await c.query("CREATE TRIGGER immutable_movements_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END");
  await c.query("CREATE TRIGGER immutable_movements_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END");
  await c.query('COMMIT');committed=true;
  return {projects:archive.tables.projects.length,yarns:archive.tables.yarns.length,photos:photos.length};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();if(!committed)for(const file of staged)await rm(file,{force:true});}
}
