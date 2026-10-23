import { ShieldCheck } from "lucide-react";
import { useApi } from "./api";
import { dimensionLabels, elapsed } from "./collection";
import { Badge, Empty, ErrorBox, Heading, Loading, Section, adherenceLabels } from "./UI";
import { PrivacySettings } from "./PrivacySettings";
import { WorkflowValuesView, type WorkflowValues } from "./WorkflowMetrics";

type Protected<T> = {suppressed: boolean; reason: string | null; values: T | null};
type Clinic = {
  status: string;
  privacy: {min_group_size: number | null};
  cohort: Protected<{patients: number}> | null;
  dimensions: (Protected<{responding_patients: number; assigned_patients: number; coverage_percent: number | null}> & {code: string; label: string})[];
  journey: Protected<{assigned: number; opened: number; completed: number; opened_not_completed: number;
    completed_without_open_record: number; assignment_to_completion: {median_seconds: number | null}; open_to_completion: {median_seconds: number | null}}> | null;
  barriers: Protected<{responding_patients: number; categories: {code: string; label: string; count: number}[]}> | null;
  distributions: (Protected<{responding_patients: number; options: {value: string; count: number}[]}> & {reference: string; dimension: keyof typeof dimensionLabels; kind: string})[];
  adherence: Protected<{reports: number; statuses: Record<string, number>}> | null;
  distributions_suppressed: boolean;
  sources: {code: string; label: string; status: string}[];
  workflow: Protected<WorkflowValues> | null;
};

const hidden = "Показатели скрыты: недостаточно участников в группе, ячейке или её дополнении.";

