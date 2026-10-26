import { ComputeEngine, isFunction } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { installPermutationFoundation } from '../../src/compute-engine/library/group-theory';
import { CancellationError } from '../../src/common/interruptible';
import type { MathJsonExpression } from '../../src/math-json/types';

const G: MathJsonExpression = [
  'PermutationGroup',
  ['List', ['Permutation', ['List', 2, 1]], ['Permutation', ['List', 1, 3, 2]]],
  ['PermutationAction', 5],
];
const orbit: MathJsonExpression = ['PermutationOrbit', G, 1, 3, 6];
const orbits: MathJsonExpression = ['PermutationOrbits', G, 5, 10];
const transversal: MathJsonExpression = [
  'PermutationTransversal',
  G,
  1,
  3,
  6,
  2,
];
const expected: MathJsonExpression = [
  'List',
  ['Tuple', 1, ['Permutation', ['List']]],
  ['Tuple', 2, ['Permutation', ['List', 2, 1]]],
  ['Tuple', 3, ['Permutation', ['List', 3, 1, 2]]],
];
function engine(
  options: Parameters<typeof installPermutationFoundation>[1] = {}
) {
  const ce = new ComputeEngine();
  installPermutationFoundation(ce, options);
  return ce;
}
function run(ce: ComputeEngine, source: string) {
  const result = executeEpsil(ce, source);
  expect(result.diagnostics).toEqual([]);
  return result.value;
}

