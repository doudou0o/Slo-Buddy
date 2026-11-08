import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, Bot, splitText } from '../src/core.mjs';

function fixture(t, run = async () => '完成') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbot-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const sent = [];
  const bot = new Bot({ store, agent: { run }, send: async (...args) => sent.push(args), timeoutMs: 5000 });
  return { dir, store, sent, bot };
}
let sequence = 0;
const event = (text, extra = {}) => ({ sender: { sender_type: 'user', sender_id: { open_id: 'owner' } },
  message: { chat_type: 'p2p', message_type: 'text', chat_id: 'chat', message_id: `m${++sequence}`, content: JSON.stringify({ text }), ...extra } });
const drain = bot => Promise.all([...bot.pending]);

test('only owner mentions of this bot run in a group, group context stays separate', async t => {
  const calls = [];
  const { bot, store } = fixture(t, async (text, { threadId, onThread }) => {
    calls.push({ text, threadId }); onThread(`thread-${calls.length}`); return 'OK';
  });
  store.data.users = ['owner']; bot.botOpenId = 'our-bot';
  const group = { chat_type: 'group', chat_id: 'group-chat', mentions: [{ key: '@_user_1', id: { open_id: 'our-bot' } }] };
  bot.accept(event('群里普通消息', { chat_type: 'group' }));
  bot.accept(event('@_user_1 别的机器人', { ...group, mentions: [{ key: '@_user_1', id: { open_id: 'other-bot' } }] }));
  const stranger = event('@_user_1 hello', group); stranger.sender.sender_id.open_id = 'stranger';
  bot.accept(stranger); await drain(bot); assert.equal(calls.length, 0);
  bot.accept(event('@_user_1 群任务', group)); await drain(bot);
  bot.accept(event('私聊任务')); await drain(bot);
  bot.accept(event('@_user_1 继续群任务', group)); await drain(bot);
  assert.deepEqual(calls, [{ text: '群任务', threadId: undefined }, { text: '私聊任务', threadId: undefined }, { text: '继续群任务', threadId: 'thread-1' }]);
});
test('pairing is never accepted from a group even when the bot is mentioned', async t => {
  const { bot, store } = fixture(t); bot.botOpenId = 'our-bot';
  bot.accept(event(`@_user_1 /pair ${store.data.pairing}`, { chat_type: 'group', mentions: [{ key: '@_user_1', id: { open_id: 'our-bot' } }] }));
  await drain(bot); assert.deepEqual(store.data.users, []);
});

