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
      eval-auto = cos(1/4 * x^2)
      eval-mach = cos(1/4 * x^2)
      N-auto    = cos(0.25 * x^2)
      N-mach    = cos(0.25 * x^2)
    `));
});

describe('TRIGONOMETRIC FUNCTIONS inverse, prime', () => {
  test(`\\sin^{-1}'(x)`, () =>
    expect(check("\\sin^{-1}'(x)")).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"]], "x"]
      canonical = ["Apply", ["Derivative", "Arcsin"], "x"]
      eval-auto = (1/sqrt(-x^2 + 1))
    `));
  test(`\\sin^{-1}''(x)`, () =>
    expect(check("\\sin^{-1}''(x)")).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"], 2], "x"]
      canonical = ["Apply", ["Derivative", "Arcsin", 2], "x"]
      eval-auto = (x * (1/sqrt(-x^2 + 1))) / (-x^2 + 1)
    `));
  test(`\\cos^{-1\\doubleprime}(x)`, () =>
    expect(check('\\cos^{-1\\doubleprime}(x)')).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      canonical = ["Apply", ["Derivative", "Arccos", 2], "x"]
      eval-auto = -(x * (1/sqrt(-x^2 + 1))) / (-x^2 + 1)
    `));
  test(`\\cos^{-1}\\doubleprime(x)`, () =>
    expect(check('\\cos^{-1}\\doubleprime(x)')).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      canonical = ["Apply", ["Derivative", "Arccos", 2], "x"]
      eval-auto = -(x * (1/sqrt(-x^2 + 1))) / (-x^2 + 1)
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
