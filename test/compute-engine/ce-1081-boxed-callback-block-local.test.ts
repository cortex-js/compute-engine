/**
 * CE-1081: a function literal with a `Block` local or a nested literal,
 * boxed before it is mapped over the rows of a matrix, gave one number per
 * row where it should give a row.
 *
 * A function literal boxed before the call has a canonical body that reads
 * each untyped parameter as a possible number, so `row/row` is folded to
 * `1`. When the call applies the literal to rows, the literal is
 * canonicalized again from its written form with the type of a row. Before
 * this fix, that was done only when each name of the body binds in the
 * scope of the call as it did where the literal was boxed
 * (`bindsAsInCurrentScope()`, `boxed-expression/box.ts`). That test cannot
 * compare a `Block` local or the parameter of a nested literal, so such a
 * literal kept its boxed body and gave `[1, 1]` for
 * `Map(row ↦ (q ≔ 1; q·row/row), [[1, 2], [3, 4]])`.
 *
 * The literal is now canonicalized again in the scope where it was boxed
 * when the test fails, as the literal of a value kind already was.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const M = ['List', ['List', 1, 2], ['List', 3, 4]] as const;

function list(ce: ComputeEngine, x: Expression): string {
  return JSON.stringify(ce.box(['ListFrom', x]).evaluate().json);
}

// row ↦ (q ≔ <init>; q · row/row)
function blockLocal(init: unknown): unknown {
  return [
    'Function',
    ['Block', ['Assign', 'q', init], ['Multiply', 'q', ['Divide', 'row', 'row']]],
    'row',
  ];
}

describe('A LITERAL WITH A LOCAL, BOXED BEFORE A MAP OVER ROWS (CE-1081)', () => {
  test('a Block local: the value and the type of the inline literal', () => {
    const ce = new ComputeEngine();
    const W = blockLocal(1);
    const boxed = ce.function('Map', [ce.box(W as any), ce.box(M as any)]);
    const inline = ce.box(['Map', W, M] as any);
    expect(boxed.type.toString()).toBe('matrix<2x2>');
    expect(inline.type.toString()).toBe('matrix<2x2>');
    expect(list(ce, boxed)).toBe('["List",["List",1,1],["List",1,1]]');
    expect(list(ce, inline)).toBe(list(ce, boxed));
  });

  test('a nested literal: the value of the inline literal', () => {
    // row ↦ Apply(x ↦ x · row/row, 1)
    const ce = new ComputeEngine();
    const W = [
      'Function',
      [
        'Apply',
        ['Function', ['Multiply', 'x', ['Divide', 'row', 'row']], 'x'],
        1,
      ],
      'row',
    ];
    const boxed = ce.function('Map', [ce.box(W as any), ce.box(M as any)]);
    const inline = ce.box(['Map', W, M] as any);
    expect(list(ce, inline)).toBe('["List",["List",1,1],["List",1,1]]');
    expect(list(ce, boxed)).toBe(list(ce, inline));
  });

  test('a free name keeps the binding of the scope where the literal was boxed', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'integer');
    ce.assign('k', 1);
    const f = ce.box(blockLocal('k') as any);
    ce.pushScope();
    try {
      ce.declare('k', 'integer');
      ce.assign('k', 2);
      const call = ce.function('Map', [f, ce.box(M as any)]);
      expect(call.type.toString()).toBe('matrix<2x2>');
      expect(list(ce, call)).toBe('["List",["List",1,1],["List",1,1]]');
      // The same literal written inline reads the inner `k`.
      expect(list(ce, ce.box(['Map', blockLocal('k'), M] as any))).toBe(
        '["List",["List",2,2],["List",2,2]]'
      );
    } finally {
      ce.popScope();
    }
  });

  test('a fold with a Block local is typed as the inline fold', () => {
    // (a, t) ↦ (q ≔ t; a + q)
    const ce = new ComputeEngine();
    const SUM = [
      'Function',
      ['Block', ['Assign', 'q', 't'], ['Add', 'a', 'q']],
      'a',
      't',
    ];
    const boxed = ce.function('Reduce', [
      ce.box(M as any),
      ce.box(SUM as any),
      ce.box(0),
    ]);
    const inline = ce.box(['Reduce', M, SUM, 0] as any);
    expect(boxed.type.toString()).toBe(inline.type.toString());
    expect(JSON.stringify(boxed.evaluate().json)).toBe('["List",4,6]');
  });
});
