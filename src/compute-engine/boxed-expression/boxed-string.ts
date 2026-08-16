import type {
  Expression,
  PatternMatchOptions,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Metadata,
  StringInterface,
} from '../global-types.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { hashCode, isExpression } from './utils.js';
import { isCharacter, isString } from './type-guards.js';
import { isWildcard, wildcardName } from './pattern-utils.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { splitGraphemeClusters } from '../../common/grapheme-splitter.js';

/**
 * BoxedString
 *
 */

export class BoxedString extends _BoxedExpression implements StringInterface {
  override readonly _kind = 'string';

  [Symbol.toStringTag]: string = '[BoxedString]';
  private readonly _string: string;
  private _utf8Buffer?: Uint8Array | undefined;
  private _unicodeScalarValues?: number[] | undefined;
  /**
   * The string's grapheme clusters, computed on first use.
   *
   * A string is an indexed collection of its characters, so `count`, `each`,
   * `at` and `contains` all need this decomposition; segmenting once and
   * keeping the array makes a walk O(n) rather than O(n) per element. Follows
   * the same lazy pattern as `_utf8Buffer`. `undefined` means "not computed
   * yet", never "no clusters" (that would be `[]`).
   */
  private _graphemes?: string[] | undefined;
  /**
   * True when every code unit is US-ASCII (< U+0080) and none of them is a
   * CARRIAGE RETURN (U+000D). Such a string has one cluster per code unit, so
   * the collection facets can skip the segmenter entirely — the common case
   * for identifiers, keys and formatting strings. Set by the single
   * constructor scan.
   *
   * CR is excluded even though it is ASCII because a CR followed by a LF is
   * ONE grapheme cluster (UAX #29 rule GB3), the only place where two ASCII
   * code units join into a single cluster. Letting `"a\r\nb"` take the fast
   * path would make it four characters here and three everywhere the
   * segmenter is used (`Characters`, the compiled `_SYS.chars` lowering).
   */
  private readonly _isAscii: boolean;

