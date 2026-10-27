// Actual components and responses; layout and native viewport behavior are checked in CUA.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Schedule,Guard,Interactions,render,screen,cleanup,userEvent,act,unexpected;
const initialItem={id:41,key:"local:41",label:"Учебная личная позиция",instructions:"Не назначение",
  schedule_text:"Свободный учебный учёт",schedule_kind:"description",times:[],weekdays:[],timezone:"UTC",
  starts_on:"2026-01-01",ends_on:null,active:true,revision:1,source:"patient_entered",editable:true};
const award=points=>({points,policy_version:"demo-test",recorded_at:"2026-10-25T00:00:00Z"});

before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  ({render,screen,cleanup,act}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({MedicationSchedule:Schedule}=await server.ssrLoadModule("/src/MedicationSchedule.tsx"));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Unexpected requests are not accepted by this fixture");});
after(async()=>{await server?.close();dom?.window.close();});

function transport({empty=false,receipt=award(0),fail=false,holdReload=false,fixed=false}={}){
  unexpected=[];
  let items=empty?[]:[{...structuredClone(initialItem),...(fixed?{schedule_kind:"fixed",times:["22:00"]}:{})}],reports=[],reads=0,release;
  const writes=[];
  const data=()=>({day:"2026-10-25",items,events:fixed?[{item_key:initialItem.key,occurrence_key:"2026-10-24@22:00/v1",source_day:"2026-10-24",clock:"01:00",scheduled_for:"2026-10-24T22:00:00Z",status:"unknown",can_report:true,requires_time_confirmation:false,report:reports[0]??null}]:[],historical_reports:fixed?[]:reports,recent_reports:[],source:{status:"synthetic"}});
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET"&&path.startsWith("/patients/2/medications?on=")){
      reads++;
      if(holdReload&&reads===2)return new Promise(resolve=>{release=()=>resolve(Response.json(data()));});
      return Response.json(data());
    }
    if((method==="POST"&&(path==="/medications/items"||path==="/medications/reports"))||(method==="PUT"&&path==="/medications/items/41")){
      const body=JSON.parse(options.body);writes.push({path,body});
      if(fail)return Response.json({detail:"Тест: сохранение недоступно"},{status:503});
      if(path==="/medications/items"||path==="/medications/items/41"){
        items=[{...initialItem,...body}];
        return Response.json({...items[0],replayed:false,...(receipt===undefined?{}:{participation:receipt})},{status:201});
      }
      reports=[{id:51,revision:1,...body}];
      return Response.json({...reports[0],replayed:false,...(receipt===undefined?{}:{participation:receipt})},{status:201});
    }
    unexpected.push({path,method});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  return {writes,enableWrites:()=>{fail=false;},releaseReload:()=>{assert.ok(release,"A reload must have started");release();},reads:()=>reads};
}
function mount(notify=()=>{},progress=()=>{}){
  render(h(Interactions,null,h(Guard,null,h(Schedule,{patientId:2,notify,progress}))));
  return userEvent.setup({document:dom.window.document});
}

test("a Moscow display saves against the original medication occurrence date",async()=>{
  const requests=transport({fixed:true,receipt:award(2)}),user=mount();
  await screen.findByRole("heading",{name:"01:00 · Без отметки",exact:true});
  await user.selectOptions(screen.getByRole("combobox",{name:"Мой самоотчёт"}),"unknown");
  await user.click(screen.getByRole("button",{name:"Сохранить отметку"}));
  await screen.findByRole("heading",{name:"Самоотчёт сохранён"});
  assert.equal(requests.writes.length,1);
  assert.equal(requests.writes[0].body.day,"2026-10-24");
  assert.equal(requests.writes[0].body.occurrence_key,"2026-10-24@22:00/v1");
  assert.equal(requests.writes[0].body.status,"unknown");
});

