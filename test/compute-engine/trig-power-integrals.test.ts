import { engine as ce } from '../utils';

/**
 * ∫ c·sinᵐ(u)·cosⁿ(u) dx for a linear u (`integrateSinCosPower()` in
 * `symbolic/antiderivative.ts`).
 */
const trig = (m: number, n: number, u: any) =>
  m === 0
    ? ['Power', ['Cos', u], n]
    : n === 0
      ? ['Power', ['Sin', u], m]
      : ['Multiply', ['Power', ['Sin', u], m], ['Power', ['Cos', u], n]];

const integral = (f: any) => ce.box(['Integrate', f, 'x']);

// F is an antiderivative when its derivative matches the integrand.
const derivativeMatches = (f: any, F: any): boolean => {
  const h = 1e-5;
  const at = (e: any, x: number) => ce.box(e).subs({ x }).N().re;
  return [0.3, 0.9, 1.7].every(
    (x) => Math.abs((at(F, x + h) - at(F, x - h)) / (2 * h) - at(f, x)) < 1e-6
  );
};

describe('Integrals of powers of sin and cos', () => {
  const exact: [string, string][] = [
    ['\\int \\sin^3 x\\,dx', '1/3 * cos(x)^3 - cos(x)'],
    ['\\int \\cos^3 x\\,dx', '-1/3 * sin(x)^3 + sin(x)'],
    ['\\int \\sin^3 x\\cos^2 x\\,dx', '-1/3 * cos(x)^3 + 1/5 * cos(x)^5'],
    ['\\int \\sin^2 x\\cos^3 x\\,dx', '-1/5 * sin(x)^5 + 1/3 * sin(x)^3'],
    ['\\int \\sin^3 x\\cos^3 x\\,dx', '-1/4 * cos(x)^4 + 1/6 * cos(x)^6'],
    ['\\int 3\\sin^3(2x+1)\\,dx', '-3/2 * cos(2x + 1) + 1/2 * cos(2x + 1)^3'],
    ['\\int \\frac{\\cos^3 x}{2}\\,dx', '-1/6 * sin(x)^3 + 1/2 * sin(x)'],
  ];
  for (const [latex, expected] of exact) {
    test(`${latex} = ${expected}`, () => {
      expect(ce.parse(latex).evaluate().toString()).toBe(expected);
    });
  }

  const cases: [number, number, any][] = [
    [3, 0, 'x'],
    [5, 0, 'x'],
    [0, 5, 'x'],
    [4, 0, 'x'],
    [0, 4, 'x'],
    [6, 0, 'x'],
    [2, 2, 'x'],
    [2, 4, 'x'],
    [4, 2, 'x'],
    [6, 4, 'x'],
    [3, 2, 'x'],
    [1, 4, 'x'],
    [3, 3, 'x'],
    [3, 0, ['Add', ['Multiply', 2, 'x'], 1]],
    [4, 0, ['Multiply', 3, 'x']],
    [2, 4, ['Subtract', 'x', 1]],
  ];
  for (const [m, n, u] of cases) {
    const f = trig(m, n, u);
    test(`d/dx of ∫ sin^${m}·cos^${n} of ${JSON.stringify(u)} is the integrand`, () => {
      const F = integral(f).evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(derivativeMatches(f, F)).toBe(true);
    });
  }

  test('definite integrals: ∫₀^π sin³ = 4/3, ∫₀^{π/2} sin⁴ = 3π/16', () => {
    expect(ce.parse('\\int_0^\\pi \\sin^3 x\\,dx').evaluate().json).toEqual([
      'Rational',
      4,
      3,
    ]);
    expect(
      ce.parse('\\int_0^{\\pi/2} \\sin^4 x\\,dx').evaluate().N().re
    ).toBeCloseTo((3 * Math.PI) / 16, 12);
    expect(ce.parse('\\int_0^\\pi \\sin^3 x\\,dx').N().re).toBeCloseTo(
      4 / 3,
      12
    );
    expect(
      ce.parse('\\int_0^\\pi \\sin^2 x\\cos^2 x\\,dx').evaluate().N().re
    ).toBeCloseTo(Math.PI / 8, 12);
  });

  test('a degree angular unit scales by 180/π', () => {
    const saved = ce.angularUnit;
    try {
      ce.angularUnit = 'deg';
      const F = ce.parse('\\int \\sin^3 x\\,dx').evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.subs({ x: 60 }).N().re - F.subs({ x: 0 }).N().re).toBeCloseTo(
        (180 / Math.PI) * (2 / 3 - 11 / 24),
        10
      );
    } finally {
      ce.angularUnit = saved;
    }
  });

  const stays: [string, any][] = [
    ['an argument that is not linear', trig(3, 0, ['Power', 'x', 2])],
    [
      'different arguments',
      ['Multiply', ['Power', ['Sin', 'x'], 3], ['Cos', ['Multiply', 2, 'x']]],
    ],
    ['a symbolic power', ['Power', ['Sin', 'x'], 'n']],
    ['a fractional power', ['Power', ['Sin', 'x'], ['Rational', 3, 2]]],
    ['a complex power', ['Power', ['Sin', 'x'], ['Complex', 3, 1]]],
    ['a negative power', ['Power', ['Sin', 'x'], -3]],
  ];
  for (const [name, f] of stays) {
    test(`${name} is not read as a power of sin and cos`, () => {
      expect(integral(f).evaluate().has('Integrate')).toBe(true);
    });
  }
});
