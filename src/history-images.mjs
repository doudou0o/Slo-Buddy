import {mentionTargets} from './mentions.mjs';
export const asksForImage=text=>/(图片|照片|[这那]张|[这那]图|看图|张图|上[面边].*图|图.*什么|image|photo)/i.test(text);
const normalize=s=>String(s||'').trim().toLowerCase();
export async function findHistoryImage({api,store,message,text,signal,sender,now=Date.now()}){
 const mentioned=(message.mentions||[]).filter(x=>x.mentioned_type==='user').map(x=>x.id?.open_id).filter(Boolean);
 let target=mentioned.length===1?mentioned[0]:null;
 // Resolve only actual known member names; never invent a name from sentence fragments.
 if(!target){
  let known=mentionTargets(store.data,message.chat_id).filter(x=>x.type==='user');
  try{const r=await api.request('/im/v1/chats/'+encodeURIComponent(message.chat_id)+'/members?member_id_type=open_id&page_size=100');known=[...(r.items||[]).map(x=>({id:x.member_id,name:x.name})),...known];store.data.mentionDirectory??={};const directory=store.data.mentionDirectory[message.chat_id]??={};for(const member of r.items||[])directory[member.member_id]={id:member.member_id,name:member.name.trim(),type:'user'};store.save?.();}catch{}
  const request=normalize(text);const matches=known.filter(x=>{const name=normalize(x.name),first=name.split(' ')[0];return name.length>=2&&(request.includes(name)||(first.length>=2&&request.includes(first)));});const ids=[...new Set(matches.map(x=>x.id))];
  if(ids.length>1)throw Error('提到了多位或同名成员，请明确@一位成员或引用具体图片');
  if(ids.length===1)target=ids[0];
  else if(sender&&['我发','我刚','我之前','我的上'].some(part=>text.includes(part)))target=sender;
 }
 const before=Number(message.create_time)||now;let page='',checked=0;
 for(let i=0;i<3;i++){
  signal?.throwIfAborted();
  const r=await api.request('/im/v1/messages?'+new URLSearchParams({container_id_type:message.thread_id?'thread':'chat',container_id:message.thread_id||message.chat_id,page_size:'50',sort_type:'ByCreateTimeDesc',user_id_type:'open_id',...(page?{page_token:page}:{})}));
  const candidates=(r.items||[]).filter(x=>x.chat_id===message.chat_id&&(message.thread_id?(x.thread_id===message.thread_id||x.message_id===message.root_id):!x.thread_id)&&x.message_id!==message.message_id&&!x.deleted&&Number(x.create_time)<=before).sort((a,b)=>Number(b.create_time)-Number(a.create_time));checked+=candidates.length;
  for(const m of candidates){if(target&&m.sender?.id!==target)continue;let body;try{body=JSON.parse(m.body?.content||'{}');}catch{continue;}const isImage=m.msg_type==='image'||m.msg_type==='post'&&JSON.stringify(body).includes('image_key');if(isImage)return {message:{...m,message_type:m.msg_type,content:m.body.content,chat_type:message.chat_type},sender:m.sender?.id,checked,target};}
  if(!r.has_more||!r.page_token)break;page=r.page_token;
 }
 return {message:null,checked,target};
}
