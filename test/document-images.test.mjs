import test from 'node:test';
import assert from 'node:assert/strict';
import {insertMessageImage,listConversationImages} from '../src/document-images.mjs';
const message={message_id:'m',chat_id:'c',thread_id:'t',msg_type:'image',body:{content:JSON.stringify({image_key:'img'})}};
test('document image rejects cross-chat, cross-topic and invented image keys before downloading',async()=>{
 let downloaded=false;const api={request:async()=>({items:[message]}),downloadMessage:async()=>{downloaded=true;}};
 for(const args of [{chatId:'other',topicId:'t'},{chatId:'c',topicId:'other'},{chatId:'c',topicId:'t',imageKey:'fake'}])await assert.rejects(()=>insertMessageImage({api,document:'doc',messageId:'m',...args}));
 assert.equal(downloaded,false);
});
test('current topic image is downloaded then uploaded into the approved document',async()=>{
 const api={request:async()=>({items:[message]}),downloadMessage:async m=>{assert.equal(JSON.parse(m.content).image_key,'img');return {images:['/safe/image.png']};},insertImage:async(d,p)=>({document:d,path:p})};
 assert.deepEqual(await insertMessageImage({api,document:'doc',messageId:'m',chatId:'c',topicId:'t'}),{document:'doc',path:'/safe/image.png'});
});
test('image lookup retains pagination and excludes other topics',async()=>{
 const api={request:async route=>{assert.ok(route.includes('container_id_type=thread'));return {items:[message,{...message,thread_id:'other'}],has_more:true,page_token:'next'};}};
 const r=await listConversationImages({api,chatId:'c',topicId:'t'});assert.equal(r.images.length,1);assert.equal(r.page_token,'next');
});
