import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { BoxedType } from '../../src/common/type/boxed-type';
import { expectTypeBetween } from '../utils';

//
// A parameter of a function literal gets its value only when the literal is
// applied. When the body is boxed, a parameter with no declared type is
// `unknown`, and that type does not give the parameters of the function that
// the parameter will hold. So a call of the parameter is typed `unknown`. It
// is not typed as a broadcast over a list argument: the function can read the
// whole list (`Count`), and the value is then a scalar.
//
// A parameter declared with a function signature keeps the type that its
// signature gives.
//

const ce = new ComputeEngine();

const COUNT = ['Function', ['Count', 't'], 't'];
const DOUBLE = ['Function', ['Multiply', 2, 't'], 't'];
const NESTED = ['List', ['List', 0, 0], 5];

/** The type of the boxed `json`, read before the evaluation, and its value. */
function typeThenValue(json: unknown): { type: BoxedType; value: Expression } {
  const expr = ce.box(json as never);
  const type = expr.type;
  return { type, value: expr.evaluate() };
}

/** The static type `type` holds `value`. */
function expectTypeHoldsValue(type: BoxedType, value: Expression): void {
  expect(value.isValid).toBe(true);
  if (!value.type.matches(type))
    throw new Error(
      `the value \`${value}\` of type \`${value.type}\` is not in the static type \`${type}\``
    );
}

describe('A CALL OF A PARAMETER OF A FUNCTION LITERAL', () => {
  test('a function that reads the whole list gives a scalar', () => {
    const { type, value } = typeThenValue([
      'Apply',
      ['Function', ['h', NESTED], 'h'],
      COUNT,
    ]);
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
    // The type does not claim a list: the value is the scalar `2`.
    expect(type.matches('list')).toBe(false);
  });

  test('the result of the literal is `unknown`', () => {
    const literal = ce.box(['Function', ['h', NESTED], 'h']);
    // The exact string is the contract. The literal returns a scalar for a
    // function that reads the whole list (`Count`) and a list for a function
    // that maps over it, so no result narrower than `unknown` is sound. A
    // `.matches()` test cannot check this: the parameter list is
    // contravariant, and a narrower result also matches a wider signature.
    expect(String(literal.type)).toBe('(h: unknown) -> unknown');
  });

  test('a function that maps over the list gives a list, which the type holds', () => {
    const { type, value } = typeThenValue([
      'Apply',
      ['Function', ['h', ['List', 1, 2, 3]], 'h'],
      DOUBLE,
    ]);
    expect(value.toString()).toBe('[2,4,6]');
    expectTypeHoldsValue(type, value);
  });

  test('a parameter declared with the bare `function` type', () => {
    // `function` gives no parameters, so the call is typed as for a
    // parameter with no declared type.
    const { type, value } = typeThenValue([
      'Apply',
      ['Function', ['h', NESTED], ['Typed', 'h', "'function'"]],
      COUNT,
    ]);
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
    expect(type.matches('list')).toBe(false);
  });

  test('a parameter that a nested literal captures and calls', () => {
    const { type, value } = typeThenValue([
      'Apply',
      ['Apply', ['Function', ['Function', ['h', NESTED], 'u'], 'h'], COUNT],
      1,
    ]);
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
    expect(type.matches('list')).toBe(false);
  });

  test('a parameter declared with a signature keeps the result type of the signature', () => {
    const expr = ce.box([
      'Apply',
      [
        'Function',
        ['h', ['List', 1, 2, 3]],
        ['Typed', 'h', "'(list) -> integer'"],
      ],
      COUNT,
    ]);
    expectTypeBetween(expr, { atMost: 'integer' });
    expect(expr.evaluate().toString()).toBe('3');
  });

  test('a named function with a function parameter, called on a list', () => {
    const local = new ComputeEngine();
    local.parse('g(h) := h([[0,0],5])').evaluate();
    const expr = local.box(['g', COUNT]);
    const type = expr.type;
    const value = expr.evaluate();
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
    expect(type.matches('list')).toBe(false);
  });
});
