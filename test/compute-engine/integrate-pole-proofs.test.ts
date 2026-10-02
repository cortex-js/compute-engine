import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

/**
 * Definite integrals whose closed form is correct only when the integrand
 * has no pole between the bounds, and the proofs that decide it:
 *
 * - a free symbol beside a pole at a number (`a·sin(t)/t`): the free symbol
 *   is sampled, and a removable site gives the closed form;
 * - a divisor whose zero moves with a free symbol and is not a polynomial
 *   root (`eᵗ − a`, `sin t − a`, `(t − a)^(−n)`);
 * - a pole at a number with a free symbol in a bound (`∫ₐ¹ dt/t`);
 * - an undeclared symbol is real in these proofs (`a² + 1 > 0`);
 * - the inner integral of an iterated integral written as nested integrals
 *   knows the range of the outer variable.
 *
 * Also: the flat MathJSON spelling of several indexes, one-bound integrals,
 * `eᵃ ≠ 0`, the antiderivative of `ln(ax + b)`, and `.N()` of an integrand
 * with a constant such as `π`.
 *
 * Every closed form is compared with an independent composite Simpson rule.
 */

/** Composite Simpson rule on `[a, b]` with `n` (even) panels. */
function simpson(
  f: (x: number) => number,
  a: number,
  b: number,
  n = 2000
): number {
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

const evaluated = (ce: ComputeEngine, latex: string) =>
  ce.parse(latex).evaluate();

/** The numeric value of `e` with the symbols given the values `values`. */
const at = (e: Expression, values: Record<string, number>) =>
  e.subs(values).N().re;

const sinc = (t: number) => (t === 0 ? 1 : Math.sin(t) / t);

describe('A FREE SYMBOL BESIDE A POLE AT A NUMBER', () => {
  test('a removable site or no site: the closed form', () => {
    const ce = new ComputeEngine();
    // Was unevaluated.
    expect(evaluated(ce, '\\int_0^2 a\\frac{t^2-1}{t-1}\\,dt').toString()).toBe(
      '4a'
    );
    const scaled = evaluated(ce, '\\int_{-1}^1 a\\frac{\\sin t}{t}\\,dt');
    expect(scaled.has('Integrate')).toBe(false);
    expect(at(scaled, { a: 3 })).toBeCloseTo(3 * simpson(sinc, -1, 1), 10);
    const shifted = evaluated(ce, '\\int_{-1}^1 (\\frac{\\sin t}{t} + a)\\,dt');
    expect(shifted.has('Integrate')).toBe(false);
    expect(at(shifted, { a: 0.5 })).toBeCloseTo(simpson(sinc, -1, 1) + 1, 10);
  });

  test('a pole at a number that the free symbol does not remove', () => {
    const ce = new ComputeEngine();
    for (const latex of [
      '\\int_{-1}^1 \\frac{t-a}{t}\\,dt',
      '\\int_{-1}^1 (\\frac{1}{t} + a)\\,dt',
      '\\int_{-1}^1 \\frac{1}{t(t^2+a^2+1)}\\,dt',
    ])
      expect(evaluated(ce, latex).operator).toBe('Integrate');
  });
});

describe('A DIVISOR WHOSE ZERO MOVES WITH A FREE SYMBOL', () => {
  test('a zero that may be inside: unevaluated', () => {
    const ce = new ComputeEngine();
    // Each was a closed form that is wrong for some values of `a`:
    // `ln|e − a| − ln|1 − a|` for 1 ≤ a ≤ e, a finite value where the
    // integral of `cos t/(sin t − a)²` is `+∞`, …
    for (const latex of [
      '\\int_0^1 \\frac{e^t}{e^t-a}\\,dt',
      '\\int_0^1 \\frac{\\cos t}{\\sin t - a}\\,dt',
      '\\int_0^1 \\frac{\\cos t}{(\\sin t - a)^2}\\,dt',
      '\\int_0^1 (t-a)^{-n}\\,dt',
    ])
      expect(evaluated(ce, latex).operator).toBe('Integrate');
  });

  test('a zero proven outside: the closed form', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('a > 3'));
    const exp = evaluated(ce, '\\int_0^1 \\frac{e^t}{e^t-a}\\,dt');
    expect(exp.has('Integrate')).toBe(false);
    expect(at(exp, { a: 4 })).toBeCloseTo(
      simpson((t) => Math.exp(t) / (Math.exp(t) - 4), 0, 1),
      10
    );
    const sin = evaluated(ce, '\\int_0^1 \\frac{\\cos t}{\\sin t - a}\\,dt');
    expect(sin.has('Integrate')).toBe(false);
    expect(at(sin, { a: 4 })).toBeCloseTo(
      simpson((t) => Math.cos(t) / (Math.sin(t) - 4), 0, 1),
      10
    );

    const ce2 = new ComputeEngine();
    ce2.assume(ce2.parse('a < 0'));
    const square = evaluated(
      ce2,
      '\\int_0^1 \\frac{\\cos t}{(\\sin t - a)^2}\\,dt'
    );
    expect(square.has('Integrate')).toBe(false);
    expect(at(square, { a: -1 })).toBeCloseTo(
      simpson((t) => Math.cos(t) / (Math.sin(t) + 1) ** 2, 0, 1),
      10
    );

    // `eᵗ − (−a² − 1)` is never zero for a real `a`.
    const ce3 = new ComputeEngine();
    const positive = evaluated(ce3, '\\int_0^1 \\frac{e^t}{e^t+a^2+1}\\,dt');
    expect(positive.has('Integrate')).toBe(false);
    expect(at(positive, { a: 2 })).toBeCloseTo(
      simpson((t) => Math.exp(t) / (Math.exp(t) + 5), 0, 1),
      10
    );
  });
});

