import { BigDecimal } from '../../big-decimal/index.js';
import type { SmallInteger } from '../numerics/types.js';
import { NumericValue, NumericValueData } from './types.js';
import { ExactNumericValue } from './exact-numeric-value.js';
import { isInMachineRange } from '../numerics/numeric-bignum.js';
import { MathJsonExpression } from '../../math-json/types.js';
import { numberToExpression } from '../numerics/expression.js';
import { bigint } from '../numerics/bigint.js';
import { NumericPrimitiveType } from '../../common/type/types.js';
import { complexNoiseRatio, isComplexDust } from './roundoff.js';

/** The imaginary part of every real value. It is a zero that is not
 * `BigDecimal.ZERO`: that constant is frozen, so it has a different hidden
 * class from the other big decimals, and holding it here made every call on
 * `imDecimal` polymorphic (a real product was 2.7 times slower). */
const REAL_IM = new BigDecimal(0);

export class BigNumericValue extends NumericValue {
  declare __brand: 'BigNumericValue';

  decimal: BigDecimal;

  /** The imaginary part. It is the value of the imaginary part: the double
   * `im` is only the nearest double to it, computed once in the constructor
   * (`0` for `10^{-800}`, `Infinity` for a finite `10^{800}`). Every
   * predicate and every kernel of this class reads this field.
   *
   * It is a `declare` field, assigned in every branch of the constructor:
   * a class field without `declare` is first defined as `undefined` on
   * every instance, which made the construction of a real value about 1.5
   * times slower. */
  declare imDecimal: BigDecimal;

  constructor(value: number | BigDecimal | NumericValueData) {
    super();

    // A real value, the frequent case, does not need the checks and the
    // conversion of the imaginary part below.
    if (typeof value === 'number' || value instanceof BigDecimal) {
      this.decimal = typeof value === 'number' ? new BigDecimal(value) : value;
      this.imDecimal = REAL_IM;
      this.im = 0;
      if (this.decimal.isNaN()) {
        this.imDecimal = BigDecimal.NAN;
        this.im = NaN;
      }
      return;
    }

    this.decimal =
      value.re instanceof BigDecimal ? value.re : new BigDecimal(value.re ?? 0);
    const im = value.im;
    this.imDecimal =
      im === undefined || im === 0
        ? REAL_IM
        : im instanceof BigDecimal
          ? im.isZero()
            ? REAL_IM
            : im
          : new BigDecimal(im);

    // NaN-ness must be coherent: a value with a NaN component is NaN.
    // (e.g. `sqrt()` of a NaN value produces im = √(−NaN) = NaN with a
    // valid decimal — coerce rather than carry an incoherent value)
    if (this.decimal.isNaN()) this.imDecimal = BigDecimal.NAN;
    else if (this.imDecimal.isNaN()) this.decimal = BigDecimal.NAN;

    // The double projection is computed once: the value is immutable.
    this.im = this.imDecimal.isZero() ? 0 : this.imDecimal.toNumber();
  }

  get type(): NumericPrimitiveType {
    if (this.isNaN) return 'nan';
    // `~oo` is infinite with NO direction, so it is not a real infinity and
    // not a finite complex number: its type is `infinity`, the tier that names
    // every value of infinite magnitude whatever its direction.
    if (this.isComplexInfinity) return 'infinity';
    if (this.isComplex) {
      // A value with a non-finite component is not a *finite* complex number,
      // so it is not below `complex` at all. Two cases reach here, because an
      // infinite IMAGINARY part was already answered above (that IS the `~oo`
      // test) and a NaN real part was answered by `isNaN`:
      // - a NaN imaginary part. NaN absorbs in IEEE arithmetic, so the value
      //   is the not-a-number marker, tested first.
      // - an infinite real part paired with a finite imaginary part (`∞ + i`).
      //   Its magnitude is infinite, so it inhabits `infinity` as an anonymous
      //   member — it is not one of the three named singletons, and it is
      //   deliberately NOT canonicalized to `~oo`.
      // `imaginary` is reserved for a finite non-zero imaginary part paired
      // with a zero real part.
      if (this.imDecimal.isNaN()) return 'nan';
      if (!this.decimal.isFinite()) return 'infinity';
      if (this.decimal.isZero()) return 'imaginary';
      return 'complex';
    }
    if (!this.decimal.isFinite()) return 'infinity';
    if (this.decimal.isInteger()) return 'integer';
    return 'real';
  }

  // A big decimal is never exact. It is a value at the working precision
  // (the result of a numeric evaluation, or a literal written with a decimal
  // point), and whether it is integer-valued depends on that precision:
  // `10^400` evaluated with `.N()` is integer-valued at 21 digits only
  // because the digits past the precision were rounded away. An exact
  // integer is built from a bigint or a string of digits instead.
  get isExact(): boolean {
    return false;
  }

  get asExact(): ExactNumericValue | undefined {
    return undefined;
  }

  /**
   * Serialize to MathJSON. Preserves the full raw `BigDecimal` value
   * with no rounding, ensuring lossless round-tripping. Digits beyond
   * `BigDecimal.precision` may be present (from exact arithmetic) but
   * are not guaranteed to be accurate after precision-bounded operations.
   */
  toJSON(): MathJsonExpression {
    if (this.isNaN) return 'NaN';
    if (this.isPositiveInfinity) return 'PositiveInfinity';
    if (this.isNegativeInfinity) return 'NegativeInfinity';
    if (this.isComplexInfinity) return 'ComplexInfinity';
    if (!this.isComplex) {
      if (isInMachineRange(this.decimal)) return this.decimal.toNumber();
      return { num: decimalToString(this.decimal) };
    }
    // Each part is written as a JSON number only when the double is exactly
    // that part, otherwise as a `{ num }` string that keeps every digit.
    const part = (x: BigDecimal): MathJsonExpression =>
      isInMachineRange(x)
        ? numberToExpression(x.toNumber())
        : { num: decimalToString(x) };
    return ['Complex', part(this.decimal), part(this.imDecimal)];
  }

  /**
   * Return a human-readable string representation.
   *
   * Each part, the real part and the imaginary part, is rounded to
   * `BigDecimal.precision` significant digits, so that noise digits from
   * precision-bounded operations (division, transcendentals) are not
   * displayed.
   *
   * For the full unrounded value, use `toJSON()`.
   */
  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';
    const rounded = (x: BigDecimal) =>
      decimalToString(x.toPrecision(BigDecimal.precision));
    if (!this.isComplex) return rounded(this.decimal);
    if (this.isNaN) return 'NaN';
    if (this.isComplexInfinity) return '~oo';

