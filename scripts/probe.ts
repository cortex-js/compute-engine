/** Show what the engine does with one expression, in one command.
 *
 * Prints the raw parse, the canonical form, the type, and the results of
 * `evaluate()`, `.N()` and `simplify()`. Each step is guarded: an exception
 * is printed and the next step still runs.
 *
 * Options:
 *   --json            The input is MathJSON, not LaTeX.
 *   --routes          Evaluate the expression three ways and compare them:
 *                     `ce.parse(latex)`, `ce.box(rawJson)`, and
 *                     `ce.function(operator, boxedOperands)`. A lazy operator
 *                     without a `canonical` handler receives unbound operands
 *                     on the first two routes only, so a difference here
 *                     points at that class of defect. A route that throws
 *                     while another route gives a result counts as a
 *                     difference. When fewer than two routes give a result,
 *                     there is nothing to compare and the script says so.
 *                     The exit code is 1 when the routes differ.
 *   --check <expr>    Compare the input against a second expression (same
 *                     syntax as the input) at sample points of their free
 *                     variables. Use it to verify an identity or a special
 *                     value numerically before encoding it. A point fails
 *                     (DIFF) when the two values do not agree, when a side
 *                     does not evaluate to a number (NOT NUMERIC, for example
 *                     an unknown function or a variable that is not
 *                     substituted), or when a side throws (THROWS). Two NaN
 *                     number literals agree. Two values that are not finite
 *                     agree only when they are equal (`+oo` and `+oo`). The
 *                     exit code is 1 when a point fails.
 *   --at x=0.5,y=2    An exact sample point. Repeat the option for more
 *                     points. Without `--check`, prints the value at each
 *                     point. Each pair must be `name=number`. With `--check`,
 *                     each point must give a value to every free variable of
 *                     both expressions.
 *   --points <n>      Number of random sample points (default 6) when no
 *                     `--at` is given. The points are seeded, so a run is
 *                     repeatable. A random point is a real number, except
 *                     for a variable whose type is `integer`, which gets the
 *                     nearest integer (inside the range when the range holds
 *                     one). A variable that only appears as the bound of a
 *                     sum (`n` in `\sum_{k=1}^{n} k`) is typed `number`, not
 *                     `integer`, so it gets real values: give exact integer
 *                     points instead, `--at n=3 --at n=7`.
 *   --range a,b       Interval for random sample points (default 0.1,3),
 *                     with a < b. Write a negative bound as `--range=-1,1`:
 *                     without the `=`, the option parser reads `-1,1` as an
 *                     option and rejects it.
 *   --tolerance <t>   Tolerance for `--check` (default 1e-9). It is relative
 *                     when a value is larger than 1 in magnitude, and
 *                     absolute otherwise.
 *   --precision <n>   Engine precision in digits (a positive integer).
 *   --no-simplify     Skip `simplify()`, which can be slow.
 *
 * An invalid option value (for example `--points 0` or `--at x=abc`) prints a
 * message and ends the script with exit code 2. An input that starts with `-`
 * goes after `--`, so that it is not read as an option:
 * `npx tsx scripts/probe.ts --check 'x' -- '-x'`.
 *
 * Examples:
 *   npx tsx scripts/probe.ts '\arcoth(2)'
 *   npx tsx scripts/probe.ts --check '\frac12\ln\frac{x+1}{x-1}' '\arcoth(x)' --range 1.1,5
 *   npx tsx scripts/probe.ts --json --routes '["Sum", ["Power", "k", 2], ["Limits", "k", 1, 10]]'
 */
