// Group uploads are sourced from Feishu messages, never arbitrary local paths.
export function messageImageKeys(message) {
 const body=JSON.parse(message.body?.content||'{}');
 if(message.msg_type==='image')return body.image_key?[body.image_key]:[];
 if(message.msg_type!=='post')return [];
 const post=body.content?body:body.zh_cn||body.en_us;
 return [...new Set((post?.content||[]).flat().filter(x=>x.tag==='img').map(x=>x.image_key).filter(Boolean))];
}
export async function insertMessageImage({api,document,messageId,imageKey,chatId,topicId=''}) {
 const data=await api.request('/im/v1/messages/'+encodeURIComponent(messageId));
 const message=data.items?.find(x=>x.message_id===messageId);
 if(!message||message.chat_id!==chatId)throw Error('只能插入当前会话中的图片');
 if((message.thread_id||'')!==topicId)throw Error('只能插入当前话题中的图片');
 const keys=messageImageKeys(message);
 const key=imageKey||(keys.length===1?keys[0]:'');
 if(!key||!keys.includes(key))throw Error('请选择该消息中确实存在的图片 image_key');
 const downloaded=await api.downloadMessage({message_id:messageId,chat_id:chatId,message_type:'image',content:JSON.stringify({image_key:key})});
 return api.insertImage(document,downloaded.images[0]);
}
export async function listConversationImages({api,chatId,topicId='',pageToken=''}) {
 const query=new URLSearchParams({container_id_type:topicId?'thread':'chat',container_id:topicId||chatId,sort_type:'ByCreateTimeDesc',page_size:'50',...(pageToken?{page_token:pageToken}:{})});
 const data=await api.request('/im/v1/messages?'+query);
 return {images:(data.items||[]).filter(m=>(m.thread_id||'')===topicId).flatMap(m=>messageImageKeys(m).map(image_key=>({message_id:m.message_id,image_key,created_at:m.create_time}))),has_more:!!data.has_more,page_token:data.page_token||''};
}
