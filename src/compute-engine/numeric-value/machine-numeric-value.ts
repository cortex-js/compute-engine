import { BigDecimal } from '../../big-decimal/index.js';
import type { SmallInteger } from '../numerics/types.js';
import { NumericValue, NumericValueData } from './types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { numberToString } from '../numerics/strings.js';
import {
  floatComplexToExpression,
  floatToExpression,
  numberToExpression,
} from '../numerics/expression.js';
import { NumericPrimitiveType } from '../../common/type/types.js';
import { ExactNumericValue, withDoubleDigits } from './exact-numeric-value.js';
import {
  isOutsideNormalDoubleRange,
  machineNthRoot,
} from '../numerics/numeric.js';
import { Complex } from 'complex.js';
import { complexPow, complexQuotient } from '../numerics/numeric-complex.js';

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
      // Every part of this class is a double: a big-decimal imaginary part is
      // converted to the nearest double (`0` on underflow, `±Infinity` on
      // overflow), as the real part is above.
      this.im =
        value.im instanceof BigDecimal ? value.im.toNumber() : (value.im ?? 0);
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
      if (Number.isNaN(this.im)) return 'nan';
      if (!Number.isFinite(this.decimal)) return 'infinity';
      if (this.decimal === 0) return 'imaginary';
      return 'complex';
    }
    if (!Number.isFinite(this.decimal)) return 'infinity';
    if (Number.isInteger(this.decimal)) return 'integer';
    return 'real';
  }

  // A machine double is never exact, as a big decimal is never exact
  // (`BigNumericValue.isExact`). Whether a number is exact depends on how it
  // is written, not on its value: a literal with a fraction part (`2.0`) and
  // the result of a float computation are floats even when their value is an
  // integer. An exact integer is an `ExactNumericValue`: the engine factory
  // `_numericValue()` makes one for a safe-integer JavaScript number, and the
  // exact results of the kernels of this class use `_makeExact()`. Before,
  // this class was exact for every safe-integer value, so at
  // `precision: 'machine'` the literal `2.0` was exact and `\sin(2.0)` stayed
  // symbolic, while at a higher precision it evaluated to a float.
  get isExact(): boolean {
    return false;
  }

  get asExact(): NumericValue | undefined {
    return undefined;
  }

  toJSON(): MathJsonExpression {
    if (this.isNaN) return 'NaN';
    if (this.isPositiveInfinity) return 'PositiveInfinity';
    if (this.isNegativeInfinity) return 'NegativeInfinity';
    // A complex value whose imaginary part is infinite (and not NaN) is the
    // single point at infinity of the Riemann sphere, spelled `ComplexInfinity`.
    // An infinite real part with a finite imaginary part is not that point and
    // keeps the `Complex` spelling below. The big-decimal value and the
    // serializer both use the `ComplexInfinity` spelling; without this line
    // the machine value emitted `["Complex", <re>, "PositiveInfinity"]`, so
    // the MathJSON of the same pole differed between the two precisions.
    if (this.isComplexInfinity) return 'ComplexInfinity';

    // A machine value is a float, so an integer-valued value is written with
    // a fraction part (`{ num: "2.0" }`) to be read back as a float.
    if (!this.isComplex) return floatToExpression(this.decimal);
    // `+ 0` turns a negative zero part (the real part of `-1.1i`) into `0`:
    // the engine has no distinct negative zero
    return floatComplexToExpression([
      numberToExpression(this.decimal + 0),
      numberToExpression(this.im + 0),
    ]);
  }

  toString(): string {
    if (this.isZero) return '0';
    if (this.isOne) return '1';
    if (this.isNegativeOne) return '-1';
    if (!this.isComplex) return numberToString(this.decimal);
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
    return (
      !Number.isFinite(this.decimal) && this.decimal > 0 && !this.isComplex
    );
  }

  get isNegativeInfinity(): boolean {
    return (
      !Number.isFinite(this.decimal) && this.decimal < 0 && !this.isComplex
    );
  }

  get isComplexInfinity(): boolean {
    return !Number.isFinite(this.im) && !Number.isNaN(this.im);
  }

  /** True if the imaginary part is not zero. Every part of this class is a
   * double, so the double `im` is the imaginary part itself, not a
   * projection of it. */
  get isComplex(): boolean {
    return this.im !== 0;
  }

  get isZero(): boolean {
    return !this.isComplex && this.decimal === 0;
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
    return !this.isComplex && this.decimal === 1;
  }

  get isNegativeOne(): boolean {
    return !this.isComplex && this.decimal === -1;
  }

  sgn(): -1 | 0 | 1 | undefined {
    // Only a non-real or NaN value has no sign. A signed infinity keeps its
    // sign (`Math.sign(-Infinity)` is `-1`), matching `BigNumericValue.sgn()`.
    // Answering `undefined` for ±∞ made `Product` read an infinite
    // coefficient as POSITIVE through its `sgn() ?? 1` fallback, so
    // `-∞ · +∞` accumulated to `+∞` at machine precision only.
    if (this.isComplex || Number.isNaN(this.decimal)) return undefined;

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
    if (!this.isComplex) return this.clone(1 / this.decimal);

    // 1/z = conj(z) / |z|²  (not / |z|). For finite parts,
    // `complexQuotient()` scales the parts when |z|² overflows or underflows
    // (`1/(1e308 + 1e308i)` is `5e-309 − 5e-309i`, not `0`).
    if (Number.isFinite(this.decimal) && Number.isFinite(this.im))
      return this.clone(complexQuotient(1, 0, this.decimal, this.im));
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

      if (!this.isComplex) return this.clone(this.decimal * other);

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
      // A product with an exact rational is `(x · p) / q`, the order in which
      // JavaScript evaluates `x * p / q` and the double the kernels are
      // measured against: `x · (p / q)` gave `(7/6)·π` one unit in the last
      // place from `Math.PI * 7 / 6`, and `sin(7π/6)` four units from
      // `Math.sin` of the same angle. When `x · p` overflows a double the
      // quotient form is kept, so `(2/3)·1.5e308` stays finite.
      const r = exactMachineRational(other);
      if (r !== null) {
        const n = this.decimal * r[0];
        if (Number.isFinite(n) || !Number.isFinite(this.decimal))
          return this.clone(n / r[1]);
      }
      const x = other.re;
      // An exact value whose double projection underflows to 0, overflows
      // to ±∞ or is subnormal (`1/10^400`, `10^400/3`, `10^{-320}`) can still
      // give a product in the double range (`1e300 · 1/10^400` is `1e-100`).
      // In that case the product is computed from the big-decimal value of
      // the exact factor.
      if (outOfDoubleRange(other, x) && Number.isFinite(this.decimal))
        return this.clone(other.bignumRe!.mul(this.decimal));
      return this.clone(this.decimal * x);
    }

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

    if (!this.isComplex && !other.isComplex) {
      const x = other.re;
      // See `mul`: an exact divisor whose double projection is 0, ±∞ or
      // subnormal can still give a quotient in the double range.
      if (outOfDoubleRange(other, x) && Number.isFinite(this.decimal))
        return this.clone(
          withDoubleDigits(() =>
            new BigDecimal(this.decimal).div(other.bignumRe!)
          )
        );
      return this.clone(this.decimal / x);
    }

    const [a, b] = [this.decimal, this.im];
    const [c, d] = [other.re, other.im];
    // For finite parts, `complexQuotient()` scales the parts when an
    // intermediate value of the formula below overflows or underflows
    // (`(1e308 + 1e308i) / (1 + i)` is `1e308`, not `∞`).
    if (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Number.isFinite(c) &&
      Number.isFinite(d)
    )
      return this.clone(complexQuotient(a, b, c, d));
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
      if (exponent.isComplex) {
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
        // `complexPow()` computes this formula without forming `|z|`, and
        // removes no part: a small part of the value is kept
        // (`2^{10^{-100}i}` is `1 + 6.93·10^{-101}i`).
        const z = complexPow(
          new Complex(this.decimal, this.im),
          new Complex(re, im)
        );
        return this.clone({ re: z.re, im: z.im });
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
    if (exponent < 0 && !this.isComplex)
      return this.clone(1 / this.decimal ** -exponent);

    if (!this.isComplex) return this.clone(this.decimal ** exponent);

    // `complexPow()` has an exact power of a Gaussian integer for a small
    // integer exponent (`i^2` is `-1`, where the polar form gives
    // `-1 + 1.2e-16i`), takes the angle of a base on an axis or a diagonal
    // exactly, and removes no part.
    const z = complexPow(
      new Complex(this.decimal, this.im),
      new Complex(exponent, 0)
    );
    return this.clone({ re: z.re, im: z.im });
  }

  root(exponent: number): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (exponent === 0) return this.clone(NaN);

    if (this.isNaN) return this;
    if (this.isZero) return this;
    if (this.isOne) return this;
    // An odd root of −1 is −1 (real-root convention). An even root of −1 is
    // not −1: the square root is `i`, and the other even roots are handled
    // below like any negative real.
    if (this.isNegativeOne && Math.abs(exponent) % 2 === 1) return this;

    if (exponent === 1) return this;
    if (exponent === 2) return this.sqrt();
    // `Math.cbrt` reads only the real part: a complex radicand takes the
    // complex root below.
    if (exponent === 3 && !this.isComplex)
      return this.clone(Math.cbrt(this.decimal));

    if (!this.isComplex) {
      if (this.decimal < 0) {
        if (exponent % 2 === 0) return this.clone(NaN);
        return this.clone(-machineNthRoot(-this.decimal, exponent));
      }
      return this.clone(machineNthRoot(this.decimal, exponent));
    }

    // Complex root: the principal value of z^(1/n). `complexPow()` takes the
    // angle of a base on an axis or a diagonal exactly, and removes no part.
    const z = complexPow(
      new Complex(this.decimal, this.im),
      new Complex(1 / exponent, 0)
    );
    return this.clone({ re: z.re, im: z.im });
  }

  sqrt(): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero || this.isOne) return this;

    if (this.isComplex) {
      // Complex square root, with m = |a + bi|:
      //   sqrt(a + bi) = sqrt((m + a)/2) + i·sign(b)·sqrt((m − a)/2)
      // When |b| is small compared with |a|, one of `m + a` and `m − a` is
      // the difference of two almost equal values, and it loses most of its
      // digits (for `1 + 10^{-10}i`, m is exactly 1 as a double and `m − a`
      // is 0). Thus compute only the part with no cancellation from its
      // formula, and get the other part from the identity re·im = b/2.
      let a = this.decimal;
      let b = this.im;
      // An infinite imaginary part: both parts of the root are infinite.
      if (Math.abs(b) === Infinity) return this.clone({ re: Infinity, im: b });
      // The sum `m + |a|` can overflow to +∞ (a = b = 10^{308}), and the
      // sum of two subnormal doubles, divided by 2, can underflow to 0
      // (a = 0, b = 5·10^{-324}). Thus scale a very large or a very small
      // operand by a power of 4 first: sqrt(4^k·z) = 2^k·sqrt(z). The
      // multiplications by powers of 2 do not change the digits.
      const largest = Math.max(Math.abs(a), Math.abs(b));
      let scale = 1;
      if (largest > 2 ** 1020) {
        a /= 4;
        b /= 4;
        scale = 2;
      } else if (largest < 2 ** -1000) {
        a *= 2 ** 104;
        b *= 2 ** 104;
        scale = 2 ** -52;
      }
      // `Math.hypot` does not overflow or underflow on a·a or b·b.
      const modulus = Math.hypot(a, b);
      if (a >= 0) {
        const realPart = Math.sqrt((a + modulus) / 2);
        return this.clone({
          re: scale * realPart,
          im: scale * (b / (2 * realPart)),
        });
      }
      const imMagnitude = Math.sqrt((modulus - a) / 2);
      return this.clone({
        re: scale * (Math.abs(b) / (2 * imMagnitude)),
        im: scale * Math.sign(b) * imMagnitude,
      });
    }

    if (this.decimal > 0) return this.clone(Math.sqrt(this.decimal));
    return this.clone({ im: Math.sqrt(-this.decimal) });
  }

  gcd(other: NumericValue): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return other;
    if (other.isZero) return this;

    if (this.isComplex || other.isComplex) return this._makeExact(NaN);
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
    if (!this.isComplex)
      return this.decimal > 0 ? this : this.clone(-this.decimal);

    // abs(z) = √(z.real² + z.imaginary²). A square is not a normal double
    // when the largest part `m` is below about 2⁻⁵¹¹ (it underflows, and
    // `|3e-200 + 4e-200i|` would be 0) or above about 2⁵¹¹ (it overflows,
    // and `|1e200 + 1e200i|` would be ∞). For a finite `m` outside
    // [2⁻⁵⁰⁰, 2⁵⁰⁰], the parts are first multiplied by a power of 2 `s`,
    // which is exact, and the result is divided by `s`. In that range, the
    // formula is used as it is, so the result does not change there.
    const re = this.decimal;
    const im = this.im;
    const m = Math.max(Math.abs(re), Math.abs(im));
    if (Number.isFinite(m) && (m < 2 ** -500 || m > 2 ** 500)) {
      const s = m < 2 ** -500 ? 2 ** 600 : 2 ** -600;
      return this.clone(Math.sqrt((re * s) ** 2 + (im * s) ** 2) / s);
    }
    return this.clone(Math.sqrt(re ** 2 + im ** 2));
  }

  ln(base?: number): NumericValue {
    if (this.isNaN) return this._makeExact(NaN);
    if (this.isZero) return this._makeExact(NaN);
    if (this.isNegativeInfinity) return this._makeExact(NaN);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);

    if (!this.isComplex) {
      // A float argument gives a float result: `ln(1.0)` is the float `0`.
      if (this.isOne) return this.clone(0);
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
      // A base of 10 or 2 uses its own primitive, as the `N()` route, the
      // machine list kernels (`machine-broadcast.ts`) and the compiled code
      // do: `Math.log10(3)` and `Math.log(3) / Math.log(10)` differ in the
      // last digit, and the quotient is one ulp off at some powers of the
      // base.
      if (base === 10) return this.clone(Math.log10(this.decimal));
      if (base === 2) return this.clone(Math.log2(this.decimal));
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
    // A float argument gives a float result: `exp(0.0)` is the float `1`.
    if (this.isZero) return this.clone(1);
    if (this.isNegativeInfinity) return this._makeExact(0);
    if (this.isPositiveInfinity) return this._makeExact(Infinity);
    if (this.isComplex) {
      // Complex exponential:
      // exp(a + bi) = exp(a) * (cos(b) + i * sin(b))
      // No part is removed: `e^{3.141592653589793i}` is
      // `-1 + 1.22·10^{-16}i`, the value at that double. An exact `e^{iπ}`
      // is reduced exactly before it becomes a float (`exactEulerN`,
      // `boxed-expression/arithmetic-power.ts`).
      const e = Math.exp(this.decimal);
      return this.clone({
        re: e * Math.cos(this.im),
        im: e * Math.sin(this.im),
      });
    }
    return this.clone(Math.exp(this.decimal));
  }

  floor(): NumericValue {
    if (this.isNaN || this.isComplex) return this._makeExact(NaN);
    if (Number.isInteger(this.decimal)) return this;
    return this._makeExact(Math.floor(this.decimal));
  }

  ceil(): NumericValue {
    if (this.isNaN || this.isComplex) return this._makeExact(NaN);
    if (Number.isInteger(this.decimal)) return this;
    return this._makeExact(Math.ceil(this.decimal));
  }

  round(): NumericValue {
    if (this.isNaN || this.isComplex) return this._makeExact(NaN);
    if (Number.isInteger(this.decimal)) return this;
    return this._makeExact(Math.round(this.decimal));
  }

  eq(other: number | NumericValue): boolean {
    if (this.isNaN) return false;
    // Compare with `===`, not subtraction: `Infinity - Infinity` is `NaN`, so
    // a subtraction-based check made `Infinity.eq(Infinity)` false (and
    // disagreed with BigNumericValue).
    if (typeof other === 'number')
      return !this.isComplex && this.decimal === other;
    // An exact operand compares the pair itself, reading its imaginary part
    // from the exact value: its double `im` is `0` for `10^{-800}i`, and
    // comparing it here would make an inexact `0` equal to that value from
    // this side only. Delegating keeps `eq` symmetric.
    if (other instanceof ExactNumericValue) return other.eq(this);
    // A big-decimal operand (the only other lane with a `bignumRe`) compares
    // the pair itself, with its parts as big decimals: comparing its double
    // projections here would make `1 + (1 + 10^{-20})i` equal to `1 + i`
    // from this side only. Delegating keeps `eq` symmetric.
    if (other.bignumRe !== undefined) return other.eq(this);
    if (other.isNaN) return false;
    if (!Number.isFinite(this.im)) return !Number.isFinite(other.im);
    return this.decimal === other.re && this.im === other.im;
  }

  // An exact operand orders the pair itself (`ExactNumericValue._order()`,
  // reversed): its bigint magnitude may lie outside the double range or
  // within an ulp of this value, and the exact lane compares such a pair
  // exactly where `this.decimal < other.re` read a projection. This keeps
  // `a.lt(b)` and `b.gt(a)` in agreement across the two lanes.
  lt(other: number | NumericValue): boolean | undefined {
    // Complex values are unordered: any non-real operand → indeterminate
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal < other;
    if (other.isComplex) return undefined;
    if (other instanceof ExactNumericValue) return other.gt(this.decimal);
    return this.decimal < other.re;
  }

  lte(other: number | NumericValue): boolean | undefined {
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal <= other;
    if (other.isComplex) return undefined;
    if (other instanceof ExactNumericValue) return other.gte(this.decimal);
    return this.decimal <= other.re;
  }

  gt(other: number | NumericValue): boolean | undefined {
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal > other;
    if (other.isComplex) return undefined;
    if (other instanceof ExactNumericValue) return other.lt(this.decimal);
    return this.decimal > other.re;
  }

  gte(other: number | NumericValue): boolean | undefined {
    if (this.isComplex) return undefined;
    if (typeof other === 'number') return this.decimal >= other;
    if (other.isComplex) return undefined;
    if (other instanceof ExactNumericValue) return other.lte(this.decimal);
    return this.decimal >= other.re;
  }
}

/**
 * Whether `v` is an exact, non-zero real value whose double projection `re`
 * is outside the normal double range (see `isOutsideNormalDoubleRange()`):
 * 0 (underflow), ±∞ (overflow), NaN (`∞/∞`) or subnormal. The value itself
 * is finite and not zero, so an operation with it must use its big-decimal
 * value, not `re`.
 */
function outOfDoubleRange(v: NumericValue, re: number): boolean {
  return (
    isOutsideNormalDoubleRange(re) &&
    v instanceof ExactNumericValue &&
    !v.isComplex &&
    !v.isZero &&
    !v.isNaN
  );
}

/**
 * The `[p, q]` of an exact real rational with machine-integer parts and no
 * radical, or `null`: the operand shape whose product with a float is best
 * computed as `(x · p) / q`.
 */
function exactMachineRational(v: NumericValue): [number, number] | null {
  if (!(v instanceof ExactNumericValue) || v.isComplex || v.radical !== 1)
    return null;
  const [p, q] = v.rational;
  if (typeof p !== 'number' || typeof q !== 'number') return null;
  return [p, q];
}
