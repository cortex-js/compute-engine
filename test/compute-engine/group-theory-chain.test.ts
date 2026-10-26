import {
  PermutationValue as P,
  PermutationAction as A,
  composePermutations as mul,
  applyPermutation,
} from '../../src/compute-engine/group-theory/permutation/values';
import {
  PermutationGroupValue as G,
  enumeratePermutationGroup,
} from '../../src/compute-engine/group-theory/permutation/groups';
import {
  PermutationStabilizerChain as Chain,
  verifyPermutationChain,
  permutationGroupContains,
  permutationPointStabilizer,
  permutationGroupRelation,
  permutationGroupIsAbelian,
  permutationChainLimits,
  type PermutationChainLevel,
} from '../../src/compute-engine/group-theory/permutation/stabilizer-chain';
import {
  permutationCycles,
  permutationElementOrder,
  permutationPower,
  permutationCommutator,
  conjugatePermutation,
} from '../../src/compute-engine/group-theory/permutation/element-operations';
const group = (images: number[][], degree: number) =>
  new G(
    images.map((x) => new P(x)),
    new A(degree)
  );
const bounds = { maxWork: 5_000_000 };
const keys = (values: readonly P[]) =>
  new Set(values.map((p) => p.images.join(',')));
const elements = (g: G) =>
  enumeratePermutationGroup(g, { maxElements: 120, maxProducts: 1000 });
const s3 = group(
  [
    [2, 1],
    [1, 3, 2],
  ],
  3
);
const a3 = group([[2, 3, 1]], 3);
const c2 = group([[2, 1]], 3);
const symmetric = (n: number) =>
  group(
    n < 2
      ? []
      : [[2, 1], Array.from({ length: n }, (_, i) => ((i + 1) % n) + 1)],
    n
  );
function permutations(values: number[]): number[][] {
  if (!values.length) return [[]];
  return values.flatMap((x, i) =>
    permutations(values.filter((_, j) => j !== i)).map((t) => [x, ...t])
  );
}

