import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

// Tycho ledger row 422: a numerical integral whose integrand has no real
// value on a part of the interval took 0.5 to 2 s to answer `NaN`.
//
// The integral is the tail of the chi-square distribution with `k = 1`:
// `∫_x^∞ y^(k/2 − 1)·e^(−y/2) / (2^(k/2)·Γ(k/2)) dy`. For `x > 0` it is
// computed in a few milliseconds (`0.3173105` at `x = 1`). For `x < 0`, the
// compiled real code of `y^(−1/2)` is `NaN` for every `y` in `[x, 0)`.
//
// Cause: the adaptive Gauss–Kronrod loop (`adaptiveFinite`,
// `numerics/gauss-kronrod.ts`) skips a panel with a `NaN` value in its
// totals and bisects it again. Inside a set where the integrand is `NaN`,
// each bisection gives two `NaN` panels, so the loop used all of its panel
// budget (more than 30,000 evaluations). The result did not converge, and
// the caller then sampled the integrand 1e7 times for the Monte-Carlo
// fallback, which gave `NaN` again. That was the time on both routes: the
// interpreter (`integrateRealPart`, `library/calculus.ts`) and the compiled
// `_SYS.integrate` (`compilation/javascript-runtime.ts`).
//
// Fix: when a bisected panel and its two children each have a majority of
// `NaN` samples (8 of 15), the loop finds the boundary of the `NaN` set by
// bisection and reads the integrand at `2⁻²⁰` of the interval (and 2, 4, 8
// times that) from it. When those values are not of rounding size, the loop
// stops and the result is `NaN` with the flag `nanRegion`, and the callers
// return `NaN` without the Monte-Carlo fallback. Not affected:
// - a `NaN` at isolated points (removable singularities), even when the
//   points are at the centers of a parent and of both children;
// - an infinite sample (an integrable singularity);
// - a `NaN` set whose boundary is next to values of rounding size, or whose
//   boundary is not found inside the interval. An integrand that decreases to
//   0 can be `NaN` in its tail because its terms overflow (`sinh x/cosh² x`
//   is `∞/∞` for `x > 710`), and the integral has a value. The values cannot
//   tell such a tail from a `NaN` set next to a zero of high order (the
//   chi-square integrand with `k = 43` is `y^20.5·…`, `NaN` for `y < 0`), so
//   the loop continues as before the fix, and the caller decides (Monte
//   Carlo). This decision is kept per panel: another `NaN` set is examined
//   on its own.
//
// The same change made the rule that stops a loop whose panels are all bad
// ask for a majority of non-finite samples in the two children: with
// `u = x − ⌊x⌋`, `u/u` on `[0, 64]` is `0/0` at the center of each starting
// panel and of each of their children, and the quadrature gave `NaN`.

const CHI_SQUARE_TAIL =
  '\\int_{x}^{\\infty}\\frac{y^{\\frac{k}{2}-1}e^{-\\frac{y}{2}}}{2^{\\frac{k}{2}}\\Gamma(\\frac{k}{2})}dy';

// Before the fix, each `NaN` value took 450 ms or more on an idle machine.
// After the fix, it takes about 10 ms. The limit leaves a large margin for a
// loaded machine.
const MAX_MS = 250;

function timed<T>(f: () => T): [T, number] {
  const start = performance.now();
  const value = f();
  return [value, performance.now() - start];
}