    const b = this.imDecimal;
    if (this.decimal.isZero()) {
      if (b.eq(1)) return 'i';
      if (b.eq(-1)) return '-i';
      return `${rounded(b)}i`;
    }

    let im = '';
    if (b.eq(1)) im = '+ i';
    else if (b.eq(-1)) im = '- i';
    else if (b.isPositive()) im = `+ ${rounded(b)}i`;
    else im = `- ${rounded(b.neg())}i`;

    return `(${rounded(this.decimal)} ${im})`;
  }

  clone(value: number | BigDecimal | NumericValueData) {
    return new BigNumericValue(value);
  }

  private _makeExact(value: number | bigint): ExactNumericValue {
    return new ExactNumericValue(value, (x) => this.clone(x));
  }

  get re(): number {
    return this.decimal.toNumber();
  }

  get bignumRe(): BigDecimal {
    return this.decimal;
  }

  get bignumIm(): BigDecimal {
    return this.imDecimal;
  }

  get numerator(): BigNumericValue {
    return this;
  }

  get denominator(): ExactNumericValue {
    return this._makeExact(1);
  }

  get isNaN(): boolean {
    return this.decimal.isNaN();
  }

  get isPositiveInfinity(): boolean {
    return (
      !this.isComplex &&
      !this.decimal.isFinite() &&
      !this.decimal.isNaN() &&
      this.decimal.isPositive()
    );
  }

  get isNegativeInfinity(): boolean {
    return (
      !this.isComplex &&
      !this.decimal.isFinite() &&
      !this.decimal.isNaN() &&
      this.decimal.isNegative()
    );
  }

  // The test reads the big decimal, not the double `im`: the double is
  // `Infinity` for a FINITE imaginary part beyond the double range
  // (`10^{800}`), which is not complex infinity.
  get isComplexInfinity(): boolean {
    // A finite double projection answers first: the imaginary part is then
    // finite.
    if (Number.isFinite(this.im)) return false;
    return !this.imDecimal.isFinite() && !this.imDecimal.isNaN();
  }

  /** True if the imaginary part is not zero. This reads the big decimal
   * `imDecimal`, not the double `im`, which is `0` for `10^{-800}`. */
  get isComplex(): boolean {
    // The predicates read `isComplex` many times, so the cheap tests come
    // first. A non-zero double projection means a non-zero imaginary part.
    // A real value holds the shared `REAL_IM` (see the constructor), and
    // only a projection that underflowed to `0` reads the big decimal.
    if (this.im !== 0) return true;
    const im = this.imDecimal;
    return im !== REAL_IM && !im.isZero();
  }

  get isZero(): boolean {
    return !this.isComplex && this.decimal.isZero();
  }

  isZeroWithTolerance(tolerance: number | BigDecimal): boolean {
    // The imaginary part is compared against the tolerance too: a residual
    // imaginary epsilon must not make the difference "provably non-zero".
    const tol =
      typeof tolerance === 'number' ? new BigDecimal(tolerance) : tolerance;
    if (this.imDecimal.abs().gt(tol)) return false;
    return this.decimal.abs().lte(tol);
  }

  get isOne(): boolean {
    return !this.isComplex && this.decimal.eq(1);
  }

  get isNegativeOne(): boolean {
    return !this.isComplex && this.decimal.eq(-1);
  }

  sgn(): -1 | 0 | 1 | undefined {
    if (this.isComplex) return undefined;
    if (this.decimal.isZero()) return 0;
    if (this.decimal.isPositive()) return 1;
    if (this.decimal.isNegative()) return -1;
    return undefined;
  }

  N(): NumericValue {
    return this;
  }

  neg(): BigNumericValue {
    if (this.isZero) return this;
    if (!this.isComplex) return this.clone(this.decimal.neg());
    return this.clone({ re: this.decimal.neg(), im: this.imDecimal.neg() });
  }

  inv(): BigNumericValue {
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;
    if (!this.isComplex) return this.clone(this.decimal.inv());

    // 1/z = conj(z) / |z|²  (not / |z|).
    // For finite parts, both parts are formed as big decimals, which do not
    // overflow or underflow: `1/(1e308 + 1e308i)` is `5e-309 − 5e-309i`, not
    // `0`, and `1/(1e-200 + 1e-200i)` is `5e199 − 5e199i`, not `~oo`.
    const b = this.imDecimal;
    if (this.decimal.isFinite() && b.isFinite()) {
      const bigD = this.decimal.mul(this.decimal).add(b.mul(b));
      return this.clone({
        re: this.decimal.div(bigD),
        im: b.neg().div(bigD),
      });
    }
    const d = this.re * this.re + this.im * this.im;
    const bigD = this.decimal.mul(this.decimal).add(this.im * this.im);
    return this.clone({ re: this.decimal.div(bigD), im: -this.im / d });
  }

  add(other: number | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 0) return this;
      return this.clone({ re: this.decimal.add(other), im: this.imDecimal });
    }

    if (other.isZero) return this;
    // NOTE: must read `other.bignumRe` (full precision), not pass `other`
    // directly to `clone()` — the BigNumericValue constructor reads `.re`,
    // which is `decimal.toNumber()` (machine precision), silently truncating a
    // full-precision bignum. This path is hit on the first iteration of any
    // zero-seeded accumulator loop (e.g. ExactNumericValue.sum over ≥3 inexact
    // values), which would otherwise cap the sum at ~16 digits.
    if (this.isZero)
      return this.clone({
        re: other.bignumRe ?? other.re,
        im: other.bignumIm ?? other.im,
      });

    // The imaginary parts are added as big decimals: an imaginary part can be
    // too small or too large for a double.
    return this.clone({
      re: this.decimal.add(other.bignumRe ?? other.re),
      im:
        this.isComplex || other.isComplex
          ? this.imDecimal.add(bigImaginaryPart(other))
          : 0,
    });
  }

  sub(other: NumericValue): NumericValue {
    return this.add(other.neg());
  }

  mul(other: number | BigDecimal | NumericValue): NumericValue {
    if (this.isZero) {
      if (
        other instanceof NumericValue &&
        (other.isPositiveInfinity ||
          other.isNegativeInfinity ||
          other.isComplexInfinity ||
          other.isNaN)
      )
        return this._makeExact(NaN);
      return this;
    }
    if (other === 1) return this;
    if (other === -1) return this.neg();
    if (other === 0) {
      if (
        this.isNaN ||
        this.isPositiveInfinity ||
        this.isNegativeInfinity ||
        this.isComplexInfinity
      )
        return this._makeExact(NaN);
      return this.clone(0);
    }

    if (this.isOne) {
      if (typeof other === 'number' || other instanceof BigDecimal)
        return this.clone(other);
      return this.clone({
        re: other.bignumRe ?? other.re,
        im: other.bignumIm ?? other.im,
      });
    }
    if (typeof other === 'number') {
      // A non-real value scaled by a ±∞ SCALAR is `~oo`, for the same reason the
      // NumericValue path below gives: the product is infinite with no real
      // direction left. Without this the component arithmetic computes `0 · ∞`
      // for the real part of `i · ∞` and the whole value collapses to NaN. The
      // other overloads have to say it themselves — they never reach that path.
      if (
        !this.isNaN &&
        this.isComplex &&
        !Number.isFinite(other) &&
        !Number.isNaN(other)
      )
        return this.clone({ re: Infinity, im: Infinity });

      if (!this.isComplex) return this.clone(this.decimal.mul(other));

      return this.clone({
        re: this.decimal.mul(other),
        im: this.imDecimal.mul(other),
      });
    }
    if (other instanceof BigDecimal) {
      // A non-real value scaled by a ±∞ SCALAR is `~oo`, for the same reason the
      // NumericValue path below gives: the product is infinite with no real
      // direction left. Without this the component arithmetic computes `0 · ∞`
      // for the real part of `i · ∞` and the whole value collapses to NaN. The
      // other.toNumber() overloads have to say it themselves — they never reach that path.
      // The test reads the big decimal itself, not `toNumber()`, which is
      // `Infinity` for a FINITE value beyond the double range (`10^{400}`).
      if (!this.isNaN && this.isComplex && !other.isFinite() && !other.isNaN())
        return this.clone({ re: Infinity, im: Infinity });

      if (!this.isComplex) return this.clone(this.decimal.mul(other));

      return this.clone({
        re: this.decimal.mul(other),
        im: this.imDecimal.mul(other),
      });
    }

    if (this.isNegativeOne) {
      const n = other.neg();
      return this.clone({ re: n.bignumRe ?? n.re, im: n.bignumIm ?? n.im });
    }
    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) {
      if (
        this.isNaN ||
        this.isPositiveInfinity ||
        this.isNegativeInfinity ||
        this.isComplexInfinity
      )
        return this._makeExact(NaN);
      return this.clone(0);
    }

    // `~oo` absorbs any other factor: it is the single point at infinity, so
    // multiplying it by a non-zero value — real, imaginary or complex — is
    // `~oo` again. Without this the general complex product below computes
    // `∞·0 - ∞·1` for `~oo · i` and answers NaN. A ZERO factor is not reached
    // here: both zero cases return NaN above, which is the indeterminate form
    // `0 · ~oo`.
    //
    // NaN is excluded explicitly and in BOTH operand positions: it poisons
    // every product, so `NaN · ~oo` is NaN, not `~oo`. The receiver's own NaN
    // is re-tested here rather than relied on from an earlier guard, because
    // only one of the two numeric-value lanes returns early on it.
    //
    // The same reasoning reaches a REAL ±∞ turned in a non-real direction:
    // `∞ · i` is infinite with no real direction left, and the one point at
    // infinity is exactly what represents that, so it is `~oo` rather than
    // the indeterminate NaN the general formula below produces from `∞·0`.
    // A signed real factor keeps the signed rule — `2 · ∞` is `+oo` — because
    // it does not move the product off the real line.
    if (
      !this.isNaN &&
      !other.isNaN &&
      (this.isComplexInfinity ||
        other.isComplexInfinity ||
        ((this.isPositiveInfinity || this.isNegativeInfinity) &&
          other.isComplex) ||
        ((other.isPositiveInfinity || other.isNegativeInfinity) &&
          this.isComplex))
    )
      return this.clone({ re: Infinity, im: Infinity });

    if (!this.isComplex && !other.isComplex) {
      // A product with an exact rational is `(x · p) / q`, computed with 5
      // guard digits: `x · (p / q)` rounded the quotient to the working
      // precision and then multiplied, and `sin(π/6)` at 21 digits was
      // `0.500…001` where the kernel answers `0.5` for a 26-digit angle.
      // The guard digits are kept in the result, as a big-decimal product
      // keeps them (`mul` does not round to the working precision, `div`
      // does): an angle such as `π/2 − 10⁻¹²` must carry them for
      // `cos(π/2 − 10⁻¹²)` to be `10⁻¹²` to more than 9 digits.
      if (
        other instanceof ExactNumericValue &&
        other.radical === 1 &&
        other.rational[1] != 1
      ) {
        const [p, q] = other.rational;
        const saved = BigDecimal.precision;
        BigDecimal.precision = saved + 5;
        try {
          return this.clone(
            this.decimal.mul(new BigDecimal(p)).div(new BigDecimal(q))
          );
        } finally {
          BigDecimal.precision = saved;
        }
      }
      return this.clone(this.decimal.mul(other.bignumRe ?? other.re));
    }

    // (a + bi)(c + di) = (ac − bd) + (ad + bc)i, with every part a big
    // decimal. The double projections are not enough: for
    // `10^{400} · (1 + 10^{-400}i)` the real part `a` is `Infinity` as a
    // double and `d` is `0`, so `a·d` is NaN, where the product is `10^{400} + i`.
    // The four products are exact and are not rounded, as the product of two
    // real values is not (`mul` keeps the guard digits of its operands; the
    // printed value is rounded).
    const b = this.imDecimal;
    const c = other.bignumRe ?? new BigDecimal(other.re);
    const d = bigImaginaryPart(other);
    return this.clone({
      re: this.decimal.mul(c).sub(b.mul(d)),
      im: this.decimal.mul(d).add(b.mul(c)),
    });
  }

  div(other: SmallInteger | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 1) return this;
      if (other === -1) return this.neg();
      if (other === 0) return this.clone(NaN);
      if (!this.isComplex) return this.clone(this.decimal.div(other));
      return this.clone({
        re: this.decimal.div(other),
        im: this.imDecimal.div(other),
      });
    }

    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) {
      // a/0: 0/0 and NaN/0 are NaN; otherwise a signed (or, for a complex
      // numerator, an unsigned) infinity — the previous code always returned
      // +Infinity, dropping the sign (ExactNumericValue is sign-aware).
      if (this.isZero || this.isNaN) return this.clone(NaN);
      if (this.isComplex) return this.clone({ im: Infinity });
      return this.clone(this.decimal.isNegative() ? -Infinity : Infinity);
    }

    if (!this.isComplex && !other.isComplex)
      return this.clone(this.decimal.div(other.bignumRe ?? other.re));

    const [a, b] = [this.re, this.im];
    const [c, d] = [other.re, other.im];
    const bigB = this.imDecimal;
    const bigC = other.bignumRe ?? new BigDecimal(other.re);
    const bigD = bigImaginaryPart(other);
    // For finite parts, (a + bi)/(c + di) = ((ac + bd) + (bc − ad)i)/(c² + d²)
    // is formed with every part a big decimal, which does not overflow or
    // underflow: `(1e308 + 1e308i) / (1 + i)` is `1e308`, and
    // `10^{400} / (1 + 10^{-400}i)` is `10^{400} − i`. The finiteness of
    // every part is read from the big decimals: their double projections are
    // `±Infinity` for a finite value beyond the double range.
    if (
      this.decimal.isFinite() &&
      bigC.isFinite() &&
      bigB.isFinite() &&
      bigD.isFinite()
    ) {
      const denominator = bigC.mul(bigC).add(bigD.mul(bigD));
      return this.clone({
        re: this.decimal.mul(bigC).add(bigB.mul(bigD)).div(denominator),
        im: bigB.mul(bigC).sub(this.decimal.mul(bigD)).div(denominator),
      });
    }
    const denominator = c * c + d * d;
    const bigDenominator = bigC.mul(bigC).add(d * d);
    return this.clone({
      re: this.decimal
        .mul(bigC)
        .add(b * d)
        .div(bigDenominator),
      im: (b * c - a * d) / denominator,
    });
  }

  pow(
    exponent: number | NumericValue | { re: number; im: number }
  ): NumericValue {
    console.assert(!Array.isArray(exponent));
    // if (Array.isArray(exponent)) exponent = exponent[0] / exponent[1];

    if (this.isNaN) return this;
    if (typeof exponent === 'number' && isNaN(exponent)) return this.clone(NaN);

    // The parts of a complex exponent, as big decimals.
    let bigExponent: [BigDecimal, BigDecimal] | undefined;
    // A real exponent, as a big decimal. Its double projection has only 16
    // digits: at 40 digits, `(1+i)^{2.000000000000000000001}` would be
    // computed as `(1+i)^2`.
    let bigN: BigDecimal | undefined;
    if (exponent instanceof NumericValue) {
      if (exponent.isNaN) return this.clone(NaN);
      if (exponent.isZero) return this.clone(1);
      if (exponent.isOne) return this;
      if (exponent.isComplex) {
        bigExponent = [
          exponent.bignumRe ?? new BigDecimal(exponent.re),
          bigImaginaryPart(exponent),
        ];
        exponent = { re: exponent.re, im: exponent.im };
      } else {
        bigN = bigRealPart(exponent);
        exponent = exponent.re;
      }
    }

    //
    // For the special cases we implement the same (somewhat arbitrary) results
    // as SymPy. See https://docs.sympy.org/latest/modules/core.html#sympy.core.power.Pow
    //

    // If the exponent is a complex number, we use the formula:
    // z^w = (r^w) * (cos(wθ) + i * sin(wθ)),
    // where z = r * (cos(θ) + i * sin(θ))

    if (
      typeof exponent === 'object' &&
      ('re' in exponent || 'im' in exponent)
    ) {
      //
      // Complex Exponent
      //
      const [re, im] = [exponent?.re ?? 0, exponent?.im ?? 0];
      if (Number.isNaN(im) || Number.isNaN(re)) return this.clone(NaN);
      const [bigRe, bigIm] = bigExponent ?? [
        new BigDecimal(re),
        new BigDecimal(im),
      ];
      if (bigIm.isZero()) {
        exponent = re; // fallthrough and continue
        bigN = bigRe;
      } else {
        // Complex Infinity ^ z -> NaN
        if (this.isComplexInfinity) return this.clone(NaN);
        if (this.isNegativeInfinity) return this.clone(0);
        if (this.isPositiveInfinity) return this.clone({ im: Infinity });

        // z^(re + i·im) = exp((re + i·im) · Ln z), with Ln z = ln|z| + i·arg(z):
        //   |z^w|     = exp(re·ln|z| − im·arg z)
        //   arg(z^w)  = re·arg z + im·ln|z|
        // The previous code used ln(Re z) instead of ln|z| and dropped the
        // exp(−im·arg z) magnitude factor — correct only for positive real z.
        if (this.isZero)
          return bigRe.isPositive() ? this.clone(0) : this.clone(NaN);
        const a = this.decimal;
        const b = this.imDecimal;
        // The polar form is computed with guard digits (the angle is
        // multiplied by the exponent, which multiplies its rounding error),
        // then each part is rounded to the working precision and a part that
        // is only rounding noise is removed (see `polarResult()`).
        return polarResult(
          this,
          guardDigits(bigRe.abs().add(bigIm.abs())),
          () => {
            const lnMod = modulus(a, b).ln();
            const arg = BigDecimal.atan2(b, a);
            const realExp = lnMod.mul(bigRe).sub(arg.mul(bigIm));
            const angle1 = arg.mul(bigRe);
            const angle2 = lnMod.mul(bigIm);
            // When both terms of the angle are small, the angle is not the
            // result of a cancellation, and it is legitimately small:
            // `e^{i·10^{-800}}`, computed as `e.pow(i·10^{-800})`, is
            // `1 + 10^{-800}i`.
            const small = (t: BigDecimal) =>
              t.isZero() || isSmallBeside(t, BigDecimal.ONE);
            const smallAngle = small(angle1) && small(angle2);
            return [realExp.exp(), angle1.add(angle2), smallAngle];
          }
        );
      }
    }

    const n = bigN ?? new BigDecimal(exponent as number);
    const nIsInfinite = !n.isFinite() && !n.isNaN();

    if (this.isPositiveInfinity) {
      if (n.eq(-1)) return this.clone(0);
      if (nIsInfinite) return this.clone(n.isPositive() ? Infinity : 0);
    } else if (this.isNegativeInfinity && nIsInfinite && n.isPositive())
      return this.clone(NaN);

    if (nIsInfinite && (this.isOne || this.isNegativeOne))
      return this.clone(NaN);

    if (n.eq(1)) return this;
    if (n.eq(-1)) return this.inv();

    if (n.isZero()) return this.clone(1);

    if (this.isZero) {
      if (n.isPositive()) return this; // 0^x = 0 when x > 0
      if (n.isNegative()) return this.clone({ im: Infinity }); // Complex/unsigned infinity
    }

    if (n.isNegative()) return this.pow(this.clone(n.neg())).inv();

    if (!this.isComplex) {
      return this.clone(this.decimal.pow(n));
    }

    const a = this.decimal;
    const b = this.imDecimal;
    const isInteger = n.isInteger();
    // The first-order term of the expansion is `n` times the small part, so
    // the regime is decided on `|n|` times the small part.
    const weight = Math.max(1, Math.abs(n.toNumber()));

    // Small-component regime, a small imaginary part:
    //   (a + ib)^n = a^n·(1 + i·n·b/a)
    // The next term is of relative size (n·b/a)², below the working
    // precision. This holds for a positive `a`, and for a negative `a` when
    // `n` is an integer (then `a^n` is real). The polar form would lose the
    // imaginary part: the angle `b/a` is below the rounding error of `arg`.
    if ((a.isPositive() || isInteger) && isSmallBeside(b, a, weight)) {
      return guarded(this, () => {
        const an = a.pow(n);
        return [an, an.mul(b).mul(n).div(a)];
      });
    }

    // A negative `a`, an imaginary part smaller than `|a|` and a non-integer
    // `n`. The argument of `a + ib` is `sgn(b)·π + atan(b/a)`, so
    //   (a + ib)^n = |z|^n · e^{iπn·sgn(b)} · e^{i·n·atan(b/a)}.
    // The polar form computes the cosine and the sine of an angle near
    // `±πn`: when `n` is a half-integer, a part of the result is near `0`,
    // and it is accurate only compared with the modulus. At 21 digits,
    // `(-4 + 10^{-800}i)^{1.5}` gave `-8i`, not `-3·10^{-800} - 8i`, and at
    // 40 digits the real part of `(-4 + 10^{-30}i)^{1.5}` had about 20
    // correct digits. Here the small angle `n·atan(b/a)` is computed
    // separately, and it is accurate compared with itself. Only the unit
    // `e^{iπn·sgn(b)}` is cleaned: its noise comes from the rounding of π
    // (`cos(1.5π)` is not exactly `0`), and a part of it below
    // `10^{2−precision}` is removed. The rest of the product makes no such
    // noise and is not cleaned.
    if (a.isNegative() && !isInteger && b.abs().lt(a.abs())) {
      const saved = BigDecimal.precision;
      const noise = complexNoiseRatio();
      let re: BigDecimal;
      let im: BigDecimal;
      BigDecimal.precision = saved + guardDigits(n);
      try {
        const unitAngle = BigDecimal.PI.mul(n);
        let c = unitAngle.cos();
        let s = unitAngle.sin();
        if (b.isNegative()) s = s.neg();
        if (c.abs().lte(noise)) c = BigDecimal.ZERO;
        if (s.abs().lte(noise)) s = BigDecimal.ZERO;
        const ratio = b.div(a);
        // When `b/a` is small, `atan(b/a)` is `b/a` to the working precision.
        const smallAngle = n.mul(isSmallBeside(b, a) ? ratio : ratio.atan());
        const mag = modulus(a, b).pow(n);
        const cosSmall = smallAngle.cos();
        const sinSmall = isSmallBeside(b, a, weight)
          ? smallAngle
          : smallAngle.sin();
        re = mag.mul(c.mul(cosSmall).sub(s.mul(sinSmall)));
        im = mag.mul(s.mul(cosSmall).add(c.mul(sinSmall)));
      } finally {
        BigDecimal.precision = saved;
      }
      return this.clone({ re: roundToPrecision(re), im: roundToPrecision(im) });
    }

    // Small-component regime, a small real part, for an integer `n`:
    //   (a + ib)^n = (ib)^n·(1 − i·n·a/b)
    // `(ib)^n` is `b^n` turned by `i^n`, and the correction is turned by one
    // more quarter turn.
    if (isInteger && isSmallBeside(a, b, weight)) {
      return guarded(this, () => {
        const main = b.pow(n);
        const correction = main.mul(a).mul(n.neg()).div(b);
        switch (Number(n.toBigInt() % BigInt(4))) {
          case 0:
            return [main, correction];
          case 1:
            return [correction.neg(), main];
          case 2:
            return [main.neg(), correction.neg()];
          default:
            return [correction, main.neg()];
        }
      });
    }

    // Normal regime, an integer `n`: repeated multiplication (binary
    // exponentiation), with guard digits because the rounding error is
    // multiplied by about `n`. Each part is accurate compared with ITSELF,
    // where the polar form is accurate only compared with the modulus: at
    // 1000 digits, the polar form of `(10^{-800} + 2i)^2` has only about 200
    // correct digits in its imaginary part `4·10^{-800}`.
    //
    // The magnitude of the result is estimated first, with the limit of
    // `BigDecimal.pow()` (a decimal exponent of `9e15`): repeated
    // multiplication has no such limit, and `(1.1+i)^{10^{20}}` would give a
    // value with an exponent of about `1.7e19`, which does not print
    // correctly. Beyond the limit the result is the complex infinity, and
    // below its opposite it is `0`.
    if (isInteger && a.isFinite() && b.isFinite()) {
      const magnitude = n.toNumber() * log10Modulus(a, b);
      if (magnitude > 9e15) return this.clone({ re: Infinity, im: Infinity });
      if (magnitude < -9e15) return this.clone(0);
      return integerPower(this, a, b, n.toBigInt());
    }

    // Normal regime: the polar form, with guard digits because the angle is
    // multiplied by `n`, which multiplies its rounding error. A part that is
    // only rounding noise is removed (see `polarResult()`).
    return polarResult(this, guardDigits(n), () => [
      modulus(a, b).pow(n),
      BigDecimal.atan2(b, a).mul(n),
    ]);
  }

  root(exp: number): NumericValue {
    if (!Number.isInteger(exp)) return this._makeExact(NaN);
    if (exp === 0) return this._makeExact(NaN);
    if (exp === 1) return this;

    if (this.isZero) return this;
    if (this.isOne) return this;
    // An odd root of −1 is −1 (real-root convention). An even root of −1 is
    // not −1: it is handled below like any even root of a negative real.
    if (this.isNegativeOne && Math.abs(exp) % 2 === 1) return this;

    // The square root of a negative real is imaginary (`sqrt()` handles it),
    // as in `MachineNumericValue.root`. Only the higher even roots of a
    // negative real are NaN in the float lanes.
    if (exp === 2) return this.sqrt();

    if (!this.isComplex) {
      if (this.decimal.isNegative()) {
        // Odd root of a negative real: real-root convention, matching
        // MachineNumericValue.root (e.g. (-8)^(1/3) = -2). Even roots of
        // negative reals are not real: NaN, also matching the machine path.
        if (exp % 2 === 0) return this._makeExact(NaN);
        if (exp === 3) return this.clone(this.decimal.cbrt());
        return this.clone(this.decimal.neg().ln().div(exp).exp().neg());
      }
      if (exp === 3) return this.clone(this.decimal.cbrt());
      // x^(1/n) via `nthRoot`, which computes it at full working precision and
      // snaps a perfect power to its exact integer root. (The earlier
      // `ln(x)/n |> exp` neither snapped — `Root(64,3)` printed 3.999…9 — nor,
      // before that, `pow(1/exp)` kept full precision.) (NU-P1-7)
      return this.clone(this.decimal.nthRoot(exp));
    }

    // Complex root:
    // z^(1/n) = (r^(1/n)) * (cos((θ + 2πk) / n) + i * sin((θ + 2πk) / n))
    // where z = r * (cos(θ) + i * sin(θ))

    const a = this.decimal;
    const b = this.imDecimal;

    // Small-component regime, a small imaginary part and a positive real
    // part:
    //   (a + ib)^(1/n) = a^(1/n)·(1 + i·b/(n·a))
    // The next term is of relative size (b/a)², below the working precision.
    // The polar form would lose the imaginary part: the angle `b/a` is below
    // the rounding error of `arg`. (Near the negative real axis, and for a
    // small real part, the parts of the root are not small, and the polar
    // form keeps them.)
    if (exp > 0 && a.isPositive() && isSmallBeside(b, a)) {
      return guarded(this, () => {
        const r = a.nthRoot(exp);
        return [r, r.mul(b).div(a.mul(exp))];
      });
    }

    // Normal regime: the polar form, then a part that is only rounding noise
    // is removed (see `polarResult()`). The modulus of the root is
    // exp(ln(modulus)/exp) at full precision; `pow(1/exp)` rounded the
    // reciprocal to machine precision first. This is the principal root.
    return polarResult(this, guardDigits(BigDecimal.ONE), () => [
      modulus(a, b).ln().div(exp).exp(),
      BigDecimal.atan2(b, a).div(exp),
    ]);
  }

  sqrt(): NumericValue {
    if (this.isZero || this.isOne) return this;

    if (this.isComplex) {
      // Complex square root, with m = |a + bi|:
      //   sqrt(a + bi) = sqrt((m + a)/2) + i·sign(b)·sqrt((m − a)/2)
      // When |b| is small compared with |a|, one of `m + a` and `m − a` is
      // the difference of two almost equal values, and it loses most of its
      // digits (for `1 + 10^{-10}i`, `m − a` is 5·10^{-21}, below the
      // precision of `m`). Thus compute only the part with no cancellation
      // from its formula, and get the other part from the identity
      // re·im = b/2. The result has no roundoff dust, and it is not chopped.
      //
      // Every part is a big decimal: `sqrt(-1 + 10^{-800}i)` is
      // `5·10^{-801} + i`, and a polar form would lose the real part (at 21
      // digits, `atan2` rounds the angle of `-1 + 10^{-800}i` to π).
      const a = this.decimal;
      const b = this.imDecimal;
      // An infinite imaginary part: both parts of the root are infinite.
      if (!b.isFinite()) return this.clone({ re: Infinity, im: b });
      return guarded(this, () => {
        const m = modulus(a, b);
        if (!a.isNegative()) {
          const realPart = a.add(m).div(2).sqrt();
          return [realPart, b.div(realPart.mul(2))];
        }
        const imMagnitude = m.sub(a).div(2).sqrt();
        return [
          b.abs().div(imMagnitude.mul(2)),
          b.isNegative() ? imMagnitude.neg() : imMagnitude,
        ];
      });
    }

    if (this.decimal.isPositive()) return this.clone(this.decimal.sqrt());
    return this.clone({ im: this.decimal.neg().sqrt() });
  }

  gcd(other: NumericValue): NumericValue {
    if (this.isZero) return other;
    if (other.isZero) return this;

    if (this.isComplex || other.isComplex) return this._makeExact(NaN);
    if (!this.decimal.isInteger()) return this._makeExact(1);
    let b = other.bignumRe
      ? new BigDecimal(other.bignumRe)
      : new BigDecimal(other.re);
    if (!b.isInteger()) return this._makeExact(1);

    let a = this.decimal;
    while (!b.isZero()) {
      const t = b;
      b = a.mod(b);
      a = t;
    }
    return this.clone(a.abs());
  }

  abs(): NumericValue {
    if (!this.isComplex)
      return this.decimal.isPositive() ? this : this.clone(this.decimal.neg());

    return this.clone(modulus(this.decimal, this.imDecimal));
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this._makeExact(NaN);
    if (this.isNegativeInfinity) return this._makeExact(NaN);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);

    if (!this.isComplex) {
      if (this.isOne) return this._makeExact(0);
      // Negative real: principal branch ln(x) = ln|x| + iπ (both parts
      // divided by ln(base) when a base is given). Previously every negative
      // real except -1 returned NaN, disagreeing with the complex logarithm
      // used on the .N() path and with the exact ln(-1) = iπ.
      if (this.decimal.isNegative()) {
        const neg = this.decimal.neg();
        const pi = roundToPrecision(BigDecimal.PI);
        if (base === undefined) return this.clone({ re: neg.ln(), im: pi });
        return this.clone({
          re: neg.log(base),
          im: pi.div(new BigDecimal(base).ln()),
        });
      }

      if (base === undefined) return this.clone(this.decimal.ln());
      return this.clone(this.decimal.log(base));
    }

    // ln(a + bi) = ln(|a + bi|) + i * arg(a + bi)
    // With a base b: log_b(z) = ln(z) / ln(b), so BOTH the real and the
    // imaginary parts are divided by ln(b).
    const a = this.decimal;
    const b = this.imDecimal;
    return guarded(this, () => {
      let re: BigDecimal;
      let im: BigDecimal;
      if (a.isPositive() && isSmallBeside(b, a)) {
        // Small-component regime: ln(a + ib) = ln a + i·b/a. The next terms
        // are of relative size (b/a)², below the working precision, and
        // `atan2` loses the angle `b/a` when it is below its rounding error.
        re = a.ln();
        im = b.div(a);
      } else {
        re = modulus(a, b).ln();
        im = BigDecimal.atan2(b, a);
      }
      if (base === undefined) return [re, im];
      const lnBase = new BigDecimal(base).ln();
      return [re.div(lnBase), im.div(lnBase)];
    });
  }

  exp(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return this._makeExact(1);
    if (this.isNegativeInfinity) return this._makeExact(0);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);
    if (this.isComplex) {
      // Complex exponential:
      // exp(a + bi) = exp(a) * (cos(b) + i * sin(b))
      // with every part a big decimal at the working precision.
      const b = this.imDecimal;
      if (!b.isFinite()) return this._makeExact(NaN);

      // Small-component regime: for a small `b`, exp(a + ib) = e^a·(1 + ib).
      // The next terms are of relative size b², below the working precision.
      // `e^{i·10^{-800}}` is `1 + 10^{-800}i`, and no part is removed.
      if (isSmallBeside(b, BigDecimal.ONE)) {
        return guarded(this, () => {
          const e = this.decimal.exp();
          return [e, e.mul(b)];
        });
      }

      // Normal regime: a part that is only rounding noise is removed. The
      // modulus of the result is e^a, so a part is noise when its sine or
      // cosine factor is noise compared with 1: `e^{iπ}` is `-1`, and
      // `e^{iπ/2}` is `i`. The test is relative, so the imaginary part of
      // `e^{-40 + i}` (3.6e-18) is kept.
      return polarResult(this, guardDigits(BigDecimal.ONE), () => [
        this.decimal.exp(),
        b,
      ]);
    }
    return this.clone(this.decimal.exp());
  }

  floor(): NumericValue {
    if (this.isNaN || this.isComplex) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.floor())!);
  }

  ceil(): NumericValue {
    if (this.isNaN || this.isComplex) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.ceil())!);
  }

  round(): NumericValue {
    if (this.isNaN || this.isComplex) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.round())!);
  }

  eq(other: number | NumericValue): boolean {
    if (this.isNaN) return false;
    if (typeof other === 'number')
      return !this.isComplex && this.decimal.eq(other);
    // An exact operand compares the pair itself, reading its imaginary part
    // from the exact value: its double `im` is `0` for `10^{-800}i`, and
    // comparing it here would make an inexact `0` equal to that value from
    // this side only. Delegating keeps `eq` symmetric.
    if (other instanceof ExactNumericValue) return other.eq(this);
    if (other.isNaN) return false;
    // Every part is compared as a big decimal: the double `im` is `0` for
    // `10^{-800}`, `Infinity` for a finite `10^{800}`, and has 16 digits.
    if (this.isComplexInfinity || other.isComplexInfinity)
      return this.isComplexInfinity && other.isComplexInfinity;
    return (
      this.decimal.eq(other.bignumRe ?? other.re) &&
      this.imDecimal.eq(bigImaginaryPart(other))
    );
  }

  lt(other: number | NumericValue): boolean | undefined {
    // Complex values are unordered: any non-real operand → indeterminate
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal.lt(other);
    if (other.isComplex) return undefined;
    return this.decimal.lt(other.bignumRe ?? other.re);
  }

  lte(other: number | NumericValue): boolean | undefined {
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal.lte(other);
    if (other.isComplex) return undefined;
    return this.decimal.lte(other.bignumRe ?? other.re);
  }

  gt(other: number | NumericValue): boolean | undefined {
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal.gt(other);
    if (other.isComplex) return undefined;
    return this.decimal.gt(other.bignumRe ?? other.re);
  }

  gte(other: number | NumericValue): boolean | undefined {
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal.gte(other);
    if (other.isComplex) return undefined;
    return this.decimal.gte(other.bignumRe ?? other.re);
  }
}

