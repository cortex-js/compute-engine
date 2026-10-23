import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Tycho ledger row 428: the normal distribution function, as Desmos users
// write it,
//   E(x) = 1/(√(2π)·s) · ∫_{−∞}^{x} exp(−½·z²/s²) dz,
// had no closed form, so its compiled JavaScript ran a numerical quadrature
// at every call (about 1.3 ms; the document `neyret/gdej6ro5yn` calls it
// 2 469 times for one list and again at every sample of its curve).
//
// Cause: the Gaussian rule of the antiderivative (`tryGaussianIntegral`,
// `symbolic/antiderivative.ts`) selected `Erf` or `Erfi` by the numeric
// value of the leading coefficient of the exponent, and gave up on a
// symbolic one (`−1/(2s²)`). The engine's sign inference cannot sign such a
// coefficient either (`s` may be zero), so the rule now reads the sign as
// written when what remains after the sign is non-negative for every real
// value of the symbols: `1/(2s²)` is, a bare `a` is not. So `e^{−z²/(2s²)}`
// integrates to an `Erf` in `s`, `e^{z²/(2s²)}` to an `Erfi`, and
// `e^{−a z²}` stays unevaluated: read as an `Erf` it would need `Erf` of an
// imaginary argument at `a < 0`, which the compile targets do not have.
//
// The value of the antiderivative at an infinite bound is then
// `Erf((−∞)·√(s⁻²))`, a limit that depends on the parameter. The endpoint
// leak table of `Integrate` (`classifyEndpointLeak`, `library/calculus.ts`)
// resolves it to `−1` under the guard `√(s⁻²) > 0`, the way
// `∫₀^∞ e^{−cx} dx` is `1/c {0 < c}`, so the definite integral is a guarded
// closed form and the compiled function calls `erf`.
//
// Found on the way: the sum handler folded `∞·c + 1` to `+∞` for a `c` of
// unknown sign (it read the coefficient `∞` of the term and ignored `c`),
// which is `−∞` at `c < 0`. Such a term now stays in the sum, and
// `∞·c − ∞·c` is the indeterminate form.

const ce = new ComputeEngine();

const s = 0.577;

// The reference: Erf by its series, summed to 1e-16 (the Abramowitz–Stegun
// approximation is not precise enough for a 1e-9 check).
function erf(t: number): number {
  if (Math.abs(t) > 6) return Math.sign(t);
  let term = t;
  let sum = t;
  for (let n = 1; Math.abs(term) > 1e-17 * Math.abs(sum); n++) {
    term *= (-t * t) / n;
    sum += term / (2 * n + 1);
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

// The normal distribution function with mean `m` and standard deviation `s`.
const normalCdf = (x: number, m = 0): number =>
  0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));

const NORMAL_CDF =
  '\\frac{1}{\\sqrt{2\\pi}s}\\int_{-\\infty}^{x}\\exp\\left(-\\frac{1}{2}\\frac{z^{2}}{s^{2}}\\right)dz';

