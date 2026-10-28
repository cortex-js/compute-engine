import {
  FiniteGroupTable,
  FiniteGroupHomomorphism,
  GroupInputError,
  GroupLimitError,
  GroupWork,
  finitePermutationModel,
} from '../../src/compute-engine/group-theory/finite-group';
import {
  finiteAutomorphisms,
  finiteMinimalGenerators,
  finiteHallSubgroups,
  finiteEulerianFunction,
  finiteGroupSeries,
  finiteIsCharacteristic,
} from '../../src/compute-engine/group-theory/finite-structure';
import {
  PermutationValue,
  PermutationAction,
} from '../../src/compute-engine/group-theory/permutation/values';
import {
  PermutationGroupValue,
  enumeratePermutationGroup,
} from '../../src/compute-engine/group-theory/permutation/groups';

const work = (limit = 50_000_000) => new GroupWork(limit);
const cyclic = (order: number) =>
  FiniteGroupTable.fromTable(
    Array.from({ length: order }, (_, a) =>
      Array.from({ length: order }, (_, b) => (a + b) % order)
    ),
    work()
  );
function model(images: number[][]) {
  return finitePermutationModel(
    new PermutationGroupValue(
      images.map((image) => PermutationValue.fromImages(image)),
      new PermutationAction(images[0]?.length ?? 0)
    ),
    256,
    work()
  );
}
function dihedral(rotationOrder: number) {
  const order = rotationOrder * 2;
  return FiniteGroupTable.fromTable(
    Array.from({ length: order }, (_, a) =>
      Array.from({ length: order }, (_, b) => {
        const rotation =
          ((a % rotationOrder) +
            (a < rotationOrder ? 1 : -1) * (b % rotationOrder) +
            rotationOrder) %
          rotationOrder;
        return (
          rotation +
          (a < rotationOrder !== b < rotationOrder ? rotationOrder : 0)
        );
      })
    ),
    work()
  );
}

