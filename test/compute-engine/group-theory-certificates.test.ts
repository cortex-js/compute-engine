import {
  PermutationValue,
  PermutationAction,
  inversePermutation,
} from '../../src/compute-engine/group-theory/permutation/values';
import { PermutationGroupValue } from '../../src/compute-engine/group-theory/permutation/groups';
import {
  PermutationStabilizerChain,
  verifyPermutationChain,
  type PermutationChainCertificate,
} from '../../src/compute-engine/group-theory/permutation/stabilizer-chain';
import { PermutationQuerySession } from '../../src/compute-engine/group-theory/permutation/query-session';

const bounds = { maxWork: 50_000_000 };
const cycle = (n: number, points: number[]) => {
  const images = Array.from({ length: n }, (_, i) => i + 1);
  points.forEach((p, i) => {
    images[p - 1] = points[(i + 1) % points.length];
  });
  return PermutationValue.fromImages(images);
};

// ATLAS M24G1-p24B0: numerical permutation data, not algorithm source.
// https://brauer.maths.qmul.ac.uk/Atlas/spor/M24/
const m24 = new PermutationGroupValue(
  [
    PermutationValue.fromImages([
      4, 7, 17, 1, 13, 9, 2, 15, 6, 19, 18, 21, 5, 16, 8, 14, 3, 11, 10, 24, 12,
      23, 22, 20,
    ]),
    PermutationValue.fromImages([
      4, 21, 9, 6, 18, 1, 7, 8, 15, 5, 11, 12, 17, 2, 3, 13, 16, 10, 24, 20, 14,
      22, 19, 23,
    ]),
  ],
  new PermutationAction(24)
);

function cubeGroup() {
  // PermutationAction facelet is its cubie position together with its outward normal.
  const facelets: { p: number[]; normal: number[] }[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1])
      for (const u of [-1, 0, 1])
        for (const v of [-1, 0, 1]) {
          if (u === 0 && v === 0) continue;
          const p = [0, 0, 0],
            normal = [0, 0, 0];
          p[axis] = normal[axis] = sign;
          p[(axis + 1) % 3] = u;
          p[(axis + 2) % 3] = v;
          facelets.push({ p, normal });
        }
  const key = (p: number[], n: number[]) => p.join(',') + ':' + n.join(',');
  const indices = new Map(facelets.map((f, i) => [key(f.p, f.normal), i + 1]));
  const generators: PermutationValue[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const rotate = (v: number[]) => {
        const r = [...v],
          b = (axis + 1) % 3,
          c = (axis + 2) % 3;
        r[b] = -v[c];
        r[c] = v[b];
        return r;
      };
      generators.push(
        PermutationValue.fromImages(
          facelets.map((f, i) =>
            f.p[axis] !== sign
              ? i + 1
              : indices.get(key(rotate(f.p), rotate(f.normal)))!
          )
        )
      );
    }
  return new PermutationGroupValue(generators, new PermutationAction(48));
}

