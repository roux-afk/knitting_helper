'use client';
import {useEffect,useRef,type FormEvent,type ReactNode,type CSSProperties} from 'react';
import {X} from 'lucide-react';
export const number=(value:number|string,maximumFractionDigits=1)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits}).format(Number(value));
export const money=(value:number|string)=>`${number(value,2)} ₽`;
export const duration=(seconds:number)=>`${Math.floor(seconds/3600)} ч ${Math.floor(seconds%3600/60)} мин`;
export const clock=(seconds:number)=>`${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds%3600/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
export const dateLabel=(value:string|null)=>value?new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'}):'Не указана';
export const statusLabels:Record<string,string>={planned:'В планах',active:'В работе',paused:'На паузе',completed:'Готово',cancelled:'Отменен'};
export const purposeLabels:Record<string,string>={self:'Для себя',gift:'В подарок',sale:'На продажу'};
export const categories=['Шапка','Шарф','Сумка','Одежда','Аксессуар','Для дома','Другое'];
export function Skein({color='#9c89b0',className=''}:{color?:string;className?:string}){
 return <svg className={className} viewBox="0 0 180 140" aria-hidden="true" style={{'--thread':color} as CSSProperties}><g fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"><ellipse cx="85" cy="68" rx="51" ry="48" fill={color} fillOpacity=".13"/><path d="M44 39c30-10 67 26 75 60M38 47c33-10 72 30 75 59M35 57c30-9 66 25 72 55M36 68c27-7 50 16 63 47M40 81c20-4 41 12 48 34M53 29c-4 30 26 49 73 48M63 24c-3 27 25 43 69 42M76 21c0 24 19 33 58 34M89 22c4 17 18 23 41 22M48 99c-2-27 22-47 56-69M58 108c0-19 7-26 21-38M70 113c-2-14 5-21 13-27M132 86c35-2 17 26 6 26-16 0-6-17 3-13 13 6 7 26 26 23"/></g></svg>;
}
export function Modal({title,children,onClose,onSubmit,busy,error,submitLabel='Сохранить'}:{title:string;children:ReactNode;onClose:()=>void;onSubmit?:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean;error:string;submitLabel?:string}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close();},[]);
 return <dialog className="modal" ref={ref} onCancel={e=>{if(busy)e.preventDefault();else onClose();}} aria-label={title}>
 <form onSubmit={onSubmit}><header><h2>{title}</h2><button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={20}/></button></header>
 <div className="modal-body">{children}{error&&<p className="form-error" role="alert">{error}</p>}</div>
 <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button>{onSubmit&&<button className="button primary" disabled={busy}>{busy?'Сохраняю…':submitLabel}</button>}</footer></form></dialog>;
}
export function Field({label,name,defaultValue='',type='text',required=false,step,min,max,placeholder,children}:{label:string;name?:string;defaultValue?:string|number;type?:string;required?:boolean;step?:string;min?:string;max?:string;placeholder?:string;children?:ReactNode}){
 return <label className="field"><span>{label}</span>{children??<input name={name} defaultValue={defaultValue} type={type} required={required} step={step} min={min} max={max} placeholder={placeholder}/>}</label>;
}
export function Empty({title,description,children}:{title:string;description:string;children?:ReactNode}){
 return <div className="empty"><Skein/><h2>{title}</h2><p>{description}</p>{children}</div>;
}