describe('finite-group algorithms and verified maps', () => {
  test('arithmetic-only sessions do not compute unused subgroup closures', () => {
    const table = cyclic(128),
      ledger = work(10),
      session = table.session(ledger);
    expect(session.mul(2, 3)).toBe(5);
    expect(session.inv(2)).toBe(126);
    expect(session.pow(2, 3n)).toBe(6);
    expect(ledger.used).toBeLessThanOrEqual(10);
  });

  test('C2^7 structural queries need no subgroup lattice', () => {
    const table = FiniteGroupTable.fromTable(
      Array.from({ length: 128 }, (_, a) =>
        Array.from({ length: 128 }, (_, b) => a ^ b)
      ),
      work()
    );
    const ledger = work(100_000),
      session = table.session(ledger);
    const lattice = jest.spyOn(session, 'subgroups').mockImplementation(() => {
      throw new Error('unnecessary lattice');
    });
    expect(session.sylow(session.whole, 2).order).toBe(128);
    expect(session.sylow(session.whole, 3).order).toBe(1);
    expect(session.frattini().order).toBe(1);
    expect(session.isSimple()).toBe(false);
    expect(session.radical(session.whole, 'fitting').order).toBe(128);
    expect(session.radical(session.whole, 'socle').order).toBe(128);
    for (const kind of ['composition', 'chief', 'supersolvable'] as const) {
      const series = finiteGroupSeries(session, kind)!;
      expect(series.map((term) => term.order)).toEqual([
        128, 64, 32, 16, 8, 4, 2, 1,
      ]);
      expect(
        series.every((term) => session.isNormal(session.whole, term))
      ).toBe(true);
    }
    expect(finiteIsCharacteristic(session, session.trivial)).toBe(true);
    expect(finiteIsCharacteristic(session, session.frattini())).toBe(true);
    expect(finiteIsCharacteristic(session, session.whole)).toBe(true);
    expect(finiteIsCharacteristic(session, session.generated([1, 2, 4]))).toBe(
      false
    );
    const generators = finiteMinimalGenerators(session);
    expect(generators.length).toBe(7);
    expect(session.generated(generators).order).toBe(128);
    expect(
      finiteHallSubgroups(session, session.whole, [2]).map((h) => h.order)
    ).toEqual([128]);
    expect(finiteEulerianFunction(session, 6)).toBe(0n);
    expect(finiteEulerianFunction(session, 7)).toBe(
      [1n, 2n, 4n, 8n, 16n, 32n, 64n].reduce(
        (count, rank) => count * (128n - rank),
        1n
      )
    );
    expect(lattice).not.toHaveBeenCalled();
    expect(ledger.used).toBeLessThan(100_000);
  });
  test('nilpotent Hall projections avoid mixed-primary subgroup lattices', () => {
    const table = FiniteGroupTable.fromTable(
      Array.from({ length: 192 }, (_, a) =>
        Array.from(
          { length: 192 },
          (_, b) =>
            ((a % 64) ^ (b % 64)) +
            64 * ((Math.floor(a / 64) + Math.floor(b / 64)) % 3)
        )
      ),
      work()
    );
    const ledger = work(50_000),
      session = table.session(ledger);
    const lattice = jest.spyOn(session, 'subgroups').mockImplementation(() => {
      throw new Error('unnecessary lattice');
    });
    const two = finiteHallSubgroups(session, session.whole, [2]);
    expect(two).toHaveLength(1);
    expect(two[0].members).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(finiteHallSubgroups(session, session.whole, [3])[0].members).toEqual(
      [0, 64, 128]
    );
    expect(
      finiteHallSubgroups(session, session.whole, [2, 3, 2])[0].order
    ).toBe(192);
    expect(lattice).not.toHaveBeenCalled();
    expect(ledger.used).toBeLessThan(50_000);
  });
  test('canonical characteristic subgroups are recognized from independently rebuilt members', () => {
    const table = dihedral(64),
      reference = table.session(work());
    const canonical = [
      reference.center(),
      reference.derived(),
      reference.frattini(),
      ...reference.series('derived'),
      ...reference.series('lower-central'),
      ...reference.series('upper-central'),
    ];
    for (const subgroup of canonical) {
      const ledger = work(500_000),
        session = table.session(ledger);
      const imported = session.generated([...subgroup.members]);
      expect(imported).not.toBe(subgroup);
      expect(finiteIsCharacteristic(session, imported)).toBe(true);
      expect(ledger.used).toBeLessThan(500_000);
    }
  });
  test('nilpotent prime-factor series and socles agree with independent subgroup oracles', () => {
    for (const table of [
      cyclic(1),
      cyclic(8),
      cyclic(12),
      dihedral(4),
      dihedral(8),
    ]) {
      const session = table.session(work()),
        normals = session.normalSubgroups();
      const minimal = normals.filter(
        (h) =>
          h.order > 1 &&
          !normals.some(
            (k) => k.order > 1 && k.order < h.order && session.subset(h, k)
          )
      );
      const expectedSocle = minimal.reduce(
        (a, h) => session.closure(a, h),
        session.trivial
      );
      expect(session.radical(session.whole, 'socle').members).toEqual(
        expectedSocle.members
      );
      expect(session.radical(session.whole, 'fitting').order).toBe(table.order);
      for (const kind of ['composition', 'chief', 'supersolvable'] as const) {
        const series = finiteGroupSeries(session, kind)!;
        expect(series[0].order).toBe(table.order);
        expect(series.at(-1)!.order).toBe(1);
        for (let i = 1; i < series.length; i++) {
          expect(session.isNormal(session.whole, series[i])).toBe(true);
          expect(session.index(series[i - 1], series[i])).toBeGreaterThan(1);
          expect(() =>
            session.prime(session.index(series[i - 1], series[i]))
          ).not.toThrow();
        }
      }
      const automorphisms = finiteAutomorphisms(session);
      for (const subgroup of session.subgroups()) {
        const invariant = automorphisms.every((map) =>
          subgroup.members.every((x) => subgroup.has(map.apply(x)))
        );
        expect(finiteIsCharacteristic(session, subgroup)).toBe(invariant);
      }
    }
  });
  test('D128 automorphisms use one generator-edge certification per map', () => {
    const table = dihedral(64),
      ledger = work(5_000_000);
    const maps = finiteAutomorphisms(table.session(ledger));
    expect(maps.length).toBe(2048);
    expect(new Set(maps.map((map) => map.images.join(','))).size).toBe(2048);
    // Independent exhaustive validation samples the complete product equations.
    for (const index of [0, 1, 1024, 2047])
      expect(
        FiniteGroupHomomorphism.fromImages(
          table,
          table,
          maps[index].images,
          work()
        ).images
      ).toEqual(maps[index].images);
    expect(ledger.used).toBeLessThan(5_000_000);
  });
  test('Sylow, simplicity and Frattini agree with exhaustive small-group oracles', () => {
    const tables = [
      cyclic(1),
      cyclic(6),
      cyclic(8),
      dihedral(4),
      dihedral(6),
      model([
        [2, 1, 3],
        [2, 3, 1],
      ]).table,
      model([
        [2, 1, 3, 4],
        [2, 3, 4, 1],
      ]).table,
    ];
    for (const table of tables) {
      const session = table.session(work()),
        lattice = session.subgroups();
      const normals = lattice.filter((h) => session.isNormal(session.whole, h));
      expect(session.isSimple()).toBe(table.order > 1 && normals.length === 2);
      const maximal = lattice.filter(
        (h) =>
          h.order < table.order &&
          !lattice.some(
            (k) =>
              k.order < table.order && k.order > h.order && session.subset(k, h)
          )
      );
      const frattini = maximal.reduce(
        (a, b) => session.intersection(a, b),
        session.whole
      );
      expect(session.frattini().members).toEqual(frattini.members);
      for (const prime of [2, 3, 5, 7]) {
        let expected = 1,
          remaining = table.order;
        while (remaining % prime === 0) {
          remaining /= prime;
          expected *= prime;
        }
        expect(session.sylow(session.whole, prime).order).toBe(expected);
      }
      for (const primes of [[2], [3], [2, 3]]) {
        let target = 1,
          remaining = table.order;
        for (const prime of primes)
          while (remaining % prime === 0) {
            target *= prime;
            remaining /= prime;
          }
        const expected = lattice
          .filter((h) => h.order === target)
          .map((h) => h.members.join(','))
          .sort();
        expect(
          finiteHallSubgroups(session, session.whole, primes)
            .map((h) => h.members.join(','))
            .sort()
        ).toEqual(expected);
      }
      const generators = finiteMinimalGenerators(session);
      expect(session.generated(generators).order).toBe(table.order);
    }
  });
  test('proper-subgroup quotient retains projection domains and ambient labels', () => {
    const table = cyclic(12),
      session = table.session(work());
    const numerator = session.generated([2]),
      denominator = session.generated([6]);
    const quotient = session.quotient(numerator, denominator);
    expect(quotient.group.order).toBe(3);
    expect(quotient.source).toBe(numerator);
    expect(quotient.kernel).toBe(denominator);
    expect(quotient.sourceElements).toEqual([0, 2, 4, 6, 8, 10]);
    expect(quotient.projectionMap.source.order).toBe(6);
    expect(quotient.projectionMap.target).toBe(quotient.group);
    expect(quotient.projectionMap.image(work()).order).toBe(3);
    expect(
      quotient.projectionMap
        .kernel(work())
        .members.map((x) => quotient.sourceElements[x])
    ).toEqual(denominator.members);
    quotient.sourceElements.forEach((x, i) =>
      expect(quotient.projectionMap.apply(i)).toBe(quotient.projection[x])
    );
    expect(quotient.projection[1]).toBe(-1);
  });
  test('subgroup images and inverse images include the correct domains and kernel', () => {
    const source = cyclic(12),
      target = cyclic(6),
      ledger = work();
    const map = FiniteGroupHomomorphism.fromGeneratorImages(
      source,
      target,
      [1],
      [1],
      ledger
    )!;
    const sourceSession = source.session(ledger),
      targetSession = target.session(ledger);
    const even = sourceSession.generated([2]);
    expect(map.imageOf(even, ledger).members).toEqual([0, 2, 4]);
    expect(
      map.preimageOf(targetSession.generated([3]), ledger).members
    ).toEqual([0, 3, 6, 9]);
    expect(map.preimageOf(targetSession.trivial, ledger).members).toEqual(
      map.kernel(ledger).members
    );
    expect(() => map.imageOf(targetSession.whole, ledger)).toThrow('source');
    expect(() => map.preimageOf(sourceSession.whole, ledger)).toThrow('target');
  });
  test('mixed-primary abelian groups avoid the subgroup lattice for Frattini and minimum generators', () => {
    const rows = Array.from({ length: 216 }, (_, a) =>
      Array.from(
        { length: 216 },
        (_, b) =>
          (((a % 6) + (b % 6)) % 6) +
          6 * (((Math.floor(a / 6) % 6) + (Math.floor(b / 6) % 6)) % 6) +
          36 * ((Math.floor(a / 36) + Math.floor(b / 36)) % 6)
      )
    );
    const session = FiniteGroupTable.fromTable(rows, work()).session(work());
    const lattice = jest.spyOn(session, 'subgroups').mockImplementation(() => {
      throw new Error('unnecessary lattice');
    });
    expect(session.frattini().order).toBe(1);
    const generators = finiteMinimalGenerators(session);
    expect(generators.length).toBe(3);
    expect(session.generated(generators).order).toBe(216);
    expect(finiteEulerianFunction(session, 2)).toBe(0n);
    expect(finiteEulerianFunction(session, 3)).toBe(168n * 11232n);
    expect(lattice).not.toHaveBeenCalled();
  });
  test('automorphism count limits terminate elementary abelian basis searches', () => {
    const rows = Array.from({ length: 128 }, (_, a) =>
      Array.from({ length: 128 }, (_, b) => a ^ b)
    );
    const session = FiniteGroupTable.fromTable(rows, work()).session(
      work(5_000_000)
    );
    expect(() => finiteAutomorphisms(session, 8)).toThrow(
      'automorphism-count-limit'
    );
  });
  test('quotients reject nonnormal kernels and foreign subgroup domains', () => {
    const table = model([
        [2, 1, 3],
        [2, 3, 1],
      ]).table,
      session = table.session(work());
    expect(() =>
      session.quotient(session.whole, session.sylow(session.whole, 2))
    ).toThrow('normal');
    expect(() =>
      session.quotient(session.whole, cyclic(6).session(work()).trivial)
    ).toThrow('incompatible');
  });
  test('validated tables and maps own their input arrays', () => {
    const rows = [
      [0, 1],
      [1, 0],
    ];
    const table = FiniteGroupTable.fromTable(rows, work());
    rows[1][1] = 1;
    expect(table.product(1, 1, work())).toBe(0);
    const images = [0, 1];
    const map = FiniteGroupHomomorphism.fromImages(
      table,
      table,
      images,
      work()
    );
    images[1] = 0;
    expect(map.apply(1)).toBe(1);
  });
  test('generator assignments, inverses and composition preserve explicit domains', () => {
    const source = cyclic(6),
      target = cyclic(3);
    const projection = FiniteGroupHomomorphism.fromGeneratorImages(
      source,
      target,
      [1],
      [1],
      work()
    )!;
    expect(projection.images).toEqual([0, 1, 2, 0, 1, 2]);
    expect(
      FiniteGroupHomomorphism.fromGeneratorImages(
        target,
        source,
        [1],
        [1],
        work()
      )
    ).toBeUndefined();
    expect(() => projection.inverse(work())).toThrow('bijective');
    const inverseGenerator = FiniteGroupHomomorphism.fromGeneratorImages(
      source,
      source,
      [1],
      [5],
      work()
    )!;
    expect(
      inverseGenerator.then(inverseGenerator.inverse(work()), work()).images
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => projection.then(inverseGenerator, work())).toThrow('domains');
    expect(() =>
      FiniteGroupHomomorphism.fromGeneratorImages(
        source,
        target,
        [2],
        [1],
        work()
      )
    ).toThrow('do-not-generate');
    expect(() =>
      FiniteGroupHomomorphism.fromImages(
        source,
        source,
        [0, 1, 2, 3, 4, 4],
        work()
      )
    ).toThrow('not-a-group-homomorphism');
  });
  test('closure charges image work to the finite ledger and reports finite limits', () => {
    const group = new PermutationGroupValue(
      [PermutationValue.fromImages([2, 3, 4, 1])],
      new PermutationAction(4)
    );
    expect(() => finitePermutationModel(group, 3, work())).toThrow(
      GroupLimitError
    );
    expect(() => finitePermutationModel(group, 4, work(3))).toThrow(
      'group-work-limit'
    );
    const finite = finitePermutationModel(group, 4, work());
    expect(finite.table.order).toBe(4);
    expect(finite.elements.map((element) => element.images)).toEqual(
      enumeratePermutationGroup(group, { maxElements: 4, maxProducts: 4 }).map(
        (element) => element.images
      )
    );
    expect(() => finitePermutationModel(group, 3, work())).toThrow(
      'finite-group-element-limit'
    );
    // The shared traversal must retain the finite model's larger work envelope,
    // independently of the public closure API's 100,000-product ceiling.
    const repeated = new PermutationGroupValue(
      Array.from({ length: 1024 }, () =>
        PermutationValue.fromImages(
          Array.from({ length: 128 }, (_, i) => ((i + 1) % 128) + 1)
        )
      ),
      new PermutationAction(128)
    );
    const repeatedLedger = work(20_000_000);
    expect(
      finitePermutationModel(repeated, 128, repeatedLedger).table.order
    ).toBe(128);
    expect(repeatedLedger.used).toBeLessThan(20_000_000);
    const sentinel = new Error('cancel');
    expect(() =>
      finitePermutationModel(
        group,
        4,
        new GroupWork(100, () => {
          throw sentinel;
        })
      )
    ).toThrow(sentinel);
    expect(new GroupInputError('bad').name).toBe('GroupInputError');
    expect(new GroupLimitError('limit').name).toBe('GroupLimitError');
  });
});
