import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ceModule from '@cortex-js/compute-engine';
import {observedConstructor,inspectProfile,installPublicObserver} from './profile-coverage-capture.mts';
import {registerComputeEngineModule,resolveCECompile} from '../src/plot-core/ce-module-registry.js';
import {showcaseDocumentWithPrelude} from '../tests/node/graph-paper/showcase-action-harness.ts';
import {SHOWCASE} from '../src/graph-paper/onboarding/template-data.js';
let phase='load';const calls:any[]=[];
registerComputeEngineModule({...ceModule,ComputeEngine:observedConstructor(ceModule.ComputeEngine),compile:(expr:any,options:any)=>{
 const capture=inspectProfile(expr,options,{phase});
 try {const result=ceModule.compile(expr,options);calls.push({...capture,success:result.success,freeSymbols:result.freeSymbols,freeSymbolTypes:result.freeSymbolTypes});return result;}
 catch(e){calls.push({...capture,success:false,threw:String(e)});throw e;}
}} as never);
const entry=SHOWCASE.find((e:any)=>e.id==='game-of-life')!;
const restoreProfileObserver=installPublicObserver(ceModule.ComputeEngine);
try {
const doc=await showcaseDocumentWithPrelude(entry);
function state(){const n=doc.ce.box('S');const v=n.value;return {type:n.type.toString(),valueType:v?.type.toString(),operator:v?.operator,hash:createHash('sha256').update(JSON.stringify(v?.json)).digest('hex'),length:v?.ops?.length};}
function reader(){doc.ce.pushScope();try {doc.ce.declare('x','real');doc.ce.declare('y','real');const expr=doc.ce.parse(entry.series[0].fn);return inspectProfile(expr,{to:'javascript'},{phase,observation:'authored reader in live manager binding, not product renderer gateway'});}finally{doc.ce.popScope();}}
const before={state:state(),reader:reader()};phase='action';doc.fire(entry.actions![0].latex);phase='post-action';const after={state:state(),reader:reader()};
if(before.state.hash===after.state.hash)throw Error('action did not change board');
writeFileSync('/tmp/js-profile-next/life.json',JSON.stringify({before,after,calls,limitations:['Real action uses existing node harness; clock/deadline lifted','Reader comparison inspects live bindings; no claim of post-action renderer sampler routing']},null,2));
console.log(JSON.stringify({before:before.state,after:after.state,calls:calls.length}));

} finally { restoreProfileObserver(); }
