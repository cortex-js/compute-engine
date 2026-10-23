import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

/**
 * A NaN operand of a branch condition.
 *
 * User decision of 2026-10-20 (Tycho ledger rows 411 and 413; Desmos and
 * IEEE 754 parity): an ordered comparison (`Less`, `LessEqual`, `Greater`,
 * `GreaterEqual`) or an `Equal` whose operand is an undefined numeric value
 * (`NaN`, `Indeterminate`) is `False`, in a branch condition as everywhere
 * else, so the `If`/`Which` takes its next arm. This holds on the interpreter
 * and on the `javascript`, `python` and `interval-js` targets (on
 * `interval-js`, for an operand that is `empty` over the whole cell).
 *
 * User decision of 2026-10-23: `NotEqual` follows the same reading. `NaN ≠ 0`
 * is `True` (IEEE), the negation of `NaN = 0`, in a branch condition as in a
 * cell of an element-wise condition, so the `If`/`Which` takes its first arm
 * on the interpreter and on the `javascript` and `python` targets. `Missing`
 * keeps its Kleene reading.
 *
 * History: from 2026-09-03 to 2026-10-20 a NaN operand of any of the six
 * relations made the branch select no arm (ruled 2026-09-03), and a
 * `NotEqual` with a NaN operand kept that rule until 2026-10-23. Before the
 * 2026-09-03 ruling the interpreter took the else arm while the compiled
 * lane answered `NaN`.
 */

const ce = new ComputeEngine();

/** The compiled JavaScript value of `expr` at `vars`. */
function compiled(expr: any, vars: object): unknown {
  const r = compile(ce.box(expr), { fallback: false, constantFold: false });
  expect(r?.success).toBe(true);
  return r!.run!(vars);
}

const ORDERED_AND_EQUAL = [
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
];

