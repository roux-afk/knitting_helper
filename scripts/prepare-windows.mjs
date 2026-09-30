import {cp,rm,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {x as extract} from 'tar';
// The production JS is shared; only the prebuilt image-processing binary is platform-specific.
const sharp=JSON.parse(await readFile('node_modules/sharp/package.json','utf8'));
const version=sharp.optionalDependencies['@img/sharp-win32-x64'];
const cache=resolve('build/windows-native');await mkdir(cache,{recursive:true});
if(!process.env.npm_execpath)throw Error('Run this script through npm run desktop:windows');
// Download, rather than install, the foreign-platform binary. No package scripts run.
const pack=spawnSync(process.execPath,[process.env.npm_execpath,'pack',`@img/sharp-win32-x64@${version}`,'--pack-destination',cache,'--ignore-scripts','--json'],{encoding:'utf8'});
if(pack.status!==0)throw Error(pack.stderr||'Could not download the Windows image module');
const [packed]=JSON.parse(pack.stdout),file=join(cache,packed.filename);
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const expected=lock.packages['node_modules/@img/sharp-win32-x64']?.integrity;
const actual='sha512-'+createHash('sha512').update(await readFile(file)).digest('base64');
if(!expected||actual!==expected)throw Error('Windows image module does not match package-lock integrity');
const nativeDir=join(cache,'sharp-win32-x64');await rm(nativeDir,{recursive:true,force:true});await mkdir(nativeDir);
await extract({file,cwd:nativeDir,strip:1});
await rm('desktop-win',{recursive:true,force:true});
await cp('desktop','desktop-win',{recursive:true,dereference:true});
const img=resolve('desktop-win/server/node_modules/@img');
for(const name of await readdir(img))if(name.startsWith('sharp-'))await rm(join(img,name),{recursive:true,force:true});
await cp(nativeDir,join(img,'sharp-win32-x64'),{recursive:true});
const info=JSON.parse(await readFile('desktop/build-info.json','utf8'));
await writeFile('desktop-win/build-info.json',JSON.stringify({...info,platform:'win32',arch:'x64',buildHost:`${process.platform}/${process.arch}`,crossCompiled:process.platform!=='win32'||process.arch!=='x64',nativePackage:`@img/sharp-win32-x64@${version}`,builtAt:new Date().toISOString()},null,2));
console.log('Windows x64 resources prepared in desktop-win; Mac resources unchanged.');
