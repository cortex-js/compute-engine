import { ComputeEngine } from '../../src/compute-engine';

/**
 * The `popScope` debug invariant, Tier 1
 * (`docs/SCOPING-MODEL.md`).
 *
 * A scope being discarded tombstones its value definitions; using one of those
 * bindings afterwards reports BOTH stacks — where the scope died and where the
 * dead binding was used — instead of silently reading a stale value. Gated on
 * `ce._debugBindings`, which is off by default.
 */

/** A symbol whose binding outlives the scope that owns it. The scope is
 * popped as the engine pops an evaluation frame; `ce.popScope()` keeps the
 * definitions of its scope (see the last test). */
function leakBinding(ce: ComputeEngine) {
  ce.pushScope();
  ce.declare('leaked', 'integer');
  ce.assign('leaked', 42);
  const escaped = ce.symbol('leaked');
  ce._popEvalContext();
  return escaped;
}

describe('popScope debug invariant', () => {
  it('reports a use of a dead binding with both stacks (flag on)', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;

    const escaped = leakBinding(ce);

    let message = '';
    try {
      escaped.evaluate();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('discarded scope');
    expect(message).toContain('the scope was discarded at');
    expect(message).toContain('the dead binding was used at');
  });

  it('reports a dead binding on the numeric route too (flag on)', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;

    const escaped = leakBinding(ce);

    expect(() => escaped.N()).toThrow(/discarded scope/);
  });

  it('is off by default: the same sequence is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce._debugBindings).toBe(false);

    const escaped = leakBinding(ce);

    // The symbol reads its definition from the scope it was boxed in —
    // quietly, which is exactly what the flag makes loud.
    expect(escaped.evaluate().toString()).toEqual('42');
    expect(escaped.N().toString()).toEqual('42');
  });

  it('a scope popped by ce.popScope() keeps its definitions (flag on)', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;
    ce.pushScope();
    ce.declare('kept', 'integer');
    ce.assign('kept', 42);
    const e = ce.box(['Add', 'kept', 1]);
    ce.popScope();
    expect(e.evaluate().toString()).toEqual('43');
    expect(e.N().toString()).toEqual('43');
  });

  it('a binder scope popped at canonicalization is dormant, not dead', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;

    // `canonicalizeBinder` pops the big op's scope when canonicalization is
    // done, but the expression KEEPS it and pushes it again on every
    // evaluation. In the window in between, its index is a live binding —
    // reporting it as belonging to a discarded scope is a false positive.
    const sum = ce.parse('\\sum_{k=1}^{10} k');
    expect(sum.ops![0].evaluate().toString()).toEqual('k');
    expect(sum.evaluate().toString()).toEqual('55');
  });

  it('a scope pushed again is not dead: its bindings are revived', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;

    // A canonicalized big operator keeps its `localScope` and pushes it again
    // on every evaluation, after `canonicalBigop` popped it — so a pop is not
    // proof that a scope is gone.
    expect(ce.parse('\\sum_{k=1}^{10} k').evaluate().toString()).toEqual('55');
    expect(ce.parse('\\prod_{i=1}^{4} i').evaluate().toString()).toEqual('24');
  });
});
