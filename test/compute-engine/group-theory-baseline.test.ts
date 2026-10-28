import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { toBigint } from '../../src/compute-engine/boxed-expression/numerics';
import { loadGroupTheory } from '../../src/compute-engine/library/group-theory';
import { CancellationError } from '../../src/common/interruptible';
import type { MathJsonExpression as MJ } from '../../src/math-json/types';
const p: MJ = ['Permutation', ['List', 2, 1]],
  q: MJ = ['Permutation', ['List', 1, 3, 2]],
  c: MJ = ['Permutation', ['List', 2, 3, 1]];
const G: MJ = ['PermutationGroup', ['List', p, q], ['PermutationAction', 3]],
  H: MJ = ['PermutationGroup', ['List', c], ['PermutationAction', 3]],
  K: MJ = ['PermutationGroup', ['List', p], ['PermutationAction', 3]];
const budget = 5_000_000;
function engine(options: Parameters<typeof loadGroupTheory>[1] = {}) {
  const ce = new ComputeEngine();
  loadGroupTheory(ce, options);
  return ce;
}
function run(ce: ComputeEngine, source: string) {
  const result = executeEpsil(ce, source);
  expect(result.diagnostics).toEqual([]);
  return result.value;
}

describe('Epsil finite permutation group baseline', () => {
  const ce = engine();
  test('a typed Epsil program computes exact order, membership, stabilizers and subgroup relationships', () => {
    expect(
      run(
        ce,
        `
function groupSize(g: PermutationGroup) -> integer { PermutationGroupOrder(g, options: {maxWork -> 5000000}) }
function contains(g: PermutationGroup,p: Permutation) -> boolean { PermutationGroupContains(g,p, options: {maxWork -> 5000000}) }
let G=PermutationGroup([Permutation([2,1]),Permutation([1,3,2])],PermutationAction(3))
let H=PermutationGroup([Permutation([2,3,1])],PermutationAction(3))
let S=PermutationPointStabilizer(G,1, options: {maxWork -> 5000000})
(groupSize(G),groupSize(S),contains(H,Permutation([2,1])),PermutationSubgroupIndex(G,H, options: {maxWork -> 5000000}),PermutationIsNormal(G,H, options: {maxWork -> 5000000}))
`
      ).json
    ).toEqual(['Tuple', 6, 2, 'False', 2, 'True']);
  });
  test.each(['canonical', 'raw', 'structural'] as const)(
    'all queries work through %s expressions',
    (form) => {
      const cases: [MJ, MJ][] = [
        [
          [
            'PermutationGroupOrder',
            G,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          6,
        ],
        [
          [
            'PermutationGroupContains',
            H,
            p,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          'False',
        ],
        [
          [
            'PermutationGroupContains',
            H,
            c,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          'True',
        ],
        [
          [
            'PermutationIsSubgroup',
            G,
            H,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          'True',
        ],
        [
          [
            'PermutationSubgroupIndex',
            G,
            H,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          2,
        ],
        [
          [
            'PermutationIsNormal',
            G,
            K,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          'False',
        ],
        [
          [
            'PermutationGroupEqual',
            G,
            H,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          'False',
        ],
        [
          [
            'PermutationGroupIsAbelian',
            H,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          'True',
        ],
        [
          [
            'PermutationGroupIsAbelian',
            G,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ],
          'False',
        ],
        [
          ['PermutationGroupGenerators', G],
          ['List', p, q],
        ],
        [
          ['PermutationGroupIdentity', G],
          ['Permutation', ['List']],
        ],
      ];
      for (const [input, expected] of cases)
        expect(ce.box(input, { form }).evaluate().json).toEqual(expected);
    }
  );
  test('exact S20 order survives MathJSON and a fresh engine', () => {
    const s20: MJ = [
      'PermutationGroup',
      [
        'List',
        p,
        [
          'Permutation',
          ['List', ...Array.from({ length: 20 }, (_, i) => ((i + 1) % 20) + 1)],
        ],
      ],
      ['PermutationAction', 20],
    ];
    const query: MJ = [
      'PermutationGroupOrder',
      s20,
      ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
    ];
    const result = ce.box(query).evaluate();
    expect(toBigint(result)).toBe(2432902008176640000n);
    const fresh = engine();
    expect(toBigint(fresh.box(JSON.parse(JSON.stringify(result.json))))).toBe(
      2432902008176640000n
    );
    expect(
      toBigint(fresh.box(JSON.parse(JSON.stringify(query))).evaluate())
    ).toBe(2432902008176640000n);
  });
  test('equal subgroups can have unequal descriptors without triggering an expensive equality handler', () => {
    const other: MJ = [
      'PermutationGroup',
      ['List', c, p],
      ['PermutationAction', 3],
    ];
    expect(ce.box(G).isSame(ce.box(other))).toBe(false);
    expect(ce.box(G).isEqual(ce.box(other))).toBeUndefined();
    expect(
      ce
        .box([
          'PermutationGroupEqual',
          G,
          other,
          ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
        ])
        .evaluate().json
    ).toBe('True');
  });
  test('cycle operations support exact signed and large exponents', () => {
    expect(ce.box(['PermutationCycles', c]).evaluate().json).toEqual([
      'List',
      ['List', 1, 2, 3],
    ]);
    expect(ce.box(['PermutationOrder', c]).evaluate().json).toBe(3);
    expect(ce.box(['PermutationPower', c, -1]).evaluate().json).toEqual([
      'Permutation',
      ['List', 3, 1, 2],
    ]);
    const huge = 10n ** 100n + 1n;
    expect(
      ce.function('PermutationPower', [ce.box(c), ce.number(huge)]).evaluate()
        .json
    ).toEqual(
      ce.box(['PermutationPower', c, Number(huge % 3n)]).evaluate().json
    );
    expect(ce.box(['PermutationConjugate', p, q]).evaluate().json).toEqual([
      'Permutation',
      ['List', 3, 2, 1],
    ]);
    expect(ce.box(['PermutationCommutator', p, q]).evaluate().json).toEqual(c);
  });
  test('fractional and non-real exponents cannot bypass validation by disabling static checks', () => {
    const loose = engine();
    loose.strict = false;
    for (const exp of [
      0.5,
      ['Rational', 3, 2],
      'Infinity',
      'NaN',
      'ImaginaryUnit',
    ] satisfies MJ[])
      expect(
        loose.box(['PermutationPower', c, exp], { form: 'raw' }).evaluate()
          .operator
      ).toBe('Error');
  });
  test('forged data are rejected by scalar and group consumers', () => {
    const loose = engine();
    loose.strict = false;
    const forged: MJ = [
      'PermutationGroup',
      ['List', ['Permutation', ['List', 2, 2]]],
      ['PermutationAction', 3],
    ];
    for (const input of [
      [
        'PermutationGroupOrder',
        forged,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      [
        'PermutationGroupContains',
        G,
        ['Permutation', ['List', 1, 1]],
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      [
        'PermutationPointStabilizer',
        forged,
        1,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      [
        'PermutationIsSubgroup',
        G,
        forged,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      [
        'PermutationSubgroupIndex',
        forged,
        H,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      [
        'PermutationGroupEqual',
        forged,
        H,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      [
        'PermutationIsNormal',
        G,
        forged,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      [
        'PermutationGroupIsAbelian',
        forged,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ],
      ['PermutationGroupIdentity', forged],
      ['PermutationGroupGenerators', forged],
      ['PermutationOrder', ['Permutation', ['List', 1, 1]]],
    ] satisfies MJ[])
      for (const form of ['canonical', 'raw', 'structural'] as const)
        expect(loose.box(input, { form }).evaluate().operator).toBe('Error');
  });
  test('nonmembers, action mismatches and an undefined subgroup index stay distinct', () => {
    expect(
      ce
        .box([
          'PermutationGroupContains',
          H,
          p,
          ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
        ])
        .evaluate().json
    ).toBe('False');
    expect(
      JSON.stringify(
        ce
          .box([
            'PermutationSubgroupIndex',
            H,
            G,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ])
          .evaluate().json
      )
    ).toContain('not-a-permutation-subgroup');
    const other: MJ = [
      'PermutationGroup',
      ['List', p],
      ['PermutationAction', 4],
    ];
    expect(
      JSON.stringify(
        ce
          .box([
            'PermutationIsSubgroup',
            G,
            other,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ])
          .evaluate().json
      )
    ).toContain('incompatible-permutation-actions');
    expect(
      ce
        .box([
          'PermutationPointStabilizer',
          G,
          0,
          ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
        ])
        .evaluate().operator
    ).toBe('Error');
  });
  test('no query runs during boxing and exhaustion is never mathematical false', () => {
    for (const input of [
      [
        'PermutationGroupOrder',
        G,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, 0]],
      ],
      [
        'PermutationGroupContains',
        H,
        p,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, 0]],
      ],
      [
        'PermutationIsSubgroup',
        H,
        G,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, 0]],
      ],
      [
        'PermutationIsNormal',
        G,
        K,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, 0]],
      ],
      [
        'PermutationGroupIsAbelian',
        G,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, 0]],
      ],
      [
        'PermutationPointStabilizer',
        G,
        1,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, 0]],
      ],
    ] satisfies MJ[]) {
      const query = ce.box(input);
      expect(query.operator).not.toBe('Error');
      expect(query.hash).toBe(ce.box(query.json).hash);
      expect(query.toString()).toBeTruthy();
      expect(query.evaluate().operator).toBe('Error');
      expect(JSON.stringify(query.evaluate().json)).toContain(
        'permutation-chain-work-limit'
      );
    }
    expect(
      ce
        .box([
          'PermutationGroupOrder',
          G,
          ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
        ])
        .evaluate().json
    ).toBe(6);
  });
  test('receiver limits and invalid installation options are enforced', () => {
    for (const options of [
      { maxChainLevels: 0 },
      { maxChainOrbitPoints: 2 },
      { maxChainStoredImages: 0 },
      { maxDegree: 2 },
      { maxGenerators: 1 },
    ])
      expect(
        engine(options)
          .box([
            'PermutationGroupOrder',
            G,
            ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
          ])
          .evaluate().operator
      ).toBe('Error');
    const fresh = new ComputeEngine();
    expect(() => loadGroupTheory(fresh, { maxChainLevels: -1 })).toThrow();
    expect(fresh.lookupDefinition('Permutation')).toBeUndefined();
  });
  test('symbolic arguments defer and evaluate after assignment', () => {
    const fresh = engine();
    fresh.declare('savedG', 'PermutationGroup');
    const query = fresh.box([
      'PermutationGroupOrder',
      'savedG',
      ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
    ]);
    expect(query.evaluate().operator).toBe('PermutationGroupOrder');
    fresh.assign('savedG', G);
    expect(query.evaluate().json).toBe(6);
    fresh.declare('exponent', 'integer');
    const power = fresh.box(['PermutationPower', c, 'exponent']);
    expect(power.evaluate().operator).toBe('PermutationPower');
    fresh.assign('exponent', -1);
    expect(power.evaluate().json).toEqual(['Permutation', ['List', 3, 1, 2]]);
  });
  test('stabilizer descriptors serialize and work after checkpoint restore', () => {
    const fresh = engine();
    const stabilizer = fresh
      .box([
        'PermutationPointStabilizer',
        G,
        1,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ])
      .evaluate();
    const loaded = fresh.box(JSON.parse(JSON.stringify(stabilizer.json)));
    fresh.assign('savedH', loaded);
    const cp = fresh.checkpoint();
    fresh.assign('savedH', H);
    fresh.restore(cp);
    expect(
      fresh
        .box([
          'PermutationGroupOrder',
          'savedH',
          ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
        ])
        .evaluate().json
    ).toBe(2);
    expect(
      fresh
        .box([
          'PermutationIsSubgroup',
          G,
          'savedH',
          ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
        ])
        .evaluate().json
    ).toBe('True');
    fresh.discard(cp);
  });
  test('new operations are removed on restore and name conflicts leave installation atomic', () => {
    const fresh = new ComputeEngine(),
      cp = fresh.checkpoint();
    loadGroupTheory(fresh);
    fresh.restore(cp);
    expect(fresh.lookupDefinition('PermutationGroupOrder')).toBeUndefined();
    expect(fresh.lookupDefinition('PermutationPower')).toBeUndefined();
    fresh.discard(cp);
    fresh.declare('PermutationGroupEqual', 'integer');
    expect(() => loadGroupTheory(fresh)).toThrow('Already defined');
    expect(fresh.lookupDefinition('Permutation')).toBeUndefined();
  });
  test('cancellation remains separate from bounded failure', () => {
    const fresh = engine(),
      query = fresh.box([
        'PermutationGroupOrder',
        G,
        ['Dictionary', ['Tuple', { str: 'maxWork' }, budget]],
      ]);
    expect(() =>
      fresh.withStepBudget({ steps: 0, label: 'chain' }, () => query.evaluate())
    ).toThrow(CancellationError);
    expect(query.evaluate().json).toBe(6);
  });
});
