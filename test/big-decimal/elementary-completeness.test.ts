import { BigDecimal } from '../../src/big-decimal';

// ROADMAP item 17 #6: expm1, log1p, log2, asinh, acosh, atanh, nthRoot.

const DEFAULT_PRECISION = 50;

beforeEach(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});
afterAll(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});

/** Run `fn` at a temporarily raised precision, restoring afterwards. */
function atPrecision<T>(p: number, fn: () => T): T {
  const saved = BigDecimal.precision;
  BigDecimal.precision = p;
  try {
    return fn();
  } finally {
    BigDecimal.precision = saved;
  }
}

/** First `digits` significant digits of |x| as a string (no sign, no point). */
function sigDigits(x: BigDecimal, digits: number): string {
  return x.abs().toPrecision(digits).toString().replace(/[-.]/g, '').slice(0, digits);
}

/** Assert two BigDecimals agree to `digits` significant digits. */
function expectAgree(a: BigDecimal, b: BigDecimal, digits: number): void {
  expect(sigDigits(a, digits)).toBe(sigDigits(b, digits));
}

// ================================================================
// log2
// ================================================================

describe('BigDecimal.log2', () => {
  test('log2(8) = 3', () => {
    expect(BigDecimal.log2(new BigDecimal('8')).eq(3)).toBe(true);
  });
  test('log2(1024) = 10', () => {
    expect(BigDecimal.log2(new BigDecimal('1024')).eq(10)).toBe(true);
  });
  test('log2(1) = 0', () => {
    expect(BigDecimal.log2(new BigDecimal('1')).isZero()).toBe(true);
  });
  test('log2(2) = 1', () => {
    expect(BigDecimal.log2(new BigDecimal('2')).eq(1)).toBe(true);
  });
});

// ================================================================
// expm1
// ================================================================

describe('BigDecimal expm1', () => {
  test('expm1(0) = 0', () => {
    expect(new BigDecimal('0').expm1().isZero()).toBe(true);
  });

  test('matches Math.expm1 for moderate values', () => {
    for (const v of ['1', '2.5', '-1.5', '0.3', '-0.7']) {
      const got = new BigDecimal(v).expm1().toNumber();
      expect(got).toBeCloseTo(Math.expm1(Number(v)), 12);
    }
  });

  test('agrees with exp(x)-1 for non-small x', () => {
    const x = new BigDecimal('2.5');
    expectAgree(x.expm1(), x.exp().sub(BigDecimal.ONE), 48);
  });

  test('accurate for tiny x (no cancellation)', () => {
    // Reference: exp(x)-1 computed with 30 extra guard digits stays accurate.
    const x = new BigDecimal('1e-30');
    const ref = atPrecision(DEFAULT_PRECISION + 35, () =>
      x.exp().sub(BigDecimal.ONE)
    );
    expectAgree(x.expm1(), ref, 45);
  });

  test('very tiny x ≈ x', () => {
    const x = new BigDecimal('1e-80');
    expectAgree(x.expm1(), x, 45);
  });

  test('expm1(-Infinity) = -1', () => {
    expect(BigDecimal.NEGATIVE_INFINITY.expm1().eq(-1)).toBe(true);
  });
  test('expm1(+Infinity) = +Infinity', () => {
    expect(BigDecimal.POSITIVE_INFINITY.expm1().isFinite()).toBe(false);
  });
});

// ================================================================
// log1p
// ================================================================

describe('BigDecimal log1p', () => {
  test('log1p(0) = 0', () => {
    expect(new BigDecimal('0').log1p().isZero()).toBe(true);
  });

  test('matches Math.log1p for moderate values', () => {
    for (const v of ['1', '2.5', '-0.5', '0.3', '9']) {
      const got = new BigDecimal(v).log1p().toNumber();
      expect(got).toBeCloseTo(Math.log1p(Number(v)), 12);
    }
  });

  test('agrees with ln(1+x) for non-small x', () => {
    const x = new BigDecimal('3');
    expectAgree(x.log1p(), BigDecimal.ONE.add(x).ln(), 48);
  });

  test('accurate for tiny x (no cancellation)', () => {
    const x = new BigDecimal('1e-30');
    const ref = atPrecision(DEFAULT_PRECISION + 35, () =>
      BigDecimal.ONE.add(x).ln()
    );
    expectAgree(x.log1p(), ref, 45);
  });

  test('log1p(-1) = -Infinity', () => {
    expect(new BigDecimal('-1').log1p().isFinite()).toBe(false);
  });
  test('log1p(x < -1) = NaN', () => {
    expect(new BigDecimal('-2').log1p().isNaN()).toBe(true);
  });
});

// ================================================================
// asinh / acosh / atanh
// ================================================================

