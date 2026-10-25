import { useApi } from "./api";
import { ErrorBox, Loading, Section, date, plural } from "./UI";
import { HorizontalBars } from "./Charts";
import { Disclosure } from "./Interaction";
import { verificationProgress } from "./careProgress";

type Fraction = {numerator: number; denominator: number; percent: number | null};
export type WorkflowValues = {as_of: string; mis_snapshot_as_of: string;
  treatment: {in_progress: number; completed: number; refused: number; unknown: number};
  refusal_reasons?:{patients:number;with_specific_reason:number;categories:{code:string;label:string;patients:number}[]};
  support_requests?:{total:number;queued:number;awaiting_review:number;acknowledged:number;with_task:number;with_linked_reply:number;acknowledgement_coverage:Fraction;median_to_acknowledgement_seconds:number|null;median_to_linked_reply_seconds:number|null;oldest_unacknowledged_seconds:number|null;acknowledgement_intervals:number;linked_reply_intervals:number};
  survey_on_time: Fraction & {without_due: number};
  tasks: {total: number; open: number; in_progress: number; action_done: number; with_source: number; verification: Record<string,number>; without_followup_date: number; recheck_coverage: Fraction};
  visits: {attended: number; no_show: number; cancelled: number; rescheduled: number; clinic_changed: number;
    source_missing_patients: number; no_show_fraction: Fraction; contact_in_window: Fraction; windows_not_mature: number; windows_without_data_or_plan: number};
  medication: {self_reports: number; statuses: Record<string,number>; documentation_today: Fraction}};
const ratio = (v: Fraction) => v.denominator ? `${v.numerator} / ${v.denominator}${v.percent===null?" · доля не рассчитана":` (${v.percent.toLocaleString("ru-RU",{maximumFractionDigits:1})}%)`}` : "Нет подходящих наблюдений";
const interval = (v:number|null) => v === null ? "Нет измеренных интервалов" : v<60 ? `${v.toLocaleString("ru-RU",{maximumFractionDigits:1})} с` : v<3600 ? `${(v/60).toLocaleString("ru-RU",{maximumFractionDigits:1})} мин` : `${(v/3600).toLocaleString("ru-RU",{maximumFractionDigits:1})} ч`;

export function TreatmentContinuityView({d}: {d:WorkflowValues}) {
  return <>
    <p className="field-hint">Текущий статус определяет врач. Неответ пациента не считается отказом; завершённое лечение показывается отдельно. Причины учитываются только там, где они явно сообщены и классифицированы.</p>
    <div className="dashboard-columns">
      <HorizontalBars title="Статусы лечения" maximum={d.treatment.in_progress+d.treatment.completed+d.treatment.refused+d.treatment.unknown} unit="пациентов" rows={[{label:"В процессе",value:d.treatment.in_progress},{label:"Завершили лечение",value:d.treatment.completed},{label:"Отказались",value:d.treatment.refused},{label:"Исход не определён",value:d.treatment.unknown}]} caption="Текущий срез; молчание пациента не меняет исход лечения."/>
      {d.refusal_reasons && (d.refusal_reasons.patients ? <HorizontalBars title="Сообщённые причины отказов" maximum={d.refusal_reasons.patients} unit="пациентов" rows={d.refusal_reasons.categories.filter(c => c.patients>0).map(c => ({label:c.label,value:c.patients}))} caption={`Подтверждённых врачом отказов: ${d.refusal_reasons.patients}. Конкретная причина известна у ${d.refusal_reasons.with_specific_reason}. Основание остаётся в карточке врача.`}/> : <div className="workflow-empty"><h4>Подтверждённых отказов нет</h4><p>Неответы не превращаются в отказы. Причины появятся после решения и классификации врачом.</p></div>)}
    </div>
  </>;
}

