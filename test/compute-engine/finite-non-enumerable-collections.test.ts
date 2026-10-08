/**
 * A finite collection can know its size and still have no computable
 * elements. `Linspace(a, 1, 3)` with a symbolic `a` has `count` 3, but its
 * elements are not numbers yet. `isFiniteCollection` is `true`,
 * `isEnumerableCollection` is `false`, and `each()` yields nothing.
 *
 * An operator that checked only `isFiniteCollection` and then walked the
 * elements read such a collection as EMPTY and gave a wrong answer with no
 * diagnostic (`Union(Linspace(a, 1, 3), Set(1))` was `Set(1)`). The operators
 * now check `isWalkableFiniteCollection()` (`collection-utils.ts`) and stay
 * unevaluated.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

type Json = Parameters<ComputeEngine['box']>[0];

const LINSPACE: Json = ['Linspace', 'a', 1, 3];
// The same elements as a set, the operand type that the set operators take.
const LSET: Json = ['SetFrom', LINSPACE];
// Five elements, none computable: a count that differs from a three-element list.
const LINSPACE5: Json = ['Linspace', 'a', 1, 5];

const COLLECTIONS: [string, Json][] = [['Linspace(a, 1, 3)', LINSPACE]];

describe('a collection with a count and no computable elements', () => {
  const ce = new ComputeEngine();
  for (const [name, json] of COLLECTIONS) {
    test(name, () => {
      const xs = ce.box(json);
      expect(xs.isFiniteCollection).toBe(true);
      expect(xs.isEnumerableCollection).toBe(false);
      expect(typeof xs.count).toBe('number');
      expect([...xs.each()]).toEqual([]);
    });
  }
});

describe('operators that walk the elements stay unevaluated', () => {
  const ce = new ComputeEngine();
  for (const [name, xs] of COLLECTIONS) {
    const cases: [string, Json][] = [
      ['Union', ['Union', xs, ['Set', 1]]],
      ['Unique', ['Unique', xs]],
      ['Tally', ['Tally', xs]],
      ['Intersection', ['Intersection', xs, ['Set', 1]]],
      ['ListFrom', ['ListFrom', xs]],
      ['SetFrom', ['SetFrom', xs]],
      ['SubsetEqual', ['SubsetEqual', xs, ['Set', 1]]],
    ];
    cases.push(['Sort', ['Sort', xs]]);
    for (const [op, json] of cases) {
      test(`${op} over ${name}`, () => {
        const result = ce.box(json).evaluate();
        expect(result.operator).toBe(op);
        expect(result.isValid).toBe(true);
      });
    }
  }

  test('a positional read inside the range stays unevaluated', () => {
    expect(ce.box(['First', LINSPACE]).evaluate().operator).toBe('First');
    expect(ce.box(['At', LINSPACE, 2]).evaluate().operator).toBe('At');
    expect(ce.box(['PointX', LINSPACE]).evaluate().operator).toBe('PointX');
  });

  test('a positional read outside the range is the absence marker', () => {
    expect(ce.box(['At', LINSPACE, 5]).evaluate().toString()).toBe('NaN');
  });

  test('membership is not decided', () => {
    // 1 is the last element of `Linspace(a, 1, 3)`: the intersection with a
    // concrete list is not empty, and it is not decided.
    expect(
      ce.box(['Intersection', ['List', 1, 2, 3], LINSPACE]).evaluate().operator
    ).toBe('Intersection');
  });

  test('a comparison with a concrete list is not decided', () => {
    const list: Json = ['List', 1, 2, 3];
    expect(ce.box(['Equal', LINSPACE, list]).evaluate().operator).toBe('Equal');
    expect(ce.box(['Equal', list, LINSPACE]).evaluate().operator).toBe('Equal');
    expect(
      ce.box(['IdenticallyEqual', LINSPACE, list]).evaluate().operator
    ).toBe('IdenticallyEqual');
    expect(ce.box(LINSPACE).isEqual(ce.box(list))).toBeUndefined();
    // Known counts that differ still decide the comparison.
    expect(ce.box(['Equal', LINSPACE5, list]).evaluate().json).toBe('False');
    // The same expression on both sides is still equal.
    expect(ce.box(['Equal', LINSPACE, LINSPACE]).evaluate().json).toBe('True');
  });

  test('an element-wise function takes the lazy form', () => {
    expect(ce.box(['Sin', LINSPACE]).evaluate().operator).toBe('Map');
  });

  test('paired statistics stay unevaluated', () => {
    for (const op of ['Covariance', 'Correlation', 'LinearRegression']) {
      const result = ce.box([op, LINSPACE, ['List', 1, 2, 3]]).evaluate();
      expect(result.operator).toBe(op);
      expect(result.isValid).toBe(true);
    }
  });
});

describe('operators that decide membership or splice elements', () => {
  const ce = new ComputeEngine();
  const evaluate = (json: Json): string => ce.box(json).evaluate().toString();

  // An undecided membership in a removed operand is not an absence.
  test('SetMinus with a removed operand that has no computable elements', () => {
    expect(evaluate(['SetMinus', ['Set', 1], LINSPACE])).toBe(
      'SetMinus(Set(1), Linspace(a, 1, 3))'
    );
  });

  // The held difference has no count and cannot be walked: its iterator and
  // its `count` handler read an undecided membership as "not removed".
  test('a held SetMinus has no count and is not walked', () => {
    expect(
      ce.box(['Count', ['SetMinus', ['Set', 1], LINSPACE]]).evaluate().operator
    ).toBe('Count');
    expect(
      ce
        .box(['Union', ['SetMinus', ['Set', 1], LINSPACE], ['Set', 2]])
        .evaluate().operator
    ).toBe('Union');
  });

  test('SymmetricDifference with such a collection stays unevaluated', () => {
    expect(evaluate(['SymmetricDifference', ['Set', 1], LSET])).toBe(
      'SymmetricDifference(Set(1), SetFrom(Linspace(a, 1, 3)))'
    );
  });

  // A nested collection with a count but no computable elements cannot be
  // spliced, and it is not one element either.
  test('Flatten over a nested collection with no computable elements', () => {
    expect(evaluate(['Flatten', ['List', ['List', 1], LINSPACE]])).toBe(
      'Flatten([[1],Linspace(a, 1, 3)])'
    );
    expect(evaluate(['Flatten', ['List', ['List', 1], LINSPACE], 1])).toBe(
      'Flatten([[1],Linspace(a, 1, 3)], 1)'
    );
    expect(
      ce.box(['Count', ['Flatten', ['List', LINSPACE, 4]]]).evaluate().operator
    ).toBe('Count');
  });

  test('materializing a list with such a lazy element does not splice it', () => {
    const list = ce.box(['List', 1, LINSPACE]);
    const result = list.evaluate({ materialization: true });
    expect(result.operator).toBe('List');
    expect(result.nops).toBe(2);
    expect(result.op2.isSame(ce.box(LINSPACE))).toBe(true);
  });

  test('When over a carrier with no computable elements', () => {
    expect(evaluate(['When', LINSPACE, ['List', 'True', 'False']])).toBe(
      ce.box(['When', LINSPACE, ['List', 'True', 'False']]).toString()
    );
    expect(
      ce.box(['When', LINSPACE, ['List', 'True', 'False']]).evaluate().operator
    ).toBe('When');
  });

  // A provably empty collection is walkable: the walk yields no elements, and
  // that is the correct answer.
  test('an empty collection with a symbolic bound is walked', () => {
    const empty: Json = ['Linspace', 'a', 1, 0];
    expect(ce.box(empty).isEmptyCollection).toBe(true);
    expect(evaluate(['Union', empty, ['Set', 1]])).toBe('Set(1)');
    expect(evaluate(['Unique', empty])).toBe('[]');
  });

  test('an intersection with an empty first operand is empty', () => {
    expect(ce.box(['Intersection', ['List'], LINSPACE]).evaluate().json).toBe(
      'EmptySet'
    );
    expect(ce.box(['Intersection', 'EmptySet', LINSPACE]).evaluate().json).toBe(
      'EmptySet'
    );
    expect(ce.box(['Intersection', ['Set'], LINSPACE]).evaluate().json).toBe(
      'EmptySet'
    );
  });

  test('positive controls: ordinary collections give concrete answers', () => {
    expect(evaluate(['SetMinus', ['Set', 1, 2], ['Set', 2]])).toBe('Set(1)');
    expect(evaluate(['Flatten', ['List', ['List', 1], ['List', 2, 3]]])).toBe(
      '[1,2,3]'
    );
    // An undecided membership among enumerable sets drops the element:
    // different symbols are different elements.
    expect(
      evaluate([
        'Intersection',
        ['Set', 'a', 'b', 'c'],
        ['Set', 'd', 'c', 'b'],
        ['Set', 'b', 'f'],
      ])
    ).toBe('Set(b)');
    expect(evaluate(['When', ['Set', 1, 2], ['List', 'True', 'False']])).toBe(
      '[1,NaN]'
    );
    // The range is one element of the list, so it materializes as a nested
    // list (it is not spliced into the outer list).
    expect(
      ce
        .box(['List', 1, ['Range', 1, 3]])
        .evaluate({ materialization: true })
        .toString()
    ).toBe('[1,[1,2,3]]');
  });
});

/**
 * Is `v` a concrete answer that a walk of an empty collection would give: an
 * empty collection (`EmptySet`, `[]`, `Set()`, `()`, an empty dictionary, or
 * a tuple of such), a number, or a boolean?
 */
