import {OWNER,pool,transact,DomainError} from './db';
import {parseWorkbook} from './excel-parser';
import type {ImportPreview,ImportRow,ImportResult,ImportBatch} from './import-types';

export async function prepareImport(buffer:Buffer,name:string,owner=OWNER):Promise<ImportBatch>{
 const preview=await parseWorkbook(buffer,name);
 return transact(owner,async c=>{
  const old=await c.query('SELECT * FROM import_batches WHERE owner_id=$1 AND source_hash=$2',[owner,preview.hash]);
  if(old.rowCount)return old.rows[0] as ImportBatch;
  return (await c.query('INSERT INTO import_batches(owner_id,source_name,source_hash,preview) VALUES($1,$2,$3,$4) RETURNING *',[owner,name,preview.hash,JSON.stringify(preview)])).rows[0] as ImportBatch;
 });
}
export async function listImports(owner=OWNER){
 return (await pool.query('SELECT id,source_name,status,result,created_at,preview->\'totals\' totals FROM import_batches WHERE owner_id=$1 ORDER BY created_at DESC',[owner])).rows;
}
export async function readImport(id:string,owner=OWNER):Promise<ImportBatch>{
 const {rows:[batch]}=await pool.query('SELECT * FROM import_batches WHERE owner_id=$1 AND id=$2',[owner,id]);
 if(!batch)throw new DomainError('Импорт не найден.',404);return batch as ImportBatch;
}
export async function commitImport(id:string,selected:string[],acknowledge:boolean,owner=OWNER):Promise<ImportResult>{
 return transact(owner,async c=>{
  const {rows:[batch]}=await c.query('SELECT * FROM import_batches WHERE owner_id=$1 AND id=$2',[owner,id]);
  if(!batch)throw new DomainError('Импорт не найден.',404);
  const preview=batch.preview as ImportPreview;const wanted=new Set(selected);
  if(wanted.size!==selected.length||!wanted.size||selected.some(key=>!preview.rows.some(r=>r.key===key)))throw new DomainError('Неверный список строк для переноса.');
  const rows=preview.rows.filter(r=>wanted.has(r.key));
  if(batch.status==='committed'){
   const prior=(await c.query('SELECT row_key FROM import_items WHERE owner_id=$1 AND batch_id=$2',[owner,id])).rows.map(r=>r.row_key);
   if(prior.length!==wanted.size||prior.some(k=>!wanted.has(k)))throw new DomainError('Этот файл уже перенесен с другим набором строк. Повторное добавление отключено.',409);
   return batch.result;
  }
  if(rows.some(r=>r.errors.length))throw new DomainError('Исключите строки с ошибками до переноса.');
  if(rows.some(r=>r.warnings.length)&&!acknowledge)throw new DomainError('Подтвердите сохранение помеченных данных как значений из Excel.');
  // Do not silently duplicate edited or renamed versions of the same workbook.
  const duplicates=await c.query('SELECT row_key FROM import_items WHERE owner_id=$1 AND row_key IN (SELECT value FROM json_each($2)) LIMIT 1',[owner,JSON.stringify(selected)]);
  if(duplicates.rowCount)throw new DomainError('Строки этого листа уже переносились из другой версии файла. Автоматическое обновление пока отключено, чтобы не создать дубликаты.',409);
  const result:ImportResult={templates:0,projects:0,units:0,purchases:0,yarns:0,excluded:preview.rows.filter(r=>!wanted.has(r.key)).map(r=>r.key)};
  const templateIds=new Map<string,string>();
  for(const row of rows.filter(r=>r.kind==='template')){
   const {rows:[item]}=await c.query('INSERT INTO templates(owner_id,title,category,notes,rate,price,source_data) VALUES($1,$2,$3,$4,cents($5),cents($6),$7) RETURNING id',[owner,row.title,'Другое',row.notes,row.rate,row.price,JSON.stringify(row)]);
   templateIds.set(`${row.sheet}:${row.title}`,item.id);await record(row,item.id);result.templates++;
  }
  for(const row of rows.filter(r=>r.kind==='purchase')){
   let item=(await c.query(`SELECT id FROM yarns WHERE owner_id=$1 AND name=$2 AND color=$3 AND skein_weight=mg($4) AND skein_length IS NOT DISTINCT FROM mg($5) AND personal_code IS NOT DISTINCT FROM $6`,[owner,row.yarnName,row.color||'Не указан',row.skeinWeight,row.skeinLength,row.code||null])).rows[0];
   if(!item){item=(await c.query(`INSERT INTO yarns(owner_id,manufacturer,name,color,composition,skein_weight,skein_length,personal_code,needs_inventory) VALUES($1,'Не указан',$2,$3,'Не указан',mg($4),mg($5),$6,true) RETURNING id`,[owner,row.yarnName,row.color||'Не указан',row.skeinWeight,row.skeinLength,row.code||null])).rows[0];result.yarns++;}
   await record(row,item.id);result.purchases++;
  }
  for(const row of rows.filter(r=>r.kind==='project')){
   const purpose=/продаж/i.test(row.source.L)?'sale':/подар/i.test(row.source.L)?'gift':'self';
   const {rows:[item]}=await c.query(`INSERT INTO projects(owner_id,template_id,title,category,notes,quantity,purpose,status,start_date,end_date,end_month,rate,price,historical,source_data,legacy_material_cost)
    VALUES($1,$2,$3,'Другое',$4,$5,$6,'completed',NULL,$7,$8,cents($9),cents($10),true,$11,cents($12)) RETURNING id`,[owner,templateIds.get(`${row.sheet}:${row.title}`)??null,row.title,row.notes,row.quantity,purpose,row.date,row.month,row.rate,row.price,JSON.stringify(row),row.materialCost]);
   if(row.seconds!==null&&row.seconds>0)await c.query('INSERT INTO sessions(owner_id,project_id,manual_seconds,note) VALUES($1,$2,$3,$4)',[owner,item.id,row.seconds,`Перенос Excel: ${row.sheet}, строка ${row.row}. ${row.source.J} ч × ${row.quantity} шт.`]);
   await record(row,item.id);result.projects++;result.units+=row.quantity;
  }
  async function record(row:ImportRow,target:string){await c.query('INSERT INTO import_items(owner_id,batch_id,row_key,kind,target_id,data) VALUES($1,$2,$3,$4,$5,$6)',[owner,id,row.key,row.kind,target,JSON.stringify(row)]);}
  await c.query("UPDATE import_batches SET status='committed',result=$3,committed_at=now() WHERE owner_id=$1 AND id=$2",[owner,id,JSON.stringify(result)]);
  await c.query("INSERT INTO events(owner_id,command,payload) VALUES($1,'import.commit',$2)",[owner,JSON.stringify({id,selected,result})]);
  return result;
 });
}
