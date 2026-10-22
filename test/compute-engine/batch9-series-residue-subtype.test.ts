import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isSubtype } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';

// Three defects found on 2026-10-18:
//
// 1. The Laurent kernel (`symbolic/series.ts`) read a coefficient as 0 only
//    when it was the number literal 0. At a point that is a sum, such as
//    1 + √2, `evaluate()` does not expand a power of a sum, so the constant
//    coefficient of x² − 3 − 2√2 stays `(1 + √2)² − 3 − 2√2`, which is 0. The
//    kernel declined every point that is a sum, and `Series` at such a point
//    returned a wrong regular expansion with a coefficient `1/0`.
// 2. `Residue` at a complex algebraic pole with a numerator that is analytic
//    at the point, but not entire (`ln x`, `tan x`, `√x`, `arctan x`), stayed
//    unevaluated or was slow.
// 3. The subtype test of nested dimensions removed only one outer dimension.
//
// Each expected residue was checked against a numeric contour integral
// (1/2πi)∮f dz on a circle of radius 0.1 around the point, with 20000
// points and an independent complex arithmetic in plain JavaScript.

const ce = new ComputeEngine();

const B = ['Add', 1, ['Sqrt', 2]]; // 1 + √2
const B_VALUE = 1 + Math.SQRT2;
const B_SQUARED = ['Add', 3, ['Multiply', 2, ['Sqrt', 2]]]; // (1 + √2)²
const SQUARE_MINUS_B2 = ['Subtract', ['Power', 'x', 2], B_SQUARED];
const OMEGA = ['Add', ['Rational', 1, 2], ['Multiply', ['Divide', ['Sqrt', 3], 2], 'ImaginaryUnit']]; // prettier-ignore
const CUBE_PLUS_ONE = ['Add', ['Power', 'x', 3], 1];

function limit(f: unknown, point: unknown, dir?: number): Expression {
  const ops: unknown[] = [['Function', f, 'x'], point];
  if (dir !== undefined) ops.push(dir);
  return ce.box(['Limit', ...ops] as any).evaluate();
}

function residue(f: unknown, point: unknown): Expression {
  return ce.box(['Residue', f, 'x', point] as any).evaluate();
}

function series(f: unknown, point: unknown, n: number): Expression {
  return ce.box(['Series', f, 'x', point, n] as any).evaluate();
}

/** The terms of a series result without its `BigO` remainder. */
function withoutRemainder(s: Expression): Expression {
  const terms = s.operator === 'Add' ? s.ops! : [s];
  return ce.function(
    'Add',
    terms.filter((t) => t.operator !== 'BigO')
  );
}

/** The value of `e` at x = `at` as a float (a complex number when `im` is
 * given). */
function valueAt(
  e: Expression,
  re: number,
  im = 0
): { re: number; im: number } {
  const v = e.subs({ x: ce.number(ce.complex(re, im)) }).N();
  return { re: v.re, im: v.im };
}

function expectResidue(r: Expression, re: number, im = 0) {
  expect(r.operator).not.toBe('Residue');
  const n = r.N();
  expect(n.re).toBeCloseTo(re, 10);
  expect(n.im).toBeCloseTo(im, 10);
}

