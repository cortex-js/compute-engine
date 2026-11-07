import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { divergentTailSign } from '../../src/compute-engine/numerics/divergent-tail';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

// ROADMAP CE-391. An integral that diverges on an infinite tail, with an
// integrand of one sign, is `+∞` or `−∞` under `.N()` and `NIntegrate`, as
// under `evaluate()`. Before, `.N()` gave a Monte-Carlo `Measurement` that
// changed at each run for an integrand that overflows (`eˣ`), and `NaN` for
// a polynomial (`x`).

const ce = new ComputeEngine();

function routes(latex: string, lower: unknown, upper: unknown) {
  const body = ce.parse(latex).json;
  const integral = ce.box([
    'Integrate',
    body,
    ['Tuple', 'x', lower, upper],
  ] as any);
  return {
    evaluate: integral.evaluate().json,
    N: integral.N().json,
    NIntegrate: ce
      .box(['NIntegrate', ['Function', body, 'x'], lower, upper] as any)
      .evaluate().json,
  };
}

describe('a divergent integral over an infinite bound', () => {
  test.each([
    ['e^x', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x e^x', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x^2', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['-x', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['\\frac{1}{x}', 1, 'PositiveInfinity', 'PositiveInfinity'],
    ['\\frac{1}{\\sqrt{x}}', 1, 'PositiveInfinity', 'PositiveInfinity'],
    ['e^x', 'PositiveInfinity', 0, 'NegativeInfinity'],
    ['e^{-x}', 'NegativeInfinity', 0, 'PositiveInfinity'],
    ['x^2', 'NegativeInfinity', 'PositiveInfinity', 'PositiveInfinity'],
  ])('∫ %s from %s to %s is %s on every route', (latex, lo, hi, expected) => {
    const r = routes(latex, lo, hi);
    expect(r.evaluate).toEqual(expected);
    expect(r.N).toEqual(expected);
    expect(r.NIntegrate).toEqual(expected);
  });

  test('an integrand whose sign changes keeps NaN', () => {
    // `x` over the whole line has no value, and `sin x` on [0, ∞) has none.
    expect(routes('x', 'NegativeInfinity', 'PositiveInfinity').N).toEqual(
      'NaN'
    );
    expect(routes('\\sin x', 0, 'PositiveInfinity').N).toEqual('NaN');
  });

  test('a convergent integral with a slowly decaying tail is a number', () => {
    const r = routes('x^{-1.01}', 1, 'PositiveInfinity');
    expect(r.NIntegrate as number).toBeCloseTo(100, 6);
    expect(routes('e^{-x}', 0, 'PositiveInfinity').NIntegrate).toBeCloseTo(
      1,
      10
    );
  });

  test('a tail whose sign changes past 10^20 is not given the sign of its start', () => {
    // `t·(1 − t/10²⁰)` is positive up to 10²⁰ and negative after it: the
    // integral is `−∞`, which the samples cannot decide from the start of
    // the tail alone, so no sign is given.
    expect(divergentTailSign((t) => t * (1 - t / 1e20), 0, Infinity)).toEqual(
      0
    );
    expect(divergentTailSign((t) => t, 0, Infinity)).toEqual(1);
    expect(divergentTailSign((t) => t, Infinity, 0)).toEqual(-1);
    expect(divergentTailSign((t) => t, Infinity, Infinity)).toEqual(0);
  });

  test('the compiled integral gives the same infinity', () => {
    const run = (latex: string): number => {
      const r = compile(ce.parse(latex));
      expect(r.success).toBe(true);
      return (r.run as () => number)();
    };
    expect(run('\\int_0^{\\infty} x\\, dx')).toBe(Infinity);
    expect(run('\\int_0^{\\infty} e^x\\, dx')).toBe(Infinity);
    expect(run('\\int_0^{\\infty} -x\\, dx')).toBe(-Infinity);
    expect(Number.isNaN(run('\\int_0^{\\infty} \\sin x\\, dx'))).toBe(true);
  });

  test.each([
    ['\\frac{x-1}{x^3}', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['-\\frac{1}{x^3}', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['\\frac{1}{x^3}', 'NegativeInfinity', 0, 'NegativeInfinity'],
    ['\\frac{1}{x^3}', 0, 'NegativeInfinity', 'PositiveInfinity'],
    ['-\\frac{1}{x^3}', 'PositiveInfinity', 0, 'PositiveInfinity'],
    ['\\frac{x-1}{x^2}', 0, 'PositiveInfinity', 'NaN'],
  ])(
    'evaluate() of ∫ %s from %s to %s, a pole at the finite bound, is %s',
    (latex, lo, hi, expected) => {
      // ROADMAP CE-391.2: the antiderivative difference is `~∞` (a pole at
      // the finite bound), which was the answer. The sign of the pole and
      // the value of the antiderivative at the infinite bound decide it.
      expect(routes(latex as string, lo, hi).evaluate).toEqual(expected);
    }
  );

  test.each([
    ['x-1', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['1-x', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['\\frac{x-1}{x^3}', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['e^x - 5', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x^2-1', 'NegativeInfinity', 'PositiveInfinity', 'PositiveInfinity'],
    ['\\frac{x-1}{x^2}', 0, 'PositiveInfinity', 'NaN'],
  ])(
    '.N() of ∫ %s from %s to %s, an integrand whose sign changes, is %s',
    (latex, lo, hi, expected) => {
      // ROADMAP CE-391.1: the numeric route found a divergence (or an
      // overflow) it could not sign, and gave `NaN` or a Monte-Carlo value.
      // The exact route decides it, as compiled code already did.
      const r = routes(latex as string, lo, hi);
      expect(r.N).toEqual(expected);
      expect(r.NIntegrate).toEqual(expected);
    }
  );

  test('an overflowing integrand with no sign is NaN, not a random value', () => {
    // `x sin x · e^x` changes sign forever and overflows: no value, and the
    // answer is the same at each run.
    const a = routes('x \\sin(x) e^x', 0, 'PositiveInfinity').N;
    const b = routes('x \\sin(x) e^x', 0, 'PositiveInfinity').N;
    expect(a).toEqual('NaN');
    expect(b).toEqual('NaN');
  });
});

describe('an integrand that decreases slowly at an infinite bound', () => {
  // The quadrature maps `[c, ∞)` to `[0, 1)`, and the doubles near 1 allow
  // only about 48 bisections of the corner panel: too few shells to tell
  // `1/(x ln x)` (divergent) from `1/(x ln^1.1 x)` (convergent). The
  // integral is then computed again with the infinite bound at 0
  // (`quadrature`, `numerics/gauss-kronrod.ts`). Issue CE-182.
  const lnPower = (p: number) => (x: number) => 1 / (x * Math.log(x) ** p);
  // ∫₂^∞ dx/(x lnᵖ x) = (ln 2)^(1 − p)/(p − 1) for p > 1.
  const exact = (p: number) => Math.log(2) ** (1 - p) / (p - 1);

  test('the quadrature finds the divergence of 1/(x ln x)', () => {
    const r = adaptiveQuadrature(lnPower(1), 2, Infinity, {
      singularEndpoints: true,
    });
    expect(r.divergent).toBe(true);
    const left = adaptiveQuadrature(
      (x) => 1 / (x * Math.log(-x)),
      -Infinity,
      -2,
      { singularEndpoints: true }
    );
    expect(left.divergent).toBe(true);
  });

  test('the computation again stays within the panel budget', () => {
    // At most `maxIntervals` panels of 15 nodes, plus the tanh-sinh rule of
    // the one interval (`2·maxIntervals` evaluations) and of each part, and
    // one sample for each octave of `x` that the far part reached.
    let evaluations = 0;
    adaptiveQuadrature(
      (x) => {
        evaluations += 1;
        return lnPower(1.1)(x);
      },
      2,
      Infinity,
      { singularEndpoints: true }
    );
    expect(evaluations).toBeLessThan(1500 * 15 + 3 * 2 * 1500 + 1100);
  });

  test('a tail that decreases to the end of the doubles is trusted', () => {
    // The samples of `x^(−1.5)` are below the normal doubles for
    // x > 2⁶⁸¹: they are not read as an overflow. The one interval gave
    // `0.0063 ± 0.0025`.
    const r = adaptiveQuadrature((x) => x ** -1.5, 1e5, Infinity, {
      singularEndpoints: true,
    });
    expect(r.converged).toBe(true);
    expect(r.estimate).toBeCloseTo(2 / Math.sqrt(1e5), 12);
  });

  test.each([
    // `x⁴` overflows for x > 1.3·10⁷⁷, and the samples there are 0: the
    // far part converged, to `3.94 ± 3·10⁻¹¹` for a true value of about
    // 10.3.
    [
      'x³/((x⁴ + 1) ln^1.1 x)',
      (x: number) => x ** 3 / ((x ** 4 + 1) * Math.log(x) ** 1.1),
    ],
    // `sin x` sampled at nodes much farther apart than its period is noise:
    // the far part of this convergent integral was divergent.
    [
      '(2 + sin x)/(x ln^1.1 x)',
      (x: number) => (2 + Math.sin(x)) / (x * Math.log(x) ** 1.1),
    ],
  ])(
    'the far part of %s is not trusted, and the result keeps its wide error',
    (_, f) => {
      const r = adaptiveQuadrature(f, 2, Infinity, { singularEndpoints: true });
      expect(r.divergent).toBe(false);
      expect(r.converged).toBe(false);
      expect(r.extrapolated).not.toBe(true);
      expect(r.singularCorner).toBe(true);
    }
  );

  test.each([[1.1], [2]])(
    'the quadrature of 1/(x ln^%p x) is within its error of the exact value',
    (p) => {
      const r = adaptiveQuadrature(lnPower(p), 2, Infinity, {
        singularEndpoints: true,
      });
      expect(r.divergent).toBe(false);
      expect(r.extrapolated).toBe(true);
      expect(Math.abs(r.estimate - exact(p))).toBeLessThanOrEqual(r.error);
      // Before, `p = 1.1` gave `3.4 ± 36`.
      expect(r.error).toBeLessThan(1e-3 * exact(p));
    }
  );

  test.each([
    ['\\frac{1}{x\\ln x}', 2, 'PositiveInfinity', 'PositiveInfinity'],
    ['\\frac{1}{x\\ln(-x)}', 'NegativeInfinity', -2, 'NegativeInfinity'],
    ['\\frac{-1}{x\\ln x}', 2, 'PositiveInfinity', 'NegativeInfinity'],
  ])('∫ %s from %s to %s is %s on every route', (latex, lo, hi, expected) => {
    // Before, `.N()` gave `3.97 ± 71060` and `NIntegrate` gave `3.97`.
    const r = routes(latex as string, lo, hi);
    expect(r.evaluate).toEqual(expected);
    expect(r.N).toEqual(expected);
    expect(r.NIntegrate).toEqual(expected);
  });

  test('a divergent half of (−∞, ∞) is found', () => {
    expect(
      routes(
        '\\frac{1}{(|x|+2)\\ln(|x|+2)}',
        'NegativeInfinity',
        'PositiveInfinity'
      ).N
    ).toEqual('PositiveInfinity');
  });

  test('the compiled integral of 1/(x ln^1.1 x) is within its error', () => {
    // The bound `a` is an input, so the integral is computed when the code
    // runs, not folded when it compiles.
    const engine = new ComputeEngine();
    engine.declare('a', 'real');
    const r = compile(
      engine.parse('\\int_a^{\\infty} \\frac{dx}{x(\\ln x)^{1.1}}')
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.integrate(');
    const v = (r.run as (vars: { a: number }) => number)({ a: 2 });
    expect(Math.abs(v - exact(1.1))).toBeLessThan(2e-4);
  });
});

describe('a convergent integral from a large bound to infinity', () => {
  // For a large `c`, the area of `∫_c^∞` is where 1 − t < 1/c, next to the
  // infinite bound t = 1 of the one interval, and its shells look
  // divergent there. A divergent result is computed again with the infinite
  // bound at 0 (`quadrature`, `numerics/gauss-kronrod.ts`). Issue CE-1041.

  test.each([
    ['x^{1.5}', 1e10, 2e-5],
    ['x(\\ln x)^2', 1e6, 1 / Math.log(1e6)],
    ['x^{1.1}', 1e10, 1],
  ])('∫ dx/%s from %s to ∞ is a number', (den, lo, exact) => {
    // Before, `.N()` and `NIntegrate` gave `NaN`.
    const r = routes(`\\frac{1}{${den}}`, lo, 'PositiveInfinity');
    expect(r.NIntegrate as number).toBeCloseTo(exact, 7);
    const n = r.N as unknown as [string, number, number];
    expect(n[0]).toEqual('Measurement');
    expect(Math.abs(n[1] - exact)).toBeLessThanOrEqual(n[2]);
  });

  test('the quadrature of each side is within its error', () => {
    const f = (x: number) => Math.abs(x) ** -1.5;
    for (const [a, b] of [
      [1e10, Infinity],
      [-Infinity, -1e10],
    ]) {
      const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
      expect(r.divergent).toBe(false);
      expect(r.converged).toBe(true);
      expect(Math.abs(r.estimate - 2e-5)).toBeLessThanOrEqual(r.error);
    }
  });

  test.each([
    ['1/x', (x: number) => 1 / x],
    ['1/(x ln x)', (x: number) => 1 / (x * Math.log(x))],
    [
      '1/(x ln x ln ln x)',
      (x: number) => 1 / (x * Math.log(x) * Math.log(Math.log(x))),
    ],
    ['x^(−0.99)', (x: number) => x ** -0.99],
    ['1/(x − 10⁶)', (x: number) => 1 / (x - 1e6)],
  ])('the divergent integral of %s from 10⁶ stays divergent', (_, f) => {
    const r = adaptiveQuadrature(f, 1e6, Infinity, { singularEndpoints: true });
    expect(r.divergent).toBe(true);
  });

  test('without singularEndpoints, a divergent result is not computed again', () => {
    let evaluations = 0;
    const r = adaptiveQuadrature(
      (x) => {
        evaluations += 1;
        return x ** -1.5;
      },
      1e10,
      Infinity
    );
    // The one interval uses 1,750 evaluations; with the split, 6,067.
    expect(r.divergent).toBe(true);
    expect(evaluations).toBeLessThan(2500);
  });
});
