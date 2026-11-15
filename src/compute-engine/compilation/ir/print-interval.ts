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
 * An `if` is printed with each arm once (`verdictIf`): the first arm unless
 * the condition is `'false'`, the second unless it is `'true'`, and each
 * result the hull of both for `'maybe'`. A counted loop runs over numbers
 * (the pass `plain`), and refuses to start, by the error of an undecided
 * condition (`run()` answers `entire`), when it has more passes than the
 * `iterationBudget`. `Random()` is the support `[0, 1]` of a draw, and a
 * random frame is its body. A list or a tuple is an array of the values of
 * the mode; its length and its indexes are numbers (the pass `plain`).
 *
 * A rule of the mode is here: `intervalRefusal()`, the constructs that the
 * mode does not compile yet.
 */

import { nextDown, nextUp } from '../../numerics/numeric.js';
import { realPowerReconstructionDigits } from '../../numerics/real-power.js';
import { INTERVAL_RUNTIME_VERSION } from '../../../common/runtime-versions.js';
import {
  createIntervalRuntime,
  type StoredIntervalJavaScript,
} from '../interval-runtime.js';
import { JS } from './print-js.js';
import {
  printProgram,
  type Printed,
  type RegionSpelling,
  type Syntax,
} from './print.js';
import { effects } from './effects.js';
import {
  argsOf,
  argumentIndex,
  entryOf,
  lengthValues,
  outsOf,
  recursiveFunctions,
  regionsOf,
  type Program,
  type Region,
  type V,
} from './ir.js';
import { deepFreeze, OPERATORS, type OperatorRow } from './operators.js';
import { PLAIN_ROWS, PLAIN_SPELLINGS } from './plain.js';

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

/** The lines that open a counted loop of at most `limit` passes, over the
 *  number bounds `lo` and `hi`; more passes throw before the first. */
const loopOpen =
  (limit: number): Syntax['loopOpen'] =>
  (k, lo, hi) => [
    `const ${k}_lo = ${lo}, ${k}_hi = ${hi};`,
    `if (!(${k}_hi - ${k}_lo < ${limit})) _IA.undecided('A loop of more than ${limit} passes');`,
    `for (let ${k} = ${k}_lo; ${k} <= ${k}_hi; ${k}++) {`,
  ];

/** The region `build` or `filter`: a loop over a number count that fills
 *  an array; a count of 2^32 or more, which no array holds, throws before
 *  the first element. The `iterationBudget` does not count the elements of
 *  a list (`CompilationOptions.iterationBudget`), as on the JavaScript
 *  target. A filter keeps an element for `'true'`, drops it for
 *  `'false'`, and for `'maybe'` the length of its result is not one
 *  number: it throws, and `run()` answers `entire`. */
const fill =
  (op: 'build' | 'filter'): RegionSpelling =>
  ({ outs, args: [n], params: [k] }) => {
    const out = outs[outs.length - 1];
    return {
      open: [
        `const ${out} = [], ${out}_n = ${n};`,
        `if (!(${out}_n < 4294967296)) _IA.undecided('A list of 2^32 elements or more');`,
        `for (let ${k} = 0; ${k} < ${out}_n; ${k}++) {`,
      ],
      // A build yields its element; a filter its verdict, then its element.
      close: ([a, b]) =>
        op === 'build'
          ? [`  ${out}.push(${a});`, '}']
          : [
              `  const ${out}_k = ${a};`,
              `  if (${out}_k === 'true') ${out}.push(${b});`,
              `  else if (${out}_k !== 'false') _IA.undecided('A Filter whose condition is undecided');`,
              '}',
              `const ${outs[0]} = ${out}.length;`,
            ],
    };
  };

