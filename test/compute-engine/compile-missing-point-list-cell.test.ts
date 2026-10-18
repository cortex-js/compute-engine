import { ComputeEngine, compile } from '../../src/compute-engine';

// A `When` or a `Which` over a list that selects no clause at a position
// gives `Missing` in that cell in the interpreter. In compiled JavaScript, a
// missing POINT cell is `undefined`, as a single missing point is; a missing
// number cell stays `NaN`.

const ce = new ComputeEngine();
ce.declare('v', 'list<real>');

const V = [1, -1];

function interpreted(json: any): string {
  return ce
    .box(json)
    .subs({ v: ce.box(['List', ...V]) })
    .evaluate()
    .toString();
}

function compiled(json: any): unknown {
  const result = compile(ce.box(json), { fallback: false }) as any;
  expect(result.success).toBe(true);
  return result.run({ v: V });
}

describe('COMPILED LIST CELL OF A MISSING POINT', () => {
  test.each([
    ['Which', ['Which', ['Greater', 'v', 0], ['Tuple', 1, 2]]],
    [
      'Which with two clauses',
      [
        'Which',
        ['Greater', 'v', 0],
        ['Tuple', 1, 2],
        ['Less', 'v', -5],
        ['Tuple', 3, 4],
      ],
    ],
    ['If with no else', ['If', ['Greater', 'v', 0], ['Tuple', 1, 2]]],
    [
      'Which with a list of points',
      [
        'Which',
        ['Greater', 'v', 0],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
    ],
    ['When', ['When', ['Tuple', 1, 2], ['Greater', 'v', 0]]],
  ])('%s: the cell is undefined', (_name, json) => {
    expect(interpreted(json)).toBe('[(1, 2),"Missing"]');
    expect(compiled(json)).toEqual([[1, 2], undefined]);
  });

  test('a read at one index of the same selection is undefined too', () => {
    const json = ['At', ['Which', ['Greater', 'v', 0], ['Tuple', 1, 2]], 2];
    expect(interpreted(json)).toBe('"Missing"');
    expect(compiled(json)).toBeUndefined();
  });

  test.each([
    ['Which', ['Which', ['Greater', 'v', 0], 7]],
    ['When', ['When', 7, ['Greater', 'v', 0]]],
  ])('%s: a number cell stays NaN', (_name, json) => {
    const out = compiled(json) as unknown[];
    expect(out[0]).toBe(7);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  test('a string cell is undefined in both forms', () => {
    // The list form of `When` gave the object null for a missing string, and
    // the element-wise `Which` gave `NaN`: both give `undefined` now.
    for (const json of [
      ['Which', ['Greater', 'v', 0], { str: 'a' }],
      ['When', { str: 'a' }, ['Greater', 'v', 0]],
    ]) {
      expect(interpreted(json)).toBe('["a","Missing"]');
      expect(compiled(json)).toEqual(['a', undefined]);
    }
  });

  test('a position whose condition is absent stays NaN', () => {
    // An absent condition cell (NaN) is the interpreter's error cell, which
    // compiles to NaN; it is not a position that no clause matched.
    ce.declare('c', 'list<boolean>');
    const result = compile(ce.box(['Which', 'c', ['Tuple', 1, 2]]), {
      fallback: false,
    }) as any;
    expect(result.success).toBe(true);
    const out = result.run({ c: [true, NaN, false] });
    expect(out[0]).toEqual([1, 2]);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBeUndefined();
  });
});