describe('verified bounded Schreier chains and group baseline', () => {
  test.each([
    ['trivial', group([], 0), 1n],
    ['C4', group([[2, 3, 4, 1]], 5), 4n],
    [
      'V4',
      group(
        [
          [2, 1, 4, 3],
          [3, 4, 1, 2],
        ],
        4
      ),
      4n,
    ],
    [
      'D8',
      group(
        [
          [2, 3, 4, 1],
          [1, 4, 3, 2],
        ],
        4
      ),
      8n,
    ],
    [
      'A4',
      group(
        [
          [2, 3, 1],
          [1, 3, 4, 2],
        ],
        4
      ),
      12n,
    ],
    ['S4', symmetric(4), 24n],
    ['intransitive', group([[2, 3, 1, 5, 4]], 6), 6n],
  ] as const)(
    '%s has independently known order and verified levels',
    (_, g, order) => {
      const chain = Chain.compute(g, bounds);
      expect(chain.order).toBe(order);
      expect(verifyPermutationChain(g, chain.levels, bounds)).toBe(true);
      expect(BigInt(elements(g).length)).toBe(order);
      expect(Chain.is(chain)).toBe(true);
      expect(Chain.is(Object.create(Chain.prototype))).toBe(false);
      expect(Object.isFrozen(chain)).toBe(true);
      expect(Object.isFrozen(chain.levels)).toBe(true);
      for (const level of chain.levels) {
        expect(Object.isFrozen(level)).toBe(true);
        expect(Object.isFrozen(level.representatives)).toBe(true);
      }
    }
  );

  test('all generating pairs on three points agree with exhaustive closure and constructive sifting', () => {
    const ps = permutations([1, 2, 3]).map((x) => new P(x));
    for (const p of ps)
      for (const q of ps) {
        const g = new G([p, q], new A(3)),
          reference = keys(elements(g));
        const chain = Chain.compute(g, bounds);
        expect(chain.order).toBe(BigInt(reference.size));
        for (const x of ps) {
          const sift = chain.sift(x, bounds);
          expect(sift.member).toBe(reference.has(x.images.join(',')));
          const reconstructed = sift.factors.reduce(
            (r, f) => mul(r, f),
            sift.residue
          );
          expect(reconstructed.images).toEqual(x.images);
        }
      }
  });

  test('S4 inside a five-point action rejects all 96 outsiders, including final-residue failures', () => {
    const g = group(
        [
          [2, 1],
          [2, 3, 4, 1],
        ],
        5
      ),
      chain = Chain.compute(g, bounds),
      reference = keys(elements(g));
    let rejected = 0;
    for (const images of permutations([1, 2, 3, 4, 5])) {
      const p = new P(images),
        r = chain.sift(p, bounds);
      expect(r.member).toBe(reference.has(p.images.join(',')));
      if (!r.member) rejected++;
      expect(r.factors.reduce((x, f) => mul(x, f), r.residue).images).toEqual(
        p.images
      );
    }
    expect(rejected).toBe(96);
  });

  test('S20 order is exact above Number.MAX_SAFE_INTEGER without group enumeration', () => {
    const chain = Chain.compute(symmetric(20), bounds);
    expect(chain.order).toBe(2432902008176640000n);
    expect(chain.levels.map((l) => l.orbit.length)).toEqual(
      Array.from({ length: 19 }, (_, i) => 20 - i)
    );
    expect(chain.sift(new P([2, 1]), bounds).member).toBe(true);
  });

  test('point stabilizers equal exhaustive fixed-point subgroups for every S4 base and a fixed fifth point', () => {
    const g = group(
        [
          [2, 1],
          [2, 3, 4, 1],
        ],
        5
      ),
      all = elements(g);
    for (let point = 1; point <= 5; point++) {
      const h = permutationPointStabilizer(g, point, bounds);
      expect(h.action.degree).toBe(5);
      expect(keys(elements(h))).toEqual(
        keys(all.filter((p) => applyPermutation(p, point, g.action) === point))
      );
    }
    expect(
      permutationPointStabilizer(group([], 3), 2, bounds).generators
    ).toEqual([]);
    expect(() => permutationPointStabilizer(g, 0, bounds)).toThrow(
      'point-outside-permutation-action'
    );
    expect(() => permutationPointStabilizer(group([], 0), 1, bounds)).toThrow(
      'point-outside-permutation-action'
    );
  });

  test('subgroup inclusion, equality, index, and normality have distinct semantics', () => {
    expect(permutationGroupRelation(s3, a3, 'subgroup', bounds)).toBe(true);
    expect(permutationGroupRelation(a3, s3, 'subgroup', bounds)).toBe(false);
    expect(permutationGroupRelation(s3, a3, 'index', bounds)).toBe(2n);
    expect(permutationGroupRelation(s3, c2, 'index', bounds)).toBe(3n);
    expect(() => permutationGroupRelation(a3, s3, 'index', bounds)).toThrow(
      'not-a-permutation-subgroup'
    );
    expect(permutationGroupRelation(s3, a3, 'normal', bounds)).toBe(true);
    expect(permutationGroupRelation(s3, c2, 'normal', bounds)).toBe(false);
    expect(permutationGroupRelation(a3, s3, 'normal', bounds)).toBe(false);
    expect(
      permutationGroupRelation(
        s3,
        group([[2, 3, 1], [2, 1], []], 3),
        'equal',
        bounds
      )
    ).toBe(true);
    expect(permutationGroupRelation(a3, c2, 'equal', bounds)).toBe(false);
    expect(permutationGroupRelation(s3, group([], 3), 'normal', bounds)).toBe(
      true
    );
    expect(permutationGroupIsAbelian(s3, bounds)).toBe(false);
    expect(permutationGroupIsAbelian(a3, bounds)).toBe(true);
    expect(permutationGroupIsAbelian(group([], 0), bounds)).toBe(true);
    expect(() =>
      permutationGroupRelation(s3, symmetric(4), 'subgroup', bounds)
    ).toThrow('incompatible-permutation-actions');
  });

  test('membership validates both group and action; identity belongs to a trivial group', () => {
    expect(permutationGroupContains(a3, new P([2, 3, 1]), bounds)).toBe(true);
    expect(permutationGroupContains(a3, new P([2, 1]), bounds)).toBe(false);
    expect(permutationGroupContains(group([], 0), new P([]), bounds)).toBe(
      true
    );
    expect(() =>
      permutationGroupContains(s3, new P([2, 3, 4, 1]), bounds)
    ).toThrow('permutation-outside-action');
    expect(() =>
      permutationGroupContains(Object.create(G.prototype), new P([]), bounds)
    ).toThrow('invalid-permutation-group');
    expect(() => Chain.compute(Object.create(G.prototype), bounds)).toThrow(
      'invalid-permutation-group'
    );
  });

  test('verification rejects incomplete, forged, and unrelated certificates', () => {
    const chain = Chain.compute(symmetric(4), bounds),
      levels = chain.levels;
    const replace = (i: number, change: Partial<PermutationChainLevel>) =>
      levels.map((l, j) => (j === i ? { ...l, ...change } : l));
    expect(
      verifyPermutationChain(symmetric(4), levels.slice(0, -1), bounds)
    ).toBe(false);
    expect(verifyPermutationChain(symmetric(4), [], bounds)).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        replace(0, { orbit: [1, 2, 3] }),
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        replace(0, { parents: [-1, 1, 0, 0] }),
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        replace(0, { labels: [-1, 99, 0, 0] }),
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        replace(0, {
          representatives: levels[0].representatives.map(() => new P([])),
        }),
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        replace(1, { generators: [new P([2, 1])] }),
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        replace(1, { base: levels[0].base }),
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(a3, Chain.compute(c2, bounds).levels, bounds)
    ).toBe(false);
    expect(() =>
      verifyPermutationChain(s3, [null] as never, bounds)
    ).not.toThrow();
  });

  test('work includes verification, succeeds at the exact boundary, and failures do not cache a result', () => {
    const chain = Chain.compute(s3, bounds),
      used = chain.workUsed;
    expect(() => Chain.compute(s3, { maxWork: used - 1 })).toThrow(
      'permutation-chain-work-limit'
    );
    expect(Chain.compute(s3, { maxWork: used }).order).toBe(6n);
    expect(() =>
      permutationGroupContains(s3, new P([2, 1]), { maxWork: used })
    ).toThrow('permutation-chain-work-limit');
    expect(Chain.compute(s3, bounds).order).toBe(6n);
  });

  test('storage, levels, orbit points and generator growth are bounded', () => {
    expect(() => Chain.compute(s3, { ...bounds, maxLevels: 0 })).toThrow(
      'permutation-chain-level-limit'
    );
    expect(() => Chain.compute(s3, { ...bounds, maxOrbitPoints: 2 })).toThrow(
      'permutation-orbit-point-limit'
    );
    expect(() => Chain.compute(s3, { ...bounds, maxStoredImages: 0 })).toThrow(
      'permutation-chain-storage-limit'
    );
    expect(() =>
      Chain.compute(symmetric(4), bounds, { maxGenerators: 2 })
    ).toThrow('permutation-chain-generator-limit');
    expect(() => Chain.compute(s3, bounds, { maxDegree: 2 })).toThrow(
      'permutation-degree-limit'
    );
    const chain = Chain.compute(s3, bounds);
    expect(() => chain.sift(new P([]), bounds, { maxDegree: 2 })).toThrow(
      'permutation-degree-limit'
    );
    expect(() =>
      verifyPermutationChain(s3, chain.levels, { ...bounds, maxOrbitPoints: 2 })
    ).toThrow('permutation-chain-orbit-point-limit');
  });

  test.each([-1, 0.5, Infinity, NaN, 50_000_001, undefined])(
    'invalid work cap %p is rejected',
    (maxWork) => {
      expect(() => permutationChainLimits({ maxWork: maxWork! })).toThrow();
    }
  );
  test('invalid secondary limits are rejected before any query', () => {
    for (const limits of [
      { ...bounds, maxLevels: 257 },
      { ...bounds, maxOrbitPoints: -1 },
      { ...bounds, maxStoredImages: 1_000_001 },
    ])
      expect(() => Chain.compute(s3, limits)).toThrow();
  });
  test('cancellation propagates during building, verification, and sifting', () => {
    const sentinel = new Error('cancel');
    const work = (stop: number) => {
      let calls = 0;
      return {
        check: () => {
          if (++calls === stop) throw sentinel;
        },
      };
    };
    const g = symmetric(9);
    expect(() => Chain.compute(g, bounds, work(100))).toThrow(sentinel);
    const chain = Chain.compute(g, bounds);
    expect(() =>
      verifyPermutationChain(g, chain.levels, bounds, work(100))
    ).toThrow(sentinel);
    expect(() =>
      chain.sift(new P([2, 3, 4, 5, 6, 7, 8, 9, 1]), bounds, work(20))
    ).toThrow(sentinel);
    expect(Chain.compute(g, bounds).order).toBe(362880n);
  });
});

