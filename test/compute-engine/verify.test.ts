import { ComputeEngine } from '../../src/compute-engine';

describe('VERIFY', () => {
  test('returns undefined when predicate cannot be decided', () => {
    const ce = new ComputeEngine();
    expect(ce.verify(ce.box(['Greater', 'x', 0]))).toBe(undefined);
  });

  test('returns true/false when predicate can be decided from assumptions', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 4'));
    expect(ce.verify(ce.box(['Greater', 'x', 0]))).toBe(true);
    expect(ce.verify(ce.box(['Less', 'x', 0]))).toBe(false);
  });

  test('uses 3-valued semantics for And/Or/Not', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));

    expect(
      ce.verify(ce.box(['And', ['Greater', 'x', 0], ['Less', 'x', 0]]))
    ).toBe(false);

    expect(
      ce.verify(ce.box(['And', ['Greater', 'x', 0], ['Greater', 'y', 0]]))
    ).toBe(undefined);

    expect(
      ce.verify(ce.box(['Or', ['Greater', 'x', 0], ['Greater', 'y', 0]]))
    ).toBe(true);

    expect(ce.verify(ce.box(['Not', ['Greater', 'x', 0]]))).toBe(false);
  });

  test('supports Element/NotElement with type-style RHS', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'finite_real');
    expect(ce.verify(ce.box(['Element', 'x', 'finite_real']))).toBe(true);

    ce.declare('s', 'string');
    expect(ce.verify(ce.box(['Element', 's', 'number']))).toBe(false);
    expect(ce.verify(ce.box(['NotElement', 's', 'number']))).toBe(true);

    ce.declare('r', 'real');
    expect(ce.verify(ce.box(['Element', 'r', 'finite_real']))).toBe(undefined);
    expect(ce.verify(ce.box(['NotElement', 'r', 'finite_real']))).toBe(
      undefined
    );
  });

  // Regression tests for recursion bug (issue from 2026-02-01)
  // Previously caused: RangeError: Maximum call stack size exceeded
  // The bug was caused by: eq() → ask() → verify() → Equal.evaluate() → eq()
  test('verify(Equal) does not cause stack overflow', () => {
    const ce = new ComputeEngine();
    // These should not cause infinite recursion
    expect(ce.verify(ce.box(['Equal', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.box(['Equal', 'x', 1]))).toBe(undefined);
    // Different symbols are not equal (they represent different entities)
    expect(ce.verify(ce.box(['Equal', 'x', 'y']))).toBe(false);
    // Same symbol is equal to itself
    expect(ce.verify(ce.box(['Equal', 'x', 'x']))).toBe(true);
  });

  test('verify(NotEqual) does not cause stack overflow', () => {
    const ce = new ComputeEngine();
    // These should not cause infinite recursion
    expect(ce.verify(ce.box(['NotEqual', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.box(['NotEqual', 'x', 1]))).toBe(undefined);
    // Different symbols are not equal (so NotEqual is true)
    expect(ce.verify(ce.box(['NotEqual', 'x', 'y']))).toBe(true);
    // Same symbol is equal to itself (so NotEqual is false)
    expect(ce.verify(ce.box(['NotEqual', 'x', 'x']))).toBe(false);
  });

  test('Equal/NotEqual use 3-valued logic in verification mode', () => {
    const ce = new ComputeEngine();
    // In verification mode, unknown comparisons should return undefined
    expect(ce.verify(ce.box(['Equal', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.box(['NotEqual', 'x', 0]))).toBe(undefined);

    // But when evaluated directly (not in verify), they return False/True
    expect(ce.box(['Equal', 'x', 0]).evaluate().symbol).toBe('False');
    expect(ce.box(['NotEqual', 'x', 0]).evaluate().symbol).toBe('True');
  });

  test('Less/Greater/LessEqual/GreaterEqual do not cause stack overflow', () => {
    const ce = new ComputeEngine();
    // These should not cause infinite recursion (they use cmp(), not eq())
    expect(ce.verify(ce.box(['Less', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.box(['Greater', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.box(['LessEqual', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.box(['GreaterEqual', 'x', 0]))).toBe(undefined);
  });

  test('Less/Greater consistently return undefined for unknown comparisons', () => {
    const ce = new ComputeEngine();
    // Unlike Equal/NotEqual, inequality operators return undefined in both modes
    // This is because inequalities are fundamentally different from equality
    expect(ce.verify(ce.box(['Less', 'x', 0]))).toBe(undefined);
    expect(ce.box(['Less', 'x', 0]).evaluate().operator).toBe('Less'); // Remains unevaluated

    expect(ce.verify(ce.box(['Greater', 'x', 0]))).toBe(undefined);
    expect(ce.box(['Greater', 'x', 0]).evaluate().operator).toBe('Less'); // Canonical form
  });
});

