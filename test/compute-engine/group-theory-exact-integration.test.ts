import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { loadGroupTheory } from '../../src/compute-engine/library/group-theory';
import type { MathJsonExpression } from '../../src/math-json/types';
const p: MathJsonExpression = ['Permutation', ['List', 2, 1]],
  c: MathJsonExpression = ['Permutation', ['List', 2, 3, 1]],
  G: MathJsonExpression = [
    'PermutationGroup',
    ['List', p, c],
    ['PermutationAction', 3],
  ],
  H: MathJsonExpression = [
    'PermutationGroup',
    ['List', c],
    ['PermutationAction', 3],
  ];
const m: MathJsonExpression = [
    'GroupMatrix',
    0,
    ['List', ['List', 0, -1], ['List', 1, 0]],
  ],
  M: MathJsonExpression = ['MatrixGroup', 2, 0, ['List', m]];
const pc: MathJsonExpression = ['GroupPcSequence', G, ['List', p, c]];
const engine = () => {
  const ce = new ComputeEngine();
  loadGroupTheory(ce);
  return ce;
};

describe('Epsil exact group theory', () => {
  test('matrix order falls back to closure when vector-action storage does not fit', () => {
    const ce = engine();
    const trivial: MathJsonExpression = ['MatrixGroup', 16, 2, ['List']];
    for (const operator of ['GroupOrder', 'MatrixGroupOrder'])
      expect(ce.box([operator, trivial]).evaluate().json).toBe(1);
    expect(
      ce.box(['MatrixGroupOrderByAction', trivial]).evaluate().operator
    ).toBe('Error');
  });
  test.each([
    ['MatrixGroupVectorAction', 15],
    ['MatrixGroupProjectiveAction', 4],
  ] as const)(
    '%s charges point encoding to the shared query budget',
    (operator, maxWork) => {
      const ce = engine();
      const trivial: MathJsonExpression = ['MatrixGroup', 1, 7, ['List']];
      const limited = ce
        .box([operator, trivial, { dict: { maxWork } }])
        .evaluate();
      expect(limited.operator).toBe('Error');
      expect(JSON.stringify(limited.json)).toContain('group-work-limit');
      expect(
        ce.box([operator, trivial, { dict: { maxWork: 50 } }]).evaluate()
          .operator
      ).toBe('Tuple');
    }
  );

  test('finite permutation queries preserve representations and exact subgroup results', () => {
    const ce = engine();
    expect(ce.box(['GroupIsSolvable', G]).evaluate().json).toBe('True');
    expect(ce.box(['GroupExponent', G]).evaluate().json).toBe(6);
    expect(
      ce.box(['GroupOrder', ['GroupDerivedSubgroup', G]]).evaluate().json
    ).toBe(3);
    expect(ce.box(['GroupPcRelativeOrders', pc]).evaluate().json).toEqual([
      'List',
      2,
      3,
    ]);
    expect(ce.box(['GroupPcExponents', pc, c]).evaluate().json).toEqual([
      'List',
      0,
      1,
    ]);
    expect(
      ce.box(['GroupPcElement', pc, ['List', 1, 0]]).evaluate().json
    ).toEqual(p);
  });
  test.each(['canonical', 'structural', 'raw'] as const)(
    'matrix and finite queries through %s expressions',
    (form) => {
      const ce = engine();
      for (const [input, output] of [
        [['MatrixGroupOrder', M], 4],
        [['MatrixGroupIsIntegral', M], 'True'],
        [['GroupIsCyclic', M], 'True'],
        [['GroupMatrixDeterminant', m], 1],
        [
          ['GroupPcRelativeOrders', ['GroupPcgs', M]],
          ['List', 2, 2],
        ],
      ] as [MathJsonExpression, MathJsonExpression][])
        expect(ce.box(input, { form }).evaluate().json).toEqual(output);
    }
  );
  test('typed Epsil uses matrix values and polycyclic coordinates', () => {
    const ce = engine();
    const result = executeEpsil(
      ce,
      `
function order(g: MatrixGroup) -> integer { MatrixGroupOrder(g) }
let g=SpecialLinearGroup(2,3)
let pc: GroupPcSequence=GroupPcgs(g)
(order(g),GroupIsSolvable(g),GroupPcRelativeOrders(pc))
`
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual([
      'Tuple',
      24,
      'True',
      ['List', 3, 2, 2, 2],
    ]);
  });
  test('values and queries survive MathJSON transport to a fresh engine', () => {
    const ce = engine(),
      fresh = engine();
    for (const input of [M, pc, ['GroupPcgs', M] as MathJsonExpression]) {
      const value = ce.box(input).evaluate();
      expect(value.isValid).toBe(true);
      expect(
        fresh.box(JSON.parse(JSON.stringify(value.json))).evaluate().json
      ).toEqual(value.json);
    }
  });
  test('invalid arithmetic, domains, work bounds and pc sequences cannot assert results', () => {
    const ce = engine();
    ce.strict = false;
    const invalid: MathJsonExpression[] = [
      ['GroupMatrix', 9, ['List', ['List', 1]]],
      [
        'MatrixGroup',
        1,
        0,
        ['List', ['GroupMatrix', 0, ['List', ['List', 0]]]],
      ],
      ['GroupMatrixPower', m, ['Rational', 1, 2]],
      [
        'GroupMatrixMultiply',
        m,
        ['GroupMatrix', 3, ['List', ['List', 0, 1], ['List', 1, 0]]],
      ],
      ['GroupPcSequence', G, ['List', c, p]],
      ['GroupPcElement', pc, ['List', 2, 0]],
      ['GroupIsSolvable', G, { dict: { maxWork: 0 } }],
      ['GroupIsSolvable', G, { dict: { maxElements: 2 } }],
      ['GroupPcRelativeOrders', pc, 1],
    ];
    for (const input of invalid)
      expect(ce.box(input, { form: 'raw' }).evaluate().isValid).toBe(false);
  });
  test('symbolic operands defer and boxing does not enumerate a group', () => {
    const ce = engine();
    const query = ce.box(['GroupIsSolvable', 'g']);
    expect(query.evaluate().json).toEqual(query.json);
    const infinite: MathJsonExpression = [
      'MatrixGroup',
      2,
      0,
      ['List', ['GroupMatrix', 0, ['List', ['List', 1, 1], ['List', 0, 1]]]],
    ];
    const boxed = ce.box([
      'MatrixGroupOrder',
      infinite,
      { dict: { maxElements: 8 } },
    ]);
    expect(boxed.operator).toBe('MatrixGroupOrder');
    expect(boxed.evaluate().isValid).toBe(false);
  });
  test('library registration and restoration are atomic', () => {
    const ce = new ComputeEngine();
    ce.declare('GroupPcDepth', 'integer');
    expect(() => loadGroupTheory(ce)).toThrow('Already defined');
    expect(ce.lookupDefinition('Permutation')).toBeUndefined();
    const other = new ComputeEngine(),
      checkpoint = other.checkpoint();
    loadGroupTheory(other);
    expect(other.lookupDefinition('MatrixGroup')).toBeDefined();
    other.restore(checkpoint);
    expect(other.lookupDefinition('MatrixGroup')).toBeUndefined();
  });
});

describe('shared representation and quotient integration', () => {
  test('joins and intersections accept compatible groups without containment', () => {
    const ce = engine(),
      a: MathJsonExpression = [
        'PermutationGroup',
        ['List', p],
        ['PermutationAction', 3],
      ],
      b: MathJsonExpression = [
        'PermutationGroup',
        ['List', ['Permutation', ['List', 1, 3, 2]]],
        ['PermutationAction', 3],
      ];
    expect(ce.box(['GroupOrder', ['GroupJoin', a, b]]).evaluate().json).toBe(6);
    expect(
      ce.box(['GroupOrder', ['GroupIntersection', a, b]]).evaluate().json
    ).toBe(1);
    for (const name of [
      'GroupIsSubgroup',
      'GroupIsNormal',
      'GroupIsSubnormal',
      'GroupIsCharacteristic',
    ]) {
      expect(ce.box([name, a, b]).evaluate().json).toBe('False');
      expect(ce.box([name, G, H]).evaluate().json).toBe('True');
    }
    expect(ce.box(['GroupEqual', G, ['GroupJoin', a, b]]).evaluate().json).toBe(
      'True'
    );
  });
  test('quotient carries its group and verified natural projection', () => {
    const ce = engine();
    const quotient = ce.box(['GroupQuotient', G, H]).evaluate();
    expect(quotient.operator).toBe('GroupQuotientValue');
    expect(
      ce.box(['GroupOrder', ['GroupQuotientGroup', quotient.json]]).evaluate()
        .json
    ).toBe(2);
    const projection = ce
      .box(['GroupQuotientProjection', quotient.json])
      .evaluate();
    expect(projection.operator).toBe('GroupHomomorphism');
    expect(
      ce
        .box(['GroupEqual', ['GroupHomomorphismKernel', projection.json], H])
        .evaluate().json
    ).toBe('True');
  });
  test('matrix recognition and pcgs action operations run through Epsil', () => {
    const ce = engine();
    for (const [prime, points, faithfulness] of [
      [2, 3, 'True'],
      [3, 4, 'Nothing'],
    ] as const) {
      const action = ce
        .box([
          'MatrixGroupProjectiveAction',
          ['GeneralLinearGroup', 2, prime],
          { dict: { maxPoints: points } },
        ])
        .evaluate().json;
      if (!Array.isArray(action))
        throw new Error('Expected matrix action tuple');
      expect(action.length).toBe(4);
      expect(action[3]).toBe(faithfulness);
    }
    const result = executeEpsil(
      ce,
      'let g=GeneralLinearGroup(3,2)\n' +
        'let p=PermutationGroup([Permutation([2,1]),Permutation([2,3,1])],PermutationAction(3))\n' +
        'let pc: GroupPcSequence=GroupPcgs(p)\n' +
        '(MatrixGroupOrderByAction(g, options: {maxPoints -> 8}),MatrixGroupIsNaturalGL(g, options: {maxPoints -> 8}),GroupPcRelativeOrders(GroupPcStabilizer(pc,1)))'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual(['Tuple', 168, 'True', ['List', 2]]);
  });
});
