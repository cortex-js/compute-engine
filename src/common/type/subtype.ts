import {
  COLLECTION_TYPES,
  EXPRESSION_TYPES,
  NUMERIC_TYPES,
  INDEXED_COLLECTION_TYPES,
  PRIMITIVE_TYPES,
  SCALAR_TYPES,
  VALUE_TYPES,
} from './primitive';
import type {
  NumericPrimitiveType,
  PrimitiveType,
  Type,
  TypeCompatibility,
  TypeString,
} from './types';

// Lazy import to break subtype → parse cycle
let _parseType: typeof import('./parse').parseType | undefined;
function lazyParseType(s: string): Type {
  if (!_parseType) {
    const m = './parse';
    _parseType = require(m).parseType;
  }
  return _parseType!(s);
}

/** For each key, *all* the primitive subtypes of the type corresponding to that key */
const PRIMITIVE_SUBTYPES: Record<PrimitiveType, PrimitiveType[]> = {
  number: NUMERIC_TYPES,
  non_finite_number: [], //  PositiveInfinity, NegativeInfinity
  finite_number: [
    'finite_complex',
    'finite_real',
    'finite_integer',
    'finite_rational',
  ],
  complex: [
    'finite_complex',
    'imaginary',
    'finite_real',
    'finite_rational',
    'finite_integer',
    'non_finite_number',
  ],
  finite_complex: [
    'imaginary',
    'finite_real',
    'finite_rational',
    'finite_integer',
  ],
  imaginary: [], // Pure, finite, imaginary number
  real: [
    'rational',
    'integer',
    'finite_real',
    'finite_rational',
    'finite_integer',
    'non_finite_number',
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
  indexed_collection: INDEXED_COLLECTION_TYPES,
  list: [],
  set: [],
  tuple: [],
  record: [],
  dictionary: [],
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
  if (typeof lhs === 'string' && !PRIMITIVE_TYPES.includes(lhs as PrimitiveType))
    lhs = lazyParseType(lhs);
  if (typeof rhs === 'string' && !PRIMITIVE_TYPES.includes(rhs as PrimitiveType))
    rhs = lazyParseType(rhs);

  // Every type is a subtype of `any`, the top type
  if (rhs === 'any') return true;

  // `never` is the bottom type, no type is a subtype of `never`
  if (rhs === 'never') return false;

  // No type is a subtype of `error`, except itself
  if (rhs === 'error') return lhs === 'error';

  // No type is a subtype of `nothing` (unit type), except itself
  if (rhs === 'nothing') return lhs === 'nothing';

  // Nothing is the unit type, it is only a subtype of itself
  if (lhs === 'nothing') return false;

  // Every type is a subtype of `unknown`
  if (rhs === 'unknown') return true;
  // 'unknown' is only a subtype of `any` (handled above)
  if (lhs === 'unknown') return false;

  //
  // Handle other subtype of primitive types
  //
  if (typeof rhs === 'string') {
    // Primitive type subtype of another primitive type
    if (typeof lhs === 'string')
      return isPrimitiveSubtype(lhs as PrimitiveType, rhs as PrimitiveType);

    if (lhs.kind === 'value') {
      if (typeof lhs.value === 'boolean') return rhs === 'boolean';
      if (typeof lhs.value === 'number') {
        if (Number.isInteger(lhs.value))
          return isPrimitiveSubtype('integer', rhs as PrimitiveType);
        return isPrimitiveSubtype('number', rhs as PrimitiveType);
      }
      if (typeof lhs.value === 'boolean')
        return isPrimitiveSubtype('boolean', rhs as PrimitiveType);
      if (typeof lhs.value === 'string')
        return isPrimitiveSubtype('string', rhs as PrimitiveType);
      return false;
    }

    // A union is a subtype of a type if all of its types is a subtype of the type
    if (lhs.kind === 'union') return lhs.types.every((t) => isSubtype(t, rhs));

    // An intersection is a subtype of a type if any of its types is a subtype of the type
    if (lhs.kind === 'intersection') {
      return lhs.types.some((t) => isSubtype(t, rhs));
    }

    if (lhs.kind === 'negation') {
      // A negation is a subtype of a type if the negated type is not a subtype of the type
      return !isSubtype(lhs.type, rhs);
    }

    if (lhs.kind === 'numeric') {
      if (!isSubtype(lhs.type, rhs)) return false;
      // The bounds always match, since the bounds of the rhs are -∞ and +∞
      return true;
    }

    if (rhs === 'number') return isNumeric(lhs);

    if (rhs === 'symbol') return isSymbol(lhs);

    if (rhs === 'expression') return isExpression(lhs);

    if (rhs === 'function') return isFunction(lhs);

    if (rhs === 'scalar') return isScalar(lhs);

    if (rhs === 'value') return isValue(lhs);

    if (rhs === 'indexed_collection') return isIndexedCollection(lhs);

    if (rhs === 'collection') return isCollection(lhs);

    // A tuple is a subtype of `tuple`
    if (rhs === 'tuple') return lhs.kind === 'tuple';

    // A list is a subtype of `list`
    if (rhs === 'list') return lhs.kind === 'list';

    // A set is a subtype of `set`
    if (rhs === 'set') return lhs.kind === 'set';

    // A record is a subtype of `record`
    if (rhs === 'record') return lhs.kind === 'record';

    // A dictionary is a subtype of `dictionary`
    if (rhs === 'dictionary') return lhs.kind === 'dictionary';

    // Other composite types are not subtypes of primitive types
    return false;
  }

  // A type is a subtype of a union if it is a subtype of any of the types in the union
  if (rhs.kind === 'union') {
    if (typeof lhs !== 'string' && lhs.kind === 'union') {
      // lhs is a union, rhs is a union
      return lhs.types.every((lhsType) =>
        rhs.types.some((rhsType) => isSubtype(lhsType, rhsType))
      );
    }
    return rhs.types.some((t) => isSubtype(lhs, t));
  }

  //
  // Handle expressions
  //
  if (rhs.kind === 'expression') {
    if (lhs === 'symbol') return true;
    if (typeof lhs === 'string') return false;
    if (lhs.kind === 'expression') {
      if (rhs.operator === 'Symbol') return isSymbol(lhs);
      return lhs.operator === rhs.operator;
    }
    if (lhs.kind === 'symbol') return true;
  }

  // A primitive type is not a subtype of a composite type (except a union)
  if (typeof lhs === 'string') return false;

  //
  // Handle type references
  //
  // Note: we support both nominal and structural subtyping
  //
  if (rhs.kind === 'reference') {
    if (lhs.kind === 'reference') return lhs.name === rhs.name;
    if (rhs.alias === true && rhs.def) {
      // The rhs is a structural type, so we need to check if the lhs is a subtype of the rhs definition
      return isSubtype(lhs, rhs.def);
    }
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

    if (lhs.optArgs || lhs.variadicArg) {
      //
      // If lhs has optional or variadic arguments, rhs must have them as well
      //

      // Check all the required arguments match contravariantly
      if (rhs.args) {
        if (!lhs.args) return false;
        if (lhs.args.length !== rhs.args.length) return false;
        for (let i = 0; i < rhs.args.length; i++) {
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
          if (!isSubtype(rhs.optArgs[i].type, lhs.optArgs[i].type))
            return false;
        }
      } else if (lhs.optArgs) {
        return false;
      }

      // Check the rest argument match contravariantly
      if (rhs.variadicArg) {
        if (!lhs.variadicArg) return false;
        if (lhs.variadicMin != rhs.variadicMin) return false;
        if (!isSubtype(rhs.variadicArg.type, lhs.variadicArg.type))
          return false;
      } else if (lhs.variadicArg) {
        return false;
      }
    } else {
      //
      // lhs did not have optional or variadic arguments, so check the arguments that lhs does have against both the required and optional arguments of rhs
      //
      if (rhs.args && !lhs.args) {
        // If rhs has required arguments, lhs must have them as well
        return false;
      }

      let i = 0;
      if (rhs.args) {
        // If lhs doesn't have enough arguments, it is not a subtype
        if (lhs.args!.length < rhs.args.length) return false;
        // Check all the required arguments match contravariantly
        while (i < rhs.args!.length) {
          if (!isSubtype(rhs.args[i].type, lhs.args![i].type)) return false;
          i += 1;
        }
      }
      if (rhs.optArgs) {
        if (i >= lhs.args!.length) return true;
        // Check all the optional arguments match contravariantly
        for (let j = 0; j < rhs.optArgs.length; j++) {
          if (!isSubtype(rhs.optArgs[j].type, lhs.args![i].type)) return false;
          i += 1;
          if (i >= lhs.args!.length) return true;
        }
      }
      if (rhs.variadicArg) {
        if (i >= lhs.args!.length && rhs.variadicMin === 0) return true;
        // Check the remaining arguments match the variadic argument contravariantly
        if (rhs.variadicMin! > 0 && i + rhs.variadicMin! > lhs.args!.length)
          return false;
        while (i < lhs.args!.length) {
          if (!isSubtype(rhs.variadicArg.type, lhs.args![i].type)) return false;
          i += 1;
        }
      }
    }

    return true;
  }

  //
  // Handle Record Type
  //
  // All the fields in the rhs must be present in the lhs
  // but there may be additional fields in the lhs (width subtyping)
  //
  if (lhs.kind === 'record' && rhs.kind === 'record') {
    for (const key of Object.keys(rhs.elements)) {
      if (!(key in lhs.elements)) return false;
      // Depth subtyping
      if (!isSubtype(lhs.elements[key], rhs.elements[key])) return false;
    }
    return true;
  }

  //
  // Handle dictionaries
  //

  if (lhs.kind === 'dictionary' && rhs.kind === 'dictionary') {
    // Check that the type of values match
    return isSubtype(lhs.values, rhs.values);
  }

  //
  // Handle collections
  //
  if (rhs.kind === 'indexed_collection') {
    if (lhs.kind === 'indexed_collection')
      return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'list') return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'tuple') {
      // A tuple is a subtype of a collection if all its elements are subtypes of the collection elements
      return lhs.elements.every((x) => isSubtype(x.type, rhs.elements));
    }
    return false;
  }

  if (rhs.kind === 'collection') {
    if (lhs.kind === 'collection' || lhs.kind === 'indexed_collection')
      return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'list') return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'tuple')
      return lhs.elements.every((x) => isSubtype(x.type, rhs.elements));

    if (lhs.kind === 'set') return isSubtype(lhs.elements, rhs.elements);

    if (lhs.kind === 'dictionary')
      return isSubtype(
        { kind: 'tuple', elements: [{ type: 'string' }, { type: lhs.values }] },
        rhs.elements
      );

    if (lhs.kind === 'record') {
      // Lazy import widen to break subtype → utils cycle
      const m2 = './utils';
      const { widen } = require(m2);
      return isSubtype(
        { kind: 'tuple', elements: [{ type: 'string' }, { type: widen(...Object.values(lhs.elements)) }] },
        rhs.elements
      );
    }
  }

  //
  // Handle tuples
  //
  if (lhs.kind === 'tuple' && rhs.kind === 'tuple') {
    // Check they have the same number of elements
    if (lhs.elements.length !== rhs.elements.length) return false;

    // Check that all the elements match by type and name
    for (let i = 0; i < lhs.elements.length; i++) {
      const a = lhs.elements[i];
      const b = rhs.elements[i];
      if (!isSubtype(a.type, b.type) || a.name !== b.name) return false;
    }
    return true;
  }

  //
  // Handle lists
  //
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

  //
  // Handle symbols
  //
  if (lhs.kind === 'symbol' && rhs.kind === 'symbol') {
    return lhs.name === rhs.name;
  }

  //
  // Handle numeric subsets
  //
  if (lhs.kind === 'numeric' && rhs.kind === 'numeric') {
    // Check that the types match
    if (!isSubtype(lhs.type, rhs.type)) return false;
    // Check that the bounds match
    if ((lhs.lower ?? -Infinity) < (rhs.lower ?? -Infinity)) return false;
    if ((lhs.upper ?? Infinity) > (rhs.upper ?? Infinity)) return false;
    return true;
  }

  if (rhs.kind === 'set' && lhs.kind === 'set') {
    // Check that the element types match
    if (!isSubtype(lhs.elements, rhs.elements)) return false;
    return true;
  }

  if (lhs.kind === 'negation' && rhs.kind === 'negation') {
    return isSubtype(lhs.type, rhs.type);
  }

  if (rhs.kind === 'negation') {
    return !isSubtype(lhs, rhs.type);
  }

  // Value types (strings, boolean, number)
  if (rhs.kind === 'value' && lhs.kind === 'value')
    return rhs.value === lhs.value;

  if (lhs.kind === 'value') {
    if (typeof lhs.value === 'boolean') return isSubtype('boolean', rhs);
    if (typeof lhs.value === 'number') {
      if (Number.isInteger(lhs.value)) return isSubtype('integer', rhs);
      return isSubtype('real', rhs);
    }
    if (typeof lhs.value === 'string') return isSubtype('string', rhs);
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
    return NUMERIC_TYPES.includes(type as NumericPrimitiveType);
  if (type.kind === 'value') return typeof type.value === 'number';
  if (type.kind === 'numeric') return true;
  return false;
}

function isScalar(type: Type): boolean {
  if (isNumeric(type)) return true;
  if (typeof type === 'string')
    return SCALAR_TYPES.includes(type as PrimitiveType);
  if (type.kind === 'value')
    return ['string', 'boolean', 'number'].includes(typeof type.value);
  return false;
}

function isCollection(type: Type): boolean {
  if (isIndexedCollection(type)) return true;
  if (typeof type === 'string')
    return COLLECTION_TYPES.includes(type as PrimitiveType);
  return ['collection', 'set', 'record', 'dictionary'].includes(type.kind);
}

function isIndexedCollection(type: Type): boolean {
  if (typeof type === 'string') return false;
  return ['indexed_collection', 'list', 'tuple'].includes(type.kind);
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
  if (isValue(type) || isFunction(type) || isSymbol(type)) return true;
  if (typeof type === 'string') return false;
  if (type.kind === 'expression') return true;
  return false;
}

function isSymbol(type: Type): boolean {
  if (type === 'symbol') return true;
  if (typeof type === 'string') return false;
  if (type.kind === 'symbol') return true;
  if (type.kind === 'expression') return type.operator === 'Symbol';
  return false;
}
