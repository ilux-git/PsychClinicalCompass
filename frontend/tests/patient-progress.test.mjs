import test from "node:test";
import assert from "node:assert/strict";
import {discountProgress,latestAssessmentSeries,pendingSurveys,surveyRewardEstimate} from "../src/patientProgress.ts";

const offer={id:"visit_5",title:"Demo",points:100,discount_percent:5};

test("discount eligibility follows free balance, not lifetime points or an opened map",()=>{
  const points={balance:50,earned_total:250,reserved_points:200};
  assert.deepEqual(discountProgress(points,offer),{available:50,remaining:50,value:50,maximum:100,canExchange:false});
  assert.equal(discountProgress({...points,balance:100},offer).canExchange,true);
  assert.equal(discountProgress({...points,balance:300},offer).value,100);
  assert.equal(discountProgress({...points,balance:0},offer).remaining,100);
});

test("reward estimate is capped, includes optional effort only as an upper bound, and is unknown without rules",()=>{
  const questions=[{kind:"single",required:true},{kind:"text",required:false}];
  const rule={kind:"survey",daily_cap:30,earned_today:29};
  assert.equal(surveyRewardEstimate(questions,rule),1);
  assert.equal(surveyRewardEstimate(questions,{...rule,earned_today:0}),3);
  assert.equal(surveyRewardEstimate(questions,{...rule,earned_today:30}),0);
  assert.equal(surveyRewardEstimate(questions,undefined),null);
});

function measurement(id,form,version,at,score) {return {id,form_type:form,form_version:version,created_at:at,score};}

test("symptom change never compares scales or versions, including when the new version has only one point",()=>{
  const rows=[measurement(1,"phq9","old","2026-10-01T00:00:00Z",25),
    measurement(2,"phq9","new","2026-10-20T00:00:00Z",10),
    measurement(3,"gad7","old","2026-10-22T00:00:00Z",1)];
  const result=latestAssessmentSeries(rows,"phq9");
  assert.equal(result.change,null);assert.equal(result.points.length,1);assert.equal(result.version,"new");
  assert.equal(latestAssessmentSeries([],"phq9"),null);
});

test("a zero score is retained, points sort by date, and equal timestamps do not establish a trajectory",()=>{
  const first=measurement(4,"gad7","v1","2026-10-01T00:00:00Z",5);
  const last=measurement(2,"gad7","v1","2026-10-03T00:00:00Z",0);
  const result=latestAssessmentSeries([last,first],"gad7");
  assert.equal(result.latest.score,0);assert.equal(result.change,-5);
  assert.deepEqual(result.points.map(p=>p.id),[4,2]);
  assert.equal(latestAssessmentSeries([first,{...first,id:5,score:2}],"gad7").change,null);
});

test("resume the patient's draft first; otherwise use the physician due date; sent answers are excluded",()=>{
  const base={created_at:"2026-10-01T00:00:00Z",submission:null,due_at:null};
  const rows=[{...base,id:1},{...base,id:2,due_at:"2026-10-24T00:00:00Z"},
    {...base,id:3,draft_updated_at:"2026-10-23T00:00:00Z"},
    {...base,id:4,submission:{id:1}}];
  assert.deepEqual(pendingSurveys(rows).map(row=>row.id),[3,2,1]);
  assert.deepEqual(rows.map(row=>row.id),[1,2,3,4]);
});
