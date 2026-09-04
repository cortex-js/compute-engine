import type {
  Expression,
  PatternMatchOptions,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Metadata,
  DictionaryInterface,
  EvaluateOptions,
} from '../global-types.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { cachedValue, type CachedValue } from './cache.js';
import { hashCode } from './utils.js';
import { isWildcard, wildcardName } from './pattern-utils.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { DictionaryValue, MathJsonExpression } from '../../math-json/types.js';
import { widen } from '../../common/type/utils.js';
import { internType } from '../../common/type/intern.js';
import { numberLiteralTierType } from './literal-tier.js';
import { widenValueTypes } from '../../common/type/widen-value.js';
import { boundTypeSize } from '../../common/type/size-cap.js';
import type { Type } from '../../common/type/types.js';
import { isFunction, isString, isSymbol, isNumber } from './type-guards.js';

/** Keys a `record{…}` type can carry unescaped: what the type lexer reads back
 * as an `IDENTIFIER` (`lexer.ts`), minus the words it lexes as keywords.
 *
 * The list must track the keyword table in `lexer.ts` exactly. It is the
 * CAPITALIZED `NaN` and `Infinity` that are keywords, together with `oo`; the
 * lowercase `nan` and `infinity` name the two numeric primitive types and lex
 * as ordinary identifiers, so they are legal keys like `real` and `number`. A
 * key wrongly listed here only costs precision (the type falls back to
 * `dictionary<T>`, a supertype), but a keyword wrongly MISSING produces a
 * record type that cannot be read back. */
const TYPE_KEYWORD_KEYS = new Set(['true', 'false', 'NaN', 'Infinity', 'oo']);
function isRecordKey(key: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) && !TYPE_KEYWORD_KEYS.has(key);
}

/** The type a dictionary CELL contributes to the synthesized (stored)
 * record/dictionary type. A number literal contributes its tier, read off
 * its value (`numberLiteralTierType`) — its value type, singleton range,
 * enclosure range or sign range is literal cargo, and is never built here;
 * any other cell keeps its stored type through `widenValueTypes`, which
 * preserves a handler's deliberate range claim. */
function storedCellType(op: Expression): Type {
  return isNumber(op)
    ? numberLiteralTierType(op)
    : widenValueTypes(op.type.type);
}

/**
 * BoxedDictionary
 *
 */

