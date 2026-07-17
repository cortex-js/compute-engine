import {
  COLLECTION_TYPES,
  COLLECTION_TYPES_SET,
  EXPRESSION_TYPES,
  NUMERIC_TYPES,
  NUMERIC_TYPES_SET,
  INDEXED_COLLECTION_TYPES,
  PRIMITIVE_TYPES,
  PRIMITIVE_TYPES_SET,
  SCALAR_TYPES,
  SCALAR_TYPES_SET,
  VALUE_TYPES,
} from './primitive.js';
import type {
  BroadcastableType,
  NumericPrimitiveType,
  PrimitiveType,
  Type,
  TypeCompatibility,
  TypeString,
} from './types.js';
import { parseType } from './parse.js';

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
    // D10 (2026-07-02): `real ⊂ complex`, properly. `complex` admits ±∞ (it
    // already listed `non_finite_number`), so the infinity-admitting
    // `real`/`rational`/`integer` are genuine subtypes — the numeric tower is
    // `integer ⊂ rational ⊂ real ⊂ complex ⊂ number`. (`isReal` still admits
    // ±∞; D10 is about the LATTICE relation, not that predicate.)
    'real',
    'rational',
    'integer',
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
  color: [],
  expression: EXPRESSION_TYPES,
};

/**
 * For each primitive type, the *reflexive transitive closure* of its primitive
 * subtypes, as a `Set` for O(1) membership tests.
 *
 * Computed from `PRIMITIVE_SUBTYPES`. The closure repairs transitivity holes
 * in the hand-maintained table (e.g. `imaginary ⊑ finite_complex ⊑
 * finite_number`, but `imaginary` was missing from `finite_number`'s list).
 */
const PRIMITIVE_SUBTYPES_CLOSURE: Record<
  PrimitiveType,
  Set<PrimitiveType>
> = (() => {
  const closure = {} as Record<PrimitiveType, Set<PrimitiveType>>;

  const closeOver = (t: PrimitiveType): Set<PrimitiveType> => {
    if (closure[t]) return closure[t];
    const result = new Set<PrimitiveType>([t]);
    closure[t] = result; // Set first to guard against (unexpected) cycles
    for (const sub of PRIMITIVE_SUBTYPES[t]) {
      if (sub === t) continue;
      for (const s of closeOver(sub)) result.add(s);
    }
    return result;
  };

  for (const t of Object.keys(PRIMITIVE_SUBTYPES) as PrimitiveType[])
    closeOver(t);

  return closure;
})();

/** Return true if lhs is a subtype of rhs */
export function isPrimitiveSubtype(
  lhs: PrimitiveType,
  rhs: PrimitiveType
): boolean {
  // Mirror `isSubtype`'s special-type precedence EXACTLY so the two exported
  // functions agree on the whole primitive lattice (SYM P2-22). They
  // previously disagreed on `unknown`: `isPrimitiveSubtype` returned `false`
  // for `X <: unknown` while `isSubtype` treats `unknown` as a top type. The
  // ordering below (in particular `nothing` before `unknown`) reproduces
  // `isSubtype` cell-for-cell.

  // `any` is the top type
  if (rhs === 'any') return true;

  // `never` is the bottom type — a subtype of every type
  if (lhs === 'never') return true;
  // No other type is a subtype of `never`
  if (rhs === 'never') return false;

  // No type is a subtype of `error`, except itself
  if (rhs === 'error') return lhs === 'error';

  // `nothing` (unit type) is a subtype only of `any` (handled above) and
  // itself; nothing else is a subtype of `nothing`.
  if (rhs === 'nothing') return lhs === 'nothing';
  if (lhs === 'nothing') return false;

  // `unknown` is a top type: every (remaining) type is a subtype of it, and it
  // is a subtype only of `any`/`unknown`.
  if (rhs === 'unknown') return true;
  if (lhs === 'unknown') return false;

  // Identity
  if (lhs === rhs) return true;

  return PRIMITIVE_SUBTYPES_CLOSURE[rhs].has(lhs);
}

