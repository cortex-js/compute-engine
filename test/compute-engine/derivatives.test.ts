import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { engine } from '../utils';

function parse(expr: string): BoxedExpression {
  return engine.parse(expr)!;
}

describe('D', () => {
  it('should compute the partial derivative of a polynomial', () => {
    const expr = parse('D(x^3 + 2x - 4, x)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`3x^2+2`);
  });

  it('should compute the partial derivative of a function with respect to a variable', () => {
    const expr = parse('D(x^2 + y^2, x)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`2x`);
  });

  it('should compute higher order partial derivatives', () => {
    const expr = parse('D(D(x^2 + y^2, x), x)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`2`);
  });

  it('should compute the partial derivative of a function with respect to a variable in a multivariable function with multiple variables', () => {
    const expr = parse('D(5x^3 + 7y^5 + 11z^{13}, x, x)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`30x`);
  });

  it('should compute the partial derivative of a function with respect to a variable in a multivariable function with multiple variables', () => {
    const expr = parse('D(x^2 + y^2 + z^2, x, y, z)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`0`);
  });

  it('should compute the partial derivative of a trigonometric function', () => {
    const expr = parse('D(\\sin(x), x)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`\\cos(x)`);
  });

  // \frac{2x+2}{x^2+2x}-\frac{\cos(\frac{1}{x})}{x^2}
  it('should compute a complex partial derivative', () => {
    const expr = parse('D(\\sin(\\frac{1}{x}) + \\ln(x^2+2x), x)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(
      `\\frac{2x+2}{x^2+2x}-\\frac{\\cos(\\frac{1}{x})}{x^2}`
    );
  });
});

describe('Derivative', () => {
  it('should compute the derivative of a function', () => {
    const expr = engine.box(['Derivative', 'Sin']);
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`\\cos(\\operatorname{\\_})`);
  });

  it('should compute higher order derivatives', () => {
    const expr = engine.box([
      'Derivative',
      ['Function', ['Square', 'x'], 'x'],
      2,
    ]);
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`2`);
  });
});

describe('Hyperbolic derivatives', () => {
  it('should compute d/dx sech(x) = -tanh(x)*sech(x)', () => {
    const expr = parse('D(\\sech(x), x)');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-(tanh(x) * sech(x))`);
  });

  it('should compute d/dx csch(x) = -coth(x)*csch(x)', () => {
    const expr = parse('D(\\csch(x), x)');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-(csch(x) * coth(x))`);
  });
});

describe('Symbolic output for exponential derivatives', () => {
  it('should compute d/dx 2^x = ln(2) * 2^x symbolically', () => {
    const expr = parse('D(2^x, x)');
    const result = expr.evaluate();
    // Should return ln(2) * 2^x, not 0.693... * 2^x
    expect(result.toString()).toMatchInlineSnapshot(`ln(2) * 2^x`);
  });

  it('should compute d/dx 3^x = ln(3) * 3^x symbolically', () => {
    const expr = parse('D(3^x, x)');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`ln(3) * 3^x`);
  });
});

describe('Power rule edge cases', () => {
  it('should compute d/dx x^x = x^x * (ln(x) + 1)', () => {
    const expr = parse('D(x^x, x)');
    const result = expr.evaluate();
    // x^x * (1 + ln(x)) = x^x + ln(x) * x^x
    expect(result.toString()).toMatchInlineSnapshot(`x^x + ln(x) * x^x`);
  });

  it('should compute d/dx (x^2)^3 = 6x^5', () => {
    const expr = parse('D((x^2)^3, x)');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`6x^5`);
  });

  it('should compute d/dx (2x)^3 = 24x^2', () => {
    const expr = parse('D((2x)^3, x)');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`24x^2`);
  });
});

describe('ND', () => {
  it('should compute the numerical approximation of the derivative of a polynomial', () => {
    const expr = parse('\\mathrm{ND}(x \\mapsto x^3 + 2x - 4, 2)');
    const result = expr.N();
    expect(result.json).toMatchInlineSnapshot(`
      {
        num: 14.000000000000007,
      }
    `);
  });

  it('should compute the numerical approximation of the derivative of an expression', () => {
    const expr = parse('\\mathrm{ND}(x \\mapsto \\cos x + 2x^3 - 4, 2)');
    const result = expr.N();
    expect(result.json).toMatchInlineSnapshot(`
      {
        num: 23.090702573188732,
      }
    `);
  });
});
