import {NextRequest,NextResponse} from 'next/server';
import {localRequest,failure} from '@/lib/http';
import {restoreArchive} from '@/lib/archive';
import {DomainError} from '@/lib/db';
export async function POST(request:NextRequest){
 try{
  localRequest(request,true);
  const text=await request.text();if(Buffer.byteLength(text)>200*1024*1024)throw new DomainError('Архив больше 200 МБ.',413);
  let data;try{data=JSON.parse(text);}catch{throw new DomainError('Не удалось прочитать архив.');}
  return NextResponse.json(await restoreArchive(data));
 }catch(e){return failure(e);}
}
