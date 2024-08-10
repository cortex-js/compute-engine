import Decimal from 'decimal.js';

export type BigNum = Decimal;

export interface IBigNum {
  readonly _BIGNUM_NAN: BigNum;
  readonly _BIGNUM_ZERO: BigNum;
  readonly _BIGNUM_ONE: BigNum;
  readonly _BIGNUM_TWO: BigNum;
  readonly _BIGNUM_HALF: BigNum;
  readonly _BIGNUM_PI: BigNum;
  readonly _BIGNUM_NEGATIVE_ONE: BigNum;
  bignum(value: string | number | bigint | BigNum): BigNum;
}
