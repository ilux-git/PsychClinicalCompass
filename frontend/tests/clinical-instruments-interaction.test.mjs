// Patient branching and clinical/legacy separation, exercised through the actual components.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Assigned,History,Baseline,Inbox,PatientHome,Builder,EventAction,Guard,Interactions,render,screen,within,waitFor,cleanup,fireEvent,userEvent,unexpected;
const stamp="2026-10-26T10:00:00Z";
const question=(id,prompt,gate=false)=>({id,prompt,kind:"single",required:true,options:[{id:"n0",label:"Нет"},{id:"n1",label:"Да"}],minimum:0,maximum:1,...(gate?{show_if:{question_id:"q1",equals:"n1"}}:{})});
const definition={key:"panic-v1",name:"PHQ · панические атаки",version:"КР 456_3, Г3 · v1",instructions:"Вопросы о последнем приступе",source_title:"Бланк врача",source_url:"https://cr.minzdrav.gov.ru/view-cr/456_3",source_check:"Предоставлен врачом",license:"Демонстрационный прототип",license_url:null,limitation:"Скрининг не является диагнозом",maximum:null,
  questions:[question("q1","Были ли приступы?"),question("q2","Были ли подобные приступы прежде?",true)]};
const assignment={id:31,patient_id:2,status:"assigned",due_at:null,created_at:stamp,first_opened_at:null,submission:null,
  survey:{id:8,title:definition.name,description:definition.instructions,purpose:"clinical",version:1,previous_version_id:null,published_at:stamp,questions:definition.questions,clinical_instrument:definition}};
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLInputElement","HTMLTextAreaElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"])
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;}observe(target){this.callback([{target,isIntersecting:true}],this);}disconnect(){}};
  globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;}observe(){this.callback([{contentRect:{width:600}}]);}disconnect(){}};
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,within,waitFor,cleanup,fireEvent}=await import("@testing-library/react"));({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({AssignedSurvey:Assigned}=await server.ssrLoadModule("/src/PatientSurvey.tsx"));({ClinicalHistory:History}=await server.ssrLoadModule("/src/ClinicalHistory.tsx"));
  ({ClinicalBaseline:Baseline}=await server.ssrLoadModule("/src/ClinicalBaseline.tsx"));({DoctorInbox:Inbox}=await server.ssrLoadModule("/src/DoctorInbox.tsx"));
  ({PatientHome}=await server.ssrLoadModule("/src/Patient.tsx"));({SurveyBuilder:Builder}=await server.ssrLoadModule("/src/SurveyBuilder.tsx"));
  ({EventAction}=await server.ssrLoadModule('/src/EventAction.tsx'));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"No unlisted clinical request is allowed");});
after(async()=>{await server?.close();dom?.window.close();});

test("changing the panic gate clears hidden symptoms and submits only the actual first answer",async()=>{
  unexpected=[];const writes=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(path==="/survey-assignments/31/draft"&&method==="GET")return Response.json({answers:{},revision:0,updated_at:null,already_completed:false});
    if(path==="/survey-assignments/31/open"&&method==="POST")return Response.json({assignment_id:31,first_opened_at:stamp});
    if(path==="/survey-assignments/31/submit"&&method==="POST"){
      writes.push(JSON.parse(options.body));return Response.json({id:92,assignment_id:31,created_at:stamp,replayed:false,participation:null});
    }
    unexpected.push({path,method});return Response.json({detail:"Unexpected request"},{status:500});
  };
  render(h(Interactions,null,h(Guard,null,h(Assigned,{assignment,done:()=>{},notify:()=>{}}))));
  const user=userEvent.setup({document:dom.window.document});
  const first=await screen.findByRole("group",{name:/Были ли приступы/});
  assert.equal(screen.queryByRole("group",{name:/подобные приступы/}),null);
  await user.click(within(first).getByRole("radio",{name:"Да"}));
  let second=screen.getByRole("group",{name:/подобные приступы/});
  await user.click(within(second).getByRole("radio",{name:"Да"}));
  await user.click(within(first).getByRole("radio",{name:"Нет"}));
  assert.equal(screen.queryByRole("group",{name:/подобные приступы/}),null);
  await user.click(within(first).getByRole("radio",{name:"Да"}));
  second=screen.getByRole("group",{name:/подобные приступы/});
  assert.ok(within(second).getAllByRole("radio").every(radio=>!radio.checked));
  await user.click(within(first).getByRole("radio",{name:"Нет"}));
  await user.click(screen.getByRole("button",{name:"Отправить врачу",exact:true}));
  await screen.findByRole("heading",{name:"Ответы отправлены"});
  assert.deepEqual(writes,[{answers:{q1:"n0"},expected_draft_revision:0}]);
});

