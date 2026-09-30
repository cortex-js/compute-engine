/**
 * `LerchPhi` and `PolyLog` at more than machine precision —
 * cortex-js/compute-engine#374. Above `MACHINE_PRECISION` both answered in
 * doubles regardless of `ce.precision`, unlike `HurwitzZeta`. `bigLerchPhi`
 * (numerics/special-functions.ts) now sums Φ(z,s,a) = Σ zᵏ(k+a)^(−s) on
 * `BigNum` for real z, s, a with |z| < 1, to the requested digits; `PolyLog`
 * rides on it at a = 1 through `bigPolyLog` (Liₛ(z) = z·Φ(z,s,1)).
 *
 * Reference values are `mpmath.lerchphi`/`mpmath.polylog` at 60 digits
 * (`python3 -c "import mpmath as m; m.mp.dps=60; print(m.lerchphi(z,s,a))"`).
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const MACHINE_PRECISION = ce.precision;

function phi(z: unknown, s: unknown, a: unknown) {
  return ce.expr(['LerchPhi', z as any, s as any, a as any]);
}

function li(s: unknown, z: unknown) {
  return ce.expr(['PolyLog', s as any, z as any]);
}

/** `got` agrees with `expected` to at least `digits` significant digits. */
function expectDigits(got: number, expected: number, digits: number) {
  const scale = Math.max(Math.abs(expected), Number.MIN_VALUE);
  expect(Math.abs(got - expected) / scale).toBeLessThan(10 ** (2 - digits));
}

// z, s, a inside the disk of convergence, at 60 mpmath digits.
const lerchCases: [string, unknown, unknown, unknown, number][] = [
  [
    'LerchPhi(1/2,2,1)',
    ['Rational', 1, 2],
    2,
    1,
    1.164481052930025011805312640319360217488396949612252851,
  ],
  // z near the rim, both signs.
  [
    'LerchPhi(0.99,2,1)',
    0.99,
    2,
    1,
    1.604672169774116491950736842404598452469656294082953425,
  ],
  [
    'LerchPhi(-0.99,2,1)',
    -0.99,
    2,
    1,
    0.8237635166437775243379520167860077984926462458124473455,
  ],
  // A negative order: terms grow before the |z|^k factor takes over.
  [
    'LerchPhi(0.99,-2.5,1)',
    0.99,
    -2.5,
    1,
    32984431.39426304242728653441978037201893986435825617915,
  ],
  [
    'LerchPhi(-0.99,-2.5,1)',
    -0.99,
    -2.5,
    1,
    -0.08774640464789604430180739830614535500404600615495794022,
  ],
  // A negative integer order at a rational a and z: exact, but still
  // checked as a series value (LerchPhi does not special-case s < 0).
  ['LerchPhi(1/2,-3,2)', ['Rational', 1, 2], -3, 2, 102],
  // A rational a.
  [
    'LerchPhi(1/2,2,3/7)',
    ['Rational', 1, 2],
    2,
    ['Rational', 3, 7],
    5.747324989629124039406968875537084326722712759699950273,
  ],
  // A small a.
  [
    'LerchPhi(1/2,2,0.001)',
    ['Rational', 1, 2],
    2,
    0.001,
    1000000.581167650483896598634476382444691268184507033079,
  ],
];

const polylogCases: [string, unknown, unknown, number][] = [
  [
    'PolyLog(2,1/3)',
    2,
    ['Rational', 1, 3],
    0.3662132299770634876167462976642627638020634155896782205,
  ],
  [
    'PolyLog(-3.5,1/2)',
    -3.5,
    ['Rational', 1, 2],
    60.53011239698513298038883995292340922738825295056477431,
  ],
  [
    'PolyLog(2.5,-1/2)',
    2.5,
    ['Rational', -1, 2],
    -0.4622977821900634381891643232745464898869395902698162925,
  ],
];

describe('LerchPhi and PolyLog at machine precision: unaffected', () => {
  test(`LerchPhi(0.99,2,1) at machine precision matches only the double kernel's accuracy`, () => {
    const n = phi(0.99, 2, 1).N();
    expectDigits(
      n.re,
      1.604672169774116491950736842404598452469656294082953425,
      9
    );
  });

  test(`PolyLog(2,1/3) at machine precision matches only the double kernel's accuracy`, () => {
    const n = li(2, ['Rational', 1, 3]).N();
    expectDigits(
      n.re,
      0.3662132299770634876167462976642627638020634155896782205,
      9
    );
  });
});

for (const digits of [30, 50]) {
  describe(`LerchPhi and PolyLog at precision ${digits}`, () => {
    beforeAll(() => {
      ce.precision = digits;
    });
    afterAll(() => {
      ce.precision = MACHINE_PRECISION;
    });

    for (const [name, z, s, a, expected] of lerchCases) {
      test(`${name} = ${expected} at ${digits} digits`, () => {
        const n = phi(z, s, a).N();
        expectDigits(n.re, expected, digits);
      });
    }

    for (const [name, s, z, expected] of polylogCases) {
      test(`${name} = ${expected} at ${digits} digits`, () => {
        const n = li(s, z).N();
        expectDigits(n.re, expected, digits);
      });
    }

    test(`LerchPhi(0.5,2,1) reaches the same precision under plain evaluate()`, () => {
      // A float operand numericizes under plain `evaluate()`, not only
      // `N()` (an exact operand set, `['Rational', 1, 2]`, stays symbolic
      // under `evaluate()` — see 'LerchPhi: exactness' in
      // lerch-phi-values.test.ts).
      const n = phi(0.5, 2, 1).evaluate();
      expectDigits(
        n.re,
        1.164481052930025011805312640319360217488396949612252851,
        digits
      );
    });
  });
}

