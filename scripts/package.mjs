import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {validateMemory} from '../src/memory.mjs';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {root} from '../src/config.mjs';

export function assertPublishable(name,content){
 const allowed=/^(?:\.gitignore|README\.md|package(?:-lock)?\.json|config\/buddy\.example\.json|examples\/(?:feishu\.env\.example|background-knowledge\.json)|docs\/[a-zA-Z0-9_-]+\.md|src\/[a-zA-Z0-9_-]+\.(?:mjs|html)|scripts\/[a-zA-Z0-9_-]+\.mjs|test\/[a-zA-Z0-9_-]+\.test\.mjs|skills\/[a-zA-Z0-9_-]+\/SKILL\.md)$/;
 if(!allowed.test(name))throw Error('发布清单不允许此路径：'+name);
 if(/cli_[a-f0-9]{12,}|(?:ou|oc|om)_[a-f0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\/Users\/[a-zA-Z0-9_-]+\//.test(content))throw Error('发现疑似真实身份、主机路径或密钥，请检查：'+name);
 if(/(?:FEISHU_APP_SECRET|OPENAI_API_KEY)[^\S\r\n]*=[^\S\r\n]*[^\s#\r\n]+/.test(content)||/sk-[A-Za-z0-9_-]{20,}/.test(content))throw Error('发现疑似凭证值，请检查：'+name);
}
export function findGit(){
 const choices=[process.env.GIT_BIN,'git','/Applications/Xcode.app/Contents/Developer/usr/bin/git','/Library/Developer/CommandLineTools/usr/bin/git'].filter(Boolean);
 for(const command of choices){const result=spawnSync(command,['--version'],{encoding:'utf8'});if(result.status===0)return command;}
 throw Error('未找到可用 Git。请安装 Git，或通过 GIT_BIN 指定可执行文件。');
}
export function makePackage(directory=root,{sharedKnowledgeFile}={}){
 const git=findGit();
 const run=args=>{const result=spawnSync(git,args,{cwd:directory,maxBuffer:20*1024*1024});if(result.status!==0)throw Error(result.stderr?.toString()||'Git 操作失败');return result.stdout;};
 const files=run(['ls-tree','-r','--name-only','-z','HEAD']).toString().split('\0').filter(Boolean);
 if(!files.length)throw Error('请先完成首次 commit');
 for(const name of files)assertPublishable(name,run(['show','HEAD:'+name]).toString());
 const dirty=run(['status','--porcelain','--untracked-files=normal']).toString();if(dirty.trim())throw Error('工作区有未提交文件；请检查并提交后再打包，发布包仅包含 HEAD。');
 const version=JSON.parse(run(['show','HEAD:package.json'])).version;
 const revision=run(['rev-parse','--short=8','HEAD']).toString().trim();
 const output=path.join(directory,'artifacts/releases');fs.mkdirSync(output,{recursive:true,mode:0o700});
 let tar=run(['archive','--format=tar','--prefix=Slo-Buddy/','HEAD']);
 if(sharedKnowledgeFile){
  const knowledge=validateMemory({private:'',shared:fs.readFileSync(path.resolve(sharedKnowledgeFile),'utf8')});
  const payload=JSON.stringify(knowledge,null,2)+'\n';
  // Only explicitly supplied shared knowledge may carry member open_ids; all other guards remain.
  assertPublishable('examples/background-knowledge.json',payload.replace(/ou_[a-f0-9]{20,}/g,'MEMBER_ID'));
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'slo-knowledge-package-'));
  try{const folder=path.join(temporary,'Slo-Buddy/examples');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'background-knowledge.json'),payload);const file=path.join(temporary,'release.tar');fs.writeFileSync(file,tar);
   const append=spawnSync('tar',['-rf',file,'-C',temporary,'Slo-Buddy/examples/background-knowledge.json'],{env:{...process.env,COPYFILE_DISABLE:'1'}});if(append.status!==0)throw Error('背景知识打包失败');tar=fs.readFileSync(file);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 }
 const archive=gzipSync(tar);
 const filename='Slo-Buddy-v'+version+'-'+revision+(sharedKnowledgeFile?'-shared-knowledge':'')+'.tar.gz';const target=path.join(output,filename);
 fs.writeFileSync(target,archive);fs.writeFileSync(target+'.sha256',createHash('sha256').update(archive).digest('hex')+'  '+filename+'\n');
 return {target,files:files.length+(sharedKnowledgeFile?1:0),revision};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const args=process.argv.slice(2);if(args.length&&(args.length!==2||args[0]!=='--shared-knowledge'))throw Error('用法：npm run package -- [--shared-knowledge 本地Markdown文件]');const result=makePackage(root,{sharedKnowledgeFile:args[1]});console.log('发布包：'+result.target+'\n文件数：'+result.files+'\n提交：'+result.revision+'\n校验文件：'+result.target+'.sha256');}
