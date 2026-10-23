import type {CollectionMetrics as CollectionData} from "./api";
import { elapsed } from "./collection";
import { Section } from "./UI";

export function CollectionMetrics({data}: {data: CollectionData}) {
  const journey = data.journey;
  return <>
    <Section title="Четыре направления: что уже известно">
      <p className="field-hint">Это охват ответами, а не баллы заинтересованности, лояльности или личности. Ответ пациента и наблюдение врача — разные источники.</p>
      <div className="collection-grid">
        {data.dimensions.map((dimension) => <article className="collection-card" key={dimension.code}>
          <h3>{dimension.label}</h3>
          <strong>{dimension.assigned_patients ? `${dimension.responding_patients} / ${dimension.assigned_patients}` : "Пока не измеряется"}</strong>
          <p>{dimension.assigned_patients ? `Пациентов с ответом / получивших вопросы: ${dimension.coverage_percent}%` : "Нет назначенных вопросов с этим направлением"}</p>
          <small>Без ответа: {dimension.patients_without_answer} · без назначения: {dimension.patients_without_assignment}. Версий вопросов: {dimension.question_versions}.</small>
        </article>)}
      </div>
    </Section>
    <Section title="Как проходят опросы">
      <div className="collection-grid">
        <article className="collection-card"><h3>Назначены</h3><strong>{journey.assigned}</strong><p>Опрос доступен в кабинете</p></article>
        <article className="collection-card"><h3>Открытие зафиксировано</h3><strong>{journey.opened}</strong><p>{journey.opening_rate_percent === null ? "Нет назначений" : `${journey.opening_rate_percent}% от назначений`}</p></article>
        <article className="collection-card"><h3>Завершены после открытия</h3><strong>{journey.completed_after_open}</strong><p>{journey.completion_after_open_percent === null ? "Нет измеренных открытий" : `${journey.completion_after_open_percent}% от открытий`}</p></article>
        <article className="collection-card"><h3>Открыты, пока без ответа</h3><strong>{journey.opened_not_completed}</strong><p>Причина не установлена</p></article>
      </div>
      <dl className="inbox-times">
        <div><dt>Медиана от назначения до ответа</dt><dd>{elapsed(journey.assignment_to_completion.median_seconds)} · измерений {journey.assignment_to_completion.known}</dd></div>
        <div><dt>Медиана от открытия до ответа</dt><dd>{elapsed(journey.open_to_completion.median_seconds)} · измерений {journey.open_to_completion.known}</dd></div>
      </dl>
      <p className="field-hint">Завершены без измеренного открытия: {journey.completed_without_open_record}. Без записи об открытии и ответа: {journey.not_opened_not_completed}. Неизвестных интервалов от открытия: {journey.open_to_completion.unknown}.</p>
      <p className="field-hint">{journey.interpretation} Скорость прохождения не определяет отношение пациента к лечению.</p>
    </Section>
  </>;
}
