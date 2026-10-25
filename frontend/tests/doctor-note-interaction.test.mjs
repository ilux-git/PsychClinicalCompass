// Component interaction checks. JSDOM does not verify layout or native modal behavior.
import {after,afterEach,before,beforeEach,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,render,screen,within,waitFor,cleanup,act,userEvent;
let DoctorPatients,NavigationGuard,InteractionProvider,ViewStateProvider;
let requests,unexpected,left,currentReplies,noteWrite,notices;

const survey={id:7,title:"Что поможет с расписанием?",description:"Синтетический опрос",purpose:"support",version:1,previous_version_id:null,published_at:"2026-10-20T10:00:00Z",questions:[{id:"barrier",prompt:"Что сейчас мешает?",kind:"text",required:false,dimension:null}]};
const patient={id:1,full_name:"Синтетический пациент",mis_id:101,doctor_id:1,created_at:"2026-10-20T10:00:00Z",mis:{source:"synthetic-mis",status:"available",diagnoses:[],prescriptions:[]},doctor:{name:"Синтетический врач",availability:null}};
const assignment={id:11,patient_id:1,patient_name:patient.full_name,status:"completed",due_at:null,created_at:"2026-10-20T10:00:00Z",first_opened_at:null,survey,submission:{id:12,answers:{barrier:"Не подходит время"},created_at:"2026-10-21T10:00:00Z"}};
const replies=new Map([
  ["/patients/1",patient],
  ["/survey-assignments?patient_id=1",[assignment]],
  ["/patients/1/assessments",[]],
  ["/patients/1/notes",[]],
  ["/patients/1/adherence",{reports:[]}],
  ["/alerts?patient_id=1",[]],
  ["/surveys",[survey]],
]);

before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","HTMLInputElement","HTMLSelectElement","HTMLTextAreaElement","HTMLDialogElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  // Only expose dialog open/close for the guard's React flow; no focus-trap claim.
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");this.querySelector("button:not(:disabled)")?.focus();};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  ({render,screen,within,waitFor,cleanup,act}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({DoctorPatients}=await server.ssrLoadModule("/src/DoctorPatients.tsx"));
  ({NavigationGuard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));
  ({InteractionProvider}=await server.ssrLoadModule("/src/Interaction.tsx"));
  ({ViewStateProvider}=await server.ssrLoadModule("/src/ViewState.tsx"));
});
beforeEach(()=>{
  requests=[];unexpected=[];left=0;currentReplies=new Map(replies);noteWrite=null;notices=[];
  sessionStorage.clear();
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    requests.push({path,method});
    if(method==='POST'&&path==='/patients/1/notes'&&noteWrite){
      const body=JSON.parse(options.body);requests.at(-1).body=body;return noteWrite(body);
    }
    if(method!=="GET"||!currentReplies.has(path)){
      unexpected.push({path,method});
      return Response.json({detail:"Unexpected test request"},{status:500});
    }
    return Response.json(currentReplies.get(path));
  };
});
afterEach(()=>{
  cleanup();
  assert.deepEqual(unexpected,[],"Fixture must not hide an unexpected request or data write");
});
after(async()=>{await server?.close();dom?.window.close();});

async function openCard(){
  render(h(InteractionProvider,null,h(ViewStateProvider,{returnPoint:null,restored:()=>{}},h(NavigationGuard,null,h(DoctorPatients,{selected:1,onSelect:()=>{},notify:(...args)=>notices.push(args),back:()=>left++})))));
  await screen.findByRole("heading",{level:1,name:patient.full_name});
  await screen.findByRole("heading",{level:3,name:survey.title});
  return userEvent.setup({document:dom.window.document});
}
const disclosure=()=>screen.getByRole("button",{name:"Добавить приватную заметку"});
const note=()=>screen.getByRole("textbox",{name:"Текст приватной заметки"});
const sourceButton=title=>within(screen.getByRole("heading",{level:3,name:title}).closest("article")).getByRole("button",{name:"Заметка к ответу"});

