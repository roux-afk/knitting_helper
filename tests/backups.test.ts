import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {selectBackupsToDelete}=createRequire(import.meta.url)('../electron/backups.cjs') as {selectBackupsToDelete:(e:{name:string;mtimeMs:number}[])=>string[]};
const day=(offset:number)=>{const d=new Date(Date.UTC(2026,8,30));d.setUTCDate(d.getUTCDate()-offset);return `daily-${d.toISOString().slice(0,10)}.json`;};
test('хранятся 14 ежедневных копий и по одной в неделю за 8 недель',()=>{
 const entries=Array.from({length:120},(_,i)=>({name:day(i),mtimeMs:i}));
 const kept=entries.map(e=>e.name).filter(n=>!selectBackupsToDelete(entries).includes(n));
 assert.equal(kept.length,14+8);
 assert.deepEqual(kept.slice(0,14),entries.slice(0,14).map(e=>e.name));
 const weeks=kept.slice(14).map(n=>{const d=new Date(n.slice(6,16)+'T00:00:00Z');return Math.floor((d.getTime()-Date.UTC(2026,0,5))/(7*864e5));});
 assert.equal(new Set(weeks).size,8);
});
test('копии перед восстановлением, обновлением и миграцией ограничены пятью каждого вида, прочие файлы не трогаются',()=>{
 const entries=[
  ...Array.from({length:8},(_,i)=>({name:`before-restore-${i}.json`,mtimeMs:i})),
  ...Array.from({length:7},(_,i)=>({name:`before-update-0.3.0-to-0.3.${i}-${i}.json`,mtimeMs:i})),
  ...Array.from({length:6},(_,i)=>({name:`before-upgrade-${i}.sqlite`,mtimeMs:i})),
  {name:'notes.txt',mtimeMs:0},{name:'daily-2026-09-30.json',mtimeMs:0},
 ];
 const remove=selectBackupsToDelete(entries);
 assert.equal(remove.length,3+2+1);
 assert.ok(remove.includes('before-restore-0.json')&&!remove.includes('before-restore-7.json'));
 assert.ok(!remove.includes('notes.txt')&&!remove.includes('daily-2026-09-30.json'));
});
