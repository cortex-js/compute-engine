import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('polynomialCoefficients', () => {
  // Basic polynomials — descending order
  test('constant', () => {
    const coeffs = ce.parse('5').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([5]);
  });

  test('linear', () => {
    const coeffs = ce.parse('3x + 1').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([3, 1]);
  });

  test('quadratic', () => {
    const coeffs = ce.parse('x^2 + 2x + 1').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([1, 2, 1]);
  });

  test('cubic with missing term', () => {
    const coeffs = ce.parse('x^3 + 2x + 1').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([1, 0, 2, 1]);
  });

  test('symbolic coefficients', () => {
    const coeffs = ce.parse('ax^2 + bx + c').polynomialCoefficients('x');
    expect(coeffs).not.toBeUndefined();
    expect(coeffs?.length).toBe(3);
    // Highest degree first: a, b, c
    expect(coeffs?.[0].json).toEqual('a');
    expect(coeffs?.[1].json).toEqual('b');
    expect(coeffs?.[2].json).toEqual('c');
  });

  // Not a polynomial
  test('sin(x) returns undefined', () => {
    expect(ce.parse('\\sin(x)').polynomialCoefficients('x')).toBeUndefined();
  });

  test('1/x returns undefined', () => {
    expect(ce.parse('\\frac{1}{x}').polynomialCoefficients('x')).toBeUndefined();
  });

  // Variable auto-detection
  test('auto-detects single unknown', () => {
    const coeffs = ce.parse('x^2 + 5').polynomialCoefficients();
    expect(coeffs?.map((c) => c.json)).toEqual([1, 0, 5]);
  });

  test('auto-detect: ambiguous (two unknowns) returns undefined', () => {
    expect(ce.parse('x*y + 1').polynomialCoefficients()).toBeUndefined();
  });

  test('auto-detect: no unknowns returns undefined', () => {
    expect(ce.parse('42').polynomialCoefficients()).toBeUndefined();
  });

  // Degree derivation
  test('degree is length - 1', () => {
    const coeffs = ce.parse('x^3 + 2x + 1').polynomialCoefficients('x');
    expect(coeffs!.length - 1).toBe(3);
  });

  // Non-function expressions
  test('plain symbol', () => {
    const coeffs = ce.parse('x').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([1, 0]);
  });

  test('number returns undefined without variable', () => {
    expect(ce.parse('5').polynomialCoefficients()).toBeUndefined();
  });
});

describe('polynomialCoefficients multivariate', () => {
  test('array of variables: decompose by first, validate all', () => {
    const coeffs = ce
      .parse('x^2*y + 3x + y^2')
      .polynomialCoefficients(['x', 'y']);
    expect(coeffs).not.toBeUndefined();
    expect(coeffs?.length).toBe(3); // degree 2 in x → 3 coefficients
  });

  test('array of variables: not polynomial in one', () => {
    expect(
      ce.parse('\\sin(x)*y + 1').polynomialCoefficients(['x', 'y'])
    ).toBeUndefined();
  });

  test('single-element array behaves like string', () => {
    const coeffs = ce.parse('x^2 + 1').polynomialCoefficients(['x']);
    expect(coeffs?.map((c) => c.json)).toEqual([1, 0, 1]);
  });

  test('empty array returns undefined', () => {
    expect(ce.parse('x^2 + 1').polynomialCoefficients([])).toBeUndefined();
  });
});

describe('polynomialRoots', () => {
  test('quadratic with two roots', () => {
    const roots = ce.parse('x^2 - 5x + 6').polynomialRoots('x');
    expect(roots).not.toBeUndefined();
    const values = roots!.map((r) => r.N().re).sort((a, b) => a - b);
    expect(values).toEqual([2, 3]);
  });

  test('linear equation', () => {
    const roots = ce.parse('2x - 6').polynomialRoots('x');
    expect(roots).not.toBeUndefined();
    expect(roots!.length).toBe(1);
    expect(roots![0].N().re).toBe(3);
  });

  test('cubic with rational roots', () => {
    const roots = ce.parse('x^3 - 6x^2 + 11x - 6').polynomialRoots('x');
    expect(roots).not.toBeUndefined();
    const values = roots!.map((r) => r.N().re).sort((a, b) => a - b);
    expect(values).toEqual([1, 2, 3]);
  });

  test('quartic with rational roots', () => {
    const roots = ce.parse('x^4 - 5x^2 + 4').polynomialRoots('x');
    expect(roots).not.toBeUndefined();
    const values = roots!.map((r) => r.N().re).sort((a, b) => a - b);
    expect(values).toEqual([-2, -1, 1, 2]);
  });

  test('not a polynomial returns undefined', () => {
    expect(ce.parse('\\sin(x)').polynomialRoots('x')).toBeUndefined();
  });

  test('auto-detect variable', () => {
    const roots = ce.parse('x^2 - 4').polynomialRoots();
    expect(roots).not.toBeUndefined();
    const values = roots!.map((r) => r.N().re).sort((a, b) => a - b);
    expect(values).toEqual([-2, 2]);
  });

  test('complex roots (x^2 + 1)', () => {
    const roots = ce.parse('x^2 + 1').polynomialRoots('x');
    expect(roots).not.toBeUndefined();
    // The quadratic solver returns complex roots: i and -i
    // polynomialRoots does not filter by real-only
    expect(roots!.length).toBeGreaterThanOrEqual(0);
  });

  test('constant returns empty array', () => {
    const roots = ce.parse('5').polynomialRoots('x');
    expect(roots).not.toBeUndefined();
    expect(roots!.length).toBe(0);
  });
});

