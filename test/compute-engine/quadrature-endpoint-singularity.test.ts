import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';
import { resolveSingularEndpoints } from '../../src/compute-engine/numerics/endpoint-quadrature';

// A slowly integrable singularity at an endpoint. A large part of the
// integral is closer to the bound than a double can be (∫₀^δ x^(−0.999) dx is
// about 500 for δ = 1e-300), so the adaptive Gauss–Kronrod quadrature alone
// gave `508.24896298688 ± 0.00000000053` for ∫₀¹ x^(−0.999) dx = 1000. The
// integral over that part is now found by the extrapolation of the shells of
// the corner panel (`endpoint-quadrature.ts`).
//
// Each case runs four ways: `Integrate(…).N()` and `NIntegrate`, with an
// integrand that compiles and with an integrand that does not (an operator
// declared with only a JavaScript `evaluate` handler).

const ce = new ComputeEngine();
let calls = 0;

type Case = {
  name: string;
  fn: (x: number) => number;
  body: unknown;
  lower: unknown;
  upper: unknown;
  exact: number;
  /** The largest accepted error. */
  accuracy: number;
  /** The compiled `.N()` and `NIntegrate` can also give `NaN`. */
  compiledMayBeNaN?: boolean;
  /** The largest number of evaluations of an interpreted integrand
   * (default 11000). */
  maxCalls?: number;
};