export function WorkflowValuesView({d,includeContinuity=true}: {d: WorkflowValues;includeContinuity?:boolean}) {
  const checks=verificationProgress(d.tasks);
  return <>
    <div className="workflow-section-heading"><h3>От действия к проверенному результату</h3><p>Срез всех задач сопровождения. Связь с источником не означает, что он содержит подтверждённую причину ухода.</p></div>
    <dl className="care-progress-summary analytics-care-summary">
      <div><dt>Связаны с источником</dt><dd>{d.tasks.with_source}<span> из {d.tasks.total} задач</span></dd></div>
      <div><dt>Ждут проверки врача</dt><dd>{checks.awaiting}<span> из {d.tasks.action_done} выполненных</span></dd></div>
      <div><dt>Результат проверен</dt><dd>{checks.checked}<span> из {d.tasks.action_done} выполненных</span></dd></div>
    </dl>
    <div className="dashboard-columns">
      <HorizontalBars title="Действия клиники" maximum={d.tasks.total} unit="задач" rows={[{label:"Назначено",value:d.tasks.open},{label:"В работе",value:d.tasks.in_progress},{label:"Действие выполнено",value:d.tasks.action_done}]} caption="Текущие этапы всех задач. Выполненное действие ещё требует отдельной проверки результата."/>
      <HorizontalBars title="Что известно о результате" maximum={d.tasks.action_done} unit="задач" rows={[{label:"Ещё не проверен",value:checks.awaiting},{label:"Затруднение устранено",value:checks.resolved},{label:"Затруднение сохраняется",value:checks.notResolved},{label:"Проверен: результат неизвестен",value:checks.unknown}]} caption={`Только ${d.tasks.action_done} выполненных действий. «Неизвестен» — сохранённый вывод врача; «не проверен» — проверки ещё не было.`}/>
    </div>
    <p className="workflow-check-coverage"><strong>Проверены к текущему моменту: {ratio(d.tasks.recheck_coverage)}.</strong> Среди задач с наступившим сроком проверки. Без даты проверки: {d.tasks.without_followup_date} из всех {d.tasks.total} задач. Показатель не измеряет соблюдение срока.</p>
    {includeContinuity&&<Disclosure title="Продолжение лечения и сообщённые причины отказов"><TreatmentContinuityView d={d}/></Disclosure>}
    <Disclosure title="Обращения за поддержкой и время реакции">
    {d.support_requests && <>
      <div className="workflow-section-heading"><h3>Как клиника отвечает на просьбы о поддержке</h3><p>Только обращения, в которых пациент сам отметил, что ему нужна поддержка.</p></div>
      <HorizontalBars title="Путь явного запроса поддержки" maximum={d.support_requests.total} unit="обращений" rows={[{label:"Ещё не появились в очереди врача",value:d.support_requests.queued},{label:"Ждут разбора",value:d.support_requests.awaiting_review},{label:"Приняты врачом",value:d.support_requests.acknowledged},{label:"Есть связанная задача",value:d.support_requests.with_task},{label:"Есть связанный ответ в диалоге",value:d.support_requests.with_linked_reply}]} caption={`Всего: ${d.support_requests.total} ${plural(d.support_requests.total,"обращение","обращения","обращений")}. Задачи и ответы — пересекающиеся подмножества. Принятие и ответ не доказывают решение затруднения.`}/>
      <div className="collection-grid workflow-metrics"><article className="collection-card"><h3>Принято запросов поддержки</h3><strong>{ratio(d.support_requests.acknowledgement_coverage)}</strong><p>Включая ещё не созданные события в знаменателе.</p></article><article className="collection-card"><h3>Медиана до принятия</h3><strong>{interval(d.support_requests.median_to_acknowledgement_seconds)}</strong><p>Измеренных интервалов: {d.support_requests.acknowledgement_intervals}. {d.support_requests.oldest_unacknowledged_seconds===null?"Сейчас непринятых обращений нет.":`Самое долгое текущее ожидание: ${interval(d.support_requests.oldest_unacknowledged_seconds)}.`}</p></article><article className="collection-card"><h3>Медиана до связанного ответа</h3><strong>{interval(d.support_requests.median_to_linked_reply_seconds)}</strong><p>Измеренных интервалов: {d.support_requests.linked_reply_intervals}. Сохранение ответа в диалоге не доказывает прочтение или внешнюю доставку.</p></article></div>
    </>}
    </Disclosure>
    <Disclosure title="Опросы, лекарственные отметки и визиты">
    <div className="workflow-section-heading"><h3>Наблюдения между визитами</h3><p>Полнота документирования и самоотчёты пациента; они не подтверждают фактический приём препарата.</p></div>
    <div className="collection-grid workflow-metrics">
      <article className="collection-card"><h3>Опросы к согласованному сроку</h3><strong>{ratio(d.survey_on_time)}</strong><p>Только назначения, срок которых уже наступил. Без срока: {d.survey_on_time.without_due}.</p></article>
      <article className="collection-card"><h3>Документирование лекарственного расписания</h3><strong>{ratio(d.medication.documentation_today)}</strong><p>Наступившие события текущей версии расписания, по местному дню каждой позиции. Это полнота отметок, а не доказанный приём.</p><p>Во всей истории самоотчётов: {d.medication.self_reports}. Сообщили «принял»: {d.medication.statuses.taken ?? 0}, «не принял»: {d.medication.statuses.not_taken ?? 0}, «не могу уточнить»: {d.medication.statuses.unknown ?? 0}, «не требовалось»: {d.medication.statuses.not_applicable ?? 0}.</p></article>
    </div>
    <Disclosure lazy title="Визиты и рекомендованные окна · синтетическая МИС"><div className="collection-card"><p>Состоялись: {d.visits.attended} · явная неявка: {d.visits.no_show} · отмены: {d.visits.cancelled} · переносы: {d.visits.rescheduled}.</p><p>Изменения со стороны клиники: {d.visits.clinic_changed}. Неявки среди известных «состоялся/неявка»: {ratio(d.visits.no_show_fraction)}.</p><p>Контакт в рекомендованном окне: {ratio(d.visits.contact_in_window)}. Незрелые окна: {d.visits.windows_not_mature}; без окна/полных данных: {d.visits.windows_without_data_or_plan}; нет связанного источника: {d.visits.source_missing_patients}.</p><p className="field-hint">Срез МИС: {date(d.mis_snapshot_as_of)}. Отмена и перенос не равны неявке. Эти числа не определяют отказ от лечения.</p></div></Disclosure>
    </Disclosure>
    <p className="field-hint">Текущий срез приложения: {date(d.as_of)}. Синтетические решения и события служат проверке сценариев. Выполненная задача не означает устранённое затруднение; отсутствие ответа не считается отказом или пропуском.</p>
  </>;
}

export function DoctorWorkflowMetrics() {
  const result = useApi<WorkflowValues>("/analytics/care", 15000);
  return <Section title="Действия и проверка результата"><p className="field-hint">Все ваши пациенты, текущий срез. Период во вкладке «Опросы и барьеры» на эти показатели не влияет.</p><ErrorBox message={result.error} retry={result.reload} />{result.loading ? <Loading /> : result.data && <WorkflowValuesView d={result.data} />}</Section>;
}
