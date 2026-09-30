import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {DomainError} from '@/lib/db';
import {localRequest,failure} from '@/lib/http';
import {prepareImport,commitImport,listImports,readImport} from '@/lib/import-service';
const commitSchema=z.object({id:z.string().uuid(),selected:z.array(z.string().max(300)).min(1).max(5000),acknowledge:z.boolean()});
export async function GET(request:NextRequest){
 try{localRequest(request);const id=request.nextUrl.searchParams.get('id');return NextResponse.json(id?await readImport(z.string().uuid().parse(id)):await listImports(),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}
}
export async function POST(request:NextRequest){
 try{
  localRequest(request,true);
  if(request.headers.get('content-type')?.includes('multipart/form-data')){
   if(Number(request.headers.get('content-length'))>6*1024*1024)throw new DomainError('Файл должен быть не больше 5 МБ.',413);
   const form=await request.formData();const file=form.get('file');
   if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx'))throw new DomainError('Выберите файл .xlsx.');
   return NextResponse.json(await prepareImport(Buffer.from(await file.arrayBuffer()),file.name));
  }
  const body=await request.text();if(body.length>1000000)throw new DomainError('Слишком большой запрос.',413);
  const {id,selected,acknowledge}=commitSchema.parse(JSON.parse(body));
  return NextResponse.json(await commitImport(id,selected,acknowledge));
 }catch(e){return failure(e);}
}