function decimalToString(num: BigDecimal): string {
  // Convert the number to a string
  const numStr = num.toString();

  // An integer that `toString()` rendered in scientific notation is worth
  // re-rendering in fixed notation only when the fixed form would not end
  // in a long run of zeros (more than 5). A normalized `BigDecimal` has no
  // trailing zeros in its significand, so the fixed form's trailing-zero
  // count IS the exponent — an O(1) field read. (Deciding by building the
  // fixed string first and counting its zeros with a regex materialized a
  // string as large as the exponent — ~65 MB for `Gamma(1e7).N()` at
  // precision 500 — and the regex could throw a RangeError under memory
  // pressure, only for both to be discarded.)
  if (num.isInteger() && numStr.includes('e') && num.exponent <= 5)
    return num.toFixed(0);

  return numStr;
}

/** The number of guard digits of the complex kernels. */
const GUARD_DIGITS = 5;

/** The complex value whose two parts `compute()` returns. The parts are
 * computed with `GUARD_DIGITS` more digits, then each is rounded once to
 * the working precision: without the guard digits, a part formed from other
 * rounded parts (`b/(2·√((|z| + a)/2))`) can be one unit in the last place
 * away from the correctly rounded value. */
function guarded(
  v: BigNumericValue,
  compute: () => [BigDecimal, BigDecimal]
): BigNumericValue {
  const saved = BigDecimal.precision;
  let parts: [BigDecimal, BigDecimal];
  BigDecimal.precision = saved + GUARD_DIGITS;
  try {
    parts = compute();
  } finally {
    BigDecimal.precision = saved;
  }
  return v.clone({
    re: roundToPrecision(parts[0]),
    im: roundToPrecision(parts[1]),
  });
}

