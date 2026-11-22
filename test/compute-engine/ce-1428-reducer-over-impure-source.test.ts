import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * CE-1428: a reducer over a lazy view whose source assigns a variable runs
 * the assignment once.
 *
 * The finiteness read of a view over an eager source evaluates the source,
 * and only the value of a pure source is kept. A reducer that walked the
 * view (`Sum`, `Product`, `Reduce`) read several facets of it, and each read
 * evaluated an impure source again: `Sum(Map(f, Sort(arm)))` ran the
 * assignment four times and gave `8`. Such a view is now evaluated once
 * before the reducer reads it (`isViewOverHeldEagerSource()` in
 * `boxed-function.ts`).
 */

const ce = new ComputeEngine();
ce.declare('x', 'integer');

const f: MathJsonExpression = ['Function', ['Add', 'k', 1], 'k'];
const arm: MathJsonExpression = [
  'Block',
  ['Assign', 'x', ['Add', 'x', 1]],
  ['List', 'x', 'x'],
];

/** The value of `expr` evaluated with `x = 0`, and the value of `x` after. */
function run(
  expr: MathJsonExpression
): [MathJsonExpression, MathJsonExpression] {
  ce.assign('x', 0);
  const result = ce.box(expr).evaluate().json;
  return [result, ce.box('x').evaluate().json];
}

async function runAsync(
  expr: MathJsonExpression
): Promise<[MathJsonExpression, MathJsonExpression]> {
  ce.assign('x', 0);
  const result = (await ce.box(expr).evaluateAsync()).json;
  return [result, ce.box('x').evaluate().json];
}

describe('CE-1428: a reducer over a view whose source has an effect', () => {
  test('Sum and Product over a mapped sorted list', () => {
    expect(run(['Sum', ['Map', f, ['Sort', arm]]])).toEqual([4, 1]);
    expect(run(['Product', ['Map', f, ['Sort', arm]]])).toEqual([4, 1]);
    expect(run(['ListFrom', ['Map', f, ['Sort', arm]]])).toEqual([
      ['List', 2, 2],
      1,
    ]);
  });

  test('a conditional source', () => {
    const src: MathJsonExpression = ['If', 'True', arm, ['List', 0]];
    expect(run(['Sum', ['Map', f, src]])).toEqual([4, 1]);
    expect(run(['Product', ['Map', f, src]])).toEqual([4, 1]);
  });

  test('nested views and other reducers', () => {
    expect(run(['Sum', ['Rest', ['Map', f, ['Sort', arm]]]])).toEqual([2, 1]);
    expect(run(['Sum', ['Take', ['Cycle', ['Sort', arm]], 3]])).toEqual([3, 1]);
    expect(run(['Reduce', ['Map', f, ['Sort', arm]], 'Add'])).toEqual([4, 1]);
  });

  test('a view over a view of the source', () => {
    expect(run(['ListFrom', ['Map', f, ['Map', f, ['Sort', arm]]]])).toEqual([
      ['List', 3, 3],
      1,
    ]);
    const positive: MathJsonExpression = ['Function', ['Greater', 'k', 0], 'k'];
    expect(
      run(['Sum', ['Filter', ['Map', f, ['Sort', arm]], positive]])
    ).toEqual([4, 1]);
  });

  test('a view that is not finite stays unevaluated', () => {
    const [result, x] = run(['Sum', ['Cycle', ['Sort', arm]]]);
    expect(result).toEqual(['Sum', ['Cycle', ['Sort', arm]]]);
    expect(x).toEqual(1);
  });

  test('the numeric and the asynchronous evaluations', async () => {
    ce.assign('x', 0);
    expect(ce.box(['Sum', ['Map', f, ['Sort', arm]]]).N().json).toEqual(4);
    expect(ce.box('x').evaluate().json).toEqual(1);
    expect(await runAsync(['Sum', ['Map', f, ['Sort', arm]]])).toEqual([4, 1]);
    expect(
      await runAsync(['Reduce', ['Map', f, ['Sort', arm]], 'Add'])
    ).toEqual([4, 1]);
  });

  test('a pure source', () => {
    expect(run(['Sum', ['Map', f, ['Sort', ['List', 3, 1]]]])).toEqual([6, 0]);
  });
});
