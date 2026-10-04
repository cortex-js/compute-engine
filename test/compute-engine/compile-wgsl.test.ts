import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off for the emissions this suite pins.
 * A subtree with no free variables is normally evaluated at compile time and
 * emitted as one literal, which erases the codegen under test here: the
 * unrolled/looped `Sum` and `Product` shapes, the operand lowerings, and the
 * fail-closed diagnostics that only the structural path reaches.
 */
const NO_FOLD = { constantFold: false } as const;

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
      // target emits `(r - b * floor(r / b)) % b` with `r = a % b` to convert
      // truncated → floored.
      const expr = ce.expr(['Mod', 'x', 'y']);
      const code = wgsl.compile(expr).code;
      expect(code).toMatchInlineSnapshot(
        `((((x) % (y)) - (y) * floor(((x) % (y)) / (y))) % (y))`
      );
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
        expect(r.code).toMatchInlineSnapshot(`_gpu_pow3(x + y)`);
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
      // A local engine: these pins are the REAL lowerings of an operand of
      // unknown kind. The shared engine's `x` is inferred `real` by the
      // `Mod(x, y)` emission above (the carrier of `Mod`), and `Arcosh` /
      // `Artanh` of a proven real take the complex helper (both are complex
      // on parts of the real line: `arcosh(0.5)`, `artanh(2)`).
      const local = new ComputeEngine();
      expect(
        wgsl.compile(local.expr(['Arcosh', 'x'])).code
      ).toMatchInlineSnapshot(`acosh(x)`);
      expect(
        wgsl.compile(local.expr(['Arsinh', 'x'])).code
      ).toMatchInlineSnapshot(`asinh(x)`);
      expect(
        wgsl.compile(local.expr(['Artanh', 'x'])).code
      ).toMatchInlineSnapshot(`atanh(x)`);
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
      const code = wgsl.compile(expr, NO_FOLD).code;
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
      // `constantFold: false`: both operands are literal vectors, so the sum
      // would otherwise be folded to the single literal `vec3f(5.0, 7.0, 9.0)`
      // — this test pins the vector-addition lowering, not the fold.
      const code = wgsl.compile(expr, { constantFold: false }).code;
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
        uniforms: [{ name: 'uTime', type: 'float', group: 0, binding: 0 }],
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
      expect(shader).toContain('@group(0) @binding(0) var<uniform> uTime: f32');
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
      const code = wgsl.compile(expr, NO_FOLD).code;
      expect(code).toBe('((sin(1.0)) + (sin(2.0)) + (sin(3.0)))');
    });

    it('should unroll Product with small constant bounds', () => {
      const expr = ce.expr(['Product', 'i', ['Limits', 'i', 1, 4]]);
      const code = wgsl.compile(expr, NO_FOLD).code;
      expect(code).toBe('((1.0) * (2.0) * (3.0) * (4.0))');
    });

    it('should return identity for empty Sum range', () => {
      const expr = ce.expr(['Sum', 'i', ['Limits', 'i', 5, 3]]);
      const code = wgsl.compile(expr).code;
      expect(code).toBe('0.0');
    });

    it('should emit for-loop for large Sum range inside compileFunction', () => {
      const expr = ce.expr(['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 1000]]);
      const fn = wgsl.compileFunction(expr, 'sumSin', 'float', [], {
        constantFold: false,
      });
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

    it('a collection-valued Sum body fails closed', () => {
      // `Σ h(i)·(1/1.4^i)·a(…)` where `a` returns a vector — the interpreter's
      // elementwise zip-broadcast Sum. Scalar accumulation over arrays would
      // silently produce a wrong value, so it must throw (mirrors JS/base gate).
      const e = new ComputeEngine();
      e.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
      e.parse(
        'h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)'
      ).evaluate();
      const expr = e.parse(
        '\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))'
      );
      expect(() => wgsl.compile(expr)).toThrow(/collection-valued body/s);
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

    // `Binomial`/`Choose` unroll to the falling factorial n(n-1)…/k! — pure
    // arithmetic, so the WGSL emission is byte-identical to the GLSL one
    // (pinned with its numeric parity in compile-glsl.test.ts) and needs no
    // preamble helper.
    it('unrolls Binomial/Choose with no preamble helper', () => {
      const r = wgsl.compile(ce.expr(['Binomial', 'x', 3]));
      expect(r.code).toBe('(((x) * ((x) - 1.0) * ((x) - 2.0)) / 6.0)');
      expect(r.preamble ?? '').not.toContain('binomial');
      expect(wgsl.compile(ce.expr(['Choose', 'x', 2])).code).toBe(
        '(((x) * ((x) - 1.0)) / 2.0)'
      );
      expect(wgsl.compile(ce.expr(['Binomial', 'x', 1])).code).toBe('x');
      expect(wgsl.compile(ce.expr(['Binomial', 'x', 0])).code).toBe('1.0');
      expect(() => wgsl.compile(ce.expr(['Binomial', 'x', -1]))).toThrow(
        /Could not compile/
      );
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
      expect(code).toContain('_gpu_nan()');
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
  // Tycho item 110 — same hoisting contract as GLSL.
  describe('loop-form Sum composes by hoisting (Tycho item 110)', () => {
    const bigSum = ['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 1000]];

    it('hoists the loop when a loop-form Sum is used mid-expression', () => {
      const code = wgsl.compile(ce.box(['Add', bigSum, 1]), NO_FOLD).code;
      expect(code).toContain('for (var i: i32 = 1; i <= 1000; i++)');
      const acc = /var (_\w+): f32 = 0\.0;/.exec(code)?.[1];
      expect(acc).toBeDefined();
      expect(code.trimEnd().endsWith(`return ${acc} + 1.0;`)).toBe(true);
    });

    // Same statement form as GLSL — see the note there. WGSL's `select` is a
    // function (both operands evaluated), so the `if` statement is what keeps
    // the loop inside its branch here.
    it('a conditionally-evaluated branch with a loop takes the statement form', () => {
      const code = wgsl.compile(
        ce.box(['If', ['Greater', 'x', 0], bigSum, 0] as any),
        NO_FOLD
      ).code;
      expect(code).toMatch(/^var _tv\d+: f32;\nif \(0\.0 < x\) \{\n  var/);
      expect(code).toContain('for (var i: i32 = 1; i <= 1000; i++)');
      expect(code.indexOf('for (')).toBeLessThan(code.indexOf('} else {'));
      expect(code).toMatch(/return _tv\d+;$/);
    });

    it('still compiles a loop-form Sum as a top-level function body', () => {
      const fn = wgsl.compileFunction(ce.box(bigSum), 'sumSin', 'float', [], {
        constantFold: false,
      });
      expect(fn).toContain('for (var i: i32 = 1; i <= 1000; i++)');
      expect(fn).toContain('sin(f32(i))');
    });
  });

  // CO-P2-23a / 23b: negative-index Sum unroll must not emit `--`, and a user
  // variable named after a WGSL reserved word fails closed.
  describe('CO-P2-23 emission fixes', () => {
    it('negative-index Sum unroll spaces the negation (no `--`)', () => {
      const code = wgsl.compile(
        ce.box(['Sum', ['Negate', 'i'], ['Tuple', 'i', -3, 3]]),
        NO_FOLD
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
    // A `vars` mapping to a bare identifier gets the free symbol's check
    // (Tycho row 356).
    it('rejects a vars mapping to a reserved bare identifier', () => {
      expect(() =>
        wgsl.compile(ce.box(['Add', 'x', 'q']), { vars: { q: 'loop' } })
      ).toThrow(/"loop" is a reserved word in wgsl/);
      expect(
        wgsl.compile(ce.box(['Add', 'x', 'q']), { vars: { q: 'u_loop' } }).code
      ).toBe('u_loop + x');
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
      expect(() => wgsl.compile(expr).code).toThrow(
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
      const code = wgsl.compile(expr).code;
      expect(code).toContain('for (var a: i32 = 1; a <= 5; a++)');
      expect(code).toContain('return s;');
      expect(code).not.toMatch(/return for/);
    });
  });
});

// WGSL side of Tycho item 49: `select` requires both operands to share one
// type, so a tuple-valued `When` body needs a vec2f NaN, not a scalar bitcast.
describe('WGSL When NaN branch matches the value shape (Tycho item 49)', () => {
  it('restricted parametric tuple body emits a vec2f NaN branch', () => {
    const code = wgsl.compile(
      ce.box([
        'When',
        ['Tuple', ['Cos', 't'], ['Sin', 't']],
        ['And', ['LessEqual', 0, 't'], ['LessEqual', 't', 1]],
      ])
    ).code;
    expect(code).toContain('vec2f(cos(t), sin(t))');
    expect(code).toContain('vec2f(_gpu_nan())');
  });

  it('scalar bodies keep the scalar NaN bit pattern', () => {
    const code = wgsl.compile(
      ce.box(['When', ['Cos', 't'], ['LessEqual', 't', 1]])
    ).code;
    expect(code).toContain('_gpu_nan()');
    expect(code).not.toContain('vec2f(bitcast');
  });
});

// Mirrors the GLSL regressions: a vector-valued block local declares a vecNf,
// and a `vecNf` constructor takes scalar components only.
describe('WGSL vector locals and vecNf constructor arity', () => {
  it('a local assigned a 2-tuple is declared vec2f', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', ['Cos', 't'], ['Sin', 't']]],
      'p',
    ]);
    const code = wgsl.compile(expr).code;
    expect(code).toContain('var p: vec2f');
    expect(code).not.toContain('var p: f32');
  });

  it('a tuple with a complex component fails closed', () => {
    const expr = ce.box(['Tuple', 't', ['Multiply', 'ImaginaryUnit', 't']]);
    expect(() => wgsl.compile(expr)).toThrow(/Could not compile/);
  });

  // Defect A: a width with no `vecNf` still lowers to `array<f32, N>(…)`, so
  // the declaration must be that array type, not `f32`.
  it('a local assigned a 5-tuple is declared as the matching array type', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 1, 2, 3, 4, 5]],
      'p',
    ]);
    const code = wgsl.compile(expr).code;
    expect(code).toContain('var p: array<f32, 5>');
    expect(code).not.toContain('var p: f32');
    expect(code).toContain('p = array<f32, 5>(');
  });

  // Defect B: aggregate elements outside widths 2–4 bypassed the guard.
  it('a 1-element list component fails closed', () => {
    expect(() => wgsl.compile(ce.box(['Tuple', ['List', 1], 2]))).toThrow(
      /Could not compile/
    );
  });

  it('a 5-element list component fails closed', () => {
    expect(() =>
      wgsl.compile(ce.box(['Tuple', ['List', 1, 2, 3, 4, 5], 2]))
    ).toThrow(/Could not compile/);
  });

  // Defect C: the width must propagate through a local reference.
  it('a local aliasing a vector local inherits its width', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      ['Declare', 'q'],
      ['Assign', 'q', 'p'],
      'q',
    ]);
    const code = wgsl.compile(expr, { vars: { x: 'x', y: 'y' } }).code;
    expect(code).toContain('var p: vec2f');
    expect(code).toContain('var q: vec2f');
    expect(code).not.toContain('var q: f32');
  });
});

// A shader local has ONE declared type, so every binding of it in a block must
// agree on a shape. "First assignment wins" reached the very "declared `f32`,
// assigned `vec2f`" mismatch the width inference exists to prevent, by
// intra-block reassignment instead of aliasing.
describe('WGSL block local with disagreeing binding shapes fails closed', () => {
  it('scalar then vector fails closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Cos', 't']],
      ['Assign', 'p', ['Tuple', 'x', 'y']],
      'p',
    ]);
    expect(() => wgsl.compile(expr, { vars: { x: 'x', y: 'y' } })).toThrow(
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
    expect(() => wgsl.compile(expr, { vars: { x: 'x', y: 'y' } })).toThrow(
      /disagreeing shapes.*2-component aggregate, then scalar/s
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
    const code = wgsl.compile(expr, { vars: { x: 'x', y: 'y' } }).code;
    expect(code).toContain('var p: vec2f');
    expect(code).toContain('p = vec2f(cos(t), sin(t));');
  });
});

