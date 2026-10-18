import { ComputeEngine } from '../../src/compute-engine';

// A length is a non-negative integer: the empty list `[]` has length 0, so a
// length parameter that only the empty list fixes is solved to 0 (user
// decision of 2026-10-17). With
// `declareType('permutation', 'list<integer^N>', { typeParams: ['N'] })`,
// `permutation([])` was typed `permutation<integer<1..>>` — a positive length
// for a value of length 0 — because the solver pinned only positive lengths
// and the type `list<never>` of `[]` states no length. It is now
// `permutation<0>`. The default range of an unsolved length is `integer<0..>`
// (it was `integer<1..>`), since a list of unknown length can be empty.

function fresh() {
  const ce = new ComputeEngine();
  ce.declareType('permutation', 'list<integer^N>', { typeParams: ['N'] });
  return ce;
}

describe('A LENGTH PARAMETER FIXED BY THE EMPTY LIST', () => {
  test('the empty list fixes the length to 0', () => {
    const ce = fresh();
    const p = ce.box(['permutation', ['List']]);
    expect(p.isValid).toBe(true);
    expect(p.type.toString()).toBe('permutation<0>');
    expect(p.evaluate().type.toString()).toBe('permutation<0>');
  });

  test('a non-empty list keeps its length', () => {
    const ce = fresh();
    expect(ce.box(['permutation', ['List', 1, 2]]).type.toString()).toBe(
      'permutation<2>'
    );
  });

  test('the parse route gives the same type', () => {
    const ce = fresh();
    const p = ce.box(['permutation', ce.parse('[]').json]);
    expect(p.type.toString()).toBe('permutation<0>');
  });

  test('`permutation<0>` is a type, within the family of all lengths', () => {
    const ce = fresh();
    expect(ce.type('permutation<0>').toString()).toBe('permutation<0>');
    const p = ce.box(['permutation', ['List']]);
    expect(p.type.matches('permutation<0>')).toBe(true);
    expect(p.type.matches('permutation<integer<0..>>')).toBe(true);
    expect(p.type.matches('permutation<1>')).toBe(false);
  });

  test('an unknown length reads as the family of all lengths, 0 included', () => {
    const ce = fresh();
    ce.declare('w', 'list<integer>');
    expect(ce.box(['permutation', 'w']).type.toString()).toBe(
      'permutation<integer<0..>>'
    );
  });

  test('a signature relates the length 0 to the length of another operand', () => {
    const ce = fresh();
    ce.declare(
      'compose',
      '(p: permutation<N>, q: permutation<N>) -> permutation<N> where N'
    );
    const p0 = ce.box(['permutation', ['List']]);
    const p1 = ce.box(['permutation', ['List', 1]]);
    expect(ce.box(['compose', p0, p0]).type.toString()).toBe('permutation<0>');
    expect(ce.box(['compose', p0, p1]).isValid).toBe(false);
  });

  test('a length variable in a signature result is 0 for the empty list', () => {
    const ce = new ComputeEngine();
    ce.declare('len', '(x: list<T^N>) -> N where T, N');
    expect(ce.box(['len', ['List']]).type.toString()).toBe('0');
    expect(ce.box(['len', ['List', 1, 2, 3]]).type.toString()).toBe('3');
  });

  test('the length 0 must agree with the other positions', () => {
    const ce = new ComputeEngine();
    ce.declare('zi', '(n: N, x: vector<T^N>) -> T where T, N: integer');
    expect(ce.box(['zi', 0, ['List']]).isValid).toBe(true);
    expect(ce.box(['zi', 1, ['List']]).isValid).toBe(false);
    expect(ce.box(['zi', 0, ce.parse('[1,2,3]')]).isValid).toBe(false);
  });

  test('the empty list is a list of any length on one axis', () => {
    const ce = new ComputeEngine();
    const empty = ce.box(['List']).type;
    expect(empty.matches('list<integer^0>')).toBe(true);
    expect(empty.matches('vector<integer>')).toBe(true);
    expect(empty.matches('list<integer^2>')).toBe(false);
  });
});