import { parseArgs } from 'node:util';
import { ComputeEngine } from '../src/compute-engine';
import type { Expression } from '../src/compute-engine/global-types';
import type { MathJsonExpression } from '../src/math-json/types';
import {
  isFunction,
  isNumber,
} from '../src/compute-engine/boxed-expression/type-guards';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'json': { type: 'boolean', default: false },
    'routes': { type: 'boolean', default: false },
    'check': { type: 'string' },
    'at': { type: 'string', multiple: true },
    'points': { type: 'string', default: '6' },
    'range': { type: 'string', default: '0.1,3' },
    'tolerance': { type: 'string', default: '1e-9' },
    'precision': { type: 'string' },
    'no-simplify': { type: 'boolean', default: false },
  },
});

if (positionals.length !== 1) {
  console.error(
    'Usage: npx tsx scripts/probe.ts [--json] [--routes] [--check <expr>] [--at x=1,y=2]… <expr>'
  );
  process.exit(2);
}

// When the output goes to a pipe that closes early (`| head`), stop quietly
// instead of crashing with an EPIPE stack trace.
process.stdout.on('error', (err: { code?: string }) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

/** Print a message about a bad option value and end with exit code 2. */
function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

/** The finite number that `s` spells, or `undefined`. An empty string is not
 * a number (`Number('')` is 0). */
function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const range = values.range.split(',').map(parseNumber);
if (
  range.length !== 2 ||
  range[0] === undefined ||
  range[1] === undefined ||
  !(range[0] < range[1])
)
  fail(
    `--range must be two finite numbers lo,hi with lo < hi, got "${values.range}"`
  );
const [lo, hi] = range as [number, number];

const pointCount = parseNumber(values.points);
if (pointCount === undefined || !Number.isInteger(pointCount) || pointCount < 1)
  fail(`--points must be an integer >= 1, got "${values.points}"`);

const tolerance = parseNumber(values.tolerance);
if (tolerance === undefined || tolerance < 0)
  fail(`--tolerance must be a finite number >= 0, got "${values.tolerance}"`);

let precision: number | undefined;
if (values.precision !== undefined) {
  precision = parseNumber(values.precision);
  if (precision === undefined || !Number.isInteger(precision) || precision < 1)
    fail(`--precision must be a positive integer, got "${values.precision}"`);
}

/** Parse one `--at` value, `x=0.5,y=2`. Each pair must have exactly one `=`,
 * a non-empty name and a finite number. */
function parseAt(spec: string): Record<string, number> {
  const point: Record<string, number> = {};
  for (const pair of spec.split(',')) {
    const parts = pair.split('=');
    const name = parts[0].trim();
    const value = parts.length === 2 ? parseNumber(parts[1]) : undefined;
    if (parts.length !== 2 || name === '' || value === undefined)
      fail(`--at: "${pair}" is not a pair name=number (in "${spec}")`);
    point[name] = value!;
  }
  return point;
}
const atPoints = (values.at ?? []).map(parseAt);

const ce = new ComputeEngine();
if (precision !== undefined) ce.precision = precision;

const input = positionals[0];

/** Run one step. Print its result, or the exception it throws. */
function step<T>(
  label: string,
  fn: () => T,
  show: (v: T) => string
): T | undefined {
  try {
    const v = fn();
    console.log(`${label.padEnd(12)} ${show(v)}`);
    return v;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${label.padEnd(12)} THROWS: ${msg.split('\n')[0]}`);
    return undefined;
  }
}

const json = (e: Expression) => JSON.stringify(e.json);
const both = (e: Expression) => `${e.toString()}    ${JSON.stringify(e.json)}`;

/** Box the input (LaTeX or MathJSON) in the given form. */
function boxInput(text: string, form: 'raw' | 'canonical'): Expression {
  if (values.json)
    return ce.expr(JSON.parse(text) as MathJsonExpression, { form });
  return ce.parse(text, { form });
}

const raw = step('raw', () => boxInput(input, 'raw'), json);
const boxed = step('canonical', () => boxInput(input, 'canonical'), both);
if (!boxed) process.exit(1);
const expr: Expression = boxed!;

step(
  'latex',
  () => expr.latex,
  (s) => s
);
step(
  'type',
  () => expr.type.toString(),
  (s) => s
);
if (!expr.isValid)
  step(
    'errors',
    () => expr.errors.map((e) => JSON.stringify(e.json)),
    (a) => a.join(', ')
  );
if (expr.freeVariables.length > 0)
  step(
    'free vars',
    () => expr.freeVariables,
    (a) => a.join(', ')
  );
step('evaluate', () => expr.evaluate(), both);
step('N', () => expr.N(), both);
if (!values['no-simplify']) step('simplify', () => expr.simplify(), both);

// Set to 1 by a route difference or a failed sample point.
let exitCode = 0;

//
// --routes
//
if (values.routes) {
  console.log('\nRoutes (evaluate):');
  const rawJson = raw?.json;
  const results: [string, Expression | undefined][] = [];
  if (!values.json)
    results.push([
      'parse',
      step('  parse', () => ce.parse(input).evaluate(), both),
    ]);
  if (rawJson !== undefined)
    results.push([
      'box',
      step('  box', () => ce.expr(rawJson).evaluate(), both),
    ]);
  if (raw && isFunction(raw) && raw.ops.length > 0) {
    // Use the operator of the raw form: the canonical operator can differ
    // (`x-1` is `Subtract` raw and `Add` canonical), and it does not fit the
    // raw operands.
    const operator = raw.operator;
    const ops = raw.ops;
    results.push([
      'function',
      step(
        '  function',
        () =>
          ce
            .function(
              operator,
              ops.map((op) => ce.expr(op.json))
            )
            .evaluate(),
        both
      ),
    ]);
  }
  const done = results.filter(
    (r): r is [string, Expression] => r[1] !== undefined
  );
  const threw = results.filter(([, e]) => e === undefined).map(([n]) => n);
  const differ =
    done.length > 0 ? done.filter(([, e]) => !e.isSame(done[0][1])) : [];
  // A route that throws while another route gives a result is a difference.
  const reasons: string[] = [];
  if (differ.length > 0)
    reasons.push(`${differ.map(([n]) => n).join(', ')} vs ${done[0][0]}`);
  if (done.length > 0 && threw.length > 0)
    reasons.push(`${threw.join(', ')} threw`);
  // A route difference fails the run, like a disagreeing point of `--check`.
  if (reasons.length > 0) exitCode = 1;
  console.log(
    reasons.length > 0
      ? `  ROUTES DIFFER: ${reasons.join('; ')}`
      : done.length < 2
        ? `  only ${done.length} route(s) ran; nothing to compare`
        : '  all routes agree'
  );
}

//
// Sample points: --at, --check
//
function samplePoints(vars: readonly string[]): Record<string, number>[] {
  if (atPoints.length > 0) return atPoints;
  // A fixed-seed linear congruential generator modulo 2^32, so that two runs
  // use the same points and a failure can be reproduced. `Math.imul` and
  // `>>> 0` keep the arithmetic in 32-bit integers: a plain product of the
  // seed and the multiplier is larger than 2^53 and loses its low bits.
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  // A variable whose type is `integer` gets the nearest integer, moved inside
  // the range when the range holds an integer.
  const isInteger = new Set(
    vars.filter((v) => ce.symbol(v).type.matches('integer'))
  );
  const sample = (v: string) => {
    const x = lo + (hi - lo) * rand();
    if (!isInteger.has(v)) return x;
    const r = Math.round(x);
    if (r < lo && Math.ceil(lo) <= hi) return Math.ceil(lo);
    if (r > hi && Math.floor(hi) >= lo) return Math.floor(hi);
    return r;
  };
  return Array.from({ length: pointCount! }, () =>
    Object.fromEntries(vars.map((v) => [v, sample(v)]))
  );
}

/** The numeric value of `e` at `point`, as a complex pair. When the result
 * of `.N()` is not a number literal (an unknown function, a variable that is
 * not substituted, a list, an error), return its text instead. */
function valueAt(
  e: Expression,
  point: Record<string, number>
): [number, number] | string {
  const v = e.subs(point).N();
  if (!isNumber(v)) return v.toString();
  return [v.re, v.im];
}

const fmt = ([re, im]: [number, number]) =>
  im === 0 || Number.isNaN(im)
    ? `${re}`
    : `${re} ${im < 0 ? '-' : '+'} ${Math.abs(im)}i`;

if (values.check !== undefined) {
  const other = step(
    '\ncheck',
    () => boxInput(values.check!, 'canonical'),
    both
  );
  if (!other) process.exit(1);
  const otherExpr: Expression = other!;
  step(
    'isEqual',
    () => expr.isEqual(otherExpr),
    (v) => String(v)
  );
  const vars = [
    ...new Set([...expr.freeVariables, ...otherExpr.freeVariables]),
  ].sort();
  // Compare the two expressions at one point. An exception or a value that
  // is not a number fails this point only; the next point still runs.
  const comparePoint = (prefix: string, point: Record<string, number>) => {
    let a: [number, number] | string;
    let b: [number, number] | string;
    try {
      a = valueAt(expr, point);
      b = valueAt(otherExpr, point);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      exitCode = 1;
      console.log(`  DIFF  ${prefix}THROWS: ${msg.split('\n')[0]}`);
      return;
    }
    if (typeof a === 'string' || typeof b === 'string') {
      exitCode = 1;
      const side = (v: [number, number] | string) =>
        typeof v === 'string' ? `NOT NUMERIC ${v}` : fmt(v);
      console.log(`  DIFF  ${prefix}${side(a)}  vs  ${side(b)}`);
      return;
    }
    const ok = close(a, b);
    if (!ok) exitCode = 1;
    console.log(`  ${ok ? 'ok  ' : 'DIFF'}  ${prefix}${fmt(a)}  vs  ${fmt(b)}`);
  };
  if (vars.length === 0) {
    comparePoint('', {});
  } else {
    // An `--at` point must give a value to every free variable: a variable
    // that is not substituted gives no number to compare.
    for (const point of atPoints)
      for (const v of vars)
        if (!(v in point))
          fail(
            `--at: the point "${Object.entries(point)
              .map(([k, x]) => `${k}=${x}`)
              .join(',')}" has no value for the free variable "${v}"`
          );
    console.log(`Sample points over ${vars.join(', ')}:`);
    for (const point of samplePoints(vars)) {
      const label = vars
        .map((v) => `${v}=${point[v]?.toPrecision(6)}`)
        .join(' ');
      comparePoint(`${label}:  `, point);
    }
  }
  console.log(exitCode === 0 ? 'All points agree.' : 'Some points DISAGREE.');
} else if (atPoints.length > 0) {
  console.log('\nValues:');
  for (const point of samplePoints(expr.freeVariables)) {
    const label = Object.entries(point)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    step(
      `  ${label}`,
      () => {
        const v = valueAt(expr, point);
        return typeof v === 'string' ? `NOT NUMERIC ${v}` : fmt(v);
      },
      (s) => s
    );
  }
}

/** Two complex values agree when both are NaN, or when they are equal and a
 * component is not finite (`+oo` and `+oo`), or when all four components are
 * finite and the distance between the values is within the tolerance. The
 * tolerance is relative when a value is larger than 1 in magnitude, and
 * absolute otherwise. */
function close(a: [number, number], b: [number, number]): boolean {
  const tol = tolerance!;
  const nanA = Number.isNaN(a[0]) || Number.isNaN(a[1]);
  const nanB = Number.isNaN(b[0]) || Number.isNaN(b[1]);
  if (nanA || nanB) return nanA && nanB;
  if (![...a, ...b].every(Number.isFinite))
    return a[0] === b[0] && a[1] === b[1];
  const scale = Math.max(1, Math.hypot(...a), Math.hypot(...b));
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol * scale;
}

process.exit(exitCode);