describe('A POLE AT A NUMBER WITH A FREE SYMBOL IN A BOUND', () => {
  test('no sign known for the bound: unevaluated', () => {
    const ce = new ComputeEngine();
    // Were `−ln|a|`, `ln|b|` and `ln|b + 1|`: wrong when the pole is inside
    // (a < 0, b > 0, b < −1).
    for (const latex of [
      '\\int_a^1 \\frac{1}{t}\\,dt',
      '\\int_{-1}^b \\frac{1}{t}\\,dt',
      '\\int_0^b \\frac{1}{t+1}\\,dt',
    ])
      expect(evaluated(ce, latex).operator).toBe('Integrate');
  });

  test('a bound proven on one side of the pole: the closed form', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('a > 0'));
    const left = evaluated(ce, '\\int_a^1 \\frac{1}{t}\\,dt');
    expect(left.has('Integrate')).toBe(false);
    expect(at(left, { a: 0.5 })).toBeCloseTo(
      simpson((t) => 1 / t, 0.5, 1),
      10
    );
    ce.assume(ce.parse('b > 0'));
    const shifted = evaluated(ce, '\\int_0^b \\frac{1}{t+1}\\,dt');
    expect(shifted.has('Integrate')).toBe(false);
    expect(at(shifted, { b: 2 })).toBeCloseTo(
      simpson((t) => 1 / (t + 1), 0, 2),
      10
    );
    // `b > 0` puts the pole at 0 inside `[−1, b]`.
    expect(evaluated(ce, '\\int_{-1}^b \\frac{1}{t}\\,dt').operator).toBe(
      'Integrate'
    );

    const ce2 = new ComputeEngine();
    ce2.assume(ce2.parse('b < -2'));
    const negative = evaluated(ce2, '\\int_{-1}^b \\frac{1}{t}\\,dt');
    expect(negative.has('Integrate')).toBe(false);
    expect(at(negative, { b: -3 })).toBeCloseTo(
      simpson((t) => 1 / t, -1, -3),
      10
    );
  });

  test('a removable site or an integrable one: the closed form', () => {
    const ce = new ComputeEngine();
    expect(evaluated(ce, '\\int_0^x \\frac{\\sin t}{t}\\,dt').toString()).toBe(
      'SinIntegral(x)'
    );
    expect(evaluated(ce, '\\int_0^b \\frac{1}{\\sqrt t}\\,dt').toString()).toBe(
      '2sqrt(b)'
    );
    expect(evaluated(ce, '\\int_0^x \\frac{1}{1+t^2}\\,dt').toString()).toBe(
      'arctan(x)'
    );
  });
});

