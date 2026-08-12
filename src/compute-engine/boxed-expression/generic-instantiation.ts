import {
  admissionSkeleton,
  freeTypeVariables,
  hasFreeTypeVariables,
  parameterPositions,
  solveTypeArguments,
  substituteTypeVariables,
  type TypeInferenceResult,
} from '../../common/type/instantiate.js';
import { isCallbackType } from '../../common/type/callback.js';
import { provablyDisjoint } from '../../common/type/subtype.js';
import { typeContainsMissing } from '../../common/type/utils.js';
import type {
  CallbackType,
  FunctionSignature,
  Type,
  TypeParameter,
  TypeResolver,
} from '../../common/type/types.js';

import { couldBeCollectionOperand } from '../collection-utils.js';
import type { Expression } from '../global-types.js';

/**
 * The call-site solver's EMBEDDING (§4.3/§4.5 of
 * `docs/plans/2026-08-01-type-variables-design.md`).
 *
 * The solver itself lives in `common/type/instantiate.ts` and knows nothing
 * about expressions. This module is the one place that maps the engine's
 * admission gates onto the solver's per-position options, so argument
 * validation (`validate.ts`) and result typing (`boxed-function.ts`) solve the
 * SAME constraint problem — the same reason `resolvedArm` recomputes
 * `validateArguments`' overload policies.
 *
 * Everything here is write-free: the output is a binding map, never a
 * definition or type mutation.
 */

/** The polytype arm of `t`, or `undefined` when `t` is not one. O(1). */
export function polytypeArm(
  t: Readonly<Type> | undefined
): FunctionSignature | undefined {
  if (t === undefined || typeof t !== 'object') return undefined;
  if (t.kind !== 'signature') return undefined;
  if (t.typeParams === undefined || t.typeParams.length === 0) return undefined;
  return t;
}

/**
 * `t` with every variable quantified by `typeParams` replaced by its DECLARED
 * BOUND (an unbounded variable is left as-is).
 *
 * This is the KIND-level reading of a pattern — what EVERY instantiation of it
 * has in common, NOT what a given call binds (that is `solveArm`'s job). It is
 * what a gate asking a *shape* question about the signature itself must use:
 * `T: indexed_collection` can only ever denote a collection, so a `(T) -> T`
 * parameter is collection-typed exactly as the ground
 * `(indexed_collection) -> indexed_collection` one is (§4.5 parity).
 */
export function substituteDeclaredBounds(
  typeParams: ReadonlyArray<TypeParameter> | undefined,
  t: Type
): Type {
  if (typeParams === undefined || typeParams.length === 0) return t;
  const bounds: Record<string, Type> = Object.create(null);
  let n = 0;
  for (const p of typeParams)
    if (p.bound !== undefined) {
      bounds[p.name] = p.bound;
      n += 1;
    }
  return n === 0 ? t : substituteTypeVariables(t, bounds);
}

/**
 * Threadability of a call: `true`/`false` globally (the legacy
 * `opDef.broadcastable` flag, and `paramsAreScalar`'s all-or-nothing inference
 * verdict), or a PER-POSITION answer.
 *
 * The per-position spelling is what a DECLARED `broadcastable<T>` signature
 * needs (`docs/plans/2026-08-08-broadcastable-param-semantics.md`): such a
 * signature maps a collection argument at the slots it marks elementwise, but
 * a sibling slot declared `list<…>`/`tuple<…>` binds its argument WHOLE and
 * must be validated as usual. A global `true` there admitted a collection at
 * EVERY slot unchecked.
 */
export type Threadable = boolean | ((paramIndex: number) => boolean);

/** Is position `i` threadable? The one place the two {@link Threadable}
 * spellings are collapsed, so every gate reads them identically. */
export function isThreadableAt(
  threadable: Threadable | undefined,
  i: number
): boolean {
  return typeof threadable === 'function' ? threadable(i) : threadable === true;
}

/** What the embedding knows about the call that the solver cannot see. */
export interface ArmInferenceContext {
  /** The operator broadcasts (`threadable`): a collection operand is
   * lift-admitted at a scalar parameter (D10). Per-position for a declared
   * `broadcastable<T>` signature — see {@link Threadable}. */
  threadable?: Threadable;
  /** Strip-before-validate eligibility, per position. */
  stripMissing?: (index: number) => boolean;
  /** The resolver whose `conformsTo` oracle decides a `where T is P` slot
   * (P19). It belongs to the engine the CALL is made on — the protocol
   * registry is per-engine, and an operand boxed under a different engine
   * would otherwise answer from the wrong registry. Every caller has that
   * engine in hand, so it is threaded rather than scavenged off an operand. */
  resolver?: TypeResolver;
  /** The operator is `lazy: true`. The whole mechanism is IDLE (§4.5): a lazy
   * operator's operands are not validated and arrive unbound, so their types
   * are noise — no position contributes a bound, and every variable falls to
   * the S3 fallback (its declared bound, else `unknown`). Pinned by a named
   * test, so closing the lazy carve-out later fails deliberately. */
  lazy?: boolean;
}

