import type { EffectSet, Type, TypeResolver, TypeString } from './types.js';
import { couldMatch, isSubtype, provablyDisjoint } from './subtype.js';
import { typeToString } from './serialize.js';
import { parseType } from './parse.js';
import { narrow, signatureEffects, widen } from './utils.js';
import {
  hasOptionalWithVariadic,
  VARIADIC_WITH_OPTIONAL_MESSAGE,
} from './primitive.js';
import {
  hasFreeTypeVariables,
  isPolymorphicType,
  matchesPolytypePattern,
  readTypeVariablesAsBounds,
  TypeVariableError,
  validateDeclaredType,
} from './instantiate.js';

/** @category Type */
export class BoxedType {
  static unknown = new BoxedType('unknown');
  static number = new BoxedType('number');
  static non_finite_number = new BoxedType('non_finite_number');
  static finite_number = new BoxedType('finite_number');
  static finite_integer = new BoxedType('finite_integer');
  static finite_real = new BoxedType('finite_real');
  static string = new BoxedType('string');
  static character = new BoxedType('character');
  static dictionary = new BoxedType('dictionary');

  static setNumber = new BoxedType('set<number>');
  static setComplex = new BoxedType('set<complex>');
  static setImaginary = new BoxedType('set<imaginary>');
  static setReal = new BoxedType('set<real>');
  static setRational = new BoxedType('set<rational>');
  static setFiniteInteger = new BoxedType('set<finite_integer>');
  static setInteger = new BoxedType('set<integer>');

  type: Type;

  /**
   * True when this type is a **polytype**: a signature carrying a `where`
   * clause, or an overload set with at least one such arm.
   *
   * Computed ONCE, here, at construction: every per-call dispatch check
   * (argument validation, result typing) reads this boolean and is O(1) — it
   * must never become a tree walk. Polytypes are legal only as signatures, so
   * the computation itself is a shallow field test.
   */
  readonly isPolymorphic: boolean;

  /** The resolver this type was created with, if any.
   *
   * Kept so that a string argument handed to `matches()`, `is()`,
   * `isDisjointFrom()` or `couldMatch()` can name a user-declared type: such
   * a name is only meaningful relative to a resolver. */
  private _typeResolver: TypeResolver | undefined;

  /** The resolver this type was created with, so a DERIVED boxed type (a
   * projection of this one) can be built without losing the ability to name a
   * user-declared type. */
  get typeResolver(): TypeResolver | undefined {
    return this._typeResolver;
  }

  /** The resolver of the first boxed operand that has one, so a combined type
   * can still be compared against a user-declared type name. */
  private static _resolverOf(
    types: ReadonlyArray<BoxedType | Type>
  ): TypeResolver | undefined {
    for (const x of types)
      if (x instanceof BoxedType && x._typeResolver !== undefined)
        return x._typeResolver;
    return undefined;
  }

  static widen(...types: ReadonlyArray<BoxedType | Type>): BoxedType {
    return new BoxedType(
      widen(...types.map((x) => (x instanceof BoxedType ? x.type : x))),
      BoxedType._resolverOf(types)
    );
  }

  static narrow(...types: ReadonlyArray<BoxedType | Type>): BoxedType {
    return new BoxedType(
      narrow(...types.map((x) => (x instanceof BoxedType ? x.type : x))),
      BoxedType._resolverOf(types)
    );
  }

