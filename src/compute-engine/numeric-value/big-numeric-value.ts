import { BigDecimal } from '../../big-decimal';
import type { SmallInteger } from '../numerics/types';
import { NumericValue, NumericValueData } from './types';
import { ExactNumericValue } from './exact-numeric-value';
import { isInMachineRange } from '../numerics/numeric-bignum';
import { MathJsonExpression } from '../../math-json/types';
import { numberToExpression } from '../numerics/expression';
import { numberToString } from '../numerics/strings';
import { bigint } from '../numerics/bigint';
import { NumericPrimitiveType } from '../../common/type/types';

export class BigNumericValue extends NumericValue {
  declare __brand: 'BigNumericValue';

  decimal: BigDecimal;

  constructor(value: number | BigDecimal | NumericValueData) {
    super();

    if (typeof value === 'number') {
      this.decimal = new BigDecimal(value);
      this.im = 0;
    } else if (value instanceof BigDecimal) {
      this.decimal = value;
      this.im = 0;
    } else {
      const decimal =
        value.re instanceof BigDecimal
          ? value.re
          : new BigDecimal(value.re ?? 0);

      this.decimal = decimal;
      this.im = value.im ?? 0;
    }

    // NaN-ness must be coherent: a value with a NaN component is NaN.
    // (e.g. `sqrt()` of a NaN value produces im = √(−NaN) = NaN with a
    // valid decimal — coerce rather than carry an incoherent value)
    if (this.decimal.isNaN()) this.im = NaN;
    else if (isNaN(this.im)) this.decimal = BigDecimal.NAN;
  }

  get type(): NumericPrimitiveType {
    if (this.isNaN) return 'number';
    if (this.isComplexInfinity) return 'complex';
    if (this.im !== 0) {
      if (this.decimal.isZero()) return 'imaginary';
      return 'finite_complex';
    }
    if (!this.decimal.isFinite()) return 'non_finite_number';
    if (this.decimal.isInteger()) return 'finite_integer';
    return 'finite_real';
  }

  get isExact(): boolean {
    return this.im === 0 && this.decimal.isInteger();
  }

  get asExact(): ExactNumericValue | undefined {
    if (!this.isExact) return undefined;
    return this._makeExact(bigint(this.decimal)!);
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
    if (this.im === 0) {
      if (isInMachineRange(this.decimal)) return this.decimal.toNumber();
      return { num: decimalToString(this.decimal) };
    }
    if (isInMachineRange(this.decimal))
      return [
        'Complex',
        numberToExpression(this.decimal.toNumber()),
        numberToExpression(this.im),
      ];
    return [
      'Complex',
      { num: decimalToString(this.decimal) },
      numberToExpression(this.im),
    ];
  }

  /**
   * Return a human-readable string representation.
   *
   * The real part is rounded to `BigDecimal.precision` significant digits
   * so that noise digits from precision-bounded operations (division,
   * transcendentals) are not displayed. The imaginary part uses native
   * `Number.toString()` (always machine precision).
   *
   * For the full unrounded value, use `toJSON()`.
   */
  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';
    if (this.im === 0)
      return decimalToString(this.decimal.toPrecision(BigDecimal.precision));
    if (this.decimal.isZero()) {
      if (this.im === 1) return 'i';
      if (this.im === -1) return '-i';
      return `${numberToString(this.im)}i`;
    }

    if (this.isComplexInfinity) return '~oo';

    let im = '';
    if (this.im === 1) im = '+ i';
    else if (this.im === -1) im = '- i';
    else if (this.im > 0) im = `+ ${this.im}i`;
    else im = `- ${-this.im}i`;

