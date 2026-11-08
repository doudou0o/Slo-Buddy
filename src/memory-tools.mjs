export function memoryAction(memory,context,action,args){
 const {scope,owner,sourceId,senderId}=context;
 if(action==='search')return memory.retrieve(scope,String(args.query||'').slice(0,2000));
 if(action==='save'){
  if(!Array.isArray(args.facts)||!args.facts.length||args.facts.length>10)throw Error('每次保存1至10条事实');
  const target={...scope};if(args.group_public){if(scope.type!=='group')throw Error('私聊不能保存到群');target.topic='';}
  const entries=args.facts.map(content=>{if(typeof content!=='string'||!content.trim()||content.length>4000)throw Error('每条事实须为1至4000字');return content.trim();});
  return {saved:true,status:owner?'confirmed':'candidate',scope:target,entries:entries.map(content=>memory.add(target,{content,sourceId,senderId,status:owner?'confirmed':'candidate'}))};
 }
 if(!owner)throw Error('只有已配对所有者可以修改或删除已确认记忆');
 const row=memory.get(args.id);if(row.app!==scope.app||row.chat!==scope.chat||row.type!==scope.type||row.user!==scope.user||!(row.topic===scope.topic||(scope.type==='group'&&!row.topic)))throw Error('记忆不属于当前允许范围');
 if(row.kind!=='fact')throw Error('对话工具只能操作事实记忆');
 if(action==='update')return {updated:true,entry:memory.update(row.id,{content:args.content})};
 if(action==='forget')return {forgotten:true,id:memory.update(row.id,{status:'deleted'}).id};
 throw Error('未知记忆操作');
}
