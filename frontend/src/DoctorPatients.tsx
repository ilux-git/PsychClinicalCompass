import { useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Search,
  ClipboardList,
  LockKeyhole,
  Plus,
  Check,
  Clock3,
  ChevronRight,
  FileText,
} from "lucide-react";
import {
  send,
  useApi,
  type Patient,
  type Card,
  type Assignment,
  type Assessment,
  type Note,
  type Task,
  type Adherence,
  type Alert,
  type Survey,
} from "./api";
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
  type Notify,
} from "./UI";
import { AnswerSummary } from "./SurveyFields";
import { Chat } from "./Chat";

type Source = { type: string; id: number; label: string };

function AssessmentHistory({ rows }: { rows: Assessment[] }) {
  if (!rows.length) return <Empty title="Числовых результатов пока нет" />;
  return (
    <div className="scale-history">
      {["phq9", "gad7"].map((form) => {
        const points = rows.filter((r) => r.form_type === form);
        const maximum = form === "phq9" ? 27 : 21;
        return (
          <div key={form}>
            <h3>
              {form === "phq9" ? "PHQ-9" : "GAD-7"}{" "}
              <span className="muted">· демоданные</span>
            </h3>
            {!points.length ? (
              <p className="muted">Нет измерений</p>
            ) : (
              <div className="scale-points">
                {points.map((row) => (
                  <div key={row.id}>
                    <span className="scale-point-bar">
                      <i
                        style={{ height: `${(100 * row.score) / maximum}%` }}
                      />
                    </span>
                    <strong>{row.score}</strong>
                    <small>
                      {new Date(row.created_at).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                      })}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="field-hint">
        Разные шкалы показаны отдельно. Это сохранённые числовые результаты,
        клиническое значение оценивает врач.
      </p>
    </div>
  );
}

function AlertItem({
  alert,
  notify,
  reload,
}: {
  alert: Alert;
  notify: Notify;
  reload: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(
    action: "acknowledge" | "confirmed" | "declined" | "close",
  ) {
    setBusy(true);
    try {
      if (action === "confirmed" || action === "declined") {
        if (!alert.decision) return;
        await send(`/clinical-decisions/${alert.decision.id}/confirm`, {
          action,
          expected_version: alert.decision.version,
          reason,
        });
      } else await send(`/alerts/${alert.id}/${action}`, {});
      reload();
      notify("Действие врача сохранено в истории");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось сохранить решение",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="alert-card">
      <div className="section-heading">
        <Badge tone={alert.status === "closed" ? "good" : "warn"}>
          {alert.status === "closed"
            ? "Закрыто"
            : alert.status === "acknowledged"
              ? "В работе"
              : "Нужна оценка врача"}
        </Badge>
        <small className="muted">{date(alert.created_at)}</small>
      </div>
      <h3>{alert.reason}</h3>
      <p className="field-hint">
        Основание: сохранённый результат шкалы и правило исходного прототипа.
        Автоматическое событие не доказывает непосредственную угрозу жизни.
      </p>
      {alert.decision && (
        <>
          <p className="field-hint">
            Правило: {alert.rule_id} · {alert.rule_version}. Факты:{" "}
            {alert.decision.facts.form_type.toUpperCase()},{" "}
            {alert.decision.facts.score} балл.
            {alert.decision.facts.risk_flags.includes("phq9_item9_positive") &&
              " Положительный ответ на пункт 9 PHQ-9."}
          </p>
          <p className="field-hint">
            {alert.decision.status === "pending_review"
              ? "Не хватает врачебной оценки и согласованного клинического источника правила."
              : "При создании события требовались врачебная оценка и согласованный клинический источник правила."}
          </p>
          {alert.decision.status === "pending_review" ? (
            <>
              <label className="field">
                Комментарий врача
                <textarea
                  rows={2}
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Вывод по фактам и дальнейшие действия"
                />
              </label>
              <div className="button-row">
                {alert.status === "created" && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => act("acknowledge")}
                  >
                    Взять в работу
                  </Button>
                )}
                <Button disabled={busy} onClick={() => act("confirmed")}>
                  Подтвердить оценку
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => act("declined")}
                >
                  Отклонить
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                <Badge tone="good">
                  {alert.decision.status === "confirmed"
                    ? "Оценка подтверждена врачом"
                    : "Отклонено врачом"}
                </Badge>
              </p>
              {alert.decision.reason && (
                <p className="preserve">{alert.decision.reason}</p>
              )}
              {alert.status !== "closed" && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => act("close")}
                >
                  Закрыть событие
                </Button>
              )}
            </>
          )}
          <p className="field-hint">
            Решение хранится в Compass. Назначения в МИС не изменяются.
          </p>
        </>
      )}
    </article>
  );
}

function PatientCard({
  patientId,
  back,
  notify,
  simulated = false,
}: {
  patientId: number;
  back: () => void;
  notify: Notify;
  simulated?: boolean;
}) {
  const card = useApi<Card>(`/patients/${patientId}`, 15000);
  const assignments = useApi<Assignment[]>(
    `/survey-assignments?patient_id=${patientId}`,
    10000,
  );
  const history = useApi<Assessment[]>(
    `/patients/${patientId}/assessments`,
    15000,
  );
  const notes = useApi<Note[]>(`/patients/${patientId}/notes`);
  const tasks = useApi<Task[]>(`/patients/${patientId}/tasks`);
  const adherence = useApi<{ reports: Adherence[] }>(
    `/patients/${patientId}/adherence`,
    15000,
  );
  const alerts = useApi<Alert[]>(`/alerts?patient_id=${patientId}`, 15000);
  const surveys = useApi<Survey[]>("/surveys");
  const [tab, setTab] = useState(simulated ? "chat" : "feedback");
  const [noteText, setNoteText] = useState("");
  const [taskText, setTaskText] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [surveyId, setSurveyId] = useState("");
  const assignRequest = useRef({ surveyId: "", id: "" });
  async function addNote(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await send(`/patients/${patientId}/notes`, {
        text: noteText,
        source_type: source?.type ?? "manual",
        source_id: source?.id ?? null,
      });
      setNoteText("");
      setSource(null);
      notes.reload();
      notify("Приватная заметка сохранена");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось сохранить заметку",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addTask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await send(`/patients/${patientId}/tasks`, { title: taskText });
      setTaskText("");
      tasks.reload();
      notify("Задача добавлена");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось сохранить задачу",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggleTask(task: Task) {
    setBusy(true);
    try {
      await send(
        `/tasks/${task.id}`,
        { status: task.status === "done" ? "open" : "done" },
        "PATCH",
      );
      tasks.reload();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось обновить задачу",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (!surveyId) return;
    if (assignRequest.current.surveyId !== surveyId)
      assignRequest.current = { surveyId, id: crypto.randomUUID() };
    setBusy(true);
    try {
      await send(`/surveys/${surveyId}/assign`, {
        patient_ids: [patientId],
        client_request_id: assignRequest.current.id,
      });
      setSurveyId("");
      assignRequest.current = { surveyId: "", id: "" };
      assignments.reload();
      notify("Опрос назначен пациенту");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось назначить опрос",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  const p = card.data;
  return (
    <>
      <button className="back-link" onClick={back}>
        <ArrowLeft size={16} /> Все пациенты
      </button>
      <ErrorBox message={card.error} retry={card.reload} />
      {!p ? (
        <Loading />
      ) : (
        <>
          <div className="patient-heading">
            <Avatar name={p.full_name} />
            <div>
              <p className="eyebrow">Карточка пациента · #{p.id}</p>
              <h1>{p.full_name}</h1>
              <p className="muted">
                Синтетический пациент · источник МИС #{p.mis_id}
              </p>
            </div>
            <Badge tone="purple">Ваш пациент</Badge>
          </div>
          <div className="patient-columns">
            <div className="patient-primary">
              <div
                className="tabs"
                role="tablist"
                aria-label="Разделы карточки"
              >
                {[
                  ["feedback", "Обратная связь"],
                  ["chat", simulated ? "Telegram · симулятор" : "Диалог"],
                  ["clinical", "Клинические данные"],
                ].map(([key, label]) => (
                  <button
                    role="tab"
                    aria-selected={tab === key}
                    className={tab === key ? "active" : ""}
                    key={key}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "feedback" && (
                <>
                  <Section
                    title="Опросы и ответы"
                    aside={
                      <Badge>
                        {assignments.data?.filter((a) => a.submission).length ??
                          0}{" "}
                        завершено
                      </Badge>
                    }
                  >
                    <ErrorBox
                      message={assignments.error || surveys.error}
                      retry={() => {
                        assignments.reload();
                        surveys.reload();
                      }}
                    />
                    <div className="quick-assign">
                      <label className="sr-only" htmlFor="quick-survey">
                        Опрос для назначения
                      </label>
                      <select
                        id="quick-survey"
                        value={surveyId}
                        onChange={(e) => setSurveyId(e.target.value)}
                      >
                        <option value="">Выберите опубликованный опрос</option>
                        {surveys.data
                          ?.filter((s) => s.published_at)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title} · v{s.version}
                            </option>
                          ))}
                      </select>
                      <Button disabled={!surveyId || busy} onClick={assign}>
                        <Plus size={16} /> Назначить
                      </Button>
                    </div>
                    {!assignments.data ? (
                      <p className="muted">Назначения ещё не получены.</p>
                    ) : !assignments.data.length ? (
                      <Empty title="Опросов пока нет">
                        Можно назначить опубликованный опрос выше.
                      </Empty>
                    ) : (
                      assignments.data.map((assignment) => (
                        <article
                          className="assignment-result"
                          key={assignment.id}
                        >
                          <div className="section-heading">
                            <h3>{assignment.survey.title}</h3>
                            <Badge
                              tone={assignment.submission ? "good" : "muted"}
                            >
                              {assignment.submission
                                ? "Ответ получен"
                                : "Ждём ответа"}
                            </Badge>
                          </div>
                          <p className="field-hint">
                            Версия {assignment.survey.version} · назначен{" "}
                            {date(assignment.created_at)}
                            {assignment.due_at
                              ? ` · срок ${date(assignment.due_at)}`
                              : ""}
                          </p>
                          {assignment.submission && (
                            <>
                              <AnswerSummary
                                questions={assignment.survey.questions}
                                answers={assignment.submission.answers}
                              />
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setSource({
                                    type: "survey_submission",
                                    id: assignment.submission!.id,
                                    label: assignment.survey.title,
                                  });
                                  document.getElementById("note-text")?.focus();
                                }}
                              >
                                <FileText size={15} /> Заметка к ответу
                              </Button>
                            </>
                          )}
                        </article>
                      ))
                    )}
                  </Section>
                  <Section
                    title="Что получается с рекомендациями"
                    aside={<Badge tone="purple">Самоотчёты</Badge>}
                  >
                    <ErrorBox
                      message={adherence.error}
                      retry={adherence.reload}
                    />
                    {!adherence.data ? (
                      <p className="muted">Самоотчёты ещё не получены.</p>
                    ) : !adherence.data.reports.length ? (
                      <Empty title="Нет самоотчётов">
                        Выполнение рекомендаций пока неизвестно.
                      </Empty>
                    ) : (
                      adherence.data.reports.map((report) => (
                        <article className="adherence-report" key={report.id}>
                          <div className="section-heading">
                            <h3>{report.recommendation}</h3>
                            <Badge
                              tone={
                                report.status === "followed" ? "good" : "muted"
                              }
                            >
                              {adherenceLabels[report.status]}
                            </Badge>
                          </div>
                          {report.reason && (
                            <blockquote>«{report.reason}»</blockquote>
                          )}
                          <div className="section-heading">
                            <small className="muted">
                              {date(report.created_at)} · со слов пациента
                            </small>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setSource({
                                  type: "adherence_report",
                                  id: report.id,
                                  label: report.recommendation,
                                });
                                document.getElementById("note-text")?.focus();
                              }}
                            >
                              Заметка к ответу
                            </Button>
                          </div>
                        </article>
                      ))
                    )}
                  </Section>
                </>
              )}
              {tab === "chat" && (
                <Section
                  title={
                    simulated
                      ? "Канал Telegram · симулятор"
                      : "Диалог с пациентом"
                  }
                >
                  <Chat
                    key={patientId}
                    patientId={patientId}
                    role="doctor"
                    simulated={simulated}
                    notify={notify}
                  />
                </Section>
              )}
              {tab === "clinical" && (
                <>
                  <Section
                    title="Данные из МИС"
                    aside={
                      <Badge
                        tone={p.mis.status === "available" ? "good" : "warn"}
                      >
                        {p.mis.status === "available"
                          ? "Только чтение"
                          : "Источник недоступен"}
                      </Badge>
                    }
                  >
                    {p.mis.status === "available" ? (
                      <div className="clinical-data">
                        <h3>Диагнозы</h3>
                        {p.mis.diagnoses.length ? (
                          p.mis.diagnoses.map((text, i) => (
                            <p key={i}>{text}</p>
                          ))
                        ) : (
                          <p className="muted">Нет данных</p>
                        )}
                        <h3>Назначения</h3>
                        {p.mis.prescriptions.length ? (
                          p.mis.prescriptions.map((text, i) => (
                            <p key={i}>{text}</p>
                          ))
                        ) : (
                          <p className="muted">Нет данных</p>
                        )}
                      </div>
                    ) : (
                      <p>
                        Данные МИС не получены. Пустой список не означает
                        отсутствие диагнозов или назначений.
                      </p>
                    )}
                  </Section>
                  <Section title="История шкал">
                    <ErrorBox message={history.error} retry={history.reload} />
                    {history.data ? (
                      <AssessmentHistory rows={history.data} />
                    ) : (
                      <p className="muted">Результаты шкал ещё не получены.</p>
                    )}
                  </Section>
                  <Section title="События для врачебной оценки">
                    <ErrorBox message={alerts.error} retry={alerts.reload} />
                    {!alerts.data ? (
                      <p className="muted">События ещё не получены.</p>
                    ) : !alerts.data.length ? (
                      <Empty title="Событий пока нет" />
                    ) : (
                      alerts.data.map((alert) => (
                        <AlertItem
                          key={alert.id}
                          alert={alert}
                          notify={notify}
                          reload={alerts.reload}
                        />
                      ))
                    )}
                  </Section>
                </>
              )}
            </div>
            <aside className="patient-secondary">
              <Section
                title="Рабочие заметки"
                aside={<LockKeyhole size={17} className="muted" />}
              >
                <p className="field-hint">
                  Приватный раздел врача. Пациент его не видит.
                </p>
                <ErrorBox message={notes.error} retry={notes.reload} />
                <form onSubmit={addNote}>
                  {source && (
                    <div className="source-chip">
                      <span>К ответу: {source.label}</span>
                      <button
                        type="button"
                        aria-label="Убрать связь с ответом"
                        onClick={() => setSource(null)}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  <label className="sr-only" htmlFor="note-text">
                    Текст приватной заметки
                  </label>
                  <textarea
                    id="note-text"
                    rows={3}
                    maxLength={4000}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Что важно уточнить или обсудить…"
                    required
                  />
                  <Button
                    variant="secondary"
                    type="submit"
                    disabled={busy || !noteText.trim()}
                  >
                    <Plus size={15} /> Сохранить заметку
                  </Button>
                </form>
                <div className="notes-list">
                  {notes.data?.map((note) => (
                    <article key={note.id}>
                      <p className="preserve">{note.text}</p>
                      <small>
                        {date(note.created_at)}
                        {note.source_type !== "manual"
                          ? " · связан с источником"
                          : ""}
                      </small>
                    </article>
                  ))}
                </div>
              </Section>
              <Section
                title="Следующий шаг"
                aside={<Clock3 size={17} className="muted" />}
              >
                <ErrorBox message={tasks.error} retry={tasks.reload} />
                <form className="task-compose" onSubmit={addTask}>
                  <input
                    aria-label="Название задачи"
                    value={taskText}
                    maxLength={300}
                    onChange={(e) => setTaskText(e.target.value)}
                    placeholder="Что сделать для пациента?"
                    required
                  />
                  <Button
                    variant="secondary"
                    aria-label="Добавить задачу"
                    type="submit"
                    disabled={busy || !taskText.trim()}
                  >
                    <Plus size={16} />
                  </Button>
                </form>
                <div className="task-list">
                  {tasks.data?.map((task) => (
                    <button
                      disabled={busy}
                      key={task.id}
                      className={task.status === "done" ? "done" : ""}
                      onClick={() => toggleTask(task)}
                    >
                      <span className="task-check">
                        {task.status === "done" && <Check size={13} />}
                      </span>
                      <span>{task.title}</span>
                    </button>
                  ))}
                </div>
                {tasks.data?.length === 0 && (
                  <p className="field-hint">Пока нет запланированных шагов.</p>
                )}
              </Section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

export function DoctorPatients({
  selected,
  onSelect,
  notify,
  simulated = false,
}: {
  selected: number | null;
  onSelect: (id: number | null) => void;
  notify: Notify;
  simulated?: boolean;
}) {
  const patients = useApi<Patient[]>("/patients");
  const [query, setQuery] = useState("");
  if (selected !== null)
    return (
      <PatientCard
        key={`${selected}-${simulated}`}
        patientId={selected}
        back={() => onSelect(null)}
        notify={notify}
        simulated={simulated}
      />
    );
  const filtered = patients.data?.filter((p) =>
    p.full_name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading eyebrow="Люди, которым вы помогаете" title="Мои пациенты">
        Опросы, самоотчёты и переписка в одной карточке.
      </Heading>
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="Поиск пациента"
          placeholder="Найти по имени…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ErrorBox message={patients.error} retry={patients.reload} />
      {patients.loading ? (
        <Loading />
      ) : !filtered?.length ? (
        <Empty title="Пациенты не найдены" />
      ) : (
        <div className="patient-grid">
          {filtered.map((p) => (
            <button
              className="patient-tile"
              key={p.id}
              onClick={() => onSelect(p.id)}
            >
              <Avatar name={p.full_name} />
              <strong>{p.full_name}</strong>
              <span>Синтетическая карточка · #{p.id}</span>
              <div>
                <ClipboardList size={16} /> Открыть историю и ответы
                <ChevronRight size={17} />
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
