import test from 'node:test';
import assert from 'node:assert/strict';
import {RequestPlan,planNotice} from '../src/request-plan.mjs';
import {startTask,recordOperation,finishTask,formatTask} from '../src/task-records.mjs';
import {executeTaskTool} from '../src/task-tool.mjs';
import {collectResponse} from '../src/agent.mjs';

const step=(id,executor='slo')=>({id,goal:id==='remind'?'让July设置喝水提醒':'画蓝色小猫',kind:'action',executor,...(executor==='other'?{target:'July'}:{})});
async function effect(plan,id,name,{fail=false,verified='not_checked'}={}){
 plan.guard(name,id);
 return executeTaskTool({name,id:name+'-'+id,args:{},api:{},run:async()=>{if(fail)throw Error('permission denied');return {sent:true,message_id:'receipt-'+id};},record:e=>plan.observe({...e,verification:verified},id)});
}
test('two delegated tasks stay distinct and do not claim the recipient completed them',async()=>{
 const p=new RequestPlan();await p.set({steps:[step('remind','other'),step('image','other')]});
 for(const id of ['remind','image']){await effect(p,id,'mention_group');await assert.rejects(p.update({id,status:'completed',reason:'done'}),/delegated/);await p.update({id,status:'delegated',reason:'已发送委托'});}
 assert.deepEqual(p.plan.steps.map(s=>s.status),['delegated','delegated']);assert.equal(planNotice(p.plan),'');
 await assert.rejects(p.set({steps:[step('replacement')]}),/不能覆盖/);
 assert.throws(()=>p.guard('mention_group','remind'),/待执行/);
});
test('a delegated reminder and self-generated image both execute with their own evidence',async()=>{
 const p=new RequestPlan();await p.set({steps:[step('remind','other'),step('image')]});
 assert.throws(()=>p.guard('generate_and_send_image','remind'),/委托他人/);
 await effect(p,'remind','mention_group');await p.update({id:'remind',status:'delegated',reason:'已发送给July'});
 await effect(p,'image','generate_and_send_image');await p.update({id:'image',status:'completed',reason:'图片发送接口成功'});
 assert.deepEqual(p.plan.steps.map(s=>s.status),['delegated','completed']);
});
test('failed independent item does not prevent the other item; no false all-complete result',async()=>{
 const record=startTask({data:{},save(){}},'scope',{id:'request',goal:'两个任务'});
 const p=new RequestPlan(e=>recordOperation(record,e));await p.set({steps:[step('remind','other'),step('image')]});
 await assert.rejects(effect(p,'remind','mention_group',{fail:true}),/permission/);
 await assert.rejects(p.update({id:'remind',status:'delegated',reason:'pretend success'}),/证据/);
 await p.update({id:'remind',status:'failed',reason:'无权限'});
 await effect(p,'image','generate_and_send_image');await p.update({id:'image',status:'completed',reason:'图片已发送'});
 finishTask(record);assert.equal(record.status,'needs_review');assert.match(formatTask(record),/无权限/);assert.match(planNotice(p.plan),/画蓝色小猫：已完成/);
 assert.equal(record.operations.find(o=>o.name==='generate_and_send_image').stepId,'image');
});
test('ambiguous assignment blocks all effects until a new clarified turn, even with an explicit step id',async()=>{
 const p=new RequestPlan();assert.throws(()=>p.guard('mention_group','x'),/set_task_plan/);
 await assert.rejects(p.set({steps:[step('image','unclear')]}),/澄清/);
 await p.set({steps:[step('remind','other'),step('image','unclear')],question:'两项都交给July，还是画图由Slo来？'});
 assert.throws(()=>p.guard('mention_group','remind'),/先向用户确认/);
 assert.throws(()=>p.guard('generate_and_send_image','image'),/先向用户确认/);
 assert.equal(p.operations.size,0);
 const next=new RequestPlan();await next.set({steps:[step('remind','other'),step('image')]});assert.doesNotThrow(()=>next.guard('generate_and_send_image','image'));
});
test('a successful write with uncertain readback is not marked complete or silently retried',async()=>{
 const p=new RequestPlan();await p.set({steps:[step('image')]});await effect(p,'image','write_local_file',{verified:'unverified'});
 await assert.rejects(p.update({id:'image',status:'completed',reason:'written'}),/待核查/);
 await p.update({id:'image',status:'blocked',reason:'写入已返回成功，但回读未确认，不重写'});
 assert.throws(()=>p.guard('write_local_file','image'),/待执行/);
});
test('parallel result updates persist both items instead of overwriting each other',async()=>{
 const record=startTask({data:{},save(){}},'scope',{id:'r',goal:'two'});
 const p=new RequestPlan(async e=>{await new Promise(r=>setImmediate(r));recordOperation(record,e)});
 await p.set({steps:[step('a'),step('b')]});await Promise.all([effect(p,'a','write_local_file'),effect(p,'b','write_local_file')]);
 await Promise.all(['a','b'].map(id=>p.update({id,status:'completed',reason:'工具成功'})));
 assert.deepEqual(record.plan.steps.map(s=>s.status),['completed','completed']);finishTask(record);assert.equal(record.status,'completed');
});
const tool=(name,value,isError=false)=>({type:'item.completed',item:{type:'mcp_tool_call',tool:name,result:{isError,content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]}}});
const message=text=>({type:'item.completed',item:{type:'agent_message',text}});
async function* stream(events){yield* events;yield {type:'turn.completed'};}
test('mention success cannot hide a later image failure or another item answer',async()=>{
 const result=await collectResponse(stream([message('先处理'),tool('mention_group',{sent:true}),tool('generate_and_send_image','image failed',true),message('提醒已转交July；画图失败，没有发送图片。')]));
 assert.equal(result,'提醒已转交July；画图失败，没有发送图片。');
});
test('a result card no longer hides subsequent independent work',async()=>{
 const result=await collectResponse(stream([tool('send_interactive_card',{sent:true,waiting_user:false}),message('第二项没有权限，未执行。')]));assert.equal(result,'第二项没有权限，未执行。');
});
test('unfinished plan produces a visible accounting even when the model stops after one send',async()=>{
 const p=new RequestPlan();await p.set({steps:[step('remind','other'),step('image')]});await effect(p,'remind','mention_group');await p.update({id:'remind',status:'delegated',reason:'委托已送达接口'});
 const result=await collectResponse(stream([tool('set_task_plan',p.result()),tool('mention_group',{sent:true})]));assert.match(result,/画蓝色小猫：未完成/);assert.match(result,/对方尚未确认执行/);
});
test('missing question-card delivery leaves the clarification visible and waiting_user',async()=>{
 const p=new RequestPlan();await p.set({steps:[step('image','unclear')],question:'谁来画图？'});
 const r=await collectResponse(stream([tool('set_task_plan',p.result()),tool('send_interactive_card','offline',true)]));assert.equal(r.waitingUser,true);assert.equal(r.silent,false);assert.match(r.text,/谁来画图/);
});
test('question after a prior tool error without a plan still has a valid waiting response',async()=>{
 const r=await collectResponse(stream([tool('read_document','permission denied',true),tool('send_interactive_card',{sent:true,waiting_user:true})]));assert.equal(r.waitingUser,true);assert.equal(typeof r.text,'string');assert(r.text.length>0);
});
