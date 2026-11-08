import {weatherFetch} from './weather-network.mjs';
import fs from 'node:fs';import path from 'node:path';import {localPath} from './policy.mjs';
export function listFiles(policy,directory='.',query=''){
 const start=localPath(policy,directory);if(!fs.statSync(start).isDirectory())throw Error('需要目录路径');
 const entries=[];let visited=0,truncated=false;
 const walk=(dir,depth)=>{if(depth>8){truncated=true;return;}for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(++visited>5000){truncated=true;return;}if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules'].includes(e.name))continue;const file=path.join(dir,e.name),relative=path.relative(start,file);if(e.isDirectory())walk(file,depth+1);else if(e.isFile()&&relative.toLowerCase().includes(query.toLowerCase())){entries.push(relative);if(entries.length>=200){truncated=true;return;}}if(truncated&&entries.length>=200)return;}};walk(start,0);return {directory,files:entries,truncated};
}
export function searchFiles(policy,query,directory='.'){
 if(!query||query.length>200)throw Error('查询文本须为1至200字');const listed=listFiles(policy,directory);const matches=[];let truncated=listed.truncated;
 for(const name of listed.files){const p=localPath(policy,path.join(directory,name));if(fs.statSync(p).size>200000)continue;const data=fs.readFileSync(p);if(data.includes(0))continue;const lines=data.toString('utf8').split('\n');for(let i=0;i<lines.length;i++)if(lines[i].toLowerCase().includes(query.toLowerCase())){matches.push({path:path.join(directory,name),line:i+1,text:lines[i].slice(0,500)});if(matches.length>=50){truncated=true;break;}}if(matches.length>=50)break;}
 return {matches,truncated};
}
export async function getWeather(city,days=3,fetchImpl=weatherFetch){
 const get=async url=>{const r=await fetchImpl(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('天气服务暂不可用 HTTP='+r.status);return r.json();};
 const locations=await get('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:city,count:'3',language:'zh',format:'json'}));const location=locations.results?.[0];if(!location)throw Error('没有找到城市，请提供更具体的地名或英文名');
 const result=await get('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),current:'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',timezone:'auto',forecast_days:String(days)}));
 return {source:'Open-Meteo',sourceUrl:'https://open-meteo.com/',location:{name:location.name,country:location.country,region:location.admin1,latitude:location.latitude,longitude:location.longitude},alternatives:locations.results?.slice(1).map(x=>({name:x.name,country:x.country,region:x.admin1})),...result};
}
