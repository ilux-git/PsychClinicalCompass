import { useId, useRef, useState } from "react";
import { Check, Compass, Flag, Leaf, Mountain, Sunrise } from "lucide-react";
import { plural } from "./UI";
import type { ParticipationPoints } from "./patientProgress";
import "./patient-adventure.css";

// Cosmetic checkpoints use the existing lifetime-point thresholds, never symptom scores.
export const participationMilestones = [
  {points:0,label:"Начало пути",place:"Отправная точка",icon:Compass},
  {points:25,label:"Первые шаги",place:"Тихая поляна",icon:Leaf},
  {points:50,label:"История участия",place:"Мост наблюдений",icon:Mountain},
  {points:100,label:"100 баллов участия",place:"Маяк",icon:Flag},
  {points:250,label:"250 баллов участия",place:"Новый горизонт",icon:Sunrise},
];
const atlasStations=[[62,185],[208,137],[350,172],[492,106],[633,133]];

/** Original decorative artwork; every meaningful value is also present as HTML. */
export function AtlasScene({earned=0,markers=true}:{earned?:number;markers?:boolean}) {
  const current=Math.max(0,participationMilestones.map(mark=>earned>=mark.points).lastIndexOf(true));
  return <svg className="atlas-scene" viewBox="0 0 700 280" aria-hidden="true" focusable="false">
    <path fill="#f6f4ef" d="M0 0h700v280H0z"/>
    <circle cx="580" cy="48" r="25" fill="#f3b6a3"/>
    <path d="M43 50h47m-32 10h56m282-38h39m-21 11h61" stroke="#fff" strokeWidth="7" strokeLinecap="round"/>
    <path d="M0 116q85-44 168-19t165-5T500 82t200-9v207H0Z" fill="#e1ded1"/>
    <path d="M0 161q88 21 160-13t175 9 162-26 203-6v155H0Z" fill="#c4ccba"/>
    <path d="M0 236q82-30 170-4t192 1 176-12 162 4v55H0Z" fill="#cfdbd6"/>
    <path d="M0 253q85-21 173-2t183-1 188-10 156 4" fill="none" stroke="#f6f4ef" strokeWidth="3"/>
    <path d="M30 202c70 7 103-83 178-65s77 66 142 35 93-97 142-66 91 44 141 27" fill="none" stroke="#b2b5a5" strokeWidth="26" strokeLinecap="round"/>
    <path d="M30 197c70 7 103-83 178-65s77 66 142 35 93-97 142-66 91 44 141 27" fill="none" stroke="#fff" strokeWidth="20" strokeLinecap="round"/>
    <path d="M32 197c68 7 101-83 176-65s77 66 142 35 93-97 142-66 91 44 141 27" fill="none" stroke="#d9a08c" strokeWidth="2" strokeDasharray="3 8" strokeLinecap="round"/>
    <g fill="#4c816a" stroke="#315b4d" strokeWidth="2" strokeLinejoin="round">
      <path d="m114 90-18 34h36Z"/><path d="m134 78-21 42h42Z"/>
      <path d="m379 61-19 38h38Z"/><path d="m404 48-23 47h46Z"/>
      <path d="m560 156-18 36h36Z"/>
    </g>
    <g stroke="#496b50" strokeWidth="4" strokeLinecap="round"><path d="M114 124v10m20-14v17m245-38v13m25-17v16m156 81v12"/></g>
    <g transform="translate(457 25)">
      <path d="m13 62 7-49h29l7 49Z" fill="#fff" stroke="#476b60" strokeWidth="2"/>
      <path d="m18 26 33 8-1-10-30-8Zm-3 22 39 9-2-11-35-9Z" fill="#e64b2f"/>
      <path d="M16 13h37V3H16Z" fill="#3c6e5b"/>
      <path d="m13 3 21-12L56 3Z" fill="#315849"/>
      <path d="M30 62V47h10v15" fill="#3c6e5b"/>
      <path d="M7 64h55" stroke="#476b60" strokeWidth="3" strokeLinecap="round"/>
    </g>
    <g className="atlas-boat" transform="translate(263 230)">
      <path d="M0 8h44l-10 14H12Z" fill="#e64b2f" stroke="#a52e1c" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M22 7v-34L2 3h20Z" fill="#fff"/>
      <path d="M24-25 39 3H24Z" fill="#f3b6a3"/>
    </g>
    {markers&&participationMilestones.map((mark,index)=>{
      const reached=earned>=mark.points;
      const [x,y]=atlasStations[index];
      const Icon=mark.icon;
      return <g key={mark.points} transform={`translate(${x} ${y-5})`}>
        {index===current&&<circle r="32" cy="-3" fill="none" stroke="#a52e1c" strokeWidth="2" strokeDasharray="3 5"/>}
        <ellipse cy="5" rx="23" ry="22" fill={reached?"#18191a":"#aaa99f"}/>
        <circle r="23" cy="-1" fill={reached?"#18191a":"#fff"} stroke={reached?"#18191a":"#b8b6aa"} strokeWidth="2"/>
        {reached?<Check x={-10} y={-12} width={20} height={20} color="#fff" strokeWidth={3}/>:<Icon x={-10} y={-12} width={20} height={20} color="#595b5a"/>}
        {index===current&&<path d="m-7-45 7 8 7-8Z" fill="#e64b2f"/>}
      </g>;
    })}
    <g transform="translate(657 30)" fill="none" stroke="#5e7d6e" strokeWidth="1.5"><circle r="15"/><path d="m0-11 4 11-4 11-4-11Z" fill="#f9f4e2"/><path d="m0-11 4 11H0Z" fill="#e64b2f"/><path d="M-20 0h5m20 0h5M0-20v5m0 30v5"/></g>
  </svg>;
}

