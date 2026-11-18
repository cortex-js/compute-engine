import { ComputeEngine } from '../../src/compute-engine';

/**
 * A GENERIC declared `broadcastable<T>` parameter whose bound cannot hold a
 * list (`where T: number`) maps to the cells of a nested argument, as the
 * non-generic `broadcastable<number>` slot does (user decision 2026-10-24,
 * ROADMAP CE-405). The type solver binds `T` to the cells: it bound `T` to
 * the rows of a matrix (`vector<integer^2>`), which fails the bound, and the
 * call was refused when boxed (ROADMAP CE-409). The call has one list level
 * per rank of the argument.
 *
 * A variable with no bound, or with a bound that can hold a list
 * (`where T: value`), keeps the one-rank rule of 2026-08-08: each row binds
 * whole. With no bound, each row was an `incompatible-type` error naming
 * `T`.
 */

function engine(signature: string, body: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('w', signature);
  ce.assign('w', ce.parse(body));
  return ce;
}

const BOUNDED = '(x: broadcastable<T>) -> list<T> where T: number';

describe('a generic broadcastable<T> with T: number maps to the cells (CE-409)', () => {
  test('a matrix is admitted and mapped to its numbers', () => {
    const ce = engine(BOUNDED, 'x \\mapsto [x]');
    const e = ce.parse('w([[1,2],[3,4]])');
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('[[[1],[2]],[[3],[4]]]');
  });

  test('the type has one list level per rank of the argument', () => {
    const ce = engine(BOUNDED, 'x \\mapsto [x]');
    expect(ce.parse('w([[1,2],[3,4]])').type.toString()).toBe(
      'list<list<list<integer>>>'
    );
    expect(ce.parse('w([[[1,2]],[[3,4]]])').type.toString()).toBe(
      'list<list<list<list<integer>>>>'
    );
    expect(ce.parse('w([[[1,2]],[[3,4]]])').evaluate().toString()).toBe(
      '[[[[1],[2]]],[[[3],[4]]]]'
    );
  });

  test('a ragged list is admitted and mapped to its numbers', () => {
    const ce = engine(BOUNDED, 'x \\mapsto [x]');
    const e = ce.parse('w([[1,2],[3,4,5]])');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('list<list<list<integer>>>');
    expect(e.evaluate().toString()).toBe('[[[1],[2]],[[3],[4],[5]]]');
  });

  test('controls: a list and a number are unchanged', () => {
    const ce = engine(BOUNDED, 'x \\mapsto [x]');
    expect(ce.parse('w([1,2])').evaluate().toString()).toBe('[[1],[2]]');
    expect(ce.parse('w(3)').evaluate().toString()).toBe('[3]');
  });

  test('controls: a list of strings is still refused', () => {
    const ce = engine(BOUNDED, 'x \\mapsto [x]');
    expect(ce.box(['w', ['List', "'a'", "'b'"]]).isValid).toBe(false);
  });
});

describe('a bound that can hold a list maps one rank', () => {
  test('with no bound, each row binds whole', () => {
    const ce = engine(
      '(x: broadcastable<T>) -> list<T> where T',
      'x \\mapsto [x]'
    );
    const e = ce.parse('w([[1,2],[3,4]])');
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('[[[1,2]],[[3,4]]]');
  });

  test('with T: value, each row binds whole', () => {
    const ce = engine(
      '(x: broadcastable<T>) -> list<T> where T: value',
      'x \\mapsto [x]'
    );
    expect(ce.parse('w([[1,2],[3,4]])').evaluate().toString()).toBe(
      '[[[1,2]],[[3,4]]]'
    );
  });
});
