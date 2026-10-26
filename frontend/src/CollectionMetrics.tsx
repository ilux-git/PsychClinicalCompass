import type {CollectionMetrics as CollectionData} from "./api";
import { elapsed } from "./collection";
import { Section } from "./UI";
import { CoverageGrid, HorizontalBars } from "./Charts";

export function CollectionMetrics({data}: {data: CollectionData}) {
  const journey = data.journey;
  return <>
    <Section title="Четыре направления: что уже известно">
      <p className="field-hint">Это охват ответами, а не баллы заинтересованности, лояльности или личности. Ответ пациента и наблюдение врача — разные источники.</p>
      <CoverageGrid rows={data.dimensions.map(d=>({label:d.label,responded:d.responding_patients,assigned:d.assigned_patients,percent:d.coverage_percent,note:`Без ответа: ${d.patients_without_answer} · без назначения: ${d.patients_without_assignment}. Версий: ${d.question_versions}.`}))}/>
    </Section>
    <Section title="Как проходят опросы">
      <HorizontalBars title="Прохождение назначенных опросов" rows={[{label:"Назначено",value:journey.assigned},{label:"Открытие зафиксировано",value:journey.opened},{label:"Завершено после открытия",value:journey.completed_after_open}]} unit="опросов" caption="Старые завершения без зафиксированного открытия показаны отдельно ниже. Назначение не доказывает доставку."/>
      <div className="collection-grid">
        <article className="collection-card"><h3>Назначены</h3><strong>{journey.assigned}</strong><p>Опрос доступен в кабинете</p></article>
        <article className="collection-card"><h3>Открытие зафиксировано</h3><strong>{journey.opened}</strong><p>{journey.opening_rate_percent === null ? "Нет назначений" : `${journey.opening_rate_percent.toLocaleString("ru-RU")}% от назначений`}</p></article>
        <article className="collection-card"><h3>Завершены после открытия</h3><strong>{journey.completed_after_open}</strong><p>{journey.completion_after_open_percent === null ? "Нет измеренных открытий" : `${journey.completion_after_open_percent.toLocaleString("ru-RU")}% от открытий`}</p></article>
        <article className="collection-card"><h3>Открыты, пока без ответа</h3><strong>{journey.opened_not_completed}</strong><p>Причина не установлена</p></article>
      </div>
      <dl className="inbox-times">
        <div><dt>Медиана от назначения до ответа</dt><dd>{elapsed(journey.assignment_to_completion.median_seconds)} · измерений {journey.assignment_to_completion.known}</dd></div>
        <div><dt>Медиана от открытия до ответа</dt><dd>{elapsed(journey.open_to_completion.median_seconds)} · измерений {journey.open_to_completion.known}</dd></div>
      </dl>
      {(journey.timing_excluded_generated??0)>0&&<p className="field-hint">Из расчёта времени исключены сгенерированные примеры: {journey.timing_excluded_generated}. Осталось завершений для оценки времени: {journey.timing_eligible_completed}. Общие числа опросов включают оба источника.</p>}
      <p className="field-hint">Завершены без измеренного открытия: {journey.completed_without_open_record}. Без записи об открытии и ответа: {journey.not_opened_not_completed}. Неизвестных интервалов от открытия: {journey.open_to_completion.unknown}.</p>
      <p className="field-hint">{journey.interpretation} Скорость прохождения не определяет отношение пациента к лечению.</p>
    </Section>
  </>;
}