export class BoxedDictionary
  extends _BoxedExpression
  implements DictionaryInterface
{
  override readonly _kind = 'dictionary';

  [Symbol.toStringTag]: string = '[BoxedDictionary]';
  /** Keyed by dictionary KEY, which is an arbitrary string — including one
   * that collides with an `Object.prototype` member. Prototype-free, or three
   * things go wrong at once: a `__proto__` entry cannot be stored at all (the
   * assignment invokes the inherited setter, so the entry vanishes while
   * `get`/`has` still answer from the prototype), and reading a MISSING
   * `toString`/`valueOf` key hands the caller the inherited JS FUNCTION as if
   * it were the stored value. Every read below must therefore avoid
   * prototype-derived methods too — see `has` and `match`. */
  private readonly _keyValues: Record<string, Expression> = Object.create(null);
  /** Memo for {@link type}, keyed on the composite cache generation
   * (`ce._cacheGeneration()`). A cell's type can be narrowed by an
   * assumption about a symbol it mentions — `{a: q}` with `q` assumed
   * greater than 3 types `record{a: real<3<..>}` — and that is a FACT about
   * the current state, not a property of the literal, so the entry must
   * expire when `assume()` or `forget()` moves the engine generation. It was
   * unversioned before, which left the narrowed answer standing after the
   * assumption was retracted. */
  private _type: CachedValue<BoxedType> = { value: null, generation: -1 };
  /** Set when the input was not a well-formed dictionary. Boxing checks this
   * and returns the error INSTEAD of the half-built dictionary, so a caller
   * boxing untrusted input never has to catch a JS exception — the contract
   * `box.ts` states for every other malformed MathJSON shape. The sibling
   * `DictionaryFrom`/`RecordFrom` evaluate handlers report the same way. */
  private _constructionError: Expression | undefined;

  /** The diagnostic for malformed input, or `undefined` when the dictionary
   * is well-formed. Read by `box.ts` at both construction sites. */
  get constructionError(): Expression | undefined {
    return this._constructionError;
  }

  /** Record the first malformed-input diagnostic. Later problems are not
   * overwritten: the first one is the one the author needs to see. */
  private _reportError(expected: string, actual: Expression | string): void {
    // The operands reaching here are RAW (`box.ts` boxes a `Dictionary`'s
    // operands with `RAW_OPERAND`), so an unbound symbol or a compound
    // expression has no resolved type and `actual.type` reads `unknown` —
    // useless in a message whose whole job is to say what was wrong. Describe
    // the KIND the author can see in their own source instead, and fall back
    // to the type only when it is informative.
    const describe = (x: Expression): string => {
      if (isSymbol(x)) return `symbol \`${x.symbol}\``;
      if (isFunction(x)) return `\`${x.operator}\` expression`;
      const t = x.type.toString();
      return t === 'unknown' ? x.toString() : t;
    };
    const [actualType, subject] =
      typeof actual === 'string'
        ? [`"${actual}"`, actual]
        : [describe(actual), actual.toString()];
    // The FIRST problem is the one reported. Every call site returns
    // immediately after reporting, so today this guard never fires; it is kept
    // so that adding a call site that keeps walking cannot silently replace
    // the author's first error with a later, less relevant one.
    this._constructionError ??= this.engine.error(
      ['incompatible-type', expected, actualType],
      subject
    );
  }

  /** The input to the constructor is either a ["Dictionary", ["KeyValuePair", ..., ...], ...] expression or a record of key-value pairs */
  constructor(
    ce: ComputeEngine,
    keyValues: Record<string, DictionaryValue> | Expression,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
    }
  ) {
    super(ce, options?.metadata);

    if (keyValues instanceof _BoxedExpression) {
      this._initFromExpression(keyValues);
    } else {
      this._initFromRecord(
        keyValues as Record<string, DictionaryValue>,
        options
      );
    }
  }

  private _initFromRecord(
    keyValues: Record<string, DictionaryValue>,
    options?: { canonical?: boolean }
  ) {
    // `Object.keys`, not `for...in`: the latter also walks INHERITED
    // enumerable properties, which is the very class of leak this map is
    // hardened against.
    for (const key of Object.keys(keyValues)) {
      if (typeof key !== 'string') {
        this._reportError('string', String(key));
        return;
      }
      if (key.length === 0) {
        this._reportError('a non-empty string key', '');
        return;
      }
      // A `Nothing` VALUE erases the whole entry (§3.G).
      const v = dictionaryValueToBoxedExpression(
        this.engine,
        keyValues[key],
        options
      );
      // A malformed value — a nested `{dict: …}` that could not be built, or
      // a list containing one — makes the WHOLE dictionary malformed. Without
      // this the nested error was dropped and the entry became a silently
      // empty dictionary inside an outer one reporting itself as valid.
      if (!v.isValid) {
        this._constructionError ??= v;
        return;
      }
      if (!isSymbol(v, 'Nothing')) this._keyValues[key] = v;
    }
  }

  private _initFromExpression(dictionary: Expression) {
    // Return early if already a BoxedDictionary
    if (dictionary instanceof BoxedDictionary) {
      // A malformed source stays malformed through a copy: not reachable from
      // today's four construction sites (none passes a `BoxedDictionary`), but
      // a copy that silently dropped the diagnostic would be a trap for the
      // next one.
      if (dictionary._constructionError !== undefined) {
        this._constructionError = dictionary._constructionError;
        return;
      }
      Object.assign(this._keyValues, dictionary._keyValues);
      return;
    }

    // Parse a tuple as a dictionary expression with a single key-value pair
    if (
      dictionary.operator === 'Tuple' ||
      dictionary.operator === 'Pair' ||
      dictionary.operator === 'KeyValuePair'
    ) {
      if (!isFunction(dictionary)) return;
      if (dictionary.nops !== 2) {
        this._reportError('tuple<string, unknown>', dictionary);
        return;
      }
      const [key, value] = dictionary.ops;
      // A `Nothing` KEY is an error (§3.G).
      if (isSymbol(key, 'Nothing')) {
        this._reportError('string', key);
        return;
      }
      let k: string;
      if (isString(key)) k = key.string;
      else if (isSymbol(key)) k = key.symbol;
      else {
        this._reportError('string', key);
        return;
      }
      if (k.length === 0) {
        this._reportError('a non-empty string key', '');
        return;
      }

      // A `Nothing` VALUE erases the whole entry (§3.G).
      const v = value.canonical;
      if (!isSymbol(v, 'Nothing')) this._keyValues[k] = v;
      return;
    }

    // Parse as a dictionary expression
    if (dictionary.operator === 'Dictionary') {
      if (!isFunction(dictionary)) return;
      for (const pair of dictionary.ops) {
        if (
          pair.operator === 'KeyValuePair' ||
          pair.operator === 'Pair' ||
          pair.operator === 'Tuple'
        ) {
          if (!isFunction(pair)) continue;
          // Every pair must be exactly a key and a value. A longer tuple used
          // to fall through with its tail ignored, and then hit the
          // non-string-key path below, which RETURNED — silently yielding an
          // EMPTY dictionary for input the author expected to be stored.
          if (pair.nops !== 2) {
            this._reportError('tuple<string, unknown>', pair);
            return;
          }
          const [key, value] = pair.ops;
          // A `Nothing` KEY is an error (§3.G).
          if (isSymbol(key, 'Nothing')) {
            this._reportError('string', key);
            return;
          }
          let k: string;
          if (isString(key)) k = key.string;
          else if (isSymbol(key)) k = key.symbol;
          else {
            this._reportError('string', key);
            return;
          }
          // Rejected on BOTH construction routes. The plain-data `{dict: …}`
          // route has always refused an empty key; this one accepted it, and
          // the disagreement was not cosmetic — a dictionary built here with
          // an empty key serialized to `{dict: {"": …}}` and then failed to
          // box back, so a valid expression did not survive its own round
          // trip.
          if (k.length === 0) {
            this._reportError('a non-empty string key', '');
            return;
          }

          // A `Nothing` VALUE erases the whole entry (§3.G).
          const v = value.canonical;
          if (!isSymbol(v, 'Nothing')) this._keyValues[k] = v;
        } else {
          this._reportError('tuple<string, unknown>', pair);
          return;
        }
      }
      return;
    }

    // Default to empty dictionary for unrecognized expressions
  }

  get json(): MathJsonExpression {
    // The `{dict: …}` shorthand is a VALUE serialization: re-boxing it
    // constructs the dictionary eagerly, in whatever scope is ambient — and a
    // `BoxedDictionary` is always-canonical, so nothing downstream ever
    // re-binds its entries. That is exactly right for plain data, and exactly
    // wrong for an entry that is an unevaluated EXPRESSION: `{v -> x}` inside
    // a function body, round-tripped through `.json` (e.g. the recursion
    // knot-tying re-box in `assignFn`), would re-box with `x` bound outside
    // the body scope, and the parameter reference would dangle at every later
    // application. So the shorthand is reserved for all-plain-data entries;
    // anything else serializes in the `["Dictionary", ["KeyValuePair", …]]`
    // OPERATOR form, which re-boxes lazily and canonicalizes — binding its
    // entries — inside whatever scope the expression lands in.
    const entries = Object.entries(this._keyValues).map(
      ([k, v]) => [k, boxedExpressionToDictionaryValue(v)] as const
    );
    if (entries.every(([, v]) => isPlainDataValue(v)))
      return { dict: Object.fromEntries(entries) };
    return [
      'Dictionary',
      ...Object.entries(this._keyValues).map(
        ([k, v]) => ['KeyValuePair', { str: k }, v.json] as MathJsonExpression
      ),
    ] as MathJsonExpression;
  }

  // Note: `toMathJson()` is inherited from `_BoxedExpression`, which resolves
  // default options and serializes dictionary entries via `serializeJson()`.

  get hash(): number {
    return hashCode('Dictionary' + JSON.stringify(this._keyValues));
  }

  get operator(): string {
    return 'Dictionary';
  }

  get type(): BoxedType {
    return cachedValue(
      this._type,
      this.engine._cacheGeneration(),
      () => this._computeType(),
      undefined,
      this.engine
    );
  }

  private _computeType(): BoxedType {
    const keys = Object.keys(this._keyValues);
    // A dictionary literal always knows its keys, so synthesize the narrower
    // `record{k: T, …}` — the shape a `record`-bodied type can accept. It is a
    // subtype of the `dictionary<T>` this used to report, so any consumer
    // expecting `dictionary<T>` still matches. Fall back to `dictionary<T>`
    // when a key is not a bare identifier: `typeToString` does not backtick-
    // escape record keys, so such a record type would not round-trip.
    if (keys.length > 0 && keys.every(isRecordKey)) {
      // Prototype-free for the same reason as `_keyValues`: `isRecordKey`
      // admits `__proto__` and `toString` (both match its identifier
      // pattern), and an ordinary object would drop the first and inherit a
      // bogus type for the second.
      const elements: Record<string, Type> = Object.create(null);
      // The synthesized record is a STORED type (memoized on `_type`), so a
      // literal cell projects to its tier — `{x: 1}` types
      // `record{x: integer}`, not `record{x: 1}`, and `{x: √2}` types
      // `record{x: real}`, not the enclosure range.
      // (`widenValueTypes` treats a `record` NODE as a leaf, so the widening
      // must happen here, where the fields are assembled from the cells; a
      // non-literal cell keeps its stored type, handler range claims
      // included.)
      for (const key of keys)
        elements[key] = storedCellType(this._keyValues[key]);
      // A stored type is bounded in size, as a function node's is
      // (`boundTypeSize`): a dictionary whose fields hold one shared
      // dictionary value has a type with one field per PATH, and it is
      // stored here, outside the function-node chokepoint.
      // Interned (`internType`) so equal record types built from different
      // dictionaries are one object and join by identity downstream.
      return new BoxedType(
        internType(boundTypeSize({ kind: 'record', elements }))
      );
    }
    const eltType = widen(
      // Same storage rule as the record arm: `widen` is a JOIN and a join of
      // one literal type is that literal type, so project the cells first.
      ...Object.values(this._keyValues).map(storedCellType)
    );
    return new BoxedType(
      internType(boundTypeSize({ kind: 'dictionary', values: eltType }))
    );
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

  get value(): Expression | undefined {
    return undefined;
  }

  get complexity(): number {
    return 1000;
  }

  get isCollection(): boolean {
    return true;
  }

  get isIndexedCollection(): boolean {
    return false;
  }

  get isLazyCollection(): boolean {
    return false;
  }

  contains(_rhs: Expression): boolean | undefined {
    return undefined;
  }

  get count(): number | undefined {
    return Object.keys(this._keyValues).length;
  }

  get isEmptyCollection(): boolean {
    return Object.keys(this._keyValues).length === 0;
  }

  get isFiniteCollection(): boolean {
    return true;
  }

  each(): Generator<Expression> {
    // Return a tuple for each key-value pair
    const ce = this.engine;
    return (function* (self: BoxedDictionary) {
      for (const [key, value] of Object.entries(self._keyValues)) {
        // POSITIONAL pair: `_fn`, not `tuple()`. A dictionary value may
        // legitimately be `Nothing` (the dictionary keeps it, and `Values`
        // reports it), and `tuple()` splices `Nothing` out — which would
        // yield a 1-tuple and silently unpair the entry.
        yield ce._fn('Tuple', [ce.string(key), value]);
      }
    })(this);
  }

  get(key: string): Expression | undefined {
    return this._keyValues[key];
  }

  has(key: string): boolean {
    // `Object.hasOwn`, not `this._keyValues.hasOwnProperty(…)`: the backing
    // map has no prototype, so it carries no such method.
    return Object.hasOwn(this._keyValues, key);
  }

  get keys(): string[] {
    return Object.keys(this._keyValues);
  }

  get entries(): [string, Expression][] {
    return Object.entries(this._keyValues);
  }

  get values(): Expression[] {
    return Object.values(this._keyValues);
  }

  override evaluate(options?: Partial<EvaluateOptions>): Expression {
    // A dictionary literal evaluates its values (keys are strings and need no
    // evaluation). Fast path: a dictionary whose values are all already
    // fully-evaluated literals is returned unchanged.
    const numericApproximation = options?.numericApproximation ?? false;
    const entries = Object.entries(this._keyValues);
    if (entries.every(([, v]) => isEvaluatedValue(v, numericApproximation)))
      return this;
    const ce = this.engine;
    const pairs = entries.map(([k, v]) =>
      ce._fn('KeyValuePair', [ce.string(k), v.evaluate(options)])
    );
    return new BoxedDictionary(ce, ce._fn('Dictionary', pairs));
  }

  match(
    pattern: Expression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };

    if (!(pattern instanceof BoxedDictionary)) return null;

    // Match by values of the keys
    let result: BoxedSubstitution | null = null;
    const keys = Object.keys(pattern._keyValues);
    for (const key of keys) {
      if (!Object.hasOwn(this._keyValues, key)) return null;
      const value = this._keyValues[key];
      const patternValue = pattern._keyValues[key];
      if (!value.match(patternValue)) return null;
      if (isWildcard(pattern._keyValues[key])) {
        const wcKey = wildcardName(pattern._keyValues[key]);
        if (wcKey) result = { ...(result ?? {}), [wcKey]: value };
      }
    }
    return result;
  }
}

