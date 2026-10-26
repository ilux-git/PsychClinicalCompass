// Actual React interactions; geometry, touch targets and native scrolling are checked in CUA.
import {after,afterEach,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {createElement as h} from "react";

let dom,server,Atlas,Rhythm,render,screen,within,cleanup,userEvent;
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
});
afterEach(()=>cleanup());
after(async()=>{await server?.close();dom?.window.close();});

test("map controls select a future place without changing the current earned milestone",async()=>{
  render(h(Atlas,{earned:105}));
  const user=userEvent.setup({document:dom.window.document});
  const map=screen.getByRole("group",{name:"Выберите отметку на карте"});
  const future=within(map).getByRole("button",{name:/Новый горизонт/});
  assert.equal(within(map).getAllByRole("button").length,5);
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
  assert.equal(within(map).getByRole("button",{name:/Маяк/}).getAttribute("aria-pressed"),"true");
});

test("compact atlas stays a decorative preview without duplicate map controls",()=>{
  render(h(Atlas,{earned:105,compact:true}));
  assert.equal(screen.queryByRole("group",{name:"Выберите отметку на карте"}),null);
  assert.equal(screen.queryAllByRole("button").length,0);
  assert.match(screen.getByText(/105 баллов за всё время/).textContent,/105/);
});

test("rhythm reveals art for recorded actions even without awarded points, while an empty day stays covered after selection",async()=>{
  const activity=[{day:"2026-10-19",actions:0,points:0},{day:"2026-10-20",actions:1,points:0},{day:"2026-10-21",actions:2,points:3}];
  render(h(Rhythm,{activity}));
  const rhythm=screen.getByRole("region",{name:"Мой ритм за семь дней"});
  const controls=within(rhythm).getAllByRole("button");
  assert.equal(controls.length,3,"An unavailable part of the week is not manufactured into zero-activity days");
  assert.equal(controls[0].querySelector("img"),null);
  assert.ok(controls[1].querySelector("img"),"An action earns a revealed landscape even when the daily points cap was reached");
  assert.ok(controls[2].querySelector("img"));
  await userEvent.setup({document:dom.window.document}).click(controls[0]);
  assert.equal(controls[0].getAttribute("aria-pressed"),"true");
  assert.equal(controls[0].querySelector("img"),null,"Selecting a date alone must not count as activity or reveal its landscape");
  const detail=document.getElementById(controls[0].getAttribute("aria-controls"));
  assert.match(detail.textContent,/нет учтённых действий/);
  assert.match(rhythm.textContent,/остальные дни недоступны/);
});
