import { engine as ce } from '../utils';
import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

describe('COMPILE', () => {
  describe('Expressions', () => {
    it('should compile (and simplify) a simple expression', () => {
      expect(compile(ce.parse('3.45 + \\frac57'))?.code).toMatchInlineSnapshot(
        `4.164285714285715`
      );
    });

    it('should compile an expression with a constant', () => {
      expect(compile(ce.parse('2\\exponentialE'))?.code).toMatchInlineSnapshot(
        `5.43656365691809`
      );
    });

    it('should compile an expression with trig functions', () => {
      expect(
        compile(ce.parse('2 \\cos(\\frac{\\pi}{5})'))?.code
      ).toMatchInlineSnapshot(`1.618033988749895`);
    });
  });

  describe('Blocks', () => {
    it('should compile a simple block', () => {
      const expr = ce.expr(['Block', ['Multiply', 10, 2]]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`20`);
    });

    it('should compile a block with two statements', () => {
      const expr = ce.expr(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`20`);
    });

    it('should compile a block with a declaration', () => {
      const expr = ce.expr([
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
      const expr = ce.expr([
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

    it('should compile a block with Nothing operands (defense-in-depth)', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'a', 'Numbers'],
        ['Assign', 'a', ['Square', 'x']],
        'Nothing',
        ['Add', 'a', 1],
      ]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`
        (() => {
        let a;
        a = (_.x * _.x);
        return a + 1
        })()
      `);
    });

    it('should compile a semicolon block parsed from LaTeX with \\;', () => {
      const expr = ce.parse('a \\coloneq x^2;\\; (a+1)');
      const result = compile(expr);
      expect(result?.success).toBe(true);
      expect(result?.code).toBeTruthy();
    });
  });

  describe('Imported Functions', () => {
    ce.declare('Foo', {
      signature: '(number) -> number',
      evaluate: ([x]) => ce.expr(['Add', x, 1]),
    });

    it('should compile a function imported inline', () => {
      const result = compile(ce.expr(['Foo', 3]), {
        functions: { Foo: (x) => x + 1 },
      })!;
      expect(result.run!()).toBe(4);
    });

    it('should compile a function referenced by name', () => {
      function foo(x) {
        return x + 1;
      }
      const result = compile(ce.expr(['Foo', 3]), {
        functions: { Foo: foo },
      })!;
      expect(result.run!()).toBe(4);
    });

    it('should compile a function imported by name', () => {
      function foo(x) {
        return x + 1;
      }
      const result = compile(ce.expr(['Foo', 3]), {
        functions: { Foo: 'foo' },
        imports: [foo],
      })!;
      expect(result.run!()).toBe(4);
    });
  });

  describe('Conditionals / Ifs', () => {
    it('should compile an if statement', () => {
      const expr = ce.expr(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });

    it('should compile an if statement with blocks', () => {
      const expr = ce.expr([
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
        const expr = ce.expr(['Add', ['List', 1, 1, 1], ['List', 1, 1, 1]]);
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

        const expr = ce.expr([
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
        const expr = ce.expr(['Tuple', 1, 2, 3]);
        expect(compile(expr)?.code).toMatchInlineSnapshot(`[1, 2, 3]`);
      });

      it('should compile a tuple and execute it', () => {
        const expr = ce.expr(['Tuple', ['Sin', 'x'], ['Cos', 'x']]);
        const result = compile(expr)?.run?.({ x: 0 });
        expect(result).toEqual([0, 1]);
      });

      it('should compile a tuple to GLSL', () => {
        const expr = ce.expr(['Tuple', ['Sin', 't'], ['Cos', 't']]);
        const compiled = compile(expr, { to: 'glsl' });
        expect(compiled?.code).toMatchInlineSnapshot(`vec2(sin(t), cos(t))`);
      });

      it('should compile a tuple to WGSL', () => {
        const expr = ce.expr(['Tuple', ['Sin', 't'], ['Cos', 't']]);
        const compiled = compile(expr, { to: 'wgsl' });
        expect(compiled?.code).toMatchInlineSnapshot(`vec2f(sin(t), cos(t))`);
      });
    });

    describe('Distance compilation', () => {
      it('should compile and run Distance on two tuples', () => {
        const expr = ce.expr(['Distance', ['Tuple', 3, 4], ['Tuple', 0, 0]]);
        const r = compile(expr);
        expect(r?.success).toBe(true);
        expect(r?.run?.()).toEqual(5);
      });

      // SUPERSEDED (Tycho items 130/138): a `list<tuple>` operand used to
      // throw. It now BROADCASTS — two point lists zip pairwise, and a
      // length mismatch is still a clean throw (no truncation).
      it('should broadcast Distance over two list<tuple> operands', () => {
        const e = new ComputeEngine();
        e.declare('P', 'list<tuple<number, number>>');
        e.declare('Q', 'list<tuple<number, number>>');
        const expr = e.box(['Distance', 'P', 'Q']);
        const r = compile(expr);
        expect(r?.success).toBe(true);
        expect(r?.run?.({ P: [[3, 4]], Q: [[0, 0]] })).toEqual([5]);
        expect(() =>
          r?.run?.({
            P: [[1, 2]],
            Q: [
              [0, 0],
              [1, 1],
            ],
          })
        ).toThrow(/Distance: dimension mismatch/);
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
        const expr = ce.expr([
          'Matrix',
          ['List', ['List', 1, 2], ['List', 3, 4]],
        ]);
        expect(compile(expr)?.code).toMatchInlineSnapshot(`[[1, 2], [3, 4]]`);
      });

      it('should compile a matrix and execute it', () => {
        const expr = ce.expr([
          'Matrix',
          ['List', ['List', 1, 0], ['List', 0, 1]],
        ]);
        const result = compile(expr)?.run?.();
        expect(result).toEqual([
          [1, 0],
          [0, 1],
        ]);
      });

      it('should compile a column vector to GLSL', () => {
        const expr = ce.parse('\\begin{pmatrix}1\\\\ 2\\\\ 3\\end{pmatrix}');
        const compiled = compile(expr, { to: 'glsl' });
        // Column vector Nx1 is flattened to vecN
        expect(compiled?.code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0)`);
      });

      it('should compile a column vector to WGSL', () => {
        const expr = ce.parse('\\begin{pmatrix}1\\\\ 2\\\\ 3\\end{pmatrix}');
        const compiled = compile(expr, { to: 'wgsl' });
        expect(compiled?.code).toMatchInlineSnapshot(`vec3f(1.0, 2.0, 3.0)`);
      });

      it('should compile a 2x2 matrix to GLSL with native mat2', () => {
        const expr = ce.expr([
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
        const expr = ce.expr([
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
        const expr = ce.expr([
          'Matrix',
          ['List', ['List', 1, 0, 0], ['List', 0, 1, 0], ['List', 0, 0, 1]],
        ]);
        const compiled = compile(expr, { to: 'glsl' });
        expect(compiled?.code).toMatchInlineSnapshot(
          `mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0))`
        );
      });
    });
  });

  describe('Linear-algebra operators compile and run (JS target)', () => {
    // Previously these five threw and fell back to the interpreter; each now
    // lowers to a `_SYS` runtime helper (or `_SYS.shape`). Each test compiles,
    // runs, and checks the value against the interpreter's `.N()`.
    const M = ['List', ['List', 1, 2], ['List', 3, 4]];
    const M23 = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];
    const V = ['List', 5, 6, 7];
    const Msing = ['List', ['List', 1, 2], ['List', 2, 4]];

    const run = (expr: any) => {
      const r = compile(ce.box(expr), { fallback: false });
      expect(r.success).toBe(true);
      return (r.run as () => unknown)();
    };

    it('ConjugateTranspose (real → transpose)', () => {
      expect(run(['ConjugateTranspose', M])).toEqual([
        [1, 3],
        [2, 4],
      ]);
      expect(run(['ConjugateTranspose', M23])).toEqual([
        [1, 4],
        [2, 5],
        [3, 6],
      ]);
    });

    it('Diagonal is rank-dispatched (matrix → vector, vector → matrix)', () => {
      expect(run(['Diagonal', M])).toEqual([1, 4]);
      expect(run(['Diagonal', M23])).toEqual([1, 5]);
      expect(run(['Diagonal', V])).toEqual([
        [5, 0, 0],
        [0, 6, 0],
        [0, 0, 7],
      ]);
    });

    it('MatrixPower (identity, powers, and negative → inverse)', () => {
      expect(run(['MatrixPower', M, 0])).toEqual([
        [1, 0],
        [0, 1],
      ]);
      expect(run(['MatrixPower', M, 2])).toEqual([
        [7, 10],
        [15, 22],
      ]);
      expect(run(['MatrixPower', M, 3])).toEqual([
        [37, 54],
        [81, 118],
      ]);
      const inv = run(['MatrixPower', M, -1]) as number[][];
      const expected = [
        [-2, 1],
        [1.5, -0.5],
      ];
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++)
          expect(inv[i][j]).toBeCloseTo(expected[i][j], 10);
    });

    it('Rank is the TENSOR rank (ndim), not the linear-algebra rank', () => {
      expect(run(['Rank', 5])).toBe(0);
      expect(run(['Rank', V])).toBe(1);
      expect(run(['Rank', M])).toBe(2);
      // A rank-deficient matrix still has tensor rank 2 (matches the interpreter).
      expect(run(['Rank', Msing])).toBe(2);
    });

    it('RowReduce (reduced row echelon form)', () => {
      expect(run(['RowReduce', M])).toEqual([
        [1, 0],
        [0, 1],
      ]);
      expect(run(['RowReduce', Msing])).toEqual([
        [1, 2],
        [0, 0],
      ]);
      expect(run(['RowReduce', M23])).toEqual([
        [1, 0, -1],
        [0, 1, 2],
      ]);
    });
  });

  describe('Cross-reference: target functions exist in ComputeEngine library', () => {
    // Functions that are target-specific and intentionally not in the CE library.
    // These are GLSL graphics built-ins, Python-specific numpy/scipy functions,
    // or control-flow constructs handled by the compiler.
    const TARGET_SPECIFIC: Record<string, Set<string>> = {
      'javascript': new Set(['If', 'List', 'Range', 'Integrate']),
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
        'Conjugate',
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
        'Conjugate',
      ]),
      'interval-javascript': new Set(['If']),
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

    // The GPU targets MERGE their language-specific table onto GPU_FUNCTIONS.
    // That merge is invariant, and it must be computed once per target: the
    // shared table sits exactly at V8's fast-property limit (128 entries), so
    // re-merging on every `compile()` normalizes the result to dictionary
    // mode — ~22KB of transient garbage per call, twice per compilation.
    it('gpu targets memoize their merged function table', () => {
      for (const target of [new GLSLTarget(), new WGSLTarget()]) {
        const first = target.getFunctions();
        expect(target.getFunctions()).toBe(first);
        target.compile(ce.parse('\\sin(x)'));
        expect(target.getFunctions()).toBe(first);
      }
    });
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
        },
      ]
    > = [
      ['javascript', new JavaScriptTarget()],
      ['glsl', new GLSLTarget()],
      ['wgsl', new WGSLTarget()],
      ['interval-javascript', new IntervalJavaScriptTarget()],
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
          'python': [],
        };

        expect(missing.sort()).toEqual((expectedMissing[name] ?? []).sort());
      });
    }
  });
});

// REVIEW.md E1: Range with symbolic bounds compiled to
// `Array.from({length: NaN})` because the guard tested `parseFloat(...) !==
// null`, but parseFloat returns NaN (never null) for symbolic bounds — so the
// constant-length branch always won and every symbolic Range yielded `[]`.
describe('COMPILE Range with symbolic bounds (E1)', () => {
  it('Range(1, n) emits a runtime length, not NaN', () => {
    const code = compile(ce.expr(['Range', 1, 'n']))!.code;
    expect(code).not.toContain('NaN');
    expect(code).toContain('_.n');
  });

  it('Range(1, n) evaluates to [1..n]', () => {
    const fn = compile(ce.expr(['Range', 1, 'n']))!;
    expect(fn.run!({ n: 5 })).toEqual([1, 2, 3, 4, 5]);
  });

  it('Range(a, b) with a symbolic start evaluates inclusively', () => {
    // Regression for the throwaway map-callback param shadowing the argument
    // object `_`: a symbolic start compiles to `_.a` inside the callback.
    const fn = compile(ce.expr(['Range', 'a', 'b']))!;
    expect(fn.run!({ a: 2, b: 6 })).toEqual([2, 3, 4, 5, 6]);
  });

  it('Range(a, n, 2) with a symbolic step evaluates correctly', () => {
    const fn = compile(ce.expr(['Range', 'a', 'n', 2]))!;
    expect(fn.run!({ a: 1, n: 9 })).toEqual([1, 3, 5, 7, 9]);
  });

  it('constant Range(1, 5) is still unrolled', () => {
    const fn = compile(ce.expr(['Range', 1, 5]))!;
    expect(fn.run!()).toEqual([1, 2, 3, 4, 5]);
  });
});

// The antiderivative engine emits the exponential/trigonometric/logarithmic
// integrals as closed forms (e.g. ∫ sin x / x dx = SinIntegral(x)). They must
// be lowerable to JS so an "evaluate then compile" plotting pipeline can use
// the closed form instead of falling back to numeric sampling.
describe('COMPILE integral special functions (Si/Ci/Ei/li)', () => {
  const cases: Array<[string, number]> = [
    ['SinIntegral', 2],
    ['CosIntegral', 2],
    ['ExpIntegralEi', 1.5],
    ['LogIntegral', 3],
  ];

  for (const [op, x] of cases) {
    it(`${op} compiles to a _SYS helper and matches N()`, () => {
      const result = compile(ce.box([op, 'x']))!;
      expect(result.success).toBe(true);
      expect(result.code).toContain('_SYS.');
      const got = result.run!({ x }) as number;
      const want = ce.box([op, x]).N().re;
      expect(got).toBeCloseTo(want, 10);
    });
  }

  it('lowers an evaluated ∫ sin x / x dx closed form', () => {
    const closedForm = ce.parse('\\int \\frac{\\sin x}{x} dx').evaluate();
    expect(closedForm.operator).toBe('SinIntegral');
    const result = compile(closedForm)!;
    expect(result.success).toBe(true);
    expect(result.run!({ x: 2 })).toBeCloseTo(
      ce.box(['SinIntegral', 2]).N().re,
      10
    );
  });
});

// Tier-2 special-function kernels that `.N()` produces as real floats — the
// elliptic integrals, AGM, hypergeometric functions, Erfi, and the Choose
// binomial — must also lower to JS so an "evaluate then compile" pipeline can
// plot a closed form (e.g. a pendulum period from an EllipticK closed form)
// instead of falling back to numeric sampling.
describe('COMPILE Tier-2 special functions (elliptic / AGM / hypergeometric / Erfi)', () => {
  // Concrete numeric argument lists (no free variable) — verifies both the
  // arity-overloaded dispatch and numeric agreement with N().
  const cases: Array<[string, number[]]> = [
    ['AGM', [1, 2]],
    ['AGM', [2]], // one-arg form ⇒ AGM(1, 2)
    ['EllipticK', [0.5]],
    ['EllipticE', [0.5]], // complete
    ['EllipticE', [0.7, 0.5]], // incomplete
    ['EllipticF', [0.7, 0.5]],
    ['EllipticPi', [0.3, 0.5]], // complete
    ['EllipticPi', [0.3, 0.7, 0.5]], // incomplete
    ['Erfi', [0.5]],
    ['Hypergeometric2F1', [1, 1, 2, 0.5]],
    ['Hypergeometric1F1', [1, 2, 0.5]],
    ['Choose', [5, 2]],
  ];

  for (const [op, args] of cases) {
    it(`${op}(${args.join(', ')}) compiles and matches N()`, () => {
      const expr = ce.box([op, ...args]);
      // These cases are all constant, so constant folding would emit a literal
      // instead of the `_SYS.` runtime call this test is pinning.
      const result = compile(expr, { constantFold: false })!;
      expect(result.success).toBe(true);
      expect(result.code).toContain('_SYS.');
      const want = expr.N().re;
      expect(result.run!({}) as number).toBeCloseTo(want, 9);
    });
  }

  it('lowers AGM and EllipticE with a free variable', () => {
    const k = compile(ce.box(['EllipticK', 'm']))!;
    expect(k.success).toBe(true);
    expect(k.run!({ m: 0.5 })).toBeCloseTo(
      ce.box(['EllipticK', 0.5]).N().re,
      9
    );
  });
});

// Regressions for the WP-2.8 compilation P0 cluster (CORRECTNESS_FINDINGS
// P0-41…P0-46 + the Mod/Remainder target side of P0-7). Each asserts the
// compiled JS agrees with the interpreter at the adversarial points that used
// to diverge, or fails closed where no real value exists.
describe('COMPILE — WP-2.8 P0 regressions', () => {
  const parity = (src: any, vars: Record<string, number>, digits = 10) => {
    const result = compile(ce.box(src))!;
    expect(result.success).toBe(true);
    const got = result.run!(vars) as number;
    const want = ce.box(src).subs(vars).N().re;
    expect(got).toBeCloseTo(want, digits);
  };

  it('Mod is floored for negative operands (P0-7)', () => {
    for (const [x, y] of [
      [-1, 3],
      [7, -3],
      [-7, -3],
      [7.5, 2],
      [-7.5, 2],
    ])
      parity(['Mod', 'x', 'y'], { x, y });
  });

  it('floored-Mod fragment is parenthesized inside a product (Tycho item 43)', () => {
    // The floored-mod emission `((a % b) + b) % b` lacked outer parentheses;
    // composed as a `Multiply`/`Divide` factor, JS left-assoc `%` reduced the
    // whole product mod b: `c * ((x % 1) + 1) % 1` ≡ `(c·(x%1+1)) % 1`.
    for (const [c, x] of [
      [3, 7.5],
      [-2, -7.5],
      [10, 0.9],
    ])
      parity(['Multiply', 'c', ['Mod', 'x', 1]], { c, x });
    // The exact filed repro: Neyret hash terms summed with cosine weights.
    const expr = ce.parse(
      '\\sum_{i=0}^6\\cos(i)(10^{4}\\sin(10^{4}i)\\bmod 1)'
    );
    const r = compile(expr)!;
    expect(r.success).toBe(true);
    expect(r.run!({}) as number).toBeCloseTo(expr.N().re, 9);
  });

  it('Remainder uses round-to-nearest quotient, not floored (P0-7)', () => {
    for (const [x, y] of [
      [7, 4],
      [-7, 4],
      [7, 3],
      [-7, -3],
    ])
      parity(['Remainder', 'x', 'y'], { x, y });
  });

  it('Round is half-away-from-zero (P0-41)', () => {
    for (const v of [0.5, -0.5, 1.5, -1.5, 2.5, -2.5])
      parity(['Round', 'x'], { x: v });
  });

  it('Arccot uses the (0, π) branch for negative arguments (P0-42)', () => {
    for (const v of [2, -2, 0.5, -0.5, 10, -10])
      parity(['Arccot', 'x'], { x: v });
  });

  it('odd roots of negatives are real (P0-42)', () => {
    for (const [x, n] of [
      [-2, 5],
      [-32, 5],
      [8, 3],
    ])
      parity(['Root', 'x', n], { x });
    // constant fold of an odd root of a negative stays real
    expect(compile(ce.box(['Root', -8, 3]))!.code).toBe('-2');
  });

  it('non-real constants are folded, not refused (P0-42; policy change 2026-07-30)', () => {
    // Since D12-A, a perfect-square negative radicand canonicalizes to an
    // EXACT complex literal before compile (√-4 → 2i), which the JS target
    // compiles as a complex constant — correct, interpreter-parity value:
    const folded = compile(ce.box(['Sqrt', -4]));
    expect(folded.success).toBe(true);
    expect(folded.run!()).toEqual({ re: 0, im: 2 });
    // A non-square radicand reaches the real fold path symbolically. It used
    // to fail closed there; since 2026-07-30 it folds like every sibling head
    // instead. D6 guards against silently WRONG output, not against a
    // non-real one, and the same expression over a VARIABLE has always
    // compiled (`Math.sqrt(x)` → NaN) — which no static check can catch.
    for (const src of [
      ['Sqrt', -5],
      ['Root', -5, 2],
    ]) {
      const result = compile(ce.box(src as any), { fallback: false });
      expect(result.success).toBe(true);
      expect(result.run!()).toEqual({ re: 0, im: Math.sqrt(5) });
    }
    // SUPERSEDED CONTRACT (2026-07-30 ruling). These two used to assert a
    // `'NaN'` fold, on the then-true grounds that a non-real `Power`/`Root` was
    // typed `number`. The type handlers now narrow a negative base with
    // an EVEN reduced-rational exponent denominator (or an even root degree) to
    // `complex`, so the enclosing expression emits `{re, im}` arithmetic
    // and the fold must be the complex principal value — a `NaN` *number*
    // there is read as `{re: NaN, im: undefined}` by the parent. Do NOT restore
    // the `'NaN'` assertion.
    for (const [src, exp] of [
      [['Power', -2, 0.3], { re: 0.7236485296064105, im: 0.9960167529258122 }],
      [['Root', -4, 4], { re: 1, im: 0.9999999999999998 }],
    ] as const) {
      const expr = ce.box(src as any);
      expect(expr.type.toString()).toBe('complex');
      const result = compile(expr, { fallback: false });
      expect(result.run!()).toEqual(exp);
      // …matching the interpreter, which is the point of the ruling.
      expect(expr.N().re).toBeCloseTo(exp.re, 12);
      expect(expr.N().im).toBeCloseTo(exp.im, 12);
    }
    // The REAL branch of a negative base is unchanged in kind but was folding
    // wrong: an ODD denominator has a real principal root that `Math.pow`
    // misses, so `(-8)^(2/3)` compiled to `NaN` while the interpreter gave 4.
    expect(
      compile(ce.box(['Power', -8, ['Divide', 2, 3]]), { fallback: false }).code
    ).toBe('4');
  });

  it('non-canonical right-associative grouping is preserved (P0-45)', () => {
    const div = compile(
      ce.box(['Divide', 'a', ['Divide', 'b', 'c']], { canonical: false })
    )!;
    expect(div.success).toBe(true);
    expect(div.run!({ a: 12, b: 6, c: 2 })).toBe(4);

    const sub = compile(
      ce.box(['Subtract', 'a', ['Subtract', 'b', 'c']], { canonical: false })
    )!;
    expect(sub.success).toBe(true);
    expect(sub.run!({ a: 5, b: 3, c: 1 })).toBe(3);
  });

  it('fallback run() does not leak argument bindings into the engine (P0-44)', () => {
    const engine = new ComputeEngine();
    engine.declare('g', '(number) -> number');
    const expr = engine.parse('g(x) + x');
    const result = compile(expr);
    expect(result.success).toBe(false); // falls back to interpretation
    result.run!({ x: 5 });
    // After the fallback call, `x` must still be a free symbol engine-wide.
    expect(engine.box('x').value).toBeUndefined();
  });
});

// CO-P1-4: compiled `Equal`/`NotEqual` used exact `===`, disagreeing with the
// interpreter, which compares numbers within `engine.tolerance` (default
// 1e-10). Compiled equality must bake the tolerance and match the interpreter.
describe('COMPILE Equal/NotEqual tolerance (CO-P1-4)', () => {
  it('compiled Equal(0.1+0.2, 0.3) is true, matching the interpreter', () => {
    const expr = ce.box(['Equal', ['Add', 0.1, 0.2], 0.3]);
    // The operands are constant, so folding would emit a `true` literal instead
    // of the tolerance comparison this test is pinning.
    const r = compile(expr, { constantFold: false })!;
    expect(r.code).toContain('Math.abs');
    expect(r.code).not.toContain('===');
    expect(r.run!({})).toBe(true);
    // Interpreter agrees.
    expect(expr.evaluate().symbol).toBe('True');
  });

  it('compiled NotEqual(0.1+0.2, 0.3) is false, matching the interpreter', () => {
    const expr = ce.box(['NotEqual', ['Add', 0.1, 0.2], 0.3]);
    const r = compile(expr)!;
    expect(r.run!({})).toBe(false);
    expect(expr.evaluate().symbol).toBe('False');
  });

  it('genuinely different values are still not equal', () => {
    const r = compile(ce.box(['Equal', 'x', 0.3]))!;
    expect(r.run!({ x: 0.4 })).toBe(false);
    expect(r.run!({ x: 0.3 })).toBe(true);
  });

  it('compiled Chop bakes the engine tolerance, matching the interpreter', () => {
    // `Chop` is a comparison-tolerance operator like `Equal`: a bare
    // `_SYS.chop(x)` fell back to the static default (1e-10) and diverged
    // from the interpreter at any non-default `ce.tolerance` — `Chop(1e-7)`
    // at `tolerance = 1e-6` is `0` interpreted but compiled to `1e-7`.
    const loose = new ComputeEngine();
    loose.tolerance = 1e-6;
    const r = compile(loose.box(['Chop', 'x']), { fallback: false });
    expect(r.run!({ x: 1e-7 })).toBe(0);
    expect(r.run!({ x: 1e-5 })).toBe(1e-5);
    expect(loose.box(['Chop', 1e-7]).evaluate().isSame(0)).toBe(true);
  });
});

// CO-P1-3: a complex-typed argument into a real-only helper (`_SYS.erf`)
// silently returned garbage (−1). It must never compute that garbage. Since
// the compile-mode migration (step 4, 2026-08-16) the answer splits in two:
// an operand that is only MAYBE complex takes the D2/D6 runtime rule (the real
// helper when the value is real at run time, `NaN` when it is not), while an
// operand that is STATICALLY non-real still fails closed at compile time.
// `mode: 'strict'` keeps the old compile-time decline for both.
describe('COMPILE complex into real-only helper fails closed (CO-P1-3)', () => {
  it('Erf of a complex value throws in strict mode', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    expect(() =>
      compile(engine.box(['Erf', 'z']), { fallback: false, mode: 'strict' })
    ).toThrow(/real-only target helper/);
  });

  it('Erf of a STATICALLY non-real operand declines in the default mode too', () => {
    const engine = new ComputeEngine();
    expect(() =>
      compile(engine.box(['Erf', 'ImaginaryUnit']), {
        fallback: false,
        constantFold: false,
      })
    ).toThrow(/non-real operand/);
  });

  it('Erf of a MAYBE-complex value takes the runtime rule in the default mode', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    const r = compile(engine.box(['Erf', 'z']));
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.cisreal(');
    expect(r.run!({ z: 0.5 } as any)).toBeCloseTo(0.5204998778130466, 12);
    expect(r.run!({ z: { re: 0, im: 1 } } as any)).toBeNaN();
  });

  it('the engine-level fallback reports success:false with the head unsupported', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    const r = compile(engine.box(['Erf', 'z']), { mode: 'strict' });
    expect(r.success).toBe(false);
  });

  it('Erf of a real value still compiles', () => {
    const r = compile(ce.box(['Erf', 'x']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.erf');
  });

  // The gate above only covers a head the target maps to a plain HELPER NAME.
  // A head lowered by function codegen bypassed it, even where that codegen is
  // just as real-only — `Math.floor`, `sign(x)·round(|x|)`, `Math.max`. Each of
  // these compiled to `success: true` over source that ran to NaN. Measured
  // with `x` bound to `0`, so `x + (1+i)` is complex but not a foldable
  // literal: `Floor` → NaN where the interpreter leaves `1 + i` inert, `Max` →
  // NaN where it leaves `max(1 + i)` inert, `Mod(…, 2)` → NaN where it answers
  // `1`.
  describe('a real-only FUNCTION-codegen head fails closed too', () => {
    const Z = ['Add', ['Complex', 1, 1], 'x'];
    // Statically non-real: no run-time value of this expression is real.
    const STATIC = ['Complex', 1, 1];

    // `Ceil` and `ElementMax`/`ElementMin` are DISTINCT heads from `Ceiling`
    // and `Max`/`Min` — `Ceil` is the one the library canonicalizes to — and a
    // set holding only the other spelling left them emitting
    // `Math.ceil({re, im})` / `Math.max({re, im})`. All the heads are listed
    // together here, with the canonical spellings among them.
    const HEADS: [string, unknown[]][] = [
      ['Floor', []],
      ['Round', []],
      ['Truncate', []],
      ['Fract', []],
      ['Max', []],
      ['Min', []],
      ['Clamp', [0, 2]],
      ['Mod', [2]],
      ['Remainder', [2]],
      ['GCD', [2]],
      ['LCM', [2]],
      ['Ceil', []],
      ['ElementMax', [1]],
      ['ElementMin', [1]],
    ];

    test.each(HEADS)(
      '%s over a MAYBE-complex operand takes the runtime rule',
      (h, rest) => {
        // `x + (1+i)` is complex-typed but not statically non-real, so since
        // the compile-mode migration (step 4, 2026-08-16) it compiles under
        // the D2/D6 runtime rule instead of declining: the real lowering when
        // the value is real at run time, `NaN` when it is not. Here the
        // imaginary part is 1 at every `x`, so the answer is always `NaN` —
        // no longer a silent one behind a real lowering.
        const engine = new ComputeEngine();
        const r = compile(engine.box([h, Z, ...rest] as any), {
          fallback: false,
          // Every operand but `x` is a literal; without this the whole call
          // could fold and the lowering under test would never be emitted.
          constantFold: false,
        });
        expect(r.success).toBe(true);
        expect(r.code).toContain('_SYS.cisreal(');
        expect(r.run!({ x: 0 } as any)).toBeNaN();
      }
    );

    test.each(HEADS)(
      '%s over a STATICALLY non-real operand still declines',
      (h, rest) => {
        const engine = new ComputeEngine();
        expect(() =>
          compile(engine.box([h, STATIC, ...rest] as any), {
            fallback: false,
            constantFold: false,
          })
        ).toThrow(/non-real operand/);
      }
    );

    test.each(HEADS)('%s declines in strict mode, as before', (h, rest) => {
      const engine = new ComputeEngine();
      expect(() =>
        compile(engine.box([h, Z, ...rest] as any), {
          fallback: false,
          constantFold: false,
          mode: 'strict',
        })
      ).toThrow(/real-only/);
    });

    // The gate above sits on `compileExpr`'s SCALAR branch, which the JavaScript
    // broadcast path returns before reaching. A list operand therefore needs the
    // same rule inside `tryCompileBroadcast`: the closure it builds comes from
    // the head's own scalar codegen, which for these heads is `Math.floor` /
    // `Math.max` / … whatever the element parameter is declared to hold.
    // Measured without that second gate: `Floor([1+i, 2+i])` emitted
    // `_SYS.bcast((_tv1) => Math.floor(_tv1), [{re, im}, {re, im}])` and ran to
    // `[NaN, NaN]` behind `success: true`, where the interpreter leaves the
    // elements inert at `[1+i, 2+i]`.
    const COMPLEX_LIST = ['List', ['Complex', 1, 1], ['Complex', 2, 1]];
    test.each([
      ['Floor', [COMPLEX_LIST]],
      ['Round', [COMPLEX_LIST]],
      ['Truncate', [COMPLEX_LIST]],
      ['Fract', [COMPLEX_LIST]],
      ['Mod', [COMPLEX_LIST, 2]],
      ['Remainder', [COMPLEX_LIST, 2]],
      ['Clamp', [COMPLEX_LIST, 0, 2]],
    ])('%s over a uniformly-complex LIST fails closed too', (h, args) => {
      const engine = new ComputeEngine();
      const r = compile(engine.box([h, ...args] as any), {
        constantFold: false,
      });
      expect(r.success).toBe(false);
    });

    test.each([
      ['Floor', ['x']],
      ['Round', ['x']],
      ['Max', ['x', 1]],
      ['Mod', ['x', 2]],
      ['GCD', ['x', 2]],
    ])('%s over a REAL operand still compiles', (h, args) => {
      const engine = new ComputeEngine();
      const r = compile(engine.box([h, ...args] as any), { fallback: false });
      expect(r.success).toBe(true);
    });

    // The STATISTICS reducers are real-only for the same reason: `_SYS.mean` &
    // co. sum and compare plain numbers. Measured before the gate reached them:
    // `Mean([i, 2i])` compiled to `NaN` where the interpreter answers the
    // complex mean.
    test.each([
      ['Mean'],
      ['Median'],
      ['Variance'],
      ['PopulationVariance'],
      ['StandardDeviation'],
      ['PopulationStandardDeviation'],
      ['Mode'],
      ['Kurtosis'],
      ['Skewness'],
      ['Quartiles'],
      ['InterquartileRange'],
    ])('%s over a complex-element list fails closed', (h) => {
      const engine = new ComputeEngine();
      const r = compile(
        engine.box([
          h,
          ['List', 'ImaginaryUnit', ['Multiply', 2, 'ImaginaryUnit']],
        ] as any),
        { constantFold: false }
      );
      expect(r.success).toBe(false);
    });

    it('real statistics data is untouched', () => {
      const r = compile(ce.box(['Mean', ['List', 1, 2, 3]] as any), {
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!({})).toBe(2);
    });
  });

  // A statistics head applied to a SINGLE DATUM rather than a collection.
  // `_SYS.mean` & co. iterate their argument, so `Mean(x)` emitted
  // `_SYS.mean(4)` and threw "values is not iterable" at RUN TIME behind
  // `success: true`, where the interpreter answers `4`. This is not a complex-
  // lane problem — it hit plain real operands, which is the likelier shape in a
  // plotted expression.
  //
  // The interpreter treats one datum exactly as a one-element list, verified
  // head by head at `x = 4` (the scalar and the `[4]` forms agree in every
  // row), so the compiled path now wraps a runtime scalar and the existing
  // reducers reproduce interpretation with no per-head special case.
  describe('a statistics head over a SINGLE DATUM matches interpretation', () => {
    const AT_4 = { x: 4 };

    test.each([
      ['Mean', 4],
      ['Median', 4],
      ['Mode', 4],
      ['PopulationVariance', 0],
      ['PopulationStandardDeviation', 0],
    ])('%s(x) is %p, as the interpreter answers', (h, expected) => {
      const engine = new ComputeEngine();
      const r = compile(engine.box([h, 'x'] as any), { constantFold: false });
      expect(r.success).toBe(true);
      expect(r.run!(AT_4 as any)).toBe(expected);
    });

    // The SAMPLE forms divide by `n − 1`, which is zero for one datum — NaN in
    // the interpreter too, so this row is agreement, not breakage.
    test.each([
      ['Variance'],
      ['StandardDeviation'],
      ['Kurtosis'],
      ['Skewness'],
      ['InterquartileRange'],
    ])('%s(x) is NaN, as the interpreter answers', (h) => {
      const engine = new ComputeEngine();
      const r = compile(engine.box([h, 'x'] as any), { constantFold: false });
      expect(r.success).toBe(true);
      expect(r.run!(AT_4 as any)).toBeNaN();
    });

    it('Quartiles(x) is (NaN, 4, NaN)', () => {
      const engine = new ComputeEngine();
      const r = compile(engine.box(['Quartiles', 'x'] as any), {
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!(AT_4 as any)).toEqual([NaN, 4, NaN]);
    });

    it('a COLLECTION operand is unaffected — the wrap is runtime-shaped', () => {
      // The static type cannot decide this: a bare symbol may be bound to a
      // number or to an array at call time, so the coercion tests the value.
      const engine = new ComputeEngine();
      const r = compile(engine.box(['Mean', 'x'] as any), {
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!({ x: [1, 2, 3] } as any)).toBe(2);
      expect(r.run!(AT_4 as any)).toBe(4);
    });

    it('a single COMPLEX datum still never reaches the real reducer', () => {
      // The real-only gate runs ahead of the lowering, so widening the shape
      // does not reopen the complex hole. A MAYBE-complex datum takes the
      // D2/D6 runtime rule (compile-mode step 4, 2026-08-16) — `NaN`, since
      // `x + (1+i)` is complex at every `x` — and a statically non-real one
      // still declines at compile time.
      const engine = new ComputeEngine();
      const r = compile(
        engine.box(['Mean', ['Add', ['Complex', 1, 1], 'x']] as any),
        { constantFold: false }
      );
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.cisreal(');
      expect(r.run!({ x: 0 } as any)).toBeNaN();
      expect(
        compile(engine.box(['Mean', ['Complex', 1, 1]] as any), {
          constantFold: false,
        }).success
      ).toBe(false);
    });

    it('a real LIST operand still broadcasts through these heads', () => {
      // The gate keys on complex-ness, not on list-ness: the ordinary
      // element-wise `Floor` must be untouched.
      const r = compile(ce.box(['Floor', ['List', 1.7, 2.2]] as any), {
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!({})).toEqual([1, 2]);
    });

    it('the real lowering is unchanged — Floor(x) is still Math.floor', () => {
      const r = compile(ce.box(['Floor', 'x']), { fallback: false });
      expect(r.code).toBe('Math.floor(_.x)');
    });
  });
});

// CO-P2-24: compiled-vs-interpreted divergences pinned to the interpreter.
describe('COMPILE interpreter-alignment (CO-P2-24)', () => {
  it('dynamic 0^0 yields NaN like the interpreter (not Math.pow 1)', () => {
    const r = compile(ce.box(['Power', 'x', 'y']), { fallback: false })!;
    // Variable exponent routes through the _SYS.pow helper.
    expect(r.code).toContain('_SYS.pow(');
    expect(Number.isNaN(r.run!({ x: 0, y: 0 }) as number)).toBe(true);
    // The interpreter agrees.
    expect(ce.box(['Power', 0, 0]).N().isNaN).toBe(true);
    // Non-indeterminate powers are unaffected.
    expect(r.run!({ x: 2, y: 3 })).toBe(8);
    expect(r.run!({ x: 0, y: 2 })).toBe(0);
    expect(r.run!({ x: 9, y: 0.5 })).toBe(3);
  });

  it('x^0 folds to 1 (matching the interpreter, even at x=0)', () => {
    const r = compile(ce.box(['Power', 'x', 0]), { fallback: false })!;
    expect(r.run!({ x: 0 })).toBe(1);
    expect(r.run!({ x: 5 })).toBe(1);
  });

  it('constant nonzero exponent keeps the plain Math.pow fast path', () => {
    // x^3 with a symbol base does not need the 0^0 guard.
    const r = compile(ce.box(['Power', 'x', 5]), { fallback: false })!;
    expect(r.code).not.toContain('_SYS.pow');
  });

  it('1/0 compiles to a complex-infinity object, matching interpreted ~oo', () => {
    // The interpreter yields ComplexInfinity (~oo); the compiled constant folds
    // through the same path to a { re, im } infinity object (both non-finite).
    // Documented: this is an alignment, not a divergence.
    const r = compile(ce.box(['Divide', 1, 0]), { fallback: false })!;
    const out = r.run!({}) as any;
    const both =
      typeof out === 'object' && out !== null
        ? !Number.isFinite(out.re) || !Number.isFinite(out.im)
        : !Number.isFinite(out);
    expect(both).toBe(true);
    expect(ce.box(['Divide', 1, 0]).N().isFinite).toBe(false);
  });

  it('a boolean-valued expression runs to a boolean, not to 0/1', () => {
    // CO-P2-25: the interpreter never numericizes a boolean-valued expression
    // (`True.N()` stays `True`), and the compiled runner matches it rather
    // than coercing. A caller that needs a number maps it at its own value
    // boundary.
    const r = compile(ce.box(['Greater', 'x', 0]), { fallback: false })!;
    expect(r.run!({ x: 5 })).toBe(true);
    expect(r.run!({ x: -5 })).toBe(false);
  });
});

// CO-P2-23c: a chained relation must evaluate a shared middle operand once
// (matching the interpreter), not twice — otherwise `a < Random() < b` draws
// two different values.
describe('COMPILE chained relation binds shared middle once (CO-P2-23c)', () => {
  it('a non-trivial middle operand is bound to a single temporary', () => {
    const r = compile(ce.box(['Less', 'a', ['Random'], 'b']), {
      fallback: false,
    })!;
    // Exactly one draw, reused in both comparisons via an IIFE. (A duplicated
    // emission would also desynchronize a `WithRandomSeed` frame's counter.)
    expect(r.code.match(/_SYS\.drawNextRandomNumber\(\)/g)?.length).toBe(1);
    // Consistency check: for a<mid<b, whenever it returns true the same middle
    // value satisfied both bounds (would be flaky if drawn twice).
    for (let i = 0; i < 200; i++)
      expect(typeof r.run!({ a: 0, b: 1 })).toBe('boolean');
  });

  it('a symbol/number middle stays inline (no temp, no churn)', () => {
    const r = compile(ce.box(['Less', -1, 'x', 1]), { fallback: false })!;
    expect(r.code).not.toContain('=>');
    expect(r.run!({ x: 0 })).toBe(true);
    expect(r.run!({ x: 5 })).toBe(false);
  });
});

// Compilation-target contract for collection-shaped operands (Tycho round).
// The target-based API must FAIL CLOSED (throw) on shapes it cannot lower —
// never return `success: true` with null/wrong code — while the folds it *does*
// support (Reduce/Length/At) compile to correct JS.
describe('COMPILE collections (fail-closed + supported folds)', () => {
  const mkEngine = () => {
    const e = new ComputeEngine();
    e.pushScope();
    e.assign('d', e.parse('[10, 20, 30]').evaluate());
    e.assign('m', e.box(2));
    return e;
  };

  it('binary Equal over a collection operand lowers to _SYS.eq (Tycho item 41; was fail-closed)', () => {
    // `d = [10,20,30]`, `m = 2`: the interpreter broadcasts list-vs-scalar
    // element-wise (`[False, False, False]`); the compiled dispatch matches.
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const r = js.compile(e.parse('d = m', { strict: false }));
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual([false, false, false]);
  });

  it('Equal over a top-typed application compiles and runs (Tycho item 41 retest trigger)', () => {
    // `q: (number) -> unknown` assigned `v ↦ v² + 5`: the call types
    // `unknown` (possibly-collection), which failed closed before the
    // `_SYS.eq` dispatch. Tycho's visibility-gate shape.
    const e = new ComputeEngine();
    e.declare('q', '(number) -> unknown');
    e.assign('q', e.parse('v \\mapsto v^2+5'));
    const js = new JavaScriptTarget();
    const eq = js.compile(e.parse('q(2) = 9', { strict: false }));
    expect(eq.success).toBe(true);
    expect(eq.run!({})).toBe(true);
    const neq = js.compile(e.parse('q(2) \\ne 9', { strict: false }));
    expect(neq.success).toBe(true);
    expect(neq.run!({})).toBe(false);
  });

  it('At over a TYPED-collection application compiles (Tycho item 45)', () => {
    // `a(x)[1]` with `a(t) := [cos t, sin t]`: the operand is not a
    // SYNTACTIC list, but it types `vector<2>`, so the At handler's
    // `isIndexedCollectionOperand` gate passes and `_SYS.at` is emitted.
    const e = new ComputeEngine();
    e.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    const r = compile(e.parse('a(x)[1]'), { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.run!({ x: 0.3 })).toBeCloseTo(Math.cos(0.3), 12);
  });

  it('a collection-valued Sum body compiles element-wise with interpreter parity (Tycho item 45)', () => {
    // `Σ h(i)·(1/1.4^i)·a(…)` — the interpreter's elementwise zip-broadcast
    // Sum. This used to fail closed (the scalar accumulation would emit
    // `<array> + <array>` — NaN / string concatenation); the JS target now
    // folds the body through `_SYS.bcast` (2026-07-28), so it compiles and
    // must MATCH interpretation (see compile-elementwise-bigop.test.ts for
    // the systematic suite).
    const e = new ComputeEngine();
    e.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    e.parse(
      'h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)'
    ).evaluate();
    const sum = '\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))';
    const r = compile(e.parse(sum), { fallback: false })!;
    expect(r.success).toBe(true);
    e.pushScope();
    e.assign('t', 0.3);
    const want = e.parse(sum).N();
    e.popScope();
    const got = r.run!({ t: 0.3 }) as number[];
    expect(Array.isArray(got)).toBe(true);
    expect(got[0]).toBeCloseTo(want.ops![0].re, 10);
    expect(got[1]).toBeCloseTo(want.ops![1].re, 10);
  });

  it('chained (n-ary) Equal over a collection operand still fails closed (D6)', () => {
    // The pairwise `&&` conjunction is only sound over scalar booleans.
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(e.parse('d = m = m', { strict: false }))
    ).toThrow(/Fail closed/);
  });

  it('Same (Epsil `===`) has no lowering and fails closed (D6)', () => {
    // `Same` is a STRUCTURAL predicate: there is no sound numeric lowering of
    // it, and it must never borrow `Equal`'s tolerant `_SYS.eq` (which would
    // silently answer `true` for `sqrt(2) === 1.4142135623730951`). No target
    // declares a handler for it, so compilation fails closed with the head.
    const e = new ComputeEngine();
    e.declare('x', 'number');
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['Same', 'x', 1]))).toThrow(
      /Same.*no lowering.*Fail closed/s
    );
  });

  it('IdenticallyEqual (`\\equiv`) has no lowering and fails closed (D6)', () => {
    // The PROVER tier: deciding `IdenticallyEqual` means sampling and symbolic
    // expansion, which has no numeric lowering at all. Like `Same`, it must
    // never borrow `Equal`'s tolerant `_SYS.eq`.
    const e = new ComputeEngine();
    e.declare('x', 'number');
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['IdenticallyEqual', 'x', 1]))).toThrow(
      /IdenticallyEqual.*no lowering.*Fail closed/s
    );
  });

  it('Which with a collection condition selects element-wise (was fail-closed)', () => {
    // `d = m` broadcasts to `[False, False, False]`, so every position takes
    // the default arm. Element-wise selection landed 2026-07-27
    // (`_SYS.select`); see `compile-elementwise-which.test.ts`.
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const cases = e.parse('\\begin{cases}10^{9} & d = m \\\\ d\\end{cases}', {
      strict: false,
    });
    const r = js.compile(cases);
    expect(r.success).toBe(true);
    expect(r.run!()).toEqual([10, 20, 30]);
  });

  it('If over a NON-boolean collection condition fails closed at run time', () => {
    // `d` is `[10, 20, 30]`: not a condition value in any cell. The compile
    // succeeds (the shape is only knowable at run time), and `_SYS.select`
    // then throws the same message the interpreter does, rather than picking
    // a branch.
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const r = js.compile(e.box(['If', 'd', 1, 2]));
    expect(r.success).toBe(true);
    expect(() => r.run!()).toThrow(/Condition must evaluate/);
    expect(() => e.box(['If', 'd', 1, 2]).evaluate()).toThrow(
      /Condition must evaluate/
    );
  });

  it('the free-function compile() converts the throw to success:false + fallback', () => {
    // The chained collection Equal still fails closed (the binary form now
    // lowers — see the item-41 test above), so it exercises the conversion.
    const e = mkEngine();
    const r = compile(e.parse('d = m = m', { strict: false }));
    // Fallback path still returns a runnable interpreter-backed function.
    expect(r?.success).toBe(false);
    expect(typeof r?.run).toBe('function');
  });

  it('Reduce(d, Add, 0) compiles and runs to the fold (was: Unknown operator)', () => {
    const e = mkEngine();
    e.assign('d', e.parse('[1, 2, 3]').evaluate());
    const r = compile(e.box(['Reduce', 'd', 'Add', 0]), { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(6);
  });

  it('the \\sum_{i=d}^{d} d control fails closed on its list-valued BOUNDS', () => {
    // `d` is `[1, 2, 3]`, so the indexing set reads `i = [1,2,3] … [1,2,3]`:
    // ill-typed bounds. Both routes now say so. This used to answer 6 on both
    // routes because a collection-valued BODY was rewritten to
    // `Reduce(d, Add, 0)` before anything looked at the indexing set — the
    // rewrite that also made `Σ_{k=0}^{2} [k, 2]` answer `k + 2` (Tycho item
    // 121). The genuine `Reduce` control is the test above.
    const e = mkEngine();
    e.assign('d', e.parse('[1, 2, 3]').evaluate());
    const expr = e.parse('\\sum_{i=d}^{d}d', { strict: false });
    expect(expr.isValid).toBe(false);
    expect(expr.evaluate().toString()).toMatch(/incompatible-type/);
    // `fallback: false` surfaces the decline as a throw; with the fallback on
    // it is `success: false` plus an interpreter-backed `run()`.
    expect(() => compile(expr, { fallback: false })).toThrow(
      /Cannot compile invalid expression/
    );
    expect(compile(expr, { fallback: true })?.success).toBe(false);
  });

  it('an INDEXED Sum over a collection-valued body accumulates element-wise', () => {
    // The indexing set survives canonicalization, and the literal-list body
    // agrees with the list-valued CALL spelling (which always worked).
    const e = mkEngine();
    const expr = e.parse('\\sum_{k=0}^{2}\\lbrack k,2\\rbrack', {
      strict: false,
    });
    expect(expr.evaluate().toString()).toEqual('[3,6]');
    const r = compile(expr, { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.run!()).toEqual([3, 6]);
  });

  it('Reduce compiles Multiply/Min/Max folds', () => {
    const e = mkEngine();
    e.assign('d', e.parse('[1, 2, 3, 4]').evaluate());
    expect(
      compile(e.box(['Reduce', 'd', 'Multiply', 1]), { fallback: false })!
        .run!()
    ).toBe(24);
    expect(
      compile(e.box(['Reduce', 'd', 'Min']), { fallback: false })!.run!()
    ).toBe(1);
    expect(
      compile(e.box(['Reduce', 'd', 'Max']), { fallback: false })!.run!()
    ).toBe(4);
  });

  it('Reduce compiles a custom combiner when an initial value is present', () => {
    const e = mkEngine();
    // Function literal: f(acc, x) = acc + 2x over [1, 2, 3] from 0 → 12
    expect(
      runJs(e, [
        'Reduce',
        ['List', 1, 2, 3],
        ['Function', ['Add', 'a', ['Multiply', 2, 'b']], 'a', 'b'],
        0,
      ])
    ).toBe(12);
    // Operator symbol (via the operators table): ((0-10)-20)-30 → -60
    expect(runJs(e, ['Reduce', 'd', 'Subtract', 0])).toBe(-60);
    // User-defined function symbol resolves to the emitted `_fn_` local
    e.assign(
      'combine',
      e.box(['Function', ['Add', 'a', ['Multiply', 2, 'b']], 'a', 'b'])
    );
    expect(runJs(e, ['Reduce', ['List', 1, 2, 3], 'combine', 0])).toBe(12);
  });

  it('Fold canonicalizes to Reduce and compiles', () => {
    const e = mkEngine();
    expect(
      runJs(e, [
        'Fold',
        ['Function', ['Add', 'a', ['Multiply', 2, 'b']], 'a', 'b'],
        0,
        ['List', 1, 2, 3],
      ])
    ).toBe(12);
  });

  it('Reduce with a custom combiner but no initial value fails closed', () => {
    // Without an initial value the interpreter folds from `Nothing` (whose
    // effect depends on the combiner); a native seedless reduce would seed
    // with the first element — those diverge for non-commutative combiners.
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(
        e.box(['Reduce', 'd', ['Function', ['Subtract', 'a', 'b'], 'a', 'b']]),
        // The expression has no free variables, so constant folding would
        // evaluate it at compile time and never reach the lowering under test.
        { constantFold: false }
      )
    ).toThrow(/Fail closed/);
  });

  it('Reduce with a non-function combiner fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    // Undeclared symbol
    expect(() =>
      js.compile(e.box(['Reduce', 'd', 'w', 0]))
    ).toThrow(/Fail closed|invalid expression/);
    // A value-bound (non-function) symbol must fail at COMPILE time, not
    // produce `.reduce(<non-function>)` that throws at runtime
    e.assign('v', e.box(['Add', 'x', 1]));
    expect(() =>
      js.compile(e.box(['Reduce', 'd', 'v', 0]))
    ).toThrow(/Fail closed|invalid expression/);
  });

  it('a binary mapping function over ONE collection is rejected outright', () => {
    // Native `.map` passes `(x, index, array)`; the interpreter passes only
    // `(x)`. The compiled result therefore had to be NaN per element (missing
    // argument on a real target), never index-polluted values like
    // [10, 21, 32] — which is what this used to assert.
    //
    // Since the static callback-arity check (2026-08-15) the question no
    // longer arises for a decidable literal: `Map(f, xs)` supplies one
    // argument, so a binary literal is refused while the call is
    // canonicalized and never reaches any lowering. The index can no longer
    // leak because the shape that could leak it is not constructible.
    const e = mkEngine();
    const expr = e.box(['Map', ['Function', ['Add', 'x', 'y'], 'x', 'y'], 'd']);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain(
      'Map calls its callback with 1 argument (each element of the collection); `(x, y) => x + y` declares 2 parameters'
    );
    expect(() => runJs(e, expr)).toThrow(/invalid expression/);
  });

  it('Tabulate/Fill dimensions are rounded and clamped like the interpreter', () => {
    const e = mkEngine();
    e.declare('k', 'integer');
    const r = compile(e.box(['Tabulate', ['Function', 'i', 'i'], 'k']), {
      fallback: false,
    })!;
    // The interpreter rounds dimensions (toInteger); Array.from would truncate
    expect(r.run!({ k: 2.7 })).toEqual([1, 2, 3]);
    expect(r.run!({ k: -2 })).toEqual([]); // clamped to 0
    expect(r.run!({ k: NaN })).toEqual([]);
  });

  it('Tabulate/Fill evaluate the function and dimensions once (hoisted)', () => {
    const e = mkEngine();
    const r = compile(
      e.box([
        'Tabulate',
        ['Function', ['Add', ['Multiply', 10, 'i'], 'j'], 'i', 'j'],
        2,
        3,
      ]),
      { fallback: false }
    )!;
    // Dimensions and the lambda are IIFE parameters, evaluated once — an
    // impure dimension (e.g. Random) must not be re-evaluated per row.
    expect(r.code).toMatch(/^\(\(_f, _n, _m\) =>/);
  });

  it('Length compiles to array length (was: Unknown operator)', () => {
    const e = mkEngine();
    const r = compile(e.box(['Length', 'd']), { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(3);
  });

  it('At compiles 1-based access with negative-from-end and NaN out-of-range', () => {
    const e = mkEngine();
    expect(
      compile(e.box(['At', 'd', 1]), { fallback: false })!
        .run!()
    ).toBe(10);
    expect(
      compile(e.box(['At', 'd', 3]), { fallback: false })!
        .run!()
    ).toBe(30);
    expect(
      compile(e.box(['At', 'd', -1]), { fallback: false })!
        .run!()
    ).toBe(30);
    expect(
      compile(e.box(['At', 'd', -3]), { fallback: false })!
        .run!()
    ).toBe(10);
    expect(
      Number.isNaN(
        compile(e.box(['At', 'd', 0]), { fallback: false })!
          .run!() as number
      )
    ).toBe(true);
    expect(
      Number.isNaN(
        compile(e.box(['At', 'd', 4]), { fallback: false })!
          .run!() as number
      )
    ).toBe(true);
  });

  it('At with a nested/multi-index access fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const m = e.box(['List', ['List', 1, 2], ['List', 3, 4]]);
    expect(() =>
      // The matrix and indexes are all constant, so constant folding would
      // evaluate the access at compile time and never reach the lowering.
      js.compile(e.box(['At', m, 1, 2]), {
        constantFold: false,
      })
    ).toThrow(/Fail closed/);
  });

  // Tycho item 19.4: a fail-closed compile error must be reportable via the
  // documented `success: false` shape from `target.compile()`, not only as a
  // thrown exception. Default stays throwing (the low-level contract); the
  // caller opts into the failure shape with `fallback: true`.
  describe('target.compile() fallback contract (item 19.4)', () => {
    const mkDictEngine = () => {
      const e = new ComputeEngine();
      e.declare('d', 'dictionary<number>');
      return e;
    };

    it('an uncompilable At base throws by default from target.compile()', () => {
      const e = mkDictEngine();
      const js = new JavaScriptTarget();
      // A `dictionary` base type slips through boxing (At accepts
      // `dictionary | indexed_collection`) but is not an indexed collection at
      // compile time — the handler fails closed (D6).
      expect(() =>
        js.compile(e.box(['At', 'd', 1]))
      ).toThrow(/indexed collection.*Fail closed \(D6\)/);
    });

    it('with fallback:true returns success:false + the D6 message, without throwing', () => {
      const e = mkDictEngine();
      const js = new JavaScriptTarget();
      let r: ReturnType<JavaScriptTarget['compile']> | undefined;
      expect(() => {
        r = js.compile(e.box(['At', 'd', 1]), {
          fallback: true,
        });
      }).not.toThrow();
      expect(r!.success).toBe(false);
      expect(r!.error).toMatch(/indexed collection.*Fail closed \(D6\)/);
      expect(typeof r!.run).toBe('function');
    });

    it('the fallback run() still produces correct values via the interpreter', () => {
      const e = new ComputeEngine();
      // A real (non-indexed) dictionary value: `At` fails closed at compile
      // time, but the interpreter resolves the key correctly.
      e.assign('rec', e.box(['Dictionary', ['Tuple', { str: 'a' }, 7]]));
      const js = new JavaScriptTarget();
      const r = js.compile(e.box(['At', 'rec', { str: 'a' }]), {
        fallback: true,
        // `rec` has an assigned value, so constant folding would emit `7`
        // directly and bypass the fail-closed fallback contract under test.
        constantFold: false,
      });
      expect(r.success).toBe(false);
      expect(r.run!()).toBe(7);
    });

    it('an already-working compile is unaffected by fallback:true', () => {
      const e = new ComputeEngine();
      e.declare('v', 'vector<number>');
      const js = new JavaScriptTarget();
      const withFlag = js.compile(e.box(['At', 'v', 1]), { fallback: true });
      const without = js.compile(e.box(['At', 'v', 1]));
      expect(withFlag.success).toBe(true);
      expect(without.success).toBe(true);
      expect(withFlag.code).toBe(without.code);
    });
  });

  // The interval-js target reports an operator with no interval kernel as a
  // non-throwing `success: false` (from `compileToIntervalTarget`), so the
  // `compile()` wrapper's throwing `catch` never saw it — `fallback: true`
  // returned a bare failure with no `run`. And when a fallback WAS built, its
  // interpreter-backed `run` returned plain numbers, breaking the interval
  // contract (`.lo`/`.hi` were `undefined`).
  describe('interval-js target.compile() fallback contract', () => {
    // GammaRegularized has no `_IA` kernel; the argument is fully numeric so
    // the interpreter can still evaluate it. Q(1, 0.5) = e^{-0.5}.
    const expected = Math.exp(-0.5);

    it('without fallback returns a bare success:false (no run)', () => {
      const iv = new IntervalJavaScriptTarget();
      const r = iv.compile(ce.box(['GammaRegularized', 1, 0.5]));
      expect(r.success).toBe(false);
      expect(r.run).toBeUndefined();
    });

    it('with fallback:true returns success:false WITH an error and interval-shaped run', () => {
      const iv = new IntervalJavaScriptTarget();
      let r: ReturnType<IntervalJavaScriptTarget['compile']> | undefined;
      expect(() => {
        r = iv.compile(ce.box(['GammaRegularized', 1, 0.5]), {
          fallback: true,
        });
      }).not.toThrow();
      expect(r!.success).toBe(false);
      expect(typeof r!.error).toBe('string');
      expect(r!.error!.length).toBeGreaterThan(0);
      expect(typeof r!.run).toBe('function');

      const out = r!.run!() as { lo: number; hi: number };
      expect(out.lo).toBeCloseTo(expected, 10);
      expect(out.hi).toBeCloseTo(expected, 10);
    });

    it('the fallback run honors interval-shaped inputs (collapses to midpoint)', () => {
      const iv = new IntervalJavaScriptTarget();
      const r = iv.compile(ce.box(['GammaRegularized', 1, 'x']), {
        fallback: true,
      });
      expect(r.success).toBe(false);
      // A point interval and a bare number produce the same degenerate result.
      const viaInterval = r.run!({ x: { lo: 0.5, hi: 0.5 } }) as {
        lo: number;
        hi: number;
      };
      const viaNumber = r.run!({ x: 0.5 }) as { lo: number; hi: number };
      expect(viaInterval.lo).toBeCloseTo(expected, 10);
      expect(viaInterval.hi).toBeCloseTo(expected, 10);
      expect(viaNumber.lo).toBeCloseTo(expected, 10);
    });
  });

  // List-shaped collection operators (Last/Rest/Take/Drop/Join/Reverse/Sort/
  // IndexOf/Map/Filter) — previously `Unknown operator`, now native array ops.
  // `d = [10, 20, 30]`. Values checked against the interpreter's materialized
  // result.
  const runJs = (e: ComputeEngine, mathjson: any) => {
    // These cases are built from constant collections; the point of each is to
    // exercise the compiled lowering of the operator, so constant folding —
    // which would answer from the interpreter at compile time — is disabled.
    const r = compile(e.box(mathjson), {
      fallback: false,
      constantFold: false,
    })!;
    expect(r.success).toBe(true);
    return r.run!();
  };

  it('Last compiles to the final element', () => {
    expect(runJs(mkEngine(), ['Last', 'd'])).toBe(30);
  });

  it('Rest / Take / Drop compile to slices (count clamped ≥ 0)', () => {
    const e = mkEngine();
    expect(runJs(e, ['Rest', 'd'])).toEqual([20, 30]);
    expect(runJs(e, ['Take', 'd', 2])).toEqual([10, 20]);
    expect(runJs(e, ['Take', 'd', -1])).toEqual([]); // negative → []
    expect(runJs(e, ['Take', 'd', 9])).toEqual([10, 20, 30]); // past end → all
    expect(runJs(e, ['Drop', 'd', 1])).toEqual([20, 30]);
    expect(runJs(e, ['Drop', 'd', -1])).toEqual([10, 20, 30]); // negative → all
    expect(runJs(e, ['Drop', 'd', 9])).toEqual([]); // past end → []
  });

  it('Reverse / Sort compile (source not mutated)', () => {
    const e = mkEngine();
    expect(runJs(e, ['Reverse', 'd'])).toEqual([30, 20, 10]);
    expect(runJs(e, ['Sort', e.box(['List', 3, 1, 2, -5])])).toEqual([
      -5, 1, 2, 3,
    ]);
    // `d` itself is unchanged after Reverse/Sort
    expect(runJs(e, ['At', 'd', 1])).toBe(10);
  });

  it('Join concatenates the elements of each collection operand', () => {
    const e = mkEngine();
    expect(runJs(e, ['Join', 'd', e.box(['List', 40, 50])])).toEqual([
      10, 20, 30, 40, 50,
    ]);
  });

  it('IndexOf compiles to a 1-based index (0 when absent)', () => {
    const e = mkEngine();
    expect(runJs(e, ['IndexOf', 'd', 20])).toBe(2);
    expect(runJs(e, ['IndexOf', 'd', 99])).toBe(0);
  });

  it('Map / Filter compile the lambda and use native map/filter', () => {
    const e = mkEngine();
    expect(
      runJs(e, ['Map', ['Function', ['Divide', 'x', 10], 'x'], 'd'])
    ).toEqual([1, 2, 3]);
    expect(
      runJs(e, ['Filter', 'd', ['Function', ['Greater', 'x', 15], 'x']])
    ).toEqual([20, 30]);
  });

  it('CountIf / Find / IndexWhere / Position compile the predicate lambda', () => {
    const e = mkEngine();
    const gt15 = ['Function', ['Greater', 'x', 15], 'x'];
    const gt99 = ['Function', ['Greater', 'x', 99], 'x'];
    expect(runJs(e, ['CountIf', 'd', gt15])).toBe(2);
    expect(runJs(e, ['Find', 'd', gt15])).toBe(20);
    // No match → NaN (the interpreter's `Nothing` projected onto a real target)
    expect(Number.isNaN(runJs(e, ['Find', 'd', gt99]) as number)).toBe(true);
    // 1-based index of the first match, or 0 when absent
    expect(runJs(e, ['IndexWhere', 'd', gt15])).toBe(2);
    expect(runJs(e, ['IndexWhere', 'd', gt99])).toBe(0);
    // All 1-based indexes of the matches
    expect(runJs(e, ['Position', 'd', gt15])).toEqual([2, 3]);
    expect(runJs(e, ['Position', 'd', gt99])).toEqual([]);
  });

  it('Tabulate compiles 1-based 1-D and 2-D forms', () => {
    const e = mkEngine();
    expect(
      runJs(e, ['Tabulate', ['Function', ['Square', 'i'], 'i'], 5])
    ).toEqual([1, 4, 9, 16, 25]);
    expect(
      runJs(e, [
        'Tabulate',
        ['Function', ['Add', ['Multiply', 10, 'i'], 'j'], 'i', 'j'],
        2,
        3,
      ])
    ).toEqual([
      [11, 12, 13],
      [21, 22, 23],
    ]);
  });

  it('Table (alias + iterator specs) canonicalizes and compiles', () => {
    const e = mkEngine();
    // All-ones iterator → Tabulate
    expect(runJs(e, ['Table', ['Square', 'i'], ['Set', 'i', 1, 4]])).toEqual([
      1, 4, 9, 16,
    ]);
    // General lo/step iterator → Map over Range
    expect(runJs(e, ['Table', 'i', ['Set', 'i', 0, 10, 5]])).toEqual([
      0, 5, 10,
    ]);
  });

  it('Fill compiles to a rows×cols matrix of f(i, j), 1-based', () => {
    const e = mkEngine();
    expect(
      runJs(e, [
        'Fill',
        ['Function', ['Add', ['Multiply', 10, 'i'], 'j'], 'i', 'j'],
        ['Tuple', 2, 2],
      ])
    ).toEqual([
      [11, 12],
      [21, 22],
    ]);
  });

  // `Repeat(value, count)`. Every expectation below was checked against the
  // interpreter: `Repeat(7, 3)` → [7,7,7], `Repeat(7, 0)` → [],
  // `Repeat(7, -1)` → [].
  it('Repeat compiles to a list of n copies, clamped like the interpreter', () => {
    const e = mkEngine();
    expect(runJs(e, ['Repeat', 7, 3])).toEqual([7, 7, 7]);
    expect(runJs(e, ['Repeat', 7, 0])).toEqual([]);
    expect(runJs(e, ['Repeat', 7, -1])).toEqual([]);
    expect(runJs(e, ['Repeat', ['List', 1, 2], 3])).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    // Composes with the other collection folds.
    expect(runJs(e, ['Length', ['Repeat', 7, 5]])).toBe(5);
    expect(runJs(e, ['Sum', ['Repeat', 3, 4]])).toBe(12);
  });

  it('Repeat: a runtime count is rounded, clamped and finite-guarded', () => {
    const e = mkEngine();
    e.declare('k', 'integer');
    e.declare('v', 'real');
    const r = compile(e.box(['Repeat', 'v', 'k']), { fallback: false })!;
    expect(r.run!({ v: 9, k: 4 })).toEqual([9, 9, 9, 9]);
    expect(r.run!({ v: 9, k: 2.7 })).toEqual([9, 9, 9]); // rounded, like toInteger
    expect(r.run!({ v: 9, k: -2 })).toEqual([]); // clamped to 0
    expect(r.run!({ v: 9, k: NaN })).toEqual([]);
    expect(r.run!({ v: 9, k: Infinity })).toEqual([]); // no unbounded allocation
    // The value is an IIFE parameter, evaluated once (see the draw-count
    // regression in random-compile.test.ts).
    expect(r.code).toMatch(/^\(\(_v, _n\) =>/);
  });

  // `Repeat`'s `count` parameter is declared `integer`, which since the
  // finite-by-default flip means a FINITE integer, so `Repeat(7, +∞)` is now
  // rejected at the signature: the count operand is replaced by an
  // `incompatible-type` error and the whole expression types `error`. The
  // interpreter therefore never produces a list here, and `compile()` must
  // still refuse — it does, because an expression carrying an error is not
  // compilable at all. A count that is non-finite only at RUN time keeps the
  // `[]` projection above.
  it('Repeat: a statically non-finite count is rejected, and compile refuses', () => {
    const e = mkEngine();
    const inf = e.box(['Repeat', 7, 'PositiveInfinity']);
    expect(inf.type.toString()).toBe('error');
    expect(inf.evaluate().toString()).toBe(
      'Repeat(7, Error(ErrorCode("incompatible-type", "integer", "+oo"), +oo))'
    );
    expect(() => compile(inf, { fallback: false })).toThrow(
      /Cannot compile invalid expression/
    );
    expect(() =>
      compile(e.box(['Repeat', 7, 'NegativeInfinity']), { fallback: false })
    ).toThrow(/Cannot compile invalid expression/);
  });

  it('Repeat: the 1-argument (infinite) form fails closed', () => {
    const e = mkEngine();
    expect(() => compile(e.box(['Repeat', 7]), { fallback: false })).toThrow(
      /Fail closed/
    );
  });

  // Native-array collection operators (Tier 2). Every value below was
  // verified against the interpreter's evaluate() result.
  it('Append / Most / Slice compile to native array operations', () => {
    const e = mkEngine();
    expect(runJs(e, ['Append', 'd', 9])).toEqual([10, 20, 30, 9]);
    expect(runJs(e, ['Most', 'd'])).toEqual([10, 20]);
    expect(runJs(e, ['Most', ['List', 7]])).toEqual([]);
    // Slice is 1-based inclusive; negative indexes count from the end;
    // start of 0 resolves past the end (empty), like the interpreter
    expect(runJs(e, ['Slice', 'd', 2, 3])).toEqual([20, 30]);
    expect(runJs(e, ['Slice', 'd', -2, -1])).toEqual([20, 30]);
    expect(runJs(e, ['Slice', 'd', 0, 99])).toEqual([]);
    expect(runJs(e, ['Slice', 'd', 3, 2])).toEqual([]);
  });

  // The `(indexed_collection<T>, range)` arm (docs/STRING_ROADMAP.md, Phase
  // 0c): `Slice(xs, r)` is `Slice(xs, First(r), Last(r))`, and the `range`
  // type guarantees an ascending step-1 span with first ≥ 1, so the lowering
  // only needs the end clamped (native `slice` does that) and a start past
  // the end to yield []. Every value verified against the interpreter.
  it('Slice with a range span compiles to a native slice', () => {
    const e = mkEngine();
    expect(runJs(e, ['Slice', 'd', ['Range', 2, 3]])).toEqual([20, 30]);
    expect(runJs(e, ['Slice', 'd', ['Range', 1, 1]])).toEqual([10]);
    expect(runJs(e, ['Slice', 'd', ['Range', 2, 99]])).toEqual([20, 30]);
    expect(runJs(e, ['Slice', 'd', ['Range', 4, 6]])).toEqual([]);
    // A symbol typed `range` compiles through the same arm; the span is a
    // runtime argument.
    e.declare('r', 'range');
    const r = compile(e.box(['Slice', 'd', 'r']), {
      fallback: false,
      constantFold: false,
    })!;
    expect(r.success).toBe(true);
    expect(r.run!({ r: [2, 3] })).toEqual([20, 30]);
    expect(r.run!({ r: [3, 4, 5] })).toEqual([30]);
    // The static type does not vouch for the VALUE handed to `run()`: a
    // stepped, descending, empty, fractional, or non-array span is a
    // run-time RangeError (fail loudly), never a silent slice — mirroring
    // the interpreter's `spanBounds`, which declines such a value.
    for (const bad of [[2, 4], [5, 2], [], [1.5, 2.5], [0, 1], [1, 100, 3], 7])
      expect(() => r.run!({ r: bad })).toThrow(RangeError);
    // A descending or stepped Range is not a `range` (it types
    // `indexed_collection<integer>`). Since the R1 overlap admission (§4.4
    // of `docs/plans/2026-08-22-type-handlers-on-types.md`) it BOXES —
    // provisional admission, the application stays inert at evaluation —
    // so the compiler is the gate: its Slice arm fails CLOSED on a
    // non-`range` span, never a silent mis-slice.
    for (const span of [['Range', 3, 2], ['Range', 1, 3, 2]] as const) {
      const inert = e.box(['Slice', 'd', span as any]);
      expect(inert.isValid).toBe(true);
      expect(() =>
        compile(inert, { fallback: false, constantFold: false })
      ).toThrow(/ascending index span/);
    }
  });

  it('IsEmpty / Count / Contains / Unique compile', () => {
    const e = mkEngine();
    // IsEmpty/Contains are boolean-valued, and the runner hands a boolean
    // back as a boolean (CO-P2-25).
    const runBool = (mathjson: any) =>
      compile(e.box(mathjson), { fallback: false })!.run!();
    expect(runBool(['IsEmpty', 'd'])).toBe(false);
    expect(runBool(['IsEmpty', ['List']])).toBe(true);
    expect(runJs(e, ['Count', 'd'])).toBe(3);
    expect(runBool(['Contains', 'd', 20])).toBe(true);
    expect(runBool(['Contains', 'd', 99])).toBe(false);
    expect(runJs(e, ['Unique', ['List', 3, 1, 3, 2, 1]])).toEqual([3, 1, 2]);
  });

  it('RotateLeft / RotateRight normalize the shift like the interpreter', () => {
    const e = mkEngine();
    expect(runJs(e, ['RotateLeft', 'd', 2])).toEqual([30, 10, 20]);
    expect(runJs(e, ['RotateLeft', 'd'])).toEqual([20, 30, 10]); // default 1
    expect(runJs(e, ['RotateLeft', 'd', -1])).toEqual([30, 10, 20]);
    expect(runJs(e, ['RotateLeft', 'd', 5])).toEqual([30, 10, 20]); // mod len
    expect(runJs(e, ['RotateRight', 'd', 2])).toEqual([20, 30, 10]);
    expect(runJs(e, ['RotateRight', 'd'])).toEqual([30, 10, 20]); // default 1
  });

  it('Zip truncates to the shortest input', () => {
    const e = mkEngine();
    expect(runJs(e, ['Zip', 'd', ['List', 1, 2]])).toEqual([
      [10, 1],
      [20, 2],
    ]);
    expect(
      runJs(e, ['Zip', ['List', 1, 2], ['List', 10, 20], ['List', 100, 200]])
    ).toEqual([
      [1, 10, 100],
      [2, 20, 200],
    ]);
  });

  it('Linspace includes both endpoints (count 1 → [start])', () => {
    const e = mkEngine();
    expect(runJs(e, ['Linspace', 0, 1, 5])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(runJs(e, ['Linspace', 0, 10, 1])).toEqual([0]);
    expect(runJs(e, ['Linspace', 10, 0, 3])).toEqual([10, 5, 0]);
  });

  it('Chunk / Partition mirror the interpreter (k groups / size-n chunks)', () => {
    const e = mkEngine();
    const L = ['List', 1, 5, 2, 4, 3];
    // Chunk(xs, k): k nearly-equal GROUPS of ceil(len/k)
    expect(runJs(e, ['Chunk', L, 2])).toEqual([
      [1, 5, 2],
      [4, 3],
    ]);
    // k > len produces trailing empty chunks, like the interpreter
    expect(runJs(e, ['Chunk', ['List', 1, 2, 3], 5])).toEqual([
      [1],
      [2],
      [3],
      [],
      [],
    ]);
    // Partition(xs, n): chunks of SIZE n; trailing chunk may be shorter
    expect(runJs(e, ['Partition', L, 2])).toEqual([[1, 5], [2, 4], [3]]);
    // Partition(xs, n, step): complete sliding windows only
    expect(runJs(e, ['Partition', L, 2, 1])).toEqual([
      [1, 5],
      [5, 2],
      [2, 4],
      [4, 3],
    ]);
    expect(runJs(e, ['Partition', ['List', 1, 2, 3, 4, 5, 6], 2, 3])).toEqual([
      [1, 2],
      [4, 5],
    ]);
    // Predicate form: [[matching], [non-matching]]
    expect(
      runJs(e, ['Partition', L, ['Function', ['Greater', 'x', 2], 'x']])
    ).toEqual([
      [5, 4, 3],
      [1, 2],
    ]);
  });

  it('Ordering returns 1-based sorting indexes, stable for ties', () => {
    const e = mkEngine();
    expect(runJs(e, ['Ordering', ['List', 30, 10, 20]])).toEqual([2, 3, 1]);
    expect(runJs(e, ['Ordering', ['List', 2, 1, 2, 1]])).toEqual([2, 4, 1, 3]);
  });

  it('RandomShuffle compiles to an unbiased permutation of the source', () => {
    const e = mkEngine();
    const v = runJs(e, ['RandomShuffle', 'd']) as number[];
    expect([...v].sort((a, b) => a - b)).toEqual([10, 20, 30]);
    // the source is not mutated
    expect(runJs(e, ['At', 'd', 1])).toBe(10);
  });

  it('Contains / Unique fail closed for compound element types', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const nested = ['List', ['List', 1], ['List', 1]];
    // The operands are constant, so constant folding would evaluate these at
    // compile time and never reach the fail-closed lowering under test.
    expect(() =>
      js.compile(e.box(['Unique', nested]), {
        constantFold: false,
      })
    ).toThrow(/Fail closed/);
    expect(() =>
      js.compile(e.box(['Contains', nested, ['List', 1]]), {
        constantFold: false,
      })
    ).toThrow(/Fail closed/);
  });

  it('non-finite runtime counts/indexes use the interpreter defaults', () => {
    const e = mkEngine();
    e.declare('k', 'integer');
    // Slice: a non-finite start defaults to 1 (like toInteger ?? 1)
    const sl = compile(e.box(['Slice', 'd', 'k', 3]), { fallback: false })!;
    expect(sl.run!({ k: Infinity })).toEqual([10, 20, 30]);
    // Rotate: a non-finite shift defaults to 1
    const rl = compile(e.box(['RotateLeft', 'd', 'k']), { fallback: false })!;
    expect(rl.run!({ k: Infinity })).toEqual([20, 30, 10]);
    // Linspace: a non-finite count defaults to 50 (no RangeError)
    const ls = compile(e.box(['Linspace', 0, 1, 'k']), { fallback: false })!;
    expect((ls.run!({ k: Infinity }) as number[]).length).toBe(50);
    // Chunk: a non-finite or non-positive runtime count projects to []
    const ch = compile(e.box(['Chunk', 'd', 'k']), { fallback: false })!;
    expect(ch.run!({ k: NaN })).toEqual([]);
    expect(ch.run!({ k: -2 })).toEqual([]);
  });

  it('a statically non-positive Chunk/Partition count fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['Chunk', 'd', -2]))).toThrow(/Fail closed/);
    expect(() =>
      js.compile(e.box(['Partition', 'd', 0]))
    ).toThrow(/Fail closed/);
  });

  // The compile-time bake path (`ce.randomSeed`) was removed by the
  // 2026-07-25 Random family redesign: every compiled draw goes through the
  // frame-aware `_SYS.drawNextRandomNumber()`, which is live outside a
  // `WithRandomSeed` frame. Framed bit-parity lives in `random-compile.test.ts`.
  it('an unframed compiled RandomShuffle is live (a permutation each call)', () => {
    const e = mkEngine();
    const r = compile(e.box(['RandomShuffle', 'd']), { fallback: false })!;
    for (let i = 0; i < 4; i++)
      expect([...(r.run!() as number[])].sort((x, y) => x - y)).toEqual([
        10, 20, 30,
      ]);
  });

  it('custom Ordering function and an unsupported Random domain fail closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    // `constantFold: false`: `d` is an assigned literal list, so the whole
    // `Ordering` is a constant subtree that compile-time folding would
    // otherwise evaluate and emit as a literal, never reaching the
    // custom-comparator refusal under test.
    expect(() =>
      js.compile(
        e.box(['Ordering', 'd', ['Function', ['Greater', 'a', 'b'], 'a', 'b']]),
        { constantFold: false }
      )
    ).toThrow(/Fail closed/);
    // `Interval` and `Range` lower to descriptors and a literal list to the JS
    // array it already is; every other collection domain fails closed (D6).
    expect(() =>
      js.compile(e.box(['Random', ['Set', 1, 2, 3]]))
    ).toThrow(/Fail closed/);
  });

  // Higher-order collection operators (Any/All/TakeWhile/DropWhile/FlatMap/
  // Scan) and core scalars (Boole/KroneckerDelta/Element/Identity/Apply).
  // Values verified against the interpreter.
  it('Any / All compile the predicate to native some/every', () => {
    const e = mkEngine();
    const gt15 = ['Function', ['Greater', 'x', 15], 'x'];
    const runBool = (mathjson: any) =>
      compile(e.box(mathjson), { fallback: false })!.run!();
    expect(runBool(['Any', 'd', gt15])).toBe(true);
    expect(runBool(['Any', ['List'], gt15])).toBe(false); // vacuous
    expect(runBool(['All', 'd', gt15])).toBe(false);
    expect(runBool(['All', ['List'], gt15])).toBe(true); // vacuous
  });

  it('TakeWhile / DropWhile / FlatMap compile', () => {
    const e = mkEngine();
    const lt25 = ['Function', ['Less', 'x', 25], 'x'];
    expect(runJs(e, ['TakeWhile', 'd', lt25])).toEqual([10, 20]);
    expect(runJs(e, ['DropWhile', 'd', lt25])).toEqual([30]);
    expect(
      runJs(e, [
        'FlatMap',
        ['List', 1, 2],
        ['Function', ['List', 'x', ['Multiply', 10, 'x']], 'x'],
      ])
    ).toEqual([1, 10, 2, 20]);
    // A scalar-valued mapping is kept as-is (native flatMap semantics)
    expect(
      runJs(e, [
        'FlatMap',
        ['List', 1, 2],
        ['Function', ['Multiply', 10, 'x'], 'x'],
      ])
    ).toEqual([10, 20]);
  });

  it('Scan compiles the running fold (initial value not emitted)', () => {
    const e = mkEngine();
    const sub = ['Function', ['Subtract', 'a', 'b'], 'a', 'b'];
    expect(
      runJs(e, [
        'Scan',
        ['List', 1, 2, 3],
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
        0,
      ])
    ).toEqual([1, 3, 6]);
    // No initial value: first element seeds and is emitted as-is
    expect(runJs(e, ['Scan', ['List', 10, 2, 3], sub])).toEqual([10, 8, 5]);
    expect(runJs(e, ['Scan', ['List', 10, 2, 3], sub, 0])).toEqual([
      -10, -12, -15,
    ]);
    expect(runJs(e, ['Scan', ['List', 1, 2, 3], 'Add'])).toEqual([1, 3, 6]);
  });

  it('Boole / KroneckerDelta / Element / Identity / Apply compile', () => {
    const e = mkEngine();
    expect(runJs(e, ['Boole', ['Greater', 3, 2]])).toBe(1);
    expect(runJs(e, ['Boole', ['Greater', 2, 3]])).toBe(0);
    expect(runJs(e, ['KroneckerDelta', 0])).toBe(1);
    expect(runJs(e, ['KroneckerDelta', 3])).toBe(0);
    expect(runJs(e, ['KroneckerDelta', 4, 4])).toBe(1);
    expect(runJs(e, ['KroneckerDelta', 4, 5])).toBe(0);
    expect(runJs(e, ['KroneckerDelta', 4, 4, 4])).toBe(1);
    expect(runJs(e, ['KroneckerDelta', 4, 4, 5])).toBe(0);
    const runBool = (mathjson: any) =>
      compile(e.box(mathjson), { fallback: false })!.run!();
    expect(runBool(['Element', 20, 'd'])).toBe(true);
    expect(runBool(['Element', 99, 'd'])).toBe(false);
    expect(runJs(e, ['Identity', 42])).toBe(42);
    expect(
      runJs(e, ['Apply', ['Function', ['Multiply', 'x', 2], 'x'], 21])
    ).toBe(42);
  });

  // Linear algebra (parity with the Python target). Values verified against
  // the interpreter.
  it('Dot / MatrixMultiply dispatch on dimensionality', () => {
    const e = mkEngine();
    const M = ['List', ['List', 1, 2], ['List', 3, 4]];
    const M23 = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];
    expect(runJs(e, ['Dot', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toBe(32);
    expect(runJs(e, ['Dot', M, M])).toEqual([
      [7, 10],
      [15, 22],
    ]);
    expect(runJs(e, ['MatrixMultiply', M23, ['List', 1, 2, 3]])).toEqual([
      14, 32,
    ]);
    expect(runJs(e, ['MatrixMultiply', ['List', 1, 2], M23])).toEqual([
      9, 12, 15,
    ]);
    expect(
      runJs(e, ['MatrixMultiply', ['List', 1, 2, 3], ['List', 4, 5, 6]])
    ).toBe(32);
  });

  it('Cross / Norm / Trace compile', () => {
    const e = mkEngine();
    expect(runJs(e, ['Cross', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toEqual([
      -3, 6, -3,
    ]);
    expect(runJs(e, ['Norm', ['List', 1, 2, 3]])).toBeCloseTo(
      Math.sqrt(14),
      12
    );
    expect(runJs(e, ['Norm', -5])).toBe(5);
    // Frobenius norm of a matrix; L1 norm with an explicit p
    expect(
      runJs(e, ['Norm', ['List', ['List', 1, 2], ['List', 3, 4]]])
    ).toBeCloseTo(Math.sqrt(30), 12);
    expect(runJs(e, ['Norm', ['List', 1, 2, 3], 1])).toBe(6);
    expect(runJs(e, ['Trace', ['List', ['List', 1, 2], ['List', 3, 4]]])).toBe(
      5
    );
  });

  it('Transpose / Determinant / Inverse compile', () => {
    const e = mkEngine();
    const M = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(
      runJs(e, ['Transpose', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    // A vector transposes to itself, like the interpreter
    expect(runJs(e, ['Transpose', ['List', 1, 2, 3]])).toEqual([1, 2, 3]);
    expect(runJs(e, ['Determinant', M])).toBe(-2);
    expect(
      runJs(e, [
        'Determinant',
        ['List', ['List', 2, 0, 1], ['List', 1, 3, 2], ['List', 1, 1, 1]],
      ])
    ).toBe(0);
    const inv = runJs(e, ['Inverse', M]) as number[][];
    expect(inv[0][0]).toBeCloseTo(-2, 12);
    expect(inv[0][1]).toBeCloseTo(1, 12);
    expect(inv[1][0]).toBeCloseTo(1.5, 12);
    expect(inv[1][1]).toBeCloseTo(-0.5, 12);
    // A singular matrix yields NaN (interpreter stays inert)
    expect(
      Number.isNaN(
        runJs(e, [
          'Inverse',
          ['List', ['List', 1, 2], ['List', 2, 4]],
        ]) as number
      )
    ).toBe(true);
  });

  it('Range with no explicit step auto-descends, like the interpreter', () => {
    const e = mkEngine();
    expect(runJs(e, ['Range', 5, 1])).toEqual([5, 4, 3, 2, 1]);
    expect(runJs(e, ['Range', -2])).toEqual([1, 0, -1, -2]);
    expect(runJs(e, ['Range', 2, 6])).toEqual([2, 3, 4, 5, 6]);
    // Symbolic bounds resolve the direction at runtime
    e.declare('p', 'integer');
    e.declare('q', 'integer');
    const r = compile(e.box(['Range', 'p', 'q']), { fallback: false })!;
    expect(r.run!({ p: 5, q: 1 })).toEqual([5, 4, 3, 2, 1]);
    expect(r.run!({ p: 2, q: 4 })).toEqual([2, 3, 4]);
  });

  it('Norm matrix forms use operator norms; unsupported forms fail closed', () => {
    const e = mkEngine();
    const M = ['List', ['List', 1, 2], ['List', 3, 4]];
    // p = 1 on a matrix is the max column abs sum (not the flattened L1)
    expect(runJs(e, ['Norm', M, 1])).toBe(6);
    // "Frobenius" is the default matrix norm
    expect(runJs(e, ['Norm', M, { str: 'Frobenius' }])).toBeCloseTo(
      Math.sqrt(30),
      12
    );
    // The spectral 2-norm needs an SVD — NaN, never a silently-wrong number
    expect(Number.isNaN(runJs(e, ['Norm', M, 2]) as number)).toBe(true);
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(e.box(['Norm', M, { str: 'Nuclear' }]), {
        constantFold: false,
      })
    ).toThrow(/Fail closed/);
  });

  it('rank > 2 Trace yields NaN; explicit Transpose/Trace axes fail closed', () => {
    const e = mkEngine();
    const rank3 = [
      'List',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', ['List', 5, 6], ['List', 7, 8]],
    ];
    // Was: "01,27,8" — string concatenation behind success:true
    expect(Number.isNaN(runJs(e, ['Trace', rank3]) as number)).toBe(true);
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(
        e.box(['Transpose', ['List', ['List', 1, 2], ['List', 3, 4]], 1, 2])
      )
    ).toThrow(/Fail closed/);
  });

  it('Flatten / Shape / Reshape compile', () => {
    const e = mkEngine();
    const deep = ['List', ['List', ['List', 1, 2], ['List', 3]], ['List', 4]];
    expect(
      runJs(e, ['Flatten', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(runJs(e, ['Flatten', deep])).toEqual([1, 2, 3, 4]);
    expect(runJs(e, ['Flatten', deep, 1])).toEqual([[1, 2], [3], 4]);
    expect(
      runJs(e, ['Shape', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
    ).toEqual([2, 3]);
    expect(runJs(e, ['Shape', ['List', 1, 2, 3]])).toEqual([3]);
    expect(
      runJs(e, ['Reshape', ['List', 1, 2, 3, 4, 5, 6], ['Tuple', 2, 3]])
    ).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    // Cyclic padding, like the interpreter
    expect(
      runJs(e, ['Reshape', ['List', 1, 2, 3, 4, 5], ['Tuple', 2, 3]])
    ).toEqual([
      [1, 2, 3],
      [4, 5, 1],
    ]);
  });

  it('a custom Sort comparator fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(
        e.box(['Sort', 'd', ['Function', ['Subtract', 'b', 'a'], 'a', 'b']]),
        // `constantFold: false`: `d` is an assigned literal list, so the
        // whole `Sort` is a constant subtree that compile-time folding would
        // otherwise evaluate and emit as a literal, never reaching the
        // custom-comparator refusal under test.
        { constantFold: false }
      )
    ).toThrow(/Fail closed/);
  });

  it('a non-indexed / non-collection operand fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    // A non-indexed `set` cannot lower to a JS array. It no longer reaches
    // the compile handler's own check: `Last` declares an `indexed_collection`
    // parameter (like `Take`/`Drop`/`At`), so the set is refused at
    // canonicalization and the operand is an `Error`. Either way, closed.
    expect(() =>
      js.compile(e.box(['Last', ['Set', 1, 2, 3]]))
    ).toThrow(/incompatible-type/);
    // A scalar operand is rejected earlier by the type system (still closed).
    expect(() => js.compile(e.box(['Reverse', 'm']))).toThrow();
  });
});

describe('COMPILE removed targets', () => {
  it('does not register the removed interval-glsl target', () => {
    const e = new ComputeEngine();
    expect(e._getCompilationTarget('interval-glsl')).toBeUndefined();
    expect(e._listCompilationTargets()).not.toContain('interval-glsl');
  });

  it('throws an unregistered-target error when fallback is disabled', () => {
    const e = new ComputeEngine();
    expect(() =>
      compile(e.parse('x^2 + y^2'), { to: 'interval-glsl', fallback: false })
    ).toThrow(/interval-glsl.*not registered/i);
  });
});

// A symbol whose engine definition is a function literal (`f(x) := …`, `x ↦ …`,
// or `ce.assign(name, lambda)`) used as an operator (`f(2)`) must compile: it is
// emitted as a named local function `_fn_f` in the preamble and the call site as
// `_fn_f(arg)`. Nested/user-calls-user chains resolve in dependency order;
// (mutually) recursive definitions fail closed (D6); a truly unknown operator
// keeps throwing.
describe('COMPILE user-defined function calls', () => {
  it('compiles a call to a := -defined function (f(2) ≈ 0.1353)', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq e^{-x^2/2}').evaluate();
    const js = new JavaScriptTarget();
    // The call has a constant argument, so constant folding would emit the
    // numeric result instead of the `_fn_f` local this test is pinning.
    const r = js.compile(e.box(['f', 2]), {
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_fn_f(2)');
    expect(r.run(2 as unknown as Record<string, number>)).toBeCloseTo(
      0.1353352832366127,
      12
    );
  });

  it('compiles a call to an ce.assign(name, x ↦ …) lambda', () => {
    const e = new ComputeEngine();
    e.assign('n', e.parse('x \\mapsto x^2 + 1'));
    const js = new JavaScriptTarget();
    const r = js.compile(e.box(['n', 3]));
    expect(r.success).toBe(true);
    expect(r.run(3 as unknown as Record<string, number>)).toBeCloseTo(10, 12);
  });

  it('compiles nested user-calls-user chains, matching evaluate()/N()', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq e^{-x^2/2}').evaluate();
    e.parse('g(x) \\coloneq f(x) + 1').evaluate();
    const js = new JavaScriptTarget();
    for (const x of [0, 1, 2, -1.5]) {
      const r = js.compile(e.box(['g', ['f', x]]));
      expect(r.success).toBe(true);
      const want = e.box(['g', ['f', x]]).N().re;
      expect(r.run(x as unknown as Record<string, number>)).toBeCloseTo(
        want,
        10
      );
    }
  });

  it('reuses one named local across multiple call sites', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq e^{-x^2/2}').evaluate();
    const js = new JavaScriptTarget();
    // f appears twice; both call sites reference the same `_fn_f` local (emitted
    // once into the preamble — keyed by name in the userFunctions registry).
    // Both call sites have constant arguments, so constant folding would emit a
    // single literal instead of the two `_fn_f` references this test counts.
    const r = js.compile(e.box(['Add', ['f', 1], ['f', 2]]), {
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code.match(/_fn_f\(/g)?.length ?? 0).toBe(2);
    const want = e.box(['Add', ['f', 1], ['f', 2]]).N().re;
    expect(r.run({})).toBeCloseTo(want, 12);
  });

  // Recursive definitions compile to true self-reference by emitted name.
  // Termination
  // is backstopped by the JS call stack: runaway recursion throws a catchable
  // RangeError, consistent with compiled unbounded Loop being unguarded.
  it('compiles a directly recursive definition (fact(5) = 120)', () => {
    const e = new ComputeEngine();
    e.parse(
      '\\mathrm{fact}(n) \\coloneq \\mathrm{If}(n \\le 1, 1, n \\cdot \\mathrm{fact}(n-1))'
    ).evaluate();
    const js = new JavaScriptTarget();
    const r = js.compile(e.box(['fact', 5]));
    expect(r.success).toBe(true);
    expect(r.run({})).toBe(120);
  });

  it('compiles recursion with a runtime (non-literal) depth argument', () => {
    const e = new ComputeEngine();
    e.parse(
      '\\mathrm{fact}(n) \\coloneq \\mathrm{If}(n \\le 1, 1, n \\cdot \\mathrm{fact}(n-1))'
    ).evaluate();
    const js = new JavaScriptTarget();
    const r = js.compile(e.box(['fact', 'm']));
    expect(r.success).toBe(true);
    expect(r.run({ m: 6 })).toBe(720);
  });

  it('recursive compiled result matches the interpreter digit-for-digit', () => {
    const e = new ComputeEngine();
    e.parse(
      'Q(n, z) \\coloneq \\mathrm{If}(n \\le 0, z, Q(n-1, z)^2 + 0.3)'
    ).evaluate();
    const js = new JavaScriptTarget();
    const r = js.compile(e.box(['Q', 6, 'w']));
    expect(r.success).toBe(true);
    expect(r.run({ w: 0.17 })).toBe(e.box(['Q', 6, 0.17]).N().re);
  });

  it('compiles terminating mutual recursion (even/odd)', () => {
    const e = new ComputeEngine();
    e.parse('\\mathrm{od}(n) \\coloneq 0').evaluate(); // stub so ev's od(…) is a call
    e.parse(
      '\\mathrm{ev}(n) \\coloneq \\mathrm{If}(n = 0, 1, \\mathrm{od}(n-1))'
    ).evaluate();
    e.parse(
      '\\mathrm{od}(n) \\coloneq \\mathrm{If}(n = 0, 0, \\mathrm{ev}(n-1))'
    ).evaluate();
    const js = new JavaScriptTarget();
    const r = js.compile(e.box(['ev', 7]));
    expect(r.success).toBe(true);
    expect(r.run({})).toBe(0);
    expect(js.compile(e.box(['ev', 8])).run({})).toBe(1);
  });

  it('runaway recursion throws a catchable RangeError at run time', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq x').evaluate(); // stub so g's f(x) is a call
    e.parse('g(x) \\coloneq f(x) + 1').evaluate();
    e.parse('f(x) \\coloneq g(x) - 1').evaluate(); // redefine → f↔g mutual, non-terminating
    const js = new JavaScriptTarget();
    const r = js.compile(e.box(['f', 3]));
    expect(r.success).toBe(true); // compiles — termination is the caller's contract
    expect(() => r.run({})).toThrow(RangeError);
  });

  it('keeps throwing Unknown operator for a truly unknown head', () => {
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['zzz', 5]))).toThrow(
      /Unknown operator `zzz`/
    );
  });

  it('compiles a user function on the interval-js target', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq e^{-x^2/2}').evaluate();
    const iv = new IntervalJavaScriptTarget();
    const r = iv.compile(e.box(['f', 2])) as unknown as {
      success: boolean;
      run: (x: number) => { value: { lo: number; hi: number } };
    };
    expect(r.success).toBe(true);
    expect(r.run(2).value.lo).toBeCloseTo(0.1353352832366127, 12);
  });

  it('does not emit a compilation fallback warning for ∫ of a user function', () => {
    const e = new ComputeEngine();
    // Generous budget so the (now compiled) 1e7-sample quadrature completes
    // deterministically under CI/CPU contention rather than hitting the engine
    // deadline and returning NaN. Timing is not asserted here.
    e.parse('f(x) \\coloneq e^{-x^2/2}').evaluate();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = e.parse('\\int_{-10}^{10} f(x) dx').N();
      // The real-world win: the integrand compiles, so the fallback warning that
      // previously fired ("Compilation fallback … Unknown operator `f`") is gone.
      const fallbackWarned = warn.mock.calls.some((c) =>
        /Compilation fallback/.test(String(c[0]))
      );
      expect(fallbackWarned).toBe(false);
      // Value sanity (loose — Monte-Carlo): ∫_{-10}^{10} e^{-x²/2} dx ≈ √(2π).
      // The quadrature returns a `Measurement(estimate, error)`; read the
      // estimate off the first operand.
      const estimate = r.operator === 'Measurement' ? r.op1.re : r.re;
      expect(estimate).toBeCloseTo(Math.sqrt(2 * Math.PI), 1);
    } finally {
      warn.mockRestore();
    }
  });

  // A user function applied to a collection BROADCASTS in the interpreter
  // (`applyFunctionLiteral` / the step-2b lambda broadcast). The compiled
  // callee is scalar code, so the call site dispatches at run time through
  // `_SYS.bcast` — mirroring the interpreter rather than gating on a
  // compile-time "is this operand provably a collection?" test.
  describe('broadcast over a collection argument', () => {
    const setup = () => {
      const e = new ComputeEngine();
      e.box(['Assign', 'n', 4]).evaluate();
      e.box([
        'Assign',
        'q',
        ['Function', ['Add', ['Multiply', 'n', 't'], 1], 't'],
      ]).evaluate();
      e.box(['Assign', 'L', ['List', 1, 2, 3]]).evaluate();
      return e;
    };

    it('keeps a scalar argument on the direct-call path', () => {
      const e = setup();
      const expr = e.box(['q', 5]);
      // The argument is constant, so constant folding would emit `21` instead
      // of the direct `_fn_q` call this test is pinning.
      const r = compile(expr, { constantFold: false });
      expect(r.success).toBe(true);
      expect(r.code).toBe('_fn_q(5)');
      expect(r.run!()).toBe(21);
      expect(expr.evaluate().re).toBe(21);
    });

    it('broadcasts a list argument, matching evaluate() ([5,9,13])', () => {
      const e = setup();
      const expr = e.box(['q', 'L']);
      expect(expr.evaluate().toString()).toBe('[5,9,13]');
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual([5, 9, 13]);
    });

    it('captures an outer symbol inside the broadcast body', () => {
      // `n` is captured (baked) into `_fn_q`'s body: reassigning it after the
      // compile does not change the compiled artifact, and the broadcast
      // applies the SAME captured body to every element.
      const e = setup();
      const r = compile(e.box(['q', 'L']));
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual([5, 9, 13]);
      e.box(['Assign', 'n', 100]).evaluate();
      expect(r.run!()).toEqual([5, 9, 13]);
    });

    it('broadcasts a list bound at run time through vars', () => {
      const e = setup();
      const r = compile(e.box(['q', 'u']));
      expect(r.success).toBe(true);
      expect(r.run!({ u: 2 } as any)).toBe(9);
      expect(r.run!({ u: [1, 2, 3] } as any)).toEqual([5, 9, 13]);
    });

    it('zips two list arguments of matching length', () => {
      const e = setup();
      e.box([
        'Assign',
        'g',
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ]).evaluate();
      e.box(['Assign', 'M', ['List', 10, 20, 30]]).evaluate();
      const expr = e.box(['g', 'L', 'M']);
      expect(expr.evaluate().toString()).toBe('[11,22,33]');
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual([11, 22, 33]);
    });

    it('broadcasts a scalar against a list argument', () => {
      const e = setup();
      e.box([
        'Assign',
        'g',
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ]).evaluate();
      const expr = e.box(['g', 'L', 5]);
      expect(expr.evaluate().toString()).toBe('[6,7,8]');
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual([6, 7, 8]);
    });

    it('projects a length mismatch to NaN (interpreter: incompatible-dimensions)', () => {
      const e = setup();
      e.box([
        'Assign',
        'g',
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ]).evaluate();
      e.box(['Assign', 'K', ['List', 10, 20]]).evaluate();
      const expr = e.box(['g', 'L', 'K']);
      // Ratified policy (docs/BROADCAST-MODEL.md): no zip-to-shortest.
      expect(expr.evaluate().toString()).toBe(
        'Error("incompatible-dimensions", "3 vs 2")'
      );
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(r.run!()).toBeNaN();
    });

    it('binds a TUPLE argument whole (never broadcast)', () => {
      const e = new ComputeEngine();
      e.box([
        'Assign',
        'p',
        ['Function', ['Add', ['PointX', 'v'], ['PointY', 'v']], 'v'],
      ]).evaluate();
      e.box(['Assign', 'T', ['Tuple', 3, 4]]).evaluate();
      const expr = e.box(['p', 'T']);
      expect(expr.evaluate().re).toBe(7);
      const r = compile(expr);
      expect(r.success).toBe(true);
      // The assigned tuple is a bound value (`const _val_T = [3, 4];`).
      expect(r.code).toBe('_fn_p(_val_T)');
      expect(r.run!()).toBe(7);
    });

    // Applying a function literal to an EMPTY collection zips zero elements:
    // the interpreter answers `[]`. (An empty OPERATOR position instead
    // answers `Nothing` — `Not([])` → NaN — which is why the call site
    // dispatches through `_SYS.bcastFn`, not `_SYS.bcast`.)
    it('answers [] for an empty collection argument, like evaluate()', () => {
      const e = setup();
      const expr = e.box(['q', ['List']]);
      expect(expr.evaluate().toString()).toBe('[]');
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual([]);
    });

    it('projects a NESTED empty position to [], like evaluate()', () => {
      const e = setup();
      const expr = e.box(['q', ['List', ['List'], ['List', 1, 2]]]);
      expect(expr.evaluate().toString()).toBe('[[],[5,9]]');
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual([[], [5, 9]]);
    });

    // A complex-typed parameter fed a real argument is coerced to the
    // `{ re, im }` convention. The coercion is PER PARAMETER and applies to
    // the broadcast ELEMENT: a sibling collection argument must still
    // broadcast (before, one coerced argument put the whole call on the
    // direct scalar path, so `_fn_P([1,2,3], …)` ran the scalar body over the
    // array — here, runaway recursion).
    it('broadcasts alongside a complex-coerced argument', () => {
      const e = new ComputeEngine();
      e.declare('P', { type: '(number, complex) -> complex' });
      e.assign(
        'P',
        e.box([
          'Function',
          [
            'Which',
            ['Equal', 'n', 0],
            1,
            'True',
            ['Subtract', ['Square', ['P', ['Subtract', 'n', 1], 'z']], 'z'],
          ],
          'n',
          'z',
        ])
      );
      e.box(['Assign', 'L', ['List', 1, 2, 3]]).evaluate();
      // `Complex(0, 0)` canonicalizes to the real literal 0: the second
      // argument is coerced, the first is a list and broadcasts.
      const expr = e.box(['P', 'L', ['Complex', 0, 0]]);
      expect(expr.evaluate().toString()).toBe('[1,1,1]');
      // `constantFold: false`: `L` and the argument are both literals, so the
      // call is a constant subtree that compile-time folding would otherwise
      // evaluate and emit as `[1, 1, 1]` — this test is about the broadcast
      // lowering and the per-parameter complex coercion inside it.
      const r = compile(expr, { fallback: false, constantFold: false });
      expect(r.success).toBe(true);
      // The wrap is inside the closure, around the element parameter.
      expect(r.code).toMatch(/_SYS\.bcastFn\(\(\w+, (\w+)\) =>.*re: \1, im: 0/);
      // Same values as the interpreter. The callee computes in the complex
      // convention, but the elements are real, so the runner's result
      // convention (design §5, 2026-08-16, applied element by element) hands
      // them back as plain numbers, never `{re: 1, im: 0}`.
      expect(r.run!({})).toEqual([1, 1, 1]);
    });
  });

  describe('custom operator compile handler', () => {
    it('emits a custom operator definition compile handler', () => {
      const e = new ComputeEngine();
      e.declare('Quadrance', {
        signature: '(number, number) -> number',
        compile: (args, compile, { language }) =>
          language === 'javascript'
            ? `((${compile(args[0])})**2 + (${compile(args[1])})**2)`
            : undefined,
      });
      const target = e._getCompilationTarget('javascript');
      const fn = target.compile(e.parse('\\mathrm{Quadrance}(x, y)'));
      expect(fn.code).toEqual('((_.x)**2 + (_.y)**2)');
      expect(fn.run!({ x: 3, y: 4 })).toEqual(25);
    });

    it('takes precedence over a built-in operator mapping', () => {
      const e = new ComputeEngine();
      e.declare('GCD', {
        signature: '(number, number) -> number',
        compile: (args, compile, { language }) =>
          language === 'javascript'
            ? `__mygcd(${compile(args[0])}, ${compile(args[1])})`
            : undefined,
      });
      const code = e
        ._getCompilationTarget('javascript')
        .compile(e.parse('\\gcd(a, b)')).code;
      expect(code).toEqual('__mygcd(_.a, _.b)');
    });

    it('falls back to default compilation when the handler returns undefined', () => {
      // The handler only emits for javascript; on another target it returns
      // undefined, so compilation proceeds as if there were no handler.
      const e = new ComputeEngine();
      e.declare('GCD', {
        signature: '(number, number) -> number',
        compile: (args, compile, { language }) =>
          language === 'javascript' ? `__mygcd(...)` : undefined,
      });
      // glsl has a built-in GCD mapping; the undefined handler defers to it.
      const r = e._getCompilationTarget('glsl').compile(e.parse('\\gcd(a, b)'));
      expect(r.code).toContain('_gpu_gcd');
    });

    it('overrides an operator-mapped head (Add) — finding A5', () => {
      // The pre-fix handler dispatch ran AFTER the built-in operator mapping,
      // so a handler on Add/Multiply/Power/relational heads was silently
      // ignored. It must now win.
      const e = new ComputeEngine();
      e.declare('Add', {
        signature: '(number, number) -> number',
        compile: (args, compile, { language }) =>
          language === 'javascript'
            ? `__myadd(${compile(args[0])}, ${compile(args[1])})`
            : undefined,
      });
      const code = e
        ._getCompilationTarget('javascript')
        .compile(e.parse('a + b')).code;
      expect(code).toEqual('__myadd(_.a, _.b)');
    });

    it('treats an empty-string handler return as fall-through — finding A5', () => {
      const e = new ComputeEngine();
      e.declare('GCD', {
        signature: '(number, number) -> number',
        compile: () => '',
      });
      // Empty string is "no code": fall through to the built-in GCD lowering.
      const code = e
        ._getCompilationTarget('javascript')
        .compile(e.box(['GCD', 12, 18])).code;
      expect(code).toContain('_SYS.gcd');
    });

    it('does not report a custom-compiled head as unsupported — finding A4', () => {
      const e = new ComputeEngine();
      e.declare('Quadrance', {
        signature: '(number, number) -> number',
        compile: (args, compile, { language }) =>
          language === 'javascript'
            ? `((${compile(args[0])})**2 + (${compile(args[1])})**2)`
            : undefined,
      });
      const r = compile(e.parse('\\mathrm{Quadrance}(x, y)'));
      expect(r.success).toBe(true);
      expect(r.unsupported).toEqual([]);
      expect(r.freeSymbols).toEqual(['x', 'y']);
    });
  });
});

// Regression coverage for compile-target findings A1/A2/A3/A6/A7.
describe('COMPILE collection-op findings', () => {
  it('n-ary GCD/LCM fold pairwise, never as tolerance eps — finding A1', () => {
    // `_SYS.gcd`/`_SYS.lcm` are binary with a third `eps`; a variadic call
    // would consume the 3rd operand as the tolerance.
    const cases: [any, number][] = [
      [['GCD', 12, 18, 8], 2],
      [['GCD', 2.25, 2.1, 0.6], 0.1499999999999999],
      [['LCM', 4, 6, 10], 60],
    ];
    for (const [expr, expected] of cases) {
      const b = ce.box(expr);
      const r = compile(b);
      expect((r.run as (v: Record<string, number>) => number)({})).toBeCloseTo(
        b.evaluate().re,
        10
      );
      expect((r.run as (v: Record<string, number>) => number)({})).toBeCloseTo(
        expected,
        10
      );
    }
  });

  it('GCD/LCM of a list compile (not silent NaN) — finding A3', () => {
    const cases: any[] = [
      ['GCD', ['List', 12, 18]],
      ['LCM', ['List', 4, 6, 10]],
      ['GCD', ['List', 12, 18, 8]],
      ['GCD', ['List', 12]],
      ['LCM', ['List', 2.5]],
      ['GCD', ['List']], // → 0
      ['LCM', ['List']], // → 1
      ['GCD', ['List', 12, 18], 8], // mixed list + scalar
    ];
    for (const expr of cases) {
      const b = ce.box(expr);
      const r = compile(b);
      expect(r.success).toBe(true);
      const got = (r.run as (v: Record<string, number>) => number)({});
      expect(got).not.toBeNaN();
      expect(got).toBeCloseTo(b.evaluate().re, 10);
    }
  });

  it('IndexOf uses EXACT compare like the interpreter — finding A6 (revised)', () => {
    // REVISED 2026-08-08. This used to pin a TOLERANT compare, asserting that
    // `IndexOf([0.3], Add(0.1, 0.2))` compiled to 1 "like the interpreter".
    // The premise was a probe artifact: the interpreter's number `.isSame()` is
    // EXACT — `IndexOf([0], 5e-11)` → 0 and
    // `IndexOf([0.30000000000000004], 0.3)` → 0 — and the old probe only
    // agreed because `Add(0.1, 0.2)` EVALUATES to exactly `0.3` by exact
    // decimal folding, so the element test never saw a near-miss float.
    //
    // ACCEPTED RESIDUAL (documented, deliberately not asserted): the compiled
    // form of that old probe recomputes the sum in f64 →
    // `0.30000000000000004`, which the exact element test does NOT find, while
    // the interpreter folds it to `0.3` and does. That is the ordinary
    // exactness loss of compiling to f64 arithmetic — no element test can close
    // it, and a tolerance leaf would only trade it for wrong answers on the two
    // rows below.
    for (const [expr, expected] of [
      [['IndexOf', ['List', 0], { num: '5e-11' }], 0],
      [['IndexOf', ['List', { num: '0.30000000000000004' }], 0.3], 0],
    ] as const) {
      const b = ce.box(expr as any);
      expect(b.evaluate().re).toBe(expected);
      const r = compile(b);
      expect(r.success).toBe(true);
      expect((r.run as (v: Record<string, number>) => number)({})).toBe(
        expected
      );
    }
  });

  it('Map/Filter do not leak the native callback index — finding A7', () => {
    // The compiled lambda must be invoked with a single argument; the native
    // `.map((el, index) => …)` index must NOT reach a lambda parameter.
    // `constantFold: false` throughout: both collections are literals, so
    // compile-time folding would otherwise evaluate the whole `Map`/`Filter`
    // and emit the resulting list, with no callback left to inspect.
    const rMap = compile(
      ce.box(['Map', ['Function', ['Add', 'x', 1], 'x'], ['List', 10, 20, 30]]),
      { constantFold: false }
    );
    expect(rMap.code).toContain('(_x) => _f(_x)');
    expect(rMap.code).not.toMatch(/\.map\(\(_f\)/); // no bare fn to native map
    expect((rMap.run as (v: Record<string, number>) => number[])({})).toEqual([
      11, 21, 31,
    ]);

    const rFilter = compile(
      ce.box([
        'Filter',
        ['List', 1, 2, 3, 4],
        ['Function', ['Greater', 'x', 2], 'x'],
      ]),
      { constantFold: false }
    );
    expect(rFilter.code).toContain('(_x) => _f(_x)');
    expect(
      (rFilter.run as (v: Record<string, number>) => number[])({})
    ).toEqual([3, 4]);
  });

  it('a Sum index shadowing a user function is a local, not _fn_ — finding A2', () => {
    // UNROLL path: the index `f` resolves to a numeric literal, not its own
    // identifier, so the pre-fix `resolved === s` heuristic missed it and
    // captured the same-named user function `f`.
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq x^2').evaluate();
    const r = compile(e.parse('\\sum_{f=1}^{3} f'));
    expect(r.code).not.toContain('_fn_f');
    expect((r.run as (v: Record<string, number>) => number)({})).toBe(6);
  });

  it('a Sum index shadowing a user function compiles on interval-js — finding A2', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq x^2').evaluate();
    const r = compile(e.parse('\\sum_{f=1}^{300} f'), { to: 'interval-js' });
    const out = (
      r.run as (v: Record<string, number>) => { value: { lo: number } }
    )({});
    expect(out.value.lo).toBe(45150);
  });
});

describe('COMPILE higher-order combiner/mapper fail-closed', () => {
  const L = ['List', 1, 2, 3];

  it('Reduce with a non-binary-arithmetic operator symbol fails closed — finding 1', () => {
    // A unary (Negate/Not) or relational (Less) operator symbol must NOT lower
    // to a binary infix lambda: it would fold to garbage behind success:true
    // (Negate → −6, Less → true) while the interpreter stays symbolic.
    // `Negate` now eta-expands to a UNARY callback (fine for `Map`), so the
    // COMBINER site is what refuses it here
    // (`BaseCompiler.isBinaryInfixValueOperator`).
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    // A VARIADIC operator symbol accepts the two arguments `Reduce` passes, so
    // the static callback-arity check (2026-08-15) declines on it, the call
    // stays valid, and the combiner gate under test is what refuses it.
    for (const op of ['Less', 'Greater']) {
      expect(() =>
        // The list and seed are constant, so constant folding would answer from
        // the interpreter and never reach the combiner check under test.
        js.compile(e.box(['Reduce', L, op, 0]), {
          constantFold: false,
        })
      ).toThrow(/Fail closed/);
    }
    // `And`/`Or` are refused one stage earlier under Design E: their
    // `boolean+` element parameter is provably disjoint from an integer
    // element, so the compatibility gate rejects the call at
    // canonicalization and the compiler sees an invalid expression.
    for (const op of ['And', 'Or']) {
      const bad = e.box(['Reduce', L, op, 0]);
      expect(bad.isValid).toBe(false);
      expect(() =>
        js.compile(bad, { constantFold: false })
      ).toThrow(/invalid expression/);
    }
    // A FIXED-arity operator symbol (`Negate`, `Not`) cannot take two
    // arguments at all, so it is rejected one stage earlier — the static
    // callback-arity check turns the call into an `Error` while it is
    // canonicalized, and the compiler never sees the combiner. Neither
    // refusal ever compiles, which is what matters here.
    for (const op of ['Negate', 'Not']) {
      expect(e.box(['Reduce', L, op, 0]).type.toString()).toBe('error');
      expect(() =>
        js.compile(e.box(['Reduce', L, op, 0]), {
          constantFold: false,
        })
      ).toThrow(/invalid expression/);
    }
    // Binary arithmetic operator symbols still compile.
    expect(
      compile(e.box(['Reduce', L, 'Subtract', 0]), { fallback: false })!.run!()
    ).toBe(-6);
    expect(
      compile(e.box(['Reduce', L, 'Add', 0]), { fallback: false })!.run!()
    ).toBe(6);
  });

  it('Map/Filter over an operator symbol fall back to the interpreter — finding 1', () => {
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    // A NON-expandable operator symbol still fails closed at the compiler's
    // own callback gate. `Or` is `(boolean+) -> boolean`: its `+` tail admits
    // the ONE argument `Filter` supplies, so the static callback-arity check
    // (2026-08-15) declines on it and the call reaches the compiler.
    // The list is constant, so constant folding would answer from the
    // interpreter and never reach the callback check under test.
    // Boolean list: `Or`'s `boolean+` element type is provably disjoint from
    // an integer element, so the Design E gate rejects the historical integer
    // source statically; booleans keep the compiler's own gate reachable.
    expect(() =>
      js.compile(e.box(['Filter', ['List', 'True', 'False'], 'Or']), {
        constantFold: false,
      })
    ).toThrow(/Fail closed/);
    // `Less` requires at least two arguments, so it is refused one stage
    // earlier: the static check rejects the call while it is canonicalized.
    expect(() =>
      js.compile(e.box(['Filter', L, 'Less']), {
        constantFold: false,
      })
    ).toThrow(/invalid expression/);
    // …but a UNARY one is eta-expanded into a real callback rather than
    // refused: `Map(Negate, L)` is a valid application at `Negate`'s own
    // arity (it is only a *combiner* that needs two parameters). It compiles
    // and agrees with the interpreter.
    const m = compile(e.box(['Map', 'Negate', L]));
    expect(m?.success).toBe(true);
    expect((m?.run as (v: Record<string, number>) => number[])({})).toEqual([
      -1, -2, -3,
    ]);
  });

  it('Reduce with a non-binary combiner arity fails closed — finding 2', () => {
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    // Unary user function whose arity the static callback-arity check
    // (2026-08-15) cannot read: `cb` is declared with the `function` wildcard,
    // which promises callers nothing about arity, so the check declines and
    // the call stays valid. The compiler resolves the symbol to its unary
    // literal and refuses it at the combiner-arity gate (`customCombiner`
    // requires `literal.nops - 1 === 2`). The interpreter raises an arity
    // error there; the compiled fold must not silently return 3.
    // The list and seed are constant, so constant folding would answer from the
    // interpreter and never reach the combiner-arity check under test.
    e.declare('cb', 'function');
    e.assign('cb', e.box(['Function', ['Add', 'x', 1], 'x']));
    expect(e.box(['Reduce', L, 'cb', 0]).isValid).toBe(true);
    expect(() =>
      js.compile(e.box(['Reduce', L, 'cb', 0]), {
        constantFold: false,
      })
    ).toThrow(/Fail closed/);
    // A unary callback whose arity IS statically readable — an inline literal,
    // or a symbol assigned one with no wildcard declaration — is refused one
    // stage earlier, while the call is canonicalized, and never reaches that
    // gate.
    expect(() =>
      js.compile(e.box(['Reduce', L, ['Function', ['Add', 'x', 1], 'x'], 0]), {
        constantFold: false,
      })
    ).toThrow(/invalid expression/);
    e.assign('inc', e.box(['Function', ['Add', 'a', 1], 'a']));
    expect(() =>
      js.compile(e.box(['Reduce', L, 'inc', 0]), {
        constantFold: false,
      })
    ).toThrow(/invalid expression/);
    // A binary Function literal still compiles.
    expect(
      compile(
        e.box(['Reduce', L, ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0]),
        { fallback: false }
      )!.run!()
    ).toBe(6);
  });

  it('Tabulate with a statically non-positive dimension fails closed — finding 3', () => {
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    const f = ['Function', ['Multiply', 'x', 2], 'x'];
    expect(() => js.compile(e.box(['Tabulate', f, 0]))).toThrow(/Fail closed/);
    expect(() => js.compile(e.box(['Tabulate', f, -2]))).toThrow(/Fail closed/);
    // 2-D: a non-positive second dimension also fails closed. The generator
    // takes TWO indexes here — `Tabulate(f, n, m)` computes `f(i, j)`, so the
    // unary `f` used for the 1-D cases is an arity error the static
    // callback-arity check (2026-08-15) reports first, which would test the
    // wrong thing.
    const f2 = ['Function', ['Multiply', 'x', 'y'], 'x', 'y'];
    expect(() =>
      js.compile(e.box(['Tabulate', f2, 3, 0]))
    ).toThrow(/Fail closed/);
    // A positive dimension still compiles.
    expect(
      compile(e.box(['Tabulate', f, 3]), { fallback: false })!.run!()
    ).toEqual([2, 4, 6]);
  });

  it('Reduce over an empty collection with no initial value yields NaN — finding 4', () => {
    const e = new ComputeEngine();
    const r = compile(e.box(['Reduce', ['List'], 'Add']), { fallback: false })!;
    expect(r.success).toBe(true);
    // Native seedless reduce would throw on []; the guard yields NaN (the
    // interpreter's `Nothing` projected onto a real target).
    expect(Number.isNaN(r.run!() as number)).toBe(true);
    // A non-empty seedless reduce still folds pairwise.
    expect(
      compile(e.box(['Reduce', ['List', 1, 2, 3], 'Add']), { fallback: false })!
        .run!()
    ).toBe(6);
  });

  it('Integrate with a DESTRUCTURING integrand parameter fails closed', () => {
    // `((p, q)) => p + q` takes ONE argument and binds `p` and `q` to that
    // tuple's components. No compile target lowers the tuple match, so the
    // quadrature emitter must refuse the integrand instead of unwrapping it:
    // it used to drop the `Function` wrapper and compile the body against the
    // LIMIT's index variable, emitting `_SYS.integrate((x) => (P + _.q), 0, 1)`
    // — two unrelated ambient reads, and `x` unused.
    //
    // `vars` is what routes the node to the quadrature emitter at all: the
    // antiderivative-first attempt is skipped when the integrand references a
    // `vars`-mapped symbol (a caller's external input must not be folded away).
    const e = new ComputeEngine();
    const integral = e.box([
      'Integrate',
      ['Function', ['Add', 'p', 'q'], ['Tuple', 'p', 'q']],
      ['Limits', 'x', 0, 1],
    ]);
    expect(() =>
      compile(integral, { fallback: false, vars: { p: 'P' } })
    ).toThrow(/destructuring parameter/);
  });
});

describe('Tycho item 143: Min/Max over a degraded-type Distance broadcast', () => {
  // A base declared with the BARE `indexed_collection` type has an unknown
  // ELEMENT type, so `Distance(S, p)` cannot be proven a point-list broadcast
  // statically. It used to report the scalar `number`, which made
  // `compileExtremum` pick the variadic arm — `Math.min(<array>)`, i.e. NaN
  // behind `success: true`. Two halves fix it: the type handler widens to
  // `number | list<number>`, and the lowering projects on the runtime shape.
  const POINTS = ['List', ['List', 0, 0], ['List', 3, 4], ['List', 6, 8]];
  const P = ['List', 1, 2];
  const MIN_D = Math.sqrt(5); // 2.23606797749979
  const MAX_D = Math.sqrt(61); // 7.810249675906654

  // `withValue: false` declares S without assigning it: since the Phase 1
  // placeholder-refinement ruling (2026-08-18), assigning to a BARE-declared
  // collection refines its element type, so an "undecidable base" — the
  // state these pins exist for — is only reachable while the symbol is
  // valueless. The compiled code binds S at run time instead.
  const engineWith = (decl: string | null, withValue = true): ComputeEngine => {
    const e = new ComputeEngine();
    if (decl !== null) e.declare('S', decl as any);
    if (withValue) e.assign('S', e.box(POINTS));
    return e;
  };
  const S_DATA = {
    S: [
      [0, 0],
      [3, 4],
      [6, 8],
    ],
  };

  it('reports `number | list<number>` for an undecidable operand', () => {
    const e = engineWith('indexed_collection', false);
    expect(e.box(['Distance', 'S', P]).type.toString()).toBe(
      'list<number> | number'
    );
    // The provable cases are unchanged.
    expect(
      engineWith('list<list<number>>').box(['Distance', 'S', P]).type.toString()
    ).toBe('list<number>');
    expect(engineWith(null).box(['Distance', 'S', P]).type.toString()).toBe(
      'list<number>'
    );
    // Point-to-point stays the SCALAR — the property this pin is about. It is
    // reported as the real it is (a distance is the norm of a difference), not
    // the wide `number`, so the assertion is on scalar-ness rather than on the
    // spelling.
    const d = e.box(['Distance', ['List', 0, 0], ['List', 3, 4]]);
    expect(d.type.toString()).toBe('real');
    expect(d.type.matches('collection')).toBe(false);
  });

  it('compiles Min/Max over the broadcast on all three declaration legs', () => {
    for (const decl of [null, 'list<list<number>>', 'indexed_collection']) {
      // The `indexed_collection` leg must stay VALUELESS to pin the
      // undecidable arm (an assigned bare declaration refines, Phase 1).
      const valueless = decl === 'indexed_collection';
      const e = engineWith(decl, !valueless);
      const bindings = valueless ? S_DATA : undefined;
      const min = compile(e.box(['Min', ['Distance', 'S', P]]), {
        fallback: false,
      })!;
      expect(min.success).toBe(true);
      expect(min.run!(bindings)).toBeCloseTo(MIN_D, 12);
      const max = compile(e.box(['Max', ['Distance', 'S', P]]), {
        fallback: false,
      })!;
      expect(max.success).toBe(true);
      expect(max.run!(bindings)).toBeCloseTo(MAX_D, 12);
    }
  });

  it('emits a runtime shape projection, not the scalar arm', () => {
    const e = engineWith('indexed_collection', false);
    // `S` and `P` are constant, so constant folding would emit the numeric
    // extremum instead of the runtime shape projection this test is pinning.
    const code = compile(e.box(['Min', ['Distance', 'S', P]]), {
      fallback: false,
      constantFold: false,
    })!.code;
    expect(code).toContain('Array.isArray');
    expect(code).not.toMatch(/^Math\.min\(/);
  });

  it('a comparison row over the broadcast agrees with the interpreter', () => {
    // Compiled from a VALUELESS engine so the undecidable arm is what gets
    // lowered (an assigned bare declaration refines, Phase 1); the
    // interpreter side of the agreement runs on a sibling engine that holds
    // the value.
    const e = engineWith('indexed_collection', false);
    const withValue = engineWith('indexed_collection');
    // The discriminating probe: the true answer is `True`, and the old
    // `Math.min(<array>)` lowering answered `NaN < 3` → a silent `false`.
    const near = e.box(['Less', ['Min', ['Distance', 'S', P]], 3]);
    expect(
      withValue.box(['Less', ['Min', ['Distance', 'S', P]], 3]).evaluate().toString()
    ).toBe('"True"');
    expect(compile(near, { fallback: false })!.run!(S_DATA)).toBe(true);
    // …and a row that is genuinely false stays false (not a false-from-NaN).
    const far = e.box(['Less', ['Min', ['Distance', 'S', P]], 0.4]);
    expect(
      withValue.box(['Less', ['Min', ['Distance', 'S', P]], 0.4]).evaluate().toString()
    ).toBe('"False"');
    expect(compile(far, { fallback: false })!.run!(S_DATA)).toBe(false);
  });

  it('treats the `collection` SUPERTYPE as undecidable too', () => {
    // `collection` is a supertype of `indexed_collection`, so a base declared
    // with it is just as undecidable — it used to fall through to the scalar
    // `number` verdict, which put `Min` back on the `Math.min(<array>)` arm.
    const e = engineWith('collection', false);
    expect(e.box(['Distance', 'S', P]).type.toString()).toBe(
      'list<number> | number'
    );
    // `S` and `P` are constant, so constant folding would emit the numeric
    // extremum instead of the runtime shape projection this test is pinning.
    const min = compile(e.box(['Min', ['Distance', 'S', P]]), {
      fallback: false,
      constantFold: false,
    })!;
    expect(min.success).toBe(true);
    expect(min.code).toContain('Array.isArray');
    expect(min.run!(S_DATA)).toBeCloseTo(MIN_D, 12);
    // A genuinely non-indexed collection kind keeps the scalar verdict.
    const setEngine = new ComputeEngine();
    setEngine.declare('T', 'set<unknown>');
    expect(setEngine.box(['Distance', 'T', P]).type.toString()).not.toContain(
      'list<number>'
    );
  });

  it('projects the runtime shape in the MIXED-operand extremum too', () => {
    // `Min(Distance(S, p), 100)` takes the multi-operand arm, which only knew
    // the PROVABLE collection test — the undecidable operand was passed to
    // `Math.min` as a whole array → NaN behind `success: true`.
    for (const decl of ['indexed_collection', 'collection']) {
      const e = engineWith(decl, false);
      const expr = e.box(['Min', ['Distance', 'S', P], 100]);
      // The operands are compile-time symbolic (S binds at run time), so
      // the lowering arms this test pins are what gets emitted.
      const r = compile(expr, { fallback: false, constantFold: false })!;
      expect(r.success).toBe(true);
      expect(r.code).toContain('Array.isArray');
      expect(r.run!(S_DATA)).toBeCloseTo(MIN_D, 12);
      // The scalar operand still wins when it is the extremum.
      const max = compile(e.box(['Max', ['Distance', 'S', P], 100]), {
        fallback: false,
        constantFold: false,
      })!;
      expect(max.run!(S_DATA)).toBe(100);
    }
    // The provably-scalar fast path is untouched.
    expect(
      compile(new ComputeEngine().box(['Min', 3, 5]), {
        fallback: false,
        constantFold: false,
      })!.code
    ).toContain('Math.min');
  });
});

describe('ordering over a complex-valued operand fails closed', () => {
  // The complex numbers are not ordered: the interpreter leaves `Less(i·x, 0)`
  // symbolic. The compiled form used to emit a raw `<` over the `{re, im}`
  // object — a silent `false` behind `success: true`. Since the compile-mode
  // migration (step 4, 2026-08-16) the default mode answers this with the D2
  // RUNTIME rule instead of a compile-time decline: `false` when the operand
  // is complex at run time, the real comparison when it is not. `mode:
  // 'strict'` keeps the decline.
  it('Less/LessEqual/Greater/GreaterEqual over a maybe-complex operand use the runtime rule', () => {
    const ce = new ComputeEngine();
    // `i·x` is 0 (real) at x = 0 and complex elsewhere, so the two branches of
    // the rule are both witnessed; the interpreter answers `0 ≤ 0` = True and
    // leaves `i < 0` symbolic.
    for (const [h, atZero] of [
      ['Less', false],
      ['LessEqual', true],
      ['Greater', false],
      ['GreaterEqual', true],
    ] as const) {
      const r = compile(ce.box([h, ['Multiply', 'ImaginaryUnit', 'x'], 0]), {
        fallback: false,
      })!;
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.cisreal(');
      expect(r.run!({ x: 0 })).toBe(atZero);
      expect(r.run!({ x: 1 })).toBe(false);
      // `mode: 'strict'` still declines rather than answering.
      expect(() =>
        compile(ce.box([h, ['Multiply', 'ImaginaryUnit', 'x'], 0]), {
          fallback: false,
          mode: 'strict',
        })
      ).toThrow(/not ordered.*Fail closed \(D6\)/s);
    }
  });

  it('uses the same rule inside a Which condition', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Mod',
      ['Which', ['Less', ['Multiply', 'ImaginaryUnit', 'x'], 0], 1, 'True', 2],
      1,
    ]);
    // The condition is `false` at every `x` here (complex, or `0 < 0`), so the
    // `True` arm gives 2 and `Mod(2, 1) = 0`.
    const r = compile(expr, { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.run!({ x: 1 })).toBe(0);
    expect(r.run!({ x: 0 })).toBe(0);
    expect(() => compile(expr, { fallback: false, mode: 'strict' })).toThrow(
      /not ordered.*Fail closed \(D6\)/s
    );
    expect(compile(expr, { mode: 'strict' })?.success).toBe(false);
  });

  it('still admits an unknown-sign radical operand', () => {
    // `Sqrt(x)` types `complex` for an operand of unknown sign. The default
    // mode promotes it to the complex kernel (compile-mode step 4,
    // 2026-08-16) and the comparison reads the promoted value through the
    // runtime rule — so this must keep compiling, and keep answering the real
    // comparison wherever the radicand is non-negative.
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Less', ['Sqrt', 'x'], 2]), { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.run!({ x: 9 })).toBe(false);
    expect(r.run!({ x: 1 })).toBe(true);
    expect(r.run!({ x: -1 })).toBe(false); // √−1 = i: not ordered
  });

  it('leaves Equal/NotEqual over complex operands alone', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box(['Equal', ['Multiply', 'ImaginaryUnit', 'x'], 0]),
      { fallback: false }
    );
    expect(r?.success).toBe(true);
  });
});

/**
 * A BUILT-IN operator name used as a CALLBACK (`Map(Sin, xs)`,
 * `CountIf(xs, IsPrime)`). It used to fall through to the free-variable read
 * `_.Sin`, so the artifact compiled "successfully" and then threw
 * `_f is not a function` at RUN time. It is now eta-expanded at its REQUIRED
 * arity into a shared emitted local — `const _fn_Sin = (_tv1) =>
 * Math.sin(_tv1)` — through the same machinery user-defined function
 * callbacks use. A built-in with no expandable arity (variadic, zero
 * required) fails closed at COMPILE time instead.
 */
describe('COMPILE built-in operator name as a callback', () => {
  const XS = ['List', 1, 2, 3, 4, 5];
  /** `sin 1 + … + sin 5`, from the interpreter. */
  const SUM_SIN = new ComputeEngine()
    .box(['Sum', ['Map', 'Sin', XS]])
    .evaluate()
    .N().re!;

  it('compiles and runs `Sum(Map(Sin, xs))`', () => {
    const e = new ComputeEngine();
    const expr = e.box(['Sum', ['Map', 'Sin', XS]]);
    // The whole expression is constant, so constant folding would emit the sum
    // as a literal instead of the `_fn_Sin` wrapper this test is pinning.
    const r = compile(expr, { fallback: false, constantFold: false })!;

    expect(r.success).toBe(true);
    expect(r.code).toContain('_fn_Sin');
    expect(r.code).not.toContain('_.Sin');
    expect(r.run!({}) as number).toBeCloseTo(expr.evaluate().N().re!, 12);
  });

  it('emits the wrapper once, as a shared local', () => {
    // The `Function`-literal route puts the emitted definitions in `code`.
    const e = new ComputeEngine();
    const expr = e.box([
      'Function',
      ['Add', ['Sum', ['Map', 'Sin', XS]], 't'],
      't',
    ]);
    // The `Sum(Map(Sin, XS))` subtree is constant, so constant folding would
    // replace it with a literal and emit no wrapper at all.
    const r = compile(expr, { fallback: false, constantFold: false })!;

    expect(r.code).toContain('const _fn_Sin = (_tv1) => Math.sin(_tv1);');
    expect(r.code.split('const _fn_Sin').length - 1).toBe(1);
    expect(r.run!(0.5) as number).toBeCloseTo(0.5 + SUM_SIN, 12);
  });

  it('does not report the callback as a free symbol', () => {
    // The artifact needs no `Sin` input: the declarative reference analysis
    // must agree with the codegen.
    const e = new ComputeEngine();
    const r = compile(e.box(['Sum', ['Map', 'Sin', XS]]), { fallback: false })!;
    expect(r.freeSymbols).toEqual([]);
  });

  it('leaves the APPLICATION HEAD untouched', () => {
    // The eta route is reachable only from the bare-symbol (value) position:
    // `Sin(x)` must still emit the table mapping, never `_fn_Sin`.
    const e = new ComputeEngine();
    const r = compile(e.parse('\\sin(x)^2 + \\sin(2x)'), { fallback: false })!;
    expect(r.code).toContain('Math.sin(');
    expect(r.code).not.toContain('_fn_');
  });

  it('does not capture a same-named lambda parameter', () => {
    // The wrapper's parameter is drawn from the compilation's temp-name
    // counter, which skips every name the artifact already uses.
    const e = new ComputeEngine();
    const expr = e.box([
      'Function',
      ['Add', ['Sum', ['Map', 'Sin', XS]], '_tv1'],
      '_tv1',
    ]);
    // The `Sum(Map(Sin, XS))` subtree is constant, so constant folding would
    // replace it with a literal and emit no wrapper at all.
    const r = compile(expr, { fallback: false, constantFold: false })!;

    expect(r.code).toContain('const _fn_Sin = (_tv2) => Math.sin(_tv2);');
    expect(r.run!(10) as number).toBeCloseTo(10 + SUM_SIN, 12);
  });

  it('expands an OPTIONAL-tail operator at its required arity (`Ln`)', () => {
    // `Ln` is 1 required + 1 optional parameter. A callback site applies it
    // unary (the optional base defaults), so the unary wrapper is exact —
    // it must NOT decline and fall through to a dangling `_.Ln`.
    const e = new ComputeEngine();
    const expr = e.box(['Sum', ['Map', 'Ln', XS]]);
    const r = compile(expr, { fallback: false })!;

    expect(r.code).not.toContain('_.Ln');
    expect(r.run!({}) as number).toBeCloseTo(expr.evaluate().N().re!, 12);
  });

  it('expands a unary OPERATOR-MAPPED built-in (`Negate`)', () => {
    // `Negate` has a `target.operators` mapping, so the bare-operator-symbol
    // branch owns it and used to refuse outright. It now eta-expands there
    // too — its wrapper body lowers through that very operator mapping.
    // (`Not` is mapped and unary as well, but `Not(_tv1)` does not
    // canonicalize over an untyped parameter, so it still fails closed.)
    const e = new ComputeEngine();
    const expr = e.box(['Sum', ['Map', 'Negate', XS]]);
    // The whole expression is constant, so constant folding would emit the sum
    // as a literal instead of the `_fn_Negate` wrapper this test is pinning.
    const r = compile(expr, { fallback: false, constantFold: false })!;

    expect(r.success).toBe(true);
    expect(r.code).toContain('_fn_Negate');
    expect(r.run!({}) as number).toBe(expr.evaluate().N().re!);
  });

  it('fails CLOSED for an operator with no expandable arity', () => {
    // `Random` (zero required) and `Less`/`NotLess` (one required plus a
    // VARIADIC tail — the mapped and unmapped routes respectively) have no
    // single wrapper arity. Rather than emitting a dangling `_.Random` that
    // throws `_f is not a function` at RUN time, they refuse at compile time.
    const e = new ComputeEngine();
    // `Random` reaches the emission gate over a list of LISTS (its declared
    // parameter is `collection<any> | set<real>?`, so the Design E gate
    // statically rejects it over integer elements) and pins the specific
    // refusal message.
    expect(() =>
      compile(e.box(['Map', 'Random', ['List', ['List', 1, 2], ['List', 3, 4]]]), {
        fallback: false,
      })
    ).toThrow(
      /Random: cannot compile as a first-class function[\s\S]*Fail closed/
    );
    // `Less`/`NotLess` require at least TWO arguments while `Map` supplies
    // one, so since the static callback-arity check (2026-08-15) the call is
    // already invalid when the compiler sees it. The refusal reads
    // `Cannot compile invalid expression`; nothing is emitted either way.
    for (const op of ['Less', 'NotLess']) {
      expect(() =>
        compile(e.box(['Map', op, XS]), { fallback: false })
      ).toThrow(/Fail closed|invalid expression/);
    }
    // With the default fallback route the interpreter answers instead.
    const r = compile(e.box(['Map', 'Random', XS]));
    expect(r?.success).toBe(false);
  });

  it('leaves a NON-built-in free symbol alone', () => {
    // The fail-closed refusal is scoped to a system-provenance operator name:
    // a plain unknown symbol in callback position keeps its previous
    // free-variable read.
    const e = new ComputeEngine();
    const r = compile(e.box(['Map', 'zork', XS]), { fallback: false })!;
    expect(r.code).toContain('_.zork');
  });

  it('fails CLOSED when the wrapper body has no lowering', () => {
    // `IsPrime` eta-expands, but its application has no JavaScript mapping:
    // a compile-time refusal, not an artifact that throws at run time.
    const e = new ComputeEngine();
    // The expression is constant, so constant folding would answer from the
    // interpreter and never reach the wrapper lowering under test.
    expect(() =>
      compile(e.box(['CountIf', XS, 'IsPrime']), {
        fallback: false,
        constantFold: false,
      })
    ).toThrow(/Fail closed/);

    // With the fallback, the interpreter answers.
    const r = compile(e.box(['CountIf', XS, 'IsPrime']), {
      constantFold: false,
    });
    expect(r?.success).toBe(false);
    expect(r!.run!({})).toBe(3);
  });

  it('applies a caller `functions` override inside the wrapper', () => {
    // The wrapper body is an ordinary application, so a caller mapping of the
    // operator applies within it — the same semantics an inline
    // `x ↦ Sin(x)` callback has.
    const e = new ComputeEngine();
    const expr = e.box([
      'Function',
      ['Add', ['Sum', ['Map', 'Sin', XS]], 't'],
      't',
    ]);
    const r = compile(expr, { fallback: false, functions: { Sin: 'mySin' } })!;
    expect(r.code).toContain('const _fn_Sin = (_tv1) => mySin(_tv1);');
  });
});

// A block-local introduced by bare ASSIGNMENT rather than by `Declare`.
// `canonicalBlock` hoists such a name into the block's OWN scope (that is why
// `{ w ⩴ 2t; w + 1 }` answers `2t+1` in the interpreter and leaks no `w`), but
// no `Declare` statement records it — so the compiler's locals harvest missed
// it entirely and the two halves of the local disagreed: the write emitted a
// bare `w = …` while every read emitted the free-variable spelling `_.w`,
// which nothing ever wrote. A canonical `Function`-literal body IS such a
// block, so every emitted user-function definition with a multi-statement body
// ran to `NaN` behind `success: true`.
describe('block-locals bound by bare assignment (no `Declare`)', () => {
  /** An engine with `a` assigned the one-parameter literal `t ↦ <body>`. */
  const engineWithA = (body: MathJsonExpression): ComputeEngine => {
    const e = new ComputeEngine();
    // `scope` declared: the body binds locals by bare assignment, which the
    // default-`!scope` ceiling otherwise refuses (docs/EFFECTS-MODEL.md,
    // "Scope is opt-in").
    e.declare('a', { signature: '(number) scope -> number' });
    e.assign('a', e.box(['Function', body, 't']));
    e.declare('u', 'number');
    return e;
  };

  const WITNESS: MathJsonExpression = [
    'Block',
    ['Assign', 'w', ['Multiply', 2, 't']],
    ['Add', 'w', 1],
  ];
  const TWO_ASSIGNS: MathJsonExpression = [
    'Block',
    ['Assign', 'w', ['Multiply', 2, 't']],
    ['Assign', 'v', ['Add', 'w', 1]],
    ['Multiply', 'v', 'v'],
  ];
  const LOCAL_IN_EXPRESSION: MathJsonExpression = [
    'Block',
    ['Assign', 'w', ['Multiply', 2, 't']],
    ['Add', ['Multiply', 'w', 'w'], 't'],
  ];
  const DECLARE_THEN_ASSIGN: MathJsonExpression = [
    'Block',
    ['Declare', 'w', 'number'],
    ['Assign', 'w', ['Multiply', 2, 't']],
    ['Add', 'w', 1],
  ];

  /**
   * The invariant, per shape: a JavaScript compile of `a(u) + 1` either
   * DECLINES, or answers exactly what the interpreter answers. It must never
   * report `success: true` and then run to `NaN`/`null`.
   */
  const expectJsAgreesWithInterpreter = (
    body: MathJsonExpression,
    expected: number
  ): void => {
    const e = engineWithA(body);
    expect(e.box(['Add', ['a', 3], 1]).evaluate().re).toBe(expected);
    const r = compile(e.box(['Add', ['a', 'u'], 1]));
    if (!r?.success) return; // a decline is acceptable; a wrong value is not
    expect(r.run!({ u: 3 })).toBe(expected);
  };

  it('JS: the witness body runs to the interpreter value (was NaN)', () => {
    expectJsAgreesWithInterpreter(WITNESS, 8);
  });

  it('JS: a body with TWO assigned locals runs correctly', () => {
    expectJsAgreesWithInterpreter(TWO_ASSIGNS, 50);
  });

  it('JS: a local consumed by a larger last expression runs correctly', () => {
    expectJsAgreesWithInterpreter(LOCAL_IN_EXPRESSION, 40);
  });

  it('JS: the `Declare`+`Assign` body is unchanged', () => {
    expectJsAgreesWithInterpreter(DECLARE_THEN_ASSIGN, 8);
  });

  it('JS: a top-level (non-lambda) block declares its assigned local', () => {
    const e = new ComputeEngine();
    e.declare('t', 'number');
    const expr = e.box([
      'Block',
      ['Assign', 'w', ['Multiply', 2, 't']],
      ['Add', 'w', 1],
    ]);
    const r = compile(expr);
    expect(r?.success).toBe(true);
    expect(r!.code).toContain('let w');
    // Symmetric: the read is the same bare name the write binds.
    expect(r!.code).not.toContain('_.w');
    expect(r!.run!({ t: 4 })).toBe(9);
    e.assign('t', 4);
    expect(expr.evaluate().re).toBe(9);
  });

  it('JS: a loop body binding a scratch local runs correctly', () => {
    const e = new ComputeEngine();
    const expr = e.box([
      'Block',
      ['Declare', 's', 'number'],
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 'q', ['Multiply', 2, 'i']],
          ['Assign', 's', ['Add', 's', 'q']],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ]);
    expect(expr.evaluate().re).toBe(12);
    const r = compile(expr);
    expect(r?.success).toBe(true);
    expect(r!.code).not.toContain('_.q');
    expect(r!.run!({})).toBe(12);
  });

  it('JS: a multi-statement multi-clause body runs correctly', () => {
    const e = new ComputeEngine();
    const p = (n: string, t: string): MathJsonExpression => [
      'Typed',
      n,
      { str: t },
    ];
    e.box(['DefineFunction', 'g', ['Function', 0, p('z', '0')]]).evaluate();
    // The `scope` row is required, not decoration: a bare `Assign` to a name
    // the body never declared is not PROVABLY confined — the analysis cannot
    // tell a fresh temp from a write to an enclosing literal's local — so the
    // default-`!scope` ceiling refuses such a clause unless the definition
    // opts in with `scope` (or declares the local with `Declare`, which is the
    // one shape this suite is deliberately not using). See
    // `docs/EFFECTS-MODEL.md`, "Scope is opt-in".
    e.box([
      'DefineFunction',
      'g',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Assign', 'w', ['Multiply', 2, 'n']], ['Add', 'w', 1]],
          { str: '(n: integer) scope -> integer' },
        ],
        'n',
      ],
    ]).evaluate();
    expect(e.box(['g', 3]).evaluate().re).toBe(7);
    const r = compile(e.box(['g', 'y']));
    expect(r?.success).toBe(true);
    expect(r!.run!({ y: 3 })).toBe(7);
    expect(r!.run!({ y: 0 })).toBe(0);
  });

  it('GLSL: the emitted definition DECLARES the assigned local', () => {
    const glsl = new GLSLTarget();
    const e = engineWithA(WITNESS);
    const r = glsl.compile(e.box(['Add', ['a', 'u'], 1]));
    expect(r.success).toBe(true);
    // Without a declaration this is not GLSL a driver would accept.
    expect(r.preamble).toContain('float w;');
    expect(r.preamble).toContain('w = 2.0 * t;');
    expect(r.preamble).toContain('return w + 1.0;');
  });

  it('GLSL: the `Declare`+`Assign` body emits the same definition', () => {
    const glsl = new GLSLTarget();
    const implicit = glsl.compile(
      engineWithA(WITNESS).box(['a', 'u'])
    ).preamble;
    const declared = glsl.compile(
      engineWithA(DECLARE_THEN_ASSIGN).box(['a', 'u'])
    ).preamble;
    expect(implicit).toBe(declared);
  });

  it('Python: user-defined functions decline outright (unchanged)', () => {
    const py = new PythonTarget();
    for (const body of [WITNESS, TWO_ASSIGNS, DECLARE_THEN_ASSIGN]) {
      const e = engineWithA(body);
      expect(() => py.compile(e.box(['Add', ['a', 'u'], 1]))).toThrow(
        /Unknown operator `a`/
      );
    }
  });

  // Single-statement bodies (including the `Block(Typed(…))` ascription shape)
  // have no assignment to hoist, so they must stay BYTE-IDENTICAL: the block
  // is still unwrapped, with no synthesized declaration.
  it('a single-statement body is unwrapped, unchanged', () => {
    const glsl = new GLSLTarget();
    for (const body of [
      ['Block', ['Add', ['Multiply', 2, 't'], 1]] as MathJsonExpression,
      [
        'Block',
        ['Typed', ['Add', ['Multiply', 2, 't'], 1], { str: 'number' }],
      ] as MathJsonExpression,
    ]) {
      const e = engineWithA(body);
      // No synthesized declaration, no IIFE — the statement is still unwrapped.
      expect(glsl.compile(e.box(['a', 'u'])).preamble!.trim()).toBe(
        'float _fn_a(float t) {\n  return 2.0 * t + 1.0;\n}'
      );
      const js = compile(engineWithA(body).box(['Add', ['a', 'u'], 1]));
      expect(js!.run!({ u: 3 })).toBe(8);
    }
  });
});

// A block-local bound by bare assignment inside a LOOP BODY, on a shader
// target. `withImplicitLocalDeclares` runs from two places — `compileBlock`
// and `compileLoopBody` — and only the first pushes the complex-ness /
// vector-width frames that give a local its shader type. That does NOT leave a
// GPU loop-body local untyped, because the GPU targets never reach
// `compileLoopBody`: their own `Loop` handler (`GPU_FUNCTIONS.Loop`) routes the
// body through `compileStatementList`, which hands a `Block` body straight to
// `compileBlock` — the same statement-list compiler, inference included.
// (`compileForLoop`/`compileLoopBody` is the JavaScript-family path, and is
// reached only when the target declares no `Loop` function.)
//
// These pin that routing by its OBSERVABLE consequence: a vector-valued
// loop-body local is declared `vec2`/`vec2f` (never the `float` default paired
// with a `vecN` assignment — source no driver accepts), an aggregate wider than
// 4 gets the matching array type, and a local bound to disagreeing shapes fails
// closed instead of emitting either.
describe('GPU loop-body block-locals get the shader type inference', () => {
  /** An engine with `a` assigned the one-parameter literal `t ↦ <body>`. */
  const engineWithA = (body: MathJsonExpression): ComputeEngine => {
    const e = new ComputeEngine();
    // `scope` declared: the body binds locals by bare assignment, which the
    // default-`!scope` ceiling otherwise refuses (docs/EFFECTS-MODEL.md,
    // "Scope is opt-in").
    e.declare('a', { signature: '(number) scope -> number' });
    e.assign('a', e.box(['Function', body, 't']));
    e.declare('u', 'number');
    return e;
  };

  /** `s ⩴ 0; for k ∈ 1..3 { <stmts> }; s` */
  const accumulate = (stmts: MathJsonExpression[]): MathJsonExpression => [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    [
      'Loop',
      ['Block', ...stmts] as MathJsonExpression,
      ['Element', 'k', ['Range', 1, 3]],
    ],
    's',
  ];

  /** The local `p` is bound to a 2-tuple by bare assignment. */
  const IMPLICIT_VEC2 = accumulate([
    ['Assign', 'p', ['Tuple', 't', ['Multiply', 2, 't']]],
    ['Assign', 's', ['Add', 's', ['At', 'p', 1]]],
  ]);
  /** …and the `Declare`+`Assign` sibling of the same body. */
  const DECLARED_VEC2 = accumulate([
    ['Declare', 'p'],
    ['Assign', 'p', ['Tuple', 't', ['Multiply', 2, 't']]],
    ['Assign', 's', ['Add', 's', ['At', 'p', 1]]],
  ]);

  it('GLSL: a vector-valued loop-body local is declared `vec2`', () => {
    const glsl = new GLSLTarget();
    const r = glsl.compile(engineWithA(IMPLICIT_VEC2).box(['a', 'u']));
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('vec2 p;');
    expect(r.preamble).toContain('p = vec2(t, 2.0 * t);');
    // The `float` default would disagree with that assignment.
    expect(r.preamble).not.toContain('float p;');
    // …and the declaration is inside the loop, where the binding is.
    expect(r.preamble!.indexOf('for (int k')).toBeLessThan(
      r.preamble!.indexOf('vec2 p;')
    );
  });

  it('WGSL: the same local is declared `vec2f`', () => {
    const wgsl = new WGSLTarget();
    const r = wgsl.compile(engineWithA(IMPLICIT_VEC2).box(['a', 'u']));
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('var p: vec2f;');
    expect(r.preamble).toContain('p = vec2f(t, 2.0 * t);');
    expect(r.preamble).not.toContain('var p: f32;');
  });

  it('GLSL: the `Declare`+`Assign` sibling emits the same definition', () => {
    const glsl = new GLSLTarget();
    expect(
      glsl.compile(engineWithA(IMPLICIT_VEC2).box(['a', 'u'])).preamble
    ).toBe(glsl.compile(engineWithA(DECLARED_VEC2).box(['a', 'u'])).preamble);
  });

  it('GLSL: an aggregate wider than 4 gets the array type', () => {
    const glsl = new GLSLTarget();
    const r = glsl.compile(
      engineWithA(
        accumulate([
          ['Assign', 'p', ['List', 1, 2, 3, 4, 5]],
          ['Assign', 's', ['Add', 's', ['At', 'p', 2]]],
        ])
      ).box(['a', 'u'])
    );
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('float[5] p;');
    expect(r.preamble).toContain('p = float[5](1.0, 2.0, 3.0, 4.0, 5.0);');
  });

  it('GPU: a loop-body local bound to disagreeing shapes fails closed', () => {
    const body = accumulate([
      ['Assign', 'p', ['Tuple', 't', ['Multiply', 2, 't']]],
      ['Assign', 'p', ['Multiply', 3, 't']],
      ['Assign', 's', ['Add', 's', ['At', 'p', 1]]],
    ]);
    for (const target of [new GLSLTarget(), new WGSLTarget()])
      expect(() => target.compile(engineWithA(body).box(['a', 'u']))).toThrow(
        /disagreeing shapes/
      );
  });

  it('JS: the same loop body agrees with the interpreter', () => {
    // The JavaScript control for the shapes above: this IS the
    // `compileLoopBody` path, and its locals are untyped, so the vector local
    // needs no inference to be correct.
    const e = engineWithA(IMPLICIT_VEC2);
    expect(e.box(['a', 3]).evaluate().re).toBe(9);
    const r = compile(e.box(['a', 'u']));
    expect(r?.success).toBe(true);
    expect(r!.run!({ u: 3 })).toBe(9);
  });
});

// A loop-body block-local bound to a COMPLEX value, on the JavaScript path.
// `compileLoopBody`'s `Block` branch is a statement list of its own — it does
// NOT go through `compileBlock` — and it pushed no complex-ness frame, so
// `isComplexValued` answered `false` for the local: the write emitted the
// `{ re, im }` object convention while every read lowered as a real
// (`|z|` → `Math.abs` on an object), i.e. `NaN` behind `success: true`. The
// same body WITHOUT the loop was correct, because `compileBlock` pushes the
// frame. An explicitly declared local behaved identically.
describe('a COMPLEX loop-body block-local (JavaScript)', () => {
  const engineWithT = (): ComputeEngine => {
    const e = new ComputeEngine();
    e.declare('t', 'number');
    return e;
  };

  /**
   * `s ⩴ 0; for k ∈ 1..3 { <stmts> }; s` — at TOP LEVEL rather than in a
   * function literal, so the emitted statements are visible in `code` (a
   * user-function definition lives in the run closure, not in `code`).
   */
  const accumulate = (stmts: MathJsonExpression[]): MathJsonExpression => [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    [
      'Loop',
      ['Block', ...stmts] as MathJsonExpression,
      ['Element', 'k', ['Range', 1, 3]],
    ],
    's',
  ];

  /** `z ⩴ t + i; s ⩴ s + |z|` — three times, so `s = 3√10` at `t = 3`. */
  const COMPLEX_STMTS: MathJsonExpression[] = [
    ['Assign', 'z', ['Add', 't', 'ImaginaryUnit']],
    ['Assign', 's', ['Add', 's', ['Abs', 'z']]],
  ];
  const IMPLICIT_COMPLEX = accumulate(COMPLEX_STMTS);
  const DECLARED_COMPLEX = accumulate([['Declare', 'z'], ...COMPLEX_STMTS]);

  const expectComplexLoopLocal = (body: MathJsonExpression): void => {
    // The interpreter's answer: |3 + i| summed three times.
    const interpreted = engineWithT();
    const expr = interpreted.box(body);
    interpreted.assign('t', 3);
    expect(expr.evaluate().N().re).toBeCloseTo(3 * Math.sqrt(10), 12);

    const r = compile(engineWithT().box(body));
    expect(r?.success).toBe(true);
    // The complex-aware modulus, not `Math.abs` on a `{ re, im }` object.
    expect(r!.code).toContain('_SYS.cabs(z)');
    expect(r!.code).not.toContain('Math.abs(z)');
    expect(r!.run!({ t: 3 })).toBeCloseTo(3 * Math.sqrt(10), 12);
  };

  it('JS: an implicit complex loop-body local runs to 3√10 (was NaN)', () => {
    expectComplexLoopLocal(IMPLICIT_COMPLEX);
  });

  it('JS: the `Declare`d sibling runs to 3√10 too (was NaN)', () => {
    expectComplexLoopLocal(DECLARED_COMPLEX);
  });

  it('JS: a VECTOR loop-body local is unchanged', () => {
    // The control for the frame that is deliberately NOT pushed on this route:
    // a JS local is untyped, so the vector width feeds nothing here, and this
    // shape already agreed with the interpreter.
    const body = accumulate([
      ['Assign', 'p', ['Tuple', 't', ['Multiply', 2, 't']]],
      ['Assign', 's', ['Add', 's', ['At', 'p', 1]]],
    ]);
    const interpreted = engineWithT();
    const expr = interpreted.box(body);
    interpreted.assign('t', 3);
    expect(expr.evaluate().re).toBe(9);

    const r = compile(engineWithT().box(body));
    expect(r?.success).toBe(true);
    expect(r!.code).toContain('let p; p = [_.t, 2 * _.t]');
    expect(r!.run!({ t: 3 })).toBe(9);
  });
});

// The sibling of the describe above, which differs from it in ONE statement:
// it drops the `Declare(s, "number")`. That is enough to change what `s` IS.
//
// `canonicalBlock` makes a bare-assigned name a block-local only when the
// enclosing scope chain does not already bind it — and the library scope
// PRE-DECLARES `e`, `i`, `m` and `s`. So `s` here is not hoisted: the
// interpreter writes the OUTER binding and reads it back (`3√10`), while the
// compiler emitted a bare `s = …` write against `_.s` reads — a stray sloppy
// global on one side, `undefined` on the other. Both routes ran to `undefined`
// behind `success: true`.
//
// The fix (`BaseCompiler.assignLValue`) makes a write use the SAME spelling a
// read of that name compiles to.
describe('an Assign to a non-hoisted (outer) name agrees with its reads', () => {
  const LOOP: MathJsonExpression = [
    'Loop',
    [
      'Block',
      ['Assign', 'z', ['Add', 't', 'ImaginaryUnit']],
      ['Assign', 's', ['Add', 's', ['Abs', 'z']]],
    ],
    ['Element', 'k', ['Range', 1, 3]],
  ];
  /** `s ⩴ 0; for k ∈ 1..3 { z ⩴ t + i; s ⩴ s + |z| }; s` — no `Declare s`. */
  const BODY: MathJsonExpression = ['Block', ['Assign', 's', 0], LOOP, 's'];
  const EXPECTED = 3 * Math.sqrt(10);

  // `s`/`z` have no `Declare`, so the inference conservatively judges the
  // writes escaping and the default-`!scope` ceiling refuses a bare install —
  // the `effects: ['scope']` flag states the contract without declaring a
  // signature (this suite's UNDECLARED route needs the signature absent).
  const engineWithA = (declared: boolean): ComputeEngine => {
    const e = new ComputeEngine();
    if (declared) {
      // `scope` declared: the body binds locals by bare assignment, which the
      // default-`!scope` ceiling otherwise refuses (docs/EFFECTS-MODEL.md,
      // "Scope is opt-in").
      e.declare('a', { signature: '(number) scope -> number' });
      e.assign('a', e.box(['Function', BODY, 't']));
    } else {
      e.declare('a', { effects: ['scope'], evaluate: e.box(['Function', BODY, 't']) });
    }
    return e;
  };

  it('the interpreter answers 3√10 (the reference)', () => {
    const e = new ComputeEngine();
    e.declare('a', { effects: ['scope'], evaluate: e.box(['Function', BODY, 't']) });
    expect(e.box(['a', 3]).evaluate().N().re).toBeCloseTo(EXPECTED, 12);
  });

  it('JS: the DECLARED user-function route runs to 3√10 (was undefined)', () => {
    const r = compile(engineWithA(true).box(['a', 'u']));
    expect(r?.success).toBe(true);
    expect(r!.code).toBe('((_tv1) => Array.isArray(_tv1) ? _SYS.bcastFn((_tv2) => _fn_a(_tv2), _tv1) : _fn_a(_tv1))(_.u)');
    expect(r!.run!({ u: 3 })).toBeCloseTo(EXPECTED, 12);
  });

  it('JS: the UNDECLARED (broadcast-wrapper) route runs to 3√10 too', () => {
    const r = compile(engineWithA(false).box(['a', 'u']));
    expect(r?.success).toBe(true);
    expect(r!.run!({ u: 3 })).toBeCloseTo(EXPECTED, 12);
  });

  it('JS: the same Loop at the TOP LEVEL of a block writes `_.s`', () => {
    const e = new ComputeEngine();
    e.declare('t', 'number');
    const r = compile(e.box(BODY));
    expect(r?.success).toBe(true);
    // Both halves of the variable now agree on the vars-object spelling…
    expect(r!.code).toContain('_.s = 0');
    expect(r!.code).toContain('_.s = _.s + _SYS.cabs(z)');
    expect(r!.code).toContain('return _.s');
    // …and no bare `s = ` write survives (a sloppy-mode global).
    expect(r!.code).not.toMatch(/(^|[^.\w])s = /);
    expect(r!.run!({ t: 3 })).toBeCloseTo(EXPECTED, 12);
  });

  it('JS: the `Declare`d sibling still emits a BARE block local', () => {
    // The control: with the `Declare`, `s` IS hoisted to a block-local, and
    // its emission is unchanged by the fix — `let s`, bare reads and writes.
    const e = new ComputeEngine();
    e.declare('t', 'number');
    const r = compile(
      e.box([
        'Block',
        ['Declare', 's', 'number'],
        ['Assign', 's', 0],
        LOOP,
        's',
      ])
    );
    expect(r?.success).toBe(true);
    expect(r!.code).toContain('let s;');
    expect(r!.code).toContain('s = 0');
    expect(r!.code).toContain('s = s + _SYS.cabs(z)');
    expect(r!.code).toContain('return s');
    expect(r!.code).not.toContain('_.s');
    expect(r!.run!({ t: 3 })).toBeCloseTo(EXPECTED, 12);
  });

  it('GLSL: the shape is unchanged (a shader spells a free symbol bare)', () => {
    // The shader targets resolve a free symbol to its own bare identifier, so
    // reads and writes already agreed there — pinned so the JS fix stays JS's.
    const e = new ComputeEngine();
    e.declare('t', 'number');
    const r = new GLSLTarget().compile(e.box(BODY));
    expect(r.success).toBe(true);
    expect(r.code).toContain('s = 0.0;');
    expect(r.code).toContain('s = s + length(z);');
    expect(r.code).toContain('return s;');
  });

  it('a write to a symbol whose value every read BAKES fails closed', () => {
    // The other half of the asymmetry: when the symbol has an engine value the
    // target resolves nothing and reads fold the value, so no write can reach
    // them. Declining hands the expression back to the interpreter (`1`)
    // rather than compiling the stale `42 + 1`.
    const e = new ComputeEngine();
    e.assign('s', 42);
    const body: MathJsonExpression = [
      'Block',
      ['Assign', 's', 0],
      ['Add', 's', 1],
    ];
    expect(() => compile(e.box(body), { fallback: false })).toThrow(
      /has an assigned value/
    );
    const r = compile(e.box(body));
    expect(r?.success).toBe(false);
    expect(r!.run!({})).toBe(1);
  });

  it('a write to a baked CONSTANT fails closed', () => {
    const e = new ComputeEngine();
    expect(() =>
      compile(e.box(['Block', ['Assign', 'Pi', 0], ['Add', 'Pi', 1]]), {
        fallback: false,
      })
    ).toThrow(/not an assignable reference/);
  });
});

// The GPU user-function return type is synthesized with `gpuTypeOfValue` on
// the body. For a multi-statement body that is a `Block`, and `isComplexValued`
// answered it with the conservative "any operand is complex" recursion — so a
// body that merely BINDS a complex local, and returns a real, was declared
// `vec2 _fn_a(float t)` around a `return s;` (a float). That is invalid shader
// source behind `success: true`. A block's value is its LAST statement.
describe('GPU user-function return type comes from the body VALUE', () => {
  const engineWithA = (body: MathJsonExpression): ComputeEngine => {
    const e = new ComputeEngine();
    // `scope` declared: the body binds locals by bare assignment, which the
    // default-`!scope` ceiling otherwise refuses (docs/EFFECTS-MODEL.md,
    // "Scope is opt-in").
    e.declare('a', { signature: '(number) scope -> number' });
    e.assign('a', e.box(['Function', body, 't']));
    e.declare('u', 'number');
    return e;
  };

  /** `s ⩴ 0; z ⩴ t + i; s ⩴ s + |z|; s` — a REAL value, a complex local. */
  const REAL_VALUE_COMPLEX_LOCAL: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    ['Assign', 'z', ['Add', 't', 'ImaginaryUnit']],
    ['Assign', 's', ['Add', 's', ['Abs', 'z']]],
    's',
  ];
  /** …and the control: `z ⩴ t + i; z²` genuinely RETURNS a complex value. */
  const COMPLEX_VALUE: MathJsonExpression = [
    'Block',
    ['Assign', 'z', ['Add', 't', 'ImaginaryUnit']],
    ['Multiply', 'z', 'z'],
  ];

  it('GLSL: a real value with a complex local declares `float`', () => {
    const r = new GLSLTarget().compile(
      engineWithA(REAL_VALUE_COMPLEX_LOCAL).box(['a', 'u'])
    );
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('float _fn_a(float t)');
    expect(r.preamble).not.toContain('vec2 _fn_a');
    // The interior local still gets its `vec2` declaration…
    expect(r.preamble).toContain('vec2 z;');
    // …and the returned value is the real accumulator, matching the signature.
    expect(r.preamble).toContain('return s;');
  });

  it('WGSL: the same body declares `-> f32`', () => {
    const r = new WGSLTarget().compile(
      engineWithA(REAL_VALUE_COMPLEX_LOCAL).box(['a', 'u'])
    );
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('fn _fn_a(t: f32) -> f32');
    expect(r.preamble).not.toContain('-> vec2f');
    expect(r.preamble).toContain('var z: vec2f;');
    expect(r.preamble).toContain('return s;');
  });

  it('a body that genuinely returns a complex value still gets `vec2`', () => {
    const glsl = new GLSLTarget().compile(
      engineWithA(COMPLEX_VALUE).box(['a', 'u'])
    );
    expect(glsl.success).toBe(true);
    expect(glsl.preamble).toContain('vec2 _fn_a(float t)');
    const wgsl = new WGSLTarget().compile(
      engineWithA(COMPLEX_VALUE).box(['a', 'u'])
    );
    expect(wgsl.success).toBe(true);
    expect(wgsl.preamble).toContain('fn _fn_a(t: f32) -> vec2f');
  });

  it('JS: both bodies agree with the interpreter', () => {
    for (const [body, expected] of [
      [REAL_VALUE_COMPLEX_LOCAL, Math.sqrt(10)],
      [COMPLEX_VALUE, 8], // (3 + i)² = 8 + 6i → `.re` is 8
    ] as const) {
      const e = engineWithA(body);
      expect(e.box(['a', 3]).evaluate().N().re).toBeCloseTo(expected, 12);
      const r = compile(e.box(['a', 'u']));
      expect(r?.success).toBe(true);
      const v = r!.run!({ u: 3 });
      expect(typeof v === 'number' ? v : (v as { re: number }).re).toBeCloseTo(
        expected,
        12
      );
    }
  });
});

// A GPU function body containing an EARLY RETURN. `Return` lowers to the bare
// statement `return <v>`, which the shader targets can only place where a
// statement is expected — and their signature is synthesized STATICALLY from
// the body's own value, so every `return` in the body must also agree with it.
// Neither held, and the mismatches went out behind `success: true`:
//
//  - a `Return` in a conditional arm lands inside the GLSL ternary / WGSL
//    `select(…)` the branches lower to — `((0.0 < t) ? (return …) : …)`, which
//    is not GLSL at all;
//  - a `Return` that IS the block's value gets return-prefixed by the block
//    emitter — `return return s;`;
//  - a `Return` whose value has a different shape than the body's value emits
//    `float _fn_a(float t) { … return vec2(t, 1.0); … }`.
//
// Restructuring an early return into flags and guards is a feature, not a
// gate: these DECLINE, so the interpreter evaluates the expression. The one
// shape that already lowered validly — an early `Return` as a plain statement
// of the body, of the body's own shape — keeps compiling.
describe('a GPU user-function body with an early `Return`', () => {
  const engineWithA = (body: MathJsonExpression): ComputeEngine => {
    const e = new ComputeEngine();
    // `any` declared: every body here contains `Return`, which the effects
    // walk sees as an unresolved head (`Return` has no operator definition —
    // it is handled structurally by the Block evaluator), so each body
    // infers effects `any`; and RETURN_COMPLEX_LOCAL additionally binds `z`
    // by bare assignment, which the default-`!scope` ceiling refuses on a
    // bare declaration. The `any` contract covers both (`scope` alone would
    // not: `any ⊄ {scope}`).
    e.declare('a', { signature: '(number) any -> number' });
    e.assign('a', e.box(['Function', body, 't']));
    e.declare('u', 'number');
    return e;
  };

  /** `s ⩴ 0; Return(t + i); s` — a vec2 `Return` in a float-valued body. */
  const RETURN_SHAPE_MISMATCH: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    ['Return', ['Add', 't', 'ImaginaryUnit']],
    's',
  ];
  /** …and the frame-sensitive sibling: the returned value is a complex LOCAL. */
  const RETURN_COMPLEX_LOCAL: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    ['Assign', 'z', ['Add', 't', 'ImaginaryUnit']],
    ['Return', 'z'],
    's',
  ];
  /** `s ⩴ 0; if 0 < t { Return(2t) } else { s ⩴ 1 }; s` — a BRANCH position. */
  const RETURN_IN_BRANCH: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    [
      'If',
      ['Less', 0, 't'],
      ['Return', ['Multiply', 2, 't']],
      ['Assign', 's', 1],
    ],
    's',
  ];
  /** `s ⩴ 0; s ⩴ s + t; Return(s)` — the block's VALUE is the `Return`. */
  const RETURN_IS_VALUE: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    ['Assign', 's', ['Add', 's', 't']],
    ['Return', 's'],
  ];
  /** The VALID control: an early `Return` of the body's own (float) shape. */
  const EARLY_RETURN_OK: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 0],
    ['Return', ['Multiply', 2, 't']],
    's',
  ];

  const gpuTargets = () => [new GLSLTarget(), new WGSLTarget()];

  it('a `Return` whose shape disagrees with the body fails closed', () => {
    for (const body of [RETURN_SHAPE_MISMATCH, RETURN_COMPLEX_LOCAL])
      for (const target of gpuTargets())
        expect(() => target.compile(engineWithA(body).box(['a', 'u']))).toThrow(
          /a `Return` in this body yields a "vec2f?" value, but "a" is declared to return "(float|f32)"/
        );
  });

  it('a `Return` in a conditional BRANCH fails closed', () => {
    for (const target of gpuTargets())
      expect(() =>
        target.compile(engineWithA(RETURN_IN_BRANCH).box(['a', 'u']))
      ).toThrow(
        /an early `Return` here has no (GLSL|WGSL) lowering .* requires an expression/s
      );
  });

  it('a `Return` in the block VALUE position fails closed', () => {
    // Emitted `return return s;` before the gate.
    for (const target of gpuTargets())
      expect(() =>
        target.compile(engineWithA(RETURN_IS_VALUE).box(['a', 'u']))
      ).toThrow(/requires an expression \(`return return s;`\)/);
  });

  it('the decline is reported as `success: false`, not as source', () => {
    // The documented decline route: with `fallback`, an interpreter-backed
    // result — never a shader carrying a misplaced `return`.
    for (const target of gpuTargets()) {
      const r = target.compile(engineWithA(RETURN_IN_BRANCH).box(['a', 'u']), {
        fallback: true,
      });
      expect(r.success).toBe(false);
      expect(r.code ?? '').not.toContain('return');
    }
  });

  it('an early `Return` of the body’s own shape still compiles', () => {
    const glsl = new GLSLTarget().compile(
      engineWithA(EARLY_RETURN_OK).box(['a', 'u'])
    );
    expect(glsl.success).toBe(true);
    expect(glsl.preamble).toContain('float _fn_a(float t)');
    expect(glsl.preamble).toContain('return 2.0 * t;');
    expect(glsl.preamble).toContain('return s;');

    const wgsl = new WGSLTarget().compile(
      engineWithA(EARLY_RETURN_OK).box(['a', 'u'])
    );
    expect(wgsl.success).toBe(true);
    expect(wgsl.preamble).toContain('fn _fn_a(t: f32) -> f32');
    expect(wgsl.preamble).toContain('return 2.0 * t;');
  });

  it('JS is unchanged: it lowers every one of these bodies itself', () => {
    // The JavaScript control. JS declares no return type and has real early
    // returns, so these are its business, not the gate's — and the two shapes
    // it already compiled must keep their exact answers.
    for (const [body, expected] of [
      [EARLY_RETURN_OK, 6],
      [RETURN_SHAPE_MISMATCH, 3], // `(3 + i)` → `.re` is 3
      [RETURN_COMPLEX_LOCAL, 3],
    ] as const) {
      const e = engineWithA(body);
      expect(e.box(['a', 3]).evaluate().N().re).toBeCloseTo(expected, 12);
      const r = compile(e.box(['a', 'u']));
      expect(r?.success).toBe(true);
      const v = r!.run!({ u: 3 });
      expect(typeof v === 'number' ? v : (v as { re: number }).re).toBeCloseTo(
        expected,
        12
      );
    }
  });
});

// The expression-only GPU routes. `compileToSource()` answers with a bare
// expression string, and each `compileShader()` body statement is spliced into
// an assignment RHS (`fragColor = <code>;`) — both are EXPRESSION positions.
// Neither was gated, so a multi-statement `Block` went out as bare statements
// behind the expression contract: `compileToSource` returned
// `"float s;\ns = x;\nreturn return s;"`, and `compileShader` emitted
// `fragColor = float s;\ns = x;\nreturn return s;;`. Neither language has an
// expression-level block or IIFE to wrap statements in, so both routes now
// decline and point at `compile()`, which IS statement-capable.
describe('the expression-only GPU routes decline statement bodies', () => {
  const engineWithX = (): ComputeEngine => {
    const e = new ComputeEngine();
    e.declare('x', 'number');
    return e;
  };

  /** `float s; s = x; return return s;` before the gate. */
  const DECLARE_ASSIGN_RETURN: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 'x'],
    ['Return', 's'],
  ];
  /** `s = x;\nreturn s;` before the gate — a statement sequence, no `Return`. */
  const ASSIGN_THEN_VALUE: MathJsonExpression = [
    'Block',
    ['Assign', 's', 'x'],
    's',
  ];
  /** `return x` before the gate — a bare statement, not an expression. */
  const BARE_RETURN: MathJsonExpression = ['Block', ['Return', 'x']];
  /**
   * The single-line hole the emitted-source scan cannot see: an assignment
   * body emits `s = x` — one line, no `return` token — on BOTH targets. GLSL
   * assignment is an OPERATOR, so `fragColor = s = x;` is valid there; WGSL
   * assignment is a STATEMENT, so the same emission is invalid source behind a
   * reported success. Declined structurally on WGSL only.
   */
  const ASSIGN_ONLY: MathJsonExpression = ['Block', ['Assign', 's', 'x']];
  /**
   * The other single-line hole the emitted-source scan cannot see: a ROOT
   * `Declare` emits one bare declaration — `float s` / `var s: f32` — on both
   * targets. A declaration is a STATEMENT in BOTH languages (unlike the
   * assignment above, which GLSL keeps), and the emission also silently DROPS
   * the initializer `x`. Only the bare root shape leaks: block-wrapped with
   * anything after it, the declaration is followed by more lines and the
   * multi-line gate already declines it.
   */
  const DECLARE_ONLY: MathJsonExpression = ['Declare', 's', 'number', 'x'];

  const gpuTargets = () => [new GLSLTarget(), new WGSLTarget()];

  const shaderFor = (
    target: GLSLTarget | WGSLTarget,
    expr: MathJsonExpression,
    e: ComputeEngine
  ): string =>
    target.compileShader({
      type: 'fragment',
      inputs: [{ name: 'x', type: 'float' }],
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [
        {
          variable:
            target instanceof WGSLTarget ? 'output.fragColor' : 'fragColor',
          expression: e.box(expr),
        },
      ],
    } as never);

  it('compileToSource() declines a multi-statement block', () => {
    for (const body of [DECLARE_ASSIGN_RETURN, ASSIGN_THEN_VALUE])
      for (const target of gpuTargets()) {
        const e = engineWithX();
        expect(() => target.compileToSource(e.box(body))).toThrow(
          /compileToSource\(\): this route emits a single (GLSL|WGSL) EXPRESSION, but the body lowers to a statement sequence/
        );
        expect(() => target.compileToSource(e.box(body))).toThrow(
          /Compile a statement body with compile\(\) instead/
        );
      }
  });

  it('compileToSource() declines a body that lowers to a bare `return`', () => {
    for (const target of gpuTargets())
      expect(() =>
        target.compileToSource(engineWithX().box(BARE_RETURN))
      ).toThrow(
        /compileToSource\(\): this route emits a single (GLSL|WGSL) EXPRESSION, but the body lowers to a bare `return` statement \(`return (x|input\.x)`\)/
      );
  });

  it('compileShader() declines the same statement bodies', () => {
    for (const body of [DECLARE_ASSIGN_RETURN, ASSIGN_THEN_VALUE, BARE_RETURN])
      for (const target of gpuTargets())
        expect(() => shaderFor(target, body, engineWithX())).toThrow(
          /compileShader\(\) body statement "(fragColor|output\.fragColor)": this route emits a single (GLSL|WGSL) EXPRESSION/
        );
  });

  it('expression bodies are untouched on both routes', () => {
    // The controls that MUST keep working, byte for byte. A single-statement
    // `Block` already unwraps to its expression in the base compiler, so it
    // never reaches the gate — no new lowering was built for it.
    const EXPR: MathJsonExpression = ['Add', 'x', 1];
    const WRAPPED: MathJsonExpression = ['Block', ['Add', 'x', 1]];

    for (const target of gpuTargets()) {
      const e = engineWithX();
      expect(target.compileToSource(e.box(EXPR))).toBe('x + 1.0');
      expect(target.compileToSource(e.box(WRAPPED))).toBe('x + 1.0');

      const bare = shaderFor(target, EXPR, engineWithX());
      const wrapped = shaderFor(target, WRAPPED, engineWithX());
      expect(wrapped).toBe(bare);
      expect(bare).toContain(
        target instanceof WGSLTarget
          ? '  output.fragColor = input.x + 1.0;\n'
          : '  fragColor = x + 1.0;\n'
      );
    }
  });

  it('WGSL declines an assignment body on both routes', () => {
    // A `Block` nests too: the base compiler unwraps a single-statement block
    // to its statement, so the check follows the block's value statement down.
    const NESTED: MathJsonExpression = ['Block', ASSIGN_ONLY];
    const wgsl = new WGSLTarget();

    for (const body of [
      ASSIGN_ONLY,
      NESTED,
      ['Assign', 's', 'x'] as MathJsonExpression,
    ])
      expect(() => wgsl.compileToSource(engineWithX().box(body))).toThrow(
        /compileToSource\(\): this route emits a single WGSL EXPRESSION, but the body is an assignment/
      );

    expect(() => wgsl.compileToSource(engineWithX().box(ASSIGN_ONLY))).toThrow(
      /WGSL assignment is a STATEMENT \(unlike GLSL, where it is an operator\)/
    );
    expect(() => shaderFor(wgsl, ASSIGN_ONLY, engineWithX())).toThrow(
      /compileShader\(\) body statement "output\.fragColor": this route emits a single WGSL EXPRESSION, but the body is an assignment/
    );
  });

  it('both languages decline a bare-`Declare` body, whose initializer was dropped', () => {
    // Before the gate: `compileToSource` returned `"float s"` / `"var s: f32"`
    // and `compileShader` emitted `fragColor = float s;` — a statement in an
    // expression position, with the initializer `x` nowhere in the output.
    const NESTED: MathJsonExpression = ['Block', DECLARE_ONLY];
    for (const target of gpuTargets())
      for (const body of [DECLARE_ONLY, NESTED]) {
        expect(() => target.compileToSource(engineWithX().box(body))).toThrow(
          /compileToSource\(\): this route emits a single (GLSL|WGSL) EXPRESSION, but the body is a declaration/
        );
        expect(() => target.compileToSource(engineWithX().box(body))).toThrow(
          /carries no initializer, so the declared value would be silently DROPPED/
        );
        expect(() => shaderFor(target, body, engineWithX())).toThrow(
          /compileShader\(\) body statement "(fragColor|output\.fragColor)": this route emits a single (GLSL|WGSL) EXPRESSION, but the body is a declaration/
        );
      }
    // A declaration with no initializer at all is the same statement shape.
    for (const target of gpuTargets())
      expect(() =>
        target.compileToSource(engineWithX().box(['Declare', 's', 'number']))
      ).toThrow(/but the body is a declaration/);
  });

  it('GLSL keeps the same assignment body — it IS an expression there', () => {
    // The control for the WGSL decline: byte-identical to before the gate.
    const glsl = new GLSLTarget();
    expect(glsl.compileToSource(engineWithX().box(ASSIGN_ONLY))).toBe('s = x');
    expect(glsl.compileToSource(engineWithX().box(['Assign', 's', 'x']))).toBe(
      's = x'
    );
    expect(shaderFor(glsl, ASSIGN_ONLY, engineWithX())).toContain(
      '  fragColor = s = x;\n'
    );
  });

  it('compile() — the statement-capable route — is unchanged', () => {
    // The escape hatch the message names still emits the statement block.
    for (const target of gpuTargets()) {
      const r = target.compile(engineWithX().box(ASSIGN_THEN_VALUE));
      expect(r.success).toBe(true);
      expect(r.code).toBe('s = x;\nreturn s;');
    }
    // And it still emits the assignment WGSL declines above, and the
    // declaration both languages now decline.
    expect(new WGSLTarget().compile(engineWithX().box(ASSIGN_ONLY)).code).toBe(
      's = x'
    );
    expect(new GLSLTarget().compile(engineWithX().box(DECLARE_ONLY)).code).toBe(
      'float s'
    );
    expect(new WGSLTarget().compile(engineWithX().box(DECLARE_ONLY)).code).toBe(
      'var s: f32'
    );
  });

  // `compileFunction()` — the route every message above points at — had the
  // same defect one level down, in BOTH its branches: the single-line one
  // wraps the body in `return`, the multi-line one relies on the block hook
  // having placed one on the last line. Neither an assignment (WGSL) nor a
  // declaration (both languages) has that emission — GLSL keeps the
  // assignment, since assignment is an operator there.
  it('compileFunction() declines a statement body in either branch', () => {
    // Declaration: declined on BOTH languages, single-line branch — emitted
    // `return float s;` / `return var s: f32;` before, dropping `x`.
    for (const target of gpuTargets()) {
      const lang = target instanceof WGSLTarget ? 'WGSL' : 'GLSL';
      expect(() =>
        target.compileFunction(engineWithX().box(DECLARE_ONLY), 'f', 'float', [
          ['x', 'float'],
        ])
      ).toThrow(
        new RegExp(
          `compileFunction\\(\\): this route emits a single ${lang} EXPRESSION, but the body is a declaration`
        )
      );
    }

    const wgsl = new WGSLTarget();
    // Assignment: declined on WGSL only, single-line branch — emitted
    // `return s = x;` before.
    expect(() =>
      wgsl.compileFunction(engineWithX().box(ASSIGN_ONLY), 'f', 'float', [
        ['x', 'float'],
      ])
    ).toThrow(
      /compileFunction\(\): this route emits a single WGSL EXPRESSION, but the body is an assignment/
    );
    // Assignment: declined on WGSL, multi-line branch — the same hole at its
    // own last line (`Block(s ≔ x; t ≔ s)` emitted `… return t = s;\n}`).
    expect(() =>
      wgsl.compileFunction(
        engineWithX().box(['Block', ['Assign', 's', 'x'], ['Assign', 't', 's']]),
        'f',
        'float',
        [['x', 'float']]
      )
    ).toThrow(
      /compileFunction\(\): this route emits a single WGSL EXPRESSION, but the body is an assignment/
    );
  });

  it('GLSL compileFunction() keeps an assignment body — it IS an expression there', () => {
    // The control for the WGSL decline above: byte-identical to before the
    // gate.
    const glsl = new GLSLTarget();
    expect(
      glsl.compileFunction(engineWithX().box(ASSIGN_ONLY), 'f', 'float', [
        ['x', 'float'],
      ])
    ).toBe('float f(float x) {\n  return s = x;\n}');
    expect(
      glsl.compileFunction(
        engineWithX().box(['Block', ['Assign', 's', 'x'], ['Assign', 't', 's']]),
        'f',
        'float',
        [['x', 'float']]
      )
    ).toBe('float f(float x) {\n  float t;\n  s = x;\n  return t = s;\n}');
  });
});

// The expression-only PYTHON route, the same defect one target over.
// `PythonTarget.compileToSource()` answers with a bare expression string, but
// this is a `bareStatementBlocks: true` target: a `Block` lowers to a
// newline-joined statement sequence with the last statement `return`-prefixed.
// Ungated, that went out behind the expression contract — `Block(s ≔ x; s)`
// returned `"s = x\nreturn s"`, and `Block(Declare s; s ≔ x; Return s)`
// returned `"s = x\nreturn return s"` (a doubled `return`). Neither parses.
// Python's expression-level binding forms (the applied `lambda`, the flat CSE
// comprehension) could in principle carry a lowering, but that is a feature —
// this declines and points at `compileFunction()`, which emits a `def`.
describe('the expression-only Python route declines statement bodies', () => {
  const engineWithX = (): ComputeEngine => {
    const e = new ComputeEngine();
    e.declare('x', 'number');
    return e;
  };

  /** `s = x\nreturn s` before the gate. */
  const ASSIGN_THEN_VALUE: MathJsonExpression = [
    'Block',
    ['Assign', 's', 'x'],
    's',
  ];
  /** `s = x\nreturn return s` before the gate — the doubled `return`. */
  const DECLARE_ASSIGN_RETURN: MathJsonExpression = [
    'Block',
    ['Declare', 's', 'number'],
    ['Assign', 's', 'x'],
    ['Return', 's'],
  ];
  /** `return x` before the gate — a bare statement. */
  const BARE_RETURN: MathJsonExpression = ['Block', ['Return', 'x']];
  /**
   * The two single-line holes the emitted-source scan cannot see. An
   * assignment body emits `s = x` — one line, no `return` token — and Python
   * assignment is a STATEMENT (this target emits no walrus operator). A root
   * `Declare` emits the EMPTY string: Python has no declaration statement, so
   * the name and its initializer both vanish.
   */
  const ASSIGN_ONLY: MathJsonExpression = ['Block', ['Assign', 's', 'x']];
  const DECLARE_ONLY: MathJsonExpression = ['Declare', 's', 'number', 'x'];

  it('declines a multi-statement block', () => {
    for (const body of [ASSIGN_THEN_VALUE, DECLARE_ASSIGN_RETURN]) {
      const python = new PythonTarget();
      expect(() => python.compileToSource(engineWithX().box(body))).toThrow(
        /compileToSource\(\): this route emits a single Python EXPRESSION, but the body lowers to a statement sequence \(`s = x…`\)/
      );
      expect(() => python.compileToSource(engineWithX().box(body))).toThrow(
        /Compile a statement body with compileFunction\(\) instead/
      );
    }
  });

  it('declines a body that lowers to a bare `return`', () => {
    expect(() =>
      new PythonTarget().compileToSource(engineWithX().box(BARE_RETURN))
    ).toThrow(
      /compileToSource\(\): this route emits a single Python EXPRESSION, but the body lowers to a bare `return` statement \(`return x`\)/
    );
  });

  it('expression bodies are untouched, byte for byte', () => {
    // The controls that MUST keep working. A single-statement `Block` unwraps
    // to its expression in the base compiler, so it never reaches the gate.
    const python = new PythonTarget();
    const e = engineWithX();
    expect(python.compileToSource(e.box(['Add', 'x', 1]))).toBe('x + 1');
    expect(python.compileToSource(e.box(['Block', ['Add', 'x', 1]]))).toBe(
      'x + 1'
    );
    // A CSE emission is a flat comprehension — one line, and it stays one.
    expect(
      python.compileToSource(
        e.parse('\\sin(6u)^2+\\frac{\\sin(6u)}{\\sin(6u)+2}')
      )
    ).toBe(
      '[_cse1 ** 2 + _cse1 / (_cse1 + 2) for _cse1 in [np.sin(6 * u)]][0]'
    );
  });

  it('a string literal containing `return` is an expression, not a statement', () => {
    // The `return` token scan runs with Python string literals blanked out —
    // this target emits them, and their CONTENT is not source.
    expect(
      new PythonTarget().compileToSource(
        engineWithX().box({ str: 'a return b' })
      )
    ).toBe('"a return b"');
  });

  it('compileFunction() — the statement-capable route — is unchanged', () => {
    // The escape hatch the message names still emits the statement block,
    // indented under the `def` with the `return` the block hook placed.
    expect(
      new PythonTarget().compileFunction(
        engineWithX().box(ASSIGN_THEN_VALUE),
        'f',
        ['x']
      )
    ).toBe('def f(x):\n    s = x\n    return s\n');
  });

  it('declines an assignment body — a statement, not an expression', () => {
    // Before the gate: `compileToSource` returned `"s = x"` and `compileLambda`
    // returned `"lambda x: s = x"`. Neither parses — unlike GLSL (see the GPU
    // block above), Python assignment is not an operator, and this target does
    // not emit `:=`. A `Block` nests: the check follows its value statement.
    const python = new PythonTarget();
    for (const body of [
      ASSIGN_ONLY,
      ['Assign', 's', 'x'] as MathJsonExpression,
      ['Block', ASSIGN_ONLY] as MathJsonExpression,
    ]) {
      expect(() => python.compileToSource(engineWithX().box(body))).toThrow(
        /compileToSource\(\): this route emits a single Python EXPRESSION, but the body is an assignment/
      );
      expect(() => python.compileLambda(engineWithX().box(body), ['x'])).toThrow(
        /compileLambda\(\): this route emits a single Python EXPRESSION, but the body is an assignment/
      );
    }
    expect(() => python.compileToSource(engineWithX().box(ASSIGN_ONLY))).toThrow(
      /Python assignment is a STATEMENT \(this target does not emit the walrus operator\)/
    );
  });

  it('declines a bare-`Declare` body, which emitted nothing at all', () => {
    // Before the gate `compileToSource` returned `""` and `compileLambda`
    // returned `"lambda x: "` — the declared name AND its initializer dropped.
    const python = new PythonTarget();
    for (const body of [
      DECLARE_ONLY,
      ['Declare', 's', 'number'] as MathJsonExpression,
      ['Block', DECLARE_ONLY] as MathJsonExpression,
    ]) {
      expect(() => python.compileToSource(engineWithX().box(body))).toThrow(
        /compileToSource\(\): this route emits a single Python EXPRESSION, but the body is a declaration/
      );
      expect(() => python.compileLambda(engineWithX().box(body), ['x'])).toThrow(
        /compileLambda\(\): this route emits a single Python EXPRESSION, but the body is a declaration/
      );
    }
    expect(() => python.compileToSource(engineWithX().box(DECLARE_ONLY))).toThrow(
      /the declared name and its initializer would be silently DROPPED/
    );
  });

  // `compileFunction()` — the route every message above points at — had the
  // same defect one level down, in BOTH its branches. DECLINE, not a reroute:
  // the multi-line branch adds no `return` of its own (it relies on the block
  // hook having placed one on a VALUE statement), so routing `s = x` through it
  // emits `def f(x):\n    s = x\n` — a `def` returning `None`, where the
  // interpreter gives `Block(s ≔ x)` the assigned value. That is a different
  // answer, not the pinned `…\n    return s\n` shape, so there is no honest
  // reuse. The caller's fix — give the block a value statement — already works
  // and is pinned by the test above.
  it('compileFunction() declines a statement body in either branch', () => {
    const python = new PythonTarget();
    // Single-line branch: emitted `def f(x):\n    return s = x\n` before.
    for (const body of [ASSIGN_ONLY, ['Assign', 's', 'x'] as MathJsonExpression])
      expect(() =>
        python.compileFunction(engineWithX().box(body), 'f', ['x'])
      ).toThrow(
        /compileFunction\(\): the body's value statement is an assignment, and a Python statement cannot be returned/
      );
    // Multi-line branch, same hole at its own last line: `Block(s ≔ x; t ≔ s)`
    // emitted `def f(x):\n    s = x\n    return t = s\n`.
    expect(() =>
      python.compileFunction(
        engineWithX().box(['Block', ['Assign', 's', 'x'], ['Assign', 't', 's']]),
        'f',
        ['x']
      )
    ).toThrow(
      /compileFunction\(\): the body's value statement is an assignment/
    );
    // A declaration value statement: emitted `def f(x):\n    return \n` (root,
    // initializer dropped) and `def f(x):\n    return return s = x\n` (wrapped).
    for (const body of [DECLARE_ONLY, ['Block', DECLARE_ONLY] as MathJsonExpression])
      expect(() =>
        python.compileFunction(engineWithX().box(body), 'f', ['x'])
      ).toThrow(
        /compileFunction\(\): the body's value statement is a declaration \(which this target emits as nothing at all\)/
      );
    // The message names the caller-side fix, and that fix is what works.
    expect(() =>
      python.compileFunction(engineWithX().box(ASSIGN_ONLY), 'f', ['x'])
    ).toThrow(/Give the block a VALUE statement/);
  });

  it('compile() — the raw statement route — is unchanged', () => {
    // The control for all four declines above: `compile()` never claimed an
    // expression, and still emits exactly what it did.
    const python = new PythonTarget();
    expect(python.compile(engineWithX().box(ASSIGN_ONLY)).code).toBe('s = x');
    expect(python.compile(engineWithX().box(DECLARE_ONLY)).code).toBe('');
  });
});
