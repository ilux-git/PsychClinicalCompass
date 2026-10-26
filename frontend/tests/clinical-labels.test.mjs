import test from "node:test";
import assert from "node:assert/strict";
import {diagnosisLabel,prescriptionLabel} from "../src/clinicalLabels.ts";

test("a code label requires an exact known code and does not extend to a different subcode or free text",()=>{
  assert.equal(diagnosisLabel("F32.1").name,"Депрессивный эпизод средней степени");
  assert.match(diagnosisLabel("F41.1").source,/id=457_3/);
  for(const raw of ["F32.11","F43.1","F32.1 под вопросом","тревожность","F32.1; F41.1"])
    assert.equal(diagnosisLabel(raw),null,raw);
});

test("a known source label keeps the dose text and never rewrites personal entries",()=>{
  assert.equal(prescriptionLabel("Sertraline 50mg","MIS"),"Сертралин 50 мг");
  assert.equal(prescriptionLabel("Clonazepam 0.5mg","synthetic_mis_json"),"Клоназепам 0.5 мг");
  assert.equal(prescriptionLabel("Sertraline 50mg","patient_entered"),"Sertraline 50mg");
  assert.equal(prescriptionLabel("Sertraline 50mg","unknown"),"Sertraline 50mg");
});

test("unknown names, different units, formulations and dosing instructions remain exact source text",()=>{
  for(const raw of ["Unknown 50mg","constructor 50mg","Sertraline 0.05g","Sertraline 50mg дважды в день","Sertraline XL 50mg","Sertraline 50mg + 25mg"])
    assert.equal(prescriptionLabel(raw,"MIS"),raw);
});
