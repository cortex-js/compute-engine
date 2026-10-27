import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';
import { inlineSharedUserFunctionCalls } from '../../src/compute-engine/compilation/gpu-shared-calls';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * On the shader targets, a pure user-function call that several shader
 * functions would repeat with the same arguments is computed once per
 * invocation (`compilation/gpu-shared-calls.ts`, ROADMAP CE-525).
 *
 * Each user function used to be emitted as a shader function of its own,
 * and the common-subexpression pass works inside one body, so `B` and `H`
 * both calling `F(x, y)` computed `F(x, y)` in each. The Metal compiler
 * under WebGPU does not merge identical calls across functions, and the
 * `voronoi-diagram` row of Tycho drew 2.17 times slower on WebGPU than on
 * WebGL. The root compilation now substitutes such bodies, so the shared
 * calls become one temporary each.
 *
 * Every test builds its OWN engine: these tests assign symbols.
 */

const TARGETS = ['glsl', 'wgsl'] as const;

/** The definitions of Tycho's `voronoi-diagram` document (the weight
 * function `n` is named `w` here). */
const VORONOI = [
  'p(k) := 1.45\\sqrt{\\frac{k - 0.5}{16}}\\cos(2.4k) + 0.14\\cos(T + 1.9k)',
  'q(k) := 0.95\\sqrt{\\frac{k - 0.5}{16}}\\sin(2.4k) + 0.1\\sin(2T + 2.7k)',
  'D(x, y, k) := (x - p(k))^2 + (y - q(k))^2',
  'F(x, y) := \\min\\left(\\left[D(x, y, k) \\operatorname{for} k = \\left[1...16\\right]\\right]\\right)',
  'w(x, y, k) := e^{-5000(D(x, y, k) - F(x, y))}',
  'Z(x, y) := \\sum_{k=1}^{16} w(x, y, k)',
  'u(x, y) := \\frac{1}{Z(x, y)} \\sum_{k=1}^{16} p(k) w(x, y, k)',
  'v(x, y) := \\frac{1}{Z(x, y)} \\sum_{k=1}^{16} q(k) w(x, y, k)',
  'H(x, y) := \\frac{1}{Z(x, y)} \\sum_{k=1}^{16} \\operatorname{mod}(0.567k, 1) w(x, y, k)',
  'B(x, y) := \\sum_{k=1}^{16} \\exp\\left(-\\frac{D(x, y, k) - F(x, y)}{0.015\\sqrt{(p(k) - u(x, y))^2 + (q(k) - v(x, y))^2 + 0.0004}}\\right)',
];

const VORONOI_ROW =
  '\\left\\{F(x, y) < 0.0008: 0, B(x, y) > 1.3: 0, 0.12 + 0.8H(x, y)\\right\\}';

function voronoiEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('T', 'real');
  for (const d of VORONOI) ce.parse(d).evaluate();
  return ce;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * The number of calls of `name`, in the guarded spelling (`_gpu_sin(`) or the
 * built-in one (`sin(`): a target emits the built-in when the operand is
 * finite for certain, and the guarded helper otherwise.
 */
function countCalls(text: string, name: string): number {
  return (text.match(new RegExp(`\\b(?:_gpu_)?${name}\\(`, 'g')) ?? []).length;
}

/** The emitted root code as one shader function `_main` of `params`. */
function mainFunction(
  code: string,
  params: string[],
  language: 'glsl' | 'wgsl'
): string {
  const body = /\breturn\b/.test(code) ? code : `return ${code};`;
  return language === 'glsl'
    ? `float _main(${params.map((p) => `float ${p}`).join(', ')}) {\n${body}\n}`
    : `fn _main(${params.map((p) => `${p}: f32`).join(', ')}) -> f32 {\n${body}\n}`;
}

