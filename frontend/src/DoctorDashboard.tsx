import { useState } from "react";
import {
  ArrowUpRight,
  ClipboardList,
  MessageSquareText,
  Users,
  CircleHelp,
  Plus,
  ChevronRight,
} from "lucide-react";
import { useApi, type Dashboard, type ChartQuestion } from "./api";
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
} from "./UI";

function AnswerChart({ question }: { question: ChartQuestion }) {
  const max = Math.max(1, ...question.options.map((option) => option.count));
  return (
    <div className="answer-chart">
      <div className="chart-caption">
        <span>
          {question.survey_title} · v{question.version}
        </span>
        <span>{question.respondents} ответ.</span>
      </div>
      <h3>{question.prompt}</h3>
      <div className="bars">
        {question.options.map((option) => (
          <div className="bar-row" key={option.id}>
            <div className="bar-label">
              <span>{option.label}</span>
              <strong>{option.count}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${(100 * option.count) / max}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="field-hint">
        {question.kind === "multiple"
          ? "Можно выбрать несколько вариантов. Один ответ может содержать несколько причин."
          : "Количество ответов по вариантам. Каждая версия опроса показана отдельно."}
      </p>
    </div>
  );
}

export function DoctorDashboard({
  openPatient,
  createSurvey,
}: {
  openPatient: (id: number) => void;
  createSurvey: () => void;
}) {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [period, setPeriod] = useState("");
  const data = useApi<Dashboard>(`/analytics/engagement${period}`, 15000);
  const d = data.data;
  const options = d?.questions.filter((q) => q.kind !== "text") ?? [];
  const barriers = options.filter((q) => q.purpose === "barriers");
  const other = options.filter((q) => q.purpose !== "barriers");
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
        title="Понять, что мешает"
        action={
          <Button onClick={createSurvey}>
            <Plus size={17} /> Создать опрос
          </Button>
        }
      >
        Причины со слов пациентов и вопросы, на которые ещё нет ответов.
      </Heading>
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
      <ErrorBox message={data.error} retry={data.reload} />
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-icon lavender">
                <Users size={19} />
              </span>
              <span>Мои пациенты</span>
              <strong>{d.patients_total}</strong>
              <small>Доступны только ваши карточки</small>
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
                  : `${d.completion_rate}% от назначений за период`}
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
                Он не доказывает уход из клиники или невыполнение рекомендаций.
                Здесь видны текущие ответы на назначения за выбранный период;
                данные о визитах пока не подключены.
              </p>
            </div>
          </div>
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
                  other.map((q) => (
                    <AnswerChart
                      key={`${q.survey_id}-${q.question_id}`}
                      question={q}
                    />
                  ))
                )}
              </Section>
            </div>
            <div className="dashboard-secondary">
              <Section
                title="Голос пациента"
                aside={<Badge>Последние ответы</Badge>}
              >
                {!d.quotes.length ? (
                  <Empty title="Свободных ответов пока нет" />
                ) : (
                  <div className="quote-list">
                    {d.quotes.slice(0, 5).map((quote, i) => (
                      <article
                        className="patient-quote"
                        key={`${quote.patient_id}-${i}`}
                      >
                        <p className="quote-prompt">{quote.prompt}</p>
                        <blockquote>«{quote.text}»</blockquote>
                        <button
                          className="person-link"
                          onClick={() => openPatient(quote.patient_id)}
                        >
                          <Avatar name={quote.patient_name} small />
                          <span>
                            {quote.patient_name}
                            <small>{date(quote.created_at)}</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      </article>
                    ))}
                  </div>
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
                    onClick={() => openPatient(reason.patient_id)}
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
          <Section
            title="Где обратной связи пока не хватает"
            aside={<span className="muted">Текущий статус назначений</span>}
          >
            <div className="table-scroll">
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
                            onClick={() => openPatient(patient.id)}
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
                            onClick={() => openPatient(patient.id)}
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
    </>
  );
}
