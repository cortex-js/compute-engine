import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const glsl = new GLSLTarget();

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
      const code = glsl.compile(expr).code;
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
      const code = glsl.compile(expr).code;
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
          expect(() => glsl.compile(ce.expr(['Binomial', n, k]))).toThrow(
            /statically non-finite first operand/
          );
      expect(ce.box(['Binomial', 'PositiveInfinity', 0]).N().re).toBeNaN();
      expect(ce.box(['Binomial', 'PositiveInfinity', 2]).N().re).toBeNaN();
      // A finite literal or symbol is unaffected (byte-identical).
      expect(glsl.compile(ce.expr(['Binomial', 'x', 2])).code).toBe(
        '(((x) * ((x) - 1.0)) / 2.0)'
      );
      expect(glsl.compile(ce.expr(['Binomial', 5, 2])).code).toBe(
        '(((5.0) * ((5.0) - 1.0)) / 2.0)'
      );
      expect(glsl.compile(ce.expr(['Binomial', 'x', 0])).code).toBe('1.0');
    });
  });

  describe('Sum and Product', () => {
    it('should unroll Sum with small constant bounds', () => {
      const expr = ce.expr(['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 3]]);
      const code = glsl.compile(expr).code;
      expect(code).toBe('((sin(1.0)) + (sin(2.0)) + (sin(3.0)))');
    });

    it('should unroll Product with small constant bounds', () => {
      const expr = ce.expr(['Product', 'i', ['Limits', 'i', 1, 4]]);
      const code = glsl.compile(expr).code;
      expect(code).toBe('((1.0) * (2.0) * (3.0) * (4.0))');
    });

    it('should return identity for empty Sum range', () => {
      const expr = ce.expr(['Sum', 'i', ['Limits', 'i', 5, 3]]);
      const code = glsl.compile(expr).code;
      expect(code).toBe('0.0');
    });

    it('should return identity for empty Product range', () => {
      const expr = ce.expr(['Product', 'i', ['Limits', 'i', 5, 3]]);
      const code = glsl.compile(expr).code;
      expect(code).toBe('1.0');
    });

    it('should emit for-loop for large Sum range inside compileFunction', () => {
      const expr = ce.expr([
        'Sum',
        ['Sin', 'i'],
        ['Limits', 'i', 1, 1000],
      ]);
      const fn = glsl.compileFunction(expr, 'sumSin', 'float', []);
      expect(fn).toContain('float sumSin()');
      expect(fn).toContain('for (int i = 1; i <= 1000; i++)');
      expect(fn).toContain('+= sin(float(i))');
      expect(fn).toContain('return ');
      expect(fn).not.toContain('let ');
      expect(fn).not.toContain('while');
      expect(fn).not.toContain('() =>');
    });

    it('should not contain JS constructs in Sum output', () => {
      const expr = ce.expr(['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 3]]);
      const code = glsl.compile(expr).code;
      expect(code).not.toContain('let ');
      expect(code).not.toContain('const ');
      expect(code).not.toContain('() =>');
      expect(code).not.toContain('{ re');
    });

    it('a collection-valued Sum body fails closed (D6)', () => {
      // `Σ h(i)·(1/1.4^i)·a(…)` where `a` returns a vector — the interpreter's
      // elementwise zip-broadcast Sum. Scalar accumulation over arrays would
      // silently produce a wrong value, so it must throw (mirrors JS/base gate).
      const e = new ComputeEngine();
      e.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
      e.parse(
        'h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)'
      ).evaluate();
      const expr = e.parse('\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))');
      expect(() => glsl.compile(expr)).toThrow(
        /collection-valued body.*Fail closed/s
      );
    });
  });

  describe('Loop', () => {
    it('should compile Loop as for-loop without IIFE', () => {
      const expr = ce.expr([
        'Loop',
        ['Assign', 'acc', ['Add', 'acc', 'i']],
        ['Element', 'i', ['Range', 1, 5]],
      ]);
      const code = glsl.compile(expr).code;
      expect(code).toContain('for (int i = 1; i <= 5; i++)');
      // The int loop counter is consumed as a float in float math (CO-P1-2):
      // `float(i)`, not a bare `i` (which is a GLSL int/float type mismatch).
      expect(code).toContain('acc = acc + float(i)');
      expect(code).not.toContain('let ');
      expect(code).not.toContain('() =>');
      expect(code).not.toContain('})()');
    });
  });

  describe('Function (Lambda)', () => {
    it('should throw for anonymous functions in GLSL', () => {
      expect(() =>
        glsl.compile(ce.expr(['Function', ['Add', 'x', 1], 'x']))
      ).toThrow('Anonymous functions (Function) are not supported in GPU');
    });
  });

  describe('Type-Aware Declarations', () => {
    it('should declare complex-typed variable as vec2', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'v'],
        ['Assign', 'v', ['Complex', 1, 2]],
        'v',
      ]);
      const code = glsl.compile(expr).code;
      expect(code).toContain('vec2 v');
    });
  });

  // REVIEW.md E15: GLSL has the ternary operator, but no `NaN` identifier — the
  // base compiler's default When/Which emitted a bare `NaN`. GLSL routes its
  // masked/else-branch NaN through the overridable `_gpu_nan()` preamble helper
  // instead of a bare, implementation-defined `0.0 / 0.0` literal.
  describe('GLSL control flow (E15)', () => {
    it('compiles If to a ternary', () => {
      const e = ce.expr(['If', ['Greater', 'x', 0], 1, ['Negate', 1]]);
      const code = glsl.compile(e).code;
      expect(code).toContain('?');
      expect(/\bNaN\b/.test(code)).toBe(false);
    });

    it('compiles When with the _gpu_nan() helper, never a bare NaN', () => {
      const e = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const result = glsl.compile(e);
      // The else branch calls the helper, not a bare `0.0 / 0.0` literal…
      expect(result.code).toContain('_gpu_nan()');
      expect(result.code).not.toContain('0.0 / 0.0');
      expect(/\bNaN\b/.test(result.code)).toBe(false);
      // …and the helper definition is emitted (selectively) into the preamble.
      expect(result.preamble ?? '').toContain('float _gpu_nan()');
      expect(result.preamble ?? '').toContain(
        'return intBitsToFloat(0x7FC00000);'
      );
    });
  });

  // CO-P1-2: GLSL/WGSL `min`/`max` are 2-argument builtins; 3+ args must fold
  // into a nest of 2-argument calls (a variadic `max(a, b, c)` is invalid).
  describe('CO-P1-2 min/max variadic folding', () => {
    it('folds 3-arg Max into nested max()', () => {
      const code = glsl.compile(ce.box(['Max', 'a', 'b', 'c'])).code;
      expect(code).toBe('max(max(a, b), c)');
    });

    it('folds 4-arg Min into nested min()', () => {
      const code = glsl.compile(ce.box(['Min', 'a', 'b', 'c', 'd'])).code;
      expect(code).toBe('min(min(min(a, b), c), d)');
    });

    it('leaves 2-arg Max unchanged', () => {
      const code = glsl.compile(ce.box(['Max', 'a', 'b'])).code;
      expect(code).toBe('max(a, b)');
    });
  });

  // CO-P1-2: a loop-form Sum (non-constant / large bounds) is a bare statement
  // block, valid only as a top-level function body — never spliced into a
  // sub-expression (which produced invalid `return _acc; + 1.0`). Fail closed.
  // Tycho item 110: a loop-form Sum/Product emits STATEMENTS (a shader has no
  // expression-level loop), which used to make it un-composable — `1 + \sum…`
  // failed closed. It now HOISTS: the loop is emitted ahead of the value and
  // the accumulator is referenced as an ordinary expression. (CO-P1-2 pinned
  // the old fail-closed contract; the invariant it protected — never splice a
  // bare `return _acc;` mid-expression — is still pinned below.)
  describe('loop-form Sum composes by hoisting (Tycho item 110)', () => {
    const bigSum = ['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 1000]];

    it('hoists the loop when a loop-form Sum is used mid-expression', () => {
      const code = glsl.compile(ce.box(['Add', bigSum, 1])).code;
      expect(code).toContain('for (int i = 1; i <= 1000; i++)');
      // The loop precedes the value, and the value references the accumulator.
      const acc = /float (_\w+) = 0\.0;/.exec(code)?.[1];
      expect(acc).toBeDefined();
      expect(code.trimEnd().endsWith(`return ${acc} + 1.0;`)).toBe(true);
      expect(code.indexOf('for (')).toBeLessThan(code.lastIndexOf('return '));
    });

    it('scales a hoisted Sum (the item-110 witness shape)', () => {
      const code = glsl.compile(
        ce.box(['Multiply', 0.03, bigSum]) as any
      ).code;
      expect(code).toContain('for (int i = 1; i <= 1000; i++)');
      expect(code).toMatch(/return 0\.03 \* _\w+;$/m);
    });

    it('scopes a NESTED loop inside its enclosing loop body', () => {
      // Symbolic bounds: constant bounds under the unroll limit inline.
      const inner = ['Sum', ['Multiply', 'j', 'x'], ['Limits', 'j', 1, 'm']];
      const outer = ['Sum', ['Multiply', 'i', inner], ['Limits', 'i', 1, 'n']];
      const code = glsl.compile(ce.box(outer as any)).code;
      const outerAt = code.indexOf('for (int i =');
      const innerAt = code.indexOf('for (int j =');
      const closeAt = code.lastIndexOf('}');
      // The inner loop is emitted BETWEEN the outer `for` and its closing
      // brace — hoisting it out would strand a reference to `i`.
      expect(outerAt).toBeGreaterThanOrEqual(0);
      expect(innerAt).toBeGreaterThan(outerAt);
      expect(innerAt).toBeLessThan(closeAt);
    });

    it('never emits a spliced `return _acc; +`', () => {
      let code = '';
      try {
        code = glsl.compile(ce.box(['Add', bigSum, 1])).code;
      } catch {
        /* fail-closed is an acceptable path too */
      }
      expect(code).not.toMatch(/return\s+\w+;\s*\+/);
    });

    it('still compiles a loop-form Sum as a top-level function body', () => {
      const fn = glsl.compileFunction(ce.box(bigSum), 'sumSin', 'float', []);
      expect(fn).toContain('for (int i = 1; i <= 1000; i++)');
      expect(fn).toContain('sin(float(i))');
    });

    it('scopes a nested loop inside an UNROLLED outer term', () => {
      // The outer bounds are constant and small, so it unrolls; each term's
      // hoisted loop must still be emitted (once per term) ahead of the value.
      const inner = ['Sum', ['Multiply', 'j', 'x'], ['Limits', 'j', 1, 'm']];
      const outer = ['Sum', ['Multiply', 'i', inner], ['Limits', 'i', 1, 2]];
      const code = glsl.compile(ce.box(outer as any)).code;
      expect(code.match(/for \(int j =/g)?.length).toBe(2);
      // A term that hoists is finished off into a temporary right after its own
      // statements, so the unroll stays in per-term order (a draw in term 2's
      // loop can never overtake term 1's remainder). The combined expression
      // then reads those temporaries.
      expect(code).toMatch(/float _\w+ = 1\.0 \* _\w+;$/m);
      expect(code).toMatch(/float _\w+ = 2\.0 \* _\w+;$/m);
      expect(code).toMatch(/return \(\(_\w+\) \+ \(_\w+\)\);$/m);
    });

    // A shader conditional is an EXPRESSION (a ternary), so an arm has no
    // statement position of its own. Hoisting the loop out would run it
    // whichever branch is selected — and a compiled `Random()` advances a
    // runtime counter, so a loop stranded ahead of a branch it never feeds
    // would shift every later draw. Fail closed (D6) instead.
    describe('a conditionally-evaluated branch fails closed', () => {
      for (const [label, expr] of [
        ['If', ['If', ['Greater', 'x', 0], bigSum, 0]],
        ['Which', ['Which', ['Greater', 'x', 0], bigSum, 'True', 0]],
        ['When', ['When', bigSum, ['Greater', 'x', 0]]],
      ] as [string, any][]) {
        it(`${label} arm containing a loop-form Sum`, () => {
          expect(() => glsl.compile(ce.box(expr))).toThrow(
            /conditionally-evaluated branch contains a multi-statement construct/
          );
        });
      }

      it('the loop is never emitted ahead of the conditional', () => {
        let code = '';
        try {
          code = glsl.compile(
            ce.box(['If', ['Greater', 'x', 0], bigSum, 0] as any)
          ).code;
        } catch {
          /* fail-closed is the expected path */
        }
        expect(code).not.toContain('for (');
      });

      it('a conditional with scalar arms is unaffected', () => {
        const code = glsl.compile(
          ce.box(['If', ['Greater', 'x', 0], 1, 2] as any)
        ).code;
        expect(code).toBe('((0.0 < x) ? (1.0) : (2.0))');
      });

      it('names the impure-temporary cause too, not just a loop', () => {
        // The same escape detector now fires for a hoisted impure temporary
        // (`Round(Random())` binds its operand to a `_tv`), so the message
        // must not blame a loop-form Sum/Product exclusively.
        expect(() =>
          glsl.compile(
            ce.box([
              'WithRandomSeed',
              7,
              ['Which', ['Less', 'x', 1], ['Round', ['Random']], 'True', 2],
            ] as any)
          )
        ).toThrow(/or an impure operand bound to a hoisted temporary/);
      });
    });

    it('a hoisted accumulator does not collide with a shader assignment target', () => {
      // The hoisted declaration is emitted ahead of the caller's assignment, so
      // the caller's own `_tv`-spelled target must be off-limits to the
      // generated name — otherwise the assignment becomes `_tv1 = _tv1` and the
      // output is never written.
      const shader = glsl.compileShader({
        type: 'fragment',
        uniforms: [{ name: 'n', type: 'int' }],
        body: [
          {
            variable: 'float _tv1',
            expression: ce.box(['Add', bigSum, 1] as any),
          },
        ],
      });
      expect(shader).not.toMatch(/_tv1\s*=\s*_tv1\b/);
      expect(shader).toMatch(/float _tv\d+ = 0\.0;/);
    });

    it('a Block still fails closed as a sub-expression', () => {
      const blk = ['Block', ['Declare', 'q'], ['Assign', 'q', 2], 'q'];
      expect(() => glsl.compile(ce.box(['Add', blk, 1] as any))).toThrow(
        /multi-statement construct.*sub-expression/
      );
    });
  });

  // CO-P2-23a: a Sum with a negative index unrolls `Negate(i)` at a negative
  // index value (`-3`). Emitting `-` glued to `-3.0` yields `--3.0`, which is
  // invalid GLSL. The base compiler now separates them (`- -3.0`).
  describe('negative-index Sum unroll does not emit `--`', () => {
    it('parenthesizes/spaces the negation (no `--`)', () => {
      const expr = ce.box(['Sum', ['Negate', 'i'], ['Tuple', 'i', -3, 3]]);
      const code = glsl.compile(expr).code;
      expect(code).not.toContain('--');
      expect(code).toContain('- -3.0');
    });
  });

  // CO-P2-23b: a user variable named after a GLSL reserved word (`in`,
  // `sample`, `filter`, `texture`, …) would emit a shader that fails to
  // compile. Fail closed (D6) with a diagnostic naming the identifier.
  describe('reserved-word variables fail closed', () => {
    for (const kw of ['in', 'sample', 'filter', 'texture', 'sampler2D']) {
      it(`rejects "${kw}" as a variable`, () => {
        expect(() => glsl.compile(ce.box(['Add', kw, 1])).code).toThrow(
          /reserved word/
        );
      });
    }
    it('rejects a reserved word used as a Sum index', () => {
      expect(() =>
        glsl.compile(
          ce.box(['Sum', 'sample', ['Tuple', 'sample', 1, 1000]])
        ).code
      ).toThrow(/reserved word/);
    });
    it('still accepts a non-reserved variable', () => {
      expect(glsl.compile(ce.box(['Add', 'inp', 1])).code).toContain('inp');
    });
  });

  describe('Loop as the final block statement fails closed', () => {
    it('rejects a trailing Loop (no value to return, no `return None` analog)', () => {
      const expr = ce.box([
        'Block',
        ['Assign', 's', 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'a']],
          ['Element', 'a', ['Range', 1, 5]],
        ],
      ]);
      expect(() => glsl.compile(expr).code).toThrow(
        /final statement of a block/
      );
    });

    it('accepts a Loop followed by a value-producing statement', () => {
      const expr = ce.box([
        'Block',
        ['Assign', 's', 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'a']],
          ['Element', 'a', ['Range', 1, 5]],
        ],
        's',
      ]);
      const code = glsl.compile(expr).code;
      expect(code).toContain('for (int a = 1; a <= 5; a++)');
      expect(code).toContain('return s;');
      expect(code).not.toMatch(/return for/);
    });
  });
});

