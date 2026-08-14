import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  adaptiveQuadrature,
  initialPanelsForDimensions,
  quadratureBeatsMonteCarlo,
} from '../../src/compute-engine/numerics/gauss-kronrod';

/** Compile a parsed LaTeX definite integral to a real-valued runner. */
function compileReal(latex: string, options?: { quadrature?: 'monte-carlo' }) {
  const r = compile(ce.parse(latex), { realOnly: true, ...options });
  expect(r.success).toBe(true);
  return r;
}

describe('COMPILE Integrate — adaptive Gauss–Kronrod', () => {
  describe('accuracy vs closed form', () => {
    // ∫_0^x 0.1·√(1+t²) dt = 0.05·(x·√(1+x²) + asinh(x))
    test.each([0.5, 2, 5])('arc-length integrand at x=%p', (x) => {
      const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
      const got = r.run({ x }) as number;
      const closed = 0.05 * (x * Math.sqrt(1 + x * x) + Math.asinh(x));
      expect(Math.abs(got - closed) / Math.abs(closed)).toBeLessThan(1e-8);
    });

    test('∫_0^π sin(t) dt = 2 (constant bounds)', () => {
      const r = compileReal('\\int_0^{\\pi} \\sin(t)\\,dt');
      expect(r.run({}) as number).toBeCloseTo(2, 8);
    });
  });

  test('determinism — successive calls are bit-identical (vs stochastic MC)', () => {
    const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
    const a = r.run({ x: 2 }) as number;
    const b = r.run({ x: 2 }) as number;
    expect(a).toBe(b); // ===, not just close
  });

  describe('infinite bounds via variable transform', () => {
    // Standard normal CDF Φ(x) = 1/√(2π) ∫_{-∞}^x e^{-t²/2} dt
    test('Gaussian CDF Φ(0) = 0.5', () => {
      const r = compileReal(
        '\\frac{1}{\\sqrt{2\\pi}}\\int_{-\\infty}^{x} e^{-t^2/2}\\,dt'
      );
      expect(r.run({ x: 0 }) as number).toBeCloseTo(0.5, 8);
    });

    test('Gaussian CDF Φ(1) ≈ 0.8413447460685429', () => {
      const r = compileReal(
        '\\frac{1}{\\sqrt{2\\pi}}\\int_{-\\infty}^{x} e^{-t^2/2}\\,dt'
      );
      expect(r.run({ x: 1 }) as number).toBeCloseTo(0.8413447460685429, 8);
    });

    test('χ²-type tail ∫_x^∞ y^{3/2} e^{-y/2} dy at x=2', () => {
      const r = compileReal('\\int_x^{\\infty} y^{3/2} e^{-y/2}\\,dy');
      // Reference value verified independently by a fine composite Simpson
      // rule on [2, 200] (tail beyond negligible): 6.385472870122. The
      // engine's interpreter (`.N()`) uses Monte-Carlo here and returns a
      // stochastic ~6.33 (error ~0.06 — far larger than a 1e-4 typical), so it
      // is unusable as a tight reference; compare against the trusted value.
      expect(r.run({ x: 2 }) as number).toBeCloseTo(6.385472870122, 6);
    });
  });

  test('oscillatory integrand ∫_{-π}^{π} e^{-t²} cos(6π t) dt', () => {
    const r = compileReal(
      '\\int_{-\\pi}^{\\pi} e^{-t^2} \\cos(2\\pi \\cdot 3 \\cdot t)\\,dt'
    );
    const got = r.run({}) as number;
    expect(Number.isFinite(got)).toBe(true);
    expect(got).toBe(r.run({}) as number); // deterministic
    // Trusted reference: fine composite Simpson (N = 2·10⁶) over [-π, π] gives
    // 3.7408935992e-6; verified to agree with an independent GK computation to
    // ~1e-15. (The integral is dominated by truncation — the doubly-infinite
    // value √π·e^{-9π²} ≈ 3e-39 is negligible.)
    expect(Math.abs(got - 3.7408935992e-6)).toBeLessThan(1e-6);
  });

  test('piecewise integrand ∫_0^2 f, f = 1 for t<1 else 2 → 3', () => {
    // Built via Which (jump discontinuity at t = 1).
    const expr = ce.box([
      'Integrate',
      ['Which', ['Less', 'x', 1], 1, 'True', 2],
      ['Limits', 'x', 0, 2],
    ]);
    const r = compile(expr, { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.run() as number).toBeCloseTo(3, 6);
  });

  describe('quadrature option', () => {
    // A piecewise (Which) integrand has no elementary antiderivative, so the
    // antiderivative-first path declines and the quadrature emitter is exercised
    // (∫_0^2 of {1 for t<1, else 2} = 3).
    const piecewise = () =>
      ce.box([
        'Integrate',
        ['Which', ['Less', 'x', 1], 1, 'True', 2],
        ['Limits', 'x', 0, 2],
      ]);

    test("quadrature: 'monte-carlo' emits integrateMC and runs", () => {
      const r = compile(piecewise(), {
        realOnly: true,
        quadrature: 'monte-carlo',
      });
      expect(r.code).toContain('integrateMC');
      expect(r.run() as number).toBeCloseTo(3, 2); // MC: ~1e-2 tolerance
    });

    test('default emits _SYS.integrate, not integrateMC', () => {
      // The integral has constant bounds and no free variables, so compile-time
      // constant folding would replace the whole quadrature call with its
      // value; this test pins the EMITTED code, so folding is turned off.
      const r = compile(piecewise(), { realOnly: true, constantFold: false });
      expect(r.code).toContain('_SYS.integrate(');
      expect(r.code).not.toContain('integrateMC');
    });
  });

  describe('antiderivative-first (symbolic resolution before quadrature)', () => {
    // A resolvable integral compiles to its closed form — no quadrature call at
    // all — so each sample is straight-line arithmetic, not an integration loop.
    test('resolvable integral emits no quadrature call', () => {
      const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
      expect(r.code).not.toContain('_SYS.integrate');
      expect(r.code).not.toContain('integrateMC');
      // Exact closed form (0.05·(x·√(1+x²) + asinh x)), deterministic.
      const got = r.run({ x: 5 }) as number;
      expect(got).toBeCloseTo(0.05 * (5 * Math.sqrt(26) + Math.asinh(5)), 10);
      expect(got).toBe(r.run({ x: 5 }) as number);
    });

    test('Gaussian CDF resolves to an Erf closed form (no quadrature)', () => {
      const r = compileReal(
        '\\frac{1}{\\sqrt{2\\pi}}\\int_{-\\infty}^{x} e^{-t^2/2}\\,dt'
      );
      expect(r.code).not.toContain('_SYS.integrate');
      expect(r.run({ x: 1 }) as number).toBeCloseTo(0.8413447460685429, 10);
    });

    // Precedence: the closed form (an `Add`) is spliced into a larger
    // expression; it must be parenthesized so surrounding operators bind
    // correctly. `2·∫_0^x t dt + 1 = x² + 1`.
    test('closed form is parenthesized inside a larger expression', () => {
      const r = compile(ce.parse('2\\int_0^x t\\,dt + 1'), { realOnly: true });
      expect(r.run({ x: 3 }) as number).toBeCloseTo(10, 10);
    });

    // Non-resolvable integrand falls back to quadrature.
    test('non-elementary integrand falls back to quadrature', () => {
      const r = compileReal('\\int_0^2 e^{\\sin t}\\,dt');
      expect(r.code).toContain('_SYS.integrate(');
      expect(r.run() as number).toBeCloseTo(4.236531, 3);
    });

    // A `vars`-mapped symbol must not be folded into a baked closed form, so
    // antiderivative-first is skipped when the integral references one — the
    // quadrature emitter (which honors the vars mapping) is used instead.
    // Contrast: the same integral WITHOUT the vars mapping resolves to a closed
    // form (k²/2), proving the gate is what forces quadrature.
    test('vars-mapped symbol skips antiderivative-first (keeps quadrature)', () => {
      const withVars = compile(ce.parse('\\int_0^k t\\,dt'), {
        realOnly: true,
        vars: { k: '_.k' },
      });
      expect(withVars.code).toContain('_SYS.integrate(');

      const noVars = compile(ce.parse('\\int_0^k t\\,dt'), { realOnly: true });
      expect(noVars.code).not.toContain('_SYS.integrate');
      expect(noVars.run({ k: 4 }) as number).toBeCloseTo(8, 10); // k²/2
    });

    // A high-power integrand's symbolic-antiderivative attempt expands
    // `(trinomial)^p` into a multinomial (`C(p+2,2)` terms) and scans the
    // integration rule set against it — unboundedly slow. The compile-time
    // attempt is bounded by `ce.timeLimit`: `evaluate()` now checkpoints its
    // power expansion (`expandPower`) and rule scan (`matchAnyRules`) against
    // the deadline, so compilation degrades to quadrature instead of hanging.
    // (Tycho item 8, 2026-07-15.)
    test('high-power integrand degrades to quadrature at the deadline', () => {
      const engine = new ComputeEngine();
      const start = Date.now();
      const r = engine.withTimeLimit(
        { ms: 500, label: 'test:high-power-integrand' },
        () =>
          compile(
            engine.parse(
              '\\int_{-15}^{15} (2 + \\sin(3y) + \\cos(\\pi^2 y))^{60} \\, dy'
            ),
            { realOnly: true }
          )
      );
      const elapsed = Date.now() - start;
      expect(r.success).toBe(true);
      // Fell back to quadrature rather than baking a closed form.
      expect(r.code).toContain('_SYS.integrate(');
      // Bounded by a small multiple of the 500ms limit, not the ~5s hang.
      expect(elapsed).toBeLessThan(3000);
      // The compiled quadrature runner still produces a finite value.
      expect(Number.isFinite(r.run() as number)).toBe(true);
    });

    // The item-8 bound above only fires when the CALLER arms a span. Since
    // `ce.timeLimit` was retired, a compile with no enclosing span ran the
    // antiderivative-first attempt unbounded — this χ² tail integral with a
    // free shape parameter `k` (so the exponent `k/2−1` stays symbolic) sent
    // `tryIntegrationByParts` into a search that had not returned after 2
    // minutes. The attempt now arms its own budget, so BOTH arms — span and
    // no span — degrade to quadrature promptly. (Tycho item 98, 2026-07-27.)
    describe('free symbolic exponent degrades to quadrature (item 98)', () => {
      const CHI2_TAIL =
        '\\int_{x}^{\\infty}\\!\\frac{\\exp(-(\\frac{y}{2}))y^{\\frac{k}{2}-1}}' +
        '{(\\frac{k}{2}-1)!\\times2^{\\frac{k}{2}}}\\, \\mathrm{d}y';

      // `k` is bound at run time to 2, whose tail has the elementary closed
      // form e^{−x/2} — so the assertions are exact and independent of how
      // `x!` is evaluated at a non-integer (k = 2 gives 0! = 1).
      const X_CRIT = 5.991464547107979; // χ²₂ 5% critical value

      test.each([
        ['no enclosing span', undefined],
        ['enclosing 2 s span', 2000],
      ])('%s', (_label, spanMs) => {
        const engine = new ComputeEngine();
        const expr = engine.parse(CHI2_TAIL, { strict: false });
        const start = Date.now();
        const run = () => compile(expr, { realOnly: true });
        const r =
          spanMs === undefined
            ? run()
            : engine.withTimeLimit({ ms: spanMs, label: 'test:item-98' }, run);
        const elapsed = Date.now() - start;

        expect(r.success).toBe(true);
        // Degraded to quadrature rather than baking a closed form.
        expect(r.code).toContain('_SYS.integrate(');
        // Bounded by the compile-time attempt budget, not the >2 min hang.
        expect(elapsed).toBeLessThan(15000);
        // `k` stays a free symbol, bound at run time alongside `x`.
        expect(r.run({ x: X_CRIT, k: 2 }) as number).toBeCloseTo(0.05, 8);
        expect(r.run({ x: 1, k: 2 }) as number).toBeCloseTo(
          Math.exp(-0.5), // 0.6065306597126334
          8
        );
      });
    });
  });

  test('performance smoke — 50 calls under 2 s', () => {
    const r = compileReal('\\int_0^x 0.1\\sqrt{1+t^2}\\,dt');
    const start = Date.now();
    for (let i = 0; i < 50; i++) r.run({ x: 1 + (i % 5) });
    expect(Date.now() - start).toBeLessThan(2000);
  });

  // A multi-limit `Integrate` compiles to NESTED `_SYS.integrate` calls,
  // innermost last (Mathematica iterator convention: the first limit is the
  // outermost integral). Previously only the first limit was read, silently
  // truncating the quadrature fallback to one dimension. Non-elementary
  // integrands force quadrature (a closed form would fold via the
  // antiderivative-first path); reference values from independent mpmath
  // computations.
  describe('multiple limits (nested iterated quadrature)', () => {
    test('product domain: ∫₀¹∫₀¹ e^{x²y} dy dx', () => {
      const e = ce.expr([
        'Integrate',
        ['Exp', ['Multiply', ['Square', 'x'], 'y']],
        ['Limits', 'x', 0, 1],
        ['Limits', 'y', 0, 1],
      ]);
      const r = compile(e, { realOnly: true });
      expect(r.success).toBe(true);
      expect(r.run({}) as number).toBeCloseTo(1.207021663355318, 10);
    });

    test('dependent inner bound: ∫₀¹ dx ∫₀ˣ e^{y²} dy', () => {
      // The inner bound references the outer lambda variable, in scope at its
      // nesting depth.
      const e = ce.expr([
        'Integrate',
        ['Exp', ['Square', 'y']],
        ['Limits', 'x', 0, 1],
        ['Limits', 'y', 0, 'x'],
      ]);
      const r = compile(e, { realOnly: true });
      expect(r.success).toBe(true);
      expect(r.run({}) as number).toBeCloseTo(0.60351083167765899, 10);
    });

    test('closed-form multi-limit folds via the antiderivative-first path', () => {
      const e = ce.expr([
        'Integrate',
        ['Multiply', 'x', 'y'],
        ['Limits', 'x', 0, 3],
        ['Limits', 'y', 0, 2],
      ]);
      const r = compile(e, { realOnly: true });
      expect(r.success).toBe(true);
      expect(r.run({}) as number).toBeCloseTo(9, 12);
    });
  });
});

describe('adaptiveQuadrature (unit)', () => {
  test('finite smooth: ∫_0^1 x² dx = 1/3', () => {
    const r = adaptiveQuadrature((x) => x * x, 0, 1);
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(1 / 3, 12);
  });

  test('reversed bounds negate the result', () => {
    const fwd = adaptiveQuadrature(Math.sin, 0, Math.PI);
    const rev = adaptiveQuadrature(Math.sin, Math.PI, 0);
    expect(rev.estimate).toBeCloseTo(-fwd.estimate, 14);
  });

  test('a === b → 0', () => {
    const r = adaptiveQuadrature(Math.sin, 1, 1);
    expect(r.estimate).toBe(0);
    expect(r.converged).toBe(true);
  });

  test('[a, ∞) exponential decay: ∫_0^∞ e^{-x} dx = 1', () => {
    const r = adaptiveQuadrature((x) => Math.exp(-x), 0, Infinity);
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(1, 8);
  });

  test('NaN bound → non-converged NaN', () => {
    const r = adaptiveQuadrature(Math.sin, NaN, 1);
    expect(Number.isNaN(r.estimate)).toBe(true);
    expect(r.converged).toBe(false);
  });

  test('(-∞, ∞) convergent even integrand: ∫ 1/(1+x²) dx = π', () => {
    // The doubly-infinite case is split at 0 into two semi-infinite integrals.
    const r = adaptiveQuadrature((x) => 1 / (1 + x * x), -Infinity, Infinity);
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(Math.PI, 8);
  });

  test('(-∞, ∞) divergent odd integrand does not falsely converge to 0 (∫ x dx)', () => {
    // Divergence check: a single symmetric transform makes an odd integrand
    // cancel to exactly 0 on the first panel (GK nodes are symmetric about the
    // center), reporting a spurious converged 0. Splitting at 0 lets each
    // divergent half hit the panel budget instead.
    const r = adaptiveQuadrature((x) => x, -Infinity, Infinity);
    expect(r.converged).toBe(false);
  });

  test('.N() of a definite integral uses GK15 (not Monte Carlo): near machine precision', () => {
    // Regression for the accuracy inversion: the interpreter's `.N()` used to
    // fall straight to Monte Carlo (~1e-3 relative error) while the compiled
    // path used GK15. `.N()` now shares GK15, so a smooth finite-bound integral
    // resolves to near machine precision. A hypersurface-fresh engine avoids
    // cross-test state.
    const local = new ComputeEngine();
    // ∫_{-1}^1 √(1−x²)/(1+x²) dx = π(√2 − 1); no closed form is found, so this
    // exercises the numeric path rather than the antiderivative. GK15 returns a
    // `Measurement` (value ± error bound); Monte Carlo would too, but ~5 orders
    // of magnitude looser.
    const r = local.parse('\\int_{-1}^1 \\frac{\\sqrt{1-x^2}}{1+x^2} dx').N();
    const v = r.operator === 'Measurement' ? r.op1.re : r.re;
    expect(v).toBeCloseTo(Math.PI * (Math.SQRT2 - 1), 8);
  });

  test('removable singularity at the midpoint node does not poison the totals (∫_{-1}^1 sin x / x dx)', () => {
    // sin(x)/x is NaN at the interval midpoint x = 0 (a GK node of the first
    // panel), which used to leave the incremental accumulators permanently NaN
    // and force a Monte-Carlo fallback. The panel is subdivided away and the
    // routine must converge to 2·Si(1).
    const f = (x: number) => Math.sin(x) / x;
    const r = adaptiveQuadrature(f, -1, 1);
    expect(r.converged).toBe(true);

    // Independent reference: composite Simpson with the removable singularity
    // patched (sin(x)/x → 1 at x = 0). N = 20000 panels → ~1e-14 accurate.
    const sinc = (x: number) => (x === 0 ? 1 : Math.sin(x) / x);
    const N = 20000;
    const h = 2 / N; // over [-1, 1]
    let s = sinc(-1) + sinc(1);
    for (let i = 1; i < N; i++) s += (i % 2 === 0 ? 2 : 4) * sinc(-1 + i * h);
    const simpson = (h / 3) * s;

    expect(r.estimate).toBeCloseTo(simpson, 12);
    // 2·Si(1) ≈ 1.8921661407343662
    expect(r.estimate).toBeCloseTo(1.8921661407343662, 12);
  });
});

describe('sharply-peaked integrands (Tycho item 97)', () => {
  // A peak far narrower than the interval, whose weight vanishes at the center
  // node, used to "converge" on the first 15-node panel: every node read ~0, so
  // the Gauss/Kronrod difference met `atol` and the routine reported
  // `3.2e-21 ± 5.1e-21` for a true value of 1. See `INITIAL_PANELS`.
  const phi = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

  test.each([
    ['moment 0', (x: number) => phi(x), 1],
    [
      'moment 1 (|x|)',
      (x: number) => Math.abs(x) * phi(x),
      Math.sqrt(2 / Math.PI),
    ],
    ['moment 2', (x: number) => x * x * phi(x), 1],
    ['moment 4', (x: number) => x ** 4 * phi(x), 3],
    ['moment 6', (x: number) => x ** 6 * phi(x), 15],
  ])('Gaussian %s over [-50, 50]', (_label, f, expected) => {
    const r = adaptiveQuadrature(f, -50, 50);
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(expected, 10);
  });

  test('the comb ∫_{-15}^{15} φ(x)^350 dx', () => {
    // Closed form: (2π)^(-175)·√(π/175). The peak has width ~1/√175 ≈ 0.076
    // over an interval of width 30, so this stays a hard problem — pinned at
    // the accuracy the initial subdivision actually achieves, not exactness.
    const closed = Math.exp(
      -175 * Math.log(2 * Math.PI) + 0.5 * Math.log(Math.PI / 175)
    );
    const r = adaptiveQuadrature((x) => Math.pow(phi(x), 350), -15, 15);
    expect(Math.abs(r.estimate - closed) / closed).toBeLessThan(0.01);
  });

  test('via the engine, end to end', () => {
    const local = new ComputeEngine();
    const r = local
      .parse('\\int_{-50}^{50} x^2 \\frac{1}{\\sqrt{2\\pi}} e^{-x^2/2} dx')
      .N();
    expect(r.re).toBeCloseTo(1, 10);
  });
});

describe('non-finite integrand fails fast (Tycho item 96)', () => {
  test('an identically-NaN integrand returns NaN without burning the sample budget', () => {
    // An unbound variable reaches a compiled artifact as `undefined`, making the
    // integrand identically NaN. Adaptive quadrature can never converge on it,
    // so it fell through to a 1e7-sample Monte Carlo — ~250-450 ms per call to
    // produce a NaN. The probe in `monteCarloEstimate` decides it immediately.
    const r = compileReal('\\int_{-10}^{10} (x + q)\\,dx');
    const t0 = Date.now();
    const got = r.run({ q: NaN }) as number;
    const elapsed = Date.now() - t0;

    expect(Number.isNaN(got)).toBe(true);
    // Generous bound: the point is the two-orders-of-magnitude collapse, not a
    // tight timing pin. Pre-fix this single call took 250-450 ms.
    expect(elapsed).toBeLessThan(100);
  });

  test('a genuine endpoint singularity is still integrated', () => {
    // The bail is ALL-non-finite only: ∫_0^1 1/√x is +∞ at the endpoint but
    // finite almost everywhere, and must still converge to 2.
    const r = adaptiveQuadrature((x) => 1 / Math.sqrt(x), 0, 1);
    expect(r.estimate).toBeCloseTo(2, 6);
  });
});

describe('free symbol in the integrand stays symbolic (Tycho item 96, secondary)', () => {
  // `.N()` used to hand the integrand to `implicitCompile`, whose generated
  // body read the free symbol from a scope slot the numeric caller never
  // supplies — a raw `ReferenceError: _ is not defined` escaped to the caller.
  test.each([
    ['single limit', '\\int_0^1 (x+q)\\,dx'],
    ['double limit', '\\int_0^1\\int_0^1 (x+y+q)\\,dx\\,dy'],
  ])('%s', (_label, latex) => {
    const local = new ComputeEngine();
    let result: string | undefined;
    expect(() => {
      result = local.parse(latex).N().toString();
    }).not.toThrow();
    expect(result).toContain('q');
  });

  test('and evaluates once the symbol has a value', () => {
    const local = new ComputeEngine();
    local.assign('q', 2);
    expect(local.parse('\\int_0^1 (x+q)\\,dx').N().re).toBeCloseTo(2.5, 10);
  });
});

describe('adaptive quadrature — review follow-ups', () => {
  test('a fractional maxIntervals does not extend the last panel past b', () => {
    // The starting-panel loop derives its endpoint clamp from `n`. With a
    // fractional budget the loop ran `ceil(n)` times while `i === n - 1` never
    // matched, so the last panel ran past `b` and the routine integrated the
    // wrong interval: ∫₀¹1 read 1.2 and ∫₀¹x read 0.72.
    for (const maxIntervals of [0.5, 1, 2.5, 3.7, 17.9]) {
      expect(
        adaptiveQuadrature(() => 1, 0, 1, { maxIntervals }).estimate
      ).toBeCloseTo(1, 10);
      expect(
        adaptiveQuadrature((x) => x, 0, 1, { maxIntervals }).estimate
      ).toBeCloseTo(0.5, 10);
    }
  });

  test('the starting-panel floor does not multiply across nested levels', () => {
    // An iterated integral runs a full quadrature per outer node, so a
    // per-level floor of 16 costs 16² for 2-D and 16³ for 3-D. Measured: a
    // smooth 2-D integral went 225 → 57 600 inner evaluations.
    expect(initialPanelsForDimensions(1)).toBe(16);
    expect(initialPanelsForDimensions(2)).toBe(4);
    expect(initialPanelsForDimensions(3)).toBe(3);
    // Never one panel — that is the item-97 defect.
    for (const d of [1, 2, 3, 4, 8])
      expect(initialPanelsForDimensions(d)).toBeGreaterThanOrEqual(2);

    const count = (panels: number) => {
      let n = 0;
      const inner = (y: number) =>
        adaptiveQuadrature(
          (x) => {
            n++;
            return Math.sin(x * y);
          },
          0,
          1,
          { initialPanels: panels }
        ).estimate;
      const r = adaptiveQuadrature(inner, 0, 1, { initialPanels: panels });
      return { estimate: r.estimate, evals: n };
    };
    const flat = count(16);
    const scaled = count(initialPanelsForDimensions(2));
    expect(scaled.estimate).toBeCloseTo(0.2398117420005644, 10);
    expect(flat.evals / scaled.evals).toBeGreaterThan(10);
  });

  test('a Function literal with unsupplied parameters stays symbolic', () => {
    // `Function(x+q, x, q)` under a single `Limits(x,…)`: `q` is a FORMAL
    // parameter, so `unknowns` is empty and the free-symbol guard passes. The
    // literal then compiled two-arity, was invoked unary, and read NaN.
    const local = new ComputeEngine();
    const lit = local.function('Function', [
      local.parse('x+q'),
      local.symbol('x'),
      local.symbol('q'),
    ]);
    const limits = local.function('Limits', [local.symbol('x'), 0, 1]);
    const r = local.function('Integrate', [lit, limits]).N();
    expect(r.operator).toBe('Integrate');
    expect(Number.isNaN(r.re)).toBe(true); // symbolic, not a NaN measurement
    expect(r.toString()).not.toContain('NaN');

    // The well-formed unary literal still evaluates.
    const ok = local
      .function('Integrate', [
        local.function('Function', [local.parse('x^2'), local.symbol('x')]),
        limits,
      ])
      .N();
    expect(ok.re).toBeCloseTo(1 / 3, 10);
  });
});

describe('COMPILE Integrate — engine hygiene', () => {
  // Compiling an integral must not mutate the caller's engine. The
  // antiderivative attempt canonicalizes and evaluates the integral, and an
  // integrand with a free single-uppercase-letter symbol (`D`, `N`) devolves
  // that unapplied operator to a variable by SHADOWING the builtin in the
  // current scope (`devolveUnappliedOperator`, intentional — see
  // `unapplied-operator-fallback.test.ts`). Without an isolation scope around
  // the attempt, "the current scope" is the engine's global one and `D` stays a
  // variable for the life of the engine. All four rows below leaked before the
  // fix.
  describe.each([
    ['indefinite', '\\int D x^2 dx'],
    ['definite', '\\int_0^1 D x^2 dx'],
  ])('%s', (_form, latex) => {
    test.each(['parse', 'box'])('%s route', (route) => {
      const local = new ComputeEngine();
      const expr =
        route === 'parse'
          ? local.parse(latex)
          : local.box(local.parse(latex).json);
      expect(Object.keys(local.lookupDefinition('D')!)).toEqual(['operator']);

      const r = compile(expr, { realOnly: true });
      expect(r.success).toBe(true);

      // Still the builtin operator definition, not a devolved variable.
      expect(Object.keys(local.lookupDefinition('D')!)).toEqual(['operator']);
      expect(local.parse('D(x^2, x)').evaluate().toString()).toBe('2x');
    });
  });

  test('the isolated attempt still finds the closed form', () => {
    // The closed form outlives the isolation scope: `D` is a free variable of
    // the emitted code, resolved by name against the target's bindings.
    const local = new ComputeEngine();
    const r = compile(local.parse('\\int_0^1 D x^2 dx'), { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.run({ D: 3 })).toBeCloseTo(1, 10);
  });
});

describe('COMPILE Integrate — indefinite with no closed form fails closed', () => {
  // An indefinite integral whose antiderivative does not close has no numeric
  // value at a point: it denotes a function, not a number. `extractLimits`
  // hands the quadrature emitter the `Limits` bounds, which for an indefinite
  // integral are the `Nothing` symbol; `Nothing` compiled like any free symbol
  // to a `vars`-object lookup (`_.Nothing`), and at run time
  // `adaptiveQuadrature(f, undefined, undefined)` reported CONVERGED and
  // returned 0 — so `∫ e^{x³} sin x dx` "compiled" and answered 0 for every x.
  test('∫ e^{x³} sin(x) dx declines instead of fabricating 0', () => {
    const r = compile(ce.parse('\\int e^{x^3}\\sin(x) dx'), { realOnly: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Fail closed \(D6\)/);
    expect(r.error).toMatch(/indefinite integral/);
    expect(String((r as any).code ?? '')).not.toContain('_.Nothing');
  });

  test.each([
    ['\\int x^2 dx', { x: 3 }, 9],
    ['\\int \\sin(x) dx', { x: 1 }, -Math.cos(1)],
    ['\\int e^{2x} dx', { x: 1 }, 0.5 * Math.exp(2)],
    ['\\int D x^2 dx', { D: 2, x: 3 }, 18],
  ])(
    'an indefinite integral WITH a closed form still compiles: %s',
    (latex, args, expected) => {
      const r = compile(ce.parse(latex), { realOnly: true });
      expect(r.success).toBe(true);
      expect(r.run(args as Record<string, number>) as number).toBeCloseTo(
        expected as number,
        10
      );
    }
  );

  test('a DEFINITE integral with no closed form still uses quadrature', () => {
    // A free coefficient keeps the antiderivative-first path from folding it,
    // so this is the quadrature emitter, not a baked closed form.
    const r = compile(ce.parse('\\int_0^1 e^{-a x^2} dx'), {
      realOnly: true,
      vars: { a: '_.a' },
    });
    expect(r.success).toBe(true);
    expect(String(r.code)).toContain('_SYS.integrate');
    expect(r.run({ a: 1 }) as number).toBeCloseTo(0.7468241328124271, 8);
  });

  test.each([
    ['\\int_0^1 e^{-x^2} dx', {}, 0.7468241328124271],
    ['\\int_0^1 \\sin(x) dx', {}, 0.4596976941318603],
    ['\\int_0^1 x^2 dx', {}, 1 / 3],
    ['\\int_{-3}^{3}\\sin(t)dt', {}, 0],
    ['\\int_0^b \\sin(x) dx', { b: 1 }, 0.4596976941318603],
  ])('definite integrals are untouched: %s', (latex, args, expected) => {
    const r = compile(ce.parse(latex), { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.run(args as Record<string, number>) as number).toBeCloseTo(
      expected as number,
      8
    );
  });
});

describe('COMPILE — `Nothing` is never emitted as a variable reference', () => {
  // `Nothing` is the engine's ERASURE marker, not a variable. Any emitter that
  // splices it in as an ordinary operand produces `_.Nothing`, which reads
  // `undefined` at run time and degrades silently rather than throwing.
  test.each([
    // Unbounded Sum: `Math.floor(_.Nothing)` → NaN trip count → returns 0.
    ['unbounded Sum bound', ['Sum', 'x', ['Limits', 'i', 1, 'Nothing']]],
    // Open-ended Range: `_.Nothing` → an empty array.
    ['open-ended Range', ['Range', 1, 'Nothing']],
    // An `If` whose else-arm is the erasure marker.
    ['If else-arm', ['If', 'True', 1, 'Nothing']],
  ])('%s fails closed', (_label, json) => {
    // These expressions have no free variables, so compile-time constant
    // folding would evaluate them away before the emitter ever sees the
    // `Nothing` operand; the point here is the EMITTER's fail-closed guard.
    const r = compile(ce.box(json as any), {
      realOnly: true,
      constantFold: false,
    });
    expect(r.success).toBe(false);
    expect(String((r as any).code ?? '')).not.toContain('_.Nothing');
  });

  test('a variable legitimately NAMED `Nothing` in `vars` still compiles', () => {
    // The `vars` lookup precedes the guard, so a caller that really pins a
    // runtime input called `Nothing` keeps it.
    const r = compile(
      ce.box(['Sum', 'x', ['Limits', 'i', 1, 'Nothing']] as any),
      {
        realOnly: true,
        vars: { Nothing: '_.Nothing', x: '_.x' },
      }
    );
    expect(r.success).toBe(true);
    expect(r.run({ Nothing: 3, x: 2 }) as number).toBe(6);
  });
});

// Regression (Tycho item 128): a nested numeric quadrature ran ~300 s where the
// honest cost is ~1 s. `converged: false` from adaptive GK15 means only "did
// not reach rtol = 1e-10 within the panel budget", but every caller read it as
// "GK failed" and replaced the result with a Monte-Carlo estimate — whose own
// noise floor (~1/√n) is orders of magnitude WORSE than the bound GK reported,
// and which costs `n` integrand evaluations. When one evaluation is itself a
// quadrature (an iterated integral), that is 1e7 inner quadratures to make the
// answer less accurate.
describe('quadratureBeatsMonteCarlo (Tycho item 128)', () => {
  test('a stalled-but-tight result is preferred over sampling', () => {
    // The witness: GK stalls at 1e-8 relative on an integrand Monte Carlo can
    // only reach ~3e-4 on.
    expect(
      quadratureBeatsMonteCarlo({ estimate: 4.0621, error: 3e-8 }, 1e7)
    ).toBe(true);
  });

  test('a bound no better than the sampler floor still falls back', () => {
    // 1e7 samples ⇒ ~3.2e-4 relative floor; a 1e-2 relative bound is worse.
    expect(
      quadratureBeatsMonteCarlo({ estimate: 4.0621, error: 4e-2 }, 1e7)
    ).toBe(false);
    // The threshold tracks the sample count — a larger budget is a finer floor,
    // so it is strictly harder to beat. A 1e-3 relative bound clears a
    // 1e4-sample fallback (floor 1e-2) but not a 1e7-sample one (floor 3.2e-4).
    expect(quadratureBeatsMonteCarlo({ estimate: 1, error: 1e-3 }, 1e4)).toBe(
      true
    );
    expect(quadratureBeatsMonteCarlo({ estimate: 1, error: 1e-3 }, 1e7)).toBe(
      false
    );
  });

  test('a non-finite result always falls back', () => {
    expect(quadratureBeatsMonteCarlo({ estimate: NaN, error: 1e-12 }, 1e7)).toBe(
      false
    );
    expect(
      quadratureBeatsMonteCarlo({ estimate: 1, error: Infinity }, 1e7)
    ).toBe(false);
  });

  test('a near-zero estimate has no relative scale and keeps the fallback', () => {
    expect(quadratureBeatsMonteCarlo({ estimate: 0, error: 0.5 }, 1e7)).toBe(
      false
    );
  });

  test('∫₀¹ sin(1/x) dx keeps the accurate quadrature value', () => {
    // GK15 cannot reach 1e-10 on this infinitely-oscillating integrand and
    // reports `converged: false` with a ±5e-5 bound around a value good to
    // 6e-7. The Monte-Carlo fallback it used to trigger returned ±2e-4 (and a
    // DIFFERENT value each run) after ~800 ms of sampling.
    const exact = Math.sin(1) - 0.3374039229009681; // sin(1) − Ci(1)
    const local = new ComputeEngine();
    const r = local.parse('\\int_0^1 \\sin(1/x)\\,dx').N();
    const value = r.operator === 'Measurement' ? r.op1.re : r.re;
    expect(value).toBeCloseTo(exact, 5);
  });

  test('an iterated integral reports its INNER stall in the uncertainty', () => {
    // Keeping a stalled-but-tight inner result (the policy above) means the
    // iterated result carries that inner bias. When the inner integrand does
    // not vary with the outer variable, the outer estimator cannot see it: the
    // same biased value returns at every outer node, the integrand looks
    // perfectly smooth, and the outer error collapses to exactly 0 — which
    // canonicalizes the `Measurement` away and claims an exact answer. The
    // inner error is now propagated explicitly.
    const exact = Math.sin(1) - 0.3374039229009681; // ∫₀¹ sin(1/x) dx, ×∫₀¹dy
    const local = new ComputeEngine();
    const r = local
      .box([
        'Integrate',
        ['Sin', ['Divide', 1, 'x']],
        ['Limits', 'y', 0, 1],
        ['Limits', 'x', 0, 1],
      ])
      .N();
    expect(r.operator).toBe('Measurement');
    const [value, error] = [r.op1.re, r.op2.re];
    expect(value).toBeCloseTo(exact, 5);
    // Measured ≈ 5.1e-5 (the inner ±5e-5 bound over an outer range of 1);
    // floored well below that so the pin is "not ~0", not a tight value.
    expect(error).toBeGreaterThan(1e-9);
    // The bound must actually cover the error it exists to report.
    expect(error).toBeGreaterThan(Math.abs(value - exact));
  });
});

// Regression (Tycho item 136, fallout from 128): with the Monte-Carlo fallback
// correctly reserved for results sampling could improve, the sampler stopped
// being the only thing that noticed a DIVERGENT integral — so `∫₀¹ dx/x` was
// reported as `709.09 ± 7.4e-10`, a confident `Measurement` for an integral
// that has no value. (709 is `ln` of the float overflow bound: GK kept
// bisecting toward 0, each halving adding another `ln 2`.)
//
// The signal CANNOT be a threshold on the reported error: the legitimate
// improper `∫₀¹ dx/√x` reports a LOOSER relative error (~7.7e-11) than the
// divergent `∫₀¹ dx/x` did (~1e-12), so any σ- or relative-error cutoff
// rejects the good integral first. It is instead structural — the dyadic
// shells shed by refinement toward the endpoint must shrink (see
// `shellsDiverge`).
describe('divergent integrals are not laundered (Tycho item 136)', () => {
  describe('adaptiveQuadrature reports `divergent`', () => {
    test.each([
      ['∫₀¹ dx/x (log-divergent, lower endpoint)', (x: number) => 1 / x, 0, 1],
      ['∫₀¹ dx/x² (power-divergent)', (x: number) => 1 / (x * x), 0, 1],
      [
        '∫₀¹ dx/(1−x) (mirrored, upper endpoint)',
        (x: number) => 1 / (1 - x),
        0,
        1,
      ],
      ['∫₋₁⁰ dx/x (negative, lower half)', (x: number) => 1 / x, -1, 0],
      ['∫₀¹ −dx/x (negatively divergent)', (x: number) => -1 / x, 0, 1],
      ['∫₀^∞ x dx (via the semi-infinite transform)', (x: number) => x, 0, Infinity],
      ['∫₁^∞ dx/x', (x: number) => 1 / x, 1, Infinity],
      ['∫₀^{π/2} tan x dx', Math.tan, 0, Math.PI / 2],
      ['∫₀¹ x^(−1.01) dx (just past the pole)', (x: number) => x ** -1.01, 0, 1],
    ])('%s', (_label, f, a, b) => {
      const r = adaptiveQuadrature(f, a, b);
      expect(r.divergent).toBe(true);
      expect(r.converged).toBe(false);
    });

    test.each([
      ['∫₀¹ dx/√x = 2', (x: number) => 1 / Math.sqrt(x), 0, 1, 2],
      ['∫₀¹ ln x dx = −1', Math.log, 0, 1, -1],
      ['∫₀¹ (ln x)² dx = 2', (x: number) => Math.log(x) ** 2, 0, 1, 2],
      ['∫₀¹ √x·ln x dx = −4/9', (x: number) => Math.sqrt(x) * Math.log(x), 0, 1, -4 / 9],
      ['∫₋₁¹ dx/√(1−x²) = π', (x: number) => 1 / Math.sqrt(1 - x * x), -1, 1, Math.PI],
      // Convergent but only just: `x^(−p)` sheds blocks in the ratio
      // `2^((1−p)·20)`, so these sit at 0.87 and 0.986 against a 0.99 cutoff.
      ['∫₀¹ x^(−0.9) dx = 10', (x: number) => x ** -0.9, 0, 1, 10],
      // (No value pinned: the true 100 is out of numerical reach — the tail
      // below `h` still contributes `100·h^0.01`, so even `h = 1e-300` leaves
      // 0.1% missing. The point here is only that it is not called divergent.)
      ['∫₀¹ x^(−0.99) dx', (x: number) => x ** -0.99, 0, 1, undefined],
      // Conditionally convergent: the shells do NOT shrink, they CANCEL. The
      // signed block sums (plus the coherence gate) keep this off the
      // divergent list.
      ['∫₀¹ sin(1/x)/x dx', (x: number) => Math.sin(1 / x) / x, 0, 1, undefined],
      // Proper integrals, for the same reason they always worked.
      ['∫₀¹ x² dx = 1/3', (x: number) => x * x, 0, 1, 1 / 3],
      ['∫₀^∞ e^(−x) dx = 1', (x: number) => Math.exp(-x), 0, Infinity, 1],
      ['∫₋∞^∞ dx/(1+x²) = π', (x: number) => 1 / (1 + x * x), -Infinity, Infinity, Math.PI],
    ])('%s is NOT divergent', (_label, f, a, b, exact) => {
      const r = adaptiveQuadrature(f, a, b);
      expect(r.divergent).toBe(false);
      if (exact !== undefined) {
        expect(r.estimate).toBeCloseTo(exact, 6);
        expect(Number.isFinite(r.error)).toBe(true);
      }
    });

    test('a converged result is never reported divergent', () => {
      // `divergent` is only ever consulted on a stalled result, but the two
      // flags must not be able to disagree.
      const r = adaptiveQuadrature((x) => Math.exp(-x * x), -5, 5);
      expect(r.converged).toBe(true);
      expect(r.divergent).toBe(false);
    });

    test('detection stops the panel budget early', () => {
      // Before: the loop bisected toward 0 until the corner panel reached the
      // denormal range (~1075 halvings, ~20 ms). Now it stops ~40 shells in.
      let evals = 0;
      const t0 = Date.now();
      const r = adaptiveQuadrature((x) => {
        evals++;
        return 1 / x;
      }, 0, 1);
      expect(r.divergent).toBe(true);
      // Measured ~1700 evaluations / <1 ms; loose bounds, the point is the
      // order of magnitude (the pre-fix run used ~16 000).
      expect(evals).toBeLessThan(6000);
      expect(Date.now() - t0).toBeLessThan(200);
    });
  });

  describe('.N() route (single limit)', () => {
    test.each([
      ['\\int_0^1 \\frac{1}{x}\\,dx'],
      ['\\int_0^1 \\frac{1}{x^2}\\,dx'],
      ['\\int_0^1 \\frac{1}{1-x}\\,dx'],
    ])('%s is not a Measurement', (latex) => {
      const local = new ComputeEngine();
      const r = local.parse(latex).N();
      expect(r.operator).not.toBe('Measurement');
      expect(Number.isFinite(r.re)).toBe(false);
    });

    test.each([
      ['\\int_0^1 \\frac{1}{\\sqrt{x}}\\,dx', 2],
      ['\\int_0^1 \\ln(x)\\,dx', -1],
      ['\\int_0^1 x^2\\,dx', 1 / 3],
    ])('%s still evaluates with a finite uncertainty', (latex, exact) => {
      const local = new ComputeEngine();
      const r = local.parse(latex).N();
      const [value, error] =
        r.operator === 'Measurement' ? [r.op1.re, r.op2.re] : [r.re, 0];
      expect(value).toBeCloseTo(exact, 8);
      expect(Number.isFinite(error)).toBe(true);
    });
  });

  describe('.N() route (iterated)', () => {
    test('a divergent inner level is not laundered into a Measurement', () => {
      const local = new ComputeEngine();
      const r = local
        .box([
          'Integrate',
          ['Divide', 1, 'x'],
          ['Limits', 'y', 0, 1],
          ['Limits', 'x', 0, 1],
        ])
        .N();
      expect(r.operator).not.toBe('Measurement');
      expect(Number.isFinite(r.re)).toBe(false);
    });

    test('a convergent iterated integral is unaffected', () => {
      // ∫₀¹∫₀¹ dx dy /√x = 2.
      const local = new ComputeEngine();
      const r = local
        .box([
          'Integrate',
          ['Divide', 1, ['Sqrt', 'x']],
          ['Limits', 'y', 0, 1],
          ['Limits', 'x', 0, 1],
        ])
        .N();
      expect(r.operator).toBe('Measurement');
      expect(r.op1.re).toBeCloseTo(2, 8);
    });
  });

  describe('compiled route (`_SYS.integrate`)', () => {
    // An integrand with NO elementary antiderivative, so the compiler emits a
    // quadrature call instead of folding to a closed form (a closed-form
    // `∫dx/x` compiles to `ln y − ln 0` and reports `Infinity` without ever
    // reaching `_SYS.integrate`).
    test('a divergent integrand returns NaN, not a plausible number', () => {
      const r = compileReal('\\int_0^y \\frac{e^{-x^2}}{x}\\,dx');
      expect(r.code).toContain('_SYS.integrate');
      expect(Number.isNaN(r.run({ y: 1 }) as number)).toBe(true);
      // Power-divergent, same route.
      const r2 = compileReal('\\int_0^y \\frac{e^{-x^2}}{x^2}\\,dx');
      expect(Number.isNaN(r2.run({ y: 1 }) as number)).toBe(true);
    });

    test('a convergent endpoint singularity still integrates', () => {
      // ∫₀¹ e^(−x²)/√x dx = 2∫₀¹ e^(−t⁴) dt = 1.6896771895142… (independent
      // composite-Simpson check on the desingularized x = t² substitution).
      const r = compileReal('\\int_0^y \\frac{e^{-x^2}}{\\sqrt{x}}\\,dx');
      expect(r.code).toContain('_SYS.integrate');
      expect(r.run({ y: 1 }) as number).toBeCloseTo(1.6896771895142, 9);
    });
  });
});
