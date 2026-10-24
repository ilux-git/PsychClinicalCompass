import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./UI";
import { m, motionTokens, useInteractionMotion } from "./Interaction";

export type LeavePrompt = {eyebrow:string;title:string;message:string;stayLabel:string;discardLabel?:string};
type FormState = {dirty:boolean;pending?:boolean;prompt?:LeavePrompt;save?:()=>Promise<boolean>;scope?:string;focus?:()=>void};
const surveyPrompt:LeavePrompt={eyebrow:"Незавершённый опрос",title:"Сохранить ответы перед уходом?",message:"В форме есть несохранённые изменения. Черновик останется только у вас; врачу ответы пока не отправятся.",stayLabel:"Остаться в опросе"};
const multiplePrompt:LeavePrompt={eyebrow:"Несохранённые изменения",title:"Остаться и закончить ввод?",message:"На экране есть несколько незавершённых форм. Вернитесь к ним, чтобы сохранить или отправить данные. Переход без сохранения удалит текущий ввод.",stayLabel:"Вернуться к формам"};

const NavigationContext = createContext({
  run: (action: () => void,_keys?:string[],_prompt?:LeavePrompt) => action(),
  runFor: (action:()=>void,_scope:string) => action(),
  update: (_key:string,_state:FormState) => {},
  remove: (_key:string) => {},
});

export function NavigationGuard({ children }: { children: ReactNode }) {
  const { moving, transition } = useInteractionMotion();
  const forms = useRef(new Map<string,FormState>());
  const dialog = useRef<HTMLDialogElement>(null);
  const modalOpen = useRef(false);
  const returnFocus=useRef<(()=>void)|undefined>(undefined);
  const [saving,setSaving] = useState(false);
  const [blocked,setBlocked] = useState(false);
  const [pending, setPending] = useState<{action:()=>void;keys:string[];prompt?:LeavePrompt}|null>(null);
  const [,refresh] = useState(0);
  modalOpen.current = Boolean(pending || blocked);
  const update = useCallback((key:string,state:FormState) => {
    forms.current.set(key,state);
    if(modalOpen.current)refresh(value=>value+1);
  },[]);
  const remove = useCallback((key:string) => {
    forms.current.delete(key);
    if(modalOpen.current)refresh(value=>value+1);
  },[]);
  const run = useCallback((action: () => void,keys?:string[],prompt?:LeavePrompt) => {
    const selected=keys??[...forms.current.keys()];
    const active = selected.flatMap(key=>forms.current.has(key)?[forms.current.get(key)!]:[]);
    if(active.some(form=>form.pending))setBlocked(true);
    else if(active.some(form=>form.dirty))setPending({action,keys:selected,prompt});
    else action();
  }, []);
  const runFor=useCallback((action:()=>void,scope:string)=>run(action,[...forms.current].filter(([,form])=>form.scope===scope).map(([key])=>key)),[run]);
  const context = useMemo(()=>({run,runFor,update,remove}),[run,runFor,update,remove]);
  const active = [...forms.current.values()];
  const writing = active.some(form=>form.pending);
  const changed = pending ? pending.keys.flatMap(key=>forms.current.has(key)?[forms.current.get(key)!]:[]).filter(form=>form.dirty) : [];
  const prompt = pending?.prompt??(changed.length===1 ? changed[0].prompt??surveyPrompt : multiplePrompt);
  const saveAction = changed.length===1 ? changed[0].save : undefined;
  useEffect(() => {
    const protect = (event:BeforeUnloadEvent) => {
      if([...forms.current.values()].some(form=>form.dirty || form.pending)) {
        event.preventDefault();event.returnValue="";
      }
    };
    window.addEventListener("beforeunload",protect);
    return()=>window.removeEventListener("beforeunload",protect);
  },[]);
  useEffect(()=>{if(blocked && !writing)setBlocked(false);},[blocked,writing]);
  useEffect(() => {
    if ((pending || blocked) && !dialog.current?.open) dialog.current?.showModal();
    if (!pending && !blocked && dialog.current?.open) {dialog.current.close();returnFocus.current?.();returnFocus.current=undefined;}
  }, [pending,blocked]);
  function leave() {
    const transition=pending;
    transition?.keys.forEach(key=>forms.current.delete(key));setPending(null);transition?.action();
  }
  async function saveAndLeave() {
    if(!saveAction || saving)return;
    setSaving(true);
    try {if(await saveAction())leave();else {returnFocus.current=changed[0]?.focus;setPending(null);}} finally{setSaving(false);}
  }
  function stay() {returnFocus.current=changed[0]?.focus??active.find(form=>form.pending)?.focus;setPending(null);setBlocked(false);}
  return <NavigationContext.Provider value={context}>
    {children}
    <dialog ref={dialog} className="leave-dialog" aria-labelledby="leave-form-title"
      onCancel={event => {event.preventDefault();if(!saving)stay();}}>
      <m.div initial={false} animate={{opacity:pending||blocked?1:0,y:pending||blocked||!moving?0:motionTokens.distance.medium}} transition={transition}>
      <p className="eyebrow">{blocked?"Действие выполняется":prompt.eyebrow}</p>
      <h2 id="leave-form-title">{blocked?"Дождитесь результата":prompt.title}</h2>
      <p>{blocked?"Запрос уже отправлен. После ответа приложения можно будет перейти в другой раздел. Текущий ввод пока сохранён на экране.":prompt.message}</p>
      <div className="button-row">
        {blocked?<Button onClick={stay}>Вернуться к форме</Button>:<>
          {(saveAction || saving)&&<Button disabled={saving} onClick={saveAndLeave}>{saving?"Сохраняем…":"Сохранить и перейти"}</Button>}
          <Button variant="secondary" disabled={saving} onClick={stay}>{prompt.stayLabel}</Button>
          <Button variant="ghost" disabled={saving} onClick={leave}>{prompt.discardLabel??"Уйти без сохранения"}</Button>
        </>}
      </div>
      </m.div>
    </dialog>
  </NavigationContext.Provider>;
}

export const useNavigationGuard = () => useContext(NavigationContext);

/** Each form owns its registration: saving one cannot discard a neighbour's edits. */
export function useUnsavedForm(state:FormState) {
  const key = useId();
  const {update,remove,run} = useNavigationGuard();
  const latest = useRef(state);
  latest.current=state;
  const canSave = Boolean(state.save);
  const canFocus=Boolean(state.focus);
  useEffect(()=>{
    update(key,{...state,save:canSave?()=>latest.current.save!():undefined,focus:canFocus?()=>latest.current.focus?.():undefined});
  },[key,update,state.dirty,state.pending,state.prompt,state.scope,canSave,canFocus]);
  useEffect(()=>()=>remove(key),[key,remove]);
  const clear=useCallback(()=>remove(key),[key,remove]);
  const confirm=useCallback((action:()=>void,prompt?:LeavePrompt)=>run(action,[key],prompt),[key,run]);
  return {clear,confirm};
}
