import type {
  Expression,
  IComputeEngine as ComputeEngine,
  BoxedDefinition,
  BoxedValueDefinition,
  Scope,
} from '../global-types.js';

import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { bignumPreferred, isValueDef } from '../boxed-expression/utils.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { lookup } from '../function-utils.js';
import { implicitCompile } from '../implicit-compile.js';
import { checkDeadline } from '../../common/interruptible.js';
import { exactTierShape, MIN_EXACT_COMPILE_COUNT } from './map-exact-proof.js';

/**
 * Auto-compilation of lazy-`Map` element lambdas on numeric drains.
 *
 * When a lazy `Map` whose element lambda carries the numeric marker — the
 * canonical `Block(N(body))` shape produced by the item-39 `.N()` rewrap and
 * the `addN`/`mulN` N-maps — is drained at machine precision, an
 * eligibility-gated compile attempt produces a per-logical-instance cached
 * compiled element function, validated per invocation against the same
 * two-axis keys that govern the comprehension cache
 * (`ce._mutationGeneration` + per-definition `_writeVersion`), with silent
 * per-element interpreter fallback.
 *
 * Design: `docs/plans/2026-07-19-map-auto-compile-design.md` (ratified
 * 2026-07-19). The cache is keyed on the **rewrapped** `Map` instance, which
 * is stable per logical Map because `lazyMapNumericApproximation` memoizes
 * the rewrap (see `collection-utils.ts`); `subs()`/re-box copies are new
 * originals and run cold (item-40 contract).
 *
 * ## Two tiers
 *
 * - the **marked** (float) tier above, gated on the `Block(N(…))` marker and
 *   restricted to machine precision;
 * - the **exact** tier (`docs/plans/2026-07-31-exact-map-drain-compile-design.md`,
 *   ratified 2026-07-31): an UNMARKED broadcast-shaped lambda whose element
 *   function is provably integer-closed and overflow-free
 *   (`map-exact-proof.ts`) compiles too, and its results are re-boxed as
 *   EXACT integer literals. Float64 integer arithmetic within ±2^53 is exact,
 *   so this tier is sound at any precision — the `bignumPreferred` bail-out
 *   applies only to the marked tier (R4).
 *
 * Everything else — the per-instance cache, the drain-start/attempt bounding,
 * the dependency snapshot and validation, the stats counters, the
 * per-element decline-to-interpreter fallback — is shared (R1).
 */

/** A dependency of a compiled element function: the resolution snapshot of a
 * symbol whose value or function-literal definition the compiler consulted
 * (mirrors `ComprehensionCacheDep` in `control-structures.ts`). */
interface MapCompileDep {
  name: string;
  /** Binding wrapper resolved by name in the ambient engine scope at compile
   * time. An identity change means the name now resolves elsewhere
   * (shadowing declaration, redeclaration). */
  binding: BoxedDefinition | undefined;
  /** The inner value definition at compile time — `updateDef` swaps this on
   * the same wrapper. `undefined` for operator definitions (user functions). */
  valueDef: BoxedValueDefinition | undefined;
  /** `valueDef._writeVersion` at compile time. */
  version: number;
  /** The inner OPERATOR definition at compile time — a user-function
   * redefinition (`ce.assign('f', newLambda)`) keeps the binding wrapper but
   * swaps this object, and operator defs carry no `_writeVersion`, so the
   * identity comparison is the only signal that catches it (review finding:
   * without this, the global generation bump alone gets re-stamped away). */
  operatorDef: unknown;
}

/** Which tier produced this record. Fixed per instance (the marker is a
 * structural property of the lambda), but carried on the record so the
 * result-handling path cannot drift from the compile path. */
type MapCompileTier = 'marked' | 'exact';