const x = 'x';
const cases: Case[] = [
  {
    name: '∫₀¹ x^(−0.999) dx = 1000',
    fn: (x) => x ** -0.999,
    body: ['Power', x, -0.999],
    lower: 0,
    upper: 1,
    exact: 1000,
    accuracy: 1e-6,
  },
  {
    name: '∫₀¹ x^(−0.99) dx = 100',
    fn: (x) => x ** -0.99,
    body: ['Power', x, -0.99],
    lower: 0,
    upper: 1,
    exact: 100,
    accuracy: 1e-8,
  },
  {
    name: '∫₀^½ 1/(x·ln²x) dx = 1/ln 2',
    fn: (x) => 1 / (x * Math.log(x) ** 2),
    body: ['Divide', 1, ['Multiply', x, ['Power', ['Ln', x], 2]]],
    lower: 0,
    upper: 0.5,
    exact: 1 / Math.LN2,
    accuracy: 1e-10,
  },
  {
    // The shells decrease as `1/k³`: the ε-algorithm does not find their
    // limit, and two of its orders agreed on a value off by 1.7e-7 with an
    // error of 1.2e-8 (`1.040684324 ± 0.000000012`). Only the Levin
    // u-transform is used for such shells.
    name: '∫₀^½ 1/(x·(−ln x)³) dx = 1/(2·ln²2)',
    fn: (x) => 1 / (x * (-Math.log(x)) ** 3),
    body: ['Divide', 1, ['Multiply', x, ['Power', ['Negate', ['Ln', x]], 3]]],
    lower: 0,
    upper: 0.5,
    exact: 1 / (2 * Math.LN2 ** 2),
    accuracy: 1e-7,
  },
  {
    name: '∫₀^½ 1/(x·(−ln x)⁴) dx = 1/(3·ln³2)',
    fn: (x) => 1 / (x * (-Math.log(x)) ** 4),
    body: ['Divide', 1, ['Multiply', x, ['Power', ['Negate', ['Ln', x]], 4]]],
    lower: 0,
    upper: 0.5,
    exact: 1 / (3 * Math.LN2 ** 3),
    accuracy: 1e-8,
  },
  {
    // The shells of the compiled quadrature (1500 panels) read as divergent
    // (`shellsDiverge`), so the compiled integrand gives `NaN`. It must never
    // give a wrong value with a tight bound.
    name: '∫₀¹ t^(−0.995)·ln t dt = −40000',
    fn: (t) => t ** -0.995 * Math.log(t),
    body: ['Multiply', ['Power', x, -0.995], ['Ln', x]],
    lower: 0,
    upper: 1,
    exact: -40000,
    accuracy: 1e-3,
    compiledMayBeNaN: true,
  },
  {
    name: '∫₀¹ (1 − t)^(−0.95)·ln(1 − t) dt = −400',
    fn: (t) => (1 - t) ** -0.95 * Math.log(1 - t),
    body: [
      'Multiply',
      ['Power', ['Subtract', 1, x], -0.95],
      ['Ln', ['Subtract', 1, x]],
    ],
    lower: 0,
    upper: 1,
    exact: -400,
    accuracy: 1e-5,
  },
  {
    name: '∫₀¹ (1 − t)^(−0.95)·ln(10⁻⁶·(1 − t)) dt = 20·ln(10⁻⁶) − 400',
    fn: (t) => (1 - t) ** -0.95 * Math.log(1e-6 * (1 - t)),
    body: [
      'Multiply',
      ['Power', ['Subtract', 1, x], -0.95],
      ['Ln', ['Multiply', 1e-6, ['Subtract', 1, x]]],
    ],
    lower: 0,
    upper: 1,
    exact: 20 * Math.log(1e-6) - 400,
    accuracy: 1e-5,
  },
  {
    name: '∫₀¹ 1/√(1 − x²) dx = π/2',
    fn: (x) => 1 / Math.sqrt(1 - x * x),
    body: ['Divide', 1, ['Sqrt', ['Subtract', 1, ['Power', x, 2]]]],
    lower: 0,
    upper: 1,
    exact: Math.PI / 2,
    accuracy: 1e-12,
  },
  {
    name: '∫₀¹ 1/√(x·(1 − x)) dx = π (both endpoints)',
    fn: (x) => 1 / Math.sqrt(x * (1 - x)),
    body: ['Divide', 1, ['Sqrt', ['Multiply', x, ['Subtract', 1, x]]]],
    lower: 0,
    upper: 1,
    exact: Math.PI,
    accuracy: 1e-12,
  },
  {
    name: '∫₁^∞ x^(−1.01) dx = 100',
    fn: (x) => x ** -1.01,
    body: ['Power', x, -1.01],
    lower: 1,
    upper: 'PositiveInfinity',
    exact: 100,
    accuracy: 1e-7,
  },
  {
    name: '∫₁⁰ x^(−0.99) dx = −100 (reversed bounds)',
    fn: (x) => x ** -0.99,
    body: ['Power', x, -0.99],
    lower: 1,
    upper: 0,
    exact: -100,
    accuracy: 1e-8,
  },
  // Integrals that were already correct must stay correct.
  {
    name: '∫₀³ cos(20x) dx = sin(60)/20',
    fn: (x) => Math.cos(20 * x),
    body: ['Cos', ['Multiply', 20, x]],
    lower: 0,
    upper: 3,
    exact: Math.sin(60) / 20,
    accuracy: 1e-13,
  },
  {
    // The oscillatory quadrature now adds the sliver it skips at 0: the
    // value was π/2 − 1e-8, 40 times the reported error.
    name: '∫₀^∞ sin x/x dx = π/2',
    fn: (x) => Math.sin(x) / x,
    body: ['Divide', ['Sin', x], x],
    lower: 0,
    upper: 'PositiveInfinity',
    exact: Math.PI / 2,
    accuracy: 1e-9,
  },
  {
    name: '∫ e^(−x²) dx = √π',
    fn: (x) => Math.exp(-x * x),
    body: ['Exp', ['Negate', ['Power', x, 2]]],
    lower: 'NegativeInfinity',
    upper: 'PositiveInfinity',
    exact: Math.sqrt(Math.PI),
    accuracy: 1e-13,
  },
  {
    name: '∫₀¹ x^(−½) dx = 2',
    fn: (x) => 1 / Math.sqrt(x),
    body: ['Power', x, ['Rational', -1, 2]],
    lower: 0,
    upper: 1,
    exact: 2,
    accuracy: 1e-10,
  },
  {
    // The first lobe of the oscillatory quadrature is integrated from 0 by
    // the adaptive quadrature: it was integrated by adaptive Simpson from
    // 1e-8, and the sliver [0, 1e-8] by the midpoint rule, which gave
    // `2.50658840820 ± 0.00000000013` (true error 4.0e-5).
    name: '∫₀^∞ sin x/x^1.5 dx = √(2π)',
    fn: (x) => Math.sin(x) / x ** 1.5,
    body: ['Divide', ['Sin', x], ['Power', x, 1.5]],
    lower: 0,
    upper: 'PositiveInfinity',
    exact: Math.sqrt(2 * Math.PI),
    accuracy: 1e-9,
  },
  {
    name: '∫₀^∞ sin x/√x dx = √(π/2)',
    fn: (x) => Math.sin(x) / Math.sqrt(x),
    body: ['Divide', ['Sin', x], ['Sqrt', x]],
    lower: 0,
    upper: 'PositiveInfinity',
    exact: Math.sqrt(Math.PI / 2),
    accuracy: 1e-9,
    // The lobes decrease like `1/√x`: the lobes after the first take about
    // 13300 evaluations before the accelerated sums converge.
    maxCalls: 15000,
  },
  {
    // Reversed bounds: the infinite LOWER bound was read as −∞, which gave
    // +π/2.
    name: '∫_∞^0 sin x/x dx = −π/2 (reversed bounds)',
    fn: (x) => Math.sin(x) / x,
    body: ['Divide', ['Sin', x], x],
    lower: 'PositiveInfinity',
    upper: 0,
    exact: -Math.PI / 2,
    accuracy: 1e-9,
  },
  {
    // A smooth integrand with a narrow peak at a bound. The adaptive
    // quadrature converges; tanh-sinh (with fewer evaluations) does not, and
    // its value was taken as evidence against the converged result. The
    // shells, which double toward the peak, were then extrapolated to the
    // antilimit −0.99999999977.
    name: '∫₀¹ dx/(10⁻¹² + x²) = 10⁶·arctan(10⁶)',
    fn: (x) => 1 / (1e-12 + x * x),
    body: ['Divide', 1, ['Add', 1e-12, ['Power', x, 2]]],
    lower: 0,
    upper: 1,
    exact: 1e6 * Math.atan(1e6),
    accuracy: 1e-6,
  },
  {
    name: '∫₀¹ dx/(10⁻¹⁶ + x²) = 10⁸·arctan(10⁸)',
    fn: (x) => 1 / (1e-16 + x * x),
    body: ['Divide', 1, ['Add', 1e-16, ['Power', x, 2]]],
    lower: 0,
    upper: 1,
    exact: 1e8 * Math.atan(1e8),
    accuracy: 1e-5,
  },
  {
    // `∫₀¹ cos x/(ε² + x²) dx = arctan(1/ε)/ε + 1 − cos 1 − Si(1) + πε/4 +
    // O(ε²)` for `ε = 10⁻⁶`: the integral of `(cos x − 1)/x²` is
    // `1 − cos 1 − Si(1)`, and the term `πε/4` is the correction of
    // `(cos x − 1)·(1/(ε² + x²) − 1/x²)`. Si(1) = 0.9460830703671830.
    name: '∫₀¹ cos x/(10⁻¹² + x²) dx',
    fn: (x) => Math.cos(x) / (1e-12 + x * x),
    body: ['Divide', ['Cos', x], ['Add', 1e-12, ['Power', x, 2]]],
    lower: 0,
    upper: 1,
    exact:
      1e6 * Math.atan(1e6) +
      1 -
      Math.cos(1) -
      0.946083070367183 +
      (Math.PI * 1e-6) / 4,
    accuracy: 1e-5,
  },
  {
    // A converged result of a smooth integrand stays converged: tanh-sinh
    // did not converge, the shells do not shrink, and the result became
    // `13.82 ± 0.14` (330 panels) or got an error of 8.96e13 (100 panels).
    name: '∫₀¹ dx/(10⁻⁶ + x) = ln(10⁶ + 1)',
    fn: (x) => 1 / (1e-6 + x),
    body: ['Divide', 1, ['Add', 1e-6, x]],
    lower: 0,
    upper: 1,
    exact: Math.log1p(1e6),
    accuracy: 1e-9,
  },
  {
    // The absolute tolerance is scaled down for a small integrand: the
    // fixed 1e-12 made this "converged" at `9.76e-300 ± 8.1e-300`.
    name: '∫₀¹ 10⁻³⁰⁰·x^(−0.999) dx = 10⁻²⁹⁷',
    fn: (x) => 1e-300 * x ** -0.999,
    body: ['Multiply', 1e-300, ['Power', x, -0.999]],
    lower: 0,
    upper: 1,
    exact: 1e-297,
    accuracy: 1e-305,
  },
  {
    name: '∫₀^∞ e^(−x)·ln x dx = −γ',
    fn: (x) => Math.exp(-x) * Math.log(x),
    body: ['Multiply', ['Exp', ['Negate', x]], ['Ln', x]],
    lower: 0,
    upper: 'PositiveInfinity',
    exact: -0.5772156649015329,
    accuracy: 1e-12,
  },
];

