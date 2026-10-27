import { ShieldCheck } from "lucide-react";
import { useApi } from "./api";
import { dimensionLabels, elapsed } from "./collection";
import { Badge, Button, Empty, ErrorBox, Heading, Loading, Section, adherenceLabels, date } from "./UI";
import { PrivacySettings } from "./PrivacySettings";
import { TreatmentContinuityView, WorkflowValuesView, type WorkflowValues } from "./WorkflowMetrics";
import { CoverageGrid, HorizontalBars } from "./Charts";
import { navigationFor } from "./navigation";
import { verificationProgress } from "./careProgress";

const sourceLabels:Record<string,string>={visits:"Визиты и назначения из МИС",medication_reminders:"Личные расписания и самоотчёты"};

type Protected<T> = {suppressed: boolean; reason: string | null; values: T | null};
type Clinic = {
  status: string;
  privacy: {min_group_size: number | null};
  cohort: Protected<{patients: number}> | null;
  dimensions: (Protected<{responding_patients: number; assigned_patients: number; coverage_percent: number | null}> & {code: string; label: string})[];
  journey: Protected<{assigned: number; opened: number; completed: number; opened_not_completed: number;
    completed_without_open_record: number; timing_excluded_generated?: number; timing_eligible_completed?: number;
    assignment_to_completion: {median_seconds: number | null}; open_to_completion: {median_seconds: number | null}}> | null;
  barriers: Protected<{responding_patients: number; categories: {code: string; label: string; count: number}[]}> | null;
  distributions: (Protected<{responding_patients: number; options: {value: string; count: number}[]}> & {reference: string; dimension: keyof typeof dimensionLabels; kind: string})[];
  adherence: Protected<{reports: number; statuses: Record<string, number>}> | null;
  distributions_suppressed: boolean;
  sources: {code: string; label: string; status: string}[];
  workflow: Protected<WorkflowValues> | null;
};

const hidden = "Показатели скрыты: недостаточно участников в группе, ячейке или её дополнении.";
const sections=navigationFor("admin");

export function ClinicDecisionSummary({workflow,navigate}:{workflow:Protected<WorkflowValues>|null;navigate?:(view:string)=>void}) {
  const d=workflow?.suppressed?null:workflow?.values;
  const checks=d?verificationProgress(d.tasks):null;
  const waiting=d?.support_requests?d.support_requests.queued+d.support_requests.awaiting_review:null;
  return <section className="clinic-decision-summary" aria-labelledby="clinic-decision-title">
    <header><div><p className="eyebrow">Продолжение лечения и работа клиники</p><h2 id="clinic-decision-title">Сводка сопровождения</h2></div>{d&&<span>Срез на {date(d.as_of)}</span>}</header>
    {!d?<p className="clinic-summary-hidden">{workflow?.suppressed?"Показатели сопровождения скрыты правилами групп.":"Показатели сопровождения пока недоступны."} Это не нулевой результат. Доступные блоки сводки — ниже.</p>:<>
      <dl className="clinic-summary-values">
        <div><dt>Подтверждённые отказы</dt><dd>{d.treatment.refused}<p>{d.refusal_reasons?.patients?`Конкретная причина известна у ${d.refusal_reasons.with_specific_reason} из ${d.refusal_reasons.patients}.`:d.treatment.refused?"Полнота причин пока неизвестна.":"По текущим решениям врачей отказов нет."}</p></dd></div>
        <div><dt>Обращения ждут разбора</dt><dd>{waiting??"Нет данных"}<p>{d.support_requests?`Из ${d.support_requests.total} явных запросов поддержки. Принятие не означает решение затруднения.`:"Данные об обращениях не получены."}</p></dd></div>
        <div><dt>Выполнены, ждут проверки</dt><dd>{checks?.awaiting}<p>Из {d.tasks.action_done} выполненных действий. Неизвестный результат после проверки учитывается отдельно.</p></dd></div>
      </dl>
      <p className="clinic-summary-note">Текущие статусы, а не отток за период. Завершённое лечение и отсутствие ответа не считаются отказом.</p>
    </>}
    {navigate&&<div className="button-row"><Button variant="secondary" onClick={()=>navigate("barriers")}>Причины отказов и барьеры</Button><Button variant="ghost" onClick={()=>navigate("actions")}>Действия и проверка результата</Button></div>}
  </section>;
}

