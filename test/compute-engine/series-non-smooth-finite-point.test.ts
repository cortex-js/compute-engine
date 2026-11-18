import { ComputeEngine } from '../../src/compute-engine';

//
// A `Series` at a finite point is a series in `x − x0` on both sides of the
// point. It declines when an absolute value, a sign or a step has its kink or
// jump at the point, and when a root of a power holds for `x > x0` only
// (`√(x²)` is `|x|`, not `x`). The Taylor engines differentiate `|x|` to
// `Sign(x)`, which is 0 at 0, and `√(x²)` was expanded as `x`.
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