describe('Tycho row 428: a Gaussian with a symbolic coefficient', () => {
  describe('antiderivative', () => {
    test('∫ exp(−½·z²/s²) dz is an Erf in s', () => {
      const F = ce
        .parse('\\int \\exp\\left(-\\frac{1}{2}\\frac{z^2}{s^2}\\right) dz')
        .evaluate();
      expect(F.toString()).toBe(
        'sqrt(2)/2 * Erf(sqrt(2)/2 * z * sqrt(s^(-2))) * sqrt(pi) * sqrt(s^2)'
      );
      // Its derivative is the integrand: compare at sample points.
      const dF = ce.function('D', [F, ce.symbol('z')]).evaluate();
      for (const z of [-1.5, -0.3, 0, 0.7, 2]) {
        const lhs = dF.subs({ z, s }).N().re;
        const rhs = Math.exp((-0.5 * (z * z)) / (s * s));
        expect(Math.abs(lhs - rhs)).toBeLessThan(1e-12);
      }
    });

    test('∫ exp(z²/(2s²)) dz is an Erfi in s', () => {
      expect(
        ce.parse('\\int \\exp\\left(\\frac{z^2}{2s^2}\\right) dz').evaluate().toString()
      ).toBe(
        'sqrt(2)/2 * Erfi(sqrt(2)/2 * z * sqrt(s^(-2))) * sqrt(pi) * sqrt(s^2)'
      );
    });

    test('∫ exp(−(z−m)²/(2s²)) dz completes the square in m and s', () => {
      const F = ce
        .parse('\\int \\exp\\left(-\\frac{(z-m)^2}{2s^2}\\right) dz')
        .evaluate();
      expect(F.has('Erf')).toBe(true);
      const dF = ce.function('D', [F, ce.symbol('z')]).evaluate();
      const m = 0.4;
      for (const z of [-1, 0.2, 1.3]) {
        const lhs = dF.subs({ z, s, m }).N().re;
        const rhs = Math.exp(-((z - m) * (z - m)) / (2 * s * s));
        expect(Math.abs(lhs - rhs)).toBeLessThan(1e-12);
      }
    });

    test('∫ e^(−e^a z²) dz is an Erf (e^a is positive)', () => {
      expect(ce.parse('\\int e^{-e^{a} z^2} dz').evaluate().toString()).toBe(
        '1/2 * Erf(z * e^(1/2 * a)) * sqrt(pi / e^a)'
      );
    });

    test('∫ e^(−a z²) dz with a bare a stays unevaluated', () => {
      // At `a < 0` the Erf form needs an imaginary argument.
      expect(ce.parse('\\int e^{-a z^2} dz').evaluate().operator).toBe('Integrate');
      expect(ce.parse('\\int e^{a z^2} dz').evaluate().operator).toBe('Integrate');
    });

    test('a coefficient that can be zero (|a|, s²) stays unevaluated', () => {
      // The Erf form is `0/0` at the zero, where the integrand is 1.
      expect(ce.parse('\\int e^{-|a| z^2} dz').evaluate().operator).toBe('Integrate');
      expect(ce.parse('\\int_0^1 e^{-s^2 x^2} dx').evaluate().operator).toBe('Integrate');
    });

    test('a symbol declared complex disqualifies the real-domain reading', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('s', 'complex');
      expect(
        ce2.parse('\\int \\exp\\left(-\\frac{1}{2}\\frac{z^2}{s^2}\\right) dz').evaluate().operator
      ).toBe('Integrate');
    });
  });

  describe('definite integral with an infinite bound', () => {
    test('∫_{−∞}^{∞} exp(−z²/(2s²)) dz is √(2π)·√(s²) under the guard √(s⁻²) > 0', () => {
      expect(
        ce.parse('\\int_{-\\infty}^{\\infty} \\exp\\left(-\\frac{z^2}{2s^2}\\right) dz').evaluate().json
      ).toEqual([
        'When',
        ['Multiply', ['Sqrt', 2], ['Sqrt', 'Pi'], ['Sqrt', ['Power', 's', 2]]],
        ['Less', 0, ['Sqrt', ['Power', 's', -2]]],
      ]);
    });

    test('∫_{−∞}^{∞} exp(z²/(2s²)) dz stays an integral (Erfi has no limit)', () => {
      expect(
        ce.parse('\\int_{-\\infty}^{\\infty} \\exp\\left(\\frac{z^2}{2s^2}\\right) dz').evaluate().operator
      ).toBe('Integrate');
    });

    test('∫_{−∞}^{∞} e^(−z²/s) dz stays an integral (the sign of s is unknown)', () => {
      expect(
        ce.parse('\\int_{-\\infty}^{\\infty} e^{-z^2/s} dz').evaluate().operator
      ).toBe('Integrate');
    });

    test('the normal distribution function is a guarded closed form', () => {
      const E = ce.parse(NORMAL_CDF).evaluate();
      expect(E.operator).toBe('When');
      expect(E.has('Integrate')).toBe(false);
      expect(E.has('Erf')).toBe(true);
      for (const x of [-2, -0.5, 0, 0.25, 1.8]) {
        const v = E.subs({ x, s }).evaluate().N().re;
        expect(Math.abs(v - normalCdf(x))).toBeLessThan(1e-12);
      }
    });

    test('with a mean, the lower bound is a sum with one infinite term', () => {
      // `Erf((−∞)·√(s⁻²) − m·√(s⁻²))`: the finite term does not change the
      // limit, and the same guard applies.
      const E = ce
        .parse('\\frac{1}{\\sqrt{2\\pi}s}\\int_{-\\infty}^{x}\\exp\\left(-\\frac{(z-m)^{2}}{2s^{2}}\\right)dz')
        .evaluate();
      expect(E.operator).toBe('When');
      expect(E.has('Integrate')).toBe(false);
      const m = 0.4;
      for (const x of [-2, 0, 1.8]) {
        const v = E.subs({ x, s, m }).evaluate().N().re;
        expect(Math.abs(v - normalCdf(x, m))).toBeLessThan(1e-12);
      }
    });

    test('the guard refuses a coefficient that is not a positive real', () => {
      // With s = i, the exponent is +z²/2 and the integral diverges: the
      // guard `√(s⁻²) > 0` is false and the result has no value.
      const E = ce
        .parse('\\int_{-\\infty}^{x}\\exp\\left(-\\frac{1}{2}\\frac{z^{2}}{s^{2}}\\right)dz')
        .evaluate();
      const v = E.subs({ x: 1, s: ce.I }).evaluate();
      expect(v.isNaN).toBe(true);
    });
  });

  describe('compiled normal distribution function (the row 428 instrument)', () => {
    test('the compiled code calls erf, not the quadrature, and matches the closed form', () => {
      const result = compile(ce.parse(NORMAL_CDF), { to: 'javascript' });
      expect(result.success).toBe(true);
      expect(String(result.code)).not.toContain('integrate');
      expect(String(result.code)).toContain('erf');
      const N = 2469;
      let maxDiff = 0;
      for (let i = 0; i < N; i++) {
        const x = -2 + (4 * i) / (N - 1);
        const v = Number(result.run({ x, s }));
        maxDiff = Math.max(maxDiff, Math.abs(v - normalCdf(x)));
      }
      expect(maxDiff).toBeLessThan(1e-9);
    });

    test('∫₀¹ e^(−a x²) dx with a bare a still compiles to the quadrature', () => {
      // The closed form would answer NaN at `a < 0`; the quadrature is right.
      const result = compile(ce.parse('\\int_0^1 e^{-a x^2} dx'), { to: 'javascript' });
      expect(result.success).toBe(true);
      expect(String(result.code)).toContain('_SYS.integrate');
      expect(result.run({ a: -1 }) as number).toBeCloseTo(1.4626517459071816, 8);
    });
  });

  describe('a sum with an infinite term of unknown sign (found on the way)', () => {
    test('∞·c + 1 stays a sum', () => {
      expect(ce.parse('\\infty c + 1').evaluate().toString()).toBe('+oo * c + 1');
    });

    test('∞·c − ∞·c is the indeterminate form', () => {
      expect(ce.parse('\\infty c - \\infty c').evaluate().toString()).toBe(
        'Indeterminate'
      );
    });

    test('a pure infinity does not absorb a term of unknown sign', () => {
      // `∞·c + ∞` is `∞ − ∞` at `c < 0`.
      expect(ce.parse('\\infty c + \\infty').evaluate().toString()).toBe('+oo * c + oo');
      expect(ce.parse('\\infty c - \\infty').evaluate().toString()).toBe('+oo * c - oo');
      expect(ce.parse('\\infty c + \\infty - \\infty').evaluate().toString()).toBe(
        'Indeterminate'
      );
    });

    test('∞ + 1 and 2∞ + 1 are still +∞', () => {
      expect(ce.parse('\\infty + 1').evaluate().toString()).toBe('+oo');
      expect(ce.parse('2\\infty + 1').evaluate().toString()).toBe('+oo');
    });

    test('−∞·c + 1 with c a positive number is −∞', () => {
      expect(ce.parse('-\\infty \\cdot 3 + 1').evaluate().toString()).toBe('-oo');
      expect(ce.parse('-\\infty \\sqrt{2} + 1').evaluate().toString()).toBe('-oo');
    });
  });
});
