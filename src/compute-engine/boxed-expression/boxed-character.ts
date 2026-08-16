import type {
  Expression,
  PatternMatchOptions,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Metadata,
  CharacterInterface,
} from '../global-types.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { hashCode, isExpression } from './utils.js';
import { isCharacter, isString } from './type-guards.js';
import { toUnicodeScalarValues, toWellFormedString } from './boxed-string.js';
import { isWildcard, wildcardName } from './pattern-utils.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { splitGraphemeClusters } from '../../common/grapheme-splitter.js';

/**
 * Is `s` exactly ONE user-perceived character?
 *
 * This is the SINGLE definition of "one character" in the engine: normalize to
 * NFC, then segment into UAX #29 extended grapheme clusters and require
 * exactly one. `CharacterFrom`'s validation, the literal narrowing performed
 * during argument checking, and `ce.character()` all consult it, so they can
 * never disagree about which literals are characters.
 *
 * Note that "one character" is one CLUSTER, not one code point: `"é"` (either
 * the precomposed U+00E9 or the decomposed `e` + U+0301, which NFC folds
 * together), a ZWJ emoji sequence and a regional-indicator flag all qualify,
 * while the empty string and `"ab"` do not. The answer therefore depends on
 * the host's Unicode version — an accepted, documented risk
 * (`docs/STRING_ROADMAP.md`, design constraint 11).
 */
export function isSingleGraphemeCluster(s: string): boolean {
  if (s.length === 0) return false;
  // Fast path for the overwhelmingly common case: a lone ASCII code unit is
  // always exactly one cluster and is unaffected by NFC normalization, so it
  // needs neither. The one ASCII exception is CR, which forms a single
  // CRLF cluster with a following LF — but a one-code-unit string has no
  // following LF, so `"\r"` alone is still one cluster; it is excluded only
  // to keep this shortcut obviously equivalent to the general path without
  // requiring the reader to make that argument.
  if (s.length === 1 && s.charCodeAt(0) < 0x80 && s !== '\r') return true;
  return splitGraphemeClusters(s.normalize()).length === 1;
}

/**
 * A character value: exactly one NFC-normalized grapheme cluster.
 *
 * A character is a SCALAR and a disjoint sibling of a string — it has no
 * elements, so recursive walkers terminate on it structurally. Its content is
 * exposed as `string` (the same property name `StringInterface` uses), so a
 * consumer that only wants the text can read either kind uniformly.
 *
 * MathJSON has no character literal, so a character serializes as the call
 * form `["CharacterFrom", "'x'"]`, which canonicalizes back to the identical
 * character — that is what makes `box(json(c))` equal `c`.
 *
 * See `docs/STRING_ROADMAP.md` ("The `character` value model").
 */
export class BoxedCharacter
  extends _BoxedExpression
  implements CharacterInterface
{
  override readonly _kind = 'character';

  [Symbol.toStringTag]: string = '[BoxedCharacter]';
  private readonly _string: string;
  private _unicodeScalarValues?: number[] | undefined;

  constructor(ce: ComputeEngine, expr: string, metadata?: Metadata) {
    super(ce, metadata);
    // Characters, like strings, are stored in Unicode NFC canonical order.
    // See https://unicode.org/reports/tr15/
    // They are also held WELL-FORMED, exactly as `BoxedString` holds its
    // content: a native JS string may carry an unpaired UTF-16 surrogate, for
    // which segmentation, UTF-8 encoding and serialization are undefined, so
    // each one is replaced with U+FFFD REPLACEMENT CHARACTER. Sharing the
    // repair with `BoxedString` is what keeps a character and a one-cluster
    // string built from the same source equal values.
    this._string = toWellFormedString(expr.normalize());
  }

  get json(): Expression['json'] {
    // MathJSON has only string literals, so the wire format for a character is
    // the call form its constructor operator produces. The operand is a
    // single-quoted MathJSON string literal, exactly as `BoxedString.json`
    // emits it.
    return ['CharacterFrom', `'${this._string}'`];
  }

  get hash(): number {
    // DELIBERATELY the same formula `BoxedString.hash` uses. `isSame` bridges
    // the two kinds — a character and a one-cluster string with the same
    // content are equal values — and a hash that disagreed with equality would
    // break every hash-keyed consumer (`Unique`, `Tally`, set membership,
    // the pattern matcher's anchor buckets).
    return hashCode('String' + this._string);
  }

  get operator(): string {
    return 'CharacterFrom';
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
    return BoxedType.character;
  }

  get complexity(): number {
    // Same as a string: a character is a literal of comparable weight.
    return 19;
  }

  get string(): string {
    return this._string;
  }

  get unicodeScalars(): number[] {
    if (this._unicodeScalarValues === undefined)
      this._unicodeScalarValues = toUnicodeScalarValues(this._string);
    return this._unicodeScalarValues;
  }

  match(
    pattern: Expression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isExpression(pattern))
      pattern = this.engine.expr(pattern, { form: 'raw' });

    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };

    // Mirrors `BoxedString.match`, extended across the kind boundary the same
    // way `isSame` is: a one-cluster string pattern has the same content as
    // this character, so it matches.
    if (!isCharacter(pattern) && !isString(pattern)) return null;
    if (this._string === pattern.string) return {};
    return null;
  }
}

/**
 * Narrow a one-cluster string LITERAL to the character it denotes, or
 * `undefined` when `expr` is not a string literal or does not hold exactly one
 * grapheme cluster.
 *
 * This is the conversion applied when a string literal appears in a position
 * that expects a `character` (argument validation). It is deliberately
 * confined to literals: a `string`-TYPED expression does not implicitly
 * convert, and must be written `CharacterFrom(s)`.
 */
export function narrowStringLiteralToCharacter(
  ce: ComputeEngine,
  expr: Expression
): Expression | undefined {
  if (!isString(expr)) return undefined;
  if (!isSingleGraphemeCluster(expr.string)) return undefined;
  return ce.character(expr.string);
}
