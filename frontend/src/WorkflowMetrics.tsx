import { useApi } from "./api";
import { ErrorBox, Loading, Section, date } from "./UI";

type Fraction = {numerator: number; denominator: number; percent: number | null};
export type WorkflowValues = {as_of: string; mis_snapshot_as_of: string;
  treatment: {in_progress: number; completed: number; refused: number; unknown: number};
  survey_on_time: Fraction & {without_due: number};
  tasks: {total: number; open: number; action_done: number; with_source: number; verification: Record<string,number>; without_followup_date: number; recheck_coverage: Fraction};
  visits: {attended: number; no_show: number; cancelled: number; rescheduled: number; clinic_changed: number;
    source_missing_patients: number; no_show_fraction: Fraction; contact_in_window: Fraction; windows_not_mature: number; windows_without_data_or_plan: number};
  medication: {self_reports: number; statuses: Record<string,number>; documentation_today: Fraction}};
const ratio = (v: Fraction) => v.denominator ? `${v.numerator} / ${v.denominator} (${v.percent}%)` : "Нет подходящих наблюдений";

export function WorkflowValuesView({d}: {d: WorkflowValues}) {
  return <>
    <div className="collection-grid workflow-metrics">
      <article className="collection-card"><h3>Исходы по решению врача</h3><p>В процессе: <strong>{d.treatment.in_progress}</strong></p><p>Завершили: {d.treatment.completed} · отказались: {d.treatment.refused} · не определено: {d.treatment.unknown}</p></article>
      <article className="collection-card"><h3>Опросы к согласованному сроку</h3><strong>{ratio(d.survey_on_time)}</strong><p>Только назначения, срок которых уже наступил. Без срока: {d.survey_on_time.without_due}.</p></article>
      <article className="collection-card"><h3>Следующие шаги</h3><strong>{d.tasks.action_done} / {d.tasks.total}</strong><p>Действий выполнено / задач. Связаны с источником: {d.tasks.with_source}. Открыты: {d.tasks.open}.</p></article>
      <article className="collection-card"><h3>Повторная проверка</h3><strong>{ratio(d.tasks.recheck_coverage)}</strong><p>Среди задач с наступившим сроком проверки. Без даты: {d.tasks.without_followup_date}. Устранено по проверке врача: {d.tasks.verification.resolved ?? 0}; сохраняется: {d.tasks.verification.not_resolved ?? 0}; результат неясен: {d.tasks.verification.unknown ?? 0}.</p></article>
    </div>
    <div className="dashboard-columns">
      <article className="collection-card"><h3>События визитов · синтетическая МИС</h3><p>Состоялись: {d.visits.attended} · явная неявка: {d.visits.no_show} · отмены: {d.visits.cancelled} · переносы: {d.visits.rescheduled}.</p><p>Изменения со стороны клиники: {d.visits.clinic_changed}. Неявки среди известных «состоялся/неявка»: {ratio(d.visits.no_show_fraction)}.</p><p>Контакт в рекомендованном окне: {ratio(d.visits.contact_in_window)}. Незрелые окна: {d.visits.windows_not_mature}; без окна/полных данных: {d.visits.windows_without_data_or_plan}; нет связанного источника: {d.visits.source_missing_patients}.</p><p className="field-hint">Срез МИС: {date(d.mis_snapshot_as_of)}. Отмена и перенос не равны неявке. Эти числа не определяют отказ от лечения.</p></article>
      <article className="collection-card"><h3>Документирование лекарственного расписания</h3><strong>{ratio(d.medication.documentation_today)}</strong><p>Наступившие события текущей версии расписания, по местному дню каждой позиции. Это полнота отметок, а не доказанный приём.</p><p>Во всей истории самоотчётов: {d.medication.self_reports}. Сообщили «принял»: {d.medication.statuses.taken ?? 0}, «не принял»: {d.medication.statuses.not_taken ?? 0}, «не могу уточнить»: {d.medication.statuses.unknown ?? 0}, «не требовалось»: {d.medication.statuses.not_applicable ?? 0}.</p></article>
    </div>
    <p className="field-hint">Текущий срез приложения: {date(d.as_of)}. Синтетические решения и события служат проверке сценариев. Выполненная задача не означает устранённое затруднение; отсутствие ответа не считается отказом или пропуском.</p>
  </>;
}

export function DoctorWorkflowMetrics() {
  const result = useApi<WorkflowValues>("/analytics/care", 15000);
  return <Section title="От затруднения к действию и исходу"><p className="field-hint">Все ваши пациенты и текущий срез. Фильтр назначений относится к отдельному блоку обратной связи.</p><ErrorBox message={result.error} retry={result.reload} />{result.loading ? <Loading /> : result.data && <WorkflowValuesView d={result.data} />}</Section>;
}
