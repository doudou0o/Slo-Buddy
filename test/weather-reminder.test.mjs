import test from 'node:test';import assert from 'node:assert/strict';import {weatherReminder,runWeatherReminder} from '../src/weather-reminder.mjs';
const weather={city:'上海',latitude:31.23,longitude:121.47,windKmh:38.9,gustKmh:61.9};
const forecast=(code=0,speed=0,gust=0)=>async()=>({ok:true,json:async()=>({hourly:{time:['2026-10-18T08:00'],weather_code:[code],precipitation_probability:[code===61?95:0],precipitation:[0],snowfall:[0],wind_speed_10m:[speed],wind_gusts_10m:[gust]},daily:{temperature_2m_min:[15],temperature_2m_max:[20]}})});
test('clear weather skips delivery; preview is explicitly marked',async()=>{assert.equal((await weatherReminder(weather,{fetchImpl:forecast()})).send,false);assert.match(JSON.stringify((await weatherReminder(weather,{fetchImpl:forecast(),preview:true})).card),/测试/);});
test('rain, snow and wind each trigger a reminder',async()=>{for(const [code,speed,gust,expected]of [[61,0,0,'雨'],[73,0,0,'雪'],[0,39,0,'大风'],[0,0,62,'大风']])assert.ok((await weatherReminder(weather,{fetchImpl:forecast(code,speed,gust)})).hazards.includes(expected));});
test('test delivery uses only the test chat and normal delivery skips clear days',async()=>{let calls=0;const api={request:async(route,{body})=>{calls++;assert.equal(body.receive_id,'test');return {message_id:'sent'};}};const job={weather,chatId:'real',testChatId:'test'};await runWeatherReminder(job,api,{preview:true,fetchImpl:forecast()});assert.equal(calls,1);await runWeatherReminder(job,api,{fetchImpl:forecast()});assert.equal(calls,1);});
test('daily greeting supports actual mentions and an illustration without source footer',async()=>{const r=await weatherReminder({...weather,dailyGreeting:true,imageKey:'img'},{fetchImpl:forecast(),mentions:['ou_june','ou_leo']});assert.equal(r.send,true);assert.equal(r.card.elements[0].tag,'img');const text=JSON.stringify(r.card);assert.match(text,/<at id=\\"ou_june/);assert.ok(!text.includes('Open-Meteo'));assert.ok(!text.includes('居家工作'));});
test('severe wind suggests staying home without claiming a typhoon warning',async()=>{const r=await weatherReminder(weather,{fetchImpl:forecast(0,65,90)});assert.equal(r.severe,true);assert.match(JSON.stringify(r.card),/居家工作/);assert.equal(r.card.header.template,'red');});
test('daily generation failure still sends weather and safety card to production only',async()=>{
 let attempts=0,calls=0;const api={request:async(route,{body})=>{calls++;assert.equal(body.receive_id,'production');return {message_id:'sent'};}};
 const result=await runWeatherReminder({id:'test',weather:{...weather,generateDailyImage:true},chatId:'production',testChatId:'test'},api,{fetchImpl:forecast(61),generate:async prompt=>{attempts++;assert.match(prompt,/雨/);throw Error('generation unavailable');}});
 assert.equal(attempts,1);assert.equal(calls,1);assert.equal(result.imageStatus,'fallback');
});
test('generated image is uploaded and replaces static artwork before sending',async t=>{
 const fs=await import('node:fs');const path=await import('node:path');const {root}=await import('../src/config.mjs');const file=path.join(root,'artifacts','weather-unit-'+Date.now()+'.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'image');t.after(()=>fs.rmSync(file,{force:true}));
 const routes=[];const api={request:async(route,{body})=>{routes.push(route);if(route==='/im/v1/images')return {image_key:'new-image'};const card=JSON.parse(body.content);assert.equal(card.elements.filter(e=>e.tag==='img').length,1);assert.equal(card.elements[0].img_key,'new-image');return {message_id:'sent'};}};
 const r=await runWeatherReminder({weather:{...weather,imageKey:'old',generateDailyImage:true},chatId:'real'},api,{fetchImpl:forecast(61),generate:async()=>file});assert.equal(r.imageStatus,'generated');assert.equal(routes.length,2);
});
test('rain requires strictly more than 90 percent; thunder triggers even without rain threshold',async()=>{
 for(const probability of [89,90,91]){const fetchImpl=async()=>{const r=await forecast(61)();const data=await r.json();data.hourly.precipitation_probability=[probability];return {ok:true,json:async()=>data};};assert.equal((await weatherReminder(weather,{fetchImpl})).send,probability>90);}
 const thunder=await weatherReminder(weather,{fetchImpl:forecast(95)});assert.ok(thunder.hazards.includes('雷暴'));assert.equal(thunder.severe,true);
});
test('air quality triggers independently; failed air data never implies clear air',async()=>{
 const fetchImpl=async url=>url.includes('air-quality')?{ok:true,json:async()=>({hourly:{time:['2026-10-18T08:00'],us_aqi:[251],pm2_5:[150]}})}:forecast()();
 const result=await weatherReminder({...weather,airQuality:true},{fetchImpl});assert.ok(result.hazards.includes('重污染'));assert.ok(result.hazards.includes('霾风险'));assert.equal(result.severe,false);
 await assert.rejects(()=>weatherReminder({...weather,airQuality:true},{fetchImpl:async url=>url.includes('air-quality')?{ok:false,status:503}:forecast()()}),/空气质量查询失败/);
});
test('weather query retries temporary 503 but never retries permanent 400',async()=>{const {fetchWeatherJson}=await import('../src/weather-reminder.mjs');let calls=0;const r=await fetchWeatherJson('test',{sleep:async()=>{},fetchImpl:async()=>++calls<3?{ok:false,status:503}:{ok:true,json:async()=>({ok:true})}});assert.equal(calls,3);assert.equal(r.ok,true);calls=0;await assert.rejects(()=>fetchWeatherJson('test',{sleep:async()=>{},fetchImpl:async()=>{calls++;return {ok:false,status:400};}}),/400/);assert.equal(calls,1);});

test('raised air thresholds work independently at 6am and moderate pollution skips',async()=>{
 for(const [aqi,pm,expected] of [[220,80,false],[250,149,false],[251,10,true],[10,150,true]]){
 const fetchImpl=async url=>url.includes('air-quality')?{ok:true,json:async()=>({hourly:{time:['2026-10-18T06:00'],us_aqi:[aqi],pm2_5:[pm]}})}:forecast()();
 assert.equal((await weatherReminder({...weather,airQuality:true},{fetchImpl})).send,expected);
 }
});