test("report confirmation survives a schedule reload and uses the returned zero award",async()=>{
  const requests=transport({holdReload:true});let progress=0;
  const user=mount(()=>{},()=>progress++);
  await screen.findByRole("combobox",{name:"Мой самоотчёт"});
  await user.selectOptions(screen.getByRole("combobox",{name:"Мой самоотчёт"}),"not_taken");
  await user.type(screen.getByRole("textbox",{name:"Комментарий · необязательно"}),"Учебный комментарий");
  await user.click(screen.getByRole("button",{name:"Сохранить отметку"}));
  const heading=await screen.findByRole("heading",{name:"Самоотчёт сохранён"});
  assert.equal(document.activeElement===heading,true);
  assert.ok(screen.getByText("Сохранено без дополнительных баллов"));
  assert.equal(requests.writes.length,1);
  assert.equal(requests.writes[0].body.status,"not_taken");
  await act(async()=>requests.releaseReload());
  assert.equal((await screen.findByRole("combobox",{name:"Мой самоотчёт"})).value,"not_taken");
  assert.ok(screen.getByText("Сохранено без дополнительных баллов"));
  const history=screen.getByText("Самоотчёты свободного расписания и предыдущих версий").closest("details");
  assert.match(history.textContent,/Учебная личная позиция/);
  assert.doesNotMatch(history.textContent,/local:41/);
  await user.click(screen.getByRole("button",{name:"Мой прогресс"}));
  assert.equal(progress,1);
  await user.type(screen.getByRole("textbox",{name:"Комментарий · необязательно"})," · ещё не сохранено");
  assert.equal(Boolean(screen.queryByRole("heading",{name:"Самоотчёт сохранён"})),false,"Old confirmation must not describe unsaved edits");
  assert.equal(requests.writes.length,1);
});

test("personal schedule closes the editor and confirms saving without awarding report points",async()=>{
  const requests=transport({empty:true,receipt:award(0)});
  const user=mount();
  await screen.findByText("Позиций пока нет");
  await user.click(screen.getByRole("button",{name:"Добавить свою позицию",exact:true}));
  await user.type(screen.getByRole("textbox",{name:"Название",exact:true}),"Учебный учёт");
  await user.type(screen.getByRole("textbox",{name:"Расписание своими словами"}),"Мой учебный пример");
  await user.selectOptions(screen.getByRole("combobox",{name:"Тип учёта"}),"description");
  await user.click(screen.getByRole("button",{name:"Сохранить личное расписание"}));
  await screen.findByRole("heading",{name:"Расписание сохранено"});
  assert.equal(Boolean(screen.queryByRole("textbox",{name:"Название",exact:true})),false);
  assert.ok(screen.getByText("Сохранено без дополнительных баллов"));
  assert.equal(requests.writes.length,1);
  assert.deepEqual(requests.writes[0].body.times,[]);
  assert.ok(await screen.findByRole("heading",{name:"Учебный учёт"}));
});

test("missing legacy receipt remains unknown instead of inventing a zero or positive award",async()=>{
  transport({receipt:null});
  const user=mount();
  await screen.findByRole("combobox",{name:"Мой самоотчёт"});
  await user.selectOptions(screen.getByRole("combobox",{name:"Мой самоотчёт"}),"unknown");
  await user.click(screen.getByRole("button",{name:"Сохранить отметку"}));
  await screen.findByRole("heading",{name:"Самоотчёт сохранён"});
  assert.ok(screen.getByText("Участие сохранено"));
  assert.ok(screen.getByText(/Отдельное подтверждение начисления пока недоступно/));
  assert.equal(Boolean(screen.queryByText("Сохранено без дополнительных баллов")),false);
});

test("failed self-report retains the chosen answer and comment without a success receipt",async()=>{
  const requests=transport({fail:true}),notices=[];
  const user=mount((...args)=>notices.push(args));
  await screen.findByRole("combobox",{name:"Мой самоотчёт"});
  await user.selectOptions(screen.getByRole("combobox",{name:"Мой самоотчёт"}),"unknown");
  await user.type(screen.getByRole("textbox",{name:"Комментарий · необязательно"}),"Не терять текст");
  await user.click(screen.getByRole("button",{name:"Сохранить отметку"}));
  const error=await screen.findByRole("alert");
  assert.match(error.textContent,/Тест: сохранение недоступно/);
  assert.equal(document.activeElement===error,true,"The error must be focused near the retained form");
  assert.deepEqual(notices,[],"Inline error should not duplicate an alert in the global toast");
  assert.equal(screen.getByRole("combobox",{name:"Мой самоотчёт"}).value,"unknown");
  assert.equal(screen.getByRole("textbox",{name:"Комментарий · необязательно"}).value,"Не терять текст");
  assert.equal(Boolean(screen.queryByRole("heading",{name:"Самоотчёт сохранён"})),false);
  assert.equal(requests.reads(),1);
});

