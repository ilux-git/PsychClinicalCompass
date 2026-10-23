import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Copy,
  Send,
  Check,
  Trash2,
  Eye,
  PenLine,
  LockKeyhole,
} from "lucide-react";
import {
  send,
  useApi,
  type Draft,
  type Patient,
  type Question,
  type Survey,
} from "./api";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Heading,
  Loading,
  Section,
  type Notify,
} from "./UI";
import { SurveyFields } from "./SurveyFields";
import { barrierLabels, dimensionLabels, type Dimension, type BarrierCategory } from "./collection";
import { supportTemplate } from "./supportTemplate";

const id = (prefix: string) =>
  prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const question = (): Question => ({
  id: id("q_"),
  prompt: "",
  kind: "text",
  required: true,
  options: [],
  minimum: 0,
  maximum: 10,
});
const newDraft = (): Draft => ({
  title: "",
  description: "",
  purpose: "custom",
  questions: [question()],
});
const purposeNames: Record<string, string> = {
  barriers: "Барьеры выполнения рекомендаций",
  continuation: "Намерение продолжать наблюдение",
  experience: "Опыт пациента",
  follow_up: "Между визитами",
  custom: "Другой авторский опрос",
};

export function SurveyBuilder({
  notify,
  initialNew = false,
}: {
  notify: Notify;
  initialNew?: boolean;
}) {
  const library = useApi<Survey[]>("/surveys");
  const patients = useApi<Patient[]>("/patients");
  const [draft, setDraft] = useState<Draft | null>(
    initialNew ? newDraft : null,
  );
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [patientIds, setPatientIds] = useState<number[]>([]);
  const [due, setDue] = useState("");
  const request = useRef({ signature: "", id: "" });
  useEffect(() => {
    if (!draft && library.data) setDraft(library.data[0] ?? newDraft());
  }, [library.data, draft]);
  const locked = Boolean(draft?.published_at);
  function patch(values: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...values } : current));
  }
  function patchQuestion(index: number, values: Partial<Question>) {
    if (!draft) return;
    patch({
      questions: draft.questions.map((q, i) =>
        i === index ? { ...q, ...values } : q,
      ),
    });
  }
  async function save(publish = false) {
    if (!draft) return;
    setBusy(true);
    try {
      const payload = {
        title: draft.title,
        description: draft.description,
        purpose: draft.purpose,
        questions: draft.questions,
      };
      let saved = await send<Survey>(
        draft.id ? `/surveys/${draft.id}` : "/surveys",
        payload,
        draft.id ? "PUT" : "POST",
      );
      setDraft(saved);
      if (publish)
        saved = await send<Survey>(`/surveys/${saved.id}/publish`, {});
      setDraft(saved);
      library.reload();
      notify(
        publish
          ? "Опрос опубликован. Можно назначать пациентам."
          : "Черновик сохранён",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось сохранить",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      setDraft(await send<Survey>(`/surveys/${draft.id}/copy`, {}));
      library.reload();
      setPreview(false);
      notify(
        "Создан черновик новой версии. Старые ответы сохранят исходные вопросы.",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось создать версию",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (!draft?.id || !patientIds.length) return;
    const dueAt = due ? new Date(`${due}T23:59:59`).toISOString() : null;
    const signature = JSON.stringify([draft.id, [...patientIds].sort(), dueAt]);
    if (signature !== request.current.signature)
      request.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    try {
      await send(`/surveys/${draft.id}/assign`, {
        patient_ids: patientIds,
        due_at: dueAt,
        client_request_id: request.current.id,
      });
      notify(`Опрос назначен: ${patientIds.length} чел.`);
      setPatientIds([]);
      request.current = { signature: "", id: "" };
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось назначить",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="Вопросы, которые помогают понять пациента"
        title="Мои опросы"
        action={
          <Button
            onClick={() => {
              setDraft(newDraft());
              setPreview(false);
              setPatientIds([]);
            }}
          >
            <Plus size={17} /> Создать опрос
          </Button>
        }
      >
        Свои вопросы, понятные ответы и история каждой опубликованной версии.
      </Heading>
      <Section title="Что такое общая анкета сопровождения?">
        <p>Одинаковые короткие вопросы помогают сравнивать ответы на одну версию: понятен ли план, подходит ли помощь, что мешает и нужен ли следующий шаг. Свои опросы врача остаются доступными.</p>
        <p className="field-hint">Шаблон C1–C7 — предложение. Он не назначается автоматически, не заменяет PHQ-9/GAD-7 и не вычисляет общий балл «лояльности». Перед публикацией уточните конкретную рекомендацию и период. Частоту назначений определяет врач.</p>
        <Button variant="secondary" disabled={busy} onClick={() => {setDraft(supportTemplate()); setPreview(false); setPatientIds([]);}}>Открыть предложенный шаблон C1–C7 как черновик</Button>
      </Section>
      <ErrorBox
        message={library.error || patients.error}
        retry={() => {
          library.reload();
          patients.reload();
        }}
      />
      <div className="builder-layout">
        <aside className="survey-library">
          <div className="section-heading">
            <h2>Библиотека</h2>
            <span className="muted">{library.data?.length ?? "—"}</span>
          </div>
          {library.loading ? (
            <Loading />
          ) : !library.data ? (
            <Empty title="Библиотека пока недоступна" />
          ) : !library.data?.length ? (
            <Empty title="Начните с одного вопроса">
              Создайте опрос о том, что важно понять вашему пациенту.
            </Empty>
          ) : (
            library.data.map((s) => (
              <button
                key={s.id}
                className={`survey-tile ${draft?.id === s.id ? "selected" : ""}`}
                onClick={() => {
                  setDraft(s);
                  setPreview(false);
                  setPatientIds([]);
                }}
              >
                <Badge tone={s.published_at ? "good" : "muted"}>
                  {s.published_at ? "Опубликован" : "Черновик"}
                </Badge>
                <strong>{s.title}</strong>
                <span>
                  {s.questions.length} вопр. · версия {s.version}
                </span>
              </button>
            ))
          )}
        </aside>
        <div className="builder-main">
          {!draft ? (
            <Loading />
          ) : (
            <>
              <section className="panel editor-panel">
                <div className="section-heading">
                  <h2>
                    {locked
                      ? "Опубликованный опрос"
                      : draft.id
                        ? "Редактирование черновика"
                        : "Новый опрос"}
                  </h2>
                  <div className="segmented">
                    <button
                      className={!preview ? "active" : ""}
                      onClick={() => setPreview(false)}
                    >
                      <PenLine size={15} />
                      Вопросы
                    </button>
                    <button
                      className={preview ? "active" : ""}
                      onClick={() => setPreview(true)}
                    >
                      <Eye size={15} />
                      Предпросмотр
                    </button>
                  </div>
                </div>
                {locked && (
                  <div className="subtle-notice">
                    <LockKeyhole size={16} /> Вопросы зафиксированы. Для
                    изменений создайте новую версию.
                  </div>
                )}
                {preview ? (
                  <>
                    <h3>{draft.title || "Название опроса"}</h3>
                    <p className="muted">{draft.description}</p>
                    <SurveyFields
                      questions={draft.questions}
                      answers={{}}
                      onChange={() => {}}
                      disabled
                    />
                  </>
                ) : (
                  <>
                    <label className="field">
                      Название
                      <input
                        value={draft.title}
                        disabled={locked}
                        maxLength={200}
                        placeholder="Что важно понять у пациента?"
                        onChange={(e) => patch({ title: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Зачем этот опрос
                      <select
                        disabled={locked}
                        value={draft.purpose}
                        onChange={(e) => patch({ purpose: e.target.value })}
                      >
                        {Object.entries(purposeNames).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Короткое пояснение для пациента
                      <textarea
                        value={draft.description}
                        disabled={locked}
                        maxLength={2000}
                        rows={2}
                        placeholder="Как ответы помогут вам в дальнейшем сопровождении"
                        onChange={(e) => patch({ description: e.target.value })}
                      />
                    </label>
                    {draft.questions.map((q, i) => (
                      <div className="question-editor" key={q.id}>
                        <div className="question-editor-heading">
                          <Badge tone="purple">Вопрос {i + 1}</Badge>
                          {!locked && (
                            <button
                              className="icon-button"
                              aria-label={`Удалить вопрос ${i + 1}`}
                              disabled={draft.questions.length === 1}
                              onClick={() =>
                                patch({
                                  questions: draft.questions.filter(
                                    (_, n) => n !== i,
                                  ),
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        <label className="field">
                          Текст вопроса
                          <input
                            disabled={locked}
                            value={q.prompt}
                            maxLength={500}
                            onChange={(e) =>
                              patchQuestion(i, { prompt: e.target.value })
                            }
                            placeholder="Сформулируйте один понятный вопрос"
                          />
                        </label>
                        <label className="field">
                          Направление аналитики
                          <select disabled={locked} value={q.dimension ?? ""}
                            onChange={(e) => patchQuestion(i, {dimension: e.target.value as Dimension || null})}>
                            <option value="">Без направления</option>
                            {Object.entries(dimensionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </label>
                        <p className="field-hint">Помогает собрать ответы по теме. Оценка человека и общий балл автоматически не вычисляются.</p>
                        <div className="form-row">
                          <label className="field">
                            Тип ответа
                            <select
                              disabled={locked}
                              value={q.kind}
                              onChange={(e) => {
                                const kind = e.target.value as Question["kind"];
                                patchQuestion(i, {
                                  kind,
                                  options:
                                    kind === "single" || kind === "multiple"
                                      ? q.options.length
                                        ? q.options
                                        : [
                                            { id: id("o_"), label: "" },
                                            { id: id("o_"), label: "" },
                                          ]
                                      : [],
                                });
                              }}
                            >
                              <option value="text">Свободный ответ</option>
                              <option value="single">Один вариант</option>
                              <option value="multiple">
                                Несколько вариантов
                              </option>
                              <option value="scale">Числовая шкала</option>
                            </select>
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={q.required}
                              onChange={(e) =>
                                patchQuestion(i, { required: e.target.checked })
                              }
                            />{" "}
                            Обязательный
                          </label>
                        </div>
                        {(q.kind === "single" || q.kind === "multiple") && (
                          <div className="option-editor">
                            {q.options.map((option, oi) => (
                              <div className="option-row" key={option.id}>
                                <span className="option-dot" />
                                <input
                                  disabled={locked}
                                  aria-label={`Вариант ${oi + 1} вопроса ${i + 1}`}
                                  maxLength={180}
                                  value={option.label}
                                  onChange={(e) =>
                                    patchQuestion(i, {
                                      options: q.options.map((o, n) =>
                                        n === oi
                                          ? { ...o, label: e.target.value }
                                          : o,
                                      ),
                                    })
                                  }
                                  placeholder={`Вариант ${oi + 1}`}
                                />
                                {q.dimension === "constraints" && <select disabled={locked}
                                  aria-label={`Категория варианта ${oi + 1} вопроса ${i + 1}`}
                                  value={option.analytics_category ?? ""}
                                  onChange={(e) => patchQuestion(i, {options: q.options.map((o, n) => n === oi ?
                                    {...o, analytics_category: e.target.value as BarrierCategory || null} : o)})}>
                                  <option value="">Без категории</option>
                                  {Object.entries(barrierLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                                </select>}
                                {q.kind === "multiple" && <label className="checkbox-label"><input type="checkbox" disabled={locked} checked={option.exclusive ?? false}
                                  onChange={e => patchQuestion(i, {options: q.options.map((o,n) => n === oi ? {...o, exclusive: e.target.checked} : o)})} />Только этот вариант</label>}
                                {!locked && (
                                  <button
                                    className="icon-button"
                                    aria-label={`Удалить вариант ${oi + 1}`}
                                    disabled={q.options.length <= 2}
                                    onClick={() =>
                                      patchQuestion(i, {
                                        options: q.options.filter(
                                          (_, n) => n !== oi,
                                        ),
                                      })
                                    }
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </div>
                            ))}
                            {!locked && (
                              <Button
                                variant="ghost"
                                disabled={q.options.length >= 20}
                                onClick={() =>
                                  patchQuestion(i, {
                                    options: [
                                      ...q.options,
                                      { id: id("o_"), label: "" },
                                    ],
                                  })
                                }
                              >
                                <Plus size={15} /> Добавить вариант
                              </Button>
                            )}
                          </div>
                        )}
                        {q.kind === "scale" && (
                          <div className="form-row">
                            <label className="field">
                              Минимум
                              <input
                                type="number"
                                disabled={locked}
                                min={-100}
                                max={100}
                                value={q.minimum}
                                onChange={(e) =>
                                  patchQuestion(i, {
                                    minimum: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              Максимум
                              <input
                                type="number"
                                disabled={locked}
                                min={-100}
                                max={100}
                                value={q.maximum}
                                onChange={(e) =>
                                  patchQuestion(i, {
                                    maximum: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                    {!locked && (
                      <Button
                        variant="secondary"
                        disabled={draft.questions.length >= 30}
                        onClick={() =>
                          patch({ questions: [...draft.questions, question()] })
                        }
                      >
                        <Plus size={16} /> Добавить вопрос
                      </Button>
                    )}
                  </>
                )}
                <p className="field-hint">
                  Авторский опрос собирает обратную связь. Он не становится
                  диагностической шкалой и не назначает лечение.
                </p>
                <div className="editor-actions">
                  {locked ? (
                    <Button variant="secondary" disabled={busy} onClick={copy}>
                      <Copy size={16} /> Новая версия
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => save(false)}
                      >
                        Сохранить черновик
                      </Button>
                      <Button disabled={busy} onClick={() => save(true)}>
                        <Check size={17} /> Опубликовать
                      </Button>
                    </>
                  )}
                </div>
              </section>
              {locked && (
                <Section
                  title="Назначить пациентам"
                  aside={<Badge tone="good">Версия {draft.version}</Badge>}
                >
                  <p className="muted">
                    Пациенты увидят опрос в своём кабинете. Повторное назначение
                    — отдельный опрос для нового ответа.
                  </p>
                  <div className="assign-patients">
                    {patients.data?.map((patient) => (
                      <label key={patient.id} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={patientIds.includes(patient.id)}
                          onChange={(e) =>
                            setPatientIds((current) =>
                              e.target.checked
                                ? [...current, patient.id]
                                : current.filter((p) => p !== patient.id),
                            )
                          }
                        />
                        {patient.full_name}
                      </label>
                    ))}
                  </div>
                  <div className="form-row">
                    <label className="field">
                      Ответить до конца дня (необязательно)
                      <input
                        type="date"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                      />
                    </label>
                    <Button
                      disabled={busy || !patientIds.length}
                      onClick={assign}
                    >
                      <Send size={16} /> Назначить
                      {patientIds.length > 0 ? ` · ${patientIds.length}` : ""}
                    </Button>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
