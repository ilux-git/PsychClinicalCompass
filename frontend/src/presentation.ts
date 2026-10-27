/** Display-only wording for factory fixtures. Stored source data and API states stay intact. */
export function accountName(name:string) {
  if(name==="Администратор демо")return "Администратор";
  if(name==="Координатор демо")return "Координатор";
  return name;
}

export function surveyDescription(description:string) {
  return description==="Синтетический пример обратной связи. Не диагностическая шкала."
    ?"Обратная связь о сопровождении. Не диагностическая шкала.":description;
}

export function surveyTitle(title:string) {
  return title==="Демо: четыре направления сопровождения"?"Четыре направления сопровождения":title;
}

/** The complete simulator/discount disclosure is retained in AccountSettings and README. */
export function participationPrinciples(principles:string[]) {
  return principles.filter(value=>value!=="Обмен на скидочный купон — симуляция. Реальная скидка, цена приёма и оплата в клинике не меняются."
    &&value!=="Тариф предложен для демо; прежние записи не пересчитываются.");
}