describe('AN UNDECLARED SYMBOL IS REAL IN THE POLE PROOFS', () => {
  test('a² + 1 is positive: the closed form', () => {
    const ce = new ComputeEngine();
    const cases: [string, (a: number) => (t: number) => number][] = [
      ['\\int_0^1 \\frac{1}{t+a^2+1}\\,dt', (a) => (t) => 1 / (t + a * a + 1)],
      [
        '\\int_1^2 \\frac{1}{t(t^2+a^2+1)}\\,dt',
        (a) => (t) => 1 / (t * (t * t + a * a + 1)),
      ],
      [
        '\\int_0^1 \\frac{1}{t^2+a^2+1}\\,dt',
        (a) => (t) => 1 / (t * t + a * a + 1),
      ],
    ];
    for (const [latex, f] of cases) {
      const value = evaluated(ce, latex);
      expect(value.has('Integrate')).toBe(false);
      const [lo, hi] = latex.startsWith('\\int_1') ? [1, 2] : [0, 1];
      expect(at(value, { a: 1.5 })).toBeCloseTo(simpson(f(1.5), lo, hi), 10);
    }
  });

  test('m² may be 0, a complex z² + 1 may be negative: unevaluated', () => {
    const ce = new ComputeEngine();
    expect(evaluated(ce, '\\int_0^1 \\frac{1}{t^2+m^2}\\,dt').operator).toBe(
      'Integrate'
    );
    ce.declare('z', 'complex');
    expect(evaluated(ce, '\\int_0^1 \\frac{1}{t+z^2+1}\\,dt').operator).toBe(
      'Integrate'
    );
  });
});

describe('NESTED INTEGRALS ON THE PARSE ROUTE', () => {
  test('the inner pole is outside for every value of the outer variable', () => {
    const ce = new ComputeEngine();
    // Was unevaluated (the `Limits` form was not).
    const value = evaluated(ce, '\\int_5^{10}\\int_3^4 (y-x)^{-2}\\,dx\\,dy');
    expect(value.has('Integrate')).toBe(false);
    expect(value.N().re).toBeCloseTo(
      simpson((y) => simpson((x) => (y - x) ** -2, 3, 4, 1000), 5, 10, 1000),
      9
    );
  });

  test('the inner pole is inside for some values: unevaluated', () => {
    const ce = new ComputeEngine();
    expect(
      evaluated(ce, '\\int_0^{10}\\int_3^4 (y-x)^{-2}\\,dx\\,dy').has(
        'Integrate'
      )
    ).toBe(true);
  });
});

describe('THE FLAT SPELLING OF SEVERAL INDEXES', () => {
  test('a name that would be an index twice is an upper bound', () => {
    const ce = new ComputeEngine();
    // Was `Limits(x, Nothing, 0), Limits(y, Nothing, Nothing), Limits(y, 0, 1)`.
    expect(
      ce.box(['Integrate', ['Multiply', 'x', 'y'], 'x', 0, 'y', 'y', 0, 1]).json
    ).toMatchObject([
      'Integrate',
      expect.anything(),
      ['Limits', 'x', 0, 'y'],
      ['Limits', 'y', 0, 1],
    ]);
    expect(ce.box(['Sum', 'k', 'k', 1, 'n', 'n', 1, 10]).json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 1, 'n'],
      ['Limits', 'n', 1, 10],
    ]);
    expect(ce.box(['Integrate', 'x', 'x', 'y', 'y', 0, 1]).json).toEqual([
      'Integrate',
      'x',
      ['Limits', 'x', 'Nothing', 'y'],
      ['Limits', 'y', 0, 1],
    ]);
    // The flat form and the `Limits` form have the same value.
    const flat = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      'x',
      0,
      'y',
      'y',
      0,
      1,
    ]);
    const limits = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, 'y'],
      ['Limits', 'y', 0, 1],
    ]);
    expect(flat.evaluate().isSame(limits.evaluate())).toBe(true);
  });

  test('a name that is an index once is still the next index', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Integrate', ['Multiply', 'x', 'y'], 'x', 1, 'y', 0, 2]).json
    ).toMatchObject([
      'Integrate',
      expect.anything(),
      ['Limits', 'x', 'Nothing', 1],
      ['Limits', 'y', 0, 2],
    ]);
    expect(
      ce.box(['Integrate', ['Multiply', 'x', 'y'], 'x', 'y', 0, 1]).json
    ).toMatchObject([
      'Integrate',
      expect.anything(),
      ['Limits', 'x', 'Nothing', 'Nothing'],
      ['Limits', 'y', 0, 1],
    ]);
  });
});

