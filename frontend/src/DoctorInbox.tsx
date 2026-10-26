import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, ArrowRight } from "lucide-react";
import { send, useApi, type ReviewTiming } from "./api";
import { ReviewDeadlines, reviewLabels } from "./ClinicalReview";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, date } from "./UI";
import { Disclosure } from "./Interaction";
import { useReturnFocus, useViewState } from "./ViewState";

type InboxItem = {
  id: number;
  patient_id: number;
  patient_name: string;
  reason: string;
  status: string;
  rule_id: string;
  rule_version: string;
  source_kind: "assessment" | "support_request" | "clinical_assessment";
  severity?:string;
  review_timing?:ReviewTiming;
  event_created_at: string;
  created_at: string;
  presented_at: string | null;
  acknowledged_at: string | null;
  latency_seconds: {
    event_to_alert: number | null;
    event_to_presentation: number | null;
    event_to_acknowledgement: number | null;
  };
};
type Inbox = {
  total_open: number;
  not_presented: number;
  urgent_open?:number;
  items: InboxItem[];
  next_before_id: number | null;
};

export function DoctorInboxNotice({ open }: { open: () => void }) {
  const { data, error } = useApi<Inbox>("/alerts/inbox?limit=1", 5000);
  return <button className={`inbox-counter ${data?.total_open ? "has-events" : ""}`} onClick={open}
    title={error ? "Не удалось обновить очередь. Откройте события для повторной загрузки" : data ? `Ещё не показаны в очереди: ${data.not_presented}` : "Получаем события"}
    aria-label={error ? "События: обновление недоступно" : `Открыть события: ${data?.total_open ?? "загрузка"}`}>
    <Bell size={18}/><span>События</span><strong>{error ? "!" : data?.total_open ?? "…"}</strong>
  </button>;
}

