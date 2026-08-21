import {
  isSubtype,
  provablyDisjoint,
  widen,
} from '../../common/type/subtype.js';
import { isEffectSubset } from '../../common/type/effects.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  freeTypeVariables,
  paramAt,
  readTypeVariablesAsBounds,
  substituteTypeVariables,
  type TypeInferenceResult,
} from '../../common/type/instantiate.js';
import {
  contextualSlotSignature,
  hasCallbackParam,
  isThreadableAt,
  solveArm,
  type Threadable,
} from './generic-instantiation.js';
import {
  narrowingPreservesEffects,
  signatureArms,
  typeContainsMissing,
} from '../../common/type/utils.js';
import type {
  FunctionSignature,
  Type,
  TypeResolver,
} from '../../common/type/types.js';
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
 * See `docs/TYPE-SYSTEM.md`. Two contracts
 * from that document govern everything here:
 *
 * - **§4.2 — resolution leaves no writes behind.** Nothing in this file
 *   mutates a symbol definition. Since phase 2c
 *   (`docs/TYPE-SYSTEM.md`) the guarantee is
 *   rollback-shaped rather than abstinence-shaped: admission may run a
 *   caller-supplied TRIAL ({@link ArmTrialFn}) — full `validateArguments`,
 *   whose in-loop `op._infer(param, 'narrow')` genuinely writes — but the
 *   caller runs each trial under a rollback frame that undoes every write
 *   whatever the verdict, so a rejected arm still leaves no trace. The
 *   trial-less paths (the cheap prefilter alone) remain write-free in the
 *   original, abstinence sense.
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
   * `where` clause; `undefined` when no arm fits. */
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
  /** NAMED CALLS ONLY (see the `named` parameter of {@link resolveOverload}):
   * the winning arm's permutation, source slot → declaration slot. `undefined`
   * for every all-positional call, where the permutation is the identity. */
  selectedPermutation?: number[];
  /** NAMED CALLS ONLY — sub-ruling R3: another arm survived whose permutation
   * of the written names DIFFERS from the winner's, and the winner does not
   * strictly outrank it. Selecting by declaration order would then also be
   * selecting an argument ORDER, so the caller must reject the call and steer
   * the author to a positional one. */
  permutationAmbiguous?: boolean;
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
 * 2. **the contextual slot** — an arm that declares no contextual arrow slot cannot be
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
    // Design E: a plain-arrow slot is a contextual slot too (§6b) — this must
    // agree with `hasCallbackParam` above, or a resolved arm's slots would be
    // enumerated empty and the competing-arm audit vacuously pass.
    if (p !== undefined && contextualSlotSignature(p) !== undefined)
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
export function arityBounds(sig: FunctionSignature): {
  min: number;
  max: number;
} {
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
 * True when a callback of type `opType` could be applied at SOME call arity
 * the slot arm supplies: the two arity ranges INTERSECT. Both are contiguous,
 * so this is the ordinary overlap test.
 *
 * An operand whose arity cannot be read — a bare `function`, a mixed union —
 * is conservatively CAPABLE: the check declines rather than guesses.
 */
export function armArityCapable(
  arm: FunctionSignature,
  opType: Type
): boolean {
  const opArms = signatureArms(opType);
  if (opArms === undefined) return true;
  const { min: lo, max: hi } = arityBounds(arm);
  return opArms.some((opArm) => {
    const { min: opLo, max: opHi } = arityBounds(opArm);
    return opLo <= hi && lo <= opHi;
  });
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
export function isRepairableOperatorSymbol(
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
  couldBeUnkeyedCollection?: (op: Expression) => boolean;
  /** Strip-before-validate eligibility, per operand index (§3.B). */
  stripMissing?: (index: number) => boolean;
  /** Write-free precondition of the fresh-matrix-inference repair. */
  freshMatrixRepair?: (op: Expression, param: Type) => boolean;
}

/**
 * The cheap PREFILTER: true unless `op` **provably** cannot satisfy `param`
 * (phase 2c of `docs/TYPE-SYSTEM.md`).
 *
 * This replaced the write-free mirror filter (`operandAdmits`, sixteen
 * mirrored gate conditions kept in lockstep with `validateArguments` by
 * hand). Under trial-based resolution the filter no longer needs to predict
 * what validation will decide — the TRIAL is `validateArguments` itself, run
 * under a rollback frame — so the only job left here is to prune arms that
 * cannot possibly fit, cheaply, before paying for a trial. Consequently the
 * rejection rule is minimal and PROOF-shaped:
 *
 * - reject only on `provablyDisjoint(operand type, param)` — sound by
 *   construction (true only when the intersection is provably empty), so
 *   every admission the old gates encoded by overlap (inferred-narrowing,
 *   value-membership undecidability, `broadcastable<T>` base match,
 *   overlap-deferred validation) is admitted here for free: overlapping
 *   types are never disjoint;
 * - and never on a slot the trial could still admit for a NON-type reason:
 *   a lazy operator (operands unbound), a threadable-collection operand, an
 *   invalid operand (full validation owns its error), an eligible
 *   strip-before-validate position, or an operand one of the two
 *   construction-level repairs' write-free preconditions rescues.
 *
 * This is also the ONLY admission rule on the trial-less cold path (result
 * typing via `resolvedArm` on a call that never validated): there the wider
 * candidate set is tolerated — result types JOIN over candidates.
 *
 * `param` is always GROUND: every caller runs the arm through
 * {@link instantiateArm} first (§4.1 per-arm instantiation), and
 * `provablyDisjoint` asserts on an open input.
 */
function prefilterAdmits(
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

  // An unknown/`any` operand never refutes an arm. This is why ambiguity is
  // always "eliminated nothing", never "picked wrong" (§4.1).
  if (op.type.isUnknown || op.type.type === 'any') return true;

  if (
    isThreadableAt(policies?.threadable, index) &&
    policies?.couldBeUnkeyedCollection?.(op)
  )
    return true;
  if (op.type.matches(param)) return true;

  // A value-component parameter (`0`, `integer<0..10>`) is refutable by
  // MEMBERSHIP, which the type-level disjointness test below cannot see: a
  // literal `1` overlaps the TYPE of the parameter `0` (`0 ⊆ finite_integer`)
  // while provably not being the value. `admissionOf`'s `'refute'` is a
  // proof of non-membership — the same tri-state the runtime clause dispatch
  // trusts (`armAdmission`) — so it is a legitimate "provably impossible"
  // rejection, and the named-argument faithfulness check
  // (`plainCallIsFaithful`) depends on it to keep a value-refuted clause out
  // of the candidate set.
  const valueRefuted =
    hasValueComponent(param) && admissionOf(op, param) === 'refute';

  // Effect-axis refutation (the deleted narrowing gate's DECLINING half): for
  // a callable operand that does not `matches(param)`, validation's only
  // admission route is the inferred-narrowing write, and validation declines
  // that narrow when it would erase proven effects
  // (`narrowingPreservesEffects` — a no-op unless both types are callable
  // with known arrows, so scalar operands never reach it). Trial-backed
  // resolution re-derives this verdict in full validation anyway; the
  // TRIAL-LESS consumers (the effects projection's per-application arm pick,
  // the named-argument seam) rely on this refutation so an arm whose effect
  // contract the operand cannot prove is never selected — selecting it would
  // report a call purer than its operand.
  const effectsRefuted =
    isSubtype(param, op.type.type) &&
    !narrowingPreservesEffects(op.type.type, param);

  if (
    !valueRefuted &&
    !effectsRefuted &&
    !provablyDisjoint(op.type.type, param)
  )
    return true;

  // Provably disjoint by TYPE. Three rescues remain, each a write-free
  // precondition of an admission full validation performs on other grounds:
  // a `missing`-carrying operand at a strip-eligible position (§3.B — a
  // scalar `Missing` strips to `never`, admissible everywhere), and the two
  // construction-level repairs.
  if (policies?.stripMissing?.(index) && typeContainsMissing(op.type.type))
    return true;
  if (isRepairableOperatorSymbol(ce, op)) return true;
  if (policies?.freshMatrixRepair?.(op, param)) return true;

  return false;
}

/**
 * A caller-supplied TRIAL of one arm at one call — the dependency inversion
 * that keeps `overload.ts` from importing `validate.ts` (which imports this
 * module): `resolveOverload` keeps its fused
 * instantiate/filter/rank loop, and `validateArguments` passes a closure that
 * runs ITSELF on the single arm, in trial mode, under a repair-forbidding
 * rollback frame — so the trial's inference writes are undone whatever the
 * outcome, and its verdict is exactly full validation's.
 *
 * Returns `null` when the arm ADMITS the call, or the operand indices (in
 * the arm's own — permuted, for a named call — order) the validation
 * refuted. The indices feed `diagnoseNoMatch`'s per-arm blame; admission
 * consumes only the null/non-null bit.
 */
export type ArmTrialFn = (
  declared: FunctionSignature,
  instance: FunctionSignature,
  solution: TypeInferenceResult | undefined,
  ops: ReadonlyArray<Expression>
) => ReadonlyArray<number> | null;

/**
 * True when this arm's trial is PROVABLY a pass, so the trial — a full
 * `validateArguments` run under a rollback frame — can be skipped without
 * changing the verdict. This is a proof, not a mirror: `op.type.matches
 * (param)` is validation's own unconditional first admit at every position
 * (required, optional and variadic loops alike), so an arity-admitted GROUND
 * instance whose valid operands all plainly match cannot fail validation —
 * and a LAZY operator's validation pushes every operand through untouched,
 * so its trial cannot fail either. Anything short of the proof (an invalid
 * operand, a non-matching position, a slot the arm does not bind) falls
 * through to the real trial.
 *
 * This is what keeps the exact-match fast path — the overwhelmingly common
 * call shape, and the one the pre-trial filter handled cheapest — at
 * near-filter cost: the trial machinery is paid for only by calls whose
 * admission is genuinely undecidable without validation.
 *
 * A GENERIC candidate is safe here too: the caller only consults this after
 * `instantiateArm` succeeded (`candidate.ok` — no bound failures), the trial
 * reuses that same solve verbatim (`internals.armSolution`), and `instance`
 * is its ground substitution — the same parameters validation's
 * `groundParam` projection produces.
 */
function trialGuaranteedToPass(
  ops: ReadonlyArray<Expression>,
  instance: FunctionSignature,
  policies?: AdmissionPolicies
): boolean {
  if (policies?.lazy) return true;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op.isValid) return false;
    const param = paramAt(instance, i);
    if (param === undefined) return false;
    if (!op.type.matches(param)) return false;
    // A match is NOT a proof at an arrow-typed slot NO ARM of which can apply
    // the callback. Subtyping does not settle arity at such a slot: an arm
    // with an optional or variadic tail admits a callback wider than any call
    // it can make (`(number, number, number) -> number` is a subtype of
    // `(number, number?) -> number`), yet validation rejects that callback as
    // inapplicable. Proving the trial away on the strength of the match made
    // the arm viable, and being the more specific one it then WON, so the
    // call reported an arity error instead of resolving to a sibling arm that
    // does accept the callback. Only the arity question is asked here: a slot
    // arm that CAN apply the callback keeps the fast path, so a mismatch
    // anywhere else in the arrow still proves away exactly as it used to.
    const slotArms = signatureArms(param);
    if (
      slotArms !== undefined &&
      !slotArms.some((arm) => armArityCapable(arm, op.type.type))
    )
      return false;
  }
  return true;
}

