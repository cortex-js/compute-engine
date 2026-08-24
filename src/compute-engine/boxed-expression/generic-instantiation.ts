import {
  admissionSkeleton,
  freeTypeVariables,
  hasFreeTypeVariables,
  parameterPositions,
  solveTypeArguments,
  substituteTypeVariables,
  type TypeInferenceResult,
} from '../../common/type/instantiate.js';
import { provablyDisjoint } from '../../common/type/subtype.js';
import { widenValueTypes } from '../../common/type/widen-value.js';
import {
  functionResult,
  stripNumericRanges,
  typeContainsMissing,
} from '../../common/type/utils.js';
import type {
  FunctionSignature,
  Type,
  TypeParameter,
  TypeResolver,
} from '../../common/type/types.js';

import { couldBeUnkeyedCollectionOperand } from '../collection-utils.js';
import type { Expression } from '../global-types.js';

/**
 * The call-site solver's EMBEDDING (§4.3/§4.5 of
 * `docs/TYPE-SYSTEM.md`).
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

  // Design E R-E3 (`docs/TYPE-SYSTEM.md`):
  // an operand at a PLAIN-ARROW contextual slot contributes no DOMAIN
  // constraints — a callback's parameter types must never constrain the solve.
  // Without this, respelling `CountIf`'s slot as `(T) any -> boolean` would
  // make `CountIf(zs, IsPrime)` bind `T = number` from the predicate and
  // manufacture `zs: collection<number>` out of a wildcard source (probed
  // 2026-08-18 on a user polytype: `apply2: ((T) -> U, T) -> U` bound `T`
  // from `IsPrime`). The slot's RESULT still flows — a bare result variable
  // the data operands leave unbound is bound from the callback operand's own
  // result type after the solve (Design D §4 clause 3, preserved).
  const arrowSlots = positions.map((p) =>
    p === undefined ? undefined : contextualSlotSignature(p)
  );
  // R-E3 as built: DATA positions are AUTHORITATIVE for a domain variable —
  // an arrow-slot operand is consulted only for variables NO data position
  // mentions. The full-suite round showed the blanket skip deleted ratified
  // behavior (`type-variables.test.ts` end-to-end: `comp: ((T) -> U,
  // (U) -> V) -> (T) -> V` and the multi-callback meet `both: ((T) ->
  // boolean, (T) -> boolean) -> T`, whose variables occur ONLY at callback
  // slots and are legitimately solved from them), while the ruling's anchor
  // cases (`CountIf(zs, IsPrime)` leaving `zs: collection<unknown>`; the
  // union-source predicate never conflicting the data solve) all have the
  // variable at a data position. A slot whose parameter variables are ALL
  // data-anchored is skipped; any un-anchored parameter variable lets the
  // slot contribute, pre-E behavior unchanged.
  const dataVars = new Set<string>();
  positions.forEach((p, i) => {
    if (p === undefined || arrowSlots[i] !== undefined) return;
    for (const v of freeTypeVariables(p)) dataVars.add(v);
  });
  const skippedArrowSlots = arrowSlots.map((s) => {
    if (s === undefined) return undefined;
    const paramVars = new Set<string>();
    for (const el of [
      ...(s.args ?? []),
      ...(s.optArgs ?? []),
      ...(s.variadicArg ? [s.variadicArg] : []),
    ])
      for (const v of freeTypeVariables(el.type)) paramVars.add(v);
    if (paramVars.size === 0) return undefined;
    for (const v of paramVars) if (!dataVars.has(v)) return undefined;
    return s;
  });

  const solved = solveTypeArguments(
    arm,
    // A type variable must never capture a literal's type: with the public
    // `.type` of a literal being the literal type (ruling O9, 2026-08-23),
    // `identity(5)` would otherwise bind `T = 5` and STORE it as the
    // application's result type — an over-specific contract nobody wrote.
    // A NUMBER LITERAL projects all the way to its tier
    // (`stripNumericRanges`): its type may be a value node (`5`), a
    // singleton range (`finite_rational<0.5..0.5>`) or a sign range
    // (`(finite_real<0..>) & !0` for `√2`), and all three are literal
    // cargo. Any other operand goes through `widenValueTypes`, which
    // widens embedded value nodes and rational singletons but PRESERVES a
    // handler's deliberate range claim (`identity(|x|)` still binds
    // `T = finite_real<0..>`, as it did before literals carried these
    // types). Ground parameters with a declared value component
    // (`(0) -> 0`) never reach the solver, so exact value admission is
    // unaffected.
    ops.map((op) =>
      op
        ? op._literalType !== undefined
          ? stripNumericRanges(op.type.type)
          : widenValueTypes(op.type.type)
        : undefined
    ),
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
        // Design E R-E3: no domain constraints from an arrow-slot operand
        // whose parameter variables are data-anchored (see `skippedArrowSlots`
        // above; the result-side flow runs after the solve).
        if (skippedArrowSlots[i] !== undefined) return true;
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
          couldBeUnkeyedCollectionOperand(op)
        );
      },
    }
  );
  return refineResultSideFromCallbacks(solved, skippedArrowSlots, ops);
}

/**
 * The RESULT-side flow at plain-arrow contextual slots (Design E R-E3, the
 * preserved half of Design D §4 clause 3): a variable that occurs as the BARE
 * result of an arrow slot (`(T) any -> U` — the `Map`/`FlatMap`/`apply` shape)
 * and got no bound from the data operands is bound from the callback operand's
 * own declared result type. Parameter-side variables were deliberately not
 * solved from that operand (the `skip` above); this reads ONLY the arrow's
 * result. A nested-variable result (`-> list<U>`) is left to the `unknown`
 * fallback — conservative, and no converted signature spells one.
 */
