import {companionshipConfig} from './companionship-config.mjs';
import {companionshipEvent} from './companionship-events.mjs';
export async function importHistoricalClues({app,target,operations,store,config,now=new Date()}){
 if(!Array.isArray(operations)||!operations.length||operations.length>20||operations.some(o=>!Array.isArray(o.sourceIds)))throw Error('历史线索格式无效');
 const ids=[...new Set(operations.flatMap(o=>o.sourceIds))];if(!ids.length||ids.length>40||ids.some(id=>typeof id!=='string'||!id))throw Error('历史来源数量无效');
 const settings=companionshipConfig(config),events=[];
 for(const id of ids){
  const result=await app.api.request('/im/v1/messages/'+encodeURIComponent(id));const message=result.items?.find(m=>m.message_id===id);
  if(!message||message.deleted||message.chat_id!==target.chat||(message.thread_id||'')!==(target.topic||'')||message.sender?.sender_type!=='user')throw Error('历史来源必须是所选会话的有效真人消息');
  const at=Number(message.create_time);if(!Number.isFinite(at)||at>now.getTime()||at<now.getTime()-settings.retentionDays*86400000)throw Error('历史来源超出保留期限');
  const sender=message.sender.id;if(target.type==='p2p'&&!app.store.data.users.includes(sender))throw Error('私聊来源用户未配对');
  const event=companionshipEvent({...message,message_type:message.msg_type,content:message.body?.content},{sender_id:{open_id:sender}},now);if(!event)throw Error('历史来源没有可用的真人文字');
  try{event.name=await app.api.resolveSender(sender,target.chat,target.type)||'';}catch{}
  events.push(event);
 }
 return store.importClues(target,events,operations,now,settings.retentionDays);
}
