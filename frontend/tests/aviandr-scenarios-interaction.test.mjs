// Real component interactions; virtual DOM does not prove native layout or server permissions.
import {after,afterEach,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {createElement as h} from 'react';

let dom,server,Panel,Directory,Guard,Interactions,ViewState,render,screen,within,waitFor,cleanup,userEvent;
let requests,replies,write,unexpected,notices;
const at='2026-10-27T09:00:00Z';
const proposal='Проверить жалобы и фактический приём. Интоксикация не установлена.';
const context={source_case_id:'P009',case_key:'interaction',title:'Сообщение пациента',day:5,
  facts:['Пациент сообщил о головокружении.'],source_file:'source.txt',source_sha256:'fixture',
  hypothesis:{proposal,category:'required',missing_data:['Точная доза'],registry_current_verified:false,
    drug_source:{title:'ОХЛП производителя',url:'https://example.org/source',registry_current_verified:false}}};
const scenario={key:'positive',source_id:'P008',title:'Динамика EPDS',age:25,sex:'female',history:'Ранее установленный врачом диагноз.',
  anchor_date:'2026-07-07T09:00:00Z',measurements:[{instrument:'EPDS',day:14,score:18,version:null},{instrument:'EPDS',day:42,score:9,version:null}],
  states:[{day:0,diagnoses:['F53.0'],diagnosis_status:'recorded_by_physician',treatment_status:'recorded_by_physician',plan:['Исходная схема врача']},
    {day:84,diagnoses:['F53.0'],diagnosis_status:'recorded_by_physician',treatment_status:'recorded_by_physician',plan:['Смена схемы врачом на 84 день']}],
  proposed_plan:[],conflicts:[]};
const episodes=[0,14,42,84,112].map((day,index)=>({id:index+1,step_key:`step${day}`,occurred_at:at,
  snapshot:{...context,day,title:`Наблюдение дня ${day}`},alert_id:index+1,alert_status:'created',
  decision_status:day===42?'confirmed':'pending_review',doctor_conclusion:day===42?'Вывод врача после наблюдения дня 42':null}));
const patient={id:1,full_name:'Пациент сценария',mis_id:8009,doctor_id:1,created_at:at,scenario_label:'P009 · Сочетание препаратов',
  mis:{source:'synthetic_mis_json',status:'available',diagnoses:['F41.1'],prescriptions:[]},doctor:{name:'Лечащий врач',availability:'available'}};
const alert={id:7,rule_id:'aviandr_case_review',rule_version:'fixture',patient_id:1,patient_name:patient.full_name,
  reason:'Проверка сообщения пациента',status:'created',created_at:at,source_kind:'clinical_scenario',source_message:null,actions:[],
  decision:{id:8,status:'pending_review',version:1,reason:'',missing_data:['Точная доза'],
    facts:{form_type:'aviandr_review',score:null,risk_flags:[],system_proposal:proposal,case_review:context}}};

before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
  for(const name of ['window','document','navigator','Node','Element','HTMLElement','SVGElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLDialogElement','MutationObserver','Event','KeyboardEvent','MouseEvent','sessionStorage'])
    Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?dom.window:dom.window[name]});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IntersectionObserver=class{constructor(cb){this.cb=cb;}observe(target){this.cb([{target,isIntersecting:true}],this);}disconnect(){}};
  globalThis.ResizeObserver=class{constructor(cb){this.cb=cb;}observe(){this.cb([{contentRect:{width:600}}]);}disconnect(){}};
  dom.window.matchMedia=query=>({matches:query.includes('prefers-reduced-motion'),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  ({render,screen,within,waitFor,cleanup}=await import('@testing-library/react'));
  ({default:userEvent}=await import('@testing-library/user-event'));
  server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
  ({ClinicalScenarioPanel:Panel}=await server.ssrLoadModule('/src/ClinicalScenarios.tsx'));
  ({DoctorPatients:Directory}=await server.ssrLoadModule('/src/DoctorPatients.tsx'));
  ({NavigationGuard:Guard}=await server.ssrLoadModule('/src/NavigationGuard.tsx'));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule('/src/Interaction.tsx'));
  ({ViewStateProvider:ViewState}=await server.ssrLoadModule('/src/ViewState.tsx'));
});
beforeEach(()=>{
  requests=[];unexpected=[];write=null;notices=[];sessionStorage.clear();
  replies=new Map([
    ['/patients/1',patient],['/survey-assignments?patient_id=1',[]],['/patients/1/assessments',[]],['/patients/1/notes',[]],
    ['/patients/1/adherence',{reports:[]}],['/alerts?patient_id=1',[structuredClone(alert)]],['/surveys',[]],
    ['/patients/1/clinical-scenario',{scenario,episodes}],
    ['/patients/directory?q=&after=0',{total:1,items:[patient],next_cursor:null}],
  ]);
  globalThis.fetch=async(path,options={})=>{
    const req={path,method:options.method??'GET',body:options.body?JSON.parse(options.body):null};requests.push(req);
    if(req.method==='POST'&&path==='/clinical-decisions/8/confirm'&&write)return write(req.body);
    if(req.method==='GET'&&replies.has(path))return Response.json(replies.get(path));
    unexpected.push(req);return Response.json({detail:'Unexpected test request'},{status:500});
  };
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[]);});
after(async()=>{await server.close();dom.window.close();});
const mount=child=>render(h(Interactions,null,h(ViewState,{returnPoint:null,restored:()=>{}},h(Guard,null,child))));

