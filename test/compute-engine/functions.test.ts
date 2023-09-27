import { engine, exprToString } from '../utils';

function evaluate(expr) {
  return exprToString(engine.box(expr)?.evaluate());
}

console.log(evaluate(['Hypot', 3, 4]));

engine.assign('f1', ['Function', ['Add', 'q', 1], 'q']);

console.log(evaluate(['f1', 10]));
console.log(evaluate(['f1']));

engine.assign('f2', ['Add', '_', 1]);
console.log(evaluate(['f2', 10]));

// Arguments are not checked by the Compute Engine
// so we must use caution when accessing them
engine.assign('f3', (ce, args) => ce.number(args[0]?.valueOf() + 1));

// With a declared function, the arguments are checked by the Compute Engine
engine.declare('f4', {
  signature: {
    domain: ['Functions', 'Numbers', 'Numbers'],
    evaluate: (ce, args) => ce.number((args[0].valueOf() as number) + 1),
  },
});

// Anonymous parameters
engine.assign('f5', ['Function', ['Add', '_', 1]]);
engine.assign('f6', ['Function', ['Add', '_1', 1]]);
engine.assign('f7', ['Function', ['Add', '_2', 1]]);
engine.assign('f8', ['Add', '_', 1]);
engine.assign('f9', ['Add', '_1', 1]);

// console.log(engine.box(['f1']).evaluate().toString());
// console.log(evaluate(['f1', 10]));
// console.log(evaluate(['f1']));

describe('Anonymous function', () => {
  test('Function', () =>
    expect(evaluate(['f1', 10])).toMatchInlineSnapshot(`11`));
  test('Expression', () =>
    expect(evaluate(['f2', 10])).toMatchInlineSnapshot(`_`)); // @fixme
  test('JS Function', () =>
    expect(evaluate(['f3', 10])).toMatchInlineSnapshot(`11`));
  test('Declared JS Function', () =>
    expect(evaluate(['f4', 10])).toMatchInlineSnapshot(`11`));
});

describe('Anonymous function with missing param', () => {
  test('Missing Param Function', () =>
    expect(evaluate(['f1'])).toMatchInlineSnapshot(`["Add", "q", 1]`)); // @fixme
  test('Missing Param Expression', () =>
    expect(evaluate(['f2'])).toMatchInlineSnapshot(`_`));
  test('Missing Param JS Function', () =>
    expect(evaluate(['f3'])).toMatchInlineSnapshot(`{num: "NaN"}`)); // NaN is correct
  test('Missing Param Declared JS Function', () =>
    expect(evaluate(['f4'])).toMatchInlineSnapshot(
      `["f4", ["Error", "'missing'"]]`
    )); // Error is correct
});

describe('Anonymous function with too many params', () => {
  test('Too many params: Function', () =>
    expect(evaluate(['f1', 10, 20])).toMatchInlineSnapshot(`11`));
  test('Too many params: Expression', () =>
    expect(evaluate(['f2', 10, 20])).toMatchInlineSnapshot(`_`)); // @fixme
  test('Too many params: JS Function', () =>
    expect(evaluate(['f3', 10, 20])).toMatchInlineSnapshot(`11`));
  test('Too many params: Declared JS Function: arguments are checked by Compute Engine', () =>
    expect(evaluate(['f4', 10, 20])).toMatchInlineSnapshot(
      `["f4", 10, ["Error", "'unexpected-argument'", 20]]`
    )); // Error is correct
});

describe('Anonymous function with anonymous parameters', () => {
  test('Anon Param: F5', () =>
    expect(evaluate(['f5', 10])).toMatchInlineSnapshot(`["Add", "_", 1]`));
  test('Anon Param: F6', () =>
    expect(evaluate(['f6', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F7', () =>
    expect(evaluate(['f7', 10])).toMatchInlineSnapshot(`["Add", "_2", 1]`)); // @fixme not clear what the right answer is
  test('Anon Param: F8', () =>
    expect(evaluate(['f8', 10])).toMatchInlineSnapshot(`_`)); // @fixme
  test('Anon Param: F9', () =>
    expect(evaluate(['f9', 10])).toMatchInlineSnapshot(`_1`)); // @fixme
});
