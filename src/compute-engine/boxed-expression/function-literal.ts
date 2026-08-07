import type { Expression, FunctionInterface } from '../global-types.js';
import type {
  EffectSet,
  FunctionSignature,
  Type,
  TypeReference,
} from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { freeTypeVariables } from '../../common/type/instantiate.js';
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
export function isScalarType(
  t: Type,
  seen?: Set<TypeReference>
): boolean {
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
    return t.types.every((x) => isScalarType(x, seen));
  if (t.kind === 'negation') return isScalarType(t.type, seen);
  // A STRUCTURAL alias IS its definition, so an alias of a collection type is
  // NOT scalar — the same unfold rule `isSubtype` applies. Without it,
  // `type alias u = list<number>` read as scalar and a `(u) -> …` function
  // BROADCAST over its list argument instead of binding it whole (each element
  // then failing the parameter check), while the inline `(list<number>) -> …`
  // spelling bound correctly.
  //
  // A NOMINAL reference stays opaque, and opaque means scalar: its values are
  // tagged applications, never collections, so a list of them is a genuine
  // broadcast (`norm([p1, p2])` maps a `(point) -> …` over the list).
  if (t.kind === 'reference') {
    if (t.alias !== true || t.def === undefined) return true;
    // Cycle guard (mirrors `beginUnfold` in `common/type/subtype.ts`). A pure
    // reference cycle passes through no collection constructor, so cutting the
    // back edge as "scalar" agrees with the conservative default below.
    if (seen === undefined) seen = new Set();
    else if (seen.has(t)) return true;
    seen.add(t);
    try {
      return isScalarType(t.def, seen);
    } finally {
      seen.delete(t);
    }
  }
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
 * "Epsil surface"), or `undefined` when the marker is an ordinary
 * return-type ascription.
 *
 * **Decomposition predicate**: the marker's type operand decomposes as a full
 * signature iff its TEXT is ungrouped and parses to a signature — effects and
 * `forall` clause optional. An author who spells an arrow in the return slot
 * plainly means the literal's contract; the GROUPED spelling (below) is the
 * explicit opt-out for the "returns a function" reading, so a ground arrow
 * needs no second discriminator (ruled 2026-08-04). Before that ruling only an
 * effect-bearing or quantified signature decomposed, and `["Typed", body,
 * "(x: number) -> number"]` typed as `(unknown) -> (x: number) -> number` —
 * the marker author's contract read as a returned function.
 *
 * The literal's parameter operands remain the parameters of record. The marker
 * signature's argument list is a MIRROR built by the Epsil lowering (and by
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
  return t;
}

/**
 * True when `t` — a component of `sig` (an argument type or the result) —
 * mentions one of the variables `sig`'s `forall` clause quantifies.
 *
 * Read on the COMPONENT, not on the whole signature: the clause-carrying
 * signature is CLOSED, so `freeTypeVariables` of it is empty by construction.
 * A component looked at on its own has those same occurrences FREE, so the
 * question is whether any of them is a name the clause declares.
 */
export function mentionsQuantifiedVariable(
  t: Type,
  sig: FunctionSignature
): boolean {
  const params = sig.typeParams;
  if (params === undefined || params.length === 0) return false;
  const free = freeTypeVariables(t);
  if (free.size === 0) return false;
  return params.some((p) => free.has(p.name));
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
 * the effects are declared (`function tick() scope { … }`).
 *
 * A result that mentions a QUANTIFIED variable (`forall T. (T) -> T`) joins
 * that same wide-result convention and declares no return type: under erasure
 * there is nothing ground to ascribe, and call-site result types come from the
 * INSTANTIATED signature instead. An open type must never leave this accessor
 * — it would reach the §4.2 ground-invariant tripwires. */
export function functionLiteralReturnType(expr: Expression): Type | undefined {
  const declared = functionLiteralDeclaredSignature(expr);
  if (declared !== undefined) {
    const result = declared.result;
    if (mentionsQuantifiedVariable(result, declared)) return undefined;
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
