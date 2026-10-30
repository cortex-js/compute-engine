import { cacheOff } from '../../common/cache-switches.js';
import { beginStoreGuard } from './store-guard.js';
import type {
  AngularUnit,
  Expression,
  PatternMatchOptions,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Metadata,
  DictionaryInterface,
  EvaluateOptions,
  Substitution,
  CanonicalOptions,
} from '../global-types.js';

import {
  _BoxedExpression,
  hasSymbolOrOperator,
} from './abstract-boxed-expression.js';
import { cachedValue, type CachedValue } from './cache.js';
import {
  digest128,
  hashCode,
  hasVolatileDigest,
  markVolatileDigest,
} from './utils.js';
import { isWildcard, wildcardName } from './pattern-utils.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { DictionaryValue, MathJsonExpression } from '../../math-json/types.js';
import { widen } from '../../common/type/utils.js';
import { internType } from '../../common/type/intern.js';
import { numberLiteralTierType } from './literal-tier.js';
import { widenValueTypes } from '../../common/type/widen-value.js';
import { boundTypeSize } from '../../common/type/size-cap.js';
import type { EffectLabel, Type } from '../../common/type/types.js';
import { isFunction, isString, isSymbol, isNumber } from './type-guards.js';
import { effectsOf, publicEffects } from './effects-of.js';
import { isPureComputedEffects } from '../../common/type/effects.js';
import { beginTopLevelEvaluation } from './evaluation-epoch.js';

/** Keys a `record{…}` type can carry unescaped: what the type lexer reads back
 * as an `IDENTIFIER` (`lexer.ts`), minus the words it lexes as keywords.
 *
 * The list must track the keyword table in `lexer.ts` exactly. It is the
 * CAPITALIZED `NaN`, `Indeterminate` and `Infinity` that are keywords,
 * together with `oo`; the lowercase `nan` and `infinity` name the two numeric
 * primitive types and lex
 * as ordinary identifiers, so they are legal keys like `real` and `number`. A
 * key wrongly listed here only costs precision (the type falls back to
 * `dictionary<T>`, a supertype), but a keyword wrongly MISSING produces a
 * record type that cannot be read back. */
