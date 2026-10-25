import { check } from '../../utils';
import { ComputeEngine } from '../../../src/compute-engine';

describe('TRIGONOMETRIC FUNCTIONS implicit arguments', () => {
  test(`\\cos x + 1`, () =>
    expect(check('\\cos x + 1')).toMatchInlineSnapshot(
      `["Add", ["Cos", "x"], 1]`
    ));
  test(`\\cos x - \\sin x`, () =>
    expect(check('\\cos x - \\sin x')).toMatchInlineSnapshot(
      `["Subtract", ["Cos", "x"], ["Sin", "x"]]`
    ));
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
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"], 1], "x"]
      canonical = ["Apply", ["Derivative", "Arcsin", 1], "x"]
      eval-auto = 1 / sqrt(1 - x^2)
    `));
  test(`\\sin^{-1}''(x)`, () =>
    expect(check("\\sin^{-1}''(x)")).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Sin"], 2], "x"]
      canonical = ["Apply", ["Derivative", "Arcsin", 2], "x"]
      eval-auto = x / (1 - x^2)^(3/2)
      eval-mach = x / (1 - x^2)^(3/2)
      N-auto    = x / (1 - x^2)^(1.5)
      N-mach    = x / (1 - x^2)^(1.5)
    `));
  test(`\\cos^{-1\\doubleprime}(x)`, () =>
    expect(check('\\cos^{-1\\doubleprime}(x)')).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      canonical = ["Apply", ["Derivative", "Arccos", 2], "x"]
      eval-auto = -x / (1 - x^2)^(3/2)
      eval-mach = -x / (1 - x^2)^(3/2)
      N-auto    = -x / (1 - x^2)^(1.5)
      N-mach    = -x / (1 - x^2)^(1.5)
    `));
  test(`\\cos^{-1}\\doubleprime(x)`, () =>
    expect(check('\\cos^{-1}\\doubleprime(x)')).toMatchInlineSnapshot(`
      box       = ["Apply", ["Derivative", ["InverseFunction", "Cos"], 2], "x"]
      canonical = ["Apply", ["Derivative", "Arccos", 2], "x"]
      eval-auto = -x / (1 - x^2)^(3/2)
      eval-mach = -x / (1 - x^2)^(3/2)
      N-auto    = -x / (1 - x^2)^(1.5)
      N-mach    = -x / (1 - x^2)^(1.5)
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
      N-auto    = 0.809016994374947424102
      N-mach    = 0.8090169943749475
    `));
});

describe('TRIGONOMETRIC DEGREES', () => {
  // A degree sign after a parenthesized argument applies to the argument:
  // this is `\tan((90-0.000001)\degree)`, about 180/(π·10⁻⁶) (CE-305.3).
  test('\\tan (90-0.000001)\\degree', () =>
    expect(check('\\tan (90-0.000001)\\degree')).toMatchInlineSnapshot(`
      box       = ["Tan", ["Degrees", ["Subtract", 90, 0.000001]]]
      canonical = ["Tan", ["Degrees", ["Add", 90, -0.000001]]]
      simplify  = 57295779.5130823143841
      eval-auto = 57295779.5130823143841
      eval-mach = 57295779.81445014
    `));

  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646764
      N-mach    = 0.8660254037844386
    `));

  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646764
      N-mach    = 0.8660254037844386
    `));

  test('\\cos(30^\\circ)', () =>
    expect(check('\\cos(30^\\circ)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646764
      N-mach    = 0.8660254037844386
    `));

  test('\\cos(\\ang{30})', () =>
    expect(check('\\cos(\\ang{30})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Multiply", ["Rational", 1, 6], "Pi"]]
      simplify  = sqrt(3)/2
      eval-auto = sqrt(3)/2
      eval-mach = sqrt(3)/2
      N-auto    = 0.866025403784438646764
      N-mach    = 0.8660254037844386
    `));
});

describe('TRIGONOMETRIC FUNCTIONS spellings of arccot', () => {
  const ce = new ComputeEngine();
  test('\\operatorname{arccot} and \\operatorname{arcctg} are Arccot', () => {
    for (const latex of [
      '\\operatorname{arccot}(x)',
      '\\operatorname{arccot} x',
      '\\mathrm{arccot}(x)',
      '\\operatorname{arcctg}(x)',
    ])
      expect(ce.parse(latex).json).toEqual(['Arccot', 'x']);
  });
});
