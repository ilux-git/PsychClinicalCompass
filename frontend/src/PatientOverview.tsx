import { useRef, useState } from "react";
import { Activity, ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, ClipboardCheck, Gift, MessageCircle, Pill } from "lucide-react";
import { useApi, type Assignment, type Assessment, type Card, type User } from "./api";
import { Badge, Button, date, ErrorBox, Heading, Loading, plural, Section, type Notify } from "./UI";
import { ContentFrame, Disclosure } from "./Interaction";
import { TimeSeries } from "./Charts";
import { PatientRewardSummary } from "./PatientJourney";
import { AtlasScene } from "./PatientAdventure";
import { discountProgress, latestAssessmentSeries, pendingSurveys, surveyRewardEstimate, type ParticipationPoints, type PatientCareProgress } from "./patientProgress";
import "./patient-home.css";

type Resource<T> = ReturnType<typeof useApi<T>>;
const treatmentText = {
  unknown:{title:"Статус пока не указан",description:"Уточните план на следующей встрече или в сообщении врачу."},
  in_progress:{title:"Лечение продолжается",description:"Следующие шаги вы определяете вместе с врачом."},
  completed:{title:"Врач отметил завершение лечения",description:"История остаётся доступной. Дальнейшие встречи обсудите с врачом."},
  refused:{title:"Врач отметил остановку лечения",description:"Если хотите обсудить продолжение или уточнить запись, напишите врачу."},
};

function CareSummary({result, completed, assigned, navigate}: {
  result:Resource<PatientCareProgress>; completed:number|null; assigned:number|null; navigate:(view:string)=>void;
}) {
  const data=result.data;
  const treatment=data?treatmentText[data.treatment.status]:null;
  return <section className="patient-care-summary" aria-labelledby="care-summary-title">
    <div className="care-summary-intro"><div><p className="eyebrow">Моё лечение</p><h2 id="care-summary-title">{treatment?.title??(result.loading?"Получаем план сопровождения…":"План сопровождения недоступен")}</h2>
      <p>{treatment?.description??"Здесь появятся сведения от врача и известные даты встреч."}</p>
      {data?.treatment.recorded_at&&<small>По записи врача от {date(data.treatment.recorded_at)}.</small>}</div>
      <Button variant="ghost" onClick={()=>navigate("chat")}><MessageCircle size={16}/>Связаться с врачом</Button></div>
    <ErrorBox message={result.error} retry={result.reload}/>
    {result.error&&data&&<p className="field-hint">Показаны последние полученные сведения; обновить их пока не удалось.</p>}
    {result.loading?<div className="care-summary-loading"><Loading/></div>:<dl className="care-facts">
      <div><dt><CalendarDays size={16}/>Встречи с врачом</dt><dd>{data?.visits.known_completed_count==null?"Нет данных":`${data.visits.known_completed_count} в доступной истории`}
        <p>{data?.visits.latest_completed_at?`Последняя: ${date(data.visits.latest_completed_at)}`:data?.visits.known_completed_count===0?"В снимке пока нет состоявшихся встреч":"Дата последней встречи неизвестна"}</p></dd></div>
      <div><dt><CalendarDays size={16}/>Следующая известная запись</dt><dd>{data?.visits.next_scheduled_at?date(data.visits.next_scheduled_at):data?.visits.status==="available"?"Дата не указана":"Нет данных"}<p>Уточнить встречу можно у врача</p></dd></div>
      <div><dt><ClipboardCheck size={16}/>Ответы для врача</dt><dd>{completed===null?"Нет данных":`${completed} ${plural(completed,"опрос отправлен","опроса отправлено","опросов отправлено")}`}
        <p>{assigned===null?"Список назначений ещё не получен":assigned===0?"Назначенных опросов пока нет":`Из ${assigned} назначенных за всё время`}</p></dd></div>
    </dl>}
    {data&&<p className="care-source-note">{data.visits.synthetic?"Встречи: учебный снимок МИС":"Встречи: МИС"}{data.visits.source_as_of?` от ${date(data.visits.source_as_of)}`:""}. {data.visits.status!=="available"?"Источник встреч не связан или недоступен. ":""}{data.visits.has_undated_visits?"Некоторые даты встреч требуют уточнения. ":""}Это сведения о сопровождении; количество действий не определяет результат лечения. Время — на вашем устройстве.</p>}
  </section>;
}

