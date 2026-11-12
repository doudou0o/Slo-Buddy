// Verification failure must never turn a successful write into a retryable write failure.
export async function executeTaskTool({name,args,run,api,record=async()=>{},id}){
 await record({id,name,status:'started'});
 let result;
 try{result=await run(args);}catch(error){try{await record({id,name,status:'failed'});}catch{}throw error;}
 let verification=['verified','unverified'].includes(result?.verification)?result.verification:'not_checked';
 if(['create_document','append_document','send_attachment'].includes(name)){
  verification='unverified';
  try{
   if(name==='create_document'){const doc=await api.readDocument(result.document_id);if(doc.document_id===result.document_id)verification='verified';}
   if(name==='append_document'){const doc=await api.readDocument(args.document);if(doc.content.includes(args.text))verification='verified';}
   if(name==='send_attachment'){const d=await api.request('/im/v1/messages/'+encodeURIComponent(result.message_id));if(d.items?.some(m=>m.message_id===result.message_id&&!m.deleted))verification='verified';}
  }catch{/* Preserve the successful write receipt; do not repeat the action. */}
 }
 // After a successful side effect, returning its receipt takes priority over telemetry availability.
 try{await record({id,name,status:'succeeded',refs:Object.fromEntries(['document_id','message_id','block_id'].filter(k=>typeof result?.[k]==='string').map(k=>[k,result[k]])),verification});}catch{}
 return verification==='not_checked'?result:{...result,verification};
}
