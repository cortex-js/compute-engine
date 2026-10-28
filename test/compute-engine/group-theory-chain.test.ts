import {
  PermutationValue,
  PermutationAction,
  composePermutations,
  applyPermutation,
} from '../../src/compute-engine/group-theory/permutation/values';
import {
  PermutationGroupValue,
  enumeratePermutationGroup,
} from '../../src/compute-engine/group-theory/permutation/groups';
import {
  PermutationStabilizerChain,
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
  new PermutationGroupValue(
    images.map((x) => PermutationValue.fromImages(x)),
    new PermutationAction(degree)
  );
const bounds = { maxWork: 5_000_000 };
const keys = (values: readonly PermutationValue[]) =>
  new Set(values.map((p) => p.images.join(',')));
const elements = (g: PermutationGroupValue) =>
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
      const chain = PermutationStabilizerChain.compute(g, bounds);
      expect(chain.order).toBe(order);
      expect(verifyPermutationChain(g, chain.certificate, bounds)).toBe(true);
      expect(BigInt(elements(g).length)).toBe(order);
    }
  );

  test('all generating pairs on three points agree with exhaustive closure and constructive sifting', () => {
    const ps = permutations([1, 2, 3]).map((x) =>
      PermutationValue.fromImages(x)
    );
    for (const p of ps)
      for (const q of ps) {
        const g = new PermutationGroupValue([p, q], new PermutationAction(3)),
          reference = keys(elements(g));
        const chain = PermutationStabilizerChain.compute(g, bounds);
        expect(chain.order).toBe(BigInt(reference.size));
        for (const x of ps) {
          const sift = chain.sift(x, bounds);
          expect(sift.member).toBe(reference.has(x.images.join(',')));
          const reconstructed = sift.factors.reduce(
            (r, f) => composePermutations(r, f),
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
      chain = PermutationStabilizerChain.compute(g, bounds),
      reference = keys(elements(g));
    let rejected = 0;
    for (const images of permutations([1, 2, 3, 4, 5])) {
      const p = PermutationValue.fromImages(images),
        r = chain.sift(p, bounds);
      expect(r.member).toBe(reference.has(p.images.join(',')));
      if (!r.member) rejected++;
      expect(
        r.factors.reduce((x, f) => composePermutations(x, f), r.residue).images
      ).toEqual(p.images);
    }
    expect(rejected).toBe(96);
  });

  test('S20 order is exact above Number.MAX_SAFE_INTEGER without group enumeration', () => {
    const chain = PermutationStabilizerChain.compute(symmetric(20), bounds);
    expect(chain.order).toBe(2432902008176640000n);
    expect(chain.levels.map((l) => l.orbit.length)).toEqual(
      Array.from({ length: 19 }, (_, i) => 20 - i)
    );
    expect(chain.sift(PermutationValue.fromImages([2, 1]), bounds).member).toBe(
      true
    );
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
    expect(
      permutationGroupContains(
        a3,
        PermutationValue.fromImages([2, 3, 1]),
        bounds
      )
    ).toBe(true);
    expect(
      permutationGroupContains(a3, PermutationValue.fromImages([2, 1]), bounds)
    ).toBe(false);
    expect(
      permutationGroupContains(
        group([], 0),
        PermutationValue.fromImages([]),
        bounds
      )
    ).toBe(true);
    expect(() =>
      permutationGroupContains(
        s3,
        PermutationValue.fromImages([2, 3, 4, 1]),
        bounds
      )
    ).toThrow('permutation-outside-action');
  });

  test('verification rejects incomplete, forged, and unrelated certificates', () => {
    const chain = PermutationStabilizerChain.compute(symmetric(4), bounds),
      levels = chain.levels;
    const replace = (i: number, change: Partial<PermutationChainLevel>) => ({
      ...chain.certificate,
      levels: levels.map((l, j) => (j === i ? { ...l, ...change } : l)),
    });
    expect(
      verifyPermutationChain(
        symmetric(4),
        { ...chain.certificate, levels: levels.slice(0, -1) },
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        { ...chain.certificate, levels: [] },
        bounds
      )
    ).toBe(false);
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
          parents: levels[0].parents.map(() => -1),
        }),
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        symmetric(4),
        replace(1, { generators: [PermutationValue.fromImages([2, 1])] }),
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
      verifyPermutationChain(
        a3,
        PermutationStabilizerChain.compute(c2, bounds).certificate,
        bounds
      )
    ).toBe(false);
    expect(() =>
      verifyPermutationChain(s3, [null] as never, bounds)
    ).not.toThrow();
  });

  test('construction succeeds at the exact work boundary and failures do not cache a result', () => {
    const chain = PermutationStabilizerChain.compute(s3, bounds),
      used = chain.workUsed;
    expect(() =>
      PermutationStabilizerChain.compute(s3, { maxWork: used - 1 })
    ).toThrow('permutation-chain-work-limit');
    expect(
      PermutationStabilizerChain.compute(s3, { maxWork: used }).order
    ).toBe(6n);
    expect(() =>
      permutationGroupContains(s3, PermutationValue.fromImages([2, 1]), {
        maxWork: used,
      })
    ).toThrow('permutation-chain-work-limit');
    expect(PermutationStabilizerChain.compute(s3, bounds).order).toBe(6n);
  });

  test('storage, levels, orbit points and generator growth are bounded', () => {
    expect(() =>
      PermutationStabilizerChain.compute(s3, { ...bounds, maxLevels: 0 })
    ).toThrow('permutation-chain-level-limit');
    expect(() =>
      PermutationStabilizerChain.compute(s3, { ...bounds, maxOrbitPoints: 2 })
    ).toThrow('permutation-chain-orbit-point-limit');
    expect(() =>
      PermutationStabilizerChain.compute(s3, { ...bounds, maxStoredImages: 0 })
    ).toThrow('permutation-chain-storage-limit');
    expect(() =>
      PermutationStabilizerChain.compute(symmetric(4), bounds, {
        maxGenerators: 2,
      })
    ).toThrow('permutation-chain-generator-limit');
    expect(() =>
      PermutationStabilizerChain.compute(s3, bounds, { maxDegree: 2 })
    ).toThrow('permutation-degree-limit');
    const chain = PermutationStabilizerChain.compute(s3, bounds);
    expect(() =>
      chain.sift(PermutationValue.fromImages([]), bounds, { maxDegree: 2 })
    ).toThrow('permutation-degree-limit');
    expect(() =>
      verifyPermutationChain(s3, chain.certificate, {
        ...bounds,
        maxOrbitPoints: 2,
      })
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
      { ...bounds, maxStoredImages: 100_000_001 },
    ])
      expect(() => PermutationStabilizerChain.compute(s3, limits)).toThrow();
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
    expect(() =>
      PermutationStabilizerChain.compute(g, bounds, work(100))
    ).toThrow(sentinel);
    const chain = PermutationStabilizerChain.compute(g, bounds);
    expect(() =>
      verifyPermutationChain(g, chain.certificate, bounds, work(100))
    ).toThrow(sentinel);
    expect(() =>
      chain.sift(
        PermutationValue.fromImages([2, 3, 4, 5, 6, 7, 8, 9, 1]),
        bounds,
        work(20)
      )
    ).toThrow(sentinel);
    expect(PermutationStabilizerChain.compute(g, bounds).order).toBe(362880n);
  });
});

