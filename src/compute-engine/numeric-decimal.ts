import { Decimal } from 'decimal.js';

export function gcd(a: Decimal, b: Decimal): Decimal {
  //@todo: https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  if (!a.isInteger() || !b.isInteger()) return DECIMAL_NAN;
  while (!b.isZero()) [a, b] = [b, a.modulo(b)];
  return a.abs();
}

export function lcm(a: Decimal, b: Decimal): Decimal {
  return a.mul(b).div(gcd(a, b));
}

export function factorial(n: Decimal): Decimal {
  if (n.isZero()) return DECIMAL_ZERO;
  if (!n.isInteger() || n.isNegative()) return DECIMAL_NAN;
  let val = DECIMAL_ONE;
  let i = new Decimal(2);
  while (i.lessThan(n)) {
    val = val.mul(i);
    i = i.add(1);
  }
  return val;
}

export const DECIMAL_ZERO = new Decimal(0);
export const DECIMAL_ONE = new Decimal(1);
export const DECIMAL_MINUS_ONE = new Decimal(-1);
export const DECIMAL_NAN = new Decimal(NaN);
export const DECIMAL_POS_INFINITY = new Decimal(+Infinity);
export const DECIMAL_NEG_INFINITY = new Decimal(-Infinity);
export const DECIMAL_PI = Decimal.acos(-1);
export const DECIMAL_E = Decimal.exp(1);
