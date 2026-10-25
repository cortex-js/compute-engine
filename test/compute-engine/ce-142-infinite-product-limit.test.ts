import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const evaluate = (latex: string) => ce.parse(latex).evaluate().toString();
const N = (latex: string) => ce.parse(latex).N().toString();

/** The partial product of `f` for `k` from `a` to `n`. */
function partial(f: (k: number) => number, a: number, n: number): number {
  let p = 1;
  for (let k = a; k <= n; k++) p *= f(k);
  return p;
}

// CE-142.2, CE-142.7: an infinite product of a rational body whose partial
// products tend to 0 or to an infinity has that limit as its value, under
// `evaluate()` and `.N()`.
describe('CE-142.2 and CE-142.7 infinite products with a 0 or infinite limit', () => {
  test.each([
    ['\\prod_{k=1}^\\infty k', '+oo'],
    ['\\prod_{k=1}^\\infty \\frac{k+1}{k}', '+oo'],
    ['\\prod_{k=1}^\\infty \\frac{k}{k+1}', '0'],
    ['\\prod_{k=1}^\\infty \\frac{2k+1}{2k}', '+oo'],
    ['\\prod_{k=1}^\\infty \\frac{2k-3}{2k}', '0'],
    ['\\prod_{k=1}^\\infty \\frac{k}{3k+1}', '0'],
    ['\\prod_{k=1}^\\infty (2k-3)', '-oo'],
    ['\\prod_{k=1}^\\infty (k-3)', '0'],
  ])('%s', (latex, expected) => {
    expect(evaluate(latex)).toBe(expected);
    expect(N(latex)).toBe(expected);
  });

  test('the limits agree with the partial products', () => {
    // k/(k+1): the partial product is 1/(n+1).
    expect(partial((k) => k / (k + 1), 1, 1e6)).toBeLessThan(1e-5);
    // (2k+1)/(2k): the partial product grows like √n.
    expect(partial((k) => (2 * k + 1) / (2 * k), 1, 1e6)).toBeGreaterThan(1e3);
    // (2k−3)/(2k): the partial product decays like n^(−3/2).
    expect(Math.abs(partial((k) => (2 * k - 3) / (2 * k), 1, 1e6))).toBeLessThan(
      1e-8
    );
    // 2k−3: the first factor is −1, the others are positive.
    expect(partial((k) => 2 * k - 3, 1, 50)).toBeLessThan(-1e50);
  });

  test('a product that converges to a finite value is not changed', () => {
    expect(evaluate('\\prod_{k=1}^\\infty (1+\\frac{1}{k^2})')).toBe(
      'sinh(pi) / pi'
    );
    expect(evaluate('\\prod_{k=2}^\\infty (1-\\frac{1}{k^2})')).toBe('1/2');
  });

  // At k = 1 the factor is 10⁻¹³: within the rounding tolerance of the
  // machine root scan, but not a zero factor. The exact check rejects it,
  // and every factor is positive, so the product tends to +∞.
  test('a factor near zero that is not zero', () => {
    const e = ce.box([
      'Product',
      ['Subtract', 'k', ['Rational', 9999999999999, 10000000000000]],
      ['Limits', 'k', 1, 'PositiveInfinity'],
    ]);
    expect(e.evaluate().toString()).toBe('+oo');
    expect(e.N().toString()).toBe('+oo');
    expect(evaluate('\\prod_{k=1}^\\infty (k-3)')).toBe('0');
  });

  // The limit of the factors is −1/2: the magnitude of the partial products
  // tends to 0, whatever the sign of the factors.
  test('a negative limit of the factors with a magnitude below 1', () => {
    expect(evaluate('\\prod_{k=1}^\\infty \\left(-\\frac{k}{2k+1}\\right)')).toBe(
      '0'
    );
    expect(N('\\prod_{k=1}^\\infty \\left(-\\frac{k}{2k+1}\\right)')).toBe('0');
    expect(Math.abs(partial((k) => -k / (2 * k + 1), 1, 100))).toBeLessThan(
      1e-30
    );
  });

  test('a product whose factors alternate in sign stays unevaluated', () => {
    expect(evaluate('\\prod_{k=1}^\\infty (-k)')).toBe('prod_(k=1)^(+oo)(-k)');
  });
});

// The shifted-factorial rule of `simplify()`, `Π_{k=1}^n (k + c) =
// (n + c)!/c!`, does not hold for a negative integer `c`: the product has a
// zero factor only when `n ≥ −c`.
describe('Product of k + c with a negative integer c under simplify()', () => {
  test('a symbolic upper bound', () => {
    const e = ce.parse('\\prod_{k=1}^n (k-3)');
    expect(e.simplify().toString()).not.toBe('0');
  });
  test('an infinite upper bound is not Indeterminate', () => {
    const e = ce.parse('\\prod_{k=1}^\\infty (k-3)');
    expect(e.simplify().isNaN).not.toBe(true);
  });
});
