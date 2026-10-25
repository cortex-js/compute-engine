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
import { _mapAutoCompileStats } from '../map-auto-compile-stats.js';
import {
  declaredParametersAdmit,
  exactTierShape,
  MIN_EXACT_COMPILE_COUNT,
  namedCallbackLiteral,
  userFnLiteral,
} from './map-exact-proof.js';
import { collectionElementType } from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';
import { rangeCount } from '../numerics/range-count.js';
import { appliesJumpFunction } from '../jump-functions.js';
import type { ExactTierShape, Interval } from './map-exact-proof.js';

/**
 * Auto-compilation of lazy-`Map` element lambdas on numeric drains.
 *
 * When a lazy `Map` whose element lambda carries the numeric marker — the
 * canonical `Block(NumericApproximation(body))` shape produced by the `.N()`
 * method of a lazy `Map` (`lazyMapNumericApproximation`) and the numeric
 * element-wise sums and products (`lazyBroadcastMap` with
 * `numericApproximation`) — or a user-written `Block(N(body))` is drained at
 * machine precision, an
 * eligibility-gated compile attempt produces a per-logical-instance cached
 * compiled element function, validated per invocation against the same
 * two-axis keys that govern the comprehension cache
 * (`ce._semanticVersion` + per-definition `_writeVersion`), with silent
 * per-element interpreter fallback.
 *
 * Design: `docs/COMPILATION-MODEL.md` (ratified
 * 2026-07-19). The cache is keyed on the **rewrapped** `Map` instance, which
 * is stable per logical Map because `lazyMapNumericApproximation` memoizes
 * the rewrap (see `collection-utils.ts`); `subs()`/re-box copies are new
 * originals and run cold (item-40 contract).
 *
 * ## Two tiers
 *
 * - the **marked** (float) tier above, gated on the numeric marker or a
 *   user-written `N`, and restricted to machine precision;
 * - the **exact** tier (`docs/COMPILATION-MODEL.md`,
 *   ratified 2026-07-31): an UNMARKED element function (a lambda or a named
 *   user function) whose body is provably integer-closed and overflow-free
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
 * (mirrors `ElementMemoDep` in
 * `boxed-expression/collection-element-memo.ts`). */
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
   * swaps this object, and the identity comparison catches it (without
   * this, the global generation bump alone gets re-stamped away). The
   * `_writeVersion` of an operator definition, which counts its changes in
   * place, is not read here. */
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
  /** `ce._semanticVersion` stamp for the cheap per-invocation check. */
  generation: number;
  /** `ce._worldVersion` at compile time. An epoch event — assumptions
   * (`assume`/`forget`), operator/type redefinition, signature inference,
   * engine-config changes, reset — invalidates unconditionally: unlike a value
   * write, it cannot be re-stamped away by `validCompiled`'s dep walk, because
   * compile-time canonicalization may have consulted global semantics no dep
   * snapshot records. */
  epoch: number;
  /** `ce.tolerance` stamp — baked into the code by the equality codegen, so a
   * change forces a recompile (never a re-stamp). */
  tolerance: number;
  /** `ce.angularUnit` stamp — baked into the code by `rewriteAngularUnit`
   * (the second compiler-baked engine input, alongside tolerance); a change
   * forces a recompile (never a re-stamp). */
  angularUnit: ComputeEngine['angularUnit'];
  /** `ce.roundingTies` stamp — baked into the code by the `Round` lowering,
   * which writes the tie rule in effect at compile time; a change forces a
   * recompile (never a re-stamp). */
  roundingTies: ComputeEngine['roundingTies'];
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
  /** Marked tier only: true if the lambda, the values it captures and the
   * user functions it calls hold no float literal (`isExactBody()`). Then an
   * integer result of exact operands is exact in the interpreter too (see
   * the runner). */
  exactBody?: boolean;
  /** Marked tier only: true if the lambda or a user function it calls
   * applies a function whose result jumps at a point (`hasJumpFunction()`).
   * Then an element with an exact input is computed by the interpreter (see
   * the runner). */
  jumpBody?: boolean;
}

/**
 * Keyed on the (rewrapped, memo-stable) `Map` instance.
 *
 * MUTABLE-OBJECT DISPOSITION (ruling B3's cache inventory): this cache holds a
 * COMPILED CLOSURE, which is exactly the payload the object rules forbid — a
 * closure that captured an object would retain it for the instance's lifetime
 * and would read fields the cache never validated. Nothing records
 * object-version dependencies here, so the exclusion is total and it is
 * enforced upstream, at compilation rather than at this commit: objects have
 * no compiled representation at all, so a body that reads a field declines
 * (`Field`'s compile handler) and a body that constructs one declines
 * (`type-constructors.ts`), leaving no compiled artifact to cache. A `Map`
 * over object elements likewise fails to compile, since no compiled type
 * admits an object. When objects DO gain a compiled representation, this cache
 * must gain either dependency recording or an explicit object refusal — the
 * fail-closed direction is the refusal.
 */