function isConcreteAnswer(v: Expression): boolean {
  const s = v.symbol;
  if (s === 'EmptySet' || s === 'True' || s === 'False') return true;
  if (v.isNumberLiteral) return true;
  const op = v.operator;
  if (op === 'List' || op === 'Set' || op === 'Tuple' || op === 'Dictionary') {
    if (v.isEmptyCollection === true) return true;
    if (op === 'Tuple' && (v.ops ?? []).every((x) => isConcreteAnswer(x)))
      return true;
  }
  return false;
}

function isInternalError(v: Expression): boolean {
  return JSON.stringify(v.json).includes('internal-error');
}

/**
 * Operators the sweep does not apply.
 *
 * An impure operator (an assignment, a declaration, a random draw, printing,
 * reading input) changes the engine state or answers differently on each run,
 * and the sweep must be deterministic. `Timing` answers a measured duration.
 * `Loop` runs its body until the evaluation is canceled. `Solve` reads its
 * first operand as an equation in the free variable `a`, not as a collection,
 * so its answer is about that equation.
 */
const SKIPPED = new Set(['Timing', 'Loop', 'Solve']);

/**
 * Operators whose concrete answer for these collections does not depend on
 * their elements, with the reason.
 */
const ALLOWED: Record<string, string> = {
  // The answer is the count.
  Count: 'count',
  Length: 'count',
  IsEmpty: 'count',
  // A relation with a single operand holds whatever the operand is, and a
  // relation between collections with known, different counts is decided by
  // the counts.
  Equal: 'one operand, or counts that differ',
  NotEqual: 'one operand, or counts that differ',
  IdenticallyEqual: 'one operand, or counts that differ',
  Approx: 'one operand',
  ApproxEqual: 'one operand',
  ApproxNotEqual: 'one operand',
  NotApprox: 'one operand',
  NotApproxEqual: 'one operand',
  NotApproxNotEqual: 'one operand',
  Less: 'one operand',
  LessEqual: 'one operand',
  Greater: 'one operand',
  GreaterEqual: 'one operand',
  NotLess: 'one operand',
  NotLessNotEqual: 'one operand',
  NotGreater: 'one operand',
  NotGreaterNotEqual: 'one operand',
  Precedes: 'one operand',
  Succeeds: 'one operand',
  NotPrecedes: 'one operand',
  NotSucceeds: 'one operand',
  TildeEqual: 'one operand',
  TildeFullEqual: 'one operand',
  NotTildeEqual: 'one operand',
  NotTildeFullEqual: 'one operand',
  Condition: 'a condition with no constraint holds',
  // Structural predicates on the expression, not on its elements.
  IsSame: 'structural',
  Same: 'structural',
  IsError: 'structural',
  IsMissing: 'structural',
  KroneckerDelta: 'structural comparison of the operands',
  // The answer comes from the type: a list of numbers or a set is not a
  // matrix, a set is not an integer, and a set is not an element of a list
  // of numbers (or the reverse).
  IsDiagonal: 'type',
  IsSymmetric: 'type',
  IsSquareMatrix: 'type',
  IsPrime: 'type',
  IsComposite: 'type',
  Contains: 'type of the searched value',
  Element: 'type of the searched value',
  NotElement: 'type of the searched value',
  IndexOf: 'type of the searched value',
  // A count of occurrences of the whole collection in a concrete list.
  // `Count(xs, what)` is listed above.
  // The operand is a constant expression: degree 0, polynomial GCD 1.
  Degree: 'constant expression',
  PolynomialGCD: 'constant expression',
  // `Shape` and `Rank` read the tensor structure of a written-out list. They
  // answer `()` and `0` for any lazy collection or set, `Range(1, 3)` and
  // `Set(1, 2)` included, so the answer does not come from a walk.
  Shape: 'tensor structure of a written-out list only',
  Rank: 'tensor structure of a written-out list only',
};