// CE `Length` (element count) must NOT lower to the GLSL `length()` builtin,
// which is the Euclidean NORM. The `length()` mapping now belongs to CE `Norm`.
describe('GLSL Length/Norm name collision (Tycho round)', () => {
  it('CE Length fails closed (was: emitted length() = norm, or invalid source)', () => {
    const expr = ce.box(['Length', ['List', 1, 2, 3]]);
    expect(() => glsl.compile(expr)).toThrow(/Norm|not supported|Fail closed/);
  });

  it('CE Norm lowers to the length() builtin', () => {
    const code = glsl.compile(ce.box(['Norm', ['List', 3, 4]])).code;
    expect(code).toBe('length(vec2(3.0, 4.0))');
  });
});

// A masked (`When`/`Which` else) branch whose value is a tuple body compiles
// to a vecN; the NaN branch must match that shape — GLSL has no implicit
// float→vecN conversion in a ternary, so `cond ? vec2(…) : _gpu_nan()` is
// rejected by the driver (every restricted parametric member lost its GPU
// sampling path).
describe('GLSL When/Which NaN branch matches the value shape (Tycho item 49)', () => {
  it('restricted parametric tuple body emits a vec2 NaN branch', () => {
    const code = glsl.compile(
      ce.box([
        'When',
        ['Tuple', ['Cos', 't'], ['Sin', 't']],
        ['And', ['LessEqual', 0, 't'], ['LessEqual', 't', 1]],
      ])
    ).code;
    expect(code).toContain('vec2(cos(t), sin(t))');
    expect(code).toContain('vec2(_gpu_nan())');
    expect(code).not.toMatch(/: \(_gpu_nan\(\)\)/);
  });

  it('scalar bodies keep the scalar NaN', () => {
    const code = glsl.compile(
      ce.box(['When', ['Cos', 't'], ['LessEqual', 't', 1]])
    ).code;
    expect(code).toContain(': (_gpu_nan())');
    expect(code).not.toContain('vec2(_gpu_nan())');
  });

  it('Which fall-through NaN follows the branch value shape', () => {
    const code = glsl.compile(
      ce.box(['Which', ['LessEqual', 't', 1], ['Tuple', 1, 2]])
    ).code;
    expect(code).toContain('vec2(_gpu_nan())');
  });
});

