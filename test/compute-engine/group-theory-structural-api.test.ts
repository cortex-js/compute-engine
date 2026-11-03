import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { loadGroupTheory } from '../../src/group-theory';
import { CancellationError } from '../../src/common/interruptible';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

function permutation(...images: number[]): MathJsonExpression {
  return ['Permutation', ['List', ...images]];
}
function group(...generators: MathJsonExpression[]): MathJsonExpression {
  return [
    'PermutationGroup',
    ['List', ...generators],
    ['PermutationAction', 4],
  ];
}
const identity = permutation(),
  swap = permutation(2, 1),
  otherSwap = permutation(1, 3, 2);
const cycle = permutation(2, 3, 1),
  rotation = permutation(2, 3, 4, 1);
const symmetric3 = group(swap, cycle),
  symmetric4 = group(swap, rotation);
const alternating4 = group(cycle, permutation(2, 1, 4, 3));
const cyclic3 = group(cycle),
  cyclic4 = group(rotation),
  reflection = group(swap);
const trivial = group();
const klein4 = group(permutation(2, 1, 4, 3), permutation(3, 4, 1, 2));

function engine() {
  const ce = new ComputeEngine();
  loadGroupTheory(ce);
  return ce;
}
const ce = engine();
function evaluate(name: string, ...args: MathJsonExpression[]) {
  const result = ce.box([name, ...args]).evaluate();
  expect(result.has('Error') ? result.json : undefined).toBeUndefined();
  return result;
}
function application(value: Expression) {
  if (!isFunction(value))
    throw new Error(
      'Expected a function expression: ' + JSON.stringify(value.json)
    );
  return value;
}
function order(value: MathJsonExpression) {
  return evaluate('GroupOrder', value).json;
}
function subgroupOrders(name: string, ...args: MathJsonExpression[]) {
  return application(evaluate(name, ...args)).ops.map((subgroup) =>
    order(subgroup.json)
  );
}
function lengths(name: string, ...args: MathJsonExpression[]) {
  return application(evaluate(name, ...args))
    .ops.map((item) => application(item).ops.length)
    .sort((a, b) => a - b);
}

