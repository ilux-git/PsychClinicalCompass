import { createRequestId } from "./requestId";
import {accountName} from "./presentation";
import {clinicInputToIso} from "./clinicTime";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, send, useApi, type Question } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, plural, type Notify } from "./UI";
import { Disclosure } from "./Interaction";
import { MotivationAdvice } from "./MotivationAdvice";
import { useUnsavedForm, type LeavePrompt } from "./NavigationGuard";
import { careProgress } from "./careProgress";
import { AnswerSummary } from "./SurveyFields";
import { EmrDemo } from "./EmrDemo";

const outcomePrompt:LeavePrompt={eyebrow:"Решение врача",title:"Продолжить оформление исхода?",message:"Решение и основание ещё не сохранены. При переходе без сохранения текущий ввод будет потерян.",stayLabel:"Продолжить решение"};
const taskPrompt:LeavePrompt={eyebrow:"Новая задача",title:"Продолжить назначение задачи?",message:"Следующее действие ещё не назначено. При переходе без сохранения текущий ввод будет потерян.",stayLabel:"Продолжить задачу"};
const taskResultPrompt:LeavePrompt={eyebrow:"Работа с задачей",title:"Продолжить описание действия?",message:"Описание действия или основание повторной проверки ещё не сохранены. При переходе без сохранения текущий ввод будет потерян.",stayLabel:"Продолжить работу с задачей"};
const taskReplacePrompt:LeavePrompt={eyebrow:"Новая версия задачи",title:"Заменить текущий ввод сохранённой версией?",message:"Ваш несохранённый текст будет заменён данными с сервера. Перед заменой его можно скопировать из формы.",stayLabel:"Оставить мой черновик",discardLabel:"Заменить текущий ввод"};

export type CareTask = {id: number; patient_id: number; patient_name?: string; title: string; doctor_id: number;
  assigned_to_id: number; kind: string; status: string; action_result: string; due_at: string | null;
  follow_up_at: string | null; source_type?: string; source_id?: number | null;
  verification_status: string; verification_comment?: string; revision: number;
  assignee_name?: string; started_at?: string | null; updated_at?: string | null};
export type CareSource = {type:string;id:number;label:string;detail?:string;occurredAt?:string;questions?:Question[];answers?:Record<string,unknown>};
type Source = CareSource;
type Status = {status: string; revision: number; reason?: string; reason_category?:string|null; created_at?: string; source?: string};
type Care = {treatment: Status; history: Status[]; refusal_categories:{code:string;label:string}[]; mis: {as_of: string; data: null | {
  scenario: {title: string; description: string; expected_route: string};
  synthetic_survey_sessions?: {assigned_at: string; opened_at: string | null; submitted_at: string | null}[];
  recommended_contact: null | {start: string; end: string};
  visits: {id: string; scheduled_at: string; occurred_at: string | null; status: string; initiator: string | null; reason: string}[]}}};
export const treatmentLabels: Record<string, string> = {in_progress: "В процессе", completed: "Завершил лечение", refused: "Отказался", unknown: "Врач ещё не определил"};
const verificationLabels: Record<string, string> = {pending: "Результат ещё не проверен", resolved: "Затруднение устранено по проверке врача", not_resolved: "Затруднение сохраняется", unknown: "Результат неизвестен"};
const sourceLabels: Record<string,string> = {manual:"Ручное наблюдение",message:"Сообщение",assessment:"Опросник состояния",survey_submission:"Ответ на опрос",adherence_report:"Самоотчёт о рекомендации",alert:"Событие для оценки",doctor_note:"Наблюдение врача",medication_log:"Лекарственный самоотчёт",diary_entry:"Запись дневника"};

