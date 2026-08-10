import {
  isSubtype,
  provablyDisjoint,
  widen,
} from '../../common/type/subtype.js';
import { isEffectSubset } from '../../common/type/effects.js';
import {
  freeTypeVariables,
  paramAt,
  readTypeVariablesAsBounds,
  substituteTypeVariables,
  type TypeInferenceResult,
} from '../../common/type/instantiate.js';
import {
  contextualSlotCallback,
  hasCallbackParam,
  isThreadableAt,
  solveArm,
  type Threadable,
} from './generic-instantiation.js';
import {
  broadcastableBaseMatches,
  narrowingPreservesEffects,
  overlapsForDeferredValidation,
  signatureArms,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import { isSymbol } from './type-guards.js';
import {
  admissionOf,
  hasValueComponent,
  type Admission,
} from './value-membership.js';

/**
 * Overload resolution for an **intersection of function signatures** — the
 * standard encoding of an overload set: the value inhabits every arm, i.e. it
 * is callable at each of them.
 *
 * See `docs/plans/2026-07-25-overload-resolution-design.md`. Two contracts
 * from that document govern everything here:
 *
 * - **§4.2 — resolution is WRITE-FREE.** Nothing in this file mutates a symbol
 *   definition. Resolving by running each arm through `validateArguments` and
 *   keeping the first that succeeds would let its in-loop
 *   `op.infer(param, 'narrow')` mutate symbols on arms that are subsequently
 *   *rejected*.
 * - **§4.3 — inference uses the JOIN over the surviving arms, not the winner.**
 *   Hence `resolveOverload` returns the whole `viable` set, not just
 *   `selected`: the result type is read off `selected` (most-specific-wins),
 *   while inference *into operands* must be weakened to the join. Those pull
 *   in opposite directions; conflating them reintroduces the §4.5
 *   unsoundness.
 *
 * Selection is purely a **typing** concern (ratified 2026-07-25): it governs
 * argument validation and result typing. An operator's `evaluate` handler keeps
 * its own runtime discrimination and is never told which arm was picked.
 */

export interface OverloadResolution {
  /** The most-specific viable arm, AS DECLARED — a polytype arm keeps its
   * `forall` clause; `undefined` when no arm fits. */
  selected: FunctionSignature | undefined;
  /** Every arm that survived arity + type filtering, in declaration order,
   * each one GROUND: a polytype arm is the instantiation solved at THIS call
   * (per-arm, §4.1 of the type-variables design), a ground arm is itself.
   *
   * This is what `joinParamAt` consumes, so operand inference never sees an
   * open type (§4.2 ground invariant).
   */
  viable: ReadonlyArray<FunctionSignature>;
  /** `selected`'s ground instantiation at this call (§6). `undefined` exactly
   * when `selected` is; for a ground arm it IS `selected`.
   *
   * Consumed by `resolvedArm`'s value-arm JOIN, which must never widen over an
   * OPEN result (§4.2). Result typing at large still re-derives its own
   * instantiation from `selected`: `.type` is a getter reached on paths that
   * never resolved, so `boxed-function.ts` recomputes the policies (and hence
   * the solve) deliberately — see `resolvedArm`'s docblock. */
  selectedInstance: FunctionSignature | undefined;
  /** The solve that produced `selectedInstance`, or `undefined` when
   * `selected` is ground (or absent). `validateArguments` consumes it instead
   * of re-solving the selected arm with the identical context.
   *
   * Everything else the resolution could expose — the declared form of each
   * viable arm, the per-arm bindings — had no consumer and is deliberately not
   * carried: the two real callers need the JOIN over `viable` (ground, §4.3)
   * and this one solve. */
  selectedSolution: TypeInferenceResult | undefined;
}

/**
 * The arms of an overload set, or `undefined` when `t` is not one.
 *
 * Deliberately strict: an intersection is an overload set only when EVERY
 * member is a signature. A mixed intersection (`((number) -> real) &
 * list<boolean>`) is not a callable overload set, and returning `undefined`
 * keeps today's behavior for it rather than inventing a meaning.
 */
export function overloadArms(
  t: Readonly<Type> | undefined
): ReadonlyArray<FunctionSignature> | undefined {
  if (!t || typeof t === 'string') return undefined;
  // Only an INTERSECTION is an overload set. A union of signatures is a value
  // that is one of those functions without saying which — a call site can rely
  // on none of them individually, so it must not be resolved to an arm.
  if (t.kind !== 'intersection') return undefined;
  return signatureArms(t);
}

/**
 * The parameter an arm would bind to operand `index` — the consumption order of
 * `validateArguments`' three loops.
 *
 * Re-exported from `instantiate.ts`, which owns the single definition shared
 * with `parameterPositions` (the tabulated form the generic solver and Design
 * D's contextual callback pass read).
 */
export { paramAt };

/**
 * **R-D4 — resolve-then-stamp** (ruled 2026-08-09), at ARM granularity: the
 * single arm of an overload set that a Design D contextual stamp runs against,
 * or `undefined` when the application does not resolve to exactly one.
 *
 * Resolution runs BEFORE the stamp and uses only signals available before any
 * operand is boxed — the pass's whole contract is that the callback literal
 * canonicalizes once, already annotated:
 *
 * 1. **arity** — an arm that cannot take this many operands is not a
 *    candidate;
 * 2. **the contextual slot** — an arm that declares no `callback<S>` cannot be
 *    stamped against at all, so it is not a candidate either. This is what
 *    makes `Map`'s two clauses (§6) resolve for free: at arity 2 only the
 *    unary clause declares a slot, and at arity ≥ 3 only the variadic clause
 *    survives the arity filter — and it declares none, which is exactly the
 *    re-ruled "the variadic form is NOT stamped".
 * 3. **the COMPETING arms** — filtering to the callback-bearing arms in step 2
 *    would otherwise let a stamp run while resolution has not actually chosen
 *    that arm: an overload with one contextual arm plus another arity-viable
 *    arm whose slot could equally take the function operand is genuinely
 *    ambiguous, and the operand's own type — which the stamp runs before
 *    reading — is what would decide it. So every OTHER arity-viable arm must
 *    provably be unable to accept a function at each slot the candidate
 *    declares contextual; otherwise the stamp declines. This is the
 *    arm-granularity twin of `contextualSlotCallback`'s union-sibling rule, and
 *    it is what `Partition`-shaped disjointness (`integer` vs `function`) still
 *    passes.
 *
 * Ambiguity DECLINES (two candidate arms leave the stamp unrun), and so does a
 * set no arm of which declares a slot — which is every user-defined overload
 * set, keeping their ratified conservative skip.
 *
 * Write-free, and box-free by construction: nothing here reads an operand.
 */
export function resolveContextualArm(
  arms: ReadonlyArray<FunctionSignature>,
  count: number
): FunctionSignature | undefined {
  let found: FunctionSignature | undefined;
  for (const arm of arms) {
    if (!arityAdmits(arm, count)) continue;
    if (!hasCallbackParam(arm)) continue;
    if (found !== undefined) return undefined;
    found = arm;
  }
  if (found === undefined) return undefined;

  // Step 3: the contextual slots of the candidate, and what every competing arm
  // puts there.
  const slots: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = paramAt(found, i);
    if (p !== undefined && contextualSlotCallback(p) !== undefined)
      slots.push(i);
  }
  for (const arm of arms) {
    if (arm === found) continue;
    if (!arityAdmits(arm, count)) continue;
    for (const i of slots)
      if (!provablyRejectsFunction(paramAt(arm, i))) return undefined;
  }

  return found;
}

