import { ComputeEngine } from '../../src/compute-engine';

/**
 * A rounded big float whose value at the working precision is an integer
 * reports `isExact`, and several exact operations accepted such a value as an
 * exact result: `2√(1 + 10^-30) − 2` was an exact `0`, `2^{10^-30}` an exact
 * `1`, and the rational `(5·10^29 + 1)/10^30` was the same as `0.5`, so
 * `2^{1/2 + 10^-30}` was `√2`. Only an `ExactNumericValue` is exact; an
 * exact operation that cannot stay exact stays symbolic.
 */
describe('a rounded float is never an exact result', () => {
  const ce = new ComputeEngine();
  const p = (s: string) => ce.parse(s);

  test('a radical whose root is not exact stays whole under a coefficient', () => {
    expect(p('2\\sqrt{1+10^{-30}}-2').evaluate().isSame(0)).toBe(false);
    expect(p('2\\sqrt{1+10^{-30}}-2').evaluate().operator).toBe('Add');
    expect(p('\\sqrt{1+10^{-30}}-1').evaluate().operator).toBe('Add');
    // At a precision that resolves the difference, the value is 1e-30.
    const fine = new ComputeEngine();
    fine.precision = 50;
    expect(
      fine.parse('2\\sqrt{1+10^{-30}}-2').N().toString().startsWith('1e-30')
    ).toBe(true);
  });

  test('a perfect square is still extracted', () => {
    expect(p('\\sqrt{8}').evaluate().toString()).toBe('2sqrt(2)');
    expect(p('\\sqrt{12}').evaluate().toString()).toBe('2sqrt(3)');
    expect(p('2\\sqrt{1000003}').evaluate().toString()).toBe('2sqrt(1000003)');
  });

  test('a root that is not exact stays symbolic', () => {
    expect(p('2^{10^{-30}}').evaluate().isSame(1)).toBe(false);
    expect(p('2^{10^{-30}}').evaluate().operator).toBe('Power');
    expect(p('(1+10^{-30})^{1/3}').evaluate().isSame(1)).toBe(false);
    expect(p('(1+10^{-30})^{1/3}').evaluate().operator).toBe('Root');
    // Exact roots and powers are unchanged.
    expect(p('\\sqrt[3]{8}').evaluate().toString()).toBe('2');
    expect(p('8^{2/3}').evaluate().toString()).toBe('4');
    expect(p('(-8)^{5/3}').evaluate().toString()).toBe('-32');
    expect(p('2^{127}').evaluate().toString()).toBe(
      '170141183460469231731687303715884105728'
    );
    expect(p('(\\frac{1}{8})^{1/3}').evaluate().toString()).toBe('1/2');
  });

  test('a rational exponent past the safe integers keeps the power symbolic', () => {
    const e = p('2^{1/2+10^{-30}}').evaluate();
    expect(e.operator).toBe('Power');
    expect(e.isSame(p('\\sqrt{2}').evaluate())).toBe(false);
    expect(p('x^{1/2+10^{-30}}').evaluate().operator).toBe('Power');
    expect(p('x^{1/2}').evaluate().toString()).toBe('sqrt(x)');
  });

  test('isSame compares a non-integer exact literal with a double exactly', () => {
    const r = p('1/2+10^{-30}').evaluate();
    expect(r.isSame(0.5)).toBe(false);
    expect(ce.box(['Rational', 1, 2]).isSame(0.5)).toBe(true);
    expect(ce.box(['Rational', 1, 4]).isSame(0.25)).toBe(true);
    expect(ce.box(['Rational', -3, 2]).isSame(-1.5)).toBe(true);
    expect(ce.box(['Rational', 1, 3]).isSame(0.3333333333333333)).toBe(false);
    expect(ce.box(['Sqrt', 2]).isSame(1.4142135623730951)).toBe(false);
    expect(ce.box(2).isSame(2)).toBe(true);
  });
});