const mapCompileCaches = new WeakMap<Expression, MapCompileCache>();

/** Instrumentation: every path below bumps a counter, so a caller (a test, or
 * a consumer reading `ce._mapAutoCompileStats`) can assert counter *deltas* —
 * an all-interpreter implementation cannot move them. The counters themselves
 * live in the dependency-free `../map-auto-compile-stats.js` so that
 * `types-engine.ts` can type the engine accessor without importing `library/`;
 * they are re-exported here because this is where they are documented and
 * bumped. */
export {
  _mapAutoCompileStats,
  _resetMapAutoCompileStats,
} from '../map-auto-compile-stats.js';

/** A marked lambda: a `Map` whose element lambda's body is the canonical
 * `Block(NumericApproximation(inner))` shape (the numeric marker that the
 * `.N()` method puts on a lazy `Map`) or the `Block(N(inner))` shape (a
 * user-written `N`). Returns the lambda, the unwrapped inner body, and
 * `inexact`: true for a user-written `N`, whose result is always inexact,
 * also when its value is an integer. The marker gives the result of the
 * `.N()` method, where an integer can stay exact. */
function markedMapLambda(expr: Expression):
  | {
      fn: Expression;
      inner: Expression;
      inexact: boolean;
      named?: string;
    }
  | undefined {
  if (!isFunction(expr, 'Map') || expr.nops < 2) return undefined;
  let fn = expr.op1;
  // A named user function (`g(x) = N(sin(x) + x^2)`, then `Map(g, xs)`):
  // its `Function` literal is read as a lambda would be.
  let named: string | undefined;
  if (isSymbol(fn)) {
    named = fn.symbol;
    const literal = namedCallbackLiteral(expr.engine, fn);
    if (literal === undefined) return undefined;
    fn = literal;
    // The compiled code receives each element of each source. The
    // signature of the function must accept the element type of each
    // source, as the interpreter checks each argument against it.
    const elementTypes: Type[] = [];
    for (const source of expr.ops.slice(1)) {
      const t = collectionElementType(source.type.type);
      if (t === undefined) return undefined;
      elementTypes.push(t);
    }
    if (!declaredParametersAdmit(expr.engine, named, elementTypes))
      return undefined;
  }
  if (!isFunction(fn, 'Function') || fn.nops < 1) return undefined;
  let body: Expression = fn.op1;
  if (isFunction(body, 'Block') && body.nops === 1) body = body.op1;
  if (isFunction(body, 'NumericApproximation') && body.nops === 1)
    return { fn, inner: body.op1, inexact: false, named };
  if (isFunction(body, 'N') && body.nops === 1)
    return { fn, inner: body.op1, inexact: true, named };
  return undefined;
}

// THE RANDOMNESS GATE IS GONE. Two successive gates lived here and both were
// deleted: a hardcoded `EXCLUDED_HEADS` name set (2026-07-25 — a name list
// drifts silently: `'RandomVariate'` sat in it guarding an operator that never
// existed), and then the `pure: false` check that had subsumed it.
//
// Random draws inside a compiled `Map` are a REQUIREMENT of the 2026-07-25
// Random family redesign (`docs/RANDOMNESS-MODEL.md`
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
  return (
    x !== undefined && isNumber(x) && !x.isComplex && Number.isFinite(x.re)
  );
}

/**
 * Cap on the total trip count of the literal-bounded loops the auto path will
 * compile: the product of the trip counts of nested loops, including the loops
 * of the user functions that a loop body calls.
 * Compiled loops are emitted UNGUARDED (no per-iteration deadline check), so
 * a single compiled element containing a huge literal `Sum`/`Product`/`Loop`
 * would stall past any `withTimeLimit` deadline — the interpreter path is
 * interruptible, and an automatic optimization must not trade that away
 * (review finding on D6's single-long-element claim). 10^5 float64
 * iterations is ~0.1–1 ms — far above any legitimate per-element reduction
 * (the design repro is a 40-term `Sum`) and far below a perceptible stall.
 */
