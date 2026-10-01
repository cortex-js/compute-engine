import type {
  FunctionSignature,
  ListType,
  NamedElement,
  Type,
  TypeParameter,
  TypeReference,
  TypeResolver,
} from './types.js';
import { typeToString } from './serialize.js';
import { RANGE_STRUCTURAL_TYPE, STRING_STRUCTURAL_TYPE } from './primitive.js';
import { declarationOf, withTypeArguments } from './reference.js';
import { subtypingVarianceOf } from './variance.js';

/**
 * Type variables (parametric polymorphism), type-layer half.
 *
 * A **polytype** is a function signature carrying a `where` clause
 * (`typeParams`); its variables (`{ kind: 'variable' }`) are quantified over
 * that one arm (rank-1, per-arm — see
 * `docs/TYPE-SYSTEM.md`).
 *
 * This module owns the three variable-level operations the rest of the type
 * layer needs: what a type's free variables are, how a substitution is applied
 * (as a PURE REBUILD), and whether a declared type's clause is well-formed.
 * The call-site solver (`inferTypeArguments`) is phase 2.
 */

//
// ── Errors ───────────────────────────────────────────────────────────────────
//

/** The declaration-time violations and generic-alias error matrix of
 * `docs/TYPE-SYSTEM.md`. */
export type TypeVariableErrorCode =
  | 'unresolved-type-variable'
  | 'unsolvable-type-variable'
  | 'unsupported-variable-position'
  | 'reserved-type-name'
  /** The `is` protocol-conformance slot of a `where` clause needs a
   * conformance ORACLE to mean anything (`TypeResolver.conformsTo`, supplied
   * by the engine). Declaring a type that carries one through a resolver-less
   * route — where the constraint could only be silently ignored — fails with
   * this code. */
  | 'protocol-conformance-unsupported'
  /** A PROTOCOL name used where a type is expected (`(x: Comparable) -> …`).
   * Protocols are not types (P8: they share no names with them), so the name
   * never resolves; without this code the author only sees a generic "unknown
   * type" and no way to the constrained-variable spelling that is meant. Raised
   * by the ENGINE's resolver, the only route that can see a protocol registry. */
  | 'protocol-in-type-position'
  /** A generic alias applied to the wrong number of type arguments — including
   * a bare use (`let p: Pair`), an empty list (`Pair<>`), and arguments on a
   * name that takes none. */
  | 'generic-alias-arity'
  /** A type argument that does not satisfy its parameter's declared bound
   * (A7: an OPEN argument is judged by its own declared bound). */
  | 'generic-alias-bound'
  /** A generic alias applied inside its own body. */
  | 'generic-alias-self-reference'
  /** A `type X<…>` spelling over a forward-reference placeholder. */
  | 'generic-alias-forward-reference'
  /** A clause parameter the alias body never mentions: under transparency a
   * phantom parameter is meaningless. */
  | 'generic-alias-unused-parameter'
  /** A parameterized nominal type whose body contradicts the variance its
   * clause declares — or the `out` a missing marker declares (§4.4). */
  | 'variance-violation'
  /** A dimension variable (one that occurs in a length slot, `list<T^N>`)
   * declared with a bound that is not an integer type: a length is a positive
   * integer, so `where N: string` or `where N: real` can never be met. */
  | 'dimension-bound-not-integer'
  /** A value variable (a length, `list<T^N>`) with an `is` protocol slot: a
   * value is not a type that could conform to a protocol. */
  | 'value-variable-protocol'
  /** A type argument of the wrong KIND for its parameter: a type where a
   * nominal type's value parameter expects a value (`permutation<integer>`
   * for `type permutation<N> = list<integer^N>`). The other direction — a
   * value where a type parameter expects a type (`tree<3>`) — is a legal
   * singleton type and is admitted by the ordinary bound check. */
  | 'type-argument-kind';

/** An `Error` carrying one of the {@link TypeVariableErrorCode}s.
 *
 * The code is ALSO the head of the message: `parseType()` wraps a thrown error
 * in a new `Error` (`Failed to parse type "…": …`), which would drop a
 * property-only code. */
export class TypeVariableError extends Error {
  code: TypeVariableErrorCode;
  constructor(code: TypeVariableErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

function fail(code: TypeVariableErrorCode, message: string): never {
  throw new TypeVariableError(code, message);
}

/** Type names that cannot be declared (`ce.declareType('where', …)`).
 *
 * `where` is the quantifier clause keyword of the type grammar. `Self` is the
 * protocol substitution token (ruling P12): it is resolved by the protocol
 * wrapper BEFORE the registry is consulted, so it must never enter the
 * registry — as a type name or as a type-variable name. */
export const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
  'where',
  'Self',
]);

export function isReservedTypeName(name: string): boolean {
  return RESERVED_TYPE_NAMES.has(name);
}

//
// ── Predicates ───────────────────────────────────────────────────────────────
//

/**
 * True when `t` is a polytype: a signature carrying a `where` clause, or an
 * overload set (intersection) with at least one such arm.
 *
 * SHALLOW by construction — polytypes are legal only as signatures (§4.1), so
 * this is O(1) (O(#arms) for an overload set) and never a tree walk. It is what
 * `BoxedType.isPolymorphic` stores at construction time.
 */
export function isPolymorphicType(t: Type): boolean {
  if (typeof t !== 'object') return false;
  if (t.kind === 'signature')
    return t.typeParams !== undefined && t.typeParams.length > 0;
  if (t.kind === 'intersection')
    return t.types.some(
      (arm) =>
        typeof arm === 'object' &&
        arm.kind === 'signature' &&
        arm.typeParams !== undefined &&
        arm.typeParams.length > 0
    );
  return false;
}

//
// ── Free variables ───────────────────────────────────────────────────────────
//

/**
 * The names of the type variables occurring FREE in `t` — i.e. not bound by a
 * `where` clause on an enclosing (or on `t`'s own) signature.
 *
 * `freeTypeVariables('(T) -> T where T')` is therefore empty, while
 * `freeTypeVariables('(T) -> T')` (an open, internally-constructed type) is
 * `{T}`.
 */
export function freeTypeVariables(t: Type): Set<string> {
  const result = new Set<string>();
  collectFreeVariables(t, undefined, result);
  return result;
}

/**
 * How many times each type variable occurs FREE in `t` — {@linkcode
 * freeTypeVariables} counting instead of de-duplicating, over the same walk.
 *
 * The distinction a caller needs it for: a variable occurring ONCE relates
 * nothing (it is interchangeable with its bound at that single position),
 * while one occurring twice or more expresses a contract between positions.
 */
export function freeTypeVariableOccurrences(t: Type): Map<string, number> {
  const counts = new Map<string, number>();
  collectFreeVariables(t, undefined, {
    add: (name) => void counts.set(name, (counts.get(name) ?? 0) + 1),
  });
  return counts;
}

/** Where {@linkcode collectFreeVariables} reports an occurrence. A `Set` is
 * one (de-duplicating); a counter is another. */
interface VariableSink {
  add(name: string): void;
}

function collectFreeVariables(
  t: Type,
  bound: ReadonlySet<string> | undefined,
  into: VariableSink
): void {
  if (typeof t === 'string') return;
  switch (t.kind) {
    case 'variable':
      if (bound === undefined || !bound.has(t.name)) into.add(t.name);
      return;
    case 'signature': {
      let scope = bound;
      if (t.typeParams !== undefined && t.typeParams.length > 0) {
        scope = new Set(bound);
        for (const p of t.typeParams) (scope as Set<string>).add(p.name);
        // A bound is ground (§7.2), but walk it anyway: an ill-formed one is
        // reported by `validateDeclaredType`, not silently ignored here.
        for (const p of t.typeParams)
          if (p.bound !== undefined) collectFreeVariables(p.bound, bound, into);
      }
      for (const arg of signatureElements(t))
        collectFreeVariables(arg.type, scope, into);
      collectFreeVariables(t.result, scope, into);
      return;
    }
    case 'union':
    case 'intersection':
      for (const x of t.types) collectFreeVariables(x, bound, into);
      return;
    case 'negation':
      collectFreeVariables(t.type, bound, into);
      return;
    case 'list':
      // A dimension variable occurs FREE in a length slot exactly as a type
      // variable does in an element slot.
      if (t.dimensionVariables !== undefined)
        for (const name of t.dimensionVariables)
          if (name !== undefined && (bound === undefined || !bound.has(name)))
            into.add(name);
      collectFreeVariables(t.elements, bound, into);
      return;
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      collectFreeVariables(t.elements, bound, into);
      return;
    case 'tuple':
      for (const el of t.elements) collectFreeVariables(el.type, bound, into);
      return;
    case 'dictionary':
      collectFreeVariables(t.values, bound, into);
      return;
    case 'record':
    // An object type's stored fields are ordinary type positions: a variable
    // occurring in one is free exactly as it would be in a record field.
    // (What differs is its VARIANCE, which `variance.ts` decides, not this
    // walk.)
    case 'object':
      for (const x of Object.values(t.elements))
        collectFreeVariables(x, bound, into);
      return;
    case 'reference':
      // An APPLIED reference (`tree<T>`) carries its arguments, and a variable
      // may occur only there — without this, `(tree<T>) -> T where T` reads
      // as ground. The `def` is NOT followed: a nominal reference is opaque,
      // and its body's variables are bound by its own clause.
      if (t.args !== undefined)
        for (const a of t.args) collectFreeVariables(a, bound, into);
      return;
    default:
      return;
  }
}

/**
 * True when `t` has at least one FREE type variable — the predicate-only
 * reading of {@link freeTypeVariables}.
 *
 * Short-circuits on the first occurrence and allocates nothing, which matters:
 * the solver asks this question at EVERY node it visits (the skeleton walk, the
 * pattern walk, every bound it records), and answering it by building a `Set`
 * of names made solving quadratic in the depth of the type.
 */
export function hasFreeTypeVariables(t: Type): boolean {
  return hasFreeVariables(t, undefined);
}

function hasFreeVariables(
  t: Type,
  bound: ReadonlySet<string> | undefined
): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'variable':
      return bound === undefined || !bound.has(t.name);
    case 'signature': {
      let scope = bound;
      if (t.typeParams !== undefined && t.typeParams.length > 0) {
        scope = new Set(bound);
        for (const p of t.typeParams) (scope as Set<string>).add(p.name);
        // A bound is ground (§7.2), but walk it anyway — see
        // `collectFreeVariables`.
        for (const p of t.typeParams)
          if (p.bound !== undefined && hasFreeVariables(p.bound, bound))
            return true;
      }
      for (const arg of signatureElements(t))
        if (hasFreeVariables(arg.type, scope)) return true;
      return hasFreeVariables(t.result, scope);
    }
    case 'union':
    case 'intersection':
      for (const x of t.types) if (hasFreeVariables(x, bound)) return true;
      return false;
    case 'negation':
      return hasFreeVariables(t.type, bound);
    case 'list':
      if (t.dimensionVariables !== undefined)
        for (const name of t.dimensionVariables)
          if (name !== undefined && (bound === undefined || !bound.has(name)))
            return true;
      return hasFreeVariables(t.elements, bound);
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return hasFreeVariables(t.elements, bound);
    case 'tuple':
      for (const el of t.elements)
        if (hasFreeVariables(el.type, bound)) return true;
      return false;
    case 'dictionary':
      return hasFreeVariables(t.values, bound);
    case 'record':
    case 'object':
      for (const x of Object.values(t.elements))
        if (hasFreeVariables(x, bound)) return true;
      return false;
    case 'reference':
      // Arguments only — see `collectFreeVariables`.
      if (t.args !== undefined)
        for (const a of t.args) if (hasFreeVariables(a, bound)) return true;
      return false;
    default:
      return false;
  }
}

/** The argument elements of a signature, in order (required, optional,
 * variadic). */
function signatureElements(t: FunctionSignature): NamedElement[] {
  const result: NamedElement[] = [];
  if (t.args) result.push(...t.args);
  if (t.optArgs) result.push(...t.optArgs);
  if (t.variadicArg) result.push(t.variadicArg);
  return result;
}

//
// ── Substitution ─────────────────────────────────────────────────────────────
//

/** Own-property membership, for the string-keyed maps this module builds from
 * AUTHOR-SUPPLIED variable names — `__proto__` is a legal type-variable name
 * (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`), so neither a plain `in` nor a bare index is
 * safe on a map that may have come from a caller's object literal. */
