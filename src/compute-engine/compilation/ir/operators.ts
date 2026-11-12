/**
 * The operator table of the slice compiler: one row per operator, the rows
 * of the region instructions, and the reductions.
 *
 * A row gives the head of the operator in the engine (none for an
 * operation that only the lowering makes), its arity, its signatures (per
 * operand a scalar lane, or a whole list; the lane of the result, or the
 * element of the list; the IR operation; tried in order), whether the
 * interpreter applies it to each element of a list (`threads`), its effect,
 * its value on numbers (`fold`), and the engine settings it depends on. A
 * second lane (complex, bigint) is more signatures, each with its own
 * operation.
 *
 * Adding an operator is one row here, and a spelling per printer for each
 * new IR operation (a target with no spelling declines it). The tables are
 * frozen: a caller adds rows for one compilation (`compileSlice`'s
 * `extend` option).
 */

import {
  elementType,
  type IRType,
  type Lane,
  type Length,
  type V,
} from './ir.js';
import { rangeCount } from '../../numerics/range-count.js';
import { negativeBaseRealPowFromRational } from '../../numerics/real-power.js';
import { erf, erfc } from '../../numerics/error-functions.js';
import { factorial, factorial2 } from '../../numerics/numeric.js';
import { gamma, lnAbsGamma, zeta } from '../../numerics/special-functions.js';
import {
  arcothReal,
  arcschReal,
  arsechReal,
} from '../../numerics/inverse-hyperbolic.js';

export type Effect = 'pure' | 'may-fail' | 'effectful';

/**
 * - a number: that many operands;
 * - `variadic`: two or more operands, a left fold of the binary operation;
 * - `chain`: two or more operands, the conjunction of the operation on each
 *   pair of neighbours (`a < b < c`).
 */
export type Arity = 0 | 1 | 2 | 3 | 'variadic' | 'chain';

/** An operand: a scalar of a sub-lane of the lane (each element of a list,
 *  when the row threads), or a whole list (`list`). */
export type Operand = Lane | 'list';

/** The operands (one for every operand of a `variadic` or `chain` row), the
 *  result (a lane, or the element of the list operand), the IR operation. */
export type Signature = readonly [
  args: readonly Operand[],
  result: Lane | 'element',
  op: string,
];

/** An engine setting that a row assumes at its default value. */
export type Setting = 'angularUnit' | 'roundingTies';

export type OperatorRow = {
  readonly head?: string;
  readonly arity: Arity;
  readonly signatures: readonly Signature[];
  readonly threads: boolean;
  readonly effect: Effect;
  /** The value of the operation on numbers. */
  readonly fold?: (...args: any[]) => number | boolean;
  /** When the operand `index` is the constant `value`, the operation is
   *  the row `head` of the other operands (`e^x` is `Exp(x)`). */
  readonly constantOperand?: { index: number; value: number; head: string };
  readonly settings?: readonly Setting[];
  /** `operand`: the result can be (a part of) its list operand, so it can
   *  alias an input; otherwise the result is a new value. */
  readonly alias?: 'operand';
};

/** The modulo of the interpreter: the sign of the divisor (`Mod(-7, 3)` is
 *  2). Exact for integers: `%` is exact in IEEE 754. An operand beyond the
 *  safe integer range, or infinite, throws a `RangeError`: the double is the
 *  rounding of the value that made it, and its remainder is another number
 *  (`Mod(25!, 7)` is 0, the remainder of the double 6;
 *  docs/COMPILATION-MODEL.md, "Integer operations beyond the safe integer
 *  range"). A NaN propagates. */
