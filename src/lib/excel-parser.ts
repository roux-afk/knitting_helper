import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import {createHash} from 'node:crypto';
import {DomainError} from './db';
import type {ImportPreview,ImportRow,ImportKind} from './import-types';

type Scalar=string|number|Date|null;
function value(cell:ExcelJS.Cell):Scalar {
 const v=cell.value;
 if(v===null||v===undefined)return null;
 if(typeof v==='string'||typeof v==='number'||v instanceof Date)return v;
 if(typeof v==='object'){
  if('formula'in v||'sharedFormula'in v){const result=v.result;return typeof result==='string'||typeof result==='number'||result instanceof Date?result:null;}
  if('richText'in v)return v.richText.map(x=>x.text).join('');
  if('text'in v)return v.text;
 }
 return null;
}
function text(v:Scalar):string {return v instanceof Date?v.toISOString().slice(0,10):v===null?'':String(v).trim();}
function numeric(v:Scalar):number|null {
 if(typeof v==='number')return Number.isFinite(v)&&v>=0&&v<=1e7?v:null;
 const s=text(v).replace(/\s/g,'').replace(',','.');
 if(!/^\d+(\.\d+)?$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)&&n<=1e7?n:null;
}
// Only a product of literal positive decimal numbers. No eval or spreadsheet execution.
export function skeinQuantity(v:Scalar):number|null {
 const direct=numeric(v);if(direct!==null)return direct;
 const s=text(v).replace(/\s/g,'');
 if(!/^\d+(?:[.,]\d+)?(?:\*\d+(?:[.,]\d+)?){1,4}$/.test(s))return null;
 const result=s.split('*').reduce((p,n)=>p.times(n.replace(',','.')),new Decimal(1));
 return result.gt(0)&&result.lte(1e7)?result.toNumber():null;
}
function when(v:Scalar){
 if(v instanceof Date)return {date:v.toISOString().slice(0,10),month:null};
 const s=text(v);const month=s.match(/^(0?[1-9]|1[0-2])\.(\d{2}|\d{4})$/);
 if(month)return {date:null,month:`${month[2].length===2?'20':''}${month[2]}-${month[1].padStart(2,'0')}`};
 return {date:null,month:null};
}
function code(v:Scalar){return v instanceof Date?`${v.getUTCDate()}.${v.getUTCMonth()+1}`:text(v);}
function rounded(v:number|null){return v===null?null:new Decimal(v).toDecimalPlaces(2).toNumber();}