describe('TYCHO ROW 422: AN INTEGRAND THAT IS NaN ON A PART OF THE INTERVAL', () => {
  const ce = new ComputeEngine();
  ce.assign('k', 1);
  const compiled = compile(ce.parse(CHI_SQUARE_TAIL), {
    to: 'javascript',
  }) as unknown as {
    success: boolean;
    run: (v: Record<string, number>) => unknown;
  };

  const interpreted = (x: number): number =>
    ce.parse(CHI_SQUARE_TAIL.replace('_{x}', `_{${x}}`)).N().re;

  test('the integral compiles', () => {
    expect(compiled.success).toBe(true);
  });

  test('x = 1 keeps its value on both routes', () => {
    // erfc(1/√2) = 0.31731050786291410…
    expect(interpreted(1)).toBeCloseTo(0.3173105078629141, 8);
    expect(Number(compiled.run({ x: 1 }))).toBeCloseTo(0.3173105078629141, 8);
  });

  // The interpreter compiles the integrand with the value of `k` in its
  // exponent (`y^{-1/2}`, user decision 2026-10-23, ROADMAP CE-213), so the
  // integrand has its principal complex value for `y < 0`, and the integral
  // is the complex value of the integral written with the number `-1/2`.
  // For `y = −t < 0`, `y^(−1/2) = −i·t^(−1/2)`, so the part on `[x, 0]` is
  // imaginary: the real part is the integral over `[0, ∞)`, exactly 1, and
  // the imaginary part is `−(2π)^(−1/2)·∫₀^|x| t^(−1/2)·e^(t/2) dt`, from
  // the series `Σ (1/2)ⁿ/n! · |x|^(n+1/2)/(n + 1/2)`. (The values pinned
  // before were the quadrature's own, wrong by about 1.6e-8: the integrand
  // jumps at `y = 0`, and a jump between the endpoint of a panel and its
  // nearest node was not seen; see `hiddenEdgeError`,
  // `numerics/gauss-kronrod.ts`.)
  test.each([
    [-0.2, 1, -0.3690844725957565],
    [-1, 1, -0.9534382692512609],
  ])('x = %p is complex, interpreted', (x, re, im) => {
    // No time limit: this integral has a value, and the quadrature of its
    // integrable singularity at 0 takes the usual time.
    const value = ce.parse(CHI_SQUARE_TAIL.replace('_{x}', `_{${x}}`)).N();
    expect(value.re).toBeCloseTo(re, 8);
    expect(value.im).toBeCloseTo(im, 8);
  });

  test.each([-0.2, -1])('x = %p is NaN at once, compiled', (x) => {
    const [value, ms] = timed(() => Number(compiled.run({ x })));
    expect(value).toBeNaN();
    expect(ms).toBeLessThan(MAX_MS);
  });

  test('the compiled real kernel reads a complex sample as NaN and stops at once', () => {
    // With the number `-1/2` as the exponent, the compiled integrand returns
    // the principal complex value for `y < 0`, and `_SYS.integrate` is real
    // only: it reads such a sample as `NaN`.
    const out = compile(
      ce.parse(
        '\\int_{x}^{\\infty}\\frac{y^{-\\frac{1}{2}}e^{-\\frac{y}{2}}}{2^{\\frac{1}{2}}\\Gamma(\\frac{1}{2})}dy'
      ),
      { to: 'javascript' }
    ) as unknown as {
      success: boolean;
      run: (v: Record<string, number>) => unknown;
    };
    expect(out.success).toBe(true);
    const [value, ms] = timed(() => Number(out.run({ x: -0.2 })));
    expect(value).toBeNaN();
    expect(ms).toBeLessThan(MAX_MS);
    expect(Number(out.run({ x: 1 }))).toBeCloseTo(0.3173105078629141, 8);
  });
});

