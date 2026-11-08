import crypto from 'node:crypto';
export function reminderAction({context,action,args={},load,save,state={},now=new Date()}){
 const {scope,senderId,senderType,sourceId}=context;
 if(!senderId||senderType==='bot')throw Error('定时提醒仅向当前真人用户开放');
 const config=load();
 const scoped=j=>j.reminder&&j.app===scope.app&&j.chatId===scope.chat&&(j.topicId||'')===(scope.topic||'')&&j.reminder.senderId===senderId;
 const describe=j=>({id:j.id,text:j.prompt,run_at:j.runAt,timezone:j.timezone,status:!j.enabled?'cancelled':state[j.id]?.status||'pending',topic_id:j.topicId||''});
 if(action==='list')return {now:now.toISOString(),timezone:'Asia/Shanghai',reminders:config.schedules.filter(scoped).map(describe).slice(-100)};
 if(action==='cancel'){
  const j=config.schedules.find(j=>j.id===args.id&&scoped(j));if(!j)throw Error('提醒不存在或不属于你在当前会话/话题的提醒');
  if(state[j.id]?.onceClaimed||['running','completed','failed','skipped','interrupted'].includes(state[j.id]?.status))throw Error('提醒已开始处理或结束，不能取消');
  j.enabled=false;save(config);return {cancelled:true,...describe(j)};
 }
 if(action!=='create')throw Error('未知提醒操作');
 const text=String(args.text||'').trim();if(!text||text.length>1000)throw Error('提醒内容须为1至1000字');
 if((args.run_at!==undefined)===(args.delay_seconds!==undefined))throw Error('指定明确时间或延迟秒数，二选一');
 let at;
 if(args.delay_seconds!==undefined){if(!Number.isInteger(args.delay_seconds)||args.delay_seconds<10||args.delay_seconds>31536000)throw Error('延迟须为10秒至365天');at=new Date(now.getTime()+args.delay_seconds*1000);}
 else{if(typeof args.run_at!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(args.run_at))throw Error('时间须含时区，如2026-11-03T11:00:00+08:00');at=new Date(args.run_at);}
 if(!Number.isFinite(at.getTime())||at<=now)throw Error('提醒时间已过或无效，请确认新的未来时间，不能自动改到明天');
 if(at-now>31536000000)throw Error('首版提醒最多提前365天');
 const duplicate=config.schedules.find(j=>scoped(j)&&j.enabled&&j.reminder.sourceId===sourceId&&j.prompt===text&&(args.delay_seconds!==undefined?j.reminder.delaySeconds===args.delay_seconds:j.runAt===at.toISOString()));
 if(duplicate)return {created:true,existing:true,...describe(duplicate)};
 if(config.schedules.filter(j=>scoped(j)&&j.enabled&&!state[j.id]?.onceClaimed).length>=20)throw Error('当前会话最多保留20条待执行提醒');
 const j={id:'reminder-'+crypto.randomUUID(),name:'提醒：'+text.slice(0,40),enabled:true,type:'message',app:scope.app,chatId:scope.chat,topicId:scope.topic||'',cron:'0 0 * * *',timezone:'Asia/Shanghai',runAt:at.toISOString(),prompt:text,...(scope.type==='group'?{mentions:[senderId]}:{}),reminder:{senderId,sourceId,createdAt:now.toISOString(),...(args.delay_seconds!==undefined?{delaySeconds:args.delay_seconds}:{})}};
 config.schedules.push(j);save(config);return {created:true,...describe(j),offline_policy:'服务需在线；错过超过5分钟则跳过，不会自动补发或重新下单。'};
}
