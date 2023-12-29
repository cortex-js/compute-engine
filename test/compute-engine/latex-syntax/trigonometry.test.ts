import { check } from '../../utils';

describe('TRIGONOMETRIC FUNCTIONS implicit arguments', () => {
  test(`\\cos x + 1`, () =>
    expect(check('\\cos x + 1')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Cos", "x"], 1]
      ["Add", ["Cos", "x"], 1]
    `));
  test(`\\cos x - \\sin x`, () =>
    expect(check('\\cos x - \\sin x')).toMatchInlineSnapshot(`
      latex     = ["Subtract", ["Cos", "x"], ["Sin", "x"]]
      box       = ["Subtract", ["Cos", "x"], ["Sin", "x"]]
      simplify  = ["Add", ["Cos", "x"], ["Negate", ["Sin", "x"]]]
    `));
  test(`\\cos \\frac{x}{2}^2`, () =>
    expect(check('\\cos \\frac{x}{2}^2')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["Power", ["Divide", "x", 2], 2]]
      ["Cos", ["Square", ["Divide", "x", 2]]]
    `));
});

describe('TRIGONOMETRIC FUNCTIONS inverse, prime', () => {
  test(`\\sin^{-1}'(x)`, () =>
    expect(check("\\sin^{-1}'(x)")).toMatchInlineSnapshot(`
      latex     = ["Apply", ["Derivative", ["InverseFunction", "Sin"]], "x"]
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"]], "x"]
      simplify  = ["Apply", ["Derivative", "Arcsin"], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Sin"]]
    `));
  test(`\\sin^{-1}''(x)`, () =>
    expect(check("\\sin^{-1}''(x)")).toMatchInlineSnapshot(`
      latex     = ["Apply", ["Derivative", ["InverseFunction", "Sin"], 2], "x"]
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"], 2], "x"]
      simplify  = ["Apply", ["Derivative", "Arcsin", 2], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Sin"], 2]
    `));
  test(`\\cos^{-1\\doubleprime}(x)`, () =>
    expect(check('\\cos^{-1\\doubleprime}(x)')).toMatchInlineSnapshot(`
      latex     = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      simplify  = ["Apply", ["Derivative", "Arccos", 2], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Cos"], 2]
    `));
  test(`\\cos^{-1}\\doubleprime(x)`, () =>
    expect(check('\\cos^{-1}\\doubleprime(x)')).toMatchInlineSnapshot(`
      latex     = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      simplify  = ["Apply", ["Derivative", "Arccos", 2], "x"]
      evaluate  = ["Derivative", ["InverseFunction", "Cos"], 2]
    `));
});

describe('TRIGONOMETRIC FUNCTIONS', () => {
  test(`\\cos(k\\pi)`, () =>
    expect(check('\\cos(k\\pi)')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["InvisibleOperator", "k", "Pi"]]
      box       = ["Cos", ["Multiply", "k", "Pi"]]
      canonical = ["Cos", ["Multiply", "Pi", "k"]]
      N-auto    = [
        "Cos",
        [
          "Multiply",
          "3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117068",
          "k"
        ]
      ]
      N-mach    = ["Cos", ["Multiply", 3.141592653589793, "k"]]
    `));
  test(`\\cos(\\frac{\\pi}{5})`, () =>
    expect(check('\\cos(\\frac{\\pi}{5})')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["Divide", "Pi", 5]]
      box       = ["Cos", ["Divide", "Pi", 5]]
      simplify  = ["Divide", ["Add", ["Sqrt", 5], 1], 4]
      N-auto    = 0.8090169943749474241022934171828190588601545899028814310677243113526302314094512248536036020946955688
      N-mach    = 0.8090169943749475
    `));
});

describe('TRIGONOMETRIC DEGREES', () => {
  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["Degrees", 30]]
      box       = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Multiply", "Half", ["Sqrt", 3]]
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624288
      N-mach    = 0.8660254037844386
    `));

  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["Degrees", 30]]
      box       = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Multiply", "Half", ["Sqrt", 3]]
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624288
      N-mach    = 0.8660254037844386
    `));

  test('\\cos(30^\\circ)', () =>
    expect(check('\\cos(30^\\circ)')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["Degrees", 30]]
      box       = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Multiply", "Half", ["Sqrt", 3]]
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624288
      N-mach    = 0.8660254037844386
    `));

  test('\\cos(\\ang{30})', () =>
    expect(check('\\cos(\\ang{30})')).toMatchInlineSnapshot(`
      latex     = ["Cos", ["Degrees", 30]]
      box       = ["Cos", ["Divide", "Pi", 6]]
      simplify  = ["Multiply", "Half", ["Sqrt", 3]]
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624288
      N-mach    = 0.8660254037844386
    `));
});
