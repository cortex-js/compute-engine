import { engine as ce } from '../../utils';
import { ComputeEngine } from '../../../src/compute-engine';
import { bigint } from '../../../src/compute-engine/numerics/bigint';
import { gammaln } from '../../../src/compute-engine/numerics/special-functions';
import {
  intervalContains,
  intervalSubset,
} from '../../../src/compute-engine/numerics/interval';

describe('constructor', () => {
  it('should create from an integer', () => {
    const a = ce._numericValue(1);
    expect(a.re).toEqual(1);
    expect(a.toString()).toMatchInlineSnapshot(`1`);
  });

  it('should create from a rational', () => {
    const a = ce._numericValue([-7, 5]);
    expect(a.re).toMatchInlineSnapshot(`-1.4`);
    expect(a.toString()).toMatchInlineSnapshot(`-7/5`);
  });

  it('should reduce rational', () => {
    const a = ce._numericValue([-70, 50]);
    expect(a.re).toMatchInlineSnapshot(`-1.4`);
    expect(a.toString()).toMatchInlineSnapshot(`-7/5`);
  });

  it('should create from a sqrt', () => {
    const a = ce._numericValue(5).sqrt();
    expect(a.re).toMatchInlineSnapshot(`2.23606797749979`);
    expect(a.toString()).toMatchInlineSnapshot(`sqrt(5)`);
  });

  it('should create from a perfect sqrt', () => {
    const a = ce._numericValue(16).sqrt();
    expect(a.re).toMatchInlineSnapshot(`4`);
    expect(a.toString()).toMatchInlineSnapshot(`4`);
  });
});

