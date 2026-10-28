import {
  FiniteGroupTable,
  GroupWork,
} from '../../src/compute-engine/group-theory/finite-group';
import { FinitePcgs } from '../../src/compute-engine/group-theory/polycyclic';
import {
  finitePcgsBySeries,
  finitePcOrbitStabilizer,
} from '../../src/compute-engine/group-theory/polycyclic-actions';
import { FiniteModuloPcgs } from '../../src/compute-engine/group-theory/polycyclic-quotient';
import {
  PermutationValue,
  PermutationAction,
  applyPermutation,
} from '../../src/compute-engine/group-theory/permutation/values';
import { PermutationGroupValue } from '../../src/compute-engine/group-theory/permutation/groups';

const budget = () => new GroupWork(50_000_000);

function cyclic(order: number) {
  return FiniteGroupTable.fromTable(
    Array.from({ length: order }, (_, a) =>
      Array.from({ length: order }, (_, b) => (a + b) % order)
    ),
    budget()
  );
}

function symmetric(degree: number) {
  const cycle = PermutationValue.fromImages(
    Array.from({ length: degree }, (_, i) => ((i + 1) % degree) + 1)
  );
  const transposition = PermutationValue.fromImages([2, 1]);
  const permutationGroup = new PermutationGroupValue(
    [cycle, transposition],
    new PermutationAction(degree)
  );
  return {
    ...FiniteGroupTable.fromPermutationGroup(permutationGroup, 256, budget()),
    cycle,
    action: permutationGroup.action,
  };
}

