/**
 * The limit at infinity of a difference of radicals (2026-10-19).
 *
 * `lim_{t→∞} √(t+1) − √t` stayed unevaluated; the limit is 0. The two
 * radicals grow at the same rate, so the leading-order rewrite of the limit
 * at infinity cannot rank their difference. The limit code now writes the
 * difference with the conjugate, `√u − √v = (u − v)/(√u + √v)`, and expands
 * the numerator so that its leading terms cancel. The same rewrite applies
 * to a radical minus a term that grows at the same rate
 * (`√(t² + t) − t = t/(√(t² + t) + t)`), and to a root of a higher integer
 * degree (`∛u − ∛v = (u − v)/(∛u² + ∛u·∛v + ∛v²)`).
 *
 * Also: `|u|` at infinity had no rule, so `√(t² + 1)` (whose leading order
 * `√(t²)` simplifies to `|t|`) stayed unevaluated at `+∞`. And a ratio whose
 * leading terms still contained `|t|` or `√(t²)` was read from numeric
 * probes, which gave a float: `√(2t² + 1)/t` was `1.414…`, not `√2`. As
 * `t → +∞`, `|t|` and `√(t²)` are `t`, and the ratio is now exact.
 *
 * The same numeric reading gave a float from `evaluate()` for other limits
 * of the form `x·f(c/x)`: `x·ln(1 + π/x)` was `3.14159265356268`. The limit
 * at infinity now reads the exact value from the series of the function
 * with `x = 1/u` at `u = 0`, and a value that it cannot find exactly leaves
 * the limit unevaluated (`evaluate()` returns an exact value or stays
 * symbolic; only `.N()` gives a float).
 *
 * Each expected value was checked against the body evaluated at
 * t = ±10⁶, ±10¹² and ±10¹⁸ with 60 digits of precision.
 */
import type { Expression } from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const limit = (body: unknown, point: string): Expression =>
  ce.box(['Limit', ['Function', body, 't'], point] as never).evaluate();

const atPosInf = (body: unknown): string =>
  limit(body, 'PositiveInfinity').toString();
const atNegInf = (body: unknown): string =>
  limit(body, 'NegativeInfinity').toString();

describe('A DIFFERENCE OF TWO SQUARE ROOTS', () => {
  test('√(t+1) − √t → 0', () => {
    expect(
      atPosInf(['Subtract', ['Sqrt', ['Add', 't', 1]], ['Sqrt', 't']])
    ).toBe('0');
  });

  test('√(t² + 3t) − √(t² + t) → 1', () => {
    expect(
      atPosInf([
        'Subtract',
        ['Sqrt', ['Add', ['Square', 't'], ['Multiply', 3, 't']]],
        ['Sqrt', ['Add', ['Square', 't'], 't']],
      ])
    ).toBe('1');
  });

  test('√(t² + t) − √(t² − t) → 1', () => {
    expect(
      atPosInf([
        'Subtract',
        ['Sqrt', ['Add', ['Square', 't'], 't']],
        ['Sqrt', ['Subtract', ['Square', 't'], 't']],
      ])
    ).toBe('1');
  });

  test('√t·(√(t+1) − √t) → 1/2', () => {
    expect(
      atPosInf([
        'Multiply',
        ['Sqrt', 't'],
        ['Subtract', ['Sqrt', ['Add', 't', 1]], ['Sqrt', 't']],
      ])
    ).toBe('1/2');
  });

  test('t·(√(t+1) − √t) → +∞', () => {
    expect(
      atPosInf([
        'Multiply',
        't',
        ['Subtract', ['Sqrt', ['Add', 't', 1]], ['Sqrt', 't']],
      ])
    ).toBe('+oo');
  });

  test('a difference that diverges: √(2t) − √t → +∞', () => {
    expect(
      atPosInf(['Subtract', ['Sqrt', ['Multiply', 2, 't']], ['Sqrt', 't']])
    ).toBe('+oo');
  });

  test('the parse route', () => {
    expect(
      ce
        .parse('\\lim_{t\\to\\infty} (\\sqrt{t+1} - \\sqrt{t})')
        .evaluate()
        .toString()
    ).toBe('0');
  });
});

