// Synthetic component checks. Actual Telegram launch, native modal focus and layout are separate gates.
import {after,afterEach,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {createElement as h} from 'react';

let dom,server,render,screen,waitFor,cleanup,act,userEvent,Login,TelegramHost,AccountSettings,InteractionProvider,session;
let requests,handle,logins;
const user={id:4,username:'patient1',display_name:'Синтетический пациент',role:'patient',patient_id:1,availability:'offline'};
const authenticated={state:'authenticated',access_token:'fictional-mini-app-session',user};

before(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://compass.test/tg',pretendToBeVisual:true});
  for(const name of ['window','document','navigator','Node','Element','HTMLElement','SVGElement','HTMLInputElement','HTMLDialogElement','MutationObserver','Event','KeyboardEvent','MouseEvent','sessionStorage'])
    Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?dom.window:dom.window[name]});
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  dom.window.matchMedia=query=>({matches:query.includes('prefers-reduced-motion'),media:query,addEventListener(){},removeEventListener(){}});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  ({render,screen,waitFor,cleanup,act}=await import('@testing-library/react'));
  ({default:userEvent}=await import('@testing-library/user-event'));
  server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
  ({TelegramHost}=await server.ssrLoadModule('/src/TelegramEntry.tsx'));
  ({Login}=await server.ssrLoadModule('/src/Login.tsx'));
  ({AccountSettings}=await server.ssrLoadModule('/src/AccountSettings.tsx'));
  ({InteractionProvider}=await server.ssrLoadModule('/src/Interaction.tsx'));
  session=await server.ssrLoadModule('/src/api.ts');
});
beforeEach(()=>{
  requests=[];logins=[];sessionStorage.clear();session.clearSessionToken();
  window.Telegram={WebApp:{initData:'fictional-signed-launch-data'}};
  handle=()=>Response.json({state:'binding_required'});
  globalThis.fetch=async(path,options={})=>{
    const request={path,method:options.method??'GET',body:options.body?JSON.parse(options.body):null};requests.push(request);
    return handle(request);
  };
});
afterEach(()=>{cleanup();session.clearSessionToken();});
after(async()=>{await server.close();dom.window.close();});
const entry=()=>render(h(InteractionProvider,null,h(Login,{onLogin:value=>logins.push(value),sessionMessage:'Сессия завершена'})));


test('Mini App uses password login, stores only an in-memory credential and never creates a Telegram link',async()=>{
  sessionStorage.setItem('compass-token','fictional-independent-web-session');
  handle=()=>Response.json(authenticated);
  entry();const interact=userEvent.setup();
  await interact.selectOptions(screen.getByLabelText('Роль'),'patient1');
  await interact.clear(screen.getByLabelText('Пароль'));
  await interact.type(screen.getByLabelText('Пароль'),'entered-password');
  await interact.click(screen.getByRole('button',{name:'Войти',exact:true}));
  await waitFor(()=>assert.equal(logins.length,1));
  assert.equal(session.sessionToken(),authenticated.access_token);
  assert.equal(sessionStorage.getItem('compass-token'),'fictional-independent-web-session');
  assert.equal(screen.getByLabelText('Пароль').value,'');
  assert.deepEqual(requests,[{path:'/auth/login',method:'POST',body:{username:'patient1',password:'entered-password'}}]);
  assert.equal(sessionStorage.length,1);
});

test('all web demo roles fill editable credentials without signing in automatically',async()=>{
  entry();const interact=userEvent.setup();
  const roles=[['doctor','doctor-pass-123'],['doctor2','doctor-pass-123'],['patient1','patient-pass-123'],['patient10','patient-pass-123'],['patient_aviandr_positive','patient-pass-123'],['patient_aviandr_interaction','patient-pass-123'],['patient_aviandr_renal','patient-pass-123'],['admin','admin-pass-123'],['coordinator','coordinator-pass-123']];
  for(const [name,password] of roles){
    await interact.selectOptions(screen.getByLabelText('Роль'),name);
    assert.equal(screen.getByLabelText('Логин').value,name);
    assert.equal(screen.getByLabelText('Пароль').value,password);
  }
  assert.equal(requests.length,0);assert.equal(logins.length,0);
});

