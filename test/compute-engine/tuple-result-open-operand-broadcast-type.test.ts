/**
 * The type of a call whose per-element result is a tuple, over an operand
 * whose value can be a ragged list (CE-1290, CE-1514).
 *
 * A tuple is one cell for broadcasting, but its cells are read through its
 * components, so `tuple<unknown, unknown>` was read as a result whose cells
 * can be lists, and the call was typed `broadcastable<tuple<unknown,
 * unknown>>`. That type holds only points and tensors of points. The call
 * maps a ragged list at its leaves, so its value can be a ragged list of
 * points. The type is now `R | list<R | list<any>>`.
 *
 * Each static type is read BEFORE the operand is assigned: an assigned value
 * narrows the type, and the check would then prove nothing.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

const OPEN_PAIR =
  'list<list<any> | tuple<unknown, unknown>> | tuple<unknown, unknown>';

describe('A call with a tuple result over an operand of open depth', () => {
  test('a pair over an element of list<unknown> holds a ragged value (CE-1514)', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.box(['Function', ['Tuple', 'a', 'a'], 'a']));
    ce.declare('L', 'list<unknown>');
    const call = ce.box(['P', ['At', 'L', 1]]);
    const type = call.type;
    expect(type.toString()).toBe(OPEN_PAIR);

    ce.assign(
      'L',
      ce.box(['List', ['List', 1, ['Tuple', 1, 2], ['List', 2, 3]]])
    );
    const value = ce.box(['P', ['At', 'L', 1]]).evaluate();
    expect(value.toString()).toBe('[(1, 1),((1, 2), (1, 2)),[(2, 2),(3, 3)]]');
    expect(isSubtype(value.type.type, type.type)).toBe(true);
  });

  test('a function with a tuple result over an operand typed any holds a ragged value (CE-1290)', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(x: T) -> tuple<T, T> where T');
    ce.assign('g', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
    // An undeclared function: its signature is read from the literal,
    // `(v: unknown) -> tuple<unknown, unknown>`, and it is not generic.
    ce.assign('h', ce.box(['Function', ['g', 'v'], 'v']));
    ce.declare('b', 'any');
    const type = ce.box(['h', 'b']).type;
    expect(type.toString()).toBe(OPEN_PAIR);

    ce.assign('b', ce.box(['List', ['List', 1, 2], ['List', 3]]));
    const value = ce.box(['h', 'b']).evaluate();
    expect(value.toString()).toBe('[[(1, 1),(2, 2)],[(3, 3)]]');
    expect(isSubtype(value.type.type, type.type)).toBe(true);
  });

  test('a list of pairs over an element of list<unknown> holds a ragged value', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.box(['Function', ['List', ['Tuple', 'a', 'a']], 'a']));
    ce.declare('L', 'list<unknown>');
    const type = ce.box(['P', ['At', 'L', 1]]).type;
    expect(type.toString()).not.toMatch(/^broadcastable/);

    ce.assign('L', ce.box(['List', ['List', ['List', 1], ['List', 2, 3]]]));
    const value = ce.box(['P', ['At', 'L', 1]]).evaluate();
    expect(value.toString()).toBe('[[[(1, 1)]],[[(2, 2)],[(3, 3)]]]');
    expect(isSubtype(value.type.type, type.type)).toBe(true);
  });

  test('a pair of numbers over an operand typed any keeps the open form', () => {
    const ce = new ComputeEngine();
    ce.assign('Q', ce.box(['Function', ['Tuple', 1, 2], 'a']));
    ce.declare('b', 'any');
    expect(ce.box(['Q', 'b']).type.toString()).toBe(
      'list<list<any> | tuple<integer, integer>> | tuple<integer, integer>'
    );
  });

  test('a result that is a list of open cells keeps broadcastable', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    ce.declare('k', '(x: unknown) -> list<unknown>');
    expect(ce.box(['k', ['At', 'L', 1]]).type.toString()).toBe(
      'broadcastable<list<unknown>>'
    );
  });
});
