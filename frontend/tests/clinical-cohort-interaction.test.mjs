import {after,afterEach,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {createElement as h} from 'react';

let dom,server,Cohort,Patients,Guard,Interactions,render,screen,within,waitFor,cleanup,userEvent,unexpected;
const stamp='2026-10-26T10:00:00Z';
const base={key:'phq9_zolotareva_2023_v1',name:'PHQ-9 · депрессивные симптомы',version:'Золотарёва, 2023 · v1',maximum:27,
  source_title:'Публикация источника',source_url:'https://psyjournals.ru/',source_check:'Точный бланк',license:'CC BY-NC 4.0',license_url:null,limitation:'Не диагноз',
  assigned_patients:1,assignments:2,unanswered_assignments:1,observed_patients:1,results:1,repeat_patients:0,patients_without_results:1,coverage_percent:100,
  numeric_latest_patients:1,median_score:0,minimum_score:0,maximum_score:0,baseline_selected_patients:0,criterion:null,
  latest_review:{urgent_review:0,review_required:0,needs_clarification:0,no_signal:1,not_calculated:0}};
const response=instruments=>({as_of:stamp,patients_total:2,search:'',instruments,legacy_numeric_results_included:false});
const patient={id:1,full_name:'Синтетический пациент',doctor_id:1,mis_id:1,created_at:stamp,treatment_status:'unknown',pending_events:0,open_tasks:0,in_progress_tasks:0,
  last_observation_at:stamp,last_observation_source:'canonical_clinical',latest_clinical_result:{id:8,instrument_key:base.key,code:'PHQ-9',name:base.name,version:base.version,score:0,maximum:27,criterion_met:null,created_at:stamp}};

before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
  for(const name of ['window','document','navigator','Node','Element','HTMLElement','SVGElement','HTMLInputElement','HTMLTextAreaElement','HTMLDialogElement','MutationObserver','Event','KeyboardEvent','MouseEvent','sessionStorage'])
    Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?dom.window:dom.window[name]});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes('prefers-reduced-motion'),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  ({render,screen,within,waitFor,cleanup}=await import('@testing-library/react'));({default:userEvent}=await import('@testing-library/user-event'));
  server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
  ({ClinicalCohort:Cohort}=await server.ssrLoadModule('/src/ClinicalCohort.tsx'));({DoctorPatients:Patients}=await server.ssrLoadModule('/src/DoctorPatients.tsx'));
  ({NavigationGuard:Guard}=await server.ssrLoadModule('/src/NavigationGuard.tsx'));({InteractionProvider:Interactions}=await server.ssrLoadModule('/src/Interaction.tsx'));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],'Only scoped clinical summary and directory reads are allowed');});
after(async()=>{await server?.close();dom?.window.close();});
const mount=element=>render(h(Interactions,null,h(Guard,null,element)));

test('zero remains a measured median; panic is a categorical screen and assignment counts are not a response rate',async()=>{
  unexpected=[];
  const panic={...base,key:'panic-v1',name:'PHQ · панические атаки',maximum:null,median_score:null,minimum_score:null,maximum_score:null,numeric_latest_patients:0,baseline_selected_patients:null,criterion:{met:0,not_met:1,unknown:0}};
  globalThis.fetch=async(url,options={})=>{
    if(url==='/analytics/clinical-instruments?q='&&(options.method??'GET')==='GET')return Response.json(response([base,panic]));
    unexpected.push({url,method:options.method??'GET'});return Response.json({detail:'Unexpected request'},{status:500});
  };
  mount(h(Cohort,{search:''}));await screen.findByRole('heading',{name:base.name,exact:true});
  const cards=document.querySelectorAll('.clinical-cohort-card');
  assert.match(cards[0].textContent,/Медиана последних баллов0 \/ 27/);
  assert.match(cards[0].textContent,/100% пациентов с назначением ответили хотя бы один раз/);
  assert.match(cards[1].textContent,/Критерий не выполнен1 пациент/);
  assert.doesNotMatch(cards[1].textContent,/Медиана|0 \/ null/);
  const user=userEvent.setup({document:dom.window.document});
  await user.click(within(cards[0]).getByRole('button',{name:'Полнота данных и основания',exact:true}));
  assert.match(cards[0].textContent,/Незавершённых назначений: 1 из 2/);
  assert.match(cards[0].textContent,/не приравнивается к нулевому баллу/);
});

