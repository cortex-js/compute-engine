import {
  finiteAbelianInvariants,
  finiteEulerianFunction,
  finiteMinimalGenerators,
  finiteIndependentAbelianGenerators,
  finiteCommutatorLength,
  finiteSubgroupConjugacyClasses,
  FiniteGroupHomomorphism,
  finiteAutomorphisms,
  finiteIsCharacteristic,
  finiteComplementRepresentatives,
  finiteGroupSeries,
  finiteHallSubgroups,
  finitePCentralSeries,
  finitePowerSubgroup,
  finiteRationalClasses,
} from '../../src/compute-engine/group-theory/finite-structure';
import { FiniteModuloPcgs } from '../../src/compute-engine/group-theory/polycyclic-quotient';
import {
  finitePcgsBySeries,
  finitePcOrbitStabilizer,
} from '../../src/compute-engine/group-theory/polycyclic-actions';

import {
  ExactMatrixField,
  ExactMatrixValue,
  ExactMatrixGroup,
  naturalLinearGroup,
  isNaturalLinearGroup,
  primeFieldMatrixGroupOrder,
  invariantRationalGroupLattice,
} from '../../src/compute-engine/group-theory/matrix';
import {
  FiniteGroupTable,
  GroupInputError,
  GroupLimitError,
  GroupWork,
  finitePermutationModel,
} from '../../src/compute-engine/group-theory/finite-group';
import {
  PermutationValue,
  PermutationAction,
} from '../../src/compute-engine/group-theory/permutation/values';
import { PermutationGroupValue } from '../../src/compute-engine/group-theory/permutation/groups';
import { FinitePcgs } from '../../src/compute-engine/group-theory/polycyclic';
const work = () => new GroupWork(50000000);
function model(gens: number[][], degree = gens[0]?.length ?? 0) {
  const w = work();
  const g = new PermutationGroupValue(
    gens.map((x) => PermutationValue.fromImages(x)),
    new PermutationAction(degree)
  );
  return { ...finitePermutationModel(g, 256, w), w };
}
const s3 = () =>
  model([
    [2, 1, 3],
    [2, 3, 1],
  ]);
const s4 = () =>
  model([
    [2, 1, 3, 4],
    [2, 3, 4, 1],
  ]);
const d8 = () =>
  model([
    [2, 3, 4, 1],
    [1, 4, 3, 2],
  ]);
const c4 = () => model([[2, 3, 4, 1]]);