test('a new Mini App entry always displays the password form instead of a signed Telegram auto-login',async()=>{
  const view=entry();assert.ok(screen.getByLabelText('Пароль'));view.unmount();
  session.saveSessionToken('fictional-existing-memory-token');
  entry();assert.ok(screen.getByLabelText('Пароль'));assert.equal(requests.length,0);assert.equal(logins.length,0);
});

test('failed password login remains actionable and does not start a request loop',async()=>{
  handle=()=>Response.json({detail:'Неверный логин или пароль'},{status:401});
  entry();await userEvent.setup().click(screen.getByRole('button',{name:'Войти',exact:true}));
  await screen.findByText('Неверный логин или пароль');
  assert.equal(requests.length,1);assert.equal(logins.length,0);assert.ok(screen.getByLabelText('Пароль'));
});

test('an unmounted password form cannot replace a subsequent user with a late login response',async()=>{
  let resolveLogin;handle=()=>new Promise(resolve=>{resolveLogin=resolve;});
  const view=entry();await userEvent.setup().click(screen.getByRole('button',{name:'Войти',exact:true}));
  await waitFor(()=>assert.equal(typeof resolveLogin,'function'));view.unmount();
  session.saveSessionToken('fictional-newer-account');
  await act(async()=>{resolveLogin(Response.json(authenticated));});
  assert.equal(logins.length,0);assert.equal(session.sessionToken(),'fictional-newer-account');
});

test('password entry works without Telegram identity and sends no Telegram profile fields',async()=>{
  window.Telegram.WebApp.initData='';handle=()=>Response.json(authenticated);
  entry();await userEvent.setup().click(screen.getByRole('button',{name:'Войти',exact:true}));
  await waitFor(()=>assert.equal(logins.length,1));
  assert.deepEqual(Object.keys(requests[0].body).sort(),['password','username']);
});

test('Telegram theme and safe-area changes update the shared document and remove their listeners on exit',async()=>{
  const listeners=new Map();
  const sdk=window.Telegram.WebApp;
  Object.assign(sdk,{colorScheme:'dark',safeAreaInset:{top:4,bottom:8,left:0,right:0},contentSafeAreaInset:{top:42,bottom:0,left:0,right:0},onEvent:(name,handler)=>listeners.set(name,handler),offEvent:(name)=>listeners.delete(name)});
  const view=render(h(TelegramHost,null,h('p',null,'Общий кабинет')));
  await waitFor(()=>assert.equal(document.documentElement.dataset.telegramTheme,'dark'));
  assert.equal(document.documentElement.style.getPropertyValue('--tg-inset-top'),'46px');
  sdk.colorScheme='light';await act(async()=>listeners.get('themeChanged')());
  assert.equal(document.documentElement.dataset.telegramTheme,'light');
  view.unmount();assert.equal(listeners.size,0);assert.equal(document.documentElement.classList.contains('telegram-app'),false);
});


test('account settings explain password-only access, make no binding requests and restore focus',async()=>{
  const opener=document.createElement('button');opener.textContent='Настройки';document.body.append(opener);opener.focus();
  try{
    const view=render(h(InteractionProvider,null,h(AccountSettings,{user,close(){}})));
    await screen.findByText(/Постоянная привязка к Telegram отключена/);
    await screen.findByRole('heading',{name:'Режим стенда',exact:true});
    assert.match(screen.getByRole('dialog').textContent,/синтетическими пациентами/);
    assert.match(screen.getByRole('dialog').textContent,/Внешняя доставка сообщений в Telegram и приём документов ЭМК симулируются/);
    assert.match(screen.getByRole('dialog').textContent,/Реальная скидка, цена приёма и оплата в клинике не меняются/);
    assert.match(screen.getByRole('dialog').textContent,/Сгенерированные завершения опросов участвуют в общих количествах, но исключаются из временных метрик/);
    assert.equal(requests.length,0);assert.equal(screen.queryByRole('button',{name:'Отвязать Telegram'}),null);
    view.unmount();assert.equal(document.activeElement,opener);
  }finally{opener.remove();}
});
