type DevolveRepairFrame<Scope extends object> = {
  scope: Scope | undefined;
  repairRequested: boolean;
  rebuilding: boolean;
};

/**
 * Rebuilds allowed after the initial pass. Every rebuild sees all the shadows
 * created so far, so one is normally enough: a second is already anomalous,
 * and only a construction whose SHAPE changes as bindings appear could need
 * more. A small bound keeps a scope-lifecycle defect from looping forever.
 */
const MAX_REPAIR_REBUILDS = 3;

/**
 * Per-engine coordination for the un-applied-operator repair performed while
 * boxing expressions.
 *
 * A root frame makes nested `ce.expr()` calls one construction. Scoped frames
 * form local restart boundaries: when validation creates a shadow in a scoped
 * operator, that operator is rebuilt against the same scope, so operands boxed
 * before the declaration see the new binding too.
 */
export class EngineBoxingState<Scope extends object> {
  private _frames: DevolveRepairFrame<Scope>[] = [];
  private _rootActive = false;

  withRootRepair<T>(build: () => T): T {
    if (this._rootActive) return build();

    this._rootActive = true;
    try {
      return this._withRepairFrame(undefined, build);
    } finally {
      this._rootActive = false;
    }
  }

  withScopedRepair<T>(scope: Scope, build: () => T): T {
    // `_inScope()` is also used during evaluation. Rebuilding an evaluation
    // would repeat user-visible effects, so scoped repair frames exist only
    // while a root boxing construction is active.
    if (!this._rootActive) return build();
    return this._withRepairFrame(scope, build);
  }

  /**
   * True while a frame is re-running its `build` after a shadow was created.
   *
   * Boxing consults it to rebind the operands that were ALREADY boxed when
   * the shadow appeared: those carry the stale operator binding, and a
   * canonical expression passes through boxing unchanged, so the rebuild
   * alone does not reach them. Only the rebuild pays for that lookup — a
   * normal boxing pass never asks.
   */
  get isRebuilding(): boolean {
    return this._frames.some((frame) => frame.rebuilding);
  }

  /** Request a rebuild at the nearest frame that owns `scope`. */
  noteDevolvedShadow(scope: Scope): void {
    for (let i = this._frames.length - 1; i >= 0; i--) {
      const frame = this._frames[i];
      if (frame.scope === scope) {
        frame.repairRequested = true;
        return;
      }
    }

    // An unscoped construction is the fallback owner. This is normally the
    // root frame; scanning from the outside keeps the whole expression as the
    // restart boundary instead of rebuilding only the operand that noticed the
    // stale binding.
    const root = this._frames.find((frame) => frame.scope === undefined);
    // No frame at all: the shadow was invented outside any boxing
    // construction, so nothing will redo the occurrences that were bound
    // before it existed. That is a construction path bypassing
    // `box()`/`ce.function()`, not a user error — flag it in development, the
    // same way the frame-balance invariant below is flagged.
    console.assert(
      root !== undefined,
      'Devolved shadow created outside a boxing construction: the stale bindings will not be repaired'
    );
    if (root) root.repairRequested = true;
  }

  private _withRepairFrame<T>(scope: Scope | undefined, build: () => T): T {
    const frame: DevolveRepairFrame<Scope> = {
      scope,
      repairRequested: false,
      rebuilding: false,
    };
    this._frames.push(frame);
    try {
      let result = build();
      let rebuilds = 0;
      while (frame.repairRequested) {
        // A retry against the same scope must see the shadows created by the
        // previous passes. If it keeps creating new ones, the construction is
        // not stable and looping forever would conceal a scope-lifecycle
        // defect.
        if (rebuilds >= MAX_REPAIR_REBUILDS) {
          const message = `Devolved-shadow repair did not stabilize after ${MAX_REPAIR_REBUILDS} rebuilds`;
          console.assert(false, message);
          // `console.*` is stripped from production builds, so the assert
          // alone would let an expression in which one name denotes two
          // things ship silently. Throwing is the only signal available here:
          // this class is engine-agnostic — it cannot build an `Error`
          // expression — and the result it returns must stay a valid boxing
          // anyway. The condition is an engine defect, not bad input, so a
          // thrown `Error` (as `boxFunction` already does for a malformed
          // operator name) is the least surprising failure.
          throw new Error(message);
        }
        frame.repairRequested = false;
        frame.rebuilding = true;
        rebuilds += 1;
        try {
          result = build();
        } finally {
          frame.rebuilding = false;
        }
      }
      return result;
    } finally {
      const popped = this._frames.pop();
      console.assert(popped === frame, 'Unbalanced boxing repair frame');
    }
  }
}
