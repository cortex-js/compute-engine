import { ComputeEngine } from '../../src/compute-engine';

// Binomial, Factorial, GammaRegularized, BetaRegularized and ClausenCl read
// the exact operands (`1/3`) with guard digits under `.N()`: the operand
// rounded to the working precision reached the last digits of the result,
// multiplied by the condition number of the function (up to 10^8 units at
// large arguments).
//
// The expected values are mpmath 1.3 at 60 digits, rounded to 30 significant
// digits.

const ce = new ComputeEngine();
ce.precision = 30;

const R = (n: number, d: number) => ['Rational', n, d];

const CASES: [string, unknown[], string][] = [
  ['Factorial', [R(328, 6)], '3.33183394841567524305291050755e+72'],
  ['Factorial', [R(143, 7)], '8917745289711689026.75866728949'],
  ['Binomial', [R(343, 9), R(385, 3)], '3.69749414901491352344290344898e-36'],
  [
    'GammaRegularized',
    [R(121, 6), R(372, 3)],
    '1.10449860376922501174497420911e-31',
  ],
  [
    'GammaRegularized',
    [R(29, 7), R(355, 4)],
    '5.46174565163477099973547467230e-34',
  ],
  [
    'BetaRegularized',
    [R(1, 20), R(340, 7), R(63, 7)],
    '6.64853161368239524991504884905e-55',
  ],
  [
    'BetaRegularized',
    [R(16, 20), R(290, 3), R(35, 2)],
    '0.0892885890122092977844983317574',
  ],
  ['ClausenCl', [2, R(46, 3)], '0.257475177422239284325979122188'],
  ['ClausenCl', [6, R(44, 7)], '0.00262236479431961252500529125203'],
];

const digits = (x: { bignumRe?: { toString(): string } | undefined }) =>
  x.bignumRe?.toString();
const norm = (s: string) => ce.bignum(s).toString();

describe('EXACT OPERANDS OF FACTORIAL, BINOMIAL AND THE REGULARIZED FUNCTIONS', () => {
  test.each(CASES)('%s %j under N()', (head, args, expected) => {
    const result = ce.box([head, ...args]).N();
    expect(digits(result as never)).toEqual(norm(expected));
  });

  test.each(CASES)(
    '%s %j under evaluate({ numericApproximation })',
    (head, args, expected) => {
      const result = ce
        .box([head, ...args])
        .evaluate({ numericApproximation: true });
      expect(digits(result as never)).toEqual(norm(expected));
    }
  );
});

describe('BINOMIAL OF FLOAT OPERANDS', () => {
  // The Γ(n+1)/(Γ(k+1)Γ(n−k+1)) quotient is computed with guard digits and
  // rounded once: it ended 2 units off.
  test.each([
    ['48.5', '1.625', '372.655876927257712375893599974'],
    ['36.5637658769236', '10.4729527726512', '468687674.774337117158424566300'],
  ])('Binomial(%s, %s)', (n, k, expected) => {
    const result = ce.box(['Binomial', { num: n }, { num: k }]).evaluate();
    expect(digits(result as never)).toEqual(norm(expected));
  });
});

describe('BINOMIAL POLES ARE DECIDED ON THE EXACT OPERANDS', () => {
  // Γ(n − k + 1) = Γ(−60) is in the denominator: the value is 0. The float
  // of n − k + 1 is −60 + 10^−29, which is not a pole.
  test.each([
    [R(19, 6), R(385, 6)],
    [R(19, 6), R(379, 6)],
  ])('Binomial(%j, %j)', (n, k) => {
    const b = ce.box(['Binomial', n, k]);
    expect(b.evaluate().json).toEqual(0);
    expect(b.N().re).toBe(0);
  });

  test('Choose agrees', () => {
    expect(ce.box(['Choose', R(19, 6), R(385, 6)]).N().re).toBe(0);
  });
});

describe('GAMMAREGULARIZED OF AN INTEGER ORDER', () => {
  // Q(n, z) = e^{−z} Σ z^k/k!: Exp and the sum were each rounded at the
  // working precision, so the result ended 1–3 units off.
  test.each([
    [7, 2, '0.995466194473751133709196285242'],
    [3, 1, '0.919698602928605803988809425404'],
    [7, 1, '0.999916758850711976892277803064'],
  ])('GammaRegularized(%i, %i)', (a, z, expected) => {
    const result = ce.box(['GammaRegularized', a, z]).N();
    expect(digits(result as never)).toEqual(norm(expected));
  });
});
