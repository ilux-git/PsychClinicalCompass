import { useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  HeartHandshake,
  Send,
  Sparkles,
  ClipboardCheck,
  MessageCircle,
  CircleCheck,
} from "lucide-react";
import {
  send,
  useApi,
  type Assignment,
  type Card,
  type Participation,
  type User,
  type Adherence,
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
import { SurveyFields, AnswerSummary } from "./SurveyFields";
import { Chat } from "./Chat";

function AssignedSurvey({
  assignment,
  done,
  notify,
}: {
  assignment: Assignment;
  done: () => void;
  notify: Notify;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await send(`/survey-assignments/${assignment.id}/submit`, { answers });
      setSaved(true);
      notify("Спасибо! Ваши ответы сохранены и доступны врачу.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось отправить ответы",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <section className="panel thanks-card">
        <span className="celebration">
          <Sparkles size={34} />
        </span>
        <p className="eyebrow">Ещё один шаг в диалоге с врачом</p>
        <h1>Спасибо за ваш ответ</h1>
        <p>
          Теперь врачу проще понять, что получается и где нужна поддержка. Любой
          честный ответ полезен.
        </p>
        <Badge tone="good">
          <Check size={14} /> Опрос завершён
        </Badge>
        <Button onClick={done}>
          Вернуться к моим опросам <ChevronRight size={16} />
        </Button>
      </section>
    );
  return (
    <>
      <button className="back-link" onClick={done}>
        <ArrowLeft size={16} /> Мои опросы
      </button>
      <section className="panel patient-form">
        <Badge tone={assignment.submission ? "good" : "purple"}>
          {assignment.submission
            ? "Ответ сохранён"
            : `${assignment.survey.questions.length} вопр.`}
        </Badge>
        <h1>{assignment.survey.title}</h1>
        <p className="lede">{assignment.survey.description}</p>
        <p className="field-hint">
          Вопросы от вашего врача · версия {assignment.survey.version}
          {assignment.due_at ? ` · ответить до ${date(assignment.due_at)}` : ""}
        </p>
        {assignment.submission ? (
          <>
            <AnswerSummary
              questions={assignment.survey.questions}
              answers={assignment.submission.answers}
            />
            <p className="field-hint">
              Отправлено {date(assignment.submission.created_at)}. Для нового
              ответа врач может назначить ещё один опрос.
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <SurveyFields
              questions={assignment.survey.questions}
              answers={answers}
              onChange={setAnswers}
              disabled={busy}
            />
            <p className="field-hint">
              Необязательные вопросы можно пропустить. Здесь нет правильных и
              неправильных ответов.
            </p>
            <Button type="submit" disabled={busy}>
              <Send size={17} /> {busy ? "Сохраняем…" : "Отправить ответы"}
            </Button>
          </form>
        )}
      </section>
    </>
  );
}

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
            <Send size={16} /> Сохранить самоотчёт
          </Button>
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
}: {
  user: User;
  view: string;
  notify: Notify;
}) {
  const assignments = useApi<Assignment[]>("/survey-assignments", 15000);
  const participation = useApi<Participation>("/participation/me", 15000);
  const card = useApi<Card>(
    user.patient_id ? `/patients/${user.patient_id}` : null,
    15000,
  );
  const [selected, setSelected] = useState<Assignment | null>(null);
  if (!user.patient_id)
    return <Empty title="Учётная запись пока не связана с карточкой" />;
  if (view === "chat" || view === "telegram")
    return (
      <>
        <Heading
          eyebrow="В контакте с врачом"
          title={view === "telegram" ? "Telegram · симулятор" : "Мой диалог"}
        >
          Можно рассказать, как вы себя чувствуете, или задать вопрос.
        </Heading>
        <div className="doctor-contact">
          <span
            className={`availability-dot ${card.data?.doctor?.availability === "available" ? "online" : ""}`}
          />
          <div>
            <strong>{card.data?.doctor?.name ?? "Лечащий врач"}</strong>
            <p>
              {availability[card.data?.doctor?.availability ?? ""] ??
                "Статус неизвестен"}
              . Сообщение сохранится; время ответа не гарантируется.
            </p>
          </div>
        </div>
        <Section title="Переписка">
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
  if (selected)
    return (
      <AssignedSurvey
        key={selected.id}
        assignment={selected}
        notify={notify}
        done={() => {
          setSelected(null);
          assignments.reload();
          participation.reload();
        }}
      />
    );
  const progress = participation.data;
  const pending = assignments.data?.filter((a) => !a.submission) ?? [];
  const completed = assignments.data?.filter((a) => a.submission) ?? [];
  return (
    <>
      <Heading
        eyebrow="Ваш голос важен"
        title={`Здравствуйте, ${user.display_name.split(" ")[0]}`}
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
      <div className="participation-card">
        <div className="participation-text">
          <span className="eyebrow">
            <Sparkles size={15} /> Мои шаги к диалогу
          </span>
          <h2>
            {!progress
              ? "Прогресс пока неизвестен"
              : !progress.assigned ? "Новые опросы появятся здесь"
              : progress.completed
                ? `Вы завершили ${progress.completed} из ${progress.assigned} опросов`
                : "Начните с одного ответа"}
          </h2>
          <p>
            {progress?.message ??
              "Каждый честный ответ помогает врачу понять, какая поддержка вам нужна."}
          </p>
          {progress && (
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Прогресс прохождения опросов"
              aria-valuenow={progress?.progress_percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${progress?.progress_percent ?? 0}%` }} />
            </div>
          )}
          <small>
            {progress
              ? `${progress.pending} ${plural(progress.pending, "опрос ждёт", "опроса ждут", "опросов ждут")} ответа`
              : "Для отображения прогресса нужны данные сервера"}
          </small>
        </div>
        <span className="progress-flower" aria-hidden="true">
          <HeartHandshake size={54} strokeWidth={1.35} />
        </span>
      </div>
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
              onClick={() => setSelected(assignment)}
            >
              <span className="survey-card-icon">
                <ClipboardCheck size={23} />
              </span>
              <div>
                <Badge tone="purple">
                  {assignment.survey.questions.length} вопр.
                </Badge>
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
              onClick={() => setSelected(assignment)}
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
