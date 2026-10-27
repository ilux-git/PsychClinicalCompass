// Actual patient home and history: independent sources, missing values and edition order.
import {after,afterEach,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {createElement as h} from 'react';

let dom,server,Overview,Preview,History,Collection,Admin,Interactions,Guard,render,screen,within,waitFor,cleanup,userEvent,unexpected=[];
const stamp='2026-10-26T01:00:00Z';
const definition=(key,name,maximum)=>({key,name,maximum,version:`Учебная версия ${key}`,questions:[],instructions:'',
  source_title:'Источник синтетического теста',source_url:'https://example.org/source',source_check:'Test fixture',
  license:'Test only',license_url:null,limitation:'Синтетический результат не является диагнозом.'});
const phq=definition('phq-test','PHQ-9 · депрессивные симптомы',27);
const gad=definition('gad-test','GAD-7 · тревожные симптомы',21);
const panic=definition('panic-test','PHQ · панические атаки',null);
const row=(id,def,score,at,result={})=>({id,patient_id:2,submission_id:id,instrument_key:def.key,definition:def,score,created_at:at,answers:{},
  result:{kind:score===null?'panic_screen':'sum',...result}});
const canonical=[row(1,panic,null,'2026-10-23T01:00:00Z',{criterion_met:false,screen_stopped:true}),
  row(2,phq,7,'2026-10-24T01:00:00Z'),row(3,phq,0,'2026-10-25T01:00:00Z'),row(4,gad,3,stamp)];
const legacy=[{id:77,form_type:'phq9',form_version:'demo_numeric_v1',score:20,created_at:stamp,answers:[]}];

before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
  for(const name of ['window','document','navigator','Node','Element','HTMLElement','HTMLDialogElement','SVGElement','MutationObserver','Event','KeyboardEvent','MouseEvent','sessionStorage']){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IntersectionObserver=class{constructor(cb){this.cb=cb;}observe(target){this.cb([{target,isIntersecting:true}],this);}disconnect(){}};
  globalThis.ResizeObserver=class{constructor(cb){this.cb=cb;}observe(){this.cb([{contentRect:{width:600}}]);}disconnect(){}};
  dom.window.matchMedia=query=>({matches:query.includes('prefers-reduced-motion'),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  ({render,screen,within,waitFor,cleanup}=await import('@testing-library/react'));
  ({default:userEvent}=await import('@testing-library/user-event'));
  server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
  ({PatientOverview:Overview}=await server.ssrLoadModule('/src/PatientOverview.tsx'));
  ({PatientStatePreview:Preview}=await server.ssrLoadModule('/src/PatientStatePreview.tsx'));
  ({ClinicalHistory:History}=await server.ssrLoadModule('/src/ClinicalHistory.tsx'));
  ({CollectionMetrics:Collection}=await server.ssrLoadModule('/src/CollectionMetrics.tsx'));
  ({AdminDashboard:Admin}=await server.ssrLoadModule('/src/AdminDashboard.tsx'));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule('/src/Interaction.tsx'));
  ({NavigationGuard:Guard}=await server.ssrLoadModule('/src/NavigationGuard.tsx'));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],'Only explicitly listed source reads are allowed');});
after(async()=>{await server?.close();dom?.window.close();});

function transport({results=canonical,old=legacy,clinicalFailure=false,legacyFailure=false}={}){
  unexpected=[];const calls=[];let failClinical=clinicalFailure;
  const points={balance:0,earned_total:0,reserved_points:0,catalog_version:'qa-only',preference:{patient_choice:'calm',doctor_recommendation:null,effective_mode:'calm'},offers:[],coupons:[],rules:[],history:[],activity:[],principles:[],next_reset_at:stamp};
  const care={as_of:stamp,treatment:{status:'unknown',recorded_at:null},visits:{status:'available',source:'MIS fixture',synthetic:true,source_as_of:stamp,known_completed_count:0,latest_completed_at:null,next_scheduled_at:null,has_undated_visits:false}};
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??'GET';calls.push({path,method});
    if(method==='GET'&&path==='/patients/2/clinical-results')return failClinical?Response.json({detail:'Клинический источник временно недоступен'},{status:503}):Response.json(results);
    if(method==='GET'&&path==='/patients/2/assessments')return legacyFailure?Response.json({detail:'Прежний источник временно недоступен'},{status:503}):Response.json(old);
    if(method==='GET'&&path==='/participation/points')return Response.json(points);
    if(method==='GET'&&path==='/participation/care-progress')return Response.json(care);
    unexpected.push({path,method});return Response.json({detail:'Unexpected request'},{status:500});
  };
  return {calls,recoverClinical:()=>{failClinical=false;}};
}
const mount=element=>render(h(Interactions,null,h(Guard,null,element)));