// A `Block` local bound to a point/tuple value is a vecN on the GPU, not a
// float. The `float` default disagreed with its own assignment AND with the
// enclosing function's declared return type when the local is the block's
// value — a driver rejects it with "return type mismatch" (Tycho round).
describe('GLSL vector-valued block locals declare a vecN', () => {
  it('a local assigned a 2-tuple is declared vec2', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', ['Cos', 't'], ['Sin', 't']]],
      'p',
    ]);
    const code = glsl.compileFunction(expr, 'curve', 'vec2', [['t', 'float']]);
    expect(code).toContain('vec2 p;');
    expect(code).not.toContain('float p;');
    expect(code).toContain('return p;');
  });

  it('a Declare with a 3-tuple initial value is declared vec3', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p', 'number', ['Tuple', 't', ['Square', 't'], 1]],
      'p',
    ]);
    const code = glsl.compile(expr).code;
    expect(code).toContain('vec3 p;');
  });

  it('a scalar local still declares float', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'r'],
      ['Assign', 'r', ['Cos', 't']],
      'r',
    ]);
    expect(glsl.compile(expr).code).toContain('float r;');
  });

  // Defect A: widths outside 2–4 have no `vecN`, but the list compiler still
  // lowers them to `float[N](…)`. A `float` declaration under an array
  // assignment is the same mismatch, one width up.
  it('a local assigned a 5-tuple is declared as the matching array type', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 1, 2, 3, 4, 5]],
      'p',
    ]);
    const code = glsl.compile(expr).code;
    expect(code).toContain('float[5] p;');
    expect(code).not.toContain('float p;');
    expect(code).toContain('p = float[5](');
  });

  it('a local assigned a 1-tuple is declared as the matching array type', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['List', 7]],
      'p',
    ]);
    const code = glsl.compile(expr).code;
    expect(code).toContain('float[1] p;');
    expect(code).toContain('p = float[1](');
  });

  // Defect C: the width must propagate through a local reference, or the
  // aliasing local is declared `float` while holding a vec2.
  it('a local aliasing a vector local inherits its width', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      ['Declare', 'q'],
      ['Assign', 'q', 'p'],
      'q',
    ]);
    const code = glsl.compile(expr, { vars: { x: 'x', y: 'y' } }).code;
    expect(code).toContain('vec2 p;');
    expect(code).toContain('vec2 q;');
    expect(code).not.toContain('float q;');
  });

  it('a nested block local shadows an outer vector local', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      ['Block', ['Declare', 'p'], ['Assign', 'p', 'x'], 'p'],
    ]);
    const code = glsl.compile(expr, { vars: { x: 'x', y: 'y' } }).code;
    expect(code).toContain('vec2 p;');
    expect(code).toContain('float p;');
  });
});

