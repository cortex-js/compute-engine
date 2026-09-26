import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';

import type { MathJsonExpression } from '../../math-json/types.js';
import type { LatexString } from '../latex-syntax/types.js';

import { apply } from './apply.js';

import { bignumPreferred, canonicalAngle } from './utils.js';

import type {
  AngularUnit,
  Expression,
  IComputeEngine as ComputeEngine,
  Sign,
} from '../global-types.js';
import { asLatexString } from '../latex-syntax/utils.js';
import { parse as parseLatex } from '../latex-syntax/latex-syntax.js';
import { isNumber, isSymbol, isFunction } from './type-guards.js';
import {
  chop,
  isMachineTrigPole,
  ROUNDOFF_TOLERANCE,
} from '../numerics/numeric.js';
import { gcd as bigGcd } from '../numerics/numeric-bigint.js';
import { asRational } from './numerics.js';

type ConstructibleTrigValues = [
  [numerator: number, denominator: number],
  { [operator: string]: Expression },
][];

// For each trig function, by quadrant (0..π/2, π/2..π, π..3π/2, 3π/2..2π),
// what is the corresponding identity (sign and function)
// E.g 'Sin[θ+π/2] = Cos[θ]` -> Quadrant 2, Positive sign, Cos
const TRIG_IDENTITIES: { [key: string]: [sign: number, name: string][] } = {
  Sin: [
    [+1, 'Sin'],
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
  ],
  Cos: [
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
    [+1, 'Sin'],
  ],
  Sec: [
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
    [+1, 'Csc'],
  ],
  Csc: [
    [+1, 'Csc'],
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
  ],
  Tan: [
    [+1, 'Tan'],
    [-1, 'Cot'],
    [+1, 'Tan'],
    [-1, 'Cot'],
  ],
  Cot: [
    [+1, 'Cot'],
    [-1, 'Tan'],
    [+1, 'Cot'],
    [-1, 'Tan'],
  ],
};

const S2: MathJsonExpression = ['Sqrt', 2];
const S3: MathJsonExpression = ['Sqrt', 3];
const S5: MathJsonExpression = ['Sqrt', 5];
const S6: MathJsonExpression = ['Sqrt', 6];
// From https://en.wikipedia.org/wiki/Trigonometric_functions
// and https://en.wikipedia.org/wiki/Exact_trigonometric_values