describe('LerchPhi and PolyLog: the term cap', () => {
  beforeAll(() => {
    ce.precision = 50;
  });
  afterAll(() => {
    ce.precision = MACHINE_PRECISION;
  });

  test('LerchPhi(0.9999,2,1) past the term cap falls back to the double kernel rather than certify a wrong digit', () => {
    // mpmath: lerchphi(0.9999,2,1) = 1.644077391995345031725298771108308762362
    // At 50 digits this close to z = 1 the series needs upward of a million
    // terms (see `LERCH_BIG_MAX_TERMS`'s doc comment): `bigLerchPhi`
    // declines and `evaluateLerchPhi` falls through to the double
    // continuation, so the result carries only that kernel's accuracy.
    const expected = 1.644077391995345031725298771108308762362;
    const n = phi(0.9999, 2, 1).N();
    expect(n.isExact).toBe(false);
    const relErr = Math.abs(n.re - expected) / expected;
    expect(relErr).toBeLessThan(1e-8); // the double kernel's own accuracy
    expect(relErr).toBeGreaterThan(1e-20); // proves it did not reach 50 digits
  });

  test('PolyLog(2,0.9999) past the term cap falls back the same way', () => {
    // mpmath: polylog(2,0.9999) = 1.643912984256145497222126241231197931486
    const expected = 1.643912984256145497222126241231197931486;
    const n = li(2, 0.9999).N();
    expect(n.isExact).toBe(false);
    const relErr = Math.abs(n.re - expected) / expected;
    expect(relErr).toBeLessThan(1e-8);
    expect(relErr).toBeGreaterThan(1e-20);
  });
});

describe('LerchPhi and PolyLog: evaluate() of exact operands stays exact', () => {
  // `evaluate()` returns the most exact form; only `.N()` or an inexact
  // operand numericizes, at any engine precision.
  for (const digits of [MACHINE_PRECISION, 30]) {
    test(`PolyLog(2,1/3) and LerchPhi(1/3,2,1) stay symbolic at ${digits} digits`, () => {
      ce.precision = digits;
      try {
        expect(li(2, ['Rational', 1, 3]).evaluate().toString()).toBe(
          'PolyLog(2, 1/3)'
        );
        expect(phi(['Rational', 1, 3], 2, 1).evaluate().toString()).toBe(
          'LerchPhi(1/3, 2, 1)'
        );
      } finally {
        ce.precision = MACHINE_PRECISION;
      }
    });
  }
});

/** `got`'s arbitrary-precision value agrees with the decimal string
 * `expected` to at least `digits` significant digits. The comparison is
 * done on big decimals, since the values below are outside the double
 * range. */
function expectBigDigits(
  got: ReturnType<typeof phi>,
  expected: string,
  digits: number
) {
  const value = got.bignumRe;
  expect(value).toBeDefined();
  const ref = ce.bignum(expected);
  const rel = value!.sub(ref).div(ref).abs().toNumber();
  expect(rel).toBeLessThan(10 ** (2 - digits));
}

describe('LerchPhi: values outside the double range', () => {
  // A term or a sum above 1.8e308 or below 1e-308 must not end the series
  // early (or keep it running to the term cap): the tail test is on
  // base-10 exponents, not on doubles.
  const cases: [string, unknown, unknown, unknown, string][] = [
    // mpmath: lerchphi(mpf('0.5'), mpf('-159.5'), 1)
    [
      'LerchPhi(0.5,-159.5,1)',
      0.5,
      -159.5,
      1,
      '2.62784929555984310206038378766756995748391895560623866004106e+309',
    ],
    // mpmath: lerchphi(mpf('0.9'), mpf('-120.5'), 1)
    [
      'LerchPhi(0.9,-120.5,1)',
      0.9,
      -120.5,
      1,
      '4.53661623365548699349563246532011429001545471619281539376506e+318',
    ],
    // mpmath: fsum(mpf('0.5')**k * mpf(k+50)**-200 for k in range(2000))
    // (`mpmath.lerchphi(0.5, 200, 50)` underflows to 0.0 here).
    [
      'LerchPhi(0.5,200,50)',
      0.5,
      200,
      50,
      '1.62240588233218200326285555901378136948829304537276526778249e-340',
    ],
  ];
  for (const digits of [MACHINE_PRECISION, 30, 50]) {
    for (const [name, z, s, a, expected] of cases) {
      test(`${name} = ${expected} at ${digits} digits`, () => {
        ce.precision = digits;
        try {
          expectBigDigits(phi(z, s, a).N(), expected, digits);
        } finally {
          ce.precision = MACHINE_PRECISION;
        }
      });
    }
  }
});