/**
 * The syntax of the mode: the statement forms of `JS`, and a spelling for
 * each operation that a kernel computes, with the operands in the order of
 * the row's `fold`. `pow` (and `pow.int`) is `_IA.powReal`, with the
 * digits of the reading of a float exponent fixed at the compilation
 * (`printInterval()`); the powers of a float literal that the lowering
 * reads are `_IA.powRealBranch` of the double (`pow.branch` for an odd
 * numerator, `pow.branch.even`) and `_IA.pow` of the double
 * (`pow.principal`), as the existing target;
 * `root` `_IA.nthRootInterval`; `div.q` is `div`; `deg` the product by an
 * enclosure of π and the quotient by 180. A constant is a point, or for a
 * literal marked `inexact` the enclosure of that many ulps on each side;
 * NaN is `empty`; a boolean a verdict; a plain integer (`plain.ts`) a
 * number. `at` is `_IA.at` (the interpreter's `At` over an interval index),
 * `elem` the read of a number index, `rangecount` `_IA.rangeCount`.
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
    // The exponent is a constant point: its double.
    'pow.branch': '_IA.powRealBranch($0, $1.lo, true)',
    'pow.branch.even': '_IA.powRealBranch($0, $1.lo, false)',
    'pow.principal': '_IA.pow($0, $1.lo)',
    root: '_IA.nthRootInterval($0, $1)',
    deg: `_IA.div(_IA.mul($0, ${enclosure(Math.PI, 1)}), { lo: 180, hi: 180 })`,
    draw: '{ lo: 0, hi: 1 }',
    atleast: '_IA.atLeast($0, $1)',
    atmost: '_IA.atMost($0, $1)',
    // An index and a length are numbers (`plain.ts`).
    elem: '$0[$1]',
    at: '_IA.at($0, $1)',
    rangecount: '_IA.rangeCount($0, $1, $2)',
    rangestep: '($1 >= $0 ? 1 : -1)',
    ...PLAIN_SPELLINGS,
  },
  // A loop that fills an array, with no `Array.from()`.
  map: (lengths, body) => {
    const index = lengths.map((_, d) => `i${d}`);
    return lengths.reduceRight<string>(
      (s, n, d) =>
        `((_n) => { const _r = []; for (let ${index[d]} = 0; ${index[d]} < _n; ${index[d]}++) _r.push(${s}); return _r; })(${n})`,
      body(index)
    );
  },
  // No copy: `run()` copies the inputs and the result, and no kernel
  // writes to an operand.
  ret: (value) => `return ${value};`,
  retTuple: (values) => `return [${values.join(', ')}];`,
  regions: {
    build: fill('build'),
    filter: fill('filter'),
    // The enclosure of the existing interval target, of the count of
    // pieces that the lowering chose (`intervalQuadratureSize()`): the
    // integrand is a function of the interval of one piece. With a closed
    // form (the second region), `_IA.integrateClosed` runs it when its scan
    // of the integrand finds no pole, and the enclosure otherwise.
    integrate: ({ outs: [out], args: [a, b], params: [t], pieces, closed }) =>
      closed === true
        ? {
            open: [`const ${out}_f = (${t}) => {`],
            between: ([y]) => [
              `  return ${y};`,
              '};',
              `const ${out} = _IA.integrateClosed(() => {`,
            ],
            close: ([c]) => [
              `  return ${c};`,
              `}, ${out}_f, ${a}, ${b}, ${pieces});`,
            ],
          }
        : {
            open: [`const ${out} = _IA.integrate((${t}) => {`],
            close: ([y]) => [`  return ${y};`, `}, ${a}, ${b}, ${pieces});`],
          },
    seeded: ({ outs }) => ({
      open: [...outs.map((o) => `let ${o};`), '{'],
      close: (ys) => [...ys.map((y, j) => `  ${outs[j]} = ${y};`), '}'],
    }),
  },
  helpers: {},
  verdictIf: {
    first: (c) => `if (${c} !== 'false') {`,
    second: (c) => `if (${c} !== 'true') {`,
    join: (c, a, b) =>
      `${c} === 'true' ? ${a} : ${c} === 'false' ? ${b} : _IA.hull(${a}, ${b})`,
  },
  loopOpen: loopOpen(2 ** 32),
  constant: (l) =>
    l.lane === 'boolean'
      ? `'${l.value}'`
      : l.lane === 'complex' || (l.lane === 'integer' && l.plain === true)
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

/** The rows of the mode: `Binomial` and `Choose` with a real signature
 *  too (`_IA.binomial`; the other targets have the integer one only),
 *  `OPERATORS`, `square`, which the lowering makes of a power by the
 *  constant 2, the powers of a float exponent read at compile time, the
 *  clamps `atleast` and `atmost`, which the pass `narrow` makes, and the
 *  rows of the pass `plain`. */
