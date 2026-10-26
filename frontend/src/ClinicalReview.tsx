import type { ClinicalComparison, ClinicalTriage, ReviewTiming } from "./api";
import { Badge, date } from "./UI";
import "./clinical-instruments.css";

export const reviewLabels:Record<string,string>={urgent_review:"Срочная оценка врача",review_required:"Разбор врачом",needs_clarification:"Уточнить ответ",no_signal:"Результат сохранён"};
export const clinicalDate=(value:string|null|undefined)=>value?new Date(value).toLocaleString("ru-RU",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"Дата неизвестна";

function Comparison({label,value,empty}: {label:string;value:ClinicalComparison;empty:string}) {
  return <div><dt>{label}</dt><dd>{value.result_id===null?empty:<>
    {value.score} балл. от {clinicalDate(value.created_at)} · изменение <strong>{value.delta!==null&&value.delta>0?"+":""}{value.delta} балл.</strong>
  </>}</dd></div>;
}

export function ClinicalReviewSummary({review}: {review:ClinicalTriage|undefined}) {
  if(!review)return <p className="field-hint">Для этой исторической записи правила организации разбора не рассчитывались. Исходный результат сохранён.</p>;
  return <div className="clinical-review-summary">
    <Badge tone={review.severity==="urgent_review"?"warn":undefined}>{reviewLabels[review.severity]??"Оценка врача"}</Badge>
    {review.grounds.length>0?<><h4>Основания для разбора</h4><ul>{review.grounds.map(item=><li key={item.code}>{item.label}</li>)}</ul></>:
      <p>По согласованным правилам основание для отдельного события не выявлено. Общий клинический риск этим расчётом не оценивается.</p>}
    {(review.comparison_previous||review.comparison_baseline)&&<dl className="clinical-comparisons">
      {review.comparison_previous&&<Comparison label="Сравнение с предыдущим" value={review.comparison_previous} empty="Предыдущего измерения этой версии нет"/>}
      {review.comparison_baseline&&<Comparison label="Сравнение с исходным" value={review.comparison_baseline} empty="Исходное измерение врач ещё не выбрал"/>}
    </dl>}
    {review.action_label&&<p><strong>Действие врача:</strong> {review.action_label}{review.action_due_hours!==null?` · в течение ${review.action_due_hours} ч от получения результата`:""}.</p>}
    {review.advisory.map(text=><p key={text} className="field-hint">{text}</p>)}
    {review.missing_data.length>0&&<details className="source-help"><summary>Что ещё нужно учесть</summary><ul>{review.missing_data.map(text=><li key={text}>{text}</li>)}</ul></details>}
    <p className="field-hint">Правила организации разбора — ответы врача от 26.10.2026. Решение и медицинское действие фиксирует врач.</p>
  </div>;
}

export function ReviewDeadlines({timing}: {timing:ReviewTiming|undefined}) {
  if(!timing||(!timing.acknowledgement_due_at&&!timing.action_due_at&&!timing.action_completed_at))return null;
  return <div className="review-deadlines">
    <dl className="clinical-comparisons">
      {timing.acknowledgement_due_at&&<div><dt>Принять уведомление до</dt><dd>{date(timing.acknowledgement_due_at)}{timing.acknowledgement_state==="overdue"&&<Badge tone="warn">Срок принятия истёк</Badge>}{timing.acknowledgement_state==="late"&&<Badge tone="warn">Принято позже срока</Badge>}{timing.acknowledgement_state==="accepted"&&<Badge tone="good">Принято</Badge>}</dd></div>}
      {timing.action_due_at&&<div><dt>Выполнить медицинское действие до</dt><dd>{date(timing.action_due_at)}{timing.action_overdue&&<Badge tone="warn">Действие просрочено</Badge>}</dd></div>}
      {timing.acknowledgement_due_at&&!timing.action_due_at&&<div><dt>Срок медицинского действия</dt><dd>Врач задаёт при планировании. Срок принятия уведомления не заменяет этот срок.</dd></div>}
      {timing.action_completed_at&&<div><dt>Действие записано в связанной задаче</dt><dd>{date(timing.action_completed_at)}</dd></div>}
    </dl>
    <p className="field-hint">{timing.acknowledgement_due_at?"Принятие уведомления за 2 часа не означает контакта с пациентом. ":""}Срок медицинского действия отсчитывается от результата; проверка эффекта выполняется после действия.</p>
  </div>;
}
