import { useRef, useState, type FormEvent } from "react";
import { send, useApi } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, type Notify } from "./UI";

export type CareTask = {id: number; patient_id: number; patient_name?: string; title: string; doctor_id: number;
  assigned_to_id: number; kind: string; status: string; action_result: string; due_at: string | null;
  follow_up_at: string | null; source_type?: string; source_id?: number | null;
  verification_status: string; verification_comment?: string};
type Source = {type: string; id: number; label: string};
type Status = {status: string; revision: number; reason?: string; created_at?: string; source?: string};
type Care = {treatment: Status; history: Status[]; mis: {as_of: string; data: null | {
  scenario: {title: string; description: string; expected_route: string};
  synthetic_survey_sessions?: {assigned_at: string; opened_at: string | null; submitted_at: string | null}[];
  recommended_contact: null | {start: string; end: string};
  visits: {id: string; scheduled_at: string; occurred_at: string | null; status: string; initiator: string | null; reason: string}[]}}};
export const treatmentLabels: Record<string, string> = {in_progress: "В процессе", completed: "Завершил лечение", refused: "Отказался", unknown: "Врач ещё не определил"};
const verificationLabels: Record<string, string> = {pending: "Результат ещё не проверен", resolved: "Затруднение устранено по проверке врача", not_resolved: "Затруднение сохраняется", unknown: "Результат неизвестен"};
const sourceLabels: Record<string,string> = {manual:"Ручное наблюдение",message:"Сообщение",assessment:"Опросник состояния",survey_submission:"Ответ на опрос",adherence_report:"Самоотчёт о рекомендации",alert:"Событие для оценки",doctor_note:"Наблюдение врача",medication_log:"Лекарственный самоотчёт",diary_entry:"Запись дневника"};

function TaskItem({task, operational, reload, notify}: {task: CareTask; operational: boolean; reload: () => void; notify: Notify}) {
  const [result, setResult] = useState(task.action_result);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("unknown");
  const [busy, setBusy] = useState(false);
  async function act(verify = false) {
    setBusy(true);
    try {
      await send(`/tasks/${task.id}${verify ? "/verify" : ""}`, verify ? {status, comment} : {status: "done", action_result: result}, verify ? "POST" : "PATCH");
      reload(); notify(verify ? "Повторная проверка сохранена" : "Выполненное действие сохранено; результат проверяет врач");
    } catch (e) { notify(e instanceof Error ? e.message : "Не удалось сохранить", "error"); }
    finally { setBusy(false); }
  }
  return <article className="diary-entry">
    <div className="button-row"><Badge tone={task.status === "done" ? "good" : "warn"}>{task.status === "done" ? "Действие выполнено" : "В работе"}</Badge><Badge tone="muted">{task.kind === "organization" ? "Организационная" : "Клиническая"}</Badge></div>
    <h3>{task.title}</h3>{task.patient_name && <p>{task.patient_name}</p>}
    <p className="field-hint">{task.due_at ? `Срок: ${date(task.due_at)}. ` : "Срок не задан. "}{task.follow_up_at ? `Повторная проверка: ${date(task.follow_up_at)}` : "Дата повторной проверки не задана"}</p>
    {!operational && <p className="field-hint">Источник: {sourceLabels[task.source_type ?? "manual"]}{task.source_id ? ` #${task.source_id}` : ""} · исполнитель #{task.assigned_to_id}</p>}
    {task.verification_status === "pending" ? <>
      <label className="field">Что сделано?<textarea maxLength={2000} value={result} onChange={e => setResult(e.target.value)} /></label>
      <Button variant="secondary" disabled={busy || !result.trim()} onClick={() => act()}>{task.status === "done" ? "Сохранить описание действия" : "Действие выполнено"}</Button>
      {!operational && task.status === "done" && <div className="follow-up-form">
        <label className="field">Результат повторной проверки<select value={status} onChange={e => setStatus(e.target.value)}><option value="unknown">Пока неизвестен</option><option value="resolved">Затруднение устранено</option><option value="not_resolved">Затруднение сохраняется</option></select></label>
        <label className="field">Основание врача<textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} placeholder="Что сообщил пациент, что удалось проверить" /></label>
        <Button disabled={busy || !comment.trim()} onClick={() => act(true)}>Сохранить проверку результата</Button>
      </div>}
    </> : <><p className="preserve">{task.action_result}</p><Badge tone="muted">{verificationLabels[task.verification_status]}</Badge>{!operational && <p className="preserve">{task.verification_comment}</p>}</>}
  </article>;
}