/**
 * The *meet* (greatest lower bound) of two primitive types in the primitive
 * lattice: the maximal primitive types that are subtypes of both `a` and `b`.
 *
 * - If `a ⊑ b` (or `b ⊑ a`), the result is `[a]` (resp. `[b]`).
 * - For incomparable but overlapping types, the result is the set of maximal
 *   common subtypes, e.g. `meet(integer, finite_real)` = `[finite_integer]`
 *   (`integer` admits ±∞, so the overlap is the *finite* integers). Under D10
 *   the numeric tower is a chain (`integer ⊂ rational ⊂ real ⊂ complex ⊂
 *   number`), so `meet(real, complex)` = `[real]` (real is now below complex);
 *   the union-of-maximals case only arises for genuinely incomparable pairs
 *   such as `meet(imaginary, finite_real)` = `[]`.
 * - For disjoint types (e.g. `meet(string, integer)`), the result is `[]`.
 *
 * The special types `any`, `unknown`, `never`, `nothing` and `error` must be
 * handled by the caller (they are not meaningful operands here).
 */
export function meetPrimitiveTypes(
  a: PrimitiveType,
  b: PrimitiveType
): PrimitiveType[] {
  if (a === b) return [a];
  const sa = PRIMITIVE_SUBTYPES_CLOSURE[a];
  const sb = PRIMITIVE_SUBTYPES_CLOSURE[b];
  if (sa.has(b)) return [b];
  if (sb.has(a)) return [a];

  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const cached = MEET_CACHE.get(key);
  if (cached) return cached;

  // Common subtypes of a and b...
  const common: PrimitiveType[] = [];
  for (const t of sa) if (sb.has(t)) common.push(t);

  // ... reduced to the maximal elements (those not below another common one)
  const maximals = common.filter(
    (t) => !common.some((u) => u !== t && PRIMITIVE_SUBTYPES_CLOSURE[u].has(t))
  );

  MEET_CACHE.set(key, maximals);
  return maximals;
}

const MEET_CACHE = new Map<string, PrimitiveType[]>();

/** True if a numeric type has both a finite lower and a finite upper bound. */
function hasFiniteBounds(t: { lower?: number; upper?: number }): boolean {
  return (
    t.lower !== undefined &&
    t.upper !== undefined &&
    Number.isFinite(t.lower) &&
    Number.isFinite(t.upper)
  );
}

/** The *finite* counterpart of a numeric primitive type (the ±∞-admitting
 *  types map to their finite subtype; already-finite types map to themselves). */
function finiteBaseType(t: NumericPrimitiveType): NumericPrimitiveType {
  switch (t) {
    case 'number':
      return 'finite_number';
    case 'complex':
      return 'finite_complex';
    case 'real':
      return 'finite_real';
    case 'rational':
      return 'finite_rational';
    case 'integer':
      return 'finite_integer';
    default:
      return t;
  }
}

/**
 * The infinity-admitting numeric types, keyed by their *finite* counterpart.
 *
 * A union `finite_X | non_finite_number` covers exactly the same values as the
 * single type `X` (see the numeric tower in `types.ts`: `real = finite_real +
 * non_finite_number`, `integer = finite_integer + non_finite_number`, etc.).
 * Such unions still arise (e.g. from `finite_number ∧ real = finite_real`, or
 * directly-constructed unions), so recognizing the equivalence lets them
 * collapse to — and be seen as equal to — the single covering type `X`. (Under
 * D10 `real ⊂ complex`, so `real ∧ complex = real`; the covering-union map is
 * unchanged and still governs the finite/non-finite collapse.)
 */
export const COVERING_UNION_MAP: Record<string, NumericPrimitiveType> = {
  finite_number: 'number',
  finite_complex: 'complex',
  finite_real: 'real',
  finite_rational: 'rational',
  finite_integer: 'integer',
};