test('the actual patient home shows canonical zero and panic separately from a newer legacy number',async()=>{
  const {calls}=transport(),routes=[];
  mount(h(Overview,{user:{id:3,display_name:'Синтетический пациент',role:'patient',patient_id:2},
    assignments:{data:[],loading:false,error:'',reload:()=>{}},doctor:{name:'Учебный врач',availability:'available'},doctorError:'',retryDoctor:()=>{},openSurvey:()=>{},navigate:view=>routes.push(view),notify:()=>{}}));
  await screen.findByRole('heading',{name:phq.name,exact:true});
  const cards=[...document.querySelectorAll('.clinical-state-preview .patient-state-item')];
  assert.deepEqual(cards.map(card=>card.querySelector('h3').textContent),[gad.name,phq.name,panic.name]);
  assert.match(cards[1].textContent,/0 \/ 27/);assert.doesNotMatch(cards[1].textContent,/20 \/ 27/);
  assert.match(cards[2].textContent,/Критерий скрининга не выполнен/);assert.doesNotMatch(cards[2].textContent,/0 \/|0 балл/);
  assert.doesNotMatch(document.body.textContent,/Измерений этой шкалы пока нет|Клинических результатов пока нет/);
  assert.equal(screen.queryByRole('heading',{name:'PHQ-9 · числовая история'}),null);
  await userEvent.setup({document:dom.window.document}).click(screen.getByRole('button',{name:'Числовая история состояния',exact:true}));
  await screen.findByRole('heading',{name:'PHQ-9 · числовая история',exact:true});
  assert.match(document.body.textContent,/20 \/ 27/);
  await userEvent.setup({document:dom.window.document}).click(screen.getByRole('button',{name:'Вся история',exact:true}));
  assert.deepEqual(routes,['state']);assert.ok(calls.every(call=>call.method==='GET'));
});

test('a clinical source failure does not claim no results or hide the independent legacy source; retry recovers',async()=>{
  const fixture=transport({clinicalFailure:true});
  mount(h(Preview,{patientId:2,navigate:()=>{}}));
  await screen.findByRole('alert');
  assert.doesNotMatch(document.body.textContent,/Клинических результатов пока нет/);
  const user=userEvent.setup({document:dom.window.document});
  await user.click(screen.getByRole('button',{name:'Числовая история состояния',exact:true}));
  await screen.findByRole('heading',{name:'PHQ-9 · числовая история',exact:true});
  fixture.recoverClinical();await user.click(screen.getByRole('button',{name:'Повторить',exact:true}));
  await screen.findByRole('heading',{name:phq.name,exact:true});
  await waitFor(()=>assert.ok(screen.queryByRole('alert')===null));
});

test('a legacy failure leaves canonical data visible and an empty canonical source has an explicit empty state',async()=>{
  transport({legacyFailure:true});mount(h(Preview,{patientId:2,navigate:()=>{}}));
  await screen.findByRole('heading',{name:phq.name,exact:true});await screen.findByRole('alert');
  assert.match(document.querySelector('.clinical-state-preview').textContent,/0 \/ 27/);
  cleanup();transport({results:[],old:[]});mount(h(Preview,{patientId:2,navigate:()=>{}}));
  await screen.findByText('Клинических результатов пока нет',{exact:true});
  assert.equal(document.querySelectorAll('.patient-state-value').length,0);
});