describe('generic structural group operators through the optional public loader', () => {
  test.each([
    ['GroupOrder', symmetric3, 6],
    ['GroupIsAbelian', symmetric3, 'False'],
    ['GroupIsAbelian', klein4, 'True'],
    ['GroupIsCyclic', cyclic4, 'True'],
    ['GroupIsCyclic', klein4, 'False'],
    ['GroupIsSolvable', symmetric4, 'True'],
    ['GroupIsNilpotent', cyclic4, 'True'],
    ['GroupIsNilpotent', symmetric3, 'False'],
    ['GroupIsPerfect', symmetric3, 'False'],
    ['GroupIsPerfect', trivial, 'True'],
    ['GroupIsSimple', cyclic3, 'True'],
    ['GroupIsSimple', cyclic4, 'False'],
    ['GroupIsElementaryAbelian', klein4, 'True'],
    ['GroupIsElementaryAbelian', cyclic4, 'False'],
    ['GroupIsPGroup', cyclic4, 'True'],
    ['GroupIsPGroup', symmetric3, 'False'],
    ['GroupIsSupersolvable', symmetric3, 'True'],
    ['GroupIsSupersolvable', alternating4, 'False'],
    ['GroupExponent', symmetric4, 12],
    ['GroupNilpotencyClass', cyclic4, 1],
    ['GroupNilpotencyClass', symmetric3, 'Nothing'],
    ['GroupPrime', cyclic4, 2],
    ['GroupPrime', symmetric3, 'Nothing'],
  ] as [string, MathJsonExpression, MathJsonExpression][])(
    '%s on its known finite fixture',
    (name, input, expected) => {
      expect(evaluate(name, input).json).toEqual(expected);
    }
  );
  test.each([
    ['GroupContains', symmetric3, swap, 'True'],
    ['GroupContains', symmetric3, rotation, 'False'],
    ['GroupIsSubgroup', symmetric3, cyclic3, 'True'],
    ['GroupIsSubgroup', symmetric3, cyclic4, 'False'],
    ['GroupEqual', symmetric3, group(cycle, swap), 'True'],
    ['GroupEqual', symmetric3, cyclic3, 'False'],
    ['GroupIsNormal', symmetric3, cyclic3, 'True'],
    ['GroupIsNormal', symmetric3, reflection, 'False'],
    ['GroupIndex', symmetric3, cyclic3, 2],
    ['GroupIsSubnormal', symmetric3, cyclic3, 'True'],
    ['GroupIsSubnormal', symmetric3, reflection, 'False'],
    ['GroupIsCharacteristic', symmetric3, cyclic3, 'True'],
    ['GroupIsCharacteristic', symmetric3, reflection, 'False'],
  ] as [string, MathJsonExpression, MathJsonExpression, MathJsonExpression][])(
    '%s checks a relation',
    (name, left, right, expected) => {
      expect(evaluate(name, left, right).json).toEqual(expected);
    }
  );
  test.each([
    ['GroupCenter', symmetric3, [], 1],
    ['GroupDerivedSubgroup', symmetric3, [], 3],
    ['GroupFrattiniSubgroup', symmetric3, [], 1],
    ['GroupFittingSubgroup', symmetric3, [], 3],
    ['GroupSolvableRadical', symmetric3, [], 6],
    ['GroupSocle', symmetric3, [], 3],
    ['GroupCentralizer', symmetric3, [cyclic3], 3],
    ['GroupNormalizer', symmetric3, [reflection], 2],
    ['GroupNormalClosure', symmetric3, [reflection], 6],
    ['GroupCore', symmetric3, [reflection], 1],
    ['GroupCommutatorSubgroup', reflection, [cyclic3], 3],
    ['GroupIntersection', reflection, [cyclic3], 1],
    ['GroupJoin', reflection, [cyclic3], 6],
    ['GroupSylowSubgroup', symmetric4, [2], 8],
    ['GroupPCore', symmetric3, [3], 3],
    ['GroupOmega', cyclic4, [2, 1], 2],
    ['GroupAgemo', cyclic4, [2, 1], 2],
  ] as [string, MathJsonExpression, MathJsonExpression[], number][])(
    '%s returns a group with the expected order',
    (name, input, args, expected) => {
      const result = evaluate(name, input, ...args);
      expect(order(result.json)).toBe(expected);
    }
  );
  test.each([
    ['GroupDerivedSeries', symmetric3, [], [6, 3, 1]],
    ['GroupLowerCentralSeries', symmetric3, [], [6, 3]],
    ['GroupUpperCentralSeries', symmetric3, [], [1]],
    ['GroupCompositionSeries', symmetric4, [], [24, 12, 4, 2, 1]],
    ['GroupChiefSeries', symmetric4, [], [24, 12, 4, 1]],
    ['GroupPCentralSeries', cyclic4, [2], [4, 2, 1]],
  ] as [string, MathJsonExpression, MathJsonExpression[], number[]][])(
    '%s retains its mathematical order',
    (name, input, args, expected) => {
      expect(subgroupOrders(name, input, ...args)).toEqual(expected);
    }
  );
  test('subgroup lists, Hall groups and complements have complete cardinalities', () => {
    expect(
      subgroupOrders('GroupSubgroups', symmetric3).sort(
        (a, b) => Number(a) - Number(b)
      )
    ).toEqual([1, 2, 2, 2, 3, 6]);
    expect(
      subgroupOrders('GroupNormalSubgroups', symmetric4).sort(
        (a, b) => Number(a) - Number(b)
      )
    ).toEqual([1, 4, 12, 24]);
    expect(
      subgroupOrders('GroupMaximalSubgroups', symmetric3).sort(
        (a, b) => Number(a) - Number(b)
      )
    ).toEqual([2, 2, 2, 3]);
    expect(
      subgroupOrders('GroupHallSubgroups', symmetric3, ['List', 3])
    ).toEqual([3]);
    expect(
      subgroupOrders('GroupComplementRepresentatives', symmetric3, cyclic3)
    ).toEqual([2]);
    expect(lengths('GroupSubgroupConjugacyClasses', symmetric3)).toEqual([
      1, 1, 1, 3,
    ]);
  });
  test('cosets, classes and transversals partition the expected sets', () => {
    expect(lengths('GroupConjugacyClasses', symmetric3)).toEqual([1, 2, 3]);
    expect(lengths('GroupRationalClasses', symmetric3)).toEqual([1, 2, 3]);
    expect(lengths('GroupRightCosets', symmetric3, reflection)).toEqual([
      2, 2, 2,
    ]);
    expect(
      application(evaluate('GroupRightTransversal', symmetric3, reflection)).ops
    ).toHaveLength(3);
    expect(
      lengths('GroupDoubleCosets', symmetric3, reflection, reflection)
    ).toEqual([2, 4]);
    expect(evaluate('GroupIsConjugate', symmetric3, swap, otherSwap).json).toBe(
      'True'
    );
    expect(evaluate('GroupIsConjugate', symmetric3, swap, cycle).json).toBe(
      'False'
    );
  });
  test('generator, factorization and root data reconstruct the corresponding elements', () => {
    expect(evaluate('GroupGenerators', symmetric3).json).toEqual([
      'List',
      swap,
      cycle,
    ]);
    expect(evaluate('GroupIdentity', symmetric3).json).toEqual(identity);
    expect(application(evaluate('GroupElements', symmetric3)).ops).toHaveLength(
      6
    );
    expect(evaluate('GroupAbelianInvariants', symmetric3).json).toEqual([
      'List',
      2,
    ]);
    expect(evaluate('GroupEulerianFunction', symmetric3, 2).json).toBe(18);
    const minimum = evaluate('GroupMinimalGenerators', symmetric3);
    expect(application(minimum).ops).toHaveLength(2);
    expect(
      evaluate(
        'GroupEqual',
        group(...application(minimum).ops.map((x) => x.json)),
        symmetric3
      ).json
    ).toBe('True');
    const independent = evaluate('GroupIndependentAbelianGenerators', cyclic4);
    expect(application(independent).ops).toHaveLength(1);
    expect(
      evaluate('PermutationOrder', application(independent).op1.json).json
    ).toBe(4);
    expect(evaluate('GroupFactorization', symmetric3, cycle).json).toEqual([
      'List',
      2,
    ]);
    expect(
      application(evaluate('GroupNthRoots', cyclic4, identity, 2)).ops
    ).toHaveLength(2);
    expect(evaluate('GroupCommutatorLength', symmetric3, cycle).json).toBe(1);
    expect(evaluate('GroupCommutatorLength', symmetric3, swap).json).toBe(
      'Nothing'
    );
  });
  test('automorphisms are complete maps and a quotient exposes its factor group', () => {
    const maps = evaluate('GroupAutomorphisms', symmetric3);
    expect(application(maps).ops).toHaveLength(6);
    for (const map of application(maps).ops) {
      expect(map.operator).toBe('GroupHomomorphism');
      expect(order(evaluate('GroupHomomorphismImage', map.json).json)).toBe(6);
      expect(order(evaluate('GroupHomomorphismKernel', map.json).json)).toBe(1);
    }
    const quotient = evaluate('GroupQuotient', symmetric3, cyclic3);
    expect(order(evaluate('GroupQuotientGroup', quotient.json).json)).toBe(2);
  });
  test('mathematical nonexistence is distinct from resource exhaustion', () => {
    expect(evaluate('GroupIsSimple', symmetric3).json).toBe('False');
    expect(evaluate('GroupPrime', symmetric3).json).toBe('Nothing');
    expect(
      application(
        evaluate(
          'GroupComplementRepresentatives',
          cyclic4,
          group(permutation(3, 4, 1, 2))
        )
      ).ops
    ).toHaveLength(0);
    const limited = ce
      .box(['GroupSubgroups', symmetric3, { dict: { maxWork: 0 } }])
      .evaluate();
    expect(limited.has('Error')).toBe(true);
    expect(JSON.stringify(limited.json)).toContain('group-work-limit');
    expect(
      ce
        .box(['GroupElements', symmetric3, { dict: { maxElements: 5 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
    expect(
      ce
        .box(['GroupOrder', symmetric3, { dict: { unknownLimit: 1 } }])
        .evaluate()
        .has('Error')
    ).toBe(true);
  });
  test('typed boundaries preserve nested input diagnostics, unresolved operands and cancellation', () => {
    expect(ce.box(['GroupCenter', 3]).isValid).toBe(false);
    expect(ce.box(['GroupOmega', cyclic4, 'True', 1]).isValid).toBe(false);
    const malformed = group(permutation(1, 1));
    expect(
      JSON.stringify(
        ce.box(['GroupDerivedSubgroup', malformed]).evaluate().json
      )
    ).toContain('duplicate-permutation-image');
    const symbolic = ce.box(['GroupCenter', 'unknown_group']);
    expect(symbolic.evaluate().json).toEqual(symbolic.json);
    const fresh = engine(),
      call = fresh.box(['GroupSubgroups', symmetric4]);
    expect(() =>
      fresh.withStepBudget({ steps: 0, label: 'finite-structural-query' }, () =>
        call.evaluate()
      )
    ).toThrow(CancellationError);
    expect(fresh.box(['GroupOrder', symmetric3]).evaluate().json).toBe(6);
  });
  test('Epsil accepts the optional pcgs return type and named execution options', () => {
    const fresh = engine();
    const result = executeEpsil(
      fresh,
      `
let g=PermutationGroup([Permutation([2,3,4,1])],PermutationAction(4))
let pc: GroupPcSequence | nothing = GroupPcgs(g, options: {maxWork -> 100000})
pc
`
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.operator).toBe('GroupPcSequence');
  });
});

/** The regular row action preserves the right-product convention: e_i P=e_{i^p}. */
function asMatrices(input: MathJsonExpression): MathJsonExpression {
  if (!Array.isArray(input)) return input;
  if (input[0] === 'Permutation') {
    const images = (input[1] as MathJsonExpression[]).slice(1) as number[];
    return [
      'GroupMatrix',
      0,
      [
        'List',
        ...Array.from(
          { length: 4 },
          (_, row) =>
            [
              'List',
              ...Array.from({ length: 4 }, (_, column) =>
                (images[row] ?? row + 1) === column + 1 ? 1 : 0
              ),
            ] as MathJsonExpression
        ),
      ],
    ];
  }
  if (input[0] === 'PermutationGroup') {
    const generators = (input[1] as MathJsonExpression[]).slice(1);
    return ['MatrixGroup', 4, 0, ['List', ...generators.map(asMatrices)]];
  }
  const [operator, ...args] = input;
  if (typeof operator !== 'string')
    throw new Error('Invalid matrix test fixture');
  return [operator, ...args.map(asMatrices)];
}

describe('generic structural operators preserve matrix representations', () => {
  test.each([
    ['GroupOrder', [symmetric3], 6],
    ['GroupIsAbelian', [symmetric3], 'False'],
    ['GroupContains', [symmetric3, swap], 'True'],
    ['GroupContains', [symmetric3, rotation], 'False'],
    ['GroupIsSubgroup', [symmetric3, cyclic3], 'True'],
    ['GroupIsSubgroup', [symmetric3, cyclic4], 'False'],
    ['GroupEqual', [symmetric3, group(cycle, swap)], 'True'],
    ['GroupIsNormal', [symmetric3, cyclic3], 'True'],
    ['GroupIndex', [symmetric3, cyclic3], 2],
    ['GroupIsConjugate', [symmetric3, swap, otherSwap], 'True'],
    ['GroupIsCyclic', [cyclic4], 'True'],
    ['GroupIsSolvable', [symmetric3], 'True'],
    ['GroupIsNilpotent', [symmetric3], 'False'],
    ['GroupIsPerfect', [symmetric3], 'False'],
    ['GroupIsSimple', [cyclic3], 'True'],
    ['GroupIsElementaryAbelian', [klein4], 'True'],
    ['GroupIsPGroup', [cyclic4], 'True'],
    ['GroupIsSupersolvable', [symmetric3], 'True'],
    ['GroupExponent', [symmetric3], 6],
    ['GroupNilpotencyClass', [cyclic4], 1],
    ['GroupPrime', [symmetric3], 'Nothing'],
    ['GroupIsSubnormal', [symmetric3, reflection], 'False'],
    ['GroupIsCharacteristic', [symmetric3, cyclic3], 'True'],
    ['GroupCommutatorLength', [symmetric3, swap], 'Nothing'],
    ['GroupEulerianFunction', [symmetric3, 2], 18],
  ] as [string, MathJsonExpression[], MathJsonExpression][])(
    '%s accepts matrix group descriptors',
    (name, args, expected) => {
      expect(evaluate(name, ...args.map(asMatrices)).json).toEqual(expected);
    }
  );
  test.each([
    ['GroupCenter', [symmetric3], 1],
    ['GroupDerivedSubgroup', [symmetric3], 3],
    ['GroupFrattiniSubgroup', [cyclic4], 2],
    ['GroupFittingSubgroup', [symmetric3], 3],
    ['GroupSolvableRadical', [symmetric3], 6],
    ['GroupSocle', [symmetric3], 3],
    ['GroupCentralizer', [symmetric3, cyclic3], 3],
    ['GroupNormalizer', [symmetric3, reflection], 2],
    ['GroupNormalClosure', [symmetric3, reflection], 6],
    ['GroupCore', [symmetric3, reflection], 1],
    ['GroupCommutatorSubgroup', [reflection, cyclic3], 3],
    ['GroupIntersection', [reflection, cyclic3], 1],
    ['GroupJoin', [reflection, cyclic3], 6],
    ['GroupSylowSubgroup', [symmetric3, 2], 2],
    ['GroupPCore', [symmetric3, 3], 3],
    ['GroupOmega', [cyclic4, 2, 1], 2],
    ['GroupAgemo', [cyclic4, 2, 1], 2],
  ] as [string, MathJsonExpression[], number][])(
    '%s keeps subgroup results as matrix groups',
    (name, args, expected) => {
      const result = evaluate(name, ...args.map(asMatrices));
      expect(result.operator).toBe('MatrixGroup');
      expect(order(result.json)).toBe(expected);
    }
  );
  test('matrix elements, series, conjugacy classes and factorization keep exact values', () => {
    const matrixGroup = asMatrices(symmetric3);
    expect(evaluate('GroupIdentity', matrixGroup).json).toEqual(
      asMatrices(identity)
    );
    expect(evaluate('GroupGenerators', matrixGroup).json).toEqual(
      asMatrices(['List', swap, cycle])
    );
    const elements = application(evaluate('GroupElements', matrixGroup)).ops;
    expect(elements).toHaveLength(6);
    expect(
      elements.every((element) => element.operator === 'GroupMatrix')
    ).toBe(true);
    expect(subgroupOrders('GroupDerivedSeries', matrixGroup)).toEqual([
      6, 3, 1,
    ]);
    expect(lengths('GroupConjugacyClasses', matrixGroup)).toEqual([1, 2, 3]);
    expect(
      evaluate('GroupFactorization', matrixGroup, asMatrices(cycle)).json
    ).toEqual(['List', 2]);
    expect(
      application(evaluate('GroupMinimalGenerators', matrixGroup)).ops
    ).toHaveLength(2);
    expect(evaluate('GroupAbelianInvariants', matrixGroup).json).toEqual([
      'List',
      2,
    ]);
  });
  test('mixed representations are incompatible rather than accidentally equal', () => {
    for (const name of [
      'GroupEqual',
      'GroupJoin',
      'GroupIntersection',
      'GroupIsSubgroup',
    ])
      expect(
        ce
          .box([name, symmetric3, asMatrices(symmetric3)])
          .evaluate()
          .has('Error')
      ).toBe(true);
    expect(
      ce
        .box(['GroupContains', asMatrices(symmetric3), swap])
        .evaluate()
        .has('Error')
    ).toBe(true);
  });
});