test("numeric zero stays visible without inventing a trend from one answer; panic has no zero severity",async()=>{
  unexpected=[];
  const phq={...definition,key:"phq9-v1",name:"PHQ-9 · депрессивные симптомы",maximum:27};
  const rows=[
    {id:1,patient_id:2,submission_id:10,instrument_key:phq.key,definition:phq,score:0,created_at:stamp,answers:{q1:"n0"},result:{kind:"sum",maximum:27,item9_positive:false}},
    {id:2,patient_id:2,submission_id:11,instrument_key:definition.key,definition,score:null,created_at:stamp,answers:{q1:"n0"},result:{kind:"panic_screen",criterion_met:false,screen_stopped:true,gates_yes:null,symptoms_yes:null}},
  ];
  globalThis.fetch=async(path,options={})=>{
    if(path==="/patients/2/clinical-results"&&(options.method??"GET")==="GET")return Response.json(rows);
    unexpected.push({path,method:options.method??"GET"});return Response.json({detail:"Unexpected request"},{status:500});
  };
  render(h(History,{patientId:2}));
  await screen.findByRole("heading",{name:"PHQ-9 · депрессивные симптомы"});
  assert.equal(document.querySelectorAll('.clinical-edition').length,2);
  const sections=[...document.querySelectorAll('.clinical-edition')];
  const phqSection=sections.find(section=>section.querySelector('h3').textContent===phq.name);
  const panicSection=sections.find(section=>section.querySelector('h3').textContent===definition.name);
  assert.match(phqSection.textContent,/0 \/ 27/);
  assert.match(panicSection.textContent,/Критерий скрининга не выполнен/);
  assert.doesNotMatch(panicSection.textContent,/0 \/|0 балл/);
  assert.match(panicSection.textContent,/Остальные вопросы не заполнялись/);
  assert.match(panicSection.textContent,/Вопросы, скрытые по условию предыдущего ответа: 1/);
  assert.equal(panicSection.querySelectorAll('.answer-summary dt').length,1);
  assert.doesNotMatch(panicSection.textContent,/Были ли подобные приступы прежде/);
  assert.equal(panicSection.querySelector('svg[role="img"]'),null);
});

test("the patient's actual state page shows saved clinical data without a contradictory legacy empty state",async()=>{
  unexpected=[];
  const phq={...definition,key:"phq9_zolotareva_2023_v1",name:"PHQ-9 · депрессивные симптомы",maximum:27};
  const rows=[{id:8,patient_id:2,submission_id:10,instrument_key:phq.key,definition:phq,score:0,created_at:stamp,answers:{q1:"n0"},result:{kind:"sum",maximum:27,item9_positive:false}}];
  globalThis.fetch=async(url,options={})=>{
    if((options.method??"GET")==="GET"&&url==="/patients/2/clinical-results")return Response.json(rows);
    if((options.method??"GET")==="GET"&&url==="/patients/2/assessments")return Response.json([]);
    unexpected.push({url,method:options.method??"GET"});return Response.json({detail:"Unexpected request"},{status:500});
  };
  const actor={id:3,username:"patient2",display_name:"Синтетический пациент",role:"patient",patient_id:2,availability:"offline"};
  render(h(Interactions,null,h(Guard,null,h(PatientHome,{user:actor,view:"state",notify:()=>{},navigate:()=>{},assignmentId:null,selectAssignment:()=>{}}))));
  await screen.findByRole("heading",{name:"PHQ-9 · депрессивные симптомы",exact:true});
  assert.match(document.body.textContent,/Последний результат0 \/ 27/);
  assert.doesNotMatch(document.body.textContent,/Измерений пока нет/);
  assert.match(document.body.textContent,/Динамика появится после следующего измерения/);
  assert.equal(document.querySelectorAll('.time-series').length,0);
});

