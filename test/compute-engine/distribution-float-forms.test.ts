import { ComputeEngine } from '../../src/compute-engine';

//
// A float operand of a distribution function gives a float result, and
// `UniformDistribution` takes Wolfram's list and zero-argument forms.
// Reference values are Wolfram's.
//

const ce = new ComputeEngine();
const f = (s: string) => ({ num: s });
const half = ['Rational', 1, 2];

const isFloat = (x: ReturnType<typeof ce.box>) =>
  x.re !== undefined &&
  Number.isFinite(x.re) &&
  x.isNumberLiteral &&
  !x.isExact;

describe('A float parameter or point gives a float', () => {
  // [description, expression, Wolfram value]
  const cases: [string, unknown, number][] = [
    [
      'PDF(Normal(0.0, 1), 1/2)',
      ['PDF', ['NormalDistribution', f('0.0'), 1], half],
      0.3520653267642995,
    ],
    [
      'PDF(Normal(0, 1), 0.5)',
      ['PDF', ['NormalDistribution', 0, 1], f('0.5')],
      0.3520653267642995,
    ],
    [
      'CDF(Normal(0, 1), 0.5)',
      ['CDF', ['NormalDistribution', 0, 1], f('0.5')],
      0.6914624612740131,
    ],
    [
      'PDF(Exponential(2), 0.5)',
      ['PDF', ['ExponentialDistribution', 2], f('0.5')],
      0.7357588823428847,
    ],
    [
      'PDF(Poisson(2), 3.0)',
      ['PDF', ['PoissonDistribution', 2], f('3.0')],
      0.1804470443154836,
    ],
    [
      'CDF(Binomial(10, 0.5), 3)',
      ['CDF', ['BinomialDistribution', 10, f('0.5')], 3],
      0.171875,
    ],
    [
      'CDF(Poisson(2.0), 1/2)',
      ['CDF', ['PoissonDistribution', f('2.0')], half],
      0.1353352832366127,
    ],
    [
      'PDF(Uniform(0.0, 4), 1)',
      ['PDF', ['UniformDistribution', f('0.0'), 4], 1],
      0.25,
    ],
    [
      'CDF(Uniform(0.0, 4), 3)',
      ['CDF', ['UniformDistribution', f('0.0'), 4], 3],
      0.75,
    ],
    [
      'Quantile(Normal(0, 1), 0.975)',
      ['Quantile', ['NormalDistribution', 0, 1], f('0.975')],
      1.959963984540054,
    ],
    [
      'Mean(Uniform(0.0, 4))',
      ['Mean', ['UniformDistribution', f('0.0'), 4]],
      2,
    ],
    [
      'Mean(Binomial(10, 0.5))',
      ['Mean', ['BinomialDistribution', 10, f('0.5')]],
      5,
    ],
    [
      'StandardDeviation(Poisson(4.0))',
      ['StandardDeviation', ['PoissonDistribution', f('4.0')]],
      2,
    ],
  ];
  for (const [name, expr, want] of cases) {
    test(`${name} is the float ${want} (evaluate and N)`, () => {
      for (const r of [
        ce.box(expr as any).evaluate(),
        ce.box(expr as any).N(),
      ]) {
        expect(isFloat(r)).toBe(true);
        expect(r.re).toBeCloseTo(want, 12);
      }
    });
  }

  test('a float point of a discrete distribution follows Wolfram', () => {
    const pmf = (x: unknown) =>
      ce.box(['PDF', ['PoissonDistribution', 2], x as any]).evaluate();
    const cdf = (x: unknown) =>
      ce.box(['CDF', ['PoissonDistribution', 2], x as any]).evaluate();
    // the mass off the integers is the exact 0, and the CDF is its floor's
    expect(pmf(f('0.5')).toString()).toBe('0');
    expect(pmf(f('0.5')).isExact).toBe(true);
    expect(cdf(f('2.5')).toString()).toBe('5 / e^2');
    expect(cdf(f('3.0')).toString()).toBe('19 / (3e^2)');
    expect(cdf(f('-1.5')).toString()).toBe('0');
    // the mass at an integer-valued float is a float
    expect(isFloat(pmf(f('3.0')))).toBe(true);
    // a float parameter still gives a float CDF, and the exact 0 mass
    const g = ce
      .box(['PDF', ['PoissonDistribution', f('2.0')], half])
      .evaluate();
    expect(g.toString()).toBe('0');
    expect(g.isExact).toBe(true);
  });

  test('exact operands stay exact under evaluate()', () => {
    expect(
      ce
        .box(['PDF', ['UniformDistribution', 0, 4], 1])
        .evaluate()
        .toString()
    ).toBe('1/4');
    expect(
      ce.box(['CDF', ['BinomialDistribution', 10, half], 3]).evaluate().operator
    ).toBe('BetaRegularized');
    expect(
      ce
        .box(['Variance', ['NormalDistribution', f('0.0'), 1]])
        .evaluate()
        .toString()
    ).toBe('1');
  });
});

describe('UniformDistribution([a, b]) and UniformDistribution()', () => {
  const cases: [string, unknown, string][] = [
    [
      'UniformDistribution([1, 3])',
      ['UniformDistribution', ['List', 1, 3]],
      'UniformDistribution(1, 3)',
    ],
    [
      'UniformDistribution()',
      ['UniformDistribution'],
      'UniformDistribution(0, 1)',
    ],
    [
      'Mean(UniformDistribution([1, 3]))',
      ['Mean', ['UniformDistribution', ['List', 1, 3]]],
      '2',
    ],
    [
      'Variance(UniformDistribution([1, 3]))',
      ['Variance', ['UniformDistribution', ['List', 1, 3]]],
      '1/3',
    ],
    [
      'PDF(UniformDistribution([1, 3]), 2)',
      ['PDF', ['UniformDistribution', ['List', 1, 3]], 2],
      '1/2',
    ],
    [
      'CDF(UniformDistribution([1, 3]), 2)',
      ['CDF', ['UniformDistribution', ['List', 1, 3]], 2],
      '1/2',
    ],
    [
      'Quantile(UniformDistribution([1, 3]), 1/4)',
      ['Quantile', ['UniformDistribution', ['List', 1, 3]], ['Rational', 1, 4]],
      '3/2',
    ],
    ['Mean(UniformDistribution())', ['Mean', ['UniformDistribution']], '1/2'],
    [
      'CDF(UniformDistribution(), 1/4)',
      ['CDF', ['UniformDistribution'], ['Rational', 1, 4]],
      '1/4',
    ],
    [
      'Mean(UniformDistribution([a, b]))',
      ['Mean', ['UniformDistribution', ['List', 'a', 'b']]],
      '1/2 * (a + b)',
    ],
  ];
  for (const [name, expr, want] of cases)
    test(`${name} is ${want}`, () => {
      expect(
        ce
          .box(expr as any)
          .evaluate()
          .toString()
      ).toBe(want);
      expect(
        ce
          .box(expr as any)
          .N()
          .toString()
      ).toBe(
        ce
          .box(expr as any)
          .evaluate()
          .N()
          .toString()
      );
    });

  test('the list form is canonical: it equals the two-argument form', () => {
    expect(ce.box(['UniformDistribution', ['List', 1, 3]]).json).toEqual([
      'UniformDistribution',
      1,
      3,
    ]);
  });

  test('the bounds are checked as in the two-argument form', () => {
    expect(
      ce.box(['UniformDistribution', ['List', 3, 1]]).evaluate().isValid
    ).toBe(false);
  });
});
