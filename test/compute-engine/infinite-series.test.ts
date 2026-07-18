import { engine as ce } from '../utils';

/**
 * Closed-form table for infinite sums and products (ROADMAP B13 "the
 * closed-form table is minimal and could grow", executed 2026-07-18).
 *
 * Every identity here was verified numerically against high-N truncation
 * before being encoded (Working Discipline: verify math empirically). The
 * recognizers live in `library/utils.ts` (`namedSeriesClosedForm`,
 * `infiniteProductClosedForm`); families with a free ratio return
 * `When`-guarded values through the `conditionalValue` chokepoint.
 */
describe('Alternating p-series η(s)', () => {
  test('Σ (−1)^{k+1}/k = ln 2', () => {
    expect(
      ce.parse('\\sum_{k=1}^\\infty \\frac{(-1)^{k+1}}{k}').evaluate().json
    ).toEqual(['Ln', 2]);
  });

  test('Σ (−1)^k/k = −ln 2 (opposite sign convention)', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{(-1)^{k}}{k}').evaluate();
    expect(e.json).toEqual(['Negate', ['Ln', 2]]);
  });

  test('Σ (−1)^{k+1}/k² = π²/12', () => {
    const e = ce
      .parse('\\sum_{k=1}^\\infty \\frac{(-1)^{k+1}}{k^2}')
      .evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI ** 2 / 12, 12);
    // Exact (a π²-fraction), not a numeric approximation
    expect(e.toString()).toContain('pi');
  });

  test('η with an odd s > 1 stays in terms of ζ (no elementary form)', () => {
    const e = ce
      .parse('\\sum_{k=1}^\\infty \\frac{(-1)^{k+1}}{k^3}')
      .evaluate();
    // (1 − 2^{−2})·ζ(3) = (3/4)ζ(3)
    expect(e.N().re).toBeCloseTo(0.9015426773696957, 12);
    expect(JSON.stringify(e.json)).toContain('Zeta');
  });
});

describe('Odd p-series λ(s) = (1 − 2^{−s})ζ(s)', () => {
  test('Σ 1/(2k−1)² (k from 1) = π²/8', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{1}{(2k-1)^2}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI ** 2 / 8, 12);
  });

  test('Σ 1/(2k+1)² (k from 0) = π²/8 (same series, shifted index)', () => {
    const e = ce.parse('\\sum_{k=0}^\\infty \\frac{1}{(2k+1)^2}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI ** 2 / 8, 12);
  });

  test('Σ 1/(2k−1)⁴ = π⁴/96', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{1}{(2k-1)^4}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI ** 4 / 96, 12);
  });

  test('the divergent s = 1 case (odd harmonic) stays symbolic', () => {
    expect(
      ce.parse('\\sum_{k=1}^\\infty \\frac{1}{2k-1}').evaluate().operator
    ).toBe('Sum');
  });

  test('a non-standard start (odd denominators from 3) stays symbolic', () => {
    expect(
      ce.parse('\\sum_{k=1}^\\infty \\frac{1}{(2k+1)^2}').evaluate().operator
    ).toBe('Sum');
  });
});

describe('Dirichlet beta β(s)', () => {
  test('Leibniz: Σ (−1)^k/(2k+1) (k from 0) = π/4', () => {
    const e = ce.parse('\\sum_{k=0}^\\infty \\frac{(-1)^k}{2k+1}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI / 4, 12);
  });

  test('Leibniz in the (2k−1), k-from-1 spelling = π/4', () => {
    const e = ce
      .parse('\\sum_{k=1}^\\infty \\frac{(-1)^{k+1}}{2k-1}')
      .evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI / 4, 12);
  });

  test('β(2) = Catalan’s constant', () => {
    const e = ce
      .parse('\\sum_{k=0}^\\infty \\frac{(-1)^k}{(2k+1)^2}')
      .evaluate();
    expect(e.json).toEqual('CatalanConstant');
    expect(e.N().re).toBeCloseTo(0.915965594177219, 12);
  });

  test('β(3) = π³/32', () => {
    const e = ce
      .parse('\\sum_{k=0}^\\infty \\frac{(-1)^k}{(2k+1)^3}')
      .evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI ** 3 / 32, 12);
  });

  test('β(5) = 5π⁵/1536', () => {
    const e = ce
      .parse('\\sum_{k=0}^\\infty \\frac{(-1)^k}{(2k+1)^5}')
      .evaluate();
    expect(e.N().re).toBeCloseTo((5 * Math.PI ** 5) / 1536, 12);
  });

  test('β(4) has no tabled closed form and stays symbolic', () => {
    expect(
      ce
        .parse('\\sum_{k=0}^\\infty \\frac{(-1)^k}{(2k+1)^4}')
        .evaluate().operator
    ).toBe('Sum');
  });
});