/** Could a competing arm take a `Function` operand at this slot? Answered
 * conservatively — `undefined` (no such parameter) and an OPEN type both count
 * as "could", the latter because nothing says a function does not inhabit a
 * variable (and `provablyDisjoint` asserts on an open input). */
function provablyRejectsFunction(t: Type | undefined): boolean {
  if (t === undefined) return false;
  if (freeTypeVariables(t).size > 0) return false;
  return provablyDisjoint(t, 'function');
}

/**
 * True when `sig` can accept exactly `n` arguments. Mirrors how
 * `validateArguments` consumes operands: required parameters first, then
 * optional ones, then the remainder to the variadic parameter (which must
 * receive at least `variadicMin`).
 */
function arityAdmits(sig: FunctionSignature, n: number): boolean {
  const { min, max } = arityBounds(sig);
  return n >= min && n <= max;
}

/**
 * The inclusive range of argument counts `sig` accepts. `max` is `Infinity`
 * for a variadic signature.
 *
 * Note the variadic minimum stacks on top of the OPTIONAL parameters, not just
 * the required ones: `validateArguments` fills `optArgs` before it starts
 * feeding the variadic parameter, so a signature with 1 required, 2 optional
 * and `variadicMin: 1` needs 4 arguments before the variadic slot is
 * satisfied.
 */
