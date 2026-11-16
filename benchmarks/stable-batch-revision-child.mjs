// One diagnostic process per arm, workload, and mode. Never use these as timings.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { setImmediate } from 'node:timers/promises';
import { getHeapStatistics, getHeapSpaceStatistics, writeHeapSnapshot } from 'node:v8';
import { engineFactory } from './stable-batch/adapter.mjs';
import { readJson, environment } from './stable-batch/manifest.mjs';
import { setupPhase1Workload } from './stable-batch-phase1-adapter.mjs';

const [requestFile, outputFile] = process.argv.slice(2);
const request = readJson(requestFile);
const { arm, workload, mode } = request;
assert(['cpu', 'allocation', 'retention', 'time', 'controls'].includes(mode));
const allocationSamplingInterval = request.allocationSamplingInterval ?? 1024;
assert(Number.isSafeInteger(allocationSamplingInterval) && allocationSamplingInterval > 0);
const settings = { precision: 50, jit: 'off', boxApi: 'box', documentSize: 64, ...request.settings };
const warmupCalls = mode === 'retention' ? 200 : mode === 'time' ? request.warmup ?? 5000 : 5000;
const measuredCalls = mode === 'retention' ? 0 : mode === 'controls' ? 3 : mode === 'time' ? request.iterations ?? 100000 : 100000;
assert(Number.isSafeInteger(warmupCalls) && warmupCalls > 0);
assert(Number.isSafeInteger(measuredCalls) && (mode === 'retention' ? measuredCalls === 0 : measuredCalls > 0));
const result = { arm: arm.name, workload, mode, environment: environment(), settings,
  warmupCalls, measuredCalls };
