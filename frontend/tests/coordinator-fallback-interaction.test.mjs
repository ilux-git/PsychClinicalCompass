import {after,afterEach,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {createElement as h} from 'react';

let dom,server,Settings,Notices,Guard,Interactions,render,screen,within,waitFor,cleanup,userEvent,unexpected;
const stamp='2026-10-26T10:00:00Z';
const initialRoute={coordinator_id:null,revision:0,updated_at:null,coordinators:[{id:9,name:'Координатор один'},{id:10,name:'Координатор два'},{id:11,name:'Координатор три'}],waiting_urgent:1,recent_notices:[]};
const initialNotice={id:7,patient_id:4,doctor_id:1,doctor_name:'Ответственный врач',reason:'doctor_unavailable',created_at:stamp,acknowledged_at:null,state:'pending',original_acknowledgement_due_at:stamp};

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
  ({DoctorEscalationSettings:Settings,CoordinatorNotices:Notices}=await server.ssrLoadModule('/src/CoordinatorFallback.tsx'));
  ({NavigationGuard:Guard}=await server.ssrLoadModule('/src/NavigationGuard.tsx'));({InteractionProvider:Interactions}=await server.ssrLoadModule('/src/Interaction.tsx'));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],'Only the explicit operational API is allowed');});
after(async()=>{await server?.close();dom?.window.close();});
const mount=component=>render(h(Interactions,null,h(Guard,null,h(component))));

test('route failure retains the explicit recipient; retry saves only this doctor’s selected route',async()=>{
  unexpected=[];let current={...initialRoute},fail=true;const writes=[];
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??'GET';
    if(url==='/doctors/me/escalation-route'&&method==='GET')return Response.json(current);
    if(url==='/doctors/me/escalation-route'&&method==='PUT'){
      const body=JSON.parse(options.body);writes.push(body);
      if(fail)return Response.json({detail:'Временный отказ записи маршрута'},{status:503});
      current={...current,coordinator_id:body.coordinator_id,revision:1,updated_at:stamp};return Response.json(current);
    }
    unexpected.push({url,method});return Response.json({detail:'Unexpected request'},{status:500});
  };
  mount(Settings);const user=userEvent.setup({document:dom.window.document});
  const select=await screen.findByRole('combobox',{name:'Резервный координатор',exact:true});
  assert.equal(select.value,'');assert.match(document.body.textContent,/не выбран/);assert.equal(writes.length,0);
  await user.selectOptions(select,'9');await user.click(screen.getByRole('button',{name:'Сохранить маршрут',exact:true}));
  const error=await screen.findByRole('alert');assert.ok(document.activeElement===error);assert.equal(select.value,'9');
  fail=false;await user.click(screen.getByRole('button',{name:'Сохранить маршрут',exact:true}));
  const status=await screen.findByRole('status');await waitFor(()=>assert.ok(document.activeElement===status));
  assert.deepEqual(writes,[{coordinator_id:9,expected_revision:0},{coordinator_id:9,expected_revision:0}]);
  assert.equal(select.value,'9');assert.match(status.textContent,/Маршрут сохранён/);
});

test('conflict refresh retains the doctor’s draft and requires another explicit save',async()=>{
  unexpected=[];let current={...initialRoute,coordinator_id:9,revision:1},conflict=true;const writes=[];
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??'GET';
    if(url==='/doctors/me/escalation-route'&&method==='GET')return Response.json(current);
    if(url==='/doctors/me/escalation-route'&&method==='PUT'){
      const body=JSON.parse(options.body);writes.push(body);
      if(conflict){conflict=false;current={...current,coordinator_id:11,revision:2};return Response.json({detail:'Маршрут изменён в другой сессии'},{status:409});}
      current={...current,coordinator_id:body.coordinator_id,revision:3};return Response.json(current);
    }
    unexpected.push({url,method});return Response.json({detail:'Unexpected request'},{status:500});
  };
  mount(Settings);const user=userEvent.setup({document:dom.window.document});
  const select=await screen.findByRole('combobox',{name:'Резервный координатор',exact:true});
  await user.selectOptions(select,'10');await user.click(screen.getByRole('button',{name:'Сохранить маршрут',exact:true}));
  await screen.findByRole('alert');assert.equal(select.value,'10');
  await user.click(screen.getByRole('button',{name:'Обновить маршрут',exact:true}));
  await screen.findByText(/Ваш выбор оставлен в форме/);assert.equal(writes.length,1);assert.equal(select.value,'10');
  await user.click(screen.getByRole('button',{name:'Сохранить маршрут',exact:true}));
  await screen.findByText(/Маршрут сохранён/);assert.equal(writes[1].expected_revision,2);assert.equal(writes[1].coordinator_id,10);
});

