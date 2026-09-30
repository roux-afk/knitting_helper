import {mkdir,readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {OWNER,pool,openDatabase,DomainError,type PoolClient} from './db';
import {dataDirectory,photosDirectory} from './storage';
import {encodeColumn} from './units';

export const archiveTables=['profiles','templates','projects','yarns','receipts','movements','historical_usage','sessions','photos','operations','events','import_batches','import_items'] as const;
const photoName=/^[a-f0-9-]{36}\.jpg$/i;
type Archive={format:'knitting-tracker';version:1;exported_at:string;tables:Record<string,Record<string,any>[]>;files:Record<string,string>};
export async function archiveSnapshot(c:PoolClient):Promise<Archive>{
 const tables:Archive['tables']={},files:Archive['files']={};
 for(const table of archiveTables)tables[table]=(await c.query(`SELECT * FROM ${table} WHERE ${table==='profiles'?'id':'owner_id'}=$1 ORDER BY rowid`,[OWNER])).rows;
 for(const photo of tables.photos){if(!photoName.test(photo.filename))throw new DomainError('Некорректное имя фотографии.');files[photo.filename]=(await readFile(resolve(photosDirectory,photo.filename))).toString('base64');}
 return {format:'knitting-tracker',version:1,exported_at:new Date().toISOString(),tables,files};
}
export async function exportArchive(){const c=await pool.connect();try{await c.query('BEGIN');const result=await archiveSnapshot(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}

// Validate against a fresh application schema, never execute SQL from an archive.
export async function validateArchive(input:unknown):Promise<Archive>{
 const archive=input as Archive;
 if(!archive||archive.format!=='knitting-tracker'||archive.version!==1||!archive.tables||!archive.files||typeof archive.files!=='object'||Array.isArray(archive.files))throw new DomainError('Это не поддерживаемый архив мастерской.');
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
  for(const photo of archive.tables.photos){
   if(!photoName.test(photo.filename)||typeof archive.files[photo.filename]!=='string')throw new DomainError('В архиве отсутствует фотография.');
   const bytes=Buffer.from(archive.files[photo.filename],'base64');
   if(bytes.length>10*1024*1024||bytes.length<3||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new DomainError('Фотография в архиве повреждена.');
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
  const photos=archive.tables.photos.map(p=>({...p}));
  for(const photo of photos){const old=photo.filename;photo.filename=`${randomUUID()}.jpg`;const path=resolve(photosDirectory,photo.filename);await writeFile(path,Buffer.from(archive.files[old],'base64'),{mode:0o600,flag:'wx'});staged.push(path);}
  await c.query('DROP TRIGGER immutable_movements_update');await c.query('DROP TRIGGER immutable_movements_delete');
  for(const table of [...archiveTables].reverse())await c.query(`DELETE FROM ${table}`);
  for(const table of archiveTables)for(const row of table==='photos'?photos:archive.tables[table]){
   const data={...row};if(table==='sessions'&&data.started_at&&!data.ended_at)data.ended_at=archive.exported_at;
   const keys=Object.keys(data);await c.query(`INSERT INTO ${table}(${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>encodeColumn(k,data[k])));
  }
  await c.query("CREATE TRIGGER immutable_movements_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END");
  await c.query("CREATE TRIGGER immutable_movements_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END");
  await c.query('COMMIT');committed=true;
  return {projects:archive.tables.projects.length,yarns:archive.tables.yarns.length,photos:photos.length};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();if(!committed)for(const file of staged)await rm(file,{force:true});}
}
