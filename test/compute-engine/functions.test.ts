import { MathJsonExpression as Expression } from '../../src/math-json/types';
import { engine, exprToString } from '../utils';

function evaluate(expr: Expression) {
  return exprToString(engine.box(expr)?.evaluate());
}

beforeAll(() => {
  engine.pushScope();
  engine.assign('f1', ['Function', ['Add', 'q', 1], 'q']);
  engine.assign('f2', ['Add', '_', 1]);

  engine.assign('h', ['Hold', ['Add', 2, 6]]);
  engine.assign('u', ['Unevaluated', ['Add', 2, 6]]);

  // Arguments are not checked by the Compute Engine
  // so we must use caution when accessing them

  engine.assign('f3', (args) => engine.number(args[0]?.re + 1));

  // With a declared function, the arguments are checked by the Compute Engine
  engine.declare('f4', {
    signature: '(number) -> number',
    evaluate: (args) => engine.number(args[0].re + 1),
  });

  // Anonymous parameters
  engine.assign('f5', ['Function', ['Add', '_', 1]]);
  engine.assign('f6', ['Function', ['Add', '_1', 1]]);
  engine.assign('f7', ['Function', ['Add', '_2', 1]]);
  engine.assign('f8', ['Add', '_', 1]);
  engine.assign('f9', ['Add', '_1', 1]);
  engine.assign('f10', ['Add', ['Divide', '_1', '_2'], '_3']);

  engine.declare('fn1', 'function');
  engine.declare('fn2', 'function');
  // Inferring the return type of a function
  engine.box(['Add', ['fn2', 10], 1]).evaluate();
  engine.declare('fn3', 'function');
  // Inferring the arguments of a function
  engine.box(['fn3', 10]).evaluate();

  engine.assign('fn4', ['Function', ['Add', 'x', 1], 'x']);
  engine.declare('fn5', {
    evaluate: (args) => engine.number(args[0].re + 1),
  });
});

afterAll(() => {
  engine.popScope();
});

describe('Infer function signature', () => {
  test('declared function signature', () =>
    expect(engine.box('fn1').type.toString()).toMatchInlineSnapshot(
      `function`
    ));

  test('inferred function signature (result)', () =>
    expect(engine.box('fn2').type.toString()).toMatchInlineSnapshot(
      `function`
    ));

  test('inferred function signature (arguments)', () =>
    expect(engine.box('fn3').type.toString()).toMatchInlineSnapshot(
      `function`
    ));

  test('declared function signature with expression body', () =>
    expect(engine.box('fn4').type.toString()).toMatchInlineSnapshot(
      `(unknown) -> number`
    ));

  test('declared function signature with JS body', () =>
    expect(engine.box('fn5').type.toString()).toMatchInlineSnapshot(
      `(any*) -> unknown`
    ));
});

describe('Infer result type', () => {
  // By calling add, the result of `f1` is inferred to be a number
  test('Add', () =>
    expect(evaluate(['Add', 1, ['f1', 10]])).toMatchInlineSnapshot(`12`));
});

describe('Anonymous function', () => {
  test('Function', () =>
    expect(evaluate(['f1', 10])).toMatchInlineSnapshot(`11`));
  test('Expression', () =>
    expect(evaluate(['f2', 10])).toMatchInlineSnapshot(`11`));
  test('JS Function', () =>
    expect(evaluate(['f3', 10])).toMatchInlineSnapshot(`11`));
  test('Declared JS Function', () =>
    expect(evaluate(['f4', 10])).toMatchInlineSnapshot(`11`));
});

describe('Anonymous function with missing param', () => {
  test('Missing Param Function', () =>
    expect(evaluate(['f1'])).toMatchInlineSnapshot(
      `["Function", ["Add", "_1", 1]]`
    ));
  test('Missing Param Expression', () =>
    expect(evaluate(['f2'])).toMatchInlineSnapshot(
      `["Function", ["Add", "_1_0", 1]]`
    )); // @fixme
  test('Missing Param JS Function', () =>
    expect(evaluate(['f3'])).toMatchInlineSnapshot(`NaN`)); // NaN is correct
  test('Missing Param Declared JS Function', () =>
    expect(evaluate(['f4'])).toMatchInlineSnapshot(
      `["f4", ["Error", "'missing'"]]`
    )); // Error is correct
});

