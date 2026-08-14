import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import type { LoweredLevel } from './map-broadcast-shape.js';
import {
  hasAnnotatedParams,
  lowerLevel,
  sourceElementTypeKey,
} from './map-broadcast-shape.js';
import { mapAutoCompileRunner } from './map-auto-compile.js';
import { errorValue } from '../boxed-expression/error-value.js';

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

interface SpineMemo {
  /** `null` when the instance is not lowerable. */
  spine: LoweredSpine | null;
  /** The `Map` instances consulted by the walk whose mapping function carries
   * an ANNOTATED parameter — the levels whose outcome read a source TYPE.
   * Empty when the walk was purely structural, which makes the memo
   * permanent. */
  typeExprs: Expression[];
  /** The concatenated source element-type keys of `typeExprs` at record
   * time. */
  typeKey: string;
  /** `ce._semanticVersion` at record time (only consulted when `typeExprs`
   * is non-empty). */
  generation: number;
}

/**
 * Memo of the structural lowering, keyed on the `Map` instance the collection
 * handlers receive. Canonical expressions are structurally immutable, so a
 * purely structural outcome needs no invalidation (the same argument as the
 * `lazyMapNumericApproximation` rewrap memo). The NEGATIVE result is memoized
 * too, so a non-lowerable `Map` pays the shape check once.
 *
 * The ONE non-structural outcome — a level admitted (or declined) on a
 * parameter ANNOTATION, which reads the source's TYPE — is recorded together
 * with the source element-type keys the walk read (`sourceElementTypeKey`), at
 * every level of the spine that carries an annotation. A later ask on a NEW
 * mutation generation then REVALIDATES rather than re-derives: recomputing the
 * keys is a type read per source, against a full structural walk of the spine,
 * and an unrelated `ce.assign` leaves them untouched. Only a key that actually
 * MOVED re-derives — which is what the admission requires, since it stands in
 * for the enforcement the lowered path bypasses and must retract with the type
 * that justified it. `at()` makes this load-bearing rather than cosmetic: each
 * access is its own micro-drain, so an unmemoized annotated spine would re-walk
 * per element.
 */
const spineMemo = new WeakMap<Expression, SpineMemo>();

/** The recorded keys of `typeExprs`, recomputed. */
function typeKeyOf(typeExprs: ReadonlyArray<Expression>): string {
  let key = '';
  for (const x of typeExprs) key += sourceElementTypeKey(x) + ';';
  return key;
}

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
  const ce = expr.engine;
  const memo = spineMemo.get(expr);
  if (memo !== undefined) {
    if (memo.typeExprs.length === 0) return memo.spine ?? undefined;
    if (memo.generation === ce._semanticVersion) return memo.spine ?? undefined;
    // A new generation: revalidate the TYPES the outcome was derived from
    // rather than the outcome itself. Unchanged — the common case, since any
    // `ce.assign` anywhere bumps the generation — the memo stands.
    if (typeKeyOf(memo.typeExprs) === memo.typeKey) {
      memo.generation = ce._semanticVersion;
      return memo.spine ?? undefined;
    }
  }

  // Every `Map` the walk consults whose mapping function carries an annotated
  // parameter, whether it is ADMITTED or DECLINED: a decline that an annotation
  // may have caused is not permanent either (the source's type can improve),
  // so it must be revalidated on the same terms.
  const typeExprs: Expression[] = [];
  if (hasAnnotatedParams(expr)) typeExprs.push(expr);

  const record = (spine: LoweredSpine | null): void => {
    spineMemo.set(expr, {
      spine,
      typeExprs,
      typeKey: typeKeyOf(typeExprs),
      generation: ce._semanticVersion,
    });
  };

  let level = lowerLevel(expr);
  if (!level) {
    record(null);
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
    if (hasAnnotatedParams(source)) typeExprs.push(source);
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
  record(spine);
  return spine;
}

