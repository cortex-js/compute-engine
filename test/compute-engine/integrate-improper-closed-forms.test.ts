import { ComputeEngine } from '../../src/compute-engine';

/**
 * Closed forms of improper definite integrals that the antiderivative route
 * gave for a divergent integral, or did not give for a convergent one.
 *
 * - A power with a symbolic exponent whose base is zero strictly inside the
 *   bounds (`∫₋₁¹ t^(−n) dt`) is split at the zero, so the closed form
 *   carries the condition under which it is the value (`{n < 1}`), as
 *   Mathematica's `ConditionalExpression` does.
 * - A pole at which the integrand is a complex number on one side
 *   (`x^(−1.5)` for `x < 0`) is a divergence: the integral has no value.
 * - The closed form of `∫₁² t^(−n) dt` from the power rule carries `{n ≠ 1}`:
 *   at `n = 1` the integral is `ln 2`.
 * - `∫₀¹ ln t dt` is `−1`: the antiderivative `t·ln t − t` has no value at
 *   `0`, and the one-sided limit `t·ln t → 0` is taken instead.
 * - `.N()` of `∫₀¹ x^(−p) dx` for `p` just below 1 gives the value, or `NaN`
 *   with no sign, never `+∞`.
 */

const ce = new ComputeEngine();

const integral = (body: unknown, v: string, a: unknown, b: unknown) =>
  ce.box(['Integrate', body, ['Limits', v, a, b]] as any);

describe('A POWER WITH A SYMBOLIC EXPONENT AND A ZERO INSIDE THE BOUNDS', () => {
  test('∫₋₁¹ t^(−n) dt carries the condition n < 1', () => {
    expect(ce.parse('\\int_{-1}^1 t^{-n}\\,dt').evaluate().toString()).toBe(
      '1 / (1 - n) - ((-1)^(1 - n)) / (1 - n) {0 < 1 - n}'
    );
  });

  test('∫₋₁¹ t^n dt carries the condition n > −1', () => {
    expect(ce.parse('\\int_{-1}^1 t^{n}\\,dt').evaluate().toString()).toBe(
      '1 / (n + 1) - ((-1)^(n + 1)) / (n + 1) {0 < n + 1}'
    );
  });

  test('a linear base: ∫₀² (t − 1)^(−n) dt and ∫₀³ (2t − 1)^(−n) dt', () => {
    expect(ce.parse('\\int_0^2 (t-1)^{-n}\\,dt').evaluate().toString()).toBe(
      '1 / (1 - n) - ((-1)^(1 - n)) / (1 - n) {0 < 1 - n}'
    );
    // The cut at `1/2` is exact, so the pieces stay exact.
    expect(ce.parse('\\int_0^3 (2t-1)^{-n}\\,dt').evaluate().toString()).toBe(
      '-((-1)^(1 - n)) / (2(1 - n)) + 5^(1 - n) / (2(1 - n)) {0 < 1 - n}'
    );
  });

  test('a fraction of the symbol in the exponent', () => {
    expect(ce.parse('\\int_{-1}^1 t^{-n/3}\\,dt').evaluate().toString()).toBe(
      '1 / (-1/3 * n + 1) - ((-1)^(-1/3 * n + 1)) / (-1/3 * n + 1) {0 < -1/3 * n + 1}'
    );
  });

  test('reversed bounds negate the value', () => {
    expect(ce.parse('\\int_{1}^{-1} t^{-n}\\,dt').evaluate().toString()).toBe(
      '-1 / (1 - n) + (-1)^(1 - n) / (1 - n) {0 < 1 - n}'
    );
  });

  test('an exponent that depends on another symbol', () => {
    // `x^(−a²−1)` is unbounded at 0 for every real `a`: the condition
    // `0 < −a²` is the one the pieces give at the bound (as for `∫₀¹`).
    expect(
      ce.parse('\\int_{-1}^{1} x^{-a^2-1}\\,dx').evaluate().toString()
    ).toBe('-a^(-2) + (-1)^(-(a^2)) / a^2 {0 < -(a^2)}');
  });

  test('a zero AT a bound is not inside: ∫₀¹ tⁿ dt keeps its guarded form', () => {
    expect(ce.parse('\\int_0^1 t^{n}\\,dt').evaluate().toString()).toBe(
      '1 / (n + 1) {0 < n + 1}'
    );
  });

  test('a numeric exponent is not split: ∫₋₁¹ t⁻² dt = +∞', () => {
    expect(ce.parse('\\int_{-1}^1 t^{-2}\\,dt').evaluate().toString()).toBe(
      '+oo'
    );
  });

  test('a quadratic base: the cut at an irrational root is exact', () => {
    // A float cut at `1.4142…` is not a zero of `t² − 2`, so the pieces
    // would see no endpoint `0^(1 − n)` and the condition would be lost.
    expect(ce.parse('\\int_0^3 t(t^2-2)^{-n}\\,dt').evaluate().toString()).toBe(
      '-((-2)^(1 - n)) / (2(1 - n)) + 7^(1 - n) / (2(1 - n)) {0 < 1 - n}'
    );
    expect(ce.parse('\\int_0^3 t(t^2-4)^{-n}\\,dt').evaluate().toString()).toBe(
      '-((-4)^(1 - n)) / (2(1 - n)) + 5^(1 - n) / (2(1 - n)) {0 < 1 - n}'
    );
  });

  test('a zero that cannot be given exactly keeps the integral unevaluated', () => {
    expect(ce.parse('\\int_0^3 (t^3-2)^{-n}\\,dt').evaluate().operator).toBe(
      'Integrate'
    );
  });
});

