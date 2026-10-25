// Rendering contract only; numeric context must come from the answered version, not a score interpretation.
import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";
import {createElement as h} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {JSDOM} from "jsdom";

let server,Summary;
before(async()=>{
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({AnswerSummary:Summary}=await server.ssrLoadModule("/src/SurveyFields.tsx"));
});
after(async()=>{await server?.close();});
const question=(minimum,maximum)=>({id:"clarity",prompt:"Насколько понятен следующий шаг?",kind:"scale",minimum,maximum,options:[],required:false});
function read(questions,answers){
  const dom=new JSDOM(renderToStaticMarkup(h(Summary,{questions,answers})));
  try{return [...dom.window.document.querySelectorAll('dd')].map(e=>({text:e.textContent,range:e.querySelector('.answer-scale-range')?.textContent??null}));}
  finally{dom.window.close();}
}

test("the same numeric answer retains the bounds of its own question version without normalization",()=>{
  const first=read([question(1,5)],{clarity:4})[0],second=read([question(0,10)],{clarity:4})[0];
  assert.equal(first.range,"Шкала от 1 до 5","A saved number needs its original question bounds");
  assert.equal(second.range,"Шкала от 0 до 10");
  assert.match(first.text,/^4\s+Шкала/);assert.match(second.text,/^4\s+Шкала/);
  assert.doesNotMatch(first.text+second.text,/%|диагноз|выздоров|норма|хорошо|плохо/);
});

test("a known zero remains an answer and an absent optional response never becomes zero",()=>{
  const known=read([question(0,10)],{clarity:0})[0],missing=read([question(0,10)],{})[0];
  assert.match(known.text,/^0/);
  assert.doesNotMatch(known.text,/Нет ответа/);
  assert.equal(missing.text,"Нет ответа");
  assert.equal(missing.range,null,"No range label should be mistaken for a missing patient's response");
});