/** Round `x` to the working precision, `BigDecimal.precision`. */
function roundToPrecision(x: BigDecimal): BigDecimal {
  return x.toPrecision(BigDecimal.precision);
}

/**
 * Whether `x` is small beside `y`: `weight·|x|` is less than
 * `10^(2−precision)·|y|`, where `precision` is the working precision.
 *
 * When this is true, the first-order expansion of a complex kernel in the
 * small part (`e^{ib} = 1 + ib`, `ln(a + ib) = ln a + i·b/a`) is exact to
 * the working precision: the next term is of relative size
 * `(weight·x/y)²`. The complex kernels then use the expansion instead of the
 * polar form, which loses the small part (see `polarResult()`).
 */
function isSmallBeside(x: BigDecimal, y: BigDecimal, weight = 1): boolean {
  if (x.isZero() || y.isZero() || !x.isFinite() || !y.isFinite()) return false;
  return x.abs().mul(weight).lt(y.abs().mul(complexNoiseRatio()));
}

/** The modulus `√(a² + b²)`. When a part is small beside the other (see
 * `isSmallBeside()`), the modulus is the larger part: the correction is of
 * relative size `(b/a)²/2`, below the working precision, and the exact
 * squares of such parts can have thousands of digits. */
function modulus(a: BigDecimal, b: BigDecimal): BigDecimal {
  if (b.isZero() || isSmallBeside(b, a)) return a.abs();
  if (a.isZero() || isSmallBeside(a, b)) return b.abs();
  return a.mul(a).add(b.mul(b)).sqrt();
}