export async function parseWorkbook(buffer:Buffer,sourceName:string):Promise<ImportPreview>{
 if(buffer.length>5*1024*1024)throw new DomainError('Размер XLSX должен быть не более 5 МБ.',413);
 const workbook=new ExcelJS.Workbook();
 try{await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],{ignoreNodes:['drawing','picture','hyperlinks']});}
 catch{throw new DomainError('Не удалось прочитать XLSX. Сохраните книгу в формате .xlsx и попробуйте снова.');}
 const rows:ImportRow[]=[];const warnings:string[]=[];let hasSupported=false;
 for(const sheet of workbook.worksheets){
  if(sheet.rowCount>5000)throw new DomainError('В этой версии поддерживаются листы до 5000 строк.');
  let section:ImportKind|null=null;let sheetSupported=false;
  for(let r=1;r<=sheet.rowCount;r++){
   const cell=(col:string)=>sheet.getCell(`${col}${r}`);const v=(col:string)=>value(cell(col));const s=(col:string)=>text(v(col));
   const a=s('A');
   if(a==='Название изделия'&&s('B')==='Пряжа'){section='template';hasSupported=sheetSupported=true;continue;}
   if(a==='Дата покупки'&&s('B')==='Название пряжи'){section='purchase';hasSupported=sheetSupported=true;continue;}
   if(a==='Изделие'&&s('B')==='Кол-во изделий'){section='project';hasSupported=sheetSupported=true;continue;}
   if(a==='Продажи'||a==='Выполненные изделия'||a==='Купленная пряжа'){section=null;continue;}
   if(!section||!a||/^Итого/i.test(a))continue;
   // Section banners merge A:L; ExcelJS repeats the master value in B.
   if(cell('B').isMerged&&cell('B').master.address===cell('A').address)continue;
   if(section==='template'&&!s('B'))continue;
   if(section==='purchase'&&!(v('A') instanceof Date))continue;
   if(section==='project'&&(numeric(v('B'))===null))continue;
   const source:Record<string,string>={};const row:ImportRow={key:`${sheet.name}:${section}:${r}`,sheet:sheet.name,row:r,kind:section,title:a,quantity:1,date:null,month:null,seconds:null,rate:125,price:null,materialCost:null,notes:'',yarnName:'',color:'',code:'',skeinWeight:null,skeinLength:null,purchasedGrams:null,purchaseCost:null,source,warnings:[],errors:[]};
   for(const col of 'ABCDEFGHIJKL'){
    source[col]=s(col);
    const cv=cell(col).value;
    if(cv&&typeof cv==='object'&&('formula'in cv||'sharedFormula'in cv)){
     source[`${col}_formula`]=cell(col).formula;
     if(v(col)===null)row.warnings.push(`${col}${r}: у формулы нет сохраненного результата.`);
    }
   }
   if(section==='template'){
    row.yarnName=s('B');const hours=numeric(v('D'));row.seconds=hours===null?null:Math.round(hours*3600);row.price=rounded(numeric(v('K')));row.materialCost=rounded(numeric(v('H')));
    const labor=numeric(v('I'));if(hours&&labor!==null)row.rate=rounded(labor/hours)!;
    row.notes=`Пряжа: ${s('B')}\nРасход на штуку: ${s('C')||'не указан'} г\nВес мотка: ${s('E')||'не указан'} г\nСтоимость мотка: ${s('F')||'не указана'} ₽\nДругие материалы: ${s('G')||'не указаны'} ₽\nПлановое время: ${s('D')||'не указано'} ч`;
   }else if(section==='purchase'){
    row.title=s('B');row.yarnName=s('B');row.code=code(v('C'));row.color=s('F');row.skeinWeight=numeric(v('D'));row.skeinLength=numeric(v('E'));row.quantity=skeinQuantity(v('G'))??0;row.date=when(v('A')).date;row.purchaseCost=rounded(numeric(v('H')));
    row.purchasedGrams=row.skeinWeight&&row.quantity?new Decimal(row.skeinWeight).times(row.quantity).toNumber():null;
    if(!row.skeinWeight)row.errors.push('Не указан положительный вес мотка.');
    if(!row.quantity)row.errors.push('Не удалось определить число мотков.');
    if(!row.color)row.warnings.push('Цвет не указан.');
    if(v('C') instanceof Date)row.warnings.push(`Номер позиции восстановлен из формата даты: ${row.code}.`);
    if(row.purchaseCost===null)row.warnings.push('Стоимость не является числом; пояснение сохранено без подстановки нуля.');
    row.notes=`Покупка ${row.date}, ${s('G')} мотков. Стоимость в источнике: ${s('H')||'неизвестна'}. Номер позиции: ${row.code||'нет'}.`;
   }else{
    row.quantity=numeric(v('B'))!;if(!Number.isInteger(row.quantity)||row.quantity<=0||row.quantity>10000)row.errors.push('Количество изделий должно быть положительным целым числом до 10000.');
    Object.assign(row,when(v('C')));row.yarnName=s('D');row.code=s('E');
    const hours=numeric(v('J'));row.seconds=hours===null?null:Math.round(hours*row.quantity*3600);
    const cost=numeric(v('H'));row.materialCost=cost===null?null:rounded(new Decimal(cost).times(row.quantity).toNumber());
    row.notes=`Пряжа: ${s('D')||'не указана'}\nНомера пряжи: ${s('E')||'не указаны'}\nРасход на штуку: ${s('F')||'не указан'} г\nДополнительные материалы: ${s('G')||'не указаны'}`;
    if(!s('F'))row.warnings.push('Расход неизвестен: сохранится пустым, остатки не изменятся.');
    else if(/[,;]/.test(s('E'))&&numeric(v('F'))!==null)row.warnings.push('Общий расход не распределен по цветам; автоматического распределения не будет.');
    if(!row.date&&!row.month)row.warnings.push('Дата завершения не распознана.');
    if(row.seconds===null)row.warnings.push('Время работы неизвестно.');
    if(row.materialCost===null)row.warnings.push('Стоимость материалов неизвестна.');
    const formula=cell('H').formula?.replace(/\$/g,'');const ref=formula?.match(/^([HJ])(\d+)$/);
    if(ref){
     if(ref[1]==='J')row.warnings.push('В стоимость материалов включена стоимость работы (ссылка на J). Значение требует сверки.');
     const linked=text(value(sheet.getCell(`A${ref[2]}`)));
     if(linked&&linked!==row.title)row.warnings.push(`Стоимость ссылается на другое изделие: «${linked}».`);
    }
    // A cached total is retained separately and never trusted as inventory data.
    const savedHours=numeric(v('K'));if(savedHours!==null&&row.seconds!==null&&Math.abs(savedHours*3600-row.seconds)>1)row.warnings.push('Итог часов отличается от количества × часов на штуку.');
   }
   if(row.title.length>200)row.errors.push('Слишком длинное название.');
   if(row.seconds!==null&&row.seconds>36000000)row.errors.push('Длительность превышает 10000 часов.');
   rows.push(row);
  }
  if(!sheetSupported)warnings.push(`Лист «${sheet.name}» пропущен: нет знакомых заголовков.`);
 }
 if(!hasSupported||!rows.length)throw new DomainError('Не найдены разделы «Название изделия», «Дата покупки» или «Изделие / Кол-во изделий». Поддерживается структура вашей таблицы учета.');
 for(const row of rows.filter(r=>r.kind==='project')){
  const template=rows.find(t=>t.kind==='template'&&t.sheet===row.sheet&&t.title===row.title);
  if(template){row.rate=template.rate;row.price=template.price;}
 }
 warnings.push('Продажи, боковые заметки и строки итогов не переносятся. Формулы не выполняются: используются сохраненные результаты.');
 warnings.push('Покупки станут историей и карточками пряжи с нулевым остатком. Текущий запас нужно ввести после взвешивания.');
 const totals={templates:rows.filter(r=>r.kind==='template').length,projects:rows.filter(r=>r.kind==='project').length,units:rows.filter(r=>r.kind==='project').reduce((s,r)=>s+r.quantity,0),purchases:rows.filter(r=>r.kind==='purchase').length};
 return {version:1,sourceName,hash:createHash('sha256').update(buffer).digest('hex'),rows,warnings,totals};
}