describe('TYCHO ROW 422: THE ADAPTIVE QUADRATURE', () => {
  // A counted integrand: the number of evaluations does not depend on the
  // load of the machine.
  function counted(f: (x: number) => number): {
    f: (x: number) => number;
    count: () => number;
  } {
    let n = 0;
    return {
      f: (x) => {
        n += 1;
        return f(x);
      },
      count: () => n,
    };
  }
  const chi = (y: number) =>
    (Math.pow(y, -0.5) * Math.exp(-y / 2)) / Math.sqrt(2 * Math.PI);

  test.each([
    [-0.2, Number.POSITIVE_INFINITY],
    [-1, Number.POSITIVE_INFINITY],
    [-1, 1],
  ])(
    'NaN on [%p, 0): NaN with nanRegion, in a few hundred evaluations',
    (a, b) => {
      const { f, count } = counted(chi);
      const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
      expect(r.estimate).toBeNaN();
      expect(r.nanRegion).toBe(true);
      expect(r.converged).toBe(false);
      expect(r.divergent).toBe(false);
      // Before the fix: 32,340 evaluations on `[-0.2, ∞)`.
      expect(count()).toBeLessThan(1000);
    }
  );

  test('a half of (-∞, ∞) that is NaN everywhere gives NaN', () => {
    // The half `(−∞, 0]` is split off first, and the integrand is `NaN` on
    // all of it: no boundary of the `NaN` set is inside that half, so it is
    // not reported as a region with no value. The rule that stops a loop
    // whose panels are all bad gives `NaN`, as before the fix.
    const r = adaptiveQuadrature(
      chi,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      { singularEndpoints: true }
    );
    expect(r.estimate).toBeNaN();
    expect(r.converged).toBe(false);
  });

  test.each([
    [
      'the logistic density',
      (x: number) => Math.exp(x) / (1 + Math.exp(x)) ** 2,
    ],
    ['sinh x/cosh² x', (x: number) => Math.sinh(x) / Math.cosh(x) ** 2],
  ])(
    '%s on a wide finite interval is not a region with no value',
    (_name, f) => {
      // The terms overflow for `x > 709.8` (`∞/∞`). On `[0, 10000]`, the
      // starting panel `[0, 625]` holds the peak of the integrand next to 0
      // and the `NaN` set starts at 709.8, in the next panel: the values that
      // decide are read next to the boundary, not in the panel next to it.
      for (const b of [1e4, 1e6]) {
        const r = adaptiveQuadrature(f, 0, b, { singularEndpoints: true });
        expect(r.nanRegion).toBeUndefined();
      }
    }
  );

  test('two NaN sets are examined each on its own', () => {
    // On `[0, 0.5)` the integrand is `10⁻³⁰·√((x − 0.19)(x − 0.24))`, `NaN`
    // on `(0.19, 0.24)` next to values of rounding size: that set is not
    // reported. On `[0.5, 1]` it is `√((x − 0.75)(x − 0.8125))`, `NaN` on
    // `(0.75, 0.8125)` next to values that are not of rounding size: that set
    // is reported at once.
    const { f, count } = counted((x) =>
      x < 0.5
        ? 1e-30 * Math.sqrt((x - 0.19) * (x - 0.24))
        : Math.sqrt((x - 0.75) * (x - 0.8125))
    );
    const r = adaptiveQuadrature(f, 0, 1);
    expect(r.estimate).toBeNaN();
    expect(r.nanRegion).toBe(true);
    // Before the fix: 3,360 evaluations, and an estimate of 0.0603.
    expect(count()).toBeLessThan(1000);
  });

  test('an integrable singularity at an endpoint still integrates', () => {
    const r = adaptiveQuadrature((x) => 1 / Math.sqrt(x), 0, 1, {
      singularEndpoints: true,
    });
    expect(r.nanRegion).toBeUndefined();
    expect(r.estimate).toBeCloseTo(2, 10);
  });

  test('an infinite sample at a node is not a NaN sample', () => {
    // `1/32` is the center, and so a node, of the first of the 16 starting
    // panels on `[0, 1]`: the sample there is `+∞`.
    const c = 1 / 32;
    const r = adaptiveQuadrature((x) => 1 / Math.sqrt(Math.abs(x - c)), 0, 1, {
      singularEndpoints: true,
    });
    expect(r.nanRegion).toBeUndefined();
    // ∫₀¹ |x − c|^(−1/2) dx = 2√c + 2√(1 − c)
    expect(r.estimate).toBeCloseTo(2 * Math.sqrt(c) + 2 * Math.sqrt(1 - c), 6);
  });

  test('a NaN at isolated points (removable singularities) still integrates', () => {
    // `0/0` at x = ±1.
    const r1 = adaptiveQuadrature((x) => (x * x - 1) / (x * x - 1), -2, 2);
    expect(r1.nanRegion).toBeUndefined();
    expect(r1.estimate).toBeCloseTo(4, 10);
    // `0/0` at the center of each of the 16 starting panels on `[0, 16]`.
    const r2 = adaptiveQuadrature(
      (x) => {
        const u = x - Math.floor(x) - 0.5;
        return u / u;
      },
      0,
      16
    );
    expect(r2.nanRegion).toBeUndefined();
    expect(r2.estimate).toBeCloseTo(16, 10);
  });

  test('removable points at the centers of a parent and both children', () => {
    // `p(x)/p(x)` is `0/0` at 1/64, 1/32 and 3/64: 1/32 is the center of the
    // first starting panel on `[0, 1]`, and 1/64 and 3/64 are the centers of
    // its two children.
    const p = (x: number) => (x - 1 / 64) * (x - 1 / 32) * (x - 3 / 64);
    const r = adaptiveQuadrature((x) => p(x) / p(x), 0, 1);
    expect(r.nanRegion).toBeUndefined();
    expect(r.estimate).toBeCloseTo(1, 10);
  });

  test('a lattice of removable points at the centers of the panels', () => {
    // On `[0, 64]`, the 16 starting panels are 4 wide: their centers and
    // the centers of their children are integers.
    const u = (x: number) => x - Math.floor(x);
    const r1 = adaptiveQuadrature((x) => u(x) / u(x), 0, 64);
    expect(r1.nanRegion).toBeUndefined();
    expect(r1.estimate).toBeCloseTo(64, 10);
    // `v = x − round(x)`: ∫₀⁶⁴ sin(v)/v dx = 64·2·Si(1/2) = 63.1177495095…
    const v = (x: number) => x - Math.round(x);
    const r2 = adaptiveQuadrature((x) => Math.sin(v(x)) / v(x), 0, 64);
    expect(r2.nanRegion).toBeUndefined();
    expect(r2.estimate).toBeCloseTo(63.1177495095125, 9);
  });

  test('a tail where the terms of the integrand overflow is not a region with no value', () => {
    // `sinh x/cosh² x` and `eˣ/(1 + eˣ)²` are `∞/∞` for `x > 710`, where
    // their values are smaller than `10⁻³⁰⁰`. The panels that sample that
    // tail are bad (the result does not converge), but the estimate is the
    // integral.
    const r1 = adaptiveQuadrature(
      (x) => Math.sinh(x) / Math.cosh(x) ** 2,
      0,
      Number.POSITIVE_INFINITY
    );
    expect(r1.nanRegion).toBeUndefined();
    expect(r1.estimate).toBeCloseTo(1, 9);
    const logistic = (x: number) => Math.exp(x) / (1 + Math.exp(x)) ** 2;
    const r2 = adaptiveQuadrature(logistic, 0, Number.POSITIVE_INFINITY);
    expect(r2.nanRegion).toBeUndefined();
    expect(r2.estimate).toBeCloseTo(0.5, 9);
    // ∫₀¹⁰⁰⁰ = 1/(1 + e^(−1000)) − 1/2 = 0.5. The `NaN` set `(709.8, 1000]`
    // is not reported as a region with no value. The result does not
    // converge and its estimate is not accurate (0.5013): the bad panels are
    // bisected first, so the loop uses its panel budget in the `NaN` set and
    // does not refine the panels next to 0. This was also the result before
    // the `nanRegion` stop.
    const r3 = adaptiveQuadrature(logistic, 0, 1000);
    expect(r3.nanRegion).toBeUndefined();
    expect(r3.converged).toBe(false);
  });

  test('a NaN set next to a zero of high order is not reported as a region with no value', () => {
    // The chi-square integrand with `k = 43`, `y^20.5·e^(−y/2)` (without its
    // constant factor), is `NaN` for `y < 0` and less than `10⁻¹⁰⁰` for
    // `y` below `10⁻⁵`: the values next to the boundary of the `NaN` set are
    // of rounding size, as in an overflowing tail. Reading the `NaN` panels
    // as 0 would
    // give the integral on `[0, ∞)`, which is not the value on `[−0.2, ∞)`:
    // the result must not converge.
    const r = adaptiveQuadrature(
      (y) => Math.pow(y, 20.5) * Math.exp(-y / 2),
      -0.2,
      Number.POSITIVE_INFINITY,
      { singularEndpoints: true }
    );
    expect(r.nanRegion).toBeUndefined();
    expect(r.converged).toBe(false);
  });
});

