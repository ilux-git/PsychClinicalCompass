import { ArrowRight, Bell, ClipboardCheck, ClipboardList, MessageCircle, Users } from "lucide-react";
import { Button, date, ErrorBox, Heading, Loading } from "./UI";
import { useApi } from "./api";
import { verificationProgress } from "./careProgress";
import type { WorkflowValues } from "./WorkflowMetrics";
import { usePrepareViewState } from "./ViewState";

export function WorkspaceHome({navigate}:{navigate:(view:string)=>void}) {
  const workload=useApi<WorkflowValues>("/analytics/care",15000);
  const tasks=workload.data?.tasks;
  const checks=tasks?verificationProgress(tasks):null;
  const prepareView=usePrepareViewState();
  function openCompleted() {
    prepareView({"doctor-board-search":"","doctor-board-query":"","doctor-board-stage":"done",
      "doctor-board-focus":null,"board-doctor-done-pagination":{query:"",cursors:[]}});
    navigate("tasks");
  }
  return <>
    <Heading eyebrow="Рабочий стол врача" title="Что сейчас требует внимания?">
      От затруднения пациента — к действию и отдельной проверке результата.
    </Heading>
    <section className="workspace-workload" aria-labelledby="workspace-workload-title">
      <div className="workspace-workload-heading"><div><h2 id="workspace-workload-title">Сопровождение ваших пациентов</h2><p>{workload.data?`Срез на ${date(workload.data.as_of)}`:"Получаем текущий план работы"}</p></div><Button variant="ghost" onClick={()=>navigate("tasks")}>Открыть план<ArrowRight size={17}/></Button></div>
      <ErrorBox message={workload.error} retry={workload.reload}/>
      {workload.loading?<div className="workspace-workload-loading"><Loading/></div>:tasks&&checks?<>
        <dl className="workspace-workload-counts">
          <div><dt>Назначено и в работе</dt><dd>{tasks.open+tasks.in_progress}<p>{tasks.open+tasks.in_progress?"Ожидают выполнения":"Незавершённых действий нет"}</p></dd></div>
          <div className={checks.awaiting>0?"needs-check":""}><dt>Ждут проверки врача</dt><dd>{checks.awaiting}<p>Из {tasks.action_done} выполненных действий</p></dd></div>
          <div><dt>Результат зафиксирован</dt><dd>{checks.checked}<p>В том числе неизвестный: {checks.unknown}</p></dd></div>
        </dl>
        <div className="workspace-workload-next"><ClipboardCheck size={19}/><p>{checks.awaiting>0?<>Факт выполненного действия уже сохранён. Теперь проверьте результат для пациента — он фиксируется отдельно.</>:<>Можно перейти к обратной связи пациента и запланировать следующий шаг. Эти числа описывают работу по задачам и не определяют результат лечения.</>}</p>{checks.awaiting>0&&<Button variant="secondary" onClick={openCompleted}>Открыть выполненные<ArrowRight size={16}/></Button>}</div>
      </>:!workload.error&&<p className="field-hint">Сведения о задачах пока не получены.</p>}
      {workload.error&&workload.data&&<p className="field-hint">Обновление не удалось. Выше показан последний полученный срез.</p>}
    </section>
    <section className="workspace-start" aria-labelledby="workspace-start-title">
      <span className="workspace-start-icon" aria-hidden="true"><Users size={26}/></span>
      <div><p className="eyebrow">Основной маршрут</p><h2 id="workspace-start-title">Начните с карточки пациента</h2><p>Ответы на опросы, состояние, переписка и план сопровождения собраны в одной карточке.</p></div>
      <Button onClick={()=>navigate("patients")}>Открыть пациентов<ArrowRight size={17}/></Button>
    </section>
    <ol className="workspace-path" aria-label="Как проходит работа с пациентом">
      <li><span>1</span><div><strong>Выберите пациента</strong><p>Откройте его карточку из списка.</p></div></li>
      <li><span>2</span><div><strong>Посмотрите, что происходит</strong><p>Найдите исходный ответ, обращение или измерение.</p></div></li>
      <li><span>3</span><div><strong>Сохраните следующий шаг</strong><p>В плане назначьте действие и затем проверьте результат.</p></div></li>
    </ol>
    <section className="workspace-shortcuts" aria-labelledby="workspace-shortcuts-title">
      <h2 id="workspace-shortcuts-title">Или перейдите к своей задаче</h2>
      <div>{[
        {view:"events",title:"Разобрать обращения",description:"Открыть события и посмотреть их источник",icon:Bell},
        {view:"tasks",title:"Продолжить работу по плану",description:"Найти поручение или проверить выполненное действие",icon:ClipboardList},
        {view:"surveys",title:"Задать вопросы пациентам",description:"Выбрать или создать опрос и назначить его",icon:MessageCircle},
      ].map(item=><button className="workspace-shortcut" key={item.view} onClick={()=>navigate(item.view)}><item.icon size={21}/><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight size={17}/></button>)}</div>
    </section>
  </>;
}
