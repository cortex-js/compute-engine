import {
  PermutationValue as P,
  PermutationAction as A,
  composePermutations as mul,
  inversePermutation as inverse,
} from '../../src/compute-engine/group-theory/permutation/values';
import { PermutationGroupValue as G } from '../../src/compute-engine/group-theory/permutation/groups';
import {
  PermutationStabilizerChain as Chain,
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
  return new P(images);
};

// ATLAS M24G1-p24B0: numerical permutation data, not algorithm source.
// https://brauer.maths.qmul.ac.uk/Atlas/spor/M24/
const m24 = new G(
  [
    new P([
      4, 7, 17, 1, 13, 9, 2, 15, 6, 19, 18, 21, 5, 16, 8, 14, 3, 11, 10, 24, 12,
      23, 22, 20,
    ]),
    new P([
      4, 21, 9, 6, 18, 1, 7, 8, 15, 5, 11, 12, 17, 2, 3, 13, 16, 10, 24, 20, 14,
      22, 19, 23,
    ]),
  ],
  new A(24)
);

function cubeGroup() {
  // A facelet is its cubie position together with its outward normal.
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
  const generators: P[] = [];
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
        new P(
          facelets.map((f, i) =>
            f.p[axis] !== sign
              ? i + 1
              : indices.get(key(rotate(f.p), rotate(f.normal)))!
          )
        )
      );
    }
  return new G(generators, new A(48));
}

describe('reduced stabilizer certificates', () => {
  test.each([
    [
      'A16 from 3-cycles',
      new G(
        Array.from({ length: 14 }, (_, i) => cycle(16, [1, 2, i + 3])),
        new A(16)
      ),
      10461394944000n,
    ],
    ['M24', m24, 244823040n],
    ['Rubik face turns', cubeGroup(), 43252003274489856000n],
  ])(
    '%s has exact order under the default limits without closure enumeration',
    (_name, g, order) => {
      const chain = Chain.compute(g, bounds);
      expect(chain.order).toBe(order);
      expect(verifyPermutationChain(g, chain.certificate, bounds)).toBe(true);
      for (const generator of g.generators)
        expect(chain.sift(generator, bounds).member).toBe(true);
    }
  );

  test('a different generating set is accepted when provenance and stabilizer closure prove it', () => {
    const p = cycle(3, [1, 2, 3]),
      q = inverse(p),
      g = new G([p], new A(3));
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
          representatives: [new P([]), q, mul(q, q)],
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
    const a3 = new G([cycle(3, [1, 2, 3])], new A(3));
    const s3 = new G([...a3.generators, cycle(3, [1, 2])], new A(3));
    const forged = Chain.compute(s3, bounds).certificate;
    expect(verifyPermutationChain(a3, forged, bounds)).toBe(false);
  });

  test('proof limits and interruption apply to verification', () => {
    const chain = Chain.compute(m24, bounds);
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
    expect(Object.isFrozen(chain.certificate.proof)).toBe(true);
    expect(Object.isFrozen(chain.certificate.proof[0])).toBe(true);
  });

  test('session hits retain cancellation and stricter budget semantics', () => {
    const g = new G([cycle(3, [1, 2]), cycle(3, [1, 2, 3])], new A(3));
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
