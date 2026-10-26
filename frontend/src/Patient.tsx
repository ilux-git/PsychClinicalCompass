import { createRequestId } from "./requestId";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ChevronRight,
  Send,
  ClipboardCheck,
  MessageCircle,
  CircleCheck,
  BookOpen,
  Pill,
  Activity,
} from "lucide-react";
import {
  send,
  useApi,
  type Assignment,
  type Card,
  type Participation,
  type User,
  type Adherence,
  type Assessment,
} from "./api";
import {
  Badge,
  Button,
  date,
  Empty,
  ErrorBox,
  Heading,
  Loading,
  Section,
  adherenceLabels,
  availability,
  plural,
  type Notify,
} from "./UI";
import { AssignedSurvey } from "./PatientSurvey";
import { Chat } from "./Chat";
import { AssessmentHistory } from "./AssessmentHistory";
import { ClinicalHistory } from "./ClinicalHistory";
import { PatientDiary } from "./PatientDiary";
import { MedicationSchedule } from "./MedicationSchedule";
import { PatientJourney } from "./PatientJourney";
import { PatientOverview } from "./PatientOverview";
import { ContentFrame } from "./Interaction";
import { useUnsavedForm, type LeavePrompt } from "./NavigationGuard";

const selfReportPrompt:LeavePrompt={eyebrow:"Незавершённый самоотчёт",title:"Продолжить рассказ о рекомендации?",message:"Самоотчёт ещё не сохранён. При переходе без сохранения выбранный ответ и комментарий будут потеряны.",stayLabel:"Продолжить самоотчёт"};

