import test from "node:test";
import assert from "node:assert/strict";
import {requestLatency} from "../load_latency.mjs";

test("new connection includes DNS, TCP and TLS inside blocked exactly once",()=>{
  // k6 GetConn -> GotConn already brackets TCP/TLS (httpext/tracer.go).
  assert.equal(requestLatency({blocked:30,connecting:20,tls_handshaking:5,duration:300}),330);
});
test("a reused connection still retains queue time and the complete request duration",()=>{
  assert.equal(requestLatency({blocked:10,connecting:0,tls_handshaking:0,duration:600}),610);
  assert.ok(requestLatency({blocked:0,connecting:0,tls_handshaking:0,duration:501})>500);
});
test("a request timeout remains a failed latency threshold even without a new connection",()=>{
  assert.equal(requestLatency({blocked:0,connecting:0,tls_handshaking:0,duration:20000}),20000);
});