describe('A SQUARE ROOT MINUS A TERM THAT GROWS AT THE SAME RATE', () => {
  test('√(t² + t) − t → 1/2', () => {
    expect(
      atPosInf(['Subtract', ['Sqrt', ['Add', ['Square', 't'], 't']], 't'])
    ).toBe('1/2');
  });

  test('t − √(t² + t) → −1/2', () => {
    expect(
      atPosInf(['Subtract', 't', ['Sqrt', ['Add', ['Square', 't'], 't']]])
    ).toBe('-1/2');
  });

  test('√(t² + 1) − t → 0', () => {
    expect(
      atPosInf(['Subtract', ['Sqrt', ['Add', ['Square', 't'], 1]], 't'])
    ).toBe('0');
  });

  test('√(t² + t) − (t + 1) → −1/2', () => {
    expect(
      atPosInf([
        'Subtract',
        ['Sqrt', ['Add', ['Square', 't'], 't']],
        ['Add', 't', 1],
      ])
    ).toBe('-1/2');
  });

  test('a number coefficient: 2√(t² + t) − 2t → 1', () => {
    expect(
      atPosInf([
        'Subtract',
        ['Multiply', 2, ['Sqrt', ['Add', ['Square', 't'], 't']]],
        ['Multiply', 2, 't'],
      ])
    ).toBe('1');
  });

  test('a difference that diverges: √(t² + t) − 2t → −∞', () => {
    expect(
      atPosInf([
        'Subtract',
        ['Sqrt', ['Add', ['Square', 't'], 't']],
        ['Multiply', 2, 't'],
      ])
    ).toBe('-oo');
  });
});

describe('AT MINUS INFINITY', () => {
  test('√(t² + t) + t → −1/2', () => {
    expect(
      atNegInf(['Add', ['Sqrt', ['Add', ['Square', 't'], 't']], 't'])
    ).toBe('-1/2');
  });

  test('√(t² + t) − t → +∞', () => {
    expect(
      atNegInf(['Subtract', ['Sqrt', ['Add', ['Square', 't'], 't']], 't'])
    ).toBe('+oo');
  });
});

describe('A ROOT OF A HIGHER DEGREE', () => {
  test('∛(t+1) − ∛t → 0', () => {
    expect(
      atPosInf(['Subtract', ['Root', ['Add', 't', 1], 3], ['Root', 't', 3]])
    ).toBe('0');
  });

  test('∛(t³ + t²) − t → 1/3', () => {
    expect(
      atPosInf([
        'Subtract',
        ['Root', ['Add', ['Power', 't', 3], ['Square', 't']], 3],
        't',
      ])
    ).toBe('1/3');
  });
});

describe('AN ABSOLUTE VALUE AT INFINITY', () => {
  test('√(t² + 1) → +∞ at +∞ and at −∞', () => {
    expect(atPosInf(['Sqrt', ['Add', ['Square', 't'], 1]])).toBe('+oo');
    expect(atNegInf(['Sqrt', ['Add', ['Square', 't'], 1]])).toBe('+oo');
  });

  test('|1 − t²| → +∞', () => {
    expect(atPosInf(['Abs', ['Subtract', 1, ['Square', 't']]])).toBe('+oo');
  });

  test('|(1 − 2t)/(t + 3)| → 2', () => {
    expect(
      atPosInf([
        'Abs',
        ['Divide', ['Subtract', 1, ['Multiply', 2, 't']], ['Add', 't', 3]],
      ])
    ).toBe('2');
  });

  test('√(t² + 1)/t → −1 at −∞', () => {
    expect(
      atNegInf(['Divide', ['Sqrt', ['Add', ['Square', 't'], 1]], 't'])
    ).toBe('-1');
  });
});

