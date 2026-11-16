import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {loadavg} from 'node:os';
import * as ceModule from '@cortex-js/compute-engine';
import {registerComputeEngineModule} from './tycho/src/plot-core/ce-module-registry.ts';
import {createEngineForProfile} from './tycho/src/plot-core/engine-profiles.ts';
import {runPrelude} from './tycho/src/plot-core/prelude-runner.ts';
import {SHOWCASE} from './tycho/src/graph-paper/onboarding/templates.ts';
import {buildAnsComputeEngine} from './tycho/src/graph-paper/notebook/ce-ans-references.ts';
import {createCeNotebookEvaluator} from './tycho/src/graph-paper/notebook/ce-notebook-evaluator.ts';
import {createNotebookComputeGraph} from './tycho/src/graph-paper/notebook/notebook-compute-graph.ts';
registerComputeEngineModule(ceModule);
const output=process.argv[2],jit=process.argv[3]??'auto',rounds=3,records=[];
function engine(){const ce=createEngineForProfile('document');assert(ce);if(jit==='off')ce.jit='off';return ce;}
function save(){writeFileSync(output,JSON.stringify({node:process.version,v8:process.versions.v8,execArgv:process.execArgv,jit,rounds,load:loadavg(),records},null,2)+'\n');}
for(const entry of SHOWCASE.filter(e=>typeof e.prelude==='string'&&e.prelude.trim())){
 const samples=[];records.push({id:entry.id,source:entry.prelude,samples});
 for(let r=0;r<rounds;r++){
  const ce=engine();const t=performance.now();const result=await runPrelude(ce,entry.prelude);const ms=performance.now()-t;
  assert(result.valid,`${entry.id}: ${JSON.stringify(result.diagnostics)}`);
  samples.push({totalMs:ms,timings:result.timings,functions:result.functions.map(f=>f.name),values:result.values.map(v=>({name:v.name,type:v.type})),statements:result.statements.map(s=>({names:s.names,route:s.route,compileMs:s.compileMs,runMs:s.runMs}))});save();
 }
 console.log(entry.id,samples.map(s=>s.totalMs.toFixed(2)).join(','));
}
const source='function square(x) { x*x }\nlet x = 3\nsquare(x)';
for(const kind of ['notebook-epsil-open-rerun-edit']){
 const samples=[];
 for(let r=0;r<rounds;r++){
  const evaluator=createCeNotebookEvaluator(()=>{const ce=buildAnsComputeEngine();assert(ce);if(jit==='off')ce.jit='off';return ce;});const graph=createNotebookComputeGraph(evaluator);
  const item=s=>({kind:'cortex',id:'E',source:s,execute:true,limits:{timeLimitMs:2000,iterationLimit:1000000,recursionLimit:256}});
  for(const [phase,text] of [['open',source],['rerun',source],['edit',source.replace('3','4')]]){
   const t=performance.now();const result=graph.recompute([item(text)]);const ms=performance.now()-t;
   samples.push({phase,ms,run:[...result.cortexRuns??[]],result:[...result.results].map(([k,v])=>[k,v.status])});
  }
  graph.dispose();
 }
 records.push({id:kind,samples});save();
}
for(const [id,text] of [['prelude-edit-a','function f(x) { x+1 }\nlet a = f(3)'],['prelude-edit-b','function f(x) { x+2 }\nlet a = f(3)']]){
 const samples=[];for(let r=0;r<rounds;r++){const ce=engine();const t=performance.now();const result=await runPrelude(ce,text);assert(result.valid,JSON.stringify(result.diagnostics));samples.push({totalMs:performance.now()-t,timings:result.timings});} records.push({id,source:text,samples});save();
}