cases.forEach((c, i) =>
  ce.declare(`Opaque${i}`, {
    signature: '(number) -> number',
    evaluate: ([v], { engine }) => {
      if (!v.isNumberLiteral) return undefined;
      calls += 1;
      return engine.number(c.fn(v.re));
    },
  })
);

function integrandOf(i: number, compiled: boolean): unknown {
  return compiled ? cases[i].body : [`Opaque${i}`, x];
}

/** `.N()` of `Integrate`: the value and the reported error. */
function integrateN(
  i: number,
  compiled: boolean
): { value: number; error: number } {
  const c = cases[i];
  calls = 0;
  const r: Expression = ce
    .box([
      'Integrate',
      integrandOf(i, compiled),
      ['Limits', x, c.lower, c.upper],
    ] as any)
    .N();
  if (r.operator !== 'Measurement') return { value: r.re, error: 0 };
  const [v, e] = r.ops!;
  return { value: v.re, error: e.re };
}

function nIntegrate(i: number, compiled: boolean): number {
  const c = cases[i];
  calls = 0;
  return ce
    .box([
      'NIntegrate',
      ['Function', integrandOf(i, compiled), x],
      c.lower,
      c.upper,
    ] as any)
    .evaluate().re;
}

describe.each([
  ['compiled', true],
  ['interpreted', false],
])('a singular endpoint, %s integrand', (_label, compiled) => {
  cases.forEach((c, i) => {
    test(`.N(): ${c.name}`, () => {
      const r = integrateN(i, compiled);
      if (compiled && c.compiledMayBeNaN && Number.isNaN(r.value)) return;
      const trueError = Math.abs(r.value - c.exact);
      expect(trueError).toBeLessThanOrEqual(c.accuracy);
      // The reported error covers the true error.
      expect(trueError).toBeLessThanOrEqual(
        Math.max(r.error, 4 * Number.EPSILON * Math.abs(c.exact))
      );
      // An interpreted integrand stays within about 1e4 evaluations for
      // each part.
      if (!compiled) expect(calls).toBeLessThanOrEqual(c.maxCalls ?? 11000);
    });

    test(`NIntegrate: ${c.name}`, () => {
      const v = nIntegrate(i, compiled);
      if (compiled && c.compiledMayBeNaN && Number.isNaN(v)) return;
      expect(Math.abs(v - c.exact)).toBeLessThanOrEqual(c.accuracy);
    });
  });
});

