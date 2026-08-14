import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isValueDef,
  isOperatorDef,
} from '../../src/compute-engine/boxed-expression/utils';
import { sameBindingDef } from '../../src/compute-engine/boxed-expression/binders';

//
// Phase 2b acceptance suite — inference ROLLBACK FRAMES
// (`docs/plans/2026-08-13-inference-tx-design.md`, phasing §2b).
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

describe('ROLLBACK FRAMES — family 1: value-definition type slots', () => {
  test('an in-frame inference rolls back to the pre-frame type, in place', () => {
    const ce = new ComputeEngine();
    ce.box('q'); // auto-declares q: unknown (inferred) with an anchor entry
    const def = ce.lookupDefinition('q')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    expect(def.value.type.toString()).toBe('unknown');
    const provenanceBefore = def.value._typeProvenance?.slice() ?? [];

    withFrame(ce, () => {
      ce.box(['Add', 'q', 1]);
      expect(def.value.type.toString()).toBe('number');
    });

    // Same definition object, pre-frame slots, byte-identical history.
    expect(ce.lookupDefinition('q')).toBe(def);
    expect(def.value.type.toString()).toBe('unknown');
    expect(def.value.inferredType).toBe(true);
    const provenanceAfter = def.value._typeProvenance ?? [];
    expect(provenanceAfter.length).toBe(provenanceBefore.length);
    provenanceBefore.forEach((entry, i) =>
      expect(provenanceAfter[i]).toBe(entry)
    );
  });
});

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
    // g's body reads `a` before `a` is callable: frozen as the product 2·a·t
    // and registered to be re-derived when `a` gains a definition.
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('4a');

    withFrame(ce, () => {
      // Defining `a` inside the frame triggers the repair cascade: g's
      // operator definition is re-derived IN PLACE (`installRebuiltLiteral`
      // does not route through `updateDef` — its own journal entry covers
      // the mutation).
      ce.parse('a(t)\\coloneq t^2+1').evaluate();
      expect(ce.box(['g', 2]).evaluate().toString()).toBe('10');
    });

    // Back to the pre-frame product reading; `a` is gone.
    expect(ce.lookupDefinition('a')).toBeUndefined();
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('4a');

    // The forward-reference registry rolled back too: a REAL definition of
    // `a` after the rollback still re-derives g. (This is the one-shot
    // defect the deleted `provisionalRegistryRollbackPoint` had — restoring
    // aliased Sets — turned into an acceptance test.)
    ce.parse('a(t)\\coloneq t^2+1').evaluate();
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('10');
  });
});

describe('ROLLBACK FRAMES — family 6: the fresh-inference set', () => {
  test('an already-fresh member survives an in-frame re-add (prior-presence bit)', () => {
    const ce = new ComputeEngine();
    ce._withBoxingPassWindow(() => {
      // Pre-frame, in-window: fsym transitions unknown → concrete and joins
      // the set.
      ce.box(['Add', 'fsym', 1]);
      const def = ce.lookupDefinition('fsym')!;
      if (!isValueDef(def)) throw new Error('expected a value definition');
      expect(ce._freshlyInferred?.has(def.value)).toBe(true);

      ce._withRolledBackInference(() => {
        // Scaffolding: reset the slots directly (unjournaled) so the
        // in-frame inference attempts an unknown → concrete `.add()` of the
        // ALREADY-PRESENT member — the silent no-op whose naive
        // "remove what was added" undo would evict pre-frame evidence.
        def.value.type = ce.type('unknown');
        def.value.inferredType = true;
        ce.box(['Add', 'fsym', 1]);
        expect(ce._freshlyInferred?.has(def.value)).toBe(true);
      });

      expect(ce._freshlyInferred?.has(def.value)).toBe(true);
    });
  });

  test('a member added by the frame is removed on rollback', () => {
    const ce = new ComputeEngine();
    ce.box('gsym'); // declared OUTSIDE any window: not fresh
    const def = ce.lookupDefinition('gsym')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    ce._withBoxingPassWindow(() => {
      ce._withRolledBackInference(() => {
        ce.box(['Add', 'gsym', 1]);
        expect(ce._freshlyInferred?.has(def.value)).toBe(true);
      });
      expect(ce._freshlyInferred?.has(def.value) ?? false).toBe(false);
    });
  });
});

describe('ROLLBACK FRAMES — family 7: provenance history at the cap', () => {
  test('an aborted append at capacity reinserts the displaced entry', () => {
    const ce = new ComputeEngine();
    ce.box('capsym');
    const def = ce.lookupDefinition('capsym')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    // Scaffolding: a full history (the cap is 8; the oldest entry is the
    // anchor, the second-oldest is what an over-cap append displaces).
    def.value._typeProvenance = Array.from({ length: 8 }, (_, i) => ({
      type: ce.type('integer'),
      kind: 'inferred' as const,
      axis: 'type' as const,
      cause: ce.box(i),
    }));
    const entriesBefore = def.value._typeProvenance.slice();

    withFrame(ce, () => {
      ce.box(['Add', 'capsym', 1]); // appends → displaces entry at index 1
      const inFrame = def.value._typeProvenance!;
      expect(inFrame).toHaveLength(8);
      expect(inFrame[1]).toBe(entriesBefore[2]); // the eviction happened
    });

    const after = def.value._typeProvenance!;
    expect(after).toHaveLength(8);
    after.forEach((entry, i) => expect(entry).toBe(entriesBefore[i]));
  });
});

