import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';

import type { MathJsonExpression } from '../../math-json/types.js';
import type { LatexString } from '../latex-syntax/types.js';

import { apply } from './apply.js';

import {
  bignumPreferred,
  boxBignumResult,
  canonicalAngle,
  getImaginaryFactor,
} from './utils.js';

import type {
  AngularUnit,
  Expression,
  IComputeEngine as ComputeEngine,
  Sign,
} from '../global-types.js';
import { asLatexString } from '../latex-syntax/utils.js';
import { parse as parseLatex } from '../latex-syntax/latex-syntax.js';
import { isNumber, isSymbol, isFunction } from './type-guards.js';
import { isMachineTrigPole } from '../numerics/numeric.js';
import { gcd as bigGcd } from '../numerics/numeric-bigint.js';
import {
  complexAcos,
  complexAcosh,
  complexAcot,
  complexAcoth,
  complexAcsc,
  complexAcsch,
  complexAsec,
  complexAsech,
  complexAsin,
  complexAsinh,
  complexAtan,
  complexAtanh,
  complexInverse,
  cosSinPiRational,
  reduceHalfTurns,
} from '../numerics/numeric-complex.js';
import { asRational } from './numerics.js';
import { isRealPartZero } from './imaginary-part.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { isZero as isZeroRational } from '../numerics/rationals.js';
import {
  type InverseTrigHead,
  complexInverseTrig,
  isOutsideDoubleRange,
  realInverseTrig,
} from '../numerics/inverse-trig-big.js';

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
      const ca = a[0];
      let ta = a[1];
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
 * With `anyMultiple`, it also applies to an angle with any nonzero multiple
 * of π: at machine precision `applyAngle` uses it so that `sin(π)`,
 * `cos(π/2)` and `cos(2π/3)` are computed from the exact angle, which the
 * big-decimal kernel and `chopBignumDust` reduce to `0`, `0` and `−0.5`,
 * where the double `Math.PI` gives `1.2·10⁻¹⁶`, `6.1·10⁻¹⁷` and
 * `−0.4999999999999998`.
 */
function exactLargeAngle(
  raw: Expression,
  anyMultiple = false
): BigDecimal | undefined {
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
  if (!largeMultiple && !largeRational && !(anyMultiple && cp !== 0n))
    return undefined;

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
          boxBignumResult(ce, big),
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
        const big = exactLargeAngle(raw, true);
        if (big !== undefined) r = bigFn(big);
      } finally {
        BigDecimal.precision = saved;
      }
      // The value is a float, as a value of `.N()` is, even when it is an
      // integer: `sin(π)` is the float `0`.
      if (r instanceof BigDecimal)
        return ce.number(ce._inexactNumericValue(r.toNumber() || 0));
      if (typeof r === 'number')
        return ce.number(ce._inexactNumericValue(r || 0));
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
    !nv.isComplex &&
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
    if (converted !== undefined) return boxBignumResult(ce, converted);
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
  // No part is removed: the inverse kernels give an exact zero imaginary
  // part on their real domain, and a small one is the value
  // (`arcsin(10^{-200}i)` in degrees is `5.7·10^{-199}i`; it was `0`).
  if (!Number.isNaN(n.im) && n.im !== 0)
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
 *
 * The scale is capped at `|x| = 1` on purpose, and the cap is a recorded rule
 * (user decision 2026-09-27): the sine of a float argument is the sine of
 * that float. `\sin(3141592.653589793)`, the double nearest to `10^6·π`, is
 * `−3.8e-19` under both `evaluate()` and `.N()`, because that double is not
 * `10^6·π`; a symbolic multiple of π (`\sin(10^{6}\pi)`) is reduced exactly
 * before any float is formed, so it is `0`. A chop that grew with `|x|`
 * would also chop `\sin(10^{22})`, whose value is `−0.85`, so a larger
 * allowance would need its own cap and would only move the boundary.
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
  // The double of `tp/tq` is 0 when `|tp/tq| ≤ 2⁻¹⁰⁷⁵` (half of the
  // smallest subnormal, which rounds to 0 with ties to even). The test is
  // exact, on the integers: the doubles of `tp` and `tq` can overflow to
  // infinity, and `(10³⁰⁰ + 1)/10⁴⁰⁰` would then read as 0.
  const absP = tp < 0n ? -tp : tp;
  const absQ = tq < 0n ? -tq : tq;
  if (absP << 1075n > absQ) return undefined;
  return tp < 0n !== tq < 0n ? -1 : 1;
}

/** The inverse functions computed by `inverseTrigBigDecimalValue`, and
 * whether each gives an angle (converted to `angularUnit`). */
const INVERSE_TRIG_ANGLE: ReadonlyMap<string, boolean> = new Map([
  ['Arcsin', true],
  ['Arccos', true],
  ['Arctan', true],
  ['Arccot', true],
  ['Arcsec', true],
  ['Arccsc', true],
  ['Arsinh', false],
  ['Arcosh', false],
  ['Artanh', false],
  ['Arcoth', false],
  ['Arsech', false],
  ['Arcsch', false],
]);

/** Digits past the result's that the big-decimal computation carries. */
const OUTSIDE_RANGE_GUARD_DIGITS = 10;

/** A double that is neither zero nor subnormal nor infinite. */
const isNormalDouble = (x: number): boolean =>
  Number.isFinite(x) && Math.abs(x) >= 2.2250738585072014e-308;

/** A double that may be the projection of a part outside the range of a
 * double: zero (underflow), subnormal, or not finite (overflow). */
const mayBeOutside = (x: number): boolean => !isNormalDouble(x);

/** For a real x, whether `name` has a branch cut on the real axis at x, where
 * its value is not real. `|x| = 1` is included in the cut of the heads whose
 * cut ends there, so that a value a hair past 1 that the double rounds to 1
 * is not left out; the caller decides with the big decimal. */