function arityBounds(sig: FunctionSignature): { min: number; max: number } {
  const required = sig.args?.length ?? 0;
  const optional = sig.optArgs?.length ?? 0;
  if (sig.variadicArg) {
    const variadicMin = sig.variadicMin ?? 0;
    // `variadicMin: 0` (the `T*` form) imposes nothing, so the optional
    // parameters stay optional and `required` alone suffices. A positive
    // minimum (`T+`) must clear the optional parameters first, since those
    // are filled before the variadic slot receives anything.
    return {
      min: variadicMin > 0 ? required + optional + variadicMin : required,
      max: Infinity,
    };
  }
  return { min: required, max: required + optional };
}

/**
 * A write-free version of the `devolveUnappliedOperator` repair's
 * precondition: a bare single-uppercase symbol bound to a standard-library
 * operator (`N`, `D`) used where a value is required almost always means a
 * variable. `validateArguments` repairs such an operand (by declaring a
 * shadow), so the filter must not refute an arm on its account — but the
 * filter cannot perform the declaration itself (§4.2).
 *
 * Stays in lockstep with `devolveUnappliedOperator`: the operand must be bound
 * to an OPERATOR definition, and a value binding counts only when the repair
 * itself created it (a user-declared symbol keeps its declared-type check).
 */
function isRepairableOperatorSymbol(
  ce: ComputeEngine,
  op: Expression
): boolean {
  if (!isSymbol(op)) return false;
  const name = op.symbol;
  if (!/^[A-Z]$/.test(name)) return false;
  if (!op.operatorDefinition) return false;
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope && !scope.bindings.has(name)) scope = scope.parent;
  if (!scope) return false;
  // Use the tagged union's discriminant directly: importing the general
  // definition guards from `./utils.js` would close a runtime cycle.
  const def = scope.bindings.get(name)!;
  if (!scope.parent) return 'operator' in def;
  return 'value' in def && def.value._isDevolvedShadow === true;
}

/** The caller policies the filter must mirror to stay faithful to
 * `validateArguments`. Each is optional; omitting one makes the corresponding
 * gate inactive, exactly as it is inactive for a caller that does not pass it.
 */
export interface AdmissionPolicies {
  lazy?: boolean;
  /** Per-position for a declared `broadcastable<T>` signature — see
   * {@link Threadable}. */
  threadable?: Threadable;
  couldBeCollection?: (op: Expression) => boolean;
  /** Strip-before-validate eligibility, per operand index (§3.B). */
  stripMissing?: (index: number) => boolean;
  /** Write-free precondition of the fresh-matrix-inference repair. */
  freshMatrixRepair?: (op: Expression, param: Type) => boolean;
}

/**
 * True when `op` does not REFUTE `param` — the write-free admission rule the
 * arm filter uses.
 *
 * This must mirror `validateArguments`' admission gates **exactly**, in both
 * directions, and the reason is subtler than "permissive is safe":
 *
 * - Admitting too LITTLE drops an arm full validation would have accepted, so
 *   a legal call is reported as matching no overload.
 * - Admitting too MUCH is *not* harmless. It only widens the §4.3 join (safe),
 *   but it also keeps a bad arm in the running for SELECTION — and a wrongly
 *   selected arm is then handed to full validation, which rejects it, even
 *   though another arm would have validated cleanly.
 *
 * So every gate below carries the same conditions as its counterpart rather
 * than a convenient over-approximation.
 *
 * `param` is always GROUND: every caller runs the arm through
 * {@link instantiateArm} first (§4.1 per-arm instantiation), which is also what
 * keeps an open pattern out of `overlapsForDeferredValidation`/`typeCategory`,
 * whose §4.2 tripwires assert on `kind: 'variable'`.
 */