function SelfReport({
  patientId,
  notify,
}: {
  patientId: number;
  notify: Notify;
}) {
  const reports = useApi<{ reports: Adherence[] }>(
    `/patients/${patientId}/adherence`,
  );
  const [recommendation, setRecommendation] = useState("");
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError,setSaveError]=useState("");
  const [savedId,setSavedId]=useState<number|null>(null);
  const errorId=useId(),errorResult=useRef<HTMLDivElement>(null);
  const reportForm=useRef<HTMLFormElement>(null),savedResult=useRef<HTMLElement>(null),returnFocus=useRef(false);
  useEffect(()=>{if(saveError)errorResult.current?.querySelector<HTMLElement>('.error-box')?.focus();},[saveError]);
  useEffect(()=>{
    if(savedId===null||!savedResult.current)return;
    if(returnFocus.current&&(document.activeElement===document.body||reportForm.current?.contains(document.activeElement)))savedResult.current.focus();
    returnFocus.current=false;
  },[savedId,reports.data]);
  const {clear}=useUnsavedForm({dirty:Boolean(recommendation || status || reason),pending:busy,prompt:selfReportPrompt});
  const request = useRef({ signature: "", id: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const signature = JSON.stringify([recommendation, status, reason]);
    if (signature !== request.current.signature)
      request.current = { signature, id: createRequestId() };
    setSaveError("");setSavedId(null);setBusy(true);
    try {
      const response=await send<Adherence>("/adherence/reports", {
        recommendation,
        status,
        reason,
        client_request_id: request.current.id,
      });
      returnFocus.current=true;setSavedId(response.id);
      setRecommendation("");
      setStatus("");
      setReason("");
      clear();
      request.current = { signature: "", id: "" };
      reports.reload();
      notify("Спасибо! Врач увидит, какая поддержка Вам нужна.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить самоотчёт");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading eyebrow="Самоотчёт" title="Выполнение рекомендаций"/>
      <Section title="Мой самоотчёт">
        <form ref={reportForm} onSubmit={submit} className="self-report-form">
          <div ref={errorResult} id={errorId}><ErrorBox message={saveError}/></div>
          <fieldset className="form-fields" disabled={busy} aria-busy={busy} aria-describedby={saveError?errorId:undefined}>
          <label className="field">
            О какой рекомендации расскажете?
            <input
              required
              maxLength={300}
              value={recommendation}
              onChange={(e) => {setSaveError("");setSavedId(null);setRecommendation(e.target.value);}}
              placeholder="Например, вести дневник самочувствия"
            />
          </label>
          <fieldset className="survey-question">
            <legend>Что получилось?</legend>
            {Object.entries(adherenceLabels).map(([key, label]) => (
              <label
                className={`answer-option ${status === key ? "checked" : ""}`}
                key={key}
              >
                <input
                  type="radio"
                  name="adherence-status"
                  required
                  value={key}
                  checked={status === key}
                  onChange={() => {setSaveError("");setSavedId(null);setStatus(key);}}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Что помогло или помешало? <span className="optional">Необязательно</span></span>
            <textarea
              value={reason}
              maxLength={2000}
              onChange={(e) => {setSaveError("");setSavedId(null);setReason(e.target.value);}}
              rows={4}
              placeholder="Можно написать своими словами. Например, было трудно найти время."
            />
          </label>
          <Button
            type="submit"
            disabled={busy || !recommendation.trim() || !status}
          >
            <Send size={16} /> {busy?"Сохраняем…":"Сохранить самоотчёт"}
          </Button>
          </fieldset>
        </form>
      </Section>
      <Section title="Мои предыдущие ответы">
        <ErrorBox message={reports.error} retry={reports.reload} />
        {reports.loading ? (
          <Loading />
        ) : !reports.data ? (
          <Empty title="История пока недоступна" />
        ) : !reports.data?.reports.length ? (
          <Empty title="Пока нет самоотчётов">
            Даже если что-то не получилось, об этом можно рассказать.
          </Empty>
        ) : (
          reports.data.reports.map((report) => (
            <article className="adherence-report" key={report.id} ref={report.id===savedId?savedResult:undefined} tabIndex={-1} aria-labelledby={`${errorId}-report-${report.id}`}>
              <Badge tone="muted">{adherenceLabels[report.status]}</Badge>
              <h3 id={`${errorId}-report-${report.id}`}>{report.recommendation}</h3>
              {report.reason && <p className="preserve">{report.reason}</p>}
              <small className="muted">{date(report.created_at)}</small>
            </article>
          ))
        )}
      </Section>
    </>
  );
}

export function PatientHome({
  user,
  view,
  notify,
  navigate,
  assignmentId,
  selectAssignment,
}: {
  user: User;
  view: string;
  notify: Notify;
  navigate: (view: string) => void;
  assignmentId:number|null;
  selectAssignment:(id:number)=>void;
}) {
  const showsSurveys = view === "overview" || view === "surveys";
  const assignments = useApi<Assignment[]>(showsSurveys ? "/survey-assignments" : null, 15000);
  const participation = useApi<Participation>(showsSurveys ? "/participation/me" : null, 15000);
  const card = useApi<Card>(
    user.patient_id && (view === "chat" || view === "telegram" || showsSurveys) ? `/patients/${user.patient_id}` : null,
    15000,
  );
  const selected=assignmentId===null?null:assignments.data?.find(assignment=>assignment.id===assignmentId)??null;
  function openSurvey(assignment:Assignment) {selectAssignment(assignment.id);}
  const assessmentHistory = useApi<Assessment[]>(
    view === "state" && user.patient_id ? `/patients/${user.patient_id}/assessments` : null,
    15000,
  );
  if (!user.patient_id)
    return <Empty title="Учётная запись пока не связана с карточкой" />;
  if (view === "journey") return <PatientJourney notify={notify} navigate={navigate}/>;
  if (view === "state")
    return (
      <>
        <Heading eyebrow="Сохранённые ответы" title="История состояния"/>
        <Section title="Мои измерения">
          <ErrorBox message={assessmentHistory.error} retry={assessmentHistory.reload} />
          {user.patient_id&&<ClinicalHistory patientId={user.patient_id}/>}
          {assessmentHistory.loading ? <Loading /> : assessmentHistory.data ? (
            <AssessmentHistory rows={assessmentHistory.data} />
          ) : <p className="muted">История пока недоступна.</p>}
        </Section>
      </>
    );
  if (view === "chat" || view === "telegram")
    return (
      <>
        <Heading
          eyebrow="В контакте с врачом"
          title={view === "telegram" ? "Симулятор Telegram" : "Написать врачу"}
        >
          Можно рассказать, как Вы себя чувствуете, или задать вопрос.
        </Heading>
        <Section title="Переписка" aside={<div className="chat-doctor">
          <span
            className={`availability-dot ${card.data?.doctor?.availability === "available" ? "online" : ""}`}
          />
          <div>
            <strong>{card.data?.doctor?.name ?? "Лечащий врач"}</strong>
            <small>
              {availability[card.data?.doctor?.availability ?? ""] ??
                "Статус неизвестен"}
            </small>
          </div>
        </div>}>
          <Chat
            key={view}
            patientId={user.patient_id}
            role="patient"
            simulated={view === "telegram"}
            notify={notify}
          />
        </Section>
      </>
    );
  if (view === "adherence")
    return <SelfReport patientId={user.patient_id} notify={notify} />;
  if (view === "diary")
    return <PatientDiary patientId={user.patient_id} notify={notify} progress={()=>navigate("journey")} />;
  if (view === "medications")
    return <MedicationSchedule patientId={user.patient_id} notify={notify} progress={()=>navigate("journey")} />;
  if(assignmentId!==null&&!selected)return <>
    <Heading eyebrow="Опрос врача" title={assignments.loading?"Открываем опрос…":assignments.error||!assignments.data?"Не удалось загрузить опрос":"Опрос недоступен"}>Открыть можно только назначенные Вам опросы.</Heading>
    <ErrorBox message={assignments.error} retry={assignments.reload}/>
    {assignments.loading?<Loading/>:<><p className="muted">{assignments.error||!assignments.data?"Список назначений пока не получен или не обновился. Повторите загрузку, когда соединение восстановится.":"Назначение не найдено среди доступных. Вернитесь к списку или повторите загрузку."}</p><div className="button-row"><Button onClick={()=>navigate("surveys")}>К опросам врача</Button><Button variant="secondary" onClick={assignments.reload}>Повторить загрузку</Button></div></>}
  </>;
  if (selected)
    return (
      <ContentFrame key={selected.id}>
      <AssignedSurvey
        key={selected.id}
        assignment={selected}
        notify={notify}
        progress={()=>navigate("journey")}
        done={() => {
          window.scrollTo(0,0);
          navigate("surveys");
          assignments.reload();
          participation.reload();
        }}
      />
      </ContentFrame>
    );
  const progress = participation.data;
  const pending = assignments.data?.filter((a) => !a.submission) ?? [];
  const completed = assignments.data?.filter((a) => a.submission).sort((a,b) =>
    Date.parse(b.submission!.created_at)-Date.parse(a.submission!.created_at) || b.id-a.id) ?? [];
  if (view === "overview") return <PatientOverview user={user} assignments={assignments} doctor={card.data?.doctor}
    doctorError={card.error} retryDoctor={card.reload} openSurvey={openSurvey} navigate={navigate} notify={notify}/>;
  return (
    <>
      <Heading
        eyebrow={view === "surveys" ? "Назначенные опросы" : "Личный кабинет"}
        title={view === "surveys" ? "Опросы врача" : "Мой день"}
      >
        Назначенные опросы и история отправленных ответов.
      </Heading>
      <ErrorBox
        message={assignments.error || participation.error || card.error}
        retry={() => {
          assignments.reload();
          participation.reload();
          card.reload();
        }}
      />
      <div className="patient-section-heading">
        <h2>
          Назначенные опросы{" "}
          <span className="count-circle">
            {assignments.data ? pending.length : "—"}
          </span>
        </h2>
        <span className="muted">Вопросы от врача</span>
      </div>
      {assignments.loading ? (
        <Loading />
      ) : !assignments.data ? (
        <section className="panel">
          <Empty title="Опросы пока недоступны">
            Обновите данные, когда соединение восстановится.
          </Empty>
        </section>
      ) : !pending.length ? (
        <section className="panel">
          <Empty title={assignments.data.length ? "Нет ожидающих опросов" : "Пока нет назначенных опросов"}>
            Когда врач назначит новый опрос, он появится здесь.
          </Empty>
        </section>
      ) : (
        <div className="patient-surveys">
          {pending.map((assignment) => (
            <button
              className="patient-survey-card"
              key={assignment.id}
              onClick={() => openSurvey(assignment)}
            >
              <span className="survey-card-icon">
                <ClipboardCheck size={23} />
              </span>
              <div>
                <Badge tone="purple">
                  {assignment.survey.questions.length} вопр.
                </Badge>
                {assignment.draft_updated_at && <Badge tone="good">Черновик · продолжить</Badge>}
                <h3>{assignment.survey.title}</h3>
                <p>{assignment.survey.description}</p>
                <small>
                  {assignment.due_at
                    ? `Ответить до ${date(assignment.due_at)}`
                    : "Можно ответить в удобное время"}
                </small>
              </div>
              <ChevronRight size={22} />
            </button>
          ))}
        </div>
      )}
      <div className="support-card">
        <MessageCircle size={24} />
        <div>
          <h3>Сообщить о затруднении</h3>
          <p>
            Сложности — повод подобрать поддержку. Ваши ответы увидит лечащий
            врач.
          </p>
        </div>
      </div>
      <Section
        title="Мои завершённые опросы"
        aside={
          <Badge tone="good">
            <CircleCheck size={13} />{" "}
            {assignments.data ? completed.length : "—"}
          </Badge>
        }
      >
        {!assignments.data ? (
          <p className="muted">История ещё не получена.</p>
        ) : !completed.length ? (
          <p className="muted">
            Здесь сохранится история Ваших ответов и пройденный путь.
          </p>
        ) : (
          completed.map((assignment) => (
            <button
              className="completed-survey"
              key={assignment.id}
              onClick={() => openSurvey(assignment)}
            >
              <span className="completed-check">
                <Check size={17} />
              </span>
              <div>
                <strong>{assignment.survey.title}</strong>
                <small>{date(assignment.submission?.created_at)}</small>
              </div>
              <ChevronRight size={18} />
            </button>
          ))
        )}
      </Section>
    </>
  );
}
