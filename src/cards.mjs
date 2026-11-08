import crypto from 'node:crypto';import {messageDelivery} from './message-delivery.mjs';
export function buildCard({title,body,choices=[],input=false},id){
 const elements=[{tag:'div',text:{tag:'lark_md',content:body}}];
 if(choices.length&&!input)elements.push({tag:'action',actions:choices.map((label,index)=>({tag:'button',text:{tag:'plain_text',content:label},type:'default',value:{buddy_card:id,choice:index}}))});
 if(input){const buttons=choices.length?choices:['提交'];elements.push({tag:'form',name:'reply_form',elements:[{tag:'input',name:'answer',required:true,input_type:'multiline_text',max_length:1000,placeholder:{tag:'plain_text',content:'在这里填写你的回答'}},...buttons.map((label,index)=>({tag:'button',name:'submit_'+index,action_type:'form_submit',text:{tag:'plain_text',content:label},type:'primary',value:{buddy_card:id,...(choices.length?{choice:index}:{})}}))]});}

 return {config:{wide_screen_mode:true},header:{title:{tag:'plain_text',content:title},template:'green'},elements};
}
export class Cards {
 constructor({store,api,bot}){Object.assign(this,{store,api,bot});}
 async send(context,args){
  if(typeof args.title!=='string'||!args.title.trim()||args.title.length>80||typeof args.body!=='string'||!args.body.trim()||args.body.length>6000||!Array.isArray(args.choices)||args.choices.length>6||args.choices.some(x=>typeof x!=='string'||!x.trim()||x.length>80))throw Error('卡片标题、内容或选项无效');
  if(context.senderId===undefined||context.senderType==='bot')throw Error('交互卡片需绑定真人请求');
  const id=crypto.randomUUID(),scope=context.scope,delivery=messageDelivery(scope.chat,'interactive',buildCard(args,id),scope.topic?{replyToMessageId:context.sourceId}:{});
  const result=await this.api.request(delivery.route,delivery.options);
  this.store.data.cards??={};for(const [key,c]of Object.entries(this.store.data.cards))if(Date.now()-c.at>86400000)delete this.store.data.cards[key];
  this.store.data.cards[id]={...args,user:context.senderId,chat:scope.chat,topic:scope.topic,source:context.sourceId,messageId:result.message_id,at:Date.now(),status:'pending'};this.store.save();
  return {sent:true,waiting_user:Boolean(args.choices.length||args.input),message_id:result.message_id};
 }
 handle(raw){const event=raw.event||raw,value=event.action?.value||{},card=this.store.data.cards?.[value.buddy_card];const fail=content=>({toast:{type:'error',content}});
  if(!card||card.status!=='pending'||Date.now()-card.at>86400000)return fail('这张卡片已处理或已过期');
  if(event.operator?.open_id!==card.user||event.context?.open_chat_id!==card.chat||event.context?.open_message_id!==card.messageId)return fail('只能由原提问者在原会话中填写');
  let answer;
  if(Number.isInteger(value.choice)&&card.choices[value.choice])answer=card.choices[value.choice];
  if(card.input){const input=event.action?.form_value?.answer||event.action?.input_value;if(typeof input!=='string'||!input.trim()||input.length>1000)return fail('请填写有效回答');answer=[answer,input.trim()].filter(Boolean).join('\n补充：');}
  if(typeof answer!=='string'||!answer.trim()||answer.length>1200)return fail('请选择选项或填写有效回答');
  card.status='submitted';card.answer=answer.trim();this.store.save();
  const message={message_id:card.messageId,chat_id:card.chat,chat_type:card.topic||this.store.data.groups?.includes(card.chat)?'group':'p2p',message_type:'text',content:JSON.stringify({text:'我提交了交互卡片回答。问题：'+card.body+'\n我的回答：'+card.answer}),...(card.topic?{thread_id:card.topic,root_id:card.messageId}:{}),mentions:[{id:{open_id:this.bot.botOpenId}}]};
  this.bot.accept({sender:{sender_type:'user',sender_id:{open_id:card.user}},message});
  return {toast:{type:'success',content:'已提交，Slo 会继续处理'},card:{type:'raw',data:buildCard({title:card.title,body:card.body+'\n\n**你的回答：** '+card.answer,choices:[],input:false},value.buddy_card)}};
 }
}