test('history orders editions by newest observation, retains within-edition chronology, and never turns an unknown panic criterion into no',async()=>{
  const unknown=row(6,definition('panic-unknown','Панический модуль · другая версия',null),null,stamp,{});
  transport({results:[canonical[2],unknown,canonical[0],canonical[3],canonical[1]],old:[]});
  mount(h(History,{patientId:2}));await screen.findByRole('heading',{name:phq.name,exact:true});
  const editions=[...document.querySelectorAll('.clinical-edition')];
  assert.deepEqual(editions.map(section=>section.querySelector('h3').textContent),[unknown.definition.name,gad.name,phq.name,panic.name]);
  assert.match(editions[0].textContent,/Критерий скрининга не определён/);
  assert.doesNotMatch(editions[0].textContent,/Критерий скрининга не выполнен|0 \/|0 балл/);
  assert.deepEqual([...editions[2].querySelectorAll('[data-clinical-result]')].map(e=>e.getAttribute('data-clinical-result')),['3','2']);
  assert.match(editions[2].querySelector('.clinical-latest').textContent,/0 \/ 27/);
});

// User-approved presentation contract: mode/delivery disclosure is now in AccountSettings,
// whose real rendered content is verified in telegram-entry.test.mjs. Scores, editions
// and the exact historical measurement remain on these working pages.
test('generated results keep their zero, edition and exact historical identity after mode notices move to settings',async()=>{
  const generated=row(9,phq,0,stamp,{synthetic_provenance:{generated:true,dataset_version:'synthetic-clinical/1',fixture_sha256:'fixture-only',scenario:'test',measurement:'generated_current'}});
  transport({results:[generated],old:[]});mount(h(Preview,{patientId:2,navigate:()=>{}}));
  await screen.findByRole('heading',{name:phq.name,exact:true});
  assert.match(document.body.textContent,/0 \/ 27/);
  cleanup();transport({results:[generated],old:[]});mount(h(History,{patientId:2}));
  await screen.findByRole('heading',{name:phq.name,exact:true});
  const answer=document.querySelector('[data-clinical-result="9"]');
  assert.match(answer.textContent,/0 \/ 27/);
  assert.equal(generated.result.synthetic_provenance.generated,true);
});

test('doctor and administrator explain the excluded timing examples, and a suppressed bundle never renders the counts',async()=>{
  unexpected=[];
  const journey={assigned:4,opened:1,completed:4,completed_after_open:1,opened_not_completed:0,not_opened_not_completed:0,completed_without_open_record:3,
    opening_rate_percent:25,completion_after_open_percent:100,timing_excluded_generated:3,timing_eligible_completed:1,
    assignment_to_completion:{known:1,unknown:0,median_seconds:100},open_to_completion:{known:1,unknown:0,median_seconds:80},
    delivery_to_completion:{known:0,unknown:1,median_seconds:null},interpretation:'Источники времени показаны отдельно.'};
  mount(h(Collection,{data:{dimensions:[],journey}}));
  assert.match(document.body.textContent,/Не включены в расчёт времени: 3/);
  assert.match(document.body.textContent,/Завершений для оценки времени: 1/);
  cleanup();
  for(const suppressed of [false,true]){
    globalThis.fetch=async(path,options={})=>{
      if(path==='/analytics/clinic'&&(options.method??'GET')==='GET')return Response.json({status:'ready',privacy:{min_group_size:2},cohort:{values:{patients:10}},dimensions:[],
        journey:{suppressed,reason:suppressed?'small_group_or_complement':null,values:journey},sources:[],workflow:null});
      unexpected.push({path,method:options.method??'GET'});return Response.json({detail:'Unexpected request'},{status:500});
    };
    mount(h(Admin,{view:'overview'}));
    await screen.findByRole('heading',{name:'Назначение → открытие → завершение',exact:true});
    if(suppressed){
      assert.doesNotMatch(document.body.textContent,/Не включены в расчёт времени|Завершений для оценки времени/);
      assert.match(document.body.textContent,/Показатели скрыты/);
    }else{
      assert.match(document.body.textContent,/Не включены в расчёт времени: 3/);
    }
    cleanup();
  }
});