describe('ROLLBACK FRAMES — the fresh-matrix repair inside a frame', () => {
  test('a SUCCESSFUL repair rolls back with the frame', () => {
    const ce = new ComputeEngine();
    // `A` PRE-EXISTS on a fresh engine (a standard-library unknown-typed
    // value definition); `B` does not.
    const aDef = ce.lookupDefinition('A')!;
    if (!isValueDef(aDef)) throw new Error('expected a value definition');
    expect(aDef.value.type.toString()).toBe('unknown');
    expect(ce.lookupDefinition('B')).toBeUndefined();

    withFrame(ce, () => {
      const e = ce.parse('\\det(A+2B)'); // repair promotes A, B to matrix
      expect(e.isValid).toBe(true);
      expect(ce.symbol('A').type.toString()).toBe('matrix');
    });

    // The pre-existing `A` is restored in place; the frame-declared `B` is
    // removed — no phantom matrix typing survives either way.
    expect(ce.lookupDefinition('A')).toBe(aDef);
    expect(aDef.value.type.toString()).toBe('unknown');
    expect(ce.lookupDefinition('B')).toBeUndefined();
  });

  test('a FAILED repair inside a frame: repair-local restore and frame replay compose', () => {
    // The failure leg restores immediately (repair-local records) AND the
    // frame journal replays over that already-restored state at close. The
    // families involved are idempotent/inert on the second pass — see the
    // composition comment in `repairFreshMatrixInference` (`validate.ts`).
    const ce = new ComputeEngine();
    // Pre-frame definition so post-frame state is observable (not removed
    // with a frame-created binding), with a non-trivial history.
    ce.box(['Add', 'A', 1]); // auto-declared, then inferred number
    const def = ce.lookupDefinition('A')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    const typeBefore = def.value.type;
    const historyBefore = def.value._typeProvenance?.slice() ?? [];

    withFrame(ce, () => {
      const e = ce.parse('\\det(\\frac{A}{B})'); // repair runs, then fails
      expect(e.isValid).toBe(false);
      // The failure leg already restored A — while the frame is still open.
      expect(def.value.type.toString()).toBe('number');
    });

    expect(ce.lookupDefinition('A')).toBe(def);
    expect(def.value.type).toBe(typeBefore); // BoxedType identity
    const historyAfter = def.value._typeProvenance ?? [];
    expect(
      historyAfter.map((e) => [e.kind, e.type.toString()])
    ).toEqual(historyBefore.map((e) => [e.kind, e.type.toString()]));
  });
});

describe('ROLLBACK FRAMES — family 8: the narrowing sink', () => {
  test('a narrowing recorded during an aborted frame is retracted', () => {
    const ce = new ComputeEngine();
    ce.box('outerSym'); // outer definition, unknown
    const scope = ce.createScope();
    withFrame(ce, () => {
      ce.parse('\\mathrm{outerSym} + 1', { scope });
      expect(scope.narrowings()).toHaveLength(1);
    });
    // A rejected frame must not leave `narrowings()` reporting a narrowing
    // that never took effect.
    expect(scope.narrowings()).toHaveLength(0);
  });
});

describe('ROLLBACK FRAMES — nesting and exceptions', () => {
  test('nested frames touching one definition unwind to each open point', () => {
    const ce = new ComputeEngine();
    ce.box('nsym');
    const def = ce.lookupDefinition('nsym')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');

    withFrame(ce, () => {
      ce.box(['Add', 'nsym', 1]); // unknown → number (family 1, outer)
      expect(def.value.type.toString()).toBe('number');
      const outerBinding = ce.lookupDefinition('nsym');
      ce._withRolledBackInference(() => {
        // Family 4, inner: replace the binding outright.
        ce._declareSymbolValue('nsym', { type: 'string' });
        expect(ce.lookupDefinition('nsym')).not.toBe(outerBinding);
      });
      // Inner rollback restored the OUTER frame's state — the same binding,
      // still carrying the outer frame's inference — not the pre-frame
      // state.
      expect(ce.lookupDefinition('nsym')).toBe(outerBinding);
      expect(def.value.type.toString()).toBe('number');
    });
    expect(def.value.type.toString()).toBe('unknown');
  });

  test('a throw from the body rolls back and rethrows the body error', () => {
    const ce = new ComputeEngine();
    ce.box('tsym');
    const def = ce.lookupDefinition('tsym')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    expect(() =>
      withFrame(ce, () => {
        ce.box(['Add', 'tsym', 1]);
        throw new Error('body-error');
      })
    ).toThrow('body-error');
    expect(def.value.type.toString()).toBe('unknown');
  });

  test('a throw DURING undo continues best-effort and never masks the result (release mode)', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = false;
    ce.box('usym');
    const def = ce.lookupDefinition('usym')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    const assertSpy = jest
      .spyOn(console, 'assert')
      .mockImplementation(() => {});
    try {
      const result = withFrame(ce, () => {
        ce.box(['Add', 'usym', 1]); // journaled first → undone SECOND
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
      expect(def.value.type.toString()).toBe('unknown');
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
      retained = ce.box('escapee'); // auto-declared INSIDE the frame
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
