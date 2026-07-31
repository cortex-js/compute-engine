import { ComputeEngine } from '../../src/compute-engine';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

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
    expect(code).toBe('((((u_x + 29.0) % (900.0)) + (900.0)) % (900.0))');
  });

  it('GLSL Remainder parenthesizes the compiled dividend', () => {
    // The GPU `Remainder` handler is SHARED by GLSL and WGSL (WGSL only
    // overrides `Mod`), so this pins both.
    const glsl = new GLSLTarget();
    const code = glsl.compile(ce.box(['Remainder', ['Add', 'x', 29], 3]), {
      vars: { x: 'x' },
    }).code;
    expect(code).toBe('((x + 29.0) - (3.0) * round((x + 29.0) / (3.0)))');
  });

  it('Python Remainder parenthesizes the compiled dividend', () => {
    const py = new PythonTarget();
    const code = py.compile(ce.box(['Remainder', ['Add', 'x', 29], 9]), {
      vars: { x: 'x' },
    }).code;
    expect(code).toBe('((x + 29) - (9) * np.round((x + 29) / (9)))');
  });
});
