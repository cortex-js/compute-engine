import { engine as ce } from '../utils';
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
      const expr = ce.expr(['Block', ['Multiply', 10, 2]]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`20`);
    });

    it('should compile a block with two statements', () => {
      const expr = ce.expr(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      expect(compile(expr)?.code ?? '').toMatchInlineSnapshot(`
        (() => {
        28;
        return 20
        })()
      `);
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
        expect(compiled?.code).toMatchInlineSnapshot(
          `vec2(sin(t), cos(t))`
        );
      });

      it('should compile a tuple to WGSL', () => {
        const expr = ce.expr(['Tuple', ['Sin', 't'], ['Cos', 't']]);
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
      expect(run(['ConjugateTranspose', M])).toEqual([[1, 3], [2, 4]]);
      expect(run(['ConjugateTranspose', M23])).toEqual([[1, 4], [2, 5], [3, 6]]);
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
      expect(run(['MatrixPower', M, 0])).toEqual([[1, 0], [0, 1]]);
      expect(run(['MatrixPower', M, 2])).toEqual([[7, 10], [15, 22]]);
      expect(run(['MatrixPower', M, 3])).toEqual([[37, 54], [81, 118]]);
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
      expect(run(['RowReduce', M])).toEqual([[1, 0], [0, 1]]);
      expect(run(['RowReduce', Msing])).toEqual([[1, 2], [0, 0]]);
      expect(run(['RowReduce', M23])).toEqual([[1, 0, -1], [0, 1, 2]]);
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
    expect(result.run!({ x: 2 })).toBeCloseTo(ce.box(['SinIntegral', 2]).N().re, 10);
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
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.code).toContain('_SYS.');
      const want = expr.N().re;
      expect(result.run!({}) as number).toBeCloseTo(want, 9);
    });
  }

  it('lowers AGM and EllipticE with a free variable', () => {
    const k = compile(ce.box(['EllipticK', 'm']))!;
    expect(k.success).toBe(true);
    expect(k.run!({ m: 0.5 })).toBeCloseTo(ce.box(['EllipticK', 0.5]).N().re, 9);
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
    for (const v of [0.5, -0.5, 1.5, -1.5, 2.5, -2.5]) parity(['Round', 'x'], { x: v });
  });

  it('Arccot uses the (0, π) branch for negative arguments (P0-42)', () => {
    for (const v of [2, -2, 0.5, -0.5, 10, -10]) parity(['Arccot', 'x'], { x: v });
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

  it('non-real constant folds fail closed (P0-42, D6)', () => {
    // Since D12-A, a perfect-square negative radicand canonicalizes to an
    // EXACT complex literal before compile (√-4 → 2i), which the JS target
    // compiles as a complex constant — correct, interpreter-parity value:
    const folded = compile(ce.box(['Sqrt', -4]));
    expect(folded.success).toBe(true);
    expect(folded.run!()).toEqual({ re: 0, im: 2 });
    // A non-square radicand still reaches the real fold path symbolically
    // and must keep failing closed (no literal NaN):
    for (const src of [
      ['Sqrt', -5],
      ['Root', -5, 2],
    ]) {
      const result = compile(ce.box(src as any));
      expect(result.success).toBe(false);
      expect(() => compile(ce.box(src as any), { fallback: false })).toThrow(
        /no real value/
      );
    }
  });

  it('non-canonical right-associative grouping is preserved (P0-45)', () => {
    const div = compile(ce.box(['Divide', 'a', ['Divide', 'b', 'c']], { canonical: false }))!;
    expect(div.success).toBe(true);
    expect(div.run!({ a: 12, b: 6, c: 2 })).toBe(4);

    const sub = compile(ce.box(['Subtract', 'a', ['Subtract', 'b', 'c']], { canonical: false }))!;
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
    const r = compile(expr)!;
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
});

// CO-P1-3: a complex-typed argument into a real-only helper (`_SYS.erf`)
// silently returned garbage (−1). It must fail closed (D6) with the head.
describe('COMPILE complex into real-only helper fails closed (CO-P1-3)', () => {
  it('Erf of a complex value throws', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    expect(() =>
      compile(engine.box(['Erf', 'z']), { fallback: false })
    ).toThrow(/real-only target helper/);
  });

  it('the engine-level fallback reports success:false with the head unsupported', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    const r = compile(engine.box(['Erf', 'z']));
    expect(r.success).toBe(false);
  });

  it('Erf of a real value still compiles', () => {
    const r = compile(ce.box(['Erf', 'x']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.erf');
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

  it('realOnly projects a boolean result to NaN (booleans are not reals)', () => {
    // CO-P2-25: a boolean-valued expression under realOnly is not a real number;
    // the interpreter never numericizes a boolean to 0/1, so fail closed to NaN.
    const r = compile(ce.box(['Greater', 'x', 0]), {
      fallback: false,
      realOnly: true,
    })!;
    expect(Number.isNaN(r.run!({ x: 5 }) as number)).toBe(true);
    expect(Number.isNaN(r.run!({ x: -5 }) as number)).toBe(true);
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
    // Exactly one Math.random() draw, reused in both comparisons via an IIFE.
    expect(r.code.match(/Math\.random\(\)/g)?.length).toBe(1);
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
    const r = js.compile(e.parse('d = m', { strict: false }), {
      realOnly: true,
    });
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

  it('a collection-valued Sum body fails closed instead of emitting NaN (Tycho item 45)', () => {
    // `Σ h(i)·(1/1.4^i)·a(…)` — the interpreter's elementwise zip-broadcast
    // Sum. The scalar accumulation would emit `<array> + <array>` (NaN /
    // string concatenation), a silently WRONG value; it must throw (D6).
    const e = new ComputeEngine();
    e.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    e.parse('h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)').evaluate();
    const sum = '\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))';
    expect(() => compile(e.parse(sum), { fallback: false })).toThrow(
      /collection-valued body/
    );
    // The fallback run interprets correctly.
    const viaFallback = compile(e.parse(`(${sum})[1]`))!;
    expect(viaFallback.success).toBe(false);
    e.pushScope();
    e.assign('t', 0.3);
    const want = e.parse(`(${sum})[1]`).N().re;
    e.popScope();
    expect(viaFallback.run!({ t: 0.3 })).toBeCloseTo(want, 10);
  });

  it('chained (n-ary) Equal over a collection operand still fails closed (D6)', () => {
    // The pairwise `&&` conjunction is only sound over scalar booleans.
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(e.parse('d = m = m', { strict: false }), { realOnly: true })
    ).toThrow(/Fail closed/);
  });

  it('Which with a collection condition fails closed (was success:true, wrong branch)', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const cases = e.parse('\\begin{cases}10^{9} & d = m \\\\ d\\end{cases}', {
      strict: false,
    });
    expect(() => js.compile(cases, { realOnly: true })).toThrow(
      /Fail closed/
    );
  });

  it('If with a collection condition fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(e.box(['If', 'd', 1, 2]), { realOnly: true })
    ).toThrow(/collection/);
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

  it('the \\sum_{i=d}^{d} d control (canonicalizes to Reduce) compiles and runs to 6', () => {
    const e = mkEngine();
    e.assign('d', e.parse('[1, 2, 3]').evaluate());
    const r = compile(e.parse('\\sum_{i=d}^{d}d', { strict: false }), {
      fallback: false,
    })!;
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(6);
  });

  it('Reduce compiles Multiply/Min/Max folds', () => {
    const e = mkEngine();
    e.assign('d', e.parse('[1, 2, 3, 4]').evaluate());
    expect(compile(e.box(['Reduce', 'd', 'Multiply', 1]), { fallback: false })!.run!()).toBe(24);
    expect(compile(e.box(['Reduce', 'd', 'Min']), { fallback: false })!.run!()).toBe(1);
    expect(compile(e.box(['Reduce', 'd', 'Max']), { fallback: false })!.run!()).toBe(4);
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
        { realOnly: true }
      )
    ).toThrow(/Fail closed/);
  });

  it('Reduce with a non-function combiner fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    // Undeclared symbol
    expect(() =>
      js.compile(e.box(['Reduce', 'd', 'w', 0]), { realOnly: true })
    ).toThrow(/Fail closed|invalid expression/);
    // A value-bound (non-function) symbol must fail at COMPILE time, not
    // produce `.reduce(<non-function>)` that throws at runtime
    e.assign('v', e.box(['Add', 'x', 1]));
    expect(() =>
      js.compile(e.box(['Reduce', 'd', 'v', 0]), { realOnly: true })
    ).toThrow(/Fail closed|invalid expression/);
  });

  it('native callback extra arguments do not leak into lambda parameters', () => {
    // Native `.map` passes `(x, index, array)`; the interpreter passes only
    // `(x)` (an under-applied CE function curries, it never sees the index).
    // A binary mapping function must therefore NOT receive the element index
    // as its second argument: the compiled result is NaN per element (missing
    // argument on a real target), never index-polluted values like [10, 21, 32].
    const e = mkEngine();
    const v = runJs(e, [
      'Map',
      'd',
      ['Function', ['Add', 'x', 'y'], 'x', 'y'],
    ]) as number[];
    expect(v).toEqual([NaN, NaN, NaN]);
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
    expect(compile(e.box(['At', 'd', 1]), { fallback: false, realOnly: true })!.run!()).toBe(10);
    expect(compile(e.box(['At', 'd', 3]), { fallback: false, realOnly: true })!.run!()).toBe(30);
    expect(compile(e.box(['At', 'd', -1]), { fallback: false, realOnly: true })!.run!()).toBe(30);
    expect(compile(e.box(['At', 'd', -3]), { fallback: false, realOnly: true })!.run!()).toBe(10);
    expect(Number.isNaN(compile(e.box(['At', 'd', 0]), { fallback: false, realOnly: true })!.run!() as number)).toBe(true);
    expect(Number.isNaN(compile(e.box(['At', 'd', 4]), { fallback: false, realOnly: true })!.run!() as number)).toBe(true);
  });

  it('At with a nested/multi-index access fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const m = e.box(['List', ['List', 1, 2], ['List', 3, 4]]);
    expect(() =>
      js.compile(e.box(['At', m, 1, 2]), { realOnly: true })
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
      expect(() => js.compile(e.box(['At', 'd', 1]), { realOnly: true })).toThrow(
        /indexed collection.*Fail closed \(D6\)/
      );
    });

    it('with fallback:true returns success:false + the D6 message, without throwing', () => {
      const e = mkDictEngine();
      const js = new JavaScriptTarget();
      let r: ReturnType<JavaScriptTarget['compile']> | undefined;
      expect(() => {
        r = js.compile(e.box(['At', 'd', 1]), {
          realOnly: true,
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
    const r = compile(e.box(mathjson), { fallback: false, realOnly: true })!;
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
    expect(
      runJs(e, ['Join', 'd', e.box(['List', 40, 50])])
    ).toEqual([10, 20, 30, 40, 50]);
  });

  it('IndexOf compiles to a 1-based index (0 when absent)', () => {
    const e = mkEngine();
    expect(runJs(e, ['IndexOf', 'd', 20])).toBe(2);
    expect(runJs(e, ['IndexOf', 'd', 99])).toBe(0);
  });

  it('Map / Filter compile the lambda and use native map/filter', () => {
    const e = mkEngine();
    expect(
      runJs(e, ['Map', 'd', ['Function', ['Divide', 'x', 10], 'x']])
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
    expect(
      runJs(e, ['Table', ['Square', 'i'], ['Set', 'i', 1, 4]])
    ).toEqual([1, 4, 9, 16]);
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

  it('IsEmpty / Count / Contains / Unique compile', () => {
    const e = mkEngine();
    // IsEmpty/Contains are boolean-valued: compile without realOnly (a
    // realOnly runner projects booleans to NaN, CO-P2-25)
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
    expect(runJs(e, ['Partition', L, 2])).toEqual([
      [1, 5],
      [2, 4],
      [3],
    ]);
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

  it('Shuffle compiles to an unbiased permutation of the source', () => {
    const e = mkEngine();
    const v = runJs(e, ['Shuffle', 'd']) as number[];
    expect([...v].sort((a, b) => a - b)).toEqual([10, 20, 30]);
    // the source is not mutated
    expect(runJs(e, ['At', 'd', 1])).toBe(10);
  });

  it('Contains / Unique fail closed for compound element types', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    const nested = ['List', ['List', 1], ['List', 1]];
    expect(() =>
      js.compile(e.box(['Unique', nested]), { realOnly: true })
    ).toThrow(/Fail closed/);
    expect(() =>
      js.compile(e.box(['Contains', nested, ['List', 1]]), { realOnly: true })
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
    expect(() =>
      js.compile(e.box(['Chunk', 'd', -2]), { realOnly: true })
    ).toThrow(/Fail closed/);
    expect(() =>
      js.compile(e.box(['Partition', 'd', 0]), { realOnly: true })
    ).toThrow(/Fail closed/);
  });

  it('Shuffle honors the engine randomSeed (deterministic permutation)', () => {
    const e = mkEngine();
    e.randomSeed = 12345;
    const r = compile(e.box(['Shuffle', 'd']), { fallback: false })!;
    const a = r.run!() as number[];
    expect([...a].sort((x, y) => x - y)).toEqual([10, 20, 30]);
    // The same compiled function redraws the same permutation…
    expect(r.run!()).toEqual(a);
    // …and an independent compile with the same seed agrees
    const r2 = compile(e.box(['Shuffle', 'd']), { fallback: false })!;
    expect(r2.run!()).toEqual(a);
  });

  it('custom Ordering function and seeded Shuffle fail closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(
        e.box([
          'Ordering',
          'd',
          ['Function', ['Greater', 'a', 'b'], 'a', 'b'],
        ]),
        { realOnly: true }
      )
    ).toThrow(/Fail closed/);
    expect(() =>
      js.compile(e.box(['Shuffle', 'd', 42]), { realOnly: true })
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
      runJs(e, ['FlatMap', ['List', 1, 2], ['Function', ['Multiply', 10, 'x'], 'x']])
    ).toEqual([10, 20]);
  });

  it('Scan compiles the running fold (initial value not emitted)', () => {
    const e = mkEngine();
    const sub = ['Function', ['Subtract', 'a', 'b'], 'a', 'b'];
    expect(
      runJs(e, ['Scan', ['List', 1, 2, 3], ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0])
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
    expect(runJs(e, ['MatrixMultiply', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toBe(32);
  });

  it('Cross / Norm / Trace compile', () => {
    const e = mkEngine();
    expect(runJs(e, ['Cross', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toEqual([
      -3, 6, -3,
    ]);
    expect(runJs(e, ['Norm', ['List', 1, 2, 3]])).toBeCloseTo(Math.sqrt(14), 12);
    expect(runJs(e, ['Norm', -5])).toBe(5);
    // Frobenius norm of a matrix; L1 norm with an explicit p
    expect(
      runJs(e, ['Norm', ['List', ['List', 1, 2], ['List', 3, 4]]])
    ).toBeCloseTo(Math.sqrt(30), 12);
    expect(runJs(e, ['Norm', ['List', 1, 2, 3], 1])).toBe(6);
    expect(runJs(e, ['Trace', ['List', ['List', 1, 2], ['List', 3, 4]]])).toBe(5);
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
        runJs(e, ['Inverse', ['List', ['List', 1, 2], ['List', 2, 4]]]) as number
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
      js.compile(e.box(['Norm', M, { str: 'Nuclear' }]), { realOnly: true })
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
        e.box(['Transpose', ['List', ['List', 1, 2], ['List', 3, 4]], 1, 2]),
        { realOnly: true }
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
        { realOnly: true }
      )
    ).toThrow(/Fail closed/);
  });

  it('a non-indexed / non-collection operand fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    // `Last` accepts any collection by signature, but a non-indexed `set`
    // cannot lower to a JS array — the handler's own check fires.
    expect(() =>
      js.compile(e.box(['Last', ['Set', 1, 2, 3]]), { realOnly: true })
    ).toThrow(/Fail closed/);
    // A scalar operand is rejected earlier by the type system (still closed).
    expect(() =>
      js.compile(e.box(['Reverse', 'm']), { realOnly: true })
    ).toThrow();
  });
});

describe('COMPILE removed targets', () => {
  it('does not register the removed interval-glsl target', () => {
    const e = new ComputeEngine();
    expect(e.getCompilationTarget('interval-glsl')).toBeUndefined();
    expect(e.listCompilationTargets()).not.toContain('interval-glsl');
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
    const r = js.compile(e.box(['f', 2]), { realOnly: true });
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
    const r = js.compile(e.box(['n', 3]), { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.run(3 as unknown as Record<string, number>)).toBeCloseTo(10, 12);
  });

  it('compiles nested user-calls-user chains, matching evaluate()/N()', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq e^{-x^2/2}').evaluate();
    e.parse('g(x) \\coloneq f(x) + 1').evaluate();
    const js = new JavaScriptTarget();
    for (const x of [0, 1, 2, -1.5]) {
      const r = js.compile(e.box(['g', ['f', x]]), { realOnly: true });
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
    const r = js.compile(e.box(['Add', ['f', 1], ['f', 2]]), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    expect(r.code.match(/_fn_f\(/g)?.length ?? 0).toBe(2);
    const want = e.box(['Add', ['f', 1], ['f', 2]]).N().re;
    expect(r.run({})).toBeCloseTo(want, 12);
  });

  it('fails closed (D6) on a directly recursive definition', () => {
    const e = new ComputeEngine();
    e.parse(
      '\\mathrm{fact}(n) \\coloneq \\mathrm{If}(n \\le 1, 1, n \\cdot \\mathrm{fact}(n-1))'
    ).evaluate();
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['fact', 5]), { realOnly: true })).toThrow(
      /[Rr]ecursive user-defined function `fact`/
    );
  });

  it('fails closed (D6) on mutual recursion', () => {
    const e = new ComputeEngine();
    e.parse('f(x) \\coloneq x').evaluate(); // stub so g's f(x) is a call
    e.parse('g(x) \\coloneq f(x) + 1').evaluate();
    e.parse('f(x) \\coloneq g(x) - 1').evaluate(); // redefine → f↔g mutual
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['f', 3]), { realOnly: true })).toThrow(
      /[Rr]ecursive user-defined function/
    );
  });

  it('keeps throwing Unknown operator for a truly unknown head', () => {
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['zzz', 5]), { realOnly: true })).toThrow(
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
    e.timeLimit = 60000;
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
      const target = e.getCompilationTarget('javascript');
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
        .getCompilationTarget('javascript')
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
      const r = e.getCompilationTarget('glsl').compile(e.parse('\\gcd(a, b)'));
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
        .getCompilationTarget('javascript')
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
        .getCompilationTarget('javascript')
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
      expect(
        (r.run as (v: Record<string, number>) => number)({})
      ).toBeCloseTo(expected, 10);
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

  it('IndexOf uses tolerant compare like the interpreter — finding A6', () => {
    // 0.1 + 0.2 ≈ 0.30000000000000004; a raw `===` would miss the 0.3 element.
    const b = ce.box(['IndexOf', ['List', 0.3], ['Add', 0.1, 0.2]]);
    const r = compile(b);
    expect((r.run as (v: Record<string, number>) => number)({})).toBe(1);
    expect((r.run as (v: Record<string, number>) => number)({})).toBe(
      b.evaluate().re
    );
  });

  it('Map/Filter do not leak the native callback index — finding A7', () => {
    // The compiled lambda must be invoked with a single argument; the native
    // `.map((el, index) => …)` index must NOT reach a lambda parameter.
    const rMap = compile(
      ce.box(['Map', ['List', 10, 20, 30], ['Function', ['Add', 'x', 1], 'x']])
    );
    expect(rMap.code).toContain('(_x) => _f(_x)');
    expect(rMap.code).not.toMatch(/\.map\(\(_f\)/); // no bare fn to native map
    expect(
      (rMap.run as (v: Record<string, number>) => number[])({})
    ).toEqual([11, 21, 31]);

    const rFilter = compile(
      ce.box([
        'Filter',
        ['List', 1, 2, 3, 4],
        ['Function', ['Greater', 'x', 2], 'x'],
      ])
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
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    for (const op of ['Negate', 'Not', 'Less', 'Greater', 'And', 'Or']) {
      expect(() =>
        js.compile(e.box(['Reduce', L, op, 0]), { realOnly: true })
      ).toThrow(/Fail closed/);
    }
    // Binary arithmetic operator symbols still compile.
    expect(compile(e.box(['Reduce', L, 'Subtract', 0]), { fallback: false })!.run!()).toBe(-6);
    expect(compile(e.box(['Reduce', L, 'Add', 0]), { fallback: false })!.run!()).toBe(6);
  });

  it('Map/Filter over an operator symbol fall back to the interpreter — finding 1', () => {
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    // Direct target compilation fails closed…
    expect(() =>
      js.compile(e.box(['Map', L, 'Negate']), { realOnly: true })
    ).toThrow(/Fail closed/);
    expect(() =>
      js.compile(e.box(['Filter', L, 'Less']), { realOnly: true })
    ).toThrow(/Fail closed/);
    // …and the engine-level compile (with fallback) reports success:false and
    // yields the interpreter's result rather than garbage.
    const m = compile(e.box(['Map', L, 'Negate']));
    expect(m?.success).toBe(false);
    expect((m?.run as (v: Record<string, number>) => number[])({})).toEqual([
      -1, -2, -3,
    ]);
  });

  it('Reduce with a non-binary combiner arity fails closed — finding 2', () => {
    const e = new ComputeEngine();
    const js = new JavaScriptTarget();
    // Unary Function literal: the interpreter raises an arity error; the
    // compiled fold must not silently return 3.
    expect(() =>
      js.compile(
        e.box(['Reduce', L, ['Function', ['Add', 'x', 1], 'x'], 0]),
        { realOnly: true }
      )
    ).toThrow(/Fail closed/);
    // Unary user-defined function symbol.
    e.assign('inc', e.box(['Function', ['Add', 'a', 1], 'a']));
    expect(() =>
      js.compile(e.box(['Reduce', L, 'inc', 0]), { realOnly: true })
    ).toThrow(/Fail closed/);
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
    expect(() =>
      js.compile(e.box(['Tabulate', f, 0]), { realOnly: true })
    ).toThrow(/Fail closed/);
    expect(() =>
      js.compile(e.box(['Tabulate', f, -2]), { realOnly: true })
    ).toThrow(/Fail closed/);
    // 2-D: a non-positive second dimension also fails closed.
    expect(() =>
      js.compile(e.box(['Tabulate', f, 3, 0]), { realOnly: true })
    ).toThrow(/Fail closed/);
    // A positive dimension still compiles.
    expect(compile(e.box(['Tabulate', f, 3]), { fallback: false })!.run!()).toEqual([2, 4, 6]);
  });

  it('Reduce over an empty collection with no initial value yields NaN — finding 4', () => {
    const e = new ComputeEngine();
    const r = compile(e.box(['Reduce', ['List'], 'Add']), { fallback: false })!;
    expect(r.success).toBe(true);
    // Native seedless reduce would throw on []; the guard yields NaN (the
    // interpreter's `Nothing` projected onto a real target).
    expect(Number.isNaN(r.run!() as number)).toBe(true);
    // A non-empty seedless reduce still folds pairwise.
    expect(compile(e.box(['Reduce', ['List', 1, 2, 3], 'Add']), { fallback: false })!.run!()).toBe(6);
  });
});
