import { ComputeEngine } from '../../src/compute-engine';

// An exact operand is read with guard digits under `.N()`. Ten digits cover
// the condition number of an ordinary operand, but not an operand of 10^8 or
// more (`Γ(3000000001/3)` was 7 units off at every precision), nor a sum of
// operands within 10^-11 of a pole (`Β(1/3, b)` with `a + b` near −4).
// The guard grows with the size of the operand, for the functions whose
// condition number grows with it (`Gamma`, `Factorial`, `Zeta`,
// `DirichletEta`, `HurwitzZeta`, `Exp`, `Binomial`, and `Power` by its
// exponent), and with the digits that a pole cancels.
//
// The expected values are mpmath 1.3, rounded to 30 significant digits.

const R = (n: number, d: number) => ['Rational', n, d];
const digits = (x: { bignumRe?: { toString(): string } | undefined }) =>
  x.bignumRe?.toString();

const CASES: [string, unknown, string][] = [
  [
    'Gamma',
    ['Gamma', R(3000000001, 3)],
    '9.90462657812247967292271068986e+8565705516',
  ],
  [
    'Zeta',
    ['Zeta', R(-3000000001, 3)],
    '-3.74527086894020607448148802386e+7767525656',
  ],
  [
    'DirichletEta',
    ['DirichletEta', R(-3000000001, 3)],
    '4.35349204660723783690945400600e+8068555652',
  ],
  [
    'HurwitzZeta, s of 10^15',
    ['HurwitzZeta', R(3000000000000001, 3), R(3, 7)],
    '3.28152801898441828639071624013e+367976785294594',
  ],
  [
    'Beta, a + b within 10^-11 of -4',
    ['Beta', R(1, 3), ['Add', R(-13, 3), R(1, 10 ** 11)]],
    '-5.81213071011722750791623053157e-11',
  ],
  [
    'Beta, a + b within 10^-20 of -4',
    ['Beta', R(1, 3), ['Add', R(-13, 3), R(1, 10 ** 20)]],
    '-5.81213071000766950816706591116e-20',
  ],
  // The distance of a + b to -4 is below the rounding scale of 30 digits: a
  // float of each operand cancels to 11 correct digits.
  [
    'Beta, a + b within 10^-29 of -4',
    ['Beta', R(1, 3), ['Add', R(-13, 3), ['Divide', 1, ['Power', 10, 29]]]],
    '-5.81213071000766950805750791141e-29',
  ],
  [
    'Binomial of operands of 10^15',
    ['Binomial', R(3000000000000001, 3), R(1500000000000001, 3)],
    '4.98307165538897117179910947850e+301029995663973',
  ],
  [
    'Exp of an operand of 10^15',
    ['Exp', R(3000000000000001, 3)],
    '9.38460410159297407572526645860e+434294481903251',
  ],
  // Singular at s = 1 and at a non-positive integer a only: regular at
  // s near 0, and Zeta (no pole rule) and DirichletEta (regular) at 1.
  [
    'HurwitzZeta, s of 10^-600',
    ['HurwitzZeta', ['Divide', 1, ['Power', 10, 600]], R(1, 3)],
    '1.66666666666666666666666666667e-1',
  ],
  [
    'HurwitzZeta, s within 10^-29 of 1',
    ['HurwitzZeta', ['Add', 1, ['Divide', 1, ['Power', 10, 29]]], R(1, 3)],
    '1.00000000000000000000000000003e+29',
  ],
  [
    'HurwitzZeta, a within 10^-29 of -3',
    ['HurwitzZeta', 2, ['Add', -3, ['Divide', 1, ['Power', 10, 29]]]],
    '1.0e+58',
  ],
  [
    'Zeta, s within 10^-29 of 1',
    ['Zeta', ['Add', 1, ['Divide', 1, ['Power', 10, 29]]]],
    '1.00000000000000000000000000001e+29',
  ],
  [
    'DirichletEta, s within 10^-29 of 1',
    ['DirichletEta', ['Add', 1, ['Divide', 1, ['Power', 10, 29]]]],
    '6.9314718055994530941723212146e-1',
  ],
  // The operand is an integer that 30 digits round: it is read exactly.
  [
    'GammaLn of 2^100',
    ['GammaLn', ['Power', 2, 100]],
    '8.65991933481037279603296505994e+31',
  ],
  // Well conditioned at a large operand: the size adds no guard, and the
  // value is not declined.
  [
    'Ln of 2^2000 + 1',
    ['Ln', ['Add', ['Power', 2, 2000], 1]],
    '1.38629436111989061883446424292e+3',
  ],
  [
    'Arctan of 10^600 + 1',
    ['Arctan', ['Add', ['Power', 10, 600], 1]],
    '1.57079632679489661923132169164',
  ],
  [
    'Sqrt of 10^600 + 1/3',
    ['Sqrt', ['Add', ['Power', 10, 600], R(1, 3)]],
    '1.0e+300',
  ],
  [
    'Sin of 10^600 + 1',
    ['Sin', ['Add', ['Power', 10, 600], 1]],
    '3.74483527429130968012891553231e-1',
  ],
];

describe('GUARD DIGITS GROW WITH THE OPERAND', () => {
  test.each(CASES)('%s at 30 digits', (_name, expr, expected) => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    expect(digits(ce.box(expr as never).N() as never)).toEqual(
      ce.bignum(expected).toString()
    );
  });

  test('Gamma(3000000001/3) at 50 digits (first 30 digits, truncated)', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    const v = digits(ce.box(['Gamma', R(3000000001, 3)]).N() as never)!;
    expect(v.slice(0, 31)).toEqual('9.90462657812247967292271068985');
  });
});