export function floorMod(a: number, b: number): number {
  for (const x of [a, b])
    if (Math.abs(x) > Number.MAX_SAFE_INTEGER)
      throw new RangeError(
        `Mod: ${x} is beyond the safe integer range of compiled code`
      );
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

/** The rounding of the interpreter (default `roundingTies`): half away
 *  from zero (`Round(-2.5)` is -3). */
export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** The largest exponent that `pow` computes by multiplications. */
export const MAX_PRODUCT_EXPONENT = 16;

/**
 * The real power of the JavaScript target (its runtime calls this, and the
 * fold): an integer exponent 1 to 16 by multiplications from the left
 * (exact on integers in range); the exponent 0 gives 1 for a finite base
 * other than 0, and NaN for 0, NaN and an infinity (the interpreter's
 * values); a negative base with a non-integer exponent gives the
 * interpreter's real root when the exponent is `p/q` with an odd `q`
 * (`negativeBaseRealPowFromRational()`, the rule of `Power` on machine
 * numbers), NaN otherwise.
 */
export function realPow(a: number, b: number): number {
  if (Number.isInteger(b) && b >= 1 && b <= MAX_PRODUCT_EXPONENT) {
    let r = a;
    for (let i = 1; i < b; i++) r *= a;
    return r;
  }
  if (b === 0) return a !== 0 && Number.isFinite(a) ? 1 : NaN;
  if (a < 0 && !Number.isInteger(b))
    return negativeBaseRealPowFromRational(a, undefined, b) ?? NaN;
  return Math.pow(a, b);
}

/**
 * The real functions that the JavaScript runtime `_rt` calls by the name
 * of their IR operation, and that the fold of their row computes. Each one
 * gives the interpreter's real value within the precision of a double (but
 * see docs/COMPILATION-MODEL.md for `Zeta` below -171); a pole (`Gamma(-2)`, `Coth(0)`) is
 * +∞ or -∞, and a value that is not real is NaN (the caveats of compiled
 * code). `root(x, n)` of a negative `x` is the real root when `n` is an odd
 * integer, or when `1/n` is a rational of odd denominator, as `realPow`.
 */
export const REAL_FUNCTIONS = Object.freeze({
  root: (x: number, n: number): number => {
    if (n === 0) return NaN;
    if (x < 0 && Number.isInteger(n) && n % 2 !== 0)
      return -Math.pow(-x, 1 / n);
    return (
      negativeBaseRealPowFromRational(x, undefined, 1 / n) ?? Math.pow(x, 1 / n)
    );
  },
  erf: (x: number): number => erf(x),
  erfc: (x: number): number => erfc(x),
  gamma: (x: number): number =>
    Number.isInteger(x) && x <= 0 ? Infinity : gamma(x),
  gammaln: (x: number): number => lnAbsGamma(x),
  factorial: (x: number): number =>
    Number.isInteger(x) ? (x < 0 ? Infinity : factorial(x)) : gamma(x + 1),
  factorial2: (x: number): number =>
    Number.isInteger(x) && x < 0 && x % 2 === 0 ? Infinity : factorial2(x),
  zeta: (x: number): number => zeta(x),
  // The interpreter has no -0: `Arctan2(-0, -1)` is π.
  atan2: (y: number, x: number): number => Math.atan2(y + 0, x + 0),
  // The interpreter's `Arccot` is in (0, π).
  acot: (x: number): number =>
    x > 0 ? Math.atan(1 / x) : Math.PI / 2 - Math.atan(x),
  asec: (x: number): number => Math.acos(1 / x),
  acsc: (x: number): number => Math.asin(1 / x),
  acoth: arcothReal,
  asech: arsechReal,
  acsch: arcschReal,
  coth: (x: number): number => 1 / Math.tanh(x),
  fract: (x: number): number => x - Math.floor(x),
  hav: (x: number): number => Math.sin(x / 2) ** 2,
});

const F = REAL_FUNCTIONS;
const R: Lane = 'real';
const I: Lane = 'integer';
const B: Lane = 'boolean';

type Options = Partial<Omit<OperatorRow, 'arity' | 'signatures'>>;

function row(
  head: string | undefined,
  arity: Arity,
  signatures: Signature[],
  options: Options
): OperatorRow {
  return { threads: true, effect: 'pure', ...options, head, arity, signatures };
}

/** The integer and the real signature of an arithmetic operation `op`. */
function arith(op: string, n: number): Signature[] {
  return [
    [Array(n).fill(I), I, `${op}.int`],
    [Array(n).fill(R), R, op],
  ];
}

/** `x`, with every object and array it holds frozen (not functions),
 *  also the children of a container that is already frozen. */
export function deepFreeze<T>(x: T, seen = new Set<object>()): T {
  if (typeof x === 'object' && x !== null && !seen.has(x)) {
    seen.add(x);
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v, seen);
  }
  return x;
}

/** A map whose entries cannot change: `set`, `delete` and `clear` throw,
 *  and each value is frozen. */
