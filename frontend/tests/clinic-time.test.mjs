import test from "node:test";
import assert from "node:assert/strict";
import {clinicDay,clinicInputValue,clinicInputToIso} from "../src/clinicTime.ts";

test("the clinic day changes at Moscow midnight independently of the browser timezone",()=>{
  assert.equal(clinicDay(new Date("2026-10-27T20:59:59Z")),"2026-10-27");
  assert.equal(clinicDay(new Date("2026-10-27T21:00:00Z")),"2026-10-28");
  assert.equal(clinicInputValue(new Date("2026-10-27T21:00:00Z")),"2026-10-28T00:00");
});

test("a Moscow diary or care deadline roundtrips as an absolute timestamp",()=>{
  assert.equal(clinicInputToIso("2026-10-28T00:30"),"2026-10-27T21:30:00.000Z");
  assert.equal(clinicInputValue(new Date("2026-10-27T21:30:00Z")),"2026-10-28T00:30");
});
