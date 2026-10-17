import { engine as ce } from '../utils';

// A divisor `k·bᵘ + c` with `u` linear in the integration variable is zero at
// one point (`eᵗ − 1` at `t = 0`). The interior-pole detection of definite
// integration (`symbolic/interior-pole.ts`) did not know this family, so the
// antiderivative `ln(eᵗ − 1)` was differenced across the pole and
// `∫₋₁¹ eᵗ/(eᵗ − 1) dt` evaluated to `1` where the integral diverges.

const evaluate = (latex: string) => ce.parse(latex).evaluate();

describe('INTEGRATE: zero of an exponential divisor strictly inside the bounds', () => {
  test('∫₋₁¹ eˣ/(eˣ − 1) dx has no value: the integrand changes sign at the pole', () => {
    const v = evaluate('\\int_{-1}^{1} \\frac{e^{x}}{e^{x}-1} dx');
    expect(v.isNaN).toBe(true);
    expect(v.toString()).toBe('Indeterminate');
  });

  test('∫₀² eˣ/(eˣ − 1) dx: the pole AT the lower bound is an endpoint singularity, +∞', () => {
    expect(evaluate('\\int_{0}^{2} \\frac{e^{x}}{e^{x}-1} dx').toString()).toBe(
      '+oo'
    );
  });

  test('∫₁² eˣ/(eˣ − 1) dx: the pole is outside the bounds, the closed form stands', () => {
    const v = evaluate('\\int_{1}^{2} \\frac{e^{x}}{e^{x}-1} dx');
    expect(v.isNaN).not.toBe(true);
    expect(v.N().re).toBeCloseTo(
      Math.log(Math.E ** 2 - 1) - Math.log(Math.E - 1),
      12
    );
  });

  test('∫₋₁¹ eᵗ/(eᵗ + 1) dt: a divisor with no real zero keeps its value', () => {
    const v = evaluate('\\int_{-1}^{1} \\frac{e^t}{e^t+1} dt');
    expect(v.isNaN).not.toBe(true);
    expect(v.N().re).toBeCloseTo(1, 12);
  });

  test('a scaled exponential and a base other than e: the pole site is where k·bᵘ = −c', () => {
    // 2·eᵗ − 3 is zero at t = ln(3/2) ≈ 0.405, inside (−1, 1); the integrand
    // is the derivative of ln(2eᵗ − 3) scaled, so the closed form exists.
    const scaled = evaluate('\\int_{-1}^{1} \\frac{2e^{t}}{2e^{t}-3} dt');
    expect(scaled.isNaN).toBe(true);
    // 2ᵗ − 8 is zero at t = 3, inside (0, 4).
    const base2 = evaluate('\\int_{0}^{4} \\frac{2^{t}}{2^{t}-8} dt');
    expect(base2.isNaN).toBe(true);
    // The same divisor over (0, 2): the zero at 3 is outside, the value stands.
    const outside = evaluate('\\int_{0}^{2} \\frac{2^{t}}{2^{t}-8} dt');
    expect(outside.isNaN).not.toBe(true);
    expect(outside.N().re).toBeCloseTo(
      (Math.log(4) - Math.log(7)) / Math.log(2),
      10
    );
  });

  test('a negated exponential: 1 − eˣ and 3 − 2eˣ have their zero inside the bounds', () => {
    // 1 − eˣ canonicalizes to Add(Negate(eˣ), 1); its zero is at x = 0.
    expect(
      evaluate('\\int_{-1}^{1} \\frac{e^{x}}{1-e^{x}} dx').isNaN
    ).toBe(true);
    // 3 − 2eˣ is zero at x = ln(3/2) ≈ 0.405, inside (−1, 1).
    expect(
      evaluate('\\int_{-1}^{1} \\frac{e^{x}}{3-2e^{x}} dx').isNaN
    ).toBe(true);
  });

  test('∫₁² eˣ/(1 − eˣ) dx: the zero of 1 − eˣ is outside the bounds, the closed form stands', () => {
    const v = evaluate('\\int_{1}^{2} \\frac{e^{x}}{1-e^{x}} dx');
    expect(v.isNaN).not.toBe(true);
    expect(v.N().re).toBeCloseTo(
      -(Math.log(Math.E ** 2 - 1) - Math.log(Math.E - 1)),
      12
    );
  });
});
