import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {root} from './config.mjs';
export const memoryFile=path.join(root,'.private','memory.json');
export function validateMemory(value){for(const key of ['private','shared'])if(typeof value?.[key]!=='string'||value[key].length>20000)throw Error('每个知识区须为文本，最多20000字符');return {private:value.private,shared:value.shared};}
export function loadMemory(file=memoryFile){if(!fs.existsSync(file))return {private:'',shared:'',updatedAt:null};const value=JSON.parse(fs.readFileSync(file,'utf8'));return {...validateMemory(value),updatedAt:value.updatedAt||null};}
export function saveMemory(value,file=memoryFile){const next={...validateMemory(value),updatedAt:new Date().toISOString()};fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n',{mode:0o600});fs.renameSync(file+'.tmp',file);return next;}
export function contextKnowledge(memory,chatType){const knowledge={shared:memory.shared,...(chatType==='group'?{}:{private:memory.private})};return {knowledge,version:crypto.createHash('sha256').update(JSON.stringify(knowledge)).digest('hex')};}
