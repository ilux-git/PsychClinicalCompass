// Actual App transitions; backend revocation is separately covered by test_auth_guards.py.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {act,createElement as h} from "react";

let dom,server,App,Interactions,render,screen,waitFor,cleanup,userEvent,unexpected;
const first={id:1,display_name:"Первый тестовый врач",role:"doctor",patient_id:null,availability:"available"};
const second={...first,id:2,display_name:"Второй тестовый врач"};
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage","localStorage"])
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
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
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Only listed authentication and overview requests are permitted");});
after(async()=>{await server?.close();dom?.window.close();});

async function setup(logoutResponse,{expired=false}={}){
  unexpected=[];sessionStorage.clear();localStorage.clear();window.history.replaceState(null,"","/");
  sessionStorage.setItem("compass-token","first-credential");
  const exits=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET"&&path==="/auth/me")return expired?Response.json({detail:"Expired"},{status:401}):Response.json(first);
    if(method==="GET"&&path==="/alerts/inbox?limit=1")return Response.json({total_open:0,not_presented:0,items:[],next_before_id:null});
    if(method==="GET"&&path==="/analytics/care")return Response.json({detail:"Сводка недоступна в этой фикстуре"},{status:503});
    if(method==="POST"&&path==="/auth/logout"){
      exits.push({authorization:options.headers.Authorization,body:options.body});return logoutResponse();
    }
    if(method==="POST"&&path==="/auth/login"&&JSON.parse(options.body).username==="doctor2")return Response.json({access_token:"second-credential",user:second});
    unexpected.push({path,method});return Response.json({detail:"Unlisted request"},{status:500});
  };
  render(h(Interactions,null,h(App)));
  const user=userEvent.setup({document:dom.window.document});
  if(!expired)await screen.findByText(first.display_name);
  return {user,exits};
}

test("explicit exit clears local access immediately and confirms revocation of its captured credential",async()=>{
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const {user,exits}=await setup(()=>pending);
  await user.click(screen.getByRole("button",{name:"Выйти",exact:true}));
  await screen.findByRole("button",{name:"Войти",exact:true});
  assert.equal(sessionStorage.getItem("compass-token"),null);
  assert.deepEqual(exits,[{authorization:"Bearer first-credential",body:undefined}]);
  await act(async()=>{finish(Response.json({revoked:true}));await pending;});
  assert.ok(screen.getByText("Вы вышли из учётной записи."));
});

test("failed revocation still exits locally and says server completion is unconfirmed",async()=>{
  const {user}=await setup(()=>{throw new Error("offline");});
  await user.click(screen.getByRole("button",{name:"Выйти",exact:true}));
  assert.equal(sessionStorage.getItem("compass-token"),null);
  await screen.findByText("Вы вышли на этом устройстве. Завершение сессии на сервере не подтверждено.");
  assert.equal(screen.queryByText("Вы вышли из учётной записи."),null);
});

for(const result of ["success","unauthorized"])test(`late ${result} logout response cannot clear a newer account or attach its notice`,async()=>{
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const {user,exits}=await setup(()=>pending);
  await user.click(screen.getByRole("button",{name:"Выйти",exact:true}));
  await user.selectOptions(await screen.findByRole("combobox",{name:"Демонстрационная роль"}),"doctor2");
  await user.click(screen.getByRole("button",{name:"Войти",exact:true}));
  await screen.findByText(second.display_name);
  await act(async()=>{finish(result==="success"?Response.json({revoked:true}):Response.json({detail:"Expired old session"},{status:401}));await pending;});
  assert.equal(sessionStorage.getItem("compass-token"),"second-credential");
  assert.ok(screen.getByText(second.display_name));
  assert.equal(screen.queryByText(/Вы вышли/),null);
  assert.equal(exits.length,1);
});

test("automatic expiry returns to login without recursively requesting logout",async()=>{
  const {exits}=await setup(()=>{throw new Error("Automatic expiry must not POST");},{expired:true});
  await screen.findByRole("button",{name:"Войти",exact:true});
  await waitFor(()=>assert.equal(sessionStorage.getItem("compass-token"),null));
  assert.deepEqual(exits,[]);
});