interface MapCompileCache {
  state: 'compiled' | 'no-compile';
  tier: MapCompileTier;
  /** The compiled element runner (positional args, one per Map source). */
  fn?: (...args: unknown[]) => unknown;
  /** The compiled code's capture set (from the compiler's `symbolDeps`
   * collector), resolved in the ambient scope at compile time. */
  deps?: MapCompileDep[];
  /** `ce._mutationGeneration` stamp for the cheap per-invocation check. */
  generation: number;
  /** `ce.tolerance` stamp — baked into the code by the equality codegen, so a
   * change forces a recompile (never a re-stamp). */
  tolerance: number;
  /** `ce.angularUnit` stamp — baked into the code by `rewriteAngularUnit`
   * (the second compiler-baked engine input, alongside tolerance); a change
   * forces a recompile (never a re-stamp). */
  angularUnit: ComputeEngine['angularUnit'];
  /**
   * Why the instance is `no-compile`:
   * - `'structural'` — unsupported head, excluded (impure) head, non-ambient
   *   scope capture, non-lambda result: deterministic, permanent.
   * - `'abi'` — runtime result-shape failure: deterministic, permanent.
   * - a `MapCompileDep` — an unbound free symbol; cleared when that symbol's
   *   resolution changes (assigning it re-enables one fresh attempt).
   */
  reason?: 'structural' | 'abi' | MapCompileDep;
  /** Bounds compile attempts to one per drain (review 19: a side-effecting
   * uncompilable lambda clearing its own `{symbol}` mark per element must not
   * re-attempt per element). Reset when a drain starts — an iterator
   * creation, or an `at()` access (each `at()` is its own micro-drain, so a
   * cleared `{symbol}` mark can re-attempt on an at()-only pattern).
   * Legitimate recompiles of a previously-compiled function bypass this. */
  attemptedThisDrain?: boolean;
}

/** Keyed on the (rewrapped, memo-stable) `Map` instance. */
const mapCompileCaches = new WeakMap<Expression, MapCompileCache>();

/** Instrumentation for tests: every path bumps a counter, so tests assert
 * counter *deltas* (an all-interpreter implementation cannot pass). */
export const _mapAutoCompileStats = {
  /** Compile attempts (initial, re-enabled, and recompiles). */
  attempts: 0,
  /** Elements served by a compiled function. */
  compiledHits: 0,
  /** Full dependency walks triggered by a cheap-check mismatch. */
  revalidations: 0,
  /** Recompiles triggered by a genuine dependency change. */
  recompiles: 0,
  /** Elements that fell back to the interpreter (non-numeric input row,
   * ABI failure). */
  elementFallbacks: 0,
  /** Compiled results that were NaN (or complex with a NaN part) and were
   * re-evaluated through the interpreter (review 14). */
  nanDoubleChecks: 0,
};

export function _resetMapAutoCompileStats(): void {
  _mapAutoCompileStats.attempts = 0;
  _mapAutoCompileStats.compiledHits = 0;
  _mapAutoCompileStats.revalidations = 0;
  _mapAutoCompileStats.recompiles = 0;
  _mapAutoCompileStats.elementFallbacks = 0;
  _mapAutoCompileStats.nanDoubleChecks = 0;
}

/** The numeric marker: a `Map` whose element lambda's body is the canonical
 * `Block(N(inner))` shape (single-statement `Block` whose statement is an `N`
 * application). Returns the lambda and the unwrapped inner body. */
function markedMapLambda(
  expr: Expression
): { fn: Expression; inner: Expression } | undefined {
  if (!isFunction(expr, 'Map') || expr.nops < 2) return undefined;
  const fn = expr.ops[expr.nops - 1];
  if (!isFunction(fn, 'Function') || fn.nops < 1) return undefined;
  let body: Expression = fn.op1;
  if (isFunction(body, 'Block') && body.nops === 1) body = body.op1;
  if (!isFunction(body, 'N') || body.nops !== 1) return undefined;
  return { fn, inner: body.op1 };
}

