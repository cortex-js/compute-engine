import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { Expression } from '../../math-json/math-json-format';
import { gcd, reducedRational, SMALL_INTEGERS } from '../numerics/numeric';
import {
  BoxedExpression,
  Domain,
  IComputeEngine,
  Metadata,
  NOptions,
  PatternMatchOption,
  SimplifyOptions,
  Substitution,
} from '../public';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { inferNumericDomain } from '../domain-utils';
import { isPrime } from '../numerics/primes';
import { isInMachineRange } from '../numerics/numeric-decimal';
import { serializeJsonNumber } from './serialize';
import { complexAllowed, hashCode, useDecimal } from './utils';

/**
 * BoxedNumber
 */

export class BoxedNumber extends AbstractBoxedExpression {
  protected readonly _value:
    | number
    | Decimal
    | Complex
    | [numer: number, denom: number];
  private _domain: Domain | undefined;
  private _head: string;
  private _hash: number | undefined;
  protected _isCanonical = true;

  /**
   * By the time the constructor is called, the `value` should have been
   * screened for cases where it's a well-known value (0, NaN, +Infinity, etc...)
   * or non-normal (complex number with im = 0, rational with denom = 1, etc...)
   * This is done in `ce.boxNumber()`. In general, use `ce.boxNumber()` rather
   * than calling the constructor directly.
   */
  constructor(
    ce: IComputeEngine,
    value: string | number | Decimal | Complex | [numer: number, denom: number],
    metadata?: Metadata
  ) {
    super(ce, metadata);

    if (value instanceof Complex) {
      if (Number.isNaN(value.re) || Number.isNaN(value.im))
        this._value = Number.NaN;
      else if (ce.chop(value.im) === 0) this._value = value.re;
      else {
        this._value = complexAllowed(ce) ? value : NaN;
      }
    } else if (Array.isArray(value)) {
      let [n, d] = value;
      console.assert(Number.isInteger(n) && Number.isInteger(d));
      if (d < 0) [n, d] = [-n, -d];
      if (d === 1) this._value = n;
      else if (n === 0) {
        if (d === 0) this._value = NaN;
        else this._value = n; // Could be +0 or -0
      } else {
        this._value = [n, d];
        this._isCanonical = gcd(n, d) === 1;
      }
    } else if (value instanceof Decimal) {
      // Only use a Decimal if in `decimal` mode or `auto` with precision > 15
      this._value = useDecimal(ce) ? value : value.toNumber();
    } else {
      // Note: by the time we reach here, NaN and +/-Infinity have
      // been handled by `boxNumber()`. So the string should be ready
      // to be parsed by `Decimal` or `Number`
      if (typeof value === 'number') {
        this._value = value;
      } else if (useDecimal(ce)) {
        // Use a Decimal if in `decimal` mode or `auto` with precision > 15
        this._value = ce.decimal(value);
      } else if (typeof value === 'string') {
        this._value = Number.parseFloat(value);
      }
    }

    if (typeof this._value === 'number') {
      if (Number.isInteger(this._value)) this._head = 'Integer';
      else this._head = 'Number'; // Could be Infinity, or NaN, so `Number` is more accurate than `RealNumber`
    } else if (this._value instanceof Complex) this._head = 'ComplexNumber';
    else if (Array.isArray(this._value)) this._head = 'RationalNumber';
    else if (this._value instanceof Decimal) {
      if (this._value.isInteger()) this._head = 'Integer';
      else this._head = 'RealNumber';
    } else this._head = 'Number';

    ce._register(this);
  }

  get hash(): number {
    if (this._hash !== undefined) return this._hash;
    let h = 0;
    if (typeof this._value === 'number') h = hashCode(this._value.toString());
    else if (this._value instanceof Complex)
      h = hashCode(
        this._value.re.toString() + ' +i ' + this._value.im.toString()
      );
    else if (this._value instanceof Decimal)
      h = hashCode(this._value.toString());
    else
      h = hashCode(
        this._value[0].toString() + ' / ' + this._value[1].toString()
      );
    this._hash = h;
    return h;
  }

