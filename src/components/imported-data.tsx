import type {Project,State,Yarn} from '@/lib/models';
import {dateLabel,money,number} from './primitives';
export function LegacyCosts({project:p}:{project:Project}){
 const src=p.source_data!;const labor=src.seconds===null?null:src.seconds/3600*src.rate;
 return <section className="panel cost-panel"><h2>Стоимость из Excel</h2><p className="hint">Снимок исходного расчета на {src.quantity} шт. Текущие покупки пряжи его не изменяют.</p><dl><div><dt>Материалы, всего</dt><dd>{src.materialCost===null?'Неизвестно':money(src.materialCost)}</dd></div><div><dt>Работа по ставке из таблицы</dt><dd>{labor===null?'Неизвестно':money(labor)}</dd></div><div className="cost-total"><dt>Исходный расчет</dt><dd>{src.materialCost===null||labor===null?'Неполный':money(src.materialCost+labor)}</dd></div><div><dt>Назначенная цена / шт.</dt><dd>{p.price===null?'Не задана':money(p.price)}</dd></div></dl><p className="notice">Это значения источника, а не подтвержденная себестоимость. {src.warnings.some(w=>/стоимост/i.test(w))?'В исходных ссылках стоимости есть замечания.':''}</p></section>;
}
export function SourceNotes({project}:{project:Project}){
 const src=project.source_data;if(!src)return null;
 return <section className="panel"><h2>Данные из таблицы</h2><p className="hint">Лист {src.sheet}, строка {src.row}. Пряжа: {src.yarnName||'не указана'}. Расход на штуку: {src.source.F||'неизвестен'} г. Он сохранен без списаний и распределения по цветам.</p>{src.warnings.length>0&&<ul className="import-warnings">{src.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}</section>;
}
export function ImportedPurchases({yarn,state}:{yarn:Yarn;state:State}){
 const rows=state.importedPurchases?.filter(p=>p.target_id===yarn.id)??[];if(!rows.length)return null;
 return <section className="panel"><h2>Покупки из Excel</h2><p className="hint">История до начала учета. Эти покупки не включены в остаток.</p>{yarn.needs_inventory&&<p className="notice">Текущий запас еще не введен. Взвесьте оставшуюся пряжу и добавьте начальное поступление.</p>}<div className="table-wrap"><table><thead><tr><th>Дата</th><th>Куплено</th><th>Стоимость по таблице</th></tr></thead><tbody>{rows.map(({data:r})=><tr key={r.key}><td>{dateLabel(r.date)}</td><td>{r.purchasedGrams===null?'Неизвестно':`${number(r.purchasedGrams)} г`}</td><td>{r.purchaseCost===null?'Неизвестна':money(r.purchaseCost)}</td></tr>)}</tbody></table></div></section>;
}