describe('LAURENT KERNEL AT A POINT THAT IS A SUM', () => {
  test('lim_{x→(1+√2)⁺} ln(x² − 3 − 2√2) is −∞ (box route)', () => {
    expect(limit(['Ln', SQUARE_MINUS_B2], B, 1).toString()).toBe('-oo');
  });

  test('lim_{x→(1+√2)⁺} ln(x² − 3 − 2√2) is −∞ (parse route)', () => {
    const r = ce
      .parse('\\lim_{x\\to(1+\\sqrt{2})^+}\\ln(x^2-3-2\\sqrt{2})')
      .evaluate();
    expect(r.toString()).toBe('-oo');
  });

  test('the one-sided limits of 1/(x² − 3 − 2√2) at 1 + √2 are ±∞', () => {
    expect(limit(['Divide', 1, SQUARE_MINUS_B2], B, 1).toString()).toBe('+oo');
    expect(limit(['Divide', 1, SQUARE_MINUS_B2], B, -1).toString()).toBe('-oo');
  });

  test('Series of 1/(x² − 3 − 2√2) at 1 + √2 has a simple pole', () => {
    // 1/(x² − b²) = 1/(t(2b + t)) = 1/(2bt) − 1/(4b²) + t/(8b³) − …
    const s = series(['Divide', 1, SQUARE_MINUS_B2], B, 2);
    expect(s.operator).toBe('Add');
    expect(s.has('BigO')).toBe(true);
    const f = ce.box(['Divide', 1, SQUARE_MINUS_B2] as any);
    const approx = withoutRemainder(s);
    for (const h of [1e-2, 1e-3]) {
      const exact = valueAt(f, B_VALUE + h).re;
      const value = valueAt(approx, B_VALUE + h).re;
      // The value is about 1/(2bh); the remainder is O(h³).
      expect(Math.abs(exact)).toBeGreaterThan(10);
      expect(Math.abs(value - exact)).toBeLessThan(10 * h ** 3);
    }
  });

  test('Series of ln(x² − 3 − 2√2) at 1 + √2 has a logarithmic term', () => {
    const s = series(['Ln', SQUARE_MINUS_B2], B, 2);
    expect(s.has('Ln')).toBe(true);
    const f = ce.box(['Ln', SQUARE_MINUS_B2] as any);
    const approx = withoutRemainder(s);
    for (const h of [1e-2, 1e-3]) {
      const exact = valueAt(f, B_VALUE + h).re;
      const value = valueAt(approx, B_VALUE + h).re;
      expect(Math.abs(value - exact)).toBeLessThan(10 * h ** 3);
    }
  });

  test('Series of 1/(x³ + 1) at 1/2 + (√3/2)i has a simple pole', () => {
    const s = series(['Divide', 1, CUBE_PLUS_ONE], OMEGA, 1);
    expect(s.has('BigO')).toBe(true);
    const f = ce.box(['Divide', 1, CUBE_PLUS_ONE] as any);
    const approx = withoutRemainder(s);
    const h = 1e-3;
    const exact = valueAt(f, 0.5 + h, Math.sqrt(3) / 2);
    const value = valueAt(approx, 0.5 + h, Math.sqrt(3) / 2);
    expect(Math.hypot(exact.re, exact.im)).toBeGreaterThan(100);
    expect(Math.hypot(value.re - exact.re, value.im - exact.im)).toBeLessThan(
      1e-5
    );
  });

  test('Series of sin(x) at 1 + √2 is unchanged (a regular point)', () => {
    expect(series(['Sin', 'x'], B, 2).toString()).toBe(
      'sin(1 + sqrt(2)) + (x - 1 - sqrt(2)) * cos(1 + sqrt(2)) - 1/2 * sin(1 + sqrt(2)) * (x - 1 - sqrt(2))^2 + BigO((x - 1 - sqrt(2))^3)'
    );
  });

  test('a coefficient that only evaluate() collects to 0 is 0 (x0 = π/2)', () => {
    // The constant coefficient of x − π/2 at π/2 is `π/2 − π/2`.
    const P = ['Divide', 'Pi', 2];
    const T = ['Subtract', 'x', P];
    expect(series(['Divide', 1, T], P, 2).toString()).toBe(
      '1 / (x - 1/2 * pi)'
    );
    // tan(π/2 + t) = −1/t + t/3 + t³/45 + …
    expect(series(['Divide', ['Tan', 'x'], T], P, 2).toString()).toBe(
      '-(x - 1/2 * pi)^(-2) + 1/3 + 1/45 * (x - 1/2 * pi)^2 + BigO((x - 1/2 * pi)^4)'
    );
    expect(residue(['Divide', ['Tan', 'x'], T], P).toString()).toBe('0');
    expect(
      residue(['Divide', ['Tan', 'x'], ['Power', T, 2]], P).toString()
    ).toBe('1/3');
  });
});

describe('RESIDUE WITH A NUMERATOR ANALYTIC AT A COMPLEX ALGEBRAIC POLE', () => {
  test('ln(x)/(x³ + 1)² at 1/2 + (√3/2)i', () => {
    expectResidue(
      residue(['Divide', ['Ln', 'x'], ['Power', CUBE_PLUS_ONE, 2]], OMEGA),
      0.2570888182482458,
      -0.02013023860135093
    );
  });

  test('tan(x)/(x³ + 1) at 1/2 + (√3/2)i', () => {
    expectResidue(
      residue(['Divide', ['Tan', 'x'], CUBE_PLUS_ONE], OMEGA),
      0.1881536161694209,
      -0.20237688144543867
    );
  });

  test('√x/(x³ + 1)³ at 1/2 + (√3/2)i', () => {
    expectResidue(
      residue(['Divide', ['Sqrt', 'x'], ['Power', CUBE_PLUS_ONE, 3]], OMEGA),
      0,
      -0.125
    );
  });

  test('arctan(x)/(x² − 3 − 2√2)² at 1 + √2', () => {
    expectResidue(
      residue(['Divide', ['Arctan', 'x'], ['Power', SQUARE_MINUS_B2, 2]], B),
      -0.014649631881661088
    );
  });

  test('ln(x)/(x² − 3 − 2√2)² at 1 + √2', () => {
    expectResidue(
      residue(['Divide', ['Ln', 'x'], ['Power', SQUARE_MINUS_B2, 2]], B),
      0.0021076298999929484
    );
  });

  test('a numerator on its branch cut at the pole stays unevaluated', () => {
    // −1 is on the cut of ln and of √: there is no Laurent expansion.
    expect(residue(['Divide', ['Ln', 'x'], CUBE_PLUS_ONE], -1).operator).toBe(
      'Residue'
    );
    expect(
      residue(['Divide', ['Sqrt', 'x'], ['Add', 'x', 1]], -1).operator
    ).toBe('Residue');
  });
});