function hasOwn(map: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * `t` with every free occurrence of a variable named in `bindings` replaced by
 * its binding.
 *
 * **Pure rebuild, no mutation.** Polytypes are SHARED objects — interned by
 * `parseType()`'s `TYPE_CACHE` (and deep-frozen there) and stored on
 * definitions — so every node on the substitution path is rebuilt and nothing
 * is ever written in place. A subtree with no substituted occurrence is
 * returned by identity, so an instantiation allocates only along the path it
 * touches.
 *
 * A signature's own clause is INSTANTIATED, not shadowed: substituting `{T:
 * integer}` into `(T) -> T where T` yields the ground `(integer) -> integer`
 * with the clause (and just the substituted entries) removed. That is what a
 * call-site instantiation means; there is no rank-2 nesting in v1 for the
 * shadowing reading to matter to.
 */
/**
 * The definition a STRUCTURAL alias reference stands for, instantiated at that
 * reference's own arguments.
 *
 * A generic alias is normally expanded eagerly at parse time, so a consumer
 * rarely meets one as a reference. A reference captured BEFORE its declaration
 * landed — a forward reference inside another type's body — is the exception:
 * it is still a reference when the check runs, and its `def` is the OPEN body
 * (`leaf | node<T>`). Unfolding to that body without substituting the
 * application's arguments compares a ground type against a type VARIABLE, which
 * is what made `node<integer> <: tree<integer>` false, and what made the
 * solver read `plus(lit(5), lit(2))` as `plus<unknown>` instead of applying
 * Rule U's ground-arm binding.
 *
 * Returns `undefined` when there is nothing to unfold to, or when the arity
 * does not line up (a mismatch is a declaration-time error; here it just means
 * "cannot decide structurally").
 *
 * Shared by `subtype.ts`'s alias unfold and `walkPattern`'s below, so the two
 * cannot drift.
 */
export function aliasDefinitionAt(
  ref: Readonly<TypeReference>
): Type | undefined {
  const def = ref.def;
  if (def === undefined) return undefined;
  const params = declarationOf(ref as TypeReference).typeParams;
  const args = ref.args;
  if (params === undefined || params.length === 0 || args === undefined)
    return def;
  if (params.length !== args.length) return undefined;
  const bindings: Record<string, Type> = {};
  params.forEach((p, i) => (bindings[p.name] = args[i]));
  return substituteTypeVariables(def, bindings);
}

export function substituteTypeVariables(
  t: Type,
  bindings: Readonly<Record<string, Type>>
): Type {
  if (typeof t === 'string') return t;
  switch (t.kind) {
    case 'variable': {
      // OWN properties only: a variable legally named `__proto__` (or
      // `toString`) must not read an inherited `Object.prototype` member.
      const binding = hasOwn(bindings, t.name) ? bindings[t.name] : undefined;
      return binding === undefined ? t : binding;
    }
    case 'signature': {
      const args = substituteElements(t.args, bindings);
      const optArgs = substituteElements(t.optArgs, bindings);
      const variadicArg =
        t.variadicArg === undefined
          ? undefined
          : substituteElement(t.variadicArg, bindings);
      const result = substituteTypeVariables(t.result, bindings);
      const typeParams = t.typeParams?.filter(
        (p) => !hasOwn(bindings, p.name) || bindings[p.name] === undefined
      );
      const clauseChanged =
        t.typeParams !== undefined &&
        typeParams!.length !== t.typeParams.length;
      if (
        !clauseChanged &&
        args === t.args &&
        optArgs === t.optArgs &&
        variadicArg === t.variadicArg &&
        result === t.result
      )
        return t;
      const next: FunctionSignature = { ...t, result };
      if (args !== undefined) next.args = args;
      if (optArgs !== undefined) next.optArgs = optArgs;
      if (variadicArg !== undefined) next.variadicArg = variadicArg;
      if (clauseChanged) {
        if (typeParams!.length === 0) delete next.typeParams;
        else next.typeParams = typeParams;
      }
      return next;
    }
    case 'union':
    case 'intersection': {
      const types = substituteAll(t.types, bindings);
      return types === t.types ? t : { ...t, types };
    }
    case 'negation': {
      const type = substituteTypeVariables(t.type, bindings);
      return type === t.type ? t : { ...t, type };
    }
    case 'list': {
      const elements = substituteTypeVariables(t.elements, bindings);
      const shape = substituteDimensions(t, bindings);
      if (elements === t.elements && shape === undefined) return t;
      const next: ListType = { ...t, elements };
      if (shape !== undefined) {
        next.dimensions = shape.dimensions;
        if (shape.dimensionVariables === undefined)
          delete next.dimensionVariables;
        else next.dimensionVariables = shape.dimensionVariables;
      }
      return next;
    }
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const elements = substituteTypeVariables(t.elements, bindings);
      return elements === t.elements ? t : { ...t, elements };
    }
    case 'tuple': {
      const elements = substituteElements(t.elements, bindings)!;
      return elements === t.elements ? t : { ...t, elements };
    }
    case 'dictionary': {
      const values = substituteTypeVariables(t.values, bindings);
      return values === t.values ? t : { ...t, values };
    }
    case 'record':
    case 'object': {
      let changed = false;
      const elements: Record<string, Type> = {};
      for (const [key, value] of Object.entries(t.elements)) {
        const next = substituteTypeVariables(value, bindings);
        if (next !== value) changed = true;
        elements[key] = next;
      }
      return changed ? { ...t, elements } : t;
    }
    case 'reference': {
      // Substitution reaches INTO an application (`tree<T>[T := integer]` is
      // `tree<integer>`) but never through it: the reference stays unexpanded.
      if (t.args === undefined) return t;
      const args = substituteAll(t.args, bindings);
      return args === t.args ? t : withTypeArguments(t, args);
    }
    default:
      return t;
  }
}

/**
 * The length slots of a list pattern after substitution, or `undefined` when
 * no dimension variable of `t` is bound.
 *
 * A dimension variable bound to a value-literal type holding a positive
 * integer becomes that length; one bound to another variable (a renaming, as
 * `markDimensionVariables` does) keeps the slot open under the new name; any
 * other binding — the S3 fallback `integer<1..>`, the display `unknown` — is
 * "length not known", so the slot stays `-1` and the name is dropped.
 */
function substituteDimensions(
  t: ListType,
  bindings: Readonly<Record<string, Type>>
):
  | { dimensions: number[]; dimensionVariables?: (string | undefined)[] }
  | undefined {
  const names = t.dimensionVariables;
  if (names === undefined || t.dimensions === undefined) return undefined;
  let changed = false;
  const dimensions = [...t.dimensions];
  const dimensionVariables: (string | undefined)[] = [...names];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name === undefined || !hasOwn(bindings, name)) continue;
    const binding = bindings[name];
    if (binding === undefined) continue;
    changed = true;
    const length = dimensionOf(binding);
    if (length !== undefined) {
      dimensions[i] = length;
      dimensionVariables[i] = undefined;
    } else if (typeof binding === 'object' && binding.kind === 'variable') {
      dimensionVariables[i] = binding.name;
    } else {
      dimensions[i] = -1;
      dimensionVariables[i] = undefined;
    }
  }
  if (!changed) return undefined;
  return dimensionVariables.some((n) => n !== undefined)
    ? { dimensions, dimensionVariables }
    : { dimensions };
}

/**
 * The bound a value variable carries when its clause declares none. Today
 * every value variable is a LENGTH (it occurs in a length slot or fills a
 * nominal type's length parameter), and a length is a positive integer; a
 * future boolean or string parameter will declare its own bound.
 */
export const LENGTH_BOUND: Type = Object.freeze({
  kind: 'numeric',
  type: 'integer',
  lower: 1,
}) as Type;

/**
 * The VALUE a type pins, when it pins exactly one: a value-literal type
 * (`3`, the type of the literal `3` and of `Length([1,2,3])`; a string or
 * boolean value type once those literals carry one), or a singleton numeric
 * range (`integer<3..3>`, the type of a symbol declared that way). `undefined`
 * for every other type — including a plain `integer`, which admits a value
 * without naming it.
 */
export function pinnedValueOf(t: Type): unknown {
  if (typeof t !== 'object') return undefined;
  if (t.kind === 'value') {
    const v = t.value;
    return typeof v === 'number' ||
      typeof v === 'string' ||
      typeof v === 'boolean'
      ? v
      : undefined;
  }
  if (
    t.kind === 'numeric' &&
    t.lower !== undefined &&
    t.lower === t.upper &&
    Number.isFinite(t.lower) &&
    t.lowerOpen !== true &&
    t.upperOpen !== true
  )
    return t.lower;
  return undefined;
}

/**
 * The LENGTH a type pins, when it pins one: {@link pinnedValueOf} restricted
 * to a positive integer, which is what a length slot can hold.
 */
export function dimensionOf(t: Type): number | undefined {
  const v = pinnedValueOf(t);
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

/** The value-literal type that pins the value `v` (a length `n` is `{ kind:
 * 'value', value: n }`, the same node `ce.box(n).type` is). */
export function valueLiteralType(v: number | string | boolean): Type {
  return { kind: 'value', value: v };
}

/**
 * `t` with every occurrence of a variable in `names` marked as a VALUE
 * variable (`{ kind: 'variable', name, value: true }`), so a consumer meeting
 * the node at a type position (`n: N`) knows it denotes a value without
 * consulting the clause. A pure rebuild through the substitution walk (a
 * variable bound to a variable is a renaming, which keeps a length slot open
 * under the same name).
 */
export function markValueVariables(t: Type, names: ReadonlySet<string>): Type {
  if (names.size === 0) return t;
  const bindings: Record<string, Type> = Object.create(null);
  for (const name of names)
    bindings[name] = { kind: 'variable', name, value: true };
  return substituteTypeVariables(t, bindings);
}

function substituteAll(
  types: Type[],
  bindings: Readonly<Record<string, Type>>
): Type[] {
  let changed = false;
  const result = types.map((x) => {
    const next = substituteTypeVariables(x, bindings);
    if (next !== x) changed = true;
    return next;
  });
  return changed ? result : types;
}

function substituteElement(
  el: NamedElement,
  bindings: Readonly<Record<string, Type>>
): NamedElement {
  const type = substituteTypeVariables(el.type, bindings);
  return type === el.type ? el : { ...el, type };
}

function substituteElements(
  elements: NamedElement[] | undefined,
  bindings: Readonly<Record<string, Type>>
): NamedElement[] | undefined {
  if (elements === undefined) return undefined;
  let changed = false;
  const result = elements.map((el) => {
    const next = substituteElement(el, bindings);
    if (next !== el) changed = true;
    return next;
  });
  return changed ? result : elements;
}

//
// ── Declaration-time validation (§7.2) ───────────────────────────────────────
//

/**
 * Validate a declared type's `where` clauses and variable occurrences, per
 * arm. Throws a {@link TypeVariableError} on the first violation; returns
 * normally for every type with no clause and no variable — including every
 * type in the pre-generics language.
 *
 * Runs where a declared type is BOXED: `parseType()` (whenever the parse saw a
 * clause) and the `BoxedType` constructor's object route.
 */
export function validateDeclaredType(t: Type, resolver?: TypeResolver): void {
  if (typeof t === 'object' && t.kind === 'intersection') {
    // An overload set: each arm carries (and is validated against) its own
    // clause.
    for (const arm of t.types) validateArm(arm, resolver);
    return;
  }
  validateArm(t, resolver);
}

function validateArm(t: Type, resolver?: TypeResolver): void {
  if (
    typeof t === 'object' &&
    t.kind === 'signature' &&
    t.typeParams !== undefined &&
    t.typeParams.length > 0
  ) {
    validatePolytypeArm(t, t.typeParams, resolver);
    return;
  }

  // Not a polytype: no clause may appear anywhere inside it, and no variable
  // may occur free.
  const declared = new Set<string>();
  const seen = new Set<string>();
  walk(t, declared, null, seen);
}

function validatePolytypeArm(
  arm: FunctionSignature,
  typeParams: TypeParameter[],
  resolver?: TypeResolver
): void {
  const declared = new Set<string>();
  for (const p of typeParams) {
    if (declared.has(p.name))
      fail(
        'unsupported-variable-position',
        `The type variable \`${p.name}\` is declared more than once in the same \`where\` clause`
      );
    declared.add(p.name);
    // The `is` slot is ACCEPTED (protocols design P19) — but only where a
    // conformance oracle exists to check it against at the call site. Without
    // one the constraint could only be silently dropped, so a resolver-less
    // route keeps rejecting it: the type layer alone stays safe.
    if (
      p.protocols !== undefined &&
      p.protocols.length > 0 &&
      resolver?.conformsTo === undefined
    )
      fail(
        'protocol-conformance-unsupported',
        `Protocol conformance constraints (\`where ${p.name} is ${p.protocols.join(' & ')}\`) require an engine's protocol registry; this type was declared without one`
      );
  }

  // The value variables of the arm: the clause's `kind` entries, and — for a
  // signature built structurally, whose clause carries no kinds — every
  // variable that occurs in a length slot or fills a value parameter.
  validateValueParameters(typeParams, valueVariableNamesOf(arm));

  // v1: a bound must be GROUND — no variables (no `T: list<U>`, no F-bounded
  // `T: comparable<T>`) — and cannot itself carry a clause.
  for (const p of typeParams) {
    if (p.bound === undefined) continue;
    if (freeTypeVariables(p.bound).size > 0)
      fail(
        'unsupported-variable-position',
        `The bound of the type variable \`${p.name}\` must be a ground type: \`${typeToString(p.bound)}\` refers to a type variable`
      );
    const boundVars = new Set<string>();
    walk(p.bound, declared, 'bound', boundVars);
  }

  const inArgs = new Set<string>();
  for (const el of signatureElements(arm))
    walk(el.type, declared, null, inArgs);
  const inResult = new Set<string>();
  walk(arm.result, declared, null, inResult);

  // Result-reachability: a variable that never occurs in an argument position
  // cannot be solved — whether it occurs only in the result, or nowhere at all.
  for (const p of typeParams) {
    if (inArgs.has(p.name)) continue;
    if (inResult.has(p.name))
      fail(
        'unsolvable-type-variable',
        `The type variable \`${p.name}\` occurs only in the result of its signature, so it can never be solved. Write the ground type directly`
      );
    fail(
      'unsolvable-type-variable',
      `The type variable \`${p.name}\` is quantified but never used`
    );
  }
}

