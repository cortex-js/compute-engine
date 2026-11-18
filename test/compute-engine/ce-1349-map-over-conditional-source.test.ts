import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * CE-1349: a lazy view over a source that is an `If` with an else branch,
 * `Map(f, If(c, [4, 5], [1, 2, 3]))`, walks the value of the selected arm.
 *
 * Such an `If` is not a collection (only a held single-branch `If(c, L)` is),
 * and its walk gave nothing, while `Map` read its count from its value. The
 * mapped list was `[]` and its sum `0`. The walk of `Map` and `Filter` now
 * reads the value of such a source as their count does (`walkedSource()` in
 * `library/collections.ts`), and the evaluation of a lazy view evaluates the
 * source once, as it evaluates an eager source (`isSelectedCollectionSource()`
 * in `boxed-function.ts`). The `If` itself still walks no element before it
 * is evaluated (`docs/COLLECTIONS-MODEL.md`).
 */

const ce = new ComputeEngine();
ce.declare('c', 'boolean');
ce.assign('c', true);
ce.declare('L', 'list<real>');
ce.assign('L', ce.box(['List', 4, 5]));
ce.declare('u', 'boolean');

const f: MathJsonExpression = ['Function', ['Add', 'k', 1], 'k'];
const pick = (cond: MathJsonExpression): MathJsonExpression => [
  'If',
  cond,
  ['List', 4, 5],
  ['List', 1, 2, 3],
];

function value(expr: MathJsonExpression): MathJsonExpression {
  return ce.box(expr).evaluate().json;
}

describe('CE-1349: a lazy view over a conditional source', () => {
  test('Map walks the selected arm', () => {
    expect(value(['ListFrom', ['Map', f, pick('True')]])).toEqual([
      'List',
      5,
      6,
    ]);
    expect(value(['ListFrom', ['Map', f, pick('False')]])).toEqual([
      'List',
      2,
      3,
      4,
    ]);
  });

  test('the sum of the mapped list is the sum of the mapped arm', () => {
    expect(value(['Sum', ['Map', f, pick('True')]])).toEqual(11);
    expect(value(['Sum', ['Map', f, pick('False')]])).toEqual(9);
  });

  test('a condition and an arm that are symbols with values', () => {
    const src: MathJsonExpression = ['If', 'c', 'L', ['List', 1, 2, 3]];
    expect(value(['ListFrom', ['Map', f, src]])).toEqual(['List', 5, 6]);
    expect(value(['Sum', ['Map', f, src]])).toEqual(11);
  });

  test('the walk agrees with the count', () => {
    const m = ce.box(['Map', f, pick('True')]);
    expect(m.count).toBe(2);
    expect([...m.each()].map((x) => x.json)).toEqual([5, 6]);
  });

  test('Filter walks the selected arm', () => {
    const g: MathJsonExpression = ['Function', ['Greater', 'k', 4], 'k'];
    expect(value(['Sum', ['Filter', pick('True'), g]])).toEqual(5);
    expect(value(['ListFrom', ['Filter', pick('True'), g]])).toEqual([
      'List',
      5,
    ]);
  });

  test('the evaluation of the view evaluates the source once', () => {
    expect(value(['Map', f, pick('True')])).toEqual([
      'Map',
      ['Function', ['Block', ['Add', 'k', 1]], 'k'],
      ['List', 4, 5],
    ]);
    // An arm with an effect runs once, as an eager source (`Sort`) does.
    const ce2 = new ComputeEngine();
    ce2.declare('x', 'integer');
    ce2.assign('x', 0);
    const arm: MathJsonExpression = [
      'Block',
      ['Assign', 'x', ['Add', 'x', 1]],
      ['List', 'x', 'x'],
    ];
    const result = ce2
      .box(['ListFrom', ['Map', f, ['If', 'True', arm, ['List', 0]]]])
      .evaluate().json;
    expect(result).toEqual(['List', 2, 2]);
    expect(ce2.box('x').evaluate().json).toEqual(1);
  });

  test('an undecided condition gives no element and no value', () => {
    expect([...ce.box(pick('u')).each()]).toEqual([]);
    expect(value(['Sum', ['Map', f, pick('u')]])[0]).toBe('Sum');
  });

  test('an If with scalar arms is still not walked', () => {
    expect([...ce.box(['If', 'True', 1, 2]).each()]).toEqual([]);
  });
});
