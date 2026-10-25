// Server text contract for missing data, not browser/interaction evidence.
import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

let server,Calm,Rhythm;
before(async()=>{
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({ParticipationCalm:Calm,ParticipationRhythm:Rhythm}=await server.ssrLoadModule("/src/PatientAdventure.tsx"));
});
after(async()=>{await server?.close();});
const text=(component,activity)=>renderToStaticMarkup(createElement(component,{activity})).replace(/<[^>]*>/g," ").replace(/\s+/g," ");

test("calm mode distinguishes an unavailable week from seven observed days without entries",()=>{
  const unknown=text(Calm,[]);
  assert.match(unknown,/недоступн/i);
  assert.doesNotMatch(unknown,/нет учтённых действий/i);
  const knownEmpty=Array.from({length:7},(_,i)=>({day:`2026-10-${18+i}`,actions:0,points:0}));
  assert.match(text(Calm,knownEmpty),/нет учтённых действий/i);
  assert.match(text(Calm,knownEmpty.slice(0,3)),/остальные дни недоступны/);
  assert.doesNotMatch(text(Calm,knownEmpty.slice(0,3)),/За последние 7 дней в приложении нет/);
});
test("rhythm with missing data does not show a zero active-days result",()=>{
  const unknown=text(Rhythm,[]);
  assert.match(unknown,/недоступн/i);
  assert.doesNotMatch(unknown,/0 дней с записями/);
  const knownEmpty=Array.from({length:7},(_,i)=>({day:`2026-10-${18+i}`,actions:0,points:0}));
  assert.match(text(Rhythm,knownEmpty),/0 дней с записями/);
  assert.match(text(Rhythm,knownEmpty.slice(0,3)),/Доступно 3 из 7 дней/);
});
