import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
// Only generated build output is replaced, never the workshop data directory.
await rm('desktop',{recursive:true,force:true});await mkdir('desktop/server',{recursive:true});
await cp('.next/standalone','desktop/server',{recursive:true,dereference:true});
await cp('.next/static','desktop/server/.next/static',{recursive:true});
await cp('db/sqlite','desktop/schema',{recursive:true});
await sharp('src/app/icon.svg').resize(1024,1024).png().toFile('desktop/icon.png');
const pkg=JSON.parse(await readFile('package.json','utf8'));
await writeFile('desktop/build-info.json',JSON.stringify({version:pkg.version,platform:process.platform,arch:process.arch,builtAt:new Date().toISOString()},null,2));
console.log(`Desktop server prepared: ${resolve('desktop')}`);
