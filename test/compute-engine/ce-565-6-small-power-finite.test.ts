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

type Target = 'glsl';

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
  const src = `${preamble}\nfloat f(float x, float y, float T) {\n${body}\n}`;
  const run = shaderFunctions(src, to);
  return (x, y, T) => run('f', x, y, T) as number;
}

describe.each(['glsl'] as const)('CE-565.6 on %s', (to) => {
  const ranged = new ComputeEngine();
  ranged.declare('x', 'real<-10..10>');
  ranged.declare('y', 'real<-10..10>');
  ranged.declare('T', 'real<-10..10>');

  const cases: [string, string][] = [
    ['\\min((x-\\cos(T))^2, y)', 'min(_gpu_pow2(x + -cos(T)), y)'],
    ['\\max(\\cos(T+1.9)^2, \\cos(T+1.9))', 'max(_gpu_pow2(_cse1), _cse1)'],
  ];

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

  });
});