  constructor(type: Type | TypeString, typeResolver?: TypeResolver) {
    // super(typeof type === 'string' ? type : typeToString(type));
    this._typeResolver = typeResolver;
    if (typeof type === 'string') this.type = parseType(type, typeResolver);
    else this.type = type;

    this.isPolymorphic = isPolymorphicType(this.type);

    // The string route validated its clause in `parseType()`. On the OBJECT
    // route the same §7.2 validation runs here: a hand-built polytype is
    // validated, and anything else must be CLOSED. The free-variable scan is
    // not the shallow "is it a bare variable" test it once was — a variable
    // nested at any depth (`list<T>`, `tuple<T, integer>`) is just as open, and
    // boxing it silently is what lets it escape into the algebra, whose helpers
    // assert on an open input.
    if (typeof this.type === 'object' && typeof type !== 'string') {
      // The type-string grammar refuses a signature that combines optional
      // parameters with a variadic tail (see
      // `VARIADIC_WITH_OPTIONAL_MESSAGE`), and a hand-built `Type` object has
      // to be refused for the same reason: admitting one mints a type with no
      // spelling — `typeToString()` prints
      // `(number, number?, number+) -> number`, which `parseType()` then
      // cannot read back.
      if (hasOptionalWithVariadic(this.type)) {
        const err = new Error(
          `The type \`${typeToString(this.type)}\` is invalid: ${VARIADIC_WITH_OPTIONAL_MESSAGE}`
        ) as Error & { code?: string; rawMessage?: string };
        err.code = 'variadic-with-optional';
        err.rawMessage = VARIADIC_WITH_OPTIONAL_MESSAGE;
        throw err;
      }
      if (this.isPolymorphic) validateDeclaredType(this.type, typeResolver);
      else if (hasFreeTypeVariables(this.type))
        throw new TypeVariableError(
          'unresolved-type-variable',
          `The type \`${typeToString(this.type)}\` refers to a type variable that is not quantified by a \`where\` clause: an open type is not declarable`
        );
    }
  }

  /**
   * Resolve an argument of one of the comparison predicates to a `Type`.
   *
   * A `TypeString` argument may name a user-declared type (`'point'`), which
   * only a resolver can make sense of. The predicates in `subtype.ts` are
   * engine-independent and parse without one, so the resolution has to happen
   * here, at the boundary.
   *
   * Two steps on purpose: `parseType()` memo-caches only resolver-less calls,
   * and that cache carries the hot path (ground types such as `'number'` or
   * `'list<integer>'`). A resolver-less parse either succeeds — with the same
   * result a resolver-aware one would give, since a user type name can never
   * shadow built-in type syntax — or throws on the user name, which is the
   * only case that needs the (uncached) resolver-aware parse.
   */
  private _resolve(other: Type | TypeString | BoxedType): Type {
    if (other instanceof BoxedType) return other.type;
    if (typeof other !== 'string') return other;
    try {
      return parseType(other);
    } catch (e) {
      if (this._typeResolver === undefined) throw e;
      return parseType(other, this._typeResolver);
    }
  }

  /**
   * True when every value of this type is an `other`.
   *
   * **A polymorphic PATTERN is a consistent existential** (D12): the pattern's
   * variables are solved against the subject and the match holds iff a
   * consistent instantiation exists — so
   * `ce.type('(number) -> number').matches('(T) -> T where T')` is `true`,
   * the probe users actually mean. `couldMatch` deliberately answers `false`
   * on the same row (D6's bound-reading, contravariant `any`); the two
   * predicates diverge by design.
   *
   * A polymorphic SUBJECT is the `isSubtype` story: rule 1 against a ground
   * pattern (instantiate-and-check), rule 3 (α-equivalence) against a
   * polymorphic one.
   */
  matches(other: Type | TypeString | BoxedType): boolean {
    const pattern = this._resolve(other);
    // Gated on the O(1) flags: a ground pattern costs exactly what it did.
    if (!this.isPolymorphic && isPolymorphicType(pattern))
      return matchesPolytypePattern(this.type, pattern);
    return isSubtype(this.type, pattern);
  }

  is(other: Type | TypeString | BoxedType): boolean {
    const t = this._resolve(other);
    return isSubtype(this.type, t) && isSubtype(t, this.type);
  }

  /**
   * True when no value can inhabit both this type and `other`.
   *
   * Use this — not `!matches()` — to decide whether two types are unrelated.
   * `matches()` answers "is this a subtype of `other`", so two types that
   * share values without either containing the other (`integer | string` vs
   * `integer | boolean`) fail `matches()` in both directions.
   *
   * Conservative in the safe direction: when disjointness cannot be
   * established the answer is `false` ("they may overlap"), never a false
   * claim of disjointness. So `!a.isDisjointFrom(b)` reads as *possible*
   * overlap, and `unknown` overlaps everything.
   *
   * Throws if `other` is a string that is not a valid type.
   */
  isDisjointFrom(other: Type | TypeString | BoxedType): boolean {
    return provablyDisjoint(this.type, this._resolve(other));
  }

