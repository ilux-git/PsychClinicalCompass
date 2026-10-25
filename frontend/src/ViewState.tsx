import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";

export type ReturnPoint={scope:string;key:string};
export type PatientAnswerTarget={assignmentId:number;submissionId:number;questionId:string};
type ViewContext={values:MutableRefObject<Map<string,unknown>>;returnPoint:ReturnPoint|null;restored:()=>void};
const Context=createContext<ViewContext|null>(null);

/** In-memory filters and cursors only. The provider is recreated on sign-out/user change. */
export function ViewStateProvider({children,returnPoint,restored}:{children:ReactNode;returnPoint:ReturnPoint|null;restored:()=>void}) {
  const values=useRef(new Map<string,unknown>());
  return <Context.Provider value={{values,returnPoint,restored}}>{children}</Context.Provider>;
}

export function useViewState<T>(key:string,initial:T) {
  const values=useContext(Context)?.values;
  const [value,setValue]=useState<T>(()=>values?.current.has(key)?values.current.get(key) as T:initial);
  useEffect(()=>{values?.current.set(key,value);},[key,value,values]);
  return [value,setValue] as const;
}

/** Prepare UI-only filters before navigation unmounts the source page. Not a live state bus. */
export function usePrepareViewState() {
  const values=useContext(Context)?.values;
  return useCallback((entries:Record<string,unknown>)=>{
    for(const [key,value] of Object.entries(entries))values?.current.set(key,value);
  },[values]);
}

/** Restore the source control after its fresh, authorized list has rendered. */
export function useReturnFocus(scope:string,ready:boolean) {
  const context=useContext(Context);
  const point=context?.returnPoint;
  const restored=context?.restored;
  useLayoutEffect(()=>{
    if(!ready||!point||point.scope!==scope||!restored)return;
    const active=document.activeElement;
    if(active&&active!==document.body&&active.id!=="compass-main") {restored();return;}
    const control=[...document.querySelectorAll<HTMLElement>('[data-return-key]')].find(element=>element.dataset.returnKey===point.key&&element.getClientRects().length&&!element.closest('[inert],[hidden]')&&getComputedStyle(element).visibility!=="hidden");
    if(control)control.focus();
    else {document.getElementById("compass-main")?.focus({preventScroll:true});window.scrollTo(0,0);}
    restored();
  },[scope,ready,point,restored]);
}
