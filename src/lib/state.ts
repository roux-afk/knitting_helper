import { pool, OWNER } from './db';
import Decimal from 'decimal.js';
export async function getState(owner=OWNER) {
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  const query=async(sql:string)=>(await c.query(sql,[owner])).rows;
  const profile=(await query('SELECT * FROM profiles WHERE id=$1'))[0];
  const projects=await query(`SELECT p.*,
   COALESCE((SELECT SUM(COALESCE(s.manual_seconds,(unixepoch(s.ended_at,'subsec')-unixepoch(s.started_at,'subsec')))) FROM sessions s WHERE s.owner_id=p.owner_id AND s.project_id=p.id),0) seconds,
   EXISTS(SELECT 1 FROM movements m JOIN receipts r ON r.id=m.receipt_id WHERE m.owner_id=p.owner_id AND m.project_id=p.id AND r.cost IS NULL GROUP BY r.id HAVING SUM(m.grams)<0)
   OR EXISTS(SELECT 1 FROM historical_usage h WHERE h.owner_id=p.owner_id AND h.project_id=p.id AND h.grams>0) AS cost_incomplete
   FROM projects p WHERE owner_id=$1 ORDER BY created_at DESC`);
  const yarns=await query(`SELECT y.*,
   COALESCE((SELECT SUM(m.grams) FROM movements m JOIN receipts r ON r.id=m.receipt_id WHERE m.owner_id=y.owner_id AND r.yarn_id=y.id),0) balance
   FROM yarns y WHERE owner_id=$1 ORDER BY created_at DESC`);
  const receipts=await query('SELECT r.*,COALESCE(SUM(m.grams),0) balance FROM receipts r LEFT JOIN movements m ON m.receipt_id=r.id AND m.owner_id=r.owner_id WHERE r.owner_id=$1 GROUP BY r.id ORDER BY purchased_on,created_at');
  const usage=await query(`SELECT m.project_id,r.yarn_id,(-SUM(m.grams)) grams,false historical FROM movements m JOIN receipts r ON r.id=m.receipt_id AND r.owner_id=m.owner_id WHERE m.owner_id=$1 AND m.project_id IS NOT NULL GROUP BY m.project_id,r.yarn_id HAVING SUM(m.grams)<>0
   UNION ALL SELECT project_id,yarn_id,grams,true FROM historical_usage WHERE owner_id=$1 AND grams>0`);
  const sessions=await query('SELECT * FROM sessions WHERE owner_id=$1 ORDER BY created_at DESC');
  const movements=await query('SELECT m.*,r.yarn_id FROM movements m JOIN receipts r ON r.id=m.receipt_id AND r.owner_id=m.owner_id WHERE m.owner_id=$1 ORDER BY m.created_at DESC');
  const templates=await query('SELECT * FROM templates WHERE owner_id=$1 ORDER BY created_at DESC');
  const photos=await query('SELECT id,project_id,created_at FROM photos WHERE owner_id=$1 ORDER BY created_at');
  const importedPurchases=await query("SELECT target_id,data FROM import_items WHERE owner_id=$1 AND kind='purchase' ORDER BY data->>'date'");
  for(const p of projects){
   p.yarn_cost=movements.filter(m=>m.project_id===p.id).reduce((total,m)=>{const r=receipts.find(r=>r.id===m.receipt_id)!;return r.cost===null?total:total.minus(new Decimal(m.grams).times(r.cost).div(r.grams));},new Decimal(0)).toString();
  }
  await c.query('COMMIT');
  return {profile,projects,yarns,receipts,usage,sessions,movements:movements.slice(0,100),templates,photos,importedPurchases,serverNow:new Date().toISOString()};
 } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
export type AppState = Awaited<ReturnType<typeof getState>>;
