import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { logSpaceProduct } from '../../src/compute-engine/symbolic/log-space-product';

// ROADMAP CE-394. `∫₀^∞ xⁿ·e⁻ˣ dx = n!`. The integrand `xⁿ·e⁻ˣ` is
// `∞·0 = NaN` in double precision past `x ≈ 1200` (n = 100), the quadrature
// of the `NaN` tail did not converge, and Monte Carlo gave about `10¹¹²` for
// `100! ≈ 9.3·10¹⁵⁷`. The samples that are not finite are computed again in
// log space, `exp(n·ln x − x)`, on the interpreter and in compiled code.

const ce = new ComputeEngine();

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

const integrand = (n: number): any => [
  'Multiply',
  ['Power', 'x', n],
  ['Exp', ['Negate', 'x']],
];

describe('an integrand that is a product overflowing against itself', () => {
  test.each([20, 100, 150])('∫₀^∞ x^%i·e⁻ˣ dx is n! on every route', (n) => {
    const exact = factorial(n);
    const N = ce
      .box(['Integrate', integrand(n), ['Tuple', 'x', 0, 'PositiveInfinity']])
      .N();
    expect(Math.abs(N.re / exact - 1)).toBeLessThan(1e-9);
    const NIntegrate = ce
      .box([
        'NIntegrate',
        ['Function', integrand(n), 'x'],
        0,
        'PositiveInfinity',
      ])
      .evaluate();
    expect(Math.abs(NIntegrate.re / exact - 1)).toBeLessThan(1e-9);
    const compiled = compile(
      ce.parse(`\\int_0^\\infty x^{${n}} e^{-x}\\,dx`)
    ) as unknown as { success: boolean; run: () => number };
    expect(compiled.success).toBe(true);
    expect(Math.abs(compiled.run() / exact - 1)).toBeLessThan(1e-9);
  });

  test('∫₀^y x¹⁰⁰·e⁻ˣ dx compiles to its value, not to the closed form that cancels', () => {
    // The closed form n! − e⁻ʸ·Σ n!/k!·yᵏ (CE-1282) gave −1.2·10¹⁴² at
    // y = 20 and NaN at y = 1500 in double precision (CE-1310).
    // The reference is the series e⁻ʸ·yⁿ⁺¹·Σₖ yᵏ/((n+1)…(n+1+k)).
    const lowerGamma = (n: number, y: number): number => {
      let term = 1 / (n + 1);
      let sum = term;
      for (let k = 1; k < 2000; k++) {
        term *= y / (n + 1 + k);
        sum += term;
      }
      return Math.exp(-y + (n + 1) * Math.log(y)) * sum;
    };
    const f = compile(
      ce.box([
        'Function',
        ['Integrate', integrand(100), ['Limits', 'x', 0, 'y']],
        ['Typed', 'y', "'real'"],
      ])
    ) as unknown as { success: boolean; run: (y: number) => number };
    expect(f.success).toBe(true);
    for (const y of [1, 20, 120]) {
      const expected = lowerGamma(100, y);
      expect(Math.abs(f.run(y) / expected - 1)).toBeLessThan(1e-9);
    }
    expect(Math.abs(f.run(1500) / factorial(100) - 1)).toBeLessThan(1e-9);

    // The same product through a user function: in its body, split across
    // a call, or with the degree as an argument. `evaluate()` inlines the
    // calls, and the closed form is not compiled either.
    const ce2 = new ComputeEngine();
    const define = (name: string, body: unknown, ...params: string[]) =>
      ce2
        .box(['Assign', name, ['Function', body, ...params]] as never)
        .evaluate();
    define('g', [
      'Multiply',
      ['Power', 't', 100],
      ['Exp', ['Negate', 't']],
    ], 't');
    define('w', ['Exp', ['Negate', 't']], 't');
    define(
      'G',
      ['Multiply', ['Power', 't', 'n'], ['Exp', ['Negate', 't']]],
      't',
      'n'
    );
    for (const body of [
      ['g', 'x'],
      ['Multiply', ['Power', 'x', 100], ['w', 'x']],
      ['G', 'x', 100],
    ]) {
      const g = compile(
        ce2.box([
          'Function',
          ['Integrate', body, ['Limits', 'x', 0, 'y']],
          ['Typed', 'y', "'real'"],
        ] as never)
      ) as unknown as { success: boolean; run: (y: number) => number };
      expect(g.success).toBe(true);
      expect(Math.abs(g.run(20) / lowerGamma(100, 20) - 1)).toBeLessThan(1e-9);
    }
  });

  test('an integral larger than the doubles can hold is NaN, not a random value', () => {
    // `170! ≈ 7·10³⁰⁶`: the change of variable of the quadrature overflows.
    const N = ce
      .box(['Integrate', integrand(170), ['Tuple', 'x', 0, 'PositiveInfinity']])
      .N();
    expect(N.isNaN).toBe(true);
  });

  test('the log-space form is the same function', () => {
    for (const latex of [
      'x^{100} e^{-x}',
      '-3 x^{7} e^{-2x}',
      '\\frac{x^{20.5} e^{-x/2}}{5}',
      '\\sin(x) e^{-x}',
    ]) {
      const f = ce.parse(latex);
      const g = logSpaceProduct(f, ['x'])!;
      expect(g).toBeDefined();
      for (const x of [0.5, 2, 7.25]) {
        const a = f.subs({ x }).N().re;
        const b = g.subs({ x }).N().re;
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-12 * Math.abs(a));
      }
    }
    // Not a product with an exponential that decays or grows: no form.
    expect(logSpaceProduct(ce.parse('x^2'), ['x'])).toBeUndefined();
    expect(logSpaceProduct(ce.parse('e^{-x}'), ['x'])).toBeUndefined();
    expect(logSpaceProduct(ce.parse('3 e^{-x}'), ['x'])).toBeUndefined();
  });

  test('the fallback is not used for an integrand with an effect, or with a caller mapping', () => {
    // `x^{100.5}`, not `x^{100}`: `∫ xⁿ·e⁻ˣ dx` has a closed form for an
    // integer n, and its definite integral compiles to a constant.
    const latex = '\\int_0^\\infty x^{100.5} e^{-x}\\,dx';
    // Compiled with the built-in operators: the fallback is emitted.
    const plain = compile(ce.parse(latex)) as unknown as { code: string };
    expect(plain.code).toContain('_SYS.finiteOr');
    // `Ln` mapped by the caller: the log-space form would call it, so the
    // fallback is not emitted.
    const mapped = compile(ce.parse(latex), {
      functions: { Ln: (x: number) => Math.log(x) },
    } as any) as unknown as { code: string };
    expect(mapped.code).not.toContain('_SYS.finiteOr');
    // A nested integral takes the fallback at its innermost level.
    const nested = compile(
      ce.parse('\\int_0^1 \\int_0^\\infty x^{100.5} e^{-x} y\\, dx\\, dy')
    ) as unknown as { run: () => number };
    const gamma = ce.box(['Gamma', 101.5]).N().re;
    expect(Math.abs(nested.run() / (gamma / 2) - 1)).toBeLessThan(1e-9);
  });
});