// THE RANDOMNESS GATE IS GONE. Two successive gates lived here and both were
// deleted: a hardcoded `EXCLUDED_HEADS` name set (2026-07-25 — a name list
// drifts silently: `'RandomVariate'` sat in it guarding an operator that never
// existed), and then the `pure: false` check that had subsumed it.
//
// Random draws inside a compiled `Map` are a REQUIREMENT of the 2026-07-25
// Random family redesign (`docs/plans/2026-07-25-random-signature-redesign.md`
// §6), not a follow-up: per-sample-point draws must stay in the hot path. The
// divergence the gate stood on is gone with it — `ce.randomSeed` and the
// compile-time bake path no longer exist, and every compiled draw goes through
// `_SYS.drawNextRandomNumber()` → `ce._random()`, the same primitive the
// interpreter uses, reading the same per-engine `WithRandomSeed` frame. Parity
// is by construction.
//
// Eligibility is therefore the compiler's own D6 question — *can the target
// emit semantically-equivalent code?* — answered by whether a handler exists.
// `Assume` has none, so a `Map` body containing it throws at compile time and
// falls back to the interpreter. Nothing is listed, flagged, or kept in sync.
//
// `pure: false` STAYS on every random operator: it is still the correct
// semantic property, it feeds `isPure` → `isConstant` (so the engine does not
// believe a shuffle of a literal list is constant), and it stops a repeated
// `Random()` being eliminated as a common subexpression — which would
// desynchronize the frame's shared counter. It simply stops doubling as a
// compile gate. One property, one purpose.

/** Is `x` a finite real number literal (a literal loop bound)? */
function isLiteralBound(x: Expression | undefined): boolean {
  return x !== undefined && isNumber(x) && x.im === 0 && Number.isFinite(x.re);
}

/**
 * Cap on the trip count of a literal-bounded loop the auto path will compile.
 * Compiled loops are emitted UNGUARDED (no per-iteration deadline check), so
 * a single compiled element containing a huge literal `Sum`/`Product`/`Loop`
 * would stall past any `withTimeLimit` deadline — the interpreter path is
 * interruptible, and an automatic optimization must not trade that away
 * (review finding on D6's single-long-element claim). 10^5 float64
 * iterations is ~0.1–1 ms — far above any legitimate per-element reduction
 * (the design repro is a 40-term `Sum`) and far below a perceptible stall.
 */
const MAX_COMPILED_TRIP_COUNT = 100_000;

/** Return the `Function` literal backing a user-defined function symbol
 * (operator definition `_lambdaLiteral`, or a symbol whose assigned value is
 * a `Function` literal) — the same two storage routes the compiler's
 * `userFunctionLiteral` covers. */
function userFnLiteral(ce: ComputeEngine, id: string): Expression | undefined {
  const def = ce.lookupDefinition(id);
  if (def && 'operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (literal !== undefined && isFunction(literal, 'Function'))
      return literal;
  }
  const value = ce._getSymbolValue(id);
  if (value !== undefined && isFunction(value, 'Function')) return value;
  return undefined;
}

/**
 * The purity/boundedness eligibility gate (D2), applied transitively through
 * called user functions:
 * - no excluded (random-source) heads;
 * - no `Assign` targeting a symbol not bound within the compiled unit (an
 *   engine-side-effect write the compiled code cannot perform);
 * - no loops without literal bounds (bare `Loop`, `Sum`/`Product`/`Loop`
 *   with runtime-valued bounds) — unbounded compiled loops are
 *   uninterruptible (review 15). Literal-bounded big-ops are eligible.
 */
