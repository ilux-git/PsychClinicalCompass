import type { Assessment, Assignment, Question } from "./api";

export const motivationModes:Record<string,string>={map:"Карта маленьких шагов",rhythm:"Мой ритм",calm:"Спокойный режим"};

export type MotivationPreference = {patient_choice:string|null; doctor_recommendation:string|null; effective_mode:string};
export type DiscountOffer = {id:string; title:string; points:number; discount_percent:number};
export type PointsRule = {kind:string; label:string; daily_cap:number; earned_today:number; description:string};
export type ParticipationPoints = {
  balance:number; earned_total:number; reserved_points:number; catalog_version:string;
  preference:MotivationPreference; offers:DiscountOffer[];
  coupons:{id:number; code:string; points:number; discount_percent:number; status:string; created_at:string; simulated:boolean}[];
  rules:PointsRule[];
  history:{id:number; kind:string; points:number; created_at:string; policy_version:string}[];
  activity:{day:string; actions:number; points:number}[]; principles:string[]; next_reset_at:string;
};
export type PatientCareProgress = {
  as_of:string;
  treatment:{status:"unknown"|"in_progress"|"completed"|"refused"; recorded_at:string|null};
  visits:{status:string; source:string; synthetic:boolean; source_as_of:string|null;
    known_completed_count:number|null; latest_completed_at:string|null; next_scheduled_at:string|null; has_undated_visits:boolean};
};

/** A coupon uses spendable balance; lifetime points belong only to the participation map. */
export function discountProgress(points:Pick<ParticipationPoints,"balance">, offer:DiscountOffer) {
  const available=Math.max(0,points.balance);
  return {available, remaining:Math.max(0,offer.points-available),
    value:Math.min(available,offer.points), maximum:offer.points, canExchange:available>=offer.points};
}

/** This is an upper bound, including optional items, never a promised award. */
export function surveyRewardEstimate(questions:Pick<Question,"kind">[], rule:PointsRule|undefined):number|null {
  if (!rule) return null;
  const effort=questions.reduce((sum,question)=>sum+(question.kind==="text"?2:1),0);
  return Math.max(0,Math.min(effort,rule.daily_cap-rule.earned_today));
}

export function pendingSurveys(assignments:Assignment[]) {
  return assignments.filter(assignment=>!assignment.submission).sort((a,b)=>
    Number(Boolean(b.draft_updated_at))-Number(Boolean(a.draft_updated_at)) ||
    (a.due_at?Date.parse(a.due_at):Infinity)-(b.due_at?Date.parse(b.due_at):Infinity) ||
    Date.parse(a.created_at)-Date.parse(b.created_at) || a.id-b.id);
}

/** Pick the most recent version, then compare only observations from that version. */
export function latestAssessmentSeries(rows:Assessment[], form:"phq9"|"gad7") {
  const ordered=rows.filter(row=>row.form_type===form&&Number.isFinite(Date.parse(row.created_at)))
    .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id);
  const latest=ordered.at(-1);
  if (!latest) return null;
  const points=ordered.filter(row=>row.form_version===latest.form_version);
  const first=points[0];
  return {version:latest.form_version, points, latest, first,
    change:Date.parse(latest.created_at)>Date.parse(first.created_at)?latest.score-first.score:null,
    maximum:form==="phq9"?27:21};
}
