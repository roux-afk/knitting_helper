import {DatabaseSync,backup} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {databasePath,dataDirectory} from './storage';
import {decodeRow,integerUnits} from './units';
export const OWNER='00000000-0000-4000-8000-000000000001';
export class DomainError extends Error {constructor(message:string,public status=400){super(message);}}
export type QueryResult={rows:Record<string,any>[];rowCount:number};
export type PoolClient={query:(sql:string,params?:unknown[])=>Promise<QueryResult>;release:()=>void};

export function openDatabase(path=databasePath){
 const db=new DatabaseSync(path);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 db.function('gen_random_uuid',()=>randomUUID());
 db.function('now',()=>new Date().toISOString());
 db.function('mg',v=>integerUnits(v,1000));db.function('cents',v=>integerUnits(v,100));
 return db;
}
function createPool(){
 let db:DatabaseSync|undefined;let tail=Promise.resolve();
 function database(){
  if(db)return db;
  mkdirSync(dataDirectory,{recursive:true,mode:0o700});
  const existed=existsSync(databasePath);db=openDatabase();
  try{
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT (now()))');
  const dir=resolve(/* turbopackIgnore: true */ process.env.KNITTING_SCHEMA_DIR||'db/sqlite');
  const known=readdirSync(/* turbopackIgnore: true */ dir).filter(f=>f.endsWith('.sql')).sort();
  if(db.prepare('SELECT name FROM schema_migrations').all().some(row=>!known.includes(String(row.name))))throw new DomainError('База создана более новой версией Петельки. Установите последнюю версию приложения.');
  const pending=known.filter(name=>!db!.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(name));
  // A consistent SQLite snapshot precedes every schema upgrade.
  if(existed&&pending.length){
   const folder=resolve(dataDirectory,'backups');mkdirSync(folder,{recursive:true});
   db.prepare('VACUUM INTO ?').run(resolve(folder,`before-upgrade-${Date.now()}.sqlite`));
  }
  for(const name of pending){db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(/* turbopackIgnore: true */ resolve(dir,name),'utf8'));db.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run(name);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  return db;
  }catch(e){db.close();db=undefined;throw e;}
 }
 async function connect():Promise<PoolClient>{
  let unlock!:()=>void;const previous=tail;tail=new Promise<void>(r=>{unlock=r;});await previous;
  let active=true;
  return {async query(sql,params=[]){
   if(!active)throw Error('Released database connection');
   const bound:any[]=[];const statement=sql.replace(/\$(\d+)/g,(_,n)=>{const v=params[Number(n)-1];bound.push(typeof v==='boolean'?Number(v):v??null);return '?';});
   const s=database().prepare(statement);
   if(s.columns().length){const rows=s.all(...bound).map(decodeRow);return {rows,rowCount:rows.length};}
   const result=s.run(...bound);return {rows:[],rowCount:Number(result.changes)};
  },release(){if(active){active=false;unlock();}}};
 }
 return {connect,async query(sql:string,params:unknown[]=[]){const c=await connect();try{return await c.query(sql,params);}finally{c.release();}},async end(){const c=await connect();try{db?.close();db=undefined;}finally{c.release();}},async backup(path:string){const c=await connect();try{await backup(database(),path);}finally{c.release();}}};
}
const globals=globalThis as unknown as {knittingSqlite?:ReturnType<typeof createPool>};
export const pool=globals.knittingSqlite??createPool();globals.knittingSqlite=pool;
export async function transact<T>(_owner:string,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
 const c=await pool.connect();
 try{await c.query('BEGIN IMMEDIATE');const result=await fn(c);await c.query('COMMIT');return result;}
 catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