function bodyEligible(
  ce: ComputeEngine,
  e: Expression,
  bound: ReadonlySet<string>,
  seenFns: Set<string>
): boolean {
  if (isSymbol(e)) {
    // A bare symbol naming a user function (a higher-order operand) — its
    // body is compiled too: descend.
    const s = e.symbol;
    if (bound.has(s) || seenFns.has(s)) return true;
    const literal = userFnLiteral(ce, s);
    if (literal === undefined) return true;
    seenFns.add(s);
    return fnLiteralEligible(ce, literal, seenFns);
  }
  if (!isFunction(e)) return true;

  const op = e.operator;

  if (op === 'Assign') {
    const target = e.op1;
    if (!isSymbol(target) || !bound.has(target.symbol)) return false;
    return bodyEligible(ce, e.op2, bound, seenFns);
  }

  if (op === 'Sum' || op === 'Product') {
    const inner = new Set(bound);
    for (const l of e.ops.slice(1)) {
      if (!isFunction(l, 'Limits')) return false;
      if (!isLiteralBound(l.op2) || !isLiteralBound(l.op3)) return false;
      if (l.op3.re - l.op2.re + 1 > MAX_COMPILED_TRIP_COUNT) return false;
      if (isSymbol(l.op1)) inner.add(l.op1.symbol);
    }
    // A bounds-less Sum/Product (single operand) reduces a collection —
    // runtime-valued trip count: ineligible.
    if (e.nops < 2) return false;
    return bodyEligible(ce, e.op1, inner, seenFns);
  }

  if (op === 'Loop') {
    // `Loop(body, collection?)`: eligible only over a literal-bounded
    // source (a literal `Range` or an explicit `List`), capped like the
    // big-ops above.
    if (e.nops < 2) return false; // bare Loop: unbounded
    const src = e.op2;
    if (isFunction(src, 'Range')) {
      if (!src.ops.every((b) => isLiteralBound(b))) return false;
      const [lo, hi, step] =
        src.nops === 1
          ? [1, src.op1.re, 1]
          : [src.op1.re, src.op2.re, src.nops > 2 ? src.op3.re : 1];
      if (step === 0) return false;
      if ((hi - lo) / step + 1 > MAX_COMPILED_TRIP_COUNT) return false;
    } else if (!isFunction(src, 'List') && !isFunction(src, 'Tuple'))
      return false;
    return bodyEligible(ce, e.op1, bound, seenFns);
  }

  if (op === 'Block' || op === 'Declare' || op === 'Function') {
    // Binding forms: extend the bound set with the names they introduce.
    const inner = new Set(bound);
    if (op === 'Declare') {
      if (isSymbol(e.op1)) inner.add(e.op1.symbol);
      return e.ops.slice(1).every((x) => bodyEligible(ce, x, inner, seenFns));
    }
    if (op === 'Function') {
      for (const p of e.ops.slice(1)) {
        const name = functionLiteralParameterName(p);
        if (name) inner.add(name);
      }
      return bodyEligible(ce, e.op1, inner, seenFns);
    }
    // Block: statements evaluated in sequence; a Declare statement
    // introduces a local visible to subsequent statements. An `Assign` is
    // eligible ONLY when its target is already bound within the compiled
    // unit (a parameter or an explicitly Declared local): the interpreter
    // assigns UPWARD to any visible ambient binding — an engine write the
    // compiled code cannot perform (it would emit a bare, global-polluting
    // JS assignment against a constant-folded read; review finding) — and
    // the declare-on-first-write corner has uncertain parity, so it falls
    // back to the interpreter too.
    for (const stmt of e.ops) {
      if (isFunction(stmt, 'Declare') && isSymbol(stmt.op1)) {
        if (
          !stmt.ops.slice(1).every((x) => bodyEligible(ce, x, inner, seenFns))
        )
          return false;
        inner.add(stmt.op1.symbol);
      } else if (isFunction(stmt, 'Assign') && isSymbol(stmt.op1)) {
        if (!inner.has(stmt.op1.symbol)) return false;
        if (!bodyEligible(ce, stmt.op2, inner, seenFns)) return false;
      } else if (!bodyEligible(ce, stmt, inner, seenFns)) return false;
    }
    return true;
  }

  // NO randomness/impurity gate. An impure head (`Random`, `RandomChoice`,
  // `RandomSample`, `RandomShuffle`) is eligible: compiled draws go through
  // the same per-engine frame stack as interpreted ones. A head with no
  // compile handler fails closed at compile time instead. See the note at the
  // top of this file.

  // A user-function call in head position: descend into its body.
  if (!bound.has(op) && !seenFns.has(op)) {
    const literal = userFnLiteral(ce, op);
    if (literal !== undefined) {
      seenFns.add(op);
      if (!fnLiteralEligible(ce, literal, seenFns)) return false;
    }
  }

  return e.ops.every((x) => bodyEligible(ce, x, bound, seenFns));
}

function fnLiteralEligible(
  ce: ComputeEngine,
  literal: Expression,
  seenFns: Set<string>
): boolean {
  if (!isFunction(literal)) return false;
  const params = new Set<string>();
  for (const p of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(p);
    if (name) params.add(name);
  }
  return bodyEligible(ce, literal.ops[0], params, seenFns);
}

