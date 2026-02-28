import type { Expression } from '../../src/compute-engine/global-types';
import { engine } from '../utils';

function parse(expr: string): Expression {
  return engine.parse(expr)!;
}

// Helper to create D expressions using MathJSON directly
// Note: D(f, x) in LaTeX now parses as Predicate, not the derivative function.
// Use this helper or Leibniz notation (\frac{d}{dx}) for derivatives.
function D(expr: string, ...vars: string[]): Expression {
  return engine.box(['D', engine.parse(expr), ...vars]);
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
    const expr = engine.box(['D', ['D', engine.parse('x^2 + y^2'), 'x'], 'x']);
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
      `-(1 / sqrt(1 - x^2))`
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

  it('d/dx arcoth(x) = -1/(1-x^2)', () => {
    expect(D('\\arcoth(x)', 'x').evaluate().toString()).toMatchInlineSnapshot(
      `-1 / (1 - x^2)`
    );
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
    const expr = engine.box(['D', ['Digamma', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`Trigamma(x)`);
  });

  it('d/dx Erf(x) = 2/sqrt(pi) * e^(-x^2)', () => {
    // Use MathJSON directly since \mathrm{erf} parses differently
    const expr = engine.box(['D', ['Erf', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`(2e^(-(x^2))) / sqrt(pi)`);
  });

  it('d/dx Erfc(x) = -2/sqrt(pi) * e^(-x^2)', () => {
    const expr = engine.box(['D', ['Erfc', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `(-2e^(-(x^2))) / sqrt(pi)`
    );
  });

  it('d/dx GammaLn(x) = Digamma(x)', () => {
    const expr = engine.box(['D', ['GammaLn', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`Digamma(x)`);
  });

  it('d/dx FresnelS(x) = sin(pi*x^2/2)', () => {
    const expr = engine.box(['D', ['FresnelS', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`sin(1/2 * pi * x^2)`);
  });

  it('d/dx FresnelC(x) = cos(pi*x^2/2)', () => {
    const expr = engine.box(['D', ['FresnelC', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`cos(1/2 * pi * x^2)`);
  });

  it('d/dx LambertW(x) = LambertW(x)/(x*(1+LambertW(x)))', () => {
    const expr = engine.box(['D', ['LambertW', 'x'], 'x']);
    const result = expr.evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `LambertW(x) / (x + x * LambertW(x))`
    );
  });
});

describe('Symbolic derivatives for unknown functions', () => {
  it('d/dx f(x) returns symbolic derivative for unknown function', () => {
    const expr = engine.box(['D', ['f', 'x'], 'x']);
    const result = expr.evaluate();
    // Returns Apply(Derivative(f, 1), x) which represents f'(x)
    expect(result.toString()).toMatchInlineSnapshot(
      `Apply(Derivative(f, 1), x)`
    );
  });

  // Note: Chain rule with unknown functions currently returns 0 because
  // unknown function symbols fail the isValid check in derivative.ts.
  // This is a known limitation that could be improved in the future.
  it('d/dx f(x^2) - chain rule with unknown function (current limitation)', () => {
    const expr = engine.box(['D', ['f', ['Square', 'x']], 'x']);
    const result = expr.evaluate();
    // Ideally would return 2x * f'(x^2), currently returns 0
    expect(result.toString()).toMatchInlineSnapshot(`0`);
  });

  it('d/dx g(sin(x)) - chain rule with unknown function (current limitation)', () => {
    const expr = engine.box(['D', ['g', ['Sin', 'x']], 'x']);
    const result = expr.evaluate();
    // Ideally would return cos(x) * g'(sin(x)), currently returns 0
    expect(result.toString()).toMatchInlineSnapshot(`0`);
  });
});

describe('Bessel function derivatives', () => {
  describe('BesselJ (first kind)', () => {
    it('d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2', () => {
      const expr = engine.box(['D', ['BesselJ', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselJ(n + 1, x) + 1/2 * BesselJ(n - 1, x)`
      );
    });

    it('d/dx J_2(x) with numeric order', () => {
      const expr = engine.box(['D', ['BesselJ', 2, 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselJ(3, x) + 1/2 * BesselJ(1, x)`
      );
    });

    it('d/dx J_0(x) = -J_1(x) (special case)', () => {
      // J_{-1}(x) = -J_1(x), so (J_{-1}(x) - J_1(x))/2 = -J_1(x)
      const expr = engine.box(['D', ['BesselJ', 0, 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselJ(1, x) + 1/2 * BesselJ(-1, x)`
      );
    });
  });

  describe('BesselY (second kind)', () => {
    it('d/dx Y_n(x) = (Y_{n-1}(x) - Y_{n+1}(x))/2', () => {
      const expr = engine.box(['D', ['BesselY', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselY(n + 1, x) + 1/2 * BesselY(n - 1, x)`
      );
    });
  });

  describe('BesselI (modified first kind)', () => {
    it('d/dx I_n(x) = (I_{n-1}(x) + I_{n+1}(x))/2', () => {
      const expr = engine.box(['D', ['BesselI', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `1/2 * BesselI(n - 1, x) + 1/2 * BesselI(n + 1, x)`
      );
    });
  });

  describe('BesselK (modified second kind)', () => {
    it('d/dx K_n(x) = -(K_{n-1}(x) + K_{n+1}(x))/2', () => {
      const expr = engine.box(['D', ['BesselK', 'n', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `-1/2 * BesselK(n - 1, x) - 1/2 * BesselK(n + 1, x)`
      );
    });
  });

  describe('Chain rule with Bessel functions', () => {
    it('d/dx J_2(x^2) applies chain rule', () => {
      const expr = engine.box(['D', ['BesselJ', 2, ['Square', 'x']], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `x * BesselJ(1, x^2) - x * BesselJ(3, x^2)`
      );
    });
  });

  describe('Constant Bessel functions', () => {
    it('d/dx J_2(5) = 0 (no variable)', () => {
      const expr = engine.box(['D', ['BesselJ', 2, 5], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });
  });
});

describe('Multi-argument function derivatives', () => {
  describe('Log with custom base', () => {
    it('d/dx log_2(x) = 1/(x*ln(2))', () => {
      const expr = engine.box(['D', ['Log', 'x', 2], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`1 / (x * ln(2))`);
    });

    it('d/dx log_e(x) = 1/x (natural log)', () => {
      const expr = engine.box(['D', ['Log', 'x', 'ExponentialE'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`1 / x`);
    });

    it('d/dx log_a(x) = 1/(x*ln(a)) with symbolic base', () => {
      const expr = engine.box(['D', ['Log', 'x', 'a'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`1 / (x * ln(a))`);
    });

    it('d/dx log_2(x^2) = 2/(x*ln(2)) via chain rule', () => {
      const expr = engine.box(['D', ['Log', ['Square', 'x'], 2], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`2 / (x * ln(2))`);
    });

    it('d/dx log_2(constant) = 0', () => {
      const expr = engine.box(['D', ['Log', 5, 2], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });

    it('d/dx log_x(a) when base depends on x', () => {
      // log_x(a) = ln(a)/ln(x), so d/dx = -ln(a)/(x*ln(x)^2)
      const expr = engine.box(['D', ['Log', 'a', 'x'], 'x']);
      const result = expr.evaluate();
      // Should use quotient rule on ln(a)/ln(x)
      expect(result.toString()).toMatchInlineSnapshot(`-ln(a) / (x * ln(x)^2)`);
    });

    it('d/dx log_x(x) when both depend on x', () => {
      // log_x(x) = ln(x)/ln(x) = 1, so d/dx = 0
      const expr = engine.box(['D', ['Log', 'x', 'x'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });
  });

  describe('Discrete functions (step functions)', () => {
    it('d/dx mod(x, 5) = 0', () => {
      const expr = engine.box(['D', ['Mod', 'x', 5], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });

    it('d/dx mod(x^2, y) = 0', () => {
      const expr = engine.box(['D', ['Mod', ['Square', 'x'], 'y'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });

    it('d/dx gcd(x, 6) = 0', () => {
      const expr = engine.box(['D', ['GCD', 'x', 6], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
    });

    it('d/dx lcm(x, y) = 0', () => {
      const expr = engine.box(['D', ['LCM', 'x', 'y'], 'x']);
      const result = expr.evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`0`);
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
    const expr = ce.box(['D', ['f', 'x'], 'x']);
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
    const expr = ce.box(['D', ['f', ['Square', 'x']], 'x']);
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
