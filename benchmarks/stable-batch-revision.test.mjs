import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Substitute the workload boundary, preserving the child's actual loops,
// inspector calls, validation placement, and collection checkpoints.
function run(mode, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stable-revision-test-'));
  try {
    const adapter = join(dir, 'adapter.mjs');
    writeFileSync(adapter, `import {writeFileSync} from 'node:fs';
      const counts={initialize:0,operation:0,prepare:0,validate:0,release:0};
      process.on('exit',()=>writeFileSync(${JSON.stringify(join(dir, 'counts.json'))},JSON.stringify(counts)));
      let route;
      export const engineFactory=(_ce,_settings,observed)=>{route=observed;if(route){route.hooks.add('_compile');route.calls._compile=0;}return ()=>{throw Error('unexpected engine creation')}};
      export const readJson=(path)=>JSON.parse((awaitRead(path)));
      import {readFileSync as awaitRead} from 'node:fs';
      export const environment=()=>({});
      export const setupPhase1Workload=()=>({status:'ready',ce:{box(){return {}},_compile(){route.calls._compile++}},initialize(){counts.initialize++},operation(){counts.operation++;return {}},prepare(){counts.prepare++;return {}},validate(){counts.validate++},release(){counts.release++}});`);
    const entry = join(dir, 'entry.mjs');
    writeFileSync(entry, extra.harnessOnly ? `throw Error('harness imported engine');` : 'export class ComputeEngine {}');
    let source = readFileSync(new URL('./stable-batch-revision-child.mjs', import.meta.url), 'utf8')
      .replaceAll("'./stable-batch/adapter.mjs'", JSON.stringify(pathToFileURL(adapter).href))
      .replaceAll("'./stable-batch/manifest.mjs'", JSON.stringify(pathToFileURL(adapter).href))
      .replaceAll("'./stable-batch-phase1-adapter.mjs'", JSON.stringify(pathToFileURL(adapter).href));
    if (extra.snapshotsAt) source = source.replace('value.snapshot = writeHeapSnapshot(', 'value.snapshot = (');
    const child = join(dir, 'child.mjs'); writeFileSync(child, source);
    const request = join(dir, 'request.json');
    writeFileSync(request, JSON.stringify({mode,arm:{name:'mock',entry,adapter:'native'},workload:{id:'scalar/evaluate/unchanged',kind:'scalar',phase:'warm',mutation:'unchanged'},...extra}));
    const output = join(dir, 'output.json');
    execFileSync(process.execPath, [...(mode === 'time' ? [] : ['--expose-gc']),...(extra.testNodeFlags ?? []),child,request,output]);
    return { result:JSON.parse(readFileSync(output)), counts:JSON.parse(readFileSync(join(dir,'counts.json'))) };
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
test('CPU instrument executes exactly 5000 warmup and 100000 measured calls',()=>{
  const {result,counts}=run('cpu');
  assert.equal(result.status,'ready'); assert.equal(counts.operation,105000);
  assert.equal(result.measuredCalls,100000); assert.equal(counts.validate,2);
});
test('allocation instrument executes matched call counts and observes allocating control',()=>{
  const {result,counts}=run('allocation');
  assert.equal(counts.operation,105000); assert(result.allocationControlSamples>0);
});
test('retention warms 200 then retains8 and replaces4x20x12',()=>{
  const {result,counts}=run('retention');
  assert.equal(counts.operation,200); assert.equal(counts.prepare,8+4*20*12);
  assert.equal(counts.validate,200+1+8+4*20*12);
  assert.equal(result.points.length,7); assert.equal(counts.release,2);
});
test('harness-only retention never imports engine and uses matching checkpoints',()=>{
  const {result,counts}=run('retention',{harnessOnly:true});
  assert.equal(result.status,'ready'); assert.equal(result.points.length,7);
  assert.equal(counts.prepare,0); assert.equal(counts.operation,0);
});

test('snapshot lifecycle retains12obsolete handles and drops them before replacement windows',()=>{
  const {result,counts}=run('retention',{snapshotsAt:['held-obsolete','obsolete-dropped']});
  assert.equal(counts.prepare,8+12+4*20*12);
  assert.equal(result.points.length,9);
  assert.equal(result.points[2].label,'held-obsolete');
  assert.equal(result.points[3].label,'obsolete-dropped');
});

test('time loop accepts construction counts and validates only outside measured calls',()=>{
  const {result,counts}=run('time',{warmup:10,iterations:20});
  assert.equal(counts.operation,1+10+20);
  assert.equal(counts.validate,3);
  assert.equal(result.timing.iterations,20);
  assert.equal(result.timing.warmup,10);
  assert.equal(result.timing.validationOutsideTimers,true);
  assert(result.timing.totalMsPerCall>=0);
});

test('time rejects GC flags rather than recording instrumented timing',()=>{
  assert.throws(()=>run('time',{warmup:1,iterations:1,testNodeFlags:['--expose-gc']}));
});
test('route controls require zero interpreter compiler entries and a positive counter',()=>{
  const {result,counts}=run('controls');
  assert.equal(result.route.calls._compile,0);
  assert.equal(result.route.positiveControl,'_compile');
  assert.equal(counts.operation,3);
});

test('time rejects zero measured iterations',()=>{
  assert.throws(()=>run('time',{warmup:1,iterations:0}));
});

test('allocation sampling interval is configurable and validated',()=>{
  const {result}=run('allocation',{allocationSamplingInterval:32768});
  assert.equal(result.allocationSamplingInterval,32768);
  assert(result.allocationControlSamples>0);
  assert.throws(()=>run('allocation',{allocationSamplingInterval:0}));
});
