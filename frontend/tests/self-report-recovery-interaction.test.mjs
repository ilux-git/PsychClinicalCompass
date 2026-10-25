// Actual patient self-report. Transport only accepts own history and explicit report writes.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Patient,Guard,Interactions,render,screen,cleanup,act,userEvent,unexpected;
const actor={id:3,display_name:"Учебный пациент",role:"patient",patient_id:2,availability:"available"};
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLInputElement","HTMLTextAreaElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,cleanup,act}=await import("@testing-library/react"));({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({PatientHome:Patient}=await server.ssrLoadModule("/src/Patient.tsx"));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"No reads outside the patient's own history and no implicit writes");});
after(async()=>{await server?.close();dom?.window.close();});

function transport(){
  unexpected=[];let fail=true,hold=false,release;const writes=[],reports=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??'GET';
    if(method==='GET'&&path==='/patients/2/adherence')return Response.json({reports});
    if(method==='POST'&&path==='/adherence/reports'){
      const body=JSON.parse(options.body);writes.push(body);
      if(fail)return Response.json({detail:'Учебный отказ сохранения самоотчёта'},{status:503});
      if(hold)await new Promise(resolve=>{release=resolve;});
      const report={id:81,patient_id:2,recommendation:body.recommendation,status:body.status,reason:body.reason,created_at:'2026-10-25T10:00:00Z',source:'patient_self_report'};
      reports.push(report);return Response.json(report,{status:201});
    }
    unexpected.push({path,method});return Response.json({detail:'Unexpected test request'},{status:500});
  };
  return {writes,enableWrites:()=>{fail=false;},holdWrites:()=>{hold=true;},release:()=>release()};
}
function mount(notices){
  render(h(Interactions,null,h(Guard,null,h(Patient,{user:actor,view:'adherence',notify:(...args)=>notices.push(args),navigate:()=>{},assignmentId:null,selectAssignment:()=>{}}),h('button',{type:'button'},'Помощь с разделом'))));
}
async function fill(user){
  const recommendation=await screen.findByRole('textbox',{name:'О какой рекомендации расскажете?',exact:true});
  const reason=screen.getByRole('textbox',{name:'Что помогло или помешало? Необязательно',exact:true});
  await user.type(recommendation,'Учебная проверка интерфейса');await user.click(screen.getByRole('radio',{name:'Не могу оценить',exact:true}));
  await user.type(reason,'Синтетический ответ для проверки сохранности');return {recommendation,reason};
}

test('a failed self-report keeps its unknown answer, focuses one local error and preserves request identity across repeated explicit retries',async()=>{
  const requests=transport(),notices=[];mount(notices);const user=userEvent.setup({document:dom.window.document});
  const fields=await fill(user),submit=screen.getByRole('button',{name:'Сохранить самоотчёт',exact:true});
  await user.click(submit);let error=await screen.findByRole('alert');
  assert.ok(error.closest('.self-report-form'));assert.equal(document.activeElement,error);assert.deepEqual(notices,[]);
  assert.equal(fields.recommendation.value,'Учебная проверка интерфейса');assert.equal(fields.reason.value,'Синтетический ответ для проверки сохранности');
  assert.equal(screen.getByRole('radio',{name:'Не могу оценить',exact:true}).checked,true);
  const described=error.closest('form').querySelector('.form-fields').getAttribute('aria-describedby');assert.ok(described&&document.getElementById(described)?.contains(error));
  await user.click(submit);error=await screen.findByRole('alert');assert.equal(document.activeElement,error);assert.equal(screen.getAllByRole('alert').length,1);
  assert.equal(requests.writes.length,2);assert.deepEqual(requests.writes[0],requests.writes[1]);assert.equal(requests.writes[0].status,'unknown');
  requests.enableWrites();await user.click(submit);const saved=await screen.findByRole('heading',{name:'Учебная проверка интерфейса',exact:true});
  assert.equal(document.activeElement===saved.closest('article'),true,'Successful submission should acknowledge the saved report in history');
  assert.equal(requests.writes.length,3);assert.deepEqual(requests.writes[1],requests.writes[2]);
  assert.equal(fields.recommendation.value,'');assert.equal(fields.reason.value,'');assert.equal(document.querySelectorAll('.self-report-form input:checked').length,0);
  assert.equal(screen.queryByRole('alert'),null);assert.equal(notices.length,1);assert.ok(notices.every(n=>n[1]!=='error'));
});

test('editing a failed self-report clears its stale error and sends the revised answer only after a new explicit submit',async()=>{
  const requests=transport(),notices=[];mount(notices);const user=userEvent.setup({document:dom.window.document});
  const fields=await fill(user),submit=screen.getByRole('button',{name:'Сохранить самоотчёт',exact:true});
  await user.click(submit);await screen.findByRole('alert');
  await user.type(fields.reason,' — уточнение');assert.equal(screen.queryByRole('alert'),null);assert.equal(requests.writes.length,1);
  assert.equal(screen.getByRole('radio',{name:'Не могу оценить',exact:true}).checked,true);
  requests.enableWrites();await user.click(submit);await screen.findByRole('heading',{name:'Учебная проверка интерфейса',exact:true});
  assert.equal(requests.writes.length,2);assert.notEqual(requests.writes[0].client_request_id,requests.writes[1].client_request_id);
  assert.equal(requests.writes[1].reason,'Синтетический ответ для проверки сохранности — уточнение');assert.equal(requests.writes[1].status,'unknown');assert.ok(notices.every(n=>n[1]!=='error'));
});

test('a delayed successful self-report respects focus deliberately moved to another control',async()=>{
  const requests=transport(),notices=[];requests.enableWrites();requests.holdWrites();mount(notices);
  const user=userEvent.setup({document:dom.window.document});await fill(user);
  await user.click(screen.getByRole('button',{name:'Сохранить самоотчёт',exact:true}));await screen.findByRole('button',{name:'Сохраняем…',exact:true});
  const help=screen.getByRole('button',{name:'Помощь с разделом',exact:true});await user.click(help);assert.equal(document.activeElement,help);
  await act(async()=>requests.release());await screen.findByRole('heading',{name:'Учебная проверка интерфейса',exact:true});
  assert.equal(document.activeElement,help);assert.equal(requests.writes.length,1);assert.equal(requests.writes[0].status,'unknown');
});