test("typing the first note character retains text area focus",async()=>{
  const user=await openCard();
  await user.click(disclosure());
  const input=note();
  await user.type(input,"П");
  assert.equal(input.value,"П");
  assert.ok(document.activeElement===input,"The first character must not move focus to another field");
  await user.type(input,"роверить расписание");
  assert.equal(input.value,"Проверить расписание");
});

test("choosing a category in an empty note retains select focus",async()=>{
  const user=await openCard();
  await user.click(disclosure());
  const category=screen.getByRole("combobox",{name:"Направление наблюдения"});
  await user.click(category);
  const nextValue=[...category.options].find(option=>option.value)?.value;
  assert.ok(nextValue);
  await user.selectOptions(category,nextValue);
  assert.equal(category.value,nextValue);
  assert.ok(document.activeElement===category,"Selecting a category must not refocus the text area");
  assert.equal(note().value,"");
});

test("canceling navigation reopens a collapsed note and preserves its text",async()=>{
  const user=await openCard();
  await user.click(disclosure());
  await user.type(note(),"Обсудить удобное время");
  await user.click(disclosure());
  assert.equal(disclosure().getAttribute("aria-expanded"),"false");
  await user.click(screen.getByRole("button",{name:"К списку пациентов"}));
  assert.equal(left,0);
  await user.click(await screen.findByRole("button",{name:"Продолжить заметку"}));
  await waitFor(()=>assert.equal(disclosure().getAttribute("aria-expanded"),"true"));
  assert.equal(note().value,"Обсудить удобное время");
  assert.ok(document.activeElement===note(),"Canceling navigation must focus the reopened note");
  assert.equal(left,0);
  assert.ok(requests.every(request=>request.method==="GET"));
});

test("an answer opens a sourced note and unlinking it preserves the draft and focus",async()=>{
  const user=await openCard();
  assert.equal(disclosure().getAttribute("aria-expanded"),"false");
  await user.click(screen.getByRole("button",{name:"Заметка к ответу"}));
  await waitFor(()=>assert.equal(disclosure().getAttribute("aria-expanded"),"true"));
  assert.ok(document.activeElement===note(),"Choosing a source must focus the note text");
  assert.ok(screen.getByText(`Источник наблюдения: ${survey.title}`));
  await user.type(note(),"Уточнить время контакта");
  await user.click(screen.getByRole("button",{name:"Убрать связь с ответом"}));
  assert.equal(screen.queryByText(`Источник наблюдения: ${survey.title}`),null);
  assert.equal(note().value,"Уточнить время контакта");
  assert.ok(document.activeElement===note(),"Removing a source must focus the remaining note text");
  assert.ok(requests.every(request=>request.method==="GET"));
});

test("switching the source of a dirty note requires confirmation and never relinks old text silently",async()=>{
  const other={...assignment,id:21,survey:{...survey,id:8,title:"Как подходит поддержка?"},submission:{...assignment.submission,id:22}};
  currentReplies.set("/survey-assignments?patient_id=1",[assignment,other]);
  const user=await openCard();
  await user.click(sourceButton(survey.title));
  await user.type(note(),"Комментарий к первому ответу");
  await user.click(sourceButton(other.survey.title));
  await screen.findByRole("dialog",{name:"Сменить источник заметки?"});
  assert.ok(screen.getByText(`Источник наблюдения: ${survey.title}`));
  assert.equal(note().value,"Комментарий к первому ответу");
  await user.click(screen.getByRole("button",{name:"Продолжить текущую заметку"}));
  assert.ok(document.activeElement===note());
  assert.ok(screen.getByText(`Источник наблюдения: ${survey.title}`));
  await user.click(sourceButton(other.survey.title));
  await user.click(await screen.findByRole("button",{name:"Сменить источник без сохранения"}));
  assert.ok(screen.getByText(`Источник наблюдения: ${other.survey.title}`));
  assert.equal(note().value,"");
  assert.ok(document.activeElement===note());
  // The next draft must register its leave protection again after the explicit discard.
  await user.type(note(),"Комментарий ко второму ответу");
  await user.click(screen.getByRole("button",{name:"К списку пациентов"}));
  await user.click(await screen.findByRole("button",{name:"Продолжить заметку"}));
  assert.equal(left,0);
  assert.equal(note().value,"Комментарий ко второму ответу");
  assert.ok(requests.every(request=>request.method==="GET"));
});

