import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {syncCodexAuth} from '../src/codex-auth.mjs';
test('primary login changes refresh old isolated copies without touching session data',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-auth-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const source=path.join(base,'primary.json'),home=path.join(base,'isolated');fs.mkdirSync(home);const auth=path.join(home,'auth.json');fs.writeFileSync(auth,'{"old":true}');fs.writeFileSync(path.join(home,'session.json'),'keep');fs.writeFileSync(source,'{"login":"first"}');assert.equal(syncCodexAuth(home,source).updated,true);assert.equal(fs.readFileSync(auth,'utf8'),fs.readFileSync(source,'utf8'));assert.equal(fs.statSync(auth).mode&0o777,0o600);
 // A refresh performed inside the isolated CLI is not overwritten on every call.
 fs.writeFileSync(auth,'{"local_refresh":true}');assert.equal(syncCodexAuth(home,source).updated,false);assert.equal(JSON.parse(fs.readFileSync(auth)).local_refresh,true);
 fs.writeFileSync(source,'{"login":"second"}');assert.equal(syncCodexAuth(home,source).updated,true);assert.equal(JSON.parse(fs.readFileSync(auth)).login,'second');assert.equal(fs.readFileSync(path.join(home,'session.json'),'utf8'),'keep');
 fs.writeFileSync(source,'invalid');assert.throws(()=>syncCodexAuth(home,source));assert.equal(JSON.parse(fs.readFileSync(auth)).login,'second');
});
