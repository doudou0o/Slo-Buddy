import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
export const basePersonaFile=path.join(os.homedir(),'.codex','AGENTS.md');
export function readBasePersona(enabled=true,file=basePersonaFile){
 if(!enabled)return '';
 try{if(fs.statSync(file).size>128*1024)throw Error('文件超过128KB');return fs.readFileSync(file,'utf8');}
 catch(error){throw Error('无法加载基础人设 '+file+'：'+error.message);}
}
export function basePersonaStatus(enabled=true){
 try{const content=readBasePersona(enabled);return {enabled,path:basePersonaFile,loaded:enabled,characters:content.length};}
 catch(error){return {enabled,path:basePersonaFile,loaded:false,error:error.message};}
}
