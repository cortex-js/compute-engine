// Usage: node --expose-gc --import tsx benchmarks/compilation-cost.mjs ROOT [--check]
// Setup and result checks are outside the timers. Hold the box lock for timings.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? '.');
const checkOnly = process.argv.includes('--check');
const countsOnly = process.env.MODE === 'counts';
if (process.env.MODE !== undefined && !countsOnly) throw new Error('MODE must be counts or omitted');
const { ComputeEngine, compile } = await import(pathToFileURL(resolve(root, 'src/compute-engine.ts')));
const runs = Number(process.env.RUNS ?? 7);
const iterations = Number(process.env.ITERATIONS ?? 20);
assert.ok(Number.isInteger(runs) && runs > 0);
assert.ok(Number.isInteger(iterations) && iterations > 0);
const cases = [
  { id: 'identity', json: 'x', expected: (x) => x },
  { id: 'plot', json: ['Add', ['Sin', ['Multiply', 'a', 'x']], ['Divide', ['Power', 'x', 2], 10]], expected: (x, a) => Math.sin(a * x) + x * x / 10 },
  { id: 'slider', slider: true, json: ['Add', ['Sin', ['Multiply', 'a', 'x']], 'a'], expected: (x, a) => Math.sin(a * x) + a },
  { id: 'radical-strict', json: ['Sqrt', ['Add', ['Power', 'x', 2], 1]], expected: (x) => Math.sqrt(x * x + 1) },
  { id: 'folded-complex', mode: 'complex', constantFold: true, json: ['Add', 'x', ['Sqrt', ['Sum', ['Cos', 'k'], ['Limits', 'k', 1, 5]]]], expected: (x) => ({ re: x, im: Math.sqrt(-[1, 2, 3, 4, 5].reduce((s, k) => s + Math.cos(k), 0)) }) },
  { id: 'radical-complex', mode: 'complex', json: ['Sqrt', 'x'], expected: (x) => x < 0 ? { re: 0, im: Math.sqrt(-x) } : Math.sqrt(x) },
  { id: 'list-map', json: ['Map', ['Function', ['Add', ['Multiply', 't', 't'], 'x'], 't'], 'L'], expected: (x) => [1 + x, 4 + x, 9 + x] },
  { id: 'point', json: ['Add', ['At', 'P', 1], ['Multiply', 'x', ['At', 'P', 2]]], expected: (x) => 2 + 3 * x },
  ...[6, 10].map((foldDepth) => ({ id: `shared-complex-fold-${foldDepth}`, foldDepth, mode: 'complex', constantFold: true, expected: (x) => ({ re: x + 0.75 ** foldDepth, im: 0.75 ** foldDepth }) })),
  ...[6, 10].map((depth) => ({ id: `shared-node-${depth}`, depth, expected: (x) => { for (let i = 0; i < depth; i++) x = Math.sin(x) + Math.cos(x); return x; } })),
  ...[6, 10].map((depth) => ({ id: `shared-node-wgsl-${depth}`, depth, to: 'wgsl' })),
  ...[4, 7].map((functions) => ({ id: `shared-functions-${functions}`, functions, expected: (x) => { let slope = 1, offset = 1; for (let i = 1; i <= functions; i++) { slope *= 3; offset *= 2; } return slope * x + offset; } })),
  { id: 'plot-wgsl', to: 'wgsl', json: ['Add', ['Sin', ['Multiply', 'a', 'x']], ['Divide', ['Power', 'x', 2], 10]] },
];
const only = process.env.ONLY?.split(',');
if (only) for (const id of only) assert.ok(cases.some((c) => c.id === id), `Unknown case ${id}`);
function setup(c) {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('x', 'real'); ce.declare('a', 'real');
  ce.declare('L', 'list<real>'); ce.declare('P', 'tuple<real, real>');
  if (c.slider) ce.assign('a', 2);
  let expr;
  if (c.foldDepth) {
    let value = ce.expr(['Complex', 1, 1]);
    for (let i = 0; i < c.foldDepth; i++) {
      value = ce._fn('Add', [ce._fn('Multiply', [ce.number(0.5), value]), ce._fn('Multiply', [ce.number(0.25), value])]);
      assert.equal(value.ops[0].op2, value.ops[1].op2, 'Closed fixture must retain shared identity');
    }
    expr = ce._fn('Add', [ce.symbol('x'), value]);
  } else if (c.depth) {
    expr = ce.symbol('x');
    for (let i = 0; i < c.depth; i++) {
      const previous = expr;
      expr = ce._fn('Add', [ce._fn('Sin', [previous]), ce._fn('Cos', [previous])]);
      assert.equal(expr.ops[0].op1, expr.ops[1].op1, 'Fixture must retain shared identity');
    }
  } else if (c.functions) {
    for (let i = 0; i <= c.functions; i++) {
      ce.declare(`f_${i}`, 'function');
      const body = i === 0 ? ['Add', 't', 1] : ['Add', [`f_${i - 1}`, 't'], [`f_${i - 1}`, ['Multiply', 2, 't']]];
      ce.assign(`f_${i}`, ce.expr(['Function', body, 't']));
    }
    expr = ce.expr([`f_${c.functions}`, 'x']);
  } else expr = ce.expr(c.json);
  const options = { to: c.to ?? 'javascript', mode: c.mode ?? 'strict', constantFold: c.constantFold ?? false,
    ...(c.slider ? { vars: { a: '_.a' } } : {}) };
  let lookups = 0;
  if (countsOnly) {
    const lookup = ce.lookupDefinition.bind(ce);
    ce.lookupDefinition = (...args) => { lookups++; return lookup(...args); };
  }
  const emit = () => compile(expr, options);
  emit.lookupCount = () => lookups;
  return emit;
}
function close(actual, expected) {
  if (Array.isArray(expected)) { assert.ok(Array.isArray(actual)); assert.equal(actual.length, expected.length); actual.forEach((v, i) => close(v, expected[i])); }
  else if (expected && typeof expected === 'object') { close(actual.re, expected.re); close(actual.im, expected.im); }
  else assert.ok(Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function validate(r, c) {
  assert.equal(r.success, true, `${c.id}: ${r.error}`);
  assert.ok(r.code?.length > 0);
  if (c.expected) for (const [x, a] of [[-2, 2], [0.25, 2], [3, 2], [0.25, 3.5]]) close(r.run({ x, a, L: [1, 2, 3], P: [2, 3] }), c.expected(x, a));
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const summarize = (a) => ({ median: median(a), min: Math.min(...a), max: Math.max(...a) });
console.log(JSON.stringify({ root, revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), runtime: process.version, cpu: cpus()[0].model, precision: 'machine', runs, iterations, warmup: 5, load: loadavg(), checkOnly, countsOnly }));
for (const c of cases.filter((c) => !only || only.includes(c.id))) {
  if (checkOnly || countsOnly) {
    const emit = setup(c), r = emit();
    const firstInstanceLookups = emit.lookupCount();
    validate(r, c);
    const before = emit.lookupCount();
    const next = emit();
    const warmInstanceLookups = emit.lookupCount() - before;
    validate(next, c);
    console.log(JSON.stringify({ id: c.id, supported: true, codeLength: r.code.length, preambleLength: r.preamble?.length ?? 0, sourceDigest: createHash('sha256').update((r.preamble ?? '') + r.code).digest('hex'), ...(countsOnly ? { firstInstanceLookups, warmInstanceLookups } : {}) })); continue;
  }
  const first = [], warm = []; let result;
  for (let trial = 0; trial < runs; trial++) {
    const emit = setup(c);
    global.gc?.();
    let start = performance.now(); result = emit(); first.push(performance.now() - start);
    validate(result, c);
    for (let j = 0; j < 5; j++) validate(emit(), c);
    start = performance.now();
    for (let j = 0; j < iterations; j++) result = emit();
    warm.push((performance.now() - start) / iterations);
    validate(result, c);
  }
  console.log(JSON.stringify({ id: c.id, firstMs: summarize(first), warmMs: summarize(warm), codeLength: result.code.length, preambleLength: result.preamble?.length ?? 0, load: loadavg() }));
}
