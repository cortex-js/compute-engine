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
 *
 * The complex lane: a complex signature reads `complex` operands, and a
 * real operand is converted where it is read (`cplx`, which the lowering
 * adds). In `mode: 'complex'`, a row with `leaves` takes its complex
 * signature unless its operands prove a real value.
 *
 * The bigint mode has no lane of its own: a row takes a signature whose
 * result is an integer, a boolean or an element (`signatureOf()`), and the
 * bigint `Syntax` (`print-js.ts`) spells the operations whose spelling is
 * exact on `bigint` values; it declines the others.
 */

import {
  elementType,
  mapLengths,
  widensTo,
  type IRType,
  type Lane,
  type Length,
  type V,
} from './ir.js';
import { rangeCount } from '../../numerics/range-count.js';
import { binomial } from '../../numerics/special-functions.js';
import {
  COLOR_CHANNEL_SPACES,
  COLOR_STRING_FORMATS,
} from '../../numerics/color-conversion.js';
// The functions that the runtime `_SYS.ir` holds (`javascript-runtime.ts`),
// which the folds compute.
import {
  COMPLEX_FUNCTIONS,
  floorMod,
  realPow,
  REAL_FUNCTIONS,
} from '../javascript-runtime.js';

export {
  COMPLEX_FUNCTIONS,
  MAX_PRODUCT_EXPONENT,
  REAL_FUNCTIONS,
} from '../javascript-runtime.js';

export type Effect = 'pure' | 'may-fail' | 'effectful';

/**
 * - a number: that many operands;
 * - `variadic`: two or more operands, a left fold of the binary operation;
 * - `chain`: two or more operands, the conjunction of the operation on each
 *   pair of neighbours (`a < b < c`).
 */
export type Arity = 0 | 1 | 2 | 3 | 4 | 'variadic' | 'chain';

/** An operand: a scalar of a sub-lane of the lane (each element of a list,
 *  when the row threads), or a whole list (`list`). */
export type Operand = Lane | 'list';

/** The operands (one for every operand of a `variadic` or `chain` row), the
 *  result (a lane, the element of the list operand, or a real of the shape
 *  of that element), the IR operation. */
export type Signature = readonly [
  args: readonly Operand[],
  result: Lane | 'element' | 'real-element',
  op: string,
];

/** An engine setting that a row assumes at its default value. */
export type Setting = 'roundingTies';

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
  /** Under an angular unit other than radians (`ANGLE_FACTORS`), the
   *  operands are angles, multiplied by the radians of the unit
   *  (`operands`), or the result is one, multiplied by the units of a
   *  radian (`result`), as the interpreter converts them. */
  readonly angle?: 'operands' | 'result';
  /** The row can leave the reals: in `mode: 'complex'` it takes its
   *  complex signature unless the operand `nonnegative` is proved `>= 0`
   *  or the operand `integer` is on the integer lane; in `mode: 'strict'`
   *  when the engine proves the operand `nonnegative` negative (`leaves()`
   *  of `lower.ts`). */
  readonly leaves?: {
    readonly nonnegative?: number;
    readonly integer?: number;
  };
};

/** The rounding of the interpreter (default `roundingTies`): half away
 *  from zero (`Round(-2.5)` is -3). */
export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** The value of the IR operation `op` on constants: its function of
 *  `COMPLEX_FUNCTIONS`, or the `fold` of its row. */
export function foldOf(
  rows: readonly OperatorRow[],
  op: string
): ((...args: any[]) => unknown) | undefined {
  const f = (COMPLEX_FUNCTIONS as Record<string, (...a: any[]) => unknown>)[op];
  return f ?? rowOfOp(rows, op)?.row.fold;
}

const F = REAL_FUNCTIONS;
const C: Lane = 'complex';
export const R: Lane = 'real';
export const I: Lane = 'integer';
const B: Lane = 'boolean';
const K: Lane = 'color';
const S: Lane = 'string';

type Options = Partial<Omit<OperatorRow, 'arity' | 'signatures'>>;

export function row(
  head: string | undefined,
  arity: Arity,
  signatures: Signature[],
  options: Options
): OperatorRow {
  return { threads: true, effect: 'pure', ...options, head, arity, signatures };
}

/** The integer and the real signature of an arithmetic operation `op`,
 *  and with `complex`, the complex one `c<op>`. */
export function arith(op: string, n: number, complex = false): Signature[] {
  const s: Signature[] = [
    [Array(n).fill(I), I, `${op}.int`],
    [Array(n).fill(R), R, op],
  ];
  return complex ? [...s, [Array(n).fill(C), C, `c${op}`]] : s;
}

/** The real signature of `op`, and the complex one `cop`. */
function rc(op: string, n: number, cop = `c${op}`): Signature[] {
  return [
    [Array(n).fill(R), R, op],
    [Array(n).fill(C), C, cop],
  ];
}

/** In `mode: 'complex'`: complex unless the operand is nonnegative
 *  (`cut`), or always (`domain`). */
const cut: Options = { leaves: { nonnegative: 0 } };
const domain: Options = { leaves: {} };

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

const angle: Options = { angle: 'operands' };
const inverse: Options = { angle: 'result' };
export const list: Options = { threads: false };

