import { engine as ce } from '../utils';
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
      expect(code).toMatchInlineSnapshot(`pow(x, 2.0) + pow(y, 2.0)`);
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
      expect(glsl.compile(ce.box(['Arcosh', 'x'])).code).toMatchInlineSnapshot(
        `acosh(x)`
      );
      expect(glsl.compile(ce.box(['Arsinh', 'x'])).code).toMatchInlineSnapshot(
        `asinh(x)`
      );
      expect(glsl.compile(ce.box(['Artanh', 'x'])).code).toMatchInlineSnapshot(
        `atanh(x)`
      );
    });

    it('should compile reciprocal hyperbolic functions', () => {
      expect(glsl.compile(ce.box(['Coth', 'x'])).code).toMatchInlineSnapshot(
        `(cosh(x) / sinh(x))`
      );
      expect(glsl.compile(ce.box(['Csch', 'x'])).code).toMatchInlineSnapshot(
        `(1.0 / sinh(x))`
      );
      expect(glsl.compile(ce.box(['Sech', 'x'])).code).toMatchInlineSnapshot(
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
      const expr = ce.box(['List', 1, 2]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec2(1.0, 2.0)`);
    });

    it('should compile vec3', () => {
      const expr = ce.box(['List', 1, 2, 3]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0)`);
    });

    it('should compile vec4', () => {
      const expr = ce.box(['List', 1, 2, 3, 4]);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec4(1.0, 2.0, 3.0, 4.0)`);
    });

    it('should compile vector addition', () => {
      const expr = ce.box(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]]);
      const code = glsl.compile(expr).code;
      // GLSL supports vector operators natively; canonical form reorders
      expect(code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0) + vec3(4.0, 5.0, 6.0)`);
    });

    it('should compile vector multiplication', () => {
      const expr = ce.box(['Multiply', ['List', 'x', 'y', 'z'], 2]);
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
          return pow(x, 2.0) + pow(y, 2.0);
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
          return sqrt(pow(x, 2.0) + pow(y, 2.0) + pow(z, 2.0));
        }
      `);
    });
  });

  describe('Shader Generation', () => {
    it('should generate a simple fragment shader', () => {
      const colorExpr = ce.box(['List', 1, 0, 0, 1]); // Red color

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
            expression: ce.box(['List', 1, 0, 0]),
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
      const code = glsl.compile(ce.box(['Complex', 3, 4])).code;
      expect(code).toMatchInlineSnapshot(`vec2(3.0, 4.0)`);
    });

    it('should compile ImaginaryUnit as vec2(0, 1)', () => {
      const code = glsl.compile(ce.box('ImaginaryUnit')).code;
      expect(code).toMatchInlineSnapshot(`vec2(0.0, 1.0)`);
    });

    it('should compile complex power z^2', () => {
      const expr = ce.box(['Power', 'z', 2]);
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
      const code = glsl.compile(ce.box(['Multiply', 'z', 'w'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cmul(w, z)`);
    });

    it('should compile scalar * complex (native)', () => {
      const code = glsl.compile(ce.box(['Multiply', 2, 'z'])).code;
      expect(code).toMatchInlineSnapshot(`(2.0 * z)`);
    });

    it('should compile complex divide', () => {
      const code = glsl.compile(
        ce.box(['Divide', 'z', ['Complex', 1, 2]])
      ).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cdiv(z, vec2(1.0, 2.0))`);
    });

    it('should compile complex / real (native)', () => {
      const code = glsl.compile(ce.box(['Divide', 'z', 3])).code;
      expect(code).toMatchInlineSnapshot(`(0.3333333333333333 * z)`);
    });

    it('should compile real / complex', () => {
      const code = glsl.compile(ce.box(['Divide', 5, 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cdiv(vec2(5.0, 0.0), z)`);
    });

    it('should compile complex addition with real promotion', () => {
      const code = glsl.compile(ce.box(['Add', 'z', 5])).code;
      expect(code).toMatchInlineSnapshot(`z + vec2(5.0, 0.0)`);
    });

    it('should compile sin of complex variable', () => {
      const code = glsl.compile(ce.box(['Sin', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_csin(z)`);
    });

    it('should compile cos of complex variable', () => {
      const code = glsl.compile(ce.box(['Cos', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_ccos(z)`);
    });

    it('should compile tan of complex variable', () => {
      const code = glsl.compile(ce.box(['Tan', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_ctan(z)`);
    });

    it('should compile exp(z) via Power(E, z) as _gpu_cexp', () => {
      const expr = ce.box(['Exp', 'z']);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cexp(z)`);
    });

    it('should compile ln of complex variable', () => {
      // Ln is canonicalized, check the operator
      const expr = ce.box(['Ln', 'z']);
      const code = glsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cln(z)`);
    });

    it('should compile sqrt of complex variable', () => {
      const code = glsl.compile(ce.box(['Sqrt', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_csqrt(z)`);
    });

    it('should compile abs of complex as length', () => {
      const code = glsl.compile(ce.box(['Abs', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`length(z)`);
    });

    it('should compile Re and Im of complex', () => {
      expect(glsl.compile(ce.box(['Re', 'z'])).code).toMatchInlineSnapshot(
        `(z).x`
      );
      expect(glsl.compile(ce.box(['Im', 'z'])).code).toMatchInlineSnapshot(
        `(z).y`
      );
    });

    it('should compile Conjugate of complex', () => {
      const code = glsl.compile(ce.box(['Conjugate', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`vec2(z.x, -z.y)`);
    });

    it('should compile Arg of complex', () => {
      const code = glsl.compile(ce.box(['Arg', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`atan(z.y, z.x)`);
    });

    it('should compile sinh/cosh/tanh of complex', () => {
      expect(glsl.compile(ce.box(['Sinh', 'z'])).code).toMatchInlineSnapshot(
        `_gpu_csinh(z)`
      );
      expect(glsl.compile(ce.box(['Cosh', 'z'])).code).toMatchInlineSnapshot(
        `_gpu_ccosh(z)`
      );
      expect(glsl.compile(ce.box(['Tanh', 'z'])).code).toMatchInlineSnapshot(
        `_gpu_ctanh(z)`
      );
    });

    it('should compile arcsinh of complex variable', () => {
      const code = glsl.compile(ce.box(['Arsinh', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_casinh(z)`);
    });

    it('should compile arccosh of complex variable', () => {
      const code = glsl.compile(ce.box(['Arcosh', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_cacosh(z)`);
    });

    it('should compile arctanh of complex variable', () => {
      const code = glsl.compile(ce.box(['Artanh', 'z'])).code;
      expect(code).toMatchInlineSnapshot(`_gpu_catanh(z)`);
    });

    it('should include only cmul in preamble for z*w', () => {
      const result = glsl.compile(ce.box(['Multiply', 'z', 'w']));
      expect(result.preamble).toContain('_gpu_cmul');
      // Should NOT include unrelated functions
      expect(result.preamble).not.toContain('_gpu_csin');
      expect(result.preamble).not.toContain('_gpu_cexp');
    });

    it('should include cpow deps (cexp, cmul, cln) for z^2', () => {
      const result = glsl.compile(ce.box(['Power', 'z', 2]));
      expect(result.preamble).toContain('_gpu_cpow');
      expect(result.preamble).toContain('_gpu_cexp');
      expect(result.preamble).toContain('_gpu_cmul');
      expect(result.preamble).toContain('_gpu_cln');
      // Should NOT include trig
      expect(result.preamble).not.toContain('_gpu_csin');
    });

    it('should include ctan deps (cdiv, csin, ccos) for tan(z)', () => {
      const result = glsl.compile(ce.box(['Tan', 'z']));
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
});
