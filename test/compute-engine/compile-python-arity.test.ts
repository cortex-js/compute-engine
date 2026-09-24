import { engine as ce } from '../utils';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * PYTHON TARGET — OPERAND-ARITY AUDIT.
 *
 * Several Python lowerings silently dropped, or mis-positioned, an operand the
 * CE signature accepts. Each emitted valid-looking Python and reported
 * `success: true` while computing something else:
 *
 * - `Round(x, n)` ignored the decimal-precision operand (`Round(3.14159, 2)`
 *   compiled to the round-to-integer form, 3, where the interpreter answers
 *   157/50).
 * - `Gamma(s, z)` — the UPPER INCOMPLETE gamma, a different function from
 *   Γ(z) — passed both operands to the one-argument `scipy.special.gamma`.
 * - `Transpose(m, i, j)` emitted `np.transpose(m, i, j)`, whose second
 *   parameter is a whole permutation, not an axis index;
 *   `ConjugateTranspose(m, i, j)` dropped the axes outright.
 * - `Mean`/`Median`/`Variance`/`StandardDeviation` are variadic and reduce over
 *   the FLATTENED sample; the bare `np.mean`/… mappings handed the second and
 *   third operands to numpy's `axis`/`dtype` parameters. (`Variance` and
 *   `StandardDeviation` are additionally the SAMPLE statistics — `ddof=1`.)
 * - `Less`/`LessEqual`/`Greater`/`GreaterEqual`/`And`/`Or` in their FUNCTION
 *   form (reached for a collection operand) are binary numpy ufuncs whose third
 *   positional parameter is `out`: `np.less(a, b, c)` wrote `a < b` INTO `c`.
 * - `Norm(v, "Infinity")` emitted a norm-order string numpy does not know.
 * - `Covariance([1,2])` (its second operand is optional) emitted
 *   `np.cov([1, 2], )` — a Python SyntaxError.
 *
 * The source-shape assertions below pin the fixed lowerings; the execution
 * block runs the emitted Python through the repo venv and compares against the
 * interpreter (skipped when the venv is unavailable).
 */

const python = new PythonTarget();
// `constantFold: false`: these assertions pin the LOWERING of each operator,
// and every operand below is a literal — with compile-time constant folding
// on (the default) a fully constant call is evaluated at compile time and
// emitted as a bare number, so there would be no lowering left to inspect.
const src = (expr: any): string =>
  python.compileToSource(ce.box(expr), { constantFold: false });

describe('PYTHON ARITY — Round(x, n) rounds to n decimal places', () => {
  it('a constant precision folds the 10ⁿ factor', () => {
    expect(src(['Round', 'x', 2])).toBe(
      '((np.sign(((x) * 10 ** 2)) * np.floor(np.abs(((x) * 10 ** 2)) + 0.5)) / 10 ** 2)'
    );
  });

  it('a negative precision rounds to tens/hundreds', () => {
    expect(src(['Round', 'x', -2])).toBe(
      '((np.sign(((x) * 10 ** -2)) * np.floor(np.abs(((x) * 10 ** -2)) + 0.5)) / 10 ** -2)'
    );
  });

  it('a RUNTIME precision lowers (Python `10 ** n` is exact/correctly rounded, unlike a shader `pow`)', () => {
    const code = src(['Round', 'x', 'k']);
    expect(code).toContain('10 ** (k)');
    // Both operands are bound once — neither is emitted twice.
    expect(code.match(/\(x\)/g)?.length).toBe(1);
    expect(code.match(/10 \*\* \(k\)/g)?.length).toBe(1);
  });

  it('the unary form is unchanged', () => {
    expect(src(['Round', 'x'])).toBe(
      '(np.sign(x) * np.floor(np.abs(x) + 0.5))'
    );
  });
});

describe('PYTHON ARITY — Gamma(s, z) is the upper incomplete gamma', () => {
  it('the one-operand form stays the complete Γ', () => {
    expect(src(['Gamma', 'x'])).toBe('scipy.special.gamma(x)');
  });

  it('the two-operand form multiplies the regularized Q(s, z) back by Γ(s)', () => {
    expect(src(['Gamma', 2, 'x'])).toBe(
      '(scipy.special.gammaincc(2, x) * scipy.special.gamma(2))'
    );
  });

  it('a statically non-positive `s` fails closed (scipy gammaincc needs s > 0)', () => {
    expect(() => src(['Gamma', -1, 2])).toThrow(/Fail closed/);
    expect(() => src(['Gamma', 0, 2])).toThrow(/Fail closed/);
  });
});

