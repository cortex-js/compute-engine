import { BigDecimal } from '../big-decimal';

import {
  DEFAULT_PRECISION,
  DEFAULT_TOLERANCE,
  MACHINE_PRECISION,
} from './numerics/numeric';

import type { AngularUnit } from './types-definitions';

export class EngineNumericConfiguration {
  private _precision: number;
  private _angularUnit: AngularUnit;
  private _tolerance: number;
  private _bignumTolerance: BigDecimal;
  private _negBignumTolerance: BigDecimal;

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

  setTolerance(value: number | 'auto'): void {
    let tolerance = value;
    if (tolerance === 'auto') tolerance = DEFAULT_TOLERANCE;

    if (!Number.isFinite(tolerance) || tolerance < 0)
      tolerance = Math.pow(10, -this._precision + 2);

    this._tolerance = tolerance;
    this._bignumTolerance = new BigDecimal(tolerance);
    this._negBignumTolerance = new BigDecimal(-tolerance);
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
