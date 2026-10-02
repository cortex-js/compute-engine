import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Definite integrals whose value the fundamental theorem of calculus does not
 * give, and the spellings of their bounds.
 *
 * - A pole whose position depends on a symbol with no value: `(y − a)⁻²` over
 *   `[0, 4]` diverges for `0 ≤ a ≤ 4`, while the antiderivative difference
 *   `−1/a − 1/(4 − a)` is finite. The integral stays unevaluated unless the
 *   declared type of the symbol or an assumption proves the pole outside the
 *   bounds. In an iterated integral, the integration variable of an
 *   enclosing integral is examined over its range.
 * - A pole across which the integrand changes sign, or poles at both bounds
 *   with different signs: the integral has no value. `evaluate()` gives
 *   `Indeterminate` for an exact integrand, and `NaN` with a float.
 * - The flat MathJSON form `["Integrate", f, "y", lower, upper]` reads the
 *   bounds for any bound expressions.
 * - `NIntegrate(f, lower, upper)`: a `Tuple` of bounds is an error.
 *
 * The expected values were checked against a composite Simpson rule.
 */

const integral = (ce: ComputeEngine, body: unknown, limits: unknown[][]) =>
  ce.box(['Integrate', body, ...limits.map((l) => ['Limits', ...l])] as any);

describe('A POLE WHOSE POSITION IS A FREE SYMBOL', () => {
  const inverseSquare = (s: string) => ['Power', ['Subtract', 'y', s], -2];

  test('a free symbol: the integral stays unevaluated', () => {
    const ce = new ComputeEngine();
    const e = integral(ce, inverseSquare('a'), [['y', 0, 4]]);
    // Was `-1/a - 1/(4 - a)`, wrong for 0 ≤ a ≤ 4.
    expect(e.evaluate().operator).toBe('Integrate');
    expect(e.N().operator).toBe('Integrate');
  });

  test('a declared type that puts the pole outside: the closed form', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'real<..<0>');
    const value = integral(ce, inverseSquare('c'), [['y', 0, 4]]).evaluate();
    expect(value.has('Integrate')).toBe(false);
    // ∫₀⁴ (y + 1)⁻² dy = 0.8
    expect(value.subs({ c: -1 }).N().re).toBeCloseTo(0.8, 12);
  });

  test('an assumption that puts the pole outside: the closed form', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('b > 4'));
    const value = integral(ce, inverseSquare('b'), [['y', 0, 4]]).evaluate();
    expect(value.has('Integrate')).toBe(false);
    // ∫₀⁴ (y − 5)⁻² dy = 0.8
    expect(value.subs({ b: 5 }).N().re).toBeCloseTo(0.8, 12);

    ce.assume(ce.parse('k > 0'));
    // The pole of 1/(t + k) is at −k < 0.
    const shifted = integral(
      ce,
      ['Divide', 1, ['Add', 't', 'k']],
      [['t', 0, 1]]
    ).evaluate();
    expect(shifted.has('Integrate')).toBe(false);
    expect(shifted.subs({ k: 2 }).N().re).toBeCloseTo(Math.log(1.5), 12);
    // t² + k has no real root: its discriminant −4k is negative.
    const quadratic = integral(
      ce,
      ['Divide', 1, ['Add', ['Power', 't', 2], 'k']],
      [['t', 0, 1]]
    ).evaluate();
    expect(quadratic.has('Integrate')).toBe(false);
    expect(quadratic.subs({ k: 1 }).N().re).toBeCloseTo(Math.PI / 4, 12);
  });

  test('other pole sites with a free position', () => {
    const ce = new ComputeEngine();
    // The roots ±√(−m) are in [−1, 1] for −1 ≤ m ≤ 0.
    expect(
      integral(
        ce,
        ['Divide', 1, ['Add', ['Power', 't', 2], 'm']],
        [['t', -1, 1]]
      ).evaluate().operator
    ).toBe('Integrate');
    // The poles of tan(t − a) are at a + π/2 + kπ.
    expect(
      integral(ce, ['Tan', ['Subtract', 't', 'a']], [['t', 0, 1]]).evaluate()
        .operator
    ).toBe('Integrate');
    // 1/ln(t − a) has a pole at t = a + 1.
    expect(
      integral(
        ce,
        ['Divide', 1, ['Ln', ['Subtract', 't', 'a']]],
        [['t', 0, 1]]
      ).evaluate().operator
    ).toBe('Integrate');
  });

  test('an indefinite integral and an integrand with no pole are unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Integrate', inverseSquare('a'), 'y'])
        .evaluate()
        .has('Integrate')
    ).toBe(false);
    expect(
      integral(ce, ['Multiply', 'a', 't'], [['t', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('1/2 * a');
  });
});