describe('ONE BOUND: UNEVALUATED, NEVER Nothing IN A RESULT', () => {
  test.each([
    [['Integrate', ['Sin', 'x'], 'x', 'Pi']],
    [['Integrate', ['Multiply', 'x', 'y'], 'x', 1, 'y', 0, 2]],
    [['Integrate', ['Sin', 'x'], 'x', 10]],
  ])('%j', (json) => {
    const ce = new ComputeEngine();
    const e = ce.box(json as any);
    for (const value of [e.evaluate(), e.N()]) {
      expect(value.operator).toBe('Integrate');
      // `Nothing` is the missing bound of a `Limits`, never a value
      // substituted into the integrand (was `cos("Nothing") + 1`).
      expect(value.op1.has('Nothing')).toBe(false);
    }
  });
});

describe('eᵃ IS NEVER ZERO', () => {
  test('a sign change across the pole: no value', () => {
    const ce = new ComputeEngine();
    // Was unevaluated.
    expect(evaluated(ce, '\\int_{-1}^1 \\frac{1}{e^a t}\\,dt').toString()).toBe(
      'Indeterminate'
    );
    expect(
      evaluated(ce, '\\int_{-1}^1 \\frac{e^{-a}}{t}\\,dt').toString()
    ).toBe('Indeterminate');
  });
});

describe('THE ANTIDERIVATIVE OF ln(ax + b)', () => {
  // Was `(x + 1)ln(x) − x + 1` for `ln(x + 1)`: the shift was lost.
  test.each([
    ['\\ln(x+1)', (x: number) => Math.log(x + 1), [0.3, 1.7]],
    ['\\ln(2x+3)', (x: number) => Math.log(2 * x + 3), [-1, 0.5]],
    ['\\ln(1-x)', (x: number) => Math.log(1 - x), [-2, 0.5]],
    ['x\\ln(x+1)', (x: number) => x * Math.log(x + 1), [0.4, 2]],
  ] as const)('d/dx ∫ %s dx', (latex, f, points) => {
    const ce = new ComputeEngine();
    const F = evaluated(ce, `\\int ${latex}\\,dx`);
    expect(F.has('Integrate')).toBe(false);
    const h = 1e-5;
    for (const x of points)
      expect((at(F, { x: x + h }) - at(F, { x: x - h })) / (2 * h)).toBeCloseTo(
        f(x),
        6
      );
  });

  test('a definite integral', () => {
    const ce = new ComputeEngine();
    // Was `+∞`.
    const value = evaluated(ce, '\\int_0^1 \\ln(x+1)\\,dx');
    expect(value.toString()).toBe('-1 + 2ln(2)');
    expect(value.N().re).toBeCloseTo(
      simpson((x) => Math.log(x + 1), 0, 1),
      12
    );
  });
});

describe('evaluate() AND N() AGREE ON A POLE WITH A CONSTANT FACTOR', () => {
  test.each([
    ['\\frac{\\pi}{t}', 'Indeterminate', 'NaN'],
    ['\\frac{e}{t}', 'Indeterminate', 'NaN'],
    ['\\frac{\\pi}{t^2}', '+oo', '+oo'],
    ['\\frac{-e}{t^2}', '-oo', '-oo'],
  ])('∫₋₁¹ %s dt', (body, exact, numeric) => {
    const ce = new ComputeEngine();
    const e = ce.parse(`\\int_{-1}^1 ${body}\\,dt`);
    expect(e.evaluate().toString()).toBe(exact);
    // Was a Monte Carlo estimate (`-1.9 ± 6.8`, `2.1e154 ± 6.7e150`).
    expect(e.N().toString()).toBe(numeric);
  });
});
