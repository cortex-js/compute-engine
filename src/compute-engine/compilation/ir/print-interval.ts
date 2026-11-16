/**
 * The interval mode of the JavaScript target (`mode: 'interval'`): each IR
 * operation is spelled as the `_IA` kernel of the interval library that
 * encloses it (README, "The interval mode"). An operation with no kernel
 * has no spelling, and the program declines (`admits()`).
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
  expressionOf,
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
  useIndex,
  type Instr,
  type Program,
  type Region,
  type V,
} from './ir.js';
import {
  arith,
  deepFreeze,
  I,
  list,
  OPERATORS,
  R,
  row,
  type OperatorRow,
} from './operators.js';
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
 *  an array (README, "The interval mode", "Lists"). */
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

/** The syntax of the mode: the statement forms of `JS`, and the kernel of
 *  each operation (README, "The interval mode"). */
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
      : l.lane === 'integer' && l.plain === true
        ? JS.constant(l)
        : Number.isNaN(Number(l.value))
          ? "{ kind: 'empty' }"
          : enclosure(
              Number(l.value),
              l.lane === 'real' ? (l.inexact ?? 0) : 0
            ),
});

[JS_INTERVAL.ops, JS_INTERVAL.regions].forEach((t) => Object.freeze(t));

/** The rows of the mode: `OPERATORS`, and the rows of the operations that
 *  only the mode has (README, "The interval mode"). */
