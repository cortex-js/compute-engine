import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

// Tycho ledger row 427: a compiled numerical integral whose integrand has a
// singularity that is not integrable at a point INSIDE the interval took 200
// to 400 ms and answered an arbitrary finite number.
//
// The integral is the absolute moment of order `x` of the normal
// distribution, `∫₋₅₀⁵⁰ |t|^x·φ(t) dt` (Desmos document `neyret/qkyuqi84gq`).
// For `x > −1` it is finite (1 at `x = 2`, 0.8221790 at `x = 0.5`). For
// `x ≤ −1` it diverges at `t = 0`. The interpreter answers `+∞`: it proves
// the pole from the expression, with the value of `x` (`interiorPoleVerdict`,
// `symbolic/interior-pole.ts`). The compiled function receives `x` only at
// run time, so it depends on the quadrature alone.
//
// Cause: the adaptive Gauss–Kronrod quadrature (`adaptiveQuadrature`,
// `numerics/gauss-kronrod.ts`) analyzes a singularity only at the two
// endpoints of the interval (the shells of the corner panels). At a
// singularity inside the interval it bisected the panels next to the point
// until its budget ran out, and reported a result that did not converge and
// was not divergent. The compiled `_SYS.integrate` then used its Monte-Carlo
// fallback (1e7 samples, a different value at each call: 647, 708, 7249 at
// `x = −1.5`), or kept a large finite estimate (`8.9e16` for
// `∫₋₁² (t − 0.3)⁻² dt`).
//
// Fix: when the adaptive loop bisected a panel far from both endpoints 40
// times or more, or to within 4096 spacings of the doubles at its position,
// the quadrature finds the point where `|f|` is largest near that panel and
// splits the interval there. The singularity is then at
// an endpoint of each half, where the endpoint analysis diagnoses a
// divergence. Smooth integrands are not affected: a kink, a jump, a
// logarithmic singularity and a peak of width `1e-6` are bisected at most 32
// times, and do not cause a split.

const MOMENT =
  '\\int_{-50}^{50}\\left|t\\right|^{x}\\frac{1}{\\sqrt{2\\pi}}e^{-\\frac{1}{2}t^2}dt';

const phi = (t: number) => Math.exp(-(t * t) / 2) / Math.sqrt(2 * Math.PI);

describe('TYCHO ROW 427: A COMPILED INTEGRAL WITH A SINGULARITY INSIDE THE INTERVAL', () => {
  const ce = new ComputeEngine();
  const expr = ce.parse(MOMENT);
  const fn = compile(expr, { to: 'javascript' }) as unknown as {
    success: boolean;
    run: (v: Record<string, number>) => number;
  };

  test('the integral compiles', () => {
    expect(fn.success).toBe(true);
  });

  // The Monte-Carlo fallback always gives a finite mean (and took 200 ms or
  // more), so a value that is not finite shows that the fallback did not run.
  test.each([-1, -1.5, -2.5])(
    'a divergent moment (x = %d) is not finite',
    (x) => {
      expect(Number.isFinite(fn.run({ x }))).toBe(false);
    }
  );

  // The exact moment is `2^(x/2)·Γ((x + 1)/2)/√π` (the tail past ±50 is
  // below the double precision). At `x = −0.9` the quadrature gave
  // `8.041358421398` before the split (an error of `5.7e-10`), and gives
  // `8.041358421969` now.
  test.each([
    [2, 1],
    [0.5, 0.822178958662459],
    [-0.5, 1.720079974649039],
    [-0.9, 8.041358421965985],
  ])('a finite moment (x = %d) keeps its value', (x, expected) => {
    expect(fn.run({ x })).toBeCloseTo(expected, 9);
  });

  test('the interpreter still answers +∞ for a divergent moment', () => {
    expect(expr.subs({ x: -1.5 }).N().toString()).toBe('+oo');
  });

  test('a pole whose location is an input is not finite', () => {
    const pole = compile(ce.parse('\\int_{-1}^{2}\\frac{1}{(t-x)^2}dt'), {
      to: 'javascript',
    }) as unknown as { run: (v: Record<string, number>) => number };
    // Before the fix: `8.9e16`.
    expect(Number.isFinite(pole.run({ x: 0.3 }))).toBe(false);
  });
});