describe('a divergent integral is still found', () => {
  // The extrapolation runs only after the divergence test of the shells: a
  // pole at an endpoint gives `+∞` (the sign comes from the pole check at
  // the bound), never a finite extrapolated value.
  test.each([
    ['∫₀¹ t⁻² dt', ['Power', x, -2], 0, 1],
    ['∫₀¹ dt/t', ['Divide', 1, x], 0, 1],
    ['∫₀^{π/2} tan t dt', ['Tan', x], 0, ['Divide', 'Pi', 2]],
  ])('%s is +∞', (_name, body, lower, upper) => {
    const r = ce
      .box(['Integrate', body, ['Limits', x, lower, upper]] as any)
      .N();
    expect(r.isInfinity).toBe(true);
    expect(r.isPositive).toBe(true);
  });

  test('∫₁^∞ dt/t has no finite value', () => {
    const r = ce
      .box([
        'Integrate',
        ['Divide', 1, x],
        ['Limits', x, 1, 'PositiveInfinity'],
      ] as any)
      .N();
    expect(Number.isFinite(r.re)).toBe(false);
  });

  test('∫₀¹ dt/(1 − t), a pole at a nonzero bound, has no finite value', () => {
    // The shells next to 1 do not shrink: the integral is reported
    // divergent, not extrapolated.
    const r = ce
      .box([
        'Integrate',
        ['Divide', 1, ['Subtract', 1, x]],
        ['Limits', x, 0, 1],
      ] as any)
      .N();
    expect(Number.isFinite(r.re)).toBe(false);
  });
});

