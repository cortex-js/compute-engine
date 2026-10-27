import {
  PermutationValue,
  PermutationAction,
  applyPermutation,
  composePermutations,
  inversePermutation,
} from '../../src/compute-engine/group-theory/permutation/values';
import {
  PermutationGroupValue,
  enumeratePermutationGroup,
} from '../../src/compute-engine/group-theory/permutation/groups';
import {
  PermutationOrbitTree,
  PermutationOrbitLimitError,
  permutationOrbits,
  permutationOrbitLimits,
  permutationTransversalLimits,
} from '../../src/compute-engine/group-theory/permutation/orbits';

const group = (images: number[][], degree: number) =>
  new PermutationGroupValue(
    images.map((x) => PermutationValue.fromImages(x)),
    new PermutationAction(degree)
  );
const s3 = group(
  [
    [2, 1],
    [1, 3, 2],
  ],
  5
);
const orbitLimits = { maxPoints: 100, maxEdges: 1000 };
const transversalLimits = { maxProducts: 1000 };
const key = (p: PermutationValue) => p.images.join(',');

const fixtures = [
  { name: 'C4', group: group([[2, 3, 4, 1]], 5) },
  {
    name: 'V4',
    group: group(
      [
        [2, 1, 4, 3],
        [3, 4, 1, 2],
      ],
      4
    ),
  },
  {
    name: 'D8',
    group: group(
      [
        [2, 3, 4, 1],
        [1, 4, 3, 2],
      ],
      4
    ),
  },
  {
    name: 'A4',
    group: group(
      [
        [2, 3, 1],
        [1, 3, 4, 2],
      ],
      4
    ),
  },
  {
    name: 'S4',
    group: group(
      [
        [2, 1],
        [2, 3, 4, 1],
      ],
      4
    ),
  },
  { name: 'intransitive', group: group([[2, 3, 1, 5, 4]], 6) },
  { name: 'trivial', group: group([], 3) },
];

