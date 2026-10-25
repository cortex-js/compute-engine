/**
 * The `.N()` of an infinite sum or product is extrapolated from the partial
 * sums after 1, 2, 4, 8, … steps (`acceleratedInfiniteSum` and
 * `acceleratedInfiniteProduct` in `library/utils.ts`). Those samples all have
 * the same parity, so a series whose terms alternate without tending to 0
 * looked converged: `Σ_{k≥1} (−1)^k` gave −1, `Σ_{k≥0} (−1)^k` gave 1, and
 * `Π_{k≥1} 2^((−1)^k)` gave 0.5, although none of them has a limit. The
 * partial sums of the other parity must now agree, and such a series stays
 * unevaluated, as any series whose convergence is not established does.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const INF = { num: '+Infinity' };

describe('AN INFINITE SERIES WITH NO LIMIT STAYS UNEVALUATED UNDER N()', () => {
  test.each([
    ['(-1)^k from 1', ['Sum', ['Power', -1, 'k'], ['Limits', 'k', 1, INF]]],
    ['(-1)^k from 0', ['Sum', ['Power', -1, 'k'], ['Limits', 'k', 0, INF]]],
    [
      'cos(pi k)',
      ['Sum', ['Cos', ['Multiply', 'Pi', 'k']], ['Limits', 'k', 1, INF]],
    ],
    [
      '2^((-1)^k)',
      ['Product', ['Power', 2, ['Power', -1, 'k']], ['Limits', 'k', 1, INF]],
    ],
  ])('%s', (_, expr) => {
    const n = ce.box(expr as never).N();
    expect(n.operator).toBe((expr as string[])[0]);
  });
});

describe('A CONVERGENT INFINITE SERIES KEEPS ITS VALUE UNDER N()', () => {
  test.each([
    ['1/k^2', ['Divide', 1, ['Power', 'k', 2]], 'Sum', Math.PI ** 2 / 6],
    ['(-1)^k/k', ['Divide', ['Power', -1, 'k'], 'k'], 'Sum', -Math.log(2)],
    ['1/2^k', ['Power', 2, ['Negate', 'k']], 'Sum', 1],
    [
      '1 - 1/(4k^2)',
      ['Subtract', 1, ['Divide', 1, ['Multiply', 4, ['Power', 'k', 2]]]],
      'Product',
      2 / Math.PI,
    ],
  ])('%s', (_, body, head, expected) => {
    const n = ce.box([head, body, ['Limits', 'k', 1, INF]] as never).N();
    expect(n.re).toBeCloseTo(expected as number, 9);
  });
});

/**
 * The partial sums of `Σ 1/n^p` approach the limit as `N^(1−p)`, which is
 * not an integer power of `1/N` when `p` is not an integer, and those of
 * `Σ ln(n)/n²` as `ln(N)/N`. The integer-power extrapolation does not
 * converge on them; a fitted-exponent extrapolation
 * (`fittedExponentLimit` in `library/utils.ts`) does. A divergent series
 * must still stay unevaluated.
 */
