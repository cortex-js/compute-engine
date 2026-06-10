import type { NumericPrimitiveType, PrimitiveType, Type } from './types';

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
];

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
    t.kind === 'union' ||
    t.kind === 'intersection' ||
    t.kind === 'negation' ||
    t.kind === 'value' ||
    t.kind === 'tuple' ||
    t.kind === 'list' ||
    t.kind === 'record' ||
    t.kind === 'dictionary' ||
    t.kind === 'set' ||
    t.kind === 'symbol' ||
    t.kind === 'expression' ||
    t.kind === 'numeric' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'reference'
  );
}
