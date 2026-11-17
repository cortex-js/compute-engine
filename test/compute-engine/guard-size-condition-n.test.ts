import { ComputeEngine } from '../../src/compute-engine';

// An exact operand is read with guard digits under `.N()`. Ten digits cover
// the condition number of an ordinary operand, but not an operand of 10^8 or
// more (`Γ(3000000001/3)` was 7 units off at every precision), nor a sum of
// operands within 10^-11 of a pole (`Β(1/3, b)` with `a + b` near −4).
// The guard grows with the size of the operand, for the functions whose
// condition number grows with it (`Gamma`, `Factorial`, `Zeta`,
// `DirichletEta`, `HurwitzZeta`, `Exp`, `Binomial`), and with the digits that
// a pole cancels.
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
