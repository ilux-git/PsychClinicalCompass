export const dimensionLabels = {
  readiness: "Заинтересованность · готовность прикладывать усилия",
  approach_trust: "Лояльность · доверие подходу",
  constraints: "Ограничения и препятствия",
  recommendation_consistency: "Организованность · выполнение рекомендаций",
};
export type Dimension = keyof typeof dimensionLabels;
export const barrierLabels = {
  financial: "Финансовые", time: "Время и расписание", family: "Семейные",
  other: "Другие", none: "Пациент прямо указал отсутствие ограничений",
  unknown: "Пациент затрудняется уточнить", declined: "Пациент отказался отвечать",
};
export type BarrierCategory = keyof typeof barrierLabels;

export const elapsed = (value: number | null) => {
  if (value === null) return "Нет данных";
  if (value < 60) return `${Math.round(value)} с`;
  if (value < 3600) return `${(value / 60).toLocaleString("ru-RU", {maximumFractionDigits: 1})} мин`;
  return `${(value / 3600).toLocaleString("ru-RU", {maximumFractionDigits: 1})} ч`;
};