test('coordinator retries only the operational receipt and keeps the event awaiting a doctor',async()=>{
  unexpected=[];const writes=[];let current={...initialNotice},fail=true;
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??'GET';
    if(url.startsWith('/coordination/urgent-notices?')&&method==='GET')return Response.json({pending:current.acknowledged_at?0:1,active:1,items:[current],next_before_id:null});
    if(url==='/coordination/urgent-notices/7/acknowledge'&&method==='POST'){
      writes.push({url,body:JSON.parse(options.body)});
      if(fail)return Response.json({detail:'Временный отказ принятия уведомления'},{status:503});
      current={...current,acknowledged_at:stamp,state:'accepted_by_coordinator'};return Response.json({id:7,acknowledged_at:stamp,clinical_alert_acknowledged:false});
    }
    unexpected.push({url,method});return Response.json({detail:'Unexpected clinical request'},{status:500});
  };
  mount(Notices);const user=userEvent.setup({document:dom.window.document});
  await screen.findByRole('heading',{name:'Пациент #4',exact:true});
  assert.match(document.body.textContent,/Ответственный врач/);assert.doesNotMatch(document.body.textContent,/Иван Петров|GAD-7|PHQ-9|21 балл/);
  await user.click(screen.getByRole('button',{name:'Принять организационное уведомление',exact:true}));
  const error=await screen.findByRole('alert');assert.ok(document.activeElement===error);
  fail=false;await user.click(within(error).getByRole('button',{name:/Повторить/}));
  const status=await screen.findByRole('status');await waitFor(()=>assert.ok(document.activeElement===status));
  assert.match(status.textContent,/Принято координатором/);assert.match(document.body.textContent,/Требуют передачи врачу · 1/);
  assert.deepEqual(writes,[{url:'/coordination/urgent-notices/7/acknowledge',body:{}},{url:'/coordination/urgent-notices/7/acknowledge',body:{}}]);
  assert.equal(Boolean(screen.queryByRole('button',{name:'Принять организационное уведомление',exact:true})),false);
});

for(const receivedAt of [null,stamp]){
test(`history preserves the coordinator receipt (${receivedAt?'recorded':'not recorded'}) independently of doctor acceptance`,async()=>{
  unexpected=[];const requests=[];
  globalThis.fetch=async(url,options={})=>{
    const method=options.method??'GET';
    if(url.startsWith('/coordination/urgent-notices?')&&method==='GET'){
      requests.push(url);return Response.json({pending:0,active:0,items:url.includes('view=all')?[{...initialNotice,acknowledged_at:receivedAt,state:'accepted_by_doctor'}]:[],next_before_id:null});
    }
    unexpected.push({url,method});return Response.json({detail:'Unexpected request'},{status:500});
  };
  mount(Notices);const user=userEvent.setup({document:dom.window.document});
  await screen.findByText('Уведомлений для передачи врачу нет',{exact:true});
  await user.click(screen.getByRole('button',{name:'История уведомлений',exact:true}));
  await screen.findByRole('heading',{name:'Пациент #4',exact:true});
  assert.match(screen.getByRole('status').textContent,/Врач принял событие/);
  assert.equal(Boolean(screen.queryByRole('button',{name:'Принять организационное уведомление',exact:true})),false);
  assert.equal(requests.length,2);assert.match(requests[0],/view=active/);assert.match(requests[1],/view=all/);
  assert.equal(Boolean(screen.queryByText('Ваше принятие уведомления',{exact:true})),Boolean(receivedAt));
});
}
