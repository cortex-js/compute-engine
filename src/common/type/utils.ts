import { parseType } from './parse';
import { isValidType } from './primitive';
import { typeToString } from './serialize';
import { widen } from './subtype';

// Re-export isValidType from primitive for backward compatibility
export { isValidType };

// Re-export widen/narrow from subtype (moved there to break the
// subtype ↔ utils cycle; they depend on isSubtype)
export { widen, narrow } from './subtype';

import type { Type, FunctionSignature, TypeString } from './types';

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

  if (type.kind === 'list') return type.elements;

  if (type.kind === 'set') return type.elements;

  if (type.kind === 'tuple') return widen(...type.elements.map((x) => x.type));

  if (type.kind === 'dictionary')
    return parseType(`tuple<string, ${type.values}>`);

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
