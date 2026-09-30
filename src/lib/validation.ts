import {z} from 'zod';
const id = z.string().uuid();
const text = z.string().trim().min(1).max(200);
const amount = z.coerce.number().finite().min(0).max(10000000);
const grams = amount.refine(v=>Math.abs(v*1000-Math.round(v*1000))<0.00001,'До трех знаков после запятой');
const money = amount.refine(v=>Math.abs(v*100-Math.round(v*100))<0.00001,'До двух знаков после запятой');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,'Некорректная дата');
export const projectFields = z.object({
  title:text, category:text, notes:z.string().max(10000).default(''), quantity:z.coerce.number().int().min(1).max(10000),
  purpose:z.enum(['self','gift','sale']), rate:money, price:money.nullable(), other_cost:money.default(0),
  start_date:date.nullable().default(null), end_date:date.nullable().default(null),
});
export const commandSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('project.create'), ...projectFields.shape, historical:z.boolean().default(false), template_id:id.optional()}),
 z.object({type:z.literal('project.edit'),id,version:z.number().int(),...projectFields.shape}),
 z.object({type:z.literal('project.status'),id,version:z.number().int(),status:z.enum(['planned','active','paused','completed','cancelled'])}),
 z.object({type:z.literal('project.archive'),id,version:z.number().int(),archived:z.boolean()}),
 z.object({type:z.literal('project.repeat'),id}),
 z.object({type:z.literal('template.save'),id}),
 z.object({type:z.literal('yarn.create'),manufacturer:text,name:text,color:text,color_hex:z.string().regex(/^#[0-9a-f]{6}$/i),composition:text,skein_weight:grams.refine(v=>v>0),skein_length:grams.refine(v=>v>0).nullable()}),
 z.object({type:z.literal('yarn.receive'),id,grams:grams.refine(v=>v>0),cost:money.nullable(),dye_lot:z.string().max(100).default(''),purchased_on:date,note:z.string().max(2000).default('')}),
 z.object({type:z.literal('yarn.adjust'),receipt_id:id,target:grams,reason:text}),
 z.object({type:z.literal('consumption.set'),id,version:z.number().int(),yarn_id:id,grams}),
 z.object({type:z.literal('timer.start'),id}),
 z.object({type:z.literal('timer.stop'),session_id:id}),
 z.object({type:z.literal('time.add'),id,seconds:z.coerce.number().int().min(1).max(36000000),note:z.string().max(2000).default('')}),
 z.object({type:z.literal('time.edit'),session_id:id,seconds:z.coerce.number().int().min(1).max(36000000),reason:text}),
 z.object({type:z.literal('settings.save'),rate:money}),
]);
export type Command = z.infer<typeof commandSchema>;
export const envelopeSchema = z.object({key:id,command:commandSchema});
