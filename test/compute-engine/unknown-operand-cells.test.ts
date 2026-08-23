import { ComputeEngine } from '../../src/compute-engine';

// Task P1 of `docs/plans/2026-08-22-type-handlers-on-types.md` §4.6: which
// step of the §2.6 derivation makes `Add(u, 1)` type `number` for
// `u: unknown`, where the §2.2 shim produced `finite_number`.
//
// TRACED 2026-08-22 (by instrumenting `addType`'s scalar tail): it is NOT a
// derivation step. The numeric-argument validation at BOXING infers a
// valueless `unknown` symbol to `number` (the evidence-inference doctrine: a
// use of a valueless symbol narrows it), so by the time the type handler
// runs — step 11 — the operand's type already IS `number`, and `addType`
// widens `number ∨ finite_integer` to `number`. An APPLICATION operand
// (`h(x)` with `h: (number) -> unknown`) is not inferrable, keeps `unknown`,
// and takes step 16's `broadcastable<…>` wrap instead. Consequence for the
// §5 signature change: `describe(op)` reads the operand's type AFTER that
// inference, so `deriveApplicationType` sees exactly what the handler sees
// today and no framework step needs to reproduce the widening. The shim's
// `finite_number` came from bypassing the inference (it rebuilt facts from
// the DECLARED `unknown`), not from a missed step.

describe('P1 — the `unknown` widening happens at boxing, not in the derivation', () => {
  test('a valueless unknown symbol is inferred `number` by a numeric use', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    expect(ce.symbol('u').type.toString()).toBe('unknown');
    ce.box(['Add', 'u', 1]);
    expect(ce.symbol('u').type.toString()).toBe('number');
  });

  test('row 1 — Add(u, 1) types `number` (the widen of the inferred operand)', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    expect(ce.box(['Add', 'u', 1]).type.toString()).toBe('number');
  });

  test('row 2 — Add(h(x), 1) types `broadcastable<number>` (step 16 wrap)', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    // The application is not inferrable: its own type stays `unknown`, so
    // it counts as possibly-a-collection and the cells follow the scalar
    // claim for the inferred/number tier.
    expect(ce.box(['h', 'x']).type.toString()).toBe('unknown');
    expect(ce.box(['Add', ['h', 'x'], 1]).type.toString()).toBe(
      'broadcastable<number>'
    );
  });

  test('rows 3 and 4 — the per-operator scalar claims for an inferred operand', () => {
    // Each operator applies its own claim to the inferred `number` operand:
    // `Multiply` and `Sin` treat it as a generic (finite) point, `Add`
    // widens — the difference is the HANDLER's, not the derivation's.
    const ce = new ComputeEngine();
    ce.declare('u2', 'unknown');
    expect(ce.box(['Multiply', 'u2', 2]).type.toString()).toBe(
      'finite_number'
    );
    const ce2 = new ComputeEngine();
    ce2.declare('u3', 'unknown');
    expect(ce2.box(['Sin', 'u3']).type.toString()).toBe('finite_number');
  });
});