/**
 * The first `Error` value carried by a row, or `undefined` — the lowered
 * path's copy of `invoke`'s `firstErrorArg` (`function-utils.ts`), down to
 * calling `errorValue` with no frame so the bubbled error is byte-identical to
 * the unfused route's. `errorValue` short-circuits on `isValid`, so a row of
 * ordinary values costs one property read per element.
 */
function rowError(row: ReadonlyArray<Expression>): Expression | undefined {
  for (const x of row) {
    const err = errorValue(x);
    if (err !== undefined) return err;
  }
  return undefined;
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
      // `invoke` step 2 (rung 2 of the error-propagation design): an argument
      // that IS — or embeds — an `Error` makes the application evaluate to
      // that error value, and the body never runs. The lowered path must
      // mirror it exactly: an element that arrived as an error (an inner
      // enforcing level's per-element diagnostic, say) would otherwise be fed
      // to `ce._fn(op, …).evaluate()` and come back as NaN, laundering the
      // diagnostic the unfused route preserves. The error becomes the element's
      // result for this level and flows on through the remaining ones, where
      // this same check passes it along — exactly what the nested general
      // iterators do.
      let err = rowError(row);
      let v: Expression | undefined;
      if (err === undefined) v = runners[i]?.(row);
      if (err === undefined && v === undefined) {
        let invalidInput = false;
        if (!rowEvaluated) {
          // `makeLambda` step 4 evaluates every argument in the calling scope
          // before the body runs: a row of symbols carrying assigned values
          // would otherwise pass through raw. `.evaluate()` is cheap on an
          // already-evaluated value.
          row = row.map((e) => e.evaluate());
          rowEvaluated = true;
          // `invoke` step 4: an argument that only became an error when
          // EVALUATED bubbles like a literal one.
          err = rowError(row);
          // `makeLambda` step 2: in strict mode an invalid argument declines
          // the application.
          invalidInput =
            err === undefined &&
            ce.strict &&
            row.some((e) => e.isValid === false);
        }
        if (err === undefined && !invalidInput) {
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
            //
            // Push the body scope's PARENT, not the body scope: the chain the
            // closed-over operand must resolve in starts one level OUT. The
            // body scope's own bindings are the literal's parameters — which
            // this path supplies positionally, never by name — plus whatever
            // canonicalization auto-declared there, and both are VALUELESS. A
            // free symbol of the body that the enclosing literal binds is
            // auto-declared into the inner scope too, so pushing the body
            // scope makes that valueless shadow win over the binding that
            // actually holds the value, and the element comes back symbolic
            // (Tycho item 160: `Min(Map(k ↦ Max(Map(j ↦ j·k, M)), L))`
            // evaluated to `Min(Max(k, 3k), …)` with `k` free). This mirrors
            // the general route, which pushes `freshScope` and reaches the
            // closure chain through its parent — `bodyScope` is never in
            // `makeLambda`'s lookup path for a non-parameter name either.
            //
            // Read at DRAIN time, not when the level was lowered: the spine is
            // memoized on the `Map` instance, while `invoke` re-parents a body
            // scope for the duration of each call (`bodyScope.parent =
            // freshScope`, restored in its `finally`). A parent captured at
            // lowering time would be a stale link into a frame that has since
            // returned.
            const closureParent = level.closureScope?.parent;
            if (closureParent) {
              ce.pushScope(closureParent);
              try {
                v = ce._fn(level.op!, args).evaluate(opts);
              } finally {
                ce.popScope();
              }
            } else v = ce._fn(level.op!, args).evaluate(opts);
          }
        }
      }
      if (err !== undefined) {
        // Bubbled, not a level FAILURE: the error is the element's value on
        // both routes (the iterator emits it, `at()` returns it), so it must
        // not go through `onLevelFailure` (whose `at()` arm aborts the access).
        row = [err];
        rowEvaluated = true;
        continue;
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