// A `vecN` constructor takes SCALAR components: a vector-valued element (a
// complex component, lowered as `vec2(re, im)`, or a nested tuple) made the
// emitted constructor exceed its arity — `vec2(t, vec2(0.0, t))`, which a
// driver rejects with "constructor: too many arguments" (Tycho round).
describe('GLSL vecN constructor arity (no vector-valued components)', () => {
  it('a tuple with a complex component fails closed', () => {
    const expr = ce.box(['Tuple', 't', ['Multiply', 'ImaginaryUnit', 't']]);
    expect(() => glsl.compile(expr)).toThrow(/Fail closed/);
  });

  it('a nested tuple fails closed rather than emit vec2(vec2, vec2)', () => {
    const expr = ce.box(['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    expect(() => glsl.compile(expr)).toThrow(/Fail closed/);
  });

  it('an all-scalar tuple still lowers to vec2', () => {
    const expr = ce.box(['Tuple', ['Cos', 't'], ['Sin', 't']]);
    expect(glsl.compile(expr).code).toBe('vec2(cos(t), sin(t))');
  });

  // Defect B: the guard asked "does this element have a vecN lowering?", so an
  // aggregate element of width 1 or 5+ — which has none — slipped through and
  // emitted `vec2(float[1](1.0), 2.0)`.
  it('a 1-element list component fails closed', () => {
    const expr = ce.box(['Tuple', ['List', 1], 2]);
    expect(() => glsl.compile(expr)).toThrow(/Fail closed/);
  });

  it('a 5-element list component fails closed', () => {
    const expr = ce.box(['Tuple', ['List', 1, 2, 3, 4, 5], 2]);
    expect(() => glsl.compile(expr)).toThrow(/Fail closed/);
  });
});

// A shader local has ONE declared type, so every binding of it in a block must
// agree on a shape. "First assignment wins" reached the very "declared
// `float`, assigned `vec2`" mismatch the width inference exists to prevent, by
// intra-block reassignment instead of aliasing. Disagreement fails closed:
// neither GLSL nor WGSL has a type a scalar and a vecN both fit.
describe('GLSL block local with disagreeing binding shapes fails closed', () => {
  it('scalar then vector fails closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Cos', 't']],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      'p',
    ]);
    expect(() => glsl.compile(expr, { vars: { x: 'x', y: 'y' } })).toThrow(
      /disagreeing shapes.*scalar, then 2-component aggregate/s
    );
  });

  it('vector then scalar fails closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      ['Assign', 'p', ['Cos', 't']],
      'p',
    ]);
    expect(() => glsl.compile(expr, { vars: { x: 'x', y: 'y' } })).toThrow(
      /disagreeing shapes.*2-component aggregate, then scalar/s
    );
  });

  it('two different vector widths fail closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      ['Assign', 'p', ['Tuple', 'x', 'y', 't']],
      'p',
    ]);
    expect(() => glsl.compile(expr, { vars: { x: 'x', y: 'y' } })).toThrow(
      /disagreeing shapes/
    );
  });

  it('repeated bindings of the SAME shape still compile', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      ['Assign', 'p', ['Tuple', ['Cos', 't'], ['Sin', 't']]],
      'p',
    ]);
    const code = glsl.compile(expr, { vars: { x: 'x', y: 'y' } }).code;
    expect(code).toContain('vec2 p;');
    expect(code).toContain('p = vec2(cos(t), sin(t));');
  });
});

