import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isValueDef,
  isOperatorDef,
} from '../../src/compute-engine/boxed-expression/utils';
import { sameBindingDef } from '../../src/compute-engine/boxed-expression/binders';

//
// Acceptance suite for inference ROLLBACK FRAMES (`docs/TYPE-SYSTEM.md`).
//
// `ce._withRolledBackInference(fn)` journals every inference-driven engine
// mutation made while it runs and undoes them all — on normal return and on
// throw — in strict LIFO order. Each `describe` below pins one journal
// family's pre/post state; identity assertions use `sameBindingDef` (object
// identity plus one `_activationOf` hop) and `===` on the definition
// objects, because discard-and-recreate is forbidden by design.
//
// A rollback frame must nest inside ONE boxing-pass window, so every test
// opens the frame through `_withBoxingPassWindow`.
//

function withFrame<T>(ce: ComputeEngine, fn: () => T): T {
  return ce._withBoxingPassWindow(() => ce._withRolledBackInference(fn));
}

/** The first occurrence of the symbol `name` in `expr`. */
function occurrence(expr: Expression, name: string): Expression | undefined {
  if (expr.symbol === name) return expr;
  for (const op of expr.ops ?? []) {
    const found = occurrence(op, name);
    if (found) return found;
  }
  return undefined;
}

describe('ROLLBACK FRAMES — family 2: operator signature writes', () => {
  test('abort after a signature replacement restores the BoxedType by identity', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto x'));
    const def = ce.lookupDefinition('g')!;
    if (!isOperatorDef(def)) throw new Error('expected an operator definition');
    const signatureBefore = def.operator.signature;

    withFrame(ce, () => {
      // Using g's result numerically narrows the inferred signature.
      ce.box(['Add', ['g', 1], 2]);
      expect(def.operator.signature.toString()).not.toBe(
        signatureBefore.toString()
      );
    });

    // Identity, not just spelling: caches key on the BoxedType object.
    expect(def.operator.signature).toBe(signatureBefore);
  });
});

describe('ROLLBACK FRAMES — family 3: binding-half swaps', () => {
  test('an operator→value redefinition rolls back with full identity', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('x \\mapsto x + 1'));
    const record = ce.lookupDefinition('h')!;
    if (!isOperatorDef(record))
      throw new Error('expected an operator definition');
    const operatorHalf = record.operator;
    const boundBefore = ce.box(['h', 3]); // binds the pre-frame definition

    withFrame(ce, () => {
      ce.assign('h', 5); // updateDef: operator → value swap
      const swapped = ce.lookupDefinition('h')!;
      expect(swapped).toBe(record); // same record, halves swapped in place
      expect(isValueDef(swapped)).toBe(true);
    });

    const after = ce.lookupDefinition('h')!;
    expect(after).toBe(record);
    expect(sameBindingDef(record, after)).toBe(true);
    if (!isOperatorDef(after)) throw new Error('operator half not restored');
    expect(after.operator).toBe(operatorHalf); // identity, not a rebuild
    // An expression bound before the frame still works and agrees.
    expect(boundBefore.evaluate().toString()).toBe('4');
    expect(boundBefore.isSame(ce.box(['h', 3]))).toBe(true);
  });
});

describe('ROLLBACK FRAMES — family 4: declarations', () => {
  test('an overwritten declaration restores the previous binding by identity', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'integer');
    const before = ce.lookupDefinition('p')!;

    withFrame(ce, () => {
      ce._declareSymbolValue('p', { type: 'string' });
      const shadowing = ce.lookupDefinition('p')!;
      expect(shadowing).not.toBe(before);
      expect(isValueDef(shadowing) && shadowing.value.type.toString()).toBe(
        'string'
      );
    });

    expect(ce.lookupDefinition('p')).toBe(before);
    expect(isValueDef(before) && before.value.type.toString()).toBe('integer');
  });

  test('repeated redeclarations of one name unwind LIFO; a fresh name is removed', () => {
    const ce = new ComputeEngine();
    withFrame(ce, () => {
      ce._declareSymbolValue('fresh', { type: 'boolean' });
      ce._declareSymbolValue('fresh', { type: 'string' });
      ce._declareSymbolValue('fresh', { type: 'integer' });
      expect(ce.lookupDefinition('fresh')).toBeDefined();
    });
    expect(ce.lookupDefinition('fresh')).toBeUndefined();
  });
});

describe('ROLLBACK FRAMES — family 5 + cascade: provisional re-derivation', () => {
  test('a literal re-derived because a symbol became callable in-frame reverts, and the registry survives for a later real definition', () => {
    const ce = new ComputeEngine();
    // g's body applies `a` before `a` has a definition: frozen as the
    // application 2·a(t) and registered to be re-derived when `a` gains one.
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('2a(2)');

    withFrame(ce, () => {
      // Defining `a` inside the frame triggers the repair cascade: g's
      // operator definition is re-derived IN PLACE (`installRebuiltLiteral`
      // does not route through `updateDef` — its own journal entry covers
      // the mutation).
      ce.parse('a(t)\\coloneq t^2+1').evaluate();
      expect(ce.box(['g', 2]).evaluate().toString()).toBe('10');
    });

    // Back to the pre-frame application; `a` is gone.
    expect(ce.lookupDefinition('a')).toBeUndefined();
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('2a(2)');

    // The forward-reference registry rolled back too: a REAL definition of
    // `a` after the rollback still re-derives g. (This is the one-shot
    // defect the deleted `provisionalRegistryRollbackPoint` had — restoring
    // aliased Sets — turned into an acceptance test.)
    ce.parse('a(t)\\coloneq t^2+1').evaluate();
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('10');
  });
});

