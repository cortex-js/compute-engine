import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

const value = (json: Json) => ce.box(json).evaluate().toString();

// A function literal with a parameter named like the variable binds each
// occurrence of that name it holds: the literal is the same function for
// every value of the variable. The chain rule read `[x ↦ x]` as an
// argument that depends on `x`, and `D(Length([x ↦ x]), x)` was the list
// `[Apply(Derivative("Length", 1), [(x) => x])]`.
describe('THE DERIVATIVE OF AN EXPRESSION THAT HOLDS A FUNCTION LITERAL', () => {
  test('a literal whose parameter is the variable', () => {
    expect(
      value(['D', ['Length', ['List', ['Function', 'x', 'x']]], 'x'])
    ).toBe('0');
    // A literal with another parameter: the derivative was the list `[0]`.
    expect(
      value(['D', ['Length', ['List', ['Function', 'y', 'y']]], 'x'])
    ).toBe('0');
  });

  // The length of a list is an integer: a step function of the values of
  // its elements, whose derivative is 0 almost everywhere, as for `Floor`.
  // The generic chain rule gave the list `[Apply(Derivative("Length", 1),
  // [x])]`.
  test('the length of a list of expressions in the variable', () => {
    expect(value(['D', ['Length', ['List', 'x']], 'x'])).toBe('0');
    expect(
      value(['D', ['Length', ['List', 'x', ['Power', 'x', 2]]], 'x'])
    ).toBe('0');
    expect(value(['D', ['Length', ['Range', 1, 'x']], 'x'])).toBe('0');
  });

  test('a function parameter used as a call and as a symbol', () => {
    const engine = new ComputeEngine();
    engine.parse('w(x) := x + 100').evaluate();
    expect(
      engine
        .box([
          'Apply',
          [
            'Function',
            ['D', ['Add', ['w', 'x'], ['Length', ['List', 'w']]], 'x'],
            'w',
          ],
          ['Function', ['Multiply', 5, ['w', 'x']], 'x'],
        ])
        .evaluate()
        .toString()
    ).toBe('5');
  });
});

// The integral of an application of a function literal is the integral of
// the body of the literal at the arguments, as the evaluation of `Apply`
// gives it. It stayed unevaluated.
describe('THE INTEGRAL OF AN APPLICATION OF A FUNCTION LITERAL', () => {
  const square: Json = ['Function', ['Power', 't', 2], 't'];

  test('an indefinite integral', () => {
    expect(value(['Integrate', ['Apply', square, 'x'], 'x'])).toBe('1/3 * x^3');
    expect(
      value([
        'Integrate',
        ['Multiply', 3, ['Apply', square, ['Add', 'x', 1]]],
        'x',
      ])
    ).toBe('(x + 1)^3');
  });

  test('a definite integral', () =>
    expect(
      value(['Integrate', ['Apply', square, 'x'], ['Limits', 'x', 0, 1]])
    ).toBe('1/3'));

  test('a literal of two parameters', () =>
    expect(
      value([
        'Integrate',
        ['Apply', ['Function', ['Multiply', 't', 'u'], 't', 'u'], 'x', 2],
        'x',
      ])
    ).toBe('x^2'));
});