describe('AN EXACT RATIO OF LEADING TERMS WITH A RADICAL', () => {
  const lim = (latex: string) => ce.parse(latex).evaluate().toString();

  test('√(2t² + 1)/t → √2', () => {
    expect(lim('\\lim_{t\\to\\infty} \\frac{\\sqrt{2t^2+1}}{t}')).toBe(
      'sqrt(2)'
    );
  });

  test('√(3t² + 1)/(t + 1) → −√3 at −∞', () => {
    expect(lim('\\lim_{t\\to-\\infty} \\frac{\\sqrt{3t^2+1}}{t+1}')).toBe(
      '-sqrt(3)'
    );
  });

  test('∛(2t³ + 1)/t → ∛2', () => {
    expect(lim('\\lim_{t\\to\\infty} \\frac{\\sqrt[3]{2t^3+1}}{t}')).toBe(
      'root(3)(2)'
    );
  });

  test('an irrational coefficient: √2·√(t² + t) − √2·t → √2/2', () => {
    expect(
      lim('\\lim_{t\\to\\infty} (\\sqrt{2}\\sqrt{t^2+t}-\\sqrt{2}t)')
    ).toBe('sqrt(2)/2');
  });
});

describe('A LIMIT AT INFINITY OF THE FORM x·f(c/x)', () => {
  const parse = (latex: string) => ce.parse(latex);

  test.each([
    ['\\lim_{x\\to\\infty} x\\ln(1+\\frac{\\pi}{x})', 'pi'],
    ['\\lim_{x\\to\\infty} x\\sin(\\frac{\\sqrt{2}}{x})', 'sqrt(2)'],
    ['\\lim_{x\\to\\infty} x\\arctan(\\frac{e}{x})', 'e'],
    ['\\lim_{x\\to\\infty} x^2(1-\\cos(\\frac{\\sqrt{3}}{x}))', '3/2'],
    ['\\lim_{x\\to\\infty} (1+\\frac{\\pi}{x})^x', 'e^(pi)'],
    ['\\lim_{x\\to\\infty} x(e^{1/x}-1)', '1'],
    ['\\lim_{x\\to-\\infty} x(e^{\\pi/x}-1)', 'pi'],
    ['\\lim_{x\\to\\infty} x^2(e^{1/x}-1-\\frac{1}{x})', '1/2'],
    ['\\lim_{x\\to\\infty} x(2^{1/x}-1)', 'ln(2)'],
  ])('%s is exact', (latex, expected) => {
    expect(parse(latex).evaluate().toString()).toBe(expected);
  });

  test('.N() gives a float', () => {
    const v = parse('\\lim_{x\\to\\infty} x\\ln(1+\\frac{\\pi}{x})').N();
    expect(v.re).toBeCloseTo(Math.PI, 12);
    expect(v.isExact).toBe(false);
    const w = parse('\\lim_{x\\to\\infty} x\\sin(\\frac{\\sqrt{2}}{x})').N();
    expect(w.re).toBeCloseTo(Math.SQRT2, 12);
    expect(w.isExact).toBe(false);
  });

  test('a float in the function gives a float', () => {
    const v = parse('\\lim_{x\\to\\infty} x\\sin(\\frac{1.3}{x})');
    expect(v.evaluate().toString()).toBe('1.3');
    expect(v.N().toString()).toBe('1.3');
  });
});

