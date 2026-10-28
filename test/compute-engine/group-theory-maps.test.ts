import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { ComputeEngine } from '../../src/compute-engine';
import { loadGroupTheory } from '../../src/group-theory';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

const rotation: MathJsonExpression = ['Permutation', ['List', 2, 3, 4, 1]];
const square: MathJsonExpression = ['Permutation', ['List', 3, 4, 1, 2]];
const transposition: MathJsonExpression = ['Permutation', ['List', 2, 1]];
const cyclic: MathJsonExpression = [
  'PermutationGroup',
  ['List', rotation],
  ['PermutationAction', 4],
];
const kernel: MathJsonExpression = [
  'PermutationGroup',
  ['List', square],
  ['PermutationAction', 4],
];
const target: MathJsonExpression = [
  'PermutationGroup',
  ['List', transposition],
  ['PermutationAction', 2],
];
const quotientMap: MathJsonExpression = [
  'GroupHomomorphismByImages',
  cyclic,
  target,
  ['List', rotation],
  ['List', transposition],
];
function engine() {
  const ce = new ComputeEngine();
  loadGroupTheory(ce);
  return ce;
}

describe('typed group maps and quotients', () => {
  test('automorphism rendering bounds the full expanded result before allocation', () => {
    const ce = engine();
    // C2^3 has only eight elements and 168 automorphisms. Moving the final
    // transposition to points 999 and 1000 makes its complete image-pair output
    // exceed the serialization bound without requiring a large kernel search.
    const last = Array.from({ length: 1000 }, (_, i) => i + 1);
    [last[998], last[999]] = [last[999], last[998]];
    const group: MathJsonExpression = [
      'PermutationGroup',
      [
        'List',
        transposition,
        ['Permutation', ['List', 1, 2, 4, 3]],
        ['Permutation', ['List', ...last]],
      ],
      ['PermutationAction', 1000],
    ];
    expect(ce.box(['GroupOrder', group]).evaluate().json).toBe(8);
    const result = ce.box(['GroupAutomorphisms', group]).evaluate();
    expect(JSON.stringify(result.json)).toContain('group-map-output-limit');
  });
  test('a generator map determines its kernel, image and fibers', () => {
    const ce = engine();
    const map = ce.box(quotientMap).evaluate();
    expect(map.operator).toBe('GroupHomomorphism');
    const evaluate = (x: MathJsonExpression) => ce.box(x).evaluate().json;
    expect(evaluate(['GroupHomomorphismApply', map.json, rotation])).toEqual(
      transposition
    );
    expect(
      evaluate(['GroupEqual', ['GroupHomomorphismKernel', map.json], kernel])
    ).toBe('True');
    expect(
      evaluate(['GroupEqual', ['GroupHomomorphismImage', map.json], target])
    ).toBe('True');
    expect(
      evaluate([
        'GroupEqual',
        ['GroupHomomorphismPreimage', map.json, target],
        cyclic,
      ])
    ).toBe('True');
    expect(
      evaluate(['GroupOrder', ['GroupHomomorphismImageOf', map.json, kernel]])
    ).toBe(1);
    const fiber = ce
      .box(['GroupHomomorphismPreimages', map.json, transposition])
      .evaluate();
    expect(isFunction(fiber, 'List') && fiber.ops.length).toBe(2);
    expect(
      ce.box(['GroupHomomorphismInverse', map.json]).evaluate().has('Error')
    ).toBe(true);
  });
  test('composition matches domains by exact elements even with different generators', () => {
    const ce = engine();
    const alternate: MathJsonExpression = [
      'PermutationGroup',
      ['List', ['Permutation', ['List']], transposition],
      ['PermutationAction', 2],
    ];
    const identity: MathJsonExpression = [
      'GroupHomomorphismByImages',
      alternate,
      target,
      ['List', transposition],
      ['List', transposition],
    ];
    const composite = ce
      .box(['GroupHomomorphismCompose', quotientMap, identity])
      .evaluate();
    expect(composite.operator).toBe('GroupHomomorphism');
    expect(
      ce.box(['GroupHomomorphismApply', composite.json, rotation]).evaluate()
        .json
    ).toEqual(transposition);
    const wrong: MathJsonExpression = [
      'GroupHomomorphismByImages',
      cyclic,
      cyclic,
      ['List', rotation],
      ['List', rotation],
    ];
    expect(
      ce
        .box(['GroupHomomorphismCompose', quotientMap, wrong])
        .evaluate()
        .has('Error')
    ).toBe(true);
  });
  test('imported maps reject duplicate sources and violated relations', () => {
    const ce = engine();
    const map = ce.box(quotientMap).evaluate().json;
    if (!Array.isArray(map) || !Array.isArray(map[3]))
      throw new Error('Expected map image pairs');
    const pairs = map[3];
    const bad: MathJsonExpression = [
      'GroupHomomorphism',
      cyclic,
      target,
      ['List', pairs[1], pairs[1], pairs[3], pairs[4]],
    ];
    expect(ce.box(bad).evaluate().has('Error')).toBe(true);
    expect(
      ce
        .box([
          'GroupHomomorphismByImages',
          target,
          cyclic,
          ['List', transposition],
          ['List', rotation],
        ])
        .evaluate()
        .has('Error')
    ).toBe(true);
  });
  test('quotient projection and lift roundtrip and verify their declared kernel', () => {
    const ce = engine();
    const quotient = ce.box(['GroupQuotient', cyclic, kernel]).evaluate();
    expect(quotient.operator).toBe('GroupQuotientValue');
    const projection = ce
      .box(['GroupQuotientProjection', quotient.json])
      .evaluate();
    const group = ce.box(['GroupQuotientGroup', quotient.json]).evaluate();
    expect(ce.box(['GroupOrder', group.json]).evaluate().json).toBe(2);
    const elements = ce.box(['GroupElements', group.json]).evaluate();
    if (!isFunction(elements, 'List'))
      throw new Error('Expected quotient elements');
    for (const element of elements.ops) {
      const lift = ce
        .box(['GroupQuotientLift', quotient.json, element.json])
        .evaluate();
      expect(
        ce
          .box(['GroupHomomorphismApply', projection.json, lift.json])
          .evaluate().json
      ).toEqual(element.json);
    }
    expect(
      ce
        .box(['GroupQuotientValue', cyclic, cyclic, projection.json])
        .evaluate()
        .has('Error')
    ).toBe(true);
    const fresh = engine();
    expect(
      fresh.box(JSON.parse(JSON.stringify(quotient.json))).evaluate().json
    ).toEqual(quotient.json);
  });
  test('recovery retains named options, unresolved operands, inner errors and cancellation', () => {
    const ce = engine();
    const symbolic = ce.box(['GroupHomomorphismApply', 'f', 'x']);
    expect(symbolic.evaluate().json).toEqual(symbolic.json);
    expect(
      JSON.stringify(
        ce
          .box([
            'GroupHomomorphismByImages',
            cyclic,
            target,
            ['List', ['Permutation', ['List', 1, 1]]],
            ['List', transposition],
          ])
          .evaluate().json
      )
    ).toContain('duplicate-permutation-image');
    expect(
      ce
        .box(['GroupQuotient', cyclic, kernel, { dict: { maxWork: 0 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
    expect(
      ce
        .box(['GroupOrder', cyclic, { dict: { maxWork: 50000001 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
    expect(
      ce
        .box(['GroupOrder', cyclic, { dict: { unknown: 1 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
    expect(ce.box(['GroupOrder', cyclic, 256, 50000000]).isValid).toBe(false);
  });
  test('polycyclic values contain mathematics only, regardless of query budget', () => {
    const ce = engine();
    const pc = ce.box(['GroupPcgs', cyclic]).evaluate();
    expect(pc.operator).toBe('GroupPcSequence');
    expect(isFunction(pc, 'GroupPcSequence') && pc.ops.length).toBe(2);
    expect(
      ce
        .box([
          'GroupPcgs',
          cyclic,
          { dict: { maxElements: 8, maxWork: 100000 } },
        ])
        .evaluate().json
    ).toEqual(pc.json);
    expect(
      ce
        .box(['GroupPcRelativeOrders', pc.json, { dict: { maxElements: 2 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
  });
  test('checked table construction and representation conversions respect loader ceilings', () => {
    const ce = engine();
    const table: MathJsonExpression = [
      'GroupFromTable',
      ['List', ['List', 0, 1], ['List', 1, 0]],
    ];
    expect(ce.box(['GroupOrder', table]).evaluate().json).toBe(2);
    expect(
      ce
        .box(['GroupFromTable', ['List', ['List', 0, 1], ['List', 1, 1]]])
        .evaluate()
        .has('Error')
    ).toBe(true);
    const small = new ComputeEngine();
    loadGroupTheory(small, { maxDegree: 1, maxGenerators: 1 });
    expect(small.box(table).evaluate().has('Error')).toBe(true);
    const constrained = new ComputeEngine();
    loadGroupTheory(constrained, { maxGenerators: 1 });
    expect(
      constrained
        .box([
          'GroupOrder',
          [
            'GroupFromTable',
            ['List', ['List', 0, 1, 2], ['List', 1, 2, 0], ['List', 2, 0, 1]],
          ],
        ])
        .evaluate().json
    ).toBe(3);
  });
  test('every added signature exposes mathematical input and output types', () => {
    const ce = engine();
    for (const name of [
      'GroupOrder',
      'GroupQuotient',
      'GroupHomomorphism',
      'GroupHomomorphismApply',
      'GroupPcSequence',
      'GroupPcgs',
      'GroupMatrix',
      'GroupAutomorphisms',
    ]) {
      const definition = ce.lookupDefinition(name);
      const signature =
        definition && 'operator' in definition
          ? String(definition.operator.signature)
          : '';
      expect(signature).not.toMatch(/\bany\b/);
      expect(signature).toContain('options: dictionary<integer>?');
    }
    expect(ce.box(['GroupHomomorphismApply', 3, transposition]).isValid).toBe(
      false
    );
    const outcome = executeEpsil(
      ce,
      `
let g=PermutationGroup([Permutation([2,3,4,1])],PermutationAction(4))
let h=PermutationGroup([Permutation([3,4,1,2])],PermutationAction(4))
let q=GroupQuotient(g,h)
let f=GroupQuotientProjection(q)
(GroupOrder(GroupQuotientGroup(q)),GroupOrder(GroupHomomorphismKernel(f)))
`
    );
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.value.json).toEqual(['Tuple', 2, 2]);
  });
});
