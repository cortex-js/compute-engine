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

  // \frac{2}{x+2}+(2)(x^2+2x)^{-1}-\frac{\cos(\frac{1}{x})}{x^2}
  it('should compute a complex partial derivative', () => {
    const expr = parse('D(\\sin(\\frac{1}{x}) + \\ln(x^2+2x), x)');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(
      `\\frac{2}{x+2}+(2)(x^2+2x)^{-1}-\\frac{\\cos(\\frac{1}{x})}{x^2}`
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

// Comprehensive tests for all DERIVATIVES_TABLE entries
describe('Trigonometric derivatives', () => {
  it('d/dx sin(x) = cos(x)', () => {
    expect(parse('D(\\sin(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `cos(x)`
    );
  });

  it('d/dx cos(x) = -sin(x)', () => {
    expect(parse('D(\\cos(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `-sin(x)`
    );
  });

  it('d/dx tan(x) = sec(x)^2', () => {
    expect(parse('D(\\tan(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `sec(x)^2`
    );
  });

  it('d/dx sec(x) = tan(x)*sec(x)', () => {
    expect(parse('D(\\sec(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `tan(x) * sec(x)`
    );
  });

  it('d/dx csc(x) = -cot(x)*csc(x)', () => {
    expect(parse('D(\\csc(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `-(csc(x) * cot(x))`
    );
  });

  it('d/dx cot(x) = -csc(x)^2', () => {
    expect(parse('D(\\cot(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `-csc(x)^2`
    );
  });
});

describe('Inverse trigonometric derivatives', () => {
  it('d/dx arcsin(x) = 1/sqrt(1-x^2)', () => {
    expect(
      parse('D(\\arcsin(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`1 / sqrt(1 - x^2)`);
  });

  it('d/dx arccos(x) = -1/sqrt(1-x^2)', () => {
    expect(
      parse('D(\\arccos(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`-1 / sqrt(1 - x^2)`);
  });

  it('d/dx arctan(x) = 1/(1+x^2)', () => {
    expect(
      parse('D(\\arctan(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`1 / (x^2 + 1)`);
  });

  it('d/dx arccot(x) = -1/(1+x^2)', () => {
    expect(
      parse('D(\\arcctg(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`-1 / (x^2 + 1)`);
  });
});

describe('Hyperbolic function derivatives', () => {
  it('d/dx sinh(x) = cosh(x)', () => {
    expect(
      parse('D(\\sinh(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`cosh(x)`);
  });

  it('d/dx cosh(x) = sinh(x)', () => {
    expect(
      parse('D(\\cosh(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`sinh(x)`);
  });

  it('d/dx tanh(x) = sech(x)^2', () => {
    expect(
      parse('D(\\tanh(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`sech(x)^2`);
  });

  it('d/dx coth(x) = -csch(x)^2', () => {
    expect(
      parse('D(\\coth(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`-csch(x)^2`);
  });
});

describe('Inverse hyperbolic derivatives', () => {
  it('d/dx arsinh(x) = 1/sqrt(x^2+1)', () => {
    expect(
      parse('D(\\arsinh(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`1 / sqrt(x^2 + 1)`);
  });

  it('d/dx arcosh(x) = 1/sqrt(x^2-1)', () => {
    expect(
      parse('D(\\arcosh(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`1 / sqrt(x^2 - 1)`);
  });

  it('d/dx artanh(x) = 1/(1-x^2)', () => {
    expect(
      parse('D(\\artanh(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`1 / (1 - x^2)`);
  });

  it('d/dx arcoth(x) = -1/(1-x^2)', () => {
    expect(
      parse('D(\\arcoth(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`-1 / (1 - x^2)`);
  });

  it('d/dx arsech(x) = -1/(x*sqrt(1-x^2))', () => {
    expect(
      parse('D(\\arsech(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`-1 / (x * sqrt(1 - x^2))`);
  });

  it('d/dx arcsch(x) = -1/(|x|*sqrt(1+x^2))', () => {
    expect(
      parse('D(\\arcsch(x), x)').evaluate().toString()
    ).toMatchInlineSnapshot(`-1 / (|x| * sqrt(x^2 + 1))`);
  });
});

describe('Logarithmic and exponential derivatives', () => {
  it('d/dx ln(x) = 1/x', () => {
    expect(parse('D(\\ln(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `1 / x`
    );
  });

  it('d/dx log(x) = 1/(x*ln(10))', () => {
    expect(parse('D(\\log(x), x)').evaluate().toString()).toMatchInlineSnapshot(
      `1 / (x * ln(10))`
    );
  });

  it('d/dx sqrt(x) = 1/(2*sqrt(x))', () => {
    expect(
      parse('D(\\sqrt{x}, x)').evaluate().toString()
    ).toMatchInlineSnapshot(`1 / (2sqrt(x))`);
  });

  it('d/dx e^x = e^x', () => {
    expect(parse('D(e^x, x)').evaluate().toString()).toMatchInlineSnapshot(
      `e^x`
    );
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