describe('PYTHON ARITY — Transpose / ConjugateTranspose axes', () => {
  const M = ['List', ['List', 2, 3], ['List', 5, 7]];

  it('explicit 1-based axes lower to np.swapaxes', () => {
    expect(src(['Transpose', M, 1, 2])).toBe(
      'np.swapaxes([[2, 3], [5, 7]], int(1) - 1, int(2) - 1)'
    );
    expect(src(['ConjugateTranspose', M, 1, 2])).toBe(
      'np.swapaxes(np.conjugate([[2, 3], [5, 7]]), int(1) - 1, int(2) - 1)'
    );
  });

  it('a LONE axis operand is dropped — the interpreter honors the axes only in the three-operand form', () => {
    expect(src(['Transpose', M, 1])).toBe('np.transpose([[2, 3], [5, 7]])');
    expect(ce.box(['Transpose', M, 1]).N().toString()).toBe(
      ce.box(['Transpose', M]).N().toString()
    );
  });
});

describe('PYTHON ARITY — variadic statistics reduce over the flattened sample', () => {
  it('several operands splice into one list', () => {
    expect(src(['Mean', ['List', 2, 3], ['List', 5, 7]])).toBe(
      'np.mean([*[2, 3], *[5, 7]])'
    );
    expect(src(['Median', ['List', 2, 3], 11])).toBe(
      'np.median([*[2, 3], 11])'
    );
  });

  it('Variance/StandardDeviation are the SAMPLE statistics (ddof=1)', () => {
    expect(src(['Variance', ['List', 2, 3, 7]])).toBe(
      'np.var([2, 3, 7], ddof=1)'
    );
    expect(src(['StandardDeviation', ['List', 2, 3, 7]])).toBe(
      'np.std([2, 3, 7], ddof=1)'
    );
  });
});

describe('PYTHON ARITY — chained relations / logic over collections', () => {
  const A = ['List', 1, 9];
  const B = ['List', 3, 4];
  const C = ['List', 5, 6];

  it('a three-operand relation folds pairwise instead of filling numpy `out`', () => {
    const code = src(['Less', A, B, C]);
    // `toContain`, not `toBe`: every ufunc application goes through the
    // `_ce_ord` shape guard, whose definition is prepended to the source.
    expect(code).toContain(
      '(lambda _r0, _r1, _r2: np.logical_and(_ce_ord(np.less, _r0, _r1), _ce_ord(np.less, _r1, _r2)))([1, 9], [3, 4], [5, 6])'
    );
  });

  it('the binary form is unchanged', () => {
    expect(src(['Less', A, B])).toContain(
      '_ce_ord(np.less, [1, 9], [3, 4])'
    );
  });

  it('And/Or fold pairwise', () => {
    expect(
      src(['And', ['List', 'True', 'False'], ['List', 'True', 'True'], C])
    ).toContain('np.logical_and(np.logical_and(');
  });
});