// A `Matrix` has no single component count, so `aggregateComponentCount`
// reported `undefined` for it — which every caller reads as "scalar". That let
// `(mat2(…), 1)` emit `vec2(mat2(…), 1.0)`, which no shader compiler accepts.
describe('GLSL matrix-valued components are aggregates, not scalars', () => {
  it('a matrix component of a tuple fails closed', () => {
    const expr = ce.box([
      'Tuple',
      ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]],
      1,
    ]);
    expect(() => glsl.compile(expr)).toThrow(/matrix\/tensor value/);
  });

  it('a block local bound to a matrix fails closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]]],
      'p',
    ]);
    expect(() => glsl.compile(expr)).toThrow(/matrix\/tensor-valued local/);
  });
});

// Width 0 is a real observed width, not the scalar sentinel: an empty
// tuple/list lowered to `float[0]()` — an invalid zero-sized array — while its
// local stayed declared `float`.
describe('GLSL zero-width aggregates fail closed', () => {
  it('an empty Tuple fails closed instead of emitting float[0]()', () => {
    expect(() => glsl.compile(ce.box(['Tuple']))).toThrow(
      /empty tuple\/list has no GPU lowering/
    );
  });

  it('an empty List fails closed', () => {
    expect(() => glsl.compile(ce.box(['List']))).toThrow(/Fail closed/);
  });

  it('a block local bound to an empty tuple fails closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple']],
      'p',
    ]);
    expect(() => glsl.compile(expr)).toThrow(
      /Block local "p": an empty tuple\/list/
    );
  });
});

