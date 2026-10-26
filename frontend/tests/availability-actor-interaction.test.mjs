// Actual Workspace flow in a virtual DOM; no native layout, focus or backend-auth claim.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {act,createElement as h} from "react";

let dom,server,App,Interactions,render,screen,waitFor,cleanup,userEvent,unexpected;
const doctor1={id:1,display_name:"Первый тестовый врач",role:"doctor",patient_id:null,availability:"available"};
const doctor2={...doctor1,id:2,display_name:"Второй тестовый врач"};

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
  ({default:App}=await server.ssrLoadModule("/src/App.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"No unlisted request or clinical write is permitted in this fixture");});
after(async()=>{await server?.close();dom?.window.close();});

test("a delayed availability response cannot overwrite another signed-in doctor's status",async()=>{
  unexpected=[];
  sessionStorage.setItem("compass-token","fixture-doctor1");
  let finishPatch;
  const pendingPatch=new Promise(resolve=>{finishPatch=resolve;});
  const writes=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET"&&path==="/auth/me")return Response.json(doctor1);
    if(method==="GET"&&path==="/alerts/inbox?limit=1")return Response.json({total_open:0,not_presented:0,items:[],next_before_id:null});
    // The care-summary outage is intentional: this test isolates the persistent profile control.
    if(method==="GET"&&path==="/analytics/care")return Response.json({detail:"Сводка временно недоступна в этой фикстуре"},{status:503});
    if(method==="PATCH"&&path==="/doctors/me/availability"){
      writes.push({body:JSON.parse(options.body),authorization:options.headers.Authorization});
      return pendingPatch;
    }
    if(method==="POST"&&path==="/auth/login"&&JSON.parse(options.body).username==="doctor2")return Response.json({access_token:"fixture-doctor2",user:doctor2});
    if(method==="POST"&&path==="/auth/logout"&&options.headers.Authorization==="Bearer fixture-doctor1")return Response.json({revoked:true});
    unexpected.push({path,method});
    return Response.json({detail:"Unexpected test request"},{status:500});
  };
  render(h(Interactions,null,h(App)));
  const user=userEvent.setup({document:dom.window.document});
  const status=await screen.findByRole("combobox",{name:"Доступность врача"});
  await user.selectOptions(status,"busy");
  await waitFor(()=>assert.ok(status.disabled));
  assert.ok(screen.getByText("Сохраняем…"));
  await user.click(screen.getByRole("button",{name:"Выйти"}));
  await user.selectOptions(await screen.findByRole("combobox",{name:"Демонстрационная роль"}),"doctor2");
  await user.click(screen.getByRole("button",{name:"Войти",exact:true}));
  await screen.findByText(doctor2.display_name);
  const secondStatus=screen.getByRole("combobox",{name:"Доступность врача"});
  assert.equal(secondStatus.value,"available");
  assert.equal(secondStatus.disabled,false,"The old actor's pending state must not disable the new actor");
  await act(async()=>{finishPatch(Response.json({}));await pendingPatch;});
  assert.equal(secondStatus.value,"available");
  assert.equal(secondStatus.disabled,false);
  assert.ok(screen.getByText(doctor2.display_name));
  assert.deepEqual(writes,[{body:{availability:"busy"},authorization:"Bearer fixture-doctor1"}]);
});
