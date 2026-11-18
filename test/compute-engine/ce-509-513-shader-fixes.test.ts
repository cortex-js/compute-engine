/**
 * Shader defects that Tycho found while it ran the `glsl` (WebGL2) target on
 * a GPU, on 2026-10-26. Each block names the ROADMAP reference and the Tycho
 * row.
 *
 * Shader text cannot run under jest. Where a fix is arithmetic, the test
 * runs the EMITTED text — the scalar helpers of the preamble and the call —
 * as JavaScript, with the shader built-ins written out, so it checks the
 * emission itself.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('v', 'vector<real^3>');
ce.assign('g', ce.parse('x \\mapsto \\sum_{i=1}^{300}\\cos(ix)'));

/** The compiled result; the compile must succeed. */
function shader(
  input: string | unknown,
  to: 'glsl'
): { code: string; preamble: string } {
  const expr =
    typeof input === 'string' ? ce.parse(input) : ce.box(input as never);
  const r = compile(expr, { to, fallback: false } as never);
  expect([to, r.success]).toEqual([to, true]);
  return {
    code: r.code!,
    preamble: (r as { preamble?: string }).preamble ?? '',
  };
}

/**
 * The emitted scalar helpers and expression as a JavaScript function of `x`
 * and `y`. A scalar helper signature (`float f(float x, float y) {`) becomes
 * `function f(x, y) {`, and a local `float r =` becomes `let r =`. The shader
 * built-ins are passed in.
 */
function asFunction(
  emitted: { code: string; preamble: string },
  builtins: Record<string, (...args: number[]) => number>
): (x: number, y: number) => number {
  const helpers = emitted.preamble
    .replace(
      /\bfloat (\w+)\(float x(?:, float y)?\) \{/g,
      (_, name) => `function ${name}(x, y) {`
    )
    .replace(/\bfloat (\w+) =/g, 'let $1 =');
  const names = Object.keys(builtins);
  const f = new Function(
    'x',
    'y',
    ...names,
    `${helpers}\nreturn ${emitted.code};`
  );
  return (x, y) => f(x, y, ...names.map((n) => builtins[n]));
}

const step = (edge: number, x: number) => (x < edge ? 0 : 1);

describe('CE-511 (Tycho row 456): GLSL mod stays in the range of the divisor', () => {
  // The first `mod` returns the values measured on WebGL2 over ANGLE Metal
  // for the three witnesses; every other call computes GLSL's definition.
  const measured = new Map([
    ['100000000,3', -2],
    ['-1000000,1000', 1000],
    ['1e-20,-3', -3],
  ]);
  const glslMod = (x: number, y: number) =>
    measured.get(`${x},${y}`) ?? x - y * Math.floor(x / y);
  const builtins = { mod: glslMod, step, sign: Math.sign, abs: Math.abs };
  const emitted = shader(['Mod', 'x', 'y'], 'glsl');
  const f = asFunction(emitted, builtins);

  // The built-in `mod` gives -2 for Mod(1e8, 3) on WebGL2 over ANGLE Metal
  // (the interpreter gives 1); `_gpu_ir_fmod` corrects it. Witness: Tycho
  // row 456.
  it('corrects the measured driver results', () => {
    expect(f(1e8, 3)).toBe(1);
    expect(f(-1e6, 1000)).toBe(0);
    expect(f(1e-20, -3) === 0).toBe(true);
  });

  it('agrees with the floored modulo elsewhere', () => {
    expect(f(7, 3)).toBe(1);
    expect(f(-7, 3)).toBe(2);
    expect(f(7, -3)).toBe(-2);
    expect(f(-6, 3)).toBe(0);
    expect(f(-0.25, 1)).toBe(0.75);
  });

  it('keeps a zero divisor NaN', () => {
    expect(f(5, 0)).toBeNaN();
  });

  it('a nested Mod in a conditional arm grows linearly', () => {
    const code = shader(
      [
        'If',
        ['Less', 'x', 0],
        ['Mod', ['Mod', ['Mod', ['Multiply', 17, 'x'], 289], 289], 289],
        0,
      ],
      'glsl'
    ).code;
    expect((code.match(/17\.0 \* x/g) ?? []).length).toBe(1);
  });
});
