// Workloads for the evaluation-cache audit. Each workload aims at one or more
// caches. Run:  npx tsx workloads.mts <repo root> [names,...]
// Prints, per workload, the median of RUNS runs (after one warm-up) in ms,
// and a digest of the results so that runs with a cache off can be compared
// with the baseline for a changed result.
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const root = process.argv[2] ?? '/Users/arno/dev/compute-engine';
const only = process.argv[3]?.split(',');
const RUNS = Number(process.env.RUNS ?? 5);
const { ComputeEngine } = await import(`${root}/src/compute-engine.ts`);

type Workload = { name: string; setup: () => () => string };

const w: Workload[] = [];

// Tycho document open: 15 large surface bodies (lazy views, comprehensions).
w.push({
  name: 'tycho-evaluate',
  setup: () => {
    const fx = JSON.parse(
      gunzipSync(
        readFileSync(
          `${root}/benchmarks/tycho-document-open/2ki2hjsouf.fixture.json.gz`
        )
      ).toString()
    );
    return () => {
      const ce = new ComputeEngine();
      ce.precision = 'machine';
      ce.angularUnit = fx.engine.angularUnit;
      ce.declare('u', 'real');
      ce.declare('v', 'real');
      let out = '';
      for (const e of fx.evaluate) out += ce.box(e.json).evaluate().toString().length + ';';
      return out;
    };
  },
});

// Shared node: Max(t, t) nested 22 deep (memo of shared subexpressions).
w.push({
  name: 'shared-max-22',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    ce.assign('y', 3);
    let t = ce.function('Add', [ce.symbol('x'), ce.symbol('y')]);
    for (let i = 0; i < 22; i++) t = ce.function('Max', [t, t]);
    return t.evaluate().toString();
  },
});

// Recursive user function (application memo, type and sign caches).
w.push({
  name: 'recursion-fib',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.parse('f(n) := \\operatorname{if} n < 2 \\operatorname{then} n \\operatorname{else} f(n-1) + f(n-2)').evaluate();
    return ce.parse('f(16)').evaluate().toString();
  },
});

// Repeated reads of one lazy view (element memo, facet memo, lazy value memo).
w.push({
  name: 'lazy-reads',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['Map', ['Function', ['Power', 'k', 2], 'k'], ['Range', 1, 3000]]));
    const s = ce.box(['Sum', 'xs']);
    const c = ce.box(['Count', 'xs']);
    const a = ce.box(['At', 'xs', 1500]);
    let out = '';
    for (let i = 0; i < 20; i++)
      out += s.evaluate().toString() + c.evaluate().toString() + a.evaluate().toString();
    return out;
  },
});

// Accumulator loop (lazy value memo, constant key).
w.push({
  name: 'accumulator',
  setup: () => () => {
    const ce = new ComputeEngine();
    return ce.box([
        'Block',
        ['Assign', 'xs', ['List']],
        ['Loop', ['Assign', 'xs', ['Append', 'xs', 'i']], ['Element', 'i', ['Range', 1, 400]]],
        ['Length', 'xs'],
      ]).evaluate().toString();
  },
});

// Sequence terms (sequence term memo).
w.push({
  name: 'sequence',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    let out = '';
    for (let i = 0; i < 5; i++) out += ce.parse('F_{300}').evaluate().toString().length;
    return out;
  },
});

// Limits and series (Limit probes, contour zero memo, comparison approximations).
w.push({
  name: 'limits-series',
  setup: () => () => {
    const ce = new ComputeEngine();
    const xs = [
      '\\lim_{x\\to\\infty} \\frac{e^{2x}}{x^3}',
      '\\lim_{x\\to 0} \\frac{\\sin x - x}{x^3}',
      '\\lim_{x\\to 0} \\frac{1-\\cos x}{x^2}',
      '\\lim_{x\\to\\infty} (1+1/x)^x',
    ];
    let out = '';
    for (let i = 0; i < 3; i++)
      for (const s of xs) out += ce.parse(s).evaluate().toString() + ';';
    out += ce.box(['Series', ['Divide', ['Sin', 'x'], 'x'], 'x', 0, 6]).evaluate().toString();
    return out;
  },
});

