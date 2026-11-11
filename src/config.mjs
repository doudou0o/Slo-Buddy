import {validateCompanionship} from './companionship-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CronExpressionParser} from 'cron-parser';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const configFile=path.join(root,'config/buddy.json');
export function validate(c){
 if(!c||!c.persona||!c.policies||!Array.isArray(c.apps)||!Array.isArray(c.schedules))throw Error('配置结构不完整');
 if(!Number.isInteger(c.historyLimit)||c.historyLimit<2||c.historyLimit>100)throw Error('上下文条数须为2至100');
 if(!Number.isInteger(c.port)||c.port<1024||c.port>65535)throw Error('端口须为1024至65535');
 if(c.inheritGlobalPersona!==undefined&&typeof c.inheritGlobalPersona!=='boolean')throw Error('基础人设继承开关须为布尔值');
 if(c.botMessages){const b=c.botMessages;if(typeof b.enabled!=='boolean'||!Array.isArray(b.allowlist)||b.allowlist.some(id=>typeof id!=='string'||!/^ou_[a-zA-Z0-9]+$/.test(id))||!Number.isInteger(b.maxRounds)||b.maxRounds<1||b.maxRounds>10||!Number.isInteger(b.cooldownSeconds)||b.cooldownSeconds<5||b.cooldownSeconds>3600)throw Error('智能体对话配置无效：白名单填open_id，轮数1至10，冷却5至3600秒');}
 if(c.memory&&(c.memory.engine!=='slo'||typeof c.memory.enabled!=='boolean'))throw Error('当前仅支持Slo Memory，Mem0尚未接入');
 if(c.browser?.channel!==undefined&&!['chromium','chrome'].includes(c.browser.channel))throw Error('浏览器类型须为chromium或chrome');
 if(c.browser?.allowedGroups!==undefined&&(!Array.isArray(c.browser.allowedGroups)||c.browser.allowedGroups.some(id=>typeof id!=='string'||!/^oc_[a-zA-Z0-9]+$/.test(id))))throw Error('浏览器群白名单须为chat_id数组');
 if(c.browser!==undefined&&(!c.browser||typeof c.browser.enabled!=='boolean'))throw Error('浏览器开关须为布尔值');
 const ids=new Set();for(const a of c.apps){if(!/^[a-zA-Z0-9_-]+$/.test(a.id)||ids.has(a.id))throw Error('应用ID须唯一且仅含字母数字下划线');ids.add(a.id);if(!a.credentials?.startsWith('.private/apps/')||a.credentials.includes('..'))throw Error('凭证文件必须位于.private/apps');}
 for(const kind of ['private','group']){const p=c.policies[kind];if(p&&p.localFileWrite!==undefined&&typeof p.localFileWrite!=='boolean')throw Error('本地写入开关须为布尔值');if(p&&p.localFileWrite&&!p.localFiles)throw Error('本地写入须同时开启本地文件访问');if(p&&p.allowCreateDocuments!==undefined&&typeof p.allowCreateDocuments!=='boolean')throw Error('创建独立文档开关须为布尔值');if(p&&p.imageGeneration!==undefined&&typeof p.imageGeneration!=='boolean')throw Error('画图开关须为布尔值');if(p)for(const key of ['localFiles','documentRead','documentWrite','allowAllDocuments'])if(typeof p[key]!=='boolean')throw Error('权限开关须为布尔值');if(!p||!Array.isArray(p.allowedDocuments)||!Array.isArray(p.allowedFolders))throw Error('资源白名单格式不正确');}
 if(c.policies.group.allowAllDocuments)throw Error('群聊飞书资源须使用白名单');
 const jobs=new Set();for(const j of c.schedules){if(!/^[a-zA-Z0-9_-]+$/.test(j.id)||jobs.has(j.id)||!ids.has(j.app)||j.id==='__companionship')throw Error('任务ID须唯一，应用须存在');jobs.add(j.id);for(const key of ['startAt','endAt'])if(j[key]!==undefined&&(typeof j[key]!=='string'||!Number.isFinite(Date.parse(j[key]))))throw Error('任务起止时间无效');if(j.startAt&&j.endAt&&new Date(j.startAt)>=new Date(j.endAt))throw Error('任务结束时间须晚于开始时间');if(j.runAt!==undefined&&(typeof j.runAt!=='string'||!Number.isFinite(Date.parse(j.runAt))))throw Error('一次性任务时间无效');if(j.weather?.airQuality!==undefined&&typeof j.weather.airQuality!=='boolean')throw Error('空气质量开关须为布尔值');if(j.weather?.generateDailyImage!==undefined&&typeof j.weather.generateDailyImage!=='boolean')throw Error('天气画图开关须为布尔值');if(['weather','proactive'].includes(j.type)&&(!j.weather||typeof j.weather.city!=='string'||!Number.isFinite(j.weather.latitude)||Math.abs(j.weather.latitude)>90||!Number.isFinite(j.weather.longitude)||Math.abs(j.weather.longitude)>180||!Number.isFinite(j.weather.windKmh)||j.weather.windKmh<=0||!Number.isFinite(j.weather.gustKmh)||j.weather.gustKmh<=0))throw Error('天气任务参数无效');if(j.type==='diary'&&(!j.diary||typeof j.diary.documentId!=='string'||!j.diary.documentId))throw Error('日记文档未配置');if(!['message','agent','weather','proactive','diary','california-weather'].includes(j.type)||!j.chatId||!j.prompt||j.prompt.length>20000)throw Error('任务内容不完整');if(j.mentions!==undefined&&(!Array.isArray(j.mentions)||j.mentions.length>10||j.mentions.some(id=>typeof id!=='string'||!/^ou_[a-zA-Z0-9]+$/.test(id))))throw Error('任务提及对象须为open_id数组');CronExpressionParser.parse(j.cron,{tz:j.timezone||'Asia/Shanghai'});}
 validateCompanionship(c.companionship,c.apps);
 return c;
}
export function loadConfig(){return validate(JSON.parse(fs.readFileSync(configFile,'utf8')));}
export function saveConfig(c){validate(c);fs.writeFileSync(configFile+'.tmp',JSON.stringify(c,null,2)+'\n');fs.renameSync(configFile+'.tmp',configFile);}
export function credentials(a){const text=fs.readFileSync(path.join(root,a.credentials),'utf8');const values={};for(const line of text.split('\n')){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)values[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}if(!values.FEISHU_APP_ID||!values.FEISHU_APP_SECRET)throw Error('应用 '+a.id+' 缺少凭证');return values;}
