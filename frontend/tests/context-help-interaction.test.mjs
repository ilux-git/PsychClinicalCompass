// Actual Workspace wiring, with synthetic read-only transport. Native modal focus is checked in CUA.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,App,Interactions,render,screen,within,cleanup,userEvent,unexpected;
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/?section=patients&patient=1&tab=medications",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","HTMLDialogElement","SVGElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage","localStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;}observe(target){this.callback([{target,isIntersecting:true}],this);}disconnect(){}};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");this.querySelector("button")?.focus();};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,within,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({default:App}=await server.ssrLoadModule("/src/App.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"The help flow must not add an unlisted request or write");});
after(async()=>{await server?.close();dom?.window.close();});

test("help follows the active clinical-card tab and falls back to the patient list when the card closes",async()=>{
  unexpected=[];sessionStorage.clear();localStorage.clear();
  sessionStorage.setItem("compass-token","fixture-context-doctor");localStorage.setItem("compass-guide-v2-1-doctor","seen");
  const doctor={id:1,display_name:"Учебный врач",role:"doctor",patient_id:null,availability:"available"};
  const patient={id:1,full_name:"Синтетический пациент",mis_id:101,doctor_id:1,created_at:"2026-10-20T10:00:00Z",
    mis:{source:"synthetic-mis",status:"available",diagnoses:[],prescriptions:[]},doctor:{name:doctor.display_name,availability:"available"}};
  const replies=new Map([["/auth/me",doctor],["/patients/1",patient],["/survey-assignments?patient_id=1",[]],
    ["/patients/1/assessments",[]],["/patients/1/notes",[]],["/patients/1/adherence",{reports:[]}],
    ["/alerts?patient_id=1",[]],["/surveys",[]],["/patients/1/diary",{entries:[]}],
    ["/alerts/inbox?limit=1",{total_open:0,not_presented:0,items:[],next_before_id:null}],
    ["/patients/directory?q=&after=0",{total:0,items:[],next_cursor:null}]]);
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET"&&path==="/analytics/care")return Response.json({detail:"Сводка не используется в этой проверке помощи"},{status:503});
    if(method==="GET"&&replies.has(path))return Response.json(replies.get(path));
    if(method==="GET"&&path.startsWith("/patients/1/medications?on="))return Response.json({items:[],events:[],historical_reports:[],recent_reports:[],source:{status:"synthetic"}});
    unexpected.push({path,method});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  render(h(Interactions,null,h(App)));
  const user=userEvent.setup({document:dom.window.document});
  await screen.findByRole("heading",{name:patient.full_name});
  await screen.findByRole("heading",{name:"Расписание и самоотчёты пациента"});
  const help=screen.getByRole("button",{name:"Помощь с разделом"});await user.click(help);
  let dialog=await screen.findByRole("dialog");
  assert.equal(Boolean(within(dialog).queryByRole("heading",{name:"Лекарства"})),true,"Help must describe the medication tab already open, not ask to find a patient");
  assert.doesNotMatch(dialog.textContent,/Найдите пациента/);
  assert.match(dialog.textContent,/самоотчёт/);
  await user.click(within(dialog).getByRole("button",{name:"Понятно"}));
  assert.equal(document.activeElement===help,true);
  await user.click(screen.getByRole("tab",{name:"История состояния"}));
  await screen.findByRole("heading",{name:"История PHQ-9 и GAD-7"});
  await user.click(help);dialog=await screen.findByRole("dialog");
  assert.equal(Boolean(within(dialog).queryByRole("heading",{name:"История состояния"})),true);
  assert.match(dialog.textContent,/поделился/);
  await user.click(within(dialog).getByRole("button",{name:"Понятно"}));
  await user.click(screen.getByRole("button",{name:"Пациенты",exact:true}));
  await user.click(help);dialog=await screen.findByRole("dialog");
  assert.equal(Boolean(within(dialog).queryByRole("heading",{name:"Пациенты"})),true);
  assert.match(dialog.textContent,/Найдите пациента/);
});

for(const completed of [false,true]){
  test(`patient ${completed?'history':'unfinished form'} opened from home has survey navigation and contextual help without changing its URL`,async()=>{
    unexpected=[];sessionStorage.clear();localStorage.clear();
    dom.window.history.replaceState(null,"","/?section=overview&assignment=30");
    sessionStorage.setItem('compass-token','fixture-patient-survey-context');
    const actor={id:3,display_name:"Мария Тестовая",role:"patient",patient_id:2,availability:"available"};
    const stamp="2026-10-25T10:00:00Z";
    const assignment={id:30,patient_id:2,status:completed?"completed":"assigned",due_at:null,created_at:stamp,first_opened_at:null,
      survey:{id:7,title:"Учебный опрос для врача",description:"Не диагностическая шкала",purpose:"support",version:1,previous_version_id:null,published_at:stamp,
        questions:[{id:"comment",prompt:"Что сделать удобнее?",kind:"text",required:false,options:[],minimum:0,maximum:10}]},
      submission:completed?{id:91,created_at:stamp,answers:{comment:"Сохранённый учебный ответ"}}:null};
    const replies=new Map([["/auth/me",actor],["/survey-assignments",[assignment]],
      ["/patients/2",{id:2,full_name:actor.display_name,mis_id:102,doctor_id:1,created_at:stamp,mis:{source:"synthetic",status:"available",diagnoses:[],prescriptions:[]},doctor:{name:"Учебный врач",availability:"available"}}],
      ["/participation/me",{assigned:1,completed:completed?1:0,pending:completed?0:1,progress_percent:completed?100:0,history:[],message:"Учебная проверка"}],
      ["/survey-assignments/30/draft",{answers:{},revision:0,updated_at:null,already_completed:false}]]);
    const unusedHomeReads=new Set(["/participation/points","/participation/care-progress","/patients/2/assessments"]);
    let openings=0;
    globalThis.fetch=async(path,options={})=>{
      const method=options.method??'GET';
      if(method==='GET'&&replies.has(path))return Response.json(replies.get(path));
      if(method==='GET'&&unusedHomeReads.has(path))return Response.json({detail:"Сводка главной не используется в проверке контекста"},{status:503});
      if(method==='POST'&&path==='/survey-assignments/30/open'&&!completed){openings++;return Response.json({assignment_id:30,first_opened_at:stamp,already_completed:false});}
      unexpected.push({path,method});return Response.json({detail:'Unexpected test request'},{status:500});
    };
    render(h(Interactions,null,h(App)));
    const user=userEvent.setup({document:dom.window.document});
    await screen.findByRole('heading',{name:assignment.survey.title});
    if(completed)await screen.findByText('Сохранённый учебный ответ');else await screen.findByRole('textbox',{name:'Что сделать удобнее?'});
    const fast=screen.getByRole('navigation',{name:'Быстрые переходы'});
    assert.equal(within(fast).getByRole('link',{name:'Опросы врача',exact:true}).getAttribute('aria-current'),'page','The open survey belongs to surveys even when its route originated on home');
    assert.equal(within(fast).getByRole('link',{name:'Мой день',exact:true}).getAttribute('aria-current'),null);
    const sidebar=screen.getByRole('navigation',{name:'Главная навигация'});
    assert.equal(within(sidebar).getByRole('link',{name:/^Опросы врача/}).getAttribute('aria-current'),'page');
    assert.equal(Boolean(screen.queryByText(/Начните с главной/)),false,'A welcome inside a form must not direct the user back to the beginning');
    assert.equal(dom.window.location.search,'?section=overview&assignment=30');
    const help=screen.getByRole('button',{name:'Помощь с разделом'});await user.click(help);
    let dialog=await screen.findByRole('dialog',{name:'Опрос врача'});
    assert.match(dialog.textContent,/Черновик виден только вам/);assert.match(dialog.textContent,/Сохранить и продолжить позже/);assert.match(dialog.textContent,/Отправить врачу/);
    assert.ok(within(dialog).getByRole('button',{name:'На главную'}));
    await user.click(within(dialog).getByRole('button',{name:'Понятно'}));assert.equal(document.activeElement===help,true);
    if(!completed){
      await user.type(screen.getByRole('textbox',{name:'Что сделать удобнее?'}),'Не терять текущий ответ');
      await user.click(help);dialog=await screen.findByRole('dialog',{name:'Опрос врача'});
      await user.click(within(dialog).getByRole('button',{name:'На главную'}));
      const guard=await screen.findByRole('dialog',{name:'Сохранить ответы перед уходом?'});
      assert.equal(dom.window.location.search,'?section=overview&assignment=30');
      await user.click(within(guard).getByRole('button',{name:'Остаться в опросе'}));
      assert.equal(screen.getByRole('textbox',{name:'Что сделать удобнее?'}).value,'Не терять текущий ответ');
    }
    const main=screen.getByRole('main');await user.click(within(main).getByRole('button',{name:'Опросы врача',exact:true}));
    if(!completed){const guard=await screen.findByRole('dialog',{name:'Сохранить ответы перед уходом?'});await user.click(within(guard).getByRole('button',{name:'Уйти без сохранения'}));}
    await screen.findByRole('heading',{name:'Опросы врача',level:1});
    await user.click(help);dialog=await screen.findByRole('dialog',{name:'Опросы врача'});
    assert.equal(Boolean(within(dialog).queryByRole('heading',{name:'Опрос врача',exact:true})),false,'The list must regain its own generic guide');
    assert.equal(openings,completed?0:1,'Opening help or completed history must not manufacture another opening measurement');
  });
}