describe('BigDecimal asinh', () => {
  test('asinh(0) = 0', () => {
    expect(new BigDecimal('0').asinh().isZero()).toBe(true);
  });

  test('matches Math.asinh', () => {
    for (const v of ['0.5', '1', '2', '-3', '10', '-0.25']) {
      const got = new BigDecimal(v).asinh().toNumber();
      expect(got).toBeCloseTo(Math.asinh(Number(v)), 12);
    }
  });

  test('odd function', () => {
    const x = new BigDecimal('2.7');
    expectAgree(x.asinh().neg(), x.neg().asinh(), 48);
  });

  test('sinh(asinh(x)) = x', () => {
    const x = new BigDecimal('3.14159');
    expectAgree(x.asinh().sinh(), x, 46);
  });

  test('accurate for tiny x', () => {
    const x = new BigDecimal('1e-30');
    expectAgree(x.asinh(), x, 45); // asinh(x) ≈ x
  });
});

describe('BigDecimal acosh', () => {
  test('acosh(1) = 0', () => {
    expect(new BigDecimal('1').acosh().isZero()).toBe(true);
  });

  test('matches Math.acosh', () => {
    for (const v of ['1.5', '2', '10', '100']) {
      const got = new BigDecimal(v).acosh().toNumber();
      expect(got).toBeCloseTo(Math.acosh(Number(v)), 12);
    }
  });

  test('cosh(acosh(x)) = x', () => {
    const x = new BigDecimal('4.2');
    expectAgree(x.acosh().cosh(), x, 46);
  });

  test('stable just above 1', () => {
    // acosh(1 + 1e-20) ≈ sqrt(2·1e-20) = sqrt(2)·1e-10
    const x = new BigDecimal('1').add(new BigDecimal('1e-20'));
    const ref = atPrecision(DEFAULT_PRECISION + 25, () => {
      const t = x.sub(BigDecimal.ONE).div(BigDecimal.TWO).sqrt();
      return BigDecimal.TWO.mul(t.asinh());
    });
    expectAgree(x.acosh(), ref, 40);
  });

  test('acosh(x < 1) = NaN', () => {
    expect(new BigDecimal('0.5').acosh().isNaN()).toBe(true);
  });
});

describe('BigDecimal atanh', () => {
  test('atanh(0) = 0', () => {
    expect(new BigDecimal('0').atanh().isZero()).toBe(true);
  });

  test('matches Math.atanh', () => {
    for (const v of ['0.5', '-0.5', '0.9', '-0.99', '0.1']) {
      const got = new BigDecimal(v).atanh().toNumber();
      expect(got).toBeCloseTo(Math.atanh(Number(v)), 12);
    }
  });

  test('tanh(atanh(x)) = x', () => {
    const x = new BigDecimal('0.625');
    expectAgree(x.atanh().tanh(), x, 46);
  });

  test('accurate for tiny x', () => {
    const x = new BigDecimal('1e-30');
    expectAgree(x.atanh(), x, 45); // atanh(x) ≈ x
  });

  test('atanh(1) = +Infinity, atanh(-1) = -Infinity', () => {
    expect(new BigDecimal('1').atanh().isFinite()).toBe(false);
    expect(new BigDecimal('-1').atanh().isFinite()).toBe(false);
    expect(new BigDecimal('1').atanh().significand > 0n).toBe(true);
    expect(new BigDecimal('-1').atanh().significand < 0n).toBe(true);
  });

  test('atanh(|x| > 1) = NaN', () => {
    expect(new BigDecimal('2').atanh().isNaN()).toBe(true);
  });
});

// ================================================================
// nthRoot
// ================================================================

describe('BigDecimal nthRoot', () => {
  test('nthRoot(2) == sqrt, nthRoot(3) == cbrt', () => {
    const x = new BigDecimal('7');
    expectAgree(x.nthRoot(2), x.sqrt(), 48);
    expectAgree(x.nthRoot(3), x.cbrt(), 48);
  });

  test('exact perfect powers', () => {
    expect(new BigDecimal('32').nthRoot(5).eq(2)).toBe(true);
    expect(new BigDecimal('81').nthRoot(4).eq(3)).toBe(true);
    expect(new BigDecimal('1000000').nthRoot(6).eq(10)).toBe(true);
  });

  test('round-trips: nthRoot(n)^n = x', () => {
    for (const n of [4, 5, 7, 10]) {
      const x = new BigDecimal('12.5');
      expectAgree(x.nthRoot(n).pow(n), x, 44);
    }
  });

  test('negative base with odd n', () => {
    expectAgree(new BigDecimal('-32').nthRoot(5), new BigDecimal('-2'), 48);
  });

  test('negative base with even n = NaN', () => {
    expect(new BigDecimal('-16').nthRoot(4).isNaN()).toBe(true);
  });

  test('negative n: x^(1/-n) = 1/x^(1/n)', () => {
    const x = new BigDecimal('8');
    expectAgree(x.nthRoot(-3), x.nthRoot(3).inv(), 46);
  });

  test('nthRoot(0) and non-integer n = NaN', () => {
    expect(new BigDecimal('8').nthRoot(0).isNaN()).toBe(true);
    expect(new BigDecimal('8').nthRoot(2.5).isNaN()).toBe(true);
  });

  test('nthRoot(1) = x', () => {
    expect(new BigDecimal('8').nthRoot(1).eq(8)).toBe(true);
  });

  test('zero', () => {
    expect(new BigDecimal('0').nthRoot(5).isZero()).toBe(true);
  });
});