function onRealCut(name: string, x: number): boolean {
  const a = Math.abs(x);
  switch (name) {
    case 'Arcsin':
    case 'Arccos':
    case 'Artanh':
      return a >= 1;
    case 'Arcosh':
      return x <= 1;
    case 'Arccsc':
    case 'Arcsec':
    case 'Arcoth':
      return a <= 1;
    case 'Arsech':
      return x <= 0 || x >= 1;
  }
  return false;
}

/** For a real x, whether the value of `name` at x is not real (and finite). */
function complexOnRealAxis(name: string, x: BigDecimal): boolean {
  const a = x.abs();
  switch (name) {
    case 'Arcsin':
    case 'Arccos':
    case 'Artanh':
      return a.gt(BigDecimal.ONE);
    case 'Arcosh':
      return x.lt(BigDecimal.ONE);
    case 'Arccsc':
    case 'Arcsec':
    case 'Arcoth':
      return a.lt(BigDecimal.ONE) && !x.isZero();
    case 'Arsech':
      return x.isNegative() || x.gt(BigDecimal.ONE);
  }
  return false;
}

/** The arithmetic operators whose exact evaluation on number literals is
 * cheap and has no side effect (no random draw, no assignment). */
const LITERAL_ARITHMETIC = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Rational',
  'Power',
]);

/** The most digits that the exact value of an operand evaluated again by
 * `inverseTrigBigDecimalValue` may have (numerator and denominator). */
const LITERAL_DIGITS_LIMIT = 100_000;

/**
 * `x` is built from number literals with `LITERAL_ARITHMETIC` operators, in
 * at most 64 nodes, and its exact value has at most `LITERAL_DIGITS_LIMIT`
 * digits: its exact evaluation is cheap and deterministic. The digits are
 * bounded from above during the walk: a literal has the digits it prints, a
 * sum or a product at most the sum of the digits of its operands, and a
 * power `b^n` (`n` an integer literal) at most |n| times the digits of `b`.
 * `(10^{1000}+1)^{10000}` has 10⁷ digits, and is not evaluated again.
 */
function isLiteralArithmetic(x: Expression): boolean {
  let nodes = 0;
  // An upper bound of the digits of the exact value of `e`, or `undefined`
  // when `e` is not admitted.
  const digits = (e: Expression): number | undefined => {
    if (++nodes > 64) return undefined;
    if (isNumber(e)) return e.toString().length;
    if (!isFunction(e) || !LITERAL_ARITHMETIC.has(e.operator)) return undefined;
    if (e.operator === 'Power') {
      const n = e.op2;
      if (!isNumber(n) || !Number.isInteger(n.re) || n.im !== 0)
        return undefined;
      const base = digits(e.op1);
      if (base === undefined) return undefined;
      const d = base * Math.max(1, Math.abs(n.re));
      return d > LITERAL_DIGITS_LIMIT ? undefined : d;
    }
    let total = 0;
    for (const op of e.ops) {
      const d = digits(op);
      if (d === undefined) return undefined;
      total += d;
      if (total > LITERAL_DIGITS_LIMIT) return undefined;
    }
    return total;
  };
  return digits(x) !== undefined;
}

/** `x` is not zero, and its double is `0` or `±∞`. */
const beyondDouble = (x: BigDecimal): boolean => {
  if (x.isZero()) return false;
  const d = x.toNumber();
  return d === 0 || !Number.isFinite(d);
};

/** The heads with a branch point at ±1. */
const BRANCH_POINT_AT_ONE = new Set([
  'Arcsin',
  'Arccos',
  'Arcosh',
  'Artanh',
  'Arccsc',
  'Arcsec',
  'Arcoth',
  'Arsech',
]);

/** The most digits added to read an exact real argument next to ±1. */
const BRANCH_POINT_DIGITS_LIMIT = 2000;

/**
 * For a real argument x with |x| ≠ 1, the digits that a big decimal needs,
 * past the working ones, to tell x from ±1 and to keep the digits of the
 * value next to the branch point (`arcosh(1 + d) ≈ √(2d)` is computed from
 * `x − 1`): about −log₁₀(||x| − 1|). `0` when x is not next to ±1. An exact
 * x is read as its rational, an inexact one as its big decimal.
 */
function digitsPastOne(source: Expression): number {
  if (!isNumber(source)) return 0;
  if (source.isExact) {
    const r = asRational(source);
    if (r === undefined) return 0;
    const p = BigInt(r[0]);
    const q = BigInt(r[1]);
    const absP = p < 0n ? -p : p;
    const absQ = q < 0n ? -q : q;
    const d = absP > absQ ? absP - absQ : absQ - absP;
    if (d === 0n) return 0;
    return Math.max(0, absQ.toString().length - d.toString().length);
  }
  const x = source.bignumRe;
  if (x === undefined || !x.isFinite()) return 0;
  const d = x.abs().sub(BigDecimal.ONE);
  if (d.isZero()) return 0;
  const s = d.significand < 0n ? -d.significand : d.significand;
  // |d| = s·10^exponent, so log₁₀|d| is about exponent + digits(s) − 1.
  return Math.max(0, -(d.exponent + s.toString().length - 1));
}

/**
 * The value of an inverse trigonometric or inverse hyperbolic function,
 * computed with big decimals, at:
 * - a number with a part outside the range of a normal double (`10^{400}`,
 *   `10^{-320}`, `2 + 10^{-400}i`). The double kernels read such a part as
 *   `±∞`, `0` or a subnormal double, and give `NaN`, lose digits, or take
 *   the wrong side of a branch cut.
 * - above machine precision, a real number at which the value is not real
 *   (`arcosh(1/2)`, `arcsin(2)`). The complex kernels compute in doubles.
 * - an exact real number next to ±1, a branch point (`1 + 10^{-400}`), which
 *   a big decimal at the working precision, and a double, read as ±1.
 *
 * `undefined` for any other argument and head, after a few tests on the
 * doubles of the operand in the usual case.
 *
 * The operand before its numeric evaluation (`raw`) is read when it is an
 * exact number literal, or, when the numeric operand may have lost a part
 * (at machine precision, `.N()` makes `10^{400}` the double `+∞` and
 * `10^{-400}` the double `0`) or is ±1, when it is built from number
 * literals with arithmetic only (`isLiteralArithmetic`): its exact
 * evaluation is then cheap and draws no random number.
 *
 * A real argument gives a value at the working precision (17 digits, rounded
 * to a double, at machine precision). A complex argument gives a value with
 * the digits of a double, as the complex kernels do at every precision. See
 * `numerics/inverse-trig-big.ts`.
 */
