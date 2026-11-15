/**
 * The interval mode of the JavaScript target (`mode: 'interval'`): each IR
 * operation is spelled as the `_IA` kernel of the interval library that
 * encloses it, so the code is an abstract interpretation of the program
 * over intervals. A `real` or an `integer` value is an `Interval` or an
 * `IntervalResult`, a `boolean` a verdict (`'true'`, `'false'`, `'maybe'`).
 * Every kernel takes and gives the kinds `empty`, `entire`, `singular` and
 * `partial`, so the code never reads the kind of a value. An operation with
 * no kernel has no spelling, and the program declines (`admits()`).
 *
 * The code has the stored form of the existing interval target
 * (`StoredIntervalJavaScript`): `code`, an expression of the inputs object
 * `_` (for a root function literal, the function of its arguments), and
 * `preambleOnce`, the user functions. It reads `_IA` only. `run()` is the
 * function that `createIntervalRuntime().load()` builds from it, so `run()`
 * and stored code loaded elsewhere agree by construction.
 *
 * A rule of the mode is here: `intervalRefusal()`, the constructs that the
 * mode does not compile yet.
 */

import { nextDown, nextUp } from '../../numerics/numeric.js';
import { INTERVAL_RUNTIME_VERSION } from '../../../common/runtime-versions.js';
import {
  createIntervalRuntime,
  type StoredIntervalJavaScript,
} from '../interval-runtime.js';
import { JS } from './print-js.js';
import { printProgram, type Printed, type Syntax } from './print.js';
import {
  argumentIndex,
  entryOf,
  type Program,
} from './ir.js';
import { deepFreeze, OPERATORS, type OperatorRow } from './operators.js';

const ia = (kernel: string, arity = 1) =>
  `_IA.${kernel}(${arity === 2 ? '$0, $1' : '$0'})`;

// prettier-ignore
const UNARY = ['sqrt', 'square', 'abs', 'exp', 'ln', 'log10', 'log2', 'sin',
  'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'sech', 'csch',
  'asin', 'acos', 'atan', 'acot', 'asec', 'acsc', 'asinh', 'acosh', 'atanh',
  'coth', 'acoth', 'asech', 'acsch', 'floor', 'ceil', 'round', 'trunc',
  'fract', 'sign', 'erf', 'erfc', 'gamma', 'gammaln', 'factorial',
  'factorial2', 'not'];

// prettier-ignore
const BINARY: Record<string, string> = { add: 'add', sub: 'sub', mul: 'mul',
  div: 'div', mod: 'mod', max: 'max', min: 'min', emax: 'max', emin: 'min',
  hypot: 'hypot', atan2: 'atan2', binomial: 'binomial', gcd: 'gcd',
  lcm: 'lcm', lt: 'less', le: 'lessEqual', gt: 'greater',
  ge: 'greaterEqual', eq: 'equal', ne: 'notEqual', and: 'and', or: 'or' };

const text = (x: number) => (Object.is(x, -0) ? '-0' : String(x));

/** The enclosure of `x` widened by `ulps` on each side. */
const enclosure = (x: number, ulps: number): string => {
  let [lo, hi] = [x, x];
  for (let k = 0; k < ulps; k++) [lo, hi] = [nextDown(lo), nextUp(hi)];
  return `{ lo: ${text(lo)}, hi: ${text(hi)} }`;
};

/**
 * The syntax of the mode: the statement forms of `JS`, and a spelling for
 * each operation that a kernel computes, with the operands in the order of
 * the row's `fold`. `pow` (and `pow.int`) is `_IA.powReal`; `root`
 * `_IA.nthRootInterval`; `div.q` is `div`; `deg` the product by an
 * enclosure of π and the quotient by 180. A constant is a point, or for a
 * literal marked `inexact` the enclosure of that many ulps on each side;
 * NaN is `empty`; a boolean a verdict.
 */
