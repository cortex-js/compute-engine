import { GroupWork } from '../../src/compute-engine/group-theory/finite-group';
import { collectedPcDefinitions } from '../../src/compute-engine/library/pc-group-theory';
import { CollectedPcGroup } from '../../src/compute-engine/group-theory/polycyclic-presentation';
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

test('boxed presentation proofs are reused without changing the work allowance', () => {
  const ce = engine();
  const descriptor = ce.box(dihedral(101)).evaluate();
  const value = ce
    .function('PcElement', [descriptor, ce.box(['List', 1, 23])])
    .evaluate();
  const extend = jest.spyOn(CollectedPcGroup, 'extend');
  try {
    const result = ce.function('PcPower', [value, ce.number(7)]).evaluate();
    expect(result.has('Error')).toBe(false);
    expect(extend).not.toHaveBeenCalled();
    expect(
      ce
        .function('PcPower', [
          value,
          ce.number(11),
          ce.box({ dict: { maxWork: 10 } }),
        ])
        .evaluate()
        .has('Error')
    ).toBe(true);
    expect(extend).not.toHaveBeenCalled();
  } finally {
    extend.mockRestore();
  }
});

test('equal transported domains are validated once within multiplication', () => {
  const ce = engine();
  const left = ce.box(element(dihedral(101), 1, 23), { form: 'raw' });
  const right = ce.box(element(dihedral(101), 0, 7), { form: 'raw' });
  // Call the reader through the evaluator without separately evaluating operands.
  const definitions = collectedPcDefinitions(ce, 50_000_000);
  const evaluate = definitions.PcMultiply.evaluate;
  if (typeof evaluate !== 'function')
    throw new Error('missing PcMultiply evaluator');
  const extend = jest.spyOn(CollectedPcGroup, 'extend');
  try {
    const result = evaluate([left, right], { engine: ce, effects: ce.effects });
    expect(result?.json).toEqual(element(dihedral(101), 1, 30));
    expect(extend).toHaveBeenCalledTimes(2);
    extend.mockClear();
    expect(
      evaluate([left, right], { engine: ce, effects: ce.effects })?.json
    ).toEqual(result?.json);
    expect(extend).not.toHaveBeenCalled();
  } finally {
    extend.mockRestore();
  }
});

test('cached presentations retain cold-budget outcomes, deadlines and nested errors', () => {
  const ce = engine();
  const group = ce.box(dihedral(101), { form: 'raw' });
  const warm = collectedPcDefinitions(ce, 50_000_000).PcGroupOrder.evaluate;
  if (typeof warm !== 'function')
    throw new Error('missing PcGroupOrder evaluator');
  expect(warm([group], { engine: ce, effects: ce.effects })?.json).toBe(202);
  for (const maxWork of [0, 10, 100, 1000, 50000]) {
    const cold = collectedPcDefinitions(ce, 50_000_000).PcGroupOrder.evaluate;
    if (typeof cold !== 'function')
      throw new Error('missing PcGroupOrder evaluator');
    const operands = [group, ce.box({ dict: { maxWork } })];
    expect(warm(operands, { engine: ce, effects: ce.effects })?.json).toEqual(
      cold(operands, { engine: ce, effects: ce.effects })?.json
    );
  }
  const previous = ce._deadlineFrame;
  try {
    ce._deadlineFrame = { at: 1, spans: [] };
    expect(() => warm([group], { engine: ce, effects: ce.effects })).toThrow();
  } finally {
    ce._deadlineFrame = previous;
  }
  const coordinates = collectedPcDefinitions(ce, 50_000_000).PcCoordinates
    .evaluate;
  if (typeof coordinates !== 'function')
    throw new Error('missing PcCoordinates evaluator');
  const error = ce.error('nested-coordinate-error');
  const value = ce._fn('PcElement', [group, ce._fn('List', [error, ce.Zero])]);
  expect(coordinates([value], { engine: ce, effects: ce.effects })).toBe(error);
});

