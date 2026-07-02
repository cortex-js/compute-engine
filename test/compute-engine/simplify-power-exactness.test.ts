import { ComputeEngine } from '../../src/compute-engine';

// Regression tests for SYMBOLIC_FINDINGS.md P0-3 (WP-1.5):
//
// The Multiply-side power-combining rules in simplify-power.ts and
// simplify-rules.ts used the `.add()` METHOD to sum exponents. That method
// folds two exact number literals (e.g. `1 + sqrt(2)`) to a machine float,
// destroying exactness. The Divide-side siblings already used the correct
// pattern (`ce.function('Add', [...])`, a canonical Add) to keep the sum
// symbolic/exact. This file locks in that the Multiply side now matches.

describe('simplify-power exactness (Multiply-side exponent combination)', () => {
  const ce = new ComputeEngine();

  it('x * x^sqrt(2) keeps the exponent exact (1 + sqrt(2))', () => {
    const result = ce.parse('x \\cdot x^{\\sqrt{2}}').simplify();
    expect(result.json).toEqual(['Power', 'x', ['Add', 1, ['Sqrt', 2]]]);
  });

  it('x^sqrt(2) * x keeps the exponent exact (sqrt(2) + 1)', () => {
    // Symmetric to the case above (x^n * x, not x * x^n)
    const result = ce.parse('x^{\\sqrt{2}} \\cdot x').simplify();
    expect(result.operator).toBe('Power');
    expect(result.op1.json).toEqual('x');
    // The exponent must be an exact Add of 1 and Sqrt(2), not a float
    expect(result.op2.operator).toBe('Add');
    expect(result.op2.isSame(ce.box(['Add', 1, ['Sqrt', 2]]))).toBe(true);
  });

  it('x^sqrt(2) * x^sqrt(3) keeps the exponent exact (sqrt(2) + sqrt(3))', () => {
    const result = ce.parse('x^{\\sqrt{2}} \\cdot x^{\\sqrt{3}}').simplify();
    expect(result.json).toEqual([
      'Power',
      'x',
      ['Add', ['Sqrt', 2], ['Sqrt', 3]],
    ]);
  });

  it('2^sqrt(2) * 2^sqrt(3) keeps the exponent exact (sqrt(2) + sqrt(3))', () => {
    const result = ce.parse('2^{\\sqrt{2}} \\cdot 2^{\\sqrt{3}}').simplify();
    expect(result.json).toEqual([
      'Power',
      2,
      ['Add', ['Sqrt', 2], ['Sqrt', 3]],
    ]);
  });

  it('same-base combination with multiple exact exponents stays exact (simplify-rules.ts groups)', () => {
    // Exercises the N-ary same-base combination path (baseGroups) in
    // simplify-rules.ts, which also summed exponents via .reduce(add).
    const result = ce
      .parse('x^{\\sqrt{2}} \\cdot x^{\\sqrt{3}} \\cdot x^{\\sqrt{5}}')
      .simplify();
    expect(result.operator).toBe('Power');
    expect(result.op1.json).toEqual('x');
    expect(
      result.op2.isSame(
        ce.box(['Add', ['Sqrt', 2], ['Sqrt', 3], ['Sqrt', 5]])
      )
    ).toBe(true);
  });

  // Controls: make sure the numeric-folding behavior for plain integer/rational
  // exponents (where becoming an exact number, not a float, is correct) is
  // unaffected by routing through canonical Add instead of .add().
  it('control: x * x^2 still folds to x^3', () => {
    const result = ce.parse('x \\cdot x^2').simplify();
    expect(result.json).toEqual(['Power', 'x', 3]);
  });

  it('control: x^2 * x^3 still folds to x^5', () => {
    const result = ce.parse('x^2 \\cdot x^3').simplify();
    expect(result.json).toEqual(['Power', 'x', 5]);
  });

  it('control: Divide-side same-base exponent combination remains exact', () => {
    const result = ce.parse('x^{\\sqrt{2}} / x^3').simplify();
    expect(result.json).toEqual(['Power', 'x', ['Add', -3, ['Sqrt', 2]]]);
  });
});
