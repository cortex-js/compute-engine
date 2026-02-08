import { engine as ce } from '../utils';
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
      // Nested powers are compiled correctly
      expect(code).toBe('x ** (2 * 3)');
    });
  });
});
