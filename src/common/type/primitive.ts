import type { PrimitiveType } from './types';

export const NUMERIC_TYPES: PrimitiveType[] = [
  'number',
  'finite_number',
  'complex',
  'finite_complex',
  'imaginary',
  'finite_imaginary',
  'real',
  'finite_real',
  'rational',
  'finite_rational',
  'integer',
  'finite_integer',
  'non_finite_number',
] as const as PrimitiveType[];

export const COLLECTION_TYPES: PrimitiveType[] = [
  'collection',
  'list',
  'set',
  'tuple',
  'map',
] as const as PrimitiveType[];

export const SCALAR_TYPES: PrimitiveType[] = [
  'scalar',
  ...NUMERIC_TYPES,
  'boolean',
  'string',
] as const as PrimitiveType[];

export const VALUE_TYPES: PrimitiveType[] = [
  'value',
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

export function isValidPrimitiveType(s: any): s is PrimitiveType {
  if (typeof s !== 'string') return false;
  return PRIMITIVE_TYPES.includes(s as PrimitiveType);
}