describe('Anonymous function with too many params', () => {
  test('Too many params: Function', () =>
    expect(() => evaluate(['f1', 10, 20])).toThrowErrorMatchingInlineSnapshot(
      `Too many arguments for function "(q) |-> q + 1": expected 1, got 2`
    ));

  test('Too many params: Expression', () =>
    expect(() => evaluate(['f2', 10, 20])).toThrow());

  test('Too many params: JS Function', () =>
    expect(evaluate(['f3', 10, 20])).toMatchInlineSnapshot(`11`));

  test('Too many params: Declared JS Function: arguments are checked by Compute Engine', () =>
    expect(evaluate(['f4', 10, 20])).toMatchInlineSnapshot(
      `["f4", 10, ["Error", "unexpected-argument", "'20'"]]`
    )); // Error is correct
});

describe('Anonymous function with anonymous parameters', () => {
  test('Anon Param: F5', () =>
    expect(evaluate(['f5', 10])).toMatchInlineSnapshot(`["Add", "_", 1]`));
  test('Anon Param: F6', () =>
    expect(evaluate(['f6', 10])).toMatchInlineSnapshot(`["Add", "_1", 1]`));
  test('Anon Param: F8', () =>
    expect(evaluate(['f8', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F9', () =>
    expect(evaluate(['f9', 10])).toMatchInlineSnapshot(`11`));
});

describe('Currying', () => {
  test('f7 expects two arguments. Only one provided', () =>
    expect(evaluate(['f10', 5])).toMatchInlineSnapshot(
      `["Function", ["Add", "_2_0", ["Divide", 5, "_1_0"]]]`
    ));
});

describe('Apply', () => {
  // Note: we use 'x' both as a the param, and as the argument to
  // ensure the correct definition is used. Should not create an infinite loop.
  test('Function', () =>
    expect(
      evaluate(['Apply', ['Function', 'x', 'x'], 'x'])
    ).toMatchInlineSnapshot(`x`));
  test('Function and Hold', () =>
    expect(
      evaluate(['Apply', ['Function', 'x', 'x'], ['Hold', 'x']])
    ).toMatchInlineSnapshot(`["Hold", "x"]`));

  test('Apply to non-function literal', () => {
    engine.pushScope();
    engine.declare('f', 'any');
    engine.assign('f', 36);

    expect(evaluate(['f', 42])).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "incompatible-type", "'function'", "'finite_integer'"],
        "'36'"
      ]
    `);

    engine.assign('f', ['Add', '_', 1]);

    expect(evaluate(['f', 42])).toMatchInlineSnapshot(`43`);
  });
});

describe('Argument Evaluation', () => {
  test('Hold expressions are not evaluated', () =>
    expect(evaluate(['Add', ['Hold', ['Add', 2, 5]], 7])).toMatchInlineSnapshot(
      `["Add", 7, ["Hold", ["Add", 2, 5]]]`
    ));

  test('Hold variables are not evaluated', () =>
    expect(evaluate(['Add', 'h', 7])).toMatchInlineSnapshot(
      `["Add", 7, ["Hold", ["Add", 2, 6]]]`
    ));

  test('To evaluate a Hold expressions it must be wrapped in ReleaseHold', () =>
    expect(
      evaluate(['Add', ['ReleaseHold', ['Hold', ['Add', 2, 5]]], 7])
    ).toMatchInlineSnapshot(`14`));

  test('To evaluate a Hold variable it must be wrapped in ReleaseHold', () =>
    expect(evaluate(['Add', ['ReleaseHold', 'h'], 7])).toMatchInlineSnapshot(
      `["Add", 7, ["Hold", ["Add", 2, 6]]]`
    ));

  test('An Unevaluated expression is unwrapped when evaluated', () =>
    expect(
      evaluate(['Add', ['Unevaluated', ['Add', 5, 11]], 7])
    ).toMatchInlineSnapshot(`23`));

  test('An Unevaluated variable is unwrapped when evaluated', () =>
    expect(evaluate(['Add', 'u', 7])).toMatchInlineSnapshot(`15`));
});

describe('Changing type from function to non-function', () => {
  test('Changing type from value to function', () => {
    engine.pushScope();
    engine.declare('f20', 'any');
    engine.assign('f20', 42);
    engine.assign('f20', ['Function', ['Multiply', 'x', 2], 'x']);

    expect(engine.box(['f20', 42]).evaluate().re).toEqual(84);
    engine.popScope();
  });

  test('Changing type from function to value', () => {
    engine.pushScope();
    engine.declare('f20', 'any');
    engine.assign('f20', ['Function', ['Multiply', 'x', 2], 'x']);
    expect(() => engine.assign('f20', 42)).toThrow();

    // expect(engine.box('f20').re).toEqual(42);
    engine.popScope();
  });
});
