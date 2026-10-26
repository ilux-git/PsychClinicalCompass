// Actual Journey and Home controls; synthetic transport rejects unlisted writes.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Journey,Summary,Interactions,Guard,render,screen,within,waitFor,cleanup,userEvent,unexpected=[];
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
  ({PatientJourney:Journey,PatientRewardSummary:Summary}=await server.ssrLoadModule("/src/PatientJourney.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[]);});
after(async()=>{await server?.close();dom?.window.close();});

const points=preference=>({balance:113,earned_total:113,reserved_points:0,catalog_version:"qa-only",
  preference,offers:[],coupons:[],rules:[],history:[],activity:[],principles:[],next_reset_at:"2026-10-26T00:00:00Z"});
function transport(initial,{fail=false}={}){
  unexpected=[];let current=structuredClone(initial);const writes=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(path==="/participation/points"&&method==="GET")return Response.json(current);
    if(path==="/participation/preferences"&&method==="PUT"){
      const body=JSON.parse(options.body);writes.push(body);
      if(fail)return Response.json({detail:"QA: выбор не сохранён"},{status:503});
      current={...current,preference:{...current.preference,patient_choice:body.mode,effective_mode:body.mode}};
      return Response.json(current.preference);
    }
    unexpected.push(`${method} ${path}`);return Response.json({detail:"Unexpected fixture request"},{status:500});
  };
  return {writes};
}
const mount=element=>render(h(Interactions,null,h(Guard,null,element)));

test("three journey choices show the effective mode without writing a patient override on entry",async()=>{
  for(const preference of [
    {patient_choice:null,doctor_recommendation:null,effective_mode:"map"},
    {patient_choice:null,doctor_recommendation:"rhythm",effective_mode:"rhythm"},
    {patient_choice:"calm",doctor_recommendation:"map",effective_mode:"calm"},
  ]){
    const {writes}=transport(points(preference));
    mount(h(Journey,{notify:()=>{}}));
    const select=await screen.findByRole("combobox",{name:"Вид прогресса"});
    assert.equal(within(select).getAllByRole("option").length,3);
    assert.deepEqual(within(select).getAllByRole("option").map(el=>el.textContent),["Карта участия","Мой ритм","Спокойный режим"]);
    assert.equal(select.value,preference.effective_mode);
    const description=document.getElementById(select.getAttribute("aria-describedby"));
    assert.ok(description);
    assert.match(description.textContent,/Опросы, история и баллы сохраняются/);
    assert.deepEqual(writes,[],"Viewing a doctor's recommendation must not save a patient choice");
    cleanup();
  }
});

test("a failed explicit choice keeps the effective mode and retries only the user's next action",async()=>{
  const preference={patient_choice:null,doctor_recommendation:"rhythm",effective_mode:"rhythm"};
  const {writes}=transport(points(preference),{fail:true}),notices=[];
  mount(h(Journey,{notify:(...args)=>notices.push(args)}));
  const select=await screen.findByRole("combobox",{name:"Вид прогресса"});
  const user=userEvent.setup({document:dom.window.document});
  await user.selectOptions(select,"calm");
  await waitFor(()=>assert.equal(notices.length,1));
  await waitFor(()=>assert.equal(select.disabled,false));
  assert.equal(select.value,"rhythm");
  assert.match(notices[0][0],/QA: выбор не сохранён/);
  assert.deepEqual(writes,[{mode:"calm"}]);
  await user.selectOptions(select,"map");
  await waitFor(()=>assert.equal(notices.length,2));
  assert.deepEqual(writes,[{mode:"calm"},{mode:"map"}]);
  assert.equal(select.value,"rhythm");
});

test("home uses the same three mode names and changes only after an explicit selection",async()=>{
  const d=points({patient_choice:null,doctor_recommendation:"rhythm",effective_mode:"rhythm"});
  const {writes}=transport(d);
  mount(h(Summary,{result:{data:d,error:"",loading:false,reload:()=>{}},notify:()=>{},navigate:()=>{}}));
  const select=screen.getByRole("combobox",{name:"Вид прогресса"});
  assert.deepEqual(within(select).getAllByRole("option").map(el=>el.textContent),["Карта участия","Мой ритм","Спокойный режим"]);
  assert.equal(select.value,"rhythm");assert.deepEqual(writes,[]);
  await userEvent.setup({document:dom.window.document}).selectOptions(select,"calm");
  await waitFor(()=>assert.deepEqual(writes,[{mode:"calm"}]));
});
