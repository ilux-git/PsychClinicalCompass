// Actual assigned-survey recovery; opening telemetry is whitelisted separately from answer writes.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Assigned,Guard,Interactions,render,screen,cleanup,userEvent,unexpected;
const stamp="2026-10-25T10:00:00Z";
const assignment={id:30,patient_id:2,status:"assigned",due_at:null,created_at:stamp,first_opened_at:null,submission:null,
  survey:{id:7,title:"Учебный опрос",description:"Не диагностическая шкала",purpose:"support",version:1,previous_version_id:null,published_at:stamp,
    questions:[{id:"comment",prompt:"Что сделать удобнее?",kind:"text",required:false,options:[],minimum:0,maximum:10}]}};
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLInputElement","HTMLTextAreaElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;}observe(target){this.callback([{target,isIntersecting:true}],this);}disconnect(){}};
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,cleanup}=await import("@testing-library/react"));({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({AssignedSurvey:Assigned}=await server.ssrLoadModule("/src/PatientSurvey.tsx"));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"Only this patient's own draft, opening and explicit answers are accepted");});
after(async()=>{await server?.close();dom?.window.close();});
function transport(){
  unexpected=[];let fail=true;const writes=[];
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(path==="/survey-assignments/30/draft"&&method==="GET")return Response.json({answers:{},revision:0,updated_at:null,already_completed:false});
    if(path==="/survey-assignments/30/open"&&method==="POST")return Response.json({assignment_id:30,first_opened_at:stamp,already_completed:false});
    if((path==="/survey-assignments/30/draft"&&method==="PUT")||(path==="/survey-assignments/30/submit"&&method==="POST")){
      const body=JSON.parse(options.body);writes.push({path,method,body});
      if(fail)return Response.json({detail:"Учебный отказ сохранения ответов"},{status:503});
      return path.endsWith('/draft')?Response.json({answers:body.answers,revision:1,updated_at:stamp,already_completed:false}):
        Response.json({id:91,assignment_id:30,created_at:stamp,replayed:false,participation:null});
    }
    unexpected.push({path,method});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  return {writes,enableWrites:()=>{fail=false;}};
}
for(const action of ['draft','submit']){
  test(`${action}: one local error retains answers and revision until an explicit retry succeeds`,async()=>{
    const requests=transport(),notices=[];let exits=0;
    render(h(Interactions,null,h(Guard,null,h(Assigned,{assignment,done:()=>exits++,notify:(...args)=>notices.push(args)}))));
    const user=userEvent.setup({document:dom.window.document});
    const input=await screen.findByRole("textbox",{name:"Что сделать удобнее?"});
    await user.type(input,"Синтетический текст не должен теряться");
    const label=action==='draft'?"Сохранить и продолжить позже":"Отправить врачу";
    await user.click(screen.getByRole("button",{name:label,exact:true}));
    const error=await screen.findByRole("alert");
    assert.equal(Boolean(error.closest('.patient-form')),true);assert.equal(document.activeElement===error,true);
    assert.deepEqual(notices,[],"A local survey error must not be repeated in a global alert");
    assert.equal(input.value,"Синтетический текст не должен теряться");assert.equal(exits,0);
    requests.enableWrites();await user.click(screen.getByRole("button",{name:label,exact:true}));
    if(action==='draft')assert.equal(exits,1);else await screen.findByRole("heading",{name:"Спасибо за ваш ответ"});
    assert.equal(requests.writes.length,2);assert.deepEqual(requests.writes[0],requests.writes[1]);
    assert.equal(requests.writes[1].body[action==='draft'?'expected_revision':'expected_draft_revision'],0);
    assert.equal(Boolean(screen.queryByRole('alert')),false);assert.ok(notices.every(notice=>notice[1]!=="error"));
  });
}