const TYPE_KEYWORD_KEYS = new Set([
  'true',
  'false',
  'NaN',
  'Indeterminate',
  'Infinity',
  'oo',
]);
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
   * `get`/`hasKey` still answer from the prototype), and reading a MISSING
   * `toString`/`valueOf` key hands the caller the inherited JS FUNCTION as if
   * it were the stored value. Every read below must therefore avoid
   * prototype-derived methods too — see `hasKey` and `match`. */
  private readonly _keyValues: Record<string, Expression> = Object.create(null);
  private _digest: string | undefined;
  private _isValid: boolean | undefined;
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
      // A nested dictionary that was BUILT is not malformed even when it is
      // invalid because a value of it is an error (`isValid` below): it is
      // kept under its key, with its siblings. A nested dictionary that could
      // not be built arrives here as its construction error, not as a
      // dictionary, and is still rejected.
      if (!v.isValid && !(v instanceof BoxedDictionary)) {
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
    // Two dictionaries that are `isSame` must have the same hash, because
    // hash consumers (like-term lookup in `Terms`, pattern matching) put
    // expressions in buckets by hash and then compare with `isSame` only
    // inside a bucket. `isSame` ignores the order of the entries and compares
    // the values with `isSame`, so the keys are sorted here and each value
    // contributes its own hash (not its serialization: `1/2` and `0.5` are
    // `isSame` but serialize differently).
    // The running hash is rotated (not shifted) before an entry is mixed in,
    // and multiplied by an odd constant: a plain shift moves the contribution
    // of an entry out of the 32-bit word after 32 levels of nested
    // dictionaries, so deeply nested dictionaries that differ got the same
    // hash. This is the fold of `mixOperandHash` (`boxed-function.ts`).
    let h = hashCode('Dictionary');
    for (const key of this.keys.sort())
      h =
        Math.imul(
          ((h << 5) | (h >>> 27)) ^ hashCode(key) ^ this._keyValues[key].hash,
          0x9e3779b1
        ) | 0;
    return h;
  }

  get digest(): string {
    // Memoized: a dictionary's entries are fixed at construction, and a
    // value shared by several dictionaries is digested once. Keys are
    // sorted, so entry order never enters the digest (the two `isSame`
    // dictionaries `{a, b}` and `{b, a}` digest alike), and each key is
    // LENGTH-PREFIXED: a key may contain any character, the separators
    // included, and without the prefix a one-entry dictionary whose key
    // spells another dictionary's entries would digest as that dictionary.
    if (this._digest !== undefined) return this._digest;
    const entries = this.keys
      .sort()
      .map((key) => `${key.length}:${key}\u001e${this._keyValues[key].digest}`);
    const d = digest128(`D\u001f${entries.join('\u001f')}`);
    // Not memoized when a value holds a mutable object below it (see
    // `markVolatileDigest`).
    if (this.keys.some((key) => hasVolatileDigest(this._keyValues[key])))
      markVolatileDigest(this);
    else this._digest = d;
    return d;
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
      // The record is closed: the value has exactly these keys, so its type
      // is also a `dictionary<T>` of the join of its field types.
      return new BoxedType(
        internType(boundTypeSize({ kind: 'record', elements, closed: true }))
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

  /** Evaluating a dictionary evaluates each of its values, so the dictionary
   * is pure only when all of its values are: `{"value" -> Random()}` draws.
   * Both getters read the runtime effect channel (`effectsOf()`), which
   * unions the effects of the values. */
  get isPure(): boolean {
    return isPureComputedEffects(effectsOf(this));
  }

  get effects(): ReadonlyArray<EffectLabel> | 'any' | undefined {
    return publicEffects(effectsOf(this));
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
        // Build the positional entry directly; Nothing remains its value slot.
        yield ce._fn('Tuple', [ce.string(key), value]);
      }
    })(this);
  }

  get(key: string): Expression | undefined {
    return this._keyValues[key];
  }

  /** True if `v` is `Dictionary` (the operator of this expression), or if a
   * VALUE of the dictionary includes the symbol `v` or a node with the
   * operator `v`. This is the same test as on every other expression, so a
   * walk that asks "does this expression mention `x`?" gets the correct
   * answer when it reaches a dictionary.
   *
   * The keys are strings, not symbols, so a key never matches: for
   * `{"a" -> u}`, `has("u")` is `true` and `has("a")` is `false`. To test
   * whether the dictionary has a key, use `hasKey()`.
   *
   * The walk is the one of a function expression (`hasSymbolOrOperator()`),
   * with one visited set, so a dictionary held under several keys is walked
   * once. */
  override has(v: string | string[]): boolean {
    return hasSymbolOrOperator(this, v);
  }

  /** A dictionary is valid when none of its values is invalid, as a list and
   * a tuple are: a dictionary that holds an `Error` value reports
   * `isValid === false`, and the error stays the value of its key.
   * The entries are fixed at construction, so the answer is computed once:
   * `isValid` is read often (at each canonical and evaluation step), and
   * without the memo a nested dictionary walked all its values at each
   * read, which made some suites run for hours. (CE-99.1) */
  override get isValid(): boolean {
    if (this._isValid !== undefined) return this._isValid;
    this._isValid = true;
    for (const key of Object.keys(this._keyValues))
      if (!this._keyValues[key].isValid) {
        this._isValid = false;
        break;
      }
    return this._isValid;
  }

  /** True if the dictionary has an entry with the key `key`. */
  hasKey(key: string): boolean {
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

  /** Substitute in every value. A dictionary whose values do not change is
   * returned as it is; otherwise a new dictionary is built with the same
   * keys, in the same order. Without this, the base `subs()` returned the
   * receiver, and `{"a" -> n + 1}.subs({n: 3})` was `{"a" -> n + 1}` while
   * `[n + 1].subs({n: 3})` is `[4]`. A dictionary is always canonical, so
   * the values are substituted in their own form (canonical). */
  override subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    const entries = Object.entries(this._keyValues);
    const values = entries.map(([, v]) => v.subs(sub, options));
    if (values.every((v, i) => v === entries[i][1])) return this;
    const ce = this.engine;
    const pairs = entries.map(([k], i) =>
      ce._fn('KeyValuePair', [ce.string(k), values[i]])
    );
    return new BoxedDictionary(ce, ce._fn('Dictionary', pairs));
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
    // The values are evaluated one level deeper, as the operands of a
    // function expression are (`BoxedFunction.evaluate`): a value is nested
    // in the evaluation of the dictionary, not a top-level evaluation of its
    // own. So a `Block` that is a value is not a program
    // (`runsAsProgram()`, `library/control-structures.ts`), as a `Block` in
    // a `List` or a `Tuple` is not. An evaluation of the dictionary that is
    // not nested in another one is a new top-level evaluation
    // (`beginTopLevelEvaluation`, `evaluation-epoch.ts`), with the same test
    // as `BoxedFunction.evaluate`. The inherited `evaluateAsync()` runs this
    // method, so the asynchronous route counts the same way.
    if (ce._evaluationEffects === undefined && ce._evaluationDepth === 0)
      beginTopLevelEvaluation(ce);
    // A dictionary can hold the same dictionary under several keys, level
    // after level (`{p: d, q: d}`), so the number of paths is exponential
    // in the depth while the number of nodes is linear. Within the
    // evaluation of the outermost dictionary, the value of each pure
    // dictionary node is computed once (`dictionaryEvaluationMemo`). CE-372.
    const version = ce._anyVersion;
    // A transient precision or angular-unit window (the engine methods
    // `_withTransientPrecision()` and `_withTransientAngularUnit()`, which run
    // `withTransientPrecision()` and `withTransientAngularUnit()` of
    // `engine-numeric-configuration.ts`) moves no engine version, and a value
    // computed in the window has the digits, or the unit, of the window;
    // `N(x, p)` can set the requested precision with no window either
    // (`_requestedPrecision`). So an entry also records the three settings it
    // was computed at, and is used only at the same ones. A node keeps one
    // entry per context: the entry of one context does not replace the entry
    // of another, so a node read inside and outside a window at each level
    // (`{a: d, b: W(d), c: d}`, where `W` opens a window) is still computed
    // once per context, not once per path.
    const pure = this.isPure;
    const context: DictionaryMemoContext | undefined = pure
      ? {
          options,
          version,
          precision: ce.precision,
          requestedPrecision: ce._requestedPrecision,
          angularUnit: ce.angularUnit,
        }
      : undefined;
    if (context !== undefined && !cacheOff('dictionary')) {
      const hit = dictionaryEvaluationMemo
        ?.get(this)
        ?.find((entry) => sameDictionaryMemoContext(entry, context));
      if (hit !== undefined) return hit.value;
    }
    const outermost = dictionaryEvaluationMemo === undefined;
    if (outermost) dictionaryEvaluationMemo = new WeakMap();
    const memo = dictionaryEvaluationMemo!;
    const guard = pure ? beginStoreGuard() : undefined;
    ce._evaluationDepth += 1;
    try {
      const pairs = entries.map(([k, v]) =>
        ce._fn('KeyValuePair', [ce.string(k), v.evaluate(options)])
      );
      const value = new BoxedDictionary(ce, ce._fn('Dictionary', pairs));
      // Not stored when the evaluation changed the state of the engine (an
      // assignment in a value): a later read can then give another value.
      // Nor when it ran host code that does not state its purity (a value
      // `h(2)` with a host operator `h`), or used a provisional answer
      // (`store-guard.ts`): each path to the node then evaluates it.
      if (
        context !== undefined &&
        ce._anyVersion === version &&
        guard!.allowsStore()
      ) {
        // The entries of other contexts stay; an entry of an earlier version
        // can no longer be used and is dropped.
        const kept = (memo.get(this) ?? []).filter(
          (entry) =>
            entry.version === version &&
            !sameDictionaryMemoContext(entry, context)
        );
        kept.push({ ...context, value });
        memo.set(this, kept);
      }
      return value;
    } finally {
      ce._evaluationDepth -= 1;
      if (outermost) dictionaryEvaluationMemo = undefined;
    }
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

  // A real number is stored as a JavaScript number only when it reads back
  // as the same number: an exact value that IS an integer (its type is
  // `integer`, not only its rounded machine value) and is a safe integer, or
  // an inexact number that a machine number holds without loss. An exact
  // rational is never stored as a JavaScript number: `1/2` would read back as
  // the float 0.5, and `(10^20 + 1)/10^20` as the integer 1. It keeps its
  // MathJSON form.
  if (isNumber(value) && value.type.matches('real')) {
    const re = value.re;
    if (
      value.isExact
        ? value.type.matches('integer') && Number.isSafeInteger(re)
        : value.engine.number(re).isSame(value)
    )
      return re;
  }

  if (isFunction(value, 'List'))
    return value.ops.map(boxedExpressionToDictionaryValue);

  // A function expression is wrapped as a `{fn: …}` object: a bare array is
  // a LIST in a dictionary value, so `["Sqrt", 2]` would read back as the
  // list of the string "Sqrt" and the number 2.
  const json = value.toMathJson({ shorthands: [] });
  return Array.isArray(json)
    ? { fn: json as [string, ...MathJsonExpression[]] }
    : json;
}