// The key is the argument in radian, as (num * π / den)
const CONSTRUCTIBLE_VALUES: [
  key: [numerator: number, denominator: number],
  values: { [name: string]: MathJsonExpression | LatexString },
][] = [
  [
    [0, 1],
    {
      Sin: 0,
      Cos: 1,
      Tan: 0,
      Cot: 'ComplexInfinity',
      Sec: 1,
      Csc: 'ComplexInfinity',
    },
  ],
  [
    [1, 12],
    {
      Sin: ['Divide', ['Subtract', S6, S2], 4],
      Cos: ['Divide', ['Add', S6, S2], 4],
      Tan: ['Subtract', 2, S3],
      Cot: ['Add', 2, S3],
      Sec: ['Subtract', S6, S2],
      Csc: ['Add', S6, S2],
    },
  ],
  [
    [1, 10],
    {
      Sin: ['Divide', ['Subtract', S5, 1], 4],
      Cos: ['Divide', ['Sqrt', ['Add', 10, ['Multiply', 2, S5]]], 4],
      Tan: ['Divide', ['Sqrt', ['Subtract', 25, ['Multiply', 10, S5]]], 5],
      Cot: ['Sqrt', ['Add', 5, ['Multiply', 2, S5]]],
      Sec: ['Divide', ['Sqrt', ['Subtract', 50, ['Multiply', 10, S5]]], 5],
      Csc: ['Add', 1, S5],
    },
  ],
  [
    [1, 8],
    {
      Sin: '$\\frac{\\sqrt{2-\\sqrt2}}{2}$',
      Cos: '$\\frac{\\sqrt {2+{\\sqrt {2}}}}{2}$',
      Tan: '$\\sqrt{2} - 1$',
      Cot: '$\\sqrt{2} + 1$',
      Sec: '$\\sqrt{ 4 - 2\\sqrt{2}}$',
      Csc: '$\\sqrt{ 4 + 2\\sqrt{2}}$',
    },
  ],
  [
    [1, 6],
    {
      Sin: '$\\frac{1}{2}$',
      Cos: '$\\frac{\\sqrt{3}}{2}$',
      Tan: '$\\frac{\\sqrt{3}}{3}$',
      Cot: '$\\sqrt{3}$',
      Sec: '$\\frac{2\\sqrt{3}}{3}$',
      Csc: 2,
    },
  ],
  [
    [1, 5],
    {
      Sin: '$\\frac{\\sqrt{10- 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{1+ \\sqrt{5}} {4}$',
      Tan: '$\\sqrt{5-2\\sqrt5}$',
      Cot: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Sec: '$\\sqrt{5} - 1$',
      Csc: '$\\frac{\\sqrt{50+10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [1, 4],
    {
      Sin: ['Divide', S2, 2],
      Cos: ['Divide', S2, 2],
      Tan: 1,
      Cot: 1,
      Sec: S2,
      Csc: S2,
    },
  ],

  [
    [3, 10],
    {
      Sin: '$\\frac{1+ \\sqrt5} {4}$',
      Cos: '$\\frac{\\sqrt{10- 2\\sqrt5}} {4}$',
      Tan: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Cot: '$\\sqrt{5-2\\sqrt5}$',
      Sec: '$\\frac{\\sqrt{50+10\\sqrt5}} {5}$',
      Csc: '$\\sqrt5-1$',
    },
  ],
  [
    [1, 3],
    {
      Sin: ['Divide', S3, 2], // '$\\frac{\\sqrt{3}}{2}$'
      Cos: 'Half', // '$\\frac{1}{2}$'
      Tan: S3, // '$\\sqrt{3}$'
      Cot: ['Divide', S3, 3], // '$\\frac{\\sqrt{3}}{3}$'
      Sec: 2,
      Csc: ['Divide', ['Multiply', 2, S3], 3], // '$\\frac{2\\sqrt{3}}{3}$'
    },
  ],
  [
    [3, 8],
    {
      Sin: '$\\frac{ \\sqrt{2 + \\sqrt{2}} } {2}$',
      Cos: '$\\frac{ \\sqrt{2 - \\sqrt{2}} } {2}$',
      Tan: '$\\sqrt{2} + 1$',
      Cot: '$\\sqrt{2} - 1$',
      Sec: '$\\sqrt{ 4 + 2 \\sqrt{2} }$',
      Csc: '$\\sqrt{ 4 - 2 \\sqrt{2} }$',
    },
  ],
  [
    [2, 5],
    {
      Sin: '$\\frac{\\sqrt{10+ 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{\\sqrt{5}-1} {4}$',
      Tan: '$\\sqrt{5+2\\sqrt{5}}$',
      Cot: '$\\frac{\\sqrt{25-10\\sqrt{5}}} {5}$',
      Sec: '$1 + \\sqrt{5}$',
      Csc: '$\\frac{\\sqrt{50-10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [5, 12],
    {
      Sin: '$\\frac{\\sqrt{6} + \\sqrt{2}} {4}$',
      Cos: '$\\frac{ \\sqrt{6} - \\sqrt{2}} {4}$',
      Tan: '$2+\\sqrt{3}$',
      Cot: '$2-\\sqrt{3}$',
      Sec: '$\\sqrt{6}+\\sqrt{2}$',
      Csc: '$\\sqrt{6} - \\sqrt{2}$',
    },
  ],
  [
    [1, 2],
    {
      Sin: 1,
      Cos: 0,
      Tan: 'ComplexInfinity',
      Cot: 0,
      Sec: 'ComplexInfinity',
      Csc: 1,
    },
  ],
];

/** An exact rational `[numerator, denominator]`, with a positive denominator. */
type BigRational = [bigint, bigint];

/**
 * Read an exact angle as `c·π + t`, with `c` and `t` exact rationals.
 *
 * The angle is read from its structure: exact rational number literals, the
 * constant `Pi`, and `Negate`, `Add`, `Multiply`, `Divide` and `Power` (with a
 * non-negative integer exponent) of those. Any other part (a symbol, a float,
 * a radical, `π²`) gives `undefined`.
 */
function exactAngleParts(
  x: Expression,
  depth = 0
): [c: BigRational, t: BigRational] | undefined {
  // The depth limit stops a cycle of assignments (a symbol is read through
  // to its value, below) and bounds the walk of a deep expression, which
  // then stays on the usual route.
  if (depth > 16) return undefined;
  if (isNumber(x)) {
    if (x.isExact !== true) return undefined;
    const r = asRational(x);
    if (r === undefined) return undefined;
    return [
      [0n, 1n],
      [BigInt(r[0]), BigInt(r[1])],
    ];
  }
  if (isSymbol(x, 'Pi'))
    return [
      [1n, 1n],
      [0n, 1n],
    ];
  // A symbol is read through to its value (`x := 12345678901234567890123`,
  // `x := 10³⁰·π`). The value is read with the same rules, so a symbol with
  // an inexact value (`e`, `x := 1.5`) or with no value gives `undefined`.
  if (isSymbol(x)) {
    const v = x.value;
    return v === undefined || v === x
      ? undefined
      : exactAngleParts(v, depth + 1);
  }
  if (!isFunction(x)) return undefined;

  if (x.operator === 'Negate' && x.nops === 1) {
    const a = exactAngleParts(x.op1, depth + 1);
    if (!a) return undefined;
    return [
      [-a[0][0], a[0][1]],
      [-a[1][0], a[1][1]],
    ];
  }

  if (x.operator === 'Add') {
    let c: BigRational = [0n, 1n];
    let t: BigRational = [0n, 1n];
    for (const op of x.ops) {
      const a = exactAngleParts(op, depth + 1);
      if (!a) return undefined;
      c = ratAdd(c, a[0]);
      t = ratAdd(t, a[1]);
    }
    return [c, t];
  }

  if (x.operator === 'Multiply' || x.operator === 'Divide') {
    if (x.operator === 'Divide' && x.nops !== 2) return undefined;
    let c: BigRational = [0n, 1n];
    let t: BigRational = [1n, 1n];
    for (const [i, op] of x.ops.entries()) {
      const a = exactAngleParts(op, depth + 1);
      if (!a) return undefined;
      let [ca, ta] = a;
      if (x.operator === 'Divide' && i === 1) {
        // Only a rational divisor keeps the angle in the form `c·π + t`.
        if (ca[0] !== 0n || ta[0] === 0n) return undefined;
        ta = ta[0] < 0n ? [-ta[1], -ta[0]] : [ta[1], ta[0]];
      }
      // (c·π + t)·(ca·π + ta) has a π² term unless c or ca is zero.
      if (c[0] !== 0n && ca[0] !== 0n) return undefined;
      c = ratAdd(ratMul(c, ta), ratMul(t, ca));
      t = ratMul(t, ta);
    }
    return [c, t];
  }

  if (x.operator === 'Power' && x.nops === 2) {
    const base = exactAngleParts(x.op1, depth + 1);
    const exp = exactAngleParts(x.op2, depth + 1);
    if (!base || !exp) return undefined;
    if (base[0][0] !== 0n || exp[0][0] !== 0n || exp[1][1] !== 1n)
      return undefined;
    let n = exp[1][0];
    let [p, q] = base[1];
    // A negative exponent is the power of the reciprocal (`10⁻⁴⁰⁰` is
    // `1/10⁴⁰⁰`); a zero base has no reciprocal.
    if (n < 0n) {
      if (p === 0n) return undefined;
      [p, q] = p < 0n ? [-q, -p] : [q, p];
      n = -n;
    }
    // Keep the exact power to a reasonable size (about 10⁵ digits).
    const digits = Math.max(
      (p < 0n ? -p : p).toString().length,
      q.toString().length
    );
    if (Number(n) * digits > 100_000) return undefined;
    return [
      [0n, 1n],
      [p ** n, q ** n],
    ];
  }

  return undefined;
}

function ratAdd(a: BigRational, b: BigRational): BigRational {
  if (a[1] === b[1]) return [a[0] + b[0], a[1]];
  return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
}

function ratMul(a: BigRational, b: BigRational): BigRational {
  return [a[0] * b[0], a[1] * b[1]];
}

/** Number of decimal digits of the integer part of `|p/q|`. */
function integerPartDigits([p, q]: BigRational): number {
  const n = (p < 0n ? -p : p) / q;
  return n === 0n ? 0 : n.toString().length;
}

/**
 * The value, in radians, of the exact angle `raw`, as a big decimal that
 * keeps every digit of its integer part, or `undefined` when the numeric
 * value of the angle at the working precision is already accurate.
 *
 * The numeric value of an angle is rounded to the working precision before
 * the kernel reduces it modulo 2π. For a large angle this rounding changes
 * the value modulo 2π: the 23-digit integer `12345678901234567890123`
 * rounded to 21 digits gives `sin = 0.9918…` instead of `−0.4206…`, and
 * `10³⁰·π` rounded to 21 digits gives `sin = 0.8838…` instead of `0`. This
 * function avoids both roundings:
 * - The multiple of π is reduced exactly: `(p/q)·π` modulo `2π` is
 *   `((p mod 2q)/q)·π`, so only a multiple of π in `(−2π, 2π)` is rounded.
 * - The rational part keeps its exact integer part, and only its fractional
 *   part is rounded to the working precision. The big-decimal kernels read
 *   all the digits of their argument and reduce it with as many digits of π
 *   as its magnitude requires.
 *
 * In degree, gradian and turn modes an angle with a π factor has a `π²` term
 * in radians, which no integer arithmetic reduces. That term is computed with
 * enough digits to hold every digit of its integer part, and the kernel
 * reduces it from those digits; the multiple of π that the rational part
 * contributes is reduced exactly as above.
 *
 * To keep ordinary angles on the usual route, this applies only when the
 * multiple of π is `2` or more in magnitude, or when the rational part has an
 * integer part of 3 digits or more (an integer only when it has more digits
 * than the working precision: a shorter integer is exact at that precision).
 */
function exactLargeAngle(raw: Expression): BigDecimal | undefined {
  const ce = raw.engine;
  if (raw.unknowns.length > 0) return undefined;
  const parts = exactAngleParts(raw);
  if (!parts) return undefined;
  let [c, t] = parts;

  // Convert the angle to radians. In an angular unit other than radians the
  // angle `c·π + t` is `(c·π + t)·u` radians, with `u` the unit in radians
  // over π: 1/180 (deg), 1/200 (grad) or 2 (turn) times π.
  const unit = ce.angularUnit;
  if (unit !== 'rad') {
    const u: [bigint, bigint] | undefined =
      unit === 'deg'
        ? [1n, 180n]
        : unit === 'grad'
          ? [1n, 200n]
          : unit === 'turn'
            ? [2n, 1n]
            : undefined;
    if (u === undefined) return undefined;
    if (c[0] === 0n) {
      // A rational angle is a rational multiple of π in radians, reduced
      // exactly below like a radian angle.
      c = [t[0] * u[0], t[1] * u[1]];
      t = [0n, 1n];
    } else {
      // An angle with a π factor has a `π²` term in radians, `c·u·π²`, which
      // is not a rational multiple of π and cannot be reduced by integer
      // arithmetic. It is computed with enough digits to hold every digit of
      // its integer part on top of the working precision, and the kernel
      // reduces it from those digits. Rounding it to the working precision
      // first gave `sin(10³⁰·π)` in degrees as `0` where the value is
      // `0.3501…`. The rational part contributes the multiple of π `t·u`,
      // reduced exactly modulo 2π as a radian multiple is. As for a radian
      // angle, only a large angle takes this route: a multiple of π of 2 or
      // more from either term.
      const cp = c[0] * u[0];
      const cq = c[1] * u[1];
      const tp = t[0] * u[0];
      const tq = t[1] * u[1];
      const large =
        (cp < 0n ? -cp : cp) >= 2n * cq || (tp < 0n ? -tp : tp) >= 2n * tq;
      if (!large) return undefined;
      // (tp/tq)·π modulo 2π is ((tp mod 2tq)/tq)·π exactly
      const tReduced = tp % (2n * tq);
      const digits = integerPartDigits([cp, cq]) + 2;
      const saved = BigDecimal.precision;
      BigDecimal.precision = saved + digits + 5;
      try {
        const pi = BigDecimal.PI;
        const piSquaredTerm = pi
          .mul(pi)
          .mul(new BigDecimal(cp))
          .div(new BigDecimal(cq));
        if (tReduced === 0n) return piSquaredTerm;
        return piSquaredTerm.add(
          pi.mul(new BigDecimal(tReduced)).div(new BigDecimal(tq))
        );
      } finally {
        BigDecimal.precision = saved;
      }
    }
  }

  const [cp, cq] = c;
  const [tp, tq] = t;
  const largeMultiple = (cp < 0n ? -cp : cp) >= 2n * cq;
  const tDigits = integerPartDigits(t);
  const largeRational = tq === 1n ? tDigits > ce.precision : tDigits >= 3;
  if (!largeMultiple && !largeRational) return undefined;

  // (cp/cq)·π modulo 2π is ((cp mod 2cq)/cq)·π exactly
  const cReduced = cp % (2n * cq);
  let theta =
    cReduced === 0n
      ? BigDecimal.ZERO
      : BigDecimal.PI.mul(new BigDecimal(cReduced)).div(new BigDecimal(cq));
  // The integer part of t is added exactly (`add` does not round)
  theta = theta.add(new BigDecimal(tp / tq));
  const tFraction = tp % tq;
  if (tFraction !== 0n)
    theta = theta.add(new BigDecimal(tFraction).div(new BigDecimal(tq)));
  return theta;
}

function applyAngle(
  angle: Expression,
  fn: (x: number) => number | Complex | Expression,
  bigFn?: (x: BigDecimal) => BigDecimal | Complex | number | Expression,
  complexFn?: (x: Complex) => number | Complex,
  raw?: Expression
): Expression | undefined {
  // An exact large angle is not rounded to the working precision before the
  // kernel reduces it modulo 2π (see `exactLargeAngle`).
  if (raw && bigFn) {
    const ce = raw.engine;
    if (bignumPreferred(ce)) {
      const big = exactLargeAngle(raw);
      if (big !== undefined)
        return apply(
          ce.number(big),
          fn as (x: number) => number | Complex,
          bigFn as (x: BigDecimal) => BigDecimal | Complex | number,
          complexFn
        );
    } else {
      // At machine precision a double cannot hold a large angle: run the
      // big-decimal kernel with enough digits for a double (the working
      // precision of big decimals is then 15 digits), and round its value
      // to a double.
      const saved = BigDecimal.precision;
      let r: BigDecimal | Complex | number | Expression | undefined;
      try {
        BigDecimal.precision = Math.max(saved, 20);
        const big = exactLargeAngle(raw);
        if (big !== undefined) r = bigFn(big);
      } finally {
        BigDecimal.precision = saved;
      }
      if (r instanceof BigDecimal) return ce.number(r.toNumber());
      if (typeof r === 'number') return ce.number(r);
      if (r !== undefined && !(r instanceof Complex)) return r;
    }
  }
  const angle0 = canonicalAngle(angle);
  if (angle0 === undefined) return undefined;
  // `apply` below declines anything that is not a number LITERAL, and an
  // expression with unknowns cannot become one — so numericizing it first is
  // waste, and on a nested tree of user-function applications an exponential
  // one. (This is the same walk `constructibleValues` skips on the exact path;
  // `applyAngle` is the `.N()` path's copy of it.)
  if (angle0.unknowns.length > 0) return undefined;
  const theta = angle0.N();
  // `apply`'s machine/bignum handlers can also yield an already-boxed
  // expression (e.g. `ce.ComplexInfinity` for a `Tan` pole), which it boxes
  // through `ce.number`; its public signature is narrower, so cast here.
  return apply(
    theta,
    fn as (x: number) => number | Complex,
    bigFn as ((x: BigDecimal) => BigDecimal | Complex | number) | undefined,
    complexFn
  );
}

/**
 * The exact half-turn angle (π rad) expressed in the engine's current angular
 * unit: `π` (rad), `180` (deg), `200` (grad), or `1/2` (turn). Building exact
 * angle results from this constant keeps `evaluate()` consistent with the
 * unit-converted numeric path (`radiansToAngle`) — e.g. in degree mode
 * `arcsin(1)` evaluates to the exact integer `90`, matching `.N()`.
 */
export function halfTurnAngle(ce: ComputeEngine): Expression {
  const unit = ce.angularUnit;
  if (unit === 'deg') return ce.number(180);
  if (unit === 'grad') return ce.number(200);
  if (unit === 'turn') return ce.number([1, 2]);
  return ce.Pi;
}

/** Assuming x in an expression in radians, convert to current angular unit. */
export function radiansToAngle(
  x: Expression | undefined
): Expression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  const n = x.N();
  const theta = n.re;
  if (Number.isNaN(theta)) return x;

  // A real angle computed at a precision above the machine's is converted
  // at that precision: a conversion with machine numbers answers
  // `arcsin(0.5)` in degrees as `30.000000000000004`, which is not the
  // value at the working precision.
  const nv = isNumber(n) ? n.numericValue : undefined;
  if (
    nv !== undefined &&
    typeof nv !== 'number' &&
    nv.im === 0 &&
    nv.bignumRe !== undefined
  ) {
    const big = nv.bignumRe;
    const converted =
      angularUnit === 'deg'
        ? big.mul(180).div(BigDecimal.PI)
        : angularUnit === 'grad'
          ? big.mul(200).div(BigDecimal.PI)
          : angularUnit === 'turn'
            ? big.div(BigDecimal.PI.mul(2))
            : undefined;
    if (converted !== undefined) return ce.number(converted);
  }

  const scale =
    angularUnit === 'deg'
      ? 180 / Math.PI
      : angularUnit === 'grad'
        ? 200 / Math.PI
        : angularUnit === 'turn'
          ? 1 / (2 * Math.PI)
          : null;
  if (scale === null) return x;
  // The unit conversion is linear, so it applies to the whole complex value:
  // reading only `.re` silently returned a wrong REAL angle for a complex
  // one (`arcsin(2.5)` in deg mode gave `90`, dropping the imaginary part).
  // A dust-sized imaginary part (kernel roundoff, not `ce.tolerance`) chops
  // to the real path.
  if (!Number.isNaN(n.im) && chop(n.im, ROUNDOFF_TOLERANCE) !== 0)
    return ce.number(ce.complex(theta * scale, n.im * scale));
  return ce.number(theta * scale);
}

/**
 * Chop numericization dust from the value of a bignum `sin` or `cos` kernel
 * at the angle `x` (in radians). `.N()` substitutes a precision-limited
 * approximation for a symbolic zero-crossing argument (`Sin(π)` becomes sin
 * of π-to-`precision`-digits ≈ 10^−precision), and that value is noise.
 *
 * The limit is `min(1, |x|)·10^(2−precision)`. A rounded argument has an
 * absolute error of about `|x|·10^−precision`, and the derivatives of `sin`
 * and `cos` are at most 1, so for `|x| < 1` the limit follows the argument:
 * a value that is small because the argument is small is kept (`sin(10⁻²⁵)`
 * is `10⁻²⁵`). For `|x| ≥ 1` the limit stays `10^(2−precision)`: a large
 * argument can be exact (`sin(10²²)` is `−0.852…`, and the kernel reduces
 * it exactly), and a limit that grows with `|x|` would chop its value.
 *
 * The limit is not `ce.tolerance`, which destroyed legitimately-computed
 * small results (`sin(3.141592653588793)` ≈ 1.0e−12 chopped to 0 at the
 * default 1e-10 tolerance). See ARCHITECTURE.md § "Chopping and the
 * `im === 0` convention".
 */
function chopBignumDust(
  ce: ComputeEngine,
  value: BigDecimal,
  x: BigDecimal
): BigDecimal | 0 {
  if (value.abs().lte(dustScale(ce, x))) return 0;
  return value;
}

/**
 * The rounding error of the angle `x` (in radians) that `chopBignumDust`
 * and `bigPoleDust` allow: `min(1, |x|)·10^(2−precision)`.
 */
function dustScale(ce: ComputeEngine, x: BigDecimal): BigDecimal {
  const limit = new BigDecimal(`1e${2 - ce.precision}`);
  const ax = x.abs();
  return ax.lt(BigDecimal.ONE) ? ax.mul(limit) : limit;
}

/**
 * The value `~oo` for a computed value of `tan`, `cot`, `sec` or `csc` at
 * the angle `x` (in radians) when `x` is a pole within its rounding error
 * (the counterpart of `chopBignumDust`). Near a pole `p`, the magnitude of
 * the value is about `1/|x − p|`, so the value is `~oo` when its magnitude
 * is at least the reciprocal of the rounding error that `chopBignumDust`
 * allows, `1/(min(1, |x|)·10^(2−precision))`. `.N()` substitutes π to the
 * working precision, and `Cot(π)` computes as a very large number that is
 * only rounding.
 *
 * A value that is large because the argument is legitimately near a pole
 * is kept: `tan(π/2 + 10⁻¹⁵)` is about `−10¹⁵` at 21 digits, and
 * `cot(10⁻²⁵)` is `10²⁵` (the pole at 0 is exact, and the rounding error of
 * `10⁻²⁵` is about `10⁻⁴⁶`).
 */
function bigPoleDust(
  ce: ComputeEngine,
  value: BigDecimal,
  x: BigDecimal
): BigDecimal | Expression {
  if (!value.isFinite()) return ce.ComplexInfinity;
  if (value.abs().mul(dustScale(ce, x)).gte(BigDecimal.ONE))
    return ce.ComplexInfinity;
  return value;
}

/**
 * `bigPoleDust` and `chopBignumDust` together, for `tan` and `cot`, which
 * have zeros as well as poles: a value that is only rounding at a zero is
 * `0`, as the `sin` and `cos` kernels answer at theirs. Without the chop,
 * `cot(5π/2)` at machine precision, computed on the exact-angle route from
 * `π/2` at 20 digits, answered `3.1e-20` where `cos(5π/2)` answers `0`.
 */
function bigZeroAndPoleDust(
  ce: ComputeEngine,
  value: BigDecimal,
  x: BigDecimal
): BigDecimal | 0 | Expression {
  const r = bigPoleDust(ce, value, x);
  return r instanceof BigDecimal ? chopBignumDust(ce, r, x) : r;
}

/**
 * The machine counterpart of `bigPoleDust`: the value `~oo` when the angle
 * `x` (in radians) is within its rounding error of a pole, that is when
 * `|value|·min(|x|, 2⁴⁰)·100·2⁻⁵³ ≥ 1` (`isMachineTrigPole`). Compiled
 * JavaScript and Python use the same rule, and the routes must agree at
 * every argument (`test/compute-engine/compile-trig-poles.test.ts`).
 */
function poleDust(
  ce: ComputeEngine,
  value: number,
  x: number
): number | Expression {
  // A value that overflows a double at a finite nonzero angle below `π/2`
  // in magnitude is not a pole: it is `csc` or `cot` of an angle so small
  // that its reciprocal is above the largest double (`csc(5·10⁻³²⁴)` is
  // about `2·10³²³`). On `(−π/2, π/2)` the sign of `csc x` and of `cot x`
  // is the sign of `x`, so the value is the signed infinity. The pole at 0
  // itself (`x = 0`) stays `~oo`.
  if (
    (value === Infinity || value === -Infinity) &&
    x !== 0 &&
    Math.abs(x) < Math.PI / 2
  )
    return x > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
  if (isMachineTrigPole(value, x)) return ce.ComplexInfinity;
  return value;
}

/**
 * The value of an inverse trigonometric function, an angle in the engine's
 * angular unit. `fn`, `bigFn` and `complexFn` compute it in radians.
 *
 * In another unit than radians, the bignum kernel runs with guard digits,
 * and its result is converted to the unit before it is rounded to the
 * working precision. A conversion of the rounded value keeps the rounding
 * error of the radian value: `arccos(0.5)` in degrees at 21 digits was
 * `59.9999999999999999998`, not `60`. The machine and complex results are
 * converted by `radiansToAngle`.
 */
function inverseAngle(
  op: Expression,
  fn: (x: number) => number,
  bigFn: (x: BigDecimal) => BigDecimal,
  complexFn: (x: Complex) => number | Complex
): Expression | undefined {
  const unit = op.engine.angularUnit;
  if (unit === 'rad') return apply(op, fn, bigFn, complexFn);
  let converted = false;
  const result = apply(
    op,
    fn,
    (x) => {
      const saved = BigDecimal.precision;
      BigDecimal.precision = saved + 10;
      try {
        const theta = bigFn(x);
        if (!theta.isFinite()) return theta;
        const angle =
          unit === 'deg'
            ? theta.mul(180).div(BigDecimal.PI)
            : unit === 'grad'
              ? theta.mul(200).div(BigDecimal.PI)
              : theta.div(BigDecimal.PI.mul(2));
        converted = true;
        return angle.toPrecision(saved);
      } finally {
        BigDecimal.precision = saved;
      }
    },
    complexFn
  );
  return converted ? result : radiansToAngle(result);
}

/**
 * At machine precision, the sign of an exact NONZERO rational angle whose
 * double is 0 (`10⁻⁴⁰⁰`): the angle underflows, so `csc` and `cot` of it
 * would be read as the pole at 0 (`~oo`), while the true value is the signed
 * infinity with the sign of the angle, as `Csc(5·10⁻³²⁴)` answers (`poleDust`).
 * `undefined` for any other angle, and above machine precision, where a big
 * decimal holds the angle and the kernel computes the finite value.
 */
function underflowingAngleSign(
  raw: Expression | undefined
): -1 | 1 | undefined {
  if (raw === undefined || bignumPreferred(raw.engine)) return undefined;
  if (raw.unknowns.length > 0) return undefined;
  const parts = exactAngleParts(raw);
  if (!parts) return undefined;
  const [[cp], [tp, tq]] = parts;
  if (cp !== 0n || tp === 0n) return undefined;
  if (Number(tp) / Number(tq) !== 0) return undefined;
  return tp < 0n !== tq < 0n ? -1 : 1;
}

export function evalTrig(
  name: string,
  op: Expression | undefined,
  /** The operand before its numeric evaluation, when known. An exact large
   * angle is then not rounded before the kernel runs (`exactLargeAngle`). */
  raw?: Expression
): Expression | undefined {
  if (!op) return undefined;
  const ce = op.engine;

  switch (name) {
    case 'Arccos':
      return inverseAngle(
        op,
        Math.acos,
        (x) => x.acos(),
        (x) => x.acos()
      );
    case 'Arccot':
      return inverseAngle(
        op,
        (x) => Math.atan2(1, x),
        (x) => BigDecimal.atan2(BigDecimal.ONE, x),
        (x) => x.inverse().atan()
      );
    case 'Arccsc':
      return inverseAngle(
        op,
        (x) => Math.asin(1 / x),
        (x) => BigDecimal.ONE.div(x).asin(),
        (x) => x.inverse().asin()
      );
    // Inverse HYPERBOLIC functions return an area (a dimensionless real),
    // NOT an angle: they are unit-independent and must not be scaled by
    // `angularUnit` (no `radiansToAngle` wrapper).
    case 'Arcosh':
      return apply(
        op,
        Math.acosh,
        // `BigDecimal.acosh()`, not `ln(x + √(x² − 1))`: the direct formula
        // loses relative precision near 1 and for a large `x`.
        (x) => x.acosh(),
        (x) => x.acosh()
      );
    case 'Arcoth':
      // ln[(1 + x) /(x − 1)] /2
      return apply(
        op,
        (x) => Math.log((1 + x) / (x - 1)) / 2,
        (x) =>
          BigDecimal.ONE.add(x)
            .div(x.sub(BigDecimal.ONE))
            .ln()
            .div(BigDecimal.TWO),
        // Use the native principal-branch `acoth`: the hand-rolled
        // `ln((1+x)/(x−1))/2` picks the wrong side of the cut for negative
        // real arguments in `(−1, 0)` (imaginary part sign flips), whereas
        // `acoth` matches mpmath across the plane.
        (x) => x.acoth()
      );

    case 'Arcsch':
      // ln[1/x + √(1/x2 + 1)],
      return apply(
        op,
        (x) => Math.log(1 / x + Math.sqrt(1 / (x * x) + 1)),
        (x) =>
          BigDecimal.ONE.div(x.mul(x))
            .add(BigDecimal.ONE)
            .sqrt()
            .add(BigDecimal.ONE.div(x))
            .ln(),
        (x) => x.mul(x).inverse().add(1).sqrt().add(x.inverse()).log()
      );

    case 'Arcsec':
      return inverseAngle(
        op,
        (x) => Math.acos(1 / x),
        (x) => BigDecimal.ONE.div(x).acos(),
        (x) => x.inverse().acos()
      );

    case 'Arcsin':
      return inverseAngle(
        op,
        Math.asin,
        (x) => x.asin(),
        (x) => x.asin()
      );

    case 'Arsech':
      return apply(
        op,
        (x) => Math.log((1 + Math.sqrt(1 - x * x)) / x),
        // arsech(x) = ln((1 + sqrt(1 - x^2)) / x)
        (x) =>
          BigDecimal.ONE.sub(x.mul(x)).sqrt().add(BigDecimal.ONE).div(x).ln(),
        // Native principal-branch `asech`: the previous inline expression
        // dropped the `sqrt` (computed `ln((2 − x²)/x)`), giving a wrong value
        // even for in-domain reals; `asech` matches mpmath across the plane.
        (x) => x.asech()
      );

    case 'Arsinh':
      return apply(
        op,
        Math.asinh,
        // `BigDecimal.asinh()`, not `ln(x + √(x² + 1))`: the direct formula
        // cancels near 0 (a relative error of 5e-11 at x = 10⁻¹⁰), which
        // breaks the error bound that exact ordering relies on.
        (x) => x.asinh(),
        (x) => x.asinh()
      );

    case 'Arctan':
      return inverseAngle(
        op,
        Math.atan,
        (x) => x.atan(),
        (x) => x.atan()
      );

    case 'Artanh':
      return apply(
        op,
        Math.atanh,
        // The big-decimal `atanh` (`big-decimal/transcendentals.ts`) keeps
        // a tiny argument (`Artanh(10⁻³⁰)` is `10⁻³⁰`, where the direct
        // formula ½·ln((1 + x)/(1 − x)) computed 0 at 21 digits), adds guard
        // digits against the cancellation near 1, and answers ±∞ at ±1 and
        // NaN for |x| > 1, where `apply` then uses the complex kernel. The
        // exact ordering relies on a relative error of a few units in the
        // last digit.
        (x) => x.atanh(),
        (x) => x.atanh()
      );

    case 'Cos':
      return applyAngle(
        op,
        Math.cos,
        (x) => chopBignumDust(ce, x.cos(), x),
        (x) => x.cos(),
        raw
      );

    // Hyperbolic functions take a dimensionless argument, NOT an angle: they
    // are unit-independent and must not be converted by `angularUnit` (use
    // plain `apply`, not `applyAngle`).
    case 'Cosh':
      return apply(
        op,
        Math.cosh,
        (x) => x.cosh(),
        (x) => x.cosh()
      );

    case 'Cot': {
      // Poles at multiples of π. A pole is recognized from the structure of
      // the argument (`isTrigPole`) when it has one. Under `.N()` the
      // argument is already a number, so a value larger than the reciprocal
      // of the rounding dust is the pole (`poleDust`): `.N()` substitutes π
      // to the working precision, and `Cot(π)` computes as −2.6e24.
      // An exact angle that underflows to the double 0 is read before the
      // pole check, which would take the evaluated 0 for the pole at 0.
      const under = underflowingAngleSign(raw);
      if (under !== undefined)
        return under > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
      if (isTrigPole('Cot', op)) return ce.ComplexInfinity;
      return applyAngle(
        op,
        (x) => poleDust(ce, 1 / Math.tan(x), x),
        (x) => bigZeroAndPoleDust(ce, BigDecimal.ONE.div(x.tan()), x),
        (x) => x.tan().inverse(),
        raw
      );
    }
    case 'Coth':
      return apply(
        op,
        (x) => 1 / Math.tanh(x),
        (x) => BigDecimal.ONE.div(x.tanh()),
        (x) => x.tanh().inverse()
      );
    case 'Csc': {
      // Poles at multiples of π, recognized as for `Cot`.
      // An exact angle that underflows to the double 0 is read before the
      // pole check, which would take the evaluated 0 for the pole at 0.
      const under = underflowingAngleSign(raw);
      if (under !== undefined)
        return under > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
      if (isTrigPole('Csc', op)) return ce.ComplexInfinity;
      return applyAngle(
        op,
        (x) => poleDust(ce, 1 / Math.sin(x), x),
        (x) => bigPoleDust(ce, BigDecimal.ONE.div(x.sin()), x),
        (x) => x.sin().inverse(),
        raw
      );
    }
    case 'Csch':
      return apply(
        op,
        (x) => 1 / Math.sinh(x),
        (x) => BigDecimal.ONE.div(x.sinh()),
        (x) => x.sinh().inverse()
      );
    case 'Sec':
      // Poles at π/2 + kπ, recognized as for `Cot`.
      if (isTrigPole('Sec', op)) return ce.ComplexInfinity;
      return applyAngle(
        op,
        (x) => poleDust(ce, 1 / Math.cos(x), x),
        (x) => bigPoleDust(ce, BigDecimal.ONE.div(x.cos()), x),
        (x) => x.cos().inverse(),
        raw
      );
    case 'Sech':
      return apply(
        op,
        (x) => 1 / Math.cosh(x),
        (x) => BigDecimal.ONE.div(x.cosh()),
        (x) => x.cosh().inverse()
      );
    case 'Sin':
      return applyAngle(
        op,
        Math.sin,
        (x) => chopBignumDust(ce, x.sin(), x),
        (x) => x.sin(),
        raw
      );
    case 'Sinh':
      return apply(
        op,
        Math.sinh,
        (x) => x.sinh(),
        (x) => x.sinh()
      );
    case 'Tan': {
      if (isTrigPole('Tan', op)) return ce.ComplexInfinity;
      return applyAngle(
        op,
        (x) => poleDust(ce, Math.tan(x), x),
        (x) => bigZeroAndPoleDust(ce, x.tan(), x),
        (x) => x.tan(),
        raw
      );
    }
    case 'Tanh':
      return apply(
        op,
        Math.tanh,
        (x) => x.tanh(),
        (x) => x.tanh()
      );
  }
  return undefined;
}

function isInverseTrigFunc(name: string): boolean {
  if (name.startsWith('Ar') && inverseTrigFuncName(name)) return true;
  return false;
}

function inverseTrigFuncName(name: string): string | undefined {
  return {
    Sin: 'Arcsin',
    Cos: 'Arccos',
    Tan: 'Arctan',
    Sec: 'Arcsec',
    Csc: ' Arccsc',
    Sinh: 'Arsinh',
    Cosh: 'Arcosh',
    Tanh: 'Artanh',
    Sech: 'Arsech',
    Csch: 'Arcsch',
    Arcosh: 'Cosh',
    Arccos: 'Cos',
    Arccsc: 'Csc',
    Arcsch: 'Csch',
    // '??': 'Cot',
    // '??': 'Coth',
    Arcsec: 'Sec',
    Arcsin: 'Sin',
    Arsinh: 'Sinh',
    Arctan: 'Tan',
    Artanh: 'Tanh',
  }[name];
}

export function processInverseFunction(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>
): Expression | undefined {
  if (xs.length !== 1 || !xs[0].isValid) return undefined;
  const expr = xs[0];
  if (isFunction(expr, 'InverseFunction')) return expr.op1.canonical;

  if (!isSymbol(expr)) return undefined;
  const name = expr.symbol;

  const newHead = inverseTrigFuncName(name);
  return newHead ? ce.symbol(newHead) : undefined;
}

function trigFuncParity(name: string): number {
  // Cos and Sec are even functions, the others are odd
  return name !== 'Cos' && name !== 'Sec' ? -1 : 1;
}

function constructibleValuesInverse(
  ce: ComputeEngine,
  operator: string,
  x: Expression | undefined,
  specialValues: ConstructibleTrigValues
): undefined | Expression {
  if (!x) return undefined;
  // An inexact argument (`arcsin(0.5)`) numericizes: it has no exact value.
  if (isNumber(x) && x.isExact === false) return undefined;
  const xN = x.N();
  // If the argument has an imaginary part, it's not a constructible value
  if (xN.im !== 0) return undefined;
  let x_N = xN.re;
  if (Number.isNaN(x_N)) return undefined;
  // operator is arcFn, and inv_operator is Fn
  const inv_operator = inverseTrigFuncName(operator);

  //
  // Create the cache of special values of the operator function by inverting
  // specialValues of inv_operator function
  //
  type ConstructibleTrigValuesInverse = [
    [match_arg: Expression, match_arg_N: number],
    angle: [numerator: number, denominator: number],
  ][];
  const specialInverseValues = ce._cache<ConstructibleTrigValuesInverse>(
    'constructible-inverse-trigonometric-values-' + operator,
    () => {
      const cache: ConstructibleTrigValuesInverse = [];
      for (const [[n, d], value] of specialValues) {
        const r = value[inv_operator!];
        if (r === undefined) continue;
        const rn = r.N().re;
        if (Number.isNaN(rn)) continue;
        cache.push([
          [r, rn],
          [n, d],
        ]);
      }
      return cache;
    },

    (cache: ConstructibleTrigValuesInverse) => {
      for (const [[match_arg, _match_arg_N], [_n, _d]] of cache) {
        match_arg._reset();
      }
      return cache;
    }
  );

  // Odd-even identities

  let quadrant = 0;
  if (x_N < 0) {
    quadrant = trigFuncParity(inv_operator!) == -1 ? -1 : 1;
    // shift x to quadrant 0 to match the key in specialInverseValues
    x_N = -x_N;
    x = x.neg();
  }

  // The machine values select the candidates, and an EXACT difference of
  // zero confirms one: `arcsin(1/2 + 10⁻³⁰)` is not `π/6`, and an inexact
  // argument (`arcsin(0.5)`) is not a special value (only `.N()` and an
  // inexact argument numericize).
  for (const [[match_arg, match_arg_N], [n, d]] of specialInverseValues) {
    if (
      Math.abs(x_N - match_arg_N) <= 1e-9 * Math.max(1, Math.abs(x_N)) &&
      isExactZero(x.sub(match_arg))
    ) {
      // The angle is (n/d)·halfTurn, expressed exactly in the engine's
      // angular unit (π rad, 180 deg, …) so evaluate() agrees with the
      // unit-converted numeric path (e.g. deg mode: arcsin(1) → exact 90).
      const halfTurn = halfTurnAngle(ce);
      let theta = halfTurn.mul(n).div(d);
      if (quadrant == -1) theta = theta.neg();
      else if (quadrant == 1) theta = halfTurn.sub(theta);

      return theta.evaluate();
    }
  }
  return undefined;
}

/** True when `x` is the exact number literal 0. */
function isExactZero(x: Expression): boolean {
  return isNumber(x) && x.isExact === true && x.isSame(0);
}

export function trigSign(operator: string, x: Expression): Sign | undefined {
  const [q, pos] = quadrant(x);
  if (q === undefined) return undefined;
  if (pos !== undefined) {
    if ((operator === 'Sin' || operator === 'Tan') && (pos === 0 || pos === 2))
      return 'zero';
    if ((operator === 'Cos' || operator === 'Cot') && (pos === 1 || pos === 3))
      return 'zero';
    // A pole (`tan(π/2)`, `csc(π)`) has no sign.
    if ((operator === 'Tan' || operator === 'Sec') && (pos === 1 || pos === 3))
      return undefined;
    if ((operator === 'Cot' || operator === 'Csc') && (pos === 0 || pos === 2))
      return undefined;
  }
  // `quadrant()` numbers the quadrants 1..4; the tables below are indexed
  // 0..3. Indexing them with `q` itself shifted every sign one quadrant
  // along, so `cos 1`, `sec 1` and `tan 1` (first quadrant) reported
  // `negative` and `sin 2` (second quadrant) did too — and `|sec 1|` then
  // evaluated to `-sec(1)`.
  return {
    Sin: ['positive', 'positive', 'negative', 'negative'],
    Cos: ['positive', 'negative', 'negative', 'positive'],
    Sec: ['positive', 'negative', 'negative', 'positive'],
    Csc: ['positive', 'positive', 'negative', 'negative'],
    Tan: ['positive', 'negative', 'positive', 'negative'],
    Cot: ['positive', 'negative', 'positive', 'negative'],
  }[operator]?.[q - 1] as Sign;
}

export function isConstructible(x: string | Expression): boolean {
  return ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot'].includes(
    typeof x === 'string' ? x : x.operator
  );
}