describe('the voronoi-diagram row (Tycho row 467)', () => {
  for (const language of TARGETS) {
    test(`${language}: each shared call is computed once`, () => {
      const ce = voronoiEngine();
      const r = compile(ce.parse(VORONOI_ROW), { to: language });
      expect(r.success).toBe(true);
      const all = `${r.preamble ?? ''}\n${r.code}`;
      // No document function is emitted: their bodies are in the root.
      expect(all).not.toMatch(/_fn_/);
      // The sixteen weights e^{−5000(D − F)} (shared by Z, u, v and H) and
      // the sixteen terms of B: 32. By reference, F was computed 8 times and
      // the weights 96 times, which made 112 exponentials.
      expect(count(r.code, 'exp(')).toBe(32);
      // The site positions: one sine and one cosine for each of the 16
      // sites, in p(k) and q(k), 32 each. By reference there were 544.
      expect(countCalls(r.code, 'sin')).toBe(32);
      expect(countCalls(r.code, 'cos')).toBe(32);
      // F is the minimum of 16 squared distances, computed once.
      expect(countCalls(r.code, 'min')).toBe(15);
      // The counts read the root code only: the preamble holds the
      // definitions of the helpers (`_gpu_sin`, `_gpu_min`).
    });

    test(`${language}: the shader agrees with the JavaScript target`, () => {
      const ce = voronoiEngine();
      const expr = ce.parse(VORONOI_ROW);
      const r = compile(expr, { to: language });
      const js = compile(expr, { to: 'javascript' });
      const run = shaderFunctions(
        `${r.preamble ?? ''}\n${mainFunction(r.code, ['x', 'y', 'T'], language)}`,
        language
      );
      // Points inside cells (the value 0.12 + 0.8H) and on a site dot (the
      // value 0), away from the edges, where float32 and double could take
      // different branches.
      const points = [
        [0.3, 0.2, 1],
        [-0.7, 0.4, 1],
        [1.1, -0.6, 2.5],
        [-1.3, -0.8, 4],
        [0.05, 0.9, 5.5],
      ];
      for (const [x, y, T] of points) {
        const want = js.run!({ x, y, T }) as number;
        const got = run('_main', x, y, T) as number;
        expect(Math.abs(got - want)).toBeLessThan(1e-4);
      }
    });
  }
});

