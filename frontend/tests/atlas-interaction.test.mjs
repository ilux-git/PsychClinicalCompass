// Actual React interactions; geometry, touch targets and native scrolling are checked in CUA.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Atlas,Rhythm,Rules,Emergency,render,screen,within,cleanup,userEvent;
before(async()=>{
  dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/",pretendToBeVisual:true});
  for(const name of ["window","document","navigator","Node","Element","HTMLElement","SVGElement","MutationObserver","Event","KeyboardEvent","MouseEvent"]){
    Object.defineProperty(globalThis,name,{configurable:true,value:name==="window"?dom.window:dom.window[name]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.requestAnimationFrame=callback=>{callback();return 0;};
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  ({render,screen,within,cleanup}=await import("@testing-library/react"));
  ({default:userEvent}=await import("@testing-library/user-event"));
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({ParticipationAtlas:Atlas,ParticipationRhythm:Rhythm}=await server.ssrLoadModule("/src/PatientAdventure.tsx"));
  ({ParticipationRules:Rules}=await server.ssrLoadModule("/src/ParticipationRules.tsx"));
  ({EmergencyContacts:Emergency}=await server.ssrLoadModule("/src/EmergencyContacts.tsx"));
});
afterEach(()=>cleanup());
after(async()=>{await server?.close();dom?.window.close();});

test("map controls select a future place without changing the current earned milestone",async()=>{
  render(h(Atlas,{earned:105}));
  const user=userEvent.setup({document:dom.window.document});
  const map=screen.getByRole("group",{name:"Выберите отметку на карте"});
  const future=within(map).getByRole("button",{name:/Новый горизонт/});
  const places=within(map).getAllByRole("button");
  assert.equal(places.length,6);
  assert.ok(places.every(place=>place.querySelector("svg")===null),"Map destinations use dots rather than icons that obscure the artwork");
  assert.match(within(map).getByRole("button",{name:/Южный остров/}).getAttribute("aria-label"),/150 баллов/);
  assert.equal(within(map).getByRole("button",{name:/Маяк/}).getAttribute("aria-current"),"step");
  await user.click(future);
  assert.equal(future.getAttribute("aria-pressed"),"true");
  assert.equal(document.activeElement,future,"Selecting a place preserves control focus");
  assert.equal(within(map).getByRole("button",{name:/Маяк/}).getAttribute("aria-current"),"step");
  const detail=document.getElementById(future.getAttribute("aria-controls"));
  assert.ok(detail);
  assert.equal(within(detail).getByRole("heading",{level:3}).textContent,"Новый горизонт");
  assert.match(detail.textContent,/145 баллов/);
  assert.match(screen.getByText(/105 баллов за всё время/).textContent,/105/);
  const meter=screen.getByRole("progressbar",{name:"Баллы до конца карты"});
  assert.equal(meter.getAttribute("aria-valuenow"),"105");
  assert.equal(meter.getAttribute("aria-valuemax"),"250");
  assert.equal(meter.getAttribute("aria-valuetext"),"105 из 250 баллов участия");
  await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}");
  assert.equal(within(map).getByRole("button",{name:/Южный остров/}).getAttribute("aria-pressed"),"true");
});

test("compact atlas stays a decorative preview without duplicate map controls",()=>{
  render(h(Atlas,{earned:105,compact:true}));
  assert.equal(screen.queryByRole("group",{name:"Выберите отметку на карте"}),null);
  assert.equal(screen.queryAllByRole("button").length,0);
  assert.match(screen.getByText(/105 баллов за всё время/).textContent,/105/);
});

test("compact participation rules lead to the three corresponding activities without long descriptions",async()=>{
  const visited=[];
  const rules=["survey","medication","diary"].map(kind=>({kind,label:kind,description:"Полные условия находятся в подсказке",daily_cap:3,earned_today:0}));
  render(h(Rules,{rules,navigate:view=>visited.push(view)}));
  assert.deepEqual(screen.getAllByRole("heading").map(heading=>heading.textContent),["Опросы","Отметки о лекарствах","Дневник состояния"]);
  assert.equal(screen.queryByText("Полные условия находятся в подсказке"),null);
  const user=userEvent.setup({document:dom.window.document});
  for(const name of ["К моим опросам","Открыть расписание","Открыть дневник"])await user.click(screen.getByRole("button",{name}));
  assert.deepEqual(visited,["surveys","medications","diary"]);
});

test("emergency contacts open for a critical cue, explain the phone action and never dial automatically",async()=>{
  const {rerender}=render(h('div',null,h('input',{'aria-label':'Продолжить сообщение'}),h(Emergency,{active:false})));
  const address=dom.window.location.href;
  assert.equal(document.querySelector('details').open,false,'Emergency instructions stay collapsed during ordinary chat');
  const input=screen.getByRole('textbox',{name:'Продолжить сообщение'});
  await userEvent.setup({document:dom.window.document}).click(input);
  rerender(h('div',null,h('input',{'aria-label':'Продолжить сообщение'}),h(Emergency,{active:true})));
  const emergency=await screen.findByRole('link',{name:'112 · Экстренная служба'});
  assert.equal(emergency.getAttribute('href'),'tel:112');
  assert.equal(screen.getByRole('link',{name:'103 · Скорая помощь'}).getAttribute('href'),'tel:103');
  assert.match(screen.getByRole('alert').textContent,/Позвоните 112 сейчас/);
  assert.ok(screen.getByText('Нажмите кнопку и подтвердите звонок на телефоне.'));
  assert.ok(screen.getByText('Назовите диспетчеру, где Вы находитесь и что произошло.'));
  assert.equal(dom.window.location.href,address);
  assert.ok(document.activeElement===input,'Showing urgent instructions must not move keyboard focus into a telephone link');
});

test("rhythm gives each observed day a different scene and only recorded actions activate its full-color state",async()=>{
  const activity=[{day:"2026-10-19",actions:0,points:0},{day:"2026-10-20",actions:1,points:0},{day:"2026-10-21",actions:2,points:3}];
  render(h(Rhythm,{activity}));
  const rhythm=screen.getByRole("region",{name:"Мой ритм за семь дней"});
  const controls=within(rhythm).getAllByRole("button");
  assert.equal(controls.length,3,"An unavailable part of the week is not manufactured into zero-activity days");
  assert.ok(controls.every(control=>control.querySelector('.rhythm-day-art')),'Every observed day has artwork, including inactive days');
  assert.deepEqual(controls.map(control=>control.querySelector('.rhythm-day-art').getAttribute('src').match(/rhythm-(\w+)\.jpg/)[1]),['mon','tue','wed']);
  assert.equal(controls[0].classList.contains('has-entries'),false);
  assert.equal(controls[1].classList.contains('has-entries'),true,'Recorded participation activates art even when the daily points cap was reached');
  assert.equal(controls[2].classList.contains('has-entries'),true);
  await userEvent.setup({document:dom.window.document}).click(controls[0]);
  assert.equal(controls[0].getAttribute("aria-pressed"),"true");
  assert.equal(controls[0].classList.contains('has-entries'),false,"Selecting a date alone must not count as activity or activate the landscape");
  const detail=document.getElementById(controls[0].getAttribute("aria-controls"));
  assert.match(detail.textContent,/нет учтённых действий/);
  assert.match(rhythm.textContent,/остальные дни недоступны/);
});
