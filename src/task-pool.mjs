// Independent chats can run concurrently; the same app/chat stays serialized.
export class TaskPool {
 constructor(limit=3){this.limit=limit;this.active=0;this.waiters=[];this.tails=new Map();}
 run(key,fn,signal){
  const previous=this.tails.get(key)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
   signal?.throwIfAborted();await this.acquire(signal);
   try{signal?.throwIfAborted();return await fn();}finally{this.active--;this.pump();}
  });
  this.tails.set(key,work);work.finally(()=>{if(this.tails.get(key)===work)this.tails.delete(key);}).catch(()=>{});return work;
 }
 acquire(signal){if(this.active<this.limit){this.active++;return Promise.resolve();}return new Promise((resolve,reject)=>{const waiter={resolve,reject,signal};waiter.abort=()=>{const i=this.waiters.indexOf(waiter);if(i>=0)this.waiters.splice(i,1);reject(signal.reason);};signal?.addEventListener('abort',waiter.abort,{once:true});this.waiters.push(waiter);if(signal?.aborted)waiter.abort();});}
 pump(){while(this.active<this.limit&&this.waiters.length){const w=this.waiters.shift();w.signal?.removeEventListener('abort',w.abort);if(w.signal?.aborted){w.reject(w.signal.reason);continue;}this.active++;w.resolve();}}
 async drain(){await Promise.allSettled([...this.tails.values()]);}
}
