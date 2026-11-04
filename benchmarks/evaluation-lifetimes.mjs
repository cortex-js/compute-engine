/**
 * Measure first and warm interpreter calls, lazy consumption, and escaping values.
 * Run with node --expose-gc --import tsx and a comparator checkout path.
 * See benchmarks/README.md for paired-run and memory interpretation rules.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Session } from 'node:inspector';
import { setImmediate } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2] ?? '.');
const { ComputeEngine } = await import(pathToFileURL(`${root}/src/core.ts`).href);
const runs = Number(process.env.RUNS ?? 7);
const iterations = Number(process.env.ITERATIONS ?? 40);
assert(Number.isInteger(runs) && runs > 0);
assert(Number.isInteger(iterations) && iterations > 0);
assert(global.gc, 'Run node --expose-gc --import tsx');
const range = ['Range', 1, 128];
const add = ['Function', ['Add', 'x', 1], 'x'];
const setups = {
  control: ce => ({run: () => ce.number(3), check: r => assert.equal(r.re, 3)}),
  boxing: ce => {
    ce.assign('f', ce.box(['Function', ['Add', ['Power', 'x', 2], 1], 'x']));
    let i = 0;
    return {run: () => ce.box(['f', ++i]), check: r => assert.equal(r.operator, 'f')};
  },
  ordinary: ce => {
    ce.assign('f', ce.box(['Function', ['Add', ['Power', 'x', 2], 1], 'x']));
    let i = 0;
    return { run: () => ce.box(['f', ++i]).evaluate(), expected: () => i, check: (r, n = i) => assert.equal(r.re, n*n+1) };
  },
  repeated: ce => {
    ce.assign('a', 3);
    const e = ce.box(['Add', ['Power', 'a', 2], 1]);
    return {run: () => e.evaluate(), check: r => assert.equal(r.re, 10)};
  },
  dictionary: ce => {
    ce.assign('a', 3);
    const e = ce.function('Dictionary', [ce.function('KeyValuePair', [ce.string('a'), ce.box(['Add', 'a', 1])]), ce.function('KeyValuePair', [ce.string('b'), ce.box(['Power', 'a', 2])])]);
    return {run: () => e.evaluate(), check: r => {assert.equal(r.get('a').re, 4); assert.equal(r.get('b').re, 9)}};
  },
  consumed: ce => {
    ce.assign('f', ce.box(['Function', ['Sum', ['Map', ['Function', ['Add', 'x', 'd'], 'x'], range]], 'd']));
    let i = 0;
    return {run: () => ce.box(['f', ++i]).evaluate(), expected: () => i, check: (r, n = i) => assert.equal(r.re, 8256+128*n)};
  },
  nested: ce => {
    let e = range;
    for (let j = 0; j < 4; j++) e = ['Map', add, e];
    e = ce.box(['Sum', e]);
    return {run: () => e.evaluate(), check: r => assert.equal(r.re, 8768)};
  },
  closure: ce => {
    ce.assign('make', ce.box(['Function', ['Function', ['Add', 'x', 'd'], 'x'], 'd']));
    let i = 0;
    return {run: () => ce.box(['make', ++i]).evaluate(), expected: () => i, check: (r, n = i) => assert.equal(ce.box(['Apply', r, 2]).evaluate().re, n+2)};
  },
  view: ce => {
    ce.assign('make', ce.box(['Function', ['Map', ['Function', ['Add', 'x', 'd'], 'x'], range], 'd']));
    let i = 0;
    return {run: () => ce.box(['make', ++i]).evaluate(), expected: () => i, check: (r, n = i) => {assert.equal(r.operator, 'Map'); const a = Array.from(r.each(), x => x.re); assert.deepEqual(a, Array.from({length:128}, (_,j)=>j+1+n))}};
  },
};
const median = a => [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const summary = a => ({median: median(a), min: Math.min(...a), max: Math.max(...a)});
console.log(JSON.stringify({root, node: process.version, runs, iterations, precision:'machine', entry:'core', jit:'off', trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['-C', root, 'diff', 'HEAD'])).digest('hex'), commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), allocation: 'inspector sampling, 32768-byte interval; separate from timings'}));
for (const [name, setup] of Object.entries(setups)) {
  const first = [], warm = [];
  const collect = async () => {
    await setImmediate(); // WeakRef targets become collectible after the job ends.
    for (let j = 0; j < 3; j++) global.gc();
  };
  for (let trial = 0; trial < runs; trial++) {
    const ce = new ComputeEngine(); ce.precision = 'machine'; ce.jit = 'off';
    const w = setup(ce);
    await collect();
    const start = performance.now(); const r = w.run(); first.push(performance.now()-start); w.check(r);
    // Warm the runtime and each workload independently of the measured batch.
    for (let j=0;j<10;j++) w.check(w.run());
    await collect();
    const startWarm = performance.now();
    const results = Array.from({length: iterations}, () => { const r = w.run(); return [r, w.expected?.()]; });
    warm.push((performance.now()-startWarm)/iterations);
    for (const [r, expected] of results) w.check(r, expected);
  }
  const ce = new ComputeEngine(); ce.precision = 'machine'; ce.jit = 'off';
  const w = setup(ce); for(let j=0;j<iterations;j++) w.check(w.run());
  const holding = [], released = [];
  for (let trial = 0; trial < 3; trial++) {
    await collect();
    const before = process.memoryUsage().heapUsed;
    let retained = Array.from({length: iterations}, () => {
      const r = w.run();
      return [r, w.expected?.()];
    });
    await collect();
    holding.push(process.memoryUsage().heapUsed - before);
    // Validate all activations together, after sampling unconsumed results.
    for (const [r, expected] of retained) w.check(r, expected);
    retained = undefined;
    await collect();
    released.push(process.memoryUsage().heapUsed - before);
  }
  const session = new Session(); session.connect();
  const post = (method, params={}) => new Promise((resolve,reject) => session.post(method, params, (e,r) => e ? reject(e) : resolve(r)));
  await post('HeapProfiler.startSampling', {samplingInterval:32768, includeObjectsCollectedByMajorGC:true, includeObjectsCollectedByMinorGC:true});
  const allocationIterations = Math.max(200, iterations);
  for(let j=0;j<allocationIterations;j++) w.run();
  const {profile} = await post('HeapProfiler.stopSampling'); session.disconnect();
  const bytes = node => node.selfSize + node.children.reduce((n,c)=>n+bytes(c),0);
  console.log(JSON.stringify({name, firstMs: summary(first), warmMs:summary(warm), holdingBytes:summary(holding), releasedBytes:summary(released), allocationSamples:profile.samples.length, sampledAllocationBytesPerCall:bytes(profile.head)/allocationIterations, allocationIterations}));
}
