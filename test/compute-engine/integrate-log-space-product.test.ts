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
    const latex = '\\int_0^\\infty x^{100} e^{-x}\\,dx';
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
      ce.parse('\\int_0^1 \\int_0^\\infty x^{100} e^{-x} y\\, dx\\, dy')
    ) as unknown as { run: () => number };
    expect(Math.abs(nested.run() / (factorial(100) / 2) - 1)).toBeLessThan(
      1e-9
    );
  });
});
