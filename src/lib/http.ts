import { NextRequest, NextResponse } from 'next/server';
import { DomainError } from './db';
import { ZodError } from 'zod';

// This first version is intentionally local-only, not an unauthenticated cloud app.
// Validate Host as well as Origin to reject DNS rebinding and cross-site writes.
export function localRequest(request: NextRequest, write=false) {
 const host=request.headers.get('host');
 const port=process.env.PORT||'4317';
 if(!host || ![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)) throw new DomainError('Локальное приложение доступно только на этом компьютере.',403);
 if(process.env.KNITTING_DESKTOP_TOKEN&&request.headers.get('x-knitting-token')!==process.env.KNITTING_DESKTOP_TOKEN)throw new DomainError('Откройте мастерскую в приложении Петелька.',403);
 const origin=request.headers.get('origin');
 if(origin && origin!==`http://${host}`) throw new DomainError('Недопустимый источник запроса.',403);
 const site=request.headers.get('sec-fetch-site');
 if(site && !['same-origin','none'].includes(site)) throw new DomainError('Недопустимый источник запроса.',403);
 if(write && !origin) throw new DomainError('Не указан источник запроса.',403);
}
export function failure(error:unknown) {
 if(error instanceof DomainError) return NextResponse.json({error:error.message},{status:error.status});
 if(error instanceof ZodError) return NextResponse.json({error:'Проверьте поля формы.',details:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)},{status:400});
 console.error(error);
 return NextResponse.json({error:'Не удалось сохранить или загрузить данные. Перезапустите приложение; если ошибка повторится, сохраните журнал диагностики.'},{status:500});
}