for(const initialNew of [false,true]){
  test(`${initialNew?'direct new-survey route':'explicit creation'} focuses the editor after loading and cannot label an author survey as clinical`,async()=>{
    unexpected=[];
    const survey={id:42,title:"Исходный авторский опрос",description:"Синтетическая проверка",purpose:"custom",version:1,published_at:stamp,previous_version_id:null,
      questions:[{id:"feedback",prompt:"Что проверить?",kind:"text",required:false,options:[],minimum:0,maximum:10}]};
    globalThis.fetch=async(url,options={})=>{
      const method=options.method??"GET";
      if(method==="GET"&&url==="/surveys")return Response.json([survey]);
      if(method==="GET"&&(url==="/patients"||url==="/clinical-instruments"))return Response.json([]);
      unexpected.push({url,method});return Response.json({detail:"Unexpected request"},{status:500});
    };
    render(h(Interactions,null,h(Guard,null,h(Builder,{initialNew,notify:()=>{}}))));
    const user=userEvent.setup({document:dom.window.document});
    if(!initialNew){await screen.findByRole("heading",{name:"Исходный авторский опрос",exact:true});await user.click(screen.getByRole("button",{name:"Создать опрос",exact:true}));}
    const heading=await screen.findByRole("heading",{name:"Новый опрос",exact:true});
    await waitFor(()=>assert.equal(document.activeElement,heading));
    assert.equal(screen.getByRole("textbox",{name:"Название",exact:true}).value,"");
    const purpose=screen.getByRole("combobox",{name:"Зачем этот опрос",exact:true});
    assert.equal(within(purpose).queryByRole("option",{name:"Клинический опросник",exact:true}),null);
  });
}

const baselineRows=[1,2,3].map(id=>({id,patient_id:2,submission_id:id,instrument_key:"phq9_zolotareva_2023_v1",score:id*3,created_at:stamp}));

test("baseline failure preserves the doctor's explicit selection and private reason until retry",async()=>{
  unexpected=[];const writes=[];let fail=true,current={result_id:null,revision:0,reason:"",selected_at:null};
  const path="/patients/2/clinical-baselines/phq9_zolotareva_2023_v1";
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??"GET";
    if(url===path&&method==="GET")return Response.json(current);
    if(url===path&&method==="PUT"){
      const body=JSON.parse(options.body);writes.push(body);
      if(fail)return Response.json({detail:"Учебный отказ сохранения исходного измерения"},{status:503});
      current={...body,revision:1,selected_at:stamp};return Response.json(current);
    }
    unexpected.push({url,method});return Response.json({detail:"Unexpected request"},{status:500});
  };
  render(h(Interactions,null,h(Guard,null,h(Baseline,{patientId:2,instrumentKey:"phq9_zolotareva_2023_v1",rows:baselineRows}))));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(screen.getByText("Исходное измерение PHQ-9",{exact:true}));
  const select=await screen.findByRole("combobox",{name:"Измерение для следующих сравнений"});
  const reason=screen.getByRole("textbox",{name:"Основание выбора"});
  await user.selectOptions(select,"2");await user.type(reason,"Перед началом нового согласованного курса");
  await user.click(screen.getByRole("button",{name:"Сохранить исходное измерение",exact:true}));
  const error=await screen.findByRole("alert");
  assert.equal(document.activeElement,error);assert.equal(select.value,"2");
  assert.equal(reason.value,"Перед началом нового согласованного курса");
  fail=false;await user.click(screen.getByRole("button",{name:"Сохранить исходное измерение",exact:true}));
  const status=await screen.findByRole("status");
  await waitFor(()=>assert.equal(document.activeElement,status));
  assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
  assert.deepEqual(writes[1],{result_id:2,expected_revision:0,reason:"Перед началом нового согласованного курса"});
});

test("a baseline conflict requires refresh and another explicit save without replacing the doctor's draft",async()=>{
  unexpected=[];const writes=[];let conflict=true,refresh=false;
  const path="/patients/2/clinical-baselines/phq9_zolotareva_2023_v1";
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??"GET";
    if(url===path&&method==="GET")return Response.json({result_id:refresh?3:1,revision:refresh?2:1,reason:"Ранее выбранное основание",selected_at:stamp});
    if(url===path&&method==="PUT"){
      const body=JSON.parse(options.body);writes.push(body);
      if(conflict){refresh=true;conflict=false;return Response.json({detail:"Выбор исходного измерения изменился"},{status:409});}
      return Response.json({result_id:body.result_id,revision:3,reason:body.reason,selected_at:stamp});
    }
    unexpected.push({url,method});return Response.json({detail:"Unexpected request"},{status:500});
  };
  render(h(Interactions,null,h(Guard,null,h(Baseline,{patientId:2,instrumentKey:"phq9_zolotareva_2023_v1",rows:baselineRows}))));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(screen.getByText("Исходное измерение PHQ-9",{exact:true}));
  const select=await screen.findByRole("combobox",{name:"Измерение для следующих сравнений"});
  const reason=screen.getByRole("textbox",{name:"Основание выбора"});
  await user.selectOptions(select,"2");await user.type(reason,"Уточнённое исходное измерение");
  await user.click(screen.getByRole("button",{name:"Сохранить исходное измерение",exact:true}));
  await screen.findByRole("alert");await user.click(screen.getByRole("button",{name:"Обновить выбор врача",exact:true}));
  await waitFor(()=>assert.equal(screen.queryByRole("alert"),null));
  assert.equal(writes.length,1);assert.equal(select.value,"2");assert.equal(reason.value,"Уточнённое исходное измерение");
  await user.click(screen.getByRole("button",{name:"Сохранить исходное измерение",exact:true}));
  await screen.findByRole("status");assert.equal(writes[1].expected_revision,2);
});