/** The number of guard digits of a polar computation whose angle is
 * multiplied by `n`: the rounding error of the angle is multiplied by `|n|`,
 * which costs about `log10(|n|)` digits. */
function guardDigits(n: BigDecimal): number {
  const magnitude = n.isZero() ? 0 : Math.max(0, n.abs().log(10).toNumber());
  return GUARD_DIGITS + Math.ceil(Number.isFinite(magnitude) ? magnitude : 0);
}

/** An estimate of `log10(√(a² + b²))`, computed at 17 digits: it decides
 * only whether a power overflows or underflows. */
function log10Modulus(a: BigDecimal, b: BigDecimal): number {
  const saved = BigDecimal.precision;
  BigDecimal.precision = 17;
  try {
    return modulus(a, b).log(10).toNumber();
  } finally {
    BigDecimal.precision = saved;
  }
}

/** The real part of `v` as a big decimal. The real part of an exact value
 * (a rational such as `2/3`) is computed with `GUARD_DIGITS` more digits than
 * the working precision, because it is an exponent: its rounding error is
 * multiplied by the logarithm of the base. */
function bigRealPart(v: NumericValue): BigDecimal {
  if (!v.isExact) return v.bignumRe ?? new BigDecimal(v.re);
  const saved = BigDecimal.precision;
  BigDecimal.precision = saved + GUARD_DIGITS;
  try {
    return v.bignumRe ?? new BigDecimal(v.re);
  } finally {
    BigDecimal.precision = saved;
  }
}