describe('AN ITERATED INTEGRAL WITH A POLE THAT MOVES WITH THE OUTER VARIABLE', () => {
  // `Integrate(f, Limits(y, …), Limits(x, 3, 4))`: the integral in `x` is
  // evaluated first, and its pole is at `x = y`.
  const iterated = (ce: ComputeEngine, y: [unknown, unknown]) =>
    integral(
      ce,
      ['Power', ['Subtract', 'y', 'x'], -2],
      [
        ['y', ...y],
        ['x', 3, 4],
      ]
    );

  test('a pole inside for some values of the outer variable', () => {
    const ce = new ComputeEngine();
    const value = iterated(ce, [0, 10]).evaluate();
    // Was `∫₀¹⁰ (−1/(y − 3) + 1/(y − 4)) dy`, a wrong inner value for
    // 3 < y < 4, where the inner integral is +∞.
    expect(value.operator).toBe('Integrate');
    expect(value.toString()).not.toContain('y - 3');
    expect(iterated(ce, [0, 10]).N().toString()).toBe('+oo');
  });

  test('a pole outside for every value of the outer variable', () => {
    const ce = new ComputeEngine();
    // ∫₅¹⁰ ∫₃⁴ (y − x)⁻² dx dy = ln(12/7)
    const value = iterated(ce, [5, 10]).evaluate();
    expect(value.has('Integrate')).toBe(false);
    expect(value.N().re).toBeCloseTo(Math.log(12 / 7), 12);
    // ∫₅^∞ ∫₃⁴ (y − x)⁻² dx dy = ln 2
    const improper = iterated(ce, [5, 'PositiveInfinity']).evaluate();
    expect(improper.has('Integrate')).toBe(false);
    expect(improper.N().re).toBeCloseTo(Math.LN2, 12);
  });
});

describe('AN INTEGRAL WITH NO VALUE: Indeterminate OR NaN', () => {
  const ce = new ComputeEngine();
  const reciprocal = (numerator: number, a: number, b: number) =>
    integral(ce, ['Divide', numerator, 't'], [['t', a, b]]);

  test('an exact integrand that changes sign across a pole', () => {
    const value = reciprocal(1, -1, 1).evaluate();
    expect(value.isIndeterminate).toBe(true);
    expect(reciprocal(1, -1, 1).N().isNaN).toBe(true);
    expect(reciprocal(1, -1, 1).N().isIndeterminate).toBe(false);
  });

  test('a float operand gives NaN', () => {
    const coefficient = reciprocal(1.5, -1, 1).evaluate();
    expect(coefficient.isNaN).toBe(true);
    expect(coefficient.isIndeterminate).toBe(false);
    const bound = reciprocal(1, -0.5, 1).evaluate();
    expect(bound.isNaN).toBe(true);
    expect(bound.isIndeterminate).toBe(false);
  });

  test('poles at both bounds with different signs', () => {
    const body = (c: number) => [
      'Subtract',
      ['Divide', 1, 't'],
      ['Divide', c, ['Subtract', 1, 't']],
    ];
    expect(
      integral(ce, body(1), [['t', 0, 1]]).evaluate().isIndeterminate
    ).toBe(true);
    const float = integral(ce, body(1.5), [['t', 0, 1]]).evaluate();
    expect(float.isNaN).toBe(true);
    expect(float.isIndeterminate).toBe(false);
  });

  test('a one-sign pole is unchanged', () => {
    expect(
      integral(ce, ['Power', 't', -2], [['t', -1, 1]])
        .evaluate()
        .toString()
    ).toBe('+oo');
  });

  test('NIntegrate gives NaN', () => {
    const value = ce
      .box(['NIntegrate', ['Function', ['Divide', 1, 't'], 't'], -1, 1])
      .evaluate();
    expect(value.isNaN).toBe(true);
    expect(value.isIndeterminate).toBe(false);
  });
});

