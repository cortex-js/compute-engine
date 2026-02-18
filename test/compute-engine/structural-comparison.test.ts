import { engine as ce } from '../utils';

/**
 * Tests for structural comparison of expressions using partial
 * canonicalization. This verifies that expressions can be compared
 * modulo commutativity and associativity without numeric evaluation.
 *
 * Use case: checking that a student used the right *method* to solve a
 * problem (e.g. "3×2+1") rather than just getting the right *answer* (7).
 */

describe('Partial canonicalization: form Order', () => {
  it('sorts commutative Add operands', () => {
    const a = ce.parse('3\\times2+1', { form: ['Order'] });
    const b = ce.parse('1+3\\times2', { form: ['Order'] });
    expect(a.isSame(b)).toBe(true);
  });

  it('sorts commutative Multiply operands', () => {
    const a = ce.parse('3\\times2+1', { form: ['Order'] });
    const b = ce.parse('1+2\\times3', { form: ['Order'] });
    expect(a.isSame(b)).toBe(true);
  });

  it('rejects numeric evaluation', () => {
    const a = ce.parse('3\\times2+1', { form: ['Order'] });
    const b = ce.parse('7', { form: ['Order'] });
    expect(a.isSame(b)).toBe(false);
  });

  it('rejects different operands', () => {
    const a = ce.parse('3\\times2+1', { form: ['Order'] });
    const b = ce.parse('2\\times3.5', { form: ['Order'] });
    expect(a.isSame(b)).toBe(false);
  });
});

describe('Partial canonicalization: form Flatten + Order', () => {
  it('unwraps parentheses (Delimiter) and sorts', () => {
    const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
    const b = ce.parse('1+(3\\times2)', { form: ['Flatten', 'Order'] });
    expect(a.isSame(b)).toBe(true);
  });

  it('sorts commutative operands after flattening', () => {
    const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
    const b = ce.parse('1+3\\times2', { form: ['Flatten', 'Order'] });
    expect(a.isSame(b)).toBe(true);
  });

  it('sorts Multiply operands inside Add', () => {
    const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
    const b = ce.parse('1+2\\times3', { form: ['Flatten', 'Order'] });
    expect(a.isSame(b)).toBe(true);
  });

  it('does not fold numerics (rejects 7)', () => {
    const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
    const b = ce.parse('7', { form: ['Flatten', 'Order'] });
    expect(a.isSame(b)).toBe(false);
  });

  it('rejects different structure', () => {
    const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
    const b = ce.parse('2\\times3.5', { form: ['Flatten', 'Order'] });
    expect(a.isSame(b)).toBe(false);
  });

  it('rejects different operations (6+1 vs 3*2+1)', () => {
    const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
    const b = ce.parse('6+1', { form: ['Flatten', 'Order'] });
    expect(a.isSame(b)).toBe(false);
  });

  it('rejects different operations (14\\div2 vs 3*2+1)', () => {
    const a = ce.parse('3\\times2+1', { form: ['Flatten', 'Order'] });
    const b = ce.parse('14\\div2', { form: ['Flatten', 'Order'] });
    expect(a.isSame(b)).toBe(false);
  });
});

describe('Flatten + Order: Negate and Subtract', () => {
  const opts = { form: ['Flatten', 'Order'] as const };

  it('subtraction normalizes to Add+Negate: 1-x vs -x+1', () => {
    // Parser normalizes subtraction to Add(Negate(...), ...) even in raw mode,
    // so both produce Add(1, Negate(x)) after sorting
    const a = ce.parse('1-x', opts);
    const b = ce.parse('-x+1', opts);
    expect(a.isSame(b)).toBe(true);
  });

  it('negation placement matters: 1-3*2 vs 1-2*3', () => {
    // Parser produces Add(1, Multiply(Negate(3), 2)) vs Add(1, Multiply(Negate(2), 3))
    // The negation is on different operands, so these are structurally different
    const a = ce.parse('1-3\\times2', opts);
    const b = ce.parse('1-2\\times3', opts);
    expect(a.isSame(b)).toBe(false);
  });

  it('does not fold subtraction: 5-3 is not 2', () => {
    const a = ce.parse('5-3', opts);
    const b = ce.parse('2', opts);
    expect(a.isSame(b)).toBe(false);
  });
});