function refineResultSideFromCallbacks(
  solved: TypeInferenceResult,
  arrowSlots: ReadonlyArray<FunctionSignature | undefined>,
  ops: ReadonlyArray<Expression>
): TypeInferenceResult {
  let bindings: TypeInferenceResult['bindings'] | undefined;
  let unbound: Set<string> | undefined;
  for (let i = 0; i < arrowSlots.length; i++) {
    const slot = arrowSlots[i];
    if (slot === undefined) continue;
    const r = slot.result;
    if (typeof r !== 'object' || r.kind !== 'variable') continue;
    if (!(unbound ?? solved.unbound).has(r.name)) continue;
    const op = ops[i];
    if (!op?.isValid) continue;
    const fr = functionResult(op.type.type);
    if (fr === undefined || hasFreeTypeVariables(fr)) continue;
    // A top-typed result says nothing; keep the ordinary `unknown` fallback.
    if (fr === 'unknown' || fr === 'any') continue;
    bindings ??= { ...solved.bindings };
    unbound ??= new Set(solved.unbound);
    bindings[r.name] = fr;
    unbound.delete(r.name);
  }
  if (bindings === undefined) return solved;
  return { ...solved, bindings, unbound: unbound! };
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

/** One contextual arrow slot of an arm, at a concrete application. */
export interface CallbackSlot {
  /** The operand position the slot consumes. */
  index: number;
  /** `S` — the signature an inline literal at that position is stamped with. */
  signature: FunctionSignature;
}

/** The positions Design D §5 steps 1–2 need from an application. */
export interface ContextualCallbackPlan {
  /** The contextual arrow slots, in operand order. Never empty. */
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
 * The signature a parameter slot offers a contextual stamp (Design E §6,
 * `docs/TYPE-SYSTEM.md`): a PLAIN
 * ARROW slot is a contextual slot. A UNION slot resolves under the
 * forced-resolution rule — exactly one signature arm, every other arm closed
 * and provably unable to take a function, the only operand shape a stamp
 * rewrites (`Partition`'s `integer | ((T) any -> boolean)`); the stamp never
 * guesses which arm an operand took.
 *
 * A GROUND arrow answers too: the callers that only care about a solvable slot
 * (the planning pass) decline later for lack of domain variables, and the
 * ground-stamp fallback path keeps its own narrower filter.
 */
export function contextualSlotSignature(
  t: Type
): FunctionSignature | undefined {
  if (typeof t !== 'object') return undefined;
  if (t.kind === 'signature') return t;
  // A transparent alias IS its definition — §6b's claim that the
  // reference-hidden-slot gap closes ("an alias that expands to an arrow is
  // an arrow") requires the unfold HERE, at the trigger; a nominal
  // reference stays opaque. Alias definitions are expanded eagerly at build
  // time, so a cycle cannot reach this recursion.
  if (t.kind === 'reference') {
    if (t.alias !== true || t.def === undefined) return undefined;
    return contextualSlotSignature(t.def);
  }
  if (t.kind !== 'union') return undefined;
  let found: FunctionSignature | undefined;
  for (const arm of t.types) {
    if (typeof arm === 'object' && arm.kind === 'signature') {
      if (found !== undefined) return undefined;
      found = arm;
    }
  }
  if (found === undefined) return undefined;
  for (const arm of t.types) {
    if (typeof arm === 'object' && arm.kind === 'signature') continue;
    if (hasFreeTypeVariables(arm)) return undefined;
    if (!provablyDisjoint(arm, 'function')) return undefined;
  }
  return found;
}

/** Does any DECLARED parameter of `arm` offer a contextual callback slot
 * ({@link contextualSlotSignature})? Allocation-free — the guard on the
 * contextual pass's whole cost. */
export function hasCallbackParam(arm: FunctionSignature): boolean {
  for (const a of arm.args ?? [])
    if (contextualSlotSignature(a.type) !== undefined) return true;
  for (const a of arm.optArgs ?? [])
    if (contextualSlotSignature(a.type) !== undefined) return true;
  return (
    arm.variadicArg !== undefined &&
    contextualSlotSignature(arm.variadicArg.type) !== undefined
  );
}

/**
 * The PLANNING pass, write-free: which operands of this application feed a
 * contextual arrow slot's PARAMETER types, and which slots they feed. It precedes
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
  // ONE `contextualSlotSignature` per position: it walks a union's arms and can
  // reach `provablyDisjoint`, and both loops below ask the same question of the
  // same slot.
  const slots = positions.map((p) =>
    p === undefined ? undefined : contextualSlotSignature(p)
  );

  const callbacks: CallbackSlot[] = [];
  const domainVars = new Set<string>();
  slots.forEach((cb, index) => {
    if (cb === undefined) return;
    callbacks.push({ index, signature: cb });
    for (const el of [
      ...(cb.args ?? []),
      ...(cb.optArgs ?? []),
      ...(cb.variadicArg ? [cb.variadicArg] : []),
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
  // Same solver-boundary widening as `solveArm`: a callback slot stamped
  // from a literal source (`Fold(f, 5, xs)`) must read `(finite_integer,
  // …)`, never `(5, …)`. This entry point receives TYPES, not operands, so
  // it cannot apply `solveArm`'s literal-aware tier projection — a sign
  // range from an irrational literal source keeps its range here, which is
  // sound (the stamp stays a supertype-compatible parameter).
  const solved = solveTypeArguments(
    arm,
    actuals.map((t) => (t === undefined ? undefined : widenValueTypes(t))),
    { skip: (i) => !sources.has(i) || actuals[i] === undefined }
  );

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