describe('an iterated integral with a singular endpoint', () => {
  // The value and the reported error of `.N()` of an iterated integral.
  const iterated = (body: unknown, ...limits: unknown[][]) => {
    const r: Expression = ce
      .box(['Integrate', body, ...limits.map((l) => ['Limits', ...l])] as any)
      .N();
    if (r.operator !== 'Measurement') return { value: r.re, error: 0 };
    const [v, e] = r.ops!;
    return { value: v.re, error: e.re };
  };

  // The nodes of the level with the singularity are packed next to the
  // bound, where the inner values and their errors are huge. The error of
  // the inner levels was averaged over the nodes and multiplied by the
  // range, which gave `0 ± 1.3e+289` for an integral of 2000.
  test.each([
    ['∫₀² ∫₀¹ y^(−0.999) dy dx = 2000', ['Power', 'y', -0.999], 2000, 1e-6],
    ['∫₀² ∫₀¹ y^(−½) dy dx = 4', ['Power', 'y', -0.5], 4, 1e-9],
    [
      '∫₀² ∫₀¹ −y^(−0.999) dy dx = −2000',
      ['Negate', ['Power', 'y', -0.999]],
      -2000,
      1e-6,
    ],
  ])('%s', (_name, body, exact, accuracy) => {
    for (const limits of [
      [
        ['y', 0, 1],
        ['x', 0, 2],
      ],
      [
        ['x', 0, 2],
        ['y', 0, 1],
      ],
    ]) {
      const r = iterated(body, ...limits);
      const trueError = Math.abs(r.value - exact);
      expect(trueError).toBeLessThanOrEqual(accuracy);
      expect(trueError).toBeLessThanOrEqual(Math.max(r.error, 1e-12));
      expect(r.error).toBeLessThanOrEqual(accuracy);
    }
  });

  test('∫₀⁶ ∫₀¹ sin(x)·y^(−½) dy dx = 2·(1 − cos 6)', () => {
    const r = iterated(
      ['Multiply', ['Sin', 'x'], ['Power', 'y', -0.5]],
      ['y', 0, 1],
      ['x', 0, 6]
    );
    expect(Math.abs(r.value - 2 * (1 - Math.cos(6)))).toBeLessThanOrEqual(
      1e-10
    );
    expect(r.error).toBeLessThanOrEqual(1e-9);
  });

  test('a level that does not converge reports at least the Monte-Carlo error', () => {
    // ∫₀¹ sin(1/y) dy = sin 1 − Ci(1) does not converge in the panel budget
    // of a nested level, and its result is kept. Its error is at least
    // `|estimate|/√1e4`, the standard error of the 1e4-sample Monte-Carlo
    // estimate it replaces, as for a one-limit integral. Ci(1) =
    // 0.337403922900968.
    const exact = 2 * (Math.sin(1) - 0.337403922900968);
    for (const limits of [
      [
        ['y', 0, 1],
        ['x', 0, 2],
      ],
      [
        ['x', 0, 2],
        ['y', 0, 1],
      ],
    ]) {
      const r = iterated(['Sin', ['Divide', 1, 'y']], ...limits);
      expect(Math.abs(r.value - exact)).toBeLessThanOrEqual(1e-5);
      expect(r.error).toBeGreaterThanOrEqual(0.01 * Math.abs(exact) * 0.999);
    }
  });

  test('a smooth iterated integral is unchanged', () => {
    const r = iterated(
      ['Add', ['Square', 'x'], ['Square', 'y']],
      ['x', 0, 2],
      ['y', 1, 3]
    );
    expect(Math.abs(r.value - 68 / 3)).toBeLessThanOrEqual(1e-12);
    expect(r.error).toBeLessThanOrEqual(1e-12);
    const p = iterated(['Multiply', 'x', 'y'], ['x', 0, 2], ['y', 1, 3]);
    expect(Math.abs(p.value - 8)).toBeLessThanOrEqual(1e-12);
  });

  test('a divergent inner level is +∞', () => {
    const r = ce
      .box([
        'Integrate',
        ['Power', 'y', -2],
        ['Limits', 'y', 0, 1],
        ['Limits', 'x', 0, 2],
      ] as any)
      .N();
    expect(r.toString()).toBe('+oo');
  });
});

