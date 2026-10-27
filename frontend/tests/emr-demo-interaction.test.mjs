// Actual component transitions in JSDOM; layout and backend permissions are verified separately.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {act,createElement as h} from "react";

let dom,server,EmrDemo,render,screen,waitFor,cleanup,userEvent,unexpected;
const path="/patients/1/tasks/4/emr-preview";
const confirmation="Проверил(а) пациента и содержимое пакета";
function example(revision=0){return {task_id:4,task_revision:revision,patient_name:"Тестовый пациент",content_hash:String(revision+1).repeat(64),latest_document:null,
  content:{schema_version:"limbus-emr-demo/1",synthetic:true,patient_reference:{system:"synthetic-mis",id:11},
    source:{submitted_at:"2026-10-25T12:00:00Z",survey:{title:"Затруднения",version:2,questions:[{id:"barrier",prompt:"Что мешает?",kind:"text",options:[]}]},answers:{barrier:"Не подходит расписание"}},
    care:{title:`Обсудить время ${revision}`,status:"open",action_result:"",verification:{status:"pending",comment:""}},signature:{kind:"simulation",legally_valid:false}}};}
function approved(data){return {id:9,content:data.content,content_hash:data.content_hash,task_revision:data.task_revision,
  approved_at:"2026-10-26T00:00:00Z",status:"approved",is_current:true,receipt:null};}
function accepted(data){return {...approved(data),status:"accepted_by_simulator",receipt:{id:3,accepted_at:"2026-10-26T00:01:00Z",external_delivery:false}};}

