export const worklistChoices = [
  {id:"active",label:"Нужно выполнить",hint:"Назначенные действия и задачи в работе",empty:"Незавершённых действий нет"},
  {id:"awaiting_check",label:"Проверить результат",hint:"Действие выполнено, отдельная проверка ещё не сохранена",empty:"Ожидающих проверки нет"},
  {id:"checked",label:"Проверенные результаты",hint:"Выводы врача, включая неизвестный результат",empty:"Проверок пока нет"},
  {id:"overdue",label:"Срок прошёл",hint:"Незавершённые действия с известным прошедшим сроком",empty:"Просроченных действий нет"},
  {id:"all",label:"Все этапы",hint:"Все задачи по рабочим этапам",empty:"Задач пока нет"},
] as const;
export type WorklistFocus = typeof worklistChoices[number]["id"];
export const worklistViewKey = "doctor-board-worklist-focus";

/** Only decide whether a deliberately pinned task still belongs to the server's cohort. */
export function taskInWorklist(task:{status:string;verification_status:string;due_at?:string|null},focus:WorklistFocus,asOf:string|undefined) {
  if(focus==="all")return true;
  if(focus==="awaiting_check")return task.status==="done"&&task.verification_status==="pending";
  if(focus==="checked")return task.status==="done"&&["resolved","not_resolved","unknown"].includes(task.verification_status);
  const active=task.status==="open"||task.status==="in_progress";
  if(focus==="active")return active;
  return active&&Boolean(task.due_at)&&Boolean(asOf)&&Date.parse(task.due_at!)<Date.parse(asOf!);
}

export function worklistAfterChange(current:WorklistFocus,change:{stage:string;verification?:string}):WorklistFocus {
  if(current==="all")return current;
  if(change.stage==="done")return ["resolved","not_resolved","unknown"].includes(change.verification??"")?"checked":"awaiting_check";
  return current==="overdue"?current:"active";
}
