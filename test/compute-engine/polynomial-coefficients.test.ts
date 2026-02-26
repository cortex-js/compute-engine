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
