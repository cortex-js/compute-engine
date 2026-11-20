import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { loadGroupTheory } from '../../src/compute-engine/library/group-theory';

const ce = new ComputeEngine();
loadGroupTheory(ce);
const run = (source: string) => {
  const result = executeEpsil(ce, source);
  expect(result.diagnostics).toEqual([]);
  return result.value;
};
const json = (source: string) => run(source).json;

describe('Permutation equality ignores trailing fixed points', () => {
  test('isSame, hash, Equal and Set agree', () => {
    const a = ce.box(['Permutation', ['List', 2, 1, 3]]);
    const b = ce.box(['Permutation', ['List', 2, 1]]);
    expect(a.isSame(b)).toBe(true);
    expect(a.hash).toBe(b.hash);
    expect(a.isEqual(b)).toBe(true);
    const set = ce
      .box([
        'Set',
        ['Permutation', ['List', 2, 1, 3]],
        ['Permutation', ['List', 2, 1]],
      ])
      .evaluate();
    expect(ce.box(['Count', ['Set', a.json, b.json]]).evaluate().json).toBe(1);
    expect(set.operator).toBe('Set');
  });
});

describe('degree passed as an action', () => {
  test('PermutationCycles', () => {
    expect(json('PermutationCycles(Permutation([2,1,3]))')).toEqual([
      'List',
      ['List', 1, 2],
    ]);
    expect(
      json('PermutationCycles(Permutation([2,1,3]), PermutationAction(4))')
    ).toEqual(['List', ['List', 1, 2], ['List', 3], ['List', 4]]);
    expect(
      json('PermutationCycles(Permutation([]), PermutationAction(2))')
    ).toEqual(['List', ['List', 1], ['List', 2]]);
  });
  test('PermutationFixedPoints', () => {
    expect(
      json('PermutationFixedPoints(Permutation([2,1,3]), PermutationAction(3))')
    ).toEqual(['List', 3]);
    expect(
      json('PermutationFixedPoints(Permutation([2,1]), PermutationAction(3))')
    ).toEqual(['List', 3]);
    expect(
      json('PermutationFixedPoints(Permutation([1,3,2]), PermutationAction(4))')
    ).toEqual(['List', 1, 4]);
  });
  test('PermutationImages', () => {
    expect(json('PermutationImages(Permutation([2,1,3]))')).toEqual([
      'List',
      2,
      1,
    ]);
    expect(
      json('PermutationImages(Permutation([2,1]), PermutationAction(4))')
    ).toEqual(['List', 2, 1, 3, 4]);
  });
  test('an action below the largest moved point is an error', () => {
    for (const head of [
      'PermutationCycles',
      'PermutationFixedPoints',
      'PermutationImages',
    ])
      expect(
        JSON.stringify(
          json(`${head}(Permutation([1,3,2]), PermutationAction(2))`)
        )
      ).toContain('permutation-outside-action');
    expect(
      run('PermutationCycles(Permutation([2,1]), PermutationAction(-1))')
        .operator
    ).toBe('Error');
  });
});