export function ParticipationAtlas({earned,compact=false}:{earned:number;compact?:boolean}) {
  const current=Math.max(0,participationMilestones.map(mark=>earned>=mark.points).lastIndexOf(true));
  const next=participationMilestones[current+1];
  const [chosen,setChosen]=useState<number|null>(null);
  const selected=participationMilestones.find(mark=>mark.points===chosen)??participationMilestones[current];
  const detailId=useId(),hintId=useId();
  const detail=useRef<HTMLDivElement>(null);
  function choosePlace(points:number) {
    setChosen(points);
    requestAnimationFrame(()=>detail.current?.scrollIntoView({block:"nearest"}));
  }
  return <figure className={`participation-atlas${compact?" participation-atlas-compact":""}`}>
    <div className="atlas-heading"><span><Compass size={16}/>Карта маленьких шагов</span><strong>{earned} {plural(earned,"балл","балла","баллов")} за всё время</strong></div>
    {!compact&&<p className="atlas-map-hint" id={hintId}>Выберите отметку на карте</p>}
    <div className="atlas-scene-frame"><AtlasScene earned={earned} markers={compact}/>
      {!compact&&<div className="atlas-map-controls" role="group" aria-label="Выберите отметку на карте" aria-describedby={hintId}>
        {participationMilestones.map((mark,index)=>{
          const reached=earned>=mark.points;
          const [x,y]=atlasStations[index];
          const label=`${mark.place} · ${mark.points} ${plural(mark.points,"балл","балла","баллов")} · ${index===current?"Вы здесь":reached?"Открыто":"Впереди"}`;
          return <button type="button" key={mark.points} className="atlas-marker" data-reached={reached} style={{left:`clamp(22px,${x/700*100}%,calc(100% - 22px))`,top:`${(y-6)/280*100}%`}} title={label} aria-label={label} aria-current={index===current?"step":undefined} aria-pressed={selected.points===mark.points} aria-controls={detailId} onClick={()=>choosePlace(mark.points)}>
            {reached?<Check size={22} aria-hidden="true"/>:<mark.icon size={22} aria-hidden="true"/>}
          </button>;
        })}
      </div>}
    </div>
    <div className="atlas-next"><span>Вы здесь · {participationMilestones[current].place}</span><strong>{next?<>До «{next.place}» ещё {next.points-earned} {plural(next.points-earned,"балл","балла","баллов")}</>:"Все места этой карты открыты"}</strong></div>
    {!compact&&<div className="atlas-place-detail" ref={detail} id={detailId} aria-live="polite" aria-atomic="true">
      <span className="eyebrow">{earned>=selected.points?"Место открыто":"Можно идти в своём темпе"}</span><h3>{selected.place}</h3>
      <p>{earned>=selected.points?selected.points===0?"Отправная точка доступна сразу. Вы выбираете, какие наблюдения сохранять между встречами.":`За всё время у вас накопилось не меньше ${selected.points} баллов участия. Это место останется открытым и после обмена баллов на купон.`:`До этой отметки ещё ${selected.points-earned} ${plural(selected.points-earned,"балл","балла","баллов")} участия. Опросы врача, отметки в расписании и дневник помогают сохранять важное; спешить или выполнять всё каждый день не требуется.`}</p>
    </div>}
    <figcaption>Обмен баллов сохраняет открытые места. Карта отражает участие, а не результат лечения.</figcaption>
  </figure>;
}

