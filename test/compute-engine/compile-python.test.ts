import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

describe('PYTHON TARGET', () => {
  const python = new PythonTarget();
  const pythonWithImports = new PythonTarget({ includeImports: true });

  describe('Basic Arithmetic', () => {
    it('should compile simple addition', () => {
      const expr = ce.parse('x + y');
      const code = python.compile(expr).code;
      expect(code).toBe('x + y');
    });

    it('should compile multiplication', () => {
      const expr = ce.parse('x * y');
      const code = python.compile(expr).code;
      expect(code).toBe('x * y');
    });

    it('should compile power with ** operator', () => {
      const expr = ce.parse('x^2');
      const code = python.compile(expr).code;
      expect(code).toBe('x ** 2');
    });

    it('should compile complex polynomial', () => {
      const expr = ce.parse('x^4 + 3x^3 + 2x^2 + x + 1');
      const code = python.compile(expr).code;
      expect(code).toBe('x ** 4 + 3 * x ** 3 + 2 * x ** 2 + x + 1');
    });

    // REVIEW.md E13: `**` is right-associative in Python, so the left operand
    // of a nested power needs parentheses — `(a^b)^c` must not emit
    // `a ** b ** c` (which Python parses as `a ** (b ** c)`).
    it('should parenthesize the left base of a nested power', () => {
      const expr = ce.expr(['Power', ['Power', 'a', 'b'], 'c']);
      expect(python.compile(expr).code).toBe('(a ** b) ** c');
    });

    it('should not parenthesize a right-nested power (already right-assoc)', () => {
      const expr = ce.expr(['Power', 'a', ['Power', 'b', 'c']]);
      expect(python.compile(expr).code).toBe('a ** b ** c');
    });
  });

  describe('Mathematical Functions', () => {
    it('should compile trigonometric functions', () => {
      const expr = ce.parse('\\sin(x)');
      const code = python.compile(expr).code;
      expect(code).toBe('np.sin(x)');
    });

    it('should compile multiple trig functions', () => {
      const expr = ce.parse('\\sin(x) + \\cos(y) + \\tan(z)');
      const code = python.compile(expr).code;
      expect(code).toBe('np.sin(x) + np.cos(y) + np.tan(z)');
    });

    it('should compile exponential and logarithm', () => {
      const expr = ce.parse('\\exp(x) + \\ln(y)');
      const code = python.compile(expr).code;
      // \exp(x) is canonicalized to e^x
      expect(code).toBe('np.e ** x + np.log(y)');
    });

    it('should compile square root', () => {
      const expr = ce.parse('\\sqrt{x^2 + y^2}');
      const code = python.compile(expr).code;
      expect(code).toBe('np.sqrt(x ** 2 + y ** 2)');
    });

    it('should compile absolute value', () => {
      const expr = ce.parse('|x|');
      const code = python.compile(expr).code;
      expect(code).toBe('np.abs(x)');
    });
  });

  describe('Constants', () => {
    it('should compile pi', () => {
      const expr = ce.parse('\\pi');
      const code = python.compile(expr).code;
      expect(code).toBe('np.pi');
    });

    it('should compile e', () => {
      const expr = ce.parse('e');
      const code = python.compile(expr).code;
      expect(code).toBe('np.e');
    });

    it('should compile expression with constants', () => {
      const expr = ce.parse('2\\pi r');
      const code = python.compile(expr).code;
      expect(code).toBe('2 * np.pi * r');
    });
  });

  describe('Complex Expressions', () => {
    it('should compile nested expressions', () => {
      const expr = ce.parse('\\sqrt{\\sqrt{x^2 + 1} + x}');
      const code = python.compile(expr).code;
      // Expression is canonicalized (arguments reordered)
      expect(code).toBe('np.sqrt(x + np.sqrt(x ** 2 + 1))');
    });

    it('should compile rational expressions', () => {
      const expr = ce.parse('\\frac{x^2 + 1}{x^2 - 1}');
      const code = python.compile(expr).code;
      // -1 is canonicalized to + -1
      expect(code).toBe('(x ** 2 + 1) / (x ** 2 + -1)');
    });

    it('should compile Gaussian function', () => {
      const expr = ce.parse('\\exp(-x^2)');
      const code = python.compile(expr).code;
      // \exp is canonicalized to e^
      expect(code).toBe('np.e ** (-x ** 2)');
    });
  });

  describe('Function Generation', () => {
    it('should generate a simple function', () => {
      const expr = ce.parse('x^2 + y^2');
      const code = python.compileFunction(expr, 'distance_squared', ['x', 'y']);

      expect(code).toContain('def distance_squared(x, y):');
      expect(code).toContain('return x ** 2 + y ** 2');
    });

    it('should generate function with docstring', () => {
      const expr = ce.parse('\\sqrt{x^2 + y^2}');
      const code = python.compileFunction(
        expr,
        'euclidean_distance',
        ['x', 'y'],
        'Calculate Euclidean distance between two points'
      );

      expect(code).toContain('def euclidean_distance(x, y):');
      expect(code).toContain(
        '"""Calculate Euclidean distance between two points"""'
      );
      expect(code).toContain('return np.sqrt(x ** 2 + y ** 2)');
    });

    it('should generate function with imports when requested', () => {
      const expr = ce.parse('\\sin(x) + \\cos(x)');
      const code = pythonWithImports.compileFunction(expr, 'trig_sum', ['x']);

      expect(code).toContain('import numpy as np');
      expect(code).toContain('def trig_sum(x):');
      expect(code).toContain('return np.sin(x) + np.cos(x)');
    });
  });

  describe('Lambda Functions', () => {
    it('should generate lambda function', () => {
      const expr = ce.parse('x^2');
      const code = python.compileLambda(expr, ['x']);

      expect(code).toBe('lambda x: x ** 2');
    });

    it('should generate multi-parameter lambda', () => {
      const expr = ce.parse('x + y + z');
      const code = python.compileLambda(expr, ['x', 'y', 'z']);

      expect(code).toBe('lambda x, y, z: x + y + z');
    });
  });

  describe('Block / Declare (bare statement block, not JS IIFE)', () => {
    it('compiles a value-carrying Declare block to a valid def', () => {
      // Declare(t, 'real', x*x) — the empty `declare` hook is filtered; the
      // value rides on a separate `t = x * x` assignment. The block hook puts
      // `return` on the last statement.
      const expr = ce.box([
        'Block',
        ['Declare', 't', { str: 'real' }, ['Multiply', 'x', 'x']],
        ['Add', 't', 1],
      ]);
      const code = python.compileFunction(expr, 'f', ['x']);
      expect(code).toBe('def f(x):\n    t = x * x\n    return t + 1\n');
    });

    it('compiles an Assign block to a valid def', () => {
      const expr = ce.box([
        'Block',
        ['Assign', 't', ['Multiply', 'x', 'x']],
        ['Add', 't', 1],
      ]);
      const code = python.compileFunction(expr, 'g', ['x']);
      expect(code).toBe('def g(x):\n    t = x * x\n    return t + 1\n');
    });

    it('fails closed (D6) when a Block is used as a sub-expression', () => {
      const block = ce.box([
        'Block',
        ['Assign', 't', ['Multiply', 'x', 'x']],
        ['Add', 't', 1],
      ]);
      expect(() => python.compile(ce.box(['Add', 1, block]))).toThrow(/Block/);
    });

    it('fails closed when a Block is a function argument', () => {
      const block = ce.box([
        'Block',
        ['Assign', 't', ['Multiply', 'x', 'x']],
        ['Add', 't', 1],
      ]);
      expect(() => python.compile(ce.box(['Sin', block]))).toThrow(/Block/);
    });

    it('rejects a Block body for compileLambda', () => {
      const block = ce.box([
        'Block',
        ['Assign', 't', ['Multiply', 'x', 'x']],
        ['Add', 't', 1],
      ]);
      expect(() => python.compileLambda(block, ['x'])).toThrow(/lambda/);
    });
  });

  describe('Real-World Formulas', () => {
    it('should compile distance formula', () => {
      const expr = ce.parse('\\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}');
      const code = python.compile(expr).code;

      expect(code).toContain('np.sqrt');
      expect(code).toContain('**');
    });

    it('should compile quadratic formula', () => {
      const expr = ce.parse('\\frac{-b + \\sqrt{b^2 - 4ac}}{2a}');
      const code = python.compile(expr).code;

      expect(code).toContain('np.sqrt');
      expect(code).toContain('b ** 2');
    });

    it('should compile kinematics formula', () => {
      const expr = ce.parse('u \\cdot t + \\frac{1}{2} a \\cdot t^2');
      const code = python.compile(expr).code;

      // Terms may be reordered during canonicalization
      expect(code).toContain('t * u');
      expect(code).toContain('0.5 * a * t ** 2');
    });

    it('should compile Gaussian distribution', () => {
      const expr = ce.parse(
        '\\frac{1}{\\sqrt{2\\pi}\\sigma} \\exp\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)'
      );
      const code = python.compile(expr).code;

      expect(code).toContain('np.sqrt');
      // \exp is canonicalized to e^
      expect(code).toContain('np.e **');
      expect(code).toContain('np.pi');
    });
  });

  describe('Linear Algebra', () => {
    it('should compile dot product', () => {
      const expr = ce.parse('a \\cdot b');
      const code = python.compile(expr).code;

      // This will depend on how the parser interprets \cdot
      // It might be multiplication or dot product
      expect(code).toMatch(/a \* b|np\.dot\(a, b\)/);
    });

    it('should compile vector norm', () => {
      const expr = ce.parse('\\sqrt{x^2 + y^2 + z^2}');
      const code = python.compile(expr).code;

      expect(code).toBe('np.sqrt(x ** 2 + y ** 2 + z ** 2)');
    });
  });

  describe('Code with Imports', () => {
    it('should include numpy import when requested', () => {
      const expr = ce.parse('\\sin(x)');
      const code = pythonWithImports.compile(expr).code;

      expect(code).toContain('import numpy as np');
      expect(code).toContain('np.sin(x)');
    });

    it('should work without imports by default', () => {
      const expr = ce.parse('\\cos(x)');
      const code = python.compile(expr).code;

      expect(code).not.toContain('import');
      expect(code).toBe('np.cos(x)');
    });
  });

  describe('Complex Numbers', () => {
    it('should compile complex literal', () => {
      const expr = ce.expr(['Complex', 3, 2]);
      expect(python.compile(expr).code).toBe('complex(3, 2)');
    });

    it('should compile pure imaginary literal', () => {
      const expr = ce.expr(['Complex', 0, 1]);
      expect(python.compile(expr).code).toBe('complex(0, 1)');
    });

    it('should compile ImaginaryUnit', () => {
      const expr = ce.expr('ImaginaryUnit');
      expect(python.compile(expr).code).toBe('1j');
    });

    it('should use cmath.sin for complex sin', () => {
      const expr = ce.expr(['Sin', ['Complex', 0, 1]]);
      expect(python.compile(expr).code).toBe('cmath.sin(complex(0, 1))');
    });

    it('should use np.sin for real sin', () => {
      const expr = ce.expr(['Sin', 'x']);
      expect(python.compile(expr).code).toBe('np.sin(x)');
    });

    it('should use cmath.cos for complex cos', () => {
      const expr = ce.expr(['Cos', ['Complex', 1, 2]]);
      expect(python.compile(expr).code).toBe('cmath.cos(complex(1, 2))');
    });

    it('should use np.cos for real cos', () => {
      const expr = ce.expr(['Cos', 'x']);
      expect(python.compile(expr).code).toBe('np.cos(x)');
    });

    it('should use cmath.tan for complex tan', () => {
      const expr = ce.expr(['Tan', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.tan(complex(1, 1))');
    });

    it('should compile complex exp (canonicalized to Power)', () => {
      // Exp is canonicalized to Power(ExponentialE, x), so complex exp
      // goes through the Power path with ** operator
      const expr = ce.expr(['Exp', ['Complex', 0, Math.PI]]);
      const code = python.compile(expr).code;
      expect(code).toContain('np.e');
      expect(code).toContain('**');
      expect(code).toContain(`complex(0, ${Math.PI})`);
    });

    it('should compile real exp (canonicalized to Power)', () => {
      // Exp is canonicalized to Power(ExponentialE, x)
      const expr = ce.expr(['Exp', 'x']);
      expect(python.compile(expr).code).toBe('np.e ** x');
    });

    it('should use cmath.log for complex ln', () => {
      const expr = ce.expr(['Ln', ['Complex', 0, 1]]);
      expect(python.compile(expr).code).toBe('cmath.log(complex(0, 1))');
    });

    it('should use cmath.sqrt for complex sqrt', () => {
      const expr = ce.expr(['Sqrt', ['Complex', 0, 1]]);
      expect(python.compile(expr).code).toBe('cmath.sqrt(complex(0, 1))');
    });

    it('should use np.sqrt for real sqrt', () => {
      const expr = ce.parse('\\sqrt{x}');
      expect(python.compile(expr).code).toBe('np.sqrt(x)');
    });

    it('should use ** for complex power', () => {
      // Use an inexact complex base: since D12-A an exact Gaussian power
      // folds at canonicalization ((1+i)² → 2i), leaving no Power to compile.
      const expr = ce.expr(['Power', ['Complex', 1.5, 1], 2]);
      const code = python.compile(expr).code;
      expect(code).toContain('complex(1.5, 1)');
      expect(code).toContain('**');
    });

    it('should use ** for real power (via operator table)', () => {
      // Real Power goes through the operator table (** with prec 15)
      const expr = ce.expr(['Power', 'x', 3]);
      expect(python.compile(expr).code).toBe('x ** 3');
    });

    it('should use abs() for complex abs', () => {
      const expr = ce.expr(['Abs', ['Complex', 3, 4]]);
      expect(python.compile(expr).code).toBe('abs(complex(3, 4))');
    });

    it('should use np.abs for real abs', () => {
      const expr = ce.parse('|x|');
      expect(python.compile(expr).code).toBe('np.abs(x)');
    });

    it('should compile complex addition (native operators)', () => {
      // Use inexact complex literals: since D12-A exact Gaussian operands
      // fold to a single literal at canonicalization, leaving no addition
      // to compile.
      const expr = ce.expr(['Add', ['Complex', 1.5, 2], ['Complex', 3, 4.5]]);
      const code = python.compile(expr).code;
      expect(code).toContain('complex(1.5, 2)');
      expect(code).toContain('+');
      expect(code).toContain('complex(3, 4.5)');
    });

    it('should use cmath.asin for complex arcsin', () => {
      const expr = ce.expr(['Arcsin', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.asin(complex(1, 1))');
    });

    it('should use cmath.acos for complex arccos', () => {
      const expr = ce.expr(['Arccos', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.acos(complex(1, 1))');
    });

    it('should use cmath.atan for complex arctan', () => {
      const expr = ce.expr(['Arctan', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.atan(complex(1, 1))');
    });

    it('should use cmath.sinh for complex sinh', () => {
      const expr = ce.expr(['Sinh', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.sinh(complex(1, 1))');
    });

    it('should use cmath.cosh for complex cosh', () => {
      const expr = ce.expr(['Cosh', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.cosh(complex(1, 1))');
    });

    it('should use cmath.tanh for complex tanh', () => {
      const expr = ce.expr(['Tanh', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.tanh(complex(1, 1))');
    });

    it('should include cmath import when imports are enabled', () => {
      const pythonImports = new PythonTarget({ includeImports: true });
      const expr = ce.expr(['Sin', ['Complex', 0, 1]]);
      const code = pythonImports.compile(expr).code;
      expect(code).toContain('import cmath');
      expect(code).toContain('cmath.sin(complex(0, 1))');
    });
  });

  describe('Edge Cases', () => {
    it('should handle division by constants', () => {
      const expr = ce.parse('x / 2');
      const code = python.compile(expr).code;
      // Division by constant is canonicalized to multiplication
      expect(code).toBe('0.5 * x');
    });

    it('should handle negative exponents', () => {
      const expr = ce.parse('x^{-1}');
      const code = python.compile(expr).code;
      // Negative exponents are canonicalized to division
      expect(code).toBe('1 / x');
    });

    it('should handle nested power', () => {
      const expr = ce.parse('(x^2)^3');
      const code = python.compile(expr).code;
      // Nested powers are compiled: (x^2)^3 = x^(2*3) = x^6
      expect(code).toBe('x ** 6');
    });
  });

  // Regressions for the WP-2.8 compilation P0 cluster (Python target side).
  describe('WP-2.8 P0 regressions', () => {
    it('parenthesizes a negative base under ** (P0-46)', () => {
      // `-2 ** x` parses as `-(2 ** x)` in Python — sign-flipped. Must emit
      // `(-2) ** x`.
      const code = python.compile(ce.box(['Power', -2, 'x'])).code;
      expect(code).toBe('(-2) ** x');
    });

    it('Remainder is round-to-nearest, not np.remainder (P0-7)', () => {
      const code = python.compile(ce.box(['Remainder', 'a', 'b'])).code;
      expect(code).not.toContain('np.remainder');
      expect(code).toBe('(a - b * np.round(a / b))');
    });

    it('Round is half-away-from-zero, not np.round banker (P0-41)', () => {
      const code = python.compile(ce.box(['Round', 'x'])).code;
      expect(code).toBe('(np.sign(x) * np.floor(np.abs(x) + 0.5))');
    });

    it('Arccot uses the (0, π) branch (P0-42)', () => {
      const code = python.compile(ce.box(['Arccot', 'x'])).code;
      expect(code).toBe('(np.pi / 2 - np.arctan(x))');
    });

    it('odd roots are sign-corrected for negative bases (P0-42)', () => {
      const code = python.compile(ce.box(['Root', 'x', 5])).code;
      expect(code).toBe('(np.sign(x) * np.power(np.abs(x), 1.0 / 5))');
    });
  });

  // CO-P1-1: the Python target emitted JS-style ternaries, bare `NaN`,
  // `and(a, b)` keyword-as-function calls, and `&&` chains — all Python
  // SyntaxErrors — and ignored `vars` / never folded assigned symbols.
  describe('CO-P1-1 control flow, logic, folding', () => {
    it('If emits a Python conditional expression', () => {
      const code = python.compile(
        ce.box(['If', ['Greater', 'x', 0], 1, ['Negate', 'x']])
      ).code;
      expect(code).toBe('((1) if (0 < x) else (-x))');
    });

    it('Which emits nested Python conditional expressions', () => {
      const code = python.compile(
        ce.box(['Which', ['Less', 'x', 0], -1, 'True', 1])
      ).code;
      expect(code).toBe('((-1) if (x < 0) else (1))');
    });

    it('When with no default uses float(nan), not a bare NaN', () => {
      const code = python.compile(
        ce.box(['When', 'x', ['Greater', 'x', 0]])
      ).code;
      expect(code).toBe("((x) if (0 < x) else float('nan'))");
      expect(code).not.toContain('NaN');
    });

    it('And is an infix keyword, not an `and(a, b)` call', () => {
      const code = python.compile(
        ce.box(['And', ['Greater', 'x', 0], ['Less', 'x', 10]])
      ).code;
      expect(code).toBe('0 < x and x < 10');
      expect(code).not.toContain('and(');
    });

    it('Or is an infix keyword', () => {
      const code = python.compile(
        ce.box(['Or', ['Greater', 'x', 0], ['Less', 'x', -10]])
      ).code;
      expect(code).toBe('0 < x or x < -10');
    });

    it('Not is a prefix keyword with a space', () => {
      const code = python.compile(ce.box(['Not', ['Greater', 'x', 0]])).code;
      expect(code).toBe('not (0 < x)');
      expect(code).not.toContain('not(');
    });

    it('relational chains conjoin with `and`, not `&&`', () => {
      const code = python.compile(ce.box(['Less', 'a', 'b', 'c'])).code;
      expect(code).toBe('(a < b) and (b < c)');
      expect(code).not.toContain('&&');
    });

    it('folds an assigned symbol into the code (like the JS target)', () => {
      const scoped = new ComputeEngine();
      scoped.assign('k', 5);
      const code = python.compile(scoped.box(['Multiply', 'k', 'x'])).code;
      expect(code).toBe('5 * x');
    });

    it('honors a `vars` mapping over folding', () => {
      const scoped = new ComputeEngine();
      scoped.assign('k', 5);
      const code = python.compile(scoped.box(['Multiply', 'k', 'x']), {
        vars: { k: 9 } as any,
      }).code;
      expect(code).toBe('9 * x');
    });
  });

  // CO-P1-4: compiled Equal used exact `==`; the interpreter compares within
  // engine.tolerance (default 1e-10).
  describe('CO-P1-4 tolerance-aware equality', () => {
    it('Equal bakes the engine tolerance', () => {
      const code = python.compile(
        ce.box(['Equal', ['Add', 0.1, 0.2], 0.3])
      ).code;
      expect(code).toBe('(abs((0.1 + 0.2) - (0.3)) <= 1e-10)');
    });

    it('NotEqual uses the tolerance complement', () => {
      const code = python.compile(ce.box(['NotEqual', 'x', 0.3])).code;
      expect(code).toBe('(abs((x) - (0.3)) > 1e-10)');
    });
  });

  // CO-P1-3: a complex argument into a real-only helper returned garbage.
  describe('CO-P1-3 complex into a real-only helper fails closed (D6)', () => {
    it('Erf of a complex value throws with the offending head', () => {
      const scoped = new ComputeEngine();
      scoped.declare('z', 'complex');
      expect(() => python.compile(scoped.box(['Erf', 'z'])).code).toThrow(
        /Erf: real-only target helper/
      );
    });

    it('Real / Conjugate of a complex value are allowed (complex-transparent)', () => {
      const scoped = new ComputeEngine();
      scoped.declare('z', 'complex');
      expect(python.compile(scoped.box(['Real', 'z'])).code).toBe('np.real(z)');
      expect(python.compile(scoped.box(['Conjugate', 'z'])).code).toBe(
        'np.conj(z)'
      );
    });
  });

  // GammaRegularized(a, z) = Q(a, z); scipy's gammaincc(a, z) matches our
  // argument order directly. BetaRegularized(x, a, b) = I_x(a, b), but
  // scipy.special.betainc(a, b, x) takes a DIFFERENT argument order — the
  // Python target must reorder when emitting the call.
  describe('Regularized incomplete gamma / beta', () => {
    it('GammaRegularized maps straight through to scipy.special.gammaincc', () => {
      const code = python.compile(ce.box(['GammaRegularized', 3, 'x'])).code;
      expect(code).toBe('scipy.special.gammaincc(3, x)');
    });

    it('BetaRegularized reorders (x, a, b) to scipy.special.betainc(a, b, x)', () => {
      const code = python.compile(
        ce.box(['BetaRegularized', 'x', 2, 3])
      ).code;
      expect(code).toBe('scipy.special.betainc(2, 3, x)');
    });
  });

  // Indexed Sum/Product compile to single Python generator expressions
  // (builtin `sum` / `math.prod`), so they compose everywhere. The engine's
  // inclusive upper bound maps to Python's exclusive `range` upper (`b + 1`).
  describe('Sum / Product → generator expressions', () => {
    it('numeric-bound Sum via compileFunction', () => {
      const expr = ce.parse('\\sum_{k=0}^{3} k^2');
      const code = python.compileFunction(expr, 'f', []);
      expect(code).toBe('def f():\n    return sum(k ** 2 for k in range(0, 4))\n');
    });

    it('symbolic-bound Sum keeps the bound symbolic (b + 1)', () => {
      const expr = ce.parse('\\sum_{i=1}^{n} i^2');
      expect(python.compile(expr).code).toBe(
        'sum(i ** 2 for i in range(1, n + 1))'
      );
    });

    it('Sum nested inside a larger expression', () => {
      const expr = ce.parse('1 + \\sum_{i=1}^{n} i');
      expect(python.compile(expr).code).toBe(
        'sum(i for i in range(1, n + 1)) + 1'
      );
    });

    it('Product compiles to math.prod', () => {
      const expr = ce.parse('\\prod_{k=1}^{4} k');
      expect(python.compile(expr).code).toBe(
        'math.prod(k for k in range(1, 5))'
      );
    });

    it('Product emits `import math` in the compile() output with imports', () => {
      const expr = ce.parse('\\prod_{k=1}^{n} k');
      const code = pythonWithImports.compile(expr).code;
      expect(code).toContain('import math');
      expect(code).toContain('math.prod(k for k in range(1, n + 1))');
    });

    it('empty/reversed range relies on Python range semantics', () => {
      // range(5, 4) is empty → sum() == 0, math.prod() == 1 (matches the
      // interpreter's empty-range identities).
      expect(python.compile(ce.parse('\\sum_{k=5}^{3} k')).code).toBe(
        'sum(k for k in range(5, 4))'
      );
      expect(python.compile(ce.parse('\\prod_{k=5}^{3} k')).code).toBe(
        'math.prod(k for k in range(5, 4))'
      );
    });

    it('multi-index Sum emits nested generator clauses', () => {
      const expr = ce.box([
        'Sum',
        ['Multiply', 'i', 'j'],
        ['Limits', 'i', 1, 3],
        ['Limits', 'j', 1, 3],
      ]);
      expect(python.compile(expr).code).toBe(
        'sum(i * j for i in range(1, 4) for j in range(1, 4))'
      );
    });

    it('composes as a lambda body', () => {
      const expr = ce.parse('\\sum_{i=1}^{n} i^2');
      expect(python.compileLambda(expr, ['n'])).toBe(
        'lambda n: sum(i ** 2 for i in range(1, n + 1))'
      );
    });
  });

  // Loop compiles to a Python statement loop (`while True:` / `for … in
  // range(…):`), not the base compiler's JS `for`-IIFE.
  describe('Loop → statement loops', () => {
    it('accumulator pattern compiles to a valid def', () => {
      const expr = ce.box([
        'Block',
        ['Assign', 'acc', 0],
        [
          'Loop',
          ['Assign', 'acc', ['Add', 'acc', 'i']],
          ['Element', 'i', ['Range', 1, 5]],
        ],
        'acc',
      ]);
      const code = python.compileFunction(expr, 'f', []);
      expect(code).toBe(
        'def f():\n' +
          '    acc = 0\n' +
          '    for i in range(1, 6):\n' +
          '        acc = acc + i\n' +
          '    return acc\n'
      );
      expect(code).not.toContain('=>');
      expect(code).not.toContain('})()');
    });

    it('Loop body may be a multi-line Block (indented, no return)', () => {
      const expr = ce.box([
        'Block',
        ['Assign', 's', 0],
        [
          'Loop',
          [
            'Block',
            ['Assign', 's', ['Add', 's', 'i']],
            ['Assign', 's', ['Multiply', 's', 2]],
          ],
          ['Element', 'i', ['Range', 1, 3]],
        ],
        's',
      ]);
      const code = python.compileFunction(expr, 'm', []);
      expect(code).toBe(
        'def m():\n' +
          '    s = 0\n' +
          '    for i in range(1, 4):\n' +
          '        s = i + s\n' +
          '        s = 2 * s\n' +
          '    return s\n'
      );
      expect(code).not.toContain('return s = ');
    });

    it('bare Loop compiles to `while True:`', () => {
      // A bare Loop as the whole function body goes through compileFunction's
      // multi-line branch directly (no Block, so no block hook / return None):
      // the def implicitly returns None.
      const expr = ce.box(['Loop', ['Assign', 'acc', ['Add', 'acc', 1]]]);
      const code = python.compileFunction(expr, 'b', ['acc']);
      expect(code).toBe(
        'def b(acc):\n    while True:\n        acc = acc + 1\n'
      );
    });

    it('Loop as the final statement of a Block appends `return None`', () => {
      // The block hook must NOT return-prefix a `for`/`while` statement (that
      // would be `return for …:` — a SyntaxError). Instead the Block evaluates
      // to None (the Loop's Nothing value).
      const expr = ce.box([
        'Block',
        ['Assign', 'acc', 0],
        [
          'Loop',
          ['Assign', 'acc', ['Add', 'acc', 'i']],
          ['Element', 'i', ['Range', 1, 5]],
        ],
      ]);
      const code = python.compileFunction(expr, 'g', []);
      expect(code).toBe(
        'def g():\n' +
          '    acc = 0\n' +
          '    for i in range(1, 6):\n' +
          '        acc = acc + i\n' +
          '    return None\n'
      );
      expect(code).not.toMatch(/return for/);
    });

    it('expression-position Loop fails closed (D6)', () => {
      const loop = ce.box([
        'List',
        [
          'Loop',
          ['Assign', 'acc', 'i'],
          ['Element', 'i', ['Range', 1, 5]],
        ],
      ]);
      expect(() => python.compile(loop)).toThrow(/Loop/);
    });

    it('a Loop body cannot be a compileLambda body', () => {
      const loop = ce.box([
        'Loop',
        ['Assign', 'acc', 'i'],
        ['Element', 'i', ['Range', 1, 5]],
      ]);
      expect(() => python.compileLambda(loop, [])).toThrow(/lambda/);
    });
  });

  // Statement-position control flow inside a loop body: `If` containing
  // `Break`/`Continue`/`Return` must compile to a Python `if` STATEMENT (not
  // the expression-If's `(then) if (cond) else (else)`, a SyntaxError). This is
  // how Cortex lowers `while`: `Loop(Block(If(cond, Break), …))`.
  describe('Loop body → statement-position control flow', () => {
    it('while-pattern: If(cond, Break) compiles to an `if …:` statement', () => {
      const expr = ce.box([
        'Block',
        ['Assign', 's', 0],
        ['Assign', 'k', 1],
        [
          'Loop',
          [
            'Block',
            ['If', ['GreaterEqual', 'k', 5], ['Break']],
            ['Assign', 's', ['Add', 's', 'k']],
            ['Assign', 'k', ['Add', 'k', 1]],
          ],
        ],
        's',
      ]);
      const code = python.compileFunction(expr, 'f', []);
      expect(code).toBe(
        'def f():\n' +
          '    s = 0\n' +
          '    k = 1\n' +
          '    while True:\n' +
          '        if 5 <= k:\n' +
          '            break\n' +
          '        s = k + s\n' +
          '        k = k + 1\n' +
          '    return s\n'
      );
      // The If compiled to a statement, not `(break) if (…) else …` (a
      // SyntaxError); the loop is a `while`, not a JS IIFE.
      expect(code).not.toContain('=>');
      expect(code).not.toMatch(/return for|return while/);
    });

    it('If/else with Continue in one branch', () => {
      const expr = ce.box([
        'Loop',
        [
          'Block',
          [
            'If',
            ['Greater', 'k', 2],
            ['Continue'],
            ['Assign', 's', ['Add', 's', 'k']],
          ],
        ],
        ['Element', 'k', ['Range', 1, 5]],
      ]);
      const code = python.compileFunction(expr, 'g', ['s']);
      expect(code).toBe(
        'def g(s):\n' +
          '    for k in range(1, 6):\n' +
          '        if 2 < k:\n' +
          '            continue\n' +
          '        else:\n' +
          '            s = k + s\n'
      );
    });

    it('nested Loop inside a Loop body', () => {
      const expr = ce.box([
        'Loop',
        [
          'Loop',
          ['Assign', 's', ['Add', 's', ['Multiply', 'a', 'b']]],
          ['Element', 'b', ['Range', 1, 3]],
        ],
        ['Element', 'a', ['Range', 1, 3]],
      ]);
      const code = python.compileFunction(expr, 'h', ['s']);
      expect(code).toBe(
        'def h(s):\n' +
          '    for a in range(1, 4):\n' +
          '        for b in range(1, 4):\n' +
          '            s = a * b + s\n'
      );
    });

    it('Return inside a Loop within a compileFunction def', () => {
      const expr = ce.box([
        'Loop',
        [
          'Block',
          ['If', ['GreaterEqual', 'k', 3], ['Return', 'k']],
          ['Assign', 'k', ['Add', 'k', 1]],
        ],
      ]);
      const code = python.compileFunction(expr, 'r', ['k']);
      expect(code).toBe(
        'def r(k):\n' +
          '    while True:\n' +
          '        if 3 <= k:\n' +
          '            return k\n' +
          '        k = k + 1\n'
      );
    });
  });
});
