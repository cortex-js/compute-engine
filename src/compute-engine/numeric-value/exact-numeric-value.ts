import { BigDecimal } from '../../big-decimal';

import { Rational, SmallInteger } from '../numerics/types';
import { canonicalInteger, gcd, SMALL_INTEGER } from '../numerics/numeric';
import {
  isOne,
  isZero,
  reducedRational,
  neg,
  isPositive,
  isInteger,
  isNegativeOne,
  rationalAsFloat,
  add,
  mul,
  isMachineRational,
  rationalGcd,
  inverse,
} from '../numerics/rationals';
import {
  ExactNumericValueData,
  NumericValue,
  NumericValueFactory,
} from './types';
import { MathJsonExpression } from '../../math-json/types';
import { numberToExpression } from '../numerics/expression';
import { numberToString } from '../numerics/strings';
import { NumericPrimitiveType } from '../../common/type/types';
import { isSubtype } from '../../common/type/subtype';

/**
 * An ExactNumericValue is the sum of a Gaussian imaginary and the product of
 * a rational number and a square root:
 *
 *     a/b * sqrt(c) + ki where a, b, c and k are integers
 *
 * Note that ExactNumericValue does not "know" about BigNumericValue, but
 * BigNumericValue "knows" about ExactNumericValue.
 *
 */
export class ExactNumericValue extends NumericValue {
  declare __brand: 'ExactNumericValue';

  // NOTE (perf review, P2-5B): these are declared mutable (not `readonly`)
  // and `normalize()` below does mutate them in place. As of this check
  // (2026-07), the *only* call site for `normalize()` in the whole repo is
  // the constructor itself (before `this` escapes to any caller), and no
  // code anywhere assigns to `.rational`/`.radical` directly — so in
  // practice instances are immutable post-construction. That is a
  // convention, not a type-enforced guarantee: nothing stops a future
  // `ev.radical = …` or a new `normalize()` call site from invalidating a
  // cached derived value. `bignumRe` below deliberately stays uncached for
  // that reason — see the note there before memoizing it.
  rational: Rational;
  radical: number; // An integer > 0

  // For exact numeric values, the imaginary part is always 0
  im = 0;

  factory: NumericValueFactory;

  /** The caller is responsible to make sure the input is valid, i.e.
   * - rational is a fraction of integers (but it may not be reduced)
   * - radical is an integer
   */
  constructor(
    value: number | bigint | ExactNumericValueData,
    factory: NumericValueFactory
  ) {
    super();
    this.factory = factory;

    if (typeof value === 'number') {
      console.assert(!Number.isFinite(value) || Number.isInteger(value));
      this.rational = [value, 1];
      this.radical = 1;
      return;
    }

    if (typeof value === 'bigint') {
      this.rational = [value, BigInt(1)];
      this.radical = 1;
      return;
    }

    console.assert(typeof value !== 'object' || !('im' in value));

    const decimal: bigint | number = 1;

    console.assert(typeof decimal !== 'number' || Number.isInteger(decimal));

    if (decimal == 0) {
      this.rational = [0, 1];
      this.radical = 1;
      return;
    }

    let rational: Rational = value.rational
      ? ([...value.rational] as Rational)
      : ([1, 1] as const);
    if (decimal != 1) {
      if (typeof decimal === 'bigint')
        rational = mul(rational, [decimal, BigInt(1)]);
      else rational = mul(rational, [decimal as number, 1]);
    }
    this.rational = rational;

    this.radical = value.radical ?? 1;
    console.assert(this.radical <= SMALL_INTEGER && this.radical >= 1);

    this.normalize();
  }

  get type(): NumericPrimitiveType {
    if (this.isNaN) return 'number';
    // a/b√c -> real number (c can't be a perfect square)
    if (this.isPositiveInfinity || this.isNegativeInfinity)
      return 'non_finite_number';
    if (this.radical !== 1) {
      console.assert(!isZero(this.rational));
      return 'finite_real';
    }
    return isInteger(this.rational) ? 'finite_integer' : 'finite_rational';
  }

  get isExact(): boolean {
    return true;
  }

  get asExact(): NumericValue | undefined {
    return this;
  }

