// React behavior only; native focus restoration and geometry are verified in CUA.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h,useState} from "react";

let dom,server,Dashboard,Views,Interactions,render,screen,cleanup,userEvent,unexpected;
const quotes=Array.from({length:7},(_,index)=>({
  patient_id:index+1,patient_name:`Пациент ${index+1}`,assignment_id:101+index,
  submission_id:201+index,question_id:"clarification",prompt:"Что поможет?",
  survey_title:index===0?"Удобство приложения":"Затруднения выполнения",
  text:`Синтетический ответ ${index+1}`,created_at:"2026-10-25T00:00:00Z",
}));
const data={period:{since:null,until_exclusive:null},patients_total:7,assigned:7,completed:7,
  completion_rate:100,patients_with_feedback:7,patients_without_feedback:0,patients_without_assignments:0,
  overdue_assignments:0,questions:[],quotes,adherence:{reports:0,statuses:{},patients_without_reports:7,reasons:[]},patients:[]};

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
  dom.window.scrollTo=()=>{};
  ({render,screen,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({DoctorDashboard:Dashboard}=await server.ssrLoadModule("/src/DoctorDashboard.tsx"));
  ({ViewStateProvider:Views}=await server.ssrLoadModule("/src/ViewState.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Unexpected requests must not hide missing fixture behavior");});
after(async()=>{await server?.close();dom?.window.close();});

test("extra feedback exposes its survey source and precise answer target, preserving expansion on return",async()=>{
  unexpected=[];
  globalThis.fetch=async(path,options={})=>{
    if(path!=="/analytics/engagement"||(options.method??"GET")!=="GET"){
      unexpected.push({path,method:options.method??"GET"});
      return Response.json({detail:"Unexpected test request"},{status:500});
    }
    return Response.json(data);
  };
  let opened;
  function Harness(){
    const [card,setCard]=useState(false);
    return card?h("button",{onClick:()=>setCard(false)},"Вернуться в аналитику"):
      h(Dashboard,{createSurvey:()=>{},openPatient:(...args)=>{opened=args;setCard(true);}});
  }
  render(h(Interactions,null,h(Views,{returnPoint:null,restored:()=>{}},h(Harness))));
  const user=userEvent.setup({document:dom.window.document});
  await screen.findByText(/Синтетический ответ 1/);
  assert.equal(screen.queryByText(/Синтетический ответ 7/),null);
  await user.click(screen.getByRole("button",{name:"Показать ещё 2 ответа"}));
  assert.ok(screen.getByText("Удобство приложения"));
  assert.ok(screen.getByText(/Синтетический ответ 7/));
  await user.click(screen.getByRole("button",{name:"Открыть ответ: Пациент 7"}));
  assert.deepEqual(opened,[7,"analytics-quote-207-clarification",{assignmentId:107,submissionId:207,questionId:"clarification"}]);
  await user.click(screen.getByRole("button",{name:"Вернуться в аналитику"}));
  await screen.findByText(/Синтетический ответ 7/);
  await user.click(screen.getByRole("button",{name:"Свернуть дополнительные ответы"}));
  assert.equal(screen.queryByText(/Синтетический ответ 7/),null);
  assert.ok(screen.getByRole("button",{name:"Показать ещё 2 ответа"}));
});
