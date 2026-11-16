import { BigDecimal } from '../../src/big-decimal';

// Each operation that rounds or bounds its result takes an optional last
// argument `prec`. With it, the operation gives the value it gives with no
// argument at `BigDecimal.precision = prec`, and it does not read
// `BigDecimal.precision`.

const DEFAULT_PRECISION = 50;

afterEach(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});

const bd = (s: string) => new BigDecimal(s);

const a = bd('2.5');
const b = bd('0.7');
const small = bd('0.00123');
const near1 = bd('1.0000000000000000001');

/** Each case: the operation with no precision argument, and with `p`. */
const CASES: [string, (p?: number) => BigDecimal][] = [
  ['div', (p) => a.div(bd('7'), p)],
  ['inv', (p) => bd('7').inv(p)],
  ['divToward floor', (p) => a.divToward(bd('7'), 'floor', p)],
  ['divToward ceiling', (p) => bd('-2.5').divToward(bd('7'), 'ceiling', p)],
  ['sqrtToward floor', (p) => a.sqrtToward('floor', p)],
  ['sqrtToward ceiling', (p) => a.sqrtToward('ceiling', p)],
  ['pow integer', (p) => bd('1.0000001').pow(1234567, p)],
  ['pow negative integer', (p) => a.pow(-3, p)],
  ['pow fractional', (p) => a.pow(bd('0.37'), p)],
  ['pow negative fractional', (p) => bd('12.5').pow(bd('-1.5'), p)],
  ['sqrt', (p) => a.sqrt(p)],
  ['cbrt', (p) => bd('-2.5').cbrt(p)],
  ['nthRoot', (p) => a.nthRoot(5, p)],
  ['nthRoot negative n', (p) => a.nthRoot(-7, p)],
  ['exp', (p) => a.exp(p)],
  ['expm1', (p) => a.expm1(p)],
  ['expm1 small', (p) => small.expm1(p)],
  ['ln', (p) => a.ln(p)],
  ['ln near 1', (p) => near1.ln(p)],
  ['log', (p) => a.log(7, p)],
  ['log1p', (p) => a.log1p(p)],
  ['log1p small', (p) => small.log1p(p)],
  ['sin', (p) => a.sin(p)],
  ['cos', (p) => a.cos(p)],
  ['tan', (p) => a.tan(p)],
  ['atan', (p) => a.atan(p)],
  ['atan of Infinity', (p) => BigDecimal.POSITIVE_INFINITY.atan(p)],
  ['asin', (p) => b.asin(p)],
  ['asin of 1', (p) => BigDecimal.ONE.asin(p)],
  ['acos', (p) => b.acos(p)],
  ['acos of a negative', (p) => b.neg().acos(p)],
  ['acos of -1', (p) => BigDecimal.NEGATIVE_ONE.acos(p)],
  ['sinh', (p) => a.sinh(p)],
  ['sinh small', (p) => small.sinh(p)],
  ['sinh large', (p) => bd('100').sinh(p)],
  ['cosh', (p) => a.cosh(p)],
  ['tanh', (p) => a.tanh(p)],
  ['tanh small', (p) => small.tanh(p)],
  ['asinh', (p) => a.asinh(p)],
  ['asinh small', (p) => small.neg().asinh(p)],
  ['acosh', (p) => a.acosh(p)],
  ['atanh', (p) => b.atanh(p)],
  ['atan2', (p) => BigDecimal.atan2(bd('-1'), bd('-3'), p)],
  ['static log10', (p) => BigDecimal.log10(a, p)],
  ['static exp', (p) => BigDecimal.exp(a, p)],
  ['pi', (p) => BigDecimal.pi(p)],
  ['eulerGamma', (p) => BigDecimal.eulerGamma(p)],
  ['mulBounded', (p) => a.div(bd('3'), 200).mulBounded(bd('1').div(7, 200), p)],
  ['roundToProductBound', (p) => bd('1').div(7, 300).roundToProductBound(p)],
];

