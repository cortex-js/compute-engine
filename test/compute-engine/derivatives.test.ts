import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { engine } from '../utils';

function parse(expr: string): Expression {
  return engine.parse(expr)!;
}

// Helper to create D expressions using MathJSON directly.
// (D(f, x) in LaTeX parses as the derivative function outside a quantifier
// scope, but this helper builds the D expression from an already-parsed body.)
function D(expr: string, ...vars: string[]): Expression {
  return engine.expr(['D', engine.parse(expr), ...vars]);
}

describe('D', () => {
  it('should compute the partial derivative of a polynomial', () => {
    const expr = D('x^3 + 2x - 4', 'x');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`3x^2+2`);
  });

  it('should compute the partial derivative of a function with respect to a variable', () => {
    const expr = D('x^2 + y^2', 'x');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`2x`);
  });

  it('should compute higher order partial derivatives', () => {
    const expr = engine.expr(['D', ['D', engine.parse('x^2 + y^2'), 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`2`);
  });

  it('should compute the partial derivative of a function with respect to a variable in a multivariable function with multiple variables', () => {
    const expr = D('5x^3 + 7y^5 + 11z^{13}', 'x', 'x');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`30x`);
  });

  it('should compute the partial derivative of a function with respect to a variable in a multivariable function with multiple variables', () => {
    const expr = D('x^2 + y^2 + z^2', 'x', 'y', 'z');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`0`);
  });

  it('should compute the partial derivative of a trigonometric function', () => {
    const expr = D('\\sin(x)', 'x');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`\\cos(x)`);
  });

  // \frac{2}{x+2}+(2)(x^2+2x)^{-1}-\frac{\cos(\frac{1}{x})}{x^2}
  it('should compute a complex partial derivative', () => {
    const expr = D('\\sin(\\frac{1}{x}) + \\ln(x^2+2x)', 'x');
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(
      `\\frac{2(x+1)}{x^2+2x}-\\frac{\\cos(\\frac{1}{x})}{x^2}`
    );
  });
});

describe('Derivative', () => {
  it('should compute the derivative of a function', () => {
    const expr = engine.expr(['Derivative', 'Sin']);
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`\\cos(\\operatorname{\\_})`);
  });

  it('should compute higher order derivatives', () => {
    const expr = engine.expr([
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
    const expr = D('\\sech(x)', 'x');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-(tanh(x) * sech(x))`);
  });

  it('should compute d/dx csch(x) = -coth(x)*csch(x)', () => {
    const expr = D('\\csch(x)', 'x');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-(csch(x) * coth(x))`);
  });
});

describe('Symbolic output for exponential derivatives', () => {
  it('should compute d/dx 2^x = ln(2) * 2^x symbolically', () => {
    const expr = D('2^x', 'x');
    const result = expr.evaluate();
    // Should return ln(2) * 2^x, not 0.693... * 2^x
    expect(result.toString()).toMatchInlineSnapshot(`ln(2) * 2^x`);
  });

  it('should compute d/dx 3^x = ln(3) * 3^x symbolically', () => {
    const expr = D('3^x', 'x');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`ln(3) * 3^x`);
  });
});

describe('Power rule edge cases', () => {
  it('should compute d/dx x^x = x^x * (ln(x) + 1)', () => {
    const expr = D('x^x', 'x');
    const result = expr.evaluate();
    // x^x * (1 + ln(x)) = x^x + ln(x) * x^x
    expect(result.toString()).toMatchInlineSnapshot(`x^x + ln(x) * x^x`);
  });

  it('should compute d/dx (x^2)^3 = 6x^5', () => {
    const expr = D('(x^2)^3', 'x');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`6x^5`);
  });

  it('should compute d/dx (2x)^3 = 24x^2', () => {
    const expr = D('(2x)^3', 'x');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`24x^2`);
  });
});

