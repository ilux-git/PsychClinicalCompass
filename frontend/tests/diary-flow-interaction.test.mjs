// Actual PatientDiary interactions; mobile geometry and native validation are checked in CUA.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h,useState} from "react";
import {webcrypto} from "node:crypto";

let dom,server,Diary,Guard,useGuard,Interactions,render,screen,cleanup,userEvent,fireEvent,waitFor,unexpected;
const toggleName="Добавить наблюдения или уточнить время";
before(async()=>{
  // The phone's LAN HTTP origin has getRandomValues but no secure-context randomUUID.
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{getRandomValues:array=>webcrypto.getRandomValues(array)}});
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
  ({render,screen,cleanup,fireEvent,waitFor}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({PatientDiary:Diary}=await server.ssrLoadModule("/src/PatientDiary.tsx"));
  ({NavigationGuard:Guard,useNavigationGuard:useGuard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Unexpected transport must not hide missing fixture coverage");});
after(async()=>{await server?.close();dom?.window.close();});

function transport({failOnce=false,points=3}={}){
  unexpected=[];const writes=[];let entries=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(path==="/patients/2/diary"&&method==="GET")return Response.json({entries});
    if(path==="/diary/entries"&&method==="POST"){
      const body=JSON.parse(options.body);writes.push(body);
      if(failOnce&&writes.length===1)return Response.json({detail:"Тест: дневник временно недоступен"},{status:503});
      const saved={id:71,...body,created_at:"2026-10-25T00:00:00Z",source:"voluntary_patient_diary",is_clinical_scale:false,
        replayed:false,participation:{points,policy_version:"demo-test",recorded_at:"2026-10-25T00:00:00Z"}};
      entries=[saved];return Response.json(saved,{status:201});
    }
    unexpected.push({path,method});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  return writes;
}
function mount({notify=()=>{},progress=()=>{},exit=false}={}){
  function Harness(){
    const guard=useGuard(),[left,setLeft]=useState(false);
    if(left)return h("h1",null,"Другой раздел");
    return h("div",null,exit&&h("button",{onClick:()=>guard.run(()=>setLeft(true))},"Другой раздел"),h(Diary,{patientId:2,notify,progress}));
  }
  render(h(Interactions,null,h(Guard,null,h(Harness))));
  return userEvent.setup({document:dom.window.document});
}

test("a short private entry starts with text and saves the same canonical observation fields",async()=>{
  const writes=transport();let opened=0;
  const user=mount({progress:()=>opened++});
  await screen.findByText("Записей пока нет");
  const toggle=screen.getByRole("button",{name:toggleName});
  assert.equal(toggle.getAttribute("aria-expanded"),"false");
  assert.equal(Boolean(screen.queryByRole("combobox",{name:/Как Вы себя чувствовали/})),false);
  const text=screen.getByRole("textbox",{name:"Что хотите сохранить?"});
  assert.equal(text.closest("form").querySelector("input,textarea,select")===text,true);
  assert.equal(screen.getByRole("checkbox",{name:"Поделиться этой записью с лечащим врачом"}).checked,false);
  await user.type(text,"Короткое учебное наблюдение");
  await user.click(screen.getByRole("button",{name:"Сохранить запись"}));
  const confirmation=await screen.findByRole("heading",{name:"Запись сохранена"});
  assert.equal(document.activeElement===confirmation,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].text,"Короткое учебное наблюдение");
  assert.equal(writes[0].shared_with_doctor,false);
  assert.equal(writes[0].observation_kind,"moment");
  assert.equal(writes[0].feeling,null);assert.equal(writes[0].daily_impact,null);
  assert.equal(Number.isNaN(new Date(writes[0].observed_at).getTime()),false);
  assert.ok(screen.getByText("+3 балла за участие"));
  await user.click(screen.getByRole("button",{name:"Мой прогресс"}));
  assert.equal(opened,1);
});

test("optional observation values survive collapse and can be submitted without text",async()=>{
  const writes=transport({points:0});const user=mount();
  await screen.findByText("Записей пока нет");
  const toggle=screen.getByRole("button",{name:toggleName});await user.click(toggle);
  await user.selectOptions(screen.getByRole("combobox",{name:/Как Вы себя чувствовали/}),"neutral");
  await user.selectOptions(screen.getByRole("combobox",{name:/Влияние на повседневные дела/}),"some_interference");
  await user.selectOptions(screen.getByRole("combobox",{name:"О чём запись?"}),"day_summary");
  const observed="2026-10-24T12:30";
  fireEvent.change(screen.getByLabelText("Когда наблюдали?"),{target:{value:observed}});
  await user.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"),"false");
  await user.click(screen.getByRole("button",{name:"Сохранить запись"}));
  await screen.findByRole("heading",{name:"Запись сохранена"});
  assert.equal(writes.length,1);assert.equal(writes[0].text,"");
  assert.equal(writes[0].feeling,"neutral");assert.equal(writes[0].daily_impact,"some_interference");
  assert.equal(writes[0].observation_kind,"day_summary");
  assert.equal(writes[0].observed_at,new Date(observed).toISOString());
  assert.ok(screen.getByText("Сохранено без дополнительных баллов"));
});

test("invalid hidden observation time reopens its controls without submitting or losing text",async()=>{
  const writes=transport();const user=mount();
  await screen.findByText("Записей пока нет");
  await user.type(screen.getByRole("textbox",{name:"Что хотите сохранить?"}),"Текст остаётся");
  const toggle=screen.getByRole("button",{name:toggleName});await user.click(toggle);
  const time=screen.getByLabelText("Когда наблюдали?");
  fireEvent.change(time,{target:{value:""}});await user.click(toggle);
  await user.click(screen.getByRole("button",{name:"Сохранить запись"}));
  await waitFor(()=>assert.equal(toggle.getAttribute("aria-expanded"),"true"));
  assert.equal(writes.length,0);
  assert.equal(document.activeElement===time,true);
  assert.equal(screen.getByRole("textbox",{name:"Что хотите сохранить?"}).value,"Текст остаётся");
});

test("an inline server error retains private input and retries the same request without duplicate alerts",async()=>{
  const writes=transport({failOnce:true}),notices=[];const user=mount({notify:(...args)=>notices.push(args)});
  await screen.findByText("Записей пока нет");
  await user.type(screen.getByRole("textbox",{name:"Что хотите сохранить?"}),"Повтор без потери записи");
  await user.click(screen.getByRole("button",{name:"Сохранить запись"}));
  const error=await screen.findByRole("alert");
  assert.equal(document.activeElement===error,true);assert.deepEqual(notices,[]);
  assert.equal(screen.getByRole("textbox",{name:"Что хотите сохранить?"}).value,"Повтор без потери записи");
  assert.equal(screen.getByRole("checkbox",{name:"Поделиться этой записью с лечащим врачом"}).checked,false);
  await user.click(screen.getByRole("button",{name:"Сохранить запись"}));
  await screen.findByRole("heading",{name:"Запись сохранена"});
  assert.equal(writes.length,2);assert.equal(writes[0].client_request_id,writes[1].client_request_id);
  assert.equal(Boolean(screen.queryByRole("alert")),false);
});

test("the exit guard keeps a diary draft on stay and allows leaving after it is saved",async()=>{
  transport();const user=mount({exit:true});
  await screen.findByText("Записей пока нет");
  await user.type(screen.getByRole("textbox",{name:"Что хотите сохранить?"}),"Сохранить мой черновик");
  await user.click(screen.getByRole("button",{name:"Другой раздел"}));
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("button",{name:"Продолжить запись"}));
  assert.equal(screen.getByRole("textbox",{name:"Что хотите сохранить?"}).value,"Сохранить мой черновик");
  await user.click(screen.getByRole("button",{name:"Сохранить запись"}));
  await screen.findByRole("heading",{name:"Запись сохранена"});
  await user.click(screen.getByRole("button",{name:"Другой раздел"}));
  assert.ok(await screen.findByRole("heading",{name:"Другой раздел"}));
  assert.equal(Boolean(screen.queryByRole("dialog")),false);
});
