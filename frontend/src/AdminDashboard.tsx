import { ShieldCheck } from "lucide-react";
import { useApi } from "./api";
import { dimensionLabels, elapsed } from "./collection";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, adherenceLabels } from "./UI";
import { PrivacySettings } from "./PrivacySettings";
import { WorkflowValuesView, type WorkflowValues } from "./WorkflowMetrics";
import { CoverageGrid, HorizontalBars } from "./Charts";

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
const sections=[{id:"overview",title:"Охват и опросы",description:"Сколько пациентов участвуют в наблюдении и как проходят назначенные опросы."},{id:"barriers",title:"Барьеры и обратная связь",description:"Какие препятствия сообщают пациенты и как распределяются ответы на сопоставимые версии вопросов."},{id:"actions",title:"Действия и исходы",description:"Что делает клиника после обращения, какие результаты проверены врачом и что пока остаётся неизвестным."},{id:"sources",title:"Источники и защита",description:"Откуда получены данные и какие правила определяют публикацию обезличенных показателей."}];

export function AdminDashboard({view="overview",navigate}: {view?:string;navigate?:(view:string)=>void}) {
  const report = useApi<Clinic>("/analytics/clinic", 15000);
  const d = report.data;
  const current=Math.max(0,sections.findIndex(section=>section.id===view));
  return <>
    <Heading eyebrow="Аналитика клиники" title={view==="overview"?"Общая картина сопровождения":sections[current].title} action={<Button variant="secondary" disabled={report.refreshing} onClick={report.reload}>{report.refreshing?"Обновляем…":"Обновить сводку"}</Button>}>{sections[current].description} Персональные карточки и тексты ответов здесь недоступны.</Heading>
    <ErrorBox message={report.error} retry={report.reload} />
    {!d ? report.loading ? <Loading /> : <Empty title="Сводка пока недоступна"/> : <>
      <details className="privacy-summary"><summary><ShieldCheck size={17}/>{d.status === "privacy_not_configured" ? "Показатели скрыты — настройте правила групп" : `Обезличенная сводка · минимальная группа: ${d.privacy.min_group_size}`}</summary>
        <p>{d.status === "privacy_not_configured" ? "Все блоки подготовлены. До настройки правил защиты значения скрыты; это не отсутствие данных." : "Связанные показатели скрываются вместе с малыми группами. Произвольные фильтры, выгрузка текстов и переходы к пациентам недоступны."}</p>
      </details>
      {d.status === "privacy_not_configured" && view !== "sources" && navigate && <Button variant="secondary" onClick={() => navigate('sources')}>Настроить правила публикации</Button>}
      {view === "overview" && <>
      <Section title="Охват четырёх направлений">
        <p className="muted">Пациентов в доступной сводке: {d.cohort?.values?.patients ?? "скрыто"}. Общий балл пациента не вычисляется.</p>
        <CoverageGrid rows={Object.entries(dimensionLabels).map(([code, label]) => {
          const item = d.dimensions.find((item) => item.code === code);
          return {label,responded:item?.values?.responding_patients??null,assigned:item?.values?.assigned_patients??null,percent:item?.values?.coverage_percent??null};
        })}/>
        <p className="field-hint">Пациенты с ответом / пациенты, которым назначены вопросы направления. Это охват, а не оценка личности. Малые группы скрываются.</p>
      </Section>
      <Section title="Назначение → открытие → завершение">
        {d.journey?.values ? <>
          <HorizontalBars title="Наблюдаемое прохождение опросов" unit="опросов" rows={[{label:"Назначено",value:d.journey.values.assigned},{label:"Открытие зафиксировано",value:d.journey.values.opened},{label:"Завершено, включая старые ответы",value:d.journey.values.completed}]} caption="Открытия измерялись не у всех старых ответов; этот график не является вложенной воронкой конверсии."/>
          <p>Открыты без ответа: {d.journey.values.opened_not_completed}. Завершены без измеренного открытия: {d.journey.values.completed_without_open_record}.</p>
          <p>Медиана от назначения: {elapsed(d.journey.values.assignment_to_completion.median_seconds)}; от открытия: {elapsed(d.journey.values.open_to_completion.median_seconds)}.</p>
        </> : <p className="muted">{d.status === "privacy_not_configured" ? "Показ появится после настройки групп." : hidden}</p>}
        <p className="field-hint">Назначение не доказывает доставку. Интервалы включают перерывы; скорость ответа не является оценкой заинтересованности.</p>
      </Section>
      </>}
      {view === "barriers" && <>
      <div className="dashboard-columns">
        <Section title="Ограничения и препятствия">
          {d.barriers?.values ? <>
            <p>Ответивших пациентов: {d.barriers.values.responding_patients}</p>
            <HorizontalBars title="Какие препятствия указали" unit="ответов" rows={d.barriers.values.categories.map(category => ({label:category.label,value:category.count}))}/>
            <p className="field-hint">Категории задаёт врач при создании вариантов ответа; свободные тексты не классифицируются автоматически. Считаются ответы, допускающие несколько категорий.</p>
          </> : <p className="muted">{d.status === "privacy_not_configured" ? "Значения пока скрыты." : hidden}</p>}
        </Section>
        <Section title="Выполнение рекомендаций">
          {d.adherence?.values ? <>
            <p>Самоотчётов: {d.adherence.values.reports}</p>
            <HorizontalBars title="Выполнение рекомендаций со слов пациентов" unit="самоотчётов" rows={Object.entries(d.adherence.values.statuses).map(([status,count]) => ({label:adherenceLabels[status] ?? "Без категории",value:count}))}/>
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
            {item.kind !== "text" && <HorizontalBars title="Распределение ответов" unit="ответов" rows={item.values.options.map(option => ({label:`${item.kind === "scale" ? "Значение" : "Вариант"} ${option.value}`,value:option.count}))}/>}
            {item.kind === "text" && <p className="muted">Тексты ответов в административной сводке не раскрываются.</p>}
          </> : <p className="muted">{hidden}</p>}
        </article>)}
        <p className="field-hint">Значения разных вопросов и версий не объединяются. Названия, формулировки и подписи авторских вариантов не передаются: они могут содержать персональные сведения. Общий справочник формулировок предстоит согласовать.</p>
      </Section>
      </>}
      {view === "sources" && <>
      <PrivacySettings reload={report.reload}/>
      <Section title="Источники данных">
        <p className="field-hint">Внешняя МИС не подключена; визиты/назначения предоставлены синтетическими JSON.</p>
        {d.sources.map((source) => <p key={source.code}><Badge tone={source.status === "available" ? "good" : "muted"}>{source.status === "available" ? "Данные приложения" : source.status === "synthetic_json" ? "Синтетический JSON" : source.status === "in_app_simulation" ? "Симуляция" : source.status.includes("excluded") ? "Отдельный доступ" : "Не подключён"}</Badge> {source.label}</p>)}
      </Section>
      </>}
      {view === "actions" && <Section title="Действия и исходы помощи">{d.workflow?.values ? <WorkflowValuesView d={d.workflow.values} /> : <p className="muted">{d.status === "privacy_not_configured" ? "Настройте правила публикации в разделе «Источники и защита»." : hidden}</p>}</Section>}
      {navigate&&<nav className="analytics-next" aria-label="Переходы по сводке"><span className="field-hint">Раздел {current+1} из {sections.length}</span><div className="button-row">{current>0&&<Button variant="ghost" onClick={()=>navigate(sections[current-1].id)}>Назад: {sections[current-1].title}</Button>}{current<sections.length-1&&<Button variant="secondary" onClick={()=>navigate(sections[current+1].id)}>Далее: {sections[current+1].title}</Button>}</div></nav>}
    </>}
  </>;
}