type Activity=ParticipationPoints["activity"];
const dayLabel=(day:string,options:Intl.DateTimeFormatOptions)=>new Date(day+"T12:00:00Z").toLocaleDateString("ru-RU",{...options,timeZone:"UTC"});

/** A ledger view, not an adherence score or a target streak. */
export function ParticipationRhythm({activity,compact=false}:{activity:Activity;compact?:boolean}) {
  const [chosen,setChosen]=useState<string|null>(null);
  const detailId=useId();
  const selected=activity.find(day=>day.day===chosen)??activity.at(-1);
  const activeDays=activity.filter(day=>day.actions>0).length;
  return <section className={`participation-rhythm${compact?" participation-rhythm-compact":""}`} aria-label="Мой ритм за семь дней">
    <header><div><p className="eyebrow">Последние 7 дней · UTC</p><h3>У каждого дня свой ритм</h3></div>{activity.length>0&&<strong>{activeDays}<span>{plural(activeDays,"день с записями","дня с записями","дней с записями")}</span></strong>}</header>
    {!selected?<p>Данные об участии пока недоступны.</p>:<>
      <div className="rhythm-calendar">{activity.map(day=><button type="button" key={day.day} className={day.actions>0?"has-entries":""} aria-pressed={selected.day===day.day} aria-controls={detailId} aria-label={`${dayLabel(day.day,{day:"numeric",month:"long"})}: ${day.actions} ${plural(day.actions,"учтённое действие","учтённых действия","учтённых действий")}, ${day.points} ${plural(day.points,"балл","балла","баллов")}`} onClick={()=>setChosen(day.day)}>
        <span>{dayLabel(day.day,{weekday:"short"})}</span><strong>{dayLabel(day.day,{day:"numeric"})}</strong><i aria-hidden="true">{day.actions>0?<Check size={14}/>:"·"}</i>
      </button>)}</div>
      <div id={detailId} className="rhythm-day-detail" aria-live="polite" aria-atomic="true"><strong>{dayLabel(selected.day,{day:"numeric",month:"long"})}</strong><span>{selected.actions>0?`${selected.actions} ${plural(selected.actions,"учтённое действие","учтённых действия","учтённых действий")} · ${selected.points} ${plural(selected.points,"балл","балла","баллов")} участия`:"В приложении нет учтённых действий за этот день"}</span></div>
    </>}
    <p className="rhythm-caption">{activity.length>0&&activity.length<7&&<>Доступно {activity.length} из 7 дней; остальные дни недоступны. </>}Опросы, лекарственные отметки и дневник. День без записей не означает пропуск лечения. Ежедневная серия не нужна.</p>
  </section>;
}

export function ParticipationCalm({activity,compact=false}:{activity:Activity;compact?:boolean}) {
  const latest=activity.filter(day=>day.actions>0).at(-1);
  return <section className={`participation-calm${compact?" participation-calm-compact":""}`} aria-label="Спокойный вид прогресса">
    <span className="calm-mark" aria-hidden="true"><Leaf size={22}/></span><div><p className="eyebrow">Без карты и ежедневной серии</p><h3>Можно в своём темпе</h3>
      <p>{!activity.length?"История участия за последние 7 дней пока недоступна. Можно продолжать пользоваться приложением.":latest?`Последние учтённые действия за 7 дней — ${dayLabel(latest.day,{day:"numeric",month:"long"})}. История сохранена; можно вернуться к ней в удобный момент.`:activity.length<7?"В доступной части истории нет учтённых действий. Это не оценка вашего лечения.":"За последние 7 дней в приложении нет учтённых действий. Это не оценка вашего лечения. Начать или сделать паузу можно в удобное время."}</p>
      {activity.length>0&&activity.length<7&&<p>Доступно {activity.length} из 7 дней; остальные дни недоступны.</p>}
      <small>Баллы и тестовые скидки доступны без игрового оформления.</small></div>
  </section>;
}
