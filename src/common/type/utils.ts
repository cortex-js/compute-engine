import { parseType } from './parse.js';
import { isValidType } from './primitive.js';
import { typeToString } from './serialize.js';
import { isSubtype, widen } from './subtype.js';

// Re-export isValidType from primitive for backward compatibility
export { isValidType };

// Re-export widen/narrow from subtype (moved there to break the
// subtype ↔ utils cycle; they depend on isSubtype)
export { widen, narrow } from './subtype.js';

import type { Type, ListType, FunctionSignature, TypeString } from './types.js';

export function isSignatureType(
  type: Readonly<Type> | TypeString
): type is FunctionSignature {
  type = typeof type === 'string' ? parseType(type) : type;
  return typeof type !== 'string' && type.kind === 'signature';
}

export function functionSignature(type: Readonly<Type>): Type | undefined {
  if (type === 'function') return parseType('(any*) -> unknown');
  if (typeof type === 'string') return undefined;

  if (type.kind === 'signature') return type;
  return undefined;
}

export function functionResult(
  type: Readonly<Type> | undefined
): Type | undefined {
  if (!type) return undefined;
  if (type === 'function') return 'any';
  if (typeof type === 'string') return undefined;
  if (type.kind === 'signature') return type.result;
  return undefined;
}

export function collectionElementType(type: Readonly<Type>): Type | undefined {
  if (type === 'collection') return 'any';
  if (type === 'indexed_collection') return 'any';
  if (type === 'list') return 'any';
  if (type === 'set') return 'any';
  if (type === 'tuple') return 'any';
  if (type === 'dictionary') return 'any';
  if (type === 'record') return 'any';
  if (typeof type === 'string') return undefined;

  if (type.kind === 'collection' || type.kind === 'indexed_collection')
    return type.elements;

  if (type.kind === 'list') {
    // A multi-dimensional list (tensor) indexed by a single index yields a
    // sub-tensor with one fewer dimension, not its scalar element. E.g. a
    // single index into a `matrix<2x2>` (a row) is a `vector<2>`. Only a 1D
    // list (or one without declared dimensions) yields the scalar element.
    const dims = type.dimensions;
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

  if (type.kind === 'tuple') return widen(...type.elements.map((x) => x.type));

  if (type.kind === 'dictionary')
    return parseType(`tuple<string, ${typeToString(type.values)}>`);

  if (type.kind === 'record') {
    return parseType(
      `tuple<string, ${typeToString(widen(...Object.values(type.elements)))}>`
    );
  }

  return undefined;
}

export function isValidTypeName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * True if `t` denotes an **atomic** value type — a cell in the cell/axis model
 * (see `docs/plans/2026-07-20-tensor-unification-design.md`, §D5). Atomic
 * types are the ones that may occupy a single tensor cell: numbers, booleans,
 * strings, symbols, colors, function/expression values, and all
 * product/aggregate values (tuples, sets, dictionaries, records). List- and
 * collection-kind types are NOT atomic (they form axes / are opaque
 * collections), and neither is `value` (documented as scalar ∪ collection — a
 * value-typed element could be a collection at runtime).
 *
 * Conservative principle: **when in doubt, not atomic** — a false "not atomic"
 * only withholds a shape claim (safe); a false "atomic" creates a spurious
 * tensor. One deliberate exception, per §D5: `unknown`/`any` ARE atomic —
 * atomicity governs *cell classification* only, and whether an
 * unknown-typed element supports a *shape claim* is the stricter, separate
 * rule in `shapedListType` (bare symbols fold to `number`; applications
 * block). Callers must apply that second gate — do not use this predicate
 * alone to justify a shape.
 */
export function isAtomicValueType(t: Readonly<Type>): boolean {
  // Bare (primitive) string form first — the codebase's `typeof t === 'string'`
  // idiom.
  if (typeof t === 'string')
    return (
      t !== 'list' &&
      t !== 'collection' &&
      t !== 'indexed_collection' &&
      t !== 'value'
    );

  switch (t.kind) {
    case 'list':
    case 'collection':
    case 'indexed_collection':
      return false;

    case 'union':
    case 'intersection':
      // union: the value MIGHT be a collection arm → block unless all atomic.
      // intersection: the value IS every arm → any collection arm makes it one.
      return t.types.every((arm) => isAtomicValueType(arm));

    case 'broadcastable':
      return false; // lift marker — may broadcast over a collection

    case 'negation':
      return false; // can't bound the negated set; conservative

    case 'reference':
      // Recurse on the resolved definition; unresolved → conservative.
      return t.def !== undefined ? isAtomicValueType(t.def) : false;

    case 'value':
      // A literal value type — recurse on the literal's underlying type.
      return isAtomicValueType(valueLiteralType(t.value));

    // signature (functions are cells), tuple/set/dictionary/record
    // (product/aggregate cells), and all remaining primitive kinds
    // (numeric, symbol, expression, ...) are atomic.
    default:
      return true;
  }
}

/** The primitive type of a `value`-kind literal's JS value. */
function valueLiteralType(value: unknown): Type {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'expression';
}

/**
 * Given the scalar per-element result type `elementType` a broadcastable
 * operator computed for its arguments, produce the type of the broadcast
 * (element-wise) result: an (unbounded) `list<elementType>`.
 *
 * The result is deliberately length-agnostic: the value path materializes the
 * broadcast into a plain `List`, whose own type handler is `list<…>` (it drops
 * the operand's fixed length), so an unbounded `list<elementType>` is the
 * consistent, sound upper bound of what evaluation produces. (The exact
 * fixed-length `vector<n>` cases — `Add`/`Multiply` over a tensor — are typed
 * by those operators' own handlers, which see the tensor operand directly.)
 */
export function broadcastResultType(elementType: Readonly<Type>): Type {
  const result: ListType = { kind: 'list', elements: elementType as Type };
  return result;
}

/**
 * The scalar element type that a broadcastable operator's result contributes to
 * its broadcast `list<…>`. A handler may have computed the scalar per-element
 * type directly (`number`), leaked the collection type (`list<number>` — e.g.
 * `Negate` returning `x.type`), or — when a collection operand reached a naive
 * handler such as `Mod`'s or `Remainder`'s `widen(…)` — a `scalar | list<E>`
 * union. Unwrap any collection branch to its element type and widen the
 * branches, so the wrapper never nests a list or a union inside the broadcast
 * result. (For a plain scalar this is the identity.)
 */
export function broadcastElementType(type: Readonly<Type>): Type {
  if (typeof type !== 'string' && type.kind === 'union')
    return widen(...type.types.map((t) => broadcastElementType(t)));
  return collectionElementType(type) ?? (type as Type);
}

/**
 * True if `t` provably denotes a non-real number: a subtype of `complex` that
 * is not a subtype of `real` (`complex`, `imaginary`, `finite_complex`, …).
 *
 * Note that under the `real ⊂ complex` convention a bare
 * `isSubtype(t, 'complex')` is also true for every real type, so it cannot be
 * used on its own as an "is complex-valued" test.
 */
export function isNonRealNumber(t: Readonly<Type>): boolean {
  return isSubtype(t as Type, 'complex') && !isSubtype(t as Type, 'real');
}

/**
 * True if an operand of type `t` could be a non-real number: either the type
 * is a supertype of `complex` (`number`, `any`), or it is a numeric type
 * outside `real` (a complex literal types as `finite_complex`, `i` as
 * `imaginary` — neither is a *supertype* of `complex`, so the first check
 * alone misses actual complex-valued operands).
 *
 * Used to decide whether numeric arguments should be inferred as `number`
 * rather than `real`.
 *
 * Note the argument order in the first check: `isSubtype('complex', t)` asks
 * whether `t` is a *supertype* of `complex` — it is NOT true for `real` and
 * its subtypes:
 *
 * - `real`, `finite_real`, `integer`, `rational` → `false`
 * - `number`, `finite_number`, `any`, `unknown` → `true` (could be non-real)
 * - `complex`, `finite_complex`, `imaginary` → `true` (is non-real)
 */
export function couldBeNonRealNumber(t: Readonly<Type>): boolean {
  return (
    isSubtype('complex', t as Type) ||
    (isSubtype(t as Type, 'number') && !isSubtype(t as Type, 'real'))
  );
}