describe('a call shared by two functions', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.parse('f(x) := \\sin(x)^2 + \\cos(3x)').evaluate();
    ce.parse('g(x) := f(x) + 1').evaluate();
    ce.parse('h(x) := 2f(x)').evaluate();
    return ce;
  }

  for (const language of TARGETS) {
    test(`${language}: is computed once`, () => {
      const ce = engine();
      const expr = ce.parse('g(x) + h(x)');
      const r = compile(expr, { to: language });
      const all = `${r.preamble ?? ''}\n${r.code}`;
      expect(all).not.toMatch(/_fn_/);
      expect(countCalls(r.code, 'sin')).toBe(1);
      expect(countCalls(r.code, 'cos')).toBe(1);
      const run = shaderFunctions(
        `${r.preamble ?? ''}\n${mainFunction(r.code, ['x'], language)}`,
        language
      );
      for (const x of [-2.1, 0.3, 1.7]) {
        const want = Math.sin(x) ** 2 + Math.cos(3 * x);
        expect(
          Math.abs((run('_main', x) as number) - 3 * want - 1)
        ).toBeLessThan(1e-5);
      }
    });

    test(`${language}: stays a call in a loop-form sum`, () => {
      // A `Sum` with a symbolic bound stays a loop, and a loop body does not
      // read a binding of the enclosing body, so a substituted `f(x)` would
      // be computed again on each iteration. The functions stay by
      // reference.
      const ce = engine();
      ce.parse('s(x) := \\sum_{k=1}^{n} k f(x)').evaluate();
      const r = compile(ce.parse('s(x) + g(x)'), { to: language });
      expect(`${r.preamble ?? ''}\n${r.code}`).toMatch(/_fn_f\(/);
    });

    test(`${language}: stays a call when the caller supplies the function`, () => {
      const ce = engine();
      const r = compile(ce.parse('g(x) + h(x)'), {
        to: language,
        functions: { f: 'myF' },
      });
      expect(`${r.preamble ?? ''}\n${r.code}`).toMatch(/myF\(/);
    });
  }

  test('a function that is called from one body only stays a call', () => {
    const ce = engine();
    const r = compile(ce.parse('g(x)'), { to: 'wgsl' });
    expect(`${r.preamble ?? ''}\n${r.code}`).toMatch(/_fn_g\(/);
  });

  test('a function that draws a random number stays a call', () => {
    // The body of `f` is not pure, so neither `f` nor its callers are
    // substituted: each call draws in the order the interpreter draws.
    const ce = new ComputeEngine();
    ce.parse('f(x) := x + \\operatorname{Random}()').evaluate();
    ce.parse('g(x) := f(x) + 1').evaluate();
    ce.parse('h(x) := 2f(x)').evaluate();
    const r = compile(
      ce.box(['WithRandomSeed', 'x', ['Add', ['g', 'x'], ['h', 'x']]]),
      { to: 'wgsl' }
    );
    expect(r.success).toBe(true);
    const all = `${r.preamble ?? ''}\n${r.code}`;
    expect(count(all, '_fn_f(x)')).toBe(2);
    expect(r.code).toMatch(/_fn_g\(x\)/);
  });
});

describe('the limits of the substitution', () => {
  test('an argument whose value draws a random number stays a call', () => {
    // `isPure` of `r` is true, but `r` holds `Random()`. Substituting `g(r)`
    // and `h(r)` would write `r`, and its draw, at each occurrence of the
    // parameter: four draws instead of two.
    const ce = new ComputeEngine();
    ce.parse('f(t) := \\sin(t) + \\cos(t)').evaluate();
    ce.parse('g(t) := f(t) + 1').evaluate();
    ce.parse('h(t) := 2f(t)').evaluate();
    ce.declare('r', { value: ce.box(['Random'], { form: 'raw' }) });
    const r = compile(ce.box(['Tuple', ['g', 'r'], ['h', 'r']]), {
      to: 'glsl',
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/_fn_g\(/);
    expect(r.code).toMatch(/_fn_h\(/);
    expect(count(r.code, '_gpu_rnd_draw(')).toBe(2);
  });

  test('a sum whose bounds are not safe integers is not written out', () => {
    // Above 2^53, `k + 1` can be `k` as a double, and a loop from the lower
    // to the upper bound would not end. The pass is called directly: the
    // targets' own unrolling of such a sum is not part of this test.
    const ce = new ComputeEngine();
    ce.parse('f(t) := \\sin(t) + \\cos(t)').evaluate();
    const expr = ce.parse(
      '\\sum_{k=9007199254740992}^{9007199254740994} f(x + k) + f(x)'
    );
    const target = {
      language: 'glsl',
      userFunctions: {},
      loweredSymbolType: () => 'float',
    } as unknown as CompileTarget<Expression>;
    expect(
      inlineSharedUserFunctionCalls(expr, target, {
        isOverridden: () => false,
      })
    ).toBe(expr);
  });

  test('a chain of nested calls is expanded in linear time', () => {
    // `f` reads its parameter three times, so the expanded chain holds about
    // 4^16 paths. The expansion stops at its size limits, and no call is
    // shared across two bodies: the code is the code by reference.
    const ce = new ComputeEngine();
    ce.parse('f(x) := x x + \\sin(x) + x').evaluate();
    let chain: MathJsonExpression = 'x';
    for (let i = 0; i < 16; i++) chain = ['f', chain];
    const start = performance.now();
    const r = compile(ce.box(chain), { to: 'glsl' });
    const elapsed = performance.now() - start;
    expect(r.success).toBe(true);
    expect(r.code).toBe(`${'_fn_f('.repeat(16)}x${')'.repeat(16)}`);
    expect(elapsed).toBeLessThan(1000);
  });

  test('an expansion above the size limits is not used', () => {
    // `g(x)` and the innermost call of the chain share `f(x)`. The chain of
    // depth 9 holds more paths than `GPU_SHARED_CALLS_MAX_PATHS`, so the
    // calls stay by reference; the chain of depth 3 is substituted.
    const compileChain = (depth: number) => {
      const ce = new ComputeEngine();
      ce.parse('f(x) := x x + \\sin(x) + x').evaluate();
      ce.parse('g(x) := f(x) + 1').evaluate();
      let chain: MathJsonExpression = 'x';
      for (let i = 0; i < depth; i++) chain = ['f', chain];
      const r = compile(ce.box(['Add', chain, ['g', 'x']]), { to: 'glsl' });
      expect(r.success).toBe(true);
      return `${r.preamble ?? ''}\n${r.code}`;
    };
    expect(compileChain(3)).not.toMatch(/_fn_/);
    expect(compileChain(9)).toMatch(/_fn_f\(/);
  });

  test('a sum whose head the caller supplies is not written out', () => {
    // The caller's `Sum` receives the operands as written. The GLSL target
    // has no lowering for its `Limits` operand, so the compilation fails, as
    // it does for the sum alone. Writing the sum out would ignore `mySum`.
    const ce = new ComputeEngine();
    ce.parse('f(x) := \\sin(x)^2 + \\cos(3x)').evaluate();
    ce.parse('g(x) := f(x) + 1').evaluate();
    const options = { to: 'glsl', functions: { Sum: 'mySum' } } as const;
    const alone = compile(ce.parse('\\sum_{k=1}^{3} k f(x)'), options);
    const shared = compile(ce.parse('\\sum_{k=1}^{3} k f(x) + g(x)'), options);
    expect(alone.success).toBe(false);
    expect(shared.success).toBe(false);
  });
});