function operandAdmits(
  ce: ComputeEngine,
  op: Expression,
  param: Type,
  index: number,
  policies?: AdmissionPolicies
): boolean {
  // An already-invalid operand must not get a vote: let full validation
  // surface its own error rather than reporting "no matching overload".
  if (!op.isValid) return true;

  // A lazy operator's operands arrive unbound, so their types are not
  // meaningful — `validateArguments` pushes them through untouched.
  if (policies?.lazy) return true;

  // An unknown/`any` operand never refutes an arm (`validate.ts:621-626`).
  // This is why ambiguity is always "eliminated nothing", never "picked
  // wrong" (§4.1).
  if (op.type.isUnknown || op.type.type === 'any') return true;

  if (
    isThreadableAt(policies?.threadable, index) &&
    policies?.couldBeCollection?.(op)
  )
    return true;
  if (op.type.matches(param)) return true;

  // Value-component parameter: tri-state admission — MIRRORS the
  // `validateArguments` fallback (the filter must admit exactly what
  // validation admits, both ways): membership or undecidability admits,
  // only proven refutation drops the arm.
  if (hasValueComponent(param) && admissionOf(op, param) !== 'refute')
    return true;

  // An inferred (not declared) symbol type that the parameter would narrow —
  // except on the effect axis, where `validateArguments` declines to narrow
  // (`narrowingPreservesEffects`), and except a value-component parameter,
  // to which `validateArguments` also declines to narrow (a call does not
  // prove the symbol always holds the value).
  if (
    op.valueDefinition?.inferredType &&
    isSubtype(param, op.type.type) &&
    !hasValueComponent(param) &&
    narrowingPreservesEffects(op.type.type, param)
  )
    return true;

  // Mirrors `validateArguments`: an inferred SIGNATURE is admitted only when
  // the operand's type actually matches the parameter. Dropping the second
  // conjunct would admit a function-typed operand against a scalar parameter.
  if (op.operatorDefinition?.inferredSignature && op.type.matches(param))
    return true;

  if (broadcastableBaseMatches(op.type.type, param)) return true;

  // Strip-before-validate (§3.B of the missing-value design). Mirrors
  // `strippedMatchesParam`: the position must be ELIGIBLE per the caller's
  // policy, the operand must carry a `missing` arm, and the stripped type must
  // still satisfy the parameter. Admitting every `missing`-carrying operand
  // outright would let an arm that full validation rejects win selection.
  if (policies?.stripMissing?.(index) && typeContainsMissing(op.type.type)) {
    const stripped = stripMissingFromType(op.type.type);
    if (stripped === 'never' || isSubtype(stripped, param)) return true;
  }

  // Overlap-deferred validation (§D6.2).
  if (overlapsForDeferredValidation(op.type.type, param)) return true;

  if (isRepairableOperatorSymbol(ce, op)) return true;

  // The fresh-matrix-inference repair can rescue an operand that no static
  // check admits. The repair itself mutates and re-boxes, so the filter can
  // only consult its write-free precondition — conservative in the admitting
  // direction, which is the correct bias here (a repair that then fails leaves
  // full validation to produce the error, exactly as for a plain signature).
  if (policies?.freshMatrixRepair?.(op, param)) return true;

  return false;
}

/** A GROUND view of one arm at one call (§4.1 per-arm instantiation). */
interface ArmInstance {
  /** The arm as DECLARED — a polytype arm keeps its `forall` clause. */
  declared: FunctionSignature;
  /** The arm with this call's solution substituted. Always ground. */
  instance: FunctionSignature;
  /** The solve that produced `instance`. `undefined` for a ground arm (no
   * clause, no solve). */
  solution: TypeInferenceResult | undefined;
  /** The arm carries a `forall` clause (D11's generic-vs-ground test). */
  generic: boolean;
  /** False when the instantiation itself is unsatisfiable — a violated
   * declared bound, or conflicting upper bounds. Such an arm is NOT viable;
   * `instance` is then the D6 bound-reading, which is what makes the §8
   * diagnosis name the declared bound rather than the solution that violated
   * it. */
  ok: boolean;
}

/** Does this arm carry a `forall` clause? O(1) — the gate that keeps a ground
 * overload set on the pre-generics path. */
function isGenericArm(arm: FunctionSignature): boolean {
  return arm.typeParams !== undefined && arm.typeParams.length > 0;
}

/**
 * `arm`, instantiated at this call (type-variables design §4.1/§6).
 *
 * Each arm is solved **independently**: the clause is per-arm, so the same
 * letter in two arms is two unrelated variables. Admissibility and specificity
 * are then computed on the INSTANTIATED arms — `isSubtype` answers `false` for
 * an open pattern, so comparing declared arms would report every generic arm
 * incomparable and silently fall through to declaration order.
 *
 * Write-free (the solver is), and O(1) for a ground arm: no clause, no solve,
 * and the instance is the arm itself.
 */
