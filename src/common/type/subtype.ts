import { parseType } from './parse';
import {
  COLLECTION_TYPES,
  EXPRESSION_TYPES,
  NUMERIC_TYPES,
  PRIMITIVE_TYPES,
  SCALAR_TYPES,
  VALUE_TYPES,
} from './primitive';
import type {
  PrimitiveType,
  Type,
  TypeCompatibility,
  TypeString,
} from './types';

const PRIMITIVE_SUBTYPES: Record<PrimitiveType, PrimitiveType[]> = {
  number: NUMERIC_TYPES,
  finite_number: [
    'finite_complex',
    'finite_imaginary',
    'finite_real',
    'finite_integer',
    'finite_rational',
  ],
  non_finite_number: [],
  complex: [
    'finite_complex',
    'finite_imaginary',
    'finite_real',
    'finite_rational',
    'finite_integer',
    'non_finite_number',
    'imaginary',
    'real',
    'rational',
    'integer',
  ],
  finite_complex: [
    'finite_imaginary',
    'finite_real',
    'finite_rational',
    'finite_integer',
  ],
  imaginary: ['finite_imaginary', 'non_finite_number'],
  finite_imaginary: [],
  real: [
    'finite_real',
    'finite_rational',
    'finite_integer',
    'non_finite_number',
    'rational',
    'integer',
  ],
  finite_real: ['finite_rational', 'finite_integer'],
  rational: [
    'finite_rational',
    'finite_integer',
    'integer',
    'non_finite_number',
  ],
  finite_rational: ['finite_integer'],
  integer: ['finite_integer', 'non_finite_number'],
  finite_integer: [],
  any: PRIMITIVE_TYPES,
  unknown: [],
  nothing: [],
  never: [],
  error: [],
  value: VALUE_TYPES,
  scalar: SCALAR_TYPES,
  collection: COLLECTION_TYPES,
  list: [],
  set: [],
  tuple: [],
  map: [],
  function: [],
  symbol: [],
  boolean: [],
  string: [],
  expression: EXPRESSION_TYPES,
};

/** Return true if lhs is a subtype of rhs */
export function isPrimitiveSubtype(
  lhs: PrimitiveType,
  rhs: PrimitiveType
): boolean {
  // `any` is the top type
  if (rhs === 'any') return true;

  // 'never' is the bottom type
  if (lhs === 'never') return true;

  // 'unknown' is only a subtype of any (not of itself)
  // No type is a subtype of `unknown`
  if (lhs === 'unknown' || rhs === 'unknown') return false;

  // Identity
  if (lhs === rhs) return true;

  return PRIMITIVE_SUBTYPES[rhs].includes(lhs);
}

