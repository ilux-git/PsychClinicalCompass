import test from "node:test";
import assert from "node:assert/strict";
import {clinicalGuidance} from "../src/clinicalGuidance.ts";

const review=(codes)=>({rule_version:"medical_answers_20261026_v1",source:"medical_answers_2026-10-26",
  grounds:codes.map(code=>({code,family:"test",label:code})),immediate_danger_established:false});

test("a high approved result requires doctor contact; medium GAD-7 recommends it",()=>{
  for(const code of ["phq9_above_15","gad7_high"])
    assert.equal(clinicalGuidance(review([code]))[0].category,"required");
  assert.equal(clinicalGuidance(review(["gad7_medium"]))[0].category,"recommended");
  assert.deepEqual(clinicalGuidance(review([])),[]);
});

test("item 9 remains clarification and the conditional referral never asserts treatment failure",()=>{
  const source=review(["phq9_item9_positive","phq9_growth_10"]),before=structuredClone(source);
  const rows=clinicalGuidance(source);
  assert.equal(rows.find(row=>row.code==="item9_clarification").category,"recommended");
  assert.match(rows[0].description,/12–24/);
  const referral=rows.find(row=>row.code==="psychiatry_review");
  assert.equal(referral.conditional,true);
  assert.match(referral.description,/сам по себе не доказывает/);
  assert.deepEqual(source,before);
});

test("unknown rule editions or sources do not acquire approved action categories",()=>{
  assert.deepEqual(clinicalGuidance({...review(["gad7_high"]),rule_version:"unapproved"}),[]);
  assert.deepEqual(clinicalGuidance({...review(["gad7_high"]),source:"unapproved"}),[]);
});

test("the new protocol makes item9 clarification urgent without inheriting the historical 12–24 hour instruction",()=>{
  const current={...review(['phq9_item9_positive']),rule_version:'medical_alerts_20261027_v2',source:'physician_alerts_2026-10-27'};
  const [action]=clinicalGuidance(current);
  assert.equal(action.category,'required');
  assert.match(action.description,/Срочно связаться/);
  assert.doesNotMatch(action.description,/12–24/);
  assert.match(action.description,/не подтверждает непосредственную угрозу/);
});