const MAX_COMPILED_TRIP_COUNT = 100_000;

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
  seenFns: SeenFunctions,
  /** The product of the trip counts of the loops that enclose `e`. */
  outer = 1
): boolean {
  if (isSymbol(e)) {
    // A bare symbol naming a user function (a higher-order operand) — its
    // body is compiled too: descend.
    const s = e.symbol;
    if (bound.has(s) || !visitFunction(seenFns, s, outer)) return true;
    const literal = userFnLiteral(ce, s);
    if (literal === undefined) return true;
    return fnLiteralEligible(ce, literal, seenFns, outer);
  }
  if (!isFunction(e)) return true;

  const op = e.operator;

  if (op === 'Assign') {
    const target = e.op1;
    if (!isSymbol(target) || !bound.has(target.symbol)) return false;
    return bodyEligible(ce, e.op2, bound, seenFns, outer);
  }

  if (op === 'Sum' || op === 'Product') {
    // Each `Limits` of one `Sum`/`Product` is a nested loop: their trip
    // counts multiply, and they multiply the trip counts of the loops that
    // enclose this one.
    const inner = new Set(bound);
    let total = outer;
    for (const l of e.ops.slice(1)) {
      if (!isFunction(l, 'Limits')) return false;
      if (!isLiteralBound(l.op2) || !isLiteralBound(l.op3)) return false;
      total *= Math.max(1, l.op3.re - l.op2.re + 1);
      if (total > MAX_COMPILED_TRIP_COUNT) return false;
      if (isSymbol(l.op1)) inner.add(l.op1.symbol);
    }
    // A bounds-less Sum/Product (single operand) reduces a collection —
    // runtime-valued trip count: ineligible.
    if (e.nops < 2) return false;
    return bodyEligible(ce, e.op1, inner, seenFns, total);
  }

  if (op === 'Loop') {
    // `Loop(body, collection?)`: eligible only over a literal-bounded
    // source (a literal `Range` or an explicit `List`), capped like the
    // big-ops above.
    if (e.nops < 2) return false; // bare Loop: unbounded
    const src = e.op2;
    let total = outer;
    if (isFunction(src, 'Range')) {
      if (!src.ops.every((b) => isLiteralBound(b))) return false;
      const [lo, hi, step] =
        src.nops === 1
          ? [1, src.op1.re, 1]
          : [
              src.op1.re,
              src.op2.re,
              // A two-operand range steps by -1 when it descends
              // (`Range(10, 1)` has 10 elements), as the interpreter does.
              src.nops > 2 ? src.op3.re : src.op2.re >= src.op1.re ? 1 : -1,
            ];
      if (step === 0) return false;
      total *= Math.max(1, rangeCount(lo, hi, step));
    } else if (isFunction(src, 'List') || isFunction(src, 'Tuple'))
      total *= Math.max(1, src.nops);
    else return false;
    if (total > MAX_COMPILED_TRIP_COUNT) return false;
    return bodyEligible(ce, e.op1, bound, seenFns, total);
  }

  if (op === 'Block' || op === 'Declare' || op === 'Function') {
    // Binding forms: extend the bound set with the names they introduce.
    const inner = new Set(bound);
    if (op === 'Declare') {
      if (isSymbol(e.op1)) inner.add(e.op1.symbol);
      return e.ops
        .slice(1)
        .every((x) => bodyEligible(ce, x, inner, seenFns, outer));
    }
    if (op === 'Function') {
      for (const p of e.ops.slice(1)) {
        const name = functionLiteralParameterName(p);
        if (name) inner.add(name);
      }
      return bodyEligible(ce, e.op1, inner, seenFns, outer);
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
          !stmt.ops
            .slice(1)
            .every((x) => bodyEligible(ce, x, inner, seenFns, outer))
        )
          return false;
        inner.add(stmt.op1.symbol);
      } else if (isFunction(stmt, 'Assign') && isSymbol(stmt.op1)) {
        if (!inner.has(stmt.op1.symbol)) return false;
        if (!bodyEligible(ce, stmt.op2, inner, seenFns, outer)) return false;
      } else if (!bodyEligible(ce, stmt, inner, seenFns, outer)) return false;
    }
    return true;
  }

  // NO randomness/impurity gate. An impure head (`Random`, `RandomChoice`,
  // `RandomSample`, `RandomShuffle`) is eligible: compiled draws go through
  // the same per-engine frame stack as interpreted ones. A head with no
  // compile handler fails closed at compile time instead. See the note at the
  // top of this file.

  // A user-function call in head position: descend into its body.
  if (!bound.has(op) && visitFunction(seenFns, op, outer)) {
    const literal = userFnLiteral(ce, op);
    if (literal !== undefined) {
      if (!fnLiteralEligible(ce, literal, seenFns, outer)) return false;
    }
  }

  return e.ops.every((x) => bodyEligible(ce, x, bound, seenFns, outer));
}

/**
 * The user functions that the eligibility check has visited, each with the
 * largest product of enclosing trip counts at which it was checked. A
 * function is checked again only when a call has a larger product: a
 * function that is called first outside a loop and then inside a loop must
 * have its loops counted at the second call too. A recursive call at the same
 * product is not checked again, so the check ends. A recursive call inside a
 * loop has a larger product at each level, so the product goes above
 * `MAX_COMPILED_TRIP_COUNT` and the check refuses the body.
 */
