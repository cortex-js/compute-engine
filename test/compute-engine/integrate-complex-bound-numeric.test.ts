import { ComputeEngine } from '../../src/compute-engine';

// `N()` of a definite integral with a bound that is not a real number: the
// quadrature runs over a real interval, so the value is the numeric value of
// the closed form, and without a closed form the integral stays unevaluated
// (CE-1440). `∫_i^0 t dt` was 0, the quadrature over the real parts.

const ce = new ComputeEngine();
const integral = (body: unknown, lower: unknown, upper: unknown) =>
  ce.box(['Integrate', ['Function', body, 't'], ['Limits', 't', lower, upper]]);
const I = ['Complex', 0, 1];

describe('N() OF AN INTEGRAL WITH A COMPLEX BOUND', () => {
  test('the closed form', () => {
    expect(integral('t', I, 0).N().re).toBe(0.5);
    expect(integral('t', 0, I).N().re).toBe(-0.5);
    expect(ce.box(['Square', integral('t', I, 0)]).N().re).toBe(0.25);
  });

  test('a complex value: 1 − cos(1 + i)', () => {
    const v = integral(['Sin', 't'], 0, ['Complex', 1, 1]).N();
    // 1 − cos(1)·cosh(1) + i·sin(1)·sinh(1)
    expect(v.re).toBeCloseTo(1 - Math.cos(1) * Math.cosh(1), 14);
    expect(v.im).toBeCloseTo(Math.sin(1) * Math.sinh(1), 14);
  });

  test('a double integral', () => {
    const e = ce.box([
      'Integrate',
      ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
      ['Limits', 'x', 0, I],
      ['Limits', 'y', 0, 1],
    ]);
    expect(e.N().re).toBe(-0.25);
  });

  test('no closed form: unevaluated', () => {
    const e = integral(['Gamma', 't'], 1, ['Complex', 2, 1]);
    expect(e.N().operator).toBe('Integrate');
  });

  test('a real bound keeps the quadrature', () => {
    expect(
      integral(['Exp', ['Negate', ['Square', 't']]], 0, 1).N().re
    ).toBeCloseTo(0.746824132812427, 12);
  });
});
