import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import initSqlJs from 'sql.js';
const SQL=await initSqlJs();
export function memoryScope(app,message,user){return {app,chat:message.chat_id,type:message.chat_type==='group'?'group':'private',topic:message.thread_id||'',user:message.chat_type==='group'?'':user};}
export class LocalMemory {
 constructor(file){this.file=file;fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new SQL.Database(fs.existsSync(file)?fs.readFileSync(file):undefined);this.active=new Set();
  this.db.run(`CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,app TEXT,chat TEXT,type TEXT,topic TEXT,user TEXT,kind TEXT,content TEXT,status TEXT,source_id TEXT,sender_id TEXT,created TEXT,updated TEXT);
  CREATE TABLE IF NOT EXISTS turns(seq INTEGER PRIMARY KEY AUTOINCREMENT,app TEXT,chat TEXT,type TEXT,topic TEXT,user TEXT,source_id TEXT,sender_id TEXT,content TEXT,created TEXT);
  CREATE TABLE IF NOT EXISTS checkpoints(scope TEXT PRIMARY KEY,seq INTEGER DEFAULT 0,status TEXT,error TEXT,updated TEXT);
  CREATE TABLE IF NOT EXISTS revisions(id TEXT,content TEXT,status TEXT,updated TEXT);
  CREATE INDEX IF NOT EXISTS memories_scope ON memories(app,chat,type,topic,user,status);
  CREATE INDEX IF NOT EXISTS turns_scope ON turns(app,chat,type,topic,user);`);
  this.db.run("UPDATE checkpoints SET status='interrupted',error='服务重启，摘要未完成；旧摘要保留' WHERE status='running'");this.save();
 }
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,Buffer.from(this.db.export()),{mode:0o600});fs.renameSync(tmp,this.file);}
 query(sql,args=[]){const stmt=this.db.prepare(sql);try{stmt.bind(args);const rows=[];while(stmt.step())rows.push(stmt.getAsObject());return rows;}finally{stmt.free();}}
 key(s){return JSON.stringify([s.app,s.chat,s.type,s.topic,s.user]);}
 args(s){return [s.app,s.chat,s.type,s.topic,s.user];}
 add(s,{content,sourceId='',senderId='',status='confirmed',kind='fact'}){
  if(!['confirmed','candidate'].includes(status)||!['fact','summary'].includes(kind)||typeof content!=='string'||!content.trim()||content.length>12000)throw Error('记忆内容须为1至12000字符');
  const existing=this.query('SELECT * FROM memories WHERE app=? AND chat=? AND type=? AND topic=? AND user=? AND kind=? AND content=? AND status=?',[...this.args(s),kind,content.trim(),status])[0];if(existing)return existing;
  const id=crypto.randomUUID(),at=new Date().toISOString();this.db.run('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,...this.args(s),kind,content.trim(),status,sourceId,senderId,at,at]);this.save();return this.get(id);
 }
 get(id){const row=this.query('SELECT * FROM memories WHERE id=?',[id])[0];if(!row)throw Error('记忆不存在');return row;}
 list(){return {entries:this.query("SELECT * FROM memories WHERE status!='deleted' ORDER BY updated DESC LIMIT 500"),summaries:this.query('SELECT * FROM checkpoints ORDER BY updated DESC')};}
 update(id,{content,status,publicGroup=false}){const old=this.get(id);if(content!==undefined&&(typeof content!=='string'||!content.trim()||content.length>12000))throw Error('记忆内容须为1至12000字符');if(status!==undefined&&!['confirmed','candidate','disabled','deleted'].includes(status))throw Error('记忆状态无效');if(publicGroup&&(old.type!=='group'||old.kind!=='fact'))throw Error('只能将群内事实设为群公共记忆');this.db.run('INSERT INTO revisions VALUES(?,?,?,?)',[id,old.content,old.status,new Date().toISOString()]);this.db.run('UPDATE memories SET content=?,status=?,topic=?,updated=? WHERE id=?',[content?.trim()??old.content,status??old.status,publicGroup?'':old.topic,new Date().toISOString(),id]);this.save();return this.get(id);}
 retrieve(s,query='',limit=5){
  const facts=this.query("SELECT * FROM memories WHERE app=? AND chat=? AND type=? AND user=? AND (topic=? OR (type='group' AND topic='')) AND status='confirmed' AND kind='fact'",[s.app,s.chat,s.type,s.user,s.topic]);
  const tokens=[...new Set((query.toLowerCase().match(/[a-z0-9_]{2,}|[\p{Script=Han}]+/gu)||[]).flatMap(t=>/\p{Script=Han}/u.test(t)&&t.length>2?Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)):t))];
  const ranked=facts.map(m=>({m,score:tokens.reduce((n,t)=>n+(m.content.toLowerCase().includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.m.updated.localeCompare(a.m.updated)).slice(0,Math.min(limit,10)).map(x=>x.m);
  const summary=this.query("SELECT * FROM memories WHERE app=? AND chat=? AND type=? AND topic=? AND user=? AND kind='summary' AND status='confirmed' ORDER BY updated DESC LIMIT 1",this.args(s))[0]||null;
  // Version includes all eligible facts so deleting/disabling one also discards an old Codex thread.
  const version=crypto.createHash('sha256').update(JSON.stringify([facts,summary])).digest('hex');return {facts:ranked,summary,version};
 }
 proactiveContext(s){
  if(s.type!=='group'||s.user||s.topic)throw Error('主动闲聊只读取本群公共记忆');
  const memories=this.query("SELECT id,kind,content,source_id,updated FROM memories WHERE app=? AND chat=? AND type='group' AND user='' AND topic='' AND status='confirmed' ORDER BY updated DESC LIMIT 30",[s.app,s.chat]);
  const turns=this.query("SELECT seq,content,source_id,sender_id,created FROM turns WHERE app=? AND chat=? AND type='group' AND user='' AND topic='' ORDER BY seq DESC LIMIT 12",[s.app,s.chat]);
  let budget=24000;const items=[];for(const row of [...memories.map(m=>({id:'memory:'+m.id,kind:m.kind,content:m.content,sourceId:m.source_id,updated:m.updated})),...turns.map(t=>({id:'turn:'+t.seq,kind:'conversation',content:t.content,sourceId:t.source_id,senderId:t.sender_id,updated:t.created}))]){if(budget<=0)break;const content=row.content.slice(0,Math.min(4000,budget));items.push({...row,content});budget-=content.length;}
  return {items};
 }
 recordTurn(s,{sourceId,senderId,text,answer}){if(this.query('SELECT seq FROM turns WHERE app=? AND source_id=?',[s.app,sourceId]).length)return;this.db.run('INSERT INTO turns(app,chat,type,topic,user,source_id,sender_id,content,created) VALUES(?,?,?,?,?,?,?,?,?)',[...this.args(s),sourceId,senderId,JSON.stringify({user:text.slice(0,12000),assistant:answer.slice(0,12000)}),new Date().toISOString()]);this.save();}
 async summarize(s,generate,{rounds=10,characters=8000}={}){
  const key=this.key(s);if(this.active.has(key))return false;
  const checkpoint=this.query('SELECT * FROM checkpoints WHERE scope=?',[key])[0];const turns=this.query('SELECT * FROM turns WHERE app=? AND chat=? AND type=? AND topic=? AND user=? AND seq>? ORDER BY seq', [...this.args(s),checkpoint?.seq||0]);if(!turns.length||(turns.length<rounds&&turns.reduce((n,t)=>n+t.content.length,0)<characters))return false;
  const batch=[];let size=0;for(const turn of turns){if(batch.length&&size+turn.content.length>30000)break;batch.push(turn);size+=turn.content.length;if(batch.length>=40)break;}
  this.active.add(key);const upto=batch.at(-1).seq;this.db.run("INSERT INTO checkpoints VALUES(?,?,'running',NULL,?) ON CONFLICT(scope) DO UPDATE SET status='running',error=NULL,updated=excluded.updated",[key,checkpoint?.seq||0,new Date().toISOString()]);this.save();
  try{const old=this.retrieve(s).summary;const content=await generate({previous:old?.content||'',turns:batch.map(t=>({sourceId:t.source_id,senderId:t.sender_id,...JSON.parse(t.content)}))});if(typeof content!=='string'||!content.trim()||content.length>12000)throw Error('摘要为空或超出长度限制');
   if(old){const live=this.get(old.id);if(live.updated!==old.updated||live.status!=='confirmed')throw Error('摘要在生成期间被修改或停用，保留手动修改');this.update(old.id,{content});this.db.run('UPDATE memories SET source_id=? WHERE id=?',[[...new Set([...(old.source_id||'').split(',').filter(Boolean),...batch.map(t=>t.source_id)])].join(','),old.id]);}else this.add(s,{content,kind:'summary',sourceId:batch.map(t=>t.source_id).join(','),senderId:'summary'});
   this.db.run("UPDATE checkpoints SET seq=?,status='completed',error=NULL,updated=? WHERE scope=?",[upto,new Date().toISOString(),key]);this.db.run('DELETE FROM turns WHERE app=? AND chat=? AND type=? AND topic=? AND user=? AND seq<=?', [...this.args(s),upto]);this.save();return true;
  }catch(e){this.db.run("UPDATE checkpoints SET status='failed',error=?,updated=? WHERE scope=?",[e.message.slice(0,500),new Date().toISOString(),key]);this.save();return false;}finally{this.active.delete(key);}
 }
}
