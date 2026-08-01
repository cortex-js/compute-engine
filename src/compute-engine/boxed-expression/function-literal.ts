import type { Expression, FunctionInterface } from '../global-types.js';
import type {
  EffectSet,
  FunctionSignature,
  Type,
} from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import {
  isGroupedTypeText,
  signatureEffects,
} from '../../common/type/utils.js';
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

/** The return-ascription MARKER node of a `Function` literal — the §4.2
 * `Typed` wrapping the body Block's last statement, or, in the not-yet
 * normalized authoring form `["Typed", body, type]`, the body slot itself.
 * `undefined` when the literal carries no ascription. */
export function functionLiteralReturnMarker(
  expr: Expression
): (Expression & FunctionInterface) | undefined {
  if (!isFunction(expr, 'Function')) return undefined;
  const body = expr.ops[0];
  if (!body) return undefined;
  // Canonical body is a scoped Block; the marker wraps its last statement.
  if (isFunction(body, 'Block')) {
    const last = body.ops[body.nops - 1];
    return isFunction(last, 'Typed') ? last : undefined;
  }
  // Authoring form (not yet normalized): `["Typed", body, type]`.
  return isFunction(body, 'Typed') ? body : undefined;
}

/**
 * The FULL SIGNATURE a return marker declares (`docs/EFFECTS-MODEL.md`,
 * "Cortex surface"), or `undefined` when the marker is an ordinary
 * return-type ascription.
 *
 * **Decomposition predicate**: the marker's type operand decomposes as a full
 * signature iff it parses to a signature AND that signature carries an effect
 * set — the stated-empty `[]` a `pure` keyword builds counts. A signature
 * WITHOUT effects is deliberately NOT decomposed: `["Typed", body,
 * "(integer) -> integer"]` keeps its historical reading, a function whose
 * RESULT is a function.
 *
 * The literal's parameter operands remain the parameters of record. The marker
 * signature's argument list is a MIRROR built by the Cortex lowering (and by
 * `desugarSignatureString`) and is never read for parameter types.
 */
export function functionLiteralDeclaredSignature(
  expr: Expression
): FunctionSignature | undefined {
  const marker = functionLiteralReturnMarker(expr);
  if (marker === undefined) return undefined;
  // A fully parenthesized spelling is a GROUPED type (ruled 2026-08-01): the
  // author's disambiguation that this is a RETURN type — possibly an
  // effect-bearing arrow — never the literal's own contract. Grouping does
  // not survive parsing, so the test is on the marker's text.
  const op = marker.op2;
  const text = op === undefined ? undefined : isString(op) ? op.string : sym(op);
  if (text !== undefined && isGroupedTypeText(text)) return undefined;
  const t = parseTypeOperand(marker.op2);
  if (t === undefined || typeof t === 'string' || t.kind !== 'signature')
    return undefined;
  return signatureEffects(t) !== undefined ? t : undefined;
}

/** The arrow-level effects declared by a full-signature return marker, or
 * `undefined` when the literal has no declared signature. A STATED empty set
 * (`pure`) is preserved as `[]`: discriminate with `!== undefined`, never by
 * truthiness or length. */
export function functionLiteralDeclaredEffects(
  expr: Expression
): EffectSet | undefined {
  return signatureEffects(functionLiteralDeclaredSignature(expr));
}

/** The ascribed return type of a `Function` literal (the §4.2 marker: a
 * `Typed` wrapping the body Block's last statement), or `undefined` when the
 * return type is left to inference.
 *
 * When the marker holds a full signature, the declared return type is that
 * signature's RESULT — except under the wide-result convention (mirroring
 * `desugarSignatureString`'s `isWide`): a result of `unknown`/`any` declares
 * no return type at all, so the return stays inferred from the body and only
 * the effects are declared (`function tick() scope { … }`). */
export function functionLiteralReturnType(expr: Expression): Type | undefined {
  const declared = functionLiteralDeclaredSignature(expr);
  if (declared !== undefined) {
    const result = declared.result;
    return result === 'unknown' || result === 'any' ? undefined : result;
  }
  const marker = functionLiteralReturnMarker(expr);
  return marker === undefined ? undefined : parseTypeOperand(marker.op2);
}

/** The body of a `Function` literal (the scoped `Block`, return-type marker
 * included). */
export function functionLiteralBody(expr: Expression): Expression | undefined {
  if (!isFunction(expr, 'Function')) return undefined;
  return expr.ops[0];
}