/**
 * The checks a VALUE variable's clause entry must pass, shared by a signature
 * arm (`validatePolytypeArm`) and a parameterized type declaration (the
 * engine's `declareType`, after the body is built). `valueNames` is the set
 * of clause names the body uses as values ({@link valueVariableNamesOf}); an
 * entry is checked when its `kind` says value OR the body uses it as one.
 *
 * A value variable stands for a value, not a type: it cannot conform to a
 * protocol. Every value variable today is a LENGTH, so its bound, when
 * written, must be an integer type (`where N: integer<2..>`); the solver
 * further requires every pin to be a positive integer, so `where N: integer`
 * is accepted and admits `1, 2, …` but never `0`.
 */
export function validateValueParameters(
  typeParams: readonly TypeParameter[],
  valueNames: ReadonlySet<string>
): void {
  for (const p of typeParams) {
    if (p.kind !== 'value' && !valueNames.has(p.name)) continue;
    if (p.protocols !== undefined && p.protocols.length > 0)
      fail(
        'value-variable-protocol',
        `The value variable \`${p.name}\` cannot be constrained by a protocol (\`is ${p.protocols.join(' & ')}\`): a value is not a type`
      );
    if (
      p.bound !== undefined &&
      !hasFreeTypeVariables(p.bound) &&
      !algebra().isSubtype(p.bound, 'integer')
    )
      fail(
        'dimension-bound-not-integer',
        `The bound of the dimension variable \`${p.name}\` must be an integer type, but is \`${typeToString(p.bound)}\`: a length is a positive integer`
      );
  }
}

/**
 * The names of the variables `t` uses as VALUES: one in a length slot of a
 * list (`list<T^N>`), one flagged at a type position (`n: N`), and one given
 * as the argument of a nominal type's value parameter (`permutation<N>`).
 *
 * This is the kind-by-position rule as a pure function of the body, for
 * routes that hold no clause with kinds already decided — a structural `Type`
 * body, a declaration whose clause objects are shared with sibling
 * declarations (the sum-type variants), and the solver on any arm.
 */
export function valueVariableNamesOf(t: Type): Set<string> {
  const names = new Set<string>();
  const visit = (x: Type): void => {
    if (typeof x !== 'object') return;
    switch (x.kind) {
      case 'variable':
        if (x.value === true) names.add(x.name);
        return;
      case 'signature':
        for (const el of signatureElements(x)) visit(el.type);
        visit(x.result);
        return;
      case 'union':
      case 'intersection':
        for (const y of x.types) visit(y);
        return;
      case 'negation':
        visit(x.type);
        return;
      case 'list':
        if (x.dimensionVariables !== undefined)
          for (const name of x.dimensionVariables)
            if (name !== undefined) names.add(name);
        visit(x.elements);
        return;
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        visit(x.elements);
        return;
      case 'tuple':
        for (const el of x.elements) visit(el.type);
        return;
      case 'dictionary':
        visit(x.values);
        return;
      case 'record':
      case 'object':
        for (const y of Object.values(x.elements)) visit(y);
        return;
      case 'reference': {
        if (x.args === undefined) return;
        const params = declarationOf(x).typeParams;
        x.args.forEach((a, i) => {
          if (
            params?.[i]?.kind === 'value' &&
            typeof a === 'object' &&
            a.kind === 'variable'
          )
            names.add(a.name);
          visit(a);
        });
        return;
      }
      default:
        return;
    }
  };
  visit(t);
  return names;
}

/**
 * The kind of position a type variable may NOT occur in — the positions whose
 * inference rules the solver does not have. `null` is an allowed position.
 *
 * A UNION arm is no longer one of them (Rule U): a union with a single open
 * arm has an inference rule, spelled in `walkPattern`.
 */
type ForbiddenPosition = 'intersection' | 'negation' | 'bound';

const FORBIDDEN_POSITION_MESSAGE: Readonly<Record<ForbiddenPosition, string>> =
  {
    // Steer to the spelling that replaces it: `T & number` is what an author
    // writes when they mean a CONSTRAINT, and a constraint is a bound.
    intersection:
      'cannot appear in an intersection. To constrain a type variable, declare a bound on it instead: `where T: number`',
    negation: 'cannot appear in a negation',
    bound: 'cannot appear in a bound',
  };

/**
 * Walk `t`, checking every variable occurrence against the v1 position
 * fragment (§3) and rejecting a `where` clause in any nested position.
 *
 * `forbidden` names the enclosing position when variables are not admissible
 * there (an intersection member, a negation or a bound), and is `null`
 * otherwise.
 */
function walk(
  t: Type,
  declared: ReadonlySet<string>,
  forbidden: ForbiddenPosition | null,
  into: Set<string>
): void {
  if (typeof t === 'string') return;
  switch (t.kind) {
    case 'variable':
      if (forbidden !== null)
        fail(
          'unsupported-variable-position',
          `The type variable \`${t.name}\` ${FORBIDDEN_POSITION_MESSAGE[forbidden]}`
        );
      if (!declared.has(t.name))
        fail(
          'unresolved-type-variable',
          `The type variable \`${t.name}\` is not quantified by a \`where\` clause`
        );
      into.add(t.name);
      return;
    case 'signature':
      if (t.typeParams !== undefined && t.typeParams.length > 0)
        fail(
          'unsupported-variable-position',
          'A `where` clause can only quantify a top-level signature (or one arm of an overload set), not a nested one. Parenthesize a nested clause: `((A) -> B where A, B)`'
        );
      // `forbidden` is PROPAGATED, not reset: a nested arrow reached from a
      // forbidden position (an intersection member, a negation, a bound) is
      // itself a forbidden position. An ordinary nested arrow, reached from an
      // allowed position, stays allowed.
      for (const el of signatureElements(t))
        walk(el.type, declared, forbidden, into);
      walk(t.result, declared, forbidden, into);
      return;
    case 'union': {
      // Rule U: a union arm IS an admissible position, but at most one arm of
      // a union may be open. With two open arms nothing at a call site says
      // which arm a value took, so neither variable could be solved —
      // `T | U` is unsolvable by construction, not merely unimplemented.
      const open = t.types.filter((x) => hasFreeTypeVariables(x));
      if (open.length > 1)
        fail(
          'unsupported-variable-position',
          `At most one arm of a union can refer to a type variable, but \`${typeToString(t)}\` has ${open.length}. Nothing at a call site says which arm a value took, so neither variable could be solved`
        );
      for (const x of t.types) walk(x, declared, forbidden, into);
      return;
    }
    case 'intersection':
      for (const x of t.types) walk(x, declared, 'intersection', into);
      return;
    case 'negation':
      walk(t.type, declared, 'negation', into);
      return;
    case 'list':
      // A dimension variable in a length slot is an occurrence like any other:
      // it must be declared, it counts toward solvability, and a forbidden
      // position forbids it too.
      if (t.dimensionVariables !== undefined)
        for (const name of t.dimensionVariables) {
          if (name === undefined) continue;
          if (forbidden !== null)
            fail(
              'unsupported-variable-position',
              `The dimension variable \`${name}\` ${FORBIDDEN_POSITION_MESSAGE[forbidden]}`
            );
          if (!declared.has(name))
            fail(
              'unresolved-type-variable',
              `The dimension variable \`${name}\` is not quantified by a \`where\` clause`
            );
          into.add(name);
        }
      walk(t.elements, declared, forbidden, into);
      return;
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      walk(t.elements, declared, forbidden, into);
      return;
    case 'tuple':
      for (const el of t.elements) walk(el.type, declared, forbidden, into);
      return;
    case 'dictionary':
      walk(t.values, declared, forbidden, into);
      return;
    case 'record':
    case 'object':
      for (const x of Object.values(t.elements))
        walk(x, declared, forbidden, into);
      return;
    case 'reference':
      // The arguments of an application are ordinary positions (variance is
      // Phase 1 and does not change what is LEGAL here).
      if (t.args !== undefined)
        for (const a of t.args) walk(a, declared, forbidden, into);
      return;
    default:
      return;
  }
}

//
// ── The call-site solver (§4.3) ──────────────────────────────────────────────
//

/**
 * The type-algebra primitives the solver needs, injected by `subtype.ts`.
 *
 * `subtype.ts` already imports this module (`substituteTypeVariables`, for
 * α-equivalence), so an ordinary import in the other direction would be a
 * cycle — and the zero-cycle budget is enforced (CLAUDE.md). Injection keeps
 * this module dependency-free while making registration unconditional:
 * `subtype.ts` registers at module load, so the algebra is available to
 * anything that can reach `isSubtype` at all.
 */
export interface TypeAlgebra {
  isSubtype: (a: Type, b: Type) => boolean;
  widen: (...types: Type[]) => Type;
  narrow: (...types: Type[]) => Type;
}

let _algebra: TypeAlgebra | undefined;

/**
 * The flat shape of a list type spelled as nested dimensioned lists, or
 * `undefined` when `t` is not such a type.
 *
 * `list<vector<integer^3>^2>` (a list of two rows of three integers) and
 * `matrix<integer^(2x3)>` describe the same values; the flat spelling is the
 * one the subtype relation and the dimension solver read lengths from. Each
 * level whose elements are a list with DIMENSIONS is merged into its parent:
 * the parent's dimensions (the length `-1`, any length, when it states
 * none) followed by the element's. A level whose elements are a list with
 * no dimensions stops the merge: its rows can differ in length. Used by
 * `isSubtype` (`subtype.ts`) and by the dimension pinning of `walkPattern`.
 */
export function flattenNestedListType(t: Type): Type | undefined {
  if (typeof t !== 'object' || t.kind !== 'list') return undefined;
  let elements = t.elements;
  let dimensions = t.dimensions ?? [-1];
  let merged = false;
  while (
    typeof elements === 'object' &&
    elements.kind === 'list' &&
    elements.dimensions !== undefined
  ) {
    dimensions = [...dimensions, ...elements.dimensions];
    elements = elements.elements;
    merged = true;
  }
  return merged ? { kind: 'list', elements, dimensions } : undefined;
}

/** @internal — called by `subtype.ts` at module load. */
export function _setTypeAlgebra(algebra: TypeAlgebra): void {
  _algebra = algebra;
}

function algebra(): TypeAlgebra {
  // UNCONDITIONAL: `console.assert` is stripped from the minified production
  // build, so an unregistered algebra would surface there as an opaque
  // `Cannot read properties of undefined`.
  if (_algebra === undefined)
    throw new Error(
      'Type algebra not registered: import `./subtype.js` before using the type-variable solver'
    );
  return _algebra;
}

