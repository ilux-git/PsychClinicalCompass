import { useRef, useState, type FormEvent } from "react";
import { send, useApi, type DiaryEntry } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, type Notify } from "./UI";

type Entries = {entries: DiaryEntry[]};
const feelings: Record<string,string> = {very_difficult: "Очень тяжело", difficult: "Тяжело", neutral: "Нейтрально", good: "Хорошо", very_good: "Очень хорошо"};
const impacts: Record<string,string> = {no_interference: "Не мешало повседневным делам", some_interference: "Частично мешало", strong_interference: "Сильно мешало", cannot_assess: "Не могу оценить"};
function nowLocal() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function Observation({entry}: {entry: DiaryEntry}) {
  return <><small className="muted">{entry.observed_at ? `Наблюдение: ${date(entry.observed_at)} · ${entry.observation_kind === "day_summary" ? "итог дня" : "в этот момент"}` : "Время наблюдения не указано"} · внесено {date(entry.created_at)}</small>
    {entry.feeling && <p><Badge tone="purple">{feelings[entry.feeling]}</Badge></p>}{entry.daily_impact && <p>{impacts[entry.daily_impact]}</p>}{entry.text && <p className="preserve">{entry.text}</p>}</>;
}

export function SharedDiary({patientId, onSource}: {patientId: number; onSource?: (source: {type:string;id:number;label:string}) => void}) {
  const entries = useApi<Entries>(`/patients/${patientId}/diary`, 15000);
  return <Section title="Дневник, которым поделился пациент">
    <p className="field-hint">Только записи, для которых пациент включил доступ лечащего врача. Отсутствие записи не означает отсутствие жалоб.</p>
    <ErrorBox message={entries.error} retry={entries.reload} />
    {entries.loading ? <Loading /> : entries.data && <>
      {!entries.data.entries.length && <Empty title="Открытых вам записей пока нет" />}
      {entries.data.entries.map((entry) => <article className="diary-entry" key={entry.id}>
        <Observation entry={entry} />
        {onSource && <Button variant="secondary" onClick={() => onSource({type:"diary_entry",id:entry.id,label:`Запись дневника #${entry.id}`})}>Назначить следующий шаг</Button>}
      </article>)}
    </>}
  </Section>;
}

export function PatientDiary({patientId, notify}: {patientId: number; notify: Notify}) {
  const entries = useApi<Entries>(`/patients/${patientId}/diary`);
  const [text, setText] = useState("");
  const [shared, setShared] = useState(false);
  const [observed, setObserved] = useState(nowLocal), [kind, setKind] = useState("moment");
  const [feeling, setFeeling] = useState(""), [impact, setImpact] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef({signature: "", id: ""});
  async function save(event: FormEvent) {
    event.preventDefault();
    const data = {text, shared_with_doctor: shared, observed_at: new Date(observed).toISOString(), observation_kind: kind,
      feeling: feeling || null, daily_impact: impact || null};
    const signature = JSON.stringify(data);
    if (request.current.signature !== signature) request.current = {signature, id: crypto.randomUUID()};
    setBusy(true);
    try {
      await send("/diary/entries", {...data, client_request_id: request.current.id});
      setText(""); setShared(false); setFeeling(""); setImpact(""); setObserved(nowLocal()); request.current = {signature: "", id: ""}; entries.reload();
      notify("Запись дневника сохранена");
    } catch (failure) { notify(failure instanceof Error ? failure.message : "Не удалось сохранить запись", "error"); }
    finally { setBusy(false); }
  }
  async function sharing(entry: DiaryEntry) {
    setBusy(true);
    try {
      await send(`/diary/entries/${entry.id}/sharing`, {shared_with_doctor: !entry.shared_with_doctor}, "PATCH");
      entries.reload(); notify(entry.shared_with_doctor ? "Доступ врача к записи отключён" : "Запись доступна лечащему врачу");
    } catch (failure) { notify(failure instanceof Error ? failure.message : "Не удалось изменить доступ", "error"); }
    finally { setBusy(false); }
  }
  return <>
    <Heading eyebrow="По желанию" title="Мой дневник">Записывайте, как проходит день и что влияет на самочувствие. Заполнение необязательно.</Heading>
    <Section title="Новая запись">
      <form onSubmit={save}>
        <div className="form-grid"><label className="field">Когда наблюдали?<input required type="datetime-local" value={observed} onChange={e => setObserved(e.target.value)} /></label>
        <label className="field">О чём запись?<select value={kind} onChange={e => setKind(e.target.value)}><option value="moment">Состояние в этот момент</option><option value="day_summary">Итог дня</option></select></label></div>
        <label className="field">Как вы себя чувствовали? · необязательно<select value={feeling} onChange={e => setFeeling(e.target.value)}><option value="">Не отмечаю</option>{Object.entries(feelings).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Влияние на повседневные дела · необязательно<select value={impact} onChange={e => setImpact(e.target.value)}><option value="">Не отмечаю</option>{Object.entries(impacts).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <p className="field-hint">Свободное наблюдение, а не диагностическая шкала. Можно выбрать наблюдение или оставить только текст.</p>
        <label className="field">Что хотите сохранить?
          <textarea rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="checkbox-label"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Поделиться этой записью с лечащим врачом</label>
        <p className="field-hint">Без отметки запись видна только вам. Доступ можно изменить позже. Дневник не просматривается врачом круглосуточно.</p>
        <Button disabled={busy || (!text.trim() && !feeling && !impact)} type="submit">Сохранить запись</Button>
      </form>
    </Section>
    <Section title="Мои записи">
      <ErrorBox message={entries.error} retry={entries.reload} />
      {entries.loading ? <Loading /> : entries.data && <>
        {!entries.data.entries.length && <Empty title="Записей пока нет" />}
        {entries.data.entries.map((entry) => <article className="diary-entry" key={entry.id}>
          <Badge tone={entry.shared_with_doctor ? "purple" : "muted"}>{entry.shared_with_doctor ? "Доступна лечащему врачу" : "Только мне"}</Badge>
          <Observation entry={entry} />
          <Button variant="secondary" disabled={busy} onClick={() => sharing(entry)}>{entry.shared_with_doctor ? "Отключить доступ врача" : "Поделиться с врачом"}</Button>
        </article>)}
        <p className="field-hint">Последние 100 записей. Отключение доступа скрывает запись в дневнике врача; уже прочитанное или сохранённое врачом отдельно не удаляется автоматически.</p>
      </>}
    </Section>
  </>;
}
