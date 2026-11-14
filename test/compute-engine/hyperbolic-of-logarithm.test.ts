/**
 * Hyperbolic functions of the logarithm of an exact rational, and `Arsech` of
 * a rational above 1: `evaluate()` and `.simplify()` give the closed form, and
 * `.N()` agrees with it.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

type Json = any;

const q = (a: number, b: number) => ['Rational', a, b];

describe('Hyperbolic functions of Ln(q)', () => {
  const cases: [string, Json, string, number][] = [
    ['Sinh', 2, '3/4', 0.75],
    ['Cosh', 2, '5/4', 1.25],
    ['Tanh', 3, '4/5', 0.8],
    ['Coth', 3, '5/4', 1.25],
    ['Sech', 3, '3/5', 0.6],
    ['Csch', 3, '3/4', 0.75],
    ['Sinh', q(1, 2), '-3/4', -0.75],
    ['Sinh', q(5, 3), '8/15', 0.5333333333333333],
  ];
  for (const [op, arg, text, value] of cases) {
    test(`${op}(Ln(${JSON.stringify(arg)})) = ${text} (evaluate, simplify, N)`, () => {
      const call = ce.expr([op, ['Ln', arg]]);
      expect(call.evaluate().toString()).toBe(text);
      expect(call.simplify().toString()).toBe(text);
      expect(call.N().re).toBeCloseTo(value, 14);
    });
  }

  test('the parse route and a compound argument', () => {
    expect(ce.parse('\\sinh(\\ln 2)').evaluate().toString()).toBe('3/4');
    expect(
      ce
        .expr(['Sinh', ['Ln', ['Add', 2, ['Subtract', 'x', 'x']]]])
        .evaluate()
        .toString()
    ).toBe('3/4');
  });

  test('a symbolic, float or huge argument is left alone', () => {
    expect(ce.expr(['Tanh', ['Ln', 'x']]).evaluate().operator).toBe('Tanh');
    expect(ce.expr(['Sinh', ['Ln', 2.5]]).evaluate().isExact).not.toBe(true);
    const huge = { num: '1' + '0'.repeat(150) };
    expect(ce.expr(['Sinh', ['Ln', huge]]).evaluate().operator).toBe('Sinh');
  });

  test('a pole stays a pole', () => {
    expect(
      ce
        .expr(['Coth', ['Ln', 1]])
        .evaluate()
        .toString()
    ).toBe('~oo');
  });
});

describe('Arsech of a rational above 1', () => {
  test('Arsech(2) = i Pi/3', () => {
    const call = ce.expr(['Arsech', 2]);
    expect(
      call
        .evaluate()
        .isSame(ce.expr(['Multiply', ['Divide', 'Pi', 3], 'ImaginaryUnit']))
    ).toBe(true);
    expect(call.N().im).toBeCloseTo(1.0471975511965976, 14);
    expect(call.N().re).toBeCloseTo(0, 14);
  });
  test('Arsech(3/2) = i Arccos(2/3), with the numeric value of the call', () => {
    const call = ce.expr(['Arsech', q(3, 2)]);
    expect(call.evaluate().operator).not.toBe('Arsech');
    expect(call.evaluate().N().im).toBeCloseTo(0.8410686705679303, 14);
    expect(call.N().im).toBeCloseTo(0.8410686705679303, 14);
  });
  test('Arsech(1/2) is in the real domain and is left alone', () => {
    expect(ce.expr(['Arsech', q(1, 2)]).evaluate().operator).toBe('Arsech');
  });
});
