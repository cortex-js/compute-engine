import assert from 'node:assert/strict';
import inspector from 'node:inspector';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {ComputeEngine,executeEpsil}=await import(pathToFileURL(resolve(process.env.CE_ROOT??'./ce','dist/esm-min/epsil.js')).href);
const output=process.argv[2],mode=process.argv[3]??'drop',jit=process.argv[4]??'auto',count=400;
assert(global.gc,'Explicit GC diagnostic process required');
function engine(){const ce=new ComputeEngine();if(jit==='off')ce.jit='off';return ce;}
const source='do { let captured = 3; (x) => x + captured }';
const programSource='let shared = 3\nshared+1';
function run(ce){executeEpsil(ce,programSource);return executeEpsil(ce,source).value;}
function collect(){for(let i=0;i<3;i++)global.gc();return process.memoryUsage().heapUsed;}
// Warm all tested paths before recording either retained or dropped objects.
{let warm=engine();for(let i=0;i<100;i++)run(warm);warm=null;}
await new Promise(resolve=>setImmediate(resolve));const before=collect();let ce=engine();let held=[];const checkpoints=[];
for(let i=0;i<count;i++){
 const value=run(ce);
 if(mode==='retain-closures')held.push(value);
 else if(mode==='allocating-control')held.push(new Array(4096).fill(i));
 if((i+1)%100===0)checkpoints.push({programs:i+1,liveHeapBytes:collect()});
}
let closureControl;
if(mode==='retain-closures'){closureControl=ce.box(['Apply',held[0],2]).evaluate().re;assert.equal(closureControl,5);}
const heldBytes=collect();ce=null;await new Promise(resolve=>setImmediate(resolve));const afterDropEngine=collect();held=[];await new Promise(resolve=>setImmediate(resolve));const afterDropAll=collect();
// Sample allocation separately and disconnect inspector before live-byte readings.
const session=new inspector.Session();session.connect();const post=(m,p={})=>new Promise((ok,no)=>session.post(m,p,(e,r)=>e?no(e):ok(r)));
let local=engine();await post('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
for(let i=0;i<count;i++)run(local);
let response=await post('HeapProfiler.stopSampling');let allocatedSampleBytes=0;function sum(n){allocatedSampleBytes+=n.selfSize;for(const c of n.children)sum(c);}sum(response.profile.head);response=null;session.disconnect();local=null;await new Promise(resolve=>setImmediate(resolve));const afterInspectorCleanup=collect();
writeFileSync(output,JSON.stringify({node:process.version,v8:process.versions.v8,mode,jit,count,source,programSource,closureControl,beforeHeapBytes:before,heldHeapBytes:heldBytes,afterDropEngineHeapBytes:afterDropEngine,afterDropAllHeapBytes:afterDropAll,afterInspectorCleanupHeapBytes:afterInspectorCleanup,checkpoints,allocatedSampleBytes,samplingInterval:32768},null,2)+'\n');
