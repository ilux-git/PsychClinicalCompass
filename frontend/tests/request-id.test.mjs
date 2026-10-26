import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";

let server,createRequestId;
before(async()=>{
  server=await createServer({root:fileURLToPath(new URL("../",import.meta.url)),server:{middlewareMode:true,hmr:false},appType:"custom"});
  ({createRequestId}=await server.ssrLoadModule("/src/requestId.ts"));
});
after(async()=>{await server?.close();});

test("the native secure-context implementation retains its receiver",()=>{
  const source={randomUUID(){assert.equal(this,source);return "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";},getRandomValues(){throw new Error("Fallback should not run");}};
  assert.equal(createRequestId(source),"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
});
test("LAN fallback obtains random bytes and produces a valid v4 UUID for every byte boundary",()=>{
  for(const value of [0,0x3f,0x80,0xff]){
    let calls=0;
    const source={getRandomValues(array){calls++;assert.equal(array.byteLength,16);array.fill(value);return array;}};
    const result=createRequestId(source);
    assert.match(result,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(calls,1);
  }
});
test("missing cryptographic randomness is an explicit failure rather than a weak request identity",()=>{
  assert.throws(()=>createRequestId({}),/Браузер не поддерживает безопасное создание идентификатора/);
});