test("urgent filtering preserves the focused control and never acknowledges events by displaying them",async()=>{
  unexpected=[];const commands=[];
  const make=(id,severity)=>({id,patient_id:2,patient_name:`Синтетический пациент ${id}`,reason:"Результат клинического бланка",status:"created",rule_id:"clinical_review",rule_version:"medical_answers_20261026_v1",source_kind:"clinical_assessment",severity,event_created_at:stamp,created_at:stamp,presented_at:null,acknowledged_at:null,
    latency_seconds:{event_to_alert:0,event_to_presentation:null,event_to_acknowledgement:null},review_timing:{acknowledgement_due_at:severity==="urgent_review"?stamp:null,acknowledgement_state:"pending",action_due_at:null,action_completed_at:null,action_overdue:false,as_of:stamp}});
  const all=[make(3,"review_required"),make(2,"urgent_review"),make(1,"urgent_review")];
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??"GET";
    if(url.startsWith("/alerts/inbox?limit=20")&&method==="GET")return Response.json({total_open:3,not_presented:3,urgent_open:2,items:url.includes("priority=urgent")?all.slice(1):all,next_before_id:null});
    if(/^\/alerts\/[123]\/presented$/.test(url)&&method==="POST")return Response.json({presented_at:stamp});
    if(/^\/alerts\/[123]\/acknowledge$/.test(url)&&method==="POST"){commands.push(url);const row=all.find(item=>url.includes(`/${item.id}/`));row.status="acknowledged";row.acknowledged_at=stamp;return Response.json({status:"acknowledged"});}
    unexpected.push({url,method});return Response.json({detail:"Unexpected request"},{status:500});
  };
  render(h(Interactions,null,h(Inbox,{openPatient:()=>{}})));
  const user=userEvent.setup({document:dom.window.document});
  const urgent=await screen.findByRole("button",{name:"Срочные оценки · 2",exact:true});
  await user.click(urgent);
  await waitFor(()=>assert.equal(screen.queryByRole("heading",{name:"Синтетический пациент 3"}),null));
  await screen.findByRole("heading",{name:"Синтетический пациент 2"});
  assert.equal(document.activeElement,urgent);assert.equal(urgent.getAttribute("aria-pressed"),"true");
  assert.equal(commands.length,0);
  assert.equal(screen.getAllByText(/Врач задаёт при планировании/).length,2);
  await user.click(screen.getAllByRole("button",{name:"Принять в работу",exact:true})[0]);
  await waitFor(()=>assert.equal(commands.length,1));
  const row=screen.getByRole('heading',{name:'Синтетический пациент 2'}).closest('article');
  await waitFor(()=>assert.equal(Boolean(within(row).queryByRole('button',{name:'Принять в работу',exact:true})),false));
  assert.ok(document.activeElement===within(row).getByRole('button',{name:/Открыть карточку/}));
});