// Comparisons of constants (approximations of the comparisons).
w.push({
  name: 'compare-constants',
  setup: () => () => {
    const ce = new ComputeEngine();
    let out = '';
    for (let i = 0; i < 200; i++)
      out += ce.box(['Less', ['Add', ['Sqrt', 2], ['Sqrt', 3]], ['Sqrt', 10]]).evaluate().toString();
    return out;
  },
});

// Factor and simplify (factor memo, type caches).
w.push({
  name: 'simplify-factor',
  setup: () => () => {
    const ce = new ComputeEngine();
    let out = '';
    const ss = [
      'x^4 - 1',
      '\\frac{x^2-1}{x-1}',
      '\\sin^2 x + \\cos^2 x',
      'x^6 - y^6',
      '(x+1)^3 - x^3',
    ];
    for (let i = 0; i < 3; i++)
      for (const s of ss) out += ce.parse(s).simplify().toString() + ';';
    out += ce.box(['Factor', ['Subtract', ['Power', 'x', 8], 1]]).evaluate().toString();
    return out;
  },
});

// Map auto-compile over a large list.
w.push({
  name: 'map-compile',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('a', 3);
    const m = ce.box(['Map', ['Function', ['Multiply', 'a', ['Sin', 'k']], 'k'], ['Range', 1, 20000]]);
    let out = '';
    // `.N()` of a lazy `Map` marks the element function numeric; draining that
    // view at machine precision is what uses the compiled element function.
    const view = m.evaluate().N();
    for (let i = 0; i < 5; i++) {
      let last = '';
      for (const x of view.each()) last = x.toString();
      out += last + ';';
    }
    return out;
  },
});

// Symbol stored values read many times, with unrelated writes in between.
w.push({
  name: 'stored-values',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.box(['Add', ['Sqrt', 2], ['Multiply', 3, 'q']]));
    ce.assign('q', 5);
    const e = ce.box(['Multiply', 'p', 'p', 'p']);
    let out = '';
    for (let i = 0; i < 300; i++) {
      ce.assign('z', i);
      out += e.N().toString().length;
    }
    return out;
  },
});

// Type reads after writes (type and sign caches).
w.push({
  name: 'type-reads',
  setup: () => () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\sum_{k=1}^{10} \\frac{\\sin(k x)}{k} + \\sqrt{x^2+1} \\cdot \\ln(x+2)');
    let out = '';
    for (let i = 0; i < 300; i++) {
      ce.assign('z', i);
      out += e.type.toString().length + String(e.sgn);
    }
    return out;
  },
});

const pick = only ? w.filter((x) => only.includes(x.name)) : w;
console.log(`load before: ${loadavg().map((x) => x.toFixed(2)).join(' ')}`);
console.log(`CE_CACHE_OFF=${process.env.CE_CACHE_OFF ?? ''}`);
for (const wl of pick) {
  const times: number[] = [];
  let digest = '';
  let error = '';
  try {
    const run = wl.setup();
    for (let i = 0; i <= RUNS; i++) {
      const t0 = performance.now();
      const r = run();
      const dt = performance.now() - t0;
      if (i > 0) times.push(dt);
      digest = createHash('sha1').update(r).digest('hex').slice(0, 10);
      if (i === 0 && process.env.DUMP) console.log(`  ${wl.name} result: ${r.slice(0, 160)}`);
    }
  } catch (err) {
    error = String(err).slice(0, 120);
  }
  times.sort((a, b) => a - b);
  const med = times.length ? times[Math.floor(times.length / 2)] : NaN;
  console.log(
    `${wl.name.padEnd(18)} median ${med.toFixed(1).padStart(9)} ms  range ${(times[0] ?? NaN).toFixed(1)}-${(times[times.length - 1] ?? NaN).toFixed(1)}  digest ${digest}${error ? '  ERROR ' + error : ''}`
  );
}
console.log(`load after: ${loadavg().map((x) => x.toFixed(2)).join(' ')}`);
