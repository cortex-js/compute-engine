import { loadGroupTheory } from '../../src/group-theory';
import { runInNewContext } from 'node:vm';
import { ComputeEngine } from '../../src/compute-engine';
import { isPermutationError } from '../../src/compute-engine/library/group-theory';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { MathJsonExpression as MJ } from '../../src/math-json/types';

const group: MJ = [
  'PermutationGroup',
  ['List', ['Permutation', ['List', 2, 1]]],
  ['PermutationAction', 3],
];
const options = (key: string, value: MJ): MJ => [
  'Dictionary',
  ['Tuple', { str: key }, value],
];
function engine(maxChainWork = 50_000_000) {
  const ce = new ComputeEngine();
  loadGroupTheory(ce, { maxChainWork });
  return ce;
}

describe('permutation API contracts', () => {
  test('defaults and named options work without changing mathematical values', () => {
    const ce = engine();
    const result = executeEpsil(
      ce,
      'let G=PermutationGroup([Permutation([2,1])],PermutationAction(3))\n(PermutationGroupOrder(G),PermutationGroupOrder(G, options: {maxWork -> 10000}))'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual(['Tuple', 2, 2]);
    expect(ce.box(group).json).toEqual(engine(10000).box(group).json);
  });
  test('call options cannot raise the receiver ceiling, even after a successful cached query', () => {
    const ce = engine(10000);
    expect(ce.box(['PermutationGroupOrder', group]).evaluate().json).toBe(2);
    for (const [settings, code] of [
      [options('maxWork', 10001), 'permutation-option-exceeds-limit'],
      [options('maxWork', 0), 'permutation-chain-work-limit'],
      [options('maxWrok', 100), 'unknown-permutation-option'],
    ] as [MJ, string][]) {
      const result = ce
        .box(['PermutationGroupOrder', group, settings])
        .evaluate();
      expect(result.operator).toBe('Error');
      expect(JSON.stringify(result.json)).toContain(code);
    }
    expect(ce.box(['PermutationGroupOrder', group]).evaluate().json).toBe(2);
    expect(ce.box(['PermutationGroupOrder', group, 10000]).isValid).toBe(false);
  });
  test('options can remain symbolic until assigned', () => {
    const ce = engine();
    ce.declare('settings', 'dictionary<integer>');
    const query = ce.box(['PermutationGroupOrder', group, 'settings']);
    expect(query.evaluate().operator).toBe('PermutationGroupOrder');
    ce.assign('settings', options('maxWork', 10000));
    expect(query.evaluate().json).toBe(2);
  });
  test('all capability signatures are registered and expose no any result', () => {
    const ce = engine();
    const ledger = {
      operations: [
        {
          name: 'PermutationCycles',
          signature: '(Permutation) -> list<list<integer>>',
        },
        {
          name: 'PermutationOrder',
          signature: '(Permutation) -> integer',
        },
        {
          name: 'PermutationPower',
          signature: '(Permutation, integer) -> Permutation',
        },
        {
          name: 'PermutationConjugate',
          signature: '(Permutation, Permutation) -> Permutation',
        },
        {
          name: 'PermutationCommutator',
          signature: '(Permutation, Permutation) -> Permutation',
        },
        {
          name: 'PermutationGroupGenerators',
          signature: '(PermutationGroup) -> list<Permutation>',
        },
        {
          name: 'PermutationGroupIdentity',
          signature: '(PermutationGroup) -> Permutation',
        },
        {
          name: 'PermutationGroupOrder',
          signature:
            '(group: PermutationGroup, options: dictionary<integer>?) -> integer',
        },
        {
          name: 'PermutationGroupContains',
          signature:
            '(group: PermutationGroup, element: Permutation, options: dictionary<integer>?) -> boolean',
        },
        {
          name: 'PermutationPointStabilizer',
          signature:
            '(group: PermutationGroup, point: integer, options: dictionary<integer>?) -> PermutationGroup',
        },
        {
          name: 'PermutationIsSubgroup',
          signature:
            '(parent: PermutationGroup, candidate: PermutationGroup, options: dictionary<integer>?) -> boolean',
        },
        {
          name: 'PermutationSubgroupIndex',
          signature:
            '(parent: PermutationGroup, candidate: PermutationGroup, options: dictionary<integer>?) -> integer',
        },
        {
          name: 'PermutationGroupEqual',
          signature:
            '(left: PermutationGroup, right: PermutationGroup, options: dictionary<integer>?) -> boolean',
        },
        {
          name: 'PermutationIsNormal',
          signature:
            '(parent: PermutationGroup, candidate: PermutationGroup, options: dictionary<integer>?) -> boolean',
        },
        {
          name: 'PermutationGroupIsAbelian',
          signature:
            '(group: PermutationGroup, options: dictionary<integer>?) -> boolean',
        },
        {
          name: 'PermutationOrbit',
          signature:
            '(group: PermutationGroup, point: integer, options: dictionary<integer>?) -> list<integer>',
        },
        {
          name: 'PermutationOrbits',
          signature:
            '(group: PermutationGroup, options: dictionary<integer>?) -> list<list<integer>>',
        },
        {
          name: 'PermutationTransversal',
          signature:
            '(group: PermutationGroup, point: integer, options: dictionary<integer>?) -> list<tuple<integer, Permutation>>',
        },
        {
          name: 'PermutationGroup',
          signature:
            '(list<Permutation>, PermutationAction) -> PermutationGroup',
        },
        {
          name: 'PermutationGroupElements',
          signature:
            '(group: PermutationGroup, options: dictionary<integer>?) -> list<Permutation>',
        },
        {
          name: 'Permutation',
          signature: '(list<integer>) -> Permutation',
        },
        {
          name: 'PermutationAction',
          signature: '(integer) -> PermutationAction',
        },
        {
          name: 'PermutationCompose',
          signature: '(Permutation, Permutation) -> Permutation',
        },
        {
          name: 'PermutationInverse',
          signature: '(Permutation) -> Permutation',
        },
        {
          name: 'PermutationInAction',
          signature: '(Permutation, PermutationAction) -> Permutation',
        },
        {
          name: 'PermutationApply',
          signature: '(Permutation, integer, PermutationAction) -> integer',
        },
      ],
    };
    expect(ledger.operations.length).toBe(26);
    for (const item of ledger.operations) {
      const definition = ce.lookupDefinition(item.name);
      if (!definition || !('operator' in definition) || !definition.operator)
        throw new Error('Missing operator definition: ' + item.name);
      const signature = definition.operator.signature;
      expect(signature.toString()).not.toMatch(/\bany\b/);
      expect(signature.toString()).toBe(ce.type(item.signature).toString());
    }
    for (const name of [
      'GroupMatrix',
      'MatrixGroup',
      'GroupPcSequence',
      'GroupQuotient',
    ])
      expect(ce.lookupDefinition(name)).toBeDefined();
  });
  test('kernel input/limit errors survive a separate JavaScript realm', () => {
    const error: unknown = runInNewContext(
      'Object.assign(new Error("duplicate-permutation-image"), {name:"PermutationInputError",code:"duplicate-permutation-image"})'
    );
    expect(error instanceof Error).toBe(false);
    expect(isPermutationError(error)).toBe(true);
    expect(isPermutationError(new Error('cancel'))).toBe(false);
    expect(
      isPermutationError({
        name: 'PermutationChainInvariantError',
        code: 'broken',
      })
    ).toBe(false);
    expect(isPermutationError({ name: 'PermutationInputError', code: 7 })).toBe(
      false
    );
  });
});

test('public loader is idempotent for effective settings and rejects changes', () => {
  const ce = new ComputeEngine();
  expect(loadGroupTheory(ce)).toEqual({ operatorCount: expect.any(Number) });
  const definition = ce.lookupDefinition('Permutation');
  expect(loadGroupTheory(ce, { maxDegree: 100000 })).toEqual({
    operatorCount: expect.any(Number),
  });
  expect(ce.lookupDefinition('Permutation')).toBe(definition);
  expect(() => loadGroupTheory(ce, { maxDegree: 100 })).toThrow(
    'different options'
  );
  expect(
    ce.box(['PermutationOrder', ['Permutation', ['List', 2, 1]]]).evaluate()
      .json
  ).toBe(2);
});
test('restoring a checkpoint allows a fresh load', () => {
  const ce = new ComputeEngine(),
    checkpoint = ce.checkpoint();
  loadGroupTheory(ce);
  ce.restore(checkpoint);
  expect(loadGroupTheory(ce)).toEqual({ operatorCount: expect.any(Number) });
  ce.discard(checkpoint);
});
test('malformed group members retain their original error', () => {
  const ce = engine();
  const malformed = ['Permutation', ['List', 1, 1]] as MJ;
  for (const input of [
    malformed,
    ['PermutationGroup', ['List', malformed], ['PermutationAction', 2]] as MJ,
  ])
    expect(JSON.stringify(ce.box(input).json)).toContain(
      'duplicate-permutation-image'
    );
  expect(
    JSON.stringify(
      ce.box([
        'PermutationCompose',
        ['List', 2, 1],
        ['Permutation', ['List', 2, 1]],
      ]).json
    )
  ).toContain('incompatible-type');
});

describe('permutation queries over unresolved operands', () => {
  // A call that cannot evaluate yet (it has a free symbol) must leave the
  // query unevaluated, as a free symbol does. It is not an operand of the
  // wrong type.
  test.each([
    ['PermutationOrder', ['PermutationInverse', 'x']],
    [
      'PermutationOrder',
      ['PermutationPower', ['Permutation', ['List', 2, 3, 1]], 'k'],
    ],
    [
      'PermutationGroupOrder',
      [
        'PermutationGroup',
        ['List', ['PermutationInverse', 'x']],
        ['PermutationAction', 3],
      ],
    ],
    // An unknown function where a group is expected (`readGroup`).
    ['PermutationGroupOrder', ['f', 'x']],
    // An unknown function where an action is expected (`readAction`).
    ['PermutationGroupOrder', ['PermutationGroup', ['List'], ['g', 'x']]],
  ] as [string, MJ][])(
    '%s of an unresolved call stays unevaluated',
    (op, arg) => {
      const ce = engine();
      const result = ce.box([op, arg]).evaluate();
      expect(result.operator).toBe(op);
    }
  );
  // `Add(1, 2)` evaluates to 3, which the engine's signature check refuses
  // before the reader runs.
  test('the signature check still refuses a constant operand of the wrong type', () => {
    const ce = engine();
    const result = ce.box(['PermutationOrder', ['Add', 1, 2]]).evaluate();
    expect(JSON.stringify(result.json)).toContain('incompatible-type');
  });
});

describe('stabilizer chain edge limit', () => {
  // S_n generated by the transposition (1 2) and the n-cycle (1 2 ... n).
  const symmetric = (n: number): MJ => [
    'PermutationGroup',
    [
      'List',
      [
        'Permutation',
        ['List', 2, 1, ...Array.from({ length: n - 2 }, (_, i) => i + 3)],
      ],
      [
        'Permutation',
        ['List', ...Array.from({ length: n }, (_, i) => ((i + 1) % n) + 1)],
      ],
    ],
    ['PermutationAction', n],
  ];
  test('the chain edge limit is its own option, separate from the orbit queries', () => {
    // The orbit-query edge limit has a maximum of 1,000,000; the chain edge
    // limit has a maximum of 50,000,000. One option for both made the chain
    // limit impossible to raise.
    const ce = new ComputeEngine();
    expect(() =>
      loadGroupTheory(ce, { maxChainOrbitEdges: 20_000_000 })
    ).not.toThrow();
    const order = ce.box(['PermutationGroupOrder', symmetric(200)]).evaluate();
    let factorial = 1n;
    for (let i = 2n; i <= 200n; i++) factorial *= i;
    expect(order.isSame(ce.number(factorial))).toBe(true);
  });
  test('the default chain edge limit reports a limit error for S_200', () => {
    const result = engine()
      .box(['PermutationGroupOrder', symmetric(200)])
      .evaluate();
    expect(JSON.stringify(result.json)).toContain(
      'permutation-chain-orbit-edge-limit'
    );
  });
});
