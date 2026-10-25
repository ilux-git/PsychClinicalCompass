import test from "node:test";
import assert from "node:assert/strict";
import {careProgress,verificationProgress} from "../src/careProgress.ts";

test("an uncompleted action never counts as awaiting a result check",()=>{
  const tasks=[
    {status:"open",verification_status:"pending"},
    {status:"in_progress",verification_status:"pending"},
    {status:"done",verification_status:"pending"},
    {status:"done",verification_status:"resolved"},
    {status:"done",verification_status:"not_resolved"},
    {status:"done",verification_status:"unknown"},
  ];
  assert.deepEqual(careProgress(tasks),{active:2,awaiting:1,checked:3});
  assert.equal(tasks[0].status,"open");
});

test("recorded unknown is a performed check, separate from a missing check",()=>{
  const before={action_done:2,verification:{pending:9,unknown:1}};
  assert.deepEqual(verificationProgress(before),{resolved:0,notResolved:0,unknown:1,checked:1,awaiting:1});
  const after={...before,verification:{pending:8,unknown:2}};
  assert.deepEqual(verificationProgress(after),{resolved:0,notResolved:0,unknown:2,checked:2,awaiting:0});
});

test("a completed action moves to waiting before the physician records any outcome",()=>{
  const tasks=[{status:"in_progress",verification_status:"pending"}];
  assert.deepEqual(careProgress(tasks),{active:1,awaiting:0,checked:0});
  assert.deepEqual(careProgress([{...tasks[0],status:"done"}]),{active:0,awaiting:1,checked:0});
  assert.deepEqual(careProgress([{status:"done",verification_status:"not_resolved"}]),{active:0,awaiting:0,checked:1});
});

test("zero tasks remains an empty observation rather than a successful treatment result",()=>{
  assert.deepEqual(careProgress([]),{active:0,awaiting:0,checked:0});
  assert.deepEqual(verificationProgress({action_done:0,verification:{}}),{resolved:0,notResolved:0,unknown:0,checked:0,awaiting:0});
});
