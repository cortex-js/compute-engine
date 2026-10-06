import { ComputeEngine } from '../../src/compute-engine';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Regression (2026-07-31): the `Mod` and `Remainder` compile templates spliced
// `compile()` output — which carries no outer parentheses — directly next to
// `%`/`*`/`/`, so a compound dividend was torn by operator precedence:
// `Mod(x + 29, 900)` emitted `x + 29 % 900` = `x + (29 % 900)`, degenerating
// to `(x + 929) % 900`. That is congruent to the correct result for
// `x ≥ -929` (which is why non-negative-input parity sweeps never caught it)
// and wrong below. `Remainder` was wrong for any compound dividend.
//
// A fresh engine: keeps `x` from leaking type inferences into the shared
// test engine.
const ce = new ComputeEngine();

function compiled(fnJson: unknown): (x: number) => number {
  const r = implicitCompile(ce, ce.box(fnJson as any), {});
  if (!r || typeof r.run !== 'function')
    throw new Error('expression did not compile');
  return r.run as (x: number) => number;
}

describe('compiled Mod/Remainder operand parenthesization', () => {
  it('Mod with a compound dividend matches the interpreter, incl. negatives', () => {
    const f = compiled([
      'Function',
      ['Add', 1, ['Mod', ['Add', 'x', 29], 900]],
      'x',
    ]);
    // -929/-930 straddle the boundary below which the torn emission went wrong.
    for (const x of [-5000, -2000, -930, -929, -900, -30, -1, 0, 1, 871, 900]) {
      const expected = ce.box(['Add', 1, ['Mod', x + 29, 900]]).evaluate().re;
      expect(f(x)).toBe(expected);
    }
  });

  it('Remainder with a compound dividend matches the interpreter', () => {
    const f = compiled(['Function', ['Remainder', ['Add', 'x', 29], 9], 'x']);
    for (const x of [-40, -33, -29, -5, 0, 7, 40]) {
      const expected = ce.box(['Remainder', x + 29, 9]).evaluate().re;
      expect(f(x)).toBe(expected);
    }
  });

  it('WGSL Mod parenthesizes the compiled dividend', () => {
    const wgsl = new WGSLTarget();
    const code = wgsl.compile(ce.box(['Mod', ['Add', 'x', 29], 900]), {
      vars: { x: 'u_x' },
    }).code;
    expect(code).toBe(
      '((((u_x + 29.0) % (900.0)) - (900.0) * floor(((u_x + 29.0) % (900.0)) / (900.0))) % (900.0))'
    );
  });

  it('GLSL Remainder parenthesizes the compiled dividend', () => {
    // The GPU `Remainder` handler is SHARED by GLSL and WGSL (WGSL only
    // overrides `Mod`), so this pins both.
    const glsl = new GLSLTarget();
    const code = glsl.compile(ce.box(['Remainder', ['Add', 'x', 29], 3]), {
      vars: { x: 'x' },
    }).code;
    expect(code).toBe(
      '((x + 29.0) - (3.0) * _gpu_round_up((x + 29.0) / (3.0)))'
    );
  });

  it('Python Remainder parenthesizes the compiled dividend', () => {
    const py = new PythonTarget();
    const code = py.compile(ce.box(['Remainder', ['Add', 'x', 29], 9]), {
      vars: { x: 'x' },
    }).code;
    expect(code.split('\n').at(-1)).toBe(
      "((x + 29) - (9) * _ce_round((x + 29) / (9), 'toward-positive-infinity'))"
    );
  });
});

// The floored template `((a % b) + b) % b` always added the divisor to the
// truncated remainder, and that sum is rounded when it is larger than 2^53:
// compiled `Mod(x, 2^53 - 1)` ran to `1` at `x = 2` and to `3` at `x = 2.5`.
// `_SYS.floorMod` adds the divisor only when the signs of the remainder and
// the divisor differ, as the interpreter does. A proven non-negative integer
// dividend over a NEGATIVE divisor took the plain `%` spelling, whose result
// has the sign of the dividend (`Mod(n, -3)` ran to `1` at `n = 7`, not
// `-2`); that spelling now also requires a non-negative divisor.
describe('compiled Mod agrees with the interpreter', () => {
  const N = 9007199254740991; // 2^53 - 1
  const run = (json: unknown, vars: Record<string, number>) => {
    const r = compile(ce.box(json as never), { fallback: false });
    expect(r.success).toBe(true);
    return r.run!(vars as never) as number;
  };
  const interpreted = (a: number, b: number) => ce.box(['Mod', a, b]).N().re;

  it.each([
    [2, N, 2],
    [2.5, N, 2.5],
    [-2, N, 9007199254740989],
    [7, 3, 1],
    [-7, 3, 2],
    [7, -3, -2],
    [-7, -3, -1],
    [-7.5, 2, 0.5],
  ])('Mod(%p, %p) is %p', (x, b, expected) => {
    expect(run(['Mod', 'x', b], { x })).toBe(expected);
    expect(interpreted(x, b)).toBe(expected);
  });

  it('a tiny negative dividend stays inside [0, 2)', () => {
    // `-1e-20 + 2` rounds to `2`; the trailing `% b` maps it back to `0`.
    // The interpreter computes the same on doubles at machine precision (at
    // the default precision it computes `2 - 10^-20` with big decimals).
    expect(run(['Mod', 'x', 2], { x: -1e-20 })).toBe(0);
    const m = new ComputeEngine();
    m.precision = 'machine';
    expect(m.box(['Mod', -1e-20, 2]).N().re).toBe(0);
  });

  it('a non-negative integer dividend over a negative divisor', () => {
    const e = new ComputeEngine();
    e.declare('n', 'integer');
    e.assume(e.parse('n \\ge 0'));
    const r = compile(e.box(['Mod', 'n', -3]), { fallback: false });
    for (const n of [0, 1, 2, 7, 9]) {
      const expected = e.box(['Mod', n, -3]).evaluate().re;
      expect(r.run!({ n } as never)).toBe(expected);
    }
    expect(r.run!({ n: 7 } as never)).toBe(-2);
  });
});