/**
 * The values of the dictionaries evaluated during the evaluation of the
 * outermost dictionary that is being evaluated, keyed by the dictionary
 * node; `undefined` when no dictionary is being evaluated. A node holds one
 * entry for each context in which it was evaluated
 * ({@link DictionaryMemoContext}): the same evaluation options, the same
 * working precision, requested precision and angular unit (a transient window
 * and `N(x, p)` change them with no engine event), and the engine's
 * `_anyVersion` at the time, so a state change (an assignment, a declaration)
 * makes an entry unused. Only a pure dictionary is stored: one with a
 * `Random()` value draws again at each evaluation.
 */
let dictionaryEvaluationMemo:
  | WeakMap<Expression, (DictionaryMemoContext & { value: Expression })[]>
  | undefined;

/** The state that the value of a pure dictionary depends on, besides the
 * values of the symbols it reads (which the `any` version covers). */
type DictionaryMemoContext = {
  options: Partial<EvaluateOptions> | undefined;
  version: number;
  precision: number;
  requestedPrecision: number | undefined;
  angularUnit: AngularUnit;
};

function sameDictionaryMemoContext(
  a: DictionaryMemoContext,
  b: DictionaryMemoContext
): boolean {
  return (
    a.version === b.version &&
    a.precision === b.precision &&
    a.requestedPrecision === b.requestedPrecision &&
    a.angularUnit === b.angularUnit &&
    sameEvaluateOptions(a.options, b.options)
  );
}

