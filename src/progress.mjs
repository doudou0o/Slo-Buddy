export class ProgressReporter {
 constructor({send,log=()=>{},initialMs=30000,intervalMs=60000}){this.send=send;this.log=log;this.closed=false;this.stage='正在处理请求';this.sent=false;this.lastAt=0;this.chain=Promise.resolve();this.initial=setTimeout(()=>this.report('这项任务还在处理中，我会继续处理并反馈进展。'),initialMs);this.interval=setInterval(()=>{if(this.sent&&Date.now()-this.lastAt>=intervalMs)this.report(this.stage+'，任务尚未结束。');},intervalMs);}
 report(text){if(this.closed)return Promise.resolve({sent:false});this.stage=text;if(this.sent&&Date.now()-this.lastAt<20000)return Promise.resolve({sent:false,throttled:true});this.sent=true;this.lastAt=Date.now();clearTimeout(this.initial);this.chain=this.chain.then(()=>{if(!this.closed)return this.send(text).then(()=>({sent:true}));}).catch(e=>this.log('progress_send_failed',{error:e.message}));return this.chain;}
 update(stage){this.stage=stage;if(stage==='正在生成图片'){clearTimeout(this.initial);this.sent=true;this.lastAt=Date.now();}}
 async close(){this.closed=true;clearTimeout(this.initial);clearInterval(this.interval);await this.chain;}
}