export function CareWorkflow({patientId, source, notify}: {patientId: number; source: Source | null; notify: Notify}) {
  const care = useApi<Care>(`/patients/${patientId}/care`);
  const tasks = useApi<CareTask[]>(`/patients/${patientId}/tasks`);
  const team = useApi<{id: number; name: string; role: string}[]>("/coordination/team");
  const [outcome, setOutcome] = useState("in_progress"), [reason, setReason] = useState("");
  const [title, setTitle] = useState(""), [kind, setKind] = useState("clinical"), [assignee, setAssignee] = useState("");
  const [due, setDue] = useState(""), [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const statusRequest = useRef({signature: "", id: ""}), taskRequest = useRef({signature: "", id: ""});
  async function saveOutcome(e: FormEvent) {
    e.preventDefault(); if (!care.data) return;
    const signature = JSON.stringify([outcome, reason, care.data.treatment.revision]);
    if (statusRequest.current.signature !== signature) statusRequest.current = {signature, id: crypto.randomUUID()};
    setBusy(true);
    try { await send(`/patients/${patientId}/treatment-status`, {status: outcome, reason, expected_revision: care.data.treatment.revision, client_request_id: statusRequest.current.id}); care.reload(); setReason(""); notify("Исход лечения определён врачом"); }
    catch (e) { notify(e instanceof Error ? e.message : "Не удалось сохранить исход", "error"); }
    finally { setBusy(false); }
  }
  async function saveTask(e: FormEvent) {
    e.preventDefault();
    const data = {title, kind, assigned_to_id: assignee ? Number(assignee) : null, source_type: source?.type ?? "manual", source_id: source?.id ?? null, due_at: due ? new Date(due).toISOString() : null, follow_up_at: followUp ? new Date(followUp).toISOString() : null};
    const signature = JSON.stringify(data);
    if (taskRequest.current.signature !== signature) taskRequest.current = {signature, id: crypto.randomUUID()};
    setBusy(true);
    try { await send(`/patients/${patientId}/tasks`, {...data, client_request_id: taskRequest.current.id}); tasks.reload(); setTitle(""); taskRequest.current = {signature: "", id: ""}; notify("Задача связана с источником и назначена исполнителю"); }
    catch (e) { notify(e instanceof Error ? e.message : "Не удалось создать задачу", "error"); }
    finally { setBusy(false); }
  }
  const fixture = care.data?.mis.data;
  return <>
    <Section title="Исход лечения определяет врач">
      <ErrorBox message={care.error} retry={care.reload} />
      {care.loading ? <Loading /> : care.data && <>
        <Badge tone="purple">{treatmentLabels[care.data.treatment.status]}</Badge>
        <p className="field-hint">Не вычисляется по последнему визиту, молчанию или скорости ответа. Решение сохраняется в Compass; МИС не изменяется.</p>
        <form onSubmit={saveOutcome}>
          <label className="field">Новое решение<select value={outcome} onChange={e => setOutcome(e.target.value)}>{Object.entries(treatmentLabels).filter(([k]) => k !== "unknown").map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field">Основание<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
          <Button disabled={busy}>Сохранить решение врача</Button>
        </form>
        <details><summary>История решений ({care.data.history.length})</summary>{care.data.history.map(row => <p key={row.revision}>{date(row.created_at!)} · {treatmentLabels[row.status]} · врач #{(row as Status & {doctor_id: number}).doctor_id}<br />{row.reason}{row.source === "synthetic_doctor_fixture" && " · синтетическое решение"}</p>)}</details>
      </>}
    </Section>
    {fixture && <Section title="Сценарий и события МИС · синтетический JSON">
      <h3>{fixture.scenario.title}</h3><p>{fixture.scenario.description}</p><p className="field-hint">{fixture.scenario.expected_route}</p>
      {fixture.synthetic_survey_sessions && <details open><summary>Наблюдения учебного сценария</summary><p>Завершено {fixture.synthetic_survey_sessions.filter(s => s.submitted_at).length} из {fixture.synthetic_survey_sessions.length} форм.</p><div className="table-wrap"><table><thead><tr><th>Назначен</th><th>Открыт</th><th>Завершён</th><th>Интервал</th></tr></thead><tbody>{fixture.synthetic_survey_sessions.map((s,i) => <tr key={i}><td>{date(s.assigned_at)}</td><td>{s.opened_at ? date(s.opened_at) : "Нет сведений"}</td><td>{s.submitted_at ? date(s.submitted_at) : "Нет ответа"}</td><td>{s.opened_at && s.submitted_at ? `${(new Date(s.submitted_at).getTime()-new Date(s.opened_at).getTime())/1000} с` : "Неизвестно"}</td></tr>)}</tbody></table></div><p className="field-hint">Синтетические времена из JSON. Они не подмешиваются в серверную воронку приложения. Интервал включает перерывы и не определяет выраженность тревоги.</p></details>}
      {fixture.recommended_contact ? <p>Рекомендованное окно: {date(fixture.recommended_contact.start)} — {date(fixture.recommended_contact.end)}</p> : <p className="muted">Рекомендованное окно не задано</p>}
      {fixture.visits.map(v => <article className="diary-entry" key={v.id}><strong>{({attended: "Состоялся", scheduled: "Запланирован", cancelled: "Отменён", rescheduled: "Перенесён", no_show: "Неявка по данным источника"} as Record<string,string>)[v.status] ?? "Неизвестно"}</strong> · {date(v.scheduled_at)}<p>{v.reason}</p>{v.initiator && <small>Инициатор: {v.initiator === "clinic" ? "клиника" : "пациент"}</small>}</article>)}
      {!fixture.visits.length && <p className="muted">События визитов не предоставлены</p>}
    </Section>}
    <Section title="От затруднения к действию и проверке">
      <ErrorBox message={tasks.error || team.error} retry={() => { tasks.reload(); team.reload(); }} />
      <form onSubmit={saveTask}>
        {source ? <p className="source-chip">Источник: {source.label}</p> : <p className="field-hint">Ручная задача. Для связи выберите ответ/сообщение во вкладке обратной связи.</p>}
        <label className="field">Следующее действие<input required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="field">Тип задачи<select value={kind} onChange={e => {setKind(e.target.value); setAssignee("");}}><option value="clinical">Клиническая · только врачу</option><option value="organization">Организационная · врачу или координатору</option></select></label>
        <label className="field">Исполнитель<select value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Лечащий врач</option>{team.data?.filter(u => kind === "organization" || u.role === "doctor").map(u => <option key={u.id} value={u.id}>{u.name} · {u.role === "coordinator" ? "координатор" : "врач"}</option>)}</select></label>
        {kind === "organization" && <p className="field-hint">Координатор увидит имя пациента, название и описание действия. Не включайте клинические подробности; исходные ответы и приватные заметки ему недоступны.</p>}
        <div className="form-grid"><label className="field">Срок действия<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label><label className="field">Повторная проверка<input type="datetime-local" value={followUp} onChange={e => setFollowUp(e.target.value)} /></label></div><p className="field-hint">Время в часовом поясе этого устройства.</p>
        <Button disabled={busy || !title.trim()}>Назначить следующий шаг</Button>
      </form>
      {tasks.data?.map(task => <TaskItem key={task.id} task={task} operational={false} reload={tasks.reload} notify={notify} />)}
      {tasks.data?.length === 0 && <Empty title="Следующих шагов пока нет" />}
    </Section>
  </>;
}

export function CoordinatorHome({notify}: {notify: Notify}) {
  const tasks = useApi<CareTask[]>("/coordination/tasks", 15000);
  return <><Heading eyebrow="Организационная поддержка" title="Назначенные мне задачи">Только задачи, которые врач поручил вам. Медицинские ответы, заметки и исходы лечения доступны врачу.</Heading><ErrorBox message={tasks.error} retry={tasks.reload} />{tasks.loading ? <Loading /> : tasks.data && <Section title="Работа с затруднениями">{!tasks.data.length && <Empty title="Назначенных задач пока нет" />}{tasks.data.map(task => <TaskItem key={`${task.id}-${task.verification_status}`} task={task} operational reload={tasks.reload} notify={notify} />)}</Section>}</>;
}
