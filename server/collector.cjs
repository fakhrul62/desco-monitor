require('./network.cjs');
const {request,chromium}=require('playwright-core');
const fs=require('node:fs');const path=require('node:path');const {dayKey,addDays,round}=require('./forecast.cjs');
const ORIGIN='https://prepaid.desco.org.bd';
function number(n){return n===null||n===''||n===undefined?null:Number.isFinite(Number(n))?Number(n):null;}
function localTime(value){if(!value)return null;const match=String(value).match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);return match?`${match[1]}T${match[2]||'00:00:00'}+06:00`:null;}
function dailyDeltas(raw){
 const rows=[...new Map(raw.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)).map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 return rows.map((r,i)=>{
   const prev=rows[i-1],consecutive=prev&&addDays(prev.date,1)===r.date;
   const taka=number(r.consumedTaka),previous=number(prev?.consumedTaka);
   let cost=null;
   if(taka!==null&&r.date.endsWith('-01'))cost=taka;
   else if(consecutive&&prev.date.slice(0,7)===r.date.slice(0,7)&&taka!==null&&previous!==null)cost=taka-previous;
   const unit=number(r.consumedUnit),prevUnit=number(prev?.consumedUnit);
   let kwh=consecutive&&unit!==null&&prevUnit!==null?unit-prevUnit:null;
   if(cost!==null&&cost<0)cost=null;if(kwh!==null&&kwh<0)kwh=null;
   return {date:r.date,cost:cost===null?null:round(cost),kwh:kwh===null?null:round(kwh),source:'DESCO reading difference',baseline:!prev,cumulativeCost:taka,cumulativeKwh:unit};
 });
}
function normalize(info,responses,previous=null,now=new Date()){
 const today=dayKey(now),month=today.slice(0,7);const warnings=[];
 for(const [key,r]of Object.entries(responses))if(r.error)warnings.push(`${key}: ${r.error}`);
 const balance=responses.balance?.data;
 const rawDaily=responses.daily?.data;
 const daily=Array.isArray(rawDaily)?dailyDeltas(rawDaily):previous?.daily||[];
 const currentDaily=Array.isArray(rawDaily)?rawDaily.filter(r=>r.date?.startsWith(month)).sort((a,b)=>a.date.localeCompare(b.date)):[];
 const latest=currentDaily.at(-1);
 const lastPrior=Array.isArray(rawDaily)?rawDaily.filter(r=>r.date?.startsWith(month)===false).sort((a,b)=>a.date.localeCompare(b.date)).at(-1):null;
 const units=latest&&lastPrior&&number(latest.consumedUnit)!==null&&number(lastPrior.consumedUnit)!==null?round(Number(latest.consumedUnit)-Number(lastPrior.consumedUnit)):null;
 const rawRecharge=responses.recharges?.data;
 const recharges=Array.isArray(rawRecharge)?rawRecharge.map(r=>({id:String(r.orderID||''),at:localTime(r.rechargeDate),amount:number(r.totalAmount),energy:number(r.energyAmount),vat:number(r.VAT),rebate:number(r.rebate),charges:(r.chargeItems||[]).map(c=>({name:c.chargeItemName,amount:number(c.chargeAmount)})),status:r.orderStatus||'Unknown',confirmed:/execution successful/i.test(r.orderStatus||'')})).sort((a,b)=>(b.at||'').localeCompare(a.at||'')):previous?.recharges||[];
 const rawMonthly=responses.monthly?.data;
 const monthly=Array.isArray(rawMonthly)?rawMonthly.map(r=>({month:r.month,cost:number(r.consumedTaka),kwh:number(r.consumedUnit)})).filter(r=>/^\d{4}-\d{2}$/.test(r.month)).sort((a,b)=>a.month.localeCompare(b.month)):previous?.monthly||[];
 if(!latest)warnings.push('Current-month daily consumption is unavailable. Previous usage may be shown with its original month.');
 return {account:String(info.accountNo),meter:String(info.meterNo),name:info.customerName||'',tariff:info.tariffSolution||'',area:info.SDName||'',load:number(info.sanctionLoad),fetchedAt:now.toISOString(),balance:balance?number(balance.balance):previous?.balance??null,balanceAt:balance?localTime(balance.readingTime):previous?.balanceAt||null,balanceTimeKnown:balance?Boolean(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(String(balance.readingTime||''))):previous?.balanceTimeKnown??false,balanceFetchedAt:balance?now.toISOString():previous?.balanceFetchedAt||null,usageMonth:latest?month:previous?.usageMonth||month,usageThrough:latest?.date||previous?.usageThrough||null,monthCost:latest?number(latest.consumedTaka):previous?.monthCost??null,monthKwh:latest?units:previous?.monthKwh??null,monthRecharged:round(recharges.filter(r=>r.at?.startsWith(month)).reduce((s,r)=>s+(r.amount||0),0)),yearRecharged:round(recharges.filter(r=>r.at?.startsWith(today.slice(0,4))).reduce((s,r)=>s+(r.amount||0),0)),monthly,daily,recharges,warnings,sections:Object.fromEntries(Object.entries(responses).map(([k,r])=>[k,{ok:!r.error,at:r.error?previous?.sections?.[k]?.at||null:now.toISOString()}]))};
}
class Collector{
 constructor(directory,browserPath,browserOptions){this.directory=directory;this.browserPath=browserPath;this.browserOptions=browserOptions;this.cancelled=false;}
 async collect(account,previous){
   this.cancelled=false;this.client=await request.newContext({baseURL:ORIGIN,timeout:45000,extraHTTPHeaders:{Referer:ORIGIN+'/customer/','Accept':'application/json'}});
   const query=account.length>10?{accountNo:'',meterNo:account}:{accountNo:account,meterNo:''};
   const get=async(platform,endpoint,params={})=>{
     if(this.page){const result=await this.page.evaluate(async ({url,params})=>{const u=new URL(url,location.origin);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u);return {status:r.status,json:await r.json()};},{url:`/api/${platform}/customer/${endpoint}`,params:{...query,...params}});if(result.status!==200)throw Error(`DESCO returned HTTP ${result.status}`);if(result.json.code!==200||result.json.data==null)throw Error(result.json.desc||'No account data returned');return result.json.data;}
     const response=await this.client.get(`/api/${platform}/customer/${endpoint}`,{params:{...query,...params}});
     if(!response.ok())throw Error(`DESCO returned HTTP ${response.status()}`);
     const json=await response.json();if(json.code!==200||json.data===null||json.data===undefined)throw Error(json.desc||'No account data returned');return json.data;
   };
   try{
     let platform='unified',info;
     try{info=await get('unified','getCustomerInfo');}catch{try{platform='tkdes';info=await get(platform,'getCustomerInfo');}catch{
       info=await this.browserFallback(account);platform=info.platform;info=info.info;
     }}
     if(!info?.accountNo||!info?.meterNo)throw Error('DESCO did not find that account or meter number. Please check the number.');
     query.accountNo=String(info.accountNo);query.meterNo='';
     const today=dayKey(),year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
     const monthFrom=`${year-2}-${String(month).padStart(2,'0')}`,monthTo=dayKey(new Date(Date.UTC(year,month-1,0))).slice(0,7);
     const definitions={balance:['getBalance',{}],daily:['getCustomerDailyConsumption',{dateFrom:addDays(today,-95),dateTo:addDays(today,-1)}],recharges:['getRechargeHistory',{dateFrom:addDays(today,-366),dateTo:today}],monthly:['getCustomerMonthlyConsumption',{monthFrom,monthTo}]};
     const entries=await Promise.all(Object.entries(definitions).map(async([key,[endpoint,params]])=>{try{return [key,{data:await get(platform,endpoint,params)}];}catch(error){return [key,{error:error.message}];}}));
     if(entries.every(([,r])=>r.error))throw Error('DESCO is unavailable. Your saved readings have been kept.');
     return normalize(info,Object.fromEntries(entries),previous);
   }finally{await this.client?.dispose().catch(()=>{});this.client=null;await this.browser?.close().catch(()=>{});this.browser=null;this.page=null;}
 }
 async browserFallback(account){
   if(this.browserOptions)this.browser=await chromium.launch({...await this.browserOptions(),headless:true});
   else{if(!fs.existsSync(this.browserPath))throw Error('The bundled background browser is missing. Reinstall Desco Monitor.');this.browser=await chromium.launch({executablePath:this.browserPath,headless:true});}
   const context=await this.browser.newContext();const page=await context.newPage();let result;const missing=new Set();let reportMissing;const missingResult=new Promise(resolve=>{reportMissing=resolve});
   page.on('response',async r=>{if(r.url().includes('/customer/getCustomerInfo')){try{const json=await r.json();const platform=r.url().includes('/tkdes/')?'tkdes':'unified';if(json.data?.accountNo)result={info:json.data,platform};else if([16001,16002].includes(Number(json.code))||/does not exist|does not exists/i.test(String(json.desc||''))){missing.add(platform);if(missing.size===2)reportMissing('missing');}}catch{}}});
   await page.goto(ORIGIN+'/customer/#/customer-login',{waitUntil:'domcontentloaded',timeout:90000});
   await page.getByPlaceholder('Account/Meter No').fill(account);await page.getByRole('button',{name:'Login',exact:true}).click();
   const outcome=await Promise.race([page.waitForURL('**/customer-info',{timeout:45000}).then(()=>'found'),missingResult]);
   if(outcome==='missing')throw Error('DESCO did not find that account or meter number. Please check the number.');
   await page.waitForLoadState('networkidle',{timeout:45000}).catch(()=>{});
   if(!result)throw Error('DESCO could not load this account. Try again in a few minutes.');
   this.page=page;return result;
 }
 async close(){await this.client?.dispose().catch(()=>{});await this.browser?.close().catch(()=>{});}
}
module.exports={Collector,normalize,dailyDeltas,localTime};
