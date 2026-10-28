import {
  CollectedPcGroup,
  fromFinitePcgs,
} from '../../src/compute-engine/group-theory/polycyclic-presentation';
import {
  FiniteGroupTable,
  GroupWork,
} from '../../src/compute-engine/group-theory/finite-group';
import { FinitePcgs } from '../../src/compute-engine/group-theory/polycyclic';
import { PermutationGroupValue } from '../../src/compute-engine/group-theory/permutation/groups';
import {
  PermutationValue,
  PermutationAction,
} from '../../src/compute-engine/group-theory/permutation/values';

const budget = () => new GroupWork(50_000_000);

function cyclic(order: bigint, work = budget()) {
  return CollectedPcGroup.extend(
    CollectedPcGroup.trivial(work),
    {
      relativeOrder: order,
      power: [],
      conjugates: [],
      inverseConjugates: [],
    },
    work
  );
}

function symmetric(degree: number) {
  return FiniteGroupTable.fromPermutationGroup(
    new PermutationGroupValue(
      [
        PermutationValue.fromImages(
          Array.from({ length: degree }, (_, i) => ((i + 1) % degree) + 1)
        ),
        PermutationValue.fromImages([2, 1]),
      ],
      new PermutationAction(degree)
    ),
    256,
    budget()
  );
}

