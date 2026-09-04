import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { errorFrames } from '../../src/compute-engine/boxed-expression/error-value';

//
// An operand that becomes an error only by EVALUATING it bubbles like one
// that was an error at boxing time (docs/ERROR-MODEL.md §3, `Sin(err) → err`;
// step 4-err of `_computeValueUnabsorbed` in boxed-function.ts and its async
// twin). Until 2026-09-03 the scan was gated on the node being invalid at
// boxing time, so `Sin(Length(5))` evaluated to the invalid tree
// `sin(Error(…))` instead of the error.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

const isError = (x: unknown): boolean => isFunction(x as any, 'Error');

describe('EVALUATION-TIME OPERAND ERRORS bubble through strict operators', () => {
  test('a library operator: Sin(Length(5)) is the error, with the Sin hop', () => {
    const v = ce.box(['Sin', ['Length', 5]]).evaluate();
    expect(isError(v)).toBe(true);
    expect(errorFrames(v)).toEqual([{ operator: 'Sin', index: 1 }]);
  });

  test('arithmetic: 1 + Length(5) is the error, with the Add hop', () => {
    const v = ce.box(['Add', 1, ['Length', 5]]).evaluate();
    expect(isError(v)).toBe(true);
    expect(errorFrames(v)).toEqual([{ operator: 'Add', index: 2 }]);
  });

  test('operators that evaluate their own operands (Multiply, Power) agree', () => {
    const m = ce.box(['Multiply', 2, ['Length', 5]]).evaluate();
    expect(isError(m)).toBe(true);
    // The innermost hop is the product's; the handler's own normalization
    // (a quotient over 1) may add a hop of its own after it.
    expect(errorFrames(m)[0]).toEqual({ operator: 'Multiply', index: 2 });
    expect(isError(ce.box(['Power', ['Length', 5], 2]).evaluate())).toBe(true);
  });

  test('a user function that fails inside a strict operator', () => {
    ce.declare('g', {
      value: ce.box([
        'Function',
        ['If', ['Greater', 'x', 0], 'x', ['RuntimeError', "'neg'"]],
        'x',
      ]),
    });
    const v = ce.box(['Sin', ['g', -1]]).evaluate();
    expect(v.toString()).toBe('Error("neg")');
    expect(
      ce
        .box(['Sin', ['g', 1]])
        .evaluate()
        .toString()
    ).toBe('sin(1)');
  });

  test('the exclusions hold: selecting, observing, and collection heads', () => {
    // A selecting operator holds its operands: an undemanded failing arm is
    // dead code.
    expect(
      ce
        .box(['If', 'True', 5, ['Length', 5]])
        .evaluate()
        .toString()
    ).toBe('5');
    // A collection keeps the failed cell in place.
    const list = ce.box(['List', 1, ['Length', 5], 3]).evaluate();
    expect(list.operator).toBe('List');
    expect(list.nops).toBe(3);
    // An observer sees the error and answers about it.
    expect(ce.box(['IsError', ['Length', 5]]).evaluate().symbol).toBe('True');
  });

  test("a spread argument that evaluates to an error is the call's value", () => {
    ce.declare('g', {
      value: ce.box(['Function', ['RuntimeError', "'boom'"], 'x']),
    });
    ce.declare('f', {
      value: ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']),
    });
    const v = ce.box(['f', ['Spread', ['g', 1]]]).evaluate();
    expect(v.toString()).toBe('Error("boom")');
  });

  test("a broadcast lift that evaluates to an error is the call's value", () => {
    // The scalar operand is lifted into every cell; if it fails, the failure
    // is the call's, not a list of identical error cells.
    const v = ce.box(['Power', ['List', 1, 2], ['Length', 5]]).evaluate();
    expect(isError(v)).toBe(true);
    // A cell-supplying collection with a failed cell still freezes.
    const cells = ce.box(['Power', ['List', 1, ['Length', 5]], 2]).evaluate();
    expect(cells.operator).toBe('List');
  });

  test('a selecting operator keeps its hop on a demanded runtime error', () => {
    const v = ce.box(['If', 'False', 5, ['RuntimeError', "'x'"]]).evaluate();
    expect(v.toString()).toContain('Error(');
    expect(errorFrames(v)[0]?.operator).toBe('If');
  });

  test('no double framing through nested strict operators', () => {
    const v = ce.box(['Cos', ['Sin', ['Length', 5]]]).evaluate();
    expect(errorFrames(v)).toEqual([
      { operator: 'Sin', index: 1 },
      { operator: 'Cos', index: 1 },
    ]);
  });

  test('the numeric route agrees', () => {
    expect(isError(ce.box(['Sin', ['Length', 5]]).N())).toBe(true);
    expect(isError(ce.box(['Add', 1, ['Length', 5]]).N())).toBe(true);
  });

  test('the async lane agrees', async () => {
    const v = await ce.box(['Sin', ['Length', 5]]).evaluateAsync();
    expect(isError(v)).toBe(true);
    expect(errorFrames(v)).toEqual([{ operator: 'Sin', index: 1 }]);
    const five = await ce.box(['If', 'True', 5, ['Length', 5]]).evaluateAsync();
    expect(five.toString()).toBe('5');
    // The lazy operator and the failing user function, asynchronously.
    const sum = await ce.box(['Add', 1, ['Length', 5]]).evaluateAsync();
    expect(errorFrames(sum)).toEqual([{ operator: 'Add', index: 2 }]);
    ce.declare('g', {
      value: ce.box(['Function', ['RuntimeError', "'neg'"], 'x']),
    });
    const viaFn = await ce.box(['Sin', ['g', 1]]).evaluateAsync();
    expect(viaFn.toString()).toBe('Error("neg")');
    const lifted = await ce
      .box(['Power', ['List', 1, 2], ['Length', 5]])
      .evaluateAsync();
    expect(isError(lifted)).toBe(true);
  });
});