describe('TYCHO ROW 422: THE REVIEW CASES ON BOTH ROUTES', () => {
  const ce = new ComputeEngine();

  test('interpreted: a tail where the terms overflow keeps its value', () => {
    // The quadrature does not converge, and the Monte-Carlo fallback gives
    // the value to about 1e-4.
    const v1 = ce.parse('\\int_0^\\infty \\frac{\\sinh x}{\\cosh^2 x}dx').N();
    expect(Math.abs(v1.re - 1)).toBeLessThan(2e-3);
    const v2 = ce.parse('\\int_0^\\infty \\frac{e^x}{(1+e^x)^2}dx').N();
    expect(Math.abs(v2.re - 0.5)).toBeLessThan(1e-3);
  });

  test('compiled, with a variable bound: a tail where the terms overflow keeps its value', () => {
    // Reference values: Simpson's rule on `[0, 40]` with 400,000 panels (the
    // tail past 40 is smaller than 1e-17).
    const out1 = compile(
      ce.parse('\\int_t^\\infty \\frac{\\sinh x}{\\cosh^2 x}\\cos^2 x\\,dx'),
      { to: 'javascript' }
    ) as unknown as {
      success: boolean;
      run: (v: Record<string, number>) => unknown;
    };
    expect(out1.success).toBe(true);
    expect(
      Math.abs(Number(out1.run({ t: 0 })) - 0.416912116400841)
    ).toBeLessThan(2e-3);
    const out2 = compile(
      ce.parse('\\int_t^\\infty \\frac{e^x\\cos^2 x}{(1+e^x)^2}dx'),
      { to: 'javascript' }
    ) as unknown as {
      success: boolean;
      run: (v: Record<string, number>) => unknown;
    };
    expect(out2.success).toBe(true);
    expect(
      Math.abs(Number(out2.run({ t: 0 })) - 0.255866764826239)
    ).toBeLessThan(2e-3);
  });

  test('interpreted: a lattice of removable points', () => {
    // ∫₀⁶⁴ sin(v)/v dx with `v = x − round(x)` is 64·2·Si(1/2).
    const v = ['Subtract', 'x', ['Round', 'x']];
    const r = ce
      .box(['NIntegrate', ['Function', ['Divide', ['Sin', v], v], 'x'], 0, 64])
      .N();
    expect(r.re).toBeCloseTo(63.1177495095125, 6);
  });

  test('compiled real route: √x on a part of the interval below 0 is NaN at once', () => {
    // `√x·e^(x²)` has no closed form here, so the compiled code runs
    // `_SYS.integrate`, which is real only: the complex samples for `x < 0`
    // are `NaN`, next to samples of `√x` that are not of rounding size.
    const out = compile(ce.parse('\\int_t^{1} \\sqrt{x}\\,e^{x^2} dx'), {
      to: 'javascript',
    }) as unknown as {
      success: boolean;
      run: (v: Record<string, number>) => unknown;
    };
    expect(out.success).toBe(true);
    const [value, ms] = timed(() => Number(out.run({ t: -1 })));
    expect(value).toBeNaN();
    expect(ms).toBeLessThan(MAX_MS);
    expect(Number(out.run({ t: 0 }))).toBeGreaterThan(1);
  });

  test('the chi-square tail with k = 43 at x = -0.2: complex interpreted, NaN compiled', () => {
    // The interpreter compiles the integrand with the exponent `41/2`
    // (ROADMAP CE-213), so its value for `y < 0` is complex, and the integral
    // is the one written with the number `41/2`. The compiled `_SYS.integrate`
    // is real only: there the integrand is `NaN` on a set next to a zero of
    // high order, the quadrature does not stop early, and the Monte-Carlo
    // fallback samples the `NaN` set. The answer is `NaN`, not the integral
    // on `[0, ∞)`.
    const ce43 = new ComputeEngine();
    ce43.assign('k', 43);
    const interpreted = ce43
      .parse(CHI_SQUARE_TAIL.replace('_{x}', '_{-0.2}'))
      .N();
    const literal = ce43
      .parse(
        '\\int_{-0.2}^{\\infty}\\frac{y^{\\frac{41}{2}}e^{-\\frac{y}{2}}}{2^{\\frac{43}{2}}\\Gamma(\\frac{43}{2})}dy'
      )
      .N();
    expect(interpreted.re).toBeCloseTo(literal.re, 10);
    expect(interpreted.im).toBeCloseTo(literal.im, 10);
    const out = compile(ce43.parse(CHI_SQUARE_TAIL), {
      to: 'javascript',
    }) as unknown as {
      success: boolean;
      run: (v: Record<string, number>) => unknown;
    };
    expect(out.success).toBe(true);
    expect(Number(out.run({ x: -0.2 }))).toBeNaN();
  });
});

