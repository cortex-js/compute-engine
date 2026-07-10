import { BigDecimal } from '../../big-decimal/index.js';
import type { SmallInteger } from '../numerics/types.js';
import { NumericValue, NumericValueData } from './types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { numberToString } from '../numerics/strings.js';
import { numberToExpression } from '../numerics/expression.js';
import { NumericPrimitiveType } from '../../common/type/types.js';
import { ExactNumericValue } from './exact-numeric-value.js';
import { machineNthRoot } from '../numerics/numeric.js';

export class MachineNumericValue extends NumericValue {
  declare __brand: 'MachineNumericValue';

  // synonymous with 're'; the JavasScript number representation of the 'real' part.
  decimal: number;

  constructor(value: number | BigDecimal | NumericValueData) {
    super();

    if (typeof value === 'number') {
      this.decimal = value;
      this.im = 0;
    } else if (value instanceof BigDecimal) {
      this.decimal = value.toNumber();
      this.im = 0;
    } else {
      const decimal =
        value.re === undefined
          ? 0
          : value.re instanceof BigDecimal
            ? value.re.toNumber()
            : value.re;

      this.decimal = decimal;
      this.im = value.im ?? 0;
      // Complex infinity or NaN?
      if (!isFinite(this.im)) this.decimal = this.im;
    }

    // Don't expect im to ever be NaN. If it is, it would need to be handled
    // by setting the decimal portion to NaN as well.
    console.assert(!isNaN(this.im));
  }

  private _makeExact(value: number | bigint): ExactNumericValue {
    return new ExactNumericValue(value, (x) => this.clone(x));
  }

  get type(): NumericPrimitiveType {
    if (this.isNaN) return 'number';
    if (this.isComplexInfinity) return 'complex';

    if (this.im !== 0) {
      // A value with a non-finite component (e.g. ∞ + i) is not a *finite*
      // complex number. Match the ~oo convention of the isComplexInfinity
      // early-return above: any non-finite component types as `complex`, and
      // `imaginary` is reserved for a finite non-zero imaginary part paired
      // with a zero real part.
      if (!Number.isFinite(this.decimal) || !Number.isFinite(this.im))
        return 'complex';
      if (this.decimal === 0) return 'imaginary';
      return 'finite_complex';
    }
    if (!Number.isFinite(this.decimal)) return 'non_finite_number';
    if (Number.isInteger(this.decimal)) return 'finite_integer';
    return 'finite_real';
  }

  get isExact(): boolean {
    return this.im === 0 && Number.isInteger(this.decimal);
  }

  get asExact(): NumericValue | undefined {
    if (!this.isExact) return undefined;
    return this._makeExact(this.decimal);
  }

  toJSON(): MathJsonExpression {
    if (this.isNaN) return 'NaN';
    if (this.isPositiveInfinity) return 'PositiveInfinity';
    if (this.isNegativeInfinity) return 'NegativeInfinity';

    if (this.im === 0) return numberToExpression(this.decimal);
    return [
      'Complex',
      numberToExpression(this.decimal),
      numberToExpression(this.im),
    ];
  }

  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';
    if (this.im === 0) return numberToString(this.decimal);
    if (this.decimal === 0) {
      if (this.im === 1) return 'i';
      if (this.im === -1) return '-i';
      return `${numberToString(this.im)}i`;
    }

    if (this.isComplexInfinity) return '~oo';

    let im = '';
    if (this.im === 1) im = '+ i';
    else if (this.im === -1) im = '- i';
    else if (this.im > 0) im = `+ ${numberToString(this.im)}i`;
    else im = `- ${numberToString(-this.im)}i`;

