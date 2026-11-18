import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * A point scaled by a symbol whose type is `indexed_collection<number>` but
 * whose BINDING is provably a list of scalars.
 *
 * `isScalarElementSource` (base-compiler.ts) decides whether the outer
 * `_SYS.bcast` may descend into an operand while a point is kept whole (the
 * `atomicTuple` plan in `tryCompileBroadcast`). A symbol *declared*
 * `indexed_collection<number>` may itself hold a point, because a `tuple`
 * inhabits that type, so the declaration alone does not prove a list of
 * scalars. But a symbol BOUND to a value whose own type is a list of scalars —
 * a `Range`, or the broadcast arithmetic over one that a Desmos document uses
 * to build a list of sample points, which types `list<number>` — is never a
 * point, so scaling a point by it is a list of scaled points, exactly what the
 * interpreter answers.
 *
 * Audit witness: `neyret/xkusqcyzsx`, `R × (cos t, sin t) + (D_c + X, Y)` with
 * `R := D_c · ((-1)^Range(1, N-1) / cos a)` declared `indexed_collection<number>`.
 */

describe('a point scaled by a list-bound indexed_collection symbol', () => {

  // Regressions: the binding must actually PROVE a list of scalars.

  test('a bare declared indexed_collection<number> with NO binding still declines', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'indexed_collection<number>'); // declared, no value
    const expr = ce.box([
      'Multiply',
      'R',
      ['Tuple', ['Cos', 't'], ['Sin', 't']],
    ]);
    // Unprovable shape (a tuple inhabits the type): fail closed.
    expect(() => compile(expr, { fallback: false })).toThrow(
      /Could not compile/
    );
  });

  test('a symbol declared indexed_collection<number> but bound to a POINT still declines', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'indexed_collection<number>');
    // A tuple inhabits `indexed_collection<number>`, so this binding is a
    // point, not a list of scalars — the value the whole check guards against.
    ce.assign('R', ce.box(['Tuple', 1, 2]));
    const expr = ce.box([
      'Multiply',
      'R',
      ['Tuple', ['Cos', 't'], ['Sin', 't']],
    ]);
    expect(() => compile(expr, { fallback: false })).toThrow();
  });

  test('a caller-mapped (by-reference) symbol is not trusted even with a list binding', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'indexed_collection<number>');
    // R has a provable list binding, but the `vars` mapping makes it a live
    // by-reference input: the kernel reads `_.R` from the caller's scope, whose
    // only contract is the declared `indexed_collection<number>` — which admits
    // a point. The binding is not what runs, so it must not be trusted.
    ce.assign('R', ce.box(['Multiply', 2, ['Range', 1, 3]]));
    const expr = ce.box([
      'Multiply',
      'R',
      ['Tuple', ['Cos', 't'], ['Sin', 't']],
    ]);
    expect(() =>
      compile(expr, { fallback: false, vars: { R: '_.R' } })
    ).toThrow();
  });
});
