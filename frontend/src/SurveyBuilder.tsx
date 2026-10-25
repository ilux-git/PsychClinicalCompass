import { useEffect, useId, useRef, useState } from "react";
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
import { experienceTemplate, supportTemplate } from "./supportTemplate";
import { Disclosure } from "./Interaction";
import { useNavigationGuard, useUnsavedForm, type LeavePrompt } from "./NavigationGuard";

const draftPrompt:LeavePrompt={eyebrow:"Черновик врача",title:"Сохранить изменения опроса?",message:"Изменения ещё не сохранены. Сохранение создаст или обновит черновик; публикация и назначение пациентам выполняются отдельно.",stayLabel:"Продолжить редактирование"};
const assignmentPrompt:LeavePrompt={eyebrow:"Незавершённое назначение",title:"Продолжить выбор пациентов?",message:"Опрос ещё не назначен. При уходе или смене версии список выбранных пациентов и срок будут сброшены. Назначение отправляется только отдельной кнопкой.",stayLabel:"Продолжить назначение"};

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
const draftSignature = (draft:Draft) => JSON.stringify({title:draft.title,description:draft.description,purpose:draft.purpose,questions:draft.questions});
function validateDraft(draft:Draft):Record<string,string> {
  const errors:Record<string,string>={};
  if(!draft.title.trim())errors.title="Укажите название опроса";
  draft.questions.forEach(q=>{
    if(!q.prompt.trim())errors[q.id]="Напишите текст вопроса";
    if(q.kind==="single"||q.kind==="multiple")q.options.forEach(option=>{
      if(!option.label.trim())errors[option.id]="Напишите вариант ответа";
    });
    if(q.kind==="scale") {
      if(!Number.isInteger(q.minimum)||q.minimum < -100||q.minimum > 100)errors[`${q.id}-minimum`]="Укажите целое число от −100 до 100";
      if(!Number.isInteger(q.maximum)||q.maximum < -100||q.maximum > 100)errors[`${q.id}-maximum`]="Укажите целое число от −100 до 100";
      if(q.minimum>=q.maximum)errors[`${q.id}-maximum`]="Максимум должен быть больше минимума";
    }
  });
  return errors;
}
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
  const [previewAnswers,setPreviewAnswers] = useState<Record<string,unknown>>({});
  const [baseline,setBaseline] = useState(()=>draft?draftSignature(draft):"");
  const [busy, setBusy] = useState(false);
  const [saveError,setSaveError]=useState("");
  const [validationAttempted,setValidationAttempted]=useState(false);
  const [validationFocus,setValidationFocus]=useState(0);
  const fieldId=useId();
  const builderRef=useRef<HTMLFieldSetElement>(null);
  const [patientIds, setPatientIds] = useState<number[]>([]);
  const [due, setDue] = useState("");
  const request = useRef({ signature: "", id: "" });
  const guard = useNavigationGuard();
  const locked = Boolean(draft?.published_at);
  const dirty = Boolean(draft && !locked && draftSignature(draft)!==baseline);
  const fieldErrors=validationAttempted&&draft?validateDraft(draft):{};
  const errorId=(key:string)=>`${fieldId}-${key}-error`;
  const errorProps=(key:string)=>({"aria-invalid":Boolean(fieldErrors[key])||undefined,"aria-describedby":fieldErrors[key]?errorId(key):undefined});
  useEffect(()=>{if(validationFocus)builderRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();},[validationFocus]);
  const {clear:clearGuard} = useUnsavedForm({dirty,pending:busy,prompt:draftPrompt,save:dirty&&!busy?()=>save(false):undefined,focus:()=>(builderRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')??builderRef.current?.querySelector<HTMLElement>('.builder-save-error .error-box,.editor-panel input'))?.focus()});
  const {clear:clearAssignment}=useUnsavedForm({dirty:locked&&Boolean(patientIds.length||due),pending:busy,prompt:assignmentPrompt,focus:()=>(builderRef.current?.querySelector<HTMLElement>('.assign-patients input:checked')??builderRef.current?.querySelector<HTMLElement>('.assign-patients input'))?.focus()});
  function selectDraft(value:Draft) {
    setDraft(value);setBaseline(draftSignature(value));setPreview(false);setPreviewAnswers({});setPatientIds([]);setDue("");setSaveError("");setValidationAttempted(false);
    request.current={signature:"",id:""};
  }
  useEffect(() => {
    if (!draft && library.data) selectDraft(library.data[0] ?? newDraft());
  }, [library.data, draft]);
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
    if (!draft) return false;
    setSaveError("");
    if(Object.keys(validateDraft(draft)).length){setValidationAttempted(true);setPreview(false);setValidationFocus(value=>value+1);return false;}
    setValidationAttempted(false);
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
      setBaseline(draftSignature(saved));
      if (publish)
        saved = await send<Survey>(`/surveys/${saved.id}/publish`, {});
      setDraft(saved);
      setBaseline(draftSignature(saved));
      library.reload();
      clearGuard();
      notify(
        publish
          ? "Опрос опубликован. Можно назначать пациентам."
          : "Черновик сохранён",
      );
      return true;
    } catch (error) {
      setSaveError(error instanceof Error?error.message:"Не удалось сохранить опрос");
      notify(
        error instanceof Error ? error.message : "Не удалось сохранить",
        "error",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      selectDraft(await send<Survey>(`/surveys/${draft.id}/copy`, {}));
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
      setDue("");clearAssignment();
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
    <fieldset ref={builderRef} className="survey-builder" disabled={busy} aria-busy={busy} aria-label="Конструктор и назначение опросов">
      <Heading
        eyebrow="Вопросы, которые помогают понять пациента"
        title="Опросы для пациентов"
        action={
          <Button
            onClick={() => guard.run(()=>selectDraft(newDraft()))}
          >
            <Plus size={17} /> Создать опрос
          </Button>
        }
      >
        Свои вопросы, понятные ответы и история каждой опубликованной версии.
      </Heading>
      <div className="builder-save-error"><ErrorBox message={saveError||(Object.keys(fieldErrors).length?"Заполните отмеченные поля. Опрос пока не сохранён.":"")}/></div>
      <div className="template-explainer"><Disclosure title="Начать с редактируемого шаблона">
        <h3>Как получается следовать плану</h3><p>Понятен ли план, подходит ли помощь, что мешает и нужен ли следующий шаг. Перед публикацией уточните конкретную рекомендацию и период.</p>
        <Button variant="secondary" disabled={busy} onClick={() => guard.run(()=>selectDraft(supportTemplate()))}>Открыть анкету сопровождения</Button>
        <h3 className="template-next-title">Опыт использования приложения</h3><p>Понятность и польза приложения, предложения пациента. Эти ответы отделены от доверия к лечению и не дают медицинского балла.</p>
        <Button variant="secondary" disabled={busy} onClick={() => guard.run(()=>selectDraft(experienceTemplate()))}>Открыть опрос об удобстве</Button>
        <p className="field-hint">Оба шаблона можно изменить. Сохранение, публикация и назначение выполняются отдельно; автоматической рассылки нет. Это авторские вопросы, а не диагностические шкалы.</p>
      </Disclosure></div>
      <ErrorBox
        message={library.error || patients.error}
        retry={() => {
          library.reload();
          patients.reload();
        }}
      />
      <div className="builder-layout">
        <label className="field mobile-survey-select">Выберите опрос<select value={draft?.id??""} onChange={event=>{const survey=library.data?.find(value=>value.id===Number(event.target.value));if(survey)guard.run(()=>selectDraft(survey));}}>
          <option value="" disabled>Новый черновик</option>{library.data?.map(survey=><option key={survey.id} value={survey.id}>{survey.title} · v{survey.version}{survey.published_at?"":" · черновик"}</option>)}
        </select></label>
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
                aria-pressed={draft?.id===s.id}
                onClick={() => guard.run(()=>selectDraft(s))}
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
                  {locked?<p className="editor-kicker">Готов к назначению</p>:<h2>{draft.id?"Редактирование черновика":"Новый опрос"}</h2>}
                  <div className="segmented">
                    <button
                      className={!preview ? "active" : ""}
                      aria-pressed={!preview}
                      onClick={() => setPreview(false)}
                    >
                      <PenLine size={15} />
                      {locked?"Назначение":"Вопросы"}
                    </button>
                    <button
                      className={preview ? "active" : ""}
                      aria-pressed={preview}
                      onClick={() => setPreview(true)}
                    >
                      <Eye size={15} />
                      Предпросмотр
                    </button>
                  </div>
                </div>
                {locked && (
                  <div className={`subtle-notice ${!preview?"published-lock-hint":""}`}>
                    <LockKeyhole size={16} /> Вопросы зафиксированы. Для
                    изменений создайте новую версию.
                  </div>
                )}
                {locked&&!preview?<div className="published-survey-summary"><h2>{draft.title}</h2><p>{draft.description}</p><div className="button-row"><Badge tone="good">Опубликован · v{draft.version}</Badge><span>{draft.questions.length} вопр.</span><span>{purposeNames[draft.purpose]??"Авторский опрос"}</span><Button variant="ghost" disabled={busy} onClick={()=>guard.run(()=>void copy())}><Copy size={16}/>Новая версия</Button></div></div>:preview ? (
                  <>
                    <h2 className="preview-title">{draft.title || "Название опроса"}</h2>
                    <p className="muted">{draft.description}</p>
                    <SurveyFields
                      questions={draft.questions}
                      answers={previewAnswers}
                      onChange={setPreviewAnswers}
                    />
                    <p className="field-hint">Пробные ответы остаются в предпросмотре. Они не отправляются, не назначаются пациентам и не попадают в аналитику.</p>
                  </>
                ) : (
                  <>
                    <label className="field">
                      Название
                      <input
                        value={draft.title}
                        aria-label="Название"
                        required
                        {...errorProps("title")}
                        disabled={locked}
                        maxLength={200}
                        placeholder="Что важно понять у пациента?"
                        onChange={(e) => patch({ title: e.target.value })}
                      />
                      {fieldErrors.title&&<span className="question-error" id={errorId("title")}>{fieldErrors.title}</span>}
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
                            aria-label="Текст вопроса"
                            required
                            {...errorProps(q.id)}
                            maxLength={500}
                            onChange={(e) =>
                              patchQuestion(i, { prompt: e.target.value })
                            }
                            placeholder="Сформулируйте один понятный вопрос"
                          />
                          {fieldErrors[q.id]&&<span className="question-error" id={errorId(q.id)}>{fieldErrors[q.id]}</span>}
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
                                  required
                                  {...errorProps(option.id)}
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
                                {fieldErrors[option.id]&&<span className="question-error option-error" id={errorId(option.id)}>{fieldErrors[option.id]}</span>}
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
                                required
                                step={1}
                                {...errorProps(`${q.id}-minimum`)}
                                aria-label="Минимум"
                                min={-100}
                                max={100}
                                value={q.minimum}
                                onChange={(e) =>
                                  patchQuestion(i, {
                                    minimum: Number(e.target.value),
                                  })
                                }
                              />
                              {fieldErrors[`${q.id}-minimum`]&&<span className="question-error" id={errorId(`${q.id}-minimum`)}>{fieldErrors[`${q.id}-minimum`]}</span>}
                            </label>
                            <label className="field">
                              Максимум
                              <input
                                type="number"
                                disabled={locked}
                                required
                                step={1}
                                {...errorProps(`${q.id}-maximum`)}
                                aria-label="Максимум"
                                min={-100}
                                max={100}
                                value={q.maximum}
                                onChange={(e) =>
                                  patchQuestion(i, {
                                    maximum: Number(e.target.value),
                                  })
                                }
                              />
                              {fieldErrors[`${q.id}-maximum`]&&<span className="question-error" id={errorId(`${q.id}-maximum`)}>{fieldErrors[`${q.id}-maximum`]}</span>}
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
                {(!locked||preview)&&<p className="field-hint">
                  Авторский опрос собирает обратную связь. Он не становится
                  диагностической шкалой и не назначает лечение.
                </p>}
                {(!locked||preview)&&<div className="editor-actions">
                  {locked ? (
                    <Button variant="secondary" onClick={()=>setPreview(false)}>
                      К назначению пациентов
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => save(false)}
                      >
                        {busy?"Сохраняем…":"Сохранить черновик"}
                      </Button>
                      <Button disabled={busy} onClick={() => save(true)}>
                        <Check size={17} /> Опубликовать
                      </Button>
                    </>
                  )}
                </div>}
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
    </fieldset>
  );
}
