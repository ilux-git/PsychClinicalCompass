// Text/privacy contract only: no browser, layout, focus or interaction assertions.
import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

let server,Summary;
before(async()=>{
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({ClinicDecisionSummary:Summary}=await server.ssrLoadModule("/src/AdminDashboard.tsx"));
});
after(async()=>{await server?.close();});
const visibleText=workflow=>renderToStaticMarkup(createElement(Summary,{workflow})).replace(/<[^>]*>/g," ").replace(/\s+/g," ");
const values=()=>({
  as_of:"2026-10-25T01:15:00Z",
  treatment:{refused:73,in_progress:100,completed:98,unknown:12},
  refusal_reasons:{patients:73,with_specific_reason:70,categories:[]},
  support_requests:{queued:6,awaiting_review:7,total:30},
  tasks:{action_done:90,verification:{resolved:20,not_resolved:5,unknown:10,pending:100}},
});

test("clinic overview separates refused patients, unreviewed requests and completed actions without a check",()=>{
  const text=visibleText({suppressed:false,reason:null,values:values()});
  assert.match(text,/Подтверждённые отказы 73/);
  assert.match(text,/причина известна у 70 из 73/);
  assert.match(text,/Обращения ждут разбора 13/);
  assert.match(text,/Выполнены, ждут проверки 55/);
  assert.match(text,/Текущие статусы, а не отток за период/);
});

test("hidden, unavailable and unconfigured workflow never expose zero or stale protected values",()=>{
  for(const workflow of [null,{suppressed:false,reason:null,values:null},{suppressed:true,reason:"small_group",values:values()}]) {
    const text=visibleText(workflow);
    assert.match(text,/не нулевой результат/);
    assert.match(text,workflow?.suppressed?/скрыты правилами групп/:/пока недоступны/);
    assert.doesNotMatch(text,/73|70|55|2026|Срез на|Подтверждённые отказы/);
  }
});

test("a real zero refusal count stays distinct from unavailable support data",()=>{
  const d=values();d.treatment.refused=0;d.refusal_reasons={patients:0,with_specific_reason:0,categories:[]};delete d.support_requests;
  const text=visibleText({suppressed:false,reason:null,values:d});
  assert.match(text,/Подтверждённые отказы 0/);
  assert.match(text,/по текущим решениям врачей отказов нет/i);
  assert.match(text,/Обращения ждут разбора Нет данных/);
  assert.doesNotMatch(text,/Обращения ждут разбора 0/);
});
