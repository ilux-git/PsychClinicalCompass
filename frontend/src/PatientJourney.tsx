import {participationPrinciples} from "./presentation";
import { createRequestId } from "./requestId";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Compass, Gift } from "lucide-react";
import { ParticipationRules } from "./ParticipationRules";
import "./patient-home.css";
import { send, useApi } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, plural, type Notify } from "./UI";
import { HorizontalBars } from "./Charts";
import { discountProgress, motivationModes as modes, type ParticipationPoints, type DiscountOffer } from "./patientProgress";
import { useUnsavedForm } from "./NavigationGuard";
import { ParticipationAtlas, ParticipationCalm, ParticipationRhythm } from "./PatientAdventure";
import { Disclosure, keepDialogFocus, usePendingSelectFocus } from "./Interaction";

type Points = ParticipationPoints;
const pointsLabel = (n:number) => `${n} ${plural(n,"балл","балла","баллов")}`;
const discountLabel=(value:number)=>new Intl.NumberFormat("ru-RU",{style:"percent",maximumFractionDigits:0}).format(value/100);

function DiscountGoal({points,offer,calm=false}: {points:Points;offer:DiscountOffer;calm?:boolean}) {
  const progress=discountProgress(points,offer);
  return <div className="patient-discount-goal">
    <div className="patient-discount-label"><span><Gift size={18}/>Скидка на приём</span><strong className="patient-discount-value">{discountLabel(offer.discount_percent)}</strong></div>
    <p>{progress.canExchange?"Баллов достаточно для купона":<>Ещё <strong>{pointsLabel(progress.remaining)}</strong> до купона</>}</p>
    {!calm&&<progress max={progress.maximum} value={progress.value} aria-label={`Баллы для скидки ${offer.discount_percent} процентов: ${progress.value} из ${offer.points}. Доступно ${pointsLabel(progress.available)}`}/>}
    <small>{pointsLabel(progress.available)} доступно · для обмена нужно {pointsLabel(offer.points)}</small>
  </div>;
}

