import crypto from 'node:crypto';
import {CronExpressionParser} from 'cron-parser';
export function scheduledAction({context,action,args={},load,save,state={},targets=[],now=new Date()}){
 const {scope,senderId,senderType,sourceId,owner}=context;
 if(!owner||!senderId||senderType==='bot'||context.scheduled)throw Error('通用定时任务仅向已配对所有者的当前真人请求开放');
 const config=load(),scoped=j=>!j.reminder&&j.app===scope.app&&j.chatId===scope.chat&&(j.topicId||'')===(scope.topic||'');
 const nextFor=j=>{if(!j.enabled||j.endAt&&new Date(j.endAt)<=now||j.runAt&&new Date(j.runAt)<=now)return null;if(j.runAt)return j.runAt;const current=new Date(Math.max(now.getTime(),j.startAt?Date.parse(j.startAt):now.getTime())-1);const next=CronExpressionParser.parse(j.cron,{tz:j.timezone||'Asia/Shanghai',currentDate:current}).next().toISOString();return j.endAt&&next>=new Date(j.endAt).toISOString()?null:next;};
 const describe=j=>({id:j.id,name:j.name,type:j.type,prompt:j.prompt,timezone:j.timezone,cron:j.cron,run_at:j.runAt,start_at:j.startAt,end_at:j.endAt,enabled:j.enabled,status:j.chatSchedule?.cancelled?'cancelled':!j.enabled?'paused':state[j.id]?.status||'pending',next_at:nextFor(j),mentions:j.mentions||[],last_error:state[j.id]?.error||null});
 if(action==='list')return {now:now.toISOString(),timezone:'Asia/Shanghai',tasks:config.schedules.filter(scoped).map(describe).slice(-100)};
 if(['pause','resume','cancel'].includes(action)){
  const job=config.schedules.find(j=>j.id===args.id&&scoped(j));if(!job)throw Error('任务不属于当前会话/话题');
  if(state[job.id]?.status==='running')throw Error('任务正在执行；本次运行不能通过此入口中断，请结束后再管理');
  if(job.chatSchedule?.cancelled)throw Error('任务已取消，不能恢复；需要重新创建');
  if(action==='resume'&&(job.runAt&&new Date(job.runAt)<=now||job.endAt&&new Date(job.endAt)<=now))throw Error('任务已过期，不能恢复');
  job.enabled=action==='resume';if(action==='cancel')job.chatSchedule={...job.chatSchedule,cancelled:true};save(config);return {updated:true,...describe(job)};
 }
 if(action!=='create')throw Error('未知定时任务操作');
 const name=String(args.name||'').trim(),prompt=String(args.prompt||'').trim();if(!name||name.length>80||!prompt||prompt.length>6000)throw Error('须提供名称（1至80字）和完整执行指令（1至6000字）');
 if(!['message','agent','weather','california-weather'].includes(args.type))throw Error('不支持的定时任务类型');
 if(args.type==='weather'&&args.timezone!=='Asia/Shanghai')throw Error('基础天气卡片使用Asia/Shanghai预报窗口；其他时区请使用agent或美国天气任务');
 const tz=args.timezone;if(typeof tz!=='string'||!tz)throw Error('请明确IANA时区');new Intl.DateTimeFormat('en',{timeZone:tz}).format(now);
 if(Boolean(args.run_at)===Boolean(args.cron))throw Error('一次性明确时间和周期cron二选一');
 const date=(value,key)=>{if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error(key+'须为含时区的ISO时间');return new Date(value);};
 const start=args.start_at?date(args.start_at,'开始时间'):now,end=args.end_at?date(args.end_at,'结束时间'):null;
 if(end&&(end<=now||end<=start))throw Error('结束时间须晚于开始时间及当前时间');
 let next;if(args.run_at){next=date(args.run_at,'执行时间');if(next<=now||next<start||end&&next>=end)throw Error('执行时间已过或不在有效期内');}
 else{if(typeof args.cron!=='string'||args.cron.trim().split(/\s+/).length!==5)throw Error('使用五字段cron，最小间隔5分钟');const it=CronExpressionParser.parse(args.cron,{tz,currentDate:new Date(Math.max(now.getTime(),start.getTime())-1)});next=it.next().toDate();let prev=next;for(let i=0;i<100;i++){const n=it.next().toDate();if(n-prev<300000)throw Error('最小执行间隔为5分钟');prev=n;}if(end&&next>=end)throw Error('有效期内没有执行时刻');}
 const ids=args.mentions||[];if(!Array.isArray(ids)||ids.length>10||ids.some(id=>!targets.some(t=>t.id===id&&t.type!=='bot')))throw Error('提及对象须是当前群已识别的真人；不能猜ID或定时触发机器人互聊');
 if(scope.type!=='group'&&ids.length)throw Error('私聊任务不接受其他收件人');
 const weather=args.weather;if(['weather','california-weather'].includes(args.type)){if(!weather||typeof weather.city!=='string'||!weather.city.trim()||!Number.isFinite(weather.latitude)||Math.abs(weather.latitude)>90||!Number.isFinite(weather.longitude)||Math.abs(weather.longitude)>180)throw Error('天气任务须明确城市和有效经纬度');if(weather.fireRadiusKm!==undefined&&(!Number.isFinite(weather.fireRadiusKm)||weather.fireRadiusKm<1||weather.fireRadiusKm>100))throw Error('山火查询半径须为1至100公里');}
 const spec={name,prompt,type:args.type,timezone:tz,cron:args.cron||'0 0 * * *',...(args.run_at?{runAt:next.toISOString()}:{}),...(args.start_at?{startAt:start.toISOString()}:{}),...(end?{endAt:end.toISOString()}:{}),mentions:[...new Set(ids)],...(['weather','california-weather'].includes(args.type)?{weather:{city:weather.city,latitude:weather.latitude,longitude:weather.longitude,windKmh:38.9,gustKmh:61.9,fireRadiusKm:weather.fireRadiusKm||50,airQuality:false,generateDailyImage:false,dailyGreeting:false}}:{})};
 const fingerprint=JSON.stringify(spec),duplicate=config.schedules.find(j=>scoped(j)&&j.enabled&&j.chatSchedule?.sourceId===sourceId&&j.chatSchedule?.fingerprint===fingerprint);if(duplicate)return {created:true,existing:true,...describe(duplicate)};
 if(config.schedules.filter(j=>scoped(j)&&j.enabled&&(!j.runAt||!state[j.id]?.onceClaimed&&new Date(j.runAt)>now)&&(!j.endAt||new Date(j.endAt)>now)).length>=20)throw Error('当前会话最多20个启用的通用任务');
 const j={id:'schedule-'+crypto.randomUUID(),...spec,enabled:true,app:scope.app,chatId:scope.chat,topicId:scope.topic||'',chatSchedule:{senderId,sourceId,createdAt:now.toISOString(),fingerprint}};config.schedules.push(j);save(config);return {created:true,...describe(j),next_at:next.toISOString(),offline_policy:'服务在线才运行，错过超过5分钟跳过；失败不自动重试。end_at为不包含的结束时刻。'};
}
