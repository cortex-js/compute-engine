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
      box       = ["Cos", ["Square", ["Divide", "x", 2]]]
      canonical = ["Cos", ["Square", ["Multiply", ["Rational", 1, 2], "x"]]]
      simplify  = cos(1/4 * x^2)
      eval-auto = cos(1/4 * x^2)
      eval-mach = cos(1/4 * x^2)
      N-auto    = cos(0.25 * x^2)
      N-mach    = cos(0.25 * x^2)
    `));
});

describe('TRIGONOMETRIC FUNCTIONS inverse, prime', () => {
  test(`\\sin^{-1}'(x)`, () =>
    expect(check("\\sin^{-1}'(x)")).toMatchInlineSnapshot(`
      box       = ["D", ["Apply", ["InverseFunction", "Sin"], "x"], "x"]
      canonical = ["D", ["Function", ["Arcsin", "x"], "x"], "x"]
      eval-auto = 1 / sqrt(1 - x^2)
    `));
  test(`\\sin^{-1}''(x)`, () =>
    expect(check("\\sin^{-1}''(x)")).toMatchInlineSnapshot(`
      box       = ["D", ["D", ["Apply", ["InverseFunction", "Sin"], "x"], "x"], "x"]
      canonical = [
        "D",
        ["Function", ["D", ["Function", ["Arcsin", "x"], "x"], "x"], "x"],
        "x"
      ]
      eval-auto = x / (1 - x^2)^(3/2)
    `));
  test(`\\cos^{-1\\doubleprime}(x)`, () =>
    expect(check('\\cos^{-1\\doubleprime}(x)')).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      canonical = ["Apply", ["Derivative", "Arccos", 2], "x"]
      eval-auto = -x / (1 - x^2)^(3/2)
    `));
  test(`\\cos^{-1}\\doubleprime(x)`, () =>
    expect(check('\\cos^{-1}\\doubleprime(x)')).toMatchInlineSnapshot(`
      box       = ["D", ["D", ["Apply", ["InverseFunction", "Cos"], "x"], "x"], "x"]
      canonical = [
        "D",
        ["Function", ["D", ["Function", ["Arccos", "x"], "x"], "x"], "x"],
        "x"
      ]
      eval-auto = -x / (1 - x^2)^(3/2)
    `));
});

describe('TRIGONOMETRIC FUNCTIONS', () => {
  test(`\\cos(k\\pi)`, () =>
    expect(check('\\cos(k\\pi)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["InvisibleOperator", "k", "Pi"]]
      canonical = ["Cos", ["Multiply", "Pi", "k"]]
      eval-auto = cos(pi * k)
      eval-mach = cos(pi * k)
      N-auto    = cos(3.14159265358979323846 * k)
      N-mach    = cos(3.141592653589793 * k)
    `));
  test(`\\cos(\\frac{\\pi}{5})`, () =>
    expect(check('\\cos(\\frac{\\pi}{5})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Divide", "Pi", 5]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 5], "Pi"]]
      simplify  = 1/4 + sqrt(5)/4
      eval-auto = 1/4 + sqrt(5)/4
      eval-mach = 1/4 + sqrt(5)/4
      N-auto    = 0.809016994374947424103
      N-mach    = 0.8090169943749472
    `));
});

describe('TRIGONOMETRIC DEGREES', () => {
  // @fixme. Precedence of postfix operator is not correct. Should parse as `\\tan ((90-0.000001)\\degree)`
  test('\\tan (90-0.000001)\\degree', () =>
    expect(check('\\tan (90-0.000001)\\degree')).toMatchInlineSnapshot(`
      box       = ["Degrees", ["Tan", ["Subtract", 90, 0.000001]]]
      canonical = ["Degrees", ["Tan", ["Add", 90, -0.000001]]]
      simplify  = Degrees(tan(89.999999))
      eval-auto = -0.0110844744057936925899 * pi
      eval-mach = -0.011084474405793623 * pi
      N-auto    = -0.0348229033621455533306
      N-mach    = -0.03482290336214534
    `));

  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646763
      N-mach    = 0.866025403784438
    `));

  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646763
      N-mach    = 0.866025403784438
    `));

  test('\\cos(30^\\circ)', () =>
    expect(check('\\cos(30^\\circ)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646763
      N-mach    = 0.866025403784438
    `));

  test('\\cos(\\ang{30})', () =>
    expect(check('\\cos(\\ang{30})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646763
      N-mach    = 0.866025403784438
    `));
});
