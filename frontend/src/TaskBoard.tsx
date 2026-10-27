import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { useApi } from "./api";
import {clinicTimeZone} from "./clinicTime";
import { TaskItem, type CareTask, type TaskChange } from "./CareWorkflow";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, plural, type Notify } from "./UI";
import { Disclosure } from "./Interaction";
import { useNavigationGuard } from "./NavigationGuard";
import { useReturnFocus, useViewState } from "./ViewState";
import { taskInWorklist, worklistAfterChange, worklistChoices, worklistViewKey, type WorklistFocus } from "./worklist";

type Page = {stage: string; total: number; next_cursor: number | null; items: CareTask[];as_of?:string};
const stages = [{id: "open", label: "Назначено", hint: "Следующие действия"},
  {id: "in_progress", label: "В работе", hint: "Исполнитель начал действие"},
  {id: "done", label: "Завершено", hint: "Действие выполнено; эффект проверяет врач"}];

function Column({stage, query, operational, changed, notify, openPatient, revision, active, focusedTask,focused,onTotal,clearFocus,focus="all"}: {
  stage: typeof stages[number]; query: string; operational: boolean; changed: (change?:TaskChange) => void;
  notify: Notify; openPatient?: (id: number,returnKey?:string) => void;
  revision:number; active:boolean;focusedTask:number|null;focused?:CareTask;onTotal:(stage:string,query:string,total:number)=>void;clearFocus:()=>void;
  focus?:WorklistFocus;
}) {
  const guard=useNavigationGuard();
  const scope=`task-column:${stage.id}`;
  const column=useRef<HTMLElement>(null),pageHeading=useRef<HTMLHeadingElement>(null);
  const pageChange=useRef({pending:false,height:0});
  const queryKey=focus==="all"?query:`${focus}:${query}`;
  const [pagination,setPagination]=useViewState<{query:string;cursors:number[]}>(`board-${operational?"coordinator":"doctor"}-${stage.id}-pagination`,{query:queryKey,cursors:[]});
  const cursors=pagination.query===queryKey?pagination.cursors:[];
  function setCursors(update:(current:number[])=>number[]) {setPagination(current=>({query:queryKey,cursors:update(current.query===queryKey?current.cursors:[])}));}
  useEffect(()=>{if(pagination.query!==queryKey)setPagination({query:queryKey,cursors:[]});},[queryKey,pagination.query,setPagination]);
  const [dirtyTasks,setDirtyTasks]=useState<Set<number>>(()=>new Set());
  const remembered=useRef(new Map<number,CareTask>());
  const editing=useCallback((id:number,dirty:boolean)=>setDirtyTasks(current=>{
    if(current.has(id)===dirty)return current;
    const next=new Set(current);if(dirty)next.add(id);else next.delete(id);return next;
  }),[]);
  const cursor = cursors.at(-1);
  const page = useApi<Page>(`/coordination/board?stage=${stage.id}&q=${encodeURIComponent(query)}${focus!=="all"?`&focus=${focus}`:""}${cursor ? `&before=${cursor}` : ""}`,0,revision);
  const paging=pageChange.current.pending&&!page.data&&!page.error;
  function turnPage(update:(current:number[])=>number[]) {
    guard.runFor(()=>{
      pageChange.current={pending:true,height:column.current?.getBoundingClientRect().height??0};
      clearFocus();setCursors(update);
    },scope);
  }
  useLayoutEffect(()=>{
    if(!pageChange.current.pending||(!page.data&&!page.error))return;
    pageChange.current.pending=false;
    const target=page.data?pageHeading.current:column.current?.querySelector<HTMLElement>('[role="alert"]');
    target?.focus({preventScroll:true});target?.scrollIntoView({block:"start"});
  },[page.data,page.error]);
  const pageRows=page.data?.items??[];
  const pinned=focused&&(stage.id==="all"||focused.status===stage.id)&&taskInWorklist(focused,focus,page.data?.as_of)&&!pageRows.some(task=>task.id===focused.id)?focused:undefined;
  const currentRows=pinned?[pinned,...pageRows]:pageRows;
  const detachedRows=[...dirtyTasks].filter(id=>!currentRows.some(task=>task.id===id)).flatMap(id=>remembered.current.has(id)?[remembered.current.get(id)!]:[]);
  useEffect(()=>{
    for(const task of currentRows)remembered.current.set(task.id,task);
    for(const id of remembered.current.keys())if(!dirtyTasks.has(id)&&!currentRows.some(task=>task.id===id))remembered.current.delete(id);
  },[page.data,dirtyTasks,focused]);
  useEffect(()=>{if(page.data)onTotal(stage.id,queryKey,page.data.total);},[page.data?.total,stage.id,queryKey,onTotal]);
  return <section ref={column} className={`board-column board-${stage.id} ${active?"is-active":""}`} aria-label={stage.label} style={paging?{minHeight:pageChange.current.height}:undefined} aria-busy={paging||undefined}>
    <header><h2 ref={pageHeading} tabIndex={-1}>{stage.label} <Badge>{page.data?.total ?? "…"}</Badge></h2><p>{stage.hint}</p></header>
    <ErrorBox message={page.error} retry={page.reload} />
    {page.error&&!page.data&&cursors.length>0&&<Button variant="secondary" onClick={()=>turnPage(current=>current.slice(0,-1))}>К предыдущей странице</Button>}
    {page.loading||paging ? <Loading /> : page.data && <>
      {!currentRows.length && !detachedRows.length && <Empty title={query ? "Совпадений нет" : worklistChoices.find(item=>item.id===focus)?.empty??"Задач пока нет"} />}
      {[...currentRows,...detachedRows].map(task => <article className="board-card" key={task.id} aria-label={`${task.patient_name??"Пациент"} · ${task.title}`}>
        {detachedRows.some(row=>row.id===task.id)&&<Badge tone="warn">Задача переместилась · черновик сохранён</Badge>}
        {pinned?.id===task.id&&<Badge tone="muted">Открыта отдельно от текущей страницы</Badge>}
        <div className="section-heading"><strong>{task.patient_name}</strong>
          {openPatient && <button className="icon-button" aria-label={`Карточка: ${task.patient_name}`} data-return-key={`task-${task.id}`} onClick={() => openPatient(task.patient_id,`task-${task.id}`)}><ArrowRight size={17}/></button>}
        </div>
        <h3>{task.title}</h3>
        {stage.id==="all"&&<Badge tone="muted">{stages.find(item=>item.id===task.status)?.label??task.status}</Badge>}
        {task.due_at && <p className={task.status !== "done" && Date.parse(task.due_at) < Date.now() ? "deadline-overdue" : "field-hint"}>Срок: {new Date(task.due_at).toLocaleString("ru-RU",{timeZone:clinicTimeZone})}</p>}
        {task.status === "done" && <Badge tone="muted">{task.verification_status === "pending" ? "Ожидает проверки результата" : task.verification_status === "resolved" ? "Проверено: устранено" : task.verification_status === "not_resolved" ? "Проверено: сохраняется" : "Проверено: результат неизвестен"}</Badge>}
        <Disclosure reveal={task.id===focusedTask} title={task.status === "open" ? "Принять и выполнить" : task.status === "in_progress" ? "Сохранить действие" : "Действие и проверка"}>
          <TaskItem task={task} operational={operational} reload={changed} notify={notify} scope={scope} autoFocus={task.id===focusedTask} onEditing={editing} embedded detached={detachedRows.some(row=>row.id===task.id)}/>
        </Disclosure>
      </article>)}
      {stage.id==="all"&&<p className="field-hint">На странице: {pageRows.length} из {page.data.total}. Сначала новые задачи.{page.data.as_of&&` Срез: ${new Date(page.data.as_of).toLocaleString("ru-RU",{timeZone:clinicTimeZone})}.`}</p>}
      <div className="board-pagination"><Button variant="ghost" disabled={!cursors.length} onClick={() => turnPage(prev => prev.slice(0,-1))}>Назад</Button>
        <span>Страница {cursors.length + 1}</span><Button variant="ghost" disabled={!page.data.next_cursor} onClick={() => turnPage(prev => [...prev, page.data!.next_cursor!])}>Далее</Button></div>
    </>}
  </section>;
}

