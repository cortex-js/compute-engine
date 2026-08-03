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

/**
 * The resolution of a `Typed` type operand, keyed by the operand NODE.
 *
 * A type operand is stored as TEXT (`["Typed", "x", "'pt'"]`), but a name
 * declared by a `type` statement only resolves while its declaring scope is
 * current: `ce._typeResolver` walks the CURRENT lexical scope. A literal
 * outlives that scope whenever it escapes the block that declared the type —
 * assigned to an outer symbol, returned, stored in a collection — and every
 * later read of its parameter types re-parses the text from wherever the
 * reader happens to stand. That re-parse throws `Unknown type`, the annotation
 * silently reads as absent, and argument-type validation stops firing.
 *
 * Same hazard, same fix as the operator-definition signature
 * (`boxed-operator-definition.ts`, "assembled as a Type OBJECT, never as a
 * string that is re-parsed"): `typeToString` discards the resolution, so carry
 * the resolved `Type` — a `TypeReference` carries its own `def` and stays
 * usable wherever it escapes to. Here the text is what the expression stores,
 * so the resolution is remembered against the operand node instead, recorded
 * the first time the name resolves. `canonicalFunctionLiteralArguments` forces
 * that first resolution (`resolveFunctionLiteralTypes`) while the declaring
 * scope is still current, rather than leaving it to whichever consumer reads
 * the literal first.
 */
const RESOLVED_TYPE_OPERANDS = new WeakMap<Expression, Type>();

/** Parse a `Typed` type operand (a string literal or a type-name symbol) into
 * a {@link Type}, returning `undefined` if it cannot be parsed. */
function parseTypeOperand(t: Expression | undefined): Type | undefined {
  if (!t) return undefined;
  const s = isString(t) ? t.string : sym(t);
  if (s === undefined) return undefined;
  try {
    return parseType(s);
  } catch {
    // The annotation may name a user-declared type (`ce.declareType()`),
    // which only the engine's resolver can read. Tried second, so the
    // resolver-less (memo-cached) parse still carries the common case.
    try {
      const resolved = parseType(s, t.engine._typeResolver);
      RESOLVED_TYPE_OPERANDS.set(t, resolved);
      return resolved;
    } catch {
      // Out of scope now: fall back to the resolution recorded while the
      // declaring scope was current (see `RESOLVED_TYPE_OPERANDS`).
      return RESOLVED_TYPE_OPERANDS.get(t);
    }
  }
}

/**
 * Force the resolution of a canonical `Function` literal's type operands while
 * the scope that declares those type names is still current.
 *
 * Called once, at the end of `canonicalFunctionLiteralArguments`: the literal
 * may escape that scope, and after it does the operand text no longer resolves
 * (see {@link RESOLVED_TYPE_OPERANDS}). The reads are pure; they are made for
 * the resolution they record.
 */
export function resolveFunctionLiteralTypes(expr: Expression): void {
  functionLiteralParameters(expr);
  functionLiteralReturnType(expr);
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

/** A type is "scalar" for broadcasting purposes if it is NOT a known
 * collection-like type. Conservative: unknown/any → scalar.
 * @internal
 */
export function isScalarType(t: Type): boolean {
  if (typeof t === 'string') {
    // String types like 'collection', 'list', 'tuple', 'set' are non-scalar.
    if (
      t === 'collection' ||
      t === 'indexed_collection' ||
      t === 'list' ||
      t === 'tuple' ||
      t === 'set' ||
      t === 'dictionary' ||
      t === 'record' ||
      t === 'function'
    )
      return false;
    return true;
  }
  if (
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'list' ||
    t.kind === 'tuple' ||
    t.kind === 'set' ||
    t.kind === 'dictionary' ||
    t.kind === 'record' ||
    t.kind === 'signature' ||
    // A `broadcastable<T>` parameter accepts a collection whole (it handles
    // collections natively), so it is NOT a scalar — a lambda with such a
    // parameter must not be mapped/broadcast over a collection argument.
    t.kind === 'broadcastable'
  )
    return false;
  if (t.kind === 'union' || t.kind === 'intersection')
    return t.types.every((x) => isScalarType(x));
  if (t.kind === 'negation') return isScalarType(t.type);
  return true;
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
  const text =
    op === undefined ? undefined : isString(op) ? op.string : sym(op);
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