export const INTERVAL_ROWS: readonly OperatorRow[] = deepFreeze([
  ...['Binomial', 'Choose'].map((head) =>
    row(
      head,
      2,
      [
        [[I, I], I, 'binomial'],
        [[R, R], R, 'binomial.real'],
      ],
      list
    )
  ),
  ...OPERATORS,
  row(undefined, 1, arith('square', 1), {}),
  // A power by a float literal that the lowering reads at compile time,
  // and `pow.principal` of a rational exponent whose denominator is a
  // power of 2.
  ...['pow.branch', 'pow.branch.even', 'pow.principal'].map((op) =>
    row(undefined, 2, [[[R, R], R, op]], {})
  ),
  ...['atleast', 'atmost'].map((op) => row(undefined, 2, arith(op, 2), list)),
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

/** `p` with each `add` that has an operand `neg` of no other use written
 *  `sub` and the `neg` removed, a copy (`p` is unchanged):
 *  `Add(a, Negate(b))` is `_IA.sub(a, b)`, `Add(Negate(a), b)` is
 *  `_IA.sub(b, a)`, one kernel where there were two, as the existing target
 *  writes them. `sub` gives the endpoints of `add` of `negate` in every
 *  kind and rounding (`interval/arithmetic.ts`); an inlined operand is
 *  pure, so the order of the two is not observed. */
function subtractions(p: Program): Program {
  // The count of the pairs of `q`, rewritten in place with `rewrite`.
  const pairs = (q: Program, rewrite: boolean): number => {
    const { uses, def } = useIndex(q);
    const negation = (v: V) => {
      const i = def.get(v);
      return i?.k === 'op' &&
        (i.op === 'neg' || i.op === 'neg.int') &&
        uses.get(v) === 1
        ? i
        : undefined;
    };
    const dropped = new Set<Instr>();
    const walk = (r: Region): void => {
      for (const i of r.body) {
        regionsOf(i).forEach(walk);
        if (i.k !== 'op' || (i.op !== 'add' && i.op !== 'add.int')) continue;
        const k = negation(i.args[1]) ? 1 : negation(i.args[0]) ? 0 : -1;
        if (k < 0) continue;
        const n = negation(i.args[k])!;
        dropped.add(n);
        if (!rewrite) continue;
        i.op = i.op === 'add' ? 'sub' : 'sub.int';
        i.args = [i.args[1 - k], n.args[0]];
      }
      // A `neg` is in the region of its `add` or in an outer one.
      if (rewrite) r.body = r.body.filter((i) => !dropped.has(i));
    };
    q.functions.forEach((f) => walk(f.body));
    return dropped.size;
  };
  if (pairs(p, false) === 0) return p;
  const q = { ...p, functions: structuredClone(p.functions) };
  pairs(q, true);
  return q;
}

/** The pure rows whose kernel of the mode throws (`_IA.rangeCount()`). */
const THROWS = new Set(['rangecount']);

/** The values of `p` that the code computes once (README, "The interval
 *  mode", "Values computed once"). `rank`: the rank of the function of each
 *  value, the callees first; `late`: the values that can throw or run a
 *  loop (a call), and those computed from them. */
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
   *  error that it threw then; and when the code counts `Loop` passes: the
   *  reset of the count at each call. */
  readonly preamblePerCall?: string;
  readonly calling: 'expression' | 'lambda';
  /** `createIntervalRuntime().load()` of the stored form. */
  readonly run: (...args: unknown[]) => unknown;
  readonly printed: Printed;
};

/** The stored form of `p` in the mode and its `run()` (README, "The
 *  interval mode"). */
export function printInterval(
  p: Program,
  rows: readonly OperatorRow[],
  syntax: Syntax,
  iterationBudget?: number
): IntervalPrinted {
  const limit = Math.min(Math.floor(iterationBudget ?? Infinity), 2 ** 32);
  // With a finite budget, each pass of a `Loop` counts one pass of the call
  // (`_IA.countLoopPass()`, as the existing target), whose limit throws the
  // cancellation that `run()` rethrows; another loop is refused before its
  // first pass.
  const open: Syntax['loopOpen'] = (k, lo, hi, passes) =>
    passes && Number.isFinite(iterationBudget ?? Infinity)
      ? [
          ...loopOpen(2 ** 32)(k, lo, hi, passes),
          `  _IA.countLoopPass(${Math.floor(iterationBudget!)});`,
        ]
      : loopOpen(limit)(k, lo, hi, passes);
  // The digits of the reading of a run-time float exponent, fixed now: the
  // runtime has its own number library, whose precision says nothing about
  // the engine's (`CompilationResult.reconstructionDigits`).
  const pow = `_IA.powReal($0, $1, ${realPowerReconstructionDigits()})`;
  const q = subtractions(p);
  const plan = computedOnce(q, rows);
  const printed = printProgram(
    q,
    { ...syntax, ops: { ...syntax.ops, pow }, loopOpen: open },
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
  // The count of the passes starts again at each call, and for the values
  // computed at the first call, whose passes no call counts.
  const reset = [...printed.functions, ...printed.body].some((s) =>
    s.includes('_IA.countLoopPass(')
  )
    ? '_IA.resetLoopPasses();'
    : undefined;
  const perCall = [
    'if (_once !== null) {',
    '  if (_once === undefined)',
    '    try {',
    ...(reset ? [`      ${reset}`] : []),
    ...late.map(([name, value]) => `      ${name} = ${value};`),
    '      _once = null;',
    '    } catch (e) {',
    '      _once = e;',
    '    }',
    '  if (_once !== null) throw _once;',
    '}',
    ...(reset ? [reset] : []),
  ].join('\n');
  const entry = entryOf(p);
  const literal = entry.literal === true;
  const n = argumentIndex(entry, entry.positional ?? 0);
  const params = Array.from({ length: n }, (_, k) => `a${k}`).join(', ');
  const body = printed.body.join('\n');
  const code = literal
    ? `(${params}) => {\n${body}\n}`
    : (expressionOf(printed.body) ?? `(() => {\n${body}\n})()`);
  const stored = {
    runtimeVersion: INTERVAL_RUNTIME_VERSION,
    code,
    preambleOnce: [...printed.helpers, ...printed.functions, ...computed].join(
      '\n'
    ),
    ...(late.length > 0 || reset
      ? { preamblePerCall: late.length > 0 ? perCall : reset }
      : {}),
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
