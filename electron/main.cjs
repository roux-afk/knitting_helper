const {app,BrowserWindow,Menu,dialog,utilityProcess,shell}=require('electron');
const {randomBytes}=require('node:crypto');
const {createServer}=require('node:net');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createUpdater}=require('./updater.cjs');
app.setName('Петелька');
if(process.env.KNITTING_DATA_DIR)app.setPath('userData',path.resolve(process.env.KNITTING_DATA_DIR));
let window,service,origin,updater,quitting=false,archiveBusy=false;
const token=randomBytes(32).toString('hex');
const dataDir=()=>app.getPath('userData');
const resources=()=>app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../../desktop');
const headers=()=>({'x-knitting-token':token,Origin:origin});
async function request(endpoint,options={}){
 const response=await fetch(`${origin}${endpoint}`,{...options,headers:{...headers(),...options.headers},signal:AbortSignal.timeout(120000)});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||`Ошибка ${response.status}`);}return response;
}
async function saveArchive(){
 if(archiveBusy)return;archiveBusy=true;
 try{
  const {canceled,filePath}=await dialog.showSaveDialog(window,{title:'Сохранить мастерскую',defaultPath:`Петелька-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'Архив мастерской',extensions:['json']}]});
  if(canceled||!filePath)return;
  const body=await (await request('/api/export')).text();await fs.writeFile(filePath,body,{mode:0o600});
  await dialog.showMessageBox(window,{message:'Мастерская сохранена',detail:'Архив содержит изделия, пряжу, время и фотографии.',type:'info'});
 }catch(e){dialog.showErrorBox('Не удалось сохранить мастерскую',e.message);}finally{archiveBusy=false;}
}
async function restoreArchive(){
 if(archiveBusy)return;archiveBusy=true;
 try{
  const {canceled,filePaths}=await dialog.showOpenDialog(window,{title:'Восстановить мастерскую',properties:['openFile'],filters:[{name:'Архив мастерской',extensions:['json']}]});
  if(canceled)return;
  const file=filePaths[0];if((await fs.stat(file)).size>200*1024*1024)throw Error('Архив больше 200 МБ.');
  const answer=await dialog.showMessageBox(window,{type:'question',message:'Заменить текущую мастерскую данными архива?',detail:'Перед заменой будет сохранена копия текущей мастерской. Активные таймеры из архива будут остановлены на момент его создания.',buttons:['Отмена','Восстановить'],defaultId:0,cancelId:0});
  if(answer.response!==1)return;
  await request('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:await fs.readFile(file,'utf8')});
  await window.loadURL(origin);await dialog.showMessageBox(window,{message:'Мастерская восстановлена',type:'info'});
 }catch(e){dialog.showErrorBox('Не удалось восстановить мастерскую',e.message);}finally{archiveBusy=false;}
}
async function automaticBackup(){
 const dir=path.join(dataDir(),'backups');await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,`daily-${new Date().toISOString().slice(0,10)}.json`);
 try{await fs.access(file);return;}catch{}
 await fs.writeFile(file,await (await request('/api/export')).text(),{mode:0o600,flag:'wx'});
}
// Saved before an update is installed; the update is cancelled if this fails.
async function backupBeforeUpdate(version){
 const dir=path.join(dataDir(),'backups');await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,`before-update-${app.getVersion()}-to-${version}-${Date.now()}.json`);
 await fs.writeFile(file,await (await request('/api/export')).text(),{mode:0o600,flag:'wx'});
}
async function freePort(){const server=createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function start(){
 await fs.mkdir(dataDir(),{recursive:true});
 const port=await freePort();origin=`http://127.0.0.1:${port}`;
 service=utilityProcess.fork(path.join(__dirname,'server.cjs'),[],{serviceName:'Петелька — локальная мастерская',stdio:'pipe',env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1',NODE_ENV:'production',KNITTING_DATA_DIR:dataDir(),KNITTING_SERVER_DIR:path.join(resources(),'server'),KNITTING_SCHEMA_DIR:path.join(resources(),'schema'),KNITTING_DESKTOP_TOKEN:token}});
 const log=path.join(dataDir(),'desktop.log');
 // Keep only this session's diagnostics; no archive contents are logged.
 await fs.writeFile(log,`Петелька ${app.getVersion()} ${process.platform}/${process.arch}\n`);
 service.stdout?.on('data',chunk=>fs.appendFile(log,chunk).catch(()=>{}));service.stderr?.on('data',chunk=>fs.appendFile(log,chunk).catch(()=>{}));
 let exited=false;service.on('exit',()=>{exited=true;if(!quitting&&window){dialog.showErrorBox('Мастерская остановилась','Перезапустите Петельку. Журнал находится в папке данных.');app.quit();}});
 let ready=false;
 for(let i=0;i<120&&!exited;i++){try{const response=await fetch(`${origin}/api/state`,{headers:headers(),signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
 if(!ready)throw Error('Не удалось запустить локальную мастерскую. Проверьте desktop.log в папке данных.');
 window=new BrowserWindow({width:1280,height:860,minWidth:760,minHeight:600,title:'Петелька',show:false,backgroundColor:'#f7f7fa',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 window.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
 window.webContents.session.setPermissionCheckHandler(()=>false);
 window.webContents.session.webRequest.onBeforeSendHeaders({urls:[`${origin}/*`]},(details,callback)=>callback({requestHeaders:{...details.requestHeaders,'x-knitting-token':token}}));
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 window.webContents.session.on('will-download',(_event,item)=>{item.setSaveDialogOptions({defaultPath:`Петелька-${new Date().toISOString().slice(0,10)}.json`});});
 const menu=[...(process.platform==='darwin'?[{label:'Петелька',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]}]:[]),{label:'Мастерская',submenu:[{label:'Сохранить мастерскую…',accelerator:'CmdOrCtrl+Shift+S',click:saveArchive},{label:'Восстановить мастерскую…',click:restoreArchive},{type:'separator'},{label:'Открыть папку данных',click:()=>shell.openPath(dataDir())},{label:'Открыть резервные копии',click:()=>shell.openPath(path.join(dataDir(),'backups'))},{type:'separator'},{label:'Проверить обновления…',click:()=>{window?.webContents.send('updates:open');updater?.check(false);}},...(process.platform==='darwin'?[]:[{role:'quit'}])]},{label:'Правка',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'Вид',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}];
 Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
 updater=createUpdater({getWindow:()=>window,beforeInstall:backupBeforeUpdate});
 await window.loadURL(origin);window.show();
 await fs.appendFile(log,'Окно мастерской загружено.\n');
 setTimeout(()=>updater.check(true),15000);
 automaticBackup().catch(e=>dialog.showErrorBox('Резервная копия не создана',e.message));
}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 app.whenReady().then(start).catch(error=>{dialog.showErrorBox('Не удалось открыть Петельку',error.message);app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{quitting=true;service?.kill();});
}
