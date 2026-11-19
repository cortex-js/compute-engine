/**
 * The float lanes of `Remainder` (CE-1447): the remainder `a − b·k` of two
 * floats, `k` the quotient rounded to the nearest integer with a tie toward
 * `+∞`, is computed exactly from the operands and rounded once. The lanes
 * rounded the quotient first, and `a` and `b·k` cancel:
 * `Remainder(-825977087020874, 0.7)` was `2` at machine precision and
 * `Remainder(1000000000000000000000000000001.5, 0.7)` was `-999999998.5` at
 * the default precision.
 *
 * An exact operand beside a float is its value at the working precision, as
 * in every float lane (CE-1449): the exact rational of the double `-0.35`
 * by the exact decimal of the double `0.7` is the quotient `-1/2`, a tie,
 * but the rational at 21 digits is not, and the remainder is `+0.35`.
 */

import { ComputeEngine } from '../../src/compute-engine';

/** The exact value of a double, as a multiple of 2^-1074. */
function exact(x: number): bigint {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  const bits = v.getBigUint64(0);
  const e = Number((bits >> 52n) & 0x7ffn);
  const f = bits & ((1n << 52n) - 1n);
  const m = e === 0 ? f : (f | (1n << 52n)) << BigInt(e - 1);
  return bits >> 63n ? -m : m;
}

/** `a − b·round(a/b)` of two doubles in exact arithmetic, the quotient
 *  rounded with a tie toward +∞, as a multiple of 2^-1074 (the remainder
 *  of two doubles is a double). */
function exactDoubleRemainder(a: number, b: number): bigint {
  const [x, y] = [exact(a), exact(b)];
  let [num, den] = [2n * x + y, 2n * y];
  if (den < 0n) [num, den] = [-num, -den];
  let k = num / den;
  if (num % den !== 0n && num < 0n) k -= 1n;
  return x - y * k;
}

/** `a − b·round(a/b)` of the decimals `a` and `b` (the shortest decimals
 *  of two doubles, as the engine reads a double beside an exact number) in
 *  exact arithmetic, the quotient rounded with a tie toward +∞, as a
 *  double. */
function exactRemainder(a: number, b: number): number {
  const parse = (x: number): [bigint, number] => {
    const [m, e = '0'] = String(x).split('e');
    const [i, f = ''] = m.split('.');
    return [BigInt(i + f), Number(e) - f.length];
  };
  const [[sa, ea], [sb, eb]] = [parse(a), parse(b)];
  const e = Math.min(ea, eb);
  const x = sa * 10n ** BigInt(ea - e);
  const y = sb * 10n ** BigInt(eb - e);
  let [num, den] = [2n * x + y, 2n * y];
  if (den < 0n) [num, den] = [-num, -den];
  let k = num / den;
  if (num % den !== 0n && num < 0n) k -= 1n;
  return Number(`${x - y * k}e${e}`);
}

describe('Remainder at machine precision', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const remainder = (a: number, b: number) =>
    ce.box(['Remainder', a, b]).evaluate().re;

  test('a quotient whose product cancels', () => {
    // An integer dividend is exact: the divisor is its decimal, 0.7.
    expect(remainder(-825977087020874, 0.7)).toBe(-0.1);
    // Two floats: the exact remainder of the doubles.
    expect(exact(remainder(-825977087020874.5, 0.7))).toBe(
      exactDoubleRemainder(-825977087020874.5, 0.7)
    );
    expect(exact(remainder(2 ** 60, 7.5))).toBe(
      exactDoubleRemainder(2 ** 60, 7.5)
    );
  });

  test('ties of the quotient round toward +∞', () => {
    expect(remainder(-0.35, 0.7)).toBe(-0.35);
    expect(remainder(0.35, 0.7)).toBe(-0.35);
    expect(remainder(-2.5, 1)).toBe(-0.5);
    expect(remainder(2.5, -1)).toBe(0.5);
  });

  test('random pairs of floats give the exact remainder of the doubles', () => {
    // A seeded generator (an LCG).
    let s = 13579;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const misses: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const a = (rnd() - 0.5) * [60, 2e15, 2e-3, 1e300][i % 4];
      const b = (rnd() - 0.5) * [2, 1e3, 1e-6][(i >> 2) % 3] || 0.5;
      if (Number.isSafeInteger(a) || Number.isSafeInteger(b)) continue;
      const r = remainder(a, b);
      if (exact(r) !== exactDoubleRemainder(a, b))
        misses.push(`Remainder(${a}, ${b}) = ${r}`);
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  test('an integer dividend by a float: the exact remainder of the doubles, or of the decimals within the precision', () => {
    // A small integer is a double here; a larger one is exact, and the
    // divisor beside it is its decimal (`bignumRe`).
    let s = 24680;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const misses: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const a = Math.round((rnd() - 0.5) * [1e3, 2e15][i % 2]);
      const b = (rnd() - 0.5) * [2, 1e3, 1e-6][(i >> 1) % 3] || 0.5;
      const r = remainder(a, b);
      const want = exactRemainder(a, b);
      if (
        exact(r) !== exactDoubleRemainder(a, b) &&
        !(Math.abs(r - want) <= 1e-14 * Math.abs(want))
      )
        misses.push(`Remainder(${a}, ${b}) = ${r}, exact ${want}`);
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  test('a zero or infinite divisor and an infinite dividend', () => {
    expect(remainder(1.5, 0)).toBeNaN();
    expect(remainder(1.5, Infinity)).toBeNaN();
    expect(remainder(Infinity, 2.5)).toBeNaN();
  });
});

describe('Remainder at the default precision', () => {
  const ce = new ComputeEngine();
  const remainder = (a: string, b: string) =>
    ce
      .box(['Remainder', { num: a }, { num: b }] as never)
      .evaluate()
      .toString();

  test('a quotient with more digits than the precision', () => {
    expect(remainder('1000000000000000000000000000001.5', '0.7')).toBe('-0.3');
    expect(remainder('123456789012345678901234567.25', '3.5')).toBe('1.25');
    expect(remainder('1e300', '0.7')).toBe('0.3');
    // The power of ten is taken modulo the divisor, not formed.
    expect(remainder('1e1000000', '0.7')).toBe('-0.2');
  });

  test('a dividend far below the divisor is its own remainder', () => {
    expect(remainder('1e-1000000000', '0.7')).toBe('1e-1000000000');
    expect(remainder('0.06', '0.7')).toBe('0.06');
    expect(remainder('-0.4', '-0.7')).toBe('0.3');
  });

  test('a dividend closer to a half-integer quotient than the precision', () => {
    // The exact remainder is 0.4999…9 (30 digits), rounded once to 21
    // digits: 0.5, on the side of the dividend.
    expect(remainder('0.499999999999999999999999999999', '1.0')).toBe('0.5');
    expect(remainder('-0.500000000000000000000000000001', '1.0')).toBe('0.5');
  });

  test('an exact operand beside a float is its value at the working precision (CE-1449)', () => {
    const x = ce.number([-3152519739159347n, 9007199254740992n] as never);
    const d = ce.box({
      num: '0.6999999999999999555910790149937383830547332763671875',
    } as never);
    expect(ce.box(['Remainder', x, d]).evaluate().re).toBeCloseTo(0.35, 15);
  });
});