  toJSON(): MathJsonExpression {
    if (this.isNaN) return 'NaN';
    if (this.isPositiveInfinity) return 'PositiveInfinity';
    if (this.isNegativeInfinity) return 'NegativeInfinity';
    if (this.isZero) return 0;
    if (this.isOne) return 1;
    if (this.isNegativeOne) return -1;

    // ExactNumericValue are always real
    // if (this.isComplexInfinity) return 'ComplexInfinity';

    const rationalExpr = (r: Rational) => {
      if (isInteger(r)) return numberToExpression(r[0]);
      return [
        'Rational',
        numberToExpression(r[0]),
        numberToExpression(r[1]),
      ] as MathJsonExpression;
    };

    // Only have a rational
    if (this.radical === 1) return rationalExpr(this.rational);

    // Only have a radical
    if (isOne(this.rational)) return ['Sqrt', this.radical];
    if (isNegativeOne(this.rational)) return ['Negate', ['Sqrt', this.radical]];

    // Have both a radical and a rational

    if (this.rational[0] == 1)
      return [
        'Divide',
        ['Sqrt', this.radical],
        numberToExpression(this.rational[1]),
      ];
    if (this.rational[0] == -1)
      return [
        'Negate',
        [
          'Divide',
          ['Sqrt', this.radical],
          numberToExpression(this.rational[1]),
        ],
      ];

    return ['Multiply', rationalExpr(this.rational), ['Sqrt', this.radical]];
  }

  clone(value: number | ExactNumericValueData): ExactNumericValue {
    return new ExactNumericValue(value, this.factory);
  }

  /** Object.toString() */
  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';

    const rationalStr = (r: Rational) => {
      if (isInteger(r)) return numberToString(r[0]);

      return `${numberToString(r[0])}/${numberToString(r[1])}`;
    };

    // Only have a rational
    if (this.radical === 1) return rationalStr(this.rational);

    const radicalStr = (r: number) => `sqrt(${numberToString(r)})`;

    // Only have a radical
    // 1√b = √b
    if (isOne(this.rational)) return radicalStr(this.radical);
    // -1√b = -√b
    if (isNegativeOne(this.rational)) return `-${radicalStr(this.radical)}`;
    // 1/a√b = √b/a
    if (this.rational[0] == 1)
      return `${radicalStr(this.radical)}/${numberToString(this.rational[1])}`;
    if (this.rational[0] == -1)
      return `-${radicalStr(this.radical)}/${numberToString(this.rational[1])}`;

