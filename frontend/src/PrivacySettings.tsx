import { useEffect, useRef, useState, type FormEvent } from "react";
import { send, useApi } from "./api";
import { Badge, Button, ErrorBox, Section, date } from "./UI";

type Policy = {revision: number; min_group_size: number | null; source: string; notice: string;
  history: {revision: number; min_group_size: number | null; actor_id: number; reason: string; created_at: string}[]};

export function PrivacySettings({reload}: {reload: () => void}) {
  const policy = useApi<Policy>("/admin/privacy-policy");
  const [size, setSize] = useState(""), [reason, setReason] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const request = useRef({signature: "", id: ""});
  useEffect(() => { if (policy.data) setSize(policy.data.min_group_size === null ? "" : String(policy.data.min_group_size)); }, [policy.data]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (!policy.data) return;
    const data = {min_group_size: size ? Number(size) : null, reason, expected_revision: policy.data.revision};
    const signature = JSON.stringify(data);
    if (request.current.signature !== signature) request.current = {signature, id: crypto.randomUUID()};
    setBusy(true); setError("");
    try { await send("/admin/privacy-policy", {...data, client_request_id: request.current.id}, "PUT"); policy.reload(); reload(); setReason(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить политику"); }
    finally { setBusy(false); }
  }
  return <Section title="Правила публикации сводки · администратор">
    <ErrorBox message={policy.error || error} retry={policy.reload} />
    {policy.data && <><Badge tone="purple">Порог: {policy.data.min_group_size ?? "не настроен"} · версия {policy.data.revision}</Badge>
      <p className="field-hint">{policy.data.notice}</p><p className="field-hint">Порог 1 — показ без подавления малых групп на синтетическом стенде. Пустое значение снова скрывает числовую сводку. Эта настройка не открывает карточки, дневники и клиническую переписку.</p>
      <form onSubmit={save}><div className="form-grid"><label className="field">Минимум разных пациентов в группе<input type="number" min={1} max={100000} step={1} value={size} onChange={e => setSize(e.target.value)} placeholder={String(policy.data.min_group_size ?? "Не задан")} /></label><label className="field">Основание изменения<input required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label></div><Button disabled={busy || !reason.trim()}>Применить правила и обновить сводку</Button></form>
      <details><summary>История правил ({policy.data.history.length})</summary>{policy.data.history.map(r => <p key={r.revision}>{date(r.created_at)} · порог {r.min_group_size ?? "не задан"} · администратор #{r.actor_id}<br />{r.reason}</p>)}</details>
    </>}
  </Section>;
}
