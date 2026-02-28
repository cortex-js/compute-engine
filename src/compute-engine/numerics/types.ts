import { BigDecimal } from '../../big-decimal';

/** @internal */
type IsInteger<N extends number> = `${N}` extends `${string}.${string}`
  ? never
  : `${N}` extends `-${string}.${string}`
  ? never
  : number;

/** A `SmallInteger` is an integer < 1e6
 * @category Numerics
 */
export type SmallInteger = IsInteger<number>;

/**
 * A rational number is a number that can be expressed as the quotient or fraction p/q of two integers,
 * a numerator p and a non-zero denominator q.
 *
 * A rational can either be represented as a pair of small integers or
 * a pair of big integers.
 *
 * @category Numerics
 */
export type Rational = [SmallInteger, SmallInteger] | [bigint, bigint];

/** @category Numerics */
export type BigNum = BigDecimal;
