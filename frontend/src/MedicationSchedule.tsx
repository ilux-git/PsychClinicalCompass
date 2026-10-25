import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { send, useApi } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, type Notify } from "./UI";
import { MedicationEditor, localDay } from "./MedicationEditor";
import { useNavigationGuard, useUnsavedForm, type LeavePrompt } from "./NavigationGuard";
import { ParticipationReceipt, type ParticipationConfirmation } from "./ParticipationReceipt";
import { useInteractionMotion } from "./Interaction";
export type MedicationItem = {key: string; id?: number; label: string; instructions: string; schedule_text: string; schedule_kind: string;
  times: string[]; weekdays: number[]; timezone: string; starts_on: string; ends_on: string | null; active: boolean;
  revision: number; source: string; editable: boolean};
type Report = {id: number; item_key: string; occurrence_key: string; status: string; reason: string; revision: number};
type Event = {occurrence_key: string; item_key: string; clock: string; scheduled_for: string | null; status: string;
  requires_time_confirmation: boolean; can_report: boolean; report: Report | null};
type Schedule = {items: MedicationItem[]; events: Event[]; historical_reports: Report[]; recent_reports: Report[]; source: {status: string}; day: string};
type SelectSource = (source: {type: string; id: number; label: string}) => void;
const reportLabels: Record<string,string> = {taken: "Сообщаю: принял(а)", not_taken: "Сообщаю: не принял(а)", unknown: "Не могу уточнить", not_applicable: "Не требовалось по моему плану"};
const reportPrompt:LeavePrompt={eyebrow:"Незавершённая отметка",title:"Продолжить лекарственный самоотчёт?",message:"Выбранная отметка или комментарий ещё не сохранены. При переходе без сохранения текущий ввод будет потерян.",stayLabel:"Продолжить отметку"};

