import { createRequestId } from "./requestId";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { send, useApi, type DiaryEntry } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, type Notify } from "./UI";
import { useUnsavedForm, type LeavePrompt } from "./NavigationGuard";
import { ParticipationReceipt, type ParticipationConfirmation } from "./ParticipationReceipt";
import { Disclosure, useInteractionMotion } from "./Interaction";

const diaryPrompt:LeavePrompt={eyebrow:"Несохранённая запись",title:"Вернуться к записи дневника?",message:"Запись ещё не сохранена. При переходе без сохранения текущий текст и выбранные наблюдения будут потеряны.",stayLabel:"Продолжить запись"};

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
      {!entries.data.entries.length && <Empty title="Открытых Вам записей пока нет" />}
      {entries.data.entries.map((entry) => <article className="diary-entry" key={entry.id}>
        <Observation entry={entry} />
        {onSource && <Button variant="secondary" onClick={() => onSource({type:"diary_entry",id:entry.id,label:`Запись дневника #${entry.id}`})}>Назначить следующий шаг</Button>}
      </article>)}
    </>}
  </Section>;
}

export function PatientDiary({patientId, notify, progress}: {patientId: number; notify: Notify; progress?:()=>void}) {
  const entries = useApi<Entries>(`/patients/${patientId}/diary`);
  const [text, setText] = useState("");
  const [shared, setShared] = useState(false);
  const [observed, setObserved] = useState(nowLocal), [kind, setKind] = useState("moment");
  const [feeling, setFeeling] = useState(""), [impact, setImpact] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved,setSaved]=useState<(DiaryEntry&ParticipationConfirmation)|null>(null);
  const [saveError,setSaveError]=useState("");
  const [invalidReveal,setInvalidReveal]=useState(0);
  const {moving}=useInteractionMotion();
  const savedPanel=useRef<HTMLDivElement>(null);
  const savedResult=useRef<HTMLHeadingElement>(null),errorResult=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!saved)return;
    savedResult.current?.focus({preventScroll:true});
    savedPanel.current?.scrollIntoView({block:"nearest",behavior:moving?"smooth":"instant"});
  },[saved?.id,moving]);
  useEffect(()=>{if(saveError)errorResult.current?.querySelector<HTMLElement>('.error-box')?.focus();},[saveError]);
  const textInput=useRef<HTMLTextAreaElement>(null);
  const dirty=Boolean(text || shared || feeling || impact || kind!=="moment");
  useEffect(()=>{if(dirty)setSaved(null);},[dirty]);
  const {clear:clearGuard} = useUnsavedForm({dirty,pending:busy,prompt:diaryPrompt,focus:()=>textInput.current?.focus()});
  const request = useRef({signature: "", id: ""});
  async function save(event: FormEvent) {
    event.preventDefault();
    const data = {text, shared_with_doctor: shared, observed_at: new Date(observed).toISOString(), observation_kind: kind,
      feeling: feeling || null, daily_impact: impact || null};
    const signature = JSON.stringify(data);
    if (request.current.signature !== signature) request.current = {signature, id: createRequestId()};
    setSaveError("");setSaved(null);
    setBusy(true);
    try {
      const response=await send<DiaryEntry&ParticipationConfirmation>("/diary/entries", {...data, client_request_id: request.current.id});
      setSaved(response);
      setText(""); setShared(false); setFeeling(""); setImpact(""); setKind("moment"); setObserved(nowLocal()); clearGuard(); request.current = {signature: "", id: ""}; entries.reload();
    } catch (failure) { const message=failure instanceof Error?failure.message:"Не удалось сохранить запись";setSaveError(message); }
    finally { setBusy(false); }
  }
  async function sharing(entry: DiaryEntry) {
    setBusy(true);
    try {
      const response=await send<DiaryEntry>(`/diary/entries/${entry.id}/sharing`, {shared_with_doctor: !entry.shared_with_doctor}, "PATCH");
      setSaved(current=>current?.id===entry.id?{...current,shared_with_doctor:response.shared_with_doctor}:current);
      entries.reload(); notify(entry.shared_with_doctor ? "Доступ врача к записи отключён" : "Запись доступна лечащему врачу");
    } catch (failure) { notify(failure instanceof Error ? failure.message : "Не удалось изменить доступ", "error"); }
    finally { setBusy(false); }
  }
  return <>
    <Heading eyebrow="По желанию" title="Мой дневник">Записывайте, как проходит день и что влияет на самочувствие. Заполнение необязательно.</Heading>
    <Section title="Новая запись">
      <form className="diary-form" onSubmit={save} onInvalidCapture={()=>setInvalidReveal(value=>value+1)}>
        <div ref={errorResult}><ErrorBox message={saveError}/></div>
        <fieldset className="form-fields" disabled={busy} aria-busy={busy}>
        <label className="field">Что хотите сохранить?
          <textarea ref={textInput} rows={4} maxLength={4000} placeholder="Можно всего несколько слов" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="checkbox-label"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Поделиться этой записью с лечащим врачом</label>
        <p className="field-hint">Без отметки запись видна только Вам. Доступ можно изменить позже. Дневник не просматривается врачом круглосуточно.</p>
        <Disclosure title="Добавить наблюдения или уточнить время" revealRequest={invalidReveal} focusTarget='input[type="datetime-local"]'>
          <label className="field">Как Вы себя чувствовали? · необязательно<select value={feeling} onChange={e => setFeeling(e.target.value)}><option value="">Не отмечаю</option>{Object.entries(feelings).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field">Влияние на повседневные дела · необязательно<select value={impact} onChange={e => setImpact(e.target.value)}><option value="">Не отмечаю</option>{Object.entries(impacts).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <div className="form-grid"><label className="field">Когда наблюдали?<input required type="datetime-local" value={observed} onChange={e => setObserved(e.target.value)} /></label>
          <label className="field">О чём запись?<select value={kind} onChange={e => setKind(e.target.value)}><option value="moment">Состояние в этот момент</option><option value="day_summary">Итог дня</option></select></label></div>
          <p className="field-hint">Свободное наблюдение, а не диагностическая шкала. Можно выбрать наблюдение или оставить только текст.</p>
        </Disclosure>
        <Button disabled={busy || (!text.trim() && !feeling && !impact)} type="submit">{busy?"Сохраняем…":"Сохранить запись"}</Button>
        </fieldset>
      </form>
      {saved&&<div ref={savedPanel} className="diary-saved-result">
        <h3 ref={savedResult} tabIndex={-1}>Запись сохранена</h3><p>{saved.shared_with_doctor?"Эта запись доступна лечащему врачу.":"Эта запись остаётся личной. Поделиться с врачом можно позже."}</p>
        <ParticipationReceipt result={saved} progress={progress}/>
      </div>}
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