describe('a NaN operand of a branch condition', () => {
  test('If: an ordered comparison or Equal takes the else arm, NotEqual the first arm', () => {
    for (const head of ORDERED_AND_EQUAL) {
      expect(ce.box(['If', [head, 'NaN', 0], 1, -1]).evaluate().re).toBe(-1);
      expect(ce.box(['If', [head, 0, 'NaN'], 1, -1]).evaluate().re).toBe(-1);
      expect(compiled(['If', [head, 'x', 0], 1, -1], { x: NaN })).toBe(-1);
    }
    expect(ce.box(['If', ['NotEqual', 'NaN', 0], 1, -1]).evaluate().re).toBe(1);
    expect(ce.box(['If', ['NotEqual', 0, 'NaN'], 1, -1]).evaluate().re).toBe(1);
    expect(compiled(['If', ['NotEqual', 'x', 0], 1, -1], { x: NaN })).toBe(1);
    expect(compiled(['If', ['NotEqual', 0, 'x'], 1, -1], { x: NaN })).toBe(1);
    // An unsupplied `x` is absent, not NaN: still no arm.
    expect(compiled(['If', ['NotEqual', 'x', 0], 1, -1], {})).toBeNaN();
  });

  test('a symbol holding NaN is the same as the literal', () => {
    const e = new ComputeEngine();
    e.assign('u', NaN);
    expect(e.box(['If', ['Greater', 'u', 0], 1, -1]).evaluate().re).toBe(-1);
    // An else-less `If` whose condition is false answers `Missing`.
    expect(e.box(['If', ['Greater', 'u', 0], 1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(e.box(['If', ['NotEqual', 'u', 0], 1, -1]).evaluate().re).toBe(1);
  });

  test('the comparison itself keeps its IEEE value', () => {
    expect(ce.box(['Greater', 'NaN', 0]).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
    expect(ce.box(['NotEqual', 'NaN', 1]).evaluate().symbol).toBe('True');
  });

  test('Which: a false NaN guard falls through; a NotEqual guard selects its clause', () => {
    const w = [
      'Which',
      ['Greater', 'NaN', 0],
      1,
      ['Less', 'NaN', 0],
      2,
      'True',
      3,
    ];
    expect(ce.box(w).evaluate().re).toBe(3);
    expect(
      compiled(
        ['Which', ['Greater', 'x', 0], 1, ['Less', 'x', 0], 2, 'True', 3],
        { x: NaN }
      )
    ).toBe(3);
    // A reached `NotEqual` guard with a NaN operand is `True`: it selects
    // its clause.
    const n = ['Which', ['NotEqual', 'NaN', 0], 1, 'True', 3];
    expect(ce.box(n).evaluate().re).toBe(1);
    expect(
      compiled(['Which', ['NotEqual', 'x', 0], 1, 'True', 3], { x: NaN })
    ).toBe(1);
    // An earlier decided clause still selects before the NaN guard is reached.
    expect(
      ce
        .box([
          'Which',
          ['Greater', 1, 0],
          1,
          ['NotEqual', 'NaN', 0],
          2,
          'True',
          3,
        ])
        .evaluate().re
    ).toBe(1);
  });

  test('connectives combine three-valued, as the compiled lowering does', () => {
    // `NaN > 0` is a decided `False`; `NaN ≠ 0` is a decided `True`.
    const gt = ['Greater', 'NaN', 0];
    const ne = ['NotEqual', 'NaN', 0];
    const cases: [any, unknown][] = [
      [['And', gt, 'True'], -1],
      [['Or', gt, 'True'], 1],
      [['Or', gt, 'False'], -1],
      [['Not', gt], 1],
      [['And', ne, 'True'], 1],
      [['And', ne, 'False'], -1],
      [['Or', ne, 'True'], 1],
      [['Or', ne, 'False'], 1],
      [['Not', ne], -1],
      [['And', ['Greater', 2, 0], ['Less', 1, 2]], 1],
    ];
    for (const [cond, expected] of cases) {
      const v = ce.box(['If', cond, 1, -1]).evaluate();
      if (typeof expected === 'string') expect(v.symbol).toBe(expected);
      else expect(v.re).toBe(expected);
    }
    // Compiled parity at the same points.
    const x = ['Greater', 'x', 0];
    const xne = ['NotEqual', 'x', 0];
    const y = ['Greater', 'y', 0];
    expect(compiled(['If', ['And', x, y], 1, -1], { x: NaN, y: 1 })).toBe(-1);
    expect(compiled(['If', ['Or', x, y], 1, -1], { x: NaN, y: 1 })).toBe(1);
    expect(compiled(['If', ['Not', x], 1, -1], { x: NaN })).toBe(1);
    expect(compiled(['If', ['And', xne, y], 1, -1], { x: NaN, y: 1 })).toBe(1);
    expect(compiled(['If', ['And', xne, y], 1, -1], { x: NaN, y: -1 })).toBe(
      -1
    );
    expect(compiled(['If', ['Or', xne, y], 1, -1], { x: NaN, y: -1 })).toBe(1);
    expect(compiled(['If', ['Not', xne], 1, -1], { x: NaN })).toBe(-1);
  });

  test('a free-variable condition is still held inert', () => {
    expect(ce.box(['If', ['Greater', 'x', 0], 1, -1]).evaluate().operator).toBe(
      'If'
    );
    // `x > 0 ∧ NaN > 0`: the decided `False` decides the `And`, whatever `x`
    // is.
    expect(
      ce
        .box(['If', ['And', ['Greater', 'x', 0], ['Greater', 'NaN', 0]], 1, -1])
        .evaluate().re
    ).toBe(-1);
    // `x > 0 ∧ NaN ≠ 0`: `NaN ≠ 0` is `True`, which does not decide the
    // `And`, so the application stays inert until `x` is bound.
    const ne = ['And', ['Greater', 'x', 0], ['NotEqual', 'NaN', 0]];
    expect(ce.box(['If', ne, 1, -1]).evaluate().operator).toBe('If');
    // Once `x` is bound the held condition decides.
    for (const [x, expected] of [
      [-1, -1],
      [2, 1],
    ]) {
      const e = new ComputeEngine();
      e.assign('x', x);
      expect(e.box(['If', ne, 1, -1]).evaluate().re).toBe(expected);
    }
  });

  test('the connectives keep their short circuit and error propagation', () => {
    const e = new ComputeEngine();
    e.assign('n', 0);
    // `1/n` is guarded by `n ≠ 0` and never evaluated.
    expect(
      e
        .box([
          'If',
          ['And', ['NotEqual', 'n', 0], ['Greater', ['Divide', 1, 'n'], 1]],
          1,
          -1,
        ])
        .evaluate().re
    ).toBe(-1);
    // An operand a decided one guards is not evaluated: the error is unseen.
    expect(
      e.box(['If', ['And', 'False', ['Error', "'x'"]], 1, -1]).evaluate().re
    ).toBe(-1);
    // An error operand of a relation propagates, NaN sibling or not.
    expect(
      e
        .box(['If', ['And', ['Less', ['Error', "'x'"], 'NaN'], 'True'], 1, -1])
        .evaluate().operator
    ).toBe('Error');
  });

  test('Nand, Nor, Implies and a chained comparison follow the same rule', () => {
    const gt = ['Greater', 'NaN', 0];
    const ne = ['NotEqual', 'NaN', 0];
    // `NaN > 0` is `False`.
    expect(ce.box(['If', ['Nand', gt, 'True'], 1, -1]).evaluate().re).toBe(1);
    expect(ce.box(['If', ['Nor', gt, 'False'], 1, -1]).evaluate().re).toBe(1);
    expect(ce.box(['If', ['Implies', gt, 'False'], 1, -1]).evaluate().re).toBe(
      1
    );
    // `0 < NaN < 10` canonicalizes to an `And` of two relations.
    expect(ce.box(['If', ['Less', 0, 'NaN', 10], 1, -1]).evaluate().re).toBe(
      -1
    );
    // `NaN ≠ 0` is `True`.
    expect(ce.box(['If', ['Nand', ne, 'True'], 1, -1]).evaluate().re).toBe(-1);
    expect(ce.box(['If', ['Nor', ne, 'False'], 1, -1]).evaluate().re).toBe(-1);
    expect(ce.box(['If', ['Implies', ne, 'False'], 1, -1]).evaluate().re).toBe(
      -1
    );
    expect(ce.box(['If', ['Implies', ne, 'True'], 1, -1]).evaluate().re).toBe(
      1
    );
  });

  test('statement form: a false condition runs the else branch, NotEqual the then branch', () => {
    const block = (cond: any) =>
      new ComputeEngine()
        .box([
          'Block',
          ['Assign', 'k', 0],
          ['If', cond, ['Assign', 'k', 1], ['Assign', 'k', 2]],
          'k',
        ])
        .evaluate().re;
    expect(block(['Greater', 'NaN', 0])).toBe(2);
    expect(block(['NotEqual', 'NaN', 0])).toBe(1);
  });

  test('the scalar and the indexed element-wise NotEqual agree on a NaN operand', () => {
    // `Which([a, b, c] ≠ 2, 1, True, 0)[2]` is rewritten to the scalar
    // `Which(b ≠ 2, 1, True, 0)` by the compiler (`fixed-width-unroll.ts`), so
    // the two must give the same answer: the cell `NaN ≠ 2` is `True`, and so
    // is the scalar condition (user decision 2026-10-23).
    const e = new ComputeEngine();
    for (const s of ['a', 'b', 'c']) e.declare(s, 'number');
    const vars = { a: 1, b: NaN, c: 3 };
    const forms = [
      ['At', ['Which', ['NotEqual', ['List', 'a', 'b', 'c'], 2], 1, 'True', 0], 2],
      ['Which', ['NotEqual', 'b', 2], 1, 'True', 0],
    ];
    for (const form of forms) {
      const r = compile(e.box(form), { fallback: false });
      expect(r.run!(vars)).toBe(1);
      const held = new ComputeEngine();
      for (const [k, v] of Object.entries(vars)) held.assign(k, v);
      expect(held.box(form).evaluate().re).toBe(1);
    }
  });

  test('element-wise selection is unchanged: a NaN cell takes the else cell on both lanes', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    const r = compile(e.box(['Which', ['Greater', 'L', 0], 1, 'True', -1]), {
      fallback: false,
    });
    expect(r!.run!({ L: [NaN, 1, -1] })).toEqual([-1, 1, -1]);
    e.assign('L', e.box(['List', 'NaN', 1, -1]));
    expect(
      e.box(['Which', ['Greater', 'L', 0], 1, 'True', -1]).evaluate().json
    ).toEqual(['List', -1, 1, -1]);
    // A NaN on the scalar side of an element-wise relation is a cell-wise
    // `False` mask, not a scalar decision; a connective over a list keeps
    // its element-wise shape.
    expect(
      e.box(['Which', ['Greater', 'L', 'NaN'], 1, 'True', -1]).evaluate().json
    ).toEqual(['List', -1, -1, -1]);
    expect(
      e
        .box(['Which', ['And', 'True', ['Greater', 'L', 0]], 1, 'True', -1])
        .evaluate().json
    ).toEqual(['List', -1, 1, -1]);
  });
});

/**
 * Tycho ledger rows 411 and 413, every reading of the 2026-10-20 decision on
 * every route. The cases port Tycho's instruments
 * `scripts/repros/2026-10-20-ce411-interval-compare-empty-repro.mts` and
 * `scripts/repros/2026-10-20-ce413-undefined-comparison-branch-repro.mts`.
 */
describe('Tycho rows 411 and 413: an undefined operand makes a comparison false', () => {
  const RELATIONS = ['>', '<', '=', '\\le', '\\ge'];

  test('row 413: a piecewise over 0/0 takes its else value, parse route', () => {
    for (const rel of RELATIONS) {
      const expr = ce.parse(`\\left\\{\\frac{0}{0}${rel}0:1,0\\right\\}`);
      expect(expr.evaluate().re).toBe(0);
      const c = compile(expr, { to: 'javascript' } as never);
      expect(c.success).toBe(true);
      expect(Number(c.run!({} as never))).toBe(0);
    }
    // `0/0 ≠ 0` is `True` (user decision 2026-10-23).
    const ne = ce.parse('\\left\\{\\frac{0}{0}\\ne0:1,0\\right\\}');
    expect(ne.evaluate().re).toBe(1);
  });

  test('row 413: the comparison alone is False, and NaN ≠ 0 is True', () => {
    expect(ce.parse('\\frac{0}{0} > 0').evaluate().symbol).toBe('False');
    expect(ce.parse('\\frac{0}{0} = 0').evaluate().symbol).toBe('False');
    expect(ce.parse('\\mathrm{NaN} \\ne 0').evaluate().symbol).toBe('True');
  });

  test('row 413: the box and ce.function routes', () => {
    expect(
      ce.box(['If', ['Greater', ['Divide', 0, 0], 0], 1, 0]).evaluate().re
    ).toBe(0);
    expect(
      ce.box(['Which', ['Less', ['Divide', 0, 0], 0], 1, 'True', 0]).evaluate()
        .re
    ).toBe(0);
    expect(
      ce
        .function('If', [
          ce.function('Greater', [ce.NaN, ce.number(0)]),
          ce.number(1),
          ce.number(0),
        ])
        .evaluate().re
    ).toBe(0);
    expect(
      ce
        .function('Which', [
          ce.function('Equal', [
            ce.function('Divide', [ce.number(0), ce.number(0)]),
            ce.number(0),
          ]),
          ce.number(1),
          ce.True,
          ce.number(0),
        ])
        .evaluate().re
    ).toBe(0);
    // `≠` takes the first arm on both routes.
    expect(
      ce.box(['If', ['NotEqual', ['Divide', 0, 0], 0], 1, 0]).evaluate().re
    ).toBe(1);
    expect(
      ce
        .function('If', [
          ce.function('NotEqual', [ce.NaN, ce.number(0)]),
          ce.number(1),
          ce.number(0),
        ])
        .evaluate().re
    ).toBe(1);
  });

  test('row 413: the javascript target takes the else arm at x = NaN', () => {
    const expr = ce.parse('\\left\\{x > 0: 1, 0\\right\\}');
    const c = compile(expr, { to: 'javascript', fallback: false } as never);
    expect(c.success).toBe(true);
    expect(c.run!({ x: NaN } as never)).toBe(0);
    expect(c.run!({ x: 2 } as never)).toBe(1);
    // The guard that answered NaN for a NaN `x` is gone; what is left tests
    // for an unsupplied `x`, which is still undecided.
    expect(c.code).not.toContain('_.x === _.x');
    expect(c.run!({} as never)).toBeNaN();
    const ne = compile(ce.parse('\\left\\{x \\ne 0: 1, 0\\right\\}'), {
      to: 'javascript',
      fallback: false,
    } as never);
    expect(ne.run!({ x: NaN } as never)).toBe(1);
  });

  (TEST_PYTHON === undefined ? test.skip : test)(
    'row 413: the python target takes the else arm at x = nan',
    () => {
      const run = (latex: string): string => {
        const c = compile(ce.parse(latex), { to: 'python' } as never);
        expect(c.success).toBe(true);
        const script = `import numpy as np\nx = float('nan')\nprint(float(${c.code}))\n`;
        return execFileSync(TEST_PYTHON!, ['-I', '-c', script], {
          encoding: 'utf8',
        }).trim();
      };
      expect(run('\\left\\{x > 0: 1, 0\\right\\}')).toBe('0.0');
      expect(run('\\left\\{x = 0: 1, 0\\right\\}')).toBe('0.0');
      expect(run('\\left\\{x \\ne 0: 1, 0\\right\\}')).toBe('1.0');
    }
  );

  test('row 411: on interval-js an empty operand gives a definite false', () => {
    const c = compile(ce.parse('0<\\sqrt{x}'), { to: 'interval-js' } as never);
    expect(c.success).toBe(true);
    // `\sqrt{x}` over [-1, -1] is `empty`.
    expect(c.run!({ x: { lo: -1, hi: -1 } } as never)).toBe('false');
    // Over [-1, 1] it is `partial`: unchanged, `maybe`.
    expect(c.run!({ x: { lo: -1, hi: 1 } } as never)).toBe('maybe');
    expect(c.run!({ x: { lo: 1, hi: 2 } } as never)).toBe('true');
    for (const rel of ['>', '\\le', '\\ge', '=']) {
      const r = compile(ce.parse(`\\sqrt{x} ${rel} 0`), {
        to: 'interval-js',
      } as never);
      expect(r.run!({ x: { lo: -1, hi: -1 } } as never)).toBe('false');
    }
    // `≠` is not part of the decision: `maybe`, as before.
    const ne = compile(ce.parse('\\sqrt{x} \\ne 0'), {
      to: 'interval-js',
    } as never);
    expect(ne.run!({ x: { lo: -1, hi: -1 } } as never)).toBe('maybe');
  });

  test('row 411: a partial operand is at most maybe', () => {
    // `\sqrt{x}` over [-1, 1] encloses [0, 1] on the part where it is
    // defined, so `\sqrt{x} ≥ 0` held there and the verdict used to be
    // `'true'`. Over [-1, 0) the root is undefined and the comparison is
    // false (the 2026-10-20 decision), so it does not hold over the whole
    // cell: `'maybe'`.
    const c = compile(ce.parse('\\sqrt{x} \\ge 0'), {
      to: 'interval-js',
    } as never);
    expect(c.run!({ x: { lo: -1, hi: 1 } } as never)).toBe('maybe');
    expect(c.run!({ x: { lo: 1, hi: 4 } } as never)).toBe('true');
    // A partial operand that is false where it is defined is false.
    const lt = compile(ce.parse('\\sqrt{x} < 0'), {
      to: 'interval-js',
    } as never);
    expect(lt.run!({ x: { lo: -1, hi: 1 } } as never)).toBe('false');
  });

  test('row 411: the false verdict selects the else arm of a piecewise', () => {
    const c = compile(ce.parse('\\left\\{\\sqrt{x}>0: 1, 0\\right\\}'), {
      to: 'interval-js',
    } as never);
    expect(c.success).toBe(true);
    expect(c.run!({ x: { lo: -1, hi: -1 } } as never)).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
    expect(c.run!({ x: { lo: 4, hi: 4 } } as never)).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
  });

  test("row 413: Tycho's bar, a sum of a piecewise over a function undefined at 0", () => {
    // `K(0)` is `0^0`, `Indeterminate`; every other `K(n)` is 1. So `M(0)`
    // is 0 and `N` counts the 10 000 positive terms.
    const e = new ComputeEngine();
    e.parse('K(n) := n^0').evaluate();
    e.parse('M(n) := \\left\\{K(n) > 0: 1, 0\\right\\}').evaluate();
    expect(e.parse('K(0)').evaluate().isNaN).toBe(true);
    expect(e.parse('M(0)').evaluate().re).toBe(0);
    expect(e.parse('\\sum_{n=0}^{10000} M(n)').evaluate().re).toBe(10000);
    // The same with `K(n) := ln(n + 1)/n`, `0/0` at 0.
    const f = new ComputeEngine();
    f.parse('K(n) := \\frac{\\ln(n+1)}{n}').evaluate();
    f.parse('M(n) := \\left\\{K(n) > 0: 1, 0\\right\\}').evaluate();
    expect(f.parse('\\sum_{n=0}^{100} M(n)').evaluate().re).toBe(100);
  });
});

/**
 * What the compiled guard of a branch comparison still tests after the
 * 2026-10-20 decision: an ABSENT operand. NaN is the no-selection value of a
 * nested else-less `If` or default-less `Which` with a numeric result, so an
 * operand that may be absent keeps its NaN test; every variable the operand
 * reads on every evaluation, whatever its type and however it is reached, is
 * tested for `undefined`; a variable read only by a nested arm is not. On
 * `interval-js` the no-selection value of a default-less `Which` is an
 * `empty` with the `missing` flag, and a comparison with it is `'maybe'`.
 */
describe('the absence guard of a compiled branch comparison', () => {
  const NESTED_ELSELESS = [
    'If',
    ['Greater', ['If', ['Greater', 'c', 0], 1], 0],
    1,
    0,
  ];

  test('a nested else-less If that selects no arm leaves the branch with no arm', () => {
    const e = new ComputeEngine();
    e.assign('c', -1);
    // The interpreter: `Missing > 0` is `Missing`, the absent-condition error.
    expect(e.box(NESTED_ELSELESS).evaluate().operator).toBe('Error');
    expect(compiled(NESTED_ELSELESS, { c: -1 })).toBeNaN();
    expect(compiled(NESTED_ELSELESS, { c: 2 })).toBe(1);
    // Arithmetic over the absent value is `NaN` in the interpreter too, and
    // a comparison with it is false: the else arm on both routes.
    const sum = [
      'If',
      ['Greater', ['Add', ['If', ['Greater', 'c', 0], 1], 1], 0],
      1,
      0,
    ];
    expect(e.box(sum).evaluate().re).toBe(0);
    expect(compiled(sum, { c: -1 })).toBe(0);
  });

  (TEST_PYTHON === undefined ? test.skip : test)(
    'a nested else-less If that selects no arm, python',
    () => {
      const c = compile(ce.box(NESTED_ELSELESS), { to: 'python' } as never);
      expect(c.success).toBe(true);
      const run = (v: string): string =>
        execFileSync(
          TEST_PYTHON!,
          [
            '-I',
            '-c',
            `import math\nimport numpy as np\nc = ${v}\nprint(float(${c.code}))\n`,
          ],
          { encoding: 'utf8' }
        ).trim();
      expect(run('-1')).toBe('nan');
      expect(run('2')).toBe('1.0');
    }
  );

  test('a variable read only by a nested arm is not tested', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('y', 'real');
    const expr = [
      'If',
      ['Greater', ['If', ['Greater', 'x', 0], 'y', 1], 0],
      1,
      0,
    ];
    const c = compile(e.box(expr), { fallback: false, constantFold: false });
    expect(c?.success).toBe(true);
    // At `x = -1` the inner `If` takes its else arm and never reads `y`.
    expect(c!.run!({ x: -1 } as never)).toBe(1);
    // The condition of the inner `If` is read every time: an unsupplied `x`
    // still leaves the branch with no arm.
    expect(c!.run!({} as never)).toBeNaN();
    // The interpreter with `y` free.
    const f = new ComputeEngine();
    f.assign('x', -1);
    expect(f.box(expr).evaluate().re).toBe(1);
  });

  test('a variable read through an assigned value or a user function is tested', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.parse('a := \\sin(x)').evaluate();
    const viaValue = compile(
      e.box(['If', ['Greater', ['Cos', 'a'], 0], 1, 0]),
      {
        fallback: false,
      } as never
    );
    expect(viaValue.success).toBe(true);
    expect(viaValue.run!({} as never)).toBeNaN();
    expect(viaValue.run!({ x: 0 } as never)).toBe(1);
    e.parse('g(t) := t + z').evaluate();
    const viaFunction = compile(e.box(['If', ['Greater', ['g', 1], 0], 1, 0]), {
      fallback: false,
    } as never);
    expect(viaFunction.success).toBe(true);
    expect(viaFunction.run!({} as never)).toBeNaN();
    expect(viaFunction.run!({ z: 1 } as never)).toBe(1);
  });

  test('a variable of any type is tested: a point read through an accessor', () => {
    const e = new ComputeEngine();
    e.declare('p', 'tuple<real, real>');
    const at = compile(e.box(['If', ['Greater', ['At', 'p', 1], 0], 1, 0]), {
      fallback: false,
    } as never);
    expect(at.success).toBe(true);
    expect(at.run!({} as never)).toBeNaN();
    expect(at.run!({ p: [1, 2] } as never)).toBe(1);
    // The Desmos spelling `p.x`.
    const dot = compile(e.parse('\\left\\{p.x > 0: 1, 0\\right\\}'), {
      fallback: false,
    } as never);
    expect(dot.success).toBe(true);
    expect(dot.run!({} as never)).toBeNaN();
    expect(dot.run!({ p: [1, 2] } as never)).toBe(1);
    expect(dot.run!({ p: [-1, 2] } as never)).toBe(0);
  });

  test('the operand of Coalesce is not tested', () => {
    const e = new ComputeEngine();
    e.declare('y', 'real');
    const c = compile(
      e.box(['If', ['Greater', ['Coalesce', 'y', 1], 0], 1, 0]),
      { fallback: false } as never
    );
    expect(c.success).toBe(true);
    expect(c.run!({} as never)).toBe(1);
  });

  test('interval-js: a default-less Which that selects no clause is maybe', () => {
    const e = new ComputeEngine();
    const X = { x: { lo: 0, hi: 1 } };
    const run = (expr: any): unknown =>
      compile(e.box(expr), { to: 'interval-js' } as never).run!(X as never);
    const which = ['Which', ['Greater', 'x', 5], 1];
    expect(run(['Greater', which, 0])).toBe('maybe');
    expect(run(['Greater', ['If', ['Greater', 'x', 5], 1], 0])).toBe('maybe');
    // The branch over it cannot take one arm: the hull of both.
    expect(run(['If', ['Greater', which, 0], 1, 2])).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 2 },
    });
    // The runner gives the absent value as a plain `empty`.
    expect(run(which)).toEqual({ kind: 'empty' });
    // The interpreter at a point of the cell: `Missing`.
    e.assign('x', 0.5);
    expect(e.box(['Greater', which, 0]).evaluate().symbol).toBe('Missing');
    // A `When` whose condition is false is a numeric undefined value
    // (`NaN`) in the interpreter, so a comparison with it is false.
    expect(
      e.box(['Greater', ['When', 1, ['Greater', 'x', 5]], 0]).evaluate().symbol
    ).toBe('False');
    const f = new ComputeEngine();
    expect(
      compile(f.box(['Greater', ['When', 1, ['Greater', 'x', 5]], 0]), {
        to: 'interval-js',
      } as never).run!(X as never)
    ).toBe('false');
  });
});