/**
 * If a union contains `non_finite_number` together with a finite numeric type
 * `finite_X`, it also covers the infinity-admitting `X`
 * (`finite_X | non_finite_number ≡ X`). Return the union's members augmented
 * with any such covered supertypes, so a member-wise subtype check can see
 * unions that *cover* a single type (e.g. `real <: finite_real |
 * non_finite_number`). Returns the input unchanged when there is nothing to
 * add.
 */
function unionCoveringMembers(types: Readonly<Type[]>): Readonly<Type[]> {
  if (!types.some((t) => t === 'non_finite_number')) return types;
  let extra: Type[] | undefined;
  for (const t of types) {
    if (typeof t !== 'string') continue;
    const covered = COVERING_UNION_MAP[t];
    if (covered) (extra ??= []).push(covered);
  }
  if (!extra) return types;
  return [...types, ...extra];
}

/**
 * True when `a` and `b` are *provably* disjoint (no value inhabits both).
 * Used for `A <: !B` (a subtype of a negation iff it is disjoint from the
 * negated type). Conservative: returns `false` (may overlap) whenever
 * disjointness cannot be established, so `isSubtype` never over-claims
 * `A <: !B`.
 */
function provablyDisjoint(a: Type, b: Type): boolean {
  if (a === 'never' || b === 'never') return true; // empty set
  if (a === 'any' || b === 'any') return false;
  if (a === 'unknown' || b === 'unknown') return false;
  if (a === 'nothing' || b === 'nothing') return a !== b;

  // If either is a subtype of the other, they share values (overlap).
  if (isSubtype(a, b) || isSubtype(b, a)) return false;

  // A value literal is a singleton `{v}`: having failed the subtype checks
  // above (it is not contained in the other type), it must be disjoint from it.
  if (
    (typeof a === 'object' && a.kind === 'value') ||
    (typeof b === 'object' && b.kind === 'value')
  )
    return true;

  if (typeof a === 'string' && typeof b === 'string')
    return (
      meetPrimitiveTypes(a as PrimitiveType, b as PrimitiveType).length === 0
    );

  // Two bounded numeric ranges: disjoint if their base types are disjoint or
  // their intervals do not overlap.
  if (
    typeof a === 'object' &&
    a.kind === 'numeric' &&
    typeof b === 'object' &&
    b.kind === 'numeric'
  ) {
    if (meetPrimitiveTypes(a.type, b.type).length === 0) return true;
    const aLo = a.lower ?? -Infinity;
    const aHi = a.upper ?? Infinity;
    const bLo = b.lower ?? -Infinity;
    const bHi = b.upper ?? Infinity;
    return aHi < bLo || bHi < aLo;
  }

  // A numeric primitive/range and a non-numeric composite (or vice versa) are
  // disjoint; a numeric vs. numeric-with-overlapping-base is handled above.
  const aNumeric = isNumeric(a);
  const bNumeric = isNumeric(b);
  if (aNumeric !== bNumeric) {
    // One is numeric, the other isn't numeric — but the non-numeric side could
    // still be a broad category (value/scalar/any) that includes numbers.
    // Only conclude disjoint when the non-numeric side is not itself a
    // container of numbers.
    const other = aNumeric ? b : a;
    if (!isScalar(other) && !isValue(other) && !isNumeric(other)) return true;
  }

  // Conservative: assume they might overlap.
  return false;
}

