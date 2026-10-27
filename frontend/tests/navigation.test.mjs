import test from "node:test";
import assert from "node:assert/strict";
import {createWorkspaceHistory,pageRoute,readRoute,routeHref} from "../src/routes.ts";

function browser(initial="/",initialState=null) {
  const entries=[{href:initial,state:initialState}],events=[];
  let index=0,listener=()=>{};
  return {
    href:()=>entries[index].href,state:()=>entries[index].state,
    push(state,href){entries.splice(index+1);entries.push({state,href});index++;},
    replace(state,href){entries[index]={state,href};},
    go(delta){const next=index+delta;assert.ok(next>=0&&next<entries.length);index=next;events.push(()=>listener());},
    listen(callback){listener=callback;return()=>{listener=()=>{};};},
    flush(){let count=0;while(events.length){assert.ok(++count<20,"History must settle");events.shift()();}},
  };
}

test('Mini App role navigation, guarded Back/Forward and reload always retain /tg',()=>{
  for(const role of ['patient','doctor']) {
    const port=browser('/tg'),seen=[];
    const options={role,owner:1,port,approve:action=>action(),apply:route=>seen.push(route.view)};
    let controller=createWorkspaceHistory(options);
    const destination=role==='patient'?'diary':'patients';
    controller.push(pageRoute(role,destination));
    assert.match(port.href(),/^\/tg\?section=/);
    port.go(-1);port.flush();assert.match(port.href(),/^\/tg\?section=/);
    port.go(1);port.flush();assert.equal(seen.at(-1),destination);
    controller.dispose();controller=createWorkspaceHistory(options);
    assert.equal(seen.at(-1),destination);assert.match(port.href(),/^\/tg\?section=/);
    assert.match(routeHref(pageRoute(role,destination),'/tg'),/^\/tg\?/);
    controller.dispose();
  }
});

test("links restore a physician card and tab after reload; invalid identifiers are rejected",()=>{
  const route=readRoute("doctor","/?section=patients&patient=6&tab=care");
  assert.equal(route.patientId,6);assert.equal(route.cardTab,"care");
  assert.deepEqual(readRoute("doctor",routeHref(route)),route);
  for(const id of ["0","-1","NaN","1e3","9007199254740992","<script>"])
    assert.equal(readRoute("doctor",`/?section=patients&patient=${encodeURIComponent(id)}`).patientId,null);
});
test("patient links resume a survey but never permit a physician card; roles retain their own home",()=>{
  assert.equal(readRoute("patient","/?section=surveys&assignment=18").assignmentId,18);
  for(const role of ["patient","admin","coordinator"]){
    const route=readRoute(role,"/?section=patients&patient=6&tab=clinical");
    assert.equal(route.patientId,null);assert.equal(route.view,"overview");
  }
  assert.equal(readRoute("doctor","/").view,"home");
});
test("Back and Forward restore the actual page, then reload preserves it",()=>{
  const port=browser(),seen=[];
  const history=createWorkspaceHistory({role:"doctor",owner:1,port,approve:action=>action(),apply:route=>seen.push(route.view)});
  history.push(pageRoute("doctor","patients"));history.push(pageRoute("doctor","events"));
  port.go(-1);port.flush();assert.equal(seen.at(-1),"patients");assert.match(port.href(),/section=patients/);
  port.go(1);port.flush();assert.equal(seen.at(-1),"events");
  history.dispose();
  createWorkspaceHistory({role:"doctor",owner:1,port,approve:action=>action(),apply:route=>seen.push(route.view)});
  assert.equal(seen.at(-1),"events");
});
test("cancelled Back retains URL and form; approving the next Back traverses once",()=>{
  const port=browser(),seen=[];let pending=null,dirty=false;
  const history=createWorkspaceHistory({role:"patient",owner:2,port,approve:action=>{if(dirty)pending=action;else action();},apply:route=>seen.push(route.view)});
  history.push(pageRoute("patient","diary"));dirty=true;
  port.go(-1);port.flush();assert.equal(seen.at(-1),"diary");assert.match(port.href(),/section=diary/);
  pending=null; // User stays; the form has not been unmounted.
  port.go(-1);port.flush();assert.equal(seen.at(-1),"diary");
  pending();port.flush();assert.equal(seen.at(-1),"overview");
  assert.equal(seen.filter(view=>view==="overview").length,2);
});
test("source metadata survives back-forward; another account cannot restore its context",()=>{
  const port=browser(),seen=[];
  const history=createWorkspaceHistory({role:"doctor",owner:1,port,approve:action=>action(),apply:(route,context)=>seen.push({route,context})});
  history.push(pageRoute("doctor","overview"));
  const route=readRoute("doctor","/?section=patients&patient=6&tab=feedback");
  history.push(route,{origin:{view:"overview",key:"analytics-quote-17-q1"}});
  port.go(-1);port.flush();port.go(1);port.flush();
  assert.equal(seen.at(-1).context.origin.key,"analytics-quote-17-q1");
  history.dispose();
  createWorkspaceHistory({role:"doctor",owner:9,port,approve:action=>action(),apply:(route,context)=>seen.push({route,context})});
  assert.equal(seen.at(-1).route.view,"home");assert.deepEqual(seen.at(-1).context,{});
});

