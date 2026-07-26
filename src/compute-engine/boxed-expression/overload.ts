import { isSubtype, widen } from '../../common/type/subtype.js';
import {
  broadcastableBaseMatches,
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
import { isOperatorDef, isValueDef } from './utils.js';
import { isSymbol } from './type-guards.js';

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
  /** The most-specific viable arm; `undefined` when no arm fits. */
  selected: FunctionSignature | undefined;
  /** Every arm that survived arity + type filtering, in declaration order. */
  viable: ReadonlyArray<FunctionSignature>;
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
 * The parameter an arm would bind to operand `index`: a required parameter,
 * then an optional one, then the variadic parameter (which absorbs every
 * remaining position). `undefined` when the arm has no slot at that index.
 *
 * Mirrors the consumption order of `validateArguments`' three loops.
 */
export function paramAt(
  sig: FunctionSignature,
  index: number
): Type | undefined {
  const required = sig.args?.length ?? 0;
  if (index < required) return sig.args![index].type;
  const optional = sig.optArgs?.length ?? 0;
  if (index < required + optional) return sig.optArgs![index - required].type;
  return sig.variadicArg?.type;
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
 */
function isRepairableOperatorSymbol(
  ce: ComputeEngine,
  op: Expression
): boolean {
  if (!isSymbol(op)) return false;
  const name = op.symbol;
  if (!/^[A-Z]$/.test(name)) return false;
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope && !scope.bindings.has(name)) scope = scope.parent;
  if (!scope) return false;
  const def = scope.bindings.get(name)!;
  return scope.parent ? isValueDef(def) : isOperatorDef(def);
}

/** The caller policies the filter must mirror to stay faithful to
 * `validateArguments`. Each is optional; omitting one makes the corresponding
 * gate inactive, exactly as it is inactive for a caller that does not pass it.
 */
export interface AdmissionPolicies {
  lazy?: boolean;
  threadable?: boolean;
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

  if (policies?.threadable && policies.couldBeCollection?.(op)) return true;
  if (op.type.matches(param)) return true;

  // An inferred (not declared) symbol type that the parameter would narrow.
  if (op.valueDefinition?.inferredType && isSubtype(param, op.type.type))
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

/**
 * True when `a` is strictly more specific than `b`: every position's parameter
 * is a subtype of `b`'s, and the two are not mutually interchangeable. A
 * partial order — incomparable arms are ordered by declaration instead.
 */
function isMoreSpecific(
  a: FunctionSignature,
  b: FunctionSignature,
  arity: number
): boolean {
  let strict = false;
  for (let i = 0; i < arity; i++) {
    const pa = paramAt(a, i);
    const pb = paramAt(b, i);
    // A missing slot on either side means the arms bind this call differently;
    // they are not comparable on specificity.
    if (pa === undefined || pb === undefined) return false;
    if (!isSubtype(pa, pb)) return false;
    if (!isSubtype(pb, pa)) strict = true;
  }
  return strict;
}

/**
 * Resolve an application of `arms` to `ops` (§3 of the design): filter by
 * arity, filter by operand type, then rank the survivors most-specific-first,
 * tie-breaking by declaration order.
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
  const byArity = arms.filter((a) => arityAdmits(a, arity));

  // Note `operandAdmits` handles `lazy` itself (a lazy operator's operands are
  // unbound, so their types are not meaningful and refute nothing). Keeping
  // that inside the single admission rule is what makes the filter and the
  // diagnostic agree.
  const viable = byArity.filter((arm) =>
    ops.every((op, i) => {
      const param = paramAt(arm, i);
      return param !== undefined && operandAdmits(ce, op, param, i, policies);
    })
  );

  if (viable.length === 0) return { selected: undefined, viable };

  // Rank: the first arm not beaten by any other wins. Scanning in declaration
  // order makes the tie-break fall out for free.
  let selected = viable[0];
  for (const candidate of viable.slice(1))
    if (isMoreSpecific(candidate, selected, arity)) selected = candidate;

  return { selected, viable };
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

  // Score each arm by the positions it refutes; keep the nearest misses.
  let fewest = Infinity;
  let candidates: { arm: FunctionSignature; refutes: number[] }[] = [];
  for (const arm of arityViable) {
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
