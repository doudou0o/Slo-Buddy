import {messageDelivery} from './message-delivery.mjs';
export async function deliverImage({prompt,statusText,chatId,replyToMessageId,signal,api,generate}) {
 if(!chatId)throw Error('没有绑定接收会话');
 signal?.throwIfAborted();
 const request=messageDelivery(chatId,'text',{text:statusText||'我来试着生成这张图片，图片还在生成中，再等一会儿。'},{replyToMessageId});
 await api.request(request.route,request.options);
 const file=await generate(prompt,{signal});signal?.throwIfAborted();
 const sent=await api.sendFile(chatId,file,true,{replyToMessageId});
 return {sent:true,message_id:sent.message_id};
}
