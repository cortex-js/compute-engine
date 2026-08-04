import {
  freeTypeVariables,
  groundSkeleton,
  parameterPositions,
  solveTypeArguments,
  substituteTypeVariables,
  type TypeInferenceResult,
} from '../../common/type/instantiate.js';
import { typeContainsMissing } from '../../common/type/utils.js';
import type {
  FunctionSignature,
  Type,
  TypeParameter,
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

/** What the embedding knows about the call that the solver cannot see. */
export interface ArmInferenceContext {
  /** The operator broadcasts (`threadable`): a collection operand is
   * lift-admitted at a scalar parameter (D10). */
  threadable?: boolean;
  /** Strip-before-validate eligibility, per position. */
  stripMissing?: (index: number) => boolean;
  /** The operator is `lazy: true`. The whole mechanism is IDLE (§4.5): a lazy
   * operator's operands are not validated and arrive unbound, so their types
   * are noise — no position contributes a bound, and every variable falls to
   * the S3 fallback (its declared bound, else `unknown`). Pinned by a named
   * test, so closing the lazy carve-out later fails deliberately. */
  lazy?: boolean;
}

/**
 * Solve `arm`'s `forall` clause against `ops` (§4.3), mapping each §4.5
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
  const positions = parameterPositions(arm, ops.length);
  const skeletons = positions.map((p) =>
    p === undefined ? undefined : groundSkeleton(p)
  );

  return solveTypeArguments(
    arm,
    ops.map((op) => op?.type.type),
    {
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
        // D10: a lift-admitted operand at a bare-variable pattern binds the
        // FULL actual; admission stays checked at the scalar base by the lift
        // gate itself.
        const op = ops[i];
        return !!ctx?.threadable && !!op && couldBeCollectionOperand(op);
      },
    }
  );
}

/**
 * The operand positions whose FULL actual the D10 lift already put into the
 * arm's result: a lift-admitted operand (same predicate as `solveArm`'s
 * `lifted` policy) sitting at a BARE-VARIABLE parameter whose variable IS the
 * whole result.
 *
 * At such a position the solved result type IS the collection actual — the
 * broadcast/lift wrapper at the call site must therefore not lift it a SECOND
 * time (`f([1,2,3])` under `forall T. (T) -> T` is `vector<…^3>`, never
 * `list<vector<…^3>>`). Empty for a ground signature, so no non-generic path
 * changes.
 *
 * The result must be the BARE variable, not merely mention it: under
 * `forall T. (T) -> tuple<T>` the arm's result is a tuple WRAPPING the
 * collection, so the caller's unwrap would drop the broadcast shape the value
 * route builds. Only the true echo shape short-circuits.
 */
export function liftedEchoPositions(
  arm: Readonly<Type> | undefined,
  ops: ReadonlyArray<Expression>,
  ctx?: ArmInferenceContext
): ReadonlySet<number> {
  const poly = polytypeArm(arm);
  if (poly === undefined || !ctx?.threadable || ctx.lazy)
    return EMPTY_POSITIONS;
  const echoed = poly.result;
  if (typeof echoed !== 'object' || echoed.kind !== 'variable')
    return EMPTY_POSITIONS;

  const result = new Set<number>();
  parameterPositions(poly, ops.length).forEach((p, i) => {
    if (p === undefined || typeof p === 'string') return;
    if (p.kind !== 'variable' || p.name !== echoed.name) return;
    const op = ops[i];
    if (op && couldBeCollectionOperand(op)) result.add(i);
  });
  return result;
}

const EMPTY_POSITIONS: ReadonlySet<number> = new Set<number>();

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
