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
      canonical = ["Cos", ["Divide", ["Square", "x"], 4]]
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
      N-auto    = cos(3.141592653589793 * k)
      N-mach    = cos(3.141592653589793 * k)
    `));
  test(`\\cos(\\frac{\\pi}{5})`, () =>
    expect(check('\\cos(\\frac{\\pi}{5})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Divide", "Pi", 5]]
      simplify  = (1 + sqrt(5)) / 4
      eval-auto = (1 + sqrt(5)) / 4
      eval-mach = (1 + sqrt(5)) / 4
      N-auto    = 0.809016994374947424102293417182819058860154589902881431067724311352630231409451224853603602094695568742377044037693445876063316931111768465896590030383363177216694543297969791452819161330659964145133940337604383446250855848103516110521608134774313148156807219074879350610170402943977227374623092847683
      N-mach    = 0.8090169943749475
    `));
});

describe('TRIGONOMETRIC DEGREES', () => {
  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = sqrt(3) / 2
      eval-auto = sqrt(3) / 2
      eval-mach = sqrt(3) / 2
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624287837813070707703351514984972547499476239405827756047186824264046615951152791033987410050542337461632507656171633451661443325336127334460918985613523565830183930794009524993268689929694733825173753288026
      N-mach    = 0.8660254037844387
    `));

  test('\\cos(30\\degree)', () =>
    expect(check('\\cos(30\\degree)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = sqrt(3) / 2
      eval-auto = sqrt(3) / 2
      eval-mach = sqrt(3) / 2
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624287837813070707703351514984972547499476239405827756047186824264046615951152791033987410050542337461632507656171633451661443325336127334460918985613523565830183930794009524993268689929694733825173753288026
      N-mach    = 0.8660254037844387
    `));

  test('\\cos(30^\\circ)', () =>
    expect(check('\\cos(30^\\circ)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = sqrt(3) / 2
      eval-auto = sqrt(3) / 2
      eval-mach = sqrt(3) / 2
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624287837813070707703351514984972547499476239405827756047186824264046615951152791033987410050542337461632507656171633451661443325336127334460918985613523565830183930794009524993268689929694733825173753288026
      N-mach    = 0.8660254037844387
    `));

  test('\\cos(\\ang{30})', () =>
    expect(check('\\cos(\\ang{30})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Degrees", 30]]
      canonical = ["Cos", ["Divide", "Pi", 6]]
      simplify  = sqrt(3) / 2
      eval-auto = sqrt(3) / 2
      eval-mach = sqrt(3) / 2
      N-auto    = 0.866025403784438646763723170752936183471402626905190314027903489725966508454400018540573093378624287837813070707703351514984972547499476239405827756047186824264046615951152791033987410050542337461632507656171633451661443325336127334460918985613523565830183930794009524993268689929694733825173753288026
      N-mach    = 0.8660254037844387
    `));
});
