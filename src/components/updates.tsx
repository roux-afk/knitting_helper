'use client';
import {useEffect,useState} from 'react';
import {Download,LoaderCircle,RefreshCw,RotateCw} from 'lucide-react';

export type UpdateState={status:'idle'|'checking'|'none'|'available'|'downloading'|'downloaded'|'error'|'unsupported';current:string;version:string|null;notes:string;percent:number;error:string};
type Bridge={get():Promise<UpdateState>;check():Promise<UpdateState>;download():Promise<UpdateState>;install():Promise<UpdateState>;openReleases():Promise<void>;onChange(cb:(s:UpdateState)=>void):()=>void;onOpen(cb:()=>void):()=>void};
declare global{interface Window{petelka?:{updates:Bridge}}}

// The bridge exists only inside the desktop app; in a plain browser the panel is hidden.
export function useUpdates(onOpen?:()=>void){
 const [state,setState]=useState<UpdateState|null>(null);
 useEffect(()=>{
  const bridge=window.petelka?.updates;if(!bridge)return;
  bridge.get().then(setState).catch(()=>{});
  const offChange=bridge.onChange(setState);const offOpen=onOpen?bridge.onOpen(onOpen):()=>{};
  return()=>{offChange();offOpen();};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return state;
}

export default function UpdatePanel(){
 const state=useUpdates();const bridge=typeof window==='undefined'?undefined:window.petelka?.updates;
 if(!state||!bridge)return null;
 const run=(action:()=>Promise<unknown>)=>()=>{action().catch(()=>{});};
 return <section className="update-panel" aria-label="Обновления">
  <h3>Обновления</h3>
  <p className="hint">Установлена версия {state.current}.</p>
  {state.status==='checking'&&<p className="update-line"><LoaderCircle className="spinner" size={16}/>Проверяю наличие обновлений…</p>}
  {state.status==='none'&&<p className="update-line">Установлена последняя версия.</p>}
  {state.status==='available'&&<><p className="update-line"><strong>Доступна версия {state.version}.</strong></p>{state.notes&&<pre className="update-notes">{state.notes}</pre>}</>}
  {state.status==='downloading'&&<><p className="update-line">Скачиваю версию {state.version}… {state.percent}%</p><progress max={100} value={state.percent}/></>}
  {state.status==='downloaded'&&<p className="update-line">Версия {state.version} скачана. Перед установкой будет сохранена резервная копия мастерской, затем приложение перезапустится.</p>}
  {state.status==='unsupported'&&<p className="update-line">Автоматическое обновление работает в установленной версии для Windows. Здесь можно открыть страницу выпусков.</p>}
  {state.error&&<p className="form-error" role="alert">{state.error}</p>}
  <div className="update-actions">
   {['idle','none','error'].includes(state.status)&&<button type="button" className="button secondary" onClick={run(bridge.check)}><RefreshCw size={16}/>Проверить обновления</button>}
   {state.status==='available'&&<button type="button" className="button primary" onClick={run(bridge.download)}><Download size={16}/>Скачать обновление</button>}
   {state.status==='downloaded'&&<button type="button" className="button primary" onClick={run(bridge.install)}><RotateCw size={16}/>Установить и перезапустить</button>}
   {state.status==='unsupported'&&<button type="button" className="button secondary" onClick={run(bridge.openReleases)}>Открыть страницу выпусков</button>}
  </div>
 </section>;
}