  get head(): string {
    return this._head;
  }

  get isPure(): boolean {
    return true;
  }

  get isLiteral(): boolean {
    return true;
  }

  get isCanonical(): boolean {
    return this._isCanonical;
  }
  set isCanonical(val: boolean) {
    this._isCanonical = val;
  }

  get numericValue(): BoxedExpression | undefined {
    if (!Array.isArray(this._value)) return this;

    // Since `numericValue` is equivalent to `.N()`, reduce rationals to floats
    const [numer, denom] = this._value;
    const ce = this.engine;

    if (!useDecimal(ce)) return new BoxedNumber(ce, numer / denom);
    return new BoxedNumber(ce, ce.decimal(numer).div(denom));
  }

  get machineValue(): number | null {
    return typeof this._value === 'number' ? this._value : null;
  }

  get decimalValue(): Decimal | null {
    return this._value instanceof Decimal ? this._value : null;
  }

  get complexValue(): Complex | null {
    return this._value instanceof Complex ? this._value : null;
  }

  get rationalValue(): [numer: number, denom: number] | [null, null] {
    return Array.isArray(this._value) ? this._value : [null, null];
  }

  get asFloat(): number | null {
    if (typeof this._value === 'number') return this._value;

    if (this._value instanceof Decimal) {
      if (this._value.isNaN()) return NaN;
      if (!this._value.isFinite()) {
        if (this._value.isPositive()) return Number.POSITIVE_INFINITY;
        return Number.NEGATIVE_INFINITY;
      }
      if (isInMachineRange(this._value)) return this._value.toNumber();
    }

    if (Array.isArray(this._value)) return this._value[0] / this._value[1];

    console.assert(!(this._value instanceof Complex) || this._value.im !== 0);

    return null;
  }

  get asSmallInteger(): number | null {
    if (typeof this._value === 'number') {
      if (
        Number.isInteger(this._value) &&
        this._value >= -SMALL_INTEGERS &&
        this._value <= SMALL_INTEGERS
      )
        return this._value;
      return null;
    }
    if (this._value instanceof Decimal) {
      if (
        this._value.isInteger() &&
        this._value.gte(-SMALL_INTEGERS) &&
        this._value.lte(SMALL_INTEGERS)
      )
        return this._value.toNumber();
      return null;
    }
    if (Array.isArray(this._value)) {
      const v = this._value[0] / this._value[1];
      if (Number.isInteger(v) && v >= -SMALL_INTEGERS && v <= SMALL_INTEGERS)
        return v;
      return null;
    }
    if (this.engine.chop(this._value.im) === 0) {
      if (
        Number.isInteger(this._value.re) &&
        this._value.re >= -SMALL_INTEGERS &&
        this._value.re <= SMALL_INTEGERS
      )
        return this._value.re;
      return null;
    }
    return null;
  }

  get asRational(): [number, number] | [null, null] {
    const [n, d] = this.rationalValue;
    if (n !== null && d !== null) return [n, d];
    const i = this.asSmallInteger;
    if (i !== null) return [i, 1];
    return [null, null];
  }

  get domain(): Domain {
    if (this._domain === undefined)
      this._domain = this.engine.domain(inferNumericDomain(this._value));
    return this._domain;
  }