describe('certified finite groups', () => {
  test('rejects malformed tables and a nonassociative loop', () => {
    for (const t of [
      [],
      [[1]],
      [
        [0, 1],
        [1, 1],
      ],
      [
        [0, 1],
        [1, -1],
      ],
      [
        [0, 1],
        [1, 0, 2],
      ],
    ])
      expect(() => FiniteGroupTable.fromTable(t, work())).toThrow(
        GroupInputError
      );
    // This reduced Latin square is a loop with two-sided inverses, but not a group.
    const loop = [
      [0, 1, 2, 3, 4],
      [1, 0, 3, 4, 2],
      [2, 4, 0, 1, 3],
      [3, 2, 4, 0, 1],
      [4, 3, 1, 2, 0],
    ];
    expect(() => FiniteGroupTable.fromTable(loop, work())).toThrow(
      'nonassociative'
    );
  });
  test('all S3 subgroup, normal and coset facts', () => {
    const { table, w, indexOf } = s3(),
      s = table.session(w),
      a = s.generated([indexOf(PermutationValue.fromImages([2, 3, 1]))!]),
      h = s.generated([indexOf(PermutationValue.fromImages([2, 1]))!]);
    expect(
      s
        .subgroups()
        .map((h) => h.order)
        .sort()
    ).toEqual([1, 2, 2, 2, 3, 6]);
    expect(
      s
        .normalSubgroups()
        .map((h) => h.order)
        .sort()
    ).toEqual([1, 3, 6]);
    expect(s.isNormal(s.whole, a)).toBe(true);
    expect(s.isNormal(s.whole, h)).toBe(false);
    expect(s.center().order).toBe(1);
    expect(s.derived().order).toBe(3);
    expect(s.normalizer(s.whole, h).order).toBe(2);
    expect(s.centralizer(s.whole, a).order).toBe(3);
    expect(s.normalClosure(s.whole, h).order).toBe(6);
    expect(s.core(s.whole, h).order).toBe(1);
    expect(s.isSubnormal(s.whole, h)).toBe(false);
    expect(s.isSubnormal(s.whole, a)).toBe(true);
    expect(s.rightCosets(s.whole, h).map((x) => x.length)).toEqual([2, 2, 2]);
    expect(
      s
        .doubleCosets(s.whole, h, h)
        .map((x) => x.length)
        .sort()
    ).toEqual([2, 4]);
    expect(
      s
        .conjugacyClasses()
        .map((x) => x.length)
        .sort()
    ).toEqual([1, 2, 3]);
    expect(s.sylow(s.whole, 2).order).toBe(2);
    expect(s.pCore(s.whole, 3).order).toBe(3);
    expect(s.frattini().order).toBe(1);
    expect(s.radical().order).toBe(6);
    expect(s.radical(s.whole, 'fitting').order).toBe(3);
    expect(s.radical(s.whole, 'socle').order).toBe(3);
  });
  test.each([
    [s3, [6, 3, 1], false],
    [d8, [8, 2, 1], true],
    [s4, [24, 12, 4, 1], false],
  ] as const)(
    'derived and central series on known groups',
    (factory, orders, nilpotent) => {
      const { table, w } = factory(),
        s = table.session(w);
      expect(s.series('derived').map((h) => h.order)).toEqual(orders);
      expect(s.isSolvable()).toBe(true);
      expect(s.isNilpotent()).toBe(nilpotent);
    }
  );
  test('D8 upper central series, Frattini and quotient', () => {
    const { table, w } = d8(),
      s = table.session(w);
    expect(s.series('upper-central').map((h) => h.order)).toEqual([1, 2, 8]);
    expect(s.frattini().order).toBe(2);
    const q = s.quotient(s.whole, s.center()),
      t = q.group.session(w);
    expect(t.isAbelian()).toBe(true);
    expect(t.isCyclic()).toBe(false);
    for (let a = 0; a < table.order; a++)
      for (let b = 0; b < table.order; b++)
        expect(q.projection[s.mul(a, b)]).toBe(
          t.mul(q.projection[a], q.projection[b])
        );
  });
  test('subgroup domains are explicit', () => {
    const a = s3(),
      b = s3(),
      s = a.table.session(a.w);
    expect(() => s.index(s.whole, b.table.session(b.w).trivial)).toThrow(
      'incompatible'
    );
  });
  test('word factorization reconstructs every S4 element', () => {
    const { table, w, indexOf } = s4(),
      s = table.session(w),
      gens = [
        indexOf(PermutationValue.fromImages([2, 1]))!,
        indexOf(PermutationValue.fromImages([2, 3, 4, 1]))!,
      ];
    for (let x = 0; x < table.order; x++) {
      const word = s.factorization(gens, x)!;
      expect(word.reduce((a, i) => s.mul(a, gens[i - 1]), 0)).toBe(x);
    }
  });
  test('work limits, subgroup limits and cancellation do not return partial facts', () => {
    expect(() => FiniteGroupTable.fromTable([[0]], new GroupWork(0))).toThrow(
      GroupLimitError
    );
    const { table, w } = s3();
    expect(() => table.session(w).subgroups(undefined, 1)).toThrow(
      GroupLimitError
    );
    const sentinel = new Error('cancel');
    expect(() =>
      FiniteGroupTable.fromTable(
        [[0]],
        new GroupWork(100, () => {
          throw sentinel;
        })
      )
    ).toThrow(sentinel);
  });
});

