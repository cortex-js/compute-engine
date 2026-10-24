import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import {
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TEST_PYTHON } from './test-python';

/**
 * CO-P1-1 / CO-P1-4 execution parity.
 *
 * The Python target previously emitted code that was not valid Python
 * (JS-style ternaries, bare `NaN`, `and(a, b)` keyword-as-function calls, `&&`
 * chains) yet reported `success: true`. This suite compiles a battery of
 * expressions covering If / Which / When / And / Or / Not / relational chains /
 * NaN / exact Equal, then **actually runs the emitted Python** through the
 * repo's `./venv/bin/python3` and asserts the value matches the interpreter's
 * `.N()` (booleans, or floats within 1e-10, or NaN).
 *
 * The suite is skipped when the venv (with numpy) is not available, so it never
 * blocks a checkout without the benchmark environment.
 */

// Repo root is two levels up from test/compute-engine; fall back to cwd.
const VENV_PYTHON =
  TEST_PYTHON ?? path.join(process.cwd(), 'venv', 'bin', 'python3');

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
    name: 'exact_odd_denominator_power',
    expr: ['Power', 'x', ['Rational', -5, 3]],
    params: ['x'],
    inputs: [{ x: -8 }, { x: -1.2 }, { x: 0.3 }, { x: 2 }],
  },
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
    // Compiled equality is exact, so the inputs are binary-exact sums: the
    // interpreter's tolerant `Equal` and the emitted `==` agree on both.
    name: 'equal_exact',
    expr: ['Equal', ['Add', 'x', 0.25], 0.75],
    params: ['x'],
    inputs: [{ x: 0.5 }, { x: 0.1 }],
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
    name: 'eq_coll_equal',
    expr: ['Equal', ['List', 1, 2], ['List', 1, 2]],
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
  // A search is structural (user decision 2026-09-26, `SEARCHED_VALUE_POLICY`
  // in `library/collections.ts`): a restricted number whose condition is
  // false is `nan`, and it is found where the list holds `nan`, as the
  // interpreter finds it. The compiled element test is `_ce_same`, whose
  // float leaf reads `nan` as the same as `nan`. A needle that may be the
  // OBJECT-domain absence `Missing` does not compile on this target (it would
  // spell as `nan` too); see `compile-python.test.ts`.
  {
    name: 'index_of_restricted',
    expr: ['IndexOf', ['List', 1, 'NaN', 2], ['When', 2, ['Less', 0, 'x']]],
    params: ['x'],
    inputs: [{ x: -1 }, { x: 2 }],
  },
  {
    name: 'contains_restricted',
    expr: ['Contains', ['List', 1, 'NaN'], ['When', 2, ['Less', 0, 'x']]],
    params: ['x'],
    inputs: [{ x: -1 }, { x: 2 }],
  },
  {
    name: 'element_restricted',
    expr: ['Element', ['When', 1, ['Less', 0, 'x']], ['List', 1, 'NaN']],
    params: ['x'],
    inputs: [{ x: -1 }, { x: 2 }],
  },
  {
    name: 'index_of_nan',
    expr: ['IndexOf', ['List', 1, 'NaN'], 'NaN'],
    params: [],
    inputs: [{}],
  },
  {
    name: 'contains_restricted_sum',
    expr: [
      'Contains',
      ['List', 6, 'NaN'],
      ['Add', ['When', 5, ['Less', 0, 'x']], 1],
    ],
    params: ['x'],
    inputs: [{ x: -1 }, { x: 2 }],
  },
  {
    name: 'index_of_nested_selection',
    expr: [
      'IndexOf',
      ['List', 'NaN', 2],
      ['Which', 'True', ['When', 2, ['Less', 0, 'x']]],
    ],
    params: ['x'],
    inputs: [{ x: -1 }, { x: 2 }],
  },
];

const describeMaybe = venvHasNumpy() ? describe : describe.skip;

