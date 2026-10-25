import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const simplify = (latex: string) => ce.parse(latex).simplify();

// CE-154: `simplify()` collects the terms of a sum that differ only by a
// constant cofactor such as `√2 − 1`.
describe('CE-154 terms with a constant cofactor are collected', () => {
  test('π(√2 − 1) + π(√2 + 1)', () => {
    const e = simplify('\\pi(\\sqrt2-1)+\\pi(\\sqrt2+1)');
    expect(e.toString()).toBe('2sqrt(2) * pi');
    expect(e.N().re).toBeCloseTo(2 * Math.SQRT2 * Math.PI, 12);
  });

  test('π(−1/2 + √2/4) + π(1/2 + √2/4)', () => {
    const e = simplify(
      '\\pi(-\\frac12+\\frac{\\sqrt2}{4})+\\pi(\\frac12+\\frac{\\sqrt2}{4})'
    );
    expect(e.toString()).toBe('sqrt(2)/2 * pi');
    expect(e.N().re).toBeCloseTo(Math.PI / Math.SQRT2, 12);
  });

  test('the residue integral of PR #410 evaluates to π/√2', () => {
    const e = ce
      .parse('\\int_{-\\infty}^{\\infty} \\frac{x^2-1}{(x-1)(x^4+1)} dx')
      .evaluate();
    expect(e.toString()).toBe('sqrt(2)/2 * pi');
  });

  test('a symbolic cofactor is collected as before', () => {
    expect(simplify('x\\cdot(y-\\frac12)+x\\cdot(y+\\frac12)').toString()).toBe(
      '2x * y'
    );
  });

  test('terms with different other factors are not combined', () => {
    const e = simplify('\\pi(\\sqrt2-1)+e(\\sqrt2+1)');
    expect(e.operator).toBe('Add');
  });
});