/** Return true if lhs is a subtype of rhs */
export function isSubtype(
  lhs: Type | TypeString,
  rhs: Type | TypeString
): boolean {
  if (typeof lhs === 'string' && !PRIMITIVE_TYPES_SET.has(lhs as PrimitiveType))
    lhs = parseType(lhs);
  if (typeof rhs === 'string' && !PRIMITIVE_TYPES_SET.has(rhs as PrimitiveType))
    rhs = parseType(rhs);

  // Every type is a subtype of `any`, the top type
  if (rhs === 'any') return true;

  // `never` is the bottom type — a subtype of every type (including itself).
  // This must precede the `rhs === 'never'` check below so `never <: never`
  // is true (reflexivity).
  if (lhs === 'never') return true;

  // `never` is the bottom type, no other type is a subtype of `never`
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

    // `broadcastable<T> <: R` (R a primitive) iff `T <: R` and
    // `indexed_collection<T> <: R` (it may be a scalar *or* an indexed
    // collection, so it is a subtype of `R` only when both branches are).
    if (lhs.kind === 'broadcastable') {
      return (
        isSubtype(lhs.elements, rhs) &&
        isSubtype({ kind: 'indexed_collection', elements: lhs.elements }, rhs)
      );
    }

    if (lhs.kind === 'value') {
      if (typeof lhs.value === 'boolean') return rhs === 'boolean';
      if (typeof lhs.value === 'number') {
        if (Number.isInteger(lhs.value))
          return isPrimitiveSubtype('integer', rhs as PrimitiveType);
        // A non-integer number literal (e.g. 3.5) is a real number, not just
        // `number` — `number ⊄ real`, so the old `'number'` made it fail
        // `value 3.5 <: real`. Matches the symmetric path below.
        return isPrimitiveSubtype('real', rhs as PrimitiveType);
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
      // `!A` is the complement of `A` — everything *not* in `A`. It is a
      // subtype of a concrete primitive `S` only when `S` is a top type
      // (`any`/`unknown`), both already handled above. For any other primitive
      // the complement spills outside `S`, so the answer is `false`. (The old
      // `!isSubtype(lhs.type, rhs)` conflated "A ⊄ S" with "!A ⊆ S", making
      // `!string <: integer` — hence `x:!string` `isInteger` — spuriously true.)
      return false;
    }

    if (lhs.kind === 'numeric') {
      // A range with finite numeric bounds cannot be ±∞, so it is a subtype of
      // the *finite* counterpart of its base type even though the base type
      // itself admits ±∞ (e.g. `integer<0..10> ⊑ finite_integer ⊑
      // finite_real`). Without this, `Element(x:integer<0..10>, Integers)`
      // (ℤ = `finite_integer`) was refuted.
      const base = hasFiniteBounds(lhs) ? finiteBaseType(lhs.type) : lhs.type;
      if (!isSubtype(base, rhs)) return false;
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

  // A type is a subtype of a union if it is a subtype of any of the types in
  // the union. The member-wise check is incomplete for *covering* unions
  // (e.g. `real <: finite_real | non_finite_number`, where `real` is a subtype
  // of neither member individually), so augment the rhs members with any
  // single type they jointly cover before probing.
  if (rhs.kind === 'union') {
    const rhsMembers = unionCoveringMembers(rhs.types);
    // A broadcastable lhs is the union `T | indexed_collection<T>`, so it fits
    // a union rhs iff BOTH branches are covered — possibly by *different*
    // members (`broadcastable<number> <: number | indexed_collection<number>`).
    // The member-wise probe below would require a single member to cover the
    // whole broadcastable and wrongly reject exactly that case.
    const broadcastableFitsUnion = (b: BroadcastableType) =>
      isSubtype(b.elements, rhs) &&
      isSubtype({ kind: 'indexed_collection', elements: b.elements }, rhs);
    if (typeof lhs !== 'string' && lhs.kind === 'broadcastable')
      return broadcastableFitsUnion(lhs);
    if (typeof lhs !== 'string' && lhs.kind === 'union') {
      // lhs is a union, rhs is a union
      return lhs.types.every((lhsType) =>
        typeof lhsType !== 'string' && lhsType.kind === 'broadcastable'
          ? broadcastableFitsUnion(lhsType)
          : rhsMembers.some((rhsType) => isSubtype(lhsType, rhsType))
      );
    }
    return rhsMembers.some((t) => isSubtype(lhs, t));
  }

  //
  // Handle rhs negation: `A <: !B ⟺ A and B are disjoint` (no common value).
  // This must precede the primitive fall-through below (a string `lhs` would
  // otherwise short-circuit to `false`), and it handles the contravariant
  // `!A <: !B ⟺ B <: A` case.
  //
  if (rhs.kind === 'negation') {
    if (typeof lhs !== 'string' && lhs.kind === 'negation')
      return isSubtype(rhs.type, lhs.type);
    // `lhs` has been reduced to a `Type` (primitive string or object) at the
    // top of the function.
    return provablyDisjoint(lhs as Type, rhs.type);
  }

  //
  // Handle expressions
  //
  if (rhs.kind === 'expression') {
    // A symbol is a subtype of `expression<Op>` only when `Op` is `Symbol` — a
    // symbol is an `expression<Symbol>`, not an `expression<Add>`. (Both symbol
    // branches previously returned `true` for *every* operator, so any symbol
    // matched `expression<Add>`, `expression<Limits>`, etc.)
    if (lhs === 'symbol') return rhs.operator === 'Symbol';
    if (typeof lhs === 'string') return false;
    if (lhs.kind === 'expression') {
      if (rhs.operator === 'Symbol') return isSymbol(lhs);
      return lhs.operator === rhs.operator;
    }
    if (lhs.kind === 'symbol') return rhs.operator === 'Symbol';
  }

  //
  // Handle broadcastable on the rhs: `broadcastable<T>` = a `T`, or an indexed
  // collection of `T` applied element-wise. This must precede the
  // `typeof lhs === 'string'` fall-through below (a string `lhs` such as
  // `integer` would otherwise short-circuit to `false`).
  //
  if (rhs.kind === 'broadcastable') {
    // BOTH broadcastable: covariant in the element type. Checked *before* the
    // scalar branch so `broadcastable<integer> <: broadcastable<number>`
    // matches on the element types rather than falling into the scalar branch.
    if (typeof lhs !== 'string' && lhs.kind === 'broadcastable')
      return isSubtype(lhs.elements, rhs.elements);

    // A union is broadcastable iff each of its members is.
    if (typeof lhs !== 'string' && lhs.kind === 'union')
      return lhs.types.every((t) => isSubtype(t, rhs));

    // Scalar branch: `S <: T ⟹ S <: broadcastable<T>`.
    if (isSubtype(lhs, rhs.elements)) return true;

    // Collection branch: an indexed collection of `S` with `S <: T`. Tuples
    // are excluded (a runtime broadcast binds points atomically) and sets are
    // not indexed, so both — and every non-collection — fail here.
    const elem = broadcastableCollectionElementType(lhs as Type);
    if (elem !== undefined) return isSubtype(elem, rhs.elements);

    return false;
  }

  //
  // Handle broadcastable on the lhs (rhs is a non-broadcastable object):
  // `broadcastable<T> <: R ⟺ T <: R and indexed_collection<T> <: R`.
  //
  if (typeof lhs !== 'string' && lhs.kind === 'broadcastable') {
    return (
      isSubtype(lhs.elements, rhs) &&
      isSubtype({ kind: 'indexed_collection', elements: lhs.elements }, rhs)
    );
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
      return isSubtype(
        {
          kind: 'tuple',
          elements: [
            { type: 'string' },
            { type: widen(...Object.values(lhs.elements)) },
          ],
        },
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

    // Check that all the elements match by type (covariantly) and name.
    // Names are erasable in the subtype direction: a *named* tuple is a
    // subtype of a same-shape *unnamed* tuple (`tuple<x: integer, y: integer>
    // <: tuple<integer, integer>`), but not the reverse — the unnamed tuple
    // lacks the field names the named supertype guarantees. So only require a
    // matching name when the rhs (supertype) element is itself named.
    for (let i = 0; i < lhs.elements.length; i++) {
      const a = lhs.elements[i];
      const b = rhs.elements[i];
      if (!isSubtype(a.type, b.type)) return false;
      if (b.name !== undefined && a.name !== b.name) return false;
    }
    return true;
  }

  //
  // Handle lists
  //
  if (rhs.kind === 'list' && lhs.kind === 'list') {
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

  // A numeric *value literal* is a subtype of a bounded numeric type when the
  // value satisfies the base kind and lies within the bounds. (Without this,
  // `value 7 <: integer<5..10>` fell through to the value fallback below,
  // which tested `integer <: integer<5..10>` — always `false`.)
  if (rhs.kind === 'numeric' && lhs.kind === 'value') {
    if (typeof lhs.value !== 'number') return false;
    const baseKind: NumericPrimitiveType = Number.isInteger(lhs.value)
      ? 'finite_integer'
      : 'finite_real';
    if (!isPrimitiveSubtype(baseKind, rhs.type)) return false;
    if (lhs.value < (rhs.lower ?? -Infinity)) return false;
    if (lhs.value > (rhs.upper ?? Infinity)) return false;
    return true;
  }

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

  // Note: negation on the rhs (including the both-negation `!A <: !B ⟺ B <: A`
  // case) is handled earlier, before the primitive fall-through.

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
    return NUMERIC_TYPES_SET.has(type as NumericPrimitiveType);
  if (type.kind === 'value') return typeof type.value === 'number';
  if (type.kind === 'numeric') return true;
  return false;
}

function isScalar(type: Type): boolean {
  if (isNumeric(type)) return true;
  if (typeof type === 'string')
    return SCALAR_TYPES_SET.has(type as PrimitiveType);
  if (type.kind === 'value')
    return ['string', 'boolean', 'number'].includes(typeof type.value);
  return false;
}

function isCollection(type: Type): boolean {
  if (isIndexedCollection(type)) return true;
  if (typeof type === 'string')
    return COLLECTION_TYPES_SET.has(type as PrimitiveType);
  return ['collection', 'set', 'record', 'dictionary'].includes(type.kind);
}

function isIndexedCollection(type: Type): boolean {
  if (typeof type === 'string') return false;
  return ['indexed_collection', 'list', 'tuple'].includes(type.kind);
}

/**
 * The element type of an indexed collection eligible for broadcasting (a
 * `list` or an `indexed_collection`), or `undefined` for anything else. Tuples
 * are deliberately excluded (a runtime broadcast binds points atomically) and
 * sets are not indexed. Mirrors `collectionElementType` (utils.ts) for the
 * list/indexed-collection cases without importing it (which would reintroduce
 * the subtype ↔ utils cycle).
 */
function broadcastableCollectionElementType(type: Type): Type | undefined {
  if (typeof type === 'string') {
    if (type === 'indexed_collection' || type === 'list') return 'any';
    return undefined;
  }
  if (type.kind === 'indexed_collection') return type.elements;
  if (type.kind === 'list') {
    const dims = type.dimensions;
    // A multi-dimensional list indexed by one index yields a sub-tensor with
    // one fewer dimension, not its scalar element (see `collectionElementType`).
    if (dims && dims.length > 1)
      return {
        kind: 'list',
        elements: type.elements,
        dimensions: dims.slice(1),
      };
    return type.elements;
  }
  return undefined;
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

//
// widen/narrow functions — moved here from utils.ts because they depend on
// isSubtype (breaking the subtype ↔ utils cycle). Re-exported from utils.ts
// for backward compatibility.
//

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

  // Disjoint types have no common subtype: the narrowest common type is the
  // bottom type `never`. (Returning `superType` would *widen* — the opposite
  // of narrowing, e.g. `narrow('integer', 'string')` → `scalar`.)
  return 'never';
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

  // Two types that are not subtypes of each other. Try the common
  // supertype: this works well for related numeric types (e.g.
  // integer/real → real). But if the supertype collapses to a generic
  // category that loses information (e.g. 'scalar' for number+string,
  // or 'tuple' for two tuples of different shape), surface the
  // heterogeneity as an explicit union so downstream consumers (e.g.
  // the List operator's type handler) can detect mixed-kind content.
  const sup = superType(a, b);
  if (LOSSY_SUPERTYPE.has(sup as string)) return unionTypes(a, b);
  return sup;
}

const LOSSY_SUPERTYPE = new Set<string>([
  'scalar',
  'value',
  'function',
  'expression',
  'collection',
  'indexed_collection',
  'list',
  'set',
  'tuple',
  'record',
  'dictionary',
  'map',
  'any',
]);

/** Build a union of two types, flattening if either is already a union and
 *  de-duplicating identical members. Returns the simpler type if reducible.
 */
function unionTypes(a: Readonly<Type>, b: Readonly<Type>): Readonly<Type> {
  const members: Type[] = [];
  // de-dup by structural equality: each member's key is computed once
  const keys = new Set<string>();
  const push = (t: Readonly<Type>) => {
    if (typeof t === 'object' && t.kind === 'union') {
      for (const m of t.types) push(m);
      return;
    }
    const key = typeof t === 'string' ? t : JSON.stringify(t);
    if (!keys.has(key)) {
      keys.add(key);
      members.push(t as Type);
    }
  };
  push(a);
  push(b);
  if (members.length === 1) return members[0];
  return { kind: 'union', types: members };
}

/** Convert two or more types into a more specific type that is a subtype of
 *  all the input types. The resulting type is usually more constrained and
 *  only encompasses values that belong to both input types.
 */
export function narrow(...types: Readonly<Type>[]): Type {
  if (types.length === 0) return 'nothing';
  if (types.length === 1) return types[0];

  return types.reduce((a, b) => narrow2(a, b));
}

/** Convert two or more types into a broader, more general type that can
 *  accommodate all the input types. The resulting type is usually a supertype
 *  that encompasses the possible values of the input types.
 */
export function widen(...types: Readonly<Type>[]): Readonly<Type> {
  if (types.length === 0) return 'nothing';
  if (types.length === 1) return types[0];

  return types.reduce((a, b) => widen2(a, b));
}

/**
 * The candidate common supertypes probed by `superType`, ordered from most
 * specific to most general.
 */
const SUPERTYPE_PROBE_ORDER: PrimitiveType[] = [
  'non_finite_number',
  'finite_integer',
  'integer',
  'finite_rational',
  'rational',
  'finite_real',
  'real',
  'imaginary',
  'finite_complex',
  'complex',
  'finite_number',
  'number',
  'list',
  'record',
  'dictionary',
  'set',
  'tuple',
  'indexed_collection',
  'collection',
  'scalar',
  'value',
  'function',
  'expression',
];

/** Memoized results of `superType` for pairs of primitive types */
const PRIMITIVE_SUPERTYPE_CACHE = new Map<string, PrimitiveType>();

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

  // Fast path: for a pair of primitive types, use a direct lookup table
  // (computed on demand from the closure sets, then memoized)
  if (typeof a === 'string' && typeof b === 'string') {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let result = PRIMITIVE_SUPERTYPE_CACHE.get(key);
    if (result === undefined) {
      result = 'any';
      for (const ancestor of SUPERTYPE_PROBE_ORDER) {
        const subtypes = PRIMITIVE_SUBTYPES_CLOSURE[ancestor];
        if (
          subtypes.has(a as PrimitiveType) &&
          subtypes.has(b as PrimitiveType)
        ) {
          result = ancestor;
          break;
        }
      }
      PRIMITIVE_SUPERTYPE_CACHE.set(key, result);
    }
    return result;
  }

  // Check in order from most specific to most general
  for (const ancestor of SUPERTYPE_PROBE_ORDER)
    if (isSubtype(a, ancestor) && isSubtype(b, ancestor)) return ancestor;

  return 'any';
}
