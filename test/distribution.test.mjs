import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {initialize} from '../scripts/setup.mjs';import {assertPublishable} from '../scripts/package.mjs';import {root,validate} from '../src/config.mjs';
test('fresh installation creates generic disabled app and never overwrites local settings or secrets',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slo-distribution-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const file of ['config/buddy.example.json','examples/feishu.env.example']){fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(dir,file));}
 assert.equal(initialize(dir).length,2);const file=path.join(dir,'config/buddy.json'),config=validate(JSON.parse(fs.readFileSync(file)));assert.equal(config.apps[0].enabled,false);assert.equal(config.inheritGlobalPersona,false);assert.ok(config.schedules.every(j=>j.enabled===false));assert.deepEqual(config.botMessages.allowlist,[]);assert.equal(config.policies.group.documentWrite,false);
 const custom='{"personal":"do not replace"}';fs.writeFileSync(path.join(dir,'.private/apps/main.env'),custom);config.persona.tone='My custom tone';fs.writeFileSync(file,JSON.stringify(config));const original=fs.readFileSync(file,'utf8');assert.deepEqual(initialize(dir),[]);assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(fs.readFileSync(path.join(dir,'.private/apps/main.env'),'utf8'),custom);
});
test('release guard rejects local configuration, data and embedded credentials',()=>{
 for(const file of ['config/buddy.json','.private/memory.json','logs/service.log','artifacts/image.png','STATUS.md','src/auth.json','src/backup.sqlite'])assert.throws(()=>assertPublishable(file,''));
 const secret='FEISHU_APP_SECRET'+'='+'not-a-placeholder';assert.throws(()=>assertPublishable('README.md',secret));assert.throws(()=>assertPublishable('README.md','cli_'+'a'.repeat(16)));assert.throws(()=>assertPublishable('README.md','/Users/'+'someone/private'));
 assert.doesNotThrow(()=>assertPublishable('config/buddy.example.json',fs.readFileSync(path.join(root,'config/buddy.example.json'),'utf8')));assert.doesNotThrow(()=>assertPublishable('examples/feishu.env.example',['FEISHU_APP_ID','FEISHU_APP_SECRET'].map(key=>key+'=').join('\n')+'\n'));
});
test('optional knowledge seed initializes only background knowledge and never overwrites it',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slo-knowledge-seed-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const file of ['config/buddy.example.json','examples/feishu.env.example']){fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(dir,file));}
 const seed={private:'',shared:'# 群成员描述\n- 示例成员：喜欢运动。'};fs.writeFileSync(path.join(dir,'examples/background-knowledge.json'),JSON.stringify(seed));assert.equal(initialize(dir).length,3);const file=path.join(dir,'.private/memory.json');assert.deepEqual(JSON.parse(fs.readFileSync(file)),seed);const config=JSON.parse(fs.readFileSync(path.join(dir,'config/buddy.json')));assert.deepEqual(config.botMessages.allowlist,[]);
 fs.writeFileSync(file,JSON.stringify({private:'my own notes',shared:'edited knowledge'}));initialize(dir);assert.equal(JSON.parse(fs.readFileSync(file)).shared,'edited knowledge');
});
