import {clinicTimeZone} from "./clinicTime";
import {surveyTitle} from "./presentation";
import { useId } from "react";
import { useReturnFocus, useViewState, type PatientAnswerTarget } from "./ViewState";
import { CollectionMetrics } from "./CollectionMetrics";
import { DoctorWorkflowMetrics } from "./WorkflowMetrics";
import { dimensionLabels } from "./collection";
import { HorizontalBars } from "./Charts";
import { AnimatePresence, ContentFrame, Disclosure } from "./Interaction";
import {
  ArrowUpRight,
  ClipboardList,
  MessageSquareText,
  Users,
  CircleHelp,
  Plus,
  ChevronRight,
} from "lucide-react";
import { useApi, type Dashboard, type ChartQuestion, type Quote } from "./api";
import {
  Avatar,
  Badge,
  Button,
  date,
  Empty,
  ErrorBox,
  Heading,
  Loading,
  Section,
  adherenceLabels,
  plural,
} from "./UI";

function AnswerChart({ question }: { question: ChartQuestion }) {
  return (
    <div className="answer-chart">
      <div className="chart-caption">
        <span>
          {surveyTitle(question.survey_title)} · v{question.version}
        </span>
        <span>{question.respondents} {plural(question.respondents,"заполнение","заполнения","заполнений")}</span>
      </div>
      {question.dimension && <Badge tone="purple">{dimensionLabels[question.dimension]}</Badge>}
      <HorizontalBars title={question.prompt} maximum={question.respondents} unit="ответов" rows={question.options.map(option=>({label:option.label,value:option.count}))} caption={question.kind==="multiple"?"Можно выбрать несколько вариантов. Один ответ может содержать несколько причин.":"Количество ответов по вариантам. Каждая версия опроса показана отдельно."}/>
    </div>
  );
}

const quoteKey=(quote:Quote,index:number)=>quote.submission_id&&quote.question_id?`analytics-quote-${quote.submission_id}-${quote.question_id}`:`analytics-quote-${quote.patient_id}-${quote.created_at}-${index}`;
const quoteTarget=(quote:Quote):PatientAnswerTarget|undefined=>quote.assignment_id&&quote.submission_id&&quote.question_id?{assignmentId:quote.assignment_id,submissionId:quote.submission_id,questionId:quote.question_id}:undefined;

