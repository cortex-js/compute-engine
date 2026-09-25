import { BigDecimal } from '../big-decimal/index.js';

import {
  DEFAULT_PRECISION,
  DEFAULT_TOLERANCE,
  MACHINE_PRECISION,
} from './numerics/numeric.js';

import type { AngularUnit } from './types-definitions.js';

export class EngineNumericConfiguration {
  private _precision: number;
  private _angularUnit: AngularUnit;
  private _tolerance: number;
  private _bignumTolerance: BigDecimal;
  private _negBignumTolerance: BigDecimal;
  /** The number of `withTransientPrecision` calls in progress. */
  private _transientPrecisionDepth = 0;

  constructor(options?: {
    precision?: number | 'machine';
    tolerance?: number | 'auto';
    angularUnit?: AngularUnit;
  }) {
    let precision = options?.precision ?? DEFAULT_PRECISION;
    if (precision === 'machine') precision = Math.floor(MACHINE_PRECISION);

    this._precision = precision;
    BigDecimal.precision = precision;
    this._angularUnit = options?.angularUnit ?? 'rad';

    // Initialized before setTolerance() so fallback paths can use them.
    this._tolerance = DEFAULT_TOLERANCE;
    this._bignumTolerance = new BigDecimal(DEFAULT_TOLERANCE);
    this._negBignumTolerance = new BigDecimal(-DEFAULT_TOLERANCE);

    this.setTolerance(options?.tolerance ?? 'auto');
  }

  get precision(): number {
    return this._precision;
  }

  setPrecision(value: number | 'machine' | 'auto'): boolean {
    let precision = value;
    if (precision === 'machine') precision = MACHINE_PRECISION;
    if (precision === 'auto') precision = DEFAULT_PRECISION;

    if (precision === this._precision) return false;

    if (typeof precision !== 'number' || precision <= 0)
      throw Error('Expected "machine" or a positive number');

    this._precision = Math.max(precision, MACHINE_PRECISION);
    BigDecimal.precision = this._precision;

    // Keep historical behavior: changing precision resets tolerance.
    this.setTolerance('auto');
    return true;
  }

  /**
   * Run `fn` with the precision of the engine and the precision of the big
   * decimals set to `digits`, then restore both, also when `fn` throws.
   *
   * Unlike `setPrecision`, this does not reset the tolerance, and the
   * caller does not reset the engine: no cached value is discarded and no
   * cache axis advances. So a value cached before the call (the value of a
   * constant such as `Pi`) is still at the previous precision inside `fn`:
   * the caller must not read cached numeric values that depend on the
   * precision, and must not cache a value it computes inside `fn` where a
   * reader at another precision can find it.
   *
   * While `fn` runs, `isTransientPrecision` is true. The definition of a
   * constant reads it: it then computes the value of the constant again at
   * the current precision and does not store it (`storedValue` in
   * `boxed-value-definition.ts`).
   */
  withTransientPrecision<T>(digits: number, fn: () => T): T {
    const precision = this._precision;
    const bigDecimalPrecision = BigDecimal.precision;
    this._precision = digits;
    BigDecimal.precision = digits;
    this._transientPrecisionDepth += 1;
    try {
      return fn();
    } finally {
      this._transientPrecisionDepth -= 1;
      this._precision = precision;
      BigDecimal.precision = bigDecimalPrecision;
    }
  }

  /** True while a `withTransientPrecision` call is in progress. */
  get isTransientPrecision(): boolean {
    return this._transientPrecisionDepth > 0;
  }

  get angularUnit(): AngularUnit {
    return this._angularUnit;
  }

  setAngularUnit(value: AngularUnit): boolean {
    if (value === this._angularUnit) return false;
    if (typeof value !== 'string') throw Error('Expected a string');

    this._angularUnit = value;
    return true;
  }

  get tolerance(): number {
    return this._tolerance;
  }

  /** Returns `true` when the (normalized) tolerance actually changed. */
  setTolerance(value: number | 'auto'): boolean {
    let tolerance = value;
    if (tolerance === 'auto') tolerance = DEFAULT_TOLERANCE;

    if (!Number.isFinite(tolerance) || tolerance < 0)
      tolerance = Math.pow(10, -this._precision + 2);

    if (tolerance === this._tolerance) return false;

    this._tolerance = tolerance;
    this._bignumTolerance = new BigDecimal(tolerance);
    this._negBignumTolerance = new BigDecimal(-tolerance);
    return true;
  }

  get bignumTolerance(): BigDecimal {
    return this._bignumTolerance;
  }

  get negBignumTolerance(): BigDecimal {
    return this._negBignumTolerance;
  }

  get bignumNaN(): BigDecimal {
    return BigDecimal.NAN;
  }

  get bignumZero(): BigDecimal {
    return BigDecimal.ZERO;
  }

  get bignumOne(): BigDecimal {
    return BigDecimal.ONE;
  }

  get bignumTwo(): BigDecimal {
    return BigDecimal.TWO;
  }

  get bignumHalf(): BigDecimal {
    return BigDecimal.HALF;
  }

  get bignumPi(): BigDecimal {
    return BigDecimal.PI;
  }

  get bignumNegativeOne(): BigDecimal {
    return BigDecimal.NEGATIVE_ONE;
  }

  bignum(value: string | number | bigint | BigDecimal): BigDecimal {
    if (value instanceof BigDecimal) return value;
    try {
      return new BigDecimal(value);
    } catch (error) {
      if (error instanceof Error) console.error(error.message);
      else console.error(String(error));
    }
    return BigDecimal.NAN;
  }
}
