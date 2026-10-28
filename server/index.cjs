const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {Collector}=require('./collector.cjs');const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'../dist');const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
const browserCandidates=[process.env.CHROMIUM_PATH,chromium.executablePath(),process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),process.env['PROGRAMFILES(X86)']&&path.join(process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'),'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].filter(Boolean);
const browserPath=browserCandidates.find(p=>fs.existsSync(p))||'';let active=0;const calls=new Map();
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
function body(req){return new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){reject(Error('Request too large'));req.destroy();}else chunks.push(chunk)});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('Invalid request'))}});req.on('error',reject)});}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true});
 if(url.pathname==='/api/collect'&&req.method==='POST'){
  const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host)return json(res,403,{error:'Request origin is not allowed.'})}catch{return json(res,403,{error:'Request origin is not allowed.'})}}
  const ip=req.socket.remoteAddress||'unknown',now=Date.now();const recent=(calls.get(ip)||[]).filter(t=>now-t<60000);if(recent.length>=12)return json(res,429,{error:'Too many refreshes. Please try again shortly.'});recent.push(now);calls.set(ip,recent);if(calls.size>1000)for(const [key,ts] of calls)if(!ts.some(t=>now-t<60000))calls.delete(key);
  if(active>=4)return json(res,503,{error:'The monitor is busy. Please try again shortly.'});
  let input;try{input=await body(req)}catch{return !res.destroyed&&json(res,400,{error:'Invalid request.'})}if(!input||typeof input!=='object'||!/^\d{6,16}$/.test(input.account||''))return json(res,400,{error:'Enter an account or meter number with 6–16 digits.'});
  const previous=input.previous&&typeof input.previous==='object'?input.previous:null;active++;const collector=new Collector('',browserPath);
  try{const snapshot=await collector.collect(input.account,previous);return json(res,200,{snapshot});}catch(e){const message=String(e.message||'');return json(res,502,{error:/bundled background browser is missing/i.test(message)?'DESCO requires a background browser on the server. Install Chromium or set CHROMIUM_PATH.':/did not find|could not load|unavailable/i.test(message)?message:'Could not reach DESCO. Please retry; saved readings remain in this browser.'});}finally{active--;await collector.close().catch(()=>{});}
 }
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'Not found'});
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
 let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{return json(res,400,{error:'Invalid path'})};let file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))return json(res,403,{error:'Forbidden'});if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});
 const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
});server.listen(port,host,()=>console.log(`Desco Monitor: http://${host}:${port}`));
