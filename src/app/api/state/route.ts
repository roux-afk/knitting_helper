import { NextRequest,NextResponse } from 'next/server';
import {getState} from '@/lib/state';
import {localRequest,failure} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
 try {localRequest(request);return NextResponse.json(await getState(),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return failure(e);}
}
