/**
 * The limit at infinity compares the growth of two terms from their form,
 * never from numeric samples.
 *
 * `compareGrowth()` in `src/compute-engine/symbolic/limit.ts` first compares
 * the growth levels of the two terms (bounded, logarithm, power,
 * exponential). When the levels are equal or not known, it uses the exact
 * series of their quotient at infinity, then the limit of `ln|a| − ln|b|`.
 * Samples at `x = 8, 30, 120` cannot rank `e^{√x}` and `x⁵`: their
 * crossover is near `x = 2·10⁴`, so the samples gave 0 for
 * `lim e^{√x}/x⁵`, which is `+∞`.
 *
 * Each expected value follows from the leading asymptotic form of the body:
 * the exponent of each exponential against the logarithm of each power.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// The body is parsed alone and then wrapped, so that a LaTeX `\lim` does not
// take only the first term of a sum as its body.
const atPosInf = (body: string): string =>
  ce
    .box([
      'Limit',
      ['Function', ce.parse(body).json, 'x'],
      'PositiveInfinity',
    ] as never)
    .evaluate()
    .toString();

describe('AN EXPONENTIAL AGAINST A POWER', () => {
  test.each([
    ['e^{\\sqrt{x}}/x^5', '+oo'],
    ['x^5/e^{\\sqrt{x}}', '0'],
    ['e^{\\sqrt[3]{x}}/x^{20}', '+oo'],
    ['x^{20}/e^{\\sqrt[3]{x}}', '0'],
    ['2^{\\sqrt{x}}/x^5', '+oo'],
    ['x^{100}e^{-\\sqrt{x}}', '0'],
    ['e^{\\sqrt{x}}/(x e^{(\\ln x)^2})', '+oo'],
  ])('%s → %s', (body, expected) => {
    expect(atPosInf(body)).toBe(expected);
  });
});

describe('AN EXPONENT THAT GROWS LIKE A LOGARITHM', () => {
  // `e^g` with `g` of the order of `ln x` can be a power of `x`
  // (`e^{2·ln(x + 1)} = (x + 1)²`) or grow faster than every power
  // (`e^{(ln x)²}`). The comparison reads the exponent.
  test.each([
    ['e^{\\ln(x)\\ln(x+1)}/x^9', '+oo'],
    ['e^{(\\ln(x+1))^2}/x^9', '+oo'],
    ['e^{(\\ln(x+1))^{1.5}}/x^9', '+oo'],
    ['e^{2\\ln(x+1)}/x^3', '0'],
    ['e^{2\\ln(x+1)}/x^2', '1'],
    ['x^{100}/e^{(\\ln x)^2}', '0'],
    ['(\\ln x)^{\\ln x}/x^5', '+oo'],
  ])('%s → %s', (body, expected) => {
    expect(atPosInf(body)).toBe(expected);
  });

  test('the degree of a nested power of ln(x + 1) is the exact product of its exponents', () => {
    // ((ln(x+1))^{11/10})^{11/10})^{100/121} = ln(x + 1), so e^g ~ x and
    // e^g/x⁹ → 0. A degree computed in floating point is not exactly 1.
    expect(atPosInf('e^{(((\\ln(x+1))^{11/10})^{11/10})^{100/121}}/x^9')).toBe(
      '0'
    );
  });
});

describe('THE SIGN OF AN EXPONENT IS PROVED, NOT SAMPLED', () => {
  test('x^{1/10} − 10 is negative at x = 10⁸ but tends to +∞', () => {
    expect(atPosInf('e^{x^{1/10}-10}/x')).toBe('+oo');
  });

  test('e^{√x − 500}/x → +∞', () => {
    expect(atPosInf('e^{\\sqrt{x}-500}/x')).toBe('+oo');
  });
});

describe('TWO TERMS OF THE SAME ORDER', () => {
  test('6^x/3^x → +∞: the sign of ln 6 − ln 3 is read from its value', () => {
    expect(atPosInf('6^x/3^x')).toBe('+oo');
  });

  test('2^x/3^x → 0', () => {
    expect(atPosInf('2^x/3^x')).toBe('0');
  });

  test('ln(x)² − 9·ln(x) → +∞', () => {
    expect(atPosInf('\\ln(x)^2-9\\ln(x)')).toBe('+oo');
  });

  test('a difference of logarithms whose arguments have the same leading order tends to 0', () => {
    expect(atPosInf('\\frac12\\ln|x-1|-\\frac12\\ln|x+1|')).toBe('0');
  });

  test('(x + sin x)/x → 1', () => {
    expect(atPosInf('(x+\\sin x)/x')).toBe('1');
  });
});

describe('A DIFFERENCE OF LOGARITHMS UNDER A PRODUCT', () => {
  // ln((x − 1)/(x + 1)) ~ −2/x. The argument of the logarithm tends to 1,
  // so its leading order (x/x = 1) is not used: ln 1 = 0 lost the value.
  test.each([
    ['x(\\ln(x-1)-\\ln(x+1))', '-2'],
    ['x(\\ln|x+2|-\\ln|x|)', '2'],
    ['x(\\frac12\\ln|x-1|-\\frac12\\ln|x+1|)', '-1'],
    ['x(2\\ln(x+1)-2\\ln x)', '2'],
  ])('%s → %s', (body, expected) => {
    expect(atPosInf(body)).toBe(expected);
  });

  test('x/e^{x²·(ln(x − 1) − ln x) + √x} is not 0', () => {
    // x²·ln(1 − 1/x) ~ −x, so the exponent tends to −∞ and the limit is +∞.
    const v = atPosInf('x/e^{x^2(\\ln(x-1)-\\ln x)+\\sqrt{x}}');
    expect(v === '+oo' || v.startsWith('lim')).toBe(true);
  });
});

describe('A FORM THAT THE RULES CANNOT DECIDE STAYS UNEVALUATED', () => {
  test('e^{√(x + x^{0.9})}/e^{√x} is not 1', () => {
    // √(x + x^{0.9}) − √x ~ x^{0.4}/2 → +∞, so the limit is +∞. The
    // leading-order rewrite replaces both radicals by √x; the terms of the
    // difference then cancel, and the rewrite is not used.
    const v = atPosInf('e^{\\sqrt{x+x^{0.9}}}/e^{\\sqrt{x}}');
    expect(v === '+oo' || v.startsWith('lim')).toBe(true);
  });

  test('6^x/(3^x·2^x) is 1 or stays unevaluated', () => {
    // The log difference x·(ln 6 − ln 3 − ln 2) is not proved to be 0, so
    // each comparison declines. The number of comparisons of one limit is
    // bounded, so this case ends quickly.
    const v = atPosInf('6^x/(3^x 2^x)');
    expect(v === '1' || v.startsWith('lim')).toBe(true);
  });

  test('an oscillating ratio is not decided by L’Hôpital’s rule', () => {
    // The parts are bounded, so the rule does not apply: the quotient of the
    // derivatives, cos x / cos x, is 1, but the ratio has no limit.
    expect(atPosInf('(2+\\sin x)/(3+\\sin x)')).toMatch(/^lim/);
  });

  test('a part with a small constant limit is not a 0/0 form', () => {
    // Both parts tend to constants near 0 (10^{-30} and 2·10^{-30}), so the
    // limit is 1/2. L'Hôpital's rule does not apply: the quotient of the
    // derivatives tends to +∞.
    const v = atPosInf('(10^{-30}+e^{-100x})/(2\\cdot10^{-30}+e^{-200x})');
    expect(v === '1/2' || v.startsWith('lim')).toBe(true);
  });
});