/** Snapshot the ambient-scope resolution of a symbol. */
function resolveDep(ce: ComputeEngine, name: string): MapCompileDep {
  const binding = lookup(name, ce.context.lexicalScope);
  const valueDef =
    binding !== undefined && isValueDef(binding) ? binding.value : undefined;
  return {
    name,
    binding,
    valueDef,
    version: valueDef?._writeVersion ?? 0,
    operatorDef:
      binding !== undefined && 'operator' in binding
        ? binding.operator
        : undefined,
  };
}

/** Has `dep`'s resolution changed since it was snapshotted? */
function depChanged(ce: ComputeEngine, dep: MapCompileDep): boolean {
  const binding = lookup(dep.name, ce.context.lexicalScope);
  if (binding !== dep.binding) return true;
  const valueDef =
    binding !== undefined && isValueDef(binding) ? binding.value : undefined;
  if (valueDef !== dep.valueDef) return true;
  if (valueDef && valueDef._writeVersion !== dep.version) return true;
  const operatorDef =
    binding !== undefined && 'operator' in binding
      ? binding.operator
      : undefined;
  if (operatorDef !== dep.operatorDef) return true;
  return false;
}

/**
 * Per-invocation validation (D3). Cheap check first (`_mutationGeneration` +
 * `ce.tolerance` stamps); on mismatch, the full dependency walk. If every
 * dep is unchanged (and the tolerance still matches — it is baked into the
 * generated code, so a change can never be re-stamped away), **re-stamp and
 * keep** the compiled function: an unrelated per-frame `ce.assign` bumping
 * the global axis must not thrash the cache (review 13). A genuine dep
 * change returns `false` → recompile.
 */
function validCompiled(ce: ComputeEngine, cache: MapCompileCache): boolean {
  if (
    cache.generation === ce._mutationGeneration &&
    cache.tolerance === ce.tolerance &&
    cache.angularUnit === ce.angularUnit
  )
    return true;
  _mapAutoCompileStats.revalidations++;
  // Compiler-baked engine inputs (tolerance via the equality codegen,
  // angularUnit via `rewriteAngularUnit`): a change is compiled into the
  // code, so it can never be re-stamped away — always recompile.
  if (cache.tolerance !== ce.tolerance) return false;
  if (cache.angularUnit !== ce.angularUnit) return false;
  for (const d of cache.deps ?? []) if (depChanged(ce, d)) return false;
  cache.generation = ce._mutationGeneration;
  return true;
}

/**
 * One compile attempt (D2 eligibility → strip the `N` marker → compile with
 * the capture collector → post-compile gates). Returns the cache record to
 * store, or `undefined` for the latch case (CSP `EvalError`: no mark — the
 * engine-wide `ce.jit` latch already gates every future attempt).
 * `CancellationError` propagates (D4: a deadline expiry reflects the
 * moment's budget, not the instance — no mark).
 */
