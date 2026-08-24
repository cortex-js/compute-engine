/**
 * The LEGACY expressions-shape `type` handlers of operators that have been
 * converted to the `'types'` shape — moved here verbatim when each operator
 * converts, so the shadow-parity mechanism
 * (`checkShadowTypeParity`, `boxed-expression/operand-descriptor.ts`) can
 * run both shapes and throw on divergence. This file is a fixture, not a
 * test suite (jest only matches `*.test.ts`).
 *
 * Conversion protocol: when converting an operator in `library/*.ts`, copy
 * its old handler here unchanged — same reads, same branches — keyed by the
 * operator name, and let the parity suite (and any full run with the shadow
 * installed) prove the equivalence. Once a batch has been proven and
 * shipped for a release, its entries can be deleted.
 */

import type { Type } from '../../src/common/type/types';
import type { OperatorTypeHandlerOnExpressions } from '../../src/compute-engine/global-types';
import { _legacyTypeHandlerShadow } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import {
  functionResult,
  stripMissingFromType,
  widen,
} from '../../src/common/type/utils';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

export const LEGACY_TYPE_HANDLERS: Record<
  string,
  OperatorTypeHandlerOnExpressions
> = {
  // From library/core.ts, pre-conversion (commit bca1105e).
  Coalesce: (ops) => {
    if (ops.length === 0) return 'nothing';
    const arms = ops.map((op, i) =>
      i < ops.length - 1 ? stripMissingFromType(op.type.type) : op.type.type
    );
    return widen(...arms) as Type;
  },

  Hold: ([x]) => {
    if (isSymbol(x)) return 'symbol';
    if (isString(x)) return 'string';
    if (isNumber(x)) return x.type;
    if (isFunction(x)) return functionResult(x.type.type) ?? 'unknown';
    return 'unknown';
  },

  ReleaseHold: ([x]) => (isFunction(x, 'Hold') ? x.op1.type : x.type),
};

export function installLegacyTypeHandlerShadow(): void {
  for (const [operator, handler] of Object.entries(LEGACY_TYPE_HANDLERS))
    _legacyTypeHandlerShadow.set(operator, handler);
}

export function uninstallLegacyTypeHandlerShadow(): void {
  for (const operator of Object.keys(LEGACY_TYPE_HANDLERS))
    _legacyTypeHandlerShadow.delete(operator);
}
