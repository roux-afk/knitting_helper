'use client';
import {CheckCheck,ChevronRight,Clock3,FolderHeart,Plus,Search} from 'lucide-react';
import {duration,Empty,number,purposeLabels,Skein,statusLabels} from '../primitives';
import type {Project} from '@/lib/models';
import {useWorkshop} from '../workshop-context';

export function ProjectsOverview(){
 const {state,activeSeconds}=useWorkshop();
 const totalHours=state.projects.reduce((sum,p)=>sum+p.seconds,0);
 const completedCount=state.projects.filter(p=>p.status==='completed').reduce((sum,p)=>sum+p.quantity,0);
 return <div className="overview-strip"><div><span className="stat-symbol lavender"><FolderHeart size={20}/></span><span><strong>{state.projects.filter(p=>['active','paused'].includes(p.status)&&!p.archived).length}</strong><small>проектов в работе</small></span></div><div><span className="stat-symbol sage"><CheckCheck size={20}/></span><span><strong>{completedCount}</strong><small>изделий готово</small></span></div><div><span className="stat-symbol peach"><Clock3 size={20}/></span><span><strong>{number((totalHours+activeSeconds)/3600)}</strong><small>часов за вязанием</small></span></div></div>;
}
function ProjectCard({p}:{p:Project}){
 const {state,active,activeSeconds,selectProject}=useWorkshop();
 const photo=state.photos.find(photo=>photo.project_id===p.id);const use=state.usage.filter(u=>u.project_id===p.id);
 return <button className="project-card" onClick={()=>selectProject(p.id)}>
  <div className={`project-image illustration-${p.category==='Шарф'?'scarf':p.category==='Шапка'?'hat':'other'}`}>{photo?<img src={`/api/photos/${photo.id}`} alt={p.title}/>:<div className="knit-illustration"><Skein color={state.yarns.find(y=>y.id===use[0]?.yarn_id)?.color_hex??'#9880ae'}/><span>{p.category}</span></div>}<span className={`badge ${p.status}`}>{statusLabels[p.status]}</span></div>
  <div className="project-card-body"><div className="eyeline">{purposeLabels[p.purpose]}{p.quantity>1&&<span>{p.quantity} шт.</span>}</div><h3>{p.title}</h3><div className="card-footer"><span><Clock3 size={14}/>{duration(p.seconds+(active?.project_id===p.id?activeSeconds:0))}</span><span className="color-dots">{use.slice(0,4).map(u=><i key={u.yarn_id} style={{background:state.yarns.find(y=>y.id===u.yarn_id)?.color_hex}}/>)}</span></div></div>
 </button>;
}
export function ProjectList(){
 const {state,tab,filter,setFilter,search,setSearch,open,navigate}=useWorkshop();
 const filtered=state.projects.filter(p=>{
  if(tab==='finished'&&p.status!=='completed')return false;
  if(filter==='archive'?!p.archived:p.archived)return false;
  if(!['all','archive'].includes(filter)&&p.status!==filter)return false;
  return `${p.title} ${p.category}`.toLowerCase().includes(search.toLowerCase());
 });
 const filters=tab==='finished'?[['all','Все'],['archive','Архив']]:[['all','Все проекты'],['active','В работе'],['planned','В планах'],['paused','На паузе'],['archive','Архив']];
 return <>
  <div className="toolbar"><div className="filters" aria-label="Фильтр проектов">{filters.map(([value,label])=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{label}</button>)}</div><label className="search"><Search size={17}/><input aria-label="Поиск проектов" placeholder="Найти проект" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
  {filtered.length?<div className="project-grid">{filtered.map(p=><ProjectCard key={p.id} p={p}/>)}</div>:<Empty title={state.projects.length?'Пока ничего не найдено':'С чего начнем?'} description={state.projects.length?'Попробуйте другой фильтр или название.':'Добавьте первый проект — шарф, шапку или любую другую идею. Здесь будут фотографии, материалы и время вашей работы.'}>{!state.projects.length&&<><button className="button primary" onClick={()=>open({type:'project'})}><Plus size={18}/>Создать первый проект</button><button className="text-button" onClick={()=>navigate('yarn')}>Сначала разобрать пряжу <ChevronRight size={16}/></button></>}</Empty>}
 </>;
}
