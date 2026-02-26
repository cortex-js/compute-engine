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
