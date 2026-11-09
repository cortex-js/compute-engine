/**
 * CE-1107. On the GLSL target, a call of a user function with a list
 * input as an argument, `g(H, x)` with `g(H: list<integer>, x: real)`.
 *
 * A shader function has no parameter for a list of the lengths that an input
 * can have, so the definition of `g` declines ("parameter "H" has no static
 * GLSL type"). When the argument is an input of the expression (a symbol that
 * no enclosing form binds), the call takes a variant of `g` with no parameter
 * `H`, whose body reads the input itself: `_fn_g_bind0_H(x)`. The input is
 * read as at the top level: through the texture helper with the hint
 * `storage: { H: 'sampler2D' }`, or as a uniform array.
 *
 * Tycho draws a heatmap whose colour formula reads three planes of one list
 * (the showcase entry `buddhabrot`). Without this variant, a colour formula
 * that calls a prelude function with the list is painted on the CPU.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const glsl = new GLSLTarget();

/** A fresh engine with the inputs `H`, `K`, `x`, `y` and the program `src`. */
function engineWith(src: string, hType = 'list<number^1600>'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('H', hType);
  ce.declare('K', 'list<number^4>');
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  expect(executeEpsil(ce, src).diagnostics).toEqual([]);
  return ce;
}

function message(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

const G = 'function g(H: list<integer>, x: real) -> real { H[1600] * x }';

describe('CE-1107: a list input as the argument of a shader function', () => {
  test('GLSL, the input in a texture', () => {
    const ce = engineWith(G);
    const r = glsl.compile(ce.box(['g', 'H', 'x']), {
      fallback: false,
      storage: { H: 'sampler2D' },
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_fn_g_bind0_H(x)');
    expect(r.preamble).toContain('float _fn_g_bind0_H(float x) {');
    expect(r.preamble).toContain('_gpu_texat1600(H, 1600.0)');
  });

  test('GLSL, the witness of the issue: a colour formula over 90,001 texels', () => {
    const ce = engineWith(
      [
        'function c(H: list<integer>, x: real, y: real) -> color {',
        '  if 0 <= x && x < 150 {',
        '    const n = 1 + H[90001]',
        '    rgb(1700 * H[max(30001, min(60000, 30001 + floor(x)))] / n, y, 0.5)',
        '  } else {',
        '    rgb(0.1, 0.16, 0.33)',
        '  }',
        '}',
      ].join('\n'),
      'list<(real | signed_infinity | nan)^90001>'
    );
    const r = glsl.compile(ce.box(['c', 'H', 'x', 'y']), {
      fallback: false,
      storage: { H: 'sampler2D' },
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_fn_c_bind0_H(x, y)');
    expect(r.preamble).toContain('vec3 _fn_c_bind0_H(float x, float y) {');
    expect(r.preamble).toContain('_gpu_texat90001(H, 90001.0)');
  });

  test('GLSL, the input as a uniform array', () => {
    const ce = engineWith(G);
    const call = ce.box(['g', 'H', 'x']);
    const g = glsl.compile(call, { fallback: false });
    expect(g.code).toBe('_fn_g_bind0_H(x)');
    expect(g.preamble).toContain('return x * H[1599];');
  });

  test('the calls with the same input share one variant', () => {
    const ce = engineWith(G);
    const r = glsl.compile(
      ce.box(['Add', ['g', 'H', 'x'], ['g', 'H', 'y'], ['At', 'H', 1]]),
      { fallback: false }
    );
    expect(r.code).toBe('H[0] + _fn_g_bind0_H(x) + _fn_g_bind0_H(y)');
    expect(r.preamble.split('float _fn_g_bind0_H(').length).toBe(2);
  });

  test('an input with another name than the parameter', () => {
    const ce = engineWith(
      'function g(H: list<integer>, x: real) -> real { H[1] * x }'
    );
    const r = glsl.compile(ce.box(['g', 'K', 'x']), { fallback: false });
    expect(r.code).toBe('_fn_g_bind0_K(x)');
    expect(r.preamble).toContain('return x * K.x;');
  });

  test('two calls that bind different inputs take two variants', () => {
    // The names of the inputs hold `_` and digits: the key of a variant must
    // still tell `(X_1_Y)` from `(X, Y_2_Z)`.
    const ce = new ComputeEngine();
    ce.declare('X_1_Y', 'list<real^5>');
    ce.declare('X', 'list<real^5>');
    ce.declare('Z', 'list<real^2>');
    ce.declare('Y_2_Z', 'list<real^2>');
    expect(
      executeEpsil(
        ce,
        'function g(a: list<real^5>, b: list<real^2>, c: list<real^2>) -> real { a[1] * 100 + b[1] * 10 + c[1] }'
      ).diagnostics
    ).toEqual([]);
    const r = glsl.compile(
      ce.box([
        'Add',
        ['g', 'X_1_Y', ['List', 1, 2], 'Z'],
        ['Multiply', 1000, ['g', 'X', 'Y_2_Z', ['List', 3, 4]]],
      ]),
      { fallback: false }
    );
    expect(r.success).toBe(true);
    const bodies = r.preamble
      .split('\n')
      .filter((line) => line.trim().startsWith('return'))
      .join('\n');
    expect(bodies).toContain('X_1_Y[0]');
    expect(bodies).toContain('Z.x');
    expect(bodies).toContain('X[0]');
    expect(bodies).toContain('Y_2_Z.x');
  });

  test('an input with no static length still declines', () => {
    const ce = engineWith(G, 'list<real>');
    expect(
      message(() => glsl.compile(ce.box(['g', 'H', 'x']), { fallback: false }))
    ).toMatch(/has no statically known length/);
  });

  // The lane of the call `g(L, x)` in `g(L, x) + 1` is read before the call
  // compiles (`userCallDefinition`), so this also holds that route.
  test('a call in the body of a variant takes a variant too', () => {
    const ce = engineWith(
      `${G}\nfunction f(L: list<integer>, x: real) -> real { g(L, x) + 1 }`
    );
    const r = glsl.compile(ce.box(['f', 'H', 'x']), { fallback: false });
    expect(r.code).toBe('_fn_f_bind0_H(x)');
    expect(r.preamble).toContain('return _fn_g_bind0_H(x) + 1.0;');
  });

  test('a parameter fact is read at the position of the parameter in the declaration', () => {
    // Every call passes `1` at `a`, so `a` is finite for certain and the body
    // calls the built-in `max` of it. `b` receives `x`, which can be NaN, so
    // it keeps the NaN-safe helper. The variant has the parameters `(a, b)`
    // at the positions 1 and 2 of the declaration of `g`.
    const ce = engineWith(
      'function g(H: list<integer>, a: real, b: real) -> real { H[1] + max(a, a * a) + max(b, b * b) }'
    );
    const r = glsl.compile(ce.box(['g', 'H', 1, 'x']), { fallback: false });
    expect(r.code).toBe('_fn_g_bind0_H(1.0, x)');
    expect(r.preamble).toContain(
      'return H[0] + max(a, a * a) + _gpu_max(b, b * b);'
    );
  });
});

describe('CE-1107: the calls that still decline', () => {
  test('a list that is a local of the caller', () => {
    // A module-level function cannot read a local of another function.
    const ce = engineWith(
      `${G}\nfunction f(x: real) -> real {\n  let L = [1, 2, 3]\n  g(L, x)\n}`
    );
    expect(
      message(() => glsl.compile(ce.box(['f', 'x']), { fallback: false }))
    ).toMatch(/parameter "H" has no static GLSL type/);
  });

  test('a list literal', () => {
    const ce = engineWith(G);
    expect(
      message(() =>
        glsl.compile(ce.box(['g', ['List', 1, 2, 3], 'x']), {
          fallback: false,
        })
      )
    ).toMatch(/parameter "H" has no static GLSL type/);
  });

  test('a body that binds the name of the input', () => {
    // The local `K` of the body would hide the input `K`.
    const ce = engineWith(
      'function g(H: list<integer>, x: real) -> real {\n  const K = 2\n  H[1] * x * K\n}'
    );
    expect(
      message(() =>
        glsl.compile(ce.box(['g', 'K', 'x']), { fallback: false })
      )
    ).toMatch(/parameter "H" has no static GLSL type/);
  });

  test('another parameter with the name of the input', () => {
    // The parameter `K` would hide the input `K`.
    const ce = engineWith(
      'function g(H: list<integer>, K: real) -> real { H[1] * K }'
    );
    expect(
      message(() =>
        glsl.compile(ce.box(['g', 'K', 'x']), { fallback: false })
      )
    ).toMatch(/parameter "H" has no static GLSL type/);
  });
});
