import {photosDirectory} from '@/lib/storage';
import {NextRequest,NextResponse} from 'next/server';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {OWNER,transact,DomainError} from '@/lib/db';
import {localRequest,failure} from '@/lib/http';
export const runtime='nodejs';
export async function POST(request:NextRequest) {
 let path:string|undefined;
 try {
  localRequest(request,true);
  if(Number(request.headers.get('content-length'))>12*1024*1024) throw new DomainError('Фотография должна быть меньше 10 МБ.',413);
  const form=await request.formData();
  const file=form.get('file');const projectId=form.get('project_id');
  if(!(file instanceof File)||file.size>10*1024*1024||typeof projectId!=='string'||!/^[0-9a-f-]{36}$/i.test(projectId)) throw new DomainError('Выберите фотографию JPG, PNG или WebP размером до 10 МБ.');
  const buffer=Buffer.from(await file.arrayBuffer());
  let photo:Buffer;
  try {
   const pipeline=sharp(buffer,{limitInputPixels:40000000});
   const metadata=await pipeline.metadata();
   if(!['jpeg','png','webp','heif'].includes(metadata.format??'')) throw Error('format');
   photo=await pipeline.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
  }catch{throw new DomainError('Не удалось прочитать фото. Сохраните его как JPG, PNG или WebP.');}
  const filename=`${randomUUID()}.jpg`;
  const dir=photosDirectory;await mkdir(dir,{recursive:true,mode:0o700});
  const result=await transact(OWNER,async c=>{
   if(!(await c.query('SELECT 1 FROM projects WHERE owner_id=$1 AND id=$2',[OWNER,projectId])).rowCount) throw new DomainError('Проект не найден',404);
   path=resolve(dir,filename);await writeFile(path,photo,{mode:0o600});
   return (await c.query('INSERT INTO photos(owner_id,project_id,filename) VALUES($1,$2,$3) RETURNING id',[OWNER,projectId,filename])).rows[0];
  });
  return NextResponse.json(result);
 }catch(e){if(path)await unlink(path).catch(()=>{});return failure(e);}
}
