import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
const dir=await mkdtemp(join(tmpdir(),'petelka-http-test-'));
const resources=resolve(process.env.KNITTING_TEST_RESOURCES||'desktop');
// Run outside the repository so missing dependencies cannot resolve from the developer's node_modules.
await cp(join(resources,'server'),join(dir,'server'),{recursive:true,dereference:true});
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const origin=`http://127.0.0.1:${port}`,token=randomUUID();
const child=spawn(process.execPath,[join(dir,'server/server.js')],{cwd:dir,env:{...process.env,HOSTNAME:'127.0.0.1',PORT:String(port),KNITTING_DATA_DIR:join(dir,'data'),KNITTING_SCHEMA_DIR:join(resources,'schema'),KNITTING_DESKTOP_TOKEN:token},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',d=>{log=(log+d).slice(-4000);});child.stderr.on('data',d=>{log=(log+d).slice(-4000);});
const exited=new Promise(r=>child.once('exit',r));
const request=(endpoint,options={})=>fetch(origin+endpoint,{...options,headers:{Origin:origin,'x-knitting-token':token,...options.headers},signal:AbortSignal.timeout(15000)});
async function json(endpoint,options){const r=await request(endpoint,options);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
const command=cmd=>json('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:randomUUID(),command:cmd})});
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await request('/api/state')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,log);
 const page=await request('/');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('Петелька'));
 for(const [,src] of html.matchAll(/<script[^>]*src="([^"]+)"/g))if(src.startsWith('/'))assert.equal((await request(src)).status,200);
 assert.equal((await fetch(origin+'/api/state')).status,403);
 assert.equal((await request('/api/state',{headers:{Origin:'https://invalid.example'}})).status,403);
 const project=await command({type:'project.create',title:'HTTP smoke',category:'Шапка',notes:'',quantity:1,purpose:'self',rate:125,price:1000,other_cost:0,start_date:null,end_date:null,historical:false});
 const yarn=await command({type:'yarn.create',manufacturer:'Тест',name:'Шерсть',color:'Белый',color_hex:'#ffffff',composition:'Шерсть',skein_weight:100,skein_length:200});
 await command({type:'yarn.receive',id:yarn.id,grams:100,cost:200,dye_lot:'',purchased_on:'2026-09-30',note:''});
 await command({type:'consumption.set',id:project.id,yarn_id:yarn.id,grams:80,version:1});
 const timer=await command({type:'timer.start',id:project.id});await command({type:'timer.stop',session_id:timer.id});
 const photo=await sharp({create:{width:8,height:8,channels:3,background:'#70548d'}}).png().toBuffer();
 const form=new FormData();form.set('project_id',project.id);form.set('file',new Blob([photo],{type:'image/png'}),'smoke.png');
 const uploaded=await json('/api/photos',{method:'POST',body:form});assert.equal((await request('/api/photos/'+uploaded.id)).headers.get('content-type'),'image/jpeg');
 const snapshot=await json('/api/export');assert.equal(snapshot.tables.projects.length,1);assert.equal(Object.keys(snapshot.files).length,1);
 await command({type:'settings.save',rate:900});
 await json('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
 const state=await json('/api/state');assert.equal(state.profile.hourly_rate,'125');assert.equal(state.yarns[0].balance,'20');assert.equal(state.projects[0].yarn_cost,'160');assert.equal(state.photos.length,1);
 assert.equal((await request('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('2026');sheet.addRow(['Название изделия','Пряжа']);sheet.addRow(['Шарф','Шерсть',100,2,100,200,0,200,250,450,800]);
 const workbookForm=new FormData();workbookForm.set('file',new Blob([await book.xlsx.writeBuffer()]),'smoke.xlsx');
 const batch=await json('/api/import',{method:'POST',body:workbookForm});
 await json('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:batch.id,selected:batch.preview.rows.map(r=>r.key),acknowledge:true})});
 assert.equal((await json('/api/state')).templates.length,1);
 console.log('Production passed: page/assets, access guards, project, yarn, consumption, timer, photo, archive restore and Excel import.');
}finally{child.kill();await exited;await rm(dir,{recursive:true,force:true});}
