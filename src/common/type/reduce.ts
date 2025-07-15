import { parseType } from './parse';
import { typeToString } from './serialize';
import { isSubtype } from './subtype';
import type {
  Type,
  PrimitiveType,
  AlgebraicType,
  CollectionType,
  ListType,
  SetType,
  TupleType,
  FunctionSignature,
  NegationType,
  DictionaryType,
  RecordType,
} from './types';
import { isValidPrimitiveType } from './primitive';

/**
 * Reduce the input type
 *
 * For example:
 * - `number | integer` -> `number`
 * - `set<any>` -> `set`
 *
 * @param type
 * @returns
 */
export function reduceType(type: Type): Type {
  if (typeof type === 'string') {
    if (!isValidPrimitiveType(type as PrimitiveType)) return 'error';
    // Valid primitive types are already reduced
    return type;
  }

  switch (type.kind) {
    case 'union':
      return reduceUnionType(type);

    case 'intersection':
      return reduceIntersectionType(type);

    case 'negation':
      return reduceNegationType(type);

    case 'collection':
    case 'indexed_collection':
      return reduceCollectionType(type.kind, type);

    case 'list':
      return reduceListType(type);

    case 'set':
      return reduceSetType(type);

    case 'tuple':
      return reduceTupleType(type);

    case 'record':
      return reduceRecordType(type);

    case 'dictionary':
      return reduceDictionaryType(type);

    case 'signature':
      return reduceSignatureType(type);

    case 'value':
      return type;

    case 'reference':
      return type;

    default:
      throw new Error(`Unknown type kind: ${type}`);
  }
}

function decorate(t: Type): Type {
  if (typeof t !== 'object') return t;

  Object.defineProperty(t, 'toString', { value: () => typeToString(t) });

  return t;
}

function reduceNegationType(type: NegationType): Type {
  const reducedType = reduceType(type.type);

  if (reducedType === 'nothing') return 'any';

  if (reducedType === 'any') return 'nothing';

  return decorate({ kind: 'negation', type: reducedType });
}

function reduceUnionType(type: AlgebraicType): Type {
  const uniqueTypes = new Set(
    type.types.map((t) => typeToString(reduceType(t)))
  );
  const reducedTypes: Type[] = Array.from(uniqueTypes).map(
    (x) => parseType(x)!
  );

  if (reducedTypes.length === 0) return 'never';

  if (reducedTypes.some((type) => type === 'error')) return 'error';

  if (reducedTypes.length === 1) return decorate(reducedTypes[0]!); // "boolean | boolean" -> "boolean"

  return decorate(
    reducedTypes
      .reduce<Type[]>((acc, current) => {
        if (!acc.some((t) => isSubtype(current, t) || isSubtype(t, current)))
          acc.push(current);

        return acc;
      }, [])
      .reduce((acc, cur, idx, arr) =>
        arr.length === 1 ? cur : { kind: 'union', types: arr }
      )
  );
}

function reduceIntersectionType(type: AlgebraicType): Type {
  // Reduce intersection types
  const uniqueTypes = new Set(
    type.types.map((t) => typeToString(reduceType(t)))
  );
  const reducedTypes = Array.from(uniqueTypes).map((x) => parseType(x)!);

  // If the intersection includes incompatible types, return `nothing`
  const incompatible = reducedTypes.some((t1) =>
    reducedTypes.some(
      (t2) => t1 !== t2 && !isSubtype(t1, t2) && !isSubtype(t2, t1)
    )
  );

  // e.g., "number & boolean" -> "nothing"
  if (incompatible) return 'nothing';

  // Simplify the intersection based on the reduced types
  const simplified = reducedTypes.reduce<Type[]>((acc, current) => {
    // Remove from acc any type that is a supertype of `current`
    acc = acc.filter((t) => isSubtype(t, current));

    // If `current` is not already in `acc` (meaning it's not more general), add it
    if (!acc.some((t) => isSubtype(t, current))) acc.push(current);

    return acc;
  }, []);

  // If the intersection contains an `error`, return `error`
  if (simplified.some((type) => type === 'error')) return 'error';

  // If the intersection is empty (shouldn't happen normally), return `nothing`
  if (simplified.length === 0) return 'nothing';

  // If the intersection reduces to a single type, return that type
  if (simplified.length === 1) return decorate(simplified[0]);

  // Otherwise, return the simplified intersection
  return decorate({
    kind: 'intersection',
    types: simplified,
  });
}