describe('an integral with no value is not given a value', () => {
  // The shells of `sin(ln t)/t` at 0 oscillate with a constant amplitude:
  // the integral has no value. The extrapolation of their partial sums gave
  // `−1.0000000000 ± 4.2e-10` (330 panels) or `−1.0876274586 ± 1.4e-9` (1500
  // panels). `antilimits` are the values that were returned.
  const cases: [
    string,
    (t: number) => number,
    unknown,
    number,
    number | string,
    number[],
  ][] = [
    [
      '∫₀¹ sin(ln t)/t dt',
      (t) => Math.sin(Math.log(t)) / t,
      ['Divide', ['Sin', ['Ln', x]], x],
      0,
      1,
      [-1, -1.0876274586393595],
    ],
    [
      '∫₀¹ cos(ln t)/t dt',
      (t) => Math.cos(Math.log(t)) / t,
      ['Divide', ['Cos', ['Ln', x]], x],
      0,
      1,
      [0],
    ],
    [
      '∫₀¹ sin(ln(1 − t))/(1 − t) dt',
      (t) => Math.sin(Math.log(1 - t)) / (1 - t),
      ['Divide', ['Sin', ['Ln', ['Subtract', 1, x]]], ['Subtract', 1, x]],
      0,
      1,
      [-1],
    ],
    [
      '∫₁^∞ sin(ln x)/x dx',
      (t) => Math.sin(Math.log(t)) / t,
      ['Divide', ['Sin', ['Ln', x]], x],
      1,
      'PositiveInfinity',
      [1],
    ],
    [
      '∫₀¹ sin(3·ln t)/t dt',
      (t) => Math.sin(3 * Math.log(t)) / t,
      ['Divide', ['Sin', ['Multiply', 3, ['Ln', x]]], x],
      0,
      1,
      [-1 / 3],
    ],
    [
      '∫₀¹ sin(ln t)/t^1.01 dt',
      (t) => Math.sin(Math.log(t)) / t ** 1.01,
      ['Divide', ['Sin', ['Ln', x]], ['Power', x, 1.01]],
      0,
      1,
      [-0.99990001],
    ],
    [
      // The extrapolations agreed on `−2.2e13` with an error of `2.8e17`.
      '∫₀¹ sin(ln t)/t^1.1 dt',
      (t) => Math.sin(Math.log(t)) / t ** 1.1,
      ['Divide', ['Sin', ['Ln', x]], ['Power', x, 1.1]],
      0,
      1,
      [-0.990099, -2.2e13],
    ],
  ];

  test.each(cases)(
    '%s: the quadrature does not converge',
    (_name, fn, _body, lower, upper) => {
      const b = upper === 'PositiveInfinity' ? Infinity : (upper as number);
      for (const maxIntervals of [100, 330, 1500]) {
        const r = adaptiveQuadrature(fn, lower, b, {
          maxIntervals,
          singularEndpoints: true,
        });
        expect(r.extrapolated).not.toBe(true);
        expect(r.converged).toBe(false);
        if (!r.divergent)
          expect(r.error).toBeGreaterThanOrEqual(
            0.1 * Math.max(1, Math.abs(r.estimate))
          );
      }
    }
  );

  cases.forEach(([, fn], i) =>
    ce.declare(`NoValue${i}`, {
      signature: '(number) -> number',
      evaluate: ([v], { engine }) =>
        v.isNumberLiteral ? engine.number(fn(v.re)) : undefined,
    })
  );

  // The shells oscillate without shrinking: the quadrature reports that the
  // integral has no value, and `.N()` and `NIntegrate` give `NaN`, with no
  // sign. The Monte-Carlo fallback gave values such as `−1.995 ± 0.037`.
  test.each(cases.map((c, i) => [...c, i] as const))(
    '%s: .N() and NIntegrate have no finite value',
    (_name, _fn, body, lower, upper, antilimits, i) => {
      for (const integrand of [body, [`NoValue${i}`, x]]) {
        const r = ce
          .box(['Integrate', integrand, ['Limits', x, lower, upper]] as any)
          .N();
        expect(Number.isFinite(r.re)).toBe(false);
        const v = ce
          .box(['NIntegrate', ['Function', integrand, x], lower, upper] as any)
          .evaluate().re;
        expect(Number.isFinite(v)).toBe(false);
        for (const a of antilimits) expect(v).not.toBe(a);
      }
    }
  );

  test('compiled ∫₀¹ sin(c·ln t)/t dt has no finite value', () => {
    // The parameter `c` keeps the integral from being folded at compile
    // time, so `_SYS.integrate` runs. It gave `−1.0876274586`.
    const r = compile(
      ce.box([
        'Integrate',
        ['Divide', ['Sin', ['Multiply', 'c', ['Ln', x]]], x],
        ['Limits', x, 0, 1],
      ] as any)
    );
    expect(r.success).toBe(true);
    expect(Number.isFinite(r.run!({ c: 1 }) as number)).toBe(false);
  });
});