export function DoctorDashboard({
  openPatient,
  createSurvey,
  openClinicalHistory,
}: {
  openPatient: (id: number,returnKey?:string,answerTarget?:PatientAnswerTarget) => void;
  createSurvey: () => void;
  openClinicalHistory?: () => void;
}) {
  const [since, setSince] = useViewState("analytics-since","");
  const [until, setUntil] = useViewState("analytics-until","");
  const [period, setPeriod] = useViewState("analytics-period","");
  const [section,setSection]=useViewState("analytics-section","feedback");
  const [showAllQuotes,setShowAllQuotes]=useViewState("analytics-all-quotes",false);
  const panelId=useId(),extraQuotesId=useId();
  const data = useApi<Dashboard>(section==="feedback"?`/analytics/engagement${period}`:null, 15000);
  const d = data.data;
  useReturnFocus("overview",Boolean(d||data.error));
  const options = d?.questions.filter((q) => q.kind !== "text" && q.purpose !== "clinical") ?? [];
  const barriers = options.filter((q) => q.dimension === "constraints" || (!q.dimension && q.purpose === "barriers"));
  const other = options.filter((q) => !barriers.includes(q));
  function renderQuote(quote:Quote,index:number) {
    return <article className="patient-quote" key={quoteKey(quote,index)}>
      {quote.survey_title&&<p className="quote-survey-title">{surveyTitle(quote.survey_title)}</p>}
      <p className="quote-prompt">{quote.prompt}</p>
      <blockquote>«{quote.text}»</blockquote>
      <button className="person-link" data-return-key={quoteKey(quote,index)} aria-label={`${quoteTarget(quote)?"Открыть ответ":"Открыть карточку"}: ${quote.patient_name}`} onClick={()=>openPatient(quote.patient_id,quoteKey(quote,index),quoteTarget(quote))}>
        <Avatar name={quote.patient_name} small/><span>{quote.patient_name}<small>{date(quote.created_at)}</small></span><ChevronRight size={15}/>
      </button>
    </article>;
  }
  function applyPeriod() {
    const query = new URLSearchParams();
    if (since) query.set("since", new Date(`${since}T00:00:00`).toISOString());
    if (until) {
      const end = new Date(`${until}T00:00:00`);
      end.setDate(end.getDate() + 1);
      query.set("until", end.toISOString());
    }
    setPeriod(query.size ? `?${query}` : "");
  }
  return (
    <>
      <Heading
        eyebrow="Обратная связь между визитами"
        title="Аналитика сопровождения"
        action={
          <Button onClick={createSurvey}>
            <Plus size={17} /> Создать опрос
          </Button>
        }
      />
      <div className="tabs analytics-tabs" role="tablist" aria-label="Разделы аналитики врача">{[{id:"feedback",label:"Опросы и барьеры"},{id:"actions",label:"Действия и исходы"}].map(item=><button key={item.id} id={`${panelId}-tab-${item.id}`} role="tab" aria-selected={section===item.id} aria-controls={`${panelId}-panel-${item.id}`} tabIndex={section===item.id?0:-1} className={section===item.id?"active":""} onClick={()=>setSection(item.id)} onKeyDown={event=>{const next=event.key==="Home"?"feedback":event.key==="End"?"actions":event.key==="ArrowLeft"||event.key==="ArrowRight"?(section==="feedback"?"actions":"feedback"):null;if(next){event.preventDefault();setSection(next);document.getElementById(`${panelId}-tab-${next}`)?.focus();}}}>{item.label}</button>)}</div>
      <AnimatePresence mode="wait" initial={false}><ContentFrame key={section}><div role="tabpanel" id={`${panelId}-panel-${section}`} aria-labelledby={`${panelId}-tab-${section}`}>
      {section==="actions"?<DoctorWorkflowMetrics/>:<>
      <div className="period-toolbar">
        <span>Назначения за период</span>
        <label className="sr-only" htmlFor="period-start">
          Начало периода
        </label>
        <input
          id="period-start"
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
        />
        <span>—</span>
        <label className="sr-only" htmlFor="period-end">
          Конец периода включительно
        </label>
        <input
          id="period-end"
          type="date"
          min={since || undefined}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
        <Button
          variant="secondary"
          onClick={applyPeriod}
          disabled={Boolean(since && until && since > until)}
        >
          Применить
        </Button>
        <button
          className="text-link"
          onClick={() => {
            setSince("");
            setUntil("");
            setPeriod("");
          }}
        >
          За всё время
        </button>
      </div>
      {since&&until&&since>until&&<p className="question-error" role="alert">Конец периода должен быть не раньше начала.</p>}
      {d&&<p className="field-hint applied-period" role="status">Назначения: {!d.period.since&&!d.period.until_exclusive?"все даты":`с ${d.period.since?new Date(d.period.since).toLocaleDateString("ru-RU",{timeZone:clinicTimeZone}):"начала наблюдения"}${d.period.until_exclusive?` по ${new Date(Date.parse(d.period.until_exclusive)-1).toLocaleDateString("ru-RU",{timeZone:clinicTimeZone})} включительно`:", без конечной даты"}`}. Самоотчёты: по дате записи.</p>}
      <ErrorBox message={data.error} retry={data.reload} />
      {!d ? (
        data.loading?<Loading />:<Empty title="Аналитика пока недоступна"/>
      ) : (
        <>
          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-icon lavender">
                <Users size={19} />
              </span>
              <span>Мои пациенты</span>
              <strong>{d.patients_total}</strong>
              <small>Доступны только Ваши карточки</small>
            </article>
            <article className="metric-card">
              <span className="metric-icon mint">
                <ClipboardList size={19} />
              </span>
              <span>Опросы завершены</span>
              <strong>
                {d.completed}
                <em> / {d.assigned}</em>
              </strong>
              <small>
                {d.completion_rate === null
                  ? "Нет назначенных опросов"
                  : `${d.completion_rate.toLocaleString("ru-RU")}% от назначений за период`}
              </small>
            </article>
            <article className="metric-card">
              <span className="metric-icon peach">
                <MessageSquareText size={19} />
              </span>
              <span>Дали обратную связь</span>
              <strong>{d.patients_with_feedback}</strong>
              <small>Хотя бы один завершённый опрос</small>
            </article>
            <article className="metric-card">
              <span className="metric-icon neutral">
                <CircleHelp size={19} />
              </span>
              <span>Нет ответов на опросы</span>
              <strong>{d.patients_without_feedback}</strong>
              <small>
                В том числе без назначений: {d.patients_without_assignments}
              </small>
            </article>
          </div>
          <div className="insight-notice">
            <span className="notice-symbol">
              <CircleHelp size={20} />
            </span>
            <div>
              <strong>Неответ — это пробел в данных</strong>
              <p>
                Неответ не подтверждает отказ от лечения или невыполнение рекомендаций.
              </p>
            </div>
          </div>
          {d.questions.some(question=>question.purpose==="clinical")&&<div className="section-tip">
            <p>Клинические опросники включены в общие числа назначений и ответов. Их вопросы не относятся к планам и опыту пациентов; результаты и версии показаны в «Динамике состояния».</p>
            {openClinicalHistory&&<Button variant="secondary" onClick={openClinicalHistory}>Открыть динамику состояния</Button>}
          </div>}
          <div className="dashboard-columns">
            <div className="dashboard-primary">
              <Section
                title="Что мешает выполнять рекомендации"
                aside={<Badge tone="purple">Со слов пациентов</Badge>}
              >
                {!barriers.length ? (
                  <Empty title="Пока нет ответов о барьерах">
                    Назначьте опрос, чтобы понять, какая поддержка нужна
                    пациентам.
                  </Empty>
                ) : (
                  barriers.map((q) => (
                    <AnswerChart
                      key={`${q.survey_id}-${q.question_id}`}
                      question={q}
                    />
                  ))
                )}
              </Section>
              <Section
                title="Планы и опыт пациентов"
                aside={
                  <Button variant="ghost" onClick={createSurvey}>
                    Уточнить опросом <ArrowUpRight size={16} />
                  </Button>
                }
              >
                {!other.length ? (
                  <Empty title="Здесь появятся ответы">
                    Врач сам выбирает, о чём спросить пациентов.
                  </Empty>
                ) : (
                  <Disclosure title={`Показать распределения ответов · ${other.length}`} lazy>{other.map((q) => (
                    <AnswerChart
                      key={`${q.survey_id}-${q.question_id}`}
                      question={q}
                    />
                  ))}</Disclosure>
                )}
              </Section>
            </div>
            <div className="dashboard-secondary">
              <Section
                title="Голос пациента"
                aside={<Badge>{d.quotes.length?`${showAllQuotes?d.quotes.length:Math.min(5,d.quotes.length)} из ${d.quotes.length}`:"Последние ответы"}</Badge>}
              >
                {!d.quotes.length ? (
                  <Empty title="Свободных ответов пока нет" />
                ) : (
                  <>
                    <p className="field-hint quote-source-hint">До 20 последних свободных ответов из отобранных назначений. Полная история — в карточках пациентов.</p>
                    <div className="quote-list">{d.quotes.slice(0,5).map(renderQuote)}</div>
                    {d.quotes.length>5&&<>
                      <Button className="quote-more" variant="secondary" aria-expanded={showAllQuotes} aria-controls={extraQuotesId} onClick={()=>setShowAllQuotes(!showAllQuotes)}>{showAllQuotes?"Свернуть дополнительные ответы":`Показать ещё ${d.quotes.length-5} ${plural(d.quotes.length-5,"ответ","ответа","ответов")}`}<ChevronRight size={16} aria-hidden="true"/></Button>
                      <div className="quote-list quote-extra-list" id={extraQuotesId} hidden={!showAllQuotes}>{showAllQuotes&&d.quotes.slice(5).map((quote,index)=>renderQuote(quote,index+5))}</div>
                    </>}
                  </>
                )}
              </Section>
              <Section
                title="Выполнение рекомендаций"
                aside={<Badge>{d.adherence.reports} самоотч.</Badge>}
              >
                <div className="status-summary">
                  {Object.entries(adherenceLabels).map(([key, label]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <strong>{d.adherence.statuses[key] ?? 0}</strong>
                    </div>
                  ))}
                </div>
                <p className="field-hint">
                  Без самоотчётов: {d.adherence.patients_without_reports} чел.
                  Это неизвестный исход. У одного пациента может быть несколько
                  самоотчётов.
                </p>
                {d.adherence.reasons.slice(0, 3).map((reason, i) => (
                  <button
                    className="reason-card"
                    key={i}
                    data-return-key={`analytics-reason-${reason.id??i}-${reason.patient_id}`}
                    onClick={() => openPatient(reason.patient_id,`analytics-reason-${reason.id??i}-${reason.patient_id}`)}
                  >
                    <Badge tone="muted">
                      {adherenceLabels[reason.status ?? "unknown"]}
                    </Badge>
                    <p>«{reason.text}»</p>
                    <small>
                      {reason.patient_name} · {reason.recommendation}
                    </small>
                  </button>
                ))}
              </Section>
            </div>
          </div>
          {d.collection && <CollectionMetrics data={d.collection} />}
          <Section
            title="Где обратной связи пока не хватает"
            aside={<span className="muted">Текущий статус назначений</span>}
          >
            <div className="table-scroll" role="region" aria-label="Пациенты и ответы на опросы · таблица" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>Пациент</th>
                    <th>Опросы</th>
                    <th>Наблюдение</th>
                    <th>
                      <span className="sr-only">Открыть</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.patients]
                    .sort((a, b) => a.completed - b.completed)
                    .map((patient) => (
                      <tr key={patient.id}>
                        <td>
                          <button
                            className="person-link"
                            data-return-key={`analytics-row-${patient.id}`}
                            onClick={() => openPatient(patient.id,`analytics-row-${patient.id}`)}
                          >
                            <Avatar name={patient.full_name} small />
                            <strong>{patient.full_name}</strong>
                          </button>
                        </td>
                        <td>
                          {patient.completed} из {patient.assigned} завершено
                        </td>
                        <td>
                          <Badge
                            tone={
                              patient.observation_status === "has_feedback"
                                ? "good"
                                : "muted"
                            }
                          >
                            {patient.observation_status === "has_feedback"
                              ? "Есть ответы"
                              : patient.assigned
                                ? "Ждём ответа"
                                : "Опрос не назначен"}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Открыть карточку: ${patient.full_name}`}
                            data-return-key={`analytics-open-${patient.id}`}
                            onClick={() => openPatient(patient.id,`analytics-open-${patient.id}`)}
                          >
                            <ArrowUpRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="field-hint">
              Незавершённых назначений: {d.pending}. С явно заданным истёкшим
              сроком: {d.overdue_assignments}. Список не является прогнозом
              ухода.
            </p>
          </Section>
        </>
      )}
      </>}
      </div></ContentFrame></AnimatePresence>
    </>
  );
}