function StatePreview({result, navigate}: {result:Resource<Assessment[]>; navigate:(view:string)=>void}) {
  return <Section title="Как меняется моё состояние" aside={<Button variant="ghost" onClick={()=>navigate("state")}>Вся история<ArrowRight size={16}/></Button>}>
    <p className="patient-state-intro">Здесь — сохранённые измерения. Их можно обсудить с врачом; баллы за участие от результатов не зависят.</p>
    <ErrorBox message={result.error} retry={result.reload}/>
    {result.error&&result.data&&<p className="field-hint">История не обновилась. Показаны последние полученные измерения.</p>}
    {result.loading?<Loading/>:result.data&&<div className="patient-state-grid">{(["phq9","gad7"] as const).map(form=>{
      const series=latestAssessmentSeries(result.data!,form);
      const title=form==="phq9"?"Депрессивные симптомы · PHQ-9":"Тревожные симптомы · GAD-7";
      return <article className="patient-state-item" key={form}><h3>{title}</h3>{series?<>
        <div className="patient-state-value"><strong>{series.latest.score}<span> / {series.maximum}</span></strong><span>{date(series.latest.created_at)}</span></div>
        <Badge>{series.version==="demo_numeric_v1"?"Учебные измерения":`Версия ${series.version}`}</Badge>
        <TimeSeries title={form==="phq9"?"PHQ-9 · сохранённые измерения":"GAD-7 · сохранённые измерения"} maximum={series.maximum}
          points={series.points.map(row=>({id:row.id,at:row.created_at,value:row.score}))}/>
        <p className="field-hint">{series.change===null?"Для сравнения нужны измерения одной версии в разные даты.":`От первого измерения этой версии (${date(series.first.created_at)}): ${series.change>0?"+":""}${series.change} балл. Изменение само по себе не определяет эффект лечения.`}</p>
      </>:<div className="patient-state-empty"><Activity size={22}/><p>Измерений этой шкалы пока нет.</p><small>Периодичность и подходящие опросники определяет врач. Отсутствие ответа не означает нулевой результат.</small></div>}</article>;
    })}</div>}
    <p className="field-hint">Шкалы и версии показаны отдельно. График не устанавливает диагноз и не заменяет оценку врача.</p>
  </Section>;
}

