import { createRequestId } from "./requestId";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, FileCheck2, Send } from "lucide-react";
import { ApiError, send, useApi, type Question } from "./api";
import { AnswerSummary } from "./SurveyFields";
import { Badge, Button, date, ErrorBox, Loading } from "./UI";
import "./emr-demo.css";

type Content={
  patient_reference:{id:number};
  source:{submitted_at:string;survey:{title:string;version:number;questions:Question[]};answers:Record<string,unknown>};
  care:{title:string;status:string;action_result:string;verification:{status:string;comment:string}};
};
type Document={id:number;content_hash:string;content:Content;approved_at:string;status:"approved"|"accepted_by_simulator";
  is_current:boolean;receipt:{id:number;accepted_at:string;external_delivery:false}|null};
type Preview={task_id:number;task_revision:number;patient_name:string;content_hash:string;content:Content;latest_document:Document|null};
const stages:Record<string,string>={open:"Назначено",in_progress:"В работе",done:"Действие выполнено"};
const checks:Record<string,string>={pending:"Результат ещё не проверен",unknown:"Результат неизвестен",resolved:"Затруднение устранено",not_resolved:"Затруднение сохраняется"};

export function EmrDemo({patientId,taskId,taskRevision,disabled=false}:{patientId:number;taskId:number;taskRevision:number;disabled?:boolean}) {
  const scope=`${patientId}:${taskId}:${taskRevision}`;
  const liveScope=useRef(scope);liveScope.current=scope;
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const resource=useApi<Preview>(disabled?null:`/patients/${patientId}/tasks/${taskId}/emr-preview`,0,taskRevision);
  const [localDocument,setLocalDocument]=useState<{scope:string;value:Document}|null>(null);
  const [confirmedHash,setConfirmedHash]=useState("");
  const [pending,setPending]=useState<string|null>(null);
  const busy=pending===scope;
  const [writeError,setWriteError]=useState<{scope:string;message:string;conflict:boolean;action:"approve"|"transfer"}|null>(null);
  const request=useRef<{hash:string;scope:string;id:string}|null>(null);
  const resultTitle=useRef<HTMLHeadingElement>(null),focusResult=useRef(false);
  useLayoutEffect(()=>{if(focusResult.current){focusResult.current=false;resultTitle.current?.focus({preventScroll:true});}},[localDocument]);
  const data=resource.data;
  const document=localDocument?.scope===scope?localDocument.value:data?.latest_document;
  const error=writeError?.scope===scope?writeError:null;
  const ready=Boolean(data&&data.task_revision>=taskRevision&&!resource.refreshing&&!resource.error&&!error?.conflict);
  function refresh() {setWriteError(null);setConfirmedHash("");setLocalDocument(null);resource.reload();}
  async function act(action:"approve"|"transfer",trigger:HTMLButtonElement) {
    if(!data||busy||!ready)return;
    if(action==="approve"&&confirmedHash!==data.content_hash)return;
    if(action==="transfer"&&(!document||!document.is_current))return;
    const origin=scope;
    if(!request.current||request.current.hash!==data.content_hash||request.current.scope!==scope)
      request.current={hash:data.content_hash,scope,id:createRequestId()};
    setPending(origin);setWriteError(null);
    try {
      const value=action==="approve"?await send<Document>(`/patients/${patientId}/emr-documents`,{
        task_id:taskId,expected_task_revision:data.task_revision,content_hash:data.content_hash,
        confirmed:true,client_request_id:request.current.id,
      }):await send<Document>(`/patients/${patientId}/emr-documents/${document!.id}/simulate-transfer`,{
        content_hash:document!.content_hash,confirmed:true,
      });
      if(!alive.current||liveScope.current!==origin)return;
      focusResult.current=window.document.activeElement===trigger;
      setLocalDocument({scope:origin,value});setConfirmedHash("");
    } catch(cause) {
      if(alive.current&&liveScope.current===origin)setWriteError({scope:origin,action,
        message:cause instanceof Error?cause.message:"Не удалось сохранить результат. Повторите попытку.",
        conflict:cause instanceof ApiError&&cause.status===409});
    } finally {if(alive.current)setPending(current=>current===origin?null:current);}
  }
  if(disabled)return <p className="field-hint">Предпросмотр включает сохранённые сведения. Сначала завершите сохранение или обновление задачи.</p>;
  if(resource.error&&!data)return <ErrorBox message={resource.error} retry={resource.reload}/>;
  if(!data)return <Loading/>;
  return <section className="emr-demo" aria-label="Передача в ЭМК" aria-busy={busy||resource.refreshing}>

    <div className="emr-demo-identity"><div><span className="eyebrow">Пациент</span><strong>{data.patient_name}</strong></div><span>ID в МИС: {data.content.patient_reference.id}</span></div>
    <div className="emr-demo-source"><h4>{data.content.source.survey.title}</h4><p className="field-hint">Версия {data.content.source.survey.version} · ответ {date(data.content.source.submitted_at)}</p><AnswerSummary questions={data.content.source.survey.questions} answers={data.content.source.answers}/></div>
    <div className="emr-demo-care"><div><span className="eyebrow">Действие по задаче</span><strong>{data.content.care.title}</strong><Badge tone="muted">{stages[data.content.care.status]??data.content.care.status}</Badge><p className="preserve">{data.content.care.action_result||"Описание действия ещё не сохранено"}</p></div><div><span className="eyebrow">Отдельная проверка</span><strong>{checks[data.content.care.verification.status]??data.content.care.verification.status}</strong>{data.content.care.verification.comment&&<p className="preserve">{data.content.care.verification.comment}</p>}</div></div>
    <details className="emr-demo-json"><summary>Показать JSON-пакет</summary><pre tabIndex={0} aria-label="Содержимое JSON-пакета">{JSON.stringify(data.content,null,2)}</pre></details>
    <ErrorBox message={resource.error||error?.message||""}/>
    {(resource.error||error?.conflict||data.task_revision<taskRevision)&&<Button type="button" variant="secondary" disabled={busy||resource.refreshing} onClick={refresh}>Обновить предпросмотр</Button>}
    {document&&<div className="emr-demo-result" role="status"><CheckCircle2 size={21} aria-hidden="true"/><div><h4 className="emr-step-title" tabIndex={-1} ref={resultTitle}>{document.receipt?"Квитанция получена":"Одобрено Вами"}</h4><p>{document.receipt?date(document.receipt.accepted_at):date(document.approved_at)}{!document.is_current&&" · прежняя версия сведений"}</p></div></div>}
    {document?.receipt&&document.is_current?<p className="field-hint">Квитанция сохранена.</p>:document?.is_current?<Button type="button" disabled={!ready} aria-disabled={busy||!ready} onClick={event=>void act("transfer",event.currentTarget)}><Send size={17}/>{busy?"Передаём…":error?.action==="transfer"?"Повторить передачу":"Передать документ"}</Button>:<>
      {document&&!document.is_current&&<p className="field-hint">Задача изменилась после прошлого одобрения. Ниже одобряется текущий предпросмотр.</p>}
      <label className="checkline"><input type="checkbox" checked={confirmedHash===data.content_hash} disabled={busy||!ready} onChange={event=>setConfirmedHash(event.target.checked?data.content_hash:"")}/>Проверил(а) пациента и содержимое пакета</label>
      <Button type="button" disabled={!ready||confirmedHash!==data.content_hash} aria-disabled={busy||!ready||confirmedHash!==data.content_hash} onClick={event=>void act("approve",event.currentTarget)}><FileCheck2 size={17}/>{busy?"Сохраняем…":error?.action==="approve"?"Повторить одобрение":"Одобрить этот пакет"}</Button>
    </>}
  </section>;
}
