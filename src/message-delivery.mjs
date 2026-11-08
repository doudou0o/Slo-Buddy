export function messageDelivery(chatId,msgType,content,{replyToMessageId='',uuid}={}){
 if(!chatId)throw Error('没有绑定接收会话');
 const reply=Boolean(replyToMessageId);
 return {route:reply?'/im/v1/messages/'+encodeURIComponent(replyToMessageId)+'/reply':'/im/v1/messages?receive_id_type=chat_id',options:{method:'POST',body:{...(reply?{reply_in_thread:true}:{receive_id:chatId}),msg_type:msgType,content:JSON.stringify(content),...(uuid?{uuid}:{})}}};
}
export function conversationKey(message,user){return message.chat_type==='group'?['group',...(message.thread_id?[message.thread_id]:[]),message.chat_id].join(':'):user+':'+message.chat_id;}
