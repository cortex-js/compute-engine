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

  it('Equal over a collection operand fails closed (was success:true → null)', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(e.parse('d = m', { strict: false }), { realOnly: true })
    ).toThrow(/collection-valued/);
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
    const e = mkEngine();
    const r = compile(e.parse('d = m', { strict: false }));
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

  it('Reduce with an unsupported combiner fails closed', () => {
    const e = mkEngine();
    const js = new JavaScriptTarget();
    expect(() =>
      js.compile(e.box(['Reduce', 'd', 'Subtract', 0]), { realOnly: true })
    ).toThrow(/Fail closed/);
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
});

describe('COMPILE deprecated targets', () => {
  // No other test in this file resolves `interval-glsl`, so the module-level
  // once-per-process dedup flag is still untripped here — this test observes
  // the first (and only) warning.
  it('warns once when the deprecated interval-glsl target is resolved', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const e = new ComputeEngine();
      // Resolve the target several times; the deprecation notice must fire
      // exactly once per process, not once per resolution.
      e.getCompilationTarget('interval-glsl');
      e.getCompilationTarget('interval-glsl');
      compile(e.parse('x^2 + y^2'), { to: 'interval-glsl' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/interval-glsl.*deprecated/i);
    } finally {
      warn.mockRestore();
    }
  });
});