describe('PYTHON ARITY — Norm / Covariance operand guards', () => {
  it('a string norm order is translated, or fails closed', () => {
    expect(src(['Norm', ['List', 3, -4], { str: 'Infinity' }])).toBe(
      'np.linalg.norm([3, -4], np.inf)'
    );
    // The SPELLING `'fro'` is matrix-only in numpy: on a 1-D input
    // `np.linalg.norm(v, 'fro')` raises a ValueError. The Frobenius NORM is
    // the entry-wise L2 norm at any rank, though — which is numpy's default
    // order for a 1-D input, and what the interpreter and the JavaScript
    // target answer — so a rank-1 operand drops the order instead of
    // emitting source that cannot run.
    expect(src(['Norm', ['List', 3, 4], { str: 'Frobenius' }])).toBe(
      'np.linalg.norm([3, 4])'
    );
    expect(() =>
      src(['Norm', ['List', 3, 4], { str: 'bogus' }])
    ).toThrow(/Fail closed/);
  });

  // `Norm(m, 2)` is the SPECTRAL norm (the largest singular value) in the
  // interpreter (`library/linear-algebra.ts`) and in `np.linalg.norm(m, 2)`:
  // on `[[3,4],[5,12]]` both answer 13.8806092198653…, while the Frobenius
  // norm (the default, and `"Frobenius"`) is 13.9283882771841….
  const M = ['List', ['List', 3, 4], ['List', 5, 12]];

  it('order 2 on a MATRIX lowers to numpy’s spectral norm', () => {
    expect(src(['Norm', M, 2])).toBe('np.linalg.norm([[3, 4], [5, 12]], 2)');
  });

  it('order 2 on a VECTOR is unchanged (the two systems agree at rank 1)', () => {
    expect(src(['Norm', ['List', 3, 4], 2])).toBe('np.linalg.norm([3, 4], 2)');
    // A `vector` carries `dimensions: [-1]`, so it is provably rank 1.
    ce.declare('normVec1', 'vector<real>');
    expect(src(['Norm', 'normVec1', 2])).toBe('np.linalg.norm(normVec1, 2)');
    // A dimension-less `list<number>` is NOT provably rank 1: a matrix
    // conforms to it too, and on a matrix the order 2 is the spectral norm.
    // So the emitted code tests the rank when it runs.
    ce.declare('normList1', 'list<number>');
    expect(src(['Norm', 'normList1', 2])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 2) if np.ndim(_x) <= 2 else np.linalg.norm(_x))(normList1)"
    );
  });

  it('order 2 on an operand of unknown rank tests the rank when it runs', () => {
    ce.declare('normOpaque1', 'unknown');
    expect(src(['Norm', 'normOpaque1', 2])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 2) if np.ndim(_x) <= 2 else np.linalg.norm(_x))(normOpaque1)"
    );
  });

  it('the other matrix orders are unchanged', () => {
    expect(src(['Norm', M])).toBe('np.linalg.norm([[3, 4], [5, 12]])');
    expect(src(['Norm', M, 1])).toBe('np.linalg.norm([[3, 4], [5, 12]], 1)');
    expect(src(['Norm', ['List', 3, 4], { str: 'Infinity' }])).toBe(
      'np.linalg.norm([3, 4], np.inf)'
    );
  });

  it('a one-operand Covariance/Correlation fails closed instead of emitting `np.cov(x, )`', () => {
    expect(() => src(['Covariance', ['List', 1, 2]])).toThrow(
      /two collection arguments/
    );
    expect(() => src(['Correlation', ['List', 1, 2]])).toThrow(
      /two collection arguments/
    );
    expect(() => src(['PopulationCovariance', ['List', 1, 2]])).toThrow(
      /two collection arguments/
    );
  });
});

// ---------------------------------------------------------------------------
// Execution parity: run the emitted Python and compare with the interpreter.
// ---------------------------------------------------------------------------

const VENV_PYTHON =
  [
    path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
    path.join(process.cwd(), 'venv', 'bin', 'python3'),
  ].find((p) => fs.existsSync(p)) ??
  path.join(process.cwd(), 'venv', 'bin', 'python3');

