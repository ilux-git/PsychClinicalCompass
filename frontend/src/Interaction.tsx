"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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

export function useInteractionMotion() {
  const reduced = useReducedMotion();
  return {
    moving: shouldAnimate(reduced),
    transition: { duration: reduced ? motionTokens.duration.instant : motionTokens.duration.normal, ease: motionTokens.easing.smooth },
  };
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
export function Disclosure({ title, children, lazy=false, reveal=false }: { title: string; children: ReactNode; lazy?:boolean;reveal?:boolean }) {
  const [open, setOpen] = useState(reveal);
  const [started,setStarted]=useState(!lazy||reveal);
  const content=useRef<HTMLDivElement>(null);
  const id = useId();
  const { moving, transition } = useInteractionMotion();
  useEffect(()=>{
    if(!reveal)return;
    setStarted(true);setOpen(true);
  },[reveal]);
  useEffect(()=>{if(reveal&&open)content.current?.querySelector<HTMLElement>('textarea,input,select')?.focus();},[reveal,open]);
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
