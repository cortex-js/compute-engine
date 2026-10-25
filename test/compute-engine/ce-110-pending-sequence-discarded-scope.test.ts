import { ComputeEngine } from '../../src/compute-engine';
import { _sequenceRegistrySnapshot } from '../../src/compute-engine/sequence';

/**
 * CE-110. Pending sequence definitions (a base case `F_0 := 5` with no
 * recurrence yet) are kept by (scope, name), and the discard of a scope
 * removes the entries of that scope. A function closure can still reach a
 * scope whose evaluation context was already discarded, through its `parent`
 * chain: a call pushes a fresh scope whose parent is the scope where the
 * function was defined. When that scope holds a binding for `F`, the base case
 * was recorded under the discarded scope, and nothing removed it later.
 *
 * Here the call frame is made by hand, as the evaluation of a function does:
 * `ce.pushScope()` with a scope whose parent is the discarded scope.
 */

function pendingCount(ce: ComputeEngine): number {
  const snapshot = _sequenceRegistrySnapshot(ce) as { pending?: unknown[] };
  return snapshot.pending?.length ?? 0;
}

describe('CE-110: a base case assigned under a discarded scope', () => {
  test('the pending definitions do not grow with each call', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const closure = ce.context.lexicalScope;
    ce.declare('F', 'unknown');
    ce.popScope();

    for (let i = 0; i < 3; i++) {
      ce.pushScope({ parent: closure, bindings: new Map() });
      ce.parse('F_0 := 5').evaluate();
      // The base case is pending while the call runs.
      expect(pendingCount(ce)).toBe(1);
      ce.popScope();
      // It is removed with the call frame.
      expect(pendingCount(ce)).toBe(0);
    }
  });

  test('a scope pushed again after its discard is live', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const scope = ce.context.lexicalScope;
    ce.declare('F', 'unknown');
    ce.popScope();

    // Push the same scope object again (a canonical `Block` or `Sum` pushes
    // its local scope on each evaluation): the base case belongs to its `F`.
    ce.pushScope(scope);
    ce.parse('F_0 := 10').evaluate();
    ce.parse('F_n := F_{n-1} + 1').evaluate();
    expect(ce.parse('F_3').evaluate().json).toBe(13);
    ce.popScope();
    expect(pendingCount(ce)).toBe(0);
  });
});
