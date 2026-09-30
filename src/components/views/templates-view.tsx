'use client';
import {BookOpen,Plus} from 'lucide-react';
import {Empty} from '../primitives';
import {useWorkshop} from '../workshop-context';

export default function TemplatesView(){
 const {state,open}=useWorkshop();
 return state.templates.length?<div className="template-grid">{state.templates.map(t=><article className="panel template-card" key={t.id}><BookOpen size={24}/><small>{t.category}</small><h2>{t.title}</h2><p>{t.notes||'Модель для нового проекта'}</p><button className="button secondary" onClick={()=>open({type:'project',template:t})}><Plus size={16}/>Начать проект</button></article>)}</div>:<Empty title="Удачные модели стоит сохранить" description="Откройте карточку проекта и нажмите «Сохранить как шаблон». Следующее изделие начнется с готового описания."/>;
}