export function PatientRewardSummary({result,notify,navigate}: {result:ReturnType<typeof useApi<Points>>;notify:Notify;navigate:(view:string)=>void}) {
  const [busy,setBusy]=useState(false);
  const modeFocus=usePendingSelectFocus(busy);
  useUnsavedForm({dirty:false,pending:busy,focus:()=>modeFocus.ref.current?.focus({preventScroll:true})});
  const data=result.data;
  async function chooseMode(value:string) {
    if(busy)return;
    modeFocus.remember();
    setBusy(true);
    try {await send('/participation/preferences',{mode:value},'PUT');result.reload();notify("Вид прогресса сохранён");}
    catch(error){notify(error instanceof Error?error.message:"Не удалось сохранить вид","error");}
    finally {setBusy(false);}
  }
  const offer=data?[...data.offers].sort((a,b)=>a.points-b.points)[0]:null;
  const calm=data?.preference.effective_mode==="calm";
  return <section className={`patient-reward-card${calm?" patient-reward-calm":data?.preference.effective_mode==="map"?" patient-reward-map":""}`} aria-labelledby="patient-reward-title">
    <div className="patient-reward-heading"><span className="patient-reward-icon"><Compass size={23}/></span><div><p className="eyebrow">Программа участия</p><h2 id="patient-reward-title">Баллы и скидки</h2></div></div>
    <ErrorBox message={result.error} retry={result.reload}/>
    {!data?result.loading?<Loading/>:<p>Баллы пока недоступны. Можно продолжать опросы и записи, а затем повторить загрузку.</p>:<>
      {result.error&&<p className="field-hint">Баланс не обновился. Показаны последние полученные данные.</p>}
      <div className="patient-home-balance"><strong>{data.balance}</strong><span>{plural(data.balance,"балл доступен","балла доступны","баллов доступно")}</span></div>
      {offer&&<DiscountGoal points={data} offer={offer} calm={calm}/>}
      <Button variant="secondary" onClick={()=>navigate("journey")}>{offer&&discountProgress(data,offer).canExchange?"Выбрать скидку":"Как получить и обменять баллы"}<ArrowRight size={16}/></Button>

      {data.preference.effective_mode==="map"&&<ParticipationAtlas earned={data.earned_total} compact/>}
      {data.preference.effective_mode==="rhythm"&&<ParticipationRhythm activity={data.activity} compact/>}
      {calm&&<ParticipationCalm activity={data.activity} compact/>}
      <label className="field patient-home-mode">Вид прогресса<select ref={modeFocus.ref} disabled={busy} value={data.preference.effective_mode} onChange={event=>chooseMode(event.target.value)}>{Object.entries(modes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
      <p className="patient-reward-principle">Баллы — за участие и честные наблюдения. Паузы не отнимают накопленное; доступ к врачу от баланса не зависит.</p>
    </>}
  </section>;
}

function JourneyMap({earned}: {earned:number}) {
  return <div className="journey-map"><ParticipationAtlas earned={earned}/></div>;
}

export function PatientJourney({notify, navigate}: {notify:Notify; navigate?: (view:string) => void}) {
  const result = useApi<Points>("/participation/points",15000);
  const [busy, setBusy] = useState(false), [selectedOffer,setSelectedOffer] = useState<string | null>(null);
  const [exchangeError,setExchangeError]=useState("");
  const confirmation=useRef<HTMLDialogElement>(null),previousFocus=useRef<HTMLElement|null>(null);
  const cancelButton=useRef<HTMLButtonElement>(null),catalog=useRef<HTMLDivElement>(null),coupons=useRef<HTMLDivElement>(null);
  const returnToCoupons=useRef(false);
  const confirmationTitle=useId();
  const modeDescription=useId();
  const modeFocus=usePendingSelectFocus(busy),lastAction=useRef<"mode"|"coupon">("coupon");
  useUnsavedForm({dirty:false,pending:busy,focus:()=>{
    if(lastAction.current==="mode")modeFocus.ref.current?.focus({preventScroll:true});
    else if(confirmation.current?.open)(confirmation.current.querySelector<HTMLElement>('[role="alert"]')??cancelButton.current??confirmation.current).focus({preventScroll:true});
    else coupons.current?.focus({preventScroll:true});
  }});
  const request = useRef({offer:"",id:""});
  const d = result.data;
  const offer=d?.offers.find(item=>item.id===selectedOffer);
  useEffect(()=>{
    const dialog=confirmation.current;
    if(offer&&dialog&&!dialog.open){previousFocus.current=document.activeElement as HTMLElement;dialog.showModal();cancelButton.current?.focus();}
    if(!offer&&dialog?.open){
      dialog.close();
      const showCoupons=returnToCoupons.current;
      const target=showCoupons?coupons.current:previousFocus.current?.isConnected&&!previousFocus.current.matches(':disabled')?previousFocus.current:catalog.current;
      returnToCoupons.current=false;target?.focus({preventScroll:true});
      if(showCoupons)target?.scrollIntoView({block:'start'});
    }
  },[offer?.id]);
  useEffect(()=>{
    const dialog=confirmation.current;
    if(!dialog?.open)return;
    if(busy)dialog.focus({preventScroll:true});
    else if(exchangeError)dialog.querySelector<HTMLElement>('[role="alert"]')?.focus({preventScroll:true});
  },[busy,exchangeError]);
  async function mode(value:string) {
    modeFocus.remember();lastAction.current="mode";
    setBusy(true);
    try {await send('/participation/preferences',{mode:value},'PUT'); result.reload(); notify("Вид маршрута сохранён");}
    catch(e) {notify(e instanceof Error ? e.message : "Не удалось изменить вид", "error");}
    finally {setBusy(false);}
  }
  async function exchange(offer:string) {
    if (!d || busy) return;
    lastAction.current="coupon";
    if (request.current.offer !== offer) request.current = {offer,id:createRequestId()};
    setBusy(true);setExchangeError("");
    try {await send('/participation/demo-coupons',{offer_id:offer,catalog_version:d.catalog_version,client_request_id:request.current.id});
      result.reload(); returnToCoupons.current=true;setSelectedOffer(null); request.current = {offer:"",id:""}; notify("Купон создан");}
    catch(e) {setExchangeError(e instanceof Error?e.message:"Не удалось создать купон");result.reload();}
    finally {setBusy(false);}
  }
  async function cancel(id:number) {
    lastAction.current="coupon";
    setBusy(true);
    try {await send(`/participation/demo-coupons/${id}/cancel`,{}); result.reload();coupons.current?.focus({preventScroll:true});notify("Купон отменён, баллы снова доступны");}
    catch(e) {notify(e instanceof Error ? e.message : "Не удалось отменить купон", "error");}
    finally {setBusy(false);}
  }
  function openCatalog() {catalog.current?.focus({preventScroll:true});catalog.current?.scrollIntoView({block:'start'});}
  function returnToStart() {const main=document.getElementById('compass-main');main?.focus({preventScroll:true});main?.scrollIntoView({block:'start'});}
  const heading=<Heading eyebrow="Участие и баллы" title="Мой прогресс">Баллы начисляются за опросы, отметки в расписании и дневник. Их можно обменять на купон.</Heading>;
  if (!d) return <div className="patient-progress-page">{heading}{result.error?<Section title="Баллы пока недоступны">
    <ErrorBox message={result.error} retry={result.reload}/>
    <p>Опросы, расписание и дневник остаются доступны. Баланс появится после успешного обновления.</p>
    {navigate&&<div className="button-row"><Button variant="secondary" onClick={()=>navigate("surveys")}>К моим опросам<ArrowRight size={16}/></Button><Button variant="ghost" onClick={()=>navigate("overview")}>Мой день<ArrowRight size={16}/></Button></div>}
  </Section>:<Loading/>}</div>;
  return <div className="patient-progress-page" data-mode={d.preference.effective_mode}>
    {heading}
    <ErrorBox message={result.error} retry={result.reload}/>
    {result.error&&<p className="field-hint">Показаны последние полученные данные. Баланс и условия обмена не обновились — повторите загрузку перед выбором купона.</p>}
    <section className={`journey-panel ${d.preference.effective_mode === "calm" ? "journey-calm" : ""}`}>
      <div className="journey-panel-heading"><div><label className="field journey-view-choice">Вид прогресса<select ref={modeFocus.ref} aria-describedby={modeDescription} disabled={busy} value={d.preference.effective_mode} onChange={e => mode(e.target.value)}>{Object.entries(modes).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label><p className="journey-mode-note" id={modeDescription}>Выбор меняет оформление. Опросы, история и баллы сохраняются во всех режимах.</p><h2>{d.preference.effective_mode==="map"?"Карта участия":d.preference.effective_mode==="rhythm"?"Мой ритм":"Спокойный режим"}</h2></div>
        <button type="button" className="journey-balance journey-balance-link" onClick={openCatalog} aria-label={`${pointsLabel(d.balance)} к обмену. Посмотреть скидки`}><strong>{d.balance}</strong><span>{plural(d.balance,"балл к обмену","балла к обмену","баллов к обмену")}<ArrowRight size={14}/></span></button></div>
      <div className="journey-experience">
      <div className="journey-visual">
      {d.preference.effective_mode === "map" && <JourneyMap earned={d.earned_total}/>}
      {d.preference.effective_mode === "rhythm" && <ParticipationRhythm activity={d.activity}/>}
      {d.preference.effective_mode === "calm" && <ParticipationCalm activity={d.activity}/>}
      </div>
      <aside className="journey-wallet" aria-label="Баллы и скидка">
        {!!d.offers.length&&<DiscountGoal points={d} offer={[...d.offers].sort((a,b)=>a.points-b.points)[0]} calm={d.preference.effective_mode==="calm"}/>}
        <Button variant="secondary" onClick={openCatalog}>Посмотреть скидки<ArrowRight size={16}/></Button>
      </aside>
      </div>
    </section>
      <Section title="За что начисляются баллы"><ParticipationRules rules={d.rules} navigate={navigate}/><details className="source-help"><summary>О лимитах начисления</summary>{d.rules.map(rule=><p key={rule.kind}><strong>{rule.label}:</strong> {rule.description}</p>)}<p>После достижения лимита записи остаются доступны. Содержание ответа и самочувствие не меняют награду.</p><p>Лимиты обновятся {date(d.next_reset_at)}. Часовой пояс расчёта: {d.day_timezone==="Europe/Moscow"?"Москва (МСК)":d.day_timezone??"UTC"}.</p></details></Section>
      <div className="loyalty-section-target" ref={catalog} tabIndex={-1} role="region" aria-label="Каталог скидок"><Section title="Скидки" aside={<div className="loyalty-catalog-actions"><Button variant="ghost" aria-label="К началу страницы" onClick={returnToStart}><ArrowUp size={16}/>К началу</Button></div>}>
        <p>Выберите купон и подтвердите обмен. Баллы резервируются; при отмене купона они снова доступны.</p>
        <div className="loyalty-offers">{d.offers.map(o => <article key={o.id} className="loyalty-offer"><Gift size={26}/><h3>{o.title}</h3><strong>{o.points} баллов</strong><p>{d.balance < o.points ? `Ещё ${o.points-d.balance} баллов до обмена` : "Достаточно баллов"}</p><Button disabled={busy || d.balance < o.points} onClick={() => setSelectedOffer(o.id)}>Выбрать купон</Button></article>)}</div>
      </Section></div>
      <div className="loyalty-section-target" ref={coupons} tabIndex={-1} role="region" aria-label="Мои купоны"><Section title="Мои купоны">
        {!d.coupons.length && <Empty title="Купонов пока нет">Они появятся после подтверждённого обмена.</Empty>}
        {d.coupons.map(c => <article className="coupon-row" key={c.id}><div><strong>Скидка {discountLabel(c.discount_percent)}</strong><p><code>{c.code}</code> · {date(c.created_at)}</p><small>{c.status === "cancelled" ? "Отменён; баллы возвращены" : `Зарезервировано ${c.points} баллов`}</small></div>{c.status === "issued" && <Button disabled={busy} variant="secondary" onClick={() => cancel(c.id)}>Отменить купон</Button>}</article>)}
      </Section></div>
      {d.preference.effective_mode!=="rhythm"&&<Section title="История участия за неделю"><Disclosure title="Посмотреть баллы по дням"><HorizontalBars title="Баллы за последние семь дней" unit="баллов" rows={d.activity.map(day => ({label:new Date(day.day+'T12:00:00Z').toLocaleDateString("ru-RU",{day:"numeric",month:"short",timeZone:"UTC"}),value:day.points}))} caption="День без начислений не означает ухудшение самочувствия или невыполнение рекомендаций."/></Disclosure></Section>}
      <Section title="Условия и история"><p>Начислено за всё время: {d.earned_total}. В купонах: {d.reserved_points}. Доступно: {d.balance}.</p>{participationPrinciples(d.principles).map(p => <p key={p}>{p}</p>)}<details><summary>Последние начисления ({d.history.length})</summary>{d.history.map(row => <p key={row.id}>{date(row.created_at)} · {d.rules.find(r => r.kind === row.kind)?.label ?? row.kind} · {row.points ? `+${row.points}` : "Без дополнительных баллов"}</p>)}</details></Section>
    <dialog ref={confirmation} className="loyalty-confirmation" aria-labelledby={confirmationTitle} onKeyDown={keepDialogFocus} onCancel={event=>{event.preventDefault();if(!busy){setSelectedOffer(null);setExchangeError("");}}}>
      {offer&&<><p className="eyebrow">Подтверждение обмена</p><h2 id={confirmationTitle}>{offer.title}</h2><p>{d.balance>=offer.points?`Будет зарезервировано ${pointsLabel(offer.points)}. После обмена останется ${pointsLabel(d.balance-offer.points)}.`:"Доступный баланс изменился. Для этого купона сейчас недостаточно баллов."}</p><p>Резерв можно отменить; тогда баллы снова станут доступны. Накопленный прогресс участия сохранится.</p>
        <ErrorBox message={exchangeError} retry={!busy&&d.balance>=offer.points?()=>exchange(offer.id):undefined}/>
        <ErrorBox message={result.error} retry={result.reload}/>
        <div className="button-row"><Button disabled={busy||d.balance<offer.points} onClick={()=>exchange(offer.id)}>{busy?"Создаём купон…":"Подтвердить обмен"}</Button><Button ref={cancelButton} variant="secondary" disabled={busy} onClick={()=>{setSelectedOffer(null);setExchangeError("");}}>Отмена</Button></div></>}
    </dialog>
  </div>;
}