describe('A CONVERGENT SERIES WITH A NON-INTEGER-POWER TAIL HAS A VALUE UNDER N()', () => {
  const zeta = (s: number) => ce.box(['Zeta', s]).N().re;

  test('Σ 1/n^1.5 = ζ(1.5)', () => {
    const n = ce.parse('\\sum_{n=1}^\\infty \\frac{1}{n^{1.5}}').N();
    expect(n.re).toBeCloseTo(zeta(1.5), 10);
    expect(n.re).toBeCloseTo(2.6123753486854883, 10);
  });

  test.each([
    ['\\sum_{n=1}^\\infty \\frac{1}{n^{2.5}}', () => zeta(2.5)],
    // −ζ′(2) = ζ(2)·(12·ln A − γ − ln 2π), A the Glaisher–Kinkelin constant
    ['\\sum_{n=1}^\\infty \\frac{\\ln(n)}{n^2}', () => 0.9375482543158438],
    // (−1)ⁿ/√n: the tail alternates, each parity decays as N^−0.5; −η(1/2)
    [
      '\\sum_{n=1}^\\infty \\frac{(-1)^n}{\\sqrt{n}}',
      () => (Math.SQRT2 - 1) * zeta(0.5),
    ],
  ])('%s', (latex, expected) => {
    expect(ce.parse(latex).N().re).toBeCloseTo(expected(), 10);
  });

  test('Π (1 + 1/k^1.5) = exp(Σ_m (−1)^(m+1) ζ(1.5m)/m)', () => {
    // ln 2 for k = 1, then Σ_{k≥2} ln(1 + k^−1.5) = Σ_m (−1)^(m+1) (ζ(1.5m) − 1)/m
    let log = Math.log(2);
    for (let m = 1; m <= 60; m++)
      log += ((m % 2 === 1 ? 1 : -1) * (zeta(1.5 * m) - 1)) / m;
    const n = ce
      .box([
        'Product',
        ['Add', 1, ['Power', 'k', -1.5]],
        ['Limits', 'k', 1, INF],
      ])
      .N();
    expect(n.re).toBeCloseTo(Math.exp(log), 9);
  });

  test.each([
    ['\\sum_{n=1}^\\infty \\frac{1}{n^2}', Math.PI ** 2 / 6],
    ['\\sum_{n=1}^\\infty \\frac{1}{n^3}', 1.2020569031595942],
    ['\\sum_{n=1}^\\infty \\frac{1}{n^4}', Math.PI ** 4 / 90],
    ['\\sum_{n=1}^\\infty \\frac{1}{2^n}', 1],
    ['\\sum_{n=1}^\\infty \\frac{1}{n!}', Math.E - 1],
    ['\\sum_{n=1}^\\infty e^{-n}', 1 / (Math.E - 1)],
    ['\\sum_{n=1}^\\infty \\frac{1}{n(n+1)}', 1],
    // (π·coth(π) − 1)/2
    [
      '\\sum_{n=1}^\\infty \\frac{1}{n^2+1}',
      (Math.PI / Math.tanh(Math.PI) - 1) / 2,
    ],
  ])('%s keeps its value', (latex, expected) => {
    expect(ce.parse(latex).N().re).toBeCloseTo(expected, 10);
  });

  // A divergent series whose divergence is certified by the limit
  // comparison with the harmonic series, or with `Σ 1/(n ln n)` when
  // `lim n·f(n) = 0` (`divergentInfiniteSum`, `library/utils.ts`), is `+∞`
  // under `.N()` as under `evaluate()`.
  test.each([
    '\\sum_{n=1}^\\infty \\frac{1}{n}',
    '\\sum_{n=1}^\\infty \\frac{1}{\\sqrt{n}}',
    '\\sum_{n=1}^\\infty n',
    '\\sum_{n=1}^\\infty \\frac{\\ln(n)}{n}',
    '\\sum_{n=2}^\\infty \\frac{\\ln(\\ln(n))}{n}',
    '\\sum_{n=2}^\\infty \\frac{1}{n\\ln(n)}',
  ])('the divergent %s is +∞', (latex) => {
    expect(ce.parse(latex).N().isSame(ce.PositiveInfinity)).toBe(true);
  });

  // A series with no value, and a divergent series the certificate does
  // not reach (`lim n·ln(n)·f(n) = 0`), stay unevaluated: never a truncated
  // partial sum.
  test.each([
    '\\sum_{n=1}^\\infty (-1)^n',
    '\\sum_{n=1}^\\infty (-1)^n\\sqrt{n}',
    '\\sum_{n=3}^\\infty \\frac{1}{n\\ln(n)\\ln(\\ln(n))}',
    // Oscillating partial sums: the exponent estimates are not finite.
    '\\sum_{n=1}^\\infty \\frac{\\sin(n)}{\\sqrt{n}} \\cdot n',
  ])('the divergent %s stays unevaluated', (latex) => {
    expect(ce.parse(latex).N().operator).toBe('Sum');
  });
});

/**
 * The walk of `acceleratedInfiniteSum()` (`library/utils.ts`) first runs with
 * the machine values of the compiled body. When that walk declines, the sum
 * declines; when it accepts a value above machine precision, the walk runs
 * again with the interpreter, and its value is the result (GitHub #326).
 */
describe('THE EXTRAPOLATION OF AN INFINITE SUM WITH A COMPILED BODY', () => {
  test('the value above machine precision has the digits of the interpreter', () => {
    // The compiled body computes `1 + 1/k²` in doubles and loses digits: its
    // walk gives 1.3018463986037174. The interpreter gives
    // 1.301846398603712. The value is ln(sinh(π)/π) = 1.30184639860371267….
    const v = ce.parse('\\sum_{k=1}^\\infty \\ln(1+\\frac{1}{k^2})').N().re;
    expect(Math.abs(v - 1.3018463986037127)).toBeLessThan(2e-15);
  });

  test('a second .N() of the same sum has the same value', () => {
    // The interpreter walk leaves the last index value assigned to the
    // index. The compiled body of the next walk must not read it as a
    // constant: it did, and the second `.N()` stayed a `Sum`.
    const fresh = new ComputeEngine();
    const sum = fresh.parse('\\sum_{k=1}^{\\infty} \\frac{1}{k^2+1}');
    expect(sum.N().re).toBeCloseTo(1.0766740474685907, 12);
    expect(sum.N().re).toBeCloseTo(1.0766740474685907, 12);
    fresh.precision = 40;
    expect(sum.N().re).toBeCloseTo(1.0766740474685907, 12);
  });

  test('a compiled term of 0 from an overflow comes from the interpreter', () => {
    // For 1004 ≤ k ≤ 1023, `k²(2^k + 1)` overflows in doubles while `2^k`
    // does not, and the compiled term is 0. With these terms the walk
    // declined a convergent series. The value is Σ 1/k² − Σ 1/(k²(2^k + 1)),
    // and the partial sum to k = 2000 is 1.2431794099…, about 1/2000 below.
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const v = machine
      .parse('\\sum_{k=1}^\\infty \\frac{2^k}{k^2 (2^k+1)}')
      .N().re;
    expect(v).toBeCloseTo(1.2436792849532812, 10);
  });

  test.each([
    '\\sum_{k=1}^\\infty \\frac{\\cos k}{k}',
    '\\sum_{n=2}^\\infty \\frac{1}{n (\\ln n)^2}',
    '\\sum_{n=3}^\\infty \\frac{1}{n \\ln(n) \\ln(\\ln(n))}',
  ])('%s declines without the interpreter walk', (latex) => {
    const started = Date.now();
    expect(ce.parse(latex).N().operator).toBe('Sum');
    // The interpreter walk of these bodies took 1 to 30 s; the compiled walk
    // takes milliseconds. The time depends on the load of the machine, so the
    // limit is asserted only in a `CE_PERF=1` run.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - started).toBeLessThan(500);
  });
});