function instantiateArm(
  arm: FunctionSignature,
  ops: ReadonlyArray<Expression>,
  policies?: AdmissionPolicies
): ArmInstance {
  if (!isGenericArm(arm))
    return {
      declared: arm,
      instance: arm,
      solution: undefined,
      generic: false,
      ok: true,
    };

  const solved = solveArm(arm, ops, {
    threadable: policies?.threadable,
    stripMissing: policies?.stripMissing,
    lazy: policies?.lazy,
  });

  // Substitution of a signature preserves its kind, so both branches below are
  // signatures.
  if (solved.failures.length > 0)
    return {
      declared: arm,
      instance: readTypeVariablesAsBounds(arm) as FunctionSignature,
      solution: solved,
      generic: true,
      ok: false,
    };

  const substituted = substituteTypeVariables(arm, solved.bindings);
  // The solver is total, so a residue is unreachable — but an open type must
  // never reach `isSubtype`/`matches` (§4.2), so read any survivor as its
  // bound rather than assuming.
  const ground =
    freeTypeVariables(substituted).size === 0
      ? substituted
      : readTypeVariablesAsBounds(substituted);
  return {
    declared: arm,
    instance: ground as FunctionSignature,
    solution: solved,
    generic: true,
    ok: true,
  };
}

/**
 * Every arm of `arms` in its GROUND form at this call — index-aligned with
 * `arms`, and `arms` itself (no allocation, no solve) when no arm is generic.
 *
 * For the callers that must rank or JOIN over the WHOLE declared set rather
 * than over `resolveOverload`'s `viable` subset — the value-arm tri-state
 * dispatch in `resolvedArm`, whose `nonRefuted` set is indexed against the
 * declared arms. Ranking or widening on the DECLARED arms there would hand an
 * open pattern to `isSubtype`/`widen`, which the §4.2 ground invariant forbids.
 */
export function instantiateArms(
  arms: ReadonlyArray<FunctionSignature>,
  ops: ReadonlyArray<Expression>,
  policies?: AdmissionPolicies
): ReadonlyArray<FunctionSignature> {
  if (!arms.some(isGenericArm)) return arms;
  return arms.map((arm) => instantiateArm(arm, ops, policies).instance);
}

/**
 * How `a`'s ARGUMENT types compare to `b`'s at this call:
 *
 * - `'more'` — every position is a subtype of `b`'s and at least one is
 *   strictly so: `a` is more specific;
 * - `'equal'` — every position is mutually interchangeable: a tie;
 * - `undefined` — incomparable (a position where neither is a subtype, or a
 *   slot only one arm binds).
 */
function argSpecificity(
  a: FunctionSignature,
  b: FunctionSignature,
  arity: number
): 'more' | 'equal' | undefined {
  let strict = false;
  for (let i = 0; i < arity; i++) {
    const pa = paramAt(a, i);
    const pb = paramAt(b, i);
    // A missing slot on either side means the arms bind this call differently;
    // they are not comparable on specificity.
    if (pa === undefined || pb === undefined) return undefined;
    if (!isSubtype(pa, pb)) return undefined;
    if (!isSubtype(pb, pa)) strict = true;
  }
  return strict ? 'more' : 'equal';
}

/**
 * True when `a` is strictly more specific than `b`: every position's parameter
 * is a subtype of `b`'s, and the two are not mutually interchangeable. A
 * partial order — incomparable arms are ordered by declaration instead.
 *
 * **Effects break ties only** (`docs/EFFECTS-MODEL.md`, "Overloads"): when the
 * two arms are already equally specific by ARGUMENT type, a subset effect set
 * is more specific. Incomparable effect sets (`{random}` vs `{scope}`) are not
 * compared and fall through to the existing declaration-order tie-break — which
 * is why this returns `false` for them rather than an ordering.
 */
export function isMoreSpecific(
  a: FunctionSignature,
  b: FunctionSignature,
  arity: number
): boolean {
  const byArgs = argSpecificity(a, b, arity);
  if (byArgs === 'more') return true;
  if (byArgs !== 'equal') return false;
  return (
    isEffectSubset(a.effects, b.effects) &&
    !isEffectSubset(b.effects, a.effects)
  );
}

