import Decimal from 'decimal.js';
// SQLite columns use integers: milligrams, millimetres and kopecks.
export const scales:Record<string,number>={grams:1000,skein_weight:1000,skein_length:1000,balance:1000,used:1000,cost:100,hourly_rate:100,rate:100,price:100,other_cost:100,legacy_material_cost:100};
export const jsonColumns=new Set(['result','payload','preview','data','source_data','totals']);
export const booleanColumns=new Set(['historical','archived','needs_inventory','cost_incomplete']);
export function integerUnits(value:unknown,scale:number):number|null{
 if(value===null||value===undefined)return null;
 const n=new Decimal(String(value)).times(scale);
 if(!n.isInteger()||!n.isFinite()||n.abs().gt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid fixed precision amount');
 return n.toNumber();
}
export function encodeColumn(key:string,value:unknown):unknown{
 if(value===null||value===undefined)return null;
 if(scales[key])return integerUnits(value,scales[key]);
 if(jsonColumns.has(key))return JSON.stringify(value);
 if(booleanColumns.has(key))return value?1:0;
 return value instanceof Date?value.toISOString():value;
}
export function decodeRow(row:Record<string,any>):Record<string,any>{
 return Object.fromEntries(Object.entries(row).map(([key,v])=>[key,v===null?null:scales[key]?new Decimal(v).div(scales[key]).toString():jsonColumns.has(key)&&typeof v==='string'?JSON.parse(v):booleanColumns.has(key)?Boolean(v):v]));
}
