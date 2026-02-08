import type {
  BoxedExpression,
  PatternMatchOptions,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Metadata,
  StringInterface,
} from '../global-types';

import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode, isBoxedExpression } from './utils';
import { isWildcard, wildcardName } from './pattern-utils';
import { BoxedType } from '../../common/type/boxed-type';
import { matchesNumber, matchesSymbol } from '../../math-json/utils';

/**
 * BoxedString
 *
 */

export class BoxedString
  extends _BoxedExpression
  implements StringInterface
{
  [Symbol.toStringTag]: string = '[BoxedString]';
  private readonly _string: string;
  private _utf8Buffer?: Uint8Array | undefined;
  private _unicodeScalarValues?: number[] | undefined;
  constructor(ce: ComputeEngine, expr: string, metadata?: Metadata) {
    super(ce, metadata);
    // Strings are always stored in Unicode NFC canonical order
    // See https://unicode.org/reports/tr15/
    this._string = expr.normalize();
  }
  get json(): string {
    return !(matchesSymbol(this._string) && !matchesNumber(this._string))
      ? `'${this._string}'`
      : this._string;
  }
  get hash(): number {
    return hashCode('String' + this._string);
  }
  get operator(): string {
    return 'String';
  }
  get isPure(): boolean {
    return true;
  }
  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(_va: boolean) {
    return;
  }

  get value(): BoxedExpression {
    return this;
  }

  get type(): BoxedType {
    return BoxedType.string;
  }

  get complexity(): number {
    return 19;
  }
  get string(): string {
    return this._string;
  }

  get buffer(): Uint8Array {
    if (this._utf8Buffer === undefined) {
      const encoder = new TextEncoder();
      this._utf8Buffer = encoder.encode(this._string);
    }
    return this._utf8Buffer;
  }

  get unicodeScalars(): number[] {
    if (this._unicodeScalarValues === undefined) {
      this._unicodeScalarValues = toUnicodeScalarValues(this._string);
    }
    return this._unicodeScalarValues;
  }

  match(
    pattern: BoxedExpression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isBoxedExpression(pattern))
      pattern = this.engine.box(pattern, { form: 'raw' });

    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };

    if (!(pattern instanceof BoxedString)) return null;
    if (this._string === pattern._string) return {};
    return null;
  }
}

// USV (Unicode Scalar Value) is a 21-bit integer that maps to a
// Unicode character. They differ from code points in that they exclude
// surrogate pairs, which can be used to represent characters outside the
// Basic Multilingual Plane (BMP) in UTF-16 encoding. The USV is the actual
// value of the character, while the code point is the value used in UTF-16
// encoding.
//
//    Example: 𝌆a🏳️‍🌈
/* 
      | Character | Code point | UTF-16 units          |
      |----------:|:----------:|:----------------------|
      | 𝌆         | U+1D306    | `0xD834, 0xDF06`      |
      | a         | U+0061     | `0x0061`              |
      | 🏳        | U+1F3F3    | `0xD83C, 0xDFF3`      |
      | VS-16     | U+FE0F     | `0xFE0F`              |
      | ZWJ       | U+200D     | `0x200D`              |
      | 🌈        | U+1F308    | `0xD83C, 0xDF08`      |
 */

function toUnicodeScalarValues(str: string): number[] {
  const scalarValues: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const codePoint = str.codePointAt(i)!;
    scalarValues.push(codePoint);
    // If the character is represented by a surrogate pair
    // we need to manually adjust the loop counter to skip the second surrogate.
    if (codePoint > 0xffff) i++;
  }
  return scalarValues;
}
