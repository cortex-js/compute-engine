/**
 * Two comparison defects over a list operand.
 *
 * 1. An ordering comparison (`Less`, `LessEqual`, and `Greater`/`GreaterEqual`,
 *    which are boxed as those) with a set, an interval or a dictionary beside a
 *    list. Such a collection has no positions, so it cannot be paired with the
 *    cells of the list, and a set has no order with a number. Before
 *    2026-10-17, `Less(Set(5, 6), [1, 2])` was `[Set(5, 6) < 1, Set(5, 6) < 2]`
 *    (earlier, `[False, False]`): the broadcast used the set whole in each
 *    cell, as it does for the `any` parameters of `String`. It is now the
 *    `incompatible-type` error that `Sin` and `Add` give for a set. Equality
 *    is not an ordering: `Set(5, 6) = [1, 2]` stays `False`.
 *
 * 2. A comparison with a list over an operand with no value whose type only
 *    admits a collection: `P` declared `number | collection<number>`. Before
 *    2026-10-17, `P < [1, 2]` expanded to `[P < 1, P < 2]`, as if `P` were a
 *    number, and `P = [1, 2]` was `False` (for `number | list<number>`
 *    already). Both stay unevaluated now, as they do for `P` declared
 *    `collection<number>`, and give the result of a fresh evaluation once `P`
 *    has a value.
 */
import { ComputeEngine } from '../../src/compute-engine';

const SET_ERROR =
  'Error(ErrorCode("incompatible-type", "number", "set<integer>"), Set(5, 6))';

describe('AN ORDERING COMPARISON WITH A SET BESIDE A LIST', () => {
  const ce = new ComputeEngine();
  const S = ['Set', 5, 6];
  const L = ['List', 1, 2];

  test.each([
    ['Less(S, L)', ['Less', S, L]],
    ['Less(L, S)', ['Less', L, S]],
    ['LessEqual(S, L)', ['LessEqual', S, L]],
    ['Greater(S, L)', ['Greater', S, L]],
    ['GreaterEqual(L, S)', ['GreaterEqual', L, S]],
    ['NotLess(S, L)', ['NotLess', S, L]],
  ])('%s is an incompatible-type error', (_, input) => {
    expect(
      ce
        .box(input as any)
        .evaluate()
        .toString()
    ).toBe(SET_ERROR);
  });

  test('a one-element set is not paired with the first cell', () => {
    expect(
      ce
        .box(['Less', ['Set', 0], L] as any)
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "number", "set<integer>"), Set(0))'
    );
  });

  test('an interval and a dictionary beside a list are errors too', () => {
    expect(
      ce
        .box(['Less', ['Interval', 0, 1], L] as any)
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "number", "set<real>"), Interval(0, 1))'
    );
    expect(
      ce
        .box(['Less', ['Dictionary', ['Tuple', "'a'", 1]], L] as any)
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "number", "record{a: integer}"), {"a" -> 1})'
    );
  });

  test('a symbol that holds a set gives the same error on every route', async () => {
    const engine = new ComputeEngine();
    engine.declare('P', 'collection<number>');
    engine.assign('P', engine.box(['Set', 5, 6]));
    const expr = engine.box(['Less', 'P', L] as any);
    expect(expr.evaluate().toString()).toBe(SET_ERROR);
    expect(expr.N().toString()).toBe(SET_ERROR);
    expect((await expr.evaluateAsync()).toString()).toBe(SET_ERROR);
  });

  test('the LaTeX route gives the same error', () => {
    expect(ce.parse('\\{5,6\\} < [1,2]').evaluate().toString()).toBe(
      SET_ERROR
    );
  });

  test('beside no list, a set keeps the comparison unevaluated', () => {
    expect(
      ce
        .box(['Less', S, 3] as any)
        .evaluate()
        .toString()
    ).toBe('Set(5, 6) < 3');
    expect(
      ce
        .box(['Less', S, ['Set', 1, 2]] as any)
        .evaluate()
        .toString()
    ).toBe('Set(5, 6) < Set(1, 2)');
  });

  test('equality of a set and a list is still False', () => {
    expect(
      ce
        .box(['Equal', S, L] as any)
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      ce
        .box(['NotEqual', S, L] as any)
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  test('two lists still compare cell by cell', () => {
    expect(
      ce
        .box(['Less', L, ['List', 3, 4]] as any)
        .evaluate()
        .toString()
    ).toBe('["True","True"]');
  });
});

describe('A COMPARISON WITH A LIST OVER A VALUELESS SCALAR-OR-COLLECTION OPERAND', () => {
  test.each([
    'number | collection<number>',
    'real | collection',
    'number | list<number>',
    'collection<number>',
  ])('with P: %s, the comparisons stay unevaluated', (decl) => {
    const ce = new ComputeEngine();
    ce.declare('P', decl);
    const less = ce.box(['Less', 'P', ['List', 1, 2]]);
    const equal = ce.box(['Equal', 'P', ['List', 1, 2]]);
    const notEqual = ce.box(['NotEqual', 'P', ['List', 1, 2]]);
    expect(less.evaluate().toString()).toBe('P < [1,2]');
    expect(equal.evaluate().toString()).toBe('P == [1,2]');
    expect(notEqual.evaluate().toString()).toBe('P != [1,2]');

    // With a value, the held expressions give a fresh evaluation's result.
    ce.assign('P', ce.box(['List', 5, 6]));
    expect(less.evaluate().toString()).toBe('["False","False"]');
    expect(equal.evaluate().toString()).toBe('"False"');
    ce.assign('P', ce.box(['List', 1, 2]));
    expect(equal.evaluate().toString()).toBe('"True"');
  });

  test('with a set arm, the held comparison agrees with a fresh one', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'number | set<number>');
    const less = ce.box(['Less', 'T', ['List', 1, 2]]);
    expect(less.evaluate().toString()).toBe('T < [1,2]');
    ce.assign('T', ce.box(['Set', 5, 6]));
    expect(less.evaluate().toString()).toBe(SET_ERROR);
  });

  test('a type inferred from a statistics operator still broadcasts', () => {
    // `Mean(q)` infers `q: collection<any> | distribution | number`. That is
    // not a declaration, so `q` is read as a free symbol, as before.
    const ce = new ComputeEngine();
    ce.box(['Mean', 'q']).evaluate();
    expect(
      ce
        .box(['Add', 'q', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[q + 1,q + 2]');
    expect(
      ce
        .box(['Less', 'q', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[q < 1,q < 2]');
  });

  test('a tuple arm still broadcasts', () => {
    const ce = new ComputeEngine();
    ce.declare('U', 'number | tuple<number, number>');
    expect(
      ce
        .box(['Add', 'U', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[U + 1,U + 2]');
  });

  test('a scalar value then broadcasts', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'number | collection<number>');
    const less = ce.box(['Less', 'P', ['List', 1, 2]]);
    ce.assign('P', 3);
    expect(less.evaluate().toString()).toBe('["False","False"]');
  });

  test('the asynchronous route stays unevaluated too', async () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'number | collection<number>');
    expect(
      (await ce.box(['Less', 'P', ['List', 1, 2]]).evaluateAsync()).toString()
    ).toBe('P < [1,2]');
    expect(
      (await ce.box(['Equal', 'P', ['List', 1, 2]]).evaluateAsync()).toString()
    ).toBe('P == [1,2]');
  });

  test('a free symbol and a declared number still broadcast', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Less', 'x', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[x < 1,x < 2]');
    ce.declare('n', 'number');
    expect(
      ce
        .box(['Less', 'n', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[n < 1,n < 2]');
  });
});