export const INTERVAL_ROWS: readonly OperatorRow[] = Object.freeze([
  ...['Binomial', 'Choose'].map((head) =>
    deepFreeze({
      head,
      arity: 2,
      signatures: [
        [['integer', 'integer'], 'integer', 'binomial'],
        [['real', 'real'], 'real', 'binomial.real'],
      ],
      threads: false,
      effect: 'pure',
    } as OperatorRow)
  ),
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
  // A power by a float literal that the lowering reads at compile time.
  ...['pow.branch', 'pow.branch.even', 'pow.principal'].map((op) =>
    deepFreeze({
      arity: 2,
      signatures: [[['real', 'real'], 'real', op]],
      threads: true,
      effect: 'pure',
    } as OperatorRow)
  ),
  ...['atleast', 'atmost'].map((op) =>
    deepFreeze({
      arity: 2,
      signatures: [
        [['integer', 'integer'], 'integer', `${op}.int`],
        [['real', 'real'], 'real', op],
      ],
      threads: false,
      effect: 'pure',
    } as OperatorRow)
  ),
  ...PLAIN_ROWS,
]);

/** The closed form of each `integrate` of `p` (its second region) that
 *  `admitted` refuses, removed: the enclosure stands alone. */
export function dropClosedForms(
  p: Program,
  admitted: (closed: Region) => boolean
): void {
  const walk = (r: Region): void =>
    r.body.forEach((i) => {
      if (i.k === 'region' && i.regions.length === 2 && !admitted(i.regions[1]))
        i.regions.pop();
      regionsOf(i).forEach(walk);
    });
  p.functions.forEach((f) => walk(f.body));
}

/** The construct of `p` that the mode does not compile yet (a `Loop`,
 *  whose passes the budget counts), or `undefined`. A region other than a
 *  random frame has no spelling (`admits()`). */
export function intervalRefusal(p: Program): string | undefined {
  const loop = (r: Region): boolean =>
    r.body.some(
      (i) => (i.k === 'loop' && i.passes === true) || regionsOf(i).some(loop)
    );
  return p.functions.some((f) => loop(f.body))
    ? 'a Loop: the interval mode does not compile it yet'
    : undefined;
}

/** The pure rows whose kernel of the mode throws (`_IA.rangeCount()`). */
const THROWS = new Set(['rangecount']);

/**
 * The values of `p` that depend on no input, parameter, loop index or draw,
 * which the code computes once: a constant that is not a number or a
 * verdict and that an instruction computed at each call reads; a pure
 * operation or a list of such values (or of constants) anywhere; and at a
 * top level that runs at every call, an operation that can fail and a call
 * of a function that has no effect and is not on a cycle, of such values.
 * The top level of the entry runs at every call, and so does the top level
 * of a function that such a top level calls. `rank`: the rank of the
 * function of each value, the callees first; `late`: the values that can
 * throw or run a loop (a call), and those computed from them.
 */
function computedOnce(
  p: Program,
  rows: readonly OperatorRow[]
): { once: Set<V>; rank: Map<V, number>; late: Set<V> } {
  const fx = effects(p, rows);
  const cyclic = recursiveFunctions(p.functions);
  const byName = new Map(p.functions.map((f) => [f.name, f]));
  const calls = (r: Region, top: boolean): string[] =>
    r.body.flatMap((i) => [
      ...(i.k === 'call' && !cyclic.has(i.fn) ? [i.fn] : []),
      ...(top ? [] : regionsOf(i).flatMap((inner) => calls(inner, false))),
    ]);
  // The functions whose top level runs at every call.
  const every = new Set([p.entry]);
  for (const name of every)
    calls(byName.get(name)!.body, true).forEach((g) => every.add(g));
  // The functions, each after the functions that it calls.
  const order: string[] = [];
  const visit = (name: string) => {
    if (order.includes(name) || cyclic.has(name)) return;
    calls(byName.get(name)!.body, false).forEach(visit);
    if (!order.includes(name)) order.push(name);
  };
  p.functions.forEach((f) => visit(f.name));
  const known = new Set<V>();
  const once = new Set<V>();
  const rank = new Map<V, number>();
  const reads = new Set<V>();
  const late = new Set<V>();
  const walk = (r: Region, top: boolean, k: number) => {
    for (const i of r.body) {
      const [out] = outsOf(i);
      const effect = fx.of(i);
      const ready =
        argsOf(i).every((a) => known.has(a)) &&
        outsOf(i).length === 1 &&
        lengthValues(p.types[out]).every((n) => known.has(n));
      const pure = effect === 'pure' && (i.k !== 'op' || !THROWS.has(i.op));
      const fallible =
        top &&
        (i.k === 'call'
          ? effect !== 'effectful' && !cyclic.has(i.fn)
          : i.k === 'op' && effect === 'may-fail');
      if (i.k === 'const') known.add(out);
      else if (
        (i.k === 'op' || i.k === 'list' || i.k === 'call') &&
        ready &&
        ((pure && i.k !== 'call') || fallible)
      ) {
        known.add(out);
        once.add(out);
        rank.set(out, k);
        if (!pure || i.k === 'call' || argsOf(i).some((a) => late.has(a)))
          late.add(out);
      } else argsOf(i).forEach((a) => reads.add(a));
      regionsOf(i).forEach((inner) => walk(inner, false, k));
      regionsOf(i).forEach((inner) =>
        inner.yields.forEach((y) => reads.add(y))
      );
    }
  };
  for (const f of p.functions) {
    walk(f.body, every.has(f.name), order.indexOf(f.name));
    f.body.yields.forEach((y) => reads.add(y));
  }
  // A constant read by an instruction computed at each call is named; one
  // read only by values of `once` is written in their text.
  for (const f of p.functions) {
    const constants = (r: Region): void =>
      r.body.forEach((i) => {
        regionsOf(i).forEach(constants);
        if (i.k !== 'const' || !reads.has(i.out)) return;
        const l = i.value;
        if (l.lane === 'boolean' || (l.lane === 'integer' && l.plain)) return;
        once.add(i.out);
        rank.set(i.out, order.indexOf(f.name));
      });
    constants(f.body);
  }
  return { once, rank, late };
}

