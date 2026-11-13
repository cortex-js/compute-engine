import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { BoxedType } from '../../src/common/type/boxed-type';

//
// A block is boxed, and its statements are typed, before its first statement
// runs. A local that holds a function (declared with a function literal, or
// made by a function statement) is a variable of type `function`: a call of
// the local is typed from that type, `unknown`, and the static type holds
// the value of the call, whatever the function does with a list.
//
// Each test reads the type right after boxing, before the block runs: the
// evaluation gives the local its value, and a later read of the type could
// then come from that value.
//

const ce = new ComputeEngine();

const COUNT = ['Function', ['Count', 't'], 't'];
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

describe('A CALL OF A FUNCTION THAT A BLOCK DEFINES, TYPED BEFORE THE BLOCK RUNS', () => {
  test('a local declared with a function literal, called on a list', () => {
    const { type, value } = typeThenValue([
      'Block',
      ['Declare', 'f', "'unknown'", COUNT],
      ['f', NESTED],
    ]);
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
    // The type does not claim a list: the value is the scalar `2`.
    expect(type.matches('list')).toBe(false);
  });

  test('a local declared with `let` and a function literal, called on a list', () => {
    const { type, value } = typeThenValue([
      'Block',
      ['Declare', 'f', ['Dictionary', ['KeyValuePair', "'value'", COUNT]]],
      ['f', NESTED],
    ]);
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
    expect(type.matches('list')).toBe(false);
  });

  test('a local declared with a function literal and assigned another, called on a list', () => {
    const { type, value } = typeThenValue([
      'Block',
      ['Declare', 'f', "'unknown'", COUNT],
      ['Assign', 'f', ['Function', ['List', 't', 't'], 't']],
      ['f', NESTED],
    ]);
    expect(value.toString()).toBe('[[[0,0],[0,0]],[5,5]]');
    expectTypeHoldsValue(type, value);
  });

  test('a local that receives the result of the call', () => {
    const { type, value } = typeThenValue([
      'Block',
      ['Declare', 'f', "'unknown'", COUNT],
      ['Declare', 'y', "'unknown'", ['f', NESTED]],
      'y',
    ]);
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
  });

  test('the call as an element of a list literal', () => {
    const { type, value } = typeThenValue([
      'Block',
      ['Declare', 'f', "'unknown'", COUNT],
      ['List', ['f', NESTED]],
    ]);
    expect(value.toString()).toBe('[2]');
    expectTypeHoldsValue(type, value);
  });

  test('a function with a scalar body, called on a list', () => {
    // The evaluation maps `f` over the list; the call is typed from the
    // type of the variable `f`.
    const { type, value } = typeThenValue([
      'Block',
      ['Declare', 'f', "'unknown'", ['Function', ['Add', 't', 1], 't']],
      ['f', ['List', 1, 2, 3]],
    ]);
    expect(value.toString()).toBe('[2,3,4]');
    expectTypeHoldsValue(type, value);
    expect(type.toString()).toBe('unknown');
  });

  test('a function defined with `DefineFunction`', () => {
    // The function statement makes a variable of type `function`, as a
    // `Declare` with a function literal does.
    const { type, value } = typeThenValue([
      'Block',
      ['DefineFunction', 'f', COUNT],
      ['f', NESTED],
    ]);
    expect(value.toString()).toBe('2');
    expectTypeHoldsValue(type, value);
    expect(type.toString()).toBe('unknown');
  });
});

describe('A CALL OF A FREE FUNCTION THAT IS NOT DECLARED', () => {
  test('a call on a list keeps the type of a broadcast', () => {
    // The exact type is the contract of `docs/BROADCAST-MODEL.md`: with
    // `L = [1, 3, 5]` and `foo` not declared, `foo(L)` is typed
    // `list<unknown^3>`. A free name is not a local of a block.
    const engine = new ComputeEngine();
    const expr = engine.box(['foo', ['List', 1, 3, 5]]);
    expect(expr.type.toString()).toBe('list<unknown^3>');
  });
});