export function constructibleValues(
  operator: string,
  x: Expression | undefined
): undefined | Expression {
  // Forward trig (Sin/Cos/…) reduces special angles; inverse trig
  // (Arcsin/Arccos/Arctan/…) reduces special arguments via the dispatch to
  // `constructibleValuesInverse` below. Without allowing inverse operators
  // here, that dispatch was unreachable dead code and `arcsin(0)`, `arctan(1)`,
  // etc. never reduced.
  if (!x || (!isConstructible(operator) && !isInverseTrigFunc(operator)))
    return undefined;
  const ce = x.engine;

  // An argument with unknowns is not a constant angle. Gate on `.unknowns`
  // (a symbol with an assigned value is NOT unknown, so `sin(y)` with
  // `y := π/4` still reduces): the walk is a single linear pass, while a
  // numeric evaluation of the argument over nested applications of a user
  // function re-evaluates shared sub-chains and grows exponentially with the
  // nesting depth (44 s for a 17-element list of such chains).
  if (x.unknowns.length > 0) return undefined;

  //
  // Create the cache of special values
  //
  const specialValues = ce._cache<ConstructibleTrigValues>(
    'constructible-trigonometric-values',
    () => {
      return CONSTRUCTIBLE_VALUES.map(([val, results]) => [
        val,
        Object.fromEntries(
          Object.entries(results).map(([op, r]) => [
            op,
            (asLatexString(r)
              ? ce.expr(parseLatex(asLatexString(r)!) ?? r)
              : ce.expr(r)
            ).simplify(),
          ])
        ),
      ]);
    },

    (cache: ConstructibleTrigValues) => {
      for (const [_k, v] of cache) {
        for (const v2 of Object.values(v)) v2._reset();
      }
      return cache;
    }
  );

  if (isInverseTrigFunc(operator))
    return constructibleValuesInverse(ce, operator, x, specialValues);

  // A special value is used only when the angle is EXACTLY a rational
  // multiple of a half-turn, read from its structure (`halfTurns`). The
  // machine value of the angle is not used: an angle within 10⁻¹² of a
  // special angle (`π − 10⁻³⁰`) is not that angle, and `sin(π − 10⁻³⁰)` is
  // not 0.
  const turns = halfTurns(x);
  if (turns === undefined) return undefined;
  const [n0, d] = turns;

  // Odd-even identities
  const identitySign = trigFuncParity(operator) == -1 && n0 < 0n ? -1 : +1;

  // The angle modulo a full turn, in [0, 2) half-turns
  const n = (n0 < 0n ? -n0 : n0) % (2n * d);
  const quadrant = Number((2n * n) / d); // 0..3

  // The angle in the quadrant, in [0, 1/2) half-turns: `rn/rd`
  const rn = 2n * n - BigInt(quadrant) * d;
  const rd = 2n * d;

  // Adjusting for the position in the quadrant
  let sign: number;
  [sign, operator] = TRIG_IDENTITIES[operator]?.[quadrant] ?? [1, operator];

  for (const [[num, den], value] of specialValues) {
    const r = value[operator];
    if (r && rn * BigInt(den) === BigInt(num) * rd) {
      if (isSymbol(r, 'ComplexInfinity')) return r;
      return identitySign * sign < 0 ? r.neg() : r;
    }
  }
  return undefined;
}