describe('A POLE WHERE THE INTEGRAND IS COMPLEX ON ONE SIDE', () => {
  test('∫₋₁¹ x^(−1.5) dx has no value', () => {
    const e = ce.parse('\\int_{-1}^{1} x^{-1.5}\\,dx');
    expect(e.evaluate().toString()).toBe('NaN');
    expect(e.N().toString()).toBe('NaN');
  });

  test('∫₋₁¹ |x|^(−1.5) dx = +∞ on both routes', () => {
    // The pole site under `Abs` was not located by the quadrature's check,
    // which gave a finite value with a large error.
    const e = ce.parse('\\int_{-1}^{1} |x|^{-1.5}\\,dx');
    expect(e.evaluate().toString()).toBe('+oo');
    expect(e.N().toString()).toBe('+oo');
  });

  test('an integrable order below 1 is not a pole: ∫₋₁¹ |x|^(−0.95) dx = 40', () => {
    const e = ce.parse('\\int_{-1}^{1} |x|^{-0.95}\\,dx');
    expect(e.evaluate().toString()).toBe('40');
    expect(e.N().re).toBeCloseTo(40, 6);
  });

  test('∫₋₁¹ x^(−0.95) dx is the complex value 20·(1 + e^(−0.95iπ))', () => {
    // `x^(−0.95)` is complex for `x < 0`, with a constant phase; its
    // magnitude `|x|^(−0.95)` is integrable, so the integral has a value.
    const n = ce.parse('\\int_{-1}^{1} x^{-0.95}\\,dx').evaluate().N();
    expect(n.re).toBeCloseTo(20 * (1 + Math.cos(0.95 * Math.PI)), 6);
    expect(n.im).toBeCloseTo(-20 * Math.sin(0.95 * Math.PI), 6);
  });

  test('a rotating phase is not a divergence: ∫₋₁¹ e^(i/x)/x dx stays unevaluated', () => {
    // The magnitude is `1/|x|`, but the integral converges by the rotation
    // of the phase (`∫₁^∞ e^(iu)/u du`).
    expect(
      ce.parse('\\int_{-1}^{1} \\frac{e^{i/x}}{x}\\,dx').evaluate().operator
    ).toBe('Integrate');
  });

  test('a pole with a term that lowers its order is still a pole', () => {
    // The order of `1/x² + |x|^(−1/2)` measured at a distance `δ` is below
    // 2 and rises toward 2 as `δ` shrinks.
    expect(
      ce
        .parse('\\int_{-1}^{1} (\\frac{1}{x^2} + \\frac{1}{\\sqrt{|x|}})\\,dx')
        .N()
        .toString()
    ).toBe('+oo');
  });
});