function frozenMap<K, T>(entries: [K, T][]): ReadonlyMap<K, T> {
  const m = new Map(entries.map(([k, v]) => [k, deepFreeze(v)]));
  const refuse = () => {
    throw new TypeError('slice: a table of the compiler is frozen');
  };
  Object.assign(m, { set: refuse, delete: refuse, clear: refuse });
  return Object.freeze(m);
}

const angle: Options = { settings: ['angularUnit'] };
const list: Options = { threads: false };
const part: Options = { threads: false, alias: 'operand' };

// prettier-ignore
export const OPERATORS: readonly OperatorRow[] = Object.freeze([
  row('Add',          'variadic', arith('add', 1),               { fold: (a: number, b: number) => a + b }),
  row('Subtract',     2,          arith('sub', 2),               { fold: (a: number, b: number) => a - b }),
  row('Negate',       1,          arith('neg', 1),               { fold: (a: number) => -a }),
  row('Multiply',     'variadic', arith('mul', 1),               { fold: (a: number, b: number) => a * b }),
  row('Divide',       2,          [[[R, R], R, 'div']],          { fold: (a: number, b: number) => a / b }),
  row('Power',        2,          [[[R, R], R, 'pow']],          { fold: realPow, constantOperand: { index: 0, value: Math.E, head: 'Exp' } }),
  row('Sqrt',         1,          [[[R], R, 'sqrt']],            { fold: Math.sqrt }),
  row('Abs',          1,          arith('abs', 1),               { fold: Math.abs }),
  row('Exp',          1,          [[[R], R, 'exp']],             { fold: Math.exp }),
  row('Ln',           1,          [[[R], R, 'ln']],              { fold: Math.log }),
  row('Sin',          1,          [[[R], R, 'sin']],             { fold: Math.sin, ...angle }),
  row('Cos',          1,          [[[R], R, 'cos']],             { fold: Math.cos, ...angle }),
  row('Tan',          1,          [[[R], R, 'tan']],             { fold: Math.tan, ...angle }),
  row('Floor',        1,          [[[R], I, 'floor']],           { fold: Math.floor }),
  row('Ceil',         1,          [[[R], I, 'ceil']],            { fold: Math.ceil }),
  row('Round',        1,          [[[R], I, 'round']],           { fold: roundHalfAway, settings: ['roundingTies'] }),
  row('Mod',          2,          arith('mod', 2),               { fold: floorMod, effect: 'may-fail' }),
  row('Truncate',     1,          [[[R], I, 'trunc']],           { fold: Math.trunc }),
  row('Sign',         1,          [[[R], I, 'sign']],            { fold: Math.sign }),
  row('Fract',        1,          [[[R], R, 'fract']],           { fold: F.fract }),
  row('Log',          1,          [[[R], R, 'log10']],           { fold: Math.log10 }),
  row('Hypot',        2,          [[[R, R], R, 'hypot']],        { fold: Math.hypot }),
  row('Root',         2,          [[[R, R], R, 'root']],         { fold: F.root }),
  row('Arctan',       1,          [[[R], R, 'atan']],            { fold: Math.atan, ...angle }),
  row('Arctan2',      2,          [[[R, R], R, 'atan2']],        { fold: F.atan2, ...angle }),
  row('Arcsin',       1,          [[[R], R, 'asin']],            { fold: Math.asin, ...angle }),
  row('Arccos',       1,          [[[R], R, 'acos']],            { fold: Math.acos, ...angle }),
  row('Arccot',       1,          [[[R], R, 'acot']],            { fold: F.acot, ...angle }),
  row('Arcsec',       1,          [[[R], R, 'asec']],            { fold: F.asec, ...angle }),
  row('Arccsc',       1,          [[[R], R, 'acsc']],            { fold: F.acsc, ...angle }),
  row('Haversine',    1,          [[[R], R, 'hav']],             { fold: F.hav, ...angle }),
  row('Coth',         1,          [[[R], R, 'coth']],            { fold: F.coth }),
  row('Arsinh',       1,          [[[R], R, 'asinh']],           { fold: Math.asinh }),
  row('Arcosh',       1,          [[[R], R, 'acosh']],           { fold: Math.acosh }),
  row('Artanh',       1,          [[[R], R, 'atanh']],           { fold: Math.atanh }),
  row('Arcoth',       1,          [[[R], R, 'acoth']],           { fold: F.acoth }),
  row('Arsech',       1,          [[[R], R, 'asech']],           { fold: F.asech }),
  row('Arcsch',       1,          [[[R], R, 'acsch']],           { fold: F.acsch }),
  row('Erf',          1,          [[[R], R, 'erf']],             { fold: F.erf }),
  row('Erfc',         1,          [[[R], R, 'erfc']],            { fold: F.erfc }),
  row('Gamma',        1,          [[[R], R, 'gamma']],           { fold: F.gamma }),
  row('GammaLn',      1,          [[[R], R, 'gammaln']],         { fold: F.gammaln }),
  row('Factorial',    1,          [[[R], R, 'factorial']],       { fold: F.factorial }),
  row('Factorial2',   1,          [[[R], R, 'factorial2']],      { fold: F.factorial2 }),
  row('Zeta',         1,          [[[R], R, 'zeta']],            { fold: F.zeta }),
  // `Max` of a list is its largest element: a reduction, not threaded.
  row('Max',          'variadic', arith('max', 1),               { fold: Math.max, ...list }),
  row('Min',          'variadic', arith('min', 1),               { fold: Math.min, ...list }),
  row('Less',         'chain',    [[[R], B, 'lt']],              { fold: (a: number, b: number) => a < b }),
  row('LessEqual',    'chain',    [[[R], B, 'le']],              { fold: (a: number, b: number) => a <= b }),
  row('Greater',      'chain',    [[[R], B, 'gt']],              { fold: (a: number, b: number) => a > b }),
  row('GreaterEqual', 'chain',    [[[R], B, 'ge']],              { fold: (a: number, b: number) => a >= b }),
  // `Equal` of two lists compares the lists.
  row('Equal',        'chain',    [[[R], B, 'eq']],              { fold: (a: number, b: number) => a === b, ...list }),
  row('NotEqual',     2,          [[[R, R], B, 'ne']],           { fold: (a: number, b: number) => a !== b, ...list }),
  row('And',          'variadic', [[[B], B, 'and']],             { fold: (a: boolean, b: boolean) => a && b, ...list }),
  row('Or',           'variadic', [[[B], B, 'or']],              { fold: (a: boolean, b: boolean) => a || b, ...list }),
  row('Not',          1,          [[[B], B, 'not']],             { fold: (a: boolean) => !a, ...list }),
  // The interpreter's `At`: from 1, from the end when negative, NaN for an
  // index that is 0, not an integer, or out of range.
  row('At',           2,          [[['list', R], 'element', 'at']], part),
  // An element from 0, at an index in range where the lowering puts it.
  row(undefined,      2,          [[['list', I], 'element', 'elem']], part),
  // A draw of the active `WithRandomSeed` frame, or a live draw outside one.
  row('Random',       0,          [[[], R, 'draw']],             { ...list, effect: 'effectful' }),
  // The number of elements of `Range(a, b, step)`: the engine's `rangeCount`.
  row(undefined,      3,          [[[I, I, I], I, 'rangecount']], { ...list, fold: rangeCount }),
  // The step of `Range(a, b)`: 1, or -1 when `b < a`.
  row(undefined,      2,          [[[I, I], I, 'rangestep']],    { ...list, fold: (a: number, b: number) => (b >= a ? 1 : -1) }),
].map((r) => deepFreeze(r)));

