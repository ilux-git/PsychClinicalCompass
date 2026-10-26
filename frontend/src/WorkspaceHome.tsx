import { ArrowRight, Bell, CheckCheck, ClipboardCheck, ListTodo, MessageCircle, Users } from "lucide-react";
import { Button, date, ErrorBox, Heading, Loading } from "./UI";
import { useApi } from "./api";
import { verificationProgress } from "./careProgress";
import type { WorkflowValues } from "./WorkflowMetrics";
import { usePrepareViewState } from "./ViewState";
import { worklistViewKey, type WorklistFocus } from "./worklist";
import { Disclosure } from "./Interaction";
import { DoctorEscalationSettings } from "./CoordinatorFallback";

export function WorkspaceHome({navigate}:{navigate:(view:string)=>void}) {
  const workload=useApi<WorkflowValues>("/analytics/care",15000);
  const tasks=workload.data?.tasks;
  const checks=tasks?verificationProgress(tasks):null;
  const prepareView=usePrepareViewState();
  function openWorklist(focus:WorklistFocus) {
    prepareView({"doctor-board-search":"","doctor-board-query":"",[worklistViewKey]:focus,
      "doctor-board-focus":null,"board-doctor-all-pagination":{query:`${focus}:`,cursors:[]}});
    navigate("tasks");
  }
  return <>
    <Heading eyebrow="Рабочий стол врача" title="Рабочий день"/>
    <section className="workspace-workload" aria-labelledby="workspace-workload-title">
      <div className="workspace-workload-heading"><div><h2 id="workspace-workload-title">План сопровождения</h2><p>{workload.data?`Срез на ${date(workload.data.as_of)}`:"Получаем текущий план работы"}</p></div><Button onClick={()=>openWorklist("active")}>Открыть план работы<ArrowRight size={17}/></Button></div>
      <ErrorBox message={workload.error} retry={workload.reload}/>
      {workload.loading?<div className="workspace-workload-loading"><Loading/></div>:tasks&&checks?<>
        <div className="workspace-queue-cards" role="group" aria-label="Выборки плана работы">
          {[
            {focus:"active" as const,title:"Нужно выполнить",count:tasks.open+tasks.in_progress,detail:"Назначено и в работе",icon:ListTodo},
            {focus:"awaiting_check" as const,title:"Проверить результат",count:checks.awaiting,detail:"Действие уже выполнено",icon:ClipboardCheck},
            {focus:"checked" as const,title:"Проверенные результаты",count:checks.checked,detail:`Неизвестный результат: ${checks.unknown}`,icon:CheckCheck},
          ].map(item=><button type="button" className={`workspace-queue-card queue-${item.focus}`} key={item.focus} aria-label={`${item.title}: ${item.count}. ${item.detail}`} onClick={()=>openWorklist(item.focus)}>
            <span className="queue-card-label"><item.icon size={19}/>{item.title}</span><strong>{item.count}</strong><span className="queue-card-detail">{item.detail}<ArrowRight size={17}/></span>
          </button>)}
        </div>
        <p className="workspace-queue-note">{checks.awaiting>0?"После выполненного действия отдельно зафиксируйте, что изменилось для пациента.":tasks.open+tasks.in_progress>0?"Откройте незавершённое действие, найдите его источник и сохраните следующий шаг.":"Незавершённых действий и ожидающих проверок нет. Можно перейти к карточкам пациентов или обращениям."}</p>
      </>:!workload.error&&<p className="field-hint">Сведения о задачах пока не получены.</p>}
      {workload.error&&workload.data&&<p className="field-hint">Обновление не удалось. Показан последний полученный срез.</p>}
    </section>
    <section className="workspace-shortcuts" aria-labelledby="workspace-shortcuts-title">
      <h2 id="workspace-shortcuts-title">Пациенты и обратная связь</h2>
      <div>{[
        {view:"patients",title:"Карточки пациентов",description:"Ответы, состояние, диалог и план сопровождения",icon:Users},
        {view:"events",title:"События и обращения",description:"Исходные сведения и обращения для разбора",icon:Bell},
        {view:"surveys",title:"Опросы для пациентов",description:"Создать, опубликовать и назначить опрос",icon:MessageCircle},
      ].map(item=><button className="workspace-shortcut" key={item.view} onClick={()=>navigate(item.view)}><item.icon size={21}/><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight size={17}/></button>)}</div>
    </section>
    <section className="panel coordination-settings-panel" aria-labelledby="coordination-settings-title">
      <h2 id="coordination-settings-title">Передача срочных уведомлений</h2>
      <p className="field-hint">Выберите резервного координатора для ещё не принятых срочных событий. Он получит ID пациента и организационное уведомление.</p>
      <Disclosure lazy title="Настроить резервный маршрут"><DoctorEscalationSettings/></Disclosure>
    </section>
  </>;
}