/** A GROUND view of one arm at one call (§4.1 per-arm instantiation). */
interface ArmInstance {
  /** The arm as DECLARED — a polytype arm keeps its `where` clause. */
  declared: FunctionSignature;
  /** The arm with this call's solution substituted. Always ground. */
  instance: FunctionSignature;
  /** The solve that produced `instance`. `undefined` for a ground arm (no
   * clause, no solve). */
  solution: TypeInferenceResult | undefined;
  /** The arm carries a `where` clause (D11's generic-vs-ground test). */
  generic: boolean;
  /** False when the instantiation itself is unsatisfiable — a violated
   * declared bound, or conflicting upper bounds. Such an arm is NOT viable;
   * `instance` is then the D6 bound-reading, which is what makes the §8
   * diagnosis name the declared bound rather than the solution that violated
   * it. */
  ok: boolean;
  /** NAMED CALLS ONLY: this arm's map from the call's SOURCE slot (the
   * argument as written) to the declaration slot its name selects. `undefined`
   * for an all-positional call, where the map is the identity and every
   * position lookup below stays what it was. */
  permutation?: number[];
}

/** `ops` reordered into `permutation`'s target order: the operand written at
 * source slot `j` moves to declaration slot `permutation[j]`. A named call's
 * per-arm normalization guarantees a bijection over `[0, ops.length)`, so the
 * result has no holes. */
