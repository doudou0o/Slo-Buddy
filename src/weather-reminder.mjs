import fs from 'node:fs';
import {generateImage} from './image-worker.mjs';
import {outputFile} from './feishu.mjs';
import {root} from './config.mjs';
import crypto from 'node:crypto';
import {weatherFetch} from './weather-network.mjs';
import {buildCard} from './cards.mjs';
export async function fetchWeatherJson(url,{fetchImpl=weatherFetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetchImpl(url,{signal:AbortSignal.timeout(20000)});if(!response.ok){const error=new Error('天气查询失败 HTTP='+response.status);error.retryable=response.status===429||response.status>=500;throw error;}return await response.json();}
  catch(error){if(error.retryable===false||attempt===2)throw error;console.error(JSON.stringify({event:'weather_query_retry',attempt:attempt+1,error:error.message}));await sleep(1000*(attempt+1));}
 }
}
export async function weatherReminder(weather,{fetchImpl=weatherFetch,preview=false,mentions=[]}={}) {
 const query=new URLSearchParams({latitude:String(weather.latitude),longitude:String(weather.longitude),hourly:'weather_code,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m,temperature_2m',daily:'temperature_2m_max,temperature_2m_min',wind_speed_unit:'kmh',timezone:'Asia/Shanghai',forecast_days:'1'});
 const data=await fetchWeatherJson('https://api.open-meteo.com/v1/forecast?'+query,{fetchImpl}),h=data.hourly;
 if(!h?.time?.length||!Array.isArray(h.weather_code)||!Array.isArray(h.precipitation_probability)||!Array.isArray(h.wind_speed_10m)||!Array.isArray(h.wind_gusts_10m)||!Array.isArray(h.precipitation)||!Array.isArray(h.snowfall))throw Error('天气数据不完整，未发送');
 const snowCodes=new Set([71,73,75,77,85,86]);
 let air=null;let airError='';
 if(weather.airQuality){try{const q=new URLSearchParams({latitude:String(weather.latitude),longitude:String(weather.longitude),hourly:'us_aqi,pm2_5',timezone:'Asia/Shanghai',forecast_days:'1'});air=(await fetchWeatherJson('https://air-quality-api.open-meteo.com/v1/air-quality?'+q,{fetchImpl})).hourly;if(!air?.time?.length||!Array.isArray(air.us_aqi)||!Array.isArray(air.pm2_5))throw Error('空气质量数据不完整');}catch(e){airError=e.message;console.error(JSON.stringify({event:'weather_air_quality_failed',error:airError}));}}
 const rain=[],snow=[],wind=[],thunder=[],hail=[];let severe=false;
 h.time.forEach((time,i)=>{const hour=Number(time.slice(11,13));if(hour<6||hour>23)return;if(h.wind_speed_10m[i]>=62||h.wind_gusts_10m[i]>=89||h.precipitation[i]>=20||h.snowfall[i]>=2||[95,96,99].includes(h.weather_code[i]))severe=true;if(snowCodes.has(h.weather_code[i])||h.snowfall[i]>0)snow.push(time);else if((h.precipitation_probability?.[i]??0)>90)rain.push(time);if([95,96,99].includes(h.weather_code[i]))thunder.push(time);if([96,99].includes(h.weather_code[i]))hail.push(time);if(h.wind_speed_10m[i]>=weather.windKmh||h.wind_gusts_10m[i]>=weather.gustKmh)wind.push(time);});
 const airRows=(air?.time||[]).map((time,i)=>({time,aqi:air.us_aqi[i],pm:air.pm2_5[i]})).filter(r=>r.time.slice(0,10)===h.time[0].slice(0,10)&&Number(r.time.slice(11,13))>=6&&Number(r.time.slice(11,13))<=23);
 const pollution=airRows.some(r=>Number.isFinite(r.aqi)&&r.aqi>=251),haze=airRows.some(r=>Number.isFinite(r.pm)&&r.pm>=150);
 const hazards=[rain.length?'雨':null,snow.length?'雪':null,wind.length?'大风':null,thunder.length?'雷暴':null,hail.length?'冰雹':null,haze?'霾风险':null,pollution?'重污染':null].filter(Boolean);
 if(airError&&!hazards.length)throw Error('空气质量查询失败，不能确认是否需要提醒：'+airError);
 if(!hazards.length&&!preview&&!weather.dailyGreeting)return {send:false,reason:'今天06:00—23:00未达到天气或空气质量提醒条件'};
 const hours=times=>[...new Set(times.map(t=>t.slice(11,16)))].join('、');
 const details=[rain.length?'🌧️ **可能下雨**：'+hours(rain):'',snow.length?'❄️ **可能下雪**：'+hours(snow):'',wind.length?'💨 **大风时段**：'+hours(wind):'',thunder.length?'⛈️ **雷暴时段**：'+hours(thunder):'',hail.length?'🧊 **冰雹风险时段**：'+hours(hail):'',haze?'😷 **颗粒物偏高，存在霾风险**（PM2.5 预报 ≥150 μg/m³）':'',pollution?'😷 **重污染提醒**（US AQI 预报 ≥251，非中国 AQI）':'',airError?'空气质量暂未取得，本卡片仅依据天气预报。':''].filter(Boolean);
 if(!hazards.length)details.push('🌤️ 今天没有明显雨雪或大风，安心开启新的一天。');
 const tips=[(haze||pollution)?'空气不佳，减少户外运动；出门留意防护。':'',rain.length?'出门记得带伞，路滑慢些走。':'',snow.length?'注意保暖和路面结冰。':'',wind.length?'留意高空坠物，收好阳台物品。':''].filter(Boolean).join('');
 const greetings=['慢慢来，也能走得很远。今天也一起加油呀 🦥',(rain.length?'把伞带上，把好心情也带上。':'把好心情带上。')+'今天的你们也很棒 🌿','不必一早就满格，先吃好早餐，再一点点发光 ☀️'];
 const encouragement=severe?'⚠️ 预报有恶劣天气风险。条件允许的话，建议居家工作，减少不必要的外出；留意当地官方预警，安全第一。':greetings[Number(h.time[0].slice(8,10))%greetings.length];
 const ats=mentions.map(id=>'<at id="'+id+'"></at>').join(' ');
 const body=['**'+weather.city+' · '+h.time[0].slice(0,10)+'**','今日气温：'+data.daily?.temperature_2m_min?.[0]+'～'+data.daily?.temperature_2m_max?.[0]+' °C',...details,tips,encouragement,ats,preview?'🧪 **测试预览：仅发送到「我的测试」**':''].filter(Boolean).join('\n\n');
 const card=buildCard({title:(preview?'【测试】':'')+'Slo 的早间天气提醒'+(hazards.length?' · '+hazards.join(' / '):''),body},crypto.randomUUID());card.header.template=severe?'red':hazards.length?'orange':'green';if(weather.imageKey)card.elements.unshift({tag:'img',img_key:weather.imageKey,alt:{tag:'plain_text',content:'Slo 的天气早安插画'},mode:'fit_horizontal',preview:false});
 return {send:true,card,hazards,severe};
}
export async function runWeatherReminder(job,api,options={}) {
 const result=await weatherReminder(job.weather,{...options,mentions:job.mentions||[]});
 if(!result.send)return result;
 let imageStatus='static';
 if(job.weather.generateDailyImage){
  try{
   const prompt='画一张简洁温暖的横幅天气插画，用于早间飞书卡片。奶油白底、水彩、低饱和鼠尾草绿和浅蓝色，可爱棕色树懒。地点：'+job.weather.city+'。当天预报：'+(result.hazards.join('、')||'没有明显雨雪或大风')+'。'+(result.severe?'恶劣天气，树懒在温暖室内安全地工作，窗外表现对应的风雨雪。':(result.hazards.includes('霾风险')||result.hazards.includes('重污染'))?'树懒在室内，窗外轻微灰蒙，表现空气不佳，不夸张灾难。':result.hazards.includes('雪')?'表现轻柔雪花、围巾和保暖。':result.hazards.includes('雨')?'树懒撑伞，少量雨滴。':result.hazards.includes('大风')?'表现风吹树叶，树懒在室内喝热茶。':'表现平静舒适的早晨，树懒给伙伴加油。')+'不要文字、数字、图表或水印。不添加预报未提及的极端天气。';
   const file=await (options.generate||generateImage)(prompt,{signal:AbortSignal.timeout(180000)});
   const form=new FormData();form.set('image_type','message');form.set('image',new Blob([fs.readFileSync(outputFile(root,file))]),'weather.png');
   const uploaded=await api.request('/im/v1/images',{method:'POST',body:form});if(!uploaded.image_key)throw Error('图片上传未返回标识');
   result.card.elements=result.card.elements.filter(e=>e.tag!=='img');
   result.card.elements.unshift({tag:'img',img_key:uploaded.image_key,alt:{tag:'plain_text',content:'当天预报的天气插画'},mode:'fit_horizontal',preview:false});imageStatus='generated';
  }catch(error){imageStatus='fallback';console.error(JSON.stringify({event:'weather_image_failed',job:job.id,error:error.message}));}
 }
 const sent=await api.request('/im/v1/messages?receive_id_type=chat_id',{method:'POST',body:{receive_id:options.preview?job.testChatId:job.chatId,msg_type:'interactive',content:JSON.stringify(result.card),uuid:crypto.randomUUID()}});
 return {send:true,message_id:sent.message_id,hazards:result.hazards,imageStatus};
}
