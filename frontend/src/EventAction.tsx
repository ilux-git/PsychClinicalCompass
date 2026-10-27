import { createRequestId } from "./requestId";
import {accountName} from "./presentation";
import {clinicInputToIso} from "./clinicTime";
import { useRef, useState, type FormEvent } from "react";
import { send, useApi } from "./api";
import { Button, ErrorBox, type Notify } from "./UI";
import { useUnsavedForm, type LeavePrompt } from "./NavigationGuard";

const actionPrompt:LeavePrompt={eyebrow:"Следующий шаг по событию",title:"Продолжить назначение действия?",message:"Задача и ответ пациенту ещё не отправлены. При переходе без сохранения текущий ввод будет потерян.",stayLabel:"Продолжить назначение"};

export function EventAction({alertId,notify,done,scope}: {alertId:number; notify:Notify; done:()=>void;scope?:string}) {
  const team = useApi<{id:number;name:string;role:string}[]>("/coordination/team");
  const [title,setTitle] = useState(""), [kind,setKind] = useState("clinical"), [assignee,setAssignee] = useState("");
  const [reply,setReply] = useState(""), [due,setDue] = useState(""), [followUp,setFollowUp] = useState("");
  const [busy,setBusy] = useState(false), [result,setResult] = useState<{task_id:number;reply_message_id:number|null}|null>(null);
  const request = useRef({signature:"",id:""});
  const {clear}=useUnsavedForm({dirty:!result&&Boolean(title||reply||due||followUp||assignee||kind!=="clinical"),pending:busy,prompt:actionPrompt,scope});
  async function save(e:FormEvent) {
    e.preventDefault();
    const payload = {title,kind,assigned_to_id:assignee ? Number(assignee) : null,reply,
      due_at:due ? clinicInputToIso(due) : null,follow_up_at:followUp ? clinicInputToIso(followUp) : null};
    const signature = JSON.stringify(payload);
    if (request.current.signature !== signature) request.current = {signature,id:createRequestId()};
    setBusy(true);
    try {
      const saved = await send<{task_id:number;reply_message_id:number|null}>(`/alerts/${alertId}/actions`,{...payload,client_request_id:request.current.id});
      clear();setResult(saved); done(); notify("Событие принято, задача назначена"+(saved.reply_message_id ? ", ответ сохранён в диалоге" : ""));
    } catch(error) {notify(error instanceof Error ? error.message : "Не удалось сохранить действие","error");}
    finally {setBusy(false);}
  }
  if (result) return <div className="event-action-result"><strong>Создана задача #{result.task_id}</strong><p>{result.reply_message_id ? "Ответ сохранён в переписке пациента." : "Сообщение пациенту не отправлялось."} Действие и результат ещё предстоит зафиксировать в плане и задачах.</p><Button variant="secondary" onClick={()=>{setResult(null);setTitle("");setKind("clinical");setAssignee("");setReply("");setDue("");setFollowUp("");request.current={signature:"",id:""};}}>Добавить ещё одно действие</Button></div>;
  return <form className="event-action-form" onSubmit={save}>
    <fieldset className="form-fields" disabled={busy} aria-busy={busy}>
    <h4>Согласовать следующий шаг</h4>
    <p className="field-hint">Задача, ответ и принятие события сохранятся вместе. Клиническая оценка и результат лечения остаются отдельными решениями.</p>
    <label className="field">Следующее действие по событию<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} maxLength={300} required/></label>
    <div className="form-grid">
      <label className="field">Тип следующего действия<select value={kind} onChange={e=>{setKind(e.target.value);setAssignee("");}}><option value="clinical">Клиническое · лечащему врачу</option><option value="organization">Организационное · врачу или координатору</option></select></label>
      <label className="field">Исполнитель следующего действия<select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Лечащий врач</option>{team.data?.filter(u=>kind === "organization" || u.role === "doctor").map(u=><option key={u.id} value={u.id}>{accountName(u.name)} · {u.role === "doctor" ? "врач" : "координатор"}</option>)}</select></label>
    </div>
    <ErrorBox message={team.error} retry={team.reload}/>
    <div className="form-grid"><label className="field">Срок следующего действия<input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label><label className="field">Дата проверки результата<input type="datetime-local" value={followUp} onChange={e=>setFollowUp(e.target.value)}/></label></div>
    <p className="field-hint">Координатор видит организационную задачу, без исходного клинического сообщения.</p>
    <details className="source-help"><summary>Часовой пояс</summary><p>Даты и сроки вводятся по Москве.</p></details>
    <label className="field">Ответ пациенту · необязательно<textarea value={reply} onChange={e=>setReply(e.target.value)} maxLength={4096} rows={3}/><small>Текст появится в чате с пациентом.</small></label>
    <Button disabled={busy || !title.trim()}>{busy?"Сохраняем…":reply.trim() ? "Назначить задачу и отправить ответ" : "Назначить задачу по событию"}</Button>
    </fieldset>
  </form>;
}