/**
 * Does the GROUND type `t` satisfy the declared upper bound `bound`?
 *
 * The one subtype question the type BUILDER needs (generic-alias argument
 * admission, A7), routed through the INJECTED algebra: a direct
 * `type-builder → subtype` import would close a three-node cycle
 * (`subtype → instantiate → …`), and the zero-cycle budget is enforced.
 *
 * `any` short-circuits, so an unbounded parameter — and the `any` an unbounded
 * open argument reads as — never reaches the algebra at all.
 */
export function satisfiesTypeBound(t: Type, bound: Type): boolean {
  if (bound === 'any') return true;
  return algebra().isSubtype(t, bound);
}

/** A solved instantiation: one ground type per quantified variable. */
export type TypeBindings = Record<string, Type>;

/** Per-position information the solver needs from its embedding (§4.5).
 *
 * All predicates are keyed on the OPERAND index. Omitted ⇒ false everywhere,
 * which is the plain "every operand contributes its type" reading.
 */
export interface InferenceOptions {
  /** The position contributes NO bounds: overlap-deferred admission, a
   * `Spread` operand, a missing-stripped operand, an already-invalid operand
   * (§4.5 gate table). */
  skip?: (index: number) => boolean;
  /** The position holds an INFERABLE symbol whose type is `unknown`/`any`: no
   * bound, and the symbol stays eligible for post-solve narrowing to the
   * instantiated ground parameter (§4.3 bound-join table, last row). */
  inferable?: (index: number) => boolean;
  /** The resolver whose {@link TypeResolver.conformsTo} oracle decides the
   * `where T is P` constraints (protocols design P19). Omitted ⇒ the
   * constraints are not checked (the type layer has no registry of its own). */
  resolver?: TypeResolver;
  /** The operand was admitted by a broadcast LIFT (D10, re-ruled 2026-08-04):
   * the runtime MAPS at such a position, so a bare-variable pattern binds the
   * operand's ELEMENT type (a scalar actual contributes itself). Admission
   * stays checked at the scalar base by the lift gate itself — so the declared
   * bound is NOT re-checked against the solution here. */
  lifted?: (index: number) => boolean;
  /** The operand's PUBLIC type, unwidened. The actuals a type variable sees
   * have every literal projected to its tier (`identity(5)` must bind
   * `T = integer`, never `5`), but a VALUE variable at a bare position
   * (`n: N`) binds from exactly that literal cargo — the `3` of the literal
   * `3`, or of an application typed `3`. Read only for a value variable, only
   * at depth 0. Omitted ⇒ the (widened) actual is read. */
  rawType?: (index: number) => Type | undefined;
  /** An `unknown` nested under a constructor of an operand's type
   * (`tuple<unknown>`) satisfies the upper bounds of the variable it binds
   * PROVISIONALLY, as a top-level `unknown` always does (D8). Set only by
   * the CALL validation (`solveArm`, `generic-instantiation.ts`): a call has
   * the runtime conformance check to fall back on, and the ground path
   * defers the same operand (`overlapsForDeferredValidation`), so the two
   * readings stay in parity (user decision 2026-09-30). Signature
   * subtyping (`Poly <: Ground`) has no runtime re-check and leaves it
   * unset: there a nested `unknown` still refutes. */
  waiveNestedUnknown?: boolean;
}

/** Why an instantiation is unsatisfiable (§8 blame). */
export interface TypeInferenceFailure {
  /** `'bound'` — the solved value violates the variable's DECLARED bound;
   * `'upper'` — it violates an upper bound collected contravariantly;
   * `'protocol'` — it does not conform to a protocol the `is` slot requires
   * (P19). */
  kind: 'bound' | 'upper' | 'protocol';
  /** The offending variable. */
  variable: string;
  /** For a `'protocol'` failure: the protocol the solution fails to conform
   * to. */
  protocol?: string;
  /** The value the variable solved to. */
  solution: Type;
  /** The GROUND type to display as "expected" (§8 rule 1). For `'bound'` this
   * is the declared bound; for `'upper'` the constraining actual. */
  expected: Type;
  /** The operand to blame: the position that pinned the solution for a
   * declared-bound violation, the constraining position for an upper bound
   * (§8 deterministic blame). `undefined` when no position is on record. */
  index?: number;
  /** The §8 supplementary line (variable, solved value, pinning positions,
   * declared bound). */
  detail: string;
  /** For an `'upper'` failure: the value the OTHER constraints pin the
   * variable to. Substituting it into the blamed position's pattern is what
   * makes the reported expected type the ground arrow §8 asks for
   * (`(integer) -> boolean`), rather than the bare constraining type. */
  pin?: Type;
}

export interface TypeInferenceResult {
  /** Total: one entry per quantified variable, always ground. */
  bindings: TypeBindings;
  /** Variables solved to a TOP-LEVEL absorbed top type — `unknown` or `any`
   * contributed by the whole operand at a bare-variable pattern (§4.3 table):
   * their upper bounds are provisionally satisfied (D8). A top type nested
   * under a constructor still absorbs the JOIN, but is NOT listed here,
   * except a nested `unknown` under `InferenceOptions.waiveNestedUnknown`. */
  absorbed: ReadonlySet<string>;
  /** Variables that got NO call-site bound AND carry no declared bound, so S3
   * fell back to `unknown`. Used for DISPLAY only: an error message reads
   * better showing the parameter's ground skeleton (`indexed_collection`) than
   * the impossible-looking `indexed_collection<unknown>`. */
  unbound: ReadonlySet<string>;
  /** False when the structural walk itself did not match (a ground pattern
   * position refuted the actual). The embedding in `validateArguments` ignores
   * this — its own admission gates own accept/reject — but `matches` and the
   * `Poly <: Ground` rule use it. */
  matched: boolean;
  /** Non-empty when a bound constraint failed. */
  failures: ReadonlyArray<TypeInferenceFailure>;
}

interface Bound {
  type: Type;
  index?: number;
  /** Set on the one upper-bound entry contributed by the variable's DECLARED
   * bound (see `uppersOf`) — the only term the D10 lift carve-out waives. */
  declared?: boolean;
  /** True when the bound is the operand's OWN type at a BARE-VARIABLE pattern
   * (the walk's depth-0 case), false when it came out of a constructor
   * recursion. Only a top-level top type waives satisfiability (see
   * `joinBounds`). */
  top?: boolean;
}

interface SolverState {
  params: TypeParameter[];
  declared: Map<string, Type | undefined>;
  lower: Map<string, Bound[]>;
  upper: Map<string, Bound[]>;
  lifted: Set<string>;
  matched: boolean;
  /** The VALUE variables of the arm — the clause's `kind: 'value'` entries
   * plus every clause name the arm uses as a value ({@link
   * valueVariableNamesOf}) — solved by equality rather than by the bound join
   * below. */
  valueParams: Set<string>;
  /** The value each value variable is pinned to, with the first position that
   * pinned it. */
  values: Map<string, { value: unknown; index?: number }>;
  /** A later position that pinned a value variable to a DIFFERENT value. The
   * failure blames that later position and carries the EARLIER value as
   * `expected`; the consumer (`validate.ts`, which renders every `'bound'`
   * failure) substitutes it into the blamed position's pattern, so the message
   * reads "expected `vector<real^3>`, got `vector<integer^2>`". */
  valueFailures: TypeInferenceFailure[];
  rawType?: (index: number) => Type | undefined;
}

/**
 * Pin a value variable to `value` at `index`. A second, equal pin is a no-op;
 * a different one is a structural mismatch (`matched = false`) and a recorded
 * failure blaming the later position — a length has no join.
 */
/**
 * Pin the value variable `name` to `value` at `index`, or refuse.
 *
 * A pin must be a positive integer — every value variable today is a length,
 * and `where N: integer` must not let `0` into a length slot; a value that is
 * not one pins nothing, and the post-solve gate reports it against the
 * pinned-elsewhere value or the bound (`foo(0, [1,2,3])` is rejected on `0`).
 * A positive integer OUTSIDE the variable's declared bound pins nothing
 * either, so a mismatch never propagates from an inadmissible pin and never
 * blames the operand that was right; but it is a bound violation of its own
 * position, recorded as a `'bound'` failure there — otherwise a lone
 * out-of-bound operand (`big([1])` at `vector<number^N> where N:
 * integer<2..>`) would leave `N` unsolved and be admitted at the open
 * pattern. The positive-integer requirement is the one to relax when a
 * boolean or string value parameter arrives.
 */
function pinValue(
  s: SolverState,
  name: string,
  value: unknown,
  index: number | undefined
): void {
  if (
    typeof value !== 'number' &&
    typeof value !== 'string' &&
    typeof value !== 'boolean'
  )
    return;
  const t = valueLiteralType(value);
  if (!algebra().isSubtype(t, LENGTH_BOUND)) return;
  const declared = s.declared.get(name);
  if (declared !== undefined && !algebra().isSubtype(t, declared)) {
    s.matched = false;
    s.valueFailures.push({
      kind: 'bound',
      variable: name,
      solution: t,
      expected: declared,
      index,
      detail: `\`${name}\` is declared with bound \`${typeToString(declared)}\`, but this position requires \`${String(value)}\``,
    });
    return;
  }
  recordValue(s, name, value, index);
}

function recordValue(
  s: SolverState,
  name: string,
  value: unknown,
  index: number | undefined
): void {
  const prior = s.values.get(name);
  if (prior === undefined) {
    s.values.set(name, { value, index });
    return;
  }
  if (prior.value === value) return;
  s.matched = false;
  const at = (i: number | undefined): string =>
    i === undefined ? '' : ` (from argument ${i + 1})`;
  s.valueFailures.push({
    kind: 'bound',
    variable: name,
    solution: valueLiteralType(value as number | string | boolean),
    expected: valueLiteralType(prior.value as number | string | boolean),
    index,
    detail: `\`${name}\` was solved to \`${String(prior.value)}\`${at(prior.index)}, but this position requires \`${String(value)}\``,
  });
}

/**
 * Solve one signature arm's `where` clause against the actual operand types
 * (§4.3). Write-free: the only output is a binding map.
 *
 * Order-independent by construction — the covariant sweep (pass 1 + pass 2a)
 * runs to completion over EVERY position, then the contravariant sweep (pass
 * 2b) collects upper bounds, then S1–S3 solve, then satisfiability is checked.
 * No position is ever solved with a partial solution.
 */
