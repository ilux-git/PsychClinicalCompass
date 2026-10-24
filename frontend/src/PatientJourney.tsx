import { useRef, useState } from "react";
import { ArrowRight, Compass, Gift, Leaf, Sparkles } from "lucide-react";
import { send, useApi } from "./api";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, date, plural, type Notify } from "./UI";
import { HorizontalBars } from "./Charts";
import { Disclosure } from "./Interaction";

type Preference = {patient_choice: string | null; doctor_recommendation: string | null; effective_mode: string};
type Coupon = {id: number; code: string; points: number; discount_percent: number; status: string; created_at: string; simulated: boolean};
type Points = {balance: number; earned_total: number; reserved_points: number; catalog_version: string; preference: Preference;
  offers: {id: string; title: string; points: number; discount_percent: number}[]; coupons: Coupon[];
  rules: {kind: string; label: string; daily_cap: number; earned_today: number; description: string}[];
  history: {id: number; kind: string; points: number; created_at: string; policy_version: string}[];
  activity: {day: string; actions: number; points: number}[]; principles: string[]; next_reset_at: string};
const modes: Record<string,string> = {map:"Карта маленьких шагов",rhythm:"Мой ритм",calm:"Спокойный режим"};
const pointsLabel = (n:number) => `${n} ${plural(n,"балл","балла","баллов")}`;
const milestones = [{points:0,label:"Начало пути"},{points:25,label:"Первая тропа"},{points:50,label:"Мост поддержки"},{points:100,label:"Солнечная поляна"},{points:250,label:"Сад маленьких шагов"}];
const pointActions:Record<string,{view:string;label:string}>={survey:{view:"surveys",label:"К моим опросам"},medication:{view:"medications",label:"Открыть расписание"},diary:{view:"diary",label:"Сделать запись"}};

function JourneyMap({earned}: {earned:number}) {
  const coordinates = [[60,145],[202,67],[345,145],[488,67],[630,145]];
  const next=milestones.find(mark=>mark.points>earned);
  const target=next?.points??milestones.at(-1)!.points;
  return <figure className="journey-map" aria-label={`Игровой маршрут участия. Накоплено ${pointsLabel(earned)} за всё время`}>
    <div className="journey-progress"><div><span>{next?`Следующая отметка: ${next.label}`:"Все игровые отметки открыты"}</span><strong>{next?`${earned} из ${target} баллов`:pointsLabel(earned)}</strong></div><progress max={target} value={Math.min(earned,target)} aria-label={next?`Игровой прогресс до отметки «${next.label}»`:"Все игровые отметки открыты"}/></div>
    <svg viewBox="0 0 690 218" role="img" aria-label="Карта маленьких шагов">
      <path d="M0 178 Q90 115 170 172 T350 166 T530 172 T690 159 L690 218 L0 218Z" fill="#e4eddd"/>
      <path d="M60 145 C100 145 140 67 202 67 S285 145 345 145 S430 67 488 67 S580 145 630 145" fill="none" stroke="#ddd4bd" strokeWidth="13" strokeLinecap="round"/>
      {milestones.map((m,i) => <g key={m.points}>
        <circle cx={coordinates[i][0]} cy={coordinates[i][1]} r="20" fill={earned >= m.points ? "#397e70" : "#fcfaf4"} stroke="white" strokeWidth="4"/>
        <text x={coordinates[i][0]} y={coordinates[i][1]+5} textAnchor="middle" fill={earned >= m.points ? "white" : "#857d72"} fontSize="14">{earned >= m.points ? "✓" : i+1}</text>
        <text x={coordinates[i][0]} y={coordinates[i][1]+37} textAnchor="middle" className="map-label">{m.points} баллов</text>
      </g>)}
      <circle cx="625" cy="31" r="17" fill="#f3df9c"/>
      <path d="M18 80q12-26 24 0M570 181q9-25 18 0" stroke="#a6ba8c" strokeWidth="3" fill="none"/>
    </svg>
    <div className="journey-mobile-checkpoints"><Disclosure title={`Все игровые отметки · ${milestones.length}`}><ol className="map-mobile" aria-label="Игровые отметки">{milestones.map((m,i) => <li className={earned >= m.points ? "opened" : ""} key={m.points}>
      <span className="map-mobile-node" aria-label={earned >= m.points ? "Отметка открыта" : "Пока не открыта"}>{earned >= m.points ? "✓" : i+1}</span>
      <div><strong>{m.label}</strong><small>{pointsLabel(m.points)}</small></div>
    </li>)}</ol></Disclosure></div>
    <figcaption>{milestones.filter(m => earned >= m.points).at(-1)!.label} · игровой маршрут участия</figcaption>
    <p className="field-hint">Отметки открываются за накопленные баллы. Это не этапы лечения и не оценка выздоровления. Обмен баллов не откатывает карту.</p>
  </figure>;
}

