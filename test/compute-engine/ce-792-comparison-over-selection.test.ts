/**
 * A comparison whose operand is a selection over a list condition is a list
 * of booleans of the condition's length, and a selection over that
 * comparison has one shape.
 *
 * A selection `If(c, L)` or `Which(c, L, …)` whose conditions are all
 * scalar can be absent as a whole: `If(c, L)` is `Missing` when `c` is
 * false. A comparison gives the scalar `False` for such an operand, so
 * `If(c, L) < 2` is typed `boolean | list<boolean>`. A selection with a
 * condition that is a list of booleans is never absent as a whole: it is a
 * list of the condition's length, with a `NaN` cell where no condition
 * holds. The broadcast typing of the comparisons gave it the scalar arm
 * too, so `If(Which(q < 0.1, 2, True, 1) < 2, 1)` was typed
 * `integer | vector<4>`, a union of shapes, and compiled code declined a
 * product over it (`selectsElementWise()` in
 * `src/compute-engine/boxed-expression/conditional-value.ts` now tells the
 * two cases apart).
 *
 * The witness is the Tycho document art/njncrg9fkv: its program declined on
 * JavaScript with "scalar arithmetic over a list-valued operand".
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/global-types';
import { TYCHO_NJNCRG9FKV_PROGRAM } from './fixtures/tycho-njncrg9fkv';

describe('A COMPARISON OVER A SELECTION WITH A LIST CONDITION', () => {
  const ce = new ComputeEngine();
  ce.declare('q', 'list<real^4>');
  ce.declare('c', 'boolean');
  ce.declare('t', 'boolean');
  ce.declare('m', 'list<boolean^4>');
  ce.declare('L', 'list<real^4>');
  ce.declare('QQ', 'list<list<real^4>>');
  ce.declare('k', 'integer');
  ce.declare('d', 'boolean');
  ce.assign(
    'ms',
    ce.expr(['If', 'd', ['List', 'True', 'False', 'True', 'True']])
  );
  // Two masks whose values refer to each other.
  ce.declare('a', 'list<boolean>');
  ce.declare('b', 'list<boolean>');
  ce.assign(
    'a',
    ce.expr(['If', 'b', ['List', 'True', 'False', 'True', 'True']])
  );
  ce.assign(
    'b',
    ce.expr(['If', 'a', ['List', 'True', 'False', 'True', 'True']])
  );
  // A user function whose result is a restriction of a list.
  ce.declare('f', '(boolean) -> list<boolean>');
  ce.assign(
    'f',
    ce.expr([
      'Function',
      ['If', 'x', ['List', 'True', 'False', 'True', 'True']],
      'x',
    ])
  );
  const which = ['Which', ['Less', 'q', 0.1], 2, 'True', 1];

  test('a selection over a list condition is a flat list of its length', () => {
    expect(ce.expr(['If', ['Less', 'q', 2], 1]).type.toString()).toBe(
      'vector<4>'
    );
    expect(ce.expr(which).type.toString()).toBe('vector<integer^4>');
  });

  test('a comparison over it is a list of booleans of that length', () => {
    for (const op of ['Less', 'Greater', 'LessEqual', 'GreaterEqual'])
      expect(ce.expr([op, which, 2]).type.toString()).toBe('list<boolean^4>');
    for (const op of ['Equal', 'NotEqual'])
      expect(ce.expr([op, which, 2]).type.toString()).toBe('list<boolean^4>');
    expect(
      ce.expr(['Less', ['If', ['Less', 'q', 2], 1], 2]).type.toString()
    ).toBe('list<boolean^4>');
  });

  test('a selection over that comparison has one shape', () => {
    expect(ce.expr(['If', ['Less', which, 2], 1]).type.toString()).toBe(
      'vector<4>'
    );
  });

  test('a selection with only scalar conditions keeps the scalar arm', () => {
    // `If(c, L)` is `Missing` when `c` is false, and the comparison is then
    // the scalar `False`.
    expect(ce.expr(['Less', ['If', 'c', 'L'], 2]).type.toString()).toBe(
      'boolean | list<boolean^4>'
    );
    expect(
      ce.expr(['Less', ['Which', 'c', 'L', 'True', 'L'], 2]).type.toString()
    ).toBe('boolean | list<boolean^4>');
  });

  test('a selection that can be absent as a whole keeps the scalar arm', () => {
    // A list condition that is itself a restriction: with `c` false,
    // `If(If(c, m), L)` is `Missing`, and the comparison is `False`.
    expect(
      ce.expr(['Less', ['If', ['If', 'c', 'm'], 'L'], 2]).type.toString()
    ).toBe('boolean | list<boolean>');
    // An arm before the list condition that is a restriction: with `t` true
    // and `c` false, `Which(t, If(c, L), m, L)` is `Missing`.
    expect(
      ce
        .expr(['Less', ['Which', 't', ['If', 'c', 'L'], 'm', 'L'], 2])
        .type.toString()
    ).toBe('boolean | list<boolean^4>');
    // A list condition that compares a row read out of range: `At(QQ, k)`
    // is `Missing` when `k` is out of range, and so is the `If`.
    expect(
      ce
        .expr(['Less', ['If', ['Less', ['At', 'QQ', 'k'], 3], 'L'], 2])
        .type.toString()
    ).toBe('boolean | list<boolean>');
    // A mask stored in a symbol as a restriction: `ms` is `Missing` when
    // `d` is false.
    expect(ce.expr(['Less', ['If', 'ms', 'L'], 2]).type.toString()).toBe(
      'boolean | list<boolean>'
    );
    // Masks that refer to each other: the walk stops, and the type keeps
    // the scalar arm.
    expect(ce.expr(['Less', ['If', 'a', 'L'], 2]).type.toString()).toBe(
      'boolean | list<boolean>'
    );
    // A call of a user function can be absent whatever its operands are:
    // `f(c)` is `Missing` when `c` is false.
    expect(ce.expr(['Less', ['If', ['f', 'c'], 'L'], 2]).type.toString()).toBe(
      'boolean | list<boolean>'
    );
    // A restriction in an arm under the list condition gives absent cells,
    // not an absent list.
    expect(
      ce.expr(['Less', ['If', 'm', ['If', 'c', 'L']], 2]).type.toString()
    ).toBe('list<boolean>');
  });
});

describe('THE PROGRAM OF TYCHO DOCUMENT art/njncrg9fkv', () => {
  /** The value of a list of points as numbers, `NaN` for a `NaN` cell. */
  function points(value: Expression): number[][] {
    return value.ops!.map((p) => p.ops!.map((x) => x.re));
  }

  function check(precision: 'auto' | 'machine', u: number, v: number): void {
    const ce = new ComputeEngine();
    ce.precision = precision;
    ce.declare('u', 'real');
    ce.declare('v', 'real');
    const expr = ce.expr(
      TYCHO_NJNCRG9FKV_PROGRAM as unknown as Parameters<typeof ce.expr>[0]
    );
    const result = compile(expr, { to: 'javascript' });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const expected = points(expr.subs({ u, v }).evaluate().N());
    const actual = result.run!({ u, v }) as number[][];
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i].length).toBe(expected[i].length);
      for (let j = 0; j < expected[i].length; j++) {
        if (Number.isNaN(expected[i][j]))
          expect(Number.isNaN(actual[i][j])).toBe(true);
        else expect(actual[i][j]).toBeCloseTo(expected[i][j], 12);
      }
    }
  }

  // At `u = 1/6` the index `6u + 1` is on a jump of `Floor`: the machine
  // number `1/6` is a little less than one sixth, so the interpreter at its
  // default precision, which reads that number exactly, gives
  // `floor(6u) = 0`, and the machine product `6u` rounds to `1`, which gives
  // `floor(6u) = 1`. The two values differ by the precision of the target,
  // which compiled code is allowed (`docs/COMPILATION-MODEL.md`, "Caveats of
  // compiled code"); at that point the compiled value is compared with the
  // interpreter at machine precision.
  test('at u = 1/6, v = 0.9 (machine precision)', () =>
    check('machine', 1 / 6, 0.9));
  test('at u = 1/6, v = 0.5, with a point that is not selected', () =>
    check('machine', 1 / 6, 0.5));
  test('at u = 1/2, v = 0.9', () => {
    check('auto', 0.5, 0.9);
    check('machine', 0.5, 0.9);
  });
  // `6u + 1` is not an integer: every point is a `NaN` point.
  test('at u = 0.1, v = 0.2', () => {
    check('auto', 0.1, 0.2);
    check('machine', 0.1, 0.2);
  });
});