describe('checked finite polycyclic sequences', () => {
  test.each([s3, s4, d8, c4])(
    'computed pcgs round trip every element and multiplication',
    (factory) => {
      const { table, w } = factory(),
        pc = FinitePcgs.compute(table, w)!;
      expect(pc).toBeDefined();
      expect(pc.relativeOrders.reduce((a, b) => a * b, 1)).toBe(table.order);
      for (let x = 0; x < table.order; x++) {
        const v = pc.exponents(x, w);
        expect(pc.element(v, w)).toBe(x);
        expect(pc.head(x, 1, w)).toBe(0);
        expect(pc.head(x, pc.sequence.length + 1, w)).toBe(x);
        for (let y = 0; y < table.order; y++) {
          const z = table.product(x, y, w);
          expect(pc.element(pc.exponents(z, w), w)).toBe(z);
        }
      }
      expect(pc.depth(0, w)).toBe(pc.sequence.length + 1);
      expect(pc.leadingExponent(0, w)).toBe(0);
    }
  );
  test('rejects generators whose tails are not normal', () => {
    const { table, w, indexOf } = s3();
    expect(() =>
      FinitePcgs.fromSequence(
        table,
        [
          indexOf(PermutationValue.fromImages([2, 3, 1]))!,
          indexOf(PermutationValue.fromImages([2, 1]))!,
        ],
        w
      )
    ).toThrow('not-normal');
  });
  test('composite relative orders, signed powers and redundant identity', () => {
    const { table, w, indexOf } = c4(),
      g = indexOf(PermutationValue.fromImages([2, 3, 4, 1]))!,
      pc = FinitePcgs.fromSequence(table, [g, 0], w);
    expect(pc.relativeOrders).toEqual([4, 1]);
    expect(pc.relativeOrder(table.product(g, g, w), w)).toBe(2);
    expect(pc.linearCombination([-1n, 10n], w)).toBe(table.inverse(g));
    expect(() => pc.element([4, 0], w)).toThrow('range');
    const s = table.session(w),
      h = s.generated([s.pow(g, 2n)]),
      ip = pc.induced(h, w);
    expect(ip.relativeOrders).toEqual([2]);
    expect(pc.leadingExponent(ip.sequence[0], w)).toBe(2);
    expect(ip.sift(s.pow(g, 2n), w)).toBe(0);
  });
  test('all S4 subgroups have induced sequences, with exact membership by sifting', () => {
    const { table, w } = s4(),
      pc = FinitePcgs.compute(table, w)!,
      s = table.session(w);
    for (const h of s.subgroups()) {
      const ip = pc.induced(h, w);
      expect(ip.subgroup.members).toEqual(h.members);
      expect(ip.parent).toBe(pc);
      for (let x = 0; x < table.order; x++)
        expect(ip.sift(x, w) === 0).toBe(h.has(x));
    }
  });
  test('relative power, conjugate and commutator coordinates agree with table operations', () => {
    const { table, w } = s3(),
      pc = FinitePcgs.compute(table, w)!,
      s = table.session(w);
    for (let i = 1; i <= pc.sequence.length; i++)
      for (let j = 1; j <= pc.sequence.length; j++) {
        expect(pc.element(pc.specialExponents('conjugate', i, j, w), w)).toBe(
          s.conjugate(pc.sequence[j - 1], pc.sequence[i - 1])
        );
        expect(pc.element(pc.specialExponents('commutator', i, j, w), w)).toBe(
          s.commutator(pc.sequence[i - 1], pc.sequence[j - 1])
        );
      }
    const q = pc.quotient(s.derived(), w);
    expect(q.pcgs.subgroup.order).toBe(2);
  });
  test('A5 is proved non-solvable and no pcgs is returned', () => {
    const { table, w } = model([
      [2, 3, 4, 5, 1],
      [2, 3, 1, 4, 5],
    ]);
    expect(table.order).toBe(60);
    expect(FinitePcgs.compute(table, w)).toBeUndefined();
  });
});

