/**
 * Separate scalar evaluation from boxing, writes, and user-call overhead.
 * Run node --expose-gc --import tsx benchmarks/scalar-arithmetic.mjs <checkout>.
 * Fresh-engine calls share a loaded, increasingly warmed runtime; they are not startup.
 * Bundles: ENTRY=dist/esm-min/core.js with node --expose-gc (without tsx).
 * MODE=counts or MODE=profile records work counts or inspector samples instead.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';
import { Session } from 'node:inspector';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const entry = process.env.ENTRY ?? 'src/core.ts';
assert(['src/core.ts', 'dist/esm/core.js', 'dist/esm-min/core.js'].includes(entry), 'Unknown ENTRY');
const { ComputeEngine } = await import(pathToFileURL(`${root}/${entry}`).href);
const mode = process.env.MODE ?? 'timing';
const runs = Number(process.env.RUNS ?? 7);
const iterations = Number(process.env.ITERATIONS ?? 1000);
const profileMs = Number(process.env.PROFILE_MS ?? 1500);
assert(Number.isFinite(profileMs) && profileMs >= 500);
const only = process.env.ONLY?.split(',');
assert(['timing', 'counts', 'profile'].includes(mode));
assert(Number.isInteger(runs) && runs > 0);
assert(Number.isInteger(iterations) && iterations > 0);
assert(global.gc, 'Use --expose-gc');

const formulas = {
  muladd: ['Add', ['Multiply', 'a', 'b'], 'c'],
  rational: ['Divide', ['Add', 'a', 1], ['Add', 'b', 2]],
  transcend: ['Add', ['Sin', 'a'], ['Ln', 'b']],
  call: ['f', 'a', 'b', 'c'],
};
const summary = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  return { median: ordered[Math.floor(ordered.length / 2)], min: ordered[0], max: ordered.at(-1) };
};

function setup(name, method, mutation) {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.jit = 'off';
  for (const key of ['a', 'b', 'c', 'z']) ce.declare(key, 'real');
  ce.assign('a', 2);
  ce.assign('b', 3);
  ce.assign('c', 5);
  ce.assign('z', 0);
  if (name === 'call') ce.assign('f', ce.box([
    'Function', ['Add', ['Multiply', 'x', 'y'], 'w'], 'x', 'y', 'w',
  ]));
  const expr = ce.box(formulas[name]);
  assert.equal(expr.operator, name === 'call' ? 'f' : name === 'rational' ? 'Divide' : 'Add');
  let a = 2;
  let writeSerial = 0;
  return {
    ce,
    evaluate: () => method === 'exact' ? expr.evaluate() : expr.N(),
    write: (i) => {
      if (mutation === 'relevant') {
        a = 2 + writeSerial++;
        ce.assign('a', a);
      } else if (mutation === 'unrelated') ce.assign('z', i);
    },
    box: () => ce.box(formulas[name]),
    check: (result) => {
      assert(result.isValid);
      assert.equal(result.isCollection, false);
      if (name === 'transcend' && method === 'exact') {
        const tree = result.json;
        assert(Array.isArray(tree) && tree[0] === 'Add' && tree.length === 3);
        const sorted = (terms) => terms.map((term) => JSON.stringify(term)).sort();
        assert.deepEqual(sorted(tree.slice(1)), sorted([['Sin', a], ['Ln', 3]]));
      } else {
        const expected = name === 'rational' ? (a + 1) / 5 :
          name === 'transcend' ? Math.sin(a) + Math.log(3) : a * 3 + 5;
        assert(Math.abs(result.re - expected) <= 1e-12 * Math.max(1, Math.abs(expected)));
        if (method === 'exact') {
          assert.equal(result.isExact, true);
          assert.deepEqual(result.json, name === 'rational' && (a + 1) % 5 !== 0 ? ['Rational', a + 1, 5] : expected);
        } else if (name === 'transcend' || (name === 'rational' && (a + 1) % 5 !== 0)) {
          assert.equal(result.isExact, false);
        }
      }
    },
  };
}

async function collect() {
  await setImmediate();
  global.gc();
}

async function timing(name, method, mutation) {
  const first = [], evaluation = [], assignment = [], boxing = [];
  for (let trial = 0; trial < runs; trial++) {
    const work = setup(name, method, mutation);
    await collect();
    let start = performance.now();
    const firstResult = work.evaluate();
    first.push(performance.now() - start);
    work.check(firstResult);
    for (let i = 0; i < 100; i++) {
      work.write(i);
      work.check(work.evaluate());
    }
    await collect();
    let evalTime = 0, writeTime = 0;
    // One result is held at a time; validation stays outside each timed call.
    for (let i = 0; i < iterations; i++) {
      if (mutation !== 'unchanged') {
        start = performance.now();
        work.write(i);
        writeTime += performance.now() - start;
      }
      start = performance.now();
      const result = work.evaluate();
      evalTime += performance.now() - start;
      work.check(result);
    }
    evaluation.push(evalTime / iterations);
    assignment.push(writeTime / iterations);
    await collect();
    start = performance.now();
    let boxed;
    for (let i = 0; i < iterations; i++) boxed = work.box();
    boxing.push((performance.now() - start) / iterations);
    assert(boxed.isValid);
  }
  return { freshEngineMs: summary(first), evaluateMs: summary(evaluation), assignMs: summary(assignment), boxMs: summary(boxing) };
}

function counts(name, method, mutation) {
  const work = setup(name, method, mutation);
  for (let i = 0; i < 100; i++) {
    work.write(i);
    work.check(work.evaluate());
  }
  const versions = () => [work.ce._anyVersion, work.ce._typeVersion, work.ce._evaluationVersion];
  const before = versions();
  work.ce._cacheStats.reset();
  work.ce._cacheStats.enabled = true;
  try {
    for (let i = 0; i < iterations; i++) {
      work.write(i);
      const result = work.evaluate();
      work.ce._cacheStats.enabled = false;
      work.check(result);
      work.ce._cacheStats.enabled = true;
    }
  } finally {
    work.ce._cacheStats.enabled = false;
  }
  return { versionAxes: ['any', 'type', 'evaluation'], versionDeltas: versions().map((x, i) => Number.isFinite(x - before[i]) ? x - before[i] : null), cacheStats: work.ce._cacheStats.snapshot() };
}

async function profile(name, method, mutation) {
  const work = setup(name, method, mutation);
  for (let i = 0; i < 1000; i++) { work.write(i); work.check(work.evaluate()); }
  const session = new Session();
  session.connect();
  const post = (command, params = {}) => new Promise((resolve, reject) => {
    session.post(command, params, (error, result) => error ? reject(error) : resolve(result));
  });
  try {
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 250 });
    await post('Profiler.start');
    let result;
    let profileCalls = 0;
    const started = performance.now();
    do {
      for (let i = 0; i < 256; i++) { work.write(profileCalls++); result = work.evaluate(); }
    } while (performance.now() - started < profileMs);
    const { profile: cpu } = await post('Profiler.stop');
    work.check(result);
    const nodes = new Map(cpu.nodes.map((node) => [node.id, node]));
    const hits = new Map();
    for (const id of cpu.samples ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
    const key = (frame) => JSON.stringify([frame.url, frame.functionName, frame.lineNumber, frame.columnNumber]);
    const byFunction = new Map();
    for (const [id, samples] of hits) {
      const frame = nodes.get(id).callFrame;
      const prior = byFunction.get(key(frame));
      if (prior) prior.samples += samples;
      else byFunction.set(key(frame), {frame, samples});
    }
    const cpuSelf = [...byFunction.values()].sort((a, b) => b.samples - a.samples).slice(0, 30);
    assert((cpu.samples?.length ?? 0) >= 1000, 'Too few CPU samples; increase PROFILE_MS');
    await collect();
    await post('HeapProfiler.startSampling', {
      samplingInterval: 32768,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    for (let i = 0; i < 1000; i++) { work.write(i); result = work.evaluate(); }
    const { profile: heap } = await post('HeapProfiler.stopSampling');
    work.check(result);
    const allocations = [];
    const walk = (node, path) => {
      const next = [...path, node.callFrame.functionName || '(anonymous)'];
      if (node.selfSize) allocations.push({ frame: node.callFrame, bytes: node.selfSize, path: next });
      for (const child of node.children) walk(child, next);
    };
    walk(heap.head, []);
    allocations.sort((a, b) => b.bytes - a.bytes);
    const allocatedByFunction = new Map();
    for (const entry of allocations) {
      const prior = allocatedByFunction.get(key(entry.frame));
      if (prior) prior.bytes += entry.bytes;
      else allocatedByFunction.set(key(entry.frame), {frame: entry.frame, bytes: entry.bytes});
    }
    return { profileCalls, profileMs, cpuSamples: cpu.samples?.length ?? 0, cpuSelf, cpuNodes: cpu.nodes, cpuSampleIds: cpu.samples,
      allocationSamples: heap.samples.length, allocationBytesPerCall: allocations.reduce((sum, x) => sum + x.bytes, 0) / 1000,
      allocationSelf: [...allocatedByFunction.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 30), allocationPaths: allocations.slice(0, 30), includesAssignment: mutation !== 'unchanged' };
  } finally {
    session.disconnect();
  }
}

const metadata = {
  root, entry, entrySha256: createHash('sha256').update(readFileSync(`${root}/${entry}`)).digest('hex'),
  execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? null, mode, runs, iterations, node: process.version, precision: 'machine', jit: 'off',
  commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['-C', root, 'diff', 'HEAD'], {maxBuffer: 64 * 1024 * 1024})).digest('hex'),
};
console.log(JSON.stringify({ metadata }));
// The timer control includes two clock reads, matching each evaluation sample.
if (mode === 'timing') {
  let overhead = 0;
  for (let i = 0; i < 10000; i++) { const start = performance.now(); overhead += performance.now() - start; }
  console.log(JSON.stringify({ timerControlMs: overhead / 10000 }));
}
const ids = Object.keys(formulas).flatMap((name) =>
  ['exact', 'numeric'].flatMap((method) =>
    ['unchanged', 'relevant', 'unrelated'].map((mutation) => `${name}/${method}/${mutation}`)
  )
);
if (only) assert(only.length > 0 && only.every((id) => ids.includes(id)), 'Unknown or empty ONLY selector');
for (const name of Object.keys(formulas)) {
  for (const method of ['exact', 'numeric']) {
    for (const mutation of ['unchanged', 'relevant', 'unrelated']) {
      const id = `${name}/${method}/${mutation}`;
      if (only && !only.includes(id)) continue;
      const result = mode === 'timing' ? await timing(name, method, mutation) :
        mode === 'counts' ? counts(name, method, mutation) : await profile(name, method, mutation);
      console.log(JSON.stringify({ id, ...result }));
    }
  }
}
