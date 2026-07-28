import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards.js';
import { mapAutoCompileRunner } from './map-auto-compile.js';

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

/** An operand of a lowered level: either a closed (parameter-free) operand of
 * the original canonical body — used as-is, so it carries its bindings — or
 * the 0-based index of the parameter it names within the level's element
 * row. */
export type Slot = Expression | number;

export interface LoweredLevel {
  /** The level's own `Map` instance — the key `mapAutoCompileRunner` and the
   * compile caches are keyed on. */
  expr: Expression;
  /** The body is a bare parameter symbol: the element passes through
   * unchanged. Never set when `napprox` is true (the `N` marker must still be
   * applied). */
  identity: boolean;
  /** The applied operator (absent for an identity level). */
  op?: string;
  /** The operand layout (absent for an identity level; for an identity level
   * `slots[0]` is the pass-through row index). */
  slots?: Slot[];
  /** The body carried the `Block(N(…))` numeric marker: this level evaluates
   * with `{ numericApproximation: true }`. */
  napprox: boolean;
  /** The number of source collections of this level (= parameter count). */
  arity: number;
  /** The level's source operands (everything but the mapping function). */
  sources: ReadonlyArray<Expression>;
}

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
 * `true` when the head of the application `body` is declared IMPURE. Read from
 * the node's own definition; the body of a `.N()` rewrap is re-boxed from
 * MathJSON and can arrive UNBOUND, so fall back to a by-name lookup rather
 * than canonicalizing (canonicalization would reorder the operands the slot
 * layout is read from).
 */
function isImpureHead(ce: ComputeEngine, body: Expression): boolean {
  const bound = body.operatorDefinition;
  if (bound) return bound.pure === false;
  const def = ce.lookupDefinition(body.operator);
  if (def && 'operator' in def) return def.operator.pure === false;
  return false;
}

/**
 * The structural gate (§4, R2). A level is lowerable iff it is a `Map` whose
 * mapping function is *broadcast-shaped*: a canonical `Function` literal with
 * bare (unannotated) parameters, one per source, whose body — after
 * unwrapping a single-statement `Block` and then an optional `N` marker — is
 * either a bare parameter symbol or a single function application each of
 * whose operands is a parameter symbol or a parameter-free subexpression, and
 * whose head is not declared impure (scope safety, see below).
 *
 * Side-effect free: nothing is evaluated or materialized.
 */
function lowerLevel(expr: Expression): LoweredLevel | undefined {
  if (!isFunction(expr, 'Map')) return undefined;
  if (expr.nops < 2) return undefined;

  const fn = expr.ops[expr.nops - 1];
  if (!isFunction(fn, 'Function')) return undefined;

  // The parameters must be BARE symbols (a `["Typed", …]` annotation is not
  // a symbol, so annotated parameters fall out here), one per source.
  const params = fn.ops.slice(1);
  const sources = expr.ops.slice(0, -1);
  const arity = sources.length;
  if (params.length !== arity) return undefined;
  const names: string[] = [];
  for (const p of params) {
    if (!isSymbol(p)) return undefined;
    const name = sym(p);
    if (name === undefined) return undefined;
    names.push(name);
  }

  let body = fn.ops[0];
  if (body === undefined) return undefined;

  // A canonical body is a scoped `Block`; only a SINGLE-statement block is
  // in shape.
  if (isFunction(body, 'Block')) {
    if (body.nops !== 1) return undefined;
    body = body.op1;
  }

  // The numeric marker (`Block(N(inner))`, from the item-39 `.N()` rewrap and
  // the `addN`/`mulN` N-maps).
  let napprox = false;
  if (isFunction(body, 'N') && body.nops === 1) {
    napprox = true;
    body = body.op1;
  }

  if (isSymbol(body)) {
    const index = names.indexOf(sym(body) ?? '');
    if (index < 0) return undefined;
    // An identity body under the `N` marker is NOT a pass-through: the marker
    // must still be applied. Model it as an `N` application of the parameter.
    if (napprox)
      return {
        expr,
        identity: false,
        op: 'N',
        slots: [index],
        napprox,
        arity,
        sources,
      };
    return { expr, identity: true, slots: [index], napprox, arity, sources };
  }

  if (!isFunction(body)) return undefined;

  // Scope safety. The general path runs the body inside a FRESH function
  // frame; the lowered path evaluates the application in the AMBIENT scope. A
  // body whose head WRITES scope (`Assign`, `Declare`, `Assume`) would
  // therefore leak its mutation engine-wide. The gate is derived from the
  // operator DEFINITION — no name list: lower only when purity is not
  // `false`. Heads that are impure but scope-safe (`Random`, …) fall back to
  // the general path too: an accepted perf-only concession, not a
  // correctness one. A head with NO definition may pass — an unknown operator
  // cannot write scope and evaluates identically on both paths.
  if (isImpureHead(expr.engine, body)) return undefined;

  const slots: Slot[] = [];
  for (const o of body.ops) {
    if (isSymbol(o)) {
      const index = names.indexOf(sym(o) ?? '');
      if (index >= 0) {
        slots.push(index);
        continue;
      }
    }
    // A closed operand: kept as the ORIGINAL node so it carries its bindings
    // (reactivity) and its impurity (draw order) exactly as the interpreter's
    // body evaluation does. The `.N()` rewrap
    // (`lazyMapNumericApproximation`) re-boxes the body from MathJSON, so its
    // operands can arrive UNBOUND; bind them here, once per instance —
    // `.canonical` binds structure without substituting assigned symbol
    // values, so reactivity and impurity are preserved.
    if (o.has(names)) return undefined;
    slots.push(o.isCanonical ? o : o.canonical);
  }

  return {
    expr,
    identity: false,
    op: body.operator,
    slots,
    napprox,
    arity,
    sources,
  };
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
            v = ce
              ._fn(level.op!, args)
              .evaluate(
                level.napprox ? { numericApproximation: true } : undefined
              );
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
