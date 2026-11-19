/**
 * The JavaScript printer of the slice compiler, in the form of stored
 * code (`StoredJavaScript`): `preambleOnce`, the
 * helpers and the user functions, and `code`, an expression of the inputs
 * object `_` (for a root function literal, the function
 * `(a0, a1, …, _ = {}) => …` of the parameters by position, then the inputs
 * object for the free names of the body), in a scope where `_SYS` is the
 * runtime of `javascript-runtime.ts`. `run()` loads the code with the
 * loader of stored code (`twoStageRunner()`), so the code that runs here is
 * the code that a worker or another page loads.
 *
 * Each operation is spelled with the double arithmetic that the `fold` of
 * its row computes. An element-wise operation is an array of its length
 * filled by a `for` loop, one loop for a chain of such operations of one
 * shape. A result is read-only: it can be an input, hold a part of one, or
 * be a list of constants that every call shares.
 *
 * A power, a `Mod`, the functions of the folds, a draw, a random frame,
 * an integral and the count of the passes of a loop call `_SYS` (README,
 * "Loops and the runtime").
 */

import type { IComputeEngine as ComputeEngine } from '../../global-types.js';
import { isCancellationError } from '../../interval/run-support.js';
import {
  createSysRuntime,
  engineRuntimeSource,
  makeSysHelpers,
  twoStageRunner,
  type SysHelpers,
} from '../javascript-runtime.js';
import {
  argumentIndex,
  entryOf,
  loopPasses,
  recursiveFunctions,
  regionsOf,
  useIndex,
  type Instr,
  type Program,
  type Region,
  type V,
} from './ir.js';
import {
  COMPLEX_FUNCTIONS,
  deepFreeze,
  REAL_FUNCTIONS,
  rowOfOp,
  type OperatorRow,
} from './operators.js';
import {
  ARITHMETIC,
  calls,
  COMPARISONS,
  LOGIC,
  printProgram,
  type Printed,
  type Syntax,
} from './print.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The guard of a loop or a build of more than 2^32 iterations (2^53 for
 *  a loop with an exit: it can end sooner). */
const guard = (n: string, what: string, bits = 32) =>
  `if (!(${n} < ${2 ** bits})) throw new RangeError('${what} of more than 2^${bits} iterations');`;

/** The integers of a mode: `zero`, the literal `c` (`5` or `5n`), the
 *  number of an integer (`toNumber()`), the least of two (`min()`) and the
 *  integer part of a difference of bounds (`floor()`). */
type Ints = {
  zero: string;
  c: (x: number) => string;
  toNumber: Wrap;
  min: (a: string, b: string) => string;
  floor: Wrap;
};
type Wrap = (n: string) => string;
const NUMBERS: Ints = {
  zero: '0',
  c: String,
  toNumber: (n) => n,
  min: (a, b) => `Math.min(${a}, ${b})`,
  floor: (x) => `Math.floor(${x})`,
};
const BIGINTS: Ints = {
  zero: '0n',
  c: (x) => `${x}n`,
  toNumber: (n) => `Number(${n})`,
  min: (a, b) => `(${a} < ${b} ? ${a} : ${b})`,
  floor: (x) => x,
};

/** The head of a loop of `n` passes of the index `i` from 0, run in blocks
 *  `[i_b, i_e)` of at most 1024 passes: the inner `for` (whose brace the
 *  printer closes) runs a block, and the update of the outer one adds the
 *  passes of the block to the deadline count of the runtime
 *  (`_SYS.tick(passes)`, on the deadline frame), so no pass makes a call. A
 *  block left by a throw is not counted. `done`: the flag of an exit; both
 *  loops stop when it is true, and the block charges the passes it ran. */
const blocks = (z: Ints, i: string, n: string, done?: string): string => {
  if (done === undefined)
    return `for (let ${i}_b = ${z.zero}, ${i}_e = ${z.min(z.c(1024), n)}; ${i}_b < ${n}; _SYS.tick(${z.toNumber(`${i}_e - ${i}_b`)}), ${i}_b = ${i}_e, ${i}_e = ${z.min(`${i}_b + ${z.c(1024)}`, n)}) for (let ${i} = ${i}_b; ${i} < ${i}_e; ${i}++) {`;
  return `for (let ${i}_b = ${z.zero}, ${i}_e = ${z.min(z.c(1024), n)}, ${i} = ${z.zero}; ${i}_b < ${n} && !${done}; _SYS.tick(${z.toNumber(`${i} - ${i}_b`)}), ${i}_b = ${i}_e, ${i}_e = ${z.min(`${i}_b + ${z.c(1024)}`, n)}) for (${i} = ${i}_b; ${i} < ${i}_e && !${done}; ${i}++) {`;
};

