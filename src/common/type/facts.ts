import type { Type } from './types.js';
import { isSubtype, provablyDisjoint } from './subtype.js';
import { parseType } from './parse.js';
import { isKnownImmutableType } from './immutable.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
  EXTENDED_REAL_TYPE,
} from './primitive.js';
import {
  isNumericScalarType,
  couldBeNonRealNumber,
  resolveTypeAlias,
  typeContainsMissing,
} from './utils.js';

/** Set before loading the engine to check cached facts against their predicates. */
const ASSERT_FACTS =
  typeof process !== 'undefined' && process.env?.CE_TYPE_FACTS_ASSERT === '1';

const MATRIX_TYPE = parseType('matrix');
const VECTOR_TYPE = parseType('vector');

type Tri = boolean | undefined;

const enum Fact {
  NumericScalar,
  Integer,
  Rational,
  Real,
  Imaginary,
  Complex,
  BelowNumber,
  CouldBeNumber,
  Finite,
  Nan,
  Infinity,
  ExtendedReal,
  CouldBeNonReal,
  Collection,
  Indexed,
  TupleShaped,
  Matrix,
  Vector,
  ContainsMissing,
  UnknownOrAny,
  NumberMembership,
  InfinityMembership,
}

/**
 * Type-only evidence, computed lazily from shared proofs. Unknown answers
 * are cached too. Expression values, assumptions and operator sign handlers
 * belong to operand facts and must never be stored here.
 *
 * Mutable host ASTs and types containing references or variables use live
 * getters: a frozen reference can still delegate to a mutable declaration.
 */
export class TypeFacts {
  private known = 0;
  private yes = 0;
  private no = 0;
  private shapeKnown = false;
  private cachedShape: readonly number[] | undefined;

  constructor(
    readonly type: Type,
    private readonly cacheable: boolean
  ) {}

  get numericScalar(): boolean {
    return this.read(Fact.NumericScalar)!;
  }
  get integer(): boolean {
    return this.read(Fact.Integer)!;
  }
  get rational(): boolean {
    return this.read(Fact.Rational)!;
  }
  get real(): boolean {
    return this.read(Fact.Real)!;
  }
  get imaginary(): boolean {
    return this.read(Fact.Imaginary)!;
  }
  get complex(): boolean {
    return this.read(Fact.Complex)!;
  }
  get belowNumber(): boolean {
    return this.read(Fact.BelowNumber)!;
  }
  get couldBeNumber(): boolean {
    return this.read(Fact.CouldBeNumber)!;
  }
  get finite(): Tri {
    return this.read(Fact.Finite);
  }
  get nan(): boolean {
    return this.read(Fact.Nan)!;
  }
  get infinity(): boolean {
    return this.read(Fact.Infinity)!;
  }
  get extendedReal(): boolean {
    return this.read(Fact.ExtendedReal)!;
  }
  get couldBeNonReal(): boolean {
    return this.read(Fact.CouldBeNonReal)!;
  }
  get collection(): Tri {
    return this.read(Fact.Collection);
  }
  get indexed(): Tri {
    return this.read(Fact.Indexed);
  }
  get tupleShaped(): boolean {
    return this.read(Fact.TupleShaped)!;
  }
  get matrix(): boolean {
    return this.read(Fact.Matrix)!;
  }
  get vector(): boolean {
    return this.read(Fact.Vector)!;
  }
  get containsMissing(): boolean {
    return this.read(Fact.ContainsMissing)!;
  }
  get unknownOrAny(): boolean {
    return this.read(Fact.UnknownOrAny)!;
  }

  get numberMembership(): Tri {
    return this.read(Fact.NumberMembership);
  }
  get infinityMembership(): Tri {
    return this.read(Fact.InfinityMembership);
  }

  get shape(): readonly number[] | undefined {
    if (!this.cacheable) return shapeFromType(this.type);
    if (!this.shapeKnown) {
      this.cachedShape = shapeFromType(this.type);
      this.shapeKnown = true;
    }
    if (ASSERT_FACTS && this.cachedShape !== shapeFromType(this.type))
      throw new Error('Stale type shape fact');
    return this.cachedShape;
  }

  get finiteCollection(): Tri {
    return this.shape !== undefined ? true : undefined;
  }

  private read(fact: Fact): Tri {
    if (!this.cacheable) return this.compute(fact);
    const bit = 1 << fact;
    if ((this.known & bit) === 0) {
      const result = this.computeFromFacts(fact);
      this.known |= bit;
      if (result === true) this.yes |= bit;
      else if (result === false) this.no |= bit;
      if (ASSERT_FACTS && result !== this.compute(fact))
        throw new Error(`Incorrect derived type fact ${fact}`);
      return result;
    }
    const result =
      (this.yes & bit) !== 0 ? true : (this.no & bit) !== 0 ? false : undefined;
    if (ASSERT_FACTS && result !== this.compute(fact))
      throw new Error(`Stale type fact ${fact}`);
    return result;
  }