export function PatientJourney({notify, compact = false, navigate}: {notify:Notify; compact?:boolean; navigate?: (view:string) => void}) {
  const result = useApi<Points>("/participation/points", compact ? 15000 : 0);
  const [busy, setBusy] = useState(false), [selectedOffer,setSelectedOffer] = useState<string | null>(null);
  const request = useRef({offer:"",id:""});
  const d = result.data;
  async function mode(value:string) {
    setBusy(true);
    try {await send('/participation/preferences',{mode:value || null},'PUT'); result.reload(); notify("Вид маршрута сохранён");}
    catch(e) {notify(e instanceof Error ? e.message : "Не удалось изменить вид", "error");}
    finally {setBusy(false);}
  }
  async function exchange(offer:string) {
    if (!d) return;
    if (request.current.offer !== offer) request.current = {offer,id:crypto.randomUUID()};
    setBusy(true);
    try {await send('/participation/demo-coupons',{offer_id:offer,catalog_version:d.catalog_version,client_request_id:request.current.id});
      result.reload(); setSelectedOffer(null); request.current = {offer:"",id:""}; notify("Тестовый купон создан. Условия реальной скидки согласует клиника");}
    catch(e) {notify(e instanceof Error ? e.message : "Не удалось создать купон", "error");}
    finally {setBusy(false);}
  }
  async function cancel(id:number) {
    setBusy(true);
    try {await send(`/participation/demo-coupons/${id}/cancel`,{}); result.reload(); notify("Тестовый купон отменён, баллы снова доступны");}
    catch(e) {notify(e instanceof Error ? e.message : "Не удалось отменить купон", "error");}
    finally {setBusy(false);}
  }
  if (!d) return result.error?<ErrorBox message={result.error} retry={result.reload}/>:<Loading/>;
  const next = milestones.find(m => m.points > d.earned_total);
  const offer = d.offers.find(o => o.id === selectedOffer);
  if (compact) return <section className="journey-summary" aria-label="Баллы за участие">
    <span className="journey-summary-icon"><Gift size={23}/></span>
    <div><h2>Ваши маленькие шаги</h2><p><strong>{pointsLabel(d.balance)}</strong> доступно · {pointsLabel(d.earned_total)} за всё время</p></div>
    {navigate && <Button variant="ghost" onClick={() => navigate('journey')}>Мой прогресс <ArrowRight size={16}/></Button>}
    <ErrorBox message={result.error} retry={result.reload}/>
  </section>;
  return <>
    <ErrorBox message={result.error} retry={result.reload}/>
    {!compact && <Heading eyebrow="Маленькие шаги имеют значение" title="Мой маршрут и баллы">Вы сохраняете важное между встречами. За участие начисляются баллы, а игровой маршрут можно отключить в любой момент.</Heading>}
    <section className={`journey-panel ${d.preference.effective_mode === "calm" ? "journey-calm" : ""}`}>
      <div className="journey-panel-heading"><div><p className="eyebrow"><Compass size={15}/> {modes[d.preference.effective_mode]}</p><h2>{d.earned_total ? "Вы уже сделали важные маленькие шаги" : "Начните в своём ритме"}</h2></div>
        <div className="journey-balance"><strong>{d.balance}</strong><span>Баллы к обмену</span></div></div>
      {d.preference.effective_mode === "map" && <JourneyMap earned={d.earned_total}/>}
      {d.preference.effective_mode === "rhythm" && <div className="rhythm-days" aria-label="Дни наблюдений за последние семь дней UTC">{d.activity.map(day => <div key={day.day} className={day.actions ? "active" : ""}><span>{new Date(day.day+'T12:00:00Z').toLocaleDateString("ru-RU",{weekday:"short",timeZone:"UTC"})}</span><span aria-label={day.actions ? "Есть записи" : "Нет записей"}>{day.actions ? "✓" : "·"}</span></div>)}</div>}
      <p>{d.preference.effective_mode === "calm" ? "Сохраняйте важное в удобном вам ритме. " : d.preference.effective_mode === "map" ? "" : next ? `До игровой отметки «${next.label}» — ${pointsLabel(next.points-d.earned_total)}. ` : "Все отметки этой карты открыты. Продолжайте в удобном вам ритме. "}Пропуски не отнимают баллы.</p>
      {compact && navigate && <Button variant="secondary" onClick={() => navigate('journey')}><Gift size={16}/> Баллы и скидки <ArrowRight size={16}/></Button>}
      {!compact && <label className="field journey-mode">Как показывать маршрут<select aria-label="Как показывать маршрут" disabled={busy} value={d.preference.patient_choice ?? ""} onChange={e => mode(e.target.value)}><option value="">{d.preference.doctor_recommendation ? `Рекомендация врача: ${modes[d.preference.doctor_recommendation]}` : "По умолчанию: карта шагов"}</option>{Object.entries(modes).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select><small>Выбор меняет оформление. Опросы, история и баллы сохраняются во всех режимах.</small></label>}
    </section>
    {!compact && <>
      <Section title="За что начисляются баллы"><div className="collection-grid participation-actions">{d.rules.map(r => <article className="collection-card" key={r.kind}><Leaf size={19}/><h3>{r.label}</h3><p>{r.description}</p><strong>{r.earned_today} / {r.daily_cap}</strong><small>Сегодня / дневной предел</small>{navigate&&pointActions[r.kind]&&<Button variant="ghost" onClick={()=>navigate(pointActions[r.kind].view)}>{pointActions[r.kind].label}<ArrowRight size={16}/></Button>}</article>)}</div><p className="field-hint">День начислений — UTC; следующий сброс {date(d.next_reset_at)}. Честность ответа и ваше самочувствие не меняют награду.</p></Section>
      <Section title="Баллы на скидку к следующему приёму" aside={<Badge tone="purple">Демонстрация обмена</Badge>}>
        <p>Выберите тестовый купон и подтвердите обмен. Баллы резервируются; при отмене купона они снова доступны. Коды DEMO не действуют в клинике. Реальные цены, лимиты и применение скидок ещё предстоит согласовать.</p>
        <div className="loyalty-offers">{d.offers.map(o => <article key={o.id} className="loyalty-offer"><Gift size={26}/><h3>{o.title}</h3><strong>{o.points} баллов</strong><p>{d.balance < o.points ? `Ещё ${o.points-d.balance} баллов до обмена` : "Достаточно баллов"}</p><Button disabled={busy || d.balance < o.points} onClick={() => setSelectedOffer(o.id)}>Выбрать тестовый купон</Button></article>)}</div>
        {offer && <div className="exchange-confirm" role="region" aria-label="Подтверждение тестового обмена"><h3>{offer.title}</h3><p>Будет зарезервировано {offer.points} баллов. После обмена останется {d.balance-offer.points}. Это симуляция; реальная скидка не оформляется.</p><div className="button-row"><Button disabled={busy} onClick={() => exchange(offer.id)}>Подтвердить тестовый обмен</Button><Button variant="ghost" disabled={busy} onClick={() => setSelectedOffer(null)}>Отмена</Button></div></div>}
      </Section>
      <Section title="Мои тестовые купоны">
        {!d.coupons.length && <Empty title="Купонов пока нет">Они появятся после подтверждённого обмена.</Empty>}
        {d.coupons.map(c => <article className="coupon-row" key={c.id}><div><strong>Скидка {c.discount_percent}% · DEMO</strong><p><code>{c.code}</code> · {date(c.created_at)}</p><small>{c.status === "cancelled" ? "Отменён; баллы возвращены" : `Зарезервировано ${c.points} баллов; в клинике не применяется`}</small></div>{c.status === "issued" && <Button disabled={busy} variant="secondary" onClick={() => cancel(c.id)}>Отменить купон</Button>}</article>)}
      </Section>
      <Section title="Ваш ритм участия"><HorizontalBars title="Баллы за последние семь дней" unit="баллов" rows={d.activity.map(day => ({label:new Date(day.day+'T12:00:00Z').toLocaleDateString("ru-RU",{day:"numeric",month:"short"}),value:day.points}))} caption="Дни по UTC. День без начислений не означает ухудшение самочувствия или невыполнение рекомендаций."/></Section>
      <Section title="Условия и история"><p>Начислено за всё время: {d.earned_total}. В тестовых купонах: {d.reserved_points}. Доступно: {d.balance}.</p>{d.principles.map(p => <p key={p}>{p}</p>)}<details><summary>Последние начисления ({d.history.length})</summary>{d.history.map(row => <p key={row.id}>{date(row.created_at)} · {d.rules.find(r => r.kind === row.kind)?.label ?? row.kind} · {row.points ? `+${row.points}` : "Дневной предел достигнут"}{row.policy_version.startsWith('synthetic-') ? " · учебная история" : ""}</p>)}</details></Section>
    </>}
  </>;
}

export function MotivationAdvice({patientId,notify}: {patientId:number;notify:Notify}) {
  const pref = useApi<Preference>(`/patients/${patientId}/motivation`);
  const [busy,setBusy] = useState(false);
  async function recommend(mode:string) {
    setBusy(true);
    try {await send(`/patients/${patientId}/motivation`,{mode:mode || null},'PUT'); pref.reload(); notify("Рекомендация вида маршрута сохранена");}
    catch(e) {notify(e instanceof Error ? e.message : "Не удалось сохранить", "error");}
    finally {setBusy(false);}
  }
  return <Section title="Поддержка участия"><ErrorBox message={pref.error} retry={pref.reload}/>{pref.data && <><label className="field">Рекомендованный вид маршрута<select value={pref.data.doctor_recommendation ?? ""} disabled={busy} onChange={e => recommend(e.target.value)}><option value="">Без рекомендации</option>{Object.entries(modes).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label><p className="field-hint">Пациент может выбрать спокойный вид или другой режим. Это настройка интерфейса, а не оценка психотипа. Баллы и доступ к помощи от выбора не зависят.</p><p>Сейчас у пациента: {modes[pref.data.effective_mode]}</p></>}</Section>;
}