test('an empty canonical cohort explains the provenance boundary and opens the existing library',async()=>{
  unexpected=[];let opened=0;
  const empty={...base,assigned_patients:0,assignments:0,unanswered_assignments:0,observed_patients:0,results:0,coverage_percent:null,numeric_latest_patients:0,median_score:null,minimum_score:null,maximum_score:null,patients_without_results:2,latest_review:{no_signal:0,not_calculated:0}};
  globalThis.fetch=async(url,options={})=>{
    if(url==='/analytics/clinical-instruments?q='&&(options.method??'GET')==='GET')return Response.json(response([empty]));
    unexpected.push({url,method:options.method??'GET'});return Response.json({detail:'Unexpected request'},{status:500});
  };
  mount(h(Cohort,{search:'',openSurveys:()=>{opened++;}}));
  await screen.findByText('Канонических клинических ответов пока нет',{exact:true});
  assert.match(document.body.textContent,/Старые демо-ответы остаются в карточках/);
  assert.match(document.body.textContent,/Медиана последних балловНет измерений/);
  const user=userEvent.setup({document:dom.window.document});await user.click(screen.getByRole('button',{name:'Открыть библиотеку опросов',exact:true}));
  assert.equal(opened,1);
});

test('a failed cohort does not hide the independently loaded patient and its canonical zero',async()=>{
  unexpected=[];
  globalThis.fetch=async(url,options={})=>{
    if(url==='/analytics/clinical-instruments?q='&&(options.method??'GET')==='GET')return Response.json({detail:'Сводка временно недоступна'},{status:503});
    if(url==='/patients/directory?q=&after=0'&&(options.method??'GET')==='GET')return Response.json({total:1,items:[patient],next_cursor:null});
    unexpected.push({url,method:options.method??'GET'});return Response.json({detail:'Unexpected request'},{status:500});
  };
  let selected;
  mount(h(Patients,{selected:null,onSelect:id=>{selected=id;},notify:()=>{},scope:'state'}));
  const card=await screen.findByRole('button',{name:/Синтетический пациент.*PHQ-9 · 0 \/ 27/});
  assert.match(card.textContent,/Золотарёва, 2023 · v1/);assert.doesNotMatch(card.textContent,/Пока нет|Нет измерений/);
  await screen.findByText('Сводка пока недоступна',{exact:true});
  const user=userEvent.setup({document:dom.window.document});await user.click(card);assert.equal(selected,1);
});

test('patient name search is applied to both the canonical cohort and the directory',async()=>{
  unexpected=[];const requests=[];
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??'GET';requests.push(url);
    if(url.startsWith('/analytics/clinical-instruments?q=')&&method==='GET')return Response.json(response([base]));
    if(url.startsWith('/patients/directory?q=')&&method==='GET')return Response.json({total:1,items:[patient],next_cursor:null});
    unexpected.push({url,method});return Response.json({detail:'Unexpected request'},{status:500});
  };
  mount(h(Patients,{selected:null,onSelect:()=>{},notify:()=>{},scope:'state'}));
  await screen.findByRole('button',{name:/Синтетический пациент.*PHQ-9 · 0 \/ 27/});
  const user=userEvent.setup({document:dom.window.document});await user.type(screen.getByRole('textbox',{name:'Поиск пациента',exact:true}),'Иван');
  const text=encodeURIComponent('Иван');
  await waitFor(()=>assert.ok(requests.some(url=>url===`/analytics/clinical-instruments?q=${text}`)));
  await waitFor(()=>assert.ok(requests.some(url=>url===`/patients/directory?q=${text}&after=0`)));
});
