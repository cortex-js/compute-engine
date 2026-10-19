import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// `Residue` and `Limit` at a pole that is an algebraic point written as a
// sum (1 + √2, 1/2 + (√3/2)i). `evaluate()` does not expand a power of a
// sum, so the value of the denominator at such a point stays a sum that is
// 0, for example `1 + (1/2 + (√3/2)i)³`. The residue was read as 0 and the
// limit as the value `1/(1 + (1/2 + (√3/2)i)³)`, which is `1/0`.
//
// Each expected value was checked against a numeric contour integral
// (1/2πi)∮f dz on a small circle around the point.

const ce = new ComputeEngine();

const A = ['Add', ['Rational', 1, 2], ['Multiply', ['Divide', ['Sqrt', 3], 2], 'ImaginaryUnit']]; // prettier-ignore
const A_TEX = '\\frac12+\\frac{\\sqrt3}{2}i';
const B = ['Add', 1, ['Sqrt', 2]];
const B_SQUARED = ['Add', 3, ['Multiply', 2, ['Sqrt', 2]]];

const CUBE_PLUS_ONE = ['Add', ['Power', 'x', 3], 1];
const SQUARE_MINUS_B2 = ['Subtract', ['Power', 'x', 2], B_SQUARED];
const SQUARE_MINUS_2 = ['Subtract', ['Power', 'x', 2], 2];

function residue(f: unknown, point: unknown): Expression {
  return ce.box(['Residue', f, 'x', point] as any).evaluate();
}

function limit(f: unknown, point: unknown, dir?: number): Expression {
  const ops: unknown[] = [['Function', f, 'x'], point];
  if (dir !== undefined) ops.push(dir);
  return ce.box(['Limit', ...ops] as any).evaluate();
}

function expectValue(r: Expression, re: number, im = 0) {
  expect(r.operator).not.toBe('Residue');
  expect(r.operator).not.toBe('Limit');
  const n = r.N();
  expect(n.re).toBeCloseTo(re, 12);
  expect(n.im).toBeCloseTo(im, 12);
}

// The result is exact: the value has no machine float in it.
function expectExact(r: Expression) {
  expect(JSON.stringify(r.json)).not.toMatch(/\d\.\d/);
}