/**
 * Does `a` beat `b` at this call? Specificity is compared on the INSTANTIATED
 * arms (§6 of the type-variables design).
 *
 * **D11 — generic-vs-ground tie (RULED ground-wins).** When the two arms are
 * IDENTICAL after instantiation (`(forall T. (T) -> T) & ((integer) ->
 * integer)` at an `integer` operand), the GROUND declaration wins: "most
 * specific declaration" is why an author writes the specialized arm at all
 * (distinct handler, distinct effects). Without the rule, resolution falls
 * through to declaration order and order-independence breaks silently — §11
 * pins the tie with the arms declared in both orders.
 *
 * The rule is a TIE-break only: an instantiated-generic arm that is strictly
 * more specific by arguments, or by effects (`isMoreSpecific(b, a)` below),
 * still wins.
 */
function outranks(a: ArmInstance, b: ArmInstance, arity: number): boolean {
  if (isMoreSpecific(a.instance, b.instance, arity)) return true;
  return (
    !a.generic &&
    b.generic &&
    argSpecificity(a.instance, b.instance, arity) === 'equal' &&
    !isMoreSpecific(b.instance, a.instance, arity)
  );
}

/**
 * Resolve an application of `arms` to `ops` (§3 of the design): filter by
 * arity, instantiate each arm independently (§4.1 — a ground arm instantiates
 * to itself, at no cost), filter by operand type, then rank the survivors
 * most-specific-first, tie-breaking by D11 and then by declaration order.
 *
 * Never writes. `selected` is `undefined` exactly when `viable` is empty.
 */
export function resolveOverload(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>,
  policies?: AdmissionPolicies
): OverloadResolution {
  const arity = ops.length;

  // Note `operandAdmits` handles `lazy` itself (a lazy operator's operands are
  // unbound, so their types are not meaningful and refute nothing). Keeping
  // that inside the single admission rule is what makes the filter and the
  // diagnostic agree.

  // A GROUND overload set — every set in the library today — takes the
  // original path verbatim: no instantiation, no per-arm bookkeeping, and D11
  // cannot apply (it needs a generic arm). The gate is one flag read per arm.
  // A pure SPECIALIZATION of the general path below, not a second policy:
  // `instantiateArm` is the identity on a ground arm and `outranks` reduces to
  // `isMoreSpecific` when no arm is generic.
  if (!arms.some(isGenericArm)) {
    const viable = arms.filter(
      (arm) =>
        arityAdmits(arm, arity) &&
        ops.every((op, i) => {
          const param = paramAt(arm, i);
          return (
            param !== undefined && operandAdmits(ce, op, param, i, policies)
          );
        })
    );
    if (viable.length === 0)
      return {
        selected: undefined,
        selectedInstance: undefined,
        selectedSolution: undefined,
        viable,
      };
    let selected = viable[0];
    for (let i = 1; i < viable.length; i++)
      if (isMoreSpecific(viable[i], selected, arity)) selected = viable[i];
    return {
      selected,
      selectedInstance: selected,
      selectedSolution: undefined,
      viable,
    };
  }

  const candidates: ArmInstance[] = [];
  for (const arm of arms) {
    if (!arityAdmits(arm, arity)) continue;
    const candidate = instantiateArm(arm, ops, policies);
    // An unsatisfiable instantiation (violated bound) is not an arm this call
    // can take.
    if (!candidate.ok) continue;
    const admits = ops.every((op, i) => {
      const param = paramAt(candidate.instance, i);
      return param !== undefined && operandAdmits(ce, op, param, i, policies);
    });
    if (admits) candidates.push(candidate);
  }

  if (candidates.length === 0)
    return {
      selected: undefined,
      selectedInstance: undefined,
      selectedSolution: undefined,
      viable: [],
    };

  // Rank: the first arm not beaten by any other wins. Scanning in declaration
  // order makes the tie-break fall out for free.
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++)
    if (outranks(candidates[i], best, arity)) best = candidates[i];

  return {
    selected: best.declared,
    selectedInstance: best.instance,
    selectedSolution: best.solution,
    viable: candidates.map((c) => c.instance),
  };
}

/**
 * Tri-state admission of a whole arm for a call
 * (function-polymorphism design §4.4): refuted on arity, else the fold of
 * per-position `admissionOf`. ONE implementation shared by static result
 * typing (`resolvedArm`'s value-arm JOIN) and the runtime clause selector
 * (`multi-clause.ts`), so the two cannot diverge. Write-free.
 */