test('time slices separate earlier physician records, later therapy and later conclusions without any write',async()=>{
  let opened=null;mount(h(Panel,{patientId:1,openEvents:id=>opened=id}));
  const cutoff=await screen.findByLabelText('Срез сценария');const interact=userEvent.setup();
  assert.equal(cutoff.value,'112');assert.ok(screen.getByText('Смена схемы врачом на 84 день'));
  assert.ok(screen.getByText('Вывод врача после наблюдения дня 42'));
  await interact.selectOptions(cutoff,'0');
  assert.ok(screen.getByText('Исходная схема врача'));
  assert.equal(screen.queryByText('Смена схемы врачом на 84 день'),null);
  assert.equal(screen.queryByText('Вывод врача после наблюдения дня 42'),null);
  assert.equal(screen.queryByText('Наблюдение дня 42'),null);
  assert.equal(screen.queryByRole('figure',{name:'EPDS · переданная история'}),null);
  assert.equal(screen.queryByRole('button',{name:/Разобрать событие/}),null);
  await interact.selectOptions(cutoff,'42');
  await screen.findByRole('figure',{name:'EPDS · переданная история'});
  assert.match(document.body.textContent,/Версия бланка и ответы по пунктам не переданы/);
  assert.equal(screen.queryByText('Смена схемы врачом на 84 день'),null);
  assert.equal(screen.queryByText('Вывод врача после наблюдения дня 42'),null);
  await interact.selectOptions(cutoff,'112');
  await interact.click(screen.getByRole('button',{name:'Разобрать событие #4'}));assert.equal(opened,4);
  assert.ok(requests.every(req=>req.method==='GET'));
});

test('a scenario row opens the clinical history directly',async()=>{
  const selected=[];mount(h(Directory,{selected:null,onSelect:(...args)=>selected.push(args),notify:()=>{}}));
  await userEvent.setup().click(await screen.findByRole('button',{name:/Пациент сценария/}));
  assert.deepEqual(selected,[[1,'clinical']]);
});

