/**
 * v2 of the checkpoint API — **in-scope checkpoints** ("Quiescence" in
 * `docs/CHECKPOINT-MODEL.md`; the v2 item committed when the session-base
 * restriction shipped, because the consumer's cells always evaluate inside a
 * host-pushed scope and per-cell checkpointing is impossible without this).
 *
 * The v2 rule is STACK IDENTITY, not a depth count:
 *
 * - `checkpoint()` is legal at any quiescent point, whatever the depth. The
 *   checkpoint captures the eval-context stack — the frames themselves, by
 *   identity, not their count — because restore rewrites those frames' state
 *   (assumptions per frame) in place and a same-depth stack of DIFFERENT
 *   frames would be a different world that happens to be the same height.
 * - `restore(cp)` requires the live stack to equal the captured one,
 *   frame for frame. Deeper (a scope pushed since), shallower, or same-depth
 *   different-frames all refuse with `checkpoint-not-quiescent`.
 * - POPPING a frame a live checkpoint stands on KILLS that checkpoint, the
 *   way restoring past it would: its window folds into the next-older live
 *   checkpoint (or is freed when it is the oldest), and the scope pop's
 *   disposal of the frame's bindings proceeds as ever. Restoring past a
 *   scope-killed checkpoint therefore stays sound.
 * - `discard(cp)` stays legal at any quiescent point: it folds journal
 *   windows and rewrites nothing, and the kill-on-pop rule maintains the
 *   invariant that every LIVE checkpoint's captured stack is a prefix of the
 *   current one.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  CheckpointError,
  type CheckpointErrorCode,
} from '../../src/compute-engine/checkpoint';

function refusalCode(fn: () => void): CheckpointErrorCode | string {
  try {
    fn();
    return 'NO THROW';
  } catch (e) {
    if (e instanceof CheckpointError) return e.code;
    throw e;
  }
}

function value(ce: ComputeEngine, name: string): string {
  return ce.symbol(name).evaluate().toString();
}

describe('checkpoints inside a host-pushed scope', () => {
  test('the consumer flow: per-cell checkpoints inside one pass scope', () => {
    // The exact shape v2 exists for: the host pushes a scope for the pass,
    // takes a checkpoint per cell INSIDE it, and edits by restoring within
    // the same scope.
    const ce = new ComputeEngine();
    ce.pushScope(undefined, 'pass');
    try {
      executeEpsil(ce, 'a = 1');
      const cp = ce.checkpoint('after cell 1');
      executeEpsil(ce, 'a = 2');
      executeEpsil(ce, 'b = 7');

      ce.restore(cp);
      expect(value(ce, 'a')).toBe('1');
      expect(ce.lookupDefinition('b')).toBeUndefined();

      executeEpsil(ce, 'a = 42');
      expect(value(ce, 'a')).toBe('42');
    } finally {
      ce.popScope();
    }
  });

  test('restore agrees with a fresh engine running the same in-scope program', () => {
    const run = (edit: boolean): string => {
      const ce = new ComputeEngine();
      ce.pushScope(undefined, 'pass');
      try {
        executeEpsil(ce, 'x = 3');
        executeEpsil(ce, 'f(t) = t * x');
        const cp = ce.checkpoint();
        if (edit) {
          executeEpsil(ce, 'x = 100');
          executeEpsil(ce, 'f(t) = "gone"');
          ce.restore(cp);
        }
        executeEpsil(ce, 'y = f(2) + x');
        return `${value(ce, 'y')} | ${ce.box(['f', 2]).type.toString()}`;
      } finally {
        ce.popScope();
      }
    };
    expect(run(true)).toBe(run(false));
  });

  test('a deeper stack refuses a shallower checkpoint, and vice versa', () => {
    const ce = new ComputeEngine();
    const base = ce.checkpoint();

    ce.pushScope(undefined, 'pass');
    try {
      // Restoring a base checkpoint while a scope is open would strand the
      // open frame: refuse.
      expect(refusalCode(() => ce.restore(base))).toBe(
        'checkpoint-not-quiescent'
      );
      const inner = ce.checkpoint();
      ce.popScope();
      // The pop already killed `inner`, so the DEAD check — not the stack
      // comparison — is what refuses here: kill-on-pop maintains the
      // invariant that a live checkpoint's frames are a prefix of the
      // current stack, which makes same-height-different-frames unreachable
      // through public pops. (The identity comparison itself is pinned by
      // the missed-pop-site test below.)
      ce.pushScope(undefined, 'pass-2');
      expect(inner.live).toBe(false);
      expect(refusalCode(() => ce.restore(inner))).toBe('checkpoint-dead');
    } finally {
      ce.popScope();
    }
    // Back at the base, the base checkpoint restores.
    ce.restore(base);
    expect(base.live).toBe(true);
  });

  test('popping a scope kills the checkpoints standing on it', () => {
    const ce = new ComputeEngine();
    const base = ce.checkpoint();
    executeEpsil(ce, 'k = 1');

    ce.pushScope(undefined, 'pass');
    const inner1 = ce.checkpoint();
    executeEpsil(ce, 'k = 2');
    const inner2 = ce.checkpoint();
    ce.popScope();

    expect(inner1.live).toBe(false);
    expect(inner2.live).toBe(false);
    expect(base.live).toBe(true);

    // Restoring PAST the scope-killed checkpoints is sound: their windows
    // were folded downward when the pop killed them, so the base restore
    // still unwinds the writes made inside the popped scope.
    ce.restore(base);
    expect(ce.lookupDefinition('k')).toBeUndefined();
  });

  test('a scope-killed interior checkpoint folds its window downward', () => {
    // The discriminating key is `m`, written ONLY after the inner checkpoint:
    // the survivor's window holds no entry for it, so restoring `outer` can
    // only unwind that write through the fold of the killed checkpoint's
    // window. (A key also written between `outer` and the push — like `k`
    // here — cannot discriminate: the survivor's own first-write entry
    // already carries the older value, and the folded one is dropped in its
    // favor. The first version of this test used only such a key and passed
    // with the fold deleted — mutation-tested.)
    const ce = new ComputeEngine();
    executeEpsil(ce, 'k = 0');
    executeEpsil(ce, 'm = 1');
    const outer = ce.checkpoint();
    executeEpsil(ce, 'k = 1');

    ce.pushScope(undefined, 'pass');
    const inner = ce.checkpoint();
    executeEpsil(ce, 'm = 5');
    ce.popScope();
    expect(inner.live).toBe(false);

    expect(value(ce, 'm')).toBe('5');
    ce.restore(outer);
    expect(value(ce, 'k')).toBe('0');
    expect(value(ce, 'm')).toBe('1');
  });

  test('the stack comparison is by IDENTITY — the net under a missed pop site', () => {
    // Kill-on-pop makes same-height-different-frames unreachable through the
    // public pop routes, so the identity half of the restore check guards one
    // thing: a FUTURE pop site that forgets the invalidation hook. Simulate
    // exactly that by swapping the top frame for a same-shape clone behind
    // the API's back; a depth-only comparison would sail past it and rewrite
    // the wrong frame's state.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'n = 1');
    const cp = ce.checkpoint();

    const stack = (
      ce as unknown as { _evalContextStack: Record<string, unknown>[] }
    )._evalContextStack;
    const real = stack[stack.length - 1];
    stack[stack.length - 1] = { ...real };
    try {
      expect(refusalCode(() => ce.restore(cp))).toBe(
        'checkpoint-not-quiescent'
      );
    } finally {
      stack[stack.length - 1] = real;
    }
    ce.restore(cp);
    expect(value(ce, 'n')).toBe('1');
  });

  test('discard stays legal from a different depth', () => {
    // Discard folds journal windows and rewrites no frame state, so unlike
    // restore it does not need the captured stack back — and refusing it
    // would make cleanup of an in-scope checkpoint impossible after the
    // host's own pop timing moved on.
    const ce = new ComputeEngine();
    const base = ce.checkpoint();
    executeEpsil(ce, 'd = 1');
    const mid = ce.checkpoint();

    ce.pushScope(undefined, 'pass');
    try {
      expect(refusalCode(() => ce.discard(mid))).toBe('NO THROW');
    } finally {
      ce.popScope();
    }
    ce.restore(base);
    expect(ce.lookupDefinition('d')).toBeUndefined();
  });

  test('assumptions restore per frame at depth', () => {
    const ce = new ComputeEngine();
    ce.pushScope(undefined, 'pass');
    try {
      const cp = ce.checkpoint();
      ce.assume(ce.parse('q > 0'));
      expect(ce.verify(ce.parse('q > 0'))).toBe(true);
      ce.restore(cp);
      expect(ce.verify(ce.parse('q > 0'))).not.toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('the by-identity removal route (removeEvalContext) kills a checkpoint standing on the frame', () => {
    // No PUBLIC path can put a checkpoint on an asynchronously-removed frame
    // — quiescence refuses `checkpoint()` while an async evaluation is in
    // flight — so this drives the route directly through the internal
    // `_removeEvalContext`, the method the async settle path calls. What it
    // pins is the route's obligation, not a public scenario: a frame removed
    // BY IDENTITY, even from mid-stack, retires exactly the checkpoints
    // standing on it.
    const ce = new ComputeEngine();
    const base = ce.checkpoint();

    ce.pushScope(undefined, 'A');
    const frameA = ce.context;
    const cpOnA = ce.checkpoint();
    ce.pushScope(undefined, 'B');
    const cpOnB = ce.checkpoint();

    // Splice frame A out from MID-STACK, under frame B — the shape only the
    // async settle produces. Every checkpoint standing on A dies (cpOnB's
    // captured stack contains A too); the base checkpoint, which never
    // contained A, survives: the retirement scan must find the contiguous
    // top segment and stop there, neither early nor over-killing.
    ce._removeEvalContext(frameA);
    expect(cpOnA.live).toBe(false);
    expect(cpOnB.live).toBe(false);
    expect(base.live).toBe(true);

    // The engine is still coherent: pop the orphaned B frame and the base
    // checkpoint restores.
    ce.popScope();
    ce.restore(base);
    expect(base.live).toBe(true);
  });

  test('an async settle runs the retirement hook and spares a base checkpoint', async () => {
    // The public face of the same route: a checkpoint taken BEFORE an async
    // evaluation starts never contains the evaluation's frames, so the
    // settle-time removal must invoke the retirement hook (the checkpoint
    // stack is non-empty) and retire nothing. The hook invocation is
    // observed with an instance-level spy — without it, this test would stay
    // green with the settle-path hook deleted, which is exactly the vacuity
    // its first version had (dual-review finding).
    const ce = new ComputeEngine();
    const base = ce.checkpoint();

    const hooked: unknown[] = [];
    const original = ce._invalidateCheckpointsOnFrameDiscard.bind(ce);
    (ce as unknown as Record<string, unknown>)._invalidateCheckpointsOnFrameDiscard =
      (frame: unknown) => {
        hooked.push(frame);
        original(frame as Parameters<typeof original>[0]);
      };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    ce.declare('slowScoped', {
      signature: '() -> integer',
      scoped: true,
      evaluate: (_ops, { engine }) => engine.number(1),
      evaluateAsync: async (_ops, { engine }) => {
        await gate;
        return engine.number(1);
      },
    });

    const pending = ce.box(['slowScoped']).evaluateAsync();
    release();
    await pending;

    expect(hooked.length).toBeGreaterThan(0);
    expect(base.live).toBe(true);
    ce.restore(base);
  });
});