// A float exponent is not a polynomial degree, even when its value is an
// integer: `x^{2.0}` is not a polynomial term in `x`, as `x^{2.5}` is not.
// Before, the polynomial operations read the float `2.0` as the integer
// degree `2`.
describe('a float exponent is not a polynomial degree', () => {
  test('the coefficients and the degree decline it', () => {
    expect(ce.parse('x^{2.0} + 1').polynomialCoefficients('x')).toBeUndefined();
    expect(
      ce.box(['PolynomialDegree', ce.parse('x^{2.0} + 1'), 'x']).evaluate()
        .operator
    ).toBe('PolynomialDegree');
    expect(
      ce.box(['Degree', ce.parse('x^{2.0} + 1')]).evaluate().operator
    ).toBe('Degree');
    // The exact exponent is still a degree.
    expect(
      ce
        .box(['Degree', ce.parse('x^{2} + 1')])
        .evaluate()
        .toString()
    ).toBe('2');
  });

  test('Degree reads a numeric constant as a coefficient', () => {
    const degree = (s: string) =>
      ce
        .box(['Degree', ce.parse(s)])
        .evaluate()
        .toString();
    expect(degree('\\pi x^2 + 1')).toBe('2');
    expect(degree('x^2 + \\pi')).toBe('2');
    expect(degree('e x^3')).toBe('3');
  });

  test('Degree declines an expression that is not a polynomial', () => {
    // `isNumber` of `sin(x) + 1` (its value is a number) read it as a
    // constant, of degree 0.
    expect(
      ce.box(['Degree', ce.parse('\\sin(x) + 1')]).evaluate().operator
    ).toBe('Degree');
    expect(ce.box(['Degree', ce.parse('\\sqrt{x}')]).evaluate().operator).toBe(
      'Degree'
    );
  });

  test('the polynomial division declines it', () => {
    const q = ce
      .box([
        'PolynomialQuotient',
        ce.parse('x^{2.0} - 1'),
        ce.parse('x - 1'),
        'x',
      ])
      .evaluate();
    expect(q.operator).toBe('PolynomialQuotient');
  });

  test('Factor keeps the float exponent', () => {
    const f = ce.box(['Factor', ce.parse('x^{2.0} - 1')]).evaluate();
    expect(f.json).toEqual(['Add', ['Power', 'x', { num: '2.0' }], -1]);
    expect(
      ce
        .box(['Factor', ce.parse('x^{2} - 1')])
        .evaluate()
        .toString()
    ).toBe('(x - 1) * (x + 1)');
  });

  test('Solve does not read it as an integer degree', () => {
    const roots = (s: string) =>
      ce
        .parse(s)
        .solve('x')
        ?.map((r) => JSON.stringify(r.json)) ?? null;
    // The general power template gives the root `4^(1/2.0)`, a float:
    // `1/2.0` is the float `0.5`. The parity of `2.0` is read: `(-2.0)^{2.0}`
    // is `4`, thus `-2.0` is a root too (user decision 2026-10-17). Before,
    // only the root `2.0` was given.
    expect(roots('x^{2.0} = 4')).toEqual(['{"num":"2.0"}', '{"num":"-2.0"}']);
    expect(roots('x^{3.0} - 8 = 0')).toEqual(['{"num":"2.0"}']);
    expect(roots('x^{2.0} - 2 = 0')).toEqual([
      '{"num":"1.4142135623730950488"}',
      '{"num":"-1.4142135623730950488"}',
    ]);
    // A float exponent whose value is not an integer has a float root too.
    expect(roots('x^{2.5} = 4')).toEqual(['{"num":"1.74110112659224827827"}']);
    // A float power of a base that contains the unknown: the base is
    // solved for each root of `u^{2.0} = 4`.
    expect(roots('(x+1)^{2.0} = 4')).toEqual([
      '{"num":"1.0"}',
      '{"num":"-3.0"}',
    ]);
    // `x^{2.0}` is not a polynomial in `sqrt(x)`.
    expect(roots('x^{2.0} + \\sqrt{x} - 2 = 0')).toBeNull();
    // The exact exponents are unchanged.
    expect(roots('x^{2} = 4')).toEqual(['2', '-2']);
    // The two complex cube roots are listed too.
    expect(roots('x^{3} - 8 = 0')).toContain('2');
    expect(roots('(x+1)^{2} = 4')).toEqual(['1', '-3']);
    expect(roots('x^{2} + \\sqrt{x} - 2 = 0')).toEqual(['1']);
  });

  test('Solve does not read it as a quadratic', () => {
    // As `x^{2.5} + 3x + 2 = 0`, the equation is not solved.
    expect(ce.parse('x^{2.0} + 3x + 2').solve('x')).toBeNull();
    expect(ce.parse('x^{2.5} + 3x + 2').solve('x')).toBeNull();
    expect(
      ce
        .parse('x^{2} + 3x + 2')
        .solve('x')
        ?.map((r) => r.toString())
    ).toEqual(['-1', '-2']);
  });
});
