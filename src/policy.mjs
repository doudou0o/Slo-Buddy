import fs from 'node:fs';import path from 'node:path';import {root} from './config.mjs';import {documentId} from './feishu.mjs';
export function policyFor(config,type){return config.policies[type==='group'?'group':'private'];}
export function checkDocument(policy,value,write=false){const id=documentId(value);if(write&&!policy.documentWrite)throw Error('当前会话禁止写飞书文档');if(!write&&!policy.documentRead)throw Error('当前会话禁止读飞书文档');if(!policy.allowAllDocuments&&!policy.allowedDocuments.includes(id))throw Error('文档不在当前会话白名单');return id;}
export function checkFolder(policy,value){if(!policy.documentWrite)throw Error('禁止新建文档');if(!value||!policy.allowedFolders.includes(value))throw Error('文件夹不在白名单');}
export function localPath(policy,name,base=path.join(root,'workspace')){if(!policy.localFiles)throw Error('群聊禁止访问本地文件');const realBase=fs.realpathSync(base);const target=path.resolve(base,name);const parent=fs.realpathSync(fs.existsSync(target)?target:path.dirname(target));if(parent!==realBase&&!parent.startsWith(realBase+path.sep))throw Error('文件路径超出允许目录');return target;}

export function canWriteLocal(policy,type){return policy.localFiles===true&&(policy.localFileWrite??(type!=='group'))===true;}
export function writeLocalText(policy,type,name,text,base=path.join(root,'workspace')){if(!canWriteLocal(policy,type))throw Error('当前会话禁止写入本地文件');const file=localPath(policy,name,base);fs.writeFileSync(file,text);return {path:file};}
