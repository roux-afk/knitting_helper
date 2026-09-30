const {readFile,readdir}=require('node:fs/promises');
const path=require('node:path');
async function peX64(file){
 const bytes=await readFile(file);
 if(bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')throw Error(`Not a Windows PE binary: ${file}`);
 const offset=bytes.readUInt32LE(0x3c);
 if(offset+6>bytes.length||bytes.toString('ascii',offset,offset+4)!=='PE\0\0'||bytes.readUInt16LE(offset+4)!==0x8664)throw Error(`Not a Windows x64 binary: ${file}`);
}
async function checkWindows(server,exe){
 let nativeCount=0;
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);
  else if(/\.(node|dll)$/i.test(entry.name)){await peX64(file);nativeCount++;}
  else if(/\.(dylib|so)$/i.test(entry.name))throw Error(`Foreign native library in Windows build: ${file}`);
 }}
 await walk(server);if(nativeCount<2)throw Error('Windows sharp binary and libraries are missing');
 await peX64(exe);
 return {target:'win32/x64',nativeFiles:nativeCount,binaryValidation:'passed',windowsRuntimeTest:'not-run-on-this-host'};
}
module.exports={checkWindows,peX64};
