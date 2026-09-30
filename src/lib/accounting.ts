import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { PoolClient } from './db';
import { transact, DomainError, OWNER } from './db';
import { commandSchema, type Command } from './validation';

type Result = {id?:string};
async function project(c:PoolClient,owner:string,id:string,version?:number) {
 const {rows:[p]}=await c.query('SELECT * FROM projects WHERE owner_id=$1 AND id=$2',[owner,id]);
 if(!p) throw new DomainError('Проект не найден',404);
 if(version!==undefined && p.version!==version) throw new DomainError('Проект изменился. Обновите страницу и повторите действие.',409);
 return p;
}
async function bump(c:PoolClient,owner:string,id:string) {await c.query('UPDATE projects SET version=version+1 WHERE owner_id=$1 AND id=$2',[owner,id]);}
async function today(c:PoolClient,owner:string) {
 const {rows:[profile]}=await c.query('SELECT timezone FROM profiles WHERE id=$1',[owner]);
 return new Intl.DateTimeFormat('en-CA',{timeZone:profile.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
async function setConsumption(c:PoolClient,owner:string,cmd:Extract<Command,{type:'consumption.set'}>) {
 const p=await project(c,owner,cmd.id,cmd.version);
 if(p.archived || p.status==='cancelled') throw new DomainError('Сначала верните проект в работу.');
 if(!(await c.query('SELECT 1 FROM yarns WHERE owner_id=$1 AND id=$2',[owner,cmd.yarn_id])).rowCount) throw new DomainError('Пряжа не найдена');
 if(p.historical) {
  await c.query('INSERT INTO historical_usage(owner_id,project_id,yarn_id,grams) VALUES($1,$2,$3,mg($4)) ON CONFLICT(owner_id,project_id,yarn_id) DO UPDATE SET grams=EXCLUDED.grams',[owner,cmd.id,cmd.yarn_id,cmd.grams]);
 } else {
  const {rows}=await c.query(`SELECT r.*,COALESCE(SUM(m.grams),0) balance,
   COALESCE(-SUM(m.grams) FILTER(WHERE m.project_id=$3),0) used
   FROM receipts r LEFT JOIN movements m ON m.receipt_id=r.id AND m.owner_id=r.owner_id
   WHERE r.owner_id=$1 AND r.yarn_id=$2 GROUP BY r.id ORDER BY r.purchased_on,r.created_at,r.rowid`,[owner,cmd.yarn_id,cmd.id]);
  const current=rows.reduce<Decimal>((n,r)=>n.plus(r.used),new Decimal(0));
  let delta=new Decimal(cmd.grams).minus(current);
  if(delta.gt(0)) {
   const available=rows.reduce<Decimal>((n,r)=>n.plus(r.balance),new Decimal(0));
   if(available.lt(delta)) throw new DomainError(`Не хватает ${delta.minus(available).toString()} г пряжи. Добавьте поступление или уменьшите расход.`,409);
   for(const r of rows) {
    const use=Decimal.min(delta,r.balance);
    if(use.gt(0)) await c.query("INSERT INTO movements(owner_id,receipt_id,project_id,grams,kind) VALUES($1,$2,$3,mg($4),'consumption')",[owner,r.id,cmd.id,use.neg().toString()]);
    delta=delta.minus(use); if(delta.eq(0)) break;
   }
  } else if(delta.lt(0)) {
   let remaining=delta.neg();
   for(const r of [...rows].reverse()) {
    const back=Decimal.min(remaining,r.used);
    if(back.gt(0)) await c.query("INSERT INTO movements(owner_id,receipt_id,project_id,grams,kind,reason) VALUES($1,$2,$3,mg($4),'return','Исправление расхода / возврат')",[owner,r.id,cmd.id,back.toString()]);
    remaining=remaining.minus(back); if(remaining.eq(0)) break;
   }
  }
 }
 await bump(c,owner,cmd.id);
 return {id:cmd.id};
}
export async function execute(command:Command,key:string,owner=OWNER):Promise<Result> {
 const cmd=commandSchema.parse(command);
 const hash=createHash('sha256').update(JSON.stringify(cmd)).digest('hex');
 return transact(owner,async c=>{
  const old=await c.query('SELECT * FROM operations WHERE owner_id=$1 AND key=$2',[owner,key]);
  if(old.rowCount) {
   if(old.rows[0].payload_hash!==hash) throw new DomainError('Этот запрос уже выполнен с другими данными.',409);
   return old.rows[0].result;
  }
  const result=await run(c,owner,cmd);
  await c.query('INSERT INTO operations(owner_id,key,payload_hash,result) VALUES($1,$2,$3,$4)',[owner,key,hash,JSON.stringify(result)]);
  await c.query('INSERT INTO events(owner_id,command,payload) VALUES($1,$2,$3)',[owner,cmd.type,JSON.stringify(cmd)]);
  return result;
 });
}
async function run(c:PoolClient,owner:string,cmd:Command):Promise<Result> {
 switch(cmd.type) {
 case 'project.create': {
  if(cmd.start_date && cmd.end_date && cmd.start_date>cmd.end_date) throw new DomainError('Завершение не может быть раньше начала.');
  const {rows:[p]}=await c.query(`INSERT INTO projects(owner_id,template_id,title,category,notes,quantity,purpose,rate,price,other_cost,historical,status,start_date,end_date)
   VALUES($1,$2,$3,$4,$5,$6,$7,cents($8),cents($9),cents($10),$11,$12,$13,$14) RETURNING id`,
   [owner,cmd.template_id??null,cmd.title,cmd.category,cmd.notes,cmd.quantity,cmd.purpose,cmd.rate,cmd.price,cmd.other_cost,cmd.historical,cmd.historical?'completed':'planned',cmd.start_date,cmd.historical?cmd.end_date:null]);
  return p;
 }
 case 'project.edit': {
  const p=await project(c,owner,cmd.id,cmd.version);
  if(cmd.start_date && cmd.end_date && cmd.start_date>cmd.end_date) throw new DomainError('Завершение не может быть раньше начала.');
  await c.query(`UPDATE projects SET title=$3,category=$4,notes=$5,quantity=$6,purpose=$7,rate=cents($8),price=cents($9),other_cost=cents($10),start_date=$11,end_date=$12,end_month=CASE WHEN $12 IS NOT NULL THEN NULL ELSE end_month END,version=version+1 WHERE owner_id=$1 AND id=$2`,[owner,cmd.id,cmd.title,cmd.category,cmd.notes,cmd.quantity,cmd.purpose,cmd.rate,cmd.price,cmd.other_cost,cmd.start_date,p.status==='completed'?cmd.end_date:null]);
  return {id:cmd.id};
 }
 case 'project.status': {
  const p=await project(c,owner,cmd.id,cmd.version);
  if(p.archived) throw new DomainError('Сначала извлеките проект из архива.');
  if(['paused','completed','cancelled','planned'].includes(cmd.status)) await c.query('UPDATE sessions SET ended_at=now() WHERE owner_id=$1 AND project_id=$2 AND started_at IS NOT NULL AND ended_at IS NULL',[owner,cmd.id]);
  const day=await today(c,owner);
  if(cmd.status==='completed' && p.start_date && String(p.start_date)>day) throw new DomainError('Дата начала находится в будущем. Сначала исправьте дату.');
  await c.query(`UPDATE projects SET status=$3,start_date=CASE WHEN $3='active' THEN COALESCE(start_date,$4) ELSE start_date END,end_date=CASE WHEN $3='completed' THEN COALESCE(end_date,$4) ELSE NULL END,end_month=NULL,version=version+1 WHERE owner_id=$1 AND id=$2`,[owner,cmd.id,cmd.status,day]);
  return {id:cmd.id};
 }
 case 'project.archive':
  await project(c,owner,cmd.id,cmd.version);
  await c.query('UPDATE sessions SET ended_at=now() WHERE owner_id=$1 AND project_id=$2 AND started_at IS NOT NULL AND ended_at IS NULL',[owner,cmd.id]);
  await c.query('UPDATE projects SET archived=$3,version=version+1 WHERE owner_id=$1 AND id=$2',[owner,cmd.id,cmd.archived]);
  return {id:cmd.id};
 case 'project.repeat': {
  const p=await project(c,owner,cmd.id);
  const {rows:[copy]}=await c.query('INSERT INTO projects(owner_id,template_id,title,category,notes,quantity,purpose,rate,price) VALUES($1,$2,$3,$4,$5,$6,$7,cents($8),cents($9)) RETURNING id',[owner,p.template_id,`${p.title} — повтор`,p.category,p.notes,p.quantity,p.purpose,p.rate,p.price]);
  return copy;
 }
 case 'template.save': {
  const p=await project(c,owner,cmd.id);
  return (await c.query('INSERT INTO templates(owner_id,title,category,notes,rate,price) VALUES($1,$2,$3,$4,cents($5),cents($6)) RETURNING id',[owner,p.title,p.category,p.notes,p.rate,p.price])).rows[0];
 }
 case 'yarn.create':
  return (await c.query('INSERT INTO yarns(owner_id,manufacturer,name,color,color_hex,composition,skein_weight,skein_length) VALUES($1,$2,$3,$4,$5,$6,mg($7),mg($8)) RETURNING id',[owner,cmd.manufacturer,cmd.name,cmd.color,cmd.color_hex,cmd.composition,cmd.skein_weight,cmd.skein_length])).rows[0];
 case 'yarn.receive': {
  const {rows:[y]}=await c.query('SELECT * FROM yarns WHERE owner_id=$1 AND id=$2',[owner,cmd.id]);
  if(!y) throw new DomainError('Пряжа не найдена',404);
  const {rows:[r]}=await c.query('INSERT INTO receipts(owner_id,yarn_id,grams,cost,skein_weight,skein_length,dye_lot,purchased_on,note) VALUES($1,$2,mg($3),cents($4),mg($5),mg($6),$7,$8,$9) RETURNING id',[owner,y.id,cmd.grams,cmd.cost,y.skein_weight,y.skein_length,cmd.dye_lot,cmd.purchased_on,cmd.note]);
  await c.query("INSERT INTO movements(owner_id,receipt_id,grams,kind,reason) VALUES($1,$2,mg($3),'receipt',$4)",[owner,r.id,cmd.grams,cmd.note]);
  return {id:y.id};
 }
 case 'yarn.adjust': {
  const {rows:[r]}=await c.query('SELECT r.id,COALESCE(SUM(m.grams),0) balance FROM receipts r LEFT JOIN movements m ON m.receipt_id=r.id AND m.owner_id=r.owner_id WHERE r.owner_id=$1 AND r.id=$2 GROUP BY r.id',[owner,cmd.receipt_id]);
  if(!r) throw new DomainError('Поступление не найдено',404);
  const delta=new Decimal(cmd.target).minus(r.balance);
  if(!delta.eq(0)) await c.query("INSERT INTO movements(owner_id,receipt_id,grams,kind,reason) VALUES($1,$2,mg($3),'adjustment',$4)",[owner,r.id,delta.toString(),cmd.reason]);
  return {};
 }
 case 'consumption.set': return setConsumption(c,owner,cmd);
 case 'timer.start': {
  const p=await project(c,owner,cmd.id);
  if(p.archived || ['completed','cancelled'].includes(p.status)) throw new DomainError('Сначала верните проект в работу.');
  const active=await c.query('SELECT * FROM sessions WHERE owner_id=$1 AND started_at IS NOT NULL AND ended_at IS NULL',[owner]);
  if(active.rowCount) {
   if(active.rows[0].project_id===cmd.id) return {id:active.rows[0].id};
   throw new DomainError('Уже идет таймер другого проекта. Сначала поставьте его на паузу.',409);
  }
  const day=await today(c,owner);
  await c.query("UPDATE projects SET status='active',start_date=COALESCE(start_date,$3),version=version+1 WHERE owner_id=$1 AND id=$2",[owner,cmd.id,day]);
  return (await c.query('INSERT INTO sessions(owner_id,project_id,started_at) VALUES($1,$2,now()) RETURNING id',[owner,cmd.id])).rows[0];
 }
 case 'timer.stop': {
  const {rows:[s]}=await c.query('SELECT * FROM sessions WHERE owner_id=$1 AND id=$2',[owner,cmd.session_id]);
  if(!s) throw new DomainError('Сеанс не найден',404);
  if(s.started_at && !s.ended_at) {await c.query('UPDATE sessions SET ended_at=now() WHERE owner_id=$1 AND id=$2',[owner,cmd.session_id]);await bump(c,owner,s.project_id);}
  return {id:s.project_id};
 }
 case 'time.add':
  await project(c,owner,cmd.id);
  await c.query('INSERT INTO sessions(owner_id,project_id,manual_seconds,note) VALUES($1,$2,$3,$4)',[owner,cmd.id,cmd.seconds,cmd.note]);
  await bump(c,owner,cmd.id); return {id:cmd.id};
 case 'time.edit': {
  const {rows:[s]}=await c.query('SELECT * FROM sessions WHERE owner_id=$1 AND id=$2',[owner,cmd.session_id]);
  if(!s) throw new DomainError('Сеанс не найден',404);
  if(s.started_at && !s.ended_at) throw new DomainError('Сначала остановите таймер.');
  await c.query('INSERT INTO events(owner_id,command,payload) VALUES($1,$2,$3)',[owner,'time.previous',JSON.stringify({session:s,reason:cmd.reason})]);
  await c.query('UPDATE sessions SET started_at=NULL,ended_at=NULL,manual_seconds=$3,note=$4 WHERE owner_id=$1 AND id=$2',[owner,cmd.session_id,cmd.seconds,cmd.reason]);
  await bump(c,owner,s.project_id); return {id:s.project_id};
 }
 case 'settings.save':await c.query('UPDATE profiles SET hourly_rate=cents($2) WHERE id=$1',[owner,cmd.rate]);return {};
 }
}