export function solveTypeArguments(
  arm: FunctionSignature,
  actuals: ReadonlyArray<Type | undefined>,
  opts?: InferenceOptions
): TypeInferenceResult {
  const params = arm.typeParams ?? [];
  if (params.length === 0)
    return {
      bindings: Object.create(null),
      absorbed: new Set(),
      unbound: new Set(),
      matched: true,
      failures: [],
    };

  const s: SolverState = {
    params,
    declared: new Map(params.map((p) => [p.name, p.bound])),
    lower: new Map(),
    upper: new Map(),
    lifted: new Set(),
    matched: true,
    valueParams: new Set([
      ...params.filter((p) => p.kind === 'value').map((p) => p.name),
      ...[...valueVariableNamesOf(arm)].filter((n) =>
        params.some((p) => p.name === n)
      ),
    ]),
    values: new Map(),
    valueFailures: [],
    rawType: opts?.rawType,
  };

  const positions = parameterPositions(arm, actuals.length);

  // D10 (§4.4, re-ruled 2026-08-04): what a LIFT-ADMITTED operand contributes
  // at a bare-variable pattern is its ELEMENT type, not the whole actual —
  // the runtime maps at every lift-admitted position, so the variable
  // semantically denotes one element. Computed once, shared by both sweeps.
  const contributed = positions.map((pattern, i) => {
    const actual = actuals[i];
    if (pattern === undefined || actual === undefined) return actual;
    if (opts?.skip?.(i) || opts?.inferable?.(i)) return actual;
    if (!opts?.lifted?.(i) || !isVariable(pattern)) return actual;
    s.lifted.add(pattern.name);
    return liftedElementTypeOf(actual);
  });

  // Pass 1 + pass 2a — the covariant sweep, over every position.
  for (let i = 0; i < positions.length; i++) {
    const pattern = positions[i];
    const actual = contributed[i];
    if (pattern === undefined || actual === undefined) continue;
    if (opts?.skip?.(i)) continue;
    // An inferable unknown/`any` symbol contributes NO bound; it stays
    // eligible for post-solve narrowing instead (§4.3 table).
    if (opts?.inferable?.(i)) continue;
    if (!walkPattern(s, pattern, actual, i, 'lower', true, true))
      s.matched = false;
  }

  // Pass 2b — the contravariant sweep (collection only; satisfiability below).
  for (let i = 0; i < positions.length; i++) {
    const pattern = positions[i];
    const actual = contributed[i];
    if (pattern === undefined || actual === undefined) continue;
    if (opts?.skip?.(i)) continue;
    if (opts?.inferable?.(i)) continue;
    walkPattern(s, pattern, actual, i, 'upper', true, true);
  }

  //
  // Solve — S1 (join of lowers), S2 (meet of uppers), S3 (declared bound, else
  // `unknown`; NEVER `never`).
  //
  const bindings: TypeBindings = Object.create(null);
  const absorbed = new Set<string>();
  const unbound = new Set<string>();
  for (const p of params) {
    // A VALUE variable is pinned by equality: the literal it was read from, or
    // its bound (`integer<1..>` for a length) when no position pinned it.
    if (s.valueParams.has(p.name)) {
      const pinned = s.values.get(p.name);
      bindings[p.name] =
        pinned === undefined
          ? (p.bound ?? LENGTH_BOUND)
          : valueLiteralType(pinned.value as number | string | boolean);
      continue;
    }
    const lowers = s.lower.get(p.name);
    const uppers = uppersOf(s, p.name);
    if (lowers && lowers.length > 0) {
      const joined = joinBounds(lowers, opts?.waiveNestedUnknown === true);
      bindings[p.name] = joined.type;
      if (joined.absorbed) absorbed.add(p.name);
    } else if (uppers.length > 0) {
      bindings[p.name] = algebra().narrow(...uppers.map((b) => b.type));
    } else {
      bindings[p.name] = p.bound ?? 'unknown';
      if (p.bound === undefined) unbound.add(p.name);
    }
  }

  //
  // Satisfiability (§4.3 pass 2b). The declared bound joins the upper set.
  //
  const failures: TypeInferenceFailure[] = [...s.valueFailures];
  for (const p of params) {
    // A pinned VALUE variable must satisfy its bound (`where N: integer<2..>`,
    // or the length default `integer<1..>`); the blamed position is the one
    // that pinned it.
    if (s.valueParams.has(p.name)) {
      const pinned = s.values.get(p.name);
      if (pinned === undefined) continue;
      const bound = p.bound ?? LENGTH_BOUND;
      const solution = bindings[p.name];
      if (algebra().isSubtype(solution, bound)) continue;
      failures.push({
        kind: 'bound',
        variable: p.name,
        solution,
        expected: bound,
        index: pinned.index,
        detail: `\`${p.name}\` is declared with bound \`${typeToString(bound)}\`, but was solved to \`${typeToString(solution)}\`${describePositions([{ type: solution, index: pinned.index }])}`,
      });
      continue;
    }
    // D8: a TOP-LEVEL absorbed top type (`unknown` or `any` — the whole
    // operand's own type) satisfies every upper bound PROVISIONALLY — the
    // runtime stays the honest party, and §4.5 parity is preserved. A NESTED
    // one does not waive anything, except a nested `unknown` at a call (see
    // `joinBounds`).
    if (absorbed.has(p.name)) continue;
    // D10: a lift-admitted operand at a bare-variable pattern was admitted at
    // its SCALAR BASE; re-checking the DECLARED bound against the (collection)
    // solution would contradict the very admission that produced it. Only that
    // one term is waived — an upper bound contributed contravariantly by
    // ANOTHER position (a callback parameter) still constrains the variable.
    const lifted = s.lifted.has(p.name);
    const uppers = lifted
      ? uppersOf(s, p.name).filter((b) => !b.declared)
      : uppersOf(s, p.name);
    if (uppers.length === 0) continue;
    const solution = bindings[p.name];
    const meet = algebra().narrow(...uppers.map((b) => b.type));
    // Disjoint upper bounds (empty meet) fail even when the solution is itself
    // `never` — S2's meet of two incompatible callback parameters is `never`,
    // and `never <: never` would otherwise wave the conflict through.
    const disjoint = meet === 'never' && uppers.some((b) => b.type !== 'never');
    if (!disjoint && algebra().isSubtype(solution, meet)) continue;

    // The declared bound is not on the record for a lifted variable, so it can
    // never be the thing blamed either.
    const declaredBound = lifted ? undefined : p.bound;
    const pinnedBy = s.lower.get(p.name) ?? [];
    const pinnedText = describePositions(pinnedBy);
    if (
      declaredBound !== undefined &&
      !algebra().isSubtype(solution, declaredBound)
    ) {
      // §8 deterministic blame: the EARLIEST operand whose OWN contribution
      // violates the bound. Blaming `pinnedBy[0]` unconditionally names the
      // first position that contributed ANY bound, which for a repeated
      // variable (`(T, T) -> T`) is routinely an innocent operand — its type
      // satisfies the bound, and its only role was to be joined with a later,
      // incompatible one (`f(5, matrix)` blamed operand 0, reporting `number`
      // as expected against the perfectly good `integer`). When every
      // contribution individually satisfies the bound and only the JOIN
      // violates it, no single position is at fault, so the first pinning
      // position is blamed as before.
      const culprit =
        pinnedBy.find(
          (b) =>
            b.index !== undefined && !algebra().isSubtype(b.type, declaredBound)
        ) ?? pinnedBy[0];
      failures.push({
        kind: 'bound',
        variable: p.name,
        solution,
        expected: declaredBound,
        index: culprit?.index,
        detail: `\`${p.name}\` is declared with bound \`${typeToString(declaredBound)}\`, but was solved to \`${typeToString(solution)}\`${pinnedText}`,
      });
      continue;
    }
    // A contravariant (callback) upper bound: blame the constraining position.
    // With DISJOINT uppers there is no violated-by-the-solution bound (the
    // solution is `never`, a subtype of them all), so the last positioned
    // upper is blamed against what the earlier ones pin.
    const positioned = uppers.filter((b) => b.index !== undefined);
    const violated =
      uppers.find((b) => !algebra().isSubtype(solution, b.type)) ??
      positioned[positioned.length - 1] ??
      uppers[0];
    const others = uppers.filter((b) => b !== violated);
    const pin = disjoint
      ? others.length > 0
        ? algebra().narrow(...others.map((b) => b.type))
        : solution
      : solution;
    failures.push({
      kind: 'upper',
      variable: p.name,
      solution,
      expected: violated.type,
      index: violated.index,
      pin,
      detail: disjoint
        ? `\`${p.name}\` has incompatible requirements (${uppers.map((b) => `\`${typeToString(b.type)}\``).join(', ')})`
        : `\`${p.name}\` was solved to \`${typeToString(solution)}\`${pinnedText}; this position requires \`${p.name} <: ${typeToString(violated.type)}\``,
    });
  }

  checkProtocolConstraints(params, bindings, s, opts?.resolver, failures);

  return { bindings, absorbed, unbound, matched: s.matched, failures };
}

/**
 * The `is` slot's satisfiability phase (P19), run beside the §5 bound check
 * above and on the same footing: S1–S3 have solved every variable, so each
 * solved binding is substituted and the conformance ORACLE on the resolver is
 * consulted.
 *
 * An UNDECIDABLE solution passes — the open-world posture the dispatcher
 * already takes (P32/P35): conformance is monotone and a top or compound type
 * refutes nothing. Without an oracle nothing is checked at all; declaring such
 * a type was already refused (see {@link validatePolytypeArm}).
 */
function checkProtocolConstraints(
  params: readonly TypeParameter[],
  bindings: TypeBindings,
  s: SolverState,
  resolver: TypeResolver | undefined,
  failures: TypeInferenceFailure[]
): void {
  const conformsTo = resolver?.conformsTo;
  if (conformsTo === undefined) return;
  for (const p of params) {
    if (p.protocols === undefined || p.protocols.length === 0) continue;
    const solution = bindings[p.name];
    if (solution === undefined || !isDecidedConstraintType(solution)) continue;
    for (const protocol of p.protocols) {
      if (conformsTo(solution, protocol)) continue;
      failures.push({
        kind: 'protocol',
        variable: p.name,
        protocol,
        solution,
        expected: solution,
        index: (s.lower.get(p.name) ?? [])[0]?.index,
        detail: `\`${p.name}\` was solved to \`${typeToString(solution)}\`, which does not conform to the \`${protocol}\` protocol`,
      });
      break; // One verdict per variable — the first unmet protocol.
    }
  }
}

/**
 * Can this solved binding decide a conformance question?
 *
 * A deliberate REPLICA of the engine-side `isDecidedReceiverType`
 * (`engine-protocols.ts`, ruling P32) — the type layer may not import the
 * engine — and it must answer the same way: a TOP type (`unknown`, `any`,
 * `value`, `expression`) and a COMPOUND one (a union some arms of which may
 * conform, an intersection, a variable) leave the question open, so the call
 * is admitted and decided at run time.
 */
export function isDecidedConstraintType(t: Type): boolean {
  if (typeof t === 'string')
    return (
      t !== 'unknown' && t !== 'any' && t !== 'value' && t !== 'expression'
    );
  return (
    t.kind !== 'union' && t.kind !== 'intersection' && t.kind !== 'variable'
  );
}

/**
 * The §4.3 solver, in the shape the design states: the bindings, or `null`
 * when no consistent instantiation exists.
 */
export function inferTypeArguments(
  arm: FunctionSignature,
  actuals: ReadonlyArray<Type | undefined>,
  opts?: InferenceOptions
): TypeBindings | null {
  const r = solveTypeArguments(arm, actuals, opts);
  if (!r.matched || r.failures.length > 0) return null;
  return r.bindings;
}

/**
 * `Poly <: Ground` (§5 rule 1): true iff SOME instantiation is a subtype.
 *
 * The ground signature's parameters are the "actuals" flowing into the
 * polytype's parameters (contravariantly, so a ground param at a bare
 * poly-variable is a LOWER bound), and then the COMPLETE existing
 * signature-subtype check runs on the substituted arm — instantiation alone is
 * not acceptance (result covariance, effects, arity shape, named slots).
 */
export function instantiatesTo(
  poly: FunctionSignature,
  ground: FunctionSignature
): boolean {
  // An OPEN expected side with a polytype actual: v1 declines (no higher-order
  // unification, §4.3).
  if (ground.typeParams !== undefined && ground.typeParams.length > 0)
    return false;
  const actuals = [
    ...(ground.args ?? []),
    ...(ground.optArgs ?? []),
    ...(ground.variadicArg ? [ground.variadicArg] : []),
  ].map((x) => x.type);
  const bindings = inferTypeArguments(poly, actuals);
  if (bindings === null) return false;
  const instantiated = substituteTypeVariables(poly, bindings);
  if (isPolymorphicType(instantiated)) return false;
  return algebra().isSubtype(instantiated, ground);
}

/**
 * Pattern-side `matches` against a POLYMORPHIC pattern — the D12 consistent
 * existential: solve the pattern's variables against `subject`, then check the
 * subject against the substituted pattern with the ordinary subtype relation.
 *
 * The polarity is the mirror of {@link instantiatesTo}: here the subject flows
 * INTO the pattern (`subject <: pattern[σ]`), so the pattern's parameters take
 * UPPER bounds from the subject's and its result takes a LOWER bound — which
 * is exactly what the solver's signature branch does when the whole pattern is
 * handed to it as one covariant position.
 */
export function matchesPolytypePattern(subject: Type, pattern: Type): boolean {
  if (typeof pattern !== 'object') return algebra().isSubtype(subject, pattern);
  // An intersection pattern (an overload set) is satisfied only when EVERY arm
  // is — the existing `rhs.kind === 'intersection'` rule of `isSubtype`.
  if (pattern.kind === 'intersection')
    return pattern.types.every((arm) => matchesPolytypePattern(subject, arm));
  if (
    pattern.kind !== 'signature' ||
    pattern.typeParams === undefined ||
    pattern.typeParams.length === 0
  )
    return algebra().isSubtype(subject, pattern);

  // The arm with its clause lifted onto a synthetic one-parameter carrier, so
  // the pattern's variables read as FREE while the solver walks it.
  const open: FunctionSignature = { ...pattern };
  delete open.typeParams;
  const carrier: FunctionSignature = {
    kind: 'signature',
    typeParams: pattern.typeParams,
    args: [{ type: open }],
    result: 'nothing',
  };
  const bindings = inferTypeArguments(carrier, [subject]);
  if (bindings === null) return false;
  return algebra().isSubtype(subject, substituteTypeVariables(open, bindings));
}

/**
 * Every free variable occurrence replaced by its declared bound (`any` when
 * unbounded) — the D6 "bound-reading" `couldMatch` (and the subject-less
 * `at`-handler check) use, on BOTH sides. Positional: no cross-occurrence
 * consistency.
 */
