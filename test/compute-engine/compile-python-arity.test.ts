import { engine as ce } from '../utils';
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
const src = (expr: any): string => python.compileToSource(ce.box(expr));

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
    expect(code).toBe(
      '(lambda _r0, _r1, _r2: np.logical_and(np.less(_r0, _r1), np.less(_r1, _r2)))([1, 9], [3, 4], [5, 6])'
    );
  });

  it('the binary form is unchanged', () => {
    expect(src(['Less', A, B])).toBe('np.less([1, 9], [3, 4])');
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
    expect(src(['Norm', ['List', 3, 4], { str: 'Frobenius' }])).toBe(
      "np.linalg.norm([3, 4], 'fro')"
    );
    expect(() =>
      src(['Norm', ['List', 3, 4], { str: 'bogus' }])
    ).toThrow(/Fail closed/);
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
    let program = 'import numpy as np\nimport cmath, math, json\n\nresults = []\n';
    for (const c of EXEC_CASES)
      program += `results.append(np.asarray(${src(c.expr)}).tolist())\n`;
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