describe('RESIDUE AT AN ALGEBRAIC POLE', () => {
  test('simple complex pole of 1/(x³ + 1)', () => {
    // 1/(3a²) = −a/3 because a³ = −1.
    const r = residue(['Divide', 1, CUBE_PLUS_ONE], A);
    expectValue(r, -1 / 6, -Math.sqrt(3) / 6);
    expectExact(r);
    expect(r.toString()).toBe('-1/6 - sqrt(3)/6i');
  });

  test('simple real pole of 1/(x² − (3 + 2√2))', () => {
    // 1/(2b) with b = 1 + √2, which is (√2 − 1)/2.
    const r = residue(['Divide', 1, SQUARE_MINUS_B2], B);
    expectValue(r, (Math.SQRT2 - 1) / 2);
    expectExact(r);
    expect(r.isEqual(ce.box(['Divide', ['Subtract', ['Sqrt', 2], 1], 2]))).toBe(
      true
    );
  });

  test('double complex pole of 1/(x³ + 1)²', () => {
    const r = residue(['Divide', 1, ['Power', CUBE_PLUS_ONE, 2]], A);
    expectValue(r, -1 / 9, -Math.sqrt(3) / 9);
    expectExact(r);
  });

  test('triple complex pole of 1/(x³ + 1)³', () => {
    const r = residue(['Divide', 1, ['Power', CUBE_PLUS_ONE, 3]], A);
    expectValue(r, -5 / 54, (-5 * Math.sqrt(3)) / 54);
    expectExact(r);
  });

  test('double real pole of x²/(x² − (3 + 2√2))²', () => {
    // d/dx [x²/(x + b)²] at b is 1/(4b).
    const r = residue(
      ['Divide', ['Power', 'x', 2], ['Power', SQUARE_MINUS_B2, 2]],
      B
    );
    expectValue(r, 1 / (4 * (1 + Math.SQRT2)));
    expectExact(r);
  });

  test('double pole of x/(x − b)² with the denominator expanded', () => {
    const r = residue(
      [
        'Divide',
        'x',
        ['Add', ['Power', 'x', 2], ['Multiply', -2, B, 'x'], B_SQUARED],
      ],
      B
    );
    expectValue(r, 1);
  });

  test('a numerator that is not a polynomial: eˣ/(x³ + 1)', () => {
    // e^a / (3a²) = −a·e^a / 3.
    const ar = 0.5;
    const ai = Math.sqrt(3) / 2;
    const er = Math.exp(ar) * Math.cos(ai);
    const ei = Math.exp(ar) * Math.sin(ai);
    const r = residue(['Divide', ['Exp', 'x'], CUBE_PLUS_ONE], A);
    expectValue(r, -(ar * er - ai * ei) / 3, -(ar * ei + ai * er) / 3);
  });

  test('removable point: the numerator vanishes too', () => {
    // x² − x + 1 = (x³ + 1)/(x + 1), so the function is 1/(x + 1) there.
    const r = residue(
      ['Divide', ['Add', ['Power', 'x', 2], ['Negate', 'x'], 1], CUBE_PLUS_ONE],
      A
    );
    expect(r.isSame(0)).toBe(true);
  });

  test('a point that is not a pole', () => {
    // a³ − 1 = −2.
    const r = residue(['Divide', 1, ['Subtract', ['Power', 'x', 3], 1]], A);
    expect(r.isSame(0)).toBe(true);
  });

  test('parse route', () => {
    const r = ce
      .parse(`\\operatorname{Residue}(\\frac{1}{x^3+1}, x, ${A_TEX})`)
      .evaluate();
    expect(r.toString()).toBe('-1/6 - sqrt(3)/6i');
    const r2 = ce
      .parse(
        '\\operatorname{Residue}(\\frac{1}{x^2-(3+2\\sqrt2)}, x, 1+\\sqrt2)'
      )
      .evaluate();
    expectValue(r2, (Math.SQRT2 - 1) / 2);
  });

  test('N() of the residue', () => {
    const r = ce
      .box(['Residue', ['Divide', 1, CUBE_PLUS_ONE], 'x', A] as any)
      .N();
    expect(r.re).toBeCloseTo(-1 / 6, 12);
    expect(r.im).toBeCloseTo(-Math.sqrt(3) / 6, 12);
  });
});

describe('LIMIT AT AN ALGEBRAIC POLE', () => {
  // A two-sided limit at a simple pole stays unevaluated: the engine does
  // not answer a limit with `ComplexInfinity` (as for `lim_{x→0} 1/x` and
  // `lim_{x→i} 1/(x² + 1)`). Before the fix it was the value
  // `1/(1 + (1/2 + (√3/2)i)³)`, which is `1/0`.
  test('two-sided limit at a complex simple pole stays unevaluated', () => {
    const r = limit(['Divide', 1, CUBE_PLUS_ONE], A);
    expect(r.operator).toBe('Limit');
    // The numeric fallback samples at real arguments only; it must not
    // answer the value near the real part of the point (8/9).
    expect(
      ce
        .box([
          'Limit',
          ['Function', ['Divide', 1, CUBE_PLUS_ONE], 'x'],
          A,
        ] as any)
        .N().operator
    ).toBe('Limit');
  });

  test('two-sided limit at a real simple pole stays unevaluated', () => {
    expect(limit(['Divide', 1, SQUARE_MINUS_B2], B).operator).toBe('Limit');
  });

  test('one-sided limits at a real simple pole', () => {
    expect(limit(['Divide', 1, SQUARE_MINUS_B2], B, 1).toString()).toBe('+oo');
    expect(limit(['Divide', 1, SQUARE_MINUS_B2], B, -1).toString()).toBe('-oo');
  });

  test('two-sided limit at a real double pole', () => {
    expect(
      limit(['Divide', 1, ['Power', SQUARE_MINUS_B2, 2]], B).toString()
    ).toBe('+oo');
    expect(
      limit(['Divide', -1, ['Power', SQUARE_MINUS_B2, 2]], B).toString()
    ).toBe('-oo');
  });

  test('removable point: the numerator vanishes too', () => {
    // 1/(a + 1) = 1/2 − (√3/6)i.
    const r = limit(
      ['Divide', ['Add', ['Power', 'x', 2], ['Negate', 'x'], 1], CUBE_PLUS_ONE],
      A
    );
    expectValue(r, 1 / 2, -Math.sqrt(3) / 6);
    // 1/(2b).
    const r2 = limit(['Divide', ['Subtract', 'x', B], SQUARE_MINUS_B2], B);
    expectValue(r2, 1 / (2 * (1 + Math.SQRT2)));
    expectExact(r2);
  });

  test('a point that is not a pole', () => {
    const r = limit(['Divide', 1, ['Subtract', ['Power', 'x', 3], 1]], A);
    expectValue(r, -1 / 2);
    expectExact(r);
  });

  test('parse route', () => {
    expect(
      ce.parse(`\\lim_{x\\to ${A_TEX}}\\frac{1}{x^3+1}`).evaluate().operator
    ).toBe('Limit');
    expect(
      ce
        .parse('\\lim_{x\\to (1+\\sqrt2)^-}\\frac{1}{x^2-3-2\\sqrt2}')
        .evaluate()
        .toString()
    ).toBe('-oo');
    expectValue(
      ce
        .parse('\\lim_{x\\to 1+\\sqrt2}\\frac{x-1-\\sqrt2}{x^2-3-2\\sqrt2}')
        .evaluate(),
      1 / (2 * (1 + Math.SQRT2))
    );
  });

  test('a logarithm of an argument that is 0 at the point is not its value', () => {
    // The substitution gave `ln((1 + √2)² − 3 − 2√2)`, which is `ln 0`.
    const r = limit(['Ln', SQUARE_MINUS_B2], B, 1);
    expect(r.operator).toBe('Limit');
  });
});