  constructor(ce: ComputeEngine, expr: string, metadata?: Metadata) {
    super(ce, metadata);
    // Strings are always stored in Unicode NFC canonical order
    // See https://unicode.org/reports/tr15/
    const normalized = expr.normalize();

    // ONE scan does two jobs. (a) It records whether the content is pure
    // ASCII with no CR (see `_isAscii`: a CR LF pair is a single grapheme
    // cluster, so it must not take the one-cluster-per-code-unit fast path),
    // which the collection facets use as a fast path. (b) It enforces
    // well-formedness: a native JS string may hold an UNPAIRED UTF-16
    // surrogate, and segmentation, UTF-8 encoding, equality and serialization
    // are all undefined or replacement-dependent on such a value — a
    // `character` would have no defined domain there. Every unpaired surrogate
    // is therefore replaced with U+FFFD REPLACEMENT CHARACTER. Every string
    // ingress routes through this constructor, so this is the single
    // enforcement point (`docs/STRING_ROADMAP.md`, design constraint 12).
    let isAscii = true;
    let wellFormed = true;
    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i);
      if (code >= 0x80 || code === 0x0d) {
        isAscii = false;
        if (code >= 0xd800 && code <= 0xdbff) {
          // A high surrogate must be followed by a low surrogate.
          const next = normalized.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) i++;
          else wellFormed = false;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          // A low surrogate not consumed by the branch above is unpaired.
          wellFormed = false;
        }
      }
    }
    this._isAscii = isAscii;
    this._string = wellFormed ? normalized : toWellFormedString(normalized);
  }
  get json(): string {
    // A MathJSON string literal must always be wrapped in single quotes.
    // Emitting the bare string for symbol-like content (e.g. "world") would
    // re-box as a *symbol*, not a string, losing round-trip identity.
    return `'${this._string}'`;
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

  get value(): Expression {
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

  /**
   * The string's grapheme clusters (UAX #29) — its ELEMENTS as a collection.
   *
   * Segmented once and cached. An all-ASCII string has one cluster per code
   * unit, so it skips the segmenter.
   */
  private get graphemes(): string[] {
    if (this._graphemes === undefined) {
      this._graphemes = this._isAscii
        ? this._string.split('')
        : splitGraphemeClusters(this._string);
    }
    return this._graphemes;
  }

  //
  // Collection facets. A string is an INDEXED collection of its characters:
  // iterable, 1-based indexable and countable, with grapheme clusters as
  // elements (`docs/STRING_ROADMAP.md`). It is always finite. Note that it is
  // nonetheless ATOMIC under broadcast and `Flatten` — that exclusion lives at
  // those call sites (`isFiniteBroadcastParticipant` in `collection-utils.ts`),
  // not here, because the facets themselves are what `Length`, `At`, `for … in`
  // and `Contains` need.
  //

  override get isCollection(): boolean {
    return true;
  }

  override get isIndexedCollection(): boolean {
    return true;
  }

  override get isFiniteCollection(): boolean {
    return true;
  }

  override get count(): number {
    return this.graphemes.length;
  }

  /**
   * A string is a RANK-1 indexed collection of `count` characters, so it
   * reports the same shape a flat list of those characters reports:
   * `Shape("abc")` is `(3)` and `Rank("abc")` is 1. The inherited defaults
   * (`[]` and 0) describe a SCALAR, which a string no longer is; leaving them
   * in place made `Shape`/`Rank` — whose handlers just read these two getters
   * — contradict the lattice. This is not a claim that a string is a tensor:
   * `isTensorValue` requires a `List` head, so `Determinant`/`Inverse` and the
   * rest of the matrix operators stay inert on a string.
   */
  override get shape(): number[] {
    return [this.count];
  }

  override get rank(): number {
    return 1;
  }

  override *each(): Generator<Expression> {
    for (const c of this.graphemes) yield this.engine.character(c);
  }

  override at(index: number): Expression | undefined {
    const cs = this.graphemes;
    // 1-based, with a negative index counting from the end (`-1` is the last
    // character) — the same convention `At` uses on every other indexed
    // collection.
    if (index < 0) index = cs.length + index + 1;
    if (index < 1 || index > cs.length) return undefined;
    return this.engine.character(cs[index - 1]);
  }

  override contains(rhs: Expression): boolean | undefined {
    // Element membership, not substring search: the elements of a string are
    // its characters, so `c in s` asks whether one of them equals `c`.
    // Comparing the TEXT is what `isSame` would compare anyway — it bridges
    // the character/string kinds, so a one-cluster string operand answers the
    // same as the equivalent character — and reading it once avoids boxing a
    // character per cluster. Anything that is neither a character nor a string
    // cannot be an element of a string. A multi-cluster needle is not a
    // cluster of this string, so `includes` on the cluster array correctly
    // returns false (this is membership, not `StringContains`).
    const needle = isCharacter(rhs) || isString(rhs) ? rhs.string : undefined;
    if (needle === undefined) return false;
    return this.graphemes.includes(needle);
  }

  match(
    pattern: Expression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isExpression(pattern))
      pattern = this.engine.expr(pattern, { form: 'raw' });

    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };

    // A CHARACTER pattern matches a one-cluster string, mirroring the
    // character/string bridge `isSame` implements — the two are the same value
    // when their content agrees, so pattern matching must not disagree.
    if (!isString(pattern) && !isCharacter(pattern)) return null;
    if (this._string === pattern.string) return {};
    return null;
  }
}

/**
 * Return `s` with every unpaired UTF-16 surrogate replaced by U+FFFD
 * REPLACEMENT CHARACTER, leaving a string that is already well-formed
 * unchanged.
 *
 * This is the SINGLE well-formedness repair in the engine: both `BoxedString`
 * and `BoxedCharacter` route their content through it, so a string and a
 * character built from the same lone-surrogate source hold the same text (and
 * therefore compare equal, as `isSame` bridges the two kinds). See the
 * `BoxedString` constructor for why segmentation, UTF-8 encoding, equality and
 * serialization all require well-formed content.
 */
export function toWellFormedString(s: string): string {
  // `String.prototype.toWellFormed` (Node ≥ 20) does exactly this replacement;
  // the manual scan below covers older hosts.
  return (
    (s as unknown as { toWellFormed?: () => string }).toWellFormed?.() ??
    replaceLoneSurrogates(s)
  );
}

/**
 * Replace every unpaired UTF-16 surrogate with U+FFFD.
 *
 * The manual fallback for hosts without `String.prototype.toWellFormed`
 * (Node < 20); see `toWellFormedString`, its only caller.
 */
function replaceLoneSurrogates(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += s[i] + s[i + 1];
        i++;
      } else result += '�';
    } else if (code >= 0xdc00 && code <= 0xdfff) result += '�';
    else result += s[i];
  }
  return result;
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

export function toUnicodeScalarValues(str: string): number[] {
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