test('UT(4,101) arithmetic reuses a nonabelian presentation of order above 10^12', () => {
  // Generators are elementary transvections (12),(13),(14),(23),(24),(34).
  // Conjugate rows encode gi^-1 gj gi in the suffix following gi.
  const nested = (value: number | unknown[]): MathJsonExpression =>
    typeof value === 'number'
      ? value
      : ['List', ...value.map((x) => nested(x as number | unknown[]))];
  const group: MathJsonExpression = [
    'PcGroup',
    nested([101, 101, 101, 101, 101, 101]),
    nested([[0, 0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0], [0, 0], [0], []]),
    nested([
      [
        [1, 0, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [100, 0, 1, 0, 0],
        [0, 100, 0, 1, 0],
        [0, 0, 0, 0, 1],
      ],
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [100, 0, 0, 1],
      ],
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [1, 0],
        [100, 1],
      ],
      [[1]],
      [],
    ]),
    nested([
      [
        [1, 0, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [1, 0, 1, 0, 0],
        [0, 1, 0, 1, 0],
        [0, 0, 0, 0, 1],
      ],
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [1, 0, 0, 1],
      ],
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [1, 0],
        [1, 1],
      ],
      [[1]],
      [],
    ]),
  ];
  const ce = engine();
  const descriptor = ce.box(group).evaluate();
  expect(ce.function('PcGroupOrder', [descriptor]).evaluate().json).toBe(
    101 ** 6
  );
  const value = ce
    .function('PcElement', [descriptor, ce.box(['List', 2, 3, 5, 7, 11, 13])])
    .evaluate();
  const extend = jest.spyOn(CollectedPcGroup, 'extend');
  try {
    const inverse = ce.function('PcInverse', [value]).evaluate();
    expect(
      ce
        .function('PcCoordinates', [
          ce.function('PcMultiply', [value, inverse]),
        ])
        .evaluate().json
    ).toEqual(['List', 0, 0, 0, 0, 0, 0]);
    expect(
      ce
        .function('PcCoordinates', [
          ce.function('PcPower', [value, ce.number(101)]),
        ])
        .evaluate().json
    ).toEqual(['List', 0, 0, 0, 0, 0, 0]);
    expect(extend).not.toHaveBeenCalled();
  } finally {
    extend.mockRestore();
  }
});

test('equal-domain multiplication reserves identical cold and warm logical work', () => {
  const ce = engine();
  const definitions = collectedPcDefinitions(ce, 50_000_000);
  const evaluate = definitions.PcMultiply.evaluate;
  if (typeof evaluate !== 'function')
    throw new Error('missing PcMultiply evaluator');
  const operands = [
    ce.box(element(dihedral(101), 1, 23), { form: 'raw' }),
    ce.box(element(dihedral(101), 0, 7), { form: 'raw' }),
  ];
  let charged = 0;
  const original = GroupWork.prototype.tick;
  const tick = jest
    .spyOn(GroupWork.prototype, 'tick')
    .mockImplementation(function (this: GroupWork, count = 1) {
      charged += count;
      original.call(this, count);
    });
  try {
    expect(
      evaluate(operands, { engine: ce, effects: ce.effects })?.has('Error')
    ).toBe(false);
    const cold = charged;
    charged = 0;
    expect(
      evaluate(operands, { engine: ce, effects: ce.effects })?.has('Error')
    ).toBe(false);
    expect(charged).toBe(cold);
    expect(
      evaluate([...operands, ce.box({ dict: { maxWork: cold - 1 } })], {
        engine: ce,
        effects: ce.effects,
      })?.has('Error')
    ).toBe(true);
    expect(
      evaluate([...operands, ce.box({ dict: { maxWork: cold } })], {
        engine: ce,
        effects: ce.effects,
      })?.has('Error')
    ).toBe(false);
  } finally {
    tick.mockRestore();
  }
});

test('UT(9,2) multiplication fits the default work allowance with equal domains', () => {
  const pairs: [number, number][] = [];
  for (let i = 0; i < 9; i++)
    for (let j = i + 1; j < 9; j++) pairs.push([i, j]);
  const rank = pairs.length;
  // Lexicographic elementary transvections have normal suffixes. In F2,
  // gi^-1 gj gi adds transvection (i,l) exactly when gi=(i,k), gj=(k,l).
  const conjugates = pairs.map(([i, j], a) =>
    pairs.slice(a + 1).map(([k, l], b) => {
      const coordinates = Array<number>(rank - a - 1).fill(0);
      coordinates[b] = 1;
      if (j === k)
        coordinates[pairs.findIndex(([u, v]) => u === i && v === l) - a - 1] =
          1;
      return coordinates;
    })
  );
  type NestedIntegers = number | NestedIntegers[];
  const list = (value: NestedIntegers): MathJsonExpression =>
    typeof value === 'number' ? value : ['List', ...value.map(list)];
  const group: MathJsonExpression = [
    'PcGroup',
    list(Array<number>(rank).fill(2)),
    list(pairs.map((_, i) => Array<number>(rank - i - 1).fill(0))),
    list(conjugates),
    list(conjugates),
  ];
  const ce = engine();
  const operands = Array.from({ length: 2 }, () =>
    ce.box(element(group, ...Array<number>(rank).fill(1)), { form: 'raw' })
  );
  const evaluate = collectedPcDefinitions(ce, 50_000_000).PcMultiply.evaluate;
  if (typeof evaluate !== 'function')
    throw new Error('missing PcMultiply evaluator');
  const context = { engine: ce, effects: ce.effects };
  const result = evaluate(operands, context);
  // The all-one coordinate word is I+N for the superdiagonal shift N.
  // Its square I+N² has one coordinate at each even distance above the diagonal.
  expect(result?.json).toEqual(
    element(group, ...pairs.map(([i, j]) => Number((j - i) % 2 === 0)))
  );
  expect(evaluate(operands, context)?.json).toEqual(result?.json);
});
