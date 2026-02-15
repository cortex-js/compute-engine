import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { IntervalGLSLTarget } from '../../src/compute-engine/compilation/interval-glsl-target';
import { IntervalWGSLTarget } from '../../src/compute-engine/compilation/interval-wgsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

describe('COMPILE', () => {
  describe('Expressions', () => {
    it('should compile (and simplify) a simple expression', () => {
      expect(compile(ce.parse('3.45 + \\frac57'))?.code).toMatchInlineSnapshot(
        `0.7142857142857143 + 3.45`
      );
    });

    it('should compile an expression with a constant', () => {
      expect(compile(ce.parse('2\\exponentialE'))?.code).toMatchInlineSnapshot(
        `2 * Math.E`
      );
    });

    it('should compile an expression with trig functions', () => {
      expect(
        compile(ce.parse('2 \\cos(\\frac{\\pi}{5})'))?.code
      ).toMatchInlineSnapshot(`2 * Math.cos(0.2 * Math.PI)`);
    });
  });

  describe('Blocks', () => {
    it('should compile a simple block', () => {
      const expr = ce.box(['Block', ['Multiply', 10, 2]]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`20`);
    });

    it('should compile a block with two statements', () => {
      const expr = ce.box(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`
        (() => {
        28;
        return 20
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
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`
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
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`
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
      const result = compile(ce.box(['Foo', 3]), {
        functions: { Foo: (x) => x + 1 },
      })!;
      expect(result.run!()).toBe(4);
    });

    it('should compile a function referenced by name', () => {
      function foo(x) {
        return x + 1;
      }
      const result = compile(ce.box(['Foo', 3]), {
        functions: { Foo: foo },
      })!;
      expect(result.run!()).toBe(4);
    });

    it('should compile a function imported by name', () => {
      function foo(x) {
        return x + 1;
      }
      const result = compile(ce.box(['Foo', 3]), {
        functions: { Foo: 'foo' },
        imports: [foo],
      })!;
      expect(result.run!()).toBe(4);
    });
  });

  describe('Conditionals / Ifs', () => {
    it('should compile an if statement', () => {
      const expr = ce.box(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(
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
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });
  });

  describe('Custom Operators', () => {
    describe('Object-based operator overrides', () => {
      it('should override a single operator', () => {
        const expr = ce.parse('x + y');
        const compiled = compile(expr, {
          operators: { Add: ['add', 11] },
        });
        expect(compiled?.code ?? '').toMatchInlineSnapshot(`add(_.x, _.y)`);
      });

      it('should override multiple operators', () => {
        const expr = ce.parse('x + y * z');
        const compiled = compile(expr, {
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `add(mul(_.y, _.z), _.x)`
        );
      });

      it('should handle division override', () => {
        const expr = ce.parse('x / y');
        const compiled = compile(expr, {
          operators: { Divide: ['div', 13] },
        });
        expect(compiled?.code ?? '').toMatchInlineSnapshot(`div(_.x, _.y)`);
      });

      it('should override unary operators', () => {
        const expr = ce.parse('-x');
        const compiled = compile(expr, {
          operators: { Negate: ['neg', 14] },
        });
        expect(compiled?.code ?? '').toMatchInlineSnapshot(`neg(_.x)`);
      });

      it('should handle subtraction with Negate override', () => {
        // Note: Subtraction is canonicalized to Add(x, Negate(y))
        const expr = ce.parse('x - y');
        const compiled = compile(expr, {
          operators: {
            Add: ['add', 11],
            Negate: ['neg', 14],
          },
        });
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `add(_.x, neg(_.y))`
        );
      });

      it('should use default operators for non-overridden operators', () => {
        const expr = ce.parse('x + y - z');
        const compiled = compile(expr, {
          operators: { Add: ['add', 11] },
        });
        // Note: Subtraction is canonicalized to Add(x, y, Negate(z))
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `add(_.x, _.y, -_.z)`
        );
      });
    });

    describe('Function-based operator overrides', () => {
      it('should override using a function', () => {
        const expr = ce.parse('x + y');
        const compiled = compile(expr, {
          operators: (op) => (op === 'Add' ? ['add', 11] : undefined),
        });
        expect(compiled?.code ?? '').toMatchInlineSnapshot(`add(_.x, _.y)`);
      });

      it('should fall back to defaults when function returns undefined', () => {
        const expr = ce.parse('x + y * z');
        const compiled = compile(expr, {
          operators: (op) => (op === 'Add' ? ['add', 11] : undefined),
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `add(_.y * _.z, _.x)`
        );
      });
    });

    describe('Vector/matrix operations use case', () => {
      it('should compile vector addition to function call', () => {
        // Use case from Issue #240
        const expr = ce.box(['Add', ['List', 1, 1, 1], ['List', 1, 1, 1]]);
        const compiled = compile(expr, {
          operators: { Add: ['add', 11] },
        });
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
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

        const compiled = compile(expr, {
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
          functions: { add, mul },
        });

        const result = compiled?.run?.();
        expect(result).toEqual([3, 5, 7]);
      });
    });

    describe('Complex expressions with operator overrides', () => {
      it('should handle nested expressions', () => {
        const expr = ce.parse('(x + y) * (z + w)');
        const compiled = compile(expr, {
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `mul(add(_.w, _.z), add(_.x, _.y))`
        );
      });

      it('should handle expressions with multiple operator types', () => {
        const expr = ce.parse('x + y - z * w / v');
        const compiled = compile(expr, {
          operators: {
            Add: ['add', 11],
            Multiply: ['mul', 12],
            Divide: ['div', 13],
            Negate: ['neg', 14],
          },
        });
        // Note: Subtraction is canonicalized to Add with Negate
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `add(neg(mul(_.z, div(_.w, _.v))), _.x, _.y)`
        );
      });
    });

    describe('Precedence handling with custom operators', () => {
      it('should respect custom precedence', () => {
        const expr = ce.parse('x + y * z');
        const compiled = compile(expr, {
          operators: {
            Add: ['add', 20], // Higher precedence than multiply
            Multiply: ['mul', 10],
          },
        });
        // Note: canonical form may reorder arguments
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `add(mul(_.y, _.z), _.x)`
        );
      });
    });

    describe('Partial overrides', () => {
      it('should allow overriding only some operators', () => {
        const expr = ce.parse('a + b * c - d / g');
        const compiled = compile(expr, {
          operators: {
            Add: ['add', 11],
            // Multiply, Negate, Divide use defaults
          },
        });
        // Note: Subtraction is canonicalized to Add with Negate
        expect(compiled?.code ?? '').toMatchInlineSnapshot(
          `add(_.b * _.c, _.a, -_.d / _.g)`
        );
      });
    });
  });

  describe('Tuples and Matrices', () => {
    describe('Tuple compilation', () => {
      it('should compile a tuple from LaTeX', () => {
        const expr = ce.parse('(\\sin(t), \\cos(t))');
        expect(expr.operator).toBe('Tuple');
        expect(compile(expr)?.code).toMatchInlineSnapshot(
          `[Math.sin(_.t), Math.cos(_.t)]`
        );
      });

      it('should compile a tuple from box', () => {
        const expr = ce.box(['Tuple', 1, 2, 3]);
        expect(compile(expr)?.code).toMatchInlineSnapshot(`[1, 2, 3]`);
      });

      it('should compile a tuple and execute it', () => {
        const expr = ce.box(['Tuple', ['Sin', 'x'], ['Cos', 'x']]);
        const result = compile(expr)?.run?.({ x: 0 });
        expect(result).toEqual([0, 1]);
      });

      it('should compile a tuple to GLSL', () => {
        const expr = ce.box(['Tuple', ['Sin', 't'], ['Cos', 't']]);
        const compiled = compile(expr, { to: 'glsl' });
        expect(compiled?.code).toMatchInlineSnapshot(
          `vec2(sin(t), cos(t))`
        );
      });

      it('should compile a tuple to WGSL', () => {
        const expr = ce.box(['Tuple', ['Sin', 't'], ['Cos', 't']]);
        const compiled = compile(expr, { to: 'wgsl' });
        expect(compiled?.code).toMatchInlineSnapshot(
          `vec2f(sin(t), cos(t))`
        );
      });
    });

    describe('Matrix compilation', () => {
      it('should compile a column vector matrix from LaTeX', () => {
        const expr = ce.parse(
          '\\begin{pmatrix}\\sin(t)\\\\ \\cos(t)\\end{pmatrix}'
        );
        expect(expr.operator).toBe('Matrix');
        expect(compile(expr)?.code).toMatchInlineSnapshot(
          `[[Math.sin(_.t)], [Math.cos(_.t)]]`
        );
      });

      it('should compile a 2x2 matrix from box', () => {
        const expr = ce.box([
          'Matrix',
          ['List', ['List', 1, 2], ['List', 3, 4]],
        ]);
        expect(compile(expr)?.code).toMatchInlineSnapshot(`[[1, 2], [3, 4]]`);
      });

      it('should compile a matrix and execute it', () => {
        const expr = ce.box([
          'Matrix',
          ['List', ['List', 1, 0], ['List', 0, 1]],
        ]);
        const result = compile(expr)?.run?.();
        expect(result).toEqual([[1, 0], [0, 1]]);
      });

      it('should compile a column vector to GLSL', () => {
        const expr = ce.parse(
          '\\begin{pmatrix}1\\\\ 2\\\\ 3\\end{pmatrix}'
        );
        const compiled = compile(expr, { to: 'glsl' });
        // Column vector Nx1 is flattened to vecN
        expect(compiled?.code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0)`);
      });

      it('should compile a column vector to WGSL', () => {
        const expr = ce.parse(
          '\\begin{pmatrix}1\\\\ 2\\\\ 3\\end{pmatrix}'
        );
        const compiled = compile(expr, { to: 'wgsl' });
        expect(compiled?.code).toMatchInlineSnapshot(`vec3f(1.0, 2.0, 3.0)`);
      });

      it('should compile a 2x2 matrix to GLSL with native mat2', () => {
        const expr = ce.box([
          'Matrix',
          ['List', ['List', 1, 2], ['List', 3, 4]],
        ]);
        const compiled = compile(expr, { to: 'glsl' });
        // Column-major: col0=(1,3), col1=(2,4)
        expect(compiled?.code).toMatchInlineSnapshot(
          `mat2(vec2(1.0, 3.0), vec2(2.0, 4.0))`
        );
      });

      it('should compile a 2x2 matrix to WGSL with native mat2x2f', () => {
        const expr = ce.box([
          'Matrix',
          ['List', ['List', 1, 2], ['List', 3, 4]],
        ]);
        const compiled = compile(expr, { to: 'wgsl' });
        // Column-major: col0=(1,3), col1=(2,4)
        expect(compiled?.code).toMatchInlineSnapshot(
          `mat2x2f(vec2f(1.0, 3.0), vec2f(2.0, 4.0))`
        );
      });

      it('should compile a 3x3 matrix to GLSL', () => {
        const expr = ce.box([
          'Matrix',
          [
            'List',
            ['List', 1, 0, 0],
            ['List', 0, 1, 0],
            ['List', 0, 0, 1],
          ],
        ]);
        const compiled = compile(expr, { to: 'glsl' });
        expect(compiled?.code).toMatchInlineSnapshot(
          `mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0))`
        );
      });
    });
  });

  describe('Cross-reference: target functions exist in ComputeEngine library', () => {
    // Functions that are target-specific and intentionally not in the CE library.
    // These are GLSL graphics built-ins, Python-specific numpy/scipy functions,
    // or control-flow constructs handled by the compiler.
    const TARGET_SPECIFIC: Record<string, Set<string>> = {
      'javascript': new Set(['If', 'List', 'Range', 'Integrate', 'Re', 'Im', 'Arg']),
      'glsl': new Set([
        'Clamp',
        'Mix',
        'Smoothstep',
        'Step',
        'Degrees',
        'Radians',
        'Exp2',
        'Log2',
        'Inversesqrt',
        'Cross',
        'Distance',
        'Dot',
        'Length',
        'Normalize',
        'Reflect',
        'Refract',
        'List',
      ]),
      'wgsl': new Set([
        'Clamp',
        'Mix',
        'Smoothstep',
        'Step',
        'Degrees',
        'Radians',
        'Exp2',
        'Log2',
        'Inversesqrt',
        'Cross',
        'Distance',
        'Dot',
        'Length',
        'Normalize',
        'Reflect',
        'Refract',
        'List',
      ]),
      'interval-javascript': new Set(['If']),
      'interval-glsl': new Set([]),
      'interval-wgsl': new Set([]),
      'python': new Set([
        'Arctan2',
        'Real',
        'Imaginary',
        'Argument',
        'Conjugate',
        'Sum',
        'Product',
        'Dot',
        'Cross',
        'Norm',
        'Determinant',
        'Inverse',
        'Transpose',
        'MatrixMultiply',
        'Erf',
        'Erfc',
        'List',
      ]),
    };

    const targets: Array<
      [string, { getFunctions: () => Record<string, unknown> }]
    > = [
      ['javascript', new JavaScriptTarget()],
      ['glsl', new GLSLTarget()],
      ['wgsl', new WGSLTarget()],
      ['interval-javascript', new IntervalJavaScriptTarget()],
      ['interval-glsl', new IntervalGLSLTarget()],
      ['interval-wgsl', new IntervalWGSLTarget()],
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
      'Add',
      'Subtract',
      'Multiply',
      'Divide',
      'Negate',
      'Power',
      'Root',
      'Sqrt',
      'Square',
      // Rounding / parts
      'Abs',
      'Sign',
      'Floor',
      'Ceil',
      'Round',
      'Truncate',
      'Fract',
      'Mod',
      'Remainder',
      // Exponential / logarithmic
      'Exp',
      'Ln',
      'Log',
      'Lb',
      // Trigonometric
      'Sin',
      'Cos',
      'Tan',
      'Cot',
      'Sec',
      'Csc',
      'Arcsin',
      'Arccos',
      'Arctan',
      'Arccot',
      'Arccsc',
      'Arcsec',
      // Hyperbolic
      'Sinh',
      'Cosh',
      'Tanh',
      'Coth',
      'Csch',
      'Sech',
      'Arsinh',
      'Arcosh',
      'Artanh',
      'Arcoth',
      'Arcsch',
      'Arsech',
      // Comparison
      'Equal',
      'NotEqual',
      'Less',
      'LessEqual',
      'Greater',
      'GreaterEqual',
      // Logic
      'And',
      'Or',
      'Not',
      // Aggregates
      'Min',
      'Max',
    ];

    const targets: Array<
      [
        string,
        {
          getFunctions: () => Record<string, unknown>;
          getOperators: () => Record<string, unknown>;
        }
      ]
    > = [
      ['javascript', new JavaScriptTarget()],
      ['glsl', new GLSLTarget()],
      ['wgsl', new WGSLTarget()],
      ['interval-javascript', new IntervalJavaScriptTarget()],
      ['interval-glsl', new IntervalGLSLTarget()],
      ['interval-wgsl', new IntervalWGSLTarget()],
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
          'javascript': [],
          'glsl': [],
          'wgsl': [],
          'interval-javascript': [],
          'interval-glsl': [],
          'interval-wgsl': [],
          'python': [],
        };

        expect(missing.sort()).toEqual((expectedMissing[name] ?? []).sort());
      });
    }
  });
});
