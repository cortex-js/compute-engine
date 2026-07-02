import { ComputeEngine } from '../../src/compute-engine';

describe('VERIFY', () => {
  test('returns undefined when predicate cannot be decided', () => {
    const ce = new ComputeEngine();
    expect(ce.verify(ce.expr(['Greater', 'x', 0]))).toBe(undefined);
  });

  test('returns true/false when predicate can be decided from assumptions', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 4'));
    expect(ce.verify(ce.expr(['Greater', 'x', 0]))).toBe(true);
    expect(ce.verify(ce.expr(['Less', 'x', 0]))).toBe(false);
  });

  test('uses 3-valued semantics for And/Or/Not', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));

    expect(
      ce.verify(ce.expr(['And', ['Greater', 'x', 0], ['Less', 'x', 0]]))
    ).toBe(false);

    expect(
      ce.verify(ce.expr(['And', ['Greater', 'x', 0], ['Greater', 'y', 0]]))
    ).toBe(undefined);

    expect(
      ce.verify(ce.expr(['Or', ['Greater', 'x', 0], ['Greater', 'y', 0]]))
    ).toBe(true);

    expect(ce.verify(ce.expr(['Not', ['Greater', 'x', 0]]))).toBe(false);
  });

  test('supports Element/NotElement with type-style RHS', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'finite_real');
    expect(ce.verify(ce.expr(['Element', 'x', 'finite_real']))).toBe(true);

    ce.declare('s', 'string');
    expect(ce.verify(ce.expr(['Element', 's', 'number']))).toBe(false);
    expect(ce.verify(ce.expr(['NotElement', 's', 'number']))).toBe(true);

    ce.declare('r', 'real');
    expect(ce.verify(ce.expr(['Element', 'r', 'finite_real']))).toBe(undefined);
    expect(ce.verify(ce.expr(['NotElement', 'r', 'finite_real']))).toBe(
      undefined
    );
  });

  // Regression tests for recursion bug (issue from 2026-02-01)
  // Previously caused: RangeError: Maximum call stack size exceeded
  // The bug was caused by: eq() → ask() → verify() → Equal.evaluate() → eq()
  test('verify(Equal) does not cause stack overflow', () => {
    const ce = new ComputeEngine();
    // These should not cause infinite recursion
    expect(ce.verify(ce.expr(['Equal', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.expr(['Equal', 'x', 1]))).toBe(undefined);
    // Two distinct *free* symbols are not provably unequal — they could be
    // constrained equal by an assumption (`assume(x = y)`). Equality of
    // unconstrained symbols is indeterminate (WP-2.4 / P0-30), not `false`.
    expect(ce.verify(ce.expr(['Equal', 'x', 'y']))).toBe(undefined);
    // Same symbol is equal to itself
    expect(ce.verify(ce.expr(['Equal', 'x', 'x']))).toBe(true);
  });

  test('verify(NotEqual) does not cause stack overflow', () => {
    const ce = new ComputeEngine();
    // These should not cause infinite recursion
    expect(ce.verify(ce.expr(['NotEqual', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.expr(['NotEqual', 'x', 1]))).toBe(undefined);
    // Two distinct *free* symbols are not provably unequal (they may be
    // constrained equal by an assumption), so `NotEqual(x, y)` is
    // indeterminate (WP-2.4 / P0-30), not `true`.
    expect(ce.verify(ce.expr(['NotEqual', 'x', 'y']))).toBe(undefined);
    // Same symbol is equal to itself (so NotEqual is false)
    expect(ce.verify(ce.expr(['NotEqual', 'x', 'x']))).toBe(false);
  });

  test('Equal/NotEqual use 3-valued logic in verification mode', () => {
    const ce = new ComputeEngine();
    // In verification mode, unknown comparisons should return undefined
    expect(ce.verify(ce.expr(['Equal', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.expr(['NotEqual', 'x', 0]))).toBe(undefined);

    // But when evaluated directly (not in verify), they return False/True
    expect(ce.expr(['Equal', 'x', 0]).evaluate().symbol).toBe('False');
    expect(ce.expr(['NotEqual', 'x', 0]).evaluate().symbol).toBe('True');
  });

  test('Less/Greater/LessEqual/GreaterEqual do not cause stack overflow', () => {
    const ce = new ComputeEngine();
    // These should not cause infinite recursion (they use cmp(), not eq())
    expect(ce.verify(ce.expr(['Less', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.expr(['Greater', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.expr(['LessEqual', 'x', 0]))).toBe(undefined);
    expect(ce.verify(ce.expr(['GreaterEqual', 'x', 0]))).toBe(undefined);
  });

  test('Less/Greater consistently return undefined for unknown comparisons', () => {
    const ce = new ComputeEngine();
    // Unlike Equal/NotEqual, inequality operators return undefined in both modes
    // This is because inequalities are fundamentally different from equality
    expect(ce.verify(ce.expr(['Less', 'x', 0]))).toBe(undefined);
    expect(ce.expr(['Less', 'x', 0]).evaluate().operator).toBe('Less'); // Remains unevaluated

    expect(ce.verify(ce.expr(['Greater', 'x', 0]))).toBe(undefined);
    expect(ce.expr(['Greater', 'x', 0]).evaluate().operator).toBe('Less'); // Canonical form
  });
});