test('failed private-note saves keep the text, category and source, focus one local error and retry only the same explicit payload',async()=>{
  let fail=true;
  noteWrite=body=>{
    if(fail)return Response.json({detail:'Учебный отказ сохранения заметки'},{status:503});
    const saved={id:81,patient_id:1,doctor_id:1,doctor_name:'Учебный врач',...body,source:'doctor_observation',created_at:'2026-10-25T10:00:00Z'};
    currentReplies.set('/patients/1/notes',[saved]);return Response.json(saved,{status:201});
  };
  const user=await openCard();await user.click(sourceButton(survey.title));
  await user.type(note(),'Синтетическая приватная заметка');
  const category=screen.getByRole('combobox',{name:'Направление наблюдения'}),value=[...category.options].find(option=>option.value)?.value;
  await user.selectOptions(category,value);
  const save=screen.getByRole('button',{name:'Сохранить заметку',exact:true});await user.click(save);
  let error=await screen.findByRole('alert');assert.ok(error.closest('form'));assert.equal(document.activeElement===error,true);assert.deepEqual(notices,[]);
  assert.equal(note().value,'Синтетическая приватная заметка');assert.equal(category.value,value);assert.ok(screen.getByText(`Источник наблюдения: ${survey.title}`));
  const described=error.closest('form').querySelector('fieldset').getAttribute('aria-describedby');assert.ok(described&&document.getElementById(described)?.contains(error));
  await user.click(save);error=await screen.findByRole('alert');assert.equal(document.activeElement===error,true);assert.equal(screen.getAllByRole('alert').length,1);
  const writes=()=>requests.filter(r=>r.path==='/patients/1/notes'&&r.method==='POST');
  assert.equal(writes().length,2);assert.deepEqual(writes()[0].body,writes()[1].body);
  assert.deepEqual(writes()[0].body,{text:'Синтетическая приватная заметка',source_type:'survey_submission',source_id:12,dimension:value});
  fail=false;await user.click(save);const savedToggle=await screen.findByRole('button',{name:'Сохранённые заметки (1)',exact:true});
  assert.equal(note().value,'');assert.equal(category.value,'');assert.equal(screen.queryByText(`Источник наблюдения: ${survey.title}`),null);
  assert.equal(screen.queryByRole('alert'),null);assert.equal(writes().length,3);assert.deepEqual(writes()[1].body,writes()[2].body);
  await user.click(savedToggle);assert.ok(await screen.findByText('Синтетическая приватная заметка'));assert.equal(notices.length,1);assert.ok(notices.every(n=>n[1]!=='error'));
});

test('a delayed failure reopens a collapsed note, while editing its category clears the old error without stealing focus',async()=>{
  let rejectSave;noteWrite=()=>new Promise(resolve=>{rejectSave=()=>resolve(Response.json({detail:'Учебный отложенный отказ заметки'},{status:503}));});
  const user=await openCard();await user.click(sourceButton(survey.title));await user.type(note(),'Сохранить источник при паузе');
  await user.click(screen.getByRole('button',{name:'Сохранить заметку',exact:true}));
  await waitFor(()=>assert.equal(typeof rejectSave,'function'));
  await user.click(disclosure());assert.equal(disclosure().getAttribute('aria-expanded'),'false');
  await act(async()=>rejectSave());const error=await screen.findByRole('alert');
  await waitFor(()=>assert.equal(disclosure().getAttribute('aria-expanded'),'true'));assert.equal(document.activeElement===error,true);
  const category=screen.getByRole('combobox',{name:'Направление наблюдения'}),value=[...category.options].find(option=>option.value)?.value;
  await user.selectOptions(category,value);assert.equal(screen.queryByRole('alert'),null);assert.equal(document.activeElement===category,true);
  assert.equal(note().value,'Сохранить источник при паузе');assert.ok(screen.getByText(`Источник наблюдения: ${survey.title}`));
  assert.equal(requests.filter(r=>r.method==='POST').length,1,'Editing and reopening do not create a second save');assert.deepEqual(notices,[]);
});
