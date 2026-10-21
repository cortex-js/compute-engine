import { ComputeEngine } from '../../src/compute-engine';
import {
  factorRationalExpression,
  rationalPolynomialCoefficients,
} from '../../src/compute-engine/polynomial/boxed-factor';

describe('Factor with certified rational polynomial fallback', () => {
  const ce = new ComputeEngine();
  test.each([
    ['x^4+3x^2+2', '(x^2+1)(x^2+2)'],
    ['x^4+4', '(x^2-2x+2)(x^2+2x+2)'],
    ['x^4+2x^3+3x^2+2x+2', '(x^2+1)(x^2+2x+2)'],
  ])('finds nonlinear factors of %s', (source, target) => {
    const f = ce.parse(source),
      result = ce.box(['Factor', f, 'x']).evaluate();
    expect(result.operator).toBe('Multiply');
    expect(result.isSame(ce.parse(target))).toBe(true);
    expect(ce.box(['Expand', result]).evaluate().isSame(f)).toBe(true);
  });
  test('does not invent a coefficient field for symbolic or irrational inputs', () => {
    expect(rationalPolynomialCoefficients(ce.parse('x^2+a'), 'x')).toBeNull();
    expect(
      rationalPolynomialCoefficients(ce.parse('x^2+\\sqrt{2}'), 'x')
    ).toBeNull();
    expect(
      rationalPolynomialCoefficients(
        ce.box(['Add', ['Power', 'x', 2], ['Divide', 1, 'x']]),
        'x'
      )
    ).toBeNull();
    expect(
      rationalPolynomialCoefficients(ce.parse('x^{10000}+1'), 'x')
    ).toBeNull();
  });
  test('explicit variables remain protected from assigned values', () => {
    const engine = new ComputeEngine();
    const f = engine.parse('x^4+3x^2+2');
    engine.assign('x', 5);
    const result = engine.box(['Factor', f, 'x']).evaluate();
    expect(result.has('x')).toBe(true);
  });
  test('a recognized rational input stays unchanged on resource exhaustion', () => {
    const input = ce.function('Add', [
      ce.function('Power', [ce.symbol('x'), ce.number(3)]),
      ce.number(1n << 5000n),
    ]);
    expect(factorRationalExpression(input, 'x')).toBe(input);
  });
});