export function readTypeVariablesAsBounds(t: Type): Type {
  if (!isPolymorphicType(t)) return t;
  if (typeof t !== 'object') return t;
  if (t.kind === 'intersection')
    return { ...t, types: t.types.map(readTypeVariablesAsBounds) };
  if (t.kind !== 'signature') return t;
  const bindings: TypeBindings = Object.create(null);
  // An unbounded variable reads as `unknown` — "some value type", the same
  // reading the solver's S3 rule gives it — NOT as `any`: `any` is the
  // absence-admitting top, and reading `list<T> where T` as `list<any>`
  // would take a constructor result OUT of its own collection family (bare
  // `collection` is the values-only `collection<unknown>` synonym, user
  // ruling 2026-08-17, and `list<any> ⊄ collection`).
  for (const p of t.typeParams ?? [])
    bindings[p.name] =
      p.bound ?? (p.kind === 'value' ? LENGTH_BOUND : 'unknown');
  return substituteTypeVariables(t, bindings);
}

//
// ── Solver internals ─────────────────────────────────────────────────────────
//

function isVariable(t: Type): t is { kind: 'variable'; name: string } {
  return typeof t === 'object' && t.kind === 'variable';
}

/**
 * The parameter an arm would bind to operand `index`: a required parameter,
 * then an optional one, then the variadic parameter (which absorbs every
 * remaining position). `undefined` when the arm has no slot at that index.
 *
 * Mirrors the consumption order of `validateArguments`' three loops — and is
 * the SINGLE definition of that order: {@linkcode parameterPositions} is this
 * function tabulated, and `overload.ts` re-exports it as `paramAt`. Two
 * independent transcriptions of the required→optional→variadic model had drifted
 * apart once already (Design D's contextual callback slots read one, argument
 * validation the other, and an OPTIONAL callback slot is the first shape where
 * a divergence would show).
 */
export function paramAt(
  arm: FunctionSignature,
  index: number
): Type | undefined {
  const required = arm.args?.length ?? 0;
  if (index < required) return arm.args![index].type;
  const optional = arm.optArgs?.length ?? 0;
  if (index < required + optional) return arm.optArgs![index - required].type;
  return arm.variadicArg?.type;
}

/** The parameter pattern at each of the first `count` operand positions —
 * {@linkcode paramAt} tabulated (a variadic parameter collects ONE bound per
 * matching actual, all folded into the same variable's bound set). */
export function parameterPositions(
  arm: FunctionSignature,
  count: number
): (Type | undefined)[] {
  const out: (Type | undefined)[] = [];
  for (let i = 0; i < count; i++) out.push(paramAt(arm, i));
  return out;
}

function addBound(
  map: Map<string, Bound[]>,
  name: string,
  type: Type,
  index: number | undefined,
  top: boolean
): void {
  // Ground-type invariant (§4.2): only GROUND bounds are ever joined or met —
  // the algebra helpers assert on an open input. The one shape that can reach
  // here open is a polytype ACTUAL (its own quantified variables), which §4.3
  // declines rather than unifies; the signature branch already drops those, so
  // this is a backstop.
  if (hasFreeTypeVariables(type)) return;
  const list = map.get(name);
  if (list) list.push({ type, index, top });
  else map.set(name, [{ type, index, top }]);
}

function uppersOf(s: SolverState, name: string): Bound[] {
  const collected = s.upper.get(name) ?? [];
  const declared = s.declared.get(name);
  // The declared bound JOINS the upper-bound set of its variable (§4.3).
  return declared === undefined
    ? collected
    : [...collected, { type: declared, declared: true }];
}

function describePositions(bounds: ReadonlyArray<Bound>): string {
  const positions = bounds
    .map((b) => b.index)
    .filter((x): x is number => x !== undefined)
    .map((x) => x + 1);
  if (positions.length === 0) return '';
  if (positions.length === 1) return ` (from argument ${positions[0]})`;
  return ` (from arguments ${positions.join(', ')})`;
}

/**
 * How special LOWER bounds combine — the §4.3 bound-join table. Deliberately
 * NOT raw `widen`: `widen(unknown, X)` returns `X`, which would DISCARD a
 * non-inferable unknown and overstate the result.
 */
function joinBounds(
  bounds: ReadonlyArray<Bound>,
  waiveNestedUnknown = false
): {
  type: Type;
  absorbed: boolean;
} {
  // A top type ABSORBS the join wherever it occurs, but it only WAIVES the
  // satisfiability check when it arrived TOP-LEVEL — as the whole operand's
  // own type at a bare-variable pattern. That is the only shape D8/§4.3 rules
  // on, and the only one the ground path has a counterpart for: the
  // unknown/`any` gate in `validateArguments` admits a top-typed OPERAND
  // unconditionally, so `(T) -> T where T: indexed_collection` must admit
  // one too (§4.5 parity). A NESTED top type has no such counterpart in
  // general — `isSubtype(tuple<any>, tuple<number>)` is false, so the ground
  // signature rejects and the generic one must as well; waiving there would
  // loosen past the ground reading, and `matches`/`Poly <: Ground` have no
  // runtime re-check to fall back on.
  //
  // The one exception is a nested `unknown` at a CALL (`waiveNestedUnknown`,
  // see `InferenceOptions`): an `unknown` component is a placeholder, the
  // ground path defers it to the runtime check, and the generic path waives
  // it to match (the block below). A nested `any` is never waived: it admits
  // the absence markers, which a value slot does not.
  if (waiveNestedUnknown) {
    // A nested `unknown` contributes nothing when another bound says
    // something: `(tuple<T>, tuple<T>) -> T where T: number` applied to a
    // `tuple<unknown>` and a `tuple<string>` must still refuse the string,
    // as the ground signature does, and applied to a `tuple<unknown>` and a
    // `tuple<integer>` it solves `T = integer`. Only when every bound is a
    // nested `unknown` is the variable waived.
    const isNestedUnknown = (b: Bound) =>
      b.type === 'unknown' && b.top !== true;
    if (bounds.some(isNestedUnknown)) {
      const rest = bounds.filter((b) => !isNestedUnknown(b));
      if (rest.length === 0) return { type: 'unknown', absorbed: true };
      return joinBounds(rest, true);
    }
  }
  const absorbed = bounds.some(
    (b) => b.top === true && (b.type === 'unknown' || b.type === 'any')
  );
  // `unknown` is checked before `any` only to fix the reported SOLUTION when a
  // call mixes the two (vanishingly rare; recorded rather than left to
  // `widen`, whose `widen(unknown, X) = X` would DISCARD a non-inferable
  // unknown and overstate the result).
  if (bounds.some((b) => b.type === 'unknown'))
    return { type: 'unknown', absorbed };
  if (bounds.some((b) => b.type === 'any')) return { type: 'any', absorbed };
  // `never` is NEUTRAL (identity): `Concat([], [1])` solves `T = integer`.
  const ordinary = bounds.filter((b) => b.type !== 'never');
  if (ordinary.length === 0) return { type: 'never', absorbed: false };
  return {
    type: algebra().widen(...ordinary.map((b) => b.type)),
    absorbed: false,
  };
}

/**
 * `t` with every free variable replaced by the WIDEST type admissible at its
 * position — the ground skeleton a constructor pattern is matched against
 * before recursing, and the LOOSEST reading of a parameter (which is what an
 * embedding uses to decide whether a position is only provisionally admitted,
 * §4.5).
 *
 * Variance-aware, and that is load-bearing: `any` in a CONTRAVARIANT position
 * is the tightest possible reading, not the loosest — `(integer) -> boolean`
 * is not a subtype of `(any) -> boolean`. A variable under a callback
 * parameter therefore reads as `never`, so `((T) -> boolean) -> T where T`
 * admits every unary predicate at its skeleton, as it must.
 */
export function groundSkeleton(t: Type, covariant = true): Type {
  if (!hasFreeTypeVariables(t)) return t;
  return skeleton(t, covariant, false);
}

/**
 * `t` read as a MEMBERSHIP/ADMISSION domain: which values could inhabit SOME
 * instantiation of it.
 *
 * Same walk as {@link groundSkeleton}, and identical everywhere except at an
 * applied reference whose parameter is read INVARIANTLY (`inout`, or a
 * declaration whose variance is not verified yet — ruling C reads those as
 * `inout` too). The two skeletons answer different questions and §4.3 makes
 * them disagree there:
 *
 * - **Disjointness** (`groundSkeleton`, feeding `provablyDisjoint` and the D14a
 *   arm-overlap check) must never claim disjointness it cannot prove, so an
 *   invariant argument keeps the polarity and yields `cell<any>` — a concrete
 *   application no over-claim can be derived from.
 * - **Membership** cannot use that answer: `cell<integer> <: cell<any>` is
 *   FALSE under invariance, so `cell<any>` would admit no application but the
 *   literal `cell<any>` — an `inout` (or still-deferred) nominal could never be
 *   a constructor argument of another parameterized nominal. The domain wanted
 *   is "any application of this declaration", which no `Type` spells, so the
 *   position reads as the top of its polarity (`any` covariantly, `never`
 *   contravariantly) and the rest is decided POST-solve, against the
 *   INSTANTIATED parameter — which `validate.ts` re-gates and, at a
 *   constructor, the value-membership check re-gates again.
 *
 * `out` and `in` need no such widening: `X<A> <: X<any>` always holds under
 * `out`, and `X<A> <: X<never>` always holds under `in` (the flipped position
 * already yields `never`), so both admit every application as they stand.
 */
export function admissionSkeleton(t: Type, covariant = true): Type {
  if (!hasFreeTypeVariables(t)) return t;
  return skeleton(t, covariant, true);
}

function skeleton(t: Type, covariant: boolean, membership: boolean): Type {
  if (typeof t === 'string') return t;
  if (!hasFreeTypeVariables(t)) return t;
  switch (t.kind) {
    case 'variable':
      // A VALUE variable at a type position admits the values of its bound
      // (a length: `integer<1..>`), not every type.
      if (t.value === true) return covariant ? LENGTH_BOUND : 'never';
      return covariant ? 'any' : 'never';
    case 'signature': {
      const next: FunctionSignature = {
        ...t,
        result: skeleton(t.result, covariant, membership),
      };
      if (t.args)
        next.args = t.args.map((a) => ({
          ...a,
          type: skeleton(a.type, !covariant, membership),
        }));
      if (t.optArgs)
        next.optArgs = t.optArgs.map((a) => ({
          ...a,
          type: skeleton(a.type, !covariant, membership),
        }));
      if (t.variadicArg)
        next.variadicArg = {
          ...t.variadicArg,
          type: skeleton(t.variadicArg.type, !covariant, membership),
        };
      delete next.typeParams;
      return next;
    }
    case 'list': {
      // A length slot's variable reads as the `-1` wildcard its `dimensions`
      // entry already holds; only the name goes.
      const next: ListType = {
        ...t,
        elements: skeleton(t.elements, covariant, membership),
      };
      delete next.dimensionVariables;
      return next;
    }
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return { ...t, elements: skeleton(t.elements, covariant, membership) };
    case 'tuple':
      return {
        ...t,
        elements: t.elements.map((e) => ({
          ...e,
          type: skeleton(e.type, covariant, membership),
        })),
      };
    case 'dictionary':
      return { ...t, values: skeleton(t.values, covariant, membership) };
    case 'record': {
      const elements: Record<string, Type> = {};
      for (const [k, v] of Object.entries(t.elements))
        elements[k] = skeleton(v, covariant, membership);
      return { ...t, elements };
    }
    case 'object': {
      // A stored field is an INVARIANT position, so this follows the rule the
      // `reference` case below applies to an `inout` argument rather than the
      // record case above: in MEMBERSHIP mode a layout with a variable in any
      // field admits no layout but itself, so the whole position reads as the
      // top of its polarity instead. Outside membership mode the fields
      // skeletonize in place, polarity unchanged (invariance neither flips it
      // nor preserves it — it admits only equality, which the post-solve
      // re-gate decides).
      if (
        membership &&
        Object.values(t.elements).some((v) => hasFreeTypeVariables(v))
      )
        return covariant ? 'any' : 'never';
      const elements: Record<string, Type> = {};
      for (const [k, v] of Object.entries(t.elements))
        elements[k] = skeleton(v, covariant, membership);
      return { ...t, elements };
    }
    case 'union':
    case 'intersection':
      return {
        ...t,
        types: t.types.map((x) => skeleton(x, covariant, membership)),
      };
    case 'negation':
      return { ...t, type: skeleton(t.type, !covariant, membership) };
    case 'reference': {
      // `tree<T>` skeletonizes to `tree<any>`, argument-wise — without this an
      // application stays OPEN inside a skeletonized body, and every consumer
      // that requires a ground input (the D14a arm-overlap check) is defeated.
      // Each argument composes with the referenced parameter's DECLARED
      // variance (§4.2): `out` keeps the polarity, `in` flips it.
      //
      // `inout` has no sound single skeleton — under invariance neither `any`
      // nor `never` is admitted by an argument that is not literally it — so
      // the choice is made on the other contract the skeleton has to honor:
      // §5 requires that it "never let disjointness be derived from the type
      // variable alone". `never` is provably disjoint from everything, `any`
      // from nothing, so the non-flipping direction (which yields `any` in a
      // covariant context) is the conservative one. `inout` therefore passes
      // the polarity through unchanged.
      //
      // MEMBERSHIP mode parts company exactly there: `cell<any>` admits no
      // application but itself under invariance, so an admission domain reads
      // the whole position as the top of its polarity instead — see
      // {@link admissionSkeleton}.
      if (t.args === undefined) return t;
      const decl = declarationOf(t);
      if (
        membership &&
        t.args.some(
          (a, i) =>
            hasFreeTypeVariables(a) && subtypingVarianceOf(t, i) === 'inout'
        )
      )
        return covariant ? 'any' : 'never';
      return withTypeArguments(
        t,
        t.args.map((a, i) =>
          skeleton(
            a,
            decl.typeParams?.[i]?.variance === 'in' ? !covariant : covariant,
            membership
          )
        )
      );
    }
    default:
      return t;
  }
}