/**
 * The region instructions. `args` are the lanes of the operands, `params`
 * the lanes of the parameters of the region; `results` gives the types of
 * the results from the operands, the types of the yields and the results
 * (undefined: the yields are wrong).
 *
 * - `build`: a list of `n` elements, the yield of the region at each index
 *   from 0 to `n - 1`.
 * - `filter`: the elements whose first yield is true; the results are the
 *   count and the list.
 * - `seeded`: the region run in a new random frame of the seed; its yields
 *   are the results.
 *
 * `alias(j, yields)` gives the yields that the result `j` can be.
 */
export type RegionRow = {
  readonly op: string;
  readonly effect: Effect;
  readonly args: readonly Lane[];
  readonly params: readonly Lane[];
  readonly results: (
    args: readonly V[],
    yields: readonly IRType[],
    outs: readonly V[]
  ) => IRType[] | undefined;
  readonly alias: (j: number, yields: readonly V[]) => V[];
};

const listOf = (element: IRType, n: Length): IRType => ({
  lane: element.lane,
  shape: [n, ...element.shape],
});

const last = (_: number, ys: readonly V[]) => [ys[ys.length - 1]];

export const REGION_ROWS: readonly RegionRow[] = deepFreeze([
  {
    op: 'build',
    effect: 'may-fail',
    args: [I],
    params: [I],
    results: ([n], ys) =>
      ys.length === 1 ? [listOf(ys[0], { v: n })] : undefined,
    alias: last,
  },
  {
    op: 'filter',
    effect: 'may-fail',
    args: [I],
    params: [I],
    results: (_, ys, [count]) =>
      ys.length === 2 && ys[0].lane === B && ys[0].shape.length === 0
        ? [{ lane: I, shape: [] }, listOf(ys[1], { v: count })]
        : undefined,
    alias: last,
  },
  {
    op: 'seeded',
    effect: 'may-fail',
    args: [R],
    params: [],
    results: (_, ys) => [...ys],
    alias: (j, ys) => [ys[j]],
  },
]);