  /**
   * True when *some* value inhabits both this type and `other` — "could a
   * value of this type be an `other`?".
   *
   * This is the predicate for classifying a value by shape ("might this be a
   * point, a point list, a matrix"). Prefer it to `matches()`, which answers
   * "is EVERY value of this type an `other`" and so reports `false` for a
   * union whose members include exactly the shape asked about:
   *
   * ```ts
   * const t = ce.type('tuple<number, number> | list<tuple<number, number>>');
   * t.matches('list<tuple<number, number>>');    // false
   * t.couldMatch('list<tuple<number, number>>'); // true
   * ```
   *
   * Unions are distributed at every depth, so a union nested inside a
   * parameter is handled too — `list<integer | tuple<number, number>>` could
   * be a `list<tuple<number, number>>`, witness `[(1,2)]`.
   *
   * Symmetric, and decisive for the composite shapes it models: a
   * `tuple<number, number>` could not be a `list<tuple<number, number>>`, and
   * `list<integer>` could not be a `list<string>`. Shapes it does not model
   * fall back to assignability in either direction, so the answer is never
   * narrower than `matches()` — with one deliberate exception: `never` is
   * uninhabited, so nothing could be a `never`.
   *
   * `unknown` could be anything. Consumers that treat an inconclusive type as
   * "no" must check `isUnknown` themselves.
   *
   * Throws if `other` is a string that is not a valid type.
   */
  couldMatch(other: Type | TypeString | BoxedType): boolean {
    const pattern = this._resolve(other);
    // D6 bound-reading, on BOTH sides: each free variable occurrence reads as
    // its declared bound (`any` when unbounded), a wildcard with no
    // cross-occurrence consistency. Kept for `couldMatch` (and the
    // subject-less `at`-handler check) even though pattern-side `matches` went
    // existential under D12 — the two predicates are pinned separately.
    if (this.isPolymorphic || isPolymorphicType(pattern))
      return couldMatch(
        readTypeVariablesAsBounds(this.type),
        readTypeVariablesAsBounds(pattern)
      );
    return couldMatch(this.type, pattern);
  }

  /**
   * The members of a union type, each boxed, or `[this]` for any other type.
   *
   * Lets a consumer reason arm-by-arm without reading the raw `Type` AST.
   * Note that a union may be nested inside a parameter (`list<A | B>`), which
   * this does not reach — `couldMatch()` handles that case directly and is
   * usually what an arm walk was reaching for.
   */
  get unionMembers(): BoxedType[] {
    if (typeof this.type === 'object' && this.type.kind === 'union')
      return this.type.types.map((t) => new BoxedType(t, this._typeResolver));
    return [this];
  }

  /**
   * The **latent** effects on this type's arrow: what fires if a value of this
   * type is invoked. `undefined` when the type is not callable, or when its
   * arrow states nothing (the inferred track); `[]` when it states `pure`;
   * `'any'` for "unknown effects"; otherwise the labels, alphabetically
   * sorted.
   *
   * This is how an operator asks "what happens if I call this operand?" —
   * `op.type.effects`, which resolves through symbol bindings because `.type`
   * does. It is the *invoking* half of the effects model; the *producing*
   * half — what evaluating an expression does — is `expr.effects`.
   *
   * For an overload set (an intersection of signatures) the answer is the
   * union of the arms': an overload with one effect-bearing arm is not pure.
   *
   * ```ts
   * ce.type('(real) random -> real').effects;  // ➔ ['random']
   * ce.type('(real) pure -> real').effects;    // ➔ []
   * ce.type('(real) -> real').effects;         // ➔ undefined
   * ce.type('number').effects;                 // ➔ undefined
   * ```
   */
  get effects(): EffectSet | undefined {
    return signatureEffects(this.type);
  }

  get isUnknown(): boolean {
    return this.type === 'unknown';
  }

  toString(): string {
    return typeToString(this.type);
  }

  toJSON(): string {
    return this.toString();
  }

  [Symbol.toPrimitive](hint: string): string | null {
    if (hint === 'string') return this.toString();

    return null; // Default for other hints like 'number'
  }

  valueOf(): string {
    return this.toString();
  }
}