    return `(${numberToString(this.decimal)} ${im})`;
  }

  clone(value: number | BigDecimal | NumericValueData) {
    return new MachineNumericValue(value);
  }

  get re(): number {
    return this.decimal;
  }

  get bignumRe(): BigDecimal | undefined {
    return undefined;
  }

  get numerator(): MachineNumericValue {
    return this;
  }

  get denominator(): NumericValue {
    return this._makeExact(1);
  }

  get isNaN(): boolean {
    return Number.isNaN(this.decimal);
  }

  get isPositiveInfinity(): boolean {
    return !Number.isFinite(this.decimal) && this.decimal > 0 && this.im === 0;
  }

  get isNegativeInfinity(): boolean {
    return !Number.isFinite(this.decimal) && this.decimal < 0 && this.im === 0;
  }

  get isComplexInfinity(): boolean {
    return !Number.isFinite(this.im) && !Number.isNaN(this.im);
  }

  get isZero(): boolean {
    return this.im === 0 && this.decimal === 0;
  }

  isZeroWithTolerance(tolerance: number | BigDecimal): boolean {
    const tol =
      tolerance instanceof BigDecimal ? tolerance.toNumber() : tolerance;
    // The imaginary part is compared against the tolerance too: a residual
    // imaginary epsilon (e.g. from subtracting two equal complex constants)
    // must not make the difference "provably non-zero".
    return Math.abs(this.im) <= tol && Math.abs(this.decimal) < tol;
  }

  get isOne(): boolean {
    return this.im === 0 && this.decimal === 1;
  }

  get isNegativeOne(): boolean {
    return this.im === 0 && this.decimal === -1;
  }

  sgn(): -1 | 0 | 1 | undefined {
    if (this.im !== 0 || !Number.isFinite(this.decimal)) return undefined;

    return Math.sign(this.decimal) as -1 | 0 | 1;
  }

  N(): NumericValue {
    return this;
  }

  neg(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return this;
    return this.clone({ re: -this.decimal, im: -this.im });
  }

  inv(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;
    if (this.im === 0) return this.clone(1 / this.decimal);

    // 1/z = conj(z) / |z|²  (not / |z|).
    const d = this.re * this.re + this.im * this.im;
    return this.clone({ re: this.decimal / d, im: -this.im / d });
  }

  add(other: number | NumericValue): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (typeof other === 'number') {
      if (other === 0) return this;
      return this.clone({ re: this.decimal + other, im: this.im });
    }
    if (other.isZero) return this;
    if (this.isZero)
      return this.clone({ re: other.bignumRe ?? other.re, im: other.im });

    return this.clone({
      re: this.decimal + other.re,
      im: this.im + other.im,
    });
  }

  sub(other: NumericValue): NumericValue {
    return this.add(other.neg());
  }

  mul(other: number | BigDecimal | NumericValue): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
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

    if (other instanceof BigDecimal) other = other.toNumber();
    if (other === 1) return this;
    if (other === -1) return this.neg();
    if (other === 0) {
      if (
        this.isPositiveInfinity ||
        this.isNegativeInfinity ||
        this.isComplexInfinity
      )
        return this._makeExact(NaN);
      return this.clone(0);
    }

    // We need to ensure that non-exact propagates, so clone value in case
    // it was an ExactNumericValue
    if (this.isOne) {
      if (typeof other === 'number' || other instanceof BigDecimal)
        return this.clone(other);
      return this.clone({ re: other.bignumRe ?? other.re, im: other.im });
    }
    if (typeof other === 'number') {
      if (this.im === 0) return this.clone(this.decimal * other);

      return this.clone({
        re: this.decimal * other,
        im: this.im * other,
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
        this.isPositiveInfinity ||
        this.isNegativeInfinity ||
        this.isComplexInfinity
      )
        return this._makeExact(NaN);
      return this.clone(0);
    }

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal * other.re);

    return this.clone({
      re: this.decimal * other.re - this.im * other.im,
      im: this.re * other.im + this.im * other.re,
    });
  }

  div(other: SmallInteger | NumericValue): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (typeof other === 'number') {
      if (other === 1) return this;
      if (other === -1) return this.neg();
      if (other === 0) return this.clone(NaN);
      return this.clone({
        re: this.decimal / other,
        im: this.im / other,
      });
    }

    if (other.isOne) return this;
    if (other.isNegativeOne) return this.neg();
    if (other.isZero) return this.clone(this.isZero ? NaN : Infinity);

    if (this.im === 0 && other.im === 0)
      return this.clone(this.decimal / other.re);

    const [a, b] = [this.decimal, this.im];
    const [c, d] = [other.re, other.im];
    const denominator = c * c + d * d;
    return this.clone({
      re: (a * c + b * d) / denominator,
      im: (b * c - a * d) / denominator,
    });
  }

  pow(exponent: number | { re: number; im: number }): NumericValue {
    console.assert(!Array.isArray(exponent));
    // if (Array.isArray(exponent)) exponent = exponent[0] / exponent[1];

    if (this.isNaN) return this._makeExact(NaN);
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
    // as sympy. See https://docs.sympy.org/1.6/modules/core.html#pow
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

        // z^(re + i·im) = exp((re + i·im) · Ln z), Ln z = ln|z| + i·arg(z):
        //   |z^w| = exp(re·ln|z| − im·arg z),  arg(z^w) = re·arg z + im·ln|z|.
        // The previous code used ln(Re z) and only the real part of z^re,
        // dropping both the imaginary part of the base and the magnitude
        // factor — correct only for positive real z.
        if (this.isZero) return re > 0 ? this.clone(0) : this.clone(NaN);
        const a = this.decimal;
        const b = this.im;
        const lnMod = 0.5 * Math.log(a * a + b * b);
        const arg = Math.atan2(b, a);
        const realExp = re * lnMod - im * arg;
        const imagExp = re * arg + im * lnMod;
        const mag = Math.exp(realExp);
        return this.clone({
          re: chop(mag * Math.cos(imagExp)),
          im: chop(mag * Math.sin(imagExp)),
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

    // Real base: 1/xⁿ. (Complex bases fall through to the De Moivre branch
    // below, which handles negative exponents too — using only `this.decimal`
    // here would drop the imaginary part.)
    if (exponent < 0 && this.im === 0)
      return this.clone(1 / this.decimal ** -exponent);

    if (this.im === 0) return this.clone(this.decimal ** exponent);

    const a = this.decimal;
    const b = this.im;
    const modulus = Math.sqrt(a * a + b * b);
    const argument = Math.atan2(b, a);
    const newModulus = modulus ** exponent;
    // De Moivre: zⁿ = |z|ⁿ · (cos(n·arg) + i·sin(n·arg)). The new argument is
    // n·arg, not argⁿ.
    const newArgument = argument * exponent;
    return this.clone({
      re: newModulus * Math.cos(newArgument),
      im: newModulus * Math.sin(newArgument),
    });
  }

  root(exponent: number): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (exponent === 0) return this.clone(NaN);

    if (this.isNaN) return this;
    if (this.isZero) return this;
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;

    if (exponent === 1) return this;
    if (exponent === 2) return this.sqrt();
    if (exponent === 3) return this.clone(Math.cbrt(this.decimal));

    if (this.im === 0) {
      if (this.decimal < 0) {
        if (exponent % 2 === 0) return this.clone(NaN);
        return this.clone(-machineNthRoot(-this.decimal, exponent));
      }
      return this.clone(machineNthRoot(this.decimal, exponent));
    }

    // Complex root:
    // z^(1/n) = (r^(1/n)) * (cos(θ/n) + i * sin(θ/n))
    const a = this.decimal;
    const b = this.im;
    const modulus = Math.hypot(a, b);
    const argument = Math.atan2(b, a);
    const newModulus = Math.pow(modulus, 1 / exponent);
    const newArgument = argument / exponent;

    return this.clone({
      re: newModulus * Math.cos(newArgument),
      im: newModulus * Math.sin(newArgument),
    });
  }

  sqrt(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero || this.isOne) return this;

    if (this.im !== 0) {
      // Complex square root:
      // sqrt(a + bi) = sqrt((a + sqrt(a^2 + b^2)) / 2) + i * sign(b) * sqrt((sqrt(a^2 + b^2) - a) / 2)
      const a = this.decimal;
      const b = this.im;
      const modulus = Math.sqrt(a * a + b * b);

      const realPart = Math.sqrt((a + modulus) / 2);
      const imaginaryPart = Math.sign(b) * Math.sqrt((modulus - a) / 2);
      return this.clone({ re: realPart, im: imaginaryPart });
    }

    if (this.decimal > 0) return this.clone(Math.sqrt(this.decimal));
    return this.clone({ im: Math.sqrt(-this.decimal) });
  }

  gcd(other: NumericValue): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return other;
    if (other.isZero) return this;

    if (this.im !== 0 || other.im !== 0) return this._makeExact(NaN);
    if (!Number.isInteger(this.decimal)) return this._makeExact(1);
    let b = other.re;
    if (!Number.isInteger(b)) return this._makeExact(1);

    let a = this.decimal;
    while (b !== 0) {
      const t = b;
      b = a % b;
      a = t;
    }
    return this.clone(Math.abs(a));
  }

  abs(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.im === 0)
      return this.decimal > 0 ? this : this.clone(-this.decimal);

    // abs(z) = √(z.real² + z.imaginary²)
    return this.clone(Math.sqrt(this.decimal ** 2 + this.im ** 2));
  }

  ln(base?: number): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return this._makeExact(NaN);
    if (this.isNegativeInfinity) return this._makeExact(NaN);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);

    if (this.im === 0) {
      if (this.isOne) return this._makeExact(0);
      // Negative real: principal branch ln(x) = ln|x| + iπ (both parts
      // divided by ln(base) when a base is given). Previously every negative
      // real except -1 returned NaN, disagreeing with the complex logarithm
      // used on the .N() path and with the exact ln(-1) = iπ.
      if (this.decimal < 0) {
        const lnBase = base === undefined ? 1 : Math.log(base);
        return this.clone({
          re: Math.log(-this.decimal) / lnBase,
          im: Math.PI / lnBase,
        });
      }

      if (base === undefined) return this.clone(Math.log(this.decimal));
      return this.clone(Math.log(this.decimal) / Math.log(base));
    }

    // ln(a + bi) = ln(|a + bi|) + i * arg(a + bi)
    // With a base b: log_b(z) = ln(z) / ln(b), so BOTH the real and the
    // imaginary parts are divided by ln(b).
    const a = this.decimal;
    const b = this.im;
    const modulus = Math.hypot(a, b);
    const argument = Math.atan2(b, a);

    const lnBase = base === undefined ? 1 : Math.log(base);

    return this.clone({
      re: Math.log(modulus) / lnBase,
      im: argument / lnBase,
    });
  }

  exp(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return this._makeExact(1);
    if (this.isNegativeInfinity) return this._makeExact(0);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);
    if (this.im !== 0) {
      // Complex exponential:
      // exp(a + bi) = exp(a) * (cos(b) + i * sin(b))
      const e = Math.exp(this.decimal);
      return this.clone({
        re: e * Math.cos(this.im),
        im: e * Math.sin(this.im),
      });
    }
    return this.clone(Math.exp(this.decimal));
  }

  floor(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (Number.isInteger(this.decimal)) return this;
    return this._makeExact(Math.floor(this.decimal));
  }

  ceil(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (Number.isInteger(this.decimal)) return this;
    return this._makeExact(Math.ceil(this.decimal));
  }

  round(): NumericValue {
    if (this.isNaN || this.im !== 0) return this._makeExact(NaN);
    if (Number.isInteger(this.decimal)) return this;
    return this._makeExact(Math.round(this.decimal));
  }

  eq(other: number | NumericValue): boolean {
    if (this.isNaN) return false;
    // Compare with `===`, not subtraction: `Infinity - Infinity` is `NaN`, so
    // a subtraction-based check made `Infinity.eq(Infinity)` false (and
    // disagreed with BigNumericValue).
    if (typeof other === 'number')
      return this.im === 0 && this.decimal === other;
    if (other.isNaN) return false;
    if (!Number.isFinite(this.im)) return !Number.isFinite(other.im);
    return this.decimal === other.re && this.im === other.im;
  }

  lt(other: number | NumericValue): boolean | undefined {
    // Complex values are unordered: any non-real operand → indeterminate
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal < other;
    if (other.im !== 0) return undefined;
    return this.decimal < other.re;
  }

  lte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal <= other;
    if (other.im !== 0) return undefined;
    return this.decimal <= other.re;
  }

  gt(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal > other;
    if (other.im !== 0) return undefined;
    return this.decimal > other.re;
  }

  gte(other: number | NumericValue): boolean | undefined {
    if (this.im !== 0) return undefined;
    if (typeof other === 'number') return this.decimal >= other;
    if (other.im !== 0) return undefined;
    return this.decimal >= other.re;
  }
}

function chop(n: number): number {
  return Math.abs(n) <= 1e-14 ? 0 : n;
}