function permuteOps(
  ops: ReadonlyArray<Expression>,
  permutation: ReadonlyArray<number>
): ReadonlyArray<Expression> {
  const out = new Array<Expression>(ops.length);
  for (let j = 0; j < ops.length; j++) out[permutation[j]] = ops[j];
  return out;
}

/** Do two arms consume the written arguments in the same order? Two
 * `undefined`s (a positional call) agree by definition. */
function samePermutation(
  a: ReadonlyArray<number> | undefined,
  b: ReadonlyArray<number> | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * A named call's per-arm normalization, index-aligned with the `arms` passed to
 * {@link resolveOverload}: entry `k` is arm `k`'s permutation (source slot →
 * declaration slot), or `undefined` when the written names make that arm
 * INADMISSIBLE (an unknown name, a duplicate, an unsaturated required
 * parameter, an optional hole). Name compatibility filters arms BEFORE type
 * admission, mirroring the arity pre-filter.
 *
 * `docs/LANGUAGE-MODEL.md` Computed by
 * `named-arguments.ts`, which owns the per-arm algorithm; this module only
 * consumes the result.
 */
export type NamedCallPermutations = ReadonlyArray<number[] | undefined>;

/** Does this arm carry a `where` clause? O(1) — the gate that keeps a ground
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
  policies?: AdmissionPolicies,
  /** The conformance oracle for a `where T is P` slot — the CALLING engine's
   * resolver (protocols design P19). */
  resolver?: TypeResolver
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
    resolver,
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
  policies?: AdmissionPolicies,
  /** See {@link instantiateArm}: the calling engine's conformance oracle. */
  resolver?: TypeResolver
): ReadonlyArray<FunctionSignature> {
  if (!arms.some(isGenericArm)) return arms;
  return arms.map(
    (arm) => instantiateArm(arm, ops, policies, resolver).instance
  );
}

