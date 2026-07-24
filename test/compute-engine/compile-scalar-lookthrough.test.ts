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
 * set). Everything else keeps failing closed, including the element-wise
 * broadcast lowering, which remains a separate ROADMAP item.
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
): { ok: true; run: (args?: object) => unknown } | { ok: false; error: string } {
  const jt = (ce as any).getCompilationTarget('javascript');
  const expr = ce.parse(latex) as BoxedExpression;
  try {
    const r = jt.compile(expr);
    return { ok: true, run: (args?: object) => (r.run ? r.run(args) : r(args)) };
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

  test('q(L) < y still fails closed (a collection-ish argument)', () => {
    const r = compileJS(make(), 'q(L)<y');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Fail closed/);
  });

  test('connectives: And over scalar look-through conjuncts compiles', () => {
    // `q(x) < y` types `broadcastable<boolean>` (Less is broadcastable and
    // q's return is open); with provably-scalar operands the lift cannot
    // fire, so the And compiles scalar.
    const r = compileJS(make(), 'q(x)<y \\wedge x>0');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run({ x: 2, y: 10, n: 4 })).toBe(true);
  });

  test('connectives: And with a list-argument conjunct still fails closed', () => {
    const r = compileJS(make(), 'q(L)<y \\wedge x>0');
    expect(r.ok).toBe(false);
  });

  test('a nested user-function body looks through recursively', () => {
    const ce = make();
    ce.declare('r', { signature: '(unknown) -> unknown' });
    ce.assign('r', ce.parse('u \\mapsto q(u)+2'));
    const r = compileJS(ce, 'r(x)<y');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run({ x: 2, y: 20, n: 4 })).toBe(true); // 9+2 = 11 < 20
  });

  test('a body that builds a collection declines (List literal)', () => {
    const ce = make();
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.assign('g', ce.parse('t \\mapsto \\lbrack t, t\\rbrack'));
    expect(compileJS(ce, 'g(x)<y').ok).toBe(false);
  });

  test('a body over a captured collection symbol declines', () => {
    const ce = make();
    ce.declare('h', { signature: '(unknown) -> unknown' });
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'L', 't'], 1], 't']));
    expect(compileJS(ce, 'h(x)<y').ok).toBe(false);
  });

  test('a self-recursive function declines (visited guard)', () => {
    const ce = make();
    ce.declare('f', { signature: '(unknown) -> unknown' });
    ce.assign('f', ce.box(['Function', ['Add', ['f', 't'], 1], 't']));
    expect(compileJS(ce, 'f(x)<y').ok).toBe(false);
  });

  test('the Desmos filter form still fails closed (element-wise lowering is a separate ROADMAP item)', () => {
    const r = compileJS(make(), '\\lvert L-2\\rvert>0');
    expect(r.ok).toBe(false);
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
