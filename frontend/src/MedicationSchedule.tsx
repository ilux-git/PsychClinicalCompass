import { useRef, useState, type FormEvent } from "react";
import { send, useApi } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, type Notify } from "./UI";

function localDay() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
type Item = {key: string; id?: number; label: string; instructions: string; schedule_text: string; schedule_kind: string;
  times: string[]; weekdays: number[]; timezone: string; starts_on: string; ends_on: string | null; active: boolean;
  revision: number; source: string; editable: boolean};
type Report = {id: number; item_key: string; occurrence_key: string; status: string; reason: string; revision: number};
type Event = {occurrence_key: string; item_key: string; clock: string; scheduled_for: string | null; status: string;
  requires_time_confirmation: boolean; can_report: boolean; report: Report | null};
type Schedule = {items: Item[]; events: Event[]; historical_reports: Report[]; recent_reports: Report[]; source: {status: string}; day: string};
type SelectSource = (source: {type: string; id: number; label: string}) => void;
const reportLabels: Record<string,string> = {taken: "Сообщаю: принял(а)", not_taken: "Сообщаю: не принял(а)", unknown: "Не могу уточнить", not_applicable: "Не требовалось по моему плану"};

function ReportForm({item, event, prior, day, readOnly, notify, reload}: {item: Item; event?: Event; prior?: Report; day: string; readOnly: boolean; notify: Notify; reload: () => void}) {
  const current = event?.report ?? prior;
  const [status, setStatus] = useState(current?.status ?? "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const request = useRef({signature: "", id: ""});
  async function save(e: FormEvent) {
    e.preventDefault();
    const data = {item_key: item.key, day, occurrence_key: event?.occurrence_key ?? `${day}@self_report/v${item.revision}`, status, reason};
    const signature = JSON.stringify(data);
    if (request.current.signature !== signature) request.current = {signature, id: crypto.randomUUID()};
    setBusy(true);
    try {
      if (current) await send(`/medications/reports/${current.id}`, {status, reason, expected_revision: current.revision}, "PATCH");
      else await send("/medications/reports", {...data, client_request_id: request.current.id});
      reload(); notify("Самоотчёт сохранён. Его видит лечащий врач.");
    } catch (e) { notify(e instanceof Error ? e.message : "Не удалось сохранить", "error"); }
    finally { setBusy(false); }
  }
  if (readOnly) return <p>{current ? reportLabels[current.status] : "Самоотчёт не получен"}{current?.reason && <span className="preserve"> · {current.reason}</span>}</p>;
  if (event && !event.can_report) return <p className="field-hint">{event.requires_time_confirmation ? "В этом часовом поясе время неоднозначно: уточните расписание." : "Время события ещё не наступило."}</p>;
  return <form onSubmit={save} className="medication-report-form">
    <label className="field">Мой самоотчёт<select required value={status} onChange={e => setStatus(e.target.value)}><option value="">Без отметки · неизвестно</option>{Object.entries(reportLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field">Комментарий · необязательно<input maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    <Button variant="secondary" disabled={busy || !status}>{current ? "Исправить самоотчёт" : "Сохранить отметку"}</Button>
  </form>;
}

export function MedicationSchedule({patientId, notify, readOnly = false, onSource}: {patientId: number; notify: Notify; readOnly?: boolean; onSource?: SelectSource}) {
  const [day, setDay] = useState(localDay);
  const schedule = useApi<Schedule>(`/patients/${patientId}/medications?on=${day}`);
  const [editing, setEditing] = useState<Item | null>(null);
  const [label, setLabel] = useState(""), [instructions, setInstructions] = useState(""), [text, setText] = useState("");
  const [kind, setKind] = useState("fixed"), [times, setTimes] = useState("");
  const [weekdays, setWeekdays] = useState([0,1,2,3,4,5,6]);
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [start, setStart] = useState(localDay), [end, setEnd] = useState("");
  const [active, setActive] = useState(true), [busy, setBusy] = useState(false);
  const request = useRef({signature: "", id: ""});
  function edit(item: Item | null) {
    setEditing(item); setLabel(item?.label ?? ""); setInstructions(item?.instructions ?? ""); setText(item?.schedule_text ?? "");
    setKind(item?.schedule_kind ?? "fixed"); setTimes(item?.times.join(", ") ?? ""); setWeekdays(item?.weekdays ?? [0,1,2,3,4,5,6]);
    setZone(item?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone); setStart(item?.starts_on ?? localDay()); setEnd(item?.ends_on ?? ""); setActive(item?.active ?? true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const data = {label, instructions, schedule_text: text, schedule_kind: kind,
      times: kind === "fixed" ? times.split(",").map(t => t.trim()).filter(Boolean) : [], weekdays: kind === "fixed" ? weekdays : [],
      timezone: zone, starts_on: start, ends_on: end || null, active};
    const signature = JSON.stringify(data);
    if (request.current.signature !== signature) request.current = {signature, id: crypto.randomUUID()};
    setBusy(true);
    try {
      if (editing) await send(`/medications/items/${editing.id}`, {...data, expected_revision: editing.revision}, "PUT");
      else await send("/medications/items", {...data, client_request_id: request.current.id});
      edit(null); request.current = {signature: "", id: ""}; schedule.reload(); notify("Личная позиция сохранена; назначение МИС не менялось");
    } catch (e) { notify(e instanceof Error ? e.message : "Не удалось сохранить расписание", "error"); }
    finally { setBusy(false); }
  }
  return <>
    <Heading eyebrow="Личный учёт и данные МИС" title={readOnly ? "Расписание и самоотчёты пациента" : "Моё расписание лекарств"}>Личные позиции отделены от назначений МИС. Отсутствие отметки остаётся неизвестным; отметка — сообщение пациента, а не подтверждение приёма.</Heading>
    <Section title="Расписание на день"><label className="field">День<input type="date" value={day} onChange={e => {if (e.target.value) setDay(e.target.value);}} /></label>
      <ErrorBox message={schedule.error} retry={schedule.reload} />
      {schedule.loading ? <Loading /> : schedule.data && <>
        {!schedule.data.items.length && <Empty title="Позиций пока нет">Можно добавить собственную позицию и любое описание расписания.</Empty>}
        {schedule.data.items.map(item => <article className="diary-entry" key={item.key}>
          <Badge tone={item.source === "patient_entered" ? "purple" : "muted"}>{item.source === "patient_entered" ? "Личная позиция пациента" : "МИС · синтетический JSON · только чтение"}</Badge>
          <h3>{item.label}{!item.active && " · архив"}</h3><p className="preserve">{item.instructions}</p><p className="preserve">{item.schedule_text}</p><small>{item.timezone} · версия {item.revision}</small>
          {!readOnly && item.editable && <p><Button variant="ghost" onClick={() => edit(item)}>Редактировать личную позицию</Button></p>}
          {schedule.data!.events.filter(e => e.item_key === item.key).map(event => <div className="medication-event" key={event.occurrence_key}>
            <h4>{event.clock} · {event.report ? "Есть самоотчёт" : "Без отметки"}</h4>
            {!readOnly && event.can_report && <Button variant="ghost" onClick={() => notify(`Напоминание · симуляция внутри приложения: ${item.label}, ${event.clock}. Внешняя доставка не выполнялась.`)}>Показать напоминание · симуляция</Button>}
            <ReportForm key={`${event.occurrence_key}-${event.report?.revision ?? 0}`} item={item} event={event} day={day} readOnly={readOnly} notify={notify} reload={schedule.reload} />
          </div>)}
          {item.active && item.schedule_kind !== "fixed" && <><p className="field-hint">Свободное описание / по потребности: обязательные приёмы не рассчитываются.</p><ReportForm key={`${item.key}-${day}-${schedule.data!.historical_reports.find(r => r.item_key === item.key && r.occurrence_key === `${day}@self_report/v${item.revision}`)?.revision ?? 0}`} prior={schedule.data!.historical_reports.find(r => r.item_key === item.key && r.occurrence_key === `${day}@self_report/v${item.revision}`)} item={item} day={day} readOnly={readOnly} notify={notify} reload={schedule.reload} /></>}
        </article>)}
        {schedule.data.historical_reports.length > 0 && <details><summary>Самоотчёты свободного расписания и предыдущих версий</summary>{schedule.data.historical_reports.map(r => <p key={r.id}>{r.item_key} · {reportLabels[r.status]} · {r.reason}</p>)}</details>}
        {schedule.data.recent_reports.length > 0 && <Section title="Последние самоотчёты · все даты">{schedule.data.recent_reports.map(r => <article className="diary-entry" key={r.id}><h4>{r.occurrence_key.slice(0,10)} · {schedule.data!.items.find(i => i.key === r.item_key)?.label ?? r.item_key}</h4><p>{reportLabels[r.status]}</p><p className="preserve">{r.reason}</p><div className="button-row"><Button variant="ghost" onClick={() => setDay(r.occurrence_key.slice(0,10))}>Открыть день</Button>{readOnly && onSource && <Button variant="secondary" onClick={() => onSource({type:"medication_log",id:r.id,label:`Лекарственный самоотчёт #${r.id}`})}>Назначить следующий шаг</Button>}</div></article>)}</Section>}
        <p className="field-hint">События построены по текущей версии расписания. Исторические отметки сохраняются отдельно. Внешняя доставка напоминаний не подключена.</p>
      </>}
    </Section>
    {!readOnly && <Section title={editing ? "Изменить личную позицию" : "Добавить свою позицию"}>
      <form onSubmit={save}>
        <label className="field">Название<input required maxLength={300} value={label} onChange={e => setLabel(e.target.value)} /></label>
        <label className="field">Своё описание / инструкция<textarea maxLength={2000} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
        <label className="field">Расписание своими словами<textarea required maxLength={1500} value={text} onChange={e => setText(e.target.value)} /></label>
        <label className="field">Тип учёта<select value={kind} onChange={e => setKind(e.target.value)}><option value="fixed">Дни недели и фиксированные времена</option><option value="as_needed">По потребности · описание</option><option value="description">Другое произвольное расписание · описание</option></select></label>
        {kind === "fixed" && <><label className="field">Время через запятую · например 08:30, 20:00<input required value={times} onChange={e => setTimes(e.target.value)} /></label><fieldset className="weekdays"><legend>Дни недели</legend>{["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((d,i) => <label key={d}><input type="checkbox" checked={weekdays.includes(i)} onChange={() => setWeekdays(days => days.includes(i) ? days.filter(v => v !== i) : [...days,i])} />{d}</label>)}</fieldset></>}
        <label className="field">Часовой пояс<input required value={zone} onChange={e => setZone(e.target.value)} /></label>
        <div className="form-grid"><label className="field">С даты<input type="date" required value={start} onChange={e => setStart(e.target.value)} /></label><label className="field">По дату · необязательно<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label></div>
        <label className="checkbox-label"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Активная личная позиция</label>
        <div className="button-row"><Button disabled={busy}>Сохранить личное расписание</Button>{editing && <Button type="button" variant="ghost" onClick={() => edit(null)}>Отменить редактирование</Button>}</div>
      </form>
    </Section>}
  </>;
}