/**
 * Whether two evaluation options give a dictionary the same value. The
 * options are compared field by field, not by identity: many callers make a
 * new options object at each call (`x.N()` is `x.evaluate({
 * numericApproximation: true })`), so an identity test would miss at every
 * visit of a shared node through `N` and add one more entry to the node.
 * An absent field and `undefined` are the same. The signal, the effect
 * handlers and each frame of the context stack are compared by identity: two
 * stacks with the same frames read the same values.
 */
function sameEvaluateOptions(
  a: Partial<EvaluateOptions> | undefined,
  b: Partial<EvaluateOptions> | undefined
): boolean {
  if (a === b) return true;
  const x = a ?? {};
  const y = b ?? {};
  return (
    (x.numericApproximation ?? false) === (y.numericApproximation ?? false) &&
    sameMaterialization(x.materialization, y.materialization) &&
    x.signal === y.signal &&
    x._effects === y._effects &&
    sameFrames(x._contextStack, y._contextStack) &&
    x._precisionWindow?.working === y._precisionWindow?.working &&
    x._precisionWindow?.requested === y._precisionWindow?.requested
  );
}

function sameMaterialization(
  a: EvaluateOptions['materialization'] | undefined,
  b: EvaluateOptions['materialization'] | undefined
): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a[0] === b[0] && a[1] === b[1];
  return (a ?? false) === (b ?? false);
}

function sameFrames(
  a: ReadonlyArray<object> | undefined,
  b: ReadonlyArray<object> | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((frame, i) => frame === b[i]);
}

/** Is `v` an already fully-evaluated dictionary value for the requested
 * evaluation mode? (Mirrors the `List` fast-path predicate.) */
function isEvaluatedValue(
  v: Expression,
  numericApproximation: boolean
): boolean {
  if (isString(v)) return true;
  // An `Indeterminate` literal is not numeric yet: its numeric
  // approximation is `NaN`.
  if (isNumber(v))
    return !numericApproximation || (!v.isExact && !v.isIndeterminate);
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
