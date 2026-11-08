export const defaultBotMessages={enabled:false,allowlist:[],maxRounds:3,cooldownSeconds:10};
export function admitBot({state,message,sender,botOpenId,policy=defaultBotMessages,now=Date.now()}){
 const id=sender?.sender_id?.open_id;
 if(sender?.sender_type!=='bot'||!id||id===botOpenId||message.chat_type!=='group'||!message.mentions?.some(m=>m.id?.open_id===botOpenId))return false;
 state.observedBots??={};state.observedBots[id]={name:sender.name||null,lastSeen:new Date(now).toISOString(),chatId:message.chat_id};
 if(!policy.enabled||!policy.allowlist.includes(id)||!state.groups?.includes(message.chat_id))return false;
 return reserveBotRound(state,message.chat_id,policy,now);
}
export function reserveBotRound(state,chatId,policy,now=Date.now()){
 state.botRounds??={};const turn=state.botRounds[chatId]??={count:0,lastAt:0};
 if(turn.count>=policy.maxRounds||(turn.lastAt&&now-turn.lastAt<policy.cooldownSeconds*1000))return false;
 turn.count++;turn.lastAt=now;return true;
}
