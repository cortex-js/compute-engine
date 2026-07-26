import type { Type, TypeResolver, TypeString } from './types.js';
import { couldMatch, isSubtype, provablyDisjoint } from './subtype.js';
import { typeToString } from './serialize.js';
import { parseType } from './parse.js';
import { narrow, widen } from './utils.js';

/** @category Type */
export class BoxedType {
  static unknown = new BoxedType('unknown');
  static number = new BoxedType('number');
  static non_finite_number = new BoxedType('non_finite_number');
  static finite_number = new BoxedType('finite_number');
  static finite_integer = new BoxedType('finite_integer');
  static finite_real = new BoxedType('finite_real');
  static string = new BoxedType('string');
  static dictionary = new BoxedType('dictionary');

  static setNumber = new BoxedType('set<number>');
  static setComplex = new BoxedType('set<complex>');
  static setImaginary = new BoxedType('set<imaginary>');
  static setReal = new BoxedType('set<real>');
  static setRational = new BoxedType('set<rational>');
  static setFiniteInteger = new BoxedType('set<finite_integer>');
  static setInteger = new BoxedType('set<integer>');

  type: Type;

  static widen(...types: ReadonlyArray<BoxedType | Type>): BoxedType {
    return new BoxedType(
      widen(...types.map((x) => (x instanceof BoxedType ? x.type : x)))
    );
  }

  static narrow(...types: ReadonlyArray<BoxedType | Type>): BoxedType {
    return new BoxedType(
      narrow(...types.map((x) => (x instanceof BoxedType ? x.type : x)))
    );
  }

  constructor(type: Type | TypeString, typeResolver?: TypeResolver) {
    // super(typeof type === 'string' ? type : typeToString(type));
    if (typeof type === 'string') this.type = parseType(type, typeResolver);
    else this.type = type;
  }

  matches(other: Type | TypeString | BoxedType): boolean {
    if (other instanceof BoxedType) return isSubtype(this.type, other.type);
    // `isSubtype` parses any non-primitive `TypeString` (e.g. `'matrix'`,
    // `'vector'`, `'list<number>'`), so a bare string type name is accepted
    // here just like the `BoxedType` constructor accepts one — no need to box.
    return isSubtype(this.type, other);
  }

  is(other: Type): boolean {
    return isSubtype(this.type, other) && isSubtype(other, this.type);
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
    if (other instanceof BoxedType)
      return provablyDisjoint(this.type, other.type);
    return provablyDisjoint(
      this.type,
      typeof other === 'string' ? parseType(other) : other
    );
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
    if (other instanceof BoxedType) return couldMatch(this.type, other.type);
    return couldMatch(
      this.type,
      typeof other === 'string' ? parseType(other) : other
    );
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
      return this.type.types.map((t) => new BoxedType(t));
    return [this];
  }

  get isUnknown(): boolean {
    return this.type === 'unknown';
  }

  toString(): string {
    return typeToString(this.type);
  }

  toJSON(): string {
    return typeToString(this.type);
  }

  [Symbol.toPrimitive](hint: string): string | null {
    if (hint === 'string') return this.toString();

    return null; // Default for other hints like 'number'
  }

  valueOf(): string {
    return typeToString(this.type);
  }
}
