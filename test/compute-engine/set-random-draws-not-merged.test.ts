import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * Two occurrences of a term with a known effect (`Random()`, a call of a
 * function declared with the `random` effect) are two draws, not one value.
 * The duplicate removal of a set literal and of `Union` merged them because
 * the two trees are the same: the canonical form of `Set(Random(), Random())`
 * was `Set(Random())`, so `Count(Set(Random(), Random()))` was always `1`.
 * Both draws are now kept. A pure element, and a call of an undeclared
 * function (its effects are unknown, not known to draw), is still kept once.
 */

const ce = new ComputeEngine();
ce.declare('r', { signature: '(number) random -> number' } as any);
ce.declare('f', { signature: '(number) -> number' } as any);

const canonical = (expr: MathJsonExpression): MathJsonExpression =>
  ce.box(expr).json;
const evalJson = (expr: MathJsonExpression): MathJsonExpression =>
  ce.box(expr).evaluate().json;

describe('a set keeps two random draws', () => {
  test('the canonical Set(Random(), Random()) keeps both draws', () => {
    expect(canonical(['Set', ['Random'], ['Random']])).toEqual([
      'Set',
      ['Random'],
      ['Random'],
    ]);
  });

  test('Count(Set(Random(), Random())) is 2', () => {
    expect(evalJson(['Count', ['Set', ['Random'], ['Random']]])).toBe(2);
  });

  test('the canonical Set(r(t), r(t), 1, 1) keeps both draws', () => {
    expect(canonical(['Set', ['r', 't'], ['r', 't'], 1, 1])).toEqual([
      'Set',
      1,
      ['r', 't'],
      ['r', 't'],
    ]);
  });

  test('Union(Set(r(t)), Set(1, r(t))) keeps both draws', () => {
    expect(
      evalJson(['Union', ['Set', ['r', 't']], ['Set', 1, ['r', 't']]])
    ).toEqual(['Set', 1, ['r', 't'], ['r', 't']]);
  });

  test('a held Union counts and walks both draws, as its evaluation does', () => {
    const u: MathJsonExpression = [
      'Union',
      ['Set', ['r', 't']],
      ['Set', 1, ['r', 't']],
    ];
    expect(ce.box(u).count).toBe(3);
    expect([...ce.box(u).each()].length).toBe(3);
    expect(ce.box(u).evaluate().count).toBe(3);
  });

  test('a held Union of a list counts each draw of the list', () => {
    const u: MathJsonExpression = [
      'Union',
      ['List', ['r', 't'], ['r', 't']],
      ['Set', 1],
    ];
    expect(ce.box(u).count).toBe(3);
    expect([...ce.box(u).each()].length).toBe(3);
    expect(ce.box(u).evaluate().count).toBe(3);
  });

  test('Intersection keeps both draws of a list operand', () => {
    const i: MathJsonExpression = [
      'Intersection',
      ['List', ['r', 't'], ['r', 't']],
      ['Set', ['r', 't'], 2],
    ];
    expect(evalJson(i)).toEqual(['Set', ['r', 't'], ['r', 't']]);
    expect(ce.box(i).count).toBe(2);
  });

  test('SymmetricDifference keeps both draws of its second operand', () => {
    expect(
      evalJson([
        'SymmetricDifference',
        ['Set', 1],
        ['Set', ['r', 't'], ['r', 't']],
      ])
    ).toEqual(['Set', 1, ['r', 't'], ['r', 't']]);
  });

  test('control: pure and undeclared calls are kept once', () => {
    expect(canonical(['Set', ['f', 't'], ['f', 't'], 'x', 'x'])).toEqual([
      'Set',
      'x',
      ['f', 't'],
    ]);
    expect(canonical(['Set', ['g', 't'], ['g', 't']])).toEqual([
      'Set',
      ['g', 't'],
    ]);
    expect(
      evalJson(['Union', ['Set', ['f', 't']], ['Set', 1, ['f', 't']]])
    ).toEqual(['Set', 1, ['f', 't']]);
  });
});
