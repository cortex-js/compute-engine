/**
 * The caches of evaluated values: what each one saves.
 *
 * Twelve workloads, each aimed at one or more of the engine's caches. Run it
 * once with every cache on, then with `CE_CACHE_OFF=<name>[,<name>…]` (or
 * `all`), one Node process per setting. The switch names are the list
 * `CACHE_SWITCHES` in `src/common/cache-switches.ts`; a switch turns off the
 * look-up of that cache. The ratio of the two times is what the hits of the
 * cache save on that workload.
 *
 * For each workload the script prints the median and the range of RUNS runs
 * (after one warm-up run) in ms, and a digest of the results. The digest is
 * computed after each run, outside the timed part: each result is serialized
 * in full, and a finite collection is serialized element by element, also a
 * lazy one (`toString()` shows only a preview of a long collection). A
 * digest that differs from the run with every cache on means that the
 * setting changed a result. A result that is not valid (an `Error` in it)
 * stops the workload: a workload that measures an error measures nothing.
 * A failed workload prints no digest, and the script then exits with code 1.
 *
 * `map-compile` measures the cost of compiling the element function of a
 * `Map` again at each drain (`mapcompile` off) against compiling it once per
 * engine: its elements are computed by a compiled function in both settings,
 * which the workload checks with `_mapAutoCompileStats`.
 *
 *   npx tsx benchmarks/evaluation-caches.ts                     # RUNS=5
 *   ONLY=shared-max-22,sequence npx tsx benchmarks/evaluation-caches.ts
 *   CE_CACHE_OFF=appmemo npx tsx benchmarks/evaluation-caches.ts
 *
 * Hold the shared-box lock for a timing run. With all the caches off, some
 * workloads take minutes (`shared-max-22`). With the `type` switch off, the
 * type of a recursive function is computed again at each level of the
 * recursion, which is exponential: the workloads marked `slowWithoutType`
 * do not finish in minutes, and the script skips them with a note.
 *
 * Design and the first measurements:
 * `docs/plans/2026-10-30-evaluation-cache-architecture.md`, section 3.3.
 */

import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ComputeEngine } from '../src/compute-engine';
import { CACHE_SWITCHES, cacheOff } from '../src/common/cache-switches';
import type { Expression } from '../src/compute-engine/global-types';
import { _mapAutoCompileStats } from '../src/compute-engine/map-auto-compile-stats';

const RUNS = Number(process.env.RUNS ?? 5);
const ONLY = process.env.ONLY?.split(',').map((s) => s.trim());

// A misspelled switch name would turn off nothing and give a run that looks
// like a measurement, so refuse it.
const switchNames = (process.env.CE_CACHE_OFF ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const unknown = switchNames.filter(
  (s) => s !== 'all' && !(CACHE_SWITCHES as readonly string[]).includes(s)
);
if (unknown.length > 0) {
  console.error(
    `Unknown CE_CACHE_OFF name: ${unknown.join(', ')}. ` +
      `Known names: all, ${CACHE_SWITCHES.join(', ')}.`
  );
  process.exit(2);
}

/** A result of a run: an expression, a number, a text, or a list of them. */
type Result = Expression | number | string | Result[];

type Workload = {
  name: string;
  /** Set-up, not timed. Returns one timed run, which returns the results
   * that the digest is computed from. */
  setup: () => () => Result[];
  /** Called once after the runs, with the number of runs (the warm-up
   * included): throws when the workload did not reach the cache it aims
   * at. */
  check?: (runs: number) => void;
  /** Called once before the runs, to sample what `check` compares. */
  beforeRuns?: () => void;
  /** True when the workload does not finish in minutes with the `type`
   * switch off. */
  slowWithoutType?: boolean;
};

/** The text of `result` for the digest. An expression that is not valid
 * throws. A finite collection is serialized element by element. */
function serialize(result: Result): string {
  if (typeof result === 'string') return JSON.stringify(result);
  if (typeof result === 'number') return String(result);
  if (Array.isArray(result)) return '[' + result.map(serialize).join(',') + ']';
  if (!result.isValid)
    throw new Error(`invalid result: ${result.toString().slice(0, 100)}`);
  if (result.isCollection && result.isFiniteCollection === true) {
    const elements: string[] = [];
    for (const element of result.each()) elements.push(serialize(element));
    return `${result.operator}[${elements.join(',')}]`;
  }
  return result.toString();
}

const workloads: Workload[] = [];

// Tycho document open: the 15 large surface bodies of
// `tycho-document-open/evaluate.ts`, evaluated on a new engine (lazy views,
// element and facet memos, types).
workloads.push({
  name: 'tycho-evaluate',
  slowWithoutType: true,
  setup: () => {
    const fixture = JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            './tycho-document-open/2ki2hjsouf.fixture.json.gz',
            import.meta.url
          )
        )
      ).toString()
    );
    return () => {
      const ce = new ComputeEngine();
      ce.precision = 'machine';
      ce.angularUnit = fixture.engine.angularUnit;
      ce.declare('u', 'real');
      ce.declare('v', 'real');
      return fixture.evaluate.map((e) => ce.box(e.json).evaluate());
    };
  },
});