describe('ROLLBACK FRAMES — the fresh-matrix repair inside a frame', () => {
  test('a SUCCESSFUL repair inside a frame changes no definition', () => {
    const ce = new ComputeEngine();
    // The test declares `A` before the frame opens, as an unknown-typed
    // value definition; `B` has no declaration.
    ce.declare('A', 'unknown');
    const aDef = ce.lookupDefinition('A')!;
    if (!isValueDef(aDef)) throw new Error('expected a value definition');
    expect(aDef.value.type.toString()).toBe('unknown');
    expect(ce.lookupDefinition('B')).toBeUndefined();

    withFrame(ce, () => {
      const e = ce.parse('\\det(A+2B)'); // repair promotes A, B to matrix
      expect(e.isValid).toBe(true);
      expect(occurrence(e, 'A')!.type.toString()).toBe('matrix');
      // The repair writes the environment of the boxing, not the
      // definition.
      expect(aDef.value.type.toString()).toBe('unknown');
    });

    // No phantom matrix typing survives: `A` keeps its definition and `B`
    // has none.
    expect(ce.lookupDefinition('A')).toBe(aDef);
    expect(aDef.value.type.toString()).toBe('unknown');
    expect(ce.lookupDefinition('B')).toBeUndefined();
  });

});

describe('ROLLBACK FRAMES — nesting and exceptions', () => {
  test('nested frames touching one name unwind to each open point', () => {
    const ce = new ComputeEngine();
    ce.declare('nsym', 'integer');
    const before = ce.lookupDefinition('nsym');

    withFrame(ce, () => {
      // Family 4, outer: replace the binding.
      ce._declareSymbolValue('nsym', { type: 'boolean' });
      const outerBinding = ce.lookupDefinition('nsym');
      expect(outerBinding).not.toBe(before);
      ce._withRolledBackInference(() => {
        // Family 4, inner: replace the binding again.
        ce._declareSymbolValue('nsym', { type: 'string' });
        expect(ce.lookupDefinition('nsym')).not.toBe(outerBinding);
      });
      // Inner rollback restored the OUTER frame's state — the binding the
      // outer frame made — not the pre-frame state.
      expect(ce.lookupDefinition('nsym')).toBe(outerBinding);
      expect(ce.box('nsym').type.toString()).toBe('boolean');
    });
    expect(ce.lookupDefinition('nsym')).toBe(before);
    expect(ce.box('nsym').type.toString()).toBe('integer');
  });

  test('a throw from the body rolls back and rethrows the body error', () => {
    const ce = new ComputeEngine();
    expect(() =>
      withFrame(ce, () => {
        ce._declareSymbolValue('tsym', { type: 'real' });
        throw new Error('body-error');
      })
    ).toThrow('body-error');
    expect(ce.lookupDefinition('tsym')).toBeUndefined();
  });

  test('a throw DURING undo continues best-effort and never masks the result (release mode)', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = false;
    const assertSpy = jest
      .spyOn(console, 'assert')
      .mockImplementation(() => {});
    try {
      const result = withFrame(ce, () => {
        ce._declareSymbolValue('usym', { type: 'real' }); // undone SECOND
        // Poisoned entry, undone FIRST (strict LIFO): the unwind must
        // continue past it.
        ce._rollbackFrames[ce._rollbackFrames.length - 1].record({
          undo: () => {
            throw new Error('undo-boom');
          },
        });
        return 42;
      });
      expect(result).toBe(42);
      // The entries after the poisoned one still ran.
      expect(ce.lookupDefinition('usym')).toBeUndefined();
      // The failure was reported through console.assert.
      expect(
        assertSpy.mock.calls.some((call) => call[0] === false)
      ).toBe(true);
    } finally {
      assertSpy.mockRestore();
    }
  });

  test('in debug builds an undo failure is escalated with the body error as cause', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;
    const assertSpy = jest
      .spyOn(console, 'assert')
      .mockImplementation(() => {});
    try {
      let thrown: unknown;
      try {
        withFrame(ce, () => {
          ce._rollbackFrames[ce._rollbackFrames.length - 1].record({
            undo: () => {
              throw new Error('undo-boom');
            },
          });
          throw new Error('body-error');
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/rollback failed/);
      expect(((thrown as Error).cause as Error).message).toBe('body-error');
    } finally {
      assertSpy.mockRestore();
    }
  });
});

describe('ROLLBACK FRAMES — the escape rule (debug builds)', () => {
  test('a retained frame-created expression renders, but resolution throws', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;
    let retained: Expression | undefined;
    withFrame(ce, () => {
      ce._declareSymbolValue('escapee', { type: 'real' }); // INSIDE the frame
      retained = ce.box('escapee');
      ce.box(['Add', 'escapee', 1]);
    });
    // Rendering resolves no bindings and is explicitly permitted.
    expect(retained!.toString()).toContain('escapee');
    // Every resolving access fails deterministically: the rollback
    // tombstoned the frame-created binding.
    expect(() => retained!.evaluate()).toThrow(/discarded scope/);
    expect(() => retained!.N()).toThrow(/discarded scope/);
  });
});
