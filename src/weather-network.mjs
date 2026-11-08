import fs from 'node:fs';import path from 'node:path';import {fetch as networkFetch,ProxyAgent} from 'undici';import {root} from './config.mjs';
let dispatcher;
export async function weatherFetch(url,options={}){
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!['geocoding-api.open-meteo.com','api.open-meteo.com','air-quality-api.open-meteo.com','api.weather.gov','services3.arcgis.com'].includes(parsed.hostname))throw Error('天气工具仅访问指定天气服务');
 const file=path.join(root,'.private/network.json');const network=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};const proxy=network.HTTPS_PROXY||process.env.HTTPS_PROXY;
 if(proxy)dispatcher??=new ProxyAgent(proxy);
 return networkFetch(url,{...options,...(dispatcher?{dispatcher}:{}),redirect:'error'});
}