/**
 * Solve `arm`'s `where` clause against `ops` (§4.3), mapping each §4.5
 * admission gate onto the solver's bound-contribution rules.
 */
export function solveArm(
  arm: FunctionSignature,
  ops: ReadonlyArray<Expression>,
  ctx?: ArmInferenceContext
): TypeInferenceResult {
  // §4.5 — the mechanism is IDLE for a lazy operator. Solve against NO actuals
  // at all, so every variable falls to its S3 fallback. Carving this out in
  // `skip` alone would be too late: building the actuals array reads `.type`
  // on every operand, and a lazy operator's operands arrive UNBOUND, so
  // forcing their type is both meaningless and a canonicalization side trip.
  if (ctx?.lazy) return solveTypeArguments(arm, []);

  // The LOOSEST reading of each parameter: every variable read as `any`. An
  // operand that fails even this is admitted provisionally at best (deferred
  // overlap, value-component tri-state, matrix repair, devolution), and every
  // provisional admission contributes NO bound (§4.5).
  //
  // This is an ADMISSION domain, not a disjointness one: at an INVARIANT
  // applied reference (`cell<inout T>`, or one whose variance is still
  // deferred) the ordinary skeleton `cell<any>` is over-strict and would skip
  // — and so never solve — a position every `cell<X>` legitimately inhabits.
  // The solve itself refutes a non-application, and the post-solve gate in
  // `validate.ts` re-checks the position against the INSTANTIATED parameter.
  const positions = parameterPositions(arm, ops.length);
  const skeletons = positions.map((p) =>
    p === undefined ? undefined : admissionSkeleton(p)
  );

  return solveTypeArguments(
    arm,
    ops.map((op) => op?.type.type),
    {
      // The `where T is P` oracle (protocols design P19), supplied by the
      // CALLER's engine — see `ArmInferenceContext.resolver`.
      resolver: ctx?.resolver,
      skip: (i) => {
        if (ctx?.lazy) return true;
        const op = ops[i];
        if (!op) return true;
        // An already-invalid operand: no bound, existing error path unchanged.
        if (!op.isValid) return true;
        // Missing-value stripping: stripped before inference, contributes
        // nothing.
        if (ctx?.stripMissing?.(i) && typeContainsMissing(op.type.type))
          return true;
        const skeleton = skeletons[i];
        return skeleton !== undefined && !op.type.matches(skeleton);
      },
      inferable: (i) => {
        // An INFERABLE unknown/`any` symbol contributes no bound; it stays
        // eligible for post-solve narrowing to the instantiated ground
        // parameter. A NON-inferable unknown operand does contribute (and
        // absorbs, §4.3 table).
        const op = ops[i];
        return (
          !!op?.valueDefinition?.inferredType &&
          (op.type.isUnknown || op.type.type === 'any')
        );
      },
      lifted: (i) => {
        // D10 (re-ruled 2026-08-04): a lift-admitted operand at a
        // bare-variable pattern binds its ELEMENT type — the runtime maps
        // here, so the variable denotes one element and the call site's
        // ordinary broadcast wrap re-lifts the instantiated result. Admission
        // stays checked at the scalar base by the lift gate itself.
        const op = ops[i];
        return (
          isThreadableAt(ctx?.threadable, i) &&
          !!op &&
          couldBeCollectionOperand(op)
        );
      },
    }
  );
}

// RETIRED 2026-08-04 (D10 re-ruling): `liftedEchoPositions`. While a
// lift-admitted operand bound the WHOLE actual, a bare-variable result type
// already WAS the collection and the call site had to skip its broadcast wrap.
// Element-binding removes the special case: the instantiated result is now the
// PER-ELEMENT type at every lift-admitted position, so the ordinary wrap
// produces the right answer for every result shape — the bare echo (unwrap ∘
// whole-bind ≡ wrap ∘ element-bind) and the variable-MENTIONING results the
// short-circuit could never handle (`(T) -> tuple<T, T>` typed one rank too
// high).

//
// ── The contextual callback solve (Design D §5) ───────────────────────────────
//

/** One `callback<S>` slot of an arm, at a concrete application. */
export interface CallbackSlot {
  /** The operand position the slot consumes. */
  index: number;
  /** `S` — the signature an inline literal at that position is stamped with. */
  signature: FunctionSignature;
}