describe('collected finite cyclic extensions', () => {
  test('cyclic order 10^12 uses exact bigint coordinates without enumeration', () => {
    const work = budget();
    const group = cyclic(1_000_000_000_000n, work);
    const generator = group.generator(0, work);
    expect(group.order).toBe(1_000_000_000_000n);
    expect(group.multiply([999_999_999_999n], [2n], work)).toEqual([1n]);
    expect(group.power(generator, -1n, work)).toEqual([999_999_999_999n]);
    expect(group.power(generator, 1_000_000_000_000n, work)).toEqual([0n]);
    expect(group.storedCoefficients).toBeLessThan(20);
  });

  test('C2^40 collection scales with presentation size rather than group order', () => {
    const work = budget();
    let group = CollectedPcGroup.trivial(work);
    for (let i = 0; i < 40; i++) {
      const images = Array.from({ length: group.rank }, (_, j) =>
        group.generator(j, work)
      );
      group = CollectedPcGroup.extend(
        group,
        {
          relativeOrder: 2n,
          power: group.identity(),
          conjugates: images,
          inverseConjugates: images,
        },
        work
      );
    }
    expect(group.order).toBe(1n << 40n);
    const element = group.coordinates(Array<bigint>(40).fill(1n), work);
    expect(group.multiply(element, element, work)).toEqual(group.identity());
    expect(group.power(element, 123456789012345678901n, work)).toEqual(element);
    expect(group.storedCoefficients).toBeLessThan(50_000);
  });

  test('dihedral group of order 2*10^12 uses binary automorphism powers', () => {
    const work = budget();
    const rotation = cyclic(1_000_000_000_000n, work);
    const group = CollectedPcGroup.extend(
      rotation,
      {
        relativeOrder: 2n,
        power: [0n],
        conjugates: [[999_999_999_999n]],
        inverseConjugates: [[999_999_999_999n]],
      },
      work
    );
    expect(group.order).toBe(2_000_000_000_000n);
    const reflection = [1n, 0n],
      generator = [0n, 1n];
    expect(
      group.multiply(
        group.multiply(reflection, generator, work),
        reflection,
        work
      )
    ).toEqual([0n, 999_999_999_999n]);
    expect(group.power([1n, 123456789n], 2n, work)).toEqual([0n, 0n]);
    expect(group.power(generator, -123456789012345678901n, work)).toEqual([
      0n,
      987654321099n,
    ]);
  });

  test('large outer powers compose a nontrivial automorphism logarithmically', () => {
    const work = budget();
    const group = CollectedPcGroup.extend(
      cyclic(257n, work),
      {
        relativeOrder: 1_000_000_000_000n,
        power: [0n],
        conjugates: [[3n]],
        inverseConjugates: [[86n]],
      },
      work
    );
    expect(group.order).toBe(257_000_000_000_000n);
    expect(group.multiply([0n, 1n], [999_999_999_999n, 0n], work)).toEqual([
      999_999_999_999n,
      86n,
    ]);
    const element = [987_654_321_987n, 123n];
    expect(group.multiply(element, group.inverse(element, work), work)).toEqual(
      [0n, 0n]
    );
    expect(work.used).toBeLessThan(500_000);
  });

  test('a nonsplit central cyclic extension collects carries into its tail', () => {
    const work = budget();
    const group = CollectedPcGroup.extend(
      cyclic(2n, work),
      {
        relativeOrder: 2n,
        power: [1n],
        conjugates: [[1n]],
        inverseConjugates: [[1n]],
      },
      work
    );
    expect(group.order).toBe(4n);
    expect(group.power([1n, 0n], 2n, work)).toEqual([0n, 1n]);
    expect(group.power([1n, 0n], 4n, work)).toEqual([0n, 0n]);
    expect(group.inverse([1n, 0n], work)).toEqual([1n, 1n]);
  });

  test('Q8 products and inverses agree exhaustively with an independent table', () => {
    const work = budget();
    const group = CollectedPcGroup.extend(
      cyclic(4n, work),
      {
        relativeOrder: 2n,
        power: [2n],
        conjugates: [[3n]],
        inverseConjugates: [[3n]],
      },
      work
    );
    const basis = [
      [0, 1, 2, 3],
      [1, 4, 3, 6],
      [2, 7, 4, 1],
      [3, 2, 5, 4],
    ];
    const table = FiniteGroupTable.fromTable(
      Array.from({ length: 8 }, (_, a) =>
        Array.from(
          { length: 8 },
          (_, b) => basis[a & 3][b & 3] ^ (a & 4) ^ (b & 4)
        )
      ),
      work
    );
    const session = table.session(work);
    const element = (vector: readonly bigint[]) =>
      session.mul(session.pow(2, vector[0]), session.pow(1, vector[1]));
    const vectors = Array.from({ length: 8 }, (_, i) => [
      BigInt(i % 2),
      BigInt(i >> 1),
    ]);
    for (const a of vectors) {
      expect(element(group.inverse(a, work))).toBe(session.inv(element(a)));
      for (const b of vectors)
        expect(element(group.multiply(a, b, work))).toBe(
          session.mul(element(a), element(b))
        );
    }
  });

  test('S4 presentation from a subnormal series agrees with every table product', () => {
    const work = budget();
    const { table } = symmetric(4);
    const pcgs = FinitePcgs.compute(table, work)!;
    const group = fromFinitePcgs(pcgs, work);
    const session = table.session(work);
    const vectors = session.whole.members.map((x) =>
      pcgs.exponents(x, work).map(BigInt)
    );
    expect(group.order).toBe(24n);
    for (let a = 0; a < table.order; a++) {
      expect(group.inverse(vectors[a], work)).toEqual(vectors[session.inv(a)]);
      for (let b = 0; b < table.order; b++)
        expect(group.multiply(vectors[a], vectors[b], work)).toEqual(
          vectors[session.mul(a, b)]
        );
      expect(group.power(vectors[a], -7n, work)).toEqual(
        vectors[session.pow(a, -7n)]
      );
    }
  });

  test('noncentral carry uses phi^m(h)=t^-1*h*t in the correct orientation', () => {
    const work = budget();
    const { table, indexOf } = symmetric(3);
    const pcgs = FinitePcgs.compute(table, work)!;
    const tail = fromFinitePcgs(pcgs, work);
    const session = table.session(work);
    const a = indexOf(PermutationValue.fromImages([2, 3, 1]))!;
    const coordinates = (x: number) => pcgs.exponents(x, work).map(BigInt);
    const group = CollectedPcGroup.extend(
      tail,
      {
        relativeOrder: 2n,
        power: coordinates(session.pow(a, 2n)),
        conjugates: pcgs.sequence.map((x) =>
          coordinates(session.conjugate(x, a))
        ),
        inverseConjugates: pcgs.sequence.map((x) =>
          coordinates(session.conjugate(x, session.inv(a)))
        ),
      },
      work
    );
    const vectors = Array.from({ length: 12 }, (_, i) => [
      BigInt(i % 2),
      ...coordinates(i >> 1),
    ]);
    const directProduct = (vector: readonly bigint[]) => [
      session.mul(
        session.pow(a, vector[0]),
        pcgs.element(vector.slice(1).map(Number), work)
      ),
      Number(vector[0]),
    ];
    expect(group.order).toBe(12n);
    for (const vector of vectors) {
      const element = directProduct(vector);
      expect(directProduct(group.inverse(vector, work))).toEqual([
        session.inv(element[0]),
        element[1],
      ]);
    }
    for (const left of vectors)
      for (const right of vectors) {
        const x = directProduct(left),
          y = directProduct(right);
        expect(directProduct(group.multiply(left, right, work))).toEqual([
          session.mul(x[0], y[0]),
          x[1] ^ y[1],
        ]);
      }
  });

  test('rejects endomorphisms that violate a defining relation or lack an inverse', () => {
    const work = budget();
    const tail = CollectedPcGroup.extend(
      cyclic(4n, work),
      {
        relativeOrder: 2n,
        power: [0n],
        conjugates: [[1n]],
        inverseConjugates: [[1n]],
      },
      work
    );
    expect(() =>
      CollectedPcGroup.extend(
        tail,
        {
          relativeOrder: 2n,
          power: [0n, 0n],
          conjugates: [
            [0n, 1n],
            [1n, 0n],
          ],
          inverseConjugates: [
            [0n, 1n],
            [1n, 0n],
          ],
        },
        work
      )
    ).toThrow('pc-map-does-not-preserve-power-relations');
    expect(() =>
      CollectedPcGroup.extend(
        cyclic(4n, work),
        {
          relativeOrder: 2n,
          power: [0n],
          conjugates: [[2n]],
          inverseConjugates: [[2n]],
        },
        work
      )
    ).toThrow('pc-automorphism-images-are-not-inverse');
    const { table } = symmetric(3);
    const pcgs = FinitePcgs.compute(table, work)!;
    const symmetricTail = fromFinitePcgs(pcgs, work);
    expect(() =>
      CollectedPcGroup.extend(
        symmetricTail,
        {
          relativeOrder: 2n,
          power: [0n, 0n],
          conjugates: [
            [0n, 0n],
            [0n, 1n],
          ],
          inverseConjugates: [
            [1n, 0n],
            [0n, 1n],
          ],
        },
        work
      )
    ).toThrow('pc-map-does-not-preserve-conjugation-relations');
  });

  test('rejects noninvariant powers and inconsistent outer conjugation', () => {
    const work = budget();
    const tail = cyclic(4n, work);
    expect(() =>
      CollectedPcGroup.extend(
        tail,
        {
          relativeOrder: 2n,
          power: [1n],
          conjugates: [[3n]],
          inverseConjugates: [[3n]],
        },
        work
      )
    ).toThrow('pc-power-relation-is-not-invariant');
    expect(() =>
      CollectedPcGroup.extend(
        tail,
        {
          relativeOrder: 3n,
          power: [0n],
          conjugates: [[3n]],
          inverseConjugates: [[3n]],
        },
        work
      )
    ).toThrow('pc-cyclic-extension-is-inconsistent');
  });

  test('the rank ceiling applies before allocating the next extension', () => {
    const work = budget();
    let group = CollectedPcGroup.trivial(work);
    for (let i = 0; i < 64; i++) {
      const images = Array.from({ length: group.rank }, (_, j) =>
        group.generator(j, work)
      );
      group = CollectedPcGroup.extend(
        group,
        {
          relativeOrder: 2n,
          power: group.identity(),
          conjugates: images,
          inverseConjugates: images,
        },
        work
      );
    }
    expect(group.order).toBe(1n << 64n);
    expect(() =>
      CollectedPcGroup.extend(
        group,
        {
          relativeOrder: 2n,
          power: [],
          conjugates: [],
          inverseConjugates: [],
        },
        work
      )
    ).toThrow('pc-presentation-rank-limit');
  });

  test('boundary validation, limits and cancellation cannot produce a partial group', () => {
    const group = cyclic(4n);
    expect(() => group.coordinates([4n], budget())).toThrow(
      'pc-coordinate-out-of-range'
    );
    expect(() => group.coordinates([-1n], budget())).toThrow(
      'pc-coordinate-out-of-range'
    );
    expect(() => group.coordinates([1], budget())).toThrow(
      'pc-presentation-requires-integer'
    );
    expect(() => group.coordinates([], budget())).toThrow(
      'invalid-pc-coordinate-count'
    );
    expect(() => cyclic(1n)).toThrow('pc-relative-order-must-exceed-one');
    expect(() => cyclic(1n << 4096n)).toThrow('pc-presentation-integer-limit');
    expect(() => group.power([1n], 1n << 4096n, budget())).toThrow(
      'pc-presentation-integer-limit'
    );
    expect(() =>
      CollectedPcGroup.extend(
        group,
        {
          relativeOrder: 2n,
          power: [0n],
          conjugates: [],
          inverseConjugates: [],
        },
        budget()
      )
    ).toThrow('invalid-pc-automorphism-image-count');
    expect(() => group.multiply([1n], [1n], new GroupWork(0))).toThrow(
      'group-work-limit'
    );
    const cancelled = new Error('cancelled');
    expect(() =>
      group.power(
        [1n],
        2n,
        new GroupWork(50_000_000, () => {
          throw cancelled;
        })
      )
    ).toThrow(cancelled);
  });
});

