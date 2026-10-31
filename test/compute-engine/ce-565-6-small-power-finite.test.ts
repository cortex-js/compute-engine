/**
 * CE-565.6: on the shader targets, `min`, `max`, `sin`, … call the built-in,
 * not the NaN-safe helper (`_gpu_min`, `_gpu_sin`, …), when each operand is
 * finite for certain (`gpuProvablyFinite` in `compilation/gpu-target.ts`).
 * The proof now accepts one more head: `b^n` with an integer literal `n`
 * from 2 to 4, when the base `b` has a bound `m` of its magnitude read from
 * its parts (a literal, `sin` or `cos`, a symbol with a declared range, a
 * product of number literals and one of these, the negation of one of
 * these, or a sum of them) and `m^n` stays within half
 * the largest f32. The power is accepted only as the operand of the guarded
 * call itself, or as a term of a sum in that position: as a factor, or
 * under `floor`, `abs` or any other head, its size would be lost. Everything
 * else keeps the helper as before: a base with
 * no known magnitude (a bare `real`, where `x² = +∞` in f32 for
 * `x = 10²⁰`), an exponent of 5 or more, an exponent that is not an integer
 * literal, and `exp`.
 *
 * The values of the built-in code match the interpreter at sample points
 * (f32 shader interpreter `gpu-shader-f32-eval.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

type Target = 'glsl' | 'wgsl';

function shader(
  ce: ComputeEngine,
  latex: string,
  to: Target
): { code: string; preamble: string } {
  const r = compile(ce.parse(latex), {
    to,
    fallback: false,
  } as never) as { success: boolean; code?: string; preamble?: string };
  expect([latex, r.success]).toEqual([latex, true]);
  return { code: r.code ?? '', preamble: r.preamble ?? '' };
}

/** A shader function `f(x, y, T)` whose body is the compiled code. */
function shaderOf(
  code: string,
  preamble: string,
  to: Target
): (x: number, y: number, T: number) => number {
  const body = code.includes('return') ? code : `return ${code};`;
  const src =
    to === 'glsl'
      ? `${preamble}\nfloat f(float x, float y, float T) {\n${body}\n}`
      : `${preamble}\nfn f(x: f32, y: f32, T: f32) -> f32 {\n${body}\n}`;
  const run = shaderFunctions(src, to);
  return (x, y, T) => run('f', x, y, T) as number;
}

