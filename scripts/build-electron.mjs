import {build} from 'esbuild';
import {cp,rm,mkdir} from 'node:fs/promises';
// The packaged app excludes node_modules, so electron-updater is bundled into one file.
// preload.cjs and server.cjs stay separate: Electron loads them by path.
await rm('electron/dist',{recursive:true,force:true});await mkdir('electron/dist',{recursive:true});
await build({entryPoints:['electron/main.cjs'],outfile:'electron/dist/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],legalComments:'none',logLevel:'warning'});
await cp('electron/preload.cjs','electron/dist/preload.cjs');
await cp('electron/server.cjs','electron/dist/server.cjs');
console.log('Electron main process bundled in electron/dist');
