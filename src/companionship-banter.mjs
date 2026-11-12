import {companionshipConfig,targetKey,contactTimeAllowed} from './companionship-config.mjs';
const str={type:'string'};
export const banterSchema={type:'object',properties:{action:{type:'string',enum:['skip','wait','send']},reason:str,text:str},required:['action','reason','text'],additionalProperties:false};
export class CompanionBanter {
 constructor({store,getConfig,authorized,generate,send,isBusy=()=>false,clock=()=>new Date(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout,log=()=>{}}){Object.assign(this,{store,getConfig,authorized,generate,send,isBusy,clock,schedule,cancel,log});this.batches=new Map();this.stopped=false;}
 config(){return companionshipConfig(this.getConfig());}
 enabled(t,c=this.config()){return !this.stopped&&c.enabled&&t.type==='group'&&c.banterTargets.some(x=>x.app===t.app&&x.chat===t.chat)&&this.authorized(t);}
 observe(t,event,{addressed=false}={}){if(!this.enabled(t))return;const now=this.clock();if(!Number.isFinite(Date.parse(event.at))||Math.abs(now-Date.parse(event.at))>120000)return;if(!this.store.banterRecord(t,event))return;const key=targetKey(t),old=this.batches.get(key);if(old?.timer)this.cancel(old.timer);const b={t,first:old?.first||+now,waited:false,addressed:addressed||old?.addressed};this.batches.set(key,b);this.arm(b,Math.min(30000,Math.max(0,b.first+60000-now)));}
 answered(t){const key=targetKey(t),b=this.batches.get(key);if(b?.timer)this.cancel(b.timer);this.batches.delete(key);this.store.touch(t);this.store.save();}
 arm(b,ms){b.timer=this.schedule(()=>{b.timer=null;this.evaluate(b).catch(e=>{this.store.decision(b.t,{action:'banter-error',reason:e.message},this.clock());this.log('companionship_failed',{error:e.message});}).finally(()=>{if(this.batches.get(targetKey(b.t))===b&&!b.timer)this.batches.delete(targetKey(b.t));});},ms);b.timer?.unref?.();}
 async evaluate(b){const t=b.t,c=this.config(),key=targetKey(t),now=this.clock();if(this.batches.get(key)!==b||!this.enabled(t,c)||b.addressed||this.isBusy(t)||!contactTimeAllowed(c,now)||!this.store.banterAllowed(t,now,c.banterCooldownMinutes,c.banterDailyLimit))return;
 const version=this.store.state(t).version,events=this.store.banterEvents(t).map(e=>({...e,text:e.text.slice(0,1200)}));const prompt=JSON.stringify({instruction:c.banterPrompt,now:now.toISOString(),persona:this.getConfig().persona,conversation:events,background:this.store.clues(t).filter(x=>x.kind==='background'&&x.status==='open'&&Date.parse(x.expires_at)>now).slice(0,8),recentContacts:this.store.recentContacts(t),alreadyWaited:b.waited});
 const raw=await this.generate(t,{phase:'banter',schema:banterSchema,prompt:JSON.stringify({task:'先只判断参与价值，text留空；send表示值得参与，下一步再写正文。',materials:prompt})}),d=typeof raw==='string'?JSON.parse(raw):raw;
 if(!this.enabled(t)||JSON.stringify(c)!==JSON.stringify(this.config())||this.batches.get(key)!==b||version!==this.store.state(t).version||this.isBusy(t))return;
 if(!d||!['skip','wait','send'].includes(d.action)||typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>1000)throw Error('随聊判断格式无效');
 if(d.action!=='send'){this.store.decision(t,{action:'banter-'+d.action,reason:d.reason},this.clock());if(d.action==='wait'&&!b.waited){b.waited=true;this.arm(b,30000);}return;}
 const composed=await this.generate(t,{phase:'banter-compose',schema:banterSchema,prompt:JSON.stringify({task:'已判断值得参与。根据材料写一句自然搭话，仍可skip取消。不要重复已有发言。',decision:d.reason,materials:prompt})});const result=typeof composed==='string'?JSON.parse(composed):composed;
 if(!this.enabled(t)||JSON.stringify(c)!==JSON.stringify(this.config())||this.batches.get(key)!==b||version!==this.store.state(t).version||this.isBusy(t))return;
 if(result?.action!=='send'){this.store.decision(t,{action:'banter-skip',reason:'拟稿后取消搭话'},this.clock());return;}d.text=result.text;
 if(typeof d.text!=='string'||!d.text.trim()||d.text.length>600||/@|<at\b/i.test(d.text))throw Error('随聊正文无效');
 const at=this.clock();if(!contactTimeAllowed(c,at)||!this.store.banterAllowed(t,at,c.banterCooldownMinutes,c.banterDailyLimit))return;
 if(c.dryRun){this.store.decision(t,{action:'banter-send',reason:d.reason,text:d.text,status:'preview'},at);return;}
 const reservation=this.store.reserveBanter(t,at,c.banterCooldownMinutes,c.banterDailyLimit);if(!reservation)return;
 const id=this.store.decision(t,{action:'banter-send',reason:d.reason,text:d.text,status:'sending'},at);
 try{const r=await this.send(t,d.text,reservation);if(!r?.message_id)throw Error('随聊缺少发送回执');this.store.finishContact(reservation,'sent',r.message_id);this.store.finishDecision(id,'sent',r.message_id);this.store.banterReply(t,r.message_id,at);}catch(e){this.store.finishContact(reservation,'unknown');this.store.finishDecision(id,'unknown');throw e;}
 }
 stop(){this.stopped=true;for(const b of this.batches.values())if(b.timer)this.cancel(b.timer);this.batches.clear();}
}