describe('one and zero', () => {
  it('should add to 0', () => {
    const zero = ce._numericValue(0);
    const a = zero.add(ce._numericValue(3).sqrt());
    expect(a.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(a.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });

  it('should add to 0', () => {
    const zero = ce._numericValue(0);
    const a = zero.add(ce._numericValue(3).sqrt());
    expect(a.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(a.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should add to 0', () => {
    const a = ce._numericValue(3).sqrt();
    const b = a.add(ce._numericValue(0));
    expect(b.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should multiply by 1', () => {
    const a = ce._numericValue(3).sqrt();
    const b = a.mul(1);
    expect(b.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should multiply by -1', () => {
    const a = ce._numericValue(3).sqrt();
    const b = a.mul(-1);
    expect(b.re).toMatchInlineSnapshot(`-1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`-sqrt(3)`);
  });
  it('should multiply by 1', () => {
    const one = ce._numericValue(1);
    const b = one.mul(ce._numericValue(3).sqrt());
    expect(b.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should multiply by -1', () => {
    const one = ce._numericValue(-1);
    const b = one.mul(ce._numericValue(3).sqrt());
    expect(b.re).toMatchInlineSnapshot(`-1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`-sqrt(3)`);
  });
});

describe('sign is carried', () => {
  it('should carry it from a float', () => {
    const a = ce._numericValue(-1.23);
    expect(a.re).toEqual(-1.23);
    expect(a.toString()).toMatchInlineSnapshot(`-1.23`);
  });

  it('should carry it from a rational', () => {
    const a = ce._numericValue([-2, 10]);
    expect(a.re).toEqual(-0.2);
    expect(a.toString()).toMatchInlineSnapshot(`-1/5`);
  });

  it('should carry it from a float and rational', () => {
    const a = ce._numericValue(-3.1415).mul(ce._numericValue([-2, 10]));
    expect(a.re).toMatchInlineSnapshot(`0.6283`);
    expect(a.toString()).toMatchInlineSnapshot(`0.6283`);
  });
});

describe('multiplication', () => {
  it('should multiply rational two floats', () => {
    const a = ce._numericValue(-1.234);
    const b = a.mul(3.5);
    expect(b.re).toMatchInlineSnapshot(`-4.319`);
    // float * float = float
    expect(b.toString()).toMatchInlineSnapshot(`-4.319`);
  });
  it('should multiply rational by a float', () => {
    const a = ce._numericValue([-2, 10]);
    const b = a.mul(3.5);
    expect(b.re).toEqual(-0.7);
    // Rational * float = float
    expect(b.toString()).toMatchInlineSnapshot(`-0.7`);
  });
  it('should multiply two rationals to a reduced rational', () => {
    const a = ce._numericValue([-2, 10]);
    const b = a.mul(ce._numericValue([3, 5]));
    expect(b.re).toMatchInlineSnapshot(`-0.12`);
    // Rational * Rational = Rational
    expect(b.toString()).toMatch(`-3/25`);
  });
});

describe('multiplication', () => {
  it('should divide two floats', () => {
    const a = ce._numericValue(-1.234);
    const b = a.div(ce._numericValue(3.5));
    expect(b.re).toMatchInlineSnapshot(`-0.3525714285714286`);
    // float / float = float
    expect(b.toString()).toMatchInlineSnapshot(
      `-0.3525714285714285714285714285714285714285714285714285714285714285714285714285714285714285714285714286`
    );
  });

  it('should divide two rationals', () => {
    const a = ce._numericValue([-2, 10]);
    const b = a.div(ce._numericValue([-3, 5]));
    expect(b.re).toMatchInlineSnapshot(`0.3333333333333333`);
    // float / float = float
    expect(b.toString()).toMatchInlineSnapshot(`1/3`);
  });

  it('should divide a floats and an integer', () => {
    const a = ce._numericValue(-1.234);
    const b = a.div(ce._numericValue(3));
    expect(b.re).toMatchInlineSnapshot(`-0.41133333333333333`);
    // float / float = float
    expect(b.toString()).toMatchInlineSnapshot(
      `-0.4113333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333`
    );
  });

  it('should divide a complex number', () => {
    const a = ce._numericValue({ im: 2 });
    const b = ce._numericValue(1).div(a);
    expect(`${b.re}, ${b.im}`).toMatch(`0, -0.5`);
    // integer / complex = complex
    expect(b.toString()).toMatchInlineSnapshot(`-0.5i`);
  });
});

describe('power', () => {
  it('should take an exact square root', () => {
    const s = ce._numericValue(3).sqrt();
    const a = ce._numericValue(11).mul(s);

    const b = a.pow(0.5);
    expect(b.re).toMatchInlineSnapshot(`4.36492369730075`);
    // Correctly rounded at 100 digits (mpmath dps=110: …83679331); was …794
    // (1 ulp off) before the bignumRe guard-digit fix (CORRECTNESS P2 #17/21).
    expect(b.toString()).toMatchInlineSnapshot(
      `4.364923697300750093468524970855094140038109174685876230519106820203445844167467177594069909134836793`
    );
  });
  it('should stay exact', () => {
    const s = ce._numericValue(3).sqrt();
    const a = ce._numericValue(8).mul(s);

    const b = a.pow(2);
    expect(b.re).toMatchInlineSnapshot(`192`);
    expect(b.toString()).toMatchInlineSnapshot(`192`);
  });
});

// Regressions for the numeric-value bugs reported in REVIEW.md (D1–D4, D10).
describe('Numeric-value correctness (REVIEW.md D1–D4)', () => {
  // `BigDecimal.precision` is a global static, so a machine-precision engine is
  // created in beforeAll (not at collection time) and the global precision is
  // restored in afterAll — otherwise it leaks into other tests.
  let machine: ComputeEngine;
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = ce.precision;
    machine = new ComputeEngine({ precision: 'machine' });
  });
  afterAll(() => {
    ce.precision = savedPrecision;
  });

  // D1: complex pow used De Moivre's `argument ** exponent` instead of
  // `argument * exponent` (machine precision).
  it('D1: machine complex pow (i^2 = -1)', () => {
    const r = machine._numericValue(machine.complex(0, 1)).pow(2);
    expect(r.re).toBeCloseTo(-1, 12);
    expect(r.im).toBeCloseTo(0, 12);
  });

  // D10: negative exponent on a complex base dropped the imaginary part.
  it('D10: machine complex negative pow ((1+i)^-2 = -0.5i)', () => {
    const r = machine._numericValue(machine.complex(1, 1)).pow(-2);
    expect(r.re).toBeCloseTo(0, 12);
    expect(r.im).toBeCloseTo(-0.5, 12);
  });

  // D2: complex inv divided the conjugate by |z| instead of |z|².
  it('D2: machine complex inv (1/(2i) = -0.5i)', () => {
    const r = machine._numericValue(machine.complex(0, 2)).inv();
    expect(r.re).toBeCloseTo(0, 12);
    expect(r.im).toBeCloseTo(-0.5, 12);
  });

  it('D2: bignum complex inv (1/(2i) = -0.5i)', () => {
    const r = ce._numericValue(ce.complex(0, 2)).inv();
    expect(r.re).toBeCloseTo(0, 12);
    expect(r.im).toBeCloseTo(-0.5, 12);
  });

  // D3: exact pow with a 1/n exponent took the n-th root of the numerator
  // (always 1) instead of the denominator, so it returned the base unchanged.
  it('D3: exact n-th root (8^(1/3) = 2, 27^(1/3) = 3)', () => {
    expect(ce._numericValue(8).pow(ce._numericValue([1, 3])).toString()).toEqual(
      '2'
    );
    expect(
      ce._numericValue(27).pow(ce._numericValue([1, 3])).toString()
    ).toEqual('3');
  });

  // D4: floor/ceil/round routed exact integers/rationals through a float,
  // losing digits beyond 2^53. They now compute exactly with bigints.
  it('D4: exact floor of a large integer keeps every digit', () => {
    const big = 123456789012345678901234567890n;
    expect(ce._numericValue(big).floor().toString()).toEqual(big.toString());
  });

  it('D4: exact floor/ceil/round of rationals', () => {
    expect(ce._numericValue([7, 2]).floor().toString()).toEqual('3');
    expect(ce._numericValue([-7, 2]).floor().toString()).toEqual('-4');
    expect(ce._numericValue([7, 2]).ceil().toString()).toEqual('4');
    expect(ce._numericValue([-7, 2]).ceil().toString()).toEqual('-3');
    expect(ce._numericValue([5, 2]).round().toString()).toEqual('3');
    expect(ce._numericValue([-5, 2]).round().toString()).toEqual('-2');
  });
});

describe('Numeric-value correctness (REVIEW.md D11–D19)', () => {
  // `ce` runs at high precision, so `ce._numericValue(...)` is a BigNumericValue
  // (or ExactNumericValue for exact values). A machine engine is created lazily.
  let machine: ComputeEngine;
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = ce.precision;
    machine = new ComputeEngine({ precision: 'machine' });
  });
  afterAll(() => {
    ce.precision = savedPrecision;
  });

  // D11: root used a machine-precision reciprocal `pow(1 / n)`, so the result
  // had only ~17 correct digits regardless of working precision.
  it('D11: nth root is full precision (matches raising back to the power)', () => {
    const big = new ComputeEngine();
    big.precision = 50;
    const r = big._numericValue(7).root(3); // 7^(1/3)
    // Full-precision result has ~50 digits, not the old ~17.
    expect(r.toString().replace(/[^0-9]/g, '').length).toBeGreaterThan(40);
    // Matches the dedicated full-precision cbrt.
    expect(r.toString()).toEqual(big.bignum(7).cbrt().toString());
  });

  // D12: NaN·0 returned 0 (the zero branches omitted the isNaN check).
  it('D12: NaN · 0 = NaN (BigNumericValue)', () => {
    const nan = ce._numericValue(ce.bignum(NaN));
    expect(nan.mul(0).isNaN).toBe(true);
    expect(nan.mul(ce._numericValue(0)).isNaN).toBe(true);
  });

  // D13: machine `eq` used subtraction (Inf − Inf = NaN).
  it('D13: Infinity.eq(Infinity) = true (machine)', () => {
    const inf = machine._numericValue(Infinity);
    expect(inf.eq(machine._numericValue(Infinity))).toBe(true);
    expect(inf.eq(Infinity)).toBe(true);
    expect(inf.eq(machine._numericValue(-Infinity))).toBe(false);
  });

  // D14: the fast-path guard was only true at exactly MAX_SAFE_INTEGER, so
  // large integer doubles fell through to a string path that rejected them.
  it('D14: bigint of a large integer double is exact, not null', () => {
    expect(bigint(2.46e100)).toBe(BigInt(2.46e100));
    expect(bigint(5)).toBe(5n);
    expect(bigint(1e21)).toBe(10n ** 21n);
    expect(bigint(2.5)).toBe(null); // non-integers still rejected
  });

  // D15: exact inv() threw RangeError on NaN/±Infinity (unguarded BigInt).
  it('D15: exact inv() of NaN/Infinity does not throw', () => {
    const nan = ce._numericValue(0).div(ce._numericValue(0)); // exact NaN
    expect(nan.isNaN).toBe(true);
    expect(() => nan.inv()).not.toThrow();
    expect(nan.inv().isNaN).toBe(true);
  });

  // D16: gammaln used bare Stirling for all z; gammaln(0.5) was off by ~1.6e-2.
  it('D16: gammaln(0.5) = ln(√π) accurately', () => {
    expect(gammaln(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
    expect(gammaln(1)).toBeCloseTo(0, 8); // Γ(1) = 1
    expect(gammaln(5)).toBeCloseTo(Math.log(24), 8); // Γ(5) = 24
  });

  // D17: a/0 (NumericValue zero) always returned +Infinity, dropping the sign.
  it('D17: division by zero is sign-aware (BigNumericValue)', () => {
    const big = new ComputeEngine();
    big.precision = 50;
    const zero = big._numericValue(big.bignum('0'));
    expect(big._numericValue(big.bignum('-5.5')).div(zero).toString()).toBe(
      '-Infinity'
    );
    expect(big._numericValue(big.bignum('5.5')).div(zero).toString()).toBe(
      'Infinity'
    );
  });

  // D18: complex-exponent pow used ln(Re z) and dropped the exp(−im·arg z)
  // magnitude factor — correct only for positive real bases.
  it('D18: complex-exponent pow (i^i and (1+i)^(1+i))', () => {
    const ii = machine._numericValue(machine.complex(0, 1)).pow({ re: 0, im: 1 });
    expect(ii.re).toBeCloseTo(Math.exp(-Math.PI / 2), 12); // 0.20787957635
    expect(ii.im).toBeCloseTo(0, 12);

    const z = machine._numericValue(machine.complex(1, 1)).pow({ re: 1, im: 1 });
    expect(z.re).toBeCloseTo(0.2739572538301211, 10);
    expect(z.im).toBeCloseTo(0.5837007587586147, 10);
  });

  // D19: intervalContains comparisons were inverted; intervalSubset open/open
  // used a non-strict comparison.
  it('D19: intervalContains accepts interior and boundary points', () => {
    const closed = { start: 0, end: 10, openStart: false, openEnd: false };
    expect(intervalContains(closed, 5)).toBe(true);
    expect(intervalContains(closed, 0)).toBe(true);
    expect(intervalContains(closed, 10)).toBe(true);
    expect(intervalContains(closed, -1)).toBe(false);
    expect(intervalContains(closed, 11)).toBe(false);
    const open = { start: 0, end: 10, openStart: true, openEnd: true };
    expect(intervalContains(open, 0)).toBe(false);
    expect(intervalContains(open, 5)).toBe(true);
  });

  it('D19: intervalSubset handles open/open equal bounds', () => {
    const a = { start: 2, end: 3, openStart: false, openEnd: false };
    const b = { start: 0, end: 10, openStart: false, openEnd: false };
    expect(intervalSubset(a, b)).toBe(true);
    expect(intervalSubset(b, a)).toBe(false);
    // Equal open starts: (0,5] ⊆ (0,10] is a subset.
    const o1 = { start: 0, end: 5, openStart: true, openEnd: false };
    const o2 = { start: 0, end: 10, openStart: true, openEnd: false };
    expect(intervalSubset(o1, o2)).toBe(true);
  });
});