export function PatientOverview({user, assignments, doctor, doctorError, retryDoctor, openSurvey, navigate, notify}: {
  user:User; assignments:Resource<Assignment[]>; doctor:Card["doctor"]|undefined; doctorError:string; retryDoctor:()=>void;
  openSurvey:(assignment:Assignment)=>void; navigate:(view:string)=>void; notify:Notify;
}) {
  const points=useApi<ParticipationPoints>("/participation/points",15000);
  const care=useApi<PatientCareProgress>("/participation/care-progress",15000);
  const state=useApi<Assessment[]>(`/patients/${user.patient_id}/assessments`,15000);
  const [choice,setChoice]=useState("survey");
  const stepTitle=useRef<HTMLHeadingElement>(null);
  const pending=pendingSurveys(assignments.data??[]);
  const completed=assignments.data?.filter(assignment=>assignment.submission)
    .sort((a,b)=>Date.parse(b.submission!.created_at)-Date.parse(a.submission!.created_at)||b.id-a.id);
  const next=pending[0];
  const rule=(kind:string)=>points.data?.rules.find(item=>item.kind===kind);
  const surveyAward=next?surveyRewardEstimate(next.survey.questions,rule("survey")):null;
  const chosen=choice==="survey"&&!next?"diary":choice;
  const alternatives=[{id:"survey",label:"Опрос врача",icon:ClipboardCheck},
    {id:"diary",label:"Записать самочувствие",icon:BookOpen},
    {id:"medications",label:"Моё расписание",icon:Pill}];
  const dayRule=rule(chosen==="medications"?"medication":"diary");
  const dayAward=dayRule?Math.max(0,dayRule.daily_cap-dayRule.earned_today):null;
  const firstOffer=points.data?[...points.data.offers].sort((a,b)=>a.points-b.points)[0]:null;
  const discount=points.data&&firstOffer?discountProgress(points.data,firstOffer):null;
  function chooseAction(value:string) {
    setChoice(value);
    requestAnimationFrame(()=>{stepTitle.current?.focus({preventScroll:true});stepTitle.current?.scrollIntoView({block:"center"});});
  }

  return <div className="patient-overview" data-mode={points.data?.preference.effective_mode}>
    <Heading eyebrow="Мой день" title={`Здравствуйте, ${user.display_name.split(" ")[0]}`}>Ваши шаги, встречи и самочувствие — в одном месте.</Heading>
    <p className="patient-care-status"><CalendarDays size={16}/><span>Моё лечение · {care.data?treatmentText[care.data.treatment.status].title:care.loading?"получаем сведения врача…":"сведения врача пока недоступны"}</span></p>
    <button className="patient-mobile-reward" onClick={()=>navigate("journey")}>{points.data?.preference.effective_mode==="map"&&<span className="patient-ticket-art" aria-hidden="true"><AtlasScene earned={points.data.earned_total}/></span>}<Gift size={20}/><span><strong>{points.data?`${points.data.balance} ${plural(points.data.balance,"балл","балла","баллов")} доступно`:points.loading?"Получаем баллы…":"Баллы пока недоступны"}</strong><small>{discount&&firstOffer?discount.canExchange?`Можно выбрать тестовую скидку ${firstOffer.discount_percent}%`:`Ещё ${discount.remaining} ${plural(discount.remaining,"балл","балла","баллов")} до тестовых ${firstOffer.discount_percent}%`:"Баллы и условия тестовых скидок"}</small></span><ChevronRight size={18}/></button>
    <div className="patient-home-grid">
      <section className="patient-next-step" aria-labelledby="patient-next-title">
        <div className="patient-next-heading"><span className="patient-step-icon"><ClipboardCheck size={20}/></span><div><p className="eyebrow">Один небольшой шаг</p><p className="patient-next-caption">Выберите то, что сейчас вам по силам.</p></div></div>
        <ErrorBox message={assignments.error} retry={assignments.reload}/>
        {assignments.error&&assignments.data&&<p className="field-hint">Не удалось обновить назначения. Перед отправкой сервер проверит актуальность опроса.</p>}
        {assignments.loading?<div className="patient-step-loading"><h2 id="patient-next-title">Получаем следующие действия…</h2><Loading/></div>:<>
          <div className="patient-step-detail">
            <ContentFrame key={chosen}>
            {chosen==="survey"&&next?<><span className="patient-step-origin">Ваш врач: {doctor?.name??"имя пока недоступно"}</span><h2 id="patient-next-title" ref={stepTitle} tabIndex={-1}>{next.survey.title}</h2><p>{next.survey.description||"Ваши ответы помогут врачу обсудить, что получается и какая поддержка нужна."}</p>
              <Button onClick={()=>openSurvey(next)}>{next.draft_updated_at?"Продолжить опрос":"Ответить врачу"}<ArrowRight size={17}/></Button>
              <div className="patient-step-meta"><span>{next.survey.questions.length} {plural(next.survey.questions.length,"вопрос","вопроса","вопросов")}</span><span>{next.due_at?`Срок врача: ${date(next.due_at)}`:"Без указанного срока"}</span>{next.draft_updated_at&&<span>Черновик сохранён</span>}</div>
              <p className="patient-step-reward">{surveyAward===null?"Баллы за заполненные пункты будут рассчитаны при отправке.":surveyAward===0?"Лимит баллов за опросы на сегодня достигнут. Отправить ответы можно и сейчас.":`До +${surveyAward} ${plural(surveyAward,"балла","баллов","баллов")} за заполненные пункты. Содержание ответа на награду не влияет.`}</p>
            </>:chosen==="medications"?<><span className="patient-step-origin">Личный учёт</span><h2 id="patient-next-title" ref={stepTitle} tabIndex={-1}>Отметить, как получается следовать расписанию</h2><p>Если у вас уже есть расписание, можно указать, что приём состоялся, не состоялся или вы не можете уточнить. Честная отметка поможет обсудить затруднения с врачом.</p>
              <Button onClick={()=>navigate("medications")}>Открыть расписание<ArrowRight size={17}/></Button>
              <p className="patient-step-reward">{dayAward===null?"Баллы начисляются за ведение расписания независимо от содержания отметки.":dayAward===0?"Баллы за ведение расписания сегодня уже начислены. Новые отметки всё равно доступны.":`+${dayAward} балла за день ведения расписания. Число лекарств и ответ не увеличивают награду.`}</p>
            </>:<><span className="patient-step-origin">По желанию</span><h2 id="patient-next-title" ref={stepTitle} tabIndex={-1}>Записать самочувствие</h2><p>Опишите состояние или напишите несколько слов. Запись будет личной; поделиться с врачом можно позже.</p>
              <Button onClick={()=>navigate("diary")}>Открыть дневник<ArrowRight size={17}/></Button>
              <p className="patient-step-reward">{dayAward===null?"За запись можно получить баллы; личная и открытая врачу запись равноправны.":dayAward===0?"Баллы за дневник сегодня уже начислены. Сохранять важное можно и дальше.":`+${dayAward} балла за запись в этот день. Самочувствие и доступ врача не меняют награду.`}</p>
            </>}
            </ContentFrame>
          </div>
          <Disclosure title="Выбрать другое действие"><p className="field-hint">Дневник добровольный. Весь список за один день выполнять не требуется.</p><div className="patient-step-options" role="group" aria-label="Выбрать действие">{alternatives.filter(item=>item.id!=="survey"||Boolean(next)).map(item=><button type="button" aria-pressed={chosen===item.id} className={chosen===item.id?"selected":""} key={item.id} onClick={()=>chooseAction(item.id)}><item.icon size={16}/>{item.label}</button>)}</div></Disclosure>
        </>}
        <div className="patient-step-footer"><span>{assignments.data?next?`${pending.length} ${plural(pending.length,"опрос ждёт ответа","опроса ждут ответа","опросов ждут ответа")}`:"Новых опросов от врача пока нет":"Статус опросов пока неизвестен"}</span><Button variant="ghost" onClick={()=>navigate("surveys")}>Все опросы<ChevronRight size={16}/></Button></div>
        <div className="patient-support-link"><MessageCircle size={18}/><div><strong>Трудно выполнять план или заполнять приложение?</strong><p>Это можно обсудить с врачом при любом балансе.</p></div><Button variant="secondary" onClick={()=>navigate("chat")}>Написать</Button></div>
        <ErrorBox message={doctorError} retry={retryDoctor}/>
      </section>
      <PatientRewardSummary result={points} notify={notify} navigate={navigate}/>
    </div>
    <CareSummary result={care} completed={completed?.length??null} assigned={assignments.data?.length??null} navigate={navigate}/>
    <StatePreview result={state} navigate={navigate}/>
    <Disclosure title={`Что уже сохранено${completed?` · ${completed.length} ${plural(completed.length,"опрос","опроса","опросов")}`:""}`}>
      <p className="field-hint">Сохранённые ответы доступны вам и лечащему врачу. Они не исчезают при паузе в использовании приложения.</p>
      {completed?.length?completed.slice(0,3).map(assignment=><button className="completed-survey" key={assignment.id} onClick={()=>openSurvey(assignment)}><span className="completed-check"><Check size={17}/></span><div><strong>{assignment.survey.title}</strong><small>{date(assignment.submission?.created_at)}</small></div><ChevronRight size={18}/></button>):<p className="muted">{completed?"Отправленных опросов пока нет.":"История опросов пока не получена."}</p>}
      <Button variant="ghost" onClick={()=>navigate("surveys")}>Открыть историю ответов<ArrowRight size={16}/></Button>
    </Disclosure>
  </div>;
}