/**
 * `(a + ib)^n` for a positive integer `n`, by binary exponentiation. Each
 * product is computed at the working precision plus the guard digits of
 * `guardDigits(n)`, then each part is rounded to the working precision.
 *
 * No small part is removed. The products of big decimals introduce no noise
 * of the kind a polar computation makes at a multiple of π/2, so a small
 * part is the value for the given operand: at precision 21,
 * `(1 + 1.00000000000000000001i)^2` has the real part
 * `1 − 1.00000000000000000001² ≈ −2e-20`, as the product `z·z` has. A
 * Gaussian integer operand gives exact parts: `(1 + i)^4` is `-4 + 0i`.
 */
function integerPower(
  v: BigNumericValue,
  a: BigDecimal,
  b: BigDecimal,
  n: bigint
): BigNumericValue {
  const saved = BigDecimal.precision;
  let re: BigDecimal;
  let im: BigDecimal;
  BigDecimal.precision = saved + guardDigits(new BigDecimal(n));
  try {
    const mul = (
      [x0, x1]: [BigDecimal, BigDecimal],
      [y0, y1]: [BigDecimal, BigDecimal]
    ): [BigDecimal, BigDecimal] => [
      roundToPrecision(x0.mul(y0).sub(x1.mul(y1))),
      roundToPrecision(x0.mul(y1).add(x1.mul(y0))),
    ];
    let result: [BigDecimal, BigDecimal] | undefined;
    let base: [BigDecimal, BigDecimal] = [a, b];
    let k = n;
    while (true) {
      if (k % BigInt(2) === BigInt(1))
        result = result ? mul(result, base) : base;
      k = k / BigInt(2);
      if (k === BigInt(0)) break;
      base = mul(base, base);
    }
    [re, im] = result!;
  } finally {
    BigDecimal.precision = saved;
  }
  return v.clone({ re: roundToPrecision(re), im: roundToPrecision(im) });
}