export function AdminDashboard({view="overview",navigate}: {view?:string;navigate?:(view:string)=>void}) {
  const report = useApi<Clinic>("/analytics/clinic", 15000);
  const d = report.data;
  const current=Math.max(0,sections.findIndex(section=>section.id===view));
  return <>
    <Heading eyebrow="Аналитика клиники" title={sections[current].title} action={<Button variant="secondary" disabled={report.refreshing} onClick={report.reload}>{report.refreshing?"Обновляем…":"Обновить сводку"}</Button>}>{sections[current].description}. Персональные карточки и тексты ответов здесь недоступны.</Heading>
    {navigate&&<nav className="report-route" aria-label="Маршрут по сводке">{sections.map((section,index)=><button type="button" key={section.id} aria-current={view===section.id?"step":undefined} onClick={()=>navigate(section.id)}><span>{index+1}</span><strong>{section.title}</strong></button>)}</nav>}
    <ErrorBox message={report.error} retry={report.reload} />
    {!d ? report.loading ? <Loading /> : <Empty title="Сводка пока недоступна"/> : <>
      {report.error&&<p className="field-hint">Обновление не удалось. Ниже — последняя полученная сводка, её значения могли измениться.</p>}
      <details className="privacy-summary"><summary><ShieldCheck size={17}/>{d.status === "privacy_not_configured" ? "Показатели скрыты — настройте правила групп" : `Обезличенная сводка · минимальная группа: ${d.privacy.min_group_size}`}</summary>
        <p>{d.status === "privacy_not_configured" ? "Все блоки подготовлены. До настройки правил защиты значения скрыты; это не отсутствие данных." : "Связанные показатели скрываются вместе с малыми группами. Произвольные фильтры, выгрузка текстов и переходы к пациентам недоступны."}</p>
      </details>
      {d.status === "privacy_not_configured" && view !== "sources" && navigate && <div className="privacy-setup-action"><Button variant="secondary" onClick={() => navigate('sources')}>Настроить правила публикации</Button></div>}
      {view === "overview" && <>
      <ClinicDecisionSummary workflow={d.workflow} navigate={navigate}/>
      <Section title="Охват четырёх направлений">
        <p className="muted">Пациентов в доступной сводке: {d.cohort?.values?.patients ?? "скрыто"}. Общий балл пациента не вычисляется.</p>
        <CoverageGrid rows={Object.entries(dimensionLabels).map(([code, label]) => {
          const item = d.dimensions.find((item) => item.code === code);
          return {label,responded:item?.values?.responding_patients??null,assigned:item?.values?.assigned_patients??null,percent:item?.values?.coverage_percent??null};
        })}/>
        <p className="field-hint">Пациенты с ответом / пациенты, которым назначены вопросы направления. Это охват, а не оценка личности. Малые группы скрываются.</p>
      </Section>
      <Section title="Назначение → открытие → завершение">
        {d.journey?.values&&!d.journey.suppressed ? <>
          <HorizontalBars title="Наблюдаемое прохождение опросов" unit="опросов" rows={[{label:"Назначено",value:d.journey.values.assigned},{label:"Открытие зафиксировано",value:d.journey.values.opened},{label:"Завершено, включая старые ответы",value:d.journey.values.completed}]} caption="Открытия измерялись не у всех старых ответов; этот график не является вложенной воронкой конверсии."/>
          <p>Открыты без ответа: {d.journey.values.opened_not_completed}. Завершены без измеренного открытия: {d.journey.values.completed_without_open_record}.</p>
          <p>Медиана от назначения: {elapsed(d.journey.values.assignment_to_completion.median_seconds)}; от открытия: {elapsed(d.journey.values.open_to_completion.median_seconds)}.</p>
          {(d.journey.values.timing_excluded_generated??0)>0&&<p className="field-hint">Не включены в расчёт времени: {d.journey.values.timing_excluded_generated}. Завершений для оценки времени: {d.journey.values.timing_eligible_completed}. Общие числа опросов включают обе группы.</p>}
        </> : <p className="muted">{d.status === "privacy_not_configured" ? "Показ появится после настройки групп." : hidden}</p>}
        <p className="field-hint">Назначение не доказывает доставку. Интервалы включают перерывы; скорость ответа не является оценкой заинтересованности.</p>
      </Section>
      </>}
      {view === "barriers" && <>
      <Section title="Продолжение лечения и причины отказов">{d.workflow?.values&&!d.workflow.suppressed?<TreatmentContinuityView d={d.workflow.values}/>:<p className="muted">{d.status==="privacy_not_configured"?"Показ появится после настройки групп.":hidden}</p>}</Section>
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
          <h3>{dimensionLabels[item.dimension]}</h3>
          <p className="field-hint">{item.reference.replace(/^S(\d+)\/V(\d+)\/Q(\d+)$/, "Опрос $1 · Версия $2 · Вопрос $3")}</p>
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
        {d.sources.map((source) => <p key={source.code}><Badge tone={source.status === "available" ? "good" : "muted"}>{source.status === "available" ? "Данные приложения" : source.status === "synthetic_json" ? "МИС · JSON" : source.status === "in_app_simulation" ? "В приложении" : source.status.includes("excluded") ? "Отдельный доступ" : "Не подключён"}</Badge> {sourceLabels[source.code]??source.label}</p>)}
      </Section>
      </>}
      {view === "actions" && <Section title="Действия и исходы помощи">{d.workflow?.values ? <WorkflowValuesView d={d.workflow.values} includeContinuity={false}/> : <p className="muted">{d.status === "privacy_not_configured" ? "Настройте правила публикации в разделе «Данные и приватность»." : hidden}</p>}</Section>}
      {navigate&&<nav className="analytics-next" aria-label="Переходы по сводке"><span className="field-hint">Раздел {current+1} из {sections.length}</span><div className="button-row">{current>0&&<Button variant="ghost" onClick={()=>navigate(sections[current-1].id)}>Назад: {sections[current-1].title}</Button>}{current<sections.length-1&&<Button variant="secondary" onClick={()=>navigate(sections[current+1].id)}>Далее: {sections[current+1].title}</Button>}</div></nav>}
    </>}
  </>;
}