test('a scenario action focuses its exact event, with urgent reviews before routine ones',async()=>{
  replies.set('/patients/1/clinical-results',[]);replies.set('/patients/1/diary',{entries:[]});
  const routine={...alert,id:9,reason:'Плановый разбор'};
  replies.set('/alerts?patient_id=1',[routine,{...alert,severity:'urgent_review'}]);
  const sourceEpisodes=[{...episodes[0],snapshot:{...context,day:0},alert_id:7}];
  replies.set('/patients/1/clinical-scenario',{scenario,episodes:sourceEpisodes});
  mount(h(Directory,{selected:1,initialTab:'clinical',onSelect:()=>{},notify:()=>{}}));
  await userEvent.setup().click(await screen.findByRole('button',{name:'Разобрать событие #7'}));
  const exact=await screen.findByRole('article',{name:'Событие #7'});
  await waitFor(()=>assert.equal(document.activeElement,exact));
  const cards=[...document.querySelectorAll('[data-alert-id]')];
  assert.deepEqual(cards.map(card=>card.dataset.alertId),['7','9']);
  assert.match(within(exact).getByText('Срочный разбор').textContent,/Срочный/);
  assert.equal(requests.filter(req=>req.method!=='GET').length,0);
});

async function openEvents(){
  mount(h(Directory,{selected:1,initialTab:'events',onSelect:()=>{},notify:(...args)=>notices.push(args)}));
  return screen.findByRole('textbox',{name:'Вывод врача · можно исправить гипотезу'});
}

test('reopening an already reviewed event does not invent an unsent physician draft or conflict',async()=>{
  replies.set('/alerts?patient_id=1',[{...alert,decision:{...alert.decision,status:'confirmed',version:2,reason:'Сохранённый вывод врача'}}]);
  mount(h(Directory,{selected:1,initialTab:'events',onSelect:()=>{},notify:()=>{}}));
  await screen.findByText('Сохранённый вывод врача',{exact:true});
  assert.equal(screen.queryByRole('textbox',{name:'Ваш неотправленный комментарий'}),null);
  assert.equal(screen.queryByText(/Событие уже оценено в другой сессии/),null);
  assert.equal(requests.filter(req=>req.method!=='GET').length,0);
});

test('an untouched hypothesis is not an unsaved physician edit and navigating away never approves it',async()=>{
  const input=await openEvents();assert.equal(input.value,proposal);
  await userEvent.setup().click(screen.getByRole('tab',{name:'Обратная связь',exact:true}));
  await waitFor(()=>assert.equal(screen.getByRole('tab',{name:'Обратная связь'}).getAttribute('aria-selected'),'true'));
  assert.equal(screen.queryByRole('dialog'),null);
  assert.equal(requests.filter(req=>req.method!=='GET').length,0);
});

test('a failed corrected conclusion retains input and retries the same version; approval preserves the source proposal',async()=>{
  const input=await openEvents();const interact=userEvent.setup();
  await interact.clear(input);await interact.type(input,'Врач уточнил жалобы; необходим осмотр.');
  let attempt=0;
  write=body=>{
    if(++attempt===1)return Response.json({detail:'Не удалось сохранить'},{status:503});
    replies.set('/alerts?patient_id=1',[{...alert,decision:{...alert.decision,status:'confirmed',version:2,reason:body.reason}}]);
    return Response.json({id:8,status:'confirmed',version:2});
  };
  await interact.click(screen.getByRole('button',{name:'Сохранить исправленный вывод'}));
  await waitFor(()=>assert.equal(notices.length,1));assert.equal(input.value,'Врач уточнил жалобы; необходим осмотр.');
  await interact.click(screen.getByRole('button',{name:'Сохранить исправленный вывод'}));
  await screen.findByText('Врач уточнил жалобы; необходим осмотр.',{exact:true});
  assert.equal(screen.getByRole('button',{name:'Закрыть событие',exact:true}).disabled,true);
  assert.ok(screen.getByText(/Для закрытия сохраните выполненное клиническое действие/));
  const writes=requests.filter(req=>req.method==='POST');assert.equal(writes.length,2);
  assert.deepEqual(writes[0].body,writes[1].body);
  assert.equal(writes[1].body.expected_version,1);assert.equal(writes[1].body.action,'confirmed');
  assert.equal(replies.get('/alerts?patient_id=1')[0].decision.facts.system_proposal,proposal);
});