type SeenFunctions = Map<string, number>;

/** Record a check of the user function `name` at the product `outer` of the
 * enclosing trip counts. True if the function must be checked. */
function visitFunction(
  seenFns: SeenFunctions,
  name: string,
  outer: number
): boolean {
  const previous = seenFns.get(name);
  if (previous !== undefined && previous >= outer) return false;
  seenFns.set(name, outer);
  return true;
}

function fnLiteralEligible(
  ce: ComputeEngine,
  literal: Expression,
  seenFns: SeenFunctions,
  outer = 1
): boolean {
  if (!isFunction(literal)) return false;
  const params = new Set<string>();
  for (const p of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(p);
    if (name) params.add(name);
  }
  return bodyEligible(ce, literal.ops[0], params, seenFns, outer);
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

/** True if the expression holds no float (inexact) number literal. */
function hasNoFloatLiteral(e: Expression): boolean {
  if (isNumber(e)) return e.isExact;
  return !isFunction(e) || e.ops.every(hasNoFloatLiteral);
}

/**
 * True if the lambda `fn`, the values of its captures `deps` and the
 * `Function` literals of the user functions it calls hold no float literal
 * (a user function with no `Function` literal is not checked: false). With
 * exact operands, the interpreter's `N()` of such a body gives an exact value
 * when the value is an integer: `N(x^2)` at `4` is `16`, `N(k·x)` with `k = 3`
 * at `2` is `6`. With a float literal the value can be a float
 * (`N(Sec(1e-13·x))` at `1` is `1.0`).
 */
function isExactBody(
  ce: ComputeEngine,
  fn: Expression,
  deps: MapCompileDep[]
): boolean {
  if (!hasNoFloatLiteral(fn)) return false;
  for (const dep of deps) {
    if (dep.operatorDef !== undefined) {
      // A user function: its `Function` literal is checked. The compiled
      // code's captures include the captures of the functions it calls.
      const literal = userFnLiteral(ce, dep.name);
      if (literal === undefined || !hasNoFloatLiteral(literal)) return false;
      continue;
    }
    const value = dep.valueDef?.value;
    if (value !== undefined && !hasNoFloatLiteral(value)) return false;
  }
  return true;
}

/**
 * True if the lambda `fn`, the `Function` literal of a user function it
 * calls, or the value of a symbol it captures applies a function whose
 * result jumps at a point (`JUMP_FUNCTIONS`, `jump-functions.ts`). A user
 * function with no `Function` literal is read as one that does. A symbol
 * declared `function` and assigned a literal (`g := x ↦ Floor(x)`) or a
 * bare function (`g := Floor`) has a value, not an operator definition, and
 * the compiled code calls that value, so the value is checked as
 * `isExactBody()` checks it (`appliesJumpFunction` reads a bare symbol as
 * the function it names).
 */
function hasJumpFunction(
  ce: ComputeEngine,
  fn: Expression,
  deps: MapCompileDep[]
): boolean {
  if (appliesJumpFunction(ce, fn)) return true;
  for (const dep of deps) {
    if (dep.operatorDef === undefined) {
      const value = dep.valueDef?.value;
      if (value !== undefined && appliesJumpFunction(ce, value)) return true;
      continue;
    }
    const literal = userFnLiteral(ce, dep.name);
    if (literal === undefined || appliesJumpFunction(ce, literal)) return true;
  }
  return false;
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
 * Per-invocation validation (D3). Cheap check first (`_semanticVersion` +
 * `ce.tolerance` stamps); on mismatch, the full dependency walk. If every
 * dep is unchanged (and the tolerance, angularUnit, roundingTies and
 * `_worldVersion` still
 * match — those are never re-stamped away), **re-stamp and keep** the
 * compiled function: an unrelated per-frame `ce.assign` bumping the global
 * axis must not thrash the cache (review 13). A genuine dep change returns
 * `false` → recompile.
 */
function validCompiled(ce: ComputeEngine, cache: MapCompileCache): boolean {
  if (
    cache.generation === ce._semanticVersion &&
    cache.tolerance === ce.tolerance &&
    cache.angularUnit === ce.angularUnit &&
    cache.roundingTies === ce.roundingTies
  )
    return true;
  _mapAutoCompileStats.revalidations++;
  // Compiler-baked engine inputs (tolerance via the equality codegen,
  // angularUnit via `rewriteAngularUnit`, roundingTies via the `Round`
  // lowering): a change is compiled into the code, so it can never be
  // re-stamped away — always recompile.
  if (cache.tolerance !== ce.tolerance) return false;
  if (cache.angularUnit !== ce.angularUnit) return false;
  if (cache.roundingTies !== ce.roundingTies) return false;
  // Global-semantics axis (2026-08-02 dependency-precise invalidation design,
  // §4): an `assume`/`forget`, an operator/type redefinition or a signature
  // inference bumps `_semanticVersion` too, but the dep walk below sees no
  // dep change and RE-STAMPS the bump away — while compile-time
  // canonicalization may have consulted exactly those global semantics. The
  // epoch is bumped only by those rare events (never by a value write), so
  // ANDing it here forces a recompile in precisely that case and costs
  // nothing otherwise.
  if (cache.epoch !== ce._worldVersion) return false;
  for (const d of cache.deps ?? []) if (depChanged(ce, d)) return false;
  cache.generation = ce._semanticVersion;
  return true;
}

/**
 * One compile attempt (D2 eligibility → strip the marker → compile with
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
  inner: Expression | undefined,
  /** The name of the user function whose literal `fn` is, for a `Map` that
   * names its element function. */
  named?: string
): MapCompileCache | undefined {
  _mapAutoCompileStats.attempts++;

  const noCompile = (
    reason: 'structural' | 'abi' | MapCompileDep
  ): MapCompileCache => ({
    state: 'no-compile',
    tier,
    // A structural refusal is permanent for a lambda, which cannot change.
    // A named user function can be redefined: its resolution is the reason,
    // so that a redefinition allows one new attempt.
    reason:
      reason === 'structural' && named !== undefined
        ? resolveDep(ce, named)
        : reason,
    generation: ce._semanticVersion,
    epoch: ce._worldVersion,
    tolerance: ce.tolerance,
    angularUnit: ce.angularUnit,
    roundingTies: ce.roundingTies,
  });

  let literal: Expression;
  if (tier === 'marked') {
    // Purity/boundedness gate (transitive through called user functions).
    //
    // A body in `N(…)` (or the `NumericApproximation` marker of `.N()`)
    // permits the compiled code to compute at machine precision. Thus a body
    // that applies a loop (`Sum`, `Product`, `Loop`) or computes an inner
    // collection compiles when this gate accepts it, also when its values
    // differ from the interpreter's values in the last digits. The rule is the
    // same for a named user function (`g(x) = N(h(x) + 1)`, then `Map(g, xs)`)
    // and for a lambda (`Map(x => N(h(x) + 1), xs)`). The exact tier, which
    // gives exact integer results, does not use this rule. (User decision
    // 2026-10-25, ROADMAP.md entry CE-325, item CE-325.3.)
    if (!fnLiteralEligible(ce, fn, new Map())) return noCompile('structural');

    // Rebuild the stripped literal from MathJSON (the same idiom as
    // `lazyMapNumericApproximation`: never re-host a canonical body under a
    // new `Function`, which would split its parameter-scope bindings). The
    // compiled code is already numeric, so the marker (`NumericApproximation`
    // or `N`) is dropped.
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
    // proof already established that each of its applications is an
    // integer-closed, bounded arithmetic head: compile the ORIGINAL canonical
    // literal (for a named user function, the function's literal), whose
    // parameter-scope bindings are intact.
    literal = fn;
  }

  const deps = new Set<string>();
  // Free symbols the compiler emitted as vars-object lookups. Collected even
  // when the compile is DECLINED — compiling a lambda whose body has one is
  // refused outright (there is no `_` in a lambda's scope; Tycho item 131) —
  // so the free-symbol gate below can still tell that case apart from a
  // structural refusal.
  const varsObjectRefs = new Set<string>();
  // `implicitCompile` honors the `ce.jit` flag, performs the engine-wide CSP
  // `EvalError` latch, and propagates `CancellationError` (a deadline expiry
  // leaves no mark — D4). A latch is distinguished from an ordinary compile
  // failure by the flag having flipped.
  const result = implicitCompile(ce, literal, {
    symbolDeps: deps,
    varsObjectRefs,
  });

  // Free-symbol gate: a valueless symbol has no channel into the positional
  // call ABI (the interpreter would return a symbolic element). The offending
  // symbol's resolution snapshot is the `no-compile` reason: assigning it
  // re-enables one fresh attempt (D4). Checked BEFORE the structural gates:
  // a declined compile (`undefined`) is a free-symbol refusal when the set is
  // non-empty, and `structural` — which is PERMANENT — would wrongly retire
  // an instance that a later `assign` makes compilable.
  const free =
    result?.freeSymbols !== undefined && result.freeSymbols.length > 0
      ? result.freeSymbols
      : [...varsObjectRefs];
  if (free.length > 0 && ce.jit !== 'off')
    return noCompile(resolveDep(ce, free[0]));

  if (result === undefined)
    return ce.jit === 'off' ? undefined : noCompile('structural');

  if (result.calling !== 'lambda' || typeof result.run !== 'function')
    return noCompile('structural');
  if (result.unsupported !== undefined && result.unsupported.length > 0)
    return noCompile('structural');

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

  // The compiled code of a named function's literal does not read the
  // function's name, so the compiler does not record it: record it here, so
  // that a redefinition of the function compiles again (`depChanged()` sees
  // the new operator definition).
  if (named !== undefined) deps.add(named);
  const resolvedDeps = [...deps].map((name) => resolveDep(ce, name));
  return {
    state: 'compiled',
    tier,
    fn: result.run as (...args: unknown[]) => unknown,
    deps: resolvedDeps,
    exactBody: tier === 'marked' && isExactBody(ce, literal, resolvedDeps),
    jumpBody: tier === 'marked' && hasJumpFunction(ce, literal, resolvedDeps),
    generation: ce._semanticVersion,
    epoch: ce._worldVersion,
    tolerance: ce.tolerance,
    angularUnit: ce.angularUnit,
    roundingTies: ce.roundingTies,
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
  options: { drainStart?: boolean } = {}
): ((items: ReadonlyArray<Expression>) => Expression | undefined) | undefined {
  const classify = mapCompiledElementRunner(expr, options);
  if (classify === undefined) return undefined;
  const ce = expr.engine;
  return (items) => {
    const element = classify(items);
    return element === undefined ? undefined : boxCompiledElement(ce, element);
  };
}

/**
 * The value of an element of a `Map` that the compiled function computed,
 * before it is boxed (`boxCompiledElement()`): an exact integer, a float, or
 * a complex float. A caller that only needs the doubles (the `Sum` of a
 * compiled `Map`, `compiledMapDoubles()` in `collections.ts`) reads them
 * without boxing each element.
 */
export type CompiledElement =
  | { kind: 'exact'; value: number }
  | { kind: 'float'; value: number }
  | { kind: 'complex'; re: number; im: number };

/** The element that the interpreter gives for `element`. */
export function boxCompiledElement(
  ce: ComputeEngine,
  element: CompiledElement
): Expression {
  if (element.kind === 'exact') return ce.number(element.value);
  if (element.kind === 'float')
    return ce.number(ce._inexactNumericValue(element.value));
  return ce.number(ce._inexactNumericValue({ re: element.re, im: element.im }));
}

/**
 * `mapAutoCompileRunner` before the boxing: the runner gives the
 * `CompiledElement` of each element, or `undefined` to have the caller
 * evaluate that element through the interpreter. Every check, counter and
 * fallback is the one of `mapAutoCompileRunner`, which boxes what this
 * runner gives.
 */
export function mapCompiledElementRunner(
  expr: Expression,
  { drainStart = false }: { drainStart?: boolean } = {}
):
  | ((items: ReadonlyArray<Expression>) => CompiledElement | undefined)
  | undefined {
  const ce = expr.engine;
  if (ce.jit === 'off') return undefined;

  // A drain made while the assumptions are hidden (`ce._withoutFacts`, the
  // bracket every type-write routine runs in) stays on the interpreter. The
  // compiled closure BAKES symbol values, and a value an `assume(x = …)` put
  // in force is one of them, so a closure compiled on one side of the bracket
  // would answer for the other; the cache holds one closure per instance and
  // has no room for both. Declining here neither reads nor writes it, which
  // is the fail-closed direction: an element evaluated by the interpreter is
  // always correct, only slower, and a bracketed write does not drain
  // collections in bulk (`docs/plans/2026-08-30-assumptions-memo-inventory.md`).
  if (ce._factsHidden()) return undefined;

  // ── Tier selection ───────────────────────────────────────────────────
  // A marked lambda (`markedMapLambda()`) takes the float tier, which stays
  // gated on machine precision: at bignum precision the interpreter produces
  // digits float64 cannot match. (The default engine precision is bignum-preferred;
  // the plot/analyze consumers run machine.)
  const marked = markedMapLambda(expr);
  let tier: MapCompileTier;
  let fn: Expression;
  let inner: Expression | undefined;
  let named: string | undefined;
  let sourceBounds: ReadonlyArray<Interval> = [];
  if (marked !== undefined) {
    if (bignumPreferred(ce)) return undefined;
    tier = 'marked';
    fn = marked.fn;
    inner = marked.inner;
    named = marked.named;
  } else {
    // The exact tier: an unmarked broadcast-shaped lambda may compile to
    // float64 with NO precision gate — unlike the marked tier above —
    // provided `exactTierShape()` proves every intermediate integer-closed
    // and overflow-free. A proven-safe integer has the same value in float64
    // and Decimal, so even a bignum-preferred engine loses no digits. That
    // proof runs BEFORE any attempt is recorded: a declining instance never
    // counts as a compile attempt, so it cannot burn the instance's
    // permanent no-compile state. (Rulings R1 "gated on a proof, not a
    // marker" and R4 "precision independence" in
    // docs/COMPILATION-MODEL.md.)
    const shape = exactTierShape(ce, expr);
    if (shape === undefined) return undefined;
    // Size floor: see `MIN_EXACT_COMPILE_COUNT`.
    if (shape.count < MIN_EXACT_COMPILE_COUNT) return undefined;
    tier = 'exact';
    fn = shape.fn;
    inner = undefined;
    named = shape.named;
    sourceBounds = shape.sourceBounds;
  }

  // The callback of a `Map` of a named user function. The memo of
  // `exactTierShape()` can give a literal that was read in another scope, so
  // the literal is read again in the scope of this drain
  // (`namedCallbackLiteral()`): when the callback symbol has a lexical
  // binding that is not the binding of its name here, or a different
  // literal, the interpreter computes the elements.
  const callee = isFunction(expr) ? expr.op1 : undefined;
  if (
    named !== undefined &&
    (callee === undefined || namedCallbackLiteral(ce, callee) !== fn)
  )
    return undefined;

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
  // memoizes on `ce._semanticVersion`, so this is a pointer compare unless
  // something actually changed.
  //
  // For a `Map` of a named user function, the function must still have the
  // literal that `fn` is: a redefinition during the drain leaves `fn`
  // outdated, so the interpreter computes the rest of the drain, and the next
  // drain reads the new literal.
  const stillEligible = (): boolean =>
    (named === undefined ||
      (callee !== undefined && namedCallbackLiteral(ce, callee) === fn)) &&
    (tier !== 'exact' || exactTierShape(ce, expr) !== undefined);

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
      const fresh = attemptCompile(ce, tier, fn, inner, named);
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
      const fresh = attemptCompile(ce, tier, fn, inner, named);
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
    const fresh = attemptCompile(ce, tier, fn, inner, named);
    if (fresh === undefined) return undefined;
    fresh.attemptedThisDrain = true;
    mapCompileCaches.set(expr, fresh);
    return fresh.state === 'compiled' ? fresh : undefined;
  };

  // Every-K deadline check (D6): compiled elements are ~µs, so the drain
  // loop re-arms interruptibility itself. Inert when no deadline is armed.
  let ticks = 0;

  // The marked tier, for a body that applies a function whose result jumps
  // at a point (`jumpBody`): an exact input is computed by the compiled
  // code only when the body is proved integer-closed and overflow-free
  // over the sources, as for the exact tier (`exactTierShape()` over the
  // marked levels), and the input is an integer inside the proved bounds.
  // The compiled code then computes the integers the interpreter computes.
  // Any other exact input is computed by the interpreter.
  //
  // The proof is taken once per drain, when the first exact input needs it,
  // and again only when the mutation generation or the visibility of the
  // assumptions changes: the bounds it propagated come from symbol values
  // and assumptions, which `exactTierShape()` keys its own memo on.
  let jumpProof: ExactTierShape | undefined;
  let jumpProofKey: { generation: number; factsHidden: boolean } | undefined;
  const exactJumpInputAllowed = (item: Expression, i: number): boolean => {
    const generation = ce._semanticVersion;
    const factsHidden = ce._factsHidden();
    if (
      jumpProofKey?.generation !== generation ||
      jumpProofKey.factsHidden !== factsHidden
    ) {
      jumpProof = exactTierShape(ce, expr, { numericMarker: true });
      jumpProofKey = { generation, factsHidden };
    }
    const b = jumpProof?.sourceBounds[i];
    return (
      b !== undefined &&
      isNumber(item) &&
      !item.isComplex &&
      Number.isSafeInteger(item.re) &&
      item.re >= b.lo &&
      item.re <= b.hi
    );
  };

  return (items): CompiledElement | undefined => {
    if ((++ticks & 0xff) === 0) checkDeadline(ce._deadlineFrame);

    const cache = ensure();
    if (cache?.state !== 'compiled' || cache.fn === undefined) return undefined;

    // Input conversion (D5): every source element must be a number literal;
    // reals pass their machine float, complex `{re, im}`. A row with any
    // non-convertible element falls back to the interpreter (the compiled
    // function keeps serving other rows).
    //
    // The exact tier additionally re-checks at RUNTIME what its static proof
    // established — every input is an exact real integer float64 can hold
    // exactly, AND lies inside the interval the proof propagated bounds from.
    // The bounds half matters because the proof is taken at DRAIN START while
    // the compiled function is used per element: a symbol source's list (R6)
    // is not in `symbolDeps`, so `validCompiled` re-stamps a reassignment
    // rather than routing it through `stillEligible()`. A live iterator
    // captures its source today, so nothing reaches this check — it is what
    // makes the exactness contract independent of that, instead of resting on
    // it. Two comparisons per element, below the boxing noise floor.
    // The marked tier checks an exact input of a body that applies a
    // function whose result jumps at a point (`exactJumpInputAllowed`).
    const args: unknown[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isNumber(item)) {
        _mapAutoCompileStats.elementFallbacks++;
        return undefined;
      }
      if (tier === 'exact') {
        const b = sourceBounds[i];
        if (
          b === undefined ||
          item.isComplex ||
          !item.isExact ||
          !Number.isSafeInteger(item.re) ||
          item.re < b.lo ||
          item.re > b.hi
        ) {
          _mapAutoCompileStats.elementFallbacks++;
          return undefined;
        }
      } else if (
        item.isExact &&
        ((cache.jumpBody === true && !exactJumpInputAllowed(item, i)) ||
          Math.abs(item.re) > Number.MAX_SAFE_INTEGER ||
          Math.abs(item.im) > Number.MAX_SAFE_INTEGER)
      ) {
        // The marked tier: a body that applies a function whose result
        // jumps at a point (`jumpBody`) reads an exact input exactly in the
        // interpreter, and the float of the input can be on the other side
        // of the jump (`JUMP_FUNCTIONS`). Unless the input is an integer the
        // proof admits (`exactJumpInputAllowed`), the interpreter computes
        // this element.
        //
        // An exact input that is larger than the safe integers loses digits
        // when it is converted to a float, but the interpreter computes with
        // its exact value first. For example, `3x` at the exact
        // `9007199254740993` is `27021597764222979`, but the compiled code
        // multiplies the float `9007199254740992`. The interpreter computes
        // this element.
        _mapAutoCompileStats.elementFallbacks++;
        return undefined;
      }
      args.push(item.isComplex ? { re: item.re, im: item.im } : item.re);
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

    // An integer value of the marked tier: see the comment where a real
    // result is handled. Under a user-written `N` (`marked.inexact`), the
    // value is a float, as the `N` operator gives in the interpreter. A
    // compiled integer that is larger than the safe integers can have lost
    // digits, so the interpreter computes it again.
    //
    // Under the numeric marker, the value is exact only when every input is
    // an exact integer: an exact rational input is rounded when it is
    // converted to a float. For example, `3x` at the exact `1/3 + 2^-60` is
    // the compiled integer `1`, but the interpreter gives a float: the value
    // of the exact rational `1 + 3·2^-60` is not an integer.
    const integerResult = (r: number): CompiledElement | undefined => {
      if (marked?.inexact === true) {
        if (!Number.isSafeInteger(r)) return fallback();
        _mapAutoCompileStats.compiledHits++;
        return { kind: 'float', value: r };
      }
      if (
        cache.exactBody === true &&
        Number.isSafeInteger(r) &&
        items.every(
          (item) =>
            isNumber(item) &&
            item.isExact &&
            Number.isInteger(item.re) &&
            Number.isInteger(item.im)
        )
      ) {
        _mapAutoCompileStats.compiledHits++;
        return { kind: 'exact', value: r };
      }
      return fallback();
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
    // An infinite result re-evaluates through the interpreter too: a real
    // double cannot tell `+oo` from the unsigned pole `~oo`, which is the
    // interpreter's value of `1/0` and of `Tan` at `π/2` (the compiled code
    // answers `Infinity` for both).
    if (typeof r === 'number') {
      if (!Number.isFinite(r)) {
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
          return { kind: 'exact', value: r };
        }
      } else {
        // The marked tier computes a numeric approximation, as `.N()` does
        // in the interpreter. A value that is not an integer is a float in
        // the interpreter too. Under a user-written `N`, an integer value is
        // a float too (`integerResult()`). Under the numeric marker, an
        // integer value can be exact or a float in the interpreter:
        // `N(x^2)` at `4` is the exact `16` and `N(Sign(2.5))` the exact `1`,
        // but `N(Sec(x))` at the float `1e-13` is the float `1.0`, and
        // `N(Sec(1e-13·x))` is the exact `1` at `0` and the float `1.0` at
        // `1`. A safe integer from exact operands and a body with no float
        // literal (`exactBody`) is exact. Any other integer value is computed
        // again by the interpreter, which alone can tell.
        if (Number.isInteger(r)) return integerResult(r);
        _mapAutoCompileStats.compiledHits++;
        return { kind: 'float', value: r };
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
        if (!Number.isFinite(re) || !Number.isFinite(im)) {
          _mapAutoCompileStats.nanDoubleChecks++;
          return fallback();
        }
        // A real value (`im === 0`) with an integer value follows the rule
        // for a real result (see above). A complex value is a float, as it
        // is in the interpreter (`N(√x)` at `-4` is the float `2.0i`).
        if (im === 0 && Number.isInteger(re)) return integerResult(re);
        _mapAutoCompileStats.compiledHits++;
        return im === 0
          ? { kind: 'float', value: re }
          : { kind: 'complex', re, im };
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
