import { ComputeEngine } from '../../src/compute-engine';

describe('Covariance at machine precision', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const cov = (s: string) => ce.parse(`\\mathrm{Covariance}(${s})`).evaluate();

  test('a covariance of machine range survives products that overflow', () => {
    // Deviations `[10²⁰⁰, −10²⁰⁰, 0]` and `[10²⁰⁰, 10²⁰⁰, −2·10²⁰⁰]`: the
    // covariance is 0, but the unscaled products are ±10⁴⁰⁰ and summed to NaN.
    expect(cov('[1e200, -1e200, 0], [1e200, 1e200, -2e200]').re).toBe(0);
    expect(cov('[1e200, 2e200, 3e200], [1e-200, 2e-200, 3e-200]').re).toBe(1);
    expect(cov('[1e-200, 2e-200, 3e-200], [1e-200, 2e-200, 3e-200]').re).toBe(
      0
    );
  });

  test('columns at the two ends of the double range', () => {
    // The scales are 2¹⁰²³ and 2⁻¹⁰²³; applied one at a time the first
    // product overflowed while the covariance is 2.
    expect(cov('[2^{1023}, -2^{1023}], [2^{-1023}, -2^{-1023}]').re).toBe(2);
  });

  test('ordinary data is unchanged', () => {
    expect(cov('[1.0, 2.0, 4.0], [2.0, 3.0, 7.0]').re).toBe(4);
    expect(
      ce
        .parse(
          '\\mathrm{PopulationCovariance}([1.0, 2.0, 4.0], [2.0, 3.0, 7.0])'
        )
        .N().re
    ).toBeCloseTo(8 / 3, 12);
  });

  test('a covariance with no double reads as an infinity', () => {
    // The value is 10⁴⁰⁰, outside the double range: the machine answer for
    // such a value, as `Exp(1000).N()` is at machine precision.
    expect(
      cov('[1.5e200, 2.5e200, 3.5e200], [1.5e200, 2.5e200, 3.5e200]').re
    ).toBe(Infinity);
  });
});

describe('LinearRegression and PolynomialFit: the expression form is typed', () => {
  const ce = new ComputeEngine();

  test('the coefficient forms keep their declared results', () => {
    expect(
      ce.parse('\\mathrm{LinearRegression}([1,2,3],[2,4,6])').type.toString()
    ).toBe('tuple<number, number>');
    expect(
      ce.parse('\\mathrm{PolynomialFit}([1,2,3],[2,4,6],1)').type.toString()
    ).toBe('list<number>');
  });

  test('a trailing variable symbol makes the result a number', () => {
    const lin = ce.parse('\\mathrm{LinearRegression}([1,2,3],[2,4,6],x)');
    expect(lin.type.toString()).toBe('number');
    expect(lin.evaluate().toString()).toBe('2x');
    const poly = ce.parse('\\mathrm{PolynomialFit}([1,2,3],[2,4,6],1,x)');
    expect(poly.type.toString()).toBe('number');
    expect(poly.evaluate().toString()).toBe('2x');
  });
});
