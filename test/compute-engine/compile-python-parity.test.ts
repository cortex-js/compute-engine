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
  // Max/Min are REDUCTIONS. `np.maximum`/`np.minimum` alone are element-wise and
  // binary, so a collection operand mis-reduced (or errored). Verify the
  // reduction agrees with `.N()` on scalar, single-list, mixed, and n-ary
  // shapes — and that a scalar operand alongside a list stays a plain max.
  {
    name: 'max_list_reduce',
    expr: ['Max', ['List', 3, 1, 4, 1, 5, 9, 2, 6]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'max_scalar_and_list',
    expr: ['Max', 0, ['List', 1, 2, 3]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'max_nary_scalars',
    expr: ['Max', 1, 5, 3],
    params: [],
    inputs: [{}],
  },
  {
    name: 'min_list_reduce',
    expr: ['Min', ['List', 3, 1, 4, 1, 5]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'max_var_and_list',
    expr: ['Max', 'x', ['List', 1, 2, 3]],
    params: ['x'],
    inputs: [{ x: 10 }, { x: 2 }],
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

/**
 * ElementMax / ElementMin / Clamp broadcasting parity (finding A8).
 *
 * `np.maximum`/`np.minimum`/`np.clip` broadcast by NumPy rules and raise
 * `ValueError` on a length mismatch that is not 1-vs-N, whereas the interpreter
 * (`broadcastOverIndexedCollections`) **zip-to-shortest** trims the arrays. When
 * any operand is a collection the Python target now routes through the injected
 * `_ce_bcast` runtime helper; when every operand is a scalar it keeps the direct
 * `np.*` fast path. This suite **runs the emitted Python** and asserts the value
 * matches the interpreter's `.evaluate()` for mismatched-length arrays,
 * scalar⊗array, equal-length arrays, all-scalar, and empty operands.
 *
 * Result normalization: a `List` result → an array of its element values; a
 * length-1 broadcast result unwraps to a scalar (interpreter convention); an
 * empty result is `[]` — the interpreter returns `Nothing` (no numeric
 * analogue), which the helper renders as an empty NumPy array, both normalized
 * to `[]` here.
 */
type BcastCase = { name: string; expr: any };

const BCAST_CASES: BcastCase[] = [
  { name: 'emax_len_2_1', expr: ['ElementMax', ['List', 1, 2], ['List', 3]] },
  {
    name: 'emax_len_2_3',
    expr: ['ElementMax', ['List', 1, 2], ['List', 3, 4, 5]],
  },
  {
    name: 'emin_scalar_array',
    expr: ['ElementMin', 5, ['List', 1, 10, 3]],
  },
  {
    name: 'emax_scalar_array',
    expr: ['ElementMax', 5, ['List', 1, 10, 3]],
  },
  {
    name: 'clamp_mismatch',
    expr: ['Clamp', ['List', 1, 5], ['List', 0], ['List', 2, 3, 4]],
  },
  {
    name: 'clamp_scalar_bounds',
    expr: ['Clamp', ['List', 1, 5, 9], 0, 4],
  },
  {
    name: 'emax_equal_len',
    expr: ['ElementMax', ['List', 1, 2, 3], ['List', 4, 5, 6]],
  },
  { name: 'emax_all_scalar', expr: ['ElementMax', 3, 4] },
  { name: 'clamp_all_scalar', expr: ['Clamp', 5, 0, 4] },
  {
    name: 'clamp_array_scalar_bounds',
    expr: ['Clamp', ['List', 1, 5, -3], 0, 4],
  },
  {
    name: 'emax_nary_mixed',
    expr: ['ElementMax', ['List', 1, 2], 3, ['List', 4, 5, 6, 7]],
  },
  {
    name: 'emax_empty',
    expr: ['ElementMax', ['List'], ['List', 1, 2]],
  },
];

// Interpreter result normalized to a scalar number or an array of numbers
// (Nothing → []).
function interpBcast(expr: any): number | number[] {
  const r = ce.box(expr).evaluate();
  if (r.symbol === 'Nothing') return [];
  if (r.operator === 'List') return r.ops!.map((o) => o.re);
  return r.re;
}

describeMaybe('PYTHON EXECUTION PARITY — ElementMax/ElementMin/Clamp (venv)', () => {
  const python = new PythonTarget();

  it('emitted broadcasting Python matches the interpreter .evaluate()', () => {
    let src = 'import numpy as np\nimport cmath\nimport json\n\n';
    for (const c of BCAST_CASES)
      src += `${python.compileFunction(ce.box(c.expr), `fn_${c.name}`, [])}\n`;

    // Normalize a returned value: a 0-d array → float scalar; otherwise a list.
    src +=
      'def _ser(z):\n' +
      '    z = np.asarray(z)\n' +
      '    return float(z) if z.ndim == 0 else [float(v) for v in z]\n\n';
    src += 'results = {}\n';
    for (const c of BCAST_CASES)
      src += `results[${JSON.stringify(c.name)}] = _ser(fn_${c.name}())\n`;
    src += 'print(json.dumps(results))\n';

    const file = path.join(os.tmpdir(), `ce-py-bcast-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Record<string, number | number[]>;

    for (const c of BCAST_CASES) {
      const e = interpBcast(c.expr);
      const a = actual[c.name];
      if (Array.isArray(e)) {
        expect(Array.isArray(a)).toBe(true);
        expect((a as number[]).length).toBe(e.length);
        for (let i = 0; i < e.length; i++)
          expect(Math.abs((a as number[])[i] - e[i])).toBeLessThanOrEqual(
            1e-10
          );
      } else {
        expect(typeof a).toBe('number');
        expect(Math.abs((a as number) - e)).toBeLessThanOrEqual(1e-10);
      }
    }
  });
});

/**
 * Collection / higher-order / linear-algebra operator parity. Each case is a
 * closed expression (no parameters); the emitted Python runs in the venv and
 * its JSON-serialized value must match the interpreter-verified expected
 * value (numerically, element-wise for nested lists).
 */
const COLLECTION_CASES: Array<{ name: string; expr: any; expected: any }> = (() => {
  const L = ['List', 1, 5, 2, 4, 3];
  const gt2 = ['Function', ['Greater', 'x', 2], 'x'];
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  return [
    { name: 'range_2arg', expr: ['Range', 2, 6], expected: [2, 3, 4, 5, 6] },
    { name: 'range_step', expr: ['Range', 1, 10, 3], expected: [1, 4, 7, 10] },
    { name: 'range_neg', expr: ['Range', 5, 1, -2], expected: [5, 3, 1] },
    // No explicit step: auto-descends like the interpreter (was: np.arange
    // with an implicit +1 step, silently compiling to [])
    { name: 'range_desc', expr: ['Range', 5, 1], expected: [5, 4, 3, 2, 1] },
    { name: 'range_1arg_neg', expr: ['Range', -2], expected: [1, 0, -1, -2] },
    // Fractional step must not overshoot the endpoint (was: the half-step
    // np.arange trick emitted 1.2 for Range(0, 1, 0.6))
    { name: 'range_frac', expr: ['Range', 0, 1, 0.6], expected: [0, 0.6] },
    // Operator-symbol combiner (lowered to a Python lambda, like JS)
    { name: 'reduce_sub', expr: ['Reduce', ['List', 10, 2, 3], 'Subtract', 0], expected: -15 },
    // Ragged nested list — np.asarray(...).ravel() would raise
    { name: 'flatten_ragged', expr: ['Flatten', ['List', ['List', 1, 2], ['List', 3]]], expected: [1, 2, 3] },
    { name: 'length', expr: ['Length', L], expected: 5 },
    { name: 'is_empty', expr: ['IsEmpty', ['List']], expected: true },
    { name: 'at_neg', expr: ['At', L, -1], expected: 3 },
    { name: 'first', expr: ['First', L], expected: 1 },
    { name: 'last', expr: ['Last', L], expected: 3 },
    { name: 'rest', expr: ['Rest', L], expected: [5, 2, 4, 3] },
    { name: 'most', expr: ['Most', L], expected: [1, 5, 2, 4] },
    { name: 'take', expr: ['Take', L, 2], expected: [1, 5] },
    { name: 'drop', expr: ['Drop', L, 2], expected: [2, 4, 3] },
    { name: 'reverse', expr: ['Reverse', L], expected: [3, 4, 2, 5, 1] },
    { name: 'sort', expr: ['Sort', L], expected: [1, 2, 3, 4, 5] },
    { name: 'ordering', expr: ['Ordering', ['List', 30, 10, 20]], expected: [2, 3, 1] },
    { name: 'join', expr: ['Join', L, ['List', 9]], expected: [1, 5, 2, 4, 3, 9] },
    { name: 'append', expr: ['Append', L, 9], expected: [1, 5, 2, 4, 3, 9] },
    { name: 'index_of', expr: ['IndexOf', L, 4], expected: 4 },
    { name: 'index_of_none', expr: ['IndexOf', L, 99], expected: 0 },
    { name: 'contains', expr: ['Contains', L, 4], expected: true },
    { name: 'unique', expr: ['Unique', ['List', 3, 1, 3, 2, 1]], expected: [3, 1, 2] },
    { name: 'zip', expr: ['Zip', ['List', 1, 2, 3], ['List', 10, 20]], expected: [[1, 10], [2, 20]] },
    { name: 'linspace', expr: ['Linspace', 0, 1, 5], expected: [0, 0.25, 0.5, 0.75, 1] },
    { name: 'map', expr: ['Map', L, ['Function', ['Multiply', 'x', 2], 'x']], expected: [2, 10, 4, 8, 6] },
    { name: 'filter', expr: ['Filter', L, gt2], expected: [5, 4, 3] },
    { name: 'count_if', expr: ['CountIf', L, gt2], expected: 3 },
    { name: 'find', expr: ['Find', L, gt2], expected: 5 },
    { name: 'index_where', expr: ['IndexWhere', L, gt2], expected: 2 },
    { name: 'position', expr: ['Position', L, gt2], expected: [2, 4, 5] },
    { name: 'any', expr: ['Any', L, gt2], expected: true },
    { name: 'all', expr: ['All', L, gt2], expected: false },
    { name: 'take_while', expr: ['TakeWhile', L, ['Function', ['Less', 'x', 5], 'x']], expected: [1] },
    { name: 'drop_while', expr: ['DropWhile', L, ['Function', ['Less', 'x', 5], 'x']], expected: [5, 2, 4, 3] },
    { name: 'flat_map', expr: ['FlatMap', ['List', 1, 2], ['Function', ['List', 'x', ['Multiply', 10, 'x']], 'x']], expected: [1, 10, 2, 20] },
    { name: 'reduce_add', expr: ['Reduce', L, 'Add'], expected: 15 },
    { name: 'reduce_lambda', expr: ['Reduce', ['List', 1, 2, 3], ['Function', ['Add', 'a', ['Multiply', 2, 'b']], 'a', 'b'], 0], expected: 12 },
    { name: 'scan_add', expr: ['Scan', ['List', 1, 2, 3], 'Add'], expected: [1, 3, 6] },
    { name: 'scan_lambda', expr: ['Scan', ['List', 10, 2, 3], ['Function', ['Subtract', 'a', 'b'], 'a', 'b'], 0], expected: [-10, -12, -15] },
    { name: 'tabulate', expr: ['Tabulate', ['Function', ['Square', 'i'], 'i'], 5], expected: [1, 4, 9, 16, 25] },
    { name: 'tabulate_2d', expr: ['Tabulate', ['Function', ['Add', ['Multiply', 10, 'i'], 'j'], 'i', 'j'], 2, 3], expected: [[11, 12, 13], [21, 22, 23]] },
    { name: 'fill', expr: ['Fill', ['Function', ['Add', ['Multiply', 10, 'i'], 'j'], 'i', 'j'], ['Tuple', 2, 2]], expected: [[11, 12], [21, 22]] },
    { name: 'boole', expr: ['Boole', ['Greater', 3, 2]], expected: 1 },
    { name: 'kronecker', expr: ['KroneckerDelta', 4, 4], expected: 1 },
    { name: 'kronecker_ne', expr: ['KroneckerDelta', 4, 5], expected: 0 },
    { name: 'element', expr: ['Element', 4, L], expected: true },
    { name: 'identity', expr: ['Identity', 42], expected: 42 },
    { name: 'apply', expr: ['Apply', ['Function', ['Multiply', 'x', 2], 'x'], 21], expected: 42 },
    { name: 'flatten', expr: ['Flatten', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]], expected: [1, 2, 3, 4, 5, 6] },
    { name: 'shape', expr: ['Shape', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]], expected: [2, 3] },
    { name: 'reshape_pad', expr: ['Reshape', ['List', 1, 2, 3, 4, 5], ['Tuple', 2, 3]], expected: [[1, 2, 3], [4, 5, 1]] },
    { name: 'trace', expr: ['Trace', M], expected: 5 },
    // Linear-algebra ops added alongside Tycho item 34. These return NumPy
    // arrays (like Transpose/Inverse); `_ser` converts them.
    {
      name: 'conj_transpose',
      expr: ['ConjugateTranspose', M],
      expected: [[1, 3], [2, 4]],
    },
    { name: 'diagonal_mat', expr: ['Diagonal', M], expected: [1, 4] },
    {
      name: 'diagonal_vec',
      expr: ['Diagonal', ['List', 5, 6, 7]],
      expected: [[5, 0, 0], [0, 6, 0], [0, 0, 7]],
    },
    {
      name: 'matrix_power',
      expr: ['MatrixPower', M, 3],
      expected: [[37, 54], [81, 118]],
    },
    {
      name: 'matrix_power_neg',
      expr: ['MatrixPower', M, -1],
      expected: [[-2, 1], [1.5, -0.5]],
    },
    // CE `Rank` = tensor rank (ndim), not the linear-algebra rank.
    { name: 'rank', expr: ['Rank', M], expected: 2 },
    {
      name: 'row_reduce',
      expr: ['RowReduce', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]],
      expected: [[1, 0, -1], [0, 1, 2]],
    },
  ];
})();

function expectDeepClose(a: any, e: any): void {
  if (Array.isArray(e)) {
    expect(Array.isArray(a)).toBe(true);
    expect(a.length).toBe(e.length);
    for (let i = 0; i < e.length; i++) expectDeepClose(a[i], e[i]);
  } else if (typeof e === 'boolean') {
    expect(Boolean(a)).toBe(e);
  } else {
    expect(Math.abs((a as number) - e)).toBeLessThanOrEqual(1e-10);
  }
}

describeMaybe('PYTHON EXECUTION PARITY — collections (venv)', () => {
  const python = new PythonTarget();

  it('emitted Python matches the interpreter for collection operators', () => {
    let src = 'import numpy as np\nimport json\n\n';
    for (const c of COLLECTION_CASES) {
      const fn = python.compileFunction(ce.box(c.expr), `fn_${c.name}`, []);
      src += `${fn}\n`;
    }
    // Serialize: booleans (incl. np.bool_) → bool, numbers → float, lists
    // recurse.
    src +=
      '\ndef _ser(z):\n' +
      '    if isinstance(z, np.ndarray): return _ser(z.tolist())\n' +
      '    if isinstance(z, (bool, np.bool_)): return bool(z)\n' +
      '    if isinstance(z, (list, tuple)): return [_ser(v) for v in z]\n' +
      '    return float(z)\n\n';
    src += 'results = {}\n';
    for (const c of COLLECTION_CASES)
      src += `results[${JSON.stringify(c.name)}] = _ser(fn_${c.name}())\n`;
    src += 'print(json.dumps(results))\n';

    const file = path.join(os.tmpdir(), `ce-py-coll-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Record<string, any>;
    for (const c of COLLECTION_CASES) expectDeepClose(actual[c.name], c.expected);
  });
});