/** The positions Design D §5 steps 1–2 need from an application. */
export interface ContextualCallbackPlan {
  /** The `callback<S>` slots, in operand order. Never empty. */
  callbacks: ReadonlyArray<CallbackSlot>;
  /** The NON-callback positions whose type constrains a callback-DOMAIN
   * variable — the only operands step 1 canonicalizes. Never empty. */
  sources: ReadonlyArray<number>;
  /** The variables the callback slots' PARAMETER types read (clause 2) — the
   * only ones this pass solves and substitutes. A result-side variable is left
   * OPEN in the instantiated slot: it belongs to §5 step 4, which reads the
   * callback's own type, and pinning it to the domain solve's `unknown`
   * fallback here would silently answer a question this pass never asked. */
  domainVars: ReadonlySet<string>;
}

/**
 * The `callback<S>` a PARAMETER SLOT offers a contextual stamp — R-D4
 * (resolve-then-stamp, ruled 2026-08-09) at SLOT granularity, the companion of
 * {@link resolveContextualArm}'s arm granularity.
 *
 * A slot spelled `callback<S>` is its own answer. A UNION slot resolves first:
 * `Partition`'s `integer | callback<(T) -> boolean>` has two disjoint arms, and
 * the only operand shape a contextual stamp ever rewrites — an inline
 * `Function` literal — can take just one of them. So the callback arm is the
 * RESOLVED arm, and the stamp runs against it.
 *
 * Declines whenever the resolution is not forced: two callback arms, or a
 * non-callback arm that a function could also inhabit (`callback<S> |
 * function`, `callback<S> | any`). The stamp never guesses which arm an operand
 * took.
 */
export function contextualSlotCallback(t: Type): CallbackType | undefined {
  if (isCallbackType(t)) return t;
  if (typeof t !== 'object' || t.kind !== 'union') return undefined;

  // The O(1)-per-arm scan FIRST: a union with no callback arm is every other
  // union in the library, and it must not pay for the checks below.
  let found: CallbackType | undefined;
  for (const arm of t.types)
    if (isCallbackType(arm)) {
      if (found !== undefined) return undefined;
      found = arm;
    }
  if (found === undefined) return undefined;

  for (const arm of t.types) {
    if (isCallbackType(arm)) continue;
    // An OPEN arm (`T | callback<…>`) declines twice over: nothing says a
    // function could not inhabit `T`, and an open type must never reach
    // `provablyDisjoint` (the §4.2 ground invariant asserts on one).
    if (hasFreeTypeVariables(arm)) return undefined;
    // `provablyDisjoint`, not "is not a function": an arm that MIGHT admit a
    // function (`any`, an arrow of its own) leaves the resolution open.
    if (!provablyDisjoint(arm, 'function')) return undefined;
  }
  return found;
}

/** Does any DECLARED parameter of `arm` offer a contextual callback slot
 * ({@link contextualSlotCallback})? Allocation-free — the guard on the
 * contextual pass's whole cost. */
export function hasCallbackParam(arm: FunctionSignature): boolean {
  for (const a of arm.args ?? [])
    if (contextualSlotCallback(a.type) !== undefined) return true;
  for (const a of arm.optArgs ?? [])
    if (contextualSlotCallback(a.type) !== undefined) return true;
  return (
    arm.variadicArg !== undefined &&
    contextualSlotCallback(arm.variadicArg.type) !== undefined
  );
}

/**
 * The PLANNING pass, write-free: which operands of this application feed a
 * `callback<S>` slot's PARAMETER types, and which slots they feed. It precedes
 * §5's five steps — it decides what step 1 canonicalizes and what step 2
 * solves — rather than being one of them.
 *
 * `undefined` when the arm has no contextual callback slot, or when no operand
 * position can constrain one — the caller then does nothing at all, so an
 * operator that has not been converted pays a shallow scan of its parameter
 * list and no canonicalization.
 *
 * The domain variables are read from `S`'s PARAMETERS only (contract clause
 * 2): a variable occurring solely in `S`'s result is a result-side variable,
 * solved later from the callback's own type, and an operand mentioning only
 * that variable is not a source this pass has any reason to force.
 *
 * `hasCallbackSlot` is the {@link hasCallbackParam} answer when the caller has
 * already computed it (the contextual pass gates on it, and on the overload
 * route `resolveContextualArm` did too) — the scan is repeated here only when
 * it is omitted.
 */
