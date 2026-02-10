import { Decimal } from 'decimal.js';

import {
  DEFAULT_PRECISION,
  DEFAULT_TOLERANCE,
  MACHINE_PRECISION,
} from './numerics/numeric';

import type { AngularUnit } from './types-definitions';

type BignumConstants = {
  nan: Decimal;
  zero: Decimal;
  one: Decimal;
  two: Decimal;
  half: Decimal;
  pi: Decimal;
  negativeOne: Decimal;
};

export class EngineNumericConfiguration {
  private _bignum: Decimal.Constructor;
  private _precision: number;
  private _angularUnit: AngularUnit;
  private _tolerance: number;
  private _bignumTolerance: Decimal;
  private _negBignumTolerance: Decimal;
  private _constants: BignumConstants;

  constructor(options?: {
    precision?: number | 'machine';
    tolerance?: number | 'auto';
    angularUnit?: AngularUnit;
  }) {
    let precision = options?.precision ?? DEFAULT_PRECISION;
    if (precision === 'machine') precision = Math.floor(MACHINE_PRECISION);

    this._bignum = Decimal.clone({ precision });
    this._precision = precision;
    this._angularUnit = options?.angularUnit ?? 'rad';

    // Initialized before setTolerance() so fallback paths can use them.
    this._tolerance = DEFAULT_TOLERANCE;
    this._bignumTolerance = new this._bignum(DEFAULT_TOLERANCE);
    this._negBignumTolerance = new this._bignum(-DEFAULT_TOLERANCE);

    this.setTolerance(options?.tolerance ?? 'auto');
    this._constants = this.computeConstants();
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
    this._bignum = this._bignum.config({ precision: this._precision });

    // Keep historical behavior: changing precision resets tolerance.
    this.setTolerance('auto');
    this._constants = this.computeConstants();
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
    this._bignumTolerance = this.bignum(tolerance);
    this._negBignumTolerance = this.bignum(-tolerance);
  }

  get bignumTolerance(): Decimal {
    return this._bignumTolerance;
  }

  get negBignumTolerance(): Decimal {
    return this._negBignumTolerance;
  }

  get bignumNaN(): Decimal {
    return this._constants.nan;
  }

  get bignumZero(): Decimal {
    return this._constants.zero;
  }

  get bignumOne(): Decimal {
    return this._constants.one;
  }

  get bignumTwo(): Decimal {
    return this._constants.two;
  }

  get bignumHalf(): Decimal {
    return this._constants.half;
  }

  get bignumPi(): Decimal {
    return this._constants.pi;
  }

  get bignumNegativeOne(): Decimal {
    return this._constants.negativeOne;
  }

  refreshConstants(): void {
    this._constants = this.computeConstants();
  }

  bignum(value: Decimal.Value | bigint): Decimal {
    if (typeof value === 'bigint') return new this._bignum(value.toString());
    try {
      return new this._bignum(value);
    } catch (error) {
      if (error instanceof Error) console.error(error.message);
      else console.error(String(error));
    }
    return new this._bignum(Number.NaN);
  }

  private computeConstants(): BignumConstants {
    const negativeOne = this.bignum(-1);
    const one = this.bignum(1);
    const two = this.bignum(2);
    return {
      negativeOne,
      nan: this.bignum(Number.NaN),
      zero: this.bignum(0),
      one,
      two,
      half: one.div(two),
      pi: negativeOne.acos(),
    };
  }
}
