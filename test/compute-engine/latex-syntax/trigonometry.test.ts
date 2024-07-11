import { check } from '../../utils';

describe('TRIGONOMETRIC FUNCTIONS implicit arguments', () => {
  test(`\\cos x + 1`, () =>
    expect(check('\\cos x + 1')).toMatchInlineSnapshot(
      `["Add", ["Cos", "x"], 1]`
    ));
  test(`\\cos x - \\sin x`, () =>
    expect(check('\\cos x - \\sin x')).toMatchInlineSnapshot(`
      box       = ["Add", ["Cos", "x"], ["Negate", ["Sin", "x"]]]
      canonical = ["Subtract", ["Cos", "x"], ["Sin", "x"]]
    `));
  test(`\\cos \\frac{x}{2}^2`, () =>
    expect(check('\\cos \\frac{x}{2}^2')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Power", ["Divide", "x", 2], 2]]
      canonical = ["Cos", ["Square", ["Divide", "x", 2]]]
      simplify  = ["Cos", ["Divide", ["Square", "x"], 4]]
    `));
});

describe('TRIGONOMETRIC FUNCTIONS inverse, prime', () => {
  test(`\\sin^{-1}'(x)`, () =>
    expect(check("\\sin^{-1}'(x)")).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"]], "x"]
      simplify  = ["Apply", ["Derivative", "Arcsin"], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Sin"]]
    `));
  test(`\\sin^{-1}''(x)`, () =>
    expect(check("\\sin^{-1}''(x)")).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"], 2], "x"]
      simplify  = ["Apply", ["Derivative", "Arcsin", 2], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Sin"], 2]
    `));
  test(`\\cos^{-1\\doubleprime}(x)`, () =>
    expect(check('\\cos^{-1\\doubleprime}(x)')).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      simplify  = ["Apply", ["Derivative", "Arccos", 2], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Cos"], 2]
    `));
  test(`\\cos^{-1}\\doubleprime(x)`, () =>
    expect(check('\\cos^{-1}\\doubleprime(x)')).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      simplify  = ["Apply", ["Derivative", "Arccos", 2], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Cos"], 2]
    `));
});

describe('TRIGONOMETRIC FUNCTIONS', () => {
  test(`\\cos(k\\pi)`, () =>
    expect(check('\\cos(k\\pi)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["InvisibleOperator", "k", "Pi"]]
      canonical = ["Cos", ["Multiply", "Pi", "k"]]
      N-auto    = ["Cos", ["Multiply", 3.141592653589793, "k"]]
    `));
  test(`\\cos(\\frac{\\pi}{5})`, () =>
    expect(check('\\cos(\\frac{\\pi}{5})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Divide", "Pi", 5]]
      simplify  = ["Divide", ["Add", ["Sqrt", 5], 1], 4]
      N-auto    = 0.8090169943749475
    `));
});

describe('TRIGONOMETRIC DEGREES', () => {
  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Divide", ["Sqrt", 3], 2]
      N-auto    = 0.8660254037844386
    `));

  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Divide", ["Sqrt", 3], 2]
      N-auto    = 0.8660254037844386
    `));

  test('\\cos(30^\\circ)', () =>
    expect(check('\\cos(30^\\circ)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Divide", ["Sqrt", 3], 2]
      N-auto    = 0.8660254037844386
    `));

  test('\\cos(\\ang{30})', () =>
    expect(check('\\cos(\\ang{30})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Divide", ["Sqrt", 3], 2]
      N-auto    = 0.8660254037844386
    `));
});