    return `(${decimalToString(this.decimal)} ${im})`;
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
      this.im === 0 &&
      !this.decimal.isFinite() &&
      !this.decimal.isNaN() &&
      this.decimal.isPositive()
    );
  }

  get isNegativeInfinity(): boolean {
    return (
      this.im === 0 &&
      !this.decimal.isFinite() &&
      !this.decimal.isNaN() &&
      this.decimal.isNegative()
    );
  }

  get isComplexInfinity(): boolean {
    return !Number.isFinite(this.im) && !Number.isNaN(this.im);
  }

  get isZero(): boolean {
    return this.im === 0 && this.decimal.isZero();
  }

  isZeroWithTolerance(tolerance: number | BigDecimal): boolean {
    // The imaginary part (always a machine number) is compared against the
    // tolerance too: a residual imaginary epsilon must not make the
    // difference "provably non-zero".
    const tolNum =
      typeof tolerance === 'number' ? tolerance : tolerance.toNumber();
    if (Math.abs(this.im) > tolNum) return false;
    const tol =
      typeof tolerance === 'number' ? new BigDecimal(tolerance) : tolerance;
    return this.decimal.abs().lte(tol);
  }

  get isOne(): boolean {
    return this.im === 0 && this.decimal.eq(1);
  }

  get isNegativeOne(): boolean {
    return this.im === 0 && this.decimal.eq(-1);
  }

  sgn(): -1 | 0 | 1 | undefined {
    if (this.im !== 0) return undefined;
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
    return this.clone({ re: this.decimal.neg(), im: -this.im });
  }

  inv(): BigNumericValue {
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;
    if (this.im === 0) return this.clone(this.decimal.inv());

    // 1/z = conj(z) / |z|²  (not / |z|).
    const d = this.re * this.re + this.im * this.im;
    const bigD = this.decimal.mul(this.decimal).add(this.im * this.im);
    return this.clone({ re: this.decimal.div(bigD), im: -this.im / d });
  }

  add(other: number | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 0) return this;
      return this.clone({ re: this.decimal.add(other), im: this.im });
    }

    if (other.isZero) return this;
    // NOTE: must read `other.bignumRe` (full precision), not pass `other`
    // directly to `clone()` — the BigNumericValue constructor reads `.re`,
    // which is `decimal.toNumber()` (machine precision), silently truncating a
    // full-precision bignum. This path is hit on the first iteration of any
    // zero-seeded accumulator loop (e.g. ExactNumericValue.sum over ≥3 inexact
    // values), which would otherwise cap the sum at ~16 digits.
    if (this.isZero)
      return this.clone({ re: other.bignumRe ?? other.re, im: other.im });

    return this.clone({
      re: this.decimal.add(other.bignumRe ?? other.re),
      im: this.im + other.im,
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
      return this.clone({ re: other.bignumRe ?? other.re, im: other.im });
    }
    if (typeof other === 'number') {
      if (this.im === 0) return this.clone(this.decimal.mul(other));

      return this.clone({
        re: this.decimal.mul(other),
        im: this.im * other,
      });
    }
    if (other instanceof BigDecimal) {
      if (this.im === 0) return this.clone(this.decimal.mul(other));

      return this.clone({
        re: this.decimal.mul(other),
        im: this.im * other.toNumber(),
      });
    }

    if (this.isNegativeOne) {
      const n = other.neg();
      return this.clone({ re: n.bignumRe ?? n.re, im: n.im });
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

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal.mul(other.bignumRe ?? other.re));

    return this.clone({
      re: this.decimal.mul(other.bignumRe ?? other.re).sub(this.im * other.im),
      im: this.re * other.im + this.im * other.re,
    });
  }

  div(other: SmallInteger | NumericValue): NumericValue {
    if (typeof other === 'number') {
      if (other === 1) return this;
      if (other === -1) return this.neg();
      if (other === 0) return this.clone(NaN);
      return this.clone({
        re: this.decimal.div(other),
        im: this.im / other,
      });
    }

    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) {
      // a/0: 0/0 and NaN/0 are NaN; otherwise a signed (or, for a complex
      // numerator, an unsigned) infinity — the previous code always returned
      // +Infinity, dropping the sign (ExactNumericValue is sign-aware).
      if (this.isZero || this.isNaN) return this.clone(NaN);
      if (this.im !== 0) return this.clone({ im: Infinity });
      return this.clone(this.decimal.isNegative() ? -Infinity : Infinity);
    }

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal.div(other.bignumRe ?? other.re));

    const [a, b] = [this.re, this.im];
    const [c, d] = [other.re, other.im];
    const denominator = c * c + d * d;
    const bigC = other.bignumRe ?? new BigDecimal(other.re);
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

    if (exponent instanceof NumericValue) {
      if (exponent.isNaN) return this.clone(NaN);
      if (exponent.isZero) return this.clone(1);
      if (exponent.isOne) return this;
      if (exponent.im) {
        exponent = { re: exponent.re, im: exponent.im };
      } else exponent = exponent.re;
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
      if (im === 0) {
        exponent = re; // fallthrough and continue
      } else {
        // Complex Infinity ^ z -> NaN
        if (this.im === Infinity) return this.clone(NaN);
        if (this.isNegativeInfinity) return this.clone(0);
        if (this.isPositiveInfinity) return this.clone({ im: Infinity });

        // z^(re + i·im) = exp((re + i·im) · Ln z), with Ln z = ln|z| + i·arg(z):
        //   |z^w|     = exp(re·ln|z| − im·arg z)
        //   arg(z^w)  = re·arg z + im·ln|z|
        // The previous code used ln(Re z) instead of ln|z| and dropped the
        // exp(−im·arg z) magnitude factor — correct only for positive real z.
        if (this.isZero) return re > 0 ? this.clone(0) : this.clone(NaN);
        const a = this.decimal;
        const b = this.im;
        const lnMod = a
          .mul(a)
          .add(b * b)
          .sqrt()
          .ln();
        const arg = BigDecimal.atan2(b, a);
        const realExp = lnMod.mul(re).sub(arg.mul(im));
        const imagExp = arg.mul(re).add(lnMod.mul(im));
        const mag = realExp.exp();
        return this.clone({
          re: mag.mul(imagExp.cos()),
          im: chop(mag.mul(imagExp.sin()).toNumber()),
        });
      }
    }

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
      if (exponent < 0) return this.clone({ im: Infinity }); // Complex/unsigned infinity
    }

    if (exponent < 0) return this.pow(-exponent).inv();

    if (this.im === 0) {
      return this.clone(this.decimal.pow(exponent));
    }

    const a = this.decimal;
    const b = this.im;
    const modulus = a
      .mul(a)
      .add(b * b)
      .sqrt();
    const argument = BigDecimal.atan2(b, a);
    const newModulus = modulus.pow(exponent);
    const newArgument = argument.mul(exponent);
    return this.clone({
      re: newModulus.mul(newArgument.cos()),
      im: chop(newModulus.mul(newArgument.sin()).toNumber()),
    });
  }

  root(exp: number): NumericValue {
    if (!Number.isInteger(exp)) return this._makeExact(NaN);
    if (exp === 0) return this._makeExact(NaN);
    if (exp === 1) return this;

    if (this.isZero) return this;
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;

    if (this.im === 0) {
      if (this.decimal.isNegative()) {
        // Odd root of a negative real: real-root convention, matching
        // MachineNumericValue.root (e.g. (-8)^(1/3) = -2). Even roots of
        // negative reals are not real: NaN, also matching the machine path.
        if (exp % 2 === 0) return this._makeExact(NaN);
        if (exp === 3) return this.clone(this.decimal.cbrt());
        return this.clone(this.decimal.neg().ln().div(exp).exp().neg());
      }
      if (exp === 2) return this.clone(this.decimal.sqrt());
      if (exp === 3) return this.clone(this.decimal.cbrt());
      // x^(1/n) as exp(ln(x)/n), computed in full precision. The previous
      // `pow(1 / exp)` rounded the reciprocal to a machine double first, so the
      // result had only ~17 correct digits regardless of working precision.
      return this.clone(this.decimal.ln().div(exp).exp());
    }

    // Complex root:
    // z^(1/n) = (r^(1/n)) * (cos((θ + 2πk) / n) + i * sin((θ + 2πk) / n))
    // where z = r * (cos(θ) + i * sin(θ))

    const a = this.decimal;
    const b = this.im;
    const modulus = a
      .mul(a)
      .add(b * b)
      .sqrt();
    const argument = BigDecimal.atan2(b, a);
    // Full-precision modulus^(1/exp) = exp(ln(modulus)/exp); `pow(1/exp)`
    // rounded the reciprocal to machine precision first.
    const newModulus = modulus.ln().div(exp).exp();
    const newArgument = argument.div(exp);

    // Return the principal root
    return this.clone({
      re: newModulus.mul(newArgument.cos()),
      im: chop(newModulus.mul(newArgument.sin()).toNumber()),
    });
  }

  sqrt(): NumericValue {
    if (this.isZero || this.isOne) return this;

    if (this.im !== 0) {
      // Complex square root:
      // sqrt(a + bi) = sqrt((a + sqrt(a^2 + b^2)) / 2) + i * sign(b) * sqrt((sqrt(a^2 + b^2) - a) / 2)
      const a = this.decimal;
      const b = this.im;
      const modulus = a
        .mul(a)
        .add(b * b)
        .sqrt();

      // Both a + |z| and |z| − a are mathematically ≥ 0, but either can
      // round epsilon-negative when |b| ≪ |a| — clamp to avoid a NaN from
      // sqrt(−ε)
      const reSq = a.add(modulus).div(2);
      const imSq = modulus.sub(a).div(2);
      const realPart = reSq.isNegative() ? BigDecimal.ZERO : reSq.sqrt();
      const imaginaryPart = chop(
        Math.sign(b) * (imSq.isNegative() ? 0 : imSq.sqrt().toNumber())
      );
      return this.clone({ re: realPart, im: imaginaryPart });
    }

    if (this.decimal.isPositive()) return this.clone(this.decimal.sqrt());
    return this.clone({ im: Math.sqrt(-this.re) });
  }

  gcd(other: NumericValue): NumericValue {
    if (this.isZero) return other;
    if (other.isZero) return this;

    if (this.im !== 0 || other.im !== 0) return this._makeExact(NaN);
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
    if (this.im === 0)
      return this.decimal.isPositive() ? this : this.clone(this.decimal.neg());

    return this.clone(
      this.decimal
        .pow(2)
        .add(this.im ** 2)
        .sqrt()
    );
  }

  ln(base?: number): NumericValue {
    if (this.isZero) return this._makeExact(NaN);
    if (this.isNegativeInfinity) return this._makeExact(NaN);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);

    if (this.im === 0) {
      if (this.isOne) return this._makeExact(0);
      // Negative real: principal branch ln(x) = ln|x| + iπ (both parts
      // divided by ln(base) when a base is given). Previously every negative
      // real except -1 returned NaN, disagreeing with the complex logarithm
      // used on the .N() path and with the exact ln(-1) = iπ.
      if (this.decimal.isNegative()) {
        const neg = this.decimal.neg();
        if (base === undefined) return this.clone({ re: neg.ln(), im: Math.PI });
        return this.clone({ re: neg.log(base), im: Math.PI / Math.log(base) });
      }

      if (base === undefined) return this.clone(this.decimal.ln());
      return this.clone(this.decimal.log(base));
    }

    // ln(a + bi) = ln(|a + bi|) + i * arg(a + bi)
    // With a base b: log_b(z) = ln(z) / ln(b), so BOTH the real and the
    // imaginary parts are divided by ln(b).
    const a = this.decimal;
    const b = this.im;
    const modulus = a
      .mul(a)
      .add(b * b)
      .sqrt();
    const argument = BigDecimal.atan2(b, a).toNumber();

    if (base === undefined)
      return this.clone({ re: modulus.ln(), im: argument });

    return this.clone({ re: modulus.log(base), im: argument / Math.log(base) });
  }

  exp(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return this._makeExact(1);
    if (this.isNegativeInfinity) return this._makeExact(0);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);
    if (this.im !== 0) {
      // Complex exponential:
      // exp(a + bi) = exp(a) * (cos(b) + i * sin(b))
      const e = this.decimal.exp();
      return this.clone({
        re: e.mul(chop(Math.cos(this.im))),
        im: chop(e.mul(Math.sin(this.im)).toNumber()),
      });
    }
    return this.clone(this.decimal.exp());
  }

  floor(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.floor())!);
  }

  ceil(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.ceil())!);
  }

  round(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (this.decimal.isInteger()) return this;
    return this._makeExact(bigint(this.decimal.round())!);
  }

  eq(other: number | NumericValue): boolean {
    if (this.isNaN) return false;
    if (typeof other === 'number')
      return this.im === 0 && this.decimal.eq(other);
    if (other.isNaN) return false;
    if (!Number.isFinite(this.im)) return !Number.isFinite(other.im);
    return (
      this.decimal.eq(other.bignumRe ?? other.re) && this.im - other.im === 0
    );
  }

  lt(other: number | NumericValue): boolean | undefined {
    // Complex values are unordered: any non-real operand → indeterminate
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal.lt(other);
    if (other.im !== 0) return undefined;
    return this.decimal.lt(other.bignumRe ?? other.re);
  }

  lte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal.lte(other);
    if (other.im !== 0) return undefined;
    return this.decimal.lte(other.bignumRe ?? other.re);
  }

  gt(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal.gt(other);
    if (other.im !== 0) return undefined;
    return this.decimal.gt(other.bignumRe ?? other.re);
  }

  gte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal.gte(other);
    if (other.im !== 0) return undefined;
    return this.decimal.gte(other.bignumRe ?? other.re);
  }
}

function decimalToString(num: BigDecimal): string {
  // Convert the number to a string
  const numStr = num.toString();

  // Check if the number is in scientific notation
  if (num.isInteger() && numStr.includes('e')) {
    // Convert the number to a fixed notation string with no decimal places
    const fixedStr = num.toFixed(0);

    // Check the number of trailing zeros
    const trailingZeros = fixedStr.match(/0+$/);
    const trailingZerosCount = trailingZeros ? trailingZeros[0].length : 0;

    // If there are 5 or fewer trailing zeros, return the fixed notation string
    if (trailingZerosCount <= 5) {
      return fixedStr;
    }
  }

  // If the number is not in scientific notation or doesn't meet the criteria, return the original string
  return numStr;
}

/* Use with trig functions to avoid rounding errors.
   Note that we use 1e14 as the tolerance, as this is applied to a machine
   number and is independent of the compute engine tolerance */
function chop(n: number): number {
  return Math.abs(n) <= 1e-14 ? 0 : n;
}
