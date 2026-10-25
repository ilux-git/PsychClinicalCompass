import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
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
import { AssessmentHistory } from "./AssessmentHistory";
import { dimensionLabels, type Dimension } from "./collection";
import { SharedDiary } from "./PatientDiary";
import { CareWorkflow, treatmentLabels, type CareSource, type CareTask } from "./CareWorkflow";
import { MedicationSchedule } from "./MedicationSchedule";
import { EventAction } from "./EventAction";
import { AnimatePresence, ContentFrame, Disclosure } from "./Interaction";
import { useNavigationGuard, useUnsavedForm, type LeavePrompt } from "./NavigationGuard";
import { useReturnFocus, useViewState, type PatientAnswerTarget } from "./ViewState";
import { cardSections, type CardTab } from "./navigation";

const notePrompt:LeavePrompt={eyebrow:"Рабочая заметка врача",title:"Продолжить приватную заметку?",message:"Заметка ещё не сохранена. При выходе из карточки текущий ввод будет потерян. Пациент эту форму не видит.",stayLabel:"Продолжить заметку"};
const decisionPrompt:LeavePrompt={eyebrow:"Комментарий к событию",title:"Продолжить врачебную оценку?",message:"Комментарий ещё не сохранён. Переход без сохранения удалит ввод. Подтверждение или отклонение оценки выполняется только отдельной кнопкой врача.",stayLabel:"Продолжить оценку"};
const clearCommentPrompt:LeavePrompt={eyebrow:"Несохранённый комментарий",title:"Очистить текущий комментарий?",message:"Сохранённое решение останется прежним. Ваш неотправленный комментарий будет удалён из формы; при необходимости скопируйте его перед очисткой.",stayLabel:"Оставить комментарий",discardLabel:"Очистить мой ввод"};
const quickAssignmentPrompt:LeavePrompt={eyebrow:"Назначение опроса",title:"Остаться в карточке пациента?",message:"Опрос выбран, но ещё не назначен. При выходе из карточки выбор будет сброшен. Отправка пациенту выполняется только кнопкой «Назначить».",stayLabel:"Остаться в карточке"};
const cardTabScope="patient-card-tab";

type Source = CareSource;