/** The reductions, by head: the row that accumulates from its identity,
 *  and the forms the head has (`indexed`: `Sum(body, Limits(k, a, b))`, as
 *  well as `Sum(L)`, `Max(L, x)`). `empty`: the value of the reduction of
 *  no term, when it is not the identity (`Max()` is NaN). */
export const REDUCTIONS: ReadonlyMap<
  string,
  { row: string; identity: number; indexed: boolean; empty?: number }
> = frozenMap([
  ['Sum', { row: 'Add', identity: 0, indexed: true }],
  ['Product', { row: 'Multiply', identity: 1, indexed: true }],
  ['Max', { row: 'Max', identity: -Infinity, indexed: false, empty: NaN }],
  ['Min', { row: 'Min', identity: Infinity, indexed: false, empty: NaN }],
]);

/** The constant symbols of the library. */
export const CONSTANTS: ReadonlyMap<string, number> = frozenMap([
  ['Pi', Math.PI],
  ['ExponentialE', Math.E],
]);

/** Whether the engine has the setting `s` at the value the rows assume. */
export const SETTINGS: Record<
  Setting,
  (ce: { angularUnit: string; roundingTies: string }) => boolean
> = Object.freeze({
  angularUnit: (ce: { angularUnit: string }) => ce.angularUnit === 'rad',
  roundingTies: (ce: { roundingTies: string }) =>
    ce.roundingTies === 'away-from-zero',
});

export function rowOfHead(
  rows: readonly OperatorRow[],
  head: string
): OperatorRow | undefined {
  return rows.find((r) => r.head === head);
}

/** The row and the signature of the IR operation `op`. */
export function rowOfOp(
  rows: readonly OperatorRow[],
  op: string
): { row: OperatorRow; signature: Signature } | undefined {
  for (const row of rows)
    for (const signature of row.signatures)
      if (signature[2] === op) return { row, signature };
  return undefined;
}

export function regionRow(op: string): RegionRow | undefined {
  return REGION_ROWS.find((r) => r.op === op);
}

/** The first signature of `row` that accepts operands of `types` (a
 *  scalar of a sub-lane, or a list of elements of a sub-lane; a list
 *  where a scalar is read when the row threads), or `undefined`. */
export function signatureOf(
  row: OperatorRow,
  types: readonly IRType[]
): Signature | undefined {
  const sub = (a: Lane, b: Lane) =>
    a === b || (a === 'integer' && b === 'real');
  return row.signatures.find(([args]) =>
    types.every((t, i) => {
      const a = args.length === 1 ? args[0] : args[i];
      if (a === 'list') return t.shape.length > 0;
      return sub(t.lane, a) && (t.shape.length === 0 || row.threads);
    })
  );
}

/** The type of the result of `signature` on operands of `types`, or
 *  `undefined` (lists of two shapes). */
export function resultType(
  signature: Signature,
  types: readonly IRType[],
  sameShape: (a: readonly Length[], b: readonly Length[]) => boolean
): IRType | undefined {
  const [args, result] = signature;
  if (result === 'element') return elementType(types[args.indexOf('list')]);
  const lists = types.filter((t) => t.shape.length > 0);
  const shape = lists[0]?.shape ?? [];
  if (!lists.every((t) => sameShape(t.shape, shape))) return undefined;
  return { lane: result, shape };
}

/** The number of operands of the IR operation of `row`. */
export function irArity(row: OperatorRow): number {
  return typeof row.arity === 'number' ? row.arity : 2;
}