function attemptCompile(
  ce: ComputeEngine,
  tier: MapCompileTier,
  fn: Expression,
  inner: Expression | undefined
): MapCompileCache | undefined {
  _mapAutoCompileStats.attempts++;

  const noCompile = (
    reason: 'structural' | 'abi' | MapCompileDep
  ): MapCompileCache => ({
    state: 'no-compile',
    tier,
    reason,
    generation: ce._mutationGeneration,
    tolerance: ce.tolerance,
    angularUnit: ce.angularUnit,
  });

  let literal: Expression;
  if (tier === 'marked') {
    // Purity/boundedness gate (transitive through called user functions).
    if (!fnLiteralEligible(ce, fn, new Set())) return noCompile('structural');

    // Rebuild the stripped literal from MathJSON (the same idiom as the
    // item-39 rewrap: never re-host a canonical body under a new `Function`,
    // which would split its parameter-scope bindings). The compiled code is
    // already numeric, so the `N` marker is dropped.
    const fnJson = fn.json;
    if (inner === undefined || !Array.isArray(fnJson))
      return noCompile('structural');
    literal = ce.box([
      'Function',
      inner.json,
      ...(fnJson as unknown[]).slice(2),
    ] as Parameters<ComputeEngine['box']>[0]);
    if (!literal.isValid) return noCompile('structural');
  } else {
    // The exact tier's body carries no marker to strip, and the eligibility
    // proof already established that its single application is an
    // integer-closed, bounded arithmetic head: compile the ORIGINAL canonical
    // literal, whose parameter-scope bindings are intact.
    literal = fn;
  }

  const deps = new Set<string>();
  // `implicitCompile` honors the `ce.jit` flag, performs the engine-wide CSP
  // `EvalError` latch, and propagates `CancellationError` (a deadline expiry
  // leaves no mark — D4). A latch is distinguished from an ordinary compile
  // failure by the flag having flipped.
  const result = implicitCompile(ce, literal, { symbolDeps: deps });
  if (result === undefined)
    return ce.jit === 'off' ? undefined : noCompile('structural');

  if (result.calling !== 'lambda' || typeof result.run !== 'function')
    return noCompile('structural');
  if (result.unsupported !== undefined && result.unsupported.length > 0)
    return noCompile('structural');

  // Free-symbol gate: a valueless symbol has no channel into the positional
  // call ABI (the interpreter would return a symbolic element). The offending
  // symbol's resolution snapshot is the `no-compile` reason: assigning it
  // re-enables one fresh attempt (D4).
  const free = result.freeSymbols ?? [];
  if (free.length > 0) return noCompile(resolveDep(ce, free[0]));

  // Scope discipline (D3): every consulted capture must resolve identically
  // through the lambda's own scope chain and the ambient engine scope — the
  // compiler baked the ambient resolution, and validation re-resolves in the
  // ambient scope, so a divergent (non-ambient) binding is ineligible.
  const ambient = ce.context.lexicalScope;
  const fnScope: Scope | undefined =
    isFunction(fn) && fn.isScoped ? fn.localScope : undefined;
  if (fnScope !== undefined) {
    for (const id of deps)
      if (lookup(id, fnScope) !== lookup(id, ambient))
        return noCompile('structural');
  }

  return {
    state: 'compiled',
    tier,
    fn: result.run as (...args: unknown[]) => unknown,
    deps: [...deps].map((name) => resolveDep(ce, name)),
    generation: ce._mutationGeneration,
    tolerance: ce.tolerance,
    angularUnit: ce.angularUnit,
  };
}

/**
 * The trigger (D2): called by the `Map` collection handlers (`iterator` and
 * `at`, both with `drainStart: true` — an iterator is a drain; each `at()`
 * access is its own micro-drain). Returns a per-element runner — `items`
 * is the element row (one source element per `Map` source); the runner
 * returns the boxed compiled result, or `undefined` to have the caller
 * evaluate that element through the interpreter — or `undefined` when the
 * instance does not auto-compile (no marker, wrong precision, `jit` off,
 * permanent `no-compile`).
 *
 * Every compiled invocation is preceded by the cheap validation (D3), so a
 * mid-drain mutation is honored: the element after an interleaved
 * reassignment sees the new value, matching the interpreter's per-element
 * re-read. Runtime throws from the compiled function propagate (D4).
 */
