import { engine as ce } from '../utils';

describe('STOCHASTIC EQUALITY', () => {
  it('trig identity: sin²(x) + cos²(x) = 1', () => {
    const a = ce.parse('\\sin^2(x) + \\cos^2(x)');
    const b = ce.parse('1');
    expect(a.isEqual(b)).toBe(true);
  });

  it('algebraic: (x²-1)/(x-1) = x+1', () => {
    const a = ce.parse('\\frac{x^2-1}{x-1}');
    const b = ce.parse('x+1');
    expect(a.isEqual(b)).toBe(true);
  });

  it('multi-variable: (x+y)² = x²+2xy+y²', () => {
    const a = ce.parse('(x+y)^2');
    const b = ce.parse('x^2 + 2xy + y^2');
    expect(a.isEqual(b)).toBe(true);
  });

  it('not equal: x² ≠ x³', () => {
    const a = ce.parse('x^2');
    const b = ce.parse('x^3');
    expect(a.isEqual(b)).toBe(false);
  });

  it('different unknowns that cancel: x - x + y = y', () => {
    const a = ce.parse('x - x + y');
    const b = ce.parse('y');
    expect(a.isEqual(b)).toBe(true);
  });

  it('double angle: sin(2x) = 2sin(x)cos(x)', () => {
    const a = ce.parse('\\sin(2x)');
    const b = ce.parse('2\\sin(x)\\cos(x)');
    expect(a.isEqual(b)).toBe(true);
  });

  it('constant expressions with unknowns: 0·x = 0', () => {
    const a = ce.parse('0 \\cdot x');
    const b = ce.parse('0');
    expect(a.isEqual(b)).toBe(true);
  });
});
