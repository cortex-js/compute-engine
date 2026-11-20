import { ComputeEngine } from '../../src/compute-engine';

//
// A `Series` at a finite point is a series in `x − x0` on both sides of the
// point. It declines when an absolute value, a sign or a step has its kink or
// jump at the point, and when a root or a logarithm of a power holds for
// `x > x0` only (`√(x²)` is `|x|`, not `x`; `ln(x²)` is `2·ln|x|`, not
// `2·ln(x)`). The Taylor engines differentiate `|x|` to `Sign(x)`, which is 0
// at 0, `√(x²)` was expanded as `x` and `ln(x²)` as `2·ln(x)`.
//

const ce = new ComputeEngine();

const series = (f: unknown, point: unknown = 0, n = 3) =>
  ce.expr(['Series', f, 'x', point, n] as never).evaluate();

const half = ['Rational', 1, 2];

describe('SERIES AT A KINK OR A JUMP DECLINES', () => {
  const declined: [string, unknown, unknown][] = [
    ['|x| at 0', ['Abs', 'x'], 0],
    ['sign(x) at 0', ['Sign', 'x'], 0],
    ['Heaviside(x) at 0', ['Heaviside', 'x'], 0],
    ['|sin(x)| at 0', ['Abs', ['Sin', 'x']], 0],
    ['|x − 1| at 1', ['Abs', ['Subtract', 'x', 1]], 1],
    ['floor(x) at 0', ['Floor', 'x'], 0],
    ['floor(x) at 1', ['Floor', 'x'], 1],
    ['floor(2x) at 1/2', ['Floor', ['Multiply', 2, 'x']], half],
    ['ceil(x) at 1', ['Ceil', 'x'], 1],
    ['round(x) at 1/2', ['Round', 'x'], half],
    ['truncate(x) at 1', ['Truncate', 'x'], 1],
    ['mod(x, 1) at 0', ['Mod', 'x', 1], 0],
    [
      'if(x > 0, x, −x) at 0',
      ['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']],
      0,
    ],
    // |1 + i·x| is 1 + x²/2 for a real x, not 1 + i·x.
    [
      '|1 + i·x| at 0',
      ['Abs', ['Add', 1, ['Multiply', 'ImaginaryUnit', 'x']]],
      0,
    ],
    // ln(x) is −∞ at 0 and not real for x < 0: sign(ln x) is not −1.
    ['sign(ln x) at 0', ['Sign', ['Ln', 'x']], 0],
    // A step with a step `s` jumps at the multiples of `|s|` (`Round` at the
    // odd multiples of `|s|/2`).
    ['floor(x, 2) at 2', ['Floor', 'x', 2], 2],
    ['floor(x, −2) at 4', ['Floor', 'x', -2], 4],
    ['round(x, 2) at 1', ['Round', 'x', 2], 1],
    ['ceil(x, 1/2) at 1/2', ['Ceil', 'x', half], half],
    ['truncate(x, 3) at 3', ['Truncate', 'x', 3], 3],
    ['floor(x, y) at 1', ['Floor', 'x', 'y'], 1],
  ];
  for (const [name, f, point] of declined)
    test(`${name} stays Series`, () =>
      expect(series(f, point).operator).toBe('Series'));
});

describe('SERIES AWAY FROM A KINK OR A JUMP', () => {
  test('|x| at 1 is x', () =>
    expect(series(['Abs', 'x'], 1).toString()).toBe('x + BigO((x - 1)^4)'));
  test('|x − 1| at 1/2 is 1 − x', () =>
    expect(series(['Abs', ['Subtract', 'x', 1]], half).toString()).toBe(
      '1 - x + BigO((x - 1/2)^4)'
    ));
  test('sign(x) at 1 is 1', () =>
    expect(series(['Sign', 'x'], 1).toString()).toBe('1 + BigO((x - 1)^4)'));
  test('floor(x) at 1/2 is 0', () =>
    expect(series(['Floor', 'x'], half).toString()).toBe('BigO((x - 1/2)^4)'));
  test('round(x) at 0 is 0', () =>
    expect(series(['Round', 'x']).toString()).toBe('BigO(x^4)'));
  test('truncate(x) at 0 is 0', () =>
    expect(series(['Truncate', 'x']).toString()).toBe('BigO(x^4)'));
  test('floor(x, 2) at 1 is 0', () =>
    expect(series(['Floor', 'x', 2], 1).toString()).toBe('BigO((x - 1)^4)'));
  test('floor(x, −2) at 1 is 0', () =>
    expect(series(['Floor', 'x', -2], 1).toString()).toBe('BigO((x - 1)^4)'));
  test('round(x, 2) at 2 is 2', () =>
    expect(series(['Round', 'x', 2], 2).toString()).toBe(
      '2 + BigO((x - 2)^4)'
    ));
  test('ceil(x, 1/2) at 1/4 is 1/2', () =>
    expect(series(['Ceil', 'x', half], ['Rational', 1, 4]).toString()).toBe(
      '1/2 + BigO((x - 1/4)^4)'
    ));
  test('truncate(x, 3) at −2 is 0', () =>
    expect(series(['Truncate', 'x', 3], -2).toString()).toBe(
      'BigO((x + 2)^4)'
    ));
  test('|sin(x)| at 1 is sin(x)', () =>
    expect(series(['Abs', ['Sin', 'x']], 1).toString()).toBe(
      'sin(1) + (x - 1) * cos(1) - 1/2 * sin(1) * (x - 1)^2 - 1/6 * cos(1) * (x - 1)^3 + BigO((x - 1)^4)'
    ));
});

