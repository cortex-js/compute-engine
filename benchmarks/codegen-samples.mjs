// Compare generated JS runners from two source checkouts in one warm process.
// Usage: node --import tsx benchmarks/codegen-samples.mjs BASELINE_ROOT CANDIDATE_ROOT
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadavg } from 'node:os';
import assert from 'node:assert/strict';
const roots = process.argv.slice(2);
if (roots.length !== 2)
  throw new Error('Expected baseline and candidate roots');
const modules = await Promise.all(
  roots.map(
    (root) => import(pathToFileURL(resolve(root, 'src/compute-engine.ts')))
  )
);
const epsil = await Promise.all(
  roots.map(
    (root) => import(pathToFileURL(resolve(root, 'src/epsil/execute-epsil.ts')))
  )
);
// The record cases: a field read in a loop (a record made and passed to a
// function at each pass), a named tuple input read field by field, a
// record result, and a field of a carried length read in a loop (`geom`,
// the length of the list `g`). A checkout that declines a case runs its
// `alternative`, the same values with no record (`sumList(g)`).
const RECORDS = `
  type P = tuple<x: real, y: real>
  function dot(q: P) { q.x * q.y }
  function loopRec(t: real) { let s = 0; for i in 1..100 { s = s + dot(P(t + i, i)) }; s }
  function readP(q: P) { q.x + 2 * q.y + q.x * q.y }
  function mk(t: real) { P(cos(t), sin(t)) }
  type T = tuple<kind: string, geom: list<real>>
  function sumGeom(r: T) { let s = 0; for i in 1..length(r.geom) { s = s + r.geom[i] * i }; s }
  function loopCarried(t: real, g: list<real>) { let s = 0; for k in 1..20 { s = s + sumGeom(T("a", g)) * (t + k) }; s }
  function sumList(h: list<real>) { let s = 0; for i in 1..length(h) { s = s + h[i] * i }; s }
  function loopList(t: real, g: list<real>) { let s = 0; for k in 1..20 { s = s + sumList(g) * (t + k) }; s }
`;
const cases = [
  ['compound square', ['Power', ['Add', 'x', 1], 2], 100000],
  ['compound cube', ['Power', ['Add', 'x', 1], 3], 100000],
  ['compound fifth', ['Power', ['Add', 'x', 1], 5], 100000],
  ['exponential', ['Power', 'ExponentialE', 'x'], 100000],
  [
    'repeated trig',
    ['And', ['Less', ['Sin', 'x'], 1], ['Greater', ['Sin', 'x'], 0]],
    100000,
  ],
  [
    'range comprehension',
    [
      'Comprehension',
      ['Multiply', 'k', 'x'],
      ['Element', 'k', ['Range', 1, 'n']],
    ],
    1000,
  ],
  [
    'counter function call',
    ['Sum', ['f', 'k'], ['Limits', 'k', 1, 153]],
    10000,
  ],
  ['record field read in a loop', ['loopRec', 'x'], 10000, RECORDS],
  ['record input read by field', ['readP', 'p'], 100000, RECORDS],
  ['record result', ['mk', 'x'], 100000, RECORDS],
  [
    'record carried field read in a loop',
    ['loopCarried', 'x', 'g'],
    10000,
    RECORDS,
    ['loopList', 'x', 'g'],
  ],
];
let checksum = 0;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
for (const [name, json, iterations, prelude, alternative] of cases) {
  const alternatives = [false, false];
  const fns = modules.map(({ ComputeEngine, compile }, k) => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.expr(['Function', ['Add', 't', 1], 't']));
    if (prelude !== undefined) {
      ce.declare('x', 'real');
      epsil[k].executeEpsil(ce, prelude);
      ce.declare('p', 'P');
      ce.declare('g', 'list<real>');
    }
    const options = { to: 'javascript', constantFold: false, fallback: false };
    let result;
    try {
      result = compile(ce.expr(json), options);
    } catch (e) {
      if (alternative === undefined) throw e;
      alternatives[k] = true;
      result = compile(ce.expr(alternative), options);
    }
    assert.equal(result.success, true);
    return result;
  });
  const evaluate = (fn, count) => {
    const vars = {
      x: 0,
      n: 1000,
      p: { x: 0, y: 2 },
      g: [1, 2.5, 3, -4, 5, 6.25, 7, 8],
    };
    let acc = 0;
    for (let i = 0; i < count; i++) {
      vars.x = (i % 1000) / 100 - 5;
      vars.p.x = vars.x;
      const value = fn.run(vars);
      acc += Array.isArray(value)
        ? value[value.length - 1]
        : typeof value === 'object'
          ? value.x + value.y
          : Number(value);
    }
    checksum += acc;
    return acc;
  };
  const a = evaluate(fns[0], 2000),
    b = evaluate(fns[1], 2000);
  assert.ok(
    Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b)),
    `${name}: numerical disagreement`
  );
  for (let j = 0; j < 3; j++) for (const fn of fns) evaluate(fn, iterations);
  const times = [[], []];
  for (let round = 0; round < 9; round++)
    for (const index of round % 2 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      evaluate(fns[index], iterations);
      times[index].push(((performance.now() - start) * 1e6) / iterations);
    }
  results.push({
    name,
    baselineNs: median(times[0]),
    candidateNs: median(times[1]),
    ratio: median(times[0]) / median(times[1]),
    codeLengths: fns.map((fn) => fn.code.length),
    ...(alternatives.some((x) => x) ? { alternatives } : {}),
  });
}
console.log(
  JSON.stringify(
    { node: process.version, load: loadavg(), results, checksum },
    null,
    2
  )
);