export function armAdmission(
  ops: ReadonlyArray<Expression>,
  arm: FunctionSignature
): Admission {
  if (!arityAdmits(arm, ops.length)) return 'refute';
  let undecidable = false;
  for (let i = 0; i < ops.length; i++) {
    const param = paramAt(arm, i);
    if (param === undefined) return 'refute';
    const a = admissionOf(ops[i], param);
    if (a === 'refute') return 'refute';
    if (a === 'undecidable') undecidable = true;
  }
  return undecidable ? 'undecidable' : 'admit';
}

/** Does any PARAMETER of this arm carry a value-kind/bounded-numeric
 * component (so tri-state admission can answer differently from the boolean
 * filter)? */
export function armHasValueParam(arm: FunctionSignature): boolean {
  return [
    ...(arm.args ?? []),
    ...(arm.optArgs ?? []),
    ...(arm.variadicArg ? [arm.variadicArg] : []),
  ].some((p) => hasValueComponent(p.type));
}

/**
 * Tri-state selection over a set of arms (function-polymorphism design
 * §4.4) — THE shared dispatch decision, consumed by static result typing
 * (`resolvedArm`) and the runtime clause selector (`multi-clause.ts`):
 *
 * - `{ kind: 'selected', index }` — dispatch is DECIDED: the most-specific
 *   admitted arm (declaration order breaks ties), and no undecidable arm
 *   could outrank or tie it.
 * - `{ kind: 'blocked', nonRefuted }` — some undecidable arm could outrank
 *   or tie the best admitted arm (or nothing is admitted but something is
 *   undecidable): the call cannot commit; any non-refuted arm may win at
 *   runtime.
 * - `{ kind: 'none' }` — every arm is refuted.
 *
 * Write-free.
 */
export function triStateSelect(
  ops: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>
):
  | { kind: 'selected'; index: number }
  | { kind: 'blocked'; nonRefuted: number[] }
  | { kind: 'none' } {
  const admissions = arms.map((a) => armAdmission(ops, a));

  let best = -1;
  for (let i = 0; i < arms.length; i++) {
    if (admissions[i] !== 'admit') continue;
    if (best < 0 || isMoreSpecific(arms[i], arms[best], ops.length)) best = i;
  }

  // An undecidable arm blocks unless the best admitted arm is STRICTLY more
  // specific than it (dispatching a fallback while a more-specific value
  // arm is unresolved is the symbolic-divergence failure the design
  // rejects).
  let blocked = false;
  for (let i = 0; i < arms.length; i++) {
    if (admissions[i] !== 'undecidable') continue;
    if (best < 0 || !isMoreSpecific(arms[best], arms[i], ops.length)) {
      blocked = true;
      break;
    }
  }

  if (!blocked && best >= 0) return { kind: 'selected', index: best };
  const nonRefuted: number[] = [];
  for (let i = 0; i < arms.length; i++)
    if (admissions[i] !== 'refute') nonRefuted.push(i);
  if (nonRefuted.length === 0) return { kind: 'none' };
  return { kind: 'blocked', nonRefuted };
}

/**
 * Diagnose a call that no arm accepts, so the caller can blame the operands
 * actually at fault instead of the whole list.
 *
 * - `arityViable` — the arms that accept `ops.length` arguments. Empty means
 *   the call failed on arity alone; `arityTarget` then says what to do.
 * - `arityTarget` — the argument count of the nearest arm, when the call failed
 *   on arity. Fewer than `ops.length` → the surplus operands are unexpected;
 *   more → the call is short and must be padded.
 * - `refuted` — index → the parameter type expected there, for the positions
 *   the diagnosis blames.
 *
 * **Blame is computed per ARM, never per column.** The obvious per-column rule
 * — "blame position `i` when no arm admits it" — is not the negation of the
 * selection rule, which requires ONE arm to admit EVERY position. When two arms
 * cross-satisfy a call (each rejects a different position, but every position
 * is admitted by someone) the per-column rule blames nothing, and a call that
 * no arm accepts is returned with all operands intact — reported valid, since
 * `isValid` is purely structural. That is the exact failure this feature exists
 * to catch.
 *
 * Instead: score every arity-viable arm by how many positions it refutes, keep
 * the arms that refute the fewest (the nearest misses), and blame the union of
 * THEIR refuted positions. Since no arm fits, every candidate refutes at least
 * one position, so the union is never empty and at least one error marker is
 * always emitted. Each blamed position reports the join of the parameters the
 * candidates expect there, which keeps the single-culprit diagnostics precise:
 * `Rnd([1,2,3], "x")` blames only the seed, and `Rnd("x")` still reports the
 * full `collection | number | set<real>`.
 */