    // Have both a radical and a rational
    return `${rationalStr(this.rational)}${radicalStr(this.radical)}`;
  }

  get sign(): -1 | 0 | 1 {
    if (isZero(this.rational)) return 0;
    if (isPositive(this.rational)) return 1;
    return -1;
  }

  get re(): number {
    return rationalAsFloat(this.rational) * Math.sqrt(this.radical);
  }

  // NOT memoized (perf review, P2-5B): this recomputes `new
  // BigDecimal(p).div(q)` on every access, which is real but small
  // repeated-conversion overhead. Verified (2026-07): `rational`/`radical`
  // are only ever written by `normalize()`, which itself is only ever
  // called from the constructor — so instances ARE immutable in current
  // practice. But the fields are plain mutable properties, not `readonly`,
  // and `normalize()` is a public method any future caller could invoke
  // again (e.g. from a new call site added elsewhere) — a memo here would
  // go stale silently in that case, with no invalidation hook to catch it.
  // Do not memoize without first making `rational`/`radical` `readonly` (a
  // separate, wider change — this class is constructed pervasively) so the
  // immutability becomes a compiler-checked invariant instead of a
  // convention.
  get bignumRe(): BigDecimal {
    const r = this.rational;
    if (this.radical === 1) {
      if (isMachineRational(r)) return new BigDecimal(r[0]).div(r[1]);
      return new BigDecimal(r[0]).div(new BigDecimal(r[1]));
    }
    // rational × √radical: compute the two rounded factors with guard
    // digits, then round the (exact, ~2P-digit) product back to the working
    // precision. Without the guard the product carried the full unrounded
    // tail — `bignumRe` of (7/3)√3 at precision 100 printed ~200 digits of
    // which only ~103 were correct — and even a rounded product of two
    // P-digit factors is off by up to ~2.5 ulp (Power(2, -1/2) at 2.35 ulp).
    //
    // The output precision is floored at 25 digits: a machine-precision
    // engine sets the global BigDecimal.precision to 15, and rounding the
    // product to 15 digits before its `.toNumber()` conversion corrupted
    // the double (√175 came out 265 ulp off). 25 digits keep the double
    // exact (17 needed) with margin, while still cutting the garbage tail.
    // (CORRECTNESS P2 #17/#21)
    const saved = BigDecimal.precision;
    const outPrec = Math.max(saved, 25);
    BigDecimal.precision = outPrec + 10;
    try {
      const quotient = isMachineRational(r)
        ? new BigDecimal(r[0]).div(r[1])
        : new BigDecimal(r[0]).div(new BigDecimal(r[1]));
      // Fused multiply-and-round: rounds the raw product ONCE to outPrec
      // instead of mul() rounding at the ambient guard precision (outPrec+10)
      // and toPrecision() rounding again. Single rounding is at least as
      // accurate as the previous double rounding (battery-verified vs
      // mpmath), and skips a full-width normalize + digit re-scan.
      return quotient.mulToPrecision(
        new BigDecimal(this.radical).sqrt(),
        outPrec
      );
    } finally {
      BigDecimal.precision = saved;
    }
  }

  get numerator(): ExactNumericValue {
    if (this.rational[1] == 1) return this;
    return this.clone({
      rational: isMachineRational(this.rational)
        ? [this.rational[0], 1]
        : [this.rational[0], BigInt(1)],
      radical: this.radical,
    });
  }

  get denominator(): ExactNumericValue {
    if (isMachineRational(this.rational)) return this.clone(this.rational[1]);
    return this.clone({ rational: [this.rational[1], BigInt(1)] });
  }

  normalize(): void {
    console.assert(
      Number.isInteger(this.radical) &&
        this.radical > 0 &&
        Number.isFinite(this.radical)
    );

    //
    // Note: the order of the operations is significant
    //

    //
    // 1/ Propagate NaN
    //
    if (isNaN(this.radical)) {
      this.rational = [NaN, 1];
      this.radical = 1;
      return;
    }
    // a/0 -> NaN
    const [n, d] = this.rational;
    // Use double equal to catch both number and bigint
    if (d == 0) {
      this.rational = [NaN, 1];
      this.radical = 1;
      return;
    }

    //
    // 2/ Is the rational or radical zero?
    //
    if (this.radical === 0 || n === 0) {
      this.rational = [0, 1];
      this.radical = 1;
      return;
    }

    //
    // 3/ If sqrt is a product of exact square, simplify
    // sqrt(75) = sqrt(25 * 3) = 5 * sqrt(3)
    //
    if (this.radical >= 4) {
      const [factor, root] = canonicalInteger(this.radical, 2);
      if (factor !== 1) this.rational = mul(this.rational, [factor, 1]);
      this.radical = root;
    }

    //
    // 3/ Reduce rational
    //

    this.rational = reducedRational(this.rational);
  }

  get isNaN(): boolean {
    return Number.isNaN(this.rational[0]);
  }

  get isPositiveInfinity(): boolean {
    return this.rational[0] == Infinity;
  }

  get isNegativeInfinity(): boolean {
    return this.rational[0] == -Infinity;
  }

  get isComplexInfinity(): boolean {
    return false;
  }

  get isZero(): boolean {
    return isZero(this.rational);
  }

  get isOne(): boolean {
    if (this.rational[0] !== this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  get isNegativeOne(): boolean {
    if (this.rational[0] !== -this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return true;
  }

  sgn(): -1 | 0 | 1 | undefined {
    if (Number.isNaN(this.rational[0])) return undefined;
    if (isZero(this.rational)) return 0;
    return isPositive(this.rational) ? 1 : -1;
  }

  N(): NumericValue {
    if (this.isZero || this.isOne || this.isNegativeOne) return this;
    if (this.rational[1] == 1 && this.radical === 1) return this;
    return this.factory(this.bignumRe);
  }

  neg(): ExactNumericValue {
    if (this.isZero) return this;
    return this.clone({
      rational: neg(this.rational),
      radical: this.radical,
    });
  }

  inv(): NumericValue {
    // Guard non-finite values before the bigint conversions below — otherwise
    // `BigInt(NaN)` / `BigInt(Infinity)` throw a RangeError.
    if (this.isNaN) return this;
    if (this.isPositiveInfinity || this.isNegativeInfinity)
      return this.clone(0); // 1/±∞ = 0
    if (this.isZero) return this.clone(Infinity); // 1/0 = ∞

    if (this.isOne) return this;
    if (this.isNegativeOne) return this;

    // inv(a/b√c) = b/(a√c) = (b√c)/(ac) = (b/ac)√c

    return this.clone({
      rational: mul(
        [BigInt(this.rational[1]), BigInt(1)],
        inverse([BigInt(this.rational[0]) * BigInt(this.radical), BigInt(1)])
      ),
      radical: this.radical,
    });
  }

  add(other: number | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 0) return this;
      if (Number.isInteger(other) && this.radical === 1)
        return this.clone({
          rational: add(this.rational, [other, 1]),
        });
      return this.factory(this.bignumRe).add(other);
    }
    if (other.isZero) return this;
    if (this.isZero) return other;

    if (!(other instanceof ExactNumericValue)) return other.add(this);

    // Can we keep a rational result?
    // Yes, if both numbers are rational and have the same radical

    if (this.radical === other.radical) {
      return this.clone({
        rational: add(this.rational, other.rational),
        radical: this.radical,
      });
    }

    return this.factory(this.bignumRe).add(other);
  }

  sub(other: NumericValue): NumericValue {
    return this.add(other.neg());
  }

  mul(other: number | BigDecimal | NumericValue): NumericValue {
    if (other === 0) {
      if (this.isPositiveInfinity || this.isNegativeInfinity || this.isNaN)
        return this.clone(NaN);
      return this.clone(0);
    }
    if (other === 1) return this;
    if (other === -1) return this.neg();
    if (typeof other === 'number') {
      if (Number.isInteger(other))
        return this.clone({
          rational: mul(this.rational, [other, 1]),
          radical: this.radical,
        });
      return this.factory(this.bignumRe).mul(other);
    }
    if (other instanceof BigDecimal) return this.factory(other).mul(this);
    if (other.im !== 0) return other.mul(this);

    if (other.isZero) {
      if (this.isPositiveInfinity || this.isNegativeInfinity || this.isNaN)
        return this.clone(NaN);
      return other;
    }
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isNaN) return other;

    if (this.isZero) {
      if (
        other.isPositiveInfinity ||
        other.isNegativeInfinity ||
        other.isComplexInfinity ||
        other.isNaN
      )
        return this.clone(NaN);
      return this;
    }
    if (this.isOne) return other;
    if (this.isNegativeOne) return other.neg();

    if (!(other instanceof ExactNumericValue)) return other.mul(this);

    const radical = BigInt(this.radical) * BigInt(other.radical);
    if (radical > BigInt(SMALL_INTEGER))
      return this.factory(this.bignumRe).mul(other);

    return this.clone({
      rational: mul(this.rational, other.rational),
      radical: Number(radical),
    });
  }

  div(other: SmallInteger | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 1) return this;
      if (other === -1) return this.neg();
      if (other === 0) return this.clone(NaN);
      return this.clone({
        rational: mul(this.rational, [1, other]),
        radical: this.radical,
      });
    }

    if (this.isNaN) return this;
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (this.isZero) {
      if (other.isZero) return this.clone(NaN);
      return other.isNaN ? other : this;
    }
    if (other.isNaN) return other;
    if (other.isZero) return this.clone(this.sign * Infinity);

    if (!(other instanceof ExactNumericValue))
      return this.factory(this.bignumRe).div(other);

    if (other.im !== 0) return this.factory(this.bignumRe).div(other);

    // (a/b √c) / (d/e √f) = (ae/bdf) * √(cf)
    const rational = mul(this.rational, [
      BigInt(other.rational[1]),
      BigInt(other.rational[0]) * BigInt(other.radical),
    ]);

    const radical = BigInt(this.radical) * BigInt(other.radical);
    if (radical > BigInt(SMALL_INTEGER))
      return this.factory(this.bignumRe).div(other);

    return this.clone({ rational, radical: Number(radical) });
  }

  pow(
    exponent: number | NumericValue | { re: number; im: number }
  ): NumericValue {
    console.assert(!Array.isArray(exponent));
    // if (Array.isArray(exponent)) exponent = exponent[0] / exponent[1];

    if (this.isNaN) return this;
    if (typeof exponent === 'number' && isNaN(exponent)) return this.clone(NaN);

    if (exponent instanceof NumericValue) {
      if (exponent.isNaN) return this.clone(NaN);
      if (exponent.isZero) return this.clone(1);
      if (exponent.isOne) return this;
      if (exponent.im) {
        exponent = { re: exponent.re, im: exponent.im };
      } else {
        if (exponent instanceof ExactNumericValue) {
          // Exponent 1/n (numerator rational[0] === 1) ⇒ n-th root, where n is
          // the denominator rational[1] (not the numerator).
          if (exponent.radical === 1 && exponent.rational[0] == 1)
            return this.root(Number(exponent.rational[1]));
        }
        exponent = exponent.re;
      }
    }

    // Special case square root, where we try to preserve the rational part
    if (exponent === 0.5) return this.sqrt();

    //
    // For the special cases we implement the same (somewhat arbitrary) results
    // as sympy. See https://docs.sympy.org/1.6/modules/core.html#pow
    //

    // If the exponent is a complex number, we use the formula:
    // z^w = (r^w) * (cos(wθ) + i * sin(wθ)),
    // where z = r * (cos(θ) + i * sin(θ))

    // Complex Exponent -> float result, use factory
    if (typeof exponent === 'object' && ('re' in exponent || 'im' in exponent))
      return this.factory(this.bignumRe).pow(exponent);

    if (this.isPositiveInfinity) {
      if (exponent === -1) return this.clone(0);
      if (exponent === Infinity) return this.clone(Infinity);
      if (exponent === -Infinity) return this.clone(0);
    } else if (this.isNegativeInfinity && exponent === Infinity)
      return this.clone(NaN);

    if (
      (exponent === Infinity || exponent === -Infinity) &&
      (this.isOne || this.isNegativeOne)
    )
      return this.clone(NaN);

    if (exponent === 1) return this;
    if (exponent === -1) return this.inv();

    if (exponent === 0) return this.clone(1);

    if (this.isZero) {
      if (exponent > 0) return this; // 0^x = 0 when x > 0
      if (exponent < 0) return this.factory({ im: Infinity }); // Complex/unsigned infinity
    }

    if (exponent < 0) return this.pow(-exponent).inv();

    // Is it a multiple of square root?
    // Decompose to try to preserve the rational part
    if (exponent % 1 === 0.5)
      return this.pow(Math.floor(exponent)).mul(this.sqrt());

    // If the parts (rational or radical) are too large, we convert to float
    if (
      this.radical > SMALL_INTEGER ||
      this.rational[0] > SMALL_INTEGER ||
      this.rational[0] < -SMALL_INTEGER ||
      this.rational[1] > SMALL_INTEGER
    )
      return this.factory(this.bignumRe).pow(exponent);

    if (this.sign < 0) {
      if (Number.isInteger(exponent)) {
        const sign = exponent % 2 === 0 ? 1 : -1;
        const bigExp = BigInt(exponent);
        const radical = BigInt(this.radical) ** bigExp;
        if (radical > BigInt(SMALL_INTEGER))
          return this.factory(this.bignumRe).pow(exponent);
        return this.clone({
          rational: [
            BigInt(sign) * (-BigInt(this.rational[0])) ** bigExp,
            BigInt(this.rational[1]) ** bigExp,
          ],
          radical: Number(radical),
        });
      }
      return this.factory({ im: (-this.re) ** exponent });
    } else {
      if (Number.isInteger(exponent)) {
        const bigExp = BigInt(exponent);
        const radical = BigInt(this.radical) ** bigExp;
        if (radical > BigInt(SMALL_INTEGER))
          return this.factory(this.bignumRe).pow(exponent);
        return this.clone({
          rational: [
            BigInt(this.rational[0]) ** bigExp,
            BigInt(this.rational[1]) ** bigExp,
          ],
          radical: Number(radical),
        });
      }
    }
    return this.factory(this.bignumRe).pow(exponent);
  }

  root(exponent: number): NumericValue {
    if (exponent === 0) return this.clone(NaN);

    if (this.isNaN) return this;
    if (this.isZero) return this;
    if (exponent === 1) return this;
    if (exponent === -1) return this.inv();

    if (exponent < 0) return this.root(-exponent).inv();

    // Half-integer exponent n + 1/2: x^(1/(n+1/2)) = x^(2/(2n+1)) =
    // (x²)^(1/(2n+1)), and x² is exact for an ExactNumericValue.
    // (The previous decomposition, `root(⌊exponent⌋).sqrt()`, computed
    // x^(1/(2n)) — mathematically wrong: root(x, 2.5) returned x^(1/4)
    // instead of x^(2/5).) (CORRECTNESS P2 #20)
    if (exponent % 1 === 0.5) return this.pow(2).root(2 * exponent);

    // Odd root of a negative value: real-root convention,
    // (-x)^(1/n) = -(x^(1/n)), preserving exactness (e.g. (-8)^(1/3) = -2)
    if (this.sign < 0 && Number.isInteger(exponent) && exponent % 2 === 1)
      return this.neg().root(exponent).neg();

    if (this.radical === 1) {
      if (this.sign > 0 && Number.isInteger(exponent)) {
        // Exact n-th root of a rational: snap when both the numerator and
        // the denominator are perfect exponent-th powers. Round-then-verify
        // with exact bigint arithmetic, so float dust in Math.pow can
        // neither cause a miss (64^(1/3) = 3.9999999999999996 previously
        // leaked the exact 4 to the float lane) nor a false snap on a
        // near-power (e.g. (10¹⁰+1)² read back through an inexact float).
        // (CORRECTNESS P2 #20)
        const [n, d] = this.rational;
        const rootN = integerNthRoot(n, exponent);
        if (rootN !== null) {
          const rootD = integerNthRoot(d, exponent);
          if (rootD !== null)
            return this.clone({ rational: [rootN, rootD] });
        }
      }
      return this.factory(this.bignumRe).root(exponent);
    }

    if (this.sign < 0)
      return this.factory({ im: Math.pow(-this.re, 1 / exponent) });

    // A radical (≠ 1) never yields an exact n-th root for n ≥ 2 (√radical is
    // already irrational after normalize()), so the value cannot stay exact:
    // use the float lane. (The previous code checked only the numerator for
    // a perfect power and, on a hit, dropped the radical entirely:
    // (8√3)^(1/3) returned 2 instead of 2·3^(1/6) ≈ 2.4019.)
    // (CORRECTNESS P2 #20)
    return this.factory(this.bignumRe).root(exponent);
  }

  sqrt(): NumericValue {
    if (this.isZero || this.isOne) return this;

    // Can we preserve the rational?
    // If radical ≠ 1, we know that √radical is not an integer, or it would
    // have been normalized to the rational part
    if (this.radical === 1) {
      // √(n/d) = √(n/d) = √(nd) / d
      // (if nd is a perfect square, or a product of perfect squares it
      // will get normalized to the rational numerator)
      if (isMachineRational(this.rational)) {
        const [n, d] = this.rational;
        if (n * d > SMALL_INTEGER) return this.factory(this.bignumRe).sqrt();
        if (n > 0) return this.clone({ radical: n * d, rational: [1, d] });

        //
        // Negative Rational: convert to imaginary
        //
        return this.factory({ im: Math.sqrt(-n * d) / d });
      } else {
        // If we have a big rational, we convert to float
        // (we can't keep the radical part)
        return this.factory(this.bignumRe).sqrt();
      }
    }

    if (this.sign > 0) {
      const re = Math.sqrt(this.re);
      if (Number.isInteger(re)) return this.clone(re);
    }
    return this.factory(this.bignumRe).sqrt();
  }

  gcd(other: NumericValue): NumericValue {
    if (!(other instanceof ExactNumericValue)) return other.gcd(this);
    if (this.isOne || other.im !== 0 || other.isOne) return this.clone(1);

    // Calculate the GCD of the rational parts
    const rational = rationalGcd(this.rational, other.rational);
    const radical = gcd(this.radical, other.radical);
    return this.clone({ rational, radical });
  }

  abs(): NumericValue {
    return this.sign === -1 ? this.neg() : this;
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this.clone(NaN);
    if (this.isPositiveInfinity) return this.clone(Infinity);

    if (this.sign < 0) return this.clone(NaN);
    if (this.isOne) return this.clone(0);
    if (this.isNegativeOne) return this.factory({ im: Math.PI });

    return this.factory(this.bignumRe).ln(base);
  }

  exp(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.isZero) return this.clone(1);
    if (this.isNegativeInfinity) return this.clone(0);
    if (this.isPositiveInfinity) return this.clone(Infinity);
    return this.factory(this.bignumRe).exp();
  }

  /**
   * Floor/ceil/round of a pure rational (`radical === 1`) computed exactly with
   * bigints. Routing through `this.re` (a float) would lose digits for
   * integers/rationals larger than 2^53.
   */
  private _integerPart(mode: 'floor' | 'ceil' | 'round'): ExactNumericValue {
    let n = BigInt(this.rational[0]);
    let d = BigInt(this.rational[1]);
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    let q: bigint;
    if (mode === 'round') {
      // Round half toward +∞ (matches JS `Math.round`): floor((2n + d) / (2d)).
      const m = 2n * n + d;
      const dd = 2n * d;
      q = m / dd;
      if (m % dd !== 0n && m < 0n) q -= 1n;
    } else {
      q = n / d; // bigint division truncates toward zero
      const r = n % d;
      if (r !== 0n) {
        if (mode === 'floor' && n < 0n) q -= 1n;
        if (mode === 'ceil' && n > 0n) q += 1n;
      }
    }
    return this.clone({ rational: [q, BigInt(1)], radical: 1 });
  }

  // An exact value is an integer iff it has no radical part and a unit
  // denominator. (`this.type` returns `'finite_integer'`, never `'integer'`.)
  floor(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.radical === 1 && isInteger(this.rational)) return this;
    if (this.radical === 1) return this._integerPart('floor');
    return this.clone(Math.floor(this.re));
  }

  ceil(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.radical === 1 && isInteger(this.rational)) return this;
    if (this.radical === 1) return this._integerPart('ceil');
    return this.clone(Math.ceil(this.re));
  }

  round(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.radical === 1 && isInteger(this.rational)) return this;
    if (this.radical === 1) return this._integerPart('round');
    return this.clone(Math.round(this.re));
  }

  eq(other: number | NumericValue): boolean {
    if (typeof other === 'number')
      return (
        this.radical === 1 &&
        isInteger(this.rational) &&
        this.rational[0] == other
      );
    if (other instanceof ExactNumericValue) {
      return (
        this.radical === other.radical &&
        this.rational[0] == other.rational[0] &&
        this.rational[1] == other.rational[1]
      );
    }
    // Compare against a non-exact `NumericValue` (e.g. a `BigNumericValue`) at
    // working precision via `bignumRe`, mirroring `BigNumericValue.eq`. The
    // previous `other.re === this.re` downcast both operands to a machine float,
    // which made `eq` precision-dependent and *asymmetric* with the bignum path
    // (`1/3` equalled a 30-digit `0.333…` in one direction only) and broke
    // transitivity — isSame is a dedup/matching key, so it must be an
    // equivalence relation (CM-P1-2 / SYMBOLIC P1-9).
    return other.im === 0 && this.bignumRe.eq(other.bignumRe ?? other.re);
  }

  lt(other: number | NumericValue): boolean | undefined {
    // Complex values are unordered: any non-real operand → indeterminate
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.re < other;
    if (other.im !== 0) return undefined;
    return this.re < other.re;
  }

  lte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.re <= other;
    if (other.im !== 0) return undefined;
    return this.re <= other.re;
  }

  gt(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.re > other;
    if (other.im !== 0) return undefined;
    return this.re > other.re;
  }

  gte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.re >= other;
    if (other.im !== 0) return undefined;
    return this.re >= other.re;
  }

  // When using add(), inexact values propagate, i.e. '1.2 + 1/4' -> '1.45'
  // This may not be desirable when adding many values, i.e. '1.2 - 1.2 + 1/4' -> '1/4'
  // Furthermore we may want to keep track of rational and square rational parts
  // i.e. '1.2 + 1/4 + √5 + √7' -> '3/4 + √5 + √7'
  // '1.2 + 1/4 + √5 + √5' -> '3/4 + 2√5'
  static sum(
    values: NumericValue[],
    factory: NumericValueFactory
  ): NumericValue[] {
    if (values.length === 1) return values;

    // A Gaussian integer (notably the imaginary unit `i = 0 + 1i`) is exact even
    // though it is represented as a (non-`ExactNumericValue`) complex value.
    // Treat it as exact here so it does not force the structured sum below into
    // the inexact path — otherwise an exact real summed with it would floatify
    // (`1/2 + i` → `0.5 + i`). The structured path tracks the imaginary part
    // (`imSum`) and the exact real part separately, preserving both.
    const isExactForSum = (x: NumericValue): boolean =>
      x.isExact ||
      (x.im !== 0 && Number.isInteger(x.re) && Number.isInteger(x.im));

    // If we have some genuinely inexact values, just do a simple sum
    if (values.some((x) => !isExactForSum(x))) {
      if (values.length === 2) return [values[0].add(values[1])];
      let sum = factory(0);
      for (const value of values) sum = sum.add(value);
      return [sum];
    }

    //
    // We have only exact values, we need to sum decimal, rational and radical parts
    //
    let imSum = 0;
    let rationalSum: Rational = [0, 1];
    const radicals: { multiple: Rational; radical: number }[] = [];

    for (const value of values) {
      if (value.isNaN) return [new ExactNumericValue(NaN, factory)];
      if (value.isZero) continue;

      imSum += value.im;

      // We have a rational or a radical
      if (value instanceof ExactNumericValue) {
        const rational = value.rational;
        if (value.radical === 1) {
          // Just a fraction, add it to the sum
          rationalSum = add(rationalSum, rational);
        } else {
          // We have a rational and a radical, e.g. 2√5 or (1/3)√7 or √2
          const index = radicals.findIndex((x) => x.radical === value.radical);
          if (index === -1) {
            radicals.push({ multiple: rational, radical: value.radical });
          } else {
            // There was already a radical, add to it, e.g. "√2 + √2" = "2√2"
            radicals[index].multiple = add(radicals[index].multiple, rational);
          }
        }
      } else {
        // A non-`ExactNumericValue` value reaching the exact path is a real
        // integer or a Gaussian integer (its imaginary part was already folded
        // into `imSum` above; here we add its integer real part).
        console.assert(
          isSubtype(value.type, 'integer') ||
            (Number.isInteger(value.re) && Number.isInteger(value.im))
        );
        // Use bignumRe to avoid precision loss for large integers
        const intValue = BigInt(value.bignumRe!.toFixed(0));
        rationalSum = add(rationalSum, [intValue, BigInt(1)]);
      }
    }

    // If we add no additional rational or radical,
    if (isZero(rationalSum) && radicals.length === 0) {
      if (imSum === 0) return [new ExactNumericValue(0, factory)];
      return [factory({ im: imSum })];
    }

    const result: NumericValue[] = [];
    if (imSum !== 0) result.push(factory({ im: imSum }));

    if (radicals.length === 0)
      result.push(new ExactNumericValue({ rational: rationalSum }, factory));
    else {
      // If we have a rational, merge it with the radicals
      radicals.push({ multiple: rationalSum, radical: 1 });
      result.push(
        ...radicals.map(
          (x) =>
            new ExactNumericValue(
              { rational: x.multiple, radical: x.radical },
              factory
            )
        )
      );
    }
    return result;
  }
}

/**
 * Exact integer n-th root: returns the integer r with rⁿ = v exactly, or
 * `null` when v is not a perfect n-th power (or is too large to verify
 * exactly). The float `Math.pow` estimate is only a seed — it and its two
 * neighbors are verified with exact bigint arithmetic, so float rounding can
 * neither cause a miss (Math.pow(64, 1/3) = 3.9999999999999996) nor a false
 * snap on a near-power. (CORRECTNESS P2 #20)
 */
function integerNthRoot(v: number | bigint, n: number): number | null {
  if (typeof v === 'bigint') {
    if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    v = Number(v);
  }
  if (!Number.isSafeInteger(v) || v <= 0) return null;
  if (v === 1) return 1;
  // v ≤ 2^53, so a perfect n-th power with base ≥ 2 requires n ≤ 53 (and
  // this also bounds the bigint exponentiation below).
  if (n > 53) return null;
  const est = Math.round(Math.pow(v, 1 / n));
  const bn = BigInt(n);
  const bv = BigInt(v);
  for (const candidate of [est, est - 1, est + 1]) {
    if (candidate < 2) continue;
    if (BigInt(candidate) ** bn === bv) return candidate;
  }
  return null;
}
