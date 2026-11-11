import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {CompanionshipStore} from '../src/companionship-store.mjs';
import {Companionship} from '../src/companionship.mjs';
import {companionshipDefaults,validateCompanionship,contactTimeAllowed} from '../src/companionship-config.mjs';
import {companionshipEvent} from '../src/companionship-events.mjs';
import {Bot,Store} from '../src/core.mjs';
const target={app:'main',chat:'group',type:'group',topic:''};
const base=new Date('2026-11-14T04:00:00Z'); // Saturday, noon in Shanghai.
function fixture(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slo-companion-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'companion.sqlite'),store=new CompanionshipStore(file);let now=new Date(base),calls=[],sent=[];
 const config={persona:{tone:'自然'},companionship:{...companionshipDefaults,enabled:true,collectEnabled:true,targets:[target],...overrides}};
 let responder=async(t,{phase})=>phase==='extract'?{operations:[]}:{action:'skip',reason:'没有适合的开场'};
 const runtime=new Companionship({store,getConfig:()=>config,authorized:t=>t.app==='main',clock:()=>now,generate:async(...args)=>{calls.push(args);return responder(...args);},send:async(...args)=>{sent.push(args);return {message_id:'sent-'+sent.length};}});
 const speak=(text='这周在美国出差',extra={})=>runtime.observe(target,{source:'m1',sender:'june',name:'June',text,at:now.toISOString(),...extra});
 return {dir,file,store,runtime,config,calls,sent,speak,setNow:x=>now=new Date(x),advance:ms=>now=new Date(+now+ms),respond:fn=>responder=fn,now:()=>now};
}
function operation(now,extra={}){return {op:'new',id:'',kind:'topic',subject:'june',content:'June这周去美国出差，抵达时间未知',sourceIds:['m1'],timeBasis:'原文为这周，不假定抵达时间',notBefore:now.toISOString(),expiresAt:new Date(+now+7*86400000).toISOString(),status:'open',...extra};}
function seed(f,extra={}){f.speak();const batch=f.store.events(target,{pending:true});f.store.apply(target,[operation(f.now(),extra)],batch,[],f.now(),30);return f.store.clues(target)[0];}
function sendDraft(c){return {action:'send',clueId:c.id,sourceIds:c.sources,reason:'出差进行中，有具体生活话头且近期未联系',text:'June，这趟出差有没有碰到什么有意思的事？',retryAt:''};}
test('defaults are opt-in and default harness cannot be replaced; parameters constrained',()=>{
 assert.equal(companionshipDefaults.enabled,false);assert.equal(companionshipDefaults.collectEnabled,false);assert.equal(companionshipDefaults.dryRun,true);
 for(const bad of [{harness:'plugin'},{cooldownHours:1},{quietMinutes:11,maxBatchMinutes:10},{startHour:22,endHour:9},{targets:[{...target,app:'unknown'}]}])assert.throws(()=>validateCompanionship(bad,[{id:'main'}]));
 assert.equal(contactTimeAllowed(companionshipDefaults,base),true);assert.equal(contactTimeAllowed({...companionshipDefaults,weekends:false},base),false);assert.equal(contactTimeAllowed(companionshipDefaults,new Date('2026-11-14T14:00:00Z')),false);
});
test('observe is opt-in, source-deduplicated, exact-scope isolated, and independent of memory',t=>{
 const f=fixture(t);f.config.memory={enabled:false};assert.equal(f.speak(),true);assert.equal(f.speak(),false);
 assert.equal(f.runtime.observe({...target,topic:'other'},{source:'x',sender:'june',text:'secret',at:base.toISOString()}),false);
 f.config.companionship.collectEnabled=false;assert.equal(f.speak('no',{source:'m2'}),false);assert.equal(f.store.events(target).length,1);
 assert.equal(f.runtime.context({...target,chat:'private'}),null);
});
test('two minute quiet debounce merges messages, ten minute continuous boundary flushes',async t=>{
 const f=fixture(t);f.speak();f.advance(60000);f.speak('还有点时差',{source:'m2'});await f.runtime.tick();assert.equal(f.calls.length,0);
 f.advance(119000);await f.runtime.tick();assert.equal(f.calls.length,0);f.advance(1000);await f.runtime.tick();assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0][1].prompt).batch.length,2);assert.equal(f.store.pendingRange(target).count,0);
 f.advance(60000);f.speak('a',{source:'m3'});f.advance(9*60000);f.speak('b',{source:'m4'});f.advance(60000);await f.runtime.tick();assert.equal(f.calls.length,2);
});
test('no new conversation causes no extraction; quiet hours do not stop extraction',async t=>{
 const f=fixture(t);await f.runtime.tick();assert.equal(f.calls.length,0);f.setNow('2026-11-14T15:00:00Z');f.speak();f.advance(120000);await f.runtime.tick();assert.equal(f.calls[0][1].phase,'extract');assert.equal(f.sent.length,0);
});
test('extraction persists sources and updates; stale/manual deletion and forged citations never write',async t=>{
 const f=fixture(t);f.speak();f.respond(async()=>({operations:[operation(f.now())]}));f.advance(120000);await f.runtime.tick();const c=f.store.clues(target)[0];assert.equal(c.subject,'june');assert.deepEqual(c.sources,['m1']);
 f.speak('取消了',{source:'m2'});const batch=f.store.events(target,{pending:true}),snapshot=f.store.clues(target);
 assert.throws(()=>f.store.apply(target,[operation(f.now(),{op:'update',id:c.id,sourceIds:['fake']})],batch,snapshot,f.now(),30),/来源/);
 assert.throws(()=>f.store.apply(target,[operation(f.now(),{op:'update',id:c.id,subject:'leo',sourceIds:['m2']})],batch,snapshot,f.now(),30),/人物/);
 f.store.change(target,c.id,'delete');assert.throws(()=>f.store.apply(target,[operation(f.now(),{op:'update',id:c.id,sourceIds:['m2']})],batch,snapshot,f.now(),30),/更改/);
 assert.equal(f.speak('old replay',{source:'m1'}),false);assert.equal(f.store.events(target).length,0);
});
test('trial selects one topic, records preview and never consumes real contact quota',async t=>{
 const f=fixture(t),c=seed(f);f.respond(async()=>sendDraft(c));f.advance(30*60000);await f.runtime.tick();assert.equal(f.calls.length,1);assert.equal(f.sent.length,0);assert.equal(f.store.recentContacts(target)[0].status,'preview');assert.equal(f.store.clues(target)[0].status,'open');assert.equal(f.store.contactAllowed(target,f.now()),true);
 f.advance(29*60000);await f.runtime.tick();assert.equal(f.calls.length,1);
});
test('real contact persists across restart, waits for response, shares quota across topics and old smalltalk',async t=>{
 const f=fixture(t,{dryRun:false}),c=seed(f);f.respond(async()=>sendDraft(c));f.advance(30*60000);await f.runtime.tick();assert.equal(f.sent.length,1);assert.equal(f.store.clues(target)[0].status,'waiting');assert.equal(f.store.recentContacts(target)[0].status,'sent');
 const restart=new CompanionshipStore(f.file);assert.equal(restart.contactAllowed({...target,topic:'another'},f.now()),false);assert.equal(restart.reserve(target,f.now(),24,'legacy'),null);
 f.advance(25*3600000);await f.runtime.tick();assert.equal(f.sent.length,1);assert.equal(f.calls.length,1);assert.equal(f.store.replyTarget('main',{chat_id:'group',chat_type:'group',parent_id:'sent-1'},'june').chat,'group');assert.equal(f.store.replyTarget('main',{chat_id:'group',chat_type:'group',parent_id:'sent-1'},'leo'),null);
});
test('subject reply can reopen an ongoing trip; other speakers cannot reopen waiting clue',t=>{
 const f=fixture(t),c=seed(f);f.store.contacted(target,c.id,f.now());f.speak('玩得如何',{source:'m2',sender:'leo'});const snapshot=f.store.clues(target),batch=f.store.events(target,{pending:true});assert.throws(()=>f.store.apply(target,[operation(f.now(),{op:'update',id:c.id,sourceIds:['m2']})],batch,snapshot,f.now(),30),/人物/);
 f.speak('昨天吃了好吃的',{source:'m3'});f.store.apply(target,[operation(f.now(),{op:'update',id:c.id,sourceIds:['m3'],content:'June出差期间尝试了当地食物'})],f.store.events(target,{pending:true}),snapshot,f.now(),30);assert.equal(f.store.clues(target)[0].status,'open');assert.ok(f.store.clues(target)[0].sources.includes('m3'));
});
test('new speech, deleted clue, disabled setting, or busy chat during generation cancels delivery',async t=>{
 for(const change of ['speech','delete','disable','busy']){const f=fixture(t,{dryRun:false}),c=seed(f);f.advance(30*60000);f.respond(async()=>{if(change==='speech')f.speak('新的话',{source:'m2'});if(change==='delete')f.store.change(target,c.id,'delete');if(change==='disable')f.config.companionship.enabled=false;if(change==='busy')f.runtime.isBusy=()=>true;return sendDraft(c);});await f.runtime.tick();assert.equal(f.sent.length,0,change);}
});
test('new message arriving during extraction leaves batch pending for a safe retry',async t=>{
 const f=fixture(t);f.speak();f.advance(120000);f.respond(async()=>{f.speak('补充',{source:'m2'});return {operations:[operation(f.now())]};});await f.runtime.tick();assert.equal(f.store.clues(target).length,0);assert.equal(f.store.pendingRange(target).count,2);
});
test('defer, skip, invalid references and future windows do not send',async t=>{
 const f=fixture(t,{dryRun:false}),c=seed(f);f.advance(30*60000);f.respond(async()=>({...sendDraft(c),action:'defer',retryAt:new Date(+f.now()+3600000).toISOString()}));await f.runtime.tick();assert.equal(f.sent.length,0);f.advance(30*60000);await f.runtime.tick();assert.equal(f.calls.length,1);
 f.advance(30*60000);f.respond(async()=>({...sendDraft(c),sourceIds:['private-message']}));await f.runtime.tick();assert.equal(f.sent.length,0);assert.equal(f.store.recentContacts(target)[0].action,'error');
});
test('background clues, cancelled topics, expired topics and recent chat never trigger selection',async t=>{
 for(const extra of [{kind:'background'},{status:'closed'},{notBefore:new Date(+base+3600000).toISOString()}]){const f=fixture(t);seed(f,extra);f.advance(30*60000);await f.runtime.tick();assert.equal(f.calls.length,0);}
 const f=fixture(t);seed(f);f.advance(7*86400000);await f.runtime.tick();assert.equal(f.calls.length,0);assert.equal(f.store.clues(target).length,0);
});
test('uncertain delivery is not retried and remains blocked across restart',async t=>{
 const f=fixture(t,{dryRun:false}),c=seed(f);f.runtime.send=async()=>{throw Error('timeout after sending');};f.respond(async()=>sendDraft(c));f.advance(30*60000);await f.runtime.tick();assert.equal(f.store.recentContacts(target).find(d=>d.action==='send').status,'unknown');assert.equal(new CompanionshipStore(f.file).contactAllowed(target,f.now()),false);f.advance(25*3600000);await f.runtime.tick();assert.equal(f.calls.length,1);
});
test('concurrent ticks cannot select/send twice; model error backs off',async t=>{
 const f=fixture(t,{dryRun:false}),c=seed(f);f.advance(30*60000);f.respond(async()=>{await new Promise(r=>setTimeout(r,5));return sendDraft(c);});await Promise.all([f.runtime.tick(),f.runtime.tick()]);assert.equal(f.sent.length,1);
 const g=fixture(t);g.speak();g.advance(120000);g.respond(async()=>{throw Error('model unavailable');});await g.runtime.tick();await g.runtime.tick();assert.equal(g.calls.length,1);assert.equal(g.store.pendingRange(target).count,1);
});
test('text/post parsing ignores images and commands; observer sees enrolled unmentioned groups but never bots or strangers',async t=>{
 const f=fixture(t);const botStore=new Store(path.join(f.dir,'bot'));botStore.data.users=['owner'];botStore.data.groups=['group'];const observed=[],sent=[];
 const bot=new Bot({store:botStore,botOpenId:'slo',onObserved:e=>observed.push(e),send:async(...a)=>sent.push(a),agent:{run:async()=> 'ok'}});
 const e={sender:{sender_type:'user',sender_id:{open_id:'june'}},message:{message_id:'group-m',chat_id:'group',chat_type:'group',message_type:'text',content:JSON.stringify({text:'这周去美国出差'})}};
 bot.accept(e);bot.accept({...e,sender:{...e.sender,sender_type:'bot'}});bot.accept({...e,message:{...e.message,chat_id:'other'}});bot.accept({...e,message:{...e.message,chat_type:'p2p'}});assert.equal(observed.length,1);assert.equal(sent.length,0);assert.match(companionshipEvent(e.message,e.sender).text,/美国/);assert.equal(companionshipEvent({...e.message,content:'{"text":"/pair secret"}'},e.sender),null);
 const post=companionshipEvent({...e.message,message_type:'post',content:JSON.stringify({zh_cn:{title:'出差',content:[[{tag:'text',text:'去美国'},{tag:'img',image_key:'secret'}]]}})},e.sender);assert.equal(post.text,'出差\n去美国');
});
test('explicit reply to a proactive contact can enter group conversation without mention; arbitrary unmentioned speech cannot',async t=>{
 const f=fixture(t),state=new Store(path.join(f.dir,'reply-bot'));state.data.users=['owner'];state.data.groups=['group'];let calls=0;const bot=new Bot({store:state,botOpenId:'slo',shouldReply:({message,sender})=>message.parent_id==='contact'&&sender.sender_id.open_id==='june',agent:{run:async()=>{calls++;return '听起来挺有意思';}},send:async()=>({message_id:'reply'}),onConversation:()=>{}});
 const event={sender:{sender_type:'user',sender_id:{open_id:'june'}},message:{message_id:'reply1',chat_id:'group',chat_type:'group',message_type:'text',parent_id:'contact',content:'{"text":"吃到很好吃的东西"}'}};bot.accept(event);await Promise.all([...bot.pending]);assert.equal(calls,1);bot.accept({...event,message:{...event.message,message_id:'reply2',parent_id:'other'}});await Promise.all([...bot.pending]);assert.equal(calls,1);
});