  /** Reuse already requested proofs without weakening the original predicates. */
  private computeFromFacts(fact: Fact): Tri {
    const t = this.type;
    // A numeric range's relation to a primitive tier is exactly its base's
    // relation (subtype.ts's numeric/primitive arm). Reuse the base record;
    // neither endpoints nor sign/range proofs are inferred from the tier.
    if (
      typeof t === 'object' &&
      t.kind === 'numeric' &&
      ((fact >= Fact.Integer && fact <= Fact.BelowNumber) ||
        fact === Fact.Nan ||
        fact === Fact.Infinity)
    )
      return factsOf(t.type).read(fact);

    switch (fact) {
      case Fact.Finite:
        return this.complex
          ? true
          : this.infinity || this.nan
            ? false
            : undefined;
      case Fact.ExtendedReal:
        return this.real || isSubtype(t, EXTENDED_REAL_TYPE);
      case Fact.CouldBeNonReal:
        return isSubtype('complex', t) || (this.belowNumber && !this.real);
      case Fact.NumberMembership:
        if (t === 'unknown' || t === 'any') return undefined;
        return this.belowNumber ? true : this.couldBeNumber ? undefined : false;
      case Fact.InfinityMembership:
        if (t === 'unknown' || t === 'any') return undefined;
        return this.infinity
          ? true
          : provablyDisjoint(t, 'infinity')
            ? false
            : undefined;
      default:
        return this.compute(fact);
    }
  }

  private compute(fact: Fact): Tri {
    const t = this.type;
    switch (fact) {
      case Fact.NumericScalar:
        return isNumericScalarType(t);
      case Fact.Integer:
        return isSubtype(t, 'integer');
      case Fact.Rational:
        return isSubtype(t, 'rational');
      case Fact.Real:
        return isSubtype(t, 'real');
      case Fact.Imaginary:
        return isSubtype(t, 'imaginary');
      case Fact.Complex:
        return isSubtype(t, 'complex');
      case Fact.BelowNumber:
        return isSubtype(t, 'number');
      case Fact.CouldBeNumber:
        return !provablyDisjoint(t, 'number');
      case Fact.Finite:
        return isSubtype(t, 'complex')
          ? true
          : isSubtype(t, 'infinity') || isSubtype(t, 'nan')
            ? false
            : undefined;
      case Fact.Nan:
        return isSubtype(t, 'nan');
      case Fact.Infinity:
        return isSubtype(t, 'infinity');
      case Fact.ExtendedReal:
        return isSubtype(t, 'real') || isSubtype(t, EXTENDED_REAL_TYPE);
      case Fact.CouldBeNonReal:
        return couldBeNonRealNumber(t);
      case Fact.Collection:
        return isSubtype(t, COLLECTION_SHAPE_TYPE)
          ? true
          : provablyDisjoint(t, COLLECTION_SHAPE_TYPE)
            ? false
            : undefined;
      case Fact.Indexed:
        return isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)
          ? true
          : provablyDisjoint(t, INDEXED_COLLECTION_SHAPE_TYPE)
            ? false
            : undefined;
      case Fact.TupleShaped: {
        const resolved = resolveTypeAlias(t);
        return (
          resolved === 'tuple' ||
          (typeof resolved === 'object' && resolved.kind === 'tuple')
        );
      }
      case Fact.Matrix:
        return isSubtype(t, MATRIX_TYPE);
      case Fact.Vector:
        return isSubtype(t, VECTOR_TYPE);
      case Fact.ContainsMissing:
        return typeContainsMissing(t);
      case Fact.UnknownOrAny:
        return t === 'unknown' || t === 'any';
      case Fact.NumberMembership:
        return membership(t, 'number');
      case Fact.InfinityMembership:
        return membership(t, 'infinity');
    }
  }
}

function membership(t: Type, target: Type): Tri {
  if (t === 'unknown' || t === 'any') return undefined;
  return isSubtype(t, target)
    ? true
    : provablyDisjoint(t, target)
      ? false
      : undefined;
}

function shapeFromType(t: Type): readonly number[] | undefined {
  if (
    typeof t === 'object' &&
    t.kind === 'list' &&
    Array.isArray(t.dimensions) &&
    t.dimensions.length > 0 &&
    t.dimensions.every(
      (d) => typeof d === 'number' && Number.isFinite(d) && d >= 0
    )
  )
    return t.dimensions;
  return undefined;
}

const primitives = new Map<string, TypeFacts>();
const objects = new WeakMap<object, TypeFacts>();
const stableObjects = new WeakSet<object>();

/**
 * Prove deep immutability before caching. Object.freeze alone is shallow,
 * and accessor properties may depend on mutable state. This walk runs only
 * when a fact record is first requested, never on individual fact reads.
 * References (including nested ones), variables and quantified signatures
 * deliberately fail even when frozen.
 */
function isStable(value: unknown, visiting?: Set<object>): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (isKnownImmutableType(value) || stableObjects.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  // A frozen object can inherit mutable fields or accessors. Only ordinary
  // data containers have a prototype independent of caller-owned state.
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== null &&
    prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype)
  )
    return false;
  const t = value as Partial<Exclude<Type, string>>;
  if (
    t.kind === 'reference' ||
    t.kind === 'variable' ||
    (t.kind === 'signature' && t.typeParams !== undefined)
  )
    return false;
  if (visiting?.has(value)) return false;
  visiting ??= new Set();
  visiting.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in property) || !isStable(property.value, visiting)) {
      visiting.delete(value);
      return false;
    }
  }
  visiting.delete(value);
  stableObjects.add(value);
  return true;
}

/** Whether a type is deeply immutable and independent of mutable declarations. */
export function isStableType(t: Type): boolean {
  return isStable(t);
}

/** Shared lazy evidence for a type identity; safe for mutable inputs too. */
export function factsOf(t: Type): TypeFacts {
  if (typeof t === 'string') {
    let result = primitives.get(t);
    if (result === undefined) {
      result = new TypeFacts(t, true);
      primitives.set(t, result);
    }
    return result;
  }
  let result = objects.get(t);
  if (result === undefined) {
    result = new TypeFacts(t, isStable(t));
    objects.set(t, result);
  }
  return result;
}
