import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { installGroupTheory } from '../../src/compute-engine/library/group-theory';
import type { MathJsonExpression as MJ } from '../../src/math-json/types';
const budget = 50000000,
  p: MJ = ['Permutation', ['List', 2, 1]],
  c: MJ = ['Permutation', ['List', 2, 3, 1]],
  G: MJ = ['PermutationGroup', ['List', p, c], ['PermutationAction', 3]],
  H: MJ = ['PermutationGroup', ['List', c], ['PermutationAction', 3]];
const m: MJ = ['GroupMatrix', 0, ['List', ['List', 0, -1], ['List', 1, 0]]],
  M: MJ = ['MatrixGroup', 2, 0, ['List', m]];
const pc: MJ = ['GroupPcSequence', G, ['List', p, c], 256, budget];
const engine = () => {
  const ce = new ComputeEngine();
  installGroupTheory(ce);
  return ce;
};

describe('Epsil exact group theory', () => {
  test('finite permutation queries preserve representations and exact subgroup results', () => {
    const ce = engine();
    expect(ce.box(['GroupIsSolvable', G, 256, budget]).evaluate().json).toBe(
      'True'
    );
    expect(ce.box(['GroupExponent', G, 256, budget]).evaluate().json).toBe(6);
    expect(
      ce
        .box([
          'PermutationGroupOrder',
          ['GroupDerivedSubgroup', G, 256, budget],
          budget,
        ])
        .evaluate().json
    ).toBe(3);
    expect(
      ce.box(['GroupPcRelativeOrders', pc, budget]).evaluate().json
    ).toEqual(['List', 2, 3]);
    expect(ce.box(['GroupPcExponents', pc, c, budget]).evaluate().json).toEqual(
      ['List', 0, 1]
    );
    expect(
      ce.box(['GroupPcElement', pc, ['List', 1, 0], budget]).evaluate().json
    ).toEqual(p);
  });
  test.each(['canonical', 'structural', 'raw'] as const)(
    'matrix and finite queries through %s expressions',
    (form) => {
      const ce = engine();
      for (const [input, output] of [
        [['MatrixGroupOrder', M, 256, budget], 4],
        [['MatrixGroupIsIntegral', M, budget], 'True'],
        [['GroupIsCyclic', M, 256, budget], 'True'],
        [['GroupMatrixDeterminant', m, budget], 1],
        [
          ['GroupPcRelativeOrders', ['GroupPcgs', M, 256, budget], budget],
          ['List', 2, 2],
        ],
      ] as [MJ, MJ][])
        expect(ce.box(input, { form }).evaluate().json).toEqual(output);
    }
  );
  test('typed Epsil uses matrix values and polycyclic coordinates', () => {
    const ce = engine();
    const result = executeEpsil(
      ce,
      `
function order(g: MatrixGroup) -> integer { MatrixGroupOrder(g,256,50000000) }
let g=SpecialLinearGroup(2,3,50000000)
let pc=GroupPcgs(g,256,50000000)
(order(g),GroupIsSolvable(g,256,50000000),GroupPcRelativeOrders(pc,50000000))
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
    for (const input of [M, pc, ['GroupPcgs', M, 256, budget] as MJ]) {
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
    const invalid: MJ[] = [
      ['GroupMatrix', 9, ['List', ['List', 1]]],
      [
        'MatrixGroup',
        1,
        0,
        ['List', ['GroupMatrix', 0, ['List', ['List', 0]]]],
      ],
      ['GroupMatrixPower', m, ['Rational', 1, 2], budget],
      [
        'GroupMatrixMultiply',
        m,
        ['GroupMatrix', 3, ['List', ['List', 0, 1], ['List', 1, 0]]],
        budget,
      ],
      ['GroupPcSequence', G, ['List', c, p], 256, budget],
      ['GroupPcElement', pc, ['List', 2, 0], budget],
      ['GroupIsSolvable', G, 256, 0],
      ['GroupIsSolvable', G, 2, budget],
      ['GroupPcRelativeOrders', pc, budget, 1],
    ];
    for (const input of invalid)
      expect(ce.box(input, { form: 'raw' }).evaluate().isValid).toBe(false);
  });
  test('symbolic operands defer and boxing does not enumerate a group', () => {
    const ce = engine();
    const query = ce.box(['GroupIsSolvable', 'g', 256, budget]);
    expect(query.evaluate().json).toEqual(query.json);
    const infinite: MJ = [
      'MatrixGroup',
      2,
      0,
      ['List', ['GroupMatrix', 0, ['List', ['List', 1, 1], ['List', 0, 1]]]],
    ];
    const boxed = ce.box(['MatrixGroupOrder', infinite, 8, budget]);
    expect(boxed.operator).toBe('MatrixGroupOrder');
    expect(boxed.evaluate().isValid).toBe(false);
  });
  test('library registration and restoration are atomic', () => {
    const ce = new ComputeEngine();
    ce.declare('GroupPcDepth', 'integer');
    expect(() => installGroupTheory(ce)).toThrow('Already defined');
    expect(ce.lookupDefinition('Permutation')).toBeUndefined();
    const other = new ComputeEngine(),
      checkpoint = other.checkpoint();
    installGroupTheory(other);
    expect(other.lookupDefinition('MatrixGroup')).toBeDefined();
    other.restore(checkpoint);
    expect(other.lookupDefinition('MatrixGroup')).toBeUndefined();
  });
});

describe('shared representation and quotient integration', () => {
  test('joins and intersections accept compatible groups without containment', () => {
    const ce = engine(),
      a: MJ = ['PermutationGroup', ['List', p], ['PermutationAction', 3]],
      b: MJ = [
        'PermutationGroup',
        ['List', ['Permutation', ['List', 1, 3, 2]]],
        ['PermutationAction', 3],
      ];
    expect(
      ce
        .box(['GroupOrder', ['GroupJoin', a, b, 256, budget], 256, budget])
        .evaluate().json
    ).toBe(6);
    expect(
      ce
        .box([
          'GroupOrder',
          ['GroupIntersection', a, b, 256, budget],
          256,
          budget,
        ])
        .evaluate().json
    ).toBe(1);
    for (const name of [
      'GroupIsSubgroup',
      'GroupIsNormal',
      'GroupIsSubnormal',
      'GroupIsCharacteristic',
    ]) {
      expect(ce.box([name, a, b, 256, budget]).evaluate().json).toBe('False');
      expect(ce.box([name, G, H, 256, budget]).evaluate().json).toBe('True');
    }
    expect(
      ce
        .box(['GroupEqual', G, ['GroupJoin', a, b, 256, budget], 256, budget])
        .evaluate().json
    ).toBe('True');
  });
  test('quotient returns a group and a complete projection table', () => {
    const ce = engine(),
      quotient = ce.box(['GroupQuotient', G, H, 256, budget]).evaluate();
    expect(quotient.operator).toBe('Tuple');
    const json = quotient.json;
    if (!Array.isArray(json)) throw new Error('Expected quotient tuple JSON');
    expect(ce.box(['GroupOrder', json[1], 256, budget]).evaluate().json).toBe(
      2
    );
    if (!Array.isArray(json[2]))
      throw new Error('Expected projection list JSON');
    expect(json[2].length).toBe(7);
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
          ['GeneralLinearGroup', 2, prime, budget],
          points,
          budget,
        ])
        .evaluate().json;
      if (!Array.isArray(action))
        throw new Error('Expected matrix action tuple');
      expect(action.length).toBe(4);
      expect(action[3]).toBe(faithfulness);
    }
    const result = executeEpsil(
      ce,
      'let g=GeneralLinearGroup(3,2,50000000)\n' +
        'let p=PermutationGroup([Permutation([2,1]),Permutation([2,3,1])],PermutationAction(3))\n' +
        'let pc=GroupPcgs(p,256,50000000)\n' +
        '(MatrixGroupOrderByAction(g,8,50000000),MatrixGroupIsNaturalGL(g,8,50000000),GroupPcRelativeOrders(GroupPcStabilizer(pc,1,50000000),50000000))'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual(['Tuple', 168, 'True', ['List', 2]]);
  });
});