before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage","localStorage"])
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  ({render,screen,waitFor,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({EmrDemo}=await server.ssrLoadModule("/src/EmrDemo.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"No unlisted request or real MIS write is permitted");});
after(async()=>{await server?.close();dom?.window.close();});

function fixture(handler){
  unexpected=[];sessionStorage.clear();sessionStorage.setItem("compass-token","synthetic-doctor");
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??"GET";
    const result=await handler(url,method,options);
    if(result)return result;
    unexpected.push({url,method});return Response.json({detail:"Unlisted request"},{status:500});
  };
}

test("preview never approves automatically; exact consent and a second action lead to a simulator receipt",async()=>{
  const data=example(),writes=[];
  fixture((url,method,options)=>{
    if(url===path&&method==="GET")return Response.json(data);
    writes.push({url,method,body:JSON.parse(options.body),authorization:options.headers.Authorization});
    if(url==="/patients/1/emr-documents"&&method==="POST")return Response.json(approved(data));
    if(url==="/patients/1/emr-documents/9/simulate-transfer"&&method==="POST")return Response.json(accepted(data));
  });
  render(h(EmrDemo,{patientId:1,taskId:4,taskRevision:0}));
  const user=userEvent.setup({document:dom.window.document});
  const approve=await screen.findByRole("button",{name:"Одобрить этот пакет"});
  assert.equal(approve.disabled,true);assert.equal(writes.length,0);
  assert.ok(screen.getByText("Не подходит расписание"));
  await user.click(screen.getByRole("checkbox",{name:confirmation}));
  await user.click(approve);
  const transfer=await screen.findByRole("button",{name:"Передать документ"});
  assert.equal(writes.length,1,"Approval must never automatically transfer");
  assert.equal(writes[0].body.content_hash,data.content_hash);
  assert.equal(writes[0].body.expected_task_revision,0);
  assert.equal(writes[0].body.confirmed,true);
  assert.equal(writes[0].authorization,"Bearer synthetic-doctor");
  assert.equal(document.activeElement,screen.getByRole("heading",{name:"Одобрено Вами"}));
  await user.click(transfer);
  await screen.findByRole("heading",{name:"Квитанция получена"});
  assert.equal(writes.length,2);
  assert.deepEqual(writes[1].body,{content_hash:data.content_hash,confirmed:true});
  assert.equal(screen.queryByRole("button",{name:"Передать документ"}),null);
});

test("approval failure retains consent and uses the same request key on retry",async()=>{
  const data=example(),writes=[];
  fixture((url,method,options)=>{
    if(url===path&&method==="GET")return Response.json(data);
    if(url==="/patients/1/emr-documents"&&method==="POST"){
      writes.push(JSON.parse(options.body));return writes.length===1?Response.json({detail:"Временный отказ"},{status:503}):Response.json(approved(data));
    }
  });
  render(h(EmrDemo,{patientId:1,taskId:4,taskRevision:0}));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(await screen.findByRole("checkbox",{name:confirmation}));
  await user.click(screen.getByRole("button",{name:"Одобрить этот пакет"}));
  const retry=await screen.findByRole("button",{name:"Повторить одобрение"});
  assert.equal(screen.getByRole("checkbox",{name:confirmation}).checked,true);
  assert.equal(screen.getAllByRole("alert").length,1);
  await user.click(retry);
  await screen.findByRole("heading",{name:"Одобрено Вами"});
  assert.deepEqual(writes[0],writes[1]);
});

test("conflict requires a fresh preview and new consent, even when the parent still holds an older task revision",async()=>{
  let data=example(),reads=0;
  const writes=[];
  fixture((url,method,options)=>{
    if(url===path&&method==="GET"){reads+=1;return Response.json(data);}
    if(url==="/patients/1/emr-documents"&&method==="POST"){
      writes.push(JSON.parse(options.body));return writes.length===1?Response.json({detail:"Сведения изменились"},{status:409}):Response.json(approved(data));
    }
  });
  render(h(EmrDemo,{patientId:1,taskId:4,taskRevision:0}));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(await screen.findByRole("checkbox",{name:confirmation}));
  await user.click(screen.getByRole("button",{name:"Одобрить этот пакет"}));
  const refresh=await screen.findByRole("button",{name:"Обновить предпросмотр"});
  assert.equal(screen.getByRole("button",{name:"Повторить одобрение"}).disabled,true);
  data=example(1);
  await user.click(refresh);
  await screen.findByText("Обсудить время 1");
  assert.equal(screen.getByRole("checkbox",{name:confirmation}).checked,false);
  await user.click(screen.getByRole("checkbox",{name:confirmation}));
  await user.click(screen.getByRole("button",{name:"Одобрить этот пакет"}));
  await screen.findByRole("heading",{name:"Одобрено Вами"});
  assert.equal(reads,2);
  assert.equal(writes[1].expected_task_revision,1);
  assert.notEqual(writes[0].client_request_id,writes[1].client_request_id);
});

test("failed simulator transfer keeps the approved document and retries only delivery",async()=>{
  const data={...example(),latest_document:approved(example())};
  let transfers=0;
  fixture((url,method)=>{
    if(url===path&&method==="GET")return Response.json(data);
    if(url==="/patients/1/emr-documents/9/simulate-transfer"&&method==="POST"){
      transfers+=1;return transfers===1?Response.json({detail:"Симулятор недоступен"},{status:503}):Response.json(accepted(data));
    }
  });
  render(h(EmrDemo,{patientId:1,taskId:4,taskRevision:0}));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(await screen.findByRole("button",{name:"Передать документ"}));
  const retry=await screen.findByRole("button",{name:"Повторить передачу"});
  assert.ok(screen.getByRole("heading",{name:"Одобрено Вами"}));
  assert.equal(screen.queryByRole("button",{name:"Одобрить этот пакет"}),null);
  await user.click(retry);
  await screen.findByRole("heading",{name:"Квитанция получена"});
  assert.equal(transfers,2);
});

test("late approval for an older task revision cannot mark the new version approved or leave it busy",async()=>{
  let data=example(),finish;
  const old=data,pending=new Promise(resolve=>{finish=resolve;});
  fixture((url,method)=>{
    if(url===path&&method==="GET")return Response.json(data);
    if(url==="/patients/1/emr-documents"&&method==="POST")return pending;
  });
  const view=render(h(EmrDemo,{patientId:1,taskId:4,taskRevision:0}));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(await screen.findByRole("checkbox",{name:confirmation}));
  await user.click(screen.getByRole("button",{name:"Одобрить этот пакет"}));
  data=example(1);
  view.rerender(h(EmrDemo,{patientId:1,taskId:4,taskRevision:1}));
  await screen.findByText("Обсудить время 1");
  await act(async()=>{finish(Response.json(approved(old)));await pending;});
  assert.equal(screen.queryByRole("heading",{name:"Одобрено Вами"}),null);
  await waitFor(()=>assert.equal(screen.getByRole("checkbox",{name:confirmation}).disabled,false));
});

test("unsaved task disables the preview without reading or writing",async()=>{
  fixture(()=>undefined);
  render(h(EmrDemo,{patientId:1,taskId:4,taskRevision:0,disabled:true}));
  assert.ok(screen.getByText(/Сначала завершите сохранение/));
  assert.equal(screen.queryByRole("button",{name:"Одобрить этот пакет"}),null);
});

test("pending action preserves its focus, blocks duplicate writes and respects a later focus choice",async()=>{
  const data=example();let finish,writes=0;
  const pending=new Promise(resolve=>{finish=resolve;});
  fixture((url,method)=>{
    if(url===path&&method==="GET")return Response.json(data);
    if(url==="/patients/1/emr-documents"&&method==="POST"){writes+=1;return pending;}
  });
  render(h(EmrDemo,{patientId:1,taskId:4,taskRevision:0}));
  const user=userEvent.setup({document:dom.window.document});
  await user.click(await screen.findByRole("checkbox",{name:confirmation}));
  const button=screen.getByRole("button",{name:"Одобрить этот пакет"});
  await user.click(button);
  assert.equal(button.disabled,false,"Native disabling would blur this control while waiting");
  assert.equal(button.getAttribute("aria-disabled"),"true");
  assert.equal(document.activeElement,button);
  await user.click(button);
  assert.equal(writes,1);
  const json=screen.getByText("Показать JSON-пакет");
  await user.click(json);
  assert.equal(document.activeElement,json);
  await act(async()=>{finish(Response.json(approved(data)));await pending;});
  await screen.findByRole("heading",{name:"Одобрено Вами"});
  assert.equal(document.activeElement,json,"A completed write must not steal a newer focus choice");
});
