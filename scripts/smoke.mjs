import { createAgent } from '../src/agent.mjs';
const result = await createAgent().run('连接测试：不要读写文件，不要调用工具，只回复 FSBOT_CODEX_OK。', { signal: AbortSignal.timeout(90000) });
if (!result.includes('FSBOT_CODEX_OK')) throw new Error('Codex 响应不符合预期');
console.log('Codex 真实连接测试通过：', result);
