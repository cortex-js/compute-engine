import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// `subs()` of the variable of a `D`, a `Series` or an indefinite `Integrate`
// gives `EvaluateAt(Function(node, x), point)`: `D(x^2, x)` with `x`
// replaced by `3` is the derivative at 3. The derivative of such a form,
// and its compiled form, are the ones of its value.

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

const square: Json = ['Function', ['Power', 'x', 2], 'x'];

describe('THE DERIVATIVE OF AN EVALUATEAT', () => {
  // The `D` of an `EvaluateAt` stayed unevaluated.
  test('D of a literal at a point', () =>
    expect(
      ce
        .box(['D', ['EvaluateAt', square, 'y'], 'y'])
        .evaluate()
        .toString()
    ).toBe('2y'));

  test('D of a substituted derivative', () => {
    const substituted = ce
      .box(['D', ['Power', 'x', 3], 'x'])
      .subs({ x: ce.symbol('y') });
    expect(substituted.operator).toBe('EvaluateAt');
    expect(
      ce
        .function('D', [substituted, ce.symbol('y')])
        .evaluate()
        .toString()
    ).toBe('6y');
  });

  test('D of an indefinite integral at a point', () => {
    const substituted = ce
      .box(['Integrate', ['Power', 'x', 2], 'x'])
      .subs({ x: ce.box(['Multiply', 2, 'y']) });
    const derivative = ce
      .function('D', [substituted, ce.symbol('y')])
      .evaluate();
    // d/dy (2y)^3/3 = 8y^2.
    for (const y of [0.5, 1.3, -2])
      expect(derivative.subs({ y: ce.number(y) }).N().re).toBeCloseTo(
        8 * y * y,
        10
      );
  });

  // A form with no closed form stays unevaluated, as before.
  test('a value that stays an EvaluateAt', () =>
    expect(
      ce
        .box([
          'D',
          [
            'EvaluateAt',
            [
              'Function',
              ['Series', ['Exp', ['Divide', 1, 'x']], 'x', 0, 3],
              'x',
            ],
            'y',
          ],
          'y',
        ])
        .evaluate().operator
    ).toBe('D'));
});

describe('THE COMPILED FORM OF AN EVALUATEAT', () => {
  const run = (expr: ReturnType<typeof ce.box>, vars = {}) => {
    const result = compile(expr);
    expect(result.success).toBe(true);
    return result.run!(vars);
  };

  test('a derivative at a number', () =>
    expect(run(ce.box(['D', ['Power', 'x', 2], 'x']).subs({ x: 3 }))).toBe(6));

  test('a derivative at an expression', () =>
    expect(
      run(
        ce
          .box(['D', ['Power', 'x', 2], 'x'])
          .subs({ x: ce.box(['Add', 'y', 1]) }),
        { y: 2 }
      )
    ).toBe(6));

  test('an indefinite integral at a symbol', () =>
    expect(
      run(ce.box(['Integrate', 'x', 'x']).subs({ x: ce.symbol('y') }), {
        y: 2,
      })
    ).toBe(2));

  test('two bounds', () => {
    expect(run(ce.box(['EvaluateAt', square, 1, 3]))).toBe(8);
    expect(run(ce.box(['EvaluateAt', square, 'a', 'b']), { a: 1, b: 3 })).toBe(
      8
    );
    expect(
      run(ce.box(['EvaluateAt', 'Sin', 'a', 'b']), { a: 1, b: 2 })
    ).toBeCloseTo(Math.sin(2) - Math.sin(1), 14);
  });

  test('a tuple point of a literal of two parameters', () =>
    expect(
      run(
        ce.box([
          'EvaluateAt',
          ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
          ['Tuple', 'a', 3],
        ]),
        { a: 2 }
      )
    ).toBe(6));

  // A named callee whose signature takes no argument is a constant, as in
  // `evaluate()`. The call with the point was compiled, and failed.
  test('a named callee that takes no argument', () => {
    const engine = new ComputeEngine();
    engine.declare('g', {
      signature: '() -> integer',
      evaluate: () => engine.number(42),
    });
    const at = compile(engine.box(['EvaluateAt', 'g', 'a']));
    expect(at.success).toBe(true);
    expect(at.run!({ a: 1 })).toBe(42);
    const between = compile(engine.box(['EvaluateAt', 'g', 'a', 'b']));
    expect(between.success).toBe(true);
    expect(between.run!({ a: 1, b: 2 })).toBe(0);
  });

  // A form that `evaluate()` keeps unevaluated has no compiled form.
  test('no point, and a point that is not one per parameter', () => {
    expect(() =>
      compile(ce.box(['EvaluateAt', square]), { fallback: false })
    ).toThrow(/no point/);
    expect(() =>
      compile(
        ce.box([
          'EvaluateAt',
          ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
          'a',
        ]),
        { fallback: false }
      )
    ).toThrow(/arguments/);
  });

  // A parameter called in the body with the name of a library operator:
  // the compiled code would call the operator, so the compilation fails,
  // as it does for the same `Apply`.
  test('a parameter with the name of a library operator', () =>
    expect(() =>
      compile(
        ce.box([
          'EvaluateAt',
          ['Function', ['Sin', 'y'], 'Sin', 'y'],
          ['Tuple', square, 'y'],
        ]),
        { fallback: false }
      )
    ).toThrow(/also the name of a library operator/));
});

// `evaluate()` applies the function at the lower bound first. The canonical
// form of the compiled difference `f(b) − f(a)` can put the two applications
// in the other order, so a function with an effect (a random draw) gave
// another value when compiled. Such a form is not compiled.
describe('THE COMPILED FORM OF AN EVALUATEAT WITH AN EFFECT', () => {
  test('a function with a random draw at two bounds is not compiled', () => {
    expect(() =>
      compile(
        ce.box([
          'EvaluateAt',
          ['Function', ['Add', 'x', ['Random']], 'x'],
          'b',
          'a',
        ]),
        { fallback: false }
      )
    ).toThrow(/has an effect/);
    const pure = compile(ce.box(['EvaluateAt', square, 1, 3]));
    expect(pure.success).toBe(true);
    expect(pure.run!({})).toBe(8);
  });
});
