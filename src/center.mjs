import {importHistoricalClues} from './companionship-import.mjs';
import {companionshipConfig,companionshipDefaults} from './companionship-config.mjs';
import {scheduledAction} from './chat-schedules.mjs';
import {reminderAction} from './reminders.mjs';
import {readLogs} from './log-view.mjs';
import {memoryAction} from './memory-tools.mjs';
import {memoryScope} from './local-memory.mjs';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {root,loadConfig as readConfig,saveConfig as writeConfig,credentials} from './config.mjs';
import {basePersonaStatus} from './persona.mjs';
import {loadMemory,saveMemory} from './memory.mjs';
import {mentionTargets} from './mentions.mjs';
export function startCenter({browserAction,apps,scheduler,manageApp,brokerToken,sendMention,memory,memoryRequests=new Map(),companionship,sendCard,loadConfig=readConfig,saveConfig=writeConfig,port=loadConfig().port}){
 const token=crypto.randomBytes(24).toString('hex');
 const server=http.createServer(async(req,res)=>{
  const host='127.0.0.1:'+server.address().port;if(req.headers.host!==host){res.writeHead(403);res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
  try{
   if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'src/center.html'),'utf8').replace('__TOKEN__',token));return;}

   if(req.method==='GET'&&req.url==='/api/memory'){json(loadMemory());return;}
   if(req.method==='GET'&&req.url.startsWith('/api/logs')){const url=new URL(req.url,'http://'+host);const secrets=[];for(const app of loadConfig().apps)try{const c=credentials(app);secrets.push(c.FEISHU_APP_SECRET);}catch{}json(readLogs(root,{app:url.searchParams.get('app')||'',errorsOnly:url.searchParams.get('errors')==='1',secrets}));return;}
   if(req.method==='GET'&&req.url==='/api/state'){json({config:loadConfig(),companionship:{config:companionshipConfig(loadConfig()),defaults:companionshipDefaults},basePersona:basePersonaStatus(loadConfig().inheritGlobalPersona === true),runs:scheduler.state,apps:[...apps].map(([id,a])=>({id,name:a.name,connection:a.ws.getConnectionStatus().state,memoryTargets:Object.entries(a.store.data.chats||{}).map(([id,c])=>({id,type:c.type})),memoryTopics:Object.entries(a.store.data.topics||{}).map(([id,t])=>({id,chat:t.chatId})),observedBots:a.store.data.observedBots||{},mentionTargets:Object.fromEntries((a.store.data.groups||[]).map(chat=>[chat,mentionTargets(a.store.data,chat)])),pairCommand:a.store.data.users.length?null:'/pair '+a.store.data.pairing,paired:a.store.data.users.length>0,chats:[...new Set([...Object.keys(a.store.data.chats||{}),...(a.store.data.groups||[]),...Object.keys(a.store.data.history||{}).map(k=>k.split(':').at(-1))])]}))});return;}
   if(req.method==='POST'){
    if(req.url==='/internal/schedules'){if(!brokerToken||req.headers['x-buddy-capability']!==brokerToken)throw Error('工具来源验证失败');let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)throw Error('请求过大');}const v=JSON.parse(body),context=memoryRequests.get(v.context);if(!context)throw Error('定时任务请求已失效或未授权');const app=apps.get(context.scope.app);if(!app)throw Error('应用未连接');json(scheduledAction({context,action:v.action,args:v.args,load:loadConfig,save:saveConfig,state:scheduler.state,targets:mentionTargets(app.store.data,context.scope.chat)}));return;}
    if(req.url==='/internal/reminders'){if(!brokerToken||req.headers['x-buddy-capability']!==brokerToken)throw Error('工具来源验证失败');let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw Error('请求过大');}const v=JSON.parse(body),context=memoryRequests.get(v.context);if(!context)throw Error('提醒请求已失效或未授权');json(reminderAction({context,action:v.action,args:v.args,load:loadConfig,save:saveConfig,state:scheduler.state}));return;}
    if(req.url==='/internal/browser'){if(!brokerToken||req.headers['x-buddy-capability']!==brokerToken)throw Error('工具来源验证失败');let body='';for await(const chunk of req){body+=chunk;if(body.length>30000)throw Error('请求过大');}const v=JSON.parse(body),context=memoryRequests.get(v.context);if(!context)throw Error('浏览器请求已失效');json(await browserAction(context,v.args));return;}
    if(req.url==='/internal/response'){if(!brokerToken||req.headers['x-buddy-capability']!==brokerToken)throw Error('工具来源验证失败');let body='';for await(const chunk of req){body+=chunk;if(body.length>30000)throw Error('请求过大');}const v=JSON.parse(body),context=memoryRequests.get(v.context);if(!context)throw Error('请求已失效或未授权');if(v.action==='card')json(await sendCard(context,v.args));else if(v.action==='progress'){if(typeof v.args?.text!=='string'||v.args.text.length>300||!v.args.text.trim())throw Error('进度文本无效');json(await context.reportProgress(v.args.text));}else throw Error('未知响应操作');return;}
    if(req.url==='/internal/memory'){if(req.headers['x-buddy-capability']!==brokerToken||!brokerToken)throw Error('工具来源验证失败');let body='';for await(const chunk of req){body+=chunk;if(body.length>50000)throw Error('请求过大');}const v=JSON.parse(body),context=memoryRequests.get(v.context);if(!context)throw Error('记忆请求已失效或未授权');if(!loadConfig().memory?.enabled)throw Error('本地记忆已关闭');if(context.scheduled&&v.action!=='search')throw Error('定时执行只允许检索记忆');json(memoryAction(memory,context,v.action,v.args||{}));return;}
    if(req.url==='/internal/memory-search'){if(!brokerToken||req.headers['x-buddy-capability']!==brokerToken)throw Error('工具来源验证失败');let input='';for await(const chunk of req){input+=chunk;if(input.length>20000)throw Error('请求过大');}const v=JSON.parse(input);if(!loadConfig().memory?.enabled)throw Error('本地记忆已关闭');const a=apps.get(v.app);if(!a||!a.store.data.chats?.[v.chatId]||(v.chatType==='group')!==(a.store.data.chats[v.chatId].type==='group'))throw Error('会话未授权');if(v.chatType!=='group'&&!a.store.data.users.includes(v.user))throw Error('用户未授权');if(v.topicId&&a.store.data.topics?.[v.topicId]?.chatId!==v.chatId)throw Error('话题未授权');json(memory.retrieve(memoryScope(v.app,{chat_id:v.chatId,chat_type:v.chatType,thread_id:v.topicId},v.user),String(v.query||'').slice(0,2000)));return;}
    if(req.url==='/internal/mention'){if(!brokerToken||req.headers['x-buddy-capability']!==brokerToken)throw Error('工具来源验证失败');let input='';for await(const chunk of req){input+=chunk;if(input.length>20000)throw Error('请求过大');}const v=JSON.parse(input);json(await sendMention(v.app,v.chatId,v.ids,v.text,v.topicId));return;}
    if(req.headers.origin!=='http://'+host||req.headers['x-buddy-token']!==token)throw Error('来源验证失败');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>200000)throw Error('配置过大');}const value=JSON.parse(body);
    if(req.url==='/api/companionship-config'){const config=loadConfig();config.companionship=value;saveConfig(config);json({ok:true,message:'主动相处设置已保存，下一次检查生效。'});return;}
    if(req.url==='/api/companionship-query'||req.url==='/api/companionship-clue'||req.url==='/api/companionship-import'){
     if(!companionship)throw Error('主动相处尚未加载');const t=value.target,a=apps.get(t?.app),data=a?.store.data;
     if(!t||!['p2p','group'].includes(t.type)||!(t.type==='group'?data?.groups?.includes(t.chat):data?.chats?.[t.chat]?.type==='p2p')||(t.topic&&data?.topics?.[t.topic]?.chatId!==t.chat))throw Error('请选择已授权会话');
     if(req.url==='/api/companionship-import'){json({ok:true,...await importHistoricalClues({app:a,target:t,operations:value.operations,store:companionship.store,config:loadConfig()})});return;}
     if(req.url==='/api/companionship-clue'){companionship.store.change(t,value.id,value.action);json({ok:true,message:value.action==='delete'?'线索已删除，关联候选已失效。':'已停止跟进。'});}else json(companionship.store.view(t));return;
    }
    if(req.url==='/api/memory-query'){const a=apps.get(value.app),chat=a?.store.data.chats?.[value.chat];if(!chat)throw Error('请先选择已授权会话');if(value.topic&&a.store.data.topics?.[value.topic]?.chatId!==value.chat)throw Error('话题不属于所选群');const scope=memoryScope(value.app,{chat_id:value.chat,chat_type:chat.type,thread_id:value.topic||''},a.store.data.users[0]);json(memory.retrieve(scope,String(value.query||'').slice(0,2000)));return;}
    if(req.url==='/api/local-memory'){json({ok:true,entry:memory.update(value.id,value),message:'记忆已更新，下一次请求生效'});return;}
    if(req.url==='/api/memory'){const memory=saveMemory(value);json({ok:true,updatedAt:memory.updatedAt,message:'知识已保存，下一次任务读取最新内容。'});return;}
    if(req.url==='/api/app'){if(!['connect','disconnect'].includes(value.action))throw Error('未知操作');await manageApp(value.id,value.action);json({ok:true,message:value.action==='connect'?'连接已启动，请查看状态及配对提示':'已断开'});return;}
    if(req.url==='/api/config'){saveConfig(value);json({ok:true,message:'已保存。人设、权限、任务即时生效；应用连接和端口调整需重启服务。'});return;}
    if(req.url==='/api/run'){const job=loadConfig().schedules.find(j=>j.id===value.id);if(!job)throw Error('任务不存在');if(scheduler.active.has(job.id))throw Error('任务已在执行');void scheduler.run(job,true);json({ok:true,message:'任务已提交，可查看执行记录'});return;}
   }
   json({error:'不存在'},404);
  }catch(e){json({error:e.message},400);}
 });server.listen(port,'127.0.0.1');return server;
}
