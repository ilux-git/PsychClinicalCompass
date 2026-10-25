import http from 'k6/http';
import {check, sleep, fail} from 'k6';
import exec from 'k6/execution';
import {SharedArray} from 'k6/data';
import {Trend} from 'k6/metrics';
import {randomBytes} from 'k6/crypto';
import {requestLatency} from './load_latency.mjs';

const users = new SharedArray('isolated users', () => JSON.parse(open(__ENV.LOAD_USER_FILE)));
const manifest = JSON.parse(open(__ENV.LOAD_MANIFEST));
const patientCount = Number(__ENV.LOAD_PATIENT_VUS || 1000);
const base = __ENV.LOAD_BASE_URL;
const extended = __ENV.LOAD_EXTENDED_WORKFLOWS === '1';
let nextTask = null, nextAlert = null;
const latency = new Trend('user_request_latency', true);
const legacyLatency = new Trend('legacy_duplicated_connect_latency', true);
const operations = ['assignments','points','history','medications','patient_card','diary_write','message_outbox','directory','task_board','doctor_care','doctor_engagement','clinic_analytics'];
if(extended) operations.push('survey_submit','support_progress','doctor_inbox','task_update','event_action');
const thresholds = {http_req_failed:['rate==0'],checks:['rate==1'],user_request_latency:['max<=500']};
for (const operation of operations) thresholds[`user_request_latency{operation:${operation}}`] = ['max<=500'];
export const options = {
  scenarios:{roles:{executor:'ramping-vus',startVUs:0,stages:[
    {duration:__ENV.LOAD_RAMP || '10s',target:patientCount+21},
    {duration:__ENV.LOAD_DURATION || '30s',target:patientCount+21},
  ],gracefulRampDown:'10s',gracefulStop:'20s'}},
  thresholds,summaryTrendStats:['min','med','avg','p(95)','p(99)','max'],
  systemTags:['status','method','name','check','error_code','scenario'],
  discardResponseBodies:true,
};

export function setup() {
  if (!base || patientCount<1 || patientCount>1000) fail('Invalid bounded local workload');
  const response = http.get(base+'/_load-test/context',{responseType:'text',tags:{name:'isolation_check'}});
  if (response.status !== 200) fail('Target is not an isolated load-test API; no workflow writes sent');
  const context = response.json();
  if (context.run_id !== manifest.run_id || !context.synthetic || context.external_delivery) fail('Isolation marker mismatch');
}

