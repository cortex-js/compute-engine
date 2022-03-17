import { check } from '../../utils';

describe('TRIGONOMETRIC FUNCTIONS implicit arguments', () => {
  test(`\\cos x + 1`, () =>
    expect(check('\\cos x + 1')).toMatchInlineSnapshot(`
      'box      = ["Add", ["Cos", "x"], 1]
      canonical = ["Add", 1, ["Cos", "x"]]
      simplify  = ["Add", 1, ["Sin", ["Add", ["Multiply", ["Rational", 1, 2], "Pi"], "x"]]]'
    `));
  test(`\\cos x - \\sin x`, () =>
    expect(check('\\cos x - \\sin x')).toMatchInlineSnapshot(`
      'box      = ["Subtract", ["Cos", "x"], ["Sin", "x"]]
      simplify  = ["Subtract", ["Sin", ["Add", ["Multiply", ["Rational", 1, 2], "Pi"], "x"]], ["Divide", ["Subtract", ["Exp", ["Multiply", "ImaginaryUnit", "x"]], ["Exp", ["Negate", ["Multiply", "ImaginaryUnit", "x"]]]], ["Complex", 0, 2]]]'
    `));
  test(`\\cos \\frac{x}{2}^2`, () =>
    expect(check('\\cos \\frac{x}{2}^2')).toMatchInlineSnapshot(`
      'box      = ["Cos", ["Power", ["Divide", "x", 2], 2]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 4], ["Square", "x"]]]
      simplify  = ["Sin", ["Add", ["Multiply", ["Rational", 1, 2], "Pi"], ["Multiply", ["Rational", 1, 4], ["Square", "x"]]]]'
    `));
});

describe('TRIGONOMETRIC FUNCTIONS inverse, prime', () => {
  test(`\\sin^{-1}'(x)`, () =>
    expect(check("\\sin^{-1}'(x)")).toMatchInlineSnapshot(
      `'[["Derivative", 1, ["InverseFunction", "Sin"]], "x"]'`
    ));
  test(`\\sin^{-1}''(x)`, () =>
    expect(check("\\sin^{-1}''(x)")).toMatchInlineSnapshot(
      `'[["Derivative", 2, ["InverseFunction", "Sin"]], "x"]'`
    ));
  test(`\\cos^{-1\\doubleprime}(x)`, () =>
    expect(check('\\cos^{-1\\doubleprime}(x)')).toMatchInlineSnapshot(
      `'[["Derivative", 2, ["InverseFunction", "Cos"]], "x"]'`
    ));
  test(`\\cos^{-1}\\doubleprime(x)'(x)`, () =>
    expect(check('\\cos^{-1}\\doubleprime(x)')).toMatchInlineSnapshot(
      `'[["Derivative", 2, ["InverseFunction", "Cos"]], "x"]'`
    ));
});

describe('TRIGONOMETRIC FUNCTIONS', () => {
  test(`\\cos(k\\pi)`, () =>
    expect(check('\\cos(k\\pi)')).toMatchInlineSnapshot(`
      'box      = ["Cos", ["Multiply", "k", "Pi"]]
      canonical = ["Cos", ["Multiply", "Pi", "k"]]
      simplify  = ["Sin", ["Add", ["Multiply", ["Rational", 1, 2], "Pi"], ["Multiply", "Pi", "k"]]]'
    `));
  test(`\\cos(\\frac{\\pi}{5})`, () =>
    expect(check('\\cos(\\frac{\\pi}{5})')).toMatchInlineSnapshot(`
      'box      = ["Cos", ["Divide", "Pi", 5]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 5], "Pi"]]
      simplify  = ["Divide", ["Add", 1, ["Sqrt", 5]], 4]
      evaluate  = ["Sin", ["Multiply", ["Rational", 7, 10], "Pi"]]
      N         = ["num": "0.8090169943749474241022934171828190588601545899028814310677243113526302314094512248536036020946955687"]'
    `));
});
