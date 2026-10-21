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
 * `NotEqual` is not part of the decision: `NaN ≠ 0` evaluates to `True`
 * (IEEE), and a branch on it still selects no arm — the interpreter answers
 * `Missing`, its no-selection value, and the compiled JavaScript answers
 * `NaN`. `Missing` keeps its Kleene reading.
 *
 * History: from 2026-09-03 to 2026-10-20 a NaN operand of any of the six
 * relations made the branch select no arm (ruled 2026-09-03). Before that
 * ruling the interpreter took the else arm while the compiled lane answered
 * `NaN`.
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
  test('If: an ordered comparison or Equal takes the else arm, NotEqual no arm', () => {
    for (const head of ORDERED_AND_EQUAL) {
      expect(ce.box(['If', [head, 'NaN', 0], 1, -1]).evaluate().re).toBe(-1);
      expect(ce.box(['If', [head, 0, 'NaN'], 1, -1]).evaluate().re).toBe(-1);
      expect(compiled(['If', [head, 'x', 0], 1, -1], { x: NaN })).toBe(-1);
    }
    expect(
      ce.box(['If', ['NotEqual', 'NaN', 0], 1, -1]).evaluate().symbol
    ).toBe('Missing');
    expect(
      ce.box(['If', ['NotEqual', 0, 'NaN'], 1, -1]).evaluate().symbol
    ).toBe('Missing');
    expect(compiled(['If', ['NotEqual', 'x', 0], 1, -1], { x: NaN })).toBeNaN();
  });

  test('a symbol holding NaN is the same as the literal', () => {
    const e = new ComputeEngine();
    e.assign('u', NaN);
    expect(e.box(['If', ['Greater', 'u', 0], 1, -1]).evaluate().re).toBe(-1);
    // An else-less `If` whose condition is false answers `Missing`.
    expect(e.box(['If', ['Greater', 'u', 0], 1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(e.box(['If', ['NotEqual', 'u', 0], 1, -1]).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('the comparison itself keeps its IEEE value', () => {
    expect(ce.box(['Greater', 'NaN', 0]).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
    expect(ce.box(['NotEqual', 'NaN', 1]).evaluate().symbol).toBe('True');
  });

  test('Which: a false NaN guard falls through; a NotEqual guard ends the selection', () => {
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
    // A reached `NotEqual` guard with a NaN operand selects no clause, and
    // the selection does not fall through to a later one.
    const n = ['Which', ['NotEqual', 'NaN', 0], 1, 'True', 3];
    expect(ce.box(n).evaluate().symbol).toBe('Missing');
    expect(
      compiled(['Which', ['NotEqual', 'x', 0], 1, 'True', 3], { x: NaN })
    ).toBeNaN();
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
    // `NaN > 0` is a decided `False`; `NaN ≠ 0` is undecided.
    const gt = ['Greater', 'NaN', 0];
    const ne = ['NotEqual', 'NaN', 0];
    const cases: [any, unknown][] = [
      [['And', gt, 'True'], -1],
      [['Or', gt, 'True'], 1],
      [['Or', gt, 'False'], -1],
      [['Not', gt], 1],
      [['And', ne, 'True'], 'Missing'],
      [['And', ne, 'False'], -1],
      [['Or', ne, 'True'], 1],
      [['Or', ne, 'False'], 'Missing'],
      [['Not', ne], 'Missing'],
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
    expect(
      compiled(['If', ['And', xne, y], 1, -1], { x: NaN, y: 1 })
    ).toBeNaN();
    expect(compiled(['If', ['And', xne, y], 1, -1], { x: NaN, y: -1 })).toBe(
      -1
    );
    expect(compiled(['If', ['Or', xne, y], 1, -1], { x: NaN, y: 1 })).toBe(1);
    expect(compiled(['If', ['Not', xne], 1, -1], { x: NaN })).toBeNaN();
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
    // `x > 0 ∧ NaN ≠ 0`: a later `x := -1` decides the `And` as `False`, so
    // the application stays inert, spelled with the ORIGINAL sub-conditions
    // (folding `NaN ≠ 0` to its IEEE `True` would decide it the wrong way).
    const held = ce
      .box(['If', ['And', ['Greater', 'x', 0], ['NotEqual', 'NaN', 0]], 1, -1])
      .evaluate();
    expect(held.operator).toBe('If');
    expect(
      held.op1.isSame(
        ce.box(['And', ['Greater', 'x', 0], ['NotEqual', 'NaN', 0]])
      )
    ).toBe(true);
    // Once `x` is bound the held condition decides.
    const e = new ComputeEngine();
    e.assign('x', -1);
    expect(
      e
        .box([
          'If',
          ['And', ['Greater', 'x', 0], ['NotEqual', 'NaN', 0]],
          1,
          -1,
        ])
        .evaluate().re
    ).toBe(-1);
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
    // `NaN ≠ 0` is undecided.
    expect(ce.box(['If', ['Nand', ne, 'True'], 1, -1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce.box(['If', ['Nor', ne, 'False'], 1, -1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(
      ce.box(['If', ['Implies', ne, 'False'], 1, -1]).evaluate().symbol
    ).toBe('Missing');
    expect(ce.box(['If', ['Implies', ne, 'True'], 1, -1]).evaluate().re).toBe(
      1
    );
  });

  test('statement form: a false condition runs the else branch, NotEqual neither', () => {
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
    // Neither branch runs, and the block continues.
    expect(block(['NotEqual', 'NaN', 0])).toBe(0);
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
    // `≠` is not part of the decision: no value.
    const ne = ce.parse('\\left\\{\\frac{0}{0}\\ne0:1,0\\right\\}');
    expect(ne.evaluate().symbol).toBe('Missing');
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
    // The `≠` control on both routes.
    expect(
      ce.box(['If', ['NotEqual', ['Divide', 0, 0], 0], 1, 0]).evaluate().symbol
    ).toBe('Missing');
    expect(
      ce
        .function('If', [
          ce.function('NotEqual', [ce.NaN, ce.number(0)]),
          ce.number(1),
          ce.number(0),
        ])
        .evaluate().symbol
    ).toBe('Missing');
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
    expect(ne.run!({ x: NaN } as never)).toBeNaN();
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
      expect(run('\\left\\{x \\ne 0: 1, 0\\right\\}')).toBe('nan');
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
