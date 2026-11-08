import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,validate} from '../src/config.mjs';
import {validateMemory} from '../src/memory.mjs';

// Never replace an installation's existing config or credential files.
export function initialize(directory=root){
 const created=[];
 for(const folder of ['config','.private/apps','logs','artifacts','workspace'])fs.mkdirSync(path.join(directory,folder),{recursive:true,mode:0o700});
 const config=path.join(directory,'config/buddy.json');
 if(!fs.existsSync(config)){
  const example=validate(JSON.parse(fs.readFileSync(path.join(directory,'config/buddy.example.json'),'utf8')));
  fs.writeFileSync(config,JSON.stringify(example,null,2)+'\n',{flag:'wx',mode:0o600});created.push('config/buddy.json');
 }
 const settings=validate(JSON.parse(fs.readFileSync(config,'utf8')));
 for(const app of settings.apps){
  const target=path.join(directory,app.credentials);
  if(!fs.existsSync(target)){fs.writeFileSync(target,fs.readFileSync(path.join(directory,'examples/feishu.env.example')),{flag:'wx',mode:0o600});created.push(app.credentials);}
 }
 const seed=path.join(directory,'examples/background-knowledge.json'),memory=path.join(directory,'.private/memory.json');
 if(fs.existsSync(seed)&&!fs.existsSync(memory)){const knowledge=validateMemory(JSON.parse(fs.readFileSync(seed,'utf8')));fs.writeFileSync(memory,JSON.stringify(knowledge,null,2)+'\n',{flag:'wx',mode:0o600});created.push('.private/memory.json');}
 return created;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const created=initialize();console.log(created.length?'已创建：\n'+created.join('\n'):'已有配置已保留，没有覆盖任何文件。');
 console.log('下一步：登录 Codex，填写本机 .private/apps/main.env，npm start 后在配置中心连接应用。');
}
