import { ComputeEngine } from '../../src/compute-engine';
import { loadGroupTheory } from '../../src/compute-engine/library/group-theory';
import {
  FiniteGroupTable,
  FiniteGroupSession,
  GroupWork,
  finitePermutationModel,
} from '../../src/compute-engine/group-theory/finite-group';
import { FinitePcgs } from '../../src/compute-engine/group-theory/polycyclic';
import {
  PermutationValue,
  PermutationAction,
} from '../../src/compute-engine/group-theory/permutation/values';
import { PermutationGroupValue } from '../../src/compute-engine/group-theory/permutation/groups';
import { PermutationQuerySession } from '../../src/compute-engine/group-theory/permutation/query-session';
import { PermutationStabilizerChain } from '../../src/compute-engine/group-theory/permutation/stabilizer-chain';
import type { MathJsonExpression } from '../../src/math-json/types';

const budget = 50000000;
const work = () => new GroupWork(budget);
function symmetric(n: number) {
  return new PermutationGroupValue(
    [
      PermutationValue.fromImages([2, 1]),
      PermutationValue.fromImages(
        Array.from({ length: n }, (_, i) => ((i + 1) % n) + 1)
      ),
    ],
    new PermutationAction(n)
  );
}
function descriptor(n: number): MathJsonExpression {
  return [
    'PermutationGroup',
    [
      'List',
      ['Permutation', ['List', 2, 1]],
      [
        'Permutation',
        ['List', ...Array.from({ length: n }, (_, i) => ((i + 1) % n) + 1)],
      ],
    ],
    ['PermutationAction', n],
  ];
}
function referenceClosure(
  rows: readonly (readonly number[])[],
  generators: readonly number[]
): number[] {
  const result = [0],
    seen = new Set(result);
  for (let i = 0; i < result.length; i++)
    for (const g of generators) {
      const y = rows[result[i]][g];
      if (!seen.has(y)) {
        seen.add(y);
        result.push(y);
      }
    }
  return result.sort((a, b) => a - b);
}
function referenceLattice(rows: readonly (readonly number[])[]) {
  const result = [[0]],
    seen = new Set(['0']);
  for (let i = 0; i < result.length; i++)
    for (let x = 0; x < rows.length; x++) {
      const h = referenceClosure(rows, [...result[i], x]),
        key = h.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        result.push(h);
      }
    }
  return result.map((h) => h.join(',')).sort();
}
describe('group algorithm refinements and resource invariants', () => {
  test('subgroup extensions agree with independent exhaustive S4 enumeration', () => {
    const { table } = finitePermutationModel(symmetric(4), 256, work()),
      s = table.session(work());
    expect(
      s
        .subgroups()
        .map((h) => h.members.join(','))
        .sort()
    ).toEqual(referenceLattice(table.rows));
    for (const h of s.subgroups()) {
      expect(referenceClosure(table.rows, h.generators)).toEqual(h.members);
      expect(h.generators.length).toBeLessThanOrEqual(Math.log2(h.order));
      const normalizer = s.whole.members.filter((x) =>
        h.members.every((a) =>
          h.has(table.rows[table.rows[table.inverse(x)][a]][x])
        )
      );
      expect(s.normalizer(s.whole, h).members).toEqual(normalizer);
      expect(s.isNormal(s.whole, h)).toBe(normalizer.length === 24);
    }
  });
  test('all pairs of S4 generators retain exact closures', () => {
    const { table } = finitePermutationModel(symmetric(4), 256, work()),
      s = table.session(work());
    for (let a = 0; a < 24; a++)
      for (let b = 0; b < 24; b++)
        expect(s.generated([a, b, a, 0]).members).toEqual(
          referenceClosure(table.rows, [a, b])
        );
  });
  test('private membership words cover signed bit boundaries and preserve domains', () => {
    const rows = Array.from({ length: 256 }, (_, i) =>
      Array.from({ length: 256 }, (_, j) => (i + j) % 256)
    );
    const table = FiniteGroupTable.fromTable(rows, work()),
      s = table.session(work()),
      h = s.generated([1]);
    for (const x of [0, 31, 32, 63, 127, 255]) expect(h.has(x)).toBe(true);
    expect(() => h.has(256)).toThrow('invalid-group-element');
    expect(() => h.has(-1)).toThrow('invalid-group-element');
    expect(() =>
      s.receive(FiniteGroupTable.fromTable(rows, work()).session(work()).whole)
    ).toThrow('incompatible');
  });
  test('complete session lattices reuse results but preserve caps and cancellation', () => {
    const { table } = finitePermutationModel(symmetric(4), 256, work());
    let cancelled = false;
    const w = new GroupWork(budget, () => {
        if (cancelled) throw new Error('cancelled');
      }),
      s = table.session(w);
    expect(() => s.subgroups(s.whole, 2)).toThrow('subgroup-count-limit');
    const all = s.subgroups(),
      before = w.used;
    expect(all.length).toBe(30);
    expect(s.subgroups()).toBe(all);
    expect(w.used - before).toBeLessThan(100);
    expect(() => s.subgroups(s.whole, 29)).toThrow('subgroup-count-limit');
    cancelled = true;
    expect(() => s.subgroups()).toThrow('cancelled');
  });
  test('elementary abelian lattice is complete', () => {
    const n = 64,
      table = FiniteGroupTable.fromTable(
        Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (_, j) => i ^ j)
        ),
        work()
      );
    expect(table.session(work()).subgroups()).toHaveLength(2825);
  });
  test.each([8, 12, 36])(
    'derived-factor refinement gives prime cyclic steps for C%i',
    (n) => {
      const table = FiniteGroupTable.fromTable(
        Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (_, j) => (i + j) % n)
        ),
        work()
      );
      const pc = FinitePcgs.compute(table, work())!;
      for (const r of pc.relativeOrders)
        for (let d = 2; d * d <= r; d++) expect(r % d).not.toBe(0);
      for (let x = 0; x < n; x++)
        expect(pc.element(pc.exponents(x, work()), work())).toBe(x);
    }
  );
  test('pcgs construction avoids the lattice even for C2^7', () => {
    const n = 128,
      table = FiniteGroupTable.fromTable(
        Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (_, j) => i ^ j)
        ),
        work()
      );
    const spy = jest
      .spyOn(FiniteGroupSession.prototype, 'subgroups')
      .mockImplementation(() => {
        throw Error('lattice must not be used');
      });
    try {
      const pc = FinitePcgs.compute(table, work())!;
      expect(pc.relativeOrders).toEqual(Array(7).fill(2));
      for (let x = 0; x < n; x++)
        expect(pc.element(pc.exponents(x, work()), work())).toBe(x);
    } finally {
      spy.mockRestore();
    }
  });
  test('representation-built tables equal fully validated tables without cubic work', () => {
    const w = work(),
      m = finitePermutationModel(symmetric(5), 256, w);
    expect(w.used).toBeLessThan(120 ** 3);
    expect(FiniteGroupTable.fromTable(m.table.rows, work()).rows).toEqual(
      m.table.rows
    );
    expect(() =>
      FiniteGroupTable.fromPermutationGroup(
        Object.create(PermutationGroupValue.prototype),
        256,
        work()
      )
    ).toThrow();
    expect(() =>
      FiniteGroupTable.fromTable(
        [
          [0, 1],
          [1, 1],
        ],
        work()
      )
    ).toThrow();
  });
  test('chain sessions reuse verified results without bypassing caller limits', () => {
    const g = symmetric(5),
      session = new PermutationQuerySession(),
      limits = { maxWork: budget };
    const chain = session.chain(g, limits);
    expect(session.chain(symmetric(5), limits)).toBe(chain);
    expect(
      session.contains(g, PermutationValue.fromImages([2, 1]), limits)
    ).toBe(true);
    expect(() => session.chain(g, { maxWork: chain.workUsed - 1 })).toThrow(
      'work-limit'
    );
    expect(() =>
      session.contains(g, PermutationValue.fromImages([2, 1]), {
        maxWork: chain.workUsed,
      })
    ).toThrow('work-limit');
    expect(() => session.chain(g, { ...limits, maxStoredImages: 0 })).toThrow();
    expect(() => session.chain(g, limits, { maxDegree: 2 })).toThrow();
    expect(() =>
      session.chain(g, limits, {
        check: () => {
          throw Error('cancelled');
        },
      })
    ).toThrow('cancelled');
    expect(() =>
      session.contains(
        g,
        PermutationValue.fromImages([2, 3, 4, 5, 6, 1]),
        limits
      )
    ).toThrow();
    expect(new PermutationQuerySession().chain(g, limits)).not.toBe(chain);
  });
  test('chain reuse is bounded and keeps distinct action domains', () => {
    const session = new PermutationQuerySession(),
      limits = { maxWork: budget };
    const group = (degree: number) =>
      new PermutationGroupValue(
        [PermutationValue.fromImages([2, 1])],
        new PermutationAction(degree)
      );
    const first = session.chain(group(2), limits);
    expect(session.chain(group(3), limits)).not.toBe(first);
    for (let degree = 4; degree <= 10; degree++)
      session.chain(group(degree), limits);
    expect(session.chain(group(2), limits)).not.toBe(first);
    expect(session.order(group(2), limits)).toBe(2n);
  });
  test('indexed sifting agrees with exhaustive membership, including nonmembers', () => {
    const full = finitePermutationModel(symmetric(4), 256, work());
    const cyclic = new PermutationGroupValue(
      [PermutationValue.fromImages([2, 3, 4, 1])],
      new PermutationAction(4)
    );
    const model = finitePermutationModel(cyclic, 256, work()),
      chain = PermutationStabilizerChain.compute(cyclic, { maxWork: budget });
    for (const p of full.elements)
      expect(chain.sift(p, { maxWork: budget }).member).toBe(
        model.indexOf(p) !== undefined
      );
  });
  test.each(['canonical', 'structural', 'raw'] as const)(
    'generic dispatch works beyond finite enumeration in %s mode',
    (form) => {
      const ce = new ComputeEngine();
      loadGroupTheory(ce);
      const g = descriptor(20);
      expect(
        ce
          .box(['GroupOrder', g, { dict: { maxElements: 1 } }], { form })
          .evaluate().json
      ).toEqual(ce.number(2432902008176640000n).json);
      expect(
        ce
          .box(
            [
              'GroupContains',
              g,
              ['Permutation', ['List', 2, 1]],
              { dict: { maxElements: 1 } },
            ],
            { form }
          )
          .evaluate().json
      ).toBe('True');
      expect(
        ce
          .box(['GroupIsAbelian', g, { dict: { maxElements: 1 } }], { form })
          .evaluate().json
      ).toBe('False');
      for (const expr of [
        ['GroupOrder', g, { dict: { maxElements: 0 } }],
        ['GroupOrder', g, { dict: { maxElements: 257 } }],
        ['GroupOrder', g, { dict: { maxElements: 1, maxWork: 0 } }],
        [
          'GroupContains',
          g,
          ['Permutation', ['List', 1, 1]],
          { dict: { maxElements: 1 } },
        ],
      ] as MathJsonExpression[])
        expect(ce.box(expr, { form }).evaluate().has('Error')).toBe(true);
    }
  );
  test('generic subgroup queries bypass enumeration while preserving compatibility', () => {
    const ce = new ComputeEngine();
    loadGroupTheory(ce);
    const g = descriptor(10),
      h: MathJsonExpression = [
        'PermutationGroup',
        ['List', ['Permutation', ['List', 2, 1]]],
        ['PermutationAction', 10],
      ];
    for (const [name, expected] of [
      ['GroupIsSubgroup', 'True'],
      ['GroupEqual', 'False'],
      ['GroupIsNormal', 'False'],
      ['GroupIndex', 1814400],
    ] as [string, MathJsonExpression][])
      expect(
        ce.box([name, g, h, { dict: { maxElements: 1 } }]).evaluate().json
      ).toEqual(expected);
    expect(
      ce
        .box([
          'GroupIsSubgroup',
          g,
          descriptor(3),
          { dict: { maxElements: 1 } },
        ])
        .evaluate()
        .has('Error')
    ).toBe(true);
    const infinite: MathJsonExpression = [
      'MatrixGroup',
      1,
      0,
      ['List', ['GroupMatrix', 0, ['List', ['List', 2]]]],
    ];
    expect(
      ce
        .box(['GroupIsAbelian', infinite, { dict: { maxElements: 1 } }])
        .evaluate().json
    ).toBe('True');
  });
  test('generic matrix order uses the faithful action', () => {
    const ce = new ComputeEngine();
    loadGroupTheory(ce);
    expect(
      ce
        .box([
          'GroupOrder',
          ['GeneralLinearGroup', 4, 2],
          { dict: { maxElements: 1 } },
        ])
        .evaluate().json
    ).toBe(20160);
  });
});