export type IntervalPrinted = StoredIntervalJavaScript & {
  readonly code: string;
  readonly preambleOnce: string;
  /** Present when a value computed once can throw or run a loop: its
   *  computation at the first call, and at each call the throw of the
   *  error that it threw then. */
  readonly preamblePerCall?: string;
  readonly calling: 'expression' | 'lambda';
  /** `createIntervalRuntime().load()` of the stored form. */
  readonly run: (...args: unknown[]) => unknown;
  readonly printed: Printed;
};

/** `iterationBudget`: a loop of more passes than it throws before its
 *  first pass. The values of `computedOnce()` are computed after the
 *  functions (they can call them), those of a function before those of its
 *  callers: in `preambleOnce`, when the code is loaded, except the values
 *  that can throw or run a loop and those computed from them, which are
 *  computed at the first call, in a `try` of `preamblePerCall`, so that
 *  `compile()` and the load run no loop of the program. `_once` is
 *  `undefined` before, `null` after, or the error thrown, which each call
 *  throws again: it answers what it answers when the value is computed
 *  there. */
export function printInterval(
  p: Program,
  rows: readonly OperatorRow[],
  syntax: Syntax = JS_INTERVAL,
  iterationBudget?: number
): IntervalPrinted {
  const limit = Math.min(Math.floor(iterationBudget ?? Infinity), 2 ** 32);
  // The digits of the reading of a run-time float exponent, fixed now: the
  // runtime has its own number library, whose precision says nothing about
  // the engine's (`CompilationResult.reconstructionDigits`).
  const pow = `_IA.powReal($0, $1, ${realPowerReconstructionDigits()})`;
  const plan = computedOnce(p, rows);
  const printed = printProgram(
    p,
    {
      ...syntax,
      ops: { ...syntax.ops, pow },
      ...(limit < 2 ** 32 ? { loopOpen: loopOpen(limit) } : {}),
    },
    rows,
    plan.once
  );
  const once = [...printed.once].sort(
    ([a], [b]) => plan.rank.get(a)! - plan.rank.get(b)!
  );
  const late = once.filter(([v]) => plan.late.has(v)).map(([, x]) => x);
  const computed = once
    .filter(([v]) => !plan.late.has(v))
    .map(([, [name, value]]) => `const ${name} = ${value};`);
  if (late.length > 0)
    computed.push(`let _once, ${late.map(([name]) => name).join(', ')};`);
  const perCall = [
    'if (_once !== null) {',
    '  if (_once === undefined)',
    '    try {',
    ...late.map(([name, value]) => `      ${name} = ${value};`),
    '      _once = null;',
    '    } catch (e) {',
    '      _once = e;',
    '    }',
    '  if (_once !== null) throw _once;',
    '}',
  ].join('\n');
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
    preambleOnce: [...printed.helpers, ...printed.functions, ...computed].join(
      '\n'
    ),
    ...(late.length > 0 ? { preamblePerCall: perCall } : {}),
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