/** The value of `f()` with `BigDecimal.precision = prec`. */
function atStatic(prec: number, f: () => BigDecimal): BigDecimal {
  const saved = BigDecimal.precision;
  BigDecimal.precision = prec;
  try {
    return f();
  } finally {
    BigDecimal.precision = saved;
  }
}

/**
 * Run `f` with `BigDecimal.precision` replaced by an accessor that throws on
 * a read, so a call that reads the static fails.
 */
function withoutStatic<T>(f: () => T): T {
  const saved = BigDecimal.precision;
  Object.defineProperty(BigDecimal, 'precision', {
    configurable: true,
    get() {
      throw new Error('BigDecimal.precision was read');
    },
    set() {
      throw new Error('BigDecimal.precision was written');
    },
  });
  try {
    return f();
  } finally {
    Object.defineProperty(BigDecimal, 'precision', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: saved,
    });
  }
}

describe('BigDecimal precision argument', () => {
  test.each(CASES)('%s(40) at precision 15 is %s at precision 40', (_, f) => {
    const expected = atStatic(40, () => f());
    BigDecimal.precision = 15;
    const actual = f(40);
    expect(actual.toString()).toBe(expected.toString());
  });

  test.each(CASES)('%s(p) does not read BigDecimal.precision', (_, f) => {
    // A precision that no other test uses, so the constant caches miss.
    const expected = atStatic(43, () => f());
    const actual = withoutStatic(() => f(43));
    expect(actual.toString()).toBe(expected.toString());
  });

  test('a call with no precision argument reads the static', () => {
    expect(() => withoutStatic(() => a.div(7))).toThrow(
      'BigDecimal.precision was read'
    );
    expect(BigDecimal.precision).toBe(DEFAULT_PRECISION);
  });

  test('the results at 15 and at 40 digits differ', () => {
    BigDecimal.precision = 15;
    expect(a.div(7).toString()).not.toBe(a.div(7, 40).toString());
    expect(a.ln().toString()).not.toBe(a.ln(40).toString());
    expect(BigDecimal.PI.toString()).not.toBe(BigDecimal.pi(40).toString());
  });

  test('PI and EULER_GAMMA are pi() and eulerGamma() at the working precision', () => {
    BigDecimal.precision = 30;
    expect(BigDecimal.PI.toString()).toBe(BigDecimal.pi(30).toString());
    expect(BigDecimal.EULER_GAMMA.toString()).toBe(
      BigDecimal.eulerGamma(30).toString()
    );
  });

  test('π and γ stay right when two precisions alternate', () => {
    BigDecimal.precision = 15;
    const pi20 = atStatic(20, () => BigDecimal.PI).toString();
    const pi60 = atStatic(60, () => BigDecimal.PI).toString();
    const g20 = atStatic(20, () => BigDecimal.EULER_GAMMA).toString();
    const g60 = atStatic(60, () => BigDecimal.EULER_GAMMA).toString();
    for (let i = 0; i < 3; i++) {
      expect(BigDecimal.pi(60).toString()).toBe(pi60);
      expect(BigDecimal.pi(20).toString()).toBe(pi20);
      expect(BigDecimal.eulerGamma(60).toString()).toBe(g60);
      expect(BigDecimal.eulerGamma(20).toString()).toBe(g20);
    }
  });

  test('the gap limit of addBounded and subBounded follows prec', () => {
    // maxExactGap(prec) is max(10,000, 4·prec + 100): 12,100 at prec 3,000,
    // 10,000 at prec 15. A gap of 11,000 digits is exact at 3,000 only.
    const big = bd('1e11000');
    const exact = big.add(BigDecimal.ONE);
    BigDecimal.precision = 15;
    expect(big.addBounded(BigDecimal.ONE, 3000).eq(exact)).toBe(true);
    expect(big.addBounded(BigDecimal.ONE).eq(exact)).toBe(false);
    expect(
      big.subBounded(BigDecimal.ONE, 3000).eq(big.sub(BigDecimal.ONE))
    ).toBe(true);
    expect(
      big
        .addBounded(BigDecimal.ONE, 3000)
        .eq(atStatic(3000, () => big.addBounded(BigDecimal.ONE)))
    ).toBe(true);
    expect(
      withoutStatic(() => big.addBounded(BigDecimal.ONE, 3000)).eq(exact)
    ).toBe(true);
  });

  test('add and sub with a gap below the limit do not read the static', () => {
    const big = bd('1e11000');
    expect(withoutStatic(() => big.add(BigDecimal.ONE, 15)).toString()).toBe(
      big.add(BigDecimal.ONE).toString()
    );
    expect(withoutStatic(() => big.sub(BigDecimal.ONE, 15)).toString()).toBe(
      big.sub(BigDecimal.ONE).toString()
    );
  });
});

