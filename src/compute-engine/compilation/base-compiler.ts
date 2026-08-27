import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import {
  isOperatorDef,
  isValueDef,
  collectBinderNames,
} from '../boxed-expression/utils.js';
import {
  broadcastableParamSlots,
  declaresBroadcastableParam,
  paramsAreScalar,
  type BroadcastSlotPlan,
} from '../boxed-expression/boxed-function.js';
import { lookupApplicable } from '../function-utils.js';
import {
  isFiniteIndexedCollection,
  isNumericTuple,
  isPointListValue,
  isPossiblyCollectionTyped,
  isTuple,
} from '../collection-utils.js';
import {
  collectionElementType,
  isNonRealNumber,
  resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
  widen,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { parseType } from '../../common/type/parse.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import type { Type, TypeReference } from '../../common/type/types.js';
import { declarationOf } from '../../common/type/reference.js';
import {
  isInequalityOperator,
  isRelationalOperator,
} from '../latex-syntax/utils.js';
import { normalizeIndexingSet } from '../library/utils.js';
import {
  isSymbol,
  isNumber,
  isString,
  isCharacter,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { isTensorValue } from '../boxed-expression/tensor-view.js';
import {
  functionLiteralBoundNames,
  functionLiteralParameterName,
  functionLiteralParameterType,
  isDestructuringParameter,
} from '../boxed-expression/function-literal.js';
import { tuplePatternNames } from '../boxed-expression/tuple-pattern.js';
import { multiClauseState } from '../multi-clause.js';
import type { FunctionClause } from '../multi-clause.js';
import {
  isProtocolDispatcher,
  protocolDispatchCandidates,
  protocolOfSymbol,
} from '../engine-protocols.js';
import { planProtocolDispatch } from './protocol-dispatch.js';
import type { ReceiverGuard } from './protocol-dispatch.js';
import { isMoreSpecific } from '../boxed-expression/overload.js';
import { containsDerivativeHead, rewriteAngularUnit } from './angular-unit.js';
import {
  isWildcard,
  wildcardName,
  wildcardType,
} from '../boxed-expression/pattern-utils.js';
import { sumVariantInfo, taggedSumInType } from '../sum-representation.js';
import type { SumBucket } from '../sum-representation.js';
import {
  buildCaseClosure,
  getMatchPlan,
  matchPatternReferences,
} from '../boxed-expression/match-dispatch.js';
import type {
  CompiledCase,
  LeafTest,
  Segment,
  ShapeNode,
  ElementPlan,
} from '../boxed-expression/match-dispatch.js';

import type {
  CompileDiagnostic,
  CompileMode,
  CompileTarget,
  CompilationResult,
  CompiledFunction,
  CompiledRunner,
  ComplexResult,
  CseRegionInstance,
  NamingContext,
  OperandCompiler,
  TargetSource,
} from './types.js';
import { CompileDeclineError, LaneMismatchError } from './diagnostics.js';
import {
  candidateAt,
  childRegionAt,
  harvestCse,
  isCallerMapped,
  isCseAdmissible,
  lazyOperandRegions,
} from './cse.js';
import type { CseHarvest, CseHarvestOptions, CseRegion } from './cse.js';
import {
  builtinCallbackArity,
  isRefusableBuiltinCallback,
} from './builtin-callback.js';

/**
 * A `_tv`/`_cse`-prefixed identifier token, as it appears inside a
 * caller-supplied source string. The lookbehind keeps it from matching the
 * tail of a longer identifier (`a_tv1`).
 */
const GENERATED_NAME_RE = /(?<![\p{L}\p{N}_])_(?:tv|cse)[\p{L}\p{N}_]*/gu;

/**
 * Time budget (ms) for evaluating one constant subtree at compile time
 * (`tryConstantFold`). Typical folds complete in microseconds; the budget
 * exists so a pathological constant (a `Sum` over millions of terms, a
 * slow-converging quadrature) degrades to structural compilation instead of
 * stalling the compile. Armed through `withTimeLimit`, which nests as
 * `min()` — an already-armed tighter ambient deadline still governs.
 */
const CONSTANT_FOLD_BUDGET_MS = 2000;

/**
 * The maximum estimated work a subtree may cost before the fold declines
 * (`foldCostEstimate`). This is the eligibility decision, and it is a property
 * of the EXPRESSION alone, so the same input always compiles to the same
 * output.
 *
 * A deterministic work estimate decides eligibility because bignum folding and
 * double-based structural lowering can differ in their last digits. A
 * wall-clock cutoff would make the chosen result depend on machine load.
 */
const CONSTANT_FOLD_MAX_COST = 200_000;

/**
 * How deep `foldCostEstimate` walks before giving up and declining.
 *
 * The estimator exists to keep the fold cheap, so it must not become the
 * expense it guards against: without a depth bound, a deeply nested tree costs
 * a full walk on every node the top-down fold visits, which is quadratic in
 * depth. A tree deeper than this is also very unlikely to be a constant worth
 * folding. Exceeding it yields an infinite estimate — the same "decline" the
 * cost ceiling produces, so there is one failure mode rather than two.
 */
const CONSTANT_FOLD_MAX_DEPTH = 48;

/**
 * How many nodes `foldCostEstimate` may visit before declining.
 *
 * The depth bound does not constrain a wide call graph, whose analysis can grow
 * exponentially while remaining shallow. This limit keeps the estimator's own
 * work finite before the evaluation deadline is armed.
 */
const CONSTANT_FOLD_MAX_VISITS = 20_000;

/**
 * `foldCostEstimate`'s working state for one estimate.
 *
 * `cache` is a real memo of settled per-function costs, so a function called
 * from many places is analyzed once. `inProgress` is the separate
 * cycle guard — a name currently being expanded is recursive and has no
 * static bound. They must stay distinct: collapsing them into one set is what
 * turned the memo into a cycle guard and made the estimator exponential.
 */
type FoldCostContext = {
  readonly cache: Map<string, number>;
  readonly inProgress: Set<string>;
  visits: number;
};

/**
 * Cap on `engine.maxCollectionSize` while a constant fold evaluates. It bounds
 * the memory a compile-time evaluation can commit to materializing a lazy
 * collection, complementing the time budget above. Matches the engine's
 * default (10 000), so it only bites when the caller raised the engine cap
 * for run-time evaluation — that intent should not implicitly license
 * compile-time materialization of the same magnitude. An oversized
 * collection stays lazy under the cap (never truncated), so a clamped
 * evaluation yields a correct value or a non-literal — never a wrong fold.
 */
const CONSTANT_FOLD_MAX_COLLECTION_SIZE = 10_000;

/** The integral operators excluded from constant folding when the caller
 * requested the stochastic Monte-Carlo quadrature (see `tryConstantFold`). */
const MONTE_CARLO_FOLD_EXCLUSIONS: ReadonlySet<string> = new Set([
  'Integrate',
  'NIntegrate',
]);

/**
 * Cap on the element count of a constant collection folded to a literal list
 * (`tryConstantFold`). A larger constant collection compiles structurally,
 * rather than emitting a large literal.
 *
 * The maximum is inclusive. The default of 49 matches JavaScript `Range`,
 * whose structural handler inlines when `len < 50`.
 *
 * This is the default only. It is a source-size trade-off for
 * the JavaScript and Python targets, where both emissions exist and both
 * compile. On the shader targets a dynamic collection has no lowering at
 * all, so for a constant one the inline literal is the only emission that can
 * compile and the number is a capability limit instead — they raise it via
 * `CompileTarget.maxInlineElements` to the same 256 their own `Range` handler
 * already inlines to, so one limit governs both paths rather than a fold cap
 * refusing what the `Range` handler would have accepted.
 */
const CONSTANT_FOLD_MAX_INLINE_ELEMENTS = 49;

/** Accumulate every symbol name of `expr` into `names`. One walk by node
 * object (a shared subtree is visited once — the set is a union either way). */
function collectSymbolNames(
  expr: Expression,
  names: Set<string>,
  seen: Set<Expression>
): void {
  if (seen.has(expr)) return;
  seen.add(expr);
  if (isSymbol(expr)) {
    names.add(expr.symbol);
    return;
  }
  if (isDictionary(expr)) {
    for (const v of expr.values) collectSymbolNames(v, names, seen);
    return;
  }
  if (isFunction(expr)) {
    names.add(expr.operator);
    for (const op of expr.ops) collectSymbolNames(op, names, seen);
  }
}

/**
 * The collision inventory of a compilation (`NamingContext.usedNames`): every
 * symbol name reachable in `expr`, plus every `_tv`/`_cse` token appearing in
 * the caller-supplied source strings spliced into the emitted code.
 */
function collectUsedNames(
  expr: Expression | ReadonlyArray<Expression | undefined> | undefined,
  sources?: ReadonlyArray<string | undefined>,
  extra?: ReadonlyArray<string>
): Set<string> {
  const names = new Set<string>();
  const seen = new Set<Expression>();
  if (Array.isArray(expr)) {
    for (const e of expr)
      if (e !== undefined) collectSymbolNames(e, names, seen);
  } else if (expr !== undefined)
    collectSymbolNames(expr as Expression, names, seen);
  if (extra) for (const n of extra) names.add(n);
  if (sources) {
    for (const src of sources) {
      if (typeof src !== 'string' || src.length === 0) continue;
      for (const m of src.matchAll(GENERATED_NAME_RE)) names.add(m[0]);
    }
  }
  return names;
}

/**
 * The type used to answer compile-time representation questions about `expr`.
 * A `reference` type — a `type alias`
 * or a nominal `type` — unfolds to its definition, because compilation is type
 * erasure and the tag carries no layout. Identity for every other type.
 *
 * Exported for the compile targets, which ask the same layout questions
 * (`gpuType` in gpu-target.ts).
 */
export function compilationType(expr: Expression): Type {
  return resolveTypeForCompilation(expr.type.type);
}

/**
 * True when `a` is provably string-valued: a string literal, or an operand
 * whose (alias-resolved) static type is a subtype of `string`.
 *
 * Deliberately `isSubtype`, NOT `.matches('string')`: `matches` is the
 * "could be" direction, so an `unknown`-typed symbol would answer true and
 * gate a numeric plot equality such as `x^2 + y^2 = 4`, whose inferred
 * parameters must stay on the numeric fast path with byte-identical output.
 * Only positive string evidence gates. `never` is a subtype of every type and
 * so is not evidence either.
 *
 * Shared by BaseCompiler's infix-ordering divert (which falls through to the
 * JS ordering codegen on a mixed string operand) and javascript-target's
 * fail-closed string gates (`assertNoStringOperand`,
 * `isMixedStringOrdering`) — their agreement is load-bearing.
 */
export function isProvablyStringOperand(x: Expression): boolean {
  if (isString(x)) return true;
  const t = resolveTypeForCompilation(x.type.type);
  return t !== 'never' && isSubtype(t, 'string');
}

/**
 * True when `x` is provably a character: a character value, or an operand whose
 * (alias-resolved) static type is a subtype of `character`.
 *
 * `character` and `string` are disjoint siblings in the type lattice (neither is
 * a subtype of the other), so `isProvablyStringOperand` never answers true for a
 * character and every character-specific lowering has to ask this question
 * separately. Same `isSubtype`-not-`.matches` discipline as the string
 * predicate: only positive evidence gates, so an `unknown`-typed operand is
 * never treated as a character.
 *
 * A character lowers to a one-cluster target string, so it compares by value
 * with `===` — but not with `<`, which on JavaScript strings compares UTF-16
 * code units while the interpreter orders characters by their NFC code-point
 * sequence (`compare.ts`).
 */
export function isProvablyCharacterOperand(x: Expression): boolean {
  if (isCharacter(x)) return true;
  const t = resolveTypeForCompilation(x.type.type);
  return t !== 'never' && isSubtype(t, 'character');
}

/**
 * True when a type admits every basic sort: string, number, boolean, and an
 * indexed collection. Such a type supplies no useful string evidence.
 *
 * `unknown` has never been string evidence (see `isProvablyStringOperand`), and
 * this extends the same reading to a top type spelled as a union. `At`'s index
 * slot is
 * `boolean | indexed_collection | number | string` (a gather index may itself
 * be a collection or a dictionary key), so indexing with a local —
 * `cs[j]` — types `j` with that union, and the numeric operators never narrow
 * it back, because an operand that could be a collection is skipped by the
 * threadable-operator inference (`validate.ts`, Tycho item 121). A plain
 * `while j <= Length(cs)` next to such an index then declined as a "mixed
 * string ordering" although neither operand is remotely a string — a whole
 * ordinary scanner loops, even though neither operand was a string.
 *
 * Requiring all three scalar sorts and a collection arm keeps narrower mixed
 * unions such as `number | string` or `string | list<string>` on the
 * fail-closed path because they represent a real run-time string possibility.
 *
 * A hand-written `boolean | indexed_collection | number | string` is also
 * exempt because it is indistinguishable from the inferred top-like shape.
 */
function carriesNoSortEvidence(t: Type): boolean {
  return (
    isSubtype('string', t) &&
    isSubtype('number', t) &&
    isSubtype('boolean', t) &&
    isSubtype('indexed_collection', t)
  );
}

/**
 * True when any leaf type reachable from `t` is provably string: `t` itself,
 * the element type of a collection (recursively — `list<list<string>>` carries
 * evidence), or a member of a union (`list<string | number>` carries evidence
 * even though the widened element type is not wholly string).
 *
 * Only positive evidence counts, exactly as in `isProvablyStringOperand`:
 * `unknown`/`any` is not evidence (`collectionElementType` reports `any` for a
 * bare `list`, and it must not gate numeric plot shapes), and neither is
 * `never` — the element type of the empty literal `[]`.
 *
 * A `dictionary` or `record` is walked through its value types only. Its
 * synthesized string key is metadata, not a value compared by these operators;
 * aggregate fidelity is checked separately by `unfaithfulComparisonAggregate`.
 *
 * The walk has no depth cutoff because returning `false` admits compilation.
 * Termination is structural, plus a cycle guard for the non-structural step: a
 * `reference` unfolds to its definition, so a recursive alias
 * (`type json = list<json> | integer`) would descend forever. The guard is the
 * repo's standard one for a `.def`-following walker — remember the reference
 * DECLARATION records (`declarationOf`, stable per name and unaffected by the
 * re-application a parameterized unfold rebuilds) along the CURRENT PATH, and
 * stop on a repeat. The set is copied on descent so a reference visited in one
 * branch cannot suppress evidence in a sibling, and is allocated only once a
 * reference is actually met — the numeric fast path allocates nothing.
 */
function typeHasStringEvidence(
  t: Type,
  visited?: ReadonlySet<TypeReference>
): boolean {
  if (typeof t === 'object' && t.kind === 'reference' && t.def !== undefined) {
    const decl = declarationOf(t);
    if (visited?.has(decl)) return false;
    visited = new Set(visited).add(decl);
  }
  const r = resolveTypeForCompilation(t);
  if (r === 'never') return false;
  if (carriesNoSortEvidence(r)) return false;
  if (isSubtype(r, 'string')) return true;
  if (typeof r !== 'string') {
    // A union member that is provably string is evidence even when its siblings
    // are not: the run-time value could be that member.
    if (r.kind === 'union')
      return r.types.some((x) => typeHasStringEvidence(x, visited));
    // The keyed aggregates: their VALUES, never the synthesized string key.
    if (r.kind === 'dictionary')
      return typeHasStringEvidence(r.values, visited);
    if (r.kind === 'record')
      return Object.values(r.elements).some((x) =>
        typeHasStringEvidence(x, visited)
      );
  }
  const elt = collectionElementType(r);
  if (elt === undefined) return false;
  return typeHasStringEvidence(elt, visited);
}

/**
 * The aggregate kinds whose whole-value comparison neither the `_SYS.eq`/
 * `_SYS.neq` tolerance kernel nor `_SYS.bcast` can reproduce faithfully —
 * returned by name for the diagnostic, or `null` when the participant is
 * comparable. See `assertComparableAggregate` (javascript-target.ts) for the
 * evidence.
 *
 * Keyed collections (`dictionary`, `record`) have no positional JS-array
 * lowering, and a heterogeneous fixed-arity `tuple` binds atomically in
 * the interpreter while both kernels treat its JS array as a collection to map
 * over. A union member counts: the run-time value could BE it.
 *
 * The two kinds are searched to different depths:
 *
 *  - a keyed aggregate counts at any depth (`list<dictionary<integer>>` too);
 *  - a `tuple` counts only as the participant itself (through unions). A tuple
 *    nested in an indexed collection is the point-list lowering
 *    (`list<tuple<number, number>>`), which compiles today and must keep
 *    compiling; whether the whole-list comparison of one agrees with
 *    interpretation is a separate, unverified question, not this gate's.
 */
export function unfaithfulComparisonAggregate(
  x: Expression
): 'dictionary' | 'record' | 'tuple' | null {
  // Same cycle guard as `typeHasStringEvidence` — a recursive alias
  // (`type json = … | dictionary<json>`) is reached again through its own body.
  const walk = (
    t: Type,
    top: boolean,
    visited?: ReadonlySet<TypeReference>
  ): 'dictionary' | 'record' | 'tuple' | null => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return null;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (typeof r === 'string') {
      if (r === 'dictionary' || r === 'record') return r;
      return top && r === 'tuple' ? r : null;
    }
    if (r.kind === 'dictionary' || r.kind === 'record') return r.kind;
    if (r.kind === 'tuple') return top ? 'tuple' : null;
    // A union stays at the SAME level: each member is an alternative value of
    // this participant, not an element of it.
    if (r.kind === 'union') {
      for (const m of r.types) {
        const found = walk(m, top, visited);
        if (found !== null) return found;
      }
      return null;
    }
    const elt = collectionElementType(r);
    if (elt === undefined) return null;
    return walk(elt, false, visited);
  };
  return walk(x.type.type, true);
}

/**
 * True when a comparison PARTICIPANT is provably tuple-typed — a `Tuple`
 * literal, or a symbol/application whose static type is a tuple (through a
 * union only when EVERY member is one).
 *
 * This is the ADMISSION side of the aggregate gate's tuple case, and it exists
 * for the EQUALITY family alone (see `compileJSEquality`): tuple-vs-tuple
 * `Equal`/`NotEqual` lowers to `_SYS.eq`/`_SYS.neq`, whose array-vs-array
 * branch is whole-value equality — the same answer the interpreter's atomic
 * point comparison gives, at equal AND unequal arity (a length mismatch is
 * `false`, and the interpreter answers `False` too). It was verified faithful
 * before `unfaithfulComparisonAggregate` existed, and the gate declining it was
 * over-broad; point equality (`p == q` over `tuple<number, number>`) is the
 * realistic consumer.
 *
 * Deliberately narrower than "not `unfaithfulComparisonAggregate`":
 *  - EVERY participant must qualify, so the mixed shapes the gate was written
 *    for keep declining — `Equal(Tuple(1,2), 1)` ran element-wise to
 *    `[true, false]` and `Equal(Tuple(1,2), List(1,2))` to `true`, where the
 *    interpreter answers `False` to both;
 *  - a union member that is NOT a tuple disqualifies: the run-time value could
 *    be the shape the kernel gets wrong;
 *  - the ORDERINGS never consult it. `Less(Tuple, Tuple)` was declining before
 *    this gate existed (the interpreter leaves it inert) and stays closed.
 */
/**
 * True when a comparison participant is provably a collection that is NOT a
 * tuple — a `list`, `set` or `range` kind, every union member included. A
 * bare `tuple`, a structural `tuple<…>`, a `collection`/`indexed_collection`
 * (which a tuple inhabits), a string (a collection of clusters in the
 * lattice, but compared as text), a scalar or an unknown all answer `false`.
 *
 * The other half of the list-vs-point fold in `compileJSEquality`: a list and
 * a point are never equal in the interpreter (`Equal([1,0], Tuple(1,0))` is
 * `False`, and a point binds atomically), so an equality whose one side is
 * provably a point and whose other side is provably a non-tuple collection is
 * a constant, whatever the values (Tycho item 215).
 */
export function isProvablyNonTupleCollectionParticipant(
  x: Expression
): boolean {
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    // Only the kinds a tuple can NEVER inhabit. A tuple IS a subtype of
    // `collection` and `indexed_collection` (`subtype.ts`: every component a
    // subtype of the element type), so a symbol declared
    // `indexed_collection<number>` may be bound to a point, and folding it
    // against a point would answer `false` where the interpreter answers
    // `True`. Those kinds keep declining through the aggregate gate.
    if (typeof r === 'string')
      return r === 'list' || r === 'set' || r === 'range';
    if (r.kind === 'union') return r.types.every((m) => walk(m, visited));
    return r.kind === 'list' || r.kind === 'set';
  };
  return walk(x.type.type);
}

export function isProvablyTupleParticipant(x: Expression): boolean {
  // Same cycle guard as `unfaithfulComparisonAggregate` — but note `false` is
  // the DECLINING direction here, so stopping on a repeat is conservative.
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (typeof r === 'string') return r === 'tuple';
    if (r.kind === 'tuple') return true;
    if (r.kind === 'union') return r.types.every((m) => walk(m, visited));
    return false;
  };
  return walk(x.type.type);
}

/**
 * True when EVERY component of a provably-tuple participant is provably
 * NUMERIC, recursing into nested tuple components (a point of points qualifies)
 * and requiring every member of a union to qualify.
 *
 * The other half of the ADMISSION side of the tuple-equality carve-out, paired
 * with `isProvablyTupleParticipant` — see `compileJSEquality` and
 * `compilePythonEquality`. Tuple-ness alone is not enough on EITHER target,
 * because the element leaf of the whole-value comparison is numeric and coerces
 * a boolean: `_SYS.eq`'s tolerance test makes `Math.abs(true - 1)` zero, and
 * Python's `==` makes `True == 1` true, so `Equal(Tuple(True, 2), Tuple(1, 2))`
 * answered `True` where the interpreter answers `False`. Anything but a provable
 * number — a boolean, a string, `unknown`, a union with a non-numeric member, or
 * a bare `tuple` with no component information at all — disqualifies, and the
 * aggregate gate then declines the head (fail closed).
 */
export function isNumericTupleParticipant(x: Expression): boolean {
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    // A bare `tuple` carries no component information: nothing to prove numeric.
    if (r === 'tuple' || r === 'never') return false;
    if (typeof r !== 'string') {
      if (r.kind === 'tuple')
        return r.elements.every((e) => walk(e.type, visited));
      if (r.kind === 'union') return r.types.every((m) => walk(m, visited));
    }
    return isSubtype(r, 'number');
  };
  return walk(x.type.type);
}

/**
 * String evidence for a COMPARISON PARTICIPANT — the value the scalar
 * comparison actually compares, which for a broadcast source is its ELEMENT,
 * not the array.
 *
 * `isProvablyStringOperand` alone is blind to this: `_SYS.bcast` hands ELEMENTS
 * to the scalar closure, and `_SYS.eq`/`_SYS.neq` compare a list against a
 * scalar element-wise, so a `list<string>` operand puts strings on the numeric
 * comparison path even though the operand's own type is not a subtype of
 * `string`. That blind spot is what let `Less("a", [1, 2])` compile to
 * `[false, false]` and `Equal(["a"], ["a"])` to `false`.
 *
 * The walk is RECURSIVE over the type structure (`typeHasStringEvidence`),
 * because the numeric lowerings reach nested and mixed elements just as
 * silently: `Equal([["a"]], [["a"]])` ran to `false` (one peel yields
 * `list<string>`, not `string`) and `Equal(["a", 1], ["a", 1])` ran to `false`
 * (the widened element type `number | string` is not wholly string), both where
 * the interpreter answers `True`.
 *
 * This predicate is the DECLINE trigger (the `some` side of the mixed rule).
 * The keep-compiling `every` side uses the narrower
 * `isFlatAllStringComparisonParticipant` — see there.
 */
export function isProvablyStringComparisonParticipant(x: Expression): boolean {
  if (isProvablyStringOperand(x)) return true;
  return typeHasStringEvidence(compilationType(x));
}

/**
 * The ADMISSION side of the mixed-string ordering rule: a participant whose
 * compared value is WHOLLY string, at most one collection layer deep — a
 * string operand, or a collection whose element type is a subtype of `string`.
 *
 * Deliberately NOT the recursive `isProvablyStringComparisonParticipant`: the
 * only all-string shapes verified to agree with interpretation are the flat
 * ones (`Less("a", ["x","y"])`, `Less(["a","b"], ["a","c"])`, pinned in
 * `compile-string-fail-closed.test.ts`). Parity for a NESTED all-string
 * ordering is unverified, so `every` must reject it and the head fails closed.
 */
export function isFlatAllStringComparisonParticipant(x: Expression): boolean {
  if (isProvablyStringOperand(x)) return true;
  const elt = collectionElementType(compilationType(x));
  if (elt === undefined) return false;
  const t = resolveTypeForCompilation(elt);
  return t !== 'never' && isSubtype(t, 'string');
}

/**
 * True when a comparison PARTICIPANT's static type ADMITS a collection at run
 * time — not only when the whole type is one.
 *
 * `x.type.matches('collection<any>')` (and Python's `isPyCollectionOperand`) answer
 * the SUBTYPE question, so a general UNION with a collection arm slips through:
 * `string | list<string>` is not a subtype of `collection`, yet the run-time
 * value can be a list. That blind spot let the tier-2 scalar string-equality
 * admission compile `Equal(uq, "a")` (`uq: string | list<string>`) to a scalar
 * `((uq) === ("a"))` — a wrong SHAPE and a wrong value behind `success: true`,
 * where the interpreter broadcasts element-wise to `["True", "False"]`. It is
 * reachable from inferred unions too (`g(flag) = "a" if flag else [1,2,3]`).
 *
 * Only POSITIVE union evidence counts. A top type (`unknown`/`any`/`value`) is
 * deliberately NOT a collection signal — that is "nothing is known", not "a
 * collection is possible", and the settled admission rule for the string
 * comparisons is "≥1 provably string AND none provably numeric", which keeps a
 * bare-`unknown` participant admitted (the run-time-array residual there is the
 * same accepted one the numeric fast path has). Targets pair this with their
 * own possibly-collection test (`isPossiblyCollectionTypedJS`) for the
 * `broadcastable<T>` / top-typed-application signals it does not cover.
 *
 * Same shape (and cycle guard) as the other participant walks here: a
 * `reference` unfolds to its definition, and a recursive alias stops on a
 * repeat — `false` is the ADMITTING direction only for a type that cannot be a
 * collection, and a cycle means the union arm was already visited.
 */
export function couldBeCollectionParticipant(x: Expression): boolean {
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (r === 'unknown' || r === 'any' || r === 'value' || r === 'never')
      return false;
    // A STRING is a subtype of `collection` (its elements are its grapheme
    // clusters) but is ATOMIC at run time: it lowers to a JS string, and both
    // the interpreter and the emitted scalar comparison treat it as one value.
    // Answering `true` here would make every string participant look like a
    // possibly-element-wise operand and close the scalar `===` admission.
    if (r === 'string') return false;
    if (typeof r !== 'string' && r.kind === 'union')
      return r.types.some((m) => walk(m, visited));
    return isSubtype(r, COLLECTION_SHAPE_TYPE);
  };
  return walk(x.type.type);
}

/**
 * The MIXED-string ORDERING rule, shared by every site that must agree on it:
 * the two infix diverts below (`orderingOverString` for JavaScript,
 * `pyOrderingUnfaithful` for Python) and the Python target's ordering gate
 * (`assertPyNoMixedStringOrdering`). At least one participant carries string
 * evidence, but not every one is a provably FLAT string — the only all-string
 * shape whose parity with interpretation is verified. The `some` and `every`
 * sides deliberately use DIFFERENT predicates; see each for why.
 */
export function isMixedStringOrderingParticipants(
  args: ReadonlyArray<Expression>
): boolean {
  return (
    args.some(isProvablyStringComparisonParticipant) &&
    !args.every(isFlatAllStringComparisonParticipant)
  );
}

/**
 * The JavaScript test recognizing the complex runtime convention — a
 * `{ re, im }` object (see `branchComplexCoercion`). An array (a compiled
 * collection) fails it: `[].re` is `undefined`.
 */
function jsComplexObjectTest(a: string): string {
  return `(${a} !== null && typeof ${a} === "object" && typeof ${a}.re === "number")`;
}

function isBoundPossiblyCollectionTyped(a: Expression): boolean {
  if (!isPossiblyCollectionTyped(a)) return false;
  const t = compilationType(a);
  if (typeof t !== 'string' && t.kind === 'broadcastable') return true;
  return a.isCanonical || a.isStructural;
}

/**
 * A `Tuple` or `List` literal with a broadcasting component — a shape whose
 * norm does NOT reduce to one scalar, so `Norm`/`Abs` compile handlers use
 * this to fail closed (D6) and let the interpreter broadcast. Exported for
 * the compile targets, which must not import `collection-utils` directly
 * (module-init ordering — see `isIndexedCollectionOperand` in
 * javascript-target.ts); this module already imports it safely.
 *
 * The broadcast test differs by literal kind, mirroring evaluation
 * semantics:
 * - `Tuple` (a point): ANY non-tuple collection component broadcasts —
 *   `([1,2], 3)` zips into a list of two points, one norm per element. A
 *   tuple-typed component is atomic (a nested point), not a broadcast.
 * - `List` (a vector): a literal `List` component is a matrix ROW (the
 *   Frobenius norm is a legitimate scalar), so only a NON-literal
 *   collection-typed component (e.g. the `broadcastable`-typed `x+[0.5,1]`)
 *   is a hazard — evaluation nests it where a compiled flatten cannot
 *   follow (invalid vecN shader source; a silently-flattened wrong scalar
 *   through `_SYS.norm`).
 */
export function pointHasBroadcastComponent(expr: Expression): boolean {
  if (isFunction(expr, 'Tuple'))
    return expr.ops.some(
      (op) =>
        !isTuple(op) &&
        (op.isCollection || op.type.matches('indexed_collection<any>'))
    );
  if (isFunction(expr, 'List'))
    return expr.ops.some(
      (op) =>
        !isFunction(op, 'List') &&
        !isTuple(op) &&
        (op.isCollection || op.type.matches('indexed_collection<any>'))
    );
  return false;
}

/**
 * The STATEMENT head `expr` lowers to at a body position — `'Assign'` or
 * `'Declare'` — or `undefined` when the body is (or reduces to) an expression.
 *
 * The structural half of the expression-only contract, shared by the GPU and
 * Python targets (each applies its own language policy to the answer: GLSL
 * assignment is an OPERATOR and stays legal, WGSL and Python assignment are
 * STATEMENTS; a declaration is a statement on all three).
 *
 * Structural, on the body BEFORE it is compiled, deliberately — the two
 * emitted-source scans those targets already run (a newline, a `return` token)
 * are blind to both shapes: `Assign(s, x)` emits the single line `s = x` and a
 * root `Declare(s, 'number', x)` emits the single line `float s` / `var s: f32`
 * (Python: the EMPTY string), each with the initializer silently dropped. A
 * textual `=` scan cannot replace this without re-deriving the emitters'
 * precedence rules — it would false-positive on `==`/`<=`/`>=`/`!=`.
 *
 * A `Block` delegates to its VALUE statement (its last operand), following the
 * base compiler, which unwraps a single-statement block to that statement. A
 * multi-statement `Block` is normally declined by the emitted-source scan
 * anyway, but the two answers must agree on WHICH statement carries the value.
 */
export function statementBodyHead(
  expr: Expression | undefined
): 'Assign' | 'Declare' | undefined {
  let body = expr;
  while (body !== undefined && isFunction(body, 'Block') && body.ops.length > 0)
    body = body.ops[body.ops.length - 1];
  if (body === undefined) return undefined;
  if (isFunction(body, 'Assign')) return 'Assign';
  if (isFunction(body, 'Declare')) return 'Declare';
  return undefined;
}

/**
 * Base compiler class containing language-agnostic compilation logic
 */
export class BaseCompiler {
  /**
   * Precedence used when compiling a folded symbol value. Higher than any
   * target's infix operator precedence, so a compound value parenthesizes
   * itself when spliced into a surrounding expression. See
   * `tryFoldKnownSymbol`.
   */
  private static readonly FOLD_OPERAND_PREC = 1000;

  /**
   * Largest EXPANDED node count a symbol's assigned value may have before
   * `tryFoldKnownSymbol` refuses to bake it into the generated source.
   *
   * The generated source is text, so a folded value that mentions the same
   * sub-value from several places is written out once per PATH, not once per
   * distinct node. A value that is a small shared graph can therefore emit an
   * enormous program: the `f(n+1) = f(n) + 2 f(n)` tower grows by three
   * distinct nodes per level while its emission quadruples. That is why the
   * measure here is the expanded (per-path) node count computed by
   * `expandedFoldSize`, and not the number of distinct nodes — no
   * distinct-node cap can separate the two classes.
   *
   * Calibrated from both sides on the JavaScript target, by instrumenting
   * this guard and reading the size of every fold performed:
   * - Legitimate side: across sixteen compile test suites (1149 tests,
   *   including `compile.test.ts`, `compile-assigned-symbol.test.ts`,
   *   `compile-subtree-folding.test.ts` and `compile-cse.test.ts`) the largest
   *   fold performed was 4 expanded nodes. A deliberately oversized ordinary
   *   value — a symbol assigned a 60-term polynomial — expands to 297 nodes
   *   and emits 1.5 KB, so the limit sits 5000x above what the corpus does
   *   and about 67x above a value already far larger than anything measured.
   * - Pathological side: the tower above expands to 4·2^n − 3 nodes and emits
   *   about three characters per expanded node. Depth 12 (16 381 nodes, 49 KB
   *   of source, ~8 s) is the deepest level still folded; depth 13 (32 765) is
   *   refused, and depth 14 (65 533 nodes, 197 KB, ~17 s) is already past the
   *   point where the compile visibly stalls, quadrupling with every level
   *   after it.
   * The limit therefore caps a single fold at roughly 60 KB of generated
   * source. It bounds the blow-up rather than removing it: the general fix is
   * common-subexpression binding, which would emit each shared node once.
   */
  private static readonly MAX_FOLD_EXPANDED_NODES = 20_000;

  /**
   * Characters of generated source per expanded node, measured on the
   * JavaScript target (see `MAX_FOLD_EXPANDED_NODES`). Used only to put a
   * human-readable size in the refusal message.
   */
  private static readonly FOLD_CHARS_PER_NODE = 3;

  /**
   * Operator heads that are word-spelled infix/prefix **keywords** in some
   * targets (Python `and` / `or` / `not`), never function calls. The alphabetic
   * op-string of these heads must NOT be treated as a function-call name — that
   * would emit `and(a, b)` (a Python SyntaxError). This is distinct from a user
   * override that intentionally maps an operator to a function name (e.g.
   * `Add: ['add', 11]` → `add(x, y)`): those heads are not in this set.
   */
  private static readonly WORD_KEYWORD_OPERATORS: ReadonlySet<string> = new Set(
    ['And', 'Or', 'Not']
  );

  /**
   * Structural / control-flow heads that `compileExpr` special-cases directly
   * (their own bespoke lowering — loops, conditionals, blocks, sequences,
   * bindings). A user operator definition's custom `compile` handler does NOT
   * override these: their compilation is not a simple operand-wise call and a
   * handler cannot express it. Every OTHER head — including operator-mapped
   * arithmetic/relational heads and function-mapped heads — IS overridable by
   * a custom handler (see the handler consult in `compileExpr`, finding A5).
   */
  private static readonly CONTROL_FLOW_HEADS: ReadonlySet<string> = new Set([
    'Sequence',
    'Sum',
    'Product',
    'Function',
    'Declare',
    'Assign',
    'Return',
    'Break',
    'Continue',
    'Loop',
    'Comprehension',
    'If',
    'Which',
    'When',
    'Match',
    'Block',
  ]);

  /**
   * The control-flow heads a custom per-operator `compile` handler MAY
   * override after all — the carve-out from the `CONTROL_FLOW_HEADS` guard
   * (Tycho item 180). `Which` qualifies because it has no binding structure:
   * its operands are plain condition/value pairs a handler can compile
   * operand-wise through the callback it is given, unlike a `Sum` index or
   * a `Function` parameter list. The handler keeps the standard
   * decline-falls-back contract — returning `undefined`/`null`/`''` falls
   * through to the bespoke `Which` lowering below — and the override is
   * per-engine (definition lookup), not process-global like a target
   * function-table entry. Extend deliberately: any head added here must not
   * bind variables, or the handler cannot see the binding structure its
   * lowering must respect.
   */
  private static readonly OVERRIDABLE_CONTROL_FLOW_HEADS: ReadonlySet<string> =
    new Set(['Which']);

  /**
   * Operator symbols that lower to a valid *binary infix* lambda
   * (`(a, b) => a ∘ b`) when a bare operator symbol is used in value position —
   * a first-class function such as a `Reduce` combiner. Only the binary
   * arithmetic operators qualify: a unary operator (Negate/Not) would emit
   * wrong-arity or invalid source (e.g. `(a, b) => a ! b`), and a relational or
   * logical operator folds to a boolean that silently diverges from the
   * interpreter. Any operator symbol NOT in this set fails closed (D6) so the
   * engine falls back to the interpreter rather than emitting garbage behind
   * `success: true`. Keyed by symbol (not operator glyph) so it is
   * target-agnostic.
   */
  private static readonly BINARY_INFIX_VALUE_OPERATORS: ReadonlySet<string> =
    new Set(['Add', 'Subtract', 'Multiply', 'Divide']);

  /**
   * Does the bare operator symbol `s` lower to the binary infix lambda above?
   *
   * A target that consumes an operator symbol in a strictly BINARY role (a
   * `Reduce`/`Scan` combiner) must ask: every other operator symbol now
   * lowers to its eta-expanded wrapper at its OWN arity
   * (`_fn_Negate = (t) => -t`), which is a valid `Map`/`Filter` callback but
   * would silently mis-fold as a combiner (the interpreter raises an arity
   * error there). Before eta-expansion existed, `BaseCompiler.compile` failed
   * closed for those symbols and the combiner sites could rely on it.
   */
  static isBinaryInfixValueOperator(s: string): boolean {
    return BaseCompiler.BINARY_INFIX_VALUE_OPERATORS.has(s);
  }

  /**
   * The fail-closed (D6) refusal for a BUILT-IN operator name used in value
   * position that has no first-class form: it neither eta-expands
   * (`ensureBuiltinCallbackEmitted` declined — a variadic or zero-required
   * signature, or a wrapper body that does not canonicalize) nor lowers to a
   * binary infix lambda. Shared by the two routes that can reach that state
   * (the `target.operators` branch and the bare-symbol branch) so both refuse
   * with the same wording.
   */
  private static builtinCallbackRefusal(s: string): string {
    return (
      `${s}: cannot compile as a first-class function — the built-in ` +
      `operator has no fixed arity to eta-expand at (a variadic or ` +
      `zero-required signature), and only the binary arithmetic operators ` +
      `(Add/Subtract/Multiply/Divide) lower to a combiner lambda. ` +
      `Fail closed (D6).`
    );
  }

  /**
   * Compile `expr` as a **value operand** — a sub-expression spliced into a
   * surrounding expression. Behaves like `compile`, but on targets whose
   * multi-statement constructs are bare statement sequences
   * (`target.bareStatementBlocks`, i.e. GLSL/WGSL), it **fails closed** (D6)
   * when the operand compiled to such a block. A shader has no expression-level
   * loop/IIFE, so a loop-form `Sum`/`Product`/`Loop`/`Block` cannot be a
   * sub-expression; splicing it would emit invalid source (e.g.
   * `return _acc; + 1.0`). The offending head is named in the error, which the
   * engine-level `compile()` surfaces via `success: false` + `unsupported`.
   */
  /**
   * Pick the target's absence axis (§3.F) for a position of type `t` by its
   * DOMAIN (I6): a numeric-domain position (`<: number` after stripping the
   * `missing` arm — `never` counts, since a bare-`missing` numeric absence is
   * `NaN`) uses `absence.numeric`; any other (object) domain uses
   * `absence.object`. Throws (fail closed) when the target declares no absence
   * capability at all, or lacks the required object axis.
   */
  static absenceAxisForType(
    t: Readonly<Type>,
    target: CompileTarget<Expression>,
    opName: string
  ): {
    isAbsent?: (x: TargetSource) => TargetSource;
    coalesce?: (x: TargetSource, d: TargetSource) => TargetSource;
  } {
    if (target.absence === undefined)
      throw new Error(
        `${opName}: target '${target.language ?? 'unknown'}' has no absence ` +
          `capability. Fail closed (§3.F).`
      );
    // Unfold a declared type reference BEFORE the strip: `stripMissingFromType`
    // is structural and does not see through a `reference`, so an alias such as
    // `type alias maybe_n = number | missing` would survive the strip intact and
    // mis-select the object axis. Resolve again afterwards, in case removing the
    // `missing` arm collapsed the union down to a single reference arm.
    const stripped = resolveTypeForCompilation(
      stripMissingFromType(resolveTypeForCompilation(t))
    );
    const numeric = stripped === 'never' || isSubtype(stripped, 'number');
    if (numeric) return target.absence.numeric;
    if (target.absence.object === undefined)
      throw new Error(
        `${opName}: an object-domain absent position has no representation on ` +
          `target '${target.language ?? 'unknown'}'. Discharge with 'Coalesce' ` +
          `first. Fail closed (§3.F).`
      );
    return target.absence.object;
  }

  static compileValueOperand(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec = 0
  ): TargetSource {
    const code = BaseCompiler.compile(expr, target, prec);
    if (
      target.bareStatementBlocks &&
      typeof code === 'string' &&
      code.includes('\n')
    ) {
      const head = expr !== undefined && isFunction(expr) ? expr.operator : '?';
      throw new Error(
        `${head}: a multi-statement construct (loop-form Sum/Product, Loop, or Block) ` +
          `cannot be used as a sub-expression in "${target.language ?? 'this'}" ` +
          `— it is only valid as a top-level function body. Fail closed (D6).`
      );
    }
    return code;
  }

  /**
   * Whether `target` currently accepts hoisted statements (Tycho item 110).
   *
   * True only when the target declares a `hoist` sink AND no binder has been
   * entered since it was installed: a statement hoisted out of a binder scope
   * would reference a name that does not exist where it lands. Every binder
   * spreads a FRESH `boundVars` set into its inner target, so the identity
   * comparison detects the crossing without every binding site having to
   * cooperate. A binder that wants its body to hoist installs its own sink.
   */
  static canHoist(target: CompileTarget<Expression>): boolean {
    return (
      target.hoist !== undefined && target.hoist.boundVars === target.boundVars
    );
  }

  /** Push a statement onto `target`'s hoist sink. Callers must check
   * `canHoist` first — hoisting into a closed sink is a compiler bug. */
  static hoistStatement(
    target: CompileTarget<Expression>,
    ...stmts: string[]
  ): void {
    if (!BaseCompiler.canHoist(target))
      throw new Error(
        'Internal: hoisting a statement out of a binder scope (or with no ' +
          'hoist sink installed)'
      );
    target.hoist!.stmts.push(...stmts);
  }

  /**
   * Compile `expr` at a **statement position** — a function body, or the
   * right-hand side of a shader-body assignment — with a fresh hoist sink
   * installed.
   *
   * Returns the emitted source plus the statements that were hoisted while
   * compiling it, in emission order. Nothing hoisted means the result is
   * byte-identical to `compile()`, so this is a drop-in for every statement
   * position on a `bareStatementBlocks` target.
   */
  static compileStatementBody(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec = 0
  ): { stmts: string[]; code: string } {
    const sink = { stmts: [] as string[], boundVars: target.boundVars };
    const code = BaseCompiler.compile(expr, { ...target, hoist: sink }, prec);
    return { stmts: sink.stmts, code };
  }

  /**
   * `compileStatementBody`, assembled into a single function-body string:
   * the hoisted statements followed by the value, `return`-prefixed when the
   * value is an expression (a multi-statement value already carries its own
   * `return` on the last line — the pre-item-110 block convention).
   */
  static compileFunctionBody(
    expr: Expression | undefined,
    target: CompileTarget<Expression>
  ): string {
    const { stmts, code } = BaseCompiler.compileStatementBody(expr, target);
    if (stmts.length === 0) return code;
    return [...stmts, code.includes('\n') ? code : `return ${code};`].join(
      '\n'
    );
  }

  /**
   * Compile `expr` as the **root** of a compilation: open the compilation
   * boundary on `target`, then compile.
   *
   * `compile()` is the recursive entry — every sub-expression flows through it,
   * so it cannot tell a new compilation from a nested one. This is the entry a
   * caller driving a whole compilation uses (`expr.compile({ target })`,
   * plugin targets), and the one that gives a REUSED target object the fresh
   * per-compilation numbering an engine-created target gets by being new: two
   * compilations of one expression then emit identical source.
   *
   * Not used where one target deliberately spans several root compilations —
   * a shader body compiles each of its statements against a single target so
   * their random counters stay distinct (`compileShaderBody`).
   */
  static compileRoot(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec = 0
  ): TargetSource {
    // Open the naming boundary here, not only in the optional
    // `beginCompilation` hook (which most targets do not define): restart the
    // generated-name numbering and fold this expression's own symbols into the
    // collision inventory. A caller-built target reused for two compilations
    // then emits identical source for both. (The GPU targets' own
    // `beginCompilation` resets as well — a double reset is harmless.)
    if (target.naming !== undefined) {
      target.naming.counter = 0;
      if (expr !== undefined)
        for (const n of collectUsedNames(expr)) target.naming.usedNames.add(n);
    } else target.naming = BaseCompiler.newNamingContext(expr);
    // (The shared antiderivative budget is NOT reset here: registered
    // targets compile through `compileCseRoot` without passing this entry,
    // so the reset lives at the depth-0 boundary of `compile` below, which
    // every route crosses.)
    target.beginCompilation?.(target);
    return BaseCompiler.compile(expr, target, prec);
  }

  /**
   * Compile an expression to target language source code
   */
  static compile(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec = 0
  ): TargetSource {
    if (expr === undefined) return '';
    // A node whose emission the D2/D6 runtime rule has BOUND to a temporary
    // (`realOperandGuard`): the real lowering re-emits its head with the
    // operand's code replaced by the temporary's real projection.
    const override = BaseCompiler._codeOverrides.get(expr);
    if (override !== undefined) return override;
    if (!expr.isValid) {
      throw new Error(
        `Cannot compile invalid expression: "${expr.toString()}"`
      );
    }
    // First-class type values do not compile — a reified type expression has
    // no runtime representation on any target, and the type-algebra
    // operators consult the engine's type registry, which compiled code does
    // not carry. This is the SHARED boundary the design prescribes
    // (`docs/TYPE-SYSTEM.md`): one gate covers
    // every target — including `interval-js`, whose unknown-operator path
    // emits empty code instead of rejecting (ROADMAP.md, "The `interval-js`
    // compile target emits EMPTY code"), and custom registered targets. Two
    // checks, both deliberately narrow:
    //
    // 1. A node whose result type is EXACTLY the `type` primitive (a settled
    //    `TypeFrom` node, a `type`-typed symbol or parameter). Exact
    //    equality, never `matches('type')`: declared types are routinely
    //    wider than runtime values, and a wide-typed operand must not trip a
    //    static gate (the compile-type-gate rule, `docs` plan §3.3).
    // 2. A type-comparison head whose operands are NOT all ground type
    //    values or literal type text. A GROUND call is exempt on purpose:
    //    constant folding evaluates it through the interpreter to its
    //    correct boolean — right code, not wrong code — and the fold must
    //    keep winning. (`MatchesType`/`Conforms` are listed ahead of their
    //    phase-2 landing; the names are inert until then.)
    if (expr.type.toString() === 'type')
      throw new Error(
        `Cannot compile a type value (type 'type') to target ` +
          `'${target.language ?? 'unknown'}': a reified type expression has ` +
          `no compiled representation. Fail closed (D6).`
      );
    if (
      isFunction(expr, 'Subtype') ||
      isFunction(expr, 'MatchesType') ||
      isFunction(expr, 'Conforms')
    ) {
      const ground = expr.ops.every(
        (op) =>
          isString(op) ||
          (isFunction(op, 'TypeFrom') && op.nops === 1 && isString(op.op1))
      );
      if (!ground)
        throw new Error(
          `${expr.operator}: cannot compile — a non-constant type ` +
            `comparison needs the engine's type registry, which compiled ` +
            `code does not carry (target '${target.language ?? 'unknown'}'). ` +
            `Fail closed (D6).`
        );
    }
    // Install the naming context EAGERLY, on the outermost call, for a target
    // that arrived without one (a hand-rolled target driven through
    // `BaseCompiler.compile`). It must be installed before the first
    // `{ ...target }` spread: a context installed lazily deeper in the
    // recursion lands on a spread COPY, and the sibling branches then number
    // their temporaries from a forked counter (§4.1 — the context is a SHARED
    // object reference by design).
    if (target.naming === undefined)
      target.naming = BaseCompiler.newNamingContext(expr);
    // Object-domain absence gate (§3.F). A subexpression whose type carries a
    // `missing` arm in an OBJECT (non-numeric) domain has no representation on a
    // target lacking the `object` absence axis (interval, GPU) — fail closed
    // (D6) with a diagnostic rather than emit source that cannot represent the
    // hole. Numeric-domain absence (`number | missing`) is `NaN` (I6) and needs
    // no object axis, so it is exempt. Only object-axis-less targets pay the
    // check (JS/Python declare `object`, so the guard short-circuits).
    if (target.absence !== undefined && target.absence.object === undefined) {
      const t = compilationType(expr);
      if (typeContainsMissing(t)) {
        const stripped = resolveTypeForCompilation(stripMissingFromType(t));
        if (
          stripped !== 'never' &&
          stripped !== 'unknown' &&
          stripped !== 'any' &&
          !isSubtype(stripped, 'number')
        )
          throw new Error(
            `Cannot compile an object-domain absent ('missing') position ` +
              `(type '${expr.type.toString()}') to target ` +
              `'${target.language ?? 'unknown'}': it has no object null ` +
              `representation. Discharge with 'Coalesce' first (fail closed, §3.F).`
          );
      }
    }
    // The engine⇄compiled boundary for TAGGED sums
    // (`docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §B2). A
    // `{_tag, _ops}` object is an implementation detail of one compiled unit;
    // v1 does not marshal it back into boxed land. So a unit whose RESULT type
    // admits one declines here, at the compilation boundary (`_compileDepth
    // === 0` — the outermost `compile()`, whichever target funnels through it),
    // rather than leaking the representation. A tagged sum in a PARAMETER
    // position is fine and stays supported: an in-unit recursive function
    // (`ev(n: node)`) needs it, and its only callers are in the same unit.
    // Representation-DISJOINT sums are ordinary erased values and flow as
    // today.
    if (BaseCompiler._compileDepth === 0) {
      const tagged = taggedSumInType(expr.engine, expr.type.type);
      if (tagged !== undefined)
        throw new Error(
          `Cannot compile an expression whose result type '${expr.type.toString()}' ` +
            `is the tagged sum variant '${tagged}': its compiled representation ` +
            `is internal to the compiled unit and does not cross the boundary. ` +
            `Fail closed (D6).`
        );
    }
    // Keep the compile-bound-variables context in sync for the contextless
    // analysis helpers (`isComplexValued`): every recursive compilation flows
    // through here with the innermost target, so the static always reflects
    // the names currently shadowing the engine (loop indices, lambda
    // parameters, broadcast elements).
    const prevBoundCtx = BaseCompiler._boundVarsCtx;
    const nextBoundCtx = target.boundVars ?? prevBoundCtx;
    // Compilation boundary for the complexness memo (Tycho item 148). This —
    // not `compileRoot` — is the entry EVERY target funnels through (the GPU,
    // JS, Python and interval targets each call `BaseCompiler.compile`
    // directly from their own `compileOrThrow`), so the reset has to key off
    // the nesting depth rather than a per-target hook. Engine symbol values
    // are stable within one compilation but not across compilations, and a
    // boxed expression can outlive the compile that cached its answer.
    if (BaseCompiler._compileDepth === 0) {
      BaseCompiler._invalidateComplexMemo();
      // The fold-value memo has the same staleness boundary: engine symbol
      // values are stable within one compilation but not across them.
      BaseCompiler._foldValueMemo = new WeakMap();
      // (The fold-aware oracle latch `_oracleFoldTarget` is synced below,
      // OUTSIDE this depth-0 block — a re-entrant nested compile must be
      // able to switch it off.)
      // A fresh outermost compilation gets a fresh shared antiderivative
      // pool. This is the only reset: putting it anywhere shallower missed a
      // route — registered targets compile through `compileCseRoot`, never
      // `compileRoot` or the public `compile()` entry, so a compilation that
      // drained the pool left every later direct-target compilation skipping
      // symbolic closed forms permanently. Nested compilations (depth > 0)
      // deliberately consume the OUTER pool, so the aggregate stays bounded
      // by one pool per outermost entry; an auto-mode escalation retry
      // re-enters at depth 0 and gets its own pool.
      BaseCompiler.resetSharedCompilationBudgets();
    }
    // The complex-promotion opt-in is latched from the OUTERMOST compilation
    // only (`complexPromotion`). The analysis here and every target emitter
    // must agree on each node's value SHAPE — a parent that read `{re, im}`
    // around a child that emitted a bare number is NaN everywhere — so the
    // lane must be one answer for a whole compilation. Nested targets (a user
    // function's body, a broadcast element) are constructed internally and do
    // not carry the caller's option, so reading it at depth > 0 would flip the
    // lane back mid-compile.
    // Only the languages whose emitters implement the promotion may latch it.
    // The option reaches a target two ways — the registered route, and the
    // direct `compile(expr, { target })` route, which stamps the caller's
    // choice onto whatever target object it was handed — and neither knows the
    // language. A shader target's `Sqrt`/`Ln`/`Log` emitters never consult
    // `promotesRadicalToComplex`, so letting the flag through there would make
    // the ANALYSIS report complex over emitters still producing a scalar:
    // measured, `compile(Mod(1e5·√(x−1), 1), { target: glslRaw,
    // complexPromotion: true })` turned a working
    // `mod(100000.0 * sqrt(x + -1.0), 1.0)` into a D6 decline. Restricting the
    // latch here — the one choke-point every target funnels through — enforces
    // the option's documented scope on every entry path at once.
    // The compile MODE (`CompileMode`) is latched here too, from the outermost
    // compilation only and for the same reason: the analysis and every
    // emitter must agree on each node's value SHAPE for the whole
    // compilation. `resolveCompileMode` validates the requested mode against
    // the target's `supportedModes` — a mode the target does not offer is a
    // `capability` decline, thrown here so it surfaces through the target's
    // ordinary decline channel — and supplies the target's default when none
    // was requested. It is resolved BEFORE either latch is written: the throw
    // happens outside the `try`/`finally` below, so a latch mutated ahead of
    // it would never be restored.
    const prevPromotion = BaseCompiler._complexPromotion;
    const prevMode = BaseCompiler._mode;
    const prevHelperLookup = BaseCompiler._realOnlyHelperLookup;
    // Fold-before-shape for the complexness oracle (Tycho item 229): with
    // this latch set, `isComplexValued` answers `false` for a closed pure
    // scalar whose constant fold is a real number — an exact constant such
    // as `√(5−√5)` types (and would promote as) the complex hedge while its
    // value is the plain real 1.6625…. The latch makes the ORACLE the
    // single source of truth: every analysis (broadcast element verdicts,
    // the indexed-read arm, the fail-closed guards) and the emission
    // (`tryConstantFold`'s complex-shape gate reads the same oracle, so the
    // fold is admitted and the literal is inlined) flip together.
    // JavaScript target only, and never under the `constantFold: false`
    // emission opt-out or a `symbolDeps` capture — there the emission stays
    // structural/unfolded, so the oracle must keep the shape-first verdict
    // or analysis and emission would disagree.
    //
    // Synced at EVERY compile entry, not only at depth 0: constant folding
    // evaluates, evaluation can re-enter compilation with a DIFFERENT
    // target (a large `Map` body auto-compiles through `implicitCompile`,
    // whose target carries `symbolDeps`), and that nested compilation's own
    // emission cannot fold — inheriting the outer fold-aware oracle there
    // would let its analyses claim shapes its emission does not produce.
    // Same-compilation nested targets are spreads of the outer one, so
    // their eligibility matches and the latch object is left alone; the
    // complexness memo is invalidated on an actual flip (rare — only the
    // re-entrant routes), since verdicts cached under one latch state are
    // wrong under the other.
    const prevOracleFold = BaseCompiler._oracleFoldTarget;
    const oracleFoldEligible =
      target.language === 'javascript' &&
      target.constantFold !== false &&
      target.symbolDeps === undefined;
    const nextOracleFold =
      BaseCompiler._compileDepth === 0
        ? oracleFoldEligible
          ? target
          : undefined
        : oracleFoldEligible
          ? prevOracleFold
          : undefined;
    // A declined compilation must not report the previous compilation's mode.
    // Reset first so a fallback built for the decline
    // reports `strict`/not promoted. This is the only report a decline gets —
    // whether it throws before the latches below are written (an unsupported
    // requested mode throws in `resolveCompileMode`) or long after, since the
    // `finally` re-freezes only on the success path.
    if (BaseCompiler._compileDepth === 0)
      BaseCompiler._lastReport = { mode: 'strict', promoted: false };
    const nextMode =
      BaseCompiler._compileDepth === 0
        ? BaseCompiler.resolveCompileMode(target)
        : prevMode;
    // Written only after `resolveCompileMode` above — its throw escapes the
    // `try`/`finally` below, and a latch mutated ahead of it would never be
    // restored (the same ordering rule the mode latches follow).
    if (nextOracleFold !== prevOracleFold) {
      BaseCompiler._oracleFoldTarget = nextOracleFold;
      BaseCompiler._invalidateComplexMemo();
    }
    if (BaseCompiler._compileDepth === 0) {
      BaseCompiler._complexPromotion =
        target.complexPromotion === true &&
        BaseCompiler.COMPLEX_PROMOTION_LANGUAGES.has(target.language ?? '');
      BaseCompiler._mode = nextMode;
      // The per-compilation report (`modeReport`) starts fresh: no head
      // promoted yet; the discipline is the one just latched.
      BaseCompiler._promoted = false;
      // The outermost target's helper table, so the contextless analysis can
      // tell which heads this compilation lowers through a real-only STRING
      // helper (see `_realOnlyHelperLookup`). Latched once per compilation
      // like the mode: nested targets (a user-function body, a broadcast
      // element) are spread from this one and lower every head the same way.
      BaseCompiler._realOnlyHelperLookup =
        target.language !== undefined &&
        !target.language.startsWith('interval') &&
        typeof target.functions === 'function'
          ? target.functions
          : undefined;
    }
    BaseCompiler._compileDepth += 1;
    // Only a genuine CHANGE of the bound-variable context invalidates: the
    // inner targets of a recursion carry the SAME `boundVars` set object
    // except at a binder crossing, so the memo survives the common path.
    if (nextBoundCtx !== prevBoundCtx) {
      BaseCompiler._boundVarsCtx = nextBoundCtx;
      BaseCompiler._invalidateComplexMemo();
    }
    // Set on the way out of a compilation that produced code. A decline
    // leaves the `try` by THROWING, so this stays `false` there and the
    // `finally` below knows not to freeze a report for code that was never
    // emitted.
    let emitted = false;
    try {
      // Compile-time constant folding, attempted top-down at every function
      // node so the largest constant subtree folds: a pure subtree with no
      // free variables evaluates at compile time and emits as a literal
      // (`Sum(Take(Map(_ ↦ _^2, 1..20), 10))` → `385`) instead of lowering
      // structurally. Runs before the CSE walk so eliminated regions are
      // never inventoried. All the safety gates live in `tryConstantFold`.
      if (isFunction(expr)) {
        const folded = BaseCompiler.tryConstantFold(expr, target, prec);
        if (folded !== undefined) {
          emitted = true;
          return folded;
        }
      }
      const compiled = BaseCompiler.compileWithCse(expr, target, prec);
      emitted = true;
      return compiled;
    } finally {
      BaseCompiler._compileDepth -= 1;
      // Leaving the OUTERMOST compilation: freeze its report for the target
      // to attach (`withReferences` → `modeReport`), before the latches are
      // restored.
      //
      // `mode` is the latched DISCIPLINE — `'strict'` or `'complex'`, with
      // `'auto'` collapsed to `'strict'` because `auto` is a policy OVER the
      // two disciplines (try strict, escalate on a `LaneMismatch`), not a
      // discipline code can be compiled under — WIDENED to `'complex'` when a
      // promotable head was promoted (`_promoted`). The widening is needed
      // because under `auto` a promotable head is lowered through the complex
      // kernel on the FIRST attempt, with no escalation: `_mode` still reads
      // `'strict'` while the emitted code computes in the complex kernel and
      // returns `{re, im}`, so `_mode` alone contradicted `promoted: true` on
      // the same result.
      //
      // The widening is NOT a lane oracle: an operand that is already
      // complex-TYPED (`Sqrt(z)` with `z: complex`) or a complex literal
      // (`2i·x`) routes through the complex kernel in EVERY discipline, and
      // `promotesRadicalToComplex` deliberately does not count that as a
      // promotion (`promoted` reports a lane DIFFERENCE with the shader
      // targets, which is what a merely-unknown-sign operand creates). Such a
      // compile emits `{re, im}` and still reports `mode: 'strict'`. Read the
      // returned value's shape (`typeof v === 'number'`), never `mode`, to
      // decide whether a result is complex-shaped.
      //
      // Only a compilation that EMITTED code gets this report: the report
      // describes emitted code, and a decline emitted none. A decline throws
      // out of the `try` above with the latches already written, so freezing
      // unconditionally here would hand `buildInterpreterFallback` — which
      // spreads `modeReport()` onto a `success: false` result whose `run` is
      // interpreter-backed — a `{mode: 'complex', promoted: true}` describing
      // code that does not exist. `_promoted` is especially unsafe there: it
      // is set from `promotesRadicalToComplex`, which the contextless
      // ANALYSIS predicate `isComplexValued` also calls, so it can be true
      // for a subtree that was never emitted at all. On the throw path the
      // neutral `{mode: 'strict', promoted: false}` installed at depth-0 entry
      // stands. (User ruling 2026-08-17, on Tycho consumer item 201.)
      if (BaseCompiler._compileDepth === 0 && emitted)
        BaseCompiler._lastReport = {
          mode:
            BaseCompiler._mode === 'complex' || BaseCompiler._promoted
              ? 'complex'
              : 'strict',
          promoted: BaseCompiler._promoted,
        };
      BaseCompiler._complexPromotion = prevPromotion;
      BaseCompiler._mode = prevMode;
      BaseCompiler._realOnlyHelperLookup = prevHelperLookup;
      // Restore the caller's oracle-fold latch (undefined at depth 0:
      // outside a compilation the conservative shape-first verdict is the
      // safe one — engine symbol values may change between compilations,
      // and an out-of-compile analysis caller has no emission to agree
      // with). A flip invalidates the memo for the same reason the entry
      // flip does: cached verdicts embed the latch state.
      if (nextOracleFold !== prevOracleFold) {
        BaseCompiler._oracleFoldTarget =
          BaseCompiler._compileDepth === 0 ? undefined : prevOracleFold;
        BaseCompiler._invalidateComplexMemo();
      }
      if (nextBoundCtx !== prevBoundCtx) {
        BaseCompiler._boundVarsCtx = prevBoundCtx;
        BaseCompiler._invalidateComplexMemo();
      }
    }
  }

  /**
   * The outermost JavaScript compilation's target, latched at the depth-0
   * entry when constant folding is allowed (no `constantFold: false`, no
   * `symbolDeps` capture) — undefined otherwise, and outside compilations.
   * With it set, `isComplexValued` consults the memoized constant fold
   * before reporting a closed pure scalar complex: a real folded value
   * overrides the shape verdict, and `tryConstantFold`'s complex-shape gate
   * — which reads the same oracle — then admits the fold, so the emitted
   * literal and every analysis answer describe the same plain number.
   */
  private static _oracleFoldTarget: CompileTarget<Expression> | undefined;

  /**
   * Fold-before-shape (Tycho item 229): downgrade a `true` complexness
   * verdict to `false` when the node is a closed pure scalar whose memoized
   * constant fold is a real number. `√(5−√5)` — an exact value of
   * `cos`/`sin`(π·rational) — types the `finite_complex` hedge and would
   * promote through `_SYS.csqrt`, yet its value is the plain real 1.6625…;
   * with the override, `tryConstantFold` inlines that literal (its
   * complex-shape gate reads this same oracle) and every analysis reports
   * the plain number the emission produces. A node whose fold declines
   * (free variables, impure, over budget, `'declined'`-memoized) keeps the
   * shape-first verdict, and so does every node when the latch is unset
   * (non-JavaScript targets, `constantFold: false`, `symbolDeps` capture,
   * outside a compilation). The fold outcome is memoized per
   * (target, expression), so the verdict cannot drift between analysis and
   * emission within one compilation.
   */
  private static _withFoldedRealOverride(
    expr: Expression,
    verdict: boolean
  ): boolean {
    if (!verdict) return verdict;
    const target = BaseCompiler._oracleFoldTarget;
    if (target === undefined) return verdict;
    // An indexed READ is excluded: its complex verdict describes the
    // element convention of the emitted array, and `_SYS.at`'s run-time
    // handling of an exotic index (a complex index selects by its own
    // contract) is deliberately left to the runtime — the fold gate's
    // "may return either shape" class. Folding the read would replace that
    // contract with the interpreter's answer; the pinned behavior is the
    // structural emission (see `compile-complex-element-access.test.ts`,
    // "a COMPLEX index is left to its own handling").
    if (isFunction(expr, 'At')) return verdict;
    const v = BaseCompiler.constantFoldValue(expr, target)?.value;
    if (v !== undefined && isNumber(v) && v.im === 0) return false;
    return verdict;
  }

  /** The innermost compile target's `boundVars`, synced by `compile()`. */
  private static _boundVarsCtx: ReadonlySet<string> | undefined;

  /**
   * Whether the OUTERMOST compilation opted in to complex promotion for
   * `Sqrt`/`Ln`/`Log` over an operand of unknown sign (`complexPromotion`).
   * Latched by `compile()` at depth 0 and restored on the way out.
   */
  private static _complexPromotion = false;

  /**
   * Whether the compilation in progress promotes an unknown-sign
   * `Sqrt`/`Ln`/`Log` to the complex lane. Target emitters read this so their
   * lowering agrees with `isComplexValued`'s report to the enclosing node —
   * the shape invariant compiled correctness rests on.
   */
  static get complexPromotion(): boolean {
    return BaseCompiler._complexPromotion;
  }

  /**
   * The compile mode of the OUTERMOST compilation (`CompileMode`), latched by
   * `compile()` at depth 0 from the target's `mode` (validated against its
   * `supportedModes`, defaulting per `resolveCompileMode`) and restored on
   * the way out. `'strict'` outside any compilation.
   *
   * Consulted by the analysis and the emitters through the three gates
   * `strictLanes` (strict, auto), `complexDiscipline` (complex) and
   * `promotionActive`/`runtimeRealGuards` (auto, complex); see
   * `docs/COMPILATION-MODEL.md` for the disciplines.
   */
  private static _mode: CompileMode = 'strict';

  static get mode(): CompileMode {
    return BaseCompiler._mode;
  }

  /**
   * Whether the compilation in progress runs under the STRICT discipline's
   * binding-boundary rule: a complex-shaped value reaching a binding the
   * compilation shaped real is a `LaneMismatch` decline (design §3,
   * `docs/COMPILATION-MODEL.md`), never a specialization
   * or a silent real-lane emission.
   *
   * In force for `mode: 'strict'` and for `mode: 'auto'`, whose FIRST attempt
   * is the strict discipline (with promotion): the `LaneMismatch` it raises
   * is what the escalation catches to redo the compilation under `'complex'`
   * (design §4, `compileWithAutoEscalation` in `auto-escalation.ts`, which a
   * registered target applies inside its own `compile()`). Under `'complex'`
   * a wide binding is complex-shaped and nothing mismatches.
   */
  static get strictLanes(): boolean {
    return BaseCompiler._mode === 'strict' || BaseCompiler._mode === 'auto';
  }

  /**
   * Whether the compilation in progress PROMOTES: an unknown-sign
   * `Sqrt`/`Ln`/`Log` (and the real-typed operand of an inverse-trig head of
   * unknown magnitude) lowers through the complex kernels — the `auto` and
   * `complex` disciplines, and the deprecated `complexPromotion` opt-in.
   * `strict` never promotes (the shader targets' model).
   */
  static get promotionActive(): boolean {
    return (
      BaseCompiler._complexPromotion ||
      BaseCompiler._mode === 'auto' ||
      BaseCompiler._mode === 'complex'
    );
  }

  /**
   * Whether the D2/D6 RUNTIME rule is in force (`realOperandGuard`): a
   * maybe-complex operand of a real-only head is guarded at run time rather
   * than declined at compile time — the `auto` and `complex` disciplines. In
   * strict mode nothing changes: such an operand fails closed as before.
   */
  static get runtimeRealGuards(): boolean {
    return BaseCompiler._mode === 'auto' || BaseCompiler._mode === 'complex';
  }

  /**
   * Set when this compilation lowered a promotable head through a complex
   * kernel — the `promoted` field of the result (design §4): the signal that
   * the compiled unit would NOT compute the same value on a shader target's
   * real kernel, escalation or not. Reset at the outermost compilation entry,
   * frozen into `_lastReport` at its exit. A compile-time fact decided from
   * the source (operand sign provability, operand type), never from a
   * runtime value — so the same source always reports the same flag.
   */
  private static _promoted = false;

  /**
   * The OUTERMOST compilation's `target.functions` lookup, latched by
   * `compile()` at depth 0 (only for a target with a `language` other than
   * the interval family — the same condition under which `compileExpr`'s
   * string branch applies its real-only rule) and restored on the way out.
   * `undefined` outside any compilation.
   *
   * It exists so that `isComplexValued` can answer for a head the target
   * lowers through a real-only STRING helper (`Erf: '_SYS.erf'`, `Gamma:
   * '_SYS.gamma'`, Python `Erf: 'scipy.special.erf'`). Such a head never
   * yields a `{re, im}` object: a maybe-complex operand takes the D2/D6
   * runtime rule (`realOperandGuard` — the helper runs on the real part when
   * the imaginary part is exactly zero, `NaN` otherwise) and a definitely
   * non-real one is a compile-time decline. Yet several of these heads have a
   * WIDE result type (`Erf`, `Gamma`, `Zeta`, `Digamma`, `Factorial`,
   * `LambertW`, `Arsinh`, `ErfInv` all type `number`), so the type-based
   * analysis fell through to the operand recursion and reported them complex
   * whenever an operand was — a promoted unknown-sign radical, say. The
   * enclosing arithmetic then read `.re`/`.im` off a plain number. Measured
   * before this latch, in the default `auto` mode: `2·Erf(√y)` compiled to
   * `{re: 2 * _b.re, …}` around a bare `_SYS.erf(…)` and ran to `{re: NaN}`
   * at every point, and `Limit` at +∞ — whose growth oracles probe through
   * the compiler — declined `k·Erf(√y) + anything` for every `k ≠ 1` (test
   * `limit.test.ts` › "sum mixing a scaled Erf(∞) addend with a decaying
   * addend").
   */
  private static _realOnlyHelperLookup:
    | ((id: MathJsonSymbol) => CompiledFunction<Expression> | undefined)
    | undefined = undefined;

  /**
   * Whether the compilation in progress lowers head `h` through a real-only
   * STRING helper — the exact routing condition of `compileExpr`'s string
   * branch, mirrored here so the analysis and the emission agree on the value
   * SHAPE. `false` outside any compilation, and for the complex-transparent
   * heads (`Real`, `Imaginary`, `Argument`, `Conjugate`), which are string-
   * mapped in some targets but consume and may return complex values.
   */
  private static isRealOnlyHelperHead(h: string): boolean {
    const lookup = BaseCompiler._realOnlyHelperLookup;
    if (lookup === undefined) return false;
    if (BaseCompiler.COMPLEX_TRANSPARENT_HEADS.has(h)) return false;
    return typeof lookup(h) === 'string';
  }

  /** Record that a promotable head was lowered through a complex kernel. */
  static notePromoted(): void {
    BaseCompiler._promoted = true;
  }

  /**
   * Record, for the `promoted` report, that `head` (a promotable head) is
   * being lowered through a complex kernel because its operand is already
   * complex-valued — a promotion when that operand is complex only by
   * wideness (the complex discipline lifted it), a no-op otherwise. The
   * emitters call this on their "operand is complex" branch, whose lowering
   * is the same kernel either way; the decision is
   * `promotesRadicalToComplex`, which does the recording.
   */
  static recordPromotion(
    head: MathJsonSymbol,
    args: ReadonlyArray<Expression>
  ): void {
    void BaseCompiler.promotesRadicalToComplex(head, args);
  }

  /**
   * The report of the most recently COMPLETED outermost compilation, read by
   * `modeReport` when a target attaches `mode`/`promoted` to its result. A
   * compilation that DECLINES leaves the neutral value written at its entry
   * instead — it emitted no code for a report to describe.
   */
  private static _lastReport: {
    mode: 'strict' | 'complex';
    promoted: boolean;
  } = { mode: 'strict', promoted: false };

  /**
   * Whether the compilation in progress uses complex-value promotion. A numeric
   * binding whose static type is wide (`unknown`, `number`, `finite_number`,
   * an unannotated parameter, a block local not declared real) is
   * complex-shaped, and every wide value is lifted at its use through the
   * target's idempotent `complexLift` (`_SYS.cplx`) — a number becomes `{re,
   * im: 0}`, an object passes through, and a non-number (a string, a
   * boolean, a collection held by a wide binding) passes through untouched.
   * Sound because over-approximating complex is only slower. Typed-real
   * values keep the real kernel; the type-based realness proofs survive as an
   * optimization.
   *
   * In force for `mode: 'complex'` — as requested, or as the discipline of
   * `auto`'s escalated retry after a `LaneMismatch` (the engine-level
   * `compile()` redoes the compilation with `mode: 'complex'`).
   */
  static get complexDiscipline(): boolean {
    return BaseCompiler._mode === 'complex';
  }

  /**
   * The complex discipline's answer for a numeric binding of static type `t`
   * that the strict analysis shapes REAL by default: complex when the type
   * is WIDE — it admits a complex value (`unknown`, `any`, `number`,
   * `finite_number`, a union containing them) — real when it is a real-only
   * type or not a number type at all. `false` outside complex mode, which is
   * the strict default this replaces.
   */
  static wideIsComplex(t: Type | undefined): boolean {
    if (!BaseCompiler.complexDiscipline) return false;
    return BaseCompiler.wideNumericType(t);
  }

  /**
   * Is `t` a WIDE numeric type — one that admits a complex value without
   * being a real-only type: `unknown`, `any`, `number`, `finite_number`, a
   * non-real number type, a union containing one? (Mode-independent; the
   * complex discipline's binding rule is `wideIsComplex`.)
   */
  static wideNumericType(t: Type | undefined): boolean {
    if (t === undefined) return false;
    if (isNonRealNumber(t)) return true;
    if (isSubtype(t, 'real')) return false;
    // Admits a complex value: `complex` (hence any complex number) is a
    // subtype of the binding's type, or the type is a top type.
    return isSubtype('complex', t);
  }

  /**
   * Nodes whose emission is currently OVERRIDDEN by a temporary's real
   * projection — the D2/D6 runtime rule (`realOperandGuard`). Consulted at
   * the top of `compile()`; keyed by node identity, scoped to the emission of
   * the guarded head.
   */
  private static readonly _codeOverrides = new Map<Expression, string>();

  /**
   * Is `expr` STATICALLY a non-real number — a value that certainly has a
   * non-zero imaginary part? `ImaginaryUnit`, a number literal with a
   * non-zero imaginary part, a symbol typed `imaginary`, or a symbol whose
   * assigned value is one of those. A `complex`-TYPED symbol is NOT
   * statically non-real (a real IS a complex; `z: complex` may hold `2`), nor
   * is a promoted radical or a wide binding — those take the D2 runtime rule.
   */
  static isProvablyNonReal(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im !== 0 && expr.isNumberLiteral === true;
    if (isSymbol(expr)) {
      if (expr.symbol === 'ImaginaryUnit') return true;
      const t = expr.type;
      if (t !== undefined && isSubtype(t.type, 'imaginary')) return true;
      if (
        BaseCompiler._boundVarsCtx?.has(expr.symbol) ||
        BaseCompiler._binderShield.some((f) => f.has(expr.symbol))
      )
        return false;
      const v = expr.engine._getSymbolValue(expr.symbol);
      return v !== undefined && BaseCompiler.isProvablyNonReal(v);
    }
    if (isFunction(expr)) {
      const t = expr.type;
      return t !== undefined && isSubtype(t.type, 'imaginary');
    }
    return false;
  }

  /**
   * The D2/D6 RUNTIME RULE (design §8, `docs/COMPILATION-MODEL.md`)
   * around a head `h` whose lowering is real-only — an ordering comparison,
   * an integer-only head (`Floor`, `Mod`, …), a real-only library helper
   * (`Erf`, …): when some SCALAR operand may be complex at run time (a
   * `complex`-typed symbol, a wide binding under the complex discipline, a
   * promoted radical), every such operand is bound ONCE to a temporary, in
   * argument order (draw order is preserved: `√(Random()) < 2` draws once),
   * and the head's real lowering is emitted with each bound operand's code
   * replaced by the temporary's real projection (`complexReal`), under the
   * guard that every temporary's imaginary part is exactly zero
   * (`complexIsReal`); otherwise the value is `elseCode` (`'false'` for a
   * comparison, `'NaN'` for a numeric head). Because the guard is emitted
   * WHERE the head is lowered, a head inside a conditional arm or a
   * short-circuited operand keeps its laziness.
   *
   * A STATICALLY non-real operand (`isProvablyNonReal`: `i`, `2i`, an
   * `imaginary`-typed symbol) is the compile-time DECLINE — `Less(i, 2)` has
   * no compiled value, exactly as the interpreter leaves it unevaluated —
   * raised here as a `capability` diagnostic (`code: 'non-real-operand'`).
   *
   * Returns `undefined` — the caller then applies its pre-existing
   * fail-closed decline — when no operand may be complex, when a maybe-
   * complex operand is definitely a collection (a list of maybe-complex
   * elements has no per-element rule here), or when the target lacks the
   * hooks the rule is emitted through (`bindExpr`, `complexIsReal`,
   * `complexReal`: the shader targets, a custom target without them).
   *
   * `emit` re-emits the head with the overrides active; the gate that called
   * this must skip an operand present in `_codeOverrides` on re-entry.
   */
  private static realOperandGuard(
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    emit: () => TargetSource,
    // The shape of the failing branch, forwarded to the target's
    // `realGuard`. It must match the shape the head returns when the guard
    // passes — see the `realGuard` contract in `types.ts`. The color
    // constructors pass `{ array: n }` so a genuinely-complex operand
    // yields an n-element NaN-filled color, never a bare scalar that flips
    // the caller's destructuring at runtime.
    resultKind: 'boolean' | 'number' | { array: number }
  ): TargetSource | undefined {
    // The rule belongs to the `auto` and `complex` disciplines; in strict
    // mode nothing changes — a typed-complex or provably non-real operand of
    // a real-only head fails closed as before (design D2/D6: "in strict mode
    // nothing changes").
    if (!BaseCompiler.runtimeRealGuards) return undefined;
    // Deduplicated by node identity: the same operand INSTANCE in two
    // positions (`Max(e, e)`) is bound once, and an impure one is evaluated
    // once.
    const maybe = [
      ...new Set(
        args.filter(
          (a) =>
            BaseCompiler.isComplexValued(a) &&
            !BaseCompiler._codeOverrides.has(a)
        )
      ),
    ];
    if (maybe.length === 0) return undefined;
    const nonReal = maybe.find((a) => BaseCompiler.isProvablyNonReal(a));
    if (nonReal !== undefined)
      throw new CompileDeclineError({
        code: 'non-real-operand',
        kind: 'capability',
        message:
          `${h}: cannot compile over the non-real operand \`${nonReal.toString()}\` — ` +
          `the value is certainly not a real number, so the head has no ` +
          `compiled value (the interpreter leaves it unevaluated). Fail closed (D6).`,
      });
    // A DEFINITELY-collection operand (a `list<complex>` literal or symbol)
    // has no per-element rule here and keeps the caller's decline; a wide
    // operand (`unknown`, `number`) is what the rule exists for.
    if (
      !target.bindExpr ||
      !target.complexIsReal ||
      !target.complexReal ||
      !target.realGuard ||
      maybe.some((a) => a.type.matches('collection<any>'))
    )
      return undefined;
    const bindings: Array<[string, string]> = [];
    const guards: string[] = [];
    const bound: Expression[] = [];
    try {
      for (const a of maybe) {
        const t = BaseCompiler.tempVar(target);
        bindings.push([t, BaseCompiler.compileValueOperand(a, target)]);
        guards.push(target.complexIsReal(t));
        BaseCompiler._codeOverrides.set(a, target.complexReal(t));
        bound.push(a);
      }
      const body = emit();
      // The conditional and its "else" literal are the TARGET's spelling
      // (`realGuard`): JavaScript `((g) ? (body) : NaN)`, Python
      // `((body) if (g) else float('nan'))`.
      return target.bindExpr(
        bindings,
        target.realGuard(guards, body, resultKind)
      );
    } finally {
      for (const a of bound) BaseCompiler._codeOverrides.delete(a);
    }
  }

  /**
   * The D2 runtime rule for a CHAINED ordering (`Less(a, b, c, …)` — `a < b <
   * c`): each operand is bound ONCE, at the FIRST edge that reads it, and the
   * edges are conjoined left to right, so a later operand is not evaluated
   * (and an impure one not drawn) once an earlier edge has failed — the
   * interpreter's short-circuit order. Each edge compares the real projections
   * under the guard that its operands are real; otherwise it is `false`.
   *
   * Emitted as nested `bindExpr` scopes: `((t0) => guard0 ? ((t1) => guard1 ?
   * (t0 < t1) && ((t2) => …)(c) : false)(b) : false)(a)`. Operands that are
   * NOT maybe-complex are still bound (they must be evaluated exactly once,
   * and the temporaries keep the edges uniform); their guard is omitted. The
   * comparison is the raw operator over real projections: a chain reaches
   * here only when some operand may be complex, i.e. every operand is
   * numeric. Same preconditions and `undefined` contract as
   * `realOperandGuard`.
   */
  private static realOperandChain(
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource | undefined {
    if (!BaseCompiler.runtimeRealGuards) return undefined;
    const isMaybe = (a: Expression): boolean =>
      BaseCompiler.isComplexValued(a) && !BaseCompiler._codeOverrides.has(a);
    if (!args.some(isMaybe)) return undefined;
    const nonReal = args.find(
      (a) => isMaybe(a) && BaseCompiler.isProvablyNonReal(a)
    );
    if (nonReal !== undefined)
      throw new CompileDeclineError({
        code: 'non-real-operand',
        kind: 'capability',
        message:
          `${h}: cannot compile over the non-real operand \`${nonReal.toString()}\` — ` +
          `the value is certainly not a real number, so the head has no ` +
          `compiled value (the interpreter leaves it unevaluated). Fail closed (D6).`,
      });
    const bind = target.bindExpr;
    const isReal = target.complexIsReal;
    const real = target.complexReal;
    const guard = target.realGuard;
    if (
      !bind ||
      !isReal ||
      !real ||
      !guard ||
      args.some((a) => a.type.matches('collection<any>'))
    )
      return undefined;
    const op = { Less: '<', LessEqual: '<=', Greater: '>', GreaterEqual: '>=' }[
      h
    ];
    if (op === undefined) return undefined;
    const temps = args.map(() => BaseCompiler.tempVar(target));
    const codes = args.map((a) => BaseCompiler.compileValueOperand(a, target));
    const guardOf = (i: number): string[] =>
      isMaybe(args[i]) ? [isReal(temps[i])] : [];
    const valueOf = (i: number): string =>
      isMaybe(args[i]) ? real(temps[i]) : temps[i];
    // Scope i binds operand i (guarded), then — for i ≥ 1 — compares it with
    // operand i−1 (bound by the enclosing scope) and continues the chain.
    const scope = (i: number): string => {
      const cmp = i === 0 ? '' : `(${valueOf(i - 1)} ${op} ${valueOf(i)})`;
      const rest = i + 1 < args.length ? scope(i + 1) : '';
      const body = cmp === '' ? rest : rest === '' ? cmp : `${cmp} && ${rest}`;
      return bind([[temps[i], codes[i]]], guard(guardOf(i), body, 'boolean'));
    };
    return scope(0);
  }

  /**
   * COMPLEX discipline, the LIFT AT USE (design §2): the emitted reference
   * `code` of a symbol whose analysis says complex ONLY because its type is
   * wide is wrapped in the target's idempotent `complexLift` (`_SYS.cplx`) —
   * the binding may hold a plain number at run time (a caller's `vars`, a
   * real argument to a wide parameter, a real first assignment to a local),
   * and every consumer that reads it as complex must find `{re, im}`. A
   * symbol complex by TYPE (`z: complex`, coerced at every entry) or by
   * frame (a lane parameter, a local bound to a complex value) is left as
   * emitted. Outside the complex discipline, or on a target without the
   * hook, the reference is unchanged.
   */
  private static liftWideReference(
    sym: Expression,
    code: TargetSource,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (!BaseCompiler.complexDiscipline || !target.complexLift) return code;
    if (!isSymbol(sym) || sym.symbol === 'ImaginaryUnit') return code;
    if (!BaseCompiler.isComplexValued(sym)) return code;
    const t = sym.type?.type;
    if (t !== undefined && isNonRealNumber(t)) return code;
    return target.complexLift(code);
  }

  /**
   * Throw the strict-mode `LaneMismatch` decline for a complex-shaped `value`
   * reaching the real-shaped binding `binding` at the §3 boundary `boundary`.
   * `binding` must be USER-LEGIBLE (an authored identifier or an honest
   * description — never an emitted temporary), per the `LaneMismatchError`
   * contract; `value` is rendered as LaTeX when the engine can serialize it.
   */
  private static laneMismatch(
    boundary: string,
    binding: string,
    value: Expression
  ): never {
    let rendered: string;
    try {
      rendered = value.latex;
    } catch {
      rendered = value.toString();
    }
    throw new LaneMismatchError({ boundary, binding, value: rendered });
  }

  /**
   * A user-legible name for parameter `i` of user function `h` whose literal
   * is `literal`: the authored identifier when the parameter has one, else an
   * honest positional description.
   */
  private static userParamBinding(
    h: string,
    literal: (Expression & FunctionInterface) | undefined,
    i: number
  ): string {
    const p = literal?.ops[i + 1];
    const name = p !== undefined ? functionLiteralParameterName(p) : undefined;
    return name
      ? `the parameter \`${name}\` of \`${h}\``
      : `parameter ${i + 1} of \`${h}\` (unnamed)`;
  }

  /**
   * The effective compile mode for `target`: its requested `mode` when set
   * and offered by its `supportedModes` (default `['strict']`), else the
   * target's default — `'auto'` when offered, otherwise `'strict'`.
   *
   * A REQUESTED mode the target does not offer throws a `CompileDeclineError`
   * (`code: 'unsupported-mode'`, `kind: 'capability'`): the caller asked for
   * a discipline this target cannot deliver, and silently compiling in
   * another would hand back code whose value shape the caller did not ask
   * for.
   */
  static resolveCompileMode(target: CompileTarget<Expression>): CompileMode {
    const supported: readonly CompileMode[] = target.supportedModes ?? [
      'strict',
    ];
    const requested = target.mode;
    if (requested === undefined)
      return supported.includes('auto') ? 'auto' : 'strict';
    if (!supported.includes(requested))
      throw new CompileDeclineError({
        code: 'unsupported-mode',
        kind: 'capability',
        message: `mode '${requested}' is not offered by the '${
          target.language ?? 'custom'
        }' compilation target (offered: ${supported
          .map((m) => `'${m}'`)
          .join(', ')}). Fail closed (D6).`,
      });
    return requested;
  }

  /**
   * The target languages whose `Sqrt`/`Ln`/`Log` emitters consult
   * `promotesRadicalToComplex`, and so may honor the `complexPromotion`
   * option. Any other language — the shader targets, the interval target, a
   * caller's custom target — keeps the real kernel unconditionally, because
   * its emitters would otherwise disagree with the analysis about a node's
   * value shape.
   */
  private static readonly COMPLEX_PROMOTION_LANGUAGES = new Set([
    'javascript',
    'python',
  ]);

  /** The heads whose real kernel can silently swallow a complex result. */
  private static readonly PROMOTABLE_RADICAL_HEADS = new Set([
    'Sqrt',
    'Ln',
    'Log',
  ]);

  /**
   * Is `expr` PROVABLY non-negative under the premise the strict-shaped
   * analysis already makes — that a WIDE-typed value is REAL? The engine's
   * own `isNonNegative` answers `undefined` for `x²` when `x` is wide,
   * because a complex `x` has a negative square; but the compiler treats
   * that `x` as real, so `√(x² + y²)` — the distance and norm shape, the
   * commonest radical in a plot — must keep the real kernel rather than
   * promote (Tycho item 144: `√(⌈x⌉² + ⌈y⌉²)` stays on the fast path).
   *
   * Sound because the premise IS the compiled contract: under strict/auto a
   * wide binding holds a real (the D3 entry check refuses an object), and
   * under complex mode a wide operand is complex-valued and takes the complex
   * kernel before this predicate is consulted. A value TYPED non-real is not
   * real-assumed and answers `false` (unless the engine proves it).
   *
   * Recognized: a non-negative literal; the engine's own proof; `Abs`,
   * `Exp`, `Square`, an even integer `Power` of a real-assumed operand; a
   * sum, product or quotient of recognized operands; a `Sqrt` of one.
   */
  static assumedRealNonNegative(expr: Expression): boolean {
    if (expr.isNonNegative === true) return true;
    if (isNumber(expr)) return expr.im === 0 && expr.re >= 0;
    if (!isFunction(expr)) return false;
    const t = expr.type?.type;
    if (t !== undefined && isNonRealNumber(t)) return false;
    const realAssumed = (e: Expression): boolean => {
      const et = e.type?.type;
      return et === undefined || !isNonRealNumber(et);
    };
    const h = expr.operator;
    const ops = expr.ops;
    if (h === 'Abs' || h === 'Exp')
      return ops.length === 1 && realAssumed(ops[0]);
    if (h === 'Square') return ops.length === 1 && realAssumed(ops[0]);
    if (h === 'Power' && ops.length === 2) {
      const e = ops[1];
      return (
        isNumber(e) &&
        e.im === 0 &&
        Number.isInteger(e.re) &&
        e.re % 2 === 0 &&
        realAssumed(ops[0])
      );
    }
    if (h === 'Sqrt' && ops.length === 1)
      return BaseCompiler.assumedRealNonNegative(ops[0]);
    if (h === 'Add' || h === 'Multiply' || h === 'Divide')
      return ops.every((o) => BaseCompiler.assumedRealNonNegative(o));
    return false;
  }

  /**
   * Whether applying `head` to `args` takes the COMPLEX lane purely because
   * the caller opted in to complex promotion (`complexPromotion`).
   *
   * The rule is deliberately NOT "the node's type admits complex". That test
   * is too weak in both directions and misses the case the option exists for:
   * `√(t−1)` types the wide `finite_number` — not a non-real type — whenever
   * `t` is an undeclared symbol or an `unknown` parameter, which is exactly
   * the shape a user function's body has. Keying off the type there would
   * leave the option inert on its own witness.
   *
   * So the rule is the mathematical one: the real kernel is safe only when the
   * operand is PROVABLY non-negative, and anything else may promote at run
   * time, which is what the interpreter does. `isNonNegative` is three-valued
   * and answers `undefined` for most symbolic operands; only an explicit
   * `true` keeps the real kernel.
   *
   * Both `isComplexValued` and every target emitter for these heads route
   * through this one predicate, so parent and child always agree on the value
   * SHAPE — the invariant compiled correctness rests on.
   */
  static promotesRadicalToComplex(
    head: MathJsonSymbol,
    args: ReadonlyArray<Expression>
  ): boolean {
    // The `auto` and `complex` disciplines promote (design §2: "unknown-sign
    // radicals/logarithms promote" — the interpreter's `√(−1)`, `ln(−2)` fall
    // out), as does the deprecated `complexPromotion` opt-in; strict never.
    if (!BaseCompiler.promotionActive) return false;
    // Broadcast closures re-invoke the head's scalar codegen on synthetic
    // element temps, which carry no sign or type information of their own —
    // deriving the verdict from a temp PROMOTES shapes whose real operands
    // are provably non-negative. Measured: `√(x²+L²)` with a list-valued `L`
    // emitted `_SYS.csqrt` while the downstream analysis, reading the real
    // radicand, said real — the producer/consumer divergence behind
    // `"[object Object]-1"` string concatenation on the composed `−1`. The
    // verdict for such a closure is therefore decided ONCE, on the
    // node-level operands (in `tryCompileBroadcast`), and recorded; a call
    // whose arguments are exactly that closure's element temps returns the
    // recorded verdict. This is also what keeps a broadcast `Power` honest:
    // its literal exponent is elementized into a temp, so `isNumber(exp)`
    // below could never see it. `notePromoted` is not re-fired here — the
    // node-level decision already ran it.
    for (
      let i = BaseCompiler._broadcastRadicalVerdict.length - 1;
      i >= 0;
      i--
    ) {
      const frame = BaseCompiler._broadcastRadicalVerdict[i];
      if (
        frame.head === head &&
        args.length > 0 &&
        args.every(
          (a) => a !== undefined && isSymbol(a) && frame.params.has(a.symbol)
        )
      )
        return frame.promotes;
    }
    if (head === 'Power') {
      // `Power` of an unknown-sign base with a PROVABLY non-integer exponent
      // (`x^{0.3}`, `x^{2/3}`; `(−8)^{1/3}` is the interpreter's principal
      // complex value): the real `Math.pow` is `NaN` there. An integer or
      // unknown exponent keeps the real lowering — a variable exponent may be
      // an integer at run time, and promoting it would move every `x^y` off
      // the real kernel.
      const [base, exp] = args;
      if (base === undefined || exp === undefined) return false;
      if (!isNumber(exp) || Number.isInteger(exp.re) || exp.im !== 0)
        return false;
      if (BaseCompiler.assumedRealNonNegative(base)) return false;
      if (base.isNegative !== true && !isNonRealNumber(base.type.type))
        BaseCompiler.notePromoted();
      return true;
    }
    if (!BaseCompiler.PROMOTABLE_RADICAL_HEADS.has(head)) return false;
    // `Log(x, b)`: a negative BASE makes the quotient complex too, so every
    // operand has to clear the bar. An omitted operand cannot be cleared.
    if (
      !args.some(
        (a) => a === undefined || !BaseCompiler.assumedRealNonNegative(a)
      )
    )
      return false;
    // `promoted` reports a lane DIFFERENCE with the shader targets: a
    // PROVABLY negative operand, or one TYPED complex, is complex-shaped on
    // every target and in every mode (not a promotion); only a real-shaped
    // operand of UNKNOWN sign is.
    if (
      args.some(
        (a) =>
          a !== undefined &&
          a.isNonNegative !== true &&
          a.isNegative !== true &&
          !isNonRealNumber(a.type.type)
      )
    )
      BaseCompiler.notePromoted();
    return true;
  }

  /**
   * Whether a call to a USER-defined function produces a complex value —
   * decided by looking through to its body, analyzed with the parameters
   * shielded (typed as declared, never read through the engine).
   *
   * What happens inside the emitted `_fn_…` that the call site's type does
   * not describe: under a PROMOTING discipline the body itself promotes —
   * with `z(t) := √(t−1)`, `_fn_z` returns `{re, im}` while the call `z(t)`
   * types the wide `finite_number` and would otherwise be read as a plain
   * number (`Math.abs(0.5 * {re,im} + -1)`, `NaN` everywhere: item 190's
   * exact witness).
   *
   * Without the opt-in this answers only when some lane IS complex, and
   * declines (`undefined`) otherwise: the default carve-out keeps a merely
   * promotable body on the real kernel, so for every other default-path call
   * the ordinary type-based answer already agrees with the emission, and the
   * decline keeps that emission byte-identical.
   *
   * The parameters are shielded during the body analysis, exactly as for a
   * `Function` literal operand (`binderParts`) — with the complex-lane ones
   * additionally bound complex — and `visited` declines self- and mutual
   * recursion rather than looping.
   */
  private static isComplexValuedUserCall(
    expr: Expression & { ops: ReadonlyArray<Expression> },
    visited: Set<string>
  ): boolean | undefined {
    const op = expr.operator;
    if (typeof op !== 'string' || visited.has(op)) return undefined;
    const literal = BaseCompiler.userFunctionLiteral(expr.engine, op);
    if (literal === undefined) return undefined;
    const body = literal.ops[0];
    if (body === undefined) return undefined;
    // A body that may build a COLLECTION is not classifiable this way and must
    // decline. `isComplexValued` answers for a list from `ops.some(…)`, so a
    // single complex ELEMENT would report the whole call complex — and the
    // scalar extracted from it inherits that verdict, because `At` has an
    // `unknown` result type. Measured before this guard, with
    // `g(t) := [√(t−1), 1]` under the opt-in: `g(t)[2] + 1` emitted
    // `{re: _tv.re + 1, im: _tv.im}` around the plain number `1` and returned
    // `{re: null}` instead of `2`. Declining here falls through to the
    // ordinary analysis, which is what classified such calls before the
    // look-through existed. Element-level complexness has its own separate
    // handling (the list emitters' own element test).
    //
    // Both predicates are needed and neither subsumes the other:
    // `type.matches('collection')` catches a body whose type is DEFINITELY a
    // collection (`[√(t−1), 1]` types `vector<finite_number^2>`), while
    // `isPossiblyCollectionTyped` catches the merely POSSIBLE ones — a
    // `broadcastable<T>` or top-typed body, for which the former is false.
    if (body.type.matches('collection<any>') || isPossiblyCollectionTyped(body))
      return undefined;
    // The parameters are shielded — bound as declared, never read through
    // the engine — the same binding the emitted definition compiles under,
    // so this verdict describes the value the call actually returns.
    // The body is looked through only under a PROMOTING discipline: a radical
    // inside `a(t) := √(t−1)` promotes THERE, and the call's wide result type
    // would otherwise report it real (item 190's witness). Under strict
    // shapes without promotion the type-based answer below is exact.
    if (!BaseCompiler.promotionActive) return undefined;
    const mask = BaseCompiler.userCallMask(literal);
    const nextVisited = new Set(visited);
    nextVisited.add(op);
    const prevVisited = BaseCompiler._userCallVisited;
    BaseCompiler._userCallVisited = nextVisited;
    try {
      return BaseCompiler.withBinderMask(mask, () =>
        BaseCompiler.isComplexValued(body)
      );
    } finally {
      BaseCompiler._userCallVisited = prevVisited;
    }
  }

  /**
   * The binder mask under which a user function's body is ANALYZED for a call
   * site with lanes `lanes`: every parameter shielded (a parameter is not a
   * free engine symbol, so the engine-value fallback must not read through
   * it — but its declared type stays in play, since a typed parameter can
   * legitimately be complex), and the complex-lane parameters bound complex.
   */
  private static userCallMask(literal: Expression & FunctionInterface): {
    real: string[];
    shielded: string[];
    complex: string[];
  } {
    const shielded: string[] = [];
    for (const p of literal.ops.slice(1)) {
      const name = functionLiteralParameterName(p);
      if (name) shielded.push(name);
    }
    return { real: [], shielded, complex: [] };
  }

  /** Heads already being looked through by `isComplexValuedUserCall`. */
  private static _userCallVisited: Set<string> = new Set();

  /**
   * A user function's body reduced to the literal collection CONSTRUCTOR it
   * builds, so that operand k of the result is component k of the value the
   * call produces. Returns `undefined` when the body is anything else, and the
   * caller then declines to answer for an individual element.
   *
   * Used by {@link withCollectionElements}, whose whole premise is that the
   * emitter lowers component k from operand k — so only constructors with that
   * one-to-one correspondence may be returned here.
   */
  private static collectionConstructorBody(
    body: Expression | undefined
  ): (Expression & { ops: ReadonlyArray<Expression> }) | undefined {
    // A function body is stored as a `Block`, and a declared result type wraps
    // the value in a `Typed` ascription. Unwrap both, but only a SINGLE-
    // statement block: a multi-statement body binds locals whose complex-ness
    // `isBlockValueComplexValued` infers with a frame this element analysis
    // does not build, so guessing here could disagree with the emitter.
    let e = body;
    while (
      e !== undefined &&
      ((isFunction(e, 'Block') && e.ops.length === 1) ||
        (isFunction(e, 'Typed') && e.ops.length >= 1))
    )
      e = e.ops[0];
    if (e === undefined) return undefined;
    if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e;
    // An ALL-SCALAR `PointList` is a single point whose component k is operand
    // k — the same equivalence the JavaScript target already relies on, where
    // the `PointList` definition handler lowers that shape itself "byte-
    // identically to `Tuple`" and only the other shapes reach
    // `compileJSPointList`. Requiring every operand to be provably numeric is
    // what excludes those other shapes: a component that is (or may be) an
    // indexed collection is a SOURCE, zipped across points, so operand k is
    // then not component k and the identification would be wrong.
    if (
      isFunction(e, 'PointList') &&
      e.ops.length > 0 &&
      e.ops.every((op) => op.type.matches('number'))
    )
      return e;
    return undefined;
  }

  /**
   * Resolve `collection` to the element expressions the emitter will lower one
   * by one, and run `fn` over them in the context those elements are analyzed
   * in. Returns `undefined` — and the caller then keeps its previous answer —
   * when the elements cannot be identified.
   *
   * Two routes: the collection is itself a literal constructor, or it is a call
   * to a user function whose body is one. The second route runs `fn` with the
   * function's PARAMETERS shielded, exactly as {@link isComplexValuedUserCall}
   * shields them for a scalar body — the elements mention those parameters, and
   * reading a same-named engine symbol's value through one would analyze the
   * wrong definition. It also declines a head already being looked through, so
   * a self- or mutually-recursive definition terminates instead of looping.
   */
  private static withCollectionElements<T>(
    collection: Expression,
    fn: (elements: ReadonlyArray<Expression>) => T | undefined
  ): T | undefined {
    if (isFunction(collection, 'List') || isFunction(collection, 'Tuple'))
      return fn(collection.ops);
    if (!isFunction(collection)) return undefined;
    const op = collection.operator;
    if (typeof op !== 'string' || BaseCompiler._userCallVisited.has(op))
      return undefined;
    const literal = BaseCompiler.userFunctionLiteral(collection.engine, op);
    if (literal === undefined) return undefined;
    const body = BaseCompiler.collectionConstructorBody(literal.ops[0]);
    if (body === undefined) return undefined;
    // Same binding as `isComplexValuedUserCall`: the elements mention the
    // parameters, which are shielded (typed as declared, never read through
    // the engine).
    const mask = BaseCompiler.userCallMask(literal);
    const nextVisited = new Set(BaseCompiler._userCallVisited);
    nextVisited.add(op);
    const prevVisited = BaseCompiler._userCallVisited;
    BaseCompiler._userCallVisited = nextVisited;
    try {
      return BaseCompiler.withBinderMask(mask, () => fn(body.ops));
    } finally {
      BaseCompiler._userCallVisited = prevVisited;
    }
  }

  /**
   * Whether ELEMENT `index` (1-based) of the indexed collection `collection` is
   * complex-valued, when that element can be identified statically. Returns
   * `undefined` when it cannot be — a collection whose elements
   * {@link withCollectionElements} cannot see, or an index past their end — and
   * the caller then keeps its previous, whole-collection answer.
   *
   * Needed because a list is emitted ELEMENT BY ELEMENT and each element picks
   * its own real-vs-complex lowering, so the run-time array is heterogeneous:
   * `[i·t, 1]` lowers to `[{re, im}, 1]`. The whole-list verdict
   * (`ops.some(isComplexValued)`, the generic recursion the caller falls back
   * to) therefore describes NO single element, and reading one through it is
   * wrong in both directions. Measured at `t = 0.3` before this, on the DEFAULT
   * path with no compile option set:
   *
   * | shape                | compiled              | interpreter |
   * | -------------------- | --------------------- | ----------- |
   * | `[i·t, 1][2] + 1`    | `{re: NaN}`           | `2`         |
   * | `h(t)[1] + 1`        | the STRING `"…1"`     | `1 + 0.3i`  |
   *
   * — the first over-claims (the whole list is complex, so the plain number `1`
   * pulled out of it is read as `{re, im}` and `.re` is `undefined`), the second
   * under-claims (a call to `h(t) := [i·t, 1]` is classified real, so the
   * `{re, im}` pulled out of it is added to a number and JavaScript
   * concatenates the object instead). Both are silently wrong values behind
   * `success: true`.
   *
   * Reading the element the emitter will actually produce answers both.
   */
  private static isComplexValuedElementAt(
    collection: Expression,
    index: number
  ): boolean | undefined {
    const elements = BaseCompiler.elementComplexness(collection);
    if (elements === undefined) return undefined;
    // A NEGATIVE index counts back from the end — `At([10, 20, 30], -1)`
    // compiles to `30`, so `-1` is the last element, not an invalid one.
    // Treating it as invalid left it on the whole-collection verdict and
    // reintroduced the exact over-claim this method exists to remove:
    // `[i·t, 1][-1] + 1` ran to `{re: NaN}` where the interpreter answers `2`,
    // because `-1` selects the REAL element.
    const i = index < 0 ? elements.length + index : index - 1;
    // Any index that selects nothing — zero, fractional, or past either end —
    // lowers to the plain number `NaN`, not a complex object. That is a real
    // value, so answer `false` rather than declining: declining would hand the
    // node back to the whole-collection verdict, which reports complex for any
    // collection holding one complex element and would read that `NaN` as
    // `{re, im}`.
    if (!Number.isInteger(index) || i < 0 || i >= elements.length) return false;
    return elements[i];
  }

  /**
   * The complex-ness of each element the emitter will lower for the indexed
   * collection `collection`, one verdict per element — or `undefined` when the
   * elements cannot be identified and the caller must keep its previous,
   * whole-collection answer.
   *
   * Two sources, and the second is what makes the analysis compose. A literal
   * collection constructor, or a call to a user function whose body is one, has
   * its elements read directly ({@link withCollectionElements}). An ELEMENT-WISE
   * ARITHMETIC node over such a collection — `Multiply(2, w(t))` — has no
   * elements of its own: the JavaScript target lowers it through a `_SYS.bcast`
   * closure that applies the head to element k of every collection operand and
   * to the scalar operands whole, so element k of the result is complex exactly
   * when one of those is. Only the heads that PROPAGATE complex-ness from their
   * operands qualify (`COMPLEX_PROPAGATING_HEADS`); a head whose emitter picks
   * its lowering from the node TYPE instead (`Power`, `Root`, the inverse trigs)
   * would not follow this rule and is left to decline.
   *
   * Reading arithmetic this way is what lets an enclosing form see the elements
   * the closure actually produces. Under `complexPromotion` with
   * `w(t) := [√(t−1), √(t−2)]`, `_fn_w` returns `[{re, im}, {re, im}]`, so
   * `2·w(t)` is an array of complex objects; without this route an enclosing
   * `(2·w(t))[1] + 1` would classify the whole `Multiply` from
   * `isComplexValued` — a scalar verdict describing no element, which answers
   * `false` here — and add `1` to an object.
   */
  private static elementComplexness(
    collection: Expression
  ): boolean[] | undefined {
    const direct = BaseCompiler.withCollectionElements(
      collection,
      (elements) => {
        const out: boolean[] = [];
        for (const e of elements) {
          const v = BaseCompiler.broadcastLeafComplexness(e);
          // One element with no single answer leaves the whole collection with
          // none: a broadcast maps ONE closure over every position.
          if (v === undefined) return undefined;
          out.push(v);
        }
        return out;
      }
    );
    if (direct !== undefined) return direct;

    if (
      !isFunction(collection) ||
      !BaseCompiler.COMPLEX_PROPAGATING_HEADS.has(collection.operator)
    )
      return undefined;

    let n: number | undefined = undefined;
    const perOperand: (boolean | boolean[])[] = [];
    for (const op of collection.ops) {
      // The same operand predicate `tryCompileBroadcast` uses to decide which
      // operands the closure sees element-wise; everything else is a scalar it
      // sees whole.
      if (
        op.isCollection ||
        op.type.matches('list<any>') ||
        op.type.matches('indexed_collection<any>') ||
        isBoundPossiblyCollectionTyped(op)
      ) {
        const elts = BaseCompiler.elementComplexness(op);
        if (elts === undefined) return undefined;
        // `_SYS.bcast` projects a LENGTH MISMATCH to NaN rather than zipping to
        // the shortest operand, so mismatched lengths produce no elements at
        // all and there is nothing here to describe.
        if (n !== undefined && elts.length !== n) return undefined;
        n = elts.length;
        perOperand.push(elts);
      } else perOperand.push(BaseCompiler.isComplexValued(op));
    }
    // No operand contributes elements: this is scalar arithmetic, not a
    // collection, and the element question does not apply to it.
    if (n === undefined) return undefined;

    const out: boolean[] = [];
    for (let i = 0; i < n; i++)
      out.push(perOperand.some((p) => (Array.isArray(p) ? p[i] : p)));
    return out;
  }

  /**
   * The complex-ness of ONE element of a collection, as the broadcast closure
   * will see it — or `undefined` when it has no single answer.
   *
   * A scalar element is what the closure's parameter holds, so its own verdict
   * is the answer. A NESTED element is not: `_SYS.bcast` descends through every
   * array it is handed and applies the closure at the LEAVES, so a nested
   * element's convention is the one all of its leaves share, and it has none
   * when they disagree.
   *
   * Answering a nested element with `isComplexValued` — the whole-collection
   * verdict — is the same category error this analysis exists to remove, one
   * level down. Measured on the DEFAULT path before this guard:
   * `2·[[1+i, 2], [3+i, 4]]` reported both outer elements complex, installed a
   * complex closure, and ran to
   * `[[{re: 2, im: 2}, {re: NaN, im: NaN}], [{re: 6, im: 2}, {re: NaN, im: NaN}]]`
   * where the interpreter answers `[[2+2i, 4], [6+2i, 8]]` — the real leaves
   * `2` and `4` had `.re` read off them.
   */
  private static broadcastLeafComplexness(
    element: Expression
  ): boolean | undefined {
    // Not a collection: the closure receives this value itself. The
    // possibly-collection arm is the BOUND predicate, matching
    // `elementComplexness`'s own operand test and `tryCompileBroadcast`'s
    // `isArrayOperand` — the three decide the same question (does this node
    // reach the closure as an array?) and must not drift apart.
    // (`isComplexValued` itself answers fold-first for a closed real-valued
    // constant — see `_withFoldedRealOverride` — so an exact
    // `√(5−√5)`-class element reads as the plain number its emission
    // inlines.)
    if (
      !(
        element.isCollection ||
        element.type.matches('list<any>') ||
        element.type.matches('indexed_collection<any>') ||
        isBoundPossiblyCollectionTyped(element)
      )
    )
      return BaseCompiler.isComplexValued(element);
    // A collection whose own elements cannot be identified has no leaf
    // verdict to report, and its whole-collection one describes none of them.
    const nested = BaseCompiler.elementComplexness(element);
    if (nested === undefined || nested.length === 0) return undefined;
    return nested.every((e) => e === nested[0]) ? nested[0] : undefined;
  }

  /**
   * The complex-ness every element of `collection` shares, or `undefined` when
   * they do not all share one (or cannot be identified).
   *
   * This is the answer for an indexed read whose index is only known at RUN
   * time: no single element can be named, but when they all agree the verdict
   * holds whichever one the index selects.
   *
   * When the elements disagree, no static answer exists and this declines. The
   * read is then refused outright rather than lowered on a guess — see
   * {@link assertNoAmbiguousComplexElementRead}.
   */
  private static uniformElementComplexness(
    collection: Expression
  ): boolean | undefined {
    const elements = BaseCompiler.elementComplexness(collection);
    if (elements === undefined || elements.length === 0) return undefined;
    return elements.every((e) => e === elements[0]) ? elements[0] : undefined;
  }

  /**
   * Whether an `At` index selects a sub-collection rather than a single scalar
   * — a gather (`At(L, [1, 3])`) or a boolean mask, both of which the
   * JavaScript `At` lowering supports. Such a read produces a list, not an
   * element, so neither the per-element answer nor the mixed-element decline
   * applies to it; the enclosing analysis keeps whatever it did before.
   *
   * Covers an index that is only possibly a collection as well as a definite
   * one, because the distinction it guards is about which lowering runs, and a
   * `broadcastable`/top-typed index could take either at run time.
   */
  private static isGatherIndex(index: Expression): boolean {
    return (
      index.type.matches('collection<any>') ||
      index.isCollection === true ||
      isPossiblyCollectionTyped(index)
    );
  }

  private static hasAnyComplexElement(collection: Expression): boolean {
    return BaseCompiler.elementComplexness(collection)?.some((e) => e) ?? false;
  }

  /**
   * Whether the elements of `collection` are identifiable and disagree about
   * being complex-valued — the case {@link uniformElementComplexness} declines
   * for a reason other than not being able to see the elements at all.
   */
  private static hasMixedElementComplexness(collection: Expression): boolean {
    const elements = BaseCompiler.elementComplexness(collection);
    if (elements === undefined || elements.length < 2) return false;
    return elements.some((e) => e !== elements[0]);
  }

  /**
   * Fail closed on an indexed read whose element shape cannot be decided: the
   * collection mixes complex- and real-valued
   * elements, and the index is known only at run time.
   *
   * A list is emitted element by element and each element picks its own
   * real-vs-complex lowering, so `[i·t, 1]` lowers to the heterogeneous
   * `[{re, im}, 1]`. When the index is a literal, the element it selects is
   * known and {@link isComplexValuedElementAt} answers for that one. When every
   * element agrees, the shared verdict holds whichever the index selects
   * ({@link uniformElementComplexness}). Neither applies here, and there is no
   * third source of truth: the read is `{re, im}` for some indices and a plain
   * number for others, decided at run time.
   *
   * Emitting either representation would be wrong for some index. Declining
   * hands the expression to the interpreter, which indexes the value it
   * actually built.
   *
   * The narrowness is the point: an all-complex or all-real collection is
   * unaffected, a literal index is unaffected, and a collection whose elements
   * this analysis cannot see keeps whatever it did before.
   */
  private static assertNoAmbiguousComplexElementRead(
    h: string,
    args: ReadonlyArray<Expression>
  ): void {
    if (h !== 'At' || args.length !== 2) return;
    const index = args[1];
    // A literal index names its element. A COMPLEX index names none, but that
    // is a different defect from this one — leave it to whatever handles it.
    if (isNumber(index) || BaseCompiler.isComplexValued(index)) return;
    // A GATHER selects a sub-collection rather than one scalar, so the
    // ambiguity this guard is about does not arise — its result is a list whose
    // own elements the enclosing analysis handles. `At([10, 20, 30], [2])`
    // compiles to `[20]` today, and declining it would be a pure regression.
    if (BaseCompiler.isGatherIndex(index)) return;
    if (!BaseCompiler.hasMixedElementComplexness(args[0])) return;
    throw new Error(
      `At: cannot compile an indexed read with a run-time index into a ` +
        `collection that mixes complex-valued and real-valued elements — the ` +
        `element is a complex object for some indices and a plain number for ` +
        `others, so no single lowering is correct. Fail closed (D6) — the ` +
        `interpreter evaluates it. Use a literal index, or make every element ` +
        `complex-valued.`
    );
  }

  /**
   * Whether `expr` mentions any name that is BOUND in the current compilation
   * context — a user function's parameter, an enclosing binder's index, a
   * broadcast element (`_boundVarsCtx`, synced from `target.boundVars` by
   * `compile()`), or a name shielded by a binder being analyzed rather than
   * compiled (`_binderShield`).
   *
   * Such a name shadows any same-named engine symbol, so reading a VALUE
   * through it (`.re`, `_getSymbolValue`) dereferences the wrong definition.
   * This is the predicate half of the rule `isComplexValued` already applies
   * for complex-ness.
   */
  private static mentionsCompileBoundName(expr: Expression): boolean {
    if (isSymbol(expr)) return BaseCompiler.isCompileBoundName(expr.symbol);
    if (isFunction(expr)) {
      // The application HEAD counts as a mention, exactly as it does in
      // `mentionsExcludedName` below: a call whose head is a bound name applies
      // that BINDING, so evaluating the call through the engine here would
      // apply a same-named engine definition instead and bake ITS result as a
      // constant. Inside the literal `(g) ↦ g(2)`, with an engine-level
      // `g = x ↦ x + 1` in scope, `g(2)` folded to 3 and the literal compiled
      // to `(g) => 3` — ignoring its argument, and disagreeing with the
      // interpreter, which applies the parameter.
      if (BaseCompiler.isCompileBoundName(expr.operator)) return true;
      return expr.ops.some((op) => BaseCompiler.mentionsCompileBoundName(op));
    }
    return false;
  }

  /** Whether `name` is bound in the current compilation context — see
   * {@link mentionsCompileBoundName}, whose two mention sites (a value-position
   * symbol and an application head) share this test. */
  private static isCompileBoundName(name: string): boolean {
    if (BaseCompiler._boundVarsCtx?.has(name)) return true;
    for (let i = BaseCompiler._binderShield.length - 1; i >= 0; i--)
      if (BaseCompiler._binderShield[i].has(name)) return true;
    return false;
  }

  /**
   * Whether `expr` mentions — as a value-position symbol OR as an application
   * head — any name in `vars` (the caller's `vars`-mapped runtime inputs) or
   * `ops` (`CompileTarget.foldExcludedOps`, operator names whose emission the
   * caller overrode). Either kind of mention makes a subtree unsafe to
   * constant-fold: a `vars`-mapped symbol stays a live input even when it has
   * an engine value, and a caller-overridden operator must run the caller's
   * implementation, which compile-time evaluation through the engine would
   * bypass.
   */
  private static mentionsExcludedName(
    expr: Expression,
    vars: ReadonlySet<string> | undefined,
    ops: ReadonlySet<string> | undefined
  ): boolean {
    if (isSymbol(expr)) {
      const s = expr.symbol;
      return vars?.has(s) === true || ops?.has(s) === true;
    }
    if (isDictionary(expr))
      return expr.values.some((v) =>
        BaseCompiler.mentionsExcludedName(v, vars, ops)
      );
    if (isFunction(expr)) {
      if (ops?.has(expr.operator) === true) return true;
      return expr.ops.some((op) =>
        BaseCompiler.mentionsExcludedName(op, vars, ops)
      );
    }
    return false;
  }

  /**
   * Whether the subtree contains a `Sum`/`Product` with a non-finite bound in
   * an INDEXING-SET operand (everything after the body: `Limits`, `Element`,
   * and the raw spellings). Such a node must never constant-fold — see the
   * call site in `tryConstantFold`. The body/collection operand (`ops[0]`) is
   * deliberately not scanned at this node: an `∞` there belongs to a bounded
   * lazy pipeline (`Take(Map(f, 1..∞), n)`), which evaluates finitely — but
   * it IS recursed into, so a nested unbounded big op inside it still trips.
   */
  private static containsUnboundedBigOp(expr: Expression): boolean {
    if (isDictionary(expr))
      return expr.values.some((v) => BaseCompiler.containsUnboundedBigOp(v));
    if (!isFunction(expr)) return false;
    if (expr.operator === 'Sum' || expr.operator === 'Product') {
      const ops = expr.ops;
      for (let i = 1; i < ops.length; i++)
        if (BaseCompiler.containsNonFiniteLiteral(ops[i])) return true;
    }
    return expr.ops.some((op) => BaseCompiler.containsUnboundedBigOp(op));
  }

  /** Whether the subtree contains a non-finite number literal, one of the
   * infinity symbols, or a symbol whose VALUE is non-finite (see
   * `containsUnboundedBigOp`). */
  private static containsNonFiniteLiteral(expr: Expression): boolean {
    if (isNumber(expr))
      return !Number.isFinite(expr.re) || !Number.isFinite(expr.im);
    if (isSymbol(expr)) {
      const s = expr.symbol;
      if (
        s === 'PositiveInfinity' ||
        s === 'NegativeInfinity' ||
        s === 'ComplexInfinity'
      )
        return true;
      // A symbol with an assigned non-finite value (`m := +∞` used as a
      // bound) is the same divergence hazard as a literal `∞`: it is not an
      // unknown, so no other gate declines it. `.re`/`.im` dereference the
      // assigned value; `NaN` (a valueless or non-numeric symbol) is not
      // "unbounded" — a NaN bound makes an empty walk, never a truncation.
      const re = expr.re;
      if (!Number.isNaN(re) && !Number.isFinite(re)) return true;
      const im = expr.im;
      if (!Number.isNaN(im) && !Number.isFinite(im)) return true;
      return false;
    }
    if (isDictionary(expr))
      return expr.values.some((v) => BaseCompiler.containsNonFiniteLiteral(v));
    if (isFunction(expr))
      return expr.ops.some((op) => BaseCompiler.containsNonFiniteLiteral(op));
    return false;
  }

  /**
   * Compile-time constant folding: when `expr` is a pure subtree with no free
   * variables, evaluate it now and emit the value as a target literal,
   * instead of lowering the computation structurally. Returns `undefined`
   * whenever folding is unsafe, over budget, or the value is not a number or
   * boolean — the caller then compiles the subtree as before, so a declined
   * fold is never an error.
   *
   * The folded value is the interpreter's (`.N()`), which is the parity
   * direction this compiler already commits to elsewhere (see
   * `negativeBaseRealPow` in constant-folding.ts): compiled output tracks
   * `evaluate()`, even where the structural code's different operation order
   * would round the last ulp differently.
   *
   * Safety gates, in cost order:
   * - `constantFold: false` on the target (codegen tests use this);
   * - free variables (`unknowns`) — checked FIRST and always before `.N()`
   *   (an argument with unknowns can never become a literal, and `.N()` over
   *   nested user-function applications is exponentially more expensive than
   *   the check — the gate convention of `boxed-expression/numerics.ts`);
   * - impurity (`Random(…)` and friends must keep drawing at run time);
   * - a static type that provably admits no number or boolean (a list- or
   *   string-valued subtree cannot fold to a literal; skip the evaluation);
   * - names bound by an enclosing binding form (lambda parameters, loop
   *   indices — the evaluator would read the engine symbol they shadow);
   * - `vars`-mapped symbols and caller-overridden operators
   *   (`mentionsExcludedName`).
   *
   * The evaluation runs under a short deadline (`withTimeLimit` nests as
   * `min()`, so a tighter ambient deadline still governs) and under the
   * engine's `maxCollectionSize` clamped to a fold-specific cap, so a
   * constant subtree over a huge range degrades to structural compilation
   * instead of stalling the compile. One accepted consequence: a deadline-
   * degradable numeric operator (adaptive quadrature is best-effort under a
   * deadline) folds to the estimate the budget allows — for a fully constant
   * call that is the value computed ONCE at compile time rather than on
   * every invocation, which is the point of folding it.
   */
  private static tryConstantFold(
    expr: Expression,
    target: CompileTarget<Expression>,
    prec: number
  ): TargetSource | undefined {
    // The `constantFold` opt-out governs what CODE is emitted, so it gates
    // only this emission entry — `constantFoldValue` stays available to the
    // shape analyses (`isProvablyRealValued`), whose answers describe the
    // runtime value and must not change with the emission style.
    if (target.constantFold === false) return undefined;
    const folded = BaseCompiler.constantFoldValue(expr, target);
    if (folded === undefined) return undefined;
    const { value, elements } = folded;
    const engine = expr.engine;

    // A constant COLLECTION folds to a literal of its elements, emitted
    // through the target's own lowering — `[1, 4, 9]` on JavaScript and
    // Python, `vec3(1.0, 4.0, 9.0)` / `float[5](…)` on the shader targets. So
    // `At(Map(_ ↦ _², 1..20), k)` with a run-time `k` indexes a baked array
    // instead of building the range and mapping over it on every call. (On the
    // shader targets that shape had no lowering at all and failed closed; a
    // folded literal base is one it can index.)
    //
    // The literal is rebuilt with the value's OWN aggregate head: a `Tuple`
    // must not come back as a `List`, because the two are different types
    // wherever the target spells them differently — a Python list is mutable
    // and unhashable, and `(1, 2) == [1, 2]` is `False` there, so folding a
    // tuple through the list lowering silently changed the value's type.
    if (elements !== undefined) {
      // A complex-ish collection does not fold AT ALL. The structural
      // lowering picks its element convention from a conservative static
      // analysis, and the evaluated values need not agree with it in either
      // direction: `Map(_ ↦ √_, [-4, -9, -16])` compiles structurally to the
      // real kernel `Math.sqrt`, so it yields `[NaN, NaN, NaN]`, while `.N()`
      // answers `[2i, 3i, 4i]` — and a mixed list like `[-4, 4]` would fold
      // to one complex element beside one bare number, a shape no consumer
      // can read uniformly. Whether an expression folds also depends on the
      // element cap and the evaluation budget, so admitting these would make
      // the emitted VALUES depend on those thresholds, not just the emitted
      // code. Decline the whole class and let the structural path define
      // both value and shape, as it did before folding existed.
      //
      // This costs the common case nothing: every real collection reports
      // `isComplexValued === false` (measured over Map/Range/Filter/list
      // literals), so only genuinely complex-ish aggregates are turned away.
      if (BaseCompiler.isComplexValued(expr)) return undefined;
      return BaseCompiler.emitFoldedValue(
        engine.function(isTuple(value) ? 'Tuple' : 'List', elements),
        target,
        prec
      );
    }

    const foldable =
      isNumber(value) || isSymbol(value, 'True') || isSymbol(value, 'False');
    if (!foldable) return undefined;

    // A boolean folds only when the target spells the boolean constants (the
    // JS target's `True`/`False` mappings). A target without a spelling
    // (Python, the shader targets) keeps its structural lowering.
    if (isSymbol(value, 'True') || isSymbol(value, 'False'))
      return target.var?.(value.symbol);

    // A complex-ish expression whose value comes back with NO imaginary part
    // does not fold at all. The structural lowering may return either shape
    // here — a bare number (`_SYS.at` over a real list, even when the INDEX
    // is complex) or the target's `{re, im}` complex convention (a call to a
    // function declared `-> complex`) — and which one it picks is a property
    // of the emitted code, not of any type this can read: the result type is
    // `number` in both directions, and `isComplexValued` answers for the
    // OPERANDS, so it is true for a real-valued `At` with a complex index.
    // Emitting the wrong one silently changes the shape a caller reads back
    // (`.re` working or not, depending only on whether the inputs happened to
    // be constant), so decline and let the structural path define the shape,
    // exactly as it did before folding existed. A value with a NONZERO
    // imaginary part is unambiguous and still folds, through the complex
    // literal path below.
    if (isNumber(value) && value.im === 0 && BaseCompiler.isComplexValued(expr))
      return undefined;

    // `~oo` on a node the surrounding code reads as a REAL number folds to
    // `NaN`, not to the `{re: ∞, im: ∞}` object the value itself carries.
    // A pole has no real value, and `NaN` is how the real lane spells that
    // (the same reasoning as `NO_REAL_VALUE_FOLD` in the JavaScript target);
    // emitting the complex object instead hands a parent that lowered real
    // arithmetic an object to add, which stringifies (`1 + {…}` →
    // `"1[object Object]"`). A node that really is complex-valued keeps the
    // object, so `~oo` reached through complex-emitting operands is unchanged.
    // `isInfinity` with a non-zero imaginary part is the `~oo` test: a real
    // ±∞ has `im === 0`, and an exact value whose imaginary part merely
    // OVERFLOWS the float projection is not infinite, so it answers `false`
    // here (see `BoxedNumber.isInfinity`).
    if (
      isNumber(value) &&
      value.isInfinity &&
      value.im !== 0 &&
      !BaseCompiler.isComplexValued(expr)
    )
      return BaseCompiler.emitFoldedValue(engine.NaN, target, prec);

    // Emit through the ordinary number-literal path so the target's own
    // spelling applies (float formatting, complex support, negative-literal
    // parenthesization).
    return BaseCompiler.emitFoldedValue(value, target, prec);
  }

  /**
   * The evaluated VALUE of a constant subtree, behind every fold gate except
   * the target's `constantFold` opt-out — shared by `tryConstantFold` (the
   * emission entry, which respects the opt-out) and by the shape analyses
   * (`isProvablyRealValued`), which need the runtime value's shape whether or
   * not the caller wants folded output. `elements` is the materialized
   * element list when the value is a foldable constant COLLECTION (see
   * `foldableCollectionElements`), computed inside the evaluation budget
   * since walking a lazy collection is real work.
   *
   * Every OTHER gate applies unchanged — in particular `symbolDeps` (an
   * implicit-compilation caller's capture set cannot record the engine state
   * an evaluation reads, and an analysis answer bakes into the cached kernel
   * just as folded code does) and the purity/unknowns/cost gates.
   */
  /**
   * Per-compilation memo of `constantFoldValue`'s post-gate EVALUATION
   * outcome, keyed per target then per expression. One compilation reaches
   * the same constant subtree from both the emission fold (`tryConstantFold`)
   * and the shape analyses (`isProvablyRealValued`), and the two MUST see the
   * same outcome: two independently budgeted evaluations of a
   * deadline-degradable operator (adaptive quadrature) could settle on
   * different estimates, letting the emitted literal and the wrap decision
   * disagree about the value's shape. The GATES are deliberately NOT
   * memoized — they read compile context (bound names, a target's
   * exclusions) that legitimately differs between call sites — and the
   * per-target keying is for `maxInlineElements`, which shapes the
   * materialized `elements`. Reset at each outermost compilation entry,
   * where engine symbol values may have changed (the complexness memo's
   * policy).
   */
  private static _foldValueMemo = new WeakMap<
    object,
    Map<
      Expression,
      { value: Expression; elements: Expression[] | undefined } | 'declined'
    >
  >();

  private static constantFoldValue(
    expr: Expression,
    target: CompileTarget<Expression>
  ): { value: Expression; elements: Expression[] | undefined } | undefined {
    // Re-entry from the emission of a value this fold already computed (see
    // `emitFoldedValue`) — there is nothing left to fold inside it.
    if (BaseCompiler._emittingFoldedValue) return undefined;

    // A caller recording the capture set (`CompileTarget.symbolDeps` — the
    // implicit-compilation cache key) gets NO subtree folding: the fold
    // consults engine state TRANSITIVELY (a folded user-function call reads
    // its callees' definitions, a folded symbol's value may read further
    // symbols), and unlike the leaf-level `tryFoldKnownSymbol` — whose
    // recursive compile of the value records each nested read — an evaluation
    // has no per-read hook, so the capture set would under-report and the
    // cache would serve the baked constant after a dependency changed.
    // Declining keeps the capture contract exact; the implicit-compile
    // kernels are dominated by non-constant subtrees anyway.
    if (target.symbolDeps !== undefined) return undefined;

    if (expr.unknowns.length > 0) return undefined;
    if (!expr.isPure) return undefined;

    const t = compilationType(expr);
    if (
      t !== 'unknown' &&
      t !== 'any' &&
      t !== 'value' &&
      !isSubtype(t, 'number') &&
      !isSubtype(t, 'boolean') &&
      !isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)
    )
      return undefined;

    // `indexed_collection` above is UNPARAMETRIZED, so it also admits
    // `list<string>`, `list<boolean>` and nested lists — none of which can
    // fold, since only number literals are inlined. Without this check the
    // decision would be deferred to `foldableCollectionElements`, i.e. until
    // AFTER a full `.N()` has materialized the collection (up to the
    // evaluation budget and the collection-size clamp), and it would be paid
    // again at every node the top-down walk reaches it from. When the element
    // type is statically known and is not numeric, decline here instead —
    // keeping this gate sequence's cheap-before-expensive ordering.
    const elementType = collectionElementType(t);
    if (
      elementType !== undefined &&
      elementType !== 'unknown' &&
      elementType !== 'any' &&
      elementType !== 'value' &&
      !isSubtype(elementType, 'number')
    )
      return undefined;

    if (BaseCompiler.mentionsCompileBoundName(expr)) return undefined;
    // A `Sum`/`Product` whose indexing set has a NON-FINITE bound never
    // folds: for a divergent series the interpreter's `.N()` silently
    // returns an iteration-limit-truncated PARTIAL sum (`Σ i, i=1..∞` →
    // 50015001, the 10001-term prefix), and baking that as a compile-time
    // constant would put a mathematically wrong number behind
    // `success: true` where the structural lowering deliberately fails
    // closed (D6). Convergent infinite series decline too — telling the two
    // apart is exactly what the fold cannot do — and keep their pre-fold
    // behavior (fail closed, interpreter fallback at run time). A BOUNDED
    // infinite pipeline (`Sum(Take(Map(_ ↦ _^2, 1..∞), 10))`) has its `∞`
    // inside the collection operand, not an indexing set, and still folds.
    if (BaseCompiler.containsUnboundedBigOp(expr)) return undefined;
    if (
      (target.varsKeys !== undefined || target.foldExcludedOps !== undefined) &&
      BaseCompiler.mentionsExcludedName(
        expr,
        target.varsKeys,
        target.foldExcludedOps
      )
    )
      return undefined;
    // `quadrature: 'monte-carlo'` is an explicit request for the stochastic
    // runtime estimator — a DIFFERENT result on each call, by contract.
    // Folding a constant integral to one fixed value would override that
    // request, so integrals stay structural under it.
    if (
      target.quadrature === 'monte-carlo' &&
      BaseCompiler.mentionsExcludedName(
        expr,
        undefined,
        MONTE_CARLO_FOLD_EXCLUSIONS
      )
    )
      return undefined;

    const engine = expr.engine;
    let value: Expression | undefined;
    // The materialized elements when the value is a foldable constant
    // COLLECTION (assigned inside the budget below, since walking a lazy
    // collection is real work).
    let elements: Expression[] | undefined;
    // Evaluation may re-enter compilation (large `Map` callbacks are
    // auto-compiled during evaluate); that inner compilation must not inherit
    // THIS compilation's bound-name context, or its analysis would treat the
    // evaluated expression's own names as shadowed.
    const savedBoundCtx = BaseCompiler._boundVarsCtx;
    const savedShield = BaseCompiler._binderShield;
    const savedMaxCollectionSize = engine.maxCollectionSize;
    // ANGULAR UNIT — a CORRECTNESS requirement, not a tuning knob.
    //
    // `rewriteAngularUnit` runs at the compile entry and puts the tree into
    // the RADIAN convention, so under `angularUnit: 'deg'` the subtree
    // reaching this point is `sin(90 * 0.01745…)`, not `sin(90)` (visible in
    // the emitted code of an unfolded compile). Evaluating that through
    // `.N()` on an engine still set to degrees applied the conversion a
    // SECOND time: `sin(90)` folded to 0.0274 — the sine of 90° re-read as
    // degrees — instead of 1, and `arctan(1)` to 2578.31 (45 × 180/π) on the
    // way out. Silently wrong compiled output, disagreeing with
    // interpretation, for every angular function with a CONSTANT argument on
    // a user-facing engine setting. (A free-variable argument was unaffected,
    // since only constant subtrees fold — which is why the bug's shape was
    // "constants only".) So the fold evaluates with the unit neutralized.
    //
    // EXCEPT under a derivative head. `rewriteAngularUnit` deliberately does
    // NOT rewrite the operands of `D`/`Derivative`/`ND` — differentiation is
    // unit-aware and must run in the engine's own convention, its closed form
    // being rewritten later where it is produced. A subtree containing one
    // therefore carries BOTH conventions at once and is correct under neither
    // single setting, so it is declined rather than folded: structural
    // compilation of that shape is already correct, and declining costs only
    // the fold.
    const savedAngularUnit = engine.angularUnit;
    const neutralizeAngle = savedAngularUnit !== 'rad';
    if (neutralizeAngle && containsDerivativeHead(expr)) return undefined;

    // The eligibility decision, and the LAST gate before the expensive part:
    // everything above is a cheap structural check, so the estimate is only
    // paid for a subtree that would otherwise be evaluated. It is a property
    // of the expression alone, which is what makes the compiled output
    // reproducible — see `CONSTANT_FOLD_MAX_COST`.
    // Spelled as a NEGATED "within budget" rather than "over budget": a
    // comparison against `NaN` is false either way, so `> ceiling` would have
    // ADMITTED an estimate that arithmetic had turned into `NaN` instead of
    // declining it. Only a finite estimate at or under the ceiling folds.
    if (!(BaseCompiler.foldCostEstimate(expr) <= CONSTANT_FOLD_MAX_COST))
      return undefined;
    // Every gate above re-ran for THIS call site's context; only the
    // evaluation below is shared (see `_foldValueMemo`).
    let byExpr = BaseCompiler._foldValueMemo.get(target);
    const hit = byExpr?.get(expr);
    if (hit !== undefined) return hit === 'declined' ? undefined : hit;
    BaseCompiler._boundVarsCtx = undefined;
    BaseCompiler._binderShield = [];
    try {
      engine.maxCollectionSize = Math.min(
        savedMaxCollectionSize,
        CONSTANT_FOLD_MAX_COLLECTION_SIZE
      );
      if (neutralizeAngle) engine.angularUnit = 'rad';
      value = engine.withTimeLimit(
        { ms: CONSTANT_FOLD_BUDGET_MS, label: 'compile:constant-fold' },
        () => {
          const v = expr.N();
          elements = BaseCompiler.foldableCollectionElements(
            v,
            target.maxInlineElements ?? CONSTANT_FOLD_MAX_INLINE_ELEMENTS
          );
          return v;
        }
      );
    } catch (e) {
      // The fold's own expired budget is a quiet decline — but a cancellation
      // raised because the AMBIENT (outer) deadline expired must keep
      // cancelling the whole compilation, not be swallowed as a fold miss.
      if (!engine._shouldContinueExecution()) throw e;
      value = undefined;
    } finally {
      BaseCompiler._boundVarsCtx = savedBoundCtx;
      BaseCompiler._binderShield = savedShield;
      engine.maxCollectionSize = savedMaxCollectionSize;
      engine.angularUnit = savedAngularUnit;
    }
    if (byExpr === undefined) {
      byExpr = new Map();
      BaseCompiler._foldValueMemo.set(target, byExpr);
    }
    if (value === undefined) {
      // A budget-expired evaluation is memoized too: a retry at the second
      // call site might land a DIFFERENT degraded estimate, which is exactly
      // the emit/analyze divergence this memo exists to prevent.
      byExpr.set(expr, 'declined');
      return undefined;
    }
    const result = { value, elements };
    byExpr.set(expr, result);
    return result;
  }

  /**
   * A DETERMINISTIC estimate of what evaluating `expr` at compile time will
   * cost, in abstract work units — the constant fold's eligibility test.
   *
   * Deterministic is the whole point: the decision depends only on the
   * expression, so one input always produces one compiled output (see
   * `CONSTANT_FOLD_MAX_COST` for the load-dependent behaviour this replaced).
   *
   * The estimate is deliberately an OVER-approximation, and it is MONOTONE —
   * a node never costs less than the sum of its parts. Monotonicity is
   * load-bearing rather than tidy: the fold is attempted top-down at every
   * node, so if a parent could estimate cheaper than a child, it could fold a
   * subtree the child had already refused, and the cost ceiling would depend
   * on where the walk happened to start.
   *
   * The multiplying constructs are the ones that actually decide cost:
   *
   * - a `Sum`/`Product` over a resolvable finite range costs its body once per
   *   iteration, so the body is multiplied by the trip count;
   * - a `Map`/`Filter` over a collection of resolvable size costs its callback
   *   once per element, likewise;
   * - an applied user function costs its own body, memoized by name in
   *   `FoldCostContext.cache` so a function reached from many call sites is
   *   analyzed once, with a separate in-progress set guarding recursion (a
   *   recursive definition has no static bound, so it declines).
   *
   * The estimator's own work is bounded by `CONSTANT_FOLD_MAX_VISITS` as well
   * as by depth, because it runs BEFORE the anti-hang deadline is armed and
   * so has no other backstop.
   *
   * Anything whose count cannot be resolved statically returns `Infinity` —
   * fail closed (D6), the same answer the depth bound gives, and the same
   * shape every other gate in this folder uses. `Infinity` propagates through
   * the arithmetic below without special-casing.
   */
  private static foldCostEstimate(
    expr: Expression,
    depth = 0,
    ctx?: FoldCostContext
  ): number {
    const c = ctx ?? {
      inProgress: new Set<string>(),
      cache: new Map(),
      visits: 0,
    };
    // The estimator's OWN work is bounded, not just the tree's depth. Depth
    // alone does not bound a wide call graph: composed helpers that each call
    // the one below a few times branch as fan-out^depth, and a 12-level,
    // 4-way composition took 26.6 s to analyze before this cap existed — far
    // more than the evaluation it was guarding. Exhausting the budget
    // declines, like every other unresolvable answer here.
    if (++c.visits > CONSTANT_FOLD_MAX_VISITS) return Infinity;
    if (depth > CONSTANT_FOLD_MAX_DEPTH) return Infinity;
    if (isNumber(expr) || isString(expr) || isCharacter(expr)) return 1;
    if (isSymbol(expr)) return 1;
    if (isDictionary(expr)) {
      let total = 1;
      for (const v of expr.values) {
        total += BaseCompiler.foldCostEstimate(v, depth + 1, c);
        if (total >= Infinity) return Infinity;
      }
      return total;
    }
    if (!isFunction(expr)) return 1;

    const op = expr.operator;
    const ops = expr.ops;

    // A big op costs its body once per iteration. `bigOpBoundConstant`
    // already answers `undefined` for a bound that is symbolic or mentions a
    // compile-bound name, which is exactly when there is no static count.
    if (op === 'Sum' || op === 'Product') {
      const body = BaseCompiler.foldCostEstimate(ops[0], depth + 1, c);
      // A non-finite body poisons the product REGARDLESS of the count: in
      // JavaScript `0 * Infinity` is `NaN`, and `NaN > ceiling` is false, so
      // a zero-trip node wrapping an unpriceable body would have sailed
      // through the gate as "cheap". Non-finite in, non-finite out.
      if (!Number.isFinite(body)) return Infinity;

      // The INDEXED form (`Sum(body, Limits(i, a, b))`) repeats its body once
      // per iteration.
      if (ops.length >= 2) {
        const trips = BaseCompiler.bigOpTripCount(expr);
        if (trips === undefined) return Infinity;
        return 1 + trips * body;
      }

      // The one-operand COLLECTION-REDUCER form (`Sum(xs)`) reduces every
      // element of its operand, so it costs the collection's size — not the
      // three syntax nodes the generic arm would have counted.
      // `Sum(Range(1, 1000000))` took 1.07 s to fold under the generic
      // pricing, close enough to the anti-hang deadline that load could
      // decide the outcome again.
      // An UNRESOLVABLE size takes the same optimistic fallback the
      // `Map`/`Filter` arm uses, and for the same reason: this estimate also
      // runs over a callee's BODY, where the bounds are the function's own
      // parameters and are symbolic by construction. `g(k) := Sum(Take(…, k))`
      // has no static size in the body, yet `g(3)` is a perfectly ordinary
      // constant fold — declining here refused it. A size that IS resolvable
      // is still priced, which is what keeps `Sum(Range(1, 1000000))` out.
      const size = BaseCompiler.staticCollectionSize(ops[0], depth + 1);
      return 1 + (size ?? 1) * body;
    }

    // A collection PIPELINE costs its callback once per element. The size
    // comes from the source (`staticCollectionSize`), so a pipeline over a
    // literal range is priced by that range even though the pipeline itself
    // is only a few nodes. Without this a `Sum(Map(f, 1..100000))` estimated
    // at a dozen units — the multiplying construct is the collection, not the
    // syntax — and evaluating it forced all 100 000 elements.
    if ((op === 'Map' || op === 'Filter') && ops.length >= 2) {
      // `Map(f, xs)` is callback-first; `Filter(xs, f)` is collection-first.
      // The zipWith form `Map(f, xs, ys, …)` walks every source in lockstep
      // and stops at the shortest, so its size is the minimum over the
      // sources and each source is materialized once.
      const [callback, sources] =
        op === 'Map' ? [ops[0], ops.slice(1)] : [ops[1], [ops[0]]];
      // `staticCollectionSize` knows the zip rule for `Map`; a `Filter` is
      // priced by its source, the bound on what it can keep.
      const size =
        op === 'Map'
          ? BaseCompiler.staticCollectionSize(expr, depth)
          : BaseCompiler.staticCollectionSize(ops[0], depth + 1);
      const perElement = BaseCompiler.foldCostEstimate(callback, depth + 1, c);
      let sourceCost = 0;
      for (const source of sources)
        sourceCost += BaseCompiler.foldCostEstimate(source, depth + 1, c);
      if (!Number.isFinite(perElement) || !Number.isFinite(sourceCost))
        return Infinity;
      // An UNRESOLVABLE source size is priced as a single element rather than
      // as infinite, because the bound may live in a CONSUMER above this node
      // rather than in the source below it: `Take(Map(f, 1..∞), 10)` walks ten
      // elements, and `staticCollectionSize` prices that correctly from the
      // `Take`. Declining here instead would refuse every bounded infinite
      // pipeline — the shape the lazy-stream lowering exists for. A pipeline
      // with neither a resolvable source nor a bounding consumer is not
      // under-guarded: it cannot produce a finite collection, so the
      // evaluation returns a non-number and the fold declines on the value.
      //
      // The size is read from SYNTAX, so a collection returned by a USER
      // FUNCTION (`myrange(n) := Range(1, n)`, then `Map(f, myrange(10^6))`)
      // is invisible here and takes this same one-element fallback however
      // large it really is. That gap is bounded not by this estimate but by
      // `CONSTANT_FOLD_MAX_COLLECTION_SIZE`, which clamps
      // `engine.maxCollectionSize` for the evaluation: materialization stops
      // early and the fold declines on the value instead. Anything that
      // raises or relocates that clamp has to revisit this line.
      return 1 + sourceCost + (size ?? 1) * perElement;
    }

    // A user-defined function costs its own body. Memoized by NAME: a
    // function applied ten times is analyzed once, so the estimator stays
    // linear in the program rather than in the call graph. A name already on
    // the path is recursive and has no static bound.
    const literal = BaseCompiler.userFunctionLiteral(expr.engine, op);
    let calleeCost = 0;
    if (
      literal !== undefined &&
      isFunction(literal) &&
      literal.ops.length > 0
    ) {
      const cached = c.cache.get(op);
      if (cached !== undefined) {
        // A genuine CACHE, not merely a cycle guard. Without it the name was
        // added to a set for the duration of one expansion and removed on the
        // way out, so a function called from N sibling positions was re-walked
        // N times, independently, at every level — the estimator was
        // exponential in the call graph while its own docstring claimed it was
        // linear.
        calleeCost = cached;
      } else {
        if (c.inProgress.has(op)) return Infinity; // recursive: no static bound
        c.inProgress.add(op);
        calleeCost = BaseCompiler.foldCostEstimate(
          literal.ops[0],
          depth + 1,
          c
        );
        c.inProgress.delete(op);
        // Only a settled answer is cached. An `Infinity` reached because the
        // VISIT BUDGET ran out is a property of this walk, not of the
        // function, so caching it would make the estimate depend on where the
        // walk started — the very order-dependence this design removes.
        if (Number.isFinite(calleeCost)) c.cache.set(op, calleeCost);
      }
      if (!Number.isFinite(calleeCost)) return Infinity;
    }

    let total = 1 + calleeCost;
    for (const operand of ops) {
      total += BaseCompiler.foldCostEstimate(operand, depth + 1, c);
      if (total >= Infinity) return Infinity;
    }
    return total;
  }

  /**
   * The number of iterations a `Sum`/`Product` node performs, or `undefined`
   * when it has no statically resolvable count (a symbolic or non-finite
   * bound, an `Element` domain, a multi-index form). Used only by
   * `foldCostEstimate`, where `undefined` means "decline".
   */
  /**
   * The element count a collection-valued expression yields, when it is
   * statically resolvable, for `foldCostEstimate`'s pipeline pricing.
   * `undefined` means "no static size", which the caller turns into a
   * decline.
   *
   * Only the shapes whose size is readable from the SYNTAX are answered — a
   * literal `List`/`Set`, a `Range` with literal bounds, and the bounding
   * consumers `Take`/`Drop` — because the point is to price the walk without
   * performing it. Anything else (a symbolic bound, an infinite range, a
   * `Filter` whose survivor count is only known by running it) declines, so
   * the estimate never under-reports the work.
   */
  private static staticCollectionSize(
    expr: Expression,
    depth: number
  ): number | undefined {
    if (depth > CONSTANT_FOLD_MAX_DEPTH) return undefined;
    if (!isFunction(expr)) return undefined;
    const ops = expr.ops;
    if (expr.operator === 'List' || expr.operator === 'Set') return ops.length;
    if (expr.operator === 'Range') {
      // Read the bounds WITHOUT rounding. `bigOpBoundConstant` floors, which
      // is right for an integer iteration index but wrong here: a `Range`
      // takes a real step, and flooring turned `Range(1, 100000, 0.5)` into
      // step `0`, so the size read as unknown and the pipeline was priced as
      // a single element — it folded in 984 ms, back within reach of the
      // anti-hang deadline this estimate exists to keep out of the decision.
      const lo = ops.length > 1 ? BaseCompiler.realBoundOf(ops[0]) : 1;
      const hi = BaseCompiler.realBoundOf(ops.length > 1 ? ops[1] : ops[0]);
      const step =
        ops.length > 2 ? BaseCompiler.realBoundOf(ops[2]) : undefined;
      if (lo === undefined || hi === undefined) return undefined;
      const s = step ?? (hi >= lo ? 1 : -1);
      if (s === 0 || !Number.isFinite(s)) return undefined;
      // A step pointing away from the stop yields an empty range, not a
      // negative count.
      if ((hi - lo) / s < 0) return 0;
      const n = Math.floor((hi - lo) / s) + 1;
      return Number.isFinite(n) ? Math.max(0, n) : undefined;
    }
    // A bounding consumer caps its source: `Take(xs, n)` walks at most `n`.
    if (expr.operator === 'Take' && ops.length >= 2) {
      const n = BaseCompiler.bigOpBoundConstant(ops[1]);
      if (n === undefined) return undefined;
      const src = BaseCompiler.staticCollectionSize(ops[0], depth + 1);
      return src === undefined ? Math.max(0, n) : Math.min(src, Math.max(0, n));
    }
    if (expr.operator === 'Drop' && ops.length >= 2) {
      const src = BaseCompiler.staticCollectionSize(ops[0], depth + 1);
      const n = BaseCompiler.bigOpBoundConstant(ops[1]);
      if (src === undefined || n === undefined) return undefined;
      return Math.max(0, src - Math.max(0, n));
    }
    // A unary `Map` preserves its source's length; the zipWith form
    // `Map(f, xs, ys, …)` is as long as its SHORTEST source. A source whose
    // size is unresolvable can only make the result shorter, so the minimum
    // over the resolvable sources is still a bound the cost estimate can
    // price by; with no resolvable source there is no bound at all.
    if (expr.operator === 'Map' && ops.length >= 2) {
      let min: number | undefined = undefined;
      for (const source of ops.slice(1)) {
        const n = BaseCompiler.staticCollectionSize(source, depth + 1);
        if (n !== undefined && (min === undefined || n < min)) min = n;
      }
      return min;
    }
    return undefined;
  }

  /**
   * The exact finite real value of a `Range` bound or step, or `undefined`.
   *
   * Distinct from `bigOpBoundConstant`, which FLOORS: that is correct for an
   * integer iteration index, but a `Range` step is a real, and flooring
   * `0.5` to `0` silently reports "no static size". Shares the same safety
   * conditions — a name bound by an enclosing binder has no compile-time
   * value, and a nonzero imaginary part leaves no ordering.
   */
  private static realBoundOf(expr: Expression | undefined): number | undefined {
    if (expr === undefined) return undefined;
    if (BaseCompiler.mentionsCompileBoundName(expr)) return undefined;
    const im = expr.im;
    if (!Number.isNaN(im) && im !== 0) return undefined;
    const re = expr.re;
    return Number.isFinite(re) ? re : undefined;
  }

  private static bigOpTripCount(expr: Expression): number | undefined {
    if (!isFunction(expr)) return undefined;
    const indexes = expr.ops.slice(1);
    if (indexes.length !== 1) return undefined;
    const limits = indexes[0];
    if (!isFunction(limits, 'Limits')) return undefined;
    const lower = BaseCompiler.bigOpBoundConstant(limits.op2);
    const upper = BaseCompiler.bigOpBoundConstant(limits.op3);
    if (lower === undefined || upper === undefined) return undefined;
    // Both bounds arrive already floored from `bigOpBoundConstant` — which is
    // what `normalizeIndexingSet` does to a Sum/Product index as well — so the
    // count is a plain difference. Spelling it `ceil(lower)`, the textbook
    // form for UNROUNDED real bounds, would read as a floor/ceil asymmetry
    // that does not exist here, and could not round anything if it did.
    const trips = upper - lower + 1;
    if (!Number.isFinite(trips)) return undefined;
    return Math.max(0, trips);
  }

  /**
   * The elements of a constant collection VALUE as number literals, ready to
   * inline — or `undefined` when it is not a foldable collection, which is the
   * common case and leaves the caller's number/boolean handling to run.
   *
   * Requirements, each with a reason:
   * - **finite** and **indexed**: an infinite collection cannot be inlined at
   *   all, and a non-indexed one (a `Set`) has no defined element ORDER, so a
   *   literal list would fix an order the source never promised;
   * - **within the inline cap** (`maxInlineElements`, the target's own limit
   *   — see `CONSTANT_FOLD_MAX_INLINE_ELEMENTS` for the default), checked
   *   against the `count` facet BEFORE walking so an oversized collection
   *   costs nothing, and again during the walk because `count` is a facet
   *   while the walk is the truth;
   * - **every element a number literal**: strings, nested collections, tuples
   *   (a point list) and symbolic elements decline. Each element is emitted
   *   through the target's ordinary number path, so this keeps the folded
   *   list to values that path already vets.
   */
  private static foldableCollectionElements(
    value: Expression,
    maxElements: number
  ): Expression[] | undefined {
    if (value.isFiniteCollection !== true) return undefined;
    if (value.isIndexedCollection !== true) return undefined;
    const count = value.count;
    if (count === undefined || count > maxElements) return undefined;
    const elements: Expression[] = [];
    for (const element of value.each()) {
      if (!isNumber(element)) return undefined;
      if (elements.length > maxElements) return undefined;
      elements.push(element);
    }
    return elements;
  }

  /**
   * Emit an already-computed folded VALUE through the target's ordinary
   * lowering, so each target's own spelling applies. A value the target cannot
   * represent throws — decline, and let the structural lowering produce its
   * own (equivalent) failure.
   *
   * `_emittingFoldedValue` makes this re-entry safe. The emission compiles a
   * value that is itself a candidate — a folded `List` is a pure, constant,
   * collection-typed function node, so `tryConstantFold` would evaluate it,
   * materialize the same elements, and compile another `List`, forever. The
   * flag turns folding off for the duration; the value being emitted is
   * already fully evaluated, so there is nothing left to fold inside it.
   */
  private static emitFoldedValue(
    value: Expression,
    target: CompileTarget<Expression>,
    prec: number
  ): TargetSource | undefined {
    const saved = BaseCompiler._emittingFoldedValue;
    BaseCompiler._emittingFoldedValue = true;
    try {
      return BaseCompiler.compile(value, target, prec);
    } catch (e) {
      // Same discrimination the evaluation's own catch applies: a failure
      // here normally means "this target cannot represent that literal", a
      // quiet decline. But a cancellation raised because the AMBIENT (outer)
      // deadline expired must keep cancelling the whole compilation rather
      // than being absorbed as a fold miss. That matters more for a folded
      // COLLECTION than it did for a single number: emission recurses through
      // `compile()` for every element, so there is real work — and real
      // surface for an unrelated codegen defect — running under this catch.
      if (!value.engine._shouldContinueExecution()) throw e;
      return undefined;
    } finally {
      BaseCompiler._emittingFoldedValue = saved;
    }
  }

  /** See `emitFoldedValue`: folding is off while a folded value is emitted. */
  private static _emittingFoldedValue = false;

  /**
   * The compile-time integer value of a `Sum`/`Product` bound, or `undefined`
   * when the bound is not a compile-time constant and must instead be emitted
   * as code and evaluated at run time.
   *
   * A bound that mentions a compile-bound name has NO compile-time value, and
   * reading one anyway is not a harmless miss: with the library's single-letter
   * constants it yields a plausible number instead of `NaN`, and the caller
   * then folds the whole big op against it behind `success: true`. With
   * `F(i) = Σ_{m=1..i} m`, the parameter `i` resolved to the imaginary unit
   * (`re` 0), so `lower 1 > upper 0` read as an empty range and the body
   * compiled to the identity `0` — `_fn_F = (i) => 0` — while the interpreter
   * answered 6. A parameter named `e` picked up Euler's number and summed two
   * terms (`3`). Reported by the Tycho team as item 176; the same shape on the
   * GPU targets emitted `float _fn_F(float i) { return 0.0; }`.
   *
   * Callers must treat `undefined` as "symbolic bound" and emit the loop form,
   * which compiles the bound expression in a target that maps the bound name to
   * its emitted local.
   */
  static bigOpBoundConstant(expr: Expression | undefined): number | undefined {
    if (expr === undefined) return undefined;
    if (BaseCompiler.mentionsCompileBoundName(expr)) return undefined;
    // A nonzero imaginary part leaves no iteration count; folding on the real
    // part alone would silently discard it (`Σ_{n=1}^{i}` → the empty range).
    const im = expr.im;
    if (!isNaN(im) && im !== 0) return undefined;
    const re = expr.re;
    if (isNaN(re) || !Number.isFinite(re)) return undefined;
    return Math.floor(re);
  }

  /**
   * Statically splice `Spread` operands (`f(...p)`) into the call's argument
   * list. A literal tuple splices directly; a symbolic argument whose STATIC
   * type is a tuple of known arity n rewrites to n positional `At` accesses
   * (`f(At(p,1), …, At(p,n))`). An argument whose arity is not statically
   * known fails closed (D6): the compiled code could not re-validate the
   * arity the interpreter enforces at splice time (a JS/Python dynamic
   * spread would silently mis-bind on a mismatch instead of erroring).
   */
  private static spliceSpreadOperands(expr: Expression): Expression {
    if (!isFunction(expr)) return expr;
    const ce = expr.engine;
    const ops: Expression[] = [];
    for (const x of expr.ops) {
      if (x.operator !== 'Spread' || !isFunction(x) || x.nops !== 1) {
        ops.push(x);
        continue;
      }
      // A lazy parent (e.g. `Add`'s canonical handler) holds its operands
      // raw, so the Spread's argument may be unbound here — `.canonical` is
      // value-safe (binds structure, does not substitute assigned values)
      // and is required to read the declared type.
      const arg = x.op1.canonical;
      if (isFunction(arg, 'Tuple')) {
        ops.push(...arg.ops);
        continue;
      }
      const t = compilationType(arg);
      if (typeof t !== 'string' && t.kind === 'tuple') {
        for (let i = 1; i <= t.elements.length; i++)
          ops.push(ce.function('At', [arg, ce.number(i)]));
        continue;
      }
      throw new Error(
        `Spread: cannot compile — the argument's tuple arity is not ` +
          `statically known (type '${arg.type.toString()}'). Annotate it ` +
          `with a tuple type, or evaluate first. Fail closed (D6).`
      );
    }
    return ce.function(expr.operator, ops);
  }

  private static _compileInner(
    expr: Expression,
    target: CompileTarget<Expression>,
    prec = 0
  ): TargetSource {
    // `f(...p)` — a `Spread` operand splices a tuple into the call's
    // arguments. Rewrite statically and re-enter compilation; the rewrite is
    // target-agnostic (it lowers to positional `At` accesses, which each
    // target compiles with its own indexing rules).
    if (isFunction(expr) && expr.ops.some((x) => x.operator === 'Spread'))
      return BaseCompiler.compile(
        BaseCompiler.spliceSpreadOperands(expr),
        target,
        prec
      );

    // Is it a symbol?
    if (isSymbol(expr)) {
      const s = expr.symbol;
      const op = target.operators?.(s);
      if (op !== undefined) {
        // A bare operator symbol used in value position (a first-class function
        // — e.g. a `Reduce` combiner or `Map` mapper). Only genuinely binary
        // arithmetic operators lower to a valid binary infix lambda; unary
        // (Negate/Not), relational, and logical operator symbols fail closed
        // (D6) so the engine falls back to the interpreter instead of emitting
        // wrong-arity, invalid, or silently-diverging source (finding: Reduce/
        // Map over-accepted any operator symbol as a combiner/mapper).
        if (!BaseCompiler.BINARY_INFIX_VALUE_OPERATORS.has(s)) {
          // …but a UNARY operator symbol (`Negate`, `Not`) is a perfectly good
          // callback: eta-expand it here, before failing closed, exactly as
          // the bare-symbol route below does for an unmapped built-in. Its
          // wrapper BODY is an ordinary application, so it lowers through this
          // very operator mapping (`_fn_Negate = (_tv1) => -_tv1`). Guarded
          // like the route below so a BOUND name or a `vars` key spelled
          // `Negate` keeps its current meaning (there, its current meaning is
          // the refusal below).
          const registry = target.userFunctions;
          const isBoundOrMapped =
            target.boundVars?.has(s) === true ||
            target.varsKeys?.has(s) === true;
          if (registry && !isBoundOrMapped) {
            const etaFn = BaseCompiler.ensureBuiltinCallbackEmitted(
              expr.engine,
              s,
              target
            );
            if (etaFn !== undefined && registry.lowering)
              return registry.lowering.value({ id: s, name: etaFn, target });
            if (etaFn !== undefined) return etaFn;
          }
          throw new Error(BaseCompiler.builtinCallbackRefusal(s));
        }
        // We're compiling something like "Add"
        return `(a,b) => a ${op[0]} b`;
      }
      // Resolving a free symbol RECORDS it as a vars-object reference (see
      // `CompileTarget.varsObjectRefs`), and the lambda route refuses a body
      // holding any. The two function-value routes below never emit that
      // reference, so the record has to be rolled back when one of them
      // answers — otherwise `t ↦ Sum(Map(Sin, xs))` is refused for a
      // "dangling" `Sin` the artifact does not contain. Only a record THIS
      // resolution introduced is removed.
      const hadVarsRef = target.varsObjectRefs?.has(s) === true;
      const resolved = target.var?.(s);
      // A bare symbol naming a user-defined function, used in value position (a
      // higher-order operand such as `Map(f, list)` / `Filter(list, f)`),
      // resolves to the shared emitted local `_fn_f` — the same definition the
      // call-site path emits — rather than a dangling `_.f`. But two kinds of
      // symbol must NOT be captured this way, or a same-named user function
      // would silently shadow them:
      //   - a **bound** name (a parameter / block local / loop index): the
      //     enclosing binding form's `var` override resolves it to the bare
      //     identifier (`resolved === s`), whereas the base resolver only ever
      //     emits `_.<s>`, a constant, or a mapped literal — so `resolved === s`
      //     uniquely identifies a bound name;
      //   - a **`vars`-mapped** key: the caller's external-input contract, which
      //     always wins (see `CompileTarget.vars`).
      const registry = target.userFunctions;
      // A name is bound when an enclosing binding form recorded it in
      // `boundVars` (lambda param, Sum/Product/Loop index, Block local,
      // comprehension var, Match capture). `resolved === s` is kept as an
      // additional signal for binding forms that resolve a bound name to its
      // own bare identifier (the common loop path) and is harmless — the base
      // resolver never returns a bare identifier for a free user-function
      // symbol (it returns `_.<s>`). The explicit `boundVars` set covers the
      // cases where a binding form resolves the name to NON-identity code
      // (an unrolled-Sum numeric literal, an interval `_IA.point(i)` wrap, a
      // Match `subject[i]` accessor), which `resolved === s` misses (A2).
      const isBoundOrMapped =
        resolved === s ||
        target.boundVars?.has(s) === true ||
        target.varsKeys?.has(s) === true;
      // `Nothing` is the engine's ERASURE marker, not a value: an arithmetic
      // operand spelled `Nothing` is dropped at canonicalization, and a
      // malformed form (an odd-length `Which` clause list) canonicalizes to
      // the bare symbol. Reaching this point means an emitter is about to
      // splice it in as an ordinary operand, and every target's free-symbol
      // plumbing then produces something that looks like success: the shader
      // targets emitted the undefined identifier `Nothing` (a driver-side
      // compile error behind `success: true`), the Python target the
      // undefined name `Nothing`, and the interval target a `_.Nothing`
      // vars-object read that is `undefined` at run time. Fail closed (D6)
      // for every target here, on the one route they share. The JavaScript
      // target's own `var` hook refuses it first with the same message, so
      // this guard is what the other targets rely on. A BOUND name or a
      // caller `vars` key spelled `Nothing` is a genuine variable and is
      // served above.
      if (s === 'Nothing' && !isBoundOrMapped)
        throw new Error(
          'Nothing: the erasure marker is not a value and cannot be compiled as a variable reference. Fail closed (D6).'
        );
      if (registry && !isBoundOrMapped && !registry.misses?.has(s)) {
        // The VALUE position, so a declared-complex parameter needs the
        // coercing shim: this reference may end up as `Map`'s callback, which
        // passes raw elements (see `ensureUserFunctionValueRef`).
        const userFn = BaseCompiler.ensureUserFunctionValueRef(
          expr.engine,
          s,
          target
        );
        // A target whose language has no function VALUES (the shader targets)
        // decides what this reference means — in practice, fails closed (D6).
        if (userFn !== undefined && !hadVarsRef)
          target.varsObjectRefs?.delete(s);
        if (userFn !== undefined && registry.lowering)
          return registry.lowering.value({ id: s, name: userFn, target });
        if (userFn !== undefined) return userFn;
        // Memoize the negative lookup so a repeated free symbol doesn't re-hit
        // `lookupDefinition` on every occurrence during this compile.
        (registry.misses ??= new Set()).add(s);
      }
      // A bare BUILT-IN operator symbol in value position (`Map(Sin, xs)`,
      // `CountIf(xs, IsPrime)`) is eta-expanded into `(p) ↦ Sin(p)` and
      // emitted through the SAME shared-local machinery user functions use.
      // Without this it fell through to the free-symbol read `_.Sin` and the
      // artifact threw `_f is not a function` at RUN time — a broken artifact
      // where the fail-closed principle wants either working code or a
      // compile-time refusal. Tried AFTER the user-function route (a user
      // definition shadowing the name wins) and only from THIS path, so an
      // application HEAD (`Sin(x)` → `Math.sin(x)`) is untouched.
      if (registry && !isBoundOrMapped) {
        const etaFn = BaseCompiler.ensureBuiltinCallbackEmitted(
          expr.engine,
          s,
          target
        );
        // As for user functions: a target whose language has no function
        // VALUES (the shader targets) decides what this reference means — in
        // practice, fails closed (D6).
        if (etaFn !== undefined && !hadVarsRef)
          target.varsObjectRefs?.delete(s);
        if (etaFn !== undefined && registry.lowering)
          return registry.lowering.value({ id: s, name: etaFn, target });
        if (etaFn !== undefined) return etaFn;
        // A BUILT-IN operator name that could not be expanded (variadic,
        // zero-required like `Random`, or a wrapper body that does not
        // canonicalize) must not fall through to `_.Random`: that artifact
        // compiles "successfully" and throws `_f is not a function` at run
        // time. Fail closed (D6) — with the default `fallback: true` route
        // this becomes an interpreter fallback. Scoped to a system-provenance
        // operator name that is not one the engine itself reads as a variable
        // (`isRefusableBuiltinCallback`): a plain free symbol, a value
        // definition, a `vars` key, or a bound name is not affected.
        if (isRefusableBuiltinCallback(expr.engine, s))
          throw new Error(BaseCompiler.builtinCallbackRefusal(s));
      }
      if (resolved !== undefined)
        return BaseCompiler.liftWideReference(expr, resolved, target);
      // The target did not resolve the symbol (no `vars` mapping, constant, or
      // free-symbol plumbing). Before falling back to a bare reference — which
      // is a dangling identifier for a symbol the engine actually knows — fold
      // an assigned value / declared constant, matching `evaluate()`. This also
      // covers the direct-target `compile(expr, { target })` path, where the
      // raw target has no engine context of its own.
      const folded = BaseCompiler.tryFoldKnownSymbol(expr.engine, s, target);
      if (folded !== undefined) {
        // A folded value is BAKED — there is no run-time binding, so the
        // "coerced at every entry" exemption that leaves a declared-complex
        // REFERENCE unlifted (see `liftWideReference`) does not apply here.
        // Consumers of a symbol whose analysis says complex read the
        // target's {re, im} encoding, but a real-valued assignment
        // (`z: complex` with `z := 5`) compiles to a bare real literal, and
        // reading `.re` off it yields NaN. Wrap the emission in the
        // target's idempotent `complexLift`. Only a provably scalar-numeric
        // value whose own emission is real-shaped is wrapped; a value
        // already complex-shaped (`isComplexValued`) or non-scalar stays as
        // emitted.
        // The gate is `isComplexValued`, NOT `complexDiscipline`: consumers
        // decide their {re, im} reads with that same predicate, and it is
        // true for a declared-complex symbol under every mode — including
        // `auto`'s per-node promotion, which stays in the strict-lanes
        // discipline. Gating on mode left `auto` emitting `.re` reads
        // against a bare folded literal.
        if (
          target.complexLift !== undefined &&
          BaseCompiler.isComplexValued(expr)
        ) {
          const value = expr.engine._getSymbolValue(s);
          if (
            value !== undefined &&
            !BaseCompiler.isComplexValued(value) &&
            isSubtype(value.type.type, 'number')
          )
            return target.complexLift(folded);
        }
        return folded;
      }
      // Genuinely free symbol: emit its bare identifier. Give the target a
      // chance to mangle it or fail closed (D6) — e.g. a GLSL/WGSL reserved
      // keyword used as a variable name would emit invalid shader source.
      return BaseCompiler.liftWideReference(
        expr,
        target.mangleId ? target.mangleId(s) : s,
        target
      );
    }

    // Is it a number?
    if (isNumber(expr)) {
      // `~oo` first: it carries an infinite imaginary part, but it types
      // `number` (the non-finite typing convention admits undirected infinity
      // at the top type only) and it has no real VALUE, which the real lane
      // spells `NaN`. Emitting the `{re: ∞, im: ∞}` object instead handed a
      // real-arithmetic parent an object to add, producing the string
      // `"1[object Object]"` from `1 + ~oo`. This matches what the pole
      // already compiled to through every other route — `_SYS.factorial`
      // returns `NaN` at a negative integer, and the constant fold projects a
      // real-lane `~oo` the same way.
      if (expr.isInfinity && expr.im !== 0) return target.number(NaN);
      if (expr.im !== 0) {
        if (!target.complex)
          throw new Error('Complex numbers are not supported by this target');
        return target.complex(expr.re, expr.im);
      }
      const code = target.number(expr.re);
      // A negative numeric literal (e.g. `-2`) has a leading unary minus, so it
      // must be parenthesized wherever a unary `Negate(...)` would be: when
      // spliced as an operand that binds tighter than unary negation. Otherwise
      // Python `Power(-2, x)` emits `-2 ** x`, which parses as `-(2 ** x)`
      // (sign-flipped). Mirror the Negate operator's own `op[1] < prec` wrap.
      if (expr.re < 0) {
        const negPrec = target.operators?.('Negate')?.[1] ?? 14;
        if (negPrec < prec) return `(${code})`;
      }
      return code;
    }

    // Is it a string?
    if (isString(expr)) {
      return target.string(expr.string);
    }

    // Is it a CHARACTER? A character is exactly one grapheme cluster, and on a
    // target that can represent one the faithful lowering is the one-character
    // string it denotes — the distinction between the two kinds is compile-time
    // only. Gated on the target's own `character` capability rather than on
    // `string`, because holding the cluster is only half of it: ordering two
    // characters, segmenting a string into them and counting them all need
    // grapheme-cluster awareness. Python has string literals but no stdlib
    // grapheme segmentation, and GLSL/WGSL have no text at all, so both decline
    // here instead of emitting a target string that would then be compared with
    // the wrong order or indexed by the wrong unit.
    // (`docs/STRING_ROADMAP.md`, decision D13.)
    if (isCharacter(expr)) {
      if (target.character === undefined)
        throw new Error(
          `Cannot compile a character to target '${target.language ?? '?'}': ` +
            `it has no character representation (a character is one UAX #29 ` +
            `grapheme cluster, which this target cannot segment or order). ` +
            `Fail closed (D6) — the interpreter evaluates it.`
        );
      return target.character(expr.string);
    }

    // It must be a function expression...
    if (!isFunction(expr))
      throw new Error(`Cannot compile expression: "${expr.toString()}"`);
    // The node itself is passed along: the CSE region inventory is keyed by
    // the `(node, operandIndex)` EDGE (a tree may be a DAG, so a bare operand
    // object is ambiguous), and `compileExpr` receives only the operand list.
    const prevCseParent = BaseCompiler._cseParent;
    BaseCompiler._cseParent = expr;
    try {
      return BaseCompiler.liftWideResult(
        expr,
        BaseCompiler.compileExpr(
          expr.engine,
          expr.operator,
          expr.ops,
          prec,
          target,
          expr
        ),
        target
      );
    } finally {
      BaseCompiler._cseParent = prevCseParent;
    }
  }

  /**
   * COMPLEX discipline, the lift at use for a FUNCTION node's VALUE (design
   * §2): a node the analysis calls complex only because its TYPE is wide —
   * an element read of a `list<number>` (`At`), a user-function call whose
   * declared result is `number`/`unknown`, an `If` over wide arms — is
   * emitted by a lowering that hands back whatever it holds, a plain number
   * as often as not, while every complex-lane consumer reads `.re`/`.im` off
   * it. So the emitted value is wrapped in the target's idempotent
   * `complexLift` (an object passes through) exactly like a wide SYMBOL
   * reference (`liftWideReference`), and parent and child agree on the SHAPE.
   *
   * Skipped where the wrap is provably redundant: a node typed non-real (its
   * emission is complex-shaped by contract), and the arithmetic heads whose
   * complex-lane emission always builds a `{re, im}` object
   * (`COMPLEX_PROPAGATING_HEADS`, `Sqrt`/`Ln`/`Log`/`Power`) — every other
   * head pays the idempotent wrap in complex mode rather than a per-head
   * audit of its lowering. Outside the complex discipline: unchanged.
   */
  private static liftWideResult(
    node: Expression & { ops: ReadonlyArray<Expression> },
    code: TargetSource,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (!BaseCompiler.complexDiscipline || !target.complexLift) return code;
    const h = node.operator;
    // A control-flow head may lower to STATEMENTS (a `Block` or `If` in a
    // function body, a `Loop`, an `Assign`) — not an expression a call can
    // wrap. Their VALUE positions lift their own arms and locals.
    if (BaseCompiler.CONTROL_FLOW_HEADS.has(h)) return code;
    if (
      BaseCompiler.COMPLEX_PROPAGATING_HEADS.has(h) ||
      BaseCompiler.PROMOTABLE_RADICAL_HEADS.has(h) ||
      h === 'Power'
    )
      return code;
    const t = node.type?.type;
    if (t === undefined || isNonRealNumber(t)) return code;
    if (!BaseCompiler.wideNumericType(t)) return code;
    if (!BaseCompiler.isComplexValued(node)) return code;
    return target.complexLift(code);
  }

  /**
   * The node whose operands the currently-dispatched handler is lowering —
   * the CSE edge key for emitters that are handed an operand LIST rather than
   * the node (the targets' `Sum`/`Product` handlers). Synced by
   * `_compileInner`, like `_boundVarsCtx`; compilation is synchronous, so a
   * static is safe. `undefined` simply means no region is pushed (CSE
   * degrades to the enclosing region).
   */
  private static _cseParent: Expression | undefined;

  /** See `_cseParent`. */
  static cseParentNode(): Expression | undefined {
    return BaseCompiler._cseParent;
  }

  /**
   * Compile a function expression
   */
  static compileExpr(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    prec: number,
    target: CompileTarget<Expression>,
    /** The node being lowered, when the caller has it: the CSE region
     * inventory is keyed by the `(node, operandIndex)` edge (§5.1). Omitting
     * it costs only the optimization — no region is pushed. */
    node?: Expression
  ): TargetSource {
    if (h === 'Error') throw new Error('Error');

    if (h === 'Sequence') {
      if (args.length === 0) return '';
      return `(${args
        .map((arg) => BaseCompiler.compile(arg, target, prec))
        .join(', ')})`;
    }

    if (h === 'Sum' || h === 'Product') {
      // Delegate to target-specific function handler if available,
      // otherwise fall back to the generic loop compilation.
      const sumProdFn = target.functions?.(h);
      if (typeof sumProdFn === 'function') {
        return sumProdFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      }
      if (typeof sumProdFn === 'string') {
        return `${sumProdFn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      return BaseCompiler.compileLoop(h, args, target, node);
    }

    // A user operator definition may supply its own target-aware compile
    // handler (the public per-operator compilation extension point). It is
    // consulted HERE — before the target's built-in operator mappings, the
    // broadcast lowering, and the broadcast fail-closed guard — so an explicit
    // handler is an explicit opt-in that takes precedence over the built-in
    // lowering, even for an operator-mapped head (e.g. a custom-tolerance `GCD`
    // or a re-mapped `Add`). Structural/control-flow heads
    // (`CONTROL_FLOW_HEADS`: Sum/Product/If/When/Match/Block/Function/
    // Loop/Comprehension/Sequence, …) are handled by their own bespoke lowering
    // and are NOT overridable — except the carve-outs in
    // `OVERRIDABLE_CONTROL_FLOW_HEADS` (`Which`, Tycho item 180), which have
    // no binding structure and keep the decline-falls-back contract. A handler
    // that returns `undefined`/`null` OR an
    // empty string falls through to the default compilation (finding A5).
    // Set when a per-operator `compile` handler ran and DECLINED — the head is
    // known and lowerable in general, it just has no lowering for THIS operand
    // shape or target. Read by the fall-through diagnostic below so the decline
    // is not reported as `Unknown operator` (Tycho item 109a).
    let declinedByCustomHandler = false;
    if (
      !BaseCompiler.CONTROL_FLOW_HEADS.has(h) ||
      BaseCompiler.OVERRIDABLE_CONTROL_FLOW_HEADS.has(h)
    ) {
      // `lookupApplicable`, not `lookupDefinition`: `h` is by construction in
      // OPERATOR position, and a user value that shadows a builtin of the same
      // name — `D` as a diffusion coefficient, `N` as a count — must not hide
      // the builtin's lowering. That is the same rule binding already follows
      // (`BoxedFunction` resolves its def with `lookupApplicable`), so without
      // it a `D(x^2, x)` that EVALUATES fine would fail to compile with
      // ``Unknown operator `D` ``.
      const customDef = lookupApplicable(h, engine.context.lexicalScope);
      if (
        isOperatorDef(customDef) &&
        typeof customDef.operator.compile === 'function'
      ) {
        const custom = customDef.operator.compile(
          BaseCompiler.fieldArgsWithDeclaredReceiver(
            engine,
            h,
            args,
            target.declaredVarTypes
          ) ?? args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          { language: target.language ?? 'javascript' }
        );
        if (custom !== undefined && custom !== null && custom !== '')
          return custom;
        declinedByCustomHandler = true;
      }
    }

    // |(x,y)| over a fixed-arity point is the Euclidean norm (`Abs(Tuple)`
    // routes to `Norm` at evaluation). A point binds ATOMICALLY — it must
    // never be broadcast into component-wise `abs`, so this rewrite sits
    // BEFORE the broadcast lowering (which would map over the tuple) but
    // AFTER the custom per-operator compile hook above, so a user-registered
    // `Abs` handler keeps its documented precedence (Tycho item 74: the js
    // target compiled `|(x,y)|` to a bare array that concatenated into a
    // string downstream). `isTuple` (type-based), matching the evaluate and
    // type-handler detection: a tuple-TYPED symbol is a point too — without
    // it, `|p|` for `p: tuple<real,real>` broadcast `Math.abs` over the
    // point's components behind `success: true`.
    if (h === 'Abs' && args.length === 1 && isTuple(args[0])) {
      return BaseCompiler.compileExpr(engine, 'Norm', args, prec, target);
    }

    // Same rule one level up: `|S|` over a LIST of points is the list of point
    // norms (the interpreter broadcasts `Abs`, and `Abs` of a point is its
    // norm), NOT the component-wise `abs` the broadcast lowering below would
    // emit behind `success: true` (Tycho item 138). Every target's `Norm`
    // either lowers the point list (javascript) or fails closed on it, so the
    // rewrite is uniform rather than javascript-only.
    if (h === 'Abs' && args.length === 1 && isPointListValue(args[0])) {
      return BaseCompiler.compileExpr(engine, 'Norm', args, prec, target);
    }

    // Element-wise broadcast of a `broadcastable` head (arithmetic + unary
    // math) over one or more list-valued operands, for the JavaScript target.
    // Emits a `_SYS.bcast` call wrapping the head's own scalar codegen — see
    // `tryCompileBroadcast`. Other targets have native vector types (GLSL/WGSL
    // `vec3 + vec3`) or their own broadcasting, so this is JavaScript-only.
    if (target.language === 'javascript') {
      const broadcast = BaseCompiler.tryCompileBroadcast(
        engine,
        h,
        args,
        target
      );
      if (broadcast !== null) return broadcast;
    }

    // A declaration CONTRADICTED by its body, sitting in a scalar-consuming
    // position (2026-08-12 ruling — the adjacency half of the
    // `assertScalarBigOpBody` clause of the same name). Target-agnostic, and
    // deliberately AFTER the JavaScript broadcast attempt above: a shape that
    // already had a value-safe element-wise route (a sibling operand made the
    // whole form broadcast) keeps it; what reaches here is the scalar emission
    // the contradiction makes wrong. See
    // `assertNoContradictedScalarOperand`.
    BaseCompiler.assertNoContradictedScalarOperand(engine, h, args);

    // An indexed read into a collection that mixes complex- and real-valued
    // elements, with an index known only at run time: the element is a complex
    // object for some indices and a plain number for others, so no single
    // lowering is correct. Refuse rather than guess (D6), for the same reason
    // and in the same place as the contradicted declaration above. See
    // `assertNoAmbiguousComplexElementRead`.
    BaseCompiler.assertNoAmbiguousComplexElementRead(h, args);

    // A broadcastable head with a list/collection-typed operand that
    // `tryCompileBroadcast` did NOT handle would otherwise fall through to the
    // legacy scalar path and silently return garbage behind a `success: true`.
    // What reaches here is the residue the broadcast closure DECLINES:
    //   - Arithmetic (`SCALAR_ARITHMETIC_HEADS`): the built-in symbolic lowering
    //     emits element-wise-impossible JS (`[1,2,3] + x` → the *string*
    //     "1,2,31"; `list * scalar` → NaN), and a complex-valued list is
    //     declined by the broadcast closure (can't carry complex scalar
    //     codegen).
    //   - Any *other* broadcastable numeric head whose operands the closure
    //     declined — the `Multiply` ≥2-arrayish matrix-divergence carve-out, or
    //     a complex element type. (A *string*-mapped scalar helper — `Arctan2` →
    //     `Math.atan2`, `Hypot` → `Math.hypot`, `Sinc` → `_SYS.sinc` — used to
    //     land here too, because it has no array codegen of its own; it now
    //     broadcasts through the same `_SYS.bcast` closure, wrapping the scalar
    //     CALL. The widened net stays: those heads are not in
    //     `SCALAR_ARITHMETIC_HEADS`, and a complex-element operand still has to
    //     fail closed rather than call `Math.atan2` on a `{re, im}` object.)
    // Fail closed (D6) with the offending head so the engine-level `compile()`
    // reports `success: false` and falls back to the interpreter (which
    // broadcasts correctly).
    //
    // Deliberately narrow, to avoid false positives on genuinely supported list
    // forms:
    //   - GLSL/WGSL/GPU targets have native vector types (`vec3 + vec3`) and
    //     express their own element-wise lowering through the target's
    //     `broadcastUnary` hook, so this guard is scoped to `javascript` only.
    //   - Relational (`Equal`/`Less`/…) and logical (`And`/`Or`/…) heads are
    //     excluded — they return booleans and are handled by their own codegen
    //     (`compileJSEquality` fails closed on collection operands).
    //   - A user `operators` override that lowers the head to a *function call*
    //     (an identifier like `add`, not a symbolic infix `+`) takes
    //     responsibility for list operands (Issue #240) — only the built-in
    //     symbolic lowering (`+`, `*`, `_SYS.pow`) produces garbage.
    // The operand check is type-based (not just `isCollection`) so a symbolic
    // list *parameter* fails closed too, rather than silently emitting garbage.
    // It also matches a possibly-collection-typed operand
    // (`isPossiblyCollectionTyped`: a `broadcastable<T>` node or a top-typed
    // application). After the F1 widening, most such operands compile through
    // `_SYS.bcast` and never reach here.
    if (target.language === 'javascript') {
      const def = engine.lookupDefinition(h);
      const isBroadcastableHead =
        BaseCompiler.SCALAR_ARITHMETIC_HEADS.has(h) ||
        (isOperatorDef(def) &&
          def.operator.broadcastable === true &&
          !isRelationalOperator(h) &&
          !BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h));
      if (
        isBroadcastableHead &&
        args.some(
          (a) =>
            // A STRING is not a list-valued operand FOR THIS PURPOSE. It
            // matches `collection`/`indexed_collection` in the lattice (its
            // elements are its grapheme clusters) but is ATOMIC under
            // broadcast on both sides — the interpreter's
            // `isFiniteBroadcastParticipant` excludes it, and it lowers to one
            // JS string, not an array — so a broadcastable head over it is
            // ordinary scalar code. Same exemption as the sibling gates
            // (`compilesToArray`, `isArrayOperand`) carry.
            !isProvablyStringOperand(a) &&
            (a.isCollection ||
              a.type.matches('list<any>') ||
              a.type.matches('indexed_collection<any>') ||
              isBoundPossiblyCollectionTyped(a))
        )
      ) {
        const opMap = target.operators?.(h);
        const lowersToScalarInfix =
          opMap === undefined || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]);
        if (lowersToScalarInfix)
          throw new Error(
            `${h}: cannot compile scalar arithmetic over a list-valued operand — the JavaScript compile target has no list-arithmetic support. Fail closed (D6). Materialize the list with evaluate() and compile a scalar element function instead.`
          );
      }
    }

    // Python target: arithmetic over a collection-typed or possibly-collection
    // operand (a concrete/declared `list`/`indexed_collection`, a
    // `broadcastable<T>`, or a top-typed application such as `h(x)` — the same
    // operand predicate as the JS D6 guard above) cannot be compiled soundly.
    // Python's arithmetic operators do NOT broadcast a plain
    // `list`: `2 * [1, 2]` REPEATS (`[1, 2, 1, 2]`), `[1, 2] - 1` raises — both
    // diverge from the interpreter's element-wise result (`[2, 4]` / `[0, 1]`).
    // A NumPy array WOULD broadcast, but the compiled artifact cannot constrain
    // what the caller binds, so the outcome is binding-dependent. Unlike the JS
    // target there is no `_SYS.bcast` closure path here (Python's arithmetic
    // heads lower to infix operators, not scalar function codegen), so fail
    // closed (D6) and let the engine fall back to the interpreter, which
    // broadcasts correctly. Only infix-lowering arithmetic heads are affected;
    // element-wise math functions (`Sin` → `np.sin`) broadcast natively over a
    // NumPy array and are left untouched. Bare unknown symbols are NOT
    // possibly-collection-typed, so plain scalar plot bodies are unaffected.
    if (target.language === 'python') {
      const def = engine.lookupDefinition(h);
      const isArithmeticInfixHead =
        BaseCompiler.SCALAR_ARITHMETIC_HEADS.has(h) ||
        (isOperatorDef(def) &&
          def.operator.broadcastable === true &&
          !isRelationalOperator(h) &&
          !BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h));
      const opMap = target.operators?.(h);
      const lowersToInfix =
        opMap !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]);
      // One shape IS soundly expressible and must reach its lowering: a UNARY
      // broadcastable head over a FINITE INDEXED collection (`Negate([1,2,3])`).
      // No infix arithmetic over a list is emitted for it at all — the target's
      // `broadcastUnary` hook fans it out as a list comprehension
      // (`[(-_tv1) for _tv1 in [1, 2, 3]]`), which is element-wise for a plain
      // Python list exactly as for an ndarray. The predicate mirrors the
      // dispatch site in the function-codegen path below one for one, so the
      // guard only stands aside when that dispatch will actually fire; if the
      // hook then declines, that path fails closed (D6) on its own. Everything
      // else keeps failing closed: every binary/n-ary shape (`[1,2] + [3,4]`,
      // `2 * [1,2]`, `[1,2] ** 2`) — which the unary hook cannot express — and
      // a merely collection-TYPED operand, whose runtime binding (list vs
      // ndarray) the compiled artifact cannot constrain.
      const isUnaryBroadcastOverCollection =
        target.broadcastUnary !== undefined &&
        args.length === 1 &&
        isOperatorDef(def) &&
        def.operator.broadcastable === true &&
        isFiniteIndexedCollection(args[0]) &&
        typeof target.functions?.(h) === 'function';
      if (
        isArithmeticInfixHead &&
        lowersToInfix &&
        !isUnaryBroadcastOverCollection &&
        args.some(
          (a) =>
            a.isCollection ||
            a.type.matches('list<any>') ||
            a.type.matches('indexed_collection<any>') ||
            isBoundPossiblyCollectionTyped(a)
        )
      )
        throw new Error(
          `${h}: cannot compile arithmetic over a possibly-collection-typed operand on the Python target — Python's arithmetic operators repeat/concatenate a list instead of broadcasting element-wise, diverging from the interpreter. Fail closed (D6). Materialize the operand with evaluate() and compile a scalar element function instead.`
        );
    }

    // GPU shader targets: a comparison or logical connective over a non-scalar
    // operand must not lower through the scalar infix operators — GLSL rejects
    // `vecN < float` outright, and where an infix form IS legal it means the
    // wrong thing (WGSL `vecN == vecN` is a `vecN<bool>`, not the scalar bool
    // the surrounding expression expects; GLSL `vecN == vecN` is ATOMIC
    // aggregate equality where the interpreter broadcasts a `List`
    // element-wise). The element-wise `Which`/`If` selection path builds its
    // boolean-vector masks directly (`compileGPUSelection`) and never routes a
    // condition through here; everything else fails closed (D6). One shape is
    // deliberately admitted: GLSL `Equal`/`NotEqual` over TUPLE-shaped
    // operands — a tuple (point) is atomic in the interpreter too, and GLSL
    // `==` on two vecNs is scalar aggregate equality, so that lowering is
    // faithful. (On WGSL the same `==` is component-wise — excluded.)
    // Complex operands are excluded: they already skip the infix path below
    // and fail closed in function dispatch.
    if (
      (target.language === 'glsl' || target.language === 'wgsl') &&
      (isRelationalOperator(h) || BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h))
    ) {
      const isTupleShaped = (a: Expression): boolean => {
        if (isFunction(a, 'Tuple')) return true;
        const t = compilationType(a);
        return typeof t !== 'string' && t.kind === 'tuple';
      };
      const tupleEquality =
        target.language === 'glsl' && (h === 'Equal' || h === 'NotEqual');
      const offending = args.find(
        (a) =>
          !BaseCompiler.isComplexValued(a) &&
          BaseCompiler.isNonScalarShape(a) &&
          !(tupleEquality && isTupleShaped(a))
      );
      if (offending !== undefined)
        throw new Error(
          `${h}: cannot compile a comparison or logical connective over the ` +
            `non-scalar operand \`${offending.toString()}\` on the ` +
            `${target.language} target — the shader infix operators are ` +
            `scalar-only (element-wise conditions compile only inside a ` +
            `\`Which\`/\`If\` selection). Fail closed (D6).`
        );
    }

    // An ORDERING comparison over a complex-valued operand has no lowering:
    // the complex numbers are not ordered, so the interpreter leaves
    // `Less(i·x, 0)` symbolic (no truth value), while both the infix path
    // below and the function codegen it falls through to emit a raw `<` over
    // the `{re, im}` object — a silent `false` behind `success: true`. Fail
    // closed (D6) instead. `Equal`/`NotEqual` are NOT affected: they have
    // their own complex-aware codegen (`_SYS.eq`/`_SYS.neq`). An operand of
    // merely UNKNOWN sign over a real kernel (`Sqrt(x)`) is not complex-valued
    // by `isComplexValued`'s carve-out, so `Less(Sqrt(x), 2)` still compiles.
    if (BaseCompiler.ORDERING_HEADS.has(h)) {
      // D2 (design §8, `docs/COMPILATION-MODEL.md`): an
      // operand that MAY be complex — a `complex`-typed symbol, a wide binding
      // under the complex discipline, a promoted radical — takes the RUNTIME
      // rule (bind once, compare the real parts when every imaginary part is
      // exactly zero, `false` otherwise); only a STATICALLY non-real operand
      // is the compile-time decline, raised inside `realOperandGuard`.
      // A CHAIN (`a < b < c`) binds each operand at its own edge so a later
      // operand is never evaluated when an earlier edge already failed — the
      // interpreter's short-circuit order (`realOperandChain`).
      const guarded =
        args.length > 2
          ? BaseCompiler.realOperandChain(h, args, target)
          : BaseCompiler.realOperandGuard(
              h,
              args,
              target,
              () =>
                BaseCompiler.compileExpr(engine, h, args, prec, target, node),
              'boolean'
            );
      if (guarded !== undefined) return guarded;
      const complexOperand = args.find(
        (a) =>
          BaseCompiler.isComplexValued(a) && !BaseCompiler._codeOverrides.has(a)
      );
      if (complexOperand !== undefined)
        throw new Error(
          `${h}: cannot compile an ordering comparison over the ` +
            `complex-valued operand \`${complexOperand.toString()}\` — the ` +
            `complex numbers are not ordered, and the interpreter leaves the ` +
            `comparison symbolic. Fail closed (D6).`
        );
    }

    // Handle operators
    const op = target.operators?.(h);

    if (op !== undefined) {
      // Skip infix operators for complex operands — fall through to function
      // dispatch. An operand the D2 runtime rule has bound to a real
      // projection (`_codeOverrides`) is real here.
      const hasComplex = args.some(
        (a) =>
          BaseCompiler.isComplexValued(a) && !BaseCompiler._codeOverrides.has(a)
      );
      if (!hasComplex) {
        // Check if this looks like a function name rather than an operator.
        // Function names are alphanumeric identifiers, operators are symbols.
        // A word-spelled *keyword* operator (Python `and`/`or`/`not`) is
        // alphabetic but still infix/prefix — never a function call — so it is
        // excluded here (otherwise `And(a, b)` would emit `and(a, b)`).
        const isFunction =
          /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(op[0]) &&
          !BaseCompiler.WORD_KEYWORD_OPERATORS.has(h);
        // A word-spelled operator needs a separating space between the keyword
        // and its operand (`not x`, `a and b`); a symbolic one does not (`!x`,
        // `a && b`).
        const isWordOp = /^[a-zA-Z_]/.test(op[0]);

        if (isFunction) {
          // Compile as a function call (works for both scalar and collection arguments)
          return `${op[0]}(${args
            .map((arg) => BaseCompiler.compileValueOperand(arg, target))
            .join(', ')})`;
        } else {
          // A relational or logical head whose operand is merely
          // collection-TYPED must not take the raw infix path. `.isCollection`
          // is false for a computed `list<real>` (e.g. `|L - k|`, or
          // `Power(L, 2)`), so the check below lets it through and emits
          // `0 < X` — which, when `X` is an array at run time, stringifies it
          // (`0 < "1,0,1"`) and returns a silent scalar `false` behind a
          // `success: true`. The connectives are worse: a JS array is TRUTHY,
          // so `m1 && m2` yields a whole operand and `!m` yields `false`.
          // Decline here so the head falls through to function codegen, which
          // fails closed (`compileJSCollectionBoolean`) and lets the engine
          // fall back to the interpreter. `Equal`/`NotEqual` are unaffected:
          // they have no infix mapping and always reach their own codegen,
          // which already handles collection operands.
          //
          // JAVASCRIPT ONLY, so that other targets keep their existing
          // lowering unchanged: this diverts to a JS-specific handler, and the
          // hazard being avoided is a JS coercion rule.
          // A STRING operand is exempt from this divert: it matches
          // `collection` in the lattice (its elements are its grapheme
          // clusters) but lowers to a JS string, which the infix `<`/`===`
          // compares exactly as the interpreter does — the coercion hazard
          // this divert guards against does not arise.
          const relationalOverCollection =
            target.language === 'javascript' &&
            (isRelationalOperator(h) ||
              BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h)) &&
            args.some(
              (x) =>
                !isProvablyStringOperand(x) &&
                (x.type.matches('collection<any>') ||
                  isBoundPossiblyCollectionTyped(x))
            );
          // An ORDERING that MIXES a string operand with one that is not
          // provably a string. The raw infix `<` agrees with the interpreter
          // when EVERY operand is a string — it compares strings with `<` too
          // (`compare.ts`) — so an all-string ordering keeps this fast path. A
          // mixed pair does not agree: the interpreter leaves `Less("a", 1)`
          // symbolic whereas `"a" < 1` is a plausible-looking `false`. Decline
          // the infix path there so the head falls through to the JS ordering
          // codegen, which fails closed (D6) and lets the engine fall back to
          // the interpreter. An operand of unknown type alongside a string is
          // POSSIBLY mixed and declines too.
          //
          // JAVASCRIPT ONLY, like the collection divert above: the other
          // targets keep their existing lowering. `isSubtype`, not `.matches`,
          // so an `unknown`-typed operand is never itself string EVIDENCE (plot
          // comparisons with inferred parameters keep byte-identical output).
          //
          // Tested per PARTICIPANT, not per operand, and with the same pair of
          // predicates as the broadcast gate below: an operand that is a
          // broadcast SOURCE puts its elements on the scalar path, so a
          // `broadcastable<string>`-typed operand alongside a number is mixed
          // even though the operand's own type is not a subtype of `string`
          // (`Less(1, L)` compiled to `[false, false]` where the interpreter
          // leaves both comparisons inert).
          //
          // A BINARY ALL-STRING ordering diverts as well, even though it is
          // ADMITTED: the JavaScript ordering codegen emits the same infix
          // comparison, but with each operand first put through the ingress
          // conditioning the interpreter applies when it boxes a string (NFC
          // normalization, then the lone-surrogate replacement — `_SYS.ct`).
          // The interpreter compares content that was conditioned at boxing
          // time, so a raw infix comparison of a decomposed `"e" + U+0301`
          // bound to a string parameter against a precomposed `"é"` literal
          // disagrees with it. Maintainer ruling, 2026-08-16. A CHAINED
          // all-string ordering deliberately stays on the infix path here: the
          // chain lowering below binds temporaries so each operand is
          // evaluated exactly once and the comparisons short-circuit, and the
          // binary arm in `compileJSCollectionBoolean` reproduces neither — so
          // a chain keeps comparing un-conditioned operands.
          const orderingOverString =
            target.language === 'javascript' &&
            isRelationalOperator(h) &&
            (isMixedStringOrderingParticipants(args) ||
              (isInequalityOperator(h) &&
                args.length === 2 &&
                args.every(isProvablyStringOperand)));
          // PYTHON, the same two divert rules as the ordering gates on that
          // target (`assertPyNoMixedStringOrdering` /
          // `assertPyComparableAggregate`, python-target.ts): an ordering whose
          // participants mix string evidence with something not provably a
          // string, or whose participant is an unfaithful AGGREGATE, must not
          // take the infix `<`. A mixed pair emits `"a" < 1` — a
          // plausible-looking boolean where the interpreter stays symbolic —
          // and an aggregate emits `p < q` / `d1 < d2`, which Python answers
          // lexicographically (or raises) where the interpreter leaves the
          // comparison inert. Declining here lets the head fall through to
          // `compilePythonRelation`, which fails closed (D6) with the
          // diagnostic. An ALL-string ordering keeps the fast path: `"a" < "b"`
          // is the interpreter's own string comparison (probe-verified,
          // chains included).
          //
          // A participant that is merely collection-TYPED diverts too, with the
          // same STATIC evidence the JS collection divert above uses: the
          // `!x.isCollection` admission below is blind to an unassigned
          // collection-typed symbol, so `Less(sl1, sl2)` over two
          // `list<string>` parameters emitted the infix `sl1 < sl2` — ONE
          // lexicographic Python bool where the interpreter answers a list of
          // booleans (and the flat-all-string exemption let it straight
          // through). `compilePythonRelation` emits the element-wise
          // `np.less(sl1, sl2)` for the admitted shapes and D6-declines the
          // gated ones.
          const pyOrderingUnfaithful =
            target.language === 'python' &&
            isRelationalOperator(h) &&
            (args.some((x) => unfaithfulComparisonAggregate(x) !== null) ||
              args.some(
                (x) =>
                  // A string operand is exempt — see the JavaScript divert
                  // above. Python's `<` on `str` is the interpreter's own
                  // string comparison.
                  !isProvablyStringOperand(x) &&
                  (x.type.matches('collection<any>') ||
                    isBoundPossiblyCollectionTyped(x))
              ) ||
              isMixedStringOrderingParticipants(args));
          // An ORDERING with a CHARACTER participant, on EVERY target. The
          // interpreter orders two characters by their NFC CODE-POINT sequence
          // (`compare.ts`), whereas `String.prototype.<` compares UTF-16 code
          // UNITS — which places every astral character (U+10000 and above,
          // encoded as a surrogate pair starting at 0xD800) BELOW U+E000–U+FFFF.
          // Probed: `Less(CharacterFrom("\u{10000}"), CharacterFrom(""))`
          // is `False` in the interpreter and `true` under the raw infix `<`, a
          // wrong answer behind `success: true`. Declining here lets the head
          // fall through to the target's own ordering codegen, which emits a
          // code-point comparator on JavaScript and fails closed elsewhere.
          // (`docs/STRING_ROADMAP.md`, D8/D13.)
          const orderingOverCharacter =
            isRelationalOperator(h) && args.some(isProvablyCharacterOperand);
          // Compile as an operator (only for non-collection arguments). A
          // STRING operand is not a collection FOR THIS PURPOSE: it matches
          // `collection` in the lattice but lowers to a target string, which
          // the infix operators compare exactly as the interpreter does.
          if (
            args.every((x) => !x.isCollection || isProvablyStringOperand(x)) &&
            !relationalOverCollection &&
            !orderingOverString &&
            !orderingOverCharacter &&
            !pyOrderingUnfaithful
          ) {
            if (isRelationalOperator(h) && args.length > 2) {
              // Chain relational operators, conjoined with the target's chain
              // operator (`&&` by default; Python `and`).
              //
              // A middle operand appears in TWO comparisons (`a < m < b` →
              // `(a < m) && (m < b)`). Emitting it twice would evaluate it
              // twice — drawing `Random()` twice, say — diverging from the
              // interpreter, which evaluates each operand once. Bind each
              // non-trivial middle operand (indices 1..n-2) to a temporary so it
              // is evaluated exactly once. A symbol or number literal is safe to
              // duplicate, so it is left inline (keeps output clean, no churn).
              //
              // A target WITHOUT `bindExpr` (the GPU shaders) has no
              // expression-level binding form, so it inlines everything. That
              // is safe for a PURE operand only: a shader `Random` draw is
              // deterministic per invocation but `_gpu_rnd_draw` advances a
              // runtime counter, so a second splice draws a DIFFERENT value
              // and shifts every later draw in the shader. An impure middle
              // operand is therefore bound to a hoisted temporary instead; if
              // there is no statement sink to hoist into, the head declines.
              //
              // A bound operand is evaluated BEFORE the body that uses it, so
              // binding only the MIDDLES would run a middle's draw ahead of an
              // impure ENDPOINT left inline in the body — reversing the
              // interpreter's argument order (`Less(Random(), Random(), 0.9)`
              // drew the middle first). So as soon as an impure operand is
              // bound at all, bind EVERY impure operand, in argument order:
              // `bindExpr`'s application form (JS `((a, b) => …)(x, y)`,
              // Python `(lambda a, b: …)(x, y)`) and the hoisted-statement sink
              // both evaluate left to right, so the draws then follow argument
              // order. A chain with no impure operand is untouched.
              //
              // The interpreter SHORT-CIRCUITS a chain (since 2026-08-15,
              // `evaluateChainOperands` in `library/relational-operator.ts`):
              // `Less(5, 1, Random())` stops at `5 < 1` and never draws. A
              // temporary bound AROUND the whole chain is evaluated before any
              // pair, so an operand at index ≥ 2 must instead be bound BEHIND
              // the pairs that precede it: `(a < b) && ((t) => (b < t) &&
              // (t < c))(draw())`. Operands 0 and 1 are always evaluated by
              // the interpreter (the first pair needs both), so their bindings
              // may wrap the whole chain. A target without `bindExpr` (the GPU
              // shaders) can only bind by hoisting a statement — which is
              // unconditional — so an impure operand at index ≥ 2 that must be
              // bound declines there (D6).
              const chainOp = target.chainOp ?? '&&';
              const impureMiddle = args.some(
                (arg, i) =>
                  i >= 1 && i <= args.length - 2 && arg.isPure === false
              );
              // Per operand: its code, or a temporary name plus the binding
              // that introduces it.
              const outerBindings: Array<[name: string, value: string]> = [];
              const innerBindings = new Map<
                number,
                [name: string, value: string]
              >();
              const codes = args.map((arg, i) => {
                // Each comparison after the first is short-circuited by the
                // chain operator, so operands from index 2 on are the lazy
                // edges of this (node-less) lowering — see `lazyOperandRegions`.
                const code =
                  i >= 2
                    ? BaseCompiler.compileOpValue(node, i, target, op[1], arg)
                    : BaseCompiler.compileValueOperand(arg, target, op[1]);
                const isMiddle = i >= 1 && i <= args.length - 2;
                const isImpure = arg.isPure === false;
                if (
                  target.bindExpr &&
                  ((isMiddle && !isSymbol(arg) && !isNumber(arg)) ||
                    (impureMiddle && isImpure))
                ) {
                  const name = BaseCompiler.tempVar(target);
                  if (i >= 2) innerBindings.set(i, [name, code]);
                  else outerBindings.push([name, code]);
                  return name;
                }
                if (!target.bindExpr && impureMiddle && isImpure) {
                  if (!BaseCompiler.canHoist(target) || i >= 2)
                    throw new Error(
                      `${h}: an impure (Random) operand cannot be bound to a ` +
                        'temporary at this position — a repeated draw would ' +
                        'shift every later value in the shader, and a hoisted ' +
                        'draw at index ≥ 2 would fire even when an earlier ' +
                        'comparison already decided the chain. Fail closed (D6).'
                    );
                  const name = BaseCompiler.tempVar(target);
                  const decl =
                    target.language === 'wgsl'
                      ? `var ${name}: f32`
                      : `float ${name}`;
                  BaseCompiler.hoistStatement(target, `${decl} = ${code};`);
                  return name;
                }
                return code;
              });
              // The conjunction of the pairs from pair `k` (comparing operands
              // `k` and `k+1`) to the last, flat — except that the pairs from
              // the first one that reads a bound operand `i+1` (`i ≥ 1`) on
              // are wrapped in that operand's binding, so the temporary is
              // evaluated only once every earlier pair has held. A binding is
              // consumed when wrapped so the recursion does not see it again.
              const chainFrom = (k: number): string => {
                const parts: string[] = [];
                for (let i = k; i < codes.length - 1; i++) {
                  const binding = innerBindings.get(i + 1);
                  if (binding && target.bindExpr) {
                    innerBindings.delete(i + 1);
                    parts.push(target.bindExpr([binding], chainFrom(i)));
                    break;
                  }
                  parts.push(`(${codes[i]} ${op[0]} ${codes[i + 1]})`);
                }
                return parts.join(` ${chainOp} `);
              };
              const body = chainFrom(0);
              if (outerBindings.length > 0 && target.bindExpr)
                return target.bindExpr(outerBindings, body);
              return body;
            }

            let resultStr: string;
            if (args.length === 1) {
              // Unary operator, assume prefix. Word operators get a space.
              const operandCode = BaseCompiler.compileValueOperand(
                args[0],
                target,
                op[1]
              );
              // Insert a separating space when gluing the operator to an
              // operand that begins with the same symbol would form a different
              // token: `-` + `-3.0` must not become `--3.0` (invalid in
              // GLSL/WGSL, a decrement in C-likes/JS). This arises when a
              // negative value is spliced in (e.g. a Sum unroll substituting a
              // negative index into `Negate(i)`). A leading `(` is already safe.
              const glues =
                !isWordOp &&
                operandCode.length > 0 &&
                operandCode[0] === op[0][op[0].length - 1];
              const sep = isWordOp || glues ? ' ' : '';
              resultStr = `${op[0]}${sep}${operandCode}`;
            } else {
              // `Power` is right-associative: `a ** b ** c` parses as
              // `a ** (b ** c)`. So a *left* operand of equal precedence must
              // be parenthesized — otherwise `(a^b)^c` would emit the
              // right-associative `a ** b ** c` (wrong grouping in Python,
              // where `**` is the only right-associative arithmetic operator).
              const rightAssoc = h === 'Power';
              // `Subtract`/`Divide` are left-associative and *non*-associative:
              // `a - (b - c) ≠ (a - b) - c`. So a *right* operand of equal
              // precedence must be parenthesized — otherwise a non-canonical
              // `Divide(a, Divide(b, c))` would emit `a / b / c` (= `(a/b)/c`,
              // wrong grouping). `Add`/`Multiply` are associative, so their
              // operands need no extra parens.
              const leftAssocNonAssociative =
                h === 'Subtract' || h === 'Divide';
              resultStr = args
                .map((arg, i) => {
                  let operandPrec = op[1];
                  if (rightAssoc && i < args.length - 1)
                    operandPrec = op[1] + 1;
                  else if (leftAssocNonAssociative && i > 0)
                    operandPrec = op[1] + 1;
                  // Routed through the edge helper so a short-circuiting
                  // connective (`And`/`Or`, whose operands after the first are
                  // lazy edges) pushes its region instance; a non-region edge
                  // compiles exactly as before.
                  return BaseCompiler.compileOpValue(
                    node,
                    i,
                    target,
                    operandPrec,
                    arg
                  );
                })
                .join(` ${op[0]} `);
            }
            // Same shape gate as the function-codegen and string-helper paths
            // (see `CompileTarget.checkOperandShapes`): the infix arithmetic
            // operators of a shader language are genType-polymorphic with
            // their own overload table, and a typed-symbol or `Matrix` operand
            // — for which `.isCollection` is false — reaches this path with
            // shapes the operator may have no overload for (`vec3 + vec2`,
            // `2.0 + mat2x2f(…)` on WGSL). Throws to fail closed (D6).
            // No hook (JavaScript, Python, interval-js): unchanged.
            target.checkOperandShapes?.(h, args, resultStr, target);
            return op[1] < prec ? `(${resultStr})` : resultStr;
          }
        }
      }
    }

    // Handle special constructs
    if (h === 'Function') {
      // Dispatch to target-specific handler if available (e.g. GPU throws)
      const fnFn = target.functions?.(h);
      if (typeof fnFn === 'function')
        return fnFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      // Default: JavaScript arrow function
      BaseCompiler.assertNoDestructuringParams(args.slice(1));
      const params = args
        .slice(1)
        .map((x) => functionLiteralParameterName(x) || '_');
      // A parameter that would shadow the vars object is emitted under a
      // generated name (see `lambdaParamBinding`); `boundVars` keeps the
      // literal's OWN parameter names, which are what the expression binds.
      const binding = BaseCompiler.lambdaParamBinding(params, args[0], target);
      const lambdaTarget: CompileTarget<Expression> = {
        ...target,
        var: binding.varOf,
        boundVars: BaseCompiler.withBoundNames(target, params),
        // The body runs at CALL time, not here, so it resolves a block-local
        // function against the WHOLE enclosing statement list rather than the
        // part emitted so far — that is what lets `isEven`/`isOdd` reference
        // each other, and a lambda call a sibling declared after it. See
        // `CompileTarget.lexicalFunctions`.
        localFunctions: target.lexicalFunctions ?? target.localFunctions,
      };
      // The body is a bindable region of its own (§5.1(a)); pushed under the
      // lambda's target, so its temporaries land inside the arrow function.
      return `((${binding.emitted.join(', ')}) => ${BaseCompiler.compileOp(
        node,
        0,
        lambdaTarget,
        0,
        args[0].canonical
      )})`;
    }

    if (h === 'Declare') {
      // A destructuring declare (`let (x, y) = …`) is desugared at the block
      // level, into per-leaf declares; one reaching here is in value position
      // (or outside a block entirely) and would compile as `let _ = …`, its
      // pattern names silently reading as NaN — fail closed (D6).
      if (isFunction(args[0], 'Tuple'))
        throw new Error(
          `Cannot compile a destructuring declaration in value position. ` +
            `It is desugared to per-leaf declares only in STATEMENT ` +
            `position (a block's non-final statement, or a loop body). ` +
            `Fail closed (D6).`
        );
      const name = isSymbol(args[0]) ? args[0].symbol : '_';
      // Targets with a `declare` hook handle any initial value at the block
      // level (as a separate assignment statement — see `compileBlock`). For
      // the default path (no hook), emit a combined initializer so a
      // value-carrying `Declare(sym, type, value)` isn't dropped.
      if (target.declare) return target.declare(name);
      const value = BaseCompiler.declareValueOperand(args);
      if (value === undefined) return `let ${name}`;
      // The value may not be an operand of `node` at all (it can come from a
      // trailing attributes dictionary), and `-1` is the WHOLE-NODE region
      // sentinel — compile it plainly rather than open the wrong region.
      const valueIndex = args.indexOf(value);
      const valueCode =
        valueIndex < 0
          ? BaseCompiler.compile(value, target)
          : BaseCompiler.compileOp(node, valueIndex, target, 0, value);
      return `let ${name} = ${valueCode}`;
    }
    if (h === 'Assign') {
      // A destructuring assignment (`(x, y) := …`) is desugared at the block
      // level, into temporaries + writes; a bare one reaching here has no
      // statement list to expand into and would compile as `_ = …`, leaving
      // every target at its old value — fail closed (D6).
      if (isFunction(args[0], 'Tuple'))
        throw new Error(
          `Cannot compile a destructuring assignment in value position. ` +
            `It is desugared to temporaries + writes only in STATEMENT ` +
            `position (a block's non-final statement, or a loop body). ` +
            `Fail closed (D6).`
        );
      // A protocol property assignment — `p.name = v` where some protocol
      // declares `name` a property. The engine keeps the canonical form as
      // `Assign(Field(p, "name"), v)` (the receiver decides at evaluation
      // whether the slot or a `set` accessor takes the write), which the
      // generic lowering below would compile to the silent no-op `_ = v`.
      //
      // There is no lowering to emit in its place. Assigning to a property is a
      // store into a mutable object, and only an object can carry a settable
      // property at all (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Which
      // types can conform"), so every legal receiver here is an object — and
      // objects have no compiled representation yet. Fail closed (D6) rather
      // than emit the no-op; the ROADMAP.md entry for the mutability gate
      // schedules the compiled store with the object work.
      const storeTarget = args[0];
      const storedProperty = isFunction(storeTarget, 'Field')
        ? isString(storeTarget.ops[1]) &&
          protocolDispatchCandidates(
            engine,
            `__set__${storeTarget.ops[1].string}`
          ) !== null
          ? storeTarget.ops[1].string
          : undefined
        : // The QUALIFIED spelling `p.(P.name) = v` keeps its
          // `Assign(ProtocolProperty(P, name, p), v)` shape through
          // canonicalization — the fold to the four-operand operator happens at
          // evaluation, so this is the form the compiler sees.
          isFunction(storeTarget, 'ProtocolProperty') &&
            isString(storeTarget.ops[1])
          ? storeTarget.ops[1].string
          : undefined;
      if (storedProperty !== undefined)
        throw new Error(
          `${storedProperty}: this protocol property assignment has no ` +
            `lowering on target '${target.language ?? 'javascript'}' ` +
            `(a property store writes a mutable object, and objects have no ` +
            `compiled representation). Fail closed (D6).`
        );
      // Any other non-symbol target (a `Subscript` sequence definition, a
      // `Field` naming no protocol property, …) has no lowering: emitting
      // `_ = v` would silently leave the target at its old value (and, in
      // sloppy mode, write a stray global `_`) behind `success: true` —
      // fail closed (D6).
      if (!isSymbol(args[0]))
        throw new Error(
          `Assign: cannot compile — the assignment target ` +
            `'${args[0].operator}' is not a variable, and this target ` +
            `shape has no lowering. Fail closed (D6).`
        );
      // The write must use the SAME spelling a READ of this name compiles to,
      // or the two halves of the variable disagree (`assignLValue`).
      return `${BaseCompiler.assignLValue(engine, args[0].symbol, target)} = ${BaseCompiler.compileOp(node, 1, target, 0, args[1])}`;
    }
    if (h === 'Return') {
      // A target with a statically typed signature checks the returned value's
      // shape against it HERE, while the emitter's local frames are still
      // pushed (see `CompileTarget.onReturn`).
      target.onReturn?.(args[0]);
      return `return ${BaseCompiler.compileOp(node, 0, target, 0, args[0])}`;
    }
    if (h === 'Break') return 'break';
    if (h === 'Continue') return 'continue';

    if (h === 'Loop') {
      const loopFn = target.functions?.(h);
      if (typeof loopFn === 'function')
        return loopFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      return BaseCompiler.compileForLoop(args, target, node);
    }

    if (h === 'Comprehension') {
      const compFn = target.functions?.(h);
      if (typeof compFn === 'function')
        return compFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      return BaseCompiler.compileComprehension(args, target);
    }

    if (h === 'If') {
      if (args.length !== 3) throw new Error('If: wrong number of arguments');
      // A condition that may be an indexed collection at run time selects
      // ELEMENT-WISE: `If(c, t, f)` is the two-clause `Which(c, t, True, f)`
      // (see the `Which` branch below and `target.selection`). Consulted BEFORE
      // the target's `functions` entry, so a target that has both — GPU,
      // interval-js — gets the hook first. `null` — every condition provably
      // scalar — keeps the `functions` entry / ternary below unchanged.
      // The clause list handed to `selection` is in `Which` shape, so its
      // positions are NOT the `If` node's operand indices: 0 → 0 (condition),
      // 1 → 1 (then), 2 is the synthesized `True` (no edge), 3 → 2 (else).
      const selectionOperand: OperandCompiler<Expression> = (expr, opIndex) => {
        if (opIndex === undefined || opIndex === 2)
          return BaseCompiler.compileValueOperand(expr, target);
        return BaseCompiler.compileOpValue(
          node,
          opIndex === 3 ? 2 : opIndex,
          target,
          0,
          expr
        );
      };
      const selection = target.selection?.(
        [args[0], args[1], engine.True, args[2]],
        selectionOperand,
        target
      );
      if (selection !== null && selection !== undefined) return selection;
      BaseCompiler.assertScalarCondition(args[0]);
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(args, BaseCompiler.operandCompiler(node, target), target);
        }
        return `${fn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      // Mixed real/complex arms: coerce to one convention (Tycho item 60 —
      // see `branchComplexCoercion`).
      const coerce = BaseCompiler.branchComplexCoercion(
        [args[1], args[2]],
        target
      );
      // Both arms are conditionally evaluated: each is its own region, so a
      // temporary bound inside an arm is never hoisted out of it (§7.3).
      const arm = (v: Expression, i: number): TargetSource => {
        const code = BaseCompiler.compileOp(node, i, target, 0, v);
        return coerce ? coerce(v, code) : code;
      };
      return `((${BaseCompiler.compile(
        args[0],
        target
      )}) ? (${arm(args[1], 1)}) : (${arm(args[2], 2)}))`;
    }

    if (h === 'Which') {
      if (args.length < 2 || args.length % 2 !== 0)
        throw new Error(
          'Which: expected even number of arguments (condition/value pairs)'
        );
      // A condition that may be an indexed collection at run time selects
      // ELEMENT-WISE (`np.select`, R1–R4 of
      // `docs/BROADCAST-MODEL.md`): the target lowers
      // the whole clause list to its own selection helper. Consulted BEFORE the
      // target's `functions` entry (as in the `If` branch above), so a target
      // that has both — GPU, interval-js — gets the hook first. `null` — every
      // condition provably scalar — keeps the `functions` entry / ternary chain
      // below unchanged.
      const selection = target.selection?.(
        args,
        BaseCompiler.operandCompiler(node, target),
        target
      );
      if (selection !== null && selection !== undefined) return selection;
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(args, BaseCompiler.operandCompiler(node, target), target);
        }
        return `${fn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      // Compile to chained ternaries. When arms mix real and complex values,
      // coerce every arm — including the no-match NaN default — to the complex
      // convention (Tycho item 60: a constant base-case arm in a
      // complex-valued recursion compiled to a plain number, NaN-poisoning
      // every consumer of the `{ re, im }` slots).
      const coerce = BaseCompiler.branchComplexCoercion(
        args.filter((_x, i) => i % 2 === 1),
        target
      );
      // Every value arm, and every condition after the first, sits behind a
      // ternary test: each is its own region (§5.1(b)), so nothing binds
      // across an arm that may not be evaluated.
      const compilePair = (i: number): string => {
        if (i >= args.length) return coerce ? '({ re: NaN, im: NaN })' : 'NaN';
        const cond = args[i];
        const val = args[i + 1];
        const armCode = BaseCompiler.compileOp(node, i + 1, target, 0, val);
        const valCode = coerce ? coerce(val, armCode) : armCode;
        // If condition is the symbol True, it's the default branch
        if (isSymbol(cond, 'True')) {
          return `(${valCode})`;
        }
        const condCode =
          i === 0
            ? BaseCompiler.guardCondition(cond, target)
            : BaseCompiler.withCseOperand(node, i, target, () =>
                BaseCompiler.guardCondition(cond, target)
              );
        return `((${condCode}) ? (${valCode}) : ${compilePair(i + 2)})`;
      };
      return compilePair(0);
    }

    if (h === 'When') {
      if (args.length !== 2)
        throw new Error('When: expected exactly 2 arguments (expr, cond)');
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(args, BaseCompiler.operandCompiler(node, target), target);
        }
        return `${fn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      // Compile to ternary: cond ? expr : NaN. A complex-valued arm keeps the
      // masked branch in the same `{ re, im }` convention (see
      // `branchComplexCoercion`).
      const coerce = BaseCompiler.branchComplexCoercion([args[0]], target);
      const nan = coerce ? '({ re: NaN, im: NaN })' : 'NaN';
      // Special-case constant True/False conditions to avoid bare symbol refs
      if (isSymbol(args[1], 'True'))
        return `(${BaseCompiler.compileOp(node, 0, target, 0, args[0])})`;
      if (isSymbol(args[1], 'False')) return nan;
      // The VALUE is the conditional position here (the single condition is
      // eager) — see the `When` entry of the lazy-operand inventory.
      const val = BaseCompiler.compileOp(node, 0, target, 0, args[0]);
      const cond = BaseCompiler.guardCondition(args[1], target);
      return `((${cond}) ? (${val}) : ${nan})`;
    }

    if (h === 'Match') {
      // A target may override the whole construct (GPU emits target-specific
      // ternaries; interval/Python fail closed). Otherwise the default is the
      // JavaScript emission (chained `if`/`switch` in an arrow-IIFE).
      //
      // `Match` is fully CSE-inert in Phase 1 (§2): its guards and bodies are
      // compiled from plan-constructed closure trees, not from these operands,
      // so emission runs under a blind instance — no candidate resolves inside,
      // and no enclosing region's candidate can leak in through a shared node.
      return BaseCompiler.withCseBlind(target, () => {
        const fn = target.functions?.(h);
        if (typeof fn === 'function')
          return fn(
            args,
            (expr) => BaseCompiler.compileValueOperand(expr, target),
            target
          );
        return BaseCompiler.compileMatchJS(engine, args, target);
      });
    }

    if (h === 'Block') {
      return BaseCompiler.compileBlock(args, target, node, true, prec);
    }

    // Absence-discharge primitives (§3.F). `IsMissing`/`Coalesce` lower through
    // the target-supplied absence capability, choosing the numeric or object
    // axis by the operand's (result's) domain (I6). A target lacking the needed
    // axis — GPU has no `isAbsent`, interval/GPU have no `object` axis — fails
    // closed with a diagnostic (propagation stays native; discharge does not).
    if (h === 'IsMissing') {
      if (args.length !== 1)
        throw new Error('IsMissing: expected exactly one argument');
      const axis = BaseCompiler.absenceAxisForType(
        args[0].type.type,
        target,
        'IsMissing'
      );
      if (axis.isAbsent === undefined)
        throw new Error(
          `IsMissing: target '${target.language ?? 'unknown'}' cannot test ` +
            `absence (no 'isAbsent' capability — e.g. GPU fast-math cannot ` +
            `guarantee 'isnan' survives). Fail closed (§3.F).`
        );
      return axis.isAbsent(BaseCompiler.compileValueOperand(args[0], target));
    }

    if (h === 'Coalesce') {
      if (args.length === 0)
        throw new Error('Coalesce: expected at least one argument');
      // The result's domain (its widened type — `T₁° | … | Tₙ₋₁° | Tₙ`, §3.D)
      // picks the axis: numeric → NaN-coalesce, object → null-coalesce.
      // Unfold each operand's declared type reference before the strip — the
      // strip is structural and does not see through a `reference` (an alias of
      // `T | missing` would keep its `missing` arm and mis-select the axis).
      const resultType = widen(
        ...args.map((a, i) => {
          const t = compilationType(a);
          return i < args.length - 1 ? stripMissingFromType(t) : t;
        })
      );
      const axis = BaseCompiler.absenceAxisForType(
        resultType,
        target,
        'Coalesce'
      );
      if (axis.coalesce === undefined)
        throw new Error(
          `Coalesce: target '${target.language ?? 'unknown'}' cannot ` +
            `discharge absence (no 'coalesce' capability). Fail closed (§3.F).`
        );
      // Compiled coalescing evaluates the defaults lazily, left to right: the
      // operands after the first are their own regions (§5.1(b)).
      const codes = args.map((a, i) =>
        i === 0
          ? BaseCompiler.compileValueOperand(a, target)
          : BaseCompiler.compileOpValue(node, i, target, 0, a)
      );
      // Fold right: coalesce(a0, coalesce(a1, … coalesce(a_{n-1}, a_n))).
      let acc = codes[codes.length - 1];
      for (let i = codes.length - 2; i >= 0; i--)
        acc = axis.coalesce(codes[i], acc);
      return acc;
    }

    // Kleene/IEEE `Equal`/`NotEqual` guarded lowering (§3.D, amended
    // 2026-07-24; extended to `NotEqual` 2026-08-08).
    // Comparisons are IEEE over `NaN` and Kleene over the `Missing` symbol. For
    // a NUMERIC-domain operand a raw `==`/tolerant-compare already IS the IEEE
    // semantics (`NaN == NaN` is `false`), so no guard is emitted — the plain
    // codegen below runs and interpreter/compiled agree by construction. The
    // guard is kept ONLY when an operand can hold an OBJECT-domain hole (e.g.
    // `string | missing`), where a `Missing` must lower to the target null:
    // emit `isAbsent(a) || isAbsent(b) ? <object null> : <a == b>`. The absent
    // boolean is an OBJECT-domain value, so a target without the object axis
    // (GPU) fails closed.
    //
    // `NotEqual` is guarded on exactly the same terms, and for the same reason
    // `Equal` is: the interpreter answers `Missing` for BOTH
    // (`NotEqual(Missing, 1)` → `Missing`, pinned in `missing-value.test.ts`
    // §P3). It was `Equal`-only while every string-bearing `NotEqual` failed
    // closed on the string gate; once the tier-2 admissions started compiling
    // `NotEqual(s, "x")` for `s: string | missing` (the literal supplies the
    // string evidence, and the union is neither provably numeric nor a
    // collection), the unguarded lowering emitted `undefined !== "x"` — a bare
    // `true` where the interpreter answers `Missing`.
    const isObjectDomainMissing = (a: Expression): boolean => {
      const t = compilationType(a);
      if (!typeContainsMissing(t)) return false;
      const stripped = resolveTypeForCompilation(stripMissingFromType(t));
      return !(stripped === 'never' || isSubtype(stripped, 'number'));
    };
    if (
      (h === 'Equal' || h === 'NotEqual') &&
      target.absence !== undefined &&
      args.length === 2 &&
      args.some(isObjectDomainMissing) &&
      // A STRING participant is not a collection FOR THIS PURPOSE: it matches
      // `collection` in the lattice (its elements are its grapheme clusters)
      // but compares as ONE value on both the interpreter and the compiled
      // side, which is exactly the shape this scalar Kleene guard handles.
      args.every(
        (a) =>
          isProvablyStringOperand(a) ||
          (!a.isCollection && !a.type.matches('collection<any>'))
      )
    ) {
      if (target.absence.object === undefined)
        throw new Error(
          `${h}: an absent (Kleene) boolean has no object representation on ` +
            `target '${target.language ?? 'unknown'}'. Discharge the operands ` +
            `with 'Coalesce' first. Fail closed (§3.F).`
        );
      const guardOf = (a: Expression): TargetSource => {
        const axis = BaseCompiler.absenceAxisForType(a.type.type, target, h);
        if (axis.isAbsent === undefined)
          throw new Error(
            `${h}: target '${target.language ?? 'unknown'}' cannot test ` +
              `absence (no 'isAbsent' capability). Fail closed (§3.F).`
          );
        return axis.isAbsent(BaseCompiler.compileValueOperand(a, target));
      };
      // The inner (both-present) comparison. For operands whose stripped
      // type is wholly STRING, the target's `Equal` codegen is the numeric
      // tolerance kernel — silently `false` for any pair of present strings
      // (`Math.abs("x" - "y")` is NaN), and now declined by the string gate.
      // The faithful inner for strings is STRICT equality: the interpreter
      // compares strings exactly (no tolerance), so `===` (`==` on word-chain
      // targets, i.e. Python) is the interpreter's own semantics. Everything
      // not wholly-string keeps the target's `Equal` codegen, with its gates.
      const strippedOf = (a: Expression): Type =>
        resolveTypeForCompilation(stripMissingFromType(compilationType(a)));
      const allString = args.every((a) => isSubtype(strippedOf(a), 'string'));
      let inner: TargetSource;
      if (allString) {
        const [a, b] = args.map((e) =>
          BaseCompiler.compileValueOperand(e, target)
        );
        const pyOp = h === 'Equal' ? '==' : '!=';
        const jsOp = h === 'Equal' ? '===' : '!==';
        inner =
          target.chainOp === 'and'
            ? `(${a}) ${pyOp} (${b})`
            : `(${a}) ${jsOp} (${b})`;
      } else {
        const eqFn = target.functions?.(h);
        if (typeof eqFn !== 'function')
          throw new Error(
            `${h}: target '${target.language ?? 'unknown'}' has no equality ` +
              `codegen for the guarded (Kleene) form. Fail closed (§3.F).`
          );
        inner = eqFn(
          args,
          (e) => BaseCompiler.compileValueOperand(e, target),
          target
        );
      }
      const nullLit = target.absence.object.nullLiteral;
      // A word-`chainOp` target (Python: `and`) spells logical-or `or` and the
      // conditional `X if C else Y`; a C-style target uses `||` and `C ? X : Y`.
      const pythonic = target.chainOp === 'and';
      const guard = `${guardOf(args[0])} ${pythonic ? 'or' : '||'} ${guardOf(args[1])}`;
      return pythonic
        ? `(${nullLit} if (${guard}) else ${inner})`
        : `((${guard}) ? ${nullLit} : ${inner})`;
    }

    // `Typed(value, type)` is a transparent runtime ascription — it constrains
    // the static type but has no runtime effect, so it compiles to its value
    // operand on every target (the interpreter ignores it likewise). Without
    // this, a helper declared with a precise return type (e.g. `(number) ->
    // vector<11>`) wraps its body in `Typed`, and every compiled call throws
    // `Unknown operator \`Typed\`` at the dispatch below.
    //
    // One exception on the plain JavaScript target: the ascription changes the
    // emitted CONVENTION when it promises a complex value over an operand
    // whose own analysis is real. Consumers read the ascribed type
    // (`isComplexValued` sees `complex`) and access `{ re, im }` slots, so a
    // real-emitted operand would NaN-poison them — e.g. the declared-signature
    // canonicalization wraps an all-real function body in
    // `Typed(body, "complex")` (Tycho item 60). Emit the complex object the
    // ascription promises.
    if (h === 'Typed') {
      const code = BaseCompiler.compile(args[0], target);
      if (target.language === 'javascript') {
        const s = isString(args[1])
          ? args[1].string
          : isSymbol(args[1])
            ? args[1].symbol
            : undefined;
        if (s !== undefined) {
          let ascribed: Type | undefined = undefined;
          try {
            ascribed = parseType(s, engine._typeResolver);
          } catch {}
          if (ascribed !== undefined && isNonRealNumber(ascribed)) {
            if (BaseCompiler.isProvablyRealValued(args[0], target))
              return `({ re: ${code}, im: 0 })`;
            // Neither provably real nor complex-shaped: the value emits as a
            // plain number the ascription's consumers would slot-read
            // (see `branchComplexCoercion` for the same inconclusive class);
            // the idempotent `_SYS.cplx` settles the convention at run time.
            if (!BaseCompiler.isComplexValued(args[0]))
              return `_SYS.cplx(${code})`;
          }
        }
      }
      return code;
    }

    // A qualified protocol call — `Comparable.compare(x, y)` — canonicalizes
    // and STAYS `Apply(Field(Comparable, "compare"), x, y)` (the
    // `ProtocolMember` node only appears when the `Field` EVALUATE handler's
    // wrapper literal beta-reduces). Intercept it BEFORE the target's `Apply`
    // mapping, which would otherwise compile the protocol-naming `Field`
    // operand and die inside it. When the dispatch tier declines, fail closed
    // for the whole unit rather than falling through to the generic `Apply`
    // lowering (ruled 2026-08-12, `docs/COMPILATION-MODEL.md`).
    if (h === 'Apply' && args.length >= 2 && isFunction(args[0], 'Field')) {
      const fieldOps = args[0].ops;
      const record = protocolOfSymbol(engine, fieldOps[0]);
      const member = isString(fieldOps[1]) ? fieldOps[1].string : undefined;
      if (record !== undefined && member !== undefined) {
        const code = BaseCompiler.tryCompileProtocolDispatch(
          engine,
          {
            implKey: member,
            member,
            protocol: record.name,
            args: args.slice(1),
          },
          target
        );
        if (code !== undefined) return code;
        throw new Error(
          `${record.name}.${member}: this protocol call has no lowering on ` +
            `target '${target.language ?? 'javascript'}' (dynamic dispatch ` +
            `could not be proven compilable). Fail closed (D6).`
        );
      }
    }

    // Handle function calls
    const fn = target.functions?.(h);
    if (!fn) {
      // A four-operand `ProtocolProperty` is a property STORE, not a call — the
      // shape a hand-built expression spells, and what `p.(P.name) = v` folds
      // to at evaluation. Refused with the same message as the `Assign`
      // spellings of the same write: a store writes a mutable object, and
      // objects have no compiled representation yet.
      if (h === 'ProtocolProperty' && args.length === 4)
        throw new Error(
          `${isString(args[1]) ? args[1].string : 'property'}: this protocol ` +
            `property assignment has no lowering on target ` +
            `'${target.language ?? 'javascript'}' (a property store writes a ` +
            `mutable object, and objects have no compiled representation). ` +
            `Fail closed (D6).`
        );

      // A protocol call — a bare dispatcher head (`compare(x, y)`), the
      // `ProtocolMember`/`ProtocolProperty` operators, or a `Field` read that
      // only a protocol property can answer. Compiled as a direct call
      // (static resolution) or a reified guard chain (dynamic dispatch); a
      // decline falls through to the standard fail-closed throw below.
      const protoCall = BaseCompiler.protocolCallParts(engine, h, args);
      if (protoCall !== undefined) {
        const code = BaseCompiler.tryCompileProtocolDispatch(
          engine,
          protoCall,
          target
        );
        if (code !== undefined) return code;
      }

      // `h` may name a function-valued BLOCK LOCAL of an enclosing statement
      // list (`const g = (k) => …`, then `g(3)`). That binding is emitted by
      // the block itself, so the call is an ordinary call of it — and it must
      // be resolved BEFORE the engine lookup below, which a same-named engine
      // symbol would otherwise win.
      const localFn = BaseCompiler.tryCompileLocalFunctionCall(h, args, target);
      if (localFn !== undefined) return localFn;

      // `h` may be a symbol whose engine definition is a user-defined function
      // literal (`f(x) := …`, `x ↦ …`). Emit it as a named local function and
      // compile the call site as `_fn_f(arg)`. Returns undefined for a truly
      // unknown operator (no such definition) or a target that opts out.
      //
      // Skipped when `h` names a BOUND variable of the enclosing compilation —
      // a function literal's parameter, a loop index, a block local. That
      // binding is what the call applies, and it shadows any same-named engine
      // definition; resolving the engine definition instead emitted a call to
      // the WRONG function. With `f` assigned at engine level, the literal
      // `(f, x) ↦ f(x)` emitted `_fn_f(x)` and so ignored its own `f`
      // argument, disagreeing with the interpreter. A bound head that is a
      // block-local FUNCTION was already resolved by
      // `tryCompileLocalFunctionCall` above and never reaches this line;
      // anything else falls through to the fail-closed throw below, so the
      // interpreter — which resolves the parameter correctly — runs the call.
      // Ruled by the user 2026-08-14: fail closed now; compiling such a call as
      // a direct call of the bound parameter (true higher-order compilation)
      // remains a possible future feature, not a bug fix.
      const userFn = target.boundVars?.has(h)
        ? undefined
        : BaseCompiler.tryCompileUserFunction(engine, h, args, target);
      if (userFn !== undefined) return userFn;
      throw new Error(
        BaseCompiler.noLoweringMessage(
          engine,
          h,
          args,
          target,
          declinedByCustomHandler
        )
      );
    }

    if (typeof fn === 'function') {
      // The same real-only rule the string-mapped branch below applies, for
      // the heads whose lowering is real-only but spelled as function codegen
      // (`Math.floor`, `sign(x)·round(|x|)`, `Math.max`, `np.floor`, …). See
      // `REAL_ONLY_CODEGEN_HEADS` for the three families and the NaN each one
      // was measured producing behind `success: true`.
      if (
        BaseCompiler.REAL_ONLY_CODEGEN_HEADS.has(h) &&
        target.language !== undefined &&
        !target.language.startsWith('interval')
      ) {
        // The operands the gate scans and binds — the args themselves,
        // except `ColorFromColorspace`, whose maybe-complex scalars live
        // INSIDE its literal components tuple (`realOnlyGuardOperands`).
        const guardArgs = BaseCompiler.realOnlyGuardOperands(h, args);
        if (
          guardArgs.some(
            (a) =>
              BaseCompiler.isComplexValued(a) &&
              !BaseCompiler._codeOverrides.has(a)
          )
        ) {
          // D2/D6 runtime rule (see `realOperandGuard`): each maybe-complex
          // scalar operand is bound once and the real lowering runs on its
          // real part when every imaginary part is exactly zero; otherwise
          // the failing branch has the SAME shape the head returns — scalar
          // NaN for the scalar heads, an equally-sized NaN-filled array for
          // the color constructors (`realOnlyResultKind`).
          const guarded = BaseCompiler.realOperandGuard(
            h,
            guardArgs,
            target,
            () => BaseCompiler.compileExpr(engine, h, args, prec, target, node),
            BaseCompiler.realOnlyResultKind(h, args)
          );
          if (guarded !== undefined) return guarded;
          throw new Error(
            `${h}: the target's lowering for this head is real-only and cannot represent a complex-valued argument. Fail closed (D6).`
          );
        }
      }

      // A `broadcastable` head over a single finite indexed collection:
      // apply the head's scalar element lowering across the collection. How
      // that is spelled is a property of the TARGET LANGUAGE, not of the base
      // compiler — Python fans out with a comprehension, the shader languages
      // are already componentwise on a `vecN` and do not fan out at all — so
      // it is delegated to the target's `broadcastUnary` hook. A target
      // without one fails closed (D6); the base compiler used to emit a
      // JavaScript `.map((v) => …)` arrow here for EVERY target, which is not
      // valid GLSL, WGSL or Python.
      const def = engine.lookupDefinition(h);
      if (
        isOperatorDef(def) &&
        def.operator.broadcastable &&
        args.length === 1 &&
        isFiniteIndexedCollection(args[0])
      ) {
        const broadcast = BaseCompiler.compileBroadcastUnary(
          engine,
          h,
          args[0],
          fn,
          target
        );
        if (broadcast !== undefined) return broadcast;
        throw new Error(
          `${h}: cannot compile an element-wise broadcast over the collection ` +
            `\`${args[0].toString()}\` on the ${
              target.language ?? 'javascript'
            } target — it has no \`broadcastUnary\` lowering for this shape. ` +
            `Fail closed (D6). Materialize the collection with evaluate() and ` +
            `compile a scalar element function instead.`
        );
      }
      // The index-aware operand compiler (`OperandCompiler`): a handler that
      // lowers a construct with conditionally-evaluated operand positions
      // passes the index for those positions and gets the matching CSE region
      // instance. A handler that omits it compiles exactly as before.
      const code = fn(args, BaseCompiler.operandCompiler(node, target), target);
      // A target with a static type system gets to reject the emission for the
      // operand shapes it was given (`CompileTarget.checkOperandShapes`); it
      // throws to fail closed (D6). No hook: unchanged.
      target.checkOperandShapes?.(h, args, code, target);
      // A head that ALSO has an infix spelling gets the same precedence
      // treatment its infix emission would have received. A function handler
      // takes over when the infix path declines — a collection operand, a
      // complex one — but it lowers the very same operator, so its emission
      // binds just as loosely: the GPU `Add` handler emits
      // `vec2(a, b) + vec2(c, d)` for a sum of two points, and splicing that
      // into an enclosing `s * …` without parentheses yielded
      // `s * vec2(a, b) + vec2(c, d)`, read as `(s * P) + Q`. Wrapping here on
      // `op[1] < prec` mirrors the infix path's own rule verbatim.
      const opPrec = target.operators?.(h)?.[1];
      if (opPrec !== undefined && opPrec < prec) return `(${code})`;
      return code;
    }

    // `fn` is a plain string: the target maps this head to a real-only helper
    // (e.g. JS `_SYS.erf`, Python `scipy.special.erf`). Such a helper takes a
    // real scalar; handing it a complex value silently returns garbage (compiled
    // `Erf(z)` for complex z → −1, not NaN). Fail closed (D6) with the offending
    // head. Heads that legitimately consume complex (`Real`/`Imaginary`/
    // `Argument`/`Conjugate`) are string-mapped in some targets but are exempt.
    if (
      target.language !== undefined &&
      !target.language.startsWith('interval') &&
      !BaseCompiler.COMPLEX_TRANSPARENT_HEADS.has(h) &&
      args.some(
        (a) =>
          BaseCompiler.isComplexValued(a) && !BaseCompiler._codeOverrides.has(a)
      )
    ) {
      // D6 runtime rule (design §8): `Erf(x)` for a maybe-complex `x` runs
      // the real helper on the real part when the imaginary part is exactly
      // zero and answers `NaN` otherwise; a statically non-real operand is
      // the compile-time decline (inside `realOperandGuard`).
      const guarded = BaseCompiler.realOperandGuard(
        h,
        args,
        target,
        () => BaseCompiler.compileExpr(engine, h, args, prec, target, node),
        'number'
      );
      if (guarded !== undefined) return guarded;
      throw new Error(
        `${h}: real-only target helper "${fn}" cannot represent a complex-valued argument. Fail closed (D6).`
      );
    }

    const call = `${fn}(${args
      .map((x) => BaseCompiler.compileValueOperand(x, target))
      .join(', ')})`;
    // Same shape gate as the function-codegen path above: a string-mapped
    // helper is a scalar/genType signature too (`atan`, `clamp`, `mod`), and
    // handing it a `vecN`/`matN` operand it has no overload for is invalid
    // source, not a runtime concern.
    target.checkOperandShapes?.(h, args, call, target);
    return call;
  }

  /**
   * The diagnostic for a head that reached the end of `compileExpr` with no
   * lowering. Three distinct causes, three distinct messages (Tycho item 109a
   * — bucketing a compile band by message is only possible if the message
   * names the actual cause):
   *
   * 1. A per-operator `compile` handler ran and DECLINED (returned
   *    `undefined`/`null`/`''`). The head IS lowerable — just not for these
   *    operand shapes on this target. The operand types are named, since the
   *    shape is what the handler rejected.
   * 2. The head has an operator definition (the engine knows it) but this
   *    target has no codegen for it — a target gap, not an unknown symbol.
   * 3. No definition at all: a genuinely unknown operator. ONLY this case
   *    keeps the historical `Unknown operator \`X\`` wording.
   */
  private static noLoweringMessage(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    declinedByCustomHandler: boolean
  ): string {
    const lang = target.language ?? 'unknown';
    if (declinedByCustomHandler) {
      const types = args.map((a) => `\`${a.type.toString()}\``).join(', ');
      return (
        `${h}: cannot compile — the operator's compile handler has no lowering ` +
        `for target '${lang}' with these operand types (${types || 'none'}). ` +
        `The head is known to the engine and lowers for other targets/operand ` +
        `shapes; this is not an unknown operator. Fail closed (D6).`
      );
    }
    // "Known" = the engine has an OPERATOR definition. A head that was merely
    // auto-declared by boxing an application (`["zzz", 1]`) gets a *value*
    // definition, and is genuinely unknown.
    let known = false;
    try {
      known = isOperatorDef(engine.lookupDefinition(h));
    } catch {
      /* an unresolvable head is, by definition, unknown */
    }
    if (known)
      return (
        `${h}: cannot compile — the operator is known to the engine but ` +
        `target '${lang}' has no lowering for it. Fail closed (D6).`
      );
    return `Unknown operator \`${h}\``;
  }

  /**
   * Function heads that consume a complex value and return a real (or complex)
   * result. These are string-mapped to a complex-aware library routine in some
   * targets (e.g. Python `Real: 'np.real'`), so — unlike a real-only helper —
   * a complex argument is expected and must NOT trip the fail-closed guard.
   */
  private static readonly COMPLEX_TRANSPARENT_HEADS: ReadonlySet<string> =
    new Set(['Real', 'Imaginary', 'Argument', 'Conjugate']);

  /**
   * Heads that produce a real-SHAPED value BY DEFINITION — whatever their
   * operand's type or complexness. Every target lowers them to a real scalar
   * (`Imaginary` → `(z).y` on GLSL/WGSL, `.im` on JS, `np.imag` on Python;
   * `Argument` → `atan(z.y, z.x)` / `_SYS.carg`), so an enclosing form may
   * treat them as real without parent and child disagreeing on the value
   * shape.
   *
   * Read by `isComplexValued` BEFORE any type-based branch: `Imaginary` types
   * bare `number` (deliberately — `Im(~oo)` is `NaN`), which would otherwise
   * fall through to the conservative operand recursion and report complex,
   * failing the real-only-helper gate closed on `Mod(Imaginary(z), 1)` (Tycho
   * item 147). And a `Real(±∞)` can type `non_finite_number`, so the
   * short-circuit must also precede the `isNonRealNumber` branch.
   *
   * Deliberately excludes `Conjugate` (complex → complex: emits `vec2` /
   * `{re, im}`) and `AbsArg` (tuple-valued). `Arg` canonicalizes to
   * `Argument`, so it needs no entry.
   */
  private static readonly REAL_BY_DEFINITION_HEADS: ReadonlySet<string> =
    new Set(['Real', 'Imaginary', 'Argument']);

  /**
   * Scalar arithmetic operator heads whose codegen would emit
   * element-wise-impossible scalar JS if handed a list-valued operand. Guarded
   * in `compileExpr`: such a form fails closed (D6) unless `tryCompileBroadcast`
   * already lowered it element-wise (e.g. `Negate([1,2,3])` → `_SYS.bcast`).
   */
  private static readonly SCALAR_ARITHMETIC_HEADS: ReadonlySet<string> =
    new Set(['Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Power']);

  /**
   * Heads whose target lowering is real-only but which are spelled as FUNCTION
   * codegen rather than as a plain helper name, so the real-only gate on the
   * string-mapped branch of `compileExpr` never reached them. The
   * function-codegen branch applies the same rule through this set.
   *
   * Five families, and none of them has a complex extension to reach for:
   *
   *  - ROUNDING (`Floor`, `Ceiling`, `Round`, `Truncate`, `Fract`) — there is
   *    no rounding of a complex number. They are function codegen for an
   *    integer-operand shortcut or a half-away-from-zero reconstruction.
   *  - ORDER SELECTION (`Max`, `Min`, `Clamp`) — the complex numbers carry no
   *    total order, which is the same reason `Less`/`Greater` fail closed on a
   *    complex operand.
   *  - INTEGER DIVISION (`Mod`, `Remainder`, `GCD`, `LCM`).
   *  - STATISTICS (`Mean`, `Median`, the variance/deviation pair and their
   *    population forms, `Mode`, `Kurtosis`, `Skewness`, `Quartiles`,
   *    `InterquartileRange`) — the `_SYS.*` reducers behind them sum and
   *    compare plain numbers. Measured: `Mean([i, 2i])` compiled to `NaN`
   *    where the interpreter answers the complex mean.
   *  - COLOR HEADS (`Rgb`, `Hsv`, `Hsl`, `Oklab`, `Oklch`, `Colormap`,
   *    `ColorMix`, `ColorFromColorspace`) — color components and mix ratios
   *    are real by definition; the `_SYS.*` converters behind them do plain
   *    arithmetic on their channels. Measured (Tycho item 204, on 0.115.0):
   *    `Hsv(90·√(x+1), 1, 1)` under the default `auto` handed `_SYS.hsv`
   *    the promoted `{re, im}` object and returned `[NaN, NaN, NaN]` at
   *    EVERY input — including `x = 3`, where `√4 = 2` is entirely real —
   *    with no decline the consumer could detect; a `ColorMix` ratio and a
   *    `ColorFromColorspace` tuple component failed identically. With the
   *    guard, a real-at-runtime promoted value unwraps and yields the true
   *    color; a genuinely complex one yields an equally-sized NaN-filled
   *    array (`realOnlyResultKind` — never a bare scalar, which would flip
   *    the result shape at runtime under a caller's destructuring).
   *    `ColorFromColorspace` carries its scalars inside a literal
   *    components tuple, so the gate scans and binds the tuple's ELEMENTS
   *    (`realOnlyGuardOperands`); a non-literal components operand keeps
   *    the compile-time fail-closed decline. The `As*` converters take
   *    already-constructed colors and need no gate of their own.
   *
   * Measured on the DEFAULT path with `x` bound to `0`, so the operand
   * `x + (1+i)` is complex but not a foldable literal. Every one of these
   * compiled to `success: true` over code that ran to NaN:
   *
   * | shape                | compiled | interpreter          |
   * | -------------------- | -------- | -------------------- |
   * | `Floor(x + (1+i))`   | NaN      | `1 + i` (inert)      |
   * | `Max(x + (1+i))`     | NaN      | `max(1 + i)` (inert) |
   * | `Mod(x + (1+i), 2)`  | NaN      | `1`                  |
   *
   * `Sign`, `Erf`, `Gamma` and `Zeta` were already failing closed through the
   * string gate, which is what shows this to be an omission rather than a
   * policy.
   *
   * `Ceil` and `Ceiling` are DISTINCT heads and both belong here: `Ceil` is the
   * one the library canonicalizes to and the JavaScript target lowers with
   * function codegen (`Math.ceil`), so it needs this gate; `Ceiling` reaches
   * its target lowering as a plain helper name and already fails closed on the
   * string branch, and is listed so that a target which ever gives it function
   * codegen inherits the rule. Likewise `ElementMax`/`ElementMin` are separate
   * heads from `Max`/`Min` — they lower straight to `Math.max`/`Math.min` — and
   * a set holding only the aggregate spelling left them emitting
   * `Math.max({re, im})`.
   */
  private static readonly REAL_ONLY_CODEGEN_HEADS: ReadonlySet<string> =
    new Set([
      'Floor',
      'Ceil',
      'Ceiling',
      'Round',
      'Truncate',
      'Fract',
      'Max',
      'Min',
      'ElementMax',
      'ElementMin',
      'Clamp',
      'Mod',
      'Remainder',
      'GCD',
      'LCM',
      'Mean',
      'Median',
      'Variance',
      'PopulationVariance',
      'StandardDeviation',
      'PopulationStandardDeviation',
      'Mode',
      'Kurtosis',
      'Skewness',
      'Quartiles',
      'InterquartileRange',
      'Rgb',
      'Hsv',
      'Hsl',
      'Oklab',
      'Oklch',
      'Colormap',
      'ColorMix',
      'ColorFromColorspace',
    ]);

  /**
   * The operands the real-only gate scans and binds for head `h`: the args
   * themselves, except `ColorFromColorspace`, whose maybe-complex scalars
   * live INSIDE its literal components tuple/list — the elements are
   * returned so `realOperandGuard` binds each one (its `_codeOverrides`
   * substitution reaches them when the components literal re-compiles
   * inside the guarded body). A non-literal components operand keeps the
   * default, and with it the compile-time fail-closed decline.
   */
  private static realOnlyGuardOperands(
    h: string,
    args: ReadonlyArray<Expression>
  ): ReadonlyArray<Expression> {
    if (h !== 'ColorFromColorspace' || args.length === 0) return args;
    const comps = args[0];
    if (!isFunction(comps, 'Tuple') && !isFunction(comps, 'List')) return args;
    return [...comps.ops, ...args.slice(1)];
  }

  /**
   * The failing-branch shape for a guarded real-only head (the `realGuard`
   * kind): the color heads return `[L, C, H]` or `[L, C, H, alpha]`, so
   * their guard emits an equally-sized NaN-filled array — a caller
   * destructuring the color must never see the result shape flip at
   * runtime on data. Everything else in `REAL_ONLY_CODEGEN_HEADS` returns
   * a scalar. `Colormap`'s guarded form is the two-argument sample (the
   * one-argument palette form has no numeric operand to promote) and
   * `ColorMix` mixes to one color; both answer a 3-channel array — alpha,
   * when present, is lost on the FAILING branch only.
   */
  private static realOnlyResultKind(
    h: string,
    args: ReadonlyArray<Expression>
  ): 'number' | { array: number } {
    switch (h) {
      case 'Rgb':
      case 'Hsv':
      case 'Hsl':
      case 'Oklab':
      case 'Oklch':
        return { array: args.length >= 4 ? 4 : 3 };
      case 'ColorFromColorspace': {
        const comps = args[0];
        const n = isFunction(comps) ? (comps.ops?.length ?? 3) : 3;
        return { array: n >= 4 ? 4 : 3 };
      }
      case 'Colormap':
      case 'ColorMix':
        return { array: 3 };
      default:
        return 'number';
    }
  }

  /**
   * Heads that only PROPAGATE complexness from their operands: the value they
   * produce is complex exactly when one of their operands is. Read by
   * `isComplexValued` to answer from the OPERANDS rather than from a node type
   * that reads non-real — which is what keeps the `Sqrt`/`Ln`/`Log` carve-out
   * alive through the arithmetic wrapped around those heads (Tycho item 144).
   *
   * Deliberately excludes `Power`/`Root` (and the inverse trigs): those emit a
   * complex lowering off the node's TYPE (`resultIsComplexValued`), so their
   * value shape does not follow their operands and answering from the operands
   * here would put parent and child on different conventions.
   */
  private static readonly COMPLEX_PROPAGATING_HEADS: ReadonlySet<string> =
    new Set(['Add', 'Subtract', 'Multiply', 'Divide', 'Negate']);

  /**
   * The ORDERING relational heads — the ones whose lowering needs a total
   * order on its operands. `Equal`/`NotEqual` are deliberately absent: they
   * are defined on the complex numbers and have their own complex-aware
   * codegen.
   */
  private static readonly ORDERING_HEADS: ReadonlySet<string> = new Set([
    'Less',
    'LessEqual',
    'Greater',
    'GreaterEqual',
  ]);

  /**
   * Logical operator heads that are `broadcastable` but return booleans. Like
   * relational operators, they are excluded from numeric element-wise
   * broadcasting on the compile target (a boolean-list has no coverage).
   */
  private static readonly LOGICAL_BROADCAST_HEADS: ReadonlySet<string> =
    new Set([
      'And',
      'Or',
      'Not',
      'Xor',
      'Nand',
      'Nor',
      'Implies',
      'Equivalent',
    ]);

  /**
   * Element-wise broadcast of a `broadcastable` head (arithmetic + element-wise
   * math functions such as `Sin`/`Sqrt`) over one or more list-valued operands,
   * for the JavaScript target. Emits a call to the `_SYS.bcast` runtime helper
   * wrapping a scalar closure built from the head's OWN scalar codegen, so
   * complex handling and constant folding stay identical to the scalar path.
   * `_SYS.bcast` performs the shape logic at run time (shortest-length zip,
   * scalar broadcast, nested lists), matching the interpreter's
   * `broadcastOverIndexedCollections`.
   *
   * Returns `null` — deferring to the scalar / fail-closed path — when the head
   * is not broadcastable, no operand is list-valued, or the head has no
   * function codegen. Complex operands DO broadcast: each element parameter is
   * declared complex or real in a local frame, so the head's own scalar codegen
   * emits the matching lowering. Only an operand whose elements DISAGREE about
   * being complex declines, because one closure is emitted for all of them.
   */
  private static tryCompileBroadcast(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): string | null {
    const def = engine.lookupDefinition(h);
    if (!isOperatorDef(def) || def.operator.broadcastable !== true) return null;

    // A definition may EXEMPT operand shapes from generic broadcasting
    // (`broadcastExemptions`): the interpreter then gives those shapes
    // dedicated semantics instead of mapping element-wise. This method
    // reproduces the exemption semantics of a fixed set of built-in heads —
    // the `Equal`/`NotEqual` decline and the `Multiply` tensor/tuple analysis
    // below, plus the heads (`Add`, `Negate`, `Subtract`, `Divide`) whose
    // exempted shapes are value-equivalent under an element-wise lowering
    // (tensor addition and tuple arithmetic ARE element-wise). Any OTHER
    // definition that declares exemptions — a user-defined operator, or a
    // redefined head this method does not analyze — must fail closed to the
    // interpreted path: emitting a generic `_SYS.bcast` for it would produce
    // an element-wise value where the interpreter, honoring the declaration,
    // does not broadcast. (`String` is deliberately absent from the set: its
    // single-collection call JOINS the collection's elements, which no
    // element-wise lowering reproduces.) Extend the set only together with a
    // matching carve-out or a value-equivalence argument like `Multiply`'s.
    if (
      def.operator.broadcastExemptions.length > 0 &&
      ![
        'Add',
        'Multiply',
        'Negate',
        'Subtract',
        'Divide',
        'Equal',
        'NotEqual',
      ].includes(h)
    )
      return null;

    // The ordering relations and the logical connectives broadcast too (they
    // return booleans rather than numbers, which is immaterial to the closure
    // below — `_SYS.bcast` maps whatever the scalar codegen returns). Two
    // relational shapes are NOT element-wise and stay excluded:
    //
    //  - `Equal`/`NotEqual` over two collections is WHOLE-COLLECTION equality
    //    in the interpreter (`Equal([1,2,3],[1,9,3])` is the scalar `False`,
    //    not `[True,False,True]`). They lower to the interpreter-faithful
    //    `_SYS.eq`/`_SYS.neq` dispatch, which already handles the list-vs-
    //    scalar element-wise case; broadcasting here would replace that scalar
    //    with a list.
    //  - a CHAINED ordering (`a < b < c`) needs ONE closure over all three
    //    operands (`(a<b) && (b<c)`), not this method's per-head closure —
    //    `compileJSCollectionBoolean` emits it.
    //
    // Heads with no JavaScript codegen (`Xor`, `Nand`, `Implies`, …) decline
    // below at the `target.functions` lookup, so they are unaffected.
    if (h === 'Equal' || h === 'NotEqual') return null;
    if (isRelationalOperator(h) && args.length > 2) return null;

    // For the boolean heads only, this fast path requires every collection-ish
    // operand to PROVABLY compile to a JS array. This is a ROUTING choice, not
    // a soundness gate: an operand whose array-ness is unprovable — a user
    // function application `q(L)`, a `broadcastable<T>` node — falls through to
    // `compileJSCollectionBoolean`, which dispatches on the RUNTIME shape
    // through `_SYS.bcast` (relaxed 2026-07-27, Tycho item 86). Both lowerings
    // agree; this one emits the tighter code and keeps the tuple / whole-
    // collection carve-outs above in one place.
    //
    // (Historical note: this used to be a fail-closed gate, because a compiled
    // `q(L)` applied SCALAR callee code to an array and returned NaN, which a
    // comparison then turned into a plausible `false`. The application site now
    // dispatches through `_SYS.bcastFn`, so `q(L)` is an array at run time.)
    //
    // Array-ness is provable for a concrete collection, a list-typed SYMBOL
    // (a parameter, which the caller supplies as a JS array), and an
    // application of a BUILT-IN `broadcastable` head over such an operand —
    // that one re-enters this method and broadcasts through `_SYS.bcast`
    // itself, which is what makes the Desmos mask `|L-2| > 0` sound.
    if (
      isRelationalOperator(h) ||
      BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h)
    ) {
      const compilesToArray = (a: Expression): boolean => {
        // A TUPLE is an atomic point/vector, never a broadcast source — the
        // interpreter excludes it (`isBroadcastParticipant`,
        // `skipBroadcastForVectorOps`) and leaves `Less(Tuple(1,2), 3)` inert.
        // It lowers to a JS array all the same, so admitting it here compiled
        // that inert comparison into `[true, true]`.
        //
        // This test MUST stay ahead of the two below, and `isTuple` must stay
        // TYPE-based: `tuple<real,real>` matches `indexed_collection`, so a
        // tuple-TYPED symbol (`p: tuple<real,real>`) would otherwise be admitted
        // by the symbol branch, and a concrete tuple by the `isCollection`
        // branch. Reordering these reintroduces the bug.
        if (isTuple(a)) return false;
        // A STRING is an indexed collection of its grapheme clusters in the
        // type lattice, but it does NOT lower to a JS array and is atomic
        // under broadcast — it must reach the scalar path, exactly as before
        // strings became collections. Same placement rule as `isTuple` above:
        // ahead of the `isCollection` and symbol branches, both of which a
        // string now matches.
        if (isProvablyStringOperand(a)) return false;
        if (a.isCollection) return true;
        if (isSymbol(a))
          return (
            a.type.matches('list<any>') ||
            a.type.matches('indexed_collection<any>')
          );
        if (isFunction(a)) {
          const d = engine.lookupDefinition(a.operator);
          // A USER function's body is compiled as scalar code; only a built-in
          // broadcastable head lowers through the element-wise path.
          if (!isOperatorDef(d) || d.operator.broadcastable !== true)
            return false;
          return (a.ops ?? []).some(compilesToArray);
        }
        return false;
      };
      // Nothing provably array: ordinary scalar code, or an operand whose
      // array-ness is unprovable — either way, leave it to the scalar /
      // runtime-dispatch path.
      if (!args.some(compilesToArray)) return null;
      // A collection-ish operand alongside a provable array (`q(L) < M`) would
      // be broadcast against as if it were a scalar here. Defer to
      // `compileJSCollectionBoolean`, whose `_SYS.bcast` call passes BOTH
      // operands and so zips them at run time.
      if (
        args.some(
          (a) =>
            !compilesToArray(a) &&
            !isProvablyStringOperand(a) &&
            (a.type.matches('collection<any>') ||
              isBoundPossiblyCollectionTyped(a))
        )
      )
        return null;

      // Past this point a `_SYS.bcast` WILL be emitted for this head, so the
      // gates on the JavaScript ordering codegen apply here too — over
      // PARTICIPANTS rather than operands, because the scalar closure below
      // sees elements, not arrays.
      //
      // First, an AGGREGATE participant: a keyed collection has no positional
      // JS-array lowering, so the scalar closure would be handed whole objects.
      // (These shapes were declining through the string test below, which used
      // to read a dictionary's synthesized `tuple<string, V>` entry as string
      // evidence — see `unfaithfulComparisonAggregate`. A NESTED tuple is
      // untouched: a point list keeps broadcasting exactly as before.)
      if (BaseCompiler.ORDERING_HEADS.has(h)) {
        for (const a of args) {
          const aggregate = unfaithfulComparisonAggregate(a);
          if (aggregate !== null)
            throw new Error(
              `${h}: cannot compile — an element-wise ordering over a ` +
                `${aggregate} participant. It has no positional JavaScript ` +
                `lowering the broadcast closure could compare, so the result ` +
                `would silently disagree with interpretation. ` +
                `Fail closed (D6) — the interpreter evaluates it.`
            );
        }
      }

      // …then the string rule of `assertNoMixedStringOrdering`
      // (javascript-target.ts). The operand-level
      // test never saw this shape: `Less("a", [1, 2])` compiled to
      // `[false, false]` while the interpreter leaves BOTH comparisons INERT
      // (`["a" < 1, "a" < 2]`) — and inert is not `false`.
      //
      // ALL-string still compiles, verified against interpretation:
      // `Less("a", ["x","y"])` → `[true, true]` and
      // `Less(["a","b"], ["a","c"])` → `[false, true]` both agree, because the
      // emitted `<` is the same raw JavaScript `<` the interpreter uses on
      // strings (`compare.ts`). Pinned in `compile-string-fail-closed.test.ts`.
      // Only those FLAT all-string shapes are admitted — a nested one
      // (`list<list<string>>`) has no verified parity, so the `every` side is
      // the narrower `isFlatAllStringComparisonParticipant`.
      //
      // `Equal`/`NotEqual` cannot reach this point — they return `null` above
      // and are gated by `assertNoStringOperand` on their own codegen — so only
      // the ORDERINGS are tested in both gates here.
      if (
        BaseCompiler.ORDERING_HEADS.has(h) &&
        args.some(isProvablyStringComparisonParticipant) &&
        !args.every(isFlatAllStringComparisonParticipant)
      )
        throw new Error(
          `${h}: cannot compile — an element-wise ordering that mixes string ` +
            `evidence with a participant that is not provably a string. The ` +
            `interpreter leaves such a comparison symbolic (\`Less("a", [1, 2])\` ` +
            `broadcasts to two INERT comparisons), whereas the emitted ` +
            `JavaScript \`<\` coerces and answers a plausible-looking ` +
            `\`false\` for each element. An ordering whose participants are ALL ` +
            `provably strings does compile — the interpreter compares strings ` +
            `with the same \`<\`. Fail closed (D6) — the interpreter ` +
            `evaluates it.`
        );
    }

    // A user `operators` override that lowers the head to a *function call*
    // (an identifier like `add(...)`, not a symbolic infix `+`) takes
    // responsibility for list operands (Issue #240) — don't intercept it.
    const opMap = target.operators?.(h);
    if (opMap !== undefined && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]))
      return null;

    // A genuinely complex *element* type (`list<complex>`) — a `list<number>`
    // is treated as real, mirroring the scalar `isComplexValued` convention
    // (`number` matches neither `complex` nor `real`). Hoisted here so the
    // `Multiply` ≥2-possibly-collection branch below can reuse it: the real-only
    // `_SYS.mul` runtime helper cannot carry complex elements, so a complex
    // operand there must defer to the fail-closed path.
    const hasComplexElement = (a: Expression): boolean => {
      // The ELEMENTS the emitter will actually lower, when they can be seen.
      // The type test below cannot stand alone: a list mixing a complex and a
      // real element unifies to a WIDE element type (`[i·t, 1]` is
      // `vector<finite_number^2>`, which is neither complex nor real), so it
      // answered `false` and the real-only element closure below was emitted
      // over an array whose first element is a `{re, im}` object. Measured on
      // the DEFAULT path with `h(t) := [i·t, 1]`: `2·h(t)` ran to `[NaN, 2]`
      // where the interpreter answers `[0.6i, 2]`.
      if (BaseCompiler.hasAnyComplexElement(a)) return true;
      const elt = collectionElementType(compilationType(a));
      if (elt === undefined) return false;
      return isNonRealNumber(elt);
    };

    // A `broadcastable<T>`-typed operand is scalar OR an indexed collection at
    // run time (the static type of arithmetic over an unknown-return call, e.g.
    // `2·h(x)` with `h: (number) -> unknown`). Routing it through `_SYS.bcast`
    // is correct for BOTH runtime outcomes: `bcast` applies the scalar closure
    // directly when no argument is an array and recurses element-wise otherwise.
    // The array-operand admission below uses `isBoundPossiblyCollectionTyped`,
    // which matches both the `broadcastable` kind AND a bound top-typed
    // application (an `unknown`/`any`/`value` call whose collection-ness is
    // unknowable); the `Multiply` ≥2-arrayish matrix-divergence carve-out uses
    // the same predicate, so any operand whose shape is unprovable — a declared
    // `broadcastable<…>` OR a top-typed application that could be a matrix at
    // run time — makes the carve-out fail closed.

    // Mirror the interpreter's `skipBroadcastForVectorOps` carve-outs
    // (`boxed-function.ts`) for the compile target, but only where element-wise
    // broadcast would produce a *different value* than the interpreter's
    // dedicated tensor/tuple handling (`mulTensors`).
    //
    // After Issue #29, `mulTensors` computes the **element-wise** (Hadamard)
    // product for two rank-1 vectors — exactly what `_SYS.bcast` produces — so
    // pure vector·vector `Multiply` may broadcast-compile. Two cases involving
    // ≥2 tensor/tuple operands still diverge from a plain broadcast and must
    // fail closed to the interpreter:
    //
    //  - a **numeric tuple** operand: `tuple·tuple` is an interpreter error (no
    //    implicit dot/cross), so keep it failing closed rather than silently
    //    Hadamard-ing it;
    //  - a **rank-≥2 tensor** (matrix): `matrix·matrix`, `matrix·vector`,
    //    `vector·matrix` **contract** via the matrix product, which `_SYS.bcast`
    //    would not reproduce.
    //
    // Two rank-1 vectors of statically-known, differing lengths are also
    // declined: the interpreter stays inert (typically NaN in a real target)
    // whereas `_SYS.bcast` zips to the shorter length — a value divergence we
    // avoid where the mismatch is provable at compile time.
    //
    // Operands are counted by TYPE as well as by materialized value: a
    // `vector<n>`/`list`-typed *symbol* is not a tensor but lowers to a JS
    // array at run time, so it participates in the ≥2-operand test and a
    // `matrix`-typed symbol fails closed like a literal matrix (compiling it
    // through `_SYS.bcast` would Hadamard where the interpreter contracts).
    // Equal- or unknown-length typed vectors still compile: for symbol
    // operands the interpreter broadcasts element-wise too.
    //
    // Single-operand cases (scalar·vector, scalar·tuple) are untouched: they
    // broadcast element-wise in both the interpreter and `_SYS.bcast` (see
    // `compile-fallback.test.ts`).
    // The one operand a nested emission keeps WHOLE while the others broadcast
    // — a numeric tuple multiplied by a list (set in the `Multiply` carve-out
    // below, consumed at the emission at the end of this method).
    let atomicTuple: Expression | undefined;
    if (h === 'Multiply') {
      const isArrayish = (a: Expression): boolean =>
        // A string matches `indexed_collection` but is not array-shaped — see
        // `compilesToArray` above.
        !isProvablyStringOperand(a) &&
        (isTensorValue(a) ||
          isNumericTuple(a) ||
          a.type.matches('list<any>') ||
          a.type.matches('indexed_collection<any>') ||
          isBoundPossiblyCollectionTyped(a));
      const collection = args.filter(isArrayish);
      if (collection.length >= 2) {
        const isMatrix = (a: Expression): boolean =>
          (isTensorValue(a) && a.shape.length >= 2) || a.type.matches('matrix');
        if (args.some(isMatrix)) return null;
        // ONE numeric tuple among list operands is the point-family shape
        // `[1,2,3]·(cos a, sin a)`: the interpreter broadcasts over the LIST
        // and scales the point whole at every element, answering a list of
        // points. A flat `_SYS.bcast` over both arrays would zip the point
        // against the list instead, and the `_SYS.mul` runtime below would
        // Hadamard it. The point is kept ATOMIC — see the nested emission at
        // the end of this method (`atomicTuple`) — provided every other
        // array operand is a source of SCALARS: the outer broadcast descends
        // into whatever arrays it is handed, so a list of points
        // (`[(1,2),(3,4)]·(1,0)`, a `tuple·tuple` error per element in the
        // interpreter) or a source whose element kind is unprovable must
        // decline. A `broadcastable<number>` source is admitted: at run time
        // it is a scalar (the outer broadcast applies the closure once — a
        // point) or a list of numbers (a list of points), both what the
        // interpreter answers. Two or more tuples stay declined: `tuple·tuple`
        // is an interpreter error (no implicit dot/cross).
        const tuples = collection.filter((a) => isNumericTuple(a));
        if (tuples.length > 1) return null;
        if (tuples.length === 1) {
          const isScalarElementSource = (a: Expression): boolean => {
            const t = compilationType(a);
            if (typeof t !== 'string' && t.kind === 'broadcastable')
              return isSubtype(t.elements, 'number');
            // A top-typed application (`h(x)` with `h: (…) -> unknown`): its
            // run-time shape is unknowable.
            if (isBoundPossiblyCollectionTyped(a)) return false;
            const elt = collectionElementType(t);
            if (elt === undefined || !isSubtype(elt, 'number')) return false;
            // A SYMBOL declared `indexed_collection<number>` may itself be
            // bound to a point (a tuple inhabits that type); only a list-kind
            // declaration proves a symbol holds a list of scalars.
            if (isSymbol(a))
              return (
                t === 'list' ||
                t === 'range' ||
                (typeof t !== 'string' && t.kind === 'list')
              );
            return true;
          };
          if (
            !collection.every(
              (a) => a === tuples[0] || isScalarElementSource(a)
            )
          )
            return null;
          atomicTuple = tuples[0];
        }
        // A possibly-collection operand (a declared `broadcastable<T>` OR a
        // top-typed application such as `h(x)`) could materialize as a scalar,
        // a vector, OR a MATRIX at run time — the shape is unprovable at compile
        // time. `_SYS.bcast` would Hadamard unconditionally, diverging from the
        // interpreter's matrix contraction; instead emit the interpreter-faithful
        // `_SYS.mul`, which dispatches on runtime rank (Hadamard for equal-length
        // rank-1 vectors, matrix product for rank-≥2), so no shape silently
        // diverges. Complex operands can't route through the real-only helper —
        // defer those to the fail-closed path. (With a point among the
        // operands this path is never taken: the point plan above either
        // admitted the shape or declined it.)
        if (
          atomicTuple === undefined &&
          collection.some(isBoundPossiblyCollectionTyped)
        ) {
          if (
            args.some(
              (a) => BaseCompiler.isComplexValued(a) || hasComplexElement(a)
            )
          )
            return null;
          const compiledArgs = args
            .map((a) => BaseCompiler.compile(a, target))
            .join(', ');
          return `_SYS.mul(${compiledArgs})`;
        }
        // Statically-known mismatched rank-1 lengths: fail closed.
        const lengths = collection
          .filter((a) => isTensorValue(a) && a.shape.length === 1)
          .map((a) => a.shape[0]);
        if (lengths.length >= 2 && new Set(lengths).size > 1) return null;
      }
    }

    // A head with NO codegen at all has nothing to broadcast — decline (the
    // caller's fail-closed guard covers it). A *string*-mapped head (a scalar
    // helper such as `Sign` → `Math.sign`, `Arctan2` → `Math.atan2`, `Hypot` →
    // `Math.hypot`, `Sinc` → `_SYS.sinc`) has no array codegen of its own, but
    // it does have a scalar call form — the closure below wraps that call the
    // same way it wraps function codegen, so those heads broadcast too instead
    // of failing closed.
    const fn = target.functions?.(h);
    if (fn === undefined) return null;

    // An operand lowers to a JS array at run time when it is a concrete
    // collection, is statically list/collection-typed (a symbolic list
    // parameter), or is possibly-collection-typed — a `broadcastable<T>` node
    // OR a top-typed application (`unknown`/`any`/`value` call such as `h(x)`),
    // both scalar OR array at run time, which `_SYS.bcast` handles either way.
    // If none is, this is ordinary scalar code — leave it be.
    const isArrayOperand = (a: Expression): boolean =>
      // A string matches `indexed_collection` but is not array-shaped — see
      // `compilesToArray` above.
      !isProvablyStringOperand(a) &&
      (a.isCollection ||
        a.type.matches('list<any>') ||
        a.type.matches('indexed_collection<any>') ||
        isBoundPossiblyCollectionTyped(a));
    if (!args.some(isArrayOperand)) return null;

    // A numeric tuple SUMMED with, or DIVIDED by/into, a list is not a
    // broadcast in the interpreter: `(1,2) + [3,4]` is a per-element
    // `incompatible-type` error (a point does not add to a scalar) and
    // `(1,2) / [1,2]` stays inert. A flat `_SYS.bcast` would zip the two
    // arrays into the plausible `[4, 6]` / `[1, 1]` behind `success: true`.
    // Decline, so the D6 guard fails closed and the interpreter answers.
    // (`Multiply` is the broadcast case, handled above; `Power` over a tuple
    // and a list is element-wise in the interpreter too and keeps compiling.)
    // A possibly-collection operand (`broadcastable<T>`, a top-typed call)
    // counts as a list here even though it may be a scalar at run time — the
    // shape is unprovable, and declining an unprovable shape is the D6 rule.
    if (
      (h === 'Add' || h === 'Divide') &&
      args.some((a) => isNumericTuple(a)) &&
      args.some((a) => !isNumericTuple(a) && isArrayOperand(a))
    )
      return null;

    // What the closure's element parameter for each operand holds at run time:
    // `true` for a `{re, im}` object, `false` for a plain number. A SCALAR
    // operand is passed whole, so its own complex-ness is the answer; an ARRAY
    // operand contributes one element per position, so the answer is the
    // complex-ness its elements SHARE. `undefined` means no single answer
    // exists for that operand and the closure cannot be built.
    const elementComplexnessOfOperand = (
      a: Expression
    ): boolean | undefined => {
      // A scalar operand IS what the parameter holds, so its own verdict is
      // the answer. For an ARRAY operand it is not: `isComplexValued` reports
      // for the whole collection, and a list is emitted element by element, so
      // that verdict describes no single element — `[1+i, 2]` types
      // `vector<finite_complex^2>` and reads complex while its second element
      // is the plain number `2`. Only the element analysis may answer here.
      if (!isArrayOperand(a)) return BaseCompiler.isComplexValued(a);
      // Elements that DISAGREE (`[√(t−1), 1]`) have no single closure: one
      // position holds `{re, im}` and another a plain number, and the body
      // below is emitted once for all of them. Declining hands the form to the
      // fail-closed path, which is what it did for every complex element
      // before this. Measured with a real closure over such an array,
      // `2·[1+i, 2]` ran to `[{re: 2, im: 2}, {re: NaN, im: NaN}]` where the
      // interpreter answers `[2+2i, 4]`.
      // One walk, both verdicts: `uniformElementComplexness` and
      // `hasMixedElementComplexness` would each re-derive this same array.
      const elements = BaseCompiler.elementComplexness(a);
      if (elements !== undefined && elements.length > 0)
        return elements.every((e) => e === elements[0])
          ? elements[0]
          : undefined;
      // The elements are not visible. Any remaining evidence of complexness —
      // a `list<complex>` ELEMENT TYPE (`hasComplexElement`, hoisted above) or
      // the whole-collection verdict — cannot be attributed to an individual
      // element, so decline exactly as before this method carried complex at
      // all.
      return hasComplexElement(a) || BaseCompiler.isComplexValued(a)
        ? undefined
        : false;
    };
    const argIsComplex = args.map(elementComplexnessOfOperand);
    if (argIsComplex.some((c) => c === undefined)) return null;
    const anyComplex = argIsComplex.some((c) => c === true);

    // A STRING-mapped head is a real-only scalar helper (`Math.sign`,
    // `Math.hypot`, `_SYS.sinc`): it has no complex call form, so a complex
    // element has nowhere to go. Fail closed rather than hand a `{re, im}`
    // object to a real helper.
    if (typeof fn !== 'function' && anyComplex) return null;

    // …and the same rule for a head whose codegen is real-only despite being a
    // FUNCTION (`REAL_ONLY_CODEGEN_HEADS`). `compileExpr` gates those on its
    // scalar branch, which this method returns BEFORE reaching, so a broadcast
    // would slip past it: the closure below is built from the head's own scalar
    // codegen, and for these heads that codegen is `Math.floor`/`Math.max`/…
    // whatever the element parameter's declared complex-ness. Measured with
    // this decline absent: `Floor([1+i, 2+i])` emitted
    // `_SYS.bcast((_tv1) => Math.floor(_tv1), [{re, im}, {re, im}])` and ran to
    // `[NaN, NaN]` behind `success: true`, where the interpreter leaves the
    // elements inert at `[1+i, 2+i]`. Returning null hands the form to the
    // fail-closed D6 guard, which is where the scalar shape ends up too.
    if (BaseCompiler.REAL_ONLY_CODEGEN_HEADS.has(h) && anyComplex) return null;

    // Bind one element parameter per operand and build the scalar body by
    // re-invoking the head's own scalar codegen with those parameters (shadow
    // `target.var` so they compile bare, not as `_.<name>` lookups — same
    // pattern as the Sum/Product loop index).
    const params = args.map(() => BaseCompiler.tempVar(target));
    const innerTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) => (params.includes(id) ? id : target.var(id)),
      boundVars: BaseCompiler.withBoundNames(target, params),
    };
    // The element parameters are bare symbols with no type of their own, so the
    // head's scalar codegen would read every one of them as REAL and emit
    // `_tv1 * _tv2` over a pair of `{re, im}` objects. Declaring their
    // complex-ness in a local frame — the same mechanism a `Block` local uses
    // (`_localComplex`) — makes that codegen pick the complex lowering, so the
    // closure agrees with the array it will actually be mapped over. This is
    // what lets an all-complex collection broadcast at all; before it, any
    // complex operand declined here and fell through to the fail-closed guard.
    const complexFrame = new Map<string, boolean>();
    params.forEach((p, i) => complexFrame.set(p, argIsComplex[i] === true));
    BaseCompiler._pushLocalComplex(complexFrame);
    // For a promotable radical/`Power` head, the promotion verdict must be
    // decided on the NODE-LEVEL operands — the element temps the closure is
    // built from carry no sign or type evidence, so a verdict derived from
    // them promotes shapes whose operands are provably non-negative
    // (`√(x²+L²)` with a list `L`), diverging from the downstream
    // `isComplexValued` analysis that reads the real operands. Record the
    // node-level verdict for `promotesRadicalToComplex` to return when the
    // scalar codegen re-asks with exactly these temps. Pushed strictly
    // inside the `_pushLocalComplex` frame so memoized analysis answers
    // stay in that frame's memo layer.
    const radicalFrame =
      h === 'Power' || BaseCompiler.PROMOTABLE_RADICAL_HEADS.has(h)
        ? {
            head: h,
            params: new Set(params),
            promotes: BaseCompiler.promotesRadicalToComplex(h, args),
          }
        : undefined;
    if (radicalFrame !== undefined)
      BaseCompiler._broadcastRadicalVerdict.push(radicalFrame);
    let scalarBody: string;
    try {
      scalarBody =
        typeof fn === 'function'
          ? fn(
              params.map((p) => engine.expr(p)),
              (expr) => BaseCompiler.compileValueOperand(expr, innerTarget),
              innerTarget
            )
          : `${fn}(${params.join(', ')})`;
    } finally {
      if (radicalFrame !== undefined)
        BaseCompiler._broadcastRadicalVerdict.pop();
      BaseCompiler._popLocalComplex();
    }
    const compiledArgs = args.map((a) => BaseCompiler.compile(a, target));
    const body = BaseCompiler.guardConnectiveAbsence(h, params, scalarBody);
    const closure = `(${params.join(', ')}) => ${body}`;
    // A point multiplied by a list (`[1,2,3]·(cos a, sin a)`, Tycho item 214):
    // broadcast over the LIST operands first, and at each of their elements
    // broadcast the scalar closure over the point's components — so the point
    // is scaled whole per element and the result is a list of points, as the
    // interpreter's `mul()` answers. The outer closure's parameters stand in
    // for the list operands inside the inner call; the point and any scalar
    // operand are spliced in unchanged.
    //
    // Every operand is evaluated exactly ONCE, in operand order, by binding
    // it as a parameter of an immediately-applied arrow function — the
    // interpreter's `Multiply` handler evaluates each operand once before
    // broadcasting. Splicing the point's or a scalar's source text inside the
    // outer closure instead would re-run it per element: `[1,2]·(Random(), 0)`
    // must draw once and answer `[(r, 0), (2r, 0)]`, and `cos a` need not be
    // recomputed for every element. Handing those operands to the outer
    // `_SYS.bcast` as arguments is not an option either — it would zip the
    // point's array against the list, the very shape this emission avoids.
    if (atomicTuple !== undefined) {
      const bound = args.map(() => BaseCompiler.tempVar(target));
      const outerParams: string[] = [];
      const outerSources: string[] = [];
      const innerArgs = args.map((a, i) => {
        if (a === atomicTuple || !isArrayOperand(a)) return bound[i];
        const p = BaseCompiler.tempVar(target);
        outerParams.push(p);
        outerSources.push(bound[i]);
        return p;
      });
      return (
        `((${bound.join(', ')}) => ` +
        `_SYS.bcast((${outerParams.join(', ')}) => ` +
        `_SYS.bcast(${closure}, ${innerArgs.join(', ')}), ` +
        `${outerSources.join(', ')}))(${compiledArgs.join(', ')})`
      );
    }
    return `_SYS.bcast(${closure}, ${compiledArgs.join(', ')})`;
  }

  /**
   * Ask the TARGET to apply a `broadcastable` head's scalar element lowering
   * across a single finite indexed collection operand — see
   * `CompileTarget.broadcastUnary`. Returns `undefined` when the target has no
   * such hook, or its hook declines; the caller then fails closed (D6).
   *
   * `element(code)` splices already-compiled target source in as the element
   * operand: it binds a fresh placeholder name and shadows `target.var` so the
   * source emits BARE, never as a `_.<name>` vars-object lookup (the same
   * pattern as the Sum/Product loop index). A target that fans out therefore
   * gets its loop variable back verbatim; one that is natively componentwise
   * passes the whole compiled vector instead.
   */
  private static compileBroadcastUnary(
    engine: ComputeEngine,
    h: string,
    operand: Expression,
    fn: Exclude<CompiledFunction<Expression>, string>,
    target: CompileTarget<Expression>
  ): TargetSource | undefined {
    if (target.broadcastUnary === undefined) return undefined;
    const element = (code: TargetSource): TargetSource => {
      const v = BaseCompiler.tempVar(target);
      const innerTarget: CompileTarget<Expression> = {
        ...target,
        var: (id: string) => (id === v ? code : target.var(id)),
        boundVars: BaseCompiler.withBoundNames(target, [v]),
      };
      return fn(
        [engine.expr(v)],
        (expr) => BaseCompiler.compileValueOperand(expr, innerTarget),
        innerTarget
      );
    };
    const out = target.broadcastUnary(
      h,
      operand,
      { collection: () => BaseCompiler.compile(operand, target), element },
      target
    );
    return out === undefined || out === '' ? undefined : out;
  }

  /**
   * Make a broadcast connective's scalar body absence-aware.
   *
   * `_SYS.bcast` represents an empty or mismatched position as NaN, but the
   * connectives lower to raw JavaScript `!`, `&&` and `||`, which coerce it:
   * `!NaN` is `true` and `NaN || false` is `false`, so an error position came
   * back out as an ordinary — and wrong — truth value once a second connective
   * consumed it. The interpreter instead ABSORBS (`And(False, <error>)` is
   * `False`, `Or(True, <error>)` is `True`) and otherwise propagates the error.
   * This reproduces both halves: a dominant operand wins, else any absent
   * operand makes the result absent, else the head's own codegen runs.
   *
   * Only the connectives need it. An ordering already agrees — `NaN < 3` is
   * `false`, which is how the interpreter reads a NaN operand (IEEE). What it
   * cannot distinguish is a NaN that stands for an ERROR rather than a numeric
   * NaN; separating those needs a sentinel carried through nested broadcasts,
   * recorded as residue in ROADMAP.md rather than papered over here.
   *
   * Also used by the JavaScript target's own connective lowering
   * (`compileJSCollectionBoolean`), which builds the same closure by hand.
   */
  static guardConnectiveAbsence(
    h: string,
    params: ReadonlyArray<string>,
    body: string
  ): string {
    if (h !== 'And' && h !== 'Or' && h !== 'Not') return body;
    const absent = params.map((p) => `${p} !== ${p}`).join(' || ');
    if (h === 'Not') return `((${absent}) ? NaN : ${body})`;
    const dominant = h === 'And' ? 'false' : 'true';
    const wins = params.map((p) => `${p} === ${dominant}`).join(' || ');
    return `((${wins}) ? ${dominant} : ((${absent}) ? NaN : ${body}))`;
  }

  /**
   * Extract the initial-value operand of a `Declare` expression, if any.
   *
   * Handles the positional forms `Declare(sym, type, value)` and a `value`
   * key in an optional trailing attributes `Dictionary`. A positional value
   * takes precedence over the dictionary's `value`. Returns `undefined` when
   * the declaration has no value (`Declare(sym)` / `Declare(sym, type)`).
   */
  private static declareValueOperand(
    ops: ReadonlyArray<Expression>
  ): Expression | undefined {
    let rest = ops.slice(1);
    let attrsValue: Expression | undefined;
    const last = rest[rest.length - 1];
    if (last !== undefined && isDictionary(last)) {
      attrsValue = last.get('value');
      rest = rest.slice(0, -1);
    }
    // rest is now the positional operands after the symbol: [type?, value?]
    return rest[1] ?? attrsValue;
  }

  /**
   * The type SPEC of a `Declare`, as the source string the interpreter parses
   * — the positional `Declare(sym, type, …)` operand, else the attributes
   * `type` key, following the same precedence as `declareValueOperand`.
   * `undefined` when the declaration states no type at all.
   *
   * The spec reaches the handler RAW (a `{ str }` in the positional slot, a
   * type-name symbol in the attributes form), so both spellings are read.
   */
  private static declareTypeOperand(
    ops: ReadonlyArray<Expression>
  ): Expression | undefined {
    let rest = ops.slice(1);
    let attrsType: Expression | undefined;
    const last = rest[rest.length - 1];
    if (last !== undefined && isDictionary(last)) {
      attrsType = last.get('type');
      rest = rest.slice(0, -1);
    }
    return rest[0] ?? attrsType;
  }

  /** The declared-type spelling of a raw `Declare` type operand, or `undefined`
   * when it is neither a string nor a symbol. */
  private static declaredTypeSource(t: Expression): string | undefined {
    if (isString(t)) return t.string;
    if (isSymbol(t)) return t.symbol;
    return undefined;
  }

  /**
   * Lower a destructuring pattern whose value is tuple-VALUED but not a
   * literal `Tuple` — the state-threading idiom `(n, j) := parseDigits(cs, j)`
   * — into ONE temporary holding the whole tuple plus a positional read per
   * leaf. Returns `null` when the shape is not admitted; the caller then fails
   * closed (D6) and the interpreter evaluates the statement.
   *
   *     let (v, j) = step(k)
   *       ⟶  let _tv1; _tv1 = step(k); let v = _tv1[1]; let j = _tv1[2]
   *
   * The value is evaluated EXACTLY ONCE (into the temporary) and only then
   * read, which is the interpreter's order — including for a `_` position,
   * which contributes no read at all.
   *
   * Admitted only when all of:
   * - the target is JavaScript. Every other target keeps the existing D6 —
   *   the positional-read lowering has only been established there (the
   *   Python target cannot compile a user-function call at all, so the shape
   *   this exists for is unreachable on it) and a widened gate needs its own
   *   per-target verification, not an assumption.
   * - the pattern is FLAT at this level (every position a symbol or `_`). A
   *   nested position would need a temporary of its own; it stays D6.
   * - the value's static type is a tuple whose arity is statically known and
   *   equals the pattern's. An unknown arity cannot be checked against the
   *   pattern, and a mismatch is an interpreter error.
   *
   * The temporary is declared in a THROWAWAY scope carrying the value's own
   * type, so the emitted `At(_tv1, i)` reads as a tuple index: the JS `At`
   * admission gate is type-based, and a bare `unknown`-typed temporary is
   * (deliberately) not admitted by it. The scope is popped immediately — the
   * boxed symbol keeps its definition, and nothing is left in the ambient
   * scope.
   *
   * Note for whoever widens the target gate: the temporary's declaration and
   * its initializer are emitted as SEPARATE statements because a target with a
   * `declare` hook (Python, GPU) emits only the declaration from a combined
   * `Declare(sym, type, value)` and drops the initializer (see
   * `desugarPatternAssign`). The per-leaf DECLARES below are combined, which
   * is sound on JavaScript only — splitting those too is the first step of
   * widening this gate.
   */
  private static destructureViaTemp(
    pattern: Expression & FunctionInterface,
    v: Expression | undefined,
    target: CompileTarget<Expression>,
    kind: 'declaration' | 'assignment',
    enforcedLocals?: ReadonlySet<string>
  ): { binds: Expression[]; writes: Expression[] } | null {
    if (v === undefined) return null;
    if (target.language !== 'javascript') return null;
    if (pattern.nops === 0) return null;
    if (!pattern.ops.every((p) => isSymbol(p))) return null;
    const t = compilationType(v);
    if (typeof t === 'string' || t.kind !== 'tuple') return null;
    if (t.elements.length !== pattern.nops) return null;

    // Every target is checked BEFORE anything is emitted — and before a
    // temporary is minted — so a rejection on a later leaf leaves nothing
    // behind: the same all-or-nothing discipline the interpreter's pre-pass
    // has.
    if (kind === 'assignment')
      for (const p of pattern.ops)
        BaseCompiler.assertLeafAssignable(p, enforcedLocals);

    const ce = pattern.engine;
    const temp = BaseCompiler.typedTemp(
      ce,
      BaseCompiler.tempVar(target),
      v.type.type
    );
    const binds = [
      ce._fn('Declare', [temp, ce.string('unknown')]),
      ce._fn('Assign', [temp, v]),
    ];
    const writes: Expression[] = [];
    for (let i = 0; i < pattern.nops; i++) {
      const p = pattern.ops[i];
      if (!isSymbol(p) || p.symbol === '_') continue;
      // `At` is 1-BASED.
      const read = ce._fn('At', [temp, ce.number(i + 1)]);
      writes.push(
        kind === 'declaration'
          ? ce._fn('Declare', [p, ce.string('unknown'), read])
          : ce._fn('Assign', [p, read])
      );
    }
    return { binds, writes };
  }

  /**
   * Fail closed (D6) when a destructuring-assignment TARGET carries an
   * enforcement the compiled per-leaf write cannot reproduce.
   *
   * The interpreter's destructuring `Assign` is ATOMIC: every leaf is validated
   * against its target's existing binding (`assertAssignable`) in a read-only
   * pass, and one rejection leaves the WHOLE pattern unwritten. The lowering
   * here is a sequence of plain per-leaf writes with no such validation, so a
   * pattern the interpreter refuses outright ran to completion compiled:
   * `(x, y) := (7, 4.5)` over `x, y: integer` wrote both (compiled `704.5`
   * against the interpreter's `102`, where neither target moved), and a `const`
   * target was silently overwritten where the interpreter throws.
   *
   * Reproducing the check would mean emitting a run-time type test per leaf and
   * an all-or-nothing commit — a whole tier, not a gate — so the shapes that
   * need it fail closed instead.
   *
   * An UNTYPED / inferred-type target keeps compiling byte-identically: nothing
   * is enforced there, so the sequence of writes IS the interpreter's outcome.
   * That is the state-threading idiom `(v, j) := step(j)`, which this must not
   * disturb.
   */
  /**
   * The enforced-target frames of the lexically enclosing statement lists
   * (`compileBlock`), innermost last — the only route by which a destructuring
   * assign nested in a LOOP BODY can see the enclosing block's declarations,
   * since `compileLoopBody` is handed the body's statements alone. An emitted
   * user-function body enters its own annotated PARAMETERS the same way
   * (`withEnforcedParams`), which is the only route to a declaration that
   * lives on the lambda literal rather than in an installed scope.
   *
   * Managed exactly like `_localComplex`/`_localVector`: pushed before the
   * statements are compiled, popped in the same `finally`.
   */
  private static _enforcedTargets: ReadonlySet<string>[] = [];

  private static assertLeafAssignable(
    p: Expression,
    enforcedLocals: ReadonlySet<string> | undefined
  ): void {
    if (!isSymbol(p) || p.symbol === '_') return;
    const name = p.symbol;
    // A BLOCK-LOCAL target: its `Declare` is held, so nothing is installed and
    // the lookup below finds no definition (or an unrelated ambient one). The
    // enclosing statement list is the only place its declaration is visible;
    // `compileBlock` harvests it (`enforcedLocalTargets`) and either passes it
    // in (a statement at its own level) or pushes it (a nested loop body).
    if (
      enforcedLocals?.has(name) ||
      BaseCompiler._enforcedTargets.some((f) => f.has(name))
    )
      throw new Error(
        `Cannot compile a destructuring assignment: the target '${name}' is ` +
          `declared as a constant or with a declared type (a block-local ` +
          `declaration, or an annotated parameter), and ` +
          `the compiled per-leaf write can enforce neither. The interpreter ` +
          `validates every leaf before writing any, and rejects the whole ` +
          `assignment when one does not fit. ` +
          `Fail closed (D6) — the interpreter evaluates it.`
      );
    // A target declared in an ENCLOSING, already-installed scope (a typed
    // function parameter, an `ce.declare`d symbol). The pattern leaves are
    // boxed structurally — the canonical `Assign` deliberately leaves them
    // unresolved — so the definition is read from the engine rather than off
    // the symbol, with a lookup that declares nothing.
    const def = p.engine.lookupDefinition(name);
    if (def === undefined || !isValueDef(def)) return;
    const value = def.value;
    if (value.isConstant)
      throw new Error(
        `Cannot compile a destructuring assignment: cannot assign to the ` +
          `constant '${name}'. The interpreter rejects the whole ` +
          `assignment; the compiled per-leaf writes have no such check. ` +
          `Fail closed (D6) — the interpreter evaluates it.`
      );
    if (!value.inferredType && !value.type.isUnknown)
      throw new Error(
        `Cannot compile a destructuring assignment: the compiled write cannot ` +
          `enforce the declared type of '${name}' ` +
          `('${value.type.toString()}'). The interpreter validates every leaf ` +
          `before writing any, and rejects the whole assignment when one does ` +
          `not fit. Fail closed (D6) — the interpreter evaluates it.`
      );
  }

  /**
   * The names a statement list declares with an enforcement the compiled
   * per-leaf destructuring write cannot reproduce: `const`, or a declared type
   * other than the `"unknown"` filler.
   *
   * Read straight off the `Declare` statements, because a block-local
   * declaration is HELD — nothing is installed at compile time, so
   * `assertLeafAssignable`'s definition lookup cannot see it. Mirrors the
   * interpreter's own operand reading (`Declare`'s evaluate handler): the
   * positional type is `ops[1]` once a trailing attributes dictionary is set
   * aside, and it wins over the dictionary's `type`; `constant` is a dictionary
   * key.
   */
  private static enforcedLocalTargets(
    args: ReadonlyArray<Expression>
  ): ReadonlySet<string> {
    const out = new Set<string>();
    for (const arg of args) {
      if (!isFunction(arg, 'Declare')) continue;
      const sym = arg.ops[0];
      if (!isSymbol(sym)) continue;
      const rest = arg.ops.slice(1);
      let attrType: Expression | undefined;
      let attrConstant: Expression | undefined;
      const last = rest[rest.length - 1];
      if (last !== undefined && isDictionary(last)) {
        attrType = last.get('type');
        attrConstant = last.get('constant');
        rest.pop();
      }
      const typeSource = rest[0] ?? attrType;
      // An unrecognized type spelling counts as enforced: declining is the
      // safe direction.
      if (
        typeSource !== undefined &&
        BaseCompiler.declaredTypeSource(typeSource) !== 'unknown'
      )
        out.add(sym.symbol);
      if (
        attrConstant !== undefined &&
        !(isSymbol(attrConstant) && attrConstant.symbol === 'False')
      )
        out.add(sym.symbol);
    }
    return out;
  }

  /**
   * The PARAMETERS of a function literal that carry a type annotation — the
   * third source of enforced destructuring targets, alongside the installed
   * definitions `assertLeafAssignable` looks up and the block-local `Declare`s
   * `enforcedLocalTargets` harvests.
   *
   * A parameter's declared type lives on the literal's parameter operands
   * (`Typed(x, "integer")`), in a scope that is NOT installed while the body
   * is compiled: the lookup finds no definition and the body has no `Declare`
   * for it, so `(x, y) := (7, 4.5)` over `f(x: integer, y: integer)` wrote
   * both leaves compiled where the interpreter — validating every leaf first —
   * refuses the whole assignment and leaves the parameters at their argument
   * values.
   *
   * An UNANNOTATED parameter (a bare symbol operand) is not enforced: nothing
   * constrains it, so the sequence of per-leaf writes IS the interpreter's
   * outcome, and the state-threading idiom `(v, j) := step(j)` keeps compiling.
   */
  private static enforcedParamTargets(
    literal: Expression & FunctionInterface
  ): ReadonlySet<string> {
    const out = new Set<string>();
    for (const p of literal.ops.slice(1)) {
      if (!isFunction(p, 'Typed')) continue;
      const sym = p.ops[0];
      const typeSource = p.ops[1];
      if (!isSymbol(sym) || typeSource === undefined) continue;
      // An unrecognized type spelling counts as enforced: declining is the
      // safe direction (as in `enforcedLocalTargets`).
      if (BaseCompiler.declaredTypeSource(typeSource) !== 'unknown')
        out.add(sym.symbol);
    }
    return out;
  }

  /**
   * Fail closed on a DESTRUCTURING parameter (`((p, q)) => p + q`).
   *
   * Every target lowers a lambda to `(name₁, …, nameₙ) => body`, one emitted
   * name per parameter operand, and reads a parameter operand that yields no
   * name as the throwaway `_`. A pattern parameter yields no name, so the
   * body's references to its leaves would compile as references to whatever
   * `p` and `q` mean OUTSIDE the lambda — silently wrong code, not an error
   * (measured: `Map(((p, q)) => p + q, xs)` emitted
   * `(_p) => _.p + _.q`, reading two unrelated globals).
   *
   * Refusing is the D6 fail-closed rule. Destructuring in the emitted code is
   * a real option for some targets (a JS tuple is an array), but it has to be
   * decided per target and per tuple REPRESENTATION, so no target claims it
   * today.
   */
  static assertNoDestructuringParams(params: ReadonlyArray<Expression>): void {
    for (const p of params)
      if (isDestructuringParameter(p))
        throw new Error(
          `Cannot compile a function literal with a destructuring parameter ` +
            `"${p.toString()}": no compile target lowers the tuple match. ` +
            `Take the tuple as one named parameter and read its components ` +
            `in the body.`
        );
  }

  /**
   * Run `fn` — the compilation of `literal`'s BODY as an emitted definition —
   * with that literal's annotated parameters as the enforced-target frames.
   *
   * The enclosing frames are REPLACED, not stacked on (the `isolate` case of
   * `withLocalShapeFrame`): an emitted definition is a module-level function,
   * not a block lexically nested in the requesting one, so a same-named typed
   * local at the call site must not make this body decline.
   *
   * Public for the DIRECT lambda-compile route (`compileToTarget`'s
   * `Function`-literal branch in javascript-target.ts, the `calling: 'lambda'`
   * convention), which compiles a literal's body without going through
   * `emitFunctionLiteralDefinition` and must wrap it the same way — otherwise
   * a destructuring assign onto a typed parameter miscompiles there while the
   * emitted-definition route declines.
   */
  static withEnforcedParams<T>(
    literal: Expression & FunctionInterface,
    fn: () => T
  ): T {
    const saved = BaseCompiler._enforcedTargets;
    BaseCompiler._enforcedTargets = [
      BaseCompiler.enforcedParamTargets(literal),
    ];
    try {
      return fn();
    } finally {
      BaseCompiler._enforcedTargets = saved;
    }
  }

  /**
   * The PROVABLE element type of a collection operand, or `undefined` when
   * there is no positive evidence (`unknown`/`any`/not a collection type).
   *
   * Mirrors `sourceElementType` in `library/map-broadcast-shape.ts`: only the
   * COLLECTION layer is resolved (a collection spelled as a type reference has
   * to be unfolded before its element type can be read), and the element type
   * itself is returned unresolved so a NOMINAL element keeps its identity for
   * the subtype question in {@link assertCallbackAnnotations}.
   */
  /**
   * Do the elements of `coll` fold with the RAW real operator — every
   * element provably a real number — or must a `Sum`/`Product` over it take
   * the shape-agnostic combiner (`_SYS.sadd`/`_SYS.smul`, wrapped in the
   * complex lift) because an element may be a `{re, im}`?
   *
   * The element TYPE alone is not enough under a PROMOTING discipline:
   * `Map(Ln, xs)` types `list<real>` from `Ln`'s signature while the
   * eta-expanded callback promotes each element. So under promotion only a
   * collection whose elements are real BY CONSTRUCTION — a real-typed symbol,
   * a range, a literal list of real-analyzed elements — folds raw; any
   * producer that applies a callback takes the agnostic fold. Both the
   * analysis (`isComplexValued` of the fold: complex iff NOT real here) and
   * the JavaScript emitter (`emitCollectionReduce`) read this one predicate,
   * so parent and child agree on the fold's SHAPE.
   */
  static collectionFoldsReal(coll: Expression): boolean {
    // An element the analysis calls complex (a complex cell, a callback body
    // that promotes) — never a raw fold.
    if (BaseCompiler.isComplexValued(coll)) return false;
    // Elements TYPED non-real (`list<complex>`) are complex-shaped in every
    // mode — shape follows the static type.
    const elt = BaseCompiler.collectionElementTypeOf(coll);
    if (elt !== undefined && isNonRealNumber(elt)) return false;
    // COMPLEX discipline: a wide element (`list<number>`) may hold a
    // `{re, im}` at run time; only a real-only element type folds raw.
    if (BaseCompiler.complexDiscipline)
      return elt !== undefined && isSubtype(elt, 'real');
    // Strict shapes (strict, and `auto`'s first attempt): a wide element is
    // real, as everywhere else — but under promotion the element TYPE can
    // hide a promoting callback the analysis cannot see into.
    if (!BaseCompiler.promotionActive) return true;
    return BaseCompiler.elementsRealByConstruction(coll);
  }

  /**
   * Under a promoting discipline, are the elements of `coll` real by
   * CONSTRUCTION — i.e. is the element type trustworthy? A `Map` whose
   * callback is a `Function` LITERAL is covered by the analysis (its body
   * is looked through with the parameter bound), so it counts as real when
   * `isComplexValued` said so; a `Map` over a bare callback SYMBOL (`Map(Ln,
   * xs)`: an eta the analysis cannot see into) does not. Element-preserving
   * producers defer to their source.
   */
  private static elementsRealByConstruction(coll: Expression): boolean {
    // A symbol's elements are what its TYPE says: `list<real>` is real by
    // construction, `list<complex>` (or a wide `list<number>` holding a
    // `{re, im}` cell) is not.
    if (isSymbol(coll)) {
      const elt = BaseCompiler.collectionElementTypeOf(coll);
      return elt !== undefined && isSubtype(elt, 'real');
    }
    if (!isFunction(coll)) return false;
    const h = coll.operator;
    if (h === 'Range' || h === 'Linspace') return true;
    if (h === 'List' || h === 'Tuple')
      return coll.ops.every((e) => !BaseCompiler.isComplexValued(e));
    if (h === 'Map') return isFunction(coll.ops[0], 'Function');
    if (
      h === 'Filter' ||
      h === 'Take' ||
      h === 'Drop' ||
      h === 'TakeWhile' ||
      h === 'DropWhile' ||
      h === 'Reverse' ||
      h === 'Sort' ||
      h === 'Unique' ||
      h === 'Slice'
    )
      return (
        coll.ops[0] !== undefined &&
        BaseCompiler.elementsRealByConstruction(coll.ops[0])
      );
    return false;
  }

  /**
   * Fail closed (D6) when a LOCKSTEP walk over several sources — the zip
   * form of `Map`, and `Zip` itself — would run a source's effects more often
   * than the interpreter does.
   *
   * The interpreter advances every source together and stops as soon as the
   * shortest one ends, so a longer source is never walked past that point.
   * The emitted code has no lockstep walk: it materializes every source in
   * full and only then reads the minimum length. For a pure source the two
   * are indistinguishable; for a source that draws `Random` or calls a
   * stateful function, the extra elements are extra draws and calls. A
   * single source is never refused here (`Map(f, xs)` walks all of `xs` on
   * both routes). `firstPosition` is the 1-based operand position of
   * `sources[0]` in the enclosing call, for the diagnostic.
   */
  static assertLockstepSourcesPure(
    kind: string,
    sources: ReadonlyArray<Expression | undefined>,
    firstPosition: number
  ): void {
    if (sources.length < 2) return;
    sources.forEach((source, i) => {
      if (source === undefined || source.isPure) return;
      throw new Error(
        `${kind}: operand ${i + firstPosition} has observable effects, and ` +
          `a walk over several collections stops at the shortest one, so ` +
          `the compiled code — which materializes every collection in ` +
          `full — would run those effects more often than the interpreter ` +
          `does. Fail closed (D6) — the interpreter evaluates it.`
      );
    });
  }

  /**
   * The element type each source of the zip form of `Map` feeds its
   * callback at that position, or a fail-closed (D6) throw.
   *
   * A callback over several sources is compiled with BARE parameters: the
   * zip form stamps none of them (its contextual callback slot is unary), so
   * the emitted body treats every parameter as a real scalar. That is
   * faithful only when every source provably supplies real scalars. A
   * `list<complex>` source would reach `+` as an object and a
   * `list<list<number>>` source as an array — both emit a string where the
   * interpreter answers a complex number or a broadcast sum. The unary form
   * has no such gap because its one parameter IS stamped with the source's
   * element type and the body compiles under it. So an element type that is
   * unprovable, not numeric, or provably non-real declines here. `number`
   * itself is admitted: the compiled real lane is what a `number`-typed
   * parameter gets everywhere else in this compiler. `firstPosition` is as
   * for `assertLockstepSourcesPure`.
   */
  static zipCallbackArgTypes(
    kind: string,
    sources: ReadonlyArray<Expression | undefined>,
    firstPosition: number
  ): Type[] {
    return sources.map((source, i) => {
      const elt = BaseCompiler.collectionElementTypeOf(source);
      if (
        elt !== undefined &&
        isSubtype(elt, 'number') &&
        !isNonRealNumber(elt)
      )
        return elt;
      throw new Error(
        `${kind}: operand ${i + firstPosition} ` +
          (elt === undefined
            ? `has no provable element type`
            : `has elements of type '${typeToString(elt)}'`) +
          `, and the mapping over several collections is compiled with ` +
          `untyped parameters that the emitted code treats as real numbers. ` +
          `Fail closed (D6) — the interpreter evaluates it.`
      );
    });
  }

  static collectionElementTypeOf(
    source: Expression | undefined
  ): Type | undefined {
    if (source === undefined) return undefined;
    const src = source.isCanonical ? source : source.canonical;
    const elt = collectionElementType(resolveTypeForCompilation(src.type.type));
    if (elt === undefined || elt === 'unknown' || elt === 'any')
      return undefined;
    return elt;
  }

  /**
   * Fail closed (D6) when a compiled CALLBACK carries a parameter annotation
   * whose enforcement the emitted code would silently drop.
   *
   * Under the annotation-as-contract ruling
   * (`docs/TYPE-SYSTEM.md`, ruling 2) an
   * annotated parameter must error LOUDLY on an argument that does not fit:
   * the interpreter applies the literal through `Apply`, which validates each
   * argument against its `Typed` annotation and yields an `Error` VALUE in the
   * element's place (`test/compute-engine/filter-predicate-errors.test.ts`).
   * A compiled callback is a plain arrow/lambda — the annotation is not
   * emitted at all — so `Filter(ds, (n: integer) ↦ n > 0)` over `[1.5, 2.5]`
   * ran to `[1.5, 2.5]` where the interpreter answers two `Error`s. A compiled
   * target has no Error VALUE to produce, so exact parity is out of reach; the
   * invariant is the weaker one — never a silently wrong value.
   *
   * The gate is therefore the same one `lowerLevel` uses for the fused
   * per-element bypass (`annotationSatisfiedBySource`): an annotation is
   * admitted only when the argument type the lowering will feed that position
   * PROVABLY satisfies it, so the enforcement cannot fire and the bypass is
   * unobservable. Positive evidence only — an unprovable argument type
   * (`undefined` here) declines, and so does an annotation NARROWER than the
   * argument type. Declining throws, so `compile()` reports `success: false`
   * and the interpreter — which does enforce — evaluates the expression.
   *
   * `argTypes[i]` is the provable type of the value the emitted lowering
   * passes to parameter `i` (an element type, an index type, …), or
   * `undefined` when nothing is provable there. A bare (unannotated) parameter
   * is unconstrained and always passes.
   */
  static assertCallbackAnnotations(
    kind: string,
    callback: Expression | undefined,
    argTypes: ReadonlyArray<Type | undefined>
  ): void {
    // A SYMBOL naming a user-defined function is checked on its literal: the
    // emitted definition (`emitFunctionLiteralDefinition`) drops the
    // annotation exactly as an inline arrow does, so `Filter(ds, p)` over
    // `p = (n: integer) ↦ n > 0` had the same silent divergence.
    const literal = isSymbol(callback)
      ? BaseCompiler.userFunctionLiteral(callback.engine, callback.symbol)
      : callback;
    if (literal === undefined || !isFunction(literal, 'Function')) return;
    const params = literal.ops.slice(1);
    for (let i = 0; i < params.length; i++) {
      const declared = functionLiteralParameterType(params[i]);
      if (declared === undefined) continue;
      const actual = argTypes[i];
      // The subtype question is asked on the UNRESOLVED types: nominal opacity
      // is a property of `isSubtype`, and resolving either side would erase it
      // and admit a callback whose enforcement DOES fire — silently, since the
      // compiled lowering has no enforcement at all.
      if (actual !== undefined && isSubtype(actual, declared)) continue;
      throw new Error(
        `${kind}: the callback parameter ` +
          `'${functionLiteralParameterName(params[i]) || `#${i + 1}`}' is ` +
          `annotated '${typeToString(declared)}'` +
          (actual === undefined
            ? `, and the type of the value it receives is not provable`
            : `, which the argument type '${typeToString(actual)}' does not ` +
              `provably satisfy`) +
          `. The compiled callback cannot enforce the annotation, and the ` +
          `interpreter reports a per-element error when it does not hold. ` +
          `Fail closed (D6) — the interpreter evaluates it.`
      );
    }
  }

  /**
   * A temporary SYMBOL carrying a static type, without touching the ambient
   * scope: declared in a scope pushed for the boxing and popped right after.
   * The returned expression keeps the definition it was bound to.
   */
  private static typedTemp(
    ce: ComputeEngine,
    name: string,
    type: Type
  ): Expression {
    ce.pushScope();
    try {
      ce.declare(name, type);
      return ce.symbol(name);
    } finally {
      ce.popScope();
    }
  }

  /**
   * Desugar a destructuring `Declare` statement (`let (x, y) = (…, …)`) into
   * per-leaf declares, so locals collection, complex/vector inference and
   * every target's statement emitter see only plain scalar declares. Returns
   * `null` when the statement is not a destructuring declare.
   *
   * A LITERAL tuple value lowers element-wise: each element expression is
   * bound exactly once, in pattern order, so the rewrite is observationally
   * identical to the interpreter's evaluate-once semantics. A `_` leaf keeps
   * its element as a bare statement (its evaluation still happens).
   *
   * A tuple-VALUED value that is not a literal tuple (a call such as
   * `step(k)`, a tuple-typed symbol) lowers through ONE temporary holding the
   * whole tuple, plus a positional read per leaf — see `destructureViaTemp`,
   * which owns the gating. Everything else (an untyped or unknown-arity
   * value, a shape mismatch) fails closed (D6) so the engine falls back to the
   * interpreter. (Without any of this, the pattern compiled as a single
   * `let _ = …` and every pattern name silently read as NaN.)
   */
  private static desugarPatternDeclare(
    arg: Expression,
    target: CompileTarget<Expression>
  ): ReadonlyArray<Expression> | null {
    if (!isFunction(arg, 'Declare') || !isFunction(arg.ops[0], 'Tuple'))
      return null;
    // A STATED type applies to every leaf: the interpreter validates each leaf
    // value against it in a read-only pre-pass and rejects the whole pattern
    // atomically when one does not fit. Both lowerings below rewrite each leaf
    // as `Declare(name, "unknown", value)`, dropping the type entirely — so
    // `Declare((x, y), "integer", (3, 4.5))` bound BOTH names where the
    // interpreter binds neither. Nothing to enforce it with here, so fail
    // closed. `"unknown"` is the no-annotation filler the positional-value
    // form must put in the type slot, and the Epsil surface emits nothing else
    // (a `:` annotation on a destructuring `let` is a parse diagnostic), so the
    // idiomatic path is untouched.
    const declaredType = BaseCompiler.declareTypeOperand(arg.ops);
    if (
      declaredType !== undefined &&
      BaseCompiler.declaredTypeSource(declaredType) !== 'unknown'
    )
      throw new Error(
        `Cannot compile a destructuring declaration that states a type ` +
          `('${declaredType.toString()}'): the per-leaf lowering cannot ` +
          `enforce it, and the interpreter rejects the whole pattern when a ` +
          `leaf value does not fit. ` +
          `Fail closed (D6) — the interpreter evaluates it.`
      );
    const ce = arg.engine;
    const out: Expression[] = [];
    const walk = (pattern: Expression, v: Expression | undefined): void => {
      if (!isFunction(pattern, 'Tuple'))
        throw new Error(
          `Cannot compile a destructuring declaration: the pattern is not a ` +
            `tuple. Fail closed (D6).`
        );
      if (v === undefined || !isFunction(v, 'Tuple')) {
        // A tuple-VALUED (but not literal) value: one temporary + positional
        // reads, when `destructureViaTemp` admits the shape.
        const viaTemp = BaseCompiler.destructureViaTemp(
          pattern,
          v,
          target,
          'declaration'
        );
        if (viaTemp !== null) {
          out.push(...viaTemp.binds, ...viaTemp.writes);
          return;
        }
        throw new Error(
          `Cannot compile a destructuring declaration whose value is not a ` +
            `literal tuple, nor an expression of statically-known tuple ` +
            `arity` +
            (v === undefined ? '' : ` (got '${v.type.toString()}')`) +
            `. Fail closed (D6) — the interpreter evaluates it.`
        );
      }
      if (pattern.nops !== v.nops)
        throw new Error(
          `Cannot compile a destructuring declaration: the pattern has ` +
            `${pattern.nops} positions but the value tuple has ${v.nops}. ` +
            `Fail closed (D6).`
        );
      for (let i = 0; i < pattern.nops; i++) {
        const p = pattern.ops[i];
        const el = v.ops[i];
        if (isFunction(p, 'Tuple')) {
          walk(p, el);
          continue;
        }
        if (!isSymbol(p))
          throw new Error(
            `Cannot compile a destructuring declaration: a pattern position ` +
              `is not a symbol. Fail closed (D6).`
          );
        if (p.symbol === '_') {
          out.push(el);
          continue;
        }
        out.push(ce._fn('Declare', [p, ce.string('unknown'), el]));
      }
    };
    walk(arg.ops[0], BaseCompiler.declareValueOperand(arg.ops));
    return out;
  }

  /**
   * Desugar a destructuring `Assign` statement (`(a, b) := (…, …)`) into
   * per-leaf temporaries followed by per-leaf writes, so the locals
   * collection, the inference below and every target's statement emitter see
   * only plain scalar declares and assigns. Returns `null` when the statement
   * is not a destructuring assign.
   *
   * Unlike the declaration form, the targets ALREADY EXIST, so the writes
   * cannot be interleaved with the reads: `(a, b) := (b, a)` lowered per-leaf
   * would emit `a = b; b = a` and read the `a` it just clobbered. Every
   * element is therefore bound to a temporary FIRST, and only then written to
   * its target — which is exactly the interpreter's "evaluate the whole
   * right-hand side, then write" order:
   *
   *     (a, b) := (b, a + b)
   *       ⟶  let _tv1 = b; let _tv2 = a + b; a = _tv1; b = _tv2
   *
   * A `_` position still gets a temporary (its element is evaluated for
   * effect) but no write. As with the declare form, a LITERAL tuple value
   * lowers element-wise, a tuple-VALUED one through a single whole-tuple
   * temporary (`destructureViaTemp`), and anything else — an unknown arity, a
   * shape mismatch — fails closed (D6) so the interpreter takes over.
   *
   * The rewrite is for EFFECT only: it ends on a write, whose value is one
   * leaf's, not the tuple's. Callers must therefore only apply it in statement
   * position — never where the statement's value is the enclosing block's
   * (see the caller in `compileBlock`, which leaves a trailing destructuring
   * assign to fail closed).
   */
  static desugarPatternAssign(
    arg: Expression,
    target: CompileTarget<Expression>,
    enforcedLocals?: ReadonlySet<string>
  ): ReadonlyArray<Expression> | null {
    if (!isFunction(arg, 'Assign') || !isFunction(arg.ops[0], 'Tuple'))
      return null;
    const ce = arg.engine;
    const binds: Expression[] = [];
    const writes: Expression[] = [];
    const walk = (pattern: Expression, v: Expression | undefined): void => {
      if (!isFunction(pattern, 'Tuple'))
        throw new Error(
          `Cannot compile a destructuring assignment: the pattern is not a ` +
            `tuple. Fail closed (D6).`
        );
      if (v === undefined || !isFunction(v, 'Tuple')) {
        // A tuple-VALUED (but not literal) value: one temporary + positional
        // reads, when `destructureViaTemp` admits the shape. Its binds still
        // precede EVERY write (they are collected in the same two lists), so
        // the evaluate-then-write order is preserved even in a mixed pattern.
        const viaTemp = BaseCompiler.destructureViaTemp(
          pattern,
          v,
          target,
          'assignment',
          enforcedLocals
        );
        if (viaTemp !== null) {
          binds.push(...viaTemp.binds);
          writes.push(...viaTemp.writes);
          return;
        }
        throw new Error(
          `Cannot compile a destructuring assignment whose value is not a ` +
            `literal tuple, nor an expression of statically-known tuple ` +
            `arity` +
            (v === undefined ? '' : ` (got '${v.type.toString()}')`) +
            `. Fail closed (D6) — the interpreter evaluates it.`
        );
      }
      if (pattern.nops !== v.nops)
        throw new Error(
          `Cannot compile a destructuring assignment: the pattern has ` +
            `${pattern.nops} positions but the value tuple has ${v.nops}. ` +
            `Fail closed (D6).`
        );
      for (let i = 0; i < pattern.nops; i++) {
        const p = pattern.ops[i];
        const el = v.ops[i];
        if (isFunction(p, 'Tuple')) {
          walk(p, el);
          continue;
        }
        if (!isSymbol(p))
          throw new Error(
            `Cannot compile a destructuring assignment: a pattern position ` +
              `is not a symbol. Fail closed (D6).`
          );
        // A target the compiled write cannot hold to its declaration (a
        // constant, a declared non-inferred type) fails closed. The throw
        // discards the whole desugar, so no partially-lowered pattern escapes.
        BaseCompiler.assertLeafAssignable(p, enforcedLocals);
        // Every leaf is read into a temporary before ANY target is written —
        // including a `_` leaf, whose element is still evaluated for effect.
        //
        // The declaration and its initializer are emitted as SEPARATE
        // statements, not as one value-carrying `Declare`: a target with a
        // `declare` hook (Python, GPU) emits only the declaration from a
        // `Declare` and relies on `compileBlock` to hoist the initializer out
        // as its own assignment — which the statement paths here do not do,
        // so a combined form silently dropped the initializer and left every
        // temporary unbound (`a = _tv1` with no `_tv1 = …`).
        const temp = ce.symbol(BaseCompiler.tempVar(target));
        binds.push(ce._fn('Declare', [temp, ce.string('unknown')]));
        binds.push(ce._fn('Assign', [temp, el]));
        if (p.symbol !== '_') writes.push(ce._fn('Assign', [p, temp]));
      }
    };
    walk(arg.ops[0], arg.ops[1]);
    return [...binds, ...writes];
  }

  /**
   * Compile an expression as a statement list evaluated **for effect** — a
   * loop body — rather than for its value.
   *
   * The difference from `compile()` is what happens to the LAST statement:
   * compiled for a value it is wrapped/returned (`return <stmt>`, or the
   * target's `block` hook), which inside a loop returns from the enclosing
   * function on the first iteration. Compiled for effect it is just another
   * statement. It is also the position where a destructuring assign lowers,
   * since no statement's value is anyone's.
   *
   * Used by targets whose loop bodies route through `compileExpr` (the shader
   * targets). The JavaScript and Python targets have their own statement
   * dispatchers (`compileLoopBody`, `compilePythonStatements`).
   */
  static compileStatementList(
    expr: Expression,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (isFunction(expr, 'Block'))
      return BaseCompiler.compileBlock(expr.ops, target, expr, false);
    const stmts = BaseCompiler.desugarPatternAssign(expr, target);
    if (stmts === null) return BaseCompiler.compile(expr, target);
    const stmtTarget = BaseCompiler.loopBodyTempTarget(stmts, target);
    return stmts
      .map((s) => BaseCompiler.compile(s, stmtTarget))
      .join(`;${target.ws('\n')}`);
  }

  /**
   * Rewrite each `function` definition in a statement list — `DefineFunction(
   * name, ["Function", body, …params])` — into the equivalent value
   * declaration `Declare(name, "unknown", literal)`.
   *
   * A `function` definition inside a block is block-scoped (it does not leak
   * to the enclosing scope), so it binds exactly what `const name = (…) => …`
   * binds; rewriting to that shape routes it through the machinery the bound
   * literal already has — the `let name = ((…) => …)` emission, the bare-name
   * reads, and the call-site resolution of `CompileTarget.localFunctions`,
   * which gives the definition true recursion (the arrow reads its own binding
   * at call time, after initialization). Before this, `DefineFunction` reached
   * `compileExpr` with no lowering on any target and the whole program failed
   * closed, so a program that defines a function and calls it — the ordinary
   * shape of an Epsil file — could not be compiled at all.
   *
   * Two shapes are deliberately LEFT ALONE, and keep failing closed:
   *
   *  - A MULTI-CLAUSE set (two or more definitions of the same name in one
   *    list). `DefineFunction` ACCUMULATES clauses and the call dispatches on
   *    the argument types; a single value binding would silently keep only the
   *    last clause, answering the wrong branch rather than failing.
   *  - The last statement of a VALUE-CARRYING block, whose value is the
   *    block's: a declaration has no value there, and the rewrite would emit
   *    `return let name = …`.
   *
   * Returns `stmts` unchanged when the list defines no function.
   */
  private static withDefineFunctionDeclares(
    stmts: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    valueUsed: boolean
  ): ReadonlyArray<Expression> {
    // Same target restriction as `CompileTarget.localFunctions`: only a target
    // that lowers a `Declare` as a value binding (no `declare` hook — the
    // JavaScript family) can bind a function-valued local at all. Python and
    // the GPU targets declare a local with a scalar type, separately from its
    // assignment, so the rewrite would emit `float g;` against an arrow-
    // function assignment — source no compiler accepts. They keep failing
    // closed on `DefineFunction` itself.
    if (target.declare !== undefined) return stmts;
    if (!stmts.some((s) => isFunction(s, 'DefineFunction'))) return stmts;

    // Names defined more than once in this list are a multi-clause set.
    const definitionCount = new Map<string, number>();
    for (const s of stmts) {
      if (!isFunction(s, 'DefineFunction') || !isSymbol(s.ops[0])) continue;
      const name = s.ops[0].symbol;
      definitionCount.set(name, (definitionCount.get(name) ?? 0) + 1);
    }

    const last = stmts.length - 1;
    const rewritable = (s: Expression, i: number): boolean => {
      if (!isFunction(s, 'DefineFunction') || !isSymbol(s.ops[0])) return false;
      if (valueUsed && i === last) return false;
      if ((definitionCount.get(s.ops[0].symbol) ?? 0) > 1) return false;
      return isFunction(s.ops[1], 'Function');
    };
    const asDeclare = (s: Expression & FunctionInterface): Expression =>
      s.engine._fn('Declare', [s.ops[0], s.engine.string('unknown'), s.ops[1]]);

    // HOISTED to the front, in their original relative order, rather than
    // rewritten in place. A `function` definition is visible to the WHOLE
    // statement list — `DefineFunction`'s canonical handler declares the name
    // as the program canonicalizes, which is what lets `let a = g(3)` precede
    // `function g(k) { … }` and still answer 4 in the interpreter. Emitted in
    // place, the same program compiles to `let a = g(3); let g = …`, and `g`
    // is then read inside its own temporal dead zone: a runtime
    // `ReferenceError: Cannot access 'g' before initialization`, for a program
    // that interprets fine.
    //
    // Hoisting is safe because what moves is a `Declare` of a pure `Function`
    // LITERAL: it has no side effects to reorder, and its body reads whatever
    // it references at CALL time, not at binding time — so a hoisted
    // definition may still reference locals bound after it.
    //
    // A `const`/`let` binding of a lambda is NOT hoisted, because the
    // interpreter does not hoist it either: it declares nothing until its own
    // statement runs, so a call before it is invalid there too. Those resolve
    // through the statement-ordered map in `compileBlock`, and a forward call
    // fails closed at compile time rather than reaching a dead zone.
    const hoisted: Expression[] = [];
    const rest: Expression[] = [];
    stmts.forEach((s, i) => {
      if (rewritable(s, i))
        hoisted.push(asDeclare(s as Expression & FunctionInterface));
      else rest.push(s);
    });
    return [...hoisted, ...rest];
  }

  /**
   * Prepend the `Declare` statements a statement list is MISSING: one per
   * block-local that the block introduces by bare ASSIGNMENT.
   *
   * `canonicalBlock` hoists a top-level `Assign(w, …)` whose target is not
   * visible in the enclosing scope chain into the block's OWN scope — that is
   * the interpreter's block-local, and it is why `{ w ⩴ 2t; w + 1 }` answers
   * `2t+1` rather than leaking a `w`. No `Declare` statement records it, so
   * the locals harvest below never saw it and the two halves of the local
   * disagreed: the write emitted a bare `w = …` (a stray global in sloppy JS,
   * an undeclared identifier no shader compiler accepts) while every read
   * resolved to the free-variable spelling `_.w`, which nothing ever wrote.
   * The block then answered `NaN` behind `success: true` — and since a
   * canonical `Function`-literal body IS such a block, so did every emitted
   * user-function definition with a multi-statement body (`_fn_a(_.u)`).
   *
   * Synthesizing the declaration — rather than special-casing the emission —
   * routes the implicit local through the machinery the declared one already
   * has: the `let`/`float` declaration, the bare-name reads, and the
   * complex-ness / vector-width inference the shader targets need to give it
   * a type.
   *
   * Three shapes are deliberately left alone, each because it is NOT a
   * block-local: a name the enclosing compilation already binds (a parameter,
   * an outer block's local, a loop index — `boundVars`), a name this list
   * declares explicitly, and a name the canonicalizer did not hoist, which
   * means the assignment writes an OUTER binding (that shape has its own
   * pre-existing asymmetry, tracked separately).
   */
  private static withImplicitLocalDeclares(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    node: Expression | undefined
  ): ReadonlyArray<Expression> {
    const scope = node?.localScope;
    if (!scope) return args;

    const implicit: Expression[] = [];
    const seen = new Set<string>();
    for (const arg of args) {
      if (!isFunction(arg, 'Assign')) continue;
      const lhs = arg.ops[0];
      if (!isSymbol(lhs)) continue;
      const name = lhs.symbol;
      if (seen.has(name)) continue;
      if (target.boundVars?.has(name)) continue;
      if (!scope.bindings.has(name)) continue;
      if (
        args.some(
          (a) =>
            isFunction(a, 'Declare') &&
            isSymbol(a.ops[0]) &&
            a.ops[0].symbol === name
        )
      )
        continue;
      seen.add(name);
      // Raw (unbound): this is a synthetic statement, and canonicalizing a
      // `Declare` would register the name in whatever scope the compilation
      // happens to run under. Nothing below does arithmetic on it — the
      // emission paths read `ops[0]` (the name) and `declareValueOperand`
      // (none here) only.
      implicit.push(
        lhs.engine._fn('Declare', [lhs, lhs.engine.string('unknown')], {
          canonical: false,
        })
      );
    }

    return implicit.length === 0 ? args : [...implicit, ...args];
  }

  /**
   * The target-language lvalue an `Assign` writes for the variable `name` —
   * the SAME spelling a READ of that name compiles to.
   *
   * The two halves of a variable must agree. A bound name (a block local, a
   * parameter, a loop index, a desugar temporary) is resolved to its own bare
   * identifier by the enclosing binding form's `var` override, and a target
   * that resolves nothing (the shader targets, which declare a free symbol as
   * a bare identifier) also keeps the bare write — both unchanged. But a
   * target that spells a FREE symbol as something else — JavaScript's
   * vars-object lookup `_.<name>` — used to get a bare `name = …` write while
   * every read compiled to `_.<name>`: in sloppy mode the write created a
   * stray global and the read saw `undefined`. `{ s ⩴ 0; for k ∈ 1..3 { s ⩴ s
   * + … }; s }` therefore ran to `undefined` behind `success: true` whenever
   * the name was NOT hoisted to a block-local — which is exactly what happens
   * for a name the enclosing scope chain already binds (the library scope
   * pre-declares `e`, `i`, `m` and `s`), where the interpreter writes the
   * outer binding and reads it back.
   *
   * A resolution that is not an assignable REFERENCE — a baked constant
   * (`Pi` → `Math.PI`), a folded assigned value, a non-string `vars` mapping —
   * has nowhere to write: fail closed (D6) rather than emit a write the reads
   * cannot see.
   */
  private static assignLValue(
    engine: ComputeEngine,
    name: string,
    target: CompileTarget<Expression>
  ): TargetSource {
    const resolved = target.var?.(name);
    if (resolved === undefined) {
      // The target resolved nothing. The read path then FOLDS an assigned
      // value (`tryFoldKnownSymbol`) before falling back to a bare identifier,
      // so a symbol the engine has a value for reads as that value and no
      // write can reach it — fail closed. Otherwise (a genuinely free symbol,
      // which is how every shader target spells one) the bare identifier is
      // both the read and the write.
      if (engine._getSymbolValue(name) !== undefined)
        throw new Error(
          `Assign: cannot compile — "${name}" has an assigned value, which ` +
            `every read of it bakes into the generated source, so this write ` +
            `would be invisible to them. Fail closed (D6).`
        );
      return target.mangleId ? target.mangleId(name) : name;
    }
    if (resolved === name) return resolved;
    // A vars-object member access naming this very symbol (`_.s`) is the only
    // other assignable form the built-in targets produce. Matched by string
    // surgery, not a regexp built from `name` (a symbol may hold regexp
    // metacharacters).
    if (
      resolved.endsWith(`.${name}`) &&
      /^[A-Za-z_$][\w$]*$/.test(resolved.slice(0, -(name.length + 1)))
    )
      return resolved;
    throw new Error(
      `Assign: cannot compile — target '${target.language ?? 'javascript'}' ` +
        `compiles reads of "${name}" as \`${resolved}\`, which is not an ` +
        `assignable reference (a constant, a folded value, or a baked ` +
        `\`vars\` mapping), so the write would be invisible to every read. ` +
        `Fail closed (D6).`
    );
  }

  /**
   * Compile a block expression
   */
  private static compileBlock(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    node?: Expression,
    valueUsed = true,
    prec = 0
  ): TargetSource {
    // A block-local `Declare` is HELD, so a target's constness / declared type
    // is visible ONLY in this statement list. Harvest it up front: the
    // destructuring-assign desugar below fails closed on such a target (the
    // compiled per-leaf write enforces neither, where the interpreter's
    // destructuring `Assign` validates every leaf before writing any), and a
    // destructuring assign inside a nested LOOP BODY needs it too — that route
    // (`compileLoopBody`) sees only the body's statements, so the set is also
    // pushed for the compilation of the statements below.
    //
    // Harvested BEFORE the desugars, which only add `Declare(name, "unknown",
    // …)` statements — never an enforced one.
    const enforcedLocals = args.some((a) => isFunction(a, 'Declare'))
      ? BaseCompiler.enforcedLocalTargets(args)
      : undefined;

    // Desugar destructuring declares first, so the locals collection and the
    // inference below see only plain scalar declares. As with the assigns
    // below, a value-position one is left alone and fails closed: the rewrite
    // ends on the LAST leaf's declare, whose value is that leaf's, not the
    // tuple's. (It used to be desugared here too and fail closed only by
    // accident — `return let b = 4` is a syntax error, so the emitted source
    // failed to parse. An explicit refusal beats relying on that.)
    if (
      args.some(
        (a) => isFunction(a, 'Declare') && isFunction(a.ops[0], 'Tuple')
      )
    ) {
      const n = args.length;
      args = args.flatMap((a, i) =>
        valueUsed && i === n - 1
          ? [a]
          : (BaseCompiler.desugarPatternDeclare(a, target) ?? [a])
      );
    }

    // …then destructuring assigns, which lower to temporaries + writes.
    //
    // When the block's VALUE is used, the last statement is left alone: the
    // block's value is that statement's, and the rewrite ends on a write
    // (yielding one leaf, not the tuple). It falls through to `compileExpr`
    // and fails closed (D6) rather than silently returning the wrong thing.
    // In a statement list (`valueUsed: false`) there is no such position, so
    // every statement — including the last — lowers.
    if (
      args.some((a) => isFunction(a, 'Assign') && isFunction(a.ops[0], 'Tuple'))
    ) {
      const n = args.length;
      args = args.flatMap((a, i) =>
        valueUsed && i === n - 1
          ? [a]
          : (BaseCompiler.desugarPatternAssign(a, target, enforcedLocals) ?? [
              a,
            ])
      );
    }

    // …then `function` definitions, which are block-scoped exactly like a
    // `const` binding of the same literal and lower to the same value binding.
    args = BaseCompiler.withDefineFunctionDeclares(args, target, valueUsed);

    // …then the block-locals introduced by bare ASSIGNMENT, which carry no
    // `Declare` statement of their own. Synthesize the missing declaration so
    // everything below treats them exactly like a declared local.
    args = BaseCompiler.withImplicitLocalDeclares(args, target, node);

    // Get all the Declare statements
    const locals: string[] = [];
    for (const arg of args) {
      if (isFunction(arg, 'Declare')) {
        const firstOp = arg.ops[0];
        if (isSymbol(firstOp)) locals.push(firstOp.symbol);
      }
    }

    if (args.length === 1 && locals.length === 0) {
      // The single-statement block is UNWRAPPED here, but harvest still saw
      // the `Block` — so both its statement-list region and the statement's
      // own value region are pushed, or the statement's candidates would find
      // no instance to bind at. (A canonical `Function`-literal body is such a
      // block, so this is the common case, not an edge one.)
      // The lone statement inherits the ENCLOSING precedence: unwrapping the
      // block removes the grouping the braces carried, so compiling the
      // statement at precedence 0 spliced a loose infix body straight into its
      // parent — `Multiply(Block(Add(t, 1)), x)` emitted `x * t + 1`, read as
      // `(x * t) + 1`. Handing `prec` down makes the statement's own emission
      // parenthesize itself exactly as an unbracketed operand would.
      return BaseCompiler.withCseScope(node, -1, target, () =>
        BaseCompiler.compileOp(args[0], -1, target, prec, args[0])
      );
    }

    // Infer each local's complex-ness, in statement order, so a later local
    // whose RHS reads an earlier complex local is itself recognized as
    // complex (`w_1 ⩴ (x+iy)² + z_0; w_2 ⩴ w_1² + z_0` — Tycho item 58).
    // The frame is pushed while inferring AND while compiling the
    // statements, so `isComplexValued` — in every target — sees the locals
    // the emitter is about to bind. Sources, per local: an explicit
    // `complex` type on the `Declare`, a `Declare` initial value, or the
    // first `Assign` RHS.
    const complexFrame = new Map<string, boolean>();
    // Vector width (2–4) of a local bound to a vector-valued expression — a
    // point/tuple body such as `p ⩴ (x(t), y(t))`. On a GPU target such a
    // local must be declared `vec2`/`vec3`/`vec4`: the `float` default would
    // disagree with its own assignment AND with the declared return type when
    // the local is the block's value (`vec2 f(…) { float p; p = vec2(…);
    // return p; }` — "return type mismatch" on a real driver).
    // Widths outside 2–4 are tracked too: the list compilers lower those to an
    // ARRAY constructor (`float[5](…)` / `array<f32, 5>(…)`), so the local's
    // declaration must be the matching array type — a `float` declaration with
    // an array assignment is the same mismatch, one width up.
    const vectorFrame = new Map<string, number>();
    // A shader local gets ONE declared type, so every binding of it in the
    // block must agree on a shape. On a GPU target we therefore inspect every
    // binding, not just the first: "first assignment wins" reached the very
    // "declared `float`, assigned `vecN`" mismatch this inference exists to
    // prevent, by intra-block reassignment instead of aliasing.
    //
    // Disagreement FAILS CLOSED rather than widening to a union, because
    // neither GLSL nor WGSL has a type a scalar and a `vecN` (or a `vec2` and
    // a `vec3`) both fit: there is no variant type and no implicit
    // scalar↔vector assignment conversion. "Widening" could only mean
    // splatting the scalar binding (`p = vec2(cos(t))`), which silently
    // rewrites the program's meaning — every later scalar use of `p` becomes
    // vector arithmetic — and for two different vector widths not even that
    // exists. A diagnostic naming the two shapes beats source no driver
    // accepts (D6).
    const isGPUTarget =
      target.language === 'glsl' || target.language === 'wgsl';
    const shapeName = (n: number) =>
      n === BaseCompiler.LOCAL_SCALAR ? 'scalar' : `${n}-component aggregate`;
    const noteVectorWidth = (name: string, value: Expression) => {
      // Only declared locals get a declaration (and hence a type hint).
      const prev = vectorFrame.get(name);
      if (prev === undefined) return;
      const count = BaseCompiler.aggregateComponentCount(value);
      if (!isGPUTarget) {
        // Off-GPU a local is untyped, so any shape may be rebound: keep the
        // historical "first aggregate binding wins". A width of `0` is not
        // recorded (it produces no declaration anywhere), which also keeps it
        // from reading back as an aggregate count off-GPU.
        if (prev < 0 && count) vectorFrame.set(name, count);
        return;
      }
      if (count === 0)
        throw new Error(
          `Block local "${name}": an empty tuple/list has no GPU lowering — ` +
            `neither GLSL nor WGSL has a zero-length array type, so there is ` +
            `no declaration its assignment could match. Fail closed.`
        );
      // Provably non-scalar, but with no single component count (a `Matrix`,
      // a multi-axis or unsized list): no declaration can be synthesized for
      // it, and the `float` default would disagree with its `matN` assignment.
      if (count === undefined && BaseCompiler.isNonScalarShape(value))
        throw new Error(
          `Block local "${name}": a matrix/tensor-valued local has no GPU ` +
            `declaration (its shape has no single component count), so a ` +
            `scalar declaration would disagree with its own assignment. ` +
            `Fail closed.`
        );
      const n = count ?? BaseCompiler.LOCAL_SCALAR;
      if (prev === BaseCompiler.LOCAL_UNSET) {
        vectorFrame.set(name, n);
        return;
      }
      if (n !== prev)
        throw new Error(
          `Block local "${name}" is bound to values of disagreeing shapes ` +
            `(${shapeName(prev)}, then ${shapeName(n)}); a shader local has ` +
            `one declared type and neither GLSL nor WGSL can convert between ` +
            `these. Fail closed.`
        );
    };
    for (const local of locals) {
      // Under the complex discipline a local not declared real is
      // complex-shaped from its declaration (`localComplexDefault`); the
      // strict default is real until a complex first binding.
      complexFrame.set(local, BaseCompiler.localComplexDefault());
      vectorFrame.set(local, BaseCompiler.LOCAL_UNSET);
    }
    BaseCompiler._pushLocalComplex(complexFrame);
    // Pushed before inference AND kept for the compilation of the statements,
    // so a later local's RHS that merely references an earlier one (`q ⩴ p`)
    // resolves the width through the frame (Defect C).
    BaseCompiler._localVector.push(vectorFrame);
    // The enforced-target frame, so a destructuring assign in a nested LOOP
    // BODY still sees this block's declarations (see `enforcedLocals` above).
    // Only a non-empty frame is pushed, so the common block costs nothing.
    const pushedEnforced =
      enforcedLocals !== undefined && enforcedLocals.size > 0;
    if (pushedEnforced) BaseCompiler._enforcedTargets.push(enforcedLocals!);
    try {
      for (const arg of args) {
        // Complex-ness first, then width — the width of a complex value is
        // read THROUGH the complex frame (`aggregateComponentCount`).
        BaseCompiler.noteLocalComplex(arg, complexFrame);
        if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0])) {
          const value = BaseCompiler.declareValueOperand(arg.ops);
          if (value !== undefined) noteVectorWidth(arg.ops[0].symbol, value);
        } else if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
          if (arg.ops[1] !== undefined)
            noteVectorWidth(arg.ops[0].symbol, arg.ops[1]);
        }
      }

      // GPU type hints for block locals.
      //
      // GPU shader scalars are always `float`/`f32`. We intentionally never
      // infer `int`/`i32` for an integer-valued local: GPU number literals are
      // always emitted with a decimal point (`3` → `3.0`, see formatGPUNumber)
      // and scalar shader arithmetic is float, so an `int`-typed declaration
      // would disagree with its own float assignment (`int r; r = 3.0;` — not
      // valid GLSL) and poison every downstream use in float math. Only a
      // complex-valued local needs a non-default hint (`vec2`/`vec2f`), as
      // does a vector-valued (point/tuple) one (`vec2`…`vec4`); everything
      // else uses the `float` default in `target.declare`.
      const typeHints: Record<string, string | undefined> = {};
      if (target.declare && target.language) {
        const isWGSL = target.language === 'wgsl';
        const vecN = (n: number) => (isWGSL ? `vec${n}f` : `vec${n}`);
        // A width with no `vecN` gets the array type the list compilers emit
        // for it, so declaration and assignment agree.
        const aggregateType = (n: number) =>
          n >= 2 && n <= 4
            ? vecN(n)
            : isWGSL
              ? `array<f32, ${n}>`
              : `float[${n}]`;
        for (const local of locals) {
          if (complexFrame.get(local)) typeHints[local] = vecN(2);
          else {
            const n = vectorFrame.get(local);
            // Negative entries are the "not an aggregate" sentinels. A width
            // of `0` has no valid array type in either language; on a GPU
            // target `noteVectorWidth` has already failed closed on it, and
            // this guard keeps any other target from emitting `float[0]`.
            if (n !== undefined && n > 0) typeHints[local] = aggregateType(n);
          }
        }
      }

      // The DECLARED types of typed block locals, for the raw-LHS lowerings
      // (the protocol-property SET reads its receiver's static type from
      // `declaredVarTypes` — see `CompileTarget.declaredVarTypes`).
      const declaredVarTypes = BaseCompiler.statementListDeclaredVarTypes(
        args,
        target.declaredVarTypes
      );

      // The function-valued locals of this list, so a call of one resolves to
      // its own binding (see `CompileTarget.localFunctions`). Filled IN
      // STATEMENT ORDER as the emission below walks the list, not up front:
      // a binding is in scope for its own statement (so a recursive lambda's
      // self-call resolves) and for every later one, but not for an earlier
      // one — where the emitted `let` has not run yet, so resolving there
      // would compile a read of a JavaScript temporal dead zone. `function`
      // definitions are already hoisted to the front of `args`, which is what
      // makes their forward references resolve.
      const localFunctions = BaseCompiler.newLocalFunctionScope(target);
      // …and the whole-list scope a function-literal BODY resolves against,
      // which is what makes mutually recursive definitions compile.
      const lexicalFunctions = BaseCompiler.lexicalFunctionScope(args, target);

      const localTarget: CompileTarget<Expression> = {
        ...target,
        var: (id) => {
          if (locals.includes(id)) return id;
          return target.var(id);
        },
        boundVars: BaseCompiler.withBoundNames(target, locals),
        declaredVarTypes,
        localFunctions,
        lexicalFunctions,
      };

      // The statement LIST is one INERT region — no binding is placed at the
      // statement-list level, so early-exit reachability and inter-statement
      // ordering never interact with CSE. Each statement's own value
      // expressions are separate, bindable child regions (§5.1(c)).
      const stmts = args.filter((a) => !isSymbol(a, 'Nothing'));
      const result = BaseCompiler.withCseScope(node, -1, localTarget, () =>
        stmts
          .flatMap((arg, i) => {
            // Bring this statement's own function-valued binding into scope
            // before compiling it (see `localFunctions` above).
            BaseCompiler.noteLocalFunction(arg, localFunctions);
            // An ELSE-LESS `If` in STATEMENT position. `if c { … }` with no
            // else has no value — the interpreter answers `Nothing`, which is
            // the erasure marker and deliberately has no lowering — so
            // `compileExpr`'s conditional, which needs all three operands,
            // threw `If: wrong number of arguments` on it. That closed every
            // function body containing a plain guard statement (the
            // `parseNumber` scanner in the Epsil examples: `if cs[j] == "-"
            // { sign = -1 … }`), even though the statement's value is
            // discarded here, which is exactly the position where an
            // else-less `if` IS expressible. Emit the statement form the
            // loop-body dispatcher already uses (`if (c) { … }`, no else).
            //
            // The LAST statement of a value-carrying block is NOT a statement
            // position — its value is the block's — so an else-less `If`
            // there keeps failing closed (D6).
            //
            // PLAIN JavaScript ONLY. Every other target stays fail-closed, and
            // each for its own verified reason — the admission is deliberately
            // the narrowest one, since admitting is the direction that
            // miscompiles:
            //
            //  - PYTHON. `compilePythonStatements` does statement-form an
            //    else-less `If` correctly, but it is reached ONLY from a loop
            //    body: a plain function-body `Block` reaches THIS routine,
            //    whose emission is C-like and a syntax error in Python. Routing
            //    to the Python emission from here needs a target hook (the
            //    `block` hook receives already-COMPILED statements), which is a
            //    separate change. Until then the shape declines with `If: wrong
            //    number of arguments` and falls back to the interpreter.
            //  - INTERVAL JavaScript. `compileLoopBody` DOES emit syntactically
            //    valid code here, but not correct code: its
            //    `scalarConditionTarget` unwraps only a `_IA.point(…)` spelling
            //    (the plain-number loop counter it was written for), so a
            //    condition over a free variable or an interval-valued local
            //    emits `0 < _.x` against an `{lo, hi}` OBJECT — always `false`.
            //    Verified: the else-LESS shape answers `[1,1]` for `x = [3,3]`
            //    where the else-ful `_IA.piecewise` lowering answers the
            //    correct `[-1,-1]`. (The same defect already affects an
            //    else-less `If` inside an interval LOOP body — pre-existing,
            //    separate, and not to be widened here.)
            //  - The GPU targets: their own statement model, plus the above.
            if (
              isFunction(arg, 'If') &&
              arg.nops === 2 &&
              !(valueUsed && i === stmts.length - 1) &&
              (target.language === undefined ||
                target.language === 'javascript')
            )
              return [BaseCompiler.compileLoopBody(arg, localTarget)];
            // For Declare, pass inferred type hint to the target hook
            if (
              isFunction(arg, 'Declare') &&
              isSymbol(arg.ops[0]) &&
              target.declare
            ) {
              const name = arg.ops[0].symbol;
              const decl = target.declare(name, typeHints[name]);
              // A `Declare` may carry an initial value (`Declare(sym, type, value)`
              // or a `value` key in a trailing attributes dictionary). Emit it as a
              // separate assignment statement, mirroring how a hoisted
              // `Declare`+`Assign` pair compiles. (Two statements — not a combined
              // initializer — so the declaration stays a plain `let`/`float`, which
              // is what the subsequent assignment requires.)
              const value = BaseCompiler.declareValueOperand(arg.ops);
              if (value !== undefined) {
                // `-1` is the whole-node region sentinel, so a value that is
                // NOT one of `arg`'s operands (it may come from a trailing
                // attributes dictionary) compiles plainly.
                const valueIndex = arg.ops.indexOf(value);
                const valueCode =
                  valueIndex < 0
                    ? BaseCompiler.compile(value, localTarget)
                    : BaseCompiler.compileOp(
                        arg,
                        valueIndex,
                        localTarget,
                        0,
                        value
                      );
                return [decl, `${name} = ${valueCode}`];
              }
              return [decl];
            }
            // A bare expression statement is its own bindable region, keyed
            // `(statement, -1)`; every other statement head reaches its own
            // value edges from `compileExpr` (Assign RHS, Return value, …).
            return [BaseCompiler.compileOp(arg, -1, localTarget, 0, arg)];
          })
          .filter((s) => s !== '')
      );

      if (result.length === 0) return '';

      // A statement list evaluated FOR EFFECT — a loop body — has no value,
      // so it is neither wrapped nor returned from: it is just its statements.
      // Going through the value paths below emitted `return <last statement>`
      // INSIDE the loop, which returns from the enclosing function on the
      // first iteration. (Reachable on any target whose loop bodies route
      // here — the shader targets — for any multi-statement body,
      // destructuring or not.)
      if (!valueUsed) return result.join(`;${target.ws('\n')}`);

      if (target.block) return target.block(result);

      // Default: JavaScript IIFE
      result[result.length - 1] = `return ${result[result.length - 1]}`;
      return `(() => {${target.ws('\n')}${result.join(
        `;${target.ws('\n')}`
      )}${target.ws('\n')}})()`;
    } finally {
      BaseCompiler._popLocalComplex();
      BaseCompiler._localVector.pop();
      if (pushedEnforced) BaseCompiler._enforcedTargets.pop();
    }
  }

  /**
   * Compile a `Loop` expression — imperative control flow, **for effect** (no
   * value is collected). Three shapes:
   *
   * 1. **Bare infinite loop:** `Loop(body)` → `(() => { while (true) { … } })()`.
   *    The body compiles as statements (`compileLoopBody`), so `break` /
   *    `continue` / `return` terminate it. Unbounded loops are rejected on GPU
   *    targets (GLSL/WGSL).
   *
   * 2. **Counted loop:** `Loop(body, Element(i, Range(lo, hi)))` where the
   *    Range is integer-ascending with step 1 → the legacy
   *    `for (let i = lo; i <= hi; i++) { … }` shape, emitted as bare statements
   *    (no result array). The counter is a plain number; wrapping targets
   *    (interval-js) re-wrap references to `i` in the body.
   *
   * 3. **General for-each:** any other Element form (multiple clauses, a
   *    non-`Range` collection, or a stepped/descending/fractional `Range`) →
   *    nested `for (const x of …) { … }` loops whose innermost statement is the
   *    compiled body. No result array.
   *
   * Value-producing comprehensions are compiled by `compileComprehension`
   * (head `Comprehension`), not here.
   */
  private static compileForLoop(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    node?: Expression
  ): TargetSource {
    if (!args[0]) throw new Error('Loop: no body');

    const body = args[0];
    const elements = args.slice(1);
    const lang = target.language ?? '';
    // The loop body is a statement list — an INERT region (§5.1(c)): nothing
    // binds at the list level (a body may run zero times), while each
    // statement's own value expressions are bindable child regions.
    const inBody = <T>(bodyTarget: CompileTarget<Expression>, fn: () => T): T =>
      BaseCompiler.withCseScope(node, 0, bodyTarget, fn);

    // ── Bare infinite loop ────────────────────────────────────────────────
    if (elements.length === 0) {
      if (lang === 'glsl' || lang === 'wgsl')
        throw new Error(
          `${lang.toUpperCase()}: an unbounded Loop(body) is not supported.`
        );
      const bodyStmts = inBody(target, () =>
        BaseCompiler.compileLoopBody(body, target)
      );
      return `(() => {${target.ws('\n')}while (true) {${target.ws(
        '\n'
      )}${bodyStmts}${target.ws('\n')}}${target.ws('\n')}})()`;
    }

    // ── Counted loop: single integer-ascending step-1 Range ───────────────
    if (
      elements.length === 1 &&
      isFunction(elements[0], 'Element') &&
      BaseCompiler.isLegacyCompatibleRange(elements[0].ops[1])
    ) {
      const indexing = elements[0];
      const indexExpr = indexing.ops[0];
      const rangeExpr = indexing.ops[1];

      if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
      if (!isFunction(rangeExpr, 'Range'))
        throw new Error('Loop: expected Range(lo, hi)');

      const index = indexExpr.symbol;

      // Use raw numeric values for the for-loop counter (not target-wrapped).
      // This ensures `for (let i = 1; i <= 5; i++)` uses plain numbers even
      // when the target wraps values (e.g. interval-js would produce
      // `_IA.point(1)` which breaks `i++`).
      const lower = Math.floor(rangeExpr.ops[0].re);
      const upper = Math.floor(rangeExpr.ops[1].re);

      if (!Number.isFinite(lower) || !Number.isFinite(upper))
        throw new Error('Loop: bounds must be finite numbers');

      // Check if the target wraps numeric values (e.g. interval-js).
      // If so, references to the loop index in the body must be wrapped.
      const needsWrap = target.number(0) !== '0';

      const bodyTarget: CompileTarget<Expression> = {
        ...target,
        var: (id: string) =>
          id === index
            ? needsWrap
              ? target.number(0).replace('0', index)
              : index
            : target.var(id),
        boundVars: BaseCompiler.withBoundNames(target, [index]),
      };

      const bodyStmts = inBody(bodyTarget, () =>
        BaseCompiler.compileLoopBody(body, bodyTarget)
      );

      return `(() => {${target.ws(
        '\n'
      )}for (let ${index} = ${lower}; ${index} <= ${upper}; ${index}++) {${target.ws(
        '\n'
      )}${bodyStmts}${target.ws('\n')}}${target.ws('\n')}})()`;
    }

    // ── General for-each (for effect) ─────────────────────────────────────
    if (lang === 'glsl' || lang === 'wgsl')
      throw new Error(
        `${lang.toUpperCase()}: a multi-Element or non-Range Loop is not supported.`
      );

    const inner = BaseCompiler.compileElementLoops(
      elements,
      target,
      (bodyTarget) =>
        inBody(bodyTarget, () => BaseCompiler.compileLoopBody(body, bodyTarget))
    );
    return `(() => {${target.ws('\n')}${inner}${target.ws('\n')}})()`;
  }

  /**
   * Compile a `Comprehension` expression — a value-producing comprehension.
   * `Comprehension(body, Element(x, coll1), Element(y, coll2), …)` compiles to
   * nested `for (const x of …)` loops that `result.push(body)`, returning the
   * collected array:
   *
   * ```js
   * (() => { const result = [];
   *   for (const x of [1,2]) { for (const y of [3,4]) { result.push(body); } }
   *   return result; })()
   * ```
   *
   * GLSL/WGSL have no dynamic arrays, so a comprehension is rejected there.
   */
  private static compileComprehension(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (!args[0]) throw new Error('Comprehension: no body');
    if (!args[1]) throw new Error('Comprehension: no indexing set');

    const body = args[0];
    const elements = args.slice(1);

    const lang = target.language ?? '';
    if (lang === 'glsl' || lang === 'wgsl')
      throw new Error(
        `${lang.toUpperCase()}: Comprehension is not supported (no dynamic arrays). ` +
          'TODO(E3-GLSL): unroll or use a fixed-size array.'
      );

    const inner = BaseCompiler.compileElementLoops(
      elements,
      target,
      (bodyTarget) => `result.push(${BaseCompiler.compile(body, bodyTarget)});`
    );
    return `(() => { const result = []; ${inner} return result; })()`;
  }

  /**
   * Build nested `for (const name of collection) { … }` loops from a list of
   * `Element` clauses. `makeInner` produces the innermost statement given the
   * loop-variable-aware `bodyTarget`. Shared by `compileForLoop` (general
   * for-each) and `compileComprehension`.
   */
  private static compileElementLoops(
    elements: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    makeInner: (bodyTarget: CompileTarget<Expression>) => string
  ): string {
    // Validate all Element clauses and narrow their types.
    type NarrowedElement = Expression & {
      ops: ReadonlyArray<Expression>;
      op1: Expression;
      op2: Expression;
    };
    const narrowedElements: NarrowedElement[] = [];
    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i];
      if (!isFunction(elem, 'Element'))
        throw new Error(
          `Loop: argument ${i + 1} must be an Element clause, got ${(elem as Expression & { operator?: string }).operator ?? '?'}`
        );
      if (!isSymbol(elem.ops[0]))
        throw new Error(
          `Loop: Element index (argument ${i + 1}) must be a symbol`
        );
      narrowedElements.push(elem as unknown as NarrowedElement);
    }

    // For wrapping targets (e.g. interval-js where `target.number(0)` is
    // `_IA.point(0)`), each loop variable must be wrapped wherever it appears
    // in the body or in an inner collection expression. Without this, code
    // like `_IA.add(x, y)` is invoked with raw numbers and produces incorrect
    // intervals.
    const loopVarSet = new Set(
      narrowedElements.map(
        (e) => (e.ops[0] as Expression & { symbol: string }).symbol
      )
    );
    const needsWrap = target.number(0) !== '0';
    // Always shadow the loop variables in the body's target: a loop variable
    // is bound to the bare emitted identifier (wrapped only for wrapping
    // targets like interval-js). Without this, a loop variable that collides
    // with a symbol the engine knows (e.g. an index named `i`, which the
    // engine resolves to the imaginary unit) would be folded to that value by
    // `target.var` instead of referencing the loop binding.
    const bodyTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) =>
        loopVarSet.has(id)
          ? needsWrap
            ? target.number(0).replace('0', id)
            : id
          : target.var(id),
      boundVars: BaseCompiler.withBoundNames(target, [...loopVarSet]),
    };

    // Build nested for-of loops from innermost to outermost. Inner collections
    // are compiled with `bodyTarget` so that references to outer loop variables
    // are wrapped consistently.
    let inner = makeInner(bodyTarget);
    for (let i = narrowedElements.length - 1; i >= 0; i--) {
      const elem = narrowedElements[i];
      const name = (elem.ops[0] as Expression & { symbol: string }).symbol;
      const collExpr = elem.ops[1];
      let collection: string;
      if (isFunction(collExpr, 'Range'))
        collection = BaseCompiler.compileRangeIterable(collExpr, bodyTarget);
      else if (isProvablyStringOperand(collExpr)) {
        // A STRING source iterates its GRAPHEME CLUSTERS — the elements the
        // interpreter's `BoxedString.each()` yields. The bare `for (const c of
        // "abc")` a target string would give iterates CODE POINTS instead, so a
        // ZWJ emoji family or a combining sequence would be torn into several
        // loop iterations where the interpreter runs one. `_SYS.chars` is the
        // interpreter's own segmenter, so segment first and iterate the array.
        // Only JavaScript has that helper; every other target declines rather
        // than emit the code-point loop.
        // (`docs/STRING_ROADMAP.md`, D13.)
        if (target.language !== 'javascript')
          throw new Error(
            `Cannot iterate a string on target '${target.language ?? '?'}': ` +
              `its elements are UAX #29 grapheme clusters and this target has ` +
              `no grapheme segmentation, so the emitted loop would run over ` +
              `code points instead. Fail closed (D6) — the interpreter ` +
              `evaluates it.`
          );
        collection = `_SYS.chars(${BaseCompiler.compile(collExpr, bodyTarget)})`;
      } else collection = BaseCompiler.compile(collExpr, bodyTarget);
      inner = `for (const ${name} of ${collection}) { ${inner} }`;
    }

    return inner;
  }

  /**
   * Returns `true` when the given collection expression is a `Range` whose
   * runtime semantics match the legacy imperative for-loop shape
   * `for (let i = lo; i <= hi; i++)`.
   *
   * Concretely: integer-ascending bounds and step omitted-or-1. When bounds
   * are not statically numeric we accept the Range (the historical
   * behaviour) — runtime mismatch in the descending-unknown-bounds case is
   * left as a known limitation; callers can force the iterable path by
   * supplying an explicit step.
   */
  private static isLegacyCompatibleRange(coll: Expression): boolean {
    if (!isFunction(coll, 'Range')) return false;
    if (coll.ops.length >= 3) {
      const stepExpr = coll.ops[2];
      if (!isNumber(stepExpr) || stepExpr.re !== 1) return false;
    }
    const lo = coll.ops[0];
    const hi = coll.ops[1];
    if (isNumber(lo) && !Number.isInteger(lo.re)) return false;
    if (isNumber(hi) && !Number.isInteger(hi.re)) return false;
    if (isNumber(lo) && isNumber(hi) && lo.re > hi.re) return false;
    return true;
  }

  /**
   * Compile a `Range(lo, hi)` or `Range(lo, hi, step)` expression into a JS
   * iterable expression. Mirrors the runtime semantics in
   * `library/collections.ts` Range:
   *     count    = step === 0 ? 0 : max(0, floor((hi - lo) / step) + 1)
   *     element  = lo + step * k          (0-indexed)
   * Default step is 1 when omitted. Bounds and step may be fractional.
   *
   * Only used from the comprehension path in `compileForLoop`.
   * Caller must have already verified `isFunction(rangeExpr, 'Range')`.
   */
  private static compileRangeIterable(
    rangeExpr: Expression & { ops: ReadonlyArray<Expression> },
    target: CompileTarget<Expression>
  ): string {
    const loExpr = rangeExpr.ops[0];
    const hiExpr = rangeExpr.ops[1];
    const stepExpr = rangeExpr.ops[2];

    // Fast path: all bounds (and step, if present) are numeric constants.
    if (
      isNumber(loExpr) &&
      isNumber(hiExpr) &&
      (stepExpr === undefined || isNumber(stepExpr))
    ) {
      const lo = loExpr.re;
      const hi = hiExpr.re;
      // When step is omitted, auto-direct: +1 if hi >= lo, else -1.
      // Mirrors the runtime range() helper in library/collections.ts.
      const step = stepExpr === undefined ? (hi >= lo ? 1 : -1) : stepExpr.re;
      if (step === 0) return '[]';
      const len = Math.max(0, Math.floor((hi - lo) / step) + 1);
      if (step === 1) {
        if (lo === 0) return `Array.from({length:${len}},(_,k)=>k)`;
        return `Array.from({length:${len}},(_,k)=>${lo}+k)`;
      }
      return `Array.from({length:${len}},(_,k)=>${lo}+(${step})*k)`;
    }

    // General path: compute bounds (and step) at runtime.
    const lo = BaseCompiler.compile(loExpr, target);
    const hi = BaseCompiler.compile(hiExpr, target);
    if (stepExpr === undefined) {
      // Auto-direction step at runtime: +1 if _hi >= _lo, else -1.
      return `((_lo,_hi)=>{const _st=_hi>=_lo?1:-1;return Array.from({length:Math.max(0,Math.floor((_hi-_lo)/_st)+1)},(_,k)=>_lo+_st*k);})(${lo},${hi})`;
    }
    const step = BaseCompiler.compile(stepExpr, target);
    return `((_lo,_hi,_st)=>_st===0?[]:Array.from({length:Math.max(0,Math.floor((_hi-_lo)/_st)+1)},(_,k)=>_lo+_st*k))(${lo},${hi},${step})`;
  }

  /**
   * Compile a loop body expression as statements (not wrapped in IIFE).
   * Handles Break, Continue, Return as statements, and If as if-else when
   * branches contain control flow.
   */
  private static compileLoopBody(
    expr: Expression,
    target: CompileTarget<Expression>
  ): string {
    // Nothing is a no-op in statement context
    if (isSymbol(expr, 'Nothing')) return '';
    if (!isFunction(expr)) return BaseCompiler.compile(expr, target);

    const h = expr.operator;

    if (h === 'Break') return 'break';
    if (h === 'Continue') return 'continue';
    if (h === 'Return')
      return `return ${BaseCompiler.compileOp(expr, 0, target, 0, expr.ops[0])}`;

    if (h === 'If') {
      // For the imperative `if` statement, the condition must produce a
      // boolean.  Interval targets compile comparisons to interval results
      // (e.g. `_IA.greater(...)` returns an object, not a boolean), which
      // would always be truthy.  Use scalar operators for the condition.
      // The condition is a value expression (its own bindable region); each
      // branch is a statement list again (§5.1(c)).
      const condTarget = BaseCompiler.scalarConditionTarget(target);
      const cond = BaseCompiler.compileOp(expr, 0, condTarget, 0, expr.ops[0]);
      const branch = (i: number): string =>
        BaseCompiler.withCseScope(expr, i, target, () =>
          BaseCompiler.compileLoopBody(expr.ops[i], target)
        );
      const thenBranch = branch(1);
      if (expr.ops.length > 2) {
        const elseBranch = branch(2);
        if (elseBranch)
          return `if (${cond}) { ${thenBranch} } else { ${elseBranch} }`;
      }
      return `if (${cond}) { ${thenBranch} }`;
    }

    if (h === 'Block') {
      // A loop body is a statement list of its own — it does NOT go through
      // `compileBlock` — so the destructuring-assign desugar has to run here
      // too, or the pair-carrying loop step this feature exists for
      // (`(a, b) := (b, a + b)`) would fail closed. A body's value is
      // discarded, so no trailing value tuple (`isLast: false`).
      // For the same reason the implicit-block-local desugar runs here too: a
      // loop body that binds a scratch variable by bare assignment
      // (`q ⩴ 2i; s ⩴ s + q`) has no `Declare` for it either, so the write
      // emitted a bare `q` while every read emitted `_.q` — `NaN`.
      //
      // …and so does the COMPLEX-ness inference `compileBlock` runs over its
      // locals: without the frame, a loop-body local bound to a complex value
      // (`z ⩴ t + i; s ⩴ s + |z|`) was written as a `{re, im}` object but read
      // back as a real — `Abs(z)` lowered to `Math.abs` on an object, i.e.
      // `NaN` behind `success: true` — and an explicitly declared local
      // behaved identically.
      //
      // The VECTOR-width frame is deliberately NOT pushed here. Its only
      // consumer is the shader declaration type hint, and no shader target
      // reaches this routine: the GPU targets define their own `Loop`
      // (`GPU_FUNCTIONS.Loop`), which compiles the body with
      // `compileStatementList` — a `Block` body goes straight to
      // `compileBlock`, inference included. This is the JavaScript-family
      // path, whose locals are untyped `let`s, and a vector-valued loop-body
      // local already agrees with the interpreter there.
      const stmts = expr.ops.flatMap(
        (s) => BaseCompiler.desugarPatternAssign(s, target) ?? [s]
      );
      // …and so does the `function`-definition rewrite, so a definition made
      // INSIDE a loop body lowers and is callable there, exactly as one made
      // in an ordinary block is. A loop body carries no value, hence
      // `valueUsed: false`: every statement of it, the last included, is in
      // statement position.
      const withDecls = BaseCompiler.withImplicitLocalDeclares(
        BaseCompiler.withDefineFunctionDeclares(stmts, target, false),
        target,
        expr
      );
      // A body-scoped `localFunctions`, filled in statement order below. Held
      // as its own binding because the field on `CompileTarget` is a
      // `ReadonlyMap`: the target exposes it for READS during compilation, and
      // only this routine writes it.
      const bodyLocalFunctions = BaseCompiler.newLocalFunctionScope(target);
      const bodyTarget: CompileTarget<Expression> = {
        ...BaseCompiler.loopBodyTempTarget(withDecls, target),
        localFunctions: bodyLocalFunctions,
        lexicalFunctions: BaseCompiler.lexicalFunctionScope(withDecls, target),
      };
      const complexFrame = new Map<string, boolean>();
      for (const s of withDecls)
        if (isFunction(s, 'Declare') && isSymbol(s.ops[0]))
          complexFrame.set(s.ops[0].symbol, BaseCompiler.localComplexDefault());
      BaseCompiler._pushLocalComplex(complexFrame);
      try {
        for (const s of withDecls)
          BaseCompiler.noteLocalComplex(s, complexFrame);
        return BaseCompiler.withCseScope(expr, -1, bodyTarget, () =>
          withDecls
            .map((s) => {
              // Statement-ordered, as in `compileBlock` — see the
              // `localFunctions` comment there.
              BaseCompiler.noteLocalFunction(s, bodyLocalFunctions);
              return BaseCompiler.compileLoopBody(s, bodyTarget);
            })
            .join('; ')
        );
      } finally {
        BaseCompiler._popLocalComplex();
      }
    }

    // …and the same statement as a bare (unwrapped) loop body.
    if (h === 'Assign' && isFunction(expr.ops[0], 'Tuple')) {
      const stmts = BaseCompiler.desugarPatternAssign(expr, target);
      if (stmts !== null) {
        const bodyTarget = BaseCompiler.loopBodyTempTarget(stmts, target);
        return stmts
          .map((s) => BaseCompiler.compileLoopBody(s, bodyTarget))
          .join('; ');
      }
    }

    return BaseCompiler.compileOp(expr, -1, target, 0, expr);
  }

  /**
   * A loop-body target in which the desugar's temporaries resolve to BARE
   * identifiers. `compileBlock` does this for its locals; the loop-body path
   * has no locals collection of its own, so without it a temp is emitted as
   * `let _tv1 = …` but read back as the free symbol `_._tv1`.
   *
   * Returns `target` unchanged when the statement list declares no temporary.
   */
  static loopBodyTempTarget(
    stmts: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): CompileTarget<Expression> {
    const temps: string[] = [];
    for (const s of stmts)
      if (isFunction(s, 'Declare') && isSymbol(s.ops[0]))
        temps.push(s.ops[0].symbol);
    if (temps.length === 0) return target;
    return {
      ...target,
      var: (id) => (temps.includes(id) ? id : target.var(id)),
      boundVars: BaseCompiler.withBoundNames(target, temps),
      declaredVarTypes: BaseCompiler.statementListDeclaredVarTypes(
        stmts,
        target.declaredVarTypes
      ),
    };
  }

  /**
   * A fresh `localFunctions` scope for a statement list: a MUTABLE copy of the
   * enclosing map, which `noteLocalFunction` fills in statement order as the
   * list is emitted. See `CompileTarget.localFunctions` for what the map is
   * for, and `compileBlock` for why it is filled progressively rather than up
   * front (a binding must not be resolvable before its own `let` has run).
   *
   * Returns `undefined` for a target that lowers a `Declare` through a
   * `declare` hook (Python, the GPU targets): there the declaration and its
   * assignment are separate statements with a declared scalar type, so a
   * function-valued local has no binding a call could reach — those targets
   * must keep failing closed rather than emit a call to a name they never
   * bound.
   */
  /**
   * The parameter names a function literal EMITS, and the `var` hook that
   * resolves its parameters to them.
   *
   * Normally the two coincide — a parameter compiles to its own name. They
   * differ when a parameter would SHADOW the target's vars object
   * (`CompileTarget.varsObjectName`): the JavaScript family binds free
   * symbols through `_`, and `_` is also how an implicit lambda parameter is
   * spelled, so `_ => _ + k` emitted `((_) => _ + _.k)` — inside the arrow
   * `_` is the parameter, so `_.k` read a property off a number and the call
   * answered `NaN` behind `success: true`. Such a parameter is renamed to a
   * generated name that the literal's other parameters and the compilation's
   * used-name set do not claim; the body's reads follow through the returned
   * hook, so the rename is invisible to everything else.
   *
   * The rename is deliberately confined to the collision: every other literal
   * emits byte-identical source to before.
   */
  private static lambdaParamBinding(
    params: ReadonlyArray<string>,
    body: Expression | undefined,
    target: CompileTarget<Expression>
  ): { emitted: string[]; varOf: (id: string) => TargetSource | undefined } {
    const keep = {
      emitted: [...params],
      varOf: (id: string) => (params.includes(id) ? id : target.var(id)),
    };

    // Which of this literal's parameters shadow something the target bakes
    // into the emitted source. Two sources, with DIFFERENT rename conditions:
    const shadowing = new Set<string>();

    // (1) A runtime helper namespace (`_SYS`, `_IA` —
    //     `CompileTarget.reservedEmittedNames`). Renamed UNCONDITIONALLY: no
    //     source spells a parameter this way, so the rename costs nothing and
    //     does not have to predict which helpers the body will emit. Left
    //     alone, a parameter named `_SYS` turned every `_SYS.…` lowering
    //     inside its body into `TypeError: _SYS.rangeIter is not a function`.
    for (const p of params)
      if (target.reservedEmittedNames?.has(p)) shadowing.add(p);

    // (2) The vars object (`_`). Renamed only when the body actually READS it:
    //     `_` is the ordinary spelling of an implicit parameter, so renaming
    //     it unconditionally would rewrite every `_ ↦ …` literal in every
    //     artifact — `((_) => (_ * _))` and its like — for no behavioural
    //     gain. `unknowns` is the same set the JavaScript target's `var` hook
    //     keys its `_.<id>` emission on, so it decides the collision
    //     precisely; the body's own parameters appear there (nothing binds
    //     them in the body expression alone) and are filtered out.
    const varsObject = target.varsObjectName;
    if (varsObject !== undefined && params.includes(varsObject)) {
      const prefix = `${varsObject}.`;
      const readsVarsObject = (body?.unknowns ?? []).some(
        (s) => !params.includes(s) && target.var(s)?.startsWith(prefix) === true
      );
      if (readsVarsObject) shadowing.add(varsObject);
    }

    if (shadowing.size === 0) return keep;

    const taken = (name: string): boolean =>
      params.includes(name) || target.naming?.usedNames.has(name) === true;
    const renamed = new Map<string, string>();
    const allocated = new Set<string>();
    let n = 0;
    for (const p of shadowing) {
      let fresh = '_p';
      while (taken(fresh) || allocated.has(fresh)) fresh = `_p${++n}`;
      allocated.add(fresh);
      target.naming?.usedNames.add(fresh);
      renamed.set(p, fresh);
    }

    return {
      emitted: params.map((p) => renamed.get(p) ?? p),
      varOf: (id) =>
        params.includes(id) ? (renamed.get(id) ?? id) : target.var(id),
    };
  }

  private static newLocalFunctionScope(
    target: CompileTarget<Expression>
  ): Map<string, Expression> | undefined {
    if (target.declare !== undefined) return undefined;
    return new Map(target.localFunctions ?? []);
  }

  /**
   * The `lexicalFunctions` scope for a statement list: every function-valued
   * local the list declares, merged over the enclosing lexical scope. Unlike
   * {@link newLocalFunctionScope} this is complete before any statement is
   * emitted — see `CompileTarget.lexicalFunctions` for why a function-literal
   * body resolves against the whole list and a statement against only the
   * part before it.
   */
  private static lexicalFunctionScope(
    stmts: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): ReadonlyMap<string, Expression> | undefined {
    if (target.declare !== undefined) return undefined;
    const scope = new Map(
      target.lexicalFunctions ?? target.localFunctions ?? []
    );
    for (const stmt of stmts) BaseCompiler.noteLocalFunction(stmt, scope);
    return scope;
  }

  /**
   * Record statement `stmt`'s function-valued local in `scope`, if it declares
   * one. A local whose value is NOT a function literal REMOVES the entry it
   * shadows (`let g = 5` over an outer function-valued `g` must not keep
   * calling the outer one).
   */
  private static noteLocalFunction(
    stmt: Expression,
    scope: Map<string, Expression> | undefined
  ): void {
    if (scope === undefined) return;
    if (!isFunction(stmt, 'Declare') || !isSymbol(stmt.ops[0])) return;
    const name = stmt.ops[0].symbol;
    const value = BaseCompiler.declareValueOperand(stmt.ops);
    if (value !== undefined && isFunction(value, 'Function'))
      scope.set(name, value);
    else scope.delete(name);
  }

  /**
   * The `declaredVarTypes` map for a statement list: the enclosing map (the
   * definition's parameter types, or an outer list's) merged with the
   * DECLARED types of this list's typed locals, for the raw-LHS lowerings
   * (the protocol-property SET reads its receiver's static type from it —
   * see `CompileTarget.declaredVarTypes`). An UNTYPED local REMOVES the
   * entry it shadows (`let p = …` over a `p: Person` parameter must not
   * keep reading as `Person`). List-scoped, not statement-ordered: a
   * use-before-declare is invalid upstream, so the approximation is safe.
   *
   * Returns the enclosing map unchanged when the list declares nothing.
   */
  static statementListDeclaredVarTypes(
    stmts: ReadonlyArray<Expression>,
    enclosing: Readonly<Record<string, Type>> | undefined
  ): Readonly<Record<string, Type>> | undefined {
    if (!stmts.some((s) => isFunction(s, 'Declare'))) return enclosing;
    const merged: Record<string, Type> = { ...enclosing };
    for (const arg of stmts) {
      if (!isFunction(arg, 'Declare') || !isSymbol(arg.ops[0])) continue;
      const name = arg.ops[0].symbol;
      delete merged[name];
      const src = arg.ops[1];
      const text = isString(src)
        ? src.string
        : isSymbol(src)
          ? src.symbol
          : undefined;
      if (text === undefined || text === 'unknown') continue;
      try {
        merged[name] = parseType(text, arg.engine._typeResolver);
      } catch {
        // An unparseable annotation contributes nothing (the local then
        // reads as undeclared here, the safe direction).
      }
    }
    return merged;
  }

  /**
   * Create a target that compiles conditions as plain JS booleans.
   * Used inside `compileLoopBody` so that `if (cond)` gets a real boolean,
   * not an interval result object (which would always be truthy).
   *
   * Overrides comparison and logical operators to use plain JS, and
   * numeric values/variables to use raw numbers (the loop counter is
   * already a plain number).
   */
  private static scalarConditionTarget(
    target: CompileTarget<Expression>
  ): CompileTarget<Expression> {
    const SCALAR_OPS: Record<string, [string, number]> = {
      Less: ['<', 20],
      Greater: ['>', 20],
      LessEqual: ['<=', 20],
      GreaterEqual: ['>=', 20],
      Equal: ['===', 20],
      NotEqual: ['!==', 20],
      And: ['&&', 6],
      Or: ['||', 5],
      Not: ['!', 16],
    };

    // If the target doesn't wrap numbers, no override needed
    if (target.number(0) === '0') return target;

    return {
      ...target,
      number: (n: number) => String(n),
      var: (id: string) => {
        // Resolve through original target, then strip interval wrapping
        // e.g. '_IA.point(i)' → 'i', plain 'x' stays 'x'
        const resolved = target.var(id);
        if (!resolved) return undefined as any;
        const match = resolved.match(/^_IA\.point\((.+)\)$/);
        return match ? match[1] : resolved;
      },
      operators: (op: string) => SCALAR_OPS[op] ?? target.operators?.(op),
      functions: (id: string) => {
        // Comparison functions should not be used — operators handle them
        if (id in SCALAR_OPS) return undefined;
        return target.functions?.(id);
      },
    };
  }

  /**
   * Compile loop constructs (Sum/Product)
   */
  private static compileLoop(
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    node?: Expression
  ): string {
    if (!args[0]) throw new Error('Sum/Product: no body');

    // Multi-index Sum/Product (more than one indexing-set clause) is not
    // representable in this generic single-index loop. Fail closed (D6) rather
    // than silently drop the trailing clauses and emit code with a dangling
    // index variable.
    if (args.length > 2)
      throw new Error(
        `${h}: multi-index (${args.length - 1} indexing sets) is not supported by this target`
      );

    const {
      index,
      lower,
      upper,
      isFinite: _isFinite,
    } = normalizeIndexingSet(args[1]);
    const isSum = h === 'Sum';
    const op = isSum ? '+' : '*';
    // Analyze the body with the index masked, exactly as `isComplexValued`
    // does for the whole `Sum`/`Product` — otherwise the emitter could produce
    // a complex accumulator that the enclosing expression consumes as a real
    // number (Tycho item 65).
    const bodyIsComplex = BaseCompiler.withBinderMask(
      { real: index ? [index] : [], shielded: index ? [index] : [] },
      () => BaseCompiler.isComplexValued(args[0])
    );

    if (!index) {
      // Loop over a collection
      const indexVar = BaseCompiler.tempVar(target);
      const acc = BaseCompiler.tempVar(target);
      const col = BaseCompiler.compile(args[0], target);
      if (bodyIsComplex) {
        if (isSum) {
          return `${col}.reduce((${acc}, ${indexVar}) => ({ re: ${acc}.re + ${indexVar}.re, im: ${acc}.im + ${indexVar}.im }), { re: 0, im: 0 })`;
        }
        // Product
        return `${col}.reduce((${acc}, ${indexVar}) => ({ re: ${acc}.re * ${indexVar}.re - ${acc}.im * ${indexVar}.im, im: ${acc}.re * ${indexVar}.im + ${acc}.im * ${indexVar}.re }), { re: 1, im: 0 })`;
      }
      return `${col}.reduce((${acc}, ${indexVar}) => ${acc} ${op} ${indexVar}, ${
        isSum ? '0' : '1'
      })`;
    }

    // Reject a collection-valued body for the indexed form (see
    // `assertScalarBigOpBody`); the `!index` collection-reduce arm above is
    // exempt. (The JavaScript target never reaches this generic loop — its
    // own `emitSumProduct` handles the indexed form, including the
    // element-wise collection-body arm.)
    BaseCompiler.assertScalarBigOpBody(h, args[0]);

    // The body is the binder's own bindable region (§5.1(a)), pushed under the
    // target that binds the index — so a temporary lands INSIDE the loop and
    // is recomputed per iteration, never hoisted out of it.
    const bodyTarget: CompileTarget<Expression> = {
      ...target,
      var: (id) => {
        if (id === index) return index;
        return target.var(id);
      },
      boundVars: BaseCompiler.withBoundNames(target, [index]),
    };
    const fn = BaseCompiler.compileOp(node, 0, bodyTarget, 0, args[0]);

    const acc = BaseCompiler.tempVar(target);

    // Iteration-budget guard (see CompileTarget.iterationBudget): a trip
    // count over the budget — including infinite or NaN bounds, for which
    // the negated comparison also fails — evaluates to NaN instead of
    // running the loop.
    const budget = target.iterationBudget;
    const guardNaN = (nan: string): string =>
      budget !== undefined
        ? `\n  if (!((${upper}) - ${index} < ${budget})) return ${nan};`
        : '';

    if (bodyIsComplex) {
      const val = BaseCompiler.tempVar(target);
      const guard = guardNaN('{ re: NaN, im: NaN }');
      if (isSum) {
        return `(() => {
  let ${acc} = { re: 0, im: 0 };
  let ${index} = ${lower};${guard}
  while (${index} <= ${upper}) {
    const ${val} = ${fn};
    ${acc} = { re: ${acc}.re + ${val}.re, im: ${acc}.im + ${val}.im };
    ${index}++;
  }
  return ${acc};
})()`;
      }
      // Product
      return `(() => {
  let ${acc} = { re: 1, im: 0 };
  let ${index} = ${lower};${guard}
  while (${index} <= ${upper}) {
    const ${val} = ${fn};
    ${acc} = { re: ${acc}.re * ${val}.re - ${acc}.im * ${val}.im, im: ${acc}.re * ${val}.im + ${acc}.im * ${val}.re };
    ${index}++;
  }
  return ${acc};
})()`;
    }

    return `(() => {
  let ${acc} = ${isSum ? '0' : '1'};
  let ${index} = ${lower};${guardNaN('NaN')}
  while (${index} <= ${upper}) {
    ${acc} ${op}= ${fn};
    ${index}++;
  }
  return ${acc};
})()`;
  }

  /**
   * Lexical frames of `Block` locals, innermost last, each mapping a local's
   * name to its inferred complex-ness. Pushed/popped by `compileBlock` around
   * the compilation of its statements (compilation is synchronous, so a
   * static stack is safe), and consulted by `isComplexValued` so that every
   * target's operand analysis agrees with the emitted local bindings.
   */
  private static _localComplex: Map<string, boolean>[] = [];

  /**
   * Frames of names bound by a binder form currently being ANALYZED (as
   * opposed to compiled) by `isComplexValued` — see `binderParts`. Innermost
   * last.
   *
   * Like `_boundVarsCtx`, a shielded name is not a free engine symbol, so the
   * engine-value fallback must not read through it. Unlike `_localComplex`, a
   * shield leaves the name's declared type in play: a lambda parameter can
   * legitimately be complex (Tycho item 60), so it is shielded but not forced
   * real.
   */
  private static _binderShield: Set<string>[] = [];

  /**
   * Promotion verdicts recorded for broadcast closures currently being
   * emitted (`tryCompileBroadcast`): for a promotable radical/`Power` head,
   * the verdict is decided ONCE on the node-level operands — which carry the
   * sign/type evidence — and consulted by `promotesRadicalToComplex` when
   * the head's scalar codegen re-asks with the closure's synthetic element
   * temps, which carry none. Managed as a stack with symmetric try/finally
   * push/pop, always strictly inside the closure's `_pushLocalComplex`
   * frame, so `isComplexValued` answers memoized under a recorded verdict
   * stay in that frame's memo layer and cannot leak past it.
   */
  private static _broadcastRadicalVerdict: Array<{
    head: string;
    params: Set<string>;
    promotes: boolean;
  }> = [];

  /**
   * Memoized `isComplexValued` answers for FUNCTION expressions (Tycho item
   * 148). Keyed by expression IDENTITY, valid only for the context the
   * analysis reads: the `_localComplex` frames, the `_binderShield` frames,
   * `_boundVarsCtx`, and the engine's assigned symbol values.
   *
   * The memo is LAYERED to mirror the context's lexical nesting: entering a
   * frame or binder mask pushes a fresh layer, leaving it pops back to the
   * enclosing layer — which is valid again, because the enclosing context is
   * restored exactly (the enter/exit sites are all symmetric try/finally
   * pairs). Only the top layer is ever read or written, so an answer computed
   * under a mask can never leak outside it; and because a binder NODE's own
   * verdict is stored in its enclosing layer, sibling and repeat queries of
   * the binder hit the memo instead of re-entering the mask — without this,
   * nested `Sum`/`Product` chains stayed O(d²) (review finding on the item-148
   * fix). `isComplexValued` only consults the memo while a compilation is
   * running (`_compileDepth > 0`), where engine values are stable.
   */
  private static _complexMemoStack: WeakMap<object, boolean>[] = [
    new WeakMap(),
  ];

  /**
   * Drop every memoized complexness answer, at every layer.
   *
   * For WHOLESALE context changes: the compilation boundary (engine symbol
   * values may differ) and a `_boundVarsCtx` swap (not a lexical push, so
   * layering does not model it). Lexical enter/exit uses
   * `_pushComplexMemoLayer`/`_popComplexMemoLayer` instead; an in-place
   * mutation of the CURRENT frame uses `_resetComplexMemoTop`. Every context
   * mutation goes through one of these — routed via the helpers below
   * (`_pushLocalComplex`/`_popLocalComplex`/`_setLocalComplex`,
   * `withBinderMask`, `withLocalShapeFrame`) and `compile()`'s
   * `_boundVarsCtx` sync — so no new call site has to remember.
   */
  private static _invalidateComplexMemo(): void {
    BaseCompiler._complexMemoStack = [new WeakMap()];
  }

  /** Enter a lexical context: answers cached inside must not escape it. */
  private static _pushComplexMemoLayer(): void {
    BaseCompiler._complexMemoStack.push(new WeakMap());
  }

  /**
   * Leave a lexical context, restoring the enclosing layer. The guard resets
   * rather than underflows if an unbalanced pop ever slips through — stale
   * reuse is the failure mode that matters, an empty memo is merely slow.
   */
  private static _popComplexMemoLayer(): void {
    BaseCompiler._complexMemoStack.pop();
    if (BaseCompiler._complexMemoStack.length === 0)
      BaseCompiler._complexMemoStack = [new WeakMap()];
  }

  /**
   * The CURRENT frame changed in place (`compileBlock` fills its frame
   * incrementally): answers cached under it are stale, enclosing layers are
   * not consulted until their context is restored — drop only the top.
   */
  private static _resetComplexMemoTop(): void {
    BaseCompiler._complexMemoStack[BaseCompiler._complexMemoStack.length - 1] =
      new WeakMap();
  }

  /**
   * Nesting depth of `compile()`. Zero outside any compilation — where the
   * complexness memo is neither read nor written, because engine symbol
   * values may change between compilations.
   */
  private static _compileDepth = 0;

  /** Push a lexical frame of local complex-ness onto `_localComplex`. */
  private static _pushLocalComplex(frame: Map<string, boolean>): void {
    BaseCompiler._localComplex.push(frame);
    BaseCompiler._pushComplexMemoLayer();
  }

  /** Pop the innermost `_localComplex` frame. */
  private static _popLocalComplex(): void {
    BaseCompiler._localComplex.pop();
    BaseCompiler._popComplexMemoLayer();
  }

  /**
   * Record a local's inferred complex-ness in a `_localComplex` frame.
   * Routed through here (rather than a bare `frame.set`) because
   * `compileBlock` fills its frame INCREMENTALLY, while the frame is already
   * pushed and visible to the analysis.
   */
  private static _setLocalComplex(
    frame: Map<string, boolean>,
    name: string,
    value: boolean
  ): void {
    frame.set(name, value);
    BaseCompiler._resetComplexMemoTop();
  }

  /**
   * Record what the statement `arg` says about the complex-ness of the local
   * it binds, into the (already PUSHED) frame `frame`.
   *
   * The per-statement step of the incremental inference `compileBlock`
   * performs over its locals — factored out because two other statement-list
   * routes run the same inference: `compileLoopBody`'s `Block` branch (a JS
   * loop body is a statement list of its own, which does NOT go through
   * `compileBlock`) and the `Block` arm of `isComplexValued` (which types a
   * block from its VALUE, and so must know its locals' shapes).
   *
   * Sources, per local: an explicit `complex` type on the `Declare`, a
   * `Declare` initial value, or the FIRST `Assign` RHS (a local already known
   * complex is never demoted). The frame must be pushed while this runs, so a
   * later local whose RHS reads an earlier one resolves it through the frame.
   * A name with no entry in `frame` is not a local of this list and is left
   * alone.
   */
  private static noteLocalComplex(
    arg: Expression,
    frame: Map<string, boolean>
  ): void {
    if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0])) {
      const name = arg.ops[0].symbol;
      if (isSymbol(arg.ops[1], 'complex'))
        BaseCompiler._setLocalComplex(frame, name, true);
      else if (
        BaseCompiler.complexDiscipline &&
        BaseCompiler.declaredTypeIsReal(arg.ops[1])
      )
        // Complex discipline: a local DECLARED a real-only type keeps the
        // real kernel (the type-based realness proof survives as an
        // optimization, design §2).
        BaseCompiler._setLocalComplex(frame, name, false);
      const value = BaseCompiler.declareValueOperand(arg.ops);
      if (value !== undefined) {
        if (BaseCompiler.isComplexValued(value))
          BaseCompiler._setLocalComplex(frame, name, true);
        BaseCompiler.markLocalBound(frame, name);
      }
    } else if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
      const name = arg.ops[0].symbol;
      if (
        frame.get(name) === false &&
        BaseCompiler.isComplexValued(arg.ops[1])
      ) {
        // STRICT discipline (design §3, "Block local" row): a local's shape
        // is its FIRST binding's shape, and a later complex-shaped assignment
        // to a local bound real is a LaneMismatch DECLINE — the statements
        // between the two bindings were compiled reading a number. Under the
        // other modes (step 2) the local is promoted as before, which is
        // itself the silent-wrong shape (`k := 1; k := k + 2i` reads `.re`
        // off the number `1`) that step 3's complex discipline removes.
        if (BaseCompiler.strictLanes && BaseCompiler.localIsBound(frame, name))
          BaseCompiler.laneMismatch(
            'Block local',
            `the local \`${name}\``,
            arg.ops[1]
          );
        BaseCompiler._setLocalComplex(frame, name, true);
      }
      if (frame.has(name)) BaseCompiler.markLocalBound(frame, name);
    } else if (BaseCompiler.strictLanes) {
      // A complex-shaped assignment to a real-bound local NESTED in a
      // conditional or loop statement (`if (t < 0) { k := i·k }`) is the same
      // mismatch: the local stays real-shaped for the rest of the block (only
      // top-level statements shape it), so the value it holds after the
      // branch is consumed as a number. Walked here for the strict decline
      // only; a nested `Function`/`Block` scope of its own is not entered.
      BaseCompiler.checkNestedComplexRebinding(arg, frame);
    }
  }

  /**
   * The complex-frame DEFAULT for a block local at its declaration: `true`
   * under the complex discipline (a local not declared real is wide, hence
   * complex-shaped, and every reference to it is lifted at use), `false`
   * otherwise (real until a complex first binding, the strict default).
   */
  private static localComplexDefault(): boolean {
    return BaseCompiler.complexDiscipline;
  }

  /** Does the `Declare` type operand `t` name a real-only number type? */
  private static declaredTypeIsReal(t: Expression | undefined): boolean {
    if (t === undefined) return false;
    const text = isString(t) ? t.string : isSymbol(t) ? t.symbol : undefined;
    if (text === undefined) return false;
    try {
      return isSubtype(parseType(text), 'real');
    } catch {
      return false;
    }
  }

  /**
   * The locals of a block frame that have received a first binding (a
   * `Declare` with a value, or an `Assign`), keyed by frame — the "bound
   * real" half of the strict-mode block-local rule (`noteLocalComplex`): a
   * local with `frame.get(name) === false` and no first binding is merely
   * DECLARED real by default and may still be shaped by its first `Assign`.
   */
  private static readonly _boundLocals = new WeakMap<
    Map<string, boolean>,
    Set<string>
  >();

  private static markLocalBound(frame: Map<string, boolean>, name: string) {
    let bound = BaseCompiler._boundLocals.get(frame);
    if (bound === undefined) {
      bound = new Set();
      BaseCompiler._boundLocals.set(frame, bound);
    }
    bound.add(name);
  }

  private static localIsBound(
    frame: Map<string, boolean>,
    name: string
  ): boolean {
    return BaseCompiler._boundLocals.get(frame)?.has(name) === true;
  }

  /**
   * Walk the statement forms nested in `stmt` (`If`/`Which` arms, `Loop`
   * bodies, statement lists) for an `Assign` of a real-bound local of `frame`
   * to a complex-shaped value, and raise the strict-mode block-local
   * `LaneMismatch` for the first one. Never enters a `Function` literal or a
   * nested `Block` (each is a scope of its own; a nested block's assignment to
   * an OUTER local is left to that block's own frame handling, as today).
   */
  private static checkNestedComplexRebinding(
    stmt: Expression,
    frame: Map<string, boolean>
  ): void {
    if (!isFunction(stmt)) return;
    const h = stmt.operator;
    if (h === 'Function' || h === 'Block') return;
    if (h === 'Assign' && isSymbol(stmt.ops[0])) {
      const name = stmt.ops[0].symbol;
      if (
        frame.get(name) === false &&
        BaseCompiler.localIsBound(frame, name) &&
        stmt.ops[1] !== undefined &&
        BaseCompiler.isComplexValued(stmt.ops[1])
      )
        BaseCompiler.laneMismatch(
          'Block local',
          `the local \`${name}\``,
          stmt.ops[1]
        );
      return;
    }
    if (h !== 'If' && h !== 'Which' && h !== 'Loop') return;
    for (const op of stmt.ops)
      BaseCompiler.checkNestedComplexRebinding(op, frame);
  }

  /**
   * The binding structure of `expr` if it is a binder form, else `null`.
   *
   * A binder's operands are not all values: `Sum`/`Product`/`Loop`/
   * `Comprehension` carry `Limits`/`Element` clauses and `Function` carries
   * its parameter names. Those operands introduce a NAME, not a value, so the
   * generic `ops.some(isComplexValued)` fallback must not walk them — doing so
   * reaches the bound name as if it were free and resolves it against the
   * engine, where an index named `i` is the imaginary unit. That made
   * `\sum_{i=0}^{2}\cos(it)` report complex and complex-lowered the SIBLING
   * operand of any enclosing arithmetic (`… + 2.5` → NaN, and a term silently
   * vanishing inside `\sin(…)`; Tycho item 65).
   *
   * `bodies` are the operands that carry a value; `real` names are integer
   * counters (a `Limits` clause, or an `Element` clause over a `Range`), which
   * are masked real in the body analysis; `shielded` names are every bound
   * name, masked only against the engine-value fallback.
   */
  private static binderParts(
    expr: Expression & { ops: ReadonlyArray<Expression> }
  ): {
    bodies: ReadonlyArray<Expression>;
    real: string[];
    shielded: string[];
  } | null {
    const h = expr.operator;
    if (h === 'Function') {
      // ["Function", body, ...params]: a parameter may legitimately be
      // complex, so shield only — never force it real (Tycho item 60). A
      // destructuring parameter contributes its LEAF names, which is what the
      // body actually references.
      const params = functionLiteralBoundNames(expr.ops.slice(1));
      return { bodies: expr.ops.slice(0, 1), real: [], shielded: params };
    }
    if (h !== 'Sum' && h !== 'Product' && h !== 'Loop' && h !== 'Comprehension')
      return null;

    const real: string[] = [];
    const shielded: string[] = [];
    for (const clause of expr.ops.slice(1)) {
      const isLimits = isFunction(clause, 'Limits');
      if (!isLimits && !isFunction(clause, 'Element')) continue;
      const ops = (clause as Expression & { ops: ReadonlyArray<Expression> })
        .ops;
      const name = ops[0];
      if (!isSymbol(name)) {
        // An `Element` clause may DESTRUCTURE its index (`for (p, q) in
        // pairs`): the clause binds the pattern's leaf names, and those are
        // what the body references, so shield them. They are never `real` —
        // a tuple component is not a numeric loop counter.
        if (!isLimits && isFunction(name, 'Tuple'))
          shielded.push(...tuplePatternNames(name));
        continue;
      }
      shielded.push(name.symbol);
      // A `Limits` index, or an `Element` index over a `Range`/`Linspace`, is
      // a numeric loop counter: real by construction. An `Element` index over
      // an arbitrary collection is left to type analysis.
      if (
        isLimits ||
        isFunction(ops[1], 'Range') ||
        isFunction(ops[1], 'Linspace')
      )
        real.push(name.symbol);
    }
    return { bodies: expr.ops.slice(0, 1), real, shielded };
  }

  /**
   * Run `fn` with a binder's bound names masked, so that a body analysis
   * inside it agrees with the analysis the binder's own callers see. Used both
   * by `isComplexValued` and by the `Sum`/`Product` emitter — if the emitter
   * decided a body was complex while a caller decided the binder was real, the
   * caller would consume a `{re, im}` object as a number (NaN everywhere).
   */
  private static withBinderMask<T>(
    binder: {
      real: ReadonlyArray<string>;
      shielded: ReadonlyArray<string>;
      /** Names bound COMPLEX for the duration (a complex-lane parameter). */
      complex?: ReadonlyArray<string>;
    },
    fn: () => T
  ): T {
    const frame = new Map<string, boolean>();
    for (const n of binder.real) frame.set(n, false);
    // A complex-lane name is a scalar complex object (the lane is granted
    // only for a provably scalar argument): record the SCALAR fact in the
    // vector frame as well, so a nested user call inside the analyzed body
    // grants the same lane the emitter will (`provablyScalarOrFramedScalar`).
    // The vector frame is pushed only when there is something to enter, so
    // every pre-existing mask leaves `_localVector` untouched.
    const vector = new Map<string, number>();
    for (const n of binder.complex ?? []) {
      frame.set(n, true);
      vector.set(n, BaseCompiler.LOCAL_SCALAR);
    }
    BaseCompiler._localComplex.push(frame);
    if (vector.size > 0) BaseCompiler._localVector.push(vector);
    BaseCompiler._binderShield.push(new Set(binder.shielded));
    BaseCompiler._pushComplexMemoLayer();
    try {
      return fn();
    } finally {
      BaseCompiler._binderShield.pop();
      if (vector.size > 0) BaseCompiler._localVector.pop();
      BaseCompiler._localComplex.pop();
      BaseCompiler._popComplexMemoLayer();
    }
  }

  /**
   * Determine at compile time whether an expression produces a complex value.
   *
   * Uses the expression's declared type (from operator signatures) when
   * available. Falls back to operand inspection for functions whose
   * return type is unknown.
   *
   * A symbol bound in the compile context (`_boundVarsCtx`, synced from
   * `target.boundVars` by `compile()` — a loop index, lambda parameter,
   * broadcast element) shadows any same-named engine symbol, so the
   * engine-value fallback below must not read through it (a loop counter
   * named `i` must not pick up the imaginary unit's value).
   */
  static isComplexValued(expr: Expression): boolean {
    if (isNumber(expr)) {
      // `~oo` is not complex-valued, even though the value carries an
      // infinite imaginary part: the non-finite typing convention
      // (ARCHITECTURE.md, "Non-finite typing convention for type handlers")
      // admits undirected infinity at the top type `number` only, and the
      // constant types that way. Reporting it complex would put the whole
      // enclosing expression on the complex lane on the strength of a pole,
      // so `1 + (-1)!` emitted a `{re, im}` object where the real lane wants
      // the pole's `NaN`.
      if (expr.isInfinity && expr.im !== 0) return false;
      return expr.im !== 0;
    }

    if (isSymbol(expr)) {
      if (expr.symbol === 'ImaginaryUnit') return true;
      // A `Block` local's complex-ness is inferred from its assigned RHS
      // (`w_1 ⩴ (x+iy)² + z_0; w_2 ⩴ w_1² + z_0`: the type system defaults
      // the local to real, but the emitter binds it to a complex object —
      // the analysis must agree or later statements consume the object as a
      // number; Tycho item 58). Innermost frame containing the name decides
      // (a shadowing inner local is not poisoned by an outer complex one).
      for (let i = BaseCompiler._localComplex.length - 1; i >= 0; i--) {
        const frame = BaseCompiler._localComplex[i];
        const known = frame.get(expr.symbol);
        if (known !== undefined) return known;
      }
      const t = expr.type;
      if (!t) return false;
      if (isNonRealNumber(t.type)) return true;
      if (t.matches('real')) return false;
      // The declared type is wide (`number`, `unknown`) — but the symbol may
      // carry an assigned complex VALUE, which `tryFoldKnownSymbol` folds as
      // a complex object literal. The operand analysis must agree with the
      // fold, or the target emits structurally wrong arithmetic
      // (`number + {re, im}` → NaN at every point; Tycho item 57). Does NOT
      // apply to compile-bound variables, which shadow the engine.
      if (BaseCompiler._boundVarsCtx?.has(expr.symbol))
        return BaseCompiler.wideIsComplex(t.type);
      // Same rule for a name bound by a binder form we are analyzing rather
      // than compiling (Tycho item 65).
      for (let i = BaseCompiler._binderShield.length - 1; i >= 0; i--)
        if (BaseCompiler._binderShield[i].has(expr.symbol))
          return BaseCompiler.wideIsComplex(t.type);
      const v = expr.engine._getSymbolValue(expr.symbol);
      if (v !== undefined) return BaseCompiler.isComplexValued(v);
      return BaseCompiler.wideIsComplex(t.type);
    }

    if (isFunction(expr)) {
      // Memoize FUNCTION answers only (Tycho item 148): symbols and numbers
      // are already O(1), and a function answer transitively embeds the
      // symbol/frame answers below it — which the TOTAL invalidation on every
      // context mutation covers. Without this the analysis is O(subtree) per
      // node and the whole compile O(n²) (a depth-6 nested chain spent 82% of
      // its GLSL compile inside 1.5M `isComplexValued` calls).
      //
      // Only inside a compilation: engine symbol VALUES (read by the symbol
      // arm's fallback) are stable while one compilation runs — compiles do
      // not assign — but not between compilations, and a boxed expression can
      // outlive the compile that first cached it.
      if (BaseCompiler._compileDepth === 0)
        return BaseCompiler._withFoldedRealOverride(
          expr,
          BaseCompiler._isComplexValuedFunction(expr)
        );
      const stack = BaseCompiler._complexMemoStack;
      const hit = stack[stack.length - 1].get(expr);
      if (hit !== undefined) return hit;
      const result = BaseCompiler._withFoldedRealOverride(
        expr,
        BaseCompiler._isComplexValuedFunction(expr)
      );
      // Store into the layer that is live NOW, not the one captured on entry:
      // a binder operand pushes a mask layer and pops it before returning, so
      // by here the context — and the top layer — are the ones this call
      // started with, and a binder node's own verdict lands in its ENCLOSING
      // layer where sibling and repeat queries can hit it.
      const after = BaseCompiler._complexMemoStack;
      after[after.length - 1].set(expr, result);
      return result;
    }

    return false;
  }

  /**
   * The FUNCTION arm of `isComplexValued`, split out so the public entry can
   * memoize it (Tycho item 148). Never call directly — the memo lives above.
   */
  private static _isComplexValuedFunction(
    expr: Expression & { ops: ReadonlyArray<Expression> }
  ): boolean {
    // A head that is real-shaped by definition answers `false` BEFORE any
    // type-based branch (Tycho item 147): `Imaginary` types bare `number`
    // (so the conservative operand recursion would report complex) and
    // `Real(±∞)` can type `non_finite_number` (so the `isNonRealNumber`
    // branch would too) — yet every target emits a real scalar for both.
    if (BaseCompiler.REAL_BY_DEFINITION_HEADS.has(expr.operator)) return false;
    // A head whose lowering is REAL-ONLY (`Floor`, `Mod`, `Max`, the
    // statistics family) yields a real value by construction: under the
    // complex discipline its maybe-complex operands take the D2/D6 runtime
    // rule (`realOperandGuard`: the real lowering, or `NaN`), and in strict
    // mode a complex operand fails closed — either way the emitted value is
    // never a `{re, im}` object, so a wide RESULT type (`Max(a, b)` over
    // wide `a`, `b`) must not report complex.
    if (BaseCompiler.REAL_ONLY_CODEGEN_HEADS.has(expr.operator)) return false;
    // Same rule for a head the CURRENT compilation's target lowers through a
    // real-only string helper (`Erf`, `Gamma`, `Zeta`, …): the emitted value
    // is real by construction — the D2/D6 runtime rule around a maybe-complex
    // operand yields the helper's real result or `NaN`, never `{re, im}` —
    // while the wide result type of several such heads would send the
    // analysis into the operand recursion and report complex. See
    // `_realOnlyHelperLookup` for the measured disagreement.
    if (BaseCompiler.isRealOnlyHelperHead(expr.operator)) return false;
    // A `Sum`/`Product` over a COLLECTION (no indexing set) folds either with
    // the raw real operator or with the shape-agnostic combiner wrapped in
    // the complex lift (`collectionFoldsReal`); its value is complex-shaped
    // exactly when the latter is emitted.
    if (
      (expr.operator === 'Sum' || expr.operator === 'Product') &&
      expr.ops.length === 1 &&
      (expr.ops[0].isCollection || expr.ops[0].type.matches('collection<any>'))
    )
      return !BaseCompiler.collectionFoldsReal(expr.ops[0]);
    // A SELECTION answers from its value ARMS, never from the node's type:
    // the emitters coerce every arm to `{re, im}` as soon as one arm is
    // complex-valued (`branchComplexCoercion`, Tycho item 60), so the value
    // the parent receives is complex-shaped whenever an arm is — even when
    // the type system joined the arms to a real type (`Which(c, a, True, 5)`
    // over a wide `a` types `finite_integer`; under the complex discipline
    // `a` is complex-shaped and both arms are lifted, and a parent reading
    // the node's type would consume the object as a number).
    if (expr.operator === 'If')
      return expr.ops.slice(1).some((a) => BaseCompiler.isComplexValued(a));
    if (expr.operator === 'Which')
      return expr.ops.some(
        (a, i) => i % 2 === 1 && BaseCompiler.isComplexValued(a)
      );
    // An indexed read answers for the ELEMENT it selects, not for the whole
    // collection: a list is emitted element by element, so its run-time array is
    // heterogeneous and the generic `ops.some(…)` recursion at the bottom of
    // this function describes none of its elements. See
    // `isComplexValuedElementAt`, which answers `undefined` — and so leaves the
    // previous behavior in place — whenever the selected element cannot be
    // identified statically (a computed index, a non-literal collection).
    if (expr.operator === 'At' && expr.ops.length === 2) {
      const index = expr.ops[1];
      // A COMPLEX index selects no element — it is not a position at all — so
      // this arm has nothing to say about such a node and must leave it to the
      // generic operand recursion below, which reports it complex from the
      // index. Answering from the elements instead reported a list of real
      // elements as real, and `At(List(10, 20, 30), Complex(1, 2))` then folded
      // to `10` instead of staying `_SYS.at([10, 20, 30], {re: 1, im: 2})`
      // (pinned in `compile-subtree-folding.test.ts`).
      if (
        !BaseCompiler.isComplexValued(index) &&
        !BaseCompiler.isGatherIndex(index)
      ) {
        // A literal index names one element; a run-time index names none, but
        // when every element agrees the answer is the same either way.
        const viaElement = isNumber(index)
          ? BaseCompiler.isComplexValuedElementAt(expr.ops[0], index.re)
          : BaseCompiler.uniformElementComplexness(expr.ops[0]);
        if (viaElement !== undefined) return viaElement;
      }
    }
    // The `complexPromotion` opt-in is answered BEFORE the type branches
    // below, because the types it has to override are the WIDE ones: an
    // unknown-sign `√(t−1)` types `finite_number`, which is neither non-real
    // (so the `isNonRealNumber` arm never fires) nor `real`. See
    // `promotesRadicalToComplex`.
    // A fold's value is its ACCUMULATOR lane (`combinerPlan`): the parent
    // must agree with what the emitted `reduce` hands back, or `Reduce(L, h,
    // 0) + 1` adds a number to the `{re, im}` the fold produced (`"[object
    // Object]1"`). A `Scan`'s elements are all in that lane, so the
    // whole-list verdict is the same answer. A builtin combiner (`Add`, …)
    // folds in the elements' lane, widened by a complex seed.
    if (
      (expr.operator === 'Reduce' || expr.operator === 'Scan') &&
      expr.ops.length >= 2
    ) {
      const [coll, op, init] = expr.ops;
      const plan = BaseCompiler.combinerPlan(coll, op, init);
      if (plan !== undefined) return plan.accComplex;
      if (isSymbol(op) && BaseCompiler.BUILTIN_FOLD_HEADS.has(op.symbol))
        return BaseCompiler.foldLaneIsComplex(coll, init);
    }
    if (BaseCompiler.promotionActive) {
      if (BaseCompiler.promotesRadicalToComplex(expr.operator, expr.ops))
        return true;
    }
    // A call to a user function follows its BODY, analyzed with the
    // parameters bound to the call site's complex lanes. Under the opt-in
    // this is where the promotion above actually happens (item 190's witness
    // puts the radical inside `z(t) := √(t−1)`); on the DEFAULT path the
    // look-through answers only when some lane IS complex (it declines
    // otherwise, see `isComplexValuedUserCall`), because that is the one case
    // where the emitted definition is a lane specialization whose result
    // shape the type-based answer below does not describe (`b(x) := 2x`
    // called on a declared-complex `w`). Every other default-path call keeps
    // its previous answer; a non-user-function head costs a definition
    // lookup here and nothing more.
    {
      const viaBody = BaseCompiler.isComplexValuedUserCall(
        expr,
        BaseCompiler._userCallVisited
      );
      if (viaBody !== undefined) return viaBody;
    }
    // Check the function's return type from its operator definition
    const t = expr.type;
    if (isNonRealNumber(t.type)) {
      // Sqrt/Ln/Log carve-out (2026-07-31): their type handlers now widen
      // to `finite_complex`/`complex` for a real operand of UNKNOWN sign
      // (type soundness: `√−2 = 1.414…i`), but the pinned compile contract
      // keeps the real kernel for that case — these are the hottest plotted
      // heads, and `Math.sqrt(-2)`/`sqrt(r)` yield a real-shaped `NaN` at
      // run time. Only a provably negative or provably complex operand
      // routes complex. The heads' own emitters use the same predicate
      // (`resultIsComplexValued(head, args) && a provably negative
      // operand`), so parent and child always agree on the value SHAPE —
      // the invariant that matters for compiled correctness.
      if (
        expr.operator === 'Sqrt' ||
        expr.operator === 'Ln' ||
        expr.operator === 'Log'
      ) {
        // The `complexPromotion` opt-in is NOT re-checked here: the gate at
        // the top of this function already answered `true` for every promoted
        // case, so reaching this line under the opt-in means
        // `promotesRadicalToComplex` declined — every operand is provably
        // non-negative — and the emitters' `promotesToComplexLane` will
        // decline identically. Returning `true` here would therefore report
        // complex over an emitter still producing `Math.sqrt`, which is the
        // shape disagreement this whole predicate exists to prevent.
        return expr.ops.some(
          (a) => a.isNegative === true || BaseCompiler.isComplexValued(a)
        );
      }
      // …and the carve-out has to survive the arithmetic ABOVE those heads
      // (Tycho item 144): `Multiply(1e5, Sqrt(u))` is itself typed
      // `finite_complex`, so answering from the type here would report
      // complex for a subtree the Sqrt carve-out just declared real, and the
      // real-only-helper gate would fail closed on an operand that is real by
      // construction. These heads only PROPAGATE complexness from their
      // operands — and every target's emitter for them picks its
      // real-vs-complex lowering from the OPERANDS with this same predicate
      // (`args.some(isComplexValued)`), never from the node's type — so
      // recursing keeps parent and child agreeing on the value SHAPE. Heads
      // whose emitter reads the node TYPE instead (`Power`, `Root`, the
      // inverse trigs — see `resultIsComplexValued`) must NOT be listed here.
      if (BaseCompiler.COMPLEX_PROPAGATING_HEADS.has(expr.operator))
        return expr.ops.some((a) => BaseCompiler.isComplexValued(a));
      return true;
    }
    if (t.matches('real')) return false;
    // A boolean or string value is never complex-valued, whatever its
    // operands are. Without this, a predicate over a complex-typed operand
    // (`Less(Sin(1e5·√u), 0)`) fell through to the conservative operand
    // recursion below and reported complex — poisoning every enclosing form
    // (a `Which` condition is not even a value position). Wide types
    // (`number`, `unknown`) still take the recursion.
    if (t.matches('boolean') || t.matches('string')) return false;

    // Return type is unknown — fall back to checking whether any
    // operand is complex (conservative: assumes function propagates
    // complex-ness from its inputs). A binder form contributes only its
    // body, analyzed with its bound names masked (see `binderParts`).
    const binder = BaseCompiler.binderParts(expr);
    if (binder)
      return BaseCompiler.withBinderMask(binder, () =>
        binder.bodies.some((b) => BaseCompiler.isComplexValued(b))
      );

    // A `Block`'s value is its LAST statement, not any of them: an interior
    // statement that binds a complex LOCAL says nothing about the value the
    // block produces. Under the conservative recursion it did — a body such as
    // `{ s ⩴ 0; z ⩴ t + i; s ⩴ s + |z|; s }` reported complex even though it
    // yields the real `s`, and the GPU user-function emission (whose return
    // type is `gpuTypeOfValue` of the body) declared `vec2 _fn_a(float t)`
    // around a `return s;` — source no driver accepts, behind
    // `success: true`.
    if (expr.operator === 'Block')
      return BaseCompiler.isBlockValueComplexValued(expr);

    if (expr.ops.some((arg) => BaseCompiler.isComplexValued(arg))) return true;
    // COMPLEX discipline: a wide-typed result whose operands are all real can
    // still be a complex value at run time (a user function returning its
    // parameter, an element read of a `list<number>`), and the value it
    // yields is lifted at the parent's use (`complexDiscipline`).
    return BaseCompiler.wideIsComplex(t.type);
  }

  /**
   * Is the VALUE of the `Block` `expr` complex-valued?
   *
   * A block's value is its last statement, evaluated under its own locals —
   * so the locals' complex-ness has to be inferred first, exactly as
   * `compileBlock` infers it before compiling the statements (`{ z ⩴ t + i;
   * z² }` is complex through the local `z`, whose declared type is real). The
   * set of locals mirrors `withImplicitLocalDeclares`: the explicit `Declare`s
   * plus the bare assignments `canonicalBlock` hoisted into the block's OWN
   * scope. A name the enclosing compilation already binds is NOT a local of
   * this block, so it keeps whatever the enclosing analysis says.
   */
  private static isBlockValueComplexValued(
    expr: Expression & { ops: ReadonlyArray<Expression> }
  ): boolean {
    const args = expr.ops;
    if (args.length === 0) return false;

    const frame = new Map<string, boolean>();
    for (const arg of args)
      if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0]))
        frame.set(arg.ops[0].symbol, BaseCompiler.localComplexDefault());
    const scope = expr.localScope;
    if (scope)
      for (const arg of args)
        if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
          const name = arg.ops[0].symbol;
          if (
            !frame.has(name) &&
            scope.bindings.has(name) &&
            !BaseCompiler._boundVarsCtx?.has(name)
          )
            frame.set(name, BaseCompiler.localComplexDefault());
        }

    BaseCompiler._pushLocalComplex(frame);
    try {
      for (const arg of args) BaseCompiler.noteLocalComplex(arg, frame);
      // The value statement, skipping the `Nothing` no-ops `compileBlock`
      // filters out. A trailing `Assign` yields the value it wrote; a trailing
      // `Declare` yields no value at all.
      let i = args.length - 1;
      while (i >= 0 && isSymbol(args[i], 'Nothing')) i -= 1;
      if (i < 0) return false;
      const last = args[i];
      if (isFunction(last, 'Declare')) return false;
      const value = isFunction(last, 'Assign') ? last.ops[1] : last;
      return value !== undefined && BaseCompiler.isComplexValued(value);
    } finally {
      BaseCompiler._popLocalComplex();
    }
  }

  /**
   * Lexical frames of `Block` locals, innermost last, each mapping a local's
   * name to its inferred aggregate width. The vector analog of
   * `_localComplex`: pushed and popped by `compileBlock`, consulted by
   * `aggregateComponentCount` so a local that merely ALIASES a vector-valued
   * local (`q ⩴ p`) is recognized as vector-valued too. Innermost frame
   * containing the name decides, so a shadowing inner local is not poisoned by
   * an outer vector one.
   *
   * A NON-NEGATIVE entry is an observed component count. The "not an
   * aggregate" cases use negative sentinels rather than `0`, because `0` is a
   * genuine — and invalid — observed width (an empty `Tuple`/`List`); reading
   * it back as "scalar" left the local declared `float` while its assignment
   * compiled to `float[0]()`.
   */
  private static _localVector: Map<string, number>[] = [];

  /** `_localVector`: declared, but no binding seen yet. */
  private static readonly LOCAL_UNSET = -2;

  /** `_localVector`: every binding seen so far was a scalar. */
  static readonly LOCAL_SCALAR = -1;

  /**
   * `_localVector`: the name holds a BOOLEAN, not a number.
   *
   * The frame's third channel (alongside "aggregate of width n" and
   * "scalar"): a shader `bool` is not an aggregate — so
   * `aggregateComponentCount` reads it back as "not an aggregate", like every
   * other negative sentinel — but it is not a float either, and a declared
   * `bool` name carries its boolean-ness NOWHERE else (a bare `b` is an
   * undeclared engine symbol, whose `type` is `unknown` = shader scalar).
   * Without this channel a `bool` argument flowed into a synthesized `float`
   * parameter behind a reported success.
   */
  static readonly LOCAL_BOOLEAN = -3;

  /**
   * `_localVector`: declared with a type whose SHAPE this analysis cannot
   * express — a matrix, an array, a struct, a target-specific alias.
   *
   * Reads back as "not an aggregate" like every other negative sentinel, which
   * is also what an UNFRAMED name answers; what the entry adds is the record
   * that the name IS declared. That is what lets a target consult its own
   * per-frame channel (the GPU targets carry the caller-declared shader TYPE,
   * which a width cannot express) and fail closed on it, instead of letting
   * the name pass for the untyped default.
   */
  static readonly LOCAL_UNSHAPED = -4;

  /**
   * The innermost local shape frame that mentions `name`, or `undefined`.
   *
   * The frame IDENTITY, for a target that keeps a parallel per-frame channel
   * of its own. Returning the frame rather than its entry gives that channel
   * the same innermost-frame-wins shadowing for free: a `Block` local
   * shadowing a declared parameter answers with the BLOCK's frame, which
   * carries no declared type.
   */
  static localShapeFrameOf(
    name: string
  ): ReadonlyMap<string, number> | undefined {
    for (let i = BaseCompiler._localVector.length - 1; i >= 0; i--)
      if (BaseCompiler._localVector[i].has(name))
        return BaseCompiler._localVector[i];
    return undefined;
  }

  /**
   * Is `name` framed as a boolean by the innermost local shape frame that
   * mentions it?
   *
   * Innermost-frame-wins, like every other frame query: a `Block` local
   * shadowing a `bool` parameter enters its own (non-boolean) entry and so
   * answers `false`.
   */
  static isLocalBoolean(name: string): boolean {
    for (let i = BaseCompiler._localVector.length - 1; i >= 0; i--) {
      const known = BaseCompiler._localVector[i].get(name);
      if (known !== undefined) return known === BaseCompiler.LOCAL_BOOLEAN;
    }
    return false;
  }

  /**
   * Run `fn` with an extra lexical frame of inferred local SHAPES — the
   * mechanism `compileBlock` uses for its own locals (`_localComplex` /
   * `_localVector`), exposed for the other binding forms that must declare a
   * static type for a name they bind.
   *
   * Its user is the GPU user-function emission: a parameter's lowering comes
   * from the DECLARED signature (`f: (complex) -> complex` ⇒ `vec2`), which is
   * not carried by the parameter symbol's own type, so without a frame the
   * body analysis would disagree with the declaration the emitter just wrote.
   * Entering EVERY parameter (scalars as `LOCAL_SCALAR`) also shields them
   * from `isComplexValued`'s engine-value fallback, the same way a `Block`
   * local is shielded.
   *
   * Compilation is synchronous, so a static stack is safe (see
   * `_localComplex`).
   *
   * `isolate` replaces the enclosing frames instead of stacking on them, for a
   * body that is NOT lexically nested in them — a user-function definition is
   * emitted at module level, so when one definition's body triggers the
   * emission of another, the callee's body must not see the caller's parameter
   * shapes (a same-named global would take the caller's width).
   */
  static withLocalShapeFrame<T>(
    complex: Map<string, boolean>,
    vector: Map<string, number>,
    fn: () => T,
    isolate = false
  ): T {
    const savedComplex = BaseCompiler._localComplex;
    const savedVector = BaseCompiler._localVector;
    if (isolate) {
      BaseCompiler._localComplex = [];
      BaseCompiler._localVector = [];
    }
    BaseCompiler._localComplex.push(complex);
    BaseCompiler._localVector.push(vector);
    // One layer per entry, isolated or not: during the frame only the fresh
    // top layer is consulted (so an isolated body cannot reuse caller-context
    // answers), and the exit below restores the enclosing frames exactly, so
    // popping back to the enclosing layer is sound.
    BaseCompiler._pushComplexMemoLayer();
    try {
      return fn();
    } finally {
      BaseCompiler._localVector = savedVector;
      BaseCompiler._localComplex = savedComplex;
      if (!isolate) {
        BaseCompiler._localVector.pop();
        BaseCompiler._localComplex.pop();
      }
      BaseCompiler._popComplexMemoLayer();
    }
  }

  /**
   * Number of components a value expression occupies when lowered on a GPU
   * target, for ANY aggregate width (`0`, `1`, `5`, …), or `undefined` for a
   * scalar.
   *
   * Structural for `Tuple`/`List` literals, type-based for typed operands
   * (`tuple<…>`, a 1-axis `list`), 2 for a complex value (lowered as
   * `vec2(re, im)`), and frame-based for a `Block` local.
   *
   * Distinct from `vectorComponentCount`, which answers the narrower question
   * "does this have a `vec2`/`vec3`/`vec4` lowering?". Callers that must
   * decide *whether a value is an aggregate at all* — the fail-closed
   * constructor guard, the block-local type hint — need THIS one: a 1- or
   * 5-element tuple is still an aggregate even though no `vecN` fits it.
   */
  static aggregateComponentCount(expr: Expression | null): number | undefined {
    if (expr === null) return undefined;
    if (isFunction(expr, 'Tuple') || isFunction(expr, 'List')) return expr.nops;
    if (BaseCompiler.isComplexValued(expr)) return 2;
    if (isSymbol(expr)) {
      for (let i = BaseCompiler._localVector.length - 1; i >= 0; i--) {
        const known = BaseCompiler._localVector[i].get(expr.symbol);
        // Negative entries are the "no aggregate binding" sentinels (see
        // `_localVector`); a width of `0` is a real — invalid — zero-width
        // aggregate and must NOT read back as "scalar".
        if (known !== undefined) return known < 0 ? undefined : known;
      }
    }
    const t = compilationType(expr);
    if (typeof t !== 'string') {
      if (t.kind === 'tuple') return t.elements.length;
      if (t.kind === 'list' && t.dimensions?.length === 1)
        return t.dimensions[0];
    }
    return undefined;
  }

  /**
   * Whether `expr` is provably NOT a shader scalar — it lowers to a `vecN`, an
   * array, or a `matN`/tensor.
   *
   * Broader than `aggregateComponentCount`, which reports a single component
   * COUNT and so has nothing to say about a value with no one-dimensional
   * shape: a `Matrix` (or any multi-axis / unsized `list` type) lowers to
   * `mat2(…)` / an array, but "how many components" is not a well-posed
   * question for it. Reporting `undefined` for those made every caller that
   * uses `undefined` to mean "scalar" treat a matrix as a scalar — which let
   * `Tuple(Matrix(…), 1)` emit `vec2(mat2(…), 1.0)`, source no shader compiler
   * accepts.
   *
   * Callers that must decide "is this a scalar?" (the fail-closed constructor
   * guard, the block-local declaration) need THIS predicate; callers that need
   * a width (`vectorComponentCount`, the `vecN` type hint) still need the
   * count, and are deliberately left unchanged.
   */
  static isNonScalarShape(expr: Expression | null): boolean {
    if (expr === null) return false;
    if (BaseCompiler.aggregateComponentCount(expr) !== undefined) return true;
    if (isFunction(expr, 'Matrix')) return true;
    const t = compilationType(expr);
    // A `list` type that `aggregateComponentCount` declined to size: either
    // multi-axis (a matrix/tensor) or of unknown length. Non-scalar either way.
    if (typeof t !== 'string' && t.kind === 'list') return true;
    return false;
  }

  /**
   * Number of vector components a value expression occupies on a GPU target
   * (2–4), or `undefined` for a scalar (or a shape with no vector lowering).
   *
   * Structural for `Tuple`/`List` literals (the parametric-body shape
   * `(x(t), y(t))` → `vec2`), type-based for typed operands (`tuple<…>`, a
   * 1-axis `list`), and 2 for a complex value (lowered as `vec2(re, im)`).
   */
  static vectorComponentCount(expr: Expression | null): 2 | 3 | 4 | undefined {
    const n = BaseCompiler.aggregateComponentCount(expr);
    return n !== undefined && n >= 2 && n <= 4 ? (n as 2 | 3 | 4) : undefined;
  }

  /**
   * On the plain JavaScript target a complex value is a `{ re, im }` object
   * and a real value a plain number — two incompatible runtime conventions. A
   * branch form (`If`/`Which`/`When`) whose value arms mix the two hands
   * consumers a value whose slots are sometimes missing (`(0).re` →
   * `undefined` → NaN at every point — Tycho item 60: a constant base-case
   * arm under a complex-ascribed recursive function). When any value arm is
   * complex-valued, coerce every real arm to the complex convention, so the
   * branch produces the ONE convention `isComplexValued` reports to consumers
   * (its operand fallback sees the complex arm).
   *
   * Returns `undefined` when no coercion applies — an all-real branch, or a
   * target with its own complex representation (Python's native `complex`
   * mixes freely with floats; GPU targets fail closed on complex earlier) —
   * and arms are then emitted unchanged.
   */
  private static branchComplexCoercion(
    values: ReadonlyArray<Expression | undefined>,
    target: CompileTarget<Expression>
  ):
    | ((val: Expression | undefined, code: TargetSource) => TargetSource)
    | undefined {
    if (target.language !== 'javascript') return undefined;
    if (!values.some((v) => v !== undefined && BaseCompiler.isComplexValued(v)))
      return undefined;
    // Statically wrap ONLY provably-real arms. A wide-typed arm (`number`,
    // `unknown` — e.g. a pass-through parameter `z` in
    // `Which(n ≤ 0, z, True, K(n-1,z)²+c)` whose declared slot is `number`)
    // may hold a complex object at run time; wrapping it would nest the
    // object (`{ re: { re, im }, im: 0 }`).
    //
    // An arm that is neither provably real NOR complex-shaped
    // (`isComplexValued === false`) emits a plain number by the shape
    // invariant, but the static PROOF can be out of reach — a radical over a
    // radicand with free variables (`√(1 − 0.04r)`), or a closed constant the
    // fold's gates decline (`symbolDeps`, the cost ceiling, the evaluation
    // budget). Left bare, the branch's slot-reading consumers NaN-poison on
    // it (`_SYS.cabs(Math.sqrt(…))` read `.re` off a number and answered 0);
    // the idempotent runtime test `_SYS.cplx` settles it instead — a number
    // is lifted, an object passes through, so it is also the safe answer for
    // a wide arm actually holding an object. Only an arm the shape analysis
    // calls complex-valued stays bare: its emitted value is already in the
    // complex convention (or the discipline's consumers runtime-test it).
    return (val, code) => {
      if (val === undefined || BaseCompiler.isProvablyRealValued(val, target))
        return `({ re: ${code}, im: 0 })`;
      if (!BaseCompiler.isComplexValued(val)) return `_SYS.cplx(${code})`;
      return code;
    };
  }

  /**
   * True when the expression PROVABLY produces a plain real number at run
   * time on the JavaScript target — never the `{ re, im }` complex-object
   * convention. Callers wrap a provably-real value in that convention
   * statically; anything else must be left untouched (or routed through the
   * idempotent `_SYS.cplx` runtime test), because wrapping an object nests it
   * (`{ re: { re, im }, im: 0 }`) and every slot read off the nest is NaN.
   *
   * Three sources answer, in order:
   *
   * 1. The SHAPE analysis (`isComplexValued`), which overrides the static
   *    type: under the complex discipline a promoted radical — `√(1−0.2²)`,
   *    promoted for its unknown-sign radicand — is emitted as `_SYS.csqrt`,
   *    a `{ re, im }` object, whatever its static type says. Answering from
   *    the type alone wrapped that object a second time.
   * 2. The static type: a subtype of `real` is a plain number. Wide types
   *    (`number`, `unknown`) are NOT provably real — they may carry a
   *    `{ re, im }` object at run time (a pass-through parameter, a call to
   *    a function declared `-> complex` returning a real value).
   * 3. The constant FOLD (`constantFoldValue`, when the caller can supply
   *    its target): a closed pure constant subtree that evaluates to a real
   *    number is real-emitted — as the folded literal itself, or, where the
   *    emission declines (`constantFold: false`), through the real lowering
   *    that the step-1 `isComplexValued === false` verdict guarantees. This
   *    is what keeps `√(1 − 0.2²)` — statically the `finite_complex` hedge,
   *    machine floats being unfolded at canonicalization — recognized as the
   *    plain number it evaluates to.
   */
  private static isProvablyRealValued(
    expr: Expression,
    target?: CompileTarget<Expression>
  ): boolean {
    if (isNumber(expr)) return expr.im === 0;
    if (BaseCompiler.isComplexValued(expr)) return false;
    if (expr.type.matches('real')) return true;
    if (target !== undefined) {
      const v = BaseCompiler.constantFoldValue(expr, target)?.value;
      if (v !== undefined && isNumber(v) && v.im === 0) return true;
    }
    return false;
  }

  /**
   * Fail-closed guard (D6) for the INDEXED big-op form (`Sum`/`Product` with a
   * body plus an indexing set). A collection-valued body (`Σ h(i)·a(…)` where
   * `a` returns a vector — the interpreter's zip-broadcast elementwise Sum) has
   * no scalar accumulation: the emitters would produce `acc + <array>` (NaN,
   * string concatenation, or a dangling array), a silently WRONG value. Throw
   * until an element-wise accumulation arm exists; consumers can distribute the
   * element access through the big op (`At(Σ…, k)` → `Σ At(…, k)`), which
   * compiles as a scalar loop.
   *
   * Call this ONLY on the indexed form's body, never on the no-index
   * collection-reduce form (`Sum(collection)`), whose body is legitimately a
   * collection.
   *
   * The same argument applies to a body that is provably NOT a number at all —
   * a `string`, a `record`/`dictionary`, a function value (Tycho item 121).
   * `Add`/`Multiply` reject such an operand at BOX time (canonicalization
   * replaces it with an `Error(incompatible-type)` node, and
   * `BaseCompiler.compile`'s `isValid` guard then declines), but a big-op body
   * stays raw, so nothing re-ran that check before the emitters wrote a bare
   * `+`/`*` over it: `Σ_{i=0}^{2} "ab"` compiled to `("ab") + ("ab") + ("ab")`
   * and RAN to `"ababab"` behind `success: true` — including under
   * a caller reading the result as a number. Declining
   * is what the callers want (they fall back to expansion / the interpreter).
   */
  static assertScalarBigOpBody(kind: string, body: Expression): void {
    if (
      body.type.matches('list<any>') ||
      body.type.matches('indexed_collection<any>')
    )
      throw new Error(
        `${kind}: a collection-valued body does not compile — distribute the ` +
          `element access through the ${kind} (At(${kind}(…), k) → ` +
          `${kind}(At(…, k))) or evaluate instead. Fail closed (D6).`
      );
    if (BaseCompiler.isProvablyNonNumericBigOpBody(body))
      throw new Error(
        `${kind}: a body of type '${body.type.toString()}' does not compile — ` +
          `the accumulation is numeric (a bare '+'/'*'), which for a ` +
          `non-numeric body silently produces a string or an object rather ` +
          `than a number. Fail closed (D6) — evaluate it instead.`
      );
    if (BaseCompiler.isCollectionValuedBigOpBodyByLookThrough(body))
      throw new Error(
        `${kind}: a collection-valued body does not compile — '${
          isFunction(body) ? body.operator : body.toString()
        }' is declared with an open result type ` +
          `('${body.type.toString()}') but its body constructs a collection. ` +
          `Distribute the element access through the ${kind} ` +
          `(At(${kind}(…), k) → ${kind}(At(…, k))) or evaluate instead. ` +
          `Fail closed (D6).`
      );
    if (BaseCompiler.isContradictedScalarDeclaration(body))
      throw new Error(
        `${kind}: the declaration of '${
          isFunction(body) ? body.operator : body.toString()
        }' says it returns a scalar ` +
          `('${body.type.toString()}'), but its body constructs a collection. ` +
          `The declaration is contradicted by the body, so the numeric ` +
          `accumulation would produce a wrong value. Fix the declaration ` +
          `(e.g. '-> list<number>') or evaluate instead. Fail closed (D6).`
      );
  }

  /**
   * Wall-clock budget for one `Integrate` node's antiderivative-first attempt.
   *
   * The attempt is an **optimization** — every integral it declines still
   * compiles, via the caller's numeric emitter (quadrature on the JavaScript
   * target, a rigorous enclosure on the interval target) — so it must never be
   * able to stall a compilation. Compilation establishes no deadline of its
   * own, and since `ce.timeLimit` was retired (`docs/TIMEOUT-MODEL.md` §5) work
   * outside a span runs unbounded: relying on "the enclosing span, if any"
   * meant the default (no span) case could spin forever. So the attempt arms
   * its own span.
   *
   * Per §3.4 nesting is `min()`, so an enclosing consumer span that is tighter
   * still preempts this budget — this can only shorten, never extend, a
   * caller's bound.
   *
   * Sized against the slowest symbolic resolution in the compile-integrate
   * suite (~200 ms on a warm engine), with ~10× headroom for slow CI, so no
   * integral that legitimately closes is pushed onto the numeric path.
   */
  private static readonly ANTIDERIVATIVE_ATTEMPT_BUDGET_MS = 2000;

  /**
   * Shared wall-clock budget for ALL antiderivative-first attempts in one
   * outermost compilation.
   *
   * The per-node budget above bounds one attempt, but an emission can carry
   * hundreds of `Integrate` nodes — a macro-expanded consumer document
   * produced 728 in one expression (Tycho item 226) — and a fresh 2 s span
   * per node lets the aggregate reach nodes × 2 s before the numeric
   * fallback. Since the attempt is purely an optimization, the attempts
   * share this pool: each consumes the wall-clock it actually spends, and
   * once the pool is dry every remaining integral in the compilation skips
   * straight to its numeric emitter. Sized for a handful of hard (≈200 ms)
   * legitimate resolutions plus dozens of ordinary (≈ms) ones.
   *
   * Reset at each DEPTH-0 entry of `BaseCompiler.compile` — the boundary
   * every route crosses: `compileRoot` (raw custom targets),
   * `compileCseRoot` (registered targets invoked directly), the public
   * `compile()` entry, and each attempt of an auto-mode escalation. Nested
   * compilations consume the outer pool rather than getting a fresh one, so
   * the aggregate is bounded by one pool per depth-0 entry. A caller that
   * deliberately issues several root compilations against one target — a
   * multi-statement shader body compiles each statement separately
   * (`compileShaderBody`) — therefore gets one pool per statement, which
   * keeps each statement's compile time bounded exactly as one expression's
   * is.
   */
  private static readonly ANTIDERIVATIVE_COMPILATION_BUDGET_MS = 4000;

  /** Remaining shared antiderivative budget for the current compilation —
   *  see {@link ANTIDERIVATIVE_COMPILATION_BUDGET_MS}. Module state is safe:
   *  compilation is synchronous and single-threaded. */
  private static antiderivativeBudgetLeftMs =
    BaseCompiler.ANTIDERIVATIVE_COMPILATION_BUDGET_MS;

  /**
   * Start a fresh compilation's shared budgets — today just the
   * antiderivative pool. Called from ONE place: the depth-0 boundary of
   * `BaseCompiler.compile`, which every compilation route crosses (see
   * {@link ANTIDERIVATIVE_COMPILATION_BUDGET_MS} for why no shallower entry
   * covers them all).
   */
  static resetSharedCompilationBudgets(): void {
    BaseCompiler.antiderivativeBudgetLeftMs =
      BaseCompiler.ANTIDERIVATIVE_COMPILATION_BUDGET_MS;
  }

  /**
   * Whether any operand of the integral references a `vars`-mapped symbol — one
   * the caller pinned to a runtime input. Such a symbol must not be folded, so
   * the antiderivative-first path is skipped when the integral touches one.
   */
  private static referencesVarsSymbol(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): boolean {
    const keys = target.varsKeys;
    if (!keys || keys.size === 0) return false;
    for (const k of keys) if (args.some((a) => a.has(k))) return true;
    return false;
  }

  /**
   * The integrand of `Integrate(f, limit₁, …, limitₙ)` as a body in the
   * limits' index variables, with the lambda variable to bind for each limit
   * — `{ lambdaVars, bodyExpr }` — or a thrown decline (D6).
   *
   * A bare integrand is already a body in the limits' index variables. A
   * `Function(body, …params)` integrand is unwrapped to its body, and its
   * parameters are matched to the limits BY NAME, as the interpreter does
   * (`nIntegrateMultiple` in `library/calculus.ts`): every limit's index
   * variable must name exactly one parameter and no parameter may be left
   * over. Pairing them by POSITION instead — the lambda for limit d named
   * after parameter d — bound `Function(a·x·y², y, x)` under the limits
   * `(x, 0, 1), (y, 0, 2)` with `y` over x's range, computing ∫∫ a·y·x² in
   * place of ∫∫ a·x·y²; and a spare parameter (`Function(x + q, x, q)` under
   * one limit) compiled `q` as an ambient `vars` read the integral never
   * supplies, where the interpreter declines. A destructuring parameter, and
   * any parameter with no readable name, decline as well: dropping the
   * wrapper would compile the body's references to what they bind as reads
   * of the enclosing scope.
   *
   * `lambdaVars[d]` is limit d's index variable — after the check, the
   * parameter it binds — so the caller nests one lambda per limit in limit
   * order.
   */
  static integrandLambda(
    integrand: Expression,
    limitIndices: ReadonlyArray<string>
  ): { lambdaVars: string[]; bodyExpr: Expression } {
    const lambdaVars = [...limitIndices];
    if (!isFunction(integrand, 'Function'))
      return { lambdaVars, bodyExpr: integrand };
    const params = integrand.ops.slice(1);
    BaseCompiler.assertNoDestructuringParams(params);
    const names = params.map((p) => functionLiteralParameterName(p));
    // `functionLiteralParameterName` returns `''` — never `undefined` — for a
    // parameter operand that is not a name.
    const unreadable = params.find((_p, i) => names[i] === '');
    if (unreadable !== undefined)
      throw new Error(
        `Integrate: cannot compile an integrand whose parameter ` +
          `"${unreadable.toString()}" has no readable name — the body's ` +
          `references to what it binds would compile as references to the ` +
          `enclosing scope. Fail closed (D6). Use a named parameter, or an ` +
          `integrand expressed directly in the limits' index variables.`
      );
    const oneToOne =
      names.length === limitIndices.length &&
      new Set(names).size === names.length &&
      limitIndices.every((v) => names.includes(v));
    if (!oneToOne)
      throw new Error(
        `Integrate: cannot compile — the integrand's parameters ` +
          `(${names.join(', ') || 'none'}) do not match the integration ` +
          `variables (${limitIndices.join(', ') || 'none'}) one to one. The ` +
          `interpreter declines such an integral, and pairing them by ` +
          `position would bind a parameter to the wrong range. Fail closed (D6).`
      );
    return { lambdaVars, bodyExpr: integrand.ops[0] };
  }

  /**
   * The closed form of `Integrate(f, (x, a, b))`, or `undefined` when the
   * integral does not resolve symbolically and the caller must emit its own
   * numeric integration.
   *
   * **Antiderivative-first.** The integral is resolved symbolically via
   * `evaluate()` (the provider/Rubi + built-in antiderivative + FTC). If it
   * closes to a form free of any residual `Integrate` — e.g. a plotted
   * `∫₀ˣ f(t) dt` whose closed form is a function of the free bound `x` — that
   * straight-line expression is returned, so each sample costs ~µs instead of a
   * full numeric integration. The symbolic attempt runs under its own
   * {@link ANTIDERIVATIVE_ATTEMPT_BUDGET_MS} span (tightened further by an
   * enclosing span, never extended), so a non-elementary integrand degrades to
   * the caller's numeric emitter rather than hanging. Skipped when the integral
   * references a `vars`-mapped symbol, which must survive to run time as a live
   * input (the vars contract) rather than be folded into a baked closed form.
   *
   * The returned expression is accepted only when it is valid, free of any
   * residual `Integrate`, and not NaN — but it can still contain a head the
   * CALLER's target has no lowering for, so callers must compile it inside a
   * `try` and fall through to their numeric emitter when that throws.
   */
  static closedFormIntegral(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): Expression | undefined {
    if (BaseCompiler.referencesVarsSymbol(args, target)) return undefined;

    const engine = args[0].engine;
    let closed: Expression | undefined;
    // Isolation scope — a child of the caller's scope, so everything the
    // caller declared stays visible; only what this attempt declares is
    // confined, and discarded on the way out. Without it, an integrand with a
    // free single-uppercase-letter symbol (`∫ D x² dx`) devolves the unapplied
    // operator into a variable and shadows the builtin in the caller's engine
    // for good. The node must be BUILT inside the scope, not merely evaluated:
    // `Integrate` is a binder, and its evaluate handler re-enters the parent of
    // the scope its integrand literal owns — the scope fixed when that literal
    // was canonicalized (`rebindEscapingCurrentScope`). Re-boxing the operands
    // from MathJSON is what re-roots them here; `_fn` of the already-canonical
    // operands would keep the caller's scope. The closed form outlives the
    // scope: the caller's `compile()` resolves its free symbols by name against
    // the target's bindings.
    // The compilation-wide pool is consumed by wall-clock actually spent, so
    // hundreds of nodes cannot each arm a fresh full span — once the pool is
    // dry, remaining integrals go straight to their numeric emitter.
    if (BaseCompiler.antiderivativeBudgetLeftMs <= 0) return undefined;
    //
    // eslint-disable-next-line no-restricted-globals
    const attemptStart = performance.now();
    engine.pushScope();
    try {
      const ops = args.map((x) => x.json);
      closed = engine.withTimeLimit(
        {
          ms: Math.min(
            BaseCompiler.ANTIDERIVATIVE_ATTEMPT_BUDGET_MS,
            BaseCompiler.antiderivativeBudgetLeftMs
          ),
          label: 'compile:antiderivative',
        },
        () => engine.function('Integrate', ops).evaluate()
      );
    } catch {
      // Non-elementary / deadline: the caller falls back to numeric
      // integration.
    } finally {
      engine.popScope();
      BaseCompiler.antiderivativeBudgetLeftMs -=
        // eslint-disable-next-line no-restricted-globals
        performance.now() - attemptStart;
    }

    if (
      closed === undefined ||
      closed.has('Integrate') ||
      !closed.isValid ||
      closed.isNaN === true
    )
      return undefined;
    return closed;
  }

  /**
   * Whether a function promises a scalar result but provably constructs a
   * collection. This is a contradiction check, not result-type inference:
   * declarations remain authoritative unless the stored body disproves them.
   *
   * The guard applies on every target. JavaScript would otherwise consume the
   * returned array as a number, while GLSL/WGSL could emit a vector from a
   * scalar-returning function. Open and broadcastable result types do not count
   * as scalar promises and retain their existing target-specific paths.
   */
  static isContradictedScalarDeclaration(body: Expression): boolean {
    if (!BaseCompiler.isScalarDeclaredType(body)) return false;
    return BaseCompiler.isProvablyCollectionValuedApplication(body, new Set());
  }

  /** Whether a declaration promises a one-word scalar: number or boolean. */
  private static isScalarDeclaredType(body: Expression): boolean {
    const t = body.type;
    return t.matches('number') || t.matches('boolean');
  }

  /**
   * Definition-site form of {@link isContradictedScalarDeclaration}. Shader
   * targets bake the declared result into the function signature, so the body
   * must be checked even when a bare call has no scalar-consuming parent.
   * Declared result ascriptions are unwrapped by the shared body look-through.
   */
  static isContradictedScalarFunctionBody(body: Expression): boolean {
    if (!BaseCompiler.isScalarDeclaredType(body)) return false;
    return BaseCompiler.isProvablyCollectionValuedBody(body, new Set());
  }

  /**
   * Reject a contradicted scalar declaration when an ordinary operator will
   * consume the call as a scalar. The rule lives in the shared dispatcher
   * because the contradiction belongs to the application, not to one target.
   *
   * Scalar arithmetic, broadcastable operators, relations, and connectives are
   * consuming positions. Containers, accessors, and a bare top-level call are
   * not. Open result types also retain their element-wise or target-specific
   * handling because they do not promise a scalar.
   */
  private static assertNoContradictedScalarOperand(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>
  ): void {
    if (args.length === 0) return;
    const consumesScalarOperands = (): boolean => {
      if (
        BaseCompiler.SCALAR_ARITHMETIC_HEADS.has(h) ||
        isRelationalOperator(h) ||
        BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h)
      )
        return true;
      const def = engine.lookupDefinition(h);
      return isOperatorDef(def) && def.operator.broadcastable === true;
    };
    if (!consumesScalarOperands()) return;
    const offending = args.find((a) =>
      BaseCompiler.isContradictedScalarDeclaration(a)
    );
    if (offending === undefined) return;
    throw new Error(
      `${h}: the declaration of '${
        isFunction(offending) ? offending.operator : offending.toString()
      }' says it returns a scalar ` +
        `('${offending.type.toString()}'), but its body constructs a ` +
        `collection. The declaration is contradicted by the body, so this ` +
        `scalar position would consume a run-time collection as a number. ` +
        `Fix the declaration (e.g. '-> list<number>') or evaluate instead. ` +
        `Fail closed (D6).`
    );
  }

  /**
   * Positive evidence that a big-operator body with an open declared type is
   * nevertheless collection-valued.
   *
   * The first clause above already declines a body whose declared type matches
   * `list`/`indexed_collection`. Consumers, however, register helpers under the
   * open `(unknown) -> unknown` head (the spelling that keeps list-broadcasting
   * working), so `a(t) = [cos t, sin t]` applied inside a Sum types
   * `broadcastable<unknown>` and slips past that clause via the two documented
   * exemptions for top types and `broadcastable<T>`. Those exemptions protect
   * an absence of evidence, not a body that provably builds a collection.
   *
   * So this fires only where an exemption is doing the admitting — the body's
   * type carries no sort evidence at all (`unknown`/`any`/… and the union
   * spelling of the top type) or is `broadcastable<T>` — and only on positive
   * evidence: the operator names a user function (`userFunctionLiteral`) whose
   * `Function`-literal body has a type that matches a collection (the subtype
   * direction, so a wide body type is not evidence). A nested user-function
   * application recurses, `visited` declining self/mutual recursion.
   *
   * The JavaScript target never consults this: its own wider gate
   * (`isElementwiseBigOpBody` → `isPossiblyCollectionTypedJS`, which routes the
   * same shape through the value-safe `_SYS.bcast` element-wise fold) diverts
   * every body this predicate accepts before `assertScalarBigOpBody` is reached,
   * so JS emission is unchanged. The GPU/Python/interval targets have no
   * element-wise arm, so for them the only sound answer is to decline.
   */
  private static isCollectionValuedBigOpBodyByLookThrough(
    body: Expression
  ): boolean {
    const t = compilationType(body);
    const exempted =
      (typeof t !== 'string' && t.kind === 'broadcastable') ||
      carriesNoSortEvidence(t);
    if (!exempted) return false;
    return BaseCompiler.isProvablyCollectionValuedApplication(body, new Set());
  }

  /**
   * See `isCollectionValuedBigOpBodyByLookThrough` — the body half of the
   * look-through. This conservative whitelist may miss evidence, but must never
   * produce a false positive because a positive result declines compilation.
   */
  private static isProvablyCollectionValuedApplication(
    e: Expression,
    visited: Set<string>
  ): boolean {
    if (!isFunction(e)) return false;
    const op = e.operator;
    if (typeof op !== 'string' || visited.has(op)) return false;
    const nextVisited = new Set(visited);
    nextVisited.add(op);
    const literal = BaseCompiler.userFunctionLiteral(e.engine, op);
    // A MULTI-CLAUSE function has no single literal (`userFunctionLiteral`
    // answers `undefined` — the same test `ensureUserFunctionEmitted` uses to
    // route to `tryEmitMultiClauseFunction`), so read its clause set instead.
    if (literal === undefined)
      return BaseCompiler.isProvablyCollectionValuedClauseSet(
        e.engine,
        op,
        nextVisited
      );
    const fnBody = literal.ops[0];
    if (fnBody === undefined) return false;
    return BaseCompiler.isProvablyCollectionValuedBody(fnBody, nextVisited);
  }

  /**
   * Multi-clause counterpart of the user-function body look-through.
   * `userFunctionLiteral` has no single literal for such a function, so inspect
   * each stored clause through the shared body predicate.
   *
   * Any collection-producing clause is enough to decline a scalar-consuming
   * call because the consuming position is compiled once for every branch.
   * Targets without multi-clause lowering decline before reaching this check.
   */
  private static isProvablyCollectionValuedClauseSet(
    engine: ComputeEngine,
    op: string,
    visited: Set<string>
  ): boolean {
    const state = multiClauseState(engine.lookupDefinition(op));
    if (state === undefined) return false;
    return state.clauses.some((c) => {
      if (!isFunction(c.literal, 'Function')) return false;
      const body = c.literal.ops[0];
      if (body === undefined) return false;
      return BaseCompiler.isProvablyCollectionValuedBody(body, visited);
    });
  }

  /**
   * The body half of `isProvablyCollectionValuedApplication`: does this
   * function-literal body provably construct a collection?
   *
   * Split out so the same evidence can be read from either a call site or from
   * definition emission (`isContradictedScalarFunctionBody`), which receives the
   * body directly and has no application in hand.
   *
   * Canonical parsing wraps a lambda body in `Block`, whose value is its last
   * statement, so that is the statement to judge for both single- and
   * multi-statement bodies.
   *
   * A `Return` in an earlier statement disqualifies the block: control
   * may never reach the last statement, so it is not provably the value and
   * this positive-evidence predicate must answer `false`.
   *
   * A declared result type additionally ascribes the body: the
   * `ce.declare('a', { signature: '(number) -> number' })` +
   * `ce.assign('a', λ)` route stores `Block(Typed(List(…), 'number'))`, so the
   * ascription reports `number` and hides the `List` underneath. Unwrap it: the
   * constructed value beneath the ascription is precisely the evidence the
   * declaration is contradicting (the interpreter does not coerce — `a(0.3)`
   * really answers a 2-list).
   */
  private static isProvablyCollectionValuedBody(
    body: Expression,
    visited: Set<string>
  ): boolean {
    let fnBody: Expression = body;
    for (;;) {
      if (isFunction(fnBody, 'Block') && fnBody.nops >= 1) {
        const stmts = fnBody.ops;
        if (stmts.slice(0, -1).some(BaseCompiler.containsReturn)) return false;
        fnBody = stmts[stmts.length - 1];
      } else if (isFunction(fnBody, 'Typed') && fnBody.nops >= 1)
        fnBody = fnBody.ops[0];
      else break;
    }
    if (fnBody.type.matches('collection<any>')) return true;
    return BaseCompiler.isProvablyCollectionValuedApplication(fnBody, visited);
  }

  /**
   * Does `e` contain a `Return` anywhere? Read by
   * `isProvablyCollectionValuedBody` to disqualify a block whose last statement
   * may not be reached.
   */
  private static containsReturn(e: Expression): boolean {
    if (!isFunction(e)) return false;
    if (e.operator === 'Return') return true;
    return e.ops.some(BaseCompiler.containsReturn);
  }

  /**
   * Positive evidence that a big-op body can NEVER produce a number, so the
   * scalar accumulation arm would emit a numerically meaningless `+`/`*`.
   *
   * Deliberately narrow — this is a DECLINE predicate, so every uncertainty
   * resolves to `false` (compile it):
   *
   * - `couldMatch('number')` covers the wide types on its own: `unknown`,
   *   `any`, `expression` and any union carrying a numeric arm all answer
   *   `true` and are admitted. Only a type with no numeric inhabitant at all
   *   reaches the rest.
   * - `boolean` is EXEMPT. It is not a number, but `+` over booleans is
   *   numerically faithful on the numeric targets (JS/Python coerce to 0/1),
   *   which is the counting idiom `Σ_i (x_i > 0)` — compiled it answers `2`
   *   where the interpreter only manages a symbolic `2·True + 2·False`.
   *   Declining it would remove a working lowering to fix nothing.
   * - `broadcastable<T>` is EXEMPT: it spans scalar and collection, so such a
   *   body is routinely a plain scalar at run time (a wide-declared helper
   *   application in a shader body). The JS target routes it through the
   *   `_SYS.bcast` fold before it ever gets here; the GPU/Python/interval
   *   targets rely on it staying admitted. The narrow case where the body can
   *   be PROVEN collection-valued despite the open declared type is carved out
   *   by the caller's third clause
   *   (`isCollectionValuedBigOpBodyByLookThrough`), not here.
   *
   * What is left is the filed class: `string`, `symbol`, `nothing`,
   * `record`/`dictionary`, and function types. Collections are handled by the
   * caller's own branch, which has an actionable message.
   */
  private static isProvablyNonNumericBigOpBody(body: Expression): boolean {
    const t = body.type;
    if (t.couldMatch('number')) return false;
    if (t.matches('boolean')) return false;
    const resolved = compilationType(body);
    if (typeof resolved !== 'string' && resolved.kind === 'broadcastable')
      return false;
    return true;
  }

  /**
   * True if the expression provably evaluates to a boolean (`True`/`False`) —
   * a relational (`Less`, `Equal`, …) or logical (`And`/`Or`/`Not`) form, the
   * `True`/`False` symbols, or anything declared `boolean`. Used to decide
   * whether a `Which`/`When` condition needs the fail-closed guard: a provably
   * boolean condition never diverges from the interpreter, so it is emitted
   * bare.
   */
  static isBooleanValued(expr: Expression): boolean {
    if (isSymbol(expr, 'True') || isSymbol(expr, 'False')) return true;
    if (isFunction(expr)) {
      const h = expr.operator;
      if (isRelationalOperator(h) || h === 'And' || h === 'Or' || h === 'Not')
        return true;
      const t = expr.type;
      return t ? t.matches('boolean') : false;
    }
    if (isSymbol(expr)) {
      const t = expr.type;
      return t ? t.matches('boolean') : false;
    }
    return false;
  }

  /**
   * Compile a `Which`/`When` condition, wrapping it in the target's fail-closed
   * boolean guard (`target.assertBoolean`) when it is not provably boolean. The
   * interpreter throws on a non-boolean (e.g. `NaN`) condition rather than
   * silently taking the default branch; the guard makes the compiled code match
   * that contract (D6) where the target can express it. A provably boolean
   * condition — the common case — is emitted bare (no overhead, no churn).
   */
  /**
   * A branch condition (`If`/`Which`/`When`) must be a scalar boolean. A
   * collection-valued condition can never be one — the interpreter throws
   * ("Condition must evaluate to True or False") rather than silently taking a
   * branch — so fail closed (D6) at compile time. Uses the declared type (not
   * `.isCollection`, which is false for a `list<finite_number>`).
   *
   * A CONTRADICTED scalar declaration is the same hazard with the declared type
   * lying about it (2026-08-12 ruling): `b` declared `(number) -> boolean` over
   * a list-constructing body types the condition `boolean`, so the clause above
   * sees nothing and the emitted ternary took a branch off the truthiness of a
   * run-time array. The condition is not an operand of a head in
   * `assertNoContradictedScalarOperand`'s classification (`If`/`Which`/`When`
   * are not broadcastable and consume only this one operand as a scalar), so
   * the gate belongs here — the shared condition guard both `If` and
   * `guardCondition` already funnel through.
   */
  static assertScalarCondition(cond: Expression): void {
    if (cond.type.matches('collection<any>'))
      throw new Error(
        'Cannot compile: a branch condition is a collection-valued expression, ' +
          'which is never a scalar boolean. Materialize the collection first. ' +
          'Fail closed (D6).'
      );
    if (BaseCompiler.isContradictedScalarDeclaration(cond))
      throw new Error(
        `Cannot compile: the declaration of '${
          isFunction(cond) ? cond.operator : cond.toString()
        }' says it returns a scalar ('${cond.type.toString()}'), but its body ` +
          `constructs a collection. The declaration is contradicted by the ` +
          `body, so this branch condition would select on the truthiness of a ` +
          `run-time collection. Fix the declaration (e.g. '-> list<number>') ` +
          `or evaluate instead. Fail closed (D6).`
      );
  }

  static guardCondition(
    cond: Expression,
    target: CompileTarget<Expression>
  ): TargetSource {
    BaseCompiler.assertScalarCondition(cond);
    const code = BaseCompiler.compile(cond, target);
    if (target.assertBoolean && !BaseCompiler.isBooleanValued(cond))
      return target.assertBoolean(code);
    return code;
  }

  /** True if the expression is provably integer-typed. */
  static isIntegerValued(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im === 0 && Number.isInteger(expr.re);
    const t = expr.type;
    return t ? t.matches('integer') : false;
  }

  /** True if the expression is provably non-negative (sign ≥ 0). */
  static isNonNegative(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im === 0 && expr.re >= 0;
    return expr.isNonNegative === true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // `Match` compilation (Epsil structural pattern matching, Phase 4 —
  // docs/LANGUAGE-MODEL.md §5).
  //
  // Compilation reuses the classification ladder from `match-dispatch.ts`
  // (`getMatchPlan`): tier 0/1 (constant / literal / pin-of-constant) dispatch,
  // tier 2 fixed-shape `List`/`Tuple` destructuring, and fail-closed (D6) for
  // tier 3 and anything a target cannot express. The subject is evaluated once
  // (an IIFE parameter on JS; inlined where the target has no binding form).
  //
  // Compiled-vs-interpreted seam (accepted, §4 Phase-2 note): number leaves are
  // compared with the target's native `===`/`==`, not the interpreter's
  // tolerant `isEqual` — the same float-equality seam compiled `Which` already
  // has. A range pattern (§8) carries the same seam on its endpoints: compiled
  // it is `s >= lo && s <= hi` (exact), interpreted an endpoint match is
  // tolerant, so a subject within `engine.tolerance` *outside* an endpoint
  // selects the case interpreted but not compiled. No-match falls through to
  // `NaN` (matching compiled `Which`), not the interpreter's
  // `["Error", "match-no-case", …]` value.
  // ───────────────────────────────────────────────────────────────────────

  /** Above this many integer-constant tier-0 cases, a dispatch run is emitted
   * as a `switch` (JS engines jump-table dense integer switches) instead of a
   * chain of `if (s === k)` comparisons. Below it, comparisons are simpler and
   * JIT-equivalent. */
  private static readonly MATCH_SWITCH_THRESHOLD = 8;

  /** True when `cc` is an irrefutable tier-3 case — a bare wildcard (`_` or a
   * single binding `_n`) with no guard. It matches anything, so it compiles to
   * the final unconditional branch (binding the subject to the capture). */
  private static isIrrefutableCase(cc: CompiledCase): boolean {
    return (
      cc.tier === 3 &&
      !cc.hasGuard &&
      cc.rawPatterns !== undefined &&
      cc.rawPatterns.length === 1 &&
      isWildcard(cc.rawPatterns[0])
    );
  }

  /** The ordered comparison targets of a tier-0/1 case: a constant to compare
   * the subject against (`{kind:'literal'}`) or a pin to resolve (`{kind:'pin'}`).
   * Unifies tier-0 (`dispatchKeys`) and tier-1 (`tests`). */
  private static matchCaseComparisons(cc: CompiledCase): LeafTest[] {
    if (cc.tier === 0)
      return (cc.dispatchKeys ?? []).map((d) => ({
        kind: 'literal' as const,
        value: d.value,
      }));
    return cc.tests ?? [];
  }

  /** Compile one comparison constant/pin of a tier-0/1 case to target source,
   * throwing (fail closed, D6) when it cannot be represented: a pin of a runtime
   * value (only `isConstant` symbols and literals fold), or a string on a target
   * with no string type. */
  private static compileMatchConstant(
    engine: ComputeEngine,
    cmp:
      | { kind: 'literal'; value: Expression }
      | { kind: 'pin'; expr: Expression },
    allowStrings: boolean,
    target: CompileTarget<Expression>
  ): string {
    const expr = cmp.kind === 'literal' ? cmp.value : cmp.expr;
    if (isString(expr)) {
      if (!allowStrings)
        throw new Error(
          `Match: a string constant is not compilable to "${target.language ?? 'this'}" (no string type). Fail closed (D6).`
        );
      return BaseCompiler.compile(expr, target);
    }
    if (cmp.kind === 'pin') {
      // A pin folds only when its value is fixed at compile time: a literal, or
      // a symbol declared `isConstant` (`== Pi` → `Math.PI`). A pin of a runtime
      // variable (`== limit`) has no compile-time value → fail closed (D6).
      const ok =
        isNumber(expr) ||
        isString(expr) ||
        (isSymbol(expr) && engine.box(expr.symbol).isConstant);
      if (!ok)
        throw new Error(
          `Match: pin '== ${expr.toString()}' references a runtime value; not compilable. Fail closed (D6).`
        );
    }
    return BaseCompiler.compile(expr, target);
  }

  /** The OR-chain condition for a tier-0/1 case: `s === c1 || s === c2 || …`,
   * with a range pattern contributing `(s >= lo && s <= hi)`. */
  private static matchLeafCondition(
    engine: ComputeEngine,
    cc: CompiledCase,
    subject: string,
    eq: string,
    allowStrings: boolean,
    target: CompileTarget<Expression>
  ): string {
    const parts = BaseCompiler.matchCaseComparisons(cc).map((cmp) => {
      // A range pattern is a pair of native comparisons on the subject — the
      // same float seam as the `===` leaf comparisons around it (the
      // interpreter compares the endpoints tolerantly). `Infinity` bounds emit
      // the target's own infinity literal (`Infinity`, `_gpu_inf()`, …).
      if (cmp.kind === 'range')
        return (
          `(${subject} >= ${BaseCompiler.compile(cmp.lo, target)} && ` +
          `${subject} <= ${BaseCompiler.compile(cmp.hi, target)})`
        );
      return `${subject} ${eq} ${BaseCompiler.compileMatchConstant(engine, cmp, allowStrings, target)}`;
    });
    if (parts.length === 0) return 'false';
    return parts.length === 1 ? parts[0] : `(${parts.join(' || ')})`;
  }

  /** Compile a case body, substituting each captured name with its target
   * accessor code. Bodies with no captures compile directly (the common
   * tier-0/1 case); bodies with captures compile the shadow-correct canonical
   * body of a closure built at EMISSION time (`buildCaseClosure` — the plan no
   * longer caches closures; only the value-safe canonical structure `.op1` is
   * consumed here), with the capture names rebound to their accessors. */
  private static compileMatchBody(
    cc: CompiledCase,
    accessors: Map<string, string> | undefined,
    target: CompileTarget<Expression>
  ): string {
    if (cc.captureNames.length === 0)
      return BaseCompiler.compile(cc.body.canonical, target);
    const bodyClosure = buildCaseClosure(
      cc.body.engine,
      cc.body,
      cc.captureNames
    );
    if (bodyClosure === undefined || !isFunction(bodyClosure))
      throw new Error('Match: case body is not compilable. Fail closed (D6).');
    return BaseCompiler.compile(
      bodyClosure.op1,
      BaseCompiler.matchCaptureTarget(accessors, target)
    );
  }

  /** Compile a case guard the same way as its body (captures rebound to
   * accessors), or `undefined` when the case has no guard. */
  private static compileMatchGuard(
    cc: CompiledCase,
    accessors: Map<string, string> | undefined,
    target: CompileTarget<Expression>
  ): string | undefined {
    if (!cc.hasGuard || cc.guard === undefined) return undefined;
    if (cc.captureNames.length === 0)
      return BaseCompiler.compile(cc.guard.canonical, target);
    const guardClosure = buildCaseClosure(
      cc.guard.engine,
      cc.guard,
      cc.captureNames
    );
    if (guardClosure === undefined || !isFunction(guardClosure))
      throw new Error('Match: case guard is not compilable. Fail closed (D6).');
    return BaseCompiler.compile(
      guardClosure.op1,
      BaseCompiler.matchCaptureTarget(accessors, target)
    );
  }

  /** A target that resolves each captured name to its accessor code (e.g.
   * `a → s[0]`), delegating everything else to the base target. */
  private static matchCaptureTarget(
    accessors: Map<string, string> | undefined,
    target: CompileTarget<Expression>
  ): CompileTarget<Expression> {
    if (accessors === undefined || accessors.size === 0) return target;
    return {
      ...target,
      var: (id) => accessors.get(id) ?? target.var(id),
      boundVars: BaseCompiler.withBoundNames(target, [...accessors.keys()]),
    };
  }

  /**
   * Compile a `["Match", subject, …cases]` to JavaScript: an arrow-IIFE that
   * binds the subject once, then a chain of `if (cond) return body;` statements
   * (tier 0/1 constant comparisons, tier 2 fixed-shape destructuring),
   * optionally a `switch` for a large integer-constant dispatch run, ending in
   * a trailing irrefutable case or `return NaN`.
   */
  static compileMatchJS(
    engine: ComputeEngine,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource {
    const plan = getMatchPlan(engine, args);
    if (plan.errorAlt !== undefined)
      throw new Error(
        `Match: an or-alternative binds the name '${plan.errorAlt.toString()}'; not compilable. Fail closed (D6).`
      );

    const s = BaseCompiler.tempVar(target);
    const nl = target.ws('\n');
    const stmts: string[] = [];
    let done = false;

    for (const seg of plan.segments) {
      if (done) break;
      if (seg.kind === 'dispatch' && BaseCompiler.matchSwitchable(seg)) {
        stmts.push(BaseCompiler.emitMatchSwitch(engine, seg, s, target));
        continue;
      }
      for (const cc of seg.cases) {
        if (done) break;
        if (BaseCompiler.isIrrefutableCase(cc)) {
          const acc =
            cc.captureNames.length === 1
              ? new Map([[cc.captureNames[0], s]])
              : undefined;
          stmts.push(
            `return ${BaseCompiler.compileMatchBody(cc, acc, target)};`
          );
          done = true;
          break;
        }
        stmts.push(BaseCompiler.emitMatchCaseJS(engine, cc, s, target));
      }
    }

    if (!done) stmts.push('return NaN;');

    const subjCode = BaseCompiler.compile(args[0], target);
    return `((${s}) => {${nl}${stmts.join(nl)}${nl}})(${subjCode})`;
  }

  /** Emit one non-irrefutable case as a guarded early-return `if`. */
  private static emitMatchCaseJS(
    engine: ComputeEngine,
    cc: CompiledCase,
    s: string,
    target: CompileTarget<Expression>
  ): string {
    if (cc.tier === 0 || cc.tier === 1) {
      const cond = BaseCompiler.matchLeafCondition(
        engine,
        cc,
        s,
        '===',
        true,
        target
      );
      const guard = BaseCompiler.compileMatchGuard(cc, undefined, target);
      const full = guard === undefined ? cond : `(${cond}) && (${guard})`;
      return `if (${full}) return ${BaseCompiler.compileMatchBody(cc, undefined, target)};`;
    }

    if (cc.tier === 2) {
      const conds: string[] = [];
      const accessors = new Map<string, string>();
      BaseCompiler.walkMatchShape(
        engine,
        cc.shape!,
        s,
        conds,
        accessors,
        target
      );
      const guard = BaseCompiler.compileMatchGuard(cc, accessors, target);
      if (guard !== undefined) conds.push(`(${guard})`);
      const body = BaseCompiler.compileMatchBody(cc, accessors, target);
      return `if (${conds.join(' && ')}) return ${body};`;
    }

    // The SUM-CONSTRUCTOR tier (`docs/plans/2026-08-12-sum-type-sugar-and-
    // compilation.md` §B3): a pattern whose head names a variant of a
    // sugar-declared sum. It is classified tier 3 by the interpreter's ladder
    // (which reaches it with the generic matcher), but the compiler CAN lower
    // it — against the same per-sum representation policy the constructors
    // emit under.
    const ctor = BaseCompiler.emitMatchConstructorCaseJS(engine, cc, s, target);
    if (ctor !== undefined) return ctor;

    // Tier 3, refutable: no compiled reference implementation of the generic
    // matcher — fail closed (D6), naming the offending pattern so the caller can
    // rewrite it with destructuring or guards.
    const p = cc.rawPatterns?.[0];
    throw new Error(
      `Match: pattern '${p?.toString() ?? '?'}' is not compilable; ` +
        `rewrite with destructuring or guards. Fail closed (D6).`
    );
  }

  /**
   * Lower a tier-3 case whose pattern(s) are sum-type CONSTRUCTOR patterns
   * (`lit(v)`, `plus(a, b)`, `red()`) to a guarded early-return `if`, or return
   * `undefined` to leave the case to the tier-3 fail-closed throw.
   *
   * The test emitted follows the sum's representation policy (§B1), which is
   * the same policy the constructors emitted under, so a value built and
   * matched inside one compiled unit always agrees with itself:
   *
   * - TAGGED — `s?._tag === 'plus'`, payload captures read `s._ops[i]`. The
   *   optional chaining is what makes a tag test TOTAL: the scrutinee may be a
   *   `null`/`undefined`/primitive value from another sum, and a mixed-sum
   *   match must fall through, not throw.
   * - ERASED — a representation test on the variant's bucket (`s === null`,
   *   `typeof s === 'number'`, `Array.isArray(s)`, …); captures read the value
   *   itself (unary payload) or `s[i]` (tuple payload).
   *
   * JS only. The GPU targets override `Match` wholesale and keep throwing on
   * tier 3; Python and interval-js decline the head outright (§B2).
   */
  private static emitMatchConstructorCaseJS(
    engine: ComputeEngine,
    cc: CompiledCase,
    s: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    if ((target.language ?? 'javascript') !== 'javascript') return undefined;
    const pats = cc.rawPatterns;
    if (pats === undefined || pats.length === 0) return undefined;

    const accessors = new Map<string, string>();
    const alts: string[] = [];
    for (const p of pats) {
      const conds: string[] = [];
      // Fresh per ALTERNATIVE: a name bound once in each arm of
      // `plus(a, _) | times(a, _)` is linear (only one arm ever matches),
      // while a name bound twice in the SAME arm is the non-linear pattern
      // `walkConstructorElement` fails closed on.
      if (
        !BaseCompiler.walkConstructorPattern(
          engine,
          p,
          s,
          conds,
          accessors,
          new Set<string>(),
          target
        )
      )
        return undefined;
      alts.push(conds.join(' && '));
    }

    // Every name the case's body may reference must have an accessor: a
    // capture the walk did not bind would compile in the body as a free
    // symbol (a `_.v` vars-object lookup) and read `undefined` at run time.
    for (const n of cc.captureNames) if (!accessors.has(n)) return undefined;

    const cond =
      alts.length === 1 ? alts[0] : alts.map((a) => `(${a})`).join(' || ');
    const conds = [`(${cond})`];
    const guard = BaseCompiler.compileMatchGuard(cc, accessors, target);
    if (guard !== undefined) conds.push(`(${guard})`);
    const body = BaseCompiler.compileMatchBody(cc, accessors, target);
    return `if (${conds.join(' && ')}) return ${body};`;
  }

  /** The total JS test that `base` holds a value of the given erased
   * representation bucket. `complexNumber` widens the `number` test to the
   * `{re, im}` object a complex-admitting payload may carry. */
  private static sumBucketTest(
    bucket: SumBucket,
    base: string,
    complexNumber: boolean
  ): string {
    switch (bucket) {
      case 'null':
        return `${base} === null`;
      case 'boolean':
        return `typeof ${base} === 'boolean'`;
      case 'number':
        return complexNumber
          ? `(typeof ${base} === 'number' || (${base} !== null && typeof ${base} === 'object' && ${base}.im !== undefined))`
          : `typeof ${base} === 'number'`;
      case 'string':
        return `typeof ${base} === 'string'`;
      case 'array':
        return `Array.isArray(${base})`;
    }
  }

  /** Walk a sum constructor pattern, appending conditions and capture
   * accessors. Returns `false` — leaving `conds`/`accessors` to be discarded
   * by the caller — when the pattern is not a sum constructor pattern this
   * compiler can lower. */
  private static walkConstructorPattern(
    engine: ComputeEngine,
    p: Expression,
    base: string,
    conds: string[],
    accessors: Map<string, string>,
    bound: Set<string>,
    target: CompileTarget<Expression>
  ): boolean {
    if (!isFunction(p)) return false;
    const info = sumVariantInfo(engine, p.operator);
    if (info === undefined) return false;
    const ops = p.ops;
    // The pattern must be a saturated application: `plus(a, b)`, never
    // `plus(___)` or a wrong-arity application. (`red` — the bare symbol — is
    // not a function expression and never reaches here; `red()` is.)
    if (ops.length !== info.arity) return false;

    if (info.policy === 'tagged') {
      conds.push(`${base}?._tag === ${JSON.stringify(p.operator)}`);
      return ops.every((op, i) =>
        BaseCompiler.walkConstructorElement(
          engine,
          op,
          `${base}._ops[${i}]`,
          conds,
          accessors,
          bound,
          target
        )
      );
    }

    // ERASED. An unclassifiable variant can never reach here: it forces its
    // whole sum to the tagged policy.
    if (info.bucket === undefined) return false;
    conds.push(
      BaseCompiler.sumBucketTest(info.bucket, base, info.complexNumber)
    );
    if (info.shape === 'nothing') return true;
    if (info.shape === 'value')
      return BaseCompiler.walkConstructorElement(
        engine,
        ops[0],
        base,
        conds,
        accessors,
        bound,
        target
      );
    // A tuple payload erases to the same JS array `Tuple` emits, of a fixed
    // length the constructor always produces.
    conds.push(`${base}.length === ${info.arity}`);
    return ops.every((op, i) =>
      BaseCompiler.walkConstructorElement(
        engine,
        op,
        `${base}[${i}]`,
        conds,
        accessors,
        bound,
        target
      )
    );
  }

  /** One payload slot of a constructor pattern: a binding / `_`, a literal or
   * pin (compared with `===`, the same seam tier 2 carries), or a NESTED
   * constructor pattern (`plus(lit(v), _)`) — which falls out of the recursion.
   * A `List`/`Tuple` sub-pattern is NOT supported in v1: it would need the
   * interpreter's shape classifier, which does not descend through an operator
   * pattern. Fails closed by returning `false`. */
  private static walkConstructorElement(
    engine: ComputeEngine,
    el: Expression,
    access: string,
    conds: string[],
    accessors: Map<string, string>,
    bound: Set<string>,
    target: CompileTarget<Expression>
  ): boolean {
    if (isWildcard(el)) {
      const wt = wildcardType(el);
      if (wt === 'Sequence' || wt === 'OptionalSequence') return false;
      const name = wildcardName(el);
      if (name === undefined || name === null) return false;
      const bare = name.replace(/^_+/, '');
      if (bare.length > 0) {
        // NON-LINEAR pattern (`plus(a, a)`): the interpreter's generic matcher
        // UNIFIES the two occurrences, so the arm is taken only when the two
        // payloads are equal. Overwriting the accessor would drop that
        // condition entirely and match `plus(1, 2)`. There is no
        // representation-independent equality to emit here — a payload may be
        // a machine number, a string, a JS array (tuple/list erasure), a
        // `{re, im}` complex or a `{_tag, _ops}` tagged value, and `===` is
        // wrong for all but the first two — so FAIL CLOSED, matching the
        // fixed-shape precedent (`hasRepeatedKeys` in `match-dispatch.ts`
        // excludes a repeated binding from tier 2, sending it to the tier-3
        // throw).
        if (bound.has(bare)) return false;
        // Across ALTERNATIVES the name is linear, but the body has a single
        // accessor for it: the arms must agree on where to read it from, or
        // whichever arm matched, the body would read the other's slot. (Belt
        // and braces — `getMatchPlan` already refuses a name-binding
        // alternative upstream, so only capture-free arms reach here today.)
        const prior = accessors.get(bare);
        if (prior !== undefined && prior !== access) return false;
        bound.add(bare);
        accessors.set(bare, access);
      }
      return true;
    }
    if (isFunction(el, 'Pin')) {
      conds.push(
        `${access} === ${BaseCompiler.compileMatchConstant(
          engine,
          { kind: 'pin', expr: el.op1 },
          true,
          target
        )}`
      );
      return true;
    }
    if (isNumber(el) || isString(el) || isSymbol(el)) {
      conds.push(
        `${access} === ${BaseCompiler.compileMatchConstant(
          engine,
          { kind: 'literal', value: el },
          true,
          target
        )}`
      );
      return true;
    }
    return BaseCompiler.walkConstructorPattern(
      engine,
      el,
      access,
      conds,
      accessors,
      bound,
      target
    );
  }

  /** Walk a tier-2 fixed shape, appending JS boolean conditions (arity + literal
   * / pin element checks) and populating `accessors` (capture name → element
   * access code). Compiled `List`/`Tuple` values are JS arrays, so shapes lower
   * to `Array.isArray`, `.length`, `[i]`, and `.slice`. */
  private static walkMatchShape(
    engine: ComputeEngine,
    node: ShapeNode,
    base: string,
    conds: string[],
    accessors: Map<string, string>,
    target: CompileTarget<Expression>
  ): void {
    // Dictionary shapes are a tier-2 fixed shape for the interpreter, but the
    // compiler does not implement dict destructuring (native dict values have no
    // compiled array representation). Fail closed (D6), naming the keys.
    if (node.kind === 'dict') {
      const keys = node.entries.map((e) => `'${e.key}'`).join(', ');
      throw new Error(
        `Match: dictionary pattern {${keys}} is not compilable; ` +
          `rewrite with destructuring or guards. Fail closed (D6).`
      );
    }
    conds.push(`Array.isArray(${base})`);
    const fixed = node.prefix.length + node.suffix.length;
    if (node.rest === undefined) conds.push(`${base}.length === ${fixed}`);
    else conds.push(`${base}.length >= ${fixed}`);

    node.prefix.forEach((el, i) =>
      BaseCompiler.walkMatchElement(
        engine,
        el,
        `${base}[${i}]`,
        conds,
        accessors,
        target
      )
    );
    const sLen = node.suffix.length;
    node.suffix.forEach((el, j) =>
      BaseCompiler.walkMatchElement(
        engine,
        el,
        `${base}[${base}.length - ${sLen} + ${j}]`,
        conds,
        accessors,
        target
      )
    );
    if (node.rest !== undefined && node.rest.key !== null) {
      const name = node.rest.key.replace(/^_+/, '');
      accessors.set(
        name,
        `${base}.slice(${node.prefix.length}, ${base}.length - ${sLen})`
      );
    }
  }

  /** Handle one positional element of a tier-2 shape (see `walkMatchShape`). */
  private static walkMatchElement(
    engine: ComputeEngine,
    el: ElementPlan,
    access: string,
    conds: string[],
    accessors: Map<string, string>,
    target: CompileTarget<Expression>
  ): void {
    switch (el.kind) {
      case 'ignore':
        return;
      case 'bind':
        accessors.set(el.key.replace(/^_+/, ''), access);
        return;
      case 'literal':
        conds.push(
          `${access} === ${BaseCompiler.compileMatchConstant(engine, { kind: 'literal', value: el.value }, true, target)}`
        );
        return;
      case 'pin':
        conds.push(
          `${access} === ${BaseCompiler.compileMatchConstant(engine, { kind: 'pin', expr: el.expr }, true, target)}`
        );
        return;
      case 'shape':
        BaseCompiler.walkMatchShape(
          engine,
          el.node,
          access,
          conds,
          accessors,
          target
        );
        return;
    }
  }

  /** True when a tier-0 dispatch segment qualifies for `switch` emission: every
   * case dispatches only on safe machine integers (`n:` keys) and there are at
   * least `MATCH_SWITCH_THRESHOLD` of them. */
  private static matchSwitchable(
    seg: Extract<Segment, { kind: 'dispatch' }>
  ): boolean {
    let count = 0;
    for (const cc of seg.cases) {
      for (const d of cc.dispatchKeys ?? []) {
        if (!d.key.startsWith('n:')) return false;
        count++;
      }
    }
    return count >= BaseCompiler.MATCH_SWITCH_THRESHOLD;
  }

  /** Emit an integer dispatch run as a `switch (s) { case k: … }` (no default —
   * a non-match falls through to the following statements, preserving
   * first-match order across segments). Or-alternatives share one body via
   * `case`-fallthrough; a constant already claimed by an earlier (first-match)
   * case is skipped to avoid a duplicate `case` label. */
  private static emitMatchSwitch(
    engine: ComputeEngine,
    seg: Extract<Segment, { kind: 'dispatch' }>,
    s: string,
    target: CompileTarget<Expression>
  ): string {
    const nl = target.ws('\n');
    const seen = new Set<number>();
    const parts: string[] = [];
    for (const cc of seg.cases) {
      const labels: string[] = [];
      for (const d of cc.dispatchKeys ?? []) {
        const n = Number(d.key.slice(2));
        if (seen.has(n)) continue; // first-match-wins: earlier case owns it
        seen.add(n);
        labels.push(`case ${n}:`);
      }
      if (labels.length === 0) continue; // wholly shadowed → unreachable
      parts.push(
        `${labels.join(' ')} return ${BaseCompiler.compileMatchBody(cc, undefined, target)};`
      );
    }
    return `switch (${s}) {${nl}${parts.join(nl)}${nl}}`;
  }

  /**
   * Compile a `["Match", …]` to a nested ternary via a target-provided
   * `ternary` primitive — the path GPU targets use (they have no statement-level
   * IIFE or `switch`). Only tier 0/1 constant dispatch and a trailing
   * irrefutable case compile; tier 2 destructuring and refutable tier 3 fail
   * closed (D6). The subject is compiled once and inlined into each comparison
   * — once per leaf comparison, twice for a range pattern. That is safe for a
   * PURE subject only: `_gpu_rnd_draw` advances a runtime counter, so an
   * impure (Random-family) subject would be re-drawn per comparison. Such a
   * subject is bound to a hoisted temporary instead (it is evaluated
   * unconditionally, before any case, so hoisting it is sound); with no
   * statement sink to hoist into, this declines (D6).
   */
  static compileMatchTernary(
    engine: ComputeEngine,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    opts: {
      ternary: (cond: string, whenTrue: string, whenFalse: string) => string;
      eq: string;
      noMatch: string;
      allowStrings: boolean;
      /**
       * Wrap a CONDITIONALLY-evaluated piece — a case body, a case guard, or a
       * condition past the first — so a target that forbids hoisting out of a
       * branch can fail closed on exactly those pieces. The SUBJECT is compiled
       * outside it: it is evaluated unconditionally, before any case. Defaults
       * to running the piece unwrapped.
       */
      arm?: (compiled: () => string) => string;
    }
  ): TargetSource {
    const plan = getMatchPlan(engine, args);
    if (plan.errorAlt !== undefined)
      throw new Error(
        `Match: an or-alternative binds the name '${plan.errorAlt.toString()}'; not compilable. Fail closed (D6).`
      );

    // The subject is UNCONDITIONAL — compiled once, before any case — so it is
    // deliberately outside `opts.arm`: whatever it hoists runs on every path.
    let subj = BaseCompiler.compile(args[0], target);
    // …but it is SPLICED once per comparison (twice for a range pattern), so
    // an impure (Random-family) subject has to be bound to a temporary first.
    if (args[0].isPure === false) {
      if (!BaseCompiler.canHoist(target))
        throw new Error(
          'Match: an impure (Random) subject cannot be bound to a temporary ' +
            'at this position — the subject is spliced into every case ' +
            'comparison, and a repeated draw would shift every later value ' +
            'in the shader. Fail closed (D6).'
        );
      const t = BaseCompiler.tempVar(target);
      const decl = target.language === 'wgsl' ? `var ${t}: f32` : `float ${t}`;
      BaseCompiler.hoistStatement(target, `${decl} = ${subj};`);
      subj = t;
    }
    const cases = plan.segments.flatMap((seg) => seg.cases);
    const run = opts.arm ?? ((f: () => string) => f());

    const build = (i: number): string => {
      if (i >= cases.length) return opts.noMatch;
      const cc = cases[i];
      // Only a leading irrefutable case is unconditional; anything reached past
      // an earlier condition sits behind a branch.
      const armed = i === 0 ? (f: () => string) => f() : run;
      if (BaseCompiler.isIrrefutableCase(cc)) {
        const acc =
          cc.captureNames.length === 1
            ? new Map([[cc.captureNames[0], subj]])
            : undefined;
        return armed(() => BaseCompiler.compileMatchBody(cc, acc, target));
      }
      if (cc.tier === 0 || cc.tier === 1) {
        const cond = armed(() =>
          BaseCompiler.matchLeafCondition(
            engine,
            cc,
            subj,
            opts.eq,
            opts.allowStrings,
            target
          )
        );
        // The guard sits behind `&&` (short-circuiting) and the body behind the
        // branch, so both are conditional even in the FIRST case.
        const guard =
          cc.hasGuard && cc.guard !== undefined
            ? run(() => BaseCompiler.compileMatchGuard(cc, undefined, target)!)
            : undefined;
        const full = guard === undefined ? cond : `(${cond}) && (${guard})`;
        return opts.ternary(
          full,
          run(() => BaseCompiler.compileMatchBody(cc, undefined, target)),
          build(i + 1)
        );
      }
      if (cc.tier === 2)
        throw new Error(
          `Match: list/tuple destructuring is not compilable to "${target.language ?? 'this'}". Fail closed (D6).`
        );
      const p = cc.rawPatterns?.[0];
      throw new Error(
        `Match: pattern '${p?.toString() ?? '?'}' is not compilable; ` +
          `rewrite with destructuring or guards. Fail closed (D6).`
      );
    };

    return build(0);
  }

  /**
   * If `id` names a symbol that is *known* to the engine — it has an assigned
   * value (`ce.assign("a", 1.5)`) or is a declared constant — return the
   * compiled target code for that value, i.e. **fold** the value into the
   * generated code the way `evaluate()` does. Returns `undefined` for a
   * genuinely free symbol (no value), so the caller falls back to its
   * free-symbol plumbing (a `vars` mapping, a `_.id` argument lookup, or a
   * declarable identifier).
   *
   * This keeps the compiled output consistent with `expr.unknowns` and
   * `evaluate()`: a symbol they treat as known (folded / dropped) is also
   * folded by `compile()`, instead of being emitted as a bare, dangling
   * reference (an undeclared GLSL identifier, or a bare JS global that throws
   * `ReferenceError` at run time).
   *
   * Callers MUST resolve any `vars` mapping for `id` **before** calling this,
   * so an explicitly `vars`-mapped symbol is never folded — the GPU/JS live
   * path relies on a mapped symbol staying a per-frame uniform / argument.
   *
   * `target` is the in-flight target: nested symbols inside the value resolve
   * through the same `vars`/constant/fold rules as the top-level expression.
   *
   * The value is compiled at a high precedence so a compound (operator) value
   * self-parenthesizes: folding `b = c + 1` into `b * x` must yield
   * `(c + 1) * x`, not `c + 1 * x`, and must stay safe when a handler splices
   * the folded string into its own expression (e.g. `Power`'s `(code * code)`).
   * An atomic value (number, symbol, function call) ignores the precedence, so
   * no redundant parentheses are added in the common assigned-number case.
   */
  static tryFoldKnownSymbol(
    engine: ComputeEngine,
    id: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    const value = engine._getSymbolValue(id);
    if (value === undefined) return undefined;
    BaseCompiler.assertFoldableSize(engine, id, value, target);
    // The generated code bakes this symbol's current value: record it in the
    // capture set (see `CompileTarget.symbolDeps`). Nested symbols inside the
    // value are recorded by the recursive compile below.
    target.symbolDeps?.add(id);
    return BaseCompiler.compile(value, target, BaseCompiler.FOLD_OPERAND_PREC);
  }

  /**
   * Number of nodes the generated source would contain if `value` were folded
   * in — the EXPANDED count, which charges a shared sub-value once per path
   * that reaches it, because that is how many times the emitter writes it out.
   *
   * The walk itself stays linear in the number of DISTINCT nodes: each node
   * object's expanded size is computed once and memoized under its own
   * identity, so the tower whose emission quadruples per level is sized in a
   * few dozen steps rather than by enumerating billions of paths. A symbol is
   * charged the size of the value the emitter would fold in its place, which
   * is where the per-path multiplication comes from; a name the target has
   * already bound (a parameter, a loop index) or that the caller supplied
   * through `vars` is a run-time variable, not a fold, and counts as one node.
   *
   * A value that refers to itself (`a := a + 1`, which the emitter cannot
   * compile either) would make the walk non-terminating, so a node currently
   * being sized counts as one node when it is re-entered.
   *
   * Children not reachable through `ops` (a dictionary's values) are followed
   * explicitly. An application's operator HEAD is deliberately not charged: a
   * head is either a target primitive or a user function the emitter declares
   * ONCE as a shared local, so it does not multiply along paths. Anything else
   * counts as a leaf, which can only make the count an underestimate — never
   * an overestimate that would refuse a legitimate fold.
   */
  private static expandedFoldSize(
    engine: ComputeEngine,
    value: Expression,
    target: CompileTarget<Expression>
  ): number {
    const memo = new Map<Expression, number>();
    const inProgress = new Set<Expression>();

    const walk = (node: Expression): number => {
      const cached = memo.get(node);
      if (cached !== undefined) return cached;
      if (inProgress.has(node)) return 1;
      inProgress.add(node);
      let size = 1;
      if (isSymbol(node)) {
        const s = node.symbol;
        if (
          target.boundVars?.has(s) !== true &&
          target.varsKeys?.has(s) !== true
        ) {
          const v = engine._getSymbolValue(s);
          if (v !== undefined) size = walk(v);
        }
      } else if (isDictionary(node)) {
        for (const v of node.values) size += walk(v);
      } else if (isFunction(node)) {
        for (const op of node.ops) size += walk(op);
      }
      inProgress.delete(node);
      memo.set(node, size);
      return size;
    };

    return walk(value);
  }

  /**
   * Refuse to fold `id`'s assigned value when baking it would emit more than
   * `MAX_FOLD_EXPANDED_NODES` nodes of source.
   *
   * This fails CLOSED rather than declining, because a decline is not safe
   * here: when `tryFoldKnownSymbol` returns `undefined` the caller emits a
   * bare identifier for a symbol the engine knows, and the JavaScript target
   * deliberately leaves such a name unresolved — the artifact would carry a
   * dangling global that throws (or silently reads `undefined`) at run time.
   * Refusing at compile time is the honest answer: on the public `compile()`
   * route the default `fallback: true` turns it into interpreter-backed
   * evaluation, which is correct though slower, and a caller that asked for
   * `fallback: false` (or drove a registered target directly) sees the error.
   */
  private static assertFoldableSize(
    engine: ComputeEngine,
    id: string,
    value: Expression,
    target: CompileTarget<Expression>
  ): void {
    const size = BaseCompiler.expandedFoldSize(engine, value, target);
    if (size <= BaseCompiler.MAX_FOLD_EXPANDED_NODES) return;
    const kb = (size * BaseCompiler.FOLD_CHARS_PER_NODE) / 1024;
    const emitted =
      kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
    throw new Error(
      `${id}: cannot compile — the value assigned to this symbol expands to ` +
        `${size} nodes of generated source (an estimated ${emitted}) ` +
        `once baked in, above the fold-size limit of ` +
        `${BaseCompiler.MAX_FOLD_EXPANDED_NODES} nodes. Generated source is ` +
        `text, so a sub-value shared by several references is written out ` +
        `once per reference path; folding this value is refused rather than ` +
        `emitting a program that size. A caller using the default ` +
        `\`fallback: true\` falls back to interpreted evaluation. Fail ` +
        `closed (D6).`
    );
  }

  /**
   * If `id` names a symbol whose engine definition is a user-defined function
   * literal, return that `["Function", body, …params]` literal; otherwise
   * `undefined`. Covers both storage routes:
   *  - an operator definition backed by a lambda (`f(x) := …`, `x ↦ …`, or
   *    `ce.assign(name, lambda)`), where the literal is kept on the operator
   *    definition as `_lambdaLiteral`; and
   *  - a plain symbol whose assigned value is itself a `Function` literal.
   *
   * Public so compilation targets can check whether a symbol operand is
   * structurally callable (e.g. the `Reduce` combiner) before compiling it.
   */
  static userFunctionLiteral(
    engine: ComputeEngine,
    id: string
  ): (Expression & FunctionInterface) | undefined {
    const def = engine.lookupDefinition(id);
    if (def && 'operator' in def) {
      const literal = (def.operator as { _lambdaLiteral?: Expression })
        ._lambdaLiteral;
      if (literal !== undefined && isFunction(literal, 'Function'))
        return literal;
    }
    const value = engine._getSymbolValue(id);
    if (value !== undefined && isFunction(value, 'Function')) return value;
    return undefined;
  }

  /**
   * Generated local-function name for a user-defined function `id`. Prefixed to
   * avoid colliding with the vars object (`_.<name>`) and with target helpers;
   * non-identifier characters are folded to `_` so the emitted declaration is a
   * valid target identifier.
   *
   * A user function is emitted ONCE per compilation, under this one name:
   * how a wide parameter is shaped is a property of the compile MODE
   * (strict/auto: real, a complex-shaped argument to it is a `LaneMismatch`
   * decline that `auto` escalates; complex: complex, lifted at use), never
   * of the call site. (The per-call-site `_fn_b$z1` lane specializations
   * that preceded the compile modes were retired 2026-08-16.) `$` cannot
   * appear in a MathJSON symbol, so the `$c<n>` multi-clause helper names and
   * the `$…$e<n>` protocol helper names can never collide with a user
   * function's emitted name.
   */
  private static userFunctionName(id: string): string {
    return `_fn_${id.replace(/[^\w$]/g, '_')}`;
  }

  /**
   * Is every element of the collection `a` a complex SCALAR? Answered from
   * the element TYPE when it is a non-real number type (`list<complex>`), or
   * from the identifiable elements when they all agree
   * (`uniformElementComplexness`, e.g. the literal `[w, 2w]`) and the element
   * type is at least numeric (so a nested list is never mistaken for a
   * scalar). `false` whenever it cannot be established.
   */
  static hasUniformComplexScalarElements(a: Expression): boolean {
    const elt = BaseCompiler.collectionElementTypeOf(a);
    if (elt === undefined) return false;
    if (isNonRealNumber(elt)) return true;
    if (!isSubtype(elt, 'number')) return false;
    return BaseCompiler.uniformElementComplexness(a) === true;
  }

  /**
   * STRICT discipline (design §3, "user-function VALUE position" row): a
   * bare user-function symbol `callback` used as an ELEMENT callback over a
   * `source` whose elements are complex scalars, when the function's single
   * parameter is WIDE, is a `LaneMismatch` decline — the value-position
   * emission is the one real-shaped `_fn_f`, and complex elements would be
   * consumed as numbers. Under `auto` the engine-level `compile()` escalates
   * this to complex mode, where the one emission lifts its parameter at use.
   * A parameter DECLARED complex is not a mismatch (the call coerces into
   * it). No-op outside the strict-shaped disciplines, or when `callback` is
   * not a unary user function.
   */
  static assertCallbackLaneMatch(
    callback: Expression | undefined,
    source: Expression | undefined
  ): void {
    if (!BaseCompiler.strictLanes) return;
    if (callback === undefined || source === undefined) return;
    if (!isSymbol(callback)) return;
    const engine = callback.engine;
    const literal = BaseCompiler.userFunctionLiteral(engine, callback.symbol);
    if (literal === undefined || literal.ops.length !== 2) return;
    if (!BaseCompiler.hasUniformComplexScalarElements(source)) return;
    const pt = BaseCompiler.userFunctionParamType(engine, callback.symbol, 0);
    if (pt === undefined || !isNonRealNumber(pt))
      BaseCompiler.laneMismatch(
        'user-function value position',
        BaseCompiler.userParamBinding(callback.symbol, literal, 0),
        source
      );
  }

  /**
   * `provablyScalarArg`, extended to a symbol the innermost local shape frame
   * records as a SCALAR (`LOCAL_SCALAR`). A declared-complex parameter is
   * entered that way (`addDeclaredComplexParams`): its declared type says
   * complex but not "scalar" to `provablyScalarArg`, yet a complex-typed
   * parameter holds exactly one complex object, and a nested call passing it
   * on (`c(x: complex) := b(x) + 1`) must see a scalar argument.
   */
  private static provablyScalarOrFramedScalar(a: Expression): boolean {
    if (BaseCompiler.provablyScalarArg(a)) return true;
    if (!isSymbol(a)) return false;
    return (
      BaseCompiler.localShapeFrameOf(a.symbol)?.get(a.symbol) ===
      BaseCompiler.LOCAL_SCALAR
    );
  }

  /**
   * Enter every parameter of `h` whose DECLARED type is a non-real number into
   * the body's complex shape frame.
   *
   * A declared-complex parameter is a property of the FUNCTION, not of any one
   * call: the one emission is the complex-lane one for that parameter and
   * every call site coerces its argument to match. Silent
   * on a generic or multi-clause signature, where `userFunctionParamType`
   * declines — those keep the previous emission exactly.
   */
  private static addDeclaredComplexParams(
    h: string,
    literal: Expression & FunctionInterface,
    target: CompileTarget<Expression>,
    frames: { complex: Map<string, boolean>; vector: Map<string, number> }
  ): void {
    // The `{ re, im }` representation is a JavaScript convention, and BOTH
    // call-site coercions bail on any other language — so the body-side lane
    // must too, or a target that never wraps its arguments (interval-javascript
    // reaches this same arrow emission) would compile the body against an
    // object it is never handed.
    if (target.language !== 'javascript') return;
    const engine = literal.engine as unknown as ComputeEngine;
    literal.ops.slice(1).forEach((p, i) => {
      const name = functionLiteralParameterName(p);
      if (!name) return;
      const pt = BaseCompiler.userFunctionParamType(engine, h, i);
      if (pt === undefined || !isNonRealNumber(pt)) return;
      frames.complex.set(name, true);
      frames.vector.set(name, BaseCompiler.LOCAL_SCALAR);
    });
  }

  /**
   * If head `h` names a user-defined function (see `userFunctionLiteral`),
   * ensure its definition is emitted once into `target.userFunctions.defs` as a
   * named local function and return the call-site source `_fn_h(arg, …)`.
   * Returns `undefined` when `h` is a genuinely unknown operator (no such
   * definition — the caller then throws), or when the target opts out of user
   * functions by not providing a `userFunctions` registry.
   *
   * Recursion (including mutual recursion) compiles to true self/cross
   * reference by emitted name: while a definition's body is being compiled its
   * name sits in `compiling`, and a re-entrant reference emits a call to that
   * name rather than re-emitting (or looping on) the definition. Termination
   * is not guaranteed by the emitted code — runaway recursion surfaces as the
   * host's stack-exhaustion error (a catchable `RangeError` in JS), matching
   * the contract of compiled unbounded `Loop`.
   *
   * Capture semantics: the body is compiled once, at compile time, through the
   * *same* `target` var/fold rules as the surrounding expression (only the
   * parameters are shadowed). Free symbols and constants the body references are
   * therefore snapshotted exactly like the constant-baking `tryFoldKnownSymbol`
   * performs elsewhere — a later reassignment of a captured outer symbol does
   * not affect an already-compiled function.
   */
  static tryCompileUserFunction(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource | undefined {
    // Fail closed (D6) BEFORE emission: whether the callee can be emitted at
    // all is irrelevant to whether an emitted call would be sound, and the
    // caller's generic "no lowering" message hides the real reason.
    BaseCompiler.checkDeclaredBroadcast(
      engine,
      h,
      args,
      BaseCompiler.provablyScalarArg
    );

    // The complex lanes are a JavaScript-convention matter (`{re, im}`
    // objects flowing through parameters). A target with its own definition
    // lowering (the shader targets) synthesizes a STATIC signature from the
    // declared parameter types and checks the call's argument shapes against
    // it, so a complex argument to a real-typed parameter fails closed there
    // rather than needing a specialization; hand those targets the real lane.
    // STRICT discipline (design §3, "user-function parameter" row): a
    // complex-shaped scalar argument bound to a parameter the function does
    // not declare complex is a LaneMismatch DECLINE — the body was shaped
    // real for that parameter, and neither a per-call-site specialization
    // nor a real-lane emission is the strict answer (`auto` escalates it to
    // complex mode). Checked before emission, like the broadcast gate above:
    // whether the callee can be emitted is irrelevant to whether this call
    // is sound. A target with its own definition lowering (the shader
    // targets) checks the argument shapes against its static signature.
    if (BaseCompiler.strictLanes && !target.userFunctions?.lowering) {
      const literal = BaseCompiler.userFunctionLiteral(engine, h);
      if (literal !== undefined) {
        const i = BaseCompiler.laneMismatchAt(engine, h, literal, args);
        if (i >= 0)
          BaseCompiler.laneMismatch(
            'user-function parameter',
            BaseCompiler.userParamBinding(h, literal, i),
            args[i]
          );
      } else {
        // A multi-clause function (no single literal): each clause's
        // parameter is a binding of its own. A complex-shaped scalar argument
        // at a position where some clause's parameter is WIDE — a type that
        // admits the value at dispatch (its JS guard accepts a `{re, im}`)
        // while its body was shaped real — is the same mismatch. A clause
        // parameter typed real-only rejects the value at dispatch (faithful),
        // and one typed complex is coerced per clause in the dispatcher.
        const i = BaseCompiler.multiClauseLaneMismatchAt(engine, h, args);
        if (i >= 0)
          BaseCompiler.laneMismatch(
            'multi-clause clause parameter',
            `parameter ${i + 1} of the multi-clause function \`${h}\``,
            args[i]
          );
      }
    }
    // A callee the target cannot emit as a definition — a shader target
    // given a point-typed parameter it has no static type for, the interval
    // target given a body with a head it has no lowering for — is compiled
    // INLINED at this call site when that is sound (`tryInlineUserFunctionCall`);
    // the definition's own decline is rethrown when it is not.
    let name: string | undefined;
    try {
      name = BaseCompiler.ensureUserFunctionEmitted(engine, h, target);
    } catch (e) {
      // A cancellation (deadline, abort, iteration limit) must propagate;
      // identified by NAME, never `instanceof` — a plugin bundle re-bundles
      // the engine, so a `CancellationError` crossing a bundle boundary is
      // not an instance of the host's class (the `box.ts` convention).
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      const inlined = BaseCompiler.tryInlineUserFunctionCall(
        engine,
        h,
        args,
        target
      );
      if (inlined !== undefined) return inlined;
      throw e;
    }
    if (name === undefined) return undefined;

    // A target with its own call-site lowering (the shader targets, which must
    // check the argument shapes against the statically synthesized signature)
    // owns the whole call site: none of the JS convention handling below —
    // complex `{re, im}` coercion, the `_SYS.bcastFn` runtime broadcast — has
    // an analog there.
    const lowering = target.userFunctions?.lowering;
    if (lowering) return lowering.call({ id: h, name, args, target });

    // A real-analyzed argument bound to a complex-typed parameter is coerced
    // to the `{ re, im }` convention (the call-boundary face of the Tycho
    // item-60 convention-mismatch class): the body consumes such a parameter
    // through complex slots, so a plain number argument — e.g. the seed `0`
    // in `M(10, 0)`, after `Complex(0, 0)` canonicalizes to a real literal —
    // would NaN-poison the whole call. The coercion is PER PARAMETER: on the
    // broadcast path below it is applied inside the scalar closure, to the
    // element, not to the whole argument.
    // Gated on the PARAMETER's declared type alone, never on the argument's:
    // the callee's body is compiled in the complex lane for a declared-complex
    // parameter whatever the call site passes, so every call owes it a
    // `{ re, im }`. Restricting this to a provably-REAL argument left the
    // other arguments unwrapped against a complex-lane body — the
    // `'[object Object]0'` class. `emitUserFunctionCall` picks the static wrap
    // or the runtime `_SYS.cplx` per argument from its realness.
    const coerceToComplex = args.map((_a, i) => {
      if (target.language !== 'javascript') return false;
      const pt = BaseCompiler.userFunctionParamType(engine, h, i);
      if (pt !== undefined) return isNonRealNumber(pt);
      // A multi-clause function has an INTERSECTION signature, from which
      // `userFunctionParamType` reads no single parameter type — ask the
      // clause set instead.
      return BaseCompiler.multiClauseParamIsComplex(engine, h, i);
    });
    return BaseCompiler.emitUserFunctionCall(
      name,
      args,
      target,
      coerceToComplex,
      BaseCompiler.userFunctionParamsAreScalar(engine, h)
    );
  }

  /**
   * If head `h` names a FUNCTION-VALUED BLOCK LOCAL of an enclosing statement
   * list (`target.localFunctions` — `const g = (k) => …` earlier in the same
   * block), compile the call site as an ordinary call of that binding.
   *
   * The declaration itself already lowers to a value binding (`let g = ((k) =>
   * …)`) — only the CALL had no resolution: head lookup consults the engine's
   * definitions (`userFunctionLiteral`), which a block-local declaration never
   * enters (compiling must not mutate the engine), so `g(3)` reported
   * ``Unknown operator `g` `` even though the block bound `g` two lines above.
   *
   * The callee's signature is read from the declared LITERAL rather than from
   * an engine definition; everything downstream of that — complex `{re, im}`
   * coercion, the `_SYS.bcastFn` runtime broadcast — is the shared
   * `emitUserFunctionCall`, so a local and an engine-level function of the
   * same shape compile to the same call.
   *
   * Returns `undefined` when `h` is not such a local, leaving the caller's
   * fail-closed throw in place. An ARITY mismatch fails closed here instead:
   * JavaScript would silently pass `undefined` for a missing argument (the
   * body then computing `NaN`), where the interpreter reports an error.
   */
  private static tryCompileLocalFunctionCall(
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource | undefined {
    const literal = target.localFunctions?.get(h);
    // Re-narrowed rather than typed on the map: `CompileTarget` is generic in
    // its expression type, so the map's value type carries no operand access.
    if (literal === undefined || !isFunction(literal, 'Function'))
      return undefined;

    // `["Function", body, ...params]` — one operand per declared parameter
    // after the body.
    const arity = literal.ops.length - 1;
    if (args.length !== arity)
      throw new Error(
        `${h}: cannot compile — the block-local function is declared with ` +
          `${arity} parameter${arity === 1 ? '' : 's'} but called with ` +
          `${args.length}. JavaScript would bind the missing parameters to ` +
          `\`undefined\` and compute NaN, where the interpreter reports an ` +
          `error. Fail closed (D6).`
      );

    // A call of a CLOSED local with constant arguments is itself constant, so
    // it folds — `g(3)` to `14` — exactly as the same call of an engine-level
    // function does. Without this the two Epsil spellings of one definition
    // compiled differently: `function g(k) { … }` DECLARES `g` in the engine
    // as it canonicalizes, so `["g", 3]` reached the folder with no unknown
    // head and folded, while the `const g = (k) => …` binding declares
    // nothing and left the call unfolded.
    //
    // The fold runs on `Apply(literal, …args)` — the call written in a form
    // that carries its own callee — and is decided by the ordinary
    // `tryConstantFold` gates, not by a second copy of them: a non-constant
    // argument, an impure body, an unbounded big-op, a caller-overridden name
    // and a `constantFold: false` all decline there. In particular a body that
    // references ANOTHER compile-bound name — a sibling local, or the local's
    // own name in a recursive definition — declines on
    // `mentionsCompileBoundName`, since those names have no engine value the
    // fold could evaluate through.
    const folded = BaseCompiler.tryConstantFold(
      literal.engine.function('Apply', [literal, ...args]),
      target,
      BaseCompiler.FOLD_OPERAND_PREC
    );
    if (folded !== undefined) return folded;

    const signature = literal.type?.type;

    // The two fail-closed gates the ENGINE-defined route enforces, applied to
    // the declared LITERAL's signature. Both are about what the emitted call
    // would COMPUTE, not about whether the callee can be emitted, so a local
    // is no more exempt from them than a definition is.
    //
    // GENERIC. A polymorphic signature's parameter is a type VARIABLE, which
    // the compiler can neither coerce nor decide a broadcast against; the
    // engine route declines such a callee outright in
    // `ensureUserFunctionEmitted` (rule G3, generic-function-literals design
    // §2.7). Emitting the call anyway would run the scalar body on whatever
    // the argument happens to be.
    if (signature !== undefined && isPolymorphicType(signature))
      throw new Error(
        `${h}: cannot compile — the block-local function has a GENERIC ` +
          `signature, whose parameters are type variables the compiler cannot ` +
          `resolve at the call site (rule G3). Fail closed (D6). Evaluate ` +
          `this expression with evaluate() instead, or annotate the ` +
          `parameters with ground types.`
      );

    // DECLARED `broadcastable<T>`. An elementwise contract that maps exactly
    // one rank down, which neither emitted call form expresses — see
    // `checkDeclaredBroadcast` for the full rule. Without this,
    // `const pair = (x: broadcastable<value>) => (x, x)` applied to a list
    // emitted a direct call and answered `[[1,2,3],[1,2,3]]` where the
    // interpreter answers `[(1,1),(2,2),(3,3)]`.
    BaseCompiler.checkDeclaredBroadcastAgainst(
      h,
      args,
      BaseCompiler.provablyScalarArg,
      broadcastableParamSlots(signature),
      () => declaresBroadcastableParam(signature)
    );

    const paramTypes =
      typeof signature === 'object' && signature.kind === 'signature'
        ? signature.args
        : undefined;
    // Parameter-typed, not argument-typed — see the sibling computation in
    // `ensureUserFunctionEmitted` for why.
    const coerceToComplex = args.map((_a, i) => {
      if (target.language !== 'javascript') return false;
      const pt = paramTypes?.[i]?.type;
      return pt !== undefined && isNonRealNumber(pt);
    });

    return BaseCompiler.emitUserFunctionCall(
      target.var(h) ?? h,
      args,
      target,
      coerceToComplex,
      signature === undefined ? true : paramsAreScalar(signature)
    );
  }

  /**
   * The `{ re, im }` delivery of argument `arg` (compiled as `code`) to a
   * declared-complex parameter, in whichever of three forms the argument's
   * static shape already settles:
   *
   *  - provably COMPLEX: the emitted code is already an object, so it is
   *    passed through untouched — no wrap, no runtime test. Only a complex
   *    NUMBER LITERAL qualifies, and only because this compiler emits it as
   *    the `{ re, im }` object itself, so the wrap would be pure redundancy.
   *    Neither looser test works: `isComplexValued` answers "could be
   *    complex" and is true for an untyped symbol, and the TYPE is no better
   *    — `Q(w)` INFERS `w: complex` from the declared parameter, yet `run({
   *    w: 2 })` may still supply a plain number, since a real is a complex.
   *    Both dropped the wrap from the very case that needs it;
   *  - provably REAL: wrapped statically, the shape being known;
   *  - neither (an untyped free symbol bound at `run()` time — the common
   *    case): the caller may hand over a plain number OR an already-complex
   *    object and only a runtime test can tell, so `_SYS.cplx` decides. It
   *    is idempotent, so an object passes through instead of nesting.
   *
   * Shared by the single-literal call site (`emitUserFunctionCall`) and the
   * protocol member dispatch (`userFunctionsPreamble`), so the two agree.
   */
  private static complexWrapCode(
    code: string,
    arg: Expression | undefined,
    target?: CompileTarget<Expression>
  ): string {
    if (
      arg !== undefined &&
      isNumber(arg) &&
      arg.isNumberLiteral === true &&
      isNonRealNumber(arg.type.type)
    )
      return code;
    if (arg !== undefined && BaseCompiler.isProvablyRealValued(arg, target))
      return `({ re: ${code}, im: 0 })`;
    return `_SYS.cplx(${code})`;
  }

  /**
   * The call site of an already-emitted user function `name`: either a direct
   * scalar call or the runtime broadcast dispatch, per the rules below.
   *
   * Shared by the ENGINE-defined route (`tryCompileUserFunction`) and the
   * BLOCK-LOCAL route (`tryCompileLocalFunctionCall`), which differ only in
   * where they read the callee's signature from — the engine's definition
   * versus the declared literal's own type — never in how the call is spelled.
   *
   * `coerceToComplex[i]` marks an argument to wrap in the `{ re, im }`
   * convention; `paramsAreScalar` says no parameter binds a collection whole.
   */
  private static emitUserFunctionCall(
    name: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    coerceToComplex: ReadonlyArray<boolean>,
    paramsAreScalar: boolean
  ): TargetSource {
    const provablyScalarArg = BaseCompiler.provablyScalarArg;

    const compiledArgs = args.map((a) =>
      BaseCompiler.compileValueOperand(a, target)
    );
    // Deliver a `{ re, im }` to a declared-complex parameter, in whichever of
    // three forms the argument's static shape already settles:
    //
    //  - provably COMPLEX: the emitted code is already an object, so it is
    //    passed through untouched — no wrap, no runtime test;
    //  - provably REAL: wrapped statically, the shape being known;
    //  - neither (an untyped free symbol bound at `run()` time — the common
    //    case): the caller may hand over a plain number OR an already-complex
    //    object and only a runtime test can tell, so `_SYS.cplx` decides. It
    //    is idempotent, so an object passes through instead of nesting.
    const complexWrap = BaseCompiler.complexWrapCode;

    // The interpreter BROADCASTS a user function over a collection argument
    // (`applyFunctionLiteral` / the step-2b lambda broadcast): `q(L)` with
    // `q: t ↦ n·t+1` and `L = [1,2,3]` answers `[5,9,13]`, not a scalar. The
    // emitted callee is SCALAR code, so a bare `_fn_q([1,2,3])` computes
    // `4*[1,2,3]+1` — the string-coerced NaN this dispatch fixes.
    //
    // Mirroring the interpreter's *runtime* dispatch (the item-34 ruling)
    // rather than a compile-time "is this operand provably a collection?"
    // gate: `_SYS.bcast` applies the scalar closure directly when no argument
    // is an array and maps it element-wise otherwise, so a declared type wider
    // than the runtime value costs nothing. Length mismatches project the
    // interpreter's `incompatible-dimensions` error to NaN, as everywhere else
    // in `bcast`.
    //
    // What is decided at compile time is only a property of the CALLEE and of
    // the argument's static shape class, both of which the interpreter also
    // reads statically:
    //   - `paramsAreScalar`: a collection-typed parameter binds its argument
    //     WHOLE (`f: (list<number>) -> number`), so it must not be mapped;
    //   - a TUPLE argument is atomic (a point/vector), excluded from broadcast
    //     by the interpreter yet lowered to a JS array here — `bcast` would
    //     map over its components. Leave those on the direct-call path;
    //   - a NOMINAL-TYPED argument is atomic for exactly the same reason
    //     (`isNominalAtomicArg`, ruled 2026-08-12 — see
    //     `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` context):
    //     D3 opacity means the interpreter binds the whole tagged value, but
    //     D11 erasure lowers `bag([1,2,3])` to the bare JS array, which
    //     `bcastFn`'s runtime `Array.isArray` dispatch would then map over —
    //     `size(bag([1,2,3]))` answering `[42,42,42]` where the interpreter
    //     answers `42`. Leave those on the direct-call path too;
    //   - every argument PROVABLY not a collection (`provablyScalarArg`, at
    //     the top of this function) can never broadcast at run time, so the
    //     dispatch would be dead weight in the hot path.
    // The dispatch is `_SYS.bcastFn`, not `_SYS.bcast`: applying a function
    // literal to an EMPTY collection zips zero elements and answers `[]` in
    // the interpreter, where an empty operator position answers `Nothing`
    // (NaN). Everything else — mismatch → NaN, scalar reuse, nesting — is
    // shared.
    if (
      target.language === 'javascript' &&
      args.length > 0 &&
      !args.every(provablyScalarArg) &&
      !args.some((a) => isTuple(a)) &&
      !args.some((a) => BaseCompiler.isNominalAtomicArg(a)) &&
      paramsAreScalar
    ) {
      // A complex-typed parameter is coerced INSIDE the closure, on the
      // element the broadcast selected: wrapping the whole argument would
      // both hand the callee `{ re: [1,2,3], im: 0 }` and (before) force the
      // entire call onto the direct scalar path, so a sibling collection
      // argument never broadcast.
      const params = args.map(() => BaseCompiler.tempVar(target));
      // Inside the broadcast closure the wrap applies to the ELEMENT the
      // broadcast selected, but the ARGUMENT's realness still settles it: a
      // provably real-valued operand — a scalar like `0`, or a collection of
      // reals — yields only real elements, so the static wrap holds and no
      // runtime test is emitted. Anything else takes `_SYS.cplx`.
      const callParams = params.map((p, i) =>
        coerceToComplex[i] ? complexWrap(p, args[i], target) : p
      );
      return `_SYS.bcastFn((${params.join(', ')}) => ${name}(${callParams.join(
        ', '
      )}), ${compiledArgs.join(', ')})`;
    }

    return `${name}(${compiledArgs
      .map((code, i) =>
        coerceToComplex[i] ? complexWrap(code, args[i], target) : code
      )
      .join(', ')})`;
  }

  /**
   * Is `a`'s STATIC type one whose values are ATOMIC at a call site — bound
   * WHOLE by the interpreter, never mapped over? The nominal counterpart of
   * the `isTuple` clause above (ruled 2026-08-12, context in
   * `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md`).
   *
   * Keyed on the static TYPE, not on the expression's shape: `size(b)` with
   * `b: bag` is as atomic as `size(bag([1,2,3]))`.
   *
   * Two answers are `true`:
   *  - an OPAQUE nominal reference (`alias !== true`). D3: a nominal's
   *    representation is not its definition, so the interpreter binds the
   *    tagged value whole. Compilation erases the tag (D11), and the bare
   *    array left behind is what `bcastFn` would wrongly map.
   *  - a TRANSPARENT alias reference that is a sugar-declared SUM — its
   *    declaration record carries `_sumVariants`. Every arm of such a sum is
   *    a nominal, so every runtime value is atomic by the clause above,
   *    whichever arm it came from. (Under the TAGGED policy the value is a
   *    `{_tag}` object, which `bcastFn` would not map anyway; under the
   *    ERASED policy it can be a bare array, which it would. The static test
   *    covers both uniformly.)
   *
   * Everything else is `false` — in particular a plain transparent alias
   * (`type alias mylist = list<number>`), which the interpreter DOES look
   * through and DOES broadcast over, and a hand-written union, which carries
   * no sum identity.
   *
   * `alias` is read through the LIVE accessor (it delegates to the
   * declaration record — a forward reference is created nominal-by-default
   * and flipped when the `type alias` that fulfils it is parsed), and
   * `_sumVariants` through {@link declarationOf}, since it lives on the
   * declaration record and never on an applied reference.
   */
  private static isNominalAtomicArg(a: Expression): boolean {
    const t = a.type.type;
    if (typeof t === 'string' || t.kind !== 'reference') return false;
    if (t.alias !== true) return true;
    return declarationOf(t)._sumVariants !== undefined;
  }

  /**
   * Does user-defined function `h` broadcast over a collection argument, i.e.
   * are all of its formal parameters scalar? Mirrors the interpreter's
   * broadcast gate (`applyFunctionLiteral` / step 2b in `boxed-function.ts`):
   * the DECLARED signature is authoritative when there is one, the literal's
   * own inferred type is the fallback. Conservative (`unknown` → scalar), the
   * same way `paramsAreScalar` is.
   */
  private static userFunctionParamsAreScalar(
    engine: ComputeEngine,
    h: string
  ): boolean {
    const def = engine.lookupDefinition(h);
    if (!def) return true;
    if (isOperatorDef(def)) return paramsAreScalar(def.operator);
    if (!('value' in def) || def.value === undefined) return true;
    const declared = def.value.type?.type;
    if (typeof declared === 'object' && declared.kind === 'signature') {
      // A GENERIC signature has open parameters: it neither broadcasts nor
      // coerces (a generic user function declines whole-fn — G3,
      // generic-function-literals design §2.7, enforced in
      // `ensureUserFunctionEmitted`). Answering `true` here would silently
      // claim scalar parameters for a `(T) -> T where T`.
      if (isPolymorphicType(declared)) return false;
      return paramsAreScalar(declared);
    }
    const literal = def.value.value?.type?.type;
    if (literal === undefined) return true;
    return paramsAreScalar(literal);
  }

  /**
   * Does the DECLARED signature of user-defined function `h` mark any
   * parameter `broadcastable<T>` — in ANY overload arm? Same definition
   * resolution as {@link userFunctionParamsAreScalar}; only the DECLARED type
   * counts (the contract is a declaration, never an inference), so an
   * unannotated literal answers `false` and every existing compilation is
   * untouched.
   */
  private static userFunctionHasBroadcastableParam(
    engine: ComputeEngine,
    h: string
  ): boolean {
    const def = engine.lookupDefinition(h);
    if (!def) return false;
    if (isOperatorDef(def)) return declaresBroadcastableParam(def.operator);
    if (!('value' in def) || def.value === undefined) return false;
    return (
      declaresBroadcastableParam(def.value.type?.type) ||
      declaresBroadcastableParam(def.value.value?.type?.type)
    );
  }

  /**
   * The PER-SLOT broadcast plan of user-defined function `h`, or `undefined`
   * when it declares no `broadcastable<T>` parameter — or when its type is an
   * overload set, which has no single plan (see
   * {@link declaresBroadcastableParam}).
   */
  private static userFunctionBroadcastPlan(
    engine: ComputeEngine,
    h: string
  ): BroadcastSlotPlan | undefined {
    const def = engine.lookupDefinition(h);
    if (!def) return undefined;
    if (isOperatorDef(def)) return broadcastableParamSlots(def.operator);
    if (!('value' in def) || def.value === undefined) return undefined;
    return (
      broadcastableParamSlots(def.value.type?.type) ??
      broadcastableParamSlots(def.value.value?.type?.type)
    );
  }

  /**
   * Fail closed (D6) rather than emit code for an application the DECLARED
   * `broadcastable<T>` contract would evaluate element-wise.
   *
   * A declared `broadcastable<T>` parameter is an ELEMENTWISE contract that
   * maps exactly ONE rank down (Option A, ratified 2026-08-08 —
   * `docs/plans/2026-08-08-broadcastable-param-semantics.md`). Neither emitted
   * form expresses it:
   *   - a direct scalar call hands the callee the whole array (`_fn_g([1,2,3])`
   *     computes the JS string `"1,2,31"` for `x + 1`);
   *   - `_SYS.bcastFn` recurses into NESTED arrays — that is the unannotated
   *     default's leaf descent, not the declaration's one rank — and is
   *     all-or-nothing across arguments, so a sibling slot the declaration
   *     binds WHOLE would be mapped too.
   *
   * PER SLOT, though: only an argument that could actually be MAPPED forces
   * the decline. A collection at a slot the contract binds whole compiles
   * exactly as it did before the declaration existed, and so does an atomic
   * TUPLE — or an atomic NOMINAL-typed value — the slot's element type
   * ADMITS (neither is ever mapped — rule 4, and the 2026-08-12 nominal
   * ruling). One the element type refutes is NOT exempt: the interpreter
   * answers `incompatible-type` there, and no emitted form says that.
   */
  /**
   * Is `a` PROVABLY not a collection (`number`/`boolean`/`string`-typed — a
   * plain numeric call such as `f(2)`), and so incapable of broadcasting at
   * run time? Note the direction: this decides only where the answer is
   * certain, so a type merely WIDER than the runtime value is treated as
   * possibly a collection.
   */
  private static readonly provablyScalarArg = (a: Expression): boolean =>
    a.type.matches('number') ||
    a.type.matches('boolean') ||
    a.type.matches('string');

  private static checkDeclaredBroadcast(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    provablyScalarArg: (a: Expression) => boolean
  ): void {
    BaseCompiler.checkDeclaredBroadcastAgainst(
      h,
      args,
      provablyScalarArg,
      BaseCompiler.userFunctionBroadcastPlan(engine, h),
      () => BaseCompiler.userFunctionHasBroadcastableParam(engine, h)
    );
  }

  /**
   * The body of {@link checkDeclaredBroadcast}, over a broadcast plan the
   * caller supplies rather than one read from an engine definition.
   *
   * Shared so the ENGINE-defined and BLOCK-LOCAL call routes enforce ONE
   * implementation of the gate. They differ only in where the callee's
   * declared shape comes from — a definition versus the declared literal's own
   * signature — and a second copy of the rule is exactly how the local route
   * came to emit a direct call for `const pair = (x: broadcastable<value>) =>
   * (x, x)`, answering a tuple of arrays where the interpreter answers an
   * elementwise list of pairs.
   */
  private static checkDeclaredBroadcastAgainst(
    h: string,
    args: ReadonlyArray<Expression>,
    provablyScalarArg: (a: Expression) => boolean,
    plan: BroadcastSlotPlan | undefined,
    hasBroadcastableParam: () => boolean
  ): void {
    if (args.length === 0) return;
    const risky =
      plan !== undefined
        ? args.some((a, i) => {
            const slot = plan.at(i);
            if (!slot.mappable || provablyScalarArg(a)) return false;
            // An ATOMIC argument — a tuple, or a nominal-typed value (see
            // {@link isNominalAtomicArg}; same 2026-08-12 ruling) — binds
            // whole, so it is safe to emit, provided the slot's element
            // contract actually admits it. Without the second clause this
            // gate would contradict the call-site carve-out below: it would
            // decline the very applications that carve-out proves atomic.
            if (isTuple(a) || BaseCompiler.isNominalAtomicArg(a))
              return !(
                slot.elements === undefined || a.type.matches(slot.elements)
              );
            return true;
          })
        : // An OVERLOAD set has no single plan — which arm binds is a runtime
          // question — so answer conservatively over the whole argument list.
          hasBroadcastableParam() && !args.every(provablyScalarArg);
    if (!risky) return;
    throw new Error(
      `${h}: cannot compile an application of a function with a declared \`broadcastable<T>\` parameter over a possibly-collection argument — the declaration maps ONE rank down and the compile targets map to the leaves. Fail closed (D6). Evaluate this expression with evaluate() instead, or declare the parameter as its element type.`
    );
  }

  /**
   * The declared type of positional parameter `i` of user-defined function
   * `h`, from its value definition's function type or its operator
   * definition's signature (required, then optional, then variadic).
   * `undefined` when no signature is known.
   */
  static userFunctionParamType(
    engine: ComputeEngine,
    h: string,
    i: number
  ): Type | undefined {
    const def = engine.lookupDefinition(h);
    if (!def) return undefined;
    const boxed =
      'value' in def && def.value !== undefined
        ? def.value.type
        : 'operator' in def
          ? def.operator.signature
          : undefined;
    const t = boxed?.type;
    if (t === undefined || typeof t === 'string' || t.kind !== 'signature')
      return undefined;
    // A GENERIC signature's parameter is a type VARIABLE, not a type the
    // compiler can coerce or broadcast against: DECLINE (return `undefined`,
    // never throw — the decline convention). The `kind !== 'signature'` guard
    // above does not catch it: `typeParams` lives ON the signature. Threading
    // call-site instantiated signatures into compilation is future work
    // (§6/§9.2 of the type-variables design).
    if (isPolymorphicType(t)) return undefined;
    const nArgs = t.args?.length ?? 0;
    if (i < nArgs) return t.args![i].type;
    const nOpt = t.optArgs?.length ?? 0;
    if (i < nArgs + nOpt) return t.optArgs![i - nArgs].type;
    return t.variadicArg?.type;
  }

  /**
   * Is positional parameter `i` of the MULTI-CLAUSE function `h` complex-
   * conventioned in every clause? The call-boundary coercion condition for a
   * clause set (`userFunctionParamType` reads nothing from an intersection
   * signature).
   *
   * Deliberately unanimous: where clauses disagree at a position (one `real`,
   * one `complex`), wrapping the argument would make it fail the real
   * clause's guard — the coercion would change DISPATCH, not just the
   * convention. Such positions stay uncoerced, as before.
   */
  private static multiClauseParamIsComplex(
    engine: ComputeEngine,
    h: string,
    i: number
  ): boolean {
    const state = multiClauseState(engine.lookupDefinition(h));
    if (state === undefined || state.clauses.length === 0) return false;
    return state.clauses.every((c) => {
      // A generic clause declines (see `userFunctionParamType`).
      if (isPolymorphicType(c.signature)) return false;
      const params = c.signature.args;
      if (params === undefined || i >= params.length) return false;
      return isNonRealNumber(params[i].type);
    });
  }

  /**
   * The first argument position at which a call of the single-literal user
   * function `h` (literal `literal`) with `args` is a strict-mode lane
   * mismatch, or `-1`: the argument is complex-shaped — a complex-valued
   * SCALAR (`provablyScalarOrFramedScalar`), or, to scalar parameters that
   * the call broadcasts over, a collection whose elements are all complex
   * scalars (`hasUniformComplexScalarElements`: the runtime broadcast hands
   * the body one complex element per call) — and the parameter is NOT
   * declared a non-real number type. An argument that is neither provably a
   * scalar nor a uniformly-complex collection is not a mismatch (a mixed list
   * has no one shape; its elements are handled per element).
   */
  private static laneMismatchAt(
    engine: ComputeEngine,
    h: string,
    literal: Expression & FunctionInterface,
    args: ReadonlyArray<Expression>
  ): number {
    const nParams = literal.ops.length - 1;
    for (let i = 0; i < nParams; i++) {
      const a = args[i];
      if (a === undefined) continue;
      let complex: boolean;
      if (BaseCompiler.provablyScalarOrFramedScalar(a))
        complex = BaseCompiler.isComplexValued(a);
      else if (BaseCompiler.userFunctionParamsAreScalar(engine, h))
        complex = BaseCompiler.hasUniformComplexScalarElements(a);
      else complex = false;
      if (!complex) continue;
      const pt = BaseCompiler.userFunctionParamType(engine, h, i);
      if (pt === undefined || !isNonRealNumber(pt)) return i;
    }
    return -1;
  }

  /**
   * The first argument position at which a call of the multi-clause function
   * `h` with `args` is a strict-mode lane mismatch, or `-1`: the argument is
   * a complex-shaped SCALAR and some clause declares, at that position, a
   * parameter whose type is WIDE — not a non-real number type (those bodies
   * are complex-shaped and the dispatcher coerces into them) and not a
   * real-only type (whose JS guard rejects a `{re, im}` at dispatch, so the
   * value never reaches that body). A wide clause parameter accepts the
   * object at dispatch and its body was compiled real-lane: the mismatch.
   */
  private static multiClauseLaneMismatchAt(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>
  ): number {
    const state = multiClauseState(engine.lookupDefinition(h));
    if (state === undefined || state.clauses.length === 0) return -1;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (
        !BaseCompiler.provablyScalarOrFramedScalar(a) ||
        !BaseCompiler.isComplexValued(a)
      )
        continue;
      const wide = state.clauses.some((c) => {
        if (isPolymorphicType(c.signature)) return true;
        const pt = c.signature.args?.[i]?.type;
        if (pt === undefined) return false;
        if (isNonRealNumber(pt)) return false;
        return !isSubtype(pt, 'real');
      });
      if (wide) return i;
    }
    return -1;
  }

  /** Does `h` resolve to a generic (polytype-signed) user function? Reads
   * the same declared-signature-first precedence as
   * `userFunctionParamsAreScalar`. */
  private static userFunctionIsGeneric(
    engine: ComputeEngine,
    h: string,
    literal: Expression
  ): boolean {
    const def = engine.lookupDefinition(h);
    if (def !== undefined) {
      if (isOperatorDef(def)) {
        if (def.operator.signature?.isPolymorphic) return true;
      } else if ('value' in def && def.value?.type?.isPolymorphic) return true;
    }
    const own = literal.type?.type;
    return own !== undefined && isPolymorphicType(own);
  }

  /**
   * If `h` names a user-defined function (see `userFunctionLiteral`) and the
   * target hosts a `userFunctions` registry, ensure its definition is emitted
   * once into `registry.defs` as a named local function (`const _fn_h = …`) and
   * return that local name — so both the call-site path
   * (`tryCompileUserFunction`) and the value-position path (a bare symbol used
   * as a higher-order operand, e.g. `Map(h, list)`) reference the *same* shared
   * local rather than inlining or emitting a dangling identifier.
   *
   * Returns `undefined` when `h` is not a user function or the target opts out
   * of user functions (no registry — GPU / raw direct targets, where recursion
   * therefore stays fail-closed). A re-entrant name (in `registry.compiling`)
   * is a recursive reference and compiles to a call by name.
   *
   */
  /**
   * Compile a call of the user function `h` by INLINING its body at the call
   * site — the body with each parameter SUBSTITUTED by its argument — for a
   * target that could not emit `h` as a definition, or `undefined` when
   * inlining is not sound for this call and the definition's own decline
   * should stand.
   *
   * A definition is emitted once, with PARAMETER types: a shader target needs
   * a static type for every parameter, and a point-typed one
   * (`f(P) := a·P.x² + b·P.y²`, whose `P` is a `tuple`) has none; the
   * interval target has no lowering for `PointX`/`PointY` over an opaque
   * parameter. The CALL, however, binds `P` to a concrete point `(x, y)`,
   * and the body over it — `a·x² + b·y²` once the coordinate accessors of
   * the literal point are folded — is ordinary scalar code both targets
   * compile. A chained definition (`F(x) := g(x / 3.6)`) inlines to a call
   * of its callee, which compiles by reference or inlines in turn
   * (Tycho item 216).
   *
   * The body is SUBSTITUTED, never evaluated (`apply` would run the body:
   * a `Random()` in it was folded into a compile-time constant, and an
   * assigned free symbol would be read at compile time where the emitted
   * definition reads it at run time).
   *
   * Sound only when the inlined body is what the by-reference call would
   * have computed, once:
   *  - the callee is a single-statement pure literal — an impure body would
   *    run its effect per inlined occurrence — and not generic (no ground
   *    types to substitute into);
   *  - the callee is not recursive: a direct self-call in the body, a callee
   *    whose definition is on the in-flight compile stack (mutual recursion
   *    by reference), or one already being inlined higher up (mutual
   *    recursion through inlining) — an inlining would not terminate;
   *  - every argument is provably a scalar or a literal point: a collection
   *    argument is broadcast by the by-reference call (`_SYS.bcastFn`) but
   *    would be substituted whole into the body;
   *  - every argument is pure: the by-reference call evaluates an argument
   *    ONCE, while substitution repeats it at every occurrence of its
   *    parameter — `(Random(), y)` into a body reading `P.x` twice would
   *    draw twice;
   *  - the body binds no variable of its own: `subs` is not binder-aware,
   *    so a parameter rebound by an inner `Sum`/`Function`/`Block`, or an
   *    argument symbol such a binder would capture, would be rewritten
   *    blindly (the guard `betaReduceLambda` in `boxed-expression/utils.ts`
   *    applies; here any binder declines, which also keeps
   *    `foldLiteralPointAccess` from rebuilding a scoped node).
   *
   * A `Typed` parameter's annotation is not re-validated at the inline call
   * site: the strict lane-mismatch check above already compared the
   * arguments against the declared parameter types before either route was
   * chosen, and the by-reference definition enforces nothing further at run
   * time either.
   */
  private static tryInlineUserFunctionCall(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource | undefined {
    const registry = target.userFunctions;
    if (!registry) return undefined;
    const literal = BaseCompiler.userFunctionLiteral(engine, h);
    if (literal === undefined) return undefined;
    if (BaseCompiler.userFunctionIsGeneric(engine, h, literal))
      return undefined;
    const params = literal.ops.slice(1);
    if (params.length !== args.length) return undefined;
    const body = literal.ops[0];
    const statement =
      isFunction(body, 'Block') && body.nops === 1 ? body.op1 : body;
    if (isFunction(statement, 'Block') || statement.isPure !== true)
      return undefined;
    if (registry.compiling.has(BaseCompiler.userFunctionName(h)))
      return undefined;
    const inlining = (registry.inlining ??= new Set<string>());
    if (inlining.has(h)) return undefined;
    const mentionsHead = (x: Expression): boolean =>
      isFunction(x) &&
      (x.operator === h || x.ops.some((op) => mentionsHead(op)));
    if (mentionsHead(statement)) return undefined;
    if (
      !args.every(
        (a) =>
          a.isPure === true &&
          (BaseCompiler.provablyScalarArg(a) || isFunction(a, 'Tuple'))
      )
    )
      return undefined;
    if (collectBinderNames(statement).size > 0) return undefined;
    // A declaration the body contradicts — a scalar or boolean promise over
    // a collection-constructing body — fails closed at the DEFINITION
    // (`isContradictedScalarFunctionBody`, the wave-3/wave-6 rulings) and in
    // every scalar position. Inlining would route around that decline with
    // the body's real shape; the same contradiction, read off the call.
    if (BaseCompiler.isContradictedScalarDeclaration(engine.function(h, args)))
      return undefined;
    const substitution: Record<string, Expression> = {};
    for (const [i, p] of params.entries()) {
      const name = isSymbol(p)
        ? p.symbol
        : isFunction(p, 'Typed') && isSymbol(p.op1)
          ? p.op1.symbol
          : undefined;
      if (name === undefined) return undefined;
      substitution[name] = args[i];
    }
    const inlined = BaseCompiler.foldLiteralPointAccess(
      statement.subs(substitution)
    );
    if (!inlined.isValid) return undefined;
    // The generated code bakes this definition, as an emitted one would.
    target.symbolDeps?.add(h);
    inlining.add(h);
    try {
      return BaseCompiler.compile(inlined, target);
    } finally {
      inlining.delete(h);
    }
  }

  /**
   * `expr` with every coordinate accessor of a LITERAL point folded to the
   * coordinate — `PointX((x, y))` is `x` — at every depth. Nothing else is
   * rebuilt: a node with no fold beneath it is returned as is, so bound
   * structure elsewhere in the expression is never re-canonicalized.
   *
   * After an inlining substitutes a literal point for a point parameter, the
   * body's `P.x`/`P.y` read a component of a tuple the compiler can see
   * into; folding them here is what lets a target with no `PointX` lowering
   * at all (interval arithmetic) compile the inlined body.
   */
  private static foldLiteralPointAccess(expr: Expression): Expression {
    if (!isFunction(expr)) return expr;
    const ops = expr.ops.map((op) => BaseCompiler.foldLiteralPointAccess(op));
    const position = BaseCompiler.POINT_ACCESSOR_POSITION[expr.operator];
    if (position !== undefined && ops.length === 1) {
      const point = ops[0];
      if (isFunction(point, 'Tuple') && point.nops >= position)
        return point.ops[position - 1];
    }
    if (ops.every((op, i) => op === expr.ops[i])) return expr;
    return expr.engine.function(expr.operator, ops);
  }

  /** The 1-based coordinate each point accessor reads. */
  private static readonly POINT_ACCESSOR_POSITION: Readonly<
    Record<string, number>
  > = { __proto__: null as never, PointX: 1, PointY: 2, PointZ: 3 };

  static ensureUserFunctionEmitted(
    engine: ComputeEngine,
    h: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    const registry = target.userFunctions;
    if (!registry) return undefined;

    const literal = BaseCompiler.userFunctionLiteral(engine, h);
    // A multi-clause function has no single literal — it compiles to a guard
    // chain over its clause set (function-polymorphism design §8).
    if (literal === undefined)
      return BaseCompiler.tryEmitMultiClauseFunction(engine, h, target);

    // A GENERIC user function declines whole-fn (G3, generic-function-
    // literals design §2.7): its parameters are open type variables, so the
    // emitted code can neither coerce nor broadcast a call — a lifted call
    // (`f([1,2,3])` under `(T) -> T where T: number`) would run the scalar
    // body on the array and silently compute a wrong value. The declared
    // signature is authoritative when there is one (an E3 install stores a
    // plain literal whose own arrow is ground); the literal's own polytype
    // covers the bare-assign route.
    if (BaseCompiler.userFunctionIsGeneric(engine, h, literal))
      return undefined;

    // The generated code bakes this user function's current definition: record
    // it in the capture set (see `CompileTarget.symbolDeps`). Symbols its body
    // consults are recorded by the body compile below.
    target.symbolDeps?.add(h);

    return BaseCompiler.emitFunctionLiteralDefinition(
      h,
      literal,
      target,
      registry
    );
  }

  /**
   * The compile plan for a CUSTOM `(accumulator, element)` combiner of a
   * `Reduce`/`Scan`: which lanes its two parameters run in, whether the seed
   * must be lifted, and the combiner expression to compile.
   *
   * Two lanes flow through a combiner. The ELEMENT lane is the source's: a
   * `list<complex>` (or a literal list of complex scalars) hands the body a
   * `{re, im}` per step. The ACCUMULATOR lane is the fold's own: it is the
   * SEED's shape on the first step (or the first element's, for a seedless
   * `Scan`), and it WIDENS to complex the moment the body yields a complex
   * value. Before this plan existed only the element lane was reasoned about
   * (by the type system's element inference on an inline lambda, and not at
   * all for a bare function symbol), so every accumulator shape compiled the
   * accumulator as a plain number — `Reduce([1+2i, i], (a,x) ↦ a + 2x, 0)`
   * answered `{re: "[object Object]0", im: 2}` (`a + {re, im}` concatenates)
   * where the interpreter gives `2 + 6i`; a COMPLEX seed `1+i` was no better
   * (`3 + 7i` expected); a seedless `Scan` over complex elements the same;
   * and a bare `h(a,x) := a + 2x` as combiner reached the real-lane `_fn_h`
   * and answered `NaN`. An interim fail-closed gate covered only the first
   * shape; ruled 2026-08-16 (Arno) to land the real fix instead.
   *
   * The plan:
   * - `eltComplex`: every element is a complex scalar
   *   (`hasUniformComplexScalarElements`).
   * - `accComplex`: the accumulator lane, by ONE-STEP WIDENING — complex when
   *   the accumulator parameter is DECLARED complex, or the seed is
   *   complex-shaped, or the fold is seedless over complex elements, or the
   *   body's result is complex when analyzed with the element in its lane and
   *   the accumulator real (the state of the first step). Widening is
   *   monotone, so one re-analysis settles it.
   * - `coerceSeed`: a real seed into a complex accumulator lane is lifted to
   *   `{re, im: 0}` (the call-boundary convention `coerceToComplex` applies
   *   to a real argument bound to a complex-typed parameter).
   * - `op`: the combiner to compile. An inline lambda is compiled under a
   *   local shape frame binding its two parameters to their lanes; a bare
   *   user-function symbol whose lanes are complex is replaced by its
   *   eta-expansion `(_a: complex?, _x: complex?) ↦ h(_a, _x)`, whose call
   *   site then binds a complex-typed argument to `h`'s parameter — a
   *   `LaneMismatch` for a WIDE parameter under strict shapes (declined by
   *   `strict`, escalated to complex mode by `auto`, where the one emission
   *   of `h` lifts its parameter at use), a coercion for a declared-complex
   *   one. A bare symbol with both lanes real is returned unchanged.
   *
   * `undefined` when `op` is not a two-parameter combiner this analysis can
   * see (a builtin, an infix operator symbol, a multi-clause function): the
   * caller keeps its previous lowering for those.
   */
  /** The builtin combiners the JavaScript target folds with natively
   * (`builtinCombiner` in `javascript-target.ts`); their fold runs in the
   * elements' lane, widened by a complex seed. */
  static readonly BUILTIN_FOLD_HEADS: ReadonlySet<string> = new Set([
    'Add',
    'Multiply',
    'Min',
    'Max',
  ]);

  /** Whether a BUILTIN fold over `coll` seeded with `init` runs in the complex
   * lane: its elements are complex scalars, or its seed is complex-shaped. */
  static foldLaneIsComplex(
    coll: Expression,
    init: Expression | undefined | null
  ): boolean {
    return (
      BaseCompiler.hasUniformComplexScalarElements(coll) ||
      (init !== undefined &&
        init !== null &&
        BaseCompiler.isComplexValued(init))
    );
  }

  static combinerPlan(
    coll: Expression,
    op: Expression,
    init: Expression | undefined | null
  ):
    | {
        op: Expression;
        accComplex: boolean;
        eltComplex: boolean;
        coerceSeed: boolean;
      }
    | undefined {
    const literal = isSymbol(op)
      ? BaseCompiler.userFunctionLiteral(op.engine, op.symbol)
      : op;
    if (literal === undefined) return undefined;
    if (!isFunction(literal, 'Function') || literal.nops !== 3)
      return undefined;
    // A parameter spelled `_` (or a destructuring pattern) has no name to
    // enter in a frame — `functionLiteralParameterName` answers `''` — but the
    // OTHER lane still needs planning: `(a, _) ↦ a + i` widens its accumulator
    // without ever naming the element. So an unnamed parameter is simply not
    // framed; it is never a reason to abandon the plan.
    const accName = functionLiteralParameterName(literal.ops[1]);
    const eltName = functionLiteralParameterName(literal.ops[2]);

    const eltComplex = BaseCompiler.hasUniformComplexScalarElements(coll);
    const seedless = init === undefined || init === null;
    const seedComplex = !seedless && BaseCompiler.isComplexValued(init);
    const declared = accName
      ? BaseCompiler.literalDeclaredParamTypes(literal)[accName]
      : undefined;
    const accTyped = declared !== undefined && isNonRealNumber(declared);

    let accComplex = accTyped || seedComplex || (seedless && eltComplex);
    if (!accComplex) {
      // First-step state: element in its lane, accumulator real. A complex
      // RESULT widens the accumulator from the second step on.
      const complex = new Map<string, boolean>();
      const vector = new Map<string, number>();
      if (eltName) vector.set(eltName, BaseCompiler.LOCAL_SCALAR);
      if (accName) vector.set(accName, BaseCompiler.LOCAL_SCALAR);
      if (eltComplex && eltName) complex.set(eltName, true);
      accComplex = BaseCompiler.withLocalShapeFrame(
        complex,
        vector,
        () => BaseCompiler.isComplexValued(literal.op1),
        true
      );
    }
    const coerceSeed = accComplex && !seedless && !seedComplex;

    if (isSymbol(op)) {
      if (!accComplex && !eltComplex)
        return { op, accComplex, eltComplex, coerceSeed };
      const engine = op.engine;
      const eltType = BaseCompiler.collectionElementTypeOf(coll);
      const eltTypeText =
        eltType !== undefined && isNonRealNumber(eltType)
          ? typeToString(eltType)
          : 'complex';
      const a = engine.symbol('_a');
      const x = engine.symbol('_x');
      const eta = engine.function('Function', [
        engine.function(op.symbol, [a, x]),
        accComplex
          ? engine.function('Typed', [a, engine.box({ str: 'complex' })])
          : a,
        eltComplex
          ? engine.function('Typed', [x, engine.box({ str: eltTypeText })])
          : x,
      ]);
      return { op: eta, accComplex, eltComplex, coerceSeed };
    }
    return { op, accComplex, eltComplex, coerceSeed };
  }

  /**
   * Compile an INLINE combiner lambda under the lanes `combinerPlan` chose:
   * its accumulator and element parameters are entered in a local shape
   * frame (complex where the lane is complex, scalar in either case), so the
   * body's operand analysis — and therefore its emitted arithmetic — treats
   * them as the values the fold actually passes. The frame STACKS on the
   * enclosing ones (the lambda is lexically inside the fold's expression).
   */
  static compileCombinerLiteral(
    plan: { op: Expression; accComplex: boolean; eltComplex: boolean },
    compile: (e: Expression) => string
  ): string {
    const literal = plan.op;
    if (!isFunction(literal, 'Function') || literal.nops !== 3)
      return compile(literal);
    const accName = functionLiteralParameterName(literal.ops[1]);
    const eltName = functionLiteralParameterName(literal.ops[2]);
    const complex = new Map<string, boolean>();
    const vector = new Map<string, number>();
    if (accName) {
      vector.set(accName, BaseCompiler.LOCAL_SCALAR);
      if (plan.accComplex) complex.set(accName, true);
    }
    if (eltName) {
      vector.set(eltName, BaseCompiler.LOCAL_SCALAR);
      if (plan.eltComplex) complex.set(eltName, true);
    }
    return BaseCompiler.withLocalShapeFrame(complex, vector, () =>
      compile(literal)
    );
  }

  /**
   * The name to use where a user function is referenced as a VALUE rather than
   * called — `Map(Q, xs)`, `CountIf`, `Find`, `_SYS.bcastFn`.
   *
   * The consumers of a function value hand the callee a RAW element: the
   * argument coercion lives in `emitUserFunctionCall`, which only the call
   * route reaches. So a function with a declared-complex parameter, whose body
   * `addDeclaredComplexParams` puts in the complex lane, cannot be passed by
   * name — `Map(Q, [1, 2, 3])` fed plain numbers to a body reading `.re`/`.im`
   * and answered `[{re: null, im: null}, …]` behind `success: true`, where the
   * previous real-lane emission computed correctly.
   *
   * The fix is a coercing shim under its OWN name, so the two routes do not
   * share a cache entry: `const _fn_Q$v = (x) => _fn_Q(_SYS.cplx(x));`. The
   * runtime helper is used rather than a static wrap because an element's
   * realness is a property of the source, not of the reference, and the
   * reference is compiled without one — `_SYS.cplx` is idempotent, so a
   * complex element passes through and a real one is wrapped.
   *
   * Returns the plain name unchanged when there is nothing to coerce, so the
   * emitted code for every function without a declared-complex parameter is
   * byte-identical to before.
   */
  static ensureUserFunctionValueRef(
    engine: ComputeEngine,
    h: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    const name = BaseCompiler.ensureUserFunctionEmitted(engine, h, target);
    if (name === undefined) return undefined;
    if (target.language !== 'javascript') return name;
    const registry = target.userFunctions;
    if (!registry) return name;

    const literal = BaseCompiler.userFunctionLiteral(engine, h);
    if (literal === undefined) return name;
    const nParams = literal.ops.length - 1;
    const complexParam: boolean[] = [];
    for (let i = 0; i < nParams; i++) {
      const pt = BaseCompiler.userFunctionParamType(engine, h, i);
      complexParam.push(pt !== undefined && isNonRealNumber(pt));
    }
    if (!complexParam.some((c) => c)) return name;

    const shimName = `${name}$v`;
    if (!registry.defs.has(shimName)) {
      const params = complexParam.map(() => BaseCompiler.tempVar(target));
      const args = params.map((p, i) =>
        complexParam[i] ? `_SYS.cplx(${p})` : p
      );
      registry.defs.set(
        shimName,
        `const ${shimName} = (${params.join(', ')}) => ${name}(${args.join(
          ', '
        )});`
      );
    }
    return shimName;
  }

  /**
   * Emit `literal` once into `registry.defs` as the named local function for
   * `h` (`const _fn_h = …`) and return that local name.
   *
   * Shared by the two routes that have a `Function` literal in hand: a
   * user-defined function (`ensureUserFunctionEmitted`) and the eta-expansion
   * of a bare built-in operator symbol used as a callback
   * (`ensureBuiltinCallbackEmitted`). Both therefore get the same shared
   * local, the same nested-CSE harvest of the body, and the same target
   * `lowering` hook.
   */
  private static emitFunctionLiteralDefinition(
    h: string,
    literal: Expression & FunctionInterface,
    target: CompileTarget<Expression>,
    registry: NonNullable<CompileTarget<Expression>['userFunctions']>
  ): string | undefined {
    const name = BaseCompiler.userFunctionName(h);

    if (!registry.defs.has(name)) {
      // Re-entrant reference: `h`'s definition is on the in-flight compile
      // stack, so this is a (mutually) recursive call — emit the call by name.
      // The definition lands in `registry.defs` when its body compile
      // completes, and every def executes in the preamble before any call
      // runs, so the name is bound by call time (a mutually recursive def
      // referencing a later `const` is safe for the same reason). Runaway
      // recursion is backstopped by the JS call stack — a catchable
      // `RangeError` within milliseconds — consistent with compiled
      // unbounded `Loop`, which is likewise unguarded at run time.
      //
      // Where the target language forbids recursion outright — GLSL and WGSL
      // both do — there is no such call to emit: the name is not declared yet
      // and no shader compiler would accept it. Fail closed (D6) naming the
      // function instead.
      if (registry.compiling.has(name)) {
        if (registry.lowering?.noRecursion)
          throw new Error(
            `${h}: a recursive (or mutually recursive) user-defined function ` +
              `has no lowering on target '${target.language ?? 'unknown'}' — ` +
              `the shader languages forbid recursion. Rewrite ${h} as a ` +
              `bounded loop (Sum/Product/Loop) before compiling. Fail closed (D6).`
          );
        return name;
      }
      registry.compiling.add(name);
      try {
        const { params, bodyExpr, bodyTarget } =
          BaseCompiler.prepareUserFunctionBody(literal, target, registry);
        // A target with its own definition lowering (the shader targets)
        // synthesizes the signature and compiles the body itself — a shader
        // function body is a STATEMENT position and its declaration needs
        // static parameter/return types, neither of which the JS arrow form
        // below can express. The `defs` entry still lands here, AFTER the body
        // compiled, so a nested dependency it emitted precedes it (GLSL
        // requires declaration before use).
        const lowering = registry.lowering;
        if (lowering) {
          const def = BaseCompiler.withEnforcedParams(literal, () =>
            lowering.define({
              id: h,
              name,
              params,
              body: bodyExpr,
              literal,
              target: bodyTarget,
            })
          );
          // Wave 3 of the 2026-08-12 contradicted-declaration ruling, as a
          // BACKSTOP on what `define` was willing to emit. A lowering that
          // synthesizes a STATIC return type takes it from the body's
          // declared/ascribed type, while the `return` statement emits what the
          // body actually builds — so a scalar-declared, collection-
          // constructing body yields a declaration that disagrees with its own
          // return value (`float _fn_a(float t) { return vec2(…); }`), source
          // no shader compiler accepts, shipped behind `success: true` because
          // nothing downstream re-checks the preamble. Waves 1–2 gate the
          // CONSUMING positions of such a call; a bare `a(u)` has no consuming
          // head, so the definition still went out.
          //
          // Deliberately AFTER `define`, not before: every target-specific
          // decline (`the return value has no static GLSL type`, the `At`
          // aggregate-index diagnostic, the identifier checks) throws from
          // inside `define` and is strictly more informative about ITS shape.
          // Running last means this gate only ever speaks for a definition that
          // emitted cleanly — exactly the case nothing else catches — and never
          // masks a better message. The `defs` entry is still written after the
          // body compiled, so a nested dependency it emitted precedes it (GLSL
          // requires declaration before use); a throw here aborts the whole
          // compilation, so the discarded entries do not matter.
          //
          // The gate lives in this shared emission path keyed on a property the
          // TARGET declares, rather than inside the GPU `define` hook: the
          // contradiction is a property of the FUNCTION, the same one waves 1–2
          // read from the call site, and every emission route (bare call, value
          // position, nested dependency) funnels through here. Targets without
          // a static return type are structurally untouched — JavaScript (no
          // lowering at all) keeps the bare `a(u)` shape the ruling protects,
          // interval-js uses that same untyped arrow form, and a future
          // dynamically-typed definition lowering (a Python `def` — the only
          // user-function lowering Python could gain; it declines with "Unknown
          // operator" today) would have no return type to contradict.
          if (
            lowering.staticReturnType === true &&
            BaseCompiler.isContradictedScalarFunctionBody(bodyExpr)
          )
            throw new Error(
              `${h}: the declaration of '${h}' says it returns a scalar ` +
                `('${bodyExpr.type.toString()}'), but its body constructs a ` +
                `collection. The declaration is contradicted by the body, so ` +
                `the emitted definition would declare a scalar return type ` +
                `over a collection return value. Fix the declaration (e.g. ` +
                `'-> list<number>') or evaluate instead. Fail closed (D6).`
            );
          registry.defs.set(name, def);
          return name;
        }
        // Each emitted definition body gets its OWN nested harvest scope in
        // the same session (§5.4): its own regions and candidates — the body
        // is not part of the root tree — but the same naming counter, so temp
        // names never collide across the artifact. Duplication inside a called
        // definition is therefore recovered once, in the emitted function.
        // The body compiles under a frame binding each complex-lane parameter
        // to `true`, so every operand analysis inside it — and so the emitted
        // arithmetic — treats that parameter as the `{re, im}` object the
        // call site actually passes. The frame is ISOLATED (it replaces the
        // enclosing `_localComplex` frames instead of stacking on them): an
        // emitted definition is a module-level function, so when this
        // emission is triggered from inside a `Block` or another definition's
        // body, the caller's local shapes must not reach this body — a
        // global read here that happens to share a name with a caller's
        // complex local would otherwise be lowered complex over its plain
        // numeric value. This is the same discipline the GPU definition
        // lowering applies to its own parameter frame.
        // A parameter the signature DECLARES complex is complex in the body
        // for every call site, so it is entered here whether or not this
        // emission carries call-site lanes. Without it the body read the
        // parameter in the real lane while the call site handed it a
        // `{ re, im }` — `_fn_Q = (z) => ({ re: z + 0, im: 1 })` over an
        // object, i.e. `re: '[object Object]0'` behind `success: true`.
        //
        // This is not radical PROMOTION and does not go through
        // `complexPromotion`: nothing is being inferred complex from an
        // operand's sign. The author WROTE `(complex) -> complex`, and the
        // call site is made to honour it (`coerceToComplex` /`_SYS.cplx`), so
        // the lane here is that declaration being read back — which is why
        // the Tycho-190 rule ("the lane comes from the operand, never the
        // node type") is not in tension with it.
        const frames = {
          complex: new Map<string, boolean>(),
          vector: new Map<string, number>(),
        };
        BaseCompiler.addDeclaredComplexParams(h, literal, target, frames);
        const body = BaseCompiler.withLocalShapeFrame(
          frames.complex,
          frames.vector,
          () =>
            BaseCompiler.withEnforcedParams(literal, () =>
              BaseCompiler.withNestedCseHarvest(
                bodyExpr,
                bodyTarget,
                params,
                () => BaseCompiler.compile(bodyExpr, bodyTarget)
              )
            ),
          true
        );
        registry.defs.set(
          name,
          `const ${name} = (${params.join(', ')}) => ${body};`
        );
      } finally {
        registry.compiling.delete(name);
      }
    }

    return name;
  }

  /**
   * If `s` names an eta-expandable BUILT-IN operator, synthesize the wrapper
   * `(p₁ … pₙ) ↦ s(p₁ … pₙ)`, emit it once into `target.userFunctions.defs`
   * and return that shared local name — so a built-in operator name used as a
   * higher-order operand (`Map(Sin, xs)`, `CountIf(xs, IsPrime)`) is a real
   * function VALUE rather than a dangling `_.Sin`.
   *
   * Eligibility (both halves in `builtin-callback.ts`, shared with the CSE
   * admission test): the name resolves to the engine-authored system-scope
   * definition by object identity, and its signature has a FIXED arity
   * (`n ≥ 1` required parameters, no optional or variadic tail). Everything
   * else — a user definition shadowing the name, a variadic operator like
   * `Add`, an optional-tail one like `Ln` or `Random` — answers `undefined`
   * and leaves the caller's previous behavior untouched.
   *
   * The wrapper BODY is an ordinary application, so a caller `functions` /
   * `operators` override of that operator applies inside it — the same
   * semantics an inline `x ↦ Sin(x)` callback has.
   *
   * Parameter names are drawn from the compilation's temp-name counter
   * (`_tv1`, …), which already skips every name the artifact uses, so the
   * synthesized wrapper can capture nothing.
   */
  static ensureBuiltinCallbackEmitted(
    engine: ComputeEngine,
    s: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    const registry = target.userFunctions;
    if (!registry) return undefined;

    // Already emitted (a repeated reference): share the one definition, and
    // in particular do NOT draw fresh temp names for it.
    const name = BaseCompiler.userFunctionName(s);
    if (registry.defs.has(name)) return name;

    const arity = builtinCallbackArity(engine, s);
    if (arity === undefined) return undefined;

    const params: Expression[] = [];
    for (let i = 0; i < arity; i++)
      params.push(engine.symbol(BaseCompiler.tempVar(target)));
    const literal = engine.function('Function', [
      engine.function(s, params),
      ...params,
    ]);
    // A built-in whose canonicalization refuses symbolic arguments would
    // yield an error body: fail closed rather than emit it.
    if (!isFunction(literal, 'Function') || !literal.isValid) return undefined;

    return BaseCompiler.emitFunctionLiteralDefinition(
      s,
      literal,
      target,
      registry
    );
  }

  /**
   * Prepare a function literal's body for emission as a preamble definition:
   * the parameter names, the angular-unit-rewritten body, and the body's
   * compile target.
   *
   * The body compiles with the parameters shadowing the target's `var`
   * resolution (matching the `Function`-literal handler), so a parameter
   * compiles to its bare name rather than a folded value or `_.<name>`.
   * The angular-unit rewrite is applied per emitted body: the entry points
   * rewrite only the TOP-LEVEL expression tree, and this literal comes from
   * the engine definition — without the rewrite here, a degree-mode compile
   * of `t ↦ f(t)` emitted radian-based trig inside `f`'s definition while
   * `t ↦ sin(t)` correctly scaled.
   *
   * The body target chains to the ROOT target — the one the registry was
   * installed on — NOT the requesting one. An emitted definition is a
   * module-level (preamble) function, so it must see only the compilation's
   * own var/fold rules plus its own parameters. Chaining through the
   * requester leaked that caller's bindings into this body: emitting `g`
   * (whose body reads a global `z`) from inside `f(z) := g(1)` resolved `z`
   * to `f`'s parameter. The registry, naming context and capture set are
   * shared objects, so they survive the switch.
   *
   * The body is emitted into the artifact, so its symbols join the
   * compilation's collision inventory UNCONDITIONALLY — a `_tv1` in a
   * definition body must not be shadowed by a generated temp even when CSE
   * is off (the nested harvest merges the same names, but only when a
   * session is enabled).
   */
  private static prepareUserFunctionBody(
    literal: Expression & FunctionInterface,
    target: CompileTarget<Expression>,
    registry: NonNullable<CompileTarget<Expression>['userFunctions']>
  ): {
    params: string[];
    bodyExpr: Expression;
    bodyTarget: CompileTarget<Expression>;
  } {
    BaseCompiler.assertNoDestructuringParams(literal.ops.slice(1));
    const declared = literal.ops
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    const bodyExpr = rewriteAngularUnit(literal.ops[0].canonical);
    const root = registry.root ?? target;
    // The SAME parameter-shadowing rule as the inline lambda lowering, through
    // the same helper. This site builds the identical `(params) => body` shape
    // for the emitted-definition route (`f(x) := …`, and each clause of a
    // multi-clause set), so without it an engine-defined function with a `_`
    // parameter stayed silently wrong — `f := _ ↦ _ + k` called with `k = 10`
    // computed NaN — while the inline route had been fixed. Note the fallback
    // name above is `_` itself, so a parameter that yields no name defaults
    // INTO the colliding spelling rather than merely being allowed to use it.
    const binding = BaseCompiler.lambdaParamBinding(declared, bodyExpr, root);
    const params = binding.emitted;
    const bodyTarget: CompileTarget<Expression> = {
      ...root,
      var: binding.varOf,
      // The literal's OWN parameter names — what the body expression binds,
      // whatever they are emitted as.
      boundVars: BaseCompiler.withBoundNames(root, declared),
      // The parameters' DECLARED types, for the lowerings that read a raw
      // (never-bound) symbol — the bare-`Field` protocol property GET tier,
      // whose receiver types `unknown` in the canonical body because nothing
      // has bound the parameter yet. Fresh per
      // definition (module-level semantics: the requester's map must not
      // leak in), replacing whatever the spread copied from `root`.
      declaredVarTypes: BaseCompiler.literalDeclaredParamTypes(literal),
    };
    BaseCompiler.mergeUsedNames(target, collectUsedNames(bodyExpr));
    return { params, bodyExpr, bodyTarget };
  }

  /**
   * The DECLARED types of a function literal's annotated parameters, by
   * name. An unannotated or unparseable parameter contributes nothing (it
   * then reads as undeclared, the safe direction). Shared by the emitted
   * definition compile (`prepareUserFunctionBody`) and the reference
   * analysis, so the two agree on what a raw body symbol's static type is.
   */
  private static literalDeclaredParamTypes(
    literal: Expression & FunctionInterface
  ): Record<string, Type> {
    const out: Record<string, Type> = {};
    for (const p of literal.ops.slice(1)) {
      if (!isFunction(p, 'Typed') || !isSymbol(p.ops[0])) continue;
      const src = p.ops[1];
      const text = isString(src)
        ? src.string
        : isSymbol(src)
          ? src.symbol
          : undefined;
      if (text === undefined) continue;
      try {
        out[p.ops[0].symbol] = parseType(text, literal.engine._typeResolver);
      } catch {
        // Unparseable annotation: skip.
      }
    }
    return out;
  }

  /**
   * Emit a **multi-clause** user function (function-polymorphism design §8)
   * as a guard chain: one helper definition per clause plus a variadic
   * dispatcher that tests the clauses in the **deterministic linearization**
   * — more specific first, declaration order breaking ties, the same total
   * order the runtime selector induces — and throws `no-matching-clause`
   * (D7) when every clause refuses.
   *
   * v1 is JavaScript-only: the interval target shares this emission path but
   * its runtime values are intervals (an `=== 0` guard is meaningless
   * there), and lowering targets (the shader languages) cannot express the
   * variadic dispatcher. A clause with any guard the target cannot express
   * declines the WHOLE function — `undefined`, never a partial compilation
   * (partial dispatch would silently change tie behavior). Declining
   * surfaces the caller's standard fail-closed diagnostic and falls back to
   * interpreted dispatch.
   */
  private static tryEmitMultiClauseFunction(
    engine: ComputeEngine,
    h: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    const registry = target.userFunctions;
    if (!registry) return undefined;

    const state = multiClauseState(engine.lookupDefinition(h));
    if (state === undefined) return undefined; // genuinely unknown operator

    if (target.language !== 'javascript' || registry.lowering) return undefined; // fail closed on non-JS targets (§8)

    const name = BaseCompiler.userFunctionName(h);
    if (registry.defs.has(name) || registry.compiling.has(name)) return name;

    // ── Plan the chain BEFORE emitting anything (whole-function decline) ──
    const clauses = state.clauses;
    type ClausePlan = {
      clause: FunctionClause;
      literal: Expression & FunctionInterface;
      arity: number;
      /** Per-parameter guard sources over `a`, `null` = no test needed. */
      guards: (string | null)[];
    };
    const plans: ClausePlan[] = [];
    for (const clause of clauses) {
      const sig = clause.signature;
      // Optional/variadic clauses have no v1 guard spelling.
      if ((sig.optArgs?.length ?? 0) > 0 || sig.variadicArg !== undefined)
        return undefined;
      if (!isFunction(clause.literal, 'Function')) return undefined;
      const arity = sig.args?.length ?? 0;
      if (clause.literal.ops.length - 1 !== arity) return undefined;
      const guards: (string | null)[] = [];
      for (let i = 0; i < arity; i++) {
        const g = BaseCompiler.jsClauseParamGuard(
          sig.args![i].type,
          `_$n[${i}]`
        );
        if (g === undefined) return undefined;
        guards.push(g);
      }
      plans.push({ clause, literal: clause.literal, arity, guards });
    }

    // ── Deterministic linearization (§8): stable insertion, more specific
    // first. Clauses of different arity are separated by the arity guard,
    // and `isMoreSpecific` reports incomparable for them, so their relative
    // (declaration) order is preserved. ──
    const order: number[] = [];
    for (let i = 0; i < plans.length; i++) {
      let at = order.length;
      for (let k = 0; k < order.length; k++) {
        const j = order[k];
        if (
          plans[j].arity === plans[i].arity &&
          isMoreSpecific(
            plans[i].clause.signature,
            plans[j].clause.signature,
            plans[i].arity
          )
        ) {
          at = k;
          break;
        }
      }
      order.splice(at, 0, i);
    }

    // The generated code bakes this function's current clause set: record it
    // in the capture set (see `CompileTarget.symbolDeps`).
    target.symbolDeps?.add(h);

    registry.compiling.add(name);
    try {
      // One helper per clause, in declaration order. `$` cannot appear in a
      // MathJSON symbol, so `_fn_f$c1` can never collide with the emitted
      // name of another user function (`userFunctionName` sanitizes to
      // `[\w$]` but user symbols never contain `$`).
      const helperNames = plans.map((_, i) => `${name}$c${i + 1}`);
      // The clause bodies are the ARMS of one dispatcher: if any of them is
      // complex-valued, every provably-real one must be coerced to the
      // `{ re, im }` convention or the caller reads `.re` off a plain number
      // (Tycho item 60, here across clauses instead of `Which` arms).
      const coerce = BaseCompiler.branchComplexCoercion(
        plans.map((p) => p.literal.ops[0]),
        target
      );
      for (let i = 0; i < plans.length; i++) {
        const { params, bodyExpr, bodyTarget } =
          BaseCompiler.prepareUserFunctionBody(
            plans[i].literal,
            target,
            registry
          );
        // A recursive clause body references `h` while `name` is in
        // `compiling`, so the self-call emits `name` — bound by the time any
        // call runs, since every def executes in the preamble first.
        const compiled = BaseCompiler.withEnforcedParams(plans[i].literal, () =>
          BaseCompiler.withNestedCseHarvest(bodyExpr, bodyTarget, params, () =>
            BaseCompiler.compile(bodyExpr, bodyTarget)
          )
        );
        const body = coerce ? coerce(bodyExpr, compiled) : compiled;
        registry.defs.set(
          helperNames[i],
          `const ${helperNames[i]} = (${params.join(', ')}) => ${body};`
        );
      }

      // The guards test the NORMALIZED arguments `_$n`: a `{re, im: 0}`
      // object — the shape a `complex`-typed free symbol is lifted to at
      // `run()` entry (D3), or that a caller hands over directly — IS the
      // real number `re`, and must dispatch as the interpreter dispatches
      // that real (`S(0)` selects the value clause; a `real`-typed clause
      // parameter admits it). Each helper receives its arguments in the
      // shape ITS clause body was compiled for: the normalized value for a
      // parameter not declared complex (that body reads a number), the
      // `_SYS.cplx`-lifted raw value for one that is.
      const branches = order.map((i) => {
        const { arity, guards, clause } = plans[i];
        const tests = [
          `_$a.length === ${arity}`,
          ...guards.filter((g): g is string => g !== null),
        ];
        // A clause parameter DECLARED a non-real number type is consumed by
        // its body through complex slots (the body is compiled with the
        // parameter typed complex), so the dispatcher hands it a `{re, im}`:
        // a plain number that passed the `complex` guard — a real IS a
        // complex — is lifted here, PER CLAUSE, after dispatch has been
        // decided on the raw argument (lifting before dispatch would change
        // which clause a real argument selects). Without this,
        // `S(0) -> complex {0}; S(z: complex) -> complex {z + 1}` called as
        // `S(2)` read `.re` off the number `2` (`{re: null}` behind
        // `success: true`; ROADMAP "A MULTI-CLAUSE function with a declared
        // `complex` parameter compiles silently wrong", 2026-08-16).
        const args = Array.from({ length: arity }, (_, k) => {
          const pt = clause.signature.args?.[k]?.type;
          return pt !== undefined && isNonRealNumber(pt)
            ? `_SYS.cplx(_$a[${k}])`
            : `_$n[${k}]`;
        });
        return `if (${tests.join(' && ')}) return ${helperNames[i]}(${args.join(', ')});`;
      });
      registry.defs.set(
        name,
        `const ${name} = (..._$a) => { const _$n = _$a.map(_SYS.creal); ${branches.join(' ')} throw new Error(${JSON.stringify(`no-matching-clause: ${h}`)}); };`
      );
    } finally {
      registry.compiling.delete(name);
    }
    return name;
  }

  /**
   * The JavaScript guard testing that `a` satisfies parameter type `t`:
   * a source string, `null` when no test is needed (the parameter admits
   * anything), or `undefined` when the type has **no faithful JS test** —
   * the §8 whole-function decline. Guard kinds mirror the runtime admission
   * (`typeAcceptsValue`/`admissionOf`) on the target's value model:
   * value types → `===` (faithful for the machine numbers, strings and
   * booleans compiled code traffics in; the `NaN` value type admits exactly
   * NaN, so it tests `Number.isNaN`); numeric ranges → base guard
   * plus inclusive bound checks (a NaN argument fails `>=`, as it should);
   * primitives → `typeof`/`Number.isInteger` where JS can express them.
   * The JS calling convention represents a complex value as a `{re, im}`
   * object and a real one as a plain number, and BOTH inhabit `complex` (and
   * `number`): those two guards accept either shape, so a complex-valued
   * clause set dispatches as the interpreter does.
   */
  private static jsClauseParamGuard(
    t: Type,
    a: string
  ): string | null | undefined {
    if (typeof t === 'string') {
      switch (t) {
        case 'unknown':
        case 'any':
          return null;
        case 'integer':
        case 'finite_integer':
          return `Number.isInteger(${a})`;
        case 'real':
          return `(typeof ${a} === "number" && !Number.isNaN(${a}))`;
        case 'finite_real':
          return `Number.isFinite(${a})`;
        case 'complex':
          return `(typeof ${a} === "number" || ${jsComplexObjectTest(a)})`;
        case 'number':
          return `(typeof ${a} === "number" || ${jsComplexObjectTest(a)})`;
        case 'string':
          return `typeof ${a} === "string"`;
        case 'boolean':
          return `typeof ${a} === "boolean"`;
        default:
          return undefined;
      }
    }
    switch (t.kind) {
      case 'value': {
        const v = t.value;
        if (typeof v === 'number') {
          // The `NaN` value type admits exactly NaN (amended D1, "match
          // only themselves") — `===` is the one comparison that would NOT
          // be faithful for it.
          if (Number.isNaN(v)) return `Number.isNaN(${a})`;
          return `${a} === ${v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : String(v)}`;
        }
        if (typeof v === 'string') return `${a} === ${JSON.stringify(v)}`;
        if (typeof v === 'boolean') return `${a} === ${v}`;
        return undefined;
      }
      case 'numeric': {
        let base: string;
        if (t.type === 'integer' || t.type === 'finite_integer')
          base = `Number.isInteger(${a})`;
        else if (t.type === 'real' || t.type === 'finite_real')
          base = `typeof ${a} === "number"`;
        else return undefined; // rational &c.: no faithful JS test
        const parts = [base];
        if (typeof t.lower === 'number' && t.lower !== -Infinity)
          parts.push(`${a} >= ${String(t.lower)}`);
        if (typeof t.upper === 'number' && t.upper !== Infinity)
          parts.push(`${a} <= ${String(t.upper)}`);
        return `(${parts.join(' && ')})`;
      }
      case 'union': {
        const parts: string[] = [];
        for (const branch of t.types) {
          const g = BaseCompiler.jsClauseParamGuard(branch, a);
          if (g === undefined) return undefined;
          if (g === null) return null; // a branch admits everything
          parts.push(g);
        }
        return `(${parts.join(' || ')})`;
      }
      default:
        return undefined;
    }
  }

  /**
   * Concatenate the user-defined function definitions accumulated in
   * `target.userFunctions` (see `tryCompileUserFunction`) into a preamble
   * fragment, in dependency order. Empty string when there are none.
   */
  static userFunctionsPreamble(target: CompileTarget<Expression>): string {
    const defs = target.userFunctions?.defs;
    if (!defs || defs.size === 0) return '';
    return [...defs.values()].join('\n') + '\n';
  }

  /**
   * For a bare `Field` read whose receiver is a RAW body local — `q.n`
   * where an enclosing statement list declared `q: Person` — the receiver's
   * own static type is `unknown` (a canonical function body's locals are
   * unbound), so the `Field` compile handler, which resolves record /
   * named-tuple fields from the receiver's static type, declines. Re-type
   * the receiver from the declared parameter/local map
   * (`CompileTarget.declaredVarTypes` — the same fallback the protocol
   * GET/SET tier applies) by ascribing it: `Typed` is transparent at
   * evaluation and compiles to its operand, so only the static type the
   * handler sees changes. Returns the substituted operand list, or `null`
   * when the fallback does not apply (any head other than `Field`, a
   * non-symbol or already-typed receiver, no declared entry).
   */
  private static fieldArgsWithDeclaredReceiver(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    declaredVarTypes: Readonly<Record<string, Type>> | undefined
  ): ReadonlyArray<Expression> | null {
    if (h !== 'Field' || declaredVarTypes === undefined) return null;
    const receiver = BaseCompiler.receiverWithDeclaredType(
      engine,
      args[0],
      declaredVarTypes
    );
    if (receiver === null) return null;
    return [receiver, ...args.slice(1)];
  }

  /** The `Field` receiver with its declared-type ascription applied — a raw
   * symbol becomes `Typed(sym, "<declared>")`, and a nested `Field` CHAIN
   * (`q.address.zip`) is rebuilt from its ascribed root so each intermediate
   * access resolves statically too. `null` when the fallback does not
   * apply. */
  private static receiverWithDeclaredType(
    engine: ComputeEngine,
    root: Expression | undefined,
    declaredVarTypes: Readonly<Record<string, Type>>
  ): Expression | null {
    if (root === undefined) return null;
    if (isSymbol(root)) {
      const t = root.type.type;
      if (t !== 'unknown' && t !== 'any') return null;
      const declared = declaredVarTypes[root.symbol];
      if (declared === undefined) return null;
      return engine._fn('Typed', [root, engine.string(typeToString(declared))]);
    }
    if (isFunction(root, 'Field') && isString(root.ops[1])) {
      const inner = BaseCompiler.receiverWithDeclaredType(
        engine,
        root.ops[0],
        declaredVarTypes
      );
      if (inner === null) return null;
      return engine._fn('Field', [inner, root.ops[1]]);
    }
    return null;
  }

  /**
   * Extract a protocol call from a dispatcher, `ProtocolMember`, property get,
   * or unresolved `Field` read. Property stores are excluded because mutable
   * objects have no compiled representation. An unresolved `Field` is eligible
   * only for static dispatch: at runtime an ordinary record key takes
   * precedence over a protocol property.
   */
  private static protocolCallParts(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>
  ):
    | {
        implKey: string;
        member: string;
        protocol?: string;
        args: ReadonlyArray<Expression>;
        staticOnly?: boolean;
      }
    | undefined {
    if (h === 'ProtocolMember' || h === 'ProtocolProperty') {
      // Operands 0-1 ride as string literals, or as bare symbols after a
      // round trip (the `protocolMemberOperandsOf` reading).
      const nameOf = (op: Expression | undefined): string | undefined => {
        if (op === undefined) return undefined;
        return isString(op) ? op.string : isSymbol(op) ? op.symbol : undefined;
      };
      const protocol = nameOf(args[0]);
      const member = nameOf(args[1]);
      if (protocol === undefined || member === undefined) return undefined;
      if (h === 'ProtocolMember')
        return { implKey: member, member, protocol, args: args.slice(2) };
      if (args.length === 3)
        return {
          implKey: `__get__${member}`,
          member,
          protocol,
          args: args.slice(2),
        };
      // FOUR operands is a property STORE, not a call: it writes a mutable
      // object, and objects have no compiled representation yet. Declining here
      // sends it to the fail-closed throw in the value path rather than
      // lowering it to `setterImpl(receiver, value)` — which would both bypass
      // that refusal and evaluate to the SETTER's result where the interpreter
      // evaluates to the value assigned.
      return undefined;
    }

    if (h === 'Field' && args.length === 2 && isString(args[1])) {
      const name = args[1].string;
      return {
        implKey: `__get__${name}`,
        member: name,
        args: [args[0]],
        staticOnly: true,
      };
    }

    if (isProtocolDispatcher(lookupApplicable(h, engine.context.lexicalScope)))
      return { implKey: h, member: h, args };

    return undefined;
  }

  /** The JS test that the receiver `x` takes a candidate's arm — the
   * rendering of the planner's guard descriptors. `null` = no test needed;
   * `undefined` = not renderable (whole-call decline). */
  private static renderReceiverGuard(
    g: ReceiverGuard,
    x: string
  ): string | null | undefined {
    switch (g.kind) {
      case 'js-type':
        return BaseCompiler.jsClauseParamGuard(g.type, x);
      case 'tag':
        // Optional chaining is load-bearing: a primitive receiver must fall
        // through to the next arm, not TypeError (the compiled-`match`
        // convention).
        return `${x}?._tag === ${JSON.stringify(g.tag)}`;
      case 'bucket': {
        const test = BaseCompiler.sumBucketTest(g.bucket, x, g.complexNumber);
        if (g.tupleArity === undefined) return test;
        return `(${test} && ${x}.length === ${g.tupleArity})`;
      }
    }
  }

  /**
   * Compile a JavaScript protocol call. Static dispatch calls the selected
   * implementation directly; dynamic dispatch emits a most-specific-first
   * receiver guard chain and throws `protocol-implementation-missing` if no
   * guard matches. The emitted code snapshots the current protocol registry.
   *
   * Non-receiver arguments rely on canonicalization-time type checks. Receiver
   * guards operate on the JavaScript runtime representation, as do compiled
   * `Match` patterns and multi-clause function guards.
   */
  private static tryCompileProtocolDispatch(
    engine: ComputeEngine,
    call: {
      implKey: string;
      member: string;
      protocol?: string;
      args: ReadonlyArray<Expression>;
      staticOnly?: boolean;
    },
    target: CompileTarget<Expression>
  ): TargetSource | undefined {
    const registry = target.userFunctions;
    if (!registry) return undefined;
    // JavaScript only: interval runtime values need different guards, and
    // the shader targets cannot express the dispatcher. Fail closed there.
    if (target.language !== 'javascript' || registry.lowering) return undefined;

    const receiver = call.args[0];
    if (receiver === undefined) return undefined;

    // The receiver's static type. An `Assign` LHS root is a RAW symbol (it
    // never binds — the interpreter re-resolves at evaluation), so a
    // top-primitive answer falls back to the enclosing definition's declared
    // parameter type (`CompileTarget.declaredVarTypes`).
    let receiverType = receiver.type.type;
    if (
      (receiverType === 'unknown' || receiverType === 'any') &&
      isSymbol(receiver)
    ) {
      const declared = target.declaredVarTypes?.[receiver.symbol];
      if (declared !== undefined) receiverType = declared;
    }

    const plan = planProtocolDispatch(engine, {
      implKey: call.implKey,
      argc: call.args.length,
      receiverType,
      protocol: call.protocol,
    });
    if (plan === undefined) return undefined;
    if (call.staticOnly === true && plan.tier !== 'static') return undefined;

    // ── Plan the whole emission BEFORE mutating the registry ──────────────
    // (the multi-clause whole-function-decline discipline).

    // Canonicalize every implementation literal; any invalid one declines.
    const literals: (Expression & FunctionInterface)[] = [];
    for (const c of plan.candidates) {
      const canonical = c.literal.canonical;
      if (!isFunction(canonical, 'Function') || !canonical.isValid)
        return undefined;
      if (canonical.ops.length - 1 !== plan.argc) return undefined;
      literals.push(canonical);
    }

    // Render the receiver guards (dynamic tier).
    let guardSrcs: (string | null)[] | undefined;
    if (plan.tier === 'dynamic') {
      guardSrcs = [];
      // Guarded on the NORMALIZED receiver `_$n0` (see the multi-clause
      // dispatcher): a `{re, im: 0}` receiver is the real number `re` and
      // dispatches as such; the helper still receives the raw `_$p0`.
      for (const c of plan.candidates) {
        const g = BaseCompiler.renderReceiverGuard(c.guard!, '_$n0');
        if (g === undefined) return undefined;
        guardSrcs.push(g);
      }
    }

    // Call-boundary complex coercion, per position — UNANIMOUS across the
    // candidates (the multi-clause rule: where candidates disagree, wrapping
    // would change dispatch, so the position stays uncoerced).
    const sigParams = literals.map((lit) => {
      const t = lit.type.type;
      return typeof t === 'object' && t.kind === 'signature'
        ? t.args?.map((a) => a.type)
        : undefined;
    });
    // Gated on the PARAMETER's declared type alone, never on the argument's
    // — the same rule as the single-literal call site (`tryCompileUserFunction`):
    // every candidate body consumes such a parameter through complex slots,
    // so every call owes it a `{re, im}`, whatever the call site passes. The
    // wrap form itself is chosen per argument below (`protocolComplexWrap`).
    const coerceToComplex = call.args.map((_a, i) =>
      sigParams.every((params) => {
        const pt = params?.[i];
        return pt !== undefined && isNonRealNumber(pt);
      })
    );
    // STRICT discipline (design §3, "protocol member parameters" row): a
    // complex-shaped scalar argument at a position where some candidate's
    // parameter is WIDE (admits the value, body shaped real) is a
    // LaneMismatch DECLINE. Real-only candidate parameters reject a complex
    // value by validation before this point; complex-typed ones coerce.
    if (BaseCompiler.strictLanes)
      call.args.forEach((a, i) => {
        if (
          !BaseCompiler.provablyScalarOrFramedScalar(a) ||
          !BaseCompiler.isComplexValued(a)
        )
          return;
        const wide = sigParams.some((params) => {
          const pt = params?.[i];
          if (pt === undefined) return true;
          if (isNonRealNumber(pt)) return false;
          return !isSubtype(pt, 'real');
        });
        if (wide)
          BaseCompiler.laneMismatch(
            'protocol member parameter',
            `parameter ${i + 1} of the protocol member \`${call.member}\``,
            a
          );
      });

    // The generated code bakes the member's current conformance set: record
    // the dependency (see `CompileTarget.symbolDeps`).
    target.symbolDeps?.add(call.member);

    // ── Emit: one helper per candidate, in plan order ─────────────────────
    // The candidate bodies are the ARMS of one dispatcher: if any is
    // complex-valued, every provably-real one is coerced to `{re, im}`.
    const coerceResult = BaseCompiler.branchComplexCoercion(
      literals.map((l) => l.ops[0]),
      target
    );
    // The coercion is a property of the PLAN (the arm set), not of the edge:
    // the same edge can be emitted by a coercion-free singleton plan and
    // reused by a mixed real/complex chain (or vice versa), and the `defs`
    // cache would then hand the wrong result convention to one of them. Keep
    // the convention in the cache key so each variant is emitted once.
    const convention = coerceResult ? '$cx' : '';
    const helperNames: string[] = [];
    for (let i = 0; i < plan.candidates.length; i++) {
      const c = plan.candidates[i];
      // `$` cannot appear in a MathJSON symbol, so these names can never
      // collide with an emitted user function.
      const name = BaseCompiler.userFunctionName(
        `${call.implKey}$${c.protocol}$e${c.edgeIndex}${convention}`
      );
      helperNames.push(name);
      if (registry.defs.has(name) || registry.compiling.has(name)) continue;
      registry.compiling.add(name);
      try {
        const { params, bodyExpr, bodyTarget } =
          BaseCompiler.prepareUserFunctionBody(literals[i], target, registry);
        const compiled = BaseCompiler.withEnforcedParams(literals[i], () =>
          BaseCompiler.withNestedCseHarvest(bodyExpr, bodyTarget, params, () =>
            BaseCompiler.compile(bodyExpr, bodyTarget)
          )
        );
        const body = coerceResult ? coerceResult(bodyExpr, compiled) : compiled;
        registry.defs.set(
          name,
          `const ${name} = (${params.join(', ')}) => ${body};`
        );
      } finally {
        registry.compiling.delete(name);
      }
    }

    const compiledArgs = call.args.map((a, i) => {
      const code = BaseCompiler.compileValueOperand(a, target);
      return coerceToComplex[i]
        ? BaseCompiler.complexWrapCode(code, a, target)
        : code;
    });

    if (plan.tier === 'static')
      return `${helperNames[0]}(${compiledArgs.join(', ')})`;

    // ── The dispatcher: guard chain, most-specific-first ──────────────────
    // Emitted once per (implKey, protocol restriction); recursion through an
    // impl body re-enters here idempotently (all defs run in the preamble
    // before any call, so forward references are safe — the multi-clause
    // argument).
    const dName = BaseCompiler.userFunctionName(
      `${call.implKey}$${call.protocol ?? ''}$d`
    );
    if (!registry.defs.has(dName)) {
      const params = Array.from({ length: plan.argc }, (_, i) => `_$p${i}`);
      const branches = plan.candidates.map((_, i) => {
        const g = guardSrcs![i];
        const invoke = `return ${helperNames[i]}(${params.join(', ')});`;
        return g === null ? invoke : `if (${g}) ${invoke}`;
      });
      registry.defs.set(
        dName,
        `const ${dName} = (${params.join(', ')}) => { const _$n0 = _SYS.creal(_$p0); ${branches.join(' ')} ` +
          `throw new Error(${JSON.stringify(
            `protocol-implementation-missing: ${call.member}`
          )}); };`
      );
    }
    return `${dName}(${compiledArgs.join(', ')})`;
  }

  /**
   * Operator heads the compiler lowers directly in `compileExpr`, independent
   * of any target operator/function mapping (control-flow, binding, and
   * indexing-set forms). `analyzeReferences` never reports these as
   * "unsupported".
   */
  private static readonly STRUCTURAL_HEADS: ReadonlySet<string> = new Set([
    'Sequence',
    'Sum',
    'Product',
    'Function',
    'Declare',
    'Assign',
    'Return',
    'Break',
    'Continue',
    'Loop',
    'Comprehension',
    'If',
    'Which',
    'When',
    'Match',
    'Block',
    // Indexing-set wrappers consumed by Sum/Product/Loop — never compiled
    // standalone.
    'Limits',
    'Element',
    // Ascription — a bespoke, always-lowerable branch in `compileExpr` (it
    // compiles its operand); canonical function-literal bodies carry their
    // return marker as a `Typed` node, so without this the reference
    // analysis mislabeled every annotated body as unsupported.
    'Typed',
  ]);

  /**
   * Analyze — without compiling, and never throwing — which external references
   * the generated code for `expr` would have on `target`:
   *
   * - `freeSymbols`: identifiers the caller must supply at run time. These are
   *   the free symbols *as codegen sees them*: symbols with no value in the
   *   engine, after descending into the values of folded (assigned / constant)
   *   symbols — so `a = b + 1` surfaces `b`, which `expr.unknowns` misses — and
   *   after excluding bound variables (lambda parameters, indices of
   *   `Sum`/`Product`/`Integrate`/`Loop`, `Block` locals). A `vars`-mapped
   *   symbol is always included: the mapping makes it an external input even
   *   when it also has an assigned value.
   *
   * - `unsupported`: operator heads with no operator/function mapping in the
   *   target and not one of the structural forms above.
   *
   * Lets a caller validate that a compiled result is self-contained
   * (`freeSymbols` covered by its inputs, `unsupported` empty) declaratively,
   * instead of executing or GPU-compiling the code to discover a dangling
   * reference or an unlowerable operator.
   */
  static analyzeReferences(
    expr: Expression,
    target: CompileTarget<Expression>,
    varsKeys?: ReadonlySet<string>
  ): { freeSymbols: string[]; unsupported: string[] } {
    const engine = expr.engine;
    const free = new Set<string>();
    const unsupported = new Set<string>();
    // Guard against a symbol whose value (transitively) references itself.
    const foldedSeen = new Set<string>();
    // Guard against a (mutually) recursive user-defined function body.
    const userFnSeen = new Set<string>();

    const union = (a: ReadonlySet<string>, more: string[]): Set<string> => {
      const s = new Set(a);
      for (const m of more) s.add(m);
      return s;
    };

    // The declared parameter types of the literal body currently being
    // walked — the analysis-side mirror of `CompileTarget.declaredVarTypes`,
    // so probes that read a raw (never-bound) symbol (the protocol SET root)
    // resolve the same static type the compile path does. Replaced (not
    // stacked) per body, matching `prepareUserFunctionBody`.
    let declaredTypes: Readonly<Record<string, Type>> | undefined =
      target.declaredVarTypes;

    /** Visit a function literal's body with its parameters bound and its
     * declared-type frame installed. */
    const visitLiteralBody = (
      literal: Expression & FunctionInterface,
      bound: ReadonlySet<string>
    ): void => {
      // A destructuring parameter binds its LEAF names, not a name of its own,
      // so `functionLiteralBoundNames` (not `functionLiteralParameterName`) is
      // what shadows them here: analysed as unbound, the leaves would read as
      // free ambient symbols of the enclosing scope.
      const params = functionLiteralBoundNames(literal.ops.slice(1));
      const saved = declaredTypes;
      declaredTypes = BaseCompiler.literalDeclaredParamTypes(literal);
      try {
        visit(literal.ops[0], params.length ? union(bound, params) : bound);
      } finally {
        declaredTypes = saved;
      }
    };

    /** The receiver type a dispatch probe should use — the expression's own
     * static type, falling back to the current body's declared parameter
     * type for a raw symbol (the same fallback `tryCompileProtocolDispatch`
     * applies). */
    const probeReceiverType = (r: Expression | undefined): Type | undefined => {
      if (r === undefined) return undefined;
      let t = r.type.type;
      if ((t === 'unknown' || t === 'any') && isSymbol(r)) {
        const declared = declaredTypes?.[r.symbol];
        if (declared !== undefined) t = declared;
      }
      return t;
    };

    /** Can the protocol dispatch tier run on this target at all? */
    const jsProtocolTarget = (): boolean =>
      target.language === 'javascript' &&
      target.userFunctions !== undefined &&
      target.userFunctions.lowering === undefined;

    /** Descend into a dispatch plan's implementation bodies, once per
     * DISPATCH IDENTITY (protocol restriction + impl key — never the
     * syntactic head, which `ProtocolMember`/`Field` share across members). */
    const visitProtocolPlan = (
      key: string,
      plan: NonNullable<ReturnType<typeof planProtocolDispatch>>,
      bound: ReadonlySet<string>
    ): void => {
      if (userFnSeen.has(`protocol:${key}`)) return;
      userFnSeen.add(`protocol:${key}`);
      for (const c of plan.candidates) {
        // The CANONICAL literal — the body the dispatch tier compiles (the
        // raw one still carries `Typed` ascription nodes).
        const literal = c.literal.canonical;
        if (!isFunction(literal, 'Function')) continue;
        visitLiteralBody(literal, bound);
      }
    };

    const visit = (e: Expression, bound: ReadonlySet<string>): void => {
      if (isSymbol(e)) {
        const s = e.symbol;
        if (bound.has(s)) return;
        // An operator used as a value (e.g. compiling a bare `Add`) is lowered
        // to a lambda, not a free input.
        if (target.operators?.(s) !== undefined) return;
        // A `vars`-mapped symbol is an external input the caller supplies; the
        // mapping always wins (see `CompileTarget.vars`) — checked before the
        // user-function lowering so a `vars` key that shadows a user-function
        // name stays an external input, consistent with the value-position
        // codegen in `compile`.
        if (varsKeys?.has(s)) {
          free.add(s);
          return;
        }
        // A bare symbol naming a user-defined function, used in value position
        // (a higher-order operand like `Map(f, list)`), is lowered to the
        // shared emitted local `_fn_f` — not a free input. Descend into its
        // body (parameters bound) to surface transitively referenced free
        // symbols; guard against recursion. Mirrors the value-position codegen
        // in `compile` and the head-position handling below. (A bound name is
        // already handled by the `bound.has(s)` guard above.)
        if (target.userFunctions !== undefined) {
          const symLiteral = BaseCompiler.userFunctionLiteral(engine, s);
          if (symLiteral !== undefined) {
            if (!userFnSeen.has(s)) {
              userFnSeen.add(s);
              visitLiteralBody(symLiteral, bound);
            }
            return;
          }
          // Likewise a bare BUILT-IN operator symbol in value position: the
          // codegen eta-expands it into the shared local `_fn_Sin`
          // (`ensureBuiltinCallbackEmitted`), so the artifact needs no input
          // for it. Its wrapper body references nothing but its parameters.
          if (builtinCallbackArity(engine, s) !== undefined) return;
        }
        // A symbol with a value (assigned, or a constant like `Pi`) is folded
        // into the code; descend into the value to surface any transitively
        // referenced free symbols.
        const value = engine._getSymbolValue(s);
        if (value !== undefined) {
          if (!foldedSeen.has(s)) {
            foldedSeen.add(s);
            visit(value, bound);
          }
          return;
        }
        // A constant the target bakes into the emitted code is not an input
        // the caller has to supply. Most constants never reach here — the
        // engine holds a value for `Pi` and friends, so the fold above claims
        // them — but one the engine has no value for does, and on the
        // JavaScript target the boolean literals `True`/`False` are exactly
        // that, so `Which(x > 0, 1, True, 2)` used to report a phantom input
        // named `True`.
        //
        // This must be `constant`, never `var`: `var` is the general variable
        // emitter and falls back to a vars-object reference (`_.x`) for any
        // symbol it does not recognize, so testing it here would suppress
        // EVERY free symbol. Which constants exist is per-target — only the
        // JavaScript target inlines the booleans — so the answer has to come
        // from the target rather than from a fixed list here.
        if (target.constant?.(s) !== undefined) return;
        // No mapping, no value, not a constant: a genuinely free symbol.
        free.add(s);
        return;
      }

      if (!isFunction(e)) return; // numbers, strings: nothing to collect

      // Capture `ops`/`h` up front: narrowing `e` with `isFunction(e, 'X')`
      // below would otherwise strip `.ops` from `e` in the fall-through.
      const h = e.operator;
      const ops: ReadonlyArray<Expression> = e.ops;

      // The two compile-path protocol intercepts that do NOT key on the head
      // alone — mirrored here, or their operands are analyzed as ordinary
      // expressions (listing `Field` as unsupported on a compilable SET, or
      // descending into a getter where the compile path emits a setter).
      //
      // Qualified call: `Apply(Field(Protocol, "member"), args…)`. The
      // compile path declines whole-unit when the tier declines, so the
      // member is reported unsupported in that case.
      if (h === 'Apply' && ops.length >= 2 && isFunction(ops[0], 'Field')) {
        const fieldOps = ops[0].ops;
        const record = protocolOfSymbol(engine, fieldOps[0]);
        const member = isString(fieldOps[1]) ? fieldOps[1].string : undefined;
        if (record !== undefined && member !== undefined) {
          const plan = jsProtocolTarget()
            ? planProtocolDispatch(engine, {
                implKey: member,
                argc: ops.length - 1,
                receiverType: probeReceiverType(ops[1]),
                protocol: record.name,
              })
            : undefined;
          if (plan !== undefined)
            visitProtocolPlan(`${record.name}:${member}`, plan, bound);
          else unsupported.add(member);
          // The call arguments are ordinary expressions; the protocol-naming
          // `Field` callee is consumed by the intercept and never compiled.
          for (const op of ops.slice(1)) visit(op, bound);
          return;
        }
      }
      // A property STORE, in either of its two spellings:
      // `Assign(Field(root, "name"), v)` — the unqualified `p.name = v`, which
      // keeps its `Field` target through canonicalization — and the
      // four-operand `ProtocolProperty(P, "name", root, v)` the qualified
      // `p.(P.name) = v` lowers to. Neither is lowerable: a store writes a
      // mutable object, and objects have no compiled representation yet. Both
      // are reported UNSUPPORTED here, in step with the value path, which fails
      // closed (D6) on the same two shapes.
      //
      // The `Assign` arm claims EVERY `Field` target, not only names some
      // protocol declares as a property: an ordinary layout store has no
      // lowering either, and the value path refuses it identically.
      if (
        h === 'Assign' &&
        (isFunction(ops[0], 'Field') || isFunction(ops[0], 'ProtocolProperty'))
      ) {
        unsupported.add(ops[0].operator);
        // The receiver is the LAST operand of either target shape.
        const root = ops[0].ops[ops[0].ops.length - 1];
        if (root !== undefined) visit(root, bound);
        if (ops[1] !== undefined) visit(ops[1], bound);
        return;
      }
      if (h === 'ProtocolProperty' && ops.length === 4) {
        unsupported.add('ProtocolProperty');
        for (const op of ops.slice(2)) visit(op, bound);
        return;
      }

      // A head that names a user-defined function literal is lowerable (emitted
      // as a named local function — see `tryCompileUserFunction`), not
      // unsupported. Descend into its body (parameters bound) so free symbols it
      // references transitively are surfaced; guard against recursion.
      const userLiteral =
        target.userFunctions !== undefined &&
        !BaseCompiler.STRUCTURAL_HEADS.has(h) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined
          ? BaseCompiler.userFunctionLiteral(engine, h)
          : undefined;

      // A head whose operator definition supplies a custom `compile` handler
      // (the public per-operator extension point) MAY be lowerable via that
      // handler even with no operator/function mapping — so it must NOT be
      // reported as unsupported (finding A4). But a handler can decline for the
      // current target language, returning `undefined`/`null`/`''` (see the
      // handler consult in `compileExpr`); assuming support unconditionally
      // would under-report `unsupported` for e.g. a JavaScript-only handler on
      // a glsl/python target. So probe the handler with the real recursive
      // compile machinery in a throwaway context: a non-empty string return
      // means it lowers this head, while `undefined`/`null`/`''`/throw means it
      // declined. Executing the handler here is safe — the compile path would
      // run the same handler on the same expression anyway. The probe only runs
      // when no other lowering applies (structural/control-flow heads are not
      // overridable and are excluded — except the
      // `OVERRIDABLE_CONTROL_FLOW_HEADS` carve-out — matching the consult in
      // `compileExpr`; the two guards must stay identical).
      let hasCustomCompile = false;
      if (
        (!BaseCompiler.CONTROL_FLOW_HEADS.has(h) ||
          BaseCompiler.OVERRIDABLE_CONTROL_FLOW_HEADS.has(h)) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined &&
        userLiteral === undefined
      ) {
        const customCompileDef = engine.lookupDefinition(h);
        if (
          isOperatorDef(customCompileDef) &&
          typeof customCompileDef.operator.compile === 'function'
        ) {
          try {
            const probe = customCompileDef.operator.compile(
              // The declared-type receiver fallback the compile path applies
              // (see `fieldArgsWithDeclaredReceiver`), with the analysis
              // walk's own frame standing in for the target's map.
              BaseCompiler.fieldArgsWithDeclaredReceiver(
                engine,
                h,
                ops,
                declaredTypes
              ) ?? ops,
              (e) => BaseCompiler.compileValueOperand(e, target),
              { language: target.language ?? 'javascript' }
            );
            hasCustomCompile =
              probe !== undefined && probe !== null && probe !== '';
          } catch {
            hasCustomCompile = false;
          }
        }
      }

      // A protocol call the dispatch tier can lower is supported on the JS
      // target; everywhere else it keeps reporting unsupported (the tier is
      // JS-only, mirroring `tryCompileProtocolDispatch`'s gate). The probe is
      // the pure planner — no emission, same decision the compile path makes.
      let protocolPlan: ReturnType<typeof planProtocolDispatch> = undefined;
      let protocolPlanKey = '';
      if (
        jsProtocolTarget() &&
        !BaseCompiler.STRUCTURAL_HEADS.has(h) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined &&
        userLiteral === undefined &&
        !hasCustomCompile
      ) {
        const parts = BaseCompiler.protocolCallParts(engine, h, ops);
        if (parts !== undefined && parts.args[0] !== undefined) {
          protocolPlan = planProtocolDispatch(engine, {
            implKey: parts.implKey,
            argc: parts.args.length,
            receiverType: probeReceiverType(parts.args[0]),
            protocol: parts.protocol,
          });
          if (parts.staticOnly === true && protocolPlan?.tier !== 'static')
            protocolPlan = undefined;
          protocolPlanKey = `${parts.protocol ?? ''}:${parts.implKey}`;
        }
      }

      if (
        h !== 'Error' &&
        !BaseCompiler.STRUCTURAL_HEADS.has(h) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined &&
        userLiteral === undefined &&
        !hasCustomCompile &&
        protocolPlan === undefined
      )
        unsupported.add(h);

      // Descend into the plan's implementation bodies (parameters bound), the
      // same walk the user-literal branch below performs, so symbols an
      // implementation references transitively are surfaced. Keyed by the
      // DISPATCH IDENTITY, not the head — `ProtocolMember`/`ProtocolProperty`
      // are shared wrappers across every member.
      if (protocolPlan !== undefined)
        visitProtocolPlan(protocolPlanKey, protocolPlan, bound);

      if (userLiteral !== undefined) {
        if (!userFnSeen.has(h)) {
          userFnSeen.add(h);
          visitLiteralBody(userLiteral, bound);
        }
        // The call arguments are evaluated in the surrounding scope.
        for (const op of ops) visit(op, bound);
        return;
      }

      // Binding forms: shadow their bound variables in the body, but visit the
      // bound expressions (limits / collections) in the outer scope.
      if (h === 'Function') {
        // A destructuring parameter binds its LEAF names, not a name of its
        // own; shadowing only the readable parameter names would leave those
        // leaves analysed as free ambient symbols.
        const params = functionLiteralBoundNames(ops.slice(1));
        visit(ops[0], params.length ? union(bound, params) : bound);
        return;
      }
      if (
        h === 'Sum' ||
        h === 'Product' ||
        h === 'Integrate' ||
        h === 'Loop' ||
        h === 'Comprehension'
      ) {
        const indices: string[] = [];
        const limitExprs: Expression[] = [];
        for (const clause of ops.slice(1)) {
          if (isFunction(clause)) {
            if (isSymbol(clause.ops[0])) indices.push(clause.ops[0].symbol);
            for (const sub of clause.ops.slice(1)) limitExprs.push(sub);
          } else {
            limitExprs.push(clause);
          }
        }
        visit(ops[0], indices.length ? union(bound, indices) : bound);
        for (const le of limitExprs) visit(le, bound);
        return;
      }
      if (h === 'Block') {
        const locals: string[] = [];
        // A destructuring declare (`let (x, y) = …`) binds every symbol leaf
        // of its tuple pattern (`_` binds nothing; patterns nest).
        const collectPatternLeaves = (p: Expression): void => {
          if (isSymbol(p)) {
            if (p.symbol !== '_') locals.push(p.symbol);
          } else if (isFunction(p, 'Tuple'))
            for (const el of p.ops) collectPatternLeaves(el);
        };
        for (const stmt of ops)
          if (isFunction(stmt, 'Declare')) {
            if (isSymbol(stmt.ops[0])) locals.push(stmt.ops[0].symbol);
            else if (isFunction(stmt.ops[0], 'Tuple'))
              collectPatternLeaves(stmt.ops[0]);
          }
        const inner = locals.length ? union(bound, locals) : bound;
        // Typed block locals extend the declared-type frame (the mirror of
        // the `compileBlock` / `loopBodyTempTarget` merge), so a protocol
        // SET/GET probe on a local declared in this list resolves the same
        // static type the compile path does.
        const saved = declaredTypes;
        declaredTypes = BaseCompiler.statementListDeclaredVarTypes(
          ops,
          declaredTypes
        );
        try {
          for (const op of ops) visit(op, inner);
        } finally {
          declaredTypes = saved;
        }
        return;
      }
      if (h === 'Match') {
        // The subject is evaluated in the enclosing scope.
        if (ops[0] !== undefined) visit(ops[0], bound);
        for (const c of ops.slice(1)) {
          if (!isFunction(c, 'MatchCase') || c.ops.length < 2) continue;
          const cops = c.ops;
          const pattern = cops[0];
          const guard = cops.length >= 3 ? cops[1] : undefined;
          const body = cops[cops.length - 1];
          // Captures shadow the guard/body; pin operands are external references
          // (evaluated in the enclosing scope at match time).
          const { captures, pinExprs } = matchPatternReferences(pattern);
          const inner = captures.length ? union(bound, captures) : bound;
          if (guard !== undefined) visit(guard, inner);
          visit(body, inner);
          for (const pin of pinExprs) visit(pin, bound);
        }
        return;
      }

      for (const op of ops) visit(op, bound);
    };

    visit(expr, new Set());
    return { freeSymbols: [...free], unsupported: [...unsupported] };
  }

  /**
   * Attach `freeSymbols` / `unsupported` (from `analyzeReferences`) and the
   * mode report (`mode`, `promoted`) to a compilation result, returning the
   * same object. Used by the built-in targets to make every result carry its
   * declarative reference analysis and the discipline it was compiled under.
   *
   * The report is the one frozen when the outermost compilation ended
   * (`modeReport`): `mode` is the latched discipline, `promoted` whether a
   * promotable head was lowered through a complex kernel.
   */
  static withReferences<
    R extends {
      freeSymbols?: string[];
      unsupported?: string[];
      mode?: 'strict' | 'complex';
      promoted?: boolean;
    },
  >(
    result: R,
    expr: Expression,
    target: CompileTarget<Expression>,
    varsKeys?: ReadonlySet<string>
  ): R {
    return Object.assign(
      result,
      BaseCompiler.analyzeReferences(expr, target, varsKeys),
      BaseCompiler.modeReport()
    );
  }

  /**
   * The `mode`/`promoted` fields every built-in result carries (see
   * `CompilationResult`): the report frozen when the most recent outermost
   * compilation ended (`_lastReport`) — the RESOLVED discipline the code was
   * compiled under, and whether a promotable head was lowered through a
   * complex kernel.
   *
   * `mode` is the latched DISCIPLINE, with `'auto'` collapsed to `'strict'`
   * (`'auto'` is never reported: it is a policy over the two disciplines —
   * try strict, escalate on a `LaneMismatch` — not one code can be compiled
   * under), widened to `'complex'` when a promotable head was promoted. So it
   * is `'complex'` when the complex discipline was requested, when `auto`
   * escalated to it on a retry, and when `auto`'s first attempt promoted a
   * head without escalating.
   *
   * It is NOT a lane oracle: an operand that is already complex-TYPED
   * (`Sqrt(z)` with `z: complex`) or a complex literal (`2i·x`) routes
   * through the complex kernel in every discipline, and
   * `promotesRadicalToComplex` deliberately does not count that as a
   * promotion — `promoted` reports a lane DIFFERENCE with the shader targets,
   * which only an unknown-sign real-shaped operand creates. Such a compile
   * emits `{re, im}` and still reports `mode: 'strict'`. Test a returned
   * value's shape with `typeof v === 'number'`, not with `mode`.
   *
   * `mode === 'complex'` is implied by `promoted === true`; the two still
   * differ, since an explicitly requested `'complex'` compile that contained
   * no promotable head reports `('complex', false)`.
   *
   * A DECLINE reports the neutral `('strict', false)`: the report describes
   * emitted code, and a decline emitted none (see `compile`'s `finally`).
   */
  static modeReport(): { mode: 'strict' | 'complex'; promoted: boolean } {
    return { ...BaseCompiler._lastReport };
  }

  /**
   * Build the documented `success: false` compilation result for an expression
   * that could not be lowered to the target, with `run` set to an
   * interpreter-backed evaluator (the "fall back to interpretation" contract).
   *
   * This is the shared implementation behind both the engine-level free-function
   * `compile()` (which always falls back unless `fallback: false`) and the
   * built-in `LanguageTarget.compile()` methods (which throw by default, but
   * fall back to this shape when the caller opts in with `fallback: true`). The
   * `run` closure mirrors `evaluate()` semantics: a scalar collapses to its real
   * part, a finite indexed collection materializes to a nested JS array, and a
   * `Function` literal uses the positional `lambda` calling convention.
   *
   * `error` is preserved on the result so the caller can report *why* it could
   * not be compiled without re-throwing, and `diagnostic` (the structured form
   * — the payload of a `CompileDeclineError`, or the generic `capability`
   * diagnostic `compileDiagnosticOf` builds from the message) is set beside
   * it; `compileTarget` (when available) drives the declarative
   * `freeSymbols`/`unsupported` reference analysis. This method never throws
   * for a compile reason — the reference analysis is guarded.
   *
   * The runner honors the compiled runner's value contract in both
   * directions (design D7, `docs/COMPILATION-MODEL.md`
   * §8): each `vars` value is declared from its RUNTIME SHAPE (`complex` for
   * a `{re, im}` object, `number` for a number), and a scalar result comes
   * back as a plain `number` when its imaginary part is exactly zero, as a
   * `{re, im}` `ComplexResult` otherwise, and as a boolean when it is one —
   * the same convention a successful JavaScript compile uses, so a caller
   * cannot tell a decline from a compile by the SHAPE of the values.
   */
  static buildInterpreterFallback<T extends string>(
    expr: Expression,
    error: string,
    targetName: T,
    compileTarget: CompileTarget<Expression> | undefined,
    varsKeys: Set<string> | undefined,
    diagnostic?: CompileDiagnostic
  ): CompilationResult<T> {
    const ce = expr.engine;
    diagnostic ??= {
      code: 'compile-error',
      kind: 'capability',
      message: error,
    };
    // Materialize an interpreted result matching the compiled-runner value
    // contract: a scalar yields a `number` (imaginary part exactly zero), a
    // `{re, im}` object (otherwise) or a boolean; a finite indexed collection
    // becomes a nested JS array of element values. A scalar leaf is
    // numericized first — `evaluate()` correctly stays symbolic for an exact
    // argument (`ln(2)` evaluates to `Ln(2)`), and `.re` of a symbolic
    // expression is NaN, so without `.N()` every decline whose expression has
    // no non-symbolic evaluation would run to NaN instead of its value.
    const interpretedRunValue = (
      e: Expression
    ): number | boolean | ComplexResult | unknown[] => {
      if (e.isCollection) return [...e.each()].map(interpretedRunValue);
      if (isSymbol(e, 'True')) return true;
      if (isSymbol(e, 'False')) return false;
      const n = e.N();
      if (isSymbol(n, 'True')) return true;
      if (isSymbol(n, 'False')) return false;
      const im = n.im;
      // `im` is NaN for a symbolic residue (no numeric value): a number, not
      // an object, is the honest shape for "no value" — `re` is NaN too.
      if (im !== 0 && !Number.isNaN(im)) return { re: n.re, im };
      return n.re;
    };
    // The interpreter's value for a runtime argument: a `{re, im}` object is a
    // complex number, anything else boxes as it always did.
    const isComplexArg = (v: unknown): v is ComplexResult =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as ComplexResult).re === 'number' &&
      typeof (v as ComplexResult).im === 'number';
    const boxArg = (v: unknown): Expression =>
      isComplexArg(v) ? ce.number(ce.complex(v.re, v.im)) : ce.expr(v as never);

    // Declarative reference analysis so the (success: false) result still tells
    // the caller *why* it could not be compiled without parsing `error`. Never
    // let the analysis itself break the fallback.
    let refs: { freeSymbols: string[]; unsupported: string[] } = {
      freeSymbols: [],
      unsupported: [],
    };
    try {
      if (compileTarget)
        refs = BaseCompiler.analyzeReferences(expr, compileTarget, varsKeys);
    } catch {
      /* keep the empty analysis */
    }

    // A function literal (lambda) uses the positional `lambda` calling
    // convention — `run(a, b, ...)`. The fallback must mirror that by applying
    // the function to its positional arguments via the interpreter; otherwise
    // positional arguments are silently dropped.
    if (isFunction(expr, 'Function')) {
      const lambdaRun = ((...args: unknown[]) =>
        interpretedRunValue(
          ce.function('Apply', [expr, ...args.map(boxArg)]).evaluate()
        )) as unknown as CompiledRunner;
      return {
        target: targetName,
        success: false,
        code: '',
        calling: 'lambda',
        run: lambdaRun,
        error,
        diagnostic,
        ...BaseCompiler.modeReport(),
        ...refs,
      } as CompilationResult<T>;
    }

    // Otherwise the expression uses the `expression` calling convention:
    // `run({ x, y, ... })` with a variables object.
    const fallbackRun = ((vars: Record<string, unknown>) => {
      ce.pushScope();
      try {
        if (vars && typeof vars === 'object') {
          for (const [k, v] of Object.entries(vars)) {
            // Declare a fresh local shadow before assigning so `popScope` fully
            // restores the previous state (a bare `assign` would mutate an
            // outer/global binding and leak the argument value engine-wide).
            // The shadow's type is the value's RUNTIME shape: a `{re, im}`
            // object is a complex number (declaring it `number` would reject
            // the assignment and run the expression against an unbound
            // symbol), a number is a number.
            if (isComplexArg(v)) {
              ce.declare(k, 'complex');
              ce.assign(k, ce.number(ce.complex(v.re, v.im)));
            } else {
              ce.declare(k, 'number');
              ce.assign(k, v as number);
            }
          }
        }
        return interpretedRunValue(expr.evaluate());
      } finally {
        ce.popScope();
      }
    }) as unknown as CompiledRunner;
    return {
      target: targetName,
      success: false,
      code: '',
      calling: 'expression',
      run: fallbackRun,
      error,
      diagnostic,
      ...BaseCompiler.modeReport(),
      ...refs,
    } as CompilationResult<T>;
  }

  /**
   * Extend a target's `boundVars` set with additional locally-bound names
   * (lambda parameters, loop indices, block locals, comprehension variables,
   * `Match` captures). Returns a set suitable for spreading into an inner
   * target alongside its `var` override, so `compile` recognizes a
   * value-position reference to the bound name as a local — not a free
   * user-function reference to capture — even when the binding form resolves
   * the name to non-identity code. See finding A2. Empty `names` returns the
   * existing set unchanged (no allocation).
   */
  static withBoundNames(
    target: CompileTarget<Expression>,
    names: ReadonlyArray<string>
  ): ReadonlySet<string> | undefined {
    const nonEmpty = names.filter((n) => n !== '' && n !== undefined);
    if (nonEmpty.length === 0) return target.boundVars;
    const s = new Set(target.boundVars);
    for (const n of nonEmpty) s.add(n);
    return s;
  }

  /**
   * The naming context of the compilation `target` belongs to, installing a
   * fresh one when the target has none.
   *
   * Every root compilation boundary creates the context (each target's
   * `createTarget()`, `compile-expression.ts` for the direct custom-target
   * route), and `compile()` installs one on the OUTERMOST call for a
   * hand-rolled target that has none — before any `{ ...target }` spread, so
   * every copy shares the one reference. This last-resort fallback therefore
   * only fires for a target reached with no compilation around it at all
   * (`tempVar()` called directly by a target's own helper); installing it on a
   * spread COPY would fork the counter, and two branches would then allocate
   * the same name.
   */
  static namingContext(target: CompileTarget<Expression>): NamingContext {
    let naming = target.naming;
    if (naming === undefined) {
      naming = { counter: 0, usedNames: new Set<string>() };
      target.naming = naming;
    }
    return naming;
  }

  /**
   * A fresh naming context for a root compilation of `expr`.
   *
   * `sources` are the caller-supplied source strings spliced into the emitted
   * code (`functions` entries that are strings, string-valued `vars`, the
   * `preamble`): they are scanned for `_tv`/`_cse` tokens so a generated temp
   * never captures a name a splice introduces.
   *
   * `extra` are identifiers the caller supplies OUT of band that the emitter
   * writes bare — the Python target's `compileFunction`/`compileLambda`
   * parameter lists. (Names that come from the expression, e.g. a `Function`
   * literal's parameters, are already covered by the walk.)
   */
  static newNamingContext(
    expr?: Expression | ReadonlyArray<Expression | undefined>,
    sources?: ReadonlyArray<string | undefined>,
    extra?: ReadonlyArray<string>
  ): NamingContext {
    return { counter: 0, usedNames: collectUsedNames(expr, sources, extra) };
  }

  /**
   * Restart the generated-name numbering of the compilation `target` belongs
   * to, keeping its collision inventory.
   *
   * The mirror of the GPU targets' random-counter reset: a target the CALLER
   * built once and passes to two successive compilations would otherwise
   * number the second compilation's temporaries from where the first stopped.
   */
  static resetNaming(target: CompileTarget<Expression>): void {
    BaseCompiler.namingContext(target).counter = 0;
  }

  /**
   * Generate a temporary variable name: `_tv1`, `_tv2`, … from the target's
   * naming context, skipping any name the compilation already uses.
   *
   * Deterministic by construction — the same expression compiled twice emits
   * byte-identical source (it used to draw from `Math.random()`).
   */
  static tempVar(target: CompileTarget<Expression>): string {
    const naming = BaseCompiler.namingContext(target);
    let name: string;
    do {
      name = `_tv${++naming.counter}`;
    } while (naming.usedNames.has(name));
    return name;
  }

  // ---------------------------------------------------------------------------
  // Common-subexpression elimination — emission side (§6 of
  // `docs/plans/2026-07-28-compile-cse-design.md`). The ANALYSIS side is
  // `cse.ts`; the dependency direction is base-compiler → cse.
  // ---------------------------------------------------------------------------

  /**
   * A CSE temporary: `_cse1`, `_cse2`, … drawn from the SAME naming-context
   * counter as `tempVar()`, skipping any name the compilation already uses
   * (§6.3 — neither prefix is reserved, collisions are prevented).
   */
  private static cseTempVar(target: CompileTarget<Expression>): string {
    const naming = BaseCompiler.namingContext(target);
    let name: string;
    do {
      name = `_cse${++naming.counter}`;
    } while (naming.usedNames.has(name));
    return name;
  }

  /**
   * Open the CSE session of a **root compilation boundary** (§4.2): harvest
   * `expr` — which must already be the post-`rewriteAngularUnit` tree the
   * emitters will walk — and stamp the session on `target`, merging the
   * harvest's symbol inventory into the naming context (§4.1).
   *
   * The session is stamped `enabled: false` — every CSE hook then short-circuits
   * and emission is byte-identical to the pre-CSE one — when the caller passed
   * `cse: false`, or when the target cannot bind temporaries in expression
   * position (no `cseBind`: the GPU shader targets).
   *
   * `isOverriddenOperator` / `isStringVar` are the G1b provenance predicates
   * (§5.2). They must be built from the caller's RAW options, before those are
   * merged into the target's resolver closures — a closure cannot tell a
   * built-in entry from a caller-supplied one.
   */
  static openCseSession(
    expr: Expression,
    target: CompileTarget<Expression>,
    options: {
      enabled?: boolean;
      isOverriddenOperator?: (name: string) => boolean;
      isPureOverriddenOperator?: (name: string) => boolean;
      isStringVar?: (name: string) => boolean;
      isVarsKey?: (name: string) => boolean;
    } = {}
  ): void {
    const harvestOptions: CseHarvestOptions = {
      isOverriddenOperator: options.isOverriddenOperator,
      isPureOverriddenOperator: options.isPureOverriddenOperator,
      isStringVar: options.isStringVar,
      isVarsKey: options.isVarsKey,
      // PURE user-function applications are admitted at the root too (item 120
      // follow-up): a repeated `f(x+1)` at the root is the same redundant call
      // as one inside a definition body. Admission validates the resolved
      // callee's BODY transitively (`isAdmissibleUserFnCallee`), and G1
      // (`node.isPure`) independently keeps a drawing/writing call inert.
      admitPureUserFunctions: true,
    };
    // A disabled session still records the predicates. They describe the
    // CALLER's inputs — which names were re-mapped, which are string-valued
    // `vars` — not the CSE transform, and an emitter that needs that fact for
    // a decision of its own (`isEmissionSkippable`) must not have its answer
    // change because sharing was turned off. Every transform that DOES share
    // an emission checks `enabled` for itself.
    if (options.enabled === false || typeof target.cseBind !== 'function') {
      target.cse = { enabled: false, harvestOptions, instances: [] };
      return;
    }
    const harvest = harvestCse(expr, harvestOptions);
    BaseCompiler.mergeUsedNames(target, harvest.usedNames);
    target.cse = { enabled: true, harvest, harvestOptions, instances: [] };
  }

  /** Add a harvest's symbol inventory to the compilation's collision
   * inventory, in place (a harvest runs at every boundary AND per emitted
   * user-function body — copying each time is pure churn). */
  private static mergeUsedNames(
    target: CompileTarget<Expression>,
    names: ReadonlySet<string>
  ): void {
    const merged = BaseCompiler.namingContext(target).usedNames;
    for (const n of names) merged.add(n);
  }

  /**
   * The static region an instance realizes.
   *
   * `CseRegionInstance` keeps it structurally opaque — `compilation/types.ts`
   * is expression-type-free by design, so it cannot name `cse.ts`'s types —
   * and this compiler, their only consumer, narrows here.
   */
  private static cseRegionOf(
    instance: CseRegionInstance | undefined
  ): CseRegion | undefined {
    return instance?.region as CseRegion | undefined;
  }

  /** The static harvest of the tree currently being emitted. See
   * `cseRegionOf` for why the narrowing is explicit. */
  private static cseHarvestOf(
    target: CompileTarget<Expression>
  ): CseHarvest | undefined {
    return target.cse?.harvest as CseHarvest | undefined;
  }

  /** The innermost region instance, or `undefined` when CSE is inactive for
   * this compilation. */
  private static cseTop(
    target: CompileTarget<Expression>
  ): CseRegionInstance | undefined {
    const session = target.cse;
    if (session === undefined || !session.enabled) return undefined;
    return session.instances[session.instances.length - 1];
  }

  /** Push a fresh instance of `region` (`undefined` = a blind instance, which
   * resolves no candidate). */
  private static pushCseInstance(
    target: CompileTarget<Expression>,
    region: CseRegion | undefined
  ): CseRegionInstance {
    const instance: CseRegionInstance = {
      region,
      bindings: [],
      state: new Map(),
      names: new Map(),
      boundVars: target.boundVars,
    };
    target.cse!.instances.push(instance);
    return instance;
  }

  /**
   * Compile `fn`'s body as one instance of `region`, wrapping the result with
   * the target's `cseBind` when temporaries were bound (§6.1). Instances —
   * never static regions — hold the bindings, so a re-entrant emission of
   * shared structure (an unrolled `Sum` term) can never reuse another
   * traversal's temporary.
   */
  private static withCseRegion(
    target: CompileTarget<Expression>,
    region: CseRegion | undefined,
    fn: () => TargetSource
  ): TargetSource {
    const session = target.cse!;
    const instance = BaseCompiler.pushCseInstance(target, region);
    let code: TargetSource;
    try {
      code = fn();
    } finally {
      session.instances.pop();
    }
    if (instance.bindings.length === 0) return code;
    return target.cseBind!(instance.bindings, code);
  }

  /**
   * Compile an expression-position operand through the region harvest opened
   * for the edge `(parent, opIndex)`, if any — the emission counterpart of the
   * shared lazy/binder inventory (§5.1). A non-region edge compiles exactly as
   * before, inheriting the enclosing instance.
   *
   * `target` is the target the OPERAND compiles under (a binder body's inner
   * target, say): the instance records its `boundVars`, which is what keeps the
   * blind-instance guard from firing inside a region that was pushed on purpose.
   */
  static withCseOperand(
    parent: Expression | undefined,
    opIndex: number,
    target: CompileTarget<Expression>,
    fn: () => TargetSource
  ): TargetSource {
    const top = BaseCompiler.cseTop(target);
    if (top === undefined || parent === undefined) return fn();
    const region = childRegionAt(
      BaseCompiler.cseRegionOf(top),
      parent,
      opIndex
    );
    if (region === undefined) return fn();
    return BaseCompiler.withCseRegion(target, region, fn);
  }

  /**
   * The statement-list flavor of {@link withCseOperand}: pushes the region of
   * edge `(parent, opIndex)` for the duration of `fn` without wrapping its
   * result. Only for INERT regions (a `Block`/`Loop` statement list, §5.1(c)),
   * which bind nothing — the statements' own value expressions are separate,
   * bindable child regions.
   */
  static withCseScope<T>(
    parent: Expression | undefined,
    opIndex: number,
    target: CompileTarget<Expression>,
    fn: () => T
  ): T {
    const top = BaseCompiler.cseTop(target);
    if (top === undefined || parent === undefined) return fn();
    const region = childRegionAt(
      BaseCompiler.cseRegionOf(top),
      parent,
      opIndex
    );
    if (region === undefined) return fn();
    const instance = BaseCompiler.pushCseInstance(target, region);
    let result: T;
    try {
      result = fn();
    } finally {
      target.cse!.instances.pop();
    }
    // Fail CLOSED (D6) on the normal path: an inert region has no wrapper to
    // emit the bindings with, so a temporary accumulated here would be
    // DROPPED — the body would reference a name nothing defines. A
    // `console.assert` is stripped from the production build, so this is a
    // throw. (The exception path is left alone: it must not mask the original
    // error.)
    if (instance.bindings.length > 0)
      throw new Error(
        'Internal: a statement-list CSE region bound a temporary, which has ' +
          'no wrapper to emit it. Fail closed (D6).'
      );
    return result;
  }

  /** Compile operand `opIndex` of `parent` (§5.1's `compileOp`). */
  static compileOp(
    parent: Expression | undefined,
    opIndex: number,
    target: CompileTarget<Expression>,
    prec = 0,
    operand?: Expression
  ): TargetSource {
    const expr = operand ?? BaseCompiler.operandAt(parent, opIndex);
    return BaseCompiler.withCseOperand(parent, opIndex, target, () =>
      BaseCompiler.compile(expr, target, prec)
    );
  }

  /** {@link compileOp} through the multi-statement-block guard
   * (`compileValueOperand`). */
  static compileOpValue(
    parent: Expression | undefined,
    opIndex: number,
    target: CompileTarget<Expression>,
    prec = 0,
    operand?: Expression
  ): TargetSource {
    const expr = operand ?? BaseCompiler.operandAt(parent, opIndex);
    return BaseCompiler.withCseOperand(parent, opIndex, target, () =>
      BaseCompiler.compileValueOperand(expr, target, prec)
    );
  }

  private static operandAt(
    parent: Expression | undefined,
    opIndex: number
  ): Expression | undefined {
    if (parent === undefined || !isFunction(parent) || opIndex < 0)
      return undefined;
    return parent.ops[opIndex];
  }

  /**
   * Compile the ROOT expression of a compilation as the harvest's root region
   * (§6.1), so top-level candidates bind around the whole emitted expression.
   * Falls back to a plain compile when CSE is inactive.
   */
  static compileCseRoot(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec = 0,
    /** What to emit inside the root region. Defaults to compiling `expr`; the
     * `Function`-literal route passes a callback that descends to the lambda
     * BODY region (the root region holds only the `Function` node itself). */
    fn?: () => TargetSource
  ): TargetSource {
    const emit = fn ?? (() => BaseCompiler.compile(expr, target, prec));
    const session = target.cse;
    if (
      session === undefined ||
      !session.enabled ||
      session.harvest === undefined
    )
      return emit();
    return BaseCompiler.withCseRegion(
      target,
      BaseCompiler.cseHarvestOf(target)!.root,
      emit
    );
  }

  /**
   * Emit, once and up front, the COLLECTION-valued subexpressions of `expr`
   * whose value is the same in every repetition of `expr` that `emit`
   * produces, then run `emit` with each of them replaced by a reference to
   * its binding.
   *
   * This is what an UNROLLED binder needs and ordinary CSE cannot give it: an
   * unrolled `Sum` compiles the same body nodes once per index value, and each
   * of those compilations pushes a fresh CSE region instance (deliberately —
   * a node-keyed reuse across instances would emit the first index's
   * temporary for every later index). Subexpressions that do not mention the
   * index are the exception: their value cannot differ between repetitions, so
   * one binding serves them all.
   *
   * `varyingNames` are the names whose binding differs from one repetition to
   * the next (the unrolled indices). A subexpression that mentions one of them
   * anywhere is not invariant.
   *
   * Only COLLECTION-valued subexpressions are hoisted. Those are the ones
   * whose duplication is expensive in both dimensions: a collection operand's
   * emission materializes the whole collection (a `Range` lowers to an
   * `Array.from` plus one `.map()` per element-wise step), so re-emitting it
   * multiplies the source size AND re-runs the construction at run time. A
   * scalar subexpression lowers to a few tokens that the target language's own
   * compiler folds better than this pass could, and hoisting it would churn
   * emission for no measurable gain.
   *
   * Hoisting changes how many TIMES a subexpression is evaluated, so a
   * candidate has to clear the same bar as a CSE candidate: `isPure` plus the
   * emission-purity gate (`isCseAdmissible`), and it must sit in an operand
   * position that is evaluated unconditionally — a hoist out of a `Which` arm
   * or a short-circuited operand would evaluate it even when the arm does not
   * run, so `lazyOperandRegions` positions are never entered. Neither is a
   * binder's own body: the names it binds do not exist at the point the
   * bindings are emitted.
   *
   * Returns the bindings — mutually independent, so any order works — together
   * with `emit`'s result. The caller emits them where its own construct
   * declares locals, and must emit them ALL: a binding whose name the emitted
   * code references but nothing declares is not valid source.
   */
  static hoistLoopInvariants<T>(
    expr: Expression,
    varyingNames: ReadonlyArray<string>,
    target: CompileTarget<Expression>,
    emit: () => T
  ): { bindings: Array<[name: string, code: string]>; result: T } {
    const nodes = BaseCompiler.loopInvariantCollections(
      expr,
      new Set(varyingNames),
      target
    );
    if (nodes.length === 0) return { bindings: [], result: emit() };

    const bindings: Array<[name: string, code: string]> = [];
    const installed: Expression[] = [];
    try {
      for (const node of nodes) {
        // Compiled under the ENCLOSING target, never a repetition's: the node
        // mentions none of the varying names, so the only thing a repetition's
        // target changes for it is the mapping of names it does not use.
        //
        // Compiling it OUT of its operand position can decline where the
        // position would not have — an emitter is free to fold or reshape an
        // operand instead of compiling it, so the operand's own lowering may
        // never be reached. That is not this pass's decline to raise: dropping
        // the candidate leaves the repetitions emitting it exactly as they did
        // before, and if their emission does reach the same lowering it raises
        // the decline itself.
        let code: TargetSource;
        try {
          code = BaseCompiler.compile(node, target);
        } catch {
          continue;
        }
        const name = BaseCompiler.tempVar(target);
        bindings.push([name, code]);
        BaseCompiler._codeOverrides.set(node, name);
        installed.push(node);
      }
      return { bindings, result: emit() };
    } finally {
      for (const node of installed) BaseCompiler._codeOverrides.delete(node);
    }
  }

  /**
   * The options an emission-purity check (`isCseAdmissible`,
   * `isCallerMapped`) must run under at this point of `target`'s compilation,
   * or `undefined` when no such check may be made at all.
   *
   * The gate needs the compilation's provenance predicates — which operator
   * names the caller re-mapped through `functions`/`operators`, which symbols
   * are backed by string-valued `vars`. They are recorded by the compilation
   * boundary that opens the CSE session, whether or not sharing is enabled
   * there; a target that never opened one has no way to tell a live-source
   * splice from an ordinary emission, so a caller that gets `undefined` must
   * fail closed rather than check against empty predicates.
   *
   * Every admission lookup inside the gate (a user-function callee, a named
   * callback) is engine-GLOBAL, so a name an enclosing binder or parameter has
   * rebound would be validated against the wrong definition. The names in
   * scope here are exactly the ones the emission tracks as bound, plus
   * `varying` — the names whose binding differs between the repetitions the
   * caller is about to emit.
   */
  private static cseAdmission(
    target: CompileTarget<Expression>,
    varying: ReadonlySet<string>
  ): CseHarvestOptions | undefined {
    const options = target.cse?.harvestOptions as CseHarvestOptions | undefined;
    if (options === undefined) return undefined;
    return {
      ...options,
      shadowedNames: new Set([
        ...(options.shadowedNames ?? []),
        ...(target.boundVars ?? []),
        ...varying,
      ]),
    };
  }

  /**
   * Whether the emission of every tree in `nodes` may be SKIPPED at run time
   * — under a guard that short-circuits it — without the skip being
   * observable other than through the value it saves computing.
   *
   * An emission is skippable when nothing in it is caller-supplied source
   * whose effects are unknown: a `functions`/`operators` entry, a symbol
   * backed by a string-valued `vars` entry, or an operator carrying a
   * caller-supplied `compile` handler splices code this compiler never sees,
   * which is free to count its own calls, log, or mutate shared state — so
   * running it fewer times is a change of behavior, not an optimization. That
   * is the same provenance question `isCseAdmissible` answers for collapsing
   * several emissions into one, and it is asked here in the same form,
   * including its transitive check of a user-defined callee's body.
   *
   * Stated as one rule: an emission may be skipped when nothing in it has
   * observable effects. Three oracles answer that, one per spelling — a
   * `functions` entry through `entryIsPure` (declared on the entry, or
   * inferred from its source: `function-purity.ts`), an operator carrying a
   * caller `compile` handler through the `pure`/`effects` declared on its
   * definition, and everything else through `node.isPure`. The three are
   * read PER NODE, with each oracle's answer standing in for the head it
   * vouches for (`Harvester.isEffectFreeUnderOracles` in `cse.ts`): a
   * signature-only declaration implemented through `functions` projects
   * unknown effects onto every application above it, so `node.isPure` alone
   * would refuse `sq(n·x) + 1` and `wrap(t) := sq(t) + 1` while admitting the
   * bare `sq(n·x)`. A spelling with no oracle — an `operators` entry, a
   * string-valued `vars` symbol — is refused, because nothing can vouch for
   * it.
   *
   * Purity buys SKIPPING and nothing else. A caller-supplied implementation
   * stays opaque to every pass that would rewrite what is inside it, however
   * pure it is, because the emitter receives its operands as text.
   *
   * `varyingNames` are the names bound differently across the repetitions
   * being emitted (an unrolled binder's indices); they must not resolve
   * globally inside the gate. Fails closed — returns `false` — when the
   * compilation recorded no provenance predicates to check against.
   */
  static isEmissionSkippable(
    nodes: ReadonlyArray<Expression>,
    varyingNames: ReadonlyArray<string>,
    target: CompileTarget<Expression>
  ): boolean {
    const base = BaseCompiler.cseAdmission(target, new Set(varyingNames));
    if (base === undefined) return false;
    // A caller-supplied implementation established to be pure is skippable
    // even though it stays opaque to CSE: the two questions differ. CSE asks
    // whether a pass may rewrite or bind subexpressions INSIDE the emission,
    // and the answer is no regardless of purity, because the emitter receives
    // its operands as text. Skipping asks only whether not running it at all
    // is observable, which purity answers. Setting the relaxation HERE, on a
    // copy of the stored options, rather than in the options the compilation
    // records, keeps CSE proper on exactly the behavior it had.
    const admission: CseHarvestOptions = { ...base, skippabilityQuery: true };
    return nodes.every((node) => isCseAdmissible(node, admission));
  }

  /**
   * The maximal subexpressions of `expr` that {@link hoistLoopInvariants} may
   * bind: collection-valued, mentioning none of `varying`, pure, and
   * admissible to emit once. Maximal because a hoisted node is never
   * descended into — binding both a node and a subexpression of it would emit
   * the inner one twice, once on its own and once inside the outer binding's
   * right-hand side.
   */
  private static loopInvariantCollections(
    expr: Expression,
    varying: ReadonlySet<string>,
    target: CompileTarget<Expression>
  ): Expression[] {
    // Hoisting replaces many emissions of a subexpression with one binding
    // referenced by name — the CSE transform, applied where CSE's own
    // node-keyed reuse cannot reach. `cse: false` turns that sharing off here
    // as it does everywhere else.
    if (target.cse?.enabled !== true) return [];

    const admission = BaseCompiler.cseAdmission(target, varying);
    if (admission === undefined) return [];

    const mentionsVarying = (node: Expression): boolean => {
      if (isSymbol(node)) return varying.has(node.symbol);
      if (!isFunction(node)) return false;
      return node.ops.some(mentionsVarying);
    };

    const out: Expression[] = [];
    const seen = new Set<Expression>();

    const visit = (node: Expression): void => {
      if (seen.has(node)) return;
      seen.add(node);

      // Two kinds of node the traversal must treat as OPAQUE — neither
      // bindable itself, nor descended into — because the emission does not
      // walk their subtree either, so nothing below them can ever reference a
      // binding this pass mints.
      //
      // A node that already carries a code override emits as that NAME: its
      // operands are not compiled at this site at all. The traversal reaches
      // one when the same tree is walked twice — a multi-index unrolled
      // binder walks its body once per clause level — and descending would
      // discover an operand of an already-hoisted node as a fresh candidate,
      // emitting a `const` binding that nothing ever references. (An override
      // is also what the D2/D6 runtime real-operand rule installs on a
      // maybe-complex operand; the `isComplexValued` clause below keeps this
      // pass from installing one over it and dropping its real guard.)
      //
      // A caller-mapped node — an operator re-mapped through
      // `functions`/`operators`, or one carrying a caller-supplied `compile`
      // handler — emits through source this compiler never sees, which may
      // evaluate an operand's text lazily, repeatedly, or not at all, and may
      // hand a mutable array to user code. Hoisting from under it changes
      // evaluation count and timing, and can share one JS array where each
      // repetition built a fresh one. This is the harvest's own `underMapped`
      // rule, which stops CSE candidates at the same boundary.
      if (BaseCompiler._codeOverrides.has(node)) return;
      if (isCallerMapped(node, admission)) return;

      if (
        node.type.matches('collection<any>') &&
        !mentionsVarying(node) &&
        node.isPure === true &&
        !BaseCompiler.isComplexValued(node) &&
        isCseAdmissible(node, admission)
      ) {
        out.push(node);
        return;
      }
      if (!isFunction(node)) return;
      // A binder's operands are written in terms of the names the binder
      // introduces, which are out of scope where the bindings are emitted.
      if (node.operator === 'Function' || node.operatorDefinition?.scoped)
        return;
      const lazy = lazyOperandRegions(node);
      for (let i = 0; i < node.ops.length; i++)
        if (!lazy.some((site) => site.index === i)) visit(node.ops[i]);
    };

    visit(expr);
    return out;
  }

  /**
   * Compile an emission-time tree that is NOT part of the root harvest — a
   * user-defined function's definition body (§5.4) — under its own nested
   * harvest scope: own regions and candidates, same session and naming
   * counter (so temps never collide across the artifact), and the same G1b
   * provenance predicates the boundary recorded.
   *
   * `shadowedNames` are the emitted definition's PARAMETER names. They are
   * bound by the definition, not by anything inside the body tree, so the
   * harvester's own binder prepass cannot see them — yet the harvest's
   * admission lookups are engine-global, so without them a parameter that
   * happens to share a global's name would be validated against that global.
   */
  private static withNestedCseHarvest(
    expr: Expression,
    target: CompileTarget<Expression>,
    shadowedNames: ReadonlyArray<string>,
    fn: () => TargetSource
  ): TargetSource {
    const session = target.cse;
    if (session === undefined || !session.enabled) return fn();
    const outer = session.harvest;
    // Definition bodies admit PURE user-function applications as candidates
    // (item 120): a repeated self-call in a recursive body —
    // `R(i-1,x,y) + 0.5·S(x,y,R(i-1,x,y))` — makes the compiled recursion
    // exponential (2^depth calls), and binding it once per level collapses
    // that to linear. Root harvests admit them too (see `openCseSession`), so
    // both routes now pass the flag; it is restated here because a nested
    // harvest may inherit options from a caller-built session.
    const nested = harvestCse(expr, {
      ...(session.harvestOptions ?? {}),
      admitPureUserFunctions: true,
      shadowedNames: new Set([
        ...(session.harvestOptions?.shadowedNames ?? []),
        ...shadowedNames,
      ]),
    });
    BaseCompiler.mergeUsedNames(target, nested.usedNames);
    session.harvest = nested;
    try {
      return BaseCompiler.withCseRegion(target, nested.root, fn);
    } finally {
      session.harvest = outer;
    }
  }

  /**
   * Compile `fn` under a BLIND instance — one that resolves no candidate — so
   * a construct the CSE wiring deliberately does not describe (`Match`, fully
   * inert in Phase 1) emits exactly the pre-CSE source, and no enclosing
   * region's candidate can leak into it through a shared node object.
   */
  static withCseBlind(
    target: CompileTarget<Expression>,
    fn: () => TargetSource
  ): TargetSource {
    if (BaseCompiler.cseTop(target) === undefined) return fn();
    return BaseCompiler.withCseRegion(target, undefined, fn);
  }

  /**
   * The `compile` callback handed to a `CompiledFunction` handler. A handler
   * lowering a construct with conditionally-evaluated operand positions passes
   * the operand index for those positions (`OperandCompiler`), and the
   * dispatcher — which is the only place that knows the parent node — turns it
   * into the matching region instance. Handlers that omit the index compile
   * exactly as before.
   */
  private static operandCompiler(
    parent: Expression | undefined,
    target: CompileTarget<Expression>
  ): OperandCompiler<Expression> {
    return (expr, opIndex) =>
      opIndex === undefined
        ? BaseCompiler.compileValueOperand(expr, target)
        : BaseCompiler.compileOpValue(parent, opIndex, target, 0, expr);
  }

  /**
   * The occurrence state machine (§6.1), interposed between `compile()` and
   * the emission proper.
   *
   * Three states per candidate, per region instance: unseen → compile the
   * right-hand side through (so it does not self-reference), then append the
   * binding and emit the name; `'defining'` → compile through (we are inside
   * the candidate's own right-hand side); `'bound'` → emit the name, an
   * identifier, atomic at any precedence.
   *
   * Appending AFTER the right-hand side compiles is what makes the binding
   * list dependency-ordered for free: a nested candidate's binding was
   * appended while the outer one's right-hand side was being compiled.
   */
  private static compileWithCse(
    expr: Expression,
    target: CompileTarget<Expression>,
    prec: number
  ): TargetSource {
    const session = target.cse;
    if (session === undefined || !session.enabled)
      return BaseCompiler._compileInner(expr, target, prec);

    const top = session.instances[session.instances.length - 1];
    if (top === undefined)
      return BaseCompiler._compileInner(expr, target, prec);

    // Emission has entered a binding scope this instance does not describe (a
    // binder body with no push/pop site of its own): compile the subtree under
    // a blind instance, so unknown territory degrades to the pre-CSE emission
    // instead of resolving a name whose value would be captured.
    if (top.boundVars !== target.boundVars)
      return BaseCompiler.withCseRegion(target, undefined, () =>
        BaseCompiler._compileInner(expr, target, prec)
      );

    const candidate = candidateAt(BaseCompiler.cseRegionOf(top), expr);
    if (candidate === undefined)
      return BaseCompiler._compileInner(expr, target, prec);

    const state = top.state.get(candidate);
    if (state === 'bound') return top.names.get(candidate)!;
    if (state === 'defining')
      return BaseCompiler._compileInner(expr, target, prec);

    top.state.set(candidate, 'defining');
    const rhs = BaseCompiler._compileInner(expr, target, 0);
    // A target whose multi-statement constructs are bare statement sequences
    // (Python, GPU) has no expression-position form for such a right-hand
    // side. Leave the candidate `'defining'`: every occurrence then compiles
    // inline, exactly as before — a lost optimization, never invalid source.
    // The right-hand side above was compiled at precedence 0; the CALLER's
    // precedence is what this position needs, so mirror the `'defining'`
    // branch and recompile when they differ.
    if (target.bareStatementBlocks === true && rhs.includes('\n'))
      return prec === 0 ? rhs : BaseCompiler._compileInner(expr, target, prec);

    const name = BaseCompiler.cseTempVar(target);
    top.state.set(candidate, 'bound');
    top.names.set(candidate, name);
    top.bindings.push([name, rhs]);
    return name;
  }

  /**
   * Inline or wrap expression in IIFE based on complexity
   */
  static inlineExpression(
    target: CompileTarget<Expression>,
    body: string,
    x: string
  ): string {
    // Check if `x` is a simple value (like a number or a simple symbol)
    const isSimple = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(x) || /^[0-9]+$/.test(x);

    if (isSimple) {
      // Inline the body if `x` is simple
      return new Function('x', `return \`${body}\`;`)(x);
    } else {
      // Generate an IIFE if `x` is a complex expression
      const t = BaseCompiler.tempVar(target);
      return new Function(
        'x',
        `return \`(() => { const ${t} = \${x}; return ${body.replace(
          /\\\${x}/g,
          t
        )}; })()\`;`
      )(x);
    }
  }
}
