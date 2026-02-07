import { engine as ce } from '../utils';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { IntervalGLSLTarget } from '../../src/compute-engine/compilation/interval-glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

describe('COMPILE', () => {
  describe('Expressions', () => {
    it('should compile (and simplify) a simple expression', () => {
      expect(
        ce.parse('3.45 + \\frac57').compile()?.toString()
      ).toMatchInlineSnapshot(`0.7142857142857143 + 3.45`);
    });

    it('should compile an expression with a constant', () => {
      expect(
        ce.parse('2\\exponentialE').compile()?.toString()
      ).toMatchInlineSnapshot(`2 * Math.E`);
    });

    it('should compile an expression with trig functions', () => {
      expect(
        ce.parse('2 \\cos(\\frac{\\pi}{5})').compile()?.toString()
      ).toMatchInlineSnapshot(`2 * Math.cos(0.2 * Math.PI)`);
    });
  });

  describe('Blocks', () => {
    it('should compile a simple block', () => {
      const expr = ce.box(['Block', ['Multiply', 10, 2]]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`2 * 10`);
    });

    it('should compile a block with two statements', () => {
      const expr = ce.box(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        13 + 15;
        return 2 * 10
        })()
      `);
    });

    it('should compile a block with a declaration', () => {
      const expr = ce.box([
        'Block',
        ['Declare', 'x', 'Numbers'],
        ['Assign', 'x', 4.1],
        ['Multiply', 'x', 'n'],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        let x;
        x = 4.1;
        return _.n * x
        })()
      `);
    });

    it('should compile a block with a return statement', () => {
      const expr = ce.box([
        'Block',
        ['Declare', 'x', 'Numbers'],
        ['Assign', 'x', 4.1],
        ['Return', ['Add', 'x', 1]],
        ['Multiply', 'x', 2],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        let x;
        x = 4.1;
        return x + 1;
        return 2 * x
        })()
      `);
    });
  });

  describe('Imported Functions', () => {
    ce.declare('Foo', {
      signature: '(number) -> number',
      evaluate: ([x]) => ce.box(['Add', x, 1]),
    });

    it('should compile a function imported inline', () => {
      const fn = ce.box(['Foo', 3]).compile({
        functions: { Foo: (x) => x + 1 },
      })!;
      expect(fn()).toBe(4);
    });

    it('should compile a function referenced by name', () => {
      function foo(x) {
        return x + 1;
      }
      const fn = ce.box(['Foo', 3]).compile({
        functions: { Foo: foo },
      })!;
      expect(fn()).toBe(4);
    });

    it('should compile a function imported by name', () => {
      function foo(x) {
        return x + 1;
      }
      const fn = ce.box(['Foo', 3]).compile({
        functions: { Foo: 'foo' },
        imports: [foo],
      })!;
      expect(fn()).toBe(4);
    });
  });

  describe('Conditionals / Ifs', () => {
    it('should compile an if statement', () => {
      const expr = ce.box(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });

    it('should compile an if statement with blocks', () => {
      const expr = ce.box([
        'If',
        ['Greater', 'x', 0],
        ['Block', 'x'],
        ['Block', ['Negate', 'x']],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });
  });

  describe('Custom Operators', () => {
    describe('Object-based operator overrides', () => {
      it('should override a single operator', () => {
        const expr = ce.parse('x + y');
        const compiled = expr.compile({
          operators: { Add: ['add', 11] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, _.y)`
        );
      });

      it('should override multiple operators', () => {
        const expr = ce.parse('x + y * z');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(mul(_.y, _.z), _.x)`
        );
      });

      it('should handle division override', () => {
        const expr = ce.parse('x / y');
        const compiled = expr.compile({
          operators: { Divide: ['div', 13] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `div(_.x, _.y)`
        );
      });

      it('should override unary operators', () => {
        const expr = ce.parse('-x');
        const compiled = expr.compile({
          operators: { Negate: ['neg', 14] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(`neg(_.x)`);
      });

      it('should handle subtraction with Negate override', () => {
        // Note: Subtraction is canonicalized to Add(x, Negate(y))
        const expr = ce.parse('x - y');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Negate: ['neg', 14],
          },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, neg(_.y))`
        );
      });

      it('should use default operators for non-overridden operators', () => {
        const expr = ce.parse('x + y - z');
        const compiled = expr.compile({
          operators: { Add: ['add', 11] },
        });
        // Note: Subtraction is canonicalized to Add(x, y, Negate(z))
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, _.y, -_.z)`
        );
      });
    });

    describe('Function-based operator overrides', () => {
      it('should override using a function', () => {
        const expr = ce.parse('x + y');
        const compiled = expr.compile({
          operators: (op) => (op === 'Add' ? ['add', 11] : undefined),
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.x, _.y)`
        );
      });

      it('should fall back to defaults when function returns undefined', () => {
        const expr = ce.parse('x + y * z');
        const compiled = expr.compile({
          operators: (op) => (op === 'Add' ? ['add', 11] : undefined),
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.y * _.z, _.x)`
        );
      });
    });

    describe('Vector/matrix operations use case', () => {
      it('should compile vector addition to function call', () => {
        // Use case from Issue #240
        const expr = ce.box(['Add', ['List', 1, 1, 1], ['List', 1, 1, 1]]);
        const compiled = expr.compile({
          operators: { Add: ['add', 11] },
        });
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add([1, 1, 1], [1, 1, 1])`
        );
      });

      it('should execute vector operations with custom functions', () => {
        function add(a, b) {
          return a.map((v, i) => v + b[i]);
        }
        function mul(a, b) {
          return a.map((v, i) => v * b[i]);
        }

        const expr = ce.box([
          'Add',
          ['List', 1, 2, 3],
          ['Multiply', ['List', 2, 3, 4], ['List', 1, 1, 1]],
        ]);

        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
          functions: { add, mul },
        });

        const result = compiled?.();
        expect(result).toEqual([3, 5, 7]);
      });
    });

    describe('Complex expressions with operator overrides', () => {
      it('should handle nested expressions', () => {
        const expr = ce.parse('(x + y) * (z + w)');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `mul(add(_.w, _.z), add(_.x, _.y))`
        );
      });

      it('should handle expressions with multiple operator types', () => {
        const expr = ce.parse('x + y - z * w / v');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
            Divide: ['div', 13],
            Negate: ['neg', 14],
          },
        });
        // Note: Subtraction is canonicalized to Add with Negate
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(neg(mul(_.z, div(_.w, _.v))), _.x, _.y)`
        );
      });
    });

    describe('Precedence handling with custom operators', () => {
      it('should respect custom precedence', () => {
        const expr = ce.parse('x + y * z');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 20], // Higher precedence than multiply
            Multiply: ['mul', 10],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(mul(_.y, _.z), _.x)`
        );
      });
    });

    describe('Partial overrides', () => {
      it('should allow overriding only some operators', () => {
        const expr = ce.parse('a + b * c - d / g');
        const compiled = expr.compile({
          operators: {
            Add: ['add', 11],
            // Multiply, Negate, Divide use defaults
          },
        });
        // Note: Subtraction is canonicalized to Add with Negate
        expect(compiled?.toString() ?? '').toMatchInlineSnapshot(
          `add(_.b * _.c, _.a, -_.d / _.g)`
        );
      });
    });
  });

  describe('Cross-reference: target functions exist in ComputeEngine library', () => {
    // Functions that are target-specific and intentionally not in the CE library.
    // These are GLSL graphics built-ins, Python-specific numpy/scipy functions,
    // or control-flow constructs handled by the compiler.
    const TARGET_SPECIFIC: Record<string, Set<string>> = {
      javascript: new Set([
        'If', 'List', 'Range', 'Integrate',
      ]),
      glsl: new Set([
        'Clamp', 'Mix', 'Smoothstep', 'Step',
        'Degrees', 'Radians', 'Exp2', 'Log2', 'Inversesqrt',
        'Cross', 'Distance', 'Dot', 'Length', 'Normalize', 'Reflect', 'Refract',
        'List',
      ]),
      'interval-javascript': new Set([
        'If',
      ]),
      'interval-glsl': new Set([]),
      python: new Set([
        'Arctan2',
        'Real', 'Imaginary', 'Argument', 'Conjugate',
        'Sum', 'Product',
        'Dot', 'Cross',
        'Norm', 'Determinant', 'Inverse', 'Transpose', 'MatrixMultiply',
        'Erf', 'Erfc',
        'List',
      ]),
    };

    const targets: Array<[string, { getFunctions: () => Record<string, unknown> }]> = [
      ['javascript', new JavaScriptTarget()],
      ['glsl', new GLSLTarget()],
      ['interval-javascript', new IntervalJavaScriptTarget()],
      ['interval-glsl', new IntervalGLSLTarget()],
      ['python', new PythonTarget()],
    ];

    for (const [name, target] of targets) {
      it(`${name}: all function keys should exist in CE library or exception list`, () => {
        const functions = target.getFunctions();
        const exceptions = TARGET_SPECIFIC[name] ?? new Set();
        const missing: string[] = [];

        for (const key of Object.keys(functions)) {
          if (exceptions.has(key)) continue;
          if (!ce.lookupDefinition(key)) {
            missing.push(key);
          }
        }

        expect(missing).toEqual([]);
      });
    }
  });

  describe('Reverse cross-reference: CE math functions have target coverage', () => {
    // Math functions defined in the CE library that should ideally be compilable.
    // Excludes structural/meta functions (Block, Declare, Assign, etc.),
    // set operations, logic, and domain-specific functions.
    const COMPILABLE_MATH_FUNCTIONS = [
      // Arithmetic
      'Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Power', 'Root', 'Sqrt', 'Square',
      // Rounding / parts
      'Abs', 'Sign', 'Floor', 'Ceil', 'Round', 'Truncate', 'Fract', 'Mod', 'Remainder',
      // Exponential / logarithmic
      'Exp', 'Ln', 'Log', 'Lb',
      // Trigonometric
      'Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc',
      'Arcsin', 'Arccos', 'Arctan', 'Arccot', 'Arccsc', 'Arcsec',
      // Hyperbolic
      'Sinh', 'Cosh', 'Tanh', 'Coth', 'Csch', 'Sech',
      'Arsinh', 'Arcosh', 'Artanh', 'Arcoth', 'Arcsch', 'Arsech',
      // Comparison
      'Equal', 'NotEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual',
      // Logic
      'And', 'Or', 'Not',
      // Aggregates
      'Min', 'Max',
    ];

    const targets: Array<[string, { getFunctions: () => Record<string, unknown>; getOperators: () => Record<string, unknown> }]> = [
      ['javascript', new JavaScriptTarget()],
      ['glsl', new GLSLTarget()],
      ['interval-javascript', new IntervalJavaScriptTarget()],
      ['interval-glsl', new IntervalGLSLTarget()],
      ['python', new PythonTarget()],
    ];

    for (const [name, target] of targets) {
      it(`${name}: coverage of compilable CE math functions`, () => {
        const functions = target.getFunctions();
        const operators = target.getOperators();
        const missing: string[] = [];

        for (const fn of COMPILABLE_MATH_FUNCTIONS) {
          if (!(fn in functions) && !(fn in operators)) {
            missing.push(fn);
          }
        }

        // This test ensures no regressions. If a function is intentionally
        // unsupported in a target, add it to the expected list below.
        const expectedMissing: Record<string, string[]> = {
          javascript: [],
          glsl: [],
          'interval-javascript': [],
          'interval-glsl': [],
          python: [],
        };

        expect(missing.sort()).toEqual((expectedMissing[name] ?? []).sort());
      });
    }
  });
});
