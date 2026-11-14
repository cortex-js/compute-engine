import { ComputeEngine } from '../../src/compute-engine';

//
// A series at −∞ is the expansion at s = 0⁺ of f(−1/s): a root of a square
// (`√(x²) = −x` for x < 0) keeps its sign. A series at ±∞ of a function with
// a step or a kink of `x` (`|x|`, `⌊x⌋`) declines: the derivative of `|s|`
// and of a step at s = 0 is 0, and the leading term was lost (CE-1293).
//

const ce = new ComputeEngine();

const series = (f: unknown, point: string, n = 3) =>
  ce.expr(['Series', f, 'x', point, n] as never).evaluate();

/** The distance between the value of the truncated series at `x` and the
 * value of `f` there, in the complex plane. */
function distance(f: unknown, point: string, x: number): number {
  const s = series(f, point);
  expect(s.operator).not.toBe('Series');
  const p = ce.expr(['Normal', s] as never).evaluate();
  const at = (e: ReturnType<typeof ce.expr>) => {
    const v = e.subs({ x: ce.number(x) }).N();
    return [v.re, v.im];
  };
  const [a, b] = [at(p), at(ce.expr(f as never))];
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe('SERIES AT −∞ OF A ROOT OF A SQUARE', () => {
  const sqrtX2 = ['Sqrt', ['Power', 'x', 2]];
  const cases: [string, unknown][] = [
    ['1/(√(x²) + 1)', ['Divide', 1, ['Add', sqrtX2, 1]]],
    ['√(x² + 1)', ['Sqrt', ['Add', ['Power', 'x', 2], 1]]],
    ['√(x² + x) − x', ['Subtract', ['Sqrt', ['Add', ['Power', 'x', 2], 'x']], 'x']],
    ['√(x² + x)/x', ['Divide', ['Sqrt', ['Add', ['Power', 'x', 2], 'x']], 'x']],
    ['1/√(1 − x)', ['Divide', 1, ['Sqrt', ['Subtract', 1, 'x']]]],
    ['√(x + 1)', ['Sqrt', ['Add', 'x', 1]]],
    ['1/(√x + 1)', ['Divide', 1, ['Add', ['Sqrt', 'x'], 1]]],
  ];
  for (const [name, f] of cases) {
    for (const point of ['NegativeInfinity', 'PositiveInfinity']) {
      const x = point === 'NegativeInfinity' ? -40 : 40;
      test(`${name} at ${point} is close to the function at x = ${x}`, () => {
        expect(distance(f, point, x)).toBeLessThan(1e-4);
      });
    }
  }

  test('1/(√(x²) + 1) at −∞ is −1/x − 1/x² − 1/x³ + O(x⁻⁴)', () => {
    const expected = ce.parse('-\\frac{1}{x}-\\frac{1}{x^2}-\\frac{1}{x^3}');
    const p = ce
      .expr([
        'Normal',
        series(['Divide', 1, ['Add', sqrtX2, 1]], 'NegativeInfinity'),
      ] as never)
      .evaluate();
    expect(p.sub(expected).simplify().isSame(0)).toBe(true);
  });

  test('a function of x with no branch keeps its expansion at −∞', () => {
    const f = ['Divide', ['Power', 'x', 3], ['Subtract', 'x', 1]];
    const expected = ce.parse('x^2+x+1+\\frac{1}{x}+\\frac{1}{x^2}+\\frac{1}{x^3}');
    const p = ce.expr(['Normal', series(f, 'NegativeInfinity')] as never);
    expect(p.evaluate().sub(expected).simplify().isSame(0)).toBe(true);
  });

  test('arctan at −∞ is −π/2 − 1/x + 1/(3x³) + O(x⁻⁵)', () => {
    expect(distance(['Arctan', 'x'], 'NegativeInfinity', -20)).toBeLessThan(
      1e-6
    );
  });
});

describe('SERIES AT ±∞ OF A FUNCTION WITH A STEP OR A KINK', () => {
  const declined: [string, unknown, string][] = [
    ['1/|x|', ['Divide', 1, ['Abs', 'x']], 'PositiveInfinity'],
    ['1/|x|', ['Divide', 1, ['Abs', 'x']], 'NegativeInfinity'],
    ['1/⌊x⌋', ['Divide', 1, ['Floor', 'x']], 'PositiveInfinity'],
    ['1/⌈x⌉', ['Divide', 1, ['Ceil', 'x']], 'NegativeInfinity'],
    ['Sign(x)/x', ['Divide', ['Sign', 'x'], 'x'], 'PositiveInfinity'],
  ];
  for (const [name, f, point] of declined)
    test(`${name} at ${point} stays Series`, () => {
      expect(series(f, point).operator).toBe('Series');
    });

  test('|a|/x at +∞, where a does not depend on x, expands', () => {
    const s = series(['Divide', ['Abs', 'a'], 'x'], 'PositiveInfinity');
    expect(s.operator).not.toBe('Series');
  });
});