test("clinician schedule is subordinate to the patient name while the patient's own schedule remains a page heading",async()=>{
  transport();
  const view=render(h(Interactions,null,h(Guard,null,h("h1",null,"Синтетический пациент"),h(Schedule,{patientId:2,notify:()=>{},readOnly:true}))));
  await screen.findByRole("heading",{name:"Расписание и самоотчёты пациента"});
  assert.equal(Boolean(screen.queryByRole("heading",{name:"Расписание и самоотчёты пациента",level:2})),true,"The embedded schedule must not compete with the patient-name page heading");
  assert.deepEqual(screen.getAllByRole("heading",{level:1}).map(e=>e.textContent),["Синтетический пациент"]);
  assert.equal(Boolean(screen.queryByRole("button",{name:"Добавить свою позицию"})),false);
  view.unmount();
  mount();
  assert.ok(await screen.findByRole("heading",{name:"Моё расписание лекарств",level:1}));
});

test("failed schedule creation focuses one inline error, preserves fields and retries with the same request identity",async()=>{
  const requests=transport({empty:true,fail:true}),notices=[];
  const user=mount((...args)=>notices.push(args));
  await screen.findByText("Позиций пока нет");
  await user.click(screen.getByRole("button",{name:"Добавить свою позицию",exact:true}));
  await user.type(screen.getByRole("textbox",{name:"Название",exact:true}),"Синтетический учёт");
  await user.type(screen.getByRole("textbox",{name:"Расписание своими словами"}),"Не терять расписание");
  await user.selectOptions(screen.getByRole("combobox",{name:"Тип учёта"}),"description");
  await user.click(screen.getByRole("button",{name:"Сохранить личное расписание"}));
  const error=await screen.findByRole("alert");
  assert.equal(Boolean(error.closest(".medication-editor")),true,"Schedule errors must remain next to the retained editor");
  assert.equal(document.activeElement===error,true);
  assert.deepEqual(notices,[],"Do not duplicate the inline error as a global toast");
  assert.equal(screen.getByRole("textbox",{name:"Название",exact:true}).value,"Синтетический учёт");
  assert.equal(screen.getByRole("textbox",{name:"Расписание своими словами"}).value,"Не терять расписание");
  assert.equal(screen.getByRole("combobox",{name:"Тип учёта"}).value,"description");
  const description=error.parentElement.id;
  assert.ok(description);
  assert.equal(error.closest("form").querySelector("fieldset").getAttribute("aria-describedby"),description);
  requests.enableWrites();
  await user.click(screen.getByRole("button",{name:"Сохранить личное расписание"}));
  await screen.findByRole("heading",{name:"Расписание сохранено"});
  assert.equal(requests.writes.length,2);
  assert.deepEqual(requests.writes[0].body,requests.writes[1].body,"An unchanged retry must preserve the creation idempotency key");
  assert.equal(Boolean(screen.queryByRole("alert")),false);
});

test("failed schedule edit retains its revision, clears the stale error when changed and confirms only a successful retry",async()=>{
  const requests=transport({fail:true}),notices=[];
  const user=mount((...args)=>notices.push(args));
  await screen.findByRole("button",{name:"Редактировать личную позицию"});
  await user.click(screen.getByRole("button",{name:"Редактировать личную позицию"}));
  await user.type(screen.getByRole("textbox",{name:"Расписание своими словами"})," · новая запись");
  await user.click(screen.getByRole("button",{name:"Сохранить личное расписание"}));
  const error=await screen.findByRole("alert");
  assert.equal(Boolean(error.closest(".medication-editor")),true,"Editing errors must be inline as well as creation errors");
  assert.equal(document.activeElement===error,true);
  assert.deepEqual(notices,[]);
  assert.equal(requests.writes[0].body.expected_revision,1);
  assert.equal(Boolean(screen.queryByRole("heading",{name:"Расписание сохранено"})),false);
  await user.type(screen.getByRole("textbox",{name:"Своё описание / инструкция · необязательно"})," · уточнение");
  assert.equal(Boolean(screen.queryByRole("alert")),false,"A new edit must clear the previous error");
  requests.enableWrites();
  await user.click(screen.getByRole("button",{name:"Сохранить личное расписание"}));
  await screen.findByRole("heading",{name:"Расписание сохранено"});
  assert.equal(requests.writes.length,2);
  assert.equal(requests.writes[1].body.expected_revision,1,"A failed edit must not advance the known revision");
  assert.equal(requests.writes[1].body.schedule_text,"Свободный учебный учёт · новая запись");
});
