import { useApi } from "./api";
import { Button, Empty, ErrorBox, Loading, Section, plural } from "./UI";
import { HorizontalBars } from "./Charts";
import { Disclosure } from "./Interaction";
import { clinicalDate } from "./ClinicalReview";
import "./clinical-instruments.css";

type Instrument={key:string;name:string;version:string;maximum:number|null;source_title:string;source_url:string;source_check:string;license:string;license_url:string|null;limitation:string;
  assigned_patients:number;assignments:number;unanswered_assignments:number;observed_patients:number;results:number;repeat_patients:number;patients_without_results:number;coverage_percent:number|null;
  numeric_latest_patients:number;median_score:number|null;minimum_score:number|null;maximum_score:number|null;baseline_selected_patients:number|null;
  criterion:{met:number;not_met:number;unknown:number}|null;latest_review:Record<string,number>};
type Cohort={as_of:string;patients_total:number;search:string;instruments:Instrument[];legacy_numeric_results_included:false};
const latestLabels:Record<string,string>={urgent_review:"Срочная оценка",review_required:"Разбор врачом",needs_clarification:"Уточнение ответа",no_signal:"Нет основания по этим правилам",not_calculated:"Правила ещё не рассчитывались"};
const patients=(value:number)=>`${value} ${plural(value,"пациент","пациента","пациентов")}`;

export function ClinicalCohort({search,openSurveys}: {search:string;openSurveys?:()=>void}) {
  const cohort=useApi<Cohort>(`/analytics/clinical-instruments?q=${encodeURIComponent(search)}`,15000);
  return <Section title="Клинические опросники" aside={<Button variant="ghost" onClick={cohort.reload}>Обновить сводку</Button>}>
    <ErrorBox message={cohort.error} retry={cohort.reload}/>
    {!cohort.data?cohort.error?<Empty title="Сводка пока недоступна">Список пациентов ниже остаётся доступным. Повторите загрузку сводки.</Empty>:<Loading/>:<>
      <p className="field-hint">{cohort.data.search?`Поиск по имени: «${cohort.data.search}». `:""}Пациентов в выборке: {cohort.data.patients_total}. Срез на {clinicalDate(cohort.data.as_of)}. Каждая версия показана отдельно; старые числовые демо-данные сюда не включены.</p>
      <div className="clinical-cohort-grid">{cohort.data.instruments.map(item=><article className="clinical-cohort-card" key={item.key}>
        <h3>{item.name}</h3><p className="field-hint">{item.version}</p>
        <div className="clinical-cohort-coverage"><span>Пациентов с ответом</span><strong>{item.observed_patients}<small> из {item.assigned_patients} с назначением</small></strong></div>
        <p className="field-hint">{item.coverage_percent===null?"Назначений этой версии пока нет.":`${item.coverage_percent.toLocaleString("ru-RU")}% пациентов с назначением ответили хотя бы один раз.`}</p>
        {item.maximum!==null?<dl className="clinical-comparisons"><div><dt>Медиана последних баллов</dt><dd>{item.median_score===null?"Нет измерений":`${item.median_score.toLocaleString("ru-RU")} / ${item.maximum}`}</dd></div><div><dt>Диапазон последних баллов</dt><dd>{item.minimum_score===null?"Нет измерений":`${item.minimum_score}–${item.maximum_score}`}</dd></div></dl>:
          <dl className="clinical-comparisons"><div><dt>Критерий скрининга выполнен</dt><dd>{patients(item.criterion?.met??0)}</dd></div><div><dt>Критерий не выполнен</dt><dd>{patients(item.criterion?.not_met??0)}</dd></div></dl>}
        <p className="field-hint">Сохранено ответов: {item.results}. Повторные измерения: {patients(item.repeat_patients)}. Без результата этой версии: {item.patients_without_results}.</p>
        {item.baseline_selected_patients!==null&&<p className="field-hint">Исходное измерение выбрано врачом: {patients(item.baseline_selected_patients)}.</p>}
        <Disclosure lazy title="Полнота данных и основания">
          <HorizontalBars title="Назначения и ответы" unit="пациентов" maximum={cohort.data!.patients_total} rows={[
            {label:"Назначен опросник",value:item.assigned_patients},{label:"Есть ответ",value:item.observed_patients},{label:"Есть повторное измерение",value:item.repeat_patients}
          ]} caption="Пересекающиеся группы; каждый пациент учитывается один раз в каждой строке для этой версии. Повторное измерение не доказывает улучшение."/>
          <HorizontalBars title="Основания в последнем ответе" unit="пациентов" maximum={item.observed_patients} rows={Object.entries(item.latest_review).map(([key,value])=>({label:latestLabels[key]??key,value}))} caption="Снимок правил при получении последнего ответа. Открытые события и решения врача учитываются отдельно. Отсутствие основания по этим правилам не исключает клинический риск."/>
          <p>Незавершённых назначений: {item.unanswered_assignments} из {item.assignments}. Отсутствие ответа не приравнивается к нулевому баллу.</p>
          {item.criterion&&<p className="field-hint">Критерий неизвестен: {item.criterion.unknown}. Панический модуль не имеет суммарного балла и не устанавливает диагноз.</p>}
        </Disclosure>
        <details className="instrument-source"><summary>Источник и ограничения</summary><p><a href={item.source_url} target="_blank" rel="noreferrer">{item.source_title}</a></p><p>{item.source_check}</p><p>{item.license}{item.license_url&&<> <a href={item.license_url} target="_blank" rel="noreferrer">Условия лицензии</a></>}</p><p>{item.limitation}</p></details>
      </article>)}</div>
      {cohort.data.instruments.every(item=>item.observed_patients===0)&&<Empty title="Канонических клинических ответов пока нет">Назначьте бланк из библиотеки. Старые демо-ответы остаются в карточках и не становятся измерениями подтверждённой версии.</Empty>}
      {openSurveys&&<Button variant="secondary" onClick={openSurveys}>Открыть библиотеку опросов</Button>}
      <p className="field-hint">Это охват измерениями и описательная статистика. По этим показателям не вычисляется эффективность лечения или причина отказа пациента.</p>
    </>}
  </Section>;
}
