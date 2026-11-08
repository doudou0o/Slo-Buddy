import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function archiveTarget(config,appId,chatId){return config.imageArchives?.find(x=>x.app===appId&&x.chatId===chatId)?.folderToken||'';}
function keys(message){
 if(!['image','post','interactive'].includes(message.msg_type))return [];
 const found=new Set(),walk=v=>{if(!v||typeof v!=='object')return;if(v.image_key)found.add(v.image_key);if(v.img_key)found.add(v.img_key);Object.values(v).forEach(walk);};
 walk(JSON.parse(message.body?.content||'{}'));return [...found];
}
function caption(m){const found=[],walk=v=>{if(!v||typeof v!=='object')return;if(typeof v.text==='string')found.push(v.text);Object.values(v).forEach(walk);};try{walk(JSON.parse(m.body?.content||'{}'));}catch{}return found.join(' ').slice(0,800);}
export async function archiveImages({api,chatId,topicId='',pageToken=''}){
 const q=new URLSearchParams({container_id_type:topicId?'thread':'chat',container_id:topicId||chatId,sort_type:'ByCreateTimeDesc',page_size:'50',...(pageToken?{page_token:pageToken}:{})});
 const r=await api.request('/im/v1/messages?'+q),messages=(r.items||[]).filter(m=>m.chat_id===chatId&&(m.thread_id||'')===topicId);
 return {images:messages.flatMap((m,n)=>keys(m).map(image_key=>({message_id:m.message_id,image_key,created_at:m.create_time,context:messages.slice(Math.max(0,n-1),n+4).reverse().map(x=>({message_id:x.message_id,text:caption(x)}))}))),has_more:!!r.has_more,page_token:r.page_token||''};
}
export async function saveArchiveImage({api,root,folderToken,chatId,topicId='',messageId,imageKey,title}){
 if(!folderToken)throw Error('当前群未配置共享图片目录');
 const name=String(title||'').normalize('NFC').replace(/[\x00-\x1f/\\:*?"<>|]/g,'_').trim().slice(0,70);
 if(!name||name==='.'||name==='..')throw Error('请提供简短图片名称');
 const r=await api.request('/im/v1/messages/'+encodeURIComponent(messageId)),m=r.items?.find(x=>x.message_id===messageId);
 if(!m||m.chat_id!==chatId||(m.thread_id||'')!==topicId)throw Error('只能保存当前会话或话题中的图片');
 const available=keys(m),key=imageKey||(available.length===1?available[0]:'');
 if(!available.includes(key))throw Error('请选择消息中真实存在的图片 image_key');
 const bytes=await api.request('/im/v1/messages/'+encodeURIComponent(messageId)+'/resources/'+encodeURIComponent(key)+'?type=image',{binary:true});
 const ext=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216?'jpg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':'';
 if(!ext)throw Error('下载内容不是支持的图片格式');
 const date=new Date(Number(m.create_time));if(!Number.isFinite(date.getTime()))throw Error('图片消息日期无效');
 const filename=date.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})+'_'+name.replace(/\.(png|jpe?g|webp)$/i,'')+'.'+ext;
 const dir=path.join(root,'artifacts','saved-group-images');fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,crypto.randomUUID()+'-'+filename),bytes,{mode:0o600});
 const form=new FormData();for(const [k,v]of Object.entries({file_name:filename,parent_type:'explorer',parent_node:folderToken,size:String(bytes.length)}))form.set(k,v);form.set('file',new Blob([bytes]),filename);
 const uploaded=await api.request('/drive/v1/files/upload_all',{method:'POST',body:form});if(!uploaded.file_token)throw Error('上传未返回文件标识，状态未知，请勿盲目重试');
 return {saved:true,filename,file_token:uploaded.file_token,folder_url:'https://www.feishu.cn/drive/folder/'+folderToken};
}
