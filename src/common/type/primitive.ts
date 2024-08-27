import type { PrimitiveType } from './types';

export const PRIMITIVE_TYPES: PrimitiveType[] = [
  // Numeric types
  'number',
  'complex',
  'imaginary',
  'real',
  'rational',
  'integer',
  // Other value types
  'value',
  'collection',
  'list',
  'map',
  'set',
  'tuple',
  'boolean',
  'string',
  // Symbolic types
  'expression',
  'function',
  'symbol',
  // Other types
  'any',
  'unknown',
  'nothing',
  'error',
] as const as PrimitiveType[];

export function isValidPrimitiveType(s: any): s is PrimitiveType {
  if (typeof s !== 'string') return false;
  return PRIMITIVE_TYPES.includes(s as PrimitiveType);
}
