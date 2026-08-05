import { sym } from '../boxed-expression/type-guards.js';
import { isValueDef } from '../boxed-expression/utils.js';
import { RING_CONSTANTS } from '../latex-syntax/utils.js';
import type { Expression } from '../global-types.js';

/**
 * True if `expr` is one of the blackboard-bold ring constants **as bound by
 * the standard library** (see `RING_CONSTANTS` in `latex-syntax/utils.ts` for
 * the list and why it is explicit).
 *
 * The match is on the BINDING, not on the spelling: a scope that shadows
 * `Integers` with a genuine user collection must keep the ordinary
 * `At`/`Subscript` reading for it, so the operand's own value definition has
 * to be the one the system scope holds.
 */
export function isRingConstant(expr: Expression | null | undefined): boolean {
  const name = sym(expr);
  if (name === undefined || !RING_CONSTANTS.has(name)) return false;

  // An unbound operand (a non-canonical symbol) resolves to nothing, so it
  // cannot be shown to be the library constant.
  const def = expr!.valueDefinition;
  if (def === undefined) return false;

  const systemDef =
    expr!.engine.contextStack[0]?.lexicalScope.bindings.get(name);
  return (
    systemDef !== undefined && isValueDef(systemDef) && systemDef.value === def
  );
}