/** Is this serialized dictionary value PLAIN DATA — scope-independent under
 * re-boxing? Strings, numbers and booleans are; so are lists and nested
 * dictionaries of plain data, and `{num}`/`{str}` nodes. A `{sym}` or `{fn}`
 * node is an EXPRESSION: re-boxing it binds/canonicalizes in the ambient
 * scope, so a dictionary holding one must not serialize to the `{dict: …}`
 * shorthand (see `get json()`). */
function isPlainDataValue(v: DictionaryValue): boolean {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return true;
  if (Array.isArray(v)) return v.every(isPlainDataValue);
  if (v !== null && typeof v === 'object') {
    if ('num' in v || 'str' in v) return true;
    if ('dict' in v)
      return Object.values(
        (v as { dict: Record<string, DictionaryValue> }).dict
      ).every(isPlainDataValue);
  }
  return false;
}

function boxedExpressionToDictionaryValue(value: Expression): DictionaryValue {
  if (isString(value)) return value.string;
  if (isSymbol(value)) {
    if (value.symbol === 'True') return true;
    if (value.symbol === 'False') return false;
    return { sym: value.symbol };
  }

  if (isNumber(value) && value.type.matches('real')) return value.re;

  if (isFunction(value, 'List'))
    return value.ops.map(boxedExpressionToDictionaryValue);

  return value.toMathJson({ shorthands: [] });
}