function ReportForm({item, event, prior, day, readOnly, notify, reload, scope, onSaving, onSaved}: {item: MedicationItem; event?: Event; prior?: Report; day: string; readOnly: boolean; notify: Notify; reload: () => void; scope:string;onSaving:()=>void;onSaved:(result:ParticipationConfirmation)=>void}) {
  const current = event?.report ?? prior;
  const [status, setStatus] = useState(current?.status ?? "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [saveError,setSaveError]=useState("");
  const errorResult=useRef<HTMLDivElement>(null),errorId=useId();
  useEffect(()=>{if(saveError)errorResult.current?.querySelector<HTMLElement>('.error-box')?.focus();},[saveError]);
  const request = useRef({signature: "", id: ""});
  const [baseline,setBaseline]=useState(()=>JSON.stringify([status,reason]));
  const dirty=JSON.stringify([status,reason])!==baseline;
  const {clear}=useUnsavedForm({dirty:!readOnly && dirty,pending:busy,prompt:reportPrompt,scope});
  async function save(e: FormEvent) {
    e.preventDefault();
    const data = {item_key: item.key, day, occurrence_key: event?.occurrence_key ?? `${day}@self_report/v${item.revision}`, status, reason};
    const signature = JSON.stringify(data);
    if (request.current.signature !== signature) request.current = {signature, id: crypto.randomUUID()};
    onSaving();setSaveError("");setBusy(true);
    try {
      const response=current?await send<ParticipationConfirmation>(`/medications/reports/${current.id}`, {status, reason, expected_revision: current.revision}, "PATCH"):
        await send<ParticipationConfirmation>("/medications/reports", {...data, client_request_id: request.current.id});
      setBaseline(JSON.stringify([status,reason]));clear();onSaved(response);reload(); notify("Самоотчёт сохранён. Его видит лечащий врач.");
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Не удалось сохранить отметку"); }
    finally { setBusy(false); }
  }
  if (readOnly) return <p>{current ? reportLabels[current.status] : "Самоотчёт не получен"}{current?.reason && <span className="preserve"> · {current.reason}</span>}</p>;
  if (event && !event.can_report) return <p className="field-hint">{event.requires_time_confirmation ? "В этом часовом поясе время неоднозначно: уточните расписание." : "Время события ещё не наступило."}</p>;
  return <form onSubmit={save}><div ref={errorResult} id={errorId}><ErrorBox message={saveError}/></div><fieldset className="form-fields medication-report-form" disabled={busy} aria-busy={busy} aria-describedby={saveError?errorId:undefined}>
    <label className="field">Мой самоотчёт<select required value={status} onChange={e => {onSaving();setSaveError("");setStatus(e.target.value);}}><option value="">Без отметки · неизвестно</option>{Object.entries(reportLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">Комментарий · необязательно<input maxLength={2000} value={reason} onChange={e => {onSaving();setSaveError("");setReason(e.target.value);}} /></label>
    <Button variant="secondary" disabled={busy || !status || !dirty}>{busy?"Сохраняем…":current ? "Исправить самоотчёт" : "Сохранить отметку"}</Button>
  </fieldset></form>;
}

export function MedicationSchedule({patientId, notify, readOnly = false, onSource, progress}: {patientId: number; notify: Notify; readOnly?: boolean; onSource?: SelectSource;progress?:()=>void}) {
  const [day, setDay] = useState(localDay);
  const schedule = useApi<Schedule>(`/patients/${patientId}/medications?on=${day}`);
  const [editing, setEditing] = useState<MedicationItem | null>(null);
  const [editorOpen,setEditorOpen]=useState(false),[editorVersion,setEditorVersion]=useState(0);
  const guard=useNavigationGuard();
  const {moving}=useInteractionMotion();
  const [saved,setSaved]=useState<{kind:"schedule"|"report";result:ParticipationConfirmation}|null>(null);
  const savedPanel=useRef<HTMLElement>(null),savedHeading=useRef<HTMLHeadingElement>(null),savedId=useId();
  useEffect(()=>{
    if(!saved)return;
    savedHeading.current?.focus({preventScroll:true});
    savedPanel.current?.scrollIntoView({block:"nearest",behavior:moving?"smooth":"instant"});
  },[saved,moving]);
  const clearConfirmation=()=>setSaved(null);
  const editorScope=`medication-editor:${patientId}`,reportScope=`medication-reports:${patientId}`;
  function edit(item:MedicationItem|null) {
    guard.runFor(()=>{clearConfirmation();setEditing(item);setEditorOpen(true);setEditorVersion(value=>value+1);},editorScope);
  }
  function changeDay(value:string) {if(value && value!==day)guard.runFor(()=>{clearConfirmation();setDay(value);},reportScope);}
  return <>
    <Heading level={readOnly?2:1} eyebrow={readOnly?undefined:"Личный учёт и данные МИС"} title={readOnly ? "Расписание и самоотчёты пациента" : "Моё расписание лекарств"} action={!readOnly&&<Button onClick={()=>edit(null)}>Добавить свою позицию</Button>}>{readOnly?"Отсутствие отметки не доказывает пропуск.":"Личные позиции отделены от назначений МИС. Отсутствие отметки остаётся неизвестным; отметка — сообщение пациента, а не подтверждение приёма."}</Heading>
    {saved&&!readOnly&&<section ref={savedPanel} className="panel medication-saved-result" aria-labelledby={savedId}>
      <div className="section-heading"><h2 ref={savedHeading} id={savedId} tabIndex={-1}>{saved.kind==="schedule"?"Расписание сохранено":"Самоотчёт сохранён"}</h2></div>
      <p className="field-hint">{saved.kind==="schedule"?"Личная запись обновлена. Назначение в МИС не менялось.":"Отметка доступна лечащему врачу. Это ваше наблюдение, а не подтверждение приёма."}</p>
      <ParticipationReceipt result={saved.result} progress={progress}/>
    </section>}
    {editorOpen&&!readOnly&&<MedicationEditor key={editorVersion} item={editing} scope={editorScope} notify={notify} onClose={()=>setEditorOpen(false)} onSaving={clearConfirmation} onSaved={result=>{setSaved({kind:"schedule",result});setEditorOpen(false);schedule.reload();}}/>}
    <Section title="Расписание на день" className="medication-schedule"><label className="field medication-day">День<input type="date" value={day} onChange={e => changeDay(e.target.value)} /></label>
      <ErrorBox message={schedule.error} retry={schedule.reload} />
      {schedule.loading ? <Loading /> : schedule.data && <>
        {!schedule.data.items.length && <Empty title="Позиций пока нет">{readOnly?"Пациент ещё не добавлял личных позиций; данные назначений из МИС не предоставлены.":<>Добавьте личную позицию, чтобы видеть расписание и сохранять отметки.<span className="medication-empty-action"><Button variant="secondary" onClick={()=>edit(null)}>Добавить личное расписание</Button></span></>}</Empty>}
        {schedule.data.items.map(item => <article className="diary-entry" key={item.key}>
          <Badge tone={item.source === "patient_entered" ? "purple" : "muted"}>{item.source === "patient_entered" ? "Личная позиция пациента" : "МИС · синтетический JSON · только чтение"}</Badge>
          <h3>{item.label}{!item.active && " · архив"}</h3><p className="preserve">{item.instructions}</p><p className="preserve">{item.schedule_text}</p><small>{item.timezone} · версия {item.revision}</small>
          {!readOnly && item.editable && <p><Button variant="ghost" onClick={() => edit(item)}>Редактировать личную позицию</Button></p>}
          {schedule.data!.events.filter(e => e.item_key === item.key).map(event => <div className="medication-event" key={event.occurrence_key}>
            <h4>{event.clock} · {event.report ? "Есть самоотчёт" : "Без отметки"}</h4>
            {!readOnly && event.can_report && <Button variant="ghost" onClick={() => notify(`Напоминание · симуляция внутри приложения: ${item.label}, ${event.clock}. Внешняя доставка не выполнялась.`)}>Показать напоминание · симуляция</Button>}
            <ReportForm key={`${event.occurrence_key}-${event.report?.revision ?? 0}`} item={item} event={event} day={day} readOnly={readOnly} notify={notify} reload={schedule.reload} scope={reportScope} onSaving={clearConfirmation} onSaved={result=>setSaved({kind:"report",result})} />
          </div>)}
          {item.active && item.schedule_kind !== "fixed" && <><p className="field-hint">Свободное описание / по потребности: обязательные приёмы не рассчитываются.</p><ReportForm key={`${item.key}-${day}-${schedule.data!.historical_reports.find(r => r.item_key === item.key && r.occurrence_key === `${day}@self_report/v${item.revision}`)?.revision ?? 0}`} prior={schedule.data!.historical_reports.find(r => r.item_key === item.key && r.occurrence_key === `${day}@self_report/v${item.revision}`)} item={item} day={day} readOnly={readOnly} notify={notify} reload={schedule.reload} scope={reportScope} onSaving={clearConfirmation} onSaved={result=>setSaved({kind:"report",result})} /></>}
        </article>)}
        {schedule.data.historical_reports.length > 0 && <details><summary>Самоотчёты свободного расписания и предыдущих версий</summary>{schedule.data.historical_reports.map(r => <p key={r.id}>{schedule.data!.items.find(i => i.key === r.item_key)?.label ?? "Название позиции недоступно"} · {reportLabels[r.status]} · {r.reason}</p>)}</details>}
        {schedule.data.recent_reports.length > 0 && <div className="medication-recent"><h3>Последние самоотчёты · все даты</h3>{schedule.data.recent_reports.map(r => <article className="diary-entry" key={r.id}><h4>{r.occurrence_key.slice(0,10)} · {schedule.data!.items.find(i => i.key === r.item_key)?.label ?? "Название позиции недоступно"}</h4><p>{reportLabels[r.status]}</p><p className="preserve">{r.reason}</p><div className="button-row"><Button variant="ghost" onClick={() => changeDay(r.occurrence_key.slice(0,10))}>Открыть день</Button>{readOnly && onSource && <Button variant="secondary" onClick={() => onSource({type:"medication_log",id:r.id,label:`Лекарственный самоотчёт #${r.id}`})}>Назначить следующий шаг</Button>}</div></article>)}</div>}
        <p className="field-hint">События построены по текущей версии расписания. Исторические отметки сохраняются отдельно. Внешняя доставка напоминаний не подключена.</p>
      </>}
    </Section>
  </>;
}
