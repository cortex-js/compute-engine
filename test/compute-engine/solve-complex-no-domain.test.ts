import { ComputeEngine } from '../../src/compute-engine';

// GitHub issue #526: with no domain, `Solve` answers over the complex
// numbers where it can (`x² + 1 = 0` gives `[i, -i]`). A root template that
// inverts `sin`, `cos`, `cosh`, `tanh` or an exponential removes a root
// outside the real range of the function (`arcsin(2)`, `ln(-1)`), and the
// empty list read as "no solution". These equations have complex roots: the
// `Solve` now stays unevaluated, as it does when the proof that there is no
// real root is an interval scan of a nested periodic equation
// (`cos(sin(x)) = 0`). An explicitly real domain keeps `[]`.
describe('issue 526: no domain, the real range of an inversion is not a decision', () => {
  const ce = new ComputeEngine();
  const solve = (eq: unknown, spec: unknown = 'x') =>
    ce.box(['Solve', eq as any, spec as any]).evaluate();
  const json = (eq: unknown, spec: unknown = 'x') =>
    JSON.stringify(solve(eq, spec).json);

  test.each([
    ['sin x = 2', ['Equal', ['Sin', 'x'], 2]],
    ['cos x = 2', ['Equal', ['Cos', 'x'], 2]],
    ['3 sin x = 6', ['Equal', ['Multiply', 3, ['Sin', 'x']], 6]],
    ['sin(2x) = 2', ['Equal', ['Sin', ['Multiply', 2, 'x']], 2]],
    ['e^x = -1', ['Equal', ['Power', 'ExponentialE', 'x'], -1]],
    ['e^x + 1 = 0', ['Equal', ['Add', ['Power', 'ExponentialE', 'x'], 1], 0]],
    ['2^x = -1', ['Equal', ['Power', 2, 'x'], -1]],
    [
      'e^(x + 1) = -2',
      ['Equal', ['Power', 'ExponentialE', ['Add', 'x', 1]], -2],
    ],
    [
      'e^(x²) = 1/2',
      [
        'Equal',
        ['Power', 'ExponentialE', ['Power', 'x', 2]],
        ['Rational', 1, 2],
      ],
    ],
    ['cosh x = 0', ['Equal', ['Cosh', 'x'], 0]],
    ['tanh x = 2', ['Equal', ['Tanh', 'x'], 2]],
    // A nested periodic equation with no real root: `sin(x) = ±π/2` has
    // complex roots.
    ['cos(sin x) = 0', ['Equal', ['Cos', ['Sin', 'x']], 0]],
  ])('%s stays unevaluated', (_label, eq) => {
    expect(solve(eq).operator).toBe('Solve');
  });

  test.each([
    ['sin x = 2', ['Equal', ['Sin', 'x'], 2]],
    ['e^x = -1', ['Equal', ['Power', 'ExponentialE', 'x'], -1]],
    ['sin(2x) = 2', ['Equal', ['Sin', ['Multiply', 2, 'x']], 2]],
    ['cosh x = 0', ['Equal', ['Cosh', 'x'], 0]],
    ['cos(sin x) = 0', ['Equal', ['Cos', ['Sin', 'x']], 0]],
  ])('%s over the real numbers is []', (_label, eq) => {
    expect(json(eq, ['Element', 'x', 'RealNumbers'])).toBe('["List"]');
  });

  test.each([
    ['sin x = 2', ['Equal', ['Sin', 'x'], 2]],
    ['e^x = -1', ['Equal', ['Power', 'ExponentialE', 'x'], -1]],
  ])('%s over the complex numbers stays unevaluated', (_label, eq) => {
    expect(solve(eq, ['Element', 'x', 'ComplexNumbers']).operator).toBe(
      'Solve'
    );
  });

  test('an unknown declared real keeps []', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    for (const eq of [
      ['Equal', ['Sin', 'y'], 2],
      ['Equal', ['Power', 'ExponentialE', 'y'], -1],
      ['Equal', ['Sin', ['Multiply', 2, 'y']], 2],
      ['Equal', ['Power', 'ExponentialE', ['Add', 'y', 1]], -2],
      ['Equal', ['Cos', ['Sin', 'y']], 0],
    ])
      expect(
        JSON.stringify(ce.box(['Solve', eq as any, 'y']).evaluate().json)
      ).toBe('["List"]');
  });

  // These equations have no complex root either: `[]` stays.
  test.each([
    ['e^x = 0', ['Equal', ['Power', 'ExponentialE', 'x'], 0]],
    ['tanh x = 1', ['Equal', ['Tanh', 'x'], 1]],
    ['arcsin x = 5', ['Equal', ['Arcsin', 'x'], 5]],
    ['√x = -1', ['Equal', ['Sqrt', 'x'], -1]],
    ['|x| = -1', ['Equal', ['Abs', 'x'], -1]],
  ])('%s is []', (_label, eq) => {
    expect(json(eq)).toBe('["List"]');
  });

  test('x² + 1 = 0 gives its complex roots', () => {
    expect(json(['Equal', ['Add', ['Power', 'x', 2], 1], 0])).toBe(
      '["List",["Complex",0,1],["Complex",0,-1]]'
    );
  });

  test('sin x = 1/2 gives its real families of roots', () => {
    expect(json(['Equal', ['Sin', 'x'], ['Rational', 1, 2]])).toBe(
      '["List",["Add",["Multiply",2,"Pi",["ArbitraryInteger",1]],["Multiply",["Rational",1,6],"Pi"]],["Add",["Multiply",2,"Pi",["ArbitraryInteger",1]],["Multiply",["Rational",5,6],"Pi"]]]'
    );
  });

  test('tan x = 1 gives its family of roots', () => {
    expect(json(['Equal', ['Tan', 'x'], 1])).toBe(
      '["List",["Add",["Multiply",["Rational",1,4],"Pi"],["Multiply","Pi",["ArbitraryInteger",1]]]]'
    );
  });

  test('e^x = 2 and cosh x = 2 keep their real roots', () => {
    expect(json(['Equal', ['Power', 'ExponentialE', 'x'], 2])).toBe(
      '["List",["Ln",2]]'
    );
    expect(json(['Equal', ['Cosh', 'x'], 2])).toBe(
      '["List",["Arcosh",2],["Negate",["Arcosh",2]]]'
    );
  });
});
