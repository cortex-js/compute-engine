import { engine, exprToString } from '../utils';

function evaluate(expr) {
  return exprToString(engine.box(expr)?.evaluate());
}

engine.assign('f1', ['Function', ['Add', 'q', 1], 'q']);
engine.assign('f2', ['Add', '_', 1]);

// Arguments are not checked by the Compute Engine
// so we must use caution when accessing them
engine.assign('f3', (ce, args) => ce.number(args[0]?.valueOf() + 1));

// With a declared function, the arguments are checked by the Compute Engine
engine.declare('f4', {
  signature: {
    domain: ['FunctionOf', 'Numbers', 'Numbers'],
    evaluate: (ce, args) => ce.number((args[0].valueOf() as number) + 1),
  },
});

// Anonymous parameters
engine.assign('f5', ['Function', ['Add', '_', 1]]);
engine.assign('f6', ['Function', ['Add', '_1', 1]]);
engine.assign('f7', ['Function', ['Add', '_2', 1]]);
engine.assign('f8', ['Add', '_', 1]);
engine.assign('f9', ['Add', '_1', 1]);

describe('Anonymous function', () => {
  test('Function', () =>
    expect(evaluate(['f1', 10])).toMatchInlineSnapshot(`11`));
  test('Expression', () =>
    expect(evaluate(['f2', 10])).toMatchInlineSnapshot(`["f2", 10]`));
  test('JS Function', () =>
    expect(evaluate(['f3', 10])).toMatchInlineSnapshot(`11`));
  test('Declared JS Function', () =>
    expect(evaluate(['f4', 10])).toMatchInlineSnapshot(`11`));
});

describe('Anonymous function with missing param', () => {
  test('Missing Param Function', () =>
    expect(evaluate(['f1'])).toMatchInlineSnapshot(`["f1"]`));
  test('Missing Param Expression', () =>
    expect(evaluate(['f2'])).toMatchInlineSnapshot(`["f2"]`));
  test('Missing Param JS Function', () =>
    expect(evaluate(['f3'])).toMatchInlineSnapshot(`{num: "NaN"}`)); // NaN is correct
  test('Missing Param Declared JS Function', () =>
    expect(evaluate(['f4'])).toMatchInlineSnapshot(
      `["f4", ["Error", "'missing'"]]`
    )); // Error is correct
});

describe('Anonymous function with too many params', () => {
  test('Too many params: Function', () =>
    expect(evaluate(['f1', 10, 20])).toMatchInlineSnapshot(`["f1", 10, 20]`));
  test('Too many params: Expression', () =>
    expect(evaluate(['f2', 10, 20])).toMatchInlineSnapshot(`["f2", 10, 20]`));
  test('Too many params: JS Function', () =>
    expect(evaluate(['f3', 10, 20])).toMatchInlineSnapshot(`11`));
  test('Too many params: Declared JS Function: arguments are checked by Compute Engine', () =>
    expect(evaluate(['f4', 10, 20])).toMatchInlineSnapshot(
      `["f4", 10, ["Error", "'unexpected-argument'", 20]]`
    )); // Error is correct
});

describe('Anonymous function with anonymous parameters', () => {
  test('Anon Param: F5', () =>
    expect(evaluate(['f5', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F6', () =>
    expect(evaluate(['f6', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F7', () =>
    expect(evaluate(['f7', 10])).toMatchInlineSnapshot(`["f7", 10]`));
  test('Anon Param: F8', () =>
    expect(evaluate(['f8', 10])).toMatchInlineSnapshot(`["f8", 10]`));
  test('Anon Param: F9', () =>
    expect(evaluate(['f9', 10])).toMatchInlineSnapshot(`11`));
});

describe('Expression head', () => {
  // Note: we use 'x' both as a the param, and as the argument to
  // ensure the correct definition is used. Should not create an infinite loop.
  test('Function', () =>
    expect(evaluate([['Function', 'x', 'x'], 'x'])).toMatchInlineSnapshot(`x`));

  test('Function and Hold', () =>
    expect(
      evaluate([
        ['Function', 'x', 'x'],
        ['Hold', 'x'],
      ])
    ).toMatchInlineSnapshot(`["Hold", "x"]`));

  // Using a 'Sequence' so that the head can be a "neutral" identity function
  // Note: could add a ["Hold", "x"] if there was a need to prevent evaluation
  test('Anon function', () =>
    expect(evaluate([['Sequence', '_'], 'x'])).toMatchInlineSnapshot(
      `["Sequence", "x"]`
    ));
});