/**
 * The rational `n/d` (with `d > 0`) such that the angle `x`, in the
 * engine's angular unit, is exactly `n/d` half-turns (`n/d·π` rad), or
 * `undefined` when that is not known. The value is read from the
 * structure of `x`, never from its numeric value: `π`, `3π/4`,
 * `−π/6 + 2π` and (in degrees) `30` are exact multiples, but a float
 * such as `3.14159`, or `π − 10⁻³⁰`, is not.
 *
 * A symbol with an assigned value is replaced by that value.
 *
 * `unit` is the angular unit in which `x` is read, the engine's by default:
 * the exponent of `e^{iθ}` is in radians whatever the engine's unit is.
 */
export function halfTurns(
  x: Expression,
  unit: AngularUnit = x.engine.angularUnit
): [bigint, bigint] | undefined {
  const reduce = (n: bigint, d: bigint): [bigint, bigint] => {
    if (d < 0n) [n, d] = [-n, -d];
    const g = bigGcd(n, d);
    return g > 1n ? [n / g, d / g] : [n, d];
  };
  const exactRational = (y: Expression): [bigint, bigint] | undefined => {
    if (!isNumber(y) || y.isExact !== true) return undefined;
    const r = asRational(y);
    if (r === undefined) return undefined;
    return reduce(BigInt(r[0]), BigInt(r[1]));
  };
  const walk = (y: Expression): [bigint, bigint] | undefined => {
    if (isNumber(y)) {
      const r = exactRational(y);
      if (r === undefined) return undefined;
      // In radians, only 0 is a rational multiple of π.
      if (unit === 'rad') return r[0] === 0n ? [0n, 1n] : undefined;
      if (unit === 'deg') return reduce(r[0], r[1] * 180n);
      if (unit === 'grad') return reduce(r[0], r[1] * 200n);
      if (unit === 'turn') return reduce(2n * r[0], r[1]);
      return undefined;
    }
    if (isSymbol(y)) {
      if (y.symbol === 'Pi') return unit === 'rad' ? [1n, 1n] : undefined;
      if (y.isConstant) return undefined;
      const value = y.value;
      return value === undefined ? undefined : walk(value);
    }
    if (!isFunction(y)) return undefined;
    if (y.operator === 'Negate') {
      const r = walk(y.op1);
      return r === undefined ? undefined : [-r[0], r[1]];
    }
    if (y.operator === 'Add') {
      let n = 0n;
      let d = 1n;
      for (const term of y.ops) {
        const r = walk(term);
        if (r === undefined) return undefined;
        [n, d] = reduce(n * r[1] + r[0] * d, d * r[1]);
      }
      return [n, d];
    }
    if (y.operator === 'Multiply') {
      // Exact rational factors, and exactly one factor that is an angle.
      let n = 1n;
      let d = 1n;
      let angle: [bigint, bigint] | undefined = undefined;
      for (const factor of y.ops) {
        const r = exactRational(factor);
        if (r !== undefined) {
          [n, d] = reduce(n * r[0], d * r[1]);
          continue;
        }
        if (angle !== undefined) return undefined;
        angle = walk(factor);
        if (angle === undefined) return undefined;
      }
      if (angle === undefined) return undefined;
      return reduce(n * angle[0], d * angle[1]);
    }
    if (y.operator === 'Divide') {
      const r = walk(y.op1);
      const q = exactRational(y.op2);
      if (r === undefined || q === undefined || q[0] === 0n) return undefined;
      return reduce(r[0] * q[1], r[1] * q[0]);
    }
    return undefined;
  };
  return walk(x);
}