// Tycho item 144: `isComplexValued` over-reported complexness and the
// real-only-helper gate (D6) failed closed on operands that are real by
// construction, blanking Desmos-corpus render states.
//
// Two independent leaks, both above the `Sqrt`/`Ln`/`Log` carve-out that keeps
// the real kernel for an unknown-sign radicand:
//   1. the arithmetic wrapped around such a head (`1e5·√u`) is itself typed
//      `finite_complex` and answered from its TYPE, defeating the carve-out;
//   2. a `boolean`-typed node (a comparison, e.g. a `Which` condition — not
//      even a value position) fell through to the conservative operand
//      recursion and inherited the report.
describe('GLSL Tycho item 144: complexness must not be over-reported', () => {
  const e = new ComputeEngine();
  // √(⌈x⌉² + ⌈y⌉²): a real radicand of unknown sign, so `Sqrt` types
  // `finite_complex` while the compile contract keeps the real `sqrt` kernel.
  const radical = [
    'Sqrt',
    ['Add', ['Power', ['Ceil', 'x'], 2], ['Power', ['Ceil', 'y'], 2]],
  ];

  it('compiles the full witness (Multiply + comparison + Which under Mod)', () => {
    const expr = e.box([
      'Mod',
      [
        'Which',
        ['Less', ['Sin', ['Multiply', 1e5, radical]], 0],
        'x',
        'True',
        'y',
      ],
      1,
    ]);
    const code = glsl.compile(expr).code;
    expect(code).toMatchInlineSnapshot(
      `mod(((sin(100000.0 * sqrt(_gpu_powi(ceil(x), 2.0) + _gpu_powi(ceil(y), 2.0))) < 0.0) ? (x) : ((y))), 1.0)`
    );
  });

  it('compiles a Multiply over a wide-typed Sqrt (leak 1)', () => {
    const expr = e.box([
      'Mod',
      ['Multiply', 1e5, ['Sqrt', ['Add', ['Power', ['Ceil', 'x'], 2], 1]]],
      1,
    ]);
    const code = glsl.compile(expr).code;
    expect(code).toMatchInlineSnapshot(
      `mod(100000.0 * sqrt(_gpu_powi(ceil(x), 2.0) + 1.0), 1.0)`
    );
  });

  it('compiles a comparison over a wide-typed operand (leak 2)', () => {
    const expr = e.box([
      'Mod',
      [
        'Which',
        ['Less', ['Multiply', 2, radical], 0],
        'x',
        'True',
        'y',
      ],
      1,
    ]);
    const code = glsl.compile(expr).code;
    expect(code).toMatchInlineSnapshot(
      `mod(((2.0 * sqrt(_gpu_powi(ceil(x), 2.0) + _gpu_powi(ceil(y), 2.0)) < 0.0) ? (x) : ((y))), 1.0)`
    );
  });

  it('still fails closed on a provably complex operand', () => {
    expect(() => glsl.compile(e.box(['Mod', ['Sqrt', -2], 1]))).toThrow(
      /real-only target helper "mod" cannot represent a complex-valued argument/
    );
    expect(() => glsl.compile(e.box(['Mod', ['Complex', 1, 2], 1]))).toThrow(
      /real-only target helper "mod" cannot represent a complex-valued argument/
    );
    // Propagated through a `Multiply`, the head whose type answer this fix
    // replaced with operand recursion.
    expect(() =>
      glsl.compile(e.box(['Mod', ['Multiply', 'ImaginaryUnit', 'x'], 1]))
    ).toThrow(
      /real-only target helper "mod" cannot represent a complex-valued argument/
    );
  });
});

