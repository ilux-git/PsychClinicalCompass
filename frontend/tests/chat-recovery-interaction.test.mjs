// Actual shared chat: failure retention, retry identity and channel honesty.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Chat,Guard,Interactions,render,screen,cleanup,userEvent,act,fireEvent,waitFor,unexpected;
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","HTMLTextAreaElement","SVGElement","MutationObserver","Event","KeyboardEvent","MouseEvent","sessionStorage"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.matchMedia=query=>({matches:query.includes("prefers-reduced-motion"),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  ({render,screen,cleanup,act,fireEvent,waitFor}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({Chat}=await server.ssrLoadModule("/src/Chat.tsx"));
  ({NavigationGuard:Guard}=await server.ssrLoadModule("/src/NavigationGuard.tsx"));
  ({InteractionProvider:Interactions}=await server.ssrLoadModule("/src/Interaction.tsx"));
});
afterEach(()=>{cleanup();assert.deepEqual(unexpected,[],"The chat fixture accepts only its own messages and support-request reads");});
after(async()=>{await server?.close();dom?.window.close();});

function transport(role,{hold=false,history=false}={}){
  unexpected=[];let fail=true,release;const writes=[],records=[];
  if(history)records.push({id:81,patient_id:2,sender_role:"patient",channel:"web",status:"sent",text:"Предыдущее учебное сообщение",support_requested:false,created_at:"2026-10-24T01:00:00Z"});
  globalThis.fetch=async(path,options={})=>{
    const method=options.method??"GET";
    if(method==="GET"&&path==="/conversations/2/messages")return Response.json(records);
    if(method==="GET"&&path==="/patients/2/support-requests"&&role==="patient")return Response.json([]);
    if(method==="POST"&&path==="/conversations/2/messages"){
      const body=JSON.parse(options.body);writes.push(body);
      if(fail)return Response.json({detail:"Учебный отказ отправки"},{status:503});
      const complete=()=>{
        const message={...body,id:91,patient_id:2,sender_role:role,status:body.channel==="web"?"sent":"queued",created_at:"2026-10-25T01:00:00Z"};
        records.push(message);return Response.json(message,{status:201});
      };
      if(hold)return new Promise(resolve=>{release=()=>resolve(complete());});
      return complete();
    }
    unexpected.push({path,method});return Response.json({detail:"Unexpected test request"},{status:500});
  };
  return {writes,enableWrites:()=>{fail=false;},release:()=>{assert.ok(release);release();}};
}

for(const role of ["patient","doctor"]){
  test(`${role}: one inline sending error retains the message and retry identity without inventing delivery`,async()=>{
    const requests=transport(role),notices=[];
    render(h(Interactions,null,h(Guard,null,h(Chat,{patientId:2,role,simulated:role==="doctor",notify:(...args)=>notices.push(args)}))));
    const user=userEvent.setup({document:dom.window.document});
    await screen.findByText("Диалог ещё не начат");
    await user.type(screen.getByRole("textbox",{name:"Текст сообщения"}),"Синтетический текст для проверки повтора");
    if(role==="patient")await user.click(screen.getByRole("checkbox",{name:/Мне нужна поддержка по этому сообщению/}));
    else assert.ok(screen.getByText(/внешняя доставка не выполняется/));
    await user.click(screen.getByRole("button",{name:"Отправить сообщение"}));
    const error=await screen.findByRole("alert");
    assert.equal(Boolean(error.closest(".chat-panel form")),true,"The failed message needs an error beside the retained composer");
    assert.equal(document.activeElement===error,true);
    assert.deepEqual(notices,[],"Do not duplicate the sending error in a global toast");
    assert.equal(screen.getByRole("textbox",{name:"Текст сообщения"}).value,"Синтетический текст для проверки повтора");
    if(role==="patient")assert.equal(screen.getByRole("checkbox",{name:/Мне нужна поддержка по этому сообщению/}).checked,true);
    const description=error.parentElement.id;
    assert.ok(description);
    assert.equal(error.closest("form").querySelector("fieldset").getAttribute("aria-describedby"),description);
    assert.ok(screen.getByText("Диалог ещё не начат"));
    requests.enableWrites();
    await user.click(screen.getByRole("button",{name:"Отправить сообщение"}));
    await screen.findByText("Синтетический текст для проверки повтора");
    assert.equal(requests.writes.length,2);
    assert.deepEqual(requests.writes[0],requests.writes[1],"An unchanged retry must preserve the same client request and support flag");
    assert.equal(requests.writes[1].channel,role==="doctor"?"tg_doctor":"web");
    assert.equal(screen.getByRole("textbox",{name:"Текст сообщения"}).value,"");
    assert.equal(document.activeElement===screen.getByRole("textbox",{name:"Текст сообщения"}),true,"Successful sending should return the cursor to the composer");
    if(role==="patient")assert.equal(screen.getByRole("checkbox",{name:/Мне нужна поддержка по этому сообщению/}).checked,false);
    assert.equal(Boolean(screen.queryByRole("alert")),false);
    assert.ok(screen.getByText(role==="patient"?"Сохранено":"В очереди симулятора"));
    assert.equal(Boolean(screen.queryByText("Доставлено в Telegram")),false);
  });
}

