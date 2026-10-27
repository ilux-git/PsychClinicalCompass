import {accountName} from "./presentation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, send, useApi } from "./api";
import { Badge, Button, date, Empty, ErrorBox, Heading, Loading } from "./UI";
import { useUnsavedForm } from "./NavigationGuard";
import "./coordination.css";

type RouteValue={coordinator_id:number|null;revision:number;updated_at:string|null};
type RouteData=RouteValue&{coordinators:{id:number;name:string}[];waiting_urgent:number;recent_notices:{id:number;patient_id:number;coordinator_id:number;created_at:string;acknowledged_at:string|null;state:string}[]};
type Notice={id:number;patient_id:number;doctor_id:number;doctor_name:string;reason:string;created_at:string;acknowledged_at:string|null;state:string;original_acknowledgement_due_at:string|null};
type NoticePage={pending:number;active:number;items:Notice[];next_before_id:number|null};
const routePath="/doctors/me/escalation-route";
const noticeLabels:Record<string,string>={pending:"Нужно организовать принятие врачом",accepted_by_coordinator:"Принято координатором",accepted_by_doctor:"Врач принял событие",closed_by_doctor:"Врач закрыл событие"};

export function DoctorEscalationSettings() {
  const route=useApi<RouteData>(routePath,15000);
  const [saved,setSaved]=useState<RouteData|null>(null);
  const current=saved&&(!route.data||saved.revision>route.data.revision)?saved:route.data;
  const [draft,setDraft]=useState<{value:string;revision:number}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[conflict,setConflict]=useState(false),[status,setStatus]=useState("");
  const form=useRef<HTMLFormElement>(null),select=useRef<HTMLSelectElement>(null),result=useRef<HTMLParagraphElement>(null),inFlight=useRef(false);
  const value=draft?.value??String(current?.coordinator_id??"");
  const dirty=Boolean(draft&&value!==String(current?.coordinator_id??""));
  const {clear}=useUnsavedForm({dirty,pending:busy,prompt:{eyebrow:"Резервный координатор",title:"Сохранить выбор координатора?",message:"Выбор ещё не сохранён. Уведомления будут использовать прежний маршрут.",stayLabel:"Продолжить настройку"},focus:()=>select.current?.focus()});
  useEffect(()=>{if(error)form.current?.querySelector<HTMLElement>('.error-box')?.focus();else if(status)result.current?.focus();},[error,status]);
  async function save(event:FormEvent) {
    event.preventDefault();if(!current||inFlight.current||conflict)return;
    inFlight.current=true;setBusy(true);setError("");setStatus("");
    try {
      const next=await send<RouteValue>(routePath,{coordinator_id:value?Number(value):null,expected_revision:draft?.revision??current.revision},"PUT");
      setSaved({...current,...next});setDraft(null);clear();route.reload();
      setStatus(next.coordinator_id===null?"Резерв отключён для новых передач. Ранее созданные уведомления сохранены.":"Маршрут сохранён. Подходящие открытые и новые события будут переданы при обработке очереди.");
    }catch(failure){setConflict(failure instanceof ApiError&&failure.status===409);setError(failure instanceof Error?failure.message:"Не удалось сохранить маршрут. Выбор сохранён в форме.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  async function refresh() {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);
    try {
      const next=await api<RouteData>(routePath);setSaved(next);setDraft(previous=>previous?{...previous,revision:next.revision}:null);
      setConflict(false);setError("");setStatus("Маршрут обновлён. Ваш выбор оставлен в форме; сверьте его и сохраните отдельно.");
    }catch(failure){setError(failure instanceof Error?failure.message:"Не удалось обновить маршрут");}
    finally{inFlight.current=false;setBusy(false);}
  }
  if(!current)return route.error?<ErrorBox message={route.error} retry={route.reload}/>:<Loading/>;
  const known=current.coordinators.some(item=>String(item.id)===value);
  return <form ref={form} className="coordination-settings" onSubmit={save}>
    <ErrorBox message={error||route.error} retry={error?undefined:route.reload}/>
    <p className="subtle-notice">{current.coordinator_id===null?"Резервный координатор не выбран. Уведомления координатору не передаются.":"Резерв настроен. Координатор получает только ID пациента и организационное уведомление."}</p>
    <label className="field">Резервный координатор<select ref={select} disabled={busy} value={value} onChange={event=>{setDraft({value:event.target.value,revision:draft?.revision??current.revision});setStatus("");}}>
      <option value="">Не передавать координатору</option>
      {value&&!known&&<option value={value}>Сохранённый получатель недоступен в списке</option>}
      {current.coordinators.map(item=><option key={item.id} value={item.id}>{accountName(item.name)}</option>)}
    </select></label>
    <p>Передача касается ещё не принятых срочных клинических событий, когда врач недоступен или в отпуске, либо истёк исходный срок принятия. Статус «Занят» сам по себе передачу не включает.</p>
    <p className="field-hint">Сейчас не принятых срочных событий: {current.waiting_urgent}. Изменение применяется к ещё не переданным событиям. Ранее переданные остаются у прежнего получателя. ФИО пациента, ответы, баллы и доступ к карточке не передаются.</p>
    <div className="button-row">{conflict&&<Button type="button" variant="secondary" disabled={busy} onClick={refresh}>Обновить маршрут</Button>}<Button disabled={busy||conflict||!dirty||Boolean(value&&!known)}>{busy?"Сохраняем…":"Сохранить маршрут"}</Button></div>
    {status&&<p className="coordination-status" role="status" tabIndex={-1} ref={result}>{status}</p>}
    {current.recent_notices.length>0&&<details className="source-help"><summary>Последние передачи координатору</summary><ul className="coordination-recent">{current.recent_notices.map(item=><li key={item.id}><strong>Пациент #{item.patient_id}</strong><span>{noticeLabels[item.state]??item.state}</span><span>{date(item.created_at)} · {accountName(current.coordinators.find(person=>person.id===item.coordinator_id)?.name??`координатор #${item.coordinator_id}`)}</span></li>)}</ul></details>}
  </form>;
}

function NoticeRow({item,reload}:{item:Notice;reload:()=>void}) {
  const [accepted,setAccepted]=useState(item.acknowledged_at),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const row=useRef<HTMLElement>(null),receipt=useRef<HTMLParagraphElement>(null),inFlight=useRef(false),focusReceipt=useRef(false);
  const receivedAt=item.acknowledged_at??accepted;
  const state=item.state==="pending"&&receivedAt?"accepted_by_coordinator":item.state;
  useEffect(()=>{if(error)row.current?.querySelector<HTMLElement>('.error-box')?.focus();else if(accepted&&focusReceipt.current){focusReceipt.current=false;receipt.current?.focus();}},[accepted,error]);
  async function acknowledge() {
    if(inFlight.current)return;
    const previous=document.activeElement;
    const restore=Boolean(row.current?.contains(previous)&&previous?.closest('[data-notice-accept],.error-box'));
    inFlight.current=true;setBusy(true);setError("");
    try{
      const saved=await send<{acknowledged_at:string}>(`/coordination/urgent-notices/${item.id}/acknowledge`,{});
      focusReceipt.current=Boolean(row.current&&restore&&(document.activeElement===previous||document.activeElement===document.body&&!previous?.isConnected));
      setAccepted(saved.acknowledged_at);reload();
    }catch(failure){setError(failure instanceof Error?failure.message:"Не удалось принять уведомление");}
    finally{inFlight.current=false;setBusy(false);}
  }
  return <article className="panel coordination-notice" ref={row}>
    <div className="section-heading"><h2>Пациент #{item.patient_id}</h2><Badge tone={state==="pending"?"warn":undefined}>{noticeLabels[state]??state}</Badge></div>
    <p>{item.reason==="acknowledgement_overdue"?"Исходный срок принятия уведомления истёк.":"Лечащий врач отметил, что недоступен или находится в отпуске."}</p>
    <dl className="coordination-facts"><div><dt>Ответственный врач</dt><dd>{item.doctor_name}</dd></div><div><dt>Передано в кабинет координатора</dt><dd>{date(item.created_at)}</dd></div><div><dt>Исходный срок принятия врачом</dt><dd>{date(item.original_acknowledgement_due_at)}</dd></div>{receivedAt&&<div><dt>Ваше принятие уведомления</dt><dd>{date(receivedAt)}</dd></div>}</dl>
    {state==="pending"?<><p>Свяжитесь с ответственным врачом и организуйте принятие события. Подтвердите здесь, что взяли организационное уведомление в работу.</p><Button data-notice-accept aria-disabled={busy} aria-busy={busy} onClick={acknowledge}>{busy?"Принимаем…":"Принять организационное уведомление"}</Button></>:
      <p className="coordination-status" ref={receipt} tabIndex={-1} role="status">{noticeLabels[state]??state}. Клиническое решение и медицинское действие фиксирует врач.</p>}
    <ErrorBox message={error} retry={acknowledge}/>
    <p className="field-hint">Внутреннее уведомление. Клинические ответы и карточка пациента в этом кабинете недоступны. Принятие координатором не заменяет принятие врачом.</p>
  </article>;
}

export function CoordinatorNotices() {
  const [view,setView]=useState<"active"|"all">("active"),[pages,setPages]=useState<number[]>([]);
  const before=pages.at(-1);
  const notices=useApi<NoticePage>(`/coordination/urgent-notices?limit=20&view=${view}${before?`&before_id=${before}`:""}`,5000);
  return <>
    <Heading eyebrow="Организация передачи врачу" title="Срочные уведомления" action={<Button variant="secondary" onClick={notices.reload}>Обновить уведомления</Button>}/>
    <p className="coordination-intro">Здесь нужно организовать принятие события ответственным врачом. Доступны только ID пациента и сведения о передаче.</p>
    <div className="button-row" role="group" aria-label="Выборка уведомлений"><Button aria-pressed={view==="active"} variant={view==="active"?"primary":"secondary"} onClick={()=>{setView("active");setPages([]);}}>Требуют передачи врачу · {notices.data?.active??"…"}</Button><Button aria-pressed={view==="all"} variant={view==="all"?"primary":"secondary"} onClick={()=>{setView("all");setPages([]);}}>История уведомлений</Button></div>
    <ErrorBox message={notices.error} retry={notices.reload}/>
    {!notices.data?<Loading/>:<><p className="field-hint">Ещё не приняты координатором: {notices.data.pending}. После Вашего принятия событие остаётся в работе, пока его не примет врач.</p>
      <div className="coordination-notice-list">{notices.data.items.map(item=><NoticeRow key={item.id} item={item} reload={notices.reload}/>)}</div>
      {!notices.data.items.length&&<Empty title={view==="active"?"Уведомлений для передачи врачу нет":"Уведомлений пока нет"}>Это состояние организационной очереди, а не оценка состояния пациентов.</Empty>}
      {(before||notices.data.next_before_id)&&<div className="button-row">{before&&<Button variant="secondary" onClick={()=>setPages(current=>current.slice(0,-1))}>Назад</Button>}{notices.data.next_before_id&&<Button variant="secondary" onClick={()=>setPages(current=>[...current,notices.data!.next_before_id!])}>Следующие уведомления</Button>}</div>}
    </>}
  </>;
}
