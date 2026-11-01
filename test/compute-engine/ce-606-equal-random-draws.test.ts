import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * CE-606: two occurrences of a call of a function declared with the `random`
 * effect are two independent draws. The equality comparison read them as one
 * value because the two trees are the same, so `Equal(r(t), r(t))` evaluated
 * to `True` and `NotEqual(r(t), r(t))` to `False`. The comparison is now
 * undecided: `Equal` and `NotEqual` stay inert and `isEqual()` gives
 * `undefined`. A call of a pure function, or of an undeclared function (its
 * effects are unknown, not known to draw), is still equal to itself.
 */

const ce = new ComputeEngine();
ce.declare('r', { signature: '(number) random -> number' } as any);
ce.declare('f', { signature: '(number) -> number' } as any);

const evalJson = (expr: MathJsonExpression): MathJsonExpression =>
  ce.box(expr).evaluate().json;

describe('CE-606: equality of two random draws is undecided', () => {
  test('Equal(r(t), r(t)) stays inert', () => {
    expect(evalJson(['Equal', ['r', 't'], ['r', 't']])).toEqual([
      'Equal',
      ['r', 't'],
      ['r', 't'],
    ]);
  });

  test('NotEqual(r(t), r(t)) stays inert', () => {
    expect(evalJson(['NotEqual', ['r', 't'], ['r', 't']])).toEqual([
      'NotEqual',
      ['r', 't'],
      ['r', 't'],
    ]);
  });

  test('Equal(r(1), r(1)) with no free variable stays inert', () => {
    expect(evalJson(['Equal', ['r', 1], ['r', 1]])).toEqual([
      'Equal',
      ['r', 1],
      ['r', 1],
    ]);
  });

  test('a draw inside a larger term: Equal(r(t) + 1, r(t) + 1)', () => {
    const term: MathJsonExpression = ['Add', ['r', 't'], 1];
    expect(evalJson(['Equal', term, term])).toEqual([
      'Equal',
      ['Add', ['r', 't'], 1],
      ['Add', ['r', 't'], 1],
    ]);
  });

  test('two sets that hold a draw: the order and a lazy Union', () => {
    const r: MathJsonExpression = ['r', 't'];
    const inert: MathJsonExpression = [
      'Equal',
      ['Set', 1, r],
      ['Set', 1, r],
    ];
    expect(evalJson(['Equal', ['Set', r, 1], ['Set', 1, r]])).toEqual(inert);
    expect(ce.box(['Set', r, 1]).isEqual(ce.box(['Set', 1, r]))).toBeUndefined();
    const union: MathJsonExpression = ['Union', ['Set', r], ['Set', 1]];
    expect(evalJson(['Equal', union, ['Set', 1, r]])).toEqual(inert);
    expect(ce.box(union).isEqual(ce.box(['Set', 1, r]))).toBeUndefined();
  });

  test('a NaN element decides first: List(NaN, r(t)) is not equal to itself', () => {
    const list: MathJsonExpression = ['List', 'NaN', ['r', 't']];
    expect(ce.box(list).isEqual(ce.box(list))).toBe(false);
  });

  test('WithRandomSeed: two blocks with the same seed are equal', () => {
    const block: MathJsonExpression = ['WithRandomSeed', 7, ['r', 1]];
    expect(evalJson(['Equal', block, block])).toBe('True');
  });

  test('WithRandomSeed: an Equal of two draws inside one block stays inert', () => {
    const r: MathJsonExpression = ['r', 't'];
    expect(evalJson(['WithRandomSeed', 7, ['Equal', r, r]])).toEqual([
      'WithRandomSeed',
      7,
      ['Equal', r, r],
    ]);
  });

  test('isEqual() and isIdenticallyEqual() give undefined', () => {
    const a = ce.box(['r', 't']);
    const b = ce.box(['r', 't']);
    expect(a.isEqual(b)).toBeUndefined();
    expect(a.isIdenticallyEqual(b)).toBeUndefined();
    // `isSame()` compares the trees, and the trees are the same.
    expect(a.isSame(b)).toBe(true);
  });

  test('control: a pure call is equal to itself', () => {
    expect(evalJson(['Equal', ['f', 't'], ['f', 't']])).toBe('True');
    expect(evalJson(['NotEqual', ['f', 't'], ['f', 't']])).toBe('False');
    expect(ce.box(['f', 't']).isEqual(ce.box(['f', 't']))).toBe(true);
  });

  test('control: two sets of pure elements in another order are equal', () => {
    expect(evalJson(['Equal', ['Set', 2, 1], ['Set', 1, 2]])).toBe('True');
  });

  test('control: a call of an undeclared function is equal to itself', () => {
    expect(evalJson(['Equal', ['g', 't'], ['g', 't']])).toBe('True');
  });
});