describe('POINT THAT IS A SUM WITH A TRANSCENDENTAL CONSTANT', () => {
  // At a = 1 + c, the value of x² − 1 − 2c − c² is `(1 + c)² − 1 − 2c − c²`,
  // which is 0 but does not fold, and holds no radical. The Laurent kernel
  // read it as a value that is not 0, and gave the residue 0. The
  // numerators (arcsin, Γ) are not accepted by the exact Taylor method of
  // `Residue`, so the Laurent kernel computes these residues.
  const square = (c: unknown) => [
    'Subtract',
    ['Power', 'x', 2],
    ['Add', 1, ['Multiply', 2, c], ['Power', c, 2]],
  ];
  const arcsin = ['Arcsin', ['Divide', 'x', 10]];
  const gamma = ['Gamma', 'x'];

  // [name, c, numerator, order of the pole, value of the contour integral]
  const cases: [string, unknown, unknown, number, number][] = [
    ['π', 'Pi', arcsin, 1, 0.0515525025819776],
    ['π', 'Pi', arcsin, 2, 0.00009853242317156494],
    ['π', 'Pi', gamma, 1, 0.8677920947567913],
    ['π', 'Pi', gamma, 2, 0.11043019584618025],
    ['e', 'ExponentialE', arcsin, 1, 0.05123033272280824],
    ['e', 'ExponentialE', arcsin, 2, 0.00009516659644042303],
    ['e', 'ExponentialE', gamma, 1, 0.5729555575569167],
    ['e', 'ExponentialE', gamma, 2, 0.06963889432918767],
    ['ln 2', ['Ln', 2], arcsin, 1, 0.05024203109135632],
    ['ln 2', ['Ln', 2], arcsin, 2, 0.00008553989711028095],
    ['ln 2', ['Ln', 2], gamma, 1, 0.26795013077135493],
    ['ln 2', ['Ln', 2], gamma, 2, -0.03066348666627694],
  ];
  test.each(cases)(
    'Residue at 1 + %s of a quotient (case %#)',
    (_name, c, numerator, order, expected) => {
      const den = order === 1 ? square(c) : ['Power', square(c), 2];
      const r = residue(['Divide', numerator, den], ['Add', 1, c]);
      expect(r.operator).not.toBe('Residue');
      const n = r.N();
      expect(Math.abs(n.re - expected)).toBeLessThan(
        1e-10 * Math.abs(expected)
      );
      expect(Math.abs(n.im)).toBeLessThan(1e-12);
    }
  );

  test('Series of 1/(x² − (1 + π)²) at 1 + π has a simple pole', () => {
    // 1/(x² − a²) = 1/(2at) − 1/(4a²) + t/(8a³) − …
    const a = 1 + Math.PI;
    const s = series(['Divide', 1, square('Pi')], ['Add', 1, 'Pi'], 2);
    expect(s.has('BigO')).toBe(true);
    const approx = withoutRemainder(s);
    for (const h of [1e-2, 1e-3]) {
      const exact = 1 / ((a + h) ** 2 - a ** 2);
      const value = valueAt(approx, a + h).re;
      expect(Math.abs(value - exact)).toBeLessThan(10 * h ** 3);
    }
  });

  test('the limits of 1/(x² − (1 + π)²) at 1 + π', () => {
    // The two sides are +∞ and −∞, so the two-sided limit does not exist.
    const f = ['Divide', 1, square('Pi')];
    expect(limit(f, ['Add', 1, 'Pi']).operator).toBe('Limit');
    expect(limit(f, ['Add', 1, 'Pi'], 1).toString()).toBe('+oo');
    expect(limit(f, ['Add', 1, 'Pi'], -1).toString()).toBe('-oo');
    const r = ce.parse('\\lim_{x\\to 1+\\pi}\\frac{1}{x^2-1-2\\pi-\\pi^2}');
    expect(r.evaluate().operator).toBe('Limit');
  });

  test('lim (x − a)·arcsin(x/10)/(x² − a²) at a = 1 + π', () => {
    // The limit is arcsin(a/10)/(2a).
    const P = ['Add', 1, 'Pi'];
    const r = limit(
      ['Divide', ['Multiply', ['Subtract', 'x', P], arcsin], square('Pi')],
      P
    );
    expect(r.operator).not.toBe('Limit');
    const a = 1 + Math.PI;
    expect(r.N().re).toBeCloseTo(Math.asin(a / 10) / (2 * a), 12);
  });
});