describe('exact matrix groups', () => {
  test('exact rational determinant and inverse', () => {
    const w = work(),
      f = new ExactMatrixField(),
      m = ExactMatrixValue.fromRows(
        f,
        [
          [1n, { numerator: 1n, denominator: 2n }],
          [0n, 1n],
        ],
        w
      );
    expect(m.multiply(m.inverse(w), w).key(w)).toBe(
      ExactMatrixValue.identity(f, 2, w).key(w)
    );
    expect(m.power(2n, w).rows[0][1]).toEqual({
      numerator: 1n,
      denominator: 1n,
    });
  });
  test('finite rational group and an infinite group stopped by its explicit bound', () => {
    const w = work(),
      f = new ExactMatrixField(),
      r = ExactMatrixValue.fromRows(
        f,
        [
          [0n, -1n],
          [1n, 0n],
        ],
        w
      ),
      g = new ExactMatrixGroup(f, 2, [r], w);
    expect(g.finiteModel(4, w).table.order).toBe(4);
    expect(g.isIntegral(w)).toBe(true);
    expect(g.isSubgroupSL(w)).toBe(true);
    const unipotent = ExactMatrixValue.fromRows(
      f,
      [
        [1n, 1n],
        [0n, 1n],
      ],
      w
    );
    expect(() =>
      new ExactMatrixGroup(f, 2, [unipotent], w).enumerate(8, w)
    ).toThrow(GroupLimitError);
    const half = ExactMatrixValue.fromRows(
      f,
      [[{ numerator: 1n, denominator: 2n }]],
      w
    );
    expect(new ExactMatrixGroup(f, 1, [half], w).isIntegral(w)).toBe(false);
  });
  test.each([
    [2, 2, false, 6],
    [2, 3, false, 48],
    [2, 3, true, 24],
    [1, 5, false, 4],
    [1, 5, true, 1],
  ] as const)('GL/SL(%i,%i) has the expected order', (n, p, sl, order) => {
    const w = work(),
      g = naturalLinearGroup(n, p, sl, w);
    expect(g.enumerate(256, w).length).toBe(order);
    expect(g.isSubgroupSL(w)).toBe(sl || p === 2);
  });
  test('matrix actions respect multiplication and projectivization loses scalars', () => {
    const w = work(),
      g = naturalLinearGroup(2, 3, false, w),
      v = g.action(false, 9, w),
      p = g.action(true, 4, w);
    expect(v.points.length).toBe(9);
    expect(p.points.length).toBe(4);
    expect(v.faithful).toBe(true);
    expect(p.faithful).toBeUndefined();
    expect(naturalLinearGroup(2, 2, false, w).action(true, 3, w).faithful).toBe(
      true
    );
    expect(finitePermutationModel(v.group, 256, w).table.order).toBe(48);
    expect(finitePermutationModel(p.group, 256, w).table.order).toBe(24);
    const a = g.generators[0],
      b = g.generators[1],
      x = [1n, 2n];
    expect(a.multiply(b, w).act(x, w)).toEqual(b.act(a.act(x, w), w));
  });
  test('basis of invariant bilinear forms satisfies every generator equation', () => {
    for (const p of [0, 2, 3]) {
      const w = work(),
        f = new ExactMatrixField(p),
        a = ExactMatrixValue.fromRows(
          f,
          [
            [0n, 1n],
            [1n, 0n],
          ],
          w
        ),
        g = new ExactMatrixGroup(f, 2, [a], w),
        forms = g.invariantBilinearForms(w);
      expect(forms.length).toBe(2);
      for (const b of forms)
        expect(a.multiply(b, w).multiply(a.transpose(w), w).key(w)).toBe(
          b.key(w)
        );
    }
  });
  test('domain, singularity, field denominator, shape and resource boundaries', () => {
    const w = work(),
      q = new ExactMatrixField(),
      f = new ExactMatrixField(3),
      id = ExactMatrixValue.identity(q, 2, w);
    expect(() => id.multiply(ExactMatrixValue.identity(f, 2, w), w)).toThrow(
      'incompatible'
    );
    expect(() => new ExactMatrixField(9)).toThrow(GroupInputError);
    expect(() =>
      ExactMatrixValue.fromRows(f, [[{ numerator: 1n, denominator: 3n }]], w)
    ).toThrow('denominator');
    const zero = ExactMatrixValue.fromRows(q, [[0n]], w);
    expect(() => new ExactMatrixGroup(q, 1, [zero], w)).toThrow('singular');
    expect(() => ExactMatrixValue.fromRows(q, [[1n, 0n]], w)).toThrow('square');
    expect(() => ExactMatrixValue.fromRows(q, [[1n << 4096n]], w)).toThrow(
      GroupLimitError
    );
    expect(() =>
      naturalLinearGroup(3, 3, false, w).action(false, 26, w)
    ).toThrow(GroupLimitError);
  });
});

