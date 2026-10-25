// Actual aggregate-only dashboard; no clinical lookup or write is accepted.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Dashboard,Interactions,render,screen,cleanup,userEvent,unexpected;
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
  ({render,screen,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({AdminDashboard:Dashboard}=await server.ssrLoadModule("/src/AdminDashboard.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"The administrator must only request the aggregate endpoint");});
after(async()=>{await server?.close();dom?.window.close();});

function transport(){
  unexpected=[];let reads=0,fail=false;
  const group=(reference,kind="text")=>({reference,dimension:"approach_trust",kind,suppressed:false,reason:null,values:{responding_patients:7,options:kind==="text"?[]:[{value:"1",count:5},{value:"2",count:2}]}});
  const data={status:"available",privacy:{min_group_size:5},cohort:null,dimensions:[],journey:null,barriers:null,adherence:null,workflow:null,sources:[],distributions_suppressed:false,
    distributions:[group("S6/V1/Q2"),group("S6/V1/Q3","single")]};
  globalThis.fetch=async(path,options={})=>{
    if(path==="/analytics/clinic"&&(options.method??"GET")==="GET"){
      reads++;return fail?Response.json({detail:"Учебный отказ обновления"},{status:503}):Response.json(data);
    }
    unexpected.push({path,method:options.method??"GET"});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  return {reads:()=>reads,setFailure:value=>{fail=value;}};
}
function mount(){render(h(Interactions,null,h(Dashboard,{view:"barriers"})));return userEvent.setup({document:dom.window.document});}

test("aggregate question versions use readable separate labels without merging groups or exposing answer text",async()=>{
  const requests=transport();mount();
  await screen.findByRole("heading",{name:"Распределения по версиям вопросов"});
  assert.equal(Boolean(screen.queryByText("Опрос 6 · Версия 1 · Вопрос 2")),true,"The administrator should not have to decode S6/V1/Q2");
  assert.ok(screen.getByText("Опрос 6 · Версия 1 · Вопрос 3"));
  const headings=screen.getAllByRole("heading",{name:"Лояльность · доверие подходу",level:3});
  assert.equal(headings.length,2,"Question groups must remain separate even within the same dimension and version");
  assert.equal(screen.getAllByText("Ответивших: 7").length,2);
  assert.ok(screen.getByText("Тексты ответов в административной сводке не раскрываются."));
  assert.ok(screen.getByText("Вариант 1"));
  assert.equal(Boolean(screen.queryByRole("link")),false);
  assert.equal(requests.reads(),1);
});

test("failed refresh retains the last aggregate report, names it stale and retries without requesting patients",async()=>{
  const requests=transport();const user=mount();
  await screen.findByRole("heading",{name:"Распределения по версиям вопросов"});
  requests.setFailure(true);
  await user.click(screen.getByRole("button",{name:"Обновить сводку"}));
  const error=await screen.findByRole("alert");assert.match(error.textContent,/Учебный отказ обновления/);
  assert.ok(screen.getByText(/Ниже — последняя полученная сводка/));
  assert.equal(screen.getAllByText("Ответивших: 7").length,2);
  requests.setFailure(false);
  await user.click(screen.getByRole("button",{name:"Повторить"}));
  await screen.findByRole("button",{name:"Обновить сводку"});
  assert.equal(Boolean(screen.queryByRole("alert")),false);
  assert.equal(Boolean(screen.queryByText(/Ниже — последняя полученная сводка/)),false);
  assert.equal(requests.reads(),3);
});