test("a delayed successful send does not steal focus from another chosen control",async()=>{
  const requests=transport("patient",{hold:true});requests.enableWrites();
  render(h(Interactions,null,h(Guard,null,h(Chat,{patientId:2,role:"patient",notify:()=>{}}),h("button",null,"Открыть памятку"))));
  const user=userEvent.setup({document:dom.window.document});
  await screen.findByText("Диалог ещё не начат");
  await user.type(screen.getByRole("textbox",{name:"Текст сообщения"}),"Синтетический пример с задержкой");
  await user.click(screen.getByRole("button",{name:"Отправить сообщение"}));
  const other=screen.getByRole("button",{name:"Открыть памятку"});await user.click(other);
  await act(async()=>requests.release());
  await screen.findByText("Синтетический пример с задержкой");
  assert.equal(document.activeElement===other,true,"The later intentional focus must take precedence over automatic composer focus");
  assert.equal(requests.writes.length,1);
});

test("reading older messages during a pending send preserves position until Show latest is chosen",async()=>{
  const requests=transport("doctor",{hold:true,history:true});requests.enableWrites();
  render(h(Interactions,null,h(Guard,null,h(Chat,{patientId:2,role:"doctor",notify:()=>{}}))));
  const user=userEvent.setup({document:dom.window.document});
  await screen.findByText("Предыдущее учебное сообщение");
  const log=screen.getByRole("log",{name:"История переписки"});
  // JSDOM has no layout: explicit metrics model an independently native-tested scrollable history.
  Object.defineProperties(log,{scrollHeight:{configurable:true,value:1169},clientHeight:{configurable:true,value:220}});
  log.scrollTop=949;log.scrollTo=({top})=>{log.scrollTop=top;};
  await user.type(screen.getByRole("textbox",{name:"Текст сообщения"}),"Новый учебный ответ с задержкой");
  await user.click(screen.getByRole("button",{name:"Отправить сообщение"}));
  fireEvent.scroll(log,{target:{scrollTop:180}});
  await act(async()=>requests.release());
  await screen.findByText("Новый учебный ответ с задержкой");
  assert.equal(log.scrollTop,180,"A saved outgoing message must not override a later manual reading position");
  await user.click(await screen.findByRole("button",{name:"Новые сообщения · Показать"}));
  assert.ok(log.scrollTop>=log.scrollHeight-log.clientHeight);
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole("button",{name:"Новые сообщения · Показать"})),false));
  assert.equal(document.activeElement===log,true,"After the temporary Show latest button disappears, focus must remain in the history");
  assert.equal(requests.writes.length,1);
});