describeMaybe('PYTHON EXECUTION PARITY (venv)', () => {
  const python = new PythonTarget();

  it('emitted Python is valid and matches the interpreter .N()', () => {
    // `math` is imported for the `math.nan` of an absent number (`Missing`).
    let src = 'import numpy as np\nimport cmath\nimport json\nimport math\n\n';
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
 * Upper incomplete gamma at a non-positive order (cortex-js/compute-engine#457).
 *
 * `scipy.special.gammaincc` is `nan` for every order `a < 0` and for
 * `a = −1`, and `gamma(a)` is a pole at the non-positive integers, so the
 * lowerings `GammaRegularized → gammaincc` and
 * `Gamma(s, z) → gammaincc·gamma` gave `nan` where the interpreter has a
 * value, and a constant `s ≤ 0` made `Gamma(s, z)` fail to compile. Both now
 * go through the `_ce_ugamma` helper.
 *
 * Each row is `[a, z, Q(a, z), Γ(a, z)]`, with the references computed by
 * mpmath at 60 digits or more (checked against 120 digits). A value beyond
 * the double range is `±Infinity`, with the sign of the exact value; a value
 * below it is 0. At `z = 0`, Q is `nan` for a non-positive integer `a` and
 * `±Infinity` (the sign of `Γ(a)`) for another negative `a`, and Γ(a, 0) is
 * `+Infinity` for a non-positive integer `a` (the limit as `z → 0⁺`).
 */
const UPPER_GAMMA_REFERENCES: Array<[number, number, number, number]> = [
  [-0.5, 0, -Infinity, -3.5449077018110321],
  [-0.5, 1e-8, -5640.8958918965211, 19996.455292298188],
  [-0.5, 0.3, -0.3245125526871861, 1.1503670473551643],
  [-0.5, 1, -0.050254541660012221, 0.17814771178156069],
  [-0.5, 2, -0.0084907026168296375, 0.030098757100186466],
  [-0.5, 9.9, -3.9861580819582001e-7, 1.4130562485369915e-6],
  [-0.5, 30, -1.5321801591977471e-16, 5.4314372469021468e-16],
  [-0.5, 120, -1.6253008746969714e-56, 5.7615415884735011e-56],
  [-0.999999, 0, -Infinity, -1.0000004227569913e6],
  [-0.999999, 1e-8, -99.998196828915809, 9.9998239103852633e7],
  [-0.999999, 0.3, -1.5637157075865509e-6, 1.5637163686582986],
  [-0.999999, 1, -1.4849549465073812e-7, 0.14849555742824666],
  [-0.999999, 2, -1.8767140486992965e-8, 0.018767148420932812],
  [-0.999999, 9.9, -4.3126278621222646e-13, 4.3126296853158441e-7],
  [-0.999999, 30, -9.7655939425298826e-23, 9.7655980710029957e-17],
  [-0.999999, 120, -5.2381802148338649e-63, 5.2381824293111723e-57],
  [-1, 0, NaN, Infinity],
  [-1, 1e-8, 0, 9.9999981156534914e7],
  [-1, 0.3, 0, 1.5637174172632129],
  [-1, 1, 0, 0.14849550677592205],
  [-1, 2, 0, 0.018767130910245226],
  [-1, 9.9, 0, 4.3126194550910807e-7],
  [-1, 30, 0, 9.7655645591245657e-17],
  [-1, 120, 0, 5.2381573090156101e-57],
  [-1.000001, 0, Infinity, 999999.57729934338],
  [-1.000001, 1e-8, 100.00176551047696, 1.0000172323966501e8],
  [-1.000001, 0.3, 1.5637191268542545e-6, 1.5637184658691528],
  [-1.000001, 1, 1.4849551889278088e-7, 0.14849545612362754],
  [-1.000001, 2, 1.8767121332449327e-8, 0.018767113399574817],
  [-1.000001, 9.9, 4.3126110478341319e-13, 4.3126092248906102e-7],
  [-1.000001, 30, 9.765535175259279e-23, 9.7655310473611481e-17],
  [-1.000001, 120, 5.2381344030033699e-63, 5.2381321888405183e-57],
  [-2, 0, NaN, Infinity],
  [-2, 1e-8, 0, 4.9999999000000095e15],
  [-2, 0.3, 0, 3.3337980729334931],
  [-2, 1, 0, 0.10969196719776014],
  [-2, 2, 0, 0.0075333449494539733],
  [-2, 9.9, 0, 4.0336183944636258e-8],
  [-2, 30, 0, 3.1589714757114749e-18],
  [-2, 120, 0, 4.3299148867889271e-59],
  [-3.0001, 0, Infinity, 1666.4573519137095],
  [-3.0001, 1e-8, 2.0038723780671768e20, 3.3393678567268552e23],
  [-3.0001, 0.3, 0.0048218330652496277, 8.0353791612858595],
  [-3.0001, 1, 5.1642849730910034e-5, 0.086060606607849962],
  [-3.0001, 2, 1.8767864712997863e-6, 0.003127584613069717],
  [-3.0001, 9.9, 2.2746189109637357e-12, 3.7905554069774728e-9],
  [-3.0001, 30, 6.1349622943564012e-23, 1.0223653019143624e-19],
  [-3.0001, 120, 2.146869018423641e-64, 3.5776656593478456e-61],
  [-10.5, 0, -Infinity, -2.6401218205477163e-7],
  [-10.5, 1e-8, -3.6073371101378068e89, 9.5238094185463644e82],
  [-10.5, 0.3, -8.0106891825849281e10, 21149.195308568018],
  [-10.5, 1, -120190.36849742541, 0.031731721448972367],
  [-10.5, 2, -27.941055279334993, 7.3767789732102282e-6],
  [-10.5, 9.9, -3.1977714813221354e-10, 8.4425062649637638e-17],
  [-10.5, 30, -2.6578598244039052e-24, 7.0170737183658719e-31],
  [-10.5, 120, -3.25832463615618e-70, 8.6023739703441294e-77],
  [-60.3, 0, -Infinity, -1.3619676564644575e-82],
  [-60.3, 1e-8, -Infinity, Infinity],
  [-60.3, 0.3, -3.0382570321609184e111, 4.1380078098288639e29],
  [-60.3, 1, -4.4051514012079002e79, 0.0059996737302742449],
  [-60.3, 2, -1.1231049003680305e61, 1.5296325491179945e-21],
  [-60.3, 9.9, -4.8116938680126657e15, 6.5533714210416109e-67],
  [-60.3, 30, -6.4461236988128171e-23, 8.7794119873520928e-105],
  [-60.3, 120, -1.3130257517171432e-98, 1.7882986059436801e-180],
  [-150.5, 0, -Infinity, -4.4784476581506408e-264],
  [-150.5, 1e-8, -Infinity, Infinity],
  [-150.5, 0.3, -Infinity, 2.4241289114181957e76],
  [-150.5, 1, -5.4218355049794989e260, 0.0024281406520153434],
  [-150.5, 2, -9.816614926509487e214, 4.3963196128593037e-49],
  [-150.5, 9.9, -1.0020467366749407e107, 4.4876138612193798e-157],
  [-150.5, 30, -5.7070385460019191e25, 2.5558673411317733e-238],
  [-150.5, 120, -7.6538141806818747e-105, 0],
  [0.5, 0, 1, 1.772453850905516],
  [0.5, 1e-8, 0.99988716208366658, 1.7722538509061827],
  [0.5, 1, 0.15729920705028513, 0.27880558528066198],
  [0.5, 120, 3.9328331793485131e-54, 6.970765313705256e-54],
  [2, 0, 1, 1],
  [2, 1, 0.73575888234288464, 0.73575888234288464],
  [2, 120, 9.2778541692036196e-51, 9.2778541692036196e-51],
  // Γ(s, z) for an order where `gamma(s)` overflows, and where Q underflows
  // while Γ(s, z) is a normal double.
  [200, 1000, 1.6065441803414137e-210, 6.3350685354768734e162],
  [150, 1500, 0, 6.9386544596311331e-179],
  // A positive order near 0 (Γ(s, z) ≈ E₁(z)), where the continued fraction
  // does not converge and `gammaincc` loses digits, and a subnormal order.
  [1e-305, 0.01, 4.0379295765381138e-305, 4.0379295765381138],
  [1e-305, 1e-100, 2.2968129363450303e-303, 229.68129363450304],
  [1e-310, 1e-5, 1.0935719800043662e-309, 10.935719800043696],
  [-5e-324, 0.5, -5e-324, 0.55977359477616081],
];

/** Whether `actual` matches the reference `expected` of
 * `UPPER_GAMMA_REFERENCES`: the same special value, or a relative error
 * below 1e-12. */
function upperGammaMatches(actual: number, expected: number): boolean {
  if (Number.isNaN(expected)) return Number.isNaN(actual);
  if (expected === 0 || !Number.isFinite(expected)) return actual === expected;
  return Math.abs((actual - expected) / expected) < 1e-12;
}

/** Python's `repr` of a float, read back as a number. */
function pythonFloat(x: string): number {
  return { 'nan': NaN, 'inf': Infinity, '-inf': -Infinity }[x] ?? Number(x);
}

describeScipyMaybe(
  'PYTHON EXECUTION PARITY — upper incomplete gamma at a non-positive order (venv)',
  () => {
    const python = new PythonTarget();

    /** Run `program`, which prints a JSON list of float `repr`s. */
    function runFloats(program: string, tag: string): number[] {
      const file = path.join(
        os.tmpdir(),
        `ce-py-ugamma-${tag}-${process.pid}.py`
      );
      fs.writeFileSync(file, program);
      let out = '';
      try {
        out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      return (JSON.parse(out) as string[]).map(pythonFloat);
    }

    const header =
      'import numpy as np\nimport cmath\nimport scipy.special\nimport json\n\n';
    const fns =
      `${python.compileFunction(ce.box(['GammaRegularized', 'a', 'z']), 'fn_q', ['a', 'z'])}\n` +
      `${python.compileFunction(ce.box(['Gamma', 'a', 'z']), 'fn_g', ['a', 'z'])}\n`;

    it('the order is a variable: the lowering goes through the helper', () => {
      expect(fns).toContain('return _ce_ugamma(a, z, True)');
      expect(fns).toContain('return _ce_ugamma(a, z, False)');
    });

    it('scalar operands match mpmath', () => {
      let program = `${header}${fns}\nresults = []\n`;
      for (const [a, z] of UPPER_GAMMA_REFERENCES)
        program +=
          `results.append(repr(float(fn_q(${a}, ${z}))))\n` +
          `results.append(repr(float(fn_g(${a}, ${z}))))\n`;
      program += 'print(json.dumps(results))\n';
      const actual = runFloats(program, 'scalar');
      expect(actual.length).toBe(2 * UPPER_GAMMA_REFERENCES.length);
      // On a mismatch the message shows the operands and the actual value.
      const check = (
        what: string,
        a: number,
        z: number,
        x: number,
        e: number
      ) =>
        expect([what, a, z, upperGammaMatches(x, e) ? 'ok' : x]).toEqual([
          what,
          a,
          z,
          'ok',
        ]);
      UPPER_GAMMA_REFERENCES.forEach(([a, z, q, g], i) => {
        check('Q', a, z, actual[2 * i], q);
        check('Gamma', a, z, actual[2 * i + 1], g);
      });
    });

    it('array operands broadcast and match mpmath element by element', () => {
      const as = UPPER_GAMMA_REFERENCES.map(([a]) => a).join(', ');
      const zs = UPPER_GAMMA_REFERENCES.map(([, z]) => z).join(', ');
      // The orders as a column and the arguments as a row: a 2-D result whose
      // diagonal is the table.
      const program =
        `${header}${fns}\n` +
        `_a = np.array([${as}])\n_z = np.array([${zs}])\n` +
        `_q = fn_q(_a[:, None], _z[None, :])\n_g = fn_g(_a[:, None], _z[None, :])\n` +
        `assert _q.shape == (len(_a), len(_z)) and _g.shape == _q.shape\n` +
        `print(json.dumps([repr(float(_x)) for _x in np.concatenate([np.diag(_q), np.diag(_g)])]))\n`;
      const actual = runFloats(program, 'array');
      const n = UPPER_GAMMA_REFERENCES.length;
      expect(actual.length).toBe(2 * n);
      const check = (
        what: string,
        a: number,
        z: number,
        x: number,
        e: number
      ) =>
        expect([what, a, z, upperGammaMatches(x, e) ? 'ok' : x]).toEqual([
          what,
          a,
          z,
          'ok',
        ]);
      UPPER_GAMMA_REFERENCES.forEach(([a, z, q, g], i) => {
        check('Q', a, z, actual[i], q);
        check('Gamma', a, z, actual[n + i], g);
      });
    });

    it('a complex element is nan unless it is exactly real', () => {
      // `np.asarray(…, dtype=float)` of a complex array drops the imaginary
      // part without an error, so the helper tests each element, as the
      // runtime guard of a real-only head does.
      const program =
        `${header}${fns}\n` +
        `_g = fn_g(np.array([-1 + 0j, -1 + 1j, 2]), 2)\n` +
        `_q = fn_q(np.array([-1.5 + 0j, -1.5 + 1j]), 0.001)\n` +
        `print(json.dumps([repr(float(_x)) for _x in list(_g) + list(_q)]))\n`;
      const [g0, g1, g2, q0, q1] = runFloats(program, 'complex');
      expect(upperGammaMatches(g0, 0.018767130910245226)).toBe(true);
      expect(g1).toBeNaN();
      expect(upperGammaMatches(g2, 0.40600584970983808)).toBe(true);
      expect(upperGammaMatches(q0, 8894.845339577239695)).toBe(true);
      expect(q1).toBeNaN();
    });

    it('an operand of Gamma(s, z) that is certainly not real fails closed', () => {
      const scoped = new ComputeEngine();
      scoped.declare('t', 'real');
      expect(() =>
        python.compileFunction(
          scoped.box(['Gamma', ['Add', 't', 'ImaginaryUnit'], 2]),
          'f',
          ['t']
        )
      ).toThrow(/certainly not a real number/);
    });

    it('an infinite order matches the interpreter', () => {
      const I = Infinity;
      const points: Array<[number, number]> = [
        [I, I],
        [-I, I],
        [I, -I],
        [I, 0],
        [I, 0.5],
        [I, 2],
        [I, -3],
        [-I, 0],
        [-I, 0.5],
        [-I, 1],
        [-I, 2],
        [-I, -3],
        [2, I],
        [-0.5, I],
        [-1, I],
      ];
      const py = (x: number) =>
        x === I ? "float('inf')" : x === -I ? "-float('inf')" : String(x);
      let program = `${header}${fns}\nresults = []\n`;
      for (const [a, z] of points)
        program +=
          `results.append(repr(float(fn_q(${py(a)}, ${py(z)}))))\n` +
          `results.append(repr(float(fn_g(${py(a)}, ${py(z)}))))\n`;
      program += 'print(json.dumps(results))\n';
      const actual = runFloats(program, 'infinite');
      points.forEach(([a, z], i) => {
        for (const [k, head] of [
          [0, 'GammaRegularized'],
          [1, 'Gamma'],
        ] as const) {
          const expected = ce.box([head, ce.number(a), ce.number(z)]).N().re;
          const x = actual[2 * i + k];
          expect([
            head,
            a,
            z,
            upperGammaMatches(x, expected) ? 'ok' : x,
          ]).toEqual([head, a, z, 'ok']);
        }
      });
      // Q(s, +∞) is a zero with the sign of Γ(s).
      expect(Object.is(actual[2 * 13], -0)).toBe(true);
      expect(Object.is(actual[2 * 12], 0)).toBe(true);
    });

    it('a constant order compiles, and matches mpmath and the interpreter', () => {
      // Before #457 a constant `s ≤ 0` made `Gamma(s, z)` fail to compile.
      // [expression, z, mpmath reference]
      const cases: Array<[any, number, number]> = [
        [['Gamma', -1, 'z'], 2, 0.018767130910245226],
        [['Gamma', 0, 'z'], 2, 0.04890051070806112],
        [['GammaRegularized', -1.5, 'z'], 0.001, 8894.845339577239695],
        [['GammaRegularized', 0, 'z'], 1, 0],
      ];
      let program = `${header}\nresults = []\n`;
      cases.forEach(([expr, z], i) => {
        const code = python.compileFunction(ce.box(expr), `fn_${i}`, ['z']);
        expect(code).toContain('_ce_ugamma(');
        program += `${code}\nresults.append(repr(float(fn_${i}(${z}))))\n`;
      });
      program += 'print(json.dumps(results))\n';
      const actual = runFloats(program, 'const');
      cases.forEach(([expr, z, expected], i) => {
        expect([expr, upperGammaMatches(actual[i], expected)]).toEqual([
          expr,
          true,
        ]);
        const interpreted = ce.box(expr).subs({ z }).N().re;
        expect(Math.abs(interpreted - expected)).toBeLessThanOrEqual(
          1e-12 * Math.max(1, Math.abs(expected))
        );
      });
    });
  }
);

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
    // A negative count counts from the end; a count past the length is clamped.
    { name: 'take_neg', expr: ['Take', L, -2], expected: [4, 3] },
    { name: 'drop_neg', expr: ['Drop', L, -2], expected: [1, 5, 2] },
    { name: 'take_neg_past', expr: ['Take', L, -9], expected: [1, 5, 2, 4, 3] },
    { name: 'drop_neg_past', expr: ['Drop', L, -9], expected: [] },
    { name: 'take_zero', expr: ['Take', L, 0], expected: [] },
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
 * `ReplaceAt`, `DeleteAt` and `Insert` (issue #386), with the index as a
 * parameter so the lowering runs instead of a compile-time fold. Each value is
 * compared with the interpreter's. Where the interpreter leaves the
 * expression unevaluated (a zero or out-of-range index), the emitted Python
 * raises an `IndexError`.
 */
describeMaybe('PYTHON EXECUTION PARITY — ReplaceAt / DeleteAt / Insert (venv)', () => {
  const python = new PythonTarget();

  it('emitted Python matches the interpreter, and raises where it stays unevaluated', () => {
    const L = ['List', 10, 20, 30];
    const heads: Array<[string, any[]]> = [
      ['ReplaceAt', [9]],
      ['DeleteAt', []],
      ['Insert', [9]],
    ];
    const ks = [1, 2, 3, 4, -1, -3, -4, -5, 0];
    let src = 'import numpy as np\nimport json\n\n';
    for (const [head, rest] of heads)
      src += `${python.compileFunction(ce.box([head, L, 'k', ...rest]), `fn_${head}`, ['k'], undefined, { constantFold: false })}\n`;
    src += [
      'def _run(f, k):',
      '    try:',
      '        return [float(v) for v in f(k)]',
      '    except IndexError:',
      "        return 'IndexError'",
      'results = {}',
      ...heads.map(
        ([head]) =>
          `results[${JSON.stringify(head)}] = [_run(fn_${head}, k) for k in ${JSON.stringify(ks)}]`
      ),
      "results['bad'] = [_run(f, k) for f in (fn_ReplaceAt, fn_DeleteAt, fn_Insert) for k in (1.5, True)]",
      'print(json.dumps(results))',
      '',
    ].join('\n');
    const file = path.join(os.tmpdir(), `ce-py-listupdate-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Record<string, any>;
    for (const [head, rest] of heads) {
      const expected = ks.map((k) => {
        const v = ce.box([head, L, k, ...rest] as any).evaluate();
        return v.operator === 'List' ? v.ops!.map((x) => x.re) : 'IndexError';
      });
      expect(actual[head]).toEqual(expected);
    }
    expect(actual.bad).toEqual(Array(6).fill('IndexError'));
  });

  it('a Fold with a ReplaceAt step compiles and runs', () => {
    const fold = [
      'Fold',
      ['Function', ['ReplaceAt', 'acc', 'i', ['Multiply', 'i', 'i']], 'acc', 'i'],
      ['List', 0, 0, 0, 0],
      ['Range', 1, 'n'],
    ];
    const src =
      'import numpy as np\nimport json\n\n' +
      `${python.compileFunction(ce.box(fold), 'fn_fold', ['n'], undefined, { constantFold: false })}\n` +
      'print(json.dumps([float(v) for v in fn_fold(4)]))\n';
    const file = path.join(os.tmpdir(), `ce-py-listfold-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual([1, 4, 9, 16]);
  });

  // A string seed that no step updates is the result, as in the interpreter:
  // the seed is not converted before the first update. Only an update of the
  // string raises the `TypeError`. Before, the seed was converted before the
  // first step, so an empty source raised the `TypeError` too.
  it('a string seed that no step updates is the result', () => {
    const e = new ComputeEngine();
    e.declare('t', 'string');
    e.declare('p', 'list<integer>');
    const fold = ['Fold', ['Function', ['ReplaceAt', 'acc', 1, { str: 'x' }], 'acc', 'i'], 't', 'p'];
    const fn = python.compileFunction(e.box(fold), 'fn_str0', ['t', 'p'], undefined, { constantFold: false });
    expect(fn).toContain('_ce_replaceat_inplace(');
    const src =
      'import numpy as np\nimport json\n\n' +
      `${fn}\n` +
      'print(json.dumps(fn_str0("abc", [])))\n' +
      'try:\n    fn_str0("abc", [1])\n    print("no error")\nexcept TypeError:\n    print("TypeError")\n';
    const file = path.join(os.tmpdir(), `ce-py-liststr0-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(out.trim().split('\n')).toEqual(['"abc"', 'TypeError']);
  });

  // Python has no standard grapheme segmentation, so a string that reaches
  // these helpers at run time raises a `TypeError` rather than being walked
  // by code points. A list of lists given to a statistic does not compile, and
  // the interpreter answers.
  it('a string seed raises, and a statistic of a list of lists does not compile', () => {
    const e = new ComputeEngine();
    e.declare('t', 'string');
    const fold = ['Fold', ['Function', ['ReplaceAt', 'acc', 'i', { str: 'x' }], 'acc', 'i'], 't', ['Range', 1, 2]];
    const src =
      'import numpy as np\nimport json\n\n' +
      `${python.compileFunction(e.box(fold), 'fn_str', ['t'], undefined, { constantFold: false })}\n` +
      'try:\n    fn_str("abc")\n    print("no error")\nexcept TypeError:\n    print("TypeError")\n';
    const file = path.join(os.tmpdir(), `ce-py-liststr-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(out.trim()).toBe('TypeError');
    // A statistic of a list of lists is refused when it is boxed: its data
    // parameter is a collection of numbers (ROADMAP CE-13, CE-402), so the
    // compiler refuses an invalid expression.
    e.declare('m', 'list<list<integer>>');
    for (const head of ['Mean', 'Median', 'Variance'])
      expect(() => python.compileFunction(e.box([head, 'm']), 'fn_stat', ['m'])).toThrow(
        /Could not compile invalid expression: .*incompatible-type/
      );
    // Python's `+` joins two lists, so a built-in fold over rows does not
    // compile; nor does a step typed for numbers (`Mean(acc)`) over rows.
    expect(() => python.compileFunction(e.box(['Scan', 'm', 'Add']), 'fn_scan', ['m'])).toThrow(
      /elements that are collections/
    );
    expect(() =>
      python.compileFunction(
        e.box(['Fold', ['Function', ['ReplaceAt', 'acc', 'i', ['Mean', 'acc']], 'acc', 'i'], 'm', ['Range', 1, 2]]),
        'fn_fold',
        ['m']
      )
    ).toThrow(/typed for/);
  });

  // The step only updates its accumulator, so the fold updates a copy of the
  // seed in place (`inPlaceUpdateChains`). The swap must read both old values
  // before either write, and the caller's list must not change.
  it('a Fold that swaps two slots updates a copy of the seed in place', () => {
    const next = ['Add', ['Mod', 'i', 4], 1];
    const fold = [
      'Fold',
      [
        'Function',
        ['ReplaceAt', ['ReplaceAt', 'acc', 'i', ['At', 'acc', next]], next, ['At', 'acc', 'i']],
        'acc',
        'i',
      ],
      's',
      ['Range', 1, 4],
    ];
    ce.declare('s', 'list<integer>');
    const fn = python.compileFunction(ce.box(fold), 'fn_swap', ['s'], undefined, { constantFold: false });
    expect(fn).toContain('_ce_replaceat_inplace(');
    const src =
      'import numpy as np\nimport json\n\n' +
      `${fn}\n` +
      's = [1, 2, 3, 4]\n' +
      'r = fn_swap(s)\n' +
      'print(json.dumps([[float(v) for v in r], [float(v) for v in s]]))\n';
    const file = path.join(os.tmpdir(), `ce-py-listswap-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const e = new ComputeEngine();
    e.declare('s', 'list<integer>');
    e.assign('s', e.box(['List', 1, 2, 3, 4]));
    const want = e.box(fold as any).evaluate().ops!.map((x) => x.re);
    expect(JSON.parse(out)).toEqual([want, [1, 2, 3, 4]]);
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
      /Could not compile/
    );
    expect(() =>
      python.compile(ce.box(['Add', ['List', 1, 2], ['List', 3, 4, 5]]))
    ).toThrow(/Could not compile/);
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
      /Could not compile/
    );
    expect(() => python.compile(ce.box(['Multiply', 'pts', 2]))).toThrow(
      /Could not compile/
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
      /Could not compile/
    );
    expect(() => python.compile(ce.box(['Add', ['hh', 1], 1]))).toThrow(
      /Could not compile/
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
      /Could not compile/
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
    // The selected assignment runs. At NaN, `x > 0` is decided false (user
    // decision 2026-10-20, Tycho rows 411 and 413), so the else assignment
    // runs; before the decision NEITHER branch ran and `r` kept its 0.
    expect(JSON.parse(out)).toEqual([1, 2, 2]);
    // …and the three answers ARE the interpreted ones.
    for (const [x, expected] of [
      [3, 1],
      [-3, 2],
      [NaN, 2],
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

/**
 * `Norm` over entries that are NaN or infinite, and `Degrees` of a compound
 * operand.
 *
 * - The interpreter answers `+∞` for a norm with an infinite entry (a NaN
 *   entry included) and NaN for a norm with a NaN entry. numpy answers `nan`
 *   for `[inf, nan]`, and its spectral norm (`ord=2` on a matrix) raises
 *   `LinAlgError` for a matrix with a NaN or infinite entry.
 * - `Degrees(x + 1)` must multiply the whole sum by π/180. Without
 *   parentheses, Python reads `x + 1 * np.pi / 180`.
 */
describeMaybe(
  'PYTHON EXECUTION PARITY — non-finite Norm and Degrees (venv)',
  () => {
    const python = new PythonTarget();

    function run(source: string): string {
      const file = path.join(os.tmpdir(), `ce-py-norm-${process.pid}.py`);
      fs.writeFileSync(file, source);
      try {
        return execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
    }

    it('a norm with a NaN or an infinite entry matches the interpreter', () => {
      const scoped = new ComputeEngine();
      const matrices = [
        [
          ['List', 'NaN', 1],
          ['List', 2, 3],
        ],
        [
          ['List', 'PositiveInfinity', 'NaN'],
          ['List', 2, 3],
        ],
        [
          ['List', 'PositiveInfinity', 1],
          ['List', 2, 3],
        ],
        [
          ['List', 'NaN', 0],
          ['List', 'PositiveInfinity', 0],
        ],
      ];
      const cases: unknown[] = [];
      for (const m of matrices)
        for (const p of [1, 2, 'PositiveInfinity', undefined])
          cases.push(
            p === undefined
              ? ['Norm', ['List', ...m]]
              : ['Norm', ['List', ...m], p]
          );
      for (const p of [1, 2, 3, undefined])
        cases.push(
          p === undefined
            ? ['Norm', ['List', 'PositiveInfinity', 'NaN']]
            : ['Norm', ['List', 'PositiveInfinity', 'NaN'], p]
        );
      const lines = ['import numpy as np', 'import json', 'out = []'];
      const expected: (number | null)[] = [];
      for (const c of cases) {
        const expr = scoped.box(c as any);
        const code = python.compile(expr, { constantFold: false }).code;
        lines.push(`out.append(float(${code}))`);
        const v = expr.N().re;
        expected.push(Number.isNaN(v) ? null : v);
      }
      lines.push(
        "print(json.dumps([None if v != v else ('inf' if v == float('inf') else v) for v in out]))"
      );
      const got = JSON.parse(run(lines.join('\n'))) as (
        | number
        | string
        | null
      )[];
      expect(got).toEqual(expected.map((v) => (v === Infinity ? 'inf' : v)));
      // The interpreter answers +∞ whenever an entry is infinite.
      expect(expected.filter((v) => v === Infinity).length).toBe(16);
    });

    it('Degrees of a sum multiplies the whole sum', () => {
      const scoped = new ComputeEngine();
      const expr = scoped.box(['Sin', ['Degrees', ['Add', 'x', 1]]] as any);
      const fn = python.compileFunction(expr, 'fn_deg', ['x']);
      const out = run(
        `import numpy as np\n\n${fn}\nprint(float(fn_deg(179)))\n`
      );
      // sin(180°) is 0.
      expect(Math.abs(Number(out))).toBeLessThan(1e-12);
    });
  }
);

/**
 * The absence marker of an element read, run in the venv. An out-of-range
 * position, and a restricted collection whose condition is false (`None` at
 * run time), answer the marker of the element domain, as the interpreter
 * does (user decision 2026-09-26, `docs/ERROR-MODEL.md` §2): NaN for a
 * number, `Missing` (`None`) for a row, a point or a string. Each case is
 * run with the condition false (`t = -1`) and true (`t = 1`), and compared
 * with the interpreter's value.
 */
describeMaybe('PYTHON EXECUTION PARITY — absence marker of element reads (venv)', () => {
  const python = new PythonTarget();
  const scoped = new ComputeEngine();
  scoped.declare('t', 'real');
  const W = (x: unknown) => ['When', x, ['Less', 0, 't']];
  const M = W(['List', ['List', 1, 2], ['List', 3, 4]]);
  const CASES: Array<[string, unknown]> = [
    ['first_pair', ['First', W(['Tuple', 1, 2])]],
    ['second_pair', ['Second', W(['Tuple', 1, 2])]],
    ['third_pair', ['Third', W(['Tuple', 1, 2])]],
    ['last_list', ['Last', W(['List', 1, 2])]],
    ['at_list', ['At', W(['List', 1, 2]), 1]],
    ['at_row', ['At', M, 2]],
    ['first_points', ['First', W(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]])]],
    ['at_points_out_of_range', ['At', ['List', ['Tuple', 1, 2]], 5]],
    ['third_points', ['Third', ['List', ['Tuple', 1, 2]]]],
    ['at_out_of_range', ['At', ['List', 1, 2], 5]],
    ['first_empty', ['First', ['List']]],
  ];

  /** The interpreter's value in the form the Python serializer prints. */
  function interpreted(json: unknown, t: number): unknown {
    const v = scoped
      .box(json as never)
      .subs({ t: scoped.number(t) })
      .evaluate();
    if (isSymbol(v, 'Missing')) return 'None';
    if (isNumber(v)) return v.isNaN ? 'nan' : v.re;
    return v.ops!.map((x) => x.re);
  }

  it('matches the interpreter', () => {
    let src = 'import numpy as np\nimport json\nimport math\n\n';
    for (const [name, json] of CASES)
      src += `${python.compileFunction(scoped.box(json as never), `fn_${name}`, ['t'])}\n`;
    src +=
      '\ndef _ser(z):\n' +
      "    if z is None: return 'None'\n" +
      '    if isinstance(z, (list, tuple, np.ndarray)): return [_ser(v) for v in list(z)]\n' +
      "    return 'nan' if math.isnan(float(z)) else float(z)\n\n" +
      'results = {}\n';
    for (const [name] of CASES)
      src += `results[${JSON.stringify(name)}] = [_ser(fn_${name}(-1)), _ser(fn_${name}(1))]\n`;
    src += 'print(json.dumps(results))\n';

    const file = path.join(os.tmpdir(), `ce-py-absence-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Record<string, unknown[]>;
    for (const [name, json] of CASES)
      expect([name, actual[name]]).toEqual([
        name,
        [interpreted(json, -1), interpreted(json, 1)],
      ]);
  });
});

/**
 * Every operator that takes a predicate tests its result as the interpreter
 * does, with the inputs of the JavaScript tests in
 * `compile-range-predicate-loop.test.ts`. The Python lowerings read the
 * result with the truthiness of Python, so `1` selected an element:
 * `Filter(xs, x ↦ If(x > 1, True, 1))` over `[1, 2]` answered `[1, 2]`,
 * where the interpreter throws. So did `nan`, the spelling of `Missing` on
 * this target: `Filter(xs, x ↦ If(x > 1, True, Missing))` answered `[1, 2]`
 * where the interpreter answers `[2]`. A predicate whose result type does not
 * prove a boolean is now checked at each call (`_ce_predicate`), and a
 * Python `TypeError` is raised where the JavaScript target throws.
 */
describeMaybe('PYTHON — predicates with a result that is not provably a boolean (venv)', () => {
  const python = new PythonTarget();
  const T1 = ['Function', ['If', ['Greater', 'x', 1], 'True', 1], 'x'];
  const F1 = ['Function', ['If', ['Greater', 'x', 1], 'False', 1], 'x'];
  const MISSING = ['Function', ['If', ['Greater', 'x', 1], 'True', 'Missing'], 'x'];
  const BOOL = ['Function', ['Greater', 'x', 1], 'x'];

  /** The compiled function and its value at `xs = [1, 2]`, as JSON, or the
   * string `"TypeError"` when it raises one. */
  function run(json: unknown): { code: string; value: unknown } {
    const e = new ComputeEngine();
    e.declare('xs', 'list<integer>');
    const code = python.compileFunction(e.box(json as any), 'fn_pred', ['xs']);
    const src =
      'import numpy as np\nimport json\nimport math\n\n' +
      `${code}\n` +
      'try:\n' +
      '    r = fn_pred([1, 2])\n' +
      '    print(json.dumps(r.tolist() if hasattr(r, "tolist") else r))\n' +
      'except TypeError:\n' +
      '    print(json.dumps("TypeError"))\n';
    const file = path.join(os.tmpdir(), `ce-py-pred-${process.pid}.py`);
    fs.writeFileSync(file, src);
    try {
      return {
        code,
        value: JSON.parse(execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' })),
      };
    } finally {
      fs.unlinkSync(file);
    }
  }

  it.each([
    ['Filter', T1, 'TypeError'],
    ['CountIf', T1, 'TypeError'],
    ['Find', T1, 'TypeError'],
    ['IndexWhere', T1, 'TypeError'],
    ['Position', T1, 'TypeError'],
    // The interpreter leaves `Any`/`All` unevaluated, which compiled code
    // cannot give.
    ['Any', F1, 'TypeError'],
    ['All', T1, 'TypeError'],
    // Any value that is not `True` ends the prefix, as in the interpreter.
    ['TakeWhile', T1, []],
    ['DropWhile', T1, [1, 2]],
    // `Missing` does not select the element.
    ['Filter', MISSING, [2]],
    ['CountIf', MISSING, 1],
  ])('%s is checked at each call', (op, predicate, expected) => {
    const { code, value } = run([op, 'xs', predicate]);
    expect(code).toContain('_ce_predicate(');
    expect(value).toEqual(expected);
  });

  it.each([
    ['Filter', [2]],
    ['CountIf', 1],
    ['Find', 2],
    ['IndexWhere', 2],
    ['Position', [2]],
    ['Any', true],
    ['All', false],
    ['TakeWhile', []],
    ['DropWhile', [1, 2]],
  ])('%s with a boolean predicate is not checked', (op, expected) => {
    const { code, value } = run([op, 'xs', BOOL]);
    expect(code).not.toContain('_ce_predicate(');
    expect(value).toEqual(expected);
  });

  it('a bare lambda that needs the check declines', () => {
    const e = new ComputeEngine();
    e.declare('xs', 'list<integer>');
    expect(() =>
      python.compileLambda(e.box(['Filter', 'xs', T1] as any), ['xs'])
    ).toThrow(/_ce_predicate helper/);
  });

  // This target spells `Missing` as `nan`, so `_ce_predicate` reads a `nan`
  // result as absent and skips the element. The interpreter reports a numeric
  // `NaN` result as an error. Before 2026-10-17 `Filter(xs, x ↦ If(x > 1,
  // True, NaN))` over `[1, 2]` answered `[2]` here. A selecting predicate
  // whose result type admits `NaN` is now refused. A prefix predicate ends
  // the prefix on `NaN` as the interpreter does, and still compiles.
  const NAN = ['Function', ['If', ['Greater', 'x', 1], 'True', 'NaN'], 'x'];
  const NUMBER = [
    'Function',
    ['If', ['Greater', 'x', 1], 'True', ['Divide', 'x', 0.5]],
    'x',
  ];
  it.each([
    ['Filter', NAN, 'list<integer>'],
    ['CountIf', NAN, 'list<integer>'],
    ['Find', NUMBER, 'list<number>'],
  ])('%s with a predicate that may return NaN is refused', (op, predicate, type) => {
    const e = new ComputeEngine();
    e.declare('xs', type);
    expect(() =>
      python.compileFunction(e.box([op, 'xs', predicate] as any), 'fn', ['xs'])
    ).toThrow(/cannot tell apart from the absent value `Missing`/);
  });

  it('TakeWhile with a predicate that may return NaN compiles', () => {
    const { code, value } = run(['TakeWhile', 'xs', NAN]);
    expect(code).toContain('_ce_predicate(');
    expect(value).toEqual([]);
  });
});
