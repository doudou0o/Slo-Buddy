export function formatResponse(text){
 const value=String(text).replace(/\*\*([^*]+?)\*\*/g,(_m,inner)=>'**'+inner.trim()+'**');const markdown=/\*\*|__|~~|`|\[[^\]]+\]\(https?:\/\/|^\s*(?:#{1,6} |[-*+] |\d+\. |> )/m.test(value);if(value.length<500&&!markdown)return {type:'text',content:{text:value}};
 return {type:'post',content:{zh_cn:{title:'',content:[value.split(/(<at user_id="[^"]+"><\/at>)/g).filter(Boolean).map(part=>{const m=part.match(/^<at user_id="([^"]+)"><\/at>$/);return m?{tag:'at',user_id:m[1]}:{tag:'md',text:part};})]}}};
}