/** A counted loop of `n` passes, from `lo` while the index is at most `hi`
 *  (a bound can be a real: `Floor(hi - lo) + 1` passes): the index is
 *  `lo + i` for a count `i` of the passes, so that the loop ends also where
 *  `k++` would not advance (from 2^53). */
const loopOpen =
  (z: Ints): Syntax['loopOpen'] =>
  (k, lo, hi, _passes, done) => [
    `const ${k}_lo = ${lo}, ${k}_n = ${z.floor(`${hi} - ${k}_lo`)} + ${z.c(1)};`,
    guard(`${k}_n - ${z.c(1)}`, 'a loop', done === undefined ? 32 : 53),
    blocks(z, `${k}_i`, `${k}_n`, done),
    `  const ${k} = ${k}_lo + ${k}_i;`,
  ];

const number = (x: number) =>
  Object.is(x, -0) ? '(-0)' : x < 0 ? `(${x})` : String(x);

/** The regions `build` and `filter` of the integers `z`, whose count of
 *  the list `out` is `count(out)`. A build fills an array of its length; a
 *  filter pushes. */
const builds = (z: Ints, count: Wrap): Syntax['regions'] => {
  const toNumber = z.toNumber;
  const open = (out: string, n: string, k: string, filter: boolean) => [
    `const ${out}_n = ${n};`,
    guard(`${out}_n`, 'a list'),
    `const ${out} = ${filter ? '[]' : `new Array(${toNumber(`${out}_n`)})`};`,
    blocks(z, k, `${out}_n`),
  ];
  return {
    build: ({ outs: [out], args: [n], params: [k] }) => ({
      open: open(out, n, k, false),
      close: ([y]) => [`  ${out}[${toNumber(k)}] = ${y};`, '}'],
    }),
    filter: ({ outs: [c, out], args: [n], params: [k] }) => ({
      open: open(out, n, k, true),
      close: ([keep, y]) => [
        `  if (${keep}) ${out}.push(${y});`,
        '}',
        `const ${c} = ${count(out)};`,
      ],
    }),
  };
};

/** The operations of a row on another lane than the function that they
 *  call: the integer lane of a function of `REAL_FUNCTIONS` (the bigint mode
 *  spells it with its own helper), the real lane of an integer row. */
const OTHER_LANES = {
  'remainder.int': '_SYS.ir.remainder($0, $1)',
  'fibonacci.int': '_SYS.ir.fibonacci($0)',
  'rbinomial': '_SYS.binomial($0, $1)',
  'rgcd': '_SYS.ir.gcd($0, $1)',
  'rlcm': '_SYS.ir.lcm($0, $1)',
};