describe('SUBTYPE OF NESTED DIMENSIONS', () => {
  const sub = (a: string, b: string) => isSubtype(parseType(a), parseType(b));

  test.each([
    ['matrix<integer^(2x2)>', 'list<list>'],
    ['matrix<integer^(2x2)>', 'list<list<unknown>>'],
    ['matrix<integer^(2x2)>', 'list<list<integer>>'],
    ['matrix<integer^(2x2)>', 'list<collection>'],
    // The shape of a tensor is spelled in one place, on the outer `matrix` or
    // `tensor` head: the nested spellings `list<vector<integer^2>^2>` and
    // `matrix<list<number>^(1x2)>` are not types. A `tensor` with two axes is
    // the same type as the `matrix` with those axes.
    ['tensor<integer^(2x2)>', 'matrix<integer^(2x2)>'],
    ['tensor<complex^(1x2x3)>', 'tensor<number^(1x2x?)>'],
    ['tensor<complex^(1x2x3)>', 'list<list<list<number>>>'],
    ['tensor<complex^(1x2x3)>', 'list<list>'],
    ['tensor<complex^(1x2x3)>', 'list<list<list>>'],
    ['tensor<complex^(1x2x3)>', 'tensor<number^(1x2x3)>'],
    ['tensor<complex^(1x2x3)>', 'list<list<vector<number^3>>>'],
    ['matrix<integer^(-1x2)>', 'list<vector<integer^2>>'],
  ])('%s is a subtype of %s', (a, b) => {
    expect(sub(a, b)).toBe(true);
  });

  test.each([
    // The rows of a 2×2 matrix have length 2, not 3.
    ['matrix<integer^(2x2)>', 'matrix<integer^(?x3)>'],
    // A 2×2 matrix has 2 rows, not 3.
    ['matrix<integer^(2x2)>', 'matrix<integer^(3x2)>'],
    // The entries are integers, not strings.
    ['matrix<integer^(2x2)>', 'list<list<string>>'],
    // A list is not a set.
    ['matrix<integer^(2x2)>', 'list<set>'],
    // The first two axes are 1×2, not 2×3.
    ['tensor<complex^(1x2x3)>', 'tensor<number^(2x3x?)>'],
    ['tensor<complex^(1x2x3)>', 'tensor<number^(3x?x?)>'],
    ['tensor<complex^(1x2x3)>', 'tensor<number^(2x2x3)>'],
    ['tensor<complex^(1x2x3)>', 'tensor<number^(1x3x3)>'],
    // A complex is not a list: there is no fourth level.
    ['tensor<complex^(1x2x3)>', 'list<list<list<list>>>'],
    // An axis of any length is not an axis of length 3.
    ['matrix<integer^(-1x2)>', 'matrix<integer^(3x2)>'],
    // A list with no shape is not a matrix.
    ['list<list>', 'matrix<integer^(2x2)>'],
    ['list<list<integer>>', 'matrix<integer^(2x2)>'],
    // When the scalar element matches, the rank of a dimensioned type is the
    // number of its dimensions: a matrix is not a vector.
    ['matrix<integer^(2x2)>', 'vector<unknown>'],
    ['matrix<integer^(2x2)>', 'list<any^2>'],
  ])('%s is not a subtype of %s', (a, b) => {
    expect(sub(a, b)).toBe(false);
  });

  test('a matrix value matches a list of lists', () => {
    const m = ce.box(['List', ['List', 1, 2], ['List', 3, 4]]);
    expect(m.type.matches('list<list>')).toBe(true);
    expect(m.type.matches('list<list<unknown>>')).toBe(true);
  });
});