describe('SERIES OF A ROOT OF A POWER AT ITS ZERO', () => {
  const declined: [string, unknown][] = [
    // |x|, not x.
    ['√(x²)', ['Sqrt', ['Power', 'x', 2]]],
    ['√(x² + x⁴)', ['Sqrt', ['Add', ['Power', 'x', 2], ['Power', 'x', 4]]]],
    // √(−1) = i, but (−1)^{3/2} = −i.
    ['√(x³)', ['Sqrt', ['Power', 'x', 3]]],
    // √|x| for x < 0, not i·√x = −√|x|.
    ['√(−x)', ['Sqrt', ['Negate', 'x']]],
    // (x²)^{1/4} = |x|^{1/2}.
    ['root(x², 4)', ['Root', ['Power', 'x', 2], 4]],
    // −x⁴ + i·x⁵ crosses the cut of √ at x = 0: the sign of the series
    // changes on the side x < 0.
    [
      '√(−x⁴ + i·x⁵)',
      [
        'Sqrt',
        [
          'Add',
          ['Negate', ['Power', 'x', 4]],
          ['Multiply', 'ImaginaryUnit', ['Power', 'x', 5]],
        ],
      ],
    ],
  ];
  for (const [name, f] of declined)
    test(`${name} at 0 stays Series`, () =>
      expect(series(f).operator).toBe('Series'));

  test('√((x − 1)²) at 1 stays Series', () =>
    expect(
      series(['Sqrt', ['Power', ['Subtract', 'x', 1], 2]], 1).operator
    ).toBe('Series'));

  test('√(x⁴) at 0 is x²', () =>
    expect(series(['Sqrt', ['Power', 'x', 4]]).toString()).toBe(
      'x^2 + BigO(x^(7/2))'
    ));
  test('√(sin x) at 0 holds for x > 0 and, as a principal root, x < 0', () =>
    expect(series(['Sqrt', ['Sin', 'x']]).toString()).toBe(
      '-1/12 * x^(5/2) + sqrt(x) + BigO(x^(9/2))'
    ));
  // An odd root of a negative real number is real: (x²)^{1/3} = x^{2/3}.
  test('(x²)^{1/3} at 0 is x^{2/3}', () =>
    expect(
      series(['Power', ['Power', 'x', 2], ['Rational', 1, 3]]).toString()
    ).toBe('x^(2/3) + BigO(x^4)'));
});

//
// `lnLaurent()` writes ln(c·t^m·(1 + h)) as m·ln(t) + ln(c) + log1p(h). For
// t < 0 the two sides differ by a multiple of 2πi, unless the argument has
// the sign of t (ln x, ln(sin x)), of −1/t, or is positive near the point.
//