describe('TYCHO ROW 427: THE QUADRATURE SPLITS AT A SINGULARITY INSIDE THE INTERVAL', () => {
  test.each([
    [
      '|t|^(−1.5)·φ(t) on [−50, 50]',
      (t: number) => Math.abs(t) ** -1.5 * phi(t),
      -50,
      50,
    ],
    [
      '|t|^(−1)·φ(t) on [−50, 50]',
      (t: number) => Math.abs(t) ** -1 * phi(t),
      -50,
      50,
    ],
    ['(t − 0.3)^(−2) on [−1, 2]', (t: number) => (t - 0.3) ** -2, -1, 2],
    [
      '|t − 0.3|^(−1.5) on [−1, 2]',
      (t: number) => Math.abs(t - 0.3) ** -1.5,
      -1,
      2,
    ],
    // No value: the integrand changes sign across the pole.
    ['1/(t − 1/3) on [−1, 2]', (t: number) => 1 / (t - 1 / 3), -1, 2],
    // Two poles: the first half is split again.
    [
      '1/((t − 0.3)²·(t − 1.2)²) on [−1, 2]',
      (t: number) => 1 / ((t - 0.3) ** 2 * (t - 1.2) ** 2),
      -1,
      2,
    ],
    // Far from 0, the spacing of the doubles stops the bisection after
    // about 31 steps (see `INTERIOR_SITE_ULPS`).
    [
      '(t − 1000000.3)^(−2) on [999999, 1000002]',
      (t: number) => (t - 1000000.3) ** -2,
      999999,
      1000002,
    ],
  ])('%s is divergent', (_name, f, a, b) => {
    const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
    expect(r.divergent).toBe(true);
  });

  test.each([
    // 2·√1.3 + 2·√1.7
    [
      '|t − 0.3|^(−1/2) on [−1, 2]',
      (t: number) => Math.abs(t - 0.3) ** -0.5,
      -1,
      2,
      2 * Math.sqrt(1.3) + 2 * Math.sqrt(1.7),
    ],
    // (4/3)·ln(4/3) + (5/3)·ln(5/3) − 3
    [
      'ln|t − 1/3| on [−1, 2]',
      (t: number) => Math.log(Math.abs(t - 1 / 3)),
      -1,
      2,
      (4 / 3) * Math.log(4 / 3) + (5 / 3) * Math.log(5 / 3) - 3,
    ],
    // ⌊t⌋ on [0, 3.3]: 0 + 1 + 2 + 3·0.3
    ['⌊t⌋ on [0, 3.3]', (t: number) => Math.floor(t), 0, 3.3, 3.9],
    // A peak of width 1e-3: √π·1e-3
    [
      'a narrow peak on [−1, 2]',
      (t: number) => Math.exp(-(((t - 0.3) / 1e-3) ** 2)),
      -1,
      2,
      Math.sqrt(Math.PI) * 1e-3,
    ],
  ])('%s keeps its value', (_name, f, a, b, expected) => {
    const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
    expect(r.divergent).toBe(false);
    expect(Math.abs(r.estimate - expected)).toBeLessThan(
      1e-7 * Math.max(1, Math.abs(expected))
    );
  });

  test('an integrand with no real value on a part of the interval is still a region with no value', () => {
    const r = adaptiveQuadrature((t) => Math.sqrt(t - 0.3), -1, 2, {
      singularEndpoints: true,
    });
    expect(r.nanRegion).toBe(true);
    expect(r.estimate).toBeNaN();
  });
});
