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
  test('compiles to a list of scaled points and matches the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'indexed_collection<number>');
    // Broadcast arithmetic over a `Range` types `list<integer>` — a list of
    // scalars, never a point.
    ce.assign('R', ce.box(['Multiply', 2, ['Range', 1, 3]]));
    expect(ce.box('R').type.toString()).toBe('indexed_collection<number>');

    const expr = ce.box(['Multiply', 'R', ['Tuple', ['Cos', 't'], ['Sin', 't']]]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    // The point is kept whole (the inner `_SYS.bcast`); the outer one descends
    // into the list, scaling the point at every element.
    expect(r.code).toContain('_SYS.bcast');

    // Runtime parity with the interpreter: R = [2, 4, 6] scales (cos t, sin t)
    // at every element.
    expect(r.run!({ t: 0 })).toEqual([
      [2, 0],
      [4, 0],
      [6, 0],
    ]);
  });

  test('the full xkusqcyzsx row (scaled point summed with a point) compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('N', 'integer');
    ce.declare('a', 'real');
    ce.declare('Dc', 'real');
    ce.declare('X', 'indexed_collection<number>');
    ce.declare('Y', 'indexed_collection<number>');
    ce.declare('R', 'indexed_collection<number>');
    ce.assign(
      'R',
      ce.box([
        'Multiply',
        'Dc',
        ['Divide', ['Power', -1, ['Range', 1, ['Add', 'N', -1]]], ['Cos', 'a']],
      ])
    );
    const expr = ce.box([
      'Add',
      ['Multiply', 'R', ['Tuple', ['Cos', 't'], ['Sin', 't']]],
      ['Tuple', ['Add', 'Dc', 'X'], 'Y'],
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
  });

  test('a direct Range binding (type `range`) scales a point and matches the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'indexed_collection<number>');
    // A `Range` value types `range` — a list of integers, never a point.
    ce.assign('R', ce.box(['Range', 1, 3]));
    const expr = ce.box(['Multiply', 'R', ['Tuple', ['Cos', 't'], ['Sin', 't']]]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0 })).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  test('a list<number> symbol was always admitted (unchanged baseline)', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'list<number>');
    const expr = ce.box(['Multiply', 'R', ['Tuple', ['Cos', 't'], ['Sin', 't']]]);
    expect(compile(expr, { fallback: false }).success).toBe(true);
  });

  // Regressions: the binding must actually PROVE a list of scalars.

  test('a bare declared indexed_collection<number> with NO binding still declines', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'indexed_collection<number>'); // declared, no value
    const expr = ce.box(['Multiply', 'R', ['Tuple', ['Cos', 't'], ['Sin', 't']]]);
    // Unprovable shape (a tuple inhabits the type): fail closed (D6).
    expect(() => compile(expr, { fallback: false })).toThrow(
      /list-arithmetic|list-valued/
    );
  });

  test('a symbol declared indexed_collection<number> but bound to a POINT still declines', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('R', 'indexed_collection<number>');
    // A tuple inhabits `indexed_collection<number>`, so this binding is a
    // point, not a list of scalars — the value the whole check guards against.
    ce.assign('R', ce.box(['Tuple', 1, 2]));
    const expr = ce.box(['Multiply', 'R', ['Tuple', ['Cos', 't'], ['Sin', 't']]]);
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
    const expr = ce.box(['Multiply', 'R', ['Tuple', ['Cos', 't'], ['Sin', 't']]]);
    expect(() => compile(expr, { fallback: false, vars: { R: '_.R' } })).toThrow();
  });
});
