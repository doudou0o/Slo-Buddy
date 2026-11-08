import fs from 'node:fs';import path from 'node:path';import {root} from './config.mjs';
export function documentRegistry(app,chat){
 const file=path.join(root,'.private',app,'documents.json');
 const load=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 return {ids:()=>Object.keys(load()[chat]||{}),add(document){const data=load();data[chat]??={};data[chat][document.document_id]={title:document.title||'',url:document.url,createdAt:new Date().toISOString()};fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);}};
}