// One node used twice at each level: `Max(t, t)` nested 22 deep over
// `x + y` (memo of shared subexpressions, effects cache).
workloads.push({
  name: 'shared-max-22',
  slowWithoutType: true,
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    ce.assign('y', 3);
    let t = ce.function('Add', [ce.symbol('x'), ce.symbol('y')]);
    for (let i = 0; i < 22; i++) t = ce.function('Max', [t, t]);
    return [t.evaluate()];
  },
});

// A recursive user function (application memo, type and sign caches).
workloads.push({
  name: 'recursion-fib',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.parse(
      'f(n) := \\operatorname{if} n < 2 \\operatorname{then} n \\operatorname{else} f(n-1) + f(n-2)'
    ).evaluate();
    return [ce.parse('f(16)').evaluate()];
  },
});

// `Sum`, `Count` and `At` of one `Map` over 3,000 elements, read 20 times
// (element memo, facet memo, lazy value memo).
workloads.push({
  name: 'lazy-reads',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.assign(
      'xs',
      ce.box(['Map', ['Function', ['Power', 'k', 2], 'k'], ['Range', 1, 3000]])
    );
    const s = ce.box(['Sum', 'xs']);
    const c = ce.box(['Count', 'xs']);
    const a = ce.box(['At', 'xs', 1500]);
    const out: Result[] = [];
    for (let i = 0; i < 20; i++)
      out.push(s.evaluate(), c.evaluate(), a.evaluate());
    return out;
  },
});

// A `Loop` that appends 400 times to a list (lazy value memo, constant key).
workloads.push({
  name: 'accumulator',
  setup: () => () => {
    const ce = new ComputeEngine();
    const result = ce
      .box([
        'Block',
        ['Assign', 'xs', ['List']],
        [
          'Loop',
          ['Assign', 'xs', ['Append', 'xs', 'i']],
          ['Element', 'i', ['Range', 1, 400]],
        ],
        ['Length', 'xs'],
      ])
      .evaluate();
    return [result];
  },
});

// `F_300` of a Fibonacci sequence declared with `ce.declareSequence`, 5
// times (sequence term memo).
workloads.push({
  name: 'sequence',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    const out: Result[] = [];
    for (let i = 0; i < 5; i++) out.push(ce.parse('F_{300}').evaluate());
    return out;
  },
});

// Four limits, 3 times, and one `Series` (`Limit` probes, contour memos,
// approximations of the comparisons).
workloads.push({
  name: 'limits-series',
  setup: () => () => {
    const ce = new ComputeEngine();
    const limits = [
      '\\lim_{x\\to\\infty} \\frac{e^{2x}}{x^3}',
      '\\lim_{x\\to 0} \\frac{\\sin x - x}{x^3}',
      '\\lim_{x\\to 0} \\frac{1-\\cos x}{x^2}',
      '\\lim_{x\\to\\infty} (1+1/x)^x',
    ];
    const out: Result[] = [];
    for (let i = 0; i < 3; i++)
      for (const s of limits) out.push(ce.parse(s).evaluate());
    out.push(
      ce.box(['Series', ['Divide', ['Sin', 'x'], 'x'], 'x', 0, 6]).evaluate()
    );
    return out;
  },
});

// `√2 + √3 < √10`, 200 times (approximations of the comparisons).
workloads.push({
  name: 'compare-constants',
  setup: () => () => {
    const ce = new ComputeEngine();
    const out: Result[] = [];
    for (let i = 0; i < 200; i++)
      out.push(
        ce
          .box(['Less', ['Add', ['Sqrt', 2], ['Sqrt', 3]], ['Sqrt', 10]])
          .evaluate()
      );
    return out;
  },
});

// Five simplifications, 3 times, and `Factor(x^8 - 1)` (factor memo, type
// caches).
workloads.push({
  name: 'simplify-factor',
  setup: () => () => {
    const ce = new ComputeEngine();
    const out: Result[] = [];
    const inputs = [
      'x^4 - 1',
      '\\frac{x^2-1}{x-1}',
      '\\sin^2 x + \\cos^2 x',
      'x^6 - y^6',
      '(x+1)^3 - x^3',
    ];
    for (let i = 0; i < 3; i++)
      for (const s of inputs) out.push(ce.parse(s).simplify());
    out.push(ce.box(['Factor', ['Subtract', ['Power', 'x', 8], 1]]).evaluate());
    return out;
  },
});