export const JS: Syntax = deepFreeze({
  ops: {
    ...ARITHMETIC,
    'pow': '_SYS.ir.pow($0, $1)',
    ...calls('Math.', ['sqrt', 'abs', 'exp']),
    'ln': 'Math.log($0)',
    ...calls('Math.', ['sin', 'cos', 'tan']),
    'cot': '(1 / Math.tan($0))',
    'sec': '(1 / Math.cos($0))',
    'csc': '(1 / Math.sin($0))',
    ...calls('Math.', ['sinh', 'cosh', 'tanh']),
    'sech': '(1 / Math.cosh($0))',
    'csch': '(1 / Math.sinh($0))',
    'deg': '(($0 * Math.PI) / 180)',
    ...calls('Math.', ['floor', 'ceil']),
    'round': { text: '_round($0)', helpers: ['_round'] },
    'mod': '_SYS.ir.mod($0, $1)',
    'max': 'Math.max($0, $1)',
    'min': 'Math.min($0, $1)',
    'emax': 'Math.max($0, $1)',
    'emin': 'Math.min($0, $1)',
    ...COMPARISONS,
    'eq': '($0 === $1)',
    'ne': '($0 !== $1)',
    ...LOGIC,
    'boole': '($0 ? 1 : 0)',
    'elem': '$0[$1]',
    'at': { text: '_at($0, $1)', helpers: ['_at'] },
    'atu': { text: '_atu($0, $1)', helpers: ['_atu'] },
    'atp': { text: '_atp($0, $1, $2)', helpers: ['_atp'] },
    // A list local written in place (`operators.ts`).
    'copy': '$0.slice()',
    'wix': { text: '_wix($0, $1)', helpers: ['_wix'] },
    'get': '$0[$1]',
    'set': '($0[$1] = $2)',
    'getat': { text: '_at($0, $1)', helpers: ['_at'] },
    'getatu': { text: '_atu($0, $1)', helpers: ['_atu'] },
    'isnan': 'Number.isNaN($0)',
    'isundef': '($0 === undefined)',
    ...Object.fromEntries(
      ['present.int', 'present', 'cpresent', 'present.bool'].map((op) => [
        op,
        { text: '_present($0, $1)', helpers: ['_present'] },
      ])
    ),
    'count.int': { text: '_count($0)', helpers: ['_count'] },
    'draw': '_SYS.drawNextRandomNumber()',
    'shuffle': '_SYS.shuffle($0)',
    'sort': { text: '_sort($0)', helpers: ['_sort'] },
    'ordering': { text: '_ordering($0)', helpers: ['_ordering'] },
    'median': { text: '_median($0)', helpers: ['_median'] },
    'binomial': '_SYS.binomial($0, $1)',
    // A count that is NaN (a bound with no value) is an empty list.
    'rangecount': '(_SYS.rangeCount($0, $1, $2) || 0)',
    'rangestep': '($1 >= $0 ? 1 : -1)',
    ...calls('Math.', ['trunc', 'sign', 'log10', 'log2']),
    'hypot': 'Math.hypot($0, $1)',
    ...calls('Math.', ['atan', 'asin', 'acos', 'asinh', 'acosh', 'atanh']),
    // A colour is the runtime's object (`CompiledColor`): a
    // constructor gives it in OKLCh, a conversion in the space it names.
    'rgb': '_SYS.rgb($0, $1, $2)',
    'hsl': '_SYS.hsl($0, $1, $2)',
    'hsv': '_SYS.hsv($0, $1, $2)',
    'oklab': '_SYS.oklab($0, $1, $2)',
    'oklch': '_SYS.oklch($0, $1, $2)',
    'asrgb': '_SYS.asRgb($0)',
    'ashsl': '_SYS.asHsl($0)',
    'ashsv': '_SYS.asHsv($0)',
    'asoklab': '_SYS.asOklab($0)',
    'asoklch': '_SYS.asOklch($0)',
    // The functions of `REAL_FUNCTIONS` and `COMPLEX_FUNCTIONS`, by name.
    ...Object.fromEntries(
      Object.entries({ ...REAL_FUNCTIONS, ...COMPLEX_FUNCTIONS }).map(
        ([f, g]) => [
          f,
          `_SYS.ir.${f}(${Array.from({ length: g.length }, (_, k) => `$${k}`).join(', ')})`,
        ]
      )
    ),
    ...OTHER_LANES,
  },
  regions: {
    ...builds(NUMBERS, (out) => `${out}.length`),
    integrate: ({ outs: [out], args: [a, b], params: [t] }) => ({
      open: [`const ${out} = _SYS.irIntegrate((${t}) => {`],
      close: ([y]) => [`  return ${y};`, `}, ${a}, ${b});`],
    }),
    // The indices sorted by a comparison, as the interpreter sorts them.
    sortby: ({ outs: [out], args: [n], params: [i, j] }) => ({
      open: [
        `const ${out} = Array.from({ length: ${n} }, (_, k) => k).sort((${i}, ${j}) => {`,
      ],
      close: ([y]) => [`  return ${y};`, '});'],
    }),
    // The elements of an `Iterate`: the accumulator is a variable that
    // each pass sets to its element.
    iterate: ({ outs: [out], args: [n, x0], params: [k, acc] }) => ({
      open: [
        `const ${out}_n = ${n};`,
        guard(`${out}_n`, 'a list'),
        `const ${out} = new Array(${out}_n);`,
        `let ${acc} = ${x0};`,
        blocks(NUMBERS, k, `${out}_n`),
      ],
      close: ([y]) => [`  ${acc} = ${out}[${k}] = ${y};`, '}'],
    }),
    // The numeric derivative of the runtime (`_SYS.nd`).
    derivative: ({ outs: [out], args: [x], params: [t] }) => ({
      open: [`const ${out} = _SYS.nd((${t}) => {`],
      close: ([y]) => [`  return ${y};`, `}, 1, 'scalar')(${x});`],
    }),
    choice: ({ outs: [c, out], args: [n] }) => ({
      open: [
        `const ${out} = _SYS.randomChoice(_SYS.domainInterval('RandomChoice', 0, 1), ${n});`,
        `const ${c} = ${out}.length;`,
      ],
      close: () => [],
    }),
    seeded: ({ outs, args: [seed] }) => ({
      open: [
        ...outs.map((o) => `let ${o};`),
        `_SYS.withRandomSeed(${seed}, () => {`,
      ],
      close: (ys) => [...ys.map((y, j) => `  ${outs[j]} = ${y};`), '});'],
    }),
  },
  helpers: {
    _round: 'const _round = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));',
    _at: 'const _at = (l, i) => { const k = i > 0 ? i - 1 : l.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < l.length ? l[k] : NaN; };',
    _atu: 'const _atu = (l, i) => { const k = i > 0 ? i - 1 : l.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < l.length ? l[k] : undefined; };',
    // The index from 0 of the write `ReplaceAt(L, i, v)` or `AddTo(At(L,
    // i), e)` in a list of `n` elements; the interpreter's value of an
    // index that is 0, not an integer or out of range is an error.
    _wix: 'const _wix = (n, i) => { const k = i > 0 ? i - 1 : n + i; if (Number.isInteger(i) && i !== 0 && k >= 0 && k < n) return k; throw new Error(`out-of-range: the index ${i} of a write to a list of ${n} elements`); };',
    _atp: 'const _atp = (l, i, n) => { const k = i > 0 ? i - 1 : l.length + i; return Number.isInteger(i) && i !== 0 && k >= 0 && k < l.length ? l[k] : new Array(n).fill(NaN); };',
    // A sorted copy, NaN last, as the interpreter's `Sort`; the indices
    // from 1 of that order, stable, as its `Ordering`.
    _sort:
      'const _sort = (l) => [...l].sort((a, b) => (a < b ? -1 : a > b ? 1 : Number.isNaN(a) - Number.isNaN(b)));',
    _ordering:
      'const _ordering = (l) => Array.from(l, (_, i) => i).sort((i, j) => (l[i] < l[j] ? -1 : l[i] > l[j] ? 1 : Number.isNaN(l[i]) - Number.isNaN(l[j]))).map((i) => i + 1);',
    // The interpreter's `median()` (`numerics/statistics.ts`): NaN when an
    // element is NaN, and of no element.
    _median:
      'const _median = (l) => { if (l.some(Number.isNaN)) return NaN; const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; };',
    // `AssertPresent`: the interpreter's value is the error
    // `expected-present`.
    _present:
      "const _present = (m, x) => { if (m) throw new Error('expected-present: AssertPresent of an absent value'); return x; };",
    // A real count of `RotateLeft` or `RotateRight`: the interpreter's
    // value is the error `incompatible-type` where it is not an integer,
    // and unevaluated past the safe integers (`1e20`): both throw.
    _count:
      "const _count = (x) => { if (!Number.isSafeInteger(x)) throw new Error('incompatible-type: a count that is not an integer'); return x; };",
  },
  // A `bigint` literal is made in the bigint mode only (`JS_BIGINT`).
  constant: ({ value: x }) =>
    typeof x === 'object'
      ? `({ re: ${number(x.re)}, im: ${number(x.im)} })`
      : typeof x === 'boolean'
        ? String(x)
        : number(x as number),
  input: (name) =>
    IDENTIFIER.test(name) ? `_.${name}` : `_[${JSON.stringify(name)}]`,
  positional: (_name, k) => `a${k}`,
  length: (list) => `${list}.length`,
  list: (elements) => `[${elements.join(', ')}]`,
  // An array of the length, filled in index order by a `for` loop: an
  // expression, so a function called at once.
  map: (lengths, body) => {
    const index = lengths.map((_, d) => `i${d}`);
    return lengths.reduceRight<string>(
      (s, n, d) =>
        `((_n) => { const _r = new Array(_n); ${blocks(NUMBERS, index[d], '_n')} _r[${index[d]}] = ${s}; } return _r; })(${n})`,
      body(index)
    );
  },
  declare: (_type, name, value, mutable) =>
    `${mutable ? 'let' : 'const'} ${name}${value === undefined ? '' : ` = ${value}`};`,
  loopOpen: loopOpen(NUMBERS),
  retTuple: (values) => `return [${values.join(', ')}];`,
  call: (fn, args) => `${fn}(${args.join(', ')})`,
  fn: (name, params, _result, body) =>
    [
      `const ${name} = (${params.map((p) => p.name).join(', ')}) => {`,
      ...body,
      '};',
    ].join('\n'),
});

