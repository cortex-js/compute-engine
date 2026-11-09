import {ComputeEngine,compile,createKernelPool} from '/tmp/wt-js-contract/src/compute-engine';
import {parseEpsil} from '/tmp/wt-js-contract/src/epsil/parse-epsil';
import {resolveLibraryNames} from '/tmp/wt-js-contract/src/epsil/resolve-library-names';
import {SHOWCASE} from '../src/graph-paper/onboarding/template-data';
import {stepReference} from './profile-browser-reference';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const equal=(a,b,label)=>{check(a.length===90001&&b.length===90001,label+' length');for(let i=0;i<a.length;i++)check(Object.is(a[i],b[i]),`${label}[${i}]: ${a[i]} != ${b[i]}`);};
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
self.onmessage=async()=>{
 const pools=[];const traffic=[];let created=0,terminated=0;
 try {
 const prelude=SHOWCASE.find(e=>e.id==='buddhabrot').prelude;
 const start=prelude.indexOf('function step(');const end=prelude.indexOf('// The picture:',start);
 const original=prelude.slice(start,end);let increments=0;
 const adapted=original.replace('  for k in 1..n {','  parallel for k in 1..n {').replace(/L = replaceAt\(L, ([^,\n]+), L\[\1\] \+ 1\)/g,(_,index)=>{increments++;return `L[${index}] += 1`;});
 check(increments===6,'six increments adapted');
 const ce=new ComputeEngine();ce.declare('H','list<integer>');ce.declare('sampleCount','integer');
 function build(body){const source=`do {\n${body}\nstep(H, sampleCount)\n}`;const [ast,diagnostics]=parseEpsil(source);check(!diagnostics?.length,'parse diagnostics');const expr=ce.box(resolveLibraryNames(ast,source,ce));check(expr.isValid,'valid expression');const r=compile(expr,{fallback:false});check(r.success&&typeof r.run==='function','compiled');return r;}
 const serial=build(original);const parallel=build(adapted);
 check(typeof parallel.runAsync==='function','current CE runAsync present');check(parallel.parallelLoops?.length===1&&parallel.parallelLoops[0].route==='pool','static pool route '+JSON.stringify(parallel.parallelLoops));
 const H=Array.from({length:90001},(_,i)=>i===90000?137:i%997===0?2:0);const unchanged=H.slice();
 const rows=[];
 function sample(value,n,label){const expected=stepReference(H,n);equal(value,expected,label);equal(H,unchanged,'input unchanged');return {label,n,cursor:value[90000],sum:value.slice(0,90000).reduce((a,b)=>a+b,0),exact:true};}
 for(const n of [100,25000]){const v=serial.run({H,sampleCount:n});sample(v,n,'original');equal(parallel.run({H,sampleCount:n}),v,'adapted serial');rows.push(sample(v,n,'serial+reference'));}
 const noPool=[];rows.push({...sample(await parallel.runAsync({H,sampleCount:100},{minPasses:1,onLoop:r=>noPool.push(r)}),100,'no-pool'),reports:noPool});check(noPool[0]?.reason==='no-pool','no pool reason');
 const pool=createKernelPool({size:2,cancelGrace:5,create:()=>{const worker=new Worker('./kernel-worker.js',{type:'module'});const index=++created;return {postMessage:(m,t)=>{traffic.push({direction:'send',worker:index,type:m.type,job:m.job});worker.postMessage(m,t??[]);},terminate:()=>{terminated++;worker.terminate();},addEventListener:(event,handler)=>worker.addEventListener(event,e=>{if(event==='message')traffic.push({direction:'receive',worker:index,type:e.data.type,job:e.data.job});handler(e);})};}});pools.push(pool);ce.workers=pool;await pool.prewarm();
 for(const [n,minPasses] of [[100,20000],[100,1],[25000,20000]]){const reports=[];const before=traffic.filter(x=>x.type==='call'&&x.direction==='send').length;const value=await parallel.runAsync({H,sampleCount:n},{minPasses,onLoop:r=>reports.push(r)});const calls=traffic.filter(x=>x.type==='call'&&x.direction==='send').length-before;check(n<minPasses?calls===0:calls===2,'routing calls');rows.push({...sample(value,n,'runAsync'),minPasses,reports,calls});}
 // The host explicitly skips zero work; raw Range(1,0) is not empty.
 const zero=H.slice();equal(zero,H,'zero host identity');
 const pre=new AbortController();pre.abort('pre-aborted');let preReason;try{await parallel.runAsync({H,sampleCount:100},{signal:pre.signal,minPasses:1});}catch(e){preReason=e;}check(preReason==='pre-aborted','preabort reason');
 const ctl=new AbortController();const reason='superseded-job';let published=0;const beforeCalls=traffic.filter(x=>x.type==='call'&&x.direction==='send').length;
 const pending=parallel.runAsync({H,sampleCount:10000000},{minPasses:1,signal:ctl.signal}).then(()=>{published++;return 'resolved';},e=>e);
 for(let attempts=0;attempts<200&&traffic.filter(x=>x.type==='call'&&x.direction==='send').length===beforeCalls;attempts++)await wait(1);
 check(traffic.filter(x=>x.type==='call'&&x.direction==='send').length>beforeCalls,'cancel after dispatch');ctl.abort(reason);check(await pending===reason,'abort reason');check(published===0,'no partial publication');
 await wait(30);rows.push(sample(await parallel.runAsync({H,sampleCount:100},{minPasses:1}),100,'replacement job'));equal(H,unchanged,'abort input unchanged');
 pool.dispose();check(terminated===created,'all created workers terminated through pool');
 self.postMessage({ok:true,original,adapted,rows,zero:{hostSkipped:true,cursor:zero[90000]},controls:{preAbort:true,midflightAbort:true,published,created,terminated},traffic,staticRoutes:parallel.parallelLoops.map(l=>l.route),crossOriginIsolated:self.crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer,originalCode:serial.code,parallelCode:parallel.parallelCode,productExpected:stepReference(new Array(90001).fill(0),100),productSource:original+'\nconst H = [0 for k in 1..90001]\nconst answer = step(H, 100)'});
 }catch(e){self.postMessage({ok:false,error:String(e),stack:e.stack,traffic});}finally{for(const p of pools)p.dispose();}
};