// Tycho item 147: `Real`/`Imaginary`/`Argument` produce a real-SHAPED scalar on
// every target, whatever their operand is — but `Imaginary` types bare `number`
// (deliberately: `Im(~oo)` is `NaN`), so `isComplexValued` fell through to the
// conservative operand recursion, saw the `complex` operand, and failed the
// real-only-helper gate closed on forms that are real by construction.
describe('GLSL Tycho item 147: real-by-definition heads read real', () => {
  const e = new ComputeEngine();
  e.declare('z', 'complex');
  e.declare('w', 'complex');

  it('compiles Mod over Imaginary/Real/Argument of a complex symbol', () => {
    expect(glsl.compile(e.box(['Mod', ['Imaginary', 'z'], 1])).code).toBe(
      'mod((z).y, 1.0)'
    );
    expect(glsl.compile(e.box(['Mod', ['Real', 'z'], 1])).code).toBe(
      'mod((z).x, 1.0)'
    );
    expect(glsl.compile(e.box(['Mod', ['Argument', 'z'], 1])).code).toBe(
      'mod(atan(z.y, z.x), 1.0)'
    );
  });

  it('compiles Mod with a real-by-definition head in BOTH positions', () => {
    expect(
      glsl.compile(e.box(['Mod', ['Imaginary', 'z'], ['Imaginary', 'w']])).code
    ).toBe('mod((z).y, (w).y)');
  });

  it('still compiles Mod over Abs (the head that already worked)', () => {
    expect(glsl.compile(e.box(['Mod', ['Abs', 'z'], 1])).code).toBe(
      'mod(length(z), 1.0)'
    );
  });

  it('survives enclosing arithmetic (the propagating-heads path)', () => {
    expect(
      glsl.compile(e.box(['Mod', ['Multiply', 2, ['Imaginary', 'z']], 1])).code
    ).toBe('mod(2.0 * (z).y, 1.0)');
  });

  it('still fails closed on a genuinely complex-shaped operand', () => {
    // `Conjugate` is complex → complex (it emits a `vec2`), so it is
    // deliberately NOT a real-by-definition head.
    expect(() => glsl.compile(e.box(['Mod', ['Conjugate', 'z'], 1]))).toThrow(
      /real-only target helper "mod" cannot represent a complex-valued argument/
    );
    // The item-144 pins are unchanged.
    expect(() => glsl.compile(e.box(['Mod', ['Sqrt', -2], 1]))).toThrow(
      /real-only target helper "mod" cannot represent a complex-valued argument/
    );
    expect(() =>
      glsl.compile(e.box(['Mod', ['Multiply', 'ImaginaryUnit', 'x'], 1]))
    ).toThrow(
      /real-only target helper "mod" cannot represent a complex-valued argument/
    );
  });
});
