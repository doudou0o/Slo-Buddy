import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { documentId, outputFile, Feishu } from '../src/feishu.mjs';
test('document URLs cannot redirect credentials to another host', () => {
  assert.equal(documentId('https://team.feishu.cn/docx/abc123'), 'abc123');
  assert.throws(() => documentId('https://evil.com/docx/abc123'));
  assert.throws(() => documentId('https://feishu.cn.evil.com/docx/abc123'));
  assert.throws(() => documentId('https://team.feishu.cn/wiki/abc123'));
});
test('uploads reject credentials, traversal, and symlinks outside artifacts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'fsbot-files-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'artifacts')); fs.writeFileSync(path.join(dir,'.env'),'secret');
  fs.writeFileSync(path.join(dir,'artifacts','good.txt'),'ok');
  fs.symlinkSync(path.join(dir,'.env'),path.join(dir,'artifacts','link.txt'));
  assert.equal(outputFile(dir,'artifacts/good.txt'),fs.realpathSync(path.join(dir,'artifacts','good.txt')));
  assert.throws(()=>outputFile(dir,'.env')); assert.throws(()=>outputFile(dir,'artifacts/../.env'));
  assert.throws(()=>outputFile(dir,'artifacts/link.txt'));
});
test('API errors do not include credentials or request bodies', async () => {
  const api=new Feishu({appId:'id',appSecret:'secret',root:'/tmp',fetchImpl:async()=>new Response(JSON.stringify({code:999,msg:'secret'}),{status:403})});
  await assert.rejects(()=>api.token(),e=>!e.message.includes('secret'));
});

test('rich text preserves instructions and downloads embedded images', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbot-post-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const api = new Feishu({root}); const routes=[];
  api.request = async route => {routes.push(route);return Buffer.from('test image');};
  const result=await api.downloadMessage({message_type:'post',message_id:'message',chat_id:'chat',content:JSON.stringify({title:'标题',content:[[{tag:'at',user_id:'bot'},{tag:'text',text:'描述图片'}],[{tag:'img',image_key:'image'},{tag:'img',image_key:'image'}]]})});
  assert.equal(result.text,'标题\n描述图片'); assert.equal(result.images.length,1);
  assert.equal(routes.length,1);assert.match(routes[0],/resources\/image\?type=image$/);
});