/**
 * The element type ONE index into `actual` yields.
 *
 * Mirrors `collectionElementType` (`common/type/utils.ts`) EXACTLY — including
 * the dimension peel: an index into a `matrix<integer^(2x3)>` is a row
 * (`integer^3`), not the scalar `integer`. Duplicated rather than imported
 * because `utils.ts` depends on `subtype.ts`, which depends on this module.
 */
function elementTypeOf(type: Type): Type | undefined {
  if (typeof type === 'string') {
    // An index span's element type is KNOWN (finite positive integers), so it
    // does not belong with the unparameterized types below, which report the
    // values-only `unknown`. This mirrors `collectionElementType`
    // (`common/type/utils.ts`), which this function's contract promises to
    // match exactly.
    if (type === 'range') return 'integer';
    // A string's element type is likewise KNOWN: one index into a string
    // yields one grapheme cluster, i.e. a `character`.
    if (type === 'string') return 'character';
    // Bare constructors are their `<unknown>` synonyms (user ruling
    // 2026-08-17): their elements are VALUES — `unknown`, never the
    // absence-admitting `any`. `collectionElementType` was updated in that
    // round; this mirror had drifted and kept answering `any`, which leaked
    // into type-variable bindings (`Unique(bare collection)` typed
    // `list<any>`, taking the result out of the values-only family).
    if (
      type === 'collection' ||
      type === 'indexed_collection' ||
      type === 'list' ||
      type === 'set' ||
      type === 'tuple' ||
      type === 'dictionary' ||
      type === 'record'
    )
      return 'unknown';
    return undefined;
  }
  if (type.kind === 'collection' || type.kind === 'indexed_collection')
    return type.elements;
  if (type.kind === 'list') {
    const dims = (type as ListType).dimensions;
    if (dims && dims.length > 1)
      return {
        kind: 'list',
        elements: type.elements,
        dimensions: dims.slice(1),
      };
    return type.elements;
  }
  if (type.kind === 'set') return type.elements;
  if (type.kind === 'broadcastable') return type.elements;
  if (type.kind === 'tuple')
    return algebra().widen(...type.elements.map((x) => x.type));
  // Indexing a dictionary or a record yields a `(key, value)` entry. Built as
  // a `Type` object rather than through `parseType` (which this module must not
  // depend on); `widen()` of no types is `never`, matching the
  // `tuple<string, never>` an empty record produces in `utils.ts`.
  if (type.kind === 'dictionary')
    return {
      kind: 'tuple',
      elements: [{ type: 'string' }, { type: type.values }],
    };
  if (type.kind === 'record')
    return {
      kind: 'tuple',
      elements: [
        { type: 'string' },
        { type: algebra().widen(...Object.values(type.elements)) },
      ],
    };
  return undefined;
}

/**
 * What ONE ELEMENT of a LIFT-ADMITTED operand is typed (D10, §4.4, re-ruled
 * 2026-08-04).
 *
 * Only the kinds the broadcast machinery actually MAPS are peeled. The lift
 * ADMISSION gate is deliberately looser than the mapping (`validate.ts` admits
 * any `couldBeUnkeyedCollectionOperand` at a threadable position), and the two must
 * not be conflated: a `set` operand is admitted but never mapped (`Conjugate(
 * Set(1, 2))` stays inert), and a TUPLE binds whole and atomically
 * (`Negate((1, 2))` is a tuple, and `f((1, 2))` under `(T) -> T where T`
 * echoes the tuple). Those, like a plain scalar actual — `broadcastable` means
 * scalar-OR-collection — contribute THEMSELVES, exactly as before the
 * re-ruling. So does an `unknown`/`any` actual, which keeps its D8 top-type
 * absorption verbatim.
 *
 * How DEEP the peel goes is decided by the OUTER actual's kind, so that it
 * mirrors term for term the rank the wrapper re-adds:
 * - a `list` outer peels ALL THE WAY DOWN the `list` nesting, because the
 *   runtime maps to the scalar LEAVES (`x ↦ (x, x)` over a 2×2 matrix
 *   evaluates to a 2×2 of tuples, not a 2×2 of tuples-of-rows) and
 *   `broadcastShapedResultType` re-adds exactly the RANK
 *   `staticCollectionDims` reports — which recurses through `list` elements
 *   only, and stops on an `unknown`/bare-`list` element or a non-`list` kind
 *   such as `tuple`;
 * - an `indexed_collection`/`broadcastable` outer has NO static rank
 *   (`staticCollectionDims` answers `null` for it), so the wrapper re-adds
 *   exactly ONE level and the peel takes exactly one — even when the element
 *   is itself a list.
 */
function liftedElementTypeOf(actual: Type): Type {
  // A UNION of shapes (`list<integer> | matrix<integer>`, the `Add` widen
  // artifact) distributes: whichever arm the value takes, the body sees that
  // arm's element. But only when EVERY member is a mapped kind: an unmapped
  // member (a `set`, a `tuple`, a scalar) is echoed WHOLE by the runtime while
  // the wrapper still re-lifts, so distributing the peel across it would be
  // unsound (`list<integer> | set<integer>` must not contribute
  // `integer | set<integer>`). Such a union contributes itself.
  if (typeof actual === 'object' && actual.kind === 'union') {
    if (!actual.types.every((t) => isMappedActual(t))) return actual;
    return algebra().widen(...actual.types.map((t) => liftedElementTypeOf(t)));
  }

  // A bare `list`/`indexed_collection` carries no element information;
  // peeling it to its element reading still gets the RANK right (the
  // wrapper re-adds one level), where contributing it whole would nest
  // (`list<list>`). The element reading is `unknown`, not `any`: bare
  // constructors are their `<unknown>` synonyms (user ruling 2026-08-17)
  // and their elements are values.
  if (actual === 'list' || actual === 'indexed_collection') return 'unknown';
  // An index span peels to its KNOWN element type rather than to `any`: its
  // members are finite positive integers.
  if (actual === 'range') return 'integer';

  if (typeof actual !== 'object' || !MAPPED_KINDS.has(actual.kind))
    return actual;
  let t = elementTypeOf(actual);
  if (t === undefined) return actual;
  if (actual.kind === 'list') {
    while (typeof t === 'object' && t.kind === 'list') {
      const next = elementTypeOf(t);
      if (next === undefined) break;
      t = next;
    }
  }
  return t;
}

/** Whether an actual is one of the kinds a broadcast MAPS over — the union
 * members `liftedElementTypeOf` may distribute the peel across. The bare
 * `list`/`indexed_collection` spellings carry no element type but ARE mapped
 * (they peel to the values-only `unknown`). */
function isMappedActual(t: Type): boolean {
  if (t === 'list' || t === 'indexed_collection' || t === 'range') return true;
  return typeof t === 'object' && MAPPED_KINDS.has(t.kind);
}

/** The collection kinds a broadcast MAPS over (§4.4 D10). Notably absent:
 * `tuple` (atomic under broadcast), `set`/`collection`/`dictionary`/`record`
 * (not indexed — admitted by the lift gate, never mapped). */
const MAPPED_KINDS: ReadonlySet<string> = new Set([
  'list',
  'indexed_collection',
  'broadcastable',
]);

/**
 * Walk a parameter PATTERN against an ACTUAL type, recording bounds.
 *
 * `phase` selects which sweep this is: `'lower'` records a variable in a
 * covariant position (pass 1 + pass 2a), `'upper'` records a variable in a
 * contravariant position (pass 2b). Both sweeps traverse the same structure —
 * separating them by phase, rather than by parameter, is what makes the
 * outcome independent of operand ORDER.
 *
 * Returns false when the structural match itself failed (checked only in the
 * `'lower'` sweep, so a failure is reported once).
 *
 * `topLevel` is true only for the DEPTH-0 call on a parameter pattern: a bound
 * recorded there is the operand's own type, which is what the D8 top-type
 * waiver is about. Every recursive call is a constructor descent and passes
 * false.
 */

/** Alias records currently being unfolded by {@link walkPattern}'s `reference`
 * case — its cycle cutoff. Allocated lazily and released at depth zero, so a
 * walk that meets no alias allocates nothing. */
let unfoldingPatterns: Set<TypeReference> | null = null;

