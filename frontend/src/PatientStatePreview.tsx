import { ArrowRight } from "lucide-react";
import { useApi, type Assessment, type ClinicalResult } from "./api";
import { Badge, Button, date, Empty, ErrorBox, Loading, Section } from "./UI";
import { Disclosure } from "./Interaction";
import { TimeSeries } from "./Charts";
import { InstrumentSource } from "./ClinicalHistory";
import { clinicalDate } from "./ClinicalReview";
import { clinicalEditions, clinicalResultLabel } from "./clinicalResults";
import { latestAssessmentSeries } from "./patientProgress";

export function PatientStatePreview({patientId,navigate}: {patientId:number;navigate:(view:string)=>void}) {
  const clinical=useApi<ClinicalResult[]>(`/patients/${patientId}/clinical-results`,15000);
  const legacy=useApi<Assessment[]>(`/patients/${patientId}/assessments`,15000);
  return <Section title="Динамика состояния" aside={<Button variant="ghost" onClick={()=>navigate("state")}>Вся история<ArrowRight size={16}/></Button>}>
    <p className="patient-state-intro">Сохранённые ответы на опросники врача. Баллы за участие от результатов не зависят.</p>
    {clinical.data?.some(row=>row.result.synthetic_provenance?.generated)&&<p className="field-hint">Демо-набор: вымышленные ответы для показа, а не наблюдение пациента.</p>}
    <ErrorBox message={clinical.error} retry={clinical.reload}/>
    {clinical.error&&clinical.data&&<p className="field-hint">Клиническая история не обновилась. Показаны последние полученные измерения.</p>}
    {!clinical.data?clinical.loading&&<Loading/>:clinical.data.length?<div className="patient-state-grid clinical-state-preview">
      {clinicalEditions(clinical.data).map(({key,rows,definition,latest})=>{
        const numeric=rows.filter((row):row is ClinicalResult&{score:number}=>row.score!==null);
        return <article className="patient-state-item" key={key}>
          <h3>{definition.name}</h3><div className="clinical-preview-labels"><Badge>{definition.version}</Badge>{latest.result.synthetic_provenance?.generated&&<Badge>Демо-набор</Badge>}</div>
          <div className="patient-state-value"><strong>{clinicalResultLabel(latest)}</strong><time dateTime={latest.created_at}>{clinicalDate(latest.created_at)}</time></div>
          {numeric.length>1&&definition.maximum!==null&&<TimeSeries title={`${definition.name} · сохранённые измерения`} maximum={definition.maximum} points={numeric.map(row=>({id:row.id,at:row.created_at,value:row.score}))}/>}
          {numeric.length===1&&<p className="field-hint">Для динамики нужно следующее измерение этой версии, назначенное врачом.</p>}
          {latest.result.kind==="panic_screen"&&<p className="field-hint">Это результат скрининга без суммарного балла. Он не подтверждает и не исключает диагноз.</p>}
          <InstrumentSource definition={definition}/>
        </article>;
      })}
    </div>:<Empty title="Клинических результатов пока нет">Подходящие опросники и частоту выбирает врач. Отсутствие ответа не означает нулевой результат.</Empty>}
    <ErrorBox message={legacy.error} retry={legacy.reload}/>
    {Boolean(legacy.data?.length)&&<Disclosure lazy title="Прежние числовые демо-данные">
      <p className="field-hint">Эти записи не получены из новых клинических бланков. Они не объединяются с ними в один график.</p>
      <div className="patient-state-grid">{(["phq9","gad7"] as const).map(form=>{
        const series=latestAssessmentSeries(legacy.data!,form);
        if(!series)return null;
        return <article className="patient-state-item" key={form}><h3>{form==="phq9"?"PHQ-9 · числовые демо-ответы":"GAD-7 · числовые демо-ответы"}</h3>
          <div className="patient-state-value"><strong>{series.latest.score}<span> / {series.maximum}</span></strong><span>{date(series.latest.created_at)}</span></div>
          <Badge>{series.version==="demo_numeric_v1"?"Учебные числовые данные":`Числовая версия ${series.version}`}</Badge>
          {series.points.length>1&&<TimeSeries title={`${form==="phq9"?"PHQ-9":"GAD-7"} · прежние числовые данные`} maximum={series.maximum} points={series.points.map(row=>({id:row.id,at:row.created_at,value:row.score}))}/>}
        </article>;
      })}</div>
    </Disclosure>}
    <p className="field-hint">Шкалы и версии показаны отдельно. График не устанавливает диагноз и не заменяет оценку врача.</p>
  </Section>;
}