export type TaskChange={id:number;stage:string;verification?:string};
export function TaskItem({task:incomingTask, operational, reload, notify, scope, autoFocus=false,onEditing,detached=false,embedded=false,openSource,nextStep}: {task: CareTask; operational: boolean; reload: (change?:TaskChange) => void; notify: Notify;scope?:string;autoFocus?:boolean;onEditing?:(id:number,dirty:boolean)=>void;detached?:boolean;embedded?:boolean;openSource?:(task:CareTask)=>void;nextStep?:(task:CareTask)=>void}) {
  const [remote,setRemote]=useState<CareTask|null>(null);
  const [remoteError,setRemoteError]=useState(""),[remoteRetry,setRemoteRetry]=useState(0);
  const [unavailable,setUnavailable]=useState(false);
  const task=remote&&remote.revision>incomingTask.revision?remote:incomingTask;
  const [result, setResult] = useState(task.action_result);
  const [baseline,setBaseline]=useState({revision:task.revision,result:task.action_result});
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [writeError,setWriteError]=useState("");
  const view=useRef<HTMLElement>(null);
  const lastAttempt=useRef({verify:false,stage:"done"});
  const focusAfterSave=useRef(false);
  const dirty=Boolean(result!==baseline.result||comment||status!=="unknown");
  const outdated=task.revision>baseline.revision||detached;
  const form=useUnsavedForm({dirty,pending:busy,prompt:taskResultPrompt,scope,focus:()=>view.current?.querySelector<HTMLElement>(comment?'.task-verification textarea':'[data-task-current], [role="alert"]')?.focus()});
  useEffect(()=>{if(writeError)view.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();},[writeError]);
  useEffect(()=>{
    if(!focusAfterSave.current)return;
    focusAfterSave.current=false;view.current?.querySelector<HTMLElement>('[data-task-current]')?.focus({preventScroll:true});
  },[task.revision]);
  useEffect(()=>{onEditing?.(task.id,dirty);},[task.id,dirty,onEditing]);
  useEffect(()=>()=>onEditing?.(incomingTask.id,false),[incomingTask.id,onEditing]);
  useEffect(()=>{
    if(!detached)return;
    let active=true;setRemoteError("");
    api<CareTask>(`/tasks/${incomingTask.id}`).then(value=>{if(active)setRemote(value);}).catch(error=>{
      if(!active)return;
      if(error instanceof ApiError && (error.status===403||error.status===404)) {
        setResult("");setComment("");setStatus("unknown");setUnavailable(true);form.clear();onEditing?.(incomingTask.id,false);
      } else setRemoteError(error instanceof Error?error.message:"Не удалось получить актуальную задачу");
    });
    return()=>{active=false;};
  },[detached,incomingTask.id,remoteRetry]);
  useEffect(()=>{
    if(outdated&&!detached&&!dirty&&!busy){setBaseline({revision:task.revision,result:task.action_result});setResult(task.action_result);setConflict(false);}
  },[task.revision,task.action_result,outdated,detached,dirty,busy]);
  function loadCurrent() {
    if(detached&&!remote)return;
    form.confirm(()=>{setBaseline({revision:task.revision,result:task.action_result});setResult(task.action_result);setComment("");setStatus("unknown");setConflict(false);form.clear();if(detached){onEditing?.(task.id,false);reload({id:task.id,stage:task.status,verification:task.verification_status});}},taskReplacePrompt);
  }
  async function act(verify = false, stage = "done") {
    if(busy||outdated)return;
    setBusy(true);setWriteError("");lastAttempt.current={verify,stage};
    try {
      const saved=await send<CareTask>(`/tasks/${task.id}${verify ? "/verify" : ""}`, verify ? {status, comment, expected_revision: baseline.revision} : {status: stage, action_result:result, expected_revision: baseline.revision}, verify ? "POST" : "PATCH");
      focusAfterSave.current=true;setRemote({...task,...saved});setBaseline({revision:saved.revision,result:saved.action_result});setResult(saved.action_result);setConflict(false);
      if(verify){setComment("");setStatus("unknown");}
      reload({id:task.id,stage:verify?"done":stage,verification:saved.verification_status}); notify(verify ? "Повторная проверка сохранена" : stage === "in_progress" ? "Задача принята в работу" : "Действие сохранено; результат проверяет врач");
    } catch (e) {
      if(e instanceof ApiError && (e.status===403||e.status===404)){setUnavailable(true);setResult("");setComment("");setStatus("unknown");form.clear();onEditing?.(task.id,false);}
      else {if(e instanceof ApiError && e.status===409){setConflict(true);reload();}setWriteError(e instanceof Error?e.message:"Не удалось сохранить. Введённые данные остаются в форме.");}
    }
    finally { setBusy(false); }
  }
  if(unavailable)return <p className="field-hint">Задача больше не доступна Вашей учётной записи. Обновите список.</p>;
  const actionEditor=<>
    <label className="field">Что сделано<textarea rows={3} readOnly={outdated} autoFocus={autoFocus&&task.status!=="done"} maxLength={2000} value={result} onChange={e=>setResult(e.target.value)} placeholder="Опишите фактически выполненное действие"/></label>
    <Button variant={task.status==="done"?"secondary":"primary"} disabled={busy||outdated||!result.trim()} onClick={()=>act()}>{busy?"Сохраняем…":task.status==="done"?"Сохранить описание":"Действие выполнено"}</Button>
  </>;
  return <article ref={view} className={`task-detail ${embedded?"is-embedded":"diary-entry"}`}>
    {!embedded&&<><div className="button-row"><Badge tone={task.status==="done"?"good":task.status==="in_progress"?"purple":"muted"}>{task.status==="done"?"Действие выполнено":task.status==="in_progress"?"В работе":"Назначено"}</Badge><Badge tone="muted">{task.kind==="organization"?"Организационная":"Клиническая"}</Badge></div><h3>{task.title}</h3>{task.patient_name&&<p>{task.patient_name}</p>}</>}
    <dl className="task-facts"><div><dt>Исполнитель</dt><dd>{operational?"Вы":task.assignee_name?accountName(task.assignee_name):`Участник #${task.assigned_to_id}`}</dd></div><div><dt>Срок действия</dt><dd>{task.due_at?date(task.due_at):"Не задан"}</dd></div><div><dt>Проверка результата</dt><dd>{task.follow_up_at?date(task.follow_up_at):"Дата не задана"}</dd></div></dl>
    {!operational&&<div className="task-source-line"><span>{sourceLabels[task.source_type??"manual"]}{task.source_id?` #${task.source_id}`:""}</span>{openSource&&<Button variant="ghost" onClick={()=>openSource(task)}>Посмотреть исходный ответ</Button>}</div>}
    <ErrorBox message={writeError} retry={busy||outdated||conflict?undefined:()=>act(lastAttempt.current.verify,lastAttempt.current.stage)}/>
    {(conflict||outdated)&&<div className="task-conflict" role="alert"><p>Задача изменилась. Ваш ввод сохранён в форме. Сверьте его с новой версией.</p>{remoteError?<><p>{remoteError}</p><Button variant="secondary" onClick={()=>setRemoteRetry(value=>value+1)}>Повторить загрузку задачи</Button></>:detached&&!remote?<p>Получаем актуальную версию…</p>:outdated?<><details><summary>Посмотреть сохранённое описание</summary><p className="preserve">{task.action_result||"Описание ещё не сохранено"}</p></details><Button variant="secondary" onClick={loadCurrent}>Загрузить версию с сервера</Button></>:<Button variant="secondary" onClick={()=>reload()}>Повторить обновление</Button>}</div>}
    {task.verification_status==="pending"||outdated&&dirty?<fieldset className="form-fields task-current-step" disabled={busy} aria-busy={busy}>
      {task.status!=="done"?<>
        <h4 data-task-current tabIndex={-1}>Описание действия</h4>
        {task.status==="open"&&<Button variant="secondary" disabled={busy||outdated} onClick={()=>act(false,"in_progress")}>{result.trim()?"Взять в работу и сохранить описание":"Взять в работу"}</Button>}
        {actionEditor}
      </>:<>
        <div className="task-saved-action"><span className="eyebrow">Выполненное действие</span><p className="preserve">{task.action_result}</p></div>
        {!operational?<div className="task-verification">
          <h4 data-task-current tabIndex={-1}>Проверка результата</h4>
          <label className="field">Результат проверки<select disabled={outdated} value={status} onChange={e=>setStatus(e.target.value)}><option value="unknown">Пока неизвестен</option><option value="resolved">Затруднение устранено</option><option value="not_resolved">Затруднение сохраняется</option></select></label>
          <label className="field">На чём основан вывод<textarea rows={3} readOnly={outdated} value={comment} onChange={e=>setComment(e.target.value)} maxLength={2000} placeholder="Что сообщил пациент и что удалось проверить"/></label>
          {result!==baseline.result&&<p className="field-hint">Сначала сохраните изменённое описание действия. Основание проверки останется в форме.</p>}
          <Button disabled={busy||outdated||!comment.trim()||result!==baseline.result} onClick={()=>act(true)}>{busy?"Сохраняем…":"Сохранить проверку результата"}</Button>
        </div>:<p className="task-next-notice" data-task-current tabIndex={-1}>Действие сохранено. Лечащий врач отдельно проверит результат.</p>}
        <Disclosure title="Уточнить описание выполненного действия">{actionEditor}</Disclosure>
      </>}
    </fieldset>:<>
      <div className="task-saved-action"><span className="eyebrow">Выполненное действие</span><p className="preserve">{task.action_result}</p></div>
      <div className="task-verified-result" data-task-current tabIndex={-1}><Badge tone={task.verification_status==="resolved"?"good":"muted"}>{verificationLabels[task.verification_status]}</Badge>{!operational&&<p className="preserve">{task.verification_comment}</p>}</div>
      {!operational&&nextStep&&task.verification_status!=="resolved"&&<Button variant="secondary" onClick={()=>nextStep(task)}>Запланировать следующий шаг</Button>}
    </>}
    {!operational&&task.source_type==="survey_submission"&&task.source_id&&<Disclosure title="Передача в ЭМК" lazy><EmrDemo key={`${task.patient_id}:${task.id}`} patientId={task.patient_id} taskId={task.id} taskRevision={task.revision} disabled={busy||outdated||conflict||dirty||unavailable}/></Disclosure>}
  </article>;
}