describe('finite polycyclic coordinates', () => {
  test.each([1, 4, 6, 8, 12, 27])('coordinate bijection for C%p', (order) => {
    const group = cyclic(order);
    const work = budget();
    const pcgs = FinitePcgs.compute(group, work)!;
    expect(pcgs.relativeOrders.reduce((a, b) => a * b, 1)).toBe(order);
    for (let x = 0; x < order; x++) {
      expect(pcgs.element(pcgs.exponents(x, work), work)).toBe(x);
      expect(
        pcgs.linearCombination(pcgs.exponents(x, work).map(BigInt), work)
      ).toBe(x);
    }
    expect(pcgs.depth(0, work)).toBe(pcgs.sequence.length + 1);
  });

  test('nonabelian coordinates and power, conjugate and commutator relations in S4', () => {
    const { table } = symmetric(4);
    const work = budget();
    const session = table.session(work);
    const pcgs = FinitePcgs.compute(table, work)!;
    for (const x of session.whole.members) {
      const exponents = pcgs.exponents(x, work);
      expect(pcgs.element(exponents, work)).toBe(x);
      expect(pcgs.head(x, pcgs.sequence.length + 1, work)).toBe(x);
      expect(pcgs.head(x, 1, work)).toBe(0);
    }
    for (let i = 1; i <= pcgs.sequence.length; i++) {
      const generator = pcgs.sequence[i - 1];
      expect(
        pcgs.element(pcgs.specialExponents('power', i, undefined, work), work)
      ).toBe(session.pow(generator, BigInt(pcgs.relativeOrders[i - 1])));
      for (let j = 1; j <= pcgs.sequence.length; j++)
        for (const kind of ['conjugate', 'commutator'] as const)
          expect(
            pcgs.element(pcgs.specialExponents(kind, i, j, work), work)
          ).toBe(
            kind === 'conjugate'
              ? session.conjugate(pcgs.sequence[j - 1], generator)
              : session.commutator(generator, pcgs.sequence[j - 1])
          );
    }
  });

  test('nonsolvable A5 has no finite pcgs', () => {
    const group = new PermutationGroupValue(
      [
        PermutationValue.fromImages([2, 3, 1]),
        PermutationValue.fromImages([2, 3, 4, 5, 1]),
      ],
      new PermutationAction(5)
    );
    const model = FiniteGroupTable.fromPermutationGroup(group, 60, budget());
    expect(FinitePcgs.compute(model.table, budget())).toBeUndefined();
  });

  test('rejects a tail which is not normal and invalid coordinates', () => {
    const { table, cycle, indexOf } = symmetric(4);
    const work = budget();
    const session = table.session(work);
    const transposition = indexOf(PermutationValue.fromImages([2, 1]))!;
    expect(() =>
      FinitePcgs.fromSequence(table, [indexOf(cycle)!, transposition], work)
    ).toThrow('pc-tail-is-not-normal');
    const pcgs = FinitePcgs.compute(table, work)!;
    expect(() => pcgs.element([], work)).toThrow('invalid-pc-exponent-count');
    expect(() => pcgs.element(pcgs.relativeOrders, work)).toThrow(
      'pc-exponent-out-of-range'
    );
    expect(() => pcgs.induced(cyclic(2).session(work).whole, work)).toThrow();
    expect(pcgs.factorThrough(pcgs, 0, work)).toEqual([0, 0]);
    expect(session.whole.order).toBe(24);
  });

  test('composite parent factors admit the correct induced coordinates', () => {
    const table = cyclic(12);
    const work = budget();
    const parent = FinitePcgs.fromSequence(table, [1], work);
    const subgroup = table.session(work).generated([4]);
    const induced = parent.induced(subgroup, work);
    expect(induced.relativeOrders).toEqual([3]);
    for (let x = 0; x < table.order; x++) {
      expect(induced.sift(x, work) === 0).toBe(subgroup.has(x));
      expect(induced.canonical(x, work)).toBe(x % 4);
    }
    expect(() =>
      FinitePcgs.fromSequence(table, [8], work, parent)
    ).not.toThrow();
  });

  test('membership sifting and canonical representatives are distinct for H=<4-cycle> in S4', () => {
    const { table, cycle, indexOf } = symmetric(4);
    const work = budget();
    const session = table.session(work);
    const parent = FinitePcgs.compute(table, work)!;
    const subgroup = session.generated([indexOf(cycle)!]);
    const induced = parent.induced(subgroup, work);
    let nonCanonical = false;
    for (const x of session.whole.members) {
      const residue = induced.sift(x, work);
      expect(residue === 0).toBe(subgroup.has(x));
      expect(subgroup.has(session.mul(residue, session.inv(x)))).toBe(true);
      const representative = induced.canonical(x, work);
      for (const h of subgroup.members) {
        const cosetElement = session.mul(h, x);
        expect(induced.canonical(cosetElement, work)).toBe(representative);
        nonCanonical ||= induced.sift(cosetElement, work) !== residue;
      }
    }
    expect(nonCanonical).toBe(true);
  });

  test('every subgroup of S4 has induced coordinates with exact membership reduction', () => {
    const { table } = symmetric(4);
    const work = budget();
    const session = table.session(work);
    const parent = FinitePcgs.compute(table, work)!;
    const subgroups = session.subgroups();
    expect(subgroups).toHaveLength(30);
    for (const subgroup of subgroups) {
      const induced = parent.induced(subgroup, work);
      for (const x of session.whole.members) {
        expect(induced.sift(x, work) === 0).toBe(subgroup.has(x));
        if (subgroup.has(x))
          expect(induced.element(induced.exponents(x, work), work)).toBe(x);
      }
    }
  });

  test('preserves every boundary when refining the derived series', () => {
    const { table } = symmetric(4);
    const work = budget();
    const session = table.session(work);
    const series = session.series('derived', session.whole);
    const result = finitePcgsBySeries(series, work)!;
    expect(result.boundaries).toHaveLength(series.length);
    series.forEach((subgroup, i) => {
      expect(
        session.equal(
          subgroup,
          session.generated(
            result.pcgs.sequence.slice(result.boundaries[i] - 1)
          )
        )
      ).toBe(true);
    });
  });

  test('work exhaustion and cancellation propagate without mathematical results', () => {
    const group = cyclic(8);
    expect(() => FinitePcgs.compute(group, new GroupWork(0))).toThrow(
      'group-work-limit'
    );
    const cancelled = new Error('cancelled');
    expect(() =>
      FinitePcgs.compute(
        group,
        new GroupWork(50_000_000, () => {
          throw cancelled;
        })
      )
    ).toThrow(cancelled);
  });
});