describe('SERIES OF A LOGARITHM AT A ZERO OR A POLE OF ITS ARGUMENT', () => {
  const x2 = ['Power', 'x', 2];
  const ix2 = ['Multiply', 'ImaginaryUnit', x2];
  const x10 = ['Power', 'x', 10];

  const declined: [string, unknown, unknown][] = [
    // 2·ln|x|, not 2·ln(x) = 2·ln|x| + 2πi for x < 0.
    ['ln(x²) at 0', ['Ln', x2], 0],
    ['ln(−x²) at 0', ['Ln', ['Negate', x2]], 0],
    // ln|x| for x < 0, not ln(x) + iπ = ln|x| + 2πi.
    ['ln(−x) at 0', ['Ln', ['Negate', 'x']], 0],
    ['ln(x³) at 0', ['Ln', ['Power', 'x', 3]], 0],
    // −ln|x| + iπ for x < 0, not −ln(x) = −ln|x| − iπ.
    ['ln(1/x) at 0', ['Ln', ['Divide', 1, 'x']], 0],
    ['ln(1 − cos x) at 0', ['Ln', ['Subtract', 1, ['Cos', 'x']]], 0],
    ['ln(x²·(1 + x)) at 0', ['Ln', ['Multiply', x2, ['Add', 1, 'x']]], 0],
    ['log₁₀(x²) at 0', ['Log', x2], 0],
    ['x·ln(x²) at 0', ['Multiply', 'x', ['Ln', x2]], 0],
    ['ln(1 − x) at 1', ['Ln', ['Subtract', 1, 'x']], 1],
    ['ln Γ(x) at 0', ['Ln', ['Gamma', 'x']], 0],
    // The sign of `a` is not known: ln(a) + ln(x) holds for a > 0 only.
    ['ln(a·x) at 0', ['Ln', ['Multiply', 'a', 'x']], 0],
    // −i·|x| for x < 0: ln|x| − iπ/2, not ln(x) + iπ/2.
    ['ln(i·x) at 0', ['Ln', ['Multiply', 'ImaginaryUnit', 'x']], 0],
    // x − i·x² crosses the cut of ln at x = 0, on the side x < 0.
    ['ln(x − i·x²) at 0', ['Ln', ['Subtract', 'x', ix2]], 0],
    // The same with a term that is not real past the coefficients that the
    // expansion computes.
    [
      'ln(x − i·x¹⁰) at 0',
      ['Ln', ['Subtract', 'x', ['Multiply', 'ImaginaryUnit', x10]]],
      0,
    ],
    // The incomplete gamma function Γ(1/2, −1) is about 1.77 − 2.93i.
    [
      'ln(x + Γ(1/2, −1)·x¹⁰) at 0',
      ['Ln', ['Add', 'x', ['Multiply', ['Gamma', half, -1], x10]]],
      0,
    ],
    // √(x − 1) is not real near 0.
    [
      'ln(x + x¹⁰·√(x − 1)) at 0',
      ['Ln', ['Add', 'x', ['Multiply', x10, ['Sqrt', ['Subtract', 'x', 1]]]]],
      0,
    ],
    // The cube root of a negative real number is real: ln(−∛|x|).
    ['ln(∛x) at 0', ['Ln', ['Root', 'x', 3]], 0],
    // x·(1 + √x) crosses the cut of ln at x = 0, on the side x < 0.
    [
      'ln(x + x^{3/2}) at 0',
      ['Ln', ['Add', 'x', ['Power', 'x', ['Rational', 3, 2]]]],
      0,
    ],
  ];
  for (const [name, f, point] of declined)
    test(`${name} stays Series`, () =>
      expect(series(f, point).operator).toBe('Series'));

  /** `|f − Normal(Series(f))|` at the distance `dx` from `point`. */
  const gap = (f: unknown, point: number, dx: number): number => {
    const s = series(f, point);
    expect(s.operator).not.toBe('Series');
    const normal = ce.expr(['Normal', s.json] as never).evaluate();
    const d = ce
      .expr(['Subtract', f, normal.json] as never)
      .subs({ x: point + dx })
      .N();
    return Math.hypot(d.re, d.im);
  };

  const held: [string, unknown, number][] = [
    ['ln(x) at 0', ['Ln', 'x'], 0],
    ['ln(2x) at 0', ['Ln', ['Multiply', 2, 'x']], 0],
    ['ln(sin x) at 0', ['Ln', ['Sin', 'x']], 0],
    ['ln(x·(1 + x)) at 0', ['Ln', ['Multiply', 'x', ['Add', 1, 'x']]], 0],
    ['ln(eˣ − 1) at 0', ['Ln', ['Subtract', ['Exp', 'x'], 1]], 0],
    ['ln(arctan x) at 0', ['Ln', ['Arctan', 'x']], 0],
    // Positive for x < 0, on the cut for x > 0, as −ln(x) + iπ is.
    ['ln(−1/x) at 0', ['Ln', ['Divide', -1, 'x']], 0],
    ['ln(x − 1) at 1', ['Ln', ['Subtract', 'x', 1]], 1],
    // The argument is near 1 on both sides.
    ['ln(1 + √x) at 0', ['Ln', ['Add', 1, ['Sqrt', 'x']]], 0],
    // Γ(x) is about −1/(x + 1) at −1.
    ['ln Γ(x) at −1', ['Ln', ['Gamma', 'x']], -1],
  ];
  for (const [name, f, point] of held)
    test(`${name} holds on both sides`, () => {
      expect(gap(f, point, 0.01)).toBeLessThan(1e-6);
      expect(gap(f, point, -0.01)).toBeLessThan(1e-6);
    });
});
