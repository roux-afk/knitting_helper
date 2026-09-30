import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

import ExcelJS from 'exceljs';
import type {Command} from '../src/lib/validation';

let testDirectory:string;
let execute:typeof import('../src/lib/accounting').execute;
let pool:typeof import('../src/lib/db').pool;
let getState:typeof import('../src/lib/state').getState;
let owner:string;
before(async()=>{
 testDirectory=await mkdtemp(join(tmpdir(),'knitting-sqlite-test-'));
 process.env.KNITTING_DATA_DIR=testDirectory;
 ({pool}=await import('../src/lib/db'));
 ({execute}=await import('../src/lib/accounting'));({getState}=await import('../src/lib/state'));
});
after(async()=>{await pool?.end();await rm(testDirectory,{recursive:true,force:true});});
beforeEach(async()=>{owner=randomUUID();await pool.query('INSERT INTO profiles(id) VALUES($1)',[owner]);});
const run=(cmd:Command,key=randomUUID())=>execute(cmd,key,owner);
async function project(historical=false){return (await run({type:'project.create',title:'Тестовая шапка',category:'Шапка',notes:'',quantity:1,purpose:'self',rate:125,price:null,other_cost:0,start_date:null,end_date:null,historical})).id!;}
async function yarn(){return (await run({type:'yarn.create',manufacturer:'Тест',name:'Пряжа',color:'Зеленый',color_hex:'#789988',composition:'100% шерсть',skein_weight:100,skein_length:200})).id!;}
async function receive(id:string,grams=500,cost:number|null=1000){await run({type:'yarn.receive',id,grams,cost,dye_lot:'',purchased_on:'2026-09-29',note:''});}
async function consume(id:string,yarn_id:string,grams:number){const p=(await getState(owner)).projects.find(p=>p.id===id)!;return run({type:'consumption.set',id,yarn_id,grams,version:p.version});}
async function balance(id:string){return Number((await getState(owner)).yarns.find(y=>y.id===id)!.balance);}

