import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const glsl = new GLSLTarget();

/**
 * Compile-time constant folding is off for the emissions this suite pins.
 * A subtree with no free variables is normally evaluated at compile time and
 * emitted as one literal, which is the right default but erases the codegen
 * under test here: the unrolled/looped `Sum` and `Product` shapes, the operand
 * lowerings, and the fail-closed diagnostics that only the structural path
 * reaches (a constant `Binomial(∞, 0)` or `Mod(√-2, 1)` would fold to a value
 * instead of throwing).
 */
const NO_FOLD = { constantFold: false } as const;

describe('GLSL COMPILATION', () => {
  describe('Basic Expressions', () => {
    it('should compile simple arithmetic', () => {
      const expr = ce.parse('x + y');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`x + y`);
    });

    it('should compile multiplication', () => {
      const expr = ce.parse('x * y');
      const code = glsl.compile(expr).code;
      // Canonical form may reorder operands
      expect(code).toMatchInlineSnapshot(`x * y`);
    });

    it('should compile complex expression', () => {
      const expr = ce.parse('x^2 + y^2');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(x * x) + (y * y)`);
    });
  });

  describe('GLSL Functions', () => {
    it('should compile trigonometric functions', () => {
      const expr = ce.parse('\\sin(x) + \\cos(y)');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`sin(x) + cos(y)`);
    });

    it('should compile power function', () => {
      const expr = ce.parse('x^{0.5}');
      const code = glsl.compile(expr).code;
      // x^0.5 is optimized to sqrt(x)
      expect(code).toMatchInlineSnapshot(`sqrt(x)`);
    });

    // Regression (Tycho WebGL2 parity audit): GLSL `pow(x, y)` is
    // `exp2(y·log2(x))`, undefined for a negative base even with an
    // integer-valued literal exponent — `pow(-2.0, 3.0)` returns +8 on a real
    // GPU, flipping the sign of odd powers. Integer exponents must lower to
    // sign-preserving code (repeated multiplication / `_gpu_powi`), never `pow`.
    describe('integer power sign-correctness (no pow)', () => {
      it('small odd exponent → repeated multiplication', () => {
        expect(glsl.compile(ce.parse('x^3')).code).toMatchInlineSnapshot(
          `(x * x * x)`
        );
      });

      it('exponent 4 (at inline cutoff) → repeated multiplication', () => {
        expect(glsl.compile(ce.parse('x^4')).code).toMatchInlineSnapshot(
          `(x * x * x * x)`
        );
      });

      it('larger exponent → sign-preserving helper, not pow', () => {
        const r = glsl.compile(ce.parse('x^7'));
        expect(r.code).toMatchInlineSnapshot(`_gpu_powi(x, 7.0)`);
        expect(r.code).not.toContain('pow(');
        expect(r.preamble).toContain('_gpu_powi');
      });

      it('exponent 12 → helper', () => {
        expect(glsl.compile(ce.parse('x^{12}')).code).toMatchInlineSnapshot(
          `_gpu_powi(x, 12.0)`
        );
      });

      it('negative integer exponent → reciprocal of positive form', () => {
        expect(glsl.compile(ce.parse('x^{-3}')).code).toMatchInlineSnapshot(
          `(1.0 / (x * x * x))`
        );
      });

      it('compound base → helper (base not duplicated)', () => {
        const r = glsl.compile(ce.parse('(x+y)^3'));
        expect(r.code).toMatchInlineSnapshot(`_gpu_powi(x + y, 3.0)`);
        expect(r.code).not.toContain('pow(');
      });

      it('compound base squared → helper (pow(neg,2) is NaN on GPU)', () => {
        expect(glsl.compile(ce.parse('(x+y)^2')).code).toMatchInlineSnapshot(
          `_gpu_powi(x + y, 2.0)`
        );
      });

      it('cubic term does NOT emit pow', () => {
        const r = glsl.compile(ce.parse('x-0.01x^3y'));
        expect(r.code).toMatchInlineSnapshot(`-0.01 * y * (x * x * x) + x`);
        expect(r.code).not.toContain('pow(');
      });

      it('genuinely fractional exponent still uses pow', () => {
        expect(glsl.compile(ce.parse('x^{2.5}')).code).toMatchInlineSnapshot(
          `pow(x, 2.5)`
        );
      });
    });

    it('should compile sqrt', () => {
      const expr = ce.parse('\\sqrt{x}');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`sqrt(x)`);
    });

    it('should compile abs', () => {
      const expr = ce.parse('|x|');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`abs(x)`);
    });

    it('should compile min/max', () => {
      const expr = ce.parse('\\max(x, y)');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`max(x, y)`);
    });

    it('should compile cot', () => {
      const expr = ce.parse('\\cot(x)');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(cos(x) / sin(x))`);
    });

    it('should compile csc', () => {
      const expr = ce.parse('\\csc(x)');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(1.0 / sin(x))`);
    });

    it('should compile sec', () => {
      const expr = ce.parse('\\sec(x)');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(1.0 / cos(x))`);
    });

    // REVIEW.md E3: CE's `Degrees` converts degrees→radians (Degrees(180) = π),
    // which is GLSL's `radians()`. It was wrongly mapped to GLSL `degrees()`
    // (the rad→deg inverse).
    it('should compile Degrees as radians() (E3)', () => {
      const code = glsl.compile(ce.expr(['Degrees', 'x'])).code;
      expect(code).toMatchInlineSnapshot(`radians(x)`);
    });

    it('should compile hyperbolic functions', () => {
      expect(glsl.compile(ce.parse('\\sinh(x)')).code).toMatchInlineSnapshot(
        `sinh(x)`
      );
      expect(glsl.compile(ce.parse('\\cosh(x)')).code).toMatchInlineSnapshot(
        `cosh(x)`
      );
      expect(glsl.compile(ce.parse('\\tanh(x)')).code).toMatchInlineSnapshot(
        `tanh(x)`
      );
    });

    it('should compile inverse hyperbolic functions', () => {
      expect(glsl.compile(ce.expr(['Arcosh', 'x'])).code).toMatchInlineSnapshot(
        `acosh(x)`
      );
      expect(glsl.compile(ce.expr(['Arsinh', 'x'])).code).toMatchInlineSnapshot(
        `asinh(x)`
      );
      expect(glsl.compile(ce.expr(['Artanh', 'x'])).code).toMatchInlineSnapshot(
        `atanh(x)`
      );
    });

    it('should compile reciprocal hyperbolic functions', () => {
      expect(glsl.compile(ce.expr(['Coth', 'x'])).code).toMatchInlineSnapshot(
        `(cosh(x) / sinh(x))`
      );
      expect(glsl.compile(ce.expr(['Csch', 'x'])).code).toMatchInlineSnapshot(
        `(1.0 / sinh(x))`
      );
      expect(glsl.compile(ce.expr(['Sech', 'x'])).code).toMatchInlineSnapshot(
        `(1.0 / cosh(x))`
      );
    });
  });

  describe('Float Literals', () => {
    it('should add .0 to integer literals', () => {
      const expr = ce.parse('x + 5');
      const code = glsl.compile(expr).code;
      // Canonical form may reorder operands
      expect(code).toMatchInlineSnapshot(`x + 5.0`);
    });

    it('should preserve decimal literals', () => {
      const expr = ce.parse('x * 2.5');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`2.5 * x`);
    });

    it('should handle scientific notation', () => {
      const expr = ce.parse('x * 1.5e10');
      const code = glsl.compile(expr).code;
      // Note: GLSL expands scientific notation to full decimal
      expect(code).toMatchInlineSnapshot(`15000000000.0 * x`);
    });
  });

  describe('Constants', () => {
    it('should compile pi', () => {
      const expr = ce.parse('2\\pi');
      const code = glsl.compile(expr, NO_FOLD).code;
      expect(code).toMatchInlineSnapshot(`2.0 * 3.14159265359`);
    });

    it('should compile e', () => {
      const expr = ce.parse('\\exponentialE');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`2.71828182846`);
    });
  });

  describe('Vectors', () => {
    it('should compile vec2', () => {
      const expr = ce.expr(['List', 1, 2]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec2(1.0, 2.0)`);
    });

    it('should compile vec3', () => {
      const expr = ce.expr(['List', 1, 2, 3]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0)`);
    });

    it('should compile vec4', () => {
      const expr = ce.expr(['List', 1, 2, 3, 4]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec4(1.0, 2.0, 3.0, 4.0)`);
    });

    it('should compile vector addition', () => {
      const expr = ce.expr(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]]);
      // `constantFold: false`: both operands are literal vectors, so the sum
      // would otherwise be folded to the single literal `vec3(5.0, 7.0, 9.0)`
      // — this test pins the vector-addition lowering, not the fold.
      const code = glsl.compile(expr, { constantFold: false }).code;
      // GLSL supports vector operators natively; canonical form reorders
      expect(code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0) + vec3(4.0, 5.0, 6.0)`);
    });

    it('should compile vector multiplication', () => {
      const expr = ce.expr(['Multiply', ['List', 'x', 'y', 'z'], 2]);
      const code = glsl.compile(expr).code;
      // Note: canonical form reorders operands
      expect(code).toMatchInlineSnapshot(`2.0 * vec3(x, y, z)`);
    });
  });

  describe('Complete Functions', () => {
    it('should compile a complete GLSL function', () => {
      const expr = ce.parse('x^2 + y^2');
      const code = glsl.compileFunction(expr, 'distanceSquared', 'float', [
        ['x', 'float'],
        ['y', 'float'],
      ]);
      expect(code).toMatchInlineSnapshot(`
        float distanceSquared(float x, float y) {
          return (x * x) + (y * y);
        }
      `);
    });

    it('should compile a vector function', () => {
      const expr = ce.parse('\\sqrt{x^2 + y^2 + z^2}');
      const code = glsl.compileFunction(
        expr,
        'vectorLength',
        'float',
        [
          ['x', 'float'],
          ['y', 'float'],
          ['z', 'float'],
        ]
      );
      expect(code).toMatchInlineSnapshot(`
        float vectorLength(float x, float y, float z) {
          return sqrt((x * x) + (y * y) + (z * z));
        }
      `);
    });
  });

  describe('Shader Generation', () => {
    it('should generate a simple fragment shader', () => {
      const colorExpr = ce.expr(['List', 1, 0, 0, 1]); // Red color

      const shader = glsl.compileShader({
        type: 'fragment',
        version: '300 es',
        outputs: [{ name: 'fragColor', type: 'vec4' }],
        body: [{ variable: 'fragColor', expression: colorExpr }],
      });

      expect(shader).toContain('#version 300 es');
      expect(shader).toContain('precision highp float');
      expect(shader).toContain('out vec4 fragColor');
      expect(shader).toContain('fragColor = vec4(1.0, 0.0, 0.0, 1.0)');
    });

    it('should generate a vertex shader with uniforms', () => {
      const shader = glsl.compileShader({
        type: 'vertex',
        version: '300 es',
        inputs: [{ name: 'aPos', type: 'vec3' }],
        outputs: [{ name: 'vColor', type: 'vec3' }],
        uniforms: [{ name: 'uTime', type: 'float' }],
        body: [
          {
            variable: 'vColor',
            expression: ce.expr(['List', 1, 0, 0]),
          },
        ],
      });

      expect(shader).toContain('#version 300 es');
      expect(shader).toContain('in vec3 aPos');
      expect(shader).toContain('out vec3 vColor');
      expect(shader).toContain('uniform float uTime');
      expect(shader).toContain('void main()');
      expect(shader).toContain('vColor = vec3(1.0, 0.0, 0.0)');
    });
  });

  describe('Block Expressions', () => {
    it('should compile a simple block with local variable', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', ['Cos', 't']],
        ['Add', 'a', 1],
      ]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`
        float a;
        a = cos(t);
        return a + 1.0;
      `);
    });

    it('should compile a block with multiple locals', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'a'],
        ['Declare', 'b'],
        ['Assign', 'a', ['Sin', 'x']],
        ['Assign', 'b', ['Cos', 'x']],
        ['Add', 'a', 'b'],
      ]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`
        float a;
        float b;
        a = sin(x);
        b = cos(x);
        return a + b;
      `);
    });

    it('should compile a block function with valid GLSL body', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', ['Cos', 't']],
        ['Add', 'a', 1],
      ]);
      const code = glsl.compileFunction(expr, 'compute', 'float', [
        ['t', 'float'],
      ]);
      expect(code).toMatchInlineSnapshot(`
        float compute(float t) {
          float a;
          a = cos(t);
          return a + 1.0;
        }
      `);
    });

    it('should not use IIFE or let in GLSL blocks', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'tmp'],
        ['Assign', 'tmp', 'x'],
        ['Multiply', 'tmp', 'tmp'],
      ]);
      const code = glsl.compile(expr).code;
      expect(code).not.toContain('let ');
      expect(code).not.toContain('(() =>');
      expect(code).not.toContain('})()');
      expect(code).toContain('float tmp');
    });

    // Regression: a local bound to an integer-valued literal must declare as
    // `float`, not `int` — the assignment is always emitted as a float literal
    // (`r = 3.0;`) and the variable feeds float arithmetic, so an `int`
    // declaration produces non-compilable GLSL. (GP team bug report.)
    it('should declare an integer-valued local as float', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'r'],
        ['Assign', 'r', 3],
        ['Add', 'r', ['Multiply', 'x', 'x']],
      ]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`
        float r;
        r = 3.0;
        return x * x + r;
      `);
      expect(code).not.toContain('int r');
    });

    it('should declare a float-literal-valued local as float', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'r'],
        ['Assign', 'r', 3.0],
        ['Add', 'r', ['Multiply', 'x', 'x']],
      ]);
      const code = glsl.compile(expr).code;
      expect(code).not.toContain('int r');
      expect(code).toContain('float r');
    });

    it('should honor an explicit real-typed Declare as float', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'r', 'real'],
        ['Assign', 'r', 3],
        ['Add', 'r', ['Multiply', 'x', 'x']],
      ]);
      const code = glsl.compile(expr).code;
      expect(code).not.toContain('int r');
      expect(code).toContain('float r');
    });
  });

  describe('Relational and Logical Operators', () => {
    it('should compile comparisons', () => {
      const expr = ce.parse('x > 0.5');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`0.5 < x`);
    });

    it('should compile logical operations', () => {
      const expr = ce.parse('x > 0 \\land y < 1');
      const code = glsl.compile(expr).code;
      // GLSL logical operators don't need extra parentheses
      expect(code).toMatchInlineSnapshot(`0.0 < x && y < 1.0`);
    });
  });

  describe('Complex Numbers', () => {
    beforeAll(() => {
      ce.pushScope();
      ce.declare('z', 'complex');
      ce.declare('w', 'complex');
    });
    afterAll(() => {
      ce.popScope();
    });

    it('should compile complex literal as vec2', () => {
      const code = glsl.compile(ce.expr(['Complex', 3, 4])).code;
      expect(code).toMatchInlineSnapshot(`vec2(3.0, 4.0)`);
    });

    it('should compile ImaginaryUnit as vec2(0, 1)', () => {
      const code = glsl.compile(ce.expr('ImaginaryUnit')).code;
      expect(code).toMatchInlineSnapshot(`vec2(0.0, 1.0)`);
    });

    it('should compile complex power z^2', () => {
      const expr = ce.expr(['Power', 'z', 2]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cpow(z, vec2(2.0, 0.0))`);
    });

    it('should compile z^2 + 2z', () => {
      const expr = ce.parse('z^2+2z');
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(
        `_gpu_cpow(z, vec2(2.0, 0.0)) + (2.0 * z)`
      );
    });

    it('should compile complex multiply z*w', () => {
      const code = glsl.compile(ce.expr(['Multiply', 'z', 'w'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cmul(w, z)`);
    });

    it('should compile scalar * complex (native)', () => {
      const code = glsl.compile(ce.expr(['Multiply', 2, 'z'])).code;
      expect(code).toMatchInlineSnapshot(`(2.0 * z)`);
    });

    // REVIEW.md E4: a compound (additive) real factor in a complex multiply
    // was compiled without precedence parens, so `(x+1)·z·w` mis-grouped as
    // `(x + 1.0 * _gpu_cmul(w, z))` = x + (1.0·z·w). The additive factor must
    // be parenthesized as a single multiplicative term.
    it('should parenthesize a compound real factor in complex multiply (E4)', () => {
      const code = glsl.compile(ce.parse('(x+1)zw')).code;
      expect(code).toMatchInlineSnapshot(`((x + 1.0) * _gpu_cmul(w, z))`);
    });

    it('should parenthesize a compound real factor times one complex (E4)', () => {
      const code = glsl.compile(ce.parse('(a+b)z')).code;
      expect(code).toMatchInlineSnapshot(`((a + b) * z)`);
    });

    it('keeps a simple numeric scalar unparenthesized (E4 regression)', () => {
      const code = glsl.compile(ce.parse('2zw')).code;
      expect(code).toMatchInlineSnapshot(`(2.0 * _gpu_cmul(w, z))`);
    });

    it('should compile complex divide', () => {
      // Use an inexact complex literal: since D12-A an exact Gaussian
      // divisor folds at canonicalization (z/(1+2i) -> (1/5 - 2i/5)*z),
      // which would compile to _gpu_cmul instead of exercising cdiv.
      const code = glsl.compile(
        ce.expr(['Divide', 'z', ['Complex', 1.5, 2]])
      ).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cdiv(z, vec2(1.5, 2.0))`);
    });

    it('should compile complex / real (native)', () => {
      const code = glsl.compile(ce.expr(['Divide', 'z', 3])).code;
      expect(code).toMatchInlineSnapshot(`(0.3333333333333333 * z)`);
    });

    it('should compile real / complex', () => {
      const code = glsl.compile(ce.expr(['Divide', 5, 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cdiv(vec2(5.0, 0.0), z)`);
    });

    it('should compile complex addition with real promotion', () => {
      const code = glsl.compile(ce.expr(['Add', 'z', 5])).code;
      expect(code).toMatchInlineSnapshot(`z + vec2(5.0, 0.0)`);
    });

    it('should compile sin of complex variable', () => {
      const code = glsl.compile(ce.expr(['Sin', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_csin(z)`);
    });

    it('should compile cos of complex variable', () => {
      const code = glsl.compile(ce.expr(['Cos', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_ccos(z)`);
    });

    it('should compile tan of complex variable', () => {
      const code = glsl.compile(ce.expr(['Tan', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_ctan(z)`);
    });

    it('should compile exp(z) via Power(E, z) as _gpu_cexp', () => {
      const expr = ce.expr(['Exp', 'z']);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cexp(z)`);
    });

    it('should compile ln of complex variable', () => {
      // Ln is canonicalized, check the operator
      const expr = ce.expr(['Ln', 'z']);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cln(z)`);
    });

    it('should compile sqrt of complex variable', () => {
      const code = glsl.compile(ce.expr(['Sqrt', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_csqrt(z)`);
    });

    it('should compile abs of complex as length', () => {
      const code = glsl.compile(ce.expr(['Abs', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`length(z)`);
    });

    it('should compile Real and Imaginary of complex', () => {
      expect(glsl.compile(ce.expr(['Real', 'z'])).code).toMatchInlineSnapshot(
        `(z).x`
      );
      expect(
        glsl.compile(ce.expr(['Imaginary', 'z'])).code
      ).toMatchInlineSnapshot(`(z).y`);
    });

    it('should compile Conjugate of complex', () => {
      const code = glsl.compile(ce.expr(['Conjugate', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`vec2(z.x, -z.y)`);
    });

    it('should compile Argument of complex', () => {
      const code = glsl.compile(ce.expr(['Argument', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`atan(z.y, z.x)`);
    });

    it('should compile sinh/cosh/tanh of complex', () => {
      expect(glsl.compile(ce.expr(['Sinh', 'z'])).code).toMatchInlineSnapshot(
        `_gpu_csinh(z)`
      );
      expect(glsl.compile(ce.expr(['Cosh', 'z'])).code).toMatchInlineSnapshot(
        `_gpu_ccosh(z)`
      );
      expect(glsl.compile(ce.expr(['Tanh', 'z'])).code).toMatchInlineSnapshot(
        `_gpu_ctanh(z)`
      );
    });

    it('should compile arcsinh of complex variable', () => {
      const code = glsl.compile(ce.expr(['Arsinh', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_casinh(z)`);
    });

    it('should compile arccosh of complex variable', () => {
      const code = glsl.compile(ce.expr(['Arcosh', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cacosh(z)`);
    });

    it('should compile arctanh of complex variable', () => {
      const code = glsl.compile(ce.expr(['Artanh', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_catanh(z)`);
    });

    it('should include only cmul in preamble for z*w', () => {
      const result = glsl.compile(ce.expr(['Multiply', 'z', 'w']));
      expect(result.preamble).toContain('_gpu_cmul');
      // Should NOT include unrelated functions
      expect(result.preamble).not.toContain('_gpu_csin');
      expect(result.preamble).not.toContain('_gpu_cexp');
    });

    it('should include cpow deps (cexp, cmul, cln) for z^2', () => {
      const result = glsl.compile(ce.expr(['Power', 'z', 2]));
      expect(result.preamble).toContain('_gpu_cpow');
      expect(result.preamble).toContain('_gpu_cexp');
      expect(result.preamble).toContain('_gpu_cmul');
      expect(result.preamble).toContain('_gpu_cln');
      // Should NOT include trig
      expect(result.preamble).not.toContain('_gpu_csin');
    });

    it('should include ctan deps (cdiv, csin, ccos) for tan(z)', () => {
      const result = glsl.compile(ce.expr(['Tan', 'z']));
      expect(result.preamble).toContain('_gpu_ctan');
      expect(result.preamble).toContain('_gpu_cdiv');
      expect(result.preamble).toContain('_gpu_csin');
      expect(result.preamble).toContain('_gpu_ccos');
      // Should NOT include unrelated
      expect(result.preamble).not.toContain('_gpu_cexp');
    });

    it('should not include complex preamble for real expressions', () => {
      const result = glsl.compile(ce.parse('x + y'));
      expect(result.preamble).toBeUndefined();
    });

    it('should keep real expressions unchanged', () => {
      // Verify no regressions with complex declarations in scope
      const code = glsl.compile(ce.parse('\\sin(x) + \\cos(y)')).code;
      expect(code).toMatchInlineSnapshot(`sin(x) + cos(y)`);
    });
  });

  describe('Special Functions', () => {
    it('should compile Heaviside', () => {
      const result = glsl.compile(ce.expr(['Heaviside', 'x']));
      expect(result.code).toMatchInlineSnapshot(`_gpu_heaviside(x)`);
      expect(result.preamble).toContain('_gpu_heaviside');
    });

    it('should compile Sinc', () => {
      const result = glsl.compile(ce.expr(['Sinc', 'x']));
      expect(result.code).toMatchInlineSnapshot(`_gpu_sinc(x)`);
      expect(result.preamble).toContain('_gpu_sinc');
    });

    it('should compile FresnelC', () => {
      const result = glsl.compile(ce.expr(['FresnelC', 'x']));
      expect(result.code).toMatchInlineSnapshot(`_gpu_fresnelC(x)`);
      expect(result.preamble).toContain('_gpu_polevl');
      expect(result.preamble).toContain('_gpu_fresnelC');
    });

    it('should compile FresnelS', () => {
      const result = glsl.compile(ce.expr(['FresnelS', 'x']));
      expect(result.code).toMatchInlineSnapshot(`_gpu_fresnelS(x)`);
      expect(result.preamble).toContain('_gpu_polevl');
      expect(result.preamble).toContain('_gpu_fresnelS');
    });

    it('should compile BesselJ', () => {
      const result = glsl.compile(ce.expr(['BesselJ', 0, 'x']));
      expect(result.code).toMatchInlineSnapshot(
        `_gpu_besselJ(int(0.0), x)`
      );
      expect(result.preamble).toContain('_gpu_factorial');
      expect(result.preamble).toContain('_gpu_besselJ');
    });
  });

  // `Binomial(n, k)` / `Choose(n, k)` for a literal non-negative integer `k`
  // unrolls to the GENERALIZED binomial coefficient — the falling factorial
  // n(n-1)…(n-k+1)/k!. That is the same closed form the interpreter expands
  // to for a symbolic first operand (`Binomial(x, 2)` → `(x·(x-1))/2`), and
  // unlike the JavaScript target's `_SYS.binomial` (a Pascal-triangle table)
  // it also agrees with the interpreter for a real or negative `n`.
  describe('Binomial / Choose (falling-factorial unroll)', () => {
    it('unrolls a literal non-negative integer k', () => {
      expect(glsl.compile(ce.expr(['Binomial', 'x', 0])).code).toBe('1.0');
      expect(glsl.compile(ce.expr(['Binomial', 'x', 1])).code).toBe('x');
      expect(glsl.compile(ce.expr(['Binomial', 'x', 2])).code).toBe(
        '(((x) * ((x) - 1.0)) / 2.0)'
      );
      expect(glsl.compile(ce.expr(['Binomial', 'x', 3])).code).toBe(
        '(((x) * ((x) - 1.0) * ((x) - 2.0)) / 6.0)'
      );
      // `Choose` is the same function in the interpreter (shared
      // `evaluateBinomial`) — same lowering.
      expect(glsl.compile(ce.expr(['Choose', 'x', 2])).code).toBe(
        '(((x) * ((x) - 1.0)) / 2.0)'
      );
      // A compound first operand is parenthesized before the subtraction.
      expect(glsl.compile(ce.expr(['Binomial', ['Add', 'x', 1], 2])).code).toBe(
        '(((x + 1.0) * ((x + 1.0) - 1.0)) / 2.0)'
      );
    });

    it('matches the interpreter numerically, including real and negative n', () => {
      // GLSL cannot be executed here, so the emitted FORMULA is evaluated in
      // JavaScript — the emission lives in the `* - / ()` + float-literal
      // subset, which reads identically in both languages.
      for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const code = glsl.compile(ce.expr(['Binomial', 'x', k])).code!;
        for (const n of [0, 1, 2, 3, 5, 7, 10, -1, -2, -5, 5.5, 2.5, 0.5]) {
          // eslint-disable-next-line no-eval
          const shader = eval(code.replace(/\bx\b/g, `(${n})`)) as number;
          const interpreted = ce.box(['Binomial', n, k]).N().re;
          expect(shader).toBeCloseTo(interpreted, 9);
        }
      }
      // The two values the ledger names.
      const k2 = glsl.compile(ce.expr(['Binomial', 'x', 2])).code!;
      // eslint-disable-next-line no-eval
      expect(eval(k2.replace(/\bx\b/g, '(5.5)'))).toBe(12.375);
      // eslint-disable-next-line no-eval
      expect(eval(k2.replace(/\bx\b/g, '(-1)'))).toBe(1);
      expect(ce.box(['Binomial', 5.5, 2]).N().re).toBe(12.375);
      expect(ce.box(['Binomial', -1, 2]).N().re).toBe(1);
    });

    it('fails closed on a k the interpreter leaves inert, and on a long unroll', () => {
      // Negative / non-integer / non-literal k: inert in the interpreter.
      for (const k of [-1, 2.5, 'n'] as any[])
        expect(() => glsl.compile(ce.expr(['Binomial', 'x', k]))).toThrow(
          /Fail closed/
        );
      // k above the unroll cap (8).
      expect(() => glsl.compile(ce.expr(['Binomial', 'x', 9]))).toThrow(
        /would unroll to 9 factors/
      );
      expect(() =>
        glsl.compile(ce.expr(['Binomial', 'x', 8]))
      ).not.toThrow();
    });

    it('fails closed on a statically non-finite first operand', () => {
      // Probed: the interpreter gives NaN for `Binomial(∞, 0)` — the `k = 0`
      // fold to `1` does NOT hold there — and NaN for `Binomial(∞, 2)`, while
      // the unroll emitted `1.0` and an ∞-valued falling factorial.
      for (const n of ['PositiveInfinity', 'NegativeInfinity', 'NaN'])
        for (const k of [0, 1, 2])
          expect(() =>
            glsl.compile(ce.expr(['Binomial', n, k]), NO_FOLD)
          ).toThrow(/statically non-finite first operand/);
      expect(ce.box(['Binomial', 'PositiveInfinity', 0]).N().re).toBeNaN();
      expect(ce.box(['Binomial', 'PositiveInfinity', 2]).N().re).toBeNaN();
      // A finite literal or symbol is unaffected (byte-identical).
      expect(glsl.compile(ce.expr(['Binomial', 'x', 2])).code).toBe(
        '(((x) * ((x) - 1.0)) / 2.0)'
      );
      expect(glsl.compile(ce.expr(['Binomial', 5, 2]), NO_FOLD).code).toBe(
        '(((5.0) * ((5.0) - 1.0)) / 2.0)'
      );
      expect(glsl.compile(ce.expr(['Binomial', 'x', 0])).code).toBe('1.0');
    });
  });
});