/**
 * How `a`'s ARGUMENT types compare to `b`'s at this call:
 *
 * - `'more'` — every position is a subtype of `b`'s and at least one is
 *   strictly so: `a` is more specific;
 * - `'equal'` — every position is mutually interchangeable: a tie;
 * - `undefined` — incomparable (a position where neither is a subtype, or a
 *   slot only one arm binds).
 *
 * The loop runs over the call's SOURCE slots — the arguments as the author
 * wrote them — not over declaration positions, because the two arms may bind
 * the same written argument to differently placed parameters. `permA`/`permB`
 * (source slot → declaration slot, from a named call's per-arm normalization)
 * translate; a positional call passes neither and every lookup is `paramAt(·,
 * i)`, exactly as before named arguments existed.
 */
function argSpecificity(
  a: FunctionSignature,
  b: FunctionSignature,
  arity: number,
  permA?: ReadonlyArray<number>,
  permB?: ReadonlyArray<number>
): 'more' | 'equal' | undefined {
  let strict = false;
  for (let i = 0; i < arity; i++) {
    const pa = paramAt(a, permA === undefined ? i : permA[i]);
    const pb = paramAt(b, permB === undefined ? i : permB[i]);
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
  arity: number,
  /** See {@link argSpecificity}: each arm's source-slot → declaration-slot map
   * for a named call. Omitted for a positional call. */
  permA?: ReadonlyArray<number>,
  permB?: ReadonlyArray<number>
): boolean {
  const byArgs = argSpecificity(a, b, arity, permA, permB);
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
 * IDENTICAL after instantiation (`((T) -> T where T) & ((integer) ->
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
  const pa = a.permutation;
  const pb = b.permutation;
  if (isMoreSpecific(a.instance, b.instance, arity, pa, pb)) return true;
  return (
    !a.generic &&
    b.generic &&
    argSpecificity(a.instance, b.instance, arity, pa, pb) === 'equal' &&
    !isMoreSpecific(b.instance, a.instance, arity, pb, pa)
  );
}

/**
 * Resolve an application of `arms` to `ops` (§3 of the design): filter by
 * arity, instantiate each arm independently (§4.1 — a ground arm instantiates
 * to itself, at no cost), filter by operand type, then rank the survivors
 * most-specific-first, tie-breaking by D11 and then by declaration order.
 *
 * Never writes. `selected` is `undefined` exactly when `viable` is empty.
 *
 * **Named calls (§4).** With `named`, `ops` is the call as WRITTEN and each arm
 * consumes its own permutation of it: admission and generic solving run on the
 * arm's permuted operand array, and ranking compares the parameters that
 * receive the same written argument. `viable` is then a set of arms that need
 * not agree on which parameter sits at which source slot, so it must NOT be fed
 * to `joinParamAt` (whose index is a declaration position); the named caller
 * reads `selectedPermutation`, reorders the operands once, and every consumer
 * downstream sees an ordinary positional call.
 */
export function resolveOverload(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>,
  policies?: AdmissionPolicies,
  /** A named call's per-arm normalization; omitted for a positional call, which
   * then takes byte-identical code paths to the pre-feature ones. */
  named?: NamedCallPermutations,
  /** The trial admission (phase 2c): an arm that survives the cheap prefilter
   * is admitted iff its trial — full validation under a rollback frame,
   * supplied by `validateArguments` — returns `null`. Omitted on the
   * trial-less cold path (`resolvedArm` result typing), where the prefilter
   * alone decides and the wider candidate set is tolerated. */
  trial?: ArmTrialFn
): OverloadResolution {
  const arity = ops.length;

  // Note `prefilterAdmits` handles `lazy` itself (a lazy operator's operands
  // are unbound, so their types are not meaningful and refute nothing).
  // Keeping that inside the single admission rule is what makes the filter
  // and the diagnostic agree.

  // A GROUND overload set — every set in the library today — takes the
  // original path verbatim: no instantiation, no per-arm bookkeeping, and D11
  // cannot apply (it needs a generic arm). The gate is one flag read per arm.
  // A pure SPECIALIZATION of the general path below, not a second policy:
  // `instantiateArm` is the identity on a ground arm and `outranks` reduces to
  // `isMoreSpecific` when no arm is generic.
  //
  // A NAMED call skips the specialization and takes the general path below: it
  // needs per-arm permutations, which is exactly the per-arm bookkeeping this
  // shortcut exists to avoid. The gate reads `named` first, so a positional
  // call is unaffected.
  if (named === undefined && !arms.some(isGenericArm)) {
    const viable = arms.filter(
      (arm) =>
        arityAdmits(arm, arity) &&
        ops.every((op, i) => {
          const param = paramAt(arm, i);
          return (
            param !== undefined && prefilterAdmits(ce, op, param, i, policies)
          );
        }) &&
        // Trials run in declaration order inside the filter, after the cheap
        // prefilter — EVERY prefilter-surviving arm is trialed (not just up
        // to the first success), because `viable` must be complete for the
        // §4.3 join. An arm whose pass is PROVABLE (`trialGuaranteedToPass`)
        // skips the trial with the identical verdict.
        (trial === undefined ||
          trialGuaranteedToPass(ops, arm, policies) ||
          trial(arm, arm, undefined, ops) === null)
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
  for (let k = 0; k < arms.length; k++) {
    const arm = arms[k];
    const permutation = named?.[k];
    // A named call's name filter runs BEFORE arity and type admission: an arm
    // whose parameter names the call cannot fill is not a candidate at all.
    if (named !== undefined && permutation === undefined) continue;
    if (!arityAdmits(arm, arity)) continue;
    // Every index-keyed decision below — the generic solver's `actuals` array
    // and its `skip`/`inferable`/`lifted` callbacks, then the prefilter and
    // the trial — reads operands at DECLARATION positions, so the permutation
    // is applied here, once, before any of them runs.
    const armOps =
      permutation === undefined ? ops : permuteOps(ops, permutation);
    const candidate = instantiateArm(arm, armOps, policies, ce._typeResolver);
    // An unsatisfiable instantiation (violated bound) is not an arm this call
    // can take.
    if (!candidate.ok) continue;
    const admits =
      armOps.every((op, i) => {
        const param = paramAt(candidate.instance, i);
        return (
          param !== undefined && prefilterAdmits(ce, op, param, i, policies)
        );
      }) &&
      // The trial validates the DECLARED arm (validation re-instantiates it
      // through the shared solve, passed along so it is not recomputed). A
      // provable pass (`trialGuaranteedToPass`, on the ground instance)
      // skips it with the identical verdict.
      (trial === undefined ||
        trialGuaranteedToPass(armOps, candidate.instance, policies) ||
        trial(
          candidate.declared,
          candidate.instance,
          candidate.solution,
          armOps
        ) === null);
    if (admits) candidates.push({ ...candidate, permutation });
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

  // Sub-ruling R3: declaration order may break a tie between arms that consume
  // the written arguments in the SAME order — the pick is then only an
  // implementation. It may not break a tie between arms that consume them in
  // DIFFERENT orders, because that pick would silently choose which argument
  // goes to which parameter. Flag it and let the caller reject the call.
  const permutationAmbiguous =
    named !== undefined &&
    candidates.some(
      (c) =>
        c !== best &&
        !samePermutation(c.permutation, best.permutation) &&
        !outranks(best, c, arity)
    );

  return {
    selected: best.declared,
    selectedInstance: best.instance,
    selectedSolution: best.solution,
    viable: candidates.map((c) => c.instance),
    selectedPermutation: best.permutation,
    permutationAmbiguous,
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
 * **Named calls (§4).** With `named`, `ops` is the call as WRITTEN and each arm
 * is admitted and ranked on its OWN permutation of it, exactly as in
 * {@link resolveOverload}: an arm the written names cannot fill (no
 * permutation) is not a candidate at all, which is what makes sub-ruling R5's
 * elimination survive into dispatch. `index` still indexes `arms`.
 *
 * Write-free.
 */
export function triStateSelect(
  ops: ReadonlyArray<Expression>,
  arms: ReadonlyArray<FunctionSignature>,
  /** A named call's per-arm normalization; omitted for a positional call,
   * which then takes byte-identical code paths to the pre-feature ones. */
  named?: NamedCallPermutations
):
  | { kind: 'selected'; index: number }
  | { kind: 'blocked'; nonRefuted: number[] }
  | { kind: 'none' } {
  const admissions = arms.map((a, k): Admission => {
    const permutation = named?.[k];
    if (named !== undefined && permutation === undefined) return 'refute';
    return armAdmission(
      permutation === undefined ? ops : permuteOps(ops, permutation),
      a
    );
  });

  let best = -1;
  for (let i = 0; i < arms.length; i++) {
    if (admissions[i] !== 'admit') continue;
    if (
      best < 0 ||
      isMoreSpecific(arms[i], arms[best], ops.length, named?.[i], named?.[best])
    )
      best = i;
  }

  // An undecidable arm blocks unless the best admitted arm is STRICTLY more
  // specific than it (dispatching a fallback while a more-specific value
  // arm is unresolved is the symbolic-divergence failure the design
  // rejects).
  let blocked = false;
  for (let i = 0; i < arms.length; i++) {
    if (admissions[i] !== 'undecidable') continue;
    if (
      best < 0 ||
      !isMoreSpecific(
        arms[best],
        arms[i],
        ops.length,
        named?.[best],
        named?.[i]
      )
    ) {
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
 * The parameter at `index` of a near-miss arm, as it should be DISPLAYED in
 * an `incompatible-type` message.
 *
 * Typing uses the arm's instantiation (`arm`), where a type variable that got
 * no call-site bound and carries no declared bound falls to `unknown` — so
 * the instantiated parameter reads `indexed_collection<unknown>`, an
 * impossible-looking requirement for what is really "any indexed
 * collection". For display only, such a variable is shown at its GROUND
 * SKELETON (`any`, which `reduceType` normalizes back to the bare
 * constructor), restoring the declared signature's wording. This mirrors the
 * single-signature path's `displayParam` in `validate.ts` (§8), so an
 * overload set diagnoses a bad operand with the same words a plain signature
 * would. Nothing that types the call reads this.
 */
function displayParamAt(
  arm: FunctionSignature,
  declared: FunctionSignature,
  solution: TypeInferenceResult | undefined,
  index: number
): Type | undefined {
  const ground = paramAt(arm, index);
  if (ground === undefined) return undefined;
  if (solution === undefined || solution.unbound.size === 0) return ground;
  const pattern = paramAt(declared, index);
  if (pattern === undefined) return ground;
  // An unbound variable DISPLAYS as `unknown`, the identity bound
  // (bare-synonym ruling 2026-08-17): `reduceType` below collapses
  // `indexed_collection<unknown>` to the bare name, so the diagnostic says
  // "expected indexed_collection", not the wider `indexed_collection<any>`.
  const displayBindings: Record<string, Type> = {
    ...solution.bindings,
    ...Object.fromEntries(
      [...solution.unbound].map((v) => [v, 'unknown' as Type])
    ),
  };
  const t = substituteTypeVariables(pattern, displayBindings);
  return freeTypeVariables(t).size === 0 ? reduceType(t) : ground;
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
  options?: AdmissionPolicies,
  /** The same trial admission `resolveOverload` ran with (phase 2c). Each
   * arity-viable arm's refuted positions are the operands its TRIAL — full
   * validation under a rollback frame — actually errored on, which is
   * strictly more faithful than the old per-position filter probing. Runs
   * only on the already-failing path, so trial cost is not a concern here.
   * Without it (the trial-less cold path) the prefilter's per-position
   * verdicts are used instead. */
  trial?: ArmTrialFn
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
  let candidates: {
    arm: FunctionSignature;
    declared: FunctionSignature;
    solution: TypeInferenceResult | undefined;
    refutes: number[];
  }[] = [];
  for (const declared of arityViable) {
    const instantiated = instantiateArm(
      declared,
      ops,
      options,
      ce._typeResolver
    );
    const arm = instantiated.instance;
    const solution = instantiated.solution;
    let refutes: number[];
    if (trial !== undefined) {
      // The trial's verdict IS full validation's: the refuted positions are
      // the operands it errored on. `null` (the arm admits) cannot happen on
      // this path — the caller only diagnoses when no arm was selected — but
      // is mapped to "refutes nothing" defensively.
      refutes = [...(trial(declared, arm, instantiated.solution, ops) ?? [])];
    } else {
      refutes = [];
      ops.forEach((op, i) => {
        const param = paramAt(arm, i);
        if (param === undefined) return;
        if (!prefilterAdmits(ce, op, param, i, options)) refutes.push(i);
      });
    }
    if (refutes.length < fewest) {
      fewest = refutes.length;
      candidates = [{ arm, declared, solution, refutes }];
    } else if (refutes.length === fewest) {
      candidates.push({ arm, declared, solution, refutes });
    }
  }

  const refuted = new Map<number, Type>();
  for (const { arm, declared, solution, refutes } of candidates) {
    for (const i of refutes) {
      const param = displayParamAt(arm, declared, solution, i);
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
    // An arm whose parameter is `unknown` (an unannotated multi-clause
    // parameter, `g(0) = 0; g(n) = n^2` — the second arm is `(unknown) ->
    // number`) accepts anything at this position too, so the join is
    // unconstrained. `widen` cannot express that: it treats `unknown` as
    // "no information" and DROPS it (`widen(0, unknown)` is `0`), which
    // narrowed a bare `x` in `g(x)` to the literal type `0` and made the
    // call evaluate to `0` by selecting the `g(0)` clause.
    if (p === 'unknown') return undefined;
    params.push(p);
  }
  if (params.length === 0) return undefined;
  return params.length === 1 ? params[0] : widen(...params);
}