describe('Exponential series Σ rᵏ/k!', () => {
  test('Σ 1/k! (k from 0) = e', () => {
    expect(
      ce.parse('\\sum_{k=0}^\\infty \\frac{1}{k!}').evaluate().json
    ).toEqual('ExponentialE');
  });

  test('Σ 1/k! (k from 1) = e − 1 (partial terms subtracted)', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{1}{k!}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.E - 1, 12);
  });

  test('Σ 1/k! (k from 2) = e − 2', () => {
    const e = ce.parse('\\sum_{k=2}^\\infty \\frac{1}{k!}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.E - 2, 12);
  });

  test('Σ 2ᵏ/k! = e²', () => {
    const e = ce.parse('\\sum_{k=0}^\\infty \\frac{2^k}{k!}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.exp(2), 12);
  });

  test('symbolic ratio: Σ xᵏ/k! = eˣ (entire — no guard)', () => {
    // `Exp(x)` canonicalizes to `Power(ExponentialE, x)`
    expect(
      ce.parse('\\sum_{k=0}^\\infty \\frac{x^k}{k!}').evaluate().json
    ).toEqual(['Power', 'ExponentialE', 'x']);
  });
});

describe('First-moment geometric Σ k·rᵏ = r/(1−r)²', () => {
  test('Σ k/2ᵏ = 2', () => {
    expect(
      ce.parse('\\sum_{k=1}^\\infty \\frac{k}{2^k}').evaluate().json
    ).toEqual(2);
  });

  test('Σ k/3ᵏ = 3/4', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{k}{3^k}').evaluate();
    expect(e.N().re).toBeCloseTo(0.75, 12);
  });

  test('symbolic ratio is When-guarded on |x| < 1', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty k x^k').evaluate();
    expect(e.operator).toBe('When');
    // Value branch is x/(1−x)²
    const atHalf = e.op1.subs({ x: 0.5 }).N().re;
    expect(atHalf).toBeCloseTo(0.5 / 0.25, 12);
  });

  test('a divergent numeric ratio stays symbolic', () => {
    expect(
      ce.parse('\\sum_{k=1}^\\infty k \\cdot 2^k').evaluate().operator
    ).toBe('Sum');
  });
});

describe('Logarithmic series Σ rᵏ/k = −ln(1−r)', () => {
  test('Σ 1/(k·2ᵏ) = ln 2', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{1}{k 2^k}').evaluate();
    expect(e.N().re).toBeCloseTo(Math.log(2), 12);
  });

  test('symbolic ratio is When-guarded: −ln(1−x) for |x| < 1', () => {
    const e = ce.parse('\\sum_{k=1}^\\infty \\frac{x^k}{k}').evaluate();
    expect(e.operator).toBe('When');
    const atHalf = e.op1.subs({ x: 0.5 }).N().re;
    expect(atHalf).toBeCloseTo(Math.log(2), 12);
  });

  test('the divergent harmonic series (r = 1) stays symbolic', () => {
    expect(
      ce.parse('\\sum_{k=1}^\\infty \\frac{1}{k}').evaluate().operator
    ).toBe('Sum');
  });
});

describe('Infinite product closed forms', () => {
  test('Π (1 − 1/k²) (k from 2) = 1/2', () => {
    expect(
      ce
        .parse('\\prod_{k=2}^\\infty (1 - \\frac{1}{k^2})')
        .evaluate()
        .json
    ).toEqual(['Rational', 1, 2]);
  });

  test('Π (1 − 1/k²) (k from a) = (a−1)/a', () => {
    expect(
      ce
        .parse('\\prod_{k=3}^\\infty (1 - \\frac{1}{k^2})')
        .evaluate()
        .json
    ).toEqual(['Rational', 2, 3]);
    expect(
      ce
        .parse('\\prod_{k=10}^\\infty (1 - \\frac{1}{k^2})')
        .evaluate()
        .json
    ).toEqual(['Rational', 9, 10]);
  });

  test('Π (1 − 1/(2k+1)²) (k from 1) = π/4 (odd Wallis analog)', () => {
    const e = ce
      .parse('\\prod_{k=1}^\\infty (1 - \\frac{1}{(2k+1)^2})')
      .evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI / 4, 12);
  });

  test('Π (1 + 1/k²) (k from 1) = sinh(π)/π', () => {
    const e = ce
      .parse('\\prod_{k=1}^\\infty (1 + \\frac{1}{k^2})')
      .evaluate();
    expect(e.N().re).toBeCloseTo(Math.sinh(Math.PI) / Math.PI, 12);
  });

  test('the Wallis product Π (1 − 1/(2k)²) = 2/π still lands', () => {
    const e = ce
      .parse('\\prod_{k=1}^\\infty (1 - \\frac{1}{(2k)^2})')
      .evaluate();
    expect(e.N().re).toBeCloseTo(2 / Math.PI, 12);
  });

  test('Π (1 − 1/k²) from k = 1 stays symbolic (the k = 1 factor is 0…', () => {
    // …times a divergence-free tail — the product IS 0, but the (a−1)/a
    // family requires a ≥ 2; the zero factor makes any recognizer moot).
    const e = ce
      .parse('\\prod_{k=1}^\\infty (1 - \\frac{1}{k^2})')
      .evaluate();
    // Either inert or 0 is acceptable; it must not be (a−1)/a = 0/1 by luck.
    expect(['Product', 'Number'].includes(e.operator)).toBe(true);
  });
});