test("Back through card tabs preserves the patient and reports the target tab to the guard",()=>{
  const port=browser(),seen=[],targets=[];
  const history=createWorkspaceHistory({role:"doctor",owner:1,port,approve:(action,target)=>{targets.push(target);action();},apply:route=>seen.push(route)});
  history.push(readRoute("doctor","/?section=patients&patient=6&tab=feedback"));
  history.push(readRoute("doctor","/?section=patients&patient=6&tab=care"));
  port.go(-1);port.flush();assert.equal(seen.at(-1).patientId,6);assert.equal(seen.at(-1).cardTab,"feedback");
  assert.equal(targets.at(-1).patientId,6);assert.equal(targets.at(-1).cardTab,"feedback");
  port.go(1);port.flush();assert.equal(seen.at(-1).cardTab,"care");
});
test("a write in progress blocks Back; finishing the write does not silently navigate",()=>{
  const port=browser(),seen=[];let writing=true;
  const history=createWorkspaceHistory({role:"patient",owner:2,port,approve:action=>{if(!writing)action();},apply:route=>seen.push(route.view)});
  history.push(pageRoute("patient","chat"));
  port.go(-1);port.flush();assert.equal(seen.at(-1),"chat");assert.match(port.href(),/section=chat/);
  writing=false;assert.equal(seen.at(-1),"chat");
  port.go(-1);port.flush();assert.equal(seen.at(-1),"overview");
});
test("repeated clicks do not create duplicate history; a new destination replaces the Forward branch",()=>{
  const port=browser(),seen=[];
  const history=createWorkspaceHistory({role:"doctor",owner:1,port,approve:action=>action(),apply:route=>seen.push(route.view)});
  history.push(pageRoute("doctor","patients"));history.push(pageRoute("doctor","patients"));
  port.go(-1);port.flush();assert.equal(seen.at(-1),"home");
  port.go(1);port.flush();history.push(pageRoute("doctor","tasks"));
  port.go(-1);port.flush();history.push(pageRoute("doctor","surveys"));
  port.go(-1);port.flush();port.go(1);port.flush();assert.equal(seen.at(-1),"surveys");
});
test("a delayed approval from a signed-out account cannot restore its page",()=>{
  const port=browser(),seen=[];let pending=null;
  const history=createWorkspaceHistory({role:"patient",owner:2,port,approve:action=>{pending=action;},apply:route=>seen.push(route.view)});
  history.push(pageRoute("patient","diary"));port.go(-1);port.flush();
  history.dispose();const before=port.href();pending();port.flush();
  assert.equal(port.href(),before);assert.equal(seen.at(-1),"diary");
});
test("history stores only navigation metadata and tolerates malformed context",()=>{
  const port=browser("/?section=patients",{compassNavigation:{owner:1,index:0,context:null}}),seen=[];
  const history=createWorkspaceHistory({role:"doctor",owner:1,port,approve:action=>action(),apply:(route,context)=>seen.push(context)});
  history.push(readRoute("doctor","/?section=patients&patient=6&tab=feedback"),{
    private_note:"unsent medical text",origin:{view:"not-a-section",key:"x"},
    answer:{assignmentId:-2,submissionId:5,questionId:"q1"},returnPoint:{scope:"patients",key:"directory-6"},
  });
  assert.deepEqual(seen.at(-1),{returnPoint:{scope:"patients",key:"directory-6"}});
  assert.ok(!JSON.stringify(port.state()).includes("medical"));
});
test("older history entries from another account open the current role home without patient context",()=>{
  const port=browser(),seen=[];
  const first=createWorkspaceHistory({role:"doctor",owner:1,port,approve:action=>action(),apply:()=>{}});
  first.push(pageRoute("doctor","patients"));first.push(readRoute("doctor","/?section=patients&patient=6&tab=clinical"));first.dispose();
  const second=createWorkspaceHistory({role:"admin",owner:9,port,approve:action=>action(),apply:(route,context)=>seen.push({route,context})});
  second.push(pageRoute("admin","barriers"));port.go(-2);port.flush();
  assert.equal(seen.at(-1).route.view,"overview");assert.equal(seen.at(-1).route.patientId,null);assert.deepEqual(seen.at(-1).context,{});
});