describe('TYCHO ROW 422: AN INTEGRABLE SINGULARITY ON BOTH ROUTES', () => {
  const ce = new ComputeEngine();

  test('interpreted: NIntegrate of x^(-1/2) on [0, 1] is 2', () => {
    const v = ce
      .box([
        'NIntegrate',
        ['Function', ['Power', 'x', ['Rational', -1, 2]], 'x'],
        0,
        1,
      ])
      .N();
    expect(v.re).toBeCloseTo(2, 8);
  });

  test('compiled: the integral of cos(y)/√y from x to 1 at x = 0', () => {
    // The lower bound is a variable, so the compiled code runs
    // `_SYS.integrate` when it is called, not at compile time.
    const out = compile(
      ce.parse('\\int_{x}^{1} \\frac{\\cos y}{\\sqrt{y}} dy'),
      {
        to: 'javascript',
      }
    ) as unknown as {
      success: boolean;
      run: (v: Record<string, number>) => unknown;
    };
    expect(out.success).toBe(true);
    // ∫₀¹ cos(y)/√y dy = 2·∫₀¹ cos(u²) du = 1.80904847580054…
    expect(Number(out.run({ x: 0 }))).toBeCloseTo(1.8090484758005, 8);
  });
});

describe('row 422: the boundary search ends on an interval of subnormal width', () => {
  test('a NaN set on [0, 64 · MIN_VALUE] does not make the search loop', () => {
    // A sixteenth of such a panel rounds to 0, so a doubled step of 0 never
    // moved, and the search read the same NaN point without end.
    const r = adaptiveQuadrature(
      (x) => (x < 32 * Number.MIN_VALUE ? NaN : 1),
      0,
      64 * Number.MIN_VALUE
    );
    expect(r.converged).toBe(false);
  });
});
