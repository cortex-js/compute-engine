/**
 * The APPLY-SITE status of a boxed call, memoized on the call
 * (`docs/plans/2026-10-26-value-kinds.md`, section 4.3).
 *
 * A call is an apply site for a value kind when one of its operands holds a
 * value of a kind that was admitted ONLY through the carrier of the kind
 * (`admittedAs: 'real'` or `'number'`), and the operator is not lazy, has an
 * `evaluate` handler, and is not an operator that handles a kind value
 * through its hooks (`isApplySite()`, `kind-admission.ts`). The dispatch of
 * the evaluation calls the kind's `apply` hook at such a call.
 *
 * This reader is separate from `kind-admission.ts` because it resolves the
 * arm of an overload set (`resolveOverload()`, `overload.ts`), and
 * `overload.ts` imports `kind-admission.ts`.
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { couldBeUnkeyedCollectionOperand } from '../collection-utils.js';
import {
  overloadArms,
  resolveOverload,
  type OverloadResolution,
} from './overload.js';
import {
  hasCarrierKindArm,
  isApplySite,
  kindCarrierOperands,
} from './kind-admission.js';
import { kindGeneration, someKindAdmittedByCarrier } from './value-kinds.js';
import { isFunction } from './type-guards.js';
import { describe } from './operand-descriptor.js';
import {
  kindApplySiteResultType,
  namedKindResultTypeOverTypes,
} from './derive-application-type.js';

type ApplySiteMemo = {
  generation: number;
  types: ReadonlyArray<Type>;
  operands: ReadonlyArray<number>;
  /** The signature arm the call was resolved to, when it is an apply site. */
  arm: Type | undefined;
};

const MEMO = new WeakMap<object, ApplySiteMemo>();

const NONE: ReadonlyArray<number> = [];

/**
 * The indices of the operands of the call `expr` that make it an apply site
 * (operands admitted only through the carrier of their kind), or an empty
 * list when `expr` is not an apply site. For an overload set, the arm is the
 * one the call was validated against (`_resolvedOverload` on the call), or
 * the one `resolveOverload()` selects, which prefers an arm that admits the
 * kind by type.
 *
 * The answer is memoized on the call, keyed by the generation of the kind
 * registry and by the identity of each operand type, so it is computed again
 * when a kind is registered or an operand is typed again.
 */
export function applySiteOperands(expr: Expression): ReadonlyArray<number> {
  return applySite(expr)?.operands ?? NONE;
}

/** The memo of the apply-site status of the call `expr`, computed when it
 * is out of date, or `undefined` when `expr` cannot be an apply site. */
function applySite(expr: Expression): ApplySiteMemo | undefined {
  if (!isFunction(expr)) return undefined;
  const def = expr.operatorDefinition;
  if (def === undefined || def.lazy || def.evaluate === undefined)
    return undefined;
  const ops = expr.ops;
  if (ops.length === 0) return undefined;
  const ce = expr.engine as ComputeEngine;
  // No registered kind type is admitted through its carrier: no call of the
  // engine can be an apply site, and the engine pays no more than this test.
  if (!someKindAdmittedByCarrier(ce)) return undefined;
  const types = ops.map((op) => op.type.type);
  const generation = kindGeneration(ce);
  const memo = MEMO.get(expr);
  if (
    memo !== undefined &&
    memo.generation === generation &&
    memo.types.length === types.length &&
    memo.types.every((t, i) => t === types[i])
  )
    return memo;

  let operands: ReadonlyArray<number> = NONE;
  let siteArm: Type | undefined;
  if (types.some((t) => hasCarrierKindArm(ce, t))) {
    const sig = def.signature.type;
    let arm: Type | undefined = sig;
    const arms = overloadArms(sig);
    if (arms !== undefined) {
      const recorded = (expr as { _resolvedOverload?: OverloadResolution })
        ._resolvedOverload;
      arm = (
        recorded ??
        resolveOverload(ce, ops, arms, {
          lazy: def.lazy,
          threadable: def.broadcastable,
          couldBeUnkeyedCollection: couldBeUnkeyedCollectionOperand,
        })
      ).selected;
    }
    if (arm !== undefined && isApplySite(ce, def, arm, types)) {
      operands = kindCarrierOperands(ce, def, arm, types);
      siteArm = arm;
    }
  }
  const result = { generation, types, operands, arm: siteArm };
  MEMO.set(expr, result);
  return result;
}

/** True when the call `expr` is an apply site for a value kind
 * ({@link applySiteOperands}). */
export function isApplySiteCall(expr: Expression): boolean {
  return applySiteOperands(expr).length > 0;
}

/**
 * The static result type of the call `expr` when it is an APPLY SITE of a
 * value kind (`docs/plans/2026-10-26-value-kinds.md`, section 4.5), or
 * `undefined` when it is not (the ordinary typing applies). The rules are
 * those of `kindApplySiteResultType()` (`derive-application-type.ts`), which
 * the route from operand types (`deriveApplicationType()`) calls too, so
 * that the two routes give the same type. When the call is not an apply
 * site, the rule for a parameter that names a kind type applies
 * (`namedKindResultTypeOverTypes()`).
 */
export function applySiteResultType(expr: Expression): Type | undefined {
  if (!isFunction(expr)) return undefined;
  const site = applySite(expr);
  if (site === undefined || site.operands.length === 0) {
    const def = expr.operatorDefinition;
    if (def === undefined) return undefined;
    return namedKindResultTypeOverTypes(
      expr.engine as ComputeEngine,
      expr.operator,
      def,
      expr.ops.map((op) => op.type.type)
    );
  }
  const arm = site.arm;
  if (arm === undefined) return undefined;
  const ops = expr.ops;
  return kindApplySiteResultType(
    expr.engine as ComputeEngine,
    expr.operator,
    arm,
    ops.map((op) => describe(op)),
    site.operands,
    (i, t) => describe(ops[i], t)
  );
}
