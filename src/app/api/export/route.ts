import {NextRequest,NextResponse} from 'next/server';
import {exportArchive} from '@/lib/archive';
import {localRequest,failure} from '@/lib/http';
export async function GET(request:NextRequest){
 try{localRequest(request);return NextResponse.json(await exportArchive(),{headers:{'Content-Disposition':'attachment; filename="knitting-backup.json"','Cache-Control':'no-store'}});}catch(e){return failure(e);}
}
