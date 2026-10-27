import type {ClinicalTriage} from "./api";

export type ClinicalGuidance = {
  code:string;
  category:"required"|"recommended";
  title:string;
  description:string;
  conditional?:boolean;
};

/** Physician answers, 26.10.2026. Priority describes an action, not a diagnosis. */
export function clinicalGuidance(review:ClinicalTriage):ClinicalGuidance[] {
  const current=review.rule_version==="medical_alerts_20261027_v2"&&review.source==="physician_alerts_2026-10-27";
  if(!current&&(review.rule_version!=="medical_answers_20261026_v1"||review.source!=="medical_answers_2026-10-26"))return [];
  const codes=new Set(review.grounds.map(ground=>ground.code));
  const rows:ClinicalGuidance[]=[];
  if(codes.has("phq9_above_15")||codes.has("gad7_high"))rows.push({
    code:"doctor_contact",category:"required",title:"Связаться с пациентом",
    description:"Высокий результат требует контакта и оценки врача. Принятие уведомления не заменяет контакт; действие и его результат фиксируются отдельно.",
  });
  else if(codes.has("gad7_medium"))rows.push({
    code:"doctor_contact",category:"recommended",title:"Связаться с пациентом",
    description:"При среднем результате GAD-7 врач рекомендует обсудить состояние с пациентом. Срок медицинского действия определяет врач.",
  });
  if(codes.has("phq9_item9_positive"))rows.push({
    code:"item9_clarification",category:current?"required":"recommended",title:"Уточнить ответ на вопрос 9",
    description:current?"Срочно связаться с пациентом и уточнить состояние. Положительный ответ сам по себе не подтверждает непосредственную угрозу жизни.":"Связаться с пациентом желательно в течение 12–24 часов. Положительный ответ сам по себе не подтверждает непосредственную угрозу жизни.",
  });
  if(codes.has("phq9_growth_10"))rows.push({
    code:"psychiatry_review",category:"recommended",title:"Рассмотреть направление к психиатру",conditional:true,
    description:"Если врач подтвердит прогрессирование состояния или отсутствие эффекта лечения. Рост суммы опросника требует оценки и сам по себе не доказывает неэффективность терапии. Направление подтверждает врач.",
  });
  return rows;
}