// Comprehensive tests for all DERIVATIVES_TABLE entries
describe('Trigonometric derivatives', () => {
  it('d/dx sin(x) = cos(x)', () => {
    expect(D('\\sin(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `cos(x)`
    );
  });

  it('d/dx cos(x) = -sin(x)', () => {
    expect(D('\\cos(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-sin(x)`
    );
  });

  it('d/dx tan(x) = sec(x)^2', () => {
    expect(D('\\tan(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `sec(x)^2`
    );
  });

  it('d/dx sec(x) = tan(x)*sec(x)', () => {
    expect(D('\\sec(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `tan(x) * sec(x)`
    );
  });

  it('d/dx csc(x) = -cot(x)*csc(x)', () => {
    expect(D('\\csc(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-(csc(x) * cot(x))`
    );
  });

  it('d/dx cot(x) = -csc(x)^2', () => {
    expect(D('\\cot(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-(csc(x)^2)`
    );
  });
});

describe('Inverse trigonometric derivatives', () => {
  it('d/dx arcsin(x) = 1/sqrt(1-x^2)', () => {
    expect(D('\\arcsin(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / sqrt(1 - x^2)`
    );
  });

  it('d/dx arccos(x) = -1/sqrt(1-x^2)', () => {
    expect(D('\\arccos(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-1 / sqrt(1 - x^2)`
    );
  });

  it('d/dx arctan(x) = 1/(1+x^2)', () => {
    expect(D('\\arctan(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / (x^2 + 1)`
    );
  });

  it('d/dx arccot(x) = -1/(1+x^2)', () => {
    expect(D('\\arcctg(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-1 / (x^2 + 1)`
    );
  });
});

describe('Hyperbolic function derivatives', () => {
  it('d/dx sinh(x) = cosh(x)', () => {
    expect(D('\\sinh(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `cosh(x)`
    );
  });

  it('d/dx cosh(x) = sinh(x)', () => {
    expect(D('\\cosh(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `sinh(x)`
    );
  });

  it('d/dx tanh(x) = sech(x)^2', () => {
    expect(D('\\tanh(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `sech(x)^2`
    );
  });

  it('d/dx coth(x) = -csch(x)^2', () => {
    expect(D('\\coth(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-(csch(x)^2)`
    );
  });
});

describe('Inverse hyperbolic derivatives', () => {
  it('d/dx arsinh(x) = 1/sqrt(x^2+1)', () => {
    expect(D('\\arsinh(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / sqrt(x^2 + 1)`
    );
  });

  it('d/dx arcosh(x) = 1/sqrt(x^2-1)', () => {
    expect(D('\\arcosh(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / sqrt(x^2 - 1)`
    );
  });

  it('d/dx artanh(x) = 1/(1-x^2)', () => {
    expect(D('\\artanh(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / (1 - x^2)`
    );
  });

  it('d/dx arcoth(x) = 1/(1-x^2)', () => {
    expect(D('\\arcoth(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / (1 - x^2)`
    );
  });

  it('d/dx arcoth(x) at x=2 evaluates to -1/3', () => {
    // mpmath-confirmed: d/dx arcoth(x) = 1/(1-x^2), so at x=2 the value is -1/3.
    const result = D('\\arcoth(x)', 'x').evaluate();
    expect(result.subs({ x: 2 }).N().re).toBeCloseTo(-1 / 3, 8);
  });

  it('d/dx arsech(x) = -1/(x*sqrt(1-x^2))', () => {
    expect(D('\\arsech(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-1 / (x * sqrt(1 - x^2))`
    );
  });

  it('d/dx arcsch(x) = -1/(|x|*sqrt(1+x^2))', () => {
    expect(D('\\arcsch(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-1 / (|x| * sqrt(x^2 + 1))`
    );
  });
});

describe('Logarithmic and exponential derivatives', () => {
  it('d/dx ln(x) = 1/x', () => {
    expect(D('\\ln(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / x`
    );
  });

  it('d/dx log(x) = 1/(x*ln(10))', () => {
    expect(D('\\log(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / (x * ln(10))`
    );
  });

  it('d/dx sqrt(x) = 1/(2*sqrt(x))', () => {
    expect(D('\\sqrt{x}', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `1 / (2sqrt(x))`
    );
  });

  it('d/dx e^x = e^x', () => {
    expect(D('e^x', 'x').evaluate().toString()).toMatchInlineSnapshot(`e^x`);
  });
});

describe('Step function derivatives', () => {
  it('d/dx floor(x) = 0', () => {
    expect(
      D('\\lfloor x \\rfloor', 'x').evaluate().toString()
    ).toMatchInlineSnapshot(`0`);
  });

  it('d/dx ceil(x) = 0', () => {
    expect(
      D('\\lceil x \\rceil', 'x').evaluate().toString()
    ).toMatchInlineSnapshot(`0`);
  });

  it('d/dx |x| = sign(x)', () => {
    expect(D('|x|', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `Sign(x)`
    );
  });

  it('d/dx |2x+1| = 2*sign(2x+1)', () => {
    expect(D('|2x+1|', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `2Sign(2x + 1)`
    );
  });
});

describe('Special function derivatives', () => {
  it('d/dx Gamma(x) = Gamma(x)*Digamma(x)', () => {
    expect(D('\\Gamma(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `Gamma(x) * Digamma(x)`
    );
  });

  it('d/dx Digamma(x) = Trigamma(x)', () => {
    const expr = engine.expr(['D', ['Digamma', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`Trigamma(x)`);
  });

  it('d/dx Erf(x) = 2/sqrt(pi) * e^(-x^2)', () => {
    // Use MathJSON directly since \mathrm{erf} parses differently
    const expr = engine.expr(['D', ['Erf', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`(2e^(-(x^2))) / sqrt(pi)`);
  });

  it('d/dx Erfc(x) = -2/sqrt(pi) * e^(-x^2)', () => {
    const expr = engine.expr(['D', ['Erfc', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `(-2e^(-(x^2))) / sqrt(pi)`
    );
  });

  it('d/dx GammaLn(x) = Digamma(x)', () => {
    const expr = engine.expr(['D', ['GammaLn', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`Digamma(x)`);
  });

  it('d/dx FresnelS(x) = sin(pi*x^2/2)', () => {
    const expr = engine.expr(['D', ['FresnelS', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`sin(1/2 * pi * x^2)`);
  });

  it('d/dx FresnelC(x) = cos(pi*x^2/2)', () => {
    const expr = engine.expr(['D', ['FresnelC', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`cos(1/2 * pi * x^2)`);
  });

  it('d/dx LambertW(x) = LambertW(x)/(x*(1+LambertW(x)))', () => {
    const expr = engine.expr(['D', ['LambertW', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `LambertW(x) / (x + x * LambertW(x))`
    );
  });

  it('d/dx LambertW(x, -1) preserves the branch (same closed form per branch)', () => {
    const expr = engine.expr(['D', ['LambertW', 'x', -1], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `LambertW(x, -1) / (x + x * LambertW(x, -1))`
    );
  });

  it('d/dx LambertW(g(x), -1) applies the chain rule', () => {
    const expr = engine.expr(['D', ['LambertW', ['Square', 'x'], -1], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `(2x * LambertW(x^2, -1)) / (x^2 + LambertW(x^2, -1) * x^2)`
    );
  });

  it('d/dx LambertW(x, -1) agrees with a central difference at x = -0.2', () => {
    const d = engine
      .expr(['D', ['LambertW', 'x', -1], 'x'])
      .evaluate()
      .subs({ x: engine.number(-0.2) })
      .N().re;
    const at = (x: number) =>
      engine.expr(['LambertW', { num: x.toString() }, -1]).N().re;
    const h = 1e-6;
    const fd = (at(-0.2 + h) - at(-0.2 - h)) / (2 * h);
    expect(Math.abs(d - fd)).toBeLessThan(1e-8);
  });

  it('∂/∂k LambertW(x, k) stays inert (discrete branch index)', () => {
    const expr = engine.expr(['D', ['LambertW', 'x', 'k'], 'k']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `D(LambertW(x, k), k)`
    );
  });
});

describe('Symbolic derivatives for unknown functions', () => {
  it('d/dx f(x) returns symbolic derivative for unknown function', () => {
    const expr = engine.expr(['D', ['f', 'x'], 'x']);
    const result = expr.evaluate();
    // Returns Apply(Derivative(f, 1), x) which represents f'(x)
    expect(result.toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 1), x)`
    );
  });

  it('d/dx f(x^2) applies chain rule with unknown function', () => {
    const expr = engine.expr(['D', ['f', ['Square', 'x']], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `2x * Apply(Derivative(f, 1), x^2)`
    );
  });

  it('d/dx g(sin(x)) applies chain rule with unknown function', () => {
    const expr = engine.expr(['D', ['g', ['Sin', 'x']], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `cos(x) * Apply(Derivative(g, 1), sin(x))`
    );
  });

  it('d/dx f(g(x)) applies chain rule with nested unknown functions', () => {
    const expr = engine.expr(['D', ['f', ['g', 'x']], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Apply(Derivative(g, 1), x) * Apply(Derivative(f, 1), g(x))`
    );
  });

  it('d/dx of a sum differentiates each term, including multivariate partials', () => {
    const expr = engine.expr(['D', ['Add', ['f', 'x'], ['h', 'x', 'y']], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 1), x) + Apply(Derivative(h, 1, 0), x, y)`
    );
  });

  it('d/dx of a symbolic derivative increments the derivative order', () => {
    const expr = engine.expr(['D', ['D', ['f', 'x'], 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 2), x)`
    );
  });

  it('chain rule increments symbolic derivative order', () => {
    const expr = engine.expr([
      'D',
      ['Apply', ['Derivative', 'f', 1], ['g', 'x']],
      'x',
    ]);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Apply(Derivative(g, 1), x) * Apply(Derivative(f, 2), g(x))`
    );
  });
});

describe('Derivatives of declared-then-assigned functions', () => {
  // Regression (Tycho, 0.77.0): a symbol declared with a function type keeps
  // its later-assigned Function literal in a *value* definition
  // (declared-signature reconciliation, engine-declarations.ts §6.3) rather
  // than converting to an operator definition. The derivative path must
  // expand that body just like an operator definition: on 0.77.0 `f'(x)`
  // stayed inert and `D(f, x)` evaluated to 0.
  it.each(['function', '(number) -> number'])(
    "declare('f', '%s') then f(x) := … keeps symbolic derivatives",
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('f', type);
      ce.parse('f(x) := x^2 + 2x + 1').evaluate();
      expect(ce.parse('f(2)').evaluate().json).toEqual(9);
      expect(ce.parse("f'(x)").evaluate().latex).toEqual('2x+2');
      expect(ce.expr(['D', ['f', 'x'], 'x']).evaluate().latex).toEqual('2x+2');
      expect(ce.expr(['D', 'f', 'x']).evaluate().latex).toEqual('2x+2');
      expect(ce.parse("f''(x)").evaluate().latex).toEqual('2');
    }
  );
});

describe('Prime notation applies the derivative function to its argument', () => {
  // f'(expr) denotes (Df)(expr) — Lagrange semantics: the derivative
  // function evaluated at the argument, NOT d/dx of the applied expression.
  // The former parse, ["D", ["f", expr], v] with v inferred from the
  // argument (or an invented "x"), collapsed f'(2) to 0 and gave f'(2x) a
  // spurious chain-rule factor.
  it("parses f'(args) to Apply(Derivative(f, n), args)", () => {
    const ce = new ComputeEngine();
    expect(ce.parse("f'(2)").json).toEqual(['Apply', ['Derivative', 'f', 1], 2]);
    expect(ce.parse("f''(x)").json).toEqual([
      'Apply',
      ['Derivative', 'f', 2],
      'x',
    ]);
  });

  it('evaluates the derivative function at the argument', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x^2 + 2x + 1').evaluate();
    expect(ce.parse("f'(2)").evaluate().json).toEqual(6);
    expect(ce.parse("f''(2)").evaluate().json).toEqual(2);
    // No chain-rule factor: f'(2x) = (Df)(2x) = 2(2x)+2, not d/dx f(2x)
    expect(ce.parse("f'(2x)").evaluate().latex).toEqual('4x+2');
    expect(ce.parse("\\sin'(x)").evaluate().latex).toEqual('\\cos(x)');
  });

  it('stays inert and round-trips for unknown functions', () => {
    const ce = new ComputeEngine();
    const e = ce.parse("h'(2)").evaluate();
    expect(e.json).toEqual(['Apply', ['Derivative', 'h', 1], 2]);
    expect(e.latex).toEqual('h^{\\prime}(2)');
  });
});

describe('Partial derivatives of unknown multivariate functions', () => {
  it('∂/∂x f(x, y) is the partial with respect to the first argument', () => {
    const expr = engine.expr(['D', ['f', 'x', 'y'], 'x']);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 1, 0), x, y)`
    );
  });

  it('∂/∂y f(x, y) is the partial with respect to the second argument', () => {
    const expr = engine.expr(['D', ['f', 'x', 'y'], 'y']);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 0, 1), x, y)`
    );
  });

  it('mixed partial ∂²/∂x∂y f(x, y) accumulates the multi-index', () => {
    const expr = engine.expr(['D', ['D', ['f', 'x', 'y'], 'x'], 'y']);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 1, 1), x, y)`
    );
  });

  it('mixed partials commute (Clairaut): ∂²/∂y∂x == ∂²/∂x∂y', () => {
    const dxy = engine.expr(['D', ['D', ['f', 'x', 'y'], 'x'], 'y']).evaluate();
    const dyx = engine.expr(['D', ['D', ['f', 'x', 'y'], 'y'], 'x']).evaluate();
    expect(dxy.isSame(dyx)).toBe(true);
  });

  it('repeated partial ∂²/∂x² f(x, y) raises the first-slot order', () => {
    const expr = engine.expr(['D', ['D', ['f', 'x', 'y'], 'x'], 'x']);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 2, 0), x, y)`
    );
  });

  it('applies the chain rule on a compound argument', () => {
    const expr = engine.expr(['D', ['f', ['Square', 'x'], 'y'], 'x']);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `2x * Apply(Derivative(f, 1, 0), x^2, y)`
    );
  });

  it('sums the chain rule over every argument that depends on the variable', () => {
    const expr = engine.expr(['D', ['f', 'x', ['Square', 'x']], 'x']);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `2x * Apply(Derivative(f, 0, 1), x, x^2) + Apply(Derivative(f, 1, 0), x, x^2)`
    );
  });

  it('composes with the product rule', () => {
    const expr = engine.expr(['D', ['Multiply', 'x', ['f', 'x', 'y']], 'x']);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `x * Apply(Derivative(f, 1, 0), x, y) + f(x, y)`
    );
  });

  it('a third-order mixed partial carries a length-3 multi-index', () => {
    const expr = engine.expr([
      'D',
      ['D', ['D', ['f', 'x', 'y', 'z'], 'x'], 'y'],
      'z',
    ]);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 1, 1, 1), x, y, z)`
    );
  });

  it('computes the mixed partial of a known bivariate function literal', () => {
    // ∂²/∂x∂y (x²·y) = 2x
    const expr = engine.expr([
      'Derivative',
      ['Function', ['Multiply', ['Square', 'x'], 'y'], 'x', 'y'],
      1,
      1,
    ]);
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(`(x, y) |-> 2x`);
  });
});

describe('Bessel function derivatives', () => {
  describe('BesselJ (first kind)', () => {
    it('d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2', () => {
      const expr = engine.expr(['D', ['BesselJ', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselJ(n + 1, x) + 1/2 * BesselJ(n - 1, x)`
      );
    });

    it('d/dx J_2(x) with numeric order', () => {
      const expr = engine.expr(['D', ['BesselJ', 2, 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselJ(3, x) + 1/2 * BesselJ(1, x)`
      );
    });

    it('d/dx J_0(x) = -J_1(x) (special case)', () => {
      // J_{-1}(x) = -J_1(x), so (J_{-1}(x) - J_1(x))/2 = -J_1(x)
      const expr = engine.expr(['D', ['BesselJ', 0, 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselJ(1, x) + 1/2 * BesselJ(-1, x)`
      );
    });
  });

  describe('BesselY (second kind)', () => {
    it('d/dx Y_n(x) = (Y_{n-1}(x) - Y_{n+1}(x))/2', () => {
      const expr = engine.expr(['D', ['BesselY', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselY(n + 1, x) + 1/2 * BesselY(n - 1, x)`
      );
    });
  });

  describe('BesselI (modified first kind)', () => {
    it('d/dx I_n(x) = (I_{n-1}(x) + I_{n+1}(x))/2', () => {
      const expr = engine.expr(['D', ['BesselI', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `1/2 * BesselI(n - 1, x) + 1/2 * BesselI(n + 1, x)`
      );
    });
  });

  describe('BesselK (modified second kind)', () => {
    it('d/dx K_n(x) = -(K_{n-1}(x) + K_{n+1}(x))/2', () => {
      const expr = engine.expr(['D', ['BesselK', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselK(n - 1, x) - 1/2 * BesselK(n + 1, x)`
      );
    });
  });

  describe('Chain rule with Bessel functions', () => {
    it('d/dx J_2(x^2) applies chain rule', () => {
      const expr = engine.expr(['D', ['BesselJ', 2, ['Square', 'x']], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `x * BesselJ(1, x^2) - x * BesselJ(3, x^2)`
      );
    });
  });

  describe('Constant Bessel functions', () => {
    it('d/dx J_2(5) = 0 (no variable)', () => {
      const expr = engine.expr(['D', ['BesselJ', 2, 5], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });
  });

  describe('Bessel derivatives with respect to the order', () => {
    it('d/dx J_x(2): order depends on the variable', () => {
      // No closed form for the order derivative — keep it symbolic.
      const expr = engine.expr(['D', ['BesselJ', 'x', 2], 'x']);
      expect(expr.evaluate().toString()).toMatchInlineSnapshot(
        `Apply(Derivative("BesselJ", 1, 0), x, 2)`
      );
    });

    it('d/dx J_x(x): both order and argument depend on the variable', () => {
      // Full chain rule: the known argument recurrence plus the symbolic
      // order derivative.
      const expr = engine.expr(['D', ['BesselJ', 'x', 'x'], 'x']);
      expect(expr.evaluate().toString()).toMatchInlineSnapshot(
        `-1/2 * BesselJ(x + 1, x) + 1/2 * BesselJ(x - 1, x) + Apply(Derivative("BesselJ", 1, 0), x, x)`
      );
    });

    it('d/dx K_{x^2}(x): chain rule on both slots', () => {
      const expr = engine.expr(['D', ['BesselK', ['Square', 'x'], 'x'], 'x']);
      expect(expr.evaluate().toString()).toMatchInlineSnapshot(
        `2x * Apply(Derivative("BesselK", 1, 0), x^2, x) - 1/2 * BesselK(x^2 - 1, x) - 1/2 * BesselK(x^2 + 1, x)`
      );
    });
  });
});

describe('Multi-argument function derivatives', () => {
  describe('Log with custom base', () => {
    it('d/dx log_2(x) = 1/(x*ln(2))', () => {
      const expr = engine.expr(['D', ['Log', 'x', 2], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`1 / (x * ln(2))`);
    });

    it('d/dx log_e(x) = 1/x (natural log)', () => {
      const expr = engine.expr(['D', ['Log', 'x', 'ExponentialE'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`1 / x`);
    });

    it('d/dx log_a(x) = 1/(x*ln(a)) with symbolic base', () => {
      const expr = engine.expr(['D', ['Log', 'x', 'a'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`1 / (x * ln(a))`);
    });

    it('d/dx log_2(x^2) = 2/(x*ln(2)) via chain rule', () => {
      const expr = engine.expr(['D', ['Log', ['Square', 'x'], 2], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`2 / (x * ln(2))`);
    });

    it('d/dx log_2(constant) = 0', () => {
      const expr = engine.expr(['D', ['Log', 5, 2], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });

    it('d/dx log_x(a) when base depends on x', () => {
      // log_x(a) = ln(a)/ln(x), so d/dx = -ln(a)/(x*ln(x)^2)
      const expr = engine.expr(['D', ['Log', 'a', 'x'], 'x']);
      const result = expr.evaluate();
      // Should use quotient rule on ln(a)/ln(x)
      expect(result.toString()).toMatchInlineSnapshot(`-ln(a) / (x * ln(x)^2)`);
    });

    it('d/dx log_x(x) when both depend on x', () => {
      // log_x(x) = ln(x)/ln(x) = 1, so d/dx = 0
      const expr = engine.expr(['D', ['Log', 'x', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });
  });

  describe('Discrete functions (step functions)', () => {
    // CORRECTNESS_FINDINGS.md CR-P1-1: CE's Mod is the real sawtooth
    // ((u mod c) + c) mod c, piecewise-linear with slope u' almost
    // everywhere in u, as long as the modulus does not itself depend on the
    // differentiation variable. d/dx Mod(x, 5) = 1 a.e. (Mathematica:
    // D[Mod[x,5],x] = 1), not 0.
    it('d/dx mod(x, 5) = 1', () => {
      const expr = engine.expr(['D', ['Mod', 'x', 5], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`1`);
    });

    it('d/dx mod(x, 5) = 1 (numeric slope check at x=2.3)', () => {
      const f = (x: number) => ((x % 5) + 5) % 5;
      const h = 1e-6;
      const numericSlope = (f(2.3 + h) - f(2.3 - h)) / (2 * h);
      const symbolic = engine.expr(['D', ['Mod', 'x', 5], 'x']).evaluate();
      expect(symbolic.subs({ x: 2.3 }).N().re).toBeCloseTo(numericSlope, 5);
    });

    it('d/dx mod(x^2, 7) = 2x (constant modulus, non-trivial inner function)', () => {
      const expr = engine.expr(['D', ['Mod', ['Square', 'x'], 7], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`2x`);
    });

    it('d/dx mod(x^2, y) = 2x (modulus y does not depend on x)', () => {
      const expr = engine.expr(['D', ['Mod', ['Square', 'x'], 'y'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`2x`);
    });

    it('d/dx mod(x, x^2) stays symbolic (modulus depends on x)', () => {
      const expr = engine.expr(['D', ['Mod', 'x', ['Square', 'x']], 'x']);
      const result = expr.evaluate();
      expect(result.operator).toBe('D');
    });

    it('d/dx gcd(x, 6) = 0', () => {
      const expr = engine.expr(['D', ['GCD', 'x', 6], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });

    it('d/dx lcm(x, y) = 0', () => {
      const expr = engine.expr(['D', ['LCM', 'x', 'y'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });
  });

  describe('Root with a variable degree', () => {
    // The degree of a radical may itself depend on the differentiation
    // variable, e.g. Root(x, x) = x^(1/x). The rule must not treat the degree
    // as constant. Verify against a central-difference numerical derivative.
    const numericDerivative = (f: (x: number) => number, x: number) =>
      (f(x + 1e-6) - f(x - 1e-6)) / 2e-6;

    const checkAt = (mathJson: any, f: (x: number) => number, x0: number) => {
      const symbolic = engine.box(mathJson).evaluate();
      const atPoint = symbolic.subs({ x: x0 }).N().re;
      expect(atPoint).toBeCloseTo(numericDerivative(f, x0), 6);
    };

    it('d/dx Root(x, x) = d/dx x^(1/x) accounts for the degree', () => {
      const expr = engine.expr(['D', ['Root', 'x', 'x'], 'x']).evaluate();
      expect(expr.toString()).toMatchInlineSnapshot(
        `x^(1 / x) / x^2 - (ln(x) * x^(1 / x)) / x^2`
      );
      checkAt(['D', ['Root', 'x', 'x'], 'x'], (x) => Math.pow(x, 1 / x), 2);
    });

    it('d/dx Root(2, x) = d/dx 2^(1/x) is non-zero', () => {
      checkAt(['D', ['Root', 2, 'x'], 'x'], (x) => Math.pow(2, 1 / x), 2);
    });

    it('d/dx Root(x^2, x) chains through base and degree', () => {
      checkAt(
        ['D', ['Root', ['Square', 'x'], 'x'], 'x'],
        (x) => Math.pow(x * x, 1 / x),
        2
      );
    });

    it('d/dx Root(x, 3) (constant degree) is unchanged', () => {
      const expr = engine.expr(['D', ['Root', 'x', 3], 'x']).evaluate();
      expect(expr.toString()).toMatchInlineSnapshot(`1 / (3x^(2/3))`);
      checkAt(['D', ['Root', 'x', 3], 'x'], (x) => Math.pow(x, 1 / 3), 2);
    });
  });
});

describe('User-defined function derivatives', () => {
  // Use a local engine so f(x) := 2x doesn't affect other tests
  let ce: InstanceType<typeof import('../../src/compute-engine').ComputeEngine>;

  beforeAll(async () => {
    const { ComputeEngine } = await import('../../src/compute-engine');
    ce = new ComputeEngine();
    ce.parse('f(x) := 2x').evaluate();
  });

  it('f(x) should evaluate to 2x without stack overflow', () => {
    const result = ce.parse('f(x)').evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`2x`);
  });

  it('d/dx f(x) where f(x) := 2x should be 2', () => {
    const expr = ce.expr(['D', ['f', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`2`);
  });

  it('d/dx f as a function symbol where f(x) := 2x should be 2', () => {
    // D(Function(Block(f), x)) — Leibniz notation parses f as a function symbol
    const expr = ce.parse('\\frac{d}{dx} f');
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`2`);
  });

  it('d/dx f(x^2) where f(x) := 2x should be 4x', () => {
    const expr = ce.expr(['D', ['f', ['Square', 'x']], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`4x`);
  });

  it('f(3) should evaluate to 6', () => {
    const result = ce.parse('f(3)').evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`6`);
  });
});

describe('ND', () => {
  it('should compute the numerical approximation of the derivative of a polynomial', () => {
    const expr = parse('\\mathrm{ND}(x \\mapsto x^3 + 2x - 4, 2)');
    const result = expr.N();
    expect(result.json).toMatchInlineSnapshot(`14.000000000000007`);
  });

  it('should compute the numerical approximation of the derivative of an expression', () => {
    const expr = parse('\\mathrm{ND}(x \\mapsto \\cos x + 2x^3 - 4, 2)');
    const result = expr.N();
    expect(result.json).toMatchInlineSnapshot(`23.090702573188732`);
  });
});

// REVIEW.md E2: the Arcsec/Arccsc entries in the derivative table were wrong
// (and identical to each other): both gave -x^2/sqrt(1-x^2), which is complex
// on the actual domain |x| >= 1. The correct derivatives are
// d/dx arcsec(x) =  1 / (|x| sqrt(x^2 - 1)) and
// d/dx arccsc(x) = -1 / (|x| sqrt(x^2 - 1)).
describe('Inverse secant/cosecant derivatives (E2)', () => {
  it('d/dx arcsec(x) = 1 / (|x| sqrt(x^2 - 1))', () => {
    const result = engine.expr(['D', ['Arcsec', 'x'], 'x']).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `1 / (|x| * sqrt(x^2 - 1))`
    );
    // At x = 2 the derivative is real and ≈ 0.288675 (was NaN/complex before).
    expect(result.subs({ x: 2 }).N().re).toBeCloseTo(0.28867513459, 8);
  });

  it('d/dx arccsc(x) = -1 / (|x| sqrt(x^2 - 1))', () => {
    const result = engine.expr(['D', ['Arccsc', 'x'], 'x']).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `-1 / (|x| * sqrt(x^2 - 1))`
    );
    expect(result.subs({ x: 2 }).N().re).toBeCloseTo(-0.28867513459, 8);
  });
});

// REVIEW.md G8: applying the derivative of a function with no derivative table
// (e.g. Zeta) used to recurse forever ("Maximum call stack size exceeded").
// `Derivative(f, n)` represents the unresolved derivative as a self-applied
// lambda `Apply(Derivative(f, n), _)`; beta-reducing and re-evaluating it
// regenerated the lambda. It must now stay symbolic. (AiryAi was the original
// example; it now has a derivative table entry — AiryAiPrime — so this test
// uses Zeta, which still has no elementary derivative.)
describe('Derivative of a function with no derivative table (G8)', () => {
  it('Apply(Derivative(Function(Zeta(z), z), 1), 0) stays symbolic', () => {
    const expr = engine.expr([
      'Apply',
      ['Derivative', ['Function', ['Zeta', 'z'], 'z'], 1],
      0,
    ]);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Apply(Derivative("Zeta", 1), 0)`
    );
  });

  it('re-evaluating the symbolic result is stable (no recursion)', () => {
    const r = engine.expr(['Apply', ['Derivative', 'Zeta', 1], 0]).evaluate();
    expect(r.evaluate().isSame(r)).toBe(true);
  });

  it('chain rule factor is preserved: d/dz Zeta(2z) at 0', () => {
    const result = engine
      .expr([
        'Apply',
        ['Derivative', ['Function', ['Zeta', ['Multiply', 2, 'z']], 'z'], 1],
        0,
      ])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `2Apply(Derivative("Zeta", 1), 0)`
    );
  });

  it('functions with a derivative table are unaffected (Sin)', () => {
    const result = engine
      .expr(['Apply', ['Derivative', 'Sin', 1], 0])
      .evaluate();
    expect(result.N().re).toBe(1);
  });
});

// Elementwise differentiation over vector/matrix literals: a `List` is a
// container, not a function of its elements, so `D` maps the derivative over
// each element (recursively for nested lists), preserving shape — rather than
// treating the list as a multivariate function and doing a chain-rule
// expansion into a scalar `Add`.
describe('D over List literals (elementwise)', () => {
  it('differentiates a vector elementwise', () => {
    const result = engine
      .expr(['D', ['List', ['Square', 't'], ['Sin', 't']], 't'])
      .evaluate();
    expect(result.json).toEqual(['List', ['Multiply', 2, 't'], ['Cos', 't']]);
  });

  it('first derivative of the rotation matrix', () => {
    const result = engine
      .expr([
        'D',
        [
          'List',
          ['List', ['Cos', 't'], ['Sin', 't']],
          ['List', ['Negate', ['Sin', 't']], ['Cos', 't']],
        ],
        't',
      ])
      .evaluate();
    expect(result.json).toEqual([
      'List',
      ['List', ['Negate', ['Sin', 't']], ['Cos', 't']],
      ['List', ['Negate', ['Cos', 't']], ['Negate', ['Sin', 't']]],
    ]);
  });

  it('second derivative of the rotation matrix threads repeated variables', () => {
    const result = engine
      .expr([
        'D',
        [
          'List',
          ['List', ['Cos', 't'], ['Sin', 't']],
          ['List', ['Negate', ['Sin', 't']], ['Cos', 't']],
        ],
        't',
        't',
      ])
      .evaluate();
    expect(result.json).toEqual([
      'List',
      ['List', ['Negate', ['Cos', 't']], ['Negate', ['Sin', 't']]],
      ['List', ['Sin', 't'], ['Negate', ['Cos', 't']]],
    ]);
  });

  it('handles nested lists of arbitrary depth', () => {
    const result = engine
      .expr(['D', ['List', ['List', ['List', ['Square', 't']]]], 't'])
      .evaluate();
    expect(result.json).toEqual([
      'List',
      ['List', ['List', ['Multiply', 2, 't']]],
    ]);
  });

  it('leaves scalar differentiation unchanged', () => {
    const result = engine.expr(['D', ['Square', 't'], 't']).evaluate();
    expect(result.json).toEqual(['Multiply', 2, 't']);
  });
});