export function CareWorkflow({patientId, source:initialSource, notify, scope,resolveSource,openSource,composeRequested=true,onCreated}: {patientId:number;source:Source|null;notify:Notify;scope?:string;resolveSource?:(task:CareTask)=>Source|null;openSource?:(source:Source)=>void;composeRequested?:boolean;onCreated?:()=>void}) {
  const [source,setSource]=useState(initialSource);
  const [composeVersion,setComposeVersion]=useState(0),[composeOpen,setComposeOpen]=useState(Boolean(initialSource)&&composeRequested);
  const [formError,setFormError]=useState("");
  const createForm=useRef<HTMLFormElement>(null);
  const care = useApi<Care>(`/patients/${patientId}/care`);
  const tasks = useApi<CareTask[]>(`/patients/${patientId}/tasks`,15000);
  const team = useApi<{id: number; name: string; role: string}[]>("/coordination/team");
  const [outcome, setOutcome] = useState(""), [reason, setReason] = useState("");
  const [reasonCategory,setReasonCategory] = useState("");
  const [title, setTitle] = useState(""), [kind, setKind] = useState("clinical"), [assignee, setAssignee] = useState("");
  const [due, setDue] = useState(""), [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdTask,setCreatedTask]=useState<number|null>(null);
  const statusRequest = useRef({signature: "", id: ""}), taskRequest = useRef({signature: "", id: ""});
  const {clear:clearOutcome}=useUnsavedForm({dirty:Boolean(outcome||reason||reasonCategory),pending:busy,prompt:outcomePrompt,scope});
  const {clear:clearTask,confirm:confirmTask}=useUnsavedForm({dirty:Boolean(title||kind!=="clinical"||assignee||due||followUp),pending:busy,prompt:taskPrompt,scope,focus:()=>document.getElementById("task-title")?.focus()});
  useEffect(() => {if (source) document.getElementById("task-title")?.focus();},[source?.type,source?.id]);
  useEffect(()=>{if(formError)createForm.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();},[formError]);
  function continueTask(task:CareTask) {
    confirmTask(()=>{
      setSource(resolveSource?.(task)??(task.source_id?{type:task.source_type??"manual",id:task.source_id,label:sourceLabels[task.source_type??"manual"]??"Исходное наблюдение"}:null));
      setTitle("");setKind("clinical");setAssignee("");setDue("");setFollowUp("");setCreatedTask(null);setFormError("");clearTask();setComposeOpen(true);setComposeVersion(value=>value+1);
    });
  }
  async function saveOutcome(e: FormEvent) {
    e.preventDefault(); if (!care.data) return;
    const category = outcome === "refused" ? reasonCategory || null : null;
    const signature = JSON.stringify([outcome, reason, category, care.data.treatment.revision]);
    if (statusRequest.current.signature !== signature) statusRequest.current = {signature, id: createRequestId()};
    setBusy(true);
    try { await send(`/patients/${patientId}/treatment-status`, {status: outcome, reason, reason_category:category, expected_revision: care.data.treatment.revision, client_request_id: statusRequest.current.id}); care.reload(); setOutcome(""); setReason(""); setReasonCategory(""); clearOutcome();notify("Исход лечения определён врачом"); }
    catch (e) { notify(e instanceof Error ? e.message : "Не удалось сохранить исход", "error"); }
    finally { setBusy(false); }
  }
  async function saveTask(e: FormEvent) {
    e.preventDefault();setFormError("");
    const data = {title, kind, assigned_to_id: assignee ? Number(assignee) : null, source_type: source?.type ?? "manual", source_id: source?.id ?? null, due_at: due ? clinicInputToIso(due) : null, follow_up_at: followUp ? clinicInputToIso(followUp) : null};
    const signature = JSON.stringify(data);
    if (taskRequest.current.signature !== signature) taskRequest.current = {signature, id: createRequestId()};
    setBusy(true);
    try { const saved=await send<CareTask>(`/patients/${patientId}/tasks`, {...data, client_request_id: taskRequest.current.id}); tasks.reload(); setTitle("");setKind("clinical");setAssignee("");setDue("");setFollowUp("");clearTask();setCreatedTask(saved.id);setComposeOpen(false);onCreated?.();taskRequest.current = {signature: "", id: ""}; notify("Задача связана с источником и назначена исполнителю"); }
    catch (e) { setFormError(e instanceof Error?e.message:"Не удалось назначить действие. Ввод сохранён в форме."); }
    finally { setBusy(false); }
  }
  const fixture = care.data?.mis.data;
  const progress=tasks.data?careProgress(tasks.data):null;
  return <>
    <Section title="Действия и проверка результата" aside={<div className="button-row"><Badge>{tasks.data?`${tasks.data.length} ${plural(tasks.data.length,"задача","задачи","задач")}`:"Получаем…"}</Badge><Button variant="ghost" disabled={tasks.refreshing} onClick={tasks.reload}>{tasks.refreshing?"Обновляем…":"Обновить задачи"}</Button></div>}>
      <ErrorBox message={tasks.error || team.error} retry={() => { tasks.reload(); team.reload(); }} />
      {progress&&<dl className="care-progress-summary" aria-label="Этапы плана"><div><dt>Требуют действия</dt><dd>{progress.active}</dd></div><div><dt>Ждут проверки</dt><dd>{progress.awaiting}</dd></div><div><dt>Проверены врачом</dt><dd>{progress.checked}</dd></div></dl>}
      {source&&<aside className="care-source-context" aria-label="Основание следующего шага"><div><span className="eyebrow">Основание действия</span><strong>{source.label}</strong>{source.detail&&<blockquote className="preserve">{source.detail}</blockquote>}{source.questions&&source.answers&&<Disclosure title="Посмотреть исходные ответы"><AnswerSummary questions={source.questions} answers={source.answers}/></Disclosure>}{source.occurredAt&&<p className="field-hint">{date(source.occurredAt)} · со слов пациента</p>}</div>{openSource&&["survey_submission","adherence_report"].includes(source.type)&&<Button variant="ghost" onClick={()=>openSource(source)}>Вернуться к ответу</Button>}</aside>}
      <Disclosure key={`${createdTask??"new-task"}-${composeVersion}`} reveal={composeOpen&&createdTask===null} title={createdTask?"Назначить ещё одно действие":source?"Назначить действие по этому ответу":"Назначить новое действие"}>
      <form ref={createForm} onSubmit={saveTask}>
        <ErrorBox message={formError}/>

        <fieldset className="form-fields" disabled={busy} aria-busy={busy}>
        {!source&&<p className="field-hint">Для связи с барьером сначала выберите ответ пациента в «Обратной связи».</p>}
        <label className="field">Следующее действие<input id="task-title" required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="field">Кому доступно действие<select value={kind} onChange={e => {setKind(e.target.value); setAssignee("");}}><option value="clinical">Клиническая · только врачу</option><option value="organization">Организационная · врачу или координатору</option></select></label>
        <label className="field">Исполнитель<select value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Лечащий врач</option>{team.data?.filter(u => kind === "organization" || u.role === "doctor").map(u => <option key={u.id} value={u.id}>{accountName(u.name)} · {u.role === "coordinator" ? "координатор" : "врач"}</option>)}</select></label>
        {kind === "organization" && <p className="field-hint">Координатор увидит имя пациента, название и описание действия. Не включайте клинические подробности; исходные ответы и приватные заметки ему недоступны.</p>}
        <div className="form-grid"><label className="field">Срок действия<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label><label className="field">Повторная проверка<input type="datetime-local" value={followUp} onChange={e => setFollowUp(e.target.value)} /></label></div><details className="source-help"><summary>Часовой пояс</summary><p>Сроки вводятся и отображаются по московскому времени.</p></details>
        <Button disabled={busy || !title.trim()}>Назначить следующий шаг</Button>
        </fieldset>
      </form>
      </Disclosure>
      {tasks.loading&&<Loading/>}
      {tasks.data?.map(task => <div className="care-task-card" data-care-task={task.id} key={task.id}>
        <div className="section-heading"><h3>{task.title}</h3><Badge tone={task.status==="done"?"good":task.status==="in_progress"?"purple":"muted"}>{task.status==="done"?"Действие выполнено":task.status==="in_progress"?"В работе":"Назначено"}</Badge></div>
        {task.status==="done"&&<p className="field-hint">{verificationLabels[task.verification_status]}</p>}
        <Disclosure reveal={task.id===createdTask} title={task.status!=="done"?"Описать действие":task.verification_status==="pending"?"Проверить результат":"Посмотреть проверку"}><TaskItem task={{...task,assignee_name:task.assignee_name??team.data?.find(member=>member.id===task.assigned_to_id)?.name}} operational={false} reload={tasks.reload} notify={notify} scope={scope} embedded openSource={openSource&&resolveSource?.(task)?()=>openSource(resolveSource!(task)!):undefined} nextStep={continueTask}/></Disclosure>
      </div>)}
      {tasks.data?.length === 0 && <Empty title="Следующих шагов пока нет" />}
    </Section>
    <Section title="Статус лечения">
      <ErrorBox message={care.error} retry={care.reload} />
      {care.loading ? <Loading /> : care.data && <>
        <Badge tone="purple">{treatmentLabels[care.data.treatment.status]}</Badge>
        {care.data.treatment.status === "refused" && <p>Сообщённая причина: {care.data.refusal_categories.find(c => c.code === care.data!.treatment.reason_category)?.label ?? "пока не классифицирована"}</p>}
        <p className="field-hint">Не вычисляется по последнему визиту, молчанию или скорости ответа. Решение сохраняется в Compass; МИС не изменяется.</p>
        <Disclosure lazy title="Изменить исход лечения">
        <form onSubmit={saveOutcome}>
          <fieldset className="form-fields" disabled={busy} aria-busy={busy}>
          <label className="field">Новое решение<select required value={outcome} onChange={e => {setOutcome(e.target.value);setReasonCategory("");}}><option value="">Выберите решение</option>{Object.entries(treatmentLabels).filter(([k]) => k !== "unknown").map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {outcome === "refused" && <label className="field">Сообщённая причина отказа · необязательно<select value={reasonCategory} onChange={e => setReasonCategory(e.target.value)}><option value="">Пока не классифицирована</option>{care.data.refusal_categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select><small>Категорию выбирает врач по известным фактам. Она попадёт в обезличенную статистику; текст основания остаётся в карточке.</small></label>}
          <label className="field">Основание<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
          <Button disabled={busy || !outcome || !reason.trim()}>Сохранить решение врача</Button>
          </fieldset>
        </form>
        <details><summary>История решений ({care.data.history.length})</summary>{care.data.history.map(row => <p key={row.revision}>{date(row.created_at!)} · {treatmentLabels[row.status]} · врач #{(row as Status & {doctor_id: number}).doctor_id}<br />{row.reason}</p>)}</details>
        </Disclosure>
      </>}
    </Section>
    {fixture && <Section title="События МИС"><Disclosure lazy title="Показать события">
      <h3>{fixture.scenario.title}</h3><p>{fixture.scenario.description}</p><p className="field-hint">{fixture.scenario.expected_route}</p>
      {fixture.synthetic_survey_sessions && <details open><summary>История прохождения опросов</summary><p>Завершено {fixture.synthetic_survey_sessions.filter(s => s.submitted_at).length} из {fixture.synthetic_survey_sessions.length} форм.</p><div className="table-wrap"><table><thead><tr><th>Назначен</th><th>Открыт</th><th>Завершён</th><th>Интервал</th></tr></thead><tbody>{fixture.synthetic_survey_sessions.map((s,i) => <tr key={i}><td>{date(s.assigned_at)}</td><td>{s.opened_at ? date(s.opened_at) : "Нет сведений"}</td><td>{s.submitted_at ? date(s.submitted_at) : "Нет ответа"}</td><td>{s.opened_at && s.submitted_at ? `${(new Date(s.submitted_at).getTime()-new Date(s.opened_at).getTime())/1000} с` : "Неизвестно"}</td></tr>)}</tbody></table></div><p className="field-hint">Времена из снимка МИС учитываются отдельно от событий приложения. Интервал включает перерывы и не определяет выраженность тревоги.</p></details>}
      {fixture.recommended_contact ? <p>Рекомендованное окно: {date(fixture.recommended_contact.start)} — {date(fixture.recommended_contact.end)}</p> : <p className="muted">Рекомендованное окно не задано</p>}
      {fixture.visits.map(v => <article className="diary-entry" key={v.id}><strong>{({attended: "Состоялся", scheduled: "Запланирован", cancelled: "Отменён", rescheduled: "Перенесён", no_show: "Неявка по данным источника"} as Record<string,string>)[v.status] ?? "Неизвестно"}</strong> · {date(v.scheduled_at)}<p>{v.reason}</p>{v.initiator && <small>Инициатор: {v.initiator === "clinic" ? "клиника" : "пациент"}</small>}</article>)}
      {!fixture.visits.length && <p className="muted">События визитов не предоставлены</p>}
    </Disclosure></Section>}
    <Disclosure lazy title="Предпочтения интерфейса пациента"><MotivationAdvice patientId={patientId} notify={notify}/></Disclosure>
  </>;
}

export function CoordinatorHome({notify}: {notify: Notify}) {
  const tasks = useApi<CareTask[]>("/coordination/tasks", 15000);
  return <><Heading eyebrow="Организационная поддержка" title="Назначенные мне задачи">Только задачи, которые врач поручил Вам. Медицинские ответы, заметки и исходы лечения доступны врачу.</Heading><ErrorBox message={tasks.error} retry={tasks.reload} />{tasks.loading ? <Loading /> : tasks.data && <Section title="Работа с затруднениями">{!tasks.data.length && <Empty title="Назначенных задач пока нет" />}{tasks.data.map(task => <TaskItem key={`${task.id}-${task.verification_status}`} task={task} operational reload={tasks.reload} notify={notify} />)}</Section>}</>;
}
