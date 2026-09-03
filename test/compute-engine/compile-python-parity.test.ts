import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
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

  // Collection equality (2+ collection operands) — the interpreter returns a
  // SCALAR boolean (whole-collection equality within tolerance; a length or
  // shape mismatch is `False`, never an error). The emitted `_ce_eqcoll`
  // helper must agree on every shape below. Before the fix these compiled to
  // `abs([1, 2] - [3, 4]) <= 1e-10`, a `TypeError` at run time.
  {
    name: 'eq_coll_pair_equal',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_pair_unequal',
    expr: ['Equal', ['List', 1, 2], ['List', 3, 4]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_chain3_true',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2], ['List', 1, 2]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_chain3_false',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2], ['List', 3, 4]],
    params: [],
    inputs: [{}],
  },
  {
    // A scalar operand inside a 2+-collection chain: no broadcast, the
    // collection-vs-scalar pair is simply False.
    name: 'eq_coll_chain_mixed_scalar',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2], 5],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_length_mismatch',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2, 3]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_within_tolerance',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2.0000000000001]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_outside_tolerance',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2.1]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_matrix',
    expr: [
      'Equal',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', ['List', 1, 2], ['List', 3, 5]],
    ],
    params: [],
    inputs: [{}],
  },
  {
    // Ragged inner rows: `np.asarray` raises, so the helper must fall through
    // to its recursive path instead of propagating the exception.
    name: 'eq_coll_ragged_rows',
    expr: [
      'Equal',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', ['List', 1, 2, 9], ['List', 3, 4]],
    ],
    params: [],
    inputs: [{}],
  },
  {
    // A `list<string>` operand also routes to the helper; `np.asarray(...,
    // dtype=float)` and `abs(a - b)` both raise on strings, so the helper must
    // fall back to `==` rather than propagating a `TypeError`.
    name: 'eq_coll_strings_equal',
    expr: [
      'Equal',
      ['List', { str: 'a' }, { str: 'b' }],
      ['List', { str: 'a' }, { str: 'b' }],
    ],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_strings_unequal',
    expr: ['Equal', ['List', { str: 'a' }], ['List', { str: 'c' }]],
    params: [],
    inputs: [{}],
  },
  {
    // Numeric-looking STRINGS: `np.asarray(..., dtype=float)` parses them, so
    // this answered True while the interpreter compares the strings (verified:
    // `Equal(["1"],["1.0"])` → False). The helper now picks the tolerance path
    // from the uncoerced dtype.
    name: 'eq_coll_numeric_strings',
    expr: ['Equal', ['List', { str: '1' }], ['List', { str: '1.0' }]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_numeric_strings_same',
    expr: ['Equal', ['List', { str: '1' }], ['List', { str: '1' }]],
    params: [],
    inputs: [{}],
  },
  {
    // `abs(inf - inf)` is NaN, so matching infinities compared UNEQUAL while
    // the interpreter answers True.
    name: 'eq_coll_inf_match',
    expr: [
      'Equal',
      ['List', { num: '+Infinity' }],
      ['List', { num: '+Infinity' }],
    ],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_neg_inf_match',
    expr: [
      'Equal',
      ['List', { num: '-Infinity' }],
      ['List', { num: '-Infinity' }],
    ],
    params: [],
    inputs: [{}],
  },
  {
    name: 'eq_coll_inf_opposite_signs',
    expr: [
      'Equal',
      ['List', { num: '+Infinity' }],
      ['List', { num: '-Infinity' }],
    ],
    params: [],
    inputs: [{}],
  },
  {
    // NaN is equal to nothing, itself included — the exact `==` disjunct must
    // not resurrect it (interpreter: `Equal([NaN],[NaN])` → False).
    name: 'eq_coll_nan',
    expr: ['Equal', ['List', { num: 'NaN' }], ['List', { num: 'NaN' }]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'neq_coll_nan',
    expr: ['NotEqual', ['List', { num: 'NaN' }], ['List', { num: 'NaN' }]],
    params: [],
    inputs: [{}],
  },
  {
    // Infinities reached through the RECURSIVE (ragged) path, which lands on
    // the scalar branch — same `abs(inf - inf)` trap.
    name: 'eq_coll_ragged_inf',
    expr: [
      'Equal',
      ['List', ['List', { num: '+Infinity' }, 1], ['List', 2]],
      ['List', ['List', { num: '+Infinity' }, 1], ['List', 2]],
    ],
    params: [],
    inputs: [{}],
  },
  {
    name: 'neq_coll_pair',
    expr: ['NotEqual', ['List', 1, 2], ['List', 3, 4]],
    params: [],
    inputs: [{}],
  },
  {
    name: 'neq_coll_chain3',
    expr: ['NotEqual', ['List', 1, 2], ['List', 1, 2], ['List', 3, 4]],
    params: [],
    inputs: [{}],
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
 * `ValueError` on a length mismatch that is not 1-vs-N. When any operand is a
 * collection the Python target routes through the injected `_ce_bcast` runtime
 * helper; when every operand is a scalar it keeps the direct `np.*` fast path.
 * This suite **runs the emitted Python** and asserts the value matches the
 * interpreter's `.evaluate()` for mismatched-length arrays, scalar⊗array,
 * equal-length arrays, all-scalar, and empty operands.
 *
 * A length mismatch used to zip-to-shortest on BOTH sides (the helper was built
 * to reproduce the interpreter's truncation). The 2026-07-24 ruling made a
 * mismatch an `incompatible-dimensions` ERROR everywhere — no truncation, no
 * recycling — so both sides now answer the numeric projection of that error,
 * `NaN`. The mismatched cases below are kept precisely because they are the
 * ones that would drift if a target quietly kept trimming.
 *
 * Result normalization: a `List` result → an array of its element values; a
 * length-1 broadcast result unwraps to a scalar (interpreter convention); an
 * empty result is `[]`; an `Error` (and `Nothing` where no numeric analogue
 * exists) is `NaN`, which is compared NaN-to-NaN rather than by distance.
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
    // `json.dumps` emits a bare `NaN`, which `JSON.parse` rejects — send it as
    // `null` and map it back to NaN on the JavaScript side.
    src +=
      'def _num(v):\n' +
      '    f = float(v)\n' +
      '    return None if f != f else f\n\n' +
      'def _ser(z):\n' +
      '    z = np.asarray(z)\n' +
      '    return _num(z) if z.ndim == 0 else [_num(v) for v in z]\n\n';
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
      // `null` is the JSON transport for NaN (see `_num` above).
      const a = actual[c.name] === null ? NaN : actual[c.name];
      if (Array.isArray(e)) {
        expect(Array.isArray(a)).toBe(true);
        expect((a as number[]).length).toBe(e.length);
        for (let i = 0; i < e.length; i++)
          expect(Math.abs((a as number[])[i] - e[i])).toBeLessThanOrEqual(
            1e-10
          );
      } else if (Number.isNaN(e)) {
        // An `incompatible-dimensions` error (or an empty operand beside a
        // non-empty one) projects to NaN on both sides.
        expect(typeof a).toBe('number');
        expect(a as number).toBeNaN();
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
    { name: 'map', expr: ['Map', ['Function', ['Multiply', 'x', 2], 'x'], L], expected: [2, 10, 4, 8, 6] },
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
    // A 1-tuple must emit `(x,)`, not `(x)` — the latter is a parenthesized
    // SCALAR. These cases distinguish the two at run time: `_ser` maps a real
    // tuple to a one-element list, whereas a scalar serializes to a bare
    // bool/float and `expectDeepClose` fails the `Array.isArray` assertion.
    { name: 'tuple_singleton_bool', expr: ['Tuple', 'True'], expected: [true] },
    { name: 'tuple_singleton_num', expr: ['Tuple', 5], expected: [5] },
    // …and `len()` over it, which raises `TypeError` on the scalar form.
    { name: 'tuple_singleton_length', expr: ['Length', ['Tuple', 5]], expected: 1 },
    { name: 'tuple_pair', expr: ['Tuple', 1, 2], expected: [1, 2] },
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

/**
 * Arithmetic over a LIST-TYPED parameter.
 *
 * The Python target used to refuse every arithmetic head that had a
 * collection-typed operand, because its infix lowering is wrong for a Python
 * list: `v + 1` raises `TypeError` (a list concatenates, it does not add) and
 * `2 * v` REPEATS the list instead of scaling it. A head with exactly one
 * collection operand now fans out into a list comprehension instead, which the
 * cases below verify by RUNNING the emitted Python.
 *
 * Each case is executed twice, once with a plain Python list bound to the
 * parameter and once with a NumPy array, because the reason the guard existed
 * is that a compiled artifact cannot constrain which of the two the caller
 * binds. Both runs must equal the interpreter's own answer.
 */
const ELEMENTWISE_CASES: Array<{
  name: string;
  expr: any;
  value: number[];
}> = [
  { name: 'ew_negate', expr: ['Negate', 'v'], value: [1, -2, 3.5] },
  { name: 'ew_add_scalar', expr: ['Add', 'v', 1], value: [1, 2, 3] },
  { name: 'ew_mul_scalar', expr: ['Multiply', 2, 'v'], value: [1, -2, 3] },
  { name: 'ew_sub_from_scalar', expr: ['Subtract', 3, 'v'], value: [1, 2, 3] },
  { name: 'ew_div_by_scalar', expr: ['Divide', 'v', 2], value: [1, 3, 5] },
  { name: 'ew_scalar_over', expr: ['Divide', 2, 'v'], value: [1, 2, 4] },
  { name: 'ew_power', expr: ['Power', 'v', 2], value: [1, 2, 3] },
  { name: 'ew_scalar_power', expr: ['Power', 2, 'v'], value: [0, 1, 3] },
  // The scalar operand is an expression, not a literal: it is spliced into the
  // comprehension body, so it must still parenthesize correctly.
  {
    name: 'ew_scalar_expr',
    expr: ['Multiply', 'v', ['Add', 3, 4]],
    value: [1, 2, 3],
  },
  // A fan-out nested inside a natively-broadcasting head (`np.sin` of a list).
  {
    name: 'ew_nested_in_sin',
    expr: ['Sin', ['Multiply', 2, 'v']],
    value: [0, 0.5, 1],
  },
  // Two fan-outs nested in each other (`Subtract` canonicalizes to Add+Negate).
  { name: 'ew_nested_fanout', expr: ['Subtract', 5, 'v'], value: [1, 2, 3] },
  // An EMPTY binding: the interpreter answers the empty list for a binary head
  // (`Add([], 1)` is `[]`), and so does the comprehension.
  { name: 'ew_empty', expr: ['Add', 'v', 1], value: [] },
];

describeMaybe('PYTHON EXECUTION PARITY — arithmetic over a list (venv)', () => {
  const python = new PythonTarget();

  it('emitted comprehensions match the interpreter for list and ndarray bindings', () => {
    let src = 'import numpy as np\nimport json\n\n';
    const expected: Record<string, number[]> = {};

    for (const c of ELEMENTWISE_CASES) {
      ce.pushScope();
      // Declared but NOT assigned, so the compiler sees a list-TYPED operand
      // rather than a foldable literal — the shape the guard used to refuse.
      ce.declare('v', 'list<number>');
      src += `${python.compileFunction(ce.box(c.expr), `fn_${c.name}`, ['v'])}\n`;
      ce.assign('v', ce.box(['List', ...c.value]));
      const iv = ce.box(c.expr).N();
      ce.popScope();
      expected[c.name] = (iv.ops ?? []).map((o) => o.re);
    }

    src +=
      '\ndef _ser(z):\n' +
      '    if isinstance(z, np.ndarray): return _ser(z.tolist())\n' +
      '    if isinstance(z, (list, tuple)): return [_ser(v) for v in z]\n' +
      '    return float(z)\n\n';
    src += 'results = {}\n';
    for (const c of ELEMENTWISE_CASES) {
      const lit = JSON.stringify(c.value);
      src += `results[${JSON.stringify(c.name)}] = [_ser(fn_${c.name}(${lit})), _ser(fn_${c.name}(np.array(${lit}, dtype=float)))]\n`;
    }
    src += 'print(json.dumps(results))\n';

    const file = path.join(os.tmpdir(), `ce-py-elementwise-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Record<string, [number[], number[]]>;

    for (const c of ELEMENTWISE_CASES) {
      const [fromList, fromArray] = actual[c.name];
      expectDeepClose(fromList, expected[c.name]);
      expectDeepClose(fromArray, expected[c.name]);
    }
  });
});

/**
 * The shapes that KEEP failing closed, each for a reason no Python emission
 * removes. Not venv-gated: these never reach execution.
 */
describe('PYTHON — arithmetic over a collection that stays declined', () => {
  const python = new PythonTarget();

  it('declines two collection operands', () => {
    // The interpreter answers `Error("incompatible-dimensions", "2 vs 3")` for
    // `[1,2] + [3,4,5]`. NumPy would answer `[4,5,6]` for `[1] + [3,4,5]` (it
    // recycles a length-1 axis) and a `zip` comprehension would truncate to
    // the shorter operand, so neither reproduces the error.
    ce.pushScope();
    ce.declare('v1', 'list<number>');
    ce.declare('v2', 'list<number>');
    expect(() => python.compile(ce.box(['Add', 'v1', 'v2']))).toThrow(
      /Fail closed/
    );
    expect(() =>
      python.compile(ce.box(['Add', ['List', 1, 2], ['List', 3, 4, 5]]))
    ).toThrow(/Fail closed/);
    ce.popScope();
  });

  it('declines a collection whose elements are not scalars', () => {
    // One level of fan-out would hand a whole ROW, or a POINT, to a scalar
    // operator. The interpreter answers `[[2, 3], [4, 5]]` for the matrix and
    // `[(3, 4), (6, 8)]` for the point list — neither is element-wise.
    ce.pushScope();
    ce.declare('mx', 'matrix<2x2>');
    ce.declare('pts', 'list<tuple<number, number>>');
    expect(() => python.compile(ce.box(['Add', 'mx', 1]))).toThrow(
      /Fail closed/
    );
    expect(() => python.compile(ce.box(['Multiply', 'pts', 2]))).toThrow(
      /Fail closed/
    );
    ce.popScope();
  });

  it('declines an operand that is only possibly a collection', () => {
    // A `broadcastable<T>` operand and a top-typed call may each bind to a
    // list at run time, which is the repeat/concatenate divergence itself.
    ce.pushScope();
    ce.declare('bc', 'broadcastable<number>');
    ce.declare('hh', '(number) -> unknown');
    expect(() => python.compile(ce.box(['Multiply', 2, 'bc']))).toThrow(
      /Fail closed/
    );
    expect(() => python.compile(ce.box(['Add', ['hh', 1], 1]))).toThrow(
      /Fail closed/
    );
    ce.popScope();
  });

  it('declines a negative integer exponent over a collection base', () => {
    // The one element lowering whose result depends on the container the
    // caller binds — the divergence the comprehension exists to remove.
    // Python's `**` answers a float for a negative integer exponent of an
    // `int` (`2 ** -2` is `0.25`), while NumPy refuses the same operation on
    // an integer array element: `np.int64(2) ** -2` raises `ValueError:
    // Integers to negative integer powers are not allowed` (measured, NumPy
    // 2.4.2). A `list<number>` operand admits an integer ndarray, so the
    // emitted comprehension would compute for one binding and throw for
    // another, where the interpreter answers `[1, 1/4, 1/16]` for both. This
    // shape used to compile and was executed here over a float ndarray only,
    // which never exercised the failing binding.
    ce.pushScope();
    ce.declare('vn', 'list<number>');
    expect(() => python.compile(ce.box(['Power', 'vn', -2]))).toThrow(
      /Fail closed/
    );
    // A non-negative integer exponent is uniform on both containers.
    expect(python.compile(ce.box(['Power', 'vn', 2])).code).toBe(
      '[_tv1 ** 2 for _tv1 in vn]'
    );
    ce.popScope();
  });
});

/**
 * Two emissions whose bug was that the source did not PARSE, or raised as soon
 * as it ran, behind `success: true`. Both are checked the only way that
 * settles it: `ast.parse` on the emitted module, then running it.
 *
 * - A rank-3 `Norm(t, "Frobenius")`. The Frobenius norm is the entry-wise
 *   `√(Σ|xᵢ|²)` at every rank, which is `np.linalg.norm`'s default order; only
 *   the SPELLING `'fro'` is matrix-only. The lowering used to fail closed
 *   above rank 1.
 * - A statement-form `If` with an else, inside a `Block`. Python assignment is
 *   a statement, so the conditional expression the value-arm lowering emits
 *   (`((r = 1) if (0 < x) else (r = 2))`) is a SyntaxError.
 */
describeMaybe('PYTHON EXECUTION PARITY — statement If and rank-3 Norm (venv)', () => {
  const python = new PythonTarget();

  /** `ast.parse` the source, then run it and return its stdout. */
  function parseAndRun(source: string): string {
    const file = path.join(os.tmpdir(), `ce-py-stmt-${process.pid}.py`);
    fs.writeFileSync(file, source);
    try {
      // A parse failure is reported on its own, so a SyntaxError in the
      // emitted module is never mistaken for a run-time error below.
      execFileSync(
        VENV_PYTHON,
        ['-c', `import ast,sys; ast.parse(open(${JSON.stringify(file)}).read())`],
        { encoding: 'utf8' }
      );
      return execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
  }

  it('a Block with a statement-form If parses, runs, and matches the interpreter', () => {
    const BLOCK = [
      'Block',
      ['Declare', 'r', { str: 'unknown' }, 0],
      ['If', ['Greater', 'x', 0], ['Assign', 'r', 1], ['Assign', 'r', 2]],
      'r',
    ];
    const scoped = new ComputeEngine();
    const fn = python.compileFunction(scoped.box(BLOCK as any), 'fn_stmt_if', [
      'x',
    ]);
    const out = parseAndRun(
      'import numpy as np\nimport cmath, math, json\n\n' +
        `${fn}\n` +
        'print(json.dumps([fn_stmt_if(3), fn_stmt_if(-3), fn_stmt_if(float("nan"))]))\n'
    );
    // Decided: the selected assignment runs. Undecided (NaN): NEITHER branch
    // runs and `r` keeps its initial 0 — the interpreter holds such an `If`
    // rather than choosing an arm, and the JavaScript statement form agrees.
    expect(JSON.parse(out)).toEqual([1, 2, 0]);
    // …and the two decided answers ARE the interpreted ones.
    for (const [x, expected] of [
      [3, 1],
      [-3, 2],
    ] as const) {
      const run = new ComputeEngine();
      run.assign('x', x);
      expect(run.box(BLOCK as any).evaluate().re).toBe(expected);
    }
  });

  it('a rank-3 Frobenius Norm parses, runs, and matches the interpreter', () => {
    const scoped = new ComputeEngine();
    const T3 = [
      'List',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', ['List', 5, 6], ['List', 7, 8]],
    ];
    // `constantFold: false`, or the fully constant call is evaluated at
    // compile time and there is no `np.linalg.norm` left to run.
    const fn = python.compileFunction(
      scoped.box(['Norm', T3, { str: 'Frobenius' }] as any),
      'fn_norm3',
      [],
      undefined,
      { constantFold: false }
    );
    expect(fn).toContain('np.linalg.norm([[[1, 2], [3, 4]], [[5, 6], [7, 8]]])');
    const out = parseAndRun(
      'import numpy as np\nimport cmath, math, json\n\n' +
        `${fn}\n` +
        'print(json.dumps(float(fn_norm3())))\n'
    );
    const interpreted = scoped.box(['Norm', T3, { str: 'Frobenius' }] as any).N().re!;
    expect(interpreted).toBeCloseTo(Math.sqrt(204), 10);
    expect(JSON.parse(out) as number).toBeCloseTo(interpreted, 10);
  });
});
