const {app,ipcMain,shell}=require('electron');
const {autoUpdater}=require('electron-updater');

// Releases are published to this repository by .github/workflows/release.yml.
const RELEASES_URL='https://github.com/roux-afk/knitting_helper/releases/latest';

const plain=notes=>{
 const text=Array.isArray(notes)?notes.map(n=>n.note).join('\n\n'):String(notes??'');
 return text.replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|li|h\d)>/gi,'\n').replace(/<li>/gi,'• ').replace(/<[^>]+>/g,'')
  .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\n{3,}/g,'\n\n').trim().slice(0,4000);
};
function friendly(error){
 const text=String(error?.message??error);
 if(/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET|ERR_NETWORK|ERR_NAME|net::/i.test(text))return 'Нет подключения к интернету. Проверьте сеть и повторите.';
 if(/404|Cannot find latest|No published versions|latest\.yml/i.test(text))return 'В репозитории пока нет опубликованных выпусков.';
 if(/403|rate limit/i.test(text))return 'GitHub временно ограничил запросы. Повторите позже.';
 return `Не удалось проверить обновления: ${text.split('\n')[0].slice(0,200)}`;
}

// beforeInstall must save a backup and throw if it cannot; the update is then not installed.
function createUpdater({getWindow,beforeInstall}){
 // Installed Windows builds only. An unsigned macOS app cannot replace itself.
 const supported=app.isPackaged&&process.platform==='win32';
 let state={status:supported?'idle':'unsupported',current:app.getVersion(),version:null,notes:'',percent:0,error:'',releaseUrl:RELEASES_URL};
 let silent=false;
 const publish=patch=>{state={...state,...patch};const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('updates:changed',state);return state;};
 if(supported){
  autoUpdater.autoDownload=false;
  autoUpdater.autoInstallOnAppQuit=false;
  autoUpdater.allowPrerelease=false;
  autoUpdater.allowDowngrade=false;
  autoUpdater.on('update-available',info=>publish({status:'available',version:info.version,notes:plain(info.releaseNotes),percent:0,error:''}));
  autoUpdater.on('update-not-available',()=>publish({status:'none',version:null,notes:'',error:''}));
  autoUpdater.on('download-progress',p=>publish({status:'downloading',percent:Math.round(p.percent)}));
  autoUpdater.on('update-downloaded',()=>publish({status:'downloaded',percent:100,error:''}));
  autoUpdater.on('error',e=>{
   // A quiet background check must not bother the user when offline.
   if(silent&&state.status==='checking')publish({status:'idle',error:''});
   else publish({status:state.status==='downloading'?'available':'error',error:friendly(e)});
  });
 }
 async function check(quiet=false){
  if(!supported||['checking','downloading','downloaded'].includes(state.status))return state;
  silent=quiet;publish({status:'checking',error:''});
  try{await autoUpdater.checkForUpdates();}
  catch(e){if(state.status==='checking')publish(quiet?{status:'idle'}:{status:'error',error:friendly(e)});}
  return state;
 }
 async function download(){
  if(!supported||state.status!=='available')return state;
  silent=false;publish({status:'downloading',percent:0,error:''});
  try{await autoUpdater.downloadUpdate();}
  catch(e){if(state.status==='downloading')publish({status:'available',error:friendly(e)});}
  return state;
 }
 async function install(){
  if(!supported||state.status!=='downloaded')return state;
  try{await beforeInstall(state.version);}
  catch(e){return publish({error:`Обновление не установлено: не удалось сохранить резервную копию (${String(e?.message??e).slice(0,160)}).`});}
  publish({error:''});
  // Silent install, then relaunch. Electron quits first, which stops the local server.
  autoUpdater.quitAndInstall(true,true);
  return state;
 }
 ipcMain.handle('updates:get',()=>state);
 ipcMain.handle('updates:check',()=>check(false));
 ipcMain.handle('updates:download',download);
 ipcMain.handle('updates:install',install);
 ipcMain.handle('updates:releases',()=>shell.openExternal(RELEASES_URL));
 return {check,state:()=>state};
}
module.exports={createUpdater,RELEASES_URL};