describe('finite modulo pcgs', () => {
  test('projection preserves multiplication while its coordinate lift need not', () => {
    const group = cyclic(8);
    const work = budget();
    const session = group.session(work);
    const parent = FinitePcgs.fromSequence(group, [1], work);
    const section = new FiniteModuloPcgs(
      parent,
      session.whole,
      session.generated([4]),
      work
    );
    expect(section.pcgs.group.order).toBe(4);
    const quotient = section.pcgs.group.session(work);
    for (const x of session.whole.members)
      for (const y of session.whole.members)
        expect(section.project(session.mul(x, y), work)).toBe(
          quotient.mul(section.project(x, work), section.project(y, work))
        );
    for (const x of quotient.whole.members)
      expect(section.project(section.lift(x, work), work)).toBe(x);
    const image = section.project(1, work);
    expect(session.pow(section.lift(image, work), 4n)).toBe(4);
    expect(section.lift(quotient.pow(image, 4n), work)).toBe(0);
    const imageSubgroup = section.projectSubgroup(session.generated([2]), work);
    expect(imageSubgroup.subgroup.order).toBe(2);
    expect(
      section.liftSubgroup(imageSubgroup.subgroup, work).subgroup.members
    ).toEqual(session.generated([2]).members);
  });

  test('proper numerator rejects outside elements and retains its denominator in preimages', () => {
    const group = cyclic(12);
    const work = budget();
    const session = group.session(work);
    const parent = FinitePcgs.fromSequence(group, [1], work);
    const section = new FiniteModuloPcgs(
      parent,
      session.generated([2]),
      session.generated([6]),
      work
    );
    expect(section.pcgs.group.order).toBe(3);
    expect(() => section.project(1, work)).toThrow(
      'element-outside-quotient-numerator'
    );
    expect(
      section.liftSubgroup(section.pcgs.group.session(work).trivial, work)
        .subgroup.members
    ).toEqual([0, 6]);
  });

  test('elementary abelian sections carry row-vector conjugation and affine actions', () => {
    const { table, indexOf } = symmetric(4);
    const work = budget();
    const session = table.session(work);
    const parent = FinitePcgs.compute(table, work)!;
    const kleinFour = session.series('derived', session.whole)[2];
    const section = new FiniteModuloPcgs(
      parent,
      kleinFour,
      session.trivial,
      work
    );
    const transposition = indexOf(PermutationValue.fromImages([2, 1]))!;
    const matrix = section.linearAction(transposition, work);
    expect(matrix.dimension).toBe(2);
    expect(matrix.field.characteristic).toBe(2);
    for (const x of kleinFour.members) {
      const input = section.exponents(x, work).map(BigInt);
      const expected = section.exponents(
        session.conjugate(x, transposition),
        work
      );
      expect(
        matrix.act(input, work).map((value) => Number(value.numerator))
      ).toEqual(expected);
    }
    const translation = kleinFour.members[1];
    const affine = section.affineAction(transposition, translation, work);
    const input = [...section.exponents(translation, work).map(BigInt), 1n];
    const expected = session.mul(
      session.conjugate(translation, transposition),
      translation
    );
    expect(
      affine.act(input, work).map((value) => Number(value.numerator))
    ).toEqual([...section.exponents(expected, work), 1]);
  });
});

describe('finite pc group actions', () => {
  test('orbit representatives and stabilizers agree with the natural S4 action', () => {
    const { table, elements, action } = symmetric(4);
    const work = budget();
    const parent = FinitePcgs.compute(table, work)!;
    const result = finitePcOrbitStabilizer(parent, elements, action, 1, work);
    expect([...result.points].sort()).toEqual([1, 2, 3, 4]);
    expect(result.stabilizer.subgroup.order).toBe(6);
    result.points.forEach((point, i) =>
      expect(
        applyPermutation(elements[result.representatives[i]], 1, action)
      ).toBe(point)
    );
    for (const x of result.stabilizer.subgroup.members)
      expect(applyPermutation(elements[x], 1, action)).toBe(1);
  });

  test('rejects maps that violate a Cayley edge or the identity image', () => {
    const { table, elements, action } = symmetric(4);
    const work = budget();
    const parent = FinitePcgs.compute(table, work)!;
    const invalid = [...elements];
    [invalid[1], invalid[2]] = [invalid[2], invalid[1]];
    expect(() =>
      finitePcOrbitStabilizer(parent, invalid, action, 1, work)
    ).toThrow('pc-action-is-not-a-homomorphism');
    invalid[0] = elements[1];
    expect(() =>
      finitePcOrbitStabilizer(parent, invalid, action, 1, work)
    ).toThrow('pc-action-identity-is-not-identity');
  });
});
