import fs from 'node:fs';
import path from 'node:path';
import {root,loadConfig} from '../src/config.mjs';
const id=process.argv[2]||'main';
if(!loadConfig().apps.some(app=>app.id===id))throw Error('应用不存在，请使用配置中心中的内部应用 ID');
const file=path.join(root,'.private',id,'state.json');
if(!fs.existsSync(file)){console.log('请先在配置中心连接该应用，再查看配对指令。');}
else {const data=JSON.parse(fs.readFileSync(file,'utf8'));console.log(data.users.length?'该应用已配对，不需要再次配对。':`在该应用的飞书私聊里发送：\n/pair ${data.pairing}`);}