test('расход, исправление, возврат и завершение не дублируют движения',async()=>{
 const p=await project(),y=await yarn();await receive(y);await consume(p,y,80);assert.equal(await balance(y),420);
 await consume(p,y,95);assert.equal(await balance(y),405);await consume(p,y,80);assert.equal(await balance(y),420);
 const state=await getState(owner);await run({type:'project.status',id:p,version:state.projects[0].version,status:'completed'});
 assert.equal(await balance(y),420);assert.equal((await getState(owner)).projects[0].status,'completed');
});
test('один ключ возвращает прежний результат и отвергает другое тело',async()=>{
 const y=await yarn(),key=randomUUID();const cmd:Command={type:'yarn.receive',id:y,grams:100,cost:200,dye_lot:'',purchased_on:'2026-09-29',note:''};
 await run(cmd,key);await run(cmd,key);assert.equal(await balance(y),100);
 await assert.rejects(run({...cmd,grams:200},key),/другими данными/);
});
test('конкурирующие списания не допускают отрицательного остатка',async()=>{
 const a=await project(),b=await project(),y=await yarn();await receive(y,100,200);
 const results=await Promise.allSettled([consume(a,y,80),consume(b,y,80)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await balance(y),20);
});
test('недостаточный запас откатывает операцию и не создает запись',async()=>{
 const p=await project(),y=await yarn();await receive(y,20,40);
 await assert.rejects(consume(p,y,50),/Не хватает 30/);assert.equal(await balance(y),20);
 assert.equal((await getState(owner)).usage.length,0);
});
test('FIFO фиксирует стоимость по покупкам и возвращает исходную цену',async()=>{
 const p=await project(),y=await yarn();await receive(y,100,200);await receive(y,100,300);
 await consume(p,y,150);assert.equal(Number((await getState(owner)).projects[0].yarn_cost),350);
 await receive(y,100,1000);assert.equal(Number((await getState(owner)).projects[0].yarn_cost),350);
 await consume(p,y,100);assert.equal(Number((await getState(owner)).projects[0].yarn_cost),200);
});
test('точность до миллиграмма без отрицательных остатков из-за округления',async()=>{
 const p=await project(),y=await yarn();await receive(y,.3,.01);await consume(p,y,.1);assert.equal(await balance(y),.2);
 await consume(p,y,.3);assert.equal(await balance(y),0);
});
test('исторический проект не списывает текущий остаток',async()=>{
 const p=await project(true),y=await yarn();await receive(y,100,200);await consume(p,y,500);
 assert.equal(await balance(y),100);const s=await getState(owner);assert.equal(s.usage[0].historical,true);assert.equal(s.projects[0].cost_incomplete,true);
});
test('повтор изделия сбрасывает время и расход',async()=>{
 const p=await project(),y=await yarn();await receive(y);await consume(p,y,100);await run({type:'time.add',id:p,seconds:7200,note:''});
 const copy=await run({type:'project.repeat',id:p});const s=await getState(owner);const newProject=s.projects.find(p=>p.id===copy.id)!;
 assert.equal(newProject.status,'planned');assert.equal(newProject.seconds,0);assert.equal(s.usage.filter(u=>u.project_id===copy.id).length,0);
});
test('единственный таймер и завершение закрывает сеанс',async()=>{
 const a=await project(),b=await project();const result=await Promise.allSettled([run({type:'timer.start',id:a}),run({type:'timer.start',id:b})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);let s=await getState(owner);const timer=s.sessions.find(s=>!s.ended_at)!;const p=s.projects.find(p=>p.id===timer.project_id)!;
 await run({type:'project.status',id:p.id,version:p.version,status:'completed'});s=await getState(owner);
 assert.ok(s.sessions[0].ended_at);await run({type:'timer.stop',session_id:timer.id});assert.equal((await getState(owner)).sessions.length,1);
});
test('ручное время и исправление сохраняют историю',async()=>{
 const p=await project();await run({type:'time.add',id:p,seconds:7200,note:'Два часа'});let s=await getState(owner);assert.equal(s.projects[0].seconds,7200);
 await run({type:'time.edit',session_id:s.sessions[0].id,seconds:3600,reason:'Исправление'});s=await getState(owner);assert.equal(s.projects[0].seconds,3600);
 assert.equal((await pool.query("SELECT * FROM events WHERE owner_id=$1 AND command='time.previous'",[owner])).rowCount,1);
});
test('устаревшая версия не затирает новый расход',async()=>{
 const p=await project(),y=await yarn();await receive(y);await consume(p,y,20);
 await assert.rejects(run({type:'consumption.set',id:p,yarn_id:y,grams:50,version:1}),/Проект изменился/);assert.equal(await balance(y),480);
});
test('чужие UUID не дают доступа к записям',async()=>{
 const p=await project(),other=randomUUID();await pool.query('INSERT INTO profiles(id) VALUES($1)',[other]);
 await assert.rejects(execute({type:'timer.start',id:p},randomUUID(),other),/Проект не найден/);
 assert.equal((await getState(other)).projects.length,0);
});
test('нулевая цена отличается от неизвестной',async()=>{
 const p=await project(),y=await yarn();await receive(y,100,null);await consume(p,y,50);assert.equal((await getState(owner)).projects[0].cost_incomplete,true);
 await consume(p,y,0);assert.equal((await getState(owner)).projects[0].cost_incomplete,false);
});
test('журнал не допускает перезаписи, корректировка создает движение',async()=>{
 const y=await yarn();await receive(y);const s=await getState(owner);
 await assert.rejects(pool.query('UPDATE movements SET grams=1 WHERE owner_id=$1',[owner]),/append-only/);
 await run({type:'yarn.adjust',receipt_id:s.receipts[0].id,target:300,reason:'Взвешивание'});assert.equal(await balance(y),300);
});
test('архивирование сохраняет расход и останавливает таймер',async()=>{
 const p=await project(),y=await yarn();await receive(y);await consume(p,y,80);await run({type:'timer.start',id:p});const s=await getState(owner);
 await run({type:'project.archive',id:p,version:s.projects[0].version,archived:true});assert.equal(await balance(y),420);assert.ok((await getState(owner)).sessions[0].ended_at);
});

async function importFixture(){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('2026');
 sheet.addRow(['Название изделия','Пряжа']);
 sheet.addRow(['Шапка','Шерсть',80,2,100,200,0,160,250,410,700]);
 sheet.addRow(['Купленная пряжа']);
 sheet.addRow(['Дата покупки','Название пряжи']);
 sheet.addRow([new Date('2026-01-10T00:00:00Z'),'Шерсть','1.1',100,200,'Синий','1*5',1000]);
 sheet.addRow(['Выполненные изделия']);
 sheet.addRow(['Изделие','Кол-во изделий']);
 sheet.addRow([2026]);sheet.mergeCells('A8:L8');
 sheet.addRow(['Шапка',2,'01.26','Шерсть','1.1',80,0,160,410,2,4,'Для себя']);
 return Buffer.from(await book.xlsx.writeBuffer());
}
test('импорт сохраняет месяц, время партии и историю без движения остатков',async()=>{
 const {prepareImport,commitImport}=await import('../src/lib/import-service');
 const data=await importFixture(),batch=await prepareImport(data,'test.xlsx',owner);
 assert.deepEqual(batch.preview.totals,{templates:1,projects:1,units:2,purchases:1});
 const keys=batch.preview.rows.map(r=>r.key);
 const result=await commitImport(batch.id,keys,true,owner);
 assert.equal(result.units,2);
 const state=await getState(owner);
 assert.equal(state.projects[0].end_month,'2026-01');
 assert.equal(state.projects[0].end_date,null);
 assert.equal(state.projects[0].seconds,14400);
 assert.equal(Number(state.projects[0].legacy_material_cost),320);
 assert.equal(Number(state.yarns[0].balance),0);
 assert.equal(state.receipts.length,0);
 assert.equal(state.importedPurchases.length,1);
 assert.deepEqual(await commitImport(batch.id,keys,true,owner),result);
 assert.equal((await prepareImport(data,'renamed.xlsx',owner)).id,batch.id);
 assert.equal((await getState(owner)).projects.length,1);
 await assert.rejects(commitImport(batch.id,[keys[0]],true,owner),/другим набором/);
});
test('предупреждения требуют подтверждения, чужой импорт недоступен',async()=>{
 const {prepareImport,commitImport,readImport}=await import('../src/lib/import-service');
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('2026');
 sheet.addRow(['Изделие','Кол-во изделий']);sheet.addRow(['Шарф',1]);
 const batch=await prepareImport(Buffer.from(await book.xlsx.writeBuffer()),'unknown.xlsx',owner);
 await assert.rejects(commitImport(batch.id,batch.preview.rows.map(r=>r.key),false,owner),/Подтвердите/);
 assert.equal((await getState(owner)).projects.length,0);
 await assert.rejects(readImport(batch.id,randomUUID()),/не найден/);
});
test('выражения количества не выполняют произвольный код',async()=>{
 const {skeinQuantity}=await import('../src/lib/excel-parser');
 assert.equal(skeinQuantity('2*2'),4);assert.equal(skeinQuantity('1,5*2'),3);
 assert.equal(skeinQuantity('process.exit()'),null);assert.equal(skeinQuantity('=2+2'),null);
});