describe('THE POWER RULE AT THE EXPONENT −1', () => {
  test('∫₁² t^(−n) dt carries n ≠ 1', () => {
    expect(ce.parse('\\int_1^2 t^{-n}\\,dt').evaluate().toString()).toBe(
      '-1 / (1 - n) + 2^(1 - n) / (1 - n) {n != 1}'
    );
  });

  test('a constant factor and a linear base', () => {
    expect(ce.parse('\\int_1^2 3t^{-n}\\,dt').evaluate().toString()).toBe(
      '-3 / (1 - n) + (3 * 2^(1 - n)) / (1 - n) {n != 1}'
    );
    expect(ce.parse('\\int_2^3 (2t-1)^{-n}\\,dt').evaluate().toString()).toBe(
      '-(3^(1 - n)) / (2(1 - n)) + 5^(1 - n) / (2(1 - n)) {n != 1}'
    );
  });

  test('the condition is on the symbol of a linear exponent', () => {
    expect(ce.parse('\\int_1^2 t^{2n-3}\\,dt').evaluate().toString()).toBe(
      '-1 / (2(n - 1)) + 2^(2n - 2) / (2(n - 1)) {n != 1}'
    );
    expect(ce.parse('\\int_1^2 t^{a+b}\\,dt').evaluate().toString()).toBe(
      '-1 / (a + b + 1) + 2^(a + b + 1) / (a + b + 1) {a + b != -1}'
    );
  });

  test('a constant exponent and a number exponent carry no condition', () => {
    expect(ce.parse('\\int_1^2 t^{\\pi}\\,dt').evaluate().toString()).toBe(
      '-1 / (1 + pi) + 2^(1 + pi) / (1 + pi)'
    );
    expect(ce.parse('\\int_1^2 t^{-2}\\,dt').evaluate().toString()).toBe('1/2');
    expect(ce.parse('\\int_1^2 t^{-1}\\,dt').evaluate().toString()).toBe(
      'ln(2)'
    );
  });

  test('a quotient spelling and the terms of a sum carry the condition', () => {
    expect(
      ce.parse('\\int_1^2 \\frac{a}{t^n}\\,dt').evaluate().toString()
    ).toBe('-a / (1 - n) + (a * 2^(1 - n)) / (1 - n) {n != 1}');
    expect(ce.parse('\\int_1^2 (t^{-n} + 1)\\,dt').evaluate().toString()).toBe(
      '-1 / (1 - n) + 2^(1 - n) / (1 - n) + 1 {n != 1}'
    );
    expect(
      ce.parse('\\int_1^2 (t^{-n} + t^{-m})\\,dt').evaluate().toString()
    ).toBe(
      '-1 / (1 - m) + 2^(1 - m) / (1 - m) - 1 / (1 - n) + 2^(1 - n) / (1 - n) {m != 1 && n != 1}'
    );
  });

  test('the condition is discharged by an assumption', () => {
    const local = new ComputeEngine();
    local.assume(local.parse('n > 2'));
    expect(local.parse('\\int_1^2 t^{-n}\\,dt').evaluate().toString()).toBe(
      '-1 / (1 - n) + 2^(1 - n) / (1 - n)'
    );
  });

  test('the indefinite integral is unchanged', () => {
    expect(ce.parse('\\int t^{-n}\\,dt').evaluate().toString()).toBe(
      't^(1 - n) / (1 - n)'
    );
  });
});

describe('THE ONE-SIDED LIMIT OF THE ANTIDERIVATIVE AT A FINITE BOUND', () => {
  test('∫₀¹ ln t dt = −1', () => {
    const e = integral(['Ln', 't'], 't', 0, 1);
    expect(e.evaluate().toString()).toBe('-1');
    expect(e.N().re).toBeCloseTo(-1, 8);
  });

  test('∫₀¹ t ln t dt = −1/4 and ∫₀¹ t² ln t dt = −1/9', () => {
    expect(ce.parse('\\int_0^1 t\\ln(t)\\,dt').evaluate().toString()).toBe(
      '-1/4'
    );
    expect(ce.parse('\\int_0^1 t^2\\ln(t)\\,dt').evaluate().toString()).toBe(
      '-1/9'
    );
  });

  test('an infinite one-sided limit is left to the pole verdict', () => {
    // `F = ln t − 100t` tends to `−∞` at `0⁺`; the integral is `+∞` by the
    // sign of the integrand next to the bound, as before.
    expect(
      ce.parse('\\int_0^1 (\\frac{1}{t} - 100)\\,dt').evaluate().toString()
    ).toBe('+oo');
  });

  test('the limits behind it', () => {
    const lim = (s: string) => ce.parse(s).evaluate().toString();
    expect(lim('\\lim_{t\\to 0^+} t\\ln t')).toBe('0');
    expect(lim('\\lim_{t\\to 0^+} (t\\ln t - t)')).toBe('0');
    expect(lim('\\lim_{t\\to 0^+} \\frac{1}{2}t^2\\ln t')).toBe('0');
    expect(lim('\\lim_{t\\to 0^+} t\\ln(t)^2')).toBe('0');
    expect(lim('\\lim_{t\\to 0^+} \\ln(t)^2')).toBe('+oo');
    expect(lim('\\lim_{t\\to 0^+} (2\\ln t - 1)')).toBe('-oo');
    // Two-sided, the real logarithm is undefined on the left: inert.
    expect(lim('\\lim_{x\\to 0} x\\ln x')).toBe('lim_(0) {x * ln(x)}');
    // A complex exponent: the magnitude grows but the phase turns.
    expect(lim('\\lim_{t\\to 0^+} (\\ln t)^{2+3i}')).toBe(
      'lim_(0) {ln(t)^(2 + 3i)}'
    );
  });

  test('an antiderivative with no value at the bound: no error, no value', () => {
    // `cos(1/t)` at `0` is `cos(~∞)`, an incompatible-type error before;
    // the integral oscillates and has no value, so it stays unevaluated.
    for (const s of [
      '\\int_0^1 \\frac{1}{t}\\sin(\\frac{1}{t})\\cdot\\frac{1}{t}\\,dt',
      '\\int_0^1 \\frac{\\sin(1/t)}{t^2}\\,dt',
    ]) {
      const v = ce.parse(s).evaluate();
      expect(v.isValid).toBe(true);
      expect(v.operator).toBe('Integrate');
    }
  });
});