describe('the exact value of ∫₀^y x¹⁰⁰·e⁻ˣ dx at a finite y (CE-1311)', () => {
  // The closed form n! − e⁻ʸ·Σ n!/k!·yᵏ is exact, but `.N()` of it subtracts
  // two terms of about 9.3·10¹⁵⁷ at 21 digits and gave 0. Above degree 8 a
  // definite integral with a bound other than 0 or ±∞ stays unevaluated, so
  // `.N()` takes the quadrature.
  const I = (n: number, upper: unknown) =>
    ce.box(['Integrate', integrand(n), ['Limits', 'x', 0, upper]] as any);

  test('degree 100 to 20 stays unevaluated, and its numeric value is right', () => {
    const exact = I(100, 20).evaluate();
    expect(exact.operator).toBe('Integrate');
    expect(Math.abs(exact.N().re / 6.4321579720555e120 - 1)).toBeLessThan(
      1e-9
    );
  });

  test('a small exact bound is not taken as 0', () => {
    const tiny = ['Divide', 1, ['Power', 10, 12]];
    expect(I(10, tiny).evaluate().operator).toBe('Integrate');
  });

  test('degree 8 to 2 keeps its closed form', () => {
    expect(I(8, 2).evaluate().has('Integrate')).toBe(false);
  });

  test('degree 10 to ∞ is still 10!', () => {
    expect(I(10, 'PositiveInfinity').evaluate().toString()).toBe('3628800');
  });
});