  get json(): Expression {
    return serializeJsonNumber(this.engine, this._value, {
      latex: this._latex,
    });
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    if (this.isZero) return 0;
    if (this._value instanceof Complex) return null;

    if (typeof this._value === 'number') {
      if (this._value < 0) return -1;
      if (this._value > 0) return 1;
      return null;
    }
    if (this._value instanceof Decimal) {
      if (this._value.isNegative()) return -1;
      if (this._value.isPositive()) return 1;
      return null;
    }

    if (Array.isArray(this._value)) {
      // By convention, the denominator is always positive,
      // so the sign is carried by the numerator
      const [numer, denom] = this._value;
      if (numer === 0 && denom !== 0) return 0;
      if (numer < 0) return -1;
      if (numer > 0) return 1;
      return null;
    }

    return null;
  }

  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedNumber)) return false;

    if (Array.isArray(this._value)) {
      if (!Array.isArray(rhs._value)) return false;
      const [rhsN, rhsD] = rhs._value;
      return this._value[0] === rhsN && this._value[1] === rhsD;
    }

    if (this._value instanceof Decimal) {
      if (!(rhs._value instanceof Decimal)) return false;
      return this._value.eq(rhs._value);
    }

    if (this._value instanceof Complex) {
      if (!(rhs._value instanceof Complex)) return false;
      return this._value.equals(rhs._value);
    }

    if (typeof this._value === 'number') {
      if (typeof rhs._value !== 'number') return false;
      return this._value === rhs._value;
    }
    return false;
  }

  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    const n = rhs.numericValue;
    if (n === undefined) return false;
    if (!(n instanceof BoxedNumber)) return false;

    if (Array.isArray(this._value)) {
      const v = n.asFloat;
      if (v === null) return false;
      return this.engine.chop(this._value[0] / this._value[1] - v) === 0;
    }

    if (this._value instanceof Decimal)
      return (
        this.engine.chop(
          this._value.sub(n.decimalValue ?? n.asFloat ?? NaN)
        ) === 0
      );

    if (this._value instanceof Complex) {
      if (n instanceof Complex)
        return (
          this.engine.chop(n.re - this._value.re) === 0 &&
          this.engine.chop(n.im - this._value.im) === 0
        );
      if (this._value.im !== 0) return false;
    }

    const lhsV = this.asFloat;
    const rhsV = n.asFloat;
    if (lhsV !== null && rhsV !== null)
      return this.engine.chop(rhsV - lhsV) === 0;

    return false;
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOption
  ): Substitution | null {
    if (this.isEqualWithTolerance(rhs, options?.numericTolerance ?? 0))
      return {};
    return null;
  }

  /** Compare this with another BoxedNumber.
   * `rhs` must be a BoxedNumber. Use `isEqualWithTolerance(rhs.numericValue)`
   * if necessary.
   */
  isEqualWithTolerance(rhs: BoxedExpression, tolerance: number): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedNumber)) return false;

    if (Array.isArray(this._value)) {
      const v = rhs.asFloat;
      if (v === null) return false;
      return Math.abs(this._value[0] / this._value[1] - v) <= tolerance;
    }

    if (this._value instanceof Decimal)
      return this._value
        .sub(rhs.decimalValue ?? rhs.asFloat ?? NaN)
        .abs()
        .lte(tolerance);

    if (this._value instanceof Complex) {
      if (rhs._value instanceof Complex)
        return (
          Math.abs(rhs._value.re - this._value.re) <= tolerance &&
          Math.abs(rhs._value.im - this._value.im) <= tolerance
        );
      if (this._value.im !== 0) return false;
    }

    const lhsV = this.asFloat;
    const rhsV = rhs.asFloat;
    if (lhsV !== null && rhsV !== null)
      return Math.abs(rhsV - lhsV) <= tolerance;

    return false;
  }

  isLess(rhs: BoxedExpression): boolean | undefined {
    rhs = rhs.N();
    // Imaginary numbers are not ordered.
    if (this.isImaginary || rhs.isImaginary) return undefined;

    if (typeof this._value === 'number') {
      const m = rhs.machineValue;
      if (m !== null) return this._value < m;
      const d = rhs.decimalValue;
      if (d !== null) return d.greaterThanOrEqualTo(this._value);
      const [numer, denom] = rhs.rationalValue;
      if (numer === null || denom === null) return false;
      return this._value * denom < numer;
    }

    if (this._value instanceof Decimal) {
      const m = rhs.machineValue;
      if (m !== null) return this._value.lt(m);
      const d = rhs.decimalValue;
      if (d !== null) return this._value.lt(d);
      const [numer, denom] = rhs.rationalValue;
      if (numer === null || denom === null) return false;
      return this._value.mul(denom).lt(numer);
    }

    if (Array.isArray(this._value)) {
      const [n1, d1] = this._value;

      if (typeof rhs === 'number') return n1 < rhs * d1;

      const [n2, d2] = rhs.rationalValue;
      if (n2 !== null && d2 !== null) return n1 * d2 < n2 * d1;

      const d = rhs.decimalValue;
      if (d === null) return false;
      return d.mul(n1).lt(d1);
    }

    // @todo compare with real part of complex number
    if (this._value instanceof Complex) {
    }

    return undefined;
  }

  isLessEqual(rhs: BoxedExpression): boolean | undefined {
    rhs = rhs.N();
    // @todo: could be expanded for improved performance
    const less = this.isLess(rhs);
    if (less === undefined) return undefined;
    const equal = this.isEqual(rhs);
    if (equal === undefined) return undefined;
    return less || equal;
  }

  isGreater(rhs: BoxedExpression): boolean | undefined {
    const less = this.isLess(rhs);
    if (less === undefined) return undefined;
    return !less;
  }

  isGreaterEqual(rhs: BoxedExpression): boolean | undefined {
    rhs = rhs.N();
    // @todo: could be expanded for improved performance
    const less = this.isLess(rhs);
    if (less === undefined) return undefined;
    const equal = this.isEqual(rhs);
    if (equal === undefined) return undefined;
    return !less || equal;
  }

  /** x > 0, same as `isGreater(0)` */
  get isPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s > 0;
  }

  /** x >= 0, same as `isGreaterEqual(0)` */
  get isNonNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s >= 0;
  }

  /** x < 0, same as `isLess(0)` */
  get isNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s < 0;
  }

  /** x <= 0, same as `isLessEqual(0)` */
  get isNonPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || s === null) return undefined;
    return s <= 0;
  }

  get isZero(): boolean {
    // Rationals can never be zero: they get downcast to
    // a machine number during boxing (ctor) if numerator is 0
    if (Array.isArray(this._value)) return false;

    return this.engine.chop(this._value) === 0;
  }

  get isNotZero(): boolean {
    if (Array.isArray(this._value)) return true;

    return this.engine.chop(this._value) !== 0;
  }

  get isOne(): boolean {
    if (typeof this._value === 'number') return this._value === 1;

    if (this._value instanceof Decimal)
      return this._value.equals(this.engine.DECIMAL_ONE);

    if (Array.isArray(this._value)) {
      const [numer, denom] = this._value;
      return denom !== 0 && numer === denom;
    }

    return this._value.equals(1);
  }

  get isNegativeOne(): boolean {
    if (typeof this._value === 'number') return this._value === -1;

    if (this._value instanceof Decimal)
      return this._value.equals(this.engine.DECIMAL_NEGATIVE_ONE);

    if (Array.isArray(this._value)) {
      const [numer, denom] = this._value;
      return numer < 0 && denom !== 0 && -numer === denom;
    }

    return this._value.equals(-1);
  }

  get isOdd(): boolean | undefined {
    if (this.isOne || this.isNegativeOne) return true;
    if (this.isZero) return false;

    if (!this.isInteger) return false;

    if (typeof this._value === 'number') return this._value % 2 !== 0;

    if (this._value instanceof Decimal) return !this._value.mod(2).isZero();

    // Note: rational and complex numbers are not considered even or odd

    return undefined;
  }

  get isEven(): boolean | undefined {
    if (this.isOne || this.isNegativeOne) return false;
    if (this.isZero) return true;

    if (!this.isInteger) return false;

    if (typeof this._value === 'number') return this._value % 2 === 0;

    if (this._value instanceof Decimal) return this._value.mod(2).isZero();

    // Note: rational and complex numbers are not considered even or odd

    return undefined;
  }

  get isPrime(): boolean | undefined {
    if (
      !this.isInteger ||
      !this.isFinite ||
      this.isNonPositive ||
      this.isOne ||
      this.isZero
    )
      return false;

    if (typeof this._value === 'number') return isPrime(this._value);

    // @todo: prime for Decimal integers
    return undefined;
  }

  get isComposite(): boolean | undefined {
    if (
      !this.isInteger ||
      !this.isFinite ||
      this.isNonPositive ||
      this.isOne ||
      this.isZero
    )
      return false;

    if (typeof this._value === 'number') return !isPrime(this._value);

    // @todo: prime for Decimal integers
    return undefined;
  }

  get isInfinity(): boolean {
    if (typeof this._value === 'number')
      return !Number.isFinite(this._value) && !Number.isNaN(this._value);

    if (this._value instanceof Decimal)
      return !this._value.isFinite() && !this._value.isNaN();

    if (this._value instanceof Complex)
      return !this._value.isFinite() && !this._value.isNaN();

    // Note: Rational numbers cannot be Infinity, they are
    // converted to a machine infinity during boxing (ctor)

    return false;
  }

  get isNaN(): boolean {
    if (typeof this._value === 'number') return Number.isNaN(this._value);

    if (this._value instanceof Decimal) this._value.isNaN();

    if (this._value instanceof Complex) this._value.isNaN();

    // Note: Rational numbers cannot be NaN, they are
    // converted to a machine NaN during boxing (ctor)

    return false;
  }

  get isFinite(): boolean {
    return !this.isInfinity && !isNaN;
  }

  get isNumber(): true {
    return true;
  }

  get isInteger(): boolean {
    if (typeof this._value === 'number') return Number.isInteger(this._value);
    if (this._value instanceof Decimal) return this._value.isInteger();
    // Note that some non-reduced rational numbers, such as `4/2`
    // are not considered integers.
    return false;
  }

  get isRational(): boolean {
    // Note that `isRational` is true for some non-canonical
    // rationals, i.e. `4/2`
    if (Array.isArray(this._value)) return true;

    // Every integer is also a rational
    return this.isInteger;
  }

  get isAlgebraic(): boolean | undefined {
    // Rational numbers (and integers) are definitely algebraic
    if (this.isRational) return true;
    // For the rest, who knows...
    return undefined;
  }

  get isReal(): boolean {
    if (!this.isFinite) return false;
    if (this._value instanceof Complex) {
      return this.engine.chop(this._value.im) === 0;
    }
    return true;
  }

  // Real or +-Infinity
  get isExtendedReal(): boolean {
    // We don't have to check for undefined, for BoxedNumber,
    // isInfinity and isReal never return undefined
    return this.isInfinity || this.isReal;
  }

  get isComplex(): boolean | undefined {
    // A real number, or an imaginary number
    // isFinite
    return !this.isNaN;
  }

  get isImaginary(): boolean | undefined {
    if (this._value instanceof Complex) return this._value.im !== 0;

    return false;
  }

  get isExtendedComplex(): boolean | undefined {
    return this.isInfinity || !this.isNaN;
  }

  get canonical(): BoxedExpression {
    if (this._isCanonical) return this;

    // Rational canonical form
    if (Array.isArray(this._value)) {
      // Note already in normal form (denom > 0) due to boxing
      const [numer, denom] = reducedRational(this._value);

      if (Number.isNaN(numer) || Number.isNaN(denom)) return this.engine.NAN;
      if (denom === 1) return this.engine.number(numer);
      if (denom === 0) {
        if (numer === 0 || !Number.isFinite(numer)) return this.engine.NAN;
        if (numer < 0) return this.engine.NEGATIVE_INFINITY;
        return this.engine.POSITIVE_INFINITY;
      }
      if (numer === 0) return this.engine.ZERO;

      return this.engine.number([numer, denom]);
    }

    // Nothing to do for Complex canonical form,
    // the boxing already account for complex with null imaginary part.

    // Nothing to do for Decimal canonical form.
    // We don't want to convert down to machine number, but instead we
    // want to propagate Decimal values to preserve precision.

    return this;
  }

  simplify(_options?: SimplifyOptions): BoxedExpression {
    return this.canonical;
  }

  N(_options?: NOptions): BoxedExpression {
    // If a rational, evaluate
    if (Array.isArray(this._value)) {
      const ce = this.engine;
      const [numer, denom] = this._value;
      // Account for the desired precision/numeric mode
      if (useDecimal(ce)) return ce.number(ce.decimal(numer).div(denom));

      return ce.number(numer / denom);
    }

    return this;
  }
}