export function contextualCallbackPlan(
  arm: FunctionSignature,
  count: number,
  hasCallbackSlot?: boolean
): ContextualCallbackPlan | undefined {
  // Fast path: every polytype application reaches this, and almost none
  // declares a contextual slot. A field scan is O(#params) and allocates
  // nothing; the walk below allocates per position.
  if (!(hasCallbackSlot ?? hasCallbackParam(arm))) return undefined;

  const positions = parameterPositions(arm, count);
  // ONE `contextualSlotCallback` per position: it walks a union's arms and can
  // reach `provablyDisjoint`, and both loops below ask the same question of the
  // same slot.
  const slots = positions.map((p) =>
    p === undefined ? undefined : contextualSlotCallback(p)
  );

  const callbacks: CallbackSlot[] = [];
  const domainVars = new Set<string>();
  slots.forEach((cb, index) => {
    if (cb === undefined) return;
    callbacks.push({ index, signature: cb.signature });
    for (const el of [
      ...(cb.signature.args ?? []),
      ...(cb.signature.optArgs ?? []),
      ...(cb.signature.variadicArg ? [cb.signature.variadicArg] : []),
    ])
      for (const v of freeTypeVariables(el.type)) domainVars.add(v);
  });
  if (callbacks.length === 0 || domainVars.size === 0) return undefined;

  const sources: number[] = [];
  positions.forEach((p, index) => {
    if (p === undefined || slots[index] !== undefined) return;
    for (const v of freeTypeVariables(p))
      if (domainVars.has(v)) {
        sources.push(index);
        return;
      }
  });
  if (sources.length === 0) return undefined;

  return { callbacks, sources, domainVars };
}

/**
 * Design D §5 step 2: solve the callback-DOMAIN variables from `actuals`, and
 * return each slot's `S` instantiated with the solution.
 *
 * A RESTRICTED entry point beside {@link solveArm}, not a change to its §4.5
 * lazy carve-out: the carve-out exists because building the full actuals array
 * forces `.type` on operands that arrive unbound, and this pass never does
 * that — its caller canonicalizes exactly the {@link ContextualCallbackPlan}
 * `sources` and leaves every other operand, the callback included, untouched.
 * `actuals` is therefore SPARSE: only the planned source positions carry a
 * type, and every other position is skipped outright.
 *
 * Write-free. A slot whose `S` still has a free variable after the solve is
 * returned as-is; the caller's per-parameter gate declines the open ones.
 */
export function instantiateCallbackSlots(
  arm: FunctionSignature,
  plan: ContextualCallbackPlan,
  actuals: ReadonlyArray<Type | undefined>
): Map<number, FunctionSignature> {
  const sources = new Set(plan.sources);
  const solved = solveTypeArguments(arm, actuals, {
    skip: (i) => !sources.has(i) || actuals[i] === undefined,
  });

  // Clause 2: only the DOMAIN variables are substituted. A result-side
  // variable stays open in the instantiated slot (see `domainVars`).
  const bindings: Record<string, Type> = Object.create(null);
  for (const name of plan.domainVars)
    if (solved.bindings[name] !== undefined)
      bindings[name] = solved.bindings[name];

  const result = new Map<number, FunctionSignature>();
  for (const slot of plan.callbacks)
    result.set(
      slot.index,
      substituteTypeVariables(slot.signature, bindings) as FunctionSignature
    );
  return result;
}

/**
 * `param` with the solved bindings applied, or `undefined` when it is STILL
 * open.
 *
 * The ground-type invariant (§4.2) is enforced here: a caller that gets
 * `undefined` must SKIP whatever write it was about to make rather than write
 * an open type. With a total solver this cannot happen — which is exactly why
 * it is worth checking rather than assuming.
 */
export function instantiatedParam(
  param: Type,
  bindings: Readonly<Record<string, Type>>
): Type | undefined {
  const t = substituteTypeVariables(param, bindings);
  return freeTypeVariables(t).size === 0 ? t : undefined;
}

/**
 * The GROUND result type of applying a polytype arm to `ops`, or `undefined`
 * when `arm` is not a polytype.
 *
 * Never returns an open type: an unsolved residue falls back to `unknown`
 * (§4.2 — `functionResult` of a polytype returns the OPEN result, which must
 * never escape as an expression's `.type`).
 */
export function instantiatedResultType(
  arm: Readonly<Type> | undefined,
  ops: ReadonlyArray<Expression>,
  ctx?: ArmInferenceContext
): Type | undefined {
  const poly = polytypeArm(arm);
  if (poly === undefined) return undefined;
  const solved = solveArm(poly, ops, ctx);
  const result = substituteTypeVariables(poly.result, solved.bindings);
  return freeTypeVariables(result).size === 0 ? result : 'unknown';
}
