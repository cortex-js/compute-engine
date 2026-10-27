/**
 * ROADMAP CE-543: a recursive function whose step passes its own recursive
 * call to another function was typed `any`.
 *
 * With `S := (a, b) ↦ Max(a, b)` and
 * `R := i ↦ Which(i = 0, 0, True, R(i − 1) + S(1, R(i − 1)))`, both declared
 * `function` before they are assigned, the recursive call `R(i − 1)` in the
 * stored literal is typed with the open form
 * `number | tuple | list<number | tuple | list<any>>` (the type of an
 * application over an operand of type `unknown`, ROADMAP CE-502). The call
 * `S(1, R(i − 1))` was typed arm by arm, and its bare `tuple` arm was typed
 * `any` (a tuple binds whole to a scalar parameter, and the body decides the
 * shape of the value), so `R(3)` and `R(x)` were typed `any` too. A body
 * that is a call of `Max` or `Min` gives a number for a tuple argument of
 * any arity and contents (`componentwiseTupleCallType`), so `R` is typed
 * with the open form, as it is without the call of `S` (box route).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

type MathJson = Parameters<ComputeEngine['box']>[0];

const OPEN_NUMBER = 'list<list<any> | number | tuple> | number | tuple';

const R_PREV: MathJson = ['R', ['Subtract', 'i', 1]];

function engine(step: MathJson): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('S', 'function');
  ce.declare('R', 'function');
  ce.assign('S', ce.box(['Function', ['Block', ['Max', 'a', 'b']], 'a', 'b']));
  ce.assign(
    'R',
    ce.box([
      'Function',
      ['Block', ['Which', ['Equal', 'i', 0], 0, 'True', step]],
      'i',
    ])
  );
  ce.declare('x', 'real');
  return ce;
}

/** The types of `R(3)` and `R(x)`, the value of `R(3)`, and whether the
 * type of `R(3)` holds the type of its value. */
function typesAndValue(step: MathJson): [string, string, string, boolean] {
  const ce = engine(step);
  const r3 = ce.box(['R', 3]);
  const value = r3.evaluate();
  return [
    r3.type.toString(),
    ce.box(['R', 'x']).type.toString(),
    value.toString(),
    isSubtype(value.type.type, r3.type.type),
  ];
}

describe('CE-543: a recursive call as an argument of another function', () => {
  test('R(i − 1) + S(1, R(i − 1))', () => {
    expect(typesAndValue(['Add', R_PREV, ['S', 1, R_PREV]])).toEqual([
      OPEN_NUMBER,
      OPEN_NUMBER,
      '4',
      true,
    ]);
  });

  test('S(1, R(i − 1)) alone', () => {
    expect(typesAndValue(['S', 1, R_PREV])).toEqual([
      'list<list<any> | number | tuple> | number',
      'list<list<any> | number | tuple> | number',
      '1',
      true,
    ]);
  });

  test('controls: R(i − 1) + 1 and R(i − 1) + S(1, i)', () => {
    expect(typesAndValue(['Add', R_PREV, 1])).toEqual([
      OPEN_NUMBER,
      OPEN_NUMBER,
      '3',
      true,
    ]);
    expect(typesAndValue(['Add', R_PREV, ['S', 1, 'i']])).toEqual([
      OPEN_NUMBER,
      OPEN_NUMBER,
      '6',
      true,
    ]);
  });

  test('a call of a Max body over a tuple or the open form is not any', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'function');
    ce.assign(
      'S',
      ce.box(['Function', ['Block', ['Max', 'a', 'b']], 'a', 'b'])
    );
    ce.declare('y', OPEN_NUMBER);
    const point = ce.box(['S', 1, ['Tuple', 2, 3]]);
    expect(point.type.toString()).toBe('number');
    expect(point.evaluate().toString()).toBe('3');
    expect(ce.box(['S', 1, 'y']).type.toString()).toBe(
      'list<list<any> | number | tuple> | number'
    );
    // Unchanged: a call over an operand of type `unknown` (CE-502).
    ce.declare('g', 'function');
    expect(ce.box(['S', 1, ['g', 2]]).type.toString()).toBe(OPEN_NUMBER);
  });

  test('a Max body that computes on the tuple parameter stays any', () => {
    // `b + 1` over a tuple argument is an error, so the call is not a number
    // (review of 2026-10-27).
    const ce = new ComputeEngine();
    ce.declare('S', 'function');
    ce.assign(
      'S',
      ce.box(['Function', ['Max', 'a', ['Add', 'b', 1]], 'a', 'b'])
    );
    const call = ce.box(['S', 1, ['Tuple', 2, 3]]);
    expect(call.type.toString()).not.toBe('number');
    expect(call.evaluate().type.toString()).toBe('error');
  });

  test('a Max body over a tuple that may hold a non-number stays any', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'function');
    ce.assign('S', ce.box(['Function', ['Max', 'a', 'b'], 'a', 'b']));
    ce.declare('z', 'tuple<string, number>');
    expect(ce.box(['S', 1, 'z']).type.toString()).not.toBe('number');
    // A tuple of numbers and lists of numbers is still read as numbers.
    ce.declare('w', 'tuple<number, list<number>>');
    expect(ce.box(['S', 1, 'w']).type.toString()).toBe('number');
  });

  test('a body that is not Max or Min stays any over a bare tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'function');
    ce.assign('T', ce.box(['Function', ['Add', 'a', 1], 'a']));
    ce.declare('y', 'tuple');
    expect(ce.box(['T', 'y']).type.toString()).toBe('any');
  });
});
