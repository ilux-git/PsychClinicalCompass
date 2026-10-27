import {surveyDescription,surveyTitle} from "./presentation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronRight, LockKeyhole, Save, Send, Sparkles } from "lucide-react";
import { api, ApiError, send, type Assignment } from "./api";
import { Badge, Button, date, ErrorBox, Loading, type Notify } from "./UI";
import { AnswerSummary, SurveyFields, visibleQuestions } from "./SurveyFields";
import { InstrumentSource } from "./ClinicalHistory";
import { useNavigationGuard, useUnsavedForm, type LeavePrompt } from "./NavigationGuard";
import { ContentFrame } from "./Interaction";
import { ParticipationReceipt, type ParticipationConfirmation } from "./ParticipationReceipt";

type Draft = { answers: Record<string, unknown>; revision: number; updated_at: string | null; already_completed: boolean };
const replaceDraftPrompt:LeavePrompt={eyebrow:"Сохранённый черновик",title:"Заменить текущие ответы сохранённой версией?",message:"Ответы на экране будут заменены черновиком с сервера. Сначала можно вернуться в форму и скопировать свой текст.",stayLabel:"Оставить текущие ответы",discardLabel:"Загрузить и заменить ответы"};

export function AssignedSurvey({ assignment:initialAssignment, done, progress, notify }: {assignment:Assignment; done:()=>void; progress?:()=>void; notify:Notify}) {
  // The parent route is keyed by assignment.id. Polling must not replace an active form's baseline.
  const [assignment]=useState(initialAssignment);
  const [answers,setAnswers] = useState<Record<string,unknown>>({});
  const [draft,setDraft] = useState<Draft | null>(null);
  const [action,setAction] = useState<"submit"|"draft"|null>(null);
  const [saved,setSaved] = useState(false), [loadRevision,setLoadRevision] = useState(0);
  const [confirmation,setConfirmation]=useState<ParticipationConfirmation>({});
  const [draftError,setDraftError] = useState(""), [conflict,setConflict] = useState(false);
  const [openingError,setOpeningError] = useState(""), [openingRevision,setOpeningRevision] = useState(0);
  const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
  const [validationAttempt,setValidationAttempt]=useState(0);
  const invalidQuestion=useRef<string|null>(null);
  const formRef = useRef<HTMLElement>(null);
  const thanksTitle=useRef<HTMLHeadingElement>(null);
  const guard = useNavigationGuard();
  const dirty = Boolean(draft && !saved && JSON.stringify(answers) !== JSON.stringify(draft.answers));
  const {clear:clearGuard,confirm} = useUnsavedForm({dirty,pending:Boolean(action),save:!conflict && draft && !action ? ()=>saveDraft(false) : undefined,focus:()=>{const section=formRef.current;section?.querySelector<HTMLElement>('.error-box,textarea,input')?.focus();}});
  useEffect(()=>{if(draftError)formRef.current?.querySelector<HTMLElement>('.error-box')?.focus();},[draftError]);
  useEffect(()=>{if(saved)thanksTitle.current?.focus({preventScroll:true});},[saved]);
  useEffect(()=>{
    const first=invalidQuestion.current;
    if(first)Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-question]')??[]).find(element=>element.dataset.question===first)?.querySelector<HTMLInputElement>('input')?.focus();
  },[validationAttempt]);
  function changeAnswers(next:Record<string,unknown>) {
    setAnswers(next);
    setFieldErrors(current=>{
      const remaining=Object.fromEntries(Object.entries(current).filter(([id])=>!Array.isArray(next[id])||!next[id].length));
      return Object.keys(remaining).length===Object.keys(current).length?current:remaining;
    });
  }
  useEffect(() => {
    if (assignment.submission) return;
    let active = true;
    setDraft(null); setDraftError("");
    api<Draft>(`/survey-assignments/${assignment.id}/draft`).then(value => {
      if (active) {setDraft(value); setAnswers(value.answers); setConflict(false);}
    }).catch(error => {if(active) setDraftError(error instanceof Error ? error.message : "Не удалось загрузить черновик");});
    return () => {active=false;};
  },[assignment.id,assignment.submission,loadRevision]);
  useEffect(() => {
    const element=formRef.current;
    if (!element || assignment.submission || saved || !draft || draft.already_completed) return;
    let visible=false,requested=false,active=true;
    async function opened() {
      if (!visible || requested || document.visibilityState !== "visible") return;
      requested=true;
      try {await send(`/survey-assignments/${assignment.id}/open`,{}); if(active)setOpeningError("");}
      catch {if(active)setOpeningError("Статус открытия не обновился. Ответы можно сохранить или отправить.");}
    }
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;void opened();});
    observer.observe(element); document.addEventListener("visibilitychange",opened);
    return ()=>{active=false;observer.disconnect();document.removeEventListener("visibilitychange",opened);};
  },[assignment.id,assignment.submission,saved,Boolean(draft),draft?.already_completed,openingRevision]);
  function failed(error:unknown) {
    const text=error instanceof Error ? error.message : "Не удалось сохранить ответы";
    setDraftError(text); if(error instanceof ApiError && error.status===409)setConflict(true);
  }
  async function saveDraft(close=true) {
    if(!draft || action || conflict)return false;
    setDraftError("");setFieldErrors({});
    setAction("draft");
    try {
      const result=await send<Draft>(`/survey-assignments/${assignment.id}/draft`,{answers,expected_revision:draft.revision},"PUT");
      setDraft(result); setAnswers(result.answers); clearGuard();
      notify("Черновик сохранён. Продолжить можно в разделе «Опросы врача»."); if(close)done();
      return true;
    } catch(error){failed(error);return false;} finally{setAction(null);}
  }
  async function submit(event:FormEvent) {
    event.preventDefault(); if(!draft || action)return;
    const missing=assignment.survey.questions.filter(question=>{const answer=answers[question.id];return question.required&&question.kind==="multiple"&&(!Array.isArray(answer)||answer.length===0);});
    if(missing.length){invalidQuestion.current=missing[0].id;setFieldErrors(Object.fromEntries(missing.map(question=>[question.id,"Выберите хотя бы один вариант ответа."])));setValidationAttempt(value=>value+1);return;}
    setDraftError("");
    setAction("submit");
    try {
      const response=await send<ParticipationConfirmation>(`/survey-assignments/${assignment.id}/submit`,{answers,expected_draft_revision:draft.revision});
      setConfirmation(response); clearGuard(); setSaved(true); window.scrollTo(0,0);
    } catch(error){failed(error);} finally{setAction(null);}
  }
  if(saved)return <ContentFrame><section className="panel thanks-card patient-success"><span className="celebration" aria-hidden="true"><Sparkles size={30}/></span>
    <p className="eyebrow">Опрос врача</p><h1 ref={thanksTitle} tabIndex={-1}>Ответы отправлены</h1><p>Ответы доступны Вашему врачу.</p>
    <ParticipationReceipt result={confirmation} progress={progress}/><Button onClick={done}>К опросам врача <ChevronRight size={16}/></Button></section></ContentFrame>;
  return <>
    <button className="back-link" disabled={Boolean(action)} onClick={()=>guard.run(done)}><ArrowLeft size={16}/> Опросы врача</button>
    <section className="panel patient-form" ref={formRef}>
      <div className="survey-form-meta"><Badge tone={assignment.submission?"good":"purple"}>{assignment.submission?"Ответ отправлен":`${assignment.survey.questions.length} вопр.`}</Badge><span>Версия {assignment.survey.version}{assignment.due_at?` · до ${date(assignment.due_at)}`:""}</span></div>
      <h1>{surveyTitle(assignment.survey.title)}</h1><p className="lede">{surveyDescription(assignment.survey.description)}</p>
      {assignment.survey.clinical_instrument&&<InstrumentSource definition={assignment.survey.clinical_instrument}/>}
      {assignment.submission?<><AnswerSummary questions={assignment.survey.questions} answers={assignment.submission.answers}/><p className="field-hint">Отправлено {date(assignment.submission.created_at)}. Для нового ответа врач может назначить ещё один опрос.</p></>:
        !draft?<><ErrorBox message={draftError} retry={()=>setLoadRevision(v=>v+1)}/>{!draftError&&<Loading/>}</>:
        draft.already_completed?<><p>Опрос уже отправлен в другом окне. Откройте обновлённую историю.</p><Button onClick={done}>Обновить опросы врача</Button></>:
        <form onSubmit={submit}>
          <div className="draft-disclosure"><LockKeyhole size={18}/><span>{draft.updated_at?`Продолжаем черновик от ${date(draft.updated_at)}. `:"Можно сделать паузу. "}Черновик виден только Вам. Врач получит ответы после отправки.</span></div>
          <ErrorBox message={openingError} retry={()=>setOpeningRevision(v=>v+1)}/>
          <ErrorBox message={draftError}/>
          {conflict&&<p className="draft-conflict">Текущий ввод остаётся в форме. Загрузка сохранённой версии заменит его. <Button variant="secondary" type="button" onClick={()=>confirm(()=>setLoadRevision(v=>v+1),replaceDraftPrompt)}>Загрузить сохранённую версию</Button></p>}
          <SurveyFields questions={assignment.survey.questions} answers={answers} onChange={changeAnswers} disabled={Boolean(action)} errors={fieldErrors}/>
          {assignment.survey.clinical_instrument&&visibleQuestions(assignment.survey.questions,answers).length===1&&answers.q1==="n0"&&<p className="field-hint">Остальные вопросы не заполняются по правилу этой формы. Можно отправить ответ врачу.</p>}
          <p className="field-hint">{assignment.survey.clinical_instrument?"Для отправки ответьте на показанные вопросы. Расчёт баллов за этот бланк одинаков при любых ответах и с учётом дневного лимита.":"Необязательные вопросы можно пропустить. Баллы начисляются за отправленный опрос."} Для паузы сохраните черновик кнопкой ниже.</p>
          <div className="survey-submit-bar"><Button type="submit" disabled={Boolean(action)||conflict}><Send size={17}/>{action==="submit"?"Отправляем…":"Отправить врачу"}</Button>
            <Button id="save-survey-draft" variant="secondary" type="button" disabled={Boolean(action)||conflict} onClick={()=>saveDraft()}><Save size={17}/>{action==="draft"?"Сохраняем…":"Сохранить и продолжить позже"}</Button></div>
        </form>}
    </section>
  </>;
}