describe('A POLE AT A NUMBER, WITH A FREE SYMBOL IN A CONSTANT FACTOR', () => {
  // The pole of `1/(a·t)` at `t = 0` is located, but sampling cannot confirm
  // it while `a` is free. The integrand is split into `(1/a)·(1/t)` and the
  // pole of `1/t` is confirmed. These integrals gave the antiderivative
  // difference: `∫₋₁¹ dt/(a·t)` was `0`, `∫₋₁¹ dt/(a·t²)` was `−2/a`.
  const ce = new ComputeEngine();
  ce.declare('p', 'real');
  ce.assume(ce.parse('p > 0'));
  ce.declare('q', 'real');
  ce.assume(ce.parse('q < 0'));
  const at = (factor: unknown, power: number, a: number, b: number) =>
    integral(
      ce,
      ['Divide', 1, ['Multiply', factor, ['Power', 't', power]]],
      [['t', a, b]]
    );

  test('a sign change across the pole: no value', () => {
    // For a ≠ 0 the integrand changes sign across 0; for a = 0 it is
    // undefined everywhere. In both cases the integral has no value.
    expect(at('a', 1, -1, 1).evaluate().isIndeterminate).toBe(true);
    expect(at('a', 3, -1, 1).evaluate().isIndeterminate).toBe(true);
    expect(at(['Add', 'a', 1], 1, -1, 1).evaluate().isIndeterminate).toBe(true);
    const float = integral(
      ce,
      ['Divide', 1.5, ['Multiply', 'a', 't']],
      [['t', -1, 1]]
    ).evaluate();
    expect(float.isNaN).toBe(true);
    expect(float.isIndeterminate).toBe(false);
  });

  test('a factor that may be zero: unevaluated', () => {
    // `∫₋₁¹ a/t dt` is 0 for a = 0, and has no value otherwise.
    const e = integral(ce, ['Divide', 'a', 't'], [['t', -1, 1]]);
    expect(e.evaluate().operator).toBe('Integrate');
  });

  test('a pole of one sign: the sign of the factor decides', () => {
    expect(at('a', 2, -1, 1).evaluate().operator).toBe('Integrate');
    expect(at('p', 2, -1, 1).evaluate().toString()).toBe('+oo');
    expect(at('q', 2, -1, 1).evaluate().toString()).toBe('-oo');
    expect(at('p', 2, 1, -1).evaluate().toString()).toBe('-oo');
  });

  test('no pole between the bounds: the closed form', () => {
    expect(at('a', 1, 1, 2).evaluate().toString()).toBe('ln(2) / a');
  });

  test('a free symbol that is not a factor: unevaluated', () => {
    // `1/(t·(t² + a² + 1))` has its pole at `t = 0` for every `a`.
    const e = integral(
      ce,
      [
        'Divide',
        1,
        ['Multiply', 't', ['Add', ['Square', 't'], ['Square', 'a'], 1]],
      ],
      [['t', -1, 1]]
    );
    expect(e.evaluate().operator).toBe('Integrate');
  });
});

describe('A SYMBOL WITH NO DECLARED TYPE IS REAL, WHATEVER THE ENGINE DID BEFORE', () => {
  // A use of a symbol infers its type: after the antiderivative of
  // `1/(x² + a²)`, the inferred type of `a` is `complex | infinity`. The
  // decision "not declared by the user" reads the provenance of the type,
  // not the type, so the second integral evaluates as in a new engine. It
  // stayed unevaluated in the engine that had computed the first integral.
  test('two integrals in sequence on one engine', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\int \\frac{1}{x^2+a^2} dx').evaluate().operator
    ).not.toBe('Integrate');
    const second = '\\int_0^1 \\frac{1}{x^2+a^2+1} dx';
    const expected = new ComputeEngine().parse(second).evaluate().toString();
    expect(expected).toBe('arctan(1 / sqrt(a^2 + 1)) / sqrt(a^2 + 1)');
    expect(ce.parse(second).evaluate().toString()).toBe(expected);
  });

  test('a symbol declared by the user is not taken to be real', () => {
    // `∫₀¹ dt/(t + a² + 1)` has a pole at `t = −a² − 1`, which is outside
    // `[0, 1]` only for a real `a`.
    const ce = new ComputeEngine();
    ce.declare('a', 'number');
    const e = ce.parse('\\int_0^1 \\frac{1}{t+a^2+1} dt');
    expect(e.evaluate().operator).toBe('Integrate');
  });
});

