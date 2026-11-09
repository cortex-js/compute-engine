// Source-only, serial compilation benchmark. Setup and validation are untimed.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, loadavg } from 'node:os';

const root = resolve(process.argv[2] ?? '.');
const load = p => import(pathToFileURL(resolve(root, p)));
const { ComputeEngine } = await load('src/compute-engine.ts');
const { compile } = await load('src/compute-engine/compilation/compile-expression.ts');
const { core } = await load('src/compute-engine/compilation/compiler-core-hooks.ts');
const limits = await load('src/compute-engine/compilation/compile-folding.ts');
const mode = process.env.MODE ?? 'check';
assert(['check', 'timing', 'work', 'profile'].includes(mode));
const runs = Number(process.env.RUNS ?? 7);
const iterations = Number(process.env.ITERATIONS ?? 10);
assert(Number.isInteger(runs) && runs > 0 && Number.isInteger(iterations) && iterations > 0);
const only = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
const hash = text => createHash('sha256').update(text).digest('hex');
const close = (actual, expected) => assert(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const fixtures = [];
function engine() { return new ComputeEngine({ precision: 'machine' }); }
function graph(ce, depth, shared) {
  const nodes = [];
  const levels = new Map();
  function make(d) {
    if (d === 0) {
      const e = ce.function('Add', [ce.number(2), ce.function('Sqrt', [ce.number(3)])]);
      levels.set(e, 0); return e;
    }
    const a = make(d - 1);
    const e = ce._fn('Add', [a, shared ? a : make(d - 1)]);
    nodes.push(e); levels.set(e, d); return e;
  }
  return { e: make(depth), nodes, levels };
}
for (const shared of [true, false]) for (const depth of shared ? [4, 8, 12, 13, 16, 24] : [4, 8]) {
  for (const fold of [true, false]) fixtures.push({
    id: `${shared ? 'shared' : 'unshared'}/d${depth}/fold-${fold}`,
    setup() {
      const ce = engine();
      const g = graph(ce, depth, shared);
      return { ...g, run: () => compile(g.e, { constantFold: fold }), check(r) {
        assert(r.success, JSON.stringify(r.unsupported));
        close(r.run(), 2 ** depth * (2 + Math.sqrt(3)));
        if (!fold) assert.match(r.code, /\+/);
      }};
    },
  });
}
for (const fold of [true, false]) for (const host of ['slider-js', 'slider-glsl', 'map', 'constant-parameter']) fixtures.push({
  id: `host/${host}/fold-${fold}`,
  setup() {
    const ce = engine();
    let e, options = { constantFold: fold }, checkValue;
    let nodes = [], levels = new Map();
    if (host.startsWith('slider')) {
      ce.declare('x', 'real'); ce.declare('T', 'real'); ce.assign('T', 2);
      e = ce.box(['Add', ['Sin', ['Multiply', 'T', 'x']], ['Cos', ['Multiply', 'T', 'x']], ['Sqrt', 3]]);
      options = { ...options, vars: { T: 'T', x: 'x' } };
      if (host === 'slider-glsl') options.to = 'glsl';
      else options.vars = { T: '_.T', x: '_.x' };
      checkValue = r => {
        assert.match(r.code, host === 'slider-glsl' ? /sin\(/ : /Math\.sin/);
        if (host === 'slider-glsl') { assert.match(r.code, /\bT\b/); assert.match(r.code, /\bx\b/); }
        if (host === 'slider-js') for (const T of [1, 2, 3]) for (const x of [0, 0.25, 2])
          close(r.run({T, x}), Math.sin(T * x) + Math.cos(T * x) + Math.sqrt(3));
      };
    } else if (host === 'map') {
      e = ce.box(['Map', ['Function', ['Add', ['Sin', 't'], ['Cos', 't']], 't'], ['List', 0, 1, 2, 3]]);
      checkValue = r => { const a = r.run(); assert.equal(a.length, 4); for (let i = 0; i < 4; i++) close(a[i], Math.sin(i) + Math.cos(i)); };
    } else {
      ce.declare('x', 'real');
      const g = graph(ce, 4, true);
      const c = g.e; nodes = g.nodes; levels = g.levels;
      const f = ce._fn('Function', [ce._fn('Add', [ce.symbol('t'), c]), ce.symbol('t')]);
      e = ce._fn('Add', [ce._fn('Apply', [f, ce.symbol('x')]), c]);
      checkValue = r => { for (const x of [-2, 0, 3]) close(r.run({x}), x + 32 * (2 + Math.sqrt(3))); };
    }
    return { e, nodes, levels, run: () => compile(e, options), check(r) {
      assert(r.success, JSON.stringify(r.unsupported)); checkValue(r);
    }};
  },
});
for (const id of only) assert(fixtures.some(f => f.id === id), `unknown ONLY selector ${id}`);
function summary(values) {
  const sorted = [...values].sort((a,b) => a-b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1), samples: values };
}
function instrument(s, profile) {
  let reads = 0;
  const sites = new Map(), targets = new Map(), estimates = [], folds = [], evaluations = [];
  const restore = [];
  const operations = { canonicalReads: 0, canonicalRebuilds: 0, functionJsonReads: 0, functionEvaluateCalls: 0 };
  for (const node of s.nodes) {
    const ops = node.ops;
    Object.defineProperty(node, 'ops', { configurable: true, get() {
      if (++reads > 2_000_000) throw Error('instrument safety ceiling');
      if (profile) {
        const site = new Error().stack.split('\n')[2].trim().replaceAll('/private' + root, '<root>').replaceAll(root, '<root>');
        sites.set(site, (sites.get(site) ?? 0) + 1);
      }
      return ops;
    }});
    restore.push(() => delete node.ops);
  }
  if (profile) {
    const proto = Object.getPrototypeOf(s.e);
    for (const [name, counter] of [['canonical', 'canonicalReads'], ['json', 'functionJsonReads']]) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (!descriptor?.get) continue;
      Object.defineProperty(proto, name, { ...descriptor, get() {
        operations[counter]++;
        const result = descriptor.get.call(this);
        if (name === 'canonical' && result !== this) operations.canonicalRebuilds++;
        return result;
      }});
      restore.push(() => Object.defineProperty(proto, name, descriptor));
    }
    const evaluate = proto.evaluate;
    proto.evaluate = function(...args) { operations.functionEvaluateCalls++; return evaluate.apply(this, args); };
    restore.push(() => { proto.evaluate = evaluate; });
    const cost = core.foldCostEstimate, fold = core.constantFoldValue;
    core.foldCostEstimate = (node, depth = 0, ctx) => {
      if (ctx !== undefined) return cost(node, depth, ctx);
      const c = { inProgress: new Set(), cache: new Map(), visits: 0 };
      const result = cost(node, depth, c);
      estimates.push({ level: s.levels.get(node) ?? null, cost: Number.isFinite(result) ? result : String(result), visits: c.visits });
      return result;
    };
    core.constantFoldValue = (node, target) => {
      if (!targets.has(target)) targets.set(target, targets.size);
      const result = fold(node, target);
      folds.push({ level: s.levels.get(node) ?? null, target: targets.get(target), folded: result !== undefined, language: target.language, bound: [...(target.boundVars ?? [])] });
      return result;
    };
    restore.push(() => { core.foldCostEstimate = cost; core.constantFoldValue = fold; });
    for (const [node, level] of s.levels) {
      const N = node.N;
      node.N = function(...args) { evaluations.push(level); return N.apply(this, args); };
      restore.push(() => delete node.N);
    }
  }
  return { finish() { for (const undo of restore.reverse()) undo(); return { reads: s.nodes.length ? reads : null, instrumentedNodes: s.nodes.length, sites: [...sites].sort((a,b) => b[1]-a[1]), estimates, folds, evaluations, operations }; } };
}
console.log(JSON.stringify({ environment: {
  root, node: process.version, cpu: cpus()[0].model, cores: cpus().length, load: loadavg(), mode, runs, iterations,
  revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  sourceDiffSha256: hash(execFileSync('git', ['-C', root, 'diff', 'HEAD', '--', 'src'], {encoding: 'utf8'})),
  precision: 'machine', entry: 'source via tsx', operandReadScope: 'Original outer Add nodes only; excludes base Add, number objects and rebuilt nodes. null means no instrumented graph.', first: 'fresh engine/expression in loaded process', warm: 'same engine/expression, five warmups',
  limits: Object.fromEntries(['CONSTANT_FOLD_MAX_COST', 'CONSTANT_FOLD_MAX_DEPTH', 'CONSTANT_FOLD_MAX_VISITS', 'CONSTANT_FOLD_MAX_COLLECTION_SIZE', 'CONSTANT_FOLD_MAX_INLINE_ELEMENTS'].map(k => [k, limits[k]])),
}}));
for (const f of fixtures) {
  if (only.size && !only.has(f.id)) continue;
  if (mode === 'timing') {
    const first = [], warm = [];
    for (let i = 0; i < runs; i++) {
      const s = f.setup(); const start = performance.now(); const r = s.run(); first.push(performance.now() - start); s.check(r);
    }
    const s = f.setup(); for (let i = 0; i < 5; i++) s.check(s.run());
    for (let i = 0; i < runs; i++) {
      const results = new Array(iterations); const start = performance.now();
      for (let j = 0; j < iterations; j++) results[j] = s.run();
      warm.push((performance.now() - start) / iterations);
      for (const r of results) s.check(r);
    }
    console.log(JSON.stringify({ id: f.id, first: summary(first), warm: summary(warm) }));
  } else {
    const s = f.setup();
    const meter = mode === 'check' ? undefined : instrument(s, mode === 'profile');
    let r, work;
    try { r = s.run(); } finally { work = meter?.finish(); }
    s.check(r);
    const source = (r.preamble ?? '') + r.code;
    console.log(JSON.stringify({ id: f.id, check: 'passed', codeLength: source.length, codeSha256: hash(source), ...work }));
  }
}
