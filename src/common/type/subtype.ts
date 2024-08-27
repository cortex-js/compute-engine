import type { PrimitiveType, Type, TypeCompatibility } from './types';

/** Return true if lhs is a subtype of rhs */
export function isPrimitiveSubtype(
  lhs: PrimitiveType,
  rhs: PrimitiveType
): boolean {
  // `any` is the top type
  if (rhs === 'any') return true;

  // 'unknown' is only a subtype of any (not of itself)
  // No type is a subtype of `unknown`
  if (lhs === 'unknown' || rhs === 'unknown') return false;

  // Identity
  if (lhs === rhs) return true;

  // `number` :> `complex` + NaN + Infinity
  if (
    rhs === 'number' &&
    ['complex', 'imaginary', 'real', 'rational', 'integer'].includes(lhs)
  )
    return true;

  // `complex` :> `imaginary` | `real`
  if (
    rhs === 'complex' &&
    ['imaginary', 'real', 'rational', 'integer'].includes(lhs)
  )
    return true;

  // `real` :> `rational`
  if (rhs === 'real' && ['rational', 'integer'].includes(lhs)) return true;

  // `rational` :> `integer`
  if (rhs === 'rational' && lhs === 'integer') return true;

  // `collection` :>  `tuple`
  if (rhs === 'collection' && lhs === 'tuple') return true;

  // `value` :> `number` | `collection` | `tuple` | `boolean` | `string`
  if (
    rhs === 'value' &&
    [
      'number',
      'complex',
      'imaginary',
      'real',
      'rational',
      'integer',
      'map',
      'collection',
      'list',
      'set',
      'tuple',
      'boolean',
      'string',
    ].includes(lhs)
  )
    return true;

  // `expression` := `value` | `function` | `symbol`
  if (
    rhs === 'expression' &&
    [
      'number',
      'complex',
      'imaginary',
      'real',
      'rational',
      'integer',
      'map',
      'collection',
      'list',
      'set',
      'tuple',
      'boolean',
      'string',
      'function',
      'symbol',
    ].includes(lhs)
  )
    return true;

  return false;
}

/** Return true if lhs is a subtype of rhs */
export function isSubtype(lhs: Type, rhs: Type): boolean {
  // Every type is a subtype of `any`
  if (rhs === 'any') return true;

  // No type is a subtype of `error`, even itself
  if (rhs === 'error') return false;

  // No type is a subtype of `nothing` (bottom type), except itself
  if (rhs === 'nothing') return lhs === 'nothing';

  // Nothing is the bottom type, it is only a subtype of itself
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

    // A function signature is a subtype of `function` or `expression`
    if (rhs === 'function' || rhs === 'expression')
      return lhs.kind === 'signature';

    // Subtype of `collection`
    if (rhs === 'collection')
      return (
        lhs.kind === 'collection' ||
        lhs.kind === 'tuple' ||
        lhs.kind === 'list' ||
        lhs.kind === 'set' ||
        lhs.kind === 'map'
      );

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
    if (rhs.hold === true && lhs.hold !== true) return false;

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

    // Check that all the elements match
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
      if (!lhs.dimensions) return false;
      if (lhs.dimensions.length !== rhs.dimensions.length) return false;
      for (let i = 0; i < lhs.dimensions.length; i++) {
        if (lhs.dimensions[i] !== rhs.dimensions[i]) return false;
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

function commonType2(lhs: Type, rhs: Type): Type {
  if (lhs === rhs) return lhs;
  if (lhs === 'nothing') return rhs;
  if (rhs === 'nothing') return lhs;
  if (lhs === 'any' || rhs === 'any') return 'any';
  if (isSubtype(lhs, rhs)) return rhs;
  if (isSubtype(rhs, lhs)) return lhs;

  // Note: the order of the checks is significant
  if (isSubtype(lhs, 'complex') && isSubtype(rhs, 'complex')) return 'complex';
  if (isSubtype(lhs, 'number') && isSubtype(rhs, 'number')) return 'number';
  if (isSubtype(lhs, 'collection') && isSubtype(rhs, 'collection'))
    return 'collection';
  if (isSubtype(lhs, 'value') && isSubtype(rhs, 'value')) return 'value';
  if (isSubtype(lhs, 'expression') && isSubtype(rhs, 'expression'))
    return 'expression';
  return 'any';
}

/** Return the type that is common to all the types, using a "supertype" (any,
 * value, number, complex, expression) if applicable
 */
export function commonType(types: Type[]): Type {
  if (types.length === 0) return 'nothing';
  if (types.length === 1) return types[0];

  // Use commonType2 to find the common type of all the types
  return types.reduce(commonType2);
}
