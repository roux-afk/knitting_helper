import {NextRequest,NextResponse} from 'next/server';
import {execute} from '@/lib/accounting';
import {envelopeSchema} from '@/lib/validation';
import {localRequest,failure} from '@/lib/http';
export async function POST(request:NextRequest) {
 try {
  localRequest(request,true);
  const body=await request.text();
  if(body.length>50000) return NextResponse.json({error:'Слишком большой запрос.'},{status:413});
  let json;try{json=JSON.parse(body);}catch{return NextResponse.json({error:'Некорректный запрос.'},{status:400});}
  const {command,key}=envelopeSchema.parse(json);
  return NextResponse.json(await execute(command,key));
 }catch(e){return failure(e);}
}
