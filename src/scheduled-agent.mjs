import crypto from 'node:crypto';
export const scheduledResultSchema={type:'object',properties:{send:{type:'boolean'},text:{type:'string'}},required:['send','text'],additionalProperties:false};
export async function runScheduledAgent(job,{app,memory,memoryRequests,config,serial,signal=AbortSignal.timeout(600000)}){
 const chatType=app.store.data.groups?.includes(job.chatId)?'group':'p2p';
 if(job.chatSchedule&&!app.store.data.users.includes(job.chatSchedule.senderId))throw Error('任务创建者已不在当前应用所有者中，停止执行');
 const scope={app:job.app,chat:job.chatId,type:chatType==='group'?'group':'private',topic:job.topicId||'',user:chatType==='group'?'':job.chatSchedule?.senderId||app.store.data.users[0]};
 const id=crypto.randomUUID();memoryRequests.set(id,{scope,owner:false,scheduled:true,sourceId:job.id,senderId:job.chatSchedule?.senderId||'scheduler',senderType:'bot'});
 try{return await serial(job.app+':'+job.chatId+(job.topicId?':'+job.topicId:''),async()=>{
  const raw=await app.agent.run(job.prompt,{chatId:job.chatId,chatType,topicId:job.topicId||'',memoryContext:id,scheduledTask:true,scopeTag:'scheduled-'+job.id,longMemory:config.memory?.enabled?memory.retrieve(scope,job.prompt):null,sender:{id:'scheduler',name:'定时任务',type:'bot',owner:false},responseSchema:scheduledResultSchema,signal});
  const result=JSON.parse(raw);if(typeof result.send!=='boolean'||typeof result.text!=='string'||result.text.length>6000||result.send&&!result.text.trim())throw Error('定时任务未返回有效结果');return result;
 });}finally{memoryRequests.delete(id);}
}

export function scheduledApi(app,job){if(!job.topicId)return app.api;const topic=app.store.data.topics?.[job.topicId];if(!topic||topic.chatId!==job.chatId)throw Error('任务话题不属于目标群或已不可用');return {request:(route,options)=>{if(route==='/im/v1/messages?receive_id_type=chat_id'&&options?.method==='POST'){const {receive_id,...body}=options.body;if(receive_id!==job.chatId)throw Error('定时任务不能跨群发送');return app.api.request('/im/v1/messages/'+encodeURIComponent(topic.rootMessageId)+'/reply',{...options,body:{...body,reply_in_thread:true}});}return app.api.request(route,options);}};}