export function TaskBoard({notify, openPatient, operational = false, choosePatient}: {
  notify: Notify; openPatient?: (id: number,returnKey?:string) => void; operational?: boolean; choosePatient?: () => void;
}) {
  const viewKey=operational?"coordinator-board":"doctor-board";
  const [search, setSearch] = useViewState(`${viewKey}-search`,""), [query, setQuery] = useViewState(`${viewKey}-query`,"");
  const [revision, setRevision] = useState(0);
  const [activeStage,setActiveStage] = useViewState(`${viewKey}-stage`,'open');
  const [focus,setFocus]=useViewState<WorklistFocus>(worklistViewKey,"all");
  const effectiveFocus=operational?"all":focus;
  const queryKey=effectiveFocus==="all"?query:`${effectiveFocus}:${query}`;
  const [focusedTask,setFocusedTask]=useViewState<number|null>(`${viewKey}-focus`,null);
  const focused=useApi<CareTask>(focusedTask?`/tasks/${focusedTask}`:null,0,revision);
  const [totals,setTotals]=useState<Record<string,{query:string;total:number}>>({});
  const onTotal=useCallback((stage:string,query:string,total:number)=>setTotals(current=>current[stage]?.query===query&&current[stage].total===total?current:{...current,[stage]:{query,total}}),[]);
  const ready=effectiveFocus==="all"?stages.every(stage=>totals[stage.id]?.query===query):totals.all?.query===queryKey;
  useReturnFocus("tasks",ready&&search.trim()===query);
  const total=ready?(effectiveFocus==="all"?stages.reduce((sum,stage)=>sum+totals[stage.id].total,0):totals.all.total):0;
  const guard=useNavigationGuard();
  function changed(change?:TaskChange) {
    if(change){setFocusedTask(change.id);setActiveStage(change.stage);if(!operational)setFocus(current=>worklistAfterChange(current,change));}
    setRevision(value=>value+1);
  }
  useEffect(() => {const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer);}, [search]);
  return <>
    <Heading eyebrow={operational ? "Организационная поддержка" : "Рабочий план врача"} title={operational ? "Мои задачи" : "План работы"}/>
    {!operational&&<div className="worklist-choices" role="group" aria-label="Рабочие выборки">{worklistChoices.map(item=><button type="button" key={item.id} aria-pressed={effectiveFocus===item.id} onClick={()=>guard.run(()=>{setFocus(item.id);setFocusedTask(null);} )}>{item.label}</button>)}</div>}
    {operational&&<figure className="stage-distribution" aria-label={ready?`Мои поручения: ${stages.map(stage=>`${stage.label} ${totals[stage.id].total}`).join(', ')}`:"Получаем этапы поручений"}>
      <figcaption><span>{query?"Поручения по поиску":"Мои поручения"}</span><strong>{ready?`${total} ${plural(total,"задача","задачи","задач")}`:"Получаем…"}</strong></figcaption>
      <div className="stage-distribution-track" aria-hidden="true">{ready&&stages.map(stage=><span className={`stage-segment stage-${stage.id}`} key={stage.id} style={{width:`${total?totals[stage.id].total/total*100:0}%`}}/>)}</div>
      <div className="stage-distribution-legend" aria-hidden="true">{stages.map(stage=><span key={stage.id}><i className={`stage-segment stage-${stage.id}`}/>{stage.label}: {totals[stage.id]?.query===query?totals[stage.id].total:"…"}</span>)}</div>
    </figure>}
    <div className="board-toolbar"><label className="search-field"><Search size={18}/><input aria-label="Поиск задачи или пациента" placeholder="Пациент или задача…" value={search} onChange={e => {const value=e.target.value;guard.run(()=>{setSearch(value);setFocusedTask(null);});}}/></label>
      {choosePatient && <Button onClick={choosePatient}>Выбрать пациента</Button>}<Button variant="secondary" onClick={() => setRevision(v => v+1)}>Обновить</Button></div>
    {effectiveFocus==="all"&&<div className="board-view-tabs" role="tablist" aria-label="Этап задач">{stages.map((stage,index)=><button key={stage.id} role="tab" aria-selected={stage.id===activeStage} tabIndex={stage.id===activeStage?0:-1} onClick={()=>setActiveStage(stage.id)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%stages.length:event.key==='ArrowLeft'?(index+stages.length-1)%stages.length:null;if(next!==null){event.preventDefault();setActiveStage(stages[next].id);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();}}}>{stage.label}<span className="stage-count">{totals[stage.id]?.query===query?totals[stage.id].total:"…"}</span></button>)}</div>}
    <ErrorBox message={focused.error} retry={focused.reload}/>
    <p className="board-search-status" role="status">{search.trim()!==query?"Обновляем результаты поиска…":query?"Показаны задачи по Вашему запросу":""}</p>
    <div className={`task-board${effectiveFocus!=="all"?" is-worklist":""}`} aria-busy={search.trim()!==query} inert={search.trim()!==query}>{(effectiveFocus==="all"?stages:[{id:"all",label:worklistChoices.find(item=>item.id===effectiveFocus)!.label,hint:worklistChoices.find(item=>item.id===effectiveFocus)!.hint}]).map(stage => <Column key={`${stage.id}-${query}-${effectiveFocus}`} stage={stage} focus={effectiveFocus} query={query} operational={operational} notify={notify} changed={changed} openPatient={openPatient} revision={revision} active={effectiveFocus!=="all"||activeStage===stage.id} focusedTask={focusedTask} focused={focused.data} onTotal={onTotal} clearFocus={()=>setFocusedTask(null)}/>)}</div>
  </>;
}
