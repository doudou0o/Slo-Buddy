// Task evidence is scoped to the existing app/chat/topic store. Never persist tool bodies.
import {validatePlan} from './request-plan.mjs';
export const taskLabels={running:'执行中',delivering:'交付中',completed:'执行结束',needs_review:'需核查交付',waiting_user:'等待用户',failed:'失败',stopped:'已停止',interrupted:'已中断'};
export function startTask(store,key,{id,goal}){
 const records=store.data.taskRecords??={};const record={id,goal:String(goal).slice(0,240),status:'running',startedAt:new Date().toISOString(),progress:'准备执行',operations:[],deliveries:[]};
 records[key]=[...(records[key]||[]).slice(-19),record];store.save();return record;
}
export function recordOperation(record,event){
 if(event?.kind==='request_plan'){
  const plan=validatePlan(event.plan);
  plan.steps=plan.steps.map((s,i)=>{const raw=event.plan.steps[i];if(!['pending','completed','delegated','failed','blocked','waiting_user'].includes(raw.status)||!Array.isArray(raw.operationIds)||raw.operationIds.length>10||raw.operationIds.some(id=>typeof id!=='string'||id.length>80))throw Error('任务计划状态无效');return {...s,status:raw.status,operationIds:[...raw.operationIds],...(typeof raw.reason==='string'?{reason:raw.reason.slice(0,240)}:{})};});
  record.plan=plan;record.progress=plan.steps.some(s=>s.status==='waiting_user')?'等待澄清执行归属':'逐项核对交付';return;
 }
 if(!event||typeof event.name!=='string'||!['started','succeeded','failed'].includes(event.status)||typeof event.id!=='string')throw Error('任务事件无效');
 let op=record.operations.find(x=>x.id===event.id);if(!op){op={id:event.id.slice(0,80),name:event.name.slice(0,80)};record.operations.push(op);} // Keep IDs and outcomes, never arguments, result text or credentials.
 op.status=event.status;op.at=new Date().toISOString();
 if(typeof event.stepId==='string')op.stepId=event.stepId.slice(0,40);
 if(event.status==='succeeded'){
  op.refs={};for(const k of ['document_id','message_id','block_id'])if(typeof event.refs?.[k]==='string')op.refs[k]=event.refs[k].slice(0,200);
  op.verification=['verified','unverified','not_checked'].includes(event.verification)?event.verification:'not_checked';
 }
 record.progress=event.name+': '+event.status;
}
export function finishTask(record,{waitingUser=false,suppressed=false}={}){
 record.status=waitingUser||record.plan?.steps.some(s=>s.status==='waiting_user')?'waiting_user':record.operations.some(o=>o.status!=='succeeded'||o.verification==='unverified')||record.plan?.steps.some(s=>!['completed','delegated'].includes(s.status))?'needs_review':'completed';
 record.finishedAt=new Date().toISOString();record.suppressed=!!suppressed;
}
export function formatTask(record){
 const refs=record.operations.flatMap(o=>Object.entries(o.refs||{}).map(([k,v])=>k+': '+v));
 const labels={pending:'未完成',completed:'已执行',delegated:'已转交，非对方完成',failed:'失败',blocked:'受阻',waiting_user:'等待确认'};
 const steps=record.plan?.steps.map(s=>`- ${s.id} ${s.goal}（${s.executor==='other'?s.target:s.executor==='slo'?'Slo':'待确认执行人'}）：${labels[s.status]}${s.reason?'；'+s.reason:''}`).join('\n');
 return `${record.id}\n目标：${record.goal}\n状态：${taskLabels[record.status]||record.status}\n阶段：${record.progress}\n工具：${record.operations.filter(o=>o.verification==='verified').length}项已回读验证；${record.operations.filter(o=>o.status!=='succeeded'||o.verification==='unverified').length}项需核查\n回复交付：${record.deliveries.filter(d=>d.verified).length}条已回读，${record.deliveries.filter(d=>!d.verified).length}条仅接口确认${steps?'\n交付项：\n'+steps:''}${record.plan?.question?'\n待澄清：'+record.plan.question:''}${refs.length?'\n'+refs.join('\n'):''}`;
}
