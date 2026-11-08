import {defaultBotMessages,reserveBotRound} from './bot-access.mjs';
export function mentionTargets(state,chatId){const targets=new Map();for(const entries of Object.entries(state.history||{}).filter(([key])=>key.endsWith(':'+chatId)).map(([,v])=>v))for(const h of entries){const s=h.sender;if(s?.id&&s.id!=='assistant')targets.set(s.id,{id:s.id,name:s.name||s.id,type:s.type||'user'});}for(const [id,b]of Object.entries(state.observedBots||{}))if(b.chatId===chatId)targets.set(id,{id,name:b.name||id,type:'bot'});for(const [id,m]of Object.entries(state.mentionDirectory?.[chatId]||{}))targets.set(id,m);return [...targets.values()];}
export function prepareMention({state,chatId,ids,text,botOpenId,policy=defaultBotMessages,now=Date.now()}){
 if(!state.groups?.includes(chatId))throw Error('主动提及仅限已启用的群');if(!Array.isArray(ids)||ids.length<1||ids.length>10||ids.some(id=>typeof id!=='string'||!/^ou_[a-zA-Z0-9]+$/.test(id))||typeof text!=='string'||!text.trim()||text.length>4000)throw Error('提及对象或内容无效');
 const unique=[...new Set(ids)];const known=mentionTargets(state,chatId);for(const id of unique){if(id===botOpenId)throw Error('不能主动提及自己');const t=known.find(x=>x.id===id);if(!t)throw Error('对象尚未在此群被识别');if(t.type==='bot'&&(!policy.enabled||!policy.allowlist.includes(id)))throw Error('对方机器人未在已启用的白名单中');}
 if(unique.some(id=>known.find(t=>t.id===id).type==='bot')&&!reserveBotRound(state,chatId,policy,now))throw Error('机器人对话额度已用完或尚在冷却，请稍后或由真人@开始新一轮');
 const safeText=text.replace(/<\/?at\b[^>]*>/gi,'');return unique.map(id=>'<at user_id="'+id+'"></at>').join(' ')+' '+safeText;
}