/**
 * Whether the angle `x` is exactly a pole of `operator`: an odd multiple
 * of a quarter-turn for `Tan` and `Sec`, a multiple of a half-turn for
 * `Cot` and `Csc` (see `halfTurns`).
 */
function isTrigPole(operator: string, x: Expression): boolean {
  const turns = halfTurns(x);
  if (turns === undefined) return false;
  const [n, d] = turns;
  if (operator === 'Tan' || operator === 'Sec')
    return d === 2n && n % 2n !== 0n;
  if (operator === 'Cot' || operator === 'Csc') return d === 1n;
  return false;
}

// Return the quadrant of the angle (1..4) and the position on the
// circle 0...4 corresponding to 0, π/2, π, 3π/2, 2π.
//
// The quadrant is known for an angle that is exactly a rational multiple of
// a half-turn (`halfTurns`: `π/3`, `-5π/4`, `0`, or `90` in degrees), and for
// a number literal. The position is known only for an angle that is exactly
// a multiple of a quarter-turn. For another literal, the quadrant is read
// from its value, in the engine's angular unit, and it is `undefined` when
// that value is too near a multiple of a quarter-turn for the computation to
// decide it. Any other expression has no known quadrant.
//
// Above machine precision, the value is reduced at the working precision,
// as `evaluate()` computes the value of the function: `sin(3.1415926536)`
// is negative, and `sin(10⁻¹⁰)` positive. The literal is exact, and the
// reduction by π has an error of about `|t|·10^−precision`; the margin is
// `max(1, |t|)·10^(3−precision)`. At machine precision, the reduction uses
// machine numbers, and the margin is `(1 + |t|)·10⁻¹⁴`: the conversion of
// the literal to a machine number and the machine value of π each have a
// relative error of about 10⁻¹⁶.
function quadrant(theta: Expression): [number | undefined, number | undefined] {
  const turns = halfTurns(theta);
  if (turns !== undefined) {
    const [n0, d] = turns;
    const n = ((n0 % (2n * d)) + 2n * d) % (2n * d);
    const q = Number((2n * n) / d); // 0..3
    return [q + 1, (2n * n) % d === 0n ? q : undefined];
  }

  if (!theta.isValid || !isNumber(theta)) return [undefined, undefined];
  if (theta.im !== 0) return [undefined, undefined];
  if (!Number.isFinite(theta.re)) return [undefined, undefined];

  const ce = theta.engine;
  const unit = ce.angularUnit;

  if (bignumPreferred(ce)) {
    const value = theta.bignumRe ?? ce.bignum(theta.re);
    // The angle in radians
    const t =
      unit === 'deg'
        ? value.mul(BigDecimal.PI).div(180)
        : unit === 'grad'
          ? value.mul(BigDecimal.PI).div(200)
          : unit === 'turn'
            ? value.mul(BigDecimal.PI.mul(2))
            : value;
    const quarter = BigDecimal.PI.div(2);
    const k = t.div(quarter).floor();
    // The distance of the angle above the multiple `k` of a quarter-turn
    const r = t.sub(quarter.mul(k));
    const at = t.abs();
    const margin = (at.gt(BigDecimal.ONE) ? at : BigDecimal.ONE).mul(
      new BigDecimal(`1e${3 - ce.precision}`)
    );
    if (r.lte(margin) || quarter.sub(r).lte(margin))
      return [undefined, undefined];
    const q = Number(((k.toBigInt() % 4n) + 4n) % 4n);
    return [q + 1, undefined];
  }

  // The angle in radians
  const radians = {
    rad: 1,
    deg: Math.PI / 180,
    grad: Math.PI / 200,
    turn: 2 * Math.PI,
  }[unit];
  const t = theta.re * radians;
  if (!Number.isFinite(t)) return [undefined, undefined];

  // Normalize the angle to the range [0, 2π)
  const normalizedTheta = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  const margin = (1 + Math.abs(t)) * 1e-14;
  for (let k = 0; k <= 4; k++)
    if (Math.abs(normalizedTheta - (k * Math.PI) / 2) <= margin)
      return [undefined, undefined];

  // Use Math.floor to determine the quadrant
  return [Math.floor(normalizedTheta / (Math.PI / 2)) + 1, undefined];
}

