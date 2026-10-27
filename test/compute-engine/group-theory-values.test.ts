import {
  PermutationValue,
  PermutationAction,
  PermutationInputError,
  composePermutations,
  inversePermutation,
  applyPermutation,
  assertPermutationFits,
} from '../../src/compute-engine/group-theory/permutation/values';

function permutations(points: number[]): number[][] {
  if (points.length === 0) return [[]];
  return points.flatMap((point, i) =>
    permutations(points.filter((_, j) => i !== j)).map((rest) => [
      point,
      ...rest,
    ])
  );
}

const identity = PermutationValue.fromImages([]);
const p = PermutationValue.fromImages([2, 1]);
const q = PermutationValue.fromImages([1, 3, 2]);

describe('validated permutation values', () => {
  test('copies and normalizes external image arrays', () => {
    const input = [2, 1, 3, 4];
    const value = PermutationValue.fromImages(input);
    input[0] = 1;
    expect(value.images).toEqual([2, 1]);
    expect(PermutationValue.fromImages([1, 2, 3]).images).toEqual([]);
  });

  test.each(
    [
      null,
      {},
      '12',
      [1, 1],
      [0],
      [-1],
      [2],
      [1.5],
      [NaN],
      [Infinity],
      [1n],
      new Array(2),
    ].map((input) => ({ input }))
  )('rejects malformed images $input', ({ input }) => {
    expect(() => PermutationValue.fromImages(input)).toThrow(
      PermutationInputError
    );
  });

  test('bounds allocations and rejects invalid limit configuration', () => {
    expect(() => PermutationValue.fromImages(new Array(100_001))).toThrow(
      'permutation-degree-limit'
    );
    expect(() => PermutationValue.fromImages([2, 1], { maxDegree: 1 })).toThrow(
      'permutation-degree-limit'
    );
    for (const limit of [-1, 0.5, Infinity, 100_001])
      expect(() =>
        PermutationValue.fromImages([], { maxDegree: limit })
      ).toThrow('invalid-permutation-degree-limit');
    expect(PermutationValue.fromImages([], { maxDegree: 0 }).images).toEqual(
      []
    );
  });

  test('checks cancellation during validation and propagates the original exception', () => {
    const cancellation = new Error('caller cancellation');
    let calls = 0;
    expect(() =>
      PermutationValue.fromImages(
        Array.from({ length: 3000 }, (_, i) => i + 1),
        {
          check: () => {
            if (++calls === 3) throw cancellation;
          },
        }
      )
    ).toThrow(cancellation);
    expect(calls).toBe(3);
  });

  test('preserves ordered composition and implicit fixed points', () => {
    expect(composePermutations(p, q).images).toEqual([3, 1, 2]);
    expect(composePermutations(q, p).images).toEqual([2, 3, 1]);
    expect(composePermutations(p, identity).images).toEqual(p.images);
    expect(
      inversePermutation(PermutationValue.fromImages([2, 3, 1])).images
    ).toEqual([3, 1, 2]);
  });

  test('inverse and identity laws hold for all 720 permutations of six points', () => {
    const all = permutations([1, 2, 3, 4, 5, 6]);
    expect(all).toHaveLength(720);
    for (const images of all) {
      const value = PermutationValue.fromImages(images);
      const inverse = inversePermutation(value);
      expect(composePermutations(value, inverse).images).toEqual([]);
      expect(composePermutations(inverse, value).images).toEqual([]);
      expect(inversePermutation(inverse).images).toEqual(value.images);
      expect(composePermutations(identity, value).images).toEqual(value.images);
    }
  });

  test('composition respects point actions for every pair in S4', () => {
    const all = permutations([1, 2, 3, 4]).map((x) =>
      PermutationValue.fromImages(x)
    );
    const action = new PermutationAction(4);
    for (const a of all)
      for (const b of all) {
        const product = composePermutations(a, b);
        for (let point = 1; point <= 4; point++)
          expect(applyPermutation(product, point, action)).toBe(
            applyPermutation(b, applyPermutation(a, point, action), action)
          );
      }
  });

  test('associativity holds for all triples in S3', () => {
    const all = permutations([1, 2, 3]).map((x) =>
      PermutationValue.fromImages(x)
    );
    for (const a of all)
      for (const b of all)
        for (const c of all)
          expect(
            composePermutations(composePermutations(a, b), c).images
          ).toEqual(composePermutations(a, composePermutations(b, c)).images);
  });
});

describe('finite action compatibility', () => {
  test('retains ambient fixed points independently of element normalization', () => {
    const two = new PermutationAction(2),
      three = new PermutationAction(3);
    expect(two.degree).not.toBe(three.degree);
    expect(applyPermutation(p, 3, three)).toBe(3);
    expect(() => applyPermutation(p, 3, two)).toThrow(
      'point-outside-permutation-action'
    );
    expect(() => assertPermutationFits(q, two)).toThrow(
      'permutation-outside-action'
    );
    expect(() => assertPermutationFits(q, three)).not.toThrow();
  });
  test('empty action supports identity but no points', () => {
    const empty = new PermutationAction(0);
    expect(() => assertPermutationFits(identity, empty)).not.toThrow();
    expect(() => assertPermutationFits(p, empty)).toThrow(
      'permutation-outside-action'
    );
    expect(() => applyPermutation(identity, 1, empty)).toThrow(
      'point-outside-permutation-action'
    );
  });
  test.each([-1, 1.5, Infinity, NaN, '3', 100_001])(
    'rejects invalid action degree %p',
    (degree) => {
      expect(() => new PermutationAction(degree)).toThrow(
        PermutationInputError
      );
    }
  );
  test.each([0, -1, 4, 1.5, NaN, '1'])(
    'rejects invalid action point %p',
    (point) => {
      expect(() =>
        applyPermutation(p, point, new PermutationAction(3))
      ).toThrow('point-outside-permutation-action');
    }
  );
});
