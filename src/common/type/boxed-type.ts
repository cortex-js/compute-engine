import type { Type, TypeString } from './types';
import { isSubtype } from './subtype';
import { typeToString } from './serialize';
import { parseType } from './parse';

export class BoxedType {
  static unknown = new BoxedType('unknown');

  type: Type;

  constructor(type: Type | TypeString) {
    // super(typeof type === 'string' ? type : typeToString(type));
    if (typeof type === 'string') this.type = parseType(type);
    else this.type = type;
  }

  matches(other: Type | TypeString | BoxedType): boolean {
    if (other instanceof BoxedType) return isSubtype(this.type, other.type);
    return isSubtype(this.type, other);
  }

  is(other: Type | TypeString): boolean {
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