describe('AN ORDER JUST BELOW 1 AT A BOUND, UNDER .N()', () => {
  // `∫₀¹ x^(−p) dx = 1/(1 − p)`. The shells of the quadrature shrink
  // geometrically, by `2^(p−1)` each, and a geometric series converges: the
  // extrapolation of the shells gives the value.
  test.each([
    [0.9999, 10000],
    [0.9995, 2000],
    [0.9993, 1 / 0.0007],
  ])('∫₀¹ x^(−%s) dx = %s', (p, value) => {
    const n = ce.parse(`\\int_0^1 x^{-${p}}\\,dx`).N();
    expect(n.isInfinity).not.toBe(true);
    expect(n.re).toBeCloseTo(value, 4);
  });

  test('with a logarithmic factor, no sign is claimed', () => {
    // `∫₀¹ x^(−0.9999)·ln x dx = −10⁸`: the mass of the integral is at
    // `x ≈ 10^(−4343)`, out of the reach of any sample, so there is no
    // value; there must be no `−∞` either.
    const n = ce.parse('\\int_0^1 x^{-0.9999}\\ln(x)\\,dx').N();
    expect(n.isInfinity).not.toBe(true);
  });

  test('a pole at the bound is still a pole', () => {
    expect(ce.parse('\\int_0^1 \\frac{\\ln t}{t}\\,dt').N().toString()).toBe(
      '-oo'
    );
    expect(ce.parse('\\int_0^1 (\\frac{1}{t} - 100)\\,dt').N().toString()).toBe(
      '+oo'
    );
  });
});

describe('THE DIFFERENTIAL ENDS THE ARGUMENT OF A LOGARITHM', () => {
  // `\ln t\,dt` read `\ln(t\,dt)`, so `\int_0^1 t\ln t\,dt` had two
  // integration variables, `d` and `t`; `\sin` already forwarded the
  // terminator of the integral to its argument parser.
  test.each([
    ['\\int_0^1 t\\ln t\\,dt', 't', ['Multiply', 't', ['Ln', 't']]],
    ['\\int_0^1 x\\ln x dx', 'x', ['Multiply', 'x', ['Ln', 'x']]],
    ['\\int_0^1 t\\ln t\\mathrm{d}t', 't', ['Multiply', 't', ['Ln', 't']]],
    ['\\int_0^1 \\log_2 t\\,dt', 't', ['Log', 't', 2]],
    ['\\int_0^1 \\lg t\\,dt', 't', ['Log', 't', 10]],
    [
      '\\int_0^1 t\\exp t\\,dt',
      't',
      ['Multiply', 't', ['Power', 'ExponentialE', 't']],
    ],
    ['\\int_0^1 \\operatorname{Li}_2 t\\,dt', 't', ['PolyLog', 2, 't']],
  ])('%s', (latex, variable, body) => {
    expect(ce.parse(latex).json).toEqual([
      'Integrate',
      ['Function', ['Block', body], variable],
      ['Limits', variable, 0, 1],
    ]);
  });

  test('∫₀¹ t ln t dt evaluates to −1/4 from LaTeX', () => {
    expect(ce.parse('\\int_0^1 t\\ln t\\,dt').evaluate().toString()).toBe(
      '-1/4'
    );
  });

  test('outside an integral the argument still extends over a product', () => {
    expect(ce.parse('\\ln x y').json).toEqual(['Ln', ['Multiply', 'x', 'y']]);
    expect(ce.parse('\\ln 2x + 1').json).toEqual([
      'Add',
      ['Ln', ['Multiply', 2, 'x']],
      1,
    ]);
  });
});
