/**
 * CE-1809: a `Tabulate` whose callback has an effect is listed where a value
 * holds it as an element (a list or a tuple literal, a spread), as a `Map`
 * with an effect is. Its count is its outer dimension, which is read with no
 * call of the callback (`hasConstantTimeCount()` of `listed-element.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/** An engine with `tick`, a function with an effect: each call is recorded
 *  in `seen`. */
function engine() {
  const ce = new ComputeEngine();
  const seen: number[] = [];
  ce.declare('tick', {
    signature: '(real) -> real',
    pure: false,
    evaluate: (ops) => {
      seen.push(ops[0].re);
      return ops[0];
    },
  });
  return { ce, seen };
}

/** The JSON of the value of the Epsil program `src`, and the arguments of
 *  the calls of `tick`, in order. */
function run(src: string, maxCollectionSize?: number) {
  const { ce, seen } = engine();
  if (maxCollectionSize !== undefined) ce.maxCollectionSize = maxCollectionSize;
  const result = executeEpsil(ce, src);
  expect(result.diagnostics.map((d) => d.message)).toEqual([]);
  return { json: result.value.json, seen };
}

describe('CE-1809: a Tabulate with an effect inside a literal is listed', () => {
  test('the witness: a tabulate of random numbers', () => {
    const { ce } = engine();
    const value = executeEpsil(ce, '[tabulate(i => random(), 3)]').value;
    const json = value.json as any;
    expect(json[0]).toBe('List');
    expect(json[1][0]).toBe('List');
    expect(json[1].slice(1)).toHaveLength(3);
    for (const x of json[1].slice(1)) expect(typeof x).toBe('number');
    // The literal holds the numbers: a second evaluation gives the same ones.
    expect(value.evaluate().json).toEqual(json);
  });

  test('a dimension with an effect: the tabulation stays a view', () => {
    // The count would evaluate the dimension, and the walk would evaluate
    // it again.
    const { json } = run('[tabulate(i => tick(i), tick(3))]');
    expect((json as any)[1][0]).toBe('Tabulate');
  });

  test('a map with an effect over a tabulation is listed', () => {
    expect(run('[map(x => tick(x), tabulate(i => i * 2, 3))]')).toEqual({
      json: ['List', ['List', 2, 4, 6]],
      seen: [2, 4, 6],
    });
  });

  test('the callback is called once for each element, in order', () => {
    expect(run('[tabulate(i => tick(i), 3)]')).toEqual({
      json: ['List', ['List', 1, 2, 3]],
      seen: [1, 2, 3],
    });
  });

  test('a tabulation of two dimensions is listed at each depth', () => {
    expect(run('[tabulate((i, j) => tick(i * 10 + j), 2, 2)]')).toEqual({
      json: ['List', ['List', ['List', 11, 12], ['List', 21, 22]]],
      seen: [11, 12, 21, 22],
    });
  });

  test('a dimension that is a variable or a pure expression', () => {
    expect(run('let n = 2; [tabulate(i => tick(i), n)]')).toEqual({
      json: ['List', ['List', 1, 2]],
      seen: [1, 2],
    });
    expect(run('let n = 2; [tabulate(i => tick(i), n + 1)]')).toEqual({
      json: ['List', ['List', 1, 2, 3]],
      seen: [1, 2, 3],
    });
  });

  test('an empty tabulation', () => {
    expect(run('[tabulate(i => tick(i), 0)]')).toEqual({
      json: ['List', ['List']],
      seen: [],
    });
  });

  test('a tuple element and a spread', () => {
    expect(run('(tabulate(i => tick(i), 2), 9)')).toEqual({
      json: ['Tuple', ['List', 1, 2], 9],
      seen: [1, 2],
    });
    expect(run('[...tabulate(i => tick(i), 2), 9]')).toEqual({
      json: ['List', 1, 2, 9],
      seen: [1, 2],
    });
  });

  test('a tabulation above the budget stays a view, with no call', () => {
    // Its count is compared with `ce.maxCollectionSize` before any walk.
    const { json, seen } = run('[tabulate(i => tick(i), 6)]', 5);
    expect((json as any)[1][0]).toBe('Tabulate');
    expect(seen).toEqual([]);
    // A pure one too: the count is read, the elements are not.
    expect((run('[tabulate(i => i * 2, 6)]', 5).json as any)[1][0]).toBe(
      'Tabulate'
    );
  });

  test('a row above the rest of the budget stays a view, with no call', () => {
    // The two outer cells are reserved, and each row of four cells is then
    // above the rest of the budget.
    const { json, seen } = run('[tabulate((i, j) => tick(j), 2, 4)]', 5);
    expect((json as any)[1][0]).toBe('List');
    expect((json as any)[1][1][0]).toBe('Tabulate');
    expect(seen).toEqual([]);
  });

  test('a first row in the budget is listed, and the next row stays a view', () => {
    // The two outer cells and the two cells of the first row use four of
    // the five cells, so the second row does not fit.
    const { json, seen } = run('[tabulate((i, j) => tick(j), 2, 2)]', 5);
    expect((json as any)[1][1]).toEqual(['List', 1, 2]);
    expect((json as any)[1][2][0]).toBe('Tabulate');
    expect(seen).toEqual([1, 2]);
  });

  test('a pure tabulation is listed as before', () => {
    expect(run('[tabulate(i => i * 2, 3)]').json).toEqual([
      'List',
      ['List', 2, 4, 6],
    ]);
  });
});