/** Return true if lhs is a subtype of rhs */
export function isSubtype(
  lhs: Type | TypeString,
  rhs: Type | TypeString
): boolean {
  // Shortcut: for primitive types
  if (typeof lhs === 'string' && typeof rhs === 'string' && lhs === rhs)
    return true;

  if (typeof lhs === 'string') lhs = parseType(lhs);
  if (typeof rhs === 'string') rhs = parseType(rhs);

  // Every type is a subtype of `any`, the top type
  if (rhs === 'any') return true;

  // `never` is the bottom type, no type is a subtype of `never`
  if (rhs === 'never') return false;

  // No type is a subtype of `error`, even itself
  if (rhs === 'error') return false;

  // No type is a subtype of `nothing` (unit type), except itself
  if (rhs === 'nothing') return lhs === 'nothing';

  // Nothing is the unit type, it is only a subtype of itself
  if (lhs === 'nothing') return false;

  // 'unknown' is only a subtype of `any` (not of itself)
  // No type is a subtype of `unknown`
  if (lhs === 'unknown' || rhs === 'unknown') return false;

  //
  // Handle other subtype of primitive types
  //
  if (typeof rhs === 'string') {
    // Primitive type subtype of another primitive type
    if (typeof lhs === 'string')
      return isPrimitiveSubtype(lhs as PrimitiveType, rhs as PrimitiveType);

    if (rhs === 'numeric') return isNumeric(lhs);

    if (rhs === 'function') return isFunction(lhs);

    if (rhs === 'expression') return isExpression(lhs);

    if (rhs === 'scalar') return isScalar(lhs);

    if (rhs === 'value') return isValue(lhs);

    if (rhs === 'collection') return isCollection(lhs);

    // A tuple is a subtype of `tuple`
    if (rhs === 'tuple') return lhs.kind === 'tuple';

    // A list is a subtype of `list`
    if (rhs === 'list') return lhs.kind === 'list';

    // A set is a subtype of `set`
    if (rhs === 'set') return lhs.kind === 'set';

    // A map is a subtype of `map`
    if (rhs === 'map') return lhs.kind === 'map';

    // A union is a subtype of a type if any of its types is a subtype of the type
    if (lhs.kind === 'union') return lhs.types.some((t) => isSubtype(t, rhs));

    // Other composite types are not subtypes of primitive types
    return false;
  }

  // A type is a subtype of a union if it is a subtype of any of the types in the union
  if (rhs.kind === 'union') return rhs.types.some((t) => isSubtype(lhs, t));

  // A primitive type is not a subtype of a composite type (except a union)
  if (typeof lhs === 'string') return false;

  //
  // Handle type references
  //
  // Note: our type system is a nominal type system, not a structural type system
  //
  if (lhs.kind === 'reference' && rhs.kind === 'reference') {
    return lhs.ref === rhs.ref;
  }

  //
  // Handle algebraic types (union or intersection)
  //

  // A union type is a subtype of a type if any of its types is a subtype of the type
  if (lhs.kind === 'union') return lhs.types.some((t) => isSubtype(t, rhs));

  if (lhs.kind === 'intersection' && rhs.kind === 'intersection') {
    return rhs.types.every((rhsType) =>
      lhs.types.some((lhsType) => isSubtype(lhsType, rhsType))
    );
  }

  // Handle intersection types with other types
  if (lhs.kind === 'intersection') {
    // lhs is an intersection, rhs is not an intersection
    return lhs.types.every((lhsType) => isSubtype(lhsType, rhs));
  }

  if (rhs.kind === 'intersection') {
    // lhs is not necessarily an intersection, rhs is an intersection
    return rhs.types.every((rhsType) => isSubtype(lhs, rhsType));
  }

  //
  // Handle function signatures
  //
  if (lhs.kind === 'signature' && rhs.kind === 'signature') {
    // Check the result match covariantly
    if (!isSubtype(lhs.result, rhs.result)) return false;

    // Check all the required arguments match contravariantly
    if (rhs.args) {
      if (!lhs.args) return false;
      if (lhs.args.length !== rhs.args.length) return false;
      for (let i = 0; i < lhs.args.length; i++) {
        if (!isSubtype(rhs.args[i].type, lhs.args[i].type)) return false;
      }
    } else if (lhs.args) {
      return false;
    }

    // Check all the optional arguments match contravariantly
    if (rhs.optArgs) {
      if (!lhs.optArgs) return false;
      if (lhs.optArgs.length !== rhs.optArgs.length) return false;
      for (let i = 0; i < lhs.optArgs.length; i++) {
        if (!isSubtype(rhs.optArgs[i].type, lhs.optArgs[i].type)) return false;
      }
    } else if (lhs.optArgs) {
      return false;
    }

    // Check the rest argument match contravariantly
    if (rhs.restArg) {
      if (!lhs.restArg) return false;
      if (!isSubtype(rhs.restArg.type, lhs.restArg.type)) return false;
    } else if (lhs.restArg) {
      return false;
    }

    return true;
  }

  //
  // Handle maps (record types)
  //
  // All the fields in the rhs must be present in the lhs
  // but there may be additional fields in the lhs (width subtyping)
  //
  if (lhs.kind === 'map' && rhs.kind === 'map') {
    const lhsEntries = Object.entries(lhs.elements);
    const rhsEntries = Object.entries(rhs.elements);
    for (let i = 0; i < rhsEntries.length; i++) {
      const [key, value] = rhsEntries[i];

      // Find corresponding key in lhs
      const lhsIndex = lhsEntries.findIndex((entry) => entry[0] === key);
      if (lhsIndex === -1) return false;
      const rhsType = value;
      const lhsType = lhsEntries[lhsIndex][1];
      // Depth subtyping
      if (!isSubtype(lhsType, rhsType)) return false;
    }
    return true;
  }

  //
  // Handle collections
  //
  if (rhs.kind === 'collection') {
    if (
      lhs.kind === 'collection' ||
      lhs.kind === 'list' ||
      lhs.kind === 'set'
    ) {
      // Check that the element types match
      if (!isSubtype(lhs.elements, rhs.elements)) return false;
      return true;
    }
    if (lhs.kind === 'tuple') {
      // A tuple is a subtype of a collection if all its elements are subtypes of the collection elements
      return lhs.elements.every((element) =>
        isSubtype(element.type, rhs.elements)
      );
    }
    return false;
  }

  // Handle tuples
  if (lhs.kind === 'tuple' && rhs.kind === 'tuple') {
    // Check they have the same number of elements
    if (lhs.elements.length !== rhs.elements.length) return false;

    // Check that all the elements match by type
    // @todo: should we match by name as well?
    for (let i = 0; i < lhs.elements.length; i++) {
      if (!isSubtype(lhs.elements[i].type, rhs.elements[i].type)) {
        return false;
      }
    }
    return true;
  }

  if (rhs.kind === 'list' && lhs.kind === 'list') {
    43;
    // Check that the element types match
    if (!isSubtype(lhs.elements, rhs.elements)) return false;

    // Check that the dimensions match
    if (rhs.dimensions) {
      // If rhs has some dimensions, lhs must have dimensions as well
      if (!lhs.dimensions) return false;
      // The shape (number of dimensions) must match
      if (lhs.dimensions.length !== rhs.dimensions.length) return false;

      for (let i = 0; i < lhs.dimensions.length; i++) {
        // A dimension of -1 means any size is allowed
        if (rhs.dimensions[i] !== -1 && lhs.dimensions[i] !== rhs.dimensions[i])
          return false;
      }
    }

    return true;
  }

  if (rhs.kind === 'set' && lhs.kind === 'set') {
    // Check that the element types match
    if (!isSubtype(lhs.elements, rhs.elements)) return false;
    return true;
  }

  // If no conditions matched, return false
  return false;
}

