import * as ce from '@cortex-js/compute-engine';
import {registerComputeEngineModule} from '../src/plot-core/ce-module-registry';
import {installPreludeWorker} from '../src/graph-paper/graph/prelude/prelude-worker-body';
let compiled=0, asyncRuns=0;
registerComputeEngineModule({...ce,compile:(...args)=>{const r=ce.compile(...args); compiled++; if(r.runAsync){const old=r.runAsync;r.runAsync=(...a)=>{asyncRuns++;return old(...a);};} return r;}});
const port={addEventListener:(...a)=>globalThis.addEventListener(...a),postMessage:(m)=>globalThis.postMessage({...m,instrument:{compiled,asyncRuns}})};
installPreludeWorker(port,{loadEngine:async()=>{}});
