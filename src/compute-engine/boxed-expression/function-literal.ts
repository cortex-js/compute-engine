import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { isFunction, isString, sym } from './type-guards.js';

/**
 * Shared accessors for the shape of a `Function` literal so that no call site
 * has to pattern-match the `["Typed", …]` parameter/return annotations by hand.
 *
 * A `Function` literal has the canonical shape
 * `["Function", body, param₁, …, paramₙ]` where:
 * - each `paramᵢ` is a bare symbol (inferred type) or `["Typed", symbol, type]`
 *   (annotated parameter);
 * - `body` is a scoped `Block`; a return-type ascription lives INSIDE that
 *   Block, wrapping the last statement as `["Typed", statement, type]`.
 *
 * These helpers are the single source of truth for reading that shape.
 */

/** Parse a `Typed` type operand (a string literal or a type-name symbol) into
 * a {@link Type}, returning `undefined` if it cannot be parsed. */
function parseTypeOperand(t: Expression | undefined): Type | undefined {
  if (!t) return undefined;
  const s = isString(t) ? t.string : sym(t);
  if (s === undefined) return undefined;
  try {
    return parseType(s);
  } catch {
    return undefined;
  }
}

/** The name of a single `Function` parameter operand, unwrapping a `Typed`
 * annotation. Returns `''` when the operand is not a symbol (matching the
 * historical `isSymbol(p) ? p.symbol : ''` idiom). */
export function functionLiteralParameterName(param: Expression): string {
  if (isFunction(param, 'Typed')) return sym(param.op1) ?? '';
  return sym(param) ?? '';
}

/** The declared type of a single `Function` parameter operand, or `undefined`
 * for a bare (unannotated) parameter. */
export function functionLiteralParameterType(
  param: Expression
): Type | undefined {
  if (isFunction(param, 'Typed')) return parseTypeOperand(param.op2);
  return undefined;
}

/** The parameters of a `Function` literal, as `{ name, type }` records. Bare
 * parameters have `type: undefined`. */
export function functionLiteralParameters(
  expr: Expression
): { name: string; type: Type | undefined }[] {
  if (!isFunction(expr, 'Function')) return [];
  return expr.ops.slice(1).map((p) => ({
    name: functionLiteralParameterName(p),
    type: functionLiteralParameterType(p),
  }));
}

/** The ascribed return type of a `Function` literal (the §4.2 marker: a
 * `Typed` wrapping the body Block's last statement), or `undefined` when the
 * return type is left to inference. */
export function functionLiteralReturnType(expr: Expression): Type | undefined {
  if (!isFunction(expr, 'Function')) return undefined;
  const body = expr.ops[0];
  if (!body) return undefined;
  // Canonical body is a scoped Block; the marker wraps its last statement.
  if (isFunction(body, 'Block')) {
    const last = body.ops[body.nops - 1];
    return isFunction(last, 'Typed') ? parseTypeOperand(last.op2) : undefined;
  }
  // Authoring form (not yet normalized): `["Typed", body, type]`.
  return isFunction(body, 'Typed') ? parseTypeOperand(body.op2) : undefined;
}

/** The body of a `Function` literal (the scoped `Block`, return-type marker
 * included). */
export function functionLiteralBody(expr: Expression): Expression | undefined {
  if (!isFunction(expr, 'Function')) return undefined;
  return expr.ops[0];
}
