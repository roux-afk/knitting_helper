import pg from 'pg';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {archiveTables,restoreArchive} from '../src/lib/archive';
import {pool,OWNER} from '../src/lib/db';
import {dataDirectory} from '../src/lib/storage';
pg.types.setTypeParser(1082,v=>v);
async function main(){
 const source=new pg.Client(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:`/tmp/knitting-tracker-${process.getuid?.()??'local'}`,user:'knitting',database:'knitting'});
 try{
  const count=await pool.query('SELECT count(*) count FROM projects');
  const other=await pool.query('SELECT (SELECT count(*) FROM yarns)+(SELECT count(*) FROM import_batches)+(SELECT count(*) FROM templates) count');
  if(count.rows[0].count||other.rows[0].count)throw Error('Целевая SQLite-мастерская не пустая. Перенос отменен.');
  await source.connect();await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables:Record<string,any[]>={},files:Record<string,string>={};
  for(const table of archiveTables)tables[table]=(await source.query(`SELECT * FROM ${table} WHERE ${table==='profiles'?'id':'owner_id'}=$1`,[OWNER])).rows;
  // Preserve receipt FIFO order, including PostgreSQL timestamp precision.
  tables.receipts=(await source.query('SELECT r.*,r.created_at::text AS created_at FROM receipts r WHERE owner_id=$1 ORDER BY r.purchased_on,r.created_at,r.id',[OWNER])).rows;
  for(const photo of tables.photos){if(!/^[a-f0-9-]{36}\.jpg$/i.test(photo.filename))throw Error('Некорректное имя фото');files[photo.filename]=(await readFile(resolve('data/photos',photo.filename))).toString('base64');}
  await source.query('COMMIT');
  const archive=JSON.parse(JSON.stringify({format:'knitting-tracker',version:1,exported_at:new Date().toISOString(),tables,files}));
  await mkdir(resolve(dataDirectory,'backups'),{recursive:true});
  await writeFile(resolve(dataDirectory,'backups',`postgres-original-${Date.now()}.json`),JSON.stringify(archive),{mode:0o600,flag:'wx'});
  const result=await restoreArchive(archive);console.log(JSON.stringify({migrated:result,previews:tables.import_batches.length,sourceUnchanged:true}));
 }finally{await source.end().catch(()=>{});await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