describe('the correction of a singular endpoint', () => {
  test('a converged result is kept when tanh-sinh does not converge', () => {
    // 100 panels, 4 starting panels: a nested level of an iterated
    // integral. The result was the antilimit −0.9999999971.
    const r = adaptiveQuadrature((x) => 1 / (1e-8 + x * x), 0, 1, {
      maxIntervals: 100,
      initialPanels: 4,
      singularEndpoints: true,
    });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.estimate - 1e4 * Math.atan(1e4))).toBeLessThan(1e-8);
  });

  test.each([100, 330, 1500])(
    '∫₀¹ dx/(10⁻⁶ + x) stays converged (%i panels)',
    (maxIntervals) => {
      const r = adaptiveQuadrature((x) => 1 / (1e-6 + x), 0, 1, {
        maxIntervals,
        singularEndpoints: true,
      });
      expect(r.converged).toBe(true);
      expect(Math.abs(r.estimate - Math.log1p(1e6))).toBeLessThan(1e-10);
      expect(r.error).toBeLessThan(1e-9);
    }
  );

  test('an unresolved tail with a non-finite estimate is divergent', () => {
    const corner = {
      shells: [],
      shellErrors: [],
      value: 0,
      error: 0,
      width: 1,
      endpoint: 0,
    };
    const r = resolveSingularEndpoints(
      (x) => x,
      0,
      1,
      {
        estimate: Infinity,
        error: Infinity,
        converged: false,
        divergent: false,
        unresolved: true,
        magnitude: Infinity,
        lo: corner,
        hi: corner,
      },
      { rtol: 1e-10, atol: 1e-12, maxEvaluations: 100, deadline: undefined }
    );
    expect(r.divergent).toBe(true);
  });

  test('a pole at a bound of large magnitude has no finite value', () => {
    // Next to 10⁶, the corner panel reaches the spacing of the doubles after
    // 29 bisections, too few for the block ratio of the shells: the
    // quadrature gave `22.7 ± 0.58`.
    const body = ['Divide', 1, ['Subtract', x, 1e6]];
    const r = ce
      .box(['Integrate', body, ['Limits', x, 1e6, 1e6 + 1]] as any)
      .N();
    expect(Number.isFinite(r.re)).toBe(false);
    const v = ce
      .box(['NIntegrate', ['Function', body, x], 1e6, 1e6 + 1] as any)
      .evaluate().re;
    expect(Number.isFinite(v)).toBe(false);
    expect(
      adaptiveQuadrature((x) => 1 / (x - 1e6), 1e6, 1e6 + 1).divergent
    ).toBe(true);
  });

  test('a convergent singularity at a bound of large magnitude is finite', () => {
    // ∫ (x − 10⁶)^(−½) dx = 2 on [10⁶, 10⁶ + 1].
    const r = ce
      .box([
        'Integrate',
        ['Power', ['Subtract', x, 1e6], -0.5],
        ['Limits', x, 1e6, 1e6 + 1],
      ] as any)
      .N();
    const value = r.operator === 'Measurement' ? r.ops![0].re : r.re;
    expect(Math.abs(value - 2)).toBeLessThan(1e-3);
  });
});

describe('a compiled semi-infinite oscillatory integral', () => {
  // `_SYS.integrate` integrates a semi-infinite oscillatory integrand lobe by
  // lobe, as the interpreter does. The integrand has a parameter, so the
  // integral is not folded at compile time. It gave `NaN` for
  // `∫₀^∞ sin x/√x dx` and `2.5237` for `∫₀^∞ sin x/x^1.5 dx`.
  const run = (lower: unknown, upper: unknown, p: number) => {
    const r = compile(
      ce.box([
        'Integrate',
        ['Divide', ['Sin', x], ['Power', x, 'p']],
        ['Limits', x, lower, upper],
      ] as any)
    );
    expect(r.success).toBe(true);
    return r.run!({ p }) as number;
  };
  test.each([
    [0, 'PositiveInfinity', 1.5, Math.sqrt(2 * Math.PI)],
    [0, 'PositiveInfinity', 0.5, Math.sqrt(Math.PI / 2)],
    [0, 'PositiveInfinity', 1, Math.PI / 2],
    ['NegativeInfinity', 0, 1, Math.PI / 2],
    ['PositiveInfinity', 0, 1.5, -Math.sqrt(2 * Math.PI)],
  ])('∫ from %s to %s of sin x/x^%d', (lower, upper, p, exact) => {
    expect(Math.abs(run(lower, upper, p) - exact)).toBeLessThan(1e-9);
  });

  test('a narrow peak at a bound', () => {
    const r = compile(
      ce.box([
        'Integrate',
        ['Divide', 1, ['Add', 'c', ['Power', x, 2]]],
        ['Limits', x, 0, 1],
      ] as any)
    );
    expect(r.success).toBe(true);
    const v = r.run!({ c: 1e-12 }) as number;
    expect(Math.abs(v - 1e6 * Math.atan(1e6))).toBeLessThan(1e-6);
  });
});

