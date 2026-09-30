import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {prepareImport} from '../src/lib/import-service';
import {pool} from '../src/lib/db';

async function main(){
 const path=process.argv[2];
 if(!path)throw new Error('Usage: node --import tsx scripts/prepare-import.ts <workbook.xlsx>');
 try{
  const batch=await prepareImport(await readFile(path),basename(path));
  console.log(JSON.stringify({id:batch.id,status:batch.status,totals:batch.preview.totals}));
 }finally{await pool.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
