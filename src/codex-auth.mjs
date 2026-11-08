import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Isolated homes keep their config and sessions. Track changes to the primary
// login so a desktop re-login/refresh cannot leave an old snapshot forever.
export function syncCodexAuth(home,source=path.join(os.homedir(),'.codex/auth.json')){
 if(!fs.existsSync(source))throw Error('未找到本机 Codex 登录文件，请先登录 Codex。');
 const bytes=fs.readFileSync(source);JSON.parse(bytes.toString());
 const fingerprint=crypto.createHash('sha256').update(bytes).digest('hex');
 const destination=path.join(home,'auth.json'),marker=path.join(home,'primary-auth-version');
 fs.mkdirSync(home,{recursive:true,mode:0o700});
 const changed=!fs.existsSync(destination)||!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==fingerprint;
 if(changed){const temporary=destination+'.sync-'+crypto.randomUUID();try{fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,destination);fs.writeFileSync(marker,fingerprint,{mode:0o600});}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
 fs.chmodSync(destination,0o600);return {updated:changed};
}
