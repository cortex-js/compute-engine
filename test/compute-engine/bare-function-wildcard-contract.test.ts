import { ComputeEngine } from '../../src/compute-engine';

// Task P2 of `docs/plans/2026-08-22-type-handlers-on-types.md` §4.6,
// resolved 2026-08-22 as CAUSE + PIN (an adoption fix was attempted the
// same day and reverted against the pins this file now makes explicit).
//
// A symbol declared BARE `function` is the WILDCARD-CALLEE contract: "this
// is callable, of a signature I did not spell out". Its declared type
// DELIBERATELY stays bare `function` through every assignment — adopting
// the assigned literal's signature would turn the permissive forward
// declaration into an arity/parameter contract: no currying on
// under-application, box-time `unexpected-argument` errors instead of the
// evaluation-time throw, callback-arity refusals for `Reduce`-style slots,
// and the wildcard-callee narrowing machinery in `box.ts`
// (`isWildcardFunctionType`) would stop recognizing the symbol. The result
// SHAPE of an application still flows: consumers that need it (the
// `Derivative` type handler) read the HELD VALUE's type, and the §5
// descriptor design carries a symbol's value type for exactly this case.

describe('bare `function` is a wildcard contract, not a signature adopter', () => {
  test('the declared type stays bare through an assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('(t) \\mapsto (\\cos t, \\sin 2t, t)'));
    expect(ce.symbol('f').type.toString()).toBe('function');
    // …while the held value carries the full signature…
    expect(ce.symbol('f').value?.type.toString()).toBe(
      '(unknown) -> tuple<finite_number, finite_number, number>'
    );
    // …and the application's result shape flows through the value channel.
    expect(
      ce.parse("f'(0.25)").type.matches('tuple<number, number, number>')
    ).toBe(true);
  });

  test('the wildcard call semantics survive the assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.expr(['Function', ['Multiply', 'g_x', 2], 'g_x']));
    // Over-application throws at evaluation (not a box-time error value)…
    expect(() => ce.expr(['g', 3, 4]).evaluate()).toThrow('Too many');
    // …and a unary lambda in a binary callback slot is admitted at boxing
    // (the arity is checked where the callback is applied), unlike an
    // EXPLICIT wrong-arity signature, which is refused at boxing.
    ce.declare('cb', 'function');
    ce.assign('cb', ce.box(['Function', ['Add', 'cb_x', 1], 'cb_x']));
    expect(ce.box(['Reduce', ['List', 1, 2, 3], 'cb', 0]).isValid).toBe(true);
    const ce2 = new ComputeEngine();
    ce2.declare('cb2', '(number) -> number');
    expect(ce2.box(['Reduce', ['List', 1, 2, 3], 'cb2', 0]).isValid).toBe(
      false
    );
  });
});
