import { useEffect, useRef, useState } from "react";
import { Compass, X } from "lucide-react";
import type { User } from "./api";
import { Button } from "./UI";
import { keepDialogFocus } from "./Interaction";
import { defaultView, sectionFor, type GuideSection } from "./navigation";

export function RoleGuide({user,view,navigate,startSignal,context}:{user:User;view:string;navigate:(view:string)=>void;startSignal:number;context?:GuideSection}) {
  const storageKey=`compass-guide-v2-${user.id}-${user.role}`;
  const [hidden,setHidden]=useState(()=>{try{return localStorage.getItem(storageKey)==="seen";}catch{return false;}});
  const [open,setOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const previousFocus=useRef<HTMLElement|null>(null);
  const section=context??sectionFor(user.role,view);
  useEffect(()=>{if(startSignal)setOpen(true);},[startSignal]);
  useEffect(()=>{const closeForHistory=()=>setOpen(false);window.addEventListener("popstate",closeForHistory);return()=>window.removeEventListener("popstate",closeForHistory);},[]);
  useEffect(()=>{
    if(open&&!dialog.current?.open){previousFocus.current=document.activeElement as HTMLElement;dialog.current?.showModal();}
    if(!open&&dialog.current?.open){dialog.current.close();previousFocus.current?.focus({preventScroll:true});}
  },[open]);
  function dismiss(){setHidden(true);try{localStorage.setItem(storageKey,"seen");}catch{/* Optional preference. */}}
  function close(){setOpen(false);dismiss();}
  return <>
    {!hidden&&<section className="navigation-welcome" aria-label="Первое знакомство">
      <Compass size={21} aria-hidden="true"/><p><strong>Навигация по кабинету.</strong> Кнопка «Помощь» объяснит текущий раздел и доступные действия.</p>
      <Button variant="ghost" onClick={()=>setOpen(true)}>Открыть инструкцию</Button>
      <button type="button" className="icon-button" aria-label="Скрыть приветствие" onClick={dismiss}><X size={17}/></button>
    </section>}
    <dialog ref={dialog} className="navigation-help" aria-labelledby="navigation-help-title" onKeyDown={keepDialogFocus} onCancel={event=>{event.preventDefault();close();}}>
      <div className="section-heading"><p className="eyebrow">Помощь с разделом</p><button type="button" className="icon-button" aria-label="Закрыть помощь" onClick={close}><X size={20}/></button></div>
      <h2 id="navigation-help-title">{section.title}</h2><p className="muted">{section.description}</p>
      <ol>{section.steps.map((step,index)=><li key={step}><span aria-hidden="true">{index+1}</span><p>{step}</p></li>)}</ol>
      <div className="button-row"><Button onClick={close}>Понятно</Button>{view!==defaultView(user.role)&&<Button variant="secondary" onClick={()=>{close();navigate(defaultView(user.role));}}>На главную</Button>}</div>
    </dialog>
  </>;
}
