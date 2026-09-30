// Backup retention: 14 newest daily copies, then one per week for 8 weeks; the
// safety copies made before restore, update or schema upgrade keep the 5 newest of each kind.
const DAILY=/^daily-(\d{4}-\d{2}-\d{2})\.json$/;
const KINDS=[/^before-restore-/,/^before-update-/,/^before-upgrade-/];
const DAILY_KEPT=14,WEEKS_KEPT=8,SAFETY_KEPT=5;
function weekStart(day){
 const d=new Date(`${day}T00:00:00Z`);const back=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-back);return d.toISOString().slice(0,10);
}
// entries: [{name,mtimeMs}]. Returns the file names that should be deleted.
function selectBackupsToDelete(entries){
 const remove=[];
 const daily=entries.map(e=>({...e,day:DAILY.exec(e.name)?.[1]})).filter(e=>e.day).sort((a,b)=>b.day.localeCompare(a.day));
 const seen=new Set();
 daily.slice(DAILY_KEPT).forEach(e=>{
  const week=weekStart(e.day);
  if(seen.size<WEEKS_KEPT&&!seen.has(week)){seen.add(week);return;}
  remove.push(e.name);
 });
 for(const kind of KINDS){
  entries.filter(e=>kind.test(e.name)).sort((a,b)=>b.mtimeMs-a.mtimeMs||b.name.localeCompare(a.name)).slice(SAFETY_KEPT).forEach(e=>remove.push(e.name));
 }
 return remove;
}
module.exports={selectBackupsToDelete};
