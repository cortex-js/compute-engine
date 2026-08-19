import {
  checkArity,
  checkType,
  checkTypes,
  spellCheckMessage,
  validateArguments,
} from '../boxed-expression/validate.js';
import { toInteger, toIntegerOperand } from '../boxed-expression/numerics.js';

import {
  basicIndexedCollectionHandlers,
  broadcastOverIndexedCollections,
  canEnumerateFiniteSource,
  canEnumerateOperand,
  collectionSubset,
  elementCountOfFiniteSource,
  enumerableFromAllSources,
  enumerableFromSource,
  hasAccessibleComponents,
  isDeclaredScalarNumber,
  isEnumerableSource,
  isFiniteBroadcastParticipant,
  isPossiblyCollectionTyped,
  isTextAtom,
  isRecordShapedType,
  isTuple,
  isTupleShapedType,
  lazyBroadcastMap,
  MAX_SIZE_EAGER_COLLECTION,
  typeCouldBeCollection,
  windowedCollectionOps,
  type WindowedParams,
} from '../collection-utils.js';
import type { CollectionHandlers } from '../types-definitions.js';
import { callbackArityError, type CallbackSupply } from './callback-arity.js';
import { extractFiniteDomainWithReason } from './logic-analysis.js';
import { applicable, canonicalFunctionLiteral } from '../function-utils.js';
// Dynamic import for compile to avoid circular dependency
// (collections → compile-expression → base-compiler → library/utils → collections)
import { kleeneAnd, kleeneOr } from '../../common/kleene.js';
import { parseType } from '../../common/type/parse.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  isObjectType,
  isSubtype,
  objectLayoutOfType,
  provablyDisjoint,
  resolveTypeReference,
} from '../../common/type/subtype.js';
import {
  COLLECTION_SHAPE_TYPE,
  DICTIONARY_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import { isWildcard } from '../boxed-expression/pattern-utils.js';
import {
  DictionaryType,
  ListType,
  ObjectType,
  RecordType,
  TupleType,
  Type,
} from '../../common/type/types.js';
import {
  collectionElementType,
  functionResult,
  functionArity,
  staticCollectionDims,
  widen,
} from '../../common/type/utils.js';
import { interval, intervalContains } from '../numerics/interval.js';
import { MAX_RANDOM_ELEMENT_COUNT } from '../numerics/random.js';
import {
  CancellationError,
  checkDeadline,
  run,
} from '../../common/interruptible.js';
import { mapAutoCompileRunner } from './map-auto-compile.js';
import { lowerMapSpine, makeSpineRunner } from './map-lowering.js';
import { implicitCompile } from '../implicit-compile.js';
import { sumVariantInfo } from '../sum-representation.js';
import type {
  Expression,
  FunctionInterface,
  OperatorDefinition,
  ExpressionInput,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import { BoxedType } from '../types.js';
// BoxedDictionary dynamically imported to avoid circular dependency
import { canonical } from '../boxed-expression/canonical-utils.js';
import { isValueDef } from '../boxed-expression/utils.js';
import { flatten } from '../boxed-expression/flatten.js';
import { shapedListType } from '../boxed-expression/shaped-list-type.js';
import {
  isAbsentValue,
  isDictionary,
  isFunction,
  isNumber,
  isObject,
  isString,
  isCharacter,
  isSymbol,
  sym,
} from '../boxed-expression/type-guards.js';
import { typeMembership } from './sets.js';
import { isRingConstant } from './ring-constructions.js';
import { adjoinType } from './type-handlers.js';
import {
  evaluateProtocolProperty,
  immutableValueAssignmentError,
  protocolMemberSignature,
  protocolMemberValue,
  protocolOfSymbol,
  protocolPropertyType,
} from '../engine-protocols.js';

// From NumPy:
export const DEFAULT_LINSPACE_COUNT = 50;

/**
 * Tri-state read of an integer PARAMETER of a collection handler, for the
 * operators whose fallback would be a DIFFERENT collection rather than
 * "unknown":
 *
 * - a `number` — the parameter resolved (see {@link toIntegerOperand}: the
 *   operand may not have been evaluated yet).
 * - `undefined` — the parameter is ABSENT (omitted, so the slot holds
 *   `Nothing`); apply the operator's own default.
 * - `null` — the parameter is PRESENT but does not resolve to an integer (a
 *   free symbol, a `NaN`). The handler must bail to its indeterminate channel
 *   (`count`/`at` → `undefined`, an empty iterator) instead of substituting a
 *   default, or the expression silently answers a collection it does not
 *   denote: `Take(xs, n)` → `[]`, `Drop(xs, n)` → all of `xs`,
 *   `RotateLeft(xs, n)` → rotated by one. This is the `undefined → value`
 *   collapse class `hasSymbolicRangeBounds` guards for `Range`.
 *
 * `NaN` is deliberately NOT read as absence here, unlike `isAbsentValue`: an
 * operator whose parameter is typed `number` (`Take`, `Slice`, `Fill`) admits
 * `NaN` through its signature, and treating it as "omitted" put `Take(xs, NaN)`
 * back on the default — answering `[]`. It is a present value that is not an
 * integer, which is exactly the `null` case. (`RotateLeft`/`RotateRight` type
 * the slot `integer`, so `NaN` never reaches here: canonicalization rejects it
 * with `incompatible-type`.)
 */
function integerParam(op: Expression | undefined): number | undefined | null {
  if (op === undefined || isSymbol(op, 'Nothing')) return undefined;
  return toIntegerOperand(op);
}

/**
 * Concatenate characters back into a string, for the operators whose result
 * is a subset or a reordering of the source's own characters.
 *
 * Returns `undefined` — decline — if any element is not text, so a handler
 * never fabricates a string out of elements it did not understand.
 *
 * RE-SEGMENTATION CAVEAT: concatenation can MERGE adjacent grapheme clusters
 * or split one apart, so the result may hold a different number of characters
 * than were handed in. Reversing `"xé"` written as `x` + `e` + COMBINING ACUTE
 * ACCENT, for instance, puts the combining mark first, where it attaches to
 * nothing and stands as a character of its own. A character-selecting
 * operation is closed over strings but NOT over character COUNTS; that is
 * inherent to Unicode grapheme segmentation, not a defect
 * (`docs/STRING_ROADMAP.md`, design constraint 3).
 */
export function joinCharacters(
  ce: ComputeEngine,
  elements: Iterable<Expression>
): Expression | undefined {
  const parts: string[] = [];
  for (const c of elements) {
    if (isCharacter(c) || isString(c)) parts.push(c.string);
    else return undefined;
  }
  return ce.string(parts.join(''));
}

/**
 * The source operand as an actual string node when it is text, otherwise the
 * operand unchanged — the form {@link innerRun} needs.
 *
 * EAGER handlers never need this: `evaluate` receives operands already
 * evaluated, so a string source arrives as a `BoxedString`. The LAZY handlers
 * (`collection.at`, `collection.iterator`) receive the RAW operand instead, and
 * a symbol holding a string (`s := "abcd"`) or a string-valued application
 * (`Join("ab","cd")`) is not a `BoxedString` node — so a bare `isString` test
 * fails there and the same operator emits inner LISTS on the lazy route while
 * emitting inner STRINGS on the eager one. Since the eager/lazy split is
 * decided by the source's LENGTH (`MAX_SIZE_EAGER_COLLECTION`), that made the
 * element kind depend on how long the string was.
 *
 * `isTextAtom` decides text-ness from the static type and the symbol's value
 * binding, so the `evaluate()` hop only runs for a source that is text but not
 * yet a literal; a general collection is returned untouched and never
 * evaluated. Resolve ONCE per lazy view and reuse the result — do not call this
 * per emitted element.
 */
export function resolveTextSource(source: Expression): Expression {
  if (isString(source) || !isTextAtom(source)) return source;
  const value = source.evaluate();
  return isString(value) ? value : source;
}

/**
 * Wrap ONE inner run of source elements — a chunk, a window, a group, a
 * permutation, a combination — as a single element of the result.
 *
 * For a general collection that element is a `List`. For a STRING source it is
 * a STRING: a run of a string's characters is itself a string, so
 * `Partition("abcdef", 2)` is `["ab","cd","ef"]` rather than `[["a","b"],…]`
 * (ruling D9(b), 2026-08-16; `docs/plans/2026-08-16-string-phase2-join-search-ops.md`).
 * Every operator that uses this declares a matching leading string arm in its
 * signature, so the declared result type and the emitted elements agree.
 *
 * RE-SEGMENTATION CAVEAT: joining whole grapheme clusters back into a string
 * re-runs segmentation, and two adjacent clusters can merge into one — but
 * only when the SOURCE itself contained a LONE COMBINING MARK, since that is
 * the only way a cluster can begin with a character that attaches to whatever
 * precedes it. For a well-formed source the character count of each inner run
 * is preserved (`docs/STRING_ROADMAP.md`, design constraint 3).
 *
 * Falls back to a `List` if the run holds anything that is not text, so a
 * handler never fabricates a string out of elements it did not understand;
 * that cannot happen for a string source, whose elements are all characters.
 */
export function innerRun(
  ce: ComputeEngine,
  source: Expression,
  run: readonly Expression[]
): Expression {
  if (isString(source)) {
    const joined = joinCharacters(ce, run);
    if (joined !== undefined) return joined;
  }
  return ce.function('List', run as Expression[]);
}

/**
 * {@link windowedCollectionOps} with the string rule applied to the emitted
 * windows: over a STRING source each window comes back as a string rather than
 * as a `List` of characters, matching the leading string arm the windowing
 * operators (`Partition`, `SlidingWindow`) declare (ruling D9(b), 2026-08-16;
 * see `innerRun`).
 *
 * Only `at` and `iterator` differ — every geometric facet (`count`,
 * `isFinite`, `isEmpty`, `isEnumerable`) counts windows, not characters, and is
 * identical either way. The base handlers build each window as a `List`, so the
 * wrapper unpacks that `List` and rejoins it; the double pass is negligible
 * beside the source walk that produced it. For the same reason the wrapper
 * calls `getParams` a second time (the base handler already called it once):
 * extracting the geometry is a couple of operand reads, while the base `at`
 * just walked `size` elements of the source to build the window.
 */
export function stringAwareWindowedCollectionOps(
  getParams: (collection: Expression) => WindowedParams | undefined
): CollectionHandlers {
  const base = windowedCollectionOps(getParams);
  // The source as a string node, or `undefined` when it is not text. A form
  // with no lazy view (`getParams` declines) never reaches an emission site.
  // `p.src` is the RAW operand, so it may be a symbol holding a string or a
  // string-valued application rather than a `BoxedString`; see
  // `resolveTextSource`.
  const sourceString = (expr: Expression): Expression | undefined => {
    const p = getParams(expr);
    if (p === undefined) return undefined;
    const src = resolveTextSource(p.src);
    return isString(src) ? src : undefined;
  };
  return {
    ...base,
    at: (expr, index) => {
      const window = base.at?.(expr, index);
      const src = window === undefined ? undefined : sourceString(expr);
      if (src === undefined) return window;
      return innerRun(expr.engine, src, [...window!.each()] as Expression[]);
    },
    iterator: (expr) => {
      const it = base.iterator?.(expr);
      if (it === undefined) return undefined;
      const src = sourceString(expr);
      if (src === undefined) return it;
      const ce = expr.engine;
      return {
        next: () => {
          const r = it.next();
          if (r.done || r.value === undefined) return r;
          return {
            value: innerRun(ce, src, [...r.value.each()] as Expression[]),
            done: false,
          };
        },
      };
    },
  };
}

/**
 * The subject's and the needle's element sequences, for the sequence-search
 * family (`RangeOf`, `ContainsSequence`, `StartsWith`, `EndsWith`), or
 * `undefined` when the call must stay SYMBOLIC.
 *
 * Both operands must be FINITE collections. Searching an infinite subject for
 * an absent needle would not terminate, and the anchored tests additionally
 * need the subject's length; a collection whose finiteness is merely UNKNOWN
 * (a valueless symbol, a lazy view over a symbolic bound) is not searched
 * either — the house pattern is to leave the expression unevaluated rather
 * than guess, as `Sort` and `StringJoin` already do
 * (`docs/STRING_ROADMAP.md`, "Sequence-search operations").
 *
 * A string contributes its GRAPHEME CLUSTERS, since that is what its `each()`
 * yields. Comparing whole characters is what makes the grapheme-boundary
 * guarantee structural rather than an extra rule: no comparison can ever
 * straddle a cluster boundary.
 */
function sequenceSearchOperands(
  xs: Expression,
  needle: Expression
): [subject: Expression[], pattern: Expression[]] | undefined {
  if (xs.isFiniteCollection !== true) return undefined;
  if (needle.isFiniteCollection !== true) return undefined;
  return [
    Array.from(xs.each()) as Expression[],
    Array.from(needle.each()) as Expression[],
  ];
}

/**
 * True when `pattern` occurs in `subject` starting at the 0-based `offset`.
 * The caller has already checked that the window fits.
 *
 * Elements are compared with `isSame` — the exact structural check, which is
 * what an element identity test wants here (a search must not evaluate its
 * elements or apply a numeric tolerance, matching `IndexOf`). It also spans
 * the character/one-cluster-string bridge — a character and a one-cluster
 * string holding the same content are the same VALUE — so a `list<character>`
 * needle matches a string subject (the `BoxedString`/`BoxedCharacter` arm of
 * `same()` in `boxed-expression/compare.ts`).
 */
function matchesSequenceAt(
  subject: ReadonlyArray<Expression>,
  pattern: ReadonlyArray<Expression>,
  offset: number
): boolean {
  for (let k = 0; k < pattern.length; k++)
    if (!subject[offset + k].isSame(pattern[k])) return false;
  return true;
}

/**
 * True when an operand's type rules out its being a collection, so a compile
 * target may treat it as a single scalar slot.
 *
 * Deliberately conservative in one direction only: `unknown` and `value` (the
 * type of a free symbol in a compiled body) are NOT provably scalar, even
 * though they usually are at runtime. A union is scalar only if every arm is.
 */
function isProvablyScalar(operand: Expression): boolean {
  const nonScalar = (t: Type): boolean =>
    typeof t !== 'string' && t.kind === 'union'
      ? t.types.some(nonScalar)
      : isSubtype(t, COLLECTION_SHAPE_TYPE);
  return !nonScalar(operand.type.type);
}

/**
 * `canEnumerate` for the VARIADIC eager materializers (`ListFrom`, `SetFrom`,
 * `TupleFrom`): each operand that IS a collection gets walked, and the
 * evaluate handlers decline on one that is not finite
 * (`if (!xs.isFiniteCollection) return undefined`).
 *
 * A NON-collection operand contributes ITSELF (`ListFrom(5)` → `[5]`), so its
 * facets must not decide anything — a scalar's `isEnumerableCollection` is
 * `false`, which would otherwise wrongly inert the whole call. Hence the
 * `isCollection === true` gate.
 *
 * Provable declines only, never `true`: success also depends on the element
 * walk, which is not cheaply decidable (same reasoning as
 * `canEnumerateFiniteSource`).
 */
function canEnumerateCollectionOperands(expr: Expression): boolean | undefined {
  if (!isFunction(expr)) return undefined;
  for (const op of expr.ops) {
    if (op.isCollection !== true) {
      // Mirror the evaluate handlers' unresolved-operand guard: a
      // collection-TYPED operand that is not a collection right now leaves
      // them inert (USER-RULED 2026-08-11), and its own facet says whether
      // that is definite (a valueless symbol: `false`) or undecidable (an
      // unevaluated eager producer: `undefined`).
      if (!typeCouldBeCollection(op.type.type)) continue; // a scalar datum
      const e = op.isEnumerableCollection;
      if (e === false) return false;
      continue;
    }
    if (op.isEnumerableCollection === false) return false;
    if (op.isFiniteCollection === false) return false;
  }
  return undefined;
}

// Parsed form of the `At` signature (kept in sync with the `signature:` string
// on the `At` definition), used by its custom canonical handler to delegate
// operand validation to `validateArguments`.
const AT_SIGNATURE = parseType(
  '(value: indexed_collection<any> | dictionary<any>, index: (number|string|boolean|indexed_collection<any>)+) -> unknown'
);

// NOTE (2026-07-17): the `restsOnUnknown` predicate and its
// `AT_NARROWING_OPERATORS` set — the short-term half of Tycho item 19.3 —
// were RETIRED after the `broadcastable<T>` lift landed. Arithmetic over a
// top-typed APPLICATION (`2·h(x,y)-1`) now types `broadcastable<number>` and
// is admitted by the At gate's direct kind arm; no constructible base still
// types scalar `number` while resting on an `unknown` leaf (unknown SYMBOLS
// are inferred numeric by the arithmetic itself, and non-broadcastable
// numeric operators like `GCD` genuinely reduce — scalar is honest there).
// The `!isDeclaredScalarNumber` arm below still covers inferred-number
// symbols and inferred-signature calls (inference is retractable).

// True when `expr`'s type is a *union* with at least one member compatible with
// an indexable base — a broadcast-aware inference such as `finite_integer |
// vector<3>` (from `2·h(3,4)-1` with `h` a list-returning lambda), or a declared
// `number | list<number>` return. Such a base *could* be a collection at
// runtime, so `At` keeps it inert and defers to runtime rather than rejecting
// the whole union for not being a subtype of `dictionary | indexed_collection`.
// A union of only scalar members (e.g. `finite_integer | rational`) has no such
// member and still errors loudly.
function hasIndexableMember(expr: Expression): boolean {
  const t = expr.type.type;
  if (typeof t === 'string' || t.kind !== 'union') return false;
  return t.types.some(
    (m) => isSubtype(m, INDEXED_COLLECTION_SHAPE_TYPE) || isSubtype(m, DICTIONARY_SHAPE_TYPE)
  );
}

// Canonical-time "peek" through eager collection wrappers that don't change
// the answer a consumer is about to read.
//
// Soundness: `Length`/`Count`/`IsEmpty` depend only on the multiset of
// elements, so any COUNT-PRESERVING wrapper (`Sort`, `RandomShuffle`, `Reverse`)
// can
// be stripped — the wrapped and unwrapped collections have the same number of
// elements, whether the operand is concrete or symbolic, evaluated or not.
// `Contains` depends only on the SET of elements, so it may additionally strip
// `Unique` (which drops duplicates but preserves membership).
//
// Why it matters: consumers evaluate their operand first, so an EAGER wrapper
// (Sort/RandomShuffle) would materialize and reorder the whole collection before
// consumer reads a count/membership — e.g. `Count(Sort(Range(1,1e5)))` sorted
// 1e5 elements (~15s) only to discard the order. `Reverse` is lazy and cheap,
// but is included for structural uniformity (the same soundness argument
// applies); the real win is the eager wrappers.
//
// The strip keeps only the wrapper's first operand and drops any extra
// arguments (a `Sort` comparator) — by design, since those
// cannot change the count/membership. Loops to collapse nesting, e.g.
// `Count(Reverse(Sort(x))) → Count(x)`.
//
// Interaction with randomness, RULED (`docs/RANDOMNESS-MODEL.md` §5): stripping
// `RandomShuffle` means `Count(RandomShuffle(xs))` consumes ZERO draw indices,
// because the shuffle is never evaluated. That is correct — draw indices are
// consumed by evaluation and only by evaluation, exactly as an untaken `If`
// branch consumes none.
const COUNT_PRESERVING_WRAPPERS = ['Sort', 'RandomShuffle', 'Reverse'];
const MEMBERSHIP_PRESERVING_WRAPPERS = [
  'Sort',
  'RandomShuffle',
  'Reverse',
  'Unique',
];

function peekWrappers(
  op: Expression | undefined,
  wrappers: string[]
): Expression | undefined {
  let result = op;
  while (
    isFunction(result) &&
    wrappers.includes(result.operator) &&
    result.nops >= 1 &&
    // Only strip a wrapper whose own canonical form is valid. The operand
    // arriving here is already canonicalized, so an invalid wrapper argument
    // (e.g. a non-function `Sort` comparator) shows up as an error
    // subexpression. Stripping it would silently erase that static type error;
    // instead, stop peeking and let the validation path surface it.
    result.isValid
  ) {
    result = result.op1;
  }
  return result;
}

// Strip count-preserving wrappers (Sort/RandomShuffle/Reverse) from `op`.
const peekCountPreserving = (
  op: Expression | undefined
): Expression | undefined => peekWrappers(op, COUNT_PRESERVING_WRAPPERS);

// Strip membership-preserving wrappers (Sort/RandomShuffle/Reverse/Unique).
// NOTE: `Unique` is membership-preserving but NOT count-preserving, so it is
// only stripped for `Contains`, never for `Length`/`Count`/`IsEmpty`.
const peekMembershipPreserving = (
  op: Expression | undefined
): Expression | undefined => peekWrappers(op, MEMBERSHIP_PRESERVING_WRAPPERS);

// Parsed signatures (kept in sync with the `signature:` strings on the
// respective definitions) for the count/membership canonical handlers to
// delegate operand validation to `validateArguments`.
const LENGTH_SIGNATURE = parseType('(any) -> integer');
const COUNT_SIGNATURE = parseType('(collection<any>, any?) -> integer');
const ISEMPTY_SIGNATURE = parseType('(collection<any>) -> boolean');
const CONTAINS_SIGNATURE = parseType('(collection<any>, element: any) -> boolean');
// Only the GENERIC arm of `Join`'s overload set, and deliberately so: this
// type is used by the custom `canonical` handler to validate the operands,
// and the string-preserving arm (`(T+) -> T where T: string`) admits a strict
// SUBSET of what this arm admits — every string is a collection — so
// validating against the generic arm alone never rejects a call the overload
// set accepts. The RESULT type is not read here; the `type:` handler
// (`joinResultType`) owns it.
const JOIN_SIGNATURE = parseType('(collection<any>*) -> collection');
// The full overload set of `Slice`, written ONCE. Two places need it and they
// must not drift apart: the definition's `signature:` field (what the engine
// registers, and what result typing resolves an arm from) and the parsed
// `SLICE_SIGNATURE` below, which the custom `canonical` handler validates its
// operands against. The handler intercepts an absent (`Nothing`) span before
// the default `flatten` step can drop it, and must then do the argument
// validation the default path would have done — against the SAME contract the
// engine registered, or a call the definition accepts could be rejected at
// canonicalization (or the reverse). A single constant is what enforces that;
// nothing else checks the two for equality.
const SLICE_SIGNATURE_TEXT =
  '((value: T, span: range) -> T where T: string) & ((value: T, span: range | nothing) -> T | nothing where T: string) & ((value: T, start: number, end: number) -> T where T: string) & ((value: indexed_collection<T>, span: range) -> list<T> where T) & ((value: indexed_collection<T>, span: range | nothing) -> list<T> | nothing where T) & ((value: indexed_collection<T>, start: number, end: number) -> list<T> where T)';
// Parsed once, so the `canonical` handler does not re-parse the signature on
// every canonicalization.
const SLICE_SIGNATURE = parseType(SLICE_SIGNATURE_TEXT);
const APPEND_SIGNATURE = parseType('(collection<any>, value+) -> collection');

// Validate the collection operand of a LAZY collection operator's canonical
// handler — like `checkType(engine, op, type)` but fail-open: an operand whose
// type is not PROVABLY incompatible (`unknown`/`any`/`value`, or a
// `broadcastable<T>`) is admitted as-is instead of rejected. A hard reject
// here is worse than useless: the canonical handler returns `null`, and for a
// lazy operator `boxFunction` then falls back to a silently NON-canonical
// expression — valid-looking, but tripping the `Not canonical` asserts in
// arithmetic (`div`/`mul`) the moment it participates in a computation. The
// lazy-broadcast machinery hits exactly this: `mod(L, N)` over a
// declared-`unknown` symbol `L` holding a >100-element `List` builds
// `Map(…, L)` over the SYMBOL, whose static type is `unknown` even though its
// value is a collection. Mirrors the free-variable leniency of the
// signature-validation path in `box.ts` (an operand whose type is provisional
// may satisfy the parameter at runtime).
function checkCollectionOperand(
  engine: ComputeEngine,
  arg: Expression | undefined | null,
  type: 'collection' | 'indexed_collection' = 'collection'
): Expression {
  if (arg === undefined || arg === null) return engine.error('missing');
  const x = arg.canonical;
  if (!x.isValid) return x;
  const t = x.type.type;
  if (t === 'unknown' || t === 'any' || t === 'value') {
    // Value-aware refinement: an indeterminate-TYPED operand with a concrete
    // bound value that is provably NOT a collection (a declared-`unknown`
    // symbol assigned `5`) must still reject — admitting it would silently
    // canonicalize e.g. `Any(x)` and quantify over an empty element stream
    // (`Any(5)` → False). `isCollection` on a symbol consults its value, so
    // an unresolved symbol (no value yet) and a non-symbol (an application,
    // whose value is undefined) stay fail-open.
    if (x.value !== undefined && !x.isCollection)
      return checkType(engine, x, type);
    return x;
  }
  if (typeof t !== 'string' && t.kind === 'broadcastable') return x;
  return checkType(engine, x, type);
}

/** An anonymous (wildcard) parameter name: `_`, `_1`, … `_9`. */
const ANONYMOUS_PARAMETER_RE = /^_\d?$/;

/**
 * A boolean-shaped operand carrying at least one anonymous parameter — the
 * bare shorthand for a predicate (`_ > 5`). Used by `Count`, whose second
 * operand is overloaded between a VALUE to match and a PREDICATE to apply:
 * the wildcard is what tells the two apart, so a plain boolean value
 * (`Count(xs, True)`) is still a value.
 */
function isPredicateShorthand(op: Expression): boolean {
  return (
    op.type.matches('boolean') &&
    op.symbols.some((x) => ANONYMOUS_PARAMETER_RE.test(x))
  );
}

/**
 * The `Error` VALUE carried by a predicate result, or `undefined` when the
 * result is not error-valued.
 *
 * A predicate applied to an element can fail on the ELEMENT rather than on the
 * predicate itself: the callback parameter's `Typed` annotation (installed by
 * the contextual `callback<S>` slot) rejects an element whose type was
 * retracted, and
 * `applicable()` returns `["Apply", fn, ["Error", …]]` instead of `True`/
 * `False`. That is not a malformed predicate, so reporting
 * `predicate must return "True" or "False"` — with a spell-check hint that
 * absurdly reports on the lambda's own parameter — is wrong. `Map` surfaces
 * the per-element `Error` value in that situation; the predicate consumers use
 * this helper to do the same (into the output stream for `Filter`, as the
 * operator's result for the scalar-valued ones).
 *
 * Only reached once a result is known to be neither `True` nor `False`, so a
 * genuine non-boolean predicate result (`x ↦ 5`) still gets the original
 * message.
 */
function predicateErrorValue(
  pred: Expression | undefined
): Expression | undefined {
  if (pred === undefined || pred.isValid) return undefined;
  if (pred.operator === 'Error') return pred;
  return pred.errors[0];
}

/**
 * The error every predicate consumer throws when its predicate returns
 * something that is neither `True` nor `False` and is not an element-valued
 * failure ({@link predicateErrorValue}).
 *
 * Named for the operator that CONSUMED the predicate. `Filter`'s message was
 * copied verbatim into each sibling, so `CountIf(xs, x ↦ y)` reported a
 * *Filter* predicate — an operator the user never wrote.
 */
function predicateResultError(operator: string, fn: Expression): Error {
  return new Error(
    `${operator} predicate must return "True" or "False". ${spellCheckMessage(
      fn
    )}`
  );
}

/**
 * A function operand written in the wrapper-free shorthand form
 * (`["Greater", "_", 5]` instead of `["Function", ["Greater", "_", 5]]`),
 * converted to a canonical function literal — or `undefined` when the operand
 * is not a shorthand and should be left for the signature check to judge.
 *
 * The lazy higher-order operators (`Filter`, `Map`, `Any`, `All`, `MaxBy`, …)
 * route their function operand through `canonicalFunctionLiteral`, which is
 * what makes the shorthand work there. The eager ones (`CountIf`, `Find`,
 * `IndexWhere`, `Position`, `Sort`, …) had no `canonical` handler at all, so
 * the default signature validation saw a `boolean` where a `function` was
 * declared and reported `incompatible-type function/boolean`.
 *
 * Two kinds of operand are deliberately NOT converted:
 * - one that is already function-typed (a literal, or a symbol bound to one):
 *   there is nothing to desugar;
 * - one that yields a PARAMETERLESS literal (`5` → `() ↦ 5`, `True` → `True`):
 *   that is a plain value, and turning it into a constant function would
 *   silently accept `Sort(xs, 5)` instead of reporting it.
 */
function shorthandFunctionOperand(
  op: Expression | undefined
): Expression | undefined {
  if (op === undefined) return undefined;
  if (op.type.matches('function')) return undefined;
  const fn = canonicalFunctionLiteral(op);
  // `["Function", body, ...params]`: a shorthand must have contributed at
  // least one parameter (from a wildcard `_`/`_1`, or a free unknown).
  if (fn === undefined || !isFunction(fn, 'Function') || fn.nops < 2)
    return undefined;
  return fn;
}

// How many arguments each family of collection operators passes its callback,
// and what those arguments are — the operator half of the static
// callback-arity check (`callback-arity.ts`). Shared here so the wording is
// identical across the family and a slot cannot silently drift from what its
// `evaluate`/`collection` handlers actually apply.

/** A per-ELEMENT callback: `Filter`, `Any`, `Map` over one source, … */
const PER_ELEMENT_SUPPLY: CallbackSupply = {
  count: 1,
  describes: 'each element of the collection',
  destructurable: true,
};

/** An ACCUMULATING callback: `Reduce`, `Fold`, `Scan`. */
const ACCUMULATOR_SUPPLY: CallbackSupply = {
  count: 2,
  describes: 'the accumulator and the current element',
};

/** `Sort`/`Ordering` use the callback's arity as a MODE SELECTOR: a unary
 * sort key, or a binary comparator (see `sortedIndices`). Either fits; only a
 * callback matching neither is an error. */
const SORT_SUPPLY: ReadonlyArray<CallbackSupply> = [
  { count: 1, describes: 'a sort key for one element' },
  { count: 2, describes: 'the two elements being compared' },
];

/** `Iterate` likewise selects on arity: a unary function receives the previous
 * value alone, a binary one the index as well (see `iterateArgs`). */
const ITERATE_SUPPLY: ReadonlyArray<CallbackSupply> = [
  { count: 1, describes: 'the previous value' },
  { count: 2, describes: 'the 1-based index and the previous value' },
];

/** `Fill(f, (rows, cols))` computes every cell as `f(i, j)`. */
const FILL_SUPPLY: CallbackSupply = {
  count: 2,
  describes: 'the 1-based row and column indexes of the cell',
};

/**
 * The canonical function literal for a higher-order operator's callback slot,
 * or `undefined` when the operand is a plain VALUE that only a PARAMETERLESS
 * lift could turn into a function (`Map(5, xs)`, `Any(xs, True)`).
 *
 * `canonicalFunctionLiteral`'s shorthand path (its step 6) turns any operand
 * into a literal: an operand contributing no wildcard and no free unknown
 * becomes the constant `() ↦ 5`. That is what made `Map(5, xs)` answer
 * `[5, 5, 5]` and `Any(xs, 5)` carry a thunk, while the EAGER siblings —
 * which route through {@link shorthandFunctionOperand} instead — reported
 * `incompatible-type function/finite_integer` for the identical `Sort(xs, 5)`.
 * Declining the lift here hands the operand to the signature validation the
 * eager operators already use, so the whole family reports the same error
 * (ruled 2026-08-09: a parameterless operand at a callback slot is never what
 * the author meant). It is the same rule `canonicalFunctionLiteral` already
 * applies to a STRING operand at its step 0, widened from that one type.
 *
 * An operand that is ALREADY function-typed is untouched: an explicitly
 * written `["Function", 42]` is a deliberate nullary literal, not a value that
 * had to be lifted, and a symbol keeps deferring to its (possibly later)
 * definition.
 *
 * `arity` names the operator and how many arguments it will pass, so an
 * accepted operand additionally goes through the static callback-arity check
 * ({@link callbackArityError}): a callback that needs more parameters than the
 * operator supplies is rejected here rather than silently currying. Passing it
 * is what wires an operator into that check.
 *
 * `arity.source` is the collection the callback runs over. It feeds the
 * tuple-pattern hint ONLY — never the arity verdict — so an operator that
 * omits it still reports the mismatch, just without the suggested rewrite.
 */
function canonicalCallbackOperand(
  op: Expression | undefined,
  arity?: {
    operator: string;
    supply: CallbackSupply | ReadonlyArray<CallbackSupply>;
    source?: Expression;
  }
): Expression | undefined {
  if (op === undefined) return undefined;
  // An accepted callback, with the arity check applied when the caller wired
  // one. The check declines (returns `undefined`) whenever the operand's
  // parameter count is not statically readable.
  const accept = (fn: Expression): Expression =>
    arity === undefined
      ? fn
      : (callbackArityError(fn, arity.operator, arity.supply, arity.source) ??
        fn);
  const fn = canonicalFunctionLiteral(op);
  // The operand a canonical handler REJECTS is replaced by the error, which is
  // how such a handler reports one, so the diagnostic matches the eager
  // operators' `validateArguments` verdict byte for byte — including the SITE
  // operand (the faulted operand itself) `validateArguments` attaches via
  // `ce.typeError`.
  const reject = (actual?: Type) =>
    op.engine.typeError('function', actual ?? op.type.type, op);
  // A STRING is `canonicalFunctionLiteral`'s own step-0 exclusion, declined
  // there for this very reason — reported here instead of leaving the
  // application silently inert.
  if (fn === undefined) return isString(op) ? reject() : undefined;
  if (op.type.matches('function')) return accept(fn);
  // A SYMBOL is normally left to defer to its (possibly later) definition —
  // that is `canonicalFunctionLiteral`'s step 2 and the forward-reference
  // contract. One whose DECLARED type is already provably not a function
  // (`Any(xs, True)`, a symbol declared `integer`) defers to nothing: the
  // eager siblings reject it through `validateArguments`, and accepting it
  // here produced `Map(True, [1,2]) → [True(1), True(2)]`.
  //
  // The type is read from the definition by NAME, not from `op.type`: the
  // operand arrives raw here, where every symbol still reads `unknown`, and
  // `.canonical` would answer at the cost of DECLARING an undeclared symbol.
  // A symbol with no definition — the forward reference — is left alone.
  // A WILDCARD (`_`, `_1`, a named `_x`) is never an ordinary symbol here: the
  // bare `_` is the identity-function shorthand and the numbered ones are an
  // enclosing shorthand's parameters. Whatever a scope happens to have bound
  // to that name says nothing about the slot (`canonicalFunctionLiteral`
  // excepts `_` at its step 2 for the same reason).
  if (isSymbol(op) && !isWildcard(op)) {
    const def = op.engine.lookupDefinition(op.symbol);
    const declared = def && 'value' in def ? def.value.type.type : undefined;
    if (declared !== undefined && provablyDisjoint(declared, 'function'))
      return reject(declared);
    return accept(fn);
  }
  // `["Function", body, ...params]`: a lift with no parameter is a constant.
  if (isFunction(fn, 'Function') && fn.nops < 2) return reject();
  return accept(fn);
}

/**
 * The RESULT type of a `Reduce`/`Scan` fold, for their `type:` handlers.
 *
 * A CUSTOM combiner contributes its result type through `callbackResultType`
 * — which resolves a bare symbol through its DEFINITION, so `Reduce(L, h, 0)`
 * with `h(a, x) := a + 2x` types `number` like the inline lambda does (a
 * held, unbound symbol reports `unknown`, and an unknown-typed fold then
 * failed closed under scalar arithmetic on the JavaScript target as
 * "possibly a collection").
 *
 * A BUILTIN combiner (`Add`, `Multiply`, `Min`, `Max`) is typed from the
 * SOURCE, not from the operator's own signature: `Add: (value+) -> value`,
 * and typing the fold `value` made `Add` itself reject `Reduce(L, Add, 0)`
 * as incompatible with `number`. The fold's value is an element combined
 * with the seed, so its type is the widening of the element type and the
 * seed's type — `finite_integer` for a sum of integers seeded with `0`,
 * `complex` over a `list<complex>` — or `unknown` when the element type is
 * not numeric.
 */
function foldResultType(
  coll: Expression | undefined,
  op: Expression | undefined,
  init: Expression | undefined
): Type | undefined {
  if (op === undefined) return undefined;
  if (isSymbol(op) && BUILTIN_FOLD_HEADS.has(op.symbol)) {
    const elt = coll ? collectionElementType(coll.type.type) : undefined;
    if (elt === undefined || !isSubtype(elt, 'number')) return undefined;
    if (init === undefined) return elt;
    const seed = init.type.type;
    return isSubtype(seed, 'number') ? widen(elt, seed) : undefined;
  }
  return callbackResultType(op);
}

/** The builtin combiners `Reduce`/`Scan` fold with natively (the JavaScript
 * target lowers exactly these — `builtinCombiner` in `javascript-target.ts`). */
const BUILTIN_FOLD_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Multiply',
  'Min',
  'Max',
]);

/**
 * Canonical handler for an EAGER operator with a `function` parameter slot at
 * `index`: desugar a shorthand function operand (see
 * `shorthandFunctionOperand`), then run the same flatten + signature
 * validation the default canonicalization would have run.
 *
 * These operators are deliberately kept non-`lazy`: their `evaluate` handlers
 * read pre-evaluated operands, and a held operand arrives UNBOUND on the
 * `ce.box`/parse routes (see the lazy-operator trap in CLAUDE.md).
 *
 * `supply` is the eager half of the static callback-arity check the lazy
 * operators get through {@link canonicalCallbackOperand}: how many arguments
 * this operator passes its callback, so a callback declaring more parameters
 * than that is rejected instead of silently curried. It runs AFTER the
 * signature validation, so an operand the signature already faulted (an
 * `Error`, or `Partition`'s `integer` chunk-size arm) is left as validation
 * reported it — the arity check declines on anything that is not a readable
 * callback.
 */
function canonicalFunctionSlot(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>,
  index: number,
  supply?: CallbackSupply | ReadonlyArray<CallbackSupply>
): Expression {
  const xs = flatten(ops);
  const fn = shorthandFunctionOperand(xs[index]);
  const args = fn === undefined ? xs : xs.map((x, i) => (i === index ? fn : x));

  // The declared signature, read from the definition rather than restated
  // here, so the two can't drift apart.
  const def = ce.lookupDefinition(operator);
  const sig =
    def && 'operator' in def ? def.operator.signature.type : undefined;
  const adjusted = sig
    ? validateArguments(ce, args, sig, false, false)
    : undefined;

  const final = adjusted ?? args;
  // The source feeds the tuple-pattern hint only. Every operator on this route
  // is binary in the shape that matters — one collection and one callback — so
  // the source is simply the OTHER of the two operands, which spares each call
  // site from restating a position it already fixed by passing `index`.
  const arityError =
    supply === undefined || final[index] === undefined
      ? undefined
      : callbackArityError(
          final[index],
          operator,
          supply,
          final[index === 0 ? 1 : 0]
        );

  return ce._fn(
    operator,
    arityError === undefined
      ? final
      : final.map((x, i) => (i === index ? arityError : x))
  );
}

/**
 * Design D §5 step 4 (R-D2′, ruled 2026-08-09): the RESULT type a callback
 * OPERAND contributes.
 *
 * Contract clause 3 in one function: only the operand's RESULT position is
 * read. Its parameter types are never consulted, so a callback narrower than
 * the source's elements still enters and is still judged per element at
 * application time — the whole reason `callback<S>` exists.
 *
 * BOTH an inline literal and a NAMED callback contribute (that is R-D2′). A
 * named one needs a second look: a `lazy` operator holds its callback operand
 * STRUCTURALLY, and an unbound symbol reports `unknown` rather than its
 * declared signature.
 *
 * That second look is a DECLARATION LOOKUP, never `.canonical`. Canonicalizing
 * an unbound symbol AUTO-DECLARES an undeclared name into the enclosing
 * literal's scope, and a `.type` read must not write a binding: the effects
 * walker's unresolved-name rule (an undeclared head infers `{any}`) then reads
 * a declared name and reports the application PURE. `ce.lookupDefinition` is
 * the same side-effect-free route `valueSignatureOf` (`effects-inference.ts`)
 * takes for exactly this reason.
 */
function callbackResultType(op: Expression | undefined): Type | undefined {
  if (op === undefined) return undefined;
  const direct = functionResult(op.type.type);
  if (direct !== undefined) return direct;
  if (!isSymbol(op)) return undefined;
  const def = op.engine.lookupDefinition(op.symbol);
  if (def === undefined) return undefined;
  const declared =
    'operator' in def ? def.operator.signature.type : def.value.type?.type;
  return declared === undefined ? undefined : functionResult(declared);
}

/**
 * The argument list `Iterate` applies its function to, at step `n` with
 * accumulator `acc`.
 *
 * The declared contract is `f(index, acc)`. A function whose TYPE says it is
 * unary — the documented shorthand `Iterate(2 * _, 1)` — is applied to the
 * accumulator alone. Without this the surplus argument threw
 * `Too many arguments …` out of the collection handlers, escaping to the host
 * on every route (`.at()`, `each()`, `Take`, materialization). A
 * statically-unknown arity keeps the two-argument form, so nothing existing
 * changes meaning — the same convention `sortedIndices` uses to tell a
 * `Sort` key from a `Sort` comparator.
 */
function iterateArgs(
  ce: ComputeEngine,
  fn: Expression,
  n: number,
  acc: Expression
): Expression[] {
  if (functionArity(fn.type.type) === 1) return [acc];
  return [ce.number(n), acc];
}

/**
 * A source operand for `Map`, with an *eager* collection resolved to its
 * evaluated form.
 *
 * An expression with no collection handlers whose static type is nonetheless
 * a collection only becomes a concrete collection once evaluated. Two shapes
 * reach here: a broadcast arithmetic result (`X - 1` where `X` holds a list,
 * typed `vector<integer^3>`) and an eager collection operator
 * (`UnicodeScalars(s)`). Iteration already copes — the iterator evaluates once
 * and iterates the result — but `count`/`isEmptyCollection`/
 * `isFiniteCollection`/`at` all report `undefined` for such an operand, which
 * stalls `materialize()` and leaves the whole `Map` symbolic: `Map(f, X - 1)`
 * stayed unevaluated while `Map(f, X)` and `Map(f, [0,1,2])` did not.
 *
 * Every other lazy collection operator answers those predicates from its own
 * iterator (`Filter`, `Drop`, `Rest`, …, all of which already handle a
 * computed source); `Map` is the one that delegates them to its source, so the
 * resolution lives here rather than on `BoxedExpression`. Reporting such an
 * operand as a collection engine-wide is NOT a safe generalization — it
 * reclassifies broadcast results for `Sum`/`Product` body typing and for the
 * compile targets' collection-valued-body fail-closed gates.
 */
function mapSource(xs: Expression): Expression {
  if (xs.isCollection) return xs;
  if (!xs.type.matches('collection<any>')) return xs;
  // Guard: a self-referential binding (`xs := Map(f, xs)`) resolves to a value
  // that mentions `xs`, and that value's own shape predicates route straight
  // back here — `isFinite` → `mapSource` → `evaluate()` → `isFiniteCollection`
  // → `isFinite`, one stack frame deeper each turn.
  //
  // `BoxedSymbol._value` already treats such a binding as unbound, but
  // `evaluate()` reaches the stored value by the `_dereference` path instead,
  // and that path's cycle guard is released before the CALLER queries the
  // returned value — so each turn is a *completed* dereference and the guard
  // never sees the re-entry. Leaving the source unresolved here is what every
  // other lazy operator already does with a source it cannot resolve, and it
  // puts `Map` on the same symbolic-residual behavior as `Filter`.
  if (xs.valueDefinition?.isSelfReferential) return xs;
  const evaluated = xs.evaluate();
  return evaluated.isCollection ? evaluated : xs;
}

// Rebuild the operand list with `first` in place of `op1`, dropping nothing
// else. Used by the peek handlers after stripping a wrapper from op1.
function withFirst(
  first: Expression | undefined,
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (first === undefined) return ops;
  return [first, ...ops.slice(1)];
}

// Shared instance of the basic handlers, used by the `Set` handlers to
// delegate the literal (non-comprehension) cases.
const SET_BASE_HANDLERS = basicIndexedCollectionHandlers();

// Element type of `xs` at 1-based `position` (`-1` = last), used by the
// `First`/`Second`/`Third`/`Last` type handlers. Prefers the operand's
// collection element-type handler (covers literal collections); for a
// symbolic operand with a statically-known tuple type, derives the type of
// the element at `position`; otherwise falls back to the (widened) collection
// element type.
function componentType(
  xs: Expression,
  position: number,
  // The stripped operand type at a `missingStrip` position (§3.B): the
  // framework hands it via `operandTypes` so a `missing | tuple<…>` operand
  // (an `At` access) types from its present arm.
  typeOverride?: Type
): Type {
  const elt = xs.operatorDefinition?.collection?.elttype?.(xs);
  if (elt) return elt;
  const t = typeOverride ?? xs.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple' && position >= 1) {
    const e = t.elements[position - 1]?.type;
    if (e) return e;
  }
  return collectionElementType(t) ?? 'any';
}

// The result type of a `First`/`Second`/`Third`/`Last` access (§3.C:
// `T | marker(T)` — the position may be out of band, e.g. an empty list or a
// short tuple). An in-range literal tuple slot is exact (no marker); an
// out-of-range literal tuple position misses to `marker(⊔S)`.
function componentResultType(
  xs: Expression,
  position: number,
  typeOverride?: Type
): Type {
  const t = typeOverride ?? xs.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple') {
    const n = t.elements.length;
    const i = position < 0 ? n + position + 1 : position;
    if (i >= 1 && i <= n) return t.elements[i - 1].type;
    return markerType(widen(...t.elements.map((x) => x.type)) as Type);
  }
  return withMarker(componentType(xs, position, typeOverride));
}

// Build the result type of `Map`: a collection with the same shape and
// indexed-ness as the `source` collection, but whose elements are the
// mapping lambda's result type (`elementType`) — not the source element
// type. `Map(k => k + i, Range(1,3))` is thus `indexed_collection<complex>`,
// not `indexed_collection<integer>`.
function mapResultType(
  source: Readonly<Type>,
  elementType: Readonly<Type>
): Type {
  if (typeof source === 'string') {
    if (source === 'list')
      return { kind: 'list', elements: elementType as Type };
    if (source === 'set') return { kind: 'set', elements: elementType as Type };
    if (source === 'indexed_collection' || source === 'collection')
      return { kind: source, elements: elementType as Type };
    // An index span maps to an ORDERED result, and `range` cannot carry the
    // lambda's element type (it is unparameterized, and its elements are
    // indices by definition), so the result widens to `indexed_collection`.
    // Without this case a mapped span fell through to the unordered
    // `collection` below and rebuilt with a `Set` head.
    if (source === 'range')
      return { kind: 'indexed_collection', elements: elementType as Type };
    // A STRING source yields a LIST, permanently: `Map` is element-
    // TRANSFORMING, and there is no type-level rule worth its complexity for
    // detecting "the callback returns characters", so a mapped string is a
    // `list<R>` even for a character→character callback. Rejoin explicitly
    // with `String(...)`. See `docs/STRING_ROADMAP.md` ("String preservation
    // rule").
    if (source === 'string')
      return { kind: 'list', elements: elementType as Type };
    // dictionary/record/tuple/etc.: yield a plain collection of the results.
    return { kind: 'collection', elements: elementType as Type };
  }
  if (source.kind === 'list') {
    const t: ListType = { kind: 'list', elements: elementType as Type };
    if (source.dimensions) t.dimensions = source.dimensions;
    return t;
  }
  if (source.kind === 'indexed_collection')
    return { kind: 'indexed_collection', elements: elementType as Type };
  if (source.kind === 'set')
    return { kind: 'set', elements: elementType as Type };
  if (source.kind === 'collection')
    return { kind: 'collection', elements: elementType as Type };
  // tuple/dictionary/record and anything else: fall back to a plain
  // collection of the lambda results.
  return { kind: 'collection', elements: elementType as Type };
}

/**
 * A `tuple<…>` result type, built STRUCTURALLY from the operand types.
 *
 * Never serialize operand types into a `tuple<…>` string and reparse it: a
 * resolver-less `parseType()` cannot read back a user-declared type name
 * (`ce.declareType('point', …)`), and the type handlers have no resolver in
 * hand. Building the node directly is both resolver-proof and cheaper.
 */
function tupleTypeOf(ops: ReadonlyArray<Expression>): Type {
  return { kind: 'tuple', elements: ops.map((op) => ({ type: op.type.type })) };
}

/** How many actual elements `absenceMarker()` probes when a collection's
 *  element type is statically indeterminate. */
const MAX_ABSENCE_MARKER_PROBE = 10;

/**
 * The target languages `PointList`'s compile handler lowers (a point value with
 * scalar components). On any OTHER language the handler declines by returning
 * `undefined` — it has no opinion there, so a custom target's own `PointList`
 * mapping still applies. Used to decide whether an operand-shape decline may
 * fail closed with a specific diagnostic (Tycho item 109a) or must stay silent.
 */
const POINT_LIST_COMPILE_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript',
  'python',
  'glsl',
  'wgsl',
]);

/**
 * The field-bearing shape behind a `Field` operand's static type: a `record`,
 * an `object` layout, a `dictionary`, or a tuple with NAMED elements —
 * reached through type
 * REFERENCES, both alias and nominal. Unfolding a nominal reference here is
 * deliberate and is the whole point of `Field`: it is the nominal-types
 * design's sanctioned accessor window (D6/§4.5b D16), dispatching off the
 * type's definition body WITHOUT claiming any collection kind for the value
 * (`First(p)`, `p["x"]`, destructuring keep rejecting).
 */
/** `'none'` = the type is SETTLED and bears no named fields (`number`, a
 * list, an unnamed tuple, a scalar-bodied nominal…) — a static defect at a
 * `Field` site, per the design ruling. `undefined` = genuinely indeterminate
 * (`unknown`, an unresolved reference, an algebraic type) — stay symbolic. */
function fieldBearingType(
  t: Type
): RecordType | ObjectType | TupleType | DictionaryType | 'none' | undefined {
  // An APPLIED reference reads its body instantiated at the arguments
  // (parameterized-nominal design §6); an unfulfilled or self-cycling one
  // answers `undefined`. Shared with `BoxedObject._fieldType`, which asks the
  // same question of a PINNED type — hence the walk lives in `common/type`,
  // which both the expression layer and this library layer may import.
  const resolved = resolveTypeReference(t);
  if (resolved === undefined) return undefined;
  t = resolved;
  if (typeof t === 'string') {
    if (
      t === 'unknown' ||
      t === 'any' ||
      t === 'expression' ||
      t === 'missing' ||
      // The BARE kinds are field-bearing but carry no field information.
      // `object` belongs here for the same reason `record` does: it promises
      // fields exist without naming them, so a property read on a value
      // annotated bare `object` must DEFER to the runtime rather than be
      // rejected statically (the `Field` evaluate handler reads it correctly
      // via its `isObject(base)` arm).
      t === 'record' ||
      t === 'object' ||
      t === 'dictionary' ||
      t === 'tuple'
    )
      return undefined;
    return 'none';
  }
  // An `object{…}` layout is field-bearing in exactly the way a record body
  // is — the same ordered map from field name to field type — and reaching it
  // through the pinned nominal reference is how `p.age` learns its static
  // type. The difference the layout carries is that its fields are read/write
  // positions, which matters to variance and to stores, not to this lookup.
  if (t.kind === 'record' || t.kind === 'object' || t.kind === 'dictionary')
    return t;
  if (t.kind === 'tuple')
    return t.elements.some((x) => x.name !== undefined) ? t : 'none';
  if (t.kind === 'union' || t.kind === 'intersection' || t.kind === 'negation')
    return undefined;
  return 'none';
}

//
// ── Property stores: `p.age = 43` ────────────────────────────────────────────
//
// Assignment through a `Field` target is a **store into a mutable object**,
// and it is legal on nothing else. Spec: `docs/TYPE_SYSTEM_ROADMAP.md`
// Appendix B, "Assigning to a property" and "A store writes the evaluated
// value". The two functions below are the canonical-time and evaluate-time
// halves of one decision, and `Assign` (`library/core.ts`) is their only
// caller.
//

/**
 * Does the receiver's own object layout declare this field?
 *
 * This is the question that has to be asked BEFORE the protocol-property
 * route, and it is asked of the STATIC type because the canonical handler has
 * no value in hand. An object's stored fields belong to the object: when a
 * `readwrite` protocol happens to declare a property of the same name, the
 * store still wins.
 *
 * A `true` here means "this is certainly a store, do not refuse it statically",
 * and it earns its place by reading a bare-symbol receiver off its DEFINITION:
 * {@link fieldAssignmentVerdict} canonicalizes the receiver instead, which
 * folds a single-letter target into the library constant of that name (`i`
 * becomes `ImaginaryUnit`) and would report a settled non-object type for a
 * binding that in fact holds an object.
 *
 * Answers `false` whenever the layout cannot be read — an unsettled receiver,
 * a bare `object` annotation (which promises fields without naming them), a
 * union. Those defer to the runtime route, where `objectFieldStore` puts the
 * instance's own layout back in charge.
 *
 * `isObjectFieldStore()` in `boxed-expression/effects-of.ts` resolves a
 * receiver by the same two rules, for a different purpose: labelling the
 * assignment's EFFECT. It deliberately parts company on the union case, where
 * it claims the store rather than declining — an effect label cannot be
 * deferred to evaluation the way this precedence decision can, and the store
 * does happen. Keep the receiver resolution in step; that one arm is meant to
 * differ.
 */
export function objectLayoutOwnsField(
  ce: ComputeEngine,
  lhs: Expression
): boolean {
  if (!isFunction(lhs, 'Field')) return false;
  if (!isString(lhs.ops[1])) return false;
  const name = lhs.ops[1].string;
  const base = lhs.ops[0];
  if (base === undefined) return false;

  // A bare-symbol receiver is read off its DEFINITION, never by canonicalizing
  // it: canonicalizing a single-letter target folds it into the constant of
  // that name (`i` becomes `ImaginaryUnit`), which is why `Assign` keeps its
  // left operand raw at all.
  const rootName = sym(base);
  if (rootName !== undefined) {
    const def = ce.lookupDefinition(rootName);
    const t =
      def !== undefined && isValueDef(def) ? def.value.type.type : undefined;
    return (
      t !== undefined && objectLayoutOfType(t)?.elements[name] !== undefined
    );
  }

  // A computed receiver (`xs[i].name`, `p.inner.name`) has no binding to read,
  // so its type comes from canonicalizing it — the same thing
  // {@link fieldAssignmentVerdict} does for every receiver.
  try {
    const canonical = base.canonical;
    if (!canonical.isValid) return false;
    return (
      objectLayoutOfType(canonical.type.type)?.elements[name] !== undefined
    );
  } catch {
    return false;
  }
}

/**
 * What should `Assign`'s CANONICAL handler do with a `Field` left operand?
 *
 * - `undefined` — this is not a field target at all; the caller keeps whatever
 *   it does otherwise.
 * - `'defer'` — it may be a store, but the receiver's type does not settle it
 *   here. The caller keeps the `Field` target RAW and asks
 *   {@link objectFieldStore} again from `evaluate`, where a real value is in
 *   hand. This is the common case and not an edge one: the Epsil static
 *   pre-pass canonicalizes a whole program before any of it runs, so `p` is
 *   routinely still untyped at `p.age = 43`.
 * - an `Expression` — a static error to return in place of the assignment.
 *
 * The only static refusal made here is the one that CANNOT change at runtime:
 * a receiver whose type is settled and is not an object type can never become
 * one, because object types have no subtypes and no value of another type is
 * ever an object. That refusal is worth making early — it is the diagnostic a
 * reader of `d.id = "456"` on a record needs, and making it at evaluation
 * would report it only on the paths that run.
 */
export function fieldAssignmentVerdict(
  ce: ComputeEngine,
  lhs: Expression
): 'defer' | Expression | undefined {
  if (!isFunction(lhs, 'Field')) return undefined;
  if (!isString(lhs.ops[1])) return undefined;
  const name = lhs.ops[1].string;
  const base = lhs.ops[0];
  if (base === undefined) return undefined;

  // Canonicalizing the receiver can itself throw on a malformed target; a
  // target whose type cannot even be asked for is deferred, never refused,
  // so the runtime route reports whatever is actually wrong with it.
  let t: Type;
  try {
    const canonical = base.canonical;
    // A receiver that is ALREADY broken (an undeclared constructor, a call
    // that did not type-check) has a real diagnostic of its own, and typing
    // `error` as "not an object type" would bury it under a second, wrong
    // one. Defer: the runtime route propagates the receiver's own error.
    if (!canonical.isValid) return 'defer';
    // A bare-symbol receiver that canonicalized into a DIFFERENT symbol was
    // folded into the library constant of its name (`e` becomes
    // `ExponentialE`, `i` becomes `ImaginaryUnit`) — which is why `Assign`
    // keeps its left operand raw in the first place. Euler's number is not what
    // the author is writing to: the fold happens while `let e = Person(…)` has
    // not run yet, and refusing here would report `immutable-value-assignment`
    // about a constant for a binding that holds an object by the time the write
    // runs. Defer, and let the runtime route ask the real receiver. (A store
    // into a genuine constant is still refused there, with the same code.)
    const rootName = sym(base);
    if (rootName !== undefined && sym(canonical) !== rootName) return 'defer';
    t = canonical.type.type;
    // Likewise for a receiver whose TYPE is `error` — a binding whose
    // initializer failed. The binding itself is a valid symbol, so the check
    // above does not catch it, and calling `error` "not an object type" would
    // report a second, wrong defect on top of the real one.
    if (t === 'error') return 'defer';
  } catch {
    return 'defer';
  }

  // `fieldBearingType` answers `undefined` for everything indeterminate — an
  // unresolved reference, bare `object`, and (the case that matters for
  // `xs[i].name = v`) a union, since an absence marker joins `missing` onto
  // the element type. All of those defer.
  const rt = fieldBearingType(t);
  if (rt === undefined) return 'defer';
  if (rt !== 'none' && rt.kind === 'object') return 'defer';

  return immutableValueAssignmentError(ce, name, t);
}

/**
 * The LAST refusal for a `Field` assignment: every route has now declined —
 * the receiver did not evaluate to an object ({@link objectFieldStore}) and no
 * protocol claims the name either — so the target simply cannot be stored
 * into. Called from `Assign`'s evaluate handler, which owns that ordering.
 *
 * Separate from the refusals inside {@link objectFieldStore} because it can
 * only be made once the protocol route has had its turn: a name the object's
 * layout has no slot for may still be a COMPUTED property, whose `set`
 * accessor performs the write, and this function would report it as an
 * unknown field.
 *
 * `base` is the receiver ALREADY EVALUATED by the caller, never re-derived
 * from `lhs` here. A receiver is an arbitrary expression and may carry effects
 * (`nextItem().field = v`), so evaluating it a second time to format an error
 * would fire them twice — which is what this function used to do.
 *
 * `undefined` means "do not refuse at all, stay SYMBOLIC": the receiver's type
 * promises an object while its VALUE is not one yet.
 */
export function fieldStoreRefusal(
  ce: ComputeEngine,
  lhs: Expression,
  base: Expression | undefined
): Expression | undefined {
  if (!isFunction(lhs, 'Field'))
    return immutableValueAssignmentError(ce, '', 'unknown');
  const name = isString(lhs.ops[1]) ? lhs.ops[1].string : '';
  if (base !== undefined && !base.isValid) return base;
  // A receiver whose TYPE is an object type but whose VALUE is not an object —
  // a declared-but-unassigned binding (`let q: Q`), a call that stayed symbolic
  // — is not an immutable target, and saying so would be flatly false. Nothing
  // is wrong with the write either; there is simply nothing to store into yet.
  // Stay symbolic, exactly as a property READ does for the same receiver
  // (`evaluateProtocolProperty`, `engine-protocols.ts`).
  if (base !== undefined && !isObject(base) && isObjectType(base.type.type))
    return undefined;
  // An OBJECT receiver is mutable — the target is fine, the NAME is not. Saying
  // "not an object type" here would be flatly false and would send the reader
  // looking for the wrong problem, so this reports the same `unknown-field`
  // (naming what IS stored) that reading the same name reports.
  if (base !== undefined && isObject(base))
    return ce.error(
      ['unknown-field', name, [...base._slots.keys()].join(', ')],
      base.typeName
    );
  return immutableValueAssignmentError(ce, name, base?.type.type ?? 'unknown');
}

/**
 * Perform `Assign(Field(base, name), value)` as a store, from `Assign`'s
 * EVALUATE handler — the route where a real receiver is in hand.
 *
 * `undefined` means the receiver did not evaluate to an object and this is not
 * a store; every other outcome is the expression the assignment evaluates to
 * (the stored value on success, an error value otherwise).
 *
 * `base` is the receiver ALREADY EVALUATED by the caller — evaluated rather
 * than canonicalized-and-read, because the target of a store is a *reference*
 * and only an actual `BoxedObject` can be stored into, so a chain such as
 * `xs[i].name` resolves through ordinary evaluation like any other expression.
 * The caller owns that single evaluation and hands the same value to every
 * route it tries, so a receiver carrying effects fires them exactly once
 * however the assignment is ultimately resolved.
 *
 * The RHS is evaluated here, and only once this function is committed to
 * storing — that is both ruling B8's left-to-right order (receiver, then
 * value) and the guarantee that a declined route costs the RHS nothing. It is
 * evaluated at the exact tier (never `.N()`) and
 * the EVALUATED result is what lands in the slot — the rule that makes a field
 * read a pure load and the object's version counter a sufficient cache
 * dependency (Appendix B, "A store writes the evaluated value").
 */
export function objectFieldStore(
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression,
  base: Expression | undefined
): Expression | undefined {
  if (!isFunction(lhs, 'Field')) return undefined;
  if (!isString(lhs.ops[1])) return undefined;
  const name = lhs.ops[1].string;
  if (base === undefined) return undefined;
  // Anything that is not an object DECLINES rather than refuses. This route
  // runs first, before the protocol one, and a non-object receiver may still
  // have a `readwrite` protocol property whose setter performs the write; the
  // refusal for a target no route can serve is `fieldStoreRefusal`, which
  // `Assign` reaches only after both have declined.
  if (!isObject(base)) return undefined;

  // The LAYOUT is the authority on what this object has, and it is read off
  // the INSTANCE (pinned at construction), never off the type registry by
  // name: a `type` re-declaration replaces the registry record in place, and
  // an instance built before it keeps its own fields.
  //
  // A name the layout does NOT carry declines, and does not error here: an
  // object may conform to a protocol with a COMPUTED property — accessors and
  // no stored field — and `p.label = v` must reach that `set` accessor. This
  // mirrors the `Field` READ handler's object arm, which tries the protocol
  // route before reporting `unknown-field` for exactly the same reason. The
  // error, when no route answers at all, is `fieldStoreRefusal`'s to make.
  const declared = base._fieldType(name);
  if (declared === undefined) return undefined;

  const value = rhs.evaluate();
  if (!value.isValid) return value;

  // The declared field type is a contract the store must keep: a slot holds
  // values of its declared type for the object's whole lifetime, which is what
  // lets `p.age`'s static type be read off the layout at every use site.
  if (!value.type.matches(declared))
    return ce.typeError(declared, value.type, value);

  base._store(name, value);
  return value;
}

/**
 * The TYPE-LEVEL absence marker for a value of type `t` (§3.C):
 * ```
 * marker(T) = number            if T <: number               (absence value NaN)
 *           = missing           if T is a settled non-numeric type
 *                               (missing itself, empty joins, never)
 *           = number | missing  if T is indeterminate (unknown / any)
 * marker(A | B) = marker(A) ⊔ marker(B)                       (arm-split)
 * ```
 */
function markerType(t: Type): Type {
  if (typeof t !== 'string' && t.kind === 'union')
    return widen(...t.types.map((x) => markerType(x))) as Type;
  if (t === 'never') return 'missing';
  if (t === 'unknown' || t === 'any')
    return parseType('number | missing') as Type;
  if (isSubtype(t, 'number')) return 'number';
  return 'missing';
}

/**
 * `T | marker(T)`, normalized (§3.C): a numeric `T` absorbs its own absence
 * value (`NaN ∈ number`, I6) so the marker adds no arm and integer→number
 * (Q2); an indeterminate `T` normalizes to `unknown` (I5-sound — `unknown`
 * does not claim non-missing); a settled non-numeric `T` gains a visible
 * `| missing` arm.
 */
function withMarker(t: Type): Type {
  if (t === 'never') return 'missing';
  if (t === 'unknown' || t === 'any') return 'unknown';
  if (isSubtype(t, 'number')) return 'number';
  return widen(t, markerType(t)) as Type;
}

/**
 * The POSITION-PRESERVING absence marker VALUE for an out-of-band access into
 * the collection `xs`: `NaN` when the collection's elements are numeric,
 * `Missing` otherwise (I6 — domain normalization at value construction). With
 * no operand (`xs === undefined`) the marker is `Missing`.
 *
 * `Nothing` is deliberately NOT used here. `Nothing` is an ERASURE marker: it
 * is spliced out of operand lists AND of collections, so using it for an
 * out-of-band access (or for an element a handler failed to compute) would
 * silently shorten the result and misalign positional data.
 *
 * The element type is taken from the collection's `elttype` handler, falling
 * back to `collectionElementType()` of its static type (dictionary/record
 * values are keyed, so their VALUE type is used, not the iteration pair). When
 * that is indeterminate, the runtime evidence of the collection's own elements
 * decides: `NaN` when a bounded prefix is all numbers (and non-empty),
 * `Missing` otherwise (§3.C value-directed runtime marker).
 */
function absenceMarker(ce: ComputeEngine, xs?: Expression): Expression {
  if (xs === undefined) return ce.Missing;

  // A dictionary/record is a KEYED collection: the value `At` returns is the
  // entry's value, not the `tuple<string, T>` iteration pair that
  // `collectionElementType` reports. Use the value type instead.
  const xt = xs.type.type;
  let t: Type | undefined;
  if (typeof xt !== 'string' && xt.kind === 'dictionary') t = xt.values;
  else if (typeof xt !== 'string' && xt.kind === 'record')
    t = widen(...Object.values(xt.elements)) as Type;
  else
    t =
      xs.operatorDefinition?.collection?.elttype?.(xs) ??
      collectionElementType(xt);

  if (t !== undefined && t !== 'unknown' && t !== 'any' && t !== 'never')
    return isSubtype(t, 'number') ? ce.NaN : ce.Missing;

  // Indeterminate element type: probe a bounded prefix of the actual
  // elements. Only for a small, finite collection — never materialize a
  // large or unknown-length source just to pick a marker.
  const count = xs.count;
  if (
    xs.isFiniteCollection === true &&
    count !== undefined &&
    count <= MAX_SIZE_EAGER_COLLECTION
  ) {
    let sawNumber = false;
    let n = 0;
    for (const el of xs.each()) {
      if (++n > MAX_ABSENCE_MARKER_PROBE) break;
      if (!isNumber(el)) return ce.Missing;
      sawNumber = true;
    }
    if (sawNumber) return ce.NaN;
  }

  return ce.Missing;
}

/** True when `idx` is a collection index (an integer gather or boolean mask),
 *  as opposed to a scalar or string index. */
function isCollectionIndex(idx: Expression | undefined): boolean {
  return (
    idx !== undefined &&
    !isString(idx) &&
    isSubtype(idx.type.type, INDEXED_COLLECTION_SHAPE_TYPE)
  );
}

/**
 * The absence marker for a chained-`At` short-circuit (§3.C value-level
 * absorption): when an intermediate access is absent, the remaining index
 * steps are absorbed and the result is absence in the FINAL position's domain.
 * Peel `collType`'s element type through `ops[fromIndex..]` and return `NaN`
 * for a numeric final domain, `Missing` otherwise.
 */
function chainAbsorbMarker(
  ce: ComputeEngine,
  collType: Type,
  ops: ReadonlyArray<Expression>,
  fromIndex: number
): Expression {
  let t: Type = collType;
  for (let i = fromIndex; i < ops.length; i++) {
    const peeled = collectionElementType(t) ?? 'any';
    t = isCollectionIndex(ops[i])
      ? ({ kind: 'list', elements: peeled } as ListType)
      : peeled;
  }
  if (t === 'unknown' || t === 'any' || t === 'never') return ce.Missing;
  return isSubtype(t, 'number') ? ce.NaN : ce.Missing;
}

// Access the element of `xs` at 1-based `position` (`-1` = last), used by the
// `First`/`Second`/`Third`/`Last` evaluate handlers. A literal indexed
// collection returns the element (an out-of-range position yields the
// position-preserving absence marker, NOT `Nothing`, which would erase it);
// a symbolic operand whose type is (or could be) an indexed collection stays
// symbolic (return `undefined`); an operand provably not an indexed
// collection is a type error.
function componentAt(
  xs: Expression,
  position: number,
  ce: ComputeEngine
): Expression | undefined {
  // An absent base propagates position-preservingly, mirroring `At` over a
  // `Missing` base (`missingBehavior: 'handle'` on First/Second/Third/Last —
  // the element domain is unknown, so the marker stays `Missing`, not `NaN`).
  if (isSymbol(xs, 'Missing')) return xs;
  if (xs.isCollection) {
    // Runtime re-validation of the `indexed_collection` parameter (the static
    // gate is overlap-deferred, so an `unknown`-typed operand can arrive
    // holding a set-kind collection — `Integers`, `Set(…)`, a dictionary).
    // Those have no positions at all: refuse them the way `Take`/`Drop`/`At`
    // do, rather than answering the position-preserving absence marker, which
    // would read as "that position is empty".
    if (!xs.isIndexedCollection)
      return ce.error([
        'incompatible-type',
        'indexed_collection',
        xs.type.toString(),
      ]);
    return xs.at(position) ?? absenceMarker(ce, xs);
  }
  if (xs.type.matches('indexed_collection<any>')) return undefined;
  return ce.error([
    'incompatible-type',
    'indexed_collection',
    xs.type.toString(),
  ]);
}

// A point is a tuple (its coordinates are its elements). The `.x`/`.y`/`.z`
// accessors — `PointX`/`PointY`/`PointZ` — extract a coordinate. Unlike
// `First`/`Second`/`Third` (which index a collection and return an *element*),
// they broadcast over a *list of points*, returning the list of coordinates —
// matching Desmos and the threadable `Real`/`Imaginary` accessors. On a single
// point the two coincide (`First` of a 2-tuple is its x-coordinate); on a list
// of points they diverge (`First` returns the first point, not the x-list).
function isPointLike(e: Expression): boolean {
  const t = e.type.type;
  if ((typeof t !== 'string' && t.kind === 'tuple') || e.operator === 'Tuple')
    return true;
  // The list-of-lists spelling of a point list: a row of coordinates. A data
  // import produces `[[0,0],[3,4]]` rather than a list of tuples, and the
  // point accessors have no competing meaning for it — without this, `PointX`
  // fell through to element indexing and returned the first ROW (Tycho item
  // 138). A row is a *numeric* indexed collection: a list of strings, or a
  // list of lists, keeps the First/Second/Third behavior.
  if (e.isFiniteCollection === true && e.isIndexedCollection === true) {
    const elt = collectionElementType(e.type.type);
    if (elt !== undefined && isSubtype(elt, 'number')) return true;
  }
  return false;
}

// True when the operand's declared type says its elements are points (tuples).
// Used to decide how an *empty* collection broadcasts: a declared `list<tuple>`
// with no elements is still a (empty) list of points, so a coordinate accessor
// yields an empty list — matching the JS compiler's `[].map(...)` → `[]`.
function hasPointElementType(xs: Expression): boolean {
  const elt = collectionElementType(xs.type.type);
  return elt !== undefined && typeof elt !== 'string' && elt.kind === 'tuple';
}

// The point arity a TYPE proves, or `undefined` when it proves nothing. A
// tuple node's component count; the inner dimension of a rank ≥ 2 numeric
// tensor (the list-of-lists spelling of a point list, whose rows ARE the
// points); the component count of a collection's tuple element type. A bare
// `tuple`, an `unknown`, a union or an unbound symbol proves nothing.
function staticPointArity(t: Type): number | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'tuple') return t.elements?.length;
  if (t.kind === 'list' && (t.dimensions?.length ?? 0) > 1) {
    const inner = t.dimensions![t.dimensions!.length - 1];
    return inner > 0 ? inner : undefined;
  }
  // NOTE: a rank-1 numeric list is deliberately NOT a point here. `PointX`,
  // `PointY` and `PointZ` element-INDEX such a list (`isPointLike` is false for
  // its scalar elements, so `pointComponentAt` falls to `componentAt`), which
  // is why `PointX([3, 4])` is `3` — element one, not an x-coordinate that
  // happens to agree. `PointZ([7, 8])` is therefore an out-of-range element
  // access carrying the position-preserving marker, exactly like
  // `Third([7, 8])`, and not the item-138 dimension error. Pinned in
  // `tycho-items-130-138.test.ts` ("a 2-element numeric list is NOT a point
  // here").
  const elt = collectionElementType(t);
  if (elt !== undefined && typeof elt !== 'string' && elt.kind === 'tuple')
    return elt.elements?.length;
  return undefined;
}

// The point arity of a CONCRETE (evaluated) operand — the runtime counterpart
// of `staticPointArity`, for the operands whose type was not decisive.
function concretePointArity(e: Expression): number | undefined {
  const t = e.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple')
    return t.elements?.length ?? (isFunction(e) ? e.nops : undefined);
  if (isFunction(e) && e.operator === 'Tuple') return e.nops;
  // A coordinate ROW (the list-of-lists spelling), peeked the same way
  // `pointComponentAt` decides broadcast-vs-index.
  if (isPointLike(e)) return e.count;
  return undefined;
}

// The runtime point arity an accessor application reads: a single point
// (tuple) directly, or — for a collection — the arity of the points it
// broadcasts over, peeked at the first element exactly the way
// `pointComponentAt` decides broadcast-vs-index. `undefined` when the operand
// is not a concrete point or list of points (a list of scalars element-indexes
// like First/Second/Third, and proves nothing about a point arity).
function runtimePointArity(xs: Expression): number | undefined {
  const t = xs.type.type;
  if (
    (typeof t !== 'string' && t.kind === 'tuple') ||
    (isFunction(xs) && xs.operator === 'Tuple')
  )
    return concretePointArity(xs);
  if (xs.isFiniteCollection === true) {
    for (const e of xs.each()) return concretePointArity(e);
  }
  return undefined;
}

// Item 138 clarified ask (2026-08-02): a statically-absent component is a
// TYPE-level fact → a typed error. `PointZ` of a provably 2-D point (or of a
// list/set of provably 2-D points) is `incompatible-dimensions`, not the
// position-preserving absence marker. This REVERSES the 2026-07-22
// NaN-over-Nothing ruling for this case — that ruling weighed marker vs
// `Nothing` and never weighed a typed error. Scope: `PointZ` only; `PointX`/
// `PointY` and 3-D points are untouched.
//
// Like the item-129 `At` multi-index gate, the check proves the mismatch
// POSITIVELY: an `unknown`, unbound, bare-`tuple`, `list<tuple>` or union
// operand proves nothing and stays inert (falling through to the
// evaluate-time check, then to the marker on the compiled route).
function pointArityError(
  ce: ComputeEngine,
  position: number,
  arity: number
): Expression {
  return ce.error(
    'incompatible-dimensions',
    `coordinate ${position} vs ${arity}-dimensional point`
  );
}

// Does a coordinate accessor BROADCAST over `xs` (its elements are points), or
// element-INDEX it like First/Second/Third? The type-level counterpart of the
// decision `pointComponentAt` makes at run time, peeked exactly the same way —
// the FIRST element only, so a large lazy collection is never materialized —
// and falling back to the declared element type for an empty collection, as it
// does. `undefined` when the operand is not a finite collection, where the
// decision cannot be made without evaluating it.
function collectionBroadcastsPoints(xs: Expression): boolean | undefined {
  if (xs.isFiniteCollection !== true) return undefined;
  for (const e of xs.each()) return isPointLike(e);
  return hasPointElementType(xs);
}

// Result type of a point-component accessor: a single point yields the
// coordinate type; a collection of points broadcasts to a collection of
// coordinates.
function pointComponentType(
  xs: Expression,
  position: number,
  typeOverride?: Type
): Type {
  const t = typeOverride ?? xs.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple') {
    const ct = componentType(xs, position, typeOverride);
    // An INFERENCE-PENDING component (`(x, y)` whose symbols get no numeric
    // inference in tuple position types `unknown`) is a coordinate-to-be: point
    // accessors read NUMERIC tuples, and a tuple component is atomic — never a
    // broadcast collection. Fold `unknown` to `number` (mirroring the
    // list-of-points fallback below) so downstream arithmetic doesn't type
    // `broadcastable<…>` and JS-compile plot bodies through `_SYS.bcast`. An
    // explicitly-declared `any` component is left as `any`: folding it would
    // over-claim `number` for a `tuple<any, any>` that may hold non-numeric
    // values.
    if (ct === 'unknown') {
      // Fold only inference-pending SYMBOL/literal components. When `xs` is a
      // literal tuple expression whose component at `position` is a
      // POSSIBLY-collection APPLICATION (`Tuple(h(1), y)` with
      // `h: (number) -> unknown` — `h(1)` may return a list at run time), keep
      // its honest type rather than over-claiming a scalar `number`. A symbol
      // component (`Tuple(x, y)`) is not possibly-collection-typed, so it still
      // folds. When `xs` is a tuple-TYPED symbol (no accessible components — the
      // plot-body case), we can't inspect the operand, so keep the fold.
      if (isFunction(xs) && hasAccessibleComponents(xs)) {
        const comp = xs.ops?.[position - 1];
        if (comp !== undefined && isPossiblyCollectionTyped(comp)) return ct;
      }
      return 'number';
    }
    // A point access is `slotType | marker(slotType)` (§3.C): a coordinate is
    // numeric, so the marker is absorbed (`withMarker(number) = number`); an
    // out-of-band or non-numeric slot gains the marker.
    return withMarker(ct);
  }
  // A list of points broadcasts. The coordinate type is not reliably
  // recoverable (a literal list of tuples is often mis-typed as `vector<n>`
  // with numeric elements), so use `number` — honest for the geometric point
  // case, and it keeps the result an (honest) collection type, not a scalar.
  if (
    typeOverride !== undefined
      ? isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)
      : xs.type.matches('indexed_collection<any>')
  ) {
    // Only a collection whose elements are POINTS broadcasts. One whose
    // elements are scalars element-indexes like First/Second/Third, so the
    // result is a single COMPONENT — the flat point spelling `PointX([3, 4])`
    // included, which `pointComponentAt` answers with the scalar `3`. Reading
    // the decision off the static type alone claimed the broadcast arm for
    // every indexed collection, typing that `vector<2>`.
    if (collectionBroadcastsPoints(xs) === false)
      return componentResultType(xs, position, typeOverride);
    // A rank ≥ 2 numeric tensor is a list of coordinate ROWS: projecting a
    // coordinate drops the inner dimension (`matrix<3x2>` → `vector<3>`).
    // `mapResultType` alone keeps every dimension, so it reported the SOURCE
    // shape for the list-of-lists spelling.
    if (
      typeof t !== 'string' &&
      t.kind === 'list' &&
      (t.dimensions?.length ?? 0) > 1
    )
      return {
        kind: 'list',
        elements: 'number',
        dimensions: [t.dimensions![0]],
      };
    return mapResultType(t, 'number');
  }
  // A NON-INDEXED collection of points broadcasts too — `pointComponentAt`
  // peeks it through `each()` for exactly that reason (a Set of points was
  // once misread as empty). It answers an eager `List` of coordinates, so the
  // result is a list regardless of the source's own collection kind.
  if (collectionBroadcastsPoints(xs) === true)
    return { kind: 'list', elements: 'number' };
  // Non-point-collection fallback follows the First/… row.
  return componentResultType(xs, position, typeOverride);
}

// Project a coordinate straight out of the LAZY point-list transpose form —
// `Map((p1, …, pk) ↦ Tuple(…), s1, …, sk)` as built by `lazyBroadcastMap` for
// a large `PointList` — returning the source collection the projected slot
// binds to. `PointX(PointList(a, b, c))` is then just `a`: no per-element
// Tuple construction and `At` extraction on drain (Tycho item 52). Sound only
// when the slot is a plain parameter reference, every source is an INDEXED
// collection (the lazy-transpose contract — a `Map` over a `Set`, though it
// can look identical, must keep the generic path's indexed-`List` result),
// and every source has the same known count (`Map` zips to the shortest
// source, so projecting one source of a ragged zip would yield extra
// elements). Anything else returns `undefined` and the caller falls through
// to the generic path.
//
// Under `numericApproximation` the projection is returned as its lazy `.N()`
// form: the source itself is the EXACT collection (the transpose body's
// `N(…)` wrap belongs to the whole tuple, and is discarded with it), so
// returning it bare would let `PointX(pts).N()` yield exact elements —
// violating `x.N() ≡ x.evaluate().N()` parity.
function projectLazyPointList(
  xs: Expression,
  position: number,
  numericApproximation: boolean
): Expression | undefined {
  if (!isFunction(xs) || xs.operator !== 'Map' || xs.nops < 2) return undefined;
  const fn = xs.op1;
  if (!isFunction(fn) || fn.operator !== 'Function') return undefined;
  let body = fn.ops[0];
  // The canonical function literal wraps its body in a single-statement
  // `Block`, and `.N()` on the lazy form wraps it in `N(…)` — unwrap both
  // for the match.
  if (isFunction(body) && body.operator === 'Block' && body.nops === 1)
    body = body.ops[0];
  if (isFunction(body) && body.operator === 'N') body = body.ops[0];
  if (!isFunction(body) || body.operator !== 'Tuple') return undefined;
  const slot = body.ops[position - 1];
  if (slot === undefined || !isSymbol(slot)) return undefined;
  const params = fn.ops.slice(1);
  const sources = xs.ops.slice(1);
  // The transpose contract binds parameters one-to-one to sources, each a
  // distinct plain symbol. A user-authored lookalike with extra or duplicate
  // parameter names could otherwise select the wrong source (`findIndex`
  // takes the FIRST duplicate; invocation binds the last) or index past the
  // source list.
  if (params.length !== sources.length) return undefined;
  const names = new Set<string>();
  for (const p of params) {
    if (!isSymbol(p) || names.has(p.symbol)) return undefined;
    names.add(p.symbol);
  }
  const j = params.findIndex((p) => isSymbol(p) && p.symbol === slot.symbol);
  if (j < 0 || j >= sources.length) return undefined;
  if (sources.some((s) => s.isIndexedCollection !== true)) return undefined;
  const counts = sources.map((s) => s.count);
  if (counts.some((c) => c === undefined || c !== counts[0])) return undefined;
  // `.N()` on a lazy `Map` source stays lazy (the N-wrap threads into its
  // mapping body — Tycho items 39/40); a literal `List` source floats
  // element-wise, which is the correct eager behavior at that size.
  return numericApproximation ? sources[j].N() : sources[j];
}

// Evaluate a point-component accessor, broadcasting the coordinate over a list
// of points. We inspect the actual elements (not the declared element type,
// which is unreliable for a literal list of points) to decide whether to
// broadcast; a collection whose elements are not points falls back to the
// `First`/`Second`/`Third` element-indexing behavior.
function pointComponentAt(
  xs: Expression,
  position: number,
  ce: ComputeEngine,
  numericApproximation = false
): Expression | undefined {
  // A single point (tuple): the coordinate.
  const t = xs.type.type;
  if (typeof t !== 'string' && t.kind === 'tuple')
    return componentAt(xs, position, ce);

  // A finite collection: decide broadcast-vs-index WITHOUT materializing the
  // whole collection. A large lazy `Range` is finite, so enumerating every
  // element just to test point-ness would hang (the case the `validate.ts`
  // guard also protects against). Peek at the first element only: if it is a
  // point, broadcast the coordinate element-wise; otherwise fall back to O(1)
  // element indexing, like First/Second/Third.
  if (xs.isFiniteCollection) {
    // Projection fast-path over the lazy transpose form (see
    // `projectLazyPointList`).
    const projected = projectLazyPointList(xs, position, numericApproximation);
    if (projected !== undefined) return projected;
    // Peek via `each()` rather than `at(1)`: a non-indexed collection (a `Set`)
    // has no `at()`, so `at(1)` is `undefined` and a non-empty Set of points
    // was misread as empty (→ a silently-wrong `[]`). `each()` yields the first
    // element for indexed and non-indexed collections alike, and taking just
    // one element keeps the peek O(1) (no materialization of a large domain).
    let first: Expression | undefined;
    for (const e of xs.each()) {
      first = e;
      break;
    }
    if (first !== undefined) {
      if (isPointLike(first)) {
        // Hybrid laziness (Tycho item 52): past the eager threshold — or for
        // an indexed collection of unknown size — return the lazy projection
        // `Map(p ↦ At(p, position), xs)` instead of materializing every
        // coordinate. At or below the threshold the eager `List` is built
        // unchanged, so small point lists stay byte-identical.
        const n = xs.count;
        if (
          xs.isIndexedCollection === true &&
          (n === undefined || n > MAX_SIZE_EAGER_COLLECTION)
        )
          return lazyBroadcastMap(
            ce,
            'At',
            [xs, ce.number(position)],
            (x) => x === xs,
            numericApproximation
          );
        // Build with `ce.function`, keeping the full canonicalization pass:
        // its tensor typing is what makes a numeric coordinate list a
        // rank-1 tensor value (tensor-only consumers like `MatrixMultiply`
        // rely on it). The pass is O(n), but this eager branch only runs at
        // or below `MAX_SIZE_EAGER_COLLECTION` (or for non-indexed sources),
        // so the cost is bounded — the large-list case took the lazy arm
        // above (Tycho item 52).
        // A point with no such coordinate (a `z` on a 2D point) is an
        // OUT-OF-BAND access: it contributes the position-preserving marker.
        // `Nothing` would erase the slot and misalign the coordinate list
        // against the point list it was derived from.
        const comps: Expression[] = [];
        for (const e of xs.each())
          comps.push(e.at(position) ?? absenceMarker(ce, e));
        return ce.function('List', comps);
      }
      // Elements are not points → element indexing, like First/Second/Third.
      return componentAt(xs, position, ce);
    }
    // Empty collection: if the declared element type is a point, broadcast to
    // an empty list (matching the JS compiler's `[].map(...)` → `[]`);
    // otherwise index (→ Nothing), like First/Second/Third on an empty list.
    if (hasPointElementType(xs)) return ce.function('List', []);
    return componentAt(xs, position, ce);
  }

  // Symbolic / non-finite operand: stay symbolic (or error) like componentAt.
  return componentAt(xs, position, ce);
}

// @todo: future thoughts. Consider
// - operations from the Scala library, which is particularly well designed:
//    - https://scala-lang.org/api/3.3.1/scala/language$.html#
//    - https://superruzafa.github.io/visual-scala-reference//
// - Scala/Breeze universal functions:
//     https://github.com/scalanlp/breeze/wiki/Universal-Functions
// See also Julia:
//    - https://docs.julialang.org/en/v1/base/iterators/

// • Permutations()
// •	Append()
// •	Prepend()
// •	Partition()
// • Apply(expr, n) -> if head of expr has a at handler, use it to access an element

// • Keys: { domain: 'Functions' },
// • Entries: { domain: 'Functions' },
// • cons -> cons(first (element), rest (list)) = list
// • append -> append(list, list) -> list
// • in
// • such-that {x ∈ Z | x ≥ 0 ∧ x < 100 ∧ x 2 ∈ Z}

// TakeDiagonal(matrix) -> [matrix[1, 1], matrix[2, 2], ...]

// Diagonal(list) -> [[list[1, 1], 0, 0], [0, list[2, 2], 0], ...]

export const COLLECTIONS_LIBRARY: SymbolDefinitions = {
  //
  // Data Structures
  //
  List: {
    description: 'An ordered collection of elements (a list).',
    // A pure container: it STORES its operands, and no position ever invokes
    // a function-valued one (`List(randomF)` is pure to build). See the
    // `invokes` metadata in `docs/EFFECTS-MODEL.md`.
    invokes: false,
    complexity: 8200,

    signature: '(any*) -> list',
    type: (ops, { engine: _ce }) =>
      shapedListType(ops) ?? {
        kind: 'list',
        elements: BoxedType.widen(...ops.map((op) => op.type)).type,
      },
    canonical: canonicalList,
    lazy: true,
    evaluate: (ops, { engine, numericApproximation, materialization }) => {
      // Eager materialization: flatten and materialize lazy sub-collections.
      if (materialization) {
        return engine._fn(
          'List',
          // `Nothing` is an ERASURE marker: an element that *evaluates* to
          // `Nothing` is spliced out (`enlist` already drops syntactic ones).
          enlist(ops)
            .map((op) => op.evaluate({ numericApproximation, materialization }))
            .filter((op) => !isSymbol(op, 'Nothing'))
        );
      }
      // A collection literal evaluates its elements (unlike lazy operators,
      // which keep late binding). Fast path: a list whose elements are all
      // already fully-evaluated literals is returned unchanged, avoiding an
      // O(n) rebuild for large numeric lists.
      if (
        ops.every((op) => isEvaluatedElement(op, numericApproximation ?? false))
      )
        return undefined;
      return engine.function(
        'List',
        ops
          .map((op) => op.evaluate({ numericApproximation, materialization }))
          .filter((op) => !isSymbol(op, 'Nothing'))
      );
    },
    eq: defaultCollectionEq,
    collection: basicIndexedCollectionHandlers(),
  } as OperatorDefinition,

  // Extensional set. Elements do not repeat. The order of the elements is not significant.
  // For intensional set, use `Filter` with a condition, e.g. `Filter(RealNumbers, _ > 0)`
  //
  // A `Set` expression can also be a set-builder (comprehension), e.g.
  // `["Set", body, ["Element", k, domain, cond?]]` or
  // `["Set", body, ["Condition", ...]]` (see `parseSetComprehension()`).
  // Comprehensions are not literal 2-element sets: their elements are the
  // substituted bodies over the (filtered) domain.
  Set: {
    description: 'An unordered collection of distinct elements (a set).',
    // A pure container: it STORES its operands, and no position ever invokes
    // a function-valued one (`List(randomF)` is pure to build). See the
    // `invokes` metadata in `docs/EFFECTS-MODEL.md`.
    invokes: false,
    complexity: 8200,

    signature: '(any*) -> set',
    type: (ops, { engine: _ce }) => {
      // A comprehension's element type is not the type of its syntactic
      // operands (body + indexing set)
      if (parseSetComprehension(ops) !== null) return parseType('set');
      return {
        kind: 'set',
        elements: BoxedType.widen(...ops.map((op) => op.type)).type,
      };
    },

    canonical: canonicalSet,
    // The `lazy` flag suppresses the default operand evaluation: evaluating
    // the operands of a comprehension would mangle its indexing set (e.g.
    // the condition `gcd(n,k) = 1` with a free `k` evaluates to `False`).
    // Literal elements are evaluated explicitly in the `evaluate` handler.
    lazy: true,
    evaluate: (ops, { engine: ce, numericApproximation, materialization }) => {
      const comp = parseSetComprehension(ops);
      if (comp !== null) {
        // Materialize the comprehension as a literal set if the (filtered)
        // domain is enumerable and small enough; otherwise stay symbolic.
        const elements = enumerateSetComprehension(comp);
        if (
          elements === undefined ||
          elements.length > MAX_SIZE_EAGER_COLLECTION
        )
          return undefined;
        return ce.function('Set', elements);
      }
      // Literal set: evaluate each element (matches the default, non-lazy
      // evaluation behavior this operator had before it was marked lazy)
      return ce.function(
        'Set',
        ops.map((op) => op.evaluate({ numericApproximation, materialization }))
      );
    },
    eq: (a: Expression, b: Expression) => {
      // `b` may be an unevaluated set-valued expression (`Intersection(…)`,
      // `Union(…)`, a symbol assigned a set…): decline so `eq()` in
      // compare.ts can evaluate both sides and re-consult. A value whose
      // type cannot be a set is definitively unequal.
      if (a.operator !== b.operator)
        return b.type.matches('set<any>') ? undefined : false;
      if (!isFunction(a) || !isFunction(b)) return false;
      if (a.nops !== b.nops) return false;
      // The elements are not indexed
      const has: (x: Expression) => boolean = (x) =>
        b.ops.some((y) => x.isSame(y));
      return a.ops.every(has);
    },
    collection: {
      ...SET_BASE_HANDLERS,
      // A set is not indexable
      at: undefined,
      indexWhere: undefined,
      // A comprehension computes its elements on demand
      isLazy: (expr) =>
        isFunction(expr) && parseSetComprehension(expr.ops) !== null,
      count: (expr) => {
        if (!isFunction(expr)) return 0;
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return expr.nops;
        // Cardinality of the comprehension: number of distinct substituted
        // bodies. Symbolic or infinite domains are not enumerable: undefined.
        return enumerateSetComprehension(comp)?.length;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return true;
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return expr.nops === 0;
        const elements = enumerateSetComprehension(comp);
        return elements === undefined ? undefined : elements.length === 0;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return true;
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return true;
        if (enumerateSetComprehension(comp) !== undefined) return true;
        // A comprehension over a finite domain is finite even when it cannot
        // be enumerated. The converse doesn't hold: a condition may filter an
        // infinite domain down to a finite set, so otherwise we can't tell.
        if (comp.domain?.isFiniteCollection === true) return true;
        return undefined;
      },
      iterator: (expr) => {
        if (!isFunction(expr)) return SET_BASE_HANDLERS.iterator(expr);
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return SET_BASE_HANDLERS.iterator(expr);
        const elements = enumerateSetComprehension(comp);
        // Non-enumerable comprehension: no iterator (`each()` yields nothing;
        // consumers should check `isFinite`/`count` first, e.g. `Reduce`)
        if (elements === undefined) return undefined;
        let i = 0;
        return {
          next: () =>
            i >= elements.length
              ? { value: undefined, done: true as const }
              : { value: elements[i++], done: false as const },
        };
      },
      // Three-valued membership: `true` when an element matches, `false`
      // only when every element is definitively different from `target`
      // (concrete values), `undefined` otherwise — e.g. a symbolic target
      // (`Element(ω, {-1, 1})`) is indeterminate, not refuted.
      contains: (expr, target) => {
        if (!isFunction(expr)) return undefined;
        const comp = parseSetComprehension(expr.ops);
        if (comp !== null) return setComprehensionContains(comp, target);
        return literalSetContains(expr.ops, target);
      },
      elttype: (expr) => {
        if (!isFunction(expr)) return SET_BASE_HANDLERS.elttype!(expr);
        const comp = parseSetComprehension(expr.ops);
        if (comp === null) return SET_BASE_HANDLERS.elttype!(expr);
        const elements = enumerateSetComprehension(comp);
        if (elements === undefined || elements.length === 0) return 'unknown';
        return widen(...elements.map((op) => op.type.type));
      },
    },
  } as OperatorDefinition,

  Length: {
    description:
      'Number of elements in a collection. Returns undefined for non-collections and for infinite collections.',
    keywords: ['size'],
    complexity: 4000,
    signature: '(any) -> integer',
    type: () => 'integer' as Type,
    // Peek through count-preserving wrappers so an eager Sort/RandomShuffle isn't
    // materialized just to read a length (see `peekCountPreserving`).
    canonical: (ops, { engine: ce }) => {
      // Run the framework's default flatten step (Sequence-splice + Nothing-
      // drop) that this custom canonical handler would otherwise short-circuit.
      ops = flatten(ops);
      const stripped = withFirst(peekCountPreserving(ops[0]), ops);
      // The declared parameter is `any` — deliberately tolerant, so
      // `Length(5)` stays symbolic instead of erroring — which means
      // validation contributes no type inference. Yet `Length(x)` on a
      // not-yet-typed symbol is collection evidence in the same way `x[i]`
      // is: narrow it, so a function parameter whose only use is
      // `Length(cs)` types as a collection (and the lambda auto-broadcast
      // then binds a collection argument whole instead of mapping over it).
      const target = stripped[0];
      if (
        target !== undefined &&
        isSymbol(target) &&
        target.valueDefinition?.inferredType &&
        target.type.type === 'unknown'
      )
        target._infer('collection', 'narrow');
      const adjusted = validateArguments(
        ce,
        stripped,
        LENGTH_SIGNATURE,
        false,
        false
      );
      return ce._fn('Length', adjusted ?? stripped);
    },
    evaluate: ([xs], { engine }) => {
      // Guard non-collection inputs (e.g. Length(5), Length(x+y)).
      if (!xs.isCollection) return undefined;
      // `count` is asked FIRST and `isEmptyCollection` only as its fallback.
      // Both facets walk a lazy collection — `Filter.count` to the end,
      // `Filter.isEmpty` to the first match — so asking emptiness first ran
      // the predicate callback once more than there are elements, which
      // mutation makes observable. `count` alone already answers 0 for an
      // empty collection; emptiness is consulted only for a collection that
      // knows it is empty without knowing its size.
      const n = xs.count;
      // Guard infinite collections (e.g. Length(Repeat(5))).
      if (n === undefined || !isFinite(n))
        return xs.isEmptyCollection ? engine.Zero : undefined;
      return engine.number(n);
    },
  },

  Tuple: {
    description: 'A fixed number of heterogeneous elements',
    // A pure container: it STORES its operands, and no position ever invokes
    // a function-valued one (`List(randomF)` is pure to build). See the
    // `invokes` metadata in `docs/EFFECTS-MODEL.md`.
    invokes: false,
    complexity: 8200,
    signature: '(any*) -> tuple',
    type: (ops) => tupleTypeOf(ops),
    // Run the framework's default flatten step, which a custom `canonical`
    // handler would otherwise short-circuit. It does two things here, and
    // both change the ARITY (and therefore the type) of the tuple:
    //
    // - `Sequence` is SPLICED into the operand list: `(1, Sequence(2, 3), 4)`
    //   is the 4-tuple `(1, 2, 3, 4)`, not a 3-tuple holding a pair. A
    //   `Sequence` is the engine-wide "these operands, inlined here" marker,
    //   so a collection literal must never store one as an element.
    // - `Nothing` is ERASED: `(1, Nothing, 3)` is the 2-tuple `(1, 3)`. Use
    //   `Missing` for an absent-but-positioned coordinate.
    //
    // `engine.tuple` filters `Nothing` on its own but does NOT splice
    // `Sequence`, so the flatten call is load-bearing, not decorative.
    canonical: (ops, { engine }) => engine.tuple(...flatten(ops)),
    // A `Tuple` is inert data: it evaluates its operands but never transposes a
    // collection component into a list of points. The Desmos point-list idiom
    // (zip a tuple-with-collection into a `List` of point-tuples) lives in the
    // explicit `PointList` operator that importers emit; plain tuples stay data.
    eq: defaultCollectionEq,
    collection: {
      ...basicIndexedCollectionHandlers(),
      keys: (_expr: Expression) => {
        return ['first', 'second', 'last'];
      },
    },
  } as OperatorDefinition,

  // The Desmos point-list surface form. Explicit: importers emit it, default
  // parsing NEVER produces it from `(a, b)` (that stays an inert `Tuple`). A
  // `PointList` with one or more finite-collection components transposes to
  // the list of point-tuples (zip-to-shortest, scalars broadcast) — e.g.
  // `PointList(-6, n)` with `n` a 21-element list is 21 points. The transpose
  // is HYBRID-lazy (Tycho item 52): at or below `MAX_SIZE_EAGER_COLLECTION`
  // it is an eager `List` of `Tuple`s; past the threshold it is the lazy
  // `Map` form (consumable via `at`/`each`/`count`). Note a large
  // MULTI-collection `PointList` evaluated first and THEN compiled is a
  // multi-source `Map`, which the JS/Python compile targets reject — compile
  // the canonical `PointList` form (its own compile handler) instead. With
  // no collection component it is just a plain point (`Tuple`). An empty
  // collection component yields an empty `List`; an infinite/unknown-length
  // component fails closed (stays inert, no hang) via
  // `broadcastOverIndexedCollections` returning `undefined`.
  //
  // Compile handler: when no component is provably non-scalar (a subtype of
  // `collection`), a `PointList` is a plain point and compiles
  // byte-identically to the equivalent `Tuple(...)` on each target — a JS array
  // on the `javascript` target, a `vecN`/`float[N]` on `glsl` (and `vecNf`/
  // `array<f32,N>` on `wgsl`). This includes free plot variables (typed
  // `unknown`), which the compile model treats as numeric parameters exactly as
  // `Tuple` does. That all-scalar path lives HERE, on every language.
  //
  // Any other shape is the TARGET's business. On `javascript` the handler
  // declines by fall-through (returns `undefined`, which runs BEFORE
  // `target.functions` — Tycho item 109a mechanics) so the zip lowering in
  // `JAVASCRIPT_FUNCTIONS.PointList` takes over: a list of points IS an
  // expression-level value on JS (nested arrays), so a `PointList` with one or
  // more list SOURCES compiles to an IIFE zip (shortest-zip, scalars
  // broadcast), and the shapes that still have no lowering throw from there
  // with a per-component diagnostic. On every other language (`glsl`, `wgsl`,
  // `python`) a provably non-scalar component keeps failing closed here, and
  // `interval-javascript` (no `Tuple` lowering at all) keeps returning
  // `undefined`.
  //
  // The retained declines are DELIBERATELY NARROWER THAN THE TYPING: the type
  // handler answers `list<tuple>` whenever ≥1 component is a list source,
  // whatever the other components are — but a non-source, non-scalar slot
  // (tuple/set/map, or a union with a collection member) has no statically
  // known PER-POINT representation, so lowering it would splice a whole
  // aggregate into every point. Lowering narrower than typing is intended.
  // See `docs/plans/2026-07-31-pointlist-compile-design.md` § Shared predicate.
  PointList: {
    description:
      'A list of points: zips collection components into a List of point-tuples (Desmos point-list idiom); a plain point when no component is a collection.',
    complexity: 8200,
    signature: '(any+) -> any',
    type: (ops) => {
      // A list component (for typing): an indexed-collection type that is not
      // itself a tuple. Mirrors the `evaluate` predicate, but type-based.
      const isListType = (op: Expression): boolean => {
        const t = op.type.type;
        const isTupleKind = typeof t !== 'string' && t.kind === 'tuple';
        // A string is an indexed collection of characters, but it is ATOMIC
        // here for the same reason a tuple is: `PointList("ab", …)` must treat
        // the string as one component, not zip over its grapheme clusters.
        // The `evaluate` predicate (`isFiniteBroadcastParticipant`) excludes
        // strings too, so type and value stay in agreement.
        if (t === 'string') return false;
        return !isTupleKind && op.type.matches('indexed_collection<any>');
      };
      if (ops.some(isListType)) return parseType('list<tuple>');
      return tupleTypeOf(ops);
    },
    evaluate: (ops, { engine: ce, numericApproximation }) => {
      const isListComponent = (op: Expression): boolean =>
        isFiniteBroadcastParticipant(op);
      // Fail closed on a collection component that cannot be safely zipped —
      // infinite or unknown-length (e.g. `Range(1,∞)`) or non-indexed (a
      // Set): stay inert rather than silently degrading to a plain point.
      if (
        ops.some(
          (op) => !isTuple(op) && op.isCollection && !isListComponent(op)
        )
      )
        return undefined;
      // No collection component: a plain point.
      if (!ops.some(isListComponent)) return ce.tuple(...ops);
      // Otherwise transpose into the `List` of point-tuples. Hybrid laziness
      // (Tycho item 52): at or below `MAX_SIZE_EAGER_COLLECTION` the eager
      // `List<Tuple>` shape is built unchanged (the consumer contract for
      // small point lists); past it, the transpose is the lazy `Map` form —
      // consumable via `at`/`each`/`count` — so a large point list is no
      // longer materialized (and re-materialized per coordinate projection).
      // `strictLengths: false` — `PointList` ZIPS its components rather than
      // broadcasting an operator over them: it is in the explicit-pairing
      // family (`Zip`, the variadic `Map`), whose length is DEFINED as the
      // shortest input, and its shortest-zip is a ratified consumer contract
      // (Tycho item 52): `PointList([1,2,3],[10,20])` is two points, and a
      // ragged lazy transpose projects to the shorter length. The
      // length-mismatch ruling governs lifted-operator broadcasts, not
      // pairing constructors — see `docs/BROADCAST-MODEL.md` (ruling
      // 2026-07-27).
      return broadcastOverIndexedCollections(
        ce,
        'Tuple',
        ops,
        numericApproximation ?? false,
        true,
        false
      );
    },
    // No `eq` handler: a definitive structural comparison would make
    // `PointList(1,2)` unequal to the `Tuple(1,2)` it evaluates to; the
    // generic compare path evaluates both sides instead.
    compile: (args, compile, { language }) => {
      // Fail closed only for a *provably non-scalar* component — one whose
      // type (or any member of a union) is a subtype of `collection` (a list,
      // set, tuple, map, …). Everything else — `unknown`, `value`, and every
      // numeric type — is a scalar slot that `Tuple` compiles as
      // `compile(component)`, so it passes here too. This matters for the
      // load-bearing case: a per-pixel body is parsed LaTeX with *free* plot
      // variables, which type as `unknown`; the compile model treats free
      // unknown symbols as numeric parameters, and `Tuple(x, y)` compiles them
      // as scalar slots, so `PointList(x, y)` must as well. A non-scalar
      // component returns `undefined` → default compilation, which has no
      // `PointList` lowering and reports it as uncompilable (fail closed).
      const isProvablyNonScalar = (t: Type): boolean => {
        if (typeof t !== 'string' && t.kind === 'union')
          return t.types.some(isProvablyNonScalar);
        // A STRING is a subtype of `collection` (its elements are its grapheme
        // clusters) but occupies a SCALAR slot here: it lowers to one target
        // string, exactly as `Tuple` compiles it, and the runtime `PointList`
        // treats a string component atomically for the same reason
        // (`isFiniteBroadcastParticipant` excludes strings).
        if (t === 'string') return false;
        return isSubtype(t, COLLECTION_SHAPE_TYPE);
      };
      const nonScalar = args.findIndex((a) => isProvablyNonScalar(a.type.type));
      if (nonScalar >= 0) {
        // On `javascript`, every non-all-scalar shape is lowered (or declined,
        // with its own diagnostic) by `JAVASCRIPT_FUNCTIONS.PointList`: a list
        // of points is an expression-level value there. Decline by
        // fall-through so the target table is consulted.
        if (language === 'javascript') return undefined;
        // The decline is about the operand SHAPE, not the head: say so, rather
        // than falling through to a generic "no lowering" (which reads as if
        // `PointList` were unsupported on the target — Tycho item 109a). Only
        // for the languages this handler otherwise lowers: on any other
        // language the handler has no opinion and must fall through, so a
        // custom target can still map `PointList` itself.
        if (POINT_LIST_COMPILE_LANGUAGES.has(language))
          throw new Error(
            `PointList: cannot compile — component ${nonScalar + 1} is ` +
              `collection-valued (type \`${args[nonScalar].type.toString()}\`), ` +
              `and a point value on target '${language}' has scalar components ` +
              `only. A list of points is not an expression-level value here: ` +
              `project the components (\`PointX\`/\`PointY\`) or evaluate it in ` +
              `the interpreter. Fail closed (D6).`
          );
        return undefined;
      }
      // Emit byte-identically to the equivalent `Tuple(...)`. Targets with no
      // `Tuple` lowering (`interval-javascript`) are not enumerated, so
      // `PointList` fails closed there too — matching `Tuple`.
      const parts = args.map((a) => compile(a));
      if (language === 'javascript') return `[${parts.join(', ')}]`;
      if (language === 'python') return `(${parts.join(', ')})`;
      if (language === 'glsl' || language === 'wgsl') {
        const suffix = language === 'wgsl' ? 'f' : '';
        if (parts.length >= 2 && parts.length <= 4)
          return `vec${parts.length}${suffix}(${parts.join(', ')})`;
        const arrayType =
          language === 'wgsl'
            ? `array<f32, ${parts.length}>`
            : `float[${parts.length}]`;
        return `${arrayType}(${parts.join(', ')})`;
      }
      return undefined;
    },
  } as OperatorDefinition,

  KeyValuePair: {
    description: 'A key/value pair',
    // A pure container: it STORES its operands, and no position ever invokes
    // a function-valued one (`List(randomF)` is pure to build). See the
    // `invokes` metadata in `docs/EFFECTS-MODEL.md`.
    invokes: false,
    complexity: 8200,
    signature: '(key: string, value: T) -> tuple<string, T> where T',

    canonical: (args, { engine }) => {
      const [key, value] = checkTypes(engine, args, ['string', 'any']);
      if (!key.isValid || !value.isValid)
        return engine._fn('KeyValuePair', [key, value]);
      // POSITIONAL pair: `_fn`, not `tuple()` — see `BoxedDictionary.each()`.
      // A `Nothing` value must not be spliced out (it would unpair the entry).
      return engine._fn('Tuple', [key, value]);
    },
  },

  Dictionary: {
    description:
      'A collection of key -> value entries with string keys (`{x -> 1, y -> 2}` in Epsil).',
    // Boxing intercepts `["Dictionary", …]` structurally and constructs the
    // dictionary VALUE directly (`box.ts`), BEFORE definition lookup — so no
    // handler on this definition ever runs. It exists so `Dictionary` is a
    // KNOWN operator: introspection (`ce.operatorInfo`), the Epsil
    // unknown-function lint, and the generated operator inventory all key on
    // a definition's existence, and the name genuinely appears in MathJSON —
    // a dictionary with an unevaluated-expression entry serializes in this
    // operator form rather than the plain-data `{dict: …}` shorthand (see
    // `BoxedDictionary.json`).
    invokes: false,
    lazy: true,
    complexity: 8200,
    signature: '(tuple<string, unknown>*) -> dictionary',
    // The ONLY case that reaches this handler is a literal with a `Spread`
    // entry — the dictionary MERGE `{-> , ...d, "k" -> v}` (Epsil) or
    // `["Dictionary", ["Spread", "d"], …]` (MathJSON): boxing's structural
    // interception is gated on the absence of `Spread` operands (box.ts)
    // exactly so the merge lowering can run here. Lowered to
    // `DictionaryFrom(Join(segments…))`: literal entries become lists of
    // positional `(key, value)` pairs, a spread segment contributes its
    // entries via `ListFrom` (a dictionary is a collection of pairs), and
    // `DictionaryFrom` is LAST-wins on key collisions — so a later entry or
    // spread overrides an earlier one, the merge idiom
    // (`{-> , ...defaults, "verbose" -> True}`). Duplicate LITERAL keys keep
    // the literal convention instead (ruled 2026-08-14): FIRST wins, later
    // duplicates are dropped here (the Epsil parser also diagnoses them).
    canonical: (ops, { engine: ce }) => {
      if (!ops.some((op) => isFunction(op, 'Spread') && op.nops === 1))
        return null;
      const segments: Expression[] = [];
      let run: Expression[] = [];
      const flushRun = () => {
        if (run.length > 0) {
          segments.push(ce._fn('List', run));
          run = [];
        }
      };
      const seenLiteralKeys = new Set<string>();
      for (const op of ops) {
        if (isFunction(op, 'Spread') && op.nops === 1) {
          const x = op.ops[0].canonical;
          // Tuples do not spread (they are units; a pair is a tuple). A
          // dictionary has no error CELL to freeze into — entries are
          // pairs — so the whole literal collapses to the error.
          if (isFunction(x, 'Tuple') || x.type.matches('tuple'))
            return ce.error(['spread-tuple'], x.toString());
          flushRun();
          segments.push(ce._fn('ListFrom', [x]));
          // First-wins covers only literal duplicates NOT separated by a
          // spread: a literal key REAPPEARING after a spread is the
          // documented override idiom (`{"a" -> 1, ...d, "a" -> 2}` → 2),
          // resolved by the merge's last-wins, not dropped as a typo.
          seenLiteralKeys.clear();
          continue;
        }
        // A literal entry: `KeyValuePair` (the Epsil spelling) or a
        // positional pair `Tuple` (the MathJSON spelling). Both normalize
        // to the positional pair `BoxedDictionary` stores.
        const e = op.canonical;
        if (
          (isFunction(e, 'KeyValuePair') || isFunction(e, 'Tuple')) &&
          e.nops === 2
        ) {
          // A bare-SYMBOL key is accepted on the plain (no-spread) route —
          // `BoxedDictionary` reads `key.symbol` — so normalize it to the
          // string `DictionaryFrom` requires; a spread elsewhere in the
          // literal must not change which keys are legal.
          const key = isSymbol(e.op1) ? ce.string(e.op1.symbol) : e.op1;
          const keyName = isString(key) ? key.string : undefined;
          if (keyName !== undefined) {
            if (seenLiteralKeys.has(keyName)) continue; // literal dup: first wins
            seenLiteralKeys.add(keyName);
          }
          run.push(ce._fn('Tuple', [key, e.op2]));
        } else if (!isSymbol(e, 'Nothing')) {
          run.push(e); // let `DictionaryFrom` report the malformed entry
        }
      }
      flushRun();
      return ce._fn('DictionaryFrom', [ce._fn('Join', segments)]);
    },
  },

  Keys: {
    description: 'Return a list of the keys of a dictionary.',
    complexity: 8200,
    signature: '(dictionary<any>) -> list<string>',
    type: () => parseType('list<string>'),
    // Complete precondition: the evaluate guard (`isDictionary`) is the
    // handler's only decline — see `canEnumerate` (types-definitions.ts).
    canEnumerate: (expr) =>
      isFunction(expr)
        ? canEnumerateOperand(expr.op1, isDictionary)
        : undefined,
    evaluate: ([dict], { engine: ce }) => {
      if (!isDictionary(dict)) return undefined;
      // Iteration order matches `each()` (both enumerate the underlying
      // key/value record in insertion order), so `Keys`, `Values` and
      // `for kv in d` agree.
      return ce.function(
        'List',
        dict.keys.map((k) => ce.string(k))
      );
    },
  },

  Values: {
    description: 'Return a list of the values of a dictionary.',
    complexity: 8200,
    signature: '(dictionary<any>) -> list',
    type: ([dict]) => {
      const t = dict.type.type;
      if (typeof t === 'object' && t.kind === 'dictionary')
        return { kind: 'list', elements: t.values };
      if (typeof t === 'object' && t.kind === 'record')
        return { kind: 'list', elements: widen(...Object.values(t.elements)) };
      return parseType('list<any>');
    },
    // Complete precondition — see `Keys`.
    canEnumerate: (expr) =>
      isFunction(expr)
        ? canEnumerateOperand(expr.op1, isDictionary)
        : undefined,
    evaluate: ([dict], { engine: ce }) => {
      if (!isDictionary(dict)) return undefined;
      // Same insertion order as `Keys` and `each()`.
      return ce.function('List', dict.values);
    },
  },

  Single: {
    description: 'A tuple with a single element',
    // A pure container: it STORES its operands, and no position ever invokes
    // a function-valued one (`List(randomF)` is pure to build). See the
    // `invokes` metadata in `docs/EFFECTS-MODEL.md`.
    invokes: false,
    complexity: 8200,
    signature: '(value: T) -> tuple<T> where T',
    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 1)),
  },

  Pair: {
    description: 'A tuple of two elements',
    // A pure container: it STORES its operands, and no position ever invokes
    // a function-valued one (`List(randomF)` is pure to build). See the
    // `invokes` metadata in `docs/EFFECTS-MODEL.md`.
    invokes: false,
    complexity: 8200,
    signature: '(first: T, second: U) -> tuple<T, U> where T, U',
    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 2)),
  },

  Triple: {
    description: 'A tuple of three elements',
    // A pure container: it STORES its operands, and no position ever invokes
    // a function-valued one (`List(randomF)` is pure to build). See the
    // `invokes` metadata in `docs/EFFECTS-MODEL.md`.
    invokes: false,
    complexity: 8200,
    signature:
      '(first: T, second: U, third: V) -> tuple<T, U, V> where T, U, V',

    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 3)),
  },

  //
  // Numeric Collections
  //

  Range: {
    description:
      'A sequence of numbers from a start to an end value with an optional step.',
    complexity: 8200,
    signature: '(number, number?, step: number?) -> indexed_collection<number>',

    type: (ops) => {
      // ops: [lower, upper?, step?]
      // An INDEX SPAN — the `range` type — when the operands prove the value
      // is a contiguous ascending run of valid 1-based indices; see
      // `isIndexSpan` and `docs/STRING_ROADMAP.md` ("The `range` type").
      // This is a NARROWING of the two results below, never a widening:
      // `range <: indexed_collection<integer>`.
      if (isIndexSpan(ops)) return 'range';
      // The element type is integer iff every present operand is integer-
      // valued. Range(0.5, 2.5) iterates 0.5, 1.5, 2.5 — number, not integer.
      const allInt = ops.every((op) => op.isInteger);
      return allInt
        ? parseType('indexed_collection<integer>')
        : parseType('indexed_collection<number>');
    },

    canonical: (ops, { engine: ce }) => {
      if (ops.length === 0) return null;
      if (ops.length === 1) return ce._fn('Range', [ce.One, ops[0].canonical]);
      if (ops.length === 2)
        return ce._fn('Range', [ops[0].canonical, ops[1].canonical]);

      // We have a range with a step. The step may be an expression — the
      // LaTeX two-sample fusion hands us `Subtract(s1, s0)` — and folding it
      // here is what keeps a decimal progression exact (`1.016 - 1.008` must
      // become `0.008`, not the float-dust `0.008000000000000007`).
      //
      // But evaluating DEREFERENCES an assigned symbol, which bakes a value
      // into the canonical form. A step built over a document constant
      // (`[1+4/d, 1+8/d...5]` with `d := 500`) would freeze `1/125`, so
      // re-assigning `d` moved the range's START while its STEP stayed at the
      // old spacing — a silently wrong range, not a stale one. Only fold a
      // step whose every symbol is a CONSTANT: `Pi/4` folds as before,
      // `4/d` stays symbolic and re-evaluates per use (`Range` has supported
      // symbolic bounds and steps since Tycho item 117).
      const step = ops[2].canonical;
      const foldable = step.symbols.every((name) => {
        const def = ce.lookupDefinition(name);
        return (
          def !== undefined && 'value' in def && def.value?.isConstant === true
        );
      });
      return ce._fn('Range', [
        ops[0].canonical,
        ops[1].canonical,
        foldable ? step.evaluate() : step,
      ]);
    },

    eq: (a: Expression, b: Expression) => {
      // Decline on operator mismatch when `b` could still evaluate to a
      // range (e.g. a symbol assigned a `Range`) — `eq()` in compare.ts
      // evaluates both sides and re-consults.
      if (a.operator !== b.operator)
        return b.type.matches('indexed_collection<any>') ? undefined : false;
      // Symbolic bounds (e.g. Range(1, n)): `range()` coerces them to 1, so
      // the numeric comparison below would equate every symbolic range
      // (Range(1, n) = Range(1, m) → true). Compare structurally instead;
      // structurally different symbolic ranges are indeterminate.
      if (hasSymbolicRangeBounds(a) || hasSymbolicRangeBounds(b)) {
        if (!isFunction(a) || !isFunction(b) || a.nops !== b.nops)
          return undefined;
        return a.ops.every((op, i) => op.isSame(b.ops[i])) ? true : undefined;
      }
      const [al, au, as] = range(a);
      const [bl, bu, bs] = range(b);
      return al === bl && au === bu && as === bs;
    },

    collection: {
      isEnumerable: (expr) => !hasSymbolicRangeBounds(expr),
      isLazy: (_expr) => true,
      count: (expr) => {
        // Symbolic bounds (e.g. Range(1, n)): the count is indeterminate —
        // `range()` would coerce the bound to 1 and report a count of 1.
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);
        if (step === 0) return 0;
        if (!isFinite(lower) || !isFinite(upper)) return Infinity;
        // Math.max guards a sign-mismatched step (e.g. Range(5, 1, 1)) from
        // returning a positive count. The +1 must be inside the max so an
        // empty range returns 0, not 1.
        return Math.max(0, Math.floor((upper - lower) / step) + 1);
      },

      contains: (expr, target) => {
        const t = target.re;
        // Symbolic target (no concrete numeric value): membership is
        // indeterminate unless the target's type rules it out entirely.
        // (Refute against `'number'`, not `'finite_real'`: the type
        // intersection treats incomparable numeric primitives — e.g.
        // `integer` vs `finite_real` — as disjoint, which would unsoundly
        // refute symbols of extended numeric type.)
        if (Number.isNaN(t))
          return typeMembership(target, 'number') === false ? false : undefined;
        // A non-real number (imaginary part ≠ 0) is never in a Range
        if (target.im !== 0) return false;
        if (!isFinite(t)) return false;
        // Symbolic bounds (e.g. Range(1, n)) cannot be decided structurally
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);
        if (step === 0) return false;
        // Directional bounds check: t must lie between lower and upper in
        // the direction implied by step's sign.
        if (step > 0) {
          if (t < lower || t > upper) return false;
        } else {
          if (t > lower || t < upper) return false;
        }
        // Step-grid check: t must be reachable as `lower + k*step` for some
        // non-negative integer k, within engine tolerance.
        const k = (t - lower) / step;
        const tol = expr.engine.tolerance;
        const kRounded = Math.round(k);
        return kRounded >= 0 && Math.abs(k - kRounded) < tol;
      },

      iterator: (expr) => {
        // Symbolic bounds (e.g. Range(1, n)): the elements cannot be
        // enumerated — return undefined (no iterator) rather than iterating
        // the collapsed [1]. Consumers keep the lazy form (materialize) or
        // stay inert (Reduce guards on isFiniteCollection).
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);

        // Number of elements in the range. Math.max guards against a
        // sign-mismatched step (e.g. Range(0, 1, -1)) producing a negative
        // count and looping forever.
        const maxCount =
          step === 0 ? 0 : Math.max(0, Math.floor((upper - lower) / step) + 1);

        let index = 1;

        return {
          next: () => {
            if (index === maxCount + 1) return { value: undefined, done: true };
            index += 1;
            return {
              value: expr.engine.number(lower + step * (index - 1 - 1)),
              done: false,
            };
          },
        };
      },

      // Return the nth step of the range.
      // Questionable if this is useful.
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        // Symbolic bounds: whether the index is within range is indeterminate
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const [lower, upper, step] = range(expr);
        if (step === 0) return undefined;
        const maxCount = Math.max(0, Math.floor((upper - lower) / step) + 1);
        if (index < 1 || index > maxCount) return undefined;
        return expr.engine.number(lower + step * (index - 1));
      },

      indexWhere: undefined,

      // Per the handler contract (`types-definitions.ts`) the receiver is the
      // candidate SUBSET: this answers `expr` ⊆ `target`.
      subsetOf: (expr, target, strict) => {
        // Note: Linspace is not considered a subset of Range
        if (target.operator === 'Range') {
          // Symbolic bounds on either side: indeterminate
          if (hasSymbolicRangeBounds(expr) || hasSymbolicRangeBounds(target))
            return undefined;
          const a = range(expr);
          const b = range(target);
          const [al, , as] = a;
          const [bl, , bs] = b;
          // Ascending integer grids only. The `%` arithmetic below is exact
          // only on integers (over floats it accumulates representation error,
          // and `Range.contains` compares decimal steps with a tolerance this
          // would contradict), and a descending range does not enumerate as
          // `al, al + as, …`. Everything else takes the elementwise walk.
          const aLast = rangeLast(a);
          const bLast = rangeLast(b);
          if (
            as <= 0 ||
            bs <= 0 ||
            ![al, as, aLast, bl, bs, bLast].every(Number.isInteger)
          )
            return collectionSubset(expr, target, strict);

          // Work from the ELEMENT COUNT, not the declared upper bound: a
          // range stops at the last grid point at or before `upper`, so
          // `Range(1, 5, 3)` and `Range(1, 4, 3)` both enumerate {1, 4} and
          // comparing `upper` would call the first no subset of the second.
          const aCount = Math.floor((aLast - al) / as) + 1;
          const bCount = Math.floor((bLast - bl) / bs) + 1;
          // An empty range is a subset of every range, strictly so unless the
          // other is empty too.
          if (aCount <= 0) return strict ? bCount > 0 : true;
          if (bCount <= 0) return false;

          // Every element of `expr` is `al + k·as`, and lies in `target` when
          // it is within `target`'s span AND on its grid. Being on the grid
          // takes two conditions, not one: the same PHASE
          // (`(al - bl) % bs === 0`) and a step that is a multiple of
          // `target`'s. Without the phase check `Range(2, 4, 2)` = {2, 4}
          // would count as a subset of `Range(1, 5, 2)` = {1, 3, 5}. The step
          // condition is vacuous for a single element, which has no second
          // point for the step to place — `Range(1, 1, 1)` and
          // `Range(1, 1, 5)` are both {1}.
          const inSpan = al >= bl && aLast <= bLast;
          const inPhase = (al - bl) % bs === 0;
          const onGrid = aCount === 1 || as % bs === 0;
          if (!(inSpan && inPhase && onGrid)) return false;
          if (!strict) return true;
          // `expr ⊆ target` with the same number of elements means the same
          // elements.
          return aCount !== bCount;
        }

        // Any other target: the generic elementwise/type-based test.
        return collectionSubset(expr, target, strict);
      },

      eltsgn: (expr) => {
        // Symbolic bounds: the elements' common sign is indeterminate
        if (hasSymbolicRangeBounds(expr)) return undefined;
        const r = range(expr);
        const [lower, upper, step] = r;
        // A zero step does not enumerate, and a range whose bounds run
        // against its step is empty: neither has elements to take a sign
        // from.
        if (step === 0) return undefined;
        if (step > 0 ? lower > upper : lower < upper) return undefined;
        // The sign comes from the extreme ELEMENTS, not the bounds: the last
        // element is the last grid point at or before `upper` (`Range(1, 6, 2)`
        // ends at 5), and a descending range runs from `lower` DOWN. Reading
        // the direction alone reported `Range(-5, 10)` as `positive`, which a
        // subset test against `PositiveIntegers` then believed.
        const last = rangeLast(r);
        // `rangeLast` special-cases an infinite UPPER bound but not an
        // infinite LOWER one, where `upper - ((upper - lower) % step)`
        // evaluates to NaN (`Range(-oo, -1)`). Decline explicitly: NaN makes
        // every comparison below false, so the sign would come out `undefined`
        // by accident rather than by decision. An infinite UPPER bound is
        // fine and stays supported — `Range(1, oo)` is `positive`.
        if (Number.isNaN(last)) return undefined;
        const min = Math.min(lower, last);
        const max = Math.max(lower, last);
        if (min > 0) return 'positive';
        if (max < 0) return 'negative';
        if (min === 0 && max === 0) return 'zero';
        if (min === 0) return 'non-negative';
        if (max === 0) return 'non-positive';
        // Straddles zero: no common sign (the range may or may not step ON
        // zero, so not even `not-zero` is safe).
        return undefined;
      },

      elttype: (expr) => {
        // Mirror the dynamic Range type: every present operand must be
        // integer-valued for the element type to be finite_integer.
        if (!isFunction(expr)) return 'finite_integer';
        for (let i = 1; i <= expr.nops; i++) {
          if (!(expr as any)[`op${i}`].isInteger) return 'finite_real';
        }
        return 'finite_integer';
      },
    },
  } as OperatorDefinition,

  Interval: {
    description:
      'A set of real numbers between two endpoints. The endpoints may or may not be included.',
    complexity: 8200,
    lazy: true,
    signature: '(number, number) -> set<real>',
    canonical: ([lo, hi], { engine }) => {
      if (!lo || !hi) return null;
      // Endpoints may be wrapped in `Open`/`Closed` markers and may be
      // infinite: `Interval(Open(-oo), 0)` is the ray (-∞, 0]. Unwrap the
      // markers so the endpoint values can be type-checked, then restore
      // the `Open` markers (`Closed` is the default and is normalized away).
      const unwrap = (
        op: Expression
      ): [endpoint: Expression, open: boolean] => {
        if (isFunction(op, 'Open')) return [op.op1, true];
        if (isFunction(op, 'Closed')) return [op.op1, false];
        return [op, false];
      };
      const [loVal, loOpen] = unwrap(lo);
      const [hiVal, hiOpen] = unwrap(hi);
      const [lower, upper] = checkTypes(
        engine,
        [loVal.canonical, hiVal.canonical],
        ['number', 'number']
      );
      if (!lower.isValid || !upper.isValid) return null;
      return engine._fn('Interval', [
        loOpen ? engine._fn('Open', [lower]) : lower,
        hiOpen ? engine._fn('Open', [upper]) : upper,
      ]);
    },
    eq: (a: Expression, b: Expression) => {
      const intervalA = interval(a);
      const intervalB = interval(b);
      // `b` may be an unevaluated set-valued expression (a symbol assigned
      // an interval, a set operation…): decline so `eq()` in compare.ts can
      // evaluate both sides and re-consult.
      if (!intervalB && b.type.matches('set<any>')) return undefined;
      if (!intervalA || !intervalB) return false;
      return (
        intervalA.start === intervalB.start &&
        intervalA.end === intervalB.end &&
        intervalA.openStart === intervalB.openStart &&
        intervalA.openEnd === intervalB.openEnd
      );
    },
    collection: {
      count: (_expr) => Infinity,
      iterator: (expr) => {
        const int = interval(expr);
        if (!int) return { next: () => ({ value: undefined, done: true }) };

        // Handle empty interval
        if (int.start >= int.end) {
          return { next: () => ({ value: undefined, done: true }) };
        }

        const ce = expr.engine;
        let level = 0; // Current level in binary tree
        let index = 0; // Index within current level

        return {
          next: () => {
            // Calculate total points at this level: 2^level
            const pointsAtLevel = Math.pow(2, level);

            if (index >= pointsAtLevel) {
              // Move to next level (double the resolution)
              level++;
              index = 0;
            }

            // For level n, we have 2^n points
            // Point i at level n is at position: (2*i + 1) / 2^(n+1)
            // This creates a binary tree pattern:
            // Level 0: 1 point at 0.5 (middle)
            // Level 1: 2 points at 0.25, 0.75 (quarters)
            // Level 2: 4 points at 0.125, 0.375, 0.625, 0.875 (eighths)
            // etc.
            const t = (2 * index + 1) / Math.pow(2, level + 1);
            const value = int.start + t * (int.end - int.start);

            index++;
            return { value: ce.number(value), done: false };
          },
        };
      },
      isEmpty: (_expr) => {
        const int = interval(_expr);
        // Symbolic endpoints: emptiness is indeterminate
        if (!int) return undefined;
        // Bounds that cross contain nothing, whatever the endpoint markers
        // say: `(2, 1)` and `[2, 1]` are both empty. The previous form
        // answered this case from the marker pair alone and reported a
        // doubly-open reversed interval NON-empty.
        if (int.start > int.end) return true;
        // Bounds that coincide contain their single point only when BOTH
        // endpoints are closed: `[1, 1]` is {1} — and `contains(1)` says so —
        // while `(1, 1)`, `[1, 1)` and `(1, 1]` all exclude the only
        // candidate. The previous form reported `[1, 1]` empty, contradicting
        // its own `contains` handler.
        if (int.start === int.end) return int.openStart || int.openEnd;
        return false;
      },
      isFinite: (_expr) => false,
      // Per the handler contract (`types-definitions.ts`) the receiver is the
      // candidate SUBSET: this answers `expr` ⊆ `other`.
      subsetOf: (expr, other, strict) => {
        const a = interval(expr);
        // Symbolic endpoints: indeterminate
        if (a === undefined) return undefined;

        // An empty interval is a subset of every collection, strictly so
        // unless `other` is empty too. This is decided BEFORE the
        // interval-vs-interval comparison below, because otherwise an empty
        // interval whose `other` is a `Set`, a `Range` or a number set would
        // take the generic path — and that path cannot decide it: it declines
        // anything whose `isFiniteCollection` is not `true`, and an
        // `Interval`'s is unconditionally `false` even when the interval holds
        // nothing.
        if (expr.isEmptyCollection === true) {
          if (!strict) return true;
          if (other.isEmptyCollection === undefined) return undefined;
          return !other.isEmptyCollection;
        }

        const b = interval(other);
        // `other` is not an interval: fall back to the generic test, which
        // still decides an interval against a set that contains every value
        // of its element type (`Interval(1, 2)` ⊆ `RealNumbers`).
        if (b === undefined) return collectionSubset(expr, other, strict);

        // An endpoint of `other` admits the corresponding endpoint of `expr`
        // when it lies strictly outside it, or coincides with it and is no
        // more exclusive (a closed bound admits an open one, not the
        // reverse). Endpoints may be ±Infinity, which compares correctly.
        const lowerFits =
          b.start < a.start ||
          (b.start === a.start && (!b.openStart || a.openStart));
        const upperFits =
          b.end > a.end || (b.end === a.end && (!b.openEnd || a.openEnd));
        if (!lowerFits || !upperFits) return false;
        if (!strict) return true;
        // Proper unless the two intervals are the same set of reals.
        return !(
          a.start === b.start &&
          a.end === b.end &&
          a.openStart === b.openStart &&
          a.openEnd === b.openEnd
        );
      },
      // Three-valued membership: `true` only when both bound checks are
      // entailed, `false` when a bound check (or the type of the target)
      // refutes membership, `undefined` otherwise (e.g. symbolic target
      // with unknown bounds). Endpoints may be ±Infinity.
      contains: (expr, target) => {
        const int = interval(expr);
        // Symbolic endpoints: membership is indeterminate
        if (!int) return undefined;

        // An interval only contains (real) numbers: refute non-numbers
        // (strings, booleans, …) on type alone. Note: `'number'` rather
        // than `'real'` — the type-intersection reduction treats
        // incomparable numeric primitives (e.g. `finite_number` vs `real`)
        // as disjoint, which would unsoundly refute compound expressions
        // of indeterminate numeric type.
        if (typeMembership(target, 'number') === false) return false;

        // Concrete numeric target: decide by direct numeric comparison.
        // This is more than a fast path: it refutes non-real targets
        // (`im !== 0`), and it uses exact IEEE endpoint comparisons rather
        // than the tolerance-based symbolic comparisons below. (The
        // symbolic comparisons used to mishandle infinite endpoints, e.g.
        // `-∞ > -∞` — fixed in `cmp()` — but the exact endpoint semantics
        // still differ from the tolerance-based path.)
        const t = target.re;
        if (!Number.isNaN(t)) {
          if (target.im !== 0) return false;
          return intervalContains(int, t);
        }

        const aboveLower = int.openStart
          ? target.isGreater(int.start)
          : target.isGreaterEqual(int.start);
        if (aboveLower === false) return false;
        const belowUpper = int.openEnd
          ? target.isLess(int.end)
          : target.isLessEqual(int.end);
        if (belowUpper === false) return false;
        // A target that is provably within both bounds is comparable,
        // hence real: membership is entailed.
        if (aboveLower === true && belowUpper === true) return true;
        return undefined;
      },

      eltsgn: (expr) => {
        const i = interval(expr);
        if (!i) return 'unsigned';
        // If the interval is empty, it is unsigned
        if (i.start === i.end) return 'unsigned';

        // If the start includes 0, the interval is non-negative
        if (i.start >= 0 && !i.openStart) return 'non-negative';
        // If the end includes 0, the interval is non-positive
        if (i.end <= 0 && !i.openEnd) return 'non-positive';

        // If the start and end are both positive the interval is positive
        if (i.start > 0 && i.end > 0) return 'positive';
        // If the start and end are both negative the interval is negative
        if (i.start < 0 && i.end < 0) return 'negative';

        return undefined;
      },

      elttype: (expr) => {
        const i = interval(expr);
        if (!i) return 'never';
        if (isFinite(i.start) && isFinite(i.end)) return 'finite_real';
        return 'real';
      },
    },
  } as OperatorDefinition,

  Linspace: {
    description:
      'A sequence of evenly spaced numbers between a start and end value, both endpoints included.',
    complexity: 8200,
    signature:
      '(start: number, end: number?, count: number?) -> indexed_collection',
    // @todo: the canonical form should consider if this can be simplified to a range (if the elements are integers)

    // @todo: need eq handler
    collection: {
      isEnumerable: (expr) =>
        isFunction(expr) && !expr.ops.some((op) => isSymbolicOperand(op)),
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        // A symbolic count (e.g. Linspace(0, 1, m)) is indeterminate; only a
        // *missing* count selects the default.
        if (isSymbolicOperand(expr.op3)) return undefined;
        let count = operandNumericValue(expr.op3);
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        return Math.max(0, Math.floor(count));
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        // Symbolic count: whether the index is in range is indeterminate
        if (isSymbolicOperand(expr.op3)) return undefined;
        const lower = operandNumericValue(expr.op1);
        const upper = operandNumericValue(expr.op2);
        let count = operandNumericValue(expr.op3);
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        count = Math.floor(count);
        if (!isFinite(lower) || !isFinite(upper)) return undefined;
        if (index < 1 || index > count) return undefined;
        // Linspace includes both endpoints: at(1) = lower, at(count) = upper.
        // count === 1 is a degenerate case — return lower (NumPy convention).
        if (count === 1) return expr.engine.number(lower);
        return expr.engine.number(
          lower + ((upper - lower) * (index - 1)) / (count - 1)
        );
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        // A symbolic endpoint or count cannot be enumerated (the arithmetic
        // below would yield NaN literals) — no iterator; consumers keep the
        // lazy form. Missing (`Nothing`) operands still select the defaults.
        if (expr.ops.some((op) => isSymbolicOperand(op))) return undefined;
        let lower = operandNumericValue(expr.op1);
        let upper = operandNumericValue(expr.op2);
        let totalCount: number;
        if (!isFinite(upper)) {
          upper = lower;
          lower = 1;
          totalCount = DEFAULT_LINSPACE_COUNT;
        } else {
          const count = operandNumericValue(expr.op3);
          totalCount = Math.max(
            0,
            !isFinite(count) ? DEFAULT_LINSPACE_COUNT : count
          );
        }
        totalCount = Math.floor(totalCount);

        // Denominator for endpoint-inclusive spacing. totalCount === 1
        // yields a single sample at `lower` (matches NumPy `linspace`).
        const denom = totalCount > 1 ? totalCount - 1 : 1;

        let index = 1;

        return {
          next: () => {
            if (index === totalCount + 1)
              return { value: undefined, done: true };
            index += 1;
            return {
              value: expr.engine.number(
                lower + ((upper - lower) * (index - 1 - 1)) / denom
              ),
              done: false,
            };
          },
        };
      },
      contains: (expr, target) => {
        const t = target.re;
        // Symbolic target: indeterminate unless the type refutes membership
        // (`'number'`, not `'finite_real'` — see the Range.contains note)
        if (Number.isNaN(t))
          return typeMembership(target, 'number') === false ? false : undefined;
        if (target.im !== 0) return false;
        if (!isFinite(t)) return false;
        if (!isFunction(expr)) return undefined;
        const lower = operandNumericValue(expr.op1);
        const upper = operandNumericValue(expr.op2);
        // Symbolic bounds cannot be decided structurally
        if (Number.isNaN(lower) || Number.isNaN(upper)) return undefined;
        if (t < lower || t > upper) return false;
        // A symbolic count: the sample grid is indeterminate (the bounds
        // check above may still have refuted membership definitively)
        if (isSymbolicOperand(expr.op3)) return undefined;
        let count = operandNumericValue(expr.op3);
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        count = Math.floor(count);
        if (count === 0) return false;
        if (count === 1) return t === lower;
        const step = (upper - lower) / (count - 1);
        const k = (t - lower) / step;
        const tol = expr.engine.tolerance;
        const kRounded = Math.round(k);
        return (
          kRounded >= 0 && kRounded <= count - 1 && Math.abs(k - kRounded) < tol
        );
      },
    },
  },

  //
  // Operations on collections (indexed or not)
  //

  Contains: {
    description:
      'Return True if the collection contains the given element (structural identity, like `===`), False otherwise.\n\nEquivalent to `Any(xs, (e) => e === v)`; use `Any` to test an arbitrary predicate instead of a specific value.',
    complexity: 8200,
    signature: '(collection<any>, element: any) -> boolean',
    // Peek through membership-preserving wrappers (incl. `Unique`) so an eager
    // Sort/RandomShuffle isn't materialized just to test membership (see
    // `peekMembershipPreserving`).
    canonical: (ops, { engine: ce }) => {
      // Run the framework's default flatten step (Sequence-splice + Nothing-
      // drop) that this custom canonical handler would otherwise short-circuit.
      ops = flatten(ops);
      const stripped = withFirst(peekMembershipPreserving(ops[0]), ops);
      const adjusted = validateArguments(
        ce,
        stripped,
        CONTAINS_SIGNATURE,
        false,
        false
      );
      return ce._fn('Contains', adjusted ?? stripped);
    },
    evaluate: ([xs, value], { engine: ce }) => {
      // Three-valued: an indeterminate membership (e.g. a bounded walk that
      // hits its iteration limit) stays inert rather than collapsing to False.
      const found = xs.contains(value);
      if (found === undefined) return undefined;
      return found ? ce.True : ce.False;
    },
  },

  Count: {
    description: [
      '`Count(xs)`: the number of elements in the collection.',
      '`Count(xs, v)`: how many elements are structurally the same as `v`.',
      '`Count(xs, p)`: how many elements satisfy the predicate `p`.',
    ],
    keywords: ['cardinality', 'tally', 'occurrences'],
    complexity: 8200,
    signature: '(collection<any>, any?) -> integer',
    // Peek through count-preserving wrappers so an eager Sort/RandomShuffle isn't
    // materialized just to read a count (see `peekCountPreserving`). Only the
    // 1-arg cardinality form is safe to strip: the 2-arg forms may carry an
    // impure predicate (one drawing from `Random`), whose result depends on the
    // element ORDER the wrapper establishes, so `ops[0]` is kept as written.
    canonical: (ops, { engine: ce }) => {
      // Run the framework's default flatten step (Sequence-splice + Nothing-
      // drop) that this custom canonical handler would otherwise short-circuit.
      ops = flatten(ops);

      // The 2-arg form is overloaded on the operand's TYPE (`evaluate` below):
      // a function is a predicate, anything else is a value to match. A bare
      // shorthand predicate (`Count(xs, _ > 5)`) is boolean-typed, so without
      // this it dispatched as a VALUE and counted occurrences of the inert
      // `_ > 5`. Desugar it to a function literal here, BEFORE the dispatch.
      // The wildcard is what distinguishes it: a plain boolean value
      // (`Count([True, False, True], True)`) has none and still counts as a
      // value.
      if (ops.length === 2 && isPredicateShorthand(ops[1])) {
        const fn = canonicalCallbackOperand(ops[1], {
          operator: 'Count',
          supply: PER_ELEMENT_SUPPLY,
          source: ops[0],
        });
        if (fn) ops = [ops[0], fn];
      } else if (ops.length === 2) {
        // A CALLABLE operand at the 2-arg form is a predicate (the type-based
        // dispatch in `evaluate` below), so it is an operator-owned callback
        // slot and takes the static arity check — without it a 2-parameter
        // predicate threw `Filter predicate must return "True" or "False"`
        // out of `evaluate` on every route. A value to match is not callable,
        // and the check declines on it.
        const arityError = callbackArityError(
          ops[1],
          'Count',
          PER_ELEMENT_SUPPLY,
          ops[0]
        );
        if (arityError) ops = [ops[0], arityError];
      }

      const stripped =
        ops.length === 1 ? withFirst(peekCountPreserving(ops[0]), ops) : ops;
      const adjusted = validateArguments(
        ce,
        stripped,
        COUNT_SIGNATURE,
        false,
        false
      );
      return ce._fn('Count', adjusted ?? stripped);
    },
    evaluate: ([xs, what], { engine }) => {
      if (xs.isEmptyCollection) return engine.Zero;

      // 1-arg cardinality form. An indeterminate count (e.g. a set-builder
      // over a symbolic domain) stays symbolic.
      if (what === undefined) {
        const n = xs.count;
        if (n === undefined) return undefined;
        return engine.number(n);
      }

      // 2-arg PREDICATE form: delegate to `Filter` and read its count, so the
      // predicate semantics are `Filter`'s by construction — including the
      // hard error on a predicate that returns something other than `True`/
      // `False` (an inert `x > 1` over a symbolic element), the iteration
      // limit, and the unknown count of a non-finite source.
      // `.isFunction` is the TYPE property (a function literal, or a symbol
      // bound to one), not the `isFunction()` structural guard.
      if (what.isFunction === true) {
        const n = engine.function('Filter', [xs, what]).count;
        return n === undefined ? undefined : engine.number(n);
      }

      // 2-arg VALUE form: how many elements are structurally the same as
      // `what` (`.isSame` semantics, matching the `Same`/`===` operator —
      // number leaves compare by exact value, so `0.5` counts as `1/2`).
      // Only a finite collection has a knowable count; anything else stays
      // symbolic, mirroring the 1-arg form.
      if (xs.isFiniteCollection !== true) return undefined;
      // ...and only an enumerable one: `Take(xs, 2)` over a valueless `xs` is
      // finite yet has nothing to walk (see `isEnumerableSource`).
      if (!isEnumerableSource(xs)) return undefined;
      let n = 0;
      for (const x of xs.each()) if (x.isSame(what)) n += 1;
      return engine.number(n);
    },
    sgn: ([xs, what]) => {
      const empty = xs.isEmptyCollection;
      if (empty === true) return 'zero';
      // A non-empty collection has a POSITIVE cardinality, but a matching
      // count over one may still be zero (nothing matches).
      if (empty === false)
        return what === undefined ? 'positive' : 'non-negative';
      return undefined;
    },
  },

  IsEmpty: {
    description: ['Return True if the collection is empty, False otherwise.'],
    complexity: 8200,
    signature: '(collection<any>) -> boolean',
    // Peek through count-preserving wrappers so an eager Sort/RandomShuffle isn't
    // materialized just to test emptiness (see `peekCountPreserving`).
    canonical: (ops, { engine: ce }) => {
      // Run the framework's default flatten step (Sequence-splice + Nothing-
      // drop) that this custom canonical handler would otherwise short-circuit.
      ops = flatten(ops);
      const stripped = withFirst(peekCountPreserving(ops[0]), ops);
      const adjusted = validateArguments(
        ce,
        stripped,
        ISEMPTY_SIGNATURE,
        false,
        false
      );
      return ce._fn('IsEmpty', adjusted ?? stripped);
    },
    evaluate: ([xs], { engine: ce }) => {
      // Three-valued: an indeterminate emptiness (e.g. a bounded Filter walk
      // that hits its iteration limit) stays inert rather than collapsing to
      // False.
      const empty = xs.isEmptyCollection;
      if (empty === undefined) return undefined;
      return empty ? ce.True : ce.False;
    },
  },

  // Any(collection, predicate?): True if the predicate holds for at least one
  // element (or, without a predicate, if any element is itself True). The
  // predicate is optional so a collection of booleans can be tested directly,
  // like Julia's `any(itr)`.
  Any: {
    description:
      'Return True if the predicate holds for at least one element of the collection (or if any element is True when no predicate is given).\n\nTo test membership of a specific value, use `Contains(xs, v)` — the structural-identity specialization `Any(xs, (e) => e === v)`.',
    complexity: 8200,
    lazy: true,
    // Design D phase 1: the element-of link lives in the SIGNATURE (see
    // `CountIf`). The predicate slot stays OPTIONAL — `Any(xs)` tests the
    // elements themselves — and the contextual stamp simply never runs when the
    // operand is absent.
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>?) -> boolean where T',
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('Any', [collection]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'Any',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!fn) return null;
      return engine._fn('Any', [collection, fn]);
    },
    type: () => 'boolean',
    evaluate: ([collection, fn], { engine: ce }) =>
      evaluateQuantifier('Any', collection, fn, ce),
  },

  // All(collection, predicate?): True if the predicate holds for every element
  // (or, without a predicate, if every element is itself True). Vacuously True
  // for an empty collection, like Julia's `all(itr)`.
  All: {
    description:
      'Return True if the predicate holds for every element of the collection (or if every element is True when no predicate is given).',
    complexity: 8200,
    lazy: true,
    // Design D phase 1: the element-of link lives in the SIGNATURE, with the
    // OPTIONAL predicate slot of `Any`.
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>?) -> boolean where T',
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('All', [collection]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'All',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!fn) return null;
      return engine._fn('All', [collection, fn]);
    },
    type: () => 'boolean',
    evaluate: ([collection, fn], { engine: ce }) =>
      evaluateQuantifier('All', collection, fn, ce),
  },

  // { f(x) for x in xs }
  // { 2x | x ∈ [ 1 , 10 ] }
  Map: {
    description: [
      'Return the collection where each element has been transformed by the mapping function.',
      'With a single collection, equivalent to `[f(x) for x in xs]`. With',
      'multiple collections, combines them element-wise (like `zipWith`): ',
      '`Map(f, xs, ys) = [f(x1, y1), f(x2, y2), …]`, with the length of the',
      'shortest input. The mapping function is always the FIRST argument.',
    ],
    complexity: 8200,
    lazy: true,
    // The mapping function comes FIRST, the source collections after it
    // (ruled 2026-08-14, resolving the Map-spelling challenge left open by
    // Design D phase 3): the operator is variadic over its sources, and the
    // type language consumes required→optional→variadic, so a callback-LAST
    // spelling (`(collection+, mapping)`) is not positionally expressible —
    // the historical order forced a loose signature whose parameter positions
    // lied about the operands. Callback-first is the one honest spelling:
    // `(mapping, collection+)` is exactly what the handlers consume.
    //
    // Contextual stamping (Design D) is position-driven and survives the
    // flip, exactly as it does for the callback-first `Fold`:
    //
    //  - the UNARY form `Map(f, xs)` solves `T` from the source at operand 1
    //    and stamps `f`'s parameter with it;
    //  - the VARIADIC (`zipWith`) form's sources ALL mention `T`, whose
    //    solution is their join — and the declared slot `(T) -> U` is unary,
    //    so an n-ary zip mapping is admitted UNSTAMPED under the R-D6
    //    arity-mismatch rule, preserving the historical no-stamp behavior of
    //    the multi-collection form.
    signature:
      '(mapping: callback<(T) -> U>, collection<T>+) -> indexed_collection where T, U',
    // The mapped collection keeps the source's shape/indexed-ness, but its
    // elements are the lambda's RESULT type — not the source element type.
    // (If the input collection is indexed, the output collection is indexed.)
    // For the multi-collection (zipWith) form the result is always an indexed
    // collection (like `Zip`) of the lambda's result type.
    type: (ops) => {
      // Source type for shape propagation. When the source's STATIC type is
      // indeterminate (a declared-`unknown` symbol holding a collection
      // value — the lazy-broadcast `Map(…, L)` shape), fall back to its
      // value-aware indexed-ness so the Map types `indexed_collection<T>`
      // rather than shedding indexed-ness to `collection<T>`.
      const sourceType = (x: Expression): Type => {
        const t = x.type.type;
        if (
          (t === 'unknown' || t === 'any' || t === 'value') &&
          x.isIndexedCollection
        )
          return 'indexed_collection';
        return t;
      };
      if (ops.length <= 2) {
        // A source-less `Map(f)` is never canonical (the handler declines
        // it), but the type can be asked of the raw form.
        if (ops[1] === undefined) return 'indexed_collection';
        const resultType = functionResult(ops[0].type.type);
        if (!resultType || resultType === 'unknown' || resultType === 'any') {
          // Unknown element type: still preserve value-aware indexed-ness
          // (the `.N()` route wraps the body in `N`, whose lazy result types
          // `unknown` — without this the whole Map would type `unknown` and
          // the arithmetic broadcast would treat it as a scalar).
          const s = sourceType(ops[1]);
          // An index span must NOT be echoed: `range` promises a contiguous
          // ascending run of positive integers, and nothing constrains an
          // unknown-typed lambda's output to that shape, so `Map(f, 1..5)`
          // would claim a type its value need not have. Widen to the honest
          // supertype — the same reasoning as `mapResultType`'s `range` case,
          // which this fallback path bypasses.
          if (s === 'range') return 'indexed_collection';
          // A STRING source must not be echoed either, and for a stronger
          // reason: `Map` is permanently list-out over a string (a mapped
          // string is a `list`, even when the callback returns characters —
          // `docs/STRING_ROADMAP.md`, "String preservation rule"), so echoing
          // `string` would promise a value the runtime never produces. The
          // element type is the unknown one this branch is handling.
          if (s === 'string') return 'list';
          if (s === 'indexed_collection' && ops[1].type.type !== s) return s;
          return ops[1].type;
        }
        return mapResultType(sourceType(ops[1]), resultType);
      }
      const resultType = functionResult(ops[0].type.type);
      return mapResultType(
        'indexed_collection',
        !resultType || resultType === 'unknown' || resultType === 'any'
          ? 'unknown'
          : resultType
      );
    },
    canonical: (ops, { engine }) => {
      // The mapping function is the FIRST argument; every following argument
      // is a source collection. It is applied to one element from EACH source
      // (`Map(f, xs, ys)` is zipWith), so that is the arity it must accept.
      // With NO source there is nothing to map and the call declines below;
      // the arity check would otherwise report a nonsensical "0 arguments".
      const sourceCount = ops.length - 1;
      // The sources are checked BEFORE the callback so the arity check can be
      // handed a bound one. `Map` is `lazy`, so `ops` arrive unbound and a raw
      // source answers `unknown` for its type — which would silently cost the
      // tuple-pattern hint. `checkCollectionOperand` canonicalizes, so
      // `collections[0]` is the source with a readable element type.
      const collections = ops
        .slice(1)
        .map((c) => checkCollectionOperand(engine, c));
      const fn = canonicalCallbackOperand(
        ops[0],
        sourceCount === 0
          ? undefined
          : {
              operator: 'Map',
              supply:
                sourceCount === 1
                  ? PER_ELEMENT_SUPPLY
                  : {
                      count: sourceCount,
                      describes: `one element from each of the ${sourceCount} collections`,
                    },
              // `Map` is callback-FIRST, so the single source of the unary
              // form is the first of these. The zipWith form supplies one
              // element from each source rather than one destructurable
              // element, so its supply is not `destructurable` and the source
              // goes unread.
              source: collections[0],
            }
      );
      if (
        !fn ||
        collections.length === 0 ||
        collections.some((c) => !c.isValid)
      ) {
        // Migration aid for the 2026-08-14 argument-order flip (the mapping
        // function moved from last to FIRST): a call written in the legacy
        // order — a provable collection first, a function-shaped operand
        // last — would otherwise just decline here and sit as an inert
        // symbolic `Map`. Surface the callback-slot type error instead, so
        // the misorder is loud and names the offending operand. The operands
        // arrive RAW (every type reads `unknown`), so the first is
        // canonicalized to read its type — but never a bare symbol, whose
        // canonicalization would DECLARE it as a side effect (and whose
        // callback slot defers by design anyway).
        const last = ops[ops.length - 1];
        const first =
          ops.length >= 2 &&
          !isSymbol(ops[0]) &&
          !isFunction(ops[0], 'Function')
            ? ops[0].canonical
            : undefined;
        if (
          first !== undefined &&
          first.type.matches('collection<any>') &&
          (isFunction(last, 'Function') || last.type.matches('function'))
        )
          return engine._fn('Map', [
            engine.typeError('function', first.type, first),
            ...ops.slice(1).map((c) => c.canonical),
          ]);
        return null;
      }

      return engine._fn('Map', [fn, ...collections]);
    },
    collection: {
      // The multi-source form advances every source in LOCKSTEP, so a single
      // unwalkable source stops the whole walk — mirror `isEmpty`/`count`,
      // which read the same `ops.slice(1)` (the first operand is the
      // mapping function, not a source).
      // Read through `mapSource`, as `count`/`isEmpty`/`isFinite`/`at`/
      // `iterator` all do: an EAGER collection producer (`SetFrom(…)`,
      // `Characters(…)`) has no collection handlers until it is evaluated and
      // reports its enumerability as unknown, while `mapSource` resolves it.
      // Reading the raw operand instead made this facet disagree with every
      // sibling — `Map(f, SetFrom([1, 2]))` walked fine and counted fine
      // until the set-kind path started gating its walk on this answer, and
      // then reported `count` as unknown for a two-element set.
      isEnumerable: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops <= 2) return mapSource(expr.op2).isEnumerableCollection;
        let unknown = false;
        for (const x of expr.ops.slice(1)) {
          const e = mapSource(x).isEnumerableCollection;
          if (e === false) return false;
          if (e === undefined) unknown = true;
        }
        return unknown ? undefined : true;
      },
      isLazy: (_expr) => true,
      elementMemo: true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const sourceCount =
          expr.nops > 2
            ? minCount(expr.ops.slice(1).map((c) => mapSource(c).count))
            : mapSource(expr.op2).count;
        // A set-kind result counts DISTINCT results: the source's length is
        // only an upper bound once the callback can map two elements onto one
        // value (see the `iterator` handler).
        if (sourceCount === undefined || !producesSet(expr)) return sourceCount;
        return Number.isFinite(sourceCount)
          ? distinctCount(expr, sourceCount)
          : undefined;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops > 2) {
          // Empty as soon as *any* source is empty (mirrors Zip).
          let anyUnknown = false;
          for (const x of expr.ops.slice(1)) {
            const e = mapSource(x).isEmptyCollection;
            if (e === true) return true;
            if (e === undefined) anyUnknown = true;
          }
          return anyUnknown ? undefined : false;
        }
        return mapSource(expr.op2).isEmptyCollection;
      },
      // A set-kind result deduplicates, and deduplication can only SHRINK, so
      // an infinite source can yield a FINITE set — `Map(x -> 1, Integers)`
      // holds exactly one element. Unlike `Join`/`Append`, an infinite SET
      // source settles nothing here either: those pass their elements through
      // unchanged, while a callback may collapse infinitely many distinct
      // elements onto one value. So a non-finite source under set semantics
      // is UNKNOWN, never a definite `false`.
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        const isSet = producesSet(expr);
        if (expr.nops > 2) {
          // Finite as soon as *any* source is finite (mirrors Zip).
          let anyUnknown = false;
          for (const x of expr.ops.slice(1)) {
            const f = mapSource(x).isFiniteCollection;
            if (f === true) return true;
            if (f === undefined) anyUnknown = true;
          }
          if (anyUnknown) return undefined;
          return isSet ? undefined : false;
        }
        const finite = mapSource(expr.op2).isFiniteCollection;
        if (finite === false && isSet) return undefined;
        return finite;
      },
      // `Map` preserves the SET kind of its source (`mapResultType`), but a
      // callback can COLLAPSE two distinct elements onto one value —
      // `Map(x -> x^2, Set(-1, 1, 2))` maps three distinct elements to the
      // two values 1 and 4. The enumeration therefore has to deduplicate, or
      // the lazy node disagrees with what materializing the SAME node
      // answers: materialization rebuilds through `ce.function('Set', …)`,
      // which deduplicates in `canonicalSet`. (The image of a set under a
      // function is a set, so the deduplicated answer is the correct one.)
      iterator: (expr) => {
        const base = mapIterator(expr);
        return isFunction(expr) && producesSet(expr)
          ? deduplicatingIterator(
              base,
              expr.engine.iterationLimit,
              expr.operator
            )
          : base;
      },
      at: (expr: Expression, index: number | string) => {
        if (!isFunction(expr)) return undefined;
        if (typeof index !== 'number') return undefined;

        // A set-kind result is indexed through the DEDUPLICATED enumeration,
        // so that `at`, `each` and `count` agree; the positional paths below
        // index the source, which counts elements the callback collapsed.
        if (producesSet(expr))
          return distinctAt(expr, index, () => {
            const n =
              expr.nops > 2
                ? minCount(expr.ops.slice(1).map((c) => mapSource(c).count))
                : mapSource(expr.op2).count;
            return n !== undefined && Number.isFinite(n) ? n : undefined;
          });

        // Random access re-derives the element through the memoized lowered
        // chain (R5). Each `at()` remains its own auto-compile micro-drain.
        const spine = lowerMapSpine(expr);
        if (spine) {
          const ce = expr.engine;
          const levels = spine.levels;
          // The general path recurses through each level's own `at` handler,
          // so the composite gate is the CONJUNCTION of every level's gate.
          // Apply them outermost-in, exactly as the recursion would (only the
          // innermost level can be variadic).
          for (let i = levels.length - 1; i >= 1; i--) {
            if (mapSource(levels[i].sources[0]).isIndexedCollection === false)
              return undefined;
            if (!Number.isFinite(index) || index === 0) return undefined;
          }
          let items: Expression[];
          if (levels[0].arity > 1) {
            if (index < 1) return undefined;
            const xs = spine.bases.map((c) => mapSource(c).at(index));
            if (xs.some((x) => x === undefined)) return undefined;
            items = xs as Expression[];
          } else {
            const source = mapSource(spine.bases[0]);
            if (source.isIndexedCollection === false) return undefined;
            if (!Number.isFinite(index) || index === 0) return undefined;
            const item = source.at(index);
            if (!item) return undefined;
            items = [item];
          }
          // A failed level short-circuits the whole access to `undefined` —
          // the general `at` path returns `undefined` (never a marker) as
          // soon as one level's application declines.
          return makeSpineRunner(ce, spine, () => undefined)(items);
        }

        if (expr.nops > 2) {
          // Multi-collection (zipWith): f of each source's element at `index`;
          // undefined if any source has no element there — no up-front count
          // needed (a source with an unknown count still answers `at`).
          const collections = expr.ops.slice(1);
          if (index < 1) return undefined;
          const items = collections.map((c) => mapSource(c).at(index));
          if (items.some((x) => x === undefined)) return undefined;
          // Each at() access is its own micro-drain (resets the
          // once-per-drain attempt bound, so a cleared `{symbol}` mark can
          // re-attempt on an at()-only access pattern).
          const compiled = mapAutoCompileRunner(expr, { drainStart: true })?.(
            items as Expression[]
          );
          if (compiled !== undefined) return compiled;
          return applicable(expr.op1)?.(items as Expression[]);
        }

        // Gate on the SOURCE's indexed-ness (value-aware for a symbol
        // holding a collection), not the Map's own static type: a lazy
        // broadcast over a declared-`unknown` symbol types `unknown`, but its
        // source still answers `at`. A genuinely non-indexed source returns
        // `undefined` from `source.at` below anyway. `mapSource` resolves an
        // eager/broadcast source that only becomes a collection on evaluation
        // (else `at` reports `undefined` and a result longer than the
        // materialization head renders head-only).
        const source = mapSource(expr.op2);
        if (source.isIndexedCollection === false) return undefined;
        if (!Number.isFinite(index) || index === 0) return undefined;
        const item = source.at(index);
        if (!item) return undefined;
        // Each at() access is its own micro-drain (see the zip form above).
        const compiled = mapAutoCompileRunner(expr, { drainStart: true })?.([
          item,
        ]);
        if (compiled !== undefined) return compiled;
        return applicable(expr.op1)?.([item]);
      },
    },
  },

  Filter: {
    description: [
      'Return the elements of the collection for which the predicate function returns True.',
      'Equivalent to `[x for x in xs if p(x)]`.',
    ],
    complexity: 8200,
    lazy: true,
    // Design D phase 0b: the element-of link lives in the SIGNATURE (see
    // `CountIf`). The RESULT stays with the `type:` handler below — the type
    // language cannot express "the source's own collection kind and
    // indexedness", so converting the slot deliberately does not convert the
    // result (§7, rule 1).
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>) -> collection where T',
    // If the input collection is indexed, the output collection is indexed —
    // but NOT the source's own type. Filtering changes the length, so echoing
    // the source type claimed `vector<3>` for a filtered 3-vector, `tuple<…>`
    // (with its arity and per-position element types) for a filtered tuple,
    // and `range` for a filtered span that is no longer contiguous. Per the
    // per-kind result rule (`docs/STRING_ROADMAP.md`, "Signature refinement",
    // Phase 0b) an indexed source yields `list<T>` — the element type kept,
    // the shape dropped. A non-indexed source (a set) keeps its type: no
    // arity or shape to lie about, and its kind IS preserved.
    // A STRING source keeps its kind too, for the same reason a set does:
    // filtering a string's characters yields a string, and `string` carries
    // neither an arity nor a shape to lie about (`docs/STRING_ROADMAP.md`,
    // "String preservation rule"). The value follows the type —
    // `evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts` joins the kept characters, so a
    // filtered string is an eager `string` value, not a lazy view.
    // Re-segmentation caveat: rejoining the kept characters can merge or split
    // grapheme clusters, so the result may hold a different number of
    // characters than the predicate accepted — filtering away a base character
    // leaves its combining mark to attach to whatever now precedes it.
    type: (ops) => {
      const t = ops[0].type;
      // Tested with `matches` (a SUBTYPE test) rather than by comparing the
      // type constructor, so that a transparent alias or reference whose
      // resolved type is `string` also gets the string-preserving result — an
      // identity test on the constructor let such a source fall through to
      // `list<character>`, and `evaluateStringPreservingCollection`
      // (`boxed-expression/boxed-function.ts`) keys on the DECLARED result
      // type being `string`, so the lazy result was never joined. The subtype
      // test does not over-admit: `unknown` and `any` are not subtypes of
      // `string`, and neither is a union such as `string | list<T>` that only
      // reaches `string` through one arm — for those the runtime may well
      // produce a list, so claiming `string` would be a promise the
      // evaluation cannot keep.
      if (t.matches('string')) return t;
      if (!t.matches('indexed_collection<any>')) return t;
      return { kind: 'list', elements: collectionElementType(t.type) ?? 'any' };
    },
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'Filter',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!collection.isValid || !fn) return null;

      return engine._fn('Filter', [collection, fn]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      elementMemo: true,
      // Structural, O(1), never walks the source: a filter of a finite source
      // is finite; a filter of an infinite/unknown source may be finite or
      // infinite, so the finiteness is unknown (`undefined`). Providing an
      // explicit handler is essential — the synthesized default derives
      // `isFinite` from `count`, whose walk enforces `ce.iterationLimit` and
      // would throw during canonicalization of a large source.
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection === true ? true : undefined;
      },
      // A filter of an empty source is empty (O(1)). Otherwise emptiness
      // depends on the predicate — a finite source may filter down to nothing
      // (`Min(9, Filter([1,2], _ > 5))` needs `true`) or keep elements (needed
      // by materialization). So walk to the FIRST matching element: `false` as
      // soon as one is found, `true` if the source is exhausted with no match.
      // The walk is bounded by `ce.iterationLimit`; if that trips before a
      // verdict, report `undefined` (unknown) rather than let the cancellation
      // escape — any other cancellation (deadline/timeout) propagates.
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isEmptyCollection === true) return true;
        // A source that cannot be enumerated leaves emptiness UNKNOWN: the
        // walk below would find nothing and report a definite `true`, which is
        // how `Filter(xs, p)` answered `[]` for a valueless `xs`.
        if (!isEnumerableSource(expr.op1)) return undefined;
        try {
          for (const _ of expr.each()) return false;
          return true;
        } catch (e) {
          if (
            e instanceof CancellationError &&
            e.cause === 'iteration-limit-exceeded'
          )
            return undefined;
          throw e;
        }
      },
      count: (expr) => {
        // The filtered count is unknown without testing the predicate. For a
        // finite source, count the matching elements (so e.g.
        // `Sum(Filter([1,2,3], _ > 1))` can evaluate instead of bailing on an
        // unknown count). For an infinite or unknown source the count is
        // unknown (`undefined`) — never `Infinity`, since a filter of an
        // infinite source may still have a finite count.
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        // Finiteness is not enumerability: `Take(xs, 2)` over a valueless `xs`
        // is finite (capped at 2) yet has nothing to walk, and the loop below
        // would report that empty walk as a count of 0. See `isEnumerableSource`.
        if (!isEnumerableSource(expr.op1)) return undefined;
        // A FACET query stays cheap: past `ce.iterationLimit` matching
        // elements the count is reported as UNKNOWN rather than walked to the
        // end. This bound is the count's OWN, deliberately separate from the
        // iterator's: the iterator caps an unbroken run of REJECTIONS, which
        // is the walk that can never finish, and a productive filter must run
        // as far as its consumer asks (`Take(Filter(1..∞, _ > 0), 1025)`).
        // Answering a facet is the other concern — bounded work for a
        // question nobody asked to be exact — and the two shared one mechanism
        // until the iterator's guard was narrowed.
        //
        // The `catch` still stands: the iterator's own cap can trip inside the
        // walk (a long run of non-matching elements), and that cancellation is
        // reported as an unknown count rather than escaping. Any other
        // cancellation (deadline/timeout) must propagate.
        const limit = expr.engine.iterationLimit;
        try {
          let n = 0;
          for (const _ of expr.each()) if (++n > limit) return undefined;
          return n;
        } catch (e) {
          if (
            e instanceof CancellationError &&
            e.cause === 'iteration-limit-exceeded'
          )
            return undefined;
          throw e;
        }
      },
      contains: (expr, target) => {
        // True if target is in the source collection and the predicate returns
        // True for that target. Note: query the source (`op1`), not `expr` —
        // `expr.contains()` would dispatch back into this handler.
        if (!isFunction(expr)) return false;
        // An UNDECIDED source membership must propagate as `undefined`: `??
        // false` here asserted a definite "not a member" about a source that
        // could not answer at all. A definite `false` still refutes.
        const inSource = expr.op1.contains(target);
        if (inSource !== true) return inSource === false ? false : undefined;
        const f = applicable(expr.op2);
        const applied = f([target]);
        // Mirror the iterator's verdicts on the predicate result, so a query
        // and a walk of the same `Filter` never disagree.
        if (applied === undefined)
          throw new Error(
            `Invalid filter predicate. ${spellCheckMessage(expr.op2)}`
          );
        if (sym(applied) === 'True') return true;
        if (sym(applied) === 'False') return false;
        // An element-valued predicate failure (see `predicateErrorValue`)
        // leaves membership UNDECIDED: answering `false` would be an unsound
        // definite answer about an element the predicate could not judge.
        if (predicateErrorValue(applied)) return undefined;
        // Any other non-boolean result is a malformed predicate. Report it the
        // way every other Filter facet does — `each`/`count`/`isEmpty` all
        // throw this exact message, as do the sibling predicate consumers
        // (`Find`, `CountIf`, `Position`, `IndexWhere`, `Partition`) —
        // instead of silently answering `false`.
        throw predicateResultError('Filter', expr.op2);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };

        const source = expr.op1.each();
        // Pulls since the last element was EMITTED, not pulls in total. The
        // cap exists to turn a walk that can never finish into an error
        // instead of a hang — a predicate that never matches over an infinite
        // source — and only an unbroken run of REJECTIONS is that walk. A
        // filter that keeps emitting has proved it is not stuck, and is
        // bounded by whatever consumes it: counting its productive pulls too
        // made `Take(Filter(1..∞, _ > 0), 1025)` fail at the default limit of
        // 1024 for a walk that rejects nothing.
        let sinceEmit = 0;
        const limit = expr.engine.iterationLimit;
        const emit = (value: Expression): IteratorYieldResult<Expression> => {
          sinceEmit = 0;
          return { value, done: false };
        };
        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              const pred = f([value]);
              if (!pred) {
                throw new Error(
                  `Invalid filter predicate. ${spellCheckMessage(expr.op2)}`
                );
              }
              if (sym(pred) === 'True') return emit(value);
              if (sym(pred) !== 'False') {
                // The predicate failed on this ELEMENT (e.g. its `Typed`
                // parameter annotation rejected it): emit that `Error` value
                // in the element's place, as `Map` does, instead of throwing
                // a message about the predicate.
                const err = predicateErrorValue(pred);
                // An error VALUE takes the element's place, so this pull is
                // productive too and resets the counter.
                if (err) return emit(err);
                throw predicateResultError('Filter', expr.op2);
              }
              // REJECTED — the only pull that counts toward the cap.
              if (++sinceEmit > limit)
                throw new CancellationError({
                  cause: 'iteration-limit-exceeded',
                  message: `Iteration limit of ${limit} exceeded while evaluating Filter()`,
                });
            }
          },
        };
      },
      /**
       * Return the element at the given 1‑based `index` **after** applying the
       * filter predicate.
       *
       * * If `index` is positive, iterate through the source collection until
       *   the `index`‑th element that satisfies the predicate is found.
       * * If `index` is negative, first materialise the filtered result (only
       *   possible for finite source collections) and count from the end
       *   (‑1 → last, ‑2 → penultimate, …).
       * * For non‑numeric indexes or out‑of‑range requests, return
       *   `undefined`.
       *
       * The function never mutates the source collection and stops iterating
       * as soon as the requested element is found.
       */
      at: (
        expr: Expression,
        index: number | string
      ): Expression | undefined => {
        // Only numeric indexes are supported
        if (typeof index !== 'number' || !Number.isFinite(index) || index === 0)
          return undefined;
        if (!isFunction(expr)) return undefined;

        // Handle negative indexes by materialising the filtered sequence
        if (index < 0) {
          // Need a definite end to count from the back
          if (!expr.op1.isFiniteCollection) return undefined;

          const data = Array.from(expr.each()); // already filtered
          const i = data.length + index + 1; // convert ‑N to 1‑based
          if (i < 1 || i > data.length) return undefined;
          return data[i - 1];
        }

        // Positive index: stream through the guarded filter iterator until we
        // reach the desired element. `expr.each()` applies the predicate AND
        // caps the source walk at `ce.iterationLimit`, throwing
        // `iteration-limit-exceeded` — unlike a raw `expr.op1.each()` walk,
        // which has no guard and would run unbounded once the deadline is
        // removed. Swallow that cause and report `undefined` (unknown),
        // mirroring `count`/`isEmpty`; any other cancellation
        // (deadline/timeout) propagates.
        try {
          let count = 0;
          for (const item of expr.each()) {
            count += 1;
            if (count === index) return item;
          }
        } catch (e) {
          if (
            e instanceof CancellationError &&
            e.cause === 'iteration-limit-exceeded'
          )
            return undefined;
          throw e;
        }
        return undefined; // Not enough matching elements
      },
    },
  },

  // Haskell: "foldl"
  // For "foldr", apply Reverse() first
  Reduce: {
    description:
      'Reduce (fold) a collection to a single value by repeatedly applying a binary function, with an optional initial value.',
    complexity: 8200,
    lazy: true,
    // Design D phase 2: the element-of link lives in the SIGNATURE (see
    // `CountIf`). `S` spells the reducer as `(accumulator, element)` and stamps
    // the ELEMENT parameter only — §7 rule 2: `S` describes the STAMP, not the
    // operator's tolerance. The accumulator is deliberately `unknown`, which
    // the stamp gate declines, because a fold's accumulator may CHANGE TYPE
    // mid-fold and an annotation would forbid it: `Reduce([1,2,3], (a, x) =>
    // a / x, 1)` folds 1 → 1/2 → 1/6, which a `finite_integer` accumulator
    // annotation (solved from the initial value) rejects at apply time. That
    // holds for the SEEDED form as much as the seedless one, so neither stamps
    // it — see the phase-2 audit in the design doc.
    //
    // The RESULT stays with the `type:` handler below: it is the reducer's own
    // result type, which the accumulator channel does not carry.
    signature:
      '(collection<T>, reducer: callback<(unknown, T) -> unknown>, initial: value?) -> value where T',
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'Reduce',
        supply: ACCUMULATOR_SUPPLY,
      });
      if (!collection.isValid || !fn) return null;

      const initial = ops[2]?.canonical;
      if (initial?.isValid)
        return engine._fn('Reduce', [collection, fn, initial]);
      return engine._fn('Reduce', [collection, fn]);
    },

    type: (ops) =>
      parseType(foldResultType(ops[0], ops[1], ops[2]) ?? 'unknown'),

    evaluate: (
      [collection, fn, initial],
      { engine: ce, numericApproximation }
    ) => {
      if (!collection.isFiniteCollection) return undefined;
      // A collection may report a finite count yet decline enumeration
      // (e.g. Linspace(a, 1, 3) with a symbolic endpoint: size 3, but the
      // elements have no numeric value, so its iterator returns undefined
      // and each() yields nothing). Folding that would silently produce the
      // initial value (Sum → 0): stay inert instead.
      //
      // Each of the three folds below reads that verdict off its OWN walk
      // (`enumerationDeclinedAfterWalk`) rather than probing for it here:
      // probing starts a second enumeration, which re-runs the element
      // callback of a lazy `Map`/`Filter` once more than there are elements.
      const hasInitial = initial !== undefined;
      const seed = initial ?? ce.Nothing;

      // The compiled fast path folds with JS numbers, so it always yields a
      // float. Under exact evaluation that violates the Evaluate-vs-N
      // exactness contract (e.g. `a + 1/k` over a Range would collapse the
      // exact rational sum to a float). Only take it under numeric
      // approximation, or when the inputs are already inexact (a float result
      // is then correct anyway). Otherwise fall through to the interpreted
      // path, which is contract-correct.
      const inputsInexact =
        numericApproximation || (isNumber(seed) && !seed.isExact);

      if (
        inputsInexact &&
        // A SEEDLESS fold has no initial value to type-check: its seed is the
        // first element, covered by the collection check. (Testing `nothing`
        // against `real` used to make this whole branch unreachable without an
        // initial value.)
        (!hasInitial || seed.type.matches('real')) &&
        collection.type.matches(ce.type('collection<real>'))
      ) {
        // If we're dealing with real numbers, we can compile.
        const compiled = implicitCompile(ce, fn);
        // Only take the compiled fast path if the function actually compiled
        // to a lambda; otherwise fall through to the interpreted path below
        // (previously this returned `undefined`, leaving Reduce unevaluated).
        if (compiled && compiled.calling === 'lambda' && compiled.run) {
          // The interpreted reducer, needed by the fast path too (below).
          const fInterp = applicable(fn);
          const stepInterp = (acc: Expression, x: Expression): Expression =>
            fInterp([acc, x]) ?? absenceMarker(ce, collection);
          return run(
            (function* () {
              // With an explicit initial value, fold it in from the start; do
              // not overwrite it with the first element (that is only the seed
              // when no initial value was supplied).
              //
              // The accumulator is a JS number while the fast path holds, and
              // becomes a boxed expression the moment the compiled reducer
              // returns anything else. The gate above checks the SEED and the
              // ELEMENTS are real, but not the reducer's RESULT: `(z, k) ↦ z²
              // + c` with a complex `c` (declared or a literal) compiles to a
              // lambda that returns a `{re, im}` object, and the body was
              // compiled with `z` analyzed real — feeding that object back in
              // computes `z * z` on an object (`re: null`), and boxing the
              // result at the end raised `unexpected-mathjson` from `.N()`
              // while `.evaluate()` was correct (reported by Tycho against
              // 0.112.0/0.113.0). The FIRST non-number result is trustworthy
              // (every input to that call was a number), so that step is
              // redone through the interpreted reducer from the previous,
              // still-numeric accumulator, and the fold stays interpreted
              // from there. The static result type cannot decide this
              // upstream: such a body types the wide `number`.
              let accumulator: number | Expression = hasInitial ? seed.re : NaN;
              let first = true;
              let empty = true;
              for (const item of collection.each()) {
                empty = false;
                if (first && !hasInitial) accumulator = item.re;
                else if (typeof accumulator === 'number') {
                  const next: unknown = compiled.run!(accumulator, item.re);
                  accumulator =
                    typeof next === 'number'
                      ? next
                      : stepInterp(ce.number(accumulator), item);
                } else accumulator = stepInterp(accumulator, item);
                first = false;
                yield;
              }
              if (enumerationDeclinedAfterWalk(collection, empty ? 0 : 1))
                return undefined;
              // A seedless fold of an empty collection has nothing to seed
              // from — `Nothing`, as the interpreted path answers.
              if (empty && !hasInitial) return ce.Nothing;
              return typeof accumulator === 'number'
                ? ce.expr(accumulator)
                : accumulator;
            })(),
            ce._timeRemaining,
            ce._deadlineFrame
          );
        }
      }
      // We don't have a compiled function, so we need to use the
      // interpreted version.
      const f = applicable(fn);
      // A reducer that produced no value is a computation failure: fold in
      // the marker rather than the erasure symbol.
      const step = (acc: Expression, x: Expression): Expression =>
        f([acc, x]) ?? absenceMarker(ce, collection);

      if (!hasInitial) {
        // SEEDLESS: seed with the FIRST element and fold from the second —
        // the convention of `Scan` and of the compiled fast path above (ruled
        // 2026-08-09). The previous encoding folded from the `Nothing`
        // sentinel, which only looked right for a reducer that splices it
        // away (`Add`): `Reduce([1, 2, 3], (a, b) => a - b)` answered -6
        // (`((nothing - 1) - 2) - 3`) where `Scan`'s last element is -4, and a
        // reducer that does not splice leaked `Nothing` into the result
        // (`Reduce([2, 3, 2], Power)` → `Nothing^12`). It also made the
        // `Nothing` sentinel the accumulator's first VALUE, which apply-time
        // validation rejects for an annotated reducer.
        return run(
          (function* (): Generator<
            Expression | undefined,
            Expression | undefined
          > {
            let acc: Expression | undefined = undefined;
            for (const x of collection.each()) {
              acc = acc === undefined ? x : step(acc, x);
              yield acc;
            }
            if (
              enumerationDeclinedAfterWalk(
                collection,
                acc === undefined ? 0 : 1
              )
            )
              return undefined;
            // Nothing to seed from: an empty seedless fold has no value.
            return acc ?? ce.Nothing;
          })(),
          ce._timeRemaining,
          ce._deadlineFrame
        );
      }

      let walked = 0;
      const folded = run(
        reduceCollection<Expression>(
          collection,
          (acc, x) => {
            walked += 1;
            return step(acc, x);
          },
          seed
        ) as Generator<Expression | undefined, Expression | undefined>,
        ce._timeRemaining,
        ce._deadlineFrame
      );
      if (enumerationDeclinedAfterWalk(collection, walked)) return undefined;
      return folded;
    },
  },

  // Mathematica `Fold[f, x, list]`: a thin variant of `Reduce` (Haskell
  // `foldl`) with the argument order flipped so the binary function comes
  // first and the collection last. `Fold(f, x, {a, b, c}) = f(f(f(x, a), b),
  // c)`. Canonicalizes directly to the equivalent `Reduce(list, f, x)`, so it
  // shares Reduce's evaluation, laziness, and inert-when-symbolic behavior.
  Fold: {
    description:
      'Fold a collection to a single value, applying a binary function f(accumulator, element) left to right from an initial value.',
    complexity: 8200,
    lazy: true,
    // Design D phase 2: `Reduce`'s contextual slot with the operands flipped —
    // the callback comes FIRST and its element parameter is solved from the
    // collection at operand 2. The accumulator stays bare (see `Reduce`). The
    // stamp survives this operator's rewrite into a `Reduce`: it runs before
    // the canonical handler, on the raw literal the handler then reuses.
    signature:
      '(reducer: callback<(unknown, T) -> unknown>, initial: value, collection<T>) -> value where T',
    canonical: (ops, { engine }) => {
      const fn = canonicalCallbackOperand(ops[0], {
        operator: 'Fold',
        supply: ACCUMULATOR_SUPPLY,
      });
      const initial = ops[1]?.canonical;
      const collection = checkCollectionOperand(engine, ops[2]);
      if (!fn || !initial?.isValid || !collection.isValid) return null;
      return engine._fn('Reduce', [collection, fn, initial]);
    },
  },

  // Julia `accumulate`: a cumulative fold that keeps the SAME length as the
  // input (unlike Haskell/Wolfram `scanl`, which prepends the seed). Without an
  // initial value, `y1 = x1` and `yk = f(y(k-1), xk)`; with an initial value,
  // `y1 = f(initial, x1)`. Lazy — the running accumulator is computed
  // incrementally, so `Take(Scan(Range(1, 10^9), Add), 5)` stays fast.
  Scan: {
    description:
      'Return the cumulative fold of a collection: a same-length collection whose k-th element is the running result of applying a binary function left to right (optionally seeded by an initial value).',
    complexity: 8200,
    lazy: true,
    // Design D phase 2: `Reduce`'s contextual slot verbatim — the reducer is
    // `(accumulator, element)`, the element is stamped from the source and the
    // accumulator stays bare (see `Reduce` for why a fold never stamps its
    // accumulator). The RESULT stays with the `type:` handler below: the
    // source's shape with the fold's result as its elements.
    signature:
      '(collection<T>, reducer: callback<(unknown, T) -> unknown>, initial: value?) -> indexed_collection where T',
    // Same shape/indexed-ness as the source, but elements are the fold's
    // result type (mirrors Map).
    type: (ops) => {
      const resultType = foldResultType(ops[0], ops[1], ops[2]);
      if (!resultType || resultType === 'unknown' || resultType === 'any')
        return ops[0].type;
      return mapResultType(ops[0].type.type, resultType);
    },
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'Scan',
        supply: ACCUMULATOR_SUPPLY,
      });
      if (!collection.isValid || !fn) return null;
      // An initial value is optional, but when one is PROVIDED it must not be
      // silently dropped if invalid — otherwise `Scan(xs, f, Divide(1))` would
      // fold unseeded and diverge. Keep the (canonicalized) operand so the
      // standard error machinery surfaces the error.
      if (ops[2] !== undefined)
        return engine._fn('Scan', [collection, fn, ops[2].canonical]);
      return engine._fn('Scan', [collection, fn]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      elementMemo: true,
      count: (expr) => (isFunction(expr) ? expr.op1.count : undefined),
      isEmpty: (expr) =>
        isFunction(expr) ? expr.op1.isEmptyCollection : undefined,
      isFinite: (expr) =>
        isFunction(expr) ? expr.op1.isFiniteCollection : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const hasInitial = expr.ops.length >= 3;
        const initial = expr.ops[2];
        const source = expr.op1.each();
        let acc: Expression | undefined = undefined;
        let started = false;
        return {
          next: () => {
            const { value, done } = source.next();
            if (done) return { value: undefined, done: true };
            if (!started) {
              started = true;
              acc = hasInitial
                ? (f([initial, value]) ?? absenceMarker(expr.engine, expr.op1))
                : value;
            } else {
              acc = f([acc!, value]) ?? absenceMarker(expr.engine, expr.op1);
            }
            return { value: acc!, done: false };
          },
        };
      },
      // The k-th cumulative element requires folding the first k source
      // elements; O(k) per call, so this stays cheap for the small indices
      // `Take` requests. Mirrors `Iterate`'s fold-from-the-start `at`.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const f = applicable(expr.op2);
        if (!f) return undefined;
        const hasInitial = expr.ops.length >= 3;
        const initial = expr.ops[2];
        let i = 0;
        let acc: Expression | undefined = undefined;
        for (const item of expr.op1.each()) {
          i += 1;
          if (i === 1)
            acc = hasInitial
              ? (f([initial, item]) ?? absenceMarker(expr.engine, expr.op1))
              : item;
          else acc = f([acc!, item]) ?? absenceMarker(expr.engine, expr.op1);
          if (i === index) return acc;
        }
        return undefined;
      },
    },
  },

  // Julia/R `diff`, Wolfram `Differences`: the successive differences of a
  // collection, `yk = x(k+1) − xk`. Length n−1. Lazy — keeps only the previous
  // element.
  Differences: {
    description:
      'Return the successive differences of a collection: a collection whose k-th element is `x(k+1) − xk`, of length one less than the input.',
    complexity: 8200,
    lazy: true,
    signature: '(collection<any>) -> indexed_collection',
    type: (ops) => {
      const elt = collectionElementType(ops[0].type.type) ?? 'number';
      // Each element is a SUBTRACTION of two source elements, so echoing the
      // source's element type is only honest when subtraction is closed over
      // it. For a numeric source it is. For a non-numeric one it is not:
      // `Differences("abc")` would claim `list<character>` for a list of
      // unevaluated `Subtract` nodes (a character minus a character is not a
      // character, and is not defined at all). Report the element type as
      // unknown there rather than a type the runtime cannot produce; the
      // runtime itself stays inert.
      if (!isSubtype(elt, 'number')) return 'list';
      return { kind: 'list', elements: elt };
    },
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      if (!collection.isValid) return null;
      // A source whose elements are PROVABLY not numbers (a string's
      // characters, a list of booleans) cannot be differenced: every element
      // of the result would be an `incompatible-type` error from `Subtract`.
      // Refuse the whole call with one typed error at the operand instead of
      // building a lazy view that manufactures an error per element. Sources
      // whose element type is unknown or merely wider than `number` are left
      // alone — they may well hold numbers at run time.
      const elt = collectionElementType(collection.type.type);
      if (elt !== undefined && engine.type(elt).isDisjointFrom('number'))
        return engine._fn('Differences', [
          engine.typeError(
            parseType('collection<number>'),
            collection.type,
            collection
          ),
        ]);
      return engine._fn('Differences', [collection]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const c = expr.op1.count;
        if (c === undefined) return undefined;
        if (!Number.isFinite(c)) return Infinity;
        return Math.max(0, c - 1);
      },
      isFinite: (expr) =>
        isFunction(expr) ? expr.op1.isFiniteCollection : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        const first = source.next();
        if (first.done)
          return { next: () => ({ value: undefined, done: true }) };
        let prev = first.value as Expression;
        return {
          next: () => {
            const { value, done } = source.next();
            if (done) return { value: undefined, done: true };
            // Build each difference as a canonical subtraction and evaluate it,
            // so exact operands stay exact (e.g. 3/4 − 1/2 = 1/4, not 0.25).
            const diff = expr.engine
              .function('Subtract', [value, prev])
              .evaluate();
            prev = value as Expression;
            return { value: diff, done: false };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const a = expr.op1.at(index);
        const b = expr.op1.at(index + 1);
        if (a === undefined || b === undefined) return undefined;
        return expr.engine.function('Subtract', [b, a]).evaluate();
      },
    },
  },

  // Haskell `takeWhile`: the leading run of elements for which the predicate is
  // True; stops at (and excludes) the first element that is not True.
  TakeWhile: {
    description: [
      'Return the leading elements of the collection for which the predicate returns True, stopping at the first element that does not.',
    ],
    complexity: 8200,
    lazy: true,
    // Design D phase 1: the element-of link lives in the SIGNATURE (mirrors
    // `Filter`). The RESULT stays with the `type:` handler — the source's own
    // collection kind and indexedness, which the type language cannot express
    // (§7 rule 1).
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>) -> collection where T',
    // Preserve the source's element type / indexed-ness (mirrors Filter).
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'TakeWhile',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!collection.isValid || !fn) return null;
      return engine._fn('TakeWhile', [collection, fn]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      elementMemo: true,
      // Length is unknown without enumeration. For a finite source we can count
      // the taken prefix (bounded); an infinite source stays unknown.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        // Finiteness is not enumerability: `Take(xs, 2)` over a valueless `xs`
        // is finite (capped at 2) yet has nothing to walk, and the loop below
        // would report that empty walk as a count of 0. See `isEnumerableSource`.
        if (!isEnumerableSource(expr.op1)) return undefined;
        let n = 0;
        for (const _ of expr.each()) n++;
        return n;
      },
      // True if the source is finite (the taken prefix is then finite too);
      // for an infinite/unknown source we cannot know (it MAY be finite).
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isFiniteCollection === true
          ? true
          : undefined,
      // Empty iff the first source element already fails the predicate. Cheap
      // (one element), and keeps the collection materializable.
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isEmptyCollection === true) return true;
        // See `Filter.isEmpty`: an unenumerable source leaves this unknown
        // rather than reporting the empty walk as an empty prefix.
        if (!isEnumerableSource(expr.op1)) return undefined;
        const first = expr.op1.each().next();
        if (first.done) return true;
        const f = applicable(expr.op2);
        if (!f) return undefined;
        const applied = f([first.value]);
        if (sym(applied) === 'True') return false;
        // An element-valued predicate failure is EMITTED by the iterator (see
        // `predicateErrorValue`), so the prefix holds that one `Error` element
        // and the result is not empty.
        return predicateErrorValue(applied) === undefined;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        let stopped = false;
        let count = 0;
        const limit = expr.engine.iterationLimit;
        return {
          next: () => {
            if (stopped) return { value: undefined, done: true };
            const { value, done } = source.next();
            if (done) {
              stopped = true;
              return { value: undefined, done: true };
            }
            count += 1;
            if (count > limit) {
              throw new CancellationError({
                cause: 'iteration-limit-exceeded',
                message: `Iteration limit of ${limit} exceeded while evaluating TakeWhile()`,
              });
            }
            const pred = f([value]);
            // A predicate that cannot be applied at all is a broken predicate:
            // throw, as Filter does. Otherwise take while the result is exactly
            // True; stop at the first non-True result (False OR undetermined).
            if (pred === undefined) {
              throw new Error(
                `Invalid TakeWhile predicate. ${spellCheckMessage(expr.op2)}`
              );
            }
            if (sym(pred) === 'True') return { value, done: false };
            stopped = true;
            // The predicate failed on this ELEMENT (e.g. its `Typed` parameter
            // annotation rejected it): whether the element belongs to the
            // prefix is UNDECIDED, and silently stopping would be
            // indistinguishable from a legitimate `False`. Emit that `Error`
            // value in the element's place — as `Filter`/`Map` do — then
            // terminate: no later element can be in the prefix either.
            const err = predicateErrorValue(pred);
            if (err) return { value: err, done: false };
            return { value: undefined, done: true };
          },
        };
      },
      // The k-th taken element: iterate the guarded TakeWhile iterator (which
      // applies the predicate, stops at the first non-True, and caps the walk
      // at `ce.iterationLimit`) until the k-th element is reached or the prefix
      // ends. Iterating the raw `expr.op1.each()` instead would bypass the
      // guard and run unbounded on an infinite source once the deadline is
      // removed. Swallow `iteration-limit-exceeded` and report `undefined`
      // (unknown), mirroring `count`/`isEmpty`; any other cancellation
      // (deadline/timeout) propagates.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        try {
          let i = 0;
          for (const item of expr.each()) {
            i += 1;
            if (i === index) return item;
          }
        } catch (e) {
          if (
            e instanceof CancellationError &&
            e.cause === 'iteration-limit-exceeded'
          )
            return undefined;
          throw e;
        }
        return undefined;
      },
    },
  },

  // Haskell `dropWhile`: discard the leading run of elements for which the
  // predicate is True, then yield everything after (the predicate is not
  // applied past the first non-True element).
  DropWhile: {
    description: [
      'Return the collection with its leading elements for which the predicate returns True removed; the remaining elements are returned unfiltered.',
    ],
    complexity: 8200,
    lazy: true,
    // Design D phase 1: as `TakeWhile` — the result stays with the `type:`
    // handler (§7 rule 1).
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>) -> collection where T',
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'DropWhile',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!collection.isValid || !fn) return null;
      return engine._fn('DropWhile', [collection, fn]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      elementMemo: true,
      // For a finite source we can count the retained suffix (bounded); an
      // infinite/unknown source stays unknown.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        // Finiteness is not enumerability: `Take(xs, 2)` over a valueless `xs`
        // is finite (capped at 2) yet has nothing to walk, and the loop below
        // would report that empty walk as a count of 0. See `isEnumerableSource`.
        if (!isEnumerableSource(expr.op1)) return undefined;
        let n = 0;
        for (const _ of expr.each()) n++;
        return n;
      },
      // Delegates to the source for finite sources; unknown otherwise.
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isFiniteCollection === true
          ? true
          : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        let dropping = true;
        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              if (dropping) {
                const pred = f([value]);
                if (sym(pred) === 'True') continue;
                dropping = false;
                // Mirror of `TakeWhile`: an element-valued predicate failure
                // (see `predicateErrorValue`) leaves it UNDECIDED whether this
                // element is still part of the dropped run, so including it
                // silently as a value would be indistinguishable from a
                // legitimate `False`. Emit the `Error` in the element's place;
                // the rest of the source is not predicate-dependent (the
                // predicate is never applied past the first non-True element)
                // and passes through unchanged.
                const err = predicateErrorValue(pred);
                if (err) return { value: err, done: false };
              }
              return { value, done: false };
            }
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        let i = 0;
        for (const item of expr.each()) {
          i += 1;
          if (i === index) return item;
        }
        return undefined;
      },
    },
  },

  // Map then flatten one level: apply `f` to each element and splice the
  // result into the output if it is a collection, otherwise include it as a
  // single element (singleton coercion — a CAS should not error on
  // `FlatMap([1, 2], x -> x^2)`).
  FlatMap: {
    description: [
      'Map a function over a collection and concatenate the results into a single list, splicing collection-valued results and keeping scalar results as single elements.',
    ],
    complexity: 8200,
    lazy: true,
    // Design D phase 1: the element-of link lives in the SIGNATURE. `U` is a
    // RESULT-side variable (contract clause 3): the callback's own result — not
    // its parameters — contributes to it, for an inline literal and a named
    // callback alike (R-D2′). The slot is deliberately `(T) -> U` and not
    // `(T) -> collection<U> | U`: `S` describes the STAMP, never the operator's
    // tolerance, and the scalar-result singleton lift is the `type:` handler's
    // calculation below (§7 rule 2).
    signature:
      '(collection<T>, mapping: callback<(T) -> U>) -> list where T, U',
    type: (ops) => {
      const resultType = callbackResultType(ops[1]);
      if (!resultType || resultType === 'unknown' || resultType === 'any')
        return parseType('list');
      // A `string` callback result is NOT peeled: the runtime splice keeps a
      // string whole (strings are atomic under deep descent), so the element
      // type is the string itself, not `character`. Type and value must agree.
      const inner =
        resultType === 'string' ? undefined : collectionElementType(resultType);
      return { kind: 'list', elements: inner ?? resultType };
    },
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'FlatMap',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!collection.isValid || !fn) return null;
      return engine._fn('FlatMap', [collection, fn]);
    },
    evaluate: (ops, { engine, materialization }) => {
      if (!materialization) return undefined;
      const expr = engine._fn('FlatMap', ops);
      // Only materialize when the source is finite; an infinite source stays
      // lazy (consumers can still bound it with Take).
      if (!ops[0].isFiniteCollection) return undefined;
      return engine._fn('List', Array.from(expr.each()) as Expression[]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      elementMemo: true,
      count: (expr) =>
        isFunction(expr) && expr.op1.isEmptyCollection === true ? 0 : undefined,
      isEmpty: (expr) =>
        isFunction(expr) && expr.op1.isEmptyCollection === true
          ? true
          : undefined,
      // A finite source is NECESSARY but not SUFFICIENT: the flattened stream
      // is finite only if each of the finitely many inner results is finite
      // too, and a callback returning an INFINITE inner collection
      // (`FlatMap([1, 2], n => Range(1, Infinity))`) makes the result
      // infinite from a finite source. Since every finite-guarded consumer
      // (`Reduce`, `Sum`, …) enumerates on the strength of this facet, `true`
      // is claimed only when BOTH halves are provable, from the callback's
      // declared RESULT type (contract clause 3, the same type
      // `callbackResultType` feeds the `type:` handler):
      // - a result provably disjoint from `collection` is a SCALAR — the
      //   iterator emits it as a single element, so it cannot diverge;
      // - a collection result must pin a fixed extent statically
      //   (`staticCollectionDims`, the only type-level finiteness evidence
      //   this system has: `vector<2>` → `[2]`; `list<number>` → `[-1]`,
      //   i.e. open, and `list` is NOT a finiteness claim here — `Cycle` is
      //   `list`-typed and infinite).
      // Anything else — an `unknown` result, an open-length list, a bare
      // `collection` — is `undefined`, "not known", not `false`.
      //
      // `count` stays `undefined` regardless: a length is not a shape
      // declaration — it would have to apply the callback to every element.
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        // A provably infinite source keeps reporting `false` (the reverse
        // direction is untouched by this handler's tightening).
        const source = expr.op1.isFiniteCollection;
        if (source !== true) return source;
        const inner = callbackResultType(expr.op2);
        if (inner === undefined) return undefined;
        if (provablyDisjoint(inner, 'collection')) return true;
        const dims = staticCollectionDims(inner);
        return dims !== null && dims.every((d) => d >= 0) ? true : undefined;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        let inner: Iterator<Expression> | null = null;
        return {
          next: () => {
            while (true) {
              if (inner) {
                const r = inner.next();
                if (!r.done) return { value: r.value, done: false };
                inner = null;
              }
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              const mapped = f([value]) ?? absenceMarker(expr.engine, expr);
              // A STRING result is a single element, not a collection to
              // splice: strings are atomic under every deep-descent walk
              // (`docs/STRING_ROADMAP.md`, design constraint 6), so a
              // `(T) -> string` callback contributes one string per source
              // element rather than exploding into its characters.
              if (mapped.isCollection && !isString(mapped))
                inner = mapped.each();
              else return { value: mapped, done: false };
            }
          },
        };
      },
      // Nested access requires walking the flattened stream up to `index`
      // (O(index)); FlatMap is `list`-typed, so an `at` handler is required.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        let i = 0;
        for (const item of expr.each()) {
          i += 1;
          if (i === index) return item;
        }
        return undefined;
      },
    },
  },

  Join: {
    description: [
      'Join the elements of some collections into a flat collection.',
      'A tuple operand is appended as a single element, not spliced.',
      'When every operand is a string, the result is their concatenation as a string: `Join` is the variadic string concatenation.',
    ],
    complexity: 8200,
    // The LEADING arm is the string-preservation rule: concatenating strings
    // yields a string, which makes `Join` THE variadic string concatenation
    // (`docs/STRING_ROADMAP.md`, "`Join` vs. `StringJoin`"). The trigger is
    // EVERY operand being a `string`; a mixed call such as
    // `Join("ab", ["c", "d"])` falls back to the generic arm and yields a
    // `list<character>`, so the result kind is readable from the operand
    // kinds with no "majority wins" subtlety. `character` is a SIBLING of
    // `string` in the lattice rather than a subtype, so a character operand
    // makes the call mixed too.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    // The concrete answer is computed by the `type:` handler
    // (`joinResultType`), which owns the all-string case; the arm is what
    // makes the promise readable in the signature.
    // RE-SEGMENTATION CAVEAT: concatenation can MERGE adjacent grapheme
    // clusters or split one apart, so `Length(Join(a, b))` is not in general
    // `Length(a) + Length(b)` — joining `"x"` and a lone COMBINING ACUTE
    // ACCENT produces ONE character, not two. That is inherent to Unicode
    // grapheme segmentation, not a defect (`docs/STRING_ROADMAP.md`, design
    // constraint 3).
    signature: '((T+) -> T where T: string) & ((collection<any>*) -> collection)',
    // Same-head flatten: `Join(Join(…inner), …outer)` → `Join(…inner, …outer)`
    // (Change 2 of `docs/plans/2026-08-09-lazy-collection-evaluate-design.md`).
    // Exact by construction — the head is unchanged, so every operand keeps
    // the position semantics it had (an inner `Join` is a collection operand
    // being spliced; its own tuple operands stay atomic after the splice).
    // See the `Append` handler below for the validation-ordering guard and for
    // why there are NO cross-head (`Join`/`Append`) rewrites.
    canonical: (ops, { engine: ce }) => {
      // Run the framework's default flatten step (Sequence-splice + Nothing-
      // drop) that this custom canonical handler would otherwise short-circuit.
      ops = flatten(ops);
      const args =
        validateArguments(ce, ops, JOIN_SIGNATURE, false, false) ?? ops;
      if (args.some((x) => !x.isValid)) return ce._fn('Join', args);

      const source = args[0];
      if (
        source !== undefined &&
        isFunction(source, 'Join') &&
        source.isCanonical &&
        // Defensive: a `Join` never types as a tuple (`joinResultType` returns
        // a list/set/record/dictionary), but an atomic operand must never be
        // spliced.
        !isAtomicJoinOperand(source)
      )
        return ce._fn('Join', [...source.ops, ...args.slice(1)]);

      return ce._fn('Join', args);
    },
    type: joinResultType,
    collection: {
      isEnumerable: enumerableFromAllSources,
      isLazy: (_expr) => true,
      // Without this, `materialize()` never reaches its key-value branch (it
      // tests `elttype` against `tuple<string, any>`), the node is not
      // indexed, and a dictionary-kind `Join` fell through to
      // `engine.function('Set', …)` — coming back as a SET OF ENTRY TUPLES.
      // The HEAD changed, not just the element count.
      elttype: (expr) =>
        producesKeyed(expr) ? parseType('tuple<string, any>') : undefined,
      // A set-kind result is indexed by walking the deduplicated enumeration
      // from the start (`distinctAt`), so sequential indexing would be
      // quadratic without a cache. `Join`'s elements are exactly its
      // operands' elements, so they are as pure as those — the same premise
      // `Map` relies on for its own `elementMemo`.
      elementMemo: true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const isSet = producesSet(expr);
        // A keyed result must read every entry before it can merge, so an
        // infinite operand makes it unanswerable outright.
        if (producesKeyed(expr) && expr.ops.some((op) => op.count === Infinity))
          return undefined;
        let total = 0;
        for (const op of expr.ops) {
          if (isAtomicJoinOperand(op)) {
            total += 1;
            continue;
          }
          const count = op.count;
          if (count === undefined) return undefined;
          if (!Number.isFinite(count)) {
            // A concatenation containing an infinite operand is infinite
            // whatever follows it, so answer now rather than scanning on —
            // a LATER operand with an unknown count would otherwise mask a
            // length we already know.
            //
            // Under set semantics that holds only when the infinite operand
            // is ITSELF a set: its elements are already distinct, and `Join`
            // passes them through unchanged, so deduplication cannot collapse
            // infinitely many of them into finitely many. Any other infinite
            // operand may repeat one value forever, so the number of DISTINCT
            // elements is not decidable by a walk that terminates.
            if (!isSet) return Infinity;
            return op.type.matches('set<any>') ? Infinity : undefined;
          }
          total += count;
        }
        // A set-kind result counts DISTINCT elements and a keyed one counts
        // distinct KEYS: the operands may repeat each other
        // (`Join(Set(1, 2), Set(2, 3))` concatenates 4 elements but IS a
        // 3-element set), so the concatenated length is only an upper bound.
        // Both are counted by walking the rewritten enumeration the
        // `iterator` handler already produces.
        return producesMergedView(expr) ? distinctCount(expr, total) : total;
      },
      // `isEmpty` and `isFinite` are declared explicitly rather than left to
      // the defaults, which derive both from `count`. A set-kind `count` can
      // answer `undefined` — its deduplicating walk is bounded — and routing
      // these through it would drag decidable answers down with it, including
      // `materialize()`, which bails outright when `isEmptyCollection` is
      // `undefined`, so the value would stop previewing too.
      //
      // Emptiness is dedup-invariant outright: deduplication cannot empty a
      // non-empty collection, nor fill an empty one.
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops === 0) return true;
        // An atomic (tuple) operand IS one element, so it is never empty.
        return kleeneAnd(
          expr.ops.map((op) =>
            isAtomicJoinOperand(op) ? false : op.isEmptyCollection
          )
        );
      },
      // Finiteness is NOT dedup-invariant, and the implication runs the
      // opposite way from the one it is tempting to write down: deduplication
      // can only SHRINK a collection, so it can turn an infinite enumeration
      // into a finite set — `Join(Set(1), Repeat(1))` enumerates forever and
      // holds exactly one element. So an infinite operand settles finiteness
      // only when it is ITSELF a set (already distinct, and `Join` passes its
      // elements through unchanged); otherwise the answer is UNKNOWN, which
      // is the convention `Dedup` already follows for the same reason.
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        const isSet = producesSet(expr);
        return kleeneAnd(
          expr.ops.map((op) => {
            if (isAtomicJoinOperand(op)) return true;
            const finite = op.isFiniteCollection;
            if (finite !== false || !isSet) return finite;
            return op.type.matches('set<any>') ? false : undefined;
          })
        );
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        // A keyed result answers from the MERGED entries: an entry whose key
        // was overwritten by a later one is no longer a member, so asking the
        // operands directly would report `("b", 2)` present in a dictionary
        // whose `b` is now 3.
        if (producesKeyed(expr)) {
          // An operand that cannot be ENUMERATED yields nothing, and a walk
          // over nothing is indistinguishable from a walk that found nothing:
          // without this gate a keyed result over a valueless (but
          // dictionary-typed) operand reports a definite `false` for a member
          // it simply cannot see. `distinctCount` and `distinctAt` gate on the
          // same predicate, for the same reason.
          if (expr.isEnumerableCollection !== true) return undefined;
          // The merged walk can decline (see `keyedMergeIterator`), and an
          // undecidable membership is `undefined`, not `false`.
          try {
            for (const entry of expr.each())
              if (entry.isSame(target)) return true;
            return false;
          } catch (e) {
            if (
              e instanceof CancellationError &&
              e.cause === 'iteration-limit-exceeded'
            )
              return undefined;
            throw e;
          }
        }
        // Three-valued: an operand that cannot decide membership leaves the
        // whole query undecided (`.some()` would report a definite `false`).
        return kleeneOr(
          expr.ops.map((op) =>
            isAtomicJoinOperand(op) ? op.isSame(target) : op.contains(target)
          )
        );
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const sources = expr.ops.map((op) =>
          isAtomicJoinOperand(op) ? op : op.each()
        );
        let index = 0;
        const concatenation: Iterator<Expression> = {
          next: () => {
            while (true) {
              if (index >= sources.length)
                return { value: undefined, done: true };
              const source = sources[index];
              if (!isIterator(source)) {
                // An atomic (tuple) operand contributes exactly one element
                index += 1;
                return { value: source, done: false };
              }
              const { value, done } = source.next();
              if (!done) return { value, done: false };
              index += 1;
            }
          },
        };
        // A keyed result merges its entries by key (last value wins), and a
        // set-kind one enumerates each element ONCE however often the operands
        // repeat it. A keyed merge cannot stream, so it declines rather than
        // yielding a wrong prefix — see `mergeKeyedEntries`, and
        // `keyedMergeIterator` for why that decline is thrown.
        if (producesKeyed(expr))
          return keyedMergeIterator(
            concatenation,
            expr.engine.maxCollectionSize,
            'Join'
          );
        return producesSet(expr)
          ? deduplicatingIterator(
              concatenation,
              expr.engine.iterationLimit,
              expr.operator
            )
          : concatenation;
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || !isFunction(expr)) return undefined;

        const countOf = (op: Expression): number | undefined =>
          isAtomicJoinOperand(op) ? 1 : op.count;

        // A set-kind result has to be indexed through the DEDUPLICATED
        // enumeration, and a keyed one through the MERGED entries, so that
        // `at`, `each` and `count` agree; the per-operand arithmetic below
        // counts repeats and would skip past elements. The concatenated
        // length is computed only if a negative index asks for it (see
        // `distinctAt`).
        if (producesMergedView(expr)) {
          return distinctAt(expr, index, () => {
            let total = 0;
            for (const op of expr.ops) {
              const count = countOf(op);
              if (count === undefined || !Number.isFinite(count))
                return undefined;
              total += count;
            }
            return total;
          });
        }

        // A negative index counts from the end of the joined collection
        if (index < 0) {
          let total = 0;
          for (const op of expr.ops) {
            const count = countOf(op);
            if (count === undefined || !Number.isFinite(count))
              return undefined;
            total += count;
          }
          index = total + index + 1;
        }
        if (index < 1) return undefined;

        // Walk the sources, skipping over each one's elements
        for (const op of expr.ops) {
          const count = countOf(op);
          if (count === undefined) return undefined;
          if (index <= count)
            return isAtomicJoinOperand(op) ? op : op.at(index);
          index -= count;
        }
        return undefined;
      },
    },
  },

  // Mathematica `Append[collection, element]`: the collection with the trailing
  // elements added at the end. Lazy, like `Join` — it wraps its source rather
  // than materializing, so appending to an infinite collection stays inert
  // until forced.
  //
  // VARIADIC (`docs/plans/2026-08-09-lazy-collection-evaluate-design.md`,
  // Change 2 v3.1): `Append(c, v₁, …, vₖ)` appends each trailing operand as ONE
  // element, in order. The binary MathJSON form `["Append", c, v]` is the k = 1
  // case, so this is fully backward compatible. `value+`, not `scalar+`: an
  // appended value is atomic whatever it is — a row appended to a matrix
  // (`Append([[1,2],[3,4]], [5,6])` → 3 rows) and a point appended to a point
  // list (`Append([(1,2)], (3,4))` → 2 points) are load-bearing behaviors.
  Append: {
    description: ['Add one or more elements to the end of a collection.'],
    complexity: 8200,
    signature: '(collection<any>, value+) -> collection',
    // Same-head flatten: `Append(Append(c, …vs), …ws)` → `Append(c, …vs, …ws)`,
    // so an accumulator loop (`xs = Append(xs, v)`) builds a node of bounded
    // DEPTH — every structural walker (serialization, hashing, `isSame`,
    // `count`, type computation) then stays out of deep recursion.
    //
    // Same-head ONLY. The `Join`/`Append` cross-head rewrites of the v3 draft
    // were refuted and must not be reintroduced: `Append` ENUMERATES a tuple
    // source while `Join` holds a tuple operand ATOMIC (`Append((1,2),3)` has
    // 3 elements, `Join((1,2),[3])` has 2), and a list-wrapper splice erases
    // the `Nothing` marker that `Append`'s validation would flag.
    //
    // Validation ordering: the rewrite runs AFTER the framework's flatten and
    // signature validation, so an operand that would fail validation (a
    // `Nothing`/missing value, a non-collection source, an error marker)
    // declines the rewrite and keeps today's error result on every route.
    canonical: (ops, { engine: ce }) => {
      // Run the framework's default flatten step (Sequence-splice + Nothing-
      // drop) that this custom canonical handler would otherwise short-circuit.
      ops = flatten(ops);
      const args =
        validateArguments(ce, ops, APPEND_SIGNATURE, false, false) ?? ops;
      if (args.length < 2 || args.some((x) => !x.isValid))
        return ce._fn('Append', args);

      const source = args[0];
      // The operands are already canonical, so an inner `Append` has itself
      // been flattened: one level of splicing keeps the chain at depth 1.
      if (
        isFunction(source, 'Append') &&
        source.isCanonical &&
        source.nops >= 2
      )
        return ce._fn('Append', [...source.ops, ...args.slice(1)]);

      return ce._fn('Append', args);
    },
    type: appendResultType,
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // Without this, `materialize()` never reaches its key-value branch (it
      // tests `elttype` against `tuple<string, any>`), the node is not
      // indexed, and a dictionary-kind `Append` fell through to
      // `engine.function('Set', …)` — coming back as a SET OF ENTRY TUPLES.
      // The HEAD changed, not just the element count.
      elttype: (expr) =>
        producesKeyed(expr) ? parseType('tuple<string, any>') : undefined,
      // See `Join`: a set-kind result indexes by walking, so cache elements.
      elementMemo: true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        // A set-kind result counts DISTINCT elements: an appended value the
        // source already holds adds nothing (`Append(Set(1, 2), 2)` is still
        // a 2-element set), so the concatenated length is only an upper bound.
        if (producesKeyed(expr) && !Number.isFinite(count)) return undefined;
        if (producesMergedView(expr)) {
          if (!Number.isFinite(count)) {
            // An infinite SOURCE keeps infinitely many distinct elements when
            // it is itself a set (already distinct, and `Append` passes its
            // elements through unchanged); appending finitely many values
            // cannot collapse that. Any other infinite source may repeat one
            // value forever — undecidable. See `Join`'s `count`.
            return expr.op1.type.matches('set<any>') ? Infinity : undefined;
          }
          return distinctCount(expr, count + expr.nops - 1);
        }
        if (!Number.isFinite(count)) return Infinity;
        return count + expr.nops - 1;
      },
      // See `Join`'s `isFinite`: deduplication can only SHRINK, so it can turn
      // an infinite enumeration into a finite set. An infinite source settles
      // finiteness only when it is itself a set (already distinct).
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        const finite = expr.op1.isFiniteCollection;
        if (finite !== false || !producesSet(expr)) return finite;
        return expr.op1.type.matches('set<any>') ? false : undefined;
      },
      // With at least one appended value the result is never empty. The 1-ary
      // identity form (`Append(c)`, valid in non-strict mode) has exactly the
      // source's elements, so delegate — as `count`/`isFinite` do — rather
      // than claiming non-empty for an empty source.
      // (Deduplication cannot empty a non-empty collection, so the set-kind
      // result needs no special case here.)
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops >= 2) return false;
        return expr.op1?.isEmptyCollection;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        // A keyed result answers from the MERGED entries: an appended entry
        // OVERWRITES a same-key entry of the source, so that source entry is
        // no longer a member and asking `expr.op1` directly would report
        // `("b", 2)` present in `Append(Dictionary(a: 1, b: 2), ("b", 3))`.
        // The merged walk can decline (see `keyedMergeIterator`), and an
        // undecidable membership is `undefined`, not `false`.
        if (producesKeyed(expr)) {
          // An operand that cannot be ENUMERATED yields nothing, and a walk
          // over nothing is indistinguishable from a walk that found nothing —
          // see the matching gate in `Join`'s keyed branch, and in
          // `distinctCount`/`distinctAt`.
          if (expr.isEnumerableCollection !== true) return undefined;
          try {
            for (const entry of expr.each())
              if (entry.isSame(target)) return true;
            return false;
          } catch (e) {
            if (
              e instanceof CancellationError &&
              e.cause === 'iteration-limit-exceeded'
            )
              return undefined;
            throw e;
          }
        }
        // An appended operand that matches settles the query; otherwise defer
        // to the source, propagating its UNDECIDED answer (`||` turned an
        // `undefined` source verdict into a definite `false`).
        if (expr.ops.slice(1).some((op) => op.isSame(target))) return true;
        return expr.op1.contains(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        // Index into the trailing (appended) operands, yielded one at a time
        // once the source is exhausted.
        let appended = 1;
        const concatenation: Iterator<Expression> = {
          next: () => {
            const { value, done } = source.next();
            if (!done) return { value, done: false };
            // Source exhausted: yield each appended element once, in order.
            if (appended < expr.nops)
              return { value: expr.ops[appended++], done: false };
            return { value: undefined, done: true };
          },
        };
        // A keyed result merges its entries by key (last value wins), so an
        // appended entry OVERWRITES a same-key one from the source. The merge
        // cannot stream, so it declines rather than yielding a wrong prefix —
        // see `keyedMergeIterator` for why that decline is thrown.
        if (producesKeyed(expr))
          return keyedMergeIterator(
            concatenation,
            expr.engine.maxCollectionSize,
            'Append'
          );
        // A set-kind result enumerates each element ONCE, so an appended value
        // the source already holds is not yielded again.
        return producesSet(expr)
          ? deduplicatingIterator(
              concatenation,
              expr.engine.iterationLimit,
              expr.operator
            )
          : concatenation;
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || !isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined || !Number.isFinite(count)) return undefined;
        const total = count + expr.nops - 1;
        // A set-kind result is indexed through the DEDUPLICATED enumeration
        // and a keyed one through the MERGED entries, so that `at`, `each` and
        // `count` agree; the positional arithmetic below counts repeats and
        // would skip past elements. (`total` is already known finite here —
        // the guard above returned.)
        if (producesMergedView(expr))
          return distinctAt(expr, index, () => total);
        // A negative index counts from the end of the appended collection.
        if (index < 0) index = total + index + 1;
        if (index < 1) return undefined;
        if (index <= count) return expr.op1.at(index);
        if (index <= total) return expr.ops[index - count];
        return undefined;
      },
    },
  },

  //
  // Operations on indexed collections
  //

  Field: {
    description: [
      'Access a named field of a value: `p.x` in Epsil.',
      'On a record or dictionary value, `Field(d, "x")` behaves exactly as `d["x"]` (`At` semantics, including the absence marker for a key a dictionary may not have).',
      'On a value of a NOMINAL type whose definition body has named fields (a record body, or a named-tuple body), the field is resolved through the type definition — the sanctioned accessor window of the nominal-types design (D6/§4.5b D16). This does not make the value a collection: `First(p)` and `p["x"]` keep rejecting.',
      'A field name that is not in a record/named-tuple definition is a static defect (the result type is `error`); on an unknown-typed operand the expression stays symbolic.',
    ],
    complexity: 8200,
    signature: '(value: any, field: string) -> unknown',
    type: (ops, { engine: ce }) => {
      // A QUALIFIED protocol member (P14): `Comparable.compare` is a function
      // VALUE, whose type is the requirement's signature (with `Self` left
      // opaque — the receiver is only known at the call site).
      const protocol = protocolOfSymbol(ce, ops[0]);
      if (protocol !== undefined) {
        const name = isString(ops[1]) ? ops[1].string : undefined;
        if (name === undefined) return 'unknown';
        return protocolMemberSignature(ce, protocol, name) ?? 'error';
      }
      const rt = fieldBearingType(ops[0].type.type);
      if (rt === undefined) return 'unknown';
      const name = isString(ops[1]) ? ops[1].string : undefined;
      // The ORDINARY field routes. `undefined` means none of them answered —
      // a settled non-field-bearing operand, or a name the record/named-tuple
      // body does not carry — which is where a protocol PROPERTY gets its turn
      // (P18) before the static defect is reported.
      const ordinary = ((): Type | undefined => {
        if (rt === 'none') return undefined;
        // An OBJECT layout is read exactly like a record body: the field list
        // is fixed at declaration, so a name it does not carry is a static
        // defect and gets NO absence marker. (Stores are what make the two
        // shapes differ, and a read is not a store.)
        if (rt.kind === 'record' || rt.kind === 'object') {
          // A record's key set is fixed: a known-absent field is a static
          // defect, not an out-of-band access.
          if (name !== undefined) return rt.elements[name];
          return withMarker(widen(...Object.values(rt.elements)) as Type);
        }
        if (rt.kind === 'tuple') {
          if (name !== undefined)
            return rt.elements.find((x) => x.name === name)?.type;
          return widen(...rt.elements.map((x) => x.type)) as Type;
        }
        // Dictionary: the key set is not part of the type — absence marker
        // (`At` parity).
        return withMarker(rt.values);
      })();
      if (ordinary !== undefined) return ordinary;
      if (name !== undefined) {
        const property = protocolPropertyType(ce, ops[0], name);
        if (property !== undefined) return property;
      }
      return 'error';
    },
    evaluate: ([base, field], { engine: ce, numericApproximation }) => {
      if (!isString(field)) return undefined;
      const name = field.string;

      // A QUALIFIED protocol member (P14). Keyed off the protocol REGISTRY,
      // never off a declaration: `DeclareProtocol` declares no value, so a
      // bare `Comparable` anywhere else stays an ordinary undeclared symbol.
      const protocol = protocolOfSymbol(ce, base);
      if (protocol !== undefined) {
        const value = protocolMemberValue(ce, protocol, name);
        // An unknown member (or a PROPERTY, which is phase 4) takes the
        // existing `unknown-field` path.
        return value ?? ce.error(['unknown-field', name], protocol.name);
      }

      /** The protocol-PROPERTY route (P18), consulted wherever the ordinary
       * field routes come up empty. `undefined` = no protocol answers. */
      const property = (): Expression | undefined =>
        evaluateProtocolProperty(ce, base, name, { numericApproximation });

      // A MUTABLE OBJECT: a pure load of the stored, already-evaluated value.
      // Dispatching on the VALUE's kind rather than on its static type is what
      // makes this exact: the layout is pinned on the instance at
      // construction, so the slots are the authority on what the object has,
      // whatever a later redeclaration did to the type of the same name.
      //
      // The read runs no user code and evaluates nothing (stores write
      // evaluated values), so it carries no effect label and needs none —
      // its cache consequence travels the per-object version dependency
      // channel instead, which `_field()` reports into. Objects are not
      // collections and this is not element access, so nothing here delegates
      // to `At` the way the dictionary arm below does.
      if (isObject(base)) {
        const value = base._field(name);
        if (value !== undefined) return value;
        // The field list is fixed at declaration, so a name the layout does
        // not carry is a defect, not an out-of-band access: no absence marker.
        // The protocol-property route gets its turn first, exactly as it does
        // on the record and named-tuple arms below — a conforming object may
        // answer a name that is not one of its stored fields — and the error
        // that follows names what IS stored.
        return (
          property() ??
          ce.error(
            ['unknown-field', name, [...base._slots.keys()].join(', ')],
            base.typeName
          )
        );
      }

      // An ABSENT base propagates the marker, exactly as a chained `At` does
      // (`d.zz.x` ≡ `d["zz"]["x"]` even through the miss).
      if (isAbsentValue(base)) return base;

      // A plain dictionary/record VALUE: exactly `d["x"]` — delegate to `At`
      // so the two surfaces can never drift (absence markers included).
      if (isDictionary(base))
        return ce.function('At', [base, field]).evaluate();

      const rt = fieldBearingType(base.type.type);
      if (rt === undefined) return undefined; // unknown operand: stay symbolic
      // A settled non-field-bearing operand: a protocol property if one
      // answers, else the static defect it has always been.
      if (rt === 'none')
        return (
          property() ??
          ce.typeError(
            parseType('record | object | dictionary | tuple'),
            base.type,
            base
          )
        );

      // A settled OBJECT type whose VALUE is not (yet) a `BoxedObject` — an
      // unresolved symbol, a call that has not been evaluated. Only the
      // instance's own slots can answer a field read, so stay symbolic rather
      // than guessing from the layout; the branch above answers as soon as a
      // real object arrives.
      if (rt.kind === 'object') return undefined;

      if (rt.kind === 'record') {
        // A tagged nominal value: the payload is the single dictionary
        // operand of the tagged application.
        if (isFunction(base) && base.ops.length === 1) {
          const payload = base.ops[0];
          if (isDictionary(payload)) {
            // Dictionary entries are stored raw: canonicalize before
            // evaluating.
            const v = payload.get(name);
            if (v !== undefined) return v.canonical.evaluate();
            return (
              property() ?? ce.error(['unknown-field', name], base.toString())
            );
          }
        }
        return undefined;
      }
      if (rt.kind === 'tuple') {
        const i = rt.elements.findIndex((x) => x.name === name);
        if (i < 0)
          return (
            property() ?? ce.error(['unknown-field', name], base.toString())
          );
        // A tagged nominal value spreads its tuple payload inline
        // (`["pt", 1, 2]`); a plain `Tuple` value has the same shape.
        if (isFunction(base) && i < base.ops.length) return base.ops[i];
        return undefined;
      }
      return undefined;
    },
    // §4.6/D16 compile lowering: positional index/swizzle for named-tuple
    // NOMINAL operands; `At` parity for plain dictionary/record values; the
    // dictionary payload of a record-bodied nominal has no compiled
    // representation — decline.
    compile: (args, compile, { language }) => {
      const [base, field] = args;
      if (base === undefined || !isString(field)) return undefined;
      const name = field.string;
      const t = base.type.type;
      const rt = fieldBearingType(t);
      if (rt === undefined || rt === 'none') return undefined;
      // A MUTABLE OBJECT declines, fail-closed: objects have no compiled
      // representation at all yet (their constructor's own compile handler
      // declines for the same reason), and lowering a field read to a plain
      // property access would silently produce a value with none of an
      // object's identity or mutation semantics. The engine⇄compiled boundary
      // for objects is a later phase.
      if (rt.kind === 'object') return undefined;

      const isNominal =
        typeof t === 'object' && t.kind === 'reference' && t.alias !== true;
      if (!isNominal) {
        // Plain (or alias-typed) structural value: lower exactly as the
        // equivalent `At` — same emissions, same declines. A named-tuple
        // field lowers by POSITION (1-based `At`).
        if (rt.kind === 'tuple') {
          const i = rt.elements.findIndex((x) => x.name === name);
          if (i < 0) return undefined;
          return compile(
            base.engine.function('At', [base, base.engine.number(i + 1)])
          );
        }
        return compile(base.engine.function('At', [base, field]));
      }

      // Nominal named-tuple body: component access by POSITION — the nominal
      // operand cannot route through `At` (its static gate rejects a
      // non-collection), but its compiled representation IS the tuple's.
      if (rt.kind === 'tuple') {
        const i = rt.elements.findIndex((x) => x.name === name);
        if (i < 0) return undefined;

        // …unless the nominal is a variant of a TAGGED sum
        // (`docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §B1/§B2),
        // whose compiled representation is `{_tag, _ops}` and NOT the bare
        // tuple: the payload lives one level down, in `_ops`. Without this the
        // positional index below reads a property the object does not have and
        // silently yields `undefined`.
        const info = sumVariantInfo(base.engine, t.name);
        if (info?.policy === 'tagged') {
          // JS only (§B2: the tagged emission is JS-only), and only for the
          // `tuple` shape whose slots ARE the `_ops` entries. Any other shape
          // (a variant whose payload merely *aliases* a tuple mints a UNARY
          // constructor, so `_ops[0]` is the whole tuple) fails closed.
          if (language === 'javascript' && info.shape === 'tuple')
            return `${compile(base)}._ops[${i}]`;
          return undefined;
        }

        if (language === 'javascript' || language === 'python')
          return `${compile(base)}[${i}]`;
        if ((language === 'glsl' || language === 'wgsl') && i < 4)
          return `${compile(base)}.${'xyzw'[i]}`;
      }
      return undefined;
    },
  },

  At: {
    description: [
      'Access an element of an indexed collection.',
      'If the index is negative, it is counted from the end.',
      'Multiple indices can be provided to access nested collections (e.g., matrices).',
      'If the index is a finite collection of booleans, returns the elements where the mask is True (a mask is a filter, and its length must match the collection length; otherwise it is an error).',
      'If the index is a finite collection of integers, returns the elements at those indices, preserving position: an out-of-range index yields the absence marker, it is not dropped.',
      'Out-of-band access (an out-of-range index, or a dictionary key that is not present) yields a POSITION-PRESERVING marker: `NaN` when the collection’s elements are numeric, `Missing` otherwise. It never yields `Nothing`, which would erase the position.',
    ],
    complexity: 8200,
    signature:
      '(value: indexed_collection<any> | dictionary<any>, index: (number|string|boolean|indexed_collection<any>)+) -> unknown',
    // `At` accepts absence into any position (base or index) and absorbs it at
    // runtime (§3.A/§3.C): declared `handle`, stripping ALL positions. This
    // subsumes the P1 operator-local carve-out — the general `missingStrip`
    // machinery (§3.B) now admits a `Missing`/`T | missing` base or index.
    missingBehavior: 'handle',
    missingStrip: 'all',
    // An integer GATHER knows its own length without evaluating: the gather is
    // position-preserving (an out-of-range index contributes the absence
    // marker rather than being dropped — see the `evaluate` handler), so the
    // result has exactly as many elements as the index collection.
    //
    // `At` produces its elements eagerly and carries no `collection` handlers,
    // so without this it reported `count === undefined` until evaluated. That
    // `undefined` propagated into every consumer that reads operand counts —
    // `Zip` takes the min over its members, and a `Map` over that `Zip`
    // delegates to it — so `Map(f, Zip(At(xs, I), ys))` had no count even
    // though `At(xs, I)` and the `Zip` both count fine once evaluated
    // (Tycho item 184).
    //
    // Restricted to the shapes whose length is decidable from the operands
    // alone, mirroring the `evaluate` handler's Case B:
    //  - a single index only. A chained access (`At(m, i, j)`) peels one level
    //    at a time and the surviving shape depends on the intermediate.
    //  - an indexed-collection SOURCE. A dictionary/record source takes the
    //    `isDictionary` branch, which declines a collection-shaped index.
    //  - a provably NUMERIC index element type, which is what separates a
    //    gather from a boolean MASK. A mask filters, so its result length is
    //    the number of `True` entries — not knowable without walking it, and
    //    this handler must stay evaluation-free.
    elementCount: (expr) => {
      if (!isFunction(expr) || expr.nops !== 2) return undefined;
      const [xs, idx] = expr.ops;
      if (!isSubtype(xs.type.type, INDEXED_COLLECTION_SHAPE_TYPE)) return undefined;
      if (isString(idx) || !isSubtype(idx.type.type, INDEXED_COLLECTION_SHAPE_TYPE))
        return undefined;
      const elt = collectionElementType(idx.type.type);
      if (elt === undefined || !isSubtype(elt, 'number')) return undefined;
      const n = idx.count;
      return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
    },
    type: (ops) => {
      // Bracket notation over a blackboard-bold RING constant canonicalizes to
      // ring ADJUNCTION (see the `canonical` handler below), so report the same
      // type it does. Without this, a STRUCTURAL `At(Integers, √2)` — which
      // never reaches `canonical` — fell through to the indexing analysis
      // below and claimed `number` instead of the adjunction's `set<…>`.
      if (ops.length >= 2 && isRingConstant(ops[0])) return adjoinType(ops);

      // The RAW type of the element(s) a single index selects (no absence
      // marker). Used as the inner element type of a gather and as the peeled
      // type of a chained step.
      const elementType = (): Type => {
        const xs = ops[0];
        const t = xs.type.type;
        // A dictionary/record is a keyed collection whose `At` returns the
        // VALUE, not the iteration pair `tuple<string, T>` that
        // `collectionElementType` reports (that is correct for iteration, but
        // wrong here). Special-case it.
        if (typeof t === 'string') {
          if (t === 'dictionary' || t === 'record') return 'any';
        } else if (t.kind === 'dictionary') {
          return t.values;
        } else if (t.kind === 'record') {
          // A literal string index selecting a known field yields that field's
          // type; otherwise widen across all field value types.
          const key = ops[1];
          if (key && isString(key)) {
            const fieldType = t.elements[key.string];
            if (fieldType) return fieldType;
          }
          return widen(...Object.values(t.elements)) as Type;
        } else if (t.kind === 'tuple') {
          // A literal integer index selects that slot's type (1-based,
          // negatives count from the end); otherwise `collectionElementType`
          // widens across all slot types.
          const key = ops[1];
          if (ops.length === 2 && key?.isInteger === true) {
            const n = t.elements.length;
            const raw = key.re;
            if (typeof raw === 'number' && Number.isFinite(raw)) {
              const i = raw < 0 ? n + raw + 1 : raw;
              if (i >= 1 && i <= n) return t.elements[i - 1].type;
            }
          }
        }
        return (
          xs.operatorDefinition?.collection?.elttype?.(xs) ??
          collectionElementType(t) ??
          'any'
        );
      };

      // The result type of a single SCALAR/string index (§3.C access-mode
      // matrix), applying the absence marker where the access may be
      // out-of-band. An in-range literal tuple/record hit is exact (no marker);
      // an out-of-range literal misses to `marker(⊔S)`; a dynamic index gains
      // `T | marker(T)`.
      const scalarResultType = (): Type => {
        const xs = ops[0];
        const t = xs.type.type;
        const key = ops[1];
        if (typeof t === 'string') {
          if (t === 'dictionary' || t === 'record') return withMarker('any');
        } else if (t.kind === 'dictionary') {
          return withMarker(t.values);
        } else if (t.kind === 'record') {
          const fields = widen(...Object.values(t.elements)) as Type;
          if (key && isString(key)) {
            const fieldType = t.elements[key.string];
            if (fieldType) return fieldType; // present literal → exact
            return markerType(fields); // absent literal → marker(⊔V)
          }
          return withMarker(fields); // dynamic string → ⊔V | marker(⊔V)
        } else if (t.kind === 'tuple') {
          const n = t.elements.length;
          const slots = widen(...t.elements.map((x) => x.type)) as Type;
          if (key?.isInteger === true) {
            const raw = key.re;
            if (typeof raw === 'number' && Number.isFinite(raw)) {
              const i = raw < 0 ? n + raw + 1 : raw;
              if (i >= 1 && i <= n) return t.elements[i - 1].type; // in-range
              return markerType(slots); // out-of-range literal → marker(⊔S)
            }
          }
          return withMarker(slots); // dynamic int → ⊔S | marker(⊔S)
        }
        return withMarker(elementType());
      };

      // A COLLECTION-valued index (an integer gather or a boolean mask)
      // selects MANY elements, so the result is a `list` of the element type,
      // not a single element. Reporting the bare element type here would
      // claim a scalar for a value that is actually a list: parent operators
      // would then skip broadcasting (compiled `At(p, I) + 1` degenerating to
      // JS array-plus-number string concatenation) and collection operators
      // such as `Length` would fail closed on a genuine list.
      //
      // Both operands must qualify, mirroring what `evaluate` actually does:
      //  - the SOURCE must be an indexed collection. A dictionary/record
      //    source takes the `isDictionary` branch in `evaluate`, which accepts
      //    a plain string key only and DECLINES any collection-shaped index —
      //    so claiming `list<T>` there would over-claim a shape the
      //    interpreter never produces.
      //  - the INDEX must be an indexed collection. A string index is a record
      //    key, not a gather, so it is excluded by the source test above and
      //    by `isString`.
      const isGatherIndex = (idx: Expression | undefined): boolean =>
        idx !== undefined &&
        !isString(idx) &&
        isSubtype(idx.type.type, INDEXED_COLLECTION_SHAPE_TYPE);

      // A boolean MASK filters (in-range only, no marker); an integer gather is
      // POSITION-PRESERVING (each element `T | marker(T)`, §3.C).
      const isMaskIndex = (idx: Expression | undefined): boolean => {
        if (!isGatherIndex(idx)) return false;
        const et = collectionElementType(idx!.type.type);
        return et !== undefined && isSubtype(et, 'boolean');
      };

      if (ops.length === 2) {
        if (
          isSubtype(ops[0].type.type, INDEXED_COLLECTION_SHAPE_TYPE) &&
          isGatherIndex(ops[1])
        ) {
          const inner = elementType();
          return isMaskIndex(ops[1])
            ? ({ kind: 'list', elements: inner } as ListType)
            : ({ kind: 'list', elements: withMarker(inner) } as ListType);
        }
        return scalarResultType();
      }

      // CHAINED form `At(M, i, j, …)`: `evaluate` walks the indices, and each
      // step transforms the CURRENT value — a scalar index peels one collection
      // level, while a gather REPLACES the value with a fresh `List` of the
      // peeled element type. The next index then applies to that new value.
      // Without this branch the handler fell back to `elementType()`, which
      // only ever consulted `ops[1]`, so `At(M, 1, [1,2])` on a 2x3 matrix
      // reported `vector<int^3>` (a whole row) for the 2-element list `[1,2]`.
      //
      // The step must be applied per index, NOT accumulated into a single
      // "did any step gather" flag: a gather followed by a scalar index selects
      // one entry OUT of the gathered list, so `At(M, [1,2], 1)` is a whole row
      // (`[1,2,3]`), not a list of scalars. A global flag reported
      // `list<integer>` for it — over-peeled and mis-shaped.
      //
      // Only walk an indexed-collection source, and not a TUPLE: a tuple IS an
      // `indexed_collection`, but `elementType()` has slot-aware handling for
      // it that a plain `collectionElementType` walk (which widens across all
      // slots) would lose. Dictionaries/records likewise.
      const sourceType = ops[0].type.type;
      const isTupleSource =
        typeof sourceType !== 'string' && sourceType.kind === 'tuple';
      if (!isSubtype(sourceType, INDEXED_COLLECTION_SHAPE_TYPE) || isTupleSource)
        return scalarResultType();

      // Peel RAW through the intermediate steps; the absence marker is applied
      // only to the FINAL position's domain (chained value-level absorption,
      // §3.C): `At(m, 9, 0)` on `list<list<number>>` reports `number` — the
      // list-domain miss at step 1 absorbs into the numeric final domain.
      let current: Type = sourceType;
      for (let i = 1; i < ops.length; i++) {
        const peeled = collectionElementType(current) ?? 'any';
        const last = i === ops.length - 1;
        if (isGatherIndex(ops[i])) {
          // A gather yields a dimensionless list; the final gather's elements
          // carry the marker, a mask filters (no marker).
          const inner =
            last && !isMaskIndex(ops[i]) ? withMarker(peeled) : peeled;
          current = { kind: 'list', elements: inner } as ListType;
        } else {
          current = last ? withMarker(peeled) : peeled;
        }
      }
      return current;
    },

    // Custom canonical handler delegating operand validation to
    // `validateArguments` (matching the standard signature-validation flags).
    // The index type accepts `boolean` so a Desmos filter condition that only
    // *becomes* a `list<boolean>` at evaluate — e.g. `L[|[1...n]-i|>0]`, whose
    // condition `|…|>0` is a broadcast expression typed scalar `boolean` before
    // evaluation (its operand is not yet a materialized collection) — passes
    // canonicalization. At evaluate the condition broadcasts to a boolean list
    // and the mask branch (Case B) fires. A genuinely scalar boolean index that
    // stays scalar leaves `At` unevaluated (see Case C).
    // The value operand additionally tolerates an operand whose number type
    // was merely *inferred* (not declared): inference is retractable, and an
    // untyped function parameter used as `a[1]` may only resolve to a
    // collection when the function is applied. Rejecting it here would
    // permanently invalidate the definition (see `isDeclaredScalarNumber`).
    canonical: (ops, { engine: ce }) => {
      // Bracket notation over a blackboard-bold RING constant is ring
      // ADJUNCTION, not indexing: `\mathbb{Z}[\sqrt2]` is ℤ[√2], `\mathbb{Z}[x]`
      // the polynomial ring. A set is not an indexed collection, so the `At`
      // reading below could only produce an `incompatible-type` error.
      if (ops.length >= 2 && isRingConstant(ops[0]))
        return ce._fn('Adjoin', ops);

      // `ops` are already canonical (At is not lazy). `At` is declared
      // `handle`/`missingStrip: 'all'`, so validation strips a `missing` arm
      // from every position (§3.B): a `Missing`/`T | missing` base or index is
      // admitted, its absence carried by the (absorbing) evaluate handler.
      const adjusted = validateArguments(
        ce,
        ops,
        AT_SIGNATURE,
        false,
        false,
        undefined,
        () => true
      );

      // `null` → every operand matched; nothing to relax.
      if (!adjusted) return ce._fn('At', ops);

      const patched = [...adjusted];
      const value = ops[0];
      // Restore the value operand when it failed only because its type is
      // retractable — the base may still resolve to a collection at runtime:
      //  - an *inferred* (not declared) scalar `number` type; or
      //  - a *union* with an indexable member (e.g. `finite_integer |
      //    vector<3>`, or a declared `number | list<number>` return; see
      //    `hasIndexableMember`); or
      //  - a `broadcastable<T>` base (e.g. `2h(x)-1` with `h` returning
      //    `unknown`, now typed `broadcastable<number>`): it is not a subtype
      //    of `number`, so the `value.type.matches('number')` arm is FALSE for
      //    it — the direct kind check is what admits it; or
      //  - the bare `value` primitive (e.g. inferred through a `(value*)`
      //    signature such as `Max`/`Min`): `value` is a strict supertype of
      //    `number` that also includes collection types, so it is no evidence
      //    of scalar-ness (mirrors the `value` handling in `invisible-operator`).
      // A provably scalar base (`\pi`, `(5)`, `sin(3)`, `finite_integer |
      // rational`) is not restored and still errors loudly.
      const valueType = value?.type.type;
      if (
        value?.isValid &&
        patched[0]?.operator === 'Error' &&
        ((value.type.matches('number') && !isDeclaredScalarNumber(value)) ||
          hasIndexableMember(value) ||
          (typeof valueType !== 'string' &&
            valueType?.kind === 'broadcastable') ||
          value.type.type === 'value')
      )
        patched[0] = value;
      // Absent base/index positions (`missing`, `T | missing`) are handled by
      // the `missingStrip: 'all'` validation above — no operator-local carve-out
      // is needed here (P2 subsumed the P1 stopgap).

      return ce._fn('At', patched);
    },

    evaluate: (ops, { engine: ce }) => {
      // Edge conventions, on the record (revised 2026-07-22 — BREAKING):
      // out-of-band access is POSITION-PRESERVING and yields the absence
      // MARKER (`NaN` for a numeric collection, `Missing` otherwise — see
      // `absenceMarker()`), never `Nothing` (which erases).
      //  - an out-of-range SCALAR index yields the marker;
      //  - out-of-range entries of an integer-list pick (gather) yield the
      //    marker in place, so the picked list has the same length as the
      //    index list (BREAKING — previously dropped);
      //  - a missing dictionary key yields the marker;
      //  - a boolean MASK is a filter (unselected positions are dropped), but
      //    its length must EQUAL the collection length; a mismatch is an error
      //    (BREAKING — previously applied to the prefix silently);
      //  - a scalar boolean or a non-string dictionary index leaves `At`
      //    unevaluated.
      // Chained `At(x, i₁, i₂, …)`: any absent intermediate (`Missing` OR
      // `NaN`, provenance irrelevant, I6) short-circuits the remaining steps;
      // the result is absence in the FINAL position's domain (§3.C).
      let expr = ops[0];
      let index = 1;
      while (ops[index]) {
        // Value-level absorption: an absent current value (an absent base, or
        // an absent intermediate produced by a prior step) short-circuits the
        // remaining indices into the final position's domain.
        if (isAbsentValue(expr))
          return chainAbsorbMarker(ce, expr.type.type, ops, index);

        const opAtIndex = ops[index];

        // An absent INDEX (`Missing`/`NaN`) is absorbing too (`At` strips its
        // index position): the result is absence in the final domain.
        if (isAbsentValue(opAtIndex))
          return chainAbsorbMarker(ce, expr.type.type, ops, index);

        // Dictionary key access: a `dictionary` is a keyed (not indexed)
        // collection with no `collection.at` handler, so look the value up by
        // its string key directly. Only string keys are supported; a missing
        // key yields the absence marker, a non-string index leaves `At`
        // unevaluated.
        if (isDictionary(expr)) {
          if (!isString(opAtIndex)) return undefined;
          const v = expr.get(opAtIndex.string);
          if (v === undefined)
            return index + 1 < ops.length
              ? chainAbsorbMarker(ce, expr.type.type, ops, index)
              : absenceMarker(ce, expr);
          expr = v;
          index += 1;
          continue;
        }

        const def = expr.baseDefinition;
        // A STRING implements element access on the boxed VALUE
        // (`BoxedString.at`) rather than through an operator definition's
        // `collection` handlers — a string literal has no operator definition
        // to carry them — so there is nothing for the dispatch below to find.
        // Fall back to the value's own accessor, which applies the same
        // 1-based / negative-from-the-end convention every other indexed
        // collection uses.
        const at =
          def?.collection?.at ??
          (isString(expr)
            ? (xs: Expression, i: number | string) =>
                typeof i === 'number' ? xs.at(i) : undefined
            : undefined);
        if (!at) {
          // The current value offers no element access. When at least one
          // index has already been consumed and the value is PROVABLY not
          // indexable — `At([10,20,30], 1, 2)`, whose first step yields the
          // scalar `10` — the remaining indices can never be consumed. Report
          // a dimension mismatch instead of silently returning the inert
          // expression, which let a mis-parse flow on as a plausible value.
          // A value that could still resolve to a collection at runtime (an
          // unbound symbol, an `unknown`-typed intermediate) keeps `At`
          // unevaluated, as before.
          if (
            index > 1 &&
            !expr.type.couldMatch('indexed_collection') &&
            !expr.type.couldMatch('dictionary')
          )
            return ce.error(
              'incompatible-dimensions',
              `${ops.length - 1} indices vs ${index - 1}-dimensional collection`
            );
          return undefined;
        }

        // Case A: string key (dictionary-style access).
        const s = isString(opAtIndex) ? opAtIndex.string : undefined;
        if (s !== undefined) {
          // A STRING is an INDEXED collection of its characters: it has no
          // keys at all, so `At("abc", "b")` is not a lookup that missed, it
          // is a lookup a string does not offer. The string fallback accessor
          // installed above answers numeric indices only and returns
          // `undefined` for a key, which the branch below would read as an
          // absent key and answer with the absence marker. Decline the
          // dispatch instead, leaving the expression unevaluated.
          if (isString(expr)) return undefined;
          const v = at(expr, s);
          if (v === undefined)
            return index + 1 < ops.length
              ? chainAbsorbMarker(ce, expr.type.type, ops, index)
              : absenceMarker(ce, expr);
          expr = v;
          index += 1;
          continue;
        }

        // Case B: finite collection index — boolean mask or integer list.
        if (opAtIndex.isCollection && opAtIndex.isFiniteCollection) {
          const indices = Array.from(opAtIndex.each()) as Expression[];
          // An EMPTY index list is a gather that yields the empty list (not a
          // mask — that would require a length-0 collection). `every` on an
          // empty array is `true`, so guard the length explicitly.
          const isMask =
            indices.length > 0 &&
            indices.every((m) => {
              const name = sym(m);
              return name === 'True' || name === 'False';
            });

          const picked: Expression[] = [];
          if (isMask) {
            // Boolean MASK is a filter, but its length must EQUAL the source
            // length (BREAKING — a mismatch was previously applied silently to
            // the prefix). Stay symbolic if the source length is unknown.
            const srcLen = expr.count;
            if (srcLen === undefined) return undefined;
            if (indices.length !== srcLen)
              return ce.error(
                `The mask (length ${indices.length}) must have the same length as the collection (length ${srcLen})`
              );
            indices.forEach((m, i) => {
              if (sym(m) !== 'True') return;
              const v = at(expr, i + 1);
              if (v !== undefined) picked.push(v);
            });
          } else {
            // Integer-list pick (gather): select the element at each integer
            // index. POSITION-PRESERVING — an out-of-range index contributes
            // the absence marker, so the result has the same length as the
            // index list (BREAKING — previously such entries were dropped).
            let marker: Expression | undefined;
            for (const m of indices) {
              const k = m.re;
              if (!Number.isInteger(k)) return undefined;
              // Route through the dispatcher so negative indices normalize.
              const v = expr.at(k);
              picked.push(v ?? (marker ??= absenceMarker(ce, expr)));
            }
          }

          expr = ce._fn('List', picked);
          index += 1;
          continue;
        }

        // Case C: primitive integer index. Route through the dispatcher so
        // negative indices normalize (count from the end). An out-of-range
        // index yields the absence marker; if more indices remain it absorbs
        // into the final domain (chained short-circuit).
        const i = opAtIndex.re;
        if (!Number.isInteger(i)) return undefined;
        const v = expr.at(i);
        if (v === undefined)
          return index + 1 < ops.length
            ? chainAbsorbMarker(ce, expr.type.type, ops, index)
            : absenceMarker(ce, expr);
        expr = v;
        index += 1;
      }
      return expr;
    },
  },

  // Miranda: `take` (also Haskell)
  Take: {
    description: ['Return `n` elements from a collection.'],
    complexity: 8200,
    // The leading arm is the string-preservation rule: taking a prefix of a
    // string's characters yields a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"). It is spelled as a BOUNDED type variable
    // (`T where T: string`) rather than the ground type `string` for the same
    // reason `Reverse`'s `T: list` arm is: an `unknown`- or `any`-typed
    // operand refutes no arm, so a ground `string` parameter would win
    // most-specific-wins on every untyped operand and claim `string` for a
    // call that usually returns a list. A bounded variable with no call-site
    // binding does not.
    signature:
      '((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)',
    // No `evaluate` handler: materialization goes through the generic lazy-
    // collection path, driven by the `count`/`at`/`iterator` handlers below.
    // (A previous handler materialized eagerly from its operands — but the
    // operands are evaluated first, so an unknown-length lazy source arrived
    // already collapsed to its display preview, placeholder included, and
    // `Take` returned the preview's elements instead of its own.)
    // The string arm is served by the same lazy handlers: a lazy collection
    // whose declared type is `string` evaluates to the string its characters
    // spell (see `evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`). Re-segmentation caveat: rejoining
    // the taken characters can merge or split grapheme clusters, so the result
    // may hold a different number of characters than were taken.
    collection: {
      // A non-positive bound yields the empty collection whatever the source
      // is, so the walk is faithful even over an unwalkable one — without this
      // short-circuit `Any(Take(xs, 0), p)` would go inert for a valueless
      // `xs`, where `False` is both available and correct.
      isEnumerable: (expr) => {
        if (!isFunction(expr)) return undefined;
        const bound = integerParam(expr.op2);
        if (bound !== null && (bound ?? 0) <= 0) return true;
        return expr.op1.isEnumerableCollection;
      },
      isLazy: (_expr) => true,
      count: takeCount,
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        const [xs, op2] = expr.ops;
        if (xs.isEmptyCollection) return true;
        // The bound is read BEFORE the infinite-source branch: taking a
        // symbolic `n` from an infinite source is not known non-empty either
        // (`n = 0` makes it empty), so answering `false` there would be a
        // definitive wrong answer for exactly the input this guard is about.
        const bound = integerParam(op2);
        if (bound === null) return undefined; // symbolic bound
        if (xs.isFiniteCollection === false) return (bound ?? 0) <= 0;
        const n = Math.max(0, bound ?? 0);
        // A known non-empty source with n ≥ 1 gives a non-empty Take even
        // when the source's count is unknown (e.g. Dedup of an infinite
        // Iterate) — required for the generic materializer, which keeps the
        // lazy form when emptiness is indeterminate.
        if (xs.isEmptyCollection === false && n >= 1) return false;
        const count = xs.count;
        if (count === undefined) return undefined;
        if (!Number.isFinite(n)) return false;
        return Math.min(count, n) === 0;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        // A non-positive bound yields an empty (finite) collection regardless
        // of the source.
        const n = integerParam(expr.op2);
        if (n === null) return undefined; // symbolic bound
        // A finite bound caps the result at `n` elements, so the `Take` is
        // finite whatever the source is — including a source whose own length
        // is unknown (`Take(Filter(Range(1, ∞), IsPrime), 10)`). Finiteness
        // and exact count are separate questions: `count` stays `undefined`
        // there because the source may exhaust before `n` elements.
        if (n !== undefined && Number.isFinite(n)) return true;
        // Otherwise (an infinite bound, or a missing one) the result is finite
        // when its own element count is known-finite. When the source's length
        // is genuinely unknown, `takeCount` is `undefined` and the result's
        // finiteness is unknown too: defer to the source.
        const count = takeCount(expr);
        if (count !== undefined && Number.isFinite(count)) return true;
        return expr.op1.isFiniteCollection;
      },
      iterator: takeIterator,
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || index === 0) return undefined;
        if (!isFunction(expr)) return undefined;
        const bound = integerParam(expr.op2);
        if (bound === null) return undefined; // symbolic bound
        const n = Math.max(0, bound ?? 0);
        if (n === 0) return undefined;

        if (index > 0) {
          if (index > n) return undefined;
          return expr.op1.at(index);
        }

        const count = takeCount(expr);
        if (count === undefined || count === 0) return undefined;
        if (index < -count) return undefined;
        // Negative index counts from the end: at(-1) is the count-th element.
        return expr.op1.at(count + index + 1);
      },
    },
  },

  // Miranda: `drop` (also Haskell)
  Drop: {
    description: ['Return the collection without the first n elements.'],
    complexity: 8200,
    // The leading arm is the string-preservation rule: dropping a prefix of a
    // string's characters yields a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"), and a node that resolves to it evaluates to that
    // string (`evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`). Re-segmentation caveat: rejoining
    // the remaining characters can merge or split grapheme clusters, so the
    // result may hold a different number of characters than were left.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)',
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const [xs, n] = expr.ops;
        const count = xs.count;
        if (count === undefined) return undefined;
        if (!Number.isFinite(count)) return Infinity;
        if (xs.isEmptyCollection) return 0;
        const dropped = integerParam(n);
        if (dropped === null) return undefined; // symbolic bound
        // A NEGATIVE count drops nothing — which is what the walk does — so it
        // is clamped here as well. `Math.max(0, …)` on the RESULT does not do
        // that: `count - (-5)` is larger than `count`, so `Drop(1..10, -5)`
        // reported 15 elements for a walk that yields 10. A count that
        // disagrees with its own walk is not merely a wrong `Length`: the
        // facet is what indexing bounds, emptiness and the materialization
        // gates all read.
        const nValue = Math.max(0, dropped ?? 0);
        if (nValue >= count) return 0;
        return count - nValue;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        // Every facet bails together on a symbolic bound: a coherent
        // unknown is what keeps a consumer (`ListFrom`, a broadcast) from
        // reading the empty iterator as an empty collection.
        if (integerParam(expr.op2) === null) return undefined;
        return expr.op1.isFiniteCollection;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const [xs, nExpr] = expr.ops;

        const dropped = integerParam(nExpr);
        if (dropped === null)
          return { next: () => ({ value: undefined, done: true }) };
        const n = dropped ?? 0;
        if (n <= 0) return xs.each();

        const count = xs.count;
        let index = n + 1;

        return {
          next: () => {
            // Stop at the end of a finite collection: `List.at()` returns an
            // Error (not `undefined`) past the end, so the count bound is what
            // reliably terminates iteration.
            if (count !== undefined && index > count)
              return { value: undefined, done: true };
            const value = xs.at(index++);
            if (value === undefined) return { value: undefined, done: true };
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const [xs, nExpr] = expr.ops;

        const dropped = integerParam(nExpr);
        if (dropped === null) return undefined; // symbolic bound
        const n = dropped ?? 0;
        // Dropping <= 0 elements is the identity (matches the iterator, which
        // returns `xs.each()` for n <= 0).
        if (n <= 0) return xs.at(index);

        // A negative index counts from the end. Dropping from the front does
        // not move the tail, so `xs.at(index)` is already correct — but reject
        // indices that would reach back into the dropped prefix.
        if (index < 0) {
          const count = xs.count;
          if (count !== undefined && -index > count - n) return undefined;
          return xs.at(index);
        }
        if (index < 1) return undefined;
        return xs.at(index + n);
      },
    },
  },

  // First/Second/Third/Last admit an absent base (§3.B strip-before-validate):
  // an `At` access types `missing | T` (the out-of-range arm), and without the
  // strip every indexed-then-accessed chain (`First(L[n])`) errored at
  // canonicalization (Tycho item 164's sibling). Declared `handle`: the
  // element domain is unknown, so `componentAt` propagates a `Missing` base
  // as `Missing` — the position-preserving marker, mirroring `At` — rather
  // than the numeric `NaN` a `propagate` gate would substitute.
  First: {
    description: 'The first element of a collection.',
    complexity: 8200,
    signature: '(xs: indexed_collection<any>) -> any',
    missingBehavior: 'handle',
    type: ([xs], { operandTypes }) =>
      componentResultType(xs, 1, operandTypes?.[0]),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, 1, ce),
  },

  Second: {
    description: 'The second element of a collection.',
    complexity: 8200,
    signature: '(xs: indexed_collection<any>) -> any',
    missingBehavior: 'handle',
    type: ([xs], { operandTypes }) =>
      componentResultType(xs, 2, operandTypes?.[0]),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, 2, ce),
  },

  Third: {
    description: 'The third element of a collection.',
    complexity: 8200,
    signature: '(xs: indexed_collection<any>) -> any',
    missingBehavior: 'handle',
    type: ([xs], { operandTypes }) =>
      componentResultType(xs, 3, operandTypes?.[0]),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, 3, ce),
  },

  // Point-coordinate accessors (`.x`/`.y`/`.z`). On a single point they return
  // the coordinate; on a list of points they broadcast, returning the list of
  // coordinates (Desmos semantics). Distinct from First/Second/Third, which
  // index a collection — see `pointComponentAt`.
  //
  // The parameter is the union of the two shapes the accessors read: a POINT
  // (`tuple`, or the flat `list<number>` spelling a data import produces) and
  // a COLLECTION — of points, which broadcasts, or of anything else, which
  // element-indexes like First/Second/Third (`PointX(["a","b"])` → `"a"`, the
  // documented fallback in `isPointLike`). Non-indexed collections are in: a
  // Set of points broadcasts. Deliberately NOT `any`: a scalar or a string is
  // already rejected at run time, and `any` contributes no type evidence, so a
  // function parameter used as `PointX(a)` inferred nothing and its list
  // argument broadcast element-wise instead of binding whole (Tycho item 116).
  // `Distance` was narrowed away from `value`/`any` for the same reason.
  //
  // That narrowing composes with `At` through `missingBehavior: 'propagate'`
  // (§3.B strip-before-validate): an in-range-unprovable access types
  // `missing | tuple<…>`, and without the strip every indexed-then-accessed
  // chain (`S[n].x`) errored at canonicalization (Tycho item 164). At run
  // time an absent point's coordinate is a numeric slot's marker — `NaN`,
  // per the accessors' own §3.C convention (`withMarker(number) = number`) —
  // which the §3.E gate substitutes before the evaluate handler runs.
  PointX: {
    description:
      'The x-coordinate of a point, broadcasting over a list of points.',
    complexity: 8200,
    signature: '(xs: collection<any> | tuple) -> any',
    missingBehavior: 'propagate',
    type: ([xs], { operandTypes }) =>
      pointComponentType(xs, 1, operandTypes?.[0]),
    evaluate: ([xs], { engine: ce, numericApproximation }) =>
      pointComponentAt(xs, 1, ce, numericApproximation ?? false),
  },

  PointY: {
    description:
      'The y-coordinate of a point, broadcasting over a list of points.',
    complexity: 8200,
    signature: '(xs: collection<any> | tuple) -> any',
    missingBehavior: 'propagate',
    type: ([xs], { operandTypes }) =>
      pointComponentType(xs, 2, operandTypes?.[0]),
    evaluate: ([xs], { engine: ce, numericApproximation }) =>
      pointComponentAt(xs, 2, ce, numericApproximation ?? false),
  },

  PointZ: {
    description:
      'The z-coordinate of a point, broadcasting over a list of points.',
    complexity: 8200,
    signature: '(xs: collection<any> | tuple) -> any',
    missingBehavior: 'propagate',
    // A point with no z-coordinate is a DIMENSION mismatch, not an absent
    // slot (item 138 clarified ask — see `pointArityError`). When the operand
    // type statically proves 2-D, report it here, at type-check time, so the
    // expression is invalid and every compile target fails closed on it.
    canonical: (ops, { engine: ce }) => {
      const args = checkArity(ce, ops, 1);
      const xs = args[0];
      if (xs?.isValid) {
        const arity = staticPointArity(xs.type.type);
        if (arity !== undefined && arity < 3)
          return pointArityError(ce, 3, arity);
      }
      return ce._fn('PointZ', args);
    },
    type: ([xs], { operandTypes }) =>
      pointComponentType(xs, 3, operandTypes?.[0]),
    evaluate: ([xs], { engine: ce, numericApproximation }) => {
      // The type was not decisive (a bare `tuple`, `list<tuple>`, `unknown`),
      // but the concrete value is 2-D: the WHOLE application errors — a
      // per-point marker inside a broadcast list is not wanted.
      const arity = runtimePointArity(xs);
      if (arity !== undefined && arity < 3)
        return pointArityError(ce, 3, arity);
      return pointComponentAt(xs, 3, ce, numericApproximation ?? false);
    },
  },

  Last: {
    description: 'The last element of a collection.',
    complexity: 8200,
    signature: '(xs: indexed_collection<any>) -> any',
    missingBehavior: 'handle',
    type: ([xs], { operandTypes }) =>
      componentResultType(xs, -1, operandTypes?.[0]),
    evaluate: ([xs], { engine: ce }) => componentAt(xs, -1, ce),
  },

  Rest: {
    description: [
      'Return the collection without the first element.',
      'If the collection has only one element, return an empty collection.',
    ],
    complexity: 8200,
    // Per-kind result rule (`docs/STRING_ROADMAP.md`, "Signature refinement",
    // Phase 0b): dropping an element changes the arity, so no indexed kind
    // but `list` is closed under it — and a `list` result carries no length,
    // so `list<T>` is exactly right for every kind. (The previous bare
    // `indexed_collection` result lost the element type altogether.)
    // The LEADING arm is the string-preservation rule: dropping the first
    // character of a string yields a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"), and a node that resolves to it evaluates to that
    // string (`evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`). Re-segmentation caveat: rejoining
    // the remaining characters can merge or split grapheme clusters, so the
    // result may hold a different number of characters than the input minus
    // one.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)',
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return Math.max(0, count - 1);
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isEmptyCollection) return true;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return count <= 1;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        // Rest yields the collection without its first element, i.e. starting
        // at the second element. `index` must persist across `next()` calls.
        const op1 = expr.op1;
        const count = op1.count;
        let index = 2;
        return {
          next: () => {
            // Terminate at the end of a finite collection. `List.at()` returns
            // an Error (not `undefined`) past the end, so the count bound is
            // what reliably stops iteration; the `undefined` check covers
            // unbounded collections.
            if (count !== undefined && index > count)
              return { value: undefined, done: true };
            const value = op1.at(index);
            if (value === undefined) return { value: undefined, done: true };
            index += 1;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;

        return expr.op1.at(index > 0 ? index + 1 : index);
      },
    },
  },

  Most: {
    complexity: 8200,
    description: [
      'Return the collection without the last element.',
      'If the collection has only one element, return an empty collection.',
    ],
    // Per-kind result rule: see `Rest` — same reasoning, same result type,
    // and the same leading string-preserving arm (dropping the LAST character
    // of a string yields a string; rejoining what remains can merge or split
    // grapheme clusters, so the result may hold a different number of
    // characters than the input minus one).
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)',
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return Math.max(0, count - 1);
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return count <= 1;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const l = expr.op1.count;
        if (l === undefined || l <= 1)
          return { next: () => ({ value: undefined, done: true }) };

        let index = 1;
        const last = l - 1;
        return {
          next: () => {
            if (index > last) return { value: undefined, done: true };
            const value = expr.op1.at(index++)!;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l - 1) return undefined;
        return expr.op1.at(index);
      },
    },
  },

  Slice: {
    description: [
      'Return a contiguous run of elements from an indexed collection.',
      'Given `start` and `end` (1-based, inclusive), a negative index is counted from the end and out-of-bounds indices are clamped.',
      'Given a `range` (an ascending index span such as `2..4`), returns the elements at those indices: `Slice(xs, r)` is `Slice(xs, First(r), Last(r))`.',
    ],
    complexity: 8200,
    // Two arms. The `range` arm is the one the sequence-search family
    // consumes (`Slice(xs, RangeOf(xs, needle)) == needle`, see
    // `docs/STRING_ROADMAP.md`, "The `range` type"). It is typed `range` — an
    // ASCENDING, step-1, finite span of 1-based indices — rather than the
    // wider `indexed_collection<integer>` on purpose: a descending or stepped
    // `Range` (`Range(4, 2)`, `Range(1, 9, 2)`) types as the wider kind and is
    // therefore rejected STATICALLY. Unpacking such a collection into
    // `(start, end)` bounds would contradict its own meaning (`Slice(xs, 4,
    // 2)` is EMPTY, but the collection `4..2` is the pair `[4, 2]`); a gather
    // by arbitrary indices is `At(xs, indices)`, which accepts the wider type.
    // Each arm gets a leading string-preserving twin: a contiguous run of a
    // string's characters is a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"), and a node that resolves to one evaluates to that
    // string (`evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`). Re-segmentation caveat: rejoining
    // the sliced characters can merge or split grapheme clusters, so the
    // result may hold a different number of characters than the slice spans —
    // slicing away a base character can leave its combining mark behind.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    // The `range | nothing` twins are what make `Slice(xs, RangeOf(xs, n))`
    // compose directly. `RangeOf` is honestly typed `range | nothing` — the
    // needle may be absent — and a caller should not have to narrow the union
    // by hand before slicing. Absence PROPAGATES: `Slice(xs, Nothing)` is
    // `Nothing`, so the honest static answer for a possibly-absent span is
    // `T | nothing` (USER-RULED 2026-08-16). The exact `span: range` arms are
    // kept AHEAD of them so a span that is known to exist keeps the precise
    // `T` / `list<T>` result it has always had; that precision is
    // load-bearing, not cosmetic — the string-preservation step requires the
    // node's type to MATCH `string` exactly
    // (`evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`), and a `string | nothing` result
    // would stop `Slice("abc", 2..3)` evaluating to a string value at all.
    // The overload RESOLVER cannot make that split on its own, which is why
    // the `type` handler below exists: for an operand typed `range | nothing`
    // the resolver still selects the exact `span: range` arm and would report
    // `string` / `list<T>`, not the `| nothing` union. The union arm is what
    // makes the call VALIDATE (without it the operand is rejected
    // `incompatible-type`), but overload selection admits an overlapping
    // operand on trial and prefers the more specific arm, in either textual
    // order — so before the handler, `Slice(xs, RangeOf(xs, n))` typed
    // `string` while evaluating to `Nothing`. The handler re-reads the span
    // operand's static type and adds the `| nothing` arm exactly when that
    // type admits `Nothing`; a span that statically excludes it (a literal
    // `2..3`, a `range`-declared symbol) is left to the resolver, so the
    // precise result — and with it string preservation — is untouched.
    signature: SLICE_SIGNATURE_TEXT,
    // Restore the honesty the resolver drops (see above): a possibly-absent
    // span makes the result possibly-`Nothing`. Returning `undefined` leaves
    // the resolver's arm in place, which is the whole mechanism for keeping
    // `Slice("abc", 2..3)` typed exactly `string`.
    type: (ops, { operandTypes }) => sliceResultType(ops, operandTypes),
    // `Slice(xs, Nothing)` folds to `Nothing`, which is why this handler
    // exists at all: the framework's DEFAULT canonicalization runs `flatten`
    // first, and `flatten` DROPS a `Nothing` operand outright — it is the
    // "omitted argument" marker everywhere else in the engine. Without the
    // interception the call would collapse to a one-operand `Slice` and report
    // a missing-argument error, which is exactly what a failed `RangeOf`
    // search produces when its result is fed straight back in.
    // Everything else is the default path, spelled out: `flatten` (Sequence
    // splice), then `validateArguments` against the declared overload set.
    // `Slice` is neither commutative, involutive, idempotent nor
    // `broadcastable`, and none of its parameters is numeric-only, so the
    // remaining steps the default path would run (operand sorting, the
    // involution/idempotent rewrites, the missing-arm strip) are all no-ops
    // for it. The one thing NOT reproduced is the attachment of the validated
    // overload resolution to the constructed call (`_resolvedOverload`); the
    // result type then comes from the cold re-derivation in `resolvedArm`
    // (`boxed-expression/boxed-function.ts`), which recomputes the same
    // policies from the definition. The `Slice` type pins in
    // `test/compute-engine/type-variables-collections.test.ts` and
    // `test/compute-engine/collections.test.ts` cover that path.
    canonical: (ops, { engine: ce }) => {
      // The absence test runs BEFORE `flatten`, which is the whole point:
      // `flatten` is what drops the `Nothing`.
      if (ops.length === 2 && isSymbol(ops[1], 'Nothing')) return ce.Nothing;
      const args = flatten(ops);
      return ce._fn(
        'Slice',
        validateArguments(ce, args, SLICE_SIGNATURE, false, false) ?? args
      );
    },
    collection: {
      // Collection-ness is decided PER INSTANCE, because the `range | nothing`
      // arms let the result be `Nothing`: a `Slice` over an absent span is not
      // a collection at all. Declaring this is also what tells the definition
      // validator not to insist that the whole signature's result type be a
      // collection — without it, registering the `| nothing` arms throws
      // ("a collection handler is defined, but the signature is not a
      // collection type"). A canonical `Slice(xs, Nothing)` folds to `Nothing`
      // outright, so only a structurally constructed node reaches this as
      // `false`.
      isCollection: (expr) =>
        !(isFunction(expr) && expr.ops.length === 2) ||
        !isSymbol(expr.op2, 'Nothing'),
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      count: (expr) => {
        const bounds = sliceBounds(expr);
        if (!bounds) return undefined;
        return Math.max(0, bounds.end - bounds.start + 1);
      },
      isFinite: (expr) => {
        const bounds = sliceBounds(expr);
        if (!bounds) return undefined;
        return Number.isFinite(Math.max(0, bounds.end - bounds.start + 1));
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        const bounds = sliceBounds(expr);
        if (!bounds) return undefined;
        if (!isFunction(expr)) return undefined;

        // `index` is 1-based within the slice; a negative index counts from
        // the end of the slice. Return the element at that position.
        const length = bounds.end - bounds.start + 1;
        if (length <= 0) return undefined;
        if (index < 0) {
          // Counting from the end of an infinite tail is unresolvable.
          if (!Number.isFinite(length)) return undefined;
          index = length + 1 + index;
        }
        if (index < 1 || index > length) return undefined;
        return expr.op1.at(bounds.start + index - 1);
      },
      iterator: (expr) => {
        const bounds = sliceBounds(expr);
        if (!bounds || !isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };

        let index = bounds.start;
        const last = bounds.end; // May be Infinity: an unbounded tail streams.

        return {
          next: () => {
            if (index > last) return { value: undefined, done: true };
            const value = expr.op1.at(index);
            if (value === undefined) return { value: undefined, done: true };
            index += 1;
            return { value, done: false };
          },
        };
      },
    },
  },

  // APL: rotate ⌽
  Reverse: {
    description: 'Reverse the order of the elements of an indexed collection.',
    complexity: 8200,
    // Per-kind result rule (`docs/STRING_ROADMAP.md`, "Signature refinement",
    // Phase 0b). A single `(T) -> T where T: indexed_collection` bound would
    // promise kind-preservation for EVERY indexed kind, and the runtime cannot
    // deliver it: a `tuple` type carries its arity and per-position element
    // types, and a `range` admits only ascending, non-empty, step-1 spans. So:
    // a `list` operand keeps its full type (this operation is closed over
    // lists, shape included); every other indexed kind — tuple, range, an
    // opaque `indexed_collection<T>` — results in `list<T>`, which is what the
    // lazy view materializes to. Static promise and runtime laziness are
    // decoupled: the value stays a lazy view either way.
    // Reversal in particular: `Reverse((1, "a"))` is `("a", 1)`, so the old
    // `(T) -> T` claim of `tuple<finite_integer, string>` had the element
    // types in the wrong ORDER; and `Reverse(1..10)` is `[10, 9, …, 1]`,
    // descending, which the `range` type excludes.
    // The LEADING arm is the string-preservation rule: reversing a string's
    // characters yields a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"), and a node that resolves to it evaluates to that
    // string (`evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`). Re-segmentation caveat: rejoining
    // the reversed characters can merge or split grapheme clusters, so the
    // result may hold a different number of characters than the input — a
    // combining mark that trailed its base character now leads, attached to
    // nothing.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not —
    // which is exactly how the `T: list` arm beside it already behaves.
    signature:
      '((T) -> T where T: string) & ((T) -> T where T: list) & ((indexed_collection<T>) -> list<T> where T)',
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.count;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isFiniteCollection;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        // A permutation/repetition of the source: membership is exactly the
        // source's, INCLUDING its undecided verdict (`?? false` claimed a
        // definite "not a member" the source never gave).
        return expr.op1.contains(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        // Walk `op1` from the last element to the first using negative
        // (from-the-end) indices, so this works even when `op1.count` isn't
        // known upfront. Termination must be based on `.at()` returning
        // `undefined` (out of range), not on `index` reaching a sentinel
        // value: previously this compared `index === 0`, but `index` starts
        // at -1 and is decremented (-1, -2, -3, …), so it never equals 0 and
        // the iterator ran past the end, yielding `undefined` "elements"
        // forever (surfacing as a raw "Cannot read properties of undefined"
        // once a consumer called `.evaluate()` on one of them).
        let index = -1;
        return {
          next: () => {
            const value = expr.op1.at(index);
            if (value === undefined) return { value: undefined, done: true };
            index -= 1;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        return expr.op1.at(-index);
      },
    },
  },

  // Elixir `List.insert_at/3`: return a copy with `value` inserted before the
  // 1-based `index`. Eager on finite indexed collections; inert otherwise. The
  // result head is always `List` (rebuilding a Range/other structured source
  // from its materialized operands would be wrong).
  Insert: {
    description: [
      'Return a copy of the indexed collection with `value` inserted before the 1-based `index`.',
      '`index` may range from 1 to n+1 (n+1 appends). A negative index counts from the end, with -1 appending at the end (Elixir semantics).',
      'An out-of-range, zero, or non-integer index leaves the expression unevaluated.',
    ],
    complexity: 8200,
    // The repeated variable widens the element type to include the inserted
    // value's type (the §4.3 join of the two lower bounds). UNBOUNDED (the
    // audit-ruled spelling): a bound here would also constrain the SOURCE
    // collection's elements, rejecting `Insert(fs, 1, 2)` on a
    // `list<function>` that the ground `(indexed_collection, …)` accepted.
    // `evaluate` splices whatever it is given, so the looser reading is also
    // the honest one.
    signature: '(indexed_collection<T>, integer, T) -> list<T> where T',
    evaluate: ([xs, idx, value], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      // Small finite sources materialize eagerly (all existing semantics);
      // larger — or unknown-length — sources stay symbolic and are served
      // lazily by the `collection` handlers below (Tycho item 52).
      const size = xs.count;
      if (size === undefined || size > MAX_SIZE_EAGER_COLLECTION)
        return undefined;
      const index = toInteger(idx);
      if (index === null || index === 0) return undefined;
      const all = Array.from(xs.each()) as Expression[];
      const n = all.length;
      // Convert the 1-based `index` (negative counts from the end, with -1
      // appending) to a 0-based gap position in 0..n.
      let gap: number;
      if (index > 0) {
        if (index > n + 1) return undefined;
        gap = index - 1;
      } else {
        if (index < -(n + 1)) return undefined;
        gap = n + 1 + index;
      }
      return ce.function('List', [
        ...all.slice(0, gap),
        value,
        ...all.slice(gap),
      ]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // One `op1.count` per level, threaded into the position guard — see
      // `insertPositionOf`.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (n === undefined || insertPositionOf(expr, n) === undefined)
          return undefined;
        return Number.isFinite(n) ? n + 1 : Infinity;
      },
      // A valid Insert always contains at least the inserted value.
      isEmpty: (expr) =>
        insertPosition(expr) === undefined ? undefined : false,
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (n === undefined || insertPositionOf(expr, n) === undefined)
          return undefined;
        return Number.isFinite(n);
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || !isFunction(expr)) return undefined;
        const g = insertPosition(expr);
        if (g === undefined) return undefined;
        if (index < 1) return undefined;
        if (index < g) return expr.op1.at(index);
        if (index === g) return expr.op3;
        return expr.op1.at(index - 1);
      },
      iterator: (expr) => {
        if (!isFunction(expr)) return undefined;
        const g = insertPosition(expr);
        if (g === undefined) return undefined;
        const source = expr.op1.each();
        const value = expr.op3;
        let yielded = 0;
        let injected = false;
        return {
          next: () => {
            // Inject the value at result position `g`, once the preceding
            // `g-1` source items have been yielded.
            if (!injected && yielded === g - 1) {
              injected = true;
              return { value, done: false };
            }
            const { value: v, done } = source.next();
            if (!done) {
              yielded += 1;
              return { value: v, done: false };
            }
            // Source exhausted before the value was injected (append case).
            if (!injected) {
              injected = true;
              return { value, done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    },
  },

  // Elixir `List.delete_at/2`: return a copy with the element at the 1-based
  // `index` removed. Eager on finite indexed collections; inert otherwise.
  DeleteAt: {
    description: [
      'Return a copy of the indexed collection with the element at the 1-based `index` removed.',
      'A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.',
      'Deleting from a string yields a string.',
    ],
    complexity: 8200,
    // The LEADING arm is the string-preservation rule: what is left after
    // removing one of a string's own characters is a string
    // (`docs/STRING_ROADMAP.md`, "String preservation rule"; promoted in
    // Phase 2 as an ELEMENT-PRESERVING list-out operator). A node that
    // resolves to it evaluates to that string through
    // `evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`, which walks this operator's own
    // lazy `iterator` handler and joins the characters — that step runs
    // BEFORE the `evaluate` handler below, so both the eager small-source
    // path and the lazy large-source path answer a string.
    // Re-segmentation caveat: rejoining the surviving characters can merge or
    // split grapheme clusters, so the result may hold a different number of
    // characters than `Length(xs) - 1` — deleting a base character leaves its
    // combining mark to attach to whatever now precedes it.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T, integer) -> T where T: string) & ((indexed_collection<T>, integer) -> list<T> where T)',
    evaluate: ([xs, idx], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      // Small finite sources materialize eagerly; larger — or unknown-length —
      // sources stay symbolic and are served lazily by the `collection`
      // handlers below (Tycho item 52).
      const size = xs.count;
      if (size === undefined || size > MAX_SIZE_EAGER_COLLECTION)
        return undefined;
      const index = toInteger(idx);
      if (index === null) return undefined;
      const all = Array.from(xs.each()) as Expression[];
      const n = all.length;
      // Convert the 1-based `index` (negative counts from the end) to a 0-based
      // position in 0..n-1.
      let i0: number;
      if (index > 0) {
        if (index > n) return undefined;
        i0 = index - 1;
      } else if (index < 0) {
        if (index < -n) return undefined;
        i0 = n + index;
      } else return undefined;
      return ce.function('List', [...all.slice(0, i0), ...all.slice(i0 + 1)]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // One `op1.count` per level, threaded into the position guard — see
      // `targetPositionOf`.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (n === undefined || targetPositionOf(expr, n) === undefined)
          return undefined;
        return Number.isFinite(n) ? n - 1 : Infinity;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (n === undefined || targetPositionOf(expr, n) === undefined)
          return undefined;
        return Number.isFinite(n) ? n - 1 <= 0 : false;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (n === undefined || targetPositionOf(expr, n) === undefined)
          return undefined;
        return Number.isFinite(n);
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || !isFunction(expr)) return undefined;
        const g = targetPosition(expr);
        if (g === undefined) return undefined;
        if (index < 1) return undefined;
        return index < g ? expr.op1.at(index) : expr.op1.at(index + 1);
      },
      iterator: (expr) => {
        if (!isFunction(expr)) return undefined;
        const g = targetPosition(expr);
        if (g === undefined) return undefined;
        const source = expr.op1.each();
        let pos = 0;
        return {
          next: () => {
            for (;;) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              pos += 1;
              if (pos === g) continue; // skip the deleted position
              return { value, done: false };
            }
          },
        };
      },
    },
  },

  // Elixir `List.replace_at/3`: return a copy with the element at the 1-based
  // `index` replaced by `value`. Eager on finite indexed collections; inert
  // otherwise.
  ReplaceAt: {
    description: [
      'Return a copy of the indexed collection with the element at the 1-based `index` replaced by `value`.',
      'A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.',
    ],
    complexity: 8200,
    // The repeated variable widens the element type to include the replacement
    // value's type (the §4.3 join of the two lower bounds). UNBOUNDED — see
    // `Insert`: a bound would also constrain the SOURCE collection's elements.
    signature: '(indexed_collection<T>, integer, T) -> list<T> where T',
    evaluate: ([xs, idx, value], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      // Small finite sources materialize eagerly; larger — or unknown-length —
      // sources stay symbolic and are served lazily by the `collection`
      // handlers below (Tycho item 52).
      const size = xs.count;
      if (size === undefined || size > MAX_SIZE_EAGER_COLLECTION)
        return undefined;
      const index = toInteger(idx);
      if (index === null) return undefined;
      const all = Array.from(xs.each()) as Expression[];
      const n = all.length;
      let i0: number;
      if (index > 0) {
        if (index > n) return undefined;
        i0 = index - 1;
      } else if (index < 0) {
        if (index < -n) return undefined;
        i0 = n + index;
      } else return undefined;
      const out = [...all];
      out[i0] = value;
      return ce.function('List', out);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // One `op1.count` per level, threaded into the position guard — see
      // `targetPositionOf`.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (n === undefined || targetPositionOf(expr, n) === undefined)
          return undefined;
        return n;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (n === undefined || targetPositionOf(expr, n) === undefined)
          return undefined;
        return Number.isFinite(n) ? n <= 0 : false;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        const n = expr.op1.count;
        if (targetPositionOf(expr, n) === undefined) return undefined;
        return Number.isFinite(n!);
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number' || !isFunction(expr)) return undefined;
        const g = targetPosition(expr);
        if (g === undefined) return undefined;
        if (index < 1) return undefined;
        return index === g ? expr.op3 : expr.op1.at(index);
      },
      iterator: (expr) => {
        if (!isFunction(expr)) return undefined;
        const g = targetPosition(expr);
        if (g === undefined) return undefined;
        const source = expr.op1.each();
        const value = expr.op3;
        let pos = 0;
        return {
          next: () => {
            const { value: v, done } = source.next();
            if (done) return { value: undefined, done: true };
            pos += 1;
            return { value: pos === g ? value : v, done: false };
          },
        };
      },
    },
  },

  RotateLeft: {
    description:
      'Rotate the elements of the collection to the left by n positions.',
    complexity: 8200,
    // Per-kind result rule (`docs/STRING_ROADMAP.md`, "Signature refinement",
    // Phase 0b). A single `(T) -> T where T: indexed_collection` bound would
    // promise kind-preservation for EVERY indexed kind, and the runtime cannot
    // deliver it: a `tuple` type carries its arity and per-position element
    // types, and a `range` admits only ascending, non-empty, step-1 spans. So:
    // a `list` operand keeps its full type (this operation is closed over
    // lists, shape included); every other indexed kind — tuple, range, an
    // opaque `indexed_collection<T>` — results in `list<T>`, which is what the
    // lazy view materializes to. Static promise and runtime laziness are
    // decoupled: the value stays a lazy view either way.
    // A rotation is length-preserving, so the `list` arm keeps the shape
    // (`vector<3>` in, `vector<3>` out); a rotated `range` is not a span.
    // The LEADING arm is the string-preservation rule: a rotation of a
    // string's characters is a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"), and a node that resolves to it evaluates to that
    // string (`evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`). Re-segmentation caveat: rejoining
    // the rotated characters can merge or split grapheme clusters, so the
    // result may hold a different number of characters than the input, even
    // though a rotation of the character ARRAY is length-preserving.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)',
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // A rotation is a permutation, so length/emptiness/finiteness are
      // offset-INVARIANT and knowable here. They are nonetheless suppressed
      // when the offset has no value, because `at`/`iterator` cannot answer
      // then: this is the house rule `permutationsCount` states for the same
      // situation — "report `undefined` … rather than a count no consumer can
      // back up" (`library/combinatorics.ts`). A count a consumer cannot back
      // up is what makes a broadcast zip positions no element arrives for.
      // `contains` is deliberately NOT gated: `false` there means definitively
      // absent, so suppressing it would answer a wrong question rather than
      // decline one.
      count: (expr) => {
        if (!isFunction(expr) || integerParam(expr.op2) === null)
          return undefined;
        return expr.op1.count;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr) || integerParam(expr.op2) === null)
          return undefined;
        return expr.op1.isEmptyCollection;
      },
      isFinite: (expr) => {
        if (!isFunction(expr) || integerParam(expr.op2) === null)
          return undefined;
        return expr.op1.isFiniteCollection;
      },
      // NOT gated on the offset: a rotation is a permutation, so membership is
      // offset-INVARIANT. `false` here is the DEFINITIVE "not a member" answer
      // (the indeterminate one is `undefined`), so gating it made
      // `Contains(RotateLeft(xs, n), x)` answer False for an element that is in
      // every rotation.
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        // A permutation/repetition of the source: membership is exactly the
        // source's, INCLUDING its undecided verdict (`?? false` claimed a
        // definite "not a member" the source never gave).
        return expr.op1.contains(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const l = expr.op1.count;
        if (l === undefined || l <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        const offset = integerParam(expr.op2);
        if (offset === null)
          return { next: () => ({ value: undefined, done: true }) };
        let n = offset ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        let index = 1;
        const last = l;

        return {
          next: () => {
            if (index === last + 1) return { value: undefined, done: true };
            index += 1;
            const v = expr.op1.at(((index - 1 - 1 + n) % l) + 1);
            if (v === undefined) return { value: undefined, done: true };
            return { value: v, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined || l <= 0) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l) return undefined;
        const offset = integerParam(expr.op2);
        if (offset === null) return undefined; // symbolic offset
        let n = offset ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        return expr.op1.at(((index - 1 + n) % l) + 1);
      },
    },
  },

  RotateRight: {
    description:
      'Rotate the elements of the collection to the right by n positions.',
    complexity: 8200,
    // Per-kind result rule and leading string-preserving arm: see
    // `RotateLeft`, including its re-segmentation caveat (rejoining the
    // rotated characters can merge or split grapheme clusters, so the result
    // may hold a different number of characters than the input).
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)',
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // See `RotateLeft`: knowable, but suppressed while `at`/`iterator`
      // cannot back it up.
      count: (expr) => {
        if (!isFunction(expr) || integerParam(expr.op2) === null)
          return undefined;
        return expr.op1.count;
      },
      // NOT gated on the offset: a rotation is a permutation, so membership is
      // offset-INVARIANT. `false` here is the DEFINITIVE "not a member" answer
      // (the indeterminate one is `undefined`), so gating it made
      // `Contains(RotateLeft(xs, n), x)` answer False for an element that is in
      // every rotation.
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        // A permutation/repetition of the source: membership is exactly the
        // source's, INCLUDING its undecided verdict (`?? false` claimed a
        // definite "not a member" the source never gave).
        return expr.op1.contains(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const l = expr.op1.count;
        if (l === undefined || l <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        const offset = integerParam(expr.op2);
        if (offset === null)
          return { next: () => ({ value: undefined, done: true }) };
        let n = offset ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        let index = 1;

        return {
          next: () => {
            if (index === l + 1) return { value: undefined, done: true };
            index += 1;
            const i = ((index - 1 - 1 + (l - n)) % l) + 1;
            const v = expr.op1.at(i);
            if (v === undefined) return { value: undefined, done: true };
            return { value: v, done: false };
          },
        };
      },
      at: (
        expr: Expression,
        index: number | string
      ): undefined | Expression => {
        if (typeof index !== 'number') return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined || l <= 0) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l) return undefined;
        const offset = integerParam(expr.op2);
        if (offset === null) return undefined; // symbolic offset
        let n = offset ?? 1;
        n = ((n % l) + l) % l; // Normalize shift
        const i = ((index - 1 + (l - n)) % l) + 1;
        return expr.op1.at(i);
      },
    },
  },
  // Return a list of the elements of each collection.
  // If all collections are Set, return a Set
  // ["Join", ["List", 1, 2, 3], ["List", 4, 5, 6]] -> ["List", 1, 2, 3, 4, 5, 6]

  IndexOf: {
    description:
      'Return the 1-based index of the first occurrence of value in collection, or 0 if not found.',
    complexity: 8200,
    signature: '(collection<any>, any) -> integer',
    evaluate: ([xs, value], { engine: ce }) => {
      const index = xs.indexWhere((x) => x.isSame(value)) ?? undefined;
      return ce.number(index ?? 0);
    },
  },

  // The SEQUENCE-SEARCH family (`docs/STRING_ROADMAP.md`, "Sequence-search
  // operations"). Substring search generalized to contiguous-subsequence
  // search over any indexed collection: one generic operator per question,
  // with strings as the motivating instance. The needle is ALWAYS read as a
  // SEQUENCE of elements, never as one element — that is what keeps these
  // distinct from `IndexOf`/`Contains` (element search) and what makes
  // `RangeOf([[1,2],[3,4]], [3,4])` unambiguous.
  RangeOf: {
    description: [
      'Return the 1-based inclusive index span of the first occurrence of `needle` as a contiguous subsequence of the indexed collection, or `Nothing` when it does not occur.',
      "The search starts at index `from` (1 by default) and the span is always expressed in the original collection's indices, so `RangeOf(xs, needle, Last(r) + 1)` finds the next non-overlapping occurrence and the loop ends at `Nothing`.",
      'On a string the needle is matched character by character, so a match never begins or ends inside a grapheme cluster.',
    ],
    complexity: 8200,
    // The span is returned rather than a start index because it feeds slicing
    // and replacement directly: `Slice(xs, RangeOf(xs, needle))` yields the
    // same element sequence as `needle`. The law is stated element-wise, not
    // as `== needle`, because the needle may be a sibling KIND of the subject —
    // searching a string with a `list<character>` needle is well-typed, and
    // `Slice` is kind-preserving, so the two sides can be a `string` and a
    // `list<character>`, which are never `==` (`docs/STRING_ROADMAP.md`,
    // design constraint 2).
    // Absence is `Nothing`, not `IndexOf`'s `0`: `0` is an index sentinel and
    // is not a range.
    signature:
      '(indexed_collection<T>, indexed_collection<T>, from: integer?) -> range | nothing where T',
    // Provable declines only. `true` is never claimed: even with both
    // operands finite, a needle that is ABSENT evaluates to `Nothing`, which
    // is not a collection at all, so evaluation cannot promise one.
    canEnumerate: (expr) => {
      if (!isFunction(expr)) return undefined;
      if (expr.op1.isFiniteCollection === false) return false;
      if (expr.op2.isFiniteCollection === false) return false;
      return undefined;
    },
    evaluate: ([xs, needle, fromOp], { engine: ce }) => {
      const operands = sequenceSearchOperands(xs, needle);
      if (operands === undefined) return undefined;
      const [subject, pattern] = operands;
      const from = integerParam(fromOp);
      // A `from` that is PRESENT but does not resolve to an integer right now
      // (a free symbol) is indeterminate, never the default: substituting 1
      // would answer a span for a search the caller did not ask for. A
      // FRACTIONAL `from` never reaches here — the `integer` parameter type
      // rejects it at canonicalization with `incompatible-type`.
      if (from === null) return undefined;
      const start = from ?? 1;
      // `from` must be at least 1; index 0 and negative indices have no
      // meaning for a search reporting 1-based spans. Past the END is
      // deliberately NOT an error, just `Nothing`: the natural find-all loop
      // legitimately produces `Length(xs) + 1` after a match at the very end.
      if (start < 1)
        return ce.error([
          'out-of-range',
          'an index of 1 or more',
          start.toString(),
        ]);
      // An EMPTY needle is an error value here, while the boolean members of
      // the family answer `True`. The asymmetry is forced, not a taste call:
      // an empty span is not representable, because `Range(1, 0)` is the
      // DESCENDING range [1, 0] rather than an empty one.
      if (pattern.length === 0)
        return ce.error([
          'out-of-range',
          'a non-empty needle',
          needle.toString(),
        ]);
      for (let i = start - 1; i + pattern.length <= subject.length; i++) {
        if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
        if (matchesSequenceAt(subject, pattern, i))
          return ce.function('Range', [
            ce.number(i + 1),
            ce.number(i + pattern.length),
          ]);
      }
      return ce.Nothing;
    },
  },

  ContainsSequence: {
    description: [
      'Return `True` when `needle` occurs as a contiguous subsequence of the indexed collection.',
      'Unlike `Contains`, which tests membership of a single element, the needle is read as a sequence: `ContainsSequence("abc", "ab")` is `True` while `Contains("abc", "ab")` is `False`.',
    ],
    complexity: 8200,
    signature:
      '(indexed_collection<T>, indexed_collection<T>) -> boolean where T',
    evaluate: ([xs, needle], { engine: ce }) => {
      const operands = sequenceSearchOperands(xs, needle);
      if (operands === undefined) return undefined;
      const [subject, pattern] = operands;
      // An empty needle is `True` by definition: the empty sequence is a
      // subsequence of everything. Diverges from `RangeOf`, which must reject
      // an empty needle because it has no representable span to return; a
      // boolean needs no span.
      if (pattern.length === 0) return ce.True;
      for (let i = 0; i + pattern.length <= subject.length; i++) {
        if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
        if (matchesSequenceAt(subject, pattern, i)) return ce.True;
      }
      return ce.False;
    },
  },

  StartsWith: {
    description: [
      'Return `True` when the indexed collection begins with `prefix` as a contiguous subsequence.',
      'On a string the prefix is matched character by character, so a prefix that would end inside a grapheme cluster does not match. An empty prefix matches everything.',
    ],
    complexity: 8200,
    signature:
      '(indexed_collection<T>, prefix: indexed_collection<T>) -> boolean where T',
    evaluate: ([xs, prefix], { engine: ce }) => {
      const operands = sequenceSearchOperands(xs, prefix);
      if (operands === undefined) return undefined;
      const [subject, pattern] = operands;
      // An empty prefix matches everything, following `ContainsSequence`'s
      // rule rather than `RangeOf`'s: this returns a boolean, so the
      // unrepresentable-empty-span problem does not arise.
      if (pattern.length === 0) return ce.True;
      if (pattern.length > subject.length) return ce.False;
      return matchesSequenceAt(subject, pattern, 0) ? ce.True : ce.False;
    },
  },

  EndsWith: {
    description: [
      'Return `True` when the indexed collection ends with `suffix` as a contiguous subsequence.',
      'On a string the suffix is matched character by character, so a suffix that would begin inside a grapheme cluster does not match. An empty suffix matches everything.',
    ],
    complexity: 8200,
    signature:
      '(indexed_collection<T>, suffix: indexed_collection<T>) -> boolean where T',
    evaluate: ([xs, suffix], { engine: ce }) => {
      // This is the member that needs the subject's LENGTH, since it inspects
      // the tail. `sequenceSearchOperands` supplies it: it admits only finite
      // collections, and walking one to the end is what yields its length.
      const operands = sequenceSearchOperands(xs, suffix);
      if (operands === undefined) return undefined;
      const [subject, pattern] = operands;
      if (pattern.length === 0) return ce.True;
      if (pattern.length > subject.length) return ce.False;
      return matchesSequenceAt(
        subject,
        pattern,
        subject.length - pattern.length
      )
        ? ce.True
        : ce.False;
    },
  },

  IndexWhere: {
    description:
      'Return the 1-based index of the first element satisfying the predicate, or 0 if not found.',
    complexity: 8200,
    // Design D phase 1: the element-of link lives in the SIGNATURE (see
    // `CountIf`). The result type is unchanged.
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>) -> integer where T',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'IndexWhere', ops, 1, PER_ELEMENT_SUPPLY),
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Zero;
      // A source that cannot be enumerated has no first match to index AND no
      // grounds for the NOT-FOUND `0` — stay inert (see `isEnumerableSource`).
      if (!isEnumerableSource(xs)) return undefined;
      // An element-valued predicate failure (see `predicateErrorValue`) is
      // reported as the operator's result. Collected here rather than thrown:
      // stop the walk (by reporting a match) and return the error below.
      const predErrors: Expression[] = [];
      const index =
        xs.indexWhere((x) => {
          const applied = f([x]);
          const pred = sym(applied);
          if (pred === 'True') return true;
          if (pred === 'False') return false;
          const err = predicateErrorValue(applied);
          if (err) {
            predErrors.push(err);
            return true;
          }
          throw predicateResultError('IndexWhere', fn);
        }) ?? undefined;
      if (predErrors.length > 0) return predErrors[0];
      return ce.number(index ?? 0);
    },
  },

  Find: {
    description:
      'Return the first element of the collection satisfying the predicate, or Nothing if none found.',
    complexity: 8200,
    // Design D phase 1: the element-of link lives in the SIGNATURE (see
    // `CountIf`). The declared result stays the widest `any`: the NOT-FOUND
    // answer is `Nothing`, so the precise `elementType | nothing` is the `type:`
    // handler's below, not something `T` alone could say (§7 rule 1).
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>) -> any where T',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'Find', ops, 1, PER_ELEMENT_SUPPLY),
    // Returns a single element, or `Nothing` when no element matches: the
    // element type of the collection, not the collection type.
    type: (ops) =>
      reduceType({
        kind: 'union',
        types: [collectionElementType(ops[0].type.type) ?? 'any', 'nothing'],
      }),
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Nothing;
      // A source that cannot be enumerated has no first match to report AND no
      // grounds for the NOT-FOUND `Nothing` — stay inert (see
      // `isEnumerableSource`).
      if (!isEnumerableSource(xs)) return undefined;
      for (const item of xs.each()) {
        const applied = f([item]);
        const pred = sym(applied);
        if (pred === 'False') continue;
        if (pred === 'True') return item;
        // See `predicateErrorValue`: an element-valued predicate failure is
        // surfaced as the operator's result.
        const err = predicateErrorValue(applied);
        if (err) return err;
        throw predicateResultError('Find', fn);
      }
      return ce.Nothing;
    },
  },

  CountIf: {
    description:
      'Return the number of elements in the collection satisfying the predicate.',
    complexity: 8200,
    // Design E phase E1 (`docs/plans/2026-08-18-compatibility-admission-
    // callbacks.md`): the predicate slot is an honest arrow. Admission is by
    // COMPATIBILITY, not subtyping (a narrower named predicate, a
    // `function`-typed symbol and an unknown-result literal all still pass;
    // a PROVABLY DISJOINT predicate — `Filter`-style `list<string>` source
    // with a number-only predicate — is now rejected at canonicalization),
    // `(T)` contextually types an inline literal there, and the `any` effect
    // slot keeps effectful predicates admitted. The result type is unchanged.
    signature:
      '(collection<T>, predicate: (T) any -> boolean) -> integer where T',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'CountIf', ops, 1, PER_ELEMENT_SUPPLY),
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Zero;
      // Stay inert on non-finite or unknown-length input: a count requires
      // totality (walking every element).
      if (xs.isFiniteCollection !== true) return undefined;
      // Finiteness is not enumerability: `Take(xs, 2)` over a valueless `xs`
      // is finite (at most 2 elements) yet has no elements to walk, and the
      // loop below would count 0. See `isEnumerableSource`.
      if (!isEnumerableSource(xs)) return undefined;
      let count = 0;
      for (const item of xs.each()) {
        const applied = f([item]);
        const pred = sym(applied);
        if (pred === 'False') continue;
        if (pred === 'True') count++;
        else {
          // See `predicateErrorValue`: an element-valued predicate failure is
          // surfaced as the operator's result.
          const err = predicateErrorValue(applied);
          if (err) return err;
          throw predicateResultError('CountIf', fn);
        }
      }
      return ce.number(count);
    },
  },

  Position: {
    description:
      'Return a list of indexes of elements in the collection satisfying the predicate.',
    complexity: 8200,
    // Design D phase 1: the element-of link lives in the SIGNATURE (see
    // `CountIf`). The result is INDEXES, not elements — independent of `T`, and
    // unchanged.
    signature:
      '(collection<T>, predicate: callback<(T) -> boolean>) -> list<integer> where T',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'Position', ops, 1, PER_ELEMENT_SUPPLY),
    type: () => 'list<integer>',
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.function('List', []);
      // Stay inert on non-finite or unknown-length input: reporting positions
      // requires totality (walking every element).
      if (xs.isFiniteCollection !== true) return undefined;
      // Finiteness is not enumerability — see `CountIf`.
      if (!isEnumerableSource(xs)) return undefined;
      const indices: Expression[] = [];
      let index = 1;
      for (const item of xs.each()) {
        const applied = f([item]);
        const pred = sym(applied);
        if (pred === 'True') indices.push(ce.number(index));
        else if (pred !== 'False') {
          // See `predicateErrorValue`: an element-valued predicate failure is
          // surfaced as the operator's result.
          const err = predicateErrorValue(applied);
          if (err) return err;
          throw predicateResultError('Position', fn);
        }
        index++;
      }
      return ce.function('List', indices);
    },
  },

  // Return the indexes of the elements so they are in sorted order.
  // `Sort` is equivalent to `["Take", xs, ["Ordering", xs]]`.
  // APL: Grade Up `⍋` and Grade Down `⍒`
  // Mathematica: `Ordering`
  Ordering: {
    description: 'Return the indexes that would sort the collection.',
    complexity: 8200,
    signature: '(indexed_collection<any>, order: function?) -> list<integer>',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'Ordering', ops, 1, SORT_SUPPLY),
    // Provable declines only (finite, walkable source required); success is
    // not cheaply decidable, so never `true` — see `canEnumerateFiniteSource`.
    canEnumerate: canEnumerateFiniteSource,
    // One index per element: length-preserving over the source.
    elementCount: elementCountOfFiniteSource,
    evaluate: ([xs, fn], { engine: ce }) => {
      // Stay inert on non-finite or unknown-length input, aligning with Sort:
      // an empty List would falsely claim a complete ordering.
      if (xs.isFiniteCollection !== true) return undefined;
      // Same for a finite-but-unwalkable source (`Take(xs, 2)` over a valueless
      // `xs`), where the walk below finds no elements to order. `Sort` already
      // declines it — `sortedIndices` returns null — but `Ordering` reads that
      // as the empty ordering.
      if (!isEnumerableSource(xs)) return undefined;
      const indices = sortedIndices(xs, fn);
      if (!indices) return ce.function('List', []);
      return ce.function('List', indices);
    },
  },

  Sort: {
    description:
      'Return the elements of the collection sorted according to the given comparison function.',
    complexity: 8200,
    // Apart from the string arm the result always rebuilds as a `List` (see
    // `evaluate`), so the result type is `list<T>`, not the source's (possibly
    // indexed/Range) type. The `order` slot stays the PRIMITIVE `function`,
    // not an arrow: a function-typed *symbol* operand must be admitted there
    // (pinned by `collection-callback-signatures.test.ts`).
    // The LEADING arm is the string-preservation rule: sorting a string's
    // characters yields a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"). The optional `order` needs no arity split — an
    // overload arm may carry an optional parameter, and most-specific-wins
    // picks this arm for a string operand with or without a comparator.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T, order: function?) -> T where T: string) & ((indexed_collection<T>, order: function?) -> list<T> where T)',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'Sort', ops, 1, SORT_SUPPLY),
    // Provable declines only (finite, walkable source required); success is
    // not cheaply decidable, so never `true` — see `canEnumerateFiniteSource`.
    canEnumerate: canEnumerateFiniteSource,
    // A permutation of the source: length-preserving.
    elementCount: elementCountOfFiniteSource,
    evaluate: ([xs, fn], { engine: ce }) => {
      // Eager collection results rebuild as `List`, never the source's head
      // (a `Range`/`Linspace` head would reinterpret the sorted elements as
      // lo/hi/step). Stay inert on non-finite or unknown-length input.
      if (xs.isFiniteCollection !== true) return undefined;
      const indices = sortedIndices(xs, fn);
      if (!indices) return undefined;
      const elements = indices.map((i) => xs.at(i)!);
      // The string arm: a sorted string is a string. `Sort` is eager and has
      // no lazy collection handlers, so the join happens here rather than in
      // `evaluateStringPreservingCollection`. Re-segmentation caveat:
      // rejoining the sorted characters can merge or split grapheme clusters,
      // so the result may hold a different number of characters than the
      // input — sorting moves a combining mark next to whatever character now
      // precedes it.
      if (isString(xs)) return joinCharacters(ce, elements);
      return ce.function('List', elements);
    },
  },

  // Return the element of the collection that maximizes/minimizes the unary
  // key `f(x)`. First occurrence wins ties. Eager and inert (undefined) on a
  // non-finite or empty collection, or when a key comparison is undetermined.
  MaxBy: {
    description:
      'Return the element of the collection that maximizes the given key function.',
    complexity: 8200,
    lazy: true,
    signature: '(collection<any>, key: function) -> value',
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'MaxBy',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!collection.isValid || !fn) return null;
      return engine._fn('MaxBy', [collection, fn]);
    },
    type: (ops) => collectionElementType(ops[0].type.type) ?? 'any',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      return run(
        extremumBy(xs, f, ce, 'max', 'element'),
        ce._timeRemaining,
        ce._deadlineFrame
      );
    },
  },

  MinBy: {
    description:
      'Return the element of the collection that minimizes the given key function.',
    complexity: 8200,
    lazy: true,
    signature: '(collection<any>, key: function) -> value',
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'MinBy',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!collection.isValid || !fn) return null;
      return engine._fn('MinBy', [collection, fn]);
    },
    type: (ops) => collectionElementType(ops[0].type.type) ?? 'any',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      return run(
        extremumBy(xs, f, ce, 'min', 'element'),
        ce._timeRemaining,
        ce._deadlineFrame
      );
    },
  },

  // Return the 1-based index (Julia semantics) of the element maximizing/
  // minimizing the unary key `f(x)`, or the element itself as the key when `f`
  // is absent. First occurrence wins ties. Inert on non-finite/empty
  // collections or undetermined comparisons.
  ArgMax: {
    description:
      'Return the 1-based index of the element that maximizes the given key function (or the element itself when no key is given).',
    complexity: 8200,
    lazy: true,
    signature: '(indexed_collection<any>, key: function?) -> integer',
    canonical: (ops, { engine }) => {
      // Optimization form `ArgMax(f, domain)` (Wolfram/Fungrim convention:
      // the locations maximizing f over a set). The engine does not evaluate
      // it, but it must canonicalize the function operand normally — the
      // identities library ships rewrite rules whose stored patterns are the
      // canonical (Block-wrapped) function form; short-circuiting here left
      // the operand un-wrapped and made those patterns unmatchable.
      const optForm = canonicalOptimumForm(engine, 'ArgMax', ops);
      if (optForm !== undefined) return optForm;
      // An index result only makes sense for an INDEXED collection — match
      // the declared signature (MaxBy/MinBy, which return the element,
      // accept any collection).
      const collection = checkCollectionOperand(
        engine,
        ops[0],
        'indexed_collection'
      );
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('ArgMax', [collection]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'ArgMax',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!fn) return null;
      return engine._fn('ArgMax', [collection, fn]);
    },
    type: () => 'integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = fn ? applicable(fn) : undefined;
      return run(
        extremumBy(xs, f, ce, 'max', 'index'),
        ce._timeRemaining,
        ce._deadlineFrame
      );
    },
  },

  ArgMin: {
    description:
      'Return the 1-based index of the element that minimizes the given key function (or the element itself when no key is given).',
    complexity: 8200,
    lazy: true,
    signature: '(indexed_collection<any>, key: function?) -> integer',
    canonical: (ops, { engine }) => {
      // Optimization form `ArgMin(f, domain)` — see the ArgMax note.
      const optForm = canonicalOptimumForm(engine, 'ArgMin', ops);
      if (optForm !== undefined) return optForm;
      // An index result only makes sense for an INDEXED collection — match
      // the declared signature (MaxBy/MinBy, which return the element,
      // accept any collection).
      const collection = checkCollectionOperand(
        engine,
        ops[0],
        'indexed_collection'
      );
      if (!collection.isValid) return null;
      if (ops[1] === undefined) return engine._fn('ArgMin', [collection]);
      const fn = canonicalCallbackOperand(ops[1], {
        operator: 'ArgMin',
        supply: PER_ELEMENT_SUPPLY,
        source: collection,
      });
      if (!fn) return null;
      return engine._fn('ArgMin', [collection, fn]);
    },
    type: () => 'integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = fn ? applicable(fn) : undefined;
      return run(
        extremumBy(xs, f, ce, 'min', 'index'),
        ce._timeRemaining,
        ce._deadlineFrame
      );
    },
  },

  // Randomize the order of the elements in the collection. Seeding is
  // `WithRandomSeed`; there is no seed argument (see
  // `docs/plans/2026-07-25-random-signature-redesign.md` §5).
  RandomShuffle: {
    description:
      'Randomize the order of the elements in the collection. ' +
      'Shuffling a string yields a string. ' +
      'Wrap the call in `WithRandomSeed(seed, ...)` to make it deterministic.',
    complexity: 8200,
    // `RandomShuffle(xs)` draws from the engine stream, so the operator must
    // declare the `random` label (as `Random` does) — which makes it impure.
    // Without it, `isPure` — and therefore `isConstant` — is true for a
    // shuffle of a literal list, and the impurity backstop in
    // `map-auto-compile.ts` does not gate it.
    // Apart from the string arm the result always rebuilds as a `List` (see
    // `evaluate`), so the result type is `list<T>`, not the source's (possibly
    // indexed/Range) type.
    // The LEADING arm is the string-preservation rule: a permutation of a
    // string's own characters is a string (`docs/STRING_ROADMAP.md`, "String
    // preservation rule"; promoted in Phase 2 as an ELEMENT-PRESERVING
    // list-out operator). `RandomShuffle` is eager and has no lazy collection
    // handlers, so the join happens in the `evaluate` handler below rather
    // than in `evaluateStringPreservingCollection`.
    // Re-segmentation caveat: rejoining the permuted characters can merge or
    // split grapheme clusters, so the result may hold a different number of
    // characters than the input — a combining mark can land next to a
    // different base character.
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T) random -> T where T: string) & ((indexed_collection<T>) random -> list<T> where T)',
    // Provable declines only, answered from the SOURCE's facets alone — an
    // IMPURE producer must never claim `true` (the `at()` materialize
    // fallback is pure-only, so a `true` would promise a walk the indexed
    // route cannot deliver), and the predicate consumes ZERO draws.
    // Mirrors the evaluate guards: an infinite source errors, an unknown
    // finiteness stays symbolic.
    canEnumerate: canEnumerateFiniteSource,
    // A permutation of the source: length-preserving, and reading it consumes
    // ZERO draws (`elementCountOfFiniteSource` never evaluates).
    elementCount: elementCountOfFiniteSource,
    evaluate: ([xs], { engine: ce }) => {
      // An INFINITE collection can never be shuffled: error loudly, matching
      // `Random`/`RandomSample` (`out-of-range`, "a finite collection").
      // Only an INDETERMINATE finiteness stays symbolic — that is a "not yet
      // known", not a "cannot".
      if (xs.isFiniteCollection === false)
        return ce.error(['out-of-range', 'a finite collection', xs.toString()]);
      if (xs.isFiniteCollection === undefined) return undefined;

      // A permutation needs every element, so materializing is inherent —
      // but `Shuffle(Range(1, 10^9))` would then try to allocate a billion
      // boxed numbers (an uncatchable heap-OOM, the item-64b class). Refuse
      // past the size cap, loudly, before allocating.
      const tooBig = (n: string): Expression =>
        ce.error([
          'out-of-range',
          `a collection of at most ${MAX_RANDOM_ELEMENT_COUNT} elements`,
          n,
        ]);
      const count = xs.count;
      if (count !== undefined && count > MAX_RANDOM_ELEMENT_COUNT)
        return tooBig(count.toString());

      const data: Expression[] = [];
      for (const x of xs.each()) {
        if ((data.length & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
        // A lazy collection with an unknown count is bounded here instead.
        if (data.length >= MAX_RANDOM_ELEMENT_COUNT)
          return tooBig(`more than ${MAX_RANDOM_ELEMENT_COUNT}`);
        data.push(x);
      }

      // Fisher-Yates: exactly `n − 1` draws, one per swap.
      for (let i = data.length - 1; i > 0; i--) {
        if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
        const j = Math.floor(ce._random() * (i + 1));
        [data[i], data[j]] = [data[j], data[i]];
      }

      // The string arm: a shuffled string is a string. `RandomShuffle` is
      // eager and has no lazy collection handlers, so the join happens here
      // rather than in `evaluateStringPreservingCollection`. Re-segmentation
      // caveat: rejoining the permuted characters can merge or split grapheme
      // clusters, so the result may hold a different number of characters than
      // the input.
      if (isString(xs)) return joinCharacters(ce, data);
      // Eager collection results rebuild as `List`, never the source's head
      // (a `Range`/`Linspace` head would reinterpret the shuffled elements as
      // lo/hi/step).
      return ce.function('List', data);
    },
  },

  Tabulate: {
    description:
      'Create a collection by applying a function to each index in the specified dimensions.',
    keywords: ['table'],
    complexity: 8200,

    lazy: true,
    signature: '(generator: function, integer, integer?) -> indexed_collection',
    // Tabulate is an INDEXED collection (ordered, `at`-addressable). Report the
    // element type so it serializes as a list `[…]`, not a set `{…}`: for a 1-D
    // tabulation the element is the function's result; for higher rank each
    // element is itself a (nested) list.
    type: (ops) => {
      if (ops.length <= 1) return parseType('indexed_collection');
      if (ops.length === 2) {
        const elt = functionResult(ops[0].type.type) ?? 'any';
        return { kind: 'indexed_collection', elements: elt };
      }
      return parseType('indexed_collection<list>');
    },
    canonical: (ops, { engine }) => {
      // One index per DIMENSION operand (`Tabulate(f, n, m)` computes
      // `f(i, j)`), so the number of dimensions is the arity the generator
      // must accept. With no dimension at all the tabulation is empty and
      // there is no application to check.
      const dimCount = ops.length - 1;
      const fn = canonicalCallbackOperand(
        ops[0],
        dimCount === 0
          ? undefined
          : {
              operator: 'Tabulate',
              supply: {
                count: dimCount,
                describes:
                  dimCount === 1
                    ? 'the 1-based index of the element'
                    : `the ${dimCount} 1-based indexes of the element, one per dimension`,
              },
            }
      );
      if (!fn) return null;

      if (!ops[2])
        return engine._fn('Tabulate', [
          fn,
          checkType(engine, ops[1]?.canonical, 'integer'),
        ]);

      return engine._fn('Tabulate', [
        fn,
        checkType(engine, ops[1]?.canonical, 'integer'),
        checkType(engine, ops[2]?.canonical, 'integer'),
      ]);
    },
    // A lazy indexed collection (like `Range`/`Map`): `evaluate()` returns the
    // `Tabulate` itself. `.count` is the outer dimension (no walk); an element
    // is computed by applying the function only when indexed or iterated, so a
    // `Tabulate(f, 1_000_000)` bound but unread costs O(1) instead of building
    // a million-element list.
    collection: {
      isEnumerable: (expr) => tabulateCount(expr) !== undefined,
      isLazy: () => true,
      elementMemo: true,
      count: (expr) => tabulateCount(expr),
      isEmpty: (expr) => {
        const c = tabulateCount(expr);
        return c === undefined ? undefined : c === 0;
      },
      isFinite: (expr) => {
        const c = tabulateCount(expr);
        return c === undefined ? undefined : Number.isFinite(c);
      },
      iterator: tabulateIterator,
      at: (expr, index) => tabulateAt(expr, index),
    },
  },

  Table: {
    description: [
      'An alias for `Tabulate` (the preferred name) that additionally accepts',
      'Mathematica-style iterator specs, e.g. `Table(i^2, {i, 1, n})` or',
      '`Table(i, {i, lo, hi, step})`, and the equivalent tuple spelling',
      '`Table(i^2, (i, 1, n))`.',
    ],
    complexity: 8200,

    // Lazy so the iterator specs are held (raw): their index symbols are not
    // canonicalized (which would fold `i` to the imaginary unit) before this
    // handler can reinterpret them as iterator specs.
    lazy: true,
    signature: '(function, integer, integer?) -> collection',
    canonical: (ops, { engine: ce }) => {
      const specs = ops.slice(1);

      // Alias form: no iterator spec present (e.g. `Table(fn, 5)`). Delegate
      // to `Tabulate`, which — also being lazy — canonicalizes the raw held
      // ops through its own canonical handler. A bare integer (or pair of
      // integers) is NOT an iterator spec.
      if (!specs.some((op) => isIteratorSpecShape(op)))
        return ce.function('Tabulate', ops);

      // Iterator form: EVERY operand after the body must be a valid iterator
      // triple `{sym, lo, hi}` / `(sym, lo, hi)` or `{sym, lo, hi, step}` /
      // `(sym, lo, hi, step)` — the same shape validation as the `Set` and
      // `Tuple` branches of `canonicalIndexingSet`. A malformed spec
      // (non-symbol first element, wrong arity, or a mix of spec and non-spec
      // operands) keeps the strict posture: return `null` so the expression
      // stays inert rather than guessing a bound.
      type Spec = {
        index: Expression;
        lo: Expression;
        hi: Expression;
        step?: Expression;
      };
      const parsed: Spec[] = [];
      for (const op of specs) {
        if (!isIteratorSpecShape(op)) return null;
        const setOps = op.ops ?? [];
        const idx = setOps[0];
        if (!idx || !isSymbol(idx) || setOps.length < 3 || setOps.length > 4)
          return null;
        parsed.push({
          index: idx,
          lo: setOps[1],
          hi: setOps[2],
          step: setOps.length === 4 ? setOps[3] : undefined,
        });
      }

      // All-ones fast path: every spec is exactly `{v, 1, n}` (lower bound the
      // literal integer 1, no step). Canonicalize to
      // `Tabulate(Function(expr, v₁, …), n₁, …)`; `Tabulate` applies the
      // function to 1-based indices, matching the iterator semantics.
      if (parsed.every((s) => s.step === undefined && s.lo.isSame(1))) {
        const fn = ce._fn('Function', [ops[0], ...parsed.map((s) => s.index)], {
          canonical: false,
        });
        return ce.function('Tabulate', [fn, ...parsed.map((s) => s.hi)]);
      }

      // General `lo`/`step` case: nested `Map` over `Range`. Fold from the LAST
      // spec inward so the FIRST spec is the outermost dimension (Mathematica
      // row order: `Table[i·j, {i,1,2}, {j,1,3}]` → `[[1,2,3],[2,4,6]]`). Build
      // the tree raw and canonicalize it in a single top-down pass so each
      // `Function`'s parameters shadow their index symbols (keeping the inner
      // body symbolic).
      let acc: Expression = ops[0];
      for (let k = parsed.length - 1; k >= 0; k--) {
        const s = parsed[k];
        const range = ce._fn(
          'Range',
          s.step ? [s.lo, s.hi, s.step] : [s.lo, s.hi],
          { canonical: false }
        );
        const fn = ce._fn('Function', [acc, s.index], { canonical: false });
        acc = ce._fn('Map', [fn, range], { canonical: false });
      }
      return acc.canonical;
    },
  },

  /* Return a tuple of the unique elements, and their respective count
   * Ex: Tally([a, c, a, d, a, c]) = [[a, c, d], [3, 2, 1]]
   */
  Tally: {
    description:
      'Return a tuple with the unique elements of the collection and their respective counts.',
    complexity: 8200,
    signature: '(collection<T>) -> tuple<list<T>, list<integer>> where T',
    // Provable declines only (finite, walkable source required); success is
    // not cheaply decidable, so never `true` — see `canEnumerateFiniteSource`.
    canEnumerate: canEnumerateFiniteSource,
    evaluate: (ops, { engine: ce }) => {
      if (!ops[0].isFiniteCollection) return undefined;
      const [values, counts] = tally(ops[0]!);
      return ce.tuple(ce.function('List', values), ce.function('List', counts));
    },
  },

  // Return the first element of Tally()
  // Equivalent to `Union` in Mathematica, `distinct` in Scala,
  // Unique or Nub ∪, ↑ in APL
  Unique: {
    description: 'Return a list of the unique elements of the collection.',
    complexity: 8200,
    // The LEADING arm is the string-preservation rule: the distinct characters
    // of a string, in first-occurrence order, are a string
    // (`docs/STRING_ROADMAP.md`, "String preservation rule").
    // Spelled as a BOUNDED type variable (`T where T: string`), never the
    // ground type `string`: an `unknown`- or `any`-typed operand refutes no
    // arm, so a ground `string` parameter would win most-specific-wins on
    // every untyped operand and claim `string` for a call that usually
    // returns a list. A bounded variable with no call-site binding does not.
    signature:
      '((T) -> T where T: string) & ((collection<T>) -> list<T> where T)',
    // Provable declines only (finite, walkable source required); success is
    // not cheaply decidable, so never `true` — see `canEnumerateFiniteSource`.
    canEnumerate: canEnumerateFiniteSource,
    evaluate: (ops, { engine: ce }) => {
      if (!ops[0].isFiniteCollection) return undefined;
      const [values, _counts] = tally(ops[0]!);
      // The string arm: `Unique` is eager and has no lazy collection handlers,
      // so the join happens here rather than in
      // `evaluateStringPreservingCollection`. Re-segmentation caveat:
      // rejoining the distinct characters can merge or split grapheme
      // clusters, so the result may hold a different number of characters than
      // there were distinct ones.
      if (isString(ops[0])) return joinCharacters(ce, values);
      return ce.function('List', values);
    },
  },

  // Elixir `Enum.dedup` / R `rle`-style collapse: keep each element that
  // differs from its immediate predecessor, collapsing consecutive runs of
  // equal elements to a single element. This is NOT `Unique` (which removes
  // ALL duplicates globally): `Dedup([1,1,2,2,1])` is `[1,2,1]` whereas
  // `Unique([1,1,2,2,1])` is `[1,2]`. Lazy — keeps only the previous element.
  Dedup: {
    description: [
      'Return the collection with consecutive duplicate elements collapsed to a single element.',
      'Only immediately-adjacent equal elements are removed; unlike `Unique`, a value that recurs after a different element is kept.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection<any>) -> collection',
    // Preserve the source's element type / indexed-ness (mirrors TakeWhile).
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkCollectionOperand(engine, ops[0]);
      if (!collection.isValid) return null;
      return engine._fn('Dedup', [collection]);
    },
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // Length is unknown without enumeration. For a finite source we can count
      // the deduped result (bounded); an infinite source stays unknown.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        // Finiteness is not enumerability: `Take(xs, 2)` over a valueless `xs`
        // is finite (capped at 2) yet has nothing to walk, and the loop below
        // would report that empty walk as a count of 0. See `isEnumerableSource`.
        if (!isEnumerableSource(expr.op1)) return undefined;
        // Bounded on DISTINCT elements, the count's own limit — separate from
        // the iterator's guard against an unbroken run of duplicates, exactly
        // as in Filter's `count` (see the note there). Past the limit the
        // count is unknown rather than walked to the end; the `catch` still
        // reports the iterator's own cancellation the same way, and any other
        // cancellation (deadline/timeout) propagates.
        const limit = expr.engine.iterationLimit;
        try {
          let n = 0;
          for (const _ of expr.each()) if (++n > limit) return undefined;
          return n;
        } catch (e) {
          if (
            e instanceof CancellationError &&
            e.cause === 'iteration-limit-exceeded'
          )
            return undefined;
          throw e;
        }
      },
      // Finite source ⇒ deduped result is finite; otherwise unknown.
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isFiniteCollection === true
          ? true
          : undefined,
      // Empty iff the source is empty (dedup of a non-empty source is
      // non-empty). Cheap and keeps the collection materializable.
      isEmpty: (expr) =>
        isFunction(expr) ? expr.op1.isEmptyCollection : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const source = expr.op1.each();
        // `.isSame()`: exact structural/symbolic equality (see ChunkBy note).
        let prev: Expression | undefined = undefined;
        let hasPrev = false;
        // Cap the SOURCE walk at `ce.iterationLimit`: the loop advances only on
        // DISTINCT elements, so a source that repeats one value forever (e.g.
        // `Cycle([1,1])`) would spin here without ever emitting. Mirror the
        // Filter guard — throw `iteration-limit-exceeded`, which the terminal
        // consumers (`count`, `at`) swallow to `undefined`; any other
        // cancellation (deadline/timeout) propagates.
        //
        // Counted since the last EMISSION, not in total, for the same reason
        // as Filter: only an unbroken run of duplicates is the walk that
        // cannot finish. A dedup that keeps emitting is bounded by whatever
        // consumes it, and counting its productive pulls capped long
        // all-distinct sources that were never at risk.
        let sinceEmit = 0;
        const limit = expr.engine.iterationLimit;
        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              if (hasPrev && prev!.isSame(value as Expression)) {
                // A DUPLICATE — the only pull that counts toward the cap.
                if (++sinceEmit > limit)
                  throw new CancellationError({
                    cause: 'iteration-limit-exceeded',
                    message: `Iteration limit of ${limit} exceeded while evaluating Dedup()`,
                  });
                continue;
              }
              prev = value as Expression;
              hasPrev = true;
              sinceEmit = 0;
              return { value, done: false };
            }
          },
        };
      },
      // The k-th deduped element: iterate the guarded Dedup iterator (which
      // collapses adjacent equals AND caps the source walk at
      // `ce.iterationLimit`) until the k-th element is reached. Iterating the
      // raw `expr.op1.each()` would bypass the guard and run unbounded on a
      // source that repeats one value forever (e.g. `Cycle([1,1])`) once the
      // deadline is removed. Swallow `iteration-limit-exceeded` and report
      // `undefined` (→ `Nothing` for `Second`/`Third`); any other cancellation
      // (deadline/timeout) propagates.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        try {
          let i = 0;
          for (const item of expr.each()) {
            i += 1;
            if (i === index) return item;
          }
        } catch (e) {
          if (
            e instanceof CancellationError &&
            e.cause === 'iteration-limit-exceeded'
          )
            return undefined;
          throw e;
        }
        return undefined;
      },
    },
  },

  // Partition a collection into fixed-size chunks, sliding windows, or by a
  // predicate function. See `Chunk` for splitting into k nearly-equal groups.
  Partition: {
    description: [
      'Partition a collection into consecutive chunks each of size `n`; the trailing chunk may be shorter when `n` does not divide the length.',
      'With a third argument `step`, produce sliding windows of length `n` whose starts are `step` apart, keeping only complete windows.',
      'With a predicate function instead of an integer, split into two groups: elements for which the predicate is true, and those for which it is false.',
      'Asymmetry: with no `step`, the trailing partial chunk is included; with an explicit `step`, only complete windows are returned.',
      'See `Chunk` for splitting into a given number of nearly-equal groups.',
    ],
    wikidata: 'Q381060',
    complexity: 8200,
    // Design D phase 2 — the first R-D4 (resolve-then-stamp) consumer. The
    // second parameter is a genuine TWO-ARM shape, and it stays ONE union
    // rather than becoming an overload set: the arms are disjoint (`integer`
    // vs a function), `callback<S>` admits exactly what the primitive
    // `function` admits (§4 clause 1), so admission, validation, the
    // diagnostics and the result type are byte-identical to the pre-conversion
    // spelling — while an intersection would have changed all of them plus the
    // displayed signature. Rule U admits it: exactly ONE arm of the union is
    // open.
    //
    // The stamp RESOLVES the arm first (`contextualSlotCallback`): the only
    // operand shape it rewrites is an inline `Function` literal, which the
    // `integer` arm cannot take, so the callback arm is the resolved one. A
    // size operand (a number, or a symbol holding one) is not a literal, so
    // the SIZE arm is untouched — as it was under the metadata.
    signature:
      '(collection<T>, integer | callback<(T) -> boolean>, integer?) -> list<list<T>> where T',
    // The string rule, and it covers BOTH forms: a chunk, a window and a
    // predicate group are each made of the source's own characters, so each is
    // itself a string and `Partition("abcd", 2)` is `["ab","cd"]` (ruling
    // D9(b), 2026-08-16; see `innerRun`). The predicate form's two groups come
    // back as a two-element `list<string>`, keeping the generic signature's
    // list-of-two shape rather than becoming a tuple.
    //
    // Its sibling operators (`Chunk`, `ChunkBy`, `SlidingWindow`,
    // `Permutations`, `Combinations`) spell this rule as a LEADING OVERLOAD
    // ARM instead. `Partition` cannot: its second parameter is a contextual
    // `callback<S>` slot, and the Design D stamp that annotates an inline
    // predicate's parameter with the source's element type runs only when
    // exactly ONE arity-viable arm declares such a slot
    // (`resolveContextualArm` in `boxed-expression/overload.ts`). A second arm
    // carrying the same union makes the choice ambiguous, the stamp declines,
    // and `Partition(xs, n => n < 3)` loses the `integer` annotation on `n`. A
    // `type` handler reaches the same result type without touching arm
    // resolution — and does it better, since the surviving single arm still
    // stamps a string source's predicate parameter as `character`.
    //
    // Tested with `isTextAtom`, not a bare `isString`: the siblings' string
    // arm is matched on the operand's static TYPE, so `Partition` must be too,
    // or the two spellings disagree. A `string`-declared symbol source, or a
    // string-valued application (`Partition(Join("ab","cd"), 2)`), is not a
    // `BoxedString` node, and a value-only test reported `list<list<character>>`
    // for it while the evaluated result held strings.
    //
    // Declining (returning `undefined`) falls back to the declared signature.
    type: (ops) => (isTextAtom(ops[0]) ? 'list<string>' : undefined),
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'Partition', ops, 1, PER_ELEMENT_SUPPLY),
    evaluate: ([xs, arg, stepArg], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;

      // Partition(collection, n) and Partition(collection, n, step)
      const n = toInteger(arg);
      if (n !== null) {
        if (n <= 0) return undefined;
        // Small finite sources materialize eagerly (all existing semantics);
        // larger — or unknown-length — sources stay symbolic and are served
        // lazily by the `collection` handlers below (Tycho item 52). The
        // predicate form below is EXEMPT (it needs totality — no lazy view).
        const size = xs.count;
        if (size === undefined || size > MAX_SIZE_EAGER_COLLECTION)
          return undefined;
        const all = Array.from(xs.each()) as Expression[];
        const result: Expression[] = [];

        // Every inner run below is emitted through `innerRun`, which makes it a
        // STRING when the source is a string. Joining a run's grapheme clusters
        // re-runs segmentation, and two adjacent clusters can merge — but only
        // when the source itself contained a lone combining mark, the only way
        // a cluster can begin with a character that attaches to what precedes
        // it (`docs/STRING_ROADMAP.md`, design constraint 3).

        // Partition(collection, n, step) → sliding windows of length `n`
        // whose starts are `step` apart; only COMPLETE windows are emitted.
        if (stepArg !== undefined) {
          const step = toInteger(stepArg);
          if (step === null || step <= 0) return undefined;
          for (let i = 0; i + n <= all.length; i += step)
            result.push(innerRun(ce, xs, all.slice(i, i + n)));
          return ce.function('List', result);
        }

        // Partition(collection, n) → consecutive chunks EACH of size `n`; the
        // trailing chunk may be shorter when `n` does not divide the length.
        for (let i = 0; i < all.length; i += n)
          result.push(innerRun(ce, xs, all.slice(i, i + n)));

        return ce.function('List', result);
      }

      // The size form with a size that has no value yet (`Partition(xs, n)`
      // with `n` a free integer) is NOT a predicate: stay unevaluated until
      // `n` binds. Without this it fell into the predicate arm below and threw
      // a raw `Error` out of `evaluate()` — the operand is typed `integer`,
      // so no spell-check hint was ever going to help.
      if (arg.type.matches('number')) return undefined;

      // Partition(collection, predicate)
      const fn = applicable(arg);
      if (!fn) return undefined;

      const trueGroup: Expression[] = [];
      const falseGroup: Expression[] = [];
      for (const item of xs.each()) {
        const applied = fn([item]);
        const pred = sym(applied);
        if (pred === 'True') trueGroup.push(item);
        else if (pred === 'False') falseGroup.push(item);
        else {
          // An element-valued predicate failure (see `predicateErrorValue`) is
          // an error, not an undecided predicate: surface it as the operator's
          // result before the "undecided" arm below can swallow it.
          const err = predicateErrorValue(applied);
          if (err) return err;
          if (
            applied === undefined ||
            applied.type.isUnknown ||
            applied.type.matches('boolean')
          )
            // An UNDECIDED predicate, in either of its two shapes: unresolved —
            // a symbol declared `function` with no value applies to a symbolic
            // `g(x)` typed `unknown` — or resolved but not decidable yet, an
            // unevaluated relation already typed `boolean` (`x => x > n` with
            // `n` free, which is neither `True` nor `False`). Both are undecided,
            // not wrong: stay unevaluated, mirroring `If`, which reserves its
            // throw for a condition that is not boolean at all. The throw below
            // keeps the case the spell-check hint was written for: a predicate
            // that resolves to a concrete non-boolean (`x => x + 1`).
            return undefined;
          throw predicateResultError('Partition', arg);
        }
      }

      // The two predicate groups are inner runs like any other: for a string
      // source each comes back as a string, so `Partition("a1b2", isDigit)` is
      // `["12", "ab"]`. A group is a SUBSEQUENCE rather than a contiguous run,
      // but the re-segmentation caveat is the same — clusters can only merge
      // when the source contained a lone combining mark
      // (`docs/STRING_ROADMAP.md`, design constraint 3).
      return ce.function('List', [
        innerRun(ce, xs, trueGroup),
        innerRun(ce, xs, falseGroup),
      ]);
    },
    // Lazy view for the chunk/window forms past the eager threshold. The
    // predicate form has no lazy view (it needs totality over the source), so
    // `partitionWindowParams` returns `undefined` for it and every facet stays
    // inert — `Count(Partition(<inf>, <pred>))` remains symbolic.
    collection: stringAwareWindowedCollectionOps((expr) => {
      if (!isFunction(expr)) return undefined;
      const n = toIntegerOperand(expr.op2);
      if (n === null || n <= 0) return undefined; // predicate form or invalid
      if (expr.nops >= 3) {
        // Sliding-window form: complete windows only.
        const step = toIntegerOperand(expr.op3);
        if (step === null || step <= 0) return undefined;
        return { src: expr.op1, size: n, step, keepPartial: false };
      }
      // Chunk form: consecutive size-`n` chunks; trailing partial kept.
      return { src: expr.op1, size: n, step: n, keepPartial: true };
    }),
  },

  Chunk: {
    description:
      'Split the collection into `k` nearly equal-sized groups. See `Partition` for splitting into fixed-size chunks.',
    complexity: 8200,
    // The LEADING arm is the string rule: each group is a contiguous run of
    // the source's own characters, so it is itself a string and
    // `Chunk("abcdef", 2)` is `["abc","def"]` — `Chunk` splits into `k` GROUPS,
    // not into chunks of size `k`, so it is `Partition("abcdef", 2)` (or
    // `Chunk("abcdef", 3)`) that yields `["ab","cd","ef"]` (ruling D9(b),
    // 2026-08-16; see `innerRun`). Spelled as a BOUNDED type variable
    // (`S where S: string`), never the ground type `string`: an `unknown`- or
    // `any`-typed operand refutes no arm, so a ground `string` parameter would
    // win most-specific-wins on every untyped operand and claim `list<string>`
    // for a call that usually returns a list of lists. A bounded variable with
    // no call-site binding does not.
    signature:
      '((S, integer) -> list<string> where S: string) & ((collection, integer) -> list<list>)',
    // Provable declines only (a finite, walkable source and a positive
    // integer `k` are required); success is not cheaply decidable, so never
    // `true` — see `canEnumerateFiniteSource`.
    canEnumerate: (expr) => {
      if (!isFunction(expr)) return undefined;
      const k = canEnumerateOperand(expr.ops[1], (g) => {
        const i = toInteger(g);
        return i !== null && i > 0;
      });
      if (k === false) return false;
      return canEnumerateFiniteSource(expr);
    },
    // `Chunk` RESHAPES: the result has exactly `k` groups, whatever the
    // source's length (`Chunk([1,2,3], 5)` yields 5 groups, two of them
    // empty) — so it must answer its own length rather than inherit the
    // source's. Knowable only when `k` is a literal positive integer AND the
    // source is a finite collection (the evaluate guard below); anything else
    // declines.
    elementCount: (expr) => {
      if (!isFunction(expr)) return undefined;
      if (expr.op1.isFiniteCollection !== true) return undefined;
      const k = toInteger(expr.op2);
      if (k === null || k <= 0) return undefined;
      return k;
    },
    evaluate: ([xs, n], { engine: ce }) => {
      const k = toInteger(n);
      if (!xs.isFiniteCollection || k === null || k <= 0) return undefined;

      const all = Array.from(xs.each()) as Expression[];
      const result: Expression[] = [];
      const chunkSize = Math.ceil(all.length / k);

      // Each group is emitted through `innerRun`, which makes it a STRING when
      // the source is a string. Joining a group's grapheme clusters re-runs
      // segmentation, and two adjacent clusters can merge — but only when the
      // source itself contained a lone combining mark, the only way a cluster
      // can begin with a character that attaches to what precedes it
      // (`docs/STRING_ROADMAP.md`, design constraint 3).
      for (let i = 0; i < k; i++) {
        const chunk = all.slice(i * chunkSize, (i + 1) * chunkSize);
        result.push(innerRun(ce, xs, chunk));
      }

      return ce.function('List', result);
    },
  },

  // Elixir `Enum.chunk_by` / Wolfram `Split` / Haskell `groupBy`-on-adjacent:
  // split the collection into maximal runs of CONSECUTIVE elements over which
  // the unary key `f(x)` yields the same value. Returns a list of lists.
  ChunkBy: {
    description: [
      'Split the collection into maximal runs of consecutive elements over which the key function yields the same value.',
      'Returns a list of lists. Unlike `GroupBy`, only adjacent elements are grouped, so a key value that recurs after a different run starts a new chunk.',
    ],
    complexity: 8200,
    // Element types flow through from the source: `list<list<T>>`. The `key`
    // slot stays the PRIMITIVE `function` (a function-typed symbol operand
    // must be admitted there).
    //
    // The LEADING arm is the string rule: each run is a contiguous stretch of
    // the source's own characters, so it is itself a string and
    // `ChunkBy("aabb", f)` is `["aa","bb"]` (ruling D9(b), 2026-08-16; see
    // `innerRun`). Spelled as a BOUNDED type variable (`S where S: string`),
    // never the ground type `string`: an `unknown`- or `any`-typed operand
    // refutes no arm, so a ground `string` parameter would win
    // most-specific-wins on every untyped operand.
    signature:
      '((S, key: function) -> list<string> where S: string) & ((collection<T>, key: function) -> list<list<T>> where T)',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'ChunkBy', ops, 1, PER_ELEMENT_SUPPLY),
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      // Small finite sources materialize eagerly (all existing semantics);
      // larger — or unknown-length — sources stay symbolic and are served
      // lazily by the `collection` handlers below (Tycho item 52).
      const size = xs.count;
      if (size === undefined || size > MAX_SIZE_EAGER_COLLECTION)
        return undefined;
      const f = applicable(fn);
      if (!f) return undefined;

      const runs: Expression[][] = [];
      let currentKey: Expression | undefined = undefined;
      let current: Expression[] = [];
      for (const item of xs.each()) {
        const key = f([item]) ?? ce.Nothing;
        // Compare run keys with `.isSame()` — exact structural/symbolic
        // equality, the engine's internal-comparison convention. `.isEqual()`
        // is deliberately avoided: it can be undetermined and can equate
        // structurally-distinct exact values, which would make the run
        // boundaries unstable.
        if (current.length === 0) {
          current = [item];
          currentKey = key;
        } else if (currentKey!.isSame(key)) {
          current.push(item);
        } else {
          runs.push(current);
          current = [item];
          currentKey = key;
        }
      }
      if (current.length > 0) runs.push(current);

      // Each run is emitted through `innerRun`, which makes it a STRING when
      // the source is a string. Joining a run's grapheme clusters re-runs
      // segmentation, and two adjacent clusters can merge — but only when the
      // source itself contained a lone combining mark, the only way a cluster
      // can begin with a character that attaches to what precedes it
      // (`docs/STRING_ROADMAP.md`, design constraint 3).
      return ce.function(
        'List',
        runs.map((r) => innerRun(ce, xs, r))
      );
    },
    // Lazy view (Dedup-shape streaming). Runs of an infinite source are
    // unknowable, so `count`/`isFinite` mirror `Dedup`: known only for a finite
    // source.
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      elementMemo: true,
      // Number of runs: for a finite source, walk our own iterator (bounded);
      // an infinite/unknown source stays unknown.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.op1.isFiniteCollection !== true) return undefined;
        // Finiteness is not enumerability: `Take(xs, 2)` over a valueless `xs`
        // is finite (capped at 2) yet has nothing to walk, and the loop below
        // would report that empty walk as a count of 0. See `isEnumerableSource`.
        if (!isEnumerableSource(expr.op1)) return undefined;
        let n = 0;
        for (const _ of expr.each()) n++;
        return n;
      },
      // Finite source ⇒ finite number of runs; otherwise unknown.
      isFinite: (expr) =>
        isFunction(expr) && expr.op1.isFiniteCollection === true
          ? true
          : undefined,
      // Empty iff the source is empty (a non-empty source has ≥ 1 run).
      isEmpty: (expr) =>
        isFunction(expr) ? expr.op1.isEmptyCollection : undefined,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const ce = expr.engine;
        // Resolved ONCE per iterator: the raw operand may be a symbol holding a
        // string or a string-valued application, which `innerRun`'s literal
        // test would miss (see `resolveTextSource`).
        const src = resolveTextSource(expr.op1);
        const source = src.each();
        // The first element of the next run, read ahead (and its key), so a run
        // boundary can be detected before the run is emitted.
        let pending: Expression | undefined = undefined;
        let pendingKey: Expression | undefined = undefined;
        let done = false;
        return {
          next: () => {
            if (done && pending === undefined)
              return { value: undefined, done: true };
            // Seed the run with the pending element, or read the first one.
            let run: Expression[];
            let key: Expression;
            if (pending !== undefined) {
              run = [pending];
              key = pendingKey!;
              pending = undefined;
              pendingKey = undefined;
            } else {
              const first = source.next();
              if (first.done) {
                done = true;
                return { value: undefined, done: true };
              }
              run = [first.value];
              key = f([first.value]) ?? ce.Nothing;
            }
            // Extend the run while the key (compared with `.isSame()`, matching
            // the eager path) stays constant; hold the first differing element.
            for (;;) {
              const { value, done: d } = source.next();
              if (d) {
                done = true;
                break;
              }
              const k = f([value]) ?? ce.Nothing;
              if (key.isSame(k)) run.push(value);
              else {
                pending = value;
                pendingKey = k;
                break;
              }
            }
            // `innerRun` makes the run a STRING when the source is a string,
            // matching the leading string arm in the signature. Rejoining
            // grapheme clusters re-runs segmentation and two adjacent clusters
            // can merge, but only when the source itself contained a lone
            // combining mark (`docs/STRING_ROADMAP.md`, design constraint 3).
            return { value: innerRun(ce, src, run), done: false };
          },
        };
      },
      // The k-th run: walk our own run iterator.
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        let i = 0;
        for (const run of expr.each()) {
          i += 1;
          if (i === index) return run;
        }
        return undefined;
      },
    },
  },

  GroupBy: {
    description: [
      'Partition the collection into a dictionary of lists based on the key returned by the function.',
    ],
    complexity: 8200,
    signature: '(collection<any>, key: function) -> dictionary<list>',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'GroupBy', ops, 1, PER_ELEMENT_SUPPLY),
    // Provable declines only (finite, walkable source required); success also
    // depends on the key function and the element walk, so never `true` —
    // see `canEnumerateFiniteSource`.
    canEnumerate: canEnumerateFiniteSource,
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      if (!f) return undefined;

      const groups: Record<string, Expression[]> = {};

      for (const item of xs.each()) {
        const keyExpr = f([item]) ?? ce.Nothing;

        // A key that is an inert application of an operator that was only
        // auto-declared by this very use (no operator definition, inferred
        // value type) is almost certainly a typo (`Even` for `IsEven`): every
        // element would land in its own garbage group ("Even(1)", "Even(2)",
        // …). Report it like Filter reports a broken predicate. Explicitly
        // declared symbols are untouched — grouping by a symbolic key is
        // legitimate.
        if (isFunction(keyExpr)) {
          const keyDef = ce.lookupDefinition(keyExpr.operator);
          if (
            keyDef !== undefined &&
            'value' in keyDef &&
            keyDef.value?.inferredType === true
          ) {
            throw new Error(
              `Unknown function "${keyExpr.operator}" in GroupBy key function. ${spellCheckMessage(keyExpr)}`
            );
          }
        }

        const key =
          (isSymbol(keyExpr) ? keyExpr.symbol : undefined) ??
          (isString(keyExpr) ? keyExpr.string : undefined) ??
          keyExpr.toString();

        if (!(key in groups)) groups[key] = [];
        groups[key].push(item);
      }

      return ce.function(
        'Dictionary',
        Object.entries(groups).map(([k, vals]) =>
          ce._fn('Tuple', [ce.string(k), ce.function('List', vals)])
        )
      );
    },
  },

  // Similar to Transpose, but acts on a sequence of collections
  // Equivalent to zip in Python
  // The length of the result is the length of the shortest argument
  // Ex: Zip([a, b, c], [1, 2]) = [[a, 1], [b, 2]]
  Zip: {
    description:
      'Combine multiple collections element-wise into a list of tuples. The result has the length of the shortest input.',
    complexity: 8200,
    signature: '(indexed_collection<any>+) -> list',
    collection: {
      isEnumerable: enumerableFromAllSources,
      isLazy: (_expr) => true,
      count: zipCount,
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops === 0) return true;
        // Zip has the length of its *shortest* input, so it is finite as soon
        // as *any* input is finite (was `every`, which wrongly called
        // `Zip([1,2,3], <infinite>)` infinite).
        let anyUnknown = false;
        for (const x of expr.ops) {
          const f = x.isFiniteCollection;
          if (f === true) return true;
          if (f === undefined) anyUnknown = true;
        }
        return anyUnknown ? undefined : false;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.nops === 0) return true;
        // Zip is empty as soon as *any* input is empty (the shortest input
        // bounds the result), not only when *every* input is empty.
        let anyUnknown = false;
        for (const x of expr.ops) {
          const e = isEmptySource(x);
          if (e === true) return true;
          if (e === undefined) anyUnknown = true;
        }
        return anyUnknown ? undefined : false;
      },
      // Driven by each source's iterator — not by up-front counts — so a
      // source with an unknown count (or an infinite one zipped with a
      // finite one) still iterates; the zip ends as soon as any source ends.
      iterator: (expr) => {
        if (!isFunction(expr) || expr.nops === 0)
          return { next: () => ({ value: undefined, done: true }) };
        const sources = expr.ops.map((op) => op.each());
        return {
          next: () => {
            const items: Expression[] = [];
            for (const source of sources) {
              const { value, done } = source.next();
              if (done || value === undefined)
                return { value: undefined, done: true };
              items.push(value);
            }
            return { value: expr.engine.tuple(...items), done: false };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr) || expr.nops === 0) return undefined;
        // No up-front count needed — a source with an unknown count still
        // answers `at`, and any source without an element there bounds the
        // zip.
        const items = expr.ops.map((op) => op.at(index));
        if (items.some((x) => x === undefined)) return undefined;
        return expr.engine.tuple(...(items as Expression[]));
      },
    },
  },

  // Iterate(fn, init) -> [fn(1, init), fn(2, fn(1, init)), ...]
  // Iterate(fn) -> [fn(1), fn(2), ...]
  // Infinite series. Can use Take(Iterate(fn), n) to get a finite series
  //
  // A UNARY function is applied to the accumulator alone — see `iterateArgs`.
  Iterate: {
    description: [
      'Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value.',
      'The function is invoked as `f(index, acc)`: `index` is the 1-based position of the element being produced, and `acc` is the previous element — the `initial` value when producing element 1. Element `k` is therefore `f(k, element(k-1))`.',
      'A function whose type says it is UNARY is applied to the accumulator alone (`Iterate(2 * _, 1)` produces `[2, 4, 8, 16, …]`); a statically-unknown arity keeps the two-argument form.',
    ],
    complexity: 8200,
    // The callback slot is the bare `function` PRIMITIVE, not a signature —
    // deliberately, and for the same reason as `Map`. The true contract is
    // parametric: `((integer, T) -> T, T?) -> list<T>`, where the accumulator
    // type `T` IS the callback's own result type. The signature grammar has no
    // type variables, so it cannot relate the two; every concrete spelling
    // gets it wrong in one direction or the other (`acc: any` rejects a typed
    // accumulator such as `(integer, integer) -> integer`, `acc: never` is
    // uncallable). The primitive is shape-top and effect-top, which is the
    // honest statement of what is checkable here.
    signature: '(function, initial: any?) -> list',
    canonical: ([f, initialExpr], { engine }) => {
      const fn = canonicalCallbackOperand(f, {
        operator: 'Iterate',
        supply: ITERATE_SUPPLY,
      });
      if (!fn) return null;
      const initial = initialExpr?.canonical;
      if (!initial) return engine._fn('Iterate', [fn]);
      return engine._fn('Iterate', [fn, initial]);
    },
    collection: {
      isLazy: (_expr) => true,
      elementMemo: true,
      count: () => Infinity,
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op1);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        let acc = expr.op2 ?? expr.engine.Nothing;
        let n = 0;
        return {
          next: () => {
            n += 1;
            acc =
              f(iterateArgs(expr.engine, expr.op1, n, acc)) ??
              absenceMarker(expr.engine, expr);
            return { value: acc, done: false };
          },
        };
      },
      at: (expr, index) => {
        // @todo: use cache
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const f = applicable(expr.op1);
        if (!f) return undefined;
        // Element k is `f(k, element(k-1))`, with `element(0)` the initial
        // value — the contract the head comment and the iterator state. The
        // loop used to stop one step early, so `at(1)` handed back the INITIAL
        // value and every `at`-served route (`Take`, indexing,
        // materialization) was shifted one element against `each()`.
        let acc = expr.op2 ?? expr.engine.Nothing;
        for (let i = 1; i <= index; i++) {
          acc =
            f(iterateArgs(expr.engine, expr.op1, i, acc)) ??
            absenceMarker(expr.engine, expr);
        }
        return acc;
      },
    },
  },

  // Repeat(x) -> [x, x, ...]        — infinite sequence
  // Repeat(x, n) -> [x, x, ..., x]  — finite list of n copies
  Repeat: {
    description:
      'Produce a sequence by repeating a single value. With 1 argument, returns an infinite sequence; with 2 arguments (value, count), returns a finite list of `count` copies.',
    complexity: 8200,
    signature: '(value: any, count: integer?) -> list',
    evaluate: (ops, { engine }) => {
      if (ops.length !== 2) return undefined;
      const raw = toInteger(ops[1]);
      if (raw === null) return undefined;
      const n = Math.max(0, raw);
      // Larger requests stay lazy; elements remain accessible via .at()
      // and the iterator.
      if (n > engine.maxCollectionSize) return undefined;
      return engine._fn('List', Array(n).fill(ops[0]));
    },
    collection: {
      isEnumerable: (expr) =>
        isFunction(expr) &&
        (expr.ops.length < 2 || toIntegerOperand(expr.op2) !== null),
      isLazy: (expr) => isFunction(expr) && expr.ops?.length === 1,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.ops?.length === 2) {
          const n = toIntegerOperand(expr.op2);
          return n !== null ? Math.max(0, n) : undefined;
        }
        return Infinity;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (expr.ops?.length === 2) {
          const n = toIntegerOperand(expr.op2);
          return n !== null ? n <= 0 : undefined;
        }
        return false; // infinite — never empty
      },
      isFinite: (expr) => isFunction(expr) && expr.ops?.length === 2,
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        if (expr.ops?.length === 2) {
          const n = toIntegerOperand(expr.op2);
          if (n !== null && n <= 0) return false; // empty list
        }
        return expr.op1.isSame(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        if (expr.ops?.length === 2) {
          const n = toIntegerOperand(expr.op2);
          if (n === null) {
            return { next: () => ({ value: undefined, done: true }) };
          }
          const count = Math.max(0, n);
          let i = 0;
          return {
            next: () =>
              i++ < count
                ? { value: expr.op1, done: false }
                : { value: undefined, done: true },
          };
        }
        // Infinite sequence
        return { next: () => ({ value: expr.op1, done: false }) };
      },
      // at is 1-based (consistent with Range, Take, and other collection handlers)
      at: (expr, index) => {
        if (!isFunction(expr)) return undefined;
        if (typeof index !== 'number') return undefined;
        if (expr.ops?.length === 2) {
          const n = toIntegerOperand(expr.op2);
          const count = n !== null ? Math.max(0, n) : 0;
          if (index < 1 || index > count) return undefined;
        } else {
          // Infinite sequence: any positive 1-based index is valid
          if (index < 1) return undefined;
        }
        return expr.op1;
      },
    },
  },

  // Cycle(list) -> [list[1], list[2], ...]
  // -> repeats infinitely
  Cycle: {
    description:
      'Produce an infinite sequence by cycling through the elements of a finite collection.',
    complexity: 8200,
    signature: '(list<any>) -> list',
    collection: {
      isEnumerable: enumerableFromSource,
      isLazy: (_expr) => true,
      // Cycling a non-empty collection is infinite; cycling an empty one is
      // empty. Inspect the *underlying* collection (`op1`) — reading
      // `expr.isEmptyCollection`/`expr.isFiniteCollection` here would re-enter
      // these same handlers and recurse infinitely.
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection ? 0 : Infinity;
      },
      isEmpty: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection;
      },
      isFinite: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEmptyCollection;
      },
      contains: (expr, target) => {
        if (!isFunction(expr)) return false;
        // A permutation/repetition of the source: membership is exactly the
        // source's, INCLUDING its undecided verdict (`?? false` claimed a
        // definite "not a member" the source never gave).
        return expr.op1.contains(target);
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        let index = 1;
        const l = expr.op1.count;
        if (l === undefined || l === 0)
          return { next: () => ({ value: undefined, done: true }) };
        return {
          next: () => {
            const i = ((index - 1) % l) + 1;
            const value = expr.op1.at(i);
            if (value === undefined) return { value: undefined, done: true };
            index += 1;
            return { value, done: false };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const l = expr.op1.count;
        if (l === undefined || l === 0) return undefined;
        const i = ((index - 1) % l) + 1; // 1-based index
        return expr.op1.at(i);
      },
    },
  },

  // Fill(f, [n, m])
  // Fill a nxm matrix with the result of f(i, j)
  // Fill( Random(5), [3, 3] )
  Fill: {
    description:
      'Produce a 2D list (matrix) by applying a function to each pair of row and column indexes.',
    complexity: 8200,
    signature: '(function, tuple) -> list',
    canonical: (ops, { engine }) =>
      canonicalFunctionSlot(engine, 'Fill', ops, 0, FILL_SUPPLY),
    collection: {
      isEnumerable: (expr) =>
        isFunction(expr) && isFunction(expr.op2) && fillDims(expr.op2) !== null,
      isLazy: (_expr) => true,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        if (!isFunction(expr.op2)) return undefined;
        const dims = fillDims(expr.op2);
        if (dims === null) return undefined; // symbolic dimension
        return dims[0] ?? 0;
      },
      iterator: (expr) => {
        if (!isFunction(expr))
          return { next: () => ({ value: undefined, done: true }) };
        const f = applicable(expr.op1);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        if (!isFunction(expr.op2))
          return { next: () => ({ value: undefined, done: true }) };
        const dims = fillDims(expr.op2);
        if (dims === null)
          return { next: () => ({ value: undefined, done: true }) };
        const rows = dims[0] ?? 0;
        const cols = dims[1] ?? 0;
        const last = rows;
        let index = 1;
        return {
          next: () => {
            if (index === last + 1) return { value: undefined, done: true };
            index += 1;
            const row: Expression[] = [];
            for (let j = 1; j <= cols; j++) {
              row.push(
                f([expr.engine.number(index - 1), expr.engine.number(j)]) ??
                  absenceMarker(expr.engine, expr)
              );
            }
            return {
              value: expr.engine.function('List', row),
              done: false,
            };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        if (!isFunction(expr)) return undefined;
        const f = applicable(expr.op1);
        if (!f) return undefined;
        if (!isFunction(expr.op2)) return undefined;
        const dims = fillDims(expr.op2);
        if (dims === null) return undefined; // symbolic dimension
        const rows = dims[0] ?? 0;
        const cols = dims[1] ?? 0;
        if (index > rows * cols) return undefined;
        const row = Math.ceil(index / cols);
        const col = ((index - 1) % cols) + 1; // 1-based column index
        return (
          f([expr.engine.number(row), expr.engine.number(col)]) ??
          absenceMarker(expr.engine, expr)
        );
      },
    },
  },

  //
  // Create eager collections from other collections.
  //
  ListFrom: {
    description: 'Create a list from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> list',
    type: (ops) => {
      if (ops.length === 0) return 'list';
      let type: Type = 'unknown';
      for (const xs of ops) {
        if (xs.isCollection && !xs.isFiniteCollection) return 'list';
        type = widen(type, collectionElementType(xs.type.type) ?? type);
      }
      return { kind: 'list', elements: type };
    },
    // Provable declines only, over the COLLECTION operands (a scalar operand
    // contributes itself) — see `canEnumerateCollectionOperands`.
    canEnumerate: canEnumerateCollectionOperands,
    evaluate: (ops, { engine: ce }) => {
      const elements: Expression[] = [];
      for (const xs of ops) {
        if (!xs.isCollection) {
          // A collection-TYPED operand that is not a collection right now (a
          // valueless `list<integer>` symbol, an unevaluated eager producer)
          // is UNRESOLVED, not a scalar datum: wrapping it (`["xs"]`) bakes
          // an answer a later `xs := [1, 5]` contradicts. Stay inert
          // (USER-RULED 2026-08-11); genuine scalars contribute themselves.
          if (typeCouldBeCollection(xs.type.type)) return undefined;
          elements.push(xs);
        } else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as Expression[]));
        }
      }
      return ce.function('List', elements);
    },
    // (Tycho item 94.) `ListFrom` is the only eager materializer that works
    // over an arbitrary collection body, which makes it the documented escape
    // from the lazy-view trap under `WithRandomSeed` — a frame around a lazy
    // comprehension has already exited by the time the view materializes, so
    // the draws escape it. That escape is only usable if it also compiles.
    compile: (args, compile, { language }) => {
      const parts = args.map((a) => compile(a));

      // On the CPU targets the splice is decided at RUNTIME, per operand: a
      // collection contributes its elements, anything else contributes itself.
      // A static type gate would be wrong here — a free symbol in a compiled
      // body types as `unknown`, and `unknown` is exactly the case that has to
      // work.
      if (language === 'javascript') {
        if (args.every(isProvablyScalar)) return `[${parts.join(', ')}]`;
        return `[${parts.join(', ')}].flatMap((_x) => Array.isArray(_x) ? _x : [_x])`;
      }
      if (language === 'python') {
        if (args.every(isProvablyScalar)) return `[${parts.join(', ')}]`;
        return `[_y for _x in [${parts.join(', ')}] for _y in (_x if isinstance(_x, list) else [_x])]`;
      }

      // The GPU targets have no runtime splice: their lists are fixed-size
      // `vecN`/array literals. An all-scalar `ListFrom` is exactly the
      // equivalent `List`, so emit that; anything with a provably collection
      // operand fails closed (`undefined` → reported as uncompilable).
      if (language === 'glsl' || language === 'wgsl') {
        if (!args.every(isProvablyScalar)) return undefined;
        const suffix = language === 'wgsl' ? 'f' : '';
        if (parts.length >= 2 && parts.length <= 4)
          return `vec${parts.length}${suffix}(${parts.join(', ')})`;
        const arrayType =
          language === 'wgsl'
            ? `array<f32, ${parts.length}>`
            : `float[${parts.length}]`;
        return `${arrayType}(${parts.join(', ')})`;
      }
      return undefined;
    },
  },

  SetFrom: {
    description: 'Create a set from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> set',
    type: (ops) => {
      if (ops.length === 0) return 'set';
      let type: Type = 'unknown';
      for (const xs of ops) {
        if (xs.isCollection && !xs.isFiniteCollection) return 'set';
        type = widen(type, collectionElementType(xs.type.type) ?? type);
      }
      return { kind: 'set', elements: type };
    },
    // Provable declines only — see `ListFrom`.
    canEnumerate: canEnumerateCollectionOperands,
    evaluate: (ops, { engine: ce }) => {
      const elements: Expression[] = [];
      for (const xs of ops) {
        if (!xs.isCollection) {
          // A collection-TYPED operand that is not a collection right now (a
          // valueless `list<integer>` symbol, an unevaluated eager producer)
          // is UNRESOLVED, not a scalar datum: wrapping it (`["xs"]`) bakes
          // an answer a later `xs := [1, 5]` contradicts. Stay inert
          // (USER-RULED 2026-08-11); genuine scalars contribute themselves.
          if (typeCouldBeCollection(xs.type.type)) return undefined;
          elements.push(xs);
        } else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as Expression[]));
        }
      }
      return ce.function('Set', elements);
    },
  },

  TupleFrom: {
    description: 'Create a tuple from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> tuple',
    // Provable declines only — see `ListFrom`.
    canEnumerate: canEnumerateCollectionOperands,
    evaluate: (ops, { engine: ce }) => {
      const elements: Expression[] = [];
      for (const xs of ops) {
        if (!xs.isCollection) {
          // A collection-TYPED operand that is not a collection right now (a
          // valueless `list<integer>` symbol, an unevaluated eager producer)
          // is UNRESOLVED, not a scalar datum: wrapping it (`["xs"]`) bakes
          // an answer a later `xs := [1, 5]` contradicts. Stay inert
          // (USER-RULED 2026-08-11); genuine scalars contribute themselves.
          if (typeCouldBeCollection(xs.type.type)) return undefined;
          elements.push(xs);
        } else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as Expression[]));
        }
      }
      return ce.tuple(...elements);
    },
  },

  DictionaryFrom: {
    description:
      'Create a dictionary from the elements of a collection of (key, value) pairs.',
    complexity: 8200,
    signature: '(collection<any>) -> dictionary',
    // Provable declines only (the source must be a finite, walkable
    // collection); success also depends on every element being a
    // string-keyed pair, so never `true` — see `canEnumerateFiniteSource`.
    canEnumerate: canEnumerateFiniteSource,
    evaluate: ([xs], { engine: ce }) => {
      if (!xs.isCollection) return undefined;

      // If the collection is a Record, use its ops directly
      if (isFunction(xs, 'Record'))
        return ce.function('Dictionary', [...xs.ops]);

      // Stay inert on non-finite or unknown-length input: building the
      // dictionary requires walking every entry.
      if (!xs.isFiniteCollection) return undefined;

      const entries: Expression[] = [];
      for (const keyValue of xs.each()) {
        // A malformed element is a boxed error, not a raw `throw`: a throw
        // here escapes `evaluate()` as an uncaught JS exception (the engine
        // does not catch handler throws on the plain evaluate route).
        if (!isFunction(keyValue) || keyValue.nops !== 2)
          return ce.error(
            [
              'incompatible-type',
              'tuple<string, unknown>',
              keyValue.type.toString(),
            ],
            keyValue.toString()
          );
        const rawKey = keyValue.op1;
        const value = keyValue.op2;
        // A CHARACTER key is accepted as the one-character string it denotes:
        // a dictionary key is text, and `Tally(Characters(s))` — the everyday
        // producer of character keys — must keep building a dictionary whose
        // entries `d["m"]` finds. Anything else is a type error.
        const key = isCharacter(rawKey) ? ce.string(rawKey.string) : rawKey;
        if (!isString(key))
          return ce.error(
            ['incompatible-type', 'string', key.type.toString()],
            key.toString()
          );
        // POSITIONAL pair: `_fn`, not `tuple()` — see `BoxedDictionary.each()`.
        entries.push(ce._fn('Tuple', [key, value]));
      }
      return ce.function('Dictionary', entries);
    },
  },
};

//
// Hybrid-lazy resolution helpers for `Insert` / `DeleteAt` / `ReplaceAt`.
//
// The large/infinite/unknown-length branch of these ops keeps the expression
// symbolic and serves the result through the `collection` handlers above via
// index arithmetic (Tycho item 52; same recipe as `Append`/`Rest`/`Drop`).
// Each facet first resolves the normalized 1-based target position and returns
// `undefined` on an invalid form, so an out-of-range/zero/symbolic index (or a
// negative index against a non-finite source) stays fully inert — matching the
// eager path.
//

// ONE source walk per level — why the `…Of` variants below exist.
//
// `insertPosition`/`targetPosition` need the source length for their range
// check, and every `count`/`isEmpty`/`isFinite` caller needs it (or the
// source's finiteness) immediately afterwards. Reading `expr.op1.count` a
// SECOND time is free on a materialized list and catastrophic on a CHAINED
// view: past `MAX_SIZE_EAGER_COLLECTION` the `evaluate` handlers decline and
// `Insert(Insert(…))` stays symbolic, so each level's shape query ran the
// whole source walk twice — cost(d) = 2·cost(d−1), i.e. 2^depth (measured:
// `.count` on a depth-16 chain over a 110-element base took 7.8 ms, doubling
// per level, and a 40-iteration accumulator loop took 214 s). Threading the
// already-computed length through the `…Of` variants makes each level pay
// exactly one source walk: O(depth).
//
// This is the "fix the compounding queries directly" half of the
// conditional-handler over-threshold follow-up in
// `docs/plans/2026-08-09-lazy-collection-evaluate-design.md` ("Affected
// operator set"). The facets above consequently derive the source's
// FINITENESS from the same `n` (`Number.isFinite(n)`) instead of asking
// `op1.isFiniteCollection` — a second recursive walk that would restore the
// doubling. The two agree wherever `n` is defined, which is exactly where the
// position guard lets the facet answer at all.
//

/**
 * `Insert`: the 1-based position in the RESULT at which the value lands
 * (`gap + 1`, mirroring the eager arithmetic — a positive index ranges over
 * 1..n+1, a negative index counts from the end with -1 appending). Returns
 * `undefined` for an invalid form.
 */
function insertPosition(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  return insertPositionOf(expr, expr.op1.count);
}

/** {@link insertPosition} against an already-computed source length. */
function insertPositionOf(
  expr: Expression,
  n: number | undefined
): number | undefined {
  if (n === undefined || !isFunction(expr)) return undefined;
  const index = toIntegerOperand(expr.op2);
  if (index === null || index === 0) return undefined;
  if (index > 0) {
    if (Number.isFinite(n) && index > n + 1) return undefined;
    return index; // g = gap + 1 = index
  }
  // A negative index counts from the end; that requires a finite length.
  if (!Number.isFinite(n)) return undefined;
  if (index < -(n + 1)) return undefined;
  return n + 2 + index; // g = (n + 1 + index) + 1
}

/**
 * `DeleteAt` / `ReplaceAt`: the 1-based position of the existing element the
 * op targets (`i0 + 1`, mirroring the eager arithmetic — a positive index
 * ranges over 1..n, a negative index counts from the end). Returns `undefined`
 * for an invalid form.
 */
function targetPosition(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  return targetPositionOf(expr, expr.op1.count);
}

/** {@link targetPosition} against an already-computed source length. */
function targetPositionOf(
  expr: Expression,
  n: number | undefined
): number | undefined {
  if (n === undefined || !isFunction(expr)) return undefined;
  const index = toIntegerOperand(expr.op2);
  if (index === null || index === 0) return undefined;
  if (index > 0) {
    if (Number.isFinite(n) && index > n) return undefined;
    return index; // g = i0 + 1 = index
  }
  // A negative index counts from the end; that requires a finite length.
  if (!Number.isFinite(n)) return undefined;
  if (index < -n) return undefined;
  return n + index + 1; // g = (n + index) + 1
}

/**
 * The numeric reading of a `Range`/`Linspace` operand. A number literal
 * reads directly (`.re`). An exact symbolic expression with no unknowns
 * (`50π`, `√2`, `N·π` after `N := 2`) is numerically known: read it through
 * `.N()` — collection iteration is float-based, so numericizing the bound
 * is lossless here. An expression with unknowns (`Range(1, n)`) reads as
 * NaN; the `.unknowns` gate keeps `.N()` off expressions whose value cannot
 * resolve (the discarded-`.N()` cost class).
 */
function operandNumericValue(op: Expression): number {
  const v = op.re;
  if (!Number.isNaN(v)) return v;
  if (op.unknowns.length > 0) return NaN;
  return op.N().re;
}

/**
 * Does this `Range` expression have a bound with no numerically-known value
 * (e.g. `Range(1, n)` with unknown `n`)? Such a bound reads as NaN through
 * `operandNumericValue()`, and `range()` propagates the NaN — so every
 * handler that consumes `range()` must first bail to its indeterminate
 * channel, or a symbolic range collapses (the `undefined → value` collapse
 * class: `Count(Range(1, n))` evaluated to 1).
 *
 * An *exact but numerically known* bound (`50π`, or `N·π` after `N := 2`)
 * is NOT symbolic: it reads through `.N()` and the range counts and
 * enumerates normally.
 */
export function hasSymbolicRangeBounds(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => Number.isNaN(operandNumericValue(op)));
}

/**
 * A *present* operand with no concrete numeric value (a symbolic
 * expression), as opposed to a missing / `Nothing` operand — which selects a
 * documented default (e.g. `Linspace`'s default count) rather than being
 * indeterminate.
 */
function isSymbolicOperand(op: Expression | undefined): boolean {
  if (op === undefined) return false;
  if (isSymbol(op) && op.symbol === 'Nothing') return false;
  return Number.isNaN(operandNumericValue(op));
}

/**
 * Shared evaluation for the `Any`/`All` quantifiers.
 *
 * Three-valued and short-circuiting: `Any` returns True at the first element
 * whose predicate result is True; `All` returns False at the first False. With
 * no predicate, each element is treated as the boolean value directly (Julia's
 * `any(itr)` / `all(itr)`).
 *
 * If enumeration completes with every result definite (True/False), the
 * definite answer is returned (False for `Any`, True for `All`; vacuously so on
 * an empty collection). If any result was neither True nor False (a symbolic or
 * undetermined element) and no short-circuit fired, `undefined` is returned so
 * the expression stays inert — the CAS-correct behavior rather than throwing.
 *
 * An ELEMENT-valued predicate failure (see `predicateErrorValue`) is neither of
 * those: it is surfaced as the operator's RESULT, the scalar-consumer
 * convention `CountIf`/`Find`/`IndexWhere` follow. Absorbing it into
 * `sawUndetermined` discarded the error entirely and left the quantifier inert.
 *
 * The interaction with short-circuiting is decided by ENUMERATION ORDER, which
 * is the family's laziness: the loop answers with whatever it meets FIRST. A
 * definite short-circuit (True for `Any`, False for `All`) at an element BEFORE
 * the failing one still wins — the quantifier never looked at the rest — while
 * an error met before any decision surfaces instead of being skipped past.
 *
 * Enumeration is driven through `run(…, ce._timeRemaining)` so that an infinite
 * or lazy collection with no short-circuit aborts on the deadline instead of
 * hanging.
 */
function evaluateQuantifier(
  kind: 'Any' | 'All',
  collection: Expression,
  fn: Expression | undefined,
  ce: ComputeEngine
): Expression | undefined {
  const f = fn ? applicable(fn) : undefined;
  // A source that cannot be enumerated decides nothing: the walk below would
  // see no elements and fall to `defaultValue` — `Any(xs, p) → False`,
  // `All(xs, p) → True` for a valueless `xs`. Stay inert instead.
  if (!isEnumerableSource(collection)) return undefined;
  // `Any` short-circuits to True on the first True; `All` to False on the
  // first False. The complementary symbol ('False' for Any, 'True' for All) is
  // the "definite, keep going" result; anything else is undetermined.
  const shortSym = kind === 'Any' ? 'True' : 'False';
  const definiteSym = kind === 'Any' ? 'False' : 'True';
  const shortValue = kind === 'Any' ? ce.True : ce.False;
  const defaultValue = kind === 'Any' ? ce.False : ce.True;

  let sawUndetermined = false;
  return run(
    (function* (): Generator<undefined, Expression | undefined> {
      for (const item of collection.each()) {
        const result = f ? f([item]) : item.evaluate();
        const s = sym(result);
        if (s === shortSym) return shortValue;
        if (s !== definiteSym) {
          // See `predicateErrorValue`: an element-valued predicate failure is
          // surfaced as the operator's result, not absorbed as "undetermined".
          const err = predicateErrorValue(result);
          if (err) return err;
          sawUndetermined = true;
        }
        yield;
      }
      return sawUndetermined ? undefined : defaultValue;
    })(),
    ce._timeRemaining,
    ce._deadlineFrame
  );
}

/**
 * Normalize the arguments of range:
 * - [from, to] -> [from, to, 1] if to > from, or [from, to, -1] if to < from
 * - [x] -> [1, x, 1]
 *
 * Bounds and step are kept as raw numeric values (not rounded). The step is
 * trusted as-given when provided explicitly; iteration produces an empty
 * collection when the step's sign disagrees with the direction (lower→upper).
 */
export function range(
  expr: Expression
): [lower: number, upper: number, step: number] {
  if (!isFunction(expr)) return [1, 0, 0];
  if (expr.nops === 0) return [1, 0, 0];

  // An operand with no numerically-known value reads as NaN and propagates:
  // callers must check `hasSymbolicRangeBounds()` first. (These used to be
  // coerced to 1, which collapsed every symbolic range to [1, 1, 1] — the
  // `Count(Range(1, n)) → 1` class of wrong scalars.) An exact bound with a
  // known value (`50π`) reads through `.N()`.
  const op1 = operandNumericValue(expr.op1);
  if (expr.nops === 1) return [1, op1, 1];

  const op2 = operandNumericValue(expr.op2);
  if (expr.nops === 2) return [op1, op2, op2 >= op1 ? 1 : -1];

  return [op1, op2, operandNumericValue(expr.op3)];
}

/** Return the last value in the range
 * - could be less that lower if step is negative
 * - could be less than upper if step is positive, for
 * example `rangeLast([1, 6, 2])` = 5
 */
export function rangeLast(
  r: [lower: number, upper: number, step: number]
): number {
  const [lower, upper, step] = r;
  if (!Number.isFinite(upper)) return step > 0 ? Infinity : -Infinity;

  if (step > 0) return upper - ((upper - lower) % step);
  return upper + ((lower - upper) % step);
}

/**
 * An index range is of the form:
 * - an index, as an integer
 * - a tuple of the form [from, to]
 * - a tuple of the form [from, to, step]. `step` must be a positive number.
 *   If invalid, or absent, 1 is assumed.
 * - a ["List"] of indexes
 *
 * Negative indexes indicate position relative to the last element: -1 is
 * the last element, -2 the one before that, etc...
 *
 */
function _indexRangeArg(
  op: Expression | undefined,
  l: number
): [lower: number, upper: number, step: number] {
  if (!op) return [0, 0, 0];
  let n = op.re;

  if (isFinite(n)) {
    n = Math.round(n);
    if (n < 0) {
      if (l === undefined) return [0, 0, 0];
      n = l + n + 1;
    }
    return [n, n, 1];
  }

  // We may have a Tuple...
  const h = op.operator;
  if (!h || typeof h !== 'string' || !/^(Single|Pair|Triple|Tuple|)$/.test(h))
    return [0, 0, 0];
  // A symbolic tuple entry has no concrete numeric value: invalid as an
  // index range (range() no longer coerces it to 1).
  if (hasSymbolicRangeBounds(op)) return [0, 0, 0];
  let [lower, upper, step] = range(op);

  if ((lower < 0 || upper < 0) && l === undefined) return [0, 0, 0];

  if (lower < 0) lower = l! + lower + 1;
  if (upper < 0) upper = l! + upper + 1;

  step = Math.abs(Math.round(step));
  if (step === 0) return [0, 0, 0];
  if (lower > upper) step = -step;

  return [lower, upper, step];
}

function canonicalList(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine; scope: Scope | undefined }
): Expression {
  // Do we have a matrix with a custom delimiter, i.e.
  // \left\lbrack \begin{array}...\end{array} \right\rbrack

  const op1 = ops[0];
  if (ops.length === 1 && isFunction(op1, 'Matrix')) {
    // Adjust the matrix to have the correct delimiter
    const [body, delimiters, columns] = op1.ops;

    if (!delimiters || (isString(delimiters) && delimiters.string === '..')) {
      if (!columns) return ce._fn('Matrix', [body, delimiters]);
      return ce._fn('Matrix', [body, ce.string('[]'), columns]);
    }
  }

  // The canonical form of one ordinary (non-spread) element.
  const element = (op: Expression): Expression => {
    if (isFunction(op, 'Delimiter')) {
      if (isFunction(op.op1, 'Sequence'))
        return ce._fn('List', canonical(ce, op.op1.ops));
      return ce._fn('List', [op.op1?.canonical ?? ce.Nothing]);
    }
    return op.canonical;
  };

  // Spread elements: `[...xs, c, ...ys]`. `List` is `lazy`, so the raw
  // `Spread` operands reach this handler (the box-route Spread deferral is
  // the EAGER path's; a call's positional arity depends on the spread's
  // runtime value, a list literal's does not) and the rewrite is purely
  // structural — no deferral needed, the canonical form never contains a
  // `Spread`. The semantics are `Join`'s (ruled 2026-08-14): any
  // non-tuple collection splices, an infinite one lazily; a TUPLE does not
  // spread — tuples are units, and `ListFrom` is the explicit converter —
  // so a provably-tuple operand is a loud `spread-tuple` error, and one
  // that only turns out to be a tuple at evaluation contributes itself as
  // ONE element (`Join`'s atomic-tuple convention). A scalar or string
  // operand is `Join`'s `incompatible-type` error at evaluation.
  if (ops.some((op) => isFunction(op, 'Spread') && op.nops === 1)) {
    const segments: Expression[] = []; // `Join` operands
    let run: Expression[] = []; // current run of ordinary elements
    // The ordinary elements of a run are accumulated as written and flattened
    // ONCE, when the run is flushed — the same `Sequence`-splice and
    // `Nothing`-erasure the no-spread path below applies to the whole operand
    // list. Flattening per element would allocate a throwaway array apiece,
    // and would make this path look like it needed a different rule than that
    // one, which it does not.
    const flushRun = () => {
      if (run.length > 0) {
        segments.push(ce._fn('List', flatten(run)));
        run = [];
      }
    };
    for (const op of ops) {
      if (!isFunction(op, 'Spread') || op.nops !== 1) {
        run.push(element(op));
        continue;
      }
      // The RAW spread operand, canonicalized value-safely — deliberately
      // not `op.canonical`: `Spread`'s own canonical handler rewrites a
      // literal tuple into a `Sequence` for the call route, and here tuples
      // are handled by the ruling below instead.
      const x = op.ops[0].canonical;
      if (isFunction(x, 'List')) {
        // A literal list splices eagerly: `[...[1,2], 3]` → `[1,2,3]`.
        // (Canonicalization already erased any `Nothing` elements.)
        run.push(...x.ops);
      } else if (isFunction(x, 'Tuple') || x.type.matches('tuple')) {
        // Tuples do not spread. The error is an ELEMENT, so the list
        // freezes with the error cell in place (error-propagation §6a.2).
        run.push(ce.error(['spread-tuple'], x.toString()));
      } else {
        flushRun();
        // A set/dictionary/record-kind segment must materialize through
        // `ListFrom`: `Join` adopts those kinds from ANY operand
        // (`joinResultType`), so a direct join made `[...{1,2}, 2]` a
        // DEDUPLICATING set — a list literal must stay a list. The
        // provably list/indexed segments (the lazy pipelines: `Range`,
        // `Take`, `Map`) keep the direct join. A segment whose kind is
        // only discovered at evaluation still follows `Join`'s adoption —
        // the literal's kind promise is enforced as far as static types
        // can prove.
        segments.push(
          x.type.matches('set<any>') ||
            x.type.matches('dictionary<any>') ||
            isRecordShapedType(x.type.type)
            ? ce._fn('ListFrom', [x])
            : x
        );
      }
    }
    // Every spread spliced eagerly (or errored): an ordinary literal.
    if (segments.length === 0) return ce._fn('List', flatten(run));
    flushRun();
    // `Join` — unary for a lone spread: `[...xs]` is `Join(xs)`, the
    // list materialization of a non-tuple collection.
    return ce._fn('Join', segments);
  }

  // The framework's default flatten step, which this custom `canonical`
  // handler would otherwise short-circuit. It splices `Sequence` operands
  // (`[1, Sequence(2, 3), 4]` is the 4-element list `[1, 2, 3, 4]` — a
  // `Sequence` is the engine-wide "these operands, inlined here" marker and
  // must never be STORED as an element) and erases `Nothing`, the erasure
  // marker (`[12, Nothing, 34]` is a 2-element list; use `Missing` for an
  // absent-but-positioned value).
  return ce._fn('List', flatten(ops.map(element)));
}

function canonicalSet(
  ops: ReadonlyArray<Expression>,
  ctx: { engine: ComputeEngine; scope: Scope | undefined }
): Expression {
  const { engine } = ctx;

  // Spread elements: `{a, ...s, b}` — the set form of the list-literal
  // spread (same 2026-08-14 rulings as `canonicalList` above: non-tuple
  // collections splice, a provable tuple is a loud `spread-tuple` error, a
  // runtime tuple is one element, a scalar is `Join`'s error). Lowered to
  // `SetFrom(Join(…))`: `Join` concatenates the segments, `SetFrom`
  // deduplicates into a set. Handled BEFORE the generic operand
  // canonicalization below — `Spread`'s own canonical handler would rewrite
  // a literal tuple into a `Sequence` for the call route.
  if (ops.some((op) => isFunction(op, 'Spread') && op.nops === 1)) {
    const segments: Expression[] = [];
    let run: Expression[] = [];
    const flushRun = () => {
      if (run.length > 0) {
        segments.push(engine._fn('List', flatten(run)));
        run = [];
      }
    };
    for (const op of ops) {
      if (!isFunction(op, 'Spread') || op.nops !== 1) {
        // Accumulated as written; the `Sequence` splice and `Nothing` erasure
        // run once, in `flushRun` above (or in the `canonicalSet` recursion
        // below when there turned out to be no spread segment at all).
        run.push(op);
        continue;
      }
      const x = op.ops[0].canonical;
      if (isFunction(x, 'List') || isFunction(x, 'Set')) run.push(...x.ops);
      else if (isFunction(x, 'Tuple') || x.type.matches('tuple'))
        run.push(engine.error(['spread-tuple'], x.toString()));
      else {
        flushRun();
        segments.push(x);
      }
    }
    // Every spread spliced eagerly (or errored): an ordinary literal —
    // recurse for the comprehension check and the dedup below.
    if (segments.length === 0) return canonicalSet(run, ctx);
    flushRun();
    return engine._fn('SetFrom', [engine._fn('Join', segments)]);
  }

  // Since the `Set` operator is `lazy`, the canonical handler receives raw
  // operands: canonicalize them first. `flatten` does that AND runs the
  // framework's default flatten step, which this custom `canonical` handler
  // would otherwise short-circuit: it splices `Sequence` operands
  // (`{1, Sequence(2, 3), 4}` is the 4-element set `{1, 2, 3, 4}` — a
  // `Sequence` is the engine-wide "these operands, inlined here" marker and
  // must never be STORED as an element) and erases `Nothing`, the erasure
  // marker (`{12, Nothing, 34}` is a 2-element set; use `Missing` for an
  // absent-but-positioned element).
  ops = flatten(ops);

  // A set-builder (comprehension) is not a literal set: do not deduplicate
  // its syntactic operands (body + indexing set)
  if (parseSetComprehension(ops) !== null) return engine._fn('Set', [...ops]);

  // Check that each element is only present once. (`Nothing` was already
  // erased by the `flatten` call above.)
  const set: Expression[] = [];
  const has = (x: Expression) => set.some((y) => y.isSame(x));

  for (const op of ops) if (!has(op)) set.push(op);

  return engine._fn('Set', set);
}

/**
 * A set-builder (comprehension) expression, e.g. `{k ∈ 1..n : gcd(n,k) = 1}`.
 *
 * - `body`: the expression each domain value is substituted into
 * - `variable`: the bound (index) variable, or `undefined` if it could not
 *   be identified (the comprehension is then never enumerable)
 * - `domain`: the collection the variable ranges over, or `undefined` if
 *   unknown (e.g. `{x | x > 0}`)
 * - `condition`: an optional filter predicate
 */
type SetComprehension = {
  body: Expression;
  variable: string | undefined;
  domain: Expression | undefined;
  condition: Expression | undefined;
};

/**
 * Determine whether the operands of a `Set` expression describe a
 * set-builder (comprehension) rather than a literal set.
 *
 * A `Set` is a comprehension iff it has exactly two operands and the second
 * operand is an indexing-set form:
 *
 * - `["Set", body, ["Element", v, domain, cond?]]` — the form used by the
 *   big operators (Sum/Product) and the Fungrim corpus — provided the bound
 *   variable `v` occurs in `body` (otherwise the `Element` is just a
 *   proposition and the set is literal, e.g. `{x, k ∈ S}`);
 * - `["Set", ["Element", v, domain], ["Condition", pred]]` — produced by the
 *   LaTeX parser for `\{k \in S \mid pred\}`;
 * - `["Set", body, ["Condition", ...]]` — produced by the LaTeX parser for
 *   `\{body \mid ...\}`. A `Condition` operand is a syntactic marker, not a
 *   value, so such a `Set` is always treated as a comprehension, possibly
 *   with an unknown (non-enumerable) domain, e.g. `{x | x > 0}`.
 *
 * Literal sets — `{1, 2}`, `{x, y}`, … — never match: their second operand
 * is not an `Element`/`Condition` indexing-set form.
 *
 * Returns `null` if the operands describe a literal set.
 */
function parseSetComprehension(
  ops: ReadonlyArray<Expression>
): SetComprehension | null {
  if (ops.length !== 2) return null;
  const [body, spec] = ops;

  // The `Condition` operator holds its operands, so the domain/condition
  // extracted from inside it may be non-canonical (unbound). Canonicalize
  // the extracted pieces so they can be enumerated and evaluated.
  const canon = (x: Expression) => (x.isCanonical ? x : x.canonical);

  // Form A: ["Set", body, ["Element", v, domain, cond?]]
  if (isFunction(spec, 'Element') && spec.nops >= 2) {
    if (!isSymbol(spec.op1)) return null;
    const v = spec.op1.symbol;
    // The bound variable must occur in the body, else this is a literal set
    if (!body.has(v)) return null;
    const cond =
      spec.nops >= 3 && sym(spec.op3) !== 'Nothing' ? spec.op3 : undefined;
    return { body, variable: v, domain: spec.op2, condition: cond };
  }

  if (isFunction(spec, 'Condition') && spec.nops >= 1) {
    const pred = spec.op1;

    // Form B: ["Set", ["Element", v, domain], ["Condition", pred]]
    // e.g. `\{k \in S \mid pred\}`: the body is the bound variable itself
    if (isFunction(body, 'Element') && body.nops === 2 && isSymbol(body.op1)) {
      return {
        body: body.op1,
        variable: body.op1.symbol,
        domain: canon(body.op2),
        condition: canon(pred),
      };
    }

    // Form C: ["Set", body, ["Condition", ["Element", v, domain]]]
    // e.g. `\{2k \mid k \in S\}`
    if (isFunction(pred, 'Element') && pred.nops === 2 && isSymbol(pred.op1)) {
      const v = pred.op1.symbol;
      if (body.has(v))
        return {
          body,
          variable: v,
          domain: canon(pred.op2),
          condition: undefined,
        };
    }

    // Form C': the predicate is a conjunction including exactly one
    // membership over a variable of the body,
    // e.g. ["Set", body, ["Condition", ["And", ["Element", v, domain], cond]]]
    if (isFunction(pred, 'And')) {
      const memberships = pred.ops.filter(
        (x) =>
          isFunction(x, 'Element') &&
          x.nops === 2 &&
          isSymbol(x.op1) &&
          body.has(x.op1.symbol)
      );
      const membership = memberships.length === 1 ? memberships[0] : undefined;
      if (
        membership &&
        isFunction(membership, 'Element') &&
        isSymbol(membership.op1)
      ) {
        const rest = pred.ops.filter((x) => x !== membership).map(canon);
        const ce = body.engine;
        const cond =
          rest.length === 0
            ? undefined
            : rest.length === 1
              ? rest[0]
              : ce._fn('And', rest);
        return {
          body,
          variable: membership.op1.symbol,
          domain: canon(membership.op2),
          condition: cond,
        };
      }
    }

    // Unrecognized `Condition` form: still a comprehension (a `Condition` is
    // not a value), but over an unknown domain — never enumerable, e.g.
    // `{x | x > 0}`. This keeps it symbolic instead of a 2-element literal.
    return {
      body,
      variable: isSymbol(body) ? body.symbol : undefined,
      domain: undefined,
      condition: pred,
    };
  }

  return null;
}

/**
 * Enumerate the elements of a set-builder: the distinct substituted bodies
 * over the (filtered) domain.
 *
 * Returns `undefined` if the domain cannot be enumerated (symbolic bounds,
 * infinite or unknown domain, more than 1000 values...): the comprehension
 * must then stay symbolic.
 */
function enumerateSetComprehension(
  comp: SetComprehension
): Expression[] | undefined {
  const { body, variable, domain, condition } = comp;
  if (variable === undefined || domain === undefined) return undefined;
  const ce = body.engine;

  // Reuse the big-op machinery (how Sum/Product enumerate an
  // `Element(v, domain, cond?)` indexing set, including condition filtering)
  const extract = (dom: Expression) =>
    extractFiniteDomainWithReason(
      ce._fn('Element', [
        ce.symbol(variable),
        dom,
        ...(condition ? [condition] : []),
      ]),
      ce
    );

  let result = extract(domain);

  // The domain may reference symbols with assigned values, e.g.
  // `Range(1, n)` with `n := 5`: retry with the evaluated domain
  if (result.status !== 'success') {
    const evaluatedDomain = domain.evaluate();
    if (!evaluatedDomain.isSame(domain)) result = extract(evaluatedDomain);
  }
  if (result.status !== 'success') return undefined;

  // Substitute each domain value into the body and evaluate. A set has no
  // duplicate elements: equal substituted bodies collapse, e.g.
  // `{k mod 2 : k ∈ 1..4}` has two elements, `{0, 1}`.
  const isIdentity = isSymbol(body) && body.symbol === variable;
  const elements: Expression[] = [];
  for (const value of result.values) {
    const x = isIdentity ? value : body.subs({ [variable]: value }).evaluate();
    if (!elements.some((y) => y.isSame(x))) elements.push(x);
  }
  return elements;
}

/**
 * Three-valued membership for a literal set: `true` when an element matches,
 * `false` only when every element is definitively different from `target`
 * (concrete values), `undefined` otherwise.
 */
function literalSetContains(
  ops: ReadonlyArray<Expression>,
  target: Expression
): boolean | undefined {
  let indeterminate = false;
  for (const op of ops) {
    if (target.isSame(op)) return true;
    if (isNumber(target) && isNumber(op)) {
      // Concrete numbers decide definitively
      const eq = target.isEqual(op);
      if (eq === true) return true;
      if (eq !== false) indeterminate = true;
    } else if (isString(target) && isString(op)) {
      // Two distinct string literals (isSame was false): refuted
    } else {
      indeterminate = true;
    }
  }
  return indeterminate ? undefined : false;
}

/**
 * Three-valued membership for a set-builder: decide by enumeration over
 * finite domains; over symbolic/infinite domains, decide via the domain and
 * the condition when the body is the bare bound variable, and stay
 * indeterminate otherwise.
 */
function setComprehensionContains(
  comp: SetComprehension,
  target: Expression
): boolean | undefined {
  const elements = enumerateSetComprehension(comp);
  if (elements !== undefined) return literalSetContains(elements, target);

  // Non-enumerable domain: when the body is the bare bound variable, the
  // comprehension is `{v ∈ domain : cond(v)}`, so membership is the Kleene
  // conjunction of domain membership and the condition.
  if (
    comp.domain !== undefined &&
    comp.variable !== undefined &&
    isSymbol(comp.body) &&
    comp.body.symbol === comp.variable
  ) {
    const inDomain = comp.domain.contains(target);
    // Exclusion from the domain refutes membership (e.g. `1/2 ∉ {k ∈ ℤ : …}`)
    if (inDomain === false) return false;

    let condition: boolean | undefined = true;
    if (comp.condition !== undefined) {
      // Only literal candidates can be decided by evaluating the condition:
      // a symbolic target could make the condition evaluate to a spurious
      // `False` (e.g. `Equal` of distinct symbolic expressions)
      if (isNumber(target) || isString(target)) {
        const result = comp.condition
          .subs({ [comp.variable]: target })
          .evaluate();
        condition =
          sym(result) === 'True'
            ? true
            : sym(result) === 'False'
              ? false
              : undefined;
      } else condition = undefined;
    }
    if (condition === false) return false;
    if (inDomain === true && condition === true) return true;
  }

  return undefined;
}

function tally(collection: Expression): [ReadonlyArray<Expression>, number[]] {
  const values: Expression[] = [];
  const counts: number[] = [];

  const indexOf = (expr: Expression) => {
    for (let i = 0; i < values.length; i++)
      if (values[i].isSame(expr)) return i;
    return -1;
  };

  for (const op of collection.each()) {
    const index = indexOf(op);
    if (index >= 0) counts[index]++;
    else {
      values.push(op);
      counts.push(1);
    }
  }

  return [values, counts];
}

/**
 * Did an enumeration DECLINE, judged from a walk the caller has ALREADY
 * performed? `walked` is the number of elements that walk produced.
 *
 * A collection can report a definite size and still be unable to produce its
 * elements: `Linspace(a, 1, 3)` with a symbolic endpoint has three elements,
 * but none of them has a computable value, so `each()` yields nothing. That is
 * a DECLINE, and it must not be mistaken for an empty collection — folding it
 * would silently answer the fold's initial value (`Sum` → 0), which reads
 * exactly like a correct sum over no elements. A genuinely empty collection
 * (a `Filter` whose predicate matched nothing) reports `isEmptyCollection ===
 * true` and is not a decline; its consumers should fold it away as usual.
 *
 * The verdict is taken from the caller's own walk rather than from a probe
 * enumeration, and that is the whole point of this function: probing means
 * calling `each()` a second time, which re-runs the element callback of a lazy
 * `Map`/`Filter` and throws the result away. Because the language has
 * mutation, the number of times an effectful callback runs is observable, so
 * the extra run is a visible wrong answer — `Sum(Map(f, xs))` ran `f` once per
 * element plus once more. Ruling B8 ("pinned everywhere operands evaluate",
 * `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B) requires lazy materialization not
 * to duplicate evaluations. The counts are pinned in
 * `test/compute-engine/lazy-callback-count.test.ts`.
 *
 * A walk that produced elements settles the question on its own. When it
 * produced nothing, a collection that is provably ENUMERABLE settles it too:
 * it can produce elements, so producing none means there were none. That test
 * is structural — `isEnumerableCollection` propagates from the source
 * (`enumerableFromSource`) and is documented never to read its own
 * `count`/`isEmpty` — so it costs O(depth) and never enumerates.
 *
 * That fast path is the whole point. `isEmptyCollection` IS a walk for some
 * collections (`Filter.isEmpty` enumerates its source up to the first match),
 * so consulting it here made a fold over a filter whose predicate rejects
 * EVERY element pay for two full passes — the fold's own, then the emptiness
 * probe's — running the predicate 2N times for N source elements. That is the
 * duplicate materialization ruling B8 forbids, in the one shape the
 * walk-count tests missed (their filters all accept, so they leave by the
 * `walked > 0` path).
 *
 * Only `true` is a fast path. Non-enumerability is NOT evidence of a decline,
 * because it can come from a source this walk never had to touch: `Zip([], xs)`
 * with a non-enumerable `xs` reports `isEnumerableCollection === false`
 * (`enumerableFromAllSources` fails on `xs`) while being definitely empty —
 * its iterator stops at the empty first input and never reaches `xs`. Treating
 * that as a decline would leave `Sum(Zip([], xs))` symbolic instead of 0. So
 * `false` and `undefined` alike fall through to `isEmptyCollection`, which
 * preserves the original reading exactly for every collection that does not
 * take the fast path.
 */
export function enumerationDeclinedAfterWalk(
  collection: Expression,
  walked: number
): boolean {
  if (walked > 0) return false;
  if (collection.isEnumerableCollection === true) return false;
  return collection.isEmptyCollection !== true;
}

/**
 * This function is used to reduce a collection of expressions to a single value. It
 * iterates over the collection, applying the given function to each element and the
 * accumulator. If the function returns `null`, the iteration is stopped and `undefined`
 * is returned. Otherwise, the result of the function is used as the new accumulator.
 * If the iteration completes, the final accumulator is returned.
 */
export function* reduceCollection<T>(
  collection: Expression,
  fn: (acc: T, next: Expression) => T | null,
  initial: T
): Generator<T | undefined> {
  let acc = initial;
  for (const x of collection.each()) {
    const result = fn(acc, x);
    if (result === null) return undefined;
    yield acc;
    acc = result;
  }
  return acc;
}

/**
 * Is this `Join` operand contributed as a single element rather than spliced?
 *
 * A tuple is an `indexed_collection` (load-bearing — see
 * `docs/plans/2026-07-07-tuple-point-semantics.md`), so `Join` used to iterate
 * it and splice its components: `Join([(0,3),(1,4)], (2,5))` produced
 * `[(0,3),(1,4),2,5]` — length +2 and a heterogeneous `number` tail that no
 * longer matched `list<point>`. But a tuple is a *value* (a point/vector), not
 * a sequence of values to concatenate; everywhere else in the engine it is
 * treated as one (`Abs(point)` → `Norm`, point arithmetic component-wise).
 * `Join` follows suit: tuples append atomically, matching `Append` and the
 * point-list accumulation idiom `L → Join(L, P)`.
 *
 * Keyed on the static type, so a tuple-typed symbol routes too.
 */
function isAtomicJoinOperand(op: Expression): boolean {
  return op.type.matches('tuple');
}

/** The undeduplicated element enumeration of a `Map` node.
 *
 * Extracted from the `iterator` handler so the set-kind wrap (see there) has
 * a single place to apply: this body has four element-producing forms (the two
 * broadcast-spine forms, the zipWith form and the general form), each with
 * its own return, and wrapping them individually would have to be kept in
 * step by hand. */
function mapIterator(expr: Expression): Iterator<Expression> {
  if (!isFunction(expr))
    return { next: () => ({ value: undefined, done: true }) };

  // Broadcast-chain lowering (see `map-lowering.ts`): a stack of
  // broadcast-shaped lazy `Map`s is served from ONE loop that applies
  // each level's operator directly, bypassing the per-level
  // `makeLambda` invoke. Purely structural, memoized per instance; a
  // `Map` that doesn't match falls through to the general path below,
  // byte-identically.
  const spine = lowerMapSpine(expr);
  if (spine) {
    const ce = expr.engine;
    // A level that fails yields THAT level's position-preserving marker
    // as an ordinary element value, which flows through the remaining
    // levels — exactly what the nested general iterators do.
    const run = makeSpineRunner(ce, spine, (levelExpr) =>
      absenceMarker(ce, levelExpr)
    );
    if (spine.bases.length > 1) {
      // Variadic bottom level: advance every base lockstep, ending as
      // soon as any source ends (mirrors the zipWith form below).
      const sources = spine.bases.map((c) => c.each());
      return {
        next: () => {
          const items: Expression[] = [];
          for (const source of sources) {
            const { value, done } = source.next();
            if (done || value === undefined)
              return { value: undefined, done: true };
            items.push(value);
          }
          // A level that produced no value is a COMPUTATION FAILURE,
          // not an erasure: the runner already substituted the marker,
          // so this fallback is unreachable (kept for type totality).
          const v = run(items) ?? absenceMarker(ce, expr);
          return { value: v, done: false };
        },
      };
    }
    const source = spine.bases[0].each();
    return {
      next: () => {
        const { value, done } = source.next();
        if (done) return { value: undefined, done: true };
        // See above: a failed mapping is the marker, not an erasure.
        // The runner substitutes it; this fallback is unreachable.
        const v = run([value]) ?? absenceMarker(ce, expr);
        return { value: v, done: false };
      },
    };
  }

  // Auto-compile trigger (see `map-auto-compile.ts`): when the element
  // lambda carries the numeric `Block(N(body))` marker and the engine
  // is at machine precision, elements are served by a cached compiled
  // function, with silent per-element interpreter fallback. A new
  // iterator is a new drain (resets the once-per-drain attempt bound).
  const auto = mapAutoCompileRunner(expr, { drainStart: true });

  if (expr.nops > 2) {
    // Multi-collection (zipWith): apply the mapping function to the
    // element-wise tuple of the sources, bounded by the shortest
    // input. Driven by each source's iterator — not by up-front
    // counts — so a source with an unknown count (or an infinite one
    // zipped with a finite one) still iterates; the zip ends as soon
    // as any source ends.
    const f = applicable(expr.op1);
    if (!f) return { next: () => ({ value: undefined, done: true }) };
    const sources = expr.ops.slice(1).map((c) => c.each());
    return {
      next: () => {
        const items: Expression[] = [];
        for (const source of sources) {
          const { value, done } = source.next();
          if (done || value === undefined)
            return { value: undefined, done: true };
          items.push(value);
        }
        const compiled = auto?.(items);
        if (compiled !== undefined) return { value: compiled, done: false };
        // A mapping function that produced no value is a COMPUTATION
        // FAILURE, not an erasure: emit the position-preserving marker
        // (`Nothing` here would silently shorten the result).
        const v = f(items) ?? absenceMarker(expr.engine, expr);
        return { value: v, done: false };
      },
    };
  }

  const f = applicable(expr.op1);
  if (!f) return { next: () => ({ value: undefined, done: true }) };

  const source = expr.op2.each();

  return {
    next: () => {
      while (true) {
        const { value, done } = source.next();
        if (done) return { value: undefined, done: true };
        const compiled = auto?.([value]);
        if (compiled !== undefined) return { value: compiled, done: false };
        // See above: a failed mapping is the marker, not an erasure.
        const v = f([value]) ?? absenceMarker(expr.engine, expr);
        return { value: v, done: false };
      }
    },
  };
}

function isIterator(x: unknown): x is Iterator<Expression> {
  return typeof (x as Iterator<Expression>)?.next === 'function';
}

/** Does this node promise a SET?
 *
 * Three operators reach here, by two different mechanisms: `Join` and
 * `Append` ADOPT the set kind from a set operand (`joinResultType`,
 * `appendResultType`), while `Map` PRESERVES its source's kind
 * (`mapResultType`). Either way the answer is read off the node's OWN type
 * rather than re-derived from the operands, so the two mechanisms need no
 * distinction here.
 *
 * The distinction does matter to the callers, and in one place: `Join`/
 * `Append` pass their operands' elements through UNCHANGED, so an infinite
 * SET operand keeps infinitely many distinct elements, whereas `Map` applies
 * a callback that may collapse them all onto one value. See the infinite-
 * operand branches of their `count`/`isFinite` handlers. */
function producesSet(expr: Expression): boolean {
  return expr.type.matches('set<any>');
}

/** Does this node promise a KEYED collection — a `record` or a `dictionary`?
 *
 * `Join` and `Append` adopt those kinds from an operand exactly as they adopt
 * `set` (`joinResultType`, `appendResultType`), and a keyed collection owes
 * its keys the same distinctness a set owes its elements. */
function producesKeyed(expr: Expression): boolean {
  return (
    isRecordShapedType(expr.type.type) || expr.type.matches('dictionary<any>')
  );
}

/** Does this node's enumeration need rewriting before anyone reads it —
 * deduplicated (set) or key-merged (record/dictionary)? */
function producesMergedView(expr: Expression): boolean {
  return producesSet(expr) || producesKeyed(expr);
}

/** The key of a key-value entry, or `undefined` if this is not one.
 *
 * Entries enumerate as `Tuple(key, value)` with a string key — the shape
 * `materialize()` tests for when it decides to rebuild a `Dictionary`. */
function entryKeyOf(entry: Expression): string | undefined {
  if (!isFunction(entry, 'Tuple') || entry.nops !== 2) return undefined;
  const key = entry.op1;
  return isString(key) ? key.string : undefined;
}

/** The merged entries of a keyed lazy result: one per distinct key, in
 * FIRST-SEEN order, carrying the LAST value seen for that key.
 *
 * That is the literal constructor's rule, and the reason this exists —
 * `Dictionary(a: 1, b: 2, a: 3)` is `{a: 3, b: 2}`, so `a` keeps its POSITION
 * and takes the LATER value. `Join`/`Append` adopt the keyed kind but
 * concatenate, so without this `Join(Dictionary(a: 1, b: 2), Dictionary(b: 3,
 * c: 4))` enumerated `b` twice and counted 4 entries for a 3-key dictionary.
 *
 * Unlike deduplication, last-wins CANNOT be streamed: the winning value for
 * the FIRST key may come from the LAST entry, so the whole enumeration has to
 * be read before any entry can be emitted. That is why this returns an array
 * rather than wrapping the iterator, and why it declines (`undefined`) when
 * the walk is unavailable — a source longer than `ce.maxCollectionSize`, or
 * an entry that is not a key-value pair at all. An infinite keyed source is
 * refused by the callers' `rawTotal` gate before reaching here. */
function mergeKeyedEntries(
  source: Iterator<Expression>,
  limit: number
): Expression[] | undefined {
  const order: string[] = [];
  const byKey = new Map<string, Expression>();
  let n = 0;
  for (;;) {
    const { value, done } = source.next();
    if (done || value === undefined) break;
    if (++n > limit) return undefined;
    const key = entryKeyOf(value);
    if (key === undefined) return undefined;
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, value); // LAST wins
  }
  return order.map((k) => byKey.get(k)!);
}

/** An iterator over an already-computed element array. */
function arrayIterator(xs: ReadonlyArray<Expression>): Iterator<Expression> {
  let i = 0;
  return {
    next: () =>
      i >= xs.length
        ? { value: undefined, done: true as const }
        : { value: xs[i++], done: false as const },
  };
}

/** Wrap `source` so it yields the MERGED entries of a keyed lazy result,
 * deferring the merge itself to the first pull.
 *
 * `mergeKeyedEntries()` declines (returns `undefined`) when the merge cannot
 * be performed — the source is longer than `ce.maxCollectionSize`, or one of
 * its elements is not a `Tuple(string, any)` key-value entry. That decline is
 * signalled here by THROWING, never by returning a falsy iterator, because a
 * falsy result from a collection `iterator` handler is indistinguishable from
 * having no handler at all: `BoxedFunction.each()` (in
 * `boxed-expression/boxed-function.ts`) falls back to evaluating the
 * expression, and a lazy node that evaluates to itself then ends up returning
 * an EMPTY generator. A decline would therefore be read as "this collection
 * has no elements" — `count` would answer an exact 0 and `contains` a
 * definite `false`, both silently wrong. Throwing a `CancellationError` with
 * cause `iteration-limit-exceeded` is the convention `deduplicatingIterator`
 * below already follows, and the terminal consumers (`distinctCount`,
 * `distinctAt`, and the keyed `contains` handlers) catch exactly that cause
 * and answer `undefined` — "unknown" — instead.
 *
 * The merge is deferred to the first `next()` call for the same reason
 * `deduplicatingIterator` signals mid-iteration rather than at handler-call
 * time: the handler's contract is to return an iterator, so the decline has
 * to surface where a caller is walking, and prepared to catch. */
function keyedMergeIterator(
  source: Iterator<Expression>,
  limit: number,
  operator: string
): Iterator<Expression> {
  let merged: Iterator<Expression> | undefined = undefined;
  return {
    next: () => {
      if (merged === undefined) {
        const entries = mergeKeyedEntries(source, limit);
        if (entries === undefined)
          throw new CancellationError({
            cause: 'iteration-limit-exceeded',
            message: `Cannot merge the keyed entries of ${operator}(): the source exceeds the maximum collection size of ${limit}, or holds an element that is not a key-value entry`,
          });
        merged = arrayIterator(entries);
      }
      return merged.next();
    },
  };
}

/** Wrap `source` so it yields only the FIRST occurrence of each value.
 *
 * `Join` and `Append` are LAZY: they wrap their operands instead of
 * materializing, so when they adopt the `set` kind nothing else in the
 * pipeline enforces the distinctness a set promises. Without this,
 * `Join(Set(1, 2), Set(2, 3))` reported `count` 4 and enumerated `2` twice,
 * while forcing the SAME node through materialization answered the correct
 * 3-element `Set(1, 2, 3)` — materialization rebuilds through
 * `ce.function('Set', …)`, which deduplicates in `canonicalSet`. The lazy
 * facets have to agree with that; a collection whose `each()` disagrees with
 * its own materialization is the bug, not either answer alone.
 *
 * Distinctness is `isSame` — the same relation `canonicalSet` deduplicates
 * with — so a lazy set and a materialized one never disagree about their
 * elements. Candidates are bucketed by `hash`, whose documented invariant is
 * that equal values hash equal (`types-expression.ts`), so a bucket miss is a
 * definitive "not seen" and only same-hash candidates are compared. That
 * keeps the scan near-linear instead of comparing every element against every
 * one already kept. */
function deduplicatingIterator(
  source: Iterator<Expression>,
  limit: number,
  operator: string
): Iterator<Expression> {
  const seen = new Map<number, Expression[]>();
  // Cap the SOURCE walk at `ce.iterationLimit`, mirroring `Dedup`'s iterator:
  // this loop advances only on a DISTINCT element, so a source that repeats
  // one value forever spins here without ever emitting —
  // `Join(Set(1), Repeat(1))` yields `1` and then never returns from the next
  // pull. That is strictly worse than not deduplicating at all: an
  // undeduplicated `each()` at least RETURNS from every `next()`, letting the
  // consumer's own deadline checks fire, whereas a wedged `next()` is
  // uninterruptible.
  //
  // Counted since the last EMISSION, not in total: only an unbroken run of
  // duplicates is a walk that cannot finish. A dedup that keeps emitting is
  // bounded by whatever consumes it. `iteration-limit-exceeded` is swallowed
  // to `undefined` by the terminal consumers (`count`, `at`); any other
  // cancellation (deadline/timeout) propagates.
  let sinceEmit = 0;
  return {
    next: () => {
      for (;;) {
        const { value, done } = source.next();
        if (done || value === undefined)
          return { value: undefined, done: true };
        const bucket = seen.get(value.hash);
        if (bucket !== undefined && bucket.some((x) => x.isSame(value))) {
          // A DUPLICATE — the only pull that counts toward the cap.
          if (++sinceEmit > limit)
            throw new CancellationError({
              cause: 'iteration-limit-exceeded',
              message: `Iteration limit of ${limit} exceeded while evaluating ${operator}()`,
            });
          continue;
        }
        if (bucket === undefined) seen.set(value.hash, [value]);
        else bucket.push(value);
        sinceEmit = 0;
        return { value, done: false };
      }
    },
  };
}

/** The number of DISTINCT elements of a set-kind lazy collection, by walking
 * its (deduplicating) `each()`.
 *
 * `undefined` — "unknown" — in three cases, each for its own reason:
 *
 * - The concatenated length is unknown or infinite. An infinite source may
 *   repeat one value forever, so its distinct count is not decidable by a
 *   walk that terminates; answering `Infinity` would be a guess, and a wrong
 *   one for an endless repetition.
 * - An operand cannot be ENUMERATED. Finiteness is not enumerability: a
 *   `Linspace` with symbolic endpoints reports a count while its iterator
 *   declines, and `Take(xs, 2)` over a valueless `xs` is finite (capped at 2)
 *   with nothing to walk. Without this gate the empty walk would be reported
 *   as an exact distinct count of 0.
 * - The walk exceeds `ce.maxCollectionSize`, either here or by the iterator's
 *   own duplicate-run guard (whose `iteration-limit-exceeded` is caught).
 *   Any other cancellation (deadline/timeout) propagates.
 *
 * The bound is `maxCollectionSize` — the size of collection the engine is
 * already willing to build — and NOT `iterationLimit`. The walk is provably
 * finite here: `rawTotal` is known and finite (the guard above), so it
 * terminates in at most `rawTotal` steps whatever the elements are. The
 * unbounded case this once guarded against is a run of duplicates that never
 * emits, and that is the ITERATOR's guard, not this one. Bounding by
 * `iterationLimit` (1024) instead cost `Join(Set(1, 2), Range(1, 5000))` its
 * count for no safety gained.
 *
 * `rawTotal` is the caller's already-computed concatenated length, so taking
 * finiteness from it also avoids recomputing every operand's count — and
 * `op.count` on a lazy operand can itself be a walk. */
function distinctCount(expr: Expression, rawTotal: number): number | undefined {
  if (!Number.isFinite(rawTotal)) return undefined;
  if (expr.isEnumerableCollection !== true) return undefined;
  const limit = Math.min(rawTotal, expr.engine.maxCollectionSize);
  try {
    let n = 0;
    for (const _ of expr.each()) if (++n > limit) return undefined;
    return n;
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
}

/** The 1-based `index`-th DISTINCT element of a set-kind lazy collection.
 *
 * Walks the same deduplicating `each()` that `count` counts, so `at`, `each`
 * and `count` cannot disagree — the invariant whose breach is the whole
 * reason these helpers exist.
 *
 * `rawTotalOf` is a THUNK, not a number, because only a NEGATIVE index needs
 * the concatenated length: counting back from the end requires knowing where
 * the end is. A positive index just walks forward, and must keep working when
 * the length is unknown — computing the total eagerly made
 * `Join(Set(1, 2), xs).at(1)` answer `undefined` for an `xs` of unknown
 * count, even though `each()` yields its first element immediately, which
 * breaks the very agreement this helper exists to keep. The thunk also avoids
 * the cost: `op.count` on a lazy operand can itself be a full walk. */
function distinctAt(
  expr: Expression,
  index: number,
  rawTotalOf: () => number | undefined
): Expression | undefined {
  // The positional `at` paths this pre-empts all opened with a finite-index
  // guard, and dropping it was not survivable: `NaN < 1` and `NaN > limit`
  // are BOTH false, so a `NaN` index fell straight through to an unbounded
  // walk with no termination condition of its own. `at(index: number)` is
  // public API, so a `NaN` is a caller's mistake that must cost `undefined`,
  // not the process.
  if (!Number.isInteger(index)) return undefined;
  if (index < 0) {
    const rawTotal = rawTotalOf();
    if (rawTotal === undefined) return undefined;
    const total = distinctCount(expr, rawTotal);
    if (total === undefined) return undefined;
    index = total + index + 1;
  }
  // Bounded by the size of collection the engine will build, matching
  // `distinctCount` — see the note there on why this is not `iterationLimit`.
  if (index < 1 || index > expr.engine.maxCollectionSize) return undefined;
  // An operand that cannot be ENUMERATED silently yields nothing, which would
  // not merely truncate the walk — it would shift every later element into
  // its place. `Join(xs, Set(1, 2))` for a valueless `xs` enumerates as
  // `1, 2`, so a walk would answer `1` for index 1 when the real first
  // element is whatever `xs` holds. Refusing is the only safe answer; an
  // enumerable operand of UNKNOWN length is fine and is handled by the walk
  // (that is what the lazy `rawTotalOf` above buys).
  if (expr.isEnumerableCollection !== true) return undefined;
  try {
    let i = 0;
    for (const element of expr.each()) {
      i += 1;
      if (i === index) return element;
    }
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
  return undefined;
}

function joinResultType(ops: ReadonlyArray<Expression>): Type {
  // The string-preservation arm (`docs/STRING_ROADMAP.md`, "`Join` vs.
  // `StringJoin`"): when EVERY operand is a string, the concatenation is a
  // string, and `Join` is the variadic string concatenation. The runtime
  // follows from this type alone — a lazy collection whose declared result
  // type is `string` is walked once and its characters joined
  // (`evaluateStringPreservingCollection` in
  // `boxed-expression/boxed-function.ts`), so there is no `evaluate` handler
  // to keep in step.
  // Requiring EVERY operand to be a string is what keeps the rule readable
  // from the operand kinds; a mixed call falls through to the element-widening
  // path below and yields a `list<character>`. `character` is a SIBLING of
  // `string`, not a subtype, so a character operand makes the call mixed.
  if (ops.length > 0 && ops.every((op) => op.type.matches('string')))
    return 'string';
  if (ops.some((op) => isRecordShapedType(op.type.type))) return 'record';
  if (ops.some((op) => op.type.matches('dictionary<any>'))) return 'dictionary';
  if (ops.some((op) => op.type.matches('set<any>'))) return 'set';

  // Carry the element type through, so a joined point list still MATCHES
  // `list<tuple<…>>` and downstream type-directed dispatch keeps recognizing
  // it. Each operand contributes either its own type (an atomic tuple, which
  // becomes one element) or its element type (a collection, which is spliced).
  // Any operand whose element type is unknown makes the whole result
  // unknown-element, so fall back to the bare `list` rather than narrowing to
  // something the value may not satisfy.
  const eltTypes: Type[] = [];
  for (const op of ops) {
    if (isAtomicJoinOperand(op)) {
      eltTypes.push(op.type.type);
      continue;
    }
    const elt = collectionElementType(op.type.type);
    if (elt === undefined) return 'list';
    eltTypes.push(elt);
  }
  if (eltTypes.length === 0) return 'list';
  return { kind: 'list', elements: widen(...eltTypes) };
}

/** Does this static type admit the value `Nothing`?
 *
 * `nothing` is a UNIT type here, not a bottom type, so it is admitted only
 * where it literally appears: the type IS `nothing`, or it is a union with a
 * `nothing` arm (`RangeOf` is declared `range | nothing`). Testing the whole
 * union with a subtype check answers `false` — `range | nothing` is not a
 * subtype of `nothing` — so the arms have to be walked individually, which is
 * what this does. A nested union is walked recursively; nothing else (a bare
 * `any`, an `unknown`) counts, because admitting those would attach a
 * `| nothing` arm to every untyped operand. */
function typeIsNothingOrAdmitsNothing(t: Type): boolean {
  if (typeof t === 'string') return t === 'nothing';
  if (t.kind === 'union')
    return t.types.some((arm) => typeIsNothingOrAdmitsNothing(arm));
  return false;
}

/** The result type of `Slice(value, span)` when — and only when — the span
 * may be absent; `undefined` otherwise, leaving the declared overload set's
 * resolved arm in place.
 *
 * `Slice(xs, Nothing)` is `Nothing`, so a span whose static type admits
 * `Nothing` (`RangeOf`'s `range | nothing`) makes the whole call possibly
 * absent, and the honest result is `T | nothing`. The overload resolver will
 * not say so on its own: it admits the overlapping operand on trial and picks
 * the more specific `span: range` arm, reporting the bare `T`.
 *
 * Returning `undefined` for a span that statically EXCLUDES `nothing` is
 * deliberate and load-bearing, not just an optimization: the
 * string-preservation step requires the node's type to MATCH `string` exactly
 * (`evaluateStringPreservingCollection` in
 * `boxed-expression/boxed-function.ts`), so `Slice("abc", 2..3)` must keep
 * reporting `string`, never `string | nothing`, to evaluate to a string
 * VALUE. The positional `(value, start, end)` form always selects a window
 * and is left alone for the same reason. */
function sliceResultType(
  ops: ReadonlyArray<Expression>,
  operandTypes: ReadonlyArray<Type | undefined> | undefined
): Type | undefined {
  if (ops.length !== 2) return undefined;
  const spanType = operandTypes?.[1] ?? ops[1].type.type;
  if (!typeIsNothingOrAdmitsNothing(spanType)) return undefined;

  // Mirror the two families of arms in the signature: a string operand keeps
  // the string (`Slice` is kind-preserving), anything else yields a list of
  // the source's element type.
  const valueType = operandTypes?.[0] ?? ops[0].type.type;
  const base: Type = isSubtype(valueType, 'string')
    ? 'string'
    : { kind: 'list', elements: collectionElementType(valueType) ?? 'any' };
  return reduceType({ kind: 'union', types: [base, 'nothing'] });
}

/**
 * The result type of a variadic `Append(c, v₁, …, vₖ)`.
 *
 * The source contributes its ELEMENT type; each trailing operand contributes
 * its OWN type, because it becomes one element
 * (`docs/plans/2026-08-09-lazy-collection-evaluate-design.md`, Q2.1). The
 * binary handler used to be `joinResultType([ops[0]])`, which ignored the
 * appended value's type entirely — so `Append([1,2], "x")` claimed
 * `list<finite_integer>`. Folding the trailing types in fixes that, and makes
 * the flattened form agree with the nested one it replaces.
 *
 * The source contribution is computed HERE rather than deferred to
 * `joinResultType`, because that function applies `isAtomicJoinOperand`: a
 * tuple operand of `Join` is one element, but `Append` ENUMERATES its source
 * (`Append((1,2), 3)` has elements 1, 2, 3), so a tuple SOURCE must contribute
 * the union of its member types, not `tuple<…>`. A trailing tuple is still
 * atomic, so `Append([(1,2)], (3,4))` keeps `tuple<…>` as its element type.
 */
function appendResultType(ops: ReadonlyArray<Expression>): Type {
  if (ops.length === 0) return 'list';
  const source = ops[0].type.type;
  // A record/dictionary/set source: nothing to narrow, keep today's answer.
  if (isRecordShapedType(ops[0].type.type)) return 'record';
  if (ops[0].type.matches('dictionary<any>')) return 'dictionary';
  if (ops[0].type.matches('set<any>')) return 'set';
  // A source whose element type is unknown: fall back to the bare `list`
  // rather than narrowing to something the value may not satisfy.
  const elements = collectionElementType(source);
  if (elements === undefined) return 'list';
  if (ops.length === 1) return { kind: 'list', elements };
  return {
    kind: 'list',
    elements: widen(elements, ...ops.slice(1).map((op) => op.type.type)),
  };
}

function defaultCollectionEq(a: Expression, b: Expression) {
  // Compare two collections
  if (a.operator !== b.operator) {
    // `b` may be an unevaluated expression that evaluates to this literal
    // kind (`Map(…)`, `Join(…)`, `Filter(…)`, a symbol assigned a
    // collection…): decline so `eq()` in compare.ts can evaluate both sides,
    // re-consult, or fall back to its element-wise collection comparison. A
    // value whose type cannot be this kind is definitively unequal.
    const compatible =
      a.operator === 'Tuple'
        ? b.type.matches('tuple')
        : b.type.matches('indexed_collection<any>') && !isTupleShapedType(b.type.type);
    return compatible ? undefined : false;
  }
  if (!isFunction(a) || !isFunction(b)) return false;
  if (a.nops !== b.nops) return false;

  // Same operator, same arity: DECLINE (undefined) rather than deciding with
  // an exact `.isSame` element walk. `eq()` in compare.ts then runs its
  // element-wise collection comparison — tolerant (engine tolerance),
  // three-valued (symbolic elements → undefined), and NaN-aware (NaN ≠ NaN)
  // — the semantics `BoxedTensor.isEqual` provided before the tensor
  // representation unification (canonical-comparison #16 pins them; an
  // `isSame` walk is exact, two-valued, and treats identical NaN patterns as
  // equal).
  return undefined;
}

export function fromRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function sortedIndices(
  expr: Expression,
  fn: Expression | undefined = undefined
): number[] | undefined {
  const l = expr.count;
  if (l === undefined || !Number.isFinite(l) || l < 1) return undefined;

  const indices = Array.from({ length: l }, (_, i) => i + 1);

  const defaultCmp = (a: Expression, b: Expression) => {
    if (a.isLess(b)) return -1;
    if (a.isEqual(b)) return 0;
    return 1;
  };

  const f = fn ? applicable(fn) : undefined;

  // A unary function is used as a sort KEY: sort ascending by `f(x)` using
  // `compareKeys` (both comparison directions probed — the one-directional
  // `defaultCmp` treats an undetermined comparison as "greater"). Compute
  // each key once (decorate-sort-undecorate). A key that cannot be computed
  // or an undetermined key comparison makes the whole sort undetermined
  // (inert), matching `MaxBy`/`MinBy`/`ArgMax`/`ArgMin`. A binary function
  // is used as a comparator (historical behavior); a statically-unknown
  // arity (bare `function`) is also treated as a comparator, so nothing
  // existing changes meaning.
  if (f && fn && functionArity(fn.type.type) === 1) {
    const keys = new Map<number, Expression>();
    for (const i of indices) {
      const key = f([expr.at(i)!]);
      if (key === undefined) return undefined;
      keys.set(i, key);
    }
    // Array.prototype.sort is stable, so elements with equal keys keep their
    // original relative order (first-listed stays first).
    let undetermined = false;
    indices.sort((i, j) => {
      const c = compareKeys(keys.get(i)!, keys.get(j)!);
      if (c === undefined) {
        undetermined = true;
        return 0;
      }
      return c;
    });
    return undetermined ? undefined : indices;
  }

  const cmpFn = f
    ? (a: Expression, b: Expression) => {
        const r = f([a, b]);
        // A boolean comparator (Elixir-style): True means the first argument
        // sorts first. Previously a boolean result was silently treated as
        // "greater" (never negative, never zero), so e.g.
        // `Sort(xs, (a,b) -> a > b)` did not reorder at all.
        const s = sym(r);
        if (s === 'True') return -1;
        if (s === 'False') return 1;
        return r?.isNegative ? -1 : r?.isSame(0) ? 0 : 1;
      }
    : defaultCmp;

  indices.sort((i, j) => {
    const va = expr.at(i)!;
    const vb = expr.at(j)!;
    return cmpFn(va, vb);
  });

  return indices;
}

/** Compare two (already evaluated) key values with the default element
 * ordering. Returns -1, 0, 1, or `undefined` when the order is undetermined
 * (symbolic keys). `a.isLess(b)` being `false` is NOT the same as
 * `b.isLess(a)` being `true`, so both directions are probed. */
function compareKeys(a: Expression, b: Expression): -1 | 0 | 1 | undefined {
  if (a.isEqual(b) === true) return 0;
  if (a.isLess(b) === true) return -1;
  if (b.isLess(a) === true) return 1;
  return undefined;
}

/**
 * Canonicalize the Wolfram/Fungrim optimization form `ArgMax(f, domain)` /
 * `ArgMin(f, domain)`: first operand a function literal, second a domain (a
 * set, not an indexed collection). The engine keeps it inert, but the
 * function operand must go through `canonicalFunctionLiteral` so it gets the
 * canonical (Block-wrapped) body that the identities library's stored rule
 * patterns match. Returns `undefined` when `ops` is not the optimization form
 * (the caller then proceeds with the collection form).
 */
function canonicalOptimumForm(
  engine: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression | null | undefined {
  if (ops.length !== 2) return undefined;
  const [f, domain] = ops;
  if (!isFunction(f, 'Function')) return undefined;
  const d = domain.canonical;
  if (!d.type.matches('set<any>')) return undefined;
  const fn = canonicalCallbackOperand(f);
  if (!fn) return null;
  return engine._fn(operator, [fn, d]);
}

/** Shared driver for `MaxBy`/`MinBy`/`ArgMax`/`ArgMin`. Enumerates a finite
 * collection, computing the unary key `f(x)` (or the element itself when `f`
 * is absent) once per element, and tracks the extremum. First occurrence wins
 * ties. Yields per element for interruptibility. Returns the winning element
 * (or its 1-based index when `want === 'index'`), or `undefined` (inert) on an
 * empty collection or an undetermined key comparison. */
function* extremumBy(
  xs: Expression,
  f: ((xs: ReadonlyArray<Expression>) => Expression | undefined) | undefined,
  ce: ComputeEngine,
  mode: 'max' | 'min',
  want: 'element' | 'index'
): Generator<undefined, Expression | undefined, unknown> {
  let best: Expression | undefined = undefined;
  let bestKey: Expression | undefined = undefined;
  let index = 0;
  for (const item of xs.each()) {
    index += 1;
    const key = f ? f([item]) : item;
    if (key === undefined) return undefined;
    const winner = want === 'index' ? ce.number(index) : item;
    if (bestKey === undefined) {
      bestKey = key;
      best = winner;
      yield undefined;
      continue;
    }
    const cmp = compareKeys(bestKey, key);
    if (cmp === undefined) return undefined;
    const takeNew = mode === 'max' ? cmp === -1 : cmp === 1;
    if (takeNew) {
      bestKey = key;
      best = winner;
    }
    yield undefined;
  }
  return best;
}

/** Read the `[first, last]` bounds of a `Slice` span operand — the second
 * argument of the `(indexed_collection<T>, range)` arm.
 *
 * Returns `undefined` when the operand is NOT a span at all (a number, a
 * symbol bound to a number, a symbolic index): the caller then reads the
 * positional `(start, end)` arm. Returns `null` when the operand IS a
 * collection but its bounds cannot be resolved right now (unknown count, a
 * symbolic endpoint), so every facet declines rather than guessing.
 *
 * The bounds are validated at runtime even though the static `range` type
 * already promises them: the elements must be integers, `first ≥ 1`, and the
 * count must be exactly `last - first + 1` (contiguous, ascending, step 1).
 * A collection that fails the check — reachable only through a `range`
 * declaration whose value does not honor it, or a raw/structural
 * construction that skipped validation — resolves to `null`; it is never
 * reinterpreted as a descending or stepped window, which is precisely what
 * the `range` parameter type exists to rule out.
 *
 * A symbol whose value is a `Range` is read through the symbol's collection
 * facets (`count`/`at` delegate to the value), so `Slice(xs, r)` with
 * `r := 2..4` resolves without a separate dereference. */
function spanBounds(
  op: Expression | undefined
): [number, number] | null | undefined {
  if (op === undefined) return undefined;
  // An UNEVALUATED span. `Slice(xs, RangeOf(xs, needle))` reaches the facets
  // with its second operand still a `RangeOf` CALL, and an eager producer has
  // no collection handlers of its own, so there are no bounds to read from it
  // and the window never resolves — the node kept printing as a string while
  // evaluating to a lazy `Slice` view rather than a string VALUE. Evaluate it
  // once so the span behind it becomes readable. Gated on the operand being a
  // function expression whose type does not RULE OUT a span, so a numeric
  // `(start, end)` operand is never evaluated here (the positional arm reads
  // it through `integerParam`, which does its own resolution).
  if (
    isFunction(op) &&
    !op.isCollection &&
    !provablyDisjoint(op.type.type, 'range')
  )
    op = op.evaluate();
  // `Nothing` is an ABSENT span — what `RangeOf` answers when the needle does
  // not occur — and must never be read as an omitted argument. Falling through
  // to the positional `(start, end)` arm would default both bounds and answer
  // the WHOLE collection for a search that found nothing. A canonical
  // `Slice(xs, Nothing)` folds to `Nothing` outright, so this covers the
  // operand that only BECAME `Nothing` on the evaluation just above, plus any
  // structurally constructed node that skipped canonicalization; `null` — "is
  // a span, bounds unresolvable" — leaves every facet declining.
  if (isSymbol(op, 'Nothing')) return null;
  if (!op.isCollection) return undefined;
  const n = op.count;
  if (n === undefined || !Number.isFinite(n) || n < 1) return null;
  // Exact integers only: `toInteger` ROUNDS, and a rounded fractional bound
  // (`1.5..3.5` → `[2, 4]`) would pass the contiguity check below while
  // describing a different window than the collection's elements.
  const first = exactInteger(op.at(1));
  if (first === null || first < 1) return null;
  // EVERY position must hold `first + k`: checking only the endpoints and the
  // count would accept `[1, 100, 3]` (count 3, last − first + 1 = 3) as the
  // span `1..3`. A `Range` value is contiguous by construction, but the
  // operand can be any collection a `range` declaration admitted, and the
  // whole point of this check is to decline rather than reinterpret. `n` is
  // finite (checked above) and a span is as long as the window it selects,
  // so the walk costs no more than the slice itself.
  for (let k = 1; k < n; k++)
    if (exactInteger(op.at(k + 1)) !== first + k) return null;
  return [first, first + n - 1];
}

/** The value of an integer literal, or `null` for anything else (a
 * non-integer, a non-finite value, a symbol, an unsafe-range integer). */
function exactInteger(e: Expression | undefined): number | null {
  const n = toInteger(e);
  if (n === null) return null;
  return e !== undefined && isNumber(e) && e.isInteger === true ? n : null;
}

/** Resolve a `Slice` expression's normalized 1-based [start, end] window
 * against its source's count, so every facet (`count`/`isFinite`/`at`/
 * `iterator`) agrees. Negative indices count from the end of the source.
 *
 * Returns `undefined` (unresolvable — all facets decline) when the source
 * count is unknown, or when a negative START is applied to an infinite
 * source: "the last k elements" of an infinite collection do not exist.
 * A negative END over an infinite source resolves to `Infinity` — the
 * "through the end" reading — yielding an infinite tail whose `count` is
 * `Infinity` and whose iterator streams unboundedly. */
function sliceBounds(
  expr: Expression
): { start: number; end: number } | undefined {
  // Resolve ONCE per node. Every `Slice` facet reads these bounds, and `at()`
  // and the iterator read them per ELEMENT, while resolving them can be
  // arbitrarily expensive: `spanBounds` EVALUATES an unevaluated span operand,
  // so `Slice(xs, RangeOf(xs, needle))` re-ran the whole subsequence search on
  // every element access — quadratic in the slice length, and multiplied by
  // the needle length. Caching also makes the reads COHERENT: an impure span
  // would otherwise be re-drawn between two element reads of the same view,
  // and the window would shift mid-iteration.
  //
  // Keyed by `_worldVersion`, the same validity signal the collection-facet
  // memo in `boxed-expression/boxed-function.ts` uses: it moves on assume /
  // forget, redefinition and configuration changes — everything that can
  // change what the source collection or the span resolves to. That memo is
  // private to `BoxedFunction` and covers only the nullary `count`/`isEmpty`/
  // `isFinite` facets, so it is not reachable for this; a WeakMap keyed by the
  // node holds the entry for exactly as long as the node itself lives.
  const cached = SLICE_BOUNDS_MEMO.get(expr);
  if (cached !== undefined && cached.worldVersion === expr.engine._worldVersion)
    return cached.bounds;
  const bounds = computeSliceBounds(expr);
  SLICE_BOUNDS_MEMO.set(expr, {
    worldVersion: expr.engine._worldVersion,
    bounds,
  });
  return bounds;
}

const SLICE_BOUNDS_MEMO = new WeakMap<
  Expression,
  { worldVersion: number; bounds: { start: number; end: number } | undefined }
>();

/** The uncached body of `sliceBounds()`; call `sliceBounds()`, never this. */
function computeSliceBounds(
  expr: Expression
): { start: number; end: number } | undefined {
  if (!isFunction(expr)) return undefined;
  const count = expr.op1.count;
  if (count === undefined) return undefined;
  let startParam: number | undefined | null;
  let endParam: number | undefined | null;
  const span = spanBounds(expr.op2);
  if (span !== undefined) {
    // The `range` arm: `Slice(xs, r)` is `Slice(xs, First(r), Last(r))`.
    // Both bounds are ≥ 1 by the span's definition, so the negative-index
    // branches below never fire for this arm; the end still clamps to the
    // source count.
    if (span === null) return undefined;
    [startParam, endParam] = span;
  } else {
    startParam = integerParam(expr.op2);
    endParam = integerParam(expr.op3);
  }
  // A symbolic bound is indeterminate, not a default: every facet that reads
  // `sliceBounds` reports `undefined` when it returns `undefined`.
  if (startParam === null || endParam === null) return undefined;
  let start = startParam ?? 1;
  if (start < 1) {
    if (!Number.isFinite(count)) return undefined;
    start = count + 1 + start;
  }
  if (start < 1) start = 1;
  let end = endParam ?? count;
  if (end < 1) end = count + 1 + end;
  if (end < 1) end = 1;
  if (end > count) end = count;
  return { start, end };
}

/**
 *
 * Flatten an array of BoxedExpressions (possibly lazy collections),
 * handling Sequence and Nothing
 *
 */

function enlist(xs: ReadonlyArray<Expression>): Expression[] {
  if (xs.length === 0) return [];

  const result: Expression[] = [];
  // let s: string | undefined = undefined;
  for (const x of xs) {
    if (sym(x) === 'Nothing') continue;

    // if (isString(x)) {
    //   if (s === undefined) s = '';
    //   s += x.string;
    //   continue;
    // }

    // if (s !== undefined) {
    //   result.push(ce.string(s));
    //   s = undefined;
    // }

    if (isFunction(x, 'Sequence')) {
      result.push(...enlist([...x.ops]));
    } else if (isString(x)) {
      // A string is a collection (of strings), but we don't want to iterate it recursively
      // if (s === undefined) s = '';
      // s += x.string;
      result.push(x);
    } else if (x.isLazyCollection && x.isFiniteCollection === true) {
      // Only flatten and materialize finite lazy sub-collections (e.g. a
      // `Range`). Eager literals (a `Tuple`, a nested `List`) are structural
      // elements and must be preserved as-is; an infinite lazy child (e.g. a
      // `Cycle`) is kept as an element rather than spread (which would burn
      // the evaluation deadline).
      result.push(...enlist([...x.each()]));
    } else {
      result.push(x);
    }
  }

  // if (s !== undefined) result.push(ce.string(s));

  return result;
}

/** Is `op` an already fully-evaluated literal element for the requested
 * evaluation mode? Used by the `List` fast path to avoid rebuilding a
 * collection literal whose elements need no further evaluation.
 *
 * A string is always fully evaluated. A number literal is fully evaluated
 * under `evaluate()`; under `.N()` (numericApproximation) only an inexact
 * (float) number is — an exact number (integer aside) may still numericize.
 * Symbols and function expressions are never treated as fully evaluated (they
 * may be bound or reducible). */
function isEvaluatedElement(
  op: Expression,
  numericApproximation: boolean
): boolean {
  if (isString(op)) return true;
  if (isNumber(op)) return !numericApproximation || !op.isExact;
  return false;
}

function takeIterator(expr: Expression): Iterator<Expression> {
  if (!isFunction(expr))
    return { next: () => ({ value: undefined, done: true }) };
  // Number of elements to take. A symbolic bound has no indeterminate
  // channel here (an iterator either yields or does not), so it yields
  // nothing — the count/at facets report `undefined`, which is what keeps
  // the expression from materializing at all.
  const bound = integerParam(expr.op2);
  if (bound === null) return { next: () => ({ value: undefined, done: true }) };
  const count = Math.max(0, bound ?? 0);

  if (count === 0) return { next: () => ({ value: undefined, done: true }) };

  let index = 1;
  let n = 0;

  return {
    next: () => {
      if (n >= Math.abs(count)) return { value: undefined, done: true };
      const value = expr.op1.at(index);
      if (!value) return { value: undefined, done: true };
      index += 1;
      n += 1;
      return { value, done: false };
    },
  };
}

function takeCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const [xs, op2] = expr.ops;
  const count = xs.count;
  if (count === undefined) return undefined;
  const bound = integerParam(op2);
  if (bound === null) return undefined; // symbolic bound
  const n = Math.max(0, bound ?? 0);
  if (!Number.isFinite(n)) return Infinity;
  return Math.min(count, n);
}

/**
 * The integer dimensions of a `Fill`'s shape tuple, or `null` if any of them
 * is present but does not resolve to an integer.
 *
 * An unresolvable dimension used to read as `0`, so `Fill(f, (n, 3))`
 * answered the empty matrix and `Fill(f, (2, n))` answered two empty rows —
 * the same silent-substitution class as `Take(xs, n)` → `[]`. Every facet
 * bails together on `null`; see {@link integerParam}.
 */
function fillDims(shape: Expression): number[] | null {
  if (!isFunction(shape)) return null;
  const dims: number[] = [];
  for (const op of shape.ops) {
    const d = integerParam(op);
    if (d === null) return null;
    dims.push(d ?? 0);
  }
  return dims;
}

/**
 * The heads a `Table` iterator spec can wear. The brace spelling
 * `{i, lo, hi}` parses as a `Set`, the paren spelling `(i, lo, hi)` as a
 * `Tuple` (or one of its arity-named aliases).
 *
 * Deliberately NARROWER than `canonicalIndexingSet`'s head set: that one also
 * accepts `Pair` and `Single`, for which it has degenerate `Limits` meanings.
 * `Table` has none — its iterator spec needs 3 or 4 operands, which a `Pair`
 * (always 2) or a `Single` (always 1) can never have. Listing them here would
 * only turn a `Pair`-shaped second operand from a clear `Tabulate` type error
 * into a silently inert `Table`.
 *
 * This is a *positional* reinterpretation: it applies only in `Table`'s
 * iterator slot. The operand is held (raw), so its index symbol has not been
 * canonicalized (`i` has not folded to the imaginary unit) and a `Set`'s
 * operands have not been sorted or de-duplicated.
 */
const TABLE_ITERATOR_SPEC_OPERATORS = new Set(['Set', 'Tuple', 'Triple']);

function isIteratorSpecShape(
  expr: Expression | undefined
): expr is Expression & FunctionInterface {
  return isFunction(expr) && TABLE_ITERATOR_SPEC_OPERATORS.has(expr.operator);
}

/** The integer dimensions of a `Tabulate`, or `null` if any is missing,
 * non-integer, or non-positive. `Tabulate(fn)` (no dimensions) returns `[]`. */
function tabulateDims(expr: Expression): number[] | null {
  if (!isFunction(expr)) return null;
  const dims = expr.ops.slice(1).map((op) => toIntegerOperand(op));
  if (dims.some((d) => d === null || d <= 0)) return null;
  return dims as number[];
}

/** Element count of a `Tabulate` = its OUTER dimension (no enumeration).
 * `Tabulate(fn)` with no dimensions is the empty list (count 0). */
function tabulateCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  if (expr.ops.length <= 1) return 0;
  const dims = tabulateDims(expr);
  if (dims === null) return undefined;
  return dims[0];
}

/** The element at 1-based outer index `outerIndex` of a `Tabulate`. For a 1-D
 * tabulation this is `fn(outerIndex)`; for higher rank it is the nested sub-
 * array over the remaining dimensions (built on demand). */
function tabulateElement(
  ce: ComputeEngine,
  fn: (args: Expression[]) => Expression | undefined | null,
  dims: number[],
  outerIndex: number
): Expression {
  // A tabulating function that produced no value is a computation failure:
  // keep the position with the `Missing` marker rather than erase it.
  if (dims.length === 1) return fn([ce.number(outerIndex)]) ?? ce.Missing;

  const fillArray = (index: number[], level: number): ExpressionInput => {
    if (level === dims.length)
      return fn(index.map((v) => ce.number(v))) ?? ce.Missing;
    const arr: ['List', ...ExpressionInput[]] = ['List'];
    for (let j = 1; j <= dims[level]; j++) {
      index[level] = j;
      arr.push(fillArray(index, level + 1));
    }
    return arr;
  };
  const index = Array(dims.length).fill(0);
  index[0] = outerIndex;
  return ce.expr(fillArray(index, 1));
}

function tabulateAt(
  expr: Expression,
  index: number | string
): Expression | undefined {
  if (typeof index !== 'number' || !Number.isInteger(index) || index === 0)
    return undefined;
  if (!isFunction(expr)) return undefined;
  const dims = tabulateDims(expr);
  if (dims === null || dims.length === 0) return undefined;
  const fn = applicable(expr.op1);
  if (!fn) return undefined;
  let i = index;
  if (i < 0) i = dims[0] + i + 1;
  if (i < 1 || i > dims[0]) return undefined;
  return tabulateElement(expr.engine, fn, dims, i);
}

function* tabulateIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const dims = tabulateDims(expr);
  if (dims === null || dims.length === 0) return;
  const fn = applicable(expr.op1);
  if (!fn) return;
  const ce = expr.engine;
  for (let i = 1; i <= dims[0]; i++) yield tabulateElement(ce, fn, dims, i);
}

// The length of an element-wise combination of collections (Zip, and the
// multi-collection `Map`): the shortest input bounds the result, so `undefined`
// as soon as any count is unknown, `Infinity` only if all are infinite, and
// otherwise the minimum — a finite source bounds an infinite one
// (`Math.min` handles `Infinity` operands directly).
function minCount(
  counts: ReadonlyArray<number | undefined>
): number | undefined {
  if (counts.some((c) => c === undefined)) return undefined;
  if (counts.length === 0) return 0;
  return Math.min(...(counts as number[]));
}

function zipCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  return minCount(expr.ops.map((x) => x.count));
}

/**
 * The emptiness of one source operand, with an evaluation-free fallback to its
 * element COUNT.
 *
 * The `isEmptyCollection` getter short-circuits to `undefined` whenever
 * `isCollection` is false, which includes an EAGER collection operator that
 * only becomes a concrete collection once evaluated — `At(xs, I)` with a
 * gather index is typed `list<number>` and iterates fine, but is not itself a
 * collection until evaluated. Such an operand can still state its length
 * through the `elementCount` tier of `count`, and a known length settles
 * emptiness outright.
 *
 * Without this, one gather member left the whole `Zip`'s emptiness UNKNOWN,
 * and `materialize()` returns the lazy form unchanged when emptiness is
 * indeterminate — so `Map(f, Zip(At(xs, I), ys))` stayed symbolic instead of
 * producing its elements, even though every member iterated (Tycho item 184).
 */
function isEmptySource(x: Expression): boolean | undefined {
  const empty = x.isEmptyCollection;
  if (empty !== undefined) return empty;
  const n = x.count;
  // `Infinity` correctly answers `false` here — an unbounded source is not
  // empty. Only a genuinely unknown count leaves the verdict open.
  return typeof n === 'number' ? n === 0 : undefined;
}

/**
 * Do these `Range` operands PROVE the value is an index span — the `range`
 * type: a contiguous, ascending, step-1 run of valid 1-based collection
 * indices?
 *
 * Operands are `[lower, upper?, step?]`, with the one-operand form meaning
 * `Range(n) = 1..n`. The qualification, per `docs/STRING_ROADMAP.md`
 * ("The `range` type"):
 *
 * - every present operand is an integer LITERAL with a readable value. Note
 *   `toInteger` alone is NOT that test: it ROUNDS (`Math.round`), so it maps
 *   the `Range(0.5, 2.5)` bounds — a sequence of halves, not indices — onto
 *   `1..3`. Hence the `isInteger` type check first, which is false for a
 *   non-integer literal. A symbolic `Range(a, b)` never qualifies either:
 *   `isInteger` may hold for a declared-integer symbol, but `toInteger`
 *   returns `null` for it. Assumption-based narrowing is deliberately out of
 *   scope; its absence is never unsound, since the result merely types wider;
 * - the step, if present, is exactly 1 (a stepped range is a GATHER, and
 *   gathering is `At(xs, r)`, not a span);
 * - `lower >= 1` — index 1 is the first element, so 0 and negatives are not
 *   index spans;
 * - `lower <= upper` — ascending. A descending `Range(6, 5)` is the pair
 *   `[6, 5]`, a real value with a real meaning, and not a span.
 *
 * Finiteness falls out: `toInteger` rejects a non-finite operand, so
 * `Range(1, oo)` does not qualify.
 *
 * There is deliberately no EMPTY index span: `Range(1, 0)` already means the
 * descending pair `[1, 0]`, so an empty span has no spelling, and operations
 * that can empty a range report `list` instead of `range`.
 */
function isIndexSpan(ops: ReadonlyArray<Expression>): boolean {
  if (ops.length === 0 || ops.length > 3) return false;

  // An exact, finite integer LITERAL, or `null`. See the note above on why
  // `toInteger` is guarded by `isInteger` rather than used bare.
  const literal = (op: Expression | undefined): number | null =>
    op?.isInteger === true ? toInteger(op) : null;

  if (ops.length === 3 && literal(ops[2]) !== 1) return false;

  // `Range(n)` is `1..n`; `Range(lo, hi)` and `Range(lo, hi, 1)` are explicit.
  const lower = ops.length === 1 ? 1 : literal(ops[0]);
  const upper = ops.length === 1 ? literal(ops[0]) : literal(ops[1]);
  if (lower === null || upper === null) return false;

  return lower >= 1 && lower <= upper;
}
