import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
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
import { isRelationalOperator } from '../latex-syntax/utils.js';
import { normalizeIndexingSet } from '../library/utils.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { isTensorValue } from '../boxed-expression/tensor-view.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
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
import { rewriteAngularUnit } from './angular-unit.js';
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
  CompileTarget,
  CompilationResult,
  CompiledFunction,
  CompiledRunner,
  CseRegionInstance,
  NamingContext,
  OperandCompiler,
  TargetSource,
} from './types.js';
import { candidateAt, childRegionAt, harvestCse } from './cse.js';
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
 * Compile-time guard around `isPossiblyCollectionTyped`. A `broadcastable<T>`
 * operand is an explicit declared type, reliable on any node. A top-typed
 * APPLICATION (`unknown`/`any`/`value` call), however, is only a genuine
 * possibly-collection signal when the node is BOUND: an UNBOUND (non-canonical,
 * non-structural) arithmetic subexpression — e.g. the `{ canonical: false }`
 * grouping-preservation path (P0-45), where binding is skipped — types
 * `unknown` merely because it was never bound, not because its collection-ness
 * is unknown. Admitting those would misroute plain scalar arithmetic through
 * `_SYS.bcast` / the fail-closed guard, so require the application to be bound.
 */
/**
 * The type a compile-time **representation** question about `expr` is answered
 * from (nominal-types design §4.6 step 1): a `reference` type — a `type alias`
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
 * True when `a` is PROVABLY string-valued: a string literal, or an operand
 * whose (alias-resolved) static type is a subtype of `string`.
 *
 * Deliberately `isSubtype`, NOT `.matches('string')`: `matches` is the
 * "could be" direction, so an `unknown`-typed symbol would answer true and
 * gate a numeric plot equality such as `x^2 + y^2 = 4`, whose inferred
 * parameters must stay on the numeric fast path with byte-identical output.
 * Only positive string EVIDENCE gates. `never` is a subtype of every type and
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
 * True when a type admits values of EVERY basic sort — a string AND a number
 * AND a boolean AND an indexed collection — so "it could be a string" says no
 * more than the top type does. Such a type is the ABSENCE of information, not
 * evidence.
 *
 * `unknown` has never been string evidence (see `isProvablyStringOperand`), and
 * this extends the same reading to the top type spelled as a UNION. The shape
 * that forced it is not exotic: `At`'s index slot is
 * `boolean | indexed_collection | number | string` (a gather index may itself
 * be a collection or a dictionary key), so merely INDEXING with a local —
 * `cs[j]` — types `j` with that union, and the numeric operators never narrow
 * it back, because an operand that could be a collection is skipped by the
 * threadable-operator inference (`validate.ts`, Tycho item 121). A plain
 * `while j <= Length(cs)` next to such an index then declined as a "mixed
 * string ordering" although neither operand is remotely a string — a whole
 * class of ordinary scanner loops, on both targets.
 *
 * Deliberately requires all three disjoint scalar sorts AND a COLLECTION arm —
 * the four-armed inference artifact exactly, and nothing narrower. The genuinely
 * mixed unions keep failing closed: `number | string` (the shape a conditional
 * returning either produces) is still evidence and still declines, as are
 * `string | list<string>` and the DELIBERATE three-sort spelling
 * `string | number | boolean`, which a user writes to mean "any of these three"
 * — a real possibility of a string at run time, and a coercing `_.wq < 1` would
 * be a wrong answer where the interpreter stays inert.
 *
 * A hand-written `boolean | indexed_collection | number | string` is exempt too.
 * That is accepted: the artifact and the deliberate spelling are indistinguishable
 * by construction, and a type that admits every scalar sort AND every indexed
 * collection is the top type in all but name. It lands exactly where a bare
 * `unknown` participant already lands — the accepted residual documented on
 * `couldBeCollectionParticipant`.
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
 * True when ANY leaf type reachable from `t` is provably string: `t` itself,
 * the element type of a collection (recursively — `list<list<string>>` carries
 * evidence), or a member of a union (`list<string | number>` carries evidence
 * even though the widened element type is not wholly string).
 *
 * Only positive evidence counts, exactly as in `isProvablyStringOperand`:
 * `unknown`/`any` is not evidence (`collectionElementType` reports `any` for a
 * bare `list`, and it must not gate numeric plot shapes), and neither is
 * `never` — the element type of the empty literal `[]`.
 *
 * A `dictionary`/`record` is walked through its VALUE types only. Its
 * `collectionElementType` is the synthesized entry `tuple<string, V>`, whose
 * first cell is the ALWAYS-string KEY — not a value any comparison compares —
 * so going through it reported string evidence for every keyed type, including
 * `dictionary<integer>`. (Those shapes still decline, on the honest
 * aggregate gate — see `unfaithfulComparisonAggregate`.)
 *
 * The walk is UNBOUNDED in depth: returning `false` early is the ADMITTING
 * direction, so a depth cutoff was an admission hole — a nesting deeper than
 * the bound reopened exactly the wrong-boolean miscompile this predicate
 * exists to prevent. Termination is structural instead (every step peels a
 * finite type), plus a cycle guard for the one non-structural step: a
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
 * The aggregate KINDS whose whole-value comparison neither the `_SYS.eq`/
 * `_SYS.neq` tolerance kernel nor `_SYS.bcast` can reproduce faithfully —
 * returned by name for the diagnostic, or `null` when the participant is
 * comparable. See `assertComparableAggregate` (javascript-target.ts) for the
 * evidence.
 *
 * Keyed collections (`dictionary`, `record`) have no positional JS-array
 * lowering at all, and a heterogeneous fixed-arity `tuple` binds ATOMICALLY in
 * the interpreter while both kernels treat its JS array as a collection to map
 * over. A union member counts: the run-time value could BE it.
 *
 * The two kinds are searched to DIFFERENT depths, and the asymmetry is
 * load-bearing:
 *
 *  - a KEYED aggregate counts at any depth (`list<dictionary<integer>>` too).
 *    Those shapes were all declining before, because the string-evidence walk
 *    read their synthesized `tuple<string, V>` entry as string evidence; with
 *    that synthetic key no longer counted (`typeHasStringEvidence`), this is
 *    what keeps them closed — the same set of shapes, an honest reason.
 *  - a `tuple` counts only as the participant ITSELF (through unions). A tuple
 *    NESTED in an indexed collection is the settled point-list lowering
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
 * `x.type.matches('collection')` (and Python's `isPyCollectionOperand`) answer
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
    if (typeof r !== 'string' && r.kind === 'union')
      return r.types.some((m) => walk(m, visited));
    return isSubtype(r, 'collection');
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
        (op.isCollection || op.type.matches('indexed_collection'))
    );
  if (isFunction(expr, 'List'))
    return expr.ops.some(
      (op) =>
        !isFunction(op, 'List') &&
        !isTuple(op) &&
        (op.isCollection || op.type.matches('indexed_collection'))
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
    if (!expr.isValid) {
      throw new Error(
        `Cannot compile invalid expression: "${expr.toString()}"`
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
    if (BaseCompiler._compileDepth === 0) BaseCompiler._invalidateComplexMemo();
    BaseCompiler._compileDepth += 1;
    // Only a genuine CHANGE of the bound-variable context invalidates: the
    // inner targets of a recursion carry the SAME `boundVars` set object
    // except at a binder crossing, so the memo survives the common path.
    if (nextBoundCtx !== prevBoundCtx) {
      BaseCompiler._boundVarsCtx = nextBoundCtx;
      BaseCompiler._invalidateComplexMemo();
    }
    try {
      return BaseCompiler.compileWithCse(expr, target, prec);
    } finally {
      BaseCompiler._compileDepth -= 1;
      if (nextBoundCtx !== prevBoundCtx) {
        BaseCompiler._boundVarsCtx = prevBoundCtx;
        BaseCompiler._invalidateComplexMemo();
      }
    }
  }

  /** The innermost compile target's `boundVars`, synced by `compile()`. */
  private static _boundVarsCtx: ReadonlySet<string> | undefined;

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
    if (isSymbol(expr)) {
      const s = expr.symbol;
      if (BaseCompiler._boundVarsCtx?.has(s)) return true;
      for (let i = BaseCompiler._binderShield.length - 1; i >= 0; i--)
        if (BaseCompiler._binderShield[i].has(s)) return true;
      return false;
    }
    if (isFunction(expr))
      return expr.ops.some((op) => BaseCompiler.mentionsCompileBoundName(op));
    return false;
  }

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
      // answers — otherwise `t ↦ Sum(Map(xs, Sin))` is refused for a
      // "dangling" `Sin` the artifact does not contain. Only a record THIS
      // resolution introduced is removed.
      const hadVarsRef = target.varsObjectRefs?.has(s) === true;
      const resolved = target.var?.(s);
      // A bare symbol naming a user-defined function, used in value position (a
      // higher-order operand such as `Map(list, f)` / `Filter(list, f)`),
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
      if (registry && !isBoundOrMapped && !registry.misses?.has(s)) {
        const userFn = BaseCompiler.ensureUserFunctionEmitted(
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
      // A bare BUILT-IN operator symbol in value position (`Map(xs, Sin)`,
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
      if (resolved !== undefined) return resolved;
      // The target did not resolve the symbol (no `vars` mapping, constant, or
      // free-symbol plumbing). Before falling back to a bare reference — which
      // is a dangling identifier for a symbol the engine actually knows — fold
      // an assigned value / declared constant, matching `evaluate()`. This also
      // covers the direct-target `compile(expr, { target })` path, where the
      // raw target has no engine context of its own.
      const folded = BaseCompiler.tryFoldKnownSymbol(expr.engine, s, target);
      if (folded !== undefined) return folded;
      // Genuinely free symbol: emit its bare identifier. Give the target a
      // chance to mangle it or fail closed (D6) — e.g. a GLSL/WGSL reserved
      // keyword used as a variable name would emit invalid shader source.
      return target.mangleId ? target.mangleId(s) : s;
    }

    // Is it a number?
    if (isNumber(expr)) {
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

    // It must be a function expression...
    if (!isFunction(expr))
      throw new Error(`Cannot compile expression: "${expr.toString()}"`);
    // The node itself is passed along: the CSE region inventory is keyed by
    // the `(node, operandIndex)` EDGE (a tree may be a DAG, so a bare operand
    // object is ambiguous), and `compileExpr` receives only the operand list.
    const prevCseParent = BaseCompiler._cseParent;
    BaseCompiler._cseParent = expr;
    try {
      return BaseCompiler.compileExpr(
        expr.engine,
        expr.operator,
        expr.ops,
        prec,
        target,
        expr
      );
    } finally {
      BaseCompiler._cseParent = prevCseParent;
    }
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
    // (`CONTROL_FLOW_HEADS`: Sum/Product/If/Which/When/Match/Block/Function/
    // Loop/Comprehension/Sequence, …) are handled by their own bespoke lowering
    // and are NOT overridable. A handler that returns `undefined`/`null` OR an
    // empty string falls through to the default compilation (finding A5).
    // Set when a per-operator `compile` handler ran and DECLINED — the head is
    // known and lowerable in general, it just has no lowering for THIS operand
    // shape or target. Read by the fall-through diagnostic below so the decline
    // is not reported as `Unknown operator` (Tycho item 109a).
    let declinedByCustomHandler = false;
    if (!BaseCompiler.CONTROL_FLOW_HEADS.has(h)) {
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
            a.isCollection ||
            a.type.matches('list') ||
            a.type.matches('indexed_collection') ||
            isBoundPossiblyCollectionTyped(a)
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
            a.type.matches('list') ||
            a.type.matches('indexed_collection') ||
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
      const complexOperand = args.find((a) => BaseCompiler.isComplexValued(a));
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
      // Skip infix operators for complex operands — fall through to function dispatch
      const hasComplex = args.some((a) => BaseCompiler.isComplexValued(a));
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
          const relationalOverCollection =
            target.language === 'javascript' &&
            (isRelationalOperator(h) ||
              BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h)) &&
            args.some(
              (x) =>
                x.type.matches('collection') ||
                isBoundPossiblyCollectionTyped(x)
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
          const orderingOverString =
            target.language === 'javascript' &&
            isRelationalOperator(h) &&
            isMixedStringOrderingParticipants(args);
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
                  x.type.matches('collection') ||
                  isBoundPossiblyCollectionTyped(x)
              ) ||
              isMixedStringOrderingParticipants(args));
          // Compile as an operator (only for non-collection arguments)
          if (
            args.every((x) => !x.isCollection) &&
            !relationalOverCollection &&
            !orderingOverString &&
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
              // order. Probed: the interpreter draws EAGERLY even for an
              // operand the chain short-circuits past (`Less(5, 1, Random())`
              // consumes a draw), so binding an index-≥2 endpoint is exact
              // parity. A chain with no impure operand is untouched.
              const chainOp = target.chainOp ?? '&&';
              const bindings: Array<[name: string, value: string]> = [];
              const impureMiddle = args.some(
                (arg, i) =>
                  i >= 1 && i <= args.length - 2 && arg.isPure === false
              );
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
                  bindings.push([name, code]);
                  return name;
                }
                if (!target.bindExpr && impureMiddle && isImpure) {
                  if (!BaseCompiler.canHoist(target))
                    throw new Error(
                      `${h}: an impure (Random) operand cannot be bound to a ` +
                        'temporary at this position — a repeated draw would ' +
                        'shift every later value in the shader. Fail closed (D6).'
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
              const pairs: string[] = [];
              for (let i = 0; i < codes.length - 1; i++)
                pairs.push(`${codes[i]} ${op[0]} ${codes[i + 1]}`);
              const body = `(${pairs.join(`) ${chainOp} (`)})`;
              if (bindings.length > 0 && target.bindExpr)
                return target.bindExpr(bindings, body);
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
      const params = args
        .slice(1)
        .map((x) => functionLiteralParameterName(x) || '_');
      const lambdaTarget: CompileTarget<Expression> = {
        ...target,
        var: (id) => (params.includes(id) ? id : target.var(id)),
        boundVars: BaseCompiler.withBoundNames(target, params),
      };
      // The body is a bindable region of its own (§5.1(a)); pushed under the
      // lambda's target, so its temporaries land inside the arrow function.
      return `((${params.join(', ')}) => ${BaseCompiler.compileOp(
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
      // A protocol property assignment — `p.name = v`, P2's REBINDING sugar
      // (`p = «set name»(p, v)`). The engine may keep the canonical form as
      // `Assign(Field(p, "name"), v)` (the rebind decision re-resolves at
      // evaluation), which the generic lowering below would compile to the
      // silent no-op `_ = v`. Rebind through the compiled setter instead;
      // when the property IS protocol-declared but the setter cannot be
      // compiled (readonly, ambiguous, undecided receiver, …), fail closed
      // rather than emit the no-op.
      if (isFunction(args[0], 'Field') && isString(args[0].ops[1])) {
        const propertyName = args[0].ops[1].string;
        if (
          protocolDispatchCandidates(engine, `__set__${propertyName}`) !== null
        ) {
          const root = args[0].ops[0];
          if (isSymbol(root)) {
            // STATIC tier only, like the bare-`Field` GET: an undecided
            // receiver may be an ordinary record/dictionary at runtime,
            // whose keys beat protocol properties (P46) — a guard chain
            // over the conformance targets would throw on such a value
            // where the interpreter performs the ordinary field update.
            const setter = BaseCompiler.tryCompileProtocolDispatch(
              engine,
              {
                implKey: `__set__${propertyName}`,
                member: propertyName,
                args: [root, args[1]],
                staticOnly: true,
              },
              target
            );
            if (setter !== undefined) return `${root.symbol} = ${setter}`;
          }
          throw new Error(
            `${propertyName}: this protocol property assignment has no ` +
              `lowering on target '${target.language ?? 'javascript'}' ` +
              `(the setter could not be compiled${
                isSymbol(args[0].ops[0])
                  ? ''
                  : '; only a variable can be rebound'
              }). Fail closed (D6).`
          );
        }
      }
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
      // `docs/plans/2026-07-27-elementwise-which-design.md`): the target lowers
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
      return BaseCompiler.compileBlock(args, target, node);
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
      args.every((a) => !a.isCollection && !a.type.matches('collection'))
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
      if (
        target.language === 'javascript' &&
        BaseCompiler.isProvablyRealValued(args[0])
      ) {
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
          if (ascribed !== undefined && isNonRealNumber(ascribed))
            return `({ re: ${code}, im: 0 })`;
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
    // lowering (ruled 2026-08-12, `docs/plans/2026-08-12-protocol-compilation.md`).
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

      // `h` may be a symbol whose engine definition is a user-defined function
      // literal (`f(x) := …`, `x ↦ …`). Emit it as a named local function and
      // compile the call site as `_fn_f(arg)`. Returns undefined for a truly
      // unknown operator (no such definition) or a target that opts out.
      const userFn = BaseCompiler.tryCompileUserFunction(
        engine,
        h,
        args,
        target
      );
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
      args.some((a) => BaseCompiler.isComplexValued(a))
    ) {
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
   * is not broadcastable, no operand is list-valued, the head has no function
   * codegen, or any operand is complex-valued (the bare element parameters
   * below cannot carry the complex scalar codegen).
   */
  private static tryCompileBroadcast(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): string | null {
    const def = engine.lookupDefinition(h);
    if (!isOperatorDef(def) || def.operator.broadcastable !== true) return null;

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
        if (a.isCollection) return true;
        if (isSymbol(a))
          return a.type.matches('list') || a.type.matches('indexed_collection');
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
            (a.type.matches('collection') || isBoundPossiblyCollectionTyped(a))
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
    if (h === 'Multiply') {
      const isArrayish = (a: Expression): boolean =>
        isTensorValue(a) ||
        isNumericTuple(a) ||
        a.type.matches('list') ||
        a.type.matches('indexed_collection') ||
        isBoundPossiblyCollectionTyped(a);
      const collection = args.filter(isArrayish);
      if (collection.length >= 2) {
        // A possibly-collection operand (a declared `broadcastable<T>` OR a
        // top-typed application such as `h(x)`) could materialize as a scalar,
        // a vector, OR a MATRIX at run time — the shape is unprovable at compile
        // time. `_SYS.bcast` would Hadamard unconditionally, diverging from the
        // interpreter's matrix contraction; instead emit the interpreter-faithful
        // `_SYS.mul`, which dispatches on runtime rank (Hadamard for equal-length
        // rank-1 vectors, matrix product for rank-≥2), so no shape silently
        // diverges. Complex operands can't route through the real-only helper —
        // defer those to the fail-closed path.
        if (collection.some(isBoundPossiblyCollectionTyped)) {
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
        const isMatrix = (a: Expression): boolean =>
          (isTensorValue(a) && a.shape.length >= 2) || a.type.matches('matrix');
        if (collection.some((a) => isNumericTuple(a)) || args.some(isMatrix))
          return null;
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
      a.isCollection ||
      a.type.matches('list') ||
      a.type.matches('indexed_collection') ||
      isBoundPossiblyCollectionTyped(a);
    if (!args.some(isArrayOperand)) return null;

    // Complex-valued operands need complex scalar codegen, which the bare
    // element parameters below can't carry — defer (scalar / fail-closed path).
    // `hasComplexElement` (hoisted above) is the list-element complex test.
    if (
      args.some((a) => BaseCompiler.isComplexValued(a) || hasComplexElement(a))
    )
      return null;

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
    const scalarBody =
      typeof fn === 'function'
        ? fn(
            params.map((p) => engine.expr(p)),
            (expr) => BaseCompiler.compileValueOperand(expr, innerTarget),
            innerTarget
          )
        : `${fn}(${params.join(', ')})`;
    const compiledArgs = args
      .map((a) => BaseCompiler.compile(a, target))
      .join(', ');
    const body = BaseCompiler.guardConnectiveAbsence(h, params, scalarBody);
    return `_SYS.bcast((${params.join(', ')}) => ${body}, ${compiledArgs})`;
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
   * (`docs/plans/2026-08-08-lambda-param-element-inference.md`, ruling 2) an
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
    valueUsed = true
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
      return BaseCompiler.withCseScope(node, -1, target, () =>
        BaseCompiler.compileOp(args[0], -1, target, 0, args[0])
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
      complexFrame.set(local, false);
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

      const localTarget: CompileTarget<Expression> = {
        ...target,
        var: (id) => {
          if (locals.includes(id)) return id;
          return target.var(id);
        },
        boundVars: BaseCompiler.withBoundNames(target, locals),
        declaredVarTypes,
      };

      // The statement LIST is one INERT region — no binding is placed at the
      // statement-list level, so early-exit reachability and inter-statement
      // ordering never interact with CSE. Each statement's own value
      // expressions are separate, bindable child regions (§5.1(c)).
      const stmts = args.filter((a) => !isSymbol(a, 'Nothing'));
      const result = BaseCompiler.withCseScope(node, -1, localTarget, () =>
        stmts
          .flatMap((arg, i) => {
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
      const collection = isFunction(collExpr, 'Range')
        ? BaseCompiler.compileRangeIterable(collExpr, bodyTarget)
        : BaseCompiler.compile(collExpr, bodyTarget);
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
      const withDecls = BaseCompiler.withImplicitLocalDeclares(
        stmts,
        target,
        expr
      );
      const bodyTarget = BaseCompiler.loopBodyTempTarget(withDecls, target);
      const complexFrame = new Map<string, boolean>();
      for (const s of withDecls)
        if (isFunction(s, 'Declare') && isSymbol(s.ops[0]))
          complexFrame.set(s.ops[0].symbol, false);
      BaseCompiler._pushLocalComplex(complexFrame);
      try {
        for (const s of withDecls)
          BaseCompiler.noteLocalComplex(s, complexFrame);
        return BaseCompiler.withCseScope(expr, -1, bodyTarget, () =>
          withDecls
            .map((s) => BaseCompiler.compileLoopBody(s, bodyTarget))
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
      const value = BaseCompiler.declareValueOperand(arg.ops);
      if (value !== undefined && BaseCompiler.isComplexValued(value))
        BaseCompiler._setLocalComplex(frame, name, true);
    } else if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
      const name = arg.ops[0].symbol;
      if (frame.get(name) === false && BaseCompiler.isComplexValued(arg.ops[1]))
        BaseCompiler._setLocalComplex(frame, name, true);
    }
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
      // complex, so shield only — never force it real (Tycho item 60).
      const params = expr.ops
        .slice(1)
        .map((p) => (isSymbol(p) ? p.symbol : undefined))
        .filter((p): p is string => p !== undefined);
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
      if (!isSymbol(name)) continue;
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
    binder: { real: ReadonlyArray<string>; shielded: ReadonlyArray<string> },
    fn: () => T
  ): T {
    const frame = new Map<string, boolean>();
    for (const n of binder.real) frame.set(n, false);
    BaseCompiler._localComplex.push(frame);
    BaseCompiler._binderShield.push(new Set(binder.shielded));
    BaseCompiler._pushComplexMemoLayer();
    try {
      return fn();
    } finally {
      BaseCompiler._binderShield.pop();
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
    if (isNumber(expr)) return expr.im !== 0;

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
      if (BaseCompiler._boundVarsCtx?.has(expr.symbol)) return false;
      // Same rule for a name bound by a binder form we are analyzing rather
      // than compiling (Tycho item 65).
      for (let i = BaseCompiler._binderShield.length - 1; i >= 0; i--)
        if (BaseCompiler._binderShield[i].has(expr.symbol)) return false;
      const v = expr.engine._getSymbolValue(expr.symbol);
      if (v !== undefined) return BaseCompiler.isComplexValued(v);
      return false;
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
        return BaseCompiler._isComplexValuedFunction(expr);
      const stack = BaseCompiler._complexMemoStack;
      const hit = stack[stack.length - 1].get(expr);
      if (hit !== undefined) return hit;
      const result = BaseCompiler._isComplexValuedFunction(expr);
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
      )
        return expr.ops.some(
          (a) => a.isNegative === true || BaseCompiler.isComplexValued(a)
        );
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

    return expr.ops.some((arg) => BaseCompiler.isComplexValued(arg));
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
        frame.set(arg.ops[0].symbol, false);
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
            frame.set(name, false);
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
    // Coerce ONLY provably-real arms. A wide-typed arm (`number`, `unknown` —
    // e.g. a pass-through parameter `z` in `Which(n ≤ 0, z, True, K(n-1,z)²+c)`
    // whose declared slot is `number`) may hold a complex object at run time;
    // wrapping it would nest the object (`{ re: { re, im }, im: 0 }`). Such
    // arms are emitted bare, preserving the pass-through convention.
    return (val, code) =>
      val === undefined || BaseCompiler.isProvablyRealValued(val)
        ? `({ re: ${code}, im: 0 })`
        : code;
  }

  /**
   * True when the expression PROVABLY produces a plain real number at run
   * time on the JavaScript target — a real number literal or an expression
   * whose type is a subtype of `real`. Wide types (`number`, `unknown`) are
   * NOT provably real: they may carry a `{ re, im }` object at run time, so
   * convention coercion must leave them untouched.
   */
  private static isProvablyRealValued(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im === 0;
    return expr.type.matches('real');
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
   * `realOnly: true`, whose overload is typed to return a `number`. Declining
   * is what the callers want (they fall back to expansion / the interpreter).
   */
  static assertScalarBigOpBody(kind: string, body: Expression): void {
    if (body.type.matches('list') || body.type.matches('indexed_collection'))
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
   * The LYING-declaration clause (2026-08-12 ruling): the body's DECLARED type
   * PROVES a scalar (`isScalarDeclaredType` — an `integer`/`real`/`number` or
   * `boolean` head, the spellings that sail through every gate above), yet the
   * item-86 body look-through PROVES the named function's `Function` literal
   * constructs a collection. Declaration and body contradict each other, and
   * the compiler can see it.
   *
   * Declarations stay authoritative everywhere else in the compiler — this is
   * not a re-inference. It fires only where the contradiction is PROVEN, and
   * the only sound response is to refuse to emit code we know is wrong (D6):
   * JS emitted `_fn_a(0) + _fn_a(1) + _fn_a(2)`, which string-concatenates the
   * arrays at run time ("1,00.5403…,0.8414…-0.4161…,0.9092…") behind
   * `success: true`, and GLSL/WGSL emitted a `vec2` sum returned from a `float`
   * function — shader source that does not even compile.
   *
   * Unlike `isCollectionValuedBigOpBodyByLookThrough` (which only fires where
   * an item-121 EXEMPTION is doing the admitting, and which JS never reaches
   * because its wider element-wise gate diverts those bodies first), this
   * clause fires on ALL targets INCLUDING JavaScript: a `number`-declared body
   * is not possibly-collection-typed, so `isElementwiseBigOpBody` declines it
   * and there is no element-wise arm to fall into. That JS change is the
   * ruling: garbage becomes a decline.
   *
   * The ruled exemptions are untouched — `isScalarDeclaredType` is disjoint
   * from every one of them (`broadcastable<T>`, `unknown`/`any` and the union
   * spelling of the top type all answer `false`), so the `-> unknown` shape
   * (item 171) still compiles element-wise on JS and still declines on the
   * non-JS targets through the clause above, on its own message. The `boolean`
   * arm does not touch the item-121 boolean exemption either: that exemption
   * protects the ABSENCE of evidence (a genuine boolean body — a comparison —
   * produces none), while this clause additionally requires the look-through to
   * PROVE a collection constructor.
   */
  static isContradictedScalarDeclaration(body: Expression): boolean {
    if (!BaseCompiler.isScalarDeclaredType(body)) return false;
    return BaseCompiler.isProvablyCollectionValuedApplication(body, new Set());
  }

  /**
   * The declared-type half of the 2026-08-12 contradicted-declaration ruling:
   * a declaration that PROMISES a scalar, i.e. a value the emitters read as one
   * machine word — a number or a boolean.
   *
   * `boolean` was originally omitted, which let a head declared
   * `(number) -> boolean` over a list-constructing body escape every gate.
   * Measured before this, with `b` declared `(number) -> boolean` and assigned
   * `t ↦ [cos t, sin t]`, all behind `success: true`:
   *
   * | shape             | javascript            | glsl / wgsl                  |
   * | ----------------- | --------------------- | ---------------------------- |
   * | `If(b(u), 1, 2)`  | the WRONG branch (`1`)| `bool _fn_b` returning `vec2`|
   * | `Not(b(u))`       | a wrong `false`       | same                         |
   * | `b(u) = True`     | a wrong `false`       | same                         |
   * | `And(b(u), True)` | the ARRAY, unguarded  | same                         |
   *
   * — the JS ternary treats the run-time array as truthy and takes a branch the
   * interpreter never takes (it throws: a condition must be `True`/`False`).
   */
  private static isScalarDeclaredType(body: Expression): boolean {
    const t = body.type;
    return t.matches('number') || t.matches('boolean');
  }

  /**
   * The DEFINITION-SITE half of the same 2026-08-12 ruling (wave 3): the
   * identical contradiction read off the function's own body rather than off a
   * call site.
   *
   * Waves 1–2 gate CONSUMING positions, so a contradicted application declines
   * wherever a scalar is read. What they cannot reach is the DEFINITION itself:
   * a bare `a(u)` as the whole compiled expression has no consuming head, so on
   * a target whose user functions are statically typed declarations the
   * definition was still emitted — and its return type is synthesized from the
   * body's DECLARED type while its `return` statement emits what the body
   * actually builds. Measured before this gate, with `a` declared
   * `(number) -> number` and assigned `t ↦ [cos t, sin t]`:
   *
   *     glsl:  float _fn_a(float t) { return vec2(cos(t), sin(t)); }
   *     wgsl:  fn _fn_a(t: f32) -> f32 { return vec2f(cos(t), sin(t)); }
   *
   * — a `vec2` returned from a function declared scalar, i.e. shader source no
   * driver accepts, shipped behind `success: true`.
   *
   * Same two halves as `isContradictedScalarDeclaration`, same shared body
   * look-through and the same `isScalarDeclaredType` test; only the entry point
   * differs. The body carries the declared result type as an ASCRIPTION
   * (`Block(Typed(List(…), 'number'))`), so `isScalarDeclaredType` reads the
   * DECLARATION here exactly as it reads the application's result type there —
   * including its `boolean` arm, which is what refuses
   * `bool _fn_b(float t) { return vec2(cos(t), sin(t)); }` and, with it, every
   * GPU consuming shape whose own lowering has no condition guard (the
   * `Which` element-wise entry).
   */
  static isContradictedScalarFunctionBody(body: Expression): boolean {
    if (!BaseCompiler.isScalarDeclaredType(body)) return false;
    return BaseCompiler.isProvablyCollectionValuedBody(body, new Set());
  }

  /**
   * The ADJACENCY half of the same 2026-08-12 ruling: the contradicted-scalar
   * application in an ordinary SCALAR-CONSUMING position, not just as a big-op
   * body. With `a` declared `(number) -> number` and assigned
   * `t ↦ [cos t, sin t]`, every such position emitted garbage behind
   * `success: true` — measured before this gate:
   *
   * | shape             | javascript                    | glsl / wgsl        |
   * | ----------------- | ----------------------------- | ------------------ |
   * | `a(u) + 1`        | ran to the STRING `"…,…1"`    | `vec2` from `float`|
   * | `2·a(u)`          | ran to `NaN`                  | `vec2` from `float`|
   * | `sin(a(u))`       | ran to `NaN`                  | `vec2` from `float`|
   * | `a(u)^2`          | ran to `NaN`                  | `vec2` from `float`|
   * | `a(u) < 1`        | ran to a wrong scalar `false` | `vec2` from `float`|
   * | `a(u) = 1`        | ran to a wrong scalar `false` | `vec2` from `float`|
   * | `If(a(u)<1, 1, 2)`| took the WRONG branch         | `vec2` from `float`|
   *
   * (Python and interval-js already declined every one of them, for their own
   * unrelated reasons — no user-function lowering / no `List` lowering.)
   *
   * ONE policy point rather than one gate per target: the contradiction is a
   * property of the APPLICATION, not of any target, and `compileExpr` is the
   * dispatcher every target funnels its operator lowering through — the same
   * place the GPU non-scalar comparison gate and the JS/Python list-arithmetic
   * gates already live.
   *
   * The position test is the union of the head classifications those gates
   * already use — scalar arithmetic, a `broadcastable` operator definition, a
   * relational, a logical connective. Every one of them consumes its operands
   * as scalars whenever no lift is planned, and no lift is planned here: the
   * declared type says `number`. Container and access heads (`List`, `Tuple`,
   * `Block`, `At`, a user function) are NOT in it and keep compiling — probed,
   * `[a(u), 1]` is correct today, and `At`/`Length` already decline on the
   * declared type.
   *
   * What deliberately does NOT decline:
   *  - the application as the WHOLE compiled expression (`a(u)`): no head
   *    consumes it, the JS result coercion handles the array, and it runs
   *    correctly today;
   *  - the honest `(unknown) -> unknown` spelling of the same body — its type
   *    is not `matches('number')`, so it keeps the `_SYS.bcast` route (item
   *    171);
   *  - a TRUTHFUL `-> number` head over a scalar body, and a truthful
   *    `-> list<number>` head, neither of which is a contradiction.
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
   * The body look-through behind the third `assertScalarBigOpBody` clause
   * (Tycho item 171 residue): POSITIVE evidence that a big-op body whose
   * DECLARED type says nothing is nonetheless collection-valued.
   *
   * The first clause above already declines a body whose declared type matches
   * `list`/`indexed_collection`. Consumers, however, register helpers under the
   * open `(unknown) -> unknown` head (the spelling that keeps list-broadcasting
   * working), so `a(t) = [cos t, sin t]` applied inside a Sum types
   * `broadcastable<unknown>` and slips past that clause via the two documented
   * EXEMPTIONS (top types and `broadcastable<T>` stay admitted — item-121
   * closure). Those exemptions protect the ABSENCE of evidence; they were never
   * meant to protect a body we can PROVE builds a collection.
   *
   * So this fires only where an exemption is doing the admitting — the body's
   * type carries no sort evidence at all (`unknown`/`any`/… and the union
   * spelling of the top type) or is `broadcastable<T>` — and only on positive
   * evidence: the operator names a USER function (`userFunctionLiteral`) whose
   * `Function`-literal body has a type that MATCHES a collection (the subtype
   * direction, so a wide body type is not evidence). A nested user-function
   * application recurses, `visited` declining self/mutual recursion.
   *
   * The JavaScript target never consults this: its own wider gate
   * (`isElementwiseBigOpBody` → `isPossiblyCollectionTypedJS`, which routes the
   * same shape through the value-safe `_SYS.bcast` element-wise fold) diverts
   * every body this predicate accepts before `assertScalarBigOpBody` is reached,
   * so JS emission is unchanged. The GPU/Python/interval targets have no
   * element-wise arm — correct emission is not on the table there — so for them
   * the only sound answer is to decline (D6). Left admitted, GLSL emitted a
   * `vec2 + vec2 + vec2` sum from a function declared to return `float`.
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
   * look-through. A conservative WHITELIST whose only permitted failure mode is
   * declining to see the evidence (the caller then keeps compiling), never a
   * false positive: admission here DECLINES a compile that used to succeed.
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
   * Wave 4 of the 2026-08-12 contradicted-declaration ruling: the same
   * look-through for a MULTI-CLAUSE function (function-polymorphism design
   * §8), which `userFunctionLiteral` cannot see — it has no single
   * `_lambdaLiteral`, one literal per clause instead. Measured before this
   * arm, with `a` DECLARED `(number) -> number` and two clauses whose bodies
   * both build `[cos t, sin t]`, the JavaScript target emitted the guard chain
   * and ran the scalar consuming positions over the returned array behind
   * `success: true`:
   *
   * | shape       | before                                    |
   * | ----------- | ----------------------------------------- |
   * | `a(u) + 1`  | the STRING `"-0.98999…,0.141121"`         |
   * | `2·a(u)`    | `NaN`                                     |
   * | `sin(a(u))` | `NaN`                                     |
   *
   * — the identical failure wave 2 gates for a single-literal function, which
   * simply never fired here because the literal lookup came back empty.
   *
   * Feeding the clause set into the SHARED body predicate (rather than adding
   * a gate of its own) makes every wave inherit the fix at once: the big-op
   * body clause (wave 1), the scalar-consuming positions (wave 2) and the
   * `-> unknown` look-through all read this one predicate.
   *
   * ANY clause is enough — the conservative, fail-closed direction. A MIXED
   * clause set (one scalar clause, one collection-constructing clause) is a
   * contradiction on SOME branches only, but the consuming position compiles
   * ONCE, statically, for all of them: measured, mixed `a(u) + 1` ran to `8`
   * on the scalar branch and to the string `"0.29552…,0.955336…"` on the other.
   * There is no per-branch code to keep, so the branch that is wrong decides.
   *
   * Only JavaScript (and interval-js) ever reach this: `tryEmitMultiClauseFunction`
   * declines every other target outright (§8), so a multi-clause application on
   * GLSL/WGSL already fails closed with its own "no lowering" diagnostic.
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
   * The BODY half of `isProvablyCollectionValuedApplication`: does this
   * function-literal body provably construct a collection?
   *
   * Split out so the same evidence can be read from either end — from a CALL
   * SITE (the application, waves 1–2) or from the body itself at DEFINITION
   * EMISSION (`isContradictedScalarFunctionBody`, wave 3), which is handed the
   * body directly and has no application in hand.
   *
   * Canonical parse wraps a lambda body in `Block`, whose VALUE is its LAST
   * statement — so that is the statement to judge, single- or multi-statement.
   * Measured before this, with `a` DECLARED `(number) -> number` and assigned
   * `t ↦ { w := cos t; [w, sin t] }`, the single-statement-only unwrap saw no
   * evidence and every wave passed the call through behind `success: true`:
   * JS `a(u) + 1` ran to the STRING `",0.29552…"`, `Σ a(i)` to
   * `",0,0.84147…,0.90929…"`, and GLSL emitted
   * `float _fn_a(float t) { w = cos(t); return vec2(w, sin(t)); }`.
   *
   * A `Return` anywhere in an EARLIER statement disqualifies the block: control
   * may never reach the last statement, so it is not provably the value and
   * this predicate — positive-evidence-only, whose admission DECLINES a compile
   * — must answer `false`.
   *
   * A DECLARED result type additionally ASCRIBES the body: the
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
    if (fnBody.type.matches('collection')) return true;
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
    if (cond.type.matches('collection'))
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
  // docs/plans/2026-07-12-cortex-match-design.md §5).
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
    // The generated code bakes this symbol's current value: record it in the
    // capture set (see `CompileTarget.symbolDeps`). Nested symbols inside the
    // value are recorded by the recursive compile below.
    target.symbolDeps?.add(id);
    return BaseCompiler.compile(value, target, BaseCompiler.FOLD_OPERAND_PREC);
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
   */
  private static userFunctionName(id: string): string {
    return `_fn_${id.replace(/[^\w$]/g, '_')}`;
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
    // Every argument PROVABLY not a collection (`number`/`boolean`/`string`-
    // typed — a plain numeric call such as `f(2)`) can never broadcast at run
    // time. Note the direction: this decides only where the answer is certain,
    // so a type merely WIDER than the runtime value is treated as possibly a
    // collection.
    const provablyScalarArg = (a: Expression): boolean =>
      a.type.matches('number') ||
      a.type.matches('boolean') ||
      a.type.matches('string');

    // Fail closed (D6) BEFORE emission: whether the callee can be emitted at
    // all is irrelevant to whether an emitted call would be sound, and the
    // caller's generic "no lowering" message hides the real reason.
    BaseCompiler.checkDeclaredBroadcast(engine, h, args, provablyScalarArg);

    const name = BaseCompiler.ensureUserFunctionEmitted(engine, h, target);
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
    const coerceToComplex = args.map((a, i) => {
      if (
        target.language !== 'javascript' ||
        !BaseCompiler.isProvablyRealValued(a)
      )
        return false;
      const pt = BaseCompiler.userFunctionParamType(engine, h, i);
      if (pt !== undefined) return isNonRealNumber(pt);
      // A multi-clause function has an INTERSECTION signature, from which
      // `userFunctionParamType` reads no single parameter type — ask the
      // clause set instead.
      return BaseCompiler.multiClauseParamIsComplex(engine, h, i);
    });
    const compiledArgs = args.map((a) =>
      BaseCompiler.compileValueOperand(a, target)
    );
    const complexWrap = (code: string): string => `({ re: ${code}, im: 0 })`;

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
      BaseCompiler.userFunctionParamsAreScalar(engine, h)
    ) {
      // A complex-typed parameter is coerced INSIDE the closure, on the
      // element the broadcast selected: wrapping the whole argument would
      // both hand the callee `{ re: [1,2,3], im: 0 }` and (before) force the
      // entire call onto the direct scalar path, so a sibling collection
      // argument never broadcast.
      const params = args.map(() => BaseCompiler.tempVar(target));
      const callParams = params.map((p, i) =>
        coerceToComplex[i] ? complexWrap(p) : p
      );
      return `_SYS.bcastFn((${params.join(', ')}) => ${name}(${callParams.join(
        ', '
      )}), ${compiledArgs.join(', ')})`;
    }

    return `${name}(${compiledArgs
      .map((code, i) => (coerceToComplex[i] ? complexWrap(code) : code))
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
  private static checkDeclaredBroadcast(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    provablyScalarArg: (a: Expression) => boolean
  ): void {
    if (args.length === 0) return;
    const plan = BaseCompiler.userFunctionBroadcastPlan(engine, h);
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
          BaseCompiler.userFunctionHasBroadcastableParam(engine, h) &&
          !args.every(provablyScalarArg);
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
   * as a higher-order operand, e.g. `Map(list, h)`) reference the *same* shared
   * local rather than inlining or emitting a dangling identifier.
   *
   * Returns `undefined` when `h` is not a user function or the target opts out
   * of user functions (no registry — GPU / raw direct targets, where recursion
   * therefore stays fail-closed). A re-entrant name (in `registry.compiling`)
   * is a recursive reference and compiles to a call by name.
   */
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
        const body = BaseCompiler.withEnforcedParams(literal, () =>
          BaseCompiler.withNestedCseHarvest(bodyExpr, bodyTarget, params, () =>
            BaseCompiler.compile(bodyExpr, bodyTarget)
          )
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
   * higher-order operand (`Map(xs, Sin)`, `CountIf(xs, IsPrime)`) is a real
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
    const params = literal.ops
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    const bodyExpr = rewriteAngularUnit(literal.ops[0].canonical);
    const root = registry.root ?? target;
    const bodyTarget: CompileTarget<Expression> = {
      ...root,
      var: (id) => (params.includes(id) ? id : root.var(id)),
      boundVars: BaseCompiler.withBoundNames(root, params),
      // The parameters' DECLARED types, for the lowerings that read a raw
      // (never-bound) symbol — the protocol-property SET rebinding, whose
      // `Assign` LHS root types `unknown` in the canonical body. Fresh per
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
          `_$a[${i}]`
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

      const branches = order.map((i) => {
        const { arity, guards } = plans[i];
        const tests = [
          `_$a.length === ${arity}`,
          ...guards.filter((g): g is string => g !== null),
        ];
        const args = Array.from({ length: arity }, (_, k) => `_$a[${k}]`);
        return `if (${tests.join(' && ')}) return ${helperNames[i]}(${args.join(', ')});`;
      });
      registry.defs.set(
        name,
        `const ${name} = (..._$a) => { ${branches.join(' ')} throw new Error(${JSON.stringify(`no-matching-clause: ${h}`)}); };`
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
   * booleans compiled code traffics in; the value type `nan` admits exactly
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
          // The value type `nan` admits exactly NaN (amended D1, "match
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
   * Recognize a PROTOCOL call head (`docs/plans/2026-08-12-protocol-compilation.md`):
   *
   * - a bare dispatcher (`compare(x, y)` where `compare` resolves to the
   *   installed `_protocolDispatcher` operator — a user shadow of the name
   *   drops the marker and wins, matching the interpreter);
   * - the `ProtocolMember` operator (`(protocol, member, receiver, …args)`);
   * - the `ProtocolProperty` operator — 3 operands GET, 4 operands SET;
   * - a bare `Field` read that the ordinary field routes already declined
   *   (this runs in the `!fn` branch, AFTER `Field`'s own `compile` handler
   *   declined). The bare-`Field` form is STATIC-tier only: an undecided
   *   receiver may be an ordinary record/dictionary at runtime, whose keys
   *   beat protocol properties (P46) — a guard chain cannot arbitrate that.
   */
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
      if (args.length === 4)
        return {
          implKey: `__set__${member}`,
          member,
          protocol,
          args: args.slice(2),
        };
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
   * Compile a protocol call (`docs/plans/2026-08-12-protocol-compilation.md`;
   * the governing ruling is Appendix A "Static resolution and compiled
   * code"): a statically resolved call becomes a DIRECT call of the winning
   * implementation; a dynamic one becomes a guard chain over the reified
   * receiver representation, most-specific-first, throwing
   * `protocol-implementation-missing` on fall-through (the multi-clause
   * convention — the interpreter's error VALUE has no compiled analog).
   *
   * `undefined` declines: the caller falls through to the standard
   * fail-closed diagnostic. JavaScript only; the emitted code SNAPSHOTS the
   * protocol registry (like the multi-clause chain snapshots its clause set).
   *
   * Divergences from the interpreter, both recorded in the design doc:
   * non-receiver arguments are NOT guarded (the interpreter's
   * `argumentTypeError` would answer an `incompatible-type` error value; the
   * compiled body trusts the static check that ran at canonicalization —
   * the P28 trusted-ascription posture), and guard fidelity is over the JS
   * machine-value model (the same trust compiled `match` constructor
   * patterns and multi-clause guards already extend).
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
    // JS-only (§8): the interval target's runtime values are intervals and
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
      for (const c of plan.candidates) {
        const g = BaseCompiler.renderReceiverGuard(c.guard!, '_$p0');
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
    const coerceToComplex = call.args.map((a, i) => {
      if (!BaseCompiler.isProvablyRealValued(a)) return false;
      return sigParams.every((params) => {
        const pt = params?.[i];
        return pt !== undefined && isNonRealNumber(pt);
      });
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
      return coerceToComplex[i] ? `({ re: ${code}, im: 0 })` : code;
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
        `const ${dName} = (${params.join(', ')}) => { ${branches.join(' ')} ` +
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
      const params = literal.ops
        .slice(1)
        .map((p) => functionLiteralParameterName(p))
        .filter((name) => name !== '');
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
        // (a higher-order operand like `Map(list, f)`), is lowered to the
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
        // No mapping, no value, not a constant: a genuinely free symbol.
        //
        // KNOWN GAP (see ROADMAP "Known defects"): the boolean literals
        // `True`/`False` reach here and are reported free, even though the
        // target inlines them to `true`/`false`. Do NOT fix this by testing
        // `target.var(s) !== undefined` — `var` is the general variable
        // emitter, not a constants lookup (the javascript target's main-path
        // copy falls back to `_.${id}` for free symbols), so that check
        // suppresses EVERY free symbol. A fix needs a constants-only lookup
        // distinct from `var`, consulted after the `varsKeys` guard above.
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
      // Property SET: `Assign(Field(root, "name"), v)` where some protocol
      // declares the property. STATIC tier only (P46), like the compile
      // path; a non-static site fails closed there, so `Field` stays listed.
      if (
        h === 'Assign' &&
        isFunction(ops[0], 'Field') &&
        isString(ops[0].ops[1]) &&
        protocolDispatchCandidates(engine, `__set__${ops[0].ops[1].string}`) !==
          null
      ) {
        const name = ops[0].ops[1].string;
        const root = ops[0].ops[0];
        const plan =
          jsProtocolTarget() && isSymbol(root)
            ? planProtocolDispatch(engine, {
                implKey: `__set__${name}`,
                argc: 2,
                receiverType: probeReceiverType(root),
              })
            : undefined;
        if (plan !== undefined && plan.tier === 'static')
          visitProtocolPlan(`:__set__${name}`, plan, bound);
        else unsupported.add('Field');
        visit(root, bound);
        if (ops[1] !== undefined) visit(ops[1], bound);
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
      // overridable and are excluded, matching the consult in `compileExpr`).
      let hasCustomCompile = false;
      if (
        !BaseCompiler.CONTROL_FLOW_HEADS.has(h) &&
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
        const params = ops
          .slice(1)
          .map((p) => functionLiteralParameterName(p))
          .filter((name) => name !== '');
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
   * Attach `freeSymbols` / `unsupported` (from `analyzeReferences`) to a
   * compilation result, returning the same object. Used by the built-in
   * targets to make every result carry its declarative reference analysis.
   */
  static withReferences<
    R extends { freeSymbols?: string[]; unsupported?: string[] },
  >(
    result: R,
    expr: Expression,
    target: CompileTarget<Expression>,
    varsKeys?: ReadonlySet<string>
  ): R {
    return Object.assign(
      result,
      BaseCompiler.analyzeReferences(expr, target, varsKeys)
    );
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
   * not be compiled without re-throwing; `compileTarget` (when available) drives
   * the declarative `freeSymbols`/`unsupported` reference analysis. This method
   * never throws for a compile reason — the reference analysis is guarded.
   */
  static buildInterpreterFallback<T extends string>(
    expr: Expression,
    error: string,
    targetName: T,
    compileTarget: CompileTarget<Expression> | undefined,
    varsKeys: Set<string> | undefined
  ): CompilationResult<T> {
    const ce = expr.engine;

    // Materialize an interpreted result matching the compiled-runner numeric
    // contract: a scalar yields its real part as a float, a finite indexed
    // collection becomes a nested JS array of element values. A scalar leaf is
    // numericized first — `evaluate()` correctly stays symbolic for an exact
    // argument (`ln(2)` evaluates to `Ln(2)`), and `.re` of a symbolic
    // expression is NaN, so without `.N()` every decline whose expression has
    // no non-symbolic evaluation would run to NaN instead of its value.
    const interpretedRunValue = (e: Expression): number | unknown[] => {
      if (e.isCollection) return [...e.each()].map(interpretedRunValue);
      return e.N().re;
    };

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
      const lambdaRun = ((...args: number[]) =>
        interpretedRunValue(
          ce
            .function('Apply', [expr, ...args.map((a) => ce.expr(a))])
            .evaluate()
        )) as unknown as CompiledRunner;
      return {
        target: targetName,
        success: false,
        code: '',
        calling: 'lambda',
        run: lambdaRun,
        error,
        ...refs,
      } as CompilationResult<T>;
    }

    // Otherwise the expression uses the `expression` calling convention:
    // `run({ x, y, ... })` with a variables object.
    const fallbackRun = ((vars: Record<string, number>) => {
      ce.pushScope();
      try {
        if (vars && typeof vars === 'object') {
          for (const [k, v] of Object.entries(vars)) {
            // Declare a fresh local shadow before assigning so `popScope` fully
            // restores the previous state (a bare `assign` would mutate an
            // outer/global binding and leak the argument value engine-wide).
            ce.declare(k, 'number');
            ce.assign(k, v);
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
      isStringVar?: (name: string) => boolean;
      isVarsKey?: (name: string) => boolean;
    } = {}
  ): void {
    if (options.enabled === false || typeof target.cseBind !== 'function') {
      target.cse = { enabled: false, instances: [] };
      return;
    }
    const harvestOptions: CseHarvestOptions = {
      isOverriddenOperator: options.isOverriddenOperator,
      isStringVar: options.isStringVar,
      isVarsKey: options.isVarsKey,
      // PURE user-function applications are admitted at the root too (item 120
      // follow-up): a repeated `f(x+1)` at the root is the same redundant call
      // as one inside a definition body. Admission validates the resolved
      // callee's BODY transitively (`isAdmissibleUserFnCallee`), and G1
      // (`node.isPure`) independently keeps a drawing/writing call inert.
      admitPureUserFunctions: true,
    };
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