describe('a singular corner that is not resolved', () => {
  test('the quadrature result is kept, not replaced by Monte Carlo', () => {
    // ∫₀^0.01 dx/(x·(−ln x)·ln²(−ln x)) = 1/ln(ln 100) = 0.6548…. The shells
    // decrease too slowly for an extrapolation to be accepted. The
    // quadrature gives 0.5028 ± 0.0176, and Monte Carlo gave
    // 0.3220 ± 0.0063 (52 standard errors from the integral) in 2.4 s.
    const f = (x: number) =>
      1 / (x * -Math.log(x) * Math.log(-Math.log(x)) ** 2);
    const q = adaptiveQuadrature(f, 0, 0.01, { singularEndpoints: true });
    expect(q.converged).toBe(false);
    expect(q.singularCorner).toBe(true);
    const r = ce
      .parse('\\int_0^{0.01} \\frac{1}{x(-\\ln x)(\\ln(-\\ln x))^2} dx')
      .N();
    expect(r.operator).toBe('Measurement');
    const [v, e] = r.ops!;
    expect(Math.abs(v.re - q.estimate)).toBeLessThanOrEqual(1e-6);
    expect(e.re).toBeGreaterThanOrEqual(q.error * 0.999);
  });

  // `∫₀^10 ∫₃^4 (y − x)⁻² dx dy`: the inner integral has no value for `y`
  // in `[3, 4]` (the pole `x = y` is in `[3, 4]`). The compiled inner
  // integral drew 1e7 Monte-Carlo samples at each node of the outer
  // quadrature, and `.N()` took more than 200 s. It now gives `NaN` in about
  // 1.6 s (measured with `tsx`). That run takes about 70 times longer under
  // jest, so the tests below check the two parts of the fix on a few nodes.
  test('a compiled inner integral inside a quadrature has no Monte-Carlo fallback', () => {
    const inner = compile(ce.parse('\\int_3^4 (y-x)^{-2} dx'));
    expect(inner.success).toBe(true);
    const values: [number, number][] = [];
    adaptiveQuadrature(
      (y) => {
        const v = inner.run!({ y }) as number;
        values.push([y, v]);
        return v;
      },
      3.4,
      3.6,
      { initialPanels: 1, maxIntervals: 1 }
    );
    expect(values.length).toBe(15);
    // At most nodes, the inner quadrature does not converge and is not
    // better than sampling: with no Monte-Carlo fallback (which never gives
    // `NaN` here), the inner integral has no value. At a node such as
    // `y = 3.5`, the pole is on a boundary of the panels of the inner
    // quadrature, and its result is kept.
    const noValue = values.filter(([, v]) => Number.isNaN(v)).length;
    expect(noValue).toBeGreaterThanOrEqual(5);
  });

  test('a panel with no value inside the interval makes the error infinite', () => {
    // The panels inside `[3, 4]` have no value and the totals skip them.
    // The error of the other panels (0) was reported as the error, so a
    // caller kept the estimate as accurate.
    const r = adaptiveQuadrature((y) => (y >= 3 && y <= 4 ? NaN : 1), 0, 10);
    expect(r.converged).toBe(false);
    expect(r.error).toBe(Infinity);
    // A non-finite value at an isolated point (the center of a starting
    // panel) is still bisected away.
    const p = adaptiveQuadrature(
      (y) => (y === 0.53125 ? NaN : Math.cos(y)),
      0,
      1
    );
    expect(p.converged).toBe(true);
    expect(Math.abs(p.estimate - Math.sin(1))).toBeLessThanOrEqual(1e-14);
  });
});
