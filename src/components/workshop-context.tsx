'use client';
import {createContext,useContext} from 'react';
import type {Project,Session,State} from '@/lib/models';
import type {FormKind} from './forms';

export type Tab='projects'|'yarn'|'finished'|'templates'|'import';
export interface Workshop{
 state:State;busy:boolean;tab:Tab;
 active:Session|undefined;activeSeconds:number;
 filter:string;setFilter:(value:string)=>void;search:string;setSearch:(value:string)=>void;
 open:(form:FormKind)=>void;
 act:(command:Record<string,unknown>,message?:string)=>Promise<{id?:string}|undefined>;
 navigate:(tab:Tab)=>void;selectProject:(id:string|null)=>void;selectYarn:(id:string|null)=>void;
 upload:(file:File,project:Project)=>Promise<void>;
}
export const WorkshopContext=createContext<Workshop|null>(null);
export function useWorkshop(){
 const value=useContext(WorkshopContext);
 if(!value)throw Error('useWorkshop must be used inside the studio');
 return value;
}
