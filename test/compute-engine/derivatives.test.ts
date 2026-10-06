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
  it('declines a function literal whose parameter is a tuple PATTERN', () => {
    // `((p, q)) => p + q` names no single variable to differentiate with
    // respect to, so the derivative stays symbolic instead of being taken
    // against a placeholder the body never mentions.
    const ce = new ComputeEngine();
    const d = ce.box([
      'Derivative',
      ['Function', ['Add', 'p', 'q'], ['Tuple', 'p', 'q']],
      1,
    ]);
    expect(d.evaluate().toString()).toBe('Derivative(((p, q)) => p + q, 1)');
    // The plain-parameter twin still differentiates.
    expect(
      ce
        .box(['Derivative', ['Function', ['Power', 'x', 2], 'x'], 1])
        .evaluate()
        .toString()
    ).toBe('(x) => 2x');
  });

  it('should compute the derivative of a function', () => {
    const expr = engine.expr(['Derivative', 'Sin']);
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`x\\mapsto\\cos(x)`);
  });

  it('declares nothing in the caller scope', () => {
    // The hole `_` and the parameter `x` of the result are declared in a
    // scope that is discarded. If they were declared in the caller's scope,
    // `x` kept the type `number` that `Sin` inferred for it, and a later
    // boolean use of `x` was an error.
    const ce = new ComputeEngine();
    const result = ce.box(['Derivative', 'Sin']).evaluate();
    expect(result.toString()).toBe('(x) => cos(x)');
    expect(ce.box(['Apply', result, 0.5]).N().re).toBeCloseTo(Math.cos(0.5));
    expect(ce.lookupDefinition('x')).toBeUndefined();
    expect(ce.lookupDefinition('_')).toBeUndefined();
    expect(ce.box(['And', 'x', 'True']).evaluate().toString()).toBe('x');
  });

  it('the derivative of Exp has no ln(e) factor', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Derivative', 'Exp']).evaluate().toString()).toBe(
      '(x) => e^x'
    );
  });

  it('should compute higher order derivatives', () => {
    const expr = engine.expr([
      'Derivative',
      ['Function', ['Square', 'x'], 'x'],
      2,
    ]);
    const result = expr.evaluate();
    expect(result.latex).toMatchInlineSnapshot(`x\\mapsto2`);
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

  // The factor ln(e) = 1 is dropped only for the library constant. A user
  // declaration can give the name `ExponentialE` another value, and then the
  // factor ln(ExponentialE) stays.
  it('keeps ln(base) when ExponentialE is declared with another value', () => {
    const ce = new ComputeEngine();
    ce.declare('ExponentialE', { value: 3 });
    const expr = ce.expr(['D', ['Power', 'ExponentialE', 'x'], 'x']);
    expect(expr.evaluate().toString()).toBe('ln(3) * 3^x');
  });

  it('drops ln(e) for the library constant ExponentialE', () => {
    const expr = engine.expr(['D', ['Power', 'ExponentialE', 'x'], 'x']);
    expect(expr.evaluate().toString()).toBe('e^x');
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
      `LambertW(x) / (x * (LambertW(x) + 1))`
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
    expect(result.toString()).toMatchInlineSnapshot(`D(LambertW(x, k), k)`);
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

describe('Derivatives of container-valued bodies', () => {
  // Regression (Tycho item 174, 0.104.1): a `Tuple` is a container, not a
  // function of its elements, so it must differentiate componentwise —
  // d/dt (fₓ, f_y, f_z) = (fₓ', f_y', f_z'). Before the fix a `Tuple` fell
  // through to the generic chain rule and differentiated the `Tuple`
  // OPERATOR, leaving inert `Apply(Derivative("Tuple", 0, 1, 0), …)` nodes.
  // A Frenet frame built on `f'(t)/|f'(t)|` therefore never closed.
  it('differentiates a Tuple literal componentwise', () => {
    expect(
      engine
        .expr(['D', ['Tuple', ['Square', 't'], ['Power', 't', 3]], 't'])
        .evaluate()
        .toString()
    ).toEqual('(2t, 3t^2)');
  });

  it('preserves the container head and nests', () => {
    const result = engine
      .expr([
        'D',
        ['Tuple', ['Tuple', ['Square', 't'], 't'], ['Sin', 't']],
        't',
      ])
      .evaluate();
    expect(result.operator).toEqual('Tuple');
    expect(result.toString()).toEqual('((2t, 1), cos(t))');
  });

  it('closes the derivative of a tuple-valued space curve', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number) -> tuple<number, number, number>');
    ce.assign(
      'g',
      ce.expr([
        'Function',
        [
          'Tuple',
          ['Cos', ['Multiply', 2, 'Pi', 't']],
          ['Sin', ['Multiply', 2, 'Pi', 't']],
          't',
        ],
        't',
      ])
    );
    // Neither spelling may leave an inert `Derivative` node behind.
    for (const d of [
      ce.expr(['Apply', ['Derivative', 'g', 1], 0.25]),
      ce.expr(['D', ['g', 't'], 't']),
    ])
      expect(d.evaluate().toString()).not.toContain('Derivative');

    // The argument `0.25` is a float, so `sin(2π·0.25)` is computed from the
    // float angle `1.5707…` and is the float `1`: the first component is the
    // float `-2π`.
    expect(
      ce
        .expr(['Apply', ['Derivative', 'g', 1], 0.25])
        .evaluate()
        .toString()
    ).toEqual('(-6.28318530717958647693, 0, 1)');
    expect(
      ce
        .expr(['D', ['g', 't'], 't'])
        .evaluate()
        .toString()
    ).toEqual('(-2pi * sin(2pi * t), 2pi * cos(2pi * t), 1)');
  });

  it('leaves an unregistered container head opaque (item-152 contract)', () => {
    // `Point` is not a registered operator — it types `unknown` — so it stays
    // an application rather than acquiring invented componentwise semantics.
    const result = engine
      .expr(['D', ['Point', ['Square', 't'], ['Power', 't', 3]], 't'])
      .evaluate();
    expect(result.operator).not.toEqual('Point');
  });
});

describe('Prime notation applies the derivative function to its argument', () => {
  // f'(expr) denotes (Df)(expr) — Lagrange semantics: the derivative
  // function evaluated at the argument, NOT d/dx of the applied expression.
  // The former parse, ["D", ["f", expr], v] with v inferred from the
  // argument (or an invented "x"), collapsed f'(2) to 0 and gave f'(2x) a
  // spurious chain-rule factor.
  it("parses f'(args) to Apply(Derivative(f, n), args)", () => {
    const ce = new ComputeEngine();
    expect(ce.parse("f'(2)").json).toEqual([
      'Apply',
      ['Derivative', 'f', 1],
      2,
    ]);
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
    expect(expr.evaluate().toString()).toMatchInlineSnapshot(`(x, y) => 2x`);
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
        `x * (-BesselJ(3, x^2) + BesselJ(1, x^2))`
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

  describe('Upper incomplete gamma Gamma(s, z)', () => {
    const gammaN = (s: number, z: number) => engine.box(['Gamma', s, z]).N().re;
    const slope = (f: (t: number) => number, t: number) =>
      (f(t + 1e-6) - f(t - 1e-6)) / 2e-6;

    it('d/dz Gamma(s, z) = -z^(s-1) e^(-z)', () => {
      const result = engine.expr(['D', ['Gamma', 's', 'z'], 'z']).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`-(e^(-z) * z^(s - 1))`);
      for (const s of [2.5, 0.7, -1.5])
        for (const z of [0.4, 1.1, 2.7])
          expect(result.subs({ s, z }).N().re).toBeCloseTo(
            slope((t) => gammaN(s, t), z),
            6
          );
    });

    it('d/ds Gamma(s, z) has no closed form and stays symbolic', () => {
      expect(
        engine
          .expr(['D', ['Gamma', 's', 'z'], 's'])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(`Apply(Derivative(Gamma, 1, 0), s, z)`);
    });
  });

  describe('Polylogarithm PolyLog(s, z)', () => {
    // Li_s(z) at a complex point, as a [re, im] pair.
    const liN = (s: number, re: number, im: number) => {
      const v = engine
        .box(['PolyLog', s, engine.number(engine.complex(re, im))])
        .N();
      return [v.re, v.im];
    };

    it('d/dz PolyLog(s, z) = PolyLog(s - 1, z) / z', () => {
      expect(
        engine.expr(['D', ['PolyLog', 's', 'z'], 'z']).evaluate().toString()
      ).toMatchInlineSnapshot(`PolyLog(s - 1, z) / z`);
    });

    it('the closed forms of PolyLog(0, z) and PolyLog(1, z) apply', () => {
      const d = (s: number) =>
        engine.expr(['D', ['PolyLog', s, 'z'], 'z']).evaluate().toString();
      expect(d(1)).toMatchInlineSnapshot(`1 / (1 - z)`);
      expect(d(2)).toMatchInlineSnapshot(`-ln(1 - z) / z`);
      expect(d(3)).toMatchInlineSnapshot(`PolyLog(2, z) / z`);
    });

    it('agrees with a central difference at real and complex z', () => {
      const h = 1e-6;
      for (const s of [1, 2, 3, 2.5]) {
        const dLi = engine.expr(['D', ['PolyLog', s, 'z'], 'z']).evaluate();
        for (const [re, im] of [
          [0.3, 0],
          [-0.7, 0],
          [0.9, 0],
          [0.2, 0.5],
          [-0.4, -0.6],
          [2, 0.5],
        ]) {
          const [pRe, pIm] = liN(s, re + h, im);
          const [mRe, mIm] = liN(s, re - h, im);
          const v = dLi.subs({ z: engine.number(engine.complex(re, im)) }).N();
          expect(v.re).toBeCloseTo((pRe - mRe) / (2 * h), 5);
          expect(v.im).toBeCloseTo((pIm - mIm) / (2 * h), 5);
        }
      }
    });

    it('the chain rule applies to the second argument', () => {
      expect(
        engine
          .expr(['D', ['PolyLog', 2, ['Square', 'x']], 'x'])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(`(-2ln(1 - x^2)) / x`);
    });

    it('d/ds PolyLog(s, z) has no closed form and stays symbolic', () => {
      expect(
        engine.expr(['D', ['PolyLog', 's', 'z'], 's']).evaluate().toString()
      ).toMatchInlineSnapshot(`Apply(Derivative("PolyLog", 1, 0), s, z)`);
    });
  });

  describe('Derivative(F, k1, ..., kn) of a library operator', () => {
    // The multi-index form differentiates F(t1, ..., tn) k_i times in t_i,
    // with the same rules as D, and applies the result to the arguments.
    const applied = (head: string, orders: number[], ...args: any[]) =>
      engine
        .box(['Apply', ['Derivative', head, ...orders], ...args])
        .evaluate()
        .toString();

    it('Log', () => {
      expect(applied('Log', [1, 0], 'x', 'b')).toMatchInlineSnapshot(
        `1 / (x * ln(b))`
      );
      expect(applied('Log', [0, 1], 'x', 'b')).toMatchInlineSnapshot(
        `-ln(x) / (b * ln(b)^2)`
      );
    });

    it('Power', () => {
      expect(applied('Power', [1, 0], 'x', 'n')).toMatchInlineSnapshot(
        `n * x^(n - 1)`
      );
      expect(applied('Power', [0, 1], 'x', 'n')).toMatchInlineSnapshot(
        `ln(x) * x^n`
      );
    });

    it('Mod', () => {
      expect(applied('Mod', [1, 0], 'x', 'm')).toMatchInlineSnapshot(`1`);
      expect(applied('Mod', [0, 1], 'x', 'm')).toMatchInlineSnapshot(
        `-floor(x / m)`
      );
    });

    it('a partial without a closed form stays inert', () => {
      expect(applied('BesselJ', [1, 0], 'n', 'x')).toMatchInlineSnapshot(
        `Apply(Derivative("BesselJ", 1, 0), n, x)`
      );
      // `Sin` takes one argument
      expect(applied('Sin', [1, 0], 'x', 'y')).toMatchInlineSnapshot(
        `Apply(Derivative(sin, 1, 0), x, y)`
      );
    });

    it('a user function of two arguments', () => {
      const ce = new ComputeEngine();
      ce.parse('h(u, w) \\coloneq u^2 \\sin(w)').evaluate();
      ce.declare('g', '(real, real) -> real');
      const at = (head: string, orders: number[]) =>
        ce
          .box(['Apply', ['Derivative', head, ...orders], 'a', 'b'])
          .evaluate()
          .toString();
      expect(at('h', [1, 0])).toBe('2a * sin(b)');
      expect(at('h', [1, 1])).toBe('2a * cos(b)');
      expect(at('g', [1, 0])).toBe('Apply(Derivative(g, 1, 0), a, b)');
    });

    it('declares nothing in the caller scope', () => {
      const ce = new ComputeEngine();
      ce.box(['Apply', ['Derivative', 'Arctan2', 1, 0], 'y', 'x']).evaluate();
      ce.box(['Apply', ['Derivative', 'Power', 0, 1], 'x', 'n']).evaluate();
      expect(ce.lookupDefinition('_1')).toBeUndefined();
      expect(ce.lookupDefinition('_2')).toBeUndefined();
      // The parameters of the function literal are not declared there either
      expect(ce.lookupDefinition('x_1')).toBeUndefined();
      expect(ce.lookupDefinition('x_2')).toBeUndefined();
    });

    it('a caller binding of a parameter name does not change the result', () => {
      const ce = new ComputeEngine();
      ce.declare('x_1', 'string');
      const result = ce.box(['Derivative', 'Arctan2', 1, 0]).evaluate();
      expect(result.isValid).toBe(true);
      expect(ce.box(['Apply', result, 1, 2]).N().re).toBeCloseTo(2 / 5);
      expect(ce.box('x_1').type.toString()).toBe('string');
      expect(ce.lookupDefinition('x_2')).toBeUndefined();
    });

    it('gives the same result as nested D', () => {
      // The index form is evaluated as the nested `D` over fresh symbols, so
      // the two forms give the same expression.
      const ce = new ComputeEngine();
      ce.parse('u(a, b) \\coloneq \\sin(a b) e^{a + b^2}').evaluate();
      for (const head of ['Arctan2', 'Power', 'u']) {
        const index = ce
          .box(['Apply', ['Derivative', head, 2, 1], 'y', 'x'])
          .evaluate();
        const nested = ce
          .box(['D', ['D', ['D', [head, 'y', 'x'], 'y'], 'y'], 'x'])
          .evaluate();
        expect(index.isSame(nested)).toBe(true);
      }
      expect(ce.lookupDefinition('_1')).toBeUndefined();
      expect(ce.lookupDefinition('_2')).toBeUndefined();
    });

    it('a derivative with respect to the callee of Apply stays inert', () => {
      // The callee is a function, not a number: there is no closed form.
      // Before, the rules took `_1(_2)` as a constant in `_1` and gave 0.
      expect(
        engine.box(['Derivative', 'Apply', 1, 0]).evaluate().toString()
      ).toBe('Derivative("Apply", 1, 0)');
      expect(
        engine.box(['Derivative', 'Apply', 1, 1]).evaluate().toString()
      ).toBe('Derivative("Apply", 1, 1)');
      const ce = new ComputeEngine();
      expect(
        ce.box(['D', ['Apply', 'g', 'x'], 'g']).evaluate().toString()
      ).toBe('D(g(x), g)');
    });
  });

  describe('Arctan2 partial derivatives', () => {
    // ∂/∂y atan2(y, x) = x/(x² + y²) and ∂/∂x atan2(y, x) = −y/(x² + y²),
    // in all four quadrants. Each closed form is also checked against a
    // central difference of `Arctan2(…).N()`.
    const at2 = (y: number, x: number) => engine.box(['Arctan2', y, x]).N().re;
    const h = 1e-6;
    const POINTS = [
      [1.3, 0.7],
      [0.6, -1.1],
      [-0.8, 1.7],
      [-1.4, -0.9],
    ];

    it('d/dx Arctan2(y, x) = -y/(x^2 + y^2)', () => {
      const result = engine.expr(['D', ['Arctan2', 'y', 'x'], 'x']).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`-y / (x^2 + y^2)`);
      for (const [x, y] of POINTS) {
        const fd = (at2(y, x + h) - at2(y, x - h)) / (2 * h);
        expect(result.subs({ x, y }).N().re).toBeCloseTo(fd, 6);
      }
    });

    it('d/dy Arctan2(y, x) = x/(x^2 + y^2)', () => {
      const result = engine.expr(['D', ['Arctan2', 'y', 'x'], 'y']).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`x / (x^2 + y^2)`);
      for (const [x, y] of POINTS) {
        const fd = (at2(y + h, x) - at2(y - h, x)) / (2 * h);
        expect(result.subs({ x, y }).N().re).toBeCloseTo(fd, 6);
      }
    });

    it('d/dt Arctan2(t^2, cos t) closes by the chain rule', () => {
      const result = engine
        .expr(['D', ['Arctan2', ['Power', 't', 2], ['Cos', 't']], 't'])
        .evaluate();
      expect(result.has('Derivative')).toBe(false);
      expect(result.has('D')).toBe(false);
      const f = (t: number) => at2(t * t, Math.cos(t));
      for (const t of [0.4, 1.2, 2.3, -0.7, 3.5]) {
        const fd = (f(t + h) - f(t - h)) / (2 * h);
        expect(result.subs({ t }).N().re).toBeCloseTo(fd, 6);
      }
    });

    it('d/dx Arctan2(y, 3) = 0', () => {
      const result = engine.expr(['D', ['Arctan2', 'y', 3], 'x']).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });

    it('the multi-index Derivative of Arctan2 closes', () => {
      expect(
        engine
          .box(['Apply', ['Derivative', 'Arctan2', 1, 0], 'y', 'x'])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(`x / (x^2 + y^2)`);
      expect(
        engine
          .box(['Apply', ['Derivative', 'Arctan2', 0, 1], 'y', 'x'])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(`-y / (x^2 + y^2)`);
      expect(
        engine
          .box(['Apply', ['Derivative', 'Arctan2', 1, 1], 'y', 'x'])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(`(-x^2 + y^2) / (x^2 + y^2)^2`);
    });

    it('a bare Derivative of Arctan2 is the partial in the first argument', () => {
      // Arctan2 takes two arguments, so a bare `Derivative(Arctan2)` is
      // padded with order 0 to `Derivative(Arctan2, 1, 0)`, as for a user
      // function of two parameters: ∂/∂y atan2(y, x) = x / (x² + y²).
      expect(
        engine.box(['Derivative', 'Arctan2']).evaluate().toString()
      ).toMatchInlineSnapshot(`("x_1", "x_2") => "x_2" / ("x_1"^2 + "x_2"^2)`);
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

    // Mod(u, c) = u − c·floor(u/c) (floored: the result has the sign of c),
    // so between two jumps d/dv Mod(u, c) = u′ − floor(u/c)·c′. Checked
    // against a central difference of `Mod(…).N()` away from the jumps.
    const modN = (x: number, m: number) => engine.box(['Mod', x, m]).N().re;
    const slope = (f: (t: number) => number, t: number) =>
      (f(t + 1e-6) - f(t - 1e-6)) / 2e-6;

    it('d/dm mod(x, m) = -floor(x/m), for both signs of x and m', () => {
      const result = engine.expr(['D', ['Mod', 'x', 'm'], 'm']).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`-floor(x / m)`);
      for (const x of [5.5, -5.5, 7.3])
        for (const m of [2, -2, 2.4, -2.4, 0.7])
          expect(result.subs({ x, m }).N().re).toBeCloseTo(
            slope((t) => modN(x, t), m),
            5
          );
    });

    it('d/dx mod(x, x^2) = 1 - 2x floor(1/x) (modulus depends on x)', () => {
      const expr = engine.expr(['D', ['Mod', 'x', ['Square', 'x']], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`-2x * floor(1 / x) + 1`);
      for (const x of [0.3, 0.7, 1.7, -0.3, -1.6, 2.5])
        expect(result.subs({ x }).N().re).toBeCloseTo(
          slope((t) => modN(t, t * t), x),
          5
        );
    });

    it('d/dx round(x, 2) = 0, and stays symbolic in the step', () => {
      expect(
        engine
          .expr(['D', ['Round', 'x', 2], 'x'])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(`0`);
      expect(
        engine.expr(['D', ['Round', 2.5, 'n'], 'n']).evaluate().operator
      ).toBe('D');
    });

    it('the step forms of Floor, Ceil and Truncate: 0 in the operand, symbolic in the step', () => {
      // `Floor(x, a)` is `k·|a|`: constant between the jumps as a function
      // of x, but not as a function of the step a.
      for (const head of ['Floor', 'Ceil', 'Truncate']) {
        expect(
          engine.expr(['D', [head, 'x', 3], 'x']).evaluate().toString()
        ).toBe('0');
        expect(
          engine.expr(['D', [head, 2.5, 'a'], 'a']).evaluate().operator
        ).toBe('D');
      }
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

describe('Derivative(f) when the closed form holds the Derivative of another function', () => {
  it('is a function literal, as a complete closed form is', () => {
    const ce = new ComputeEngine();
    ce.parse('h(x) := g(x) \\cdot x').evaluate();
    const result = ce.box(['Derivative', 'h']).evaluate();
    expect(result.json).toMatchInlineSnapshot(`
      [
        Function,
        [
          Block,
          [
            Add,
            [
              Multiply,
              x,
              [
                Apply,
                [
                  Derivative,
                  g,
                  1,
                ],
                x,
              ],
            ],
            [
              g,
              x,
            ],
          ],
        ],
        x,
      ]
    `);
    expect(ce.lookupDefinition('_')).toBeUndefined();

    const applied = 't * Apply(Derivative(g, 1), t) + g(t)';
    expect(
      ce.box(['Apply', ['Derivative', 'h'], 't']).evaluate().toString()
    ).toBe(applied);
    expect(ce.parse("h'(t)").evaluate().toString()).toBe(applied);

    // Once `g` is defined, the application has a value: h'(x) = 3x².
    ce.parse('g(x) := x^2').evaluate();
    expect(ce.box(['Apply', ['Derivative', 'h'], 2]).N().re).toBe(12);
    expect(ce.parse("h'(2)").N().re).toBe(12);
  });

  it('a function literal operand keeps its parameter', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box(['Derivative', ['Function', ['Multiply', 'x', ['g', 'x']], 'x']])
      .evaluate();
    expect(result.operator).toBe('Function');
    expect(result.toString()).toMatchInlineSnapshot(
      `(x) => x * Apply(Derivative(g, 1), x) + g(x)`
    );
  });

  it('the derivative of a recursive function stays inert', () => {
    // The closed form holds `Derivative(f, 1)`. As a function literal, its
    // body would evaluate `Derivative(f)` again at each application.
    const ce = new ComputeEngine();
    ce.parse('f(x) := x f(x-1)').evaluate();
    expect(ce.box(['Derivative', 'f']).evaluate().toString()).toBe(
      'Derivative(f)'
    );
    expect(
      ce.box(['Apply', ['Derivative', 'f'], 't']).evaluate().toString()
    ).toBe('Apply(Derivative(f), t)');
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
    expect(result.json).toMatchInlineSnapshot(`23.09070257318873`);
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

describe('D over lazy operators stays symbolic (Tycho item 115)', () => {
  // A lazy operator's slots are binders, conditions or statements, not
  // scalar function arguments: the slot-wise chain-rule fallback is
  // meaningless for them, and applying the head to wildcard symbols runs
  // its evaluate handler on nonsense operands (`Which` used to THROW
  // "Condition must evaluate to..." out of evaluate() on the symbolic
  // condition). Expected: the `D` stays inert.
  //
  // `Which` and `If` are the exception: they are piecewise definitions, and
  // the piecewise rule below differentiates each value arm on its own region.
  // The point kept here is that the symbolic condition still does not throw.
  it('D over Which with a symbolic condition does not throw', () => {
    const expr = engine.expr([
      'D',
      ['Which', ['Less', 'x', 0], ['Power', 'x', 2], 'True', ['Power', 'x', 3]],
      'x',
    ]);
    expect(() => expr.evaluate()).not.toThrow();
    expect(expr.evaluate().toString()).toEqual(
      'Which(x < 0, 2x, "True", 3x^2)'
    );
  });

  it('D over an explicit Sum stays inert (no bound-variable leak)', () => {
    const result = engine
      .expr(['D', ['Sum', ['Power', 'x', 'm'], ['Triple', 'm', 0, 4]], 'x'])
      .evaluate();
    expect(result.operator).toEqual('D');
  });

  it('a user function whose body is a piecewise stays inert by reference', () => {
    const ce = new ComputeEngine();
    ce.parse(
      'f_0(x) := \\begin{cases} 0 & x \\le 0 \\\\ 1 & x \\ge 1 \\\\ 3x^2-2x^3 & \\end{cases}'
    ).evaluate();
    expect(() =>
      ce.parse('\\frac{\\mathrm{d}}{\\mathrm{d}x} f_0(x)').evaluate()
    ).not.toThrow();
  });

  it('a non-lazy unknown head keeps the chain-rule Apply(Derivative…) form', () => {
    const result = engine.expr(['D', ['Zeta', 'x'], 'x']).evaluate();
    expect(result.operator).toEqual('Apply');
  });
});

describe('Symbolic derivative size guard (Tycho item 140)', () => {
  // The differentiation rules duplicate their operands with no sharing:
  // `d/dx √u = u′/(2√u)` writes `u` twice, so each derivative order roughly
  // squares the tree of a deeply nested radical. The second derivative of a
  // `√(x+√(x+…))` nested a few dozen deep runs to millions of nodes — minutes
  // of work for a result no one can read. `differentiate()` refuses once what
  // it is assembling crosses `MAX_DERIVATIVE_NODES` and the enclosing `D`
  // stays inert, the same decline a lazy operator makes above.
  //
  // (The refusal is a bounded amount of work, not an instant one: the budget
  // is sized to admit every derivative the rest of this suite takes, so a
  // refusal necessarily costs at least as much as the largest admitted
  // result. What it is not is unbounded.)
  const nestedRadical = (depth: number): Expression => {
    let latex = 'x';
    for (let i = 0; i < depth; i++) latex = `\\sqrt{x+${latex}}`;
    return parse(latex);
  };

  it('a second derivative under the budget is computed as usual', () => {
    const result = engine.expr(['D', nestedRadical(4), 'x', 'x']).evaluate();
    expect(result.operator).not.toEqual('D');
    expect(result.toString()).not.toContain('D(');
  });

  it('a first derivative of a deeply nested radical is unaffected', () => {
    const result = engine.expr(['D', nestedRadical(16), 'x']).evaluate();
    expect(result.operator).not.toEqual('D');
  }, 60_000);

  it('the 37-deep radical of item 140 declines instead of hanging', () => {
    // At this nesting BOTH orders are over budget: the first derivative
    // alone runs to ~50 000 nodes / 176 000 characters (~25 s before the
    // guard), the second to millions (no result in 75 s). Both now decline.
    const f = nestedRadical(37);
    expect(engine.expr(['D', f, 'x']).evaluate().operator).toEqual('D');
    expect(engine.expr(['D', f, 'x', 'x']).evaluate().operator).toEqual('D');
    // The abort travels on module state; the next derivative must be
    // unaffected by it.
    expect(D('\\sin(x^2)', 'x').evaluate().latex).toEqual('2x\\cos(x^2)');
  }, 60_000);
});

describe('|v| over a TUPLE is a NORM, not a scalar absolute value', () => {
  // `DERIVATIVES_TABLE` carries the scalar rule `d|x|/dx = sign(x)`, which is
  // wrong for the Euclidean norm `Abs` denotes over a tuple. Applied through
  // the chain rule it produced `Sign((cos t, 1)) · (−sin t, 0)` — a tuple
  // times a tuple — surfacing as a nonsense value or an `incompatible-type`
  // tuple/number error depending on what enclosed it. The norm's derivative
  // is the projection of the component velocities onto the unit vector,
  // `d|v|/dt = (Σᵢ vᵢ·vᵢ′)/|v|`.
  //
  // Every case below is checked against a CENTRAL DIFFERENCE rather than a
  // recalled closed form: a plausible-but-wrong identity typechecks and
  // passes a symbolic comparison against itself.
  const central = (f: (t: number) => number, t: number): number =>
    (f(t + 1e-6) - f(t - 1e-6)) / 2e-6;

  const CASES: [string, string, (t: number) => number][] = [
    [
      'a constant norm differentiates to 0',
      '\\vert(\\cos(t), -\\sin(t), 1)\\vert',
      (t) => Math.hypot(Math.cos(t), -Math.sin(t), 1),
    ],
    [
      'a non-constant norm',
      '\\vert(\\cos(t), t^2, 1)\\vert',
      (t) => Math.hypot(Math.cos(t), t * t, 1),
    ],
    [
      'a norm homogeneous in t (sign-dependent)',
      '\\vert(t, 2t)\\vert',
      (t) => Math.hypot(t, 2 * t),
    ],
    [
      'a norm inside a product',
      '\\cos(t)\\cdot\\vert(\\cos(t), -\\sin(t), 1)\\vert',
      (t) => Math.cos(t) * Math.hypot(Math.cos(t), -Math.sin(t), 1),
    ],
  ];

  for (const [name, latex, f] of CASES) {
    test(name, () => {
      const ce = new ComputeEngine();
      const d = ce.box(['D', ce.parse(latex).json, 't']).evaluate();
      // Not inert, and not the scalar rule's `Sign` of a tuple.
      expect(d.operator).not.toBe('D');
      expect(d.toString()).not.toContain('Sign((');
      for (const t0 of [0.25, 1.3, -0.7]) {
        const sym = d.subs({ t: t0 }).N().re;
        expect(sym).toBeDefined();
        expect(sym!).toBeCloseTo(central(f, t0), 5);
      }
    });
  }

  test('a DECLARED head agrees with an undeclared one (Tycho item 197)', () => {
    // The reported witness. Declaring the head before binding it installs a
    // VALUE definition rather than an operator definition, which reaches the
    // derivative through a path that does not fold the constant norm away
    // first — so the scalar rule fired where the undeclared route had been
    // masked by the fold. The two routes must agree; the consumer's manager
    // is declare-then-assign by design, so only the declared route is
    // exercised in production.
    const body = '\\cos(t)\\cdot\\vert(\\cos(t), -\\sin(t), 1)\\vert';
    const results = [false, true].map((declareFirst) => {
      const ce = new ComputeEngine();
      if (declareFirst) ce.declare('G', 'function');
      ce.assign('G', ce.parse(`t \\mapsto ${body}`));
      return ce
        .box(['Apply', ['Derivative', 'G', 1], 0.25])
        .evaluate()
        .N().re;
    });
    expect(results[0]).toBeCloseTo(-0.34988203456, 8);
    expect(results[1]).toBeCloseTo(results[0]!, 12);
  });

  test('an OPAQUE operand that does not mention the variable is 0', () => {
    // A norm that does not mention `t` is constant in `t` whatever its
    // components are. This must NOT decline: before the norm rule existed
    // the scalar rule composed with `D(V, t) = 0` and gave `Sign(V)·0 = 0`,
    // so declining here would regress a correct answer to an inert one.
    const ce = new ComputeEngine();
    ce.declare('V', 'list<number>');
    expect(ce.box(['D', ['Abs', 'V'], 't']).evaluate().re).toBe(0);
    // The scalar case has always answered 0, and is the control.
    ce.declare('S', 'real');
    expect(ce.box(['D', ['Abs', 'S'], 't']).evaluate().re).toBe(0);
  });

  test('an EMPTY tuple norm differentiates to 0', () => {
    // `|()|` evaluates to 0 (the norm of an empty vector is 0 for every norm
    // type), so its derivative is 0 rather than a decline.
    const ce = new ComputeEngine();
    expect(ce.box(['Abs', ['Tuple']]).evaluate().re).toBe(0);
    expect(ce.box(['D', ['Abs', ['Tuple']], 't']).evaluate().re).toBe(0);
  });

  test('a COMPLEX component gives a real derivative', () => {
    // The numerator is `Real(Conjugate(vᵢ)·vᵢ′)`, not the bare product: the
    // real Euclidean form answers `0.667 + 0.333i` for `|(t+i, 2)|` at t = 2
    // where the derivative is the real `0.667` — right real part, spurious
    // imaginary one. `isExtendedReal` cannot gate this (a symbolic `cos(t)` over a
    // free `t` reports `isExtendedReal === false`, meaning "not provably real"), so
    // the Hermitian form is emitted unconditionally.
    const ce = new ComputeEngine();
    const d = ce
      .box(['D', ['Abs', ['Tuple', ['Add', 't', 'ImaginaryUnit'], 2]], 't'])
      .evaluate();
    const f = (t: number) => Math.hypot(Math.hypot(t, 1), 2);
    for (const t0 of [2, 0.5]) {
      const got = d.subs({ t: t0 }).N();
      expect(got.re!).toBeCloseTo((f(t0 + 1e-6) - f(t0 - 1e-6)) / 2e-6, 5);
      expect(got.im ?? 0).toBeCloseTo(0, 12);
    }
  });

  test('a SCALAR |x| still uses the sign rule', () => {
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Abs', 'x'], 'x']).evaluate();
    expect(d.toString()).toContain('Sign');
  });
});

describe('VECTOR-VALUED DERIVATIVES — the declared type must not contradict the value', () => {
  // A head declared as a bare `function` and only THEN assigned a
  // tuple-valued lambda used to commit a SCALAR result for its derivative:
  // `f'(t)` typed `number` while `.N()` returned a 3-tuple, so `Cross`/`Dot`
  // rejected the call with `incompatible-type` for the rest of the session.
  const curve = (ce: ComputeEngine) =>
    ce.parse('(t) \\mapsto (\\cos t, \\sin 2t, t)');

  test.each(['function', 'signature'] as const)(
    'declared as %s: the derivative of the curve is tuple-valued',
    (declareAs) => {
      const ce = new ComputeEngine();
      if (declareAs === 'function') ce.declare('f', 'function');
      else ce.declare('f', { signature: '(unknown) -> unknown' } as any);
      ce.assign('f', curve(ce));

      expect(ce.parse("f'(0.25)").type.matches('tuple<number, number, number>'))
        .toBe(true);
      expect(ce.box(['Cross', ['Apply', ['Derivative', 'f', 1], 0.25],
        ['Tuple', 1, 2, 3]]).isValid).toBe(true);
    }
  );

  test('the normalized derivative keeps the tuple through a second level', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.declare('F_0', 'function');
    ce.assign('f', curve(ce));
    ce.assign(
      'F_0',
      ce.parse("(t) \\mapsto \\frac{f'(t)}{\\left|f'(t)\\right|}")
    );
    const call = ce.parse('F_0(0.25)');
    expect(call.type.matches('tuple<number, number, number>')).toBe(true);
    // The value the type must agree with: a unit-length 3-tuple.
    const v = call.N();
    expect(v.operator).toBe('Tuple');
    expect(
      Math.hypot(...v.ops!.map((op) => op.re!))
    ).toBeCloseTo(1, 10);
    expect(
      ce.box(['Cross', ['F_0', 0.25], ['Tuple', 1, 2, 3]]).isValid
    ).toBe(true);
  });

  test('an UNASSIGNED bare `function` head still reports a scalar derivative', () => {
    // Nothing says what it returns, so the long-standing scalar compromise
    // stands: passing `any` through would type every application `any`.
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    expect(ce.box(['Derivative', 'g', 1]).type.toString()).toBe(
      '(any*) -> number'
    );
  });

  test('`D` of a tuple or list body keeps the shape it evaluates to', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    const dTuple = ce.box(['D', ['Tuple', ['Cos', 't'], ['Sin', 't']], 't']);
    expect(dTuple.type.matches('tuple<number, number>')).toBe(true);
    expect(dTuple.evaluate().operator).toBe('Tuple');

    const dList = ce.box(['D', ['List', ['Cos', 't'], ['Sin', 't']], 't']);
    expect(dList.type.matches('list<number>')).toBe(true);
    expect(dList.evaluate().operator).toBe('List');
  });

  test('`D` of a scalar body is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['D', ['Sin', 'x'], 'x']).type.matches('number')).toBe(true);
  });
});

describe('Derivative order operand', () => {
  // `f^{(n)}` is documented as `Derivative(f, n)`. A symbolic order used to
  // be rejected at canonicalization (`incompatible-type`: the order was
  // checked against `number` without the inference a free symbol gets
  // elsewhere), and an order that is not a number was read as 1 at
  // evaluation, which would have made `f^{(n)}` the first derivative.
  test('a symbolic order is inferred `number` and stays inert', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) -> number');
    const e = ce.parse('f^{(n)}');
    expect(e.json).toEqual(['Derivative', 'f', 'n']);
    expect(e.isValid).toBe(true);
    expect(ce.symbol('n').type.toString()).toBe('number');
    expect(e.evaluate().json).toEqual(['Derivative', 'f', 'n']);
  });

  test('the order resolves once assigned', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^3'));
    const e = ce.parse('f^{(n)}(2)');
    expect(e.evaluate().json).toEqual(['Apply', ['Derivative', 'f', 'n'], 2]);
    ce.assign('n', 2);
    expect(ce.parse('f^{(n)}(2)').evaluate().toString()).toBe('12');
  });

  test('a multi-index over a symbol bound to a lambda differentiates', () => {
    // The multi-index arm only handled an inline `Function` literal, so a
    // symbol bound to one stayed inert while the univariate arm resolved it.
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('(x, y) \\mapsto x^2 y'));
    expect(
      ce
        .box(['Apply', ['Derivative', 'g', 1, 0], 2, 3])
        .evaluate()
        .toString()
    ).toBe('12');
    expect(
      ce
        .box(['Apply', ['Derivative', 'g', 0, 1], 2, 3])
        .evaluate()
        .toString()
    ).toBe('4');
    // Zero in every position is the function itself.
    expect(ce.box(['Derivative', 'g', 0, 0]).evaluate().json).toEqual('g');
    expect(
      ce
        .box(['Apply', ['Derivative', 'g', 0, 0], 2, 3])
        .evaluate()
        .toString()
    ).toBe('12');
  });

  test('order 0 of a function symbol is the function itself', () => {
    // The lifting step re-parameterized the symbol over its value's
    // parameters: `Derivative(g, 0)` came back as `(x) ↦ g`.
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto x^3'));
    expect(ce.box(['Derivative', 'g', 0]).evaluate().json).toEqual('g');
    expect(
      ce
        .box(['Apply', ['Derivative', 'g', 0], 2])
        .evaluate()
        .toString()
    ).toBe('8');
    expect(
      ce
        .box(['Derivative', ['Function', ['Power', 'x', 2], 'x'], 0])
        .evaluate()
        .toString()
    ).toBe('(x) => x^2');
  });

  test('an order that is not a non-negative integer stays inert', () => {
    // Each order was rounded down, so `Derivative(Power, -1, 1)` was
    // evaluated as `Derivative(Power, 0, 1)` and `Derivative(Sin, 1.5)` as
    // the first derivative. `D(f, {x, n})` already stays inert for such `n`.
    const ce = new ComputeEngine();
    for (const orders of [
      [-1, 1],
      [1.5, 1],
      [0.5, 0],
      ['n', 1],
    ]) {
      expect(ce.box(['Derivative', 'Power', ...orders]).evaluate().json).toEqual(
        ['Derivative', 'Power', ...orders]
      );
      expect(
        ce.box(['Apply', ['Derivative', 'Power', ...orders], 2, 3]).evaluate()
          .json
      ).toEqual(['Apply', ['Derivative', 'Power', ...orders], 2, 3]);
    }
    expect(ce.box(['Derivative', 'Sin', 1.5]).evaluate().json).toEqual([
      'Derivative',
      'Sin',
      1.5,
    ]);
    expect(ce.box(['Derivative', 'Sin', -1]).evaluate().json).toEqual([
      'Derivative',
      'Sin',
      -1,
    ]);
  });

  test('the number of orders must agree with the number of arguments', () => {
    const ce = new ComputeEngine();
    // More orders than arguments: `differentiate()` truncated the order
    // vector, so `D(g^{(1,1)}(x), x)` gave `g''(x)`.
    for (const expr of [
      ['D', ['Apply', ['Derivative', 'g', 1, 1], 'x'], 'x'],
      ['D', ['Apply', ['Derivative', 'g', 1, 0], 'x'], 'x'],
    ])
      expect(ce.box(expr).evaluate().json).toEqual(expr);
    // A bare `Derivative(g)` is order 1 in the first argument. It was read
    // as order 0 when there were several arguments.
    expect(
      ce.box(['D', ['Apply', ['Derivative', 'g'], 'x', 'y'], 'x']).evaluate()
        .json
    ).toEqual(['Apply', ['Derivative', 'g', 2, 0], 'x', 'y']);
    // Fewer orders than arguments are padded with order 0.
    expect(
      ce.box(['D', ['Apply', ['Derivative', 'g', 1], 'x', 'y'], 'x']).evaluate()
        .json
    ).toEqual(['Apply', ['Derivative', 'g', 2, 0], 'x', 'y']);

    // The evaluate handler: more orders than parameters threw "Too many
    // arguments"; now the node stays inert.
    ce.assign('h', ce.parse('(x, y) \\mapsto x^2 y'));
    expect(ce.box(['Derivative', 'h', 1, 0, 0]).evaluate().json).toEqual([
      'Derivative',
      'h',
      1,
      0,
      0,
    ]);
    expect(
      ce.box(['Apply', ['Derivative', 'h', 1, 0, 0], 2, 3]).evaluate().json
    ).toEqual(['Apply', ['Derivative', 'h', 1, 0, 0], 2, 3]);
    // The same when every order is 0: the check of the number of orders
    // comes first. `Derivative(Sin, 0, 0)` was `Sin`.
    for (const d of [
      ['Derivative', 'Sin', 0, 0],
      ['Derivative', 'h', 0, 0, 0],
      ['Derivative', ['Function', ['Power', 'x', 2], 'x'], 0, 0],
    ])
      expect(ce.box(d).evaluate().json).toEqual(ce.box(d).json);
    expect(ce.box(['Derivative', 'Sin', 0]).evaluate().json).toEqual('Sin');
    expect(ce.box(['Derivative', 'h', 0, 0]).evaluate().json).toEqual('h');
    // One order on a symbol bound to a bivariate literal is the partial in
    // the first parameter. It gave `(x) => x^2` and its application threw.
    // ∂/∂x x²y = 2xy and ∂²/∂x² x²y = 2y.
    expect(ce.box(['Derivative', 'h', 1]).evaluate().toString()).toBe(
      '(x, y) => 2x * y'
    );
    expect(ce.parse("h'(2, 3)").evaluate().toString()).toBe('12');
    expect(ce.parse("h''(2, 3)").evaluate().toString()).toBe('6');
    // Two orders on a function of three parameters: the third is order 0.
    // ∂²/∂a∂b a²·b·c³ = 2a·c³, which is 500 at (2, 3, 5).
    ce.parse('u(a, b, c) \\coloneq a^2 b c^3').evaluate();
    expect(
      ce.box(['Apply', ['Derivative', 'u', 1, 1], 2, 3, 5]).evaluate().toString()
    ).toBe('500');
  });

  test('a single order on an operator of two arguments is padded', () => {
    // `Derivative(Arctan2, 1)` and a bare `Derivative(Arctan2)` are
    // `Derivative(Arctan2, 1, 0)`: ∂/∂y atan2(y, x) = x / (x² + y²). They
    // stayed inert, while the explicit multi-index evaluated.
    const ce = new ComputeEngine();
    for (const d of [
      ['Derivative', 'Arctan2'],
      ['Derivative', 'Arctan2', 1],
      ['Derivative', 'Arctan2', 1, 0],
    ]) {
      expect(ce.box(['Apply', d, 'y', 'x']).evaluate().toString()).toBe(
        'x / (x^2 + y^2)'
      );
      // Against a central difference of atan2 in its first argument.
      const [y, x, h] = [0.7, -1.3, 1e-6];
      const fd = (Math.atan2(y + h, x) - Math.atan2(y - h, x)) / (2 * h);
      expect(ce.box(['Apply', d, y, x]).N().re).toBeCloseTo(fd, 8);
    }
    // More orders than arguments stay inert.
    expect(ce.box(['Derivative', 'Arctan2', 1, 0, 0]).evaluate().json).toEqual(
      ['Derivative', 'Arctan2', 1, 0, 0]
    );
    // A one-argument operator is unchanged.
    expect(ce.box(['Derivative', 'Sin', 1]).evaluate().toString()).toBe(
      '(x) => cos(x)'
    );
    expect(ce.box(['Derivative', 'Sin']).evaluate().toString()).toBe(
      '(x) => cos(x)'
    );
  });

  test('D of an applied Derivative with an invalid order stays inert', () => {
    // The chain rule over `Apply(Derivative(f, α), …)` bumps one order of
    // the multi-index. Each order was rounded down first, so
    // `D(f^{(1.5)}(x), x)` gave `f''(x)` and `D(f^{(-1)}(x), x)` gave
    // `Derivative(f, 0)(x)`.
    const ce = new ComputeEngine();
    for (const o of [-1, 1.5, 'n']) {
      for (const expr of [
        ['D', ['Apply', ['Derivative', 'f', o], 'x'], 'x'],
        ['D', ['Apply', ['Derivative', 'g', 1, o], 'x', 'y'], 'y'],
      ])
        expect(ce.box(expr).evaluate().json).toEqual(expr);
    }
    // A valid order is still bumped.
    expect(
      ce.box(['D', ['Apply', ['Derivative', 'g', 1, 2], 'x', 'y'], 'y'])
        .evaluate().json
    ).toEqual(['Apply', ['Derivative', 'g', 1, 3], 'x', 'y']);
  });

  test('a very large order stays inert', () => {
    // The work and the memory scale with the value of the order: the
    // multi-index arm built a nested `D` tree of one node for each unit of
    // order, and `Derivative(Power, 1000000000, 0)` used up the heap.
    const ce = new ComputeEngine();
    const huge = 1000000000;
    expect(ce.box(['Derivative', 'Power', huge, 0]).evaluate().json).toEqual([
      'Derivative',
      'Power',
      huge,
      0,
    ]);
    expect(
      ce.box(['Apply', ['Derivative', 'Power', huge, 0], 2, 3]).evaluate().json
    ).toEqual(['Apply', ['Derivative', 'Power', huge, 0], 2, 3]);
    expect(
      ce.box(['Apply', ['Derivative', 'Power', huge, 0], 2, 3]).N().json
    ).toEqual(['Apply', ['Derivative', 'Power', huge, 0], 2, 3]);
    expect(ce.box(['Derivative', 'Sin', huge]).evaluate().json).toEqual([
      'Derivative',
      'Sin',
      huge,
    ]);
    expect(
      ce
        .box([
          'Derivative',
          ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
          huge,
          0,
        ])
        .evaluate().operator
    ).toBe('Derivative');
    // The evaluation of the nested `D` tree recursed once for each unit of
    // order and overflowed the call stack near 500.
    expect(ce.box(['Derivative', 'Power', 500, 0]).evaluate().json).toEqual([
      'Derivative',
      'Power',
      500,
      0,
    ]);
  });

  test('a partial of a function literal with no closed form stays inert', () => {
    // `differentiate()` leaves a `D` where it has no rule. Made a function
    // literal, that `D` kept the differentiation variable free, so an
    // application lost that argument: `Apply(Derivative(f, 0, 1), 1.5, 2)`
    // gave `D(Round(1.5, y), y)`.
    const ce = new ComputeEngine();
    ce.parse('f(x, y) \\coloneq \\operatorname{Round}(x, y)').evaluate();
    expect(ce.box(['Derivative', 'f', 0, 1]).evaluate().json).toEqual([
      'Derivative',
      'f',
      0,
      1,
    ]);
    expect(
      ce.box(['Apply', ['Derivative', 'f', 0, 1], 1.5, 2]).evaluate().json
    ).toEqual(['Apply', ['Derivative', 'f', 0, 1], 1.5, 2]);
    // An inline literal: the partial of `PolyGamma(x, y)` in its order `x`.
    const g = ['Function', ['PolyGamma', 'x', 'y'], 'x', 'y'];
    expect(ce.box(['Derivative', g, 1, 0]).evaluate().operator).toBe(
      'Derivative'
    );
    expect(
      ce.box(['Apply', ['Derivative', g, 1, 0], 1, 2]).evaluate().operator
    ).toBe('Apply');
  });
});

describe('D over a piecewise definition (Which / If)', () => {
  // A piecewise function is differentiated arm by arm, each arm on its own
  // region, and the conditions are carried over unchanged. The jump at a
  // region boundary is not represented — that is the convention every CAS
  // uses for a piecewise derivative.
  //
  // A central difference of the piecewise function, taken at two interior
  // points of each region, is what verifies each of these.
  const centralDifference = (
    f: (x: number) => number,
    x: number,
    h = 1e-6
  ): number => (f(x + h) - f(x - h)) / (2 * h);

  const valueAt = (expr: Expression, x: number): number =>
    expr.subs({ x }).N().re;

  it('differentiates each arm of a Which', () => {
    const result = engine
      .expr([
        'D',
        [
          'Which',
          ['Less', 'x', 0],
          ['Power', 'x', 2],
          'True',
          ['Power', 'x', 3],
        ],
        'x',
      ])
      .evaluate();
    expect(result.toString()).toEqual('Which(x < 0, 2x, "True", 3x^2)');

    const f = (x: number) => (x < 0 ? x ** 2 : x ** 3);
    for (const x of [-3, -0.7, 0.4, 2.1])
      expect(valueAt(result, x)).toBeCloseTo(centralDifference(f, x), 5);
  });

  it('differentiates both branches of an If', () => {
    const result = engine
      .expr([
        'D',
        ['If', ['Less', 'x', 0], ['Sin', 'x'], ['Exp', 'x']],
        'x',
      ])
      .evaluate();
    expect(result.toString()).toEqual('If(x < 0, cos(x), e^x)');

    const f = (x: number) => (x < 0 ? Math.sin(x) : Math.exp(x));
    for (const x of [-2.2, -0.4, 0.6, 1.3])
      expect(valueAt(result, x)).toBeCloseTo(centralDifference(f, x), 5);
  });

  it('differentiates a `cases` environment', () => {
    const result = engine
      .expr([
        'D',
        engine.parse('\\begin{cases} x^2 & x>0 \\\\ -x \\end{cases}'),
        'x',
      ])
      .evaluate();
    expect(result.toString()).toEqual('Which(0 < x, 2x, "True", -1)');
  });

  // The distributions answer piecewise closed forms, so differentiating an
  // evaluated CDF is the route ordinary user input takes into this rule.
  // Without the piecewise arm the `D` stayed inert.
  it('differentiates an evaluated CDF back to its density', () => {
    const ce = new ComputeEngine();
    const cdf = ce
      .parse('\\mathrm{CDF}(\\mathrm{ExponentialDistribution}(2), x)')
      .evaluate();
    const result = ce.function('D', [cdf, ce.symbol('x')]).evaluate();
    expect(result.toString()).toEqual('Which(x < 0, 0, "True", 2e^(-2x))');
    // The density of Exponential(2) at x = 1 is 2·e^(-2) = 0.2706705664732254.
    expect(result.subs({ x: 1 }).N().re).toBeCloseTo(2 * Math.exp(-2), 12);
    expect(result.subs({ x: 0.5 }).N().re).toBeCloseTo(2 * Math.exp(-1), 12);
    expect(result.subs({ x: -1 }).N().re).toBe(0);
  });

  it('differentiates an evaluated PDF to zero on every region', () => {
    const ce = new ComputeEngine();
    const pdf = ce
      .parse('\\mathrm{PDF}(\\mathrm{UniformDistribution}(0, 1), x)')
      .evaluate();
    const result = ce.function('D', [pdf, ce.symbol('x')]).evaluate();
    expect(result.toString()).toEqual(
      'Which(0 <= x && x <= 1, 0, "True", 0)'
    );
  });

  // A held operand of a lazy operator arrives UNBOUND on the box and parse
  // routes, so the rule canonicalizes each arm before differentiating it.
  it('answers the same on the box and parse routes', () => {
    const expected = 'Which(x < 0, 0, "True", 2e^(-2x))';
    const boxed = engine.box([
      'Which',
      ['Less', 'x', 0],
      0,
      'True',
      ['Subtract', 1, ['Exp', ['Negate', ['Multiply', 2, 'x']]]],
    ]);
    expect(
      engine.function('D', [boxed, engine.symbol('x')]).evaluate().toString()
    ).toEqual(expected);

    const parsed = engine.parse(
      '\\mathrm{Which}(x<0, 0, \\mathrm{True}, 1-e^{-2x})'
    );
    expect(
      engine.function('D', [parsed, engine.symbol('x')]).evaluate().toString()
    ).toEqual(expected);
  });

  it('keeps an arm that carries a symbolic transcendental exact', () => {
    const result = engine
      .expr([
        'D',
        ['Which', ['Less', 'x', 0], 0, 'True', ['Multiply', ['Ln', 2], 'x']],
        'x',
      ])
      .evaluate();
    expect(result.toString()).toEqual('Which(x < 0, 0, "True", ln(2))');
  });

  it('leaves an arm with no closed form symbolic, and differentiates the rest', () => {
    const result = engine
      .expr([
        'D',
        ['Which', ['Less', 'x', 0], ['f', 'x'], 'True', ['Power', 'x', 3]],
        'x',
      ])
      .evaluate();
    expect(result.toString()).toEqual(
      'Which(x < 0, Apply(Derivative(f, 1), x), "True", 3x^2)'
    );
  });

  it('applies the product rule to a piecewise factor', () => {
    const result = engine
      .expr([
        'D',
        [
          'Multiply',
          'x',
          [
            'Which',
            ['Less', 'x', 0],
            ['Power', 'x', 2],
            'True',
            ['Power', 'x', 3],
          ],
        ],
        'x',
      ])
      .evaluate();
    expect(result.operator).toEqual('Which');

    const f = (x: number) => x * (x < 0 ? x ** 2 : x ** 3);
    for (const x of [-3, -0.7, 0.4, 2.1])
      expect(valueAt(result, x)).toBeCloseTo(centralDifference(f, x), 5);
  });

  // The differentiation variable is bound by `D`, so a same-named global
  // assignment must not substitute into an arm.
  it('does not substitute an assigned value for the bound variable', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const result = ce
      .box([
        'D',
        [
          'Which',
          ['Less', 'x', 0],
          ['Power', 'x', 2],
          'True',
          ['Power', 'x', 3],
        ],
        'x',
      ])
      .evaluate();
    expect(result.toString()).toEqual('Which(x < 0, 2x, "True", 3x^2)');
  });
});
