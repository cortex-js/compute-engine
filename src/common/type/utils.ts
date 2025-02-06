import { parseType } from './parse';
import { PRIMITIVE_TYPES } from './primitive';
import { isSubtype } from './subtype';
import { Type, FunctionSignature, TypeString, PrimitiveType } from './types';

/** Given two types a and b, return the narrowest type common to a and b */
function narrow2(a: Readonly<Type>, b: Readonly<Type>): Readonly<Type> {
  if (a === b) return a;

  if (a === 'nothing' || b === 'nothing') return 'nothing';

  if (a === 'any') return b;
  if (b === 'any') return a;

  if (a === 'never') return b;
  if (b === 'never') return a;

  if (a === 'unknown') return b;
  if (b === 'unknown') return a;

  if (isSubtype(a, b)) return a;
  if (isSubtype(b, a)) return b;

  return superType(a, b);
}

/** Given two types, return the broadest  */
function widen2(a: Readonly<Type>, b: Readonly<Type>): Readonly<Type> {
  if (a === b) return a;
  if (a === 'any' || b === 'any') return 'any';

  if (a === 'never') return b;
  if (b === 'never') return a;

  if (a === 'unknown') return b;
  if (b === 'unknown') return a;

  if (a === 'nothing') return b;
  if (b === 'nothing') return a;

  if (isSubtype(a, b)) return b;
  if (isSubtype(b, a)) return a;

  return superType(a, b);
}

/** Convert two or more types into a more specific type that is a subtype of
 *  all the input types. The resulting type is usually more constrained and
 *  only encompasses values that belong to both input types.
 *
 * Examples:
 * narrow('integer', 'rational') => 'integer'
 * narrow('number', 'complex') => 'complex'
 * narrow('number', 'collection') => 'nothing'
 * narrow('number', 'value') => 'value'
 * narrow('number', 'expression') => 'expression'
 * narrow('number', 'string') => 'nothing'
 *
 *
 */
export function narrow(...types: Readonly<Type>[]): Type {
  if (types.length === 0) return 'nothing';
  if (types.length === 1) return types[0];

  return types.reduce(narrow2);
}

/**
 * Convert two or more types into a broader, more general type that can
 * accommodate all the input types. The resulting type is usually a supertype
 * that encompasses the possible values of the input types
 *
 * Examples:
 * widen('integer', 'rational') => 'rational'
 * widen('number', 'complex') => 'complex'
 * widen('number', 'collection') => 'collection'
 * widen('number', 'value') => 'value'
 * widen('number', 'expression') => 'expression'
 * widen('number', 'string') => 'any'
 */
export function widen(...types: Readonly<Type>[]): Readonly<Type> {
  if (types.length === 0) return 'nothing';
  if (types.length === 1) return types[0];

  return types.reduce(widen2);
}

export function isSignatureType(
  type: Readonly<Type> | TypeString
): type is FunctionSignature {
  type = typeof type === 'string' ? parseType(type) : type;
  return typeof type !== 'string' && type.kind === 'signature';
}

export function functionSignature(type: Readonly<Type>): Type | undefined {
  if (type === 'function') return parseType('...any -> any');
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
  if (typeof type === 'string') return undefined;
  if (type.kind === 'collection') return type.elements;
  if (type.kind === 'list') return type.elements;
  if (type.kind === 'map')
    return parseType(
      `tuple<string, ${widen(...Object.values(type.elements))}>`
    );
  if (type.kind === 'set') return type.elements;
  if (type.kind === 'tuple') return widen(...type.elements.map((x) => x.type));
  return undefined;
}

export function isValidType(t: any): t is Readonly<Type> {
  if (typeof t === 'string')
    return PRIMITIVE_TYPES.includes(t as PrimitiveType);
  if (typeof t !== 'object') return false;
  if (!('kind' in t)) return false;
  return (
    t.kind === 'signature' ||
    t.kind === 'union' ||
    t.kind === 'intersection' ||
    t.kind === 'negation' ||
    t.kind === 'tuple' ||
    t.kind === 'list' ||
    t.kind === 'map' ||
    t.kind === 'set' ||
    t.kind === 'function' ||
    t.kind === 'collection' ||
    t.kind === 'reference'
  );
}

function superType(a: Readonly<Type>, b: Readonly<Type>): Type {
  // Return the common super type of a and b
  if (a === b) return a;
  if (a === 'any' || b === 'any') return 'any';
  if (a === 'never') return b;
  if (b === 'never') return a;
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  if (a === 'nothing') return b;
  if (b === 'nothing') return a;

  // Check in order from most specific to most general
  if (commonSupertype(a, b, 'non_finite_number')) return 'non_finite_number';

  if (commonSupertype(a, b, 'finite_integer')) return 'finite_integer';
  if (commonSupertype(a, b, 'integer')) return 'integer';
  if (commonSupertype(a, b, 'finite_rational')) return 'finite_rational';
  if (commonSupertype(a, b, 'rational')) return 'rational';
  if (commonSupertype(a, b, 'finite_real')) return 'finite_real';
  if (commonSupertype(a, b, 'real')) return 'real';

  if (commonSupertype(a, b, 'imaginary')) return 'imaginary';

  if (commonSupertype(a, b, 'finite_complex')) return 'finite_complex';
  if (commonSupertype(a, b, 'complex')) return 'complex';

  if (commonSupertype(a, b, 'finite_number')) return 'finite_number';
  if (commonSupertype(a, b, 'number')) return 'number';

  if (commonSupertype(a, b, 'list')) return 'list';
  if (commonSupertype(a, b, 'map')) return 'map';
  if (commonSupertype(a, b, 'set')) return 'set';
  if (commonSupertype(a, b, 'tuple')) return 'tuple';
  if (commonSupertype(a, b, 'collection')) return 'collection';

  if (commonSupertype(a, b, 'scalar')) return 'scalar';
  if (commonSupertype(a, b, 'value')) return 'value';
  if (commonSupertype(a, b, 'function')) return 'function';

  if (commonSupertype(a, b, 'expression')) return 'expression';

  return 'any';
}

function commonSupertype(
  a: Readonly<Type>,
  b: Readonly<Type>,
  ancestor: Readonly<Type>
): boolean {
  if (isSubtype(a, ancestor) && isSubtype(b, ancestor)) return true;
  return false;
}
