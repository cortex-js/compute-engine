/**
 * Item 86 (Tycho): compiled comparisons/connectives over a USER-function
 * application with an open declared return (`(unknown) -> unknown`).
 *
 * Consumers declare helpers with open types so list-broadcasting works
 * (`q(L)` over a list). The 0.93.0 fail-closed rule then made an ordinary
 * SCALAR comparison over such a helper (`q(x) < y`) uncompilable, and no
 * return annotation recovers it soundly: `-> number` compiles the scalar
 * call but silently mis-compiles the list call.
 *
 * The fix is a compile-time LOOK-THROUGH (`isProvablyScalarApplication` in
 * `compilation/javascript-target.ts`): the application is provably scalar
 * when every actual argument is scalar-ish per the gate's own convention AND
 * the function body maps scalar parameters to a scalar result (a whitelist:
 * parameters, scalar-typed captured symbols, `broadcastable`-operator
 * applications, nested user functions — recursion declines via a visited
 * set). What the look-through buys is the TIGHT scalar lowering (bare infix,
 * no call): since 2026-07-27 an application it declines no longer fails
 * closed — it goes through the `_SYS.bcast` runtime dispatch instead, which
 * is correct whatever shape the value turns out to have. The tests below pin
 * both halves: the look-through cases emit scalar infix, the declined ones
 * still compile and agree with the interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

function make(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'number');
  ce.declare('q', { signature: '(unknown) -> unknown' });
  ce.assign('q', ce.parse('t \\mapsto n\\cdot t+1'));
  ce.declare('L', 'list<number>');
  return ce;
}

function compileJS(
  ce: ComputeEngine,
  latex: string
):
  | { ok: true; code: string; run: (args?: object) => unknown }
  | { ok: false; error: string } {
  const jt = (ce as any)._getCompilationTarget('javascript');
  const expr = ce.parse(latex) as BoxedExpression;
  try {
    const r = jt.compile(expr);
    return {
      ok: true,
      code: r.code ?? '',
      run: (args?: object) => (r.run ? r.run(args) : r(args)),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

describe('item 86 — scalar look-through for compiled comparisons/connectives', () => {
  test('q(x) < y compiles and runs (the filed regression)', () => {
    const r = compileJS(make(), 'q(x)<y');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.run({ x: 2, y: 10, n: 4 })).toBe(true); // 4·2+1 = 9 < 10
      expect(r.run({ x: 3, y: 10, n: 4 })).toBe(false); // 13 < 10
    }
  });

  test('q(L) < y dispatches at run time (was fail-closed)', () => {
    // The look-through declines (a collection-ish argument), so this is NOT
    // the scalar infix lowering — it is the `_SYS.bcast` runtime dispatch,
    // which zips the array `q(L)` against the scalar `y`.
    const r = compileJS(make(), 'q(L)<y');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toContain('_SYS.bcast');
      expect(r.run({ L: [1, 2, 3], y: 6, n: 2 })).toEqual([true, true, false]);
    }
  });

  test('connectives: And over scalar look-through conjuncts compiles', () => {
    // `q(x) < y` types `broadcastable<boolean>` (Less is broadcastable and
    // q's return is open); with provably-scalar operands the lift cannot
    // fire, so the And compiles scalar.
    const r = compileJS(make(), 'q(x)<y \\wedge x>0');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run({ x: 2, y: 10, n: 4 })).toBe(true);
  });

  test('connectives: And with a list-argument conjunct broadcasts', () => {
    // The conjunction is element-wise over the list conjunct: a dominant
    // `false` scalar absorbs per POSITION, so the result stays a list — which
    // is what the interpreter answers too (`And(False, [T,F,T])` is
    // `[False,False,False]`, not the scalar `False`).
    const r = compileJS(make(), 'q(L)<y \\wedge x>0');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.run({ L: [1, 2, 3], y: 6, n: 2, x: 1 })).toEqual([
        true,
        true,
        false,
      ]);
      expect(r.run({ L: [1, 2, 3], y: 6, n: 2, x: -1 })).toEqual([
        false,
        false,
        false,
      ]);
    }
  });

  test('a nested user-function body looks through recursively', () => {
    const ce = make();
    ce.declare('r', { signature: '(unknown) -> unknown' });
    ce.assign('r', ce.parse('u \\mapsto q(u)+2'));
    const r = compileJS(ce, 'r(x)<y');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run({ x: 2, y: 20, n: 4 })).toBe(true); // 9+2 = 11 < 20
  });

  test('a body that builds a collection declines the look-through', () => {
    // `g: t ↦ [t, t]` returns an ARRAY from a scalar argument, so the
    // look-through must decline — and the runtime dispatch then broadcasts
    // over the two cells, matching interpretation.
    const ce = make();
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.assign('g', ce.parse('t \\mapsto \\lbrack t, t\\rbrack'));
    const r = compileJS(ce, 'g(x)<y');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toContain('_SYS.bcast');
      expect(r.run({ x: 2, y: 10 })).toEqual([true, true]);
    }
  });

  test('a body over a captured collection symbol declines the look-through', () => {
    const ce = make();
    ce.declare('h', { signature: '(unknown) -> unknown' });
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'L', 't'], 1], 't']));
    const r = compileJS(ce, 'h(x)<y');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toContain('_SYS.bcast');
      // h(2) = L[2] + 1 = 5
      expect(r.run({ x: 2, y: 10, L: [3, 4, 5] })).toBe(true);
    }
  });

  test('a self-recursive function declines the look-through (visited guard)', () => {
    // `f: t ↦ f(t) + 1` does not terminate in EITHER engine — the interpreter
    // hits its recursion limit, the compiled artifact a catchable
    // `RangeError`. What is pinned here is that the look-through declines
    // (no scalar infix lowering), not that the call is refused.
    const ce = make();
    ce.declare('f', { signature: '(unknown) -> unknown' });
    ce.assign('f', ce.box(['Function', ['Add', ['f', 't'], 1], 't']));
    const r = compileJS(ce, 'f(x)<y');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toContain('_SYS.bcast');
  });

  test('the Desmos filter form now broadcasts element-wise', () => {
    // Was: fail closed, tracked as a separate ROADMAP item. The element-wise
    // lowering landed, and `L` is a list-typed SYMBOL — it provably compiles to
    // an array, unlike `q(L)` above. See `compiled-elementwise-boolean.test.ts`.
    const r = compileJS(make(), '\\lvert L-2\\rvert>0');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run({ L: [1, 2, 3] })).toEqual([true, false, true]);
  });

  test('plain scalar comparisons are unaffected', () => {
    const r = compileJS(make(), 'x<y');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run({ x: 1, y: 2 })).toBe(true);
  });

  test('look-through result agrees with the interpreter', () => {
    const ce = make();
    const compiled = compileJS(ce, 'q(x)<y');
    expect(compiled.ok).toBe(true);
    ce.assign('n', 4);
    ce.assign('x', 2);
    ce.assign('y', 10);
    const interpreted = ce.parse('q(x)<y').evaluate().symbol;
    expect(interpreted).toBe('True'); // 4·2+1 = 9 < 10
    if (compiled.ok)
      expect(compiled.run({ x: 2, y: 10, n: 4 })).toBe(interpreted === 'True');
  });
});
