// Actual clinician card with a closed transport; assignment remains an explicit manual operation.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Patients,Guard,Interactions,Views,render,screen,cleanup,userEvent,unexpected;
const patient={id:1,full_name:"Синтетический пациент",mis_id:101,doctor_id:1,created_at:"2026-10-20T10:00:00Z",mis:{source:"synthetic-mis",status:"available",diagnoses:[],prescriptions:[]},doctor:{name:"Учебный врач",availability:"available"}};
const survey=id=>({id,title:id===7?"Учебные препятствия":"Учебный опыт приложения",description:"Не диагностическая шкала",purpose:"support",version:1,previous_version_id:null,published_at:"2026-10-20T10:00:00Z",questions:[{id:"comment",prompt:"Что сделать удобнее?",kind:"text",required:false,options:[],minimum:0,maximum:10}]});
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLInputElement","HTMLSelectElement","HTMLTextAreaElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.scrollTo=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,cleanup}=await import("@testing-library/react"));({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({DoctorPatients:Patients}=await server.ssrLoadModule("/src/DoctorPatients.tsx"));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
  ({ViewStateProvider:Views}=await server.ssrLoadModule("/src/ViewState.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Only the current card's reads and the selected survey assignment are permitted");});
after(async()=>{await server?.close();dom?.window.close();});
function transport(){
  unexpected=[];let fail=true;const writes=[],assignments=[];
  const replies=new Map([["/patients/1",patient],["/patients/1/assessments",[]],["/patients/1/notes",[]],["/patients/1/adherence",{reports:[]}],["/alerts?patient_id=1",[]],["/surveys",[survey(7),survey(8)]]]);
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET"&&path==="/survey-assignments?patient_id=1")return Response.json(assignments);
    if(method==="GET"&&replies.has(path))return Response.json(replies.get(path));
    if(method==="POST"&&(path==="/surveys/7/assign"||path==="/surveys/8/assign")){
      const body=JSON.parse(options.body);writes.push({path,body});
      if(fail)return Response.json({detail:"Учебный отказ назначения"},{status:503});
      const selected=path==="/surveys/7/assign"?7:8;
      assignments.push({id:77,patient_id:1,patient_name:patient.full_name,status:"assigned",due_at:null,created_at:"2026-10-25T10:00:00Z",first_opened_at:null,survey:survey(selected),submission:null});
      return Response.json({assignment_ids:[77]},{status:201});
    }
    unexpected.push({path,method});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  return {writes,enableWrites:()=>{fail=false;}};
}
async function mount(notices){
  render(h(Interactions,null,h(Views,{returnPoint:null,restored:()=>{}},h(Guard,null,h(Patients,{selected:1,onSelect:()=>{},notify:(...args)=>notices.push(args),back:()=>{}})))));
  await screen.findByRole("combobox",{name:"Опрос для назначения"});
  return userEvent.setup({document:dom.window.document});
}
test("a failed assignment retains the chosen template, focuses its local error and retries with the same identity",async()=>{
  const requests=transport(),notices=[];const user=await mount(notices);
  const select=screen.getByRole("combobox",{name:"Опрос для назначения"});
  await user.selectOptions(select,"7");
  const selection=screen.queryByText('Выбран опрос «Учебные препятствия». Версия 1. Вопросов: 1.');
  assert.equal(Boolean(selection),true,"The full selected template and version must remain readable outside a truncated native select");
  assert.ok(select.getAttribute("aria-describedby")?.split(/\s+/).includes(selection.id));
  await user.click(screen.getByRole("button",{name:"Назначить",exact:true}));
  const error=await screen.findByRole("alert");
  assert.equal(Boolean(error.closest(".survey-results-panel")),true,"The assignment error belongs beside the selected template");
  assert.equal(document.activeElement===error,true);assert.deepEqual(notices,[]);
  assert.equal(select.value,"7");assert.ok(screen.getByText("Опросов пока нет"));
  assert.ok(select.getAttribute("aria-describedby")?.split(/\s+/).includes(error.parentElement.id));
  await user.click(screen.getByRole("button",{name:"Назначить",exact:true}));
  assert.equal(document.activeElement===screen.getByRole("alert"),true,"An identical repeated failure must return focus to the local error again");
  requests.enableWrites();await user.click(screen.getByRole("button",{name:"Назначить",exact:true}));
  await screen.findByRole("heading",{name:"Учебные препятствия",level:3});
  assert.equal(requests.writes.length,3);assert.deepEqual(requests.writes[0],requests.writes[1]);assert.deepEqual(requests.writes[1],requests.writes[2]);
  assert.deepEqual(requests.writes[2].body.patient_ids,[1]);
  assert.equal(select.value,"");assert.equal(Boolean(screen.queryByRole("alert")),false);
  assert.ok(screen.getByText("Ждём ответа"));
});
test("changing the failed template clears the old error and only the explicitly chosen new template is assigned",async()=>{
  const requests=transport(),notices=[];const user=await mount(notices);
  const select=screen.getByRole("combobox",{name:"Опрос для назначения"});
  await user.selectOptions(select,"7");await user.click(screen.getByRole("button",{name:"Назначить",exact:true}));
  await screen.findByRole("alert");await user.selectOptions(select,"8");
  assert.equal(Boolean(screen.queryByRole("alert")),false,"A new template must not keep the previous assignment error");
  assert.equal(requests.writes.length,1,"Selection itself must never create an assignment");
  requests.enableWrites();await user.click(screen.getByRole("button",{name:"Назначить",exact:true}));
  await screen.findByRole("heading",{name:"Учебный опыт приложения",level:3});
  assert.equal(requests.writes[1].path,"/surveys/8/assign");
  assert.notEqual(requests.writes[1].body.client_request_id,requests.writes[0].body.client_request_id);
  assert.deepEqual(notices,[['Опрос назначен пациенту']]);
});
