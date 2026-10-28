import { ComputeEngine } from '../../src/compute-engine';
import { loadGroupTheory } from '../../src/group-theory';
import type { MathJsonExpression } from '../../src/math-json/types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
const permutation = (...images: number[]): MathJsonExpression => [
  'Permutation',
  ['List', ...images],
];
const cyclic: MathJsonExpression = [
  'PermutationGroup',
  ['List', permutation(2, 3, 4, 1)],
  ['PermutationAction', 4],
];
const pc = (elements: MathJsonExpression[]): MathJsonExpression => [
  'GroupPcSequence',
  cyclic,
  ['List', ...elements],
];
function engine() {
  const ce = new ComputeEngine();
  loadGroupTheory(ce);
  return ce;
}
describe('group-theory public validation and representation contracts', () => {
  test('public pc sequences have strict cyclic factors, including imported values', () => {
    const ce = engine(),
      a = permutation(2, 3, 4, 1),
      square = permutation(3, 4, 1, 2);
    for (const input of [
      pc([a, a]),
      pc([permutation(), a]),
      pc([a, square, square]),
    ]) {
      for (const form of ['canonical', 'structural', 'raw'] as const) {
        expect(
          JSON.stringify(ce.box(input, { form }).evaluate().json)
        ).toContain('redundant-pc-generator');
        expect(
          JSON.stringify(
            ce.box(['GroupPcDepth', input, a], { form }).evaluate().json
          )
        ).toContain('redundant-pc-generator');
      }
    }
    expect(
      ce.box(['GroupPcRelativeOrders', pc([a, square])]).evaluate().json
    ).toEqual(['List', 2, 2]);
    expect(ce.box(['GroupPcDepth', pc([a, square]), a]).evaluate().json).toBe(
      1
    );
  });
  test('generic names replace unreleased permutation aliases', () => {
    const ce = engine();
    for (const name of [
      'PermutationGroupOrder',
      'PermutationGroupContains',
      'PermutationIsSubgroup',
      'PermutationIsNormal',
      'PermutationGroupIsAbelian',
      'PermutationGroupElements',
      'PermutationGroupGenerators',
      'PermutationGroupEqual',
      'PermutationGroupIdentity',
      'PermutationSubgroupIndex',
    ])
      expect(ce.lookupDefinition(name)).toBeUndefined();
    expect(ce.box(['GroupOrder', cyclic]).evaluate().json).toBe(4);
    expect(ce.box(['GroupIndex', cyclic, cyclic]).evaluate().json).toBe(1);
    expect(
      ce
        .box(['GroupElements', cyclic, { dict: { maxProducts: 0 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
    expect(
      ce
        .box(['GroupOrder', cyclic, { dict: { maxOrbitEdges: 0 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
  });
  test('finite-to-collected conversion preserves coordinate positions and relations', () => {
    const ce = engine(),
      sequence = pc([permutation(2, 3, 4, 1), permutation(3, 4, 1, 2)]);
    const presentation = ce.box(['GroupPcPresentation', sequence]).evaluate();
    expect(presentation.operator).toBe('PcGroup');
    expect(
      ce.box(['PcRelativeOrders', presentation.json]).evaluate().json
    ).toEqual(['List', 2, 2]);
    expect(
      ce
        .box([
          'PcCoordinates',
          ['PcPower', ['PcElement', presentation.json, ['List', 1, 0]], 2],
        ])
        .evaluate().json
    ).toEqual(['List', 0, 1]);
    expect(engine().box(presentation.json).evaluate().json).toEqual(
      presentation.json
    );
    const d8: MathJsonExpression = [
      'PermutationGroup',
      ['List', permutation(2, 3, 4, 1), permutation(1, 4, 3, 2)],
      ['PermutationAction', 4],
    ];
    const dseq: MathJsonExpression = [
      'GroupPcSequence',
      d8,
      ['List', permutation(1, 4, 3, 2), permutation(2, 3, 4, 1)],
    ];
    const conjugate = ce
      .box(['GroupPcConjugateExponents', dseq, 1, 2])
      .evaluate();
    expect(conjugate.json).toEqual(['List', 0, 3]);
    const collected = ce.box(['GroupPcPresentation', dseq]).evaluate();
    if (!isFunction(collected, 'PcGroup'))
      throw Error('Expected collected descriptor');
    expect(collected.ops[2].json).toEqual([
      'List',
      ['List', ['List', 3]],
      ['List'],
    ]);
  });
  test('factorization uses shortest positive generator words', () => {
    const ce = engine();
    expect(
      ce.box(['GroupFactorization', cyclic, permutation(4, 1, 2, 3)]).evaluate()
        .json
    ).toEqual(['List', 1, 1, 1]);
  });
});