describe('finite structural algorithms and homomorphism certificates', () => {
  test('automorphisms and characteristic subgroups', () => {
    for (const [factory, size] of [
      [s3, 6],
      [c4, 2],
    ] as const) {
      const { table, w } = factory(),
        S = table.session(w),
        autos = finiteAutomorphisms(S);
      expect(autos.length).toBe(size);
      for (const a of autos)
        expect(a.then(a.inverse(w), w).images).toEqual(
          Array.from({ length: table.order }, (_, i) => i)
        );
      expect(finiteIsCharacteristic(S, S.derived())).toBe(true);
    }
    const { table, w } = s3(),
      S = table.session(w),
      h = S.sylow(S.whole, 2);
    expect(finiteIsCharacteristic(S, h)).toBe(false);
  });
  test('invalid maps, cross-domain composition and automorphism limits', () => {
    const { table, w } = s3();
    expect(() =>
      FiniteGroupHomomorphism.fromImages(table, table, [0, 1, 2, 3, 4, 4], w)
    ).toThrow('not-a-group-homomorphism');
    const id = FiniteGroupHomomorphism.fromImages(
        table,
        table,
        [0, 1, 2, 3, 4, 5],
        w
      ),
      other = s3().table;
    expect(() =>
      id.then(
        FiniteGroupHomomorphism.fromImages(other, other, [0, 1, 2, 3, 4, 5], w),
        w
      )
    ).toThrow('incompatible');
    expect(() => finiteAutomorphisms(table.session(w), 1)).toThrow(
      GroupLimitError
    );
  });
  test('Hall subgroups, complement classes, chief and composition series', () => {
    const { table, w } = s3(),
      S = table.session(w),
      derived = S.derived();
    expect(finiteHallSubgroups(S, S.whole, [2]).length).toBe(3);
    expect(finiteHallSubgroups(S, S.whole, [3])[0].order).toBe(3);
    expect(
      finiteComplementRepresentatives(S, S.whole, derived).map((h) => h.order)
    ).toEqual([2]);
    for (const kind of ['chief', 'composition', 'supersolvable'] as const)
      expect(finiteGroupSeries(S, kind)!.map((h) => h.order)).toEqual([
        6, 3, 1,
      ]);
    const a4 = model([
        [2, 3, 1, 4],
        [2, 1, 4, 3],
      ]),
      A = a4.table.session(a4.w);
    expect(finiteGroupSeries(A, 'supersolvable')).toBeUndefined();
    expect(finiteGroupSeries(A, 'chief')!.map((h) => h.order)).toEqual([
      12, 4, 1,
    ]);
  });
  test('p-central series, omega, agemo and rational classes', () => {
    const { table, w } = d8(),
      S = table.session(w);
    expect(finitePCentralSeries(S, S.whole, 2).map((h) => h.order)).toEqual([
      8, 2, 1,
    ]);
    expect(finitePowerSubgroup(S, S.whole, 2, 1, 'agemo').order).toBe(2);
    expect(finitePowerSubgroup(S, S.whole, 2, 1, 'omega').order).toBe(8);
    const c = c4();
    expect(
      finiteRationalClasses(c.table.session(c.w))
        .map((c) => c.length)
        .sort()
    ).toEqual([1, 1, 2]);
  });
});
describe('polycyclic quotient, series and action certificates', () => {
  test('S4 acts by inversion on its A4/V4 section', () => {
    const { table, w, indexOf } = s4(),
      S = table.session(w),
      pc = FinitePcgs.compute(table, w)!,
      a4 = S.derived(),
      v4 = S.derived(a4),
      mod = new FiniteModuloPcgs(pc, a4, v4, w),
      swap = indexOf(PermutationValue.fromImages([2, 1]))!;
    expect(mod.pcgs.relativeOrders).toEqual([3]);
    expect(mod.linearAction(swap, w).rows[0][0].numerator).toBe(2n);
    for (const x of a4.members) {
      const lifted = mod.element(mod.exponents(x, w), w);
      expect(mod.project(lifted, w)).toBe(mod.project(x, w));
    }
    const projected = mod.projectSubgroup(v4, w);
    expect(projected.subgroup.order).toBe(1);
    expect(mod.liftSubgroup(projected.subgroup, w).subgroup.members).toEqual(
      v4.members
    );
    const translation = mod.lifts[0],
      affine = mod.affineAction(swap, translation, w);
    expect(affine.act([1n, 1n], w).map((q) => q.numerator)).toEqual([0n, 1n]);
  });
  test('quotients reject nonnormal denominators and non-elementary sections', () => {
    const { table, w } = s3(),
      S = table.session(w),
      pc = FinitePcgs.compute(table, w)!;
    expect(
      () => new FiniteModuloPcgs(pc, S.whole, S.sylow(S.whole, 2), w)
    ).toThrow('invalid-pc-quotient');
    expect(() =>
      new FiniteModuloPcgs(pc, S.whole, S.trivial, w).linearAction(0, w)
    ).toThrow('elementary');
  });
  test('refined pcgs retains every supplied subnormal-series boundary', () => {
    const { table, w } = s4(),
      S = table.session(w),
      series = S.series('derived'),
      result = finitePcgsBySeries(series, w)!;
    result.boundaries.forEach((start, i) =>
      expect(result.pcgs.series[start - 1].members).toEqual(series[i].members)
    );
    const mod = new FiniteModuloPcgs(result.pcgs, S.whole, S.trivial, w);
    expect(mod.pcgs.subgroup.order).toBe(24);
  });
  test('pcgs orbit-stabilizer has original group witnesses, and rejects a corrupt action', () => {
    const { table, w, elements } = s4(),
      pc = FinitePcgs.compute(table, w)!,
      action = new PermutationAction(4),
      result = finitePcOrbitStabilizer(pc, elements, action, 1, w);
    expect([...result.points].sort()).toEqual([1, 2, 3, 4]);
    expect(result.stabilizer.subgroup.order).toBe(6);
    result.points.forEach((point, i) =>
      expect(elements[result.representatives[i]].images[0] ?? 1).toBe(point)
    );
    const damaged = [...elements];
    damaged[1] = PermutationValue.fromImages([]);
    expect(() => finitePcOrbitStabilizer(pc, damaged, action, 1, w)).toThrow(
      'not-a-homomorphism'
    );
  });
  test('canonical cosets and two-subgroup factorization', () => {
    const { table, w } = s3(),
      S = table.session(w),
      pc = FinitePcgs.compute(table, w)!,
      h = S.sylow(S.whole, 2),
      ip = pc.induced(h, w),
      jp = pc.induced(S.derived(), w);
    for (let x = 0; x < table.order; x++) {
      const representative = ip.canonical(x, w);
      for (const a of h.members)
        expect(ip.canonical(S.mul(a, x), w)).toBe(representative);
      const [a, b] = ip.factorThrough(jp, x, w)!;
      expect(S.mul(a, b)).toBe(x);
      expect(h.has(a)).toBe(true);
    }
  });
});
describe('matrix recognition, quadratic forms and rational lattices', () => {
  test('GL(4,2) order and recognition do not enumerate its 20160 elements', () => {
    const w = work(),
      g = naturalLinearGroup(4, 2, false, w);
    expect(primeFieldMatrixGroupOrder(g, 16, w)).toBe(20160n);
    expect(isNaturalLinearGroup(g, false, 16, w)).toBe(true);
    const c = new ExactMatrixGroup(g.field, 4, [g.generators[0]], w);
    expect(isNaturalLinearGroup(c, false, 16, w)).toBe(false);
  });
  test('quadratic forms satisfy invariance in characteristic two and three', () => {
    for (const p of [2, 3]) {
      const w = work(),
        F = new ExactMatrixField(p),
        g = new ExactMatrixGroup(
          F,
          2,
          [
            ExactMatrixValue.fromRows(
              F,
              [
                [0n, 1n],
                [1n, 0n],
              ],
              w
            ),
          ],
          w
        ),
        forms = g.invariantQuadraticForms(w);
      expect(forms.length).toBe(2);
      const evaluate = (B: ExactMatrixValue, v: readonly bigint[]) => {
        let value = 0n;
        for (let i = 0; i < 2; i++)
          for (let j = i; j < 2; j++)
            value += v[i] * B.rows[i][j].numerator * v[j];
        return value % BigInt(p);
      };
      for (const B of forms)
        for (let i = 0; i < p; i++)
          for (let j = 0; j < p; j++) {
            const v = [BigInt(i), BigInt(j)],
              image = g.generators[0].act(v, w).map((x) => x.numerator);
            expect(evaluate(B, v)).toBe(evaluate(B, image));
          }
    }
  });
  test('finite rational group lattice makes every generator integral', () => {
    const w = work(),
      F = new ExactMatrixField(),
      g = new ExactMatrixGroup(
        F,
        2,
        [
          ExactMatrixValue.fromRows(
            F,
            [
              [0n, 2n],
              [{ numerator: 1n, denominator: 2n }, 0n],
            ],
            w
          ),
        ],
        w
      ),
      B = invariantRationalGroupLattice(g, 2, w),
      inverse = B.inverse(w);
    const integral = new ExactMatrixGroup(
      F,
      2,
      g.generators.map((x) => B.multiply(x, w).multiply(inverse, w)),
      w
    );
    expect(integral.isIntegral(w)).toBe(true);
    expect(integral.enumerate(2, w).length).toBe(2);
  });
  test('sparse rows and oversized action storage cannot create validated values', () => {
    expect(() =>
      ExactMatrixValue.fromRows(new ExactMatrixField(), [Array(1)], work())
    ).toThrow(GroupInputError);
    expect(() => FiniteGroupTable.fromTable([Array(1)], work())).toThrow(
      GroupInputError
    );
    const w = work(),
      F = new ExactMatrixField(2),
      id = ExactMatrixValue.identity(F, 14, w),
      g = new ExactMatrixGroup(F, 14, Array(100).fill(id), w);
    expect(() => g.action(false, 16384, w)).toThrow('storage-limit');
  });
});

