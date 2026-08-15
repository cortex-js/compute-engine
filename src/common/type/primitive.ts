import type { NumericPrimitiveType, PrimitiveType, Type } from './types.js';

/** All the types representing numeric values */
export const NUMERIC_TYPES: NumericPrimitiveType[] = [
  'number',
  'finite_number',
  'complex',
  'finite_complex',
  'imaginary',
  'real',
  'finite_real',
  'rational',
  'finite_rational',
  'integer',
  'finite_integer',
  'non_finite_number',
] as const as NumericPrimitiveType[];

export const INDEXED_COLLECTION_TYPES: PrimitiveType[] = [
  'indexed_collection',
  'list',
  'tuple',
  // An index span (see the `range` entry in `types.ts`). A sibling of `list`,
  // not a subtype of it: a `Range` value is not a `List`, and neither kind is
  // a subtype of the other.
  'range',
];

/**
 * The structural reading of the unparameterized `range` type: an index span
 * is an indexed collection of integers.
 *
 * `range` is the only primitive that carries a hidden element type, so every
 * site that destructures a parameterized collection (subtype checks against
 * `indexed_collection<T>`, type-variable binding, element-type readers) has
 * to expand it — hence ONE shared constant rather than a literal repeated at
 * each site. The element type is `integer`, matching exactly what a
 * qualifying `Range` reported before `range` existed
 * (`indexed_collection<integer>`), so the new type NARROWS the collection
 * kind without perturbing element-type inference downstream.
 */
// Frozen because it is shared BY REFERENCE across every `range` subtype and
// pattern-match call in the process (`isSubtype`, `walkPattern`): in-place
// mutation by any future consumer would silently corrupt every subsequent
// `range` check for the lifetime of the process, with no error at the
// mutation site. Same rule as the cached types in `parse.ts`, which are
// deep-frozen for exactly this reason.
export const RANGE_STRUCTURAL_TYPE: Type = Object.freeze({
  kind: 'indexed_collection',
  elements: 'integer',
}) as Type;

export const COLLECTION_TYPES: PrimitiveType[] = [
  ...INDEXED_COLLECTION_TYPES,
  'collection',
  'set',
  'record',
  'dictionary',
] as const as PrimitiveType[];

export const SCALAR_TYPES: PrimitiveType[] = [
  'scalar',
  ...NUMERIC_TYPES,
  'boolean',
  'string',
] as const as PrimitiveType[];

export const VALUE_TYPES: PrimitiveType[] = [
  'value',
  'color',
  // `object` is a value, but deliberately NOT a collection: field access is
  // not element access, so it sits beside `record` rather than under
  // `collection` with it (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, ruling
  // B6). Keeping it out of `COLLECTION_TYPES` is what makes `object` and
  // `record` disjoint in the primitive lattice.
  'object',
  ...COLLECTION_TYPES,
  ...SCALAR_TYPES,
] as const as PrimitiveType[];

export const EXPRESSION_TYPES: PrimitiveType[] = [
  'expression',
  'symbol',
  'function',
  ...VALUE_TYPES,
] as const as PrimitiveType[];

export const PRIMITIVE_TYPES: PrimitiveType[] = [
  'any',
  'unknown',
  'nothing',
  'missing',
  'never',
  'error',
  ...EXPRESSION_TYPES,
] as const as PrimitiveType[];

//
// Set counterparts of the arrays above, for O(1) membership tests on hot
// paths (the arrays are kept for ordered iteration and backward
// compatibility).
//
export const NUMERIC_TYPES_SET: ReadonlySet<NumericPrimitiveType> = new Set(
  NUMERIC_TYPES
);
export const COLLECTION_TYPES_SET: ReadonlySet<PrimitiveType> = new Set(
  COLLECTION_TYPES
);
export const SCALAR_TYPES_SET: ReadonlySet<PrimitiveType> = new Set(
  SCALAR_TYPES
);
export const PRIMITIVE_TYPES_SET: ReadonlySet<PrimitiveType> = new Set(
  PRIMITIVE_TYPES
);

export function isValidPrimitiveType(s: any): s is PrimitiveType {
  if (typeof s !== 'string') return false;
  return PRIMITIVE_TYPES_SET.has(s as PrimitiveType);
}

export function isValidType(t: any): t is Readonly<Type> {
  if (typeof t === 'string') return PRIMITIVE_TYPES_SET.has(t as PrimitiveType);
  if (typeof t !== 'object') return false;
  if (!('kind' in t)) return false;
  return (
    t.kind === 'signature' ||
    t.kind === 'callback' ||
    t.kind === 'union' ||
    t.kind === 'intersection' ||
    t.kind === 'negation' ||
    t.kind === 'value' ||
    t.kind === 'tuple' ||
    t.kind === 'list' ||
    t.kind === 'record' ||
    t.kind === 'object' ||
    t.kind === 'dictionary' ||
    t.kind === 'set' ||
    t.kind === 'broadcastable' ||
    t.kind === 'symbol' ||
    t.kind === 'expression' ||
    t.kind === 'numeric' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'variable' ||
    t.kind === 'reference'
  );
}