/** Is `v` an already fully-evaluated dictionary value for the requested
 * evaluation mode? (Mirrors the `List` fast-path predicate.) */
function isEvaluatedValue(
  v: Expression,
  numericApproximation: boolean
): boolean {
  if (isString(v)) return true;
  if (isNumber(v)) return !numericApproximation || !v.isExact;
  return false;
}

function dictionaryValueToBoxedExpression(
  ce: ComputeEngine,
  value: DictionaryValue | null | undefined,
  options?: { canonical?: boolean }
): Expression {
  if (value === null || value === undefined) return ce.Nothing;
  if (value instanceof _BoxedExpression) return value;
  if (typeof value === 'string') return ce.string(value);
  if (typeof value === 'number') return ce.number(value, options);
  if (typeof value === 'boolean') return value ? ce.True : ce.False;

  const form = options?.canonical === false ? 'raw' : 'canonical';

  if (Array.isArray(value)) {
    return ce.function(
      'List',
      value.map((x) => dictionaryValueToBoxedExpression(ce, x, options))
    );
  }
  if (typeof value === 'object') {
    if ('num' in value) return ce.number(value.num, options);
    if ('str' in value) return ce.string(value.str);
    if ('sym' in value) return ce.symbol(value.sym, options);
    if ('fn' in value) return ce.expr(value, { form });
    if ('dict' in value) {
      // Hand back the diagnostic rather than a half-built dictionary, so a
      // malformed nested `{dict: …}` reaches the caller as an error value.
      const d = new BoxedDictionary(ce, value.dict, options);
      return d.constructionError ?? d;
    }
  }
  return ce.Nothing;
}
