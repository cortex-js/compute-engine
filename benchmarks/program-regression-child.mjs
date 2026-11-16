/** Focused diagnostics against an existing production build; never builds CE. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
const [requestFile, outputFile] = process.argv.slice(2);
const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
const { root, workload, mode } = request;
const ceModule = await import(pathToFileURL(path.join(root, 'ce/dist/esm-min/epsil.js')).href);
const { ComputeEngine, executeEpsil, parseEpsil, resolveLibraryNames, checkEpsil } = ceModule;
const source = 'function square(x) { x*x }\nlet x = 3\nlet y = square(x)\ny+1';
let sink, release = () => {};
const engines = [];
let ce, operation, validate;
const controls = {};
if (workload === 'notebook') {
  const fullModule = await import('@cortex-js/compute-engine');
  const load = rel => import(pathToFileURL(path.join(root, 'tycho/src', rel)).href);
  const { registerComputeEngineModule } = await load('plot-core/ce-module-registry.ts');
  const { createEngineForProfile } = await load('plot-core/engine-profiles.ts');
  const { createCeNotebookEvaluator } = await load('graph-paper/notebook/ce-notebook-evaluator.ts');
  registerComputeEngineModule(fullModule);
  const evaluator = createCeNotebookEvaluator(() => { ce = createEngineForProfile('document'); assert(ce); engines.push(ce); return ce; });
  const scope = evaluator.enterScope();
  const text = 'let a = 3\nlet b = a+1\nb';
  const limits = { timeLimitMs: 2000, iterationLimit: 1000000, recursionLimit: 256 };
  const cell = code => {
    const analysis = evaluator.analyzeCortex(code);
    const result = evaluator.executeCortexCell(code, scope, analysis, limits);
    if (result.snapshot) evaluator.bindCortexPublications(result.snapshot, scope);
    return result;
  };
  operation = () => cell(text);
  validate = result => { assert.equal(result.status, 'ok'); assert.equal(result.latex, '4'); assert(result.snapshot); };
  validate(operation());
  assert.equal(cell(text.replace('3', '4')).latex, '5'); validate(operation());
  controls.notebook = { source: text, rerun: '4', edit: '5', route: 'real analyze/executeCortexCell/bindCortexPublications; persistent scope', excludes: ['graph scheduling', 'UI'] };
  release = () => evaluator.exitScope(scope);
} else {
  ce = new ComputeEngine(); engines.push(ce);
  if (request.jit === 'off') ce.jit = 'off';
  assert.equal(executeEpsil(ce, source).value.re, 10);
  const ast = resolveLibraryNames(parseEpsil(source)[0], source, ce);
  assert.equal(ce.box(ast).evaluate().re, 10);
  if (workload === 'box') operation = () => ce.box(ast);
  else if (workload === 'parse-box') operation = () => ce.box(resolveLibraryNames(parseEpsil(source)[0], source, ce));
  else if (workload === 'check') operation = () => checkEpsil(ce, source);
  if (operation) validate = result => workload === 'check' ? assert.equal(result.diagnostics.length, 0) : assert.equal(result.evaluate().re, 10);
  controls.program = { source, result: 10, checkDiagnostics: 0 };
}
const result = { request, node: process.version, v8: process.versions.v8, execArgv: process.execArgv, precision: ce?.precision, jit: ce?.jit, controls };
try {
  if (mode === 'scalar' || mode === 'scalar-trace') {
    const numbers = [2, 3, 5, 7], boxed = numbers.map(x => ce.box(x)), one = ce.box(5);
    for (let i = 0; i < 4; i++) assert.equal(boxed[i].evaluate(), boxed[i]);
    const loops = {
      empty(n) { let s = 0; for (let i = 0; i < n; i++) s += i & 3; return s; },
      directNumber(n) { let s = 0; for (let i = 0; i < n; i++) s += numbers[i & 3]; return s; },
      directBoxed(n) { let s = 0; for (let i = 0; i < n; i++) s += boxed[i & 3].re; return s; },
      cachedMixed(n) { let s = 0; for (let i = 0; i < n; i++) s += boxed[i & 3].evaluate().re; return s; },
      directSingle(n) { let s = 0; for (let i = 0; i < n; i++) s += one.re; return s; },
      cachedSingle(n) { let s = 0; for (let i = 0; i < n; i++) s += one.evaluate().re; return s; },
    };
    const expected = { empty: 1.5, directNumber: 4.25, directBoxed: 4.25, cachedMixed: 4.25, directSingle: 5, cachedSingle: 5 };
    result.scalar = [];
    for (const [id, loop] of Object.entries(loops)) {
      for (let i = 0; i < 20; i++) sink = loop(100000);
      let n = mode === 'scalar-trace' ? 5000000 : 1000000;
      if (mode === 'scalar') {
        while (n < 536870912) { const t = performance.now(); sink = loop(n); if (performance.now() - t >= 150) break; n *= 2; }
      }
      n -= n % 4;
      const samples = [];
      for (let r = 0; r < (mode === 'scalar' ? 7 : 2); r++) {
        const t = performance.now(); const value = loop(n); const ms = performance.now() - t;
        assert.equal(value, expected[id] * n); sink = value; globalThis.__programScalarSink = value;
        samples.push({ ms, nsPerCall: ms * 1e6 / n, checksum: value });
      }
      result.scalar.push({ id, n, warmupCalls: 2000000, samples });
    }
    result.scalarSink = globalThis.__programScalarSink;
    result.diagnosticTimingOnly = mode === 'scalar-trace';
  } else {
    assert(operation, 'Unknown workload');
    const warmup = request.warmup ?? 1000, iterations = request.iterations ?? 20000;
    for (let i = 0; i < warmup; i++) sink = operation(); validate(sink);
    result.warmup = warmup; result.iterations = iterations;
    if (mode === 'counts') {
      const counts = {}, repeated = {}, examples = [];
      let seen = new WeakMap();
      for (const target of engines) for (const name of ['box', 'function', 'lookupDefinition', 'declare', 'assign', 'type', '_infer']) {
        if (typeof target?.[name] !== 'function') continue;
        const original = target[name];
        target[name] = function (...args) {
          counts[name] = (counts[name] ?? 0) + 1;
          if (name === 'box' && args[0] && typeof args[0] === 'object') {
            const v = args[0], prior = seen.get(v) ?? 0; seen.set(v, prior + 1);
            if (prior) { const head = Array.isArray(v) ? String(v[0]) : '<object>'; repeated[head] = (repeated[head] ?? 0) + 1; if (examples.length < 8) examples.push({ head, stack: new Error().stack }); }
          }
          return original.apply(this, args);
        };
      }
      for (let i = 0; i < 20; i++) { seen = new WeakMap(); sink = operation(); }
      validate(sink); result.counts = { logicalOperations: 20, engines: engines.length, calls: counts, repeatedSameObjectBoxWithinOperation: repeated, examples, diagnosticOnly: true };
    } else if (mode === 'controls') {
      sink = operation(); validate(sink);
    } else if (mode === 'timing') {
      let n = 100;
      while (n < 1000000) {
        const started = performance.now();
        for (let i = 0; i < n; i++) sink = operation();
        if (performance.now() - started >= 100) break;
        n *= 2;
      }
      const samples = [];
      for (let round = 0; round < 7; round++) {
        const started = performance.now();
        for (let i = 0; i < n; i++) sink = operation();
        const ms = performance.now() - started;
        validate(sink);
        samples.push({ ms, msPerOperation: ms / n });
      }
      result.timing = { iterationsPerSample: n, samples, minimumCalibrationMs: 100 };
    } else {
      assert(['cpu', 'allocation'].includes(mode));
      const session = new Session(); session.connect();
      const post = (method, params = {}) => new Promise((ok, no) => session.post(method, params, (e, value) => e ? no(e) : ok(value)));
      if (mode === 'cpu') { await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 250 }); await post('Profiler.start'); }
      else {
        await post('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        for (let i = 0; i < 100; i++) sink = Array.from({ length: 1000 }, (_, n) => ({ n }));
        const control = (await post('HeapProfiler.stopSampling')).profile; assert(control.samples.length > 0); fs.writeFileSync(outputFile + '.control.heapprofile', JSON.stringify(control));
        await post('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      }
      const started = performance.now(); for (let i = 0; i < iterations; i++) sink = operation(); result.diagnosticWallMs = performance.now() - started;
      const profile = (await post(mode === 'cpu' ? 'Profiler.stop' : 'HeapProfiler.stopSampling')).profile;
      session.disconnect(); validate(sink);
      const profilePath = outputFile + (mode === 'cpu' ? '.cpuprofile' : '.heapprofile'); fs.writeFileSync(profilePath, JSON.stringify(profile));
      result.profile = profilePath; result.profileSamples = profile.samples?.length ?? 0;
      if (mode === 'allocation') { const size = n => n.selfSize + n.children.reduce((s, c) => s + size(c), 0); result.sampledAllocationBytes = size(profile.head); result.estimatedBytesPerOperation = result.sampledAllocationBytes / iterations; }
    }
  }
  result.status = 'ok';
} catch (e) { result.status = 'failed'; result.error = e.stack; process.exitCode = 1; }
finally { release(); fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n'); }
