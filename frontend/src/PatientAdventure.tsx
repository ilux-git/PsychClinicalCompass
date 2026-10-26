import { useId, useRef, useState } from "react";
import { Check, Compass, Flag, Leaf, Mountain, Sunrise } from "lucide-react";
import { plural } from "./UI";
import type { ParticipationPoints } from "./patientProgress";
import archipelagoArt from "./assets/sea-archipelago-v1.png";
import rhythmArt from "./assets/rhythm-coast-v1.png";
import "./patient-adventure.css";

// Cosmetic checkpoints use the existing lifetime-point thresholds, never symptom scores.
export const participationMilestones = [
  {points:0,label:"Начало пути",place:"Отправная точка",icon:Compass},
  {points:25,label:"Первые шаги",place:"Тихая поляна",icon:Leaf},
  {points:50,label:"История участия",place:"Остров наблюдений",icon:Mountain},
  {points:100,label:"100 баллов участия",place:"Маяк",icon:Flag},
  {points:250,label:"250 баллов участия",place:"Новый горизонт",icon:Sunrise},
];
// Coordinates refer to the five destinations in the approved 1536 × 1024 artwork.
const atlasStations=[[230,790],[580,380],[790,145],[1195,375],[1390,120]];

/** Decorative artwork; HTML controls and captions carry the real progress values. */
export function AtlasScene({earned=0,markers=true}:{earned?:number;markers?:boolean}) {
  const current=Math.max(0,participationMilestones.map(mark=>earned>=mark.points).lastIndexOf(true));
  return <div className="atlas-scene" aria-hidden="true">
    <img src={archipelagoArt} width={1536} height={1024} alt="" decoding="async"/>
    {markers&&participationMilestones.map((mark,index)=>{
      const [x,y]=atlasStations[index],reached=earned>=mark.points;
      return <span key={mark.points} className={`atlas-preview-station${index===current?" is-current":""}`} data-reached={reached} style={{left:`${x/1536*100}%`,top:`${y/1024*100}%`}}>{reached?<Check size={12}/>:<mark.icon size={12}/>}</span>;
    })}
  </div>;
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
    <div className="atlas-heading"><span><Compass size={16}/>Карта участия</span><strong>{earned} {plural(earned,"балл","балла","баллов")} за всё время</strong></div>
    {!compact&&<p className="atlas-map-hint" id={hintId}>Выберите отметку на карте</p>}
    <div className="atlas-scene-frame"><AtlasScene earned={earned} markers={compact}/>
      {!compact&&<div className="atlas-map-summary"><span>Открыто мест</span><strong>{current+1}<small> из {participationMilestones.length}</small></strong><div className="atlas-summary-meter" role="progressbar" aria-label="Баллы до конца карты" aria-valuemin={0} aria-valuemax={participationMilestones.at(-1)!.points} aria-valuenow={Math.min(earned,participationMilestones.at(-1)!.points)} aria-valuetext={`${earned} из ${participationMilestones.at(-1)!.points} баллов участия`}><i style={{width:`${Math.min(100,earned/participationMilestones.at(-1)!.points*100)}%`}}/></div></div>}
      {!compact&&<div className="atlas-map-controls" role="group" aria-label="Выберите отметку на карте" aria-describedby={hintId}>
        {participationMilestones.map((mark,index)=>{
          const reached=earned>=mark.points;
          const [x,y]=atlasStations[index];
          const label=`${mark.place} · ${mark.points} ${plural(mark.points,"балл","балла","баллов")} · ${index===current?"Вы здесь":reached?"Открыто":"Впереди"}`;
          return <button type="button" key={mark.points} className="atlas-marker" data-reached={reached} style={{left:`clamp(22px,${x/1536*100}%,calc(100% - 22px))`,top:`${y/1024*100}%`}} title={label} aria-label={label} aria-current={index===current?"step":undefined} aria-pressed={selected.points===mark.points} aria-controls={detailId} onClick={()=>choosePlace(mark.points)}>
            {index===current?<Flag size={22} aria-hidden="true"/>:reached?<Check size={22} aria-hidden="true"/>:<mark.icon size={22} aria-hidden="true"/>}
          </button>;
        })}
      </div>}
    </div>
    <div className="atlas-next"><span>Вы здесь · {participationMilestones[current].place}</span><strong>{next?<>До «{next.place}» ещё {next.points-earned} {plural(next.points-earned,"балл","балла","баллов")}</>:"Все места этой карты открыты"}</strong></div>
    {!compact&&<div className="atlas-place-detail" ref={detail} id={detailId} aria-live="polite" aria-atomic="true">
      <span className="eyebrow">{earned>=selected.points?"Место открыто":"Предстоящая веха"}</span><h3>{selected.place}</h3>
      <p>{earned>=selected.points?selected.points===0?"Отправная точка доступна сразу. Вы выбираете, какие наблюдения сохранять между встречами.":`За всё время у Вас накопилось не меньше ${selected.points} баллов участия. Это место останется открытым и после обмена баллов на купон.`:`До этой отметки ещё ${selected.points-earned} ${plural(selected.points-earned,"балл","балла","баллов")} участия. Опросы врача, отметки в расписании и дневник помогают сохранять важное; спешить или выполнять всё каждый день не требуется.`}</p>
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
    <header><div><p className="eyebrow">Последние 7 дней · UTC</p><h3>Активность по дням</h3></div>{activity.length>0&&<strong>{activeDays}<span>{plural(activeDays,"день с записями","дня с записями","дней с записями")}</span></strong>}</header>
    {!selected?<p>Данные об участии пока недоступны.</p>:<>
      <div className="rhythm-calendar">{activity.map(day=><button type="button" key={day.day} className={day.actions>0?"has-entries":""} aria-pressed={selected.day===day.day} aria-controls={detailId} aria-label={`${dayLabel(day.day,{day:"numeric",month:"long"})}: ${day.actions} ${plural(day.actions,"учтённое действие","учтённых действия","учтённых действий")}, ${day.points} ${plural(day.points,"балл","балла","баллов")}`} onClick={()=>setChosen(day.day)}>
        <>{day.actions>0&&<img className="rhythm-day-art" src={rhythmArt} width={1536} height={1024} alt="" loading="lazy" decoding="async" style={{objectPosition:`${(new Date(day.day+"T12:00:00Z").getUTCDay()+6)%7/6*100}% 50%`}}/>}</><span>{dayLabel(day.day,{weekday:"short"})}</span><strong>{dayLabel(day.day,{day:"numeric"})}</strong><i aria-hidden="true">{day.actions>0?<Check size={14}/>:"·"}</i>
      </button>)}</div>
      <div id={detailId} className="rhythm-day-detail" aria-live="polite" aria-atomic="true"><strong>{dayLabel(selected.day,{day:"numeric",month:"long"})}</strong><span>{selected.actions>0?`${selected.actions} ${plural(selected.actions,"учтённое действие","учтённых действия","учтённых действий")} · ${selected.points} ${plural(selected.points,"балл","балла","баллов")} участия`:"В приложении нет учтённых действий за этот день"}</span></div>
    </>}
    <p className="rhythm-caption">{activity.length>0&&activity.length<7&&<>Доступно {activity.length} из 7 дней; остальные дни недоступны. </>}Дни с записями открывают пейзаж. Опросы, лекарственные отметки и дневник. День без записей не означает пропуск лечения. Ежедневная серия не нужна.</p>
  </section>;
}

export function ParticipationCalm({activity,compact=false}:{activity:Activity;compact?:boolean}) {
  const latest=activity.filter(day=>day.actions>0).at(-1);
  return <section className={`participation-calm${compact?" participation-calm-compact":""}`} aria-label="Спокойный вид прогресса">
    <span className="calm-mark" aria-hidden="true"><Leaf size={22}/></span><div><p className="eyebrow">Спокойный режим</p><h3>История участия</h3>
      <p>{!activity.length?"История участия за последние 7 дней пока недоступна. Можно продолжать пользоваться приложением.":latest?`Последние учтённые действия за 7 дней — ${dayLabel(latest.day,{day:"numeric",month:"long"})}. История сохранена; можно вернуться к ней в удобный момент.`:activity.length<7?"В доступной части истории нет учтённых действий. Это не оценка Вашего лечения.":"За последние 7 дней в приложении нет учтённых действий. Это не оценка Вашего лечения. Начать или сделать паузу можно в удобное время."}</p>
      {activity.length>0&&activity.length<7&&<p>Доступно {activity.length} из 7 дней; остальные дни недоступны.</p>}
      <small>Баллы и тестовые скидки доступны без игрового оформления.</small></div>
  </section>;
}
