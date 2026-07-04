import { engine as ce } from '../utils';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * CO-P1-1 / CO-P1-4 execution parity.
 *
 * The Python target previously emitted code that was not valid Python
 * (JS-style ternaries, bare `NaN`, `and(a, b)` keyword-as-function calls, `&&`
 * chains) yet reported `success: true`. This suite compiles a battery of
 * expressions covering If / Which / When / And / Or / Not / relational chains /
 * NaN / tolerance-Equal, then **actually runs the emitted Python** through the
 * repo's `./venv/bin/python3` and asserts the value matches the interpreter's
 * `.N()` (booleans, or floats within 1e-10, or NaN).
 *
 * The suite is skipped when the venv (with numpy) is not available, so it never
 * blocks a checkout without the benchmark environment.
 */

// Repo root is two levels up from test/compute-engine; fall back to cwd.
const VENV_PYTHON = [
  path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
  path.join(process.cwd(), 'venv', 'bin', 'python3'),
].find((p) => fs.existsSync(p)) ?? path.join(process.cwd(), 'venv', 'bin', 'python3');

function venvHasNumpy(): boolean {
  try {
    if (!fs.existsSync(VENV_PYTHON)) return false;
    execFileSync(VENV_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function venvHasScipy(): boolean {
  try {
    if (!fs.existsSync(VENV_PYTHON)) return false;
    execFileSync(VENV_PYTHON, ['-c', 'import scipy.special'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

type Case = {
  name: string;
  expr: any;
  params: string[];
  inputs: Record<string, number>[];
};

const CASES: Case[] = [
  {
    name: 'if_branch',
    expr: ['If', ['Greater', 'x', 0], ['Multiply', 2, 'x'], ['Negate', 'x']],
    params: ['x'],
    inputs: [{ x: 3 }, { x: -4 }, { x: 0 }],
  },
  {
    name: 'which_three',
    expr: ['Which', ['Less', 'x', 0], -1, ['Equal', 'x', 0], 0, 'True', 1],
    params: ['x'],
    inputs: [{ x: -2 }, { x: 0 }, { x: 5 }],
  },
  {
    name: 'when_nan',
    expr: ['When', ['Multiply', 'x', 'x'], ['Greater', 'x', 0]],
    params: ['x'],
    inputs: [{ x: 3 }, { x: -1 }],
  },
  {
    name: 'logic_and',
    expr: ['And', ['Greater', 'x', 0], ['Less', 'x', 10]],
    params: ['x'],
    inputs: [{ x: 5 }, { x: -1 }, { x: 20 }],
  },
  {
    name: 'logic_or',
    expr: ['Or', ['Greater', 'x', 5], ['Less', 'x', -5]],
    params: ['x'],
    inputs: [{ x: 8 }, { x: 0 }, { x: -8 }],
  },
  {
    name: 'logic_not',
    expr: ['Not', ['Greater', 'x', 0]],
    params: ['x'],
    inputs: [{ x: 3 }, { x: -2 }],
  },
  {
    name: 'chain',
    expr: ['Less', 'a', 'b', 'c'],
    params: ['a', 'b', 'c'],
    inputs: [
      { a: 1, b: 2, c: 3 },
      { a: 1, b: 5, c: 2 },
    ],
  },
  {
    name: 'equal_tol',
    expr: ['Equal', ['Add', 'x', 0.2], 0.3],
    params: ['x'],
    inputs: [{ x: 0.1 }, { x: 0.5 }],
  },
  {
    name: 'not_equal',
    expr: ['NotEqual', 'x', 0.3],
    params: ['x'],
    inputs: [{ x: 0.3 }, { x: 0.4 }],
  },
  // CO-P2-26: negative-operand / edge coverage — the axis whose absence let the
  // Mod / Round / Arccot / odd-root convention splits (P0-41/42) survive review.
  // Each is checked against the interpreter's `.N()`, so a convention mismatch
  // (floored vs truncated Mod, banker's vs half-away Round, atan(1/x) vs (0,π)
  // Arccot, NaN vs real odd-root of a negative) fails here.
  {
    name: 'mod_signs',
    expr: ['Mod', 'x', 'y'],
    params: ['x', 'y'],
    inputs: [
      { x: 7, y: 3 },
      { x: -7, y: 3 },
      { x: 7, y: -3 },
      { x: -7, y: -3 },
      { x: 5, y: 2.5 },
      { x: -5, y: 2.5 },
      { x: 0, y: 3 },
    ],
  },
  {
    name: 'round_half',
    expr: ['Round', 'x'],
    params: ['x'],
    inputs: [
      { x: 2.5 },
      { x: -2.5 },
      { x: 0.5 },
      { x: -0.5 },
      { x: 3.5 },
      { x: -3.5 },
      { x: 0 },
      { x: -0 },
    ],
  },
  {
    name: 'sign_zero',
    expr: ['Sign', 'x'],
    params: ['x'],
    inputs: [{ x: 0 }, { x: -0 }, { x: 3.2 }, { x: -3.2 }],
  },
  {
    name: 'arccot_neg',
    expr: ['Arccot', 'x'],
    params: ['x'],
    inputs: [{ x: -2 }, { x: -0.5 }, { x: 2 }, { x: 0.5 }, { x: -10 }],
  },
  {
    name: 'root3_neg',
    expr: ['Root', 'x', 3],
    params: ['x'],
    inputs: [{ x: -8 }, { x: -27 }, { x: 8 }, { x: 0 }, { x: -1 }],
  },
  {
    name: 'root5_neg',
    expr: ['Root', 'x', 5],
    params: ['x'],
    inputs: [{ x: -32 }, { x: 32 }, { x: -1 }, { x: 0 }],
  },
  // CO-P2-24: `x^0` folds to 1 even at x=0 (the interpreter simplifies it), so
  // the compiled Python agrees. (The residual dynamic-`0^0` divergence is
  // documented on the Python `Power` operator; not asserted here.)
  {
    name: 'pow_x_0',
    expr: ['Power', 'x', 0],
    params: ['x'],
    inputs: [{ x: 0 }, { x: 5 }, { x: -3 }],
  },
];

const describeMaybe = venvHasNumpy() ? describe : describe.skip;

describeMaybe('PYTHON EXECUTION PARITY (venv)', () => {
  const python = new PythonTarget();

  it('emitted Python is valid and matches the interpreter .N()', () => {
    let src = 'import numpy as np\nimport cmath\nimport json\n\n';
    const expected: Array<boolean | number> = [];

    for (const c of CASES) {
      // Function names are prefixed so they never collide with a Python keyword.
      const fnName = `fn_${c.name}`;
      const fn = python.compileFunction(ce.box(c.expr), fnName, c.params);
      src += `${fn}\n`;

      for (const inp of c.inputs) {
        ce.pushScope();
        for (const [k, v] of Object.entries(inp)) {
          ce.declare(k, 'number');
          ce.assign(k, v);
        }
        const iv = ce.box(c.expr).N();
        ce.popScope();
        if (iv.symbol === 'True') expected.push(true);
        else if (iv.symbol === 'False') expected.push(false);
        else expected.push(iv.re);
      }
    }

    src += '\nresults = []\n';
    for (const c of CASES) {
      for (const inp of c.inputs) {
        const argStr = c.params.map((p) => inp[p]).join(', ');
        src +=
          `results.append((lambda z: bool(z) if isinstance(z, (bool, np.bool_)) ` +
          `else ("NaN" if not np.isfinite(z) else float(z)))(fn_${c.name}(${argStr})))\n`;
      }
    }
    src += 'print(json.dumps(results))\n';

    const file = path.join(os.tmpdir(), `ce-py-parity-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Array<boolean | number | string>;

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i];
      const a = actual[i];
      if (typeof e === 'boolean') {
        expect(Boolean(a)).toBe(e);
      } else if (Number.isNaN(e)) {
        expect(a === 'NaN' || Number.isNaN(a as number)).toBe(true);
      } else {
        expect(Math.abs((a as number) - e)).toBeLessThanOrEqual(1e-10);
      }
    }
  });
});

/**
 * GammaRegularized / BetaRegularized execution parity — mapped to
 * `scipy.special.gammaincc` / `scipy.special.betainc` (the latter with a
 * reordered argument list, see `python-target.ts`). Gated on the venv having
 * *scipy* (not just numpy), since scipy is not part of the base venv used by
 * the suite above — skipped rather than failing when unavailable.
 */
const SPECIAL_CASES: Case[] = [
  {
    name: 'gamma_regularized',
    expr: ['GammaRegularized', 3, 'x'],
    params: ['x'],
    inputs: [{ x: 0.5 }, { x: 2 }, { x: 5 }, { x: 10 }],
  },
  {
    name: 'beta_regularized',
    expr: ['BetaRegularized', 'x', 2, 3],
    params: ['x'],
    inputs: [{ x: 0.1 }, { x: 0.3 }, { x: 0.5 }, { x: 0.9 }],
  },
];

const describeScipyMaybe =
  venvHasNumpy() && venvHasScipy() ? describe : describe.skip;

describeScipyMaybe('PYTHON EXECUTION PARITY — scipy special functions (venv)', () => {
  const python = new PythonTarget();

  it('GammaRegularized / BetaRegularized emitted Python matches interpreter .N()', () => {
    let src = 'import numpy as np\nimport cmath\nimport scipy.special\nimport json\n\n';
    const expected: number[] = [];

    for (const c of SPECIAL_CASES) {
      const fnName = `fn_${c.name}`;
      const fn = python.compileFunction(ce.box(c.expr), fnName, c.params);
      src += `${fn}\n`;

      for (const inp of c.inputs) {
        ce.pushScope();
        for (const [k, v] of Object.entries(inp)) {
          ce.declare(k, 'number');
          ce.assign(k, v);
        }
        const iv = ce.box(c.expr).N();
        ce.popScope();
        expected.push(iv.re);
      }
    }

    src += '\nresults = []\n';
    for (const c of SPECIAL_CASES) {
      for (const inp of c.inputs) {
        const argStr = c.params.map((p) => inp[p]).join(', ');
        src += `results.append(float(fn_${c.name}(${argStr})))\n`;
      }
    }
    src += 'print(json.dumps(results))\n';

    const file = path.join(
      os.tmpdir(),
      `ce-py-parity-special-${process.pid}.py`
    );
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as number[];

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++)
      expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(1e-10);
  });
});
