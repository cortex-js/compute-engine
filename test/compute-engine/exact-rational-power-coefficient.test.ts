import { ComputeEngine } from '../../src/compute-engine';

//
// An exact number raised to a rational exponent `p/q` is the `q`-th root
// followed by the integer power `p`. The result is exact when the root is
// exact (`8^(2/3) = 4`). When it is not (`2^(2/3)`), a product keeps the
// power as a symbolic term: an exact input does not give a float.
//

const ce = new ComputeEngine();

describe('Exact number to a rational power', () => {
  const cases: [[number, number], [number, number], string, number][] = [
    [[8, 1], [2, 3], '4', Math.pow(8, 2 / 3)],
    [[4, 1], [3, 2], '8', Math.pow(4, 3 / 2)],
    [[1, 8], [-2, 3], '4', Math.pow(1 / 8, -2 / 3)],
    [[27, 8], [2, 3], '9/4', Math.pow(27 / 8, 2 / 3)],
    [[-27, 1], [-2, 3], '1/9', Math.pow(27, -2 / 3)],
    // The real cube root of a negative value, as `root()` gives
    [[-8, 1], [2, 3], '4', Math.pow(8, 2 / 3)],
  ];
  for (const [base, exp, exact, value] of cases) {
    test(`(${base[0]}/${base[1]})^(${exp[0]}/${exp[1]})`, () => {
      const result = ce
        ._numericValue({ rational: base })
        .pow(ce._numericValue({ rational: exp }));
      expect(result.isExact).toBe(true);
      expect(result.toString()).toBe(exact);
      expect(result.re).toBeCloseTo(value, 14);
    });
  }

  test('a root that is not exact gives a float', () => {
    const result = ce
      ._numericValue({ rational: [2, 1] })
      .pow(ce._numericValue({ rational: [2, 3] }));
    expect(result.isExact).toBe(false);
    expect(result.re).toBeCloseTo(Math.pow(2, 2 / 3), 14);
  });
});

describe('The coefficient of a power in a product', () => {
  // [LaTeX, evaluated, values of the free variables]
  const cases: [string, string, Record<string, number>][] = [
    ['(8x+8)^{2/3}y', '4y * (x + 1)^(2/3)', { x: 1.5, y: 2 }],
    ['(2x+2)^{2/3}y', 'y * 2^(2/3) * (x + 1)^(2/3)', { x: 1.5, y: 2 }],
    [
      '\\frac13(2x^2+2)^{-2/3}',
      '1 / (3 * 2^(2/3) * (x^2 + 1)^(2/3))',
      { x: 1.5 },
    ],
    ['(2x+2)^{-1/3}', '1 / (root(3)(2) * root(3)(x + 1))', { x: 1.5 }],
    ['(2x)^{2/3}y', 'y * 2^(2/3) * x^(2/3)', { x: 1.5, y: 2 }],
    ['(8x)^{2/3}y', '4y * x^(2/3)', { x: 1.5, y: 2 }],
    ['(2x)^{-2/3}y', 'y / (2^(2/3) * x^(2/3))', { x: 1.5, y: 2 }],
  ];
  for (const [latex, exact, point] of cases) {
    test(`${latex} is exact`, () => {
      const result = ce.parse(latex).evaluate();
      expect(result.toString()).toBe(exact);
      // The exact result agrees with a float computation of the input
      const direct = ce.parse(latex).subs(point).N();
      expect(result.subs(point).N().re).toBeCloseTo(direct.re, 14);
    });
  }

  test('.N() gives a float coefficient', () => {
    const result = ce.parse('(2x+2)^{-1/3}').N();
    expect(result.toString()).toBe(
      '1 / (1.25992104989487316477 * root(3)(x + 1))'
    );
    expect(result.subs({ x: 1.5 }).N().re).toBeCloseTo(Math.pow(5, -1 / 3), 14);
  });

  test('a float coefficient folds', () => {
    const result = ce.parse('(2.0x+2.0)^{2/3}y').evaluate();
    expect(result.subs({ x: 1.5, y: 2 }).N().re).toBeCloseTo(
      2 * Math.pow(5, 2 / 3),
      14
    );
  });
});