describe('RESIDUE AT A BRANCH POINT', () => {
  // A branch point has no Laurent expansion. The residue was read as 0,
  // because `lim x·(√x/x)` at 0 is 0.
  test('√x/x at 0 stays unevaluated', () => {
    expect(residue(['Divide', ['Sqrt', 'x'], 'x'], 0).operator).toBe('Residue');
  });

  test('1/ln(x) at 0 stays unevaluated', () => {
    expect(residue(['Divide', 1, ['Ln', 'x']], 0).operator).toBe('Residue');
  });

  test('x^(1/3)/x² at 0 stays unevaluated', () => {
    expect(
      residue(
        ['Divide', ['Power', 'x', ['Rational', 1, 3]], ['Power', 'x', 2]],
        0
      ).operator
    ).toBe('Residue');
  });

  test('a root that is analytic at the pole: √x/(x − 4) at 4', () => {
    expect(
      residue(['Divide', ['Sqrt', 'x'], ['Subtract', 'x', 4]], 4).isSame(2)
    ).toBe(true);
  });

  test('1/ln(x) at 1 is a simple pole', () => {
    expect(residue(['Divide', 1, ['Ln', 'x']], 1).isSame(1)).toBe(true);
  });
});

describe('NUMERIC LIMIT AT A POINT THAT IS NOT REAL', () => {
  // The extrapolation samples at real arguments. It read the point i as 0
  // and answered 1 for 1/(x² + 1).
  test('Limit(...).N() at i stays unevaluated', () => {
    const r = ce.parse('\\lim_{x\\to i}\\frac{1}{x^2+1}').N();
    expect(r.operator).toBe('Limit');
  });

  test('NLimit at i stays unevaluated', () => {
    const r = ce
      .box([
        'NLimit',
        ['Function', ['Divide', 1, ['Add', ['Power', 'x', 2], 1]], 'x'],
        'ImaginaryUnit',
      ])
      .evaluate();
    expect(r.operator).toBe('NLimit');
  });

  test('a symbolic limit at a point that is not real still evaluates', () => {
    expectValue(
      ce.parse('\\lim_{x\\to i}\\frac{\\sin x}{x}').N(),
      Math.sinh(1)
    );
  });

  test('NLimit at a real point still evaluates', () => {
    const r = ce
      .box([
        'NLimit',
        ['Function', ['Divide', 1, ['Add', ['Power', 'x', 2], 1]], 'x'],
        2,
      ])
      .evaluate();
    expect(r.re).toBeCloseTo(0.2, 10);
  });
});

