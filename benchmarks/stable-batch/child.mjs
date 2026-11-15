import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { setImmediate } from 'node:timers/promises';
import { writeHeapSnapshot, getHeapStatistics, getHeapSpaceStatistics } from 'node:v8';
import { resolve } from 'node:path';
import { engineFactory, setupWorkload, numericControl, baselineControl } from './adapter.mjs';
import { readJson, environment } from './manifest.mjs';

const [requestFile, outputFile] = process.argv.slice(2);
const request = readJson(requestFile);
const { arm, settings, workload, mode } = request;
const result = { status: 'ready', mode, workload: workload.id, arm: arm.name, environment: environment() };
const session = new Session();
const post = (method, params = {}) => new Promise((accept, reject) => session.post(method, params, (e, value) => e ? reject(e) : accept(value)));
let sink;
const measure = (fn) => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};
const gcEvents = [];
const observer = new PerformanceObserver((list) => {
  for (const event of list.getEntries()) gcEvents.push({ start: event.startTime, duration: event.duration, detail: event.detail });
});

try {
  const startupProfile = mode === 'profile' && request.profilePhase === 'startup';
  if (startupProfile) { session.connect(); await post('Profiler.enable'); await post('Profiler.start'); }
  const importStart = performance.now();
  const { ComputeEngine } = await import(pathToFileURL(arm.entry).href);
  const importMs = performance.now() - importStart;
  const route = mode === 'controls' ? { hooks: new Set(), calls: {} } : undefined;
  const makeEngine = engineFactory(ComputeEngine, settings, route);
  if (workload.id === 'startup' || startupProfile) {
    const engine = measure(makeEngine);
    const ce = engine.value;
    const box = measure(() => ce[settings.boxApi](['Add', 2, 3]));
    const first = measure(() => box.value.evaluate());
    numericControl(first.value, 5, true);
    result.startup = { moduleImportMs: importMs, engineConstructionAndBuiltinRulesMs: engine.ms, firstBoxMs: box.ms, firstExecutionMs: first.ms, boxPlusFirstMs: box.ms + first.ms, processToFirstResultMs: performance.now(), processMetricIncludesHarnessImports: true };
    result.ruleLoading = { status: 'unsupported', reason: 'Builtin installation included in constructor; no distinct lazy API' };
    if (startupProfile) {
      const { profile } = await post('Profiler.stop');
      writeFileSync(`${outputFile}.cpuprofile`, JSON.stringify(profile));
      result.profile = { phase: 'startup', samples: profile.samples?.length ?? 0, file: `${outputFile}.cpuprofile` };
    }
  } else if (workload.kind === 'baseline-control') {
    assert.equal(mode, 'controls');
    Object.assign(result, baselineControl(makeEngine, workload.control, arm));
    result.api = 'Explicit native control; see baseline-controls.json difference field';
  } else {
    const work = setupWorkload(makeEngine, workload, settings);
    if (work.status === 'unsupported') Object.assign(result, work);
    else {
      result.api = work.api;
      result.staticAnalysis = work.staticAnalysis;
      result.documentStrategy = work.documentStrategy;
      work.initialize();
      const perform = () => {
        if (workload.phase === 'warm' && workload.mutation !== 'unchanged') work.write();
        return work.operation();
      };
      if (mode === 'controls') {
        // No timers or collection: verify first and repeated value changes.
        for (let i = 0; i < 3; i++) { sink = perform(); work.validate(sink); }
        result.correctness = { callsChecked: 3, mathematicalOracle: 'Literal arithmetic or pinned cases.json samples, independent of comparator' };
        result.route = { hooks: [...route.hooks], calls: route.calls, jitSwitch: route.jitSwitch, observedJit: route.observedJit, coverage: 'Compiler API entry counts on the selected workload; not a proof about unexposed internal entry points' };
        assert(Object.values(route.calls).every((n) => n === 0), 'Interpreter control unexpectedly reached compilation');
        if (route.hooks.size === 0) result.route.status = 'unavailable';
        else result.route.status = 'verified-no-compiler-api-entry';
        // Verify the hook itself against an explicit compilation, outside workload counters.
        const ce = work.ce;
        const compileEntry = [...route.hooks].find((n) => n === '_compile') ?? [...route.hooks][0];
        if (compileEntry) {
          const before = route.calls[compileEntry] ?? 0;
          try { ce[compileEntry](ce.box(['Add', 'a', 1]), { to: 'javascript' }); }
          catch (error) { result.route.calibrationDiagnostic = String(error); }
          assert((route.calls[compileEntry] ?? 0) > before, 'Compiler counter control did not fire');
          result.route.calibration = { entry: compileEntry, observed: true };
          // Copy the workload counts, not the calibration increment.
          result.route.calls = { ...result.route.calls, [compileEntry]: before };
        }
      } else if (mode === 'time') {
        assert(!global.gc, 'No explicit GC in uninstrumented timing processes');
        const first = measure(work.operation);
        work.validate(first.value);
        for (let i = 0; i < settings.warmup; i++) sink = perform();
        work.validate(sink);
        let operationMs = 0;
        let assignmentMs = 0;
        for (let i = 0; i < settings.iterations; i++) {
          if (workload.phase === 'warm' && workload.mutation !== 'unchanged') assignmentMs += measure(work.write).ms;
          const sample = measure(work.operation);
          operationMs += sample.ms;
          sink = sample.value;
        }
        work.validate(sink);
        result.timing = { firstOperationMs: first.ms, operationMsPerCall: operationMs / settings.iterations, assignmentMsPerCall: assignmentMs / settings.iterations, totalMsPerCall: (operationMs + assignmentMs) / settings.iterations, iterations: settings.iterations, warmup: settings.warmup, includesWrite: work.includesWrite, firstPreparationOutsideTimer: workload.phase === 'warm', engineAndInputDeclarationsOutsideTimer: true };
      } else if (mode === 'profile') {
        assert(['preparation', 'execution'].includes(request.profilePhase));
        const profiled = request.profilePhase === 'preparation' ? work.prepare : perform;
        for (let i = 0; i < settings.warmup; i++) { sink = perform(); }
        work.validate(sink);
        session.connect();
        await post('Profiler.enable');
        await post('Profiler.setSamplingInterval', { interval: 250 });
        await post('Profiler.start');
        const profileStart = performance.now();
        let profileCalls = 0;
        do {
          for (let i = 0; i < 256; i++) { sink = profiled(); profileCalls++; }
        } while (profileCalls < settings.profileIterations || performance.now() - profileStart < settings.profileMinMs);
        const { profile } = await post('Profiler.stop');
        if (request.profilePhase === 'execution') work.validate(sink);
        writeFileSync(`${outputFile}.cpuprofile`, JSON.stringify(profile));
        assert((profile.samples?.length ?? 0) >= 1000, 'Too few CPU samples; increase profileMinMs');
        result.profile = { phase: request.profilePhase, iterations: profileCalls, minDurationMs: settings.profileMinMs, samples: profile.samples?.length ?? 0, sufficientSamples: (profile.samples?.length ?? 0) >= 1000, file: `${outputFile}.cpuprofile`, attribution: 'Use matching diagnostic source maps for source attribution; production builder does not emit maps' };
      } else if (mode === 'memory') {
        assert(global.gc, 'Memory experiments require --expose-gc');
        observer.observe({ entryTypes: ['gc'] });
        session.connect();
        const allocation = async (fn, iterations) => {
          await post('HeapProfiler.startSampling', { samplingInterval: settings.samplingInterval, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
          for (let i = 0; i < iterations; i++) sink = fn();
          const { profile } = await post('HeapProfiler.stopSampling');
          const total = (node) => node.selfSize + node.children.reduce((sum, child) => sum + total(child), 0);
          return { sampledBytes: total(profile.head), samples: profile.samples?.length ?? 0, estimatedBytesPerOperation: total(profile.head) / iterations, iterations, profile };
        };
        const calibration = await allocation(() => Array.from({ length: 1000 }, (_, i) => ({ i, label: `control-${i}` })), 32);
        assert(calibration.sampledBytes > 0 && calibration.samples > 0, 'Allocation control produced no samples');
        for (let i = 0; i < settings.warmup; i++) sink = perform();
        work.validate(sink);
        const allocated = await allocation(perform, settings.allocationIterations);
        work.validate(sink);
        writeFileSync(`${outputFile}.heapprofile`, JSON.stringify(allocated.profile));
        delete allocated.profile;
        delete calibration.profile;
        result.allocation = { ...allocated, calibration, samplingInterval: settings.samplingInterval, collectedObjectsIncluded: true, estimated: true, file: `${outputFile}.heapprofile` };
        sink = null;
        const collect = async () => { await setImmediate(); global.gc(); await setImmediate(); global.gc(); await setImmediate(); };
        const memoryPoint = async (label) => {
          await collect();
          const point = { label, memory: process.memoryUsage(), heap: getHeapStatistics(), spaces: getHeapSpaceStatistics() };
          if (settings.snapshots) point.snapshot = writeHeapSnapshot(resolve(`${outputFile}.${label}.heapsnapshot`));
          return point;
        };
        const memoryWorkload = { id: 'memory-document', kind: 'document', phase: 'box', method: 'evaluate', mutation: 'unchanged' };
        const revisions = setupWorkload(makeEngine, memoryWorkload, settings);
        result.retention = { documentSize: settings.documentSize, retainedUnits: settings.retainedUnits, replacements: settings.replacements, preludeDefinitions: 4, oldHandlePolicy: 'Held control followed by dropped-obsolete checkpoints, then all roots dropped', points: [] };
        const points = result.retention.points;
        points.push(await memoryPoint('before-documents'));
        let held = Array.from({ length: settings.retainedUnits }, () => revisions.prepare());
        held.forEach(revisions.validate);
        points.push(await memoryPoint('retained-documents'));
        let obsolete = [];
        for (let i = 0; i < settings.replacements; i++) {
          const index = i % held.length;
          obsolete.push(held[index]);
          held[index] = revisions.prepare();
        }
        points.push(await memoryPoint('held-obsolete'));
        obsolete = null;
        points.push(await memoryPoint('dropped-obsolete'));
        // Repeated equal replacement batches expose a plateau or sustained growth.
        for (let batch = 0; batch < settings.retentionCheckpoints; batch++) {
          for (let i = 0; i < settings.replacements; i++) held[i % held.length] = revisions.prepare();
          points.push(await memoryPoint(`replacement-${batch + 1}`));
        }
        held = null;
        revisions.release();
        points.push(await memoryPoint('all-document-roots-dropped'));
        result.retention.interpretation = 'Heap-used deltas and checkpoints are raw evidence, not an accepted budget or leak verdict. The control workload engine remains alive throughout.';
        await setImmediate();
        result.gc = { events: gcEvents, count: gcEvents.length, durationMs: gcEvents.reduce((sum, event) => sum + event.duration, 0), promotion: 'Use optional --trace-gc-nvp diagnostic logs; heap/RSS is not total allocation' };
      } else throw new Error(`Unknown child mode ${mode}`);
    }
  }
} catch (error) {
  result.status = 'failed';
  result.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  observer.disconnect();
  session.disconnect();
  writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
}
