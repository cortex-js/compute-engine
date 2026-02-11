import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/free-functions';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const wgsl = new WGSLTarget();

describe('WGSL COMPILATION', () => {
  describe('Basic Expressions', () => {
    it('should compile simple arithmetic', () => {
      const expr = ce.parse('x + y');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`x + y`);
    });

    it('should compile multiplication', () => {
      const expr = ce.parse('x * y');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`x * y`);
    });

    it('should compile complex expression', () => {
      const expr = ce.parse('x^2 + y^2');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`pow(x, 2.0) + pow(y, 2.0)`);
    });
  });

  describe('WGSL-Specific Functions', () => {
    it('should compile inverseSqrt (camelCase)', () => {
      const expr = ce.box(['Inversesqrt', 'x']);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`inverseSqrt(x)`);
    });

    it('should compile mod using % operator', () => {
      const expr = ce.box(['Mod', 'x', 'y']);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(x % y)`);
    });
  });

  describe('Shared GPU Functions', () => {
    it('should compile trigonometric functions', () => {
      const expr = ce.parse('\\sin(x) + \\cos(y)');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`sin(x) + cos(y)`);
    });

    it('should compile power function', () => {
      const expr = ce.parse('x^{0.5}');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`sqrt(x)`);
    });

    it('should compile sqrt', () => {
      const expr = ce.parse('\\sqrt{x}');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`sqrt(x)`);
    });

    it('should compile abs', () => {
      const expr = ce.parse('|x|');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`abs(x)`);
    });

    it('should compile min/max', () => {
      const expr = ce.parse('\\max(x, y)');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`max(x, y)`);
    });

    it('should compile cot', () => {
      const expr = ce.parse('\\cot(x)');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(cos(x) / sin(x))`);
    });

    it('should compile csc', () => {
      const expr = ce.parse('\\csc(x)');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(1.0 / sin(x))`);
    });

    it('should compile sec', () => {
      const expr = ce.parse('\\sec(x)');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(1.0 / cos(x))`);
    });

    it('should compile hyperbolic functions', () => {
      expect(wgsl.compile(ce.parse('\\sinh(x)')).code).toMatchInlineSnapshot(
        `sinh(x)`
      );
      expect(wgsl.compile(ce.parse('\\cosh(x)')).code).toMatchInlineSnapshot(
        `cosh(x)`
      );
      expect(wgsl.compile(ce.parse('\\tanh(x)')).code).toMatchInlineSnapshot(
        `tanh(x)`
      );
    });

    it('should compile inverse hyperbolic functions', () => {
      expect(wgsl.compile(ce.box(['Arcosh', 'x'])).code).toMatchInlineSnapshot(
        `acosh(x)`
      );
      expect(wgsl.compile(ce.box(['Arsinh', 'x'])).code).toMatchInlineSnapshot(
        `asinh(x)`
      );
      expect(wgsl.compile(ce.box(['Artanh', 'x'])).code).toMatchInlineSnapshot(
        `atanh(x)`
      );
    });

    it('should compile reciprocal hyperbolic functions', () => {
      expect(wgsl.compile(ce.box(['Coth', 'x'])).code).toMatchInlineSnapshot(
        `(cosh(x) / sinh(x))`
      );
      expect(wgsl.compile(ce.box(['Csch', 'x'])).code).toMatchInlineSnapshot(
        `(1.0 / sinh(x))`
      );
      expect(wgsl.compile(ce.box(['Sech', 'x'])).code).toMatchInlineSnapshot(
        `(1.0 / cosh(x))`
      );
    });
  });

  describe('Float Literals', () => {
    it('should add .0 to integer literals', () => {
      const expr = ce.parse('x + 5');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`x + 5.0`);
    });

    it('should preserve decimal literals', () => {
      const expr = ce.parse('x * 2.5');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`2.5 * x`);
    });

    it('should handle scientific notation', () => {
      const expr = ce.parse('x * 1.5e10');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`15000000000.0 * x`);
    });
  });

  describe('Constants', () => {
    it('should compile pi', () => {
      const expr = ce.parse('2\\pi');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`2.0 * 3.14159265359`);
    });

    it('should compile e', () => {
      const expr = ce.parse('\\exponentialE');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`2.71828182846`);
    });
  });

  describe('Vectors (WGSL syntax)', () => {
    it('should compile vec2f', () => {
      const expr = ce.box(['List', 1, 2]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec2f(1.0, 2.0)`);
    });

    it('should compile vec3f', () => {
      const expr = ce.box(['List', 1, 2, 3]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec3f(1.0, 2.0, 3.0)`);
    });

    it('should compile vec4f', () => {
      const expr = ce.box(['List', 1, 2, 3, 4]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec4f(1.0, 2.0, 3.0, 4.0)`);
    });

    it('should compile array for 5+ elements', () => {
      const expr = ce.box(['List', 1, 2, 3, 4, 5]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(
        `array<f32, 5>(1.0, 2.0, 3.0, 4.0, 5.0)`
      );
    });

    it('should compile vector addition', () => {
      const expr = ce.box(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(
        `vec3f(1.0, 2.0, 3.0) + vec3f(4.0, 5.0, 6.0)`
      );
    });

    it('should compile vector multiplication', () => {
      const expr = ce.box(['Multiply', ['List', 'x', 'y', 'z'], 2]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`2.0 * vec3f(x, y, z)`);
    });
  });

  describe('Complete Functions (WGSL fn syntax)', () => {
    it('should compile a complete WGSL function', () => {
      const expr = ce.parse('x^2 + y^2');
      const code = wgsl.compileFunction(expr, 'distanceSquared', 'float', [
        ['x', 'float'],
        ['y', 'float'],
      ]);
      expect(code).toMatchInlineSnapshot(`
        fn distanceSquared(x: f32, y: f32) -> f32 {
          return pow(x, 2.0) + pow(y, 2.0);
        }
      `);
    });

    it('should compile a vector function', () => {
      const expr = ce.parse('\\sqrt{x^2 + y^2 + z^2}');
      const code = wgsl.compileFunction(expr, 'vectorLength', 'float', [
        ['x', 'float'],
        ['y', 'float'],
        ['z', 'float'],
      ]);
      expect(code).toMatchInlineSnapshot(`
        fn vectorLength(x: f32, y: f32, z: f32) -> f32 {
          return sqrt(pow(x, 2.0) + pow(y, 2.0) + pow(z, 2.0));
        }
      `);
    });

    it('should map GLSL types to WGSL types', () => {
      const expr = ce.box(['Add', 'x', 'y']);
      const code = wgsl.compileFunction(expr, 'addVec', 'vec3', [
        ['x', 'vec3'],
        ['y', 'vec3'],
      ]);
      expect(code).toContain('fn addVec(x: vec3f, y: vec3f) -> vec3f');
    });
  });

  describe('Shader Generation', () => {
    it('should generate a fragment shader', () => {
      const colorExpr = ce.box(['List', 1, 0, 0, 1]);

      const shader = wgsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'color', type: 'vec4', location: 0 }],
        body: [{ variable: 'output.color', expression: colorExpr }],
      });

      expect(shader).toContain('struct FragmentOutput');
      expect(shader).toContain('@location(0) color: vec4f');
      expect(shader).toContain('@fragment');
      expect(shader).toContain('fn main()');
      expect(shader).toContain('output.color = vec4f(1.0, 0.0, 0.0, 1.0)');
      expect(shader).toContain('return output;');
    });

    it('should generate a vertex shader with uniforms', () => {
      const shader = wgsl.compileShader({
        type: 'vertex',
        inputs: [{ name: 'position', type: 'vec3', location: 0 }],
        outputs: [
          { name: 'position', type: 'vec4', builtin: 'position' },
          { name: 'color', type: 'vec3', location: 0 },
        ],
        uniforms: [
          { name: 'uTime', type: 'float', group: 0, binding: 0 },
        ],
        body: [
          {
            variable: 'output.color',
            expression: ce.box(['List', 1, 0, 0]),
          },
        ],
      });

      expect(shader).toContain('struct VertexInput');
      expect(shader).toContain('@location(0) position: vec3f');
      expect(shader).toContain('struct VertexOutput');
      expect(shader).toContain('@builtin(position) position: vec4f');
      expect(shader).toContain('@location(0) color: vec3f');
      expect(shader).toContain(
        '@group(0) @binding(0) var<uniform> uTime: f32'
      );
      expect(shader).toContain('@vertex');
      expect(shader).toContain('fn main(input: VertexInput) -> VertexOutput');
      expect(shader).toContain('output.color = vec3f(1.0, 0.0, 0.0)');
      expect(shader).toContain('return output;');
    });

    it('should generate a compute shader with workgroup size', () => {
      const shader = wgsl.compileShader({
        type: 'compute',
        workgroupSize: [64],
        body: [],
      });

      expect(shader).toContain('@compute');
      expect(shader).toContain('@workgroup_size(64)');
      expect(shader).toContain('fn main()');
    });
  });

  describe('Registry Integration', () => {
    it('should be available as a registered target', () => {
      const expr = ce.parse('x + y');
      const result = compile(expr, { to: 'wgsl' });
      expect(result.target).toBe('wgsl');
      expect(result.success).toBe(true);
      expect(result.code).toMatchInlineSnapshot(`x + y`);
    });
  });

  describe('Relational and Logical Operators', () => {
    it('should compile comparisons', () => {
      const expr = ce.parse('x > 0.5');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`0.5 < x`);
    });

    it('should compile logical operations', () => {
      const expr = ce.parse('x > 0 \\land y < 1');
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`0.0 < x && y < 1.0`);
    });
  });
});
