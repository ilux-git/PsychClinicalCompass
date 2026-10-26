import { createRequestId } from "./requestId";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, send, useApi } from "./api";
import { Badge, Button, ErrorBox, Section, date } from "./UI";
import { useUnsavedForm, type LeavePrompt } from "./NavigationGuard";

const privacyPrompt:LeavePrompt={eyebrow:"Правила сводки",title:"Продолжить настройку публикации?",message:"Изменения порога и основание ещё не применены. При переходе без сохранения текущий ввод будет потерян; действующие правила останутся прежними.",stayLabel:"Продолжить настройку"};
const replacePrompt:LeavePrompt={eyebrow:"Правила сводки",title:"Загрузить действующие правила?",message:"Текущий ввод будет заменён сохранённой на сервере версией. Действующие правила публикации при этом не изменятся.",stayLabel:"Оставить мой ввод",discardLabel:"Заменить текущий ввод"};

type Policy = {revision: number; min_group_size: number | null; source: string; notice: string;
  history: {revision: number; min_group_size: number | null; actor_id: number; reason: string; created_at: string}[]};

export function PrivacySettings({reload}: {reload: () => void}) {
  const policy = useApi<Policy>("/admin/privacy-policy");
  const [size, setSize] = useState(""), [reason, setReason] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [baseline,setBaseline]=useState<{revision:number;size:string}|null>(null);
  const [saved,setSaved]=useState(false);
  const dirty=Boolean(baseline&&(size!==baseline.size||reason));
  const {clear,confirm}=useUnsavedForm({dirty,pending:busy,prompt:privacyPrompt});
  const request = useRef({signature: "", id: ""});
  useEffect(() => {if(policy.data&&!baseline){const next=policy.data.min_group_size===null?"":String(policy.data.min_group_size);setSize(next);setBaseline({revision:policy.data.revision,size:next});}},[policy.data,baseline]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (!baseline || busy) return;
    const data = {min_group_size: size ? Number(size) : null, reason, expected_revision: baseline.revision};
    const signature = JSON.stringify(data);
    if (request.current.signature !== signature) request.current = {signature, id: createRequestId()};
    setBusy(true); setError("");setSaved(false);
    try {const updated=await send<Policy>("/admin/privacy-policy", {...data, client_request_id: request.current.id}, "PUT");const next=updated.min_group_size===null?"":String(updated.min_group_size);setBaseline({revision:updated.revision,size:next});setSize(next);clear();policy.reload(); reload(); setReason("");setSaved(true);}
    catch (e) {setError(e instanceof Error ? e.message : "Не удалось сохранить политику");if(e instanceof ApiError&&e.status===409)policy.reload();}
    finally { setBusy(false); }
  }
  return <Section title="Правила публикации сводки · администратор">
    <ErrorBox message={policy.error || error} retry={policy.reload} />
    {policy.data && <><Badge tone="purple">Порог: {policy.data.min_group_size ?? "не настроен"} · версия {policy.data.revision}</Badge>
      <p className="field-hint">{policy.data.notice}</p><p className="field-hint">Порог 1 — показ без подавления малых групп на синтетическом стенде. Пустое значение снова скрывает числовую сводку. Эта настройка не открывает карточки, дневники и клиническую переписку.</p>
      {baseline&&policy.data.revision!==baseline.revision&&<div className="task-conflict"><p>Правила обновились после открытия формы. Текущий ввод сохранён; перед применением проверьте новую версию.</p><Button variant="secondary" onClick={()=>confirm(()=>{const next=policy.data!.min_group_size===null?"":String(policy.data!.min_group_size);setSize(next);setReason("");setBaseline({revision:policy.data!.revision,size:next});setError("");},replacePrompt)}>Загрузить действующие правила</Button></div>}
      <form onSubmit={save}><fieldset className="form-fields" disabled={busy} aria-busy={busy}><div className="form-grid"><label className="field">Минимум разных пациентов в группе<input type="number" min={1} max={100000} step={1} value={size} onChange={e => {setSize(e.target.value);setSaved(false);}} placeholder={String(policy.data.min_group_size ?? "Не задан")} /></label><label className="field">Основание изменения<input required maxLength={1000} value={reason} onChange={e => {setReason(e.target.value);setSaved(false);}} /></label></div><Button disabled={busy || !reason.trim() || policy.data.revision!==baseline?.revision}>{busy?"Применяем…":"Применить правила и обновить сводку"}</Button></fieldset></form>
      {saved&&<p className="field-hint" role="status">Правила применены. Сводка обновляется с новым порогом.</p>}
      <details><summary>История правил ({policy.data.history.length})</summary>{policy.data.history.map(r => <p key={r.revision}>{date(r.created_at)} · порог {r.min_group_size ?? "не задан"} · администратор #{r.actor_id}<br />{r.reason}</p>)}</details>
    </>}
  </Section>;
}