function walkPattern(
  s: SolverState,
  pattern: Type,
  actual: Type,
  index: number | undefined,
  phase: 'lower' | 'upper',
  covariant: boolean,
  topLevel: boolean
): boolean {
  if (isVariable(pattern)) {
    // A VALUE variable (`n: N`) is pinned by equality from the value the
    // operand's type carries — read off the operand's PUBLIC type at depth 0,
    // because the actual handed to the solver has every literal projected to
    // its tier. An operand that pins no value (a symbol typed `integer`)
    // contributes nothing; the post-solve gate checks it against the
    // instantiated parameter, as the ground path does.
    if (pattern.value === true || s.valueParams.has(pattern.name)) {
      if (phase === 'lower' && covariant) {
        const source =
          (topLevel && index !== undefined ? s.rawType?.(index) : undefined) ??
          actual;
        const v = pinnedValueOf(source);
        if (v !== undefined) pinValue(s, pattern.name, v, index);
      }
      return true;
    }
    // A variable never binds to the `range` primitive itself but to its
    // structural reading, `list<integer>`. An index span is a contiguous
    // ascending run of positive integers, and no operator that types its
    // result with an echoed variable (`(T) -> T where T: list`, the
    // `Reverse`/`RotateLeft` echo arm) preserves that property, so binding
    // `T = range` would claim a span for a descending or rotated result.
    // Since `range <: list` (2026-09-29) such an arm accepts a span, and this
    // is what keeps its result honest.
    if (actual === 'range') actual = RANGE_STRUCTURAL_TYPE;
    if (phase === 'lower' && covariant)
      addBound(s.lower, pattern.name, actual, index, topLevel);
    else if (phase === 'upper' && !covariant)
      addBound(s.upper, pattern.name, actual, index, topLevel);
    return true;
  }

  if (!hasFreeTypeVariables(pattern)) {
    if (phase !== 'lower') return true;
    return covariant
      ? algebra().isSubtype(actual, pattern)
      : algebra().isSubtype(pattern, actual);
  }

  // A UNION actual distributes: every arm must match the pattern, and each
  // contributes bounds (§4.3 pass 1).
  if (typeof actual === 'object' && actual.kind === 'union') {
    let ok = true;
    for (const arm of actual.types)
      if (!walkPattern(s, pattern, arm, index, phase, covariant, topLevel))
        ok = false;
    return ok;
  }

  if (typeof pattern === 'string') return true; // unreachable: no free vars

  // `range` is the one primitive with a hidden element type, and the pattern
  // here is composite (it has free variables), so a bare `range` actual would
  // fall through every structural case below and leave the variable unbound —
  // `Sort(Range(1, 5))`, whose parameter is `indexed_collection<T>`, would
  // infer `T = any` and report `list<any>` instead of `list<integer>`.
  // Expanding to the structural reading binds `T` from the span's elements.
  if (actual === 'range') actual = RANGE_STRUCTURAL_TYPE;

  // `string` is the other primitive with a hidden element type, and needs the
  // same expansion for the same reason: without it, `Sort("abc")` — whose
  // parameter is `indexed_collection<T>` — would leave `T` unbound and infer
  // `T = any` instead of `T = character`.
  //
  // Restricted to a COLLECTION-kind pattern, which is the only place the
  // expansion buys anything. Expanding unconditionally also rewrote the actual
  // for a UNION pattern, and there it does harm: `type lu<T> = list<T> |
  // string` applied to a string stopped matching its own ground `string` arm
  // (an `indexed_collection<character>` is not a `string`), so Rule U never
  // refuted the open `list<T>` arm and `T` fell through to `unknown` instead
  // of `never`.
  //
  // `broadcastable` is deliberately NOT in this list: strings are
  // broadcast-atomic, so `broadcastableCollectionElementType` (`subtype.ts`)
  // declines `string` and `isSubtype('string', broadcastable<T>)` is false.
  // Binding `T = character` from a string at such a pattern would infer an
  // element type for a slot the string cannot inhabit as a collection.
  if (
    actual === 'string' &&
    (pattern.kind === 'list' ||
      pattern.kind === 'set' ||
      pattern.kind === 'collection' ||
      pattern.kind === 'indexed_collection')
  )
    actual = STRING_STRUCTURAL_TYPE;

  switch (pattern.kind) {
    case 'signature': {
      if (typeof actual !== 'object' || actual.kind !== 'signature') {
        if (phase !== 'lower' || !covariant) return true;
        return algebra().isSubtype(actual, groundSkeleton(pattern, true));
      }
      // A POLYTYPE actual at a function-typed pattern: v1 DECLINES to unify
      // (no higher-order unification, §4.3). The position contributes no
      // bounds; the actual is then admitted — or not — by the `Poly <: Ground`
      // rule against whatever the OTHER positions instantiate this parameter
      // to (§5 rule 1).
      if (actual.typeParams !== undefined && actual.typeParams.length > 0)
        return true;
      // Pass 2a walks the RESULT covariantly; pass 2b walks each PARAMETER
      // with the variance flipped.
      let ok = walkPattern(
        s,
        pattern.result,
        actual.result,
        index,
        phase,
        covariant,
        false
      );
      const patternArgs = signatureElements(pattern);
      const actualArgs = signatureElements(actual);
      const n = Math.min(patternArgs.length, actualArgs.length);
      for (let i = 0; i < n; i++)
        if (
          !walkPattern(
            s,
            patternArgs[i].type,
            actualArgs[i].type,
            index,
            phase,
            !covariant,
            false
          )
        )
          ok = false;
      return ok;
    }

    case 'broadcastable': {
      // §4.4 three-shape decomposition: a scalar actual, an indexed collection
      // of `S`, or a `broadcastable<S>` all bind `T ≥ S`.
      // A BARE `list`/`indexed_collection` actual binds `T` to its element
      // reading, `unknown` — bare constructors are `<unknown>` synonyms
      // (user ruling 2026-08-17) and their elements are values, so `any`
      // here leaked the absence-admitting top into the binding, the same
      // drift `elementTypeOf` had. Routed through `elementTypeOf` so the
      // two can no longer diverge.
      const inner =
        typeof actual === 'object' &&
        (actual.kind === 'broadcastable' ||
          actual.kind === 'list' ||
          actual.kind === 'indexed_collection')
          ? elementTypeOf(actual)!
          : actual === 'list' || actual === 'indexed_collection'
            ? elementTypeOf(actual)!
            : actual;
      return walkPattern(
        s,
        pattern.elements,
        inner,
        index,
        phase,
        covariant,
        false
      );
    }

    case 'tuple': {
      if (
        phase === 'lower' &&
        covariant &&
        !algebra().isSubtype(actual, groundSkeleton(pattern, true))
      )
        return false;
      if (typeof actual !== 'object' || actual.kind !== 'tuple') {
        // A bare `tuple` (or anything non-decomposable): no per-element bound.
        return true;
      }
      if (actual.elements.length !== pattern.elements.length)
        return phase !== 'lower';
      let ok = true;
      for (let i = 0; i < pattern.elements.length; i++)
        if (
          !walkPattern(
            s,
            pattern.elements[i].type,
            actual.elements[i].type,
            index,
            phase,
            covariant,
            false
          )
        )
          ok = false;
      return ok;
    }

    case 'dictionary': {
      if (
        phase === 'lower' &&
        covariant &&
        !algebra().isSubtype(actual, groundSkeleton(pattern, true))
      )
        return false;
      if (typeof actual !== 'object' || actual.kind !== 'dictionary')
        return true;
      return walkPattern(
        s,
        pattern.values,
        actual.values,
        index,
        phase,
        covariant,
        false
      );
    }

    case 'record':
    // An object layout matches field-wise exactly as a record layout does; it
    // only matches ANOTHER object layout, never a record, because the two are
    // disjoint categories. Solving through a layout is defensive today: a
    // layout is only ever a declared type's definition, and a signature that
    // mentions an object type mentions the nominal REFERENCE, which the
    // `reference` case handles. The mirror is here so a future position that
    // does carry one does not fall into the silent `default` arm.
    case 'object': {
      if (
        phase === 'lower' &&
        covariant &&
        !algebra().isSubtype(actual, groundSkeleton(pattern, true))
      )
        return false;
      if (typeof actual !== 'object' || actual.kind !== pattern.kind)
        return true;
      let ok = true;
      for (const [key, value] of Object.entries(pattern.elements)) {
        const a = actual.elements[key];
        if (a === undefined) continue;
        if (!walkPattern(s, value, a, index, phase, covariant, false))
          ok = false;
      }
      return ok;
    }

    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection': {
      if (
        phase === 'lower' &&
        covariant &&
        !algebra().isSubtype(actual, groundSkeleton(pattern, true))
      )
        return false;
      // A length slot's variable is pinned to the actual's length on that
      // axis, when the actual states one. The axes pair from the outside in,
      // so a rank-2 actual at a rank-1 pattern pins the OUTER length and
      // leaves the peeled row to the element position below — the same
      // reading `peeledRowMatches` (subtype.ts) gives the ground case.
      // A NESTED spelling of a shape (`list<vector<integer^3>^2>` for
      // `matrix<integer^(2x3)>`) is read as the flat shape when the pattern
      // states more axes than the actual (`flattenNestedListType`), so that
      // `cols(nl)` with `nl: list<vector<integer^3>^2>` pins `N` to 3, as
      // the flat spelling does.
      if (
        pattern.kind === 'list' &&
        pattern.dimensions !== undefined &&
        typeof actual === 'object' &&
        actual.kind === 'list' &&
        (actual.dimensions?.length ?? 1) < pattern.dimensions.length
      )
        actual = flattenNestedListType(actual) ?? actual;
      if (
        phase === 'lower' &&
        covariant &&
        pattern.kind === 'list' &&
        pattern.dimensionVariables !== undefined &&
        typeof actual === 'object' &&
        actual.kind === 'list' &&
        actual.dimensions !== undefined
      ) {
        const names = pattern.dimensionVariables;
        const dims = actual.dimensions;
        for (let i = 0; i < names.length && i < dims.length; i++) {
          const name = names[i];
          if (name === undefined) continue;
          const d = dims[i];
          if (Number.isInteger(d) && d > 0) pinValue(s, name, d, index);
        }
      }
      // The element position of a DIMENSIONED pattern is what remains after
      // peeling as many axes as the pattern states: `matrix<T^(MxN)>` — and
      // the ground `matrix<T>`, whose axes are `[-1, -1]` — binds `T` to the
      // scalar element of a rank-2 actual, `list<T^N>` to the row of one. A
      // pattern with no dimensions keeps the one-index reading
      // (`elementTypeOf`), which peels one axis.
      let element: Type | undefined;
      if (
        pattern.kind === 'list' &&
        pattern.dimensions !== undefined &&
        typeof actual === 'object' &&
        actual.kind === 'list' &&
        actual.dimensions !== undefined &&
        actual.dimensions.length >= pattern.dimensions.length
      ) {
        const rest = actual.dimensions.slice(pattern.dimensions.length);
        element =
          rest.length === 0
            ? actual.elements
            : { kind: 'list', elements: actual.elements, dimensions: rest };
      } else element = elementTypeOf(actual);
      if (element === undefined) return true;
      return walkPattern(
        s,
        pattern.elements,
        element,
        index,
        phase,
        covariant,
        false
      );
    }

    case 'reference': {
      // A STRUCTURAL alias is its definition here too. Normally an alias is
      // expanded before the solver ever sees it, so this only fires for one
      // captured as a FORWARD reference inside another type's body — and
      // without it Rule U never runs for such a parameter: the union it should
      // have matched is hidden behind the reference, no arm contributes, and
      // the variable falls through to the S3 default. That is what typed
      // `plus(lit(5), lit(2))` as `plus<unknown>` (rejected by an `expr<number>`
      // parameter) where the ground-arm rule gives `plus<never>`.
      //
      // Guarded on record identity: an alias chain that cycles through bare
      // references would otherwise recurse forever. An EQUIRECURSIVE alias
      // (`json`) does not re-enter — its arms are ground, and a ground arm is
      // settled by `isSubtype`, not by another walk.
      if (pattern.alias === true && pattern.def !== undefined) {
        if (unfoldingPatterns === null) unfoldingPatterns = new Set();
        const record = declarationOf(pattern);
        if (unfoldingPatterns.has(record)) return true;
        unfoldingPatterns.add(record);
        try {
          const def = aliasDefinitionAt(pattern);
          if (def !== undefined)
            return walkPattern(
              s,
              def,
              actual,
              index,
              phase,
              covariant,
              topLevel
            );
        } finally {
          unfoldingPatterns.delete(record);
          if (unfoldingPatterns.size === 0) unfoldingPatterns = null;
        }
      }
      // An APPLIED nominal reference unifies by NAME plus pairwise argument
      // unification — the body is never consulted, so recursion costs nothing
      // here (parameterized-nominal design §3/§4.3). A different name, a
      // different arity or a non-application refutes the match.
      if (pattern.args === undefined) return true;
      if (
        typeof actual !== 'object' ||
        actual.kind !== 'reference' ||
        actual.name !== pattern.name ||
        actual.args === undefined ||
        actual.args.length !== pattern.args.length
      )
        return phase !== 'lower';
      let ok = true;
      for (let i = 0; i < pattern.args.length; i++)
        if (
          !walkPattern(
            s,
            pattern.args[i],
            actual.args[i],
            index,
            phase,
            covariant,
            false
          )
        )
          ok = false;
      return ok;
    }

    case 'union': {
      // Rule U. A union ACTUAL has already distributed (above), so `actual`
      // here is a single type matched against `P₁ | … | Pₙ`, of which at most
      // one arm is open (§7.2 admits no more).
      //
      // Nothing is contributed in the `'upper'` sweep: v1 records no
      // contravariant bound from a union arm. Admission is re-gated after the
      // solve, against the INSTANTIATED parameter, so a wrong solution is
      // rejected there rather than silently accepted here.
      if (phase !== 'lower' || !covariant) return true;
      const open: Type[] = [];
      for (const arm of pattern.types) {
        if (hasFreeTypeVariables(arm)) {
          open.push(arm);
          continue;
        }
        // The value took a GROUND arm: this operand says nothing about the
        // variable, so it contributes `never` — the NEUTRAL element of the
        // bound join (`joinBounds`). Another operand that does constrain the
        // variable therefore wins outright, and when none does the solution is
        // `never`, the bottom of the family: `opt(Missing)` is an `opt<never>`.
        if (algebra().isSubtype(actual, arm)) {
          for (const name of freeTypeVariables(pattern))
            addBound(s.lower, name, 'never', index, false);
          return true;
        }
      }
      // No ground arm accepted, so the value must have taken the open one —
      // and its refutation is the union's: `list<T> | string` really does
      // refute a `set<integer>`.
      if (open.length === 1)
        return walkPattern(
          s,
          open[0],
          actual,
          index,
          phase,
          covariant,
          // NOT a constructor descent: the arm's type IS the operand's own
          // type, so the D8 top-type waiver still applies at depth 0.
          topLevel
        );
      // Neither a ground arm nor a single open one: contribute nothing rather
      // than refute. Unreachable for a DECLARED type, but the walk stays
      // total — internally-constructed patterns are never validated.
      return true;
    }

    default:
      // A variable under an intersection or a negation is rejected at
      // declaration time (§7.2), so nothing else can carry one.
      return true;
  }
}
