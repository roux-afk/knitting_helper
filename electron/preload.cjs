// Sandboxed preload: the page gets only these calls, never Node.js or ipcRenderer itself.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petelka',{
 updates:{
  get:()=>ipcRenderer.invoke('updates:get'),
  check:()=>ipcRenderer.invoke('updates:check'),
  download:()=>ipcRenderer.invoke('updates:download'),
  install:()=>ipcRenderer.invoke('updates:install'),
  openReleases:()=>ipcRenderer.invoke('updates:releases'),
  onChange:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('updates:changed',listener);return()=>ipcRenderer.removeListener('updates:changed',listener);},
  onOpen:callback=>{const listener=()=>callback();ipcRenderer.on('updates:open',listener);return()=>ipcRenderer.removeListener('updates:open',listener);},
 },
});
