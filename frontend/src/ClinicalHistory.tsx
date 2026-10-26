import { useLayoutEffect, useRef } from "react";
import { useApi, type ClinicalInstrument, type ClinicalResult } from "./api";
import { Badge, Empty, ErrorBox, Loading } from "./UI";
import { TimeSeries } from "./Charts";
import { AnswerSummary } from "./SurveyFields";
import { clinicalDate, ClinicalReviewSummary } from "./ClinicalReview";
import { ClinicalBaseline } from "./ClinicalBaseline";
import { clinicalEditions, clinicalResultLabel } from "./clinicalResults";
import "./clinical-instruments.css";

export function InstrumentSource({definition}: {definition: ClinicalInstrument}) {
  return <details className="instrument-source"><summary>Версия и источник опросника</summary>
    <p>{definition.version}</p><p><a href={definition.source_url} target="_blank" rel="noreferrer">{definition.source_title}</a></p>
    <p>{definition.source_check}</p><p>{definition.limitation}</p>
    <p>{definition.license}{definition.license_url&&<> <a href={definition.license_url} target="_blank" rel="noreferrer">Условия лицензии</a></>}</p>
  </details>;
}

export type ClinicalResultTarget={id:number;request:number};

export function ClinicalHistory({patientId,doctor=false,scope,target}: {patientId:number;doctor?:boolean;scope?:string;target?:ClinicalResultTarget|null}) {
  const history=useApi<ClinicalResult[]>(`/patients/${patientId}/clinical-results`,15000);
  const container=useRef<HTMLDivElement>(null);
  const handledTarget=useRef("");
  useLayoutEffect(()=>{
    if(!target||!history.data)return;
    const request=`${patientId}:${target.id}:${target.request}`;
    if(handledTarget.current===request)return;
    const result=container.current?.querySelector<HTMLDetailsElement>(`[data-clinical-result="${target.id}"]`);
    if(!result||result.closest('[inert]'))return;
    handledTarget.current=request;
    result.open=true;
    const summary=result.querySelector('summary');
    summary?.focus({preventScroll:true});summary?.scrollIntoView({block:"start",behavior:"auto"});
  },[patientId,target,history.data]);
  if(history.error)return <ErrorBox message={history.error} retry={history.reload}/>;
  if(!history.data)return <Loading/>;
  if(!history.data.length)return <Empty title="Заполненных клинических опросников пока нет">Врач может назначить PHQ-9, GAD-7 или панический модуль PHQ. Старые числовые демонстрационные ответы показаны отдельно.</Empty>;
  return <div className="clinical-history" ref={container}>
    {target&&!history.data.some(row=>row.id===target.id)&&<p role="status">Исходное измерение события не найдено в доступной истории. Обновите данные или вернитесь к событию.</p>}
    {clinicalEditions(history.data).map(({key,rows,definition,latest})=>{
    const numeric=rows.filter((row):row is ClinicalResult&{score:number}=>row.score!==null);
    return <section className="clinical-edition" key={key}>
      <div className="section-heading"><h3>{definition.name}</h3><Badge>{rows.length} измер.</Badge></div>
      <p className="field-hint">{definition.version}. Результаты оценивает врач.</p>
      <div className="clinical-latest"><span>Последний результат</span><strong>{clinicalResultLabel(latest)}</strong><time dateTime={latest.created_at}>{clinicalDate(latest.created_at)}</time></div>
      {doctor&&key==="phq9_zolotareva_2023_v1"&&<ClinicalBaseline key={`${patientId}:${key}`} patientId={patientId} instrumentKey={key} rows={rows} scope={scope}/>}
      {numeric.length>1&&definition.maximum!==null&&<TimeSeries title={`${definition.name} · динамика`} maximum={definition.maximum} points={numeric.map(row=>({id:row.id,at:row.created_at,value:row.score}))}/>}
      {numeric.length===1&&<p className="field-hint">Динамика появится после следующего измерения, назначенного врачом.</p>}
      {[...rows].reverse().map(row=><details className="assessment-answers" data-clinical-result={row.id} key={row.id}>
        <summary>{clinicalDate(row.created_at)} · {clinicalResultLabel(row)}{row.score!==null&&row.result.band?` · ${row.result.band} уровень`:""}</summary>
        {row.result.synthetic_provenance?.generated&&<p className="field-hint">Вымышленные ответы демо-набора. Это пример для показа, а не наблюдение пациента.</p>}
        {row.result.kind==="panic_screen"&&<p className="field-hint">{row.result.screen_stopped?"На первый вопрос получен ответ «Нет». Остальные вопросы не заполнялись и не приравниваются к отрицательным ответам.":`Положительных ответов в первом блоке: ${row.result.gates_yes} из 4; симптомов: ${row.result.symptoms_yes} из 11. Критерий: все 4 ответа первого блока и не менее 4 симптомов.`} Этот результат не подтверждает и не исключает диагноз.</p>}
        {row.result.item9_positive&&<p className="subtle-notice">Ответ на вопрос о мыслях о смерти или самоповреждении требует уточнения врачом. Он сам по себе не подтверждает непосредственную угрозу жизни.</p>}
        {doctor&&<ClinicalReviewSummary review={row.result.triage}/>}
        <AnswerSummary questions={row.definition.questions} answers={row.answers}/>
      </details>)}
      <InstrumentSource definition={definition}/>
    </section>;
  })}</div>;
}
