import { parseType } from './parse.js';
import { isValidType } from './primitive.js';
import { typeToString } from './serialize.js';
import { widen } from './subtype.js';

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
      return { kind: 'list', elements: type.elements, dimensions: dims.slice(1) };
    return type.elements;
  }

  if (type.kind === 'set') return type.elements;

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
