"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, domAnimation, LazyMotion, m, MotionConfig, useIsPresent, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronUp } from "lucide-react";

export const motionTokens = {
  duration: { instant: 0.08, fast: 0.12, normal: 0.2 },
  easing: { smooth: [0.22, 1, 0.36, 1] as const },
  distance: { small: 4, medium: 8 },
  scale: { press: 0.985 },
};

export function shouldAnimate(prefersReduced: boolean | null) {
  return !prefersReduced;
}

/** Keep keyboard navigation inside a native modal, including while controls change. */
export function keepDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab" || !event.currentTarget.open) return;
  const dialog = event.currentTarget;
  const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
    .filter(control => control.tabIndex >= 0 && !control.closest('[inert],[hidden],[aria-hidden="true"]') && control.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first || document.activeElement === dialog || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}

export function useInteractionMotion() {
  const reduced = useReducedMotion();
  return {
    moving: shouldAnimate(reduced),
    transition: { duration: reduced ? motionTokens.duration.instant : motionTokens.duration.normal, ease: motionTokens.easing.smooth },
  };
}

/** A disabled native select loses focus; preserve a later deliberate focus change. */
export function usePendingSelectFocus(pending:boolean) {
  const ref=useRef<HTMLSelectElement>(null),restore=useRef(false);
  useEffect(()=>{
    if(pending||!restore.current)return;
    restore.current=false;
    if(document.activeElement===document.body||document.activeElement===ref.current)ref.current?.focus({preventScroll:true});
  },[pending]);
  return {ref,remember:()=>{restore.current=document.activeElement===ref.current;}};
}

export function InteractionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation} strict><MotionConfig reducedMotion="user">{children}</MotionConfig></LazyMotion>;
}

/** Exit content is immediately inert: old forms cannot submit during a transition. */
export function ContentFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { moving, transition } = useInteractionMotion();
  const present = useIsPresent();
  return <m.div className={`content-frame ${className}`} inert={!present} aria-hidden={!present || undefined}
    initial={{ opacity: 0, y: moving ? motionTokens.distance.small : 0 }}
    animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={transition}>
    {children}
  </m.div>;
}

/** Keep the child mounted when collapsed so reopening does not discard a form. */
export function Disclosure({ title, children, lazy=false, reveal=false, revealRequest=0, focusTarget }: { title: string; children: ReactNode; lazy?:boolean;reveal?:boolean;revealRequest?:number;focusTarget?:string }) {
  const [open, setOpen] = useState(reveal||revealRequest>0);
  const [started,setStarted]=useState(!lazy||reveal||revealRequest>0);
  const content=useRef<HTMLDivElement>(null);
  const id = useId();
  const { moving, transition } = useInteractionMotion();
  useEffect(()=>{
    if(!reveal&&!revealRequest)return;
    setStarted(true);setOpen(true);
  },[reveal,revealRequest]);
  useEffect(()=>{
    if((!reveal&&!revealRequest)||!open)return;
    const visible=(element:HTMLElement)=>!element.closest("[inert]")&&!element.matches(":disabled");
    const preferred=focusTarget?content.current?.querySelector<HTMLElement>(focusTarget):null;
    const control=preferred&&visible(preferred)?preferred:[...content.current?.querySelectorAll<HTMLElement>("textarea,input,select")??[]].find(visible);
    const fallback=[...content.current?.querySelectorAll<HTMLElement>('[tabindex="-1"]')??[]].find(visible);
    const button=[...content.current?.querySelectorAll<HTMLElement>("button")??[]].find(visible);
    (control??fallback??button)?.focus();
  },[reveal,revealRequest,open,focusTarget]);
  return <div className="disclosure">
    <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={() => {setStarted(true);setOpen(value => !value);}}>
      <span>{title}</span><m.span aria-hidden="true" animate={{ rotate: moving && open ? 180 : 0 }} transition={transition}>{open&&!moving?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</m.span>
    </button>
    <div id={id} className="disclosure-grid" inert={!open} aria-hidden={!open || undefined}
      style={{gridTemplateRows:open?"1fr":"0fr",transition:moving?`grid-template-rows ${motionTokens.duration.normal}s cubic-bezier(${motionTokens.easing.smooth.join(",")})`:"none"}}>
      <m.div ref={content} className="disclosure-reveal" initial={false} animate={{opacity:open?1:0,y:open||!moving?0:motionTokens.distance.small}} transition={transition}>
        <div className="disclosure-content">{started&&children}</div>
      </m.div>
    </div>
  </div>;
}

export { AnimatePresence, m };
