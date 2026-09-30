'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,BookOpen,CheckCheck,Download,LayoutGrid,LoaderCircle,Pause,Plus,Settings2,Spool,SquarePen,X} from 'lucide-react';
import Forms,{type FormKind} from './forms';
import {clock,purposeLabels,Skein} from './primitives';
import type {State,Project} from '@/lib/models';
import ImportPanel from './import-panel';
import {useUpdates} from './updates';
import {WorkshopContext,type Tab} from './workshop-context';
import {ProjectList,ProjectsOverview} from './views/project-list';
import ProjectDetail from './views/project-detail';
import {YarnDetail,YarnList} from './views/yarn-views';
import TemplatesView from './views/templates-view';

const tabs:[Tab,string,typeof LayoutGrid][]=[['projects','Мои проекты',LayoutGrid],['yarn','Банк пряжи',Spool],['finished','Готовые изделия',CheckCheck],['templates','Шаблоны',BookOpen],['import','Импорт Excel',Download]];
export default function Studio(){
 const [state,setState]=useState<State|null>(null);const [loadError,setLoadError]=useState('');
 const [tab,setTab]=useState<Tab>('projects');const [selected,setSelected]=useState<string|null>(null);const [selectedYarn,setSelectedYarn]=useState<string|null>(null);
 const [filter,setFilter]=useState('all');const [search,setSearch]=useState('');const [form,setForm]=useState<FormKind|null>(null);
 const [error,setError]=useState('');const [toast,setToast]=useState('');const [busy,setBusy]=useState(false);const [now,setNow]=useState(Date.now());const offset=useRef(0);const keys=useRef(new Map<string,string>());
 const updates=useUpdates(()=>{setError('');setForm({type:'settings'});});
 const refresh=useCallback(async()=>{
  const response=await fetch('/api/state',{cache:'no-store'});const data=await response.json();
  if(!response.ok)throw Error(data.error);offset.current=Date.parse(data.serverNow)-Date.now();setState(data);setLoadError('');
 },[]);
 useEffect(()=>{refresh().catch(e=>setLoadError(e.message));const timer=setInterval(()=>refresh().catch(()=>{}),15000);const tick=setInterval(()=>setNow(Date.now()),1000);return()=>{clearInterval(timer);clearInterval(tick);};},[refresh]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(timer);},[toast]);
 function open(value:FormKind){setError('');setForm(value);}
 async function command(value:Record<string,unknown>){
  const body=JSON.stringify(value);let key=keys.current.get(body);if(!key){key=crypto.randomUUID();keys.current.set(body,key);}
  const response=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,command:value})});
  const data=await response.json();if(!response.ok){if(response.status<500)keys.current.delete(body);throw Error(data.error+(data.details?' '+data.details.join('; '):''));}
  await refresh();keys.current.delete(body);return data as {id?:string};
 }
 async function act(value:Record<string,unknown>,message='Сохранено'){
  if(busy)return;setBusy(true);setError('');try{const result=await command(value);setToast(message);return result;}catch(e){setToast(e instanceof Error?e.message:'Не удалось сохранить. Повторите действие.');}finally{setBusy(false);}
 }
 async function save(value:Record<string,unknown>){
  setBusy(true);setError('');try{
   const result=await command(value);setForm(null);setToast('Сохранено');
   if(value.type==='project.create'){setTab('projects');setSelected(result.id!);}
   if(value.type==='yarn.create'){setTab('yarn');setSelectedYarn(result.id!);setToast('Пряжа добавлена. Теперь пополните запас.');}
  }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить. Повторите действие.');}finally{setBusy(false);}
 }
 function navigate(next:Tab){setTab(next);setSelected(null);setSelectedYarn(null);setSearch('');setFilter('all');}
 const active=state?.sessions.find(s=>s.started_at&&!s.ended_at);
 const activeProject=state?.projects.find(p=>p.id===active?.project_id);
 const activeSeconds=active?Math.max(0,Math.floor((now+offset.current-Date.parse(active.started_at!))/1000)):0;
 const current=state?.projects.find(p=>p.id===selected);
 const yarn=state?.yarns.find(y=>y.id===selectedYarn);
 const headerTitle=current?.title??yarn?.name??({projects:'Мои проекты',yarn:'Банк пряжи',finished:'Готовые изделия',templates:'Шаблоны',import:'Импорт Excel'}[tab]);
 async function upload(file:File,p:Project){
  setBusy(true);try{
   const body=new FormData();body.set('file',file);body.set('project_id',p.id);
   const response=await fetch('/api/photos',{method:'POST',body});const data=await response.json();if(!response.ok)throw Error(data.error);await refresh();setToast('Фотография добавлена');
  }catch(e){setToast(e instanceof Error?e.message:'Не удалось добавить фото');}finally{setBusy(false);}
 }
 const workshop=state?{state,busy,tab,active,activeSeconds,filter,setFilter,search,setSearch,open,act,navigate,selectProject:setSelected,selectYarn:setSelectedYarn,upload}:null;
 return <div className="studio">
 <aside className="sidebar"><a className="brand" href="/" aria-label="Петелька, главная"><img src="/icon.svg" alt=""/><span>петелька<small>моя мастерская</small></span></a><nav aria-label="Разделы мастерской">{tabs.map(([id,title,Icon])=><button key={id} className={tab===id?'nav-item selected':'nav-item'} onClick={()=>navigate(id)}><Icon size={19}/><span>{title}</span>{id==='projects'&&state&&<b>{state.projects.filter(p=>!p.archived).length}</b>}</button>)}</nav>
 <div className="sidebar-note"><Skein color="#b5a3c4"/><p>От первого мотка<br/>до последней петли.</p></div><div className="sidebar-bottom"><button className="nav-item" onClick={()=>state&&open({type:'settings'})}><Settings2 size={18}/>Настройки{(updates?.status==='available'||updates?.status==='downloaded')&&<i className="update-dot" title="Доступно обновление"/>}</button><span className="local-status"><i/> Личная мастерская</span></div></aside>
 <main>
 <div className="topline"><span>Место для ваших идей и теплых вещей</span><span className="today">{new Date(now).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</span></div>
 {active&&activeProject&&<div className="running-bar"><span className="pulse"/><button onClick={()=>{setTab('projects');setSelected(activeProject.id);}}>{activeProject.title}</button><strong>{clock(activeSeconds)}</strong><button className="icon-button" disabled={busy} aria-label="Остановить активный таймер" onClick={()=>act({type:'timer.stop',session_id:active.id},'Таймер на паузе')}><Pause size={18}/></button></div>}
 {(current||yarn)&&<button className="back-link" onClick={()=>{setSelected(null);setSelectedYarn(null);}}><ArrowLeft size={16}/> {current?'Все проекты':'Вся пряжа'}</button>}
 <header className="page-header"><div><h1>{headerTitle}</h1><p>{current?`${current.category} · ${purposeLabels[current.purpose]}${current.quantity>1?` · ${current.quantity} шт.`:''}`:yarn?`${yarn.manufacturer} · ${yarn.color}`:({projects:'Все, что вы создаете, в одном месте.',yarn:'Каждый цвет на своем месте. Каждый грамм учтен.',finished:'Вещи, в которых осталось ваше тепло.',templates:'Сохраняйте удачные модели и вяжите их снова.',import:'Сохраните историю и начните новый учет.'}[tab])}</p></div>
 {state&&!current&&!yarn&&tab!=='import'&&<button className="button primary" onClick={()=>tab==='yarn'?open({type:'yarn'}):open({type:'project'})}><Plus size={18}/>{tab==='yarn'?'Добавить пряжу':'Новый проект'}</button>}
 {current&&<button className="button secondary" onClick={()=>open({type:'project',project:current})}><SquarePen size={16}/>Редактировать</button>}
 {yarn&&<button className="button primary" onClick={()=>open({type:'receive',yarn})}><Plus size={18}/>Пополнить запас</button>}
 </header>
 {!workshop?<div className="loading-state">{loadError?<><p role="alert">{loadError}</p><button className="button secondary" onClick={()=>refresh().catch(e=>setLoadError(e.message))}>Повторить загрузку</button></>:<><LoaderCircle className="spinner"/>Открываю мастерскую…</>}</div>:<WorkshopContext.Provider value={workshop}>
 {!current&&!yarn&&tab==='projects'&&<ProjectsOverview/>}
 {!current&&!yarn&&['projects','finished'].includes(tab)&&<ProjectList/>}
 {current&&<ProjectDetail current={current}/>}
 {!yarn&&tab==='yarn'&&<YarnList/>}
 {yarn&&<YarnDetail yarn={yarn}/>}
 {tab==='templates'&&!current&&<TemplatesView/>}
 {tab==='import'&&<ImportPanel onImported={refresh}/>}
 <footer className="page-footer"><button className="text-button" onClick={()=>open({type:'settings'})}><Settings2 size={14}/>Настройки</button><a href="/api/export" download><Download size={15}/>Скачать данные и фото</a></footer>
 </WorkshopContext.Provider>}
 </main>{form&&state&&<Forms key={form.type+('project'in form?form.project?.id??'':'')} form={form} state={state} onClose={()=>{setForm(null);setError('');}} onSave={save} busy={busy} error={error}/>}{toast&&<div className="toast" role="status"><span>{toast}</span><button className="icon-button" onClick={()=>setToast('')} aria-label="Закрыть уведомление"><X size={16}/></button></div>}
 </div>;
}
