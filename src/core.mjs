import {ProgressReporter} from './progress.mjs';
import {conversationKey} from './message-delivery.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {admitBot,defaultBotMessages} from './bot-access.mjs';

export function splitText(text, limit = 6000) {
  const parts = [];
  let part = '';
  for (const char of String(text)) {
    if (Buffer.byteLength(part + char) > limit) { parts.push(part); part = ''; }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

export class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'state.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) :
      { users: [], pairing: crypto.randomBytes(12).toString('hex'), threads: {}, seen: {}, jobs: {} };
    for (const job of Object.values(this.data.jobs)) {
      if (job.status === 'running') job.status = 'interrupted';
    }
    this.save();
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  claim(id) {
    if (this.data.seen[id]) return false;
    const cutoff = Date.now() - 7 * 86400000;
    for (const [key, at] of Object.entries(this.data.seen)) if (at < cutoff) delete this.data.seen[key];
    this.data.seen[id] = Date.now();
    this.save();
    return true;
  }
}

export class Bot {
  constructor({ store, agent, send, prepareMedia, addThinking = async () => null, removeThinking = async () => {}, resolveSender = async () => null, onConversation = () => {}, prepareContext = async () => ({text:"",images:[]}), historyLimit = () => 40, botMessages = () => defaultBotMessages, botOpenId = '', allowedUsers = [], timeoutMs = 600000, log = () => {} }) {
    Object.assign(this, { store, agent, send, prepareMedia, addThinking, removeThinking, resolveSender, prepareContext, onConversation, historyLimit, botMessages, botOpenId, allowedUsers, timeoutMs, log });
    this.active = new Map();
    this.pending = new Set();
    this.queues = new Map();
    this.queueCounts = new Map();
    this.epochs = new Map();
  }
  // Synchronous acceptance and deduplication; do not wait for an LLM inside the WS callback.
  accept(event) {
    const { message: m, sender } = event ?? {};
    const user = sender?.sender_id?.open_id;
    if (!m?.message_id || !m.chat_id || !user || !['user','bot'].includes(sender.sender_type) || !['p2p', 'group'].includes(m.chat_type)) return;
    if (m.chat_type === 'group' && (!this.botOpenId || !m.mentions?.some(mention => mention.id?.open_id === this.botOpenId))) {
      if(sender.sender_type==='user'&&this.store.data.groups?.includes(m.chat_id)&&['image','post'].includes(m.message_type)){
        this.store.data.recentMedia??={};const entries=this.store.data.recentMedia[m.chat_id]||[];
        this.store.data.recentMedia[m.chat_id]=[...entries.filter(x=>x.message.message_id!==m.message_id&&Date.now()-x.at<300000),{at:Date.now(),sender:user,message:m}].slice(-10);this.store.save();
      }
      return;
    }
    if (!this.store.claim(m.message_id)) return;
    if(sender.sender_type==='bot'){
      const admitted=admitBot({state:this.store.data,message:m,sender,botOpenId:this.botOpenId,policy:this.botMessages()});this.store.save();if(!admitted)return;
    }else if(m.chat_type==='group' && this.store.data.groups?.includes(m.chat_id)){
      this.store.data.botRounds??={};this.store.data.botRounds[m.chat_id]={count:0,lastAt:0};this.store.save();
    }
    const key=conversationKey(m,user);
    let command='';try{command=JSON.parse(m.content).text||'';}catch{}
    for(const mention of m.mentions||[])if(mention.id?.open_id===this.botOpenId&&mention.key)command=command.split(mention.key).join('');
    command=command.trim();
    const control=['/help','帮助','/ping','/status','查看进度','/stop','停止任务','/new','新建会话'].includes(command);
    let work;
    if(control)work=this.handle(event);
    else {
      const count=this.queueCounts.get(key)||0;
      if(count>=20){work=this.send(m.chat_id,'当前会话已有20条请求等待处理，请稍后再发送。',crypto.randomUUID(),m.thread_id?{replyToMessageId:m.message_id,topicId:m.thread_id}:{});}
      else{
        const epoch=this.epochs.get(key)||0;this.queueCounts.set(key,count+1);
        work=(this.queues.get(key)||Promise.resolve()).catch(()=>{}).then(()=>{this.queueCounts.set(key,(this.queueCounts.get(key)||1)-1);if((this.epochs.get(key)||0)!==epoch)return;return this.handle(event);});
        this.queues.set(key,work);
        work.finally(()=>{if(this.queues.get(key)===work)this.queues.delete(key);}).catch(()=>{});
      }
    }
    const promise = work.catch(error => {
      this.log('handler_failed', { error: error.message });
    }).finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }
  async handle({ message: m, sender }) {
    const user = sender.sender_id.open_id;
    const key = conversationKey(m,user);
    const isBot = sender.sender_type === 'bot';
    const owner = !isBot && (this.allowedUsers.length ? this.allowedUsers.includes(user) : this.store.data.users.includes(user));
    this.store.data.groups ??= [];
    this.store.data.history ??= {};
    if (m.chat_type === 'group' && owner && !this.store.data.groups.includes(m.chat_id)) {
      this.store.data.groups.push(m.chat_id); this.store.save();
    }
    const reply = async (text,{mentionBot=false}={}) => {
      let index = 0;
      for (const part of splitText(isBot?text.replace(/<at\b[^>]*>[\s\S]*?<\/at>/gi,''):text)) {
        const uuid = crypto.createHash('sha256').update(`${m.message_id}:${index++}:${part}`).digest('hex').slice(0, 32);
        await this.send(m.chat_id, isBot&&mentionBot ? '<at user_id="'+user+'"></at> '+part : part, uuid,m.thread_id?{replyToMessageId:m.message_id,topicId:m.thread_id}:{});
      }
    };
    let text = '';
    try { text = JSON.parse(m.content).text?.trim() ?? ''; } catch { /* Invalid input */ }
    for (const mention of m.mentions ?? []) {
      if (mention.id?.open_id === this.botOpenId && mention.key) text = text.split(mention.key).join('');
    }
    text = text.trim();
    if(isBot && (text.startsWith('/') || ['停止任务','新建会话','查看进度','帮助'].includes(text)))return;
    const permitted = owner || (m.chat_type === 'group' && this.store.data.groups.includes(m.chat_id));
    if (!permitted) {
      const expected = this.store.data.pairing;
      if (m.chat_type === 'p2p' && !this.allowedUsers.length && !this.store.data.users.length && expected && text === `/pair ${expected}`) {
        this.store.data.users = [user];
        this.store.data.pairing = null;
        this.store.data.chats ??= {}; this.store.data.chats[m.chat_id] = { type: m.chat_type };
        this.store.save();
        await reply('配对成功。现在可以直接发任务；发送 /help 查看命令。');
      }
      return;
    }
    if(!isBot && m.chat_type==='group'){
      this.store.data.mentionDirectory??={};const directory=this.store.data.mentionDirectory[m.chat_id]??={};
      for(const mention of m.mentions||[]){const id=mention.id?.open_id;if(id&&id!==this.botOpenId&&['user','bot'].includes(mention.mentioned_type))directory[id]={id,name:mention.name||id,type:mention.mentioned_type};}
    }
    if (m.chat_type === 'group' && m.message_type === 'file') { await reply('群聊目前只处理文字、图片和表情，不读取文件附件。'); return; }
    this.store.data.chats ??= {}; this.store.data.chats[m.chat_id] = { type: m.chat_type };
    if(m.thread_id){this.store.data.topics??={};this.store.data.topics[m.thread_id]={chatId:m.chat_id,rootMessageId:m.root_id||m.message_id};}
    this.store.save();
    const media = ['image', 'file', 'post', 'sticker', 'emotion'].includes(m.message_type) && this.prepareMedia;
    if (!media && (m.message_type !== 'text' || !text)) { await reply('暂不支持这类消息。可以发送文字、图片或图文消息；群内请 @智能体。'); return; }
    if (text.length > 20000) { await reply('这条消息太长，请拆成几条发送。'); return; }
    if (['/help', '帮助'].includes(text)) {
      await reply('私聊直接发送任务，群里请先 @智能体。\n/status 或 查看进度：查看当前任务\n/stop 或 停止任务：停止执行\n/new 或 新建会话：清空会话上下文\n/ping：检查服务\n工作目录：Slo-Buddy/workspace。请求按会话排队，/stop 同时取消此前排队请求。私聊仅响应已配对用户；所有者首次在群内 @ 后，群成员也可 @ 使用。每个群共享上下文，与私聊隔离。群内回复对群成员可见。'); return;
    }
    if (text === '/ping') { await reply('pong · Slo-Buddy 在线'); return; }
    if (['/status', '查看进度'].includes(text)) {
      const job = this.store.data.jobs[key];
      await reply((job ? `状态：${job.status}\n${job.progress ?? ''}\n开始时间：${job.startedAt}` : '目前没有任务。')+`\n等待处理：${this.queueCounts.get(key)||0}条`); return;
    }
    if (m.chat_type === 'group' && !owner && ['/stop', '停止任务', '/new', '新建会话'].includes(text)) { await reply('只有所有者可以停止群任务或清空群上下文。'); return; }
    if (['/stop', '停止任务'].includes(text)) {
      const active = this.active.get(key);
      this.epochs.set(key,(this.epochs.get(key)||0)+1);
      active?.abort(new Error('用户停止了任务'));
      await reply(active ? '已请求停止当前任务并取消此前排队的请求。已完成的文件修改会保留。' : '目前没有正在执行的任务。'); return;
    }
    if (['/new', '新建会话'].includes(text)) {
      if (this.active.has(key)) { await reply('请先 /stop 停止当前任务，再新建会话。'); return; }
      this.epochs.set(key,(this.epochs.get(key)||0)+1);
      delete this.store.data.threads[key];
      delete this.store.data.jobs[key];
      delete this.store.data.history[key];
      this.store.save();
      await reply('已新建会话。工作目录里的文件会保留。'); return;
    }
    const controller = new AbortController();
    this.active.set(key, controller);
    const job = { status: 'running', startedAt: new Date().toISOString(), progress: '准备执行' };
    this.store.data.jobs[key] = job;
    this.store.save();
    const timer = setTimeout(() => controller.abort(new Error('任务达到时间上限')), this.timeoutMs);
    const started = Date.now();
    this.log('task_started',{chatId:m.chat_id,topicId:m.thread_id||'',messageId:m.message_id});
    const progress=new ProgressReporter({send:isBot?async()=>{}:reply,log:this.log});
    // The indicator must never delay inference or prevent a reply.
    const thinking = Promise.resolve().then(() => this.addThinking(m.message_id)).catch(error => {
      this.log('thinking_add_failed', { error: error.message });
      return null;
    });
    try {
      const prepared = media ? await this.prepareMedia(m, controller.signal) : { text, images: [] };
      const context=await this.prepareContext(m,user,controller.signal);
      prepared.text=[prepared.text,context.text].filter(Boolean).join('\n\n');
      prepared.images=[...new Set([...prepared.images,...context.images])].slice(0,10);
      controller.signal.throwIfAborted();
      let name = sender.name || null;
      try { if (!isBot) name ||= await this.resolveSender(user, m.chat_id, m.chat_type); }
      catch (error) { this.log('sender_lookup_failed', { error: error.message }); }
      const senderInfo = { id: user, name: name || (isBot ? '其他智能体' : '未获取姓名的成员'), type: isBot ? 'bot' : 'user', owner };
      const history = this.store.data.history[key] || [];
      const result = await this.agent.run(prepared.text, {
        sender: senderInfo, chatType: m.chat_type, history: history.slice(-this.historyLimit()),
        messageId:m.message_id,chatId: m.chat_id, topicId:m.thread_id||'',replyToMessageId:m.thread_id?m.message_id:'', images: prepared.images,
        threadId: this.store.data.threads[key], signal: controller.signal,
        onTiming: (stage, elapsedMs) => this.log('agent_timing', { stage, elapsedMs,chatId:m.chat_id,topicId:m.thread_id||'',messageId:m.message_id }),
        onThread: id => { this.store.data.threads[key] = id; this.store.save(); },
        onUserProgress:text=>progress.report(text),
        onProgress: stage => { job.progress = stage;progress.update(stage); this.store.save(); },
      });
      this.store.data.history[key] = [...history, { at: new Date().toISOString(), sender: senderInfo, text: prepared.text.slice(0,4000), imageCount: prepared.images.length }, ...(result?.suppressed?[]:[{ at: new Date().toISOString(), sender: { id: 'assistant', name: '智能体' }, text: String(result?.text ?? result).slice(0,4000) }])].slice(-this.historyLimit());
      await progress.close();
      job.status = result?.waitingUser?'waiting_user':'completed';
      job.finishedAt = new Date().toISOString();
      this.store.save();
      if (!result?.silent) await reply((result?.text??result) || '执行完成，本次没有文字回复。',{mentionBot:isBot&&result?.mentionBot===true});
      if(!result?.suppressed)this.onConversation({message:m,sender:user,text:prepared.text,answer:String(result?.text??result)});
      this.log('task_completed', { elapsedMs: Date.now() - started });
    } catch (error) {
      await progress.close();
      job.status = controller.signal.aborted ? 'stopped' : 'failed';
      job.progress = controller.signal.aborted ? String(controller.signal.reason?.message ?? '已停止') : '执行失败，请查看本地服务日志';
      this.store.save();
      this.log('task_failed', { error: error.message });
      try { if(!isBot)await reply(`${controller.signal.aborted?job.progress:error.message.includes('缺少权限')||error.message.includes('230027')?'无法读取飞书资源：'+error.message:job.progress}。可以继续发送任务或 /new 新建会话。`); } catch { this.log('failure_reply_failed'); }
    } finally {
      await progress.close();
      clearTimeout(timer);
      this.active.delete(key);
      // A late creation response must also be cleaned up after completion/cancellation.
      const reactionId = await thinking;
      if (reactionId) {
        try { await this.removeThinking(m.message_id, reactionId); }
        catch (error) { this.log('thinking_remove_failed', { error: error.message }); }
      }
    }
  }
}
