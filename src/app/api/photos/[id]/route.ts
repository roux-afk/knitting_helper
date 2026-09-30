import {photosDirectory} from '@/lib/storage';
import {NextRequest,NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pool,OWNER,DomainError} from '@/lib/db';
import {localRequest,failure} from '@/lib/http';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
 try{
  localRequest(request);const {id}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new DomainError('Фото не найдено',404);
  const {rows:[photo]}=await pool.query('SELECT filename FROM photos WHERE owner_id=$1 AND id=$2',[OWNER,id]);
  if(!photo)throw new DomainError('Фото не найдено',404);
  return new NextResponse(await readFile(resolve(photosDirectory,photo.filename)),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
 }catch(e){return failure(e);}
}
