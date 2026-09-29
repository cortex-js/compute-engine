import { ComputeEngine } from '../../src/compute-engine';

// An operand typed `error` always evaluates to an error. The numeric-argument
// check lets such an operand through unchanged (`checkNumericArgs` in
// `validate.ts`), so an arithmetic operator or an elementary function that
// encloses it evaluates to that same error, and its static type is `error`
// too (`appliesToListCoordinateTuple` in `collection-utils.ts`). Before, the
// type depended on the operator: `1 + E` was `error | integer`, `2E` and
// `E / 2` were `number`, `-E` was `error`, and `Sin(Tuple(1, 1) +
// Tuple(A, B))` was `number`. `Abs`, `Hypot`, `Norm`, `Max`, `Min`,
// `Supremum` and `Infimum` answer `error` from their type handlers
// (`hasErrorTypedOperand` in `library/type-handlers.ts`).

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('A', 'list<real>');
  ce.declare('B', 'list<real>');
  return ce;
}

function valuedEngine(): ComputeEngine {
  const ce = engine();
  ce.assign('A', ce.box(['List', 1, 2]));
  ce.assign('B', ce.box(['List', 3, 4]));
  return ce;
}

function errorCode(x: any): string | undefined {
  if (x.operator !== 'Error') return undefined;
  const code = x.op1;
  return code.operator === 'ErrorCode' ? code.op1.string : code.string;
}

/** `Sin(Tuple(A, B))`, with `A`, `B` lists, is typed `error`. */
const E = ['Sin', ['Tuple', 'A', 'B']];

const cases: [string, any][] = [
  ['1 + E', ['Add', 1, E]],
  ['2 · E', ['Multiply', 2, E]],
  ['E / 2', ['Divide', E, 2]],
  ['−E', ['Negate', E]],
  ['E − 1', ['Subtract', E, 1]],
  ['E^2', ['Power', E, 2]],
  ['2^E', ['Power', 2, E]],
  ['Sqrt(E)', ['Sqrt', E]],
  ['Cos(E)', ['Cos', E]],
  ['Ln(E)', ['Ln', E]],
  ['Abs(E)', ['Abs', E]],
  ['Hypot(E, 1)', ['Hypot', E, 1]],
  ['Hypot(1, E)', ['Hypot', 1, E]],
  ['Norm(E)', ['Norm', E]],
  ['Max(E, 1)', ['Max', E, 1]],
  ['Min(E, 1)', ['Min', E, 1]],
  ['Max(E)', ['Max', E]],
  ['Supremum(E, 1)', ['Supremum', E, 1]],
  ['Infimum(E, 1)', ['Infimum', E, 1]],
  [
    'Sin(Tuple(1, 1) + Tuple(A, B))',
    ['Sin', ['Add', ['Tuple', 1, 1], ['Tuple', 'A', 'B']]],
  ],
];

describe('An operator with an operand typed error', () => {
  test('the operand is typed error', () => {
    expect(
      engine()
        .box(E as any)
        .type.toString()
    ).toBe('error');
  });

  test.each(cases)('%s is typed error', (_, json) => {
    const e = engine().box(json);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('error');
  });

  test.each(cases)('%s evaluates to an incompatible-type error', (_, json) => {
    const e = valuedEngine().box(json);
    expect(e.type.toString()).toBe('error');
    expect(errorCode(e.evaluate())).toBe('incompatible-type');
  });

  test('a list that holds an operand typed error is not typed error', () => {
    expect(
      engine()
        .box(['List', E, 1] as any)
        .type.toString()
    ).toBe('list<error | integer>');
  });

  test('an operand that is not typed error keeps the numeric type', () => {
    const ce = engine();
    ce.declare('x', 'real');
    expect(ce.box(['Add', 1, ['Sin', 'x']]).type.toString()).not.toBe('error');
    expect(ce.box(['Sin', ['Add', 1, 'x']]).type.toString()).toBe('real');
    // `Max` over scalar reals carries the operands' range (Tycho item 332).
    expect(ce.box(['Max', 'x', 1]).type.toString()).toBe('real<1..>');
    expect(ce.box(['Abs', 'x']).type.toString()).not.toBe('error');
  });
});

describe('Unary arithmetic methods on an absent operand', () => {
  // `.neg()` and `.inv()` keep `Negate(Missing)` and `Divide(1, Missing)`:
  // beside a point, a negated or inverted absence is an absent operand, and
  // `(1, 2) − Missing` is `Missing` (see `absent-point-arithmetic.test.ts`).
  // Alone, each evaluates to `NaN`.
  test('.neg() evaluates to NaN', () => {
    const ce = new ComputeEngine();
    expect(ce.box('Missing').neg().evaluate().toString()).toBe('NaN');
  });

  test('.inv() evaluates to NaN', () => {
    const ce = new ComputeEngine();
    expect(ce.box('Missing').inv().evaluate().toString()).toBe('NaN');
  });

  test('.sub() beside a point is Missing', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Tuple', 1, 2]).sub(ce.box('Missing')).toString()).toBe(
      '"Missing"'
    );
  });
});