// The numeric values of one `Map` over 150,000 elements, drained 5 times
// at machine precision (`Map` compile cache). The numeric compile of the
// element function runs at machine precision only. The collection has more
// elements than the element memo keeps (`ELEMENT_MEMO_CAP`,
// `collection-element-memo.ts`), so each drain computes its elements, with
// the compiled element function. With every cache on, the function is
// compiled once per run (once per engine) and the cache serves the four
// later drains; with `mapcompile` off, it is compiled again at each drain.
// So the workload measures the cost of compiling again, not compiled
// against interpreted elements: every element is computed by a compiled
// function in both settings (`check`).
const MAP_COMPILE_ELEMENTS = 150_000;
const MAP_COMPILE_DRAINS = 5;
let mapCompileStatsBefore = { ..._mapAutoCompileStats };
workloads.push({
  name: 'map-compile',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('a', 3);
    const m = ce
      .box([
        'Map',
        ['Function', ['Multiply', 'a', ['Sin', 'k']], 'k'],
        ['Range', 1, MAP_COMPILE_ELEMENTS],
      ])
      .N();
    if (!m.isValid) throw new Error(`invalid result: ${m.toString()}`);
    const out: Result[] = [];
    for (let i = 0; i < MAP_COMPILE_DRAINS; i++) {
      const values: number[] = [];
      for (const element of m.each()) values.push(element.re);
      if (values.length !== MAP_COMPILE_ELEMENTS)
        throw new Error(`map-compile: ${values.length} elements`);
      out.push(values);
    }
    return out;
  },
  beforeRuns: () => {
    mapCompileStatsBefore = { ..._mapAutoCompileStats };
  },
  check: (runs) => {
    const attempts =
      _mapAutoCompileStats.attempts - mapCompileStatsBefore.attempts;
    const hits =
      _mapAutoCompileStats.compiledHits - mapCompileStatsBefore.compiledHits;
    const drains = runs * MAP_COMPILE_DRAINS;
    // Every element of every drain is computed by a compiled function. The
    // function is compiled once per run, or once per drain with the
    // `mapcompile` switch off.
    const expectedAttempts = cacheOff('mapcompile') ? drains : runs;
    if (hits !== drains * MAP_COMPILE_ELEMENTS || attempts !== expectedAttempts)
      throw new Error(
        `map-compile: ${attempts} compile attempts and ${hits} compiled elements in ${runs} runs`
      );
  },
});

// `p·p·p` with `p := √2 + 3q`, read 300 times with a write to an unrelated
// symbol between reads (stored value memo).
workloads.push({
  name: 'stored-values',
  setup: () => () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.box(['Add', ['Sqrt', 2], ['Multiply', 3, 'q']]));
    ce.assign('q', 5);
    const e = ce.box(['Multiply', 'p', 'p', 'p']);
    const out: Result[] = [];
    for (let i = 0; i < 300; i++) {
      ce.assign('z', i);
      out.push(e.N());
    }
    return out;
  },
});

// The type and sign of a sum, read 300 times with a write to an unrelated
// symbol between reads (type and sign caches).
workloads.push({
  name: 'type-reads',
  slowWithoutType: true,
  setup: () => () => {
    const ce = new ComputeEngine();
    const e = ce.parse(
      '\\sum_{k=1}^{10} \\frac{\\sin(k x)}{k} + \\sqrt{x^2+1} \\cdot \\ln(x+2)'
    );
    const out: Result[] = [];
    for (let i = 0; i < 300; i++) {
      ce.assign('z', i);
      out.push(e.type.toString(), String(e.sgn));
    }
    return out;
  },
});

const selected = ONLY
  ? workloads.filter((w) => ONLY.includes(w.name))
  : workloads;
if (ONLY && selected.length !== ONLY.length) {
  console.error(
    `Unknown ONLY name. Known names: ${workloads.map((w) => w.name).join(', ')}.`
  );
  process.exit(2);
}

const load = (): string =>
  loadavg()
    .map((x) => x.toFixed(2))
    .join(' ');
console.log(`load before: ${load()}`);
console.log(`CE_CACHE_OFF=${process.env.CE_CACHE_OFF ?? ''}  RUNS=${RUNS}`);
for (const workload of selected) {
  if (workload.slowWithoutType && cacheOff('type')) {
    console.log(
      `${workload.name.padEnd(18)} skipped: does not finish with the type cache off`
    );
    continue;
  }
  const times: number[] = [];
  let digest = '';
  let error = '';
  try {
    const run = workload.setup();
    workload.beforeRuns?.();
    const digests = new Set<string>();
    for (let i = 0; i <= RUNS; i++) {
      const t0 = performance.now();
      const results = run();
      const dt = performance.now() - t0;
      if (i > 0) times.push(dt);
      const text = results.map(serialize).join('\n');
      digests.add(createHash('sha1').update(text).digest('hex').slice(0, 10));
    }
    workload.check?.(RUNS + 1);
    // Each run starts with a new engine, so every run gives the same
    // results.
    if (digests.size !== 1)
      throw new Error(`the runs gave ${digests.size} different results`);
    digest = [...digests][0];
  } catch (err) {
    error = String(err).slice(0, 160);
    process.exitCode = 1;
  }
  times.sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : NaN;
  const low = times[0] ?? NaN;
  const high = times[times.length - 1] ?? NaN;
  console.log(
    `${workload.name.padEnd(18)} median ${median.toFixed(1).padStart(9)} ms` +
      `  range ${low.toFixed(1)}-${high.toFixed(1)}` +
      (error ? `  ERROR ${error}` : `  digest ${digest}`)
  );
}
console.log(`load after: ${load()}`);
