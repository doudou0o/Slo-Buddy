import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { root } from '../src/agent.mjs';

if(process.platform!=='darwin')throw new Error('此守护脚本仅支持 macOS；其他系统请使用 npm start 并自行配置进程管理。');
const label = 'local.slo-buddy';
const domain = `gui/${process.getuid()}`;
const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
const action = process.argv[2] || 'status';
const run = args => spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
if (action === 'status') {
  const result = run(['print', `${domain}/${label}`]);
  console.log(result.status === 0 ? result.stdout.split('\n').filter(line => /state =|pid =|last exit code/.test(line)).join('\n') : 'Slo-Buddy 后台服务尚未加载。');
} else if (action === 'stop') {
  const result = run(['bootout', domain, plist]);
  console.log(result.status === 0 ? 'Slo-Buddy 后台服务已停止。' : '服务未加载或停止失败。');
} else if (action === 'install') {

  const lock = path.join(root, '.private/service.lock');
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (Number.isInteger(pid) && pid > 1) {
      try { process.kill(pid, 0); throw new Error('请先停止正在运行的前台 Slo-Buddy，再安装后台服务。'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(root, 'src/main.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(`${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)}</string><key>HOME</key><string>${xml(os.homedir())}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'error.log'))}</string>
</dict></plist>`, { mode: 0o600 });
  const result = run(['bootstrap', domain, plist]);
  if (result.status !== 0) throw new Error(result.stderr);
  console.log('Slo-Buddy 后台服务已加载；登录 Mac 后自动启动。');
} else throw new Error('用法：node scripts/service.mjs install|status|stop');