describe('finite pc sequence conversion', () => {
  test.each([1, 4, 6, 8, 12, 27])(
    'preserves every product and coordinate for C%p',
    (order) => {
      const work = budget();
      const table = FiniteGroupTable.fromTable(
        Array.from({ length: order }, (_, a) =>
          Array.from({ length: order }, (_, b) => (a + b) % order)
        ),
        work
      );
      const pcgs = FinitePcgs.compute(table, work)!;
      const group = fromFinitePcgs(pcgs, work);
      const coordinates = Array.from({ length: order }, (_, x) =>
        pcgs.exponents(x, work).map(BigInt)
      );
      expect(group.relativeOrders).toEqual(pcgs.relativeOrders.map(BigInt));
      expect(group.order).toBe(BigInt(order));
      for (let a = 0; a < order; a++) {
        expect(group.inverse(coordinates[a], work)).toEqual(
          coordinates[(order - a) % order]
        );
        for (let b = 0; b < order; b++)
          expect(group.multiply(coordinates[a], coordinates[b], work)).toEqual(
            coordinates[(a + b) % order]
          );
      }
    }
  );
  test('does not silently renumber redundant generators', () => {
    const work = budget();
    const table = FiniteGroupTable.fromTable(
      [
        [0, 1],
        [1, 0],
      ],
      work
    );
    const pcgs = FinitePcgs.fromSequence(table, [1, 1], work);
    expect(() => fromFinitePcgs(pcgs, work)).toThrow('redundant-pc-generator');
  });
});
