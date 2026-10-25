// Client behavior in a virtual DOM; fake transport and fixture tokens never reach a server.
import {after,afterEach,before,beforeEach,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {act,createElement as h} from "react";

let dom,server,client,App,Interactions,render,screen,waitFor,cleanup,userEvent,unexpected;
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage","localStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  ({render,screen,waitFor,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  client=await server.ssrLoadModule("/src/api.ts");
  ({default:App}=await server.ssrLoadModule("/src/App.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
beforeEach(()=>{unexpected=[];sessionStorage.clear();localStorage.clear();dom.window.history.replaceState(null,"","/");});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Only explicitly listed fixture requests are allowed");});
after(async()=>{await server?.close();dom?.window.close();});

async function rejectedRequest(status,newSession){
  sessionStorage.setItem("compass-token","fixture-original");
  let finish,expired=0;
  const waiting=new Promise(resolve=>{finish=resolve;});
  const onExpired=()=>expired++;
  window.addEventListener("compass-auth-expired",onExpired);
  globalThis.fetch=async()=>waiting;
  try {
    const result=client.api("/patients/1").catch(error=>error);
    if(newSession)sessionStorage.setItem("compass-token","fixture-new-session");
    finish(Response.json({detail:"Fixture access rejected"},{status}));
    const error=await result;
    assert.ok(error instanceof client.ApiError);
    assert.equal(error.status,status,"The rejected request must remain rejected");
    return expired;
  } finally {window.removeEventListener("compass-auth-expired",onExpired);}
}
test("AUTH-STALE-401: an old request does not expire a newer signed-in session",async()=>{
  assert.equal(await rejectedRequest(401,true),0);
  assert.equal(sessionStorage.getItem("compass-token"),"fixture-new-session");
});
test("AUTH-CURRENT-401: rejection of the current session still requests sign-out",async()=>{
  assert.equal(await rejectedRequest(401,false),1);
});
test("AUTH-FORBIDDEN-403: access denial remains an error without expiring the session",async()=>{
  assert.equal(await rejectedRequest(403,false),0);
});

test("ACTOR-NOTICE: a completed old note cannot display success to the next signed-in doctor",async()=>{
  const first={id:1,display_name:"Первый тестовый врач",role:"doctor",patient_id:null,availability:"available"};
  const second={...first,id:2,display_name:"Второй тестовый врач"};
  const patient={id:1,full_name:"Синтетический пациент",mis_id:101,doctor_id:1,created_at:"2026-10-20T10:00:00Z",mis:{source:"synthetic-mis",status:"available",diagnoses:[],prescriptions:[]},doctor:{name:first.display_name,availability:"available"}};
  const readReplies=new Map([["/patients/1",patient],["/survey-assignments?patient_id=1",[]],["/patients/1/assessments",[]],["/patients/1/notes",[]],["/patients/1/adherence",{reports:[]}],["/alerts?patient_id=1",[]],["/surveys",[]]]);
  sessionStorage.setItem("compass-token","fixture-doctor1");
  dom.window.history.replaceState(null,"","/?section=patients&patient=1&tab=feedback");
  let finishNote;
  const waiting=new Promise(resolve=>{finishNote=resolve;});
  const writes=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET"&&path==="/auth/me")return Response.json(first);
    if(method==="GET"&&path==="/alerts/inbox?limit=1")return Response.json({total_open:0,not_presented:0,items:[],next_before_id:null});
    if(method==="GET"&&path==="/analytics/care")return Response.json({detail:"Сводка не используется в этой проверке"},{status:503});
    if(method==="GET"&&readReplies.has(path)&&options.headers.Authorization==="Bearer fixture-doctor1")return Response.json(readReplies.get(path));
    if(method==="POST"&&path==="/patients/1/notes"){
      writes.push({path,authorization:options.headers.Authorization});
      return waiting;
    }
    if(method==="POST"&&path==="/auth/login"&&JSON.parse(options.body).username==="doctor2")return Response.json({access_token:"fixture-doctor2",user:second});
    unexpected.push({path,method});
    return Response.json({detail:"Unexpected test request"},{status:500});
  };
  render(h(Interactions,null,h(App)));
  const user=userEvent.setup({document:dom.window.document});
  await screen.findByRole("heading",{level:1,name:patient.full_name});
  await user.click(screen.getByRole("button",{name:"Добавить приватную заметку"}));
  await user.type(screen.getByRole("textbox",{name:"Текст приватной заметки"}),"Тест");
  await user.click(screen.getByRole("button",{name:"Сохранить заметку"}));
  await waitFor(()=>assert.equal(writes.length,1));
  // Actual auth-expiry entry point must clear the first workspace even during its pending write.
  await act(async()=>{window.dispatchEvent(new Event("compass-auth-expired"));});
  await user.selectOptions(await screen.findByRole("combobox",{name:"Демонстрационная роль"}),"doctor2");
  await user.click(screen.getByRole("button",{name:"Войти",exact:true}));
  await screen.findByText(second.display_name);
  await act(async()=>{finishNote(Response.json({}));await waiting;});
  assert.ok(screen.getByText(second.display_name));
  assert.equal(Boolean(screen.queryByText("Приватная заметка сохранена")),false,"The previous doctor's success must not be shown to the current doctor");
  assert.deepEqual(writes,[{path:"/patients/1/notes",authorization:"Bearer fixture-doctor1"}]);
});
