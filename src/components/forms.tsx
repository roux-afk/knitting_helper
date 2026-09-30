'use client';
import {useState,type FormEvent} from 'react';
import {Field,Modal,categories,number,money} from './primitives';
import UpdatePanel from './updates';
import type {State,Project,Yarn,Session,Receipt,Template} from '@/lib/models';

export type FormKind={type:'project';project?:Project;template?:Template}|{type:'yarn'}|{type:'receive';yarn:Yarn}|{type:'consume';project:Project;yarnId?:string}|{type:'time';project:Project;session?:Session}|{type:'adjust';receipt:Receipt}|{type:'settings'};
export default function Forms({form,state,onClose,onSave,busy,error}:{form:FormKind;state:State;onClose:()=>void;onSave:(command:Record<string,unknown>)=>Promise<void>;busy:boolean;error:string}){
 const [selected,setSelected]=useState(form.type==='consume'?(form.yarnId??state.yarns[0]?.id??''):'');
 const [historical,setHistorical]=useState(form.type==='project'&&!!form.project?.historical);
 const [receiveUnit,setReceiveUnit]=useState('skeins');
 const [receiveAmount,setReceiveAmount]=useState('1');
 const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:state.profile.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [unit,setUnit]=useState('total');
 const titles={project:form.type==='project'&&form.project?'Редактировать проект':'Новый проект',yarn:'Новая пряжа',receive:'Пополнить запас',consume:'Расход пряжи',time:form.type==='time'&&form.session?'Исправить время':'Добавить время',adjust:'Уточнить остаток',settings:'Настройки мастерской'};
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const fd=new FormData(e.currentTarget);const str=(k:string)=>String(fd.get(k)??'');const num=(k:string)=>Number(str(k));const nullable=(k:string)=>str(k)===''?null:num(k);
  let command:Record<string,unknown>={};
  if(form.type==='project'){
   command={type:form.project?'project.edit':'project.create',...(form.project?{id:form.project.id,version:form.project.version}:{historical,...(form.template?{template_id:form.template.id}:{})}),title:str('title'),category:str('category'),notes:str('notes'),quantity:num('quantity'),purpose:str('purpose'),rate:num('rate'),price:nullable('price'),other_cost:num('other_cost'),start_date:str('start_date')||null,end_date:str('end_date')||null};
  }else if(form.type==='yarn'){
   command={type:'yarn.create',manufacturer:str('manufacturer'),name:str('name'),color:str('color'),color_hex:str('color_hex'),composition:str('composition'),skein_weight:num('skein_weight'),skein_length:nullable('skein_length')};
  }else if(form.type==='receive'){
   command={type:'yarn.receive',id:form.yarn.id,grams:Math.round(Number(receiveAmount)*(receiveUnit==='skeins'?Number(form.yarn.skein_weight):1)*1000)/1000,cost:nullable('cost'),dye_lot:str('dye_lot'),purchased_on:str('purchased_on'),note:str('note')};
  }else if(form.type==='consume'){
   command={type:'consumption.set',id:form.project.id,version:form.project.version,yarn_id:selected,grams:Math.round(num('grams')*(unit==='each'?form.project.quantity:1)*1000)/1000};
  }else if(form.type==='time'){
   const seconds=Math.round((num('hours')*3600+num('minutes')*60)*(unit==='each'?form.project.quantity:1));
   command=form.session?{type:'time.edit',session_id:form.session.id,seconds,reason:str('note')}:{type:'time.add',id:form.project.id,seconds,note:str('note')};
  }else if(form.type==='adjust')command={type:'yarn.adjust',receipt_id:form.receipt.id,target:num('target'),reason:str('reason')};
  else command={type:'settings.save',rate:num('rate')};
  await onSave(command);
 }
 const p=form.type==='project'?form.project??form.template:undefined;
 const existing=form.type==='consume'?state.usage.find(u=>u.project_id===form.project.id&&u.yarn_id===selected):undefined;
 const yarn=state.yarns.find(y=>y.id===selected);
 const currentSeconds=form.type==='time'&&form.session?(form.session.manual_seconds??(new Date(form.session.ended_at!).getTime()-new Date(form.session.started_at!).getTime())/1000):0;
 return <Modal title={titles[form.type]} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel={form.type==='consume'?'Сохранить расход':form.type==='receive'?'Добавить в банк':'Сохранить'}>
 {form.type==='project'&&<>
  <Field label="Название изделия" name="title" defaultValue={p?.title} required placeholder="Например, шарф в подарок"/>
  <div className="form-grid"><Field label="Категория"><select name="category" defaultValue={p?.category??'Шарф'}>{[...new Set([...categories,...(p?[p.category]:[])])].map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Назначение"><select name="purpose" defaultValue={form.project?.purpose??'self'}><option value="self">Для себя</option><option value="gift">В подарок</option><option value="sale">На продажу</option></select></Field></div>
  <div className="form-grid"><Field label="Количество изделий" name="quantity" type="number" min="1" max="10000" step="1" defaultValue={form.project?.quantity??1} required/><Field label="Цена за штуку, ₽" name="price" type="number" min="0" step="0.01" defaultValue={p?.price??''} placeholder="Не назначена"/></div>
  {!form.project&&<label className="check"><input type="checkbox" checked={historical} onChange={e=>setHistorical(e.target.checked)}/><span>Уже связанное изделие — расход учтен ранее</span></label>}
  {historical&&<p className="hint">Этот проект попадет в готовые изделия. Внесенный расход не изменит текущий банк пряжи.</p>}
  <div className="form-grid"><Field label="Дата начала" name="start_date" type="date" defaultValue={form.project?.start_date??''}/>{(historical||form.project?.status==='completed')&&<Field label="Дата завершения" name="end_date" type="date" defaultValue={form.project?.end_date??''}/>}</div>
  <div className="form-grid"><Field label="Стоимость часа работы, ₽" name="rate" type="number" min="0" step="0.01" defaultValue={p?.rate??state.profile.hourly_rate} required/><Field label="Другие материалы, всего ₽" name="other_cost" type="number" min="0" step="0.01" defaultValue={form.project?.other_cost??0} required/></div>
  <Field label="Параметры и заметки"><textarea name="notes" rows={4} defaultValue={p?.notes??''} placeholder="Размер, спицы или крючок, узор, замеры…"/></Field>
 </>}
 {form.type==='yarn'&&<>
  <div className="form-grid"><Field label="Производитель" name="manufacturer" required placeholder="Например, YarnArt"/><Field label="Линейка пряжи" name="name" required placeholder="Например, Jeans"/></div>
  <div className="color-fields"><Field label="Название / код цвета" name="color" required placeholder="Молочный, 03"/><Field label="Образец цвета" name="color_hex" type="color" defaultValue="#b4a0bd"/></div>
  <Field label="Состав" name="composition" required placeholder="Например, 55% хлопок, 45% акрил"/>
  <div className="form-grid"><Field label="Вес полного мотка, г" name="skein_weight" type="number" defaultValue={50} min="0.001" step="0.001" required/><Field label="Длина нити в мотке, м" name="skein_length" type="number" min="0.001" step="0.001" placeholder="Если известна"/></div>
  <p className="hint">После сохранения укажите, сколько этой пряжи у вас есть.</p>
 </>}
 {form.type==='receive'&&<>
  <div className="yarn-line"><span className="swatch" style={{background:form.yarn.color_hex}}/><div><strong>{form.yarn.manufacturer} {form.yarn.name}</strong><small>{form.yarn.color} · {number(form.yarn.skein_weight)} г в мотке</small></div></div>
  <div className="form-grid"><Field label="Количество"><input required type="number" step="0.001" min="0.001" value={receiveAmount} onChange={e=>setReceiveAmount(e.target.value)}/></Field><Field label="Единица"><select value={receiveUnit} onChange={e=>setReceiveUnit(e.target.value)}><option value="skeins">Мотки</option><option value="grams">Граммы</option></select></Field></div>
  <p className="hint">Будет добавлено {number(Number(receiveAmount)*(receiveUnit==='skeins'?Number(form.yarn.skein_weight):1),3)} г. Для неполного мотка удобно указать вес в граммах.</p>
  <div className="form-grid"><Field label="Стоимость всего поступления, ₽" name="cost" type="number" min="0" step="0.01" placeholder="Неизвестна"/><Field label="Дата поступления" name="purchased_on" type="date" defaultValue={localDate} required/></div>
  <Field label="Партия окрашивания" name="dye_lot" placeholder="Необязательно"/><Field label="Заметка" name="note" placeholder="Покупка, подарок или начальный остаток"/>
 </>}
 {form.type==='consume'&&<>
  <p className="hint">Укажите итоговый расход на этот проект. Если вы уже внесли часть, повторно прибавлять ее не нужно.</p>
  <Field label="Пряжа"><select required value={selected} onChange={e=>setSelected(e.target.value)}>{state.yarns.map(y=><option key={y.id} value={y.id}>{y.manufacturer} {y.name} / {y.color}</option>)}</select></Field>
  <p className="hint">В банке: {number(yarn?.balance??0)} г. Уже учтено в проекте: {number(existing?.grams??0)} г.</p>
  {form.project.quantity>1&&<Field label="Расход указан"><select value={unit} onChange={e=>setUnit(e.target.value)}><option value="total">На всю партию ({form.project.quantity} шт.)</option><option value="each">На одну штуку</option></select></Field>}
  <Field key={selected+unit} label="Всего использовано, г" name="grams" type="number" min="0" step="0.001" defaultValue={Number(existing?.grams??0)/(unit==='each'?form.project.quantity:1)} required/>
  {form.project.historical?<p className="notice">Историческое изделие: остаток пряжи не изменится.</p>:<><p className="hint">Увеличение расхода спишется из банка; уменьшение вернет разницу. Поступления используются от старых к новым.</p><div className="allocation-list">{state.receipts.filter(r=>r.yarn_id===selected&&Number(r.balance)>0).map(r=><div key={r.id}><span>{r.purchased_on}{r.dye_lot?` · партия ${r.dye_lot}`:''}</span><span>{number(r.balance)} г · {r.cost===null?'цена неизвестна':`${money(Number(r.cost)/Number(r.grams))}/г`}</span></div>)}</div></>}
 </>}
 {form.type==='time'&&<>
  <p className="hint">{form.session?'Исправьте длительность. Предыдущее значение останется в истории.':'Добавьте время, если вязали без таймера.'}</p>
  {form.project.quantity>1&&!form.session&&<Field label="Время указано"><select value={unit} onChange={e=>setUnit(e.target.value)}><option value="total">На всю партию</option><option value="each">На одно изделие</option></select></Field>}
  <div className="form-grid"><Field label="Часы" name="hours" type="number" min="0" step="1" defaultValue={Math.floor(currentSeconds/3600)} required/><Field label="Минуты" name="minutes" type="number" min="0" max="59.99" step="0.01" defaultValue={Math.round(currentSeconds%3600/60*100)/100} required/></div>
  <Field label={form.session?'Причина исправления':'Заметка'} name="note" defaultValue={form.session?.note??''} required={!!form.session} placeholder="Например, довязала резинку"/>
 </>}
 {form.type==='adjust'&&<><p className="hint">Введите фактический вес остатка этого поступления после взвешивания. Сейчас в учете {number(form.receipt.balance)} г.</p><Field label="Фактический остаток, г" name="target" type="number" min="0" step="0.001" defaultValue={form.receipt.balance} required/><Field label="Причина" name="reason" required placeholder="Например, взвесила остаток"/></>}
 {form.type==='settings'&&<><Field label="Стоимость часа по умолчанию, ₽" name="rate" type="number" min="0" step="0.01" defaultValue={state.profile.hourly_rate} required/><p className="hint">Применяется к новым проектам. Ставки существующих работ сохраняются.</p><p className="hint">Часовой пояс: {state.profile.timezone}. Данные этой версии хранятся на вашем компьютере.</p><UpdatePanel/></>}
 </Modal>;
}