/**
 * A value that has no order: the pole `ComplexInfinity` (`1/0`) and a
 * number that is not real (`i`, `\sqrt{-1}`, `\ln(-1)` = `iπ`).
 *
 * User decision of 2026-10-21 (Tycho ledger row 413 (a)), which extends the
 * 2026-10-20 decision above: an ordered comparison (`<`, `≤`, `>`, `≥`)
 * with such an operand is `False`, in a branch and everywhere else. `=` with
 * the pole is `False` (the pole has no value, as `NaN` has none), while `=`
 * with a complex number keeps the ordinary equality. `≠` is unchanged.
 * `+∞` and `−∞` are real and keep their order. The comparison stays inert
 * only when every operand is a free symbol or an unevaluated form that
 * depends on one (`0 < x`, `0 < ix`): a value with no order decides `False`
 * also next to a free symbol (`x < i`), as `NaN` does (`x < NaN`). Before,
 * each of these comparisons stayed unevaluated, so a branch on it was held.
 */
describe('Tycho row 413 (a): a value with no order makes a comparison false', () => {
  const ORDERED = ['Less', 'LessEqual', 'Greater', 'GreaterEqual'];

  test('the table of the decision, parse route', () => {
    const cases: [string, string][] = [
      ['0 < \\frac{1}{0}', 'False'],
      ['\\frac{1}{0} = \\frac{1}{0}', 'False'],
      ['\\frac{1}{0} = 0', 'False'],
      ['0 < i', 'False'],
      ['0 < \\ln(-1)', 'False'],
      ['i = i', 'True'],
      ['i = 0', 'False'],
      ['\\frac{1}{0} \\ne 0', 'True'],
      ['0 < \\infty', 'True'],
      ['\\infty = \\infty', 'True'],
    ];
    for (const [latex, expected] of cases) {
      expect(ce.parse(latex).evaluate().symbol).toBe(expected);
      expect(ce.parse(latex).N().symbol).toBe(expected);
    }
    expect(
      ce.parse('\\left\\{\\frac{1}{0} > 0: 1, 0\\right\\}').evaluate().re
    ).toBe(0);
    expect(
      ce.parse('\\left\\{\\sqrt{-1} > 0: 1, 0\\right\\}').evaluate().re
    ).toBe(0);
    // A free symbol keeps the comparison inert when no operand has a value.
    expect(ce.parse('0 < x').evaluate().operator).toBe('Less');
    expect(ce.parse('0 < i x').evaluate().operator).toBe('Less');
    // A value with no order decides `False` next to a free symbol, as `NaN`
    // does.
    for (const latex of [
      'x < i',
      '\\ln(-1) < x',
      'x < \\frac{1}{0}',
      '\\frac{1}{0} = x',
      'x < \\mathrm{NaN}',
    ])
      expect(ce.parse(latex).evaluate().symbol).toBe('False');
  });

  test('the four ordered relations, on the box and ce.function routes', () => {
    const pole = ['Divide', 1, 0];
    const operands: any[] = [
      pole,
      'ImaginaryUnit',
      ['Sqrt', -1],
      ['Ln', -1],
      ['Complex', 1, 1],
    ];
    for (const head of ORDERED) {
      for (const z of operands) {
        expect(ce.box([head, 0, z]).evaluate().symbol).toBe('False');
        expect(ce.box([head, z, 0]).evaluate().symbol).toBe('False');
        expect(ce.box(['If', [head, z, 0], 1, -1]).evaluate().re).toBe(-1);
        expect(
          ce.function(head, [ce.box(z), ce.number(0)]).evaluate().symbol
        ).toBe('False');
        expect(
          ce
            .function('Which', [
              ce.function(head, [ce.number(0), ce.box(z)]),
              ce.number(1),
              ce.True,
              ce.number(0),
            ])
            .evaluate().re
        ).toBe(0);
      }
      // `±∞` are real: their order is kept.
      expect(ce.box([head, 0, 'PositiveInfinity']).evaluate().symbol).toBe(
        head === 'Less' || head === 'LessEqual' ? 'True' : 'False'
      );
    }
    // A chain is the conjunction of its pairs.
    expect(ce.box(['Less', pole, 1, 2]).evaluate().symbol).toBe('False');
    expect(ce.box(['Less', 1, 2, pole]).evaluate().symbol).toBe('False');
  });

  test('Equal: the pole is False, a complex number keeps its equality', () => {
    const pole = ['Divide', 1, 0];
    expect(ce.box(['Equal', pole, pole]).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', pole, 0]).evaluate().symbol).toBe('False');
    expect(
      ce.function('Equal', [ce.ComplexInfinity, ce.ComplexInfinity]).evaluate()
        .symbol
    ).toBe('False');
    expect(ce.box(['If', ['Equal', pole, pole], 1, -1]).evaluate().re).toBe(-1);
    expect(
      ce.box(['Equal', 'ImaginaryUnit', 'ImaginaryUnit']).evaluate().symbol
    ).toBe('True');
    expect(
      ce.box(['Equal', ['Sqrt', -1], 'ImaginaryUnit']).evaluate().symbol
    ).toBe('True');
    expect(ce.box(['Equal', 'ImaginaryUnit', 0]).evaluate().symbol).toBe(
      'False'
    );
    expect(ce.box(['Equal', ['Ln', -1], ['Ln', -1]]).evaluate().symbol).toBe(
      'True'
    );
    expect(
      ce.box(['Equal', 'PositiveInfinity', 'PositiveInfinity']).evaluate()
        .symbol
    ).toBe('True');
  });

  test('NotEqual and Missing keep their reading', () => {
    expect(ce.box(['NotEqual', ['Divide', 1, 0], 0]).evaluate().symbol).toBe(
      'True'
    );
    expect(ce.box(['NotEqual', 'ImaginaryUnit', 0]).evaluate().symbol).toBe(
      'True'
    );
    expect(ce.box(['Less', 'Missing', 'ImaginaryUnit']).evaluate().symbol).toBe(
      'Missing'
    );
    expect(
      ce.box(['Equal', 'Missing', ['Divide', 1, 0]]).evaluate().symbol
    ).toBe('Missing');
  });

  test('a symbol holding such a value, and the asynchronous route', async () => {
    const e = new ComputeEngine();
    e.assign('p', e.ComplexInfinity);
    e.assign('u', -1);
    expect(e.parse('p > 0').evaluate().symbol).toBe('False');
    expect(e.parse('\\ln(u) > 0').evaluate().symbol).toBe('False');
    expect(e.parse('\\left\\{p > 0: 1, 0\\right\\}').evaluate().re).toBe(0);
    expect((await e.parse('0 < \\ln(-1)').evaluateAsync()).symbol).toBe(
      'False'
    );
  });

  test("Tycho's shape: a sum of a piecewise over K(n) = 1/n", () => {
    // `M(0)` compares `1/0`, the pole, and takes the else value 0.
    const e = new ComputeEngine();
    e.parse('M(n) := \\left\\{\\frac{1}{n} > 0: 1, 0\\right\\}').evaluate();
    expect(e.parse('M(0)').evaluate().re).toBe(0);
    expect(e.parse('\\sum_{n=0}^{10} M(n)').evaluate().re).toBe(10);
  });

  test('compiled routes: the pole of a variable is Infinity on javascript (a lane difference)', () => {
    // Not changed by the decision: on `javascript` (and `python`, with NumPy)
    // `1/0` is the IEEE `Infinity`, which is ordered, so the branch at x = 0
    // takes the then arm. See `docs/ERROR-MODEL.md`.
    const c = compile(ce.parse('\\left\\{\\frac{1}{x} > 0: 1, 0\\right\\}'), {
      to: 'javascript',
      fallback: false,
    } as never);
    expect(c.success).toBe(true);
    expect(c.run!({ x: 0 } as never)).toBe(1);
    // A closed comparison folds to the value of the interpreter.
    const closed = compile(
      ce.parse('\\left\\{\\frac{1}{0} > 0: 1, 0\\right\\}'),
      { to: 'javascript', fallback: false } as never
    );
    expect(closed.run!({} as never)).toBe(0);
    // A non-real value of a variable takes the else arm (the runtime rule of
    // the complex modes).
    const root = compile(ce.parse('\\left\\{\\sqrt{x} > 0: 1, 0\\right\\}'), {
      to: 'javascript',
      fallback: false,
    } as never);
    expect(root.run!({ x: -1 } as never)).toBe(0);
    if (TEST_PYTHON !== undefined) {
      // The same lane difference on `python`: with a NumPy `x`, `1 / x` at
      // `x = 0` is `inf` (a plain Python float raises ZeroDivisionError).
      const py = compile(
        ce.parse('\\left\\{\\frac{1}{x} > 0: 1, 0\\right\\}'),
        { to: 'python' } as never
      );
      expect(py.success).toBe(true);
      const script = `import numpy as np\nnp.seterr(all='ignore')\nx = np.float64(0.0)\nprint(float(${py.code}))\n`;
      expect(
        execFileSync(TEST_PYTHON, ['-I', '-c', script], {
          encoding: 'utf8',
        }).trim()
      ).toBe('1.0');
    }
    // On interval-js `1/x` over the point [0, 0] is `empty`, so the
    // comparison is `'false'` and the branch takes the else arm.
    const iv = compile(ce.parse('\\left\\{\\frac{1}{x} > 0: 1, 0\\right\\}'), {
      to: 'interval-js',
    } as never);
    expect(iv.run!({ x: { lo: 0, hi: 0 } } as never)).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });
});

/**
 * The rule of the 2026-10-21 decision (a value with no order makes an
 * ordered comparison `False`) applied where the first implementation missed
 * it or applied it too widely.
 */
describe('Tycho row 413 (a): the edges of the rule', () => {
  /** The complex double `1/(a + bi)`. */
  const inv = (a: number, b: number) => ({
    re: a / (a * a + b * b),
    im: -b / (a * a + b * b),
  });

  test('a convergent integral with a complex exponent is not dropped', () => {
    // The convergence guard is over the real part of the exponent
    // (`Re(p) > 0`), not over the exponent: `0 < 1 + iπ` is `False`.
    const cases: [string, { re: number; im: number }][] = [
      ['\\int_0^1 x^{i\\pi} dx', inv(1, Math.PI)],
      ['\\int_0^1 x^{\\ln(-1)} dx', inv(1, Math.PI)],
      ['\\int_0^1 x^{\\sqrt{-2}} dx', inv(1, Math.SQRT2)],
      ['\\int_0^1 x^{1+\\ln(-1)} dx', inv(2, Math.PI)],
      ['\\int_1^\\infty x^{-2+i\\pi} dx', inv(1, -Math.PI)],
      ['\\int_0^\\infty e^{-(1+\\ln(-1))x} dx', inv(1, Math.PI)],
    ];
    for (const [latex, expected] of cases) {
      const value = ce.parse(latex).evaluate();
      expect(value.operator).not.toBe('Integrate');
      const n = value.N();
      expect(n.re).toBeCloseTo(expected.re, 12);
      expect(n.im).toBeCloseTo(expected.im, 12);
    }
    // A real parameter keeps the guard as written.
    expect(ce.parse('\\int_0^1 x^n dx').evaluate().toString()).toBe(
      '1 / (n + 1) {0 < n + 1}'
    );
  });

  test('a logarithm with a complex base keeps its root', () => {
    // `(1 + i)² = 2i`: the base is not real, so `0 < 1 + i` is not a
    // condition of the root (only `b ≠ 0` and `b ≠ 1` are).
    const roots = ce.parse('\\log_{1+i}(x) = 2').solve('x');
    expect(roots?.map((r) => r.toString())).toEqual(['2i']);
    const [root] = ce.parse('\\log_i(x) + \\log_i(x+2) = 1').solve('x') ?? [];
    expect(root).toBeDefined();
    const lhs = ce.parse('\\log_i(x) + \\log_i(x+2)').subs({ x: root }).N();
    expect(lhs.re).toBeCloseTo(1, 12);
    expect(lhs.im).toBeCloseTo(0, 12);
    // A real base keeps the positivity guard.
    expect(
      ce
        .parse('\\log_a(x) = 3')
        .solve('x')
        ?.map((r) => r.toString())
    ).toEqual(['a^3 {0 < a && a != 1}']);
  });

  test('a chain stops at a pair with a value with no order', async () => {
    // `(0 < i) ∧ (i < Missing)` is `False ∧ Missing`, which is `False`.
    expect(
      ce.box(['Less', 0, 'ImaginaryUnit', 'Missing']).evaluate().symbol
    ).toBe('False');
    expect(
      ce.box(['Less', 0, ['Divide', 1, 0], 'Missing']).evaluate().symbol
    ).toBe('False');
    expect(ce.box(['Less', 0, ['Ln', -1], 'Missing']).evaluate().symbol).toBe(
      'False'
    );
    expect(
      ce
        .box(['Equal', ['Divide', 1, 0], ['Divide', 1, 0], 'Missing'])
        .evaluate().symbol
    ).toBe('False');
    // A `Missing` in the same pair keeps the Kleene `Missing`.
    expect(ce.box(['Less', 'ImaginaryUnit', 'Missing']).evaluate().symbol).toBe(
      'Missing'
    );
    // The operands after the pair are not evaluated.
    const e = new ComputeEngine();
    e.assign('w', 0);
    const chain = ['Less', 0, 'ImaginaryUnit', ['Assign', 'w', 5]] as const;
    expect(e.box(chain as never).evaluate().symbol).toBe('False');
    expect(e.box('w').evaluate().re).toBe(0);
    expect((await e.box(chain as never).evaluateAsync()).symbol).toBe('False');
    expect(e.box('w').evaluate().re).toBe(0);
  });

  test('a tie of two values with no order is not a true ≤', () => {
    const ln = ['Ln', -1];
    for (const head of ['LessEqual', 'GreaterEqual']) {
      expect(ce.box([head, ln, ln]).evaluate().symbol).toBe('False');
      expect(ce.box([head, ln, ln]).N().symbol).toBe('False');
      expect(ce.box([head, ln, ln, ln]).evaluate().symbol).toBe('False');
      expect(ce.box(['If', [head, ln, ln], 1, -1]).evaluate().re).toBe(-1);
    }
    expect(ce.box(['LessEqual', 'Pi', 'Pi']).evaluate().symbol).toBe('True');
  });

  test('an imaginary part too small for a double is not zero', () => {
    const z = ce.number({ re: 1, im: ce.bignum('1e-800') });
    expect(ce.function('LessEqual', [z, z]).evaluate().symbol).toBe('False');
    expect(ce.function('Less', [ce.Zero, z]).evaluate().symbol).toBe('False');
  });

  test('the noise rule of an approximation is relative to the modulus', () => {
    // `e^{25} + iπ`: the imaginary part is 4·10⁻¹¹ of the real part, far
    // above the rounding noise.
    expect(ce.parse('0 < e^{25} + \\ln(-1)').evaluate().symbol).toBe('False');
    expect(
      ce
        .function('Less', [ce.Zero, ce.parse('e^{25} + \\ln(-1)').N()])
        .evaluate().symbol
    ).toBe('False');
    // A real value computed through complex values is still ordered.
    expect(ce.parse('0 < \\frac{(1+i)^2}{2i}').evaluate().symbol).toBe('True');
  });

  test('a closed integral whose value is not real', () => {
    // The approximation of a quadrature is a `Measurement`: its nominal
    // value is read.
    const latex = '0 < \\int_0^1 e^{ix^2} dx';
    expect(ce.parse(latex).evaluate().symbol).toBe('False');
    expect(ce.parse(latex).N().symbol).toBe('False');
    expect(ce.parse('0 < \\int_0^1 e^{-x^2} dx').evaluate().symbol).toBe(
      'True'
    );
  });

  test('a closed comparison with the pole folds under constantFold: false', () => {
    for (const [latex, value] of [
      ['0 < \\frac{1}{0}', false],
      ['\\frac{1}{0} = \\frac{1}{0}', false],
      ['\\frac{1}{0} \\ne 0', true],
    ] as const) {
      for (const constantFold of [true, false]) {
        const js = compile(ce.parse(latex), {
          to: 'javascript',
          fallback: false,
          constantFold,
        } as never);
        expect(js.code).toBe(String(value));
        expect(js.run!({} as never)).toBe(value);
        const py = compile(ce.parse(latex), {
          to: 'python',
          fallback: false,
          constantFold,
        } as never);
        expect(py.code).toBe(value ? 'True' : 'False');
      }
    }
  });
});