/**
 * Operators whose second operand is a function. A collection in that position
 * with a free variable is applied as a function of it (`Linspace(a, 1, 3)` is
 * `a ↦ Linspace(a, 1, 3)`), and the walk is over the concrete first operand.
 */
const FUNCTION_SECOND: Set<string> = new Set(['MaxBy', 'MinBy', 'GroupBy']);

describe('sweep: no operator reads these collections as empty', () => {
  const ce = new ComputeEngine();
  const names = new Set<string>();
  for (const lib of ComputeEngine.getStandardLibrary()) {
    const defs = Array.isArray(lib.definitions)
      ? lib.definitions
      : [lib.definitions];
    for (const d of defs) for (const k of Object.keys(d ?? {})) names.add(k);
  }
  const operators = [...names]
    .filter((name) => {
      const def = ce.lookupDefinition(name);
      if (def === undefined || !('operator' in def)) return false;
      if (def.operator.pure === false) return false;
      return !SKIPPED.has(name);
    })
    .sort();

  test('the library has operators to sweep', () => {
    expect(operators.length).toBeGreaterThan(400);
  });

  for (const [name, xs] of COLLECTIONS) {
    test(`over ${name}`, () => {
      const argumentLists: Json[][] = [
        [xs],
        [xs, ['Set', 1]],
        [['Set', 1], xs],
        [xs, ['List', 1, 2, 3]],
        [['List', 1, 2, 3], xs],
      ];
      const failures: string[] = [];
      for (const op of operators) {
        for (const args of argumentLists) {
          const expr = ce.box([op, ...args] as Json);
          // An arity or type error is not a walk.
          if (!expr.isValid) continue;
          let result: Expression;
          try {
            result = expr.evaluate();
          } catch (e) {
            failures.push(`${expr.toString()} threw ${String(e)}`);
            continue;
          }
          if (isInternalError(result)) {
            failures.push(`${expr.toString()} → ${result.toString()}`);
            continue;
          }
          if (ALLOWED[op] !== undefined) continue;
          if (args[0] !== xs && FUNCTION_SECOND.has(op)) continue;
          if (isConcreteAnswer(result))
            failures.push(`${expr.toString()} → ${result.toString()}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('positive controls: the same operators over concrete collections', () => {
  const ce = new ComputeEngine();
  const concrete: Json[] = [
    ['Linspace', 0, 1, 3],
    ['List', 1, 0.5, 0],
  ];
  for (const xs of concrete) {
    const label = ce.box(xs).toString();
    test(`over ${label}`, () => {
      const union = ce.box(['Union', xs, ['Set', 1]]).evaluate();
      expect(union.operator).toBe('Set');
      expect(union.count).toBe(3);
      expect(ce.box(['Unique', xs]).evaluate().count).toBe(3);
      expect(ce.box(['Tally', xs]).evaluate().operator).toBe('Tuple');
      expect(
        ce
          .box(['Intersection', xs, ['Set', 1]])
          .evaluate()
          .toString()
      ).toBe('Set(1)');
      expect(ce.box(['Sort', xs]).evaluate().toString()).toBe('[0,0.5,1]');
      expect(ce.box(['ListFrom', xs]).evaluate().count).toBe(3);
      expect(ce.box(['First', ['Sort', xs]]).evaluate().json).toBe(0);
      expect(ce.box(['Sin', xs]).evaluate().operator).toBe('List');
      expect(ce.box(['Equal', xs, ['List', 0, 0.5, 1]]).evaluate().json).toBe(
        ce.box(xs).operator === 'Linspace' ? 'True' : 'False'
      );
    });
  }
});