/**
 * The syntax of `mode: 'bigint'`: every integer is a JavaScript `bigint`
 * (`5n`), also an index and a length, converted with `Number()` where
 * JavaScript reads a number (an element, the length of an array) and with
 * `BigInt()` where it gives one (an input, the length of a list). The
 * operations that it spells are exact on `bigint` values, with the helpers
 * of the mode (`bigint-runtime.ts`, members of `_SYS`); it spells no other,
 * so a program with another operation declines (`admits()`). A helper
 * throws a `NonFiniteValue` at a pole, and one catch around the entry
 * returns its number.
 */
export const JS_BIGINT: Syntax = deepFreeze({
  ...JS,
  ops: {
    'add.int': '($0 + $1)',
    'sub.int': '($0 - $1)',
    'neg.int': '(-$0)',
    'mul.int': '($0 * $1)',
    'abs.int': '_SYS.babs($0)',
    'mod.int': '_SYS.bfloorMod($0, $1)',
    'max.int': '_SYS.bmax($0, $1)',
    'min.int': '_SYS.bmin($0, $1)',
    'emax.int': '_SYS.bmax($0, $1)',
    'emin.int': '_SYS.bmin($0, $1)',
    'pow.int': '_SYS.bpow($0, $1)',
    'factorial.int': '_SYS.bfactorial($0)',
    'sign': '_SYS.bsign($0)',
    'binomial': '_SYS.bbinomial($0, $1)',
    'gcd': '_SYS.bgcd($0, $1)',
    'lcm': '_SYS.blcm($0, $1)',
    'remainder.int': '_SYS.bremainder($0, $1)',
    'fibonacci.int': '_SYS.bfibonacci($0)',
    ...COMPARISONS,
    'eq': JS.ops.eq,
    'ne': JS.ops.ne,
    ...LOGIC,
    'boole': '($0 ? 1n : 0n)',
    'elem': '$0[Number($1)]',
    'at': '_SYS.bat($0, $1)',
    'rangecount': '_SYS.brangeCount($0, $1, $2)',
    'rangestep': '($1 >= $0 ? 1n : -1n)',
  },
  regions: builds(BIGINTS, (out) => `BigInt(${out}.length)`),
  loopOpen: loopOpen(BIGINTS),
  constant: (l) =>
    l.lane !== 'integer'
      ? JS.constant(l)
      : l.value < 0
        ? `(${BigInt(l.value)}n)`
        : `${BigInt(l.value)}n`,
  length: (list) => `BigInt(${list}.length)`,
  read: (text, t) =>
    t.lane === 'integer' && t.shape.length === 0 ? `BigInt(${text})` : text,
  map: (lengths, body) =>
    JS.map!(
      lengths.map((n) => `Number(${n})`),
      body
    ),
  entry: (body) => [
    'try {',
    ...body,
    '} catch (_e) { if (_e instanceof _SYS.NonFiniteValue) return _e.value; throw _e; }',
  ],
});

