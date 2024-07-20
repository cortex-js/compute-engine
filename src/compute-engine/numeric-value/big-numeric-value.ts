import Decimal from 'decimal.js';
import { NumericValue, NumericValueData } from './public';

export type BignumConstructor = (value: number | Decimal) => Decimal;

export class BigNumericValue extends NumericValue<Decimal> {
  value: Decimal;
  bignum: (value: number | Decimal) => Decimal;
  constructor(data: number | Decimal, bignum: BignumConstructor) {
    super();
    this.bignum = bignum;
    this.value = bignum(data);
  }

  get re(): number {
    return this.value.toNumber();
  }

  get bignumRe(): Decimal {
    return this.value;
  }

  get num(): BigNumericValue {
    return this;
  }

  get denom(): BigNumericValue {
    return new BigNumericValue(1, this.bignum);
  }

  get isExact(): boolean {
    return false;
  }

  get isNaN(): boolean {
    return this.value.isNaN();
  }

  get isPositiveInfinity(): boolean {
    return !this.value.isFinite() && this.value.isPositive();
  }

  get isNegativeInfinity(): boolean {
    return !this.value.isFinite() && this.value.isNegative();
  }

  get isZero(): boolean {
    return this.value.isZero();
  }

  get isOne(): boolean {
    return this.value.eq(1);
  }

  get isNegativeOne(): boolean {
    return this.value.eq(-1);
  }

  N(): BigNumericValue {
    return this;
  }

  neg(): NumericValue<Decimal> {
    return new BigNumericValue(this.value.neg(), this.bignum);
  }

  inv(): NumericValue<Decimal> {
    return new BigNumericValue(this.value.pow(-1), this.bignum);
  }

  add(
    other: number | NumericValueData<Decimal, [bigint, bigint]>
  ): NumericValue<Decimal> {
    return new BigNumericValue(this.value.add(other.bignumRe), this.bignum);
  }

  sub(
    other: number | NumericValueData<Decimal, [bigint, bigint]>
  ): NumericValue<Decimal> {
    return new BigNumericValue(this.value.sub(other.bignumRe), this.bignum);
  }

  mul(
    other: number | NumericValueData<Decimal, [bigint, bigint]>
  ): NumericValue<Decimal> {
    return new BigNumericValue(this.value.mul(other.bignumRe), this.bignum);
  }

  div(
    other: number | NumericValueData<Decimal, [bigint, bigint]>
  ): NumericValue<Decimal> {
    return new BigNumericValue(this.value.div(other.bignumRe), this.bignum);
  }

  pow(
    n: number | [number, number] | { re: number; im: number }
  ): NumericValue<Decimal> {
    return new BigNumericValue(this.value.pow(n), this.bignum);
  }

  normalize(): void {
    // do nothing
  }

  sqrt(): NumericValue<Decimal> {
    return new BigNumericValue(this.value.sqrt(), this.bignum);
  }

  gcd(other: NumericValue<Decimal>): NumericValue<Decimal> {
    return new BigNumericValue(this.value.gcd(other.bignumRe), this.bignum);
  }

  abs(): NumericValue<Decimal> {
    return new BigNumericValue(this.value.abs(), this.bignum);
  }

  ln(base?: number): NumericValue<Decimal> {
    return new BigNumericValue(this.value.ln(base), this.bignum);
  }

  sum(...values: NumericValue<Decimal>[]): NumericValue<Decimal>[] {
    return values.reduce((acc, value) => acc.add(value), this);
  }
}
