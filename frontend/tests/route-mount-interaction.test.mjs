// Actual Workspace with no animation frames: navigation must not await an exit callback.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,App,Interactions,render,screen,cleanup,userEvent,unexpected;
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","HTMLDialogElement","SVGElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage","localStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  // Deliberately never deliver RAF. This is a bounded virtual-DOM failure-mode fixture.
  dom.window.requestAnimationFrame=()=>1;dom.window.cancelAnimationFrame=()=>{};
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame;
  dom.window.matchMedia=query=>({matches:false,media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({default:App}=await server.ssrLoadModule("/src/App.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Only explicitly listed synthetic requests are allowed");});
after(async()=>{await server?.close();dom?.window.close();});

test("route content mounts without animation callbacks while a draft still requires an explicit decision",async()=>{
  unexpected=[];sessionStorage.clear();localStorage.clear();
  const patient={id:3,display_name:"Мария Тестовая",role:"patient",patient_id:2,availability:"available"};
  const unavailable=new Set(["/survey-assignments","/participation/me","/patients/2","/participation/points","/participation/care-progress","/patients/2/assessments"]);
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(path==="/auth/login"&&method==="POST")return Response.json({access_token:"fixture-patient2",user:patient});
    if(method==="GET"&&unavailable.has(path))return Response.json({detail:"Сводка недоступна в этой транспортной фикстуре"},{status:503});
    if(method==="GET"&&path==="/patients/2/diary")return Response.json({entries:[]});
    if(method==="GET"&&path.startsWith("/patients/2/medications?on="))return Response.json({items:[],events:[],historical_reports:[],recent_reports:[],source:{status:"synthetic"}});
    unexpected.push({path,method});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  render(h(Interactions,null,h(App)));
  const user=userEvent.setup({document:dom.window.document});
  await user.selectOptions(screen.getByRole("combobox",{name:"Демонстрационная роль"}),"patient2");
  await user.click(screen.getByRole("button",{name:"Войти",exact:true}));
  await screen.findByRole("heading",{name:"Здравствуйте, Мария"});
  await user.click(screen.getByRole("link",{name:/^Дневник\s*Записать/}));
  assert.equal(Boolean(screen.queryByRole("heading",{name:"Мой дневник"})),true,"The newly selected route cannot wait for a frame or exit animation");
  assert.equal(Boolean(screen.queryByRole("heading",{name:"Здравствуйте, Мария"})),false);
  assert.equal(dom.window.location.search,"?section=diary");
  await user.type(screen.getByRole("textbox",{name:"Что хотите сохранить?"}),"Учебный черновик");
  await user.click(screen.getByRole("link",{name:/^Лекарства\s*Расписание/}));
  await screen.findByRole("dialog");
  assert.equal(dom.window.location.search,"?section=diary","Blocked navigation must retain the current route");
  await user.click(screen.getByRole("button",{name:"Продолжить запись"}));
  assert.equal(screen.getByRole("textbox",{name:"Что хотите сохранить?"}).value,"Учебный черновик");
  await user.click(screen.getByRole("link",{name:/^Лекарства\s*Расписание/}));
  await user.click(screen.getByRole("button",{name:"Уйти без сохранения"}));
  assert.equal(Boolean(screen.queryByRole("heading",{name:"Моё расписание лекарств"})),true);
  assert.equal(Boolean(screen.queryByRole("textbox",{name:"Что хотите сохранить?"})),false,"The old form must be unmounted, not left interactive behind an exit");
  assert.equal(dom.window.location.search,"?section=medications");
});
