import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
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
      expect(code).toMatchInlineSnapshot(`(x * x) + (y * y)`);
    });
  });

  describe('WGSL-Specific Functions', () => {
    it('should compile inverseSqrt (camelCase)', () => {
      const expr = ce.expr(['Inversesqrt', 'x']);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`inverseSqrt(x)`);
    });

    it('should compile mod as a floored helper (interpreter Mod is floored)', () => {
      // WGSL `%` is truncated; the interpreter's Mod is floored (D1), so the
      // target emits `((a % b) + b) % b` to convert truncated → floored.
      const expr = ce.expr(['Mod', 'x', 'y']);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`(((x % y) + y) % y)`);
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

    // Regression (Tycho WebGL2 parity audit): like GLSL, WGSL `pow` is
    // undefined for a negative base. Integer exponents must lower to
    // sign-preserving code, never `pow`.
    describe('integer power sign-correctness (no pow)', () => {
      it('small exponent → repeated multiplication', () => {
        expect(wgsl.compile(ce.parse('x^3')).code).toMatchInlineSnapshot(
          `(x * x * x)`
        );
      });

      it('larger exponent → helper, not pow', () => {
        const r = wgsl.compile(ce.parse('x^{12}'));
        expect(r.code).toMatchInlineSnapshot(`_gpu_powi(x, 12.0)`);
        expect(r.code).not.toContain('pow(');
        expect(r.preamble).toContain('_gpu_powi');
      });

      it('negative integer exponent → reciprocal', () => {
        expect(wgsl.compile(ce.parse('x^{-3}')).code).toMatchInlineSnapshot(
          `(1.0 / (x * x * x))`
        );
      });

      it('compound base → helper (base not duplicated)', () => {
        const r = wgsl.compile(ce.parse('(x+y)^3'));
        expect(r.code).toMatchInlineSnapshot(`_gpu_powi(x + y, 3.0)`);
        expect(r.code).not.toContain('pow(');
      });

      it('fractional exponent still uses pow', () => {
        expect(wgsl.compile(ce.parse('x^{2.5}')).code).toMatchInlineSnapshot(
          `pow(x, 2.5)`
        );
      });
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
      expect(wgsl.compile(ce.expr(['Arcosh', 'x'])).code).toMatchInlineSnapshot(
        `acosh(x)`
      );
      expect(wgsl.compile(ce.expr(['Arsinh', 'x'])).code).toMatchInlineSnapshot(
        `asinh(x)`
      );
      expect(wgsl.compile(ce.expr(['Artanh', 'x'])).code).toMatchInlineSnapshot(
        `atanh(x)`
      );
    });

    it('should compile reciprocal hyperbolic functions', () => {
      expect(wgsl.compile(ce.expr(['Coth', 'x'])).code).toMatchInlineSnapshot(
        `(cosh(x) / sinh(x))`
      );
      expect(wgsl.compile(ce.expr(['Csch', 'x'])).code).toMatchInlineSnapshot(
        `(1.0 / sinh(x))`
      );
      expect(wgsl.compile(ce.expr(['Sech', 'x'])).code).toMatchInlineSnapshot(
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
      const expr = ce.expr(['List', 1, 2]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec2f(1.0, 2.0)`);
    });

    it('should compile vec3f', () => {
      const expr = ce.expr(['List', 1, 2, 3]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec3f(1.0, 2.0, 3.0)`);
    });

    it('should compile vec4f', () => {
      const expr = ce.expr(['List', 1, 2, 3, 4]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`vec4f(1.0, 2.0, 3.0, 4.0)`);
    });

    it('should compile array for 5+ elements', () => {
      const expr = ce.expr(['List', 1, 2, 3, 4, 5]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(
        `array<f32, 5>(1.0, 2.0, 3.0, 4.0, 5.0)`
      );
    });

    it('should compile vector addition', () => {
      const expr = ce.expr(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(
        `vec3f(1.0, 2.0, 3.0) + vec3f(4.0, 5.0, 6.0)`
      );
    });

    it('should compile vector multiplication', () => {
      const expr = ce.expr(['Multiply', ['List', 'x', 'y', 'z'], 2]);
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
          return (x * x) + (y * y);
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
          return sqrt((x * x) + (y * y) + (z * z));
        }
      `);
    });

    it('should map GLSL types to WGSL types', () => {
      const expr = ce.expr(['Add', 'x', 'y']);
      const code = wgsl.compileFunction(expr, 'addVec', 'vec3', [
        ['x', 'vec3'],
        ['y', 'vec3'],
      ]);
      expect(code).toContain('fn addVec(x: vec3f, y: vec3f) -> vec3f');
    });
  });

  describe('Shader Generation', () => {
    it('should generate a fragment shader', () => {
      const colorExpr = ce.expr(['List', 1, 0, 0, 1]);

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
            expression: ce.expr(['List', 1, 0, 0]),
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

  describe('Block Expressions', () => {
    it('should compile a simple block with local variable', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', ['Cos', 't']],
        ['Add', 'a', 1],
      ]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`
        var a: f32;
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
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`
        var a: f32;
        var b: f32;
        a = sin(x);
        b = cos(x);
        return a + b;
      `);
    });

    it('should compile a block function with valid WGSL body', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', ['Cos', 't']],
        ['Add', 'a', 1],
      ]);
      const code = wgsl.compileFunction(expr, 'compute', 'float', [
        ['t', 'float'],
      ]);
      expect(code).toMatchInlineSnapshot(`
        fn compute(t: f32) -> f32 {
          var a: f32;
          a = cos(t);
          return a + 1.0;
        }
      `);
    });

    it('should not use IIFE or let in WGSL blocks', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'tmp'],
        ['Assign', 'tmp', 'x'],
        ['Multiply', 'tmp', 'tmp'],
      ]);
      const code = wgsl.compile(expr).code;
      expect(code).not.toContain('let ');
      expect(code).not.toContain('(() =>');
      expect(code).not.toContain('})()');
      expect(code).toContain('var tmp: f32');
    });

    // Regression: a local bound to an integer-valued literal must declare as
    // `f32`, not `i32` — the assignment is always emitted as a float literal
    // (`r = 3.0;`) and the variable feeds float arithmetic, so an `i32`
    // declaration produces non-compilable WGSL. (GP team bug report.)
    it('should declare an integer-valued local as f32', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'r'],
        ['Assign', 'r', 3],
        ['Add', 'r', ['Multiply', 'x', 'x']],
      ]);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(`
        var r: f32;
        r = 3.0;
        return x * x + r;
      `);
      expect(code).not.toContain('i32');
    });

    it('should declare a float-literal-valued local as f32', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'r'],
        ['Assign', 'r', 3.0],
        ['Add', 'r', ['Multiply', 'x', 'x']],
      ]);
      const code = wgsl.compile(expr).code;
      expect(code).not.toContain('i32');
      expect(code).toContain('var r: f32');
    });

    it('should honor an explicit real-typed Declare as f32', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'r', 'real'],
        ['Assign', 'r', 3],
        ['Add', 'r', ['Multiply', 'x', 'x']],
      ]);
      const code = wgsl.compile(expr).code;
      expect(code).not.toContain('i32');
      expect(code).toContain('var r: f32');
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

  describe('Sum and Product', () => {
    it('should unroll Sum with small constant bounds', () => {
      const expr = ce.expr(['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 3]]);
      const code = wgsl.compile(expr).code;
      expect(code).toBe('((sin(1.0)) + (sin(2.0)) + (sin(3.0)))');
    });

    it('should unroll Product with small constant bounds', () => {
      const expr = ce.expr(['Product', 'i', ['Limits', 'i', 1, 4]]);
      const code = wgsl.compile(expr).code;
      expect(code).toBe('((1.0) * (2.0) * (3.0) * (4.0))');
    });

    it('should return identity for empty Sum range', () => {
      const expr = ce.expr(['Sum', 'i', ['Limits', 'i', 5, 3]]);
      const code = wgsl.compile(expr).code;
      expect(code).toBe('0.0');
    });

    it('should emit for-loop for large Sum range inside compileFunction', () => {
      const expr = ce.expr([
        'Sum',
        ['Sin', 'i'],
        ['Limits', 'i', 1, 1000],
      ]);
      const fn = wgsl.compileFunction(expr, 'sumSin', 'float', []);
      expect(fn).toContain('fn sumSin() -> f32');
      expect(fn).toContain('for (var i: i32 = 1; i <= 1000; i++)');
      expect(fn).toContain('+= sin(f32(i))');
      expect(fn).toContain('return ');
      expect(fn).not.toContain('let ');
      expect(fn).not.toContain('while');
      expect(fn).not.toContain('() =>');
    });

    it('should not contain JS constructs in Sum output', () => {
      const expr = ce.expr(['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 3]]);
      const code = wgsl.compile(expr).code;
      expect(code).not.toContain('let ');
      expect(code).not.toContain('const ');
      expect(code).not.toContain('() =>');
      expect(code).not.toContain('{ re');
    });
  });

  describe('Loop', () => {
    it('should compile Loop as for-loop without IIFE', () => {
      const expr = ce.expr([
        'Loop',
        ['Assign', 'acc', ['Add', 'acc', 'i']],
        ['Element', 'i', ['Range', 1, 5]],
      ]);
      const code = wgsl.compile(expr).code;
      expect(code).toContain('for (var i: i32 = 1; i <= 5; i++)');
      // The i32 loop counter is consumed as a float in float math (CO-P1-2):
      // `f32(i)`, not a bare `i` (which is a WGSL i32/f32 type mismatch).
      expect(code).toContain('acc = acc + f32(i)');
      expect(code).not.toContain('let ');
      expect(code).not.toContain('() =>');
      expect(code).not.toContain('})()');
    });
  });

  describe('Function (Lambda)', () => {
    it('should throw for anonymous functions in WGSL', () => {
      expect(() =>
        wgsl.compile(ce.expr(['Function', ['Add', 'x', 1], 'x']))
      ).toThrow('Anonymous functions (Function) are not supported in GPU');
    });
  });

  describe('Type-Aware Declarations', () => {
    it('should declare complex-typed variable as vec2f', () => {
      const expr = ce.expr([
        'Block',
        ['Declare', 'v'],
        ['Assign', 'v', ['Complex', 1, 2]],
        'v',
      ]);
      const code = wgsl.compile(expr).code;
      expect(code).toContain('var v: vec2f');
    });
  });

  // REVIEW.md E14: Gamma/Erf preambles were GLSL-only (no `_WGSL` variant), so
  // WGSL shaders using them emitted GLSL `float ...` syntax and would not
  // compile. WGSL must get `fn ... -> f32` definitions.
  describe('WGSL special-function preambles (E14)', () => {
    it('emits WGSL fn syntax for the Gamma preamble', () => {
      const r = wgsl.compile(ce.expr(['Gamma', 'x']));
      expect(r.code).toContain('_gpu_gamma(x)');
      expect(r.preamble).toContain('fn _gpu_gamma(z: f32) -> f32');
      expect(r.preamble).not.toContain('float _gpu_gamma');
    });

    it('emits WGSL fn syntax for the Erf preamble', () => {
      const r = wgsl.compile(ce.expr(['Erf', 'x']));
      expect(r.preamble).toContain('fn _gpu_erf(x: f32) -> f32');
      expect(r.preamble).not.toContain('float _gpu_erf');
    });
  });

  // REVIEW.md E15: WGSL has no `?:` ternary and no `NaN` identifier, so the
  // base compiler's default If/Which/When (JS ternary + bare NaN) produced
  // invalid WGSL. These must use `select(...)` and a NaN bit pattern.
  describe('WGSL control flow (E15)', () => {
    it('compiles If to select(...)', () => {
      const e = ce.expr(['If', ['Greater', 'x', 0], 1, ['Negate', 1]]);
      const code = wgsl.compile(e).code;
      expect(code).toContain('select(');
      expect(code).not.toContain('?');
    });

    it('compiles When to select(...) with a valid NaN, never a bare NaN', () => {
      const e = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const code = wgsl.compile(e).code;
      expect(code).toContain('select(');
      expect(code).toContain('bitcast<f32>(0x7fc00000u)');
      expect(/\bNaN\b/.test(code)).toBe(false);
    });

    it('compiles Which to nested select(...)', () => {
      const e = ce.expr([
        'Which',
        ['Greater', 'x', 0],
        1,
        'True',
        ['Negate', 1],
      ]);
      const code = wgsl.compile(e).code;
      expect(code).toContain('select(');
      expect(code).not.toContain('?');
    });
  });

  // CO-P1-2: WGSL has no ternary. The real-valued `Argument` branch emitted
  // `(x >= 0.0 ? 0.0 : π)`, which is invalid WGSL — it must use `select(...)`.
  describe('CO-P1-2 Argument uses select, never a ternary', () => {
    it('compiles Argument of a real value to select(...)', () => {
      const code = wgsl.compile(ce.box(['Argument', 'x'])).code;
      expect(code).toBe('select(3.14159265359, 0.0, x >= 0.0)');
      expect(code).not.toContain('?');
    });
  });

  // CO-P1-2: `min`/`max` are 2-argument builtins in WGSL.
  describe('CO-P1-2 min/max variadic folding', () => {
    it('folds 3-arg Max into nested max()', () => {
      const code = wgsl.compile(ce.box(['Max', 'a', 'b', 'c'])).code;
      expect(code).toBe('max(max(a, b), c)');
    });

    it('folds 4-arg Min into nested min()', () => {
      const code = wgsl.compile(ce.box(['Min', 'a', 'b', 'c', 'd'])).code;
      expect(code).toBe('min(min(min(a, b), c), d)');
    });
  });

  // CO-P1-2: a loop-form Sum is a bare statement block — fail closed rather
  // than splice it mid-expression.
  describe('CO-P1-2 loop-form Sum cannot be spliced (D6)', () => {
    const bigSum = ['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 1000]];

    it('fails closed when a loop-form Sum is used mid-expression', () => {
      expect(() => wgsl.compile(ce.box(['Add', bigSum, 1]))).toThrow(
        /multi-statement construct.*sub-expression/
      );
    });

    it('still compiles a loop-form Sum as a top-level function body', () => {
      const fn = wgsl.compileFunction(ce.box(bigSum), 'sumSin', 'float', []);
      expect(fn).toContain('for (var i: i32 = 1; i <= 1000; i++)');
      expect(fn).toContain('sin(f32(i))');
    });
  });

  // CO-P2-23a / 23b: negative-index Sum unroll must not emit `--`, and a user
  // variable named after a WGSL reserved word fails closed (D6).
  describe('CO-P2-23 emission fixes', () => {
    it('negative-index Sum unroll spaces the negation (no `--`)', () => {
      const code = wgsl.compile(
        ce.box(['Sum', ['Negate', 'i'], ['Tuple', 'i', -3, 3]])
      ).code;
      expect(code).not.toContain('--');
      expect(code).toContain('- -3.0');
    });
    for (const kw of ['sample', 'filter', 'texture', 'let', 'var', 'f32']) {
      it(`rejects reserved word "${kw}" as a variable`, () => {
        expect(() => wgsl.compile(ce.box(['Add', kw, 1])).code).toThrow(
          /reserved word/
        );
      });
    }
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
      expect(() => wgsl.compile(expr).code).toThrow(/final statement of a block/);
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
      const code = wgsl.compile(expr).code;
      expect(code).toContain('for (var a: i32 = 1; a <= 5; a++)');
      expect(code).toContain('return s;');
      expect(code).not.toMatch(/return for/);
    });
  });
});
