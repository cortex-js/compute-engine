import { engine as ce } from '../utils';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

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

  test('the divergent s = 1 case (odd harmonic) is +∞', () => {
    // No closed form in this family, but the divergence is certified by the
    // limit comparison with the harmonic series (see the divergence block
    // below).
    expect(
      ce
        .parse('\\sum_{k=1}^\\infty \\frac{1}{2k-1}')
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
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
      ce.parse('\\sum_{k=0}^\\infty \\frac{(-1)^k}{(2k+1)^4}').evaluate()
        .operator
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

  test('a divergent numeric ratio above 1 is +∞', () => {
    expect(
      ce
        .parse('\\sum_{k=1}^\\infty k \\cdot 2^k')
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
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

  test('the divergent harmonic series (r = 1) is +∞', () => {
    expect(
      ce
        .parse('\\sum_{k=1}^\\infty \\frac{1}{k}')
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
  });
});

describe('Respelled bodies reach the closed form (evaluate route)', () => {
  // The recognizers read one spelling of each body; an equivalent spelling
  // is normalized to it first (`normalizedSeriesBody`, `library/utils.ts`).
  test.each([
    ['\\sum_{k=1}^{\\infty} \\frac{k}{k^3}', Math.PI ** 2 / 6],
    ['\\sum_{k=1}^{\\infty} \\frac{1}{k\\cdot k}', Math.PI ** 2 / 6],
    ['\\sum_{k=1}^{\\infty} \\frac{1}{(k+1)^2}', Math.PI ** 2 / 6 - 1],
    ['\\sum_{k=1}^{\\infty} \\frac{1}{k^2+2k+1}', Math.PI ** 2 / 6 - 1],
    ['\\sum_{k=2}^{\\infty} \\frac{1}{(k-1)^2}', Math.PI ** 2 / 6],
    ['\\sum_{k=0}^{\\infty} \\frac{3^k}{6^k}', 2],
    ['\\sum_{k=0}^{\\infty} \\frac{2^k}{3^k}', 3],
    ['\\sum_{k=0}^{\\infty} \\frac{1}{2^{k+1}}', 1],
    ['\\sum_{k=0}^{\\infty} \\frac{5}{2^{k+2}}', 2.5],
    ['\\sum_{k=0}^{\\infty} \\frac{1}{\\Gamma(k+1)}', Math.E],
    ['\\sum_{k=0}^{\\infty} \\frac{1}{4k^2+4k+1}', Math.PI ** 2 / 8],
    ['\\sum_{k=1}^{\\infty} \\frac{1}{4k^2-4k+1}', Math.PI ** 2 / 8],
    ['\\sum_{k=0}^{\\infty} \\frac{(-1)^k}{4k^2+4k+1}', 0.915965594177219],
    ['\\sum_{k=1}^{\\infty} \\frac{(-1)^k k}{k^3}', -(Math.PI ** 2) / 12],
    ['\\sum_{k=1}^{\\infty} \\frac{1}{k(k+1)}', 1],
    ['\\sum_{k=1}^{\\infty} \\frac{1}{k^2+k}', 1],
    ['\\sum_{k=1}^{\\infty} (\\frac{1}{k} - \\frac{1}{k+1})', 1],
    ['\\sum_{k=3}^{\\infty} \\frac{1}{k(k+1)}', 1 / 3],
    ['\\sum_{k=2}^{\\infty} \\frac{1}{k(k-1)}', 1],
  ])('%s has a closed form', (input, expected) => {
    const e = ce.parse(input).evaluate();
    expect(e.operator).not.toBe('Sum');
    expect(e.N().re).toBeCloseTo(expected, 12);
  });

  test('the shifted exponential series keeps its free variable', () => {
    expect(
      ce.parse('\\sum_{k=0}^{\\infty} \\frac{x^k}{\\Gamma(k+1)}').evaluate()
        .json
    ).toEqual(['Power', 'ExponentialE', 'x']);
  });

  test('a divergent ratio spelled as a quotient of powers is +∞', () => {
    // No closed form; the divergence is certified (see the divergence
    // block below).
    expect(
      ce
        .parse('\\sum_{k=0}^{\\infty} \\frac{6^k}{3^k}')
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
  });

  test.each([
    // The telescoping identity needs k ≥ 2; at k = 1 the body is 1/0.
    '\\sum_{k=1}^{\\infty} \\frac{1}{k(k-1)}',
    // A pole inside the domain.
    '\\sum_{k=1}^{\\infty} \\frac{1}{(k-5)^2}',
    // A 0/0 factor inside the domain that a cancellation would hide.
    '\\sum_{k=1}^{\\infty} \\frac{k-5}{(k-5)k^2}',
    // No closed form in the table (and convergent, so no divergence either).
    '\\sum_{k=1}^{\\infty} \\frac{1}{k^2+1}',
  ])('%s stays symbolic', (input) => {
    expect(ce.parse(input).evaluate().operator).toBe('Sum');
  });

  test.each([
    ['\\sum_{k=1}^{\\infty} \\frac{1}{k^2+2.0k+1}', Math.PI ** 2 / 6 - 1],
    ['\\sum_{k=0}^{\\infty} \\frac{1}{4k^2+4.0k+1}', Math.PI ** 2 / 8],
  ])('a float literal survives the normalization: %s', (input, expected) => {
    const e = ce.parse(input).evaluate();
    expect(isNumber(e) && !e.isExact).toBe(true);
    expect(e.re).toBeCloseTo(expected, 12);
  });

  test('a denominator that only approximates a repeated factor is not rewritten', () => {
    // k² + 2k + 1 + 10⁻¹⁰ is not (k + 1)²; every term is smaller than the
    // shifted p-series would say.
    expect(
      ce
        .parse(
          '\\sum_{k=1}^{\\infty} \\frac{1}{k^2+2k+\\frac{10000000001}{10000000000}}'
        )
        .evaluate().operator
    ).toBe('Sum');
  });

  test('a finite telescoping product with an impure body is not sampled', () => {
    let calls = 0;
    ce.declare('impureFactor', {
      signature: '(integer) -> number',
      pure: false,
      evaluate: () => {
        calls += 1;
        return ce.number(1);
      },
    });
    const e = ce
      .parse('\\prod_{k=1}^{n} \\frac{k + \\operatorname{impureFactor}(k)}{k}')
      .evaluate();
    expect(e.operator).toBe('Product');
    expect(calls).toBe(0);
  });

  test('a float literal in a telescoping body gives a float', () => {
    const e = ce.parse('\\sum_{k=1}^{\\infty} \\frac{1.0}{k(k+1)}').evaluate();
    expect(isNumber(e) && !e.isExact).toBe(true);
    expect(e.re).toBeCloseTo(1, 12);
  });

  test.each([
    ['\\prod_{k=1}^{n} \\frac{k^2+k}{k^2}', ['Add', 'n', 1]],
    ['\\prod_{k=1}^{n} (1+\\frac{1}{k})', ['Add', 'n', 1]],
    ['\\prod_{k=1}^{n} \\frac{k}{k+1}', ['Divide', 1, ['Add', 'n', 1]]],
    ['\\prod_{k=1}^{n} \\frac{(k+1)^2}{k^2}', ['Power', ['Add', 'n', 1], 2]],
  ])('finite telescoping product %s', (input, expected) => {
    expect(ce.parse(input).evaluate().json).toEqual(expected);
  });

  test('a finite telescoping product with a 0/0 factor stays symbolic', () => {
    expect(
      ce.parse('\\prod_{k=1}^{n} \\frac{(k-3)(k+1)}{(k-3)k}').evaluate()
        .operator
    ).toBe('Product');
  });
});

/**
 * A series whose divergence to `+∞` or `−∞` is certified evaluates to that
 * infinity, under `evaluate()` and under `.N()`. The certificate is the limit
 * comparison with the harmonic series: `lim k·f(k)` is a number other than 0,
 * or an infinity (`divergentInfiniteSum`, `library/utils.ts`). A series with
 * no value (oscillating, or with a term that is a division by zero) and a
 * series whose divergence is not established stay symbolic: a truncated
 * partial sum is never returned (GitHub #326).
 */
describe('Divergent series (GitHub #326)', () => {
  const sum = (body: string, lower = 1) =>
    ce.parse(`\\sum_{n=${lower}}^\\infty ${body}`);
  const isPlusInfinity = (e: ReturnType<typeof ce.parse>) =>
    e.isSame(ce.PositiveInfinity);

  test.each([
    ['\\frac{1}{n}', 'the harmonic series'],
    ['n', 'a growing term'],
    ['1', 'a constant term'],
    ['\\frac{1}{\\sqrt{n}}', 'a p-series with p = 1/2'],
    ['\\frac{n+1}{n^2-3}', 'a rational function of degree −1'],
    ['\\frac{\\ln n}{n}', 'a logarithmic factor'],
    ['2^n', 'a geometric series with ratio 2'],
    ['\\frac{1}{n}+\\frac{1}{n^2}', 'a sum with one divergent piece'],
    ['\\frac{0.001}{n}', 'a small constant factor'],
  ])('Σ %s (%s) evaluates to +∞ and numericizes to +∞', (body) => {
    expect(isPlusInfinity(sum(body).evaluate())).toBe(true);
    expect(isPlusInfinity(sum(body).N())).toBe(true);
  });

  test('a negative divergent series is −∞', () => {
    expect(sum('\\frac{-3}{n}').evaluate().isSame(ce.NegativeInfinity)).toBe(
      true
    );
    expect(sum('\\frac{-3}{n}').N().isSame(ce.NegativeInfinity)).toBe(true);
  });

  test('a lower bound other than 1 is accepted', () => {
    expect(isPlusInfinity(sum('\\frac{1}{n}', 5).evaluate())).toBe(true);
  });

  test.each([
    ['(-1)^n', 1, 'an oscillating series has no value'],
    ['\\sin n', 1, 'a bounded oscillating term'],
    ['\\frac{1}{n-3}', 1, 'a division by zero at n = 3'],
    ['\\frac{1}{n}', 0, 'a division by zero at n = 0'],
    ['\\frac{1}{\\ln n}', 1, 'a division by zero at n = 1 (ln 1 = 0)'],
    ['\\frac{1}{n \\ln n}', 2, 'lim n·f(n) = 0: the test is inconclusive'],
    ['n!', 1, 'no symbolic limit for n·n!'],
  ])('Σ %s from %i stays symbolic (%s)', (body, lower) => {
    expect(sum(body, lower).evaluate().operator).toBe('Sum');
  });

  test('a convergent series is not touched', () => {
    expect(
      sum('\\frac{1}{n^2}').evaluate().isEqual(ce.parse('\\frac{\\pi^2}{6}'))
    ).toBe(true);
    expect(sum('\\frac{1}{n^2+1}').evaluate().operator).toBe('Sum');
    expect(sum('\\frac{1}{n^2+1}').N().re).toBeCloseTo(1.0766740474685907, 10);
  });

  test('.N() of a rational body with a far division by zero stays symbolic', () => {
    // The extrapolation walks at most 2¹⁵ terms and never sees the pole at
    // n = 10⁶; it used to return a finite number for a sum that is undefined.
    expect(sum('\\frac{1}{n^2-10^{12}}').N().operator).toBe('Sum');
    // The denominator is read under any numerator.
    expect(sum('\\frac{\\sqrt{n}}{n^2-10^{12}}').N().operator).toBe('Sum');
  });

  test('.N() of a sum that runs downward checks the poles below its bound', () => {
    const INF = { num: '-Infinity' };
    const value = (expr: unknown) => ce.box(expr as never).N();
    // No pole at or below the bound: the value is ζ(2).
    expect(
      value(['Sum', ['Divide', 1, ['Power', 'k', 2]], ['Limits', 'k', INF, -1]])
        .re
    ).toBeCloseTo(Math.PI ** 2 / 6, 9);
    expect(
      value([
        'Sum',
        ['Divide', 1, ['Power', ['Subtract', 'k', 1], 2]],
        ['Limits', 'k', INF, 0],
      ]).re
    ).toBeCloseTo(Math.PI ** 2 / 6, 9);
    // A pole at k = −3, inside the domain.
    expect(
      value([
        'Sum',
        ['Divide', 1, ['Power', ['Add', 'k', 3], 2]],
        ['Limits', 'k', INF, -1],
      ]).operator
    ).toBe('Sum');
  });

  test('a denominator with coefficients of one sign needs no root scan', () => {
    // The Cauchy root bound of these denominators is beyond the scan limit;
    // the one-sign rule of `hasIntegerRootFrom` proves the absence of a root
    // instead, so neither the certificate nor the extrapolation declines.
    expect(
      sum('\\frac{n^4}{n^5+10^{8}}').evaluate().isSame(ce.PositiveInfinity)
    ).toBe(true);
    expect(sum('\\frac{1}{n^2+10^{13}}').N().re).toBeCloseTo(4e-13, 20);
  });

  // The certificate needs a structural proof that every term is a finite
  // real number (`termsDefinedFrom`, `library/utils.ts`). A sampled
  // prefilter and a symbolic limit can both miss a division by zero far
  // down the series, or a complex term near its start: each of these was
  // certified before the proof was required.
  test.each([
    ['\\frac{1}{(\\ln k - \\ln 500)^2}', 1, 'a 1/0 term at k = 500'],
    ['\\frac{\\sqrt{k}}{k-500}', 1, 'a polynomial denominator under a root'],
    ['\\frac{\\ln k}{k-500}', 1, 'a polynomial denominator under a logarithm'],
    ['\\frac{1}{\\sqrt{k}-50}', 1, 'a 1/0 term at k = 2500'],
    ['\\frac{k}{\\sqrt{k}-50}', 10, 'the same denominator, growing numerator'],
    ['\\frac{1}{\\ln k - \\ln 1000}', 1, 'a 1/0 term at k = 1000'],
    ['\\sqrt{k-3}', 1, 'complex terms at k = 1 and 2'],
  ])('Σ %s from %i is not certified (%s)', (body, lower) => {
    const e = ce.parse(`\\sum_{k=${lower}}^\\infty ${body}`);
    expect(e.evaluate().operator).toBe('Sum');
    expect(e.N().operator).toBe('Sum');
  });

  test('an impure body is never sampled', () => {
    const e = ce.box([
      'Sum',
      ['Add', 'k', ['Random']],
      ['Limits', 'k', 1, { num: '+Infinity' }],
    ]);
    expect(e.evaluate().operator).toBe('Sum');
  });

  test('a body the definedness proof does not cover is not certified', () => {
    // `Σ 1/(ln n + 1)` from 2 diverges (`1/(ln n + 1) > 1/n`), but the
    // proof has no rule for a sum with a logarithm below the line, so it
    // declines.
    expect(
      ce.parse('\\sum_{n=2}^\\infty \\frac{1}{\\ln n + 1}').evaluate().operator
    ).toBe('Sum');
    // `ln n` under a root is covered (`ln n ≥ ln 2 > 0` for `n ≥ 2`):
    // `Σ 1/√(ln n)` is certified.
    expect(
      ce
        .parse('\\sum_{n=2}^\\infty \\frac{1}{\\sqrt{\\ln n}}')
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
    // `n/(n ln n)` canonicalizes to `1/ln n`, which the logarithm rule
    // covers (`ln n ≥ ln 2` for `n ≥ 2`): certified.
    expect(
      ce
        .parse('\\sum_{n=2}^\\infty \\frac{n}{n \\ln n}')
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
  });

  test('isEqual against an infinity reads the certified divergence', () => {
    const harmonic = sum('\\frac{1}{n}');
    expect(harmonic.isEqual(ce.PositiveInfinity)).toBe(true);
    expect(harmonic.isEqual(ce.NegativeInfinity)).toBe(false);
    expect(harmonic.isEqual(5)).toBe(false);
    expect(harmonic.isEqual(ce.parse('9.787706026045382'))).toBe(false);
  });
});

describe('Infinite product closed forms', () => {
  test('Π (1 − 1/k²) (k from 2) = 1/2', () => {
    expect(
      ce.parse('\\prod_{k=2}^\\infty (1 - \\frac{1}{k^2})').evaluate().json
    ).toEqual(['Rational', 1, 2]);
  });

  test('Π (1 − 1/k²) (k from a) = (a−1)/a', () => {
    expect(
      ce.parse('\\prod_{k=3}^\\infty (1 - \\frac{1}{k^2})').evaluate().json
    ).toEqual(['Rational', 2, 3]);
    expect(
      ce.parse('\\prod_{k=10}^\\infty (1 - \\frac{1}{k^2})').evaluate().json
    ).toEqual(['Rational', 9, 10]);
  });

  test('Π (1 − 1/(2k+1)²) (k from 1) = π/4 (odd Wallis analog)', () => {
    const e = ce
      .parse('\\prod_{k=1}^\\infty (1 - \\frac{1}{(2k+1)^2})')
      .evaluate();
    expect(e.N().re).toBeCloseTo(Math.PI / 4, 12);
  });

  test('Π (1 + 1/k²) (k from 1) = sinh(π)/π', () => {
    const e = ce.parse('\\prod_{k=1}^\\infty (1 + \\frac{1}{k^2})').evaluate();
    expect(e.N().re).toBeCloseTo(Math.sinh(Math.PI) / Math.PI, 12);
  });

  test('the Wallis product Π (1 − 1/(2k)²) = 2/π still lands', () => {
    const e = ce
      .parse('\\prod_{k=1}^\\infty (1 - \\frac{1}{(2k)^2})')
      .evaluate();
    expect(e.N().re).toBeCloseTo(2 / Math.PI, 12);
  });

  // GitHub issue #323: the Wallis product written as a fraction, and as the
  // reciprocal `4n²/(4n² − 1)`, must land too. The recognizer compares the
  // body with each pattern algebraically, so every spelling of the same
  // rational function of the index is one body.
  describe('spellings of a known body (GitHub #323)', () => {
    test('2 Π 4n²/(4n² − 1) = π (the issue as reported)', () => {
      const e = ce.parse('2\\prod_{n=1}^{\\infty} \\frac{4n^2}{4n^2-1}');
      expect(e.evaluate().json).toEqual('Pi');
    });

    test('evaluateAsync lands the same closed form', async () => {
      const e = ce.parse('2\\prod_{n=1}^{\\infty} \\frac{4n^2}{4n^2-1}');
      expect((await e.evaluateAsync()).json).toEqual('Pi');
    });

    test('Π 4n²/(4n² − 1) = π/2 (reciprocal of the Wallis body)', () => {
      const e = ce
        .parse('\\prod_{n=1}^{\\infty} \\frac{4n^2}{4n^2-1}')
        .evaluate();
      expect(e.operator).not.toBe('Product');
      expect(e.N().re).toBeCloseTo(Math.PI / 2, 12);
    });

    test.each([
      ['\\frac{4k^2-1}{4k^2}', 2 / Math.PI],
      ['(1 - \\frac{1}{4k^2})', 2 / Math.PI],
      ['\\frac{(2k+1)^2}{(2k+1)^2-1}', 4 / Math.PI],
      ['\\frac{4k^2+4k}{4k^2+4k+1}', Math.PI / 4],
      ['\\frac{k^2}{k^2+1}', Math.PI / Math.sinh(Math.PI)],
    ])('Π %s (k from 1) is recognized', (body, expected) => {
      const e = ce.parse(`\\prod_{k=1}^{\\infty} ${body}`).evaluate();
      expect(e.operator).not.toBe('Product');
      expect(e.N().re).toBeCloseTo(expected, 12);
    });

    test('Π k²/(k² − 1) (k from a) = a/(a − 1)', () => {
      expect(
        ce.parse('\\prod_{k=2}^{\\infty} \\frac{k^2}{k^2-1}').evaluate().json
      ).toEqual(2);
      expect(
        ce.parse('\\prod_{k=3}^{\\infty} \\frac{k^2}{k^2-1}').evaluate().json
      ).toEqual(['Rational', 3, 2]);
    });

    test('a common factor that hides a 0/0 factor declines', () => {
      // (k − 5)(k² − 1) / ((k − 5)k²) is the telescoping body with a hole
      // at k = 5: the finite product over k = 2…10 is Indeterminate, so the
      // infinite product must not be (a − 1)/a. The same with the factor
      // expanded away: (4k³ − 16k² − k + 4)/(4k³ − 16k²) = (4k² − 1)(k − 4)
      // / (4k²(k − 4)) is the Wallis body with a hole at k = 4.
      expect(
        ce
          .parse('\\prod_{k=2}^{\\infty} \\frac{(k-5)(k^2-1)}{(k-5)k^2}')
          .evaluate().operator
      ).toBe('Product');
      expect(
        ce
          .parse('\\prod_{k=1}^{\\infty} \\frac{4k^3-16k^2-k+4}{4k^3-16k^2}')
          .evaluate().operator
      ).toBe('Product');
    });

    test('a float literal in the body gives a float', () => {
      const e = ce
        .parse('\\prod_{k=1}^{\\infty} (1 - \\frac{0.25}{k^2})')
        .evaluate();
      expect(isNumber(e) && !e.isExact).toBe(true);
      expect(e.re).toBeCloseTo(2 / Math.PI, 12);
    });

    test('an impure body is not sampled and stays symbolic', () => {
      let calls = 0;
      ce.declare('impureTerm', {
        signature: '(integer) -> number',
        pure: false,
        evaluate: () => {
          calls += 1;
          return ce.number(1);
        },
      });
      const e = ce
        .parse(
          '\\prod_{k=1}^{\\infty} (1 - \\frac{1}{4k^2} + \\operatorname{impureTerm}(k) - 1)'
        )
        .evaluate();
      expect(e.operator).toBe('Product');
      expect(calls).toBe(0);
    });

    test('a body that matches no pattern stays symbolic', () => {
      // Same shape as the Wallis body, different constant: not in the table.
      expect(
        ce.parse('\\prod_{k=1}^{\\infty} \\frac{4k^2}{4k^2+1}').evaluate()
          .operator
      ).toBe('Product');
      // The Wallis identity holds from k = 1 only; a tail is a different
      // product.
      expect(
        ce.parse('\\prod_{k=2}^{\\infty} \\frac{4k^2}{4k^2-1}').evaluate()
          .operator
      ).toBe('Product');
    });
  });

  test('Π (1 − 1/k²) from k = 1 stays symbolic (the k = 1 factor is 0…', () => {
    // …times a divergence-free tail — the product IS 0, but the (a−1)/a
    // family requires a ≥ 2; the zero factor makes any recognizer moot).
    const e = ce.parse('\\prod_{k=1}^\\infty (1 - \\frac{1}{k^2})').evaluate();
    // Either inert or 0 is acceptable; it must not be (a−1)/a = 0/1 by luck.
    expect(['Product', 'Number'].includes(e.operator)).toBe(true);
  });
});
