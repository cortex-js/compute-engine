import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {loadavg} from 'node:os';
import inspector from 'node:inspector';
import {ComputeEngine,parseEpsil,resolveLibraryNames,executeEpsil,checkEpsil} from './ce/dist/esm-min/epsil.js';
const output=process.argv[2], jit=process.argv[3]??'auto', rounds=7, iterations=40;
const records=[];
const source='function square(x) { x*x }\nlet x = 3\nlet y = square(x)\ny+1';
const heavy=Array.from({length:12},(_,i)=>`type alias Pair${i} = tuple<number, number>\nprotocol P${i} { function compare(self: Self, other: Self) -> string }`).join('\n');
function engine(){ const ce=new ComputeEngine(); if(jit==='off')ce.jit='off';return ce; }
function timed(id,fn,n=iterations){for(let i=0;i<10;i++)fn();const samples=[]; for(let r=0;r<rounds;r++){const t=performance.now();for(let i=0;i<n;i++)fn();samples.push((performance.now()-t)/n);} records.push({id,iterations:n,samplesMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[3],minMs:Math.min(...samples),maxMs:Math.max(...samples)});}
const ce=engine();const checked=checkEpsil(ce,source);assert.equal(checked.diagnostics.length,0);assert.equal(executeEpsil(ce,source).value.re,10);assert.equal(executeEpsil(ce,'let z = "a" + 1\n5').value.re,5);assert.equal(checkEpsil(ce,heavy).diagnostics.length,0);
const controls={validResult:10,failureContinuation:5,typeProtocolDiagnostics:0};
// A scalar parse control versus a statement-rich source verifies the instrument sees work.
timed('control-parse-scalar',()=>parseEpsil('5'));
timed('parse-only',()=>parseEpsil(source));
const ast=resolveLibraryNames(parseEpsil(source)[0],source,ce);
timed('box-only-current-parser-container',()=>ce.box(ast));
timed('parse-and-box',()=>ce.box(resolveLibraryNames(parseEpsil(source)[0],source,ce)));
timed('engine-construction',()=>engine(),10);
timed('full-first-run',()=>{ce.pushScope();try{executeEpsil(ce,source);}finally{ce.popScope();}});
timed('same-caller-namespace-rerun',()=>executeEpsil(ce,source));
const boxed=ce.box(resolveLibraryNames(parseEpsil('3*3+1')[0],'3*3+1',ce));
timed('boxed-expression-repeat',()=>boxed.evaluate(),1000);
timed('failed-statement-continuation',()=>executeEpsil(ce,'let z = "a" + 1\n5'));
timed('check-only',()=>checkEpsil(ce,source));
timed('type-protocol-heavy-check',()=>checkEpsil(ce,heavy),10);
timed('whole-source-edit',()=>executeEpsil(ce,source.replace('let x = 3','let x = 4')));
const memory=[];
if(global.gc){
 const session=new inspector.Session();session.connect();const post=(m,p={})=>new Promise((ok,no)=>session.post(m,p,(e,r)=>e?no(e):ok(r)));
 for(const retain of [false,true]){
  for(let i=0;i<50;i++)executeEpsil(ce,source);
  global.gc();const before=process.memoryUsage().heapUsed;await post('HeapProfiler.startSampling',{samplingInterval:4096,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
  const kept=[];let local=engine(); const checkpoints=[];
  for(let i=0;i<400;i++){executeEpsil(local,'let x = 3\nlet f = (t) => x+t\nf'); if(retain)kept.push(local.box('f').evaluate());if((i+1)%100===0){global.gc();checkpoints.push(process.memoryUsage().heapUsed);}}
  const {profile}=await post('HeapProfiler.stopSampling');let bytes=0;function sum(n){bytes+=n.selfSize;for(const c of n.children)sum(c);}sum(profile.head);
  local=null;global.gc();const afterDropEngine=process.memoryUsage().heapUsed;kept.length=0;global.gc();memory.push({retainClosures:retain,programs:400,beforeHeapBytes:before,checkpoints,allocatedSampleBytes:bytes,afterDropEngineHeapBytes:afterDropEngine,afterDropClosuresHeapBytes:process.memoryUsage().heapUsed});
 }
 session.disconnect();
}
writeFileSync(output,JSON.stringify({node:process.version,v8:process.versions.v8,execArgv:process.execArgv,jit,rounds,warmup:10,load:loadavg(),controls,records,memory,source,heavy},null,2)+'\n');