describe('exact elementary permutation operations', () => {
  test('cycles, exact order, and arbitrary signed powers use the finite permutation domain', () => {
    const p = new P([2, 3, 1, 5, 4]);
    expect(permutationCycles(p)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(permutationElementOrder(p)).toBe(6n);
    expect(permutationPower(p, 0n).images).toEqual([]);
    expect(permutationPower(p, -1n).images).toEqual([3, 1, 2, 5, 4]);
    const big = 10n ** 100n + 1n;
    expect(permutationPower(p, big).images).toEqual(
      permutationPower(p, big % 6n).images
    );
    expect(permutationElementOrder(new P([]))).toBe(1n);
    expect(permutationCycles(new P([1, 2, 3]))).toEqual([]);
  });
  test('powers and conjugation agree with repeated ordered products through S4', () => {
    for (const images of permutations([1, 2, 3, 4])) {
      const p = new P(images);
      let repeated = new P([]);
      for (let k = 0; k <= 12; k++) {
        expect(permutationPower(p, BigInt(k)).images).toEqual(repeated.images);
        repeated = mul(repeated, p);
      }
      expect(permutationPower(p, permutationElementOrder(p)).images).toEqual(
        []
      );
    }
    const p = new P([2, 1]),
      q = new P([1, 3, 2]);
    expect(conjugatePermutation(p, q).images).toEqual([3, 2, 1]);
    expect(permutationCommutator(p, q).images).toEqual([2, 3, 1]);
  });
  test('element operations enforce brands, exact exponents, limits, and cancellation', () => {
    expect(() => permutationPower(new P([2, 1]), 1 as never)).toThrow(
      'invalid-permutation-exponent'
    );
    expect(() => permutationPower(new P([2, 1]), 1n << 16384n)).toThrow(
      'permutation-exponent-limit'
    );
    expect(() => permutationElementOrder(Object.create(P.prototype))).toThrow(
      'incompatible-permutation-domain'
    );
    expect(() => permutationCycles(new P([2, 1]), { maxDegree: 1 })).toThrow(
      'permutation-degree-limit'
    );
    const sentinel = new Error('cancel');
    expect(() =>
      permutationPower(new P([2, 1]), 3n, {
        check: () => {
          throw sentinel;
        },
      })
    ).toThrow(sentinel);
  });
});