export const JS_INTERVAL: Syntax = Object.freeze({
  ...JS,
  ops: {
    ...Object.fromEntries(UNARY.map((op) => [op, ia(op)])),
    ...Object.fromEntries(
      Object.entries(BINARY).map(([op, k]) => [op, ia(k, 2)])
    ),
    neg: '_IA.negate($0)',
    pow: '_IA.powReal($0, $1)',
    root: '_IA.nthRootInterval($0, $1)',
    deg: `_IA.div(_IA.mul($0, ${enclosure(Math.PI, 1)}), { lo: 180, hi: 180 })`,
  },
  regions: {},
  helpers: {},
  constant: (l) =>
    l.lane === 'boolean'
      ? `'${l.value}'`
      : l.lane === 'complex'
        ? JS.constant(l)
        : Number.isNaN(Number(l.value))
          ? "{ kind: 'empty' }"
          : enclosure(
              Number(l.value),
              l.lane === 'real' && Number.isFinite(l.value)
                ? (l.inexact ?? 0)
                : 0
            ),
});

[JS_INTERVAL.ops, JS_INTERVAL.regions, JS_INTERVAL.helpers].forEach((t) =>
  Object.freeze(t)
);

/** The rows of the mode: `OPERATORS`, and `square`, which the lowering
 *  makes of a power by the constant 2. */
export const INTERVAL_ROWS: readonly OperatorRow[] = Object.freeze([
  ...OPERATORS,
  deepFreeze({
    arity: 1,
    signatures: [
      [['integer'], 'integer', 'square.int'],
      [['real'], 'real', 'square'],
    ],
    threads: true,
    effect: 'pure',
  } as OperatorRow),
]);

/** The construct of `p` that the mode does not compile yet (an `if`, a
 *  loop or a region instruction, after the passes), or `undefined`. */
export function intervalRefusal(p: Program): string | undefined {
  for (const f of p.functions)
    for (const i of f.body.body)
      if (i.k === 'if' || i.k === 'loop' || i.k === 'region')
        return `${i.k === 'if' ? 'a conditional' : i.k === 'loop' ? 'a loop' : `the region ${i.op}`}: the interval mode does not compile it yet`;
  return undefined;
}

export type IntervalPrinted = StoredIntervalJavaScript & {
  readonly code: string;
  readonly preambleOnce: string;
  readonly calling: 'expression' | 'lambda';
  /** `createIntervalRuntime().load()` of the stored form. */
  readonly run: (...args: unknown[]) => unknown;
  readonly printed: Printed;
};

export function printInterval(
  p: Program,
  rows: readonly OperatorRow[],
  syntax: Syntax = JS_INTERVAL
): IntervalPrinted {
  const printed = printProgram(p, syntax, rows);
  const entry = entryOf(p);
  const literal = entry.literal === true;
  const n = argumentIndex(entry, entry.positional ?? 0);
  const params = Array.from({ length: n }, (_, k) => `a${k}`).join(', ');
  // A body of one `return` is its expression.
  const single =
    printed.body.length === 1
      ? /^\s*return (.*);$/s.exec(printed.body[0])
      : null;
  const body = printed.body.join('\n');
  const code = literal
    ? `(${params}) => {\n${body}\n}`
    : single !== null
      ? single[1]
      : `(() => {\n${body}\n})()`;
  const stored = {
    runtimeVersion: INTERVAL_RUNTIME_VERSION,
    code,
    preambleOnce: [...printed.helpers, ...printed.functions].join('\n'),
    calling: literal ? ('lambda' as const) : ('expression' as const),
  };
  let run: IntervalPrinted['run'];
  try {
    run = createIntervalRuntime().load(stored);
  } catch (e) {
    throw new Error(
      `slice: the interval printer made code that does not parse (${String(e)}):\n${stored.preambleOnce}\n${code}`
    );
  }
  return { ...stored, run, printed };
}
