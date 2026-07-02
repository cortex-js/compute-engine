import { typeToString } from './serialize';
import { isSubtype, meetPrimitiveTypes } from './subtype';
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

    case 'numeric':
      // A bounded numeric range whose lower bound exceeds its upper bound is
      // empty. (`integer<0..10>` and friends predate this switch; without a
      // case here every number-set `contains` handler — reached via
      // `library/sets.ts` `typeIntersection` — crashed with "Unknown type
      // kind".)
      if (
        type.lower !== undefined &&
        type.upper !== undefined &&
        type.lower > type.upper
      )
        return 'never';
      return type;

    case 'symbol':
      return type;

    case 'expression':
      return type;

    default:
      throw new Error(`Unknown type kind: ${type}`);
  }
}

function decorate(t: Type): Type {
  if (typeof t !== 'object') return t;

  // Cached/shared types (e.g. memoized `parseType()` results) are frozen and
  // cannot be decorated; already-decorated types are left as-is (the
  // decoration is non-configurable, so redefining it would throw).
  if (Object.isFrozen(t) || Object.prototype.hasOwnProperty.call(t, 'toString'))
    return t;

  Object.defineProperty(t, 'toString', { value: () => typeToString(t) });

  return t;
}

/**
 * Reduce and structurally de-duplicate the member types of an algebraic
 * type. The key of each member is computed once (a string for primitive
 * types, the serialized form otherwise) — no `typeToString` → `parseType`
 * round-trip.
 */
function reduceMembers(types: Readonly<Type[]>): Type[] {
  const result: Type[] = [];
  const seen = new Set<string>();
  for (const t of types) {
    const reduced = reduceType(t);
    const key = typeof reduced === 'string' ? reduced : typeToString(reduced);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(reduced);
    }
  }
  return result;
}

function reduceNegationType(type: NegationType): Type {
  const reducedType = reduceType(type.type);

  if (reducedType === 'nothing') return 'any';

  if (reducedType === 'any') return 'nothing';

  return decorate({ kind: 'negation', type: reducedType });
}

function reduceUnionType(type: AlgebraicType): Type {
  const reducedTypes = reduceMembers(type.types);

  if (reducedTypes.length === 0) return 'never';

  if (reducedTypes.some((type) => type === 'error')) return 'error';

  if (reducedTypes.length === 1) return decorate(reducedTypes[0]!); // "boolean | boolean" -> "boolean"

  // A union keeps the *supertype* of any subtype-related pair, e.g.
  // `integer | number` reduces to `number`. If `current` is already
  // covered by an existing (super)type, drop it; otherwise drop any
  // existing types that `current` subsumes, then add `current`.
  const acc: Type[] = [];
  for (const current of reducedTypes) {
    if (acc.some((t) => isSubtype(current, t))) continue;
    for (let i = acc.length - 1; i >= 0; i--)
      if (isSubtype(acc[i], current)) acc.splice(i, 1);
    acc.push(current);
  }

  if (acc.length === 1) return decorate(acc[0]);
  return decorate({ kind: 'union', types: acc });
}

/**
 * The *meet* (intersection) of two types.
 *
 * - For subtype-related pairs, the narrower type.
 * - For incomparable but overlapping *primitive* pairs, the meet in the
 *   primitive lattice (see `meetPrimitiveTypes`), e.g.
 *   `integer ∧ finite_real` = `finite_integer` (`integer` admits ±∞, so the
 *   overlap is the finite integers), `finite_number ∧ real` = `finite_real`.
 *   When the maximal common subtypes are incomparable, the meet is their
 *   union, e.g. `real ∧ complex` = `finite_real | non_finite_number` (the
 *   lattice does not place the infinity-admitting `real` below `complex`).
 * - Unions (which can arise from previous meets) distribute:
 *   `(a | b) ∧ c` = `(a ∧ c) | (b ∧ c)`.
 * - Incomparable non-primitive pairs are considered disjoint → `nothing`.
 */
function meet2(a: Type, b: Type): Type {
  if (isSubtype(a, b)) return a;
  if (isSubtype(b, a)) return b;

  // Distribute the meet over union members
  if (typeof a === 'object' && a.kind === 'union') return meetUnion(a.types, b);
  if (typeof b === 'object' && b.kind === 'union') return meetUnion(b.types, a);

  if (typeof a === 'string' && typeof b === 'string') {
    const maximals = meetPrimitiveTypes(a as PrimitiveType, b as PrimitiveType);
    if (maximals.length === 0) return 'nothing';
    if (maximals.length === 1) return maximals[0];
    return { kind: 'union', types: maximals };
  }

  return 'nothing';
}

function meetUnion(types: Readonly<Type[]>, b: Type): Type {
  const members = types.map((t) => meet2(t, b)).filter((t) => t !== 'nothing');
  if (members.length === 0) return 'nothing';
  if (members.length === 1) return members[0];
  return reduceUnionType({ kind: 'union', types: members });
}

function reduceIntersectionType(type: AlgebraicType): Type {
  const reducedTypes = reduceMembers(type.types);

  if (reducedTypes.length === 0) return 'nothing';

  // If the intersection contains an `error`, return `error`
  if (reducedTypes.some((type) => type === 'error')) return 'error';

  // Fold the members pairwise through the meet. Overlapping numeric
  // primitives intersect to their lattice meet (e.g. `integer & finite_real`
  // = `finite_integer`) instead of collapsing to `nothing`; genuinely
  // disjoint types (e.g. `number & boolean`) still annihilate to `nothing`.
  let result: Type = reducedTypes[0];
  for (let i = 1; i < reducedTypes.length; i++) {
    result = meet2(result, reducedTypes[i]);
    if (result === 'nothing') return 'nothing';
  }

  return decorate(result);
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
    // `-1` means "any size" — a valid, non-degenerate dimension (e.g. a bare
    // `matrix` is `list<list<...>^-1>^-1`). Only a literal `0` makes the list
    // empty; dropping `-1` here turned `matrix` into `nothing`, annihilating
    // any intersection it appeared in.
    dimensions = dimensions.filter((dim) => dim >= 1 || dim === -1);
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