describe('bounded permutation orbits and Schreier transversals', () => {
  test('matches the published natural-action example and includes explicit fixed points', () => {
    const g = group(
      [
        [2, 3, 1, 5, 4],
        [1, 2, 6, 4, 5, 3],
      ],
      7
    );
    expect(PermutationOrbitTree.compute(g, 1, orbitLimits).points).toEqual([
      1, 2, 3, 6,
    ]);
    expect(permutationOrbits(g, orbitLimits)).toEqual([
      [1, 2, 3, 6],
      [4, 5],
      [7],
    ]);
  });

  test.each(fixtures)(
    '$name: orbit, representative, and right-coset certificates agree with complete closure',
    ({ group: g }) => {
      const elements = enumeratePermutationGroup(g, {
        maxElements: 24,
        maxProducts: 100,
      });
      const keys = new Set(elements.map(key));
      for (let root = 1; root <= g.action.degree; root++) {
        const orbit = PermutationOrbitTree.compute(g, root, orbitLimits);
        const expected = [
          ...new Set(elements.map((p) => applyPermutation(p, root, g.action))),
        ].sort((a, b) => a - b);
        expect([...orbit.points].sort((a, b) => a - b)).toEqual(expected);
        const transversal = orbit.transversal(transversalLimits);
        expect(transversal.map(([point]) => point)).toEqual(orbit.points);
        const stabilizer = elements.filter(
          (p) => applyPermutation(p, root, g.action) === root
        );
        const covered = new Set<string>();
        for (const [point, representative] of transversal) {
          expect(keys.has(key(representative))).toBe(true);
          expect(applyPermutation(representative, root, g.action)).toBe(point);
          expect(key(orbit.representative(point, transversalLimits)!)).toBe(
            key(representative)
          );
          const inverse = orbit.inverseRepresentative(
            point,
            transversalLimits
          )!;
          expect(applyPermutation(inverse, point, g.action)).toBe(root);
          expect(key(inverse)).toBe(key(inversePermutation(representative)));
          for (const h of stabilizer) {
            const cosetElement = key(composePermutations(h, representative));
            expect(covered.has(cosetElement)).toBe(false);
            covered.add(cosetElement);
          }
          // Schreier generators t_x s t_(x^s)^-1 fix the base point.
          for (const s of g.generators) {
            const target = applyPermutation(s, point, g.action);
            const inverseTarget = orbit.inverseRepresentative(
              target,
              transversalLimits
            )!;
            const schreier = composePermutations(
              composePermutations(representative, s),
              inverseTarget
            );
            expect(applyPermutation(schreier, root, g.action)).toBe(root);
            expect(keys.has(key(schreier))).toBe(true);
          }
        }
        expect(covered).toEqual(keys);
      }
      const partition = permutationOrbits(g, orbitLimits);
      expect(partition.flat().sort((a, b) => a - b)).toEqual(
        Array.from({ length: g.action.degree }, (_, i) => i + 1)
      );
    }
  );

  test('noncommuting generator paths use forward right products', () => {
    const orbit = PermutationOrbitTree.compute(s3, 1, {
      maxPoints: 3,
      maxEdges: 6,
    });
    expect(orbit.points).toEqual([1, 2, 3]);
    expect(orbit.representative(3, { maxProducts: 2 })?.images).toEqual([
      3, 1, 2,
    ]);
    expect(orbit.representative(4, { maxProducts: 0 })).toBeUndefined();
  });

  test('empty action partitions as empty; a singleton fixed orbit has identity representative', () => {
    expect(
      permutationOrbits(group([], 0), { maxPoints: 0, maxEdges: 0 })
    ).toEqual([]);
    expect(() =>
      PermutationOrbitTree.compute(group([], 0), 1, orbitLimits)
    ).toThrow('point-outside-permutation-action');
    const orbit = PermutationOrbitTree.compute(group([], 5), 5, {
      maxPoints: 1,
      maxEdges: 0,
    });
    expect(orbit.points).toEqual([5]);
    expect(
      orbit
        .transversal({ maxProducts: 0, maxImageWork: 0, maxStoredImages: 0 })
        .map(([point, p]) => [point, p.images])
    ).toEqual([[5, []]]);
    expect(
      permutationOrbits(group([], 3), { maxPoints: 3, maxEdges: 0 })
    ).toEqual([[1], [2], [3]]);
  });


  test('a full point budget still permits duplicate and identity edges', () => {
    const redundant = group([[2, 1], [], [2, 1]], 2);
    expect(
      PermutationOrbitTree.compute(redundant, 1, { maxPoints: 2, maxEdges: 6 })
        .points
    ).toEqual([1, 2]);
    expect(() =>
      PermutationOrbitTree.compute(redundant, 1, { maxPoints: 2, maxEdges: 5 })
    ).toThrow('permutation-orbit-edge-limit');
  });

  test('all discovered points are insufficient until every edge is checked; retry is fresh', () => {
    expect(() =>
      PermutationOrbitTree.compute(s3, 1, { maxPoints: 3, maxEdges: 5 })
    ).toThrow('permutation-orbit-edge-limit');
    expect(() =>
      PermutationOrbitTree.compute(s3, 1, { maxPoints: 2, maxEdges: 6 })
    ).toThrow('permutation-orbit-point-limit');
    expect(
      PermutationOrbitTree.compute(s3, 1, { maxPoints: 3, maxEdges: 6 }).points
    ).toEqual([1, 2, 3]);
  });

  test('partition point and edge budgets are cumulative across fixed and moved orbits', () => {
    expect(() => permutationOrbits(s3, { maxPoints: 4, maxEdges: 10 })).toThrow(
      'permutation-orbit-point-limit'
    );
    expect(() => permutationOrbits(s3, { maxPoints: 5, maxEdges: 9 })).toThrow(
      'permutation-orbit-edge-limit'
    );
    expect(permutationOrbits(s3, { maxPoints: 5, maxEdges: 10 })).toEqual([
      [1, 2, 3],
      [4],
      [5],
    ]);
  });

  test('transversal limits have exact boundaries and failures carry no partial value', () => {
    const orbit = PermutationOrbitTree.compute(group([[2, 3, 1]], 3), 1, {
      maxPoints: 3,
      maxEdges: 3,
    });
    for (const [limits, code] of [
      [{ maxProducts: 1 }, 'product'],
      [{ maxProducts: 2, maxImageWork: 5 }, 'image-work'],
      [{ maxProducts: 2, maxStoredImages: 5 }, 'storage'],
    ] as const) {
      try {
        orbit.transversal(limits);
        throw new Error('expected exhaustion');
      } catch (error) {
        expect(error).toBeInstanceOf(PermutationOrbitLimitError);
        expect((error as PermutationOrbitLimitError).code).toBe(
          `permutation-transversal-${code}-limit`
        );
        expect(Object.keys(error as object)).not.toContain('partial');
      }
    }
    expect(
      orbit.transversal({ maxProducts: 2, maxImageWork: 6, maxStoredImages: 6 })
    ).toHaveLength(3);
    expect(() => orbit.representative(3, { maxProducts: 1 })).toThrow(
      'permutation-transversal-product-limit'
    );
    expect(() =>
      orbit.inverseRepresentative(3, { maxProducts: 2, maxImageWork: 8 })
    ).toThrow('permutation-transversal-image-work-limit');
    expect(
      orbit.inverseRepresentative(3, {
        maxProducts: 2,
        maxImageWork: 9,
        maxStoredImages: 3,
      })?.images
    ).toEqual([2, 3, 1]);
  });

  test.each([0, -1, 6, 1.5, NaN, Infinity, '1', null])(
    'rejects invalid root or target %p',
    (point) => {
      expect(() =>
        PermutationOrbitTree.compute(s3, point, orbitLimits)
      ).toThrow('point-outside-permutation-action');
      expect(() =>
        PermutationOrbitTree.compute(s3, 1, orbitLimits).representative(
          point,
          transversalLimits
        )
      ).toThrow('point-outside-permutation-action');
    }
  );

  test('receiving limits and validated group brands apply to search and reconstruction', () => {
    expect(() =>
      PermutationOrbitTree.compute(s3, 1, orbitLimits, { maxDegree: 4 })
    ).toThrow('permutation-degree-limit');
    expect(() =>
      PermutationOrbitTree.compute(s3, 1, orbitLimits, { maxGenerators: 1 })
    ).toThrow('permutation-generator-limit');
    const orbit = PermutationOrbitTree.compute(s3, 1, orbitLimits);
    expect(() =>
      orbit.transversal(transversalLimits, { maxGeneratorImages: 4 })
    ).toThrow('permutation-generator-image-limit');
    expect(() =>
      orbit.representative(1, transversalLimits, { maxDegree: 4 })
    ).toThrow('permutation-degree-limit');
  });

  test.each([-1, 1.5, NaN, Infinity, 100_001, undefined])(
    'rejects invalid point cap %p',
    (maxPoints) => {
      expect(() =>
        permutationOrbitLimits({ maxPoints: maxPoints!, maxEdges: 0 })
      ).toThrow('invalid-permutation-orbit-point-limit');
    }
  );
  test('rejects missing and invalid edge and transversal budgets', () => {
    expect(() => permutationOrbitLimits(undefined!)).toThrow();
    expect(() =>
      permutationOrbitLimits({ maxPoints: 1, maxEdges: 1_000_001 })
    ).toThrow();
    expect(() => permutationOrbitLimits({ maxPoints: 1 } as never)).toThrow();
    expect(() => permutationTransversalLimits(undefined!)).toThrow();
    expect(() => permutationTransversalLimits({} as never)).toThrow();
    expect(() => permutationTransversalLimits({ maxProducts: -1 })).toThrow();
    expect(() =>
      permutationTransversalLimits({ maxProducts: 100_001 })
    ).toThrow();
    expect(() =>
      permutationTransversalLimits({ maxProducts: 1, maxImageWork: 5_000_001 })
    ).toThrow();
    expect(() =>
      permutationTransversalLimits({
        maxProducts: 1,
        maxStoredImages: 100_000_001,
      })
    ).toThrow();
  });

  test('search, partition, and reconstruction cooperate with cancellation without poisoning retries', () => {
    const g = group(
      [Array.from({ length: 30 }, (_, i) => ((i + 1) % 30) + 1)],
      30
    );
    const sentinel = new Error('cancel');
    const work = () => {
      let checks = 0;
      return {
        check: () => {
          if (++checks === 40) throw sentinel;
        },
      };
    };
    expect(() =>
      PermutationOrbitTree.compute(g, 1, orbitLimits, work())
    ).toThrow(sentinel);
    expect(() => permutationOrbits(g, orbitLimits, work())).toThrow(sentinel);
    const orbit = PermutationOrbitTree.compute(g, 1, orbitLimits);
    expect(() => orbit.transversal(transversalLimits, work())).toThrow(
      sentinel
    );
    expect(() => orbit.representative(30, transversalLimits, work())).toThrow(
      sentinel
    );
    expect(orbit.transversal(transversalLimits)).toHaveLength(30);
  });

  test('a small orbit succeeds for a group beyond the closure element cap', () => {
    // The adjacent swap and full cycle generate S9 (9! = 362880).
    const g = group(
      [
        [2, 1],
        [2, 3, 4, 5, 6, 7, 8, 9, 1],
      ],
      9
    );
    const orbit = PermutationOrbitTree.compute(g, 1, {
      maxPoints: 9,
      maxEdges: 18,
    });
    expect(orbit.points).toHaveLength(9);
    expect(orbit.transversal({ maxProducts: 8 })).toHaveLength(9);
  });
});
