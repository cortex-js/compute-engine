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
});