export type JavaScriptResult = {
  /** The value of a call: an expression of the inputs object `_`, or for
   *  a root function literal, the function of the positional arguments and
   *  then the inputs object. It reads `_SYS` and the names that
   *  `preambleOnce` defines. */
  readonly code: string;
  /** The helpers and the functions that `code` calls, evaluated once when
   *  the code is loaded (`''` when there is none). They read `_SYS`. */
  readonly preambleOnce: string;
  /** The function of the inputs object, or of the positional arguments
   *  and then the inputs object (a root function literal). */
  readonly run: (...args: any[]) => number | boolean | unknown[];
  readonly printed: Printed;
};

/** The runtime `_SYS` of the code: over the engine `ce` (its draws, its
 *  random frame and its deadline, read at each call), or with no engine,
 *  that of `createJavaScriptRuntime()`. */
export function runtimeOf(ce?: ComputeEngine): SysHelpers {
  return ce === undefined
    ? createSysRuntime()
    : makeSysHelpers(engineRuntimeSource(ce));
}

/** The lists of constants (and of such lists) of at least 16 constants in
 *  all, and the lists that they hold, in any function and region, which the
 *  code computes once, when it is loaded (below 16, the literal at each call
 *  is as fast); and every pure colour operation and element-wise operation
 *  of lists of constants, of such values and of constants, with the lists
 *  it reads. No code writes to a list or to a
 *  colour; a result can be such a value, which every call shares (results
 *  are read-only). */