export function diagnoseNoMatch(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>,
  options?: AdmissionPolicies
): {
  arityViable: ReadonlyArray<FunctionSignature>;
  arityTarget: number | undefined;
  refuted: ReadonlyMap<number, Type>;
} {
  const arityViable = arms.filter((a) => arityAdmits(a, ops.length));

  if (arityViable.length === 0) {
    // Failed on arity. Pick the nearest accepted count — NOT the global
    // min/max, which leaves a GAP unmarked: arms of arity 1 and 3 called with
    // 2 arguments sit inside [min, max] and would be waved through.
    let arityTarget: number | undefined;
    let best = Infinity;
    for (const arm of arms) {
      const { min, max } = arityBounds(arm);
      // The count this arm would need, clamped to its accepted range.
      const target = ops.length < min ? min : max;
      const distance = Math.abs(target - ops.length);
      // Ties prefer the SHORTER call (mark the surplus) over demanding more
      // arguments, and declaration order breaks a remaining tie.
      if (
        distance < best ||
        (distance === best && target < (arityTarget ?? 0))
      ) {
        best = distance;
        arityTarget = target;
      }
    }
    return { arityViable, arityTarget, refuted: new Map() };
  }

  // Score each arm by the positions it refutes; keep the nearest misses. As in
  // `resolveOverload`, each arm is scored on its INSTANTIATION at this call, so
  // the reported "expected" type is ground (§8 rule 1) — and an arm whose
  // instantiation failed is scored on its bound-reading, which is what names
  // the violated declared bound.
  let fewest = Infinity;
  let candidates: { arm: FunctionSignature; refutes: number[] }[] = [];
  for (const declared of arityViable) {
    const arm = instantiateArm(declared, ops, options).instance;
    const refutes: number[] = [];
    ops.forEach((op, i) => {
      const param = paramAt(arm, i);
      if (param === undefined) return;
      if (!operandAdmits(ce, op, param, i, options)) refutes.push(i);
    });
    if (refutes.length < fewest) {
      fewest = refutes.length;
      candidates = [{ arm, refutes }];
    } else if (refutes.length === fewest) {
      candidates.push({ arm, refutes });
    }
  }

  const refuted = new Map<number, Type>();
  for (const { arm, refutes } of candidates) {
    for (const i of refutes) {
      const param = paramAt(arm, i);
      if (param === undefined) continue;
      const prior = refuted.get(i);
      refuted.set(i, prior === undefined ? param : widen(prior, param));
    }
  }
  return { arityViable, arityTarget: undefined, refuted };
}

/**
 * The type to infer into the operand at `index` (§4.3): the JOIN of the
 * surviving arms' parameters there.
 *
 * A call is well-typed iff the operand fits SOME viable arm, so the admissible
 * set at a position is exactly the union of those arms' parameters — no more,
 * no less. With a single viable arm this is definitionally that arm's
 * parameter, which keeps the single-signature path byte-identical.
 *
 * TRAP (§4.5): never the MEET, and never the most-specific candidate. That
 * would assume an arm was selected and over-constrain the symbol — if the
 * operand later proves to fit a different arm, the call is still legal but the
 * symbol has been narrowed past it. Inference constraints must be *weaker or
 * equal* to the truth.
 *
 * Known approximation (§4.6): computed per position independently, so the
 * result admits operand COMBINATIONS no single arm accepts. Imprecision, not
 * unsoundness — the constraint is weaker than the truth.
 */
export function joinParamAt(
  viable: ReadonlyArray<FunctionSignature>,
  index: number
): Type | undefined {
  const params: Type[] = [];
  for (const arm of viable) {
    const p = paramAt(arm, index);
    // A position no arm binds contributes nothing; a position only SOME arms
    // bind cannot be constrained at all (the others accept anything there by
    // not having a slot), so decline to infer.
    if (p === undefined) return undefined;
    params.push(p);
  }
  if (params.length === 0) return undefined;
  return params.length === 1 ? params[0] : widen(...params);
}