// The conjugate rewrite `a − b = (aⁿ − bⁿ)/(aⁿ⁻¹ + … + bⁿ⁻¹)` expands the
// numerator so that its leading terms cancel. This is certain only when `aⁿ`
// and `bⁿ` are polynomials in the variable. With another function, the
// expanded numerator kept terms that cancel only at leading order, and the
// result was wrong (the value before the fix is in each test name). Each
// expected value was checked against the body evaluated at t = 10⁶, 10¹²
// and 10¹⁸ with 80 digits of precision.
describe('A RADICAL MINUS A TERM THAT IS NOT A POLYNOMIAL', () => {
  const sq = ['Sqrt', ['Add', ['Square', 't'], 't']];

  test('√(t² + t) − t·cos(1/t) → 1/2 (was 0)', () => {
    expect(
      atPosInf(['Subtract', sq, ['Multiply', 't', ['Cos', ['Divide', 1, 't']]]])
    ).toBe('1/2');
  });

  test('√(t² + t) − t·e^(1/t) → −1/2 (was −1)', () => {
    expect(
      atPosInf(['Subtract', sq, ['Multiply', 't', ['Exp', ['Divide', 1, 't']]]])
    ).toBe('-1/2');
  });

  test('√(t² + t) − t·√(1 + 3/t) → −1 (was −3/2)', () => {
    expect(
      atPosInf([
        'Subtract',
        sq,
        ['Multiply', 't', ['Sqrt', ['Add', 1, ['Divide', 3, 't']]]],
      ])
    ).toBe('-1');
  });

  test('√(t² + t) − t²·sin(1/t) → 1/2 (was 0)', () => {
    expect(
      atPosInf([
        'Subtract',
        sq,
        ['Multiply', ['Square', 't'], ['Sin', ['Divide', 1, 't']]],
      ])
    ).toBe('1/2');
  });

  test('∛(t³ + 2t²) − ∛(t³·e^(1/t)) → 1/3 (was −1/3)', () => {
    expect(
      atPosInf([
        'Subtract',
        [
          'Root',
          ['Add', ['Power', 't', 3], ['Multiply', 2, ['Square', 't']]],
          3,
        ],
        [
          'Root',
          ['Multiply', ['Power', 't', 3], ['Exp', ['Divide', 1, 't']]],
          3,
        ],
      ])
    ).toBe('1/3');
  });

  test('√(t² + 3t) − √(t²·e^(1/t)) → 1 (was −1/2)', () => {
    expect(
      atPosInf([
        'Subtract',
        ['Sqrt', ['Add', ['Square', 't'], ['Multiply', 3, 't']]],
        ['Sqrt', ['Multiply', ['Square', 't'], ['Exp', ['Divide', 1, 't']]]],
      ])
    ).toBe('1');
  });
});

// An exponent that is not an integer but has an integer double value: the
// exact `2 + 10^-30` has the double value 2. `√(t^(2 + 10^-30))/t` is
// `t^(10^-30/2)`, which goes to +∞ (very slowly). It was read as `t/t`, and
// the limit was 1.
describe('A RADICAL OF A POWER WITH AN EXPONENT CLOSE TO AN INTEGER', () => {
  const r = ['Add', 2, ['Power', 10, -30]];

  test('√(t^(2 + 10^-30))/t → +∞', () => {
    expect(atPosInf(['Divide', ['Sqrt', ['Power', 't', r]], 't'])).toBe('+oo');
  });

  test('⌊√(t^(2 + 10^-30))/t⌋ is not 1', () => {
    expect(
      atPosInf(['Floor', ['Divide', ['Sqrt', ['Power', 't', r]], 't']])
    ).not.toBe('1');
  });

  test('a float exponent: √(t^2.0000000001)/t → +∞', () => {
    expect(
      atPosInf(['Divide', ['Sqrt', ['Power', 't', 2.0000000001]], 't'])
    ).toBe('+oo');
  });

  test('(−t)^(2 + 10^-30) has no signed limit', () => {
    expect(atPosInf(['Power', ['Negate', 't'], r])).not.toBe('+oo');
  });
});

describe('A SUM OF EXACT CONSTANTS AT INFINITY', () => {
  test('√3 + √5 + 1/t → √3 + √5 (was a float)', () => {
    expect(
      atPosInf(['Add', ['Sqrt', 3], ['Sqrt', 5], ['Divide', 1, 't']])
    ).toBe('sqrt(3) + sqrt(5)');
  });

  test('√3 − √2 + 1/t → √3 − √2', () => {
    expect(
      atPosInf([
        'Add',
        ['Sqrt', 3],
        ['Negate', ['Sqrt', 2]],
        ['Divide', 1, 't'],
      ])
    ).toBe('-sqrt(2) + sqrt(3)');
  });

  test('a float term gives a float', () => {
    const v = limit(
      ['Add', 1.5, ['Sqrt', 5], ['Divide', 1, 't']],
      'PositiveInfinity'
    );
    expect(v.isExact).toBe(false);
    expect(v.re).toBeCloseTo(1.5 + Math.sqrt(5), 12);
  });
});
