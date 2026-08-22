/**
 * Tycho item 219: reading the type of a chain of nested lazy `Map` views cost
 * 2^depth type-handler invocations and retired every `_type`/`_sgn` cache in
 * the engine on each read.
 *
 * Two independent causes, one per describe below. `Map`'s type handler read
 * each source's `.type` twice per level, and the element-type derivation
 * (`bareMappingElementType`) declared stand-ins whose `declare` event advanced
 * the engine's `any` cache axis — the axis `BoxedFunction.type` keys its memo
 * on — so a derivation invalidated the caches the enclosing walk was filling.
 *
 * Every assertion here is STRUCTURAL: an invocation count, a generation delta,
 * a bracket returning to its resting state. None is a wall-clock threshold,
 * which would be flaky on a shared machine and would not say which of the two
 * causes had come back. The wall-clock effect these stand in for, measured on
 * the reporter's shapes against the released 0.118.0: `PointList(−√(1−Y_0²),
 * Y_0)` never returned (>120 s) and now takes single-digit ms; parsing an
 * `rgb(…)` row over a bound 301-element list took 12.9 s and now takes ~7 ms.
 */

import { ComputeEngine } from '../../src/compute-engine';

/** The reporter's shape: a lazy view over a `Range` of UNBOUND length, wrapped
 * in enough arithmetic to nest several `Map` levels. `n` and `Y` stay
 * valueless, which is what keeps the whole chain lazy and symbolic. */
function viewEngine(): {
  ce: ComputeEngine;
  /** The nested-`Map` chain ITSELF, not the symbol bound to it. Reading
   * `ce.box('Y_0').type` answers from the symbol's definition without ever
   * entering the derivation, so a pin written that way passes even on the
   * broken engine — it must hold the view expression. */
  view: ReturnType<ComputeEngine['box']>;
} {
  const ce = new ComputeEngine();
  ce.declare('n', 'number');
  ce.declare('Y', 'number');
  ce.assign('L', ce.parse('\\frac{\\operatorname{Range}(0,n)}{n}').evaluate());
  const view = ce.parse('Y + 0 \\cdot (2L - 1)').evaluate();
  ce.assign('Y_0', view);
  return { ce, view };
}

describe('the derivation does not invalidate the caches it reads', () => {
  test('a repeated .type read of a nested view advances no cache axis', () => {
    const { ce, view } = viewEngine();
    // Warm it: the first read legitimately declares, infers, and binds.
    view.type;

    const before = ce._anyVersion;
    for (let i = 0; i < 10; i++) view.type;
    // ZERO, not "small": every advance here retires the `_type`/`_sgn` cache
    // of every expression in the engine, so a nonzero drift means each read is
    // re-deriving the whole chain. Measured at 620 before the fix.
    expect(ce._anyVersion - before).toBe(0);
  });

  test('an eager Map over a literal list never took the derivation at all', () => {
    // The control: this shape was always cheap, so a regression that showed up
    // here would be somewhere other than the lazy-view path.
    const ce = new ComputeEngine();
    const m = ce
      .parse('\\operatorname{Map}(x \\mapsto x + 1, \\lbrack 1,2,3 \\rbrack)')
      .evaluate();
    m.type;
    const before = ce._anyVersion;
    for (let i = 0; i < 10; i++) m.type;
    expect(ce._anyVersion - before).toBe(0);
  });
});

describe('type-handler invocations are linear in nesting depth', () => {
  /** Count `Map` type-handler entries while evaluating `Square(name)`. */
  function invocations(ce: ComputeEngine, name: string): number {
    const def = ce.lookupDefinition('Map');
    if (!def || !('operator' in def)) throw new Error('no Map operator def');
    const op = def.operator as { type?: (...args: unknown[]) => unknown };
    const original = op.type;
    if (typeof original !== 'function') throw new Error('no Map type handler');
    let calls = 0;
    op.type = function (this: unknown, ...args: unknown[]) {
      calls += 1;
      return original.apply(this, args);
    };
    try {
      ce.box(['Square', name]).evaluate();
      return calls;
    } finally {
      op.type = original;
    }
  }

  test('each added level costs a bounded increment, not a doubling', () => {
    const { ce } = viewEngine();
    const counts: number[] = [];
    let previous = 'Y_0';
    for (let k = 0; k <= 4; k++) {
      const name = k === 0 ? 'Y_0' : `Y_${k}`;
      if (k > 0) {
        ce.assign(name, ce.parse(`${previous} + 1`).evaluate());
        previous = name;
      }
      counts.push(invocations(ce, name));
    }

    // Before the fix: 913, 1857, 3745, 7521, 15073 — each level almost exactly
    // double the last. The assertion is on the RATIO rather than on absolute
    // numbers, which drift with unrelated library changes and would make this
    // a maintenance burden rather than a regression pin.
    for (let k = 1; k < counts.length; k++)
      expect(counts[k]).toBeLessThan(counts[k - 1] * 1.5);
    // And an absolute ceiling, so a linear-but-enormous regression is caught
    // too: the deepest level stays well under the shallowest pre-fix count.
    expect(counts[counts.length - 1]).toBeLessThan(500);
  });
});

describe('the scratch-scope bracket is balanced', () => {
  test('the registration is empty before and after a derivation', () => {
    const { ce, view } = viewEngine();
    expect(ce._scratchDeclarationScopes).toHaveLength(0);
    view.type;
    // A leaked registration would exempt every later declaration aimed at that
    // scope object from advancing any cache axis — a far worse failure than
    // the cost this fix removes.
    expect(ce._scratchDeclarationScopes).toHaveLength(0);
  });

  test('a throw inside the probe leaves nothing registered', () => {
    const { ce, view } = viewEngine();
    const def = ce.lookupDefinition('Add');
    if (!def || !('operator' in def)) throw new Error('no Add operator def');
    const op = def.operator as { type?: (...args: unknown[]) => unknown };
    const original = op.type;
    // The probe applies the body's operator and reads its type; making that
    // read throw exercises the `finally` that unwinds the bracket.
    op.type = () => {
      throw new Error('probe failure');
    };
    try {
      view.type;
    } catch {
      // The derivation swallows it; a throw escaping to here is itself fine
      // for this test's purpose, which is only what the bracket left behind.
    } finally {
      op.type = original;
    }
    expect(ce._scratchDeclarationScopes).toHaveLength(0);
  });
});
