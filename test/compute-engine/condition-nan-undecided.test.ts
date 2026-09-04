import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A NaN operand of a branch condition is UNDECIDED (ruled 2026-09-03): the
 * `If`/`Which` selects no arm. The interpreter answers `Missing`, its
 * no-selection value; the compiled JavaScript answers `NaN`, the numeric
 * codomain's spelling of the same marker. The comparison itself keeps its
 * IEEE value everywhere else. Before the ruling the interpreter took the
 * else arm (`Greater(NaN, 0)` is `False`) while the compiled lane answered
 * `NaN`, so the two lanes disagreed at a literal NaN.
 */

const ce = new ComputeEngine();

/** The compiled JavaScript value of `expr` at `vars`. */
function compiled(expr: any, vars: object): unknown {
  const r = compile(ce.box(expr), { fallback: false, constantFold: false });
  expect(r?.success).toBe(true);
  return r!.run!(vars);
}

describe('a NaN operand of a branch condition selects no arm', () => {
  test('If: every relational head, both operand positions', () => {
    for (const head of [
      'Less',
      'LessEqual',
      'Greater',
      'GreaterEqual',
      'Equal',
      'NotEqual',
    ]) {
      expect(ce.box(['If', [head, 'NaN', 0], 1, -1]).evaluate().symbol).toBe(
        'Missing'
      );
      expect(ce.box(['If', [head, 0, 'NaN'], 1, -1]).evaluate().symbol).toBe(
        'Missing'
      );
      expect(compiled(['If', [head, 'x', 0], 1, -1], { x: NaN })).toBeNaN();
    }
  });

  test('a symbol holding NaN is the same as the literal', () => {
    const e = new ComputeEngine();
    e.assign('u', NaN);
    expect(e.box(['If', ['Greater', 'u', 0], 1, -1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(e.box(['If', ['Greater', 'u', 0], 1]).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('the comparison itself keeps its IEEE value', () => {
    expect(ce.box(['Greater', 'NaN', 0]).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
    expect(ce.box(['NotEqual', 'NaN', 1]).evaluate().symbol).toBe('True');
  });

  test('Which: a NaN guard that is reached answers Missing, no fall-through', () => {
    const w = [
      'Which',
      ['Greater', 'NaN', 0],
      1,
      ['Less', 'NaN', 0],
      2,
      'True',
      3,
    ];
    expect(ce.box(w).evaluate().symbol).toBe('Missing');
    expect(
      compiled(
        ['Which', ['Greater', 'x', 0], 1, ['Less', 'x', 0], 2, 'True', 3],
        {
          x: NaN,
        }
      )
    ).toBeNaN();
    // An earlier decided clause still selects before the NaN guard is reached.
    expect(
      ce
        .box(['Which', ['Greater', 1, 0], 1, ['Less', 'NaN', 0], 2, 'True', 3])
        .evaluate().re
    ).toBe(1);
  });

  test('connectives combine three-valued, as the compiled lowering does', () => {
    const nan = ['Greater', 'NaN', 0];
    const cases: [any, unknown][] = [
      [['And', nan, 'True'], 'Missing'],
      [['And', nan, 'False'], -1],
      [['Or', nan, 'True'], 1],
      [['Or', nan, 'False'], 'Missing'],
      [['Not', nan], 'Missing'],
      [['And', ['Greater', 2, 0], ['Less', 1, 2]], 1],
    ];
    for (const [cond, expected] of cases) {
      const v = ce.box(['If', cond, 1, -1]).evaluate();
      if (typeof expected === 'string') expect(v.symbol).toBe(expected);
      else expect(v.re).toBe(expected);
    }
    // Compiled parity at the same points.
    const x = ['Greater', 'x', 0];
    expect(
      compiled(['If', ['And', x, ['Greater', 'y', 0]], 1, -1], { x: NaN, y: 1 })
    ).toBeNaN();
    expect(
      compiled(['If', ['And', x, ['Greater', 'y', 0]], 1, -1], {
        x: NaN,
        y: -1,
      })
    ).toBe(-1);
    expect(
      compiled(['If', ['Or', x, ['Greater', 'y', 0]], 1, -1], { x: NaN, y: 1 })
    ).toBe(1);
    expect(compiled(['If', ['Not', x], 1, -1], { x: NaN })).toBeNaN();
  });

  test('a free-variable condition is still held inert, NaN sibling or not', () => {
    expect(ce.box(['If', ['Greater', 'x', 0], 1, -1]).evaluate().operator).toBe(
      'If'
    );
    // `x > 0 ∧ NaN > 0`: a later `x := -1` decides the `And` as `False`, so
    // the application stays inert, spelled with the ORIGINAL sub-conditions
    // (folding `NaN > 0` to its IEEE `False` would decide it the wrong way).
    const held = ce
      .box(['If', ['And', ['Greater', 'x', 0], ['Greater', 'NaN', 0]], 1, -1])
      .evaluate();
    expect(held.operator).toBe('If');
    expect(
      held.op1.isSame(
        ce.box(['And', ['Greater', 'x', 0], ['Greater', 'NaN', 0]])
      )
    ).toBe(true);
    // Once `x` is bound the held condition decides.
    const e = new ComputeEngine();
    e.assign('x', -1);
    expect(
      e
        .box(['If', ['And', ['Greater', 'x', 0], ['Greater', 'NaN', 0]], 1, -1])
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
    const nan = ['Greater', 'NaN', 0];
    expect(ce.box(['If', ['Nand', nan, 'True'], 1, -1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce.box(['If', ['Nor', nan, 'False'], 1, -1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(
      ce.box(['If', ['Implies', nan, 'False'], 1, -1]).evaluate().symbol
    ).toBe('Missing');
    expect(ce.box(['If', ['Implies', nan, 'True'], 1, -1]).evaluate().re).toBe(
      1
    );
    // `0 < NaN < 10` canonicalizes to an `And` of two relations.
    expect(
      ce.box(['If', ['Less', 0, 'NaN', 10], 1, -1]).evaluate().symbol
    ).toBe('Missing');
  });

  test('statement form: neither branch runs, the block continues', () => {
    const e = new ComputeEngine();
    const v = e
      .box([
        'Block',
        ['Assign', 'k', 0],
        ['If', ['Greater', 'NaN', 0], ['Assign', 'k', 1], ['Assign', 'k', 2]],
        'k',
      ])
      .evaluate();
    expect(v.re).toBe(0);
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