describe('A MOVING POLE WITH AN INFINITE BOUND', () => {
  // `∫₃⁴ ∫₀^∞ (y − x)⁻² dy dx`: for each x the inner integral has a pole at
  // `y = x`, inside `[0, +∞)`. The scan for such poles placed its grid on
  // finite ranges only, and `.N()` gave `5140000000000000 ± 440000000000000`.
  const ce = new ComputeEngine();
  const body = ['Power', ['Subtract', 'y', 'x'], -2];

  test.each([
    [
      'inner infinite bound',
      [
        ['y', 0, 'PositiveInfinity'],
        ['x', 3, 4],
      ],
      '+oo',
    ],
    [
      'outer infinite bound',
      [
        ['x', 3, 4],
        ['y', 0, 'PositiveInfinity'],
      ],
      '+oo',
    ],
    [
      'reversed infinite range',
      [
        ['y', 'PositiveInfinity', 0],
        ['x', 3, 4],
      ],
      '-oo',
    ],
    [
      'two infinite bounds',
      [
        ['y', 'NegativeInfinity', 'PositiveInfinity'],
        ['x', 3, 4],
      ],
      '+oo',
    ],
  ])('%s', (_name, limits, expected) => {
    expect(
      integral(ce, body, limits as unknown[][])
        .N()
        .toString()
    ).toBe(expected);
  });

  test('a sign change across the moving pole: NaN', () => {
    const e = integral(
      ce,
      ['Divide', 1, ['Subtract', 'y', 'x']],
      [
        ['y', 0, 'PositiveInfinity'],
        ['x', 3, 4],
      ]
    );
    expect(e.N().isNaN).toBe(true);
  });

  test('a smooth integrand over infinite ranges is unchanged', () => {
    const e = integral(
      ce,
      ['Exp', ['Negate', ['Add', 'x', 'y']]],
      [
        ['y', 0, 'PositiveInfinity'],
        ['x', 0, 'PositiveInfinity'],
      ]
    ).N();
    expect(Math.abs(e.re - 1)).toBeLessThanOrEqual(1e-9);
  });
});

describe('THE FLAT FORM ["Integrate", f, "y", lower, upper]', () => {
  const ce = new ComputeEngine();
  const limitsOf = (e: unknown[]) =>
    JSON.stringify(ce.box(['Integrate', ...e] as any).json.slice(2));

  test('a symbolic bound is a bound', () => {
    const e = ce.box(['Integrate', ['Power', 'y', 2], 'y', 0, 'Pi']);
    expect(JSON.stringify(e.json.slice(2))).toBe('[["Limits","y",0,"Pi"]]');
    // ∫₀^π y² dy = π³/3 (was −π/3)
    expect(e.evaluate().N().re).toBeCloseTo(Math.PI ** 3 / 3, 12);
    expect(
      ce
        .box(['Integrate', ['Power', 'y', 2], 'y', 0, 'b'])
        .evaluate()
        .toString()
    ).toBe('1/3 * b^3');
    expect(
      limitsOf([['Power', 'y', 2], 'y', 'Pi', ['Multiply', 2, 'Pi']])
    ).toBe('[["Limits","y","Pi",["Multiply",2,"Pi"]]]');
  });

  test('variable names after the variable are more variables', () => {
    expect(limitsOf([['Multiply', 'x', 'y', 'z'], 'x', 'y', 'z'])).toBe(
      '[["Limits","x","Nothing","Nothing"],["Limits","y","Nothing","Nothing"],["Limits","z","Nothing","Nothing"]]'
    );
    expect(limitsOf([['Multiply', 'x', 'y'], 'x', 'y', 0, 2])).toBe(
      '[["Limits","x","Nothing","Nothing"],["Limits","y",0,2]]'
    );
    expect(limitsOf([['Multiply', 'x', 'y'], 'x', 0, 1, 'y', 0, 2])).toBe(
      '[["Limits","x",0,1],["Limits","y",0,2]]'
    );
  });

  test('the Epsil call form', () => {
    const value: any = executeEpsil(new ComputeEngine(), '∫(y^2, y, 0, π)');
    expect(value.value.N().re).toBeCloseTo(Math.PI ** 3 / 3, 12);
  });
});

describe('NIntegrate BOUNDS', () => {
  const ce = new ComputeEngine();

  test('two number bounds', () => {
    expect(
      ce.box(['NIntegrate', ['Power', 'x', 2], 0, 2]).evaluate().re
    ).toBeCloseTo(8 / 3, 12);
  });

  test('a Tuple of bounds is a type error', () => {
    const e = ce.box(['NIntegrate', ['Power', 'x', 2], ['Tuple', 0, 2]]);
    expect(e.isValid).toBe(false);
    const double = ce.box([
      'NIntegrate',
      ['Function', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 'x', 'y'],
      ['Tuple', 0, 2],
      ['Tuple', 1, 3],
    ]);
    expect(double.isValid).toBe(false);
  });

  test('a missing bound is an error', () => {
    expect(ce.box(['NIntegrate', ['Power', 'x', 2], 0]).isValid).toBe(false);
  });
});
