const {access,readFile,writeFile}=require('node:fs/promises');
const path=require('node:path');
const {createRequire}=require('node:module');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
module.exports=async function(context){
 const resources=context.electronPlatformName==='darwin'?path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents','Resources'):path.join(context.appOutDir,'resources');
 const server=path.join(resources,'server');
 const requireServer=createRequire(path.join(server,'server.js'));
 for(const name of ['next','sharp','next/dist/compiled/next-server/app-route-turbo.runtime.prod.js']){
  const resolved=requireServer.resolve(name);
  if(!resolved.startsWith(server+path.sep))throw Error(`Packaged dependency ${name} resolves outside the application`);
  await access(resolved);
 }
 await access(path.join(resources,'schema','001_initial.sql'));
 const info=JSON.parse(await readFile(path.join(resources,'build-info.json'),'utf8'));
 const arch=require('builder-util').Arch[context.arch];
 if(info.platform!==context.electronPlatformName||info.arch!==arch)throw Error('Server resources do not match the target platform/architecture.');
 if(process.platform!==info.platform||process.arch!==arch){
  if(info.platform!=='win32'||arch!=='x64'||!info.crossCompiled)throw Error('Unsupported cross-platform preparation.');
  const {checkWindows}=require('./check-windows.cjs');
  const report=await checkWindows(server,path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe'));
  await writeFile(path.join(context.appOutDir,'build-verification.json'),JSON.stringify(report,null,2));
  console.log('Windows x64 binary structure and packaged dependencies verified. Runtime test requires Windows.');
  return;
 }
 const {stdout}=await promisify(execFile)(process.execPath,[path.resolve('scripts/smoke-desktop-server.mjs')],{env:{...process.env,KNITTING_TEST_RESOURCES:resources},timeout:120000});
 console.log(stdout.trim());
 console.log('Packaged server dependencies and schema verified.');
};