export function isCompatible(
  lhs: PrimitiveType,
  rhs: PrimitiveType,
  compatibility: TypeCompatibility
): boolean {
  if (compatibility === 'invariant') return lhs === rhs;

  if (compatibility === 'covariant') return isPrimitiveSubtype(lhs, rhs);

  if (compatibility === 'contravariant') return isPrimitiveSubtype(rhs, lhs);

  return isPrimitiveSubtype(lhs, rhs) && isPrimitiveSubtype(rhs, lhs);
}

function isNumeric(type: Type): boolean {
  if (typeof type === 'string')
    return NUMERIC_TYPES.includes(type as PrimitiveType);
  return false;
}

function isScalar(type: Type): boolean {
  if (isNumeric(type)) return true;
  if (typeof type === 'string')
    return SCALAR_TYPES.includes(type as PrimitiveType);
  return false;
}

function isCollection(type: Type): boolean {
  if (typeof type === 'string')
    return COLLECTION_TYPES.includes(type as PrimitiveType);
  return ['collection', 'list', 'set', 'tuple', 'map'].includes(type.kind);
}

function isValue(type: Type): boolean {
  return isScalar(type) || isCollection(type);
}

function isFunction(type: Type): boolean {
  return (
    type === 'function' ||
    (typeof type !== 'string' && type.kind === 'signature')
  );
}

function isExpression(type: Type): boolean {
  if (
    typeof type === 'string' &&
    ['expression', 'symbol', 'function'].includes(type)
  )
    return true;
  if (isValue(type) || isFunction(type)) return true;
  return false;
}
