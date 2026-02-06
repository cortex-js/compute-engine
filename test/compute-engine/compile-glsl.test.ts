import { engine as ce } from '../utils';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const glsl = new GLSLTarget();

describe('GLSL COMPILATION', () => {
  describe('Basic Expressions', () => {
    it('should compile simple arithmetic', () => {
      const expr = ce.parse('x + y');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`x + y`);
    });

    it('should compile multiplication', () => {
      const expr = ce.parse('x * y');
      const code = glsl.compile(expr);
      // Canonical form may reorder operands
      expect(code).toMatchInlineSnapshot(`x * y`);
    });

    it('should compile complex expression', () => {
      const expr = ce.parse('x^2 + y^2');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`pow(x, 2.0) + pow(y, 2.0)`);
    });
  });

  describe('GLSL Functions', () => {
    it('should compile trigonometric functions', () => {
      const expr = ce.parse('\\sin(x) + \\cos(y)');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`sin(x) + cos(y)`);
    });

    it('should compile power function', () => {
      const expr = ce.parse('x^{0.5}');
      const code = glsl.compile(expr);
      // x^0.5 is optimized to sqrt(x)
      expect(code).toMatchInlineSnapshot(`sqrt(x)`);
    });

    it('should compile sqrt', () => {
      const expr = ce.parse('\\sqrt{x}');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`sqrt(x)`);
    });

    it('should compile abs', () => {
      const expr = ce.parse('|x|');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`abs(x)`);
    });

    it('should compile min/max', () => {
      const expr = ce.parse('\\max(x, y)');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`max(x, y)`);
    });

    it('should compile cot', () => {
      const expr = ce.parse('\\cot(x)');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`(cos(x) / sin(x))`);
    });

    it('should compile csc', () => {
      const expr = ce.parse('\\csc(x)');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`(1.0 / sin(x))`);
    });

    it('should compile sec', () => {
      const expr = ce.parse('\\sec(x)');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`(1.0 / cos(x))`);
    });

    it('should compile hyperbolic functions', () => {
      expect(glsl.compile(ce.parse('\\sinh(x)'))).toMatchInlineSnapshot(
        `sinh(x)`
      );
      expect(glsl.compile(ce.parse('\\cosh(x)'))).toMatchInlineSnapshot(
        `cosh(x)`
      );
      expect(glsl.compile(ce.parse('\\tanh(x)'))).toMatchInlineSnapshot(
        `tanh(x)`
      );
    });

    it('should compile inverse hyperbolic functions', () => {
      expect(glsl.compile(ce.box(['Arcosh', 'x']))).toMatchInlineSnapshot(
        `acosh(x)`
      );
      expect(glsl.compile(ce.box(['Arsinh', 'x']))).toMatchInlineSnapshot(
        `asinh(x)`
      );
      expect(glsl.compile(ce.box(['Artanh', 'x']))).toMatchInlineSnapshot(
        `atanh(x)`
      );
    });

    it('should compile reciprocal hyperbolic functions', () => {
      expect(glsl.compile(ce.box(['Coth', 'x']))).toMatchInlineSnapshot(
        `(cosh(x) / sinh(x))`
      );
      expect(glsl.compile(ce.box(['Csch', 'x']))).toMatchInlineSnapshot(
        `(1.0 / sinh(x))`
      );
      expect(glsl.compile(ce.box(['Sech', 'x']))).toMatchInlineSnapshot(
        `(1.0 / cosh(x))`
      );
    });
  });

  describe('Float Literals', () => {
    it('should add .0 to integer literals', () => {
      const expr = ce.parse('x + 5');
      const code = glsl.compile(expr);
      // Canonical form may reorder operands
      expect(code).toMatchInlineSnapshot(`x + 5.0`);
    });

    it('should preserve decimal literals', () => {
      const expr = ce.parse('x * 2.5');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`2.5 * x`);
    });

    it('should handle scientific notation', () => {
      const expr = ce.parse('x * 1.5e10');
      const code = glsl.compile(expr);
      // Note: GLSL expands scientific notation to full decimal
      expect(code).toMatchInlineSnapshot(`15000000000.0 * x`);
    });
  });

  describe('Constants', () => {
    it('should compile pi', () => {
      const expr = ce.parse('2\\pi');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`2.0 * 3.14159265359`);
    });

    it('should compile e', () => {
      const expr = ce.parse('\\exponentialE');
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`2.71828182846`);
    });
  });

  describe('Vectors', () => {
    it('should compile vec2', () => {
      const expr = ce.box(['List', 1, 2]);
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`vec2(1.0, 2.0)`);
    });

    it('should compile vec3', () => {
      const expr = ce.box(['List', 1, 2, 3]);
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0)`);
    });

    it('should compile vec4', () => {
      const expr = ce.box(['List', 1, 2, 3, 4]);
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`vec4(1.0, 2.0, 3.0, 4.0)`);
    });

    it('should compile vector addition', () => {
      const expr = ce.box(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]]);
      const code = glsl.compile(expr);
      // GLSL supports vector operators natively; canonical form reorders
      expect(code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0) + vec3(4.0, 5.0, 6.0)`);
    });

    it('should compile vector multiplication', () => {
      const expr = ce.box(['Multiply', ['List', 'x', 'y', 'z'], 2]);
      const code = glsl.compile(expr);
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
      const code = glsl.compile(expr);
      expect(code).toMatchInlineSnapshot(`0.5 < x`);
    });

    it('should compile logical operations', () => {
      const expr = ce.parse('x > 0 \\land y < 1');
      const code = glsl.compile(expr);
      // GLSL logical operators don't need extra parentheses
      expect(code).toMatchInlineSnapshot(`0.0 < x && y < 1.0`);
    });
  });
});
