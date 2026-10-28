const DAY=86400000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round(n*100)/100;
function dayKey(d=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function dateAt(key){return new Date(key+'T00:00:00+06:00');}
function addDays(key,n){return dayKey(new Date(dateAt(key).getTime()+n*DAY));}
function mean(a){return a.length?a.reduce((a,b)=>a+b,0)/a.length:null;}
function forecast(snapshot,settings={},now=new Date()){
 if(!snapshot)return null;
 const today=dayKey(now),month=today.slice(0,7),d=Number(today.slice(8)),daysInMonth=new Date(Number(today.slice(0,4)),Number(today.slice(5,7)),0).getDate();
 const daily=(snapshot.daily||[]).filter(x=>x.date<today&&finite(x.cost)&&x.cost>=0).sort((a,b)=>a.date.localeCompare(b.date));
 const recent=daily.slice(-14);const recentMean=mean(recent.map(x=>x.cost));
 const monthly=(snapshot.monthly||[]).filter(x=>finite(x.cost)&&x.cost>0).sort((a,b)=>a.month.localeCompare(b.month));
 const last=monthly.at(-1);const lastRate=last?last.cost/new Date(Number(last.month.slice(0,4)),Number(last.month.slice(5,7)),0).getDate():null;
 const currentIsCurrent=snapshot.usageMonth===month;
 const readingDay=snapshot.balanceAt?dayKey(new Date(snapshot.balanceAt)):null;
 const usageDay=snapshot.usageThrough?.startsWith(month)?Number(snapshot.usageThrough.slice(8)):null;
 const elapsed=currentIsCurrent?(usageDay??(readingDay?.startsWith(month)?Math.max(0,Number(readingDay.slice(8))-1):0)):0;
 const currentRate=elapsed>=3&&finite(snapshot.monthCost)&&snapshot.monthCost>0?snapshot.monthCost/elapsed:null;
 const seasonal=monthly.find(x=>x.month===`${Number(today.slice(0,4))-1}-${today.slice(5,7)}`);
 const rates=[];
 if(finite(recentMean)&&recent.length>=3)rates.push([recentMean,0.6]);
 if(finite(currentRate))rates.push([currentRate,0.3]);
 if(finite(lastRate))rates.push([lastRate,0.1]);
 if(finite(seasonal?.cost))rates.push([seasonal.cost/new Date(Number(seasonal.month.slice(0,4)),Number(seasonal.month.slice(5,7)),0).getDate(),0.08]);
 const weight=rates.reduce((s,x)=>s+x[1],0);
 const dailyRate=weight?rates.reduce((s,x)=>s+x[0]*x[1],0)/weight:null;
 if(!finite(dailyRate)||dailyRate<=0)return {available:false,reason:'Waiting for enough positive usage readings to make a forecast.'};
 const deviation=recent.length>=3?Math.sqrt(mean(recent.map(x=>(x.cost-recentMean)**2))):dailyRate*0.25;
 const spread=Math.min(0.6,Math.max(0.15,deviation/dailyRate));
 const lowRate=dailyRate*(1-spread),highRate=dailyRate*(1+spread);
 const readingTime=snapshot.balanceAt?new Date(snapshot.balanceAt).getTime():NaN;
 const ageDays=Number.isFinite(readingTime)?Math.max(0,(now.getTime()-readingTime)/DAY):null;
 const delivered=(snapshot.recharges||[]).filter(x=>x.confirmed&&x.at&&new Date(x.at).getTime()>readingTime&&new Date(x.at)<=now);
 const pending=(snapshot.recharges||[]).filter(x=>!x.confirmed&&x.at&&new Date(x.at).getTime()>readingTime&&new Date(x.at)<=now);
 const deliveredCredit=delivered.reduce((s,r)=>s+(r.energy||0),0),pendingCredit=pending.reduce((s,r)=>s+(r.energy||0),0);
 const estimatedBalance=finite(snapshot.balance)&&ageDays!==null?round(snapshot.balance+deliveredCredit-dailyRate*ageDays):null;
 const includePending=Boolean(settings.includePending);
 const base=estimatedBalance===null?null:estimatedBalance+(includePending?pendingCredit:0);
 const netRatios=(snapshot.recharges||[]).filter(r=>r.amount>0&&r.energy>0&&r.energy/r.amount>0.9&&r.energy/r.amount<=1).map(r=>r.energy/r.amount);
 const creditRatio=mean(netRatios)||0.95;
 const fixed=finite(settings.monthlyFixed)?Math.max(0,settings.monthlyFixed):208;
 const rateForDate=key=>{const m=key.slice(0,7);if(m===month)return dailyRate;const prior=monthly.find(x=>x.month===`${Number(m.slice(0,4))-1}-${m.slice(5,7)}`);if(!prior)return dailyRate;const days=new Date(Number(prior.month.slice(0,4)),Number(prior.month.slice(5,7)),0).getDate();return dailyRate*0.7+(prior.cost/days)*0.3;};
 const upcomingMonths=Array.from({length:6},(_,i)=>{const dt=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+i+1,1));const key=dt.toISOString().slice(0,7),days=new Date(dt.getUTCFullYear(),dt.getUTCMonth()+1,0).getDate(),prior=monthly.find(x=>x.month===`${dt.getUTCFullYear()-1}-${key.slice(5)}`);return {month:key,cost:round(rateForDate(key+'-01')*days),dailyRate:round(rateForDate(key+'-01')),seasonal:!!prior};});
 const bufferDays=Math.max(0,Math.min(30,Number(settings.bufferDays)||0));

 function costsThrough(target,rate){
   const targetTime=dateAt(target).getTime()+DAY;
   const span=Math.max(0,(targetTime-now.getTime())/DAY);
   let fees=0;for(let i=1;i<=Math.ceil(span);i++){const key=addDays(today,i);if(key<=target&&key.endsWith('-01'))fees+=fixed;}
   let usage=0;for(let i=0;i<Math.ceil(span)+1;i++){const key=addDays(today,i),start=Math.max(now.getTime(),dateAt(key).getTime()),end=Math.min(targetTime,dateAt(addDays(key,1)).getTime());if(end>start)usage+=rateForDate(key)*(rate/dailyRate)*(end-start)/DAY;}
   return usage+fees;
 }
 function runway(balance,rate){
   if(balance===null)return {days:null,date:null};
   let funds=balance;if(funds<=0)return {days:0,date:today};
   for(let i=0;i<1095;i++){
     const key=addDays(today,i);if(i>0&&key.endsWith('-01'))funds-=fixed;
     const fraction=i===0?(dateAt(addDays(today,1)).getTime()-now.getTime())/DAY:1;
     const dayRate=rateForDate(key)*(rate/dailyRate);const expense=dayRate*fraction;
     if(funds<=expense){const remaining=Math.max(0,funds/dayRate);return {days:round(Math.max(0,i===0?remaining:((dateAt(key).getTime()-now.getTime())/DAY)+remaining)),date:key};}
     funds-=expense;
   }
   return {days:1095,date:null,capped:true};
 }
 const monthEnd=`${month}-${String(daysInMonth).padStart(2,'0')}`;
 const throughEnd=costsThrough(monthEnd,dailyRate);
 const projection=[];let funds=base;
 for(let i=0;i<45;i++){const date=addDays(today,i);if(funds!==null){if(i>0&&date.endsWith('-01'))funds-=fixed;funds-=rateForDate(date)*(i===0?(dateAt(addDays(today,1)).getTime()-now.getTime())/DAY:1);}projection.push({date,balance:funds===null?null:round(funds),cost:round(dailyRate)});}
 const amount=Math.max(0,Number(settings.simAmount)||0),target=/^\d{4}-\d{2}-\d{2}$/.test(settings.targetDate||'')?settings.targetDate:monthEnd;
 const need=base===null?null:Math.max(0,costsThrough(target,dailyRate)-base);
 const currentUsage=currentIsCurrent&&finite(snapshot.monthCost)?snapshot.monthCost:null;
 const gapSinceReading=snapshot.usageThrough?.startsWith(month)?Math.max(0,(now.getTime()-(dateAt(snapshot.usageThrough).getTime()+DAY))/DAY):(ageDays===null?0:Math.min(ageDays,Math.max(0,(now-dateAt(month+'-01'))/DAY)));
 const monthForecast=currentUsage===null?dailyRate*daysInMonth:currentUsage+dailyRate*gapSinceReading+throughEnd;
 const recommendTarget=addDays(monthEnd,bufferDays),recommendCosts=costsThrough(recommendTarget,dailyRate),recommendFees=costsThrough(recommendTarget,0);
 const planDays=Math.max(0,(dateAt(target).getTime()+DAY-now)/DAY);
 const targetFees=costsThrough(target,0);
 return {available:true,dailyRate:round(dailyRate),lowRate:round(lowRate),highRate:round(highRate),basis:recent.length>=3?`${recent.length} recent daily readings, monthly usage and seasonal history`:'Monthly usage and available seasonal history',confidence:recent.length>=7&&ageDays!==null&&ageDays<2?'Moderate':'Limited',ageDays,estimatedBalance,planningBalance:base===null?null:round(base),pendingCredit:round(pendingCredit),deliveredCredit:round(deliveredCredit),includePending,runway:runway(base,dailyRate),runwayLow:runway(base,highRate),runwayHigh:runway(base,lowRate),monthForecast:round(monthForecast),monthLow:round(monthForecast*(1-spread)),monthHigh:round(monthForecast*(1+spread)),monthEnd,monthRecharge:base===null?null:round(Math.max(0,throughEnd-base)/creditRatio),creditRatio:round(creditRatio*100)/100,monthlyFixed:fixed,upcomingMonths,recommendation:{target:recommendTarget,bufferDays,usage:round(recommendCosts-recommendFees),fees:round(recommendFees),balance:base===null?null:round(base),creditRatio:round(creditRatio*100)/100,amount:base===null?null:round(Math.max(0,recommendCosts-base)/creditRatio),by:runway(base,dailyRate).date},projection,simulation:{amount,energyCredit:round(amount*creditRatio),...runway(base===null?null:base+amount*creditRatio,dailyRate)},target:{date:target,cost:round(costsThrough(target,dailyRate)),recharge:need===null?null:round(need/creditRatio),dailyBudget:base===null||planDays<=0?null:round(Math.max(0,(base-targetFees)/planDays))}};
}
module.exports={forecast,dayKey,addDays,round};