const seconds = (value: number | null) => value === null ? "Нет данных" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} с`;

function EventRow({ item, openPatient, reload }: {
  item: InboxItem;
  openPatient: (id: number,returnKey?:string) => void;
  reload: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const [shownAt, setShownAt] = useState(item.presented_at);
  const [presentationError, setPresentationError] = useState("");
  const [actionError, setActionError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const acknowledging=useRef(false);
  const acknowledgementFocus=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{
    if(item.status==="created"||!acknowledgementFocus.current)return;
    const previous=acknowledgementFocus.current;
    acknowledgementFocus.current=null;
    if(document.activeElement===previous||document.activeElement===document.body)
      ref.current?.querySelector<HTMLButtonElement>('[data-return-key]')?.focus();
  },[item.status]);
  useEffect(() => {
    const element = ref.current;
    if (!element || item.presented_at || shownAt) return;
    let active = true;
    let visible = false;
    async function mark() {
      if (!visible || document.visibilityState !== "visible" || inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await send<{ presented_at: string }>(`/alerts/${item.id}/presented`, {});
        if (active) { setShownAt(result.presented_at); setPresentationError(""); }
      } catch (failure) {
        if (active) setPresentationError(failure instanceof Error ? failure.message : "Не удалось сохранить показ");
      } finally { inFlight.current = false; }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      if (visible) void mark();
    }, { threshold: 0.5 });
    observer.observe(element);
    document.addEventListener("visibilitychange", mark);
    return () => {
      active = false;
      observer.disconnect();
      document.removeEventListener("visibilitychange", mark);
    };
  }, [item.id, item.presented_at, shownAt, retry]);
  async function acknowledge() {
    if(acknowledging.current)return;
    acknowledging.current=true;
    setBusy(true);
    setActionError("");
    try {
      await send(`/alerts/${item.id}/acknowledge`, {});
      const control=ref.current?.querySelector<HTMLElement>('[data-acknowledge]');
      acknowledgementFocus.current=document.activeElement===control?control:null;
      reload();
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : "Не удалось принять событие");
    } finally { acknowledging.current=false;setBusy(false); }
  }
  const presentedAt = item.presented_at ?? shownAt;
  return (
    <article className="panel inbox-event" ref={ref}>
      <div className="section-heading">
        <h2>{item.patient_name}</h2>
        <Badge tone={item.status === "created" ? "warn" : "purple"}>
          {item.status === "created" ? "Ждёт разбора" : "Принято в работу"}
        </Badge>
      </div>
      <p className="inbox-origin"><time dateTime={item.created_at}>{date(item.created_at)}</time><span>{item.source_kind==="support_request"?"Запрос поддержки":item.source_kind==="clinical_assessment"?"Клинический опросник":"Числовой демо-результат"}</span></p>
      {item.severity&&reviewLabels[item.severity]&&<Badge tone={item.severity==="urgent_review"?"warn":undefined}>{reviewLabels[item.severity]}</Badge>}
      <p>{item.reason}</p>
      <ReviewDeadlines timing={item.review_timing}/>
      <div className="inbox-actions">
        <Button data-return-key={`inbox-${item.id}`} onClick={() => openPatient(item.patient_id,`inbox-${item.id}`)}>Открыть карточку <ArrowRight size={16} /></Button>
        {item.status === "created" && <Button variant="secondary" data-acknowledge aria-disabled={busy} aria-busy={busy} onClick={acknowledge}>{busy?"Принимаем…":"Принять в работу"}</Button>}
      </div>
      <ErrorBox message={presentationError} retry={() => { setPresentationError(""); setRetry((value) => value + 1); }} />
      <ErrorBox message={actionError} retry={acknowledge} />
      <Disclosure lazy title="Источник и время обработки">
        <dl className="inbox-times">
          <div><dt>Данные поступили</dt><dd>{date(item.event_created_at)}</dd></div>
          <div><dt>Событие создано</dt><dd>{date(item.created_at)}</dd></div>
          <div><dt>Показано в очереди</dt><dd>{presentedAt ? date(presentedAt) : "Пока не зафиксировано"}</dd></div>
          <div><dt>Принято врачом</dt><dd>{item.acknowledged_at ? date(item.acknowledged_at) : "Ожидает действия врача"}</dd></div>
        </dl>
        <p>{item.source_kind === "support_request" ? "Явный запрос поддержки от пациента. Медицинский риск из текста не вычислялся." : item.source_kind==="clinical_assessment"?"Результат зафиксированной клинической формы и отдельные правила организации разбора из ответов врача от 26.10.2026. Требуется оценка врача.":"Учебный сигнал из числового демо-результата требует врачебной оценки."} Источник {item.rule_id}, версия {item.rule_version}.</p>
        <p>От поступления данных: создание события — {seconds(item.latency_seconds.event_to_alert)}; показ — {seconds(item.latency_seconds.event_to_presentation)}; принятие — {seconds(item.latency_seconds.event_to_acknowledgement)}.</p>
        <p>Показ фиксируется при видимой строке в активной вкладке. Он не подтверждает прочтение человеком. Внешнее уведомление не отправлялось.</p>
      </Disclosure>
    </article>
  );
}

export function DoctorInbox({ openPatient }: { openPatient: (id: number,returnKey?:string) => void }) {
  const [pages, setPages] = useViewState<number[]>("inbox-pages",[]);
  const [priority,setPriority] = useViewState<"all"|"urgent">("inbox-priority","all");
  const before = pages.at(-1);
  const { data, error, loading, reload } = useApi<Inbox>(`/alerts/inbox?limit=20${before ? `&before_id=${before}` : ""}${priority==="urgent"?"&priority=urgent":""}`, 5000);
  useReturnFocus("events",Boolean(data||error));
  return (
    <>
      <Heading eyebrow="Работа с событиями" title="События и обращения" action={<Button variant="secondary" onClick={() => { setPages([]); reload(); }}>Обновить очередь</Button>}/>
      <div className="button-row inbox-priority" role="group" aria-label="Приоритет событий" aria-busy={loading}>
        <Button variant={priority==="all"?"primary":"secondary"} aria-pressed={priority==="all"} onClick={()=>{setPriority("all");setPages([]);}}>Все события · {data?.total_open??"…"}</Button>
        <Button variant={priority==="urgent"?"primary":"secondary"} aria-pressed={priority==="urgent"} onClick={()=>{setPriority("urgent");setPages([]);}}>Срочные оценки · {data?.urgent_open??"…"}</Button>
      </div>
      <ErrorBox message={error ? `Данные очереди могли устареть. ${error}` : ""} retry={reload} />
      {loading && !data && <Loading />}
      {data && <>
        <p className="muted">Всего открыто: <strong>{data.total_open}</strong> · ещё не показаны Вам в очереди: <strong>{data.not_presented}</strong>. Обновление каждые 5 секунд.</p>
        <div className="inbox-list">
          {data.items.map((item) => <EventRow key={item.id} item={item} openPatient={openPatient} reload={reload} />)}
        </div>
        {data.items.length === 0 && <Empty title={before ? "На этой странице событий нет" : priority==="urgent"?"Срочных оценок в очереди нет":"Открытых событий пока нет"}>Это состояние очереди; отсутствие события не является оценкой состояния пациента.</Empty>}
        {(before || data.next_before_id) && <div className="inbox-actions">
          {before && <Button variant="secondary" onClick={() => setPages((value) => value.slice(0, -1))}>Назад</Button>}
          {data.next_before_id && <Button variant="secondary" onClick={() => setPages((value) => [...value, data.next_before_id!])}>Следующие события</Button>}
        </div>}
      </>}
    </>
  );
}
