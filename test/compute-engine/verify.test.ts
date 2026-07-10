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

    // When evaluated directly, undecidable comparisons stay inert
    // (a condition, not a truth) — same 3-valued semantics as verify()
    expect(ce.expr(['Equal', 'x', 0]).evaluate().operator).toBe('Equal');
    expect(ce.expr(['NotEqual', 'x', 0]).evaluate().operator).toBe('NotEqual');
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

  // P1-4: opaque, multi-symbol facts that the evaluator cannot decide must
  // still verify, via a direct assumption-DB lookup.
  test('verifies an opaque product inequality the evaluator cannot decide', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\cdot y > 0'));
    expect(ce.verify(ce.expr(['Greater', ['Multiply', 'x', 'y'], 0]))).toBe(
      true
    );
  });

  test('verifies an opaque sum inequality', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x + y > 0'));
    expect(ce.verify(ce.expr(['Greater', ['Add', 'x', 'y'], 0]))).toBe(true);
  });

  test('verifies a stored multi-unknown equality', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x + y = 5'));
    expect(ce.verify(ce.parse('x + y = 5'))).toBe(true);
  });

  // P3-1: verify() accepts string predicates (parsed as LaTeX), consistent
  // with assume(). Previously a string silently returned `undefined`.
  describe('string predicates (P3-1)', () => {
    test('plain infix string', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x > 0'));
      expect(ce.verify('x > 0')).toBe(true);
      expect(ce.verify('x < 0')).toBe(false);
      expect(ce.verify('x > 5')).toBe(undefined);
    });

    test('$…$-delimited LaTeX string', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x > 0'));
      expect(ce.verify('$x > 0$')).toBe(true);
      expect(ce.verify('$x < 0$')).toBe(false);
    });

    test('string agrees with the boxed-expression form', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x > 4'));
      expect(ce.verify('x < 0')).toBe(ce.verify(ce.expr(['Less', 'x', 0])));
    });

    test('assume() accepts the same string forms', () => {
      const ce = new ComputeEngine();
      expect(ce.assume('y > 3')).toBe('ok');
      expect(ce.verify(ce.expr(['Greater', 'y', 1]))).toBe(true);
      const ce2 = new ComputeEngine();
      expect(ce2.assume('$z > 3$')).toBe('ok');
      expect(ce2.verify('z > 1')).toBe(true);
    });

    test('unparseable string throws a clear error', () => {
      const ce = new ComputeEngine();
      expect(() => ce.verify('@@@ not math')).toThrow(/cannot parse/i);
    });
  });

  // P3-2: the Kleene And/Or/Not recursion is live (routed through an inner
  // helper), so compound predicates over OPAQUE assumption-DB facts — which
  // the evaluator cannot reduce — now decide. Previously the recursive calls
  // hit the `_isVerifying` re-entrancy flag and returned `undefined`, so these
  // were only ever decided by evaluate()'s own reduction (i.e. undecided).
  describe('compound predicates over opaque facts (P3-2)', () => {
    test('And of two opaque inequalities → true', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x \\cdot y > 0'));
      ce.assume(ce.parse('x + y > 0'));
      expect(
        ce.verify(
          ce.expr([
            'And',
            ['Greater', ['Multiply', 'x', 'y'], 0],
            ['Greater', ['Add', 'x', 'y'], 0],
          ])
        )
      ).toBe(true);
    });

    test('Not of an opaque inequality → false', () => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x \\cdot y > 0'));
      expect(
        ce.verify(ce.expr(['Not', ['Greater', ['Multiply', 'x', 'y'], 0]]))
      ).toBe(false);
    });
  });
});

// The identity property (P1-2..P1-6): a fact that was accepted by `assume`
// must be verifiable afterwards. `assume(P) === 'ok'` ⇒ `verify(P) === true`.
describe('VERIFY IS THE LEFT-INVERSE OF ASSUME', () => {
  const cases: Array<[string, (ce: ComputeEngine) => any]> = [
    ['x > 0', (ce) => ce.parse('x > 0')],
    ['x >= 3', (ce) => ce.parse('x \\ge 3')],
    ['x < 5', (ce) => ce.parse('x < 5')],
    ['0 < x < 1 (lower)', (ce) => ce.expr(['Greater', 'x', 0])],
    ['0 < x < 1 (upper)', (ce) => ce.expr(['Less', 'x', 1])],
    ['x*y > 0', (ce) => ce.expr(['Greater', ['Multiply', 'x', 'y'], 0])],
    ['x + y > 0', (ce) => ce.expr(['Greater', ['Add', 'x', 'y'], 0])],
    ['x + y = 5', (ce) => ce.parse('x + y = 5')],
    ['x^2 = 4', (ce) => ce.parse('x^2 = 4')],
    ['n in integer', (ce) => ce.expr(['Element', 'n', 'integer'])],
    ['x != 2', (ce) => ce.expr(['NotEqual', 'x', 2])],
  ];

  // The proposition actually asserted (chained assume needs its own source).
  const propositionFor = (ce: ComputeEngine, label: string): any => {
    if (label.startsWith('0 < x < 1')) return ce.parse('0 < x < 1');
    return null;
  };

  for (const [label, build] of cases) {
    test(`assume(${label}) ⇒ verify(${label})`, () => {
      const ce = new ComputeEngine();
      const asserted = propositionFor(ce, label) ?? build(ce);
      expect(ce.assume(asserted)).toBe('ok');
      expect(ce.verify(build(ce))).toBe(true);
    });
  }
});

