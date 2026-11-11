export function companionshipTarget(app,message){return {app,chat:message.chat_id,type:message.chat_type,topic:message.thread_id||''};}
// Only direct message text is collected. Quoted messages, image descriptions and tool output are not source speech.
export function companionshipEvent(message,sender,now=new Date()){
 let content;try{content=JSON.parse(message.content);}catch{return null;}
 let text='';if(message.message_type==='text')text=content.text||'';
 else if(message.message_type==='post'){const post=content.zh_cn||content.en_us||content;const parts=[post.title||''];for(const row of post.content||[])for(const item of row)if(item.tag==='text'||item.tag==='a')parts.push(item.text||'');text=parts.join('\n');}
 if(typeof text!=='string')return null;for(const m of message.mentions||[])if(m.key)text=text.split(m.key).join(m.name||'');text=text.trim();if(!text||text.startsWith('/'))return null;
 const created=Number(message.create_time);return {source:message.message_id,sender:sender.sender_id.open_id,name:sender.name||'',text,at:Number.isFinite(created)&&created>0?new Date(created).toISOString():now.toISOString()};
}
