import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {loadavg} from 'node:os';
import * as ceModule from '@cortex-js/compute-engine';
import {registerComputeEngineModule} from './tycho/src/plot-core/ce-module-registry.ts';
import {createEngineForProfile} from './tycho/src/plot-core/engine-profiles.ts';
import {runPrelude} from './tycho/src/plot-core/prelude-runner.ts';
import {SHOWCASE} from './tycho/src/graph-paper/onboarding/templates.ts';
import {createCeNotebookEvaluator} from './tycho/src/graph-paper/notebook/ce-notebook-evaluator.ts';
registerComputeEngineModule(ceModule);
const output=process.argv[2],jit=process.argv[3]??'auto',rounds=3,records=[];
function engine(){const ce=createEngineForProfile('document');assert(ce);if(jit==='off')ce.jit='off';return ce;}
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function save(){writeFileSync(output,JSON.stringify({node:process.version,v8:process.versions.v8,execArgv:process.execArgv,nodeOptions:process.env.NODE_OPTIONS??'',jit,rounds,warmup:1,load:loadavg(),records},null,2)+'\n');}
for(const entry of SHOWCASE.filter(e=>typeof e.prelude==='string'&&e.prelude.trim())){
 const samples=[];let expected;records.push({id:entry.id,sourceSha256:hash(entry.prelude),sourceBytes:Buffer.byteLength(entry.prelude),samples});
 for(let r=-1;r<rounds;r++){
  const ce=engine(),wallStartMs=Date.now(),t=performance.now();const result=await runPrelude(ce,entry.prelude);const totalMs=performance.now()-t,wallEndMs=Date.now();assert(result.valid,`${entry.id}: ${JSON.stringify(result.diagnostics)}`);
  const valueSha256=hash(result.values.map(v=>({name:v.name,json:v.json})));if(r===-1)expected=valueSha256;else assert.equal(valueSha256,expected,`${entry.id} deterministic full values`);
  if(r>=0)samples.push({totalMs,wallStartMs,wallEndMs,timings:result.timings,functions:result.functions.map(f=>f.name),valueSha256,statements:result.statements.map(s=>({names:s.names,route:s.route,compileMs:s.compileMs,runMs:s.runMs}))});save();
 }
 console.log(entry.id,samples.map(s=>s.totalMs.toFixed(2)).join(','));
}
// Real notebook evaluator directly: its child execution and publication route,
// excluding compute-graph scheduling and UI rendering.
const evaluator=createCeNotebookEvaluator(()=>engine()),scope=evaluator.enterScope();
const limits={timeLimitMs:2000,iterationLimit:1000000,recursionLimit:256};
const source='let a = 3\nlet b = a+1\nb';
function cell(text,expected){const analysis=evaluator.analyzeCortex(text);const result=evaluator.executeCortexCell(text,scope,analysis,limits);if(result.snapshot)evaluator.bindCortexPublications(result.snapshot,scope);return result;}
function validate(result,expected){assert.equal(result.status,'ok',JSON.stringify(result));assert.equal(result.latex,String(expected));assert(result.snapshot);}
validate(cell(source,4),4);const notebook=[];
for(let r=0;r<7;r++){
 for(const [phase,text,expected] of [['rerun',source,4],['whole-source-edit',source.replace('3','4'),5]]){
  let result;const wallStartMs=Date.now(),t=performance.now();for(let i=0;i<20;i++)result=cell(text,expected);const ms=(performance.now()-t)/20,wallEndMs=Date.now();validate(result,expected);notebook.push({round:r,phase,ms,wallStartMs,wallEndMs});
 }
}
evaluator.exitScope(scope);records.push({id:'notebook-direct-execution-and-publication',source,samples:notebook,controls:{rerunLatex:'4',editLatex:'5'},excludes:['compute-graph scheduling','UI rendering']});save();
for(const [id,text] of [['prelude-edit-a','function f(x) { x+1 }\nlet a = f(3)'],['prelude-edit-b','function f(x) { x+2 }\nlet a = f(3)']]){
 const samples=[];for(let r=-1;r<rounds;r++){const ce=engine(),wallStartMs=Date.now(),t=performance.now();const result=await runPrelude(ce,text);const totalMs=performance.now()-t,wallEndMs=Date.now();assert(result.valid,JSON.stringify(result.diagnostics));if(r>=0)samples.push({totalMs,wallStartMs,wallEndMs,timings:result.timings,valueSha256:hash(result.values.map(v=>({name:v.name,json:v.json})))});}records.push({id,source:text,samples});save();
}