// A `Matrix` has no single component count, so it was reported `undefined` —
// which every caller reads as "scalar" — and `vec2f(mat2x2f(…), 1.0)` was
// emitted.
describe('WGSL matrix-valued components are aggregates, not scalars', () => {
  it('a matrix component of a tuple fails closed', () => {
    const expr = ce.box([
      'Tuple',
      ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]],
      1,
    ]);
    expect(() => wgsl.compile(expr)).toThrow(/matrix\/tensor value/);
  });

  it('a block local bound to a matrix fails closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]]],
      'p',
    ]);
    expect(() => wgsl.compile(expr)).toThrow(/matrix\/tensor-valued local/);
  });
});

// Width 0 is a real observed width, not the scalar sentinel: an empty
// tuple/list lowered to `array<f32, 0>()`, which WGSL has no type for.
describe('WGSL zero-width aggregates fail closed', () => {
  it('an empty Tuple fails closed instead of emitting array<f32, 0>()', () => {
    expect(() => wgsl.compile(ce.box(['Tuple']))).toThrow(
      /empty tuple\/list has no GPU lowering/
    );
  });

  it('a block local bound to an empty tuple fails closed', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple']],
      'p',
    ]);
    expect(() => wgsl.compile(expr)).toThrow(
      /the block local `p`: an empty tuple\/list/
    );
  });
});

