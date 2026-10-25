import type {
  BoxedValueDefinition,
  Expression,
  FunctionInterface,
  Scope,
} from '../global-types.js';
import { assignmentLocalsOf } from '../assignment-locals.js';
import type {
  EffectSet,
  FunctionSignature,
  NamedElement,
  Type,
  TypeReference,
} from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { freeTypeVariables } from '../../common/type/instantiate.js';
import {
  isGroupedTypeText,
  signatureEffects,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { isFunction, isString, isSymbol, sym } from './type-guards.js';
import { tuplePatternNames } from './tuple-pattern.js';
import { journalCheckpointMemoEntry } from '../checkpoint-journal.js';

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
      // Checkpoint journal (funnel 7): this memo carries no version stamp, so
      // a node that predates the checkpoint but first resolved DURING the
      // window would keep the window's resolution across a restore — the
      // resolver reads the type registry, which the restore rewinds.
      journalCheckpointMemoEntry(
        t.engine,
        RESOLVED_TYPE_OPERANDS,
        t,
        'resolved-type-operand'
      );
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

/**
 * True when a `Function` parameter operand is a REST parameter — the
 * `["Spread", symbol]` node spelled `...rest` in Epsil.
 *
 * A rest parameter may only be the LAST operand of the parameter list. It
 * consumes every argument from its own position onwards and binds ONE name to
 * a `Tuple` of them, empty when the call supplies no trailing argument.
 * `canonicalFunctionLiteralArguments` rejects any other placement, a
 * `["Spread", …]` holding something other than a single symbol, and a `Typed`
 * annotation wrapped around one.
 */
export function isRestParameter(param: Expression): boolean {
  return isFunction(param, 'Spread');
}

/**
 * The index of the REST parameter within a `Function` literal's parameter
 * list, or `-1` when the list has none.
 *
 * Canonicalization admits at most one rest parameter and only in the last
 * position, so this index is also the number of FIXED parameters an
 * application must supply before the rest parameter takes over.
 */
export function restParameterIndex(params: ReadonlyArray<Expression>): number {
  return params.findIndex((p) => isRestParameter(p));
}

/**
 * The variadic tail a rest parameter contributes to a `Function` literal's
 * arrow, ready to be spread into a signature object. An empty object when the
 * parameter list has no rest parameter.
 *
 * The element type is `any` — the widest contract, absence markers included —
 * because a rest parameter carries no annotation of its own (a `Typed` wrapper
 * around one is rejected at canonicalization), so the call may pass anything.
 * `variadicMin` is `0` because the tail may be empty: the application then
 * binds the empty tuple.
 *
 * EVERY derivation of a literal's arrow must spread this in. A derivation that
 * does not counts the rest parameter as one ordinary positional slot, and the
 * arrow then claims a fixed arity the function does not have — which is what
 * made an assigned `(a, ...rest) => …` report `(unknown, unknown) -> integer`.
 */
export function restParameterSignatureTail(params: ReadonlyArray<Expression>): {
  variadicArg?: NamedElement;
  variadicMin?: 0;
} {
  return restParameterIndex(params) < 0
    ? {}
    : { variadicArg: { type: 'any' }, variadicMin: 0 };
}

/**
 * The call arities a `Function` literal accepts: the number of FIXED
 * parameters it requires, and whether a rest parameter leaves the tail
 * unbounded.
 *
 * `(a, b) => …` is `{ fixed: 2, variadic: false }` — it accepts exactly two
 * arguments. `(a, ...rest) => …` is `{ fixed: 1, variadic: true }` — one
 * argument or more. This is the reading every arity check owes a literal;
 * counting the parameter OPERANDS answers `2` for both.
 */
export function functionLiteralArity(expr: Expression): {
  fixed: number;
  variadic: boolean;
} {
  const params = isFunction(expr, 'Function') ? expr.ops.slice(1) : [];
  const rest = restParameterIndex(params);
  return rest < 0
    ? { fixed: params.length, variadic: false }
    : { fixed: rest, variadic: true };
}

/** The symbol NODE a rest parameter binds — the operand inside its `Spread`
 * wrapper — or `undefined` when `param` is not a rest parameter. Consumers
 * that must reach the parameter's own binding (the site a call frame
 * activates, the path a binding-site selector reports) read this node, never
 * the `Spread` wrapper. */
export function restParameterSymbol(param: Expression): Expression | undefined {
  return isFunction(param, 'Spread') ? param.op1 : undefined;
}

/** The name of a single `Function` parameter operand, unwrapping a `Typed`
 * annotation or a rest parameter's `Spread` wrapper. Returns `''` when the
 * operand is not a symbol (matching the historical
 * `isSymbol(p) ? p.symbol : ''` idiom). */
export function functionLiteralParameterName(param: Expression): string {
  if (isFunction(param, 'Typed')) return sym(param.op1) ?? '';
  if (isFunction(param, 'Spread')) return sym(param.op1) ?? '';
  return sym(param) ?? '';
}

/** The name that an INFERRED signature gives to the slot of a parameter with
 * no annotation, or `undefined` when the slot has no name.
 *
 * An inferred signature keeps the parameter names of the literal, so a named
 * call can find each slot: with `f := (a, b) => a - b`, the call
 * `f(b: 2, a: 10)` gives 8, and the arrow prints `(a: unknown, b: unknown) ->
 * number`. A slot has no name when the operand is not a symbol (a
 * destructuring pattern), and when the name is a wildcard (`_`, `_1`, `_2`):
 * a wildcard parameter is positional, and its name is not one that a caller
 * writes. The names do not change how two signatures compare: matching and
 * subtyping read only the slot types. */
export function inferredSignatureParameterName(
  param: Expression
): string | undefined {
  const name = sym(param);
  if (name === undefined || name === '' || /^_\d*$/.test(name))
    return undefined;
  return name;
}

/**
 * True when a `Function` parameter operand is a DESTRUCTURING PATTERN — a raw
 * `["Tuple", …]` node — rather than a plain (possibly annotated) name.
 *
 * Such a parameter still counts as ONE parameter: it consumes one argument,
 * which must be a tuple of the pattern's arity, and binds the pattern's leaf
 * names to that tuple's components. Epsil spells it with a second pair of
 * parentheses — `((p, q)) => p && q` is unary, `(p, q) => p && q` is binary.
 *
 * The pattern operand is kept RAW (never canonicalized), for the same reason
 * the `Declare`/`Assign` destructuring targets are: canonicalizing a
 * single-letter leaf would fold it into the library constant of that name
 * (`i` → `ImaginaryUnit`).
 */
export function isDestructuringParameter(param: Expression): boolean {
  return isFunction(param, 'Tuple');
}

/**
 * Every name a single `Function` parameter operand BINDS, in pattern order.
 *
 * One name for a plain or `Typed` parameter (empty when the operand is not a
 * symbol at all); for a destructuring pattern, the pattern's leaf names with
 * `_` positions — which bind nothing — dropped, nested patterns included.
 *
 * This is what every walker that asks "which names does this lambda bind?"
 * must use; {@link functionLiteralParameterName} answers only for the
 * single-name shapes and returns `''` for a pattern.
 */
export function functionLiteralParameterNames(param: Expression): string[] {
  if (isDestructuringParameter(param)) return tuplePatternNames(param);
  const name = functionLiteralParameterName(param);
  return name ? [name] : [];
}

/**
 * The value definitions of the parameters of the canonical function
 * literals. A parameter binding is added when it is created while the body
 * is canonicalized (`_setShadowedParameterDef()` in `index.ts`), so that a
 * nested literal whose type is computed before the enclosing literal is
 * complete sees it. `canonicalFunctionLiteralArguments()`
 * (`function-utils.ts`) adds the other parameter bindings when it declares
 * the parameters.
 *
 * A reader uses it to know that a call is a call of a parameter, also when
 * the parameter has no type and no value yet, and also from a nested
 * literal that captures the parameter. The scope of the body cannot answer
 * this: an inferred binding with no value there may be an auto-declared
 * local, and while the literal is applied the parameter bindings are
 * removed from that scope (`hideBodyScopeParams()`). The reader that needs
 * it is the reading of a call named `Return`: a call of a parameter named
 * `Return` is not the `Return` statement (`hasEscapingReturn()` in
 * `library/utils.ts`, `earlyReturnTypes()` in `effects-inference.ts`).
 *
 * A binding that existed before the literal can become a parameter binding
 * (the body was canonical before the literal was made, and its scope already
 * held the name). So a mark made while a checkpoint is open is journaled,
 * and a restore removes it, as it removes the binding from the scope.
 */
const FUNCTION_LITERAL_PARAMETERS = new WeakMap<object, true>();

/** Record `def` as the value definition of a function-literal parameter
 * (`FUNCTION_LITERAL_PARAMETERS`). `ce` is the engine of the literal: its
 * open checkpoint, if any, journals the mark. */
export function markFunctionLiteralParameter(
  ce: Expression['engine'],
  def: object
): void {
  if (FUNCTION_LITERAL_PARAMETERS.has(def)) return;
  journalCheckpointMemoEntry(
    ce,
    FUNCTION_LITERAL_PARAMETERS,
    def,
    'function-literal-parameter'
  );
  FUNCTION_LITERAL_PARAMETERS.set(def, true);
}

/** True when `def` is the value definition of a parameter of a canonical
 * function literal (`FUNCTION_LITERAL_PARAMETERS`). */
export function isFunctionLiteralParameter(def: object | undefined): boolean {
  return def !== undefined && FUNCTION_LITERAL_PARAMETERS.has(def);
}

/**
 * The type a destructuring parameter's argument must have: a tuple whose
 * arity is the pattern's, with a nested tuple type at each nested pattern
 * position and `unknown` everywhere else.
 *
 * Surfacing this on the literal's arrow (rather than the `unknown` a bare
 * parameter gets) is what states the arity the application will enforce, and
 * what keeps the parameter from reading as a SCALAR slot — a scalar slot
 * invites the collection-argument broadcast, which would map the lambda over
 * the tuple's components instead of binding the tuple whole.
 *
 * The COMPONENT types stay `unknown`: a pattern position carries no
 * annotation of its own (per-element annotations are rejected at parse), and
 * the per-application element-type inference declines to stamp a pattern
 * parameter (`annotateFunctionLiteralParams` rewrites bare SYMBOL parameters
 * only).
 */
export function destructuringParameterType(param: Expression): Type {
  if (!isFunction(param, 'Tuple')) return 'unknown';
  const elements = param.ops.map((el) =>
    isFunction(el, 'Tuple')
      ? { type: destructuringParameterType(el) }
      : { type: 'unknown' as Type }
  );
  return { kind: 'tuple', elements };
}

/** Every name the parameter list of a `Function` literal binds, in order. */
export function functionLiteralBoundNames(
  params: ReadonlyArray<Expression>
): string[] {
  const names: string[] = [];
  for (const p of params) names.push(...functionLiteralParameterNames(p));
  return names;
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
export function isScalarType(t: Type, seen?: Set<TypeReference>): boolean {
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
 * `where` clause optional. An author who spells an arrow in the return slot
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
 * mentions one of the variables `sig`'s `where` clause quantifies.
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
 * A result that mentions a QUANTIFIED variable (`(T) -> T where T`) joins
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

/** The anonymous-slot symbols of a shorthand function body: the bare `_`
 * and the positional `_1`…`_9`. */
export const ANONYMOUS_SLOT_NAMES: ReadonlySet<string> = new Set([
  '_',
  '_1',
  '_2',
  '_3',
  '_4',
  '_5',
  '_6',
  '_7',
  '_8',
  '_9',
]);

/**
 * The anonymous-slot names (`_`, `_1`…`_9`) that `expr` mentions as a
 * symbol or as an operator name and that no `Function` literal inside
 * `expr` binds. These are the slots that are FREE in `expr`.
 *
 * A `Function` node, including `expr` itself, is read as follows:
 * - A literal with NO parameter list (a single operand) is a shorthand
 *   literal. It takes its parameters from every slot its own body uses, so
 *   none of its slots is free outside it, and the walk does not enter it.
 *   For example, the body
 *   `["Add", "_1", [["Function", ["Multiply", "_1", "_2"]], 2, 3]]` mentions
 *   only `_1`, and the enclosing literal has one parameter, not two.
 * - A literal WITH a parameter list binds only the names it declares. The
 *   walk enters its body and ignores those names there. Any other slot in
 *   that body is free and refers to the enclosing literal: in
 *   `["Function", ["Apply", ["Function", ["Multiply", "_1", "x"], "x"], 2]]`
 *   the `_1` is the parameter of the outer literal.
 *
 * A `Pipe(value, stage)` node also binds slots: its stage takes its slots
 * from the piped value, so only `value` is walked. In
 * `["Add", "y", ["Pipe", "ys", ["Multiply", "_", 2]]]` the `_` is not free.
 *
 * Every reader that decides "which slots are the parameters of this
 * shorthand body" must use this walk, so that the reading when boxing
 * (`anonymousParameters`, `function-utils.ts`) agrees with the reading when
 * serializing (`serializePrettyJsonFunction`, `serialize.ts`), which drops a
 * parameter list only when boxing gives it back.
 */
export function freeAnonymousSlots(expr: Expression): Set<string> {
  const result = new Set<string>();
  // Shared subtrees are walked once. The dedup applies only outside every
  // explicit-parameter literal: inside one, the same node can have a
  // different set of bound names, so it is walked each time.
  const visited = new Set<Expression>();
  const pending: [Expression, ReadonlySet<string> | undefined][] = [
    [expr, undefined],
  ];
  while (pending.length > 0) {
    const [e, bound] = pending.pop()!;
    const s = sym(e);
    if (s !== undefined) {
      if (ANONYMOUS_SLOT_NAMES.has(s) && !bound?.has(s)) result.add(s);
      continue;
    }
    if (!isFunction(e)) continue;
    if (bound === undefined) {
      if (visited.has(e)) continue;
      visited.add(e);
    }
    const op = e.operator;
    if (op === 'Function') {
      if (e.nops < 2) continue;
      const names = new Set(bound);
      for (const n of functionLiteralBoundNames(e.ops.slice(1))) names.add(n);
      pending.push([e.ops[0], names]);
      continue;
    }
    if (ANONYMOUS_SLOT_NAMES.has(op) && !bound?.has(op)) result.add(op);
    // The stage of a `Pipe` (its second operand) takes its slots from the
    // pipe: the `_` in `Pipe(ys, Multiply(_, 2))` is the piped value `ys`,
    // as in the Epsil parser, which makes such a stage a `Function` literal.
    // So only the value operand is walked.
    if (op === 'Pipe' && e.nops === 2) {
      pending.push([e.ops[0], bound]);
      continue;
    }
    // A store-backed list holds only numbers, which are never a slot, so it
    // is not walked (walking it would box every element).
    if ((e as { _numericStore?: unknown })._numericStore !== undefined)
      continue;
    for (const x of e.ops) pending.push([x, bound]);
  }
  return result;
}

/**
 * A captured symbol of a function literal: a name that the body reads from
 * the scope that the literal is defined in, with one occurrence of it in the
 * body. The type of the occurrence is the type that the body, and so the
 * type of the literal, was derived with.
 */
export type CapturedSymbol = { name: string; occurrence: Expression };

/** The captured symbols of each canonical function literal, see
 * `capturedSymbols()`. A canonical literal does not change, so its body is
 * walked one time. */
const CAPTURED_SYMBOLS = new WeakMap<object, readonly CapturedSymbol[]>();

/**
 * The symbols of the body of the canonical function literal `literal` that
 * a call reads from the scope the literal is defined in, one entry for each
 * name. An occurrence is captured when it is bound to a binding outside the
 * literal, or to the valueless copy that the body scope declared for a free
 * symbol (a call frame hides that copy, and the call reads the outer binding
 * of the name). These are not captured: a constant, a parameter of a
 * function literal, a binding of a nested scope of the body (the index of a
 * `Sum`, a local of a nested block), and a local of the body scope (a `let`
 * local, an assignment local).
 *
 * The walk reads each node of the body one time, so a body that shares its
 * operands is not unfolded.
 */
export function capturedSymbols(
  literal: Expression
): readonly CapturedSymbol[] {
  const cached = CAPTURED_SYMBOLS.get(literal);
  if (cached !== undefined) return cached;
  const result: CapturedSymbol[] = [];
  if (!isFunction(literal, 'Function')) return result;
  const body = literal.ops[0];
  const bodyScope = body.isScoped ? body.localScope : undefined;
  const occurrences = new Map<string, Expression>();
  const nested = new Set<object>();
  const seen = new Set<Expression>();
  const visit = (e: Expression): void => {
    if (seen.has(e)) return;
    seen.add(e);
    if (isSymbol(e)) {
      if (!occurrences.has(e.symbol)) occurrences.set(e.symbol, e);
      return;
    }
    if (!isFunction(e) || e._numericStore !== undefined) return;
    if (e !== body && e.isScoped && e.localScope !== undefined)
      for (const b of e.localScope.bindings.values())
        if ('value' in b) nested.add(b.value);
    for (const op of e.ops) visit(op);
  };
  visit(body);
  const assignmentLocals =
    bodyScope === undefined ? undefined : assignmentLocalsOf(bodyScope);
  for (const [name, occurrence] of occurrences) {
    const def = occurrence.valueDefinition;
    if (def === undefined || def.isConstant || def._blockLocal === true)
      continue;
    if (isFunctionLiteralParameter(def) || nested.has(def)) continue;
    const own = bodyScope?.bindings.get(name);
    if (own !== undefined && 'value' in own && own.value === def) {
      // A binding of the body scope is captured only when it is the
      // valueless copy that the body scope declared for a free symbol.
      if (!def.inferredType || def.value !== undefined) continue;
      if (assignmentLocals?.includes(name) === true) continue;
    }
    result.push({ name, occurrence });
  }
  CAPTURED_SYMBOLS.set(literal, result);
  return result;
}

/** The binding that a call of `literal` reads for the captured symbol
 * `entry`: the binding of the name in the scope that encloses the body of
 * the literal, or `undefined` when there is none. */
function outerBindingOf(
  literal: Expression,
  entry: CapturedSymbol
): BoxedValueDefinition | undefined {
  const body = isFunction(literal, 'Function') ? literal.ops[0] : undefined;
  const bodyScope = body?.isScoped ? body.localScope : undefined;
  for (let s: Scope | null | undefined = bodyScope?.parent; s; s = s.parent) {
    const b = s.bindings.get(entry.name);
    if (b === undefined) continue;
    return 'value' in b ? b.value : undefined;
  }
  return undefined;
}

/** For each definition made from a function literal, the type of each
 * binding that a call of the literal reads for a captured symbol, when the
 * type of the definition was inferred (`noteDefinitionCapturedTypes()`). */
const DEFINITION_CAPTURED_TYPES = new WeakMap<
  object,
  ReadonlyArray<readonly [BoxedValueDefinition, BoxedType]>
>();

/**
 * Record, for the definition `def` whose type the engine infers from the
 * function literal `literal` now, the type of each binding that a call of
 * the literal reads for a captured symbol (`capturedSymbols()`): the
 * binding of the occurrence, or, for a copy that the body scope declared,
 * the outer binding of the name. A later change of one of these types is
 * what makes the inferred type of `def` outdated (`capturedTypesWidened()`).
 *
 * The record is journaled: a restore of a checkpoint brings back the record
 * that was in force (`journalCheckpointMemoEntry()`).
 */
export function noteDefinitionCapturedTypes(
  def: object,
  literal: Expression
): void {
  if (!isFunction(literal, 'Function')) return;
  const bindings: Array<readonly [BoxedValueDefinition, BoxedType]> = [];
  for (const entry of capturedSymbols(literal)) {
    const own = entry.occurrence.valueDefinition;
    const binding =
      own !== undefined && own.inferredType && own.value === undefined
        ? (outerBindingOf(literal, entry) ?? own)
        : own;
    if (binding !== undefined) bindings.push([binding, binding.type] as const);
  }
  if (bindings.length === 0 && !DEFINITION_CAPTURED_TYPES.has(def)) return;
  journalCheckpointMemoEntry(
    literal.engine,
    DEFINITION_CAPTURED_TYPES,
    def,
    'definition-captured-types'
  );
  if (bindings.length === 0) DEFINITION_CAPTURED_TYPES.delete(def);
  else DEFINITION_CAPTURED_TYPES.set(def, bindings);
}

/**
 * True when a binding that a call of the literal of the definition `def`
 * reads for a captured symbol has a type now that is not a subtype of its
 * type when the type of `def` was inferred (`noteDefinitionCapturedTypes()`).
 *
 * The type that a definition inferred from its literal (the signature of
 * `g(x) := [-x, y]`, or the type of `let g = (x) => [-x, y]`) is not
 * inferred again when such a type changes, so a call can then give a value
 * outside the type that the call is typed with. A change to `unknown` gives
 * no evidence of that.
 * (User decision 2026-10-25, option (c) of CE-473 in `ROADMAP.md`.)
 */
export function capturedTypesWidened(def: object): boolean {
  const snapshot = DEFINITION_CAPTURED_TYPES.get(def);
  if (snapshot === undefined) return false;
  for (const [binding, before] of snapshot) {
    const now = binding.type;
    if (now === before || now.isUnknown) continue;
    if (!isSubtype(now.type, before.type)) return true;
  }
  return false;
}

/**
 * The value of a call of a definition made from a function literal, when
 * `checked` is true (a captured symbol of the literal changed type since the
 * type of the definition was inferred, or holds a value of another type than
 * the body was typed with) and `result`, the value of the call, is not of
 * `callType`, the static type of the call: an `incompatible-type` error, as
 * a library operator gives for an operand of the wrong type. `undefined`
 * otherwise.
 *
 * The comparison is with the type of the call node, not with the result of
 * the signature: a call that maps the function over a list
 * (`g([1, 2])`), or a partial application (`g(1)` for a function of two
 * parameters), is typed by its node, which describes that value.
 * (User decision 2026-10-25, option (c) of CE-473 in `ROADMAP.md`.)
 */
export function resultOutsideCallType(
  ce: Expression['engine'],
  callType: BoxedType,
  checked: boolean,
  result: Expression | undefined
): Expression | undefined {
  if (!checked || result === undefined || !result.isValid) return undefined;
  if (
    callType.isUnknown ||
    result.type.isUnknown ||
    result.type.matches(callType)
  )
    return undefined;
  return ce.typeError(callType.type, result.type, result);
}
