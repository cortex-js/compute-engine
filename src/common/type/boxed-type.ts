import type { Type, TypeResolver, TypeString } from './types';
import { isSubtype } from './subtype';
import { typeToString } from './serialize';
import { parseType } from './parse';
import { narrow, widen } from './utils';

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

  matches(other: Type | BoxedType): boolean {
    if (other instanceof BoxedType) return isSubtype(this.type, other.type);
    return isSubtype(this.type, other);
  }

  is(other: Type): boolean {
    return isSubtype(this.type, other) && isSubtype(other, this.type);
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
