import { ComputeEngine } from '../../src/compute-engine';
import { loadGroupTheory } from '../../src/group-theory';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

const cyclic = (order: number): MathJsonExpression => [
  'PcGroup',
  ['List', order],
  ['List', ['List']],
  ['List', ['List']],
  ['List', ['List']],
];
const dihedral = (order: number, carry = 0): MathJsonExpression => [
  'PcGroup',
  ['List', 2, order],
  ['List', ['List', carry], ['List']],
  ['List', ['List', ['List', order - 1]], ['List']],
  ['List', ['List', ['List', order - 1]], ['List']],
];
const element = (
  group: MathJsonExpression,
  ...coordinates: number[]
): MathJsonExpression => ['PcElement', group, ['List', ...coordinates]];
function engine() {
  const ce = new ComputeEngine();
  loadGroupTheory(ce);
  return ce;
}
describe('collected polycyclic public API', () => {
  test('large cyclic arithmetic uses exact coordinates without enumeration', () => {
    const ce = engine(),
      group = cyclic(1000000000000);
    expect(ce.box(['PcGroupOrder', group]).evaluate().json).toBe(1000000000000);
    const value = element(group, 999999999999);
    expect(
      ce.box(['PcCoordinates', ['PcMultiply', value, value]]).evaluate().json
    ).toEqual(['List', 999999999998]);
    expect(
      ce.box(['PcCoordinates', ['PcPower', element(group, 1), -1]]).evaluate()
        .json
    ).toEqual(['List', 999999999999]);
    expect(
      ce.box(['PcCoordinates', ['PcInverse', value]]).evaluate().json
    ).toEqual(['List', 1]);
  });
  test('large dihedral extension and quaternion carry satisfy their relations', () => {
    const ce = engine(),
      group = dihedral(1000000000000);
    const reflection = element(group, 1, 0),
      rotation = element(group, 0, 1);
    expect(ce.box(['PcGroupOrder', group]).evaluate().json).toBe(2000000000000);
    expect(
      ce
        .box([
          'PcCoordinates',
          ['PcMultiply', ['PcMultiply', reflection, rotation], reflection],
        ])
        .evaluate().json
    ).toEqual(['List', 0, 999999999999]);
    const quaternion = dihedral(4, 2);
    expect(
      ce
        .box(['PcCoordinates', ['PcPower', element(quaternion, 1, 1), 2]])
        .evaluate().json
    ).toEqual(['List', 0, 2]);
    expect(
      ce
        .box(['PcCoordinates', ['PcPower', element(quaternion, 1, 1), 4]])
        .evaluate().json
    ).toEqual(['List', 0, 0]);
  });
  test('descriptor transport, typed Epsil and explicit domain compatibility', () => {
    const ce = engine(),
      group = dihedral(8),
      value = ce.box(element(group, 1, 3)).evaluate();
    expect(
      engine()
        .box(JSON.parse(JSON.stringify(value.json)))
        .evaluate().json
    ).toEqual(value.json);
    expect(
      ce
        .box(['PcMultiply', value.json, element(dihedral(8, 4), 1, 3)])
        .evaluate()
        .has('Error')
    ).toBe(true);
    const result = executeEpsil(
      ce,
      `
let g=PcGroup([1000000000000],[[]],[[]],[[]])
let x=PcElement(g,[7])
(PcGroupOrder(g),PcCoordinates(PcPower(x,3)))
`
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual(['Tuple', 1000000000000, ['List', 21]]);
  });
  test('bad presentations, coordinates and work limits cannot assert group results', () => {
    const ce = engine();
    for (const input of [
      cyclic(1),
      [
        'PcGroup',
        ['List', 2, 7],
        ['List', ['List', 0], ['List']],
        ['List', ['List', ['List', 0]], ['List']],
        ['List', ['List', ['List', 0]], ['List']],
      ],
      dihedral(7, 1),
      element(cyclic(7), 7),
      element(cyclic(7), -1),
      ['PcGroupOrder', cyclic(7), { dict: { maxWork: 0 } }],
      [
        'PcGroupOrder',
        ['PcGroup', ['List'], ['List'], ['List'], ['List']],
        { dict: { maxWork: 0 } },
      ],
      ['PcPower', element(cyclic(7), 2), 3, { dict: { maxWork: 0 } }],
      ['PcGroupOrder', cyclic(7), { dict: { maxElements: 7 } }],
    ] as MathJsonExpression[])
      expect(ce.box(input).evaluate().has('Error')).toBe(true);
    const unknownDomains = ce.box([
      'PcMultiply',
      element('G', 0),
      element('H', 0),
    ]);
    expect(unknownDomains.evaluate().json).toEqual(unknownDomains.json);
    const symbolic = ce.box(['PcMultiply', 'a', 'b']);
    expect(symbolic.evaluate().json).toEqual(symbolic.json);
  });
});