/**
 * `Arctan2(y, x)` with at least one INFINITE operand — the IEEE `atan2`
 * values (ruled 2026-09-01), in the engine's current angular unit
 * (`halfTurn` is π rad / 180 deg / 200 grad / 1/2 turn):
 *
 * - both infinite: the diagonal corners `(+∞, +∞) = π/4`,
 *   `(+∞, −∞) = 3π/4`, `(−∞, +∞) = −π/4`, `(−∞, −∞) = −3π/4`;
 * - `x = +∞`: 0; `x = −∞`: `π` for `y ≥ 0`, `−π` for `y < 0`;
 * - `y = ±∞` with a finite `x`: `±π/2`.
 *
 * Three-valued sign discipline: an operand whose sign is not proven
 * (`undefined`) leaves the application symbolic. Only the signed
 * infinities reach here — `~oo` is outside the carrier.
 */
export function arctan2AtInfinity(
  y: Expression,
  x: Expression,
  halfTurn: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const sign = (v: Expression): 1 | -1 | 0 =>
    v.isPositive === true ? 1 : v.isNegative === true ? -1 : 0;
  if (y.isFinite === false && x.isFinite === false) {
    const ySign = sign(y);
    const xSign = sign(x);
    if (ySign === 0 || xSign === 0) return undefined;
    const quarter = halfTurn.div(4);
    const v = xSign > 0 ? quarter : quarter.mul(3);
    return ySign > 0 ? v : v.neg();
  }
  if (x.isFinite === false) {
    if (x.isPositive === true) return ce.Zero;
    if (x.isNegative === true) {
      if (y.isNegative === true) return halfTurn.neg();
      if (y.isNonNegative === true) return halfTurn;
    }
    return undefined;
  }
  // `y = ±∞`, `x` finite.
  if (y.isPositive === true) return halfTurn.div(2);
  if (y.isNegative === true) return halfTurn.div(-2);
  return undefined;
}
