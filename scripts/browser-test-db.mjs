// Isolated, disposable database for manual browser QA. Never points at knitting.
import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
const config={host:`/tmp/knitting-tracker-${process.getuid?.()??'local'}`,user:'knitting',database:'postgres'};
const name='knitting_browser_qa';
const c=new pg.Client(config);await c.connect();
try{
 if(process.argv[2]==='create'){
  await c.query(`CREATE DATABASE ${name}`);
  const test=new pg.Client({...config,database:name});await test.connect();
  try{for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())await test.query(await readFile(`db/migrations/${file}`,'utf8'));}finally{await test.end();}
  console.log('Isolated browser QA database ready.');
 }else if(process.argv[2]==='drop'){
  await c.query(`DROP DATABASE ${name}`);console.log('Removed isolated QA database.');
 }else throw new Error('Use create or drop');
}finally{await c.end();}