describe('exact elementary permutation operations', () => {
  test('cycles, exact order, and arbitrary signed powers use the finite permutation domain', () => {
    const p = PermutationValue.fromImages([2, 3, 1, 5, 4]);
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
    expect(permutationElementOrder(PermutationValue.fromImages([]))).toBe(1n);
    expect(permutationCycles(PermutationValue.fromImages([1, 2, 3]))).toEqual(
      []
    );
  });
  test('powers and conjugation agree with repeated ordered products through S4', () => {
    for (const images of permutations([1, 2, 3, 4])) {
      const p = PermutationValue.fromImages(images);
      let repeated = PermutationValue.fromImages([]);
      for (let k = 0; k <= 12; k++) {
        expect(permutationPower(p, BigInt(k)).images).toEqual(repeated.images);
        repeated = composePermutations(repeated, p);
      }
      expect(permutationPower(p, permutationElementOrder(p)).images).toEqual(
        []
      );
    }
    const p = PermutationValue.fromImages([2, 1]),
      q = PermutationValue.fromImages([1, 3, 2]);
    expect(conjugatePermutation(p, q).images).toEqual([3, 2, 1]);
    expect(permutationCommutator(p, q).images).toEqual([2, 3, 1]);
  });
  test('element operations enforce brands, exact exponents, limits, and cancellation', () => {
    expect(() =>
      permutationPower(PermutationValue.fromImages([2, 1]), 1 as never)
    ).toThrow('invalid-permutation-exponent');
    expect(() =>
      permutationPower(PermutationValue.fromImages([2, 1]), 1n << 16384n)
    ).toThrow('permutation-exponent-limit');
    expect(() =>
      permutationCycles(PermutationValue.fromImages([2, 1]), { maxDegree: 1 })
    ).toThrow('permutation-degree-limit');
    const sentinel = new Error('cancel');
    expect(() =>
      permutationPower(PermutationValue.fromImages([2, 1]), 3n, {
        check: () => {
          throw sentinel;
        },
      })
    ).toThrow(sentinel);
  });
});

test('incremental chains agree with complete closure on reproducible random groups', () => {
  let state = 0x654321;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const shuffled = (degree: number) => {
    const images = Array.from({ length: degree }, (_, i) => i + 1);
    for (let i = degree - 1; i > 0; i--) {
      const j = next() % (i + 1);
      [images[i], images[j]] = [images[j], images[i]];
    }
    return PermutationValue.fromImages(images);
  };
  for (let sample = 0; sample < 40; sample++) {
    const degree = 2 + (sample % 5);
    const value = new PermutationGroupValue(
      Array.from({ length: 1 + (sample % 3) }, () => shuffled(degree)),
      new PermutationAction(degree)
    );
    const closure = enumeratePermutationGroup(value, {
      maxElements: 1000,
      maxProducts: 4000,
    });
    const members = new Set(closure.map((element) => element.images.join(',')));
    const chain = PermutationStabilizerChain.compute(value, bounds);
    expect(chain.order).toBe(BigInt(closure.length));
    expect(verifyPermutationChain(value, chain.certificate, bounds)).toBe(true);
    for (let i = 0; i < 8; i++) {
      const candidate = shuffled(degree);
      expect(chain.sift(candidate, bounds).member).toBe(
        members.has(candidate.images.join(','))
      );
    }
    const point = 1 + (sample % degree);
    const stabilizer = permutationPointStabilizer(value, point, bounds);
    const fixed = closure.filter(
      (element) => (element.images[point - 1] ?? point) === point
    );
    expect(PermutationStabilizerChain.compute(stabilizer, bounds).order).toBe(
      BigInt(fixed.length)
    );
  }
});
test('ordinary chain queries do not allocate diagnostic proof steps', () => {
  expect(
    PermutationStabilizerChain.compute(s3, { ...bounds, maxProofSteps: 0 })
      .order
  ).toBe(6n);
});
