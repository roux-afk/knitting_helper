export type ImportKind='template'|'purchase'|'project';
export interface ImportRow {
 key:string; sheet:string; row:number; kind:ImportKind; title:string;
 quantity:number; date:string|null; month:string|null; seconds:number|null;
 rate:number; price:number|null; materialCost:number|null; notes:string;
 yarnName:string; color:string; code:string; skeinWeight:number|null;
 skeinLength:number|null; purchasedGrams:number|null; purchaseCost:number|null;
 source:Record<string,string>; warnings:string[]; errors:string[];
}
export interface ImportPreview {version:1;sourceName:string;hash:string;rows:ImportRow[];warnings:string[];totals:{templates:number;projects:number;units:number;purchases:number};}
export interface ImportBatch {id:string;source_name:string;status:'preview'|'committed';preview:ImportPreview;result:ImportResult|null;created_at:string;}
export interface ImportResult {templates:number;projects:number;units:number;purchases:number;yarns:number;excluded:string[];}