function reduceCollectionType(
  kind: 'collection' | 'indexed_collection',
  type: CollectionType
): Type {
  const reducedType = reduceType(type.elements);

  if (reducedType === 'error') return 'error';

  // A collection of `nothing` is an empty collection
  if (reducedType === 'nothing') return decorate({ kind, elements: 'nothing' });

  // A collection of `any` is a collection
  if (reducedType === 'any') return kind;

  return decorate({
    ...type,
    elements: reducedType,
  });
}

function reduceListType(type: ListType): Type {
  const reducedType = reduceType(type.elements);

  if (reducedType === 'error') return 'error';

  // A list of `nothing` is an empty list
  if (reducedType === 'nothing')
    return decorate({ kind: 'list', elements: 'nothing' });

  // A list of `any` is a list
  if (reducedType === 'any') return 'list';

  let dimensions = type.dimensions;
  if (dimensions) {
    dimensions = dimensions.filter((dim) => dim >= 1);
    if (dimensions.length === 0) return 'nothing';
  }

  return decorate({
    ...type,
    dimensions,
    elements: reducedType,
  });
}

function reduceSetType(type: SetType): Type {
  const reducedType = reduceType(type.elements);

  if (reducedType === 'error') return 'error';

  // A set of `nothing` is an empty set
  if (reducedType === 'nothing')
    return decorate({ kind: 'set', elements: 'nothing' });

  // A set of `any` is a set
  if (reducedType === 'any') return 'set';

  return decorate({
    ...type,
    elements: reducedType,
  });
}

function reduceTupleType(type: TupleType): Type {
  let reducedElements = type.elements.map((element) => ({
    ...element,
    type: reduceType(element.type),
  }));

  // The empty tuple is `nothing`
  if (reducedElements.length === 0) return 'nothing';

  // Note: a single element tuple is not reduced to the element
  // (any) ≠ any

  if (reducedElements.some((element) => element.type === 'error'))
    return 'error';
  reducedElements = reducedElements.filter(
    (element) => element.type !== 'nothing'
  );

  return decorate({
    ...type,
    elements: reducedElements,
  });
}

function reduceRecordType(type: RecordType): Type {
  let reducedElements: Record<string, Type> = {};
  for (const [key, value] of Object.entries(type.elements))
    reducedElements[key] = reduceType(value);

  if (Object.values(reducedElements).some((type) => type === 'error'))
    return 'error';

  // If the type of any key is 'nothing', remove it from the record
  reducedElements = Object.fromEntries(
    Object.entries(reducedElements).filter(([_, value]) => value !== 'nothing')
  );

  // An empty record is `record`
  if (Object.keys(reducedElements).length === 0) return 'record';

  return decorate({
    ...type,
    elements: reducedElements,
  });
}

function reduceDictionaryType(type: DictionaryType): Type {
  // We have a `dictionary<V>`

  const reducedValues = reduceType(type.values);
  if (reducedValues === 'error') return 'error';
  if (reducedValues === 'nothing') return 'error';
  if (reducedValues === 'any' || reducedValues === 'unknown') return 'any';

  return decorate({ kind: 'dictionary', values: reducedValues });
}

function reduceSignatureType(type: FunctionSignature): Type {
  const reducedArgs = type.args?.map((arg) => ({
    ...arg,
    type: reduceType(arg.type),
  }));
  let reducedOptArgs = type.optArgs?.map((arg) => ({
    ...arg,
    type: reduceType(arg.type),
  }));
  let reducedVarArg = type.variadicArg
    ? {
        ...type.variadicArg,
        type: reduceType(type.variadicArg.type),
      }
    : undefined;
  const reducedResult = reduceType(type.result);

  if (reducedArgs?.some((arg) => arg.type === 'error')) return 'error';
  if (reducedOptArgs?.some((arg) => arg.type === 'error')) return 'error';
  if (reducedVarArg?.type === 'error') return 'error';
  if (reducedResult === 'error') return 'error';

  reducedOptArgs = reducedOptArgs?.filter((arg) => arg.type !== 'nothing');

  if (reducedArgs?.length === 0) reducedOptArgs = undefined;
  if (reducedOptArgs?.length === 0) reducedOptArgs = undefined;
  if (reducedVarArg?.type === 'nothing') reducedVarArg = undefined;

  return decorate({
    ...type,
    args: reducedArgs,
    optArgs: reducedOptArgs,
    variadicArg: reducedVarArg,
    variadicMin: reducedVarArg ? type.variadicMin : undefined,
    result: reducedResult,
  });
}