describe('reduced stabilizer certificates', () => {
  test.each([
    [
      'A16 from 3-cycles',
      new PermutationGroupValue(
        Array.from({ length: 14 }, (_, i) => cycle(16, [1, 2, i + 3])),
        new PermutationAction(16)
      ),
      10461394944000n,
    ],
    ['M24', m24, 244823040n],
    ['Rubik face turns', cubeGroup(), 43252003274489856000n],
  ])(
    '%s has exact order under the default limits without closure enumeration',
    (_name, g, order) => {
      const chain = PermutationStabilizerChain.compute(g, bounds);
      expect(chain.order).toBe(order);
      expect(verifyPermutationChain(g, chain.certificate, bounds)).toBe(true);
      for (const generator of g.generators)
        expect(chain.sift(generator, bounds).member).toBe(true);
    }
  );

  test('a different generating set is accepted when provenance and stabilizer closure prove it', () => {
    const p = cycle(3, [1, 2, 3]),
      q = inversePermutation(p),
      g = new PermutationGroupValue([p], new PermutationAction(3));
    const certificate: PermutationChainCertificate = {
      version: 1,
      proof: [
        { kind: 'input', index: 0 },
        { kind: 'inverse', operand: 0 },
      ],
      levels: [
        {
          base: 1,
          generators: [q],
          generatorProofs: [1],
          orbit: [1, 3, 2],
          parents: [-1, 0, 1],
          labels: [-1, 0, 0],
        },
      ],
    };
    expect(verifyPermutationChain(g, certificate, bounds)).toBe(true);
    expect(
      verifyPermutationChain(
        g,
        {
          ...certificate,
          proof: [
            { kind: 'input', index: 0 },
            { kind: 'inverse', operand: 1 },
          ],
        },
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(
        g,
        {
          ...certificate,
          proof: [
            { kind: 'input', index: 1 },
            { kind: 'inverse', operand: 0 },
          ],
        },
        bounds
      )
    ).toBe(false);
    expect(
      verifyPermutationChain(g, { ...certificate, version: 2 } as never, bounds)
    ).toBe(false);
    expect(
      verifyPermutationChain(
        g,
        {
          ...certificate,
          levels: [{ ...certificate.levels[0], generatorProofs: [0] }],
        },
        bounds
      )
    ).toBe(false);
  });

  test('sifting alone cannot certify an unrelated supergroup', () => {
    const a3 = new PermutationGroupValue(
      [cycle(3, [1, 2, 3])],
      new PermutationAction(3)
    );
    const s3 = new PermutationGroupValue(
      [...a3.generators, cycle(3, [1, 2])],
      new PermutationAction(3)
    );
    const forged = PermutationStabilizerChain.compute(s3, bounds).certificate;
    expect(verifyPermutationChain(a3, forged, bounds)).toBe(false);
  });

  test('proof limits and interruption apply to verification', () => {
    const chain = PermutationStabilizerChain.compute(m24, bounds);
    expect(() =>
      verifyPermutationChain(m24, chain.certificate, {
        ...bounds,
        maxProofSteps: 0,
      })
    ).toThrow('permutation-chain-proof-limit');
    const abort = new Error('stop');
    expect(() =>
      verifyPermutationChain(m24, chain.certificate, bounds, {
        check: () => {
          throw abort;
        },
      })
    ).toThrow(abort);
  });

  test('session hits retain cancellation and stricter budget semantics', () => {
    const g = new PermutationGroupValue(
      [cycle(3, [1, 2]), cycle(3, [1, 2, 3])],
      new PermutationAction(3)
    );
    const session = new PermutationQuerySession(),
      chain = session.chain(g, bounds);
    expect(session.chain(g, bounds)).toBe(chain);
    expect(() => session.order(g, { maxWork: chain.workUsed - 1 })).toThrow(
      'permutation-chain-work-limit'
    );
    expect(() =>
      session.contains(g, g.generators[0], { maxWork: chain.workUsed })
    ).toThrow('permutation-chain-work-limit');
    const stop = new Error('cancel');
    expect(() =>
      session.order(g, bounds, {
        check: () => {
          throw stop;
        },
      })
    ).toThrow(stop);
    expect(session.order(g, bounds)).toBe(6n);
  });
});

test('S100 from a transposition and cycle fits the default work and live storage bounds', () => {
  const group = new PermutationGroupValue(
    [
      cycle(100, [1, 2]),
      cycle(
        100,
        Array.from({ length: 100 }, (_, i) => i + 1)
      ),
    ],
    new PermutationAction(100)
  );
  const chain = PermutationStabilizerChain.compute(group, bounds);
  let factorial = 1n;
  for (let i = 2n; i <= 100n; i++) factorial *= i;
  expect(chain.order).toBe(factorial);
  expect(chain.workUsed).toBeLessThan(50_000_000);
  expect(chain.storedImagesCharged).toBeLessThan(1_000_000);
  expect(chain.levels.every((level) => !('representatives' in level))).toBe(
    true
  );
  expect(chain.sift(cycle(100, [1, 37, 100]), bounds).member).toBe(true);
  expect(() =>
    PermutationStabilizerChain.compute(group, {
      ...bounds,
      maxStoredImages: 10,
    })
  ).toThrow('permutation-chain-storage-limit');
});

test('relations and point stabilizers reuse chains without bypassing limits', () => {
  const group = new PermutationGroupValue(
    [cycle(4, [1, 2]), cycle(4, [1, 2, 3, 4])],
    new PermutationAction(4)
  );
  const subgroup = new PermutationGroupValue([cycle(4, [1, 2])], group.action);
  const session = new PermutationQuerySession();
  const compute = jest.spyOn(PermutationStabilizerChain, 'compute');
  try {
    for (const query of ['subgroup', 'index', 'equal', 'normal'] as const) {
      const answer = session.relation(group, subgroup, query, bounds);
      compute.mockClear();
      expect(session.relation(group, subgroup, query, bounds)).toBe(answer);
      expect(compute).not.toHaveBeenCalled();
    }
    session.stabilizer(group, 1, bounds);
    compute.mockClear();
    session.stabilizer(group, 1, bounds);
    expect(compute).not.toHaveBeenCalled();
    expect(() =>
      session.stabilizer(group, 1, { ...bounds, maxStoredImages: 0 })
    ).toThrow('permutation-chain-storage-limit');
    expect(() => session.order(group, { ...bounds, maxOrbitEdges: 0 })).toThrow(
      'permutation-chain-orbit-edge-limit'
    );
  } finally {
    compute.mockRestore();
  }
});

describe('a cached chain is shared by queries of different kinds', () => {
  // S_8 generated by the transposition (1 2) and the 8-cycle.
  const symmetric8 = () =>
    new PermutationGroupValue(
      [cycle(8, [1, 2]), cycle(8, [1, 2, 3, 4, 5, 6, 7, 8])],
      new PermutationAction(8)
    );

  test('a relation query reuses the chain of an order query, and the reverse', () => {
    const group = symmetric8();
    const compute = jest.spyOn(PermutationStabilizerChain, 'compute');
    try {
      const session = new PermutationQuerySession();
      session.order(group, bounds);
      compute.mockClear();
      // The relation query passes its remaining budget, which is smaller than
      // `bounds`. The cached chain fits it, so no chain is built.
      expect(session.relation(group, group, 'subgroup', bounds)).toBe(true);
      expect(compute).not.toHaveBeenCalled();

      const other = new PermutationQuerySession();
      other.relation(group, group, 'equal', bounds);
      compute.mockClear();
      expect(other.order(group, bounds)).toBe(40320n);
      expect(compute).not.toHaveBeenCalled();
    } finally {
      compute.mockRestore();
    }
  });

  test('a query whose limits are too small fails and keeps the cached chain', () => {
    const group = symmetric8();
    const session = new PermutationQuerySession();
    const chain = session.chain(group, bounds);
    expect(() => session.order(group, { maxWork: chain.workUsed - 1 })).toThrow(
      'permutation-chain-work-limit'
    );
    expect(session.chain(group, bounds)).toBe(chain);
  });

  test('a smaller storage limit does not reuse a chain that it would build at a higher cost', () => {
    // Under `maxStoredImages: 301`, construction evicts transversal elements
    // and needs more work than with the default storage limit. A cold query
    // with that storage limit and a work limit between the two costs fails;
    // the warm query must fail the same way.
    const group = symmetric8();
    const limits = { maxWork: 50_000_000, maxStoredImages: 301 };
    const cold = PermutationStabilizerChain.compute(group, limits);
    expect(cold.storageLimited).toBe(true);
    const session = new PermutationQuerySession();
    const cached = session.chain(group, bounds);
    expect(cached.storageLimited).toBe(false);
    expect(cached.workUsed).toBeLessThan(cold.workUsed);
    const between = { maxStoredImages: 301, maxWork: cold.workUsed - 1 };
    expect(cached.fits(between)).toBe(false);
    expect(() => session.order(group, between)).toThrow(
      'permutation-chain-work-limit'
    );
    // With the same storage limit and enough work, the answer is the cold
    // one, and the chain that fits more requests stays in the cache.
    const limited = session.chain(group, limits);
    expect(limited.workUsed).toBe(cold.workUsed);
    expect(session.chain(group, bounds)).toBe(cached);
    // The chain built under the small storage limit is cached for those
    // exact limits, so the same query does not build it again.
    expect(session.chain(group, limits)).toBe(limited);
  });
});