if (request.route && !['name', 'handle'].includes(request.route)) {
  writeFileSync(outputFile, JSON.stringify({ ...result, status: 'unsupported', reason: 'Unknown execution route; no name-route substitution' }, null, 2) + '\n');
  process.exit(0);
}
const session = new Session();
const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, value) => error ? reject(error) : resolve(value)));
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
result.identity = { entry: arm.entry, entrySha256: digest(arm.entry), buildManifest: arm.buildManifest ?? null, harnessSha256: digest(new URL(import.meta.url)) };
let sink;
try {
  const exports = request.harnessOnly ? {} : await import(pathToFileURL(arm.entry).href);
  const route = mode === 'controls' ? { hooks: new Set(), calls: {} } : undefined;
  const makeEngine = engineFactory(exports.ComputeEngine, settings, route);
  const selected = mode === 'retention' ? { id: 'document/prepare', kind: 'document', phase: 'box', method: 'evaluate', mutation: 'unchanged' } : workload;
  if (request.route) arm.route = request.route;
  const work = request.harnessOnly ? { status: 'ready', initialize() {}, operation() {}, validate() {}, release() {}, prepare() {} } : setupPhase1Workload(makeEngine, selected, settings, arm, exports.prepareBatch);
  assert.equal(work.status, 'ready');
  work.initialize();
  const perform = () => {
    if (selected.phase === 'warm' && selected.mutation !== 'unchanged') work.write();
    return work.operation();
  };
  if (mode === 'time') {
    assert(!global.gc, 'Timing must not expose GC');
    assert(![...process.execArgv, process.env.NODE_OPTIONS ?? ''].some(flag => /(?:prof|trace-gc|expose-gc|inspect)/.test(flag)), 'Timing forbids profiler/GC flags');
    const firstStart = performance.now();
    sink = work.operation();
    result.firstOperationMs = performance.now() - firstStart;
    work.validate(sink);
  }
  for (let i = 0; i < (mode === 'controls' ? 0 : warmupCalls); i++) {
    sink = perform();
    // Retention warms preparation, instantiation, execution, and arithmetic.
    if (mode === 'retention') work.validate(sink);
  }
  if (mode !== 'controls') work.validate(sink);
  if (mode === 'cpu' || mode === 'allocation') session.connect();
  if (mode === 'controls') {
    for (let i = 0; i < measuredCalls; i++) { sink = perform(); work.validate(sink); }
    assert(Object.values(route.calls).every(count => count === 0), 'Interpreter control reached compilation');
    assert(route.hooks.size > 0, 'Compiler route control unavailable');
    result.route = { hooks: [...route.hooks], calls: { ...route.calls }, observedJit: route.observedJit };
    const hook = [...route.hooks][0];
    const before = route.calls[hook] ?? 0;
    try { work.ce[hook](work.ce.box(['Add', 2, 3]), { to: 'javascript' }); } catch {}
    assert((route.calls[hook] ?? 0) > before, 'Compiler counter positive control did not fire');
    result.route.positiveControl = hook;
  } else if (mode === 'time') {
    let operationMs = 0; let assignmentMs = 0;
    for (let i = 0; i < measuredCalls; i++) {
      if (selected.phase === 'warm' && selected.mutation !== 'unchanged') {
        const start = performance.now(); work.write(); assignmentMs += performance.now() - start;
      }
      const start = performance.now(); sink = work.operation(); operationMs += performance.now() - start;
    }
    result.timing = { operationMsPerCall: operationMs / measuredCalls, assignmentMsPerCall: assignmentMs / measuredCalls, totalMsPerCall: (operationMs + assignmentMs) / measuredCalls, iterations: measuredCalls, warmup: warmupCalls, validationOutsideTimers: true, setupOutsideTimer: true };
  } else if (mode === 'cpu') {
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: request.samplingInterval ?? 100 });
    await post('Profiler.start');
    for (let i = 0; i < 100000; i++) sink = perform();
    const { profile } = await post('Profiler.stop');
    writeFileSync(`${outputFile}.cpuprofile`, JSON.stringify(profile));
    result.samples = profile.samples?.length ?? 0;
    result.sufficientSamples = result.samples >= 1000;
    result.samplingInterval = request.samplingInterval ?? 100;
  } else if (mode === 'allocation') {
    await post('HeapProfiler.startSampling', { samplingInterval: allocationSamplingInterval, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    for (let i = 0; i < 100; i++) sink = Array.from({ length: 1000 }, (_, index) => ({ index }));
    const control = (await post('HeapProfiler.stopSampling')).profile;
    writeFileSync(`${outputFile}.control.heapprofile`, JSON.stringify(control));
    assert(control.samples.length > 0, 'Known allocating control must register');
    result.allocationControlSamples = control.samples.length;
    await post('HeapProfiler.startSampling', { samplingInterval: allocationSamplingInterval, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    for (let i = 0; i < 100000; i++) sink = perform();
    const { profile } = await post('HeapProfiler.stopSampling');
    writeFileSync(`${outputFile}.heapprofile`, JSON.stringify(profile));
    const total = (node) => node.selfSize + node.children.reduce((sum, child) => sum + total(child), 0);
    result.sampledBytes = total(profile.head);
    result.estimatedBytesPerCall = result.sampledBytes / 100000;
    result.samples = profile.samples?.length ?? 0;
    result.allocationSamplingInterval = allocationSamplingInterval;
    result.collectedObjectsIncluded = true;
  } else {
    assert(global.gc, 'Retention requires --expose-gc');
    sink = null;
    work.release();
    const points = result.points = new Array(request.snapshotsAt ? 9 : 7);
    let pointIndex = 0;
    const point = async (label) => {
      await setImmediate(); global.gc(); await setImmediate(); global.gc(); await setImmediate();
      const value = { label, memory: process.memoryUsage(), heap: getHeapStatistics(), spaces: getHeapSpaceStatistics() };
      if (request.snapshotsAt?.includes(label)) value.snapshot = writeHeapSnapshot(`${outputFile}.${label}.heapsnapshot`);
      points[pointIndex++] = value;
    };
    await point('warm-baseline');
    let held = Array.from({ length: 8 }, () => { const doc = work.prepare(); work.validate(doc); return doc; });
    await point('live-8');
    if (request.snapshotsAt) {
      let obsolete = [];
      for (let i = 0; i < 12; i++) { const index = i % 8; obsolete.push(held[index]); held[index] = work.prepare(); work.validate(held[index]); }
      await point('held-obsolete');
      assert.equal(obsolete.length, 12);
      obsolete = null;
      await point('obsolete-dropped');
    }
    for (let window = 1; window <= 4; window++) {
      for (let i = 0; i < 20 * 12; i++) { const index = i % 8; held[index] = work.prepare(); work.validate(held[index]); }
      await point(`replacement-${window}`);
    }
    held = null;
    work.release();
    await point('all-roots-dropped');
    result.retention = { liveDocuments: 8, windows: 4, batchesPerWindow: 20, replacementsPerBatch: 12,
      interpretation: 'Heap usage is raw evidence. Classify document families, V8 code, and harness roots using snapshot retaining paths; heap-space labels alone do not prove ownership.' };
  }
  if (mode !== 'retention') work.validate(sink);
  result.identity.entryAfterSha256 = digest(arm.entry);
  assert.equal(result.identity.entrySha256, result.identity.entryAfterSha256);
  result.status = 'ready';
} catch (error) {
  result.status = 'failed'; result.error = error.stack; process.exitCode = 1;
} finally {
  session.disconnect();
  writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
}
