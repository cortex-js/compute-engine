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

  describe('Complex Numbers', () => {
    it('should compile complex literal', () => {
      const expr = ce.box(['Complex', 3, 2]);
      expect(python.compile(expr).code).toBe('complex(3, 2)');
    });

    it('should compile pure imaginary literal', () => {
      const expr = ce.box(['Complex', 0, 1]);
      expect(python.compile(expr).code).toBe('complex(0, 1)');
    });

    it('should compile ImaginaryUnit', () => {
      const expr = ce.box('ImaginaryUnit');
      expect(python.compile(expr).code).toBe('1j');
    });

    it('should use cmath.sin for complex sin', () => {
      const expr = ce.box(['Sin', ['Complex', 0, 1]]);
      expect(python.compile(expr).code).toBe('cmath.sin(complex(0, 1))');
    });

    it('should use np.sin for real sin', () => {
      const expr = ce.box(['Sin', 'x']);
      expect(python.compile(expr).code).toBe('np.sin(x)');
    });

    it('should use cmath.cos for complex cos', () => {
      const expr = ce.box(['Cos', ['Complex', 1, 2]]);
      expect(python.compile(expr).code).toBe('cmath.cos(complex(1, 2))');
    });

    it('should use np.cos for real cos', () => {
      const expr = ce.box(['Cos', 'x']);
      expect(python.compile(expr).code).toBe('np.cos(x)');
    });

    it('should use cmath.tan for complex tan', () => {
      const expr = ce.box(['Tan', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.tan(complex(1, 1))');
    });

    it('should compile complex exp (canonicalized to Power)', () => {
      // Exp is canonicalized to Power(ExponentialE, x), so complex exp
      // goes through the Power path with ** operator
      const expr = ce.box(['Exp', ['Complex', 0, Math.PI]]);
      const code = python.compile(expr).code;
      expect(code).toContain('np.e');
      expect(code).toContain('**');
      expect(code).toContain(`complex(0, ${Math.PI})`);
    });

    it('should compile real exp (canonicalized to Power)', () => {
      // Exp is canonicalized to Power(ExponentialE, x)
      const expr = ce.box(['Exp', 'x']);
      expect(python.compile(expr).code).toBe('np.e ** x');
    });

    it('should use cmath.log for complex ln', () => {
      const expr = ce.box(['Ln', ['Complex', 0, 1]]);
      expect(python.compile(expr).code).toBe('cmath.log(complex(0, 1))');
    });

    it('should use cmath.sqrt for complex sqrt', () => {
      const expr = ce.box(['Sqrt', ['Complex', 0, 1]]);
      expect(python.compile(expr).code).toBe('cmath.sqrt(complex(0, 1))');
    });

    it('should use np.sqrt for real sqrt', () => {
      const expr = ce.parse('\\sqrt{x}');
      expect(python.compile(expr).code).toBe('np.sqrt(x)');
    });

    it('should use ** for complex power', () => {
      const expr = ce.box(['Power', ['Complex', 1, 1], 2]);
      const code = python.compile(expr).code;
      expect(code).toContain('complex(1, 1)');
      expect(code).toContain('**');
    });

    it('should use ** for real power (via operator table)', () => {
      // Real Power goes through the operator table (** with prec 15)
      const expr = ce.box(['Power', 'x', 3]);
      expect(python.compile(expr).code).toBe('x ** 3');
    });

    it('should use abs() for complex abs', () => {
      const expr = ce.box(['Abs', ['Complex', 3, 4]]);
      expect(python.compile(expr).code).toBe('abs(complex(3, 4))');
    });

    it('should use np.abs for real abs', () => {
      const expr = ce.parse('|x|');
      expect(python.compile(expr).code).toBe('np.abs(x)');
    });

    it('should compile complex addition (native operators)', () => {
      const expr = ce.box(['Add', ['Complex', 1, 2], ['Complex', 3, 4]]);
      const code = python.compile(expr).code;
      expect(code).toContain('complex(1, 2)');
      expect(code).toContain('+');
      expect(code).toContain('complex(3, 4)');
    });

    it('should use cmath.asin for complex arcsin', () => {
      const expr = ce.box(['Arcsin', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.asin(complex(1, 1))');
    });

    it('should use cmath.acos for complex arccos', () => {
      const expr = ce.box(['Arccos', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.acos(complex(1, 1))');
    });

    it('should use cmath.atan for complex arctan', () => {
      const expr = ce.box(['Arctan', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.atan(complex(1, 1))');
    });

    it('should use cmath.sinh for complex sinh', () => {
      const expr = ce.box(['Sinh', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.sinh(complex(1, 1))');
    });

    it('should use cmath.cosh for complex cosh', () => {
      const expr = ce.box(['Cosh', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.cosh(complex(1, 1))');
    });

    it('should use cmath.tanh for complex tanh', () => {
      const expr = ce.box(['Tanh', ['Complex', 1, 1]]);
      expect(python.compile(expr).code).toBe('cmath.tanh(complex(1, 1))');
    });

    it('should include cmath import when imports are enabled', () => {
      const pythonImports = new PythonTarget({ includeImports: true });
      const expr = ce.box(['Sin', ['Complex', 0, 1]]);
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
});