// Regression: the floored-modulo template splices its divisor THREE times.
// With an impure (Random) divisor that emitted three `_gpu_rnd_draw` calls —
// a wrong value that also shifted every later draw in the shader. The operand
// must be bound to a hoisted temporary and drawn exactly once.
describe('WGSL Mod with an impure operand draws once', () => {
  it('a framed Random divisor emits a single draw', () => {
    const target = ce._getCompilationTarget('wgsl')!;
    const code = target.compile(
      ce.box(['WithRandomSeed', 7, ['Mod', 10, ['Random']]]),
      NO_FOLD
    ).code;
    expect((code.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
  });

  it('a pure Mod emission is unchanged', () => {
    const target = ce._getCompilationTarget('wgsl')!;
    const code = target.compile(ce.box(['Mod', ['Add', 'x', 29], 900])).code;
    expect(code).toBe(
      '((((x + 29.0) % (900.0)) - (900.0) * floor(((x + 29.0) % (900.0)) / (900.0))) % (900.0))'
    );
  });
});

// WGSL has no ternary operator: `ContrastingColor` emitted `cond ? a : b` in
// BOTH its forms, which is invalid WGSL source (the shader failed to compile
// downstream, with `success: true` here). It must use `select(...)`, like
// every other conditional emission in this target.
describe('WGSL ContrastingColor uses select, never a ternary', () => {
  it('compiles the 1-argument (black/white) form to select(...)', () => {
    const code = wgsl.compile(
      ce.box(['ContrastingColor', ['Tuple', 1, 1, 1]])
    ).code;
    // The choice is the one the interpreter makes: the candidate with the
    // larger absolute APCA contrast against the background wins, and the
    // candidate is the FIRST argument of the contrast. An earlier emission
    // compared against a fixed 50 threshold, on a contrast scale 100 times
    // the interpreter's.
    // The background is written as a tuple, which is 0-1 sRGB on every route
    // and so reaches the contrast through `_gpu_srgb_to_oklch`. The two
    // candidates are literal OKLCh constants and need no conversion.
    expect(code).toBe(
      'select(vec3f(0.0), vec3f(1.0, 0.0, 0.0), ' +
        'abs(_gpu_apca(vec3f(1.0, 0.0, 0.0), ' +
        '_gpu_srgb_to_oklch(vec3f(1.0, 1.0, 1.0)))) >= ' +
        'abs(_gpu_apca(vec3f(0.0), ' +
        '_gpu_srgb_to_oklch(vec3f(1.0, 1.0, 1.0)))))'
    );
    expect(code).not.toContain('?');
  });

  it('compiles the 3-argument form to select(...)', () => {
    const code = wgsl.compile(
      ce.box([
        'ContrastingColor',
        ['Tuple', 1, 1, 1],
        ['Tuple', 0, 0, 0],
        ['Tuple', 0.5, 0.1, 30],
      ])
    ).code;
    // Each foreground candidate is the FIRST argument of its contrast, the
    // background the second — the argument order the interpreter uses. APCA
    // is not symmetric in its two arguments, so the reversed order this
    // emission used before chose the other candidate for some backgrounds.
    // All three operands are tuples, so all three are 0-1 sRGB and reach the
    // contrast through `_gpu_srgb_to_oklch` — including the two candidates,
    // which are also the value the selection answers.
    expect(code).toBe(
      'select(_gpu_srgb_to_oklch(vec3f(0.5, 0.1, 30.0)), ' +
        '_gpu_srgb_to_oklch(vec3f(0.0, 0.0, 0.0)), ' +
        'abs(_gpu_apca(_gpu_srgb_to_oklch(vec3f(0.0, 0.0, 0.0)), ' +
        '_gpu_srgb_to_oklch(vec3f(1.0, 1.0, 1.0)))) >= ' +
        'abs(_gpu_apca(_gpu_srgb_to_oklch(vec3f(0.5, 0.1, 30.0)), ' +
        '_gpu_srgb_to_oklch(vec3f(1.0, 1.0, 1.0)))))'
    );
    expect(code).not.toContain('?');
  });
});

// A shader has no function values. The parse of `f'(x)` is
// `Apply(Derivative(f, 1), x)`, so the target substitutes the argument into
// the closed form of the derivative. A `Map` has no lowering either: one over
// a list whose width is known at compile time is written out element by
// element, before the target sees it.
describe('WGSL APPLIED DERIVATIVE AND MAP', () => {
  const ce = new ComputeEngine();
  ce.parse('h(x) := x^3 + \\sin x').evaluate();
  ce.parse("f := t \\mapsto h'(t)").evaluate();
  ce.declare('L', 'list<real>');

  it('compiles the prime of a library function from its closed form', () => {
    expect(wgsl.compile(ce.parse("\\sin'(t)")).code).toBe('cos(t)');
  });

  it('compiles a function whose body is the prime of a user function', () => {
    const result = wgsl.compile(ce.parse('f(x)'));
    expect(result.code).toBe('_fn_f(x)');
    expect(result.preamble).toContain(
      'fn _fn_f(t: f32) -> f32 {\n  return 3.0 * (t * t) + cos(t);\n}'
    );
  });

  it('declines a derivative with no closed form', () => {
    expect(() => wgsl.compile(ce.parse("g'(t)"))).toThrow(
      /Could not compile `Apply`: the derivative has no closed form/
    );
    expect(() =>
      wgsl.compile(ce.box(['Apply', ['Derivative', 'BesselJ', 1, 0], 'n', 'x']))
    ).toThrow(/Could not compile `Apply`: the derivative has no closed form/);
  });

  it('compiles a partial derivative of a function of two arguments', () => {
    const code = (f: string, k1: number, k2: number) =>
      wgsl.compile(ce.box(['Apply', ['Derivative', f, k1, k2], 'x', 'y'])).code;
    expect(code('Power', 1, 0)).toBe('y * pow(x, y + -1.0)');
    expect(code('Power', 0, 1)).toBe('log(x) * pow(x, y)');
    expect(code('Arctan2', 1, 0)).toBe('y / ((x * x) + (y * y))');
    expect(code('Arctan2', 0, 1)).toBe('-x / ((x * x) + (y * y))');
    expect(code('Mod', 0, 1)).toBe('-floor(x / y)');
  });

  const SQUARE = ['Function', ['Square', 'k'], 'k'];
  const SOURCE = ['Add', 'x', ['List', 0, 4, 2]];

  it('writes out a Map of static width under a reduction', () => {
    expect(wgsl.compile(ce.box(['Min', ['Map', SQUARE, SOURCE]])).code).toBe(
      'min(min((x * x), _gpu_pow2(x + 4.0)), _gpu_pow2(x + 2.0))'
    );
  });

  it('writes out a narrow Map as a vector value', () => {
    expect(wgsl.compile(ce.box(['Map', SQUARE, SOURCE])).code).toBe(
      'vec3f((x * x), _gpu_pow2(x + 4.0), _gpu_pow2(x + 2.0))'
    );
  });

  it('declines a Map over a list of unknown length', () => {
    expect(() => wgsl.compile(ce.box(['Min', ['Map', SQUARE, 'L']]))).toThrow(
      /Could not compile `Map`/
    );
  });

  // A function literal with a scalar parameter applies to each element of a
  // list argument, as in the interpreter: `Apply(u ↦ 7, [a, b])` is
  // `[7, 7]`, not `7`.
  const CONSTANT = ['Function', 7, ['Typed', 'u', 'real']];
  const DOUBLE = ['Function', ['Multiply', 2, 'u'], ['Typed', 'u', 'real']];

  it('applies a constant body to each element of a list argument', () => {
    const expr = ce.box(['Apply', CONSTANT, ['List', 'a', 'b']]);
    expect(expr.evaluate().toString()).toBe('[7,7]');
    expect(wgsl.compile(expr, NO_FOLD).code).toBe('vec2f(7.0, 7.0)');
  });

  it('applies a body that reads the parameter to each element', () => {
    expect(
      wgsl.compile(ce.box(['Apply', DOUBLE, ['List', 'a', 'b']]), NO_FOLD).code
    ).toBe('vec2f(2.0 * a, 2.0 * b)');
  });

  it('applies the prime of a function to each element', () => {
    const expr = ce.box([
      'Apply',
      ['Derivative', 'Sin', 1],
      ['List', 'a', 'b'],
    ]);
    expect(expr.evaluate().toString()).toBe('[cos(a),cos(b)]');
    expect(wgsl.compile(expr, NO_FOLD).code).toBe('vec2f(cos(a), cos(b))');
  });

  it('substitutes a scalar argument whole', () => {
    expect(wgsl.compile(ce.box(['Apply', DOUBLE, 'a']), NO_FOLD).code).toBe(
      '2.0 * a'
    );
  });

  it('declines a list argument with no static length', () => {
    expect(() => wgsl.compile(ce.box(['Apply', CONSTANT, 'L']))).toThrow(
      /Could not compile `Apply`: the function applies to each element/
    );
  });

  // A parameter declared as a scalar (a number or a boolean) maps over a
  // tuple argument, in the interpreter (`Apply((u: real) ↦ 2u, (a, b))` is `(2a, 2b)`, user
  // decision 2026-10-03) and in the shader: the result is a vector of the
  // values at each component. An argument that does not match the declared
  // type of its parameter is declined, as the interpreter gives an
  // `incompatible-type` error for it.
  it('maps a tuple at a parameter declared as a scalar (a number or a boolean)', () => {
    ce.declare('P', 'tuple<real, real>');
    ce.declare('V', 'list<real^2>');
    const tuple = ce.box(['Apply', DOUBLE, ['Tuple', 'a', 'b']]);
    expect(tuple.evaluate().toString()).toBe('(2a, 2b)');
    expect(wgsl.compile(tuple, NO_FOLD).code).toBe('vec2f(2.0 * a, 2.0 * b)');
    expect(wgsl.compile(ce.box(['Apply', DOUBLE, 'P']), NO_FOLD).code).toBe(
      'vec2f(2.0 * P.x, 2.0 * P.y)'
    );
    // A list of tuples maps over the list, then over each tuple.
    expect(
      wgsl.compile(
        ce.box(['Apply', DOUBLE, ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]])
      ).code
    ).toBe('array<vec2f, 2>(vec2f(2.0, 4.0), vec2f(6.0, 8.0))');
    // A tuple with a list component is data, not a point: an error in the
    // interpreter, declined here.
    expect(() =>
      wgsl.compile(
        ce.box([
          'Apply',
          DOUBLE,
          ['Tuple', ['List', 1, 2], ['List', 3, 4]],
        ])
      )
    ).toThrow(/has a component that is a collection/);
    // A vector argument is bound whole when another parameter is a
    // collection, so the literal does not map. The mismatch is certain, so
    // the call is refused when it is boxed, as a call of a named function
    // is, and the expression is invalid.
    const whole = [
      'Function',
      ['Add', 'u', ['Length', 'w']],
      ['Typed', 'u', 'real'],
      ['Typed', 'w', 'list<real>'],
    ];
    expect(() => wgsl.compile(ce.box(['Apply', whole, 'V', 'V']))).toThrow(
      /invalid expression.*incompatible-type.*vector<real\^2>/
    );
    // A parameter with no declared type accepts the tuple, as in the
    // interpreter.
    expect(
      wgsl.compile(
        ce.box([
          'Apply',
          ['Function', ['Multiply', 2, 'u'], 'u'],
          ['Tuple', 'a', 'b'],
        ]),
        NO_FOLD
      ).code
    ).toBe('2.0 * vec2f(a, b)');
  });
});

describe('WGSL - NORM OF A POINT WITH A LIST COMPONENT', () => {
  // `|(x + [1/2, 1], y)|` is one point per element of the list component, so
  // its norm is one number per element. It compiles as the explicit
  // `√(Σ cᵢ²)`, the same code as the norm written by hand.
  const ceN = new ComputeEngine();
  const code = (latex: string) => {
    const r = wgsl.compile(ceN.parse(latex), { fallback: false });
    expect(r.success).toBe(true);
    return r.code;
  };

  it('a list in the first component is the written norm', () => {
    expect(
      code('\\left|\\left(x+\\left[\\frac{1}{2},1\\right],y\\right)\\right|')
    ).toBe('sqrt(_gpu_pow2_v2(x + vec2f(0.5, 1.0)) + (y * y))');
    expect(code('\\sqrt{(x+[1/2,1])^2+y^2}')).toBe(
      'sqrt(_gpu_pow2_v2(x + vec2f(0.5, 1.0)) + (y * y))'
    );
  });

  it('a list in the second component', () => {
    expect(code('\\left|\\left(x,y+[1,2]\\right)\\right|')).toBe(
      'sqrt((x * x) + _gpu_pow2_v2(y + vec2f(1.0, 2.0)))'
    );
  });

  it('two lists of the same length', () => {
    expect(code('\\left|\\left(x+[1,2],y+[3,4]\\right)\\right|')).toBe(
      'sqrt(_gpu_pow2_v2(x + vec2f(1.0, 2.0)) + _gpu_pow2_v2(y + vec2f(3.0, 4.0)))'
    );
  });

  it('a point with three components', () => {
    expect(code('\\left|\\left(x+[1,2],y,z\\right)\\right|')).toBe(
      'sqrt(_gpu_pow2_v2(x + vec2f(1.0, 2.0)) + (y * y) + (z * z))'
    );
  });

  it('a point of scalars keeps length()', () => {
    expect(code('\\left|\\left(x,y\\right)\\right|')).toBe(
      'length(vec2f(x, y))'
    );
  });

  it('lists of different lengths decline', () => {
    expect(() =>
      wgsl.compile(
        ceN.parse('\\left|\\left(x+[1,2],y+[3,4,5]\\right)\\right|'),
        { fallback: false }
      )
    ).toThrow('different lengths (2 and 3)');
  });
});

// A structural `Square` of a vector is a broadcast of the head over the
// vector. It uses the `vecN` helper, as the canonical form `Power(c, 2)`
// does. It used to decline because the scalar helper `_gpu_pow2` was
// chosen for the vector.
describe('WGSL - SQUARE OF A VECTOR', () => {
  const ce = new ComputeEngine();
  ce.declare('V', 'list<real^2>');
  const square = (arg: unknown) =>
    ce.function('Square', [ce.box(arg as never)], { form: 'structural' });

  it('uses the vector helper for a vector literal', () => {
    expect(wgsl.compile(square(['List', 1, 'x'])).code).toBe(
      '_gpu_pow2_v2(vec2f(1.0, x))'
    );
    expect(wgsl.compile(ce.box(['Power', ['List', 1, 'x'], 2])).code).toBe(
      '_gpu_pow2_v2(vec2f(1.0, x))'
    );
    expect(wgsl.compile(square(['List', 'y', 'x', 'z'])).code).toBe(
      '_gpu_pow2_v3(vec3f(y, x, z))'
    );
  });

  it('multiplies a vector symbol by itself', () => {
    expect(wgsl.compile(square('V')).code).toBe('(V * V)');
  });

  // A list of more than four elements has no vector type. It is written as
  // an array, one square per element, on GLSL as on WGSL.
  it('writes a list of more than four elements as an array', () => {
    const list = ['List', 1, 2, 3, 4, 'x'];
    const expected = 'array<f32, 5>(1.0, 4.0, 9.0, 16.0, (x * x))';
    expect(wgsl.compile(square(list)).code).toBe(expected);
    expect(wgsl.compile(ce.box(['Power', list, 2] as never)).code).toBe(
      expected
    );
  });
});
