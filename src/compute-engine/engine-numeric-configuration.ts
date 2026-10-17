import { BigDecimal } from '../big-decimal/index.js';

import {
  DEFAULT_PRECISION,
  DEFAULT_TOLERANCE,
  MACHINE_PRECISION,
} from './numerics/numeric.js';

import type { AngularUnit, RoundingTies } from './types-definitions.js';

const ROUNDING_TIES: readonly RoundingTies[] = [
  'away-from-zero',
  'to-even',
  'toward-zero',
  'toward-positive-infinity',
  'toward-negative-infinity',
];

export class EngineNumericConfiguration {
  private _precision: number;
  private _angularUnit: AngularUnit;
  private _roundingTies: RoundingTies = 'away-from-zero';
  private _tolerance: number;
  /** How the tolerance was set. In `'auto'` mode the tolerance follows the
   * precision: it is `10^(-precision + 2)`, recomputed by `setPrecision`.
   * An explicit number stays as set across a precision change. */
  private _toleranceMode: 'auto' | 'explicit' = 'explicit';
  private _bignumTolerance: BigDecimal;
  private _negBignumTolerance: BigDecimal;
  /** The number of `withTransientPrecision` calls in progress. */
  private _transientPrecisionDepth = 0;
  /** The number of `withTransientAngularUnit` calls in progress. */
  private _transientAngularUnitDepth = 0;

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

    // The default is the fixed `DEFAULT_TOLERANCE`, not `'auto'`: the
    // precision-following mode is an opt-in (user decision 2026-10-16, issue
    // #449).
    this.setTolerance(options?.tolerance ?? DEFAULT_TOLERANCE);
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

    // In `'auto'` mode the tolerance follows the precision. An explicit
    // tolerance survives a precision change: `ce.tolerance = 1e-30` followed
    // by `ce.precision = 40` used to fall back to the 1e-10 default.
    if (this._toleranceMode === 'auto') this.setTolerance('auto');
    return true;
  }

  /**
   * Run `fn` with the precision of the engine and the precision of the big
   * decimals set to `digits`, then restore both, also when `fn` throws.
   *
   * Unlike `setPrecision`, this does not recompute an `'auto'` tolerance:
   * inside `fn` the tolerance is the one of the outer precision. The
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

  /**
   * Run `fn` with the angular unit `unit`, then restore the previous unit.
   *
   * Unlike the `angularUnit` setter, this does not reset the engine: no
   * configuration event, no purge of the caches, no recomputation of the
   * constants, and the scratch declaration scopes of the running computation
   * are kept. So, as under `withTransientPrecision`, a reader must not store
   * a value it computes inside `fn` where a reader in the other unit can
   * find it: `isTransientAngularUnit` is true while `fn` runs, and the memos
   * that hold evaluated values (`_atTransientConfiguration`) are bypassed.
   *
   * The symbolic integrator uses it: its rules are the radian ones, so in
   * another unit it integrates an integrand rewritten to the radian
   * convention with the engine in radian mode (`withRadianConvention` in
   * `symbolic/angular-unit.ts`).
   */
  withTransientAngularUnit<T>(unit: AngularUnit, fn: () => T): T {
    const previous = this._angularUnit;
    if (previous === unit) return fn();
    this._angularUnit = unit;
    this._transientAngularUnitDepth += 1;
    try {
      return fn();
    } finally {
      this._transientAngularUnitDepth -= 1;
      this._angularUnit = previous;
    }
  }

  /** True while a `withTransientAngularUnit` call is in progress. */
  get isTransientAngularUnit(): boolean {
    return this._transientAngularUnitDepth > 0;
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

  get roundingTies(): RoundingTies {
    return this._roundingTies;
  }

  /** Returns `true` when the rule changed. An unknown rule is an error: a
   *  misspelled rule would otherwise be ignored without a message. */
  setRoundingTies(value: RoundingTies): boolean {
    if (!ROUNDING_TIES.includes(value))
      throw Error(
        `Expected one of ${ROUNDING_TIES.map((r) => `"${r}"`).join(', ')}`
      );
    if (value === this._roundingTies) return false;
    this._roundingTies = value;
    return true;
  }

  get tolerance(): number {
    return this._tolerance;
  }

  /** `'auto'` when the tolerance follows the precision, `'explicit'` when
   * it was set to a number. */
  get toleranceMode(): 'auto' | 'explicit' {
    return this._toleranceMode;
  }

  /** Returns `true` when the (normalized) tolerance actually changed.
   *
   * `'auto'` sets the tolerance to `10^(-precision + 2)`, two digits short
   * of the working precision, and makes it follow later precision changes:
   * at 21 digits it is 1e-19, at 40 digits 1e-38. Two 40-digit values that
   * differ by 1e-12 then compare as different, where the fixed default
   * (`DEFAULT_TOLERANCE`, 1e-10) compares them as equal (issue #449). A
   * number that is not finite or is negative is read as `'auto'` as well.
   * Any other number is kept as set, also across a precision change. */
  setTolerance(value: number | 'auto'): boolean {
    const auto =
      value === 'auto' || !Number.isFinite(value) || (value as number) < 0;
    // The big-decimal tolerance of the auto mode is built from a string, so
    // it does not underflow: `Math.pow(10, -398)` is 0, `BigDecimal('1e-398')`
    // is not. The float `tolerance` (the public `ce.tolerance`) cannot hold a
    // value below about 5e-324, so above 325 digits it is clamped to the
    // smallest positive float; the big-decimal comparisons and `chop()` read
    // the exact big-decimal value (`bignumTolerance`).
    const big = auto
      ? new BigDecimal(`1e-${Math.max(this._precision - 2, 1)}`)
      : new BigDecimal(value as number);
    const tolerance = auto
      ? Math.max(big.toNumber(), Number.MIN_VALUE)
      : (value as number);
    const modeChanged = this._toleranceMode !== (auto ? 'auto' : 'explicit');
    this._toleranceMode = auto ? 'auto' : 'explicit';

    if (tolerance === this._tolerance && big.eq(this._bignumTolerance))
      return modeChanged;

    this._tolerance = tolerance;
    this._bignumTolerance = big;
    this._negBignumTolerance = big.neg();
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
