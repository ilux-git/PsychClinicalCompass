import type { Choice, Draft, Question } from "./api";

const options = (items: [string,string][]): Choice[] => [...items.map(([id,label]) => ({id,label})), {id: "decline", label: "Не хочу отвечать", exclusive: true}];
const q = (id: string, prompt: string, values: Choice[], dimension: Question["dimension"]): Question => ({id, prompt, kind: "single", required: true, options: values, dimension, minimum: 0, maximum: 10});

export function supportTemplate(): Draft {
  return {title: "Как получается следовать плану?", purpose: "follow_up",
    description: "Черновик анкеты сопровождения. Перед публикацией врач уточняет рекомендацию и период. Это авторская обратная связь, не диагностическая шкала. Любой честный ответ полезен.",
    questions: [
      q("readiness", "Насколько вы готовы попробовать следующий согласованный шаг?", options([["ready","Готов(а)"],["partly","Скорее готов(а), но есть сомнения"],["not_ready","Пока не готов(а)"]]), "readiness"),
      q("understanding", "Насколько вам понятна цель этой рекомендации?", options([["clear","Понятна"],["partly","Понятна частично"],["unclear","Не понятна"],["not_discussed","Мы её не обсуждали"]]), null),
      q("method_fit", "Насколько предложенный способ помощи кажется подходящим лично вам?", options([["yes","Подходит"],["partly","Подходит частично"],["no","Не подходит"],["unknown","Пока не могу оценить"]]), "approach_trust"),
      q("app_help", "Помогает ли приложение в том, что вам сейчас нужно от сопровождения?", options([["yes","Помогает"],["partly","Частично"],["no","Не помогает"],["not_used","Не пользовался(ась)"],["unknown","Пока не могу оценить"]]), "approach_trust"),
      {...q("barriers", "Что мешало выполнять эту конкретную рекомендацию за обсуждаемый период?", [
        {id:"cost", label:"Расходы", analytics_category:"financial"}, {id:"time",label:"Работа / время / расписание", analytics_category:"time"},
        {id:"family",label:"Семейные обстоятельства",analytics_category:"family"},
        ...options([["access","Запись / дорога"],["unclear","Не понятен план"],["digital","Неудобно пользоваться приложением"],
          ["state","Самочувствие / неприятные ощущения"],["method","Не подходит помощь / прошлый опыт"],["privacy","Опасения о приватности"],["other","Другое"]]).map(o => ({...o, analytics_category: o.id === "decline" ? "declined" as const : "other" as const})),
        {id:"none",label:"Ничего не мешало",analytics_category:"none",exclusive:true}, {id:"unknown",label:"Затрудняюсь ответить",analytics_category:"unknown",exclusive:true}
      ], "constraints"), kind: "multiple"},
      q("execution", "Что получилось с этой рекомендацией за обсуждаемый период?", options([["fully","Выполнил(а)"],["partly","Частично"],["not","Не выполнил(а)"],["not_needed","Не требовалось"],["unknown","Не могу оценить"]]), "recommendation_consistency"),
      q("help", "Нужна ли помощь с этим до следующей встречи?", options([["doctor","Да, обсудить с врачом"],["organization","Нужна организационная помощь"],["later","Достаточно следующей встречи"],["no","Сейчас помощь не нужна"]]), null)
    ]};
}