export function mapAutoCompileRunner(
  expr: Expression,
  { drainStart = false }: { drainStart?: boolean } = {}
): ((items: ReadonlyArray<Expression>) => Expression | undefined) | undefined {
  const ce = expr.engine;
  if (ce.jit === 'off') return undefined;

  // ── Tier selection ───────────────────────────────────────────────────
  // A marked (`Block(N(…))`) lambda takes the float tier, which stays gated
  // on machine precision: at bignum precision the interpreter produces digits
  // float64 cannot match. (The default engine precision is bignum-preferred;
  // the plot/analyze consumers run machine.)
  const marked = markedMapLambda(expr);
  let tier: MapCompileTier;
  let fn: Expression;
  let inner: Expression | undefined;
  if (marked !== undefined) {
    if (bignumPreferred(ce)) return undefined;
    tier = 'marked';
    fn = marked.fn;
    inner = marked.inner;
  } else {
    // The exact tier (R1/R4): an unmarked broadcast-shaped lambda that the
    // static proof shows integer-closed and overflow-free. No precision gate
    // — a proven-safe integer has the same value in float64 and Decimal. The
    // proof runs BEFORE any attempt is recorded, so a declining instance
    // never counts as a compile attempt.
    const shape = exactTierShape(ce, expr);
    if (shape === undefined) return undefined;
    // Size floor: see `MIN_EXACT_COMPILE_COUNT`.
    if (shape.count < MIN_EXACT_COMPILE_COUNT) return undefined;
    tier = 'exact';
    fn = shape.fn;
    inner = undefined;
  }

  const existing = mapCompileCaches.get(expr);
  if (drainStart && existing) existing.attemptedThisDrain = false;
  // Cheap short-circuit: a deterministic no-compile is permanent for the
  // instance lifetime — no per-element overhead on subsequent drains.
  if (
    existing?.state === 'no-compile' &&
    (existing.reason === 'structural' || existing.reason === 'abi')
  )
    return undefined;

  // The exact tier's eligibility is VALUE-dependent (a closed operand may be
  // a symbol whose integer value the proof read), so it must be re-asked
  // before every recompile: a reassignment to a non-integer or unbounded
  // value revokes the proof, and the instance must fall back to the
  // interpreter rather than compile against the stale one. `exactTierShape`
  // memoizes on `ce._mutationGeneration`, so this is a pointer compare unless
  // something actually changed.
  const stillEligible = (): boolean =>
    tier !== 'exact' || exactTierShape(ce, expr) !== undefined;

  // Resolve (or build) a usable compiled cache record; `undefined` → the
  // caller's interpreter path serves this element.
  const ensure = (): MapCompileCache | undefined => {
    if (ce.jit === 'off') return undefined;
    const cache = mapCompileCaches.get(expr);

    if (cache?.state === 'compiled') {
      if (validCompiled(ce, cache)) return cache;
      if (!stillEligible()) {
        mapCompileCaches.delete(expr);
        return undefined;
      }
      // A genuine dependency change: discard and recompile — a fresh
      // attempt, not a failure. Not bounded by `attemptedThisDrain`, so a
      // mid-drain reassignment is honored on the very next element.
      _mapAutoCompileStats.recompiles++;
      const fresh = attemptCompile(ce, tier, fn, inner);
      if (fresh === undefined) {
        mapCompileCaches.delete(expr);
        return undefined;
      }
      fresh.attemptedThisDrain = cache.attemptedThisDrain;
      mapCompileCaches.set(expr, fresh);
      return fresh.state === 'compiled' ? fresh : undefined;
    }

    if (cache?.state === 'no-compile') {
      const reason = cache.reason;
      if (reason === 'structural' || reason === 'abi') return undefined;
      // `{symbol}`: cleared when that symbol's resolution changes.
      if (reason === undefined || !depChanged(ce, reason)) return undefined;
      if (cache.attemptedThisDrain) return undefined;
      if (!stillEligible()) return undefined;
      cache.attemptedThisDrain = true;
      const fresh = attemptCompile(ce, tier, fn, inner);
      if (fresh === undefined) {
        mapCompileCaches.delete(expr);
        return undefined;
      }
      fresh.attemptedThisDrain = true;
      mapCompileCaches.set(expr, fresh);
      return fresh.state === 'compiled' ? fresh : undefined;
    }

    // No cache: first attempt for this instance. The gate that selected the
    // exact tier ran at DRAIN START; `attemptCompile` bakes symbol values
    // (`tryFoldKnownSymbol`) at COMPILE time, and those two moments are not
    // the same one — an interleaved reassignment between iterator creation and
    // the first element would otherwise be compiled against bounds the proof
    // never established (a partial sum can then overflow 2^53 while the final
    // result is still a safe integer, so every runtime guard stays silent).
    // Re-ask here too. This is also what stops the cached-compiled branch's
    // `delete` above from handing a revoked shape straight back to this path.
    if (!stillEligible()) return undefined;
    const fresh = attemptCompile(ce, tier, fn, inner);
    if (fresh === undefined) return undefined;
    fresh.attemptedThisDrain = true;
    mapCompileCaches.set(expr, fresh);
    return fresh.state === 'compiled' ? fresh : undefined;
  };

  // Every-K deadline check (D6): compiled elements are ~µs, so the drain
  // loop re-arms interruptibility itself. Inert when no deadline is armed.
  let ticks = 0;

  return (items) => {
    if ((++ticks & 0xff) === 0) checkDeadline(ce._deadlineFrame);

    const cache = ensure();
    if (cache?.state !== 'compiled' || cache.fn === undefined) return undefined;

    // Input conversion (D5): every source element must be a number literal;
    // reals pass their machine float, complex `{re, im}`. A row with any
    // non-convertible element falls back to the interpreter (the compiled
    // function keeps serving other rows).
    //
    // The exact tier additionally re-checks at RUNTIME what its static proof
    // established — every input is an exact integer float64 can hold exactly.
    // The proof reads the instance's own sources, so this can only fire on a
    // proof gap; it costs one predicate per element and keeps the exactness
    // contract from depending on that proof being airtight.
    const args: unknown[] = [];
    for (const item of items) {
      if (!isNumber(item)) {
        _mapAutoCompileStats.elementFallbacks++;
        return undefined;
      }
      if (
        tier === 'exact' &&
        (item.im !== 0 || !item.isExact || !Number.isSafeInteger(item.re))
      ) {
        _mapAutoCompileStats.elementFallbacks++;
        return undefined;
      }
      args.push(item.im !== 0 ? { re: item.re, im: item.im } : item.re);
    }

    // Draw-counter rollback: a compiled body can draw from the ambient
    // `WithRandomSeed` frame (`_SYS.drawNextRandomNumber`). Every path below
    // that DISCARDS `r` and returns `undefined` hands the element back to the
    // interpreter, which draws AGAIN — so the frame counter must be rewound to
    // where the compiled call found it, or the fallback silently consumes each
    // element's draws twice and every later draw in the frame shifts.
    // (`docs/RANDOMNESS-MODEL.md` §5: an operation consumes a FIXED number of
    // indices, whichever implementation serves it.)
    const frame = ce._randomFrame;
    const drawsBefore = frame?.next ?? 0;
    const fallback = (): undefined => {
      if (frame !== undefined) frame.next = drawsBefore;
      return undefined;
    };

    // Runtime throws propagate (D4) — a runaway recursive user function
    // surfaces its `RangeError` to the caller, not a silent fallback.
    const r = cache.fn(...args);

    // Result validation (D5) + NaN double-check (review 14): emission is
    // chosen statically, so a real-emitted body can return NaN where the
    // machine-precision interpreter leaves the reals (`x ↦ √x` at −4). A NaN
    // result re-evaluates through the interpreter: a genuinely-NaN element
    // pays double evaluation (correct either way); a domain-crossing element
    // gets the interpreter's complex value.
    if (typeof r === 'number') {
      if (Number.isNaN(r)) {
        _mapAutoCompileStats.nanDoubleChecks++;
        return fallback();
      }
      // The exact tier's contract (R3): a safe integer re-boxes as an EXACT
      // integer literal, `isSame`-identical to the interpreter's. Anything
      // else falls through to the ABI path below — unreachable under a sound
      // proof, but the exactness contract must not rest on that alone.
      if (tier === 'exact') {
        if (Number.isSafeInteger(r)) {
          _mapAutoCompileStats.compiledHits++;
          return ce.number(r);
        }
      } else {
        _mapAutoCompileStats.compiledHits++;
        return ce.number(r);
      }
    }
    if (
      tier !== 'exact' &&
      typeof r === 'object' &&
      r !== null &&
      're' in r &&
      'im' in r
    ) {
      const re = (r as { re: unknown }).re;
      const im = (r as { im: unknown }).im;
      if (typeof re === 'number' && typeof im === 'number') {
        if (Number.isNaN(re) || Number.isNaN(im)) {
          _mapAutoCompileStats.nanDoubleChecks++;
          return fallback();
        }
        _mapAutoCompileStats.compiledHits++;
        return ce.number(im === 0 ? re : ce.complex(re, im));
      }
    }

    // Anything else (boolean, undefined, array, malformed object) is an ABI
    // failure: deterministic → permanent `no-compile` (D5), interpreter
    // serves this and every subsequent element.
    cache.state = 'no-compile';
    cache.reason = 'abi';
    cache.fn = undefined;
    cache.deps = undefined;
    _mapAutoCompileStats.elementFallbacks++;
    return fallback();
  };
}
