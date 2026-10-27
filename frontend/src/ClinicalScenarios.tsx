import {useApi,type ScenarioContext} from "./api";
import {useState} from "react";
import {Badge,Button,ErrorBox,Loading,Section,date} from "./UI";
import {TimeSeries} from "./Charts";
import "./clinical-instruments.css";

export type ScenarioMeasurementsData={anchor_date:string|null;measurements:{instrument:string;day:number;score:number;version:string|null}[]};

function ScoreHistory({data}:{data:ScenarioMeasurementsData}) {
  if(!data.anchor_date||!data.measurements.length)return null;
  const anchor=Date.parse(data.anchor_date);
  return <div className="scenario-score-history">
    <TimeSeries title="EPDS · переданная история" maximum={30} points={data.measurements.map((row,index)=>({id:index+1,at:new Date(anchor+row.day*86400000).toISOString(),value:row.score}))}/>
    <p className="field-hint">Суммы перенесены из исходного сценария. Версия бланка и ответы по пунктам не переданы; эта история не объединяется с новым валидированным бланком. Снижение суммы оценивает врач.</p>
    <details className="source-help"><summary>Русскоязычные источники EPDS</summary>
      <p><a href="https://psychiatr.ru/files/magazines/2015_03_obozr_846.pdf#page=76" target="_blank" rel="noreferrer">Шаманина и Мазо, 2015 · применение у российских женщин</a></p>
      <p><a href="https://www.europeanproceedings.com/article/10.15405/epsbs.2018.07.89" target="_blank" rel="noreferrer">Якупова, 2018 · валидация русскоязычной версии</a></p>
      <p><a href="https://cr.minzdrav.gov.ru/view-cr/799_1" target="_blank" rel="noreferrer">КР «Нормальный послеродовый период», приложение Г2</a></p>
      <p>Наличие опубликованной адаптации не определяет редакцию ранее полученных сумм. Полный цифровой бланк и правила его применения требуют отдельной проверки.</p>
    </details>
  </div>;
}

export function ScenarioMeasurements({patientId}:{patientId:number}) {
  const result=useApi<ScenarioMeasurementsData>(`/patients/${patientId}/scenario-measurements`);
  if(result.error)return <ErrorBox message={result.error} retry={result.reload}/>;
  if(!result.data)return <Loading/>;
  return <ScoreHistory data={result.data}/>;
}