test("an event's exact clinical measurement opens once without stealing focus on history refresh",async()=>{
  unexpected=[];
  const phq={...definition,key:"phq9-v1",name:"PHQ-9 · депрессивные симптомы",maximum:27};
  const rows=[1,2].map(id=>({id,patient_id:2,submission_id:id,instrument_key:phq.key,definition:phq,score:id,created_at:stamp,answers:{q1:"n0"},result:{kind:"sum",maximum:27,item9_positive:false}}));
  globalThis.fetch=async(url,options={})=>{
    if(url==='/patients/2/clinical-results'&&(options.method??'GET')==='GET')return Response.json(rows);
    unexpected.push({url,method:options.method??'GET'});return Response.json({detail:'Unexpected request'},{status:500});
  };
  const view=render(h('div',null,h('button',null,'Другое действие'),h(History,{patientId:2,target:{id:1,request:1}})));
  await screen.findByRole('heading',{name:phq.name});
  const selected=document.querySelector('[data-clinical-result="1"]'),other=document.querySelector('[data-clinical-result="2"]');
  assert.equal(selected.open,true);assert.equal(other.open,false);
  assert.ok(document.activeElement===selected.querySelector('summary'));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(selected.querySelector('summary'));
  await user.click(screen.getByRole('button',{name:'Другое действие'}));
  view.rerender(h('div',null,h('button',null,'Другое действие'),h(History,{patientId:2,target:{id:1,request:1}})));
  assert.equal(selected.open,false);assert.ok(document.activeElement===screen.getByRole('button',{name:'Другое действие'}));
  view.rerender(h('div',null,h('button',null,'Другое действие'),h(History,{patientId:2,target:{id:2,request:2}})));
  await waitFor(()=>assert.equal(other.open,true));assert.ok(document.activeElement===other.querySelector('summary'));
});

test("a delayed acknowledgement leaves focus on another control the doctor has chosen",async()=>{
  unexpected=[];let accept;
  const row={id:6,patient_id:2,patient_name:'Синтетический пациент',reason:'Результат',status:'created',source_kind:'clinical_assessment',rule_id:'clinical_review',rule_version:'v1',event_created_at:stamp,created_at:stamp,presented_at:stamp,acknowledged_at:null,latency_seconds:{event_to_alert:0,event_to_presentation:0,event_to_acknowledgement:null}};
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??'GET';
    if(url.startsWith('/alerts/inbox?')&&method==='GET')return Response.json({total_open:1,not_presented:0,urgent_open:0,items:[row],next_before_id:null});
    if(url==='/alerts/6/acknowledge'&&method==='POST')return new Promise(resolve=>{accept=()=>{row.status='acknowledged';resolve(Response.json({status:row.status}));};});
    unexpected.push({url,method});return Response.json({detail:'Unexpected request'},{status:500});
  };
  render(h(Interactions,null,h(Inbox,{openPatient:()=>{}})));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(await screen.findByRole('button',{name:'Принять в работу',exact:true}));
  const refresh=screen.getByRole('button',{name:'Обновить очередь',exact:true});
  await user.click(refresh);accept();
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole('button',{name:/Принимаем|Принять в работу/})),false));
  assert.ok(document.activeElement===refresh);
});

test("a linked clinical action preserves separate medical and verification dates across a retry",async()=>{
  unexpected=[];const commands=[];let fail=true;
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??'GET';
    if(url==='/coordination/team'&&method==='GET')return Response.json([]);
    if(url==='/alerts/18/actions'&&method==='POST'){
      commands.push(JSON.parse(options.body));
      return fail?Response.json({detail:'Временный отказ записи'},{status:503}):Response.json({task_id:39,reply_message_id:null});
    }
    unexpected.push({url,method});return Response.json({detail:'Unexpected request'},{status:500});
  };
  render(h(Interactions,null,h(Guard,null,h(EventAction,{alertId:18,done:()=>{},notify:()=>{}}))));
  const user=userEvent.setup({document:dom.window.document});
  await user.type(screen.getByRole('textbox',{name:'Следующее действие по событию',exact:true}),'Учебный контакт');
  const due=screen.getByLabelText('Срок следующего действия',{exact:true}),check=screen.getByLabelText('Дата проверки результата',{exact:true});
  fireEvent.change(due,{target:{value:'2026-10-26T19:49'}});fireEvent.change(check,{target:{value:'2026-10-27T12:00'}});
  await user.click(screen.getByRole('button',{name:'Назначить задачу по событию',exact:true}));
  await waitFor(()=>assert.equal(commands.length,1));
  assert.equal(due.value,'2026-10-26T19:49');assert.equal(check.value,'2026-10-27T12:00');
  fail=false;await user.click(screen.getByRole('button',{name:'Назначить задачу по событию',exact:true}));
  await screen.findByText('Создана задача #39',{exact:true});
  assert.deepEqual(commands[1],commands[0]);
  assert.equal(commands[0].due_at,new Date('2026-10-26T19:49').toISOString());
  assert.equal(commands[0].follow_up_at,new Date('2026-10-27T12:00').toISOString());
  assert.equal(commands[0].kind,'clinical');assert.equal(commands[0].assigned_to_id,null);
});
