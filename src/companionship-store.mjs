import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import initSqlJs from 'sql.js';
import {targetKey} from './companionship-config.mjs';
const SQL=await initSqlJs();
export class CompanionshipStore {
 constructor(file){this.file=file;fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new SQL.Database(fs.existsSync(file)?fs.readFileSync(file):undefined);this.db.run(`
 CREATE TABLE IF NOT EXISTS conversation_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT,source TEXT,sender TEXT,name TEXT,text TEXT,answer TEXT,at TEXT,processed INTEGER DEFAULT 0,UNIQUE(scope,source));
 CREATE TABLE IF NOT EXISTS conversation_activity(scope TEXT PRIMARY KEY,at TEXT);
 CREATE TABLE IF NOT EXISTS observed_sources(scope TEXT,source TEXT,at TEXT,PRIMARY KEY(scope,source));
 CREATE TABLE IF NOT EXISTS clues(id TEXT PRIMARY KEY,scope TEXT,kind TEXT,subject TEXT,content TEXT,sources TEXT,time_basis TEXT,not_before TEXT,expires_at TEXT,status TEXT,revision INTEGER,updated TEXT,last_contact TEXT);
 CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,scope TEXT,clue_id TEXT,action TEXT,reason TEXT,text TEXT,at TEXT,status TEXT,message_id TEXT,retry_at TEXT);
 CREATE TABLE IF NOT EXISTS scope_state(scope TEXT PRIMARY KEY,last_check TEXT,retry_after TEXT,version INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS contact_ledger(id TEXT PRIMARY KEY,app TEXT,chat TEXT,at TEXT,status TEXT,message_id TEXT,origin TEXT);
 CREATE INDEX IF NOT EXISTS events_scope ON conversation_events(scope,seq);
 CREATE INDEX IF NOT EXISTS clues_scope ON clues(scope,status,expires_at);
 CREATE INDEX IF NOT EXISTS ledger_chat ON contact_ledger(app,chat,at);
 `);this.db.run("UPDATE decisions SET status='unknown' WHERE status='sending'");this.db.run("UPDATE contact_ledger SET status='unknown' WHERE status='reserved'");this.save();}
 query(sql,args=[]){const q=this.db.prepare(sql);try{q.bind(args);const rows=[];while(q.step())rows.push(q.getAsObject());return rows;}finally{q.free();}}
 save(){fs.writeFileSync(this.file+'.tmp',Buffer.from(this.db.export()),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 state(t){return this.query('SELECT * FROM scope_state WHERE scope=?',[targetKey(t)])[0]||{version:0};}
 touch(t){this.db.run('INSERT INTO scope_state(scope,version) VALUES(?,1) ON CONFLICT(scope) DO UPDATE SET version=version+1',[targetKey(t)]);}
 record(t,{source,sender,name='',text,at=new Date().toISOString()}){if(!source||!sender||!text?.trim())return false;const key=targetKey(t);if(this.query('SELECT source FROM observed_sources WHERE scope=? AND source=?',[key,source]).length)return false;this.db.run('INSERT INTO observed_sources VALUES(?,?,?)',[key,source,at]);this.db.run('INSERT INTO conversation_events(scope,source,sender,name,text,answer,at) VALUES(?,?,?,?,?,?,?)',[key,source,sender,name,text.slice(0,6000),'',at]);this.touch(t);this.save();return true;}
 answer(t,source,answer,now=new Date(),name=''){if(!this.query('SELECT seq FROM conversation_events WHERE scope=? AND source=?',[targetKey(t),source]).length)return;this.db.run('UPDATE conversation_events SET answer=?,name=CASE WHEN ?<>? THEN ? ELSE name END WHERE scope=? AND source=?',[String(answer||'').slice(0,3000),name,'',name,targetKey(t),source]);this.db.run('INSERT OR REPLACE INTO conversation_activity VALUES(?,?)',[targetKey(t),now.toISOString()]);this.touch(t);this.save();}
 events(t,{pending=false,limit=40}={}){return this.query('SELECT * FROM conversation_events WHERE scope=?'+(pending?' AND processed=0':'')+' ORDER BY seq '+(pending?'ASC':'DESC')+' LIMIT ?',[targetKey(t),limit]).sort((a,b)=>a.seq-b.seq);}
 pendingRange(t){return this.query('SELECT MIN(at) AS first,MAX(at) AS last,COUNT(*) AS count FROM conversation_events WHERE scope=? AND processed=0',[targetKey(t)])[0];}
 latestAt(t){return this.query('SELECT MAX(at) AS at FROM (SELECT at FROM conversation_events WHERE scope=? UNION ALL SELECT at FROM conversation_activity WHERE scope=?)',[targetKey(t),targetKey(t)])[0]?.at;}
 clues(t){return this.query('SELECT * FROM clues WHERE scope=? ORDER BY updated DESC,id LIMIT 200',[targetKey(t)]).map(r=>({...r,sources:JSON.parse(r.sources)}));}
 candidates(t,now){return this.clues(t).filter(c=>c.kind==='topic'&&c.status==='open'&&Date.parse(c.not_before)<=now&&Date.parse(c.expires_at)>now);}
 apply(t,operations,batch,snapshot,now,retentionDays){
  if(!Array.isArray(operations)||operations.length>20)throw Error('线索提取数量无效');
  const originals=new Map(snapshot.map(c=>[c.id,c]));const events=new Map(batch.map(e=>[e.source,e]));const changed=new Set();
  const prepared=operations.map(o=>{
   if(!o||!['new','update'].includes(o.op)||!['topic','background'].includes(o.kind)||!['open','waiting','closed','stopped'].includes(o.status)||typeof o.content!=='string'||!o.content.trim()||o.content.length>2000||typeof o.timeBasis!=='string'||o.timeBasis.length>500||typeof o.subject!=='string')throw Error('线索提取结构无效');
   if(!Array.isArray(o.sourceIds)||!o.sourceIds.length||o.sourceIds.some(id=>!events.has(id)))throw Error('线索引用了批次之外的来源');
   if(!batch.some(e=>e.sender===o.subject))throw Error('线索人物无本轮依据');
   const old=o.op==='update'?originals.get(o.id):null;
   if(o.op==='update'&&!old)throw Error('更新线索不存在');
   if(old){const live=this.query('SELECT * FROM clues WHERE id=? AND scope=?',[o.id,targetKey(t)])[0];if(!live||live.revision!==old.revision||['deleted','stopped'].includes(live.status))throw Error('线索已被更改，放弃本次提取');if(changed.has(o.id))throw Error('同一线索被重复更新');changed.add(o.id);if(old.subject!==o.subject)throw Error('不可更换线索所属人');}
   // Only the subject's new speech can reopen a contacted topic. Other members cannot renew it.
   if(old?.status==='waiting'&&o.status==='open'&&!o.sourceIds.some(id=>events.get(id).sender===o.subject))throw Error('未获来源人物的新回应');
   if(o.status==='waiting'&&old?.status!=='waiting')throw Error('提取器不可创建等待回复状态');
   if(![o.notBefore,o.expiresAt].every(x=>typeof x==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x)))throw Error('线索时间必须包含时区');
   const until=Date.parse(o.expiresAt),from=Date.parse(o.notBefore),cap=now.getTime()+retentionDays*86400000;
   if(!Number.isFinite(until)||!Number.isFinite(from)||from>=until||until<=now||until>cap)throw Error('线索时间窗口无效或超出保留期限');
   return {...o,id:old?.id||crypto.randomUUID(),old,sources:[...new Set([...(old?.sources||[]),...o.sourceIds])].slice(-20)};
  });
  this.db.run('BEGIN');try{for(const o of prepared){const old=o.old;this.db.run('INSERT OR REPLACE INTO clues VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[o.id,targetKey(t),o.kind,o.subject,o.content.trim(),JSON.stringify(o.sources),o.timeBasis,new Date(o.notBefore).toISOString(),new Date(o.expiresAt).toISOString(),o.status,(old?.revision||0)+1,now.toISOString(),old?.last_contact||null]);}
   for(const event of batch)this.db.run('UPDATE conversation_events SET processed=1 WHERE scope=? AND seq=?',[targetKey(t),event.seq]);this.touch(t);this.db.run('COMMIT');this.save();
  }catch(e){this.db.run('ROLLBACK');throw e;}
 }
 importClues(t,events,operations,now,retentionDays){
  if(!Array.isArray(events)||!events.length||events.length>40||!Array.isArray(operations)||!operations.length||operations.length>20||operations.some(o=>o.op!=='new'||o.status!=='open'||o.kind==='topic'&&Date.parse(o.notBefore)<=now))throw Error('历史导入只允许新增线索，话题须设置未来接续时间');
  const stage=Object.create(CompanionshipStore.prototype);stage.db=new SQL.Database(this.db.export());stage.save=()=>{};
  try{for(const event of events)stage.record(t,event);const batch=events.map(event=>stage.query('SELECT * FROM conversation_events WHERE scope=? AND source=?',[targetKey(t),event.source])[0]);if(batch.some(e=>!e))throw Error('来源曾被清理或删除，不可通过导入恢复');
   const existing=stage.clues(t);const fresh=operations.filter(o=>!existing.some(c=>c.subject===o.subject&&c.kind===o.kind&&c.content===o.content.trim()&&o.sourceIds.every(id=>c.sources.includes(id))));
   if(!fresh.length){stage.db.close();return {imported:0,alreadyImported:true};}
   stage.apply(t,fresh,batch,existing,now,retentionDays);
   const old=this.db;this.db=stage.db;try{this.save();}catch(e){this.db=old;throw e;}old.close();return {imported:fresh.length,alreadyImported:false};
  }catch(e){stage.db.close();throw e;}
 }
 change(t,id,action){if(!['delete','stop'].includes(action))throw Error('未知线索操作');const row=this.query('SELECT id FROM clues WHERE id=? AND scope=?',[id,targetKey(t)])[0];if(!row)throw Error('线索不存在');this.db.run('UPDATE clues SET status=?,content=CASE WHEN ?=1 THEN ? ELSE content END,sources=CASE WHEN ?=1 THEN ? ELSE sources END,time_basis=CASE WHEN ?=1 THEN ? ELSE time_basis END,revision=revision+1 WHERE id=?',[action==='delete'?'deleted':'stopped',action==='delete'?1:0,'',action==='delete'?1:0,'[]',action==='delete'?1:0,'',id]);if(action==='delete'){
   // Purge source text from this scope to prevent re-extraction or resurfacing from recent context.
   this.db.run('DELETE FROM conversation_events WHERE scope=?',[targetKey(t)]);this.db.run('DELETE FROM conversation_activity WHERE scope=?',[targetKey(t)]);this.db.run('UPDATE decisions SET text=?,reason=? WHERE scope=?',['','相关线索已删除',targetKey(t)]);
  }this.touch(t);this.save();}
 checked(t,now){this.db.run('INSERT INTO scope_state(scope,last_check) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET last_check=excluded.last_check',[targetKey(t),now.toISOString()]);this.save();}
 backoff(t,at){this.db.run('INSERT INTO scope_state(scope,retry_after) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET retry_after=excluded.retry_after',[targetKey(t),at]);this.save();}
 decision(t,{clueId='',action,reason,text='',status='recorded',retryAt=null},now){const id=crypto.randomUUID();this.db.run('INSERT INTO decisions VALUES(?,?,?,?,?,?,?,?,?,?)',[id,targetKey(t),clueId,action,String(reason).slice(0,1000),text,now.toISOString(),status,null,retryAt]);this.save();return id;}
 deferred(t,id,now){const r=this.query("SELECT retry_at FROM decisions WHERE scope=? AND clue_id=? AND action='defer' ORDER BY at DESC LIMIT 1",[targetKey(t),id])[0];return r?.retry_at&&Date.parse(r.retry_at)>now;}
 finishDecision(id,status,messageId=null){this.db.run('UPDATE decisions SET status=?,message_id=? WHERE id=?',[status,messageId,id]);this.save();}
 contacted(t,id,now){this.db.run("UPDATE clues SET status='waiting',last_contact=?,revision=revision+1 WHERE id=? AND scope=?",[now.toISOString(),id,targetKey(t)]);this.touch(t);this.save();}
 contactAllowed(t,now,hours=24){return !this.query('SELECT id FROM contact_ledger WHERE app=? AND chat=? AND at>? LIMIT 1',[t.app,t.chat,new Date(now.getTime()-hours*3600000).toISOString()]).length;}
 reserve(t,now,hours=24,origin='companionship'){if(!this.contactAllowed(t,now,hours))return null;const id=crypto.randomUUID();this.db.run('INSERT INTO contact_ledger VALUES(?,?,?,?,?,?,?)',[id,t.app,t.chat,now.toISOString(),'reserved',null,origin]);this.save();return id;}
 finishContact(id,status,messageId=null){this.db.run('UPDATE contact_ledger SET status=?,message_id=? WHERE id=?',[status,messageId,id]);this.save();}
 importContact(t,at,id){if(!Number.isFinite(Date.parse(at)))return;this.db.run('INSERT OR IGNORE INTO contact_ledger VALUES(?,?,?,?,?,?,?)',[id,t.app,t.chat,new Date(at).toISOString(),'sent',null,'legacy']);this.save();}
 targetForSource(app,source){const row=this.query('SELECT scope FROM conversation_events WHERE source=? ORDER BY seq DESC',[source]).find(r=>JSON.parse(r.scope)[0]===app);if(!row)return null;const [a,chat,type,topic]=JSON.parse(row.scope);return {app:a,chat,type,topic};}
 replyTarget(app,message,sender){const refs=[message.parent_id,message.root_id].filter(Boolean);if(!refs.length)return null;for(const ref of refs){const row=this.query("SELECT d.scope,c.subject FROM decisions d JOIN clues c ON c.id=d.clue_id WHERE d.message_id=? AND d.status='sent' AND c.status NOT IN ('deleted','stopped') ORDER BY d.at DESC LIMIT 1",[ref])[0];if(!row)continue;const [a,chat,type,topic]=JSON.parse(row.scope);if(a===app&&chat===message.chat_id&&type===message.chat_type&&row.subject===sender)return {app:a,chat,type,topic};}return null;}
 recentContacts(t){return this.query('SELECT * FROM decisions WHERE scope=? ORDER BY at DESC LIMIT 10',[targetKey(t)]);}
 cleanup(now,days){const cutoff=new Date(now-days*86400000).toISOString();this.db.run("DELETE FROM clues WHERE expires_at<=? OR updated<?",[now.toISOString(),cutoff]);this.db.run('DELETE FROM conversation_events WHERE at<?',[cutoff]);this.db.run('DELETE FROM observed_sources WHERE at<?',[cutoff]);this.db.run('DELETE FROM decisions WHERE at<?',[cutoff]);this.db.run('DELETE FROM contact_ledger WHERE at<?',[new Date(now-168*3600000).toISOString()]);this.save();}
 view(t){return {sources:this.query('SELECT source,sender,name,text,at FROM conversation_events WHERE scope=? ORDER BY seq DESC LIMIT 200',[targetKey(t)]),clues:this.clues(t).filter(c=>c.status!=='deleted'),decisions:this.recentContacts(t),pending:this.pendingRange(t),state:this.state(t)};}
}
