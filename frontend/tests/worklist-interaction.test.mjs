// Real Home → Board → TaskItem interactions, with an explicitly bounded synthetic transport.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h,useState} from "react";

let dom,server,Home,Board,Views,Interactions,Guard,usePrepare,render,screen,within,waitFor,cleanup,userEvent;
let unexpected=[];
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","HTMLDialogElement","SVGElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,within,waitFor,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({WorkspaceHome:Home}=await server.ssrLoadModule("/src/WorkspaceHome.tsx"));
  ({TaskBoard:Board}=await server.ssrLoadModule("/src/TaskBoard.tsx"));
  ({ViewStateProvider:Views,usePrepareViewState:usePrepare}=await server.ssrLoadModule("/src/ViewState.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"No unlisted reads or writes are accepted by this fixture");});
after(async()=>{await server?.close();dom?.window.close();});

const asOf="2026-10-25T12:00:00Z";
const task=(id,overrides={})=>({id,patient_id:2,patient_name:"Синтетический пациент",title:`Действие ${id}`,doctor_id:1,
  assigned_to_id:1,assignee_name:"Врач",kind:"clinical",status:"open",action_result:"",due_at:null,follow_up_at:null,
  source_type:"manual",source_id:null,verification_status:"pending",verification_comment:"",revision:1,...overrides});
function transport(initial,{homeFails=false,pageFails=false}={}){
  unexpected=[];let rows=structuredClone(initial);const reads=[],writes=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET")reads.push(path);
    if(path==="/analytics/care"&&method==="GET"){
      if(homeFails)return Response.json({detail:"QA: сводка недоступна"},{status:503});
      return Response.json({as_of:asOf,tasks:{open:rows.filter(t=>t.status==="open").length,
        in_progress:rows.filter(t=>t.status==="in_progress").length,action_done:rows.filter(t=>t.status==="done").length,
        verification:Object.fromEntries(["pending","resolved","not_resolved","unknown"].map(status=>[status,rows.filter(t=>t.verification_status===status).length]))}});
    }
    if(path.startsWith("/coordination/board?")&&method==="GET"){
      const params=new URL(path,"http://localhost").searchParams,focus=params.get("focus")??"all",stage=params.get("stage"),q=params.get("q")??"";
      if(pageFails&&params.has("before"))return Response.json({detail:"QA: следующая страница недоступна"},{status:503});
      let filtered=rows.filter(t=>(stage==="all"||t.status===stage)&&(!q||`${t.title} ${t.patient_name}`.includes(q)));
      if(focus==="active")filtered=filtered.filter(t=>t.status!=="done");
      if(focus==="awaiting_check")filtered=filtered.filter(t=>t.status==="done"&&t.verification_status==="pending");
      if(focus==="checked")filtered=filtered.filter(t=>t.status==="done"&&["resolved","not_resolved","unknown"].includes(t.verification_status));
      if(focus==="overdue")filtered=filtered.filter(t=>t.status!=="done"&&t.due_at&&t.due_at<asOf);
      filtered.sort((a,b)=>b.id-a.id);const total=filtered.length;
      if(params.has("before"))filtered=filtered.filter(t=>t.id<Number(params.get("before")));
      const items=filtered.slice(0,1);
      return Response.json({stage,focus,as_of:asOf,total,items,next_cursor:filtered.length>1?items.at(-1).id:null});
    }
    const match=path.match(/^\/tasks\/(\d+)(\/verify)?$/),current=match?rows.find(t=>t.id===Number(match[1])):null;
    if(current&&method==="GET"&&!match[2])return Response.json(current);
    if(current&&((method==="PATCH"&&!match[2])||(method==="POST"&&match[2]))){
      const body=JSON.parse(options.body);writes.push({method,path,body});
      assert.equal(body.expected_revision,current.revision);
      const saved=match[2]?{...current,verification_status:body.status,verification_comment:body.comment,revision:current.revision+1}:
        {...current,status:body.status,action_result:body.action_result,revision:current.revision+1};
      rows=rows.map(t=>t.id===current.id?saved:t);return Response.json(saved);
    }
    unexpected.push(`${method} ${path}`);return Response.json({detail:"Unexpected fixture request"},{status:500});
  };
  return {reads,writes};
}
function Harness(){
  const [view,setView]=useState("home"),prepare=usePrepare();
  return view==="home"?h("div",null,h("button",{onClick:()=>prepare({"doctor-board-search":"старый поиск","doctor-board-query":"старый поиск","doctor-board-focus":999,"doctor-board-worklist-focus":"checked","board-doctor-all-pagination":{query:"checked:",cursors:[99]}})},"Подготовить прежний поиск"),h(Home,{navigate:setView})):
    h(Board,{notify:()=>{}});
}
const mount=()=>render(h(Interactions,null,h(Guard,null,h(Views,{returnPoint:null,restored:()=>{}},h(Harness)))));
const user=()=>userEvent.setup({document:dom.window.document});
const choices=()=>within(screen.getByRole("group",{name:"Рабочие выборки"}));

test("home counters open the exact cohort and clear an unrelated search, focus and cursor",async()=>{
  const {reads,writes}=transport([task(1),task(2,{status:"done",action_result:"Сделано"}),task(3,{status:"done",verification_status:"unknown"})]);
  mount();await screen.findByRole("group",{name:"Выборки плана работы"});
  const u=user();await u.click(screen.getByRole("button",{name:"Подготовить прежний поиск"}));
  await u.click(screen.getByRole("button",{name:/^Проверить результат: 1\./}));
  await screen.findByRole("article",{name:"Синтетический пациент · Действие 2"});
  assert.equal(screen.getByRole("textbox",{name:"Поиск задачи или пациента"}).value,"");
  assert.equal(choices().getByRole("button",{name:"Проверить результат",exact:true}).getAttribute("aria-pressed"),"true");
  assert.deepEqual(reads.filter(path=>path.startsWith("/coordination/board?")),["/coordination/board?stage=all&q=&focus=awaiting_check"]);
  assert.equal(screen.queryByRole("article",{name:/Действие 3/}),null);
  assert.deepEqual(writes,[]);
});

test("a dirty verification survives staying, and changing the worklist resets pagination after confirmed discard",async()=>{
  const {reads,writes}=transport([task(1),task(2,{status:"done",action_result:"Сделано"}),task(3,{status:"done",action_result:"Сделано"})]);
  mount();await screen.findByRole("group",{name:"Выборки плана работы"});const u=user();
  await u.click(screen.getByRole("button",{name:/^Проверить результат: 2\./}));
  await screen.findByRole("article",{name:/Действие 3/});
  await u.click(screen.getByRole("button",{name:"Далее",exact:true}));
  const row=await screen.findByRole("article",{name:/Действие 2/});
  assert.equal(document.activeElement,within(screen.getByRole("region",{name:"Проверить результат",exact:true})).getByRole("heading",{level:2}),"A new page must move keyboard focus to its task list, not leave it on the document body");
  await u.click(within(row).getByRole("button",{name:"Действие и проверка"}));
  const comment=within(row).getByRole("textbox",{name:"На чём основан вывод"});await u.type(comment,"Незавершённая проверка");
  await u.click(choices().getByRole("button",{name:"Нужно выполнить",exact:true}));
  await screen.findByRole("dialog");await u.click(screen.getByRole("button",{name:"Продолжить работу с задачей"}));
  assert.equal(comment.value,"Незавершённая проверка");
  assert.equal(choices().getByRole("button",{name:"Проверить результат",exact:true}).getAttribute("aria-pressed"),"true");
  await u.click(choices().getByRole("button",{name:"Нужно выполнить",exact:true}));
  await screen.findByRole("dialog");await u.click(screen.getByRole("button",{name:"Уйти без сохранения"}));
  await screen.findByRole("article",{name:/Действие 1/});
  assert.ok(screen.getByText("Страница 1"));
  assert.equal(reads.at(-1),"/coordination/board?stage=all&q=&focus=active");assert.deepEqual(writes,[]);
});

test("saving an action moves to awaiting verification, then an explicit unknown check moves to checked",async()=>{
  const {writes}=transport([task(1)]);mount();await screen.findByRole("group",{name:"Выборки плана работы"});const u=user();
  await u.click(screen.getByRole("button",{name:"Открыть план работы",exact:true}));
  await screen.findByRole("article",{name:/Действие 1/});await u.click(screen.getByRole("button",{name:"Принять и выполнить"}));
  await u.type(screen.getByRole("textbox",{name:"Что сделано"}),"Связался с пациентом");
  await u.click(screen.getByRole("button",{name:"Действие выполнено",exact:true}));
  await screen.findByRole("heading",{name:"Проверка результата"});
  assert.equal(choices().getByRole("button",{name:"Проверить результат",exact:true}).getAttribute("aria-pressed"),"true");
  assert.equal(writes.length,1,"Saving an action must not silently save a check");
  await u.type(screen.getByRole("textbox",{name:"На чём основан вывод"}),"Повторного ответа пока нет");
  await u.click(screen.getByRole("button",{name:"Сохранить проверку результата"}));
  await screen.findByText("Результат неизвестен");
  assert.equal(choices().getByRole("button",{name:"Проверенные результаты",exact:true}).getAttribute("aria-pressed"),"true");
  assert.deepEqual(writes.map(write=>[write.method,write.path]),[["PATCH","/tasks/1"],["POST","/tasks/1/verify"]]);
  assert.deepEqual(writes[1].body,{status:"unknown",comment:"Повторного ответа пока нет",expected_revision:2});
});

test("an unavailable summary is not a zero workload and still offers the independently loaded plan",async()=>{
  const {writes}=transport([task(1)],{homeFails:true});mount();
  await screen.findByText("QA: сводка недоступна");
  assert.equal(screen.queryByRole("group",{name:"Выборки плана работы"}),null);
  await user().click(screen.getByRole("button",{name:"Открыть план работы",exact:true}));
  await screen.findByRole("article",{name:/Действие 1/});assert.deepEqual(writes,[]);
});

test("a failed next page focuses its error and offers a return to the previously loaded cohort",async()=>{
  const {reads,writes}=transport([task(2,{status:"done",action_result:"Сделано"}),task(3,{status:"done",action_result:"Сделано"})],{pageFails:true});
  mount();await screen.findByRole("group",{name:"Выборки плана работы"});const u=user();
  await u.click(screen.getByRole("button",{name:/^Проверить результат: 2\./}));
  await screen.findByRole("article",{name:/Действие 3/});
  await u.click(screen.getByRole("button",{name:"Далее",exact:true}));
  await screen.findByText("QA: следующая страница недоступна");
  await waitFor(()=>assert.equal(document.activeElement,screen.getByRole("alert")));
  await u.click(screen.getByRole("button",{name:"К предыдущей странице",exact:true}));
  await screen.findByRole("article",{name:/Действие 3/});
  assert.ok(screen.getByText("Страница 1"));
  assert.equal(document.activeElement,within(screen.getByRole("region",{name:"Проверить результат",exact:true})).getByRole("heading",{level:2}));
  assert.equal(reads.filter(path=>path.includes("before=")).length,1,"Only an explicit page change sends the failing request");
  assert.deepEqual(writes,[]);
});
