import { useRef, useState, type FormEvent } from "react";
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
import { PatientDiary } from "./PatientDiary";
import { MedicationSchedule } from "./MedicationSchedule";
import { PatientJourney } from "./PatientJourney";
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
  const {clear}=useUnsavedForm({dirty:Boolean(recommendation || status || reason),pending:busy,prompt:selfReportPrompt});
  const request = useRef({ signature: "", id: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const signature = JSON.stringify([recommendation, status, reason]);
    if (signature !== request.current.signature)
      request.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    try {
      await send("/adherence/reports", {
        recommendation,
        status,
        reason,
        client_request_id: request.current.id,
      });
      setRecommendation("");
      setStatus("");
      setReason("");
      clear();
      request.current = { signature: "", id: "" };
      reports.reload();
      notify("Спасибо! Врач увидит, какая поддержка вам нужна.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось сохранить",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading eyebrow="Без оценок и осуждения" title="Как получается?">
        Расскажите, что получается с рекомендациями врача и что мешает.
      </Heading>
      <Section title="Мой самоотчёт">
        <form onSubmit={submit} className="self-report-form">
          <fieldset className="form-fields" disabled={busy} aria-busy={busy}>
          <label className="field">
            О какой рекомендации расскажете?
            <input
              required
              maxLength={300}
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
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
                  onChange={() => setStatus(key)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            Что помогло или помешало?{" "}
            <span className="optional">Необязательно</span>
            <textarea
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
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
            <article className="adherence-report" key={report.id}>
              <Badge tone="muted">{adherenceLabels[report.status]}</Badge>
              <h3>{report.recommendation}</h3>
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
}: {
  user: User;
  view: string;
  notify: Notify;
  navigate: (view: string) => void;
}) {
  const showsSurveys = view === "overview" || view === "surveys";
  const assignments = useApi<Assignment[]>(showsSurveys ? "/survey-assignments" : null, 15000);
  const participation = useApi<Participation>(showsSurveys ? "/participation/me" : null, 15000);
  const card = useApi<Card>(
    user.patient_id && (view === "chat" || view === "telegram" || showsSurveys) ? `/patients/${user.patient_id}` : null,
    15000,
  );
  const [selected, setSelected] = useState<Assignment | null>(null);
  function openSurvey(assignment:Assignment) {window.scrollTo(0,0);setSelected(assignment);}
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
        <Heading eyebrow="Сохранённые ответы" title="Моё состояние">
          История PHQ-9 и GAD-7. Обсудить изменения и следующие шаги можно с вашим врачом.
        </Heading>
        <Section title="Мои измерения">
          <ErrorBox message={assessmentHistory.error} retry={assessmentHistory.reload} />
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
          title={view === "telegram" ? "Telegram · симулятор" : "Мой диалог"}
        >
          Можно рассказать, как вы себя чувствуете, или задать вопрос.
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
    return <PatientDiary patientId={user.patient_id} notify={notify} />;
  if (view === "medications")
    return <MedicationSchedule patientId={user.patient_id} notify={notify} />;
  if (selected)
    return (
      <ContentFrame key={selected.id}>
      <AssignedSurvey
        key={selected.id}
        assignment={selected}
        notify={notify}
        done={() => {
          window.scrollTo(0,0);
          setSelected(null);
          if (view !== "surveys") navigate("surveys");
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
  if (view === "overview") return <>
    <Heading eyebrow="Ваш день в Compass" title={`Здравствуйте, ${user.display_name.split(" ")[0]}`}>Всё важное между встречами с врачом — в одном месте.</Heading>
    <ErrorBox message={assignments.error || participation.error || card.error} retry={()=>{assignments.reload();participation.reload();card.reload();}}/>
    <div className="patient-day-grid">
      <section className="day-primary">
        <div className="day-section-label"><ClipboardCheck size={18}/><span>От вашего врача</span><Badge>{assignments.data ? `${pending.length} ${plural(pending.length,"опрос","опроса","опросов")}`:"Получаем…"}</Badge></div>
        {assignments.loading?<Loading/>:!assignments.data?<><h2>Опросы пока недоступны</h2><p>Обновите данные, когда соединение восстановится.</p><Button variant="secondary" onClick={assignments.reload}>Повторить</Button></>:pending.length?<>
          <p className="eyebrow">Следующий шаг</p><h2>{pending[0].survey.title}</h2><p>{pending[0].survey.description || "Расскажите врачу, что получается и какая поддержка нужна."}</p>
          <div className="day-survey-meta"><span>{pending[0].survey.questions.length} вопр.</span><span>{pending[0].due_at?`До ${date(pending[0].due_at)}`:"В удобное время"}</span>{pending[0].draft_updated_at&&<span>Есть ваш черновик</span>}</div>
          <Button onClick={()=>openSurvey(pending[0])}>{pending[0].draft_updated_at?"Продолжить ответ":"Ответить на вопросы"}<ChevronRight size={17}/></Button>
        </>:<><span className="day-complete-mark"><Check size={24}/></span><h2>Новых опросов пока нет</h2><p>Когда врач назначит вопросы, они появятся здесь. Сейчас можно записать самочувствие или написать врачу.</p><Button variant="secondary" onClick={()=>navigate('diary')}>Открыть дневник<ChevronRight size={16}/></Button></>}
        <div className="day-primary-footer"><span>{progress?`Отправлено ${progress.completed} из ${progress.assigned} опросов`:"История ещё загружается"}</span><Button variant="ghost" onClick={()=>navigate('surveys')}>Все мои опросы<ChevronRight size={16}/></Button></div>
      </section>
      <section className="day-companion" aria-label="Между встречами">
        <h2>Позаботиться о себе</h2>
        {([{view:'diary',title:'Дневник состояния',description:'Сохранить важное о своём дне',icon:BookOpen},{view:'medications',title:'Моё расписание',description:'Лекарства и личные отметки',icon:Pill},{view:'chat',title:'Написать врачу',description:'Вопрос или просьба о поддержке',icon:MessageCircle},{view:'state',title:'Мои измерения',description:'Ответы и изменения со временем',icon:Activity}]).map(item=><button className="day-action" key={item.view} onClick={()=>navigate(item.view)}><span><item.icon size={20}/></span><div><strong>{item.title}</strong><small>{item.description}</small></div><ChevronRight size={17}/></button>)}
      </section>
    </div>
    <PatientJourney compact notify={notify} navigate={navigate}/>
    {completed.length>0&&<Section title="Последние ответы" aside={<Button variant="ghost" onClick={()=>navigate('surveys')}>Вся история<ChevronRight size={16}/></Button>}>{completed.slice(0,2).map(assignment=><button className="completed-survey" key={assignment.id} onClick={()=>openSurvey(assignment)}><span className="completed-check"><Check size={17}/></span><div><strong>{assignment.survey.title}</strong><small>{date(assignment.submission?.created_at)}</small></div><ChevronRight size={18}/></button>)}</Section>}
  </>;
  return (
    <>
      <Heading
        eyebrow={view === "surveys" ? "Вопросы от вашего врача" : "Ваш день в Compass"}
        title={view === "surveys" ? "Мои опросы" : `Здравствуйте, ${user.display_name.split(" ")[0]}`}
      >
        Небольшие ответы помогают врачу лучше поддерживать вас между визитами.
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
          Для вас{" "}
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
          <Empty title={assignments.data.length ? "Всё готово, спасибо!" : "Пока нет назначенных опросов"}>
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
          <h3>Не всё получается? Об этом можно рассказать</h3>
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
            Здесь сохранится история ваших ответов и пройденный путь.
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