export function inverseTrigBigDecimalValue(
  name: string,
  op: Expression,
  raw: Expression | undefined
): Expression | undefined {
  const isAngle = INVERSE_TRIG_ANGLE.get(name);
  if (isAngle === undefined || !isNumber(op) || op.isNaN) return undefined;
  const ce = op.engine;
  const machine = !bignumPreferred(ce);

  let source: Expression = op;
  if (raw !== undefined && isNumber(raw) && raw.isExact) source = raw;
  else if (raw !== undefined && !isNumber(raw)) {
    const real = !op.isComplex;
    const lost =
      (real && Math.abs(op.re) === 1) ||
      (machine &&
        (mayBeOutside(op.re) ||
          (real ? onRealCut(name, op.re) : mayBeOutside(op.im))));
    if (lost && isLiteralArithmetic(raw)) {
      const exact = raw.evaluate();
      if (isNumber(exact) && exact.isExact) source = exact;
    }
  }
  if (!isNumber(source)) return undefined;

  // The usual case, and a fast exit: parts that are normal doubles are the
  // projections of parts inside the range. A zero imaginary part is a true
  // zero unless the number is complex. Above machine precision a real number
  // on a cut of the real axis continues, and an exact ±1 is read again.
  const sre = source.re;
  const sim = source.im;
  const real = !source.isComplex;
  if (
    isNormalDouble(sre) &&
    (isNormalDouble(sim) || (sim === 0 && real)) &&
    !(real && !machine && onRealCut(name, sre)) &&
    !(
      real &&
      BRANCH_POINT_AT_ONE.has(name) &&
      Math.abs(Math.abs(sre) - 1) < 0.01 &&
      (source.isExact || !machine)
    )
  )
    return undefined;
  // A purely imaginary number inside the range.
  if (
    sre === 0 &&
    isNormalDouble(sim) &&
    (source.bignumRe === undefined || source.bignumRe.isZero())
  )
    return undefined;

  const digits = machine ? 17 : ce.precision;
  const pastOne =
    real && BRANCH_POINT_AT_ONE.has(name) ? digitsPastOne(source) : 0;
  if (pastOne > BRANCH_POINT_DIGITS_LIMIT) return undefined;
  const saved = BigDecimal.precision;
  BigDecimal.precision = digits + pastOne + OUTSIDE_RANGE_GUARD_DIGITS;
  let result: { re: number | BigDecimal; im: number | BigDecimal };
  try {
    // Next to ±1 the exact rational is read again with the added digits
    // (a big decimal read earlier at the working precision is ±1).
    const rational =
      pastOne > 0 && source.isExact ? asRational(source) : undefined;
    const re = rational
      ? new BigDecimal(String(rational[0])).div(
          new BigDecimal(String(rational[1]))
        )
      : (source.bignumRe ?? new BigDecimal(sre));
    const im = source.bignumIm ?? new BigDecimal(sim);
    if (!re.isFinite() || !im.isFinite()) return undefined;
    // An exact part is outside the range below the smallest normal double.
    // An inexact part only when a double cannot hold it at all: a subnormal
    // float is the double the kernels were given (`ce.number(1e-320)`), and
    // stays on them. Inside the range, a real argument at which the value is
    // complex is computed here above machine precision, and a real argument
    // next to ±1 at every precision.
    const outside = source.isExact ? isOutsideDoubleRange : beyondDouble;
    if (
      !outside(re) &&
      !outside(im) &&
      !(real && !machine && complexOnRealAxis(name, re)) &&
      !(real && pastOne > 0)
    )
      return undefined;
    const head = name as InverseTrigHead;
    const value = real
      ? realInverseTrig(head, re)
      : complexInverseTrig(head, re, im);
    if (value === undefined) return undefined;
    // An angle in another unit than radians is converted with the guard
    // digits, before the rounding.
    const unit = ce.angularUnit;
    if (isAngle && unit !== 'rad') {
      const pi = BigDecimal.PI;
      const scale =
        unit === 'deg'
          ? new BigDecimal(180).div(pi)
          : unit === 'grad'
            ? new BigDecimal(200).div(pi)
            : BigDecimal.ONE.div(pi.mul(2));
      value.re = value.re.mul(scale);
      value.im = value.im.mul(scale);
    }
    // A complex argument has the digits of a double: a part that a double
    // holds is a double, and a part outside its range keeps 17 digits.
    const part = (x: BigDecimal): number | BigDecimal => {
      if (machine) return x.toNumber();
      if (real) return x.toPrecision(digits);
      return isOutsideDoubleRange(x) ? x.toPrecision(17) : x.toNumber();
    };
    result = { re: part(value.re), im: part(value.im) };
  } finally {
    BigDecimal.precision = saved;
  }
  return ce.number(ce._inexactNumericValue(result));
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

  const exact =
    hyperbolicOfImaginaryAngle(name, raw) ??
    circularOfExactAngle(ce, name, raw);
  if (exact !== undefined) return exact;

  switch (name) {
    case 'Arccos':
      return inverseAngle(op, Math.acos, (x) => x.acos(), complexAcos);
    case 'Arccot':
      return inverseAngle(
        op,
        (x) => Math.atan2(1, x),
        (x) => BigDecimal.atan2(BigDecimal.ONE, x),
        complexAcot
      );
    case 'Arccsc':
      return inverseAngle(
        op,
        (x) => Math.asin(1 / x),
        (x) => BigDecimal.ONE.div(x).asin(),
        complexAcsc
      );
    // Inverse HYPERBOLIC functions return an area (a dimensionless real),
    // NOT an angle: they are unit-independent and must not be scaled by
    // `angularUnit` (no `radiansToAngle` wrapper).
    case 'Arcosh':
      // For a real x in [−1, 1], arcosh(x) is exactly i·arccos(x) (arccos in
      // radians: an area, not an angle). The real kernels answer NaN there
      // and the complex kernel then left a spurious real part
      // (`N(arcosh(1/2))` was `5.6e-17 + 1.047…i`).
      return apply(
        op,
        (x) =>
          x >= -1 && x < 1 ? new Complex(0, Math.acos(x)) : Math.acosh(x),
        // `BigDecimal.acosh()`, not `ln(x + √(x² − 1))`: the direct formula
        // loses relative precision near 1 and for a large `x`.
        (x) =>
          x.gte(-1) && x.lt(1)
            ? new Complex(0, Number(x.acos().toString()))
            : x.acosh(),
        complexAcosh
      );
    case 'Arcoth':
      // arcoth x = ½·ln((x + 1)/(x − 1)), real for |x| > 1. A ratio near 1
      // (a large |x|) loses digits in the logarithm (`arcoth 10¹⁰⁰` was
      // `0`), so the machine kernel uses ½·log1p(2/(|x| − 1)) with the sign
      // of x, and the big-decimal kernel uses artanh(1/x) for |x| ≥ 2. Both
      // give NaN for |x| < 1, where `apply` then uses the complex kernel.
      return apply(
        op,
        (x) => {
          const r = 0.5 * Math.log1p(2 / (Math.abs(x) - 1));
          return x < 0 ? -r : r;
        },
        (x) =>
          x.abs().gte(BigDecimal.TWO)
            ? BigDecimal.ONE.div(x).atanh()
            : BigDecimal.ONE.add(x)
                .div(x.sub(BigDecimal.ONE))
                .ln()
                .div(BigDecimal.TWO),
        // `complexAcoth()`, not `ln((1+x)/(x−1))/2`: the hand-rolled formula
        // picks the wrong side of the cut for negative real arguments in
        // `(−1, 0)` (imaginary part sign flips).
        complexAcoth
      );

    case 'Arcsch':
      // arcsch x = arsinh(1/x). The formula ln(1/x + √(1/x² + 1)) cancels
      // for a negative x (`arcsch(−10⁻¹⁰⁰)` was `−∞`) and loses digits for a
      // large |x| (`arcsch 10¹⁰⁰` was `0`). Below 10⁻³⁰⁰ in magnitude, `1/x`
      // can overflow: there arsinh(1/x) is ln(2/|x|) with the sign of x, to
      // a relative error of about x².
      return apply(
        op,
        (x) => {
          if (x === 0) return Infinity;
          if (Math.abs(x) < 1e-300) {
            const r = Math.LN2 - Math.log(Math.abs(x));
            return x < 0 ? -r : r;
          }
          return Math.asinh(1 / x);
        },
        (x) => BigDecimal.ONE.div(x).asinh(),
        complexAcsch
      );

    case 'Arcsec':
      return inverseAngle(
        op,
        (x) => Math.acos(1 / x),
        (x) => BigDecimal.ONE.div(x).acos(),
        complexAsec
      );

    case 'Arcsin':
      return inverseAngle(op, Math.asin, (x) => x.asin(), complexAsin);

    case 'Arsech':
      return apply(
        op,
        // arsech x = ln((1 + t)/x) with t = √(1 − x²), real for 0 < x ≤ 1.
        // Near x = 1, ln(1 + t) loses digits, so the machine kernel uses
        // log1p(t) − ln x (two positive terms) and the big-decimal kernel
        // uses arsech x = artanh(t) for x ≥ 1/2. Outside (0, 1] both give
        // NaN, and `apply` then uses the complex kernel.
        (x) => Math.log1p(Math.sqrt((1 - x) * (1 + x))) - Math.log(x),
        (x) =>
          x.gte(BigDecimal.HALF) && x.lte(BigDecimal.ONE)
            ? BigDecimal.ONE.sub(x).mul(BigDecimal.ONE.add(x)).sqrt().atanh()
            : BigDecimal.ONE.sub(x.mul(x))
                .sqrt()
                .add(BigDecimal.ONE)
                .div(x)
                .ln(),
        // `complexAsech()`: the previous inline expression dropped the `sqrt`
        // (computed `ln((2 − x²)/x)`), and `complex-esm`'s `asech` lost
        // digits near ±1 and overflowed for a small |x|.
        complexAsech
      );

    case 'Arsinh':
      return apply(
        op,
        Math.asinh,
        // `BigDecimal.asinh()`, not `ln(x + √(x² + 1))`: the direct formula
        // cancels near 0 (a relative error of 5e-11 at x = 10⁻¹⁰), which
        // breaks the error bound that exact ordering relies on.
        (x) => x.asinh(),
        complexAsinh
      );

    case 'Arctan':
      return inverseAngle(op, Math.atan, (x) => x.atan(), complexAtan);

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
        complexAtanh
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
        (x) => complexInverse(x.tan()),
        raw
      );
    }
    case 'Coth':
      return apply(
        op,
        (x) => 1 / Math.tanh(x),
        (x) => BigDecimal.ONE.div(x.tanh()),
        (x) => complexInverse(x.tanh())
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
        (x) => complexInverse(x.sin()),
        raw
      );
    }
    case 'Csch':
      return apply(
        op,
        (x) => 1 / Math.sinh(x),
        (x) => BigDecimal.ONE.div(x.sinh()),
        (x) => complexInverse(x.sinh())
      );
    case 'Sec':
      // Poles at π/2 + kπ, recognized as for `Cot`.
      if (isTrigPole('Sec', op)) return ce.ComplexInfinity;
      return applyAngle(
        op,
        (x) => poleDust(ce, 1 / Math.cos(x), x),
        (x) => bigPoleDust(ce, BigDecimal.ONE.div(x.cos()), x),
        (x) => complexInverse(x.cos()),
        raw
      );
    case 'Sech':
      return apply(
        op,
        (x) => 1 / Math.cosh(x),
        (x) => BigDecimal.ONE.div(x.cosh()),
        (x) => complexInverse(x.cosh())
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

/** Each trigonometric or hyperbolic function and its inverse, both ways. A
 * `Map`, so a name such as `constructor` does not read an inherited
 * `Object.prototype` member. */
const INVERSE_TRIG_FUNCTION: ReadonlyMap<string, string> = new Map([
  ['Sin', 'Arcsin'],
  ['Cos', 'Arccos'],
  ['Tan', 'Arctan'],
  ['Cot', 'Arccot'],
  ['Sec', 'Arcsec'],
  ['Csc', 'Arccsc'],
  ['Sinh', 'Arsinh'],
  ['Cosh', 'Arcosh'],
  ['Tanh', 'Artanh'],
  ['Coth', 'Arcoth'],
  ['Sech', 'Arsech'],
  ['Csch', 'Arcsch'],
  ['Arcsin', 'Sin'],
  ['Arccos', 'Cos'],
  ['Arctan', 'Tan'],
  ['Arccot', 'Cot'],
  ['Arcsec', 'Sec'],
  ['Arccsc', 'Csc'],
  ['Arsinh', 'Sinh'],
  ['Arcosh', 'Cosh'],
  ['Artanh', 'Tanh'],
  ['Arcoth', 'Coth'],
  ['Arsech', 'Sech'],
  ['Arcsch', 'Csch'],
]);

function inverseTrigFuncName(name: string): string | undefined {
  return INVERSE_TRIG_FUNCTION.get(name);
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
    // An odd function's inverse is odd (`arcsin(−x) = −arcsin(x)`); an even
    // one's inverse, and `Arccot`, take their principal value in (0, π) and
    // reflect about π/2 (`arcsec(−x) = π − arcsec(x)`, `arccot(−1) = 3π/4`,
    // as the numeric kernel `atan2(1, x)` answers), although `cot` is odd.
    quadrant =
      operator !== 'Arccot' && trigFuncParity(inv_operator!) == -1 ? -1 : 1;
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

/**
 * Exact values of the hyperbolic functions at a real number literal, which
 * `constructibleValues` (circular special angles only) does not cover:
 *
 * - at 0: `sinh`, `tanh`, `arsinh`, `artanh` are `0`; `cosh` and `sech` are
 *   `1`; `coth(0)` and `csch(0)` are two-sided poles, `ComplexInfinity`, as
 *   `cot(0)` and `csc(0)` are;
 * - at 1: `arcosh(1)` and `arsech(1)` are `0`;
 * - the literal poles of the inverse functions: `artanh(±1)` and `arcoth(±1)`
 *   are `±∞` (one-sided real poles), `arsech(0)` is `+∞` (approached from the
 *   domain `(0, 1]`), `arcsch(0)` is `ComplexInfinity` (odd, two-sided pole).
 *
 * `Arcosh(0)` and `Arcoth(0)` are `iπ/2` and, like `Arccos(2)`, stay symbolic.
 * Returns `undefined` for any other operator or argument.
 *
 * Both the `evaluate` handler (`library/trigonometry.ts`) and the
 * `constructible value` simplify rule (`symbolic/simplify-rules.ts`) call
 * this, so `evaluate()`, `.N()` and `simplify()` agree.
 */
export function hyperbolicExactValue(
  operator: string,
  x: Expression | undefined
): Expression | undefined {
  if (!isNumber(x) || x.isComplex) return undefined;
  const ce = x.engine;
  switch (operator) {
    case 'Sinh':
    case 'Tanh':
    case 'Arsinh':
      return x.isSame(0) ? ce.Zero : undefined;
    case 'Cosh':
    case 'Sech':
      return x.isSame(0) ? ce.One : undefined;
    case 'Coth':
    case 'Csch':
      return x.isSame(0) ? ce.ComplexInfinity : undefined;
    case 'Artanh':
      if (x.isSame(0)) return ce.Zero;
      if (x.isSame(1)) return ce.PositiveInfinity;
      if (x.isSame(-1)) return ce.NegativeInfinity;
      return undefined;
    case 'Arcoth':
      if (x.isSame(1)) return ce.PositiveInfinity;
      if (x.isSame(-1)) return ce.NegativeInfinity;
      return undefined;
    case 'Arcosh':
      return x.isSame(1) ? ce.Zero : undefined;
    case 'Arsech':
      if (x.isSame(0)) return ce.PositiveInfinity;
      if (x.isSame(1)) return ce.Zero;
      return undefined;
    case 'Arcsch':
      return x.isSame(0) ? ce.ComplexInfinity : undefined;
    default:
      return undefined;
  }
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
 * One float is read as a rational: the coefficient of a product with an
 * angle, such as `0.25` in `0.25·π`, when it is within one unit in the last
 * place of a rational whose denominator is one of the special angles'
 * (`floatSpecialCoefficient`). So `0.25·π` is `1/4` of a half-turn, as
 * `π/4` is, but `0.35·π` is not known.
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
        const r = exactRational(factor) ?? floatSpecialCoefficient(factor);
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
 * The denominators of the special angles of `CONSTRUCTIBLE_VALUES`, as
 * multiples of π: 1, 2, 3, 4, 5, 6, 8, 10 and 12. An angle reduced to the
 * first quadrant keeps a denominator in this set.
 */
const SPECIAL_ANGLE_DENOMINATORS: readonly bigint[] = [
  ...new Set(CONSTRUCTIBLE_VALUES.map(([[, den]]) => BigInt(den))),
].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The rational `p/q`, with `q` a denominator of a special angle
 * (`SPECIAL_ANGLE_DENOMINATORS`), that the float literal `c` rounds: `c` is
 * within one unit in its last place of `p/q`. Return `undefined` when `c`
 * is not a real float, or not near such a rational.
 *
 * A float coefficient of π that is a special angle gives an exact value
 * (user decision, 2026-09-27): `sin(0.25·π)` is `√2/2`, as `sin(π/4)` is.
 * The float has the rounding of the literal only, so `0.25` is `1/4` and
 * the double nearest `0.3` is `3/10`.
 *
 * The unit in the last place is `2⁻⁵²·|c|` at machine precision and
 * `10^(1−precision)·|c|` above it, where a float literal is a big decimal:
 * at 21 digits the double `0.1 + 0.2`, `0.30000000000000004`, is not
 * `3/10`. A float with a unit in the last
 * place of `1/264` or more cannot tell two of these rationals apart (they
 * are at least `1/132` apart), and is not read.
 */
function floatSpecialCoefficient(c: Expression): [bigint, bigint] | undefined {
  if (!isNumber(c) || c.isExact !== false || c.isComplex) return undefined;
  const big = c.bignumRe ?? new BigDecimal(c.re);
  if (!big.isFinite()) return undefined;
  if (big.isZero()) return [0n, 1n];
  const epsilon = bignumPreferred(c.engine)
    ? new BigDecimal(10).pow(1 - c.engine.precision)
    : new BigDecimal(Number.EPSILON);
  const ulp = big.abs().mul(epsilon);
  if (ulp.mul(264).gte(1)) return undefined;
  for (const q of SPECIAL_ANGLE_DENOMINATORS) {
    const scaled = big.mul(new BigDecimal(q));
    const p = scaled.round();
    const error = scaled.sub(p).abs();
    if (error.lte(ulp.mul(new BigDecimal(q)))) {
      const n = p.toBigInt();
      const g = bigGcd(n, q);
      return g > 1n ? [n / g, q / g] : [n, q];
    }
  }
  return undefined;
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
  if (theta.isComplex) return [undefined, undefined];
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

/**
 * The angle `raw` in half-turns, as an exact rational `[p, q]` with `q > 0`:
 * - in radians, an exact rational multiple of π with no other term
 *   (`2π/3` is `[2, 3]`, `10^{20}π` is `[10^{20}, 1]`);
 * - in another angular unit, an exact rational number of units (`30`
 *   degrees is `[1, 6]`).
 * The angle is read by `exactAngleParts`, so a large multiple is exact.
 * Returns `undefined` for any other angle, and for an angle with an unknown.
 */
export function exactHalfTurns(
  raw: Expression,
  unit: AngularUnit = raw.engine.angularUnit
): BigRational | undefined {
  if (cannotBeExactAngle(raw, unit === 'rad')) return undefined;
  if (raw.unknowns.length > 0) return undefined;
  const parts = exactAngleParts(raw);
  if (!parts) return undefined;
  const [c, t] = parts;
  if (unit === 'rad') return t[0] === 0n ? reduceRational(c) : undefined;
  if (c[0] !== 0n) return undefined;
  if (unit === 'deg') return reduceRational([t[0], t[1] * 180n]);
  if (unit === 'grad') return reduceRational([t[0], t[1] * 200n]);
  if (unit === 'turn') return reduceRational([2n * t[0], t[1]]);
  return undefined;
}

/** The rational `p/q` with a positive denominator and no common factor. */
function reduceRational([p, q]: BigRational): BigRational {
  if (q < 0n) [p, q] = [-p, -q];
  const g = bigGcd(p < 0n ? -p : p, q);
  return g > 1n ? [p / g, q / g] : [p, q];
}

/** The operators that `exactAngleParts` reads. */
const EXACT_ANGLE_OPERATORS = new Set([
  'Negate',
  'Add',
  'Multiply',
  'Divide',
  'Power',
]);

/**
 * `true` when `exactHalfTurns` of `x` is certainly `undefined`, found without
 * an allocation, so that an ordinary angle (`sin(2)`, `sin(1/3)`, `sin(√2)`)
 * is rejected at a low cost:
 * - a node that `exactAngleParts` does not read: a float, an operator
 *   other than `Negate`, `Add`, `Multiply`, `Divide` and `Power`, or one of
 *   these with a wrong number of operands. `exactAngleParts` gives
 *   `undefined` for the whole angle when any node gives `undefined`;
 * - in radians (`radians` is `true`), a number literal that is not zero:
 *   it has no π term, and a nonzero rational part is not a multiple of π.
 * A symbol can hold a value, so it is not rejected. `false` means that the
 * full reading is necessary.
 */
function cannotBeExactAngle(
  x: Expression,
  radians: boolean,
  depth = 0
): boolean {
  if (isNumber(x)) {
    if (x.isExact !== true) return true;
    if (!radians) return false;
    const nv = x.numericValue;
    return typeof nv === 'number' ? nv !== 0 : !nv.isZero;
  }
  if (!isFunction(x)) return false;
  const op = x.operator;
  if (!EXACT_ANGLE_OPERATORS.has(op)) return true;
  const n = x.nops;
  if (
    op === 'Negate' ? n !== 1 : (op === 'Divide' || op === 'Power') && n !== 2
  )
    return true;
  // `exactAngleParts` stops at depth 16. Below that, this check gives `false`.
  if (depth >= 16) return false;
  for (const operand of x.ops)
    if (cannotBeExactAngle(operand, false, depth + 1)) return true;
  return false;
}

/**
 * The exact angle `θ` in half-turns for an operand `i·θ` of `e^{iθ}` or of
 * a hyperbolic function, read from the structure of `raw` without building
 * an expression. The result is the result of `exactHalfTurns` in radians of
 * the imaginary factor of `raw` (`getImaginaryFactor`):
 * - a rational `[p, q]`: `raw` is `i·(p/q)·π`, as the product of an exact
 *   imaginary rational literal, `π` and exact rational literals (the
 *   canonical form of `iπ/7` is `Multiply(Complex(0, 1/7), Pi)`);
 * - `undefined`: the slower route also gives `undefined`. This is the case
 *   for a number literal that is not zero, a number literal with a nonzero
 *   real part, and a product of rationals and `i` with no `π`;
 * - `null`: this function cannot decide. The caller then uses
 *   `getImaginaryFactor` and `exactHalfTurns`.
 */
export function imaginaryHalfTurns(
  raw: Expression
): BigRational | undefined | null {
  if (isNumber(raw)) {
    const nv = raw.numericValue;
    // `getImaginaryFactor` gives `undefined` for a nonzero real part. A
    // nonzero imaginary part is a factor with no π term, and only the
    // zero angle is a multiple of π.
    if (!isRealPartZero(nv)) return undefined;
    if (typeof nv !== 'number' && nv.im !== 0) return undefined;
    return null;
  }
  if (!isFunction(raw, 'Multiply')) return null;
  let imaginary: BigRational | undefined;
  let piCount = 0;
  let p = 1n;
  let q = 1n;
  for (const op of raw.ops) {
    if (isSymbol(op, 'Pi')) {
      piCount += 1;
      continue;
    }
    if (!isNumber(op) || op.isExact !== true) return null;
    const nv = op.numericValue;
    let r: BigRational;
    if (typeof nv === 'number') {
      // An integer: a real factor
      if (!Number.isInteger(nv) || nv === 0) return null;
      r = [BigInt(nv), 1n];
    } else {
      if (!(nv instanceof ExactNumericValue) || nv.radical !== 1) return null;
      if (isZeroRational(nv.rational)) {
        // An imaginary factor `bi`, with `b` an exact nonzero rational
        if (!op.isComplex || nv.imRadical !== 1) return null;
        if (imaginary !== undefined) return null;
        imaginary = [BigInt(nv.imRational[0]), BigInt(nv.imRational[1])];
        if (imaginary[0] === 0n) return null;
        r = imaginary;
      } else {
        // A real factor: an exact nonzero rational
        if (nv.isComplex) return null;
        r = [BigInt(nv.rational[0]), BigInt(nv.rational[1])];
      }
    }
    p *= r[0];
    q *= r[1];
  }
  if (imaginary === undefined || piCount > 1) return null;
  // With no π, `θ` is a nonzero rational: not a multiple of π.
  if (piCount === 0) return undefined;
  return reduceRational([p, q]);
}

/**
 * `cos(πp/q)` and `sin(πp/q)` for an exact rational `p/q`: doubles at
 * machine precision (`cosSinPiRational()`), big decimals at the working
 * precision above it. The angle is reduced with bigints to `n·(π/2) + t·π`
 * with `|t| ≤ 1/4`, so any multiple of π is exact, and at `t = 0`, `±1/4` and
 * `±1/6` the value is computed from `1`, `√2/2`, `√3/2` and `1/2`: `cos(π/2)`
 * is `0` and `cos(2π/3)` is `−0.5`, with no rounding of π.
 */
function cosSinHalfTurns(
  ce: ComputeEngine,
  [p, q]: BigRational,
  /** The values that the caller reads. A big-decimal value that is not
   * read is not computed, and is `0` in the result. */
  need: 'cos' | 'sin' | 'both' = 'both'
): [number, number] | [BigDecimal, BigDecimal] {
  if (!bignumPreferred(ce)) return cosSinPiRational(p, q);
  const {
    n,
    t: [tn, td],
  } = reduceHalfTurns(p, q);
  const at = tn < 0n ? -tn : tn;
  // The cosine of `t·π` gives the value read when `need` is `cos` and `n` is
  // even, or `need` is `sin` and `n` is odd: `cos(nπ/2 + tπ)` and
  // `sin(nπ/2 + tπ)` are `±cos(tπ)` or `±sin(tπ)`.
  const odd = n === 1 || n === 3;
  const needC = need === 'both' || (need === 'cos') !== odd;
  const needS = need === 'both' || (need === 'sin') !== odd;
  let c: BigDecimal = BigDecimal.ZERO;
  let s: BigDecimal = BigDecimal.ZERO;
  if (tn === 0n) {
    c = BigDecimal.ONE;
    s = BigDecimal.ZERO;
  } else if (at * 4n === td) {
    c = BigDecimal.TWO.sqrt().div(BigDecimal.TWO);
    s = tn < 0n ? c.neg() : c;
  } else if (at * 6n === td) {
    if (needC) c = new BigDecimal(3).sqrt().div(BigDecimal.TWO);
    s = tn < 0n ? BigDecimal.HALF.neg() : BigDecimal.HALF;
  } else {
    const angle = BigDecimal.PI.mul(new BigDecimal(tn)).div(new BigDecimal(td));
    if (needC) c = angle.cos();
    if (needS) s = angle.sin();
  }
  if (n === 0) return [c, s];
  if (n === 1) return [s.neg(), c];
  if (n === 2) return [c.neg(), s.neg()];
  return [s, c.neg()];
}

/** A zero of either kind of number. */
function isZeroPart(x: number | BigDecimal): boolean {
  return typeof x === 'number' ? x === 0 : x.isZero();
}

/** `−x` and `1/x` for a double or a big decimal. */
function negPart(x: number | BigDecimal): number | BigDecimal {
  return typeof x === 'number' ? -x : x.neg();
}
function divPart(
  a: number | BigDecimal,
  b: number | BigDecimal
): number | BigDecimal {
  if (typeof a === 'number' && typeof b === 'number') return a / b;
  const big = (x: number | BigDecimal) =>
    typeof x === 'number' ? new BigDecimal(x) : x;
  return big(a).div(big(b));
}

/** Box a complex value whose parts are doubles or big decimals, as a float. */
function boxParts(
  ce: ComputeEngine,
  re: number | BigDecimal,
  im: number | BigDecimal
): Expression {
  return ce.number(
    ce._inexactNumericValue({
      re: isZeroPart(re) ? 0 : re,
      im: isZeroPart(im) ? 0 : im,
    })
  );
}

/**
 * The numeric value of `e^{iθ}`, `cos θ + i·sin θ`, as a float, when `θ` is
 * an exact rational multiple of π (`exactHalfTurns` in radians): `e^{iπ}` is
 * `−1`, `e^{2iπ/3}` is `−0.5 + 0.866i`, `e^{i·10^{20}π}` is `1`. Returns
 * `undefined` for any other `θ`.
 */
export function exactUnitCircle(theta: Expression): Expression | undefined {
  const turns = exactHalfTurns(theta, 'rad');
  if (turns === undefined) return undefined;
  return unitCircleOfHalfTurns(theta.engine, turns);
}

/** `e^{iπp/q}`, `cos(πp/q) + i·sin(πp/q)`, as a float. */
export function unitCircleOfHalfTurns(
  ce: ComputeEngine,
  turns: BigRational
): Expression {
  const [c, s] = cosSinHalfTurns(ce, turns);
  return boxParts(ce, c, s);
}

/** The circular functions that `circularOfExactAngle` computes. */
const CIRCULAR_HEADS = new Set(['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc']);

/**
 * At machine precision, the value of a circular function of an exact angle
 * that is a rational number of half-turns (`exactHalfTurns`): `sin(π)` is
 * `0`, `cos(2π/3)` is `−0.5`, `tan(π/2)` is `~oo`. The angle is reduced with
 * bigints and the value computed in doubles (`cosSinPiRational()`), with no
 * big-decimal kernel. Returns `undefined` for any other function or angle.
 */
function circularOfExactAngle(
  ce: ComputeEngine,
  name: string,
  raw: Expression | undefined
): Expression | undefined {
  if (raw === undefined || !CIRCULAR_HEADS.has(name) || bignumPreferred(ce))
    return undefined;
  if (!(raw.isCanonical || raw.isStructural)) return undefined;
  const turns = exactHalfTurns(raw);
  if (turns === undefined) return undefined;
  const [c, s] = cosSinPiRational(turns[0], turns[1]);
  let v: number;
  switch (name) {
    case 'Sin':
      v = s;
      break;
    case 'Cos':
      v = c;
      break;
    case 'Tan':
      if (c === 0) return ce.ComplexInfinity;
      v = s / c;
      break;
    case 'Cot':
      if (s === 0) return ce.ComplexInfinity;
      v = c / s;
      break;
    case 'Sec':
      if (c === 0) return ce.ComplexInfinity;
      v = 1 / c;
      break;
    default:
      if (s === 0) return ce.ComplexInfinity;
      v = 1 / s;
  }
  return ce.number(ce._inexactNumericValue(v === 0 ? 0 : v));
}

/**
 * The value of a hyperbolic function of `i·θ` from the circular functions
 * of `θ`, as `[re, im]`, or `'pole'`: `sinh(iθ) = i·sin θ`,
 * `cosh(iθ) = cos θ`, `tanh(iθ) = i·tan θ`, `csch(iθ) = −i·csc θ`,
 * `sech(iθ) = sec θ`, `coth(iθ) = −i·cot θ`.
 */
const HYPERBOLIC_OF_IMAGINARY: Record<
  string,
  (
    c: number | BigDecimal,
    s: number | BigDecimal
  ) => [number | BigDecimal, number | BigDecimal] | 'pole'
> = {
  Sinh: (_c, s) => [0, s],
  Cosh: (c) => [c, 0],
  Tanh: (c, s) => (isZeroPart(c) ? 'pole' : [0, divPart(s, c)]),
  Csch: (_c, s) => (isZeroPart(s) ? 'pole' : [0, negPart(divPart(1, s))]),
  Sech: (c) => (isZeroPart(c) ? 'pole' : [divPart(1, c), 0]),
  Coth: (c, s) => (isZeroPart(s) ? 'pole' : [0, negPart(divPart(c, s))]),
};

/** The circular functions of `θ` that each entry of
 * `HYPERBOLIC_OF_IMAGINARY` reads. */
const HYPERBOLIC_OF_IMAGINARY_NEEDS: Record<string, 'cos' | 'sin' | 'both'> = {
  Sinh: 'sin',
  Cosh: 'cos',
  Tanh: 'both',
  Csch: 'sin',
  Sech: 'cos',
  Coth: 'both',
};

/**
 * The numeric value of a hyperbolic function of `i·θ`, with `θ` an EXACT
 * rational multiple of π (`exactHalfTurns` in radians), from the circular
 * functions of the exact angle (`HYPERBOLIC_OF_IMAGINARY`): `sinh(iπ)` and
 * `cosh(iπ/2)` are `0`, and `tanh(iπ/2)`, `coth(iπ)`, `csch(iπ)` and
 * `sech(iπ/2)` are `~oo`. The complex kernel at the double nearest to `iπ`
 * gave `1.2·10⁻¹⁶i` and `6.1·10⁻¹⁷` for the first two, `NaN` and very large
 * values for the poles. `raw` is the operand before its numeric evaluation.
 * Returns `undefined` for any other function or operand.
 */
function hyperbolicOfImaginaryAngle(
  name: string,
  raw: Expression | undefined
): Expression | undefined {
  const value = HYPERBOLIC_OF_IMAGINARY[name];
  if (value === undefined || raw === undefined) return undefined;
  if (!(raw.isCanonical || raw.isStructural)) return undefined;
  // The structure is read first, with no expression built
  // (`imaginaryHalfTurns`); `null` means it could not decide.
  let turns = imaginaryHalfTurns(raw);
  if (turns === null) {
    const theta = getImaginaryFactor(raw);
    if (theta === undefined) return undefined;
    turns = exactHalfTurns(theta, 'rad');
  }
  if (turns === undefined) return undefined;
  const ce = raw.engine;
  const [c, s] = cosSinHalfTurns(
    ce,
    turns,
    HYPERBOLIC_OF_IMAGINARY_NEEDS[name]
  );
  const result = value(c, s);
  if (result === 'pole') return ce.ComplexInfinity;
  return boxParts(ce, result[0], result[1]);
}