// A sum or difference of two operands adds guard digits only where the
// function is singular: `a + b` of `Beta` at a non-positive integer, `n - k`
// of `Binomial` at a negative one. `Beta(π, π)` and `Binomial(π, π)` are
// regular at `a - b = 0`, which cannot be told from a pole numerically.
// The expected values are the engine's own at 330 digits, rounded to 30.
const REGULAR_SUMS: [string, unknown, string][] = [
  ['Beta(π, π)', ['Beta', 'Pi', 'Pi'], '2.67184890011137745224235523539e-2'],
  ['Binomial(π, π)', ['Binomial', 'Pi', 'Pi'], '1'],
  [
    'Beta, a - b within 10^-600 of -1',
    ['Beta', ['Add', R(1, 3), ['Divide', 1, ['Power', 10, 600]]], R(4, 3)],
    '2.64995812542817493597053424947',
  ],
  [
    'Binomial, k within 10^-600 of 1/2 and n - k of 3',
    ['Binomial', R(7, 2), ['Add', R(1, 2), ['Divide', 1, ['Power', 10, 600]]]],
    '2.1875',
  ],
  [
    'Binomial, n - k within 10^-29 of -1',
    ['Binomial', R(1, 3), ['Add', R(4, 3), ['Divide', 1, ['Power', 10, 29]]]],
    '-7.49999999999999999999999999991e-30',
  ],
];

describe('ONLY THE SINGULAR SUMS OF OPERANDS ADD GUARD DIGITS', () => {
  test.each(REGULAR_SUMS)('%s at 30 digits', (_name, expr, expected) => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    expect(digits(ce.box(expr as never).N() as never)).toEqual(
      ce.bignum(expected).toString()
    );
  });
});

// `b^x` is ill conditioned at a large exponent: the error of `x` reaches the
// result multiplied by `|x·ln b|`, and that of `b` by `|x|`. The size of the
// exponent sets the guard digits, for every base. The expected values are
// decimal.js `exp(x·ln b)` at 200 digits, rounded.
const POWERS: [string, unknown, string, string][] = [
  [
    '2^(3000000000000001/3)',
    ['Power', 2, R(3000000000000001, 3)],
    '1.97495439177298922275641642908e+301029995663981',
    '1.9749543917729892227564164290838368477097920168537e+301029995663981',
  ],
  [
    '3^(-3000000000000001/7)',
    ['Power', 3, R(-3000000000000001, 7)],
    '5.55172142538540491020551905093e-204480537736999',
    '5.5517214253854049102055190509251677240089421759847e-204480537736999',
  ],
  [
    '(1/3)^(1000000000001/3)',
    ['Power', R(1, 3), R(1000000000001, 3)],
    '8.98422217834026694857872336493e-159040418241',
    '8.9842221783402669485787233649298030926046111861287e-159040418241',
  ],
  [
    'π^(1000000000001/3)',
    ['Power', 'Pi', R(1000000000001, 3)],
    '3.49677810894109102404740901594e+165716624231',
    '3.4967781089410910240474090159359727303518662015359e+165716624231',
  ],
  // A float exponent has no rounding error, but its size multiplies the
  // error of the base.
  [
    '(1/3)^123456789012345.5',
    ['Power', R(1, 3), 123456789012345.5],
    '1.20192536486320256703117195e-58903858077231',
    '1.201925364863202567031171949999789058276182271837e-58903858077231',
  ],
];

describe('THE GUARD OF A POWER GROWS WITH ITS EXPONENT', () => {
  test.each(POWERS)('%s', (_name, expr, at30, at50) => {
    for (const [precision, expected] of [
      [30, at30],
      [50, at50],
    ] as const) {
      const ce = new ComputeEngine();
      ce.precision = precision;
      expect(digits(ce.box(expr as never).N() as never)).toEqual(
        ce.bignum(expected).toString()
      );
    }
  });

  test('the size of the base adds no guard', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const v = ce
      .box(['Power', ['Add', ['Power', 10, 600], R(1, 3)], R(1, 3)])
      .N();
    expect(digits(v as never)).toEqual(ce.bignum('1e200').toString());
  });

  test('an exact integer exponent past the cap is answered', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const v = ce.box(['Power', R(1, 3), ['Power', 10, 600]]).N();
    expect(v.isSame(0)).toBe(true);
  });

  test('an exponent past the cap that is not an integer stays unevaluated', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const r = ce
      .box(['Power', 2, ['Add', ['Power', 10, 600], R(1, 3)]])
      .N();
    expect(r.operator).toBe('Power');
  });
});

describe('THE GUARD IS CAPPED', () => {
  test('an operand beyond the cap stays unevaluated instead of answering from too few digits', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const r = ce.box(['Gamma', ['Add', ['Power', 10, 600], R(1, 3)]]).N();
    expect(r.isNumberLiteral && Number.isFinite(r.re) && r.re !== 0).toBe(
      false
    );
  });

  test('an exact integer operand that the working precision holds exactly is not capped', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    // 10^1000 has no rounding error, so its size costs no guard digits.
    const v = ce.box(['Log', 5, ['Power', 10, 1000]]).N();
    expect(v.isNumberLiteral).toBe(true);
    expect(v.re).toBeCloseTo(Math.log(5) / Math.log(10) / 1000, 12);
    // 10^600 + 1 is rounded at 30 digits, so Gamma of it is capped.
    const r = ce.box(['Gamma', ['Add', ['Power', 10, 600], 1]]).N();
    expect(r.operator).toBe('Gamma');
  });

  test('a distance to a pole past the cap stays unevaluated', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const r = ce
      .box([
        'Beta',
        R(1, 3),
        ['Add', R(-13, 3), ['Divide', 1, ['Power', 10, 600]]],
      ])
      .N();
    expect(r.operator).toBe('Beta');
  });
});