function venvHas(mod: string): boolean {
  try {
    if (!fs.existsSync(VENV_PYTHON)) return false;
    execFileSync(VENV_PYTHON, ['-c', `import ${mod}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Expression, and the `repr()`-independent JSON the emitted code must print. */
const EXEC_CASES: Array<{ name: string; expr: any; expected: any }> = [
  { name: 'round_2dp', expr: ['Round', 3.14159, 2], expected: 3.14 },
  { name: 'round_neg2dp', expr: ['Round', 1234.5678, -2], expected: 1200 },
  { name: 'round_tie_up', expr: ['Round', 0.125, 2], expected: 0.13 },
  { name: 'round_tie_neg', expr: ['Round', -0.125, 2], expected: -0.13 },
  { name: 'round_unary_tie', expr: ['Round', 2.5], expected: 3 },
  { name: 'round_unary_tie_neg', expr: ['Round', -2.5], expected: -3 },
  { name: 'mean_multi', expr: ['Mean', ['List', 2, 3], ['List', 5, 7]], expected: 4.25 },
  { name: 'mean_scalars', expr: ['Mean', 2, 3, 7], expected: 4 },
  { name: 'median_mixed', expr: ['Median', ['List', 2, 3], ['List', 5, 7], 11], expected: 5 },
  { name: 'variance_sample', expr: ['Variance', ['List', 2, 3, 7]], expected: 7 },
  { name: 'variance_mixed', expr: ['Variance', ['List', 2, 3], 7], expected: 7 },
  {
    name: 'stddev_sample',
    expr: ['StandardDeviation', ['List', 2, 3, 7]],
    expected: 2.6457513110645907,
  },
  { name: 'norm_inf_string', expr: ['Norm', ['List', 3, -4], { str: 'Infinity' }], expected: 4 },
  // The spectral norm (13.8806…), NOT the Frobenius norm (13.9283…).
  {
    name: 'norm_matrix_ord2',
    expr: ['Norm', ['List', ['List', 3, 4], ['List', 5, 12]], 2],
    expected: 13.88060921986538,
  },
  {
    name: 'norm_matrix_ord1',
    expr: ['Norm', ['List', ['List', 3, 4], ['List', 5, 12]], 1],
    expected: 16,
  },
  { name: 'norm_vector_ord2', expr: ['Norm', ['List', 3, 4], 2], expected: 5 },
  {
    name: 'less_chain',
    expr: ['Less', ['List', 1, 9], ['List', 3, 4], ['List', 5, 6]],
    expected: [true, false],
  },
  {
    name: 'and_chain',
    expr: [
      'And',
      ['List', 'True', 'False'],
      ['List', 'True', 'True'],
      ['List', 'True', 'True'],
    ],
    expected: [true, false],
  },
  {
    name: 'transpose_axes',
    expr: [
      'Transpose',
      ['List', ['List', 2, 3], ['List', 5, 7]],
      1,
      2,
    ],
    expected: [
      [2, 5],
      [3, 7],
    ],
  },
  {
    name: 'conjugate_transpose_axes',
    expr: [
      'ConjugateTranspose',
      ['List', ['List', 2, 3], ['List', 5, 7]],
      1,
      2,
    ],
    expected: [
      [2, 5],
      [3, 7],
    ],
  },
];

const describeNumpy = venvHas('numpy') ? describe : describe.skip;

describeNumpy('PYTHON ARITY — execution parity (venv)', () => {
  it('the emitted Python evaluates to the interpreter value', () => {
    // Each case is emitted as its own `def`, not inlined into the
    // `results.append(...)` expression: a lowering that routes through a
    // module-level runtime helper (`_ce_ord` for the ordering ufuncs) carries
    // the helper's DEFINITION in its emitted source, which is a statement.
    let program = 'import numpy as np\nimport cmath, math, json\n\n';
    EXEC_CASES.forEach((c, i) => {
      program += `${python.compileFunction(ce.box(c.expr), `fn_${i}`, [])}\n`;
    });
    program += 'results = []\n';
    EXEC_CASES.forEach((_c, i) => {
      program += `results.append(np.asarray(fn_${i}()).tolist())\n`;
    });
    program += 'print(json.dumps(results))\n';

    const file = path.join(os.tmpdir(), `ce-py-arity-${process.pid}.py`);
    fs.writeFileSync(file, program);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as any[];
    expect(actual.length).toBe(EXEC_CASES.length);
    EXEC_CASES.forEach((c, i) => {
      if (typeof c.expected === 'number')
        expect([c.name, actual[i]]).toEqual([
          c.name,
          expect.closeTo(c.expected, 10),
        ]);
      else expect([c.name, actual[i]]).toEqual([c.name, c.expected]);
    });
  });
});

// A run-time norm order: the interpreter computes a vector norm only for an
// order `p > 0`, and a matrix norm only for the orders 1, 2 and +Infinity.
// For every other order the interpreter has no value, while
// `np.linalg.norm` answers one (`ord=-1` and `ord=0` on a vector) or raises
// (`ord=3` on a matrix). The emitted code must answer NaN for those orders.
describe('PYTHON ARITY — a run-time Norm order the interpreter does not compute', () => {
  const V = ['List', 3, 4];
  const M = ['List', ['List', 3, 4], ['List', 5, 12]];

  it('a non-positive literal order fails closed', () => {
    expect(() => src(['Norm', V, 0])).toThrow(/positive order.*Fail closed/s);
    expect(() => src(['Norm', V, -1])).toThrow(/Fail closed/);
    // A `-∞` order is already an invalid expression, which does not compile.
    expect(() => src(['Norm', V, 'NegativeInfinity'])).toThrow();
  });

  describeNumpy('execution (venv)', () => {
    it('answers NaN for an order the interpreter does not compute', () => {
      const cases: Array<[any, number, number]> = [
        // [operand, order, expected value (NaN: no value)]
        [V, -1, NaN],
        [V, 0, NaN],
        [V, 3, Math.cbrt(27 + 64)],
        [V, 2, 5],
        [M, 3, NaN],
        [M, 1, 16],
        [M, 2, 13.88060921986538],
      ];
      let program = 'import numpy as np\nimport math, json\n\n';
      cases.forEach(([x], i) => {
        program += `${python.compileFunction(ce.box(['Norm', x, 'normRunP']), `fn_${i}`, ['normRunP'])}\n`;
      });
      program += 'results = []\n';
      cases.forEach(([, p], i) => {
        program += `r = float(fn_${i}(${p}))\n`;
        program += `results.append(None if math.isnan(r) else r)\n`;
      });
      program += 'print(json.dumps(results))\n';

      const file = path.join(os.tmpdir(), `ce-py-norm-${process.pid}.py`);
      fs.writeFileSync(file, program);
      let out = '';
      try {
        out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      const actual = JSON.parse(out) as (number | null)[];
      cases.forEach(([x, p, expected], i) => {
        // The interpreter agrees: no value for the refused orders.
        const interpreted = ce.box(['Norm', x, p]).N();
        if (Number.isNaN(expected)) {
          expect([i, actual[i]]).toEqual([i, null]);
          expect(isNumber(interpreted)).toBe(false);
        } else {
          expect([i, actual[i]]).toEqual([i, expect.closeTo(expected, 10)]);
          expect(interpreted.re).toBeCloseTo(expected, 10);
        }
      });
    });
  });

    it('a run-time STRING order is the norm type the interpreter reads', () => {
      // `normRunP` is not declared, so the emitted code accepts the string
      // orders of the `Norm` signature: `"Infinity"` is the order +Infinity,
      // `"Frobenius"` the entry-wise L2 norm (`'fro'` on a matrix, not the
      // spectral norm), and any other string has no value. Without the
      // normalization, `_p > 0` raised a `TypeError` for a string.
      // ‖(3, 4)‖∞ = 4, the maximum absolute row sum of M is 17, and its
      // Frobenius norm is √(9 + 16 + 25 + 144) = √194.
      const cases: Array<[any, string, number]> = [
        [V, 'Infinity', 4],
        [V, 'Frobenius', 5],
        [V, 'bogus', NaN],
        [M, 'Infinity', 17],
        [M, 'Frobenius', Math.sqrt(194)],
        [M, 'bogus', NaN],
      ];
      let program = 'import numpy as np\nimport math, json\n\n';
      cases.forEach(([x], i) => {
        program += `${python.compileFunction(ce.box(['Norm', x, 'normRunP']), `fn_${i}`, ['normRunP'])}\n`;
      });
      program += 'results = []\n';
      cases.forEach(([, p], i) => {
        program += `r = float(fn_${i}('${p}'))\n`;
        program += `results.append(None if math.isnan(r) else r)\n`;
      });
      program += 'print(json.dumps(results))\n';

      const file = path.join(os.tmpdir(), `ce-py-norm-str-${process.pid}.py`);
      fs.writeFileSync(file, program);
      let out = '';
      try {
        out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      const actual = JSON.parse(out) as (number | null)[];
      cases.forEach(([x, p, expected], i) => {
        const interpreted = ce.box(['Norm', x, { str: p }]).N();
        if (Number.isNaN(expected)) {
          expect([i, actual[i]]).toEqual([i, null]);
          expect(isNumber(interpreted)).toBe(false);
        } else {
          expect([i, actual[i]]).toEqual([i, expect.closeTo(expected, 10)]);
          expect(interpreted.re).toBeCloseTo(expected, 10);
        }
      });
    });
});

// A norm order over an operand whose rank is not known when it compiles.
// `np.linalg.norm(x, p)` spells a different norm, or raises, for each rank: it
// raises for a scalar and for an input with more than two axes, and for a
// matrix when `p` is not 1, 2 or `inf`. The interpreter answers a value (a
// scalar: its absolute value; above rank 2: the Frobenius norm for the order
// 2) or leaves the application unevaluated. The emitted code tests the rank
// when it runs, and answers NaN where the interpreter has no value.
describe('PYTHON ARITY — a Norm order over an operand of unknown rank', () => {
  ce.declare('normOpaqueX', 'unknown');
  ce.declare('normScalarX', 'real');
  ce.declare('normVecX', 'vector<real>');
  ce.declare('normMatX', 'matrix<real>');
  ce.declare('normT3X', 'list<list<list<real>>>');
  ce.declare('normTensorX', 'tensor');
  ce.declare('normListVecX', 'list<vector<real>>');
  ce.declare('normListMatX', 'list<matrix<real>>');

  it('emits a run-time rank test instead of a bare `np.linalg.norm`', () => {
    expect(src(['Norm', 'normOpaqueX', 3])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 3) if np.ndim(_x) == 1 else float('nan'))(normOpaqueX)"
    );
    expect(src(['Norm', 'normOpaqueX', 1])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 1) if np.ndim(_x) <= 2 else float('nan'))(normOpaqueX)"
    );
    expect(src(['Norm', 'normOpaqueX', 'PositiveInfinity'])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, np.inf) if np.ndim(_x) <= 2 else float('nan'))(normOpaqueX)"
    );
    expect(src(['Norm', 'normOpaqueX', { str: 'Infinity' }])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, np.inf) if np.ndim(_x) <= 2 else float('nan'))(normOpaqueX)"
    );
    // The order 2 is the Euclidean norm of a vector, the spectral norm of a
    // matrix, and the Frobenius norm (numpy's default order) above rank 2.
    expect(src(['Norm', 'normOpaqueX', 2])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 2) if np.ndim(_x) <= 2 else np.linalg.norm(_x))(normOpaqueX)"
    );
  });

  it('a run-time order tests the rank and the order when it runs', () => {
    // `normRunP` is not declared, so its type admits a string: the order is
    // normalized first (`"Infinity"` → `np.inf`, `"Frobenius"` → 2, any other
    // string → NaN), and the matrix branch spells `"Frobenius"` as `'fro'`.
    expect(src(['Norm', 'normOpaqueX', 'normRunP'])).toBe(
      "(lambda _x, _q: (lambda _p: (np.abs(_x) if _p > 0 else float('nan')) if np.ndim(_x) == 0 else (np.linalg.norm(_x, _p) if _p > 0 else float('nan')) if np.ndim(_x) == 1 else (np.linalg.norm(_x, 'fro') if (isinstance(_q, str) and _q == 'Frobenius') else np.linalg.norm(_x, _p) if _p == 1 or _p == 2 or _p == np.inf else float('nan')) if np.ndim(_x) == 2 else (np.linalg.norm(_x) if _p == 2 else float('nan')))(({'Infinity': np.inf, 'Frobenius': 2}.get(_q, float('nan')) if isinstance(_q, str) else _q)))(normOpaqueX, normRunP)"
    );
    // An order whose type admits no string is compared as it is.
    ce.declare('normRealP', 'real');
    expect(src(['Norm', 'normOpaqueX', 'normRealP'])).toBe(
      "(lambda _x, _p: (np.abs(_x) if _p > 0 else float('nan')) if np.ndim(_x) == 0 else (np.linalg.norm(_x, _p) if _p > 0 else float('nan')) if np.ndim(_x) == 1 else (np.linalg.norm(_x, _p) if _p == 1 or _p == 2 or _p == np.inf else float('nan')) if np.ndim(_x) == 2 else (np.linalg.norm(_x) if _p == 2 else float('nan')))(normOpaqueX, normRealP)"
    );
  });

  it('the default order and the Frobenius norm type need no rank test', () => {
    // With no `ord` argument `np.linalg.norm` flattens its input at every
    // rank, which is the entry-wise Frobenius norm of the interpreter.
    expect(src(['Norm', 'normOpaqueX'])).toBe('np.linalg.norm(normOpaqueX)');
    expect(src(['Norm', 'normOpaqueX', { str: 'Frobenius' }])).toBe(
      'np.linalg.norm(normOpaqueX)'
    );
  });

  it('a non-positive literal order still fails closed', () => {
    expect(() => src(['Norm', 'normOpaqueX', 0])).toThrow(
      /positive order.*Fail closed/s
    );
    expect(() => src(['Norm', 'normOpaqueX', -1])).toThrow(/Fail closed/);
  });

  it('a scalar operand is its absolute value', () => {
    expect(src(['Norm', 'normScalarX', 3])).toBe('np.abs(normScalarX)');
    expect(src(['Norm', 'normScalarX', 2])).toBe('np.abs(normScalarX)');
    expect(src(['Norm', 'normScalarX', { str: 'Infinity' }])).toBe(
      'np.abs(normScalarX)'
    );
    expect(src(['Norm', 'normScalarX', 'normRunP'])).toBe(
      "(lambda _x, _q: (lambda _p: np.abs(_x) if _p > 0 else float('nan'))(({'Infinity': np.inf, 'Frobenius': 2}.get(_q, float('nan')) if isinstance(_q, str) else _q)))(normScalarX, normRunP)"
    );
  });

  it('a declared vector or matrix keeps the plain call', () => {
    expect(src(['Norm', 'normVecX', 3])).toBe('np.linalg.norm(normVecX, 3)');
    expect(src(['Norm', 'normMatX', 1])).toBe('np.linalg.norm(normMatX, 1)');
  });

  it('a dimension-less nested list has no static rank', () => {
    // `list<list<list<real>>>` carries no `dimensions`, and its innermost
    // `list<real>` admits a matrix, so a rank-4 value conforms to it too. The
    // emitted code tests the rank when it runs.
    expect(src(['Norm', 'normT3X', 2])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 2) if np.ndim(_x) <= 2 else np.linalg.norm(_x))(normT3X)"
    );
    expect(src(['Norm', 'normT3X', 1])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 1) if np.ndim(_x) <= 2 else float('nan'))(normT3X)"
    );
    expect(src(['Norm', 'normT3X', 'normRunP'])).toBe(
      "(lambda _x, _q: (lambda _p: (np.abs(_x) if _p > 0 else float('nan')) if np.ndim(_x) == 0 else (np.linalg.norm(_x, _p) if _p > 0 else float('nan')) if np.ndim(_x) == 1 else (np.linalg.norm(_x, 'fro') if (isinstance(_q, str) and _q == 'Frobenius') else np.linalg.norm(_x, _p) if _p == 1 or _p == 2 or _p == np.inf else float('nan')) if np.ndim(_x) == 2 else (np.linalg.norm(_x) if _p == 2 else float('nan')))(({'Infinity': np.inf, 'Frobenius': 2}.get(_q, float('nan')) if isinstance(_q, str) else _q)))(normT3X, normRunP)"
    );
  });

  it('a `tensor` operand has no static rank', () => {
    // `tensor` is the dimension-less `list<number>`: a vector, a matrix and
    // every higher tensor conform to it. Reading it as rank 1 emitted
    // `np.linalg.norm(T, 3)`, which raises for a matrix, and
    // `np.linalg.norm(T, 2)`, which raises above rank 2.
    expect(src(['Norm', 'normTensorX', 1])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 1) if np.ndim(_x) <= 2 else float('nan'))(normTensorX)"
    );
    expect(src(['Norm', 'normTensorX', 2])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 2) if np.ndim(_x) <= 2 else np.linalg.norm(_x))(normTensorX)"
    );
    expect(src(['Norm', 'normTensorX', 3])).toBe(
      "(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else np.linalg.norm(_x, 3) if np.ndim(_x) == 1 else float('nan'))(normTensorX)"
    );
    expect(src(['Norm', 'normTensorX', 'normRunP'])).toBe(
      "(lambda _x, _q: (lambda _p: (np.abs(_x) if _p > 0 else float('nan')) if np.ndim(_x) == 0 else (np.linalg.norm(_x, _p) if _p > 0 else float('nan')) if np.ndim(_x) == 1 else (np.linalg.norm(_x, 'fro') if (isinstance(_q, str) and _q == 'Frobenius') else np.linalg.norm(_x, _p) if _p == 1 or _p == 2 or _p == np.inf else float('nan')) if np.ndim(_x) == 2 else (np.linalg.norm(_x) if _p == 2 else float('nan')))(({'Infinity': np.inf, 'Frobenius': 2}.get(_q, float('nan')) if isinstance(_q, str) else _q)))(normTensorX, normRunP)"
    );
  });

  it('a list of vectors or of matrices keeps its static rank', () => {
    // The outer dimension-less list adds one axis to a list element type
    // that carries `dimensions`.
    expect(() => src(['Norm', 'normListVecX', 3])).toThrow(
      /matrix norms only for orders.*Fail closed/s
    );
    expect(src(['Norm', 'normListMatX', 2])).toBe('np.linalg.norm(normListMatX)');
  });

  it('a run-time STRING order over a declared vector or matrix', () => {
    expect(src(['Norm', 'normVecX', 'normRunP'])).toBe(
      "(lambda _x, _q: (lambda _p: np.linalg.norm(_x, _p) if _p > 0 else float('nan'))(({'Infinity': np.inf, 'Frobenius': 2}.get(_q, float('nan')) if isinstance(_q, str) else _q)))(normVecX, normRunP)"
    );
    expect(src(['Norm', 'normMatX', 'normRunP'])).toBe(
      "(lambda _x, _q: (lambda _p: np.linalg.norm(_x, 'fro') if (isinstance(_q, str) and _q == 'Frobenius') else np.linalg.norm(_x, _p) if _p == 1 or _p == 2 or _p == np.inf else float('nan'))(({'Infinity': np.inf, 'Frobenius': 2}.get(_q, float('nan')) if isinstance(_q, str) else _q)))(normMatX, normRunP)"
    );
  });

  describeNumpy('execution (venv)', () => {
    it('answers the interpreter value, or NaN where it has none', () => {
      const V = ['List', 3, 4];
      const M = ['List', ['List', 3, 4], ['List', 5, 12]];
      const T = ['List', ['List', ['List', 1, 2]], ['List', ['List', 3, 4]]];
      // [operand symbol, operand value, operand as Python source, order,
      // expected (NaN: no value)]. The values were computed by hand:
      // ‖(3, 4)‖₃ = ∛91, ‖(3, 4)‖∞ = 4, the maximum absolute column sum of M
      // is 4 + 12 = 16, its maximum absolute row sum is 5 + 12 = 17, its
      // spectral norm is 13.8806092198653…, the Frobenius norm of T is
      // √(1 + 4 + 9 + 16) = √30, and |−5| = 5.
      const cases: Array<[string, any, string, any, number]> = [
        ['normVecX', V, '[3, 4]', 3, Math.cbrt(91)],
        ['normVecX', V, '[3, 4]', 'PositiveInfinity', 4],
        ['normMatX', M, '[[3, 4], [5, 12]]', 1, 16],
        ['normMatX', M, '[[3, 4], [5, 12]]', 'PositiveInfinity', 17],
        ['normScalarX', -5, '-5', 3, 5],
        ['normScalarX', -5, '-5', 2, 5],
        ['normOpaqueX', V, '[3, 4]', 3, Math.cbrt(91)],
        ['normOpaqueX', V, '[3, 4]', 'PositiveInfinity', 4],
        ['normOpaqueX', M, '[[3, 4], [5, 12]]', 3, NaN],
        ['normOpaqueX', M, '[[3, 4], [5, 12]]', 1, 16],
        ['normOpaqueX', M, '[[3, 4], [5, 12]]', 2, 13.88060921986538],
        ['normOpaqueX', T, '[[[1, 2]], [[3, 4]]]', 1, NaN],
        ['normOpaqueX', T, '[[[1, 2]], [[3, 4]]]', 2, Math.sqrt(30)],
        ['normOpaqueX', -5, '-5', 3, 5],
        ['normT3X', T, '[[[1, 2]], [[3, 4]]]', 2, Math.sqrt(30)],
        ['normTensorX', V, '[3, 4]', 3, Math.cbrt(91)],
        ['normTensorX', M, '[[3, 4], [5, 12]]', 3, NaN],
        ['normTensorX', M, '[[3, 4], [5, 12]]', 2, 13.88060921986538],
        ['normTensorX', T, '[[[1, 2]], [[3, 4]]]', 2, Math.sqrt(30)],
      ];
      let program = 'import numpy as np\nimport math, json\n\n';
      cases.forEach(([x, , , p], i) => {
        program += `${python.compileFunction(ce.box(['Norm', x, p]), `fn_${i}`, [x])}\n`;
      });
      program += 'results = []\n';
      cases.forEach(([, , arg], i) => {
        program += `r = float(fn_${i}(${arg}))\n`;
        program += `results.append(None if math.isnan(r) else r)\n`;
      });
      program += 'print(json.dumps(results))\n';

      const file = path.join(os.tmpdir(), `ce-py-norm-rank-${process.pid}.py`);
      fs.writeFileSync(file, program);
      let out = '';
      try {
        out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      const actual = JSON.parse(out) as (number | null)[];
      cases.forEach(([, x, , p, expected], i) => {
        // The interpreter agrees: no value where the emitted code answers NaN.
        const interpreted = ce.box(['Norm', x, p]).N();
        if (Number.isNaN(expected)) {
          expect([i, actual[i]]).toEqual([i, null]);
          expect(isNumber(interpreted)).toBe(false);
        } else {
          expect([i, actual[i]]).toEqual([i, expect.closeTo(expected, 10)]);
          expect(interpreted.re).toBeCloseTo(expected, 10);
        }
      });
    });
  });
});

const describeScipy = venvHas('scipy.special') ? describe : describe.skip;

describeScipy('PYTHON ARITY — Gamma(s, z) execution parity (venv + scipy)', () => {
  it('the upper incomplete gamma matches the interpreter', () => {
    const cases: Array<[any, number]> = [
      [['Gamma', 5], 24],
      [['Gamma', 5, 2], 22.73632758375093],
      [['Gamma', 3, 1], 1.8393972058572117],
      [['Gamma', 0.5, 1.5], 0.14758251320409642],
    ];
    let program = 'import numpy as np\nimport scipy.special\nimport json\n\nresults = []\n';
    for (const [expr] of cases)
      program += `results.append(float(${src(expr)}))\n`;
    program += 'print(json.dumps(results))\n';

    const file = path.join(os.tmpdir(), `ce-py-gamma-${process.pid}.py`);
    fs.writeFileSync(file, program);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as number[];
    cases.forEach(([expr, expected], i) => {
      // Cross-check the reference against the interpreter itself.
      expect(ce.box(expr).N().re).toBeCloseTo(expected, 10);
      expect(actual[i]).toBeCloseTo(expected, 10);
    });
  });
});