describe('RESIDUE WITH AN ENTIRE NUMERATOR THAT IS NOT A POLYNOMIAL', () => {
  // `exactComplexParts()` cannot compute the parts of sin(a) for a point a
  // that is not real. The residue was declined after a slow search (4.6 s),
  // and at a double pole the search did not end.
  test('simple pole of sin(x)/(x³ + 1)', () => {
    // sin(a)/(3a²)
    const r = residue(['Divide', ['Sin', 'x'], CUBE_PLUS_ONE], A);
    expectValue(r, 0.136078509994035, -0.336729584750157);
  }, 5000);

  test('double pole of sin(x)/(x³ + 1)²', () => {
    // Checked against a numeric contour integral.
    const r = residue(['Divide', ['Sin', 'x'], ['Power', CUBE_PLUS_ONE, 2]], A);
    const n = r.N();
    expect(n.re).toBeCloseTo(0.0676466104079, 10);
    expect(n.im).toBeCloseTo(-0.0802848547634, 10);
  }, 5000);

  test('a time limit stops a slow residue', () => {
    // arctan is not entire, so the residue comes from the slow search over
    // the limits of (x − b)ⁿ·f.
    const f = ['Divide', ['Arctan', 'x'], ['Power', SQUARE_MINUS_B2, 2]];
    const start = Date.now();
    expect(() =>
      ce.withTimeLimit({ ms: 200, label: 'test:residue' }, () => residue(f, B))
    ).toThrow(/Timeout/);
    expect(Date.now() - start).toBeLessThan(2000);
  }, 5000);
});

describe('HIDDEN ZEROS AT A RADICAL POINT AND AFTER A SHIFT', () => {
  // (x + 1)² − 3 − 2√2 is 0 at √2, but its value does not fold.
  const D = ['Subtract', ['Power', ['Add', 'x', 1], 2], B_SQUARED];

  test('Residue at √2', () => {
    const r = residue(['Divide', 1, D], ['Sqrt', 2]);
    expectValue(r, 1 / (2 * (1 + Math.SQRT2)));
  });

  test('Limit at √2', () => {
    const r = limit(['Divide', ['Subtract', 'x', ['Sqrt', 2]], D], ['Sqrt', 2]);
    expectValue(r, 1 / (2 * (1 + Math.SQRT2)));
    expect(limit(['Divide', 1, D], ['Sqrt', 2], 1).toString()).toBe('+oo');
  });

  test('a two-sided limit at a simple pole is not 0', () => {
    // (x − b)·arctan(x)/(x² − b²)² has a simple pole at b. The limit at a
    // point that is a sum is also taken at 0 after the shift x = b + t,
    // where the denominator is a sum with √2 that is 0 at t = 0.
    const r = limit(
      [
        'Divide',
        ['Multiply', ['Subtract', 'x', B], ['Arctan', 'x']],
        ['Power', SQUARE_MINUS_B2, 2],
      ],
      B
    );
    expect(r.operator).toBe('Limit');
  });
});

describe('RESIDUE ON A BRANCH CUT', () => {
  // The principal branches of √, ln and fractional powers have their cut on
  // the negative real axis. A function whose argument is a negative real
  // number at the point is not analytic there.
  test('1/√(x² − 2) at 1 stays unevaluated', () => {
    expect(residue(['Divide', 1, ['Sqrt', SQUARE_MINUS_2]], 1).operator).toBe(
      'Residue'
    );
  });

  test('√x/(x + 4) at −4 stays unevaluated', () => {
    expect(
      residue(['Divide', ['Sqrt', 'x'], ['Add', 'x', 4]], -4).operator
    ).toBe('Residue');
  });

  test('ln(x)/(x + 1) at −1 stays unevaluated', () => {
    expect(residue(['Divide', ['Ln', 'x'], ['Add', 'x', 1]], -1).operator).toBe(
      'Residue'
    );
  });

  test('a pole off the cut: √(x + 5)/(x − 4) at 4', () => {
    expect(
      residue(
        ['Divide', ['Sqrt', ['Add', 'x', 5]], ['Subtract', 'x', 4]],
        4
      ).isSame(3)
    ).toBe(true);
  });

  test('a pole off the cut: 1/((x − 3)√x) at 3', () => {
    expectValue(
      residue(
        ['Divide', 1, ['Multiply', ['Subtract', 'x', 3], ['Sqrt', 'x']]],
        3
      ),
      1 / Math.sqrt(3)
    );
  });
});
