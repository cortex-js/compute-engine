import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import type { LoweredLevel } from './map-broadcast-shape.js';
import { lowerLevel } from './map-broadcast-shape.js';
import { mapAutoCompileRunner } from './map-auto-compile.js';

// The broadcast-shape walk moved to `map-broadcast-shape.js` (a leaf shared
// with `map-auto-compile.js`, which cannot import this module — it is imported
// BY it). Re-exported here so the lowering's public surface is unchanged.
export type { Slot, LoweredLevel } from './map-broadcast-shape.js';

/**
 * Drain-time lowering of a stacked lazy-`Map` broadcast chain
 * ("Map fusion" — `docs/plans/2026-07-27-map-fusion-design.md`, ratified
 * 2026-07-27).
 *
 * Broadcast arithmetic over a lazy collection stacks lazy `Map`s: the
 * item-103 witness `1 + Mod(Range(0,899) + 29, 900)` canonicalizes to THREE
 * nested `Map`s, so a 900-element drain performs 2,700 full `makeLambda`
 * applications. None of the invoke machinery (fresh `Scope`,
 * `declareParameterActivation`, `hideBodyScopeParams`, `captureClosures`,
 * binding-keyed substitution, own-bindings numeric pass) is needed when the
 * mapping function is the shape `lazyBroadcastMap` builds: ONE operator
 * application whose operands are the parameters and closed scalars.
 *
 * This module walks that spine at drain start and reduces each level to
 * `(operator, slot layout, N marker)`. The drain then serves an element with
 * `ce._fn(op, args).evaluate()` per level, bypassing `makeLambda` entirely
 * (R1: locus is the `Map` collection handlers — canonical forms, `.json`,
 * serialization, types and facet delegation are untouched).
 *
 * The gate is purely STRUCTURAL (R2): no operator allowlist, no name sets. A
 * level that doesn't match ends the spine there; everything below it drains
 * through the untouched general path.
 */

export interface LoweredSpine {
  /** The base source streams, drained via their own `each()`/`at()`. One
   * entry unless the innermost level is variadic. */
  bases: Expression[];
  /** Innermost FIRST: an element flows `levels[0]` → `levels[n-1]`. */
  levels: LoweredLevel[];
}

/**
 * Memo of the structural lowering, keyed on the `Map` instance the collection
 * handlers receive. Canonical expressions are structurally immutable, so the
 * memo needs no invalidation (the same argument as the
 * `lazyMapNumericApproximation` rewrap memo). The NEGATIVE result is
 * memoized too, so a non-lowerable `Map` pays the shape check once.
 */
const spineMemo = new WeakMap<Expression, LoweredSpine | null>();

/**
 * Walk the `Map` spine from `expr` (the drained instance) down through
 * single-source lowerable levels. A multi-source lowerable level terminates
 * the walk: its sources become the base streams (a deeper `Map` among them
 * lowers its own spine inside its own iterator — one iterator hop, measured
 * ~free). Returns `undefined` when `expr` itself is not lowerable, in which
 * case the caller uses the untouched general path.
 *
 * Pure structural walk — never evaluates or materializes anything.
 */
export function lowerMapSpine(expr: Expression): LoweredSpine | undefined {
  const memo = spineMemo.get(expr);
  if (memo !== undefined) return memo ?? undefined;

  let level = lowerLevel(expr);
  if (!level) {
    spineMemo.set(expr, null);
    return undefined;
  }

  const levels: LoweredLevel[] = [level];
  let bases: Expression[];
  for (;;) {
    if (level.arity !== 1) {
      bases = [...level.sources];
      break;
    }
    const source = level.sources[0];
    const inner = lowerLevel(source);
    if (!inner) {
      bases = [source];
      break;
    }
    levels.push(inner);
    level = inner;
  }

  levels.reverse();
  const spine: LoweredSpine = { bases, levels };
  spineMemo.set(expr, spine);
  return spine;
}

/**
 * The per-drain element runner for a lowered spine (R3/R4).
 *
 * Auto-compile keeps precedence, per level: each level's
 * `mapAutoCompileRunner` is resolved once here (a new runner set is a new
 * drain — the iterator creates one, each `at()` access creates its own
 * micro-drain) and consulted first per element — with the RAW row, exactly as
 * the general iterator consults it — with fallback to direct evaluation.
 *
 * `onLevelFailure` decides what a failed level application produces, because
 * the two general routes are ASYMMETRIC and each lowered route must mirror its
 * own:
 * - the ITERATOR emits the failing level's position-preserving
 *   `absenceMarker` as an ordinary element value, which then flows through the
 *   remaining levels (return the marker to continue);
 * - `at()` short-circuits the whole access (return `undefined` to abort, which
 *   the runner propagates to its caller).
 *
 * The returned function maps a base element row to the outer element.
 */
export function makeSpineRunner(
  ce: ComputeEngine,
  spine: LoweredSpine,
  onLevelFailure: (levelExpr: Expression) => Expression | undefined
): (row: ReadonlyArray<Expression>) => Expression | undefined {
  const levels = spine.levels;
  const runners = levels.map((l) =>
    mapAutoCompileRunner(l.expr, { drainStart: true })
  );

  return (baseRow) => {
    let row: ReadonlyArray<Expression> = baseRow;
    // The base row arrives RAW from the source's `each()`/`at()`; every later
    // row holds the previous level's already-evaluated result.
    let rowEvaluated = false;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      let v = runners[i]?.(row);
      if (v === undefined) {
        let invalidInput = false;
        if (!rowEvaluated) {
          // `makeLambda` step 4 evaluates every argument in the calling scope
          // before the body runs: a row of symbols carrying assigned values
          // would otherwise pass through raw. `.evaluate()` is cheap on an
          // already-evaluated value.
          row = row.map((e) => e.evaluate());
          rowEvaluated = true;
          // `makeLambda` step 2: in strict mode an invalid argument declines
          // the application.
          invalidInput = ce.strict && row.some((e) => e.isValid === false);
        }
        if (!invalidInput) {
          if (level.identity) v = row[level.slots![0] as number];
          else {
            const slots = level.slots!;
            const args: Expression[] = [];
            for (const s of slots)
              args.push(typeof s === 'number' ? row[s] : (s as Expression));
            const opts = level.napprox
              ? { numericApproximation: true as const }
              : undefined;
            // A level whose operands closed over an enclosing frame must be
            // evaluated INSIDE that closure chain: the lowered path runs in the
            // ambient scope, where a captured variable is unbound once its
            // defining call has returned (a lazy `Map` outlives it). Levels
            // whose operands are all literals — the shape this fusion was built
            // for — record no scope and keep the original zero-scope-work path.
            if (level.closureScope) {
              ce.pushScope(level.closureScope);
              try {
                v = ce._fn(level.op!, args).evaluate(opts);
              } finally {
                ce.popScope();
              }
            } else v = ce._fn(level.op!, args).evaluate(opts);
          }
        }
      }
      if (v === undefined || v.isValid === false) {
        v = onLevelFailure(level.expr);
        if (v === undefined) return undefined;
      }
      row = [v];
      rowEvaluated = true;
    }
    return row[0];
  };
}