test('ignores unpaired users and group messages', async t => {
  let calls = 0;
  const { bot, store, sent } = fixture(t, async () => { calls++; });
  bot.accept(event('hello'));
  bot.accept(event(`/pair ${store.data.pairing}`, { chat_type: 'group' }));
  await drain(bot);
  assert.equal(calls, 0); assert.equal(sent.length, 0); assert.deepEqual(store.data.users, []);
});
test('pairing is single-owner, persistent and consumes the code', async t => {
  const { bot, store, dir } = fixture(t);
  const code = store.data.pairing;
  bot.accept(event(`/pair ${code}`)); await drain(bot);
  assert.deepEqual(store.data.users, ['owner']); assert.equal(store.data.pairing, null);
  const other = event(`/pair ${code}`); other.sender.sender_id.open_id = 'stranger';
  bot.accept(other); await drain(bot);
  assert.deepEqual(new Store(dir).data.users, ['owner']);
});
test('WS acceptance is immediate, duplicates never run twice, progress and stop work', async t => {
  let calls = 0;
  const { bot, store, sent } = fixture(t, (_text, { signal, onProgress }) => {
    calls++; onProgress('正在处理测试');
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  store.data.users = ['owner'];
  const request = event('长任务');
  assert.equal(bot.accept(request), undefined);
  bot.accept(request);
  await new Promise(resolve => setImmediate(resolve));
  bot.accept(event('/status'));
  bot.accept(event('第二个任务'));
  bot.accept(event('/new'));
  bot.accept(event('/stop'));
  await drain(bot);
  assert.equal(calls, 1);
  assert.equal(store.data.jobs['owner:chat'].status, 'stopped');
  assert(sent.some(x => x[1].includes('正在处理测试')));
  assert(!sent.some(x => x[1].includes('上一项任务还在执行')));
  assert.equal(bot.queueCounts.get('owner:chat'),0);
  assert(sent.some(x => x[1].includes('请先 /stop')));
});
test('thread ID is reused, new clears context', async t => {
  const ids = [];
  const { bot, store } = fixture(t, async (_text, { threadId, onThread }) => {
    ids.push(threadId); onThread('thread-test'); return 'OK';
  });
  store.data.users = ['owner'];
  bot.accept(event('第一条')); await drain(bot);
  bot.accept(event('第二条')); await drain(bot);
  bot.accept(event('/new')); await drain(bot);
  bot.accept(event('第三条')); await drain(bot);
  assert.deepEqual(ids, [undefined, 'thread-test', undefined]);
});
test('durable dedupe survives restart; unfinished task is marked interrupted', t => {
  const { store, dir } = fixture(t);
  assert.equal(store.claim('stable-message'), true);
  store.data.jobs.test = { status: 'running' }; store.save();
  const loaded = new Store(dir);
  assert.equal(loaded.claim('stable-message'), false);
  assert.equal(loaded.data.jobs.test.status, 'interrupted');
});
test('Unicode replies are byte bounded and reconstruct losslessly', () => {
  const text = '中文🙂'.repeat(5000);
  const chunks = splitText(text);
  assert(chunks.every(x => Buffer.byteLength(x) <= 6000));
  assert.equal(chunks.join(''), text);
});
test('only final reply is sent; failed reaction does not block execution', async t => {
  const { bot, store, sent } = fixture(t);
  store.data.users = ['owner'];
  bot.addThinking = async () => { throw new Error('permission denied'); };
  bot.accept(event('task')); await drain(bot);
  assert.deepEqual(sent.map(x => x[1]), ['完成']);
  assert.equal(bot.active.size, 0);
  assert.equal(store.data.jobs['owner:chat'].status, 'completed');
});
for (const outcome of ['success', 'failure', 'stop']) {
  test('thinking reaction is removed on ' + outcome, async t => {
    const calls = [];
    const { bot, store } = fixture(t, async (_text, { signal }) => {
      if (outcome === 'failure') throw new Error('model failed');
      if (outcome === 'stop') await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return 'OK';
    });
    store.data.users = ['owner'];
    bot.addThinking = async id => { calls.push(['add', id]); return 'reaction'; };
    bot.removeThinking = async (...args) => calls.push(['remove', ...args]);
    const request = event('task'); bot.accept(request);
    if (outcome === 'stop') { await new Promise(r => setImmediate(r)); bot.accept(event('/stop')); }
    await drain(bot);
    assert.deepEqual(calls, [['add', request.message.message_id], ['remove', request.message.message_id, 'reaction']]);
  });
}
test('a slow reaction does not delay reply and is cleaned up when it arrives', async t => {
  let finish; const removed = [];
  const {bot, store, sent} = fixture(t); store.data.users = ['owner'];
  bot.addThinking = () => new Promise(resolve => { finish = resolve; });
  bot.removeThinking = async (...args) => removed.push(args);
  const request = event('task'); bot.accept(request);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(sent.map(x => x[1]), ['完成']);
  assert.equal(bot.active.size, 0);
  finish('late-reaction'); await drain(bot);
  assert.deepEqual(removed, [[request.message.message_id, 'late-reaction']]);
});
test('allowlist blocks even a valid pairing code from a non-owner', async t => {
  const { bot, store, sent } = fixture(t);
  bot.allowedUsers = ['another-owner'];
  bot.accept(event(`/pair ${store.data.pairing}`)); await drain(bot);
  assert.equal(sent.length, 0); assert.deepEqual(store.data.users, []);
});

test('media is downloaded only for owner and delivered with the bound chat and image', async t => {
  const calls = [];
  const { bot, store } = fixture(t, async (text, options) => { calls.push({text, chatId: options.chatId, images: options.images}); return 'OK'; });
  let downloads = 0;
  bot.prepareMedia = async () => { downloads++; return {text: 'image task', images: ['/tmp/test.png']}; };
  const photo = () => event('', {message_type: 'image', content: JSON.stringify({image_key: 'img'})});
  bot.accept(photo()); await drain(bot); assert.equal(downloads, 0);
  store.data.users = ['owner']; bot.accept(photo()); await drain(bot);
  assert.equal(downloads, 1); assert.deepEqual(calls, [{text:'image task',chatId:'chat',images:['/tmp/test.png']}]);
});
test('failed attachment download never reaches the agent and releases the task', async t => {
  let calls = 0;
  const {bot,store} = fixture(t, async () => {calls++;}); store.data.users=['owner'];
  bot.prepareMedia = async () => {throw new Error('permission denied');};
  bot.accept(event('',{message_type:'file',content:'{"file_key":"file"}'})); await drain(bot);
  assert.equal(calls,0); assert.equal(bot.active.size,0); assert.equal(store.data.jobs['owner:chat'].status,'failed');
});

test('enrolled group shares context across senders, never leaks private context', async t => {
  const calls=[];const {bot,store}=fixture(t,async(text,options)=>{calls.push({text,thread:options.threadId,sender:options.sender,history:options.history});options.onThread('group-thread');return 'OK';});
  store.data.users=['owner'];bot.botOpenId='our-bot';bot.resolveSender=async user=>user==='owner'?'Leo':'Alice';
  const group={chat_type:'group',chat_id:'team',mentions:[{key:'@bot',id:{open_id:'our-bot'}}]};
  const stranger=event('@bot 先发',group);stranger.sender.sender_id.open_id='other';bot.accept(stranger);await drain(bot);assert.equal(calls.length,0);
  bot.accept(event('@bot 你好',group));await drain(bot);
  const other=event('@bot 我是Alice',group);other.sender.sender_id.open_id='other';bot.accept(other);await drain(bot);
  assert.equal(calls[1].thread,'group-thread');assert.equal(calls[1].sender.id,'other');assert.equal(calls[1].sender.name,'Alice');assert.equal(calls[1].history[0].sender.id,'owner');
  const command=event('/new',group);command.sender.sender_id.open_id='other';bot.accept(command);await drain(bot);assert.equal(store.data.threads['group:team'],'group-thread');
  const privateMessage=event('private');privateMessage.sender.sender_id.open_id='other';bot.accept(privateMessage);await drain(bot);assert.equal(calls.length,2);
  bot.accept(event('owner private'));await drain(bot);assert.equal(calls[2].thread,undefined);assert.deepEqual(calls[2].history,[]);
});
test('emotion messages reach agent without losing sender identity', async t=>{
  let received;const {bot,store}=fixture(t,async(text,options)=>{received={text,sender:options.sender};return 'OK';});store.data.users=['owner'];
  bot.prepareMedia=async()=>({text:'用户发送了表情：SMILE',images:[]});bot.accept(event('',{message_type:'emotion',content:'{"emoji_type":"SMILE"}'}));await drain(bot);assert.equal(received.sender.id,'owner');assert.match(received.text,/SMILE/);
});

test('bot messages are distinguished, explicitly continued with mention, and cannot control session',async t=>{
 const calls=[];const {bot,store,sent}=fixture(t,async(text,o)=>{calls.push({text,sender:o.sender});return {text:'OK',mentionBot:true};});store.data.users=['owner'];store.data.groups=['team'];bot.botOpenId='ou_self';bot.botMessages=()=>({enabled:true,allowlist:['ou_other'],maxRounds:3,cooldownSeconds:5});
 const request=()=>{const e=event('@bot hello',{chat_type:'group',chat_id:'team',mentions:[{key:'@bot',id:{open_id:'ou_self'}}]});e.sender={sender_type:'bot',sender_id:{open_id:'ou_other'}};return e;};
 const first=request();bot.accept(first);bot.accept(first);await drain(bot);assert.equal(calls.length,1);assert.equal(calls[0].sender.type,'bot');assert.equal(calls[0].sender.owner,false);assert.match(sent[0][1],/^<at user_id="ou_other"><\/at>/);
 bot.accept(event('@bot /ping',{chat_type:'group',chat_id:'team',mentions:[{key:'@bot',id:{open_id:'ou_self'}}]}));await drain(bot);assert.equal(store.data.botRounds.team.count,0);
 const command=request();command.message.content=JSON.stringify({text:'@bot /new'});bot.accept(command);await drain(bot);assert.equal(calls.length,1);
});

test('trusted mention metadata supplies names and bot types without bypassing whitelist',async t=>{const {bot,store}=fixture(t);store.data.users=['owner'];bot.botOpenId='ou_self';const group={chat_type:'group',chat_id:'team',mentions:[{key:'@bot',id:{open_id:'ou_self'},mentioned_type:'bot',name:'Slo'},{key:'@other',id:{open_id:'ou_other'},mentioned_type:'bot',name:'July'}]};bot.accept(event('@bot hello',group));await drain(bot);assert.deepEqual(store.data.mentionDirectory.team.ou_other,{id:'ou_other',name:'July',type:'bot'});assert.equal(store.data.mentionDirectory.team.ou_self,undefined);});

test('same chat requests queue in order and next receives completed context',async t=>{
 let release;const calls=[];const {bot,store,sent}=fixture(t,async(text,o)=>{calls.push({text,history:o.history});if(text==='first')await new Promise(r=>release=r);return text+' done';});store.data.users=['owner'];
 bot.accept(event('first'));await new Promise(r=>setImmediate(r));bot.accept(event('second'));bot.accept(event('third'));await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal(bot.queueCounts.get('owner:chat'),2);release();await drain(bot);assert.deepEqual(calls.map(c=>c.text),['first','second','third']);assert.equal(calls[1].history[1].text,'first done');assert.equal(sent.length,3);
});
test('different chats can process independently',async t=>{
 let release;const calls=[];const {bot,store}=fixture(t,async text=>{calls.push(text);if(text==='slow')await new Promise(r=>release=r);return 'OK';});store.data.users=['owner'];bot.accept(event('slow'));await new Promise(r=>setImmediate(r));bot.accept(event('fast',{chat_id:'other'}));await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['slow','fast']);release();await drain(bot);
});
test('group unmentioned images cached only in enrolled group and hydrated only on explicit request',async t=>{
 const calls=[];const {bot,store}=fixture(t,async(text,o)=>{calls.push({text,images:o.images});return 'OK';});store.data.users=['owner'];store.data.groups=['team'];bot.botOpenId='our-bot';bot.prepareContext=async()=>({text:'referenced photo',images:['/tmp/photo.png']});
 bot.accept(event('',{chat_type:'group',chat_id:'team',message_type:'image',content:'{"image_key":"img"}'}));await drain(bot);assert.equal(calls.length,0);assert.equal(store.data.recentMedia.team.length,1);
 bot.accept(event('@bot 看图片',{chat_type:'group',chat_id:'team',mentions:[{key:'@bot',id:{open_id:'our-bot'}}]}));await drain(bot);assert.deepEqual(calls[0].images,['/tmp/photo.png']);assert.match(calls[0].text,/referenced photo/);
});
test('topic replies bind trigger and isolate histories, threads and control commands',async t=>{
 const calls=[];const {bot,store,sent}=fixture(t,async(text,o)=>{calls.push({text,history:o.history,thread:o.threadId,topic:o.topicId,reply:o.replyToMessageId});o.onThread('thread-'+o.topicId);return 'OK';});store.data.users=['owner'];bot.botOpenId='our-bot';
 const group={chat_type:'group',chat_id:'team',mentions:[{key:'@bot',id:{open_id:'our-bot'}}]};const first=event('@bot topic one',{...group,thread_id:'topic1',root_id:'root1'});bot.accept(first);await drain(bot);bot.accept(event('@bot topic two',{...group,thread_id:'topic2',root_id:'root2'}));await drain(bot);bot.accept(event('@bot main chat',group));await drain(bot);bot.accept(event('@bot continue topic',{...group,thread_id:'topic1',root_id:'root1'}));await drain(bot);
 assert.deepEqual(calls.slice(0,3).map(c=>c.history),[[],[],[]]);assert.equal(calls[3].thread,'thread-topic1');assert.equal(calls[3].history[0].text,'topic one');assert.equal(sent[0][3].replyToMessageId,first.message.message_id);assert.equal(sent[2][3].replyToMessageId,undefined);assert.deepEqual(store.data.topics.topic1,{chatId:'team',rootMessageId:'root1'});
 bot.accept(event('@bot /new',{...group,thread_id:'topic1',root_id:'root1'}));await drain(bot);assert.equal(store.data.history['group:topic1:team'],undefined);assert(store.data.history['group:topic2:team']);
});
test('bot may stay silent, reply without mention, or explicitly continue with mention',async t=>{
 for(const result of [{text:'',silent:true,suppressed:true},{text:'已收到新的结果。',mentionBot:false},{text:'请补充新的数据。',mentionBot:true}]){
  const {bot,store,sent}=fixture(t,async()=>result);bot.botOpenId='our-bot';bot.botMessages=()=>({enabled:true,allowlist:['other-bot'],maxRounds:3,cooldownSeconds:0});store.data.groups=['group-chat'];
  const e=event('@_user_1 新结果',{chat_type:'group',chat_id:'group-chat',mentions:[{key:'@_user_1',id:{open_id:'our-bot'}}]});e.sender={sender_type:'bot',sender_id:{open_id:'other-bot'}};bot.accept(e);await drain(bot);
  if(result.silent)assert.equal(sent.length,0);else{assert.equal(sent.length,1);assert.equal(sent[0][1].includes('<at user_id="other-bot">'),result.mentionBot);}
 }
});
test('bot execution failures do not send error replies that restart a loop',async t=>{const {bot,store,sent}=fixture(t,async()=>{throw Error('model offline');});bot.botOpenId='our-bot';bot.botMessages=()=>({enabled:true,allowlist:['other-bot'],maxRounds:3,cooldownSeconds:0});store.data.groups=['group-chat'];const e=event('@_user_1 new',{chat_type:'group',chat_id:'group-chat',mentions:[{key:'@_user_1',id:{open_id:'our-bot'}}]});e.sender={sender_type:'bot',sender_id:{open_id:'other-bot'}};bot.accept(e);await drain(bot);assert.equal(sent.length,0);});