function AlertItem({
  alert,
  notify,
  reload,
  openPlan,
}: {
  alert: Alert;
  notify: Notify;
  reload: () => void;
  openPlan: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const comment=useRef<HTMLTextAreaElement>(null);
  const {clear,confirm}=useUnsavedForm({dirty:Boolean(reason),pending:busy,prompt:decisionPrompt,scope:cardTabScope,focus:()=>comment.current?.focus()});
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
        setReason("");clear();
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
    <article className="alert-card" aria-busy={busy}>
      <div className="section-heading">
        <Badge tone={alert.status === "closed" ? "good" : alert.decision&&alert.decision.status!=="pending_review" ? "purple" : "warn"}>
          {alert.status === "closed"
            ? "Закрыто"
            : alert.decision&&alert.decision.status!=="pending_review"
              ? "Оценка сохранена · событие открыто"
            : alert.status === "acknowledged"
              ? "В работе"
              : "Нужна оценка врача"}
        </Badge>
        <small className="muted">{date(alert.created_at)}</small>
      </div>
      <h3>{alert.reason}</h3>
      {alert.source_kind === "support_request" ? <>
        <p className="field-hint">Источник — явная просьба пациента. Текст не оценивался медицинским классификатором.</p>
        {alert.source_message && <blockquote className="preserve">{alert.source_message.text}<footer>{date(alert.source_message.created_at)} · сообщение #{alert.source_message.id}</footer></blockquote>}
      </> : <p className="field-hint">
        Основание: сохранённый результат шкалы и правило исходного прототипа.
        Автоматическое событие не доказывает непосредственную угрозу жизни.
      </p>}
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
                  ref={comment}
                  disabled={busy}
                  rows={4}
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
      {reason&&alert.decision?.status!=="pending_review"&&<div className="task-conflict" role="alert"><p>Событие уже оценено в другой сессии. Ваш комментарий не отправлен и остаётся здесь для копирования. Сохранённое решение показано выше.</p><label className="field">Ваш неотправленный комментарий<textarea ref={comment} rows={4} value={reason} readOnly/></label><Button variant="secondary" onClick={()=>confirm(()=>{setReason("");clear();},clearCommentPrompt)}>Очистить мой комментарий</Button></div>}
      {!!alert.actions?.length && <div className="event-action-result">{alert.actions.map(action=><div key={action.task_id}><strong>Задача #{action.task_id}: {action.title}</strong><p>{action.status === "done" ? "Действие выполнено; результат проверяется отдельно" : action.status === "in_progress" ? "Задача в работе" : "Задача назначена"}{action.reply_message_id ? " · ответ пациенту сохранён" : ""}</p></div>)}</div>}
      {alert.status !== "closed" && <>
        <Disclosure lazy title={alert.actions?.length ? "Действия по событию" : "Назначить действие по событию"}><EventAction alertId={alert.id} notify={notify} done={reload} scope={cardTabScope}/></Disclosure>
      </>}
      <Button variant="ghost" onClick={openPlan}>Открыть план и задачи пациента</Button>
    </article>
  );
}

function PatientCard({
  patientId,
  back,
  backLabel="Все пациенты",
  notify,
  simulated = false,
  initialTab = "feedback",
  initialAnswer,
  onTabChange,
}: {
  patientId: number;
  back: () => void;
  backLabel?:string;
  notify: Notify;
  simulated?: boolean;
  initialTab?: CardTab;
  initialAnswer?:PatientAnswerTarget;
  onTabChange?:(tab:CardTab)=>void;
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
  const adherence = useApi<{ reports: Adherence[] }>(
    `/patients/${patientId}/adherence`,
    15000,
  );
  const alerts = useApi<Alert[]>(`/alerts?patient_id=${patientId}`, 15000);
  const surveys = useApi<Survey[]>("/surveys");
  const [tab, setTab] = useState<CardTab>(initialTab);
  useLayoutEffect(()=>setTab(initialTab),[initialTab]);
  const [noteText, setNoteText] = useState("");
  const [noteRevealRequest,setNoteRevealRequest]=useState(0);
  const [noteDimension, setNoteDimension] = useState<Dimension | "">("");
  const [noteError,setNoteError]=useState("");
  const noteErrorId=useId();
  const [source, setSource] = useState<Source | null>(null);
  const [taskSource,setTaskSource]=useState<Source|null>(null);
  const [sourceAssigned,setSourceAssigned]=useState(false);
  const [sourceRequest,setSourceRequest]=useState(0);
  const [highlightedSource,setHighlightedSource]=useState<Source|null>(null);
  const pendingSourceFocus=useRef<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [surveyId, setSurveyId] = useState("");
  const [assignError,setAssignError]=useState("");
  const assignErrorResult=useRef<HTMLDivElement>(null),assignErrorId=useId();
  const selectedSurvey=surveys.data?.find(survey=>String(survey.id)===surveyId);
  const assignSelectionId=`${assignErrorId}-selection`;
  useEffect(()=>{if(assignError)assignErrorResult.current?.querySelector<HTMLElement>('.error-box')?.focus();},[assignError]);
  const cardContent=useRef<HTMLDivElement>(null);
  const [locatedAnswer,setLocatedAnswer]=useState("");
  const guard=useNavigationGuard();
  function focusNote() {
    setNoteRevealRequest(value=>value+1);
  }
  const {clear:clearNote,confirm:confirmNote}=useUnsavedForm({dirty:Boolean(card.data&&(noteText||noteDimension)),pending:busy,prompt:notePrompt,focus:noteText||noteDimension?focusNote:undefined});
  const {clear:clearAssignment}=useUnsavedForm({dirty:Boolean(card.data&&surveyId),pending:busy,prompt:quickAssignmentPrompt,focus:()=>document.getElementById("quick-survey")?.focus()});
  const unavailable=card.errorStatus===403||card.errorStatus===404;
  useEffect(()=>{
    if(!unavailable)return;
    setNoteText("");setNoteDimension("");setNoteError("");setSurveyId("");setAssignError("");setSource(null);setTaskSource(null);setHighlightedSource(null);pendingSourceFocus.current=null;setSourceAssigned(false);
    clearNote();clearAssignment();
  },[unavailable,clearNote,clearAssignment]);
  useEffect(()=>{
    if(!source)return;
    setNoteRevealRequest(value=>value+1);
  },[source]);
  function selectNoteSource(value:Source) {
    if(source&&(source.type!==value.type||source.id!==value.id)&&(noteText||noteDimension)) {
      confirmNote(()=>{setNoteText("");setNoteDimension("");setNoteError("");setSource(value);},{
        eyebrow:"Несохранённая заметка",
        title:"Сменить источник заметки?",
        message:"Текущая заметка ещё не сохранена. При смене источника её текст и выбранное направление будут очищены. Можно вернуться, сохранить заметку и затем выбрать другой ответ.",
        stayLabel:"Продолжить текущую заметку",
        discardLabel:"Сменить источник без сохранения",
      });
      return;
    }
    setNoteError("");setSource(value);
  }
  function changeTab(next:CardTab) {if(next!==tab)guard.runFor(()=>{setTab(next);onTabChange?.(next);},cardTabScope);}
  function startTask(value:Source) {
    guard.runFor(()=>{setTaskSource(value);setSourceAssigned(false);setSourceRequest(value=>value+1);setTab("care");onTabChange?.("care");},cardTabScope);
  }
  function resolveCareSource(task:CareTask):Source|null {
    if(task.source_type==="survey_submission") {
      const row=assignments.data?.find(item=>item.submission?.id===task.source_id);
      return row?.submission?{type:"survey_submission",id:row.submission.id,label:row.survey.title,occurredAt:row.submission.created_at,questions:row.survey.questions,answers:row.submission.answers}:null;
    }
    if(task.source_type==="adherence_report") {
      const row=adherence.data?.reports.find(item=>item.id===task.source_id);
      return row?{type:"adherence_report",id:row.id,label:row.recommendation,detail:row.reason,occurredAt:row.created_at}:null;
    }
    return null;
  }
  function showCareSource(value:Source) {
    guard.runFor(()=>{pendingSourceFocus.current=`${value.type}:${value.id}`;setHighlightedSource({...value});setTab("feedback");onTabChange?.("feedback");},cardTabScope);
  }
  function focusCareSource(element:HTMLElement|null) {
    if(!element||element.dataset.careSource!==pendingSourceFocus.current||element.closest("[inert]"))return;
    pendingSourceFocus.current=null;element.focus({preventScroll:true});element.scrollIntoView({block:"center",behavior:"auto"});
  }
  const assignRequest = useRef({ surveyId: "", id: "" });
  async function addNote(event: FormEvent) {
    event.preventDefault();
    setNoteError("");setBusy(true);
    try {
      await send(`/patients/${patientId}/notes`, {
        text: noteText,
        source_type: source?.type ?? "manual",
        source_id: source?.id ?? null,
        dimension: noteDimension || null,
      });
      setNoteText("");
      setSource(null);
      setNoteDimension("");
      clearNote();
      notes.reload();
      notify("Приватная заметка сохранена");
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Не удалось сохранить заметку");
      setNoteRevealRequest(value=>value+1);
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (!surveyId) return;
    if (assignRequest.current.surveyId !== surveyId)
      assignRequest.current = { surveyId, id: crypto.randomUUID() };
    setAssignError("");setBusy(true);
    try {
      await send(`/surveys/${surveyId}/assign`, {
        patient_ids: [patientId],
        client_request_id: assignRequest.current.id,
      });
      setSurveyId("");
      clearAssignment();
      assignRequest.current = { surveyId: "", id: "" };
      assignments.reload();
      notify("Опрос назначен пациенту");
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : "Не удалось назначить опрос");
    } finally {
      setBusy(false);
    }
  }
  const answerKey=initialAnswer?`${initialAnswer.assignmentId}-${initialAnswer.submissionId}-${initialAnswer.questionId}`:"";
  const answerAssignment=initialAnswer?assignments.data?.find(assignment=>assignment.patient_id===patientId&&assignment.id===initialAnswer.assignmentId&&assignment.submission?.id===initialAnswer.submissionId&&assignment.survey.questions.some(question=>question.id===initialAnswer.questionId)&&Object.prototype.hasOwnProperty.call(assignment.submission.answers,initialAnswer.questionId)):undefined;
  function focusSelectedAnswer() {
    if(!initialAnswer)return;
    const assignment=[...cardContent.current?.querySelectorAll<HTMLElement>('[data-assignment-id]')??[]].find(element=>element.dataset.assignmentId===String(initialAnswer.assignmentId)&&!element.closest('[inert]'));
    const question=[...assignment?.querySelectorAll<HTMLElement>('[data-question]')??[]].find(element=>element.dataset.question===initialAnswer.questionId);
    const target=question??assignment;
    target?.focus({preventScroll:true});target?.scrollIntoView({block:"center",behavior:"auto"});
  }
  useLayoutEffect(()=>{
    if(!card.data||tab!=="feedback"||!answerAssignment||locatedAnswer===answerKey)return;
    if(!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))focusSelectedAnswer();
    setLocatedAnswer(answerKey);
  },[card.data,tab,answerAssignment,locatedAnswer,answerKey]);
  const p = card.data;
  return (
    <>
      <button className="back-link" onClick={()=>guard.run(back)}>
        <ArrowLeft size={16} /> {backLabel}
      </button>
      <ErrorBox message={card.error?`${card.data?"На экране — последние полученные данные. ":""}${card.error}`:""} retry={card.reload} />
      {!p ? (
        card.loading?<Loading />:<Empty title={unavailable?"Карточка недоступна":"Не удалось загрузить карточку"}>Вернитесь в предыдущий раздел или повторите загрузку.</Empty>
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
          <div className="patient-columns" ref={cardContent}>
            <div className="patient-primary">
              <div
                className="tabs"
                role="tablist"
                aria-label="Разделы карточки"
              >
                {[
                  ["feedback", "Обратная связь"],
                  ["care", "План и задачи"],
                  ["events", "События"],
                  ["medications", "Расписание лекарств"],
                  ["chat", simulated ? "Telegram · симулятор" : "Диалог"],
                  ["clinical", "История состояния"],
                ].map(([key, label]) => (
                  <button
                    role="tab"
                    aria-selected={tab === key}
                    tabIndex={tab === key ? 0 : -1}
                    className={tab === key ? "active" : ""}
                    key={key}
                    onClick={() => changeTab(key as CardTab)}
                    onKeyDown={event => {
                      const keys:CardTab[]=["feedback","care","events","medications","chat","clinical"];
                      const current=keys.indexOf(key as CardTab);
                      const next=event.key === "ArrowRight" ? (current+1)%keys.length : event.key === "ArrowLeft" ? (current+keys.length-1)%keys.length : event.key === "Home" ? 0 : event.key === "End" ? keys.length-1 : null;
                      if(next !== null){event.preventDefault();const tabs=event.currentTarget.parentElement;guard.runFor(()=>{setTab(keys[next]);onTabChange?.(keys[next]);tabs?.querySelectorAll<HTMLButtonElement>('button[role="tab"]')[next]?.focus();},cardTabScope);}
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="card-section-purpose" role="status">{cardSections[tab].description}</p>
              <AnimatePresence mode="wait" initial={false}><ContentFrame key={tab}>
              {tab === "care" && <CareWorkflow key={`${taskSource?.type}-${taskSource?.id}-${sourceRequest}`} patientId={patientId} source={taskSource} notify={notify} scope={cardTabScope} resolveSource={resolveCareSource} openSource={showCareSource} composeRequested={!sourceAssigned} onCreated={()=>setSourceAssigned(true)} />}
              {tab === "medications" && <MedicationSchedule patientId={patientId} notify={notify} readOnly onSource={startTask} />}
              {tab === "feedback" && (
                <>
                  <Section
                    className="survey-results-panel"
                    title="Опросы и ответы"
                    aside={
                      <Badge>
                        {assignments.data?.filter((a) => a.submission).length ??
                          "—"}{" "}
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
                    {initialAnswer&&answerAssignment&&<div className="answer-source-context"><FileText size={18}/><span>В карточке выделен ответ, выбранный в аналитике.</span><Button variant="ghost" onClick={focusSelectedAnswer}>Показать выбранный ответ</Button></div>}
                    {initialAnswer&&assignments.data&&!answerAssignment&&<p className="subtle-notice" role="status">Выбранный ответ не найден в доступных назначениях. Можно повторить загрузку или вернуться в аналитику.</p>}
                    <div ref={assignErrorResult} id={assignErrorId}><ErrorBox message={assignError}/></div>
                    {selectedSurvey&&<p className="field-hint" id={assignSelectionId}>Выбран опрос «{selectedSurvey.title}». Версия {selectedSurvey.version}. Вопросов: {selectedSurvey.questions.length}.</p>}
                    <div className="quick-assign">
                      <label className="sr-only" htmlFor="quick-survey">
                        Опрос для назначения
                      </label>
                      <select
                        id="quick-survey"
                        aria-describedby={[assignError&&assignErrorId,selectedSurvey&&assignSelectionId].filter(Boolean).join(" ")||undefined}
                        disabled={busy}
                        value={surveyId}
                        onChange={(e) => {setAssignError("");setSurveyId(e.target.value);}}
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
                        <Plus size={16} /> {busy?"Сохраняем…":"Назначить"}
                      </Button>
                    </div>
                    {!assignments.data ? (
                      <p className="muted">Назначения ещё не получены.</p>
                    ) : !assignments.data.length ? (
                      <Empty title="Опросов пока нет">
                        Можно назначить опубликованный опрос выше.
                      </Empty>
                    ) : (
                      [...assignments.data].sort((a,b)=>Date.parse(b.submission?.created_at ?? b.first_opened_at ?? b.created_at)-Date.parse(a.submission?.created_at ?? a.first_opened_at ?? a.created_at) || b.id-a.id).map((assignment) => (
                        <article
                          className={`assignment-result ${highlightedSource?.type==="survey_submission"&&highlightedSource.id===assignment.submission?.id?"care-source-highlight":""}`}
                          ref={focusCareSource}
                          data-care-source={assignment.submission?`survey_submission:${assignment.submission.id}`:undefined}
                          data-assignment-id={assignment.id}
                          tabIndex={-1}
                          key={assignment.id}
                        >
                          <header className="assignment-result-heading">
                            <div>
                              <h3>{assignment.survey.title}</h3>
                              <p className="assignment-result-meta">{assignment.submission?`Ответ от ${date(assignment.submission.created_at)}`:`Назначен ${date(assignment.created_at)}`}<span aria-hidden="true"> · </span>Версия {assignment.survey.version}</p>
                            </div>
                            <div className="assignment-result-status"><Badge tone={assignment.submission?"good":"muted"}>{assignment.submission?"Ответ получен":"Ждём ответа"}</Badge>{assignment.id===answerAssignment?.id&&<Badge tone="purple">Из аналитики</Badge>}</div>
                          </header>
                          <div className="assignment-timing"><Disclosure title="Даты и прохождение">
                            <dl>
                              <div><dt>Назначен</dt><dd>{date(assignment.created_at)}</dd></div>
                              <div><dt>Первое открытие</dt><dd>{assignment.first_opened_at?date(assignment.first_opened_at):"Время неизвестно"}</dd></div>
                              <div><dt>Ответ получен</dt><dd>{assignment.submission?date(assignment.submission.created_at):"Пока нет ответа"}</dd></div>
                              <div><dt>Срок ответа</dt><dd>{assignment.due_at?date(assignment.due_at):"Не задан"}</dd></div>
                            </dl>
                          </Disclosure></div>
                          {assignment.submission && (
                            <>
                              <AnswerSummary
                                questions={assignment.survey.questions}
                                answers={assignment.submission.answers}
                                highlightQuestion={assignment.id===answerAssignment?.id?initialAnswer?.questionId:undefined}
                              />
                              <div className="assignment-actions">
                                <Button variant="secondary" onClick={()=>startTask({type:"survey_submission",id:assignment.submission!.id,label:assignment.survey.title,occurredAt:assignment.submission!.created_at,questions:assignment.survey.questions,answers:assignment.submission!.answers})}><Plus size={17}/> Запланировать шаг</Button>
                                <Button variant="ghost" onClick={()=>selectNoteSource({type:"survey_submission",id:assignment.submission!.id,label:assignment.survey.title})}><FileText size={17}/> Заметка к ответу</Button>
                              </div>
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
                        <article className={`adherence-report ${highlightedSource?.type==="adherence_report"&&highlightedSource.id===report.id?"care-source-highlight":""}`} key={report.id} ref={focusCareSource} data-care-source={`adherence_report:${report.id}`} tabIndex={-1}>
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
                                selectNoteSource({
                                  type: "adherence_report",
                                  id: report.id,
                                  label: report.recommendation,
                                });
                              }}
                            >
                              Заметка к ответу
                            </Button>
                            <Button variant="secondary" onClick={()=>startTask({type:"adherence_report",id:report.id,label:report.recommendation,detail:report.reason,occurredAt:report.created_at})}><Plus size={15}/> Запланировать шаг</Button>
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
                    scope={cardTabScope}
                    simulated={simulated}
                    notify={notify}
                    onObservation={(message) => {
                      selectNoteSource({type: "message", id: message.id, label: `Сообщение от ${date(message.created_at)}`});
                    }}
                  />
                </Section>
              )}
              {tab === "clinical" && (
                <>
                  <Section title="История PHQ-9 и GAD-7">
                    <ErrorBox message={history.error} retry={history.reload} />
                    {history.data ? (
                      <AssessmentHistory rows={history.data} />
                    ) : (
                      <p className="muted">Результаты шкал ещё не получены.</p>
                    )}
                  </Section>
                  <SharedDiary patientId={patientId} onSource={startTask} />
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
                </>
              )}
              {tab === "events" && (
                <>
                  <Section title="События и запросы пациента">
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
                          openPlan={()=>startTask({type:"alert",id:alert.id,label:"Событие пациента"})}
                        />
                      ))
                    )}
                  </Section>
                </>
              )}
              </ContentFrame></AnimatePresence>
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
                <Disclosure title="Добавить приватную заметку" revealRequest={noteRevealRequest} focusTarget=".error-box,textarea">
                <form className="private-note-form" onSubmit={addNote}>
                  <div id={noteErrorId}><ErrorBox message={noteError}/></div>
                  <fieldset className="form-fields" disabled={busy} aria-busy={busy} aria-describedby={noteError?noteErrorId:undefined}>
                  <label className="field">Направление наблюдения
                    <select value={noteDimension} onChange={(e) => {setNoteError("");setNoteDimension(e.target.value as Dimension | "");}}>
                      <option value="">Общая заметка</option>
                      {Object.entries(dimensionLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </label>
                  {source && (
                    <div className="source-chip">
                      <span>Источник наблюдения: {source.label}</span>
                      <button
                        type="button"
                        aria-label="Убрать связь с ответом"
                        onClick={() => {setNoteError("");setSource(null);focusNote();}}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  {source && <Button type="button" variant="secondary" onClick={() => startTask(source)}>Запланировать шаг</Button>}
                  <label className="field" htmlFor="note-text">
                    Текст приватной заметки
                  <textarea
                    id="note-text"
                    rows={3}
                    maxLength={4000}
                    value={noteText}
                    onChange={(e) => {setNoteError("");setNoteText(e.target.value);}}
                    placeholder="Что важно уточнить или обсудить…"
                    required
                  />
                  </label>
                  <Button
                    variant="secondary"
                    type="submit"
                    disabled={busy || !noteText.trim()}
                  >
                    <Plus size={15} /> Сохранить заметку
                  </Button>
                  </fieldset>
                </form>
                </Disclosure>
                <Disclosure title={`Сохранённые заметки (${notes.data?.length??"…"})`}>
                <div className="notes-list">
                  {notes.data?.map((note) => (
                    <article key={note.id}>
                      {note.dimension && <Badge tone="purple">{dimensionLabels[note.dimension]}</Badge>}
                      <p className="preserve">{note.text}</p>
                      <small>
                        {date(note.created_at)}
                        {` · ${note.doctor_name}`}
                        {note.source_type !== "manual"
                          ? " · связан с источником"
                          : ""}
                      </small>
                    </article>
                  ))}
                </div>
                </Disclosure>
              </Section>
              {tab!=="care"&&<Section
                title="Следующий шаг"
                aside={<Clock3 size={17} className="muted" />}
              >
                <p className="field-hint">Назначьте исполнителя, сохраните действие и отдельно проверьте результат.</p>
                <Button variant="secondary" onClick={() => changeTab("care")}>Открыть план и задачи</Button>
              </Section>}
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
  initialTab = "feedback",
  openTasks,
  back,
  backLabel,
  scope="patients",
  initialAnswer,
  onTabChange,
}: {
  selected: number | null;
  onSelect: (id: number | null) => void;
  notify: Notify;
  simulated?: boolean;
  initialTab?: CardTab;
  openTasks?: () => void;
  back?:()=>void;backLabel?:string;scope?:string;
  initialAnswer?:PatientAnswerTarget;
  onTabChange?:(tab:CardTab)=>void;
}) {
  const [query, setQuery] = useViewState(`${scope}-search-input`,"");
  const [search,setSearch] = useViewState(`${scope}-search`,"");
  const [cursors,setCursors] = useViewState<number[]>(`${scope}-pages`,[]);
  useEffect(() => {window.scrollTo(0,0);},[selected]);
  useEffect(() => {if(search===query.trim())return;const timer = setTimeout(() => {setSearch(query.trim());setCursors([]);},250); return () => clearTimeout(timer);},[query,search,setSearch,setCursors]);
  const patients = useApi<{total:number;items:Patient[];next_cursor:number|null}>(selected === null ? `/patients/directory?q=${encodeURIComponent(search)}&after=${cursors.at(-1) ?? 0}` : null);
  useReturnFocus(scope,selected===null&&Boolean(patients.data||patients.error)&&search===query.trim());
  const [previousPage,setPreviousPage] = useState<typeof patients.data>();
  useEffect(()=>{if(patients.data)setPreviousPage(patients.data);},[patients.data]);
  if (selected !== null)
    return (
      <PatientCard
        key={`${selected}-${simulated}`}
        patientId={selected}
        back={back??(()=>onSelect(null))}
        backLabel={backLabel??(scope==="state"?"К динамике состояния":scope==="telegram"?"К списку симулятора":"К списку пациентов")}
        notify={notify}
        simulated={simulated}
        initialTab={initialTab}
        onTabChange={onTabChange}
        initialAnswer={initialAnswer}
      />
    );
  const page = patients.data ?? (patients.loading ? previousPage : undefined);
  const filtered = page?.items;
  return (
    <>
      <Heading eyebrow="Люди, которым вы помогаете" title={scope === "state" ? "Динамика состояния" : "Пациенты"}>
        {initialTab === "clinical" ? "Выберите пациента, чтобы открыть PHQ-9, GAD-7 и сохранённые ответы по пунктам." : "Опросы, самоотчёты и переписка в одной карточке."}
      </Heading>
      <div className="board-toolbar"><div className="search-field">
        <Search size={18} />
        <input
          aria-label="Поиск пациента"
          placeholder="Найти по имени…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>{openTasks && <Button variant="secondary" onClick={openTasks}>Открыть доску задач</Button>}<Button variant="ghost" onClick={patients.reload}>Обновить</Button></div>
      <p className="field-hint directory-status-line" role="status">{patients.loading || search !== query.trim() ? "Обновляем список…" : patients.data ? `Найдено: ${patients.data.total}. На странице: ${patients.data.items.length}. Показаны только ваши пациенты.` : "Список пациентов ещё не получен."}</p>
      <ErrorBox message={patients.error ? `${patients.data ? "На экране — последние полученные данные. " : ""}${patients.error}` : ""} retry={patients.reload} />
      {patients.loading && !page ? (
        <div className="patient-directory directory-skeleton" role="status" aria-label="Загружаем список пациентов"><span className="sr-only">Загружаем список пациентов</span>{Array.from({length:6},(_,i)=><div className="skeleton-directory-row" key={i} aria-hidden="true"><i/><div><span/><span/></div><span/><span/></div>)}</div>
      ) : !filtered ? (
        <Empty title="Список пациентов пока недоступен" />
      ) : !filtered?.length ? (
        <Empty title="Пациенты не найдены">Измените поисковый запрос или очистите поле, чтобы вернуться ко всему списку.</Empty>
      ) : (
        <div className="patient-directory" aria-busy={patients.loading || search !== query.trim()}>
          <div className="directory-labels" aria-hidden="true"><span>Пациент</span><span>Сопровождение</span><span>Требует внимания</span><span>Измерение</span><span/></div>
          {filtered.map((p) => (
            <button
              className="directory-row"
              data-return-key={`directory-${p.id}`}
              key={p.id}
              disabled={patients.loading || search !== query.trim()}
              onClick={() => onSelect(p.id)}
            >
              <div className="directory-person"><Avatar name={p.full_name} small/><div><strong>{p.full_name}</strong><small>{p.demo_scenario ?? `Учебная карточка #${p.id}`}</small></div></div>
              <div className="directory-status"><Badge tone={p.treatment_status === "completed" ? "good" : "muted"}>{treatmentLabels[p.treatment_status ?? "unknown"]}</Badge></div>
              <div className="directory-signals"><span>{(p.pending_events ?? 0)>0?<Badge tone="warn">События: {p.pending_events}</Badge>:"Нет открытых событий"}</span><small>Задачи: {p.open_tasks ?? 0} назначено · {p.in_progress_tasks ?? 0} в работе</small></div>
              <div className="directory-date"><span>{p.last_observation_at ? date(p.last_observation_at) : "Пока нет"}</span><small>Состояние пациента</small></div>
              <ChevronRight size={18}/>
            </button>
          ))}
        </div>
      )}
      {page && <div className="directory-pagination"><Button variant="secondary" disabled={patients.loading || !cursors.length} onClick={() => setCursors(prev => prev.slice(0,-1))}>Назад</Button><span>Страница {cursors.length+1}</span><Button variant="secondary" disabled={patients.loading || !page.next_cursor} onClick={() => setCursors(prev => [...prev,page.next_cursor!])}>Далее</Button></div>}
    </>
  );
}
