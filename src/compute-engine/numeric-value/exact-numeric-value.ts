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

// Shared frozen zero imaginary component: real values (the overwhelmingly
// common case) all point to this singleton, so no per-instance allocation is
// made for the imaginary part. NEVER mutate its elements (it is frozen; the
// fields referencing it are only ever *reassigned* by `normalize()`).
const ZERO_IM_RATIONAL: Rational = Object.freeze([0, 1]) as unknown as Rational;

/** An exact component: a rational multiple of the square root of a positive
 * integer. Used for the per-component arithmetic of complex exact values. */
type ExactComponent = { rat: Rational; rad: number };

/**
 * An ExactNumericValue is the sum of two components, each the product of a
 * rational number and a square root of an integer:
 *
 *     (a/b)·√c + (k/l)·√m · i   where a, b, c, k, l, m are integers
 *
 * The representable set is restricted (see `ExactNumericValueData`):
 * - real values: any `(a/b)·√c` (the imaginary component is 0);
 * - Gaussian rationals: both radicals are 1 (e.g. `2+3i`, `1/2-5i/3`);
 * - pure-imaginary radicals: the real component is 0 (e.g. `√2·i`).
 *
 * A value that would need a radical on both non-zero components (e.g.
 * `√2 + √3·i`) is NOT representable: operations whose result leaves the set
 * fall back to the (inexact) float lane via `factory`, exactly as real
 * radical operations do when radicals are incompatible.
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
  // code anywhere assigns to `.rational`/`.radical` (or the `im*` fields)
  // directly — so in practice instances are immutable post-construction.
  // That is a convention, not a type-enforced guarantee: nothing stops a
  // future `ev.radical = …` or a new `normalize()` call site from
  // invalidating a cached derived value. `bignumRe` below deliberately
  // stays uncached for that reason — see the note there before memoizing
  // it. (The `im` field IS a cached derived value — it is only written by
  // the constructor/`normalize()`, consistent with the convention above.)
  //
  // Hidden-class note: all fields are initialized for every instance in the
  // same order (field initializers + constructor), so all instances share a
  // single shape regardless of whether they are real or complex.
  rational: Rational;
  radical: number; // An integer > 0

  // Cached machine value of the imaginary part (0 for real values): the
  // read path of `.im` is a plain data-field load, never a conversion.
  im = 0;

  // The exact imaginary component: imRational · √imRadical.
  // For real values these stay at the shared frozen defaults (no
  // per-instance allocation on the real path).
  imRational: Rational = ZERO_IM_RATIONAL;
  imRadical: number = 1; // An integer > 0

  factory: NumericValueFactory;

  /** The caller is responsible to make sure the input is valid, i.e.
   * - rational is a fraction of integers (but it may not be reduced)
   * - radical is an integer
   * - the value is in the representable set (Gaussian rational, or a
   *   single-radical pure form — see the class comment)
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

    if (value.imRational !== undefined || value.imRadical !== undefined) {
      this.imRational = value.imRational
        ? ([...value.imRational] as Rational)
        : ([1, 1] as const);
      this.imRadical = value.imRadical ?? 1;
      console.assert(this.imRadical <= SMALL_INTEGER && this.imRadical >= 1);
    }

    this.normalize();
  }

  get type(): NumericPrimitiveType {
    if (this.isNaN) return 'number';
    // a/b√c -> real number (c can't be a perfect square)
    if (this.isPositiveInfinity || this.isNegativeInfinity)
      return 'non_finite_number';
    if (this.im !== 0)
      return isZero(this.rational) ? 'imaginary' : 'finite_complex';
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

    // Complex exact value: serialize as `['Complex', re, im]` where each
    // component uses the same exact shapes as the real serialization below.
    // This is lossless: boxing `['Complex', …]` with exact components
    // reconstructs the same exact value (see the `Complex` handling in
    // `box.ts`), so `ce.expr(x.json).isSame(x)` holds.
    if (this.im !== 0)
      return [
        'Complex',
        isZero(this.rational)
          ? 0
          : componentToExpression(this.rational, this.radical),
        componentToExpression(this.imRational, this.imRadical),
      ];

    return componentToExpression(this.rational, this.radical);
  }

  clone(value: number | ExactNumericValueData): ExactNumericValue {
    return new ExactNumericValue(value, this.factory);
  }

  /** Object.toString() */
  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';

    if (this.im !== 0) {
      // Complex exact value
      const imPart = componentToString(this.imRational, this.imRadical);
      const imStr =
        imPart === '1' ? 'i' : imPart === '-1' ? '-i' : `${imPart}i`;
      if (isZero(this.rational)) return imStr;
      const rePart = componentToString(this.rational, this.radical);
      if (imStr.startsWith('-')) return `(${rePart} - ${imStr.slice(1)})`;
      return `(${rePart} + ${imStr})`;
    }

    return componentToString(this.rational, this.radical);
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
    // A complex value is its own numerator (mirrors MachineNumericValue)
    if (this.im !== 0) return this;
    if (this.rational[1] == 1) return this;
    return this.clone({
      rational: isMachineRational(this.rational)
        ? [this.rational[0], 1]
        : [this.rational[0], BigInt(1)],
      radical: this.radical,
    });
  }

  get denominator(): ExactNumericValue {
    if (this.im !== 0) return this.clone(1);
    if (isMachineRational(this.rational)) return this.clone(this.rational[1]);
    return this.clone({ rational: [this.rational[1], BigInt(1)] });
  }

  /** The float-lane representation of this value (used when an operation
   * result leaves the exact representable set). */
  private _toFloat(): NumericValue {
    if (this.im === 0) return this.factory(this.bignumRe);
    return this.factory({ re: this.bignumRe, im: this.im });
  }

  /** Lift a Gaussian-integer value from the inexact lane (e.g. the machine
   * complex `i` constant, `3i`) to an exact value, so mixed exact/Gaussian
   * arithmetic stays exact (`√2·i`, `1/2 + i`). Returns `null` when the
   * components are not exactly-representable integers. */
  private _liftComplex(other: NumericValue): ExactNumericValue | null {
    if (Number.isSafeInteger(other.re) && Number.isSafeInteger(other.im))
      return this.clone({
        rational: [other.re, 1],
        imRational: [other.im, 1],
      });
    return null;
  }

  normalize(): void {
    console.assert(
      Number.isInteger(this.radical) &&
        this.radical > 0 &&
        Number.isFinite(this.radical)
    );

    //
    // 0/ Normalize the imaginary component. Real values (the common case)
    // exit on a single pointer comparison against the shared zero singleton.
    //
    if (this.imRational !== ZERO_IM_RATIONAL || this.imRadical !== 1)
      this._normalizeIm();

    //
    // Note: the order of the operations is significant
    //

    //
    // 1/ Propagate NaN
    //
    if (isNaN(this.radical)) {
      this.rational = [NaN, 1];
      this.radical = 1;
      if (this.im !== 0) this._clearIm();
      return;
    }
    // a/0 -> NaN
    const [n, d] = this.rational;
    // Use double equal to catch both number and bigint
    if (d == 0) {
      this.rational = [NaN, 1];
      this.radical = 1;
      if (this.im !== 0) this._clearIm();
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

    // Representable-set invariant: a value with BOTH non-zero components can
    // carry no radical on either. (Callers must check before constructing.)
    // The assert is gated on `im !== 0` so the real-value hot path pays
    // nothing for it in from-source (assert-live) runs: when `im === 0` the
    // invariant holds vacuously.
    if (this.im !== 0)
      console.assert(
        !Number.isFinite(this.rational[0] as number) ||
          (this.radical === 1 && this.imRadical === 1)
      );
  }

  /** Reset the imaginary component to (the shared) zero. */
  private _clearIm(): void {
    this.imRational = ZERO_IM_RATIONAL;
    this.imRadical = 1;
    this.im = 0;
  }

  /** Normalize the imaginary component (`imRational · √imRadical`) and cache
   * its machine value in `im`. A NaN/non-finite imaginary component makes the
   * whole value NaN (the exact lane has no complex-infinity representation).
   */
  private _normalizeIm(): void {
    console.assert(
      Number.isInteger(this.imRadical) &&
        this.imRadical >= 0 &&
        Number.isFinite(this.imRadical)
    );
    const [n, d] = this.imRational;
    // NaN or non-finite components propagate to NaN
    if (
      isNaN(this.imRadical) ||
      d == 0 ||
      (typeof n === 'number' && !Number.isFinite(n))
    ) {
      this.rational = [NaN, 1];
      this.radical = 1;
      this._clearIm();
      return;
    }
    if (this.imRadical === 0 || n === 0) {
      this._clearIm();
      return;
    }
    if (this.imRadical >= 4) {
      const [factor, root] = canonicalInteger(this.imRadical, 2);
      if (factor !== 1) this.imRational = mul(this.imRational, [factor, 1]);
      this.imRadical = root;
    }
    this.imRational = reducedRational(this.imRational);
    this.im =
      rationalAsFloat(this.imRational) *
      (this.imRadical === 1 ? 1 : Math.sqrt(this.imRadical));
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
    return this.im === 0 && isZero(this.rational);
  }

  get isOne(): boolean {
    if (this.rational[0] !== this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return this.im === 0;
  }

  get isNegativeOne(): boolean {
    if (this.rational[0] !== -this.rational[1]) return false;
    if (this.radical !== 1) return false;
    return this.im === 0;
  }

  sgn(): -1 | 0 | 1 | undefined {
    // The sign of a complex value is undefined
    if (this.im !== 0) return undefined;
    if (Number.isNaN(this.rational[0])) return undefined;
    if (isZero(this.rational)) return 0;
    return isPositive(this.rational) ? 1 : -1;
  }

  N(): NumericValue {
    if (this.isZero || this.isOne || this.isNegativeOne) return this;
    if (this.im === 0) {
      if (this.rational[1] == 1 && this.radical === 1) return this;
      return this.factory(this.bignumRe);
    }
    // A Gaussian integer is its own float representation (mirroring the
    // real-integer case above); other complex values go to the float lane.
    if (
      this.rational[1] == 1 &&
      this.radical === 1 &&
      this.imRational[1] == 1 &&
      this.imRadical === 1
    )
      return this;
    return this._toFloat();
  }

  neg(): ExactNumericValue {
    if (this.im === 0) {
      if (this.isZero) return this;
      return this.clone({
        rational: neg(this.rational),
        radical: this.radical,
      });
    }
    return this.clone({
      rational: isZero(this.rational) ? this.rational : neg(this.rational),
      radical: this.radical,
      imRational: neg(this.imRational),
      imRadical: this.imRadical,
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

    if (this.im !== 0) {
      if (isZero(this.rational)) {
        // Pure imaginary: 1/(q√r·i) = −(1/(q·r))·√r·i
        const [a, b] = this.imRational;
        return this.clone({
          rational: [0, 1],
          imRational: neg(
            mul(
              [BigInt(b), BigInt(1)],
              inverse([BigInt(a) * BigInt(this.imRadical), BigInt(1)])
            )
          ),
          imRadical: this.imRadical,
        });
      }
      // Gaussian rational (both radicals are 1 by the set invariant):
      // 1/(a+bi) = (a − bi)/(a² + b²)
      const a = this.rational;
      const b = this.imRational;
      const invNorm = inverse(add(mul(a, a), mul(b, b)));
      return this.clone({
        rational: mul(a, invNorm),
        imRational: neg(mul(b, invNorm)),
        imRadical: 1,
      });
    }

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
      if (this.im === 0) {
        if (Number.isInteger(other) && this.radical === 1)
          return this.clone({
            rational: add(this.rational, [other, 1]),
          });
        return this.factory(this.bignumRe).add(other);
      }
      // Complex + machine number: exact only for an integer added to a
      // Gaussian rational (an integer next to a pure-imaginary radical would
      // put a radical-free real component beside an im radical — that IS in
      // the set only when imRadical is 1, which the check covers).
      if (Number.isInteger(other) && this.radical === 1 && this.imRadical === 1)
        return this.clone({
          rational: add(this.rational, [other, 1]),
          imRational: this.imRational,
          imRadical: 1,
        });
      return this._toFloat().add(other);
    }
    if (other.isZero) return this;
    if (this.isZero) return other;

    if (!(other instanceof ExactNumericValue)) {
      // A Gaussian integer from the inexact lane is exactly representable:
      // lift it so the sum stays exact (`1/2 + i` → the exact `1/2 + i`)
      if (other.im !== 0) {
        const lifted = this._liftComplex(other);
        if (lifted !== null) return this.add(lifted);
      }
      return other.add(this);
    }

    if (this.im === 0 && other.im === 0) {
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

    // At least one operand is complex: combine per-component; fall back to
    // the float lane when a component pair is incompatible or the result
    // leaves the representable set (mirroring the real radical rule above).
    const re = addComponents(
      { rat: this.rational, rad: this.radical },
      { rat: other.rational, rad: other.radical }
    );
    if (re !== null) {
      const im = addComponents(
        { rat: this.imRational, rad: this.imRadical },
        { rat: other.imRational, rad: other.imRadical }
      );
      if (im !== null && componentsInSet(re, im))
        return this.clone({
          rational: re.rat,
          radical: re.rad,
          imRational: im.rat,
          imRadical: im.rad,
        });
    }
    return this._toFloat().add(other);
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
      if (Number.isInteger(other)) {
        if (this.im === 0)
          return this.clone({
            rational: mul(this.rational, [other, 1]),
            radical: this.radical,
          });
        // Integer scaling stays in the representable set
        return this.clone({
          rational: mul(this.rational, [other, 1]),
          radical: this.radical,
          imRational: mul(this.imRational, [other, 1]),
          imRadical: this.imRadical,
        });
      }
      if (this.im === 0) return this.factory(this.bignumRe).mul(other);
      return this._toFloat().mul(other);
    }
    if (other instanceof BigDecimal) return this.factory(other).mul(this);
    // A Gaussian integer from the inexact lane (e.g. the `i` constant) is
    // exactly representable: lift it so the product stays exact (`√2·i`,
    // `3·i`). Other complex machine/big values know how to multiply by
    // `this`; an exact complex `other` is handled by the exact section below.
    if (other.im !== 0 && !(other instanceof ExactNumericValue)) {
      const lifted = this._liftComplex(other);
      if (lifted === null) return other.mul(this);
      other = lifted;
    }

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

    if (this.im === 0 && other.im === 0) {
      const radical = BigInt(this.radical) * BigInt(other.radical);
      if (radical > BigInt(SMALL_INTEGER))
        return this.factory(this.bignumRe).mul(other);

      return this.clone({
        rational: mul(this.rational, other.rational),
        radical: Number(radical),
      });
    }

    // At least one operand is complex:
    // (A + B·i)(C + D·i) = (AC − BD) + (AD + BC)·i, per-component.
    // Falls back to the float lane when a component product or sum is not
    // representable (incompatible radicals / radical too large), mirroring
    // the real radical rule above.
    const A: ExactComponent = { rat: this.rational, rad: this.radical };
    const B: ExactComponent = { rat: this.imRational, rad: this.imRadical };
    const C: ExactComponent = { rat: other.rational, rad: other.radical };
    const D: ExactComponent = { rat: other.imRational, rad: other.imRadical };

    const AC = mulComponents(A, C);
    const BD = mulComponents(B, D);
    const AD = mulComponents(A, D);
    const BC = mulComponents(B, C);
    if (AC !== null && BD !== null && AD !== null && BC !== null) {
      const re = addComponents(AC, negComponent(BD));
      const im = addComponents(AD, BC);
      if (re !== null && im !== null && componentsInSet(re, im))
        return this.clone({
          rational: re.rat,
          radical: re.rad,
          imRational: im.rat,
          imRadical: im.rad,
        });
    }
    return this._toFloat().mul(other);
  }

  div(other: SmallInteger | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 1) return this;
      if (other === -1) return this.neg();
      if (other === 0) return this.clone(NaN);
      if (this.im === 0)
        return this.clone({
          rational: mul(this.rational, [1, other]),
          radical: this.radical,
        });
      // Integer scaling stays in the representable set
      return this.clone({
        rational: mul(this.rational, [1, other]),
        radical: this.radical,
        imRational: mul(this.imRational, [1, other]),
        imRadical: this.imRadical,
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
    if (other.isZero) {
      if (this.im !== 0) return this.factory({ im: Infinity }); // complex/unsigned ∞
      return this.clone(this.sign * Infinity);
    }

    let exactOther: ExactNumericValue;
    if (other instanceof ExactNumericValue) exactOther = other;
    else {
      // Lift a Gaussian integer from the inexact lane (e.g. `x/i`) so the
      // quotient stays exact
      const lifted = other.im !== 0 ? this._liftComplex(other) : null;
      if (lifted === null) return this._toFloat().div(other);
      exactOther = lifted;
    }

    if (this.im !== 0 || exactOther.im !== 0) {
      // z/w = z · (1/w): the inverse of an exact value in the representable
      // set is itself exactly representable (conjugate/norm for a Gaussian
      // rational; a pure-imaginary radical inverts to one), and `mul` handles
      // the (possible) fallback to the float lane.
      const oi = exactOther.inv();
      if (oi instanceof ExactNumericValue) return this.mul(oi);
      return this._toFloat().div(exactOther);
    }

    // (a/b √c) / (d/e √f) = (ae/bdf) * √(cf)
    const rational = mul(this.rational, [
      BigInt(exactOther.rational[1]),
      BigInt(exactOther.rational[0]) * BigInt(exactOther.radical),
    ]);

    const radical = BigInt(this.radical) * BigInt(exactOther.radical);
    if (radical > BigInt(SMALL_INTEGER))
      return this.factory(this.bignumRe).div(exactOther);

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
      return this._toFloat().pow(exponent);

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

    // Complex base: an integer power stays exact (binary exponentiation via
    // the exact `mul`, which falls back to the float lane if an intermediate
    // leaves the representable set — a value in the set never does: Gaussian
    // rationals are closed under multiplication, and powers of a
    // pure-imaginary radical alternate between pure-real and pure-imaginary
    // radicals). A non-integer exponent has no exact closed form here: use
    // the float lane.
    if (this.im !== 0) {
      if (Number.isInteger(exponent) && exponent <= 1024) {
        let result: NumericValue = this.clone(1);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let base: NumericValue = this;
        let k = exponent;
        while (k > 0) {
          if (k % 2 === 1) result = result.mul(base);
          k = Math.floor(k / 2);
          if (k > 0) base = base.mul(base);
        }
        return result;
      }
      return this._toFloat().pow(exponent);
    }

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

    // Complex base: roots leave the representable set — float lane
    if (this.im !== 0) return this._toFloat().root(exponent);

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
          if (rootD !== null) return this.clone({ rational: [rootN, rootD] });
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

    // Complex operand: exact when the value is a perfect Gaussian-rational
    // square — √(a+bi) = x + y·i with x = √((a+|z|)/2), y = sign(b)·√((|z|−a)/2)
    // — i.e. when |z| and both x, y are rational (√(3+4i) = 2+i, √(2i) = 1+i).
    // Otherwise the root leaves the representable set: float lane
    // (`BoxedNumber.sqrt` keeps an exact argument symbolic in that case).
    if (this.im !== 0) {
      if (this.radical === 1 && this.imRadical === 1) {
        const a = this.rational;
        const b = this.imRational;
        const modulus = this.clone({
          rational: add(mul(a, a), mul(b, b)),
        }).sqrt();
        if (
          modulus instanceof ExactNumericValue &&
          modulus.im === 0 &&
          modulus.radical === 1
        ) {
          const half: Rational = [1, 2];
          const x = this.clone({
            rational: mul(add(a, modulus.rational), half),
          }).sqrt();
          if (x instanceof ExactNumericValue && x.im === 0 && x.radical === 1) {
            const y = this.clone({
              rational: mul(add(modulus.rational, neg(a)), half),
            }).sqrt();
            if (y instanceof ExactNumericValue && y.im === 0 && y.radical === 1)
              return this.clone({
                rational: x.rational,
                imRational: isPositive(b) ? y.rational : neg(y.rational),
                imRadical: 1,
              });
          }
        }
      }
      return this._toFloat().sqrt();
    }

    // Can we preserve the rational?
    // If radical ≠ 1, we know that √radical is not an integer, or it would
    // have been normalized to the rational part
    if (this.radical === 1) {
      // √(n/d) = √(n/d) = √(nd) / d
      // (if nd is a perfect square, or a product of perfect squares it
      // will get normalized to the rational numerator)
      if (isMachineRational(this.rational)) {
        const [n, d] = this.rational;
        if (Math.abs(n * d) > SMALL_INTEGER)
          return this.factory(this.bignumRe).sqrt();
        if (n > 0) return this.clone({ radical: n * d, rational: [1, d] });

        //
        // Negative Rational: exact imaginary square root,
        // √(−n/d) = (√(n·d)/d)·i (e.g. √(−4) = 2i, √(−1/2) = (√2/2)·i)
        //
        return this.clone({
          rational: [0, 1],
          imRational: [1, d],
          imRadical: -n * d,
        });
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
    if (this.isOne || this.im !== 0 || other.im !== 0 || other.isOne)
      return this.clone(1);

    // Calculate the GCD of the rational parts
    const rational = rationalGcd(this.rational, other.rational);
    const radical = gcd(this.radical, other.radical);
    return this.clone({ rational, radical });
  }

  abs(): NumericValue {
    if (this.im !== 0) {
      // Pure imaginary: |q√r·i| = |q|√r
      if (isZero(this.rational)) {
        const im = this.imRational;
        return this.clone({
          rational: isPositive(im) ? im : neg(im),
          radical: this.imRadical,
        });
      }
      // Gaussian rational (radicals are 1 by the set invariant):
      // |a+bi| = √(a²+b²) — exact when the norm has a small representable
      // square root (perfect squares fold; small norms keep an exact
      // radical), otherwise `sqrt` falls back to the float lane.
      const a = this.rational;
      const b = this.imRational;
      return this.clone({ rational: add(mul(a, a), mul(b, b)) }).sqrt();
    }
    return this.sign === -1 ? this.neg() : this;
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this.clone(NaN);
    if (this.isPositiveInfinity) return this.clone(Infinity);

    if (this.im !== 0) return this._toFloat().ln(base);

    if (this.sign < 0) return this.clone(NaN);
    if (this.isOne) return this.clone(0);
    if (this.isNegativeOne) return this.factory({ im: Math.PI });

    return this.factory(this.bignumRe).ln(base);
  }

  exp(): NumericValue {
    if (this.isNaN) return this.clone(NaN);
    if (this.isZero) return this.clone(1);
    if (this.im !== 0) return this._toFloat().exp();
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
    if (this.isNaN || this.im !== 0) return this.clone(NaN);
    if (this.radical === 1 && isInteger(this.rational)) return this;
    if (this.radical === 1) return this._integerPart('floor');
    return this.clone(Math.floor(this.re));
  }

  ceil(): NumericValue {
    if (this.isNaN || this.im !== 0) return this.clone(NaN);
    if (this.radical === 1 && isInteger(this.rational)) return this;
    if (this.radical === 1) return this._integerPart('ceil');
    return this.clone(Math.ceil(this.re));
  }

  round(): NumericValue {
    if (this.isNaN || this.im !== 0) return this.clone(NaN);
    if (this.radical === 1 && isInteger(this.rational)) return this;
    if (this.radical === 1) return this._integerPart('round');
    return this.clone(Math.round(this.re));
  }

  eq(other: number | NumericValue): boolean {
    if (typeof other === 'number')
      return (
        this.im === 0 &&
        this.radical === 1 &&
        isInteger(this.rational) &&
        this.rational[0] == other
      );
    if (other instanceof ExactNumericValue) {
      return (
        this.radical === other.radical &&
        this.rational[0] == other.rational[0] &&
        this.rational[1] == other.rational[1] &&
        this.imRadical === other.imRadical &&
        this.imRational[0] == other.imRational[0] &&
        this.imRational[1] == other.imRational[1]
      );
    }
    // Compare against a non-exact `NumericValue` (e.g. a `BigNumericValue`) at
    // working precision via `bignumRe`, mirroring `BigNumericValue.eq`. The
    // previous `other.re === this.re` downcast both operands to a machine float,
    // which made `eq` precision-dependent and *asymmetric* with the bignum path
    // (`1/3` equalled a 30-digit `0.333…` in one direction only) and broke
    // transitivity — isSame is a dedup/matching key, so it must be an
    // equivalence relation (CM-P1-2 / SYMBOLIC P1-9).
    // The imaginary parts compare as machine floats (the inexact lanes store
    // a machine `im`; the cached exact `im` uses the same representation).
    return this.im === other.im && this.bignumRe.eq(other.bignumRe ?? other.re);
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
    // We have only exact values, we need to sum rational, radical and
    // imaginary parts. The imaginary side mirrors the real side: a rational
    // sum plus per-radical buckets. Components that cannot merge stay as
    // separate values in the returned array (the caller keeps them as
    // separate terms), so exactness is never lost here.
    //
    let imRationalSum: Rational = [0, 1];
    const imRadicals: { multiple: Rational; radical: number }[] = [];
    let rationalSum: Rational = [0, 1];
    const radicals: { multiple: Rational; radical: number }[] = [];

    const addToBuckets = (
      buckets: { multiple: Rational; radical: number }[],
      rational: Rational,
      radical: number
    ) => {
      const index = buckets.findIndex((x) => x.radical === radical);
      if (index === -1) buckets.push({ multiple: rational, radical });
      else buckets[index].multiple = add(buckets[index].multiple, rational);
    };

    for (const value of values) {
      if (value.isNaN) return [new ExactNumericValue(NaN, factory)];
      if (value.isZero) continue;

      // We have a rational or a radical
      if (value instanceof ExactNumericValue) {
        const rational = value.rational;
        if (value.radical === 1) {
          // Just a fraction, add it to the sum
          rationalSum = add(rationalSum, rational);
        } else if (!isZero(rational)) {
          // We have a rational and a radical, e.g. 2√5 or (1/3)√7 or √2
          addToBuckets(radicals, rational, value.radical);
        }
        // Imaginary component (exact)
        if (value.im !== 0) {
          if (value.imRadical === 1)
            imRationalSum = add(imRationalSum, value.imRational);
          else addToBuckets(imRadicals, value.imRational, value.imRadical);
        }
      } else {
        // A non-`ExactNumericValue` value reaching the exact path is a real
        // integer or a Gaussian integer: fold both integer components exactly.
        console.assert(
          isSubtype(value.type, 'integer') ||
            (Number.isInteger(value.re) && Number.isInteger(value.im))
        );
        if (value.im !== 0) imRationalSum = add(imRationalSum, [value.im, 1]);
        // Use bignumRe to avoid precision loss for large integers
        const intValue = BigInt(value.bignumRe!.toFixed(0));
        rationalSum = add(rationalSum, [intValue, BigInt(1)]);
      }
    }

    const hasIm = !isZero(imRationalSum) || imRadicals.length > 0;

    if (!hasIm) {
      // ── Real-only sum (the historical path, unchanged) ──
      // If we add no additional rational or radical,
      if (isZero(rationalSum) && radicals.length === 0)
        return [new ExactNumericValue(0, factory)];

      const result: NumericValue[] = [];
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

    // ── Sum with an imaginary part ──
    const result: NumericValue[] = [];
    // Gaussian rational core: rationalSum + imRationalSum·i (a single exact
    // value — this is what keeps `2 + 3i` exact)
    if (!isZero(rationalSum) || !isZero(imRationalSum))
      result.push(
        new ExactNumericValue(
          { rational: rationalSum, imRational: imRationalSum },
          factory
        )
      );
    // Real radicals (each exact, kept separate)
    for (const x of radicals)
      if (!isZero(x.multiple))
        result.push(
          new ExactNumericValue(
            { rational: x.multiple, radical: x.radical },
            factory
          )
        );
    // Imaginary radicals (each an exact pure-imaginary value)
    for (const x of imRadicals)
      if (!isZero(x.multiple))
        result.push(
          new ExactNumericValue(
            { rational: [0, 1], imRational: x.multiple, imRadical: x.radical },
            factory
          )
        );

    if (result.length === 0) return [new ExactNumericValue(0, factory)];
    return result;
  }
}

//
// ── Exact component arithmetic ─────────────────────────────────────────
//
// Helpers for the complex (Gaussian) arithmetic: each component of an exact
// complex value is `rat · √rad`. They return `null` when the result is not
// representable as a single such component (incompatible radicals, or a
// radical too large) — the caller then falls back to the float lane, exactly
// as the real radical operations do.
//

/** Sum of two components: exact iff either is zero or the radicals match. */
function addComponents(
  x: ExactComponent,
  y: ExactComponent
): ExactComponent | null {
  if (isZero(x.rat)) return y;
  if (isZero(y.rat)) return x;
  if (x.rad === y.rad) return { rat: add(x.rat, y.rat), rad: x.rad };
  return null;
}

/** Product of two components: `(a√r)·(b√s) = ab·√(rs)`, with the square part
 * of `rs` extracted into the rational. `null` if the radical is too large. */
function mulComponents(
  x: ExactComponent,
  y: ExactComponent
): ExactComponent | null {
  if (isZero(x.rat) || isZero(y.rat)) return { rat: [0, 1], rad: 1 };
  const bigRad = BigInt(x.rad) * BigInt(y.rad);
  if (bigRad > BigInt(SMALL_INTEGER)) return null;
  let rat = mul(x.rat, y.rat);
  let rad = Number(bigRad);
  if (rad >= 4) {
    const [factor, root] = canonicalInteger(rad, 2);
    if (factor !== 1) rat = mul(rat, [factor, 1]);
    rad = root;
  }
  return { rat, rad };
}

function negComponent(x: ExactComponent): ExactComponent {
  if (isZero(x.rat)) return x;
  return { rat: neg(x.rat), rad: x.rad };
}

/** Is a (re, im) component pair inside the representable set?
 * — real, pure-imaginary, or Gaussian rational (both radicals 1). */
function componentsInSet(re: ExactComponent, im: ExactComponent): boolean {
  if (isZero(im.rat)) return true; // real
  if (isZero(re.rat)) return true; // pure imaginary
  return re.rad === 1 && im.rad === 1; // Gaussian rational
}

/** String form of one exact component `rational · √radical` (the shapes
 * historically produced by `ExactNumericValue.toString()` for real values).
 */
function componentToString(rational: Rational, radical: number): string {
  const rationalStr = (r: Rational) => {
    if (isInteger(r)) return numberToString(r[0]);

    return `${numberToString(r[0])}/${numberToString(r[1])}`;
  };

  // Only have a rational
  if (radical === 1) return rationalStr(rational);

  const radicalStr = (r: number) => `sqrt(${numberToString(r)})`;

  // Only have a radical
  // 1√b = √b
  if (isOne(rational)) return radicalStr(radical);
  // -1√b = -√b
  if (isNegativeOne(rational)) return `-${radicalStr(radical)}`;
  // 1/a√b = √b/a
  if (rational[0] == 1)
    return `${radicalStr(radical)}/${numberToString(rational[1])}`;
  if (rational[0] == -1)
    return `-${radicalStr(radical)}/${numberToString(rational[1])}`;

  // Have both a radical and a rational
  return `${rationalStr(rational)}${radicalStr(radical)}`;
}

/** Serialize one exact component `rational · √radical` to MathJSON (the
 * shapes historically produced by `ExactNumericValue.toJSON()` for real
 * values). */
function componentToExpression(
  rational: Rational,
  radical: number
): MathJsonExpression {
  const rationalExpr = (r: Rational) => {
    if (isInteger(r)) return numberToExpression(r[0]);
    return [
      'Rational',
      numberToExpression(r[0]),
      numberToExpression(r[1]),
    ] as MathJsonExpression;
  };

  // Only have a rational
  if (radical === 1) return rationalExpr(rational);

  // Only have a radical
  if (isOne(rational)) return ['Sqrt', radical];
  if (isNegativeOne(rational)) return ['Negate', ['Sqrt', radical]];

  // Have both a radical and a rational

  if (rational[0] == 1)
    return ['Divide', ['Sqrt', radical], numberToExpression(rational[1])];
  if (rational[0] == -1)
    return [
      'Negate',
      ['Divide', ['Sqrt', radical], numberToExpression(rational[1])],
    ];

  return ['Multiply', rationalExpr(rational), ['Sqrt', radical]];
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
