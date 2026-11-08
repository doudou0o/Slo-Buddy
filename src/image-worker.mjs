import {syncCodexAuth} from './codex-auth.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {Codex} from '@openai/codex-sdk';import {root,loadConfig} from './config.mjs';
export function collectGenerated(home,threadId,destination){
 if(!/^[a-zA-Z0-9-]+$/.test(threadId||''))throw Error('图片生成未建立有效会话');
 const dir=path.join(home,'generated_images',threadId);if(!fs.existsSync(dir))throw Error('图片工具没有生成可交付文件');
 const generatedBase=fs.realpathSync(path.join(home,'generated_images'));if(!fs.realpathSync(dir).startsWith(generatedBase+path.sep))throw Error('图片会话目录异常');
 const files=fs.readdirSync(dir).filter(n=>/\.(png|webp|jpg|jpeg)$/i.test(n));if(!files.length)throw Error('图片工具没有生成可交付文件');
 const source=path.join(dir,files[0]);const real=fs.realpathSync(source);if(!real.startsWith(fs.realpathSync(dir)+path.sep)||!fs.statSync(real).isFile())throw Error('图片输出路径异常');if(fs.statSync(real).size>20*1024*1024)throw Error('图片超过飞书发送大小限制');
 fs.mkdirSync(destination,{recursive:true,mode:0o700});const output=path.join(destination,crypto.randomUUID()+path.extname(source));fs.copyFileSync(real,output,fs.constants.COPYFILE_EXCL);return output;
}
export async function generateImage(prompt,{signal}={}){
 const settings=loadConfig();const id=crypto.randomUUID();const home=path.join(root,'.private/image-workers',id);fs.mkdirSync(home,{recursive:true,mode:0o700});
 syncCodexAuth(home);
 const networkFile=path.join(root,'.private/network.json');const network=fs.existsSync(networkFile)?JSON.parse(fs.readFileSync(networkFile,'utf8')):{};const working=path.join(home,'workspace');fs.mkdirSync(working);
 const codex=new Codex({codexPathOverride:path.join(root,'node_modules/.bin/codex'),env:{...network,PATH:process.env.PATH,HOME:os.homedir(),CODEX_HOME:home},config:{features:{image_generation:true,shell_tool:false,plugins:false,remote_plugin:false,skill_search:false},apps:{_default:{enabled:false}},project_doc_max_bytes:0}});
 const thread=codex.startThread({workingDirectory:working,skipGitRepoCheck:true,sandboxMode:'read-only',approvalPolicy:'never',model:settings.model,modelReasoningEffort:'low',webSearchMode:'disabled'});
 const {events}=await thread.runStreamed('使用内置 image_gen.imagegen / imagegen 工具生成一张图片。不得用SVG、代码或文字代替。不要读取文件，不调用其他工具。只生成，不发送。用户画图要求：'+prompt,{signal:signal||AbortSignal.timeout(480000)});
 let threadId;for await(const event of events){if(event.type==='thread.started')threadId=event.thread_id;if(event.type==='turn.completed')break;if(event.type==='turn.failed')throw Error(event.error.message);if(event.type==='error')throw Error(event.message);}
 return collectGenerated(home,threadId,path.join(root,'artifacts/generated'));
}