describe.each(['glsl', 'wgsl'] as const)('CE-565.6 on %s', (to) => {
  const ranged = new ComputeEngine();
  ranged.declare('x', 'real<-10..10>');
  ranged.declare('y', 'real<-10..10>');
  ranged.declare('T', 'real<-10..10>');

  const cases: [string, string][] = [
    ['\\min((x-\\cos(T))^2, y)', 'min(_gpu_pow2(x + -cos(T)), y)'],
    ['\\max(\\cos(T+1.9)^2, \\cos(T+1.9))', 'max(_gpu_pow2(_cse1), _cse1)'],
  ];

  it.each(cases)('%s uses the built-in', (latex, expected) => {
    const { code } = shader(ranged, latex, to);
    expect(code).toContain(expected);
    expect(code).not.toMatch(/_gpu_(min|max)\(/);
  });

  it('a small power of a ranged symbol uses the built-in `sin`', () => {
    expect(shader(ranged, '\\sin(x^2)', to).code).toBe('sin((x * x))');
    expect(shader(ranged, '\\sin(x^4)', to).code).toBe('sin((x * x * x * x))');
  });

  it.each(cases)('%s matches the interpreter', (latex) => {
    const { code, preamble } = shader(ranged, latex, to);
    const f = shaderOf(code, preamble, to);
    const expr = ranged.parse(latex);
    for (const [x, y, T] of [
      [0, 0, 0],
      [-10, 10, -10],
      [10, -10, 10],
      [3.5, -1.25, 2.7],
      [-7.3, 4.4, -0.6],
    ]) {
      const expected = expr.subs({ x, y, T }).N().re;
      // An f32 result has about 7 significant digits.
      expect(
        Math.abs(f(x, y, T) - expected) / Math.max(1, Math.abs(expected))
      ).toBeLessThan(1e-6);
    }
  });

  describe('a small power only as the operand or a term of it', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real<-1e9..1e9>');
    ce.declare('y', 'real<-10..10>');
    ce.declare('z', 'real<-10..10>');
    ce.declare('T', 'real<-10..10>');
    it.each([
      ['\\sin(x^2)', 'sin((x * x))'],
      ['\\sin(x^4)', 'sin((x * x * x * x))'],
      ['\\sin(x^2+1)', 'sin((x * x) + 1.0)'],
      ['\\sin(-x^2)', 'sin(-(x * x))'],
      ['\\min((z-\\cos(T))^2+1, y)', 'min(_gpu_pow2(z + -cos(T)) + 1.0, y)'],
    ])('%s uses the built-in', (latex, expected) => {
      expect(shader(ce, latex, to).code).toBe(expected);
    });
    // `x^4` is at most 10³⁶, finite; `1000·x^4` and `1000·floor(x^4)` are
    // `+∞` in f32 at `x = 10⁹`.
    it.each([
      '\\sin(1000x^4)',
      '\\sin(1000\\lfloor x^4\\rfloor)',
      '\\sin(3x^2)',
      '\\sin(\\lfloor x^2\\rfloor)',
      '\\sin(|x^4|)',
    ])('%s keeps the helper', (latex) => {
      expect(shader(ce, latex, to).code).toMatch(/^_gpu_sin\(/);
    });
    it('a sum of powers that can overflow together keeps the helper', () => {
      const ce2 = new ComputeEngine();
      for (const s of ['u', 'v', 'w']) ce2.declare(s, 'real<-1.2e19..1.2e19>');
      // Each square is at most 1.44·10³⁸, finite; the sum is `+∞` in f32.
      expect(shader(ce2, '\\sin(u^2)', to).code).toBe('sin((u * u))');
      expect(shader(ce2, '\\sin(u^2+v^2+w^2)', to).code).toMatch(/^_gpu_sin\(/);
      // The same through negations: the terms are `Negate(Power(…))`.
      expect(shader(ce2, '\\sin(-u^2-v^2-w^2)', to).code).toMatch(
        /^_gpu_sin\(/
      );
      expect(shader(ce2, '\\sin(u^2-v^2-w^2)', to).code).toMatch(/^_gpu_sin\(/);
      expect(shader(ce2, '\\sin(-u^2)', to).code).toBe('sin(-(u * u))');
      // A term of unknown magnitude beside a power: `+∞` for `u = 10¹⁹`,
      // `y = 3·10³⁸`.
      ce2.declare('y', 'real');
      ce2.declare('x', 'real<-10..10>');
      expect(shader(ce2, '\\sin(u^2+y)', to).code).toMatch(/^_gpu_sin\(/);
      // One term of unknown magnitude beside terms whose bounds add up to
      // at most 2¹⁰⁰ cannot overflow: `x² ≤ 100` is far below the rounding
      // step of f32 near its largest value (CE-619.5).
      expect(shader(ce2, '\\sin(x^2-y)', to).code).toBe('sin((x * x) + -y)');
      expect(shader(ce2, '\\sin(x^2+1)', to).code).toBe('sin((x * x) + 1.0)');
      expect(shader(ce2, '\\sin(-x^2)', to).code).toBe('sin(-(x * x))');
    });
  });

  describe('keeps the helper', () => {
    it('for a base with no known magnitude (a bare `real`)', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('y', 'real');
      ce.declare('T', 'real<-10..10>');
      // Tycho's voronoi operand: `x` has no range, so `(x - cos(T))^2` can
      // be `+∞` in f32 (`x = 10²⁰`).
      expect(shader(ce, '\\min((x-\\cos(T))^2, y)', to).code).toBe(
        '_gpu_min(_gpu_pow2(x + -cos(T)), y)'
      );
      expect(shader(ce, '\\sin(x^2)', to).code).toBe('_gpu_sin((x * x))');
      // The helper is right: in f32, `x²` overflows.
      const { code, preamble } = shader(ce, '\\min((x-\\cos(T))^2, y)', to);
      expect(shaderOf(code, preamble, to)(1e20, 1, 0)).toBe(1);
    });

    it('for a base whose bound overflows f32', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real<-1e10..1e10>');
      // `x^4` is up to 10⁴⁰.
      expect(shader(ce, '\\sin(x^4)', to).code).toMatch(/^_gpu_sin\(/);
    });

    it('for a product of two symbols with no declared range', () => {
      const ce = new ComputeEngine();
      ce.declare('k', 'real');
      ce.declare('t', 'real');
      expect(shader(ce, '\\sin((kt)^2)', to).code).toMatch(/^_gpu_sin\(/);
    });

    it('for an exponent of 5 or more', () => {
      expect(shader(ranged, '\\min(x^5, y)', to).code).toBe(
        '_gpu_min((x * x * x * x * x), y)'
      );
      expect(shader(ranged, '\\min((x-\\cos(T))^5, y)', to).code).toMatch(
        /^_gpu_min\(/
      );
    });

    it('for an exponent that is not a positive integer literal', () => {
      expect(shader(ranged, '\\min(x^{-2}, y)', to).code).toMatch(
        /^_gpu_min\(/
      );
      expect(shader(ranged, '\\min(x^{1/2}, y)', to).code).toMatch(
        /^_gpu_min\(/
      );
      expect(shader(ranged, '\\min(2^{x}, y)', to).code).toMatch(/^_gpu_min\(/);
    });

    it('for `exp`', () => {
      // `exp` is refused, as before: e^10 is finite, but the proof has no
      // rule for it.
      const { code } = shader(ranged, '\\min(\\exp(T)+1, 2\\exp(T))', to);
      expect(code).toMatch(/_gpu_min\(/);
      expect(shader(ranged, '\\min(\\exp(x), y)', to).code).toBe(
        '_gpu_min(exp(x), y)'
      );
    });

    // Examples from the reviews of the wider rules (an `exp` rule and
    // sizes passed through `abs`, `floor`, `max` and quotients), which were
    // withdrawn. Each is `+∞` or NaN in f32 at V = W = Z = 88.
    it.each([
      '\\sin(e^{V}+e^{W}+e^{Z})',
      '\\sin(x e^{V})',
      '\\sin(3|e^{V}|)',
      '\\sin(3\\lfloor e^{V}\\rfloor)',
      '\\sin(3\\max(e^{V},1))',
      '\\sin(\\lfloor e^{V}\\rfloor+\\lfloor e^{W}\\rfloor+\\lfloor e^{Z}\\rfloor)',
      '\\sin(x+e^{V}+e^{W}+e^{Z})',
      '\\sin(e^{V}/0.001)',
      '\\sin(e^{V}/0.5)',
      '\\sin(x e^{V}/0.5)',
      '\\sin(\\operatorname{mod}(e^{V}, 0.001))',
      '\\min(\\exp(V), x)',
      '\\min(2\\exp(V), x)',
    ])('for %s', (latex) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('V', 'real<-100..88>');
      ce.declare('W', 'real<-100..88>');
      ce.declare('Z', 'real<-100..88>');
      expect(shader(ce, latex, to).code).toMatch(/^_gpu_(sin|min)\(/);
    });

    it('for `exp` of an argument that f32 rounds', () => {
      // `3x − y` is 64, but f32 rounds `3x` up and computes 128.
      const ce = new ComputeEngine();
      ce.declare('x', 'real<536870976..536870976>');
      ce.declare('y', 'real<1610612864..1610612864>');
      expect(Math.fround(3 * Math.fround(536870976)) - 1610612864).toBe(128);
      expect(shader(ce, '\\sin(\\exp(3x-y))', to).code).toMatch(/^_gpu_sin\(/);
      const ce2 = new ComputeEngine();
      ce2.declare('x', 'real<16777218..16777218>');
      ce2.declare('y', 'real<50331652..50331652>');
      expect(shader(ce2, '\\sin(10^{37}\\exp(3x-y))', to).code).toMatch(
        /^_gpu_sin\(/
      );
      const ce3 = new ComputeEngine();
      ce3.declare('X', 'real<16777219..16777219>');
      ce3.declare('Y', 'real<16777217..16777217>');
      ce3.declare('C', 'real<0..2e37>');
      expect(shader(ce3, '\\sin(C\\exp(X-Y))', to).code).toMatch(/^_gpu_sin\(/);
    });
  });

  // A term of the base can be a product of number literals and one atom
  // (a ranged symbol, `sin` or `cos` of a real), with the bound `|c|·m`.
  // Tycho row 470: the voronoi operands.
  describe('a product of literals and one atom in the base', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real<-1e15..1e15>');
    ce.declare('y', 'real<-1e15..1e15>');
    ce.declare('T', 'real<-10..10>');

    const accepted: [string, string][] = [
      ['\\min((x-0.14\\cos(T))^2, y)', 'min(_gpu_pow2(x + -0.14 * cos(T)), y)'],
      ['\\min((2x)^2, y)', 'min(_gpu_pow2(2.0 * x), y)'],
      [
        '\\min((x - 0.14\\cos(T+1.9) + 0.189)^2, y)',
        'min(_gpu_pow2(x + -0.14 * cos(T + 1.9) + 0.189), y)',
      ],
      // The bound of the product feeds the sum check.
      ['\\min((2x)^2 + 3x, y)', 'min(_gpu_pow2(2.0 * x) + 3.0 * x, y)'],
    ];

    it.each(accepted)('%s uses the built-in', (latex, expected) => {
      expect(shader(ce, latex, to).code).toBe(expected);
    });

    it.each(accepted)('%s matches the interpreter', (latex) => {
      const { code, preamble } = shader(ce, latex, to);
      const f = shaderOf(code, preamble, to);
      const expr = ce.parse(latex);
      for (const [x, y, T] of [
        [0, 0, 0],
        [0.3, 5, 1.2],
        [-2.5, 100, -7.5],
        [1e15, 1e15, 10],
        [-1e15, 1e15, -10],
        [3e7, 2e15, 2.7],
      ]) {
        // The interpreter reads its inputs as f32 values.
        const xs = Math.fround(x);
        const ys = Math.fround(y);
        const Ts = Math.fround(T);
        const expected = expr.subs({ x: xs, y: ys, T: Ts }).N().re;
        expect(Number.isFinite(f(x, y, T))).toBe(true);
        expect(
          Math.abs(f(x, y, T) - expected) / Math.max(1, Math.abs(expected))
        ).toBeLessThan(1e-5);
      }
    });

    it.each([
      // `(10²⁰·x)²` is up to 10⁷⁰: `+∞` in f32.
      ['\\min((1e20 x)^2, y)', ce],
      // Two atoms that are not literals: no literal factor.
      ['\\min((x y)^2, y)', ce],
      // A rational factor is a division in the shader (`x / 3.0 * 2.0`).
      ['\\min((2 x / 3)^2, y)', ce],
      // `exp` is not an atom.
      ['\\min((0.5 \\exp(T))^2, y)', ce],
    ] as const)('%s keeps the helper', (latex, engine) => {
      expect(shader(engine, latex, to).code).toMatch(/^_gpu_min\(/);
    });

    it('keeps the helper for a factor with no range', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('x', 'real');
      ce2.declare('y', 'real');
      expect(shader(ce2, '\\min((3x)^2, y)', to).code).toBe(
        '_gpu_min(_gpu_pow2(3.0 * x), y)'
      );
    });

    it('keeps the helper for two atoms with small ranges', () => {
      // The bound `x·y ≤ 100` is small, but a product of two atoms that are
      // not literals is not a term of the base.
      expect(shader(ranged, '\\min((xy)^2, y)', to).code).toMatch(
        /^_gpu_min\(/
      );
    });

    it('keeps the helper near the limit of f32', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('w', 'real<-3e9..3e9>');
      ce2.declare('y', 'real<-10..10>');
      // `w^4` is at most 8.1·10³⁷; `(2w)^4` is up to 1.3·10³⁹, `+∞` in f32.
      expect(shader(ce2, '\\min(w^4, y)', to).code).toBe(
        'min((w * w * w * w), y)'
      );
      expect(shader(ce2, '\\min((2w)^4, y)', to).code).toMatch(/^_gpu_min\(/);
    });

    it('keeps the helper for a sum whose product terms can overflow together', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('u', 'real<-6e18..6e18>');
      ce2.declare('v', 'real<-6e18..6e18>');
      ce2.declare('y', 'real<-10..10>');
      ce2.declare('r', 'real');
      // Each square is at most 1.44·10³⁸; the sum is up to 2.9·10³⁸, more
      // than half the largest f32.
      expect(shader(ce2, '\\min((2u)^2, y)', to).code).toBe(
        'min(_gpu_pow2(2.0 * u), y)'
      );
      expect(shader(ce2, '\\min((2u)^2+(2v)^2, y)', to).code).toMatch(
        /^_gpu_min\(/
      );
      // A product term with no range beside the power.
      expect(shader(ce2, '\\min((2u)^2+3r, y)', to).code).toMatch(
        /^_gpu_min\(/
      );
    });

    // The bound `|c|·m` of a product is read only by the sum check and the
    // base of a small power. The product rule accepts one factor of unknown
    // magnitude beside factors with a bound, so a bound of `c` there would
    // accept `c·y` with `y: real`, which is `+∞` in f32 at `T = 0`,
    // `y = 10⁹` when `c = 10³⁰·cos(T)`.
    it.each([
      [
        'c := 1e30\\cos(T)',
        '\\sin(c\\cdot y)',
        '_gpu_sin((1e+30 * cos(T)) * y)',
      ],
      ['c := 2\\sin(T)', '\\sin(c\\cdot y)', '_gpu_sin((2.0 * sin(T)) * y)'],
      // A call argument: the bound of the argument is the fact of `p`.
      ['F(p) := \\sin(p y)', 'F(1e30\\cos(T))', 'return _gpu_sin(p * y);'],
    ])('with %s, %s keeps the helper', (def, latex, expected) => {
      const ce2 = new ComputeEngine();
      ce2.declare('T', 'real');
      ce2.declare('y', 'real');
      ce2.parse(def).evaluate();
      const { code, preamble } = shader(ce2, latex, to);
      expect(`${preamble}\n${code}`).toContain(expected);
    });
  });
});