describe('BigDecimal floor, ceil, round, trunc and mod', () => {
  // [value, floor, ceil, round, trunc]
  const ROUNDING: [string, string, string, string, string][] = [
    ['2.5', '2', '3', '3', '2'],
    ['-2.5', '-3', '-2', '-3', '-2'],
    ['0.5', '0', '1', '1', '0'],
    ['-0.5', '-1', '0', '-1', '0'],
    ['2.4999999999999999999999', '2', '3', '2', '2'],
    ['-7.5000000000000000000001', '-8', '-7', '-8', '-7'],
    ['0.1', '0', '1', '0', '0'],
    ['-0.09', '-1', '0', '0', '0'],
    ['1e-30', '0', '1', '0', '0'],
    ['-1e-30', '-1', '0', '0', '0'],
    // The fractional part starts far past the digits: no 10^(2·10⁶) is built.
    ['1e-2000000', '0', '1', '0', '0'],
    ['-3e-2000000', '-1', '0', '0', '0'],
    [
      '123456789012345678901234567890.5',
      '123456789012345678901234567890',
      '123456789012345678901234567891',
      '123456789012345678901234567891',
      '123456789012345678901234567890',
    ],
    ['1e2000000', '1e+2000000', '1e+2000000', '1e+2000000', '1e+2000000'],
    ['-17', '-17', '-17', '-17', '-17'],
    ['0', '0', '0', '0', '0'],
  ];

  test.each(ROUNDING)(
    '%s: floor %s, ceil %s, round %s, trunc %s, without the static',
    (v, floor, ceil, round, trunc) => {
      const x = bd(v);
      withoutStatic(() => {
        expect(x.floor().eq(bd(floor))).toBe(true);
        expect(x.ceil().eq(bd(ceil))).toBe(true);
        expect(x.round().eq(bd(round))).toBe(true);
        expect(x.trunc().eq(bd(trunc))).toBe(true);
      });
    }
  );

  test('NaN and infinities are kept', () => {
    withoutStatic(() => {
      for (const m of ['floor', 'ceil', 'round', 'trunc'] as const) {
        expect(BigDecimal.NAN[m]().isNaN()).toBe(true);
        expect(
          BigDecimal.POSITIVE_INFINITY[m]().eq(BigDecimal.POSITIVE_INFINITY)
        ).toBe(true);
        expect(
          BigDecimal.NEGATIVE_INFINITY[m]().eq(BigDecimal.NEGATIVE_INFINITY)
        ).toBe(true);
      }
    });
  });

  // [dividend, divisor, remainder]: the sign of the dividend.
  const MOD: [string, string, string][] = [
    ['7.5', '2', '1.5'],
    ['-7.5', '2', '-1.5'],
    ['7.5', '-2', '1.5'],
    ['1e60', '3', '1'],
    ['1e-20', '3', '1e-20'],
    ['5.5', '0.0003', '0.0001'],
    ['12345678901234567890', '1e-15', '0'],
    ['0', '7', '0'],
  ];

  test.each(MOD)('%s mod %s is %s, without the static', (a, b, r) => {
    expect(withoutStatic(() => bd(a).mod(bd(b))).eq(bd(r))).toBe(true);
  });
});