export function AdminDashboard() {
  const report = useApi<Clinic>("/analytics/clinic", 15000);
  const d = report.data;
  return <>
    <Heading eyebrow="Администратор клиники" title="Общая сводка">Охват наблюдением, прохождение опросов и ограничения со слов пациентов. Персональные карточки и тексты ответов здесь недоступны.</Heading>
    <PrivacySettings reload={report.reload} />
    <ErrorBox message={report.error} retry={report.reload} />
    {!d ? <Loading /> : <>
      <div className="insight-notice"><ShieldCheck size={24} /><div>
        <strong>{d.status === "privacy_not_configured" ? "Нужно согласовать размер групп для показа" : `Минимальный размер группы: ${d.privacy.min_group_size}`}</strong>
        <p>{d.status === "privacy_not_configured" ? "Все блоки подготовлены. До настройки правил защиты значения скрыты; это не отсутствие данных." : "Связанные показатели скрываются вместе с малыми группами. Произвольные фильтры, выгрузка текстов и переходы к пациентам недоступны."}</p>
      </div></div>
      <Section title="Охват четырёх направлений">
        <p className="muted">Пациентов в доступной сводке: {d.cohort?.values?.patients ?? "скрыто"}. Общий балл пациента не вычисляется.</p>
        <div className="collection-grid">{Object.entries(dimensionLabels).map(([code, label]) => {
          const item = d.dimensions.find((item) => item.code === code);
          return <article className="collection-card" key={code}><h3>{label}</h3>
            <strong>{item?.values ? `${item.values.responding_patients} / ${item.values.assigned_patients}` : "Скрыто"}</strong>
            <p>{item?.values ? `Ответили / получили вопросы. Охват: ${item.values.coverage_percent === null ? "нет назначений" : `${item.values.coverage_percent}%`}` : d.status === "privacy_not_configured" ? "Правила групп ещё не настроены" : hidden}</p>
          </article>;
        })}</div>
      </Section>
      <Section title="Назначение → открытие → завершение">
        {d.journey?.values ? <>
          <p>Назначены: <strong>{d.journey.values.assigned}</strong> · открыты: <strong>{d.journey.values.opened}</strong> · завершены: <strong>{d.journey.values.completed}</strong></p>
          <p>Открыты без ответа: {d.journey.values.opened_not_completed}. Завершены без измеренного открытия: {d.journey.values.completed_without_open_record}.</p>
          <p>Медиана от назначения: {elapsed(d.journey.values.assignment_to_completion.median_seconds)}; от открытия: {elapsed(d.journey.values.open_to_completion.median_seconds)}.</p>
        </> : <p className="muted">{d.status === "privacy_not_configured" ? "Показ появится после настройки групп." : hidden}</p>}
        <p className="field-hint">Назначение не доказывает доставку. Интервалы включают перерывы; скорость ответа не является оценкой заинтересованности.</p>
      </Section>
      <div className="dashboard-columns">
        <Section title="Ограничения и препятствия">
          {d.barriers?.values ? <>
            <p>Ответивших пациентов: {d.barriers.values.responding_patients}</p>
            {d.barriers.values.categories.map((category) => <p key={category.code}>{category.label}: <strong>{category.count}</strong></p>)}
            <p className="field-hint">Категории задаёт врач при создании вариантов ответа; свободные тексты не классифицируются автоматически. Считаются ответы, допускающие несколько категорий.</p>
          </> : <p className="muted">{d.status === "privacy_not_configured" ? "Значения пока скрыты." : hidden}</p>}
        </Section>
        <Section title="Выполнение рекомендаций">
          {d.adherence?.values ? <>
            <p>Самоотчётов: {d.adherence.values.reports}</p>
            {Object.entries(d.adherence.values.statuses).map(([status, count]) => <p key={status}>{adherenceLabels[status] ?? "Без категории"}: <strong>{count}</strong></p>)}
          </> : <p className="muted">{d.status === "privacy_not_configured" ? "Значения пока скрыты." : hidden}</p>}
          <p className="field-hint">Это самоотчёты, а не подтверждённые приёмы препарата. Отсутствие ответа не считается невыполнением.</p>
        </Section>
      </div>
      <Section title="Распределения по версиям вопросов">
        {!d.distributions.length && <Empty title={d.status === "privacy_not_configured" ? "Ожидается настройка групп" : d.distributions_suppressed ? "Распределения скрыты правилами групп" : "Размеченных ответов пока нет"} />}
        {d.distributions.length > 0 && d.distributions_suppressed && <p className="muted">Часть распределений скрыта правилами групп.</p>}
        {d.distributions.map((item) => <article className="diary-entry" key={item.reference}>
          <h3>{dimensionLabels[item.dimension]} · {item.reference}</h3>
          {item.values ? <><p>Ответивших: {item.values.responding_patients}</p>
            {item.values.options.map((option) => <p key={option.value}>{item.kind === "scale" ? "Значение" : "Вариант"} {option.value}: {option.count}</p>)}
            {item.kind === "text" && <p className="muted">Тексты ответов в административной сводке не раскрываются.</p>}
          </> : <p className="muted">{hidden}</p>}
        </article>)}
        <p className="field-hint">Значения разных вопросов и версий не объединяются. Названия, формулировки и подписи авторских вариантов не передаются: они могут содержать персональные сведения. Общий справочник формулировок предстоит согласовать.</p>
      </Section>
      <Section title="Источники данных">
        <p className="field-hint">Внешняя МИС не подключена; визиты/назначения предоставлены синтетическими JSON.</p>
        {d.sources.map((source) => <p key={source.code}><Badge tone={source.status === "available" ? "good" : "muted"}>{source.status === "available" ? "Данные приложения" : source.status === "synthetic_json" ? "Синтетический JSON" : source.status === "in_app_simulation" ? "Симуляция" : source.status.includes("excluded") ? "Отдельный доступ" : "Не подключён"}</Badge> {source.label}</p>)}
      </Section>
      <Section title="Действия и исходы помощи">{d.workflow?.values ? <WorkflowValuesView d={d.workflow.values} /> : <p className="muted">{d.status === "privacy_not_configured" ? "Настройте правила публикации выше." : hidden}</p>}</Section>
    </>}
  </>;
}