function uuid() {
  const bytes = new Uint8Array(randomBytes(16)); bytes[6] = (bytes[6]&15)|64; bytes[8] = (bytes[8]&63)|128;
  const hex = Array.from(bytes,b => b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export default function() {
  const vu = exec.vu.idInTest;
  const user = users[vu<=patientCount ? vu-1 : 1000+(vu-patientCount)-1];
  let operation, method='GET',path,body=null;
  const i = exec.vu.iterationInScenario+vu;
  if (user.role==='patient') {
    const step=i%(extended ? 9 : 7);
    if(step===0) {operation='assignments';path='/survey-assignments';}
    else if(step===1) {operation='points';path='/participation/points';}
    else if(step===2) {operation='history';path=`/patients/${user.patient_id}/assessments`;}
    else if(step===3) {operation='medications';path=`/patients/${user.patient_id}/medications`;}
    else if(step===4) {operation='patient_card';path=`/patients/${user.patient_id}`;}
    else if(step===5) {operation='diary_write';method='POST';path='/diary/entries';body={text:'Синтетическая нагрузочная запись',client_request_id:uuid()};}
    else if(step===6) {operation='message_outbox';method='POST';path=`/conversations/${user.patient_id}/messages`;body={text:'Синтетическое сообщение нагрузки',channel:'tg_patient',client_request_id:uuid(),support_requested:extended && i%11===0};}
    else if(step===7) {operation='survey_submit';method='POST';path=`/survey-assignments/${user.patient_id}/submit`;body={answers:{barriers:['schedule'],details:'Синтетический ответ для нагрузки'}};}
    else {operation='support_progress';path=`/patients/${user.patient_id}/support-requests`;}
  } else if(user.role==='doctor') {
    if(extended && i%7===5 && nextTask) {
      operation='task_update';method='PATCH';path=`/tasks/${nextTask.id}`;body={status:'in_progress',expected_revision:nextTask.revision};nextTask=null;
    } else if(extended && i%7===6 && nextAlert) {
      operation='event_action';method='POST';path=`/alerts/${nextAlert}/actions`;body={client_request_id:uuid(),title:'Синтетическое следующее действие',kind:'organization',reply:'Синтетический ответ при нагрузочной проверке'};nextAlert=null;
    } else {
      const steps=[['directory','/patients/directory'],['task_board','/coordination/board?stage=open'],['doctor_care','/analytics/care'],['doctor_engagement','/analytics/engagement']];
      if(extended) steps.push(['doctor_inbox','/alerts/inbox']);
      [operation,path]=steps[i%steps.length];
    }
  } else {operation='clinic_analytics';path='/analytics/clinic';}
  const response=http.request(method,base+path,body ? JSON.stringify(body) : null,{
    headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json',...(__ENV.LOAD_TRACE_REQUESTS==='1'?{'X-Load-Request':`${vu}:${i}`}:{})},
    timeout:'20s',responseType:extended && (operation==='task_board' || operation==='doctor_inbox') ? 'text' : 'none',tags:{name:operation,operation},
  });
  const t=response.timings;
  const elapsed=requestLatency(t);
  latency.add(elapsed,{operation});
  // Preserve the previous over-counted metric for transparent comparison only.
  legacyLatency.add(t.blocked+t.connecting+t.tls_handshaking+t.duration,{operation});
  if(elapsed>500) console.warn(JSON.stringify({kind:'slow_workflow',operation,elapsed_ms:elapsed,
    blocked_ms:t.blocked,connecting_ms:t.connecting,tls_ms:t.tls_handshaking,request_ms:t.duration,
    test_ms:exec.instance.currentTestRunDuration,vu,request_id:__ENV.LOAD_TRACE_REQUESTS==='1'?`${vu}:${i}`:undefined}));
  check(response,{'workflow request succeeds':r=>r.status>=200 && r.status<300},{operation});
  if(extended && response.status===200 && operation==='task_board') nextTask=response.json().items[0] || null;
  if(extended && response.status===200 && operation==='doctor_inbox') nextAlert=(response.json().items.find(item=>item.source_kind==='support_request' && item.status==='created') || {}).id || null;
  sleep(Number(__ENV.LOAD_THINK || 1)*(0.8+Math.random()*0.4));
}

export function handleSummary(data) {
  const report={run_id:manifest.run_id,source_fixture_sha256:manifest.source_fixture_sha256,
    verified_at:new Date().toISOString(),synthetic:true,driver:'k6',patient_sessions:patientCount,
    run_started_at:__ENV.LOAD_RUN_STARTED_AT,
    driver_context:__ENV.LOAD_DRIVER_CONTEXT || 'protected desktop execution',
    profile:extended ? 'roles-with-surveys-and-explicit-support-v2' : 'roles-baseline-v1',
    source_fingerprint:__ENV.LOAD_SOURCE_FINGERPRINT || null,
    latency_method:'k6-blocked-plus-duration-v2',
    diagnostic_trace:__ENV.LOAD_TRACE_REQUESTS==='1',
    deployment_mode:__ENV.LOAD_DEPLOYMENT_MODE || 'uvicorn-shared-listener',
    doctor_sessions:20,analyst_sessions:1,limit_ms:500,
    server_configuration:{workers:Number(__ENV.LOAD_SERVER_WORKERS || 1),
      compass_pool_size:Number(__ENV.COMPASS_DB_POOL_SIZE || 5),compass_max_overflow:Number(__ENV.COMPASS_DB_MAX_OVERFLOW || 10),
      mis_pool_size:Number(__ENV.MIS_DB_POOL_SIZE || 5),mis_max_overflow:Number(__ENV.MIS_DB_MAX_OVERFLOW || 10)},
    scope:'Authenticated protocol workflows; excludes login burst and 1000 rendered browsers. Includes connection latency.',
    ...data};
  return {[__ENV.LOAD_REPORT_FILE]:JSON.stringify(report,null,2),
    stdout:JSON.stringify({driver:'k6',patients:patientCount,latency:data.metrics.user_request_latency?.values,
      requests:data.metrics.http_reqs?.values,failures:data.metrics.http_req_failed?.values})+'\n'};
}