describe('Epsil point orbits and transversals', () => {
  const ce = engine();
  test('typed Epsil functions return orbit points and point-representative tuples', () => {
    const result = run(
      ce,
      `
function pointOrbit(g: PermutationGroup, p: integer) -> list<integer> {
  PermutationOrbit(g,p,5,10)
}
function pointTransversal(g: PermutationGroup, p: integer) -> list<tuple<integer, Permutation>> {
  PermutationTransversal(g,p,5,10,4)
}
let G = PermutationGroup([Permutation([2,1]),Permutation([1,3,2])],PermutationAction(5))
(pointOrbit(G,1), PermutationOrbits(G,5,10), pointTransversal(G,1))
`
    );
    expect(result.json).toEqual([
      'Tuple',
      ['List', 1, 2, 3],
      ['List', ['List', 1, 2, 3], ['List', 4], ['List', 5]],
      expected,
    ]);
  });

  test.each(['canonical', 'raw', 'structural'] as const)(
    'queries evaluate through %s boxing',
    (form) => {
      expect(ce.box(orbit, { form }).evaluate().json).toEqual([
        'List',
        1,
        2,
        3,
      ]);
      expect(ce.box(orbits, { form }).evaluate().json).toEqual([
        'List',
        ['List', 1, 2, 3],
        ['List', 4],
        ['List', 5],
      ]);
      expect(ce.box(transversal, { form }).evaluate().json).toEqual(expected);
    }
  );

  test('boxing, hashing, printing, and JSON do not perform an orbit query', () => {
    const query = ce.box(['PermutationOrbit', G, 1, 0, 0]);
    expect(query.operator).toBe('PermutationOrbit');
    expect(query.hash).toBe(ce.box(query.json).hash);
    expect(query.toString()).toContain('PermutationOrbit');
    expect(query.evaluate().operator).toBe('Error');
  });

  test('symbolic groups and points remain deferred until assigned', () => {
    const fresh = engine();
    fresh.declare('pending_group', 'PermutationGroup');
    fresh.declare('pending_point', 'integer');
    const query = fresh.box([
      'PermutationOrbit',
      'pending_group',
      'pending_point',
      3,
      6,
    ]);
    expect(query.evaluate().operator).toBe('PermutationOrbit');
    fresh.assign('pending_group', G);
    fresh.assign('pending_point', 1);
    expect(query.evaluate().json).toEqual(['List', 1, 2, 3]);
    expect(
      run(
        fresh,
        'PermutationOrbit(PermutationGroup(listFrom([Permutation([2,1])]),PermutationAction(3)),1,2,2)'
      ).json
    ).toEqual(['List', 1, 2]);
  });

  test.each([
    'PermutationOrbit',
    'PermutationOrbits',
    'PermutationTransversal',
  ])(
    '%s revalidates forged descriptors with static checking disabled',
    (head) => {
      const fresh = engine();
      fresh.strict = false;
      const forged: MathJsonExpression[] = [
        [
          'PermutationGroup',
          ['List', ['Permutation', ['List', 2, 2]]],
          ['PermutationAction', 5],
        ],
        [
          'PermutationGroup',
          ['List', ['Permutation', ['List', 2, 1]]],
          ['PermutationAction', 1],
        ],
        ['PermutationGroup', ['List'], 5],
        ['PermutationGroup', ['List']],
        ['Tuple', ['List'], ['PermutationAction', 5]],
      ];
      for (const group of forged) {
        const query: MathJsonExpression =
          head === 'PermutationOrbits'
            ? [head, group, 5, 10]
            : head === 'PermutationOrbit'
              ? [head, group, 1, 5, 10]
              : [head, group, 1, 5, 10, 4];
        for (const form of ['raw', 'structural', 'canonical'] as const)
          expect(fresh.box(query, { form }).evaluate().operator).toBe('Error');
      }
    }
  );

  test('budgets produce errors, with no partial list; later calls succeed', () => {
    const cases: [MathJsonExpression, string][] = [
      [['PermutationOrbit', G, 1, 2, 6], 'orbit-point'],
      [['PermutationOrbit', G, 1, 3, 5], 'orbit-edge'],
      [['PermutationOrbits', G, 4, 10], 'orbit-point'],
      [['PermutationOrbits', G, 5, 9], 'orbit-edge'],
      [['PermutationTransversal', G, 1, 3, 6, 1], 'transversal-product'],
    ];
    for (const [query, code] of cases) {
      const result = ce.box(query).evaluate();
      expect(result.operator).toBe('Error');
      expect(JSON.stringify(result.json)).toContain(
        `permutation-${code}-limit`
      );
    }
    expect(ce.box(transversal).evaluate().json).toEqual(expected);
  });

  test('transversal image work and storage are separate from point-orbit work', () => {
    for (const [options, code] of [
      [{ maxTransversalImageWork: 4 }, 'image-work'],
      [{ maxTransversalStoredImages: 4 }, 'storage'],
    ] as const) {
      const limited = engine(options);
      expect(limited.box(orbit).evaluate().json).toEqual(['List', 1, 2, 3]);
      expect(
        JSON.stringify(limited.box(transversal).evaluate().json)
      ).toContain(`permutation-transversal-${code}-limit`);
    }
    expect(
      engine({ maxTransversalImageWork: 5, maxTransversalStoredImages: 5 })
        .box(transversal)
        .evaluate().json
    ).toEqual(expected);
  });

  test('degree and generator limits apply on every receiving query', () => {
    for (const options of [
      { maxDegree: 4 },
      { maxGenerators: 1 },
      { maxGeneratorImages: 4 },
    ])
      expect(
        engine(options).box(orbit, { form: 'raw' }).evaluate().operator
      ).toBe('Error');
  });

  test('empty actions and fixed points have explicit semantics', () => {
    expect(
      run(
        ce,
        'PermutationOrbits(PermutationGroup([],PermutationAction(0)),0,0)'
      ).json
    ).toEqual(['List']);
    expect(
      run(
        ce,
        'PermutationOrbit(PermutationGroup([],PermutationAction(0)),1,1,0)'
      ).operator
    ).toBe('Error');
    expect(
      run(
        ce,
        'PermutationTransversal(PermutationGroup([],PermutationAction(5)),5,1,0,0)'
      ).json
    ).toEqual(['List', ['Tuple', 5, ['Permutation', ['List']]]]);
    expect(ce.box(['PermutationOrbit', G, 0, 3, 6]).evaluate().operator).toBe(
      'Error'
    );
    expect(ce.box(['PermutationOrbit', G, 6, 3, 6]).evaluate().operator).toBe(
      'Error'
    );
  });

  test('invalid and missing limits or arguments are rejected', () => {
    const bad: MathJsonExpression[] = [
      ['PermutationOrbit', G, 1, 3],
      ['PermutationOrbits', G, 5, 10, 0],
      ['PermutationTransversal', G, 1, 3, 6],
      ['PermutationOrbit', G, 1, -1, 6],
      ['PermutationOrbit', G, 1, 3, 0.5],
      ['PermutationTransversal', G, 1, 3, 6, -1],
    ];
    const loose = engine();
    loose.strict = false;
    for (const query of bad)
      expect(loose.box(query, { form: 'raw' }).evaluate().operator).toBe(
        'Error'
      );
    const fresh = new ComputeEngine();
    expect(() =>
      installPermutationFoundation(fresh, { maxTransversalImageWork: -1 })
    ).toThrow();
    expect(fresh.lookupDefinition('Permutation')).toBeUndefined();
  });

  test('queries and ordinary result data round-trip in a fresh engine', () => {
    const fresh = engine();
    const query = JSON.parse(JSON.stringify(ce.box(transversal).json));
    expect(fresh.box(query).evaluate().json).toEqual(expected);
    const restored = fresh
      .box(JSON.parse(JSON.stringify(ce.box(transversal).evaluate().json)))
      .evaluate();
    expect(restored.json).toEqual(expected);
    if (!isFunction(restored, 'List')) throw new Error('expected List');
    for (const pair of restored.ops) {
      if (!isFunction(pair, 'Tuple')) throw new Error('expected Tuple');
      expect(
        fresh
          .box(['PermutationApply', pair.op2.json, 1, ['PermutationAction', 5]])
          .evaluate().json
      ).toEqual(pair.op1.json);
    }
  });

  test('installation and results obey checkpoint lifetimes', () => {
    const fresh = new ComputeEngine();
    const before = fresh.checkpoint();
    installPermutationFoundation(fresh);
    fresh.assign('saved_transversal', fresh.box(transversal).evaluate());
    const after = fresh.checkpoint();
    fresh.assign('saved_transversal', ['List']);
    fresh.restore(after);
    expect(fresh.symbol('saved_transversal').evaluate().json).toEqual(expected);
    fresh.discard(after);
    fresh.restore(before);
    for (const name of [
      'PermutationOrbit',
      'PermutationOrbits',
      'PermutationTransversal',
    ])
      expect(fresh.lookupDefinition(name)).toBeUndefined();
    installPermutationFoundation(fresh);
    expect(fresh.box(orbit).evaluate().json).toEqual(['List', 1, 2, 3]);
    fresh.discard(before);
  });

  test('a new operation name conflict leaves the installer atomic', () => {
    const fresh = new ComputeEngine();
    fresh.declare('PermutationOrbit', 'integer');
    expect(() => installPermutationFoundation(fresh)).toThrow(
      'Already defined'
    );
    expect(fresh.lookupDefinition('Permutation')).toBeUndefined();
    expect(fresh.lookupDefinition('PermutationTransversal')).toBeUndefined();
  });

  test('CE cancellation propagates separately from exhaustion and a retry succeeds', () => {
    const fresh = engine();
    for (const json of [orbit, orbits, transversal]) {
      const query = fresh.box(json);
      expect(() =>
        fresh.withStepBudget({ steps: 0, label: 'orbit' }, () =>
          query.evaluate()
        )
      ).toThrow(CancellationError);
      expect(query.evaluate().operator).toBe('List');
    }
  });
});