describe('Flatten + Order: nested associative operations', () => {
  const opts = { form: ['Flatten', 'Order'] as const };

  it('flattens nested Add: (1+2)+3 vs 1+2+3', () => {
    const a = ce.parse('(1+2)+3', opts);
    const b = ce.parse('1+2+3', opts);
    expect(a.isSame(b)).toBe(true);
  });

  it('flattens nested Multiply: (2\\times3)\\times4 vs 2\\times3\\times4', () => {
    const a = ce.parse('(2\\times3)\\times4', opts);
    const b = ce.parse('2\\times3\\times4', opts);
    expect(a.isSame(b)).toBe(true);
  });

  it('flattens and sorts: (3+1)+2 vs 1+2+3', () => {
    const a = ce.parse('(3+1)+2', opts);
    const b = ce.parse('1+2+3', opts);
    expect(a.isSame(b)).toBe(true);
  });

  it('does not fold nested numerics: (1+2)+3 is not 6', () => {
    const a = ce.parse('(1+2)+3', opts);
    const b = ce.parse('6', opts);
    expect(a.isSame(b)).toBe(false);
  });
});

describe('Flatten + Order: Delimiter inside non-associative functions', () => {
  const opts = { form: ['Flatten', 'Order'] as const };

  it('unwraps Delimiter inside Sqrt: sqrt((x)) vs sqrt(x)', () => {
    const a = ce.parse('\\sqrt{(x)}', opts);
    const b = ce.parse('\\sqrt{x}', opts);
    expect(a.isSame(b)).toBe(true);
  });

  it('unwraps Delimiter inside Power exponent', () => {
    const a = ce.parse('x^{(2)}', opts);
    const b = ce.parse('x^{2}', opts);
    expect(a.isSame(b)).toBe(true);
  });
});

describe('Flatten + Order: mixed operations', () => {
  const opts = { form: ['Flatten', 'Order'] as const };

  it('sorts Multiply and Add independently: (2+3)*4 vs 4*(3+2)', () => {
    const a = ce.parse('(2+3)\\times4', opts);
    const b = ce.parse('4\\times(3+2)', opts);
    expect(a.isSame(b)).toBe(true);
  });

  it('preserves nesting: (2+3)*4 is not 2+3*4', () => {
    const a = ce.parse('(2+3)\\times4', opts);
    const b = ce.parse('2+3\\times4', opts);
    expect(a.isSame(b)).toBe(false);
  });

  it('does not fold across operations: 2*3+4*5 is not 26', () => {
    const a = ce.parse('2\\times3+4\\times5', opts);
    const b = ce.parse('26', opts);
    expect(a.isSame(b)).toBe(false);
  });

  it('sorts within each level: 5*4+3*2 vs 2*3+4*5', () => {
    const a = ce.parse('5\\times4+3\\times2', opts);
    const b = ce.parse('2\\times3+4\\times5', opts);
    expect(a.isSame(b)).toBe(true);
  });
});

describe('form: structural parses correctly', () => {
  it('produces a bound expression', () => {
    const expr = ce.parse('3\\times2+1', { form: 'structural' });
    expect(expr.operator).toBe('Add');
    expect(expr.isStructural).toBe(true);
  });

  it('does not fold numerics', () => {
    const expr = ce.parse('3\\times2+1', { form: 'structural' });
    // Should NOT be folded to 7
    expect(expr.isNumberLiteral).toBe(false);
    expect(expr.operator).toBe('Add');
  });
});