function onceLists(
  p: Program,
  rows: readonly OperatorRow[],
  elementwise: boolean
): Set<V> {
  const size = new Map<V, number>();
  const lists: (Instr & { k: 'list' })[] = [];
  const once = new Set<V>();
  const known = (a: V) => size.has(a) || once.has(a);
  const walk = (r: Region): void =>
    r.body.forEach((i) => {
      regionsOf(i).forEach(walk);
      if (i.k === 'const') size.set(i.out, 1);
      if (
        i.k === 'op' &&
        (p.types[i.out].lane === 'color' ||
          (elementwise && p.types[i.out].shape.length > 0)) &&
        rowOfOp(rows, i.op)?.row.effect === 'pure' &&
        i.args.every(known)
      ) {
        once.add(i.out);
        i.args.forEach((a) => p.types[a].shape.length > 0 && once.add(a));
      }
      if (i.k !== 'list' || !i.args.every((a) => size.has(a))) return;
      size.set(
        i.out,
        i.args.reduce((n, a) => n + size.get(a)!, 0)
      );
      lists.push(i);
    });
  p.functions.forEach((f) => walk(f.body));
  for (const i of lists.reverse())
    if (once.has(i.out) || size.get(i.out)! >= 16) {
      once.add(i.out);
      i.args.forEach((a) => p.types[a].shape.length > 0 && once.add(a));
    }
  return once;
}

export function printJavaScript(
  p: Program,
  rows: readonly OperatorRow[],
  ce?: ComputeEngine,
  syntax: Syntax = JS,
  iterationBudget?: number
): JavaScriptResult {
  // With a budget, each pass of a `Loop` counts one pass of the call, as
  // `compile()`'s `iterationBudget` (floored).
  // No count where it cannot reach the budget: a bound of the passes of a
  // call at compile time (`loopPasses()`) within it, and no recursion.
  const limit = Math.floor(iterationBudget ?? Infinity);
  const budget =
    !Number.isFinite(limit) ||
    (recursiveFunctions(p.functions).size === 0 &&
      loopPasses(p, limit, useIndex(p).def, Infinity) <= limit)
      ? undefined
      : limit;
  const printed = printProgram(
    p,
    budget === undefined
      ? syntax
      : {
          ...syntax,
          loopOpen: (k, lo, hi, passes, done) => [
            ...syntax.loopOpen(k, lo, hi, passes, done),
            ...(passes ? [`  _SYS.countLoopPass(${budget});`] : []),
          ],
        },
    rows,
    // Not under an `entry` wrapper (the bigint mode): a value computed once
    // is outside its catch of a pole.
    onceLists(p, rows, syntax.entry === undefined)
  );
  const entry = entryOf(p);
  const n = argumentIndex(entry, entry.positional ?? 0);
  const params =
    n === 0
      ? '_'
      : `${Array.from({ length: n }, (_, k) => `a${k}`).join(', ')}, _ = {}`;
  const preambleOnce = [
    ...printed.helpers,
    ...[...printed.once.values()].map(([x, value]) => `const ${x} = ${value};`),
    ...printed.functions,
  ].join('\n');
  // The count starts again at each call of the entry.
  const counts = [preambleOnce, ...printed.body].some((s) =>
    s.includes('_SYS.countLoopPass(')
  );
  const body = [
    ...(counts ? ['  _SYS.resetLoopPasses();'] : []),
    ...(syntax.entry?.(printed.body) ?? printed.body),
  ].join('\n');
  const literal = entry.literal === true;
  const code = literal
    ? `(${params}) => {\n${body}\n}`
    : `(() => {\n${body}\n})()`;
  // The construction of `load()` of `createJavaScriptRuntime()`.
  let run: JavaScriptResult['run'];
  try {
    const sys = runtimeOf(ce);
    run = (
      literal
        ? twoStageRunner(sys, preambleOnce, [], `return (${code});`)()
        : twoStageRunner(sys, preambleOnce, ['_'], `return ${code};`)
    ) as JavaScriptResult['run'];
  } catch (e) {
    // A deadline that expires while the values computed once are computed.
    if (isCancellationError(e)) throw e;
    throw new Error(
      `slice: the JavaScript printer made code that does not parse (${String(e)}), for the inputs ${entry.paramNames.join(', ')}:\n${preambleOnce}\n${code}`
    );
  }
  return { code, preambleOnce, run, printed };
}