// prettier-ignore
export const OPERATORS: readonly OperatorRow[] = Object.freeze([
  row('Add',          'variadic', arith('add', 1, true),         { fold: (a: number, b: number) => a + b }),
  row('Subtract',     2,          arith('sub', 2, true),         { fold: (a: number, b: number) => a - b }),
  row('Negate',       1,          arith('neg', 1, true),         { fold: (a: number) => -a }),
  row('Multiply',     'variadic', arith('mul', 1, true),         { fold: (a: number, b: number) => a * b }),
  row('Divide',       2,          rc('div', 2),                  { fold: (a: number, b: number) => a / b }),
  // The division by the denominator of a rational factor, which the
  // lowering makes: exact where the quotient is an integer or a half of
  // one (a GLSL division need not be correctly rounded).
  row(undefined,      2,          [[[R, R], R, 'div.q']],        { fold: (a: number, b: number) => a / b }),
  // The floor of the quotient of two integers, which the lowering makes in
  // the bigint mode only: the rounding of an integer times a rational
  // constant (`Floor(n/2)`), and `(a - Mod(a, c))/c`.
  row(undefined,      2,          [[[I, I], I, 'floordiv.int']], {}),
  row('Power',        2,          [...rc('pow', 2), [[I, I], I, 'pow.int']], { fold: realPow, constantOperand: { index: 0, value: Math.E, head: 'Exp' }, leaves: { nonnegative: 0, integer: 1 } }),
  row('Sqrt',         1,          rc('sqrt', 1),                 { fold: Math.sqrt, ...cut }),
  row('Abs',          1,          [...arith('abs', 1), [[C], R, 'cabs']], { fold: Math.abs }),
  row('Exp',          1,          rc('exp', 1),                  { fold: Math.exp }),
  row('Ln',           1,          rc('ln', 1),                   { fold: Math.log, ...cut }),
  row('Sin',          1,          rc('sin', 1),                  { fold: Math.sin, ...angle }),
  row('Cos',          1,          rc('cos', 1),                  { fold: Math.cos, ...angle }),
  row('Tan',          1,          rc('tan', 1),                  { fold: Math.tan, ...angle }),
  row('Cot',          1,          rc('cot', 1),                  { fold: (x: number) => 1 / Math.tan(x), ...angle }),
  row('Sec',          1,          rc('sec', 1),                  { fold: (x: number) => 1 / Math.cos(x), ...angle }),
  row('Csc',          1,          rc('csc', 1),                  { fold: (x: number) => 1 / Math.sin(x), ...angle }),
  row('Sinh',         1,          rc('sinh', 1),                 { fold: Math.sinh }),
  row('Cosh',         1,          rc('cosh', 1),                 { fold: Math.cosh }),
  row('Tanh',         1,          rc('tanh', 1),                 { fold: Math.tanh }),
  row('Sech',         1,          rc('sech', 1),                 { fold: (x: number) => 1 / Math.cosh(x) }),
  row('Csch',         1,          rc('csch', 1),                 { fold: (x: number) => 1 / Math.sinh(x) }),
  row('Degrees',      1,          [[[R], R, 'deg']],             { fold: (x: number) => (x * Math.PI) / 180, ...inverse }),
  row('Real',         1,          [[[C], R, 'cre']],             {}),
  row('Imaginary',    1,          [[[C], R, 'cim']],             {}),
  row('Conjugate',    1,          [[[C], C, 'cconj']],           {}),
  row('Argument',     1,          [[[C], R, 'carg']],            inverse),
  // The smooth escape time of a point (`library/fractals.ts`).
  row('Mandelbrot',   2,          [[[C, I], R, 'mandelbrot']],   {}),
  row('Julia',        3,          [[[C, C, I], R, 'julia']],     {}),
  // The conversion of a real to the complex lane, which the lowering adds.
  row(undefined,      1,          [[[R], C, 'cplx']],            {}),
  row('Floor',        1,          [[[R], I, 'floor']],           { fold: Math.floor }),
  row('Ceil',         1,          [[[R], I, 'ceil']],            { fold: Math.ceil }),
  row('Round',        1,          [[[R], I, 'round']],           { fold: roundHalfAway, settings: ['roundingTies'] }),
  row('Mod',          2,          arith('mod', 2),               { fold: floorMod }),
  row('Truncate',     1,          [[[R], I, 'trunc']],           { fold: Math.trunc }),
  row('Sign',         1,          [[[R], I, 'sign'], [[C], C, 'csign']], { fold: Math.sign }),
  row('Fract',        1,          [[[R], R, 'fract']],           { fold: F.fract }),
  row('Log',          1,          rc('log10', 1, 'clog10'),      { fold: Math.log10, ...cut }),
  // The real `Log(x, 2)`, which the lowering makes.
  row(undefined,      1,          [[[R], R, 'log2']],            { fold: Math.log2 }),
  row('Hypot',        2,          [[[R, R], R, 'hypot']],        { fold: Math.hypot }),
  row('Root',         2,          rc('root', 2),                 { fold: F.root, ...cut }),
  row('Arctan',       1,          rc('atan', 1),                 { fold: Math.atan, ...inverse }),
  row('Arctan2',      2,          [[[R, R], R, 'atan2']],        { fold: F.atan2, ...inverse }),
  row('Arcsin',       1,          rc('asin', 1),                 { fold: Math.asin, ...inverse, ...domain }),
  row('Arccos',       1,          rc('acos', 1),                 { fold: Math.acos, ...inverse, ...domain }),
  row('Arccot',       1,          rc('acot', 1),                 { fold: F.acot, ...inverse }),
  row('Arcsec',       1,          rc('asec', 1),                 { fold: F.asec, ...inverse, ...domain }),
  row('Arccsc',       1,          rc('acsc', 1),                 { fold: F.acsc, ...inverse, ...domain }),
  row('Haversine',    1,          [[[R], R, 'hav']],             { fold: F.hav, ...angle }),
  row('Coth',         1,          rc('coth', 1),                 { fold: F.coth }),
  row('Arsinh',       1,          rc('asinh', 1),                { fold: Math.asinh }),
  row('Arcosh',       1,          rc('acosh', 1),                { fold: Math.acosh, ...domain }),
  row('Artanh',       1,          rc('atanh', 1),                { fold: Math.atanh, ...domain }),
  row('Arcoth',       1,          rc('acoth', 1),                { fold: F.acoth, ...domain }),
  row('Arsech',       1,          rc('asech', 1),                { fold: F.asech, ...domain }),
  row('Arcsch',       1,          rc('acsch', 1),                { fold: F.acsch }),
  row('Erf',          1,          [[[R], R, 'erf']],             { fold: F.erf }),
  row('Erfc',         1,          [[[R], R, 'erfc']],            { fold: F.erfc }),
  row('FresnelC',     1,          [[[R], R, 'fresnelc']],        { fold: F.fresnelc }),
  row('FresnelS',     1,          [[[R], R, 'fresnels']],        { fold: F.fresnels }),
  // In radians under every angular unit, as the interpreter's.
  row('Sinc',         1,          [[[R], R, 'sinc']],            { fold: F.sinc }),
  row('Gamma',        1,          rc('gamma', 1),                { fold: F.gamma }),
  row('GammaLn',      1,          [[[R], R, 'gammaln']],         { fold: F.gammaln }),
  // An integer operand first: GLSL spells `factorial.int` only.
  row('Factorial',    1,          [[[I], I, 'factorial.int'], [[R], R, 'factorial']], { fold: F.factorial }),
  // An integer signature first: the bigint mode spells it. Of reals, the
  // interpreter's extension (`Binomial(2.5, 1.5)`, `GCD(7.5, 2)` is 0.5).
  // `Binomial` and `Choose` thread over a list, as the interpreter's; `GCD`
  // and `LCM` do not.
  row('Binomial',     2,          [[[I, I], I, 'binomial'], [[R, R], R, 'rbinomial']], { fold: binomial }),
  row('Choose',       2,          [[[I, I], I, 'binomial'], [[R, R], R, 'rbinomial']], { fold: binomial }),
  row('GCD',          'variadic', [[[I], I, 'gcd'], [[R], R, 'rgcd']], { ...list, fold: F.gcd }),
  row('LCM',          'variadic', [[[I], I, 'lcm'], [[R], R, 'rlcm']], { ...list, fold: F.lcm }),
  row('Factorial2',   1,          [[[R], R, 'factorial2']],      { fold: F.factorial2 }),
  // Of a complex `s`, the interpreter's Hurwitz kernel at `a = 1`
  // (`czeta`), as the interpreter evaluates it (CE-1600).
  row('Zeta',         1,          rc('zeta', 1),                 { fold: F.zeta }),
  // `Zeta(s, a)`: the generalized zeta of Wolfram's convention. Of a complex
  // `s` and a real `a`, the interpreter's kernel (CE-1732); a complex `a`
  // declines.
  row('Zeta',         2,          [[[R, R], R, 'zetagen'], [[C, R], C, 'czetagen']], { fold: F.zetagen }),
  // `Chop(x, tol)`; `Chop(x)` takes the engine's tolerance (`lower.ts`).
  row('Chop',         2,          [[[R, R], R, 'chop']],         { fold: F.chop }),
  // The special functions and steps of the library: of real operands, the
  // interpreter's kernels (`REAL_FUNCTIONS`); an order or a branch that the
  // library types `integer` is on the integer lane. A head of two forms has
  // a row per arity (`rowOfHead()`). `domain`: the value of real operands
  // can be complex, where the real function is NaN; in `mode: 'complex'`
  // such a row takes its complex signature (the interpreter's continued
  // kernel, `COMPLEX_FUNCTIONS`), and declines when it has none.
  row('Heaviside',    1,          [[[R], R, 'heaviside']],       { fold: F.heaviside }),
  row('Remainder',    2,          [[[I, I], I, 'remainder.int'], [[R, R], R, 'remainder']], { fold: F.remainder }),
  row('Smoothstep',   3,          [[[R, R, R], R, 'smoothstep']], { fold: F.smoothstep }),
  row('InverseHaversine', 1,      rc('invhav', 1),               { fold: F.invhav, ...inverse, ...domain }),
  row('ErfInv',       1,          [[[R], R, 'erfinv']],          { fold: F.erfinv }),
  row('Erfi',         1,          [[[R], R, 'erfi']],            { fold: F.erfi }),
  row('Beta',         2,          [[[R, R], R, 'beta']],         { fold: F.beta }),
  row('BetaRegularized', 3,       [[[R, R, R], R, 'betareg']],   { fold: F.betareg }),
  row('GammaRegularized', 2,      [[[R, R], R, 'gammareg']],     { fold: F.gammareg }),
  // `Gamma(s, z)`, the upper incomplete gamma.
  row('Gamma',        2,          rc('gammaupper', 2),           { fold: F.gammaupper, ...domain }),
  row('HarmonicNumber', 1,        [[[R], R, 'harmonic']],        { fold: F.harmonic }),
  row('HarmonicNumber', 2,        [[[R, R], R, 'harmonic2']],    { fold: F.harmonic2, ...domain }),
  // Of a complex `z`, `PolyGamma(0, z)`, as the interpreter (CE-1732).
  row('Digamma',      1,          [[[R], R, 'digamma'], [[C], C, 'cdigamma']], { fold: F.digamma }),
  row('Trigamma',     1,          [[[R], R, 'trigamma']],        { fold: F.trigamma }),
  row('PolyGamma',    2,          [[[I, R], R, 'polygamma'], [[I, C], C, 'cpolygamma']], { fold: F.polygamma, ...domain }),
  row('AiryAi',       1,          [[[R], R, 'airyai']],          { fold: F.airyai }),
  row('AiryBi',       1,          [[[R], R, 'airybi']],          { fold: F.airybi }),
  row('AiryAiPrime',  1,          [[[R], R, 'airyaiprime']],     { fold: F.airyaiprime }),
  row('AiryBiPrime',  1,          [[[R], R, 'airybiprime']],     { fold: F.airybiprime }),
  // Of an integer order only: the kernels are NaN at another order.
  row('BesselJ',      2,          [[[I, R], R, 'besselj']],      { fold: F.besselj }),
  row('BesselY',      2,          [[[I, R], R, 'bessely']],      { fold: F.bessely, ...domain }),
  row('BesselI',      2,          [[[I, R], R, 'besseli']],      { fold: F.besseli }),
  row('BesselK',      2,          [[[I, R], R, 'besselk']],      { fold: F.besselk, ...domain }),
  row('SinIntegral',  1,          [[[R], R, 'sinint']],          { fold: F.sinint }),
  row('CosIntegral',  1,          [[[R], R, 'cosint']],          { fold: F.cosint, ...domain }),
  row('ExpIntegralEi', 1,         [[[R], R, 'expint']],          { fold: F.expint }),
  row('LogIntegral',  1,          [[[R], R, 'logint']],          { fold: F.logint }),
  row('AGM',          1,          [[[R], R, 'agm1']],            { fold: F.agm1, ...domain }),
  row('AGM',          2,          [[[R, R], R, 'agm']],          { fold: F.agm, ...domain }),
  row('EllipticK',    1,          rc('elliptick', 1),            { fold: F.elliptick, ...domain }),
  row('EllipticE',    1,          rc('elliptice', 1),            { fold: F.elliptice, ...domain }),
  row('EllipticE',    2,          [[[R, R], R, 'ellipticeinc']], { fold: F.ellipticeinc, ...domain }),
  row('EllipticF',    2,          [[[R, R], R, 'ellipticf']],    { fold: F.ellipticf, ...domain }),
  row('EllipticPi',   2,          [[[R, R], R, 'ellipticpi']],   { fold: F.ellipticpi, ...domain }),
  row('EllipticPi',   3,          [[[R, R, R], R, 'ellipticpiinc']], { fold: F.ellipticpiinc, ...domain }),
  row('Hypergeometric1F1', 3,     [[[R, R, R], R, 'hyp1f1']],    { fold: F.hyp1f1 }),
  row('Hypergeometric2F1', 4,     rc('hyp2f1', 4),               { fold: F.hyp2f1, ...domain }),
  row('HurwitzZeta',  2,          rc('hurwitzzeta', 2),          { fold: F.hurwitzzeta, ...domain }),
  row('LerchPhi',     3,          rc('lerchphi', 3),             { fold: F.lerchphi, ...domain }),
  row('PolyLog',      2,          rc('polylog', 2),              { fold: F.polylog, ...domain }),
  row('DirichletEta', 1,          [[[R], R, 'dirichleteta']],    { fold: F.dirichleteta }),
  row('DirichletBeta', 1,         [[[R], R, 'dirichletbeta']],   { fold: F.dirichletbeta }),
  row('StieltjesGamma', 1,        [[[I], R, 'stieltjes']],       { fold: F.stieltjes }),
  row('StieltjesGamma', 2,        [[[I, R], R, 'stieltjesa']],   { fold: F.stieltjesa, ...domain }),
  row('ClausenCl',    2,          [[[I, R], R, 'clausen']],      { fold: F.clausen }),
  // The orthogonal polynomials, of an integer degree and a real x.
  row('ChebyshevT',   2,          [[[I, R], R, 'chebyshevt']],   { fold: F.chebyshevt }),
  row('ChebyshevU',   2,          [[[I, R], R, 'chebyshevu']],   { fold: F.chebyshevu }),
  row('LegendreP',    2,          [[[I, R], R, 'legendrep']],    { fold: F.legendrep }),
  row('HermiteH',     2,          [[[I, R], R, 'hermiteh']],     { fold: F.hermiteh }),
  row('LaguerreL',    2,          [[[I, R], R, 'laguerrel']],    { fold: F.laguerrel }),
  row('LambertW',     1,          rc('lambertw', 1),             { fold: F.lambertw, ...domain }),
  row('LambertW',     2,          [[[R, I], R, 'lambertwk']],    { fold: F.lambertwk, ...domain }),
  row('Fibonacci',    1,          [[[I], I, 'fibonacci.int'], [[R], R, 'fibonacci']], { fold: F.fibonacci }),
  row('IsPrime',      1,          [[[R], B, 'isprime']],         { fold: F.isprime }),
  // The number-theory functions of an integer (`PrimePi` of a real), on the
  // double of the operand: an operand beyond the safe integer range throws,
  // as `IsPrime` does, so they are `may-fail` and are not moved out of a
  // loop that can run zero times.
  row('MoebiusMu',    1,          [[[R], I, 'moebiusmu']],       { fold: F.moebiusmu, effect: 'may-fail' }),
  row('PrimeNu',      1,          [[[R], I, 'primenu']],         { fold: F.primenu, effect: 'may-fail' }),
  row('PrimeOmega',   1,          [[[R], I, 'primeomega']],      { fold: F.primeomega, effect: 'may-fail' }),
  row('Totient',      1,          [[[R], I, 'totient']],         { fold: F.totient, effect: 'may-fail' }),
  row('PrimePi',      1,          [[[R], I, 'primepi']],         { fold: F.primepi, effect: 'may-fail' }),
  row('NthPrime',     1,          [[[R], I, 'nthprime']],        { fold: F.nthprime, effect: 'may-fail' }),
  // `Max` of a list is its largest element: a reduction, not threaded.
  row('Max',          'variadic', arith('max', 1),               { fold: Math.max, ...list }),
  row('Min',          'variadic', arith('min', 1),               { fold: Math.min, ...list }),
  // The element-wise `max` and `min`: they thread over lists.
  row('ElementMax',   'variadic', arith('emax', 1),              { fold: Math.max }),
  row('ElementMin',   'variadic', arith('emin', 1),              { fold: Math.min }),
  row('Less',         'chain',    [[[R], B, 'lt']],              { fold: (a: number, b: number) => a < b }),
  row('LessEqual',    'chain',    [[[R], B, 'le']],              { fold: (a: number, b: number) => a <= b }),
  row('Greater',      'chain',    [[[R], B, 'gt']],              { fold: (a: number, b: number) => a > b }),
  row('GreaterEqual', 'chain',    [[[R], B, 'ge']],              { fold: (a: number, b: number) => a >= b }),
  // `Equal` of a list and a scalar threads; of two lists it compares the
  // lists, which declines (`apply()` in `lower.ts`).
  row('Equal',        'chain',    [[[R], B, 'eq'], [[C], B, 'ceq'], [[S], B, 'text.eq']], { fold: (a: number, b: number) => a === b }),
  row('NotEqual',     2,          [[[R, R], B, 'ne'], [[C, C], B, 'cne'], [[S, S], B, 'text.ne']], { fold: (a: number, b: number) => a !== b }),
  row('And',          'variadic', [[[B], B, 'and']],             { fold: (a: boolean, b: boolean) => a && b }),
  row('Or',           'variadic', [[[B], B, 'or']],              { fold: (a: boolean, b: boolean) => a || b }),
  row('Not',          1,          [[[B], B, 'not']],             { fold: (a: boolean) => !a }),
  // The Iverson bracket, 1 or 0; it threads over a list of booleans, as
  // the interpreter's. `KroneckerDelta(a, b)` is `Boole(Equal(a, b))`
  // (`lower.ts`).
  row('Boole',        1,          [[[B], I, 'boole']],           { fold: (a: boolean) => (a ? 1 : 0) }),
  // The interpreter's `At`: from 1, from the end when negative, NaN for an
  // index that is 0, not an integer, or out of range.
  row('At',           2,          [[['list', R], 'element', 'at']], list),
  // The same read on JavaScript (`lower.ts`): of booleans, `undefined` out
  // of range, which no operation on a boolean fails on; of points of `n`
  // coordinates, a point of NaN.
  row('At',           2,          [[['list', R], 'element', 'atu']], list),
  row('At',           3,          [[['list', R, I], 'element', 'atp']], list),
  // Of a list of lists of numbers of stated lengths (CE-1540): the row, or
  // `undefined` out of range, where the `At` is the whole program
  // (`lower.ts`), so that no operation reads it.
  row('At',           2,          [[['list', R], 'element', 'atrow']], list),
  // Of a list of strings (CE-1556): the element, conditioned, or
  // `undefined` out of range, which only a discharge or the result reads
  // (`stringListRefusal()` of `index.ts`).
  row('At',           2,          [[['list', R], 'element', 'text.at']], { ...list, effect: 'may-fail' }),
  // An element from 0, at an index in range where the lowering puts it;
  // of a list of strings, conditioned (`text.elem`).
  row(undefined,      2,          [[['list', I], 'element', 'elem']], list),
  row(undefined,      2,          [[['list', I], 'element', 'text.elem']], list),
  // A record (`README.md`, "Records"): the field at a constant index from
  // 0, of the type of that field (the verifier reads it, not this
  // signature), and `Nothing`, the value of a field of the lane `nothing`.
  row(undefined,      2,          [[['record', I], 'record', 'field']], { threads: false }),
  row(undefined,      0,          [[[], 'nothing', 'nothing']], { threads: false }),
  // A list local written in place (`lower.ts`, `README.md`, "Lists"): the
  // array that the local owns, a copy of its value (`copy`); the index from
  // 0 of an index from 1 or from the end of a list of `n` elements, which
  // fails for an index that is 0, not an integer or out of range (`wix`);
  // a read at such an index (`get`), a write there, whose value is the
  // element written (`set`), and the read of `At` (`getat`). The copy, the
  // reads and the writes are effectful: they keep their place and order,
  // so no read moves across a write of its array.
  row(undefined,      1,          [[['list'], R, 'copy'], [['list'], I, 'copy.int'], [['list'], B, 'copy.bool']], { ...list, effect: 'effectful' }),
  row(undefined,      2,          [[[I, R], I, 'wix']],          { ...list, effect: 'may-fail' }),
  row(undefined,      2,          [[['list', I], 'element', 'get']], { ...list, effect: 'effectful' }),
  row(undefined,      3,          [[['list', I, R], 'element', 'set'], [['list', I, B], 'element', 'set.bool']], { ...list, effect: 'effectful' }),
  row(undefined,      2,          [[['list', R], 'element', 'getat'], [['list', R], 'element', 'getatu']], { ...list, effect: 'effectful' }),
  // A mutable array of machine cells (`lower-arrays.ts`, `README.md`,
  // "Arrays"): the read of a cell at an index from 1 or from the end, NaN
  // where it names no cell (`arr.get`); the store there, whose value is the
  // value given, which increments the version and makes no other test
  // (`arr.set`); of a tuple cell of four bytes, the byte `j` from 0 of a
  // cell (`arr.byte`), the store of one byte (`arr.setbyte`) and the
  // increment of the version of one store of a tuple (`arr.touch`), with
  // `.r` (also of `arr.get` and `arr.set`) the index on the real lane,
  // which the code tests for an integer;
  // the count of the cells (`arr.len`); the exchange of the cells of two
  // arrays (`arr.swap`, whose value is NaN, the `Nothing` that the code
  // does not read); the array that a value of a name holds (`arr.ref` of
  // the index `k` of `ArrayUse.refs`, pure: the reference never changes);
  // and the constructions of the engine (`arr.from.*` of the index `k` of
  // `ArrayUse.makers`). Every operation that reads or writes the storage or
  // the count, and every construction, is effectful (decision C6): it keeps
  // its place, its count and its order. The verifier reads the type of an
  // array result, not these signatures. On GLSL a tuple cell is read whole,
  // one texel of four channels (`arr.get4`, a list of four integers, or
  // four NaN where the index names no cell).
  row(undefined,      2,          [[['array', R], R, 'arr.get'], [['array', R], I, 'arr.get.int'], [['array', R], R, 'arr.get.r'], [['array', R], I, 'arr.get.int.r'], [['array', R], I, 'arr.get4']], { ...list, effect: 'effectful' }),
  row(undefined,      3,          [[['array', R, R], R, 'arr.set'], [['array', R, I], I, 'arr.set.int'], [['array', R, R], R, 'arr.set.r'], [['array', R, I], I, 'arr.set.int.r']], { ...list, effect: 'effectful' }),
  row(undefined,      3,          [[['array', R, I], I, 'arr.byte'], [['array', R, I], I, 'arr.byte.r']], { ...list, effect: 'effectful' }),
  row(undefined,      4,          [[['array', R, I, I], I, 'arr.setbyte'], [['array', R, I, I], I, 'arr.setbyte.r']], { ...list, effect: 'effectful' }),
  row(undefined,      1,          [[['array'], I, 'arr.touch'], [['array'], I, 'arr.len']], { ...list, effect: 'effectful' }),
  row(undefined,      2,          [[['array', 'array'], R, 'arr.swap']], { ...list, effect: 'effectful' }),
  row(undefined,      1,          [[[I], 'array', 'arr.ref']], list),
  row(undefined,      2,          [[['list', I], 'array', 'arr.from.list'], [['array', I], 'array', 'arr.from.copy']], { ...list, effect: 'effectful' }),
  row(undefined,      3,          [[[R, R, I], 'array', 'arr.from.fill'], [['record', R, I], 'array', 'arr.from.fillrec']], { ...list, effect: 'effectful' }),
  // A variable of the engine of `Program.assigns` around a call of a
  // function of the host (`hostCall()` of `lower.ts`): the write of the
  // value of the variable of the index `j` to the engine before the call
  // (`state.put`, whose value NaN is not read), and its read after it
  // (`state.get`), on its lane. Both keep their place and order.
  row(undefined,      2,          [[[I, R], R, 'state.put'], [[I, B], R, 'state.put.bool'], [[I, 'array'], R, 'state.put.arr']], { ...list, effect: 'effectful' }),
  row(undefined,      1,          [[[I], R, 'state.get'], [[I], I, 'state.get.int'], [[I], B, 'state.get.bool'], [[I], 'array', 'state.get.arr']], { ...list, effect: 'effectful' }),
  // The discharges (`absent()` of `lower.ts`): the test of an absent
  // number (NaN) and, on JavaScript, of an absent boolean (`undefined`);
  // `AssertPresent` of the test and the value, which fails where the test
  // is true.
  row(undefined,      1,          [[[R], B, 'isnan']],           { ...list, fold: Number.isNaN }),
  row(undefined,      1,          [[[B], B, 'isundef'], [[S], B, 'text.isundef']], list),
  row(undefined,      2,          [[[B, I], I, 'present.int'], [[B, R], R, 'present'], [[B, C], C, 'cpresent'], [[B, B], B, 'present.bool'], [[B, S], S, 'text.present']], { ...list, effect: 'may-fail' }),
  // A real count of a rotation as an integer, which fails where it is not
  // one (the interpreter gives `incompatible-type`); JavaScript only.
  row(undefined,      1,          [[[R], I, 'count.int']],       { ...list, effect: 'may-fail' }),
  // The length of a list that the pass `forward` does not build, which
  // fails where a build of that length would (2^32 or more, NaN); the
  // passes put it on JavaScript only (`passes.ts`, `guardFor()`).
  row(undefined,      1,          [[[I], I, 'listlen']],         { ...list, effect: 'may-fail' }),
  // A real count or index of `Take`, `Drop`, `Slice` and `Tabulate`
  // rounded as the interpreter's `toInteger()` (`Math.round`); JavaScript
  // only.
  row(undefined,      1,          [[[R], I, 'count.round']],     { ...list, fold: Math.round }),
  // The count of `Linspace` (its floor, at least 0, 50 when it is not
  // finite) and its element `k` from 0 of `d + 1` (the interpreter's
  // `linspaceSample()`); JavaScript only.
  row(undefined,      1,          [[[R], I, 'linspace.count']],  { ...list, fold: (c: number) => (Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 50) }),
  row(undefined,      4,          [[[R, R, I, I], R, 'linspace']], list),
  // A draw of the active `WithRandomSeed` frame, or a live draw outside one.
  row('Random',       0,          [[[], R, 'draw']],             { ...list, effect: 'effectful' }),
  // A shuffled copy of a list of numbers (`lower.ts` declines another
  // list), drawn as the interpreter draws (`_SYS.shuffle`).
  row('RandomShuffle', 1,         [[['list'], R, 'shuffle']],    { ...list, effect: 'effectful' }),
  // A sorted copy of a list of numbers, NaN last (`Sort`), the indices from
  // 1 that sort it, stable (`Ordering`), and the median of a list of
  // numbers, NaN when an element is (`Median`): the interpreter's
  // `median()` of `numerics/statistics.ts`.
  row(undefined,      1,          [[['list'], I, 'sort.int']],   list),
  row(undefined,      1,          [[['list'], R, 'sort']],       list),
  row(undefined,      1,          [[['list'], I, 'ordering']],   list),
  // Of text (CE-1574): the order of two strings by UTF-16 code units, -1,
  // 0 or 1 (`Less` of strings; `text.compare` orders two characters), and
  // the indices from 0 that sort a list of strings, or of characters by
  // code points, each element conditioned, stable (`Sort`).
  row(undefined,      2,          [[[S, S], I, 'text.cmpu']],    list),
  row(undefined,      1,          [[['list'], I, 'text.ordering']], list),
  row(undefined,      1,          [[['list'], I, 'text.ordering.cp']], list),
  row(undefined,      1,          [[['list'], 'real-element', 'median']], list),
  // The other statistics of one list of real numbers and of two, the
  // interpreter's kernels of `numerics/statistics.ts` (`README.md`,
  // "Lists"): the mode, the lower and the upper quartile (`Quartiles`,
  // `InterquartileRange`), the skewness, the kurtosis, the sample and the
  // population covariance, and the correlation; JavaScript only.
  row(undefined,      1,          [[['list'], 'real-element', 'mode']], list),
  row(undefined,      1,          [[['list'], 'real-element', 'quartile1']], list),
  row(undefined,      1,          [[['list'], 'real-element', 'quartile3']], list),
  row(undefined,      1,          [[['list'], 'real-element', 'skewness']], list),
  row(undefined,      1,          [[['list'], 'real-element', 'kurtosis']], list),
  row(undefined,      2,          [[['list', 'list'], 'real-element', 'covariance']], list),
  row(undefined,      2,          [[['list', 'list'], 'real-element', 'pcovariance']], list),
  row(undefined,      2,          [[['list', 'list'], 'real-element', 'correlation']], list),
  // `Chunk(L, k)` and `Partition(L, n)` whose rows can have different
  // lengths, and the two groups of `Partition(L, p)`: the lane `rows`, a
  // value that is the result of the program only (`README.md`, "The rows
  // lane"); JavaScript only. The helpers check the count, which fails where
  // the interpreter leaves the form unevaluated (`may-fail`), as the count
  // checks of the rows read one by one (`rows.chunks`, `rows.size`) do.
  row(undefined,      2,          [[['list', I], 'rows', 'rows.chunk']], { ...list, effect: 'may-fail' }),
  row(undefined,      2,          [[['list', I], 'rows', 'rows.partition']], { ...list, effect: 'may-fail' }),
  row(undefined,      2,          [[['list', 'list'], 'rows', 'rows.pair']], list),
  row(undefined,      1,          [[[I], I, 'rows.chunks']],     { ...list, effect: 'may-fail' }),
  row(undefined,      1,          [[[I], I, 'rows.size']],       { ...list, effect: 'may-fail' }),
  // The element `At(At(g, i), j)` of an input or a parameter `g` of the
  // lane `rows` (a list of lists of two lengths not stated, of reals or of
  // integers), NaN where `i` or `j` is out of range; JavaScript only.
  row(undefined,      3,          [[['rows', R, R], R, 'rows.at'], [['rows', R, R], I, 'rows.at.int']], list),
  // The same value read row by row (`chunks()` of `lower-lists.ts`): the
  // count of its rows, the length of the row `i`, and the element `j` of
  // that row, each index from 0 and in range.
  row(undefined,      1,          [[['rows'], I, 'rows.count']], list),
  row(undefined,      2,          [[['rows', I], I, 'rows.len']], list),
  // The length of the rows of a value of a matrix type (`matrix<real>`),
  // whose rows have one length: that of its first row, 0 of no row.
  row(undefined,      1,          [[['rows'], I, 'rows.width']], list),
  // A matrix of run-time size, a list of rank 2 of reals or integers whose
  // two lengths are values (an input of a matrix type, `input()` of
  // `lower.ts`), read as its rows: the same array of arrays, so that the
  // readers of the lane `rows` read it (README, "Matrices").
  row(undefined,      1,          [[['list'], 'rows', 'rows.of']], list),
  // Two lengths that an operation reads, which the lowering does not prove
  // equal (`lower-lists.ts`, `agree()`): of two flat lists of an
  // element-wise operation, of a call mapped over lists or of `Dot`, the
  // inner lengths of `MatrixMultiply` and the two lengths of the matrix of
  // `Trace`. 0 where they are equal, a `RangeError` where they differ, the
  // interpreter's `incompatible-dimensions` or `expected-square-matrix`
  // (`Trace`). The value 0 is the initial value of each sum of the
  // operation, or is added to the length of its build, so that the check
  // is kept and runs once before them.
  row(undefined,      2,          [[[I, I], I, 'rows.agree']], { ...list, effect: 'may-fail' }),
  row(undefined,      2,          [[[I, I], I, 'rows.square']], { ...list, effect: 'may-fail' }),
  // The order of a square matrix of the lane `rows` whose two lengths the
  // lowering does not prove equal (`order()`): the number of rows where
  // they are equal, a `RangeError` where they differ, the interpreter's
  // `expected-square-matrix`. The kernels below read it, so that the check
  // runs before them.
  row(undefined,      2,          [[[I, I], I, 'rows.order']], { ...list, effect: 'may-fail' }),
  // The inverse and the power by an integer of a square matrix of the lane
  // `rows` of the order read last (`matrix-runtime.ts`): rows of reals of
  // that order.
  row(undefined,      2,          [[['rows', I], 'rows', 'rows.inverse']], list),
  row(undefined,      3,          [[['rows', I, I], 'rows', 'rows.power']], list),
  row(undefined,      3,          [[['rows', I, I], R, 'rows.get'], [['rows', I, I], I, 'rows.get.int']], list),
  // The row `At(g, i)` at an index known at run time: the index of the
  // row from 0 (from the end when `i` is negative), -1 where `i` is out of
  // range; the length of the row at that index, 0 at -1 (the count of the
  // elements read), and NaN at -1 (the value of `Length`, the absent value
  // of the interpreter's `Missing`).
  row(undefined,      2,          [[['rows', R], I, 'rows.row']], list),
  row(undefined,      2,          [[['rows', I], I, 'rows.rowlen']], list),
  row(undefined,      2,          [[['rows', I], I, 'rows.rowlen.nan']], list),
  // The rows of two values of the lane `rows`, in order (`Join`,
  // `ListJoin`, `Append`; CE-1736).
  row(undefined,      2,          [[['rows', 'rows'], 'rows', 'rows.join']], list),
  // The matrix kernels of the runtime (`matrix-runtime.ts`), of a matrix
  // whose shape the lowering settles (`lower-matrices.ts`): the determinant
  // of the entries of an `n × n` matrix row by row and `n`; the inverse;
  // the power by an integer; the reduced row echelon form at a tolerance.
  row(undefined,      2,          [[['list', I], 'real-element', 'mdet']], list),
  row(undefined,      1,          [[['list'], R, 'minverse']],   list),
  row(undefined,      2,          [[['list', I], R, 'mpower']],  list),
  row(undefined,      2,          [[['list', R], R, 'mrowreduce']], list),
  // The number of elements of `Range(a, b, step)`: the engine's `rangeCount`
  // (of reals: `Range(1, 3.5)` is `[1, 2, 3]`); 0 for a count that is NaN
  // (a bound with no value), as the JavaScript spelling.
  row(undefined,      3,          [[[R, R, R], I, 'rangecount']], { ...list, fold: (a, b, s) => rangeCount(a, b, s) || 0 }),
  // The step of `Range(a, b)`: 1, or -1 when `b < a`.
  row(undefined,      2,          [[[R, R], I, 'rangestep']],    { ...list, fold: (a: number, b: number) => (b >= a ? 1 : -1) }),
  // Colours (README, "The colour lane"): a constructor of its channels, and
  // a conversion to the space it names; each threads over a list operand.
  row('Rgb',          3,          [[[R, R, R], K, 'rgb']],       {}),
  row('Hsl',          3,          [[[R, R, R], K, 'hsl']],       {}),
  row('Hsv',          3,          [[[R, R, R], K, 'hsv']],       {}),
  row('Oklab',        3,          [[[R, R, R], K, 'oklab']],     {}),
  row('Oklch',        3,          [[[R, R, R], K, 'oklch']],     {}),
  row('AsRgb',        1,          [[[K], K, 'asrgb']],           {}),
  row('AsHsl',        1,          [[[K], K, 'ashsl']],           {}),
  row('AsHsv',        1,          [[[K], K, 'ashsv']],           {}),
  row('AsOklab',      1,          [[[K], K, 'asoklab']],         {}),
  row('AsOklch',      1,          [[[K], K, 'asoklch']],         {}),
  // `ColorMix(a, b)` is lowered with the ratio 0.5. No GLSL spelling.
  row('ColorMix',     3,          [[[K, K, R], K, 'colormix']],  {}),
  // CE-1535 (README, "The colour lane"). `ContrastingColor(bg)` is white or
  // black. The lowering makes the other rows of a string operand:
  // `GamutMap(c, "display-p3")` is `gamutmap.p3` (after `gamutmap`, the row
  // of the head); `Colormap(name, t)` reads the palette by its index in
  // `COLORMAP_NAMES`; `ColorToColorspace(c, space)` is the tuple of the
  // three channels `colorchannel.<space>` (the channel index an integer).
  row('ColorContrast',    2,      [[[K, K], R, 'colorcontrast']], {}),
  row('ColorDelta',       2,      [[[K, K], R, 'colordelta']],   {}),
  row('ContrastingColor', 3,      [[[K, K, K], K, 'contrastingcolor']], {}),
  row('ContrastingColor', 1,      [[[K], K, 'contrastingcolor.bw']], {}),
  row('GamutMap',         1,      [[[K], K, 'gamutmap']],        {}),
  row('GamutMap',         1,      [[[K], K, 'gamutmap.p3']],     {}),
  row('Colormap',         2,      [[[I, R], K, 'colormap']],     {}),
  // `AsHsv(Hsv(h, s, v))` and `AsHsl(Hsl(h, s, l))`: the constructor's own
  // channels, as the interpreter answers them (no round trip through OKLCh,
  // which loses the hue and the saturation at black and at grey).
  row('AsHsv',            3,      [[[R, R, R], K, 'ashsv.own']], {}),
  row('AsHsl',            3,      [[[R, R, R], K, 'ashsl.own']], {}),
  ...['rgb', 'hsl', 'hsv', 'oklab', 'oklch'].map((s) =>
    row('ColorToColorspace', 2,   [[[K, I], R, `colorchannel.${s}`]], {})),
  // Strings (README, "The string lane"; JavaScript only): the read of a
  // string input, which throws on another value, and the text operators.
  // A row that throws where the interpreter gives an error value (a count
  // out of range, an empty pad or target) may fail.
  row(undefined,      1,          [[[S], S, 'text.in']],         { ...list, effect: 'may-fail' }),
  row(undefined,      1,          [[[S], I, 'text.length']],     list),
  row('ToUpperCase',  1,          [[[S], S, 'text.upper']],      list),
  row('ToLowerCase',  1,          [[[S], S, 'text.lower']],      list),
  row('CaseFold',     1,          [[[S], S, 'text.fold']],       list),
  row('Trim',         1,          [[[S], S, 'text.trim']],       list),
  row('Trim',         2,          [[[S, S], S, 'text.trim.set']], list),
  row('TrimStart',    1,          [[[S], S, 'text.trimstart']],  list),
  row('TrimStart',    2,          [[[S, S], S, 'text.trimstart.set']], list),
  row('TrimEnd',      1,          [[[S], S, 'text.trimend']],    list),
  row('TrimEnd',      2,          [[[S, S], S, 'text.trimend.set']], list),
  row('StringRepeat', 2,          [[[S, I], S, 'text.repeat']],  { ...list, effect: 'may-fail' }),
  row('PadStart',     2,          [[[S, I], S, 'text.padstart']], { ...list, effect: 'may-fail' }),
  row('PadStart',     3,          [[[S, I, S], S, 'text.padstart.with']], { ...list, effect: 'may-fail' }),
  row('PadEnd',       2,          [[[S, I], S, 'text.padend']],  { ...list, effect: 'may-fail' }),
  row('PadEnd',       3,          [[[S, I, S], S, 'text.padend.with']], { ...list, effect: 'may-fail' }),
  row('StringReplace', 3,         [[[S, S, S], S, 'text.replace']], { ...list, effect: 'may-fail' }),
  row('StringReplace', 4,         [[[S, S, S, I], S, 'text.replace.count']], { ...list, effect: 'may-fail' }),
  // Of a literal pattern (`lower.ts`): the flags and the source in one string.
  row(undefined,      3,          [[[S, S, S], S, 'text.rerep']], { ...list, effect: 'may-fail' }),
  row(undefined,      4,          [[[S, S, S, I], S, 'text.rerep.count']], { ...list, effect: 'may-fail' }),
  row('StartsWith',   2,          [[[S, S], B, 'text.startswith']], list),
  row('EndsWith',     2,          [[[S, S], B, 'text.endswith']], list),
  row('StringCompare', 2,         [[[S, S], I, 'text.compare']], list),
  // `String` of strings: their texts joined (of two or more: a left fold;
  // `rowOfHead()` takes this row for a count with no row of its own).
  row('String',       'variadic', [[[S], S, 'text.concat']],     list),
  row('String',       0,          [[[], S, 'text.empty']],       list),
  row('String',       1,          [[[S], S, 'text.string']],     list),
  // `StringJoin` of a string: its characters, joined; of a list of strings
  // (CE-1548): its elements, each conditioned, joined. The element of a
  // list of strings is a string.
  row('StringJoin',   1,          [[[S], S, 'text.string'], [['list'], 'element', 'text.joinl']], list),
  row('StringJoin',   2,          [[[S, S], S, 'text.join'], [['list', S], 'element', 'text.joinl.sep']], list),
  // `ColorToString(c, f)` of the three channels of a colour of `space`, read
  // from the operation that makes it (`lower.ts`), for each format: the
  // interpreter's string, which throws where its value is an error.
  ...COLOR_CHANNEL_SPACES.flatMap((space) =>
    COLOR_STRING_FORMATS.map((f) =>
      row(undefined,  3,          [[[R, R, R], S, `colortostring.${space}.${f}`]], { ...list, effect: 'may-fail' }))),
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
 *   are the results, and a length that a yield names and that is a yield
 *   is the result of that yield (the length of a list made in the frame).
 * - `choice`: `RandomChoice(Interval(0, 1), n)`, the `n` draws of the
 *   interpreter (its body is empty); the results are the count and the
 *   list.
 *
 */
export type RegionRow = {
  readonly op: string;
  readonly effect: Effect;
  readonly args: readonly Lane[];
  readonly params: readonly Lane[];
  readonly results: (
    args: readonly V[],
    yields: readonly IRType[],
    outs: readonly V[],
    yieldValues?: readonly V[]
  ) => IRType[] | undefined;
};

/** The results of a region whose one yield is a real scalar. */
const real: RegionRow['results'] = (_, ys) =>
  ys.length === 1 && ys[0].shape.length === 0 && widensTo(ys[0].lane, R)
    ? [{ lane: R, shape: [] }]
    : undefined;

const listOf = (element: IRType, n: Length): IRType => ({
  lane: element.lane,
  shape: [n, ...element.shape],
});

/** `t` is a flat list of reals or integers: a row of a value of the lane
 *  `rows`. */
const rowElement = (t: IRType): boolean =>
  t.shape.length === 1 && (t.lane === R || t.lane === I);

export const REGION_ROWS: readonly RegionRow[] = deepFreeze([
  {
    op: 'build',
    effect: 'may-fail',
    args: [I],
    params: [I],
    results: ([n], ys) =>
      ys.length === 1 ? [listOf(ys[0], { v: n })] : undefined,
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
  },
  {
    op: 'seeded',
    effect: 'may-fail',
    args: [R],
    params: [],
    results: (_, ys, outs, vs = []) =>
      ys.map((t) =>
        mapLengths(t, (v) => (vs.includes(v) ? outs[vs.indexOf(v)] : v))
      ),
  },
  {
    op: 'choice',
    effect: 'effectful',
    args: [R],
    params: [],
    results: (_, ys, [count]) =>
      ys.length === 0
        ? [
            { lane: I, shape: [] },
            { lane: R, shape: [{ v: count }] },
          ]
        : undefined,
  },
  // `RandomSample(L, k)` of a list of `n` elements: the indices from 0 of
  // the `k` elements drawn as the interpreter draws them (its body is
  // empty); the results are the count and the list.
  {
    op: 'sample',
    effect: 'effectful',
    args: [I, R],
    params: [],
    results: (_, ys, [count]) =>
      ys.length === 0
        ? [
            { lane: I, shape: [] },
            { lane: I, shape: [{ v: count }] },
          ]
        : undefined,
  },
  // `Characters(s)` (CE-1548): the grapheme clusters of `s`, each
  // conditioned (its body is empty); the results are the count and the
  // list.
  {
    op: 'text.chars',
    effect: 'pure',
    args: [S],
    params: [],
    results: (_, ys, [count]) =>
      ys.length === 0
        ? [
            { lane: I, shape: [] },
            { lane: S, shape: [{ v: count }] },
          ]
        : undefined,
  },
  // A list of lists of run-time length (CE-1736): the build (`rows.build`)
  // and the filter (`rows.filter`) whose element is a flat list of reals or
  // integers of any length, a value of the lane `rows` (`README.md`, "The
  // rows lane"). The lane of the elements is the lowering's
  // (`rowsElements`). JavaScript only.
  {
    op: 'rows.build',
    effect: 'may-fail',
    args: [I],
    params: [I],
    results: (_, ys) =>
      ys.length === 1 && rowElement(ys[0])
        ? [{ lane: 'rows', shape: [] }]
        : undefined,
  },
  {
    op: 'rows.filter',
    effect: 'may-fail',
    args: [I],
    params: [I],
    results: (_, ys) =>
      ys.length === 2 &&
      ys[0].lane === B &&
      ys[0].shape.length === 0 &&
      rowElement(ys[1])
        ? [{ lane: 'rows', shape: [] }]
        : undefined,
  },
  // `Flatten(g)` of a value `g` of the lane `rows`, of
  // reals (`rows.flat`) or of integers (`rows.flat.int`): the elements of
  // its rows, in order (its body is empty); the results are the count and
  // the list. JavaScript only.
  ...(['rows.flat', 'rows.flat.int'] as const).map((op): RegionRow => ({
    op,
    effect: 'pure',
    args: ['rows'],
    params: [],
    results: (_, ys, [count]) =>
      ys.length === 0
        ? [
            { lane: I, shape: [] },
            { lane: op === 'rows.flat' ? R : I, shape: [{ v: count }] },
          ]
        : undefined,
  })),
  // The engine's machine quadrature from `a` to `b` of the region's yield
  // at its parameter.
  {
    op: 'integrate',
    effect: 'may-fail',
    args: [R, R],
    params: [R],
    results: real,
  },
  // The indices from 0 to `n - 1` sorted by the comparison that the region
  // yields (-1, 0 or 1) for the indices of its two parameters: the
  // interpreter's `Array.prototype.sort` of `Sort(L, (a, b) ↦ …)`.
  {
    op: 'sortby',
    effect: 'may-fail',
    args: [I],
    params: [I, I],
    results: ([n], ys) =>
      ys.length === 1 && ys[0].lane === I && ys[0].shape.length === 0
        ? [listOf(ys[0], { v: n })]
        : undefined,
  },
  // The first `n` elements of `Iterate(f, x0)`: the region runs `n` passes
  // of its index from 0, its second parameter the accumulator, `x0` (the
  // second operand) at the first pass and the yield of the pass before it
  // after; each yield is an element.
  {
    op: 'iterate',
    effect: 'may-fail',
    args: [I, R],
    params: [I, R],
    results: ([n], ys) =>
      ys.length === 1 && ys[0].shape.length === 0 && widensTo(ys[0].lane, R)
        ? [listOf(ys[0], { v: n })]
        : undefined,
  },
  // The numeric derivative at `x` of the region's yield at its parameter:
  // the stencil of the runtime (`_SYS.nd`).
  {
    op: 'derivative',
    effect: 'may-fail',
    args: [R],
    params: [R],
    results: real,
  },
  // A new array of `n` elements, each the region's one yield, a real or an
  // integer (`-0`): the private list of a list accumulator in a worker
  // program (`outline.ts`). A region row, not an operation: its result has
  // the length of its operand. Effectful: each is its own array, which the
  // program writes.
  {
    op: 'zeros',
    effect: 'effectful',
    args: [I],
    params: [],
    results: ([n], ys) =>
      ys.length === 1 &&
      ys[0].shape.length === 0 &&
      (ys[0].lane === R || ys[0].lane === I)
        ? [listOf(ys[0], { v: n })]
        : undefined,
  },
]);

/** The effectful operations of a list local written in place: they change
 *  an array that the function owns, and draw nothing (`seededWarnings()` of
 *  `index.ts`). */
export const LIST_LOCAL_OPS: readonly string[] = Object.freeze([
  'copy',
  'get',
  'set',
  'getat',
  'getatu',
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

/** The radians of an angle of 1 in each angular unit, and the angle of 1
 *  radian in that unit. */
export const ANGLE_FACTORS: Readonly<
  Record<string, readonly [number, number]>
> = deepFreeze({
  deg: [Math.PI / 180, 180 / Math.PI],
  grad: [Math.PI / 200, 200 / Math.PI],
  turn: [2 * Math.PI, 1 / (2 * Math.PI)],
});

/** Whether the engine has the setting `s` at the value the rows assume. */
export const SETTINGS: Record<
  Setting,
  (ce: { roundingTies: string }) => boolean
> = Object.freeze({
  roundingTies: (ce: { roundingTies: string }) =>
    ce.roundingTies === 'away-from-zero',
});

/** The row of `head`: with `n`, its row of `n` operands when it has one
 *  (`AGM(x)` and `AGM(a, b)`), else its first row. */
export function rowOfHead(
  rows: readonly OperatorRow[],
  head: string,
  n?: number
): OperatorRow | undefined {
  return (
    (n === undefined
      ? undefined
      : rows.find((r) => r.head === head && r.arity === n)) ??
    rows.find((r) => r.head === head)
  );
}

/** The row and the signature of each IR operation, by table: the first
 *  row and signature that names it. */
const BY_OP = new WeakMap<
  readonly OperatorRow[],
  Map<string, { row: OperatorRow; signature: Signature }>
>();

/** The row and the signature of the IR operation `op`. */
export function rowOfOp(
  rows: readonly OperatorRow[],
  op: string
): { row: OperatorRow; signature: Signature } | undefined {
  let index = BY_OP.get(rows);
  if (index === undefined) {
    index = new Map();
    for (const row of rows)
      for (const signature of row.signatures)
        if (!index.has(signature[2]))
          index.set(signature[2], { row, signature });
    BY_OP.set(rows, index);
  }
  return index.get(op);
}

export function regionRow(op: string): RegionRow | undefined {
  return REGION_ROWS.find((r) => r.op === op);
}

/** The first signature of `row` that accepts operands of `types` (a
 *  scalar of a lane that widens to the operand's, or a list of such
 *  elements; a list where a scalar is read when the row threads), or
 *  `undefined`. With `complex`, only a signature of complex operands. With
 *  `bigint` (`mode: 'bigint'`), only a signature whose result is not real
 *  or complex: its operands are integers, which a `real` operand reads. */
export function signatureOf(
  row: OperatorRow,
  types: readonly IRType[],
  complex = false,
  bigint = false
): Signature | undefined {
  return row.signatures.find(
    ([args, result]) =>
      (!complex || args.includes('complex')) &&
      (!bigint || (result !== 'real' && result !== 'complex')) &&
      types.every((t, i) => operandFits(row, args, i, t))
  );
}

/** Whether a value of type `t` is the operand `k` of `args`, operands of a
 *  signature of `row`: by `fits` of its lane (the verifier: `isSubLane`). */
export function operandFits(
  row: OperatorRow,
  args: readonly Operand[],
  k: number,
  t: IRType,
  fits: (a: Lane, b: Lane) => boolean = widensTo
): boolean {
  const a = args.length === 1 ? args[0] : args[k];
  if (a === 'list') return t.shape.length > 0;
  return fits(t.lane, a) && (t.shape.length === 0 || row.threads);
}

/** The type of the result of `signature` on operands of `types`, or
 *  `undefined` (lists of two shapes). */
export function resultType(
  signature: Signature,
  types: readonly IRType[],
  sameShape: (a: readonly Length[], b: readonly Length[]) => boolean
): IRType | undefined {
  const [args, result] = signature;
  // A list of rows of different lengths has no shape: its operands are
  // not compared (the two groups of `Partition(L, p)`).
  if (result === 'rows') return { lane: result, shape: [] };
  if (result === 'element') return elementType(types[args.indexOf('list')]);
  if (result === 'real-element')
    return { ...elementType(types[args.indexOf('list')]), lane: R };
  const lists = types.filter((t) => t.shape.length > 0);
  const shape = lists[0]?.shape ?? [];
  // The outer axis: a run-time length fits any length, and the result has
  // the shape of the first list (two lengths are an error of the
  // interpreter that the static type does not show; on JavaScript, flat
  // lists of lengths not proved equal are a build whose length compares
  // them instead, `apply()` of `lower.ts`). The inner axes (a list of
  // points) are the same.
  const fits = ([n, ...rest]: readonly Length[]) =>
    shape.length === rest.length + 1 &&
    sameShape(rest, shape.slice(1)) &&
    (typeof n !== 'number' || typeof shape[0] !== 'number' || n === shape[0]);
  if (!lists.every((t) => sameShape(t.shape, shape) || fits(t.shape)))
    return undefined;
  return { lane: result, shape };
}