describe('abelian coordinates and exact generating data', () => {
  test('positive and negative exponents share the exact bit boundary', () => {
    const { table, w } = c4(),
      S = table.session(w);
    expect(() => S.pow(1, 1n << 16384n)).toThrow('invalid-group-exponent');
    expect(() => S.pow(1, -(1n << 16384n))).toThrow('invalid-group-exponent');
    expect(S.pow(1, 1n << 16383n)).toBe(0);
  });
  test('primary abelian invariants include the abelianization of nonabelian groups', () => {
    for (const [factory, invariants] of [
      [s3, [2]],
      [s4, [2]],
      [d8, [2, 2]],
      [c4, [4]],
    ] as const) {
      const { table, w } = factory();
      expect(finiteAbelianInvariants(table.session(w))).toEqual(invariants);
    }
  });
  test('independent generators of C4 x C2 give unique coordinates with the correct orders', () => {
    const { table, w } = model([
        [2, 3, 4, 1, 5, 6],
        [1, 2, 3, 4, 6, 5],
      ]),
      S = table.session(w),
      gens = finiteIndependentAbelianGenerators(S),
      pc = FinitePcgs.fromSequence(table, gens, w);
    expect(gens.map((x) => S.elementOrder(x))).toEqual([2, 4]);
    expect(pc.relativeOrders).toEqual([2, 4]);
    expect(pc.subgroup.order).toBe(8);
    for (let x = 0; x < table.order; x++)
      expect(pc.element(pc.exponents(x, w), w)).toBe(x);
  });
  test('tuple counts, minimal generators, commutator length, and conjugacy of subgroups', () => {
    const { table, w, indexOf } = s3(),
      S = table.session(w);
    expect(finiteEulerianFunction(S, 2)).toBe(18n);
    expect(finiteEulerianFunction(S, 0)).toBe(0n);
    expect(finiteMinimalGenerators(S).length).toBe(2);
    expect(
      finiteCommutatorLength(
        S,
        indexOf(PermutationValue.fromImages([2, 3, 1]))!
      )
    ).toBe(1);
    expect(
      finiteCommutatorLength(S, indexOf(PermutationValue.fromImages([2, 1]))!)
    ).toBeUndefined();
    expect(
      finiteSubgroupConjugacyClasses(S)
        .map((c) => c.length)
        .sort()
    ).toEqual([1, 1, 1, 3]);
    const c = c4();
    expect(finiteEulerianFunction(c.table.session(c.w), 2)).toBe(12n);
  });
});