/**
 * The complex value `mag·(cos θ + i·sin θ)` of a kernel in polar form (a
 * complex power, root or exponential), with the rounding noise removed.
 *
 * `compute()` returns `[mag, θ]`. It runs with `extra` guard digits, and so
 * do the cosine and the sine. Then each part is rounded to the working
 * precision, and a part that is at most `10^(2−precision)` times the modulus
 * `mag` is removed (`isComplexDust()`): a polar computation at a multiple of
 * π/2 leaves such a part, and it is only rounding (`e^{iπ}` computes
 * `-1 + 1.2e-21i` at 21 digits, because π has 21 digits). A legitimate part
 * of that size does not reach this function for a real exponent: when a
 * part is that small, the kernels use a first-order expansion instead (see
 * `isSmallBeside()`), and `pow` computes separately the small angle of a base
 * near the negative real axis. For a complex exponent it can: at 40 digits,
 * `(-4 + 10^{-800}i)^{1.5 + 10^{-50}i}` gives `-8i`, where the real part is
 * about `1.1·10^{-49}`. The
 * third element that `compute()` returns is `true` for a small angle that is
 * such a legitimate part: the result is then `mag·(1 + iθ)`, not chopped.
 */
function polarResult(
  v: BigNumericValue,
  extra: number,
  compute: () => [BigDecimal, BigDecimal, boolean?]
): BigNumericValue {
  const saved = BigDecimal.precision;
  let mag: BigDecimal;
  let re: BigDecimal;
  let im: BigDecimal;
  let smallAngle: boolean | undefined;
  BigDecimal.precision = saved + extra;
  try {
    const [m, theta, small] = compute();
    mag = m;
    smallAngle = small;
    // A small angle that is not the result of a cancellation (the caller
    // says so) is the small-component regime: `mag·(1 + iθ)`, not chopped.
    re = smallAngle ? m : m.mul(theta.cos());
    im = smallAngle ? m.mul(theta) : m.mul(theta.sin());
  } finally {
    BigDecimal.precision = saved;
  }
  re = roundToPrecision(re);
  im = roundToPrecision(im);
  if (smallAngle) return v.clone({ re, im });
  return v.clone({
    re: isComplexDust(re, mag) ? BigDecimal.ZERO : re,
    im: isComplexDust(im, mag) ? BigDecimal.ZERO : im,
  });
}

/** The imaginary part of `v` as a big decimal: `bignumIm` when the value has
 * one (an `ExactNumericValue`, whose imaginary part can be too small or too
 * large for a double), otherwise the double `im` converted to a big decimal.
 * A big-decimal complex product or quotient must read this, not `im`: the
 * double is `0` or `±Infinity` for such a part. */
function bigImaginaryPart(v: NumericValue): BigDecimal {
  return v.bignumIm ?? new BigDecimal(v.im);
}