export function ScenarioHypothesis({context}:{context:ScenarioContext}) {
  const protocol=context.hypothesis?.source==="physician_alerts_2026-10-27";
  const source=context.hypothesis?.review_source??context.hypothesis?.drug_source;
  return <section className="scenario-hypothesis" aria-label="Гипотеза системы">
    <div className="section-heading"><Badge tone="warn">{protocol?`${context.hypothesis?.priority} · Клиническое событие`:"Лекарственная безопасность"}</Badge><Badge>Оценить врачу · обязательно</Badge></div>
    <h4>{context.title}{!protocol&&` · день ${context.day}`}</h4>
    <ul>{context.facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul>
    <p><strong>Предположение системы:</strong> {context.hypothesis?.proposal}</p>
    {!!context.hypothesis?.suggested_actions?.length&&<div><strong>Предлагаемые действия</strong><ul>{context.hypothesis.suggested_actions.map(text=><li key={text}>{text}</li>)}</ul></div>}
    <p className="field-hint">Исправьте вывод или одобрите гипотезу после проверки. Решение сохранится отдельно от исходных фактов; назначение в МИС не меняется.</p>
    {context.hypothesis&&<details className="source-help"><summary>Источник и недостающие сведения</summary>
      {source&&<p>{source.url?<a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>:source.title}</p>}
      {!protocol&&!context.hypothesis.registry_current_verified&&<p>Соответствие файла актуальной редакции ГРЛС ещё проверяется. Это ограничение источника сохраняется при подтверждении врачом своего вывода.</p>}
      <ul>{context.hypothesis.missing_data.map((text,index)=><li key={index}>{text}</li>)}</ul>
    </details>}
  </section>;
}

type ScenarioData={scenario:{key:string;source_id:string;title:string;age:number;sex:string;history:string;
  anchor_date:string;measurements:ScenarioMeasurementsData["measurements"];proposed_plan:string[];conflicts:string[];
  states:{day:number;diagnoses:string[];diagnosis_status:string;treatment_status:string;plan:string[];patient_report?:string[];new_diagnosis_status?:string}[]}|null;
  episodes:{id:number;step_key:string;occurred_at:string;snapshot:ScenarioContext;alert_id:number|null;alert_status:string|null;decision_status:string|null;doctor_conclusion:string|null}[]};

export function ClinicalScenarioPanel({patientId,openEvents}:{patientId:number;openEvents:(alertId:number)=>void}) {
  const result=useApi<ScenarioData>(`/patients/${patientId}/clinical-scenario`,15000);
  const [selectedDay,setSelectedDay]=useState<number|null>(null);
  if(result.error)return <ErrorBox message={result.error} retry={result.reload}/>;
  if(!result.data)return <Loading/>;
  const {scenario,episodes}=result.data;
  if(!scenario)return null;
  const days=[...new Set([0,...episodes.map(row=>row.snapshot.day)])].sort((a,b)=>a-b);
  const finalDay=days.at(-1)??0,day=selectedDay??finalDay,historical=day!==finalDay;
  const state=scenario.states.filter(row=>row.day<=day).at(-1);
  const visible=episodes.filter(row=>row.snapshot.day<=day);
  return <Section title={`${scenario.source_id} · ${scenario.title}`}>
    <p>{scenario.age} лет · {scenario.sex==="female"?"женщина":"мужчина"}. {scenario.history}</p>
    <label className="field scenario-cutoff">Срез сценария<select value={day} onChange={event=>setSelectedDay(Number(event.target.value))}>{days.map(value=><option key={value} value={value}>День {value}{value===finalDay?" · текущий срез":""}</option>)}</select></label>
    {state&&<div className="scenario-recorded-state"><h3>Сведения на день {day}</h3><p><strong>Диагнозы врача в МИС:</strong> {state.diagnoses.join(", ")}</p>
      <Badge>{state.treatment_status==="recorded_by_physician"?"Назначение записано врачом":state.treatment_status==="pending_review"?"План на рассмотрении":"Требуется решение врача"}</Badge>
      <ul>{state.plan.map(text=><li key={text}>{text}</li>)}</ul>{state.patient_report?.map(text=><p key={text}>Со слов пациента: {text}</p>)}{state.new_diagnosis_status&&<p>{state.new_diagnosis_status}</p>}
      <p className="field-hint">Это исходные записи врача на выбранный день. Система отдельно предлагает проверить безопасность; она не устанавливает эти диагнозы и не создаёт назначения.</p>
    </div>}
    {historical&&<p className="field-hint">Исторический просмотр. Для действий по текущей карточке выберите последний срез.</p>}
    <ScoreHistory data={{...scenario,measurements:scenario.measurements.filter(row=>row.day<=day)}}/>
    <div className="scenario-timeline">{visible.map(episode=><article key={episode.id}>
      <div className="scenario-timeline-date"><span>День {episode.snapshot.day}</span><time>{date(episode.occurred_at)}</time></div>
      <h3>{episode.snapshot.title}</h3><ul>{episode.snapshot.facts.map((fact,index)=><li key={index}>{fact}</li>)}</ul>
      {episode.snapshot.hypothesis&&<p><strong>Гипотеза системы:</strong> {episode.snapshot.hypothesis.proposal}</p>}
      {!historical&&(episode.doctor_conclusion?<div className="scenario-conclusion"><Badge tone="good">{episode.decision_status==="declined"?"Гипотеза отклонена":"Вывод врача сохранён"}</Badge><p>{episode.doctor_conclusion}</p></div>:episode.alert_id?<Button variant="secondary" onClick={()=>openEvents(episode.alert_id!)}>Разобрать событие #{episode.alert_id}</Button>:episode.snapshot.hypothesis?<p className="field-hint">Событие готовится к разбору в очереди.</p>:null)}
      {!historical&&episode.alert_id&&episode.doctor_conclusion&&<p className="field-hint">{episode.alert_status==="closed"?"Событие закрыто после зафиксированного действия.":"Событие открыто; действие и проверка результата учитываются отдельно."}</p>}
    </article>)}</div>
  </Section>;
}
