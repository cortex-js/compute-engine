import { isForwardCallReference } from './forward-call-reference.js';
import {
  callableBindingInContext,
  markCallableHome,
  hasCallableHome,
  withCallableBinding,
} from './binders.js';
import { isScratchBinding } from '../scratch-scopes.js';
import {
  detachEagerSourceValues,
  keptEagerSourceValue,
  readSharingEagerSourceValues,
  releaseEagerSourceValues,
  releaseKeptEagerSourceValues,
  takeDetachedEagerSourceValue,
  takeEagerSourceValue,
  type EagerSourceValues,
} from './eager-source-values.js';
import {
  asyncEvaluationOf,
  beginAsyncEvaluation,
  beginTopLevelEvaluation,
  copyContextStack,
  topLevelEvaluationEpoch,
} from './evaluation-epoch.js';
import {
  awaitAsyncOnlyDescendants,
  hasAsyncOnlyApplication,
} from './async-only-descendants.js';
import {
  ambientChainParent,
  registerScopeActivation,
  scopeActivationTemplate,
} from './ambient-chain.js';
import type { PrecisionWindow } from '../types-kernel-evaluation.js';
import { callResultType } from './call-result-type.js';
import {
  expandAliasesForLift,
  isMappedActual,
  isPolymorphicType,
} from '../../common/type/instantiate.js';
import { isWildcard } from './pattern-utils.js';
import { isErrorTypedOperand } from './error-typed-operand.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type {
  SimplifyOptions,
  ExplainOperation,
  ExplainOptions,
  Explanation,
  ReplaceOptions,
  PatternMatchOptions,
  Expression,
  BoxedBaseDefinition,
  BoxedOperatorDefinition,
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Metadata,
  Rule,
  Sign,
  Substitution,
  BoxedDefinition,
  Scope,
  BoxedValueDefinition,
  ExpressionInput,
  FunctionInterface,
  OperandDescriptor,
} from '../global-types.js';
import type { EffectHandlers } from '../types-effects.js';
import { runWithEvaluationEffects } from '../effects-registry.js';

import {
  describe as describeOperand,
  describeType,
  type DescriptorMemo,
  guardedTypeHandlerCall,
} from './operand-descriptor.js';
import { constantFieldLiteral } from './constant-field.js';
import {
  deriveApplicationType,
  installBroadcastLiftHooks,
  isNumericTupleArgumentType,
  isNumericTupleType,
  mayBeNumericTupleType,
  parameterReachesBody,
  runsLibraryCanonicalForm,
  typeHandlerContext,
  withCodomainForAbsentAnswer,
} from './derive-application-type.js';
import {
  ABSENT_CELLS_STAY_MISSING,
  absentCellsPresentType,
  absorbOperandAbsence,
  movesAbsentCells,
  passesAbsentCellsThrough,
  withPresentCellAbsence,
  threadedPresentType,
  withThreadedAbsence,
  abstractCollectionCell,
  broadcastLiftType,
  isAbstractCollectionTypeOf,
  isKindOpenOperandType,
  skipBroadcastForVectorOpsOnViews,
  type BroadcastOperandView,
  broadcastableOf,
  topTypeOfTriggers,
} from './broadcast-lift-type.js';
import { listedBroadcastCells } from './listed-element.js';
import {
  literalMayEraseElement,
  literalWithErasureResolved,
  literalWithErasureResolvedAsync,
} from './nothing-erasure.js';
import {
  MAX_SIZE_EAGER_COLLECTION,
  broadcastLengthMismatch,
  hasUnresolvedCollectionOperand,
  isUnresolvedCollectionOperand,
  isTupleShapedType,
  isBroadcastableCollection,
  isBroadcastCollectionType,
  isDrawFreeBroadcast,
  isFiniteIndexedCollection,
  isFiniteBroadcastParticipant,
  isPointListArgumentType,
  isPointParameterType,
  isFixedShapeCollection,
  isKnownFinitenessBroadcast,
  isTextAtom,
  loneUnionBroadcastResultType,
  scalarOrListUnionCellType,
  isNumericTuple,
  couldBeUnkeyedCollectionOperand,
  isPossiblyCollectionTyped,
  isTuple,
  isTupleBroadcastParticipant,
  isUnknownLengthBroadcast,
  typeCouldBeCollection,
  typeCouldBeUnkeyedCollection,
  lazyBroadcastMapIfNeeded,
  lazyMapNumericApproximation,
  zip,
  zipBroadcast,
  zipParticipates,
  isUnindexedCollectionOperand,
  isCardinalityOperand,
  appliesToListCoordinateTuple,
  addsPointToNumberCollection,
  isAbsentScalarTerm,
  collectionSourceOperands,
  viewOverListedSource,
  shapedBroadcastResultType,
} from '../collection-utils.js';
import {
  failedWalkErrorSince,
  incompleteWalkCount,
  takeBackIncompleteWalks,
  unlessWalkMissedElements,
} from './incomplete-walks.js';
import { normalizeCount, smallCount } from './collection-count.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import {
  validElementMemo,
  elementMemoRecordingStream,
  elementMemoAt,
  elementMemoParanoid,
  enterParanoidCheck,
  exitParanoidCheck,
  snapshotMemoDeps,
  memoDepsStillValid,
} from './collection-element-memo.js';
import type { MemoDeps } from './collection-element-memo.js';
import {
  isExpression,
  isNumber,
  isFunction,
  isDictionary,
  isString,
  isCharacter,
  isSymbol,
  isContinuationOperand,
  isFoldBarrierProduct,
  nanOperandAnswer,
  indeterminateFormAnswer,
  isUnorderedSet,
} from './type-guards.js';
import { isTransitivelyPure } from './transitive-purity.js';
import { realExponentValue } from './imaginary-part.js';
import { scopeForRebuild } from './binding-sites.js';
import {
  arityBounds,
  armHasValueParam,
  instantiateArms,
  type OverloadResolution,
  overloadArms,
  resolveOverload,
  triStateSelect,
} from './overload.js';
import { candidateShape } from './tensor-view.js';
import {
  actualOfOperand,
  instantiatedResultType,
  instantiatedResultTypeOverActuals,
  substituteDeclaredBounds,
  type ArmInferenceContext,
  type SolveActual,
} from './generic-instantiation.js';
import type {
  EffectLabel,
  FunctionSignature,
} from '../../common/type/types.js';
import { Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';
import { boundTypeSize } from '../../common/type/size-cap.js';
import { internType, isInternedType } from '../../common/type/intern.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  couldMatch,
  isSubtype,
  provablyAdmits,
  resolveTypeReference,
} from '../../common/type/subtype.js';
import {
  COLLECTION_SHAPE_TYPE,
  EXTENDED_REAL_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import { numericStoreTiers } from './literal-tier.js';
import {
  boxStoreElement,
  integerExactnessClass,
  machineNumberOf,
  isExactNonInteger,
} from './machine-number.js';
import {
  broadcastResultType,
  nestedBroadcastResultType,
  functionResult,
  staticMembership,
  isSignatureType,
  isWildcardFunctionType,
  narrow,
  numericMissingSlot,
  codomainMarkerType,
  stripMissingFromType,
  collectionElementType,
  resolveTypeAlias,
  unfoldAliasOnDescent,
  descendIntoConstructor,
  type AliasDescent,
  typeContainsMissing,
  typeHasNanFreeNumericCell,
  widen,
  widenElementTypes,
  widenCellsWithMarker,
  widenNumericCellsWithNan,
  widenWithNan,
  signatureSlotType,
  signatureArms,
  staticCollectionDims,
} from '../../common/type/utils.js';
import { NumericValue } from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import type { BigDecimal } from '../../big-decimal/index.js';

import { findUnivariateRoots } from './solve.js';
import {
  emptyRootsAnswer,
  filterRootsByAssumptions,
  partialRootListReason,
  withoutPeriodicDuplicates,
} from './solve-domain.js';
import { solveSystem, solveOr } from './solve-system.js';
import { solveCongruence } from './solve-congruence.js';
import { replace } from './rules.js';
import { negate } from './negate.js';
import { simplifyValueBlind } from './simplify.js';
import { explainExpression } from './explain.js';
import { canonicalMultiply, mul, div, Product } from './arithmetic-mul-div.js';
import { add } from './arithmetic-add.js';
import { pow } from './arithmetic-power.js';
import {
  asSmallInteger,
  isNearRoundingJumpValue,
  nearJumpTolerance,
} from './numerics.js';
import { gcd } from '../numerics/numeric.js';
import { activeRollbackFrame } from '../inference-rollback.js';
import {
  _BoxedExpression,
  DISPLAY_MATERIALIZATION,
  hasSymbolOrOperator,
} from './abstract-boxed-expression.js';
import { DEFAULT_COMPLEXITY, sortOperands } from './order.js';
import {
  containsResidueClass,
  noteResidueClass,
  residueArithmetic,
} from './residue-class.js';
import {
  digest128,
  hashCode,
  hasVolatileDigest,
  markVolatileDigest,
  isOperatorDef,
  isValueDef,
  normalizedUnknownsForSolve,
  withOwnHead,
} from './utils.js';
import {
  broadcastContextMessage,
  defersErrorAbsorption,
  errorOpsWithoutTrace,
  errorValue,
  failedCellsAreIterable,
  isCollectionHead,
  isErrorFramedByNode,
  isInvalidNonCollection,
  isIterableWithFailedCells,
  potentialErrorValue,
  withBroadcastFrame,
  withErrorFrames,
} from './error-value.js';
import type { ErrorFrame } from './error-value.js';
import { match } from './match.js';
import { factor } from './factor.js';
import { holdMap, holdMapAsync } from './hold.js';
import {
  positiveSign,
  nonNegativeSign,
  negativeSign,
  nonPositiveSign,
  sgn,
} from './sgn.js';
import { cachedCell, cachedValue, CachedValue } from './cache.js';
import { CACHE_STATS, recordCache } from '../../common/cache-stats.js';
import {
  beginObjectDeps,
  endObjectDeps,
  mergeObjectDeps,
  objectDepsValid,
  objectReadCount,
  type ObjectDeps,
} from './object-deps.js';
import { containsObject } from './object-walk.js';
import { cycleDetectionCount } from './cycle-guard.js';
import {
  apply,
  callableApplication,
  exactArgumentSources,
  lookupApplicable,
} from '../function-utils.js';
import { isInferredTypedParameter } from './inferred-annotations.js';
import {
  absentScalarMarker,
  hasAbsentScalarOperand,
  isAbsentScalarSymbol,
  listCoordinateTupleOperandError,
  markAbsentPointCells,
  nonNumericOperandError,
  runtimeCheckExemptParam,
  runtimeConformanceError,
  isAbsentableCollectionOperand,
  settledAbsentableValue,
  collectionSourceSlot,
  isCollectionSourceOperator,
} from './validate.js';
import {
  functionLiteralSignatureType,
  inferFunctionLiteralEffects,
  namedLiteralSignatureType,
} from './effects-inference.js';
import {
  functionLiteralParameterNames,
  functionLiteralParameterType,
  isScalarType,
} from './function-literal.js';
import { signatureParamsAreScalar } from './callback-broadcast-admission.js';
import { applicationEffects, publicEffects } from './effects-of.js';
import type { ComputedEffects } from '../../common/type/effects.js';
import {
  isPureComputedEffects,
  isPureEffectSet,
} from '../../common/type/effects.js';
import { numericCanonicalHandlerName } from './numeric-canonical-registry.js';
import { noteConstantAssignmentSite } from '../constant-assignment-error.js';
import { readBeforeDeclarationError } from './read-before-declaration.js';
import {
  CancellationError,
  checkDeadline,
  checkDeadlineEvery,
  iterationLimitCancellationCount,
} from '../../common/interruptible.js';
import {
  applyPoleOverride,
  isEligibleRealRewrite,
  onBranchCut,
} from '../function-properties/index.js';

/** One memoized collection-facet answer (see `BoxedFunction._facetMemo`). The
 * value is wrapped so that a facet legitimately answering `undefined` is
 * distinguishable from one not yet computed. `objectDeps` is recorded PER
 * FACET rather than shared with the slot's symbol-dependency snapshot: the
 * three facets are computed independently, and a `count` that read a mutable
 * object's field must not drag an `isEmpty` that read nothing into being
 * invalidated with it. */
type FacetEntry<T> = { value: T; objectDeps?: ObjectDeps };

/** Count of provisional (re-entrant) `_effectsOf` reads — see the cycle note
 * on `_effectsOf`. A computation that consumed one must not be frozen into
 * the memo. Monotonic; only ever compared before/after a computation. */
let _effectsProvisionalReads = 0;

/** The same protocol for the lazy-collection evaluate memo — see
 * `_memoizedLazyCollectionValue()`. A re-entrant evaluate of a node whose
 * memo is in flight (a self-referential binding, `xs := Append(xs, 1)`)
 * bumps this, and neither the re-entrant computation nor the one it is
 * nested in is frozen into the memo. */
let _lazyValueProvisionalReads = 0;

/** Count of settled `_effectsOf` recomputations, engine-wide. A test
 * observable (the house instance-instrumentation pattern): a cache HIT
 * leaves it unchanged, a miss advances it — how the effects-invalidation
 * suite asserts hit/miss without wall-clock or prototype patching.
 * Monotonic; only ever compared before/after an operation. @internal */
let _effectsComputeCount = 0;

/**
 * The signature of a partial application: `sig` applied to the arguments
 * `ops`, when they are fewer than its fixed parameters and the literal
 * would be curried by `makeLambda` (function-utils.ts) — a plain signature
 * with no optional parameter, no variadic tail and no type parameter.
 * `undefined` when the call is saturated or is not curried, and when an
 * argument is a `Spread` (`g(...args)`), whose element count is unknown
 * until it is evaluated.
 */
function curriedSignature(
  sig: Type,
  ops: ReadonlyArray<Expression>
): Type | undefined {
  if (typeof sig === 'string' || sig.kind !== 'signature') return undefined;
  if (ops.some((x) => x.operator === 'Spread')) return undefined;
  const argCount = ops.length;
  if (
    sig.variadicArg !== undefined ||
    (sig.optArgs !== undefined && sig.optArgs.length > 0) ||
    (sig.typeParams !== undefined && sig.typeParams.length > 0)
  )
    return undefined;
  const args = sig.args ?? [];
  if (argCount >= args.length) return undefined;
  return { ...sig, args: args.slice(argCount) };
}

/** Read {@link _effectsComputeCount} — for tests. @internal */
export function effectsComputeCount(): number {
  return _effectsComputeCount;
}

/** Count of settled collection-facet recomputations (`count`/`isEmpty`/
 * `isFinite` — see `_memoizedFacet`), engine-wide. A test observable (the
 * house instance-instrumentation pattern): a memo HIT leaves it unchanged, a
 * recompute advances it — how the facet-probe regression suite asserts a
 * probe budget without wall-clock or prototype patching. Monotonic; only
 * ever compared before/after an operation. @internal */
let _facetComputeCount = 0;

/** Read {@link _facetComputeCount} — for tests. @internal */
export function facetComputeCount(): number {
  return _facetComputeCount;
}

/** Count of `_computeStructural()` rebuilds, engine-wide. A test observable
 * (the house instance-instrumentation pattern): a memo hit — persistent or
 * transient — leaves it unchanged, a rebuild advances it. Monotonic; only
 * ever compared before/after an operation. @internal */
let _structuralComputeCount = 0;

/** Read {@link _structuralComputeCount} — for tests. @internal */
export function structuralComputeCount(): number {
  return _structuralComputeCount;
}

/**
 * Is a top-level `structural` read in progress on the current call stack? Set
 * by the outermost `get structural()` and cleared before that read returns —
 * it is what makes an inner read recognize that it is nested, and it is the
 * only writer of {@link _transientStructural}'s lifetime.
 */
let _inStructuralRead = false;

/**
 * Answers for the nodes whose structural form the CURRENT top-level read had
 * to rebuild because the persistent memo refused to keep it, or `undefined`
 * when no such node has been met (the overwhelmingly common case, which
 * allocates nothing).
 *
 * The persistent per-node memo (`_structural`, committed through
 * `cachedValue`) cannot serve a node whose structural form transitively holds
 * a mutable object: the commit rule in `cache.ts` refuses such a payload,
 * because a cache entry holding an object reference would keep that object
 * alive for as long as the entry lives (ruling B12) and could hand back
 * contents that the entry's version stamps never validated (rulings B22/B3).
 * Every such node therefore rebuilds on every read — and because the rebuild
 * recurses into each operand's `structural`, a tree whose operands are SHARED
 * rebuilds once per PATH, which is exponential in its depth.
 *
 * This map removes that cost while keeping both rulings intact: it lives for
 * the duration of one top-level `structural` read and is dropped before that
 * read returns, on the throwing path as well, so it retains no object past
 * the call that built it (ruling B12); and it validates nothing, because a
 * field store cannot run inside one synchronous rebuild, so there is nothing
 * for it to go stale against (rulings B22/B3).
 *
 * A module-level slot rather than a parameter threaded through the recursion:
 * the recursion re-enters through each operand's public `get structural()`
 * (`_computeStructural` calls `x.structural`), which takes no arguments.
 */
let _transientStructural: Map<Expression, Expression> | undefined = undefined;

/** `CE_EFFECTS_PARANOID`: the effects-cache canary of the state-event
 * design's §6 (step 3) — on every served hit, `_effectsOf` recomputes the
 * projection and THROWS on divergence (a hard failure, per the A5
 * amendment precedent: a validation aid for smoke + soak runs, not a
 * semantic mode). Env-gated like `CE_CACHE_STATS`. */
const EFFECTS_PARANOID: boolean = (() => {
  if (typeof process === 'undefined') return false;
  const flag = process.env?.CE_EFFECTS_PARANOID;
  return flag !== undefined && flag !== '0';
})();

/** Re-entrancy latch for the canary: the cross-check's own projection walk
 * reads children's `_effectsOf`, and a canary-within-a-canary recurses
 * exponentially (the element-memo canary's latch pattern). */
let _effectsParanoidActive = false;

/** `CE_CACHE_STATS` only: is a recomputed effect channel the same answer as
 * the entry it replaced? Structural equality over the `ComputedEffects`
 * shapes (`'any'` | label array | co-finite `{not}` | `undefined`). */
function sameComputedEffects(a: ComputedEffects, b: ComputedEffects): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === 'any' || b === 'any') return false;
  const aLabels = Array.isArray(a) ? a : a.not;
  const bLabels = Array.isArray(b) ? b : b.not;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (aLabels.length !== bLabels.length) return false;
  return aLabels.every((x) => bLabels.includes(x));
}

/**
 * A boxed function expression represent an expression composed of an operator
 * (the name of the function) and a list of arguments. For example:
 * `["Add", 1, 2]` is a function expression with the operator "Add" and two
 * arguments 1 and 2.
 *
 * If canonical, it has a definition associated with it, based on the operator.
 *
 * The definition contains its signature and its evaluation handler.
 *
 */

/**
 * The type of a store-backed `List`: `list<T^N>`, where `T` widens the
 * literal tiers present in the store (`numericStoreTiers`) — the same tiers
 * `numberLiteralTierType` gives the boxed elements.
 */
function numericStoreType(store: readonly number[]): Type {
  return internType({
    kind: 'list',
    elements: widenElementTypes(numericStoreTiers(store)),
    dimensions: [store.length],
  });
}

/**
 * True when `def` opts in with the `'surplus-operands'` broadcast exemption
 * and `ops` holds more operands than its signature admits: a surplus past a
 * fixed arity.
 *
 * Validation marks such an operand an `unexpected-argument` error when the
 * call is boxed, so a VALID call reaches the broadcast arms with a surplus
 * only when the operator's own `canonical` handler built it with `_fn`,
 * which does no arity check: the `Numerator` family keeps every operand for
 * a user definition that reads the extra ones as options (issue #442). The
 * operator broadcast must not fan such a call over a surplus collection
 * operand, cell by cell: the handler refuses the whole call with one error,
 * as the declared arity does for every other operator, and a surplus list is
 * not a source of cells (`Denominator(5, [])` is an error, not `[]`).
 *
 * The rule is opt-in because some operators are n-ary at run time beyond
 * their declared signature: a chained `Equal(L, 3, 3)` is declared
 * `(any, any)`, and its handler re-enters the broadcast for an operand that
 * became a collection at evaluation (`broadcastComparison`), so a blanket
 * rule would loop there.
 */
function hasSurplusOperands(
  def: {
    readonly signature: { readonly type: Type };
    readonly broadcastExemptions: ReadonlyArray<string>;
  },
  ops: ReadonlyArray<Expression>
): boolean {
  if (!def.broadcastExemptions.includes('surplus-operands')) return false;
  const sig = def.signature.type;
  if (typeof sig === 'string' || sig.kind !== 'signature') return false;
  return ops.length > arityBounds(sig).max;
}

/**
 * For an `Error` value that the evaluation of a function expression returned,
 * the expression whose evaluation returned it most recently.
 *
 * The handler of a selecting operator (`If`, `Which`, `And`, `Coalesce`, …)
 * returns the error of the operand it evaluated as a bare value, and the
 * breadcrumb frame of the operator is added afterwards
 * (`_deferredErrorFrame()`). When the error was made by the evaluation of
 * the operand, and not when the operand was boxed — the body of a user
 * function called in a branch, `If(c, g("a"), 0)` — no operand holds it, and
 * this record is what names the operand. A nested evaluation records the
 * error first and the evaluation that encloses it records it again after it,
 * so the record is the outermost evaluation that returned it, which is the
 * operand that the handler evaluated. The map holds its keys weakly, so a
 * record goes away with its error.
 *
 * A record lives as long as its error, so it can be from an EARLIER
 * evaluation: the error that `g("a")` returned, assigned to `y`, is the value
 * of the branch `y` of `If(c, g("a"), y)`, and its record names the operand
 * `g("a")`, which the handler did not evaluate. Each record has a `stamp`,
 * the value of `errorRecordCount` after it was made. The selecting operator
 * reads `errorRecordCount` when its evaluation begins, and uses a record only
 * when its stamp is larger: a record that was made during that evaluation.
 */
const errorEvaluatedFrom = new WeakMap<
  Expression,
  { node: Expression; stamp: number }
>();

/** The number of records made in `errorEvaluatedFrom`. It only increases. */
let errorRecordCount = 0;

/** Record that the evaluation of `node` returned `result`, when `result` is
 * an `Error` value that is not `node` itself (see `errorEvaluatedFrom`). */
function recordEvaluatedError(node: Expression, result: Expression): void {
  if (result !== node && result.operator === 'Error')
    errorEvaluatedFrom.set(result, { node, stamp: ++errorRecordCount });
}

export class BoxedFunction
  extends _BoxedExpression
  implements FunctionInterface
{
  override readonly _kind = 'function';

  // The operator of the function expression
  private readonly _operator: string;

  // The operands of the function expression. Read through the `_ops`
  // getter below: a `List` built by `ce.list()` starts with NO boxed
  // operands and a numeric store instead, and boxes them on the first read.
  private _opsStorage: ReadonlyArray<Expression> | undefined;

  /**
   * The numeric store of a `List` built by `ce.list()`: the list's elements
   * as plain JS numbers, frozen, with `-0` normalized to `+0`. It is the
   * ORIGIN of the operands, not a cache derived from them: the operand at
   * position `i` is exactly `engine.number(store[i])` (a float for an
   * integer value when `_numericStoreFloats`), boxed on the first
   * read of `.ops`. The facets that need only the numbers (`nops`, `count`,
   * `at`, `type`, `hash`, `isSame`, `unknowns`, effects, ...) answer from
   * the store and never box. `undefined` for every other node. Design:
   * `docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.
   */
  readonly _numericStore: readonly number[] | undefined;

  /**
   * Are the elements of the numeric store that have an integer value
   * floats? `true` for a list that a float computation produced (`2·L` with
   * the element `0.5` holds the float `1`), `false` for a list of exact
   * integers and doubles (`ce.list()`). An element with a fraction part is a
   * float in both cases. See `boxStoreElement()`. `false` when there is no
   * store.
   */
  readonly _numericStoreFloats: boolean;

  /** The `array` facet of an ordinary `List` (one without a store), computed
   * once: the elements as machine numbers, or `null` when some element is
   * not a machine number. See `get array()`. */
  private _derivedArray: readonly number[] | null | undefined;

  /** Computed with `_derivedArray`: does the array reproduce the list,
   * exactness included? `false` when some element is an exact non-integer
   * a double holds (`1/2`), which `array` admits. See `get isMachineNumeric()`. */
  private _derivedArrayIsMachine: boolean | undefined;

  /** Computed with `_derivedArray`: the exactness class of the elements
   * with an integer value (`integerExactnessClass()`), or `null` when the
   * list is not a list of machine numbers or mixes exact integers with
   * integer-valued floats. See `get _machineFloats()`. */
  private _derivedArrayFloats: boolean | null | undefined;

  /** Is this node written-out DATA, which evaluates to itself? Computed
   * once: `0` no, `1` under `evaluate()`, `2` under a numeric approximation
   * too. See `_isLiteralData()`. */
  private _literalData: 0 | 1 | 2 | undefined;

  /** The boxed operands. A store-backed list boxes them here, once, on the
   * first read; every other node has them from construction. */
  private get _ops(): ReadonlyArray<Expression> {
    if (this._opsStorage !== undefined) return this._opsStorage;
    const store = this._numericStore!;
    const ops = new Array<Expression>(store.length);
    const floats = this._numericStoreFloats;
    for (let i = 0; i < store.length; i++)
      ops[i] = boxStoreElement(this.engine, store[i], floats);
    this._opsStorage = ops;
    return ops;
  }

  // Only canonical expressions have an associated def (are bound)
  // If `null`, the expression is not bound, if `undefined`, the expression
  // is bound but no definition was found.
  private _def: BoxedDefinition | undefined | null;

  /** If the operator is scoped, the local scope associated with
   * the function expression
   */
  private _localScope: Scope | undefined;

  private _isStructural: boolean;

  private _hash: number | undefined;
  private _digest: string | undefined;

  /** The overload resolution this call was VALIDATED against, attached by
   * the construction site (`box.ts`) when the operator's signature is an
   * overload set (phase 2c of
   * `docs/TYPE-SYSTEM.md`). Result typing
   * (`resolvedArm`) reads it so `.type` reports the arm full validation
   * actually selected — the trial-admission set and the cheap prefilter's
   * can differ on overlapping-arm calls. `undefined` on expressions that
   * never went through overload validation (non-strict mode, non-canonical
   * construction); those fall back to a prefilter-only resolution, whose
   * wider candidate set result typing tolerates. Deliberately NOT
   * generation-guarded: validity was decided at construction time, and the
   * resolution records that decision, not a recomputable view.
   * @internal */
  _resolvedOverload: OverloadResolution | undefined = undefined;

  /** The operands of this call before validation replaced one of them with
   * an `incompatible-type` error. The construction site (`box.ts`) sets it
   * only when the callee is a function that a later assignment can replace:
   * a user function (`h := (u: real) ↦ 7`) or a name declared `function`
   * that holds a function literal. The error states what the callee was
   * when the call was boxed, so the evaluation and the type of the call
   * box these operands again against the function the name holds now
   * (`_recheckedCall()`).
   * @internal */
  _refusedOps: ReadonlyArray<Expression> | undefined = undefined;

  /** The call boxed again from `_refusedOps` against the function its name
   * holds now, when the answer is not this call: a later assignment
   * replaced the callee, and the new callee accepts the operand that the
   * old one refused, or refuses it with a different error. `undefined`
   * otherwise.
   * @internal */
  _recheckedCall(): Expression | undefined {
    const ops = this._refusedOps;
    if (ops === undefined) return undefined;
    const call = withCallableBinding(this, () =>
      this.engine.function(this._operator, this._writtenOperands(ops))
    );
    return call.isSame(this) ? undefined : call;
  }

  /** The definition that the name of this call held when the call was
   * boxed, and the change counter of that definition then (`_writeVersion`
   * of the value or operator definition). The construction site (`box.ts`)
   * sets it on a call of a user function, and on a call through a variable
   * whose function a later assignment can replace with one that checks the
   * operands differently.
   *
   * The call was checked, and its named arguments were put in declaration
   * order, against that definition. When the name holds another definition,
   * or the same one changed, the call is boxed again against the definition
   * as it is now, and its type and its value are those of the new call
   * (`_reboxedForCallee()`). When the definition did not change, the cost is
   * one comparison of the definition and one of the counter.
   *
   * `written` is set for a named call through a variable with an inferred
   * type, and for a named call of a user function: the name of each written
   * argument, in written order, and the index of the operand that holds its
   * value (-1 for an argument written with the value `Nothing`). The call is
   * boxed again with these names, so that they are matched against the
   * function that the name holds now.
   *
   * `ops` is set when the operands of the call are not the operands as
   * boxed before the check: the check against the old definition can
   * replace an operand (a one-cluster string becomes a `character` at a
   * `character` parameter, matrix inference repairs an operand). The call is
   * boxed again from `ops`, so that the new definition checks the operands
   * as written, not the operands that the old definition replaced.
   *
   * `receiver` is set for a named call `Apply(Field(r, "S"), …)` whose
   * names were matched against the INFERRED type of the receiver `r`: it is
   * the value definition of `r`, recorded in place of the definition of the
   * name of the call (`Apply`). An assignment to `r` can give the field
   * other parameter names, and the call is then boxed again with its names.
   *
   * `rechecked` keeps the last new call, with the definition and the counter
   * it was boxed against, so that the call is boxed again only once for
   * each change.
   * @internal */
  _calleeStamp:
    | {
        half: { _writeVersion: number };
        version: number;
        written:
          ReadonlyArray<{ name: string | undefined; slot: number }> | undefined;
        ops?: ReadonlyArray<Expression>;
        receiver?: { _writeVersion: number };
        rechecked?: {
          half: { _writeVersion: number };
          version: number;
          call: Expression;
        };
      }
    | undefined = undefined;

  /** Record the definition that the name of this call holds now
   * (`_calleeStamp`). A call that has a record keeps it. `ops` are the
   * operands, in declaration order, as boxed before the check against that
   * definition.
   *
   * A self-call in a clause body that is made canonical under the recursion
   * knot of its function (`IComputeEngine._recursionKnots`) is not
   * recorded. It is bound to the placeholder of the knot, which the install
   * of the clause replaces, so the record would always be out of date, and
   * the type of such a call already follows the installed clause (see
   * `type()`). Boxing it again when its type is read changes the effects
   * derived for the function.
   *
   * `receiver` is the definition to record in place of the definition of
   * the name of the call (see `_calleeStamp`).
   * @internal */
  _stampCallee(
    written?: ReadonlyArray<{ name: string | undefined; slot: number }>,
    ops?: ReadonlyArray<Expression>,
    receiver?: { _writeVersion: number }
  ): void {
    if (this._calleeStamp !== undefined) return;
    if (this.engine._recursionKnots.has(this._operator)) return;
    const half = receiver ?? calleeHalf(this._def);
    if (half === undefined) return;
    this._calleeStamp = { half, version: half._writeVersion, written };
    if (receiver !== undefined) this._calleeStamp.receiver = receiver;
    const own = this._ops;
    if (
      ops !== undefined &&
      (ops.length !== own.length || ops.some((x, i) => x !== own[i]))
    )
      this._calleeStamp.ops = ops;
  }

  /** The operands `ops` (in declaration order) written again as the call
   * was written, with its named arguments, when the call has a record of
   * them (`_calleeStamp.written`). Otherwise `ops` itself. */
  private _writtenOperands(
    ops: ReadonlyArray<Expression>
  ): ReadonlyArray<Expression> {
    const written = this._calleeStamp?.written;
    if (written === undefined) return ops;
    const ce = this.engine;
    return written.map(({ name, slot }) => {
      const value = slot < 0 ? ce.symbol('Nothing') : ops[slot];
      if (name === undefined) return value;
      return ce._fn('NamedArgument', [ce.string(name), value], {
        canonical: false,
      });
    });
  }

  /** This call boxed again against the definition that its name holds now,
   * when that definition is not the one the call was boxed against
   * (`_calleeStamp`) and the new call is different from this one.
   * `undefined` otherwise.
   *
   * Example: with `h := (u) ↦ 1`, the call `h("abc")` is valid and typed
   * `integer`. After `h := (u: real) ↦ 7`, the call boxed again refuses the
   * string, so the type of the call is `error` and its value is the
   * `incompatible-type` error, as for a call boxed after the assignment.
   * The call itself does not change, so its `isValid` stays `true`.
   *
   * The new call is used only when it is bound to the same binding as this
   * call: when the type is read in a scope where the name has another
   * binding, the call is not boxed again.
   * @internal */
  _reboxedForCallee(): Expression | undefined {
    const stamp = this._calleeStamp;
    if (stamp === undefined) return undefined;
    const half = stamp.receiver ?? calleeHalf(this._def);
    if (
      half === undefined ||
      (half === stamp.half && half._writeVersion === stamp.version)
    )
      return undefined;
    const memo = stamp.rechecked;
    if (
      memo !== undefined &&
      memo.half === half &&
      memo.version === half._writeVersion
    )
      return memo.call;
    // Recheck updates to this binding even when a different declaration
    // shadows its spelling. An activation is checked in its own call frame.
    if (
      callableBindingInContext(
        this.engine,
        this._operator,
        this._def ?? undefined
      ) !== this._def
    )
      return undefined;
    const fresh = withCallableBinding(this, () =>
      this.engine.function(
        this._operator,
        this._writtenOperands(stamp.ops ?? this._ops)
      )
    );
    // The counter is read after the new call was boxed: boxing it can
    // write the signature of the definition (an inference).
    const version = half._writeVersion;
    if (!(fresh instanceof BoxedFunction) || fresh._def !== this._def)
      return undefined;
    // When the check replaced an operand (`stamp.ops`), `isSame()` cannot
    // tell the two calls apart: it treats a `character` and a one-cluster
    // `string` with the same content as the same value. The new call is then
    // used, because the new definition can check that operand differently.
    if (stamp.ops === undefined && fresh.isSame(this)) {
      // The new definition gives the same call: record it, so that the next
      // read costs one comparison again.
      stamp.half = half;
      stamp.version = version;
      stamp.rechecked = undefined;
      return undefined;
    }
    stamp.rechecked = { half, version, call: fresh };
    return fresh;
  }

  /** The cached answer of `_holdsRefusedCall()`. The operands of a node do
   * not change, and the construction site sets `_refusedOps` on a call
   * before the call becomes the operand of another node, so the answer is
   * computed once. */
  private _refusedCallInOperands: boolean | undefined;

  /** True when an invalid operand of this node is, or contains, a call that
   * its callee refused when it was boxed (`_refusedOps`).
   *
   * The `Error` of such a call states what the name held when the call was
   * boxed. A later assignment can replace the callee, and the call is then
   * checked again (`_recheckedCall()`). Thus the error is only a possible
   * value of this node:
   *
   * - When the callee was replaced before this node is evaluated, the node
   *   is boxed again from the checked calls and that node is evaluated in
   *   its place (`_recheckedTree()`, `_canonicalToEvaluate()`):
   *   `h("a") + 1` is `8` after `h := u ↦ 7` replaced `h := (u: real) ↦ 7`.
   * - Otherwise an operand can still replace the callee before the call is
   *   evaluated (`Block(Assign(h, u ↦ 7), h("a") + 1)`). So the handler of
   *   the node runs, and the error that the boxed call holds is not bubbled
   *   before it (`_invalidValue()`, `_absorbsErrorAfterHandler()`). An error
   *   in the result is absorbed after the handler.
   *

   * The walk goes through invalid operands only, and does not go into an
   * `Error`. It uses an explicit stack, because an invalid tree can be as
   * deep as its input is long.
   * @internal */
  _holdsRefusedCall(): boolean {
    if (this._refusedCallInOperands !== undefined)
      return this._refusedCallInOperands;
    let found = false;
    const stack: Expression[] = [...this._ops];
    while (!found && stack.length > 0) {
      const x = stack.pop()!;
      if (x.isValid || !(x instanceof BoxedFunction)) continue;
      if (x._operator === 'Error') continue;
      if (x._refusedOps !== undefined) found = true;
      else stack.push(...x._ops);
    }
    this._refusedCallInOperands = found;
    return found;
  }

  /** True when the operand `i` of `tail` is the operand of this node as it
   * was boxed, not evaluated, and that operand is, or contains, a call that
   * its callee refused when it was boxed. A lazy operator holds its operands
   * and its handler evaluates them. The error of such an operand is
   * therefore not certain before the handler runs, because the call is
   * checked again when it is evaluated (`_holdsRefusedCall()`). */
  private _holdsRefusedOperand(
    tail: ReadonlyArray<Expression>,
    i: number
  ): boolean {
    const op = tail[i];
    return (
      op === this._ops[i] &&
      op instanceof BoxedFunction &&
      (op._refusedOps !== undefined || op._holdsRefusedCall())
    );
  }

  /** This node boxed again, with each call in its invalid operands that its
   * callee refused when it was boxed replaced by the same call checked
   * against the function that the name holds now (`_recheckedCall()`).
   * Returns this node itself when no such call changed: the callee was not
   * replaced, or it refuses the operand with the same error.
   * @internal */
  _recheckedTree(): Expression {
    if (this._refusedOps !== undefined) return this._recheckedCall() ?? this;
    if (this.isValid || !this._holdsRefusedCall()) return this;
    let changed = false;
    const ops = this._ops.map((x) => {
      if (!(x instanceof BoxedFunction)) return x;
      const y = x._recheckedTree();
      if (y !== x) changed = true;
      return y;
    });
    return changed ? this.engine.function(this._operator, ops) : this;
  }

  // Validity depends only on the (immutable) structure — the operator and
  // the operands' own validity — so it is computed once and cached. Without
  // the cache a parent's `isValid` re-walks every descendant on every query,
  // which is O(nodes × depth) for nested queries (Tycho item 75: 77% of a
  // large document import was spent in repeated `isValid` walks).
  private _isValid: boolean | undefined;

  // Cached properties of the expression
  private _value: CachedValue<Expression> = {
    value: null,
    generation: -1,
  };
  private _valueN: CachedValue<Expression> = {
    value: null,
    generation: -1,
  };
  /** Evaluated form of an EAGER collection producer (`Divisors`,
   * `Characters`, … — no collection handlers), filled by the `at()`
   * materialize fallback (`_materializedAt`): once per generation, not per
   * probed index — `takeIterator` calls `at(1), at(2), …` and must not run
   * the producer (an eigendecomposition, a factorization) per element. */
  private _eagerSource: CachedValue<Expression> = {
    value: null,
    generation: -1,
  };
  private _sgn: CachedValue<Sign | undefined> = {
    value: null,
    generation: -1,
  };
  private _type: CachedValue<BoxedType | undefined> = {
    value: null,
    generation: -1,
  };
  /** The runtime effect channel (`effects-of.ts`). Keyed — since migration
   * step 3 of `docs/EFFECTS-MODEL.md` — on
   * the **`callable` axis** (`ce._callableVersion`: the events that can
   * change what the projection reads) plus an ambient-scope identity stamp
   * (`_effectsScope`), instead of the broad `any` axis: the measured waste
   * (§1 of the design — 100% of this cache's generation misses were
   * same-answer recomputes) came from scalar writes, per-call `let`
   * declares, and clean scope pops, none of which can move an effects
   * answer. The `generation` slot of the `CachedValue` stores the
   * callable-axis version. `undefined` is a legitimate cached value (the
   * empty set); `null` is the miss marker. Validated by the
   * `CE_EFFECTS_PARANOID` canary (recompute-on-hit, throw on divergence).
   *
   * NOT managed through the shared `cachedValue` helper — see `_effectsOf`:
   * the projection can re-enter the same node through a binding cycle, and
   * `cachedValue`'s stamp-then-compute order returned the PREVIOUS
   * generation's value as current on the re-entrant read, freezing an
   * in-flight answer at the current generation.
   *
   * MUTABLE-OBJECT DISPOSITION (ruling B3's cache inventory): this cache
   * records no object-version dependencies and needs none. An effects answer
   * is derived from declarations, signatures and function bodies — the
   * projection walks structure and consults definitions, and evaluates
   * nothing — so it can never reach `BoxedObject._field()` and can never be
   * derived from a field's contents. The payload is an effect set, which
   * cannot contain an expression, let alone an object, so the
   * no-object-in-a-payload rule is satisfied by construction too. Bypassing
   * `cachedValue` therefore costs this slot nothing. */
  private _effects: CachedValue<ComputedEffects> = {
    value: null,
    generation: -1,
  };

  /** Re-entrancy marker for `_effectsOf` — see the cycle note there. */
  private _effectsInFlight = false;

  /** The ambient lexical scope the `_effects` entry was filled under — the
   * `_lazyValueScope` mechanics, verbatim: the projection resolves symbol
   * operands BY NAME through the ambient chain, and re-pushing the same
   * scope object restores the same bindings (identity hit is correct),
   * while a genuinely different chain must miss. This stamp is what lets
   * clean scope pops leave the `callable` axis entirely (design §6). */
  private _effectsScope: Scope | undefined = undefined;

  /** Re-entrancy marker for the lazy-collection evaluate memo — see
   * `_memoizedLazyCollectionValue()`. */
  private _lazyValueInFlight = false;

  /** `ce._worldVersion` when the lazy-collection evaluate memo was filled,
   * checked on EVERY entry (including the generation-independent one): the
   * rare global events — `assume`/`forget`, operator/type redefinition, and
   * above all a configuration change (`precision`/`angularUnit` run
   * `_reset()`) — invalidate stored numeric content that is otherwise
   * constant. `-1` is "never filled". Deliberately the epoch and not
   * `_semanticVersion`: value writes must NOT invalidate, or the
   * accumulator loop below loses its O(n). Same axis, same reason as the
   * element memo (`collection-element-memo.ts`). */
  private _lazyValueEpoch = -1;

  /** Whether the engine was hiding its assumptions when the lazy-collection
   * evaluate memo was filled (`ce._factsHidden()`). An evaluation
   * resolves symbols and can read a value an assumption put in force, so an
   * entry filled with the facts hidden answers a different question from one
   * filled with them in force, and neither may be served for the other.
   *
   * This is the same bit `ce._cacheGeneration()` carries in its low position,
   * spelled as a flag because it must also guard the CONSTANT entry, which
   * has no generation to carry it in. Checked on both kinds of entry. */
  private _lazyValueFactsHidden = false;

  /** The ambient lexical scope a GENERATION-GATED lazy-collection memo entry
   * was filled under. `ce._anyVersion` alone does not characterize the
   * resolution environment: re-pushing an already-populated scope bumps
   * nothing (only `popScope` bumps), yet a non-constant symbol operand
   * resolves by name through the ambient chain, so the same node means
   * something else inside that scope. Identity is the right test — the same
   * scope object re-pushed (a scoped operator re-pushing its `localScope`
   * every evaluation) has the same bindings, so it correctly hits.
   * Constant entries resolve nothing and do not consult this. */
  private _lazyValueScope: Scope | undefined = undefined;

  /** The in-flight ASYNC computation of the lazy-collection evaluate memo,
   * kept as the PROMISE so that concurrent `evaluateAsync()` calls on the same
   * node await ONE walk instead of each running their own (the "Async"
   * follow-up of
   * `docs/COLLECTIONS-MODEL.md`). Cleared when
   * the computation settles, in both directions: an aborted or rejected walk
   * memoizes neither direction and leaves the slot empty, so the next call
   * recomputes.
   *
   * Deliberately a SEPARATE field from `_lazyValueInFlight` rather than an
   * async flavor of it, for two reasons. (1) A synchronous `evaluate()`
   * arriving while this is pending cannot await it, so it ignores the slot
   * and computes; both computations write the same key with the same value
   * (modulo the identity of the rebuilt node), and the last one to settle
   * wins. (2) It is not a re-entrancy marker: re-entering this node from
   * inside its own walk means going through a symbol binding, and a symbol's
   * `evaluateAsync` is `Promise.resolve(this.evaluate())`
   * (`abstract-boxed-expression.ts`) — the re-entrant read therefore lands on
   * the SYNC path, where `_lazyValueInFlight` catches it. Handing the pending
   * promise to a caller nested inside the very computation it is waiting for
   * would deadlock; no such route exists. */
  private _lazyValuePending: Promise<Expression> | undefined = undefined;
  private _lazyValuePendingOptions: Partial<EvaluateOptions> | undefined;
  private _lazyValuePendingGeneration: number | undefined;
  private _lazyValuePendingEpoch: number | undefined;

  /** Memo for the nullary collection facets (`count`, `isEmptyCollection`,
   * `isFiniteCollection`) — see `_memoizedFacet()`. One lazily-allocated slot
   * so instances that never answer a facet query pay nothing; `undefined`
   * until the first settled facet computation. The three facets share ONE
   * dependency snapshot (they are queries over the same tree); each facet's
   * value is wrapped in `{ value }` so a facet legitimately answering
   * `undefined` is distinguishable from one not yet computed. All entries
   * expire together when `ce._worldVersion` moves or any dependency does. */
  private _facetMemo:
    | {
        /** `ce._worldVersion` sampled AFTER the fill, so a bump the
         * computation itself caused is absorbed (the element-memo stamp
         * discipline). */
        worldVersion: number;
        /** Whether the assumptions were hidden (`ce._factsHidden()`)
         * when the entries were computed. A facet walks a collection and can
         * read a symbol's assumed value or effective type on the way, so the
         * same node has two answers and an entry may only be served to a read
         * on the same side of a fact-blind bracket
         * (`docs/plans/2026-08-30-assumptions-memo-inventory.md`). A boolean
         * rather than a bit in `worldVersion`, because a suppression window
         * moves no axis. */
        factsHidden: boolean;
        deps: MemoDeps;
        count?: FacetEntry<number | bigint | undefined>;
        isEmpty?: FacetEntry<boolean | undefined>;
        isFinite?: FacetEntry<boolean | undefined>;
      }
    | undefined = undefined;

  /** The engine generation at which `_type` was last written or confirmed.
   * The cache KEY of `_type` (`undefined` for a pure constant, the generation
   * otherwise) costs a purity projection plus an `isConstant` subtree walk to
   * compute, so `get type` reads this first: within one generation both
   * `isPure` and `isConstant` are stable, so the key would come out exactly as
   * it did last time and `cachedValue` would hit — the recomputation cannot
   * change the answer. `-1` is "never computed" (generations start at 0).
   *
   * The COMPOSITE generation (`ce._cacheGeneration()`), so that the fast path
   * closes when the engine starts or stops hiding its assumptions. One field
   * for both cells of `_type`: a read that alternates between the two sides
   * simply misses the fast path and goes to `cachedValue`, which serves the
   * right cell. */
  private _typeGeneration = -1;
  /** The world version (`engine._worldVersion`) under which the
   * constant-keyed type entry of a literal list tree was stored — see the
   * literal-list exception in `get type`. */
  private _typeEpoch = -1;
  /** Whether this node is a literal list tree (`_isLiteralListTree`),
   * decided once: the structure of a node never changes. */
  private _literalListTree: boolean | undefined;

  constructor(
    ce: ComputeEngine,
    operator: string,
    ops: ReadonlyArray<Expression> | undefined,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      structural?: boolean;
      scope?: Scope;
      /** A numeric store in place of boxed operands (`_numericStore`).
       * Only a `List` may carry one; `ops` is then omitted. */
      numericStore?: readonly number[];
      /** Are the integer-valued elements of the store floats
       * (`_numericStoreFloats`)? */
      numericStoreFloats?: boolean;
    }
  ) {
    super(ce, options?.metadata);

    this._operator = operator;
    // Lets `containsResidueClass()` skip its walk in an engine with no class.
    if (operator === 'ResidueClass') noteResidueClass(ce);
    const store = options?.numericStore;
    if (store !== undefined) {
      // The store is the list's literal content. Any other head would give
      // its handlers a node whose facets answer from numbers the handlers
      // never see, so the restriction is checked here, not documented away.
      if (operator !== 'List')
        throw new Error(
          `A numeric store is only valid on a "List", not on "${operator}"`
        );
      if (ops !== undefined)
        throw new Error(
          'A numeric store replaces the operands: pass one of the two'
        );
      if (!Object.isFrozen(store))
        throw new Error('A numeric store must be frozen');
    } else if (ops === undefined) {
      throw new Error(`"${operator}" has neither operands nor a numeric store`);
    }
    this._numericStore = store;
    this._numericStoreFloats =
      store !== undefined && !!options?.numericStoreFloats;
    this._opsStorage = ops;
    this._localScope = options?.scope;

    this._isStructural = options?.structural ?? false;
    if (options?.canonical || this._isStructural) this._bind();
    // `null` is "not bound" — as documented on `_def`, and as distinct from
    // the `undefined` `_bind()` leaves when it finds no definition. Only
    // `evaluate()` reads the two apart (see `_canonicalToEvaluate()`); every
    // other use tests `_def` for falsiness.
    else this._def = null;
  }

  // NOTE: this hash folds bound-variable NAMES (via each symbol operand's
  // name-keyed hash). That is sound because `isSame` compares bound
  // occurrences by name too (binding-identity equality, NOT
  // alpha-equivalence — see `same()` in compare.ts). If rename-invariant
  // equality is ever introduced, this hash must become alpha-invariant in the
  // same change, or equal expressions will hash differently and every hash
  // consumer (e.g. `match.ts` anchor bucketing) silently breaks.
  get hash(): number {
    if (this._hash !== undefined) return this._hash;

    let h = 0;
    const store = this._numericStore;
    if (store !== undefined) {
      // The same fold the boxed operands would give — each element's hash IS
      // the hash of `engine.number(v)` — computed without keeping the boxes.
      for (const v of store) h = ((h << 1) ^ this.engine.number(v).hash) | 0;
    } else if (isUnorderedSet(this._operator, this._ops)) {
      // `isSame` compares the elements of a set literal in any order, so
      // their hashes are combined with an operation that does not depend on
      // the order: a sum of each hash after a bit mix. The mix keeps two
      // different multisets of hashes from colliding as easily as a plain
      // sum would, and a sum (not a XOR) keeps a repeated element of a raw
      // set from cancelling itself.
      for (const op of this._ops) {
        let x = op.hash;
        x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
        x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
        h = (h + (x ^ (x >>> 16))) | 0;
      }
    } else {
      for (const op of this._ops) h = ((h << 1) ^ op.hash) | 0;
    }

    h = (h ^ hashCode(this._operator)) | 0;
    this._hash = h;
    return h;
  }

  get digest(): string {
    if (this._digest !== undefined) return this._digest;
    // Memoized per node, so a sub-expression shared by many parents is
    // digested once: the cost is linear in the DISTINCT nodes of the tree,
    // where a serialization of the tree is linear in its paths. Not
    // memoized when a mutable object sits below this node (see
    // `markVolatileDigest`): its snapshot can change at the next store.
    const store = this._numericStore;
    const parts =
      store !== undefined
        ? Array.from(store, (v) => this.engine.number(v).digest)
        : this._ops.map((op) => op.digest);
    const d = digest128(
      `F\u001f${this._operator}\u001f${parts.join('\u001f')}`
    );
    if (store === undefined && this._ops.some((op) => hasVolatileDigest(op)))
      markVolatileDigest(this);
    else this._digest = d;
    return d;
  }

  /**
   * For function expressions, `_infer()` infers the result type of the function
   * based on the provided type and inference mode.
   */
  _infer(
    t: () => Type,
    inferenceMode?: 'narrow' | 'widen' | 'replace'
  ): boolean {
    const def = this.operatorDefinition;

    // Inside a resolve-only region (`ce._resolveOnly()`: partial forms,
    // serialization) a read must not write inference onto a definition —
    // every call site is fire-and-forget, so declining is safe.
    if (this.engine._resolveOnlyDepth > 0) return false;

    // Use-driven element inference. A requirement on this application's
    // RESULT (`xs[1] + 1` requires `number` of `xs[1]`) tells the operator's
    // `inferOperandTypes` handler what each operand must be, and each answer
    // is written onto that operand through its own `_infer`: a symbol takes
    // the write when its type is inferred or still unknown (never a declared
    // one), and a nested application forwards to its own handler, so
    // `m[1][2] + 1` reaches `m`. Only a requirement qualifies — `narrow`, the
    // default mode; a `widen` carries a result possibility, not a constraint
    // on the operands. The requirement is computed with the assumptions
    // hidden, like every other inference write: what lands on a definition
    // must stay true after a `forget()`. When no operand takes a write, the
    // call falls through to the inferred-signature narrowing below, so an
    // operator that has both mechanisms loses neither.
    const inferOperandTypes = def?.inferOperandTypes;
    if (
      inferOperandTypes !== undefined &&
      (inferenceMode ?? 'narrow') === 'narrow'
    ) {
      const written = this.engine._withoutFacts(() => {
        const requirement = operandRequirement(t());
        if (requirement === undefined) return false;
        const writes = inferOperandTypes(this._ops, requirement);
        if (writes === undefined) return false;
        let any = false;
        writes.forEach((w, i) => {
          const op = this._ops[i];
          if (w === undefined || op === undefined) return;
          // A `replace` entry is a type the handler already combined with
          // the operand's current type, so it replaces that type instead of
          // being intersected with it.
          if (typeof w === 'object' && 'replace' in w) {
            if (op._infer(() => w.replace, 'replace')) any = true;
          } else if (op._infer(() => w)) any = true;
        });
        return any;
      });
      if (written) return true;
    }

    // A GENERIC head with no `inferOperandTypes` hook forwards a requirement
    // on its result to the operands typed by the SAME type variable: for
    // `f: (T) -> T where T: number | function`, a use of `f(u)` that requires
    // a number (`f(u) + 1`) means `T` is a number there, so `u` is one.
    // Without this, `u` kept the whole bound as its inferred type, and only a
    // direct numeric use of `u` narrowed it. A requirement that is itself a
    // function type is dropped by `operandRequirement`, as everywhere.
    // The head is either an OPERATOR (a library or user operator definition)
    // or a SYMBOL holding a function value (`ce.declare('f', '(T) -> T …')`),
    // whose signature is its declared type — or its held value's type when
    // the declaration is a bare `function`, the rule the type derivation
    // applies to such a head.
    const headSignature = (): Type | undefined => {
      if (def !== undefined) return def.signature.type;
      const vd = this.valueDefinition;
      if (vd === undefined) return undefined;
      const declared = vd.type.type;
      return isWildcardFunctionType(declared)
        ? (vd.value?.type.type ?? declared)
        : declared;
    };
    const sig = headSignature();
    if (
      inferOperandTypes === undefined &&
      (inferenceMode ?? 'narrow') === 'narrow' &&
      sig !== undefined &&
      isSignatureType(sig)
    ) {
      const r = sig.result;
      if (typeof r !== 'string' && r.kind === 'variable') {
        const written = this.engine._withoutFacts(() => {
          const requirement = operandRequirement(t());
          if (requirement === undefined) return false;
          let any = false;
          this._ops.forEach((op, i) => {
            const pt = signatureSlotType(sig, i);
            if (pt === undefined || typeof pt === 'string') return;
            if (pt.kind !== 'variable' || pt.name !== r.name) return;
            if (op._infer(() => requirement)) any = true;
          });
          return any;
        });
        if (written) return true;
      }
    }

    if (!def || !def.inferredSignature) return false;

    // The caller's type computation, the incumbent signature read and the
    // narrow/widen all run with the assumptions hidden: the result is stored
    // on a shared operator definition and must survive a `forget()`.
    return this.engine._withoutFacts(() =>
      this._inferWithoutFacts(def, t(), inferenceMode)
    );
  }

  private _inferWithoutFacts(
    def: BoxedOperatorDefinition,
    t: Type,
    inferenceMode?: 'narrow' | 'widen' | 'replace'
  ): boolean {
    const previousSignature = def.signature;

    // Rollback journal (family 2): capture the signature `BoxedType` for an
    // identity-preserving restore before either branch below replaces it;
    // `_resyncEffects()` re-attaches the cached effect set so the arrow and
    // the derived `pure`/`drawsRandom` getters stay in lockstep.
    const journalSignature = (): void => {
      const rollbackFrame = activeRollbackFrame(this.engine);
      if (rollbackFrame === undefined) return;
      const signature = def.signature;
      rollbackFrame.record({
        undo: () => {
          def._setSignature(() => signature);
          def._resyncEffects();
        },
      });
    };

    // If the signature was inferred, refine it by narrowing the result
    if (def.signature.is('function')) {
      journalSignature();
      const next = new BoxedType(
        { kind: 'signature', result: t },
        this.engine._typeResolver
      );
      def._setSignature(() => next);
    } else if (isSignatureType(def.signature.type)) {
      // Preserve the argument information when updating the result type
      const oldSig = def.signature.type;
      // A widen driven by a usage-site parameter constraint must not discard a
      // more precise inferred result: when the result already satisfies the
      // constraint (`vector<2>` used where `indexed_collection` is expected),
      // `widen(vector<2>, indexed_collection)` would coarsen it to the loose
      // constraint. Keep the precise type. (Narrowing is authoritative and is
      // left untouched.)
      if (inferenceMode !== 'narrow' && isSubtype(oldSig.result, t))
        return true;
      const nextSig: FunctionSignature = {
        kind: 'signature',
        args: oldSig.args,
        optArgs: oldSig.optArgs,
        variadicArg: oldSig.variadicArg,
        variadicMin: oldSig.variadicMin,
        result:
          inferenceMode === 'narrow'
            ? narrow(oldSig.result, t)
            : widen(oldSig.result, t),
      };
      // The effect specifier and the `where` clause are the arrow's two
      // adjunct fields, neither re-derivable from the result-type inference:
      // carry BOTH across the rebuild.
      if (oldSig.effects !== undefined) nextSig.effects = oldSig.effects;
      if (oldSig.typeParams !== undefined)
        nextSig.typeParams = oldSig.typeParams;
      journalSignature();
      const next = new BoxedType(nextSig, this.engine._typeResolver);
      def._setSignature(() => next);
    }

    // The signature OBJECT was replaced. Re-attach the definition's effect set
    // so the arrow and the cached `_effects` the derived `pure`/`drawsRandom`
    // getters read stay in lockstep — otherwise an inferred `random` lambda
    // serializes pure the moment its result type is inferred.
    def._resyncEffects();

    // Signature inference mutates a SHARED operator definition in place: a
    // semantic change other expressions may depend on. A definition declared
    // under a scratch scope (`scratch-scopes.ts`) is shared only by the
    // expressions of the computation that owns that scope.
    this.engine._noteStateEvent({
      kind: 'inference',
      ...(isScratchBinding(this.engine, def) ? { scratch: true } : {}),
    });

    // Single emission point for the write's passive observers (provenance
    // history, narrowing sink — see `_noteInferenceWrite` in `index.ts`).
    // The rebuild above always creates a FRESH `BoxedType`, so object
    // identity cannot detect a no-op refinement; compare serializations and
    // skip the emission when the signature did not actually change (the
    // sink used to apply this same filter internally).
    if (
      this._def &&
      previousSignature !== def.signature &&
      previousSignature.toString() !== def.signature.toString()
    )
      this.engine._noteInferenceWrite({
        name: this._operator,
        binding: this._def,
        target: def,
        from: previousSignature,
        to: def.signature,
        kind: 'inferred',
      });

    return true;
  }

  _bind(): void {
    // Operator (function-application) position: an inner binding that
    // provably cannot be applied — a user symbol `N = 85` shadowing the
    // built-in `N` operator — defers to an outer applicable definition.
    this._def = lookupApplicable(
      this._operator,
      this._localScope ?? this.engine.context.lexicalScope,
      this.engine
    );
    // Forward and statement-declared function slots may acquire an operator
    // definition when their declaration runs. Keep the slot's lexical home.
    if (this._def !== undefined && !hasCallableHome(this._def)) {
      for (
        let scope: Scope | null =
          this._localScope ?? this.engine.context.lexicalScope;
        scope;
        scope = scope.parent
      ) {
        if (scope.bindings.get(this._operator) === this._def) {
          markCallableHome(this._def, scope);
          break;
        }
      }
    }
  }

  _reset(): void {
    // Note: a non-canonical expression is never bound
    // this._def = null;
  }

  get value(): Expression | undefined {
    return undefined;
  }

  get isCanonical(): boolean {
    return this._def !== undefined && this._def !== null && !this._isStructural;
  }

  /**
   * The runtime effect channel for this application — the projection rule of
   * `docs/EFFECTS-MODEL.md`, memoized behind the generation guard.
   *
   * Cycle-safe by construction, which the shared `cachedValue` helper is NOT:
   * the projection follows bindings, so a self-recursive definition's body
   * reaches its own nodes re-entrantly (body → self-application → the
   * binding's literal → body). `cachedValue` stamps the generation BEFORE
   * computing, so the re-entrant read saw a current-generation stamp with
   * the PREVIOUS generation's value still in the slot and returned it as
   * fresh — freezing an assign-time in-flight `'any'` (or, the unsound
   * direction, a stale pure) at the current generation, with the answer
   * depending on which node was read first. Here instead:
   *
   * - a re-entrant read answers `'any'` provisionally and marks the pass —
   *   conservative, never cached;
   * - the value is stamped only AFTER computing, and only when the
   *   computation consumed no provisional edge — a value derived from an
   *   in-flight `'any'` is returned but not frozen, so the next read
   *   recomputes it against settled answers.
   *
   * Nodes on a genuine cycle therefore recompute per read (bounded by the
   * body size); everything else caches exactly as before.
   * @internal
   */
  _effectsOf(): ComputedEffects {
    // A store-backed list is a container of numbers: evaluating it has no
    // effect, and the projection must not box the operands to find that out.
    // A `List` or `Tuple` that is other written-out data (`_isLiteralData()`:
    // numbers, failed cells and lists of them) evaluates to itself, so it has
    // no effect either. Its projection visited each `Error` cell, and the
    // cache below is keyed on the lexical scope, which changes at each turn
    // of a loop. A single `Error` node is small, and keeps its cached
    // projection.
    if (
      this._numericStore !== undefined ||
      (this._operator !== 'Error' && this._isLiteralData())
    )
      return undefined;
    const callableVersion = this.engine._callableVersion;
    const scope = this.engine.context?.lexicalScope;
    if (
      this._effects.generation === callableVersion &&
      this._effects.value !== null &&
      this._effectsScope === scope
    ) {
      if (CACHE_STATS) recordCache('effects', 'hit');
      // Canary (`CE_EFFECTS_PARANOID`, design §6): on every served hit,
      // recompute the projection and compare — a divergence is a
      // callable-axis coverage hole and throws. Latched: the recompute
      // itself reads children's `_effectsOf` re-entrantly.
      if (EFFECTS_PARANOID && !_effectsParanoidActive) {
        _effectsParanoidActive = true;
        try {
          const fresh = applicationEffects(this);
          if (!sameComputedEffects(this._effects.value, fresh))
            throw new Error(
              `CE_EFFECTS_PARANOID: stale effects served for "${this._operator}": ` +
                `cached ${JSON.stringify(this._effects.value)} vs fresh ${JSON.stringify(fresh)}`
            );
        } finally {
          _effectsParanoidActive = false;
        }
      }
      return this._effects.value;
    }

    if (this._effectsInFlight) {
      if (CACHE_STATS) recordCache('effects', 'declineCycle');
      _effectsProvisionalReads += 1;
      return 'any';
    }

    this._effectsInFlight = true;
    const before = _effectsProvisionalReads;
    try {
      const prev = this._effects.value;
      const value = applicationEffects(this);
      _effectsComputeCount += 1;
      if (_effectsProvisionalReads === before) {
        if (CACHE_STATS) {
          recordCache(
            'effects',
            prev === null
              ? 'missCold'
              : this._effects.generation !== callableVersion
                ? 'missGeneration'
                : 'missScope'
          );
          if (
            prev !== null &&
            this._effects.generation !== callableVersion &&
            sameComputedEffects(prev, value)
          )
            recordCache('effects', 'missGenerationWasted');
        }
        this._effects.generation = callableVersion;
        this._effects.value = value;
        this._effectsScope = scope;
      } else if (CACHE_STATS) recordCache('effects', 'declineStore');
      return value;
    } finally {
      this._effectsInFlight = false;
    }
  }

  /** A VIEW of the effect channel: "no impurity label in `effectsOf(expr)`"
   * (`docs/EFFECTS-MODEL.md`, "Runtime counterpart"). No longer independently
   * computed — the projection is strictly more precise than the old
   * `def.pure && every operand pure` rule: it resolves a symbol operand through
   * its binding (so `Map(randomF, xs)` is impure), and it stops at the two
   * boundaries where nothing is evaluated — a quote position (`Hold`) and a
   * `Function` literal, whose effects live on its own arrow. */
  get isPure(): boolean {
    return isPureComputedEffects(this._effectsOf());
  }

  /** The public view of the effect channel — see `publicEffects()`, which
   * erases the two internal distinctions (the co-finite form maps to `'any'`,
   * the stated-pure `[]` to `undefined`). */
  get effects(): ReadonlyArray<EffectLabel> | 'any' | undefined {
    return publicEffects(this._effectsOf());
  }

  get isConstant(): boolean {
    // Operands first: the walk stops at the first free variable, which is
    // cheaper than the effect projection `isPure` runs. Same conjunction,
    // both sides side-effect free.
    if (this._numericStore !== undefined) return this.isPure;
    return this._ops.every((x) => x.isConstant) && this.isPure;
  }

  get json(): MathJsonExpression {
    const s = this.structural;
    const ops = isFunction(s) ? s.ops : this._ops;
    // A `Function` literal's parameter annotation that INFERENCE wrote (see
    // `isInferredTypedParameter`) is not part of what the author said: it is
    // left out, so the MathJSON — and the LaTeX, which serializes it — show
    // only the annotations the author chose, and the printed form of a
    // literal does not depend on what else the engine has bound.
    if (this._operator === 'Function')
      return [
        this._operator,
        ...ops.map((x, i) =>
          i > 0 && isInferredTypedParameter(x) && isFunction(x)
            ? x.op1.json
            : x.json
        ),
      ];
    return [this._operator, ...ops.map((x) => x.json)];
  }

  get operator(): string {
    return this._operator;
  }

  get ops(): ReadonlyArray<Expression> {
    return this._ops;
  }

  get nops(): number {
    return this._numericStore?.length ?? this._ops.length;
  }

  /**
   * The elements of a `List` as plain machine numbers, or `undefined`.
   *
   * A store-backed list (`ce.list()`) answers its frozen store, without
   * boxing. An ordinary `List` answers when every operand is a MACHINE
   * number — a boxed number that is the same as the boxed form of its own
   * machine value (`engine.number(op.re).isSame(op)`), which admits an
   * integer, a finite double, an infinity and `NaN`, and rejects an exact
   * rational, a radical, a bignum with more digits than a double holds, a
   * complex number, a symbol or a nested list. The answer is computed once
   * and cached as a frozen DERIVED array; it never becomes a store (the
   * operands stay the source of truth). It never projects through `.re`
   * alone, so it never returns an approximation of an exact value: a caller
   * that wants floats of an exact list evaluates it with `.N()` first.
   */
  get array(): readonly number[] | undefined {
    if (this._numericStore !== undefined) return this._numericStore;
    if (this._operator !== 'List') return undefined;
    if (this._derivedArray !== undefined)
      return this._derivedArray ?? undefined;
    const ops = this._ops;
    const out = new Array<number>(ops.length);
    let machine = true;
    for (let i = 0; i < ops.length; i++) {
      const x = machineNumberOf(ops[i]);
      if (x === undefined) {
        this._derivedArray = null;
        this._derivedArrayIsMachine = false;
        this._derivedArrayFloats = null;
        return undefined;
      }
      if (machine && isExactNonInteger(ops[i], x)) machine = false;
      // `-0 === 0`, so this stores `+0` for both.
      out[i] = x === 0 ? 0 : x;
    }
    this._derivedArray = Object.freeze(out);
    const kind = machine ? integerExactnessClass(ops, out) : undefined;
    this._derivedArrayFloats = kind === undefined ? null : kind === 'float';
    // A list with an integer-valued float (`[0.5, 2.0]`) is not reproduced
    // by `ce.list(array)`, which boxes the double `2` as an exact integer.
    this._derivedArrayIsMachine = kind === 'exact';
    return this._derivedArray;
  }

  /**
   * Does `array` reproduce this list, exactness included — is
   * `engine.list(this.array)` this list element for element, as the
   * interpreter computes with it?
   *
   * A store-backed list (`ce.list()`) answers `true` in constant time: its
   * operands ARE `engine.number(store[i])`. A store whose integer-valued
   * elements are floats (`_numericStoreFloats`) answers `false`: re-boxing
   * the double `1` gives the exact `1`. An ordinary `List` answers
   * `true` when `array` is defined, no element is a float with an integer
   * value (`2.0`), for the same reason, and no element is an exact
   * non-integer:
   * `array` admits the exact rationals a double holds without rounding
   * (`1/2`, `3/4`), but re-boxing `0.5` gives a float that computes as one
   * (`0.5 / 3` is `0.1666…` where `1/2 ÷ 3` is `1/6`). An integer is
   * reproduced in every representation, so it never counts against the
   * answer. The answer is computed once, with the array. `false` for every
   * other expression, including a nested list.
   */
  get isMachineNumeric(): boolean {
    if (this._numericStore !== undefined) return !this._numericStoreFloats;
    if (this._operator !== 'List') return false;
    if (this._derivedArrayIsMachine === undefined) void this.array;
    return this._derivedArrayIsMachine!;
  }

  /**
   * Internal. The exactness of the integer-valued elements of a list of
   * machine numbers, for the routes that compute on its doubles
   * (`machine-broadcast.ts`): `false` when they are exact integers (the
   * list is `isMachineNumeric`), `true` when they are floats (a list such
   * as `[0.5, 2.0]`, or a store with `_numericStoreFloats`), `undefined`
   * when the list is not a list of machine numbers, holds an exact
   * non-integer, or mixes exact integers with integer-valued floats. With
   * the doubles of `array`, the answer tells whether each element is exact:
   * an element with a fraction part is a float, an element with an integer
   * value is a float exactly when the answer is `true`.
   */
  get _machineFloats(): boolean | undefined {
    if (this._numericStore !== undefined) return this._numericStoreFloats;
    if (this._operator !== 'List') return undefined;
    if (this._derivedArrayFloats === undefined) void this.array;
    return this._derivedArrayFloats ?? undefined;
  }

  get op1(): Expression {
    return this._ops[0] ?? this.engine.Nothing;
  }
  get op2(): Expression {
    return this._ops[1] ?? this.engine.Nothing;
  }
  get op3(): Expression {
    return this._ops[2] ?? this.engine.Nothing;
  }

  get isScoped(): boolean {
    return this._localScope !== undefined;
  }
  get localScope(): Scope | undefined {
    return this._localScope;
  }

  get isValid(): boolean {
    if (this._isValid !== undefined) return this._isValid;

    // A node is valid when it is not an `Error` and every operand is valid,
    // which is settled bottom-up with an explicit stack rather than by
    // recursion: the read is as deep as the expression nests, and a
    // left-nested chain is as deep as the input is long. Measured 2026-09-22,
    // reading this on a raw-boxed 5 000-term `1-2-3-…` chain overflowed the
    // stack. The per-node answer is memoized in `_isValid` as it is settled
    // (below and above), so the walk visits each node once; the scan position
    // is kept on the frame so an operator with many operands is not rescanned
    // from the start after each one.
    //
    // Operands are settled left to right and the scan stops at the first
    // invalid one, which is what the `every()` this replaced did. A function
    // operand is settled by this walk rather than by its own getter, so this
    // assumes no subclass of `BoxedFunction` overrides `isValid`; none does
    // today, and none is derived from it at all.
    const stack: { node: BoxedFunction; index: number }[] = [
      { node: this, index: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const node = frame.node;
      if (node._isValid !== undefined) {
        stack.pop();
        continue;
      }
      if (node._operator === 'Error') {
        node._isValid = false;
        stack.pop();
        continue;
      }
      if (node._numericStore !== undefined) {
        node._isValid = true;
        stack.pop();
        continue;
      }
      let descended = false;
      while (frame.index < node._ops.length) {
        const op = node._ops[frame.index];
        // Only a function node's validity depends on a whole subtree; every
        // other kind answers without descending.
        if (op instanceof BoxedFunction && op._isValid === undefined) {
          stack.push({ node: op, index: 0 });
          descended = true;
          break;
        }
        if (!op?.isValid) {
          node._isValid = false;
          break;
        }
        frame.index += 1;
      }
      if (descended) continue;
      if (node._isValid === undefined) node._isValid = true;
      stack.pop();
    }

    return this._isValid!;
  }

  /** Note: if the expression is not canonical, this will return a canonical
   * version of the expression in the current lexical scope.
   */
  get canonical(): Expression {
    // An invalid tree stays as it is, except a `List` or `Set` literal that
    // holds a failed cell: it is a collection value that an operator reads
    // cell by cell (`isIterableWithFailedCells()`), so it is bound like a
    // valid literal. A lazy operator holds its operands raw and reads them
    // through this getter: without it, `Sum([1, Error(…), 3])` boxed from
    // MathJSON got an unbound list, which is not a collection, and an inner
    // list of `[[1, Error(…)], 2] + 1` stayed raw in the broadcast.
    if (this.isCanonical || (!this.isValid && !isIterableWithFailedCells(this)))
      return this;
    // Thread the source position through (a raw statement's `.canonical` is
    // how a `Block`/`Loop` body canonicalizes — without this, no statement
    // inside a scoped operator can be mapped back to source). `latex` is
    // deliberately NOT threaded here: the canonical form is a different
    // expression, for which verbatim source LaTeX would be a lie.
    return this._withParseScope(() =>
      this.engine.function(
        this._operator,
        this._ops,
        this.sourceOffsets !== undefined
          ? { metadata: { sourceOffsets: this.sourceOffsets } }
          : undefined
      )
    );
  }

  /** Per-node memo for `structural`. The rebuild recurses into every
   * operand's `structural`, so without it a tree with SHARED operands is
   * rebuilt once per path — exponential time and allocation. The answer
   * depends only on this node's own tree and the operator definitions
   * consulted for flattening/ordering, so the `_anyVersion` guard covers
   * every way it can change; the rebuild reads no object field, so no
   * object dependencies apply. A payload that CONTAINS an object is not
   * stored (the B12/B22 commit rule in `cache.ts`); that case is served for
   * the duration of one top-level read by {@link _transientStructural}
   * instead. (Provenance: Tycho item 225.) */
  private _structural: CachedValue<Expression> = {
    value: null,
    generation: -1,
  };

  get structural(): Expression {
    return this._withParseScope(() => this._structuralInScope());
  }

  private _structuralInScope(): Expression {
    if (this.isStructural) return this;
    if (_inStructuralRead) return this._memoizedStructural();
    // The outermost read owns the transient map's lifetime and must drop it
    // before returning — including when the rebuild throws — since a map of
    // object-holding payloads that outlived the call would keep those objects
    // alive, which is what ruling B12 forbids of any cache.
    _inStructuralRead = true;
    try {
      return this._memoizedStructural();
    } finally {
      _inStructuralRead = false;
      _transientStructural = undefined;
    }
  }

  /** `structural` with the persistent per-node memo primary and the
   * transient per-read map (see {@link _transientStructural}) as the
   * fallback. The transient map is consulted and filled ONLY for a node whose
   * persistent entry is EMPTY, which is the state the `cachedValue` commit
   * rule leaves a payload it refused to store in. */
  private _memoizedStructural(): Expression {
    const gen = this.engine._cacheGeneration();
    // The entry has one cell per fact-suppression state, and the transient
    // fallback answers for the cell this read uses.
    const cell = cachedCell(this._structural, gen);
    if (cell.value === null) {
      const hit = _transientStructural?.get(this);
      if (hit !== undefined) return hit;
    }
    const result = cachedValue(
      this._structural,
      gen,
      () => this._computeStructural(),
      undefined,
      this.engine
    );
    if (cell.value === null)
      (_transientStructural ??= new Map()).set(this, result);
    return result;
  }

  private _computeStructural(): Expression {
    _structuralComputeCount += 1;
    const def = this.operatorDefinition;
    // Ellipsis fold barrier: an `Add`/`Multiply` with a direct
    // `ContinuationPlaceholder` operand is a notational object. Do not flatten
    // nested associative operands or sort — preserve source order and the
    // nested anchor structure (`2n`) in the serialized form.
    // For a product the test is depth-aware (`isFoldBarrierProduct`): a
    // canonical `Multiply` holds back a nested barrier product, so the
    // ellipsis can sit below the surface (`2·(4·(2·…·n))`). Flattening there
    // would splice the elided pattern into one chain and then SORT it.
    if (
      (def?.associative || def?.commutative) &&
      !this.ops.some((x) => isContinuationOperand(x)) &&
      !isFoldBarrierProduct(this)
    ) {
      // Flatten the arguments if they are the same as the operator
      const xs: Expression[] = this.ops.map((x) => x.structural);
      let ys: Expression[] = [];
      if (!def.associative) ys = xs;
      else {
        for (const x of xs) {
          if (isFunction(x, this.operator)) ys.push(...x.ops);
          else ys.push(x);
        }
      }
      // A CANONICAL expression has already had its commutative operands
      // ordered, and that order is the one `.ops`, `isSame` and `hash` all
      // read — so re-sorting here can only disagree with it. It did: `order()`
      // breaks a tie between two same-operator applications on `getLeafCount`,
      // and a complex literal is one atom canonically (`i`) but a two-operand
      // application in structural form (`Complex(0, 1)`). So the structural
      // operands of `m(M_1, i, n) · m(M_2, n, j)` counted 6-vs-4 where the
      // canonical ones counted 4-vs-4, the tie broke the other way, and
      // `.json` (which serializes through this form) reported an operand order
      // that `.ops`/`isSame`/`hash` contradicted for the SAME object.
      // Reported by the Tycho team as item 178(d). A non-canonical expression
      // still gets sorted: that is what puts it in structural form at all.
      const sorted =
        this.isCanonical || !this.isValid
          ? ys
          : sortOperands(this._operator, ys);
      return this.engine.function(this._operator, sorted, {
        form: 'structural',
        metadata: {
          latex: this.verbatimLatex,
          sourceOffsets: this.sourceOffsets,
        },
      });
    }
    return this.engine.function(
      this._operator,
      this.ops.map((x) => x.structural),
      {
        form: 'structural',
        metadata: {
          latex: this.verbatimLatex,
          sourceOffsets: this.sourceOffsets,
        },
      }
    );
  }

  get isStructural(): boolean {
    return this._isStructural;
  }

  toNumericValue(): [NumericValue, Expression] {
    console.assert(this.isCanonical || this.isStructural);

    const ce = this.engine;

    if (this.operator === 'Complex') {
      return [ce._numericValue({ re: this.op1.re, im: this.op2.re }), ce.One];
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let expr: Expression = this;

    //
    // Add
    //
    if (expr.operator === 'Add') {
      //  use factor() to factor out common factors
      expr = factor(expr);
      if (isNumber(expr)) {
        if (typeof expr.numericValue === 'number') {
          if (Number.isInteger(expr.numericValue))
            return [ce._numericValue(expr.numericValue), ce.One];
        } else if (expr.numericValue.isExact)
          return [expr.numericValue!, ce.One];
      }
      // if (expr.op !== 'Add') return expr.toNumericValue();
    }

    //
    // Negate
    //
    if (isFunction(expr, 'Negate')) {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.neg(), rest];
    }

    //
    // Multiply
    //
    if (isFunction(expr, 'Multiply')) {
      const rest: Expression[] = [];
      let coef = ce._numericValue(1);
      for (const arg of expr.ops) {
        const [c, r] = arg.toNumericValue();
        // A float 1 is multiplied in, so the coefficient becomes a float
        if (!c.isOne || !c.isExact) {
          // The product of two exact values is not exact when its radicand
          // is above 10⁶ (`√1009·√1013`). Keep the operand as a separate
          // factor then, as `canonicalMultiply` does, so the coefficient
          // stays exact.
          const product = coef.mul(c);
          if (coef.isExact && c.isExact && !product.isExact && !product.isNaN) {
            rest.push(arg);
            continue;
          }
          coef = product;
        }
        if (!r.isSame(1)) rest.push(r);
      }
      if (rest.length === 0) return [coef, ce.One];
      if (rest.length === 1) return [coef, rest[0]];
      return [coef, canonicalMultiply(ce, rest)];
    }

    //
    // Divide
    //
    if (isFunction(expr, 'Divide')) {
      const [coef1, numer] = expr.op1.toNumericValue();
      const [coef2, denom] = expr.op2.toNumericValue();
      const coef = coef1.div(coef2);
      if (denom.isSame(1)) return [coef, numer];
      return [coef, ce.function('Divide', [numer, denom])];
    }

    //
    // Power/Sqrt/Root
    //
    if (isFunction(expr, 'Power')) {
      // We can only extract a coef if the exponent is a literal
      if (!isNumber(expr.op2)) return [ce._numericValue(1), this];

      const [coef, base] = expr.op1.toNumericValue();
      if (coef.isOne) return [coef, this];

      // A canonical/structural Power never has a ½ exponent (it canonicalizes
      // to Sqrt), so only an integer exponent is extractable here.
      const exponent = asSmallInteger(expr.op2);
      if (exponent !== null)
        return [coef.pow(exponent), ce.function('Power', [base, expr.op2])];

      return [ce._numericValue(1), this];
    }

    if (isFunction(expr, 'Sqrt')) {
      const [coef, rest] = expr.op1.toNumericValue();
      // @fastpasth
      if (rest.isSame(1) || rest.isSame(0)) {
        if (coef.isOne || coef.isZero) return [coef, rest];
        const root = coef.sqrt();
        // The square root of an exact value that is not a perfect square is
        // a big float. Such a float reports `isExact` when its value at the
        // working precision is an integer: `√(1 + 10^-30)` at 21 digits is
        // `1.000…`, and extracting it as the exact integer `1` made
        // `2√(1 + 10^-30) − 2` an exact `0`. Only an `ExactNumericValue`
        // is an exact root; for an exact radicand, keep the whole radical.
        if (
          !(root instanceof ExactNumericValue) &&
          coef instanceof ExactNumericValue
        )
          return [ce._numericValue(1), this];
        return [root, rest];
      }
      // √(k·u) = √k·√u only holds for k ≥ 0: for k < 0 it splits off a
      // constant imaginary phase, but the true value is region-dependent
      // (±i·√|k|·√|u| across u = 0). Fold the sign into the radicand
      // instead: √(k·u) = √|k|·√(−u).
      const root = coef.sgn() === -1 ? coef.neg().sqrt() : coef.sqrt();
      // Same rule as above: an inexact root of an exact coefficient is not
      // extracted (it would strand a float beside the symbolic remainder).
      if (
        !(root instanceof ExactNumericValue) &&
        coef instanceof ExactNumericValue
      )
        return [ce._numericValue(1), this];
      if (coef.sgn() === -1) return [root, ce.function('Sqrt', [rest.neg()])];
      return [root, ce.function('Sqrt', [rest])];
    }

    if (isFunction(expr, 'Root')) {
      // `realExponentValue` is `undefined` (read as `NaN`) for an exact
      // non-integer index whose double is an integer.
      const exp = isNumber(expr.op2)
        ? (realExponentValue(expr.op2) ?? NaN)
        : expr.op2.re;
      if (isNaN(exp) || expr.op2.im !== 0) return [ce._numericValue(1), this];

      const [coef, rest] = expr.op1.toNumericValue();
      // An even root of a negative coefficient cannot be extracted with
      // real arithmetic: NumericValue.root uses the real-root convention,
      // so (−u)^(1/4) would become −u^(1/4), which is not a 4th root of
      // −u (the −1 is the complex phase e^{iπ/4}). (A canonical Root never
      // has index 2 — that becomes Sqrt — so the Sqrt-style imaginary
      // extraction is not needed here.) This must run before the exactness
      // check below: NumericValue.root returns NaN here, and NaN reports as
      // exact.
      if (exp % 2 === 0 && coef.sgn() === -1)
        return [ce._numericValue(1), this];

      // Extracting an inexact root of an EXACT radicand leaks a float: it
      // either strands a symbolic remainder beside a float coefficient
      // (e.g. Root(2x,3) → ∛2·Root(x,3)) or, for a pure-number radicand,
      // floats the whole exact constant (Root(2,3) → 1.2599·Root(1,3)),
      // violating the exactness contract. Keep the whole radical symbolic
      // whenever the coefficient we would extract is inexact but the radicand
      // was exact. (A genuinely inexact radicand — a float — may still
      // numericize, since there is no exactness to preserve.)
      const root = coef.root(exp);
      if (
        !(root instanceof ExactNumericValue) &&
        (!rest.isSame(1) || coef instanceof ExactNumericValue)
      )
        return [ce._numericValue(1), this];
      return [root, ce.function('Root', [rest, expr.op2])];
    }

    //
    // Abs
    //
    if (isFunction(expr, 'Abs')) {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.abs(), ce.function('Abs', [rest])];
    }
    console.assert(expr.operator !== 'Complex');

    //
    // Exp/Log/Ln
    //
    // Exp and logarithms don't have numeric coefficients to extract.
    // Keep them symbolic - don't evaluate or expand.
    if (
      expr.operator === 'Exp' ||
      expr.operator === 'Log' ||
      expr.operator === 'Ln'
    )
      return [ce._numericValue(1), this];

    // @todo:  could consider others: Exp, trig functions

    return [ce._numericValue(1), expr];
  }

  /**
   * Note: the result's FREE symbols are bound in the current scope, not in the
   * scope of the original expression. A node that owns a local scope keeps
   * that scope — see the rebuild at the end of this method for why.
   */
  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    return this._withParseScope(() => this._subsInParseScope(sub, options));
  }

  private _subsInParseScope(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    options ??= { canonical: undefined };

    // When the caller does not request a form, the receiver's form is
    // preserved: canonical → canonical, structural → structural, raw → raw.
    // A structural receiver must not be rebuilt canonical: that erases the
    // parse vocabulary structural form exists to preserve (`Subtract`,
    // `Divide`, `InvisibleOperator`, `Delimiter`, operand order) and folds its
    // exact literals. The operands are substituted shape-preservingly (see
    // `opOptions` below) and this node is boxed with `form: 'structural'`.
    const structuralForm =
      options.canonical === undefined && !this.isCanonical && this.isStructural;

    if (options.canonical === undefined)
      options = { canonical: structuralForm ? false : this.isCanonical };

    // A non-canonical (held) child of a canonical parent — e.g. the index
    // symbol of `Limits`, held by `lazy` so it is never canonicalized — must
    // stay raw: canonicalizing it here happens OUTSIDE its binding scope (an
    // index `i` would become the imaginary unit). The parent's canonical
    // handler receives it raw, as it did when the expression was first built.
    // (A raw symbol reports `isStructural: true`, so key on `isCanonical`.)
    // Under the structural arm each operand preserves its OWN form
    // (`canonical: undefined`): a structural operand stays structural — and
    // is returned by identity when nothing in it matched — while a held raw
    // operand stays raw.
    const opOptions = structuralForm ? { canonical: undefined } : options;
    const ops = this._ops.map((x) =>
      options!.canonical === true && !x.isCanonical
        ? x.subs(sub, { canonical: false })
        : x.subs(sub, opOptions)
    );

    const form = structuralForm
      ? 'structural'
      : options.canonical === true
        ? 'canonical'
        : options.canonical === false
          ? 'raw'
          : options.canonical;

    // An operand whose only errors are failed cells of a `List` or `Set`
    // literal (`isInvalidNonCollection()` is `false` for it) is a collection
    // value that canonicalization accepts, so it does not force a raw
    // rebuild: `Map(f, z)` with `z` replaced by `[1, err, 3]` stays a bound
    // `Map` that can be iterated, as `Map(f, [1, err, 3])` is.
    if (!ops.every((x) => x.isValid || !isInvalidNonCollection(x)))
      return this.engine.function(this._operator, ops, { form: 'raw' });

    // Nothing in this subtree matched the substitution (every operand came
    // back identical) and the node is already in the requested form:
    // rebuilding it would re-canonicalize an unchanged tree. Return `this`.
    // (A `CanonicalForm[]` request is not a plain canonicalization, so it
    // always rebuilds.)
    if (
      (form === 'canonical' ? this.isCanonical : form === 'structural') &&
      ops.every((x, i) => x === this._ops[i])
    )
      return this;

    // A scoped node is rebuilt onto its OWN scope, never a fresh one. Minting
    // a new scope parents it at the substitution site's ambient scope, so an
    // inner binder's scope goes on pointing at the ORIGINAL outer scope while
    // the rebuilt outer node advertises a different one: the chain from the
    // inner body no longer reaches the outer binder's index, and an index
    // whose name collides with a library constant (`i`, `e`) then resolves to
    // the CONSTANT — `Σ_i Σ_j x·i` substituted at `x := 1` answered `4i`, the
    // imaginary unit, where the same tree built directly answers `6`. Same
    // rule, and the same reason, as the scoped rebuild in
    // `rewriteWithBinders` (`binders.ts`). `scopeForRebuild` withholds the
    // reuse from a substitution that RENAMES the binding site, which would
    // otherwise declare the new name into the original expression's live scope.
    return this.engine.function(this._operator, ops, {
      form,
      scope: scopeForRebuild(
        this._localScope,
        this.engine,
        this._operator,
        ops
      ),
    });
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: Partial<ReplaceOptions>
  ): Expression | null {
    return replace(this, rules, options).at(-1)?.value ?? null;
  }

  match(
    pattern: string | ExpressionInput,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  has(v: string | string[]): boolean {
    // One explicit walk with one visited set over the function nodes and
    // the dictionaries (`hasSymbolOrOperator()`), not a recursion through
    // each operand's `has()`: an expression that shares its operands
    // unfolds exponentially in the nesting depth.
    return hasSymbolOrOperator(this, v);
  }

  /**
   * The nominal value of a `Measurement(value, error)`, or `undefined` for
   * every other operator.
   *
   * `Measurement` types as its nominal's scalar type (see `measurementType()`),
   * so `Integrate(…).N()` reports `real` and `isNumber === true`. The
   * numeric read surface has to honor that: a head that claims to be a real
   * number and then answers `NaN` to every numeric accessor is not a strict
   * contract, it is an unfinished one — and the failure is silent, because a
   * consumer reading `.re` cannot tell a poisoned read from a genuine `NaN`.
   * So the numeric accessors below project the nominal; the uncertainty stays
   * reachable through `.ops`/`op2` (after an `isFunction()` narrow) and the
   * MathJSON. `re`/`im` are the channel, and they are sufficient: a
   * `Measurement` is a quadrature result, so its nominal is never an exact
   * number.
   *
   * Deliberately NOT projected, all three for the same reason — a `Measurement`
   * is a FUNCTION expression, and the number-literal surface belongs behind the
   * `isNumber()` guard, which narrows on expression kind:
   * - `numericValue`, declared only on `NumberLiteralInterface`. Projecting it
   *   would advertise an exact numeric representation this expression does not
   *   have, on a surface a `Measurement` cannot legitimately narrow to.
   * - `isNumberLiteral`, for the same reason — claiming it would hand callers a
   *   `BoxedNumber` interface this expression does not implement.
   * - `value`, documented as the expression itself for a literal and
   *   `undefined` for a symbolic expression; a `Measurement` is the latter.
   */
  private get _measurementNominal(): Expression | undefined {
    if (this._operator !== 'Measurement' || this._ops.length === 0)
      return undefined;
    return this._ops[0];
  }

  get re(): number {
    return this._measurementNominal?.re ?? super.re;
  }

  get im(): number {
    return this._measurementNominal?.im ?? super.im;
  }

  get bignumRe(): BigDecimal | undefined {
    return this._measurementNominal?.bignumRe ?? super.bignumRe;
  }

  get bignumIm(): BigDecimal | undefined {
    return this._measurementNominal?.bignumIm ?? super.bignumIm;
  }

  valueOf(): number | number[] | number[][] | number[][][] | string | boolean {
    return this._measurementNominal?.valueOf() ?? super.valueOf();
  }

  get sgn(): Sign | undefined {
    const nominal = this._measurementNominal;
    if (nominal) return nominal.sgn;

    // Keyed on the engine generation unconditionally: an all-constant, pure
    // node's answer still moves when its OPERATOR's definition is rewritten
    // in place, so a generation-independent key would never expire. The full
    // account is on the same key in `get type`.
    const gen = this.engine._cacheGeneration();
    const compute = (): Sign | undefined => {
      if (!this.isValid || this.isNumber !== true) return undefined;
      return sgn(this);
    };
    return cachedValue(
      this._sgn,
      gen,
      compute,
      CACHE_STATS ? { cls: 'sgn', same: (a, b) => a === b } : undefined,
      this.engine
    );
  }

  get isNaN(): boolean | undefined {
    if (!this.isNumber) return false;
    return undefined; // We don't know until we evaluate
  }

  get isInfinity(): boolean | undefined {
    if (!this.isNumber) return false;
    // Type fallback: the static type can prove non-finiteness where no
    // structural analysis can — e.g. `Ln(0)` types `+oo | -oo`.
    // `infinity` is any value of infinite magnitude, which is exactly what
    // `isInfinity` asks, and it covers the signed pair `+oo | -oo`
    // (`+oo`, `-oo`) as well as the unsigned `~oo`. A type that has no value
    // in common with `infinity` answers `false`: that is `nan` (NaN is not an
    // infinity), and, now that the bare name `real` denotes the FINITE reals,
    // every finite numeric tier as well. The type is already computed and
    // cached at this point (consulted by `isNumber` on entry).
    const t = this.type;
    if (!t.isUnknown) {
      return t.facts.infinityMembership;
    }
    return undefined; // We don't know until we evaluate
  }

  // Not +- Infinity, not NaN
  get isFinite(): boolean | undefined {
    if (this.isNumber !== true) return false;
    if (this.isNaN === true || this.isInfinity === true) return false;

    // Propagate finiteness structurally through arithmetic heads of finite
    // operands. This lets finite symbolic constants like √π or 1/π report
    // `isFinite === true` before the expression is evaluated to a number,
    // rather than the conservative `undefined` returned by the fallthrough.
    // "Definitely nonzero" is established via a known sign, mirroring the
    // ∞/finite divide rule. (BoxedExpression has no `isZero` getter; the
    // public expression surface exposes the sign predicates, and a definite
    // sign — e.g. π is positive — entails nonzero.)
    const isNonZero = (x: Expression): boolean =>
      x.isPositive === true || x.isNegative === true;
    switch (this.operator) {
      case 'Abs':
        // |x| is finite iff x is finite (real or complex) — but only when the
        // operand IS a number. `Abs` also accepts a non-numeric operand: over
        // a tuple it is the Euclidean norm, so `|(1, 2)| = √5` is a number
        // whose operand is not. For any non-number, `isFinite` answers `false`
        // by the convention at the top of this getter — meaning "not a finite
        // NUMBER", not "infinite" — and propagating that `false` claimed the
        // norm was infinite. `multiplyType` reads `isFinite === false` as a
        // provably non-finite factor, so `3·|(1, 2)|` typed
        // `+oo | -oo`, and `Divide` then folded `1/(3·|(1, 2)|)` to a
        // literal `0`: a silently wrong value, not an error (the correct
        // answer is √5/15). A non-number operand leaves finiteness undecided,
        // which is what the sibling `Norm(Tuple(1, 2))` already reports.
        if (this.op1.isNumber !== true) return undefined;
        return this.op1.isFinite;
      case 'Sqrt':
        // √x is finite iff x is finite (real or complex), and — as for `Abs`
        // above — only a NUMBER's `isFinite` says anything about finiteness.
        // `Sqrt(Tuple(1, 2))` types `number` rather than being rejected, so
        // the operand can be a non-number here too; its `isFinite === false`
        // means "not a finite number" and must not be read as "infinite".
        // Unlike the `Abs` case this one folds nothing today (the product
        // type additionally requires every factor to be provably real, which
        // a bare `number` is not), so the guard is closing the same unsound
        // claim before something else reads it.
        if (this.op1.isNumber !== true) return undefined;
        return this.op1.isFinite;
      case 'Root': {
        // ⁿ√x is finite iff x is finite and the index n is finite & nonzero.
        const radicand = this.op1.isFinite;
        const index = this.op2.isFinite;
        if (radicand === false || index === false) return undefined;
        if (radicand === true && index === true && isNonZero(this.op2))
          return true;
        break;
      }
      case 'Power': {
        const base = this.op1.isFinite;
        const exp = this.op2.isFinite;
        // bᵉ of finite base and exponent is finite, except 0 to a non-positive
        // exponent (0⁰ indeterminate, 0⁻ⁿ infinite). Require either a
        // definitely-nonzero base or a definitely-positive exponent.
        if (base === true && exp === true) {
          if (isNonZero(this.op1)) return true;
          if (this.op2.isPositive === true) return true;
        }
        break;
      }
      case 'Divide': {
        // n/d is finite iff both are finite and the denominator is definitely
        // nonzero (could-be-zero denominators are left unknown).
        const num = this.op1.isFinite;
        const den = this.op2.isFinite;
        if (num === true && den === true && isNonZero(this.op2)) return true;
        break;
      }
      case 'Negate':
      case 'Add':
      case 'Subtract':
      case 'Multiply':
        // A negation, sum, difference or product of finite numbers is
        // finite: `−π`, `π − 4` and `√2 − 3` are finite. An operand that
        // is not a number, or whose finiteness is not known (a NaN or an
        // infinite operand is not finite), leaves the result undecided
        // here.
        if (this.ops.every((x) => x.isNumber === true && x.isFinite === true))
          return true;
        break;
      case 'Sin':
      case 'Cos':
      case 'Sinh':
      case 'Cosh':
      case 'Exp':
      case 'Erf':
      case 'Erfc':
        // An entire function of a finite number (real or complex) is
        // finite: `sin(1)` and `cosh(2 + i)` are finite.
        if (this.op1.isNumber === true && this.op1.isFinite === true)
          return true;
        break;
      case 'Arctan':
        // arctan has its poles at ±i only, so it is finite at a finite real
        // number.
        if (this.op1.isFinite === true && this.op1.isExtendedReal === true)
          return true;
        break;
      case 'Ln':
      case 'Log':
        // A logarithm of a finite number that is not 0 is finite: `ln(2)`
        // and `ln(−3)` (= ln 3 + iπ). A `Log` with a base is not decided
        // here (a base of 1 has no logarithm).
        if (
          this.nops === 1 &&
          this.op1.isNumber === true &&
          this.op1.isFinite === true &&
          isNonZero(this.op1)
        )
          return true;
        break;
    }

    // A type-provable non-finite expression (e.g. `Ln(0)`) never reaches here:
    // `isInfinity` consults the static type and the early-return above already
    // answered `false`. See `get isInfinity` for that type-consult site.
    if (this.isNaN === undefined || this.isInfinity === undefined)
      return undefined;
    return true;
  }

  // Internal negative-guard helpers (never return `true`): used only via
  // `this` within BoxedFunction. Not part of the public expression surface —
  // hence the `_` prefix. Use `.is(1)` / `.is(-1)` for a real equality check.
  get _isOne(): boolean | undefined {
    if (this.isNonPositive === true || this.isExtendedReal === false)
      return false;
    return undefined;
  }

  get _isNegativeOne(): boolean | undefined {
    if (this.isNonNegative === true || this.isExtendedReal === false)
      return false;
    return undefined;
  }

  // x > 0
  get isPositive(): boolean | undefined {
    return positiveSign(this.sgn);
  }

  // x >= 0
  get isNonNegative(): boolean | undefined {
    return nonNegativeSign(this.sgn);
  }

  // x < 0
  get isNegative(): boolean | undefined {
    return negativeSign(this.sgn);
  }

  // x <= 0
  get isNonPositive(): boolean | undefined {
    return nonPositiveSign(this.sgn);
  }

  get numerator(): Expression {
    return this.numeratorDenominator[0];
  }

  get denominator(): Expression {
    return this.numeratorDenominator[1];
  }

  get numeratorDenominator(): [Expression, Expression] {
    if (!(this.isCanonical || this.isStructural))
      return [this, this.engine.One];
    if (this.isNumber !== true)
      return [this.engine.Nothing, this.engine.Nothing];

    const operator = this.operator;
    if (operator === 'Divide') return [this.op1, this.op2];

    if (operator === 'Negate') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.neg(), denom];
    }

    if (operator === 'Power') {
      const [num, denom] = this.op1.numeratorDenominator;
      // A literal negative exponent belongs in the denominator:
      // `x^-2` → `[1, x^2]`. Without this a *bare* negative power reported a
      // denominator of `1`, while the same factor inside a `Multiply` (routed
      // through `Product.asNumeratorDenominator`, which splits on exponent
      // sign) reported `x^2` — so `1/x^2` and `y/x^2` disagreed. A symbolic
      // exponent keeps the old behavior: its sign is not decidable here.
      const exponent = this.op2;
      if (isNumber(exponent) && exponent.isNegative === true) {
        const e = exponent.neg();
        return [denom.pow(e), num.pow(e)];
      }
      return [num.pow(exponent), denom.pow(exponent)];
    }

    if (operator === 'Root') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.root(this.op2), denom.root(this.op2)];
    }

    if (operator === 'Sqrt') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.sqrt(), denom.sqrt()];
    }

    if (operator === 'Abs') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.abs(), denom.abs()];
    }

    if (operator === 'Multiply')
      return new Product(this.engine, this.ops!).asNumeratorDenominator();

    if (operator === 'Add') {
      // @todo: we could try to factor out common factors
    }

    if (operator === 'Log' || operator === 'Ln') {
      // @todo: we could isolate the base
    }

    return [this, this.engine.One];
  }

  factors(): ReadonlyArray<Expression> {
    const op = this.operator;
    if (op === 'Multiply') {
      const result: Expression[] = [];
      for (const arg of this.ops) result.push(...arg.factors());
      return result;
    }
    if (op === 'Negate') {
      return [this.engine.number(-1), ...this.op1.factors()];
    }
    return [this];
  }

  toRational(): [number, number] | null {
    const op = this.operator;
    if (op === 'Divide' || op === 'Rational') {
      const num = this.op1.re;
      const den = this.op2.re;
      if (Number.isInteger(num) && Number.isInteger(den) && den !== 0) {
        const g = gcd(Math.abs(num), Math.abs(den));
        const sign = den < 0 ? -1 : 1;
        return [(sign * num) / g, (sign * den) / g];
      }
      return null;
    }
    if (op === 'Negate') {
      const r = this.op1.toRational();
      return r ? [-r[0], r[1]] : null;
    }
    return null;
  }

  //
  //
  // ALGEBRAIC OPERATIONS
  //

  neg(): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    return negate(this);
  }

  inv(): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    // The reciprocal of an expression with a residue class: only the residue
    // rules apply. The rules below read `(1/c)^{-1}` as `c` even when `1/c`
    // has no value.
    const residue = residueArithmetic(this.engine, 'Divide', [
      this.engine.One,
      this,
    ]);
    if (residue !== undefined) return residue;
    if (this._isOne) return this;
    if (this._isNegativeOne) return this;

    // 1/√u = √(1/u) only holds for u ≥ 0: on the negative real axis the
    // principal branch gives 1/√(-a) = -i/√a but √(-1/a) = +i/√a
    if (this.operator === 'Sqrt' && this.op1.isNonNegative === true)
      return this.op1.inv().sqrt();
    if (this.operator === 'Divide') return this.op2.div(this.op1);
    if (this.operator === 'Power') {
      const neg = this.op2.neg();
      if (neg.operator !== 'Negate') return this.op1.pow(neg);
      return this.engine.function('Power', [this.op1, neg]);
    }
    if (this.operator === 'Root') {
      // `root()` normalizes a negative index to the reciprocal-of-root form
      // (see the `e < 0` chokepoint there), so `x.root(-n)` yields
      // `Divide(1, Root(x, n))` — no negative-index `Root(a, -n)` (#13).
      const neg = this.op2.neg();
      if (neg.operator !== 'Negate') return this.op1.root(neg);
      return this.engine.function('Root', [this.op1, neg]);
    }
    if (this.operator === 'Exp') return this.engine.E.pow(this.op1.neg());
    if (this.operator === 'Rational') return this.op2.div(this.op1);
    if (this.operator === 'Negate') return this.op1.inv().neg();

    return this.engine._fn('Divide', [this.engine.One, this]);
  }

  abs(): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    // `||x|| = |x|` — idempotent, so an `Abs` head is already the answer.
    if (this.operator === 'Abs') return this;
    // `|−x| = |x|`, NOT `−x`. This arm used to return `this`, so
    // `ce.parse('-x').abs()` answered `-x` and evaluated to −3 at x = 3 — a
    // wrong value from a public method. It reached `PlusMinus`/`Measurement`,
    // whose canonical forms call `.abs()` on the error term: `PlusMinus(5,
    // -e)` kept `-e` as its error and serialized `5 ± -e`. A NUMERIC negative
    // was unaffected (`PlusMinus(5, -3)` normalized to `3`) because the
    // literal path never reaches here, which is why it survived.
    if (this.operator === 'Negate') return this.op1.abs();
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | Expression): Expression {
    if (rhs === 0) return this;
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    return add(this, this.engine.expr(rhs));
  }

  mul(rhs: NumericValue | number | Expression): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    // A product with a residue class goes to `mul()`, which broadcasts over
    // a collection and then applies only the residue rules. The shortcuts
    // below read `c · 0` as the integer 0.
    if (containsResidueClass(this))
      return mul(
        this,
        rhs instanceof NumericValue
          ? this.engine.number(rhs)
          : this.engine.expr(rhs)
      );
    if (rhs === 0) return this.engine.Zero;
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();

    if (rhs instanceof NumericValue) {
      if (rhs.isZero) return this.engine.Zero;
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
    }

    return mul(this, this.engine.expr(rhs));
  }

  div(rhs: number | Expression): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    return div(this, rhs);
  }

  pow(exp: number | Expression): Expression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(exp: number | Expression): Expression {
    if (
      !(this.isCanonical || this.isStructural) ||
      (typeof exp !== 'number' && !(exp.isCanonical || exp.isStructural))
    )
      throw new Error('Not canonical');
    // A root of a residue class is kept as written (`residueArithmetic()`).
    const residue = residueArithmetic(this.engine, 'Root', [
      this,
      this.engine.expr(exp),
    ]);
    if (residue !== undefined) return residue;

    // A float index is not read as a number, also when its value is an
    // integer: `f.root(2.0)` is `Root(f, 2.0)`, not the exact `Sqrt(f)`, as
    // `Root(f, 2.0)` canonicalizes.
    const e =
      typeof exp === 'number'
        ? exp
        : isNumber(exp)
          ? exp.isExact
            ? realExponentValue(exp)
            : undefined
          : exp.im === 0
            ? exp.re
            : undefined;

    if (e === 0) return this.engine.NaN;
    if (e === 1) return this;
    if (e === -1) return this.inv();
    if (e === 2) return this.engine.function('Sqrt', [this]);

    // root(a^b, c) -> a^(b/c)
    if (this.operator === 'Power' && e !== undefined) {
      const [base, power] = this.ops;
      return base.pow(power.div(e));
    }

    if (this.operator === 'Divide') {
      const [num, denom] = this.ops;
      return num.root(exp).div(denom.root(exp));
    }

    // An odd root of a negation is the negation of the root:
    // ∛(−x) = −∛x. An even root is not reduced: ∜(−x) is not ∜x (for
    // x = 16 the first is √2 + √2·i and the second is 2).
    if (this.operator === 'Negate') {
      if (e !== undefined && Number.isInteger(e) && e % 2 !== 0)
        return this.op1.root(exp).neg();
    }

    // root(sqrt(a), c) -> root(a, 2*c)
    if (this.operator === 'Sqrt') {
      if (e !== undefined) return this.op1.root(e * 2);
      if (typeof exp !== 'number') return this.op1.root(exp.mul(2));
    }

    // root(root(a, b), c) -> root(a, b*c)
    if (this.operator === 'Root') {
      const [base, root] = this.ops;
      return base.root(root.mul(exp));
    }

    if (this.operator === 'Multiply') {
      const ops = this.ops.map((x) => x.root(exp));
      return mul(...ops);
    }

    if (this.isNumberLiteral) {
      const v = this.numericValue!;
      if (typeof v === 'number') {
        if (v < 0) return this.engine.NaN;
        if (v === 0) return this.engine.Zero;
        if (v === 1) return this.engine.One;
        if (e !== undefined) {
          const r = this.engine.number(Math.pow(v, 1 / e));
          if (!r.isFinite || r.isInteger) return r;
        }
      } else {
        if (v.isOne) return this.engine.One;
        if (v.isZero) return this.engine.Zero;
        if (e !== undefined) {
          const r = v.root(e);
          if (r.isExact) return this.engine.number(r);
        }
      }
    }

    // A negative root index denotes a reciprocal. Normalize to the
    // reciprocal-of-(positive-index)-root form so a negative-index root
    // (`Root(a, -n)`, which serializes as the nonstandard, unparseable
    // `\sqrt[-n]{a}`) is never produced. This makes negative unit-fraction
    // exponents uniform with `x^{-1/2} → 1/√x`: `x^{-1/3} → 1/∛x` rather than
    // `Root(x, -3)` (#13). Placed after the reduction cases above so nested
    // radicals still combine first (`1/∛√x → 1/Root(x, 6)`).
    if (e !== undefined && e < 0 && Number.isInteger(e))
      return this.engine._fn('Divide', [this.engine.One, this.root(-e)]);

    return this.engine._fn('Root', [this, this.engine.expr(exp)]);
  }

  sqrt(): Expression {
    return this.root(2);
  }

  ln(semiBase?: number | Expression): Expression {
    const base = semiBase ? this.engine.expr(semiBase) : undefined;
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');

    // Mathematica returns `Log[0]` as `-∞`
    if (this.isSame(0)) return this.engine.NegativeInfinity;

    // ln(exp(x)) = x (for natural log)
    // ln_c(exp(x)) = x / ln(c) (for other bases)
    if (this.operator === 'Exp') {
      if (!base) return this.op1; // natural log
      return this.op1.div(base.ln()); // log_c(e^x) = x / ln(c)
    }

    // ln_c(c) = 1
    if (base && this.isSame(base)) return this.engine.One;

    // ln(e) = 1
    // ln_c(e) = 1 / ln(c)
    if (this.isSame(this.engine.E)) {
      if (!base) return this.engine.One; // ln(e) = 1
      return this.engine.One.div(base.ln()); // log_c(e) = 1/ln(c)
    }

    // ln(e^x) = x (for natural log)
    // ln_c(e^x) = x / ln(c) (for other bases)
    if (this.operator === 'Power') {
      const [b, exp] = this.ops;
      if (b.isSame(this.engine.E)) {
        if (!base) return exp; // natural log: ln(e^x) = x
        return exp.div(base.ln()); // log_c(e^x) = x / ln(c)
      }
      // ln(bⁿ) → n·ln(b) is unconditionally sound when b ≥ 0.
      if (b.isNonNegative === true) return exp.mul(b.ln(base));
      // ln(b^{2k}) → 2k·ln(|b|) — sound for every real b (SYM P0-2); this was
      // the fail-open bug (`2·ln(b)` instead of `2·ln|b|`). Independent of the
      // branch cut. Requires a real-eligible base (bail on a declared-complex
      // one, SYM P0-4 / D4).
      if (exp.isEven === true && isEligibleRealRewrite(b))
        return exp.mul(this.engine._fn('Abs', [b]).ln(base));
      // ln(bⁿ) → n·ln(b) for a non-even exponent: the documented generic-real
      // convention (D4) — fire for a real-eligible base unless it is provably on
      // Ln's branch cut (the negative real axis, where the principal values
      // differ by a multiple of 2πi, e.g. ln(b³) = 3ln(b) is wrong at b = -3).
      // Three-valued (D3): `onBranchCut !== true` keeps the convention on
      // unknown-sign bases while blocking provably-negative ones; the
      // eligibility gate blocks a declared-complex base (SYM P0-4).
      if (
        isEligibleRealRewrite(b) &&
        onBranchCut(this.engine, 'Ln', b) !== true
      )
        return exp.mul(b.ln(base));
    }

    // ln_c(a^(1/b)) = ln_c(root(a, b)) = 1/b ln_c(a) — real-eligible base, not
    // provably on the cut (D3/D4 generic-real convention).
    if (this.operator === 'Root') {
      const [a, b] = this.ops;
      if (
        a.isNonNegative === true ||
        (isEligibleRealRewrite(a) && onBranchCut(this.engine, 'Ln', a) !== true)
      )
        return a.ln(base).div(b);
    }

    // ln_c(√a) = 1/2 ln_c(a) — sound on the whole plane (√ shares Ln's
    // principal branch, so ln(√a) and ½ln(a) agree even for a < 0).
    if (this.operator === 'Sqrt') return this.op1.ln(base).div(2);

    // ln_c(a/b) = ln_c(a) - ln_c(b) — only when both operands are provably
    // non-negative. Elsewhere the principal values can differ by a multiple
    // of 2πi: at a = 1, b = -1, ln(a/b) is iπ but ln(a) - ln(b) is -iπ. This
    // is the reverse of the combination ln(a) - ln(b) → ln(a/b) in
    // `simplify-log.ts`, which has the same requirement
    // (cortex-js/compute-engine#397; `docs/SIMPLIFY.md`, "Generic-real
    // simplification policy").
    if (this.operator === 'Divide') {
      const num = this.op1;
      const den = this.op2;
      if (num.isNonNegative === true && den.isNonNegative === true)
        return num.ln(base).sub(den.ln(base));
    }

    // log_base(x) for any base — keep the base instead of dropping it (a
    // non-integer base previously fell through to a base-less `Ln`).
    if (base !== undefined) {
      // ln_10(x) -> log(x)
      if (base.re === 10) return this.engine._fn('Log', [this]);
      // ln_n(x) -> log_n(x)
      return this.engine._fn('Log', [this, base]);
    }
    return this.engine._fn('Ln', [this]);
  }

  get complexity(): number | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!(this.isCanonical || this.isStructural)) return undefined;
    return this.operatorDefinition?.complexity ?? DEFAULT_COMPLEXITY;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    if (!this._def) return undefined;
    return isOperatorDef(this._def) ? this._def.operator : this._def.value;
  }

  get operatorDefinition(): BoxedOperatorDefinition | undefined {
    if (!this._def) return undefined;
    return isOperatorDef(this._def) ? this._def.operator : undefined;
  }

  get valueDefinition(): BoxedValueDefinition | undefined {
    if (!this._def) return undefined;
    return isValueDef(this._def) ? this._def.value : undefined;
  }

  // The membership predicates answer three-valued from the claimed type
  // (`staticMembership`): `true` only when every value of the type is a
  // member, `false` only when none is, `undefined` when the type merely
  // overlaps the target — a claimed `real` for `k / 2` does not prove the
  // value is not an integer, so a `false` there would be wrong for an
  // even `k`. A `false` means "certainly not".
  get isNumber(): boolean | undefined {
    return this.type.facts.numberMembership;
  }

  get isInteger(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    return staticMembership(this.type.type, 'integer');
  }

  get isRational(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    // Every integer is a rational: `integer` is below `rational`.
    return staticMembership(this.type.type, 'rational');
  }

  get isExtendedReal(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    // Rationals and integers are real. `+oo | -oo` is admitted
    // explicitly: the bare name `real` denotes the FINITE reals, and this
    // predicate means "on the EXTENDED real line", so a signed infinity
    // answers `true` — the meaning the sign-aware folds (`1/±∞ = 0`, the
    // `real · ±∞ = ±∞` product rule) consume.
    //
    // The entailment test is against the WHOLE extended real line, not
    // against each disjunct in turn: a head whose honest result claim is the
    // union `real | +oo | -oo` (`li`, `Ei`, which reach `-∞` at an
    // interior point) is below neither `real` nor `+oo | -oo` alone,
    // so a member-wise test answered `false` for a value that is always an
    // extended real.
    // Definitely-not requires a PROOF (`staticMembership`, the rule the
    // other membership predicates follow): the type must share no value
    // with the extended real line — `nan`, `~oo`, `imaginary`, a string, a
    // list. A claim that merely fails to entail real-ness — `number`, and
    // bare `complex`, which is a hedge for an operand of unknown sign
    // (`Sqrt(x)`) and contains the reals — is undecided.
    return staticMembership(t.type, EXTENDED_REAL_TYPE);
  }

  get isFunctionExpression(): true {
    return true;
  }

  /** The type of the value of the function */
  get type(): BoxedType {
    const generation = this.engine._cacheGeneration();
    // Fast path: the cache was already consulted at this generation, so the
    // key it was consulted with — which costs a purity projection and an
    // `isConstant` subtree walk — is necessarily the same one now. See
    // `_typeGeneration`.
    //
    // The generation is the COMPOSITE one, so that the assumption-bearing
    // answer and the answer derived with the assumptions hidden never stand
    // in for each other here — this path decides for itself and would
    // otherwise serve the live type inside a suppressed window. The cell is
    // selected the same way `cachedValue` selects it.
    //
    // This path bypasses `cachedValue`, so it repeats that helper's two
    // object-dependency duties itself: an entry whose recorded
    // `(object, version)` pairs no longer hold must NOT be served (a field
    // store advances no engine generation, so `_typeGeneration` alone cannot
    // see it), and a served entry must fold its dependencies into any
    // enclosing collector, since a hit performs no field reads of its own.
    const typeCell = cachedCell(this._type, generation);
    // `typeCell.generation` is checked as well as `_typeGeneration`: when
    // `cachedValue` declines a commit (a provisional read happened), it puts
    // the cell's previous key back and keeps the previous value, while
    // `_typeGeneration` below is still set to the generation observed on
    // entry. Without the cell check, the next read at that generation served
    // the previous value from here — one computed under another key, which
    // since the value-shield key (`_cacheGeneration()`) can be the
    // value-blind answer of a shield, or the valued answer outside one.
    if (
      this._typeGeneration === generation &&
      typeCell.generation === generation &&
      typeCell.value !== null &&
      objectDepsValid(typeCell.objectDeps)
    ) {
      mergeObjectDeps(typeCell.objectDeps);
      if (CACHE_STATS) recordCache('type', 'hitFastPath');
      return typeCell.value ?? BoxedType.unknown;
    }

    // Keyed on the engine generation, with ONE exception below. An earlier
    // shape gave every all-constant, pure node a generation-INDEPENDENT key,
    // on the premise that nothing could change such a node's answer. The
    // premise holds for the operands and not for the OPERATOR: rewriting a
    // user function's definition in place — `f(x) = x + 1`, then
    // `f(x) = "hello"` — changes what `f(2)` types as, while `2` stays every
    // bit as constant, and declaring `f` after `f(2)` was first typed changes
    // it too (a `declare` advances only the generation axis). An entry
    // stamped with no generation is reached by no counter at all, so a node
    // whose type had been read once went on answering from the
    // pre-redefinition state for the rest of the engine's life. Keying it
    // honestly measured free for ordinary workloads: the full suite ran
    // 242 s against 250 s with the constant key. `sgn` and the
    // `_eagerSource` slot in `at()` shared the key and lost it for the same
    // reason.
    //
    // The exception is a LITERAL LIST TREE: a `List` whose elements are
    // number or string literals, or such lists (`_isLiteralListTree`). Its
    // type depends on no definition, no symbol and no assumption — only on
    // engine configuration, and a configuration change advances the world
    // version — so it takes a constant key gated on `_worldVersion`, the
    // gate the lazy-collection evaluate memo (`_lazyCollectionMemoKey`) uses
    // for the same purpose. Without it an accumulator loop
    // (`xs = Join(xs, [k])` under `Assign`, which advances the generation
    // every turn) re-typed its whole list four times PER TURN — the symbol's
    // type revision, the assignment's type derivation, the operand
    // descriptor and the operand NaN check each paid the O(n) walk — and the
    // loop cost 13 ms a turn at 300 elements where the same loop without the
    // assignment cost 0.2 ms.
    // The one place a derived type is stored: a type past `TYPE_SIZE_LIMIT`
    // nodes is widened here (`boundTypeSize`), so no reader — this engine's
    // or a hover's — ever walks a type with a slot per leaf of a shared
    // value. Every other type in the engine descends from a stored one or
    // from text the user wrote.
    let key: number | undefined = generation;
    if (this._isLiteralListTree()) {
      const epoch = this.engine._worldVersion;
      if (this._typeEpoch !== epoch) {
        // A new world: discard the constant entry (and the assumptions-hidden
        // cell, which a symbol-free node never needs) so the read below
        // recomputes and stores under this epoch.
        this._type.value = null;
        this._type.generation = -1;
        this._type.objectDeps = undefined;
        this._type.suppressed = undefined;
        this._typeEpoch = epoch;
      }
      key = undefined;
    }
    // A flat composite result is INTERNED (`internType`): the 5,000 points
    // of a point list then share one `tuple<real, real>` object, and the
    // list's cell fold joins them by identity. An interned type is bounded
    // by construction, so the size walk is skipped for it.
    const compute = (): BoxedType => {
      // The `List` type handler receives operand DESCRIPTORS, which the
      // framework builds from boxed operands, so a store-backed list is typed
      // here, from its numbers, before the handler would box them.
      const derived =
        this._numericStore !== undefined
          ? numericStoreType(this._numericStore)
          : type(this);
      const t = derived instanceof BoxedType ? derived.type : derived;
      const stored = isInternedType(t) ? t : internType(boundTypeSize(t));
      return derived instanceof BoxedType && stored === t
        ? derived
        : BoxedType.from(
            stored,
            derived instanceof BoxedType
              ? (derived.typeResolver ?? this.engine._typeResolver)
              : this.engine._typeResolver
          );
    };
    const result =
      cachedValue(
        this._type,
        key,
        compute,
        CACHE_STATS
          ? {
              cls: 'type',
              // A wasted recompute is one that lands on the same type;
              // BoxedType has no cheap identity, so compare the serialized
              // form.
              same: (a, b) => a?.toString() === b?.toString(),
            }
          : undefined,
        this.engine
      ) ?? BoxedType.unknown;
    // Record the generation OBSERVED ON ENTRY: a computation that bumped the
    // generation (signature inference does) must leave the fast path closed.
    this._typeGeneration = generation;
    return result;
  }

  /** Is this node a `List` whose elements are number or string literals,
   * failed cells, or literal list trees themselves, or is it a failed cell?
   * Decided once per node — the structure never changes — and read by
   * `get type` for its constant cache key. A nested list reads its own
   * memo, so a shared tower is walked once per node, not once per path.
   *
   * A failed cell is an `Error` node with no symbol in it (see
   * `_isLiteralData()`). Its type is `error` whatever the definitions and
   * the assumptions, so it does not make its own type, or the type of a list
   * that holds it, depend on them. Without it, a list that holds failed
   * cells was typed again at each read in a loop that assigns it (an
   * assignment advances the generation), three times per turn, and each
   * typing read the type of each `Error` cell again. */
  private _isLiteralListTree(): boolean {
    if (this._literalListTree !== undefined) return this._literalListTree;
    this._literalListTree =
      this._numericStore !== undefined ||
      (this._operator === 'Error' && this._isLiteralData()) ||
      (this._operator === 'List' &&
        this._ops.every(
          (op) =>
            isNumber(op) ||
            isString(op) ||
            (op instanceof BoxedFunction && op._isLiteralListTree())
        ));
    return this._literalListTree;
  }

  /** The shape of the tensor (dimensions), derived from the type */
  get shape(): number[] {
    const t = this.type.type;
    if (typeof t === 'object' && t.kind === 'list' && t.dimensions)
      return t.dimensions;
    return [];
  }

  /** The rank of the tensor (number of dimensions), derived from the type */
  get rank(): number {
    return this.shape.length;
  }

  simplify(options?: Partial<SimplifyOptions>): Expression {
    // A deadline is armed only by an enclosing `withTimeLimit` span; work
    // outside a span runs unbounded. The simplify main loop checks the
    // ambient deadline (`engine._deadlineFrame`) if one is in effect.
    return simplifyValueBlind(this, options).at(-1)?.value ?? this;
  }

  explain(operation?: ExplainOperation, options?: ExplainOptions): Explanation {
    return explainExpression(this, operation, options);
  }

  evaluate(options?: Partial<EvaluateOptions>): Expression {
    // A store-backed list holds machine numbers only: it is already its own
    // value, under every option (a materialization or a numeric
    // approximation of it is itself), so it is returned without boxing.
    if (this._numericStore !== undefined) return this;
    // Written-out data is its own value too: see `_isLiteralData()`.
    if (this._isLiteralData(options)) return this;
    // Checkpoint quiescence (`checkpoint.ts`): an evaluation must not be open
    // when a checkpoint is taken or restored — the snapshot would capture
    // state the evaluation is still about to move, and a later restore would
    // rewind to a point inside a half-finished one. Eval-context depth cannot
    // see this: a plain `evaluate` handler pushes no scope, so an operator
    // handler calling `ce.checkpoint()` looks exactly like the host calling it
    // between cells. Counting is the only signal there is.
    //
    // Two integer ops and a `finally` per function-expression evaluation.
    // A/B against the same tree with the bracket removed put a notebook-shaped
    // workload inside the run-to-run noise and a deliberately
    // evaluation-saturated loop at a low single-digit percentage; no benchmark
    // harness for it is committed, so treat those as the reason the bracket
    // was kept rather than as figures to regress against.
    //
    // The `finally` is correctness, not tidiness: an evaluation that throws
    // must not strand the count, or the engine would refuse every subsequent
    // checkpoint for the rest of its life.
    const engine = this.engine;
    // A pure eager source that a finiteness read evaluated during the
    // evaluations in progress has that value (`keptEagerSourceValue()`):
    // the iteration of a view whose finiteness a consumer read, or the
    // evaluation of an operand of an operand of a view, does not evaluate it
    // again.
    if (
      !options?.numericApproximation &&
      (options?.materialization ?? false) === false
    ) {
      const kept = keptEagerSourceValue(this);
      if (kept !== undefined) return kept;
    }
    // The pure-application memo (`IComputeEngine._applicationMemo`) is NOT
    // emptied here: it outlives a top-level evaluation, because the
    // elements of a lazy collection are pulled by later, separate top-level
    // evaluations and a self-recursive element function must find the
    // previous element's result there. Staleness is the memo's own stamps'
    // job (`function-utils.ts`, `validApplicationMemo`); its size is bounded
    // per literal (`MAX_APPLICATION_MEMO_RESULTS`).
    // Host capabilities (`ce.effects`): the evaluation that is not nested in
    // another one captures the installed registry, and every handler below it
    // receives that same object — assigning `ce.effects` while the evaluation
    // runs does not change it. The slot is already set when this evaluation is
    // nested in a synchronous one, or when the asynchronous driver set it
    // around a handler call; then it is inherited, and it is not cleared here.
    const capturesEffects = engine._evaluationEffects === undefined;
    if (capturesEffects) engine._evaluationEffects = engine.effects;
    // An evaluation that is not nested in a synchronous evaluation, and that
    // is not called from a synchronous part of the asynchronous driver (which
    // sets the registry slot around these parts), is a new top-level
    // evaluation (`beginTopLevelEvaluation`, `evaluation-epoch.ts`). An
    // asynchronous evaluation that is pending reads the number that its own
    // context stack carries, so the new number does not change it.
    if (capturesEffects && engine._evaluationDepth === 0)
      beginTopLevelEvaluation(engine);
    engine._evaluationDepth += 1;
    // The numeric request of this evaluation, for the collection handlers
    // it calls, which receive no evaluation options
    // (`IComputeEngine._numericRequest`).
    const enclosingNumericRequest = engine._numericRequest;
    engine._numericRequest = options?.numericApproximation === true;
    const walksBefore = incompleteWalkCount();
    try {
      // A deadline is armed only by an enclosing `withTimeLimit` span; work
      // outside a span runs unbounded. Evaluation checkpoints the ambient
      // deadline (`engine._deadlineFrame`) if one is in effect.
      //
      // A result of evaluating a call whose head had no value, made in this
      // top-level evaluation, evaluates its operands only
      // (`EVALUATED_UNRESOLVED_CALLS`). The test comes before
      // `_canonicalToEvaluate()`, which can box the call again against a
      // definition that the name received after the result was made, and
      // before the kind of the binding is read, because `ce.assign()` of a
      // function literal changes the shared binding record from a value
      // definition to an operator definition. It comes after the start of a
      // new top-level evaluation above, so that a result of an earlier
      // top-level evaluation resolves its head again.
      const sticky = isStickyUnresolvedCall(this);
      const canonical = sticky ? undefined : this._canonicalToEvaluate();
      const result = sticky
        ? evaluatedUnresolvedCall(
            this,
            this.ops.map((x) => x.evaluate(operandOptions(options)))
          )
        : canonical
          ? delegateEvaluation(engine, () => canonical.evaluate(options))
          : this._isMemoizableLazyCollection(options, true) ||
              this._isMemoizableInertEvaluation(options)
            ? this._memoizedLazyCollectionValue(options)
            : this._computeValue(options)();
      // An evaluation whose result is a value takes back the incomplete
      // walks that it recorded: a read in it that met an inner collection
      // that it cannot walk stayed unevaluated, which is a correct result,
      // and an enclosing handler must not discard its own result because of
      // it (see `resultHoldsNoIncompleteWalk()`).
      if (resultHoldsNoIncompleteWalk(result))
        takeBackIncompleteWalks(walksBefore);
      recordEvaluatedError(this, result);
      return options?.numericApproximation
        ? indeterminateAsNaN(result)
        : result;
    } finally {
      // The values of eager sources that the eligibility test above
      // evaluated are kept for this evaluation only.
      releaseEagerSourceValues(this);
      engine._evaluationDepth -= 1;
      engine._numericRequest = enclosingNumericRequest;
      releaseKeptEagerSourceValues(engine);
      if (capturesEffects) engine._evaluationEffects = undefined;
    }
  }

  /** Is this node bound to the definition the standard library gives its
   * operator name — the binding of that name in the outermost scope — and
   * not to a definition a host declared under the same name? */
  /**
   * Whether this evaluation reads the exponent of this `Power` exactly
   * (`evaluatesExponentExactly()`): the node is the library `Power`, and
   * only the value of its exponent decides between the matrix power and
   * the element-wise power.
   */
  private _evaluatesExponentExactly(
    options: Partial<EvaluateOptions> | undefined
  ): boolean {
    return (
      evaluatesExponentExactly(this, options) &&
      this._isBoundToLibraryDefinition()
    );
  }

  /**
   * This application over `ops`, bound to the same definition as this node,
   * with no lookup of the operator in the current scope. `ops` must be
   * canonical. When `ops` are the operands of this node, the node itself.
   *
   * A rebuild through `ce.function()` looks the operator up in the current
   * scope, and declares it there when the name has no binding. That is wrong
   * for an application whose binding is in a scope that is no longer on the
   * chain: `h(1)` made by a run of a block, read again by the `Sum` that
   * holds the block, would declare `h` in the scope of the `Sum`, and an
   * assignment to `h` in the next evaluation of the block would write that
   * binding and keep the value.
   *
   * With `copy`, the result is a new node even when `ops` are the operands
   * of this node. @internal
   */
  _withSameBinding(ops: ReadonlyArray<Expression>, copy = false): Expression {
    const sameOps =
      ops.length === this.ops.length && ops.every((x, i) => x === this.ops[i]);
    if (!copy && sameOps) return this;
    // A copy over the same operands stands for this node: it keeps the
    // verbatim LaTeX and the source offsets of this node, and the scope
    // captured by its parse (`_parseScope`), which decides how its
    // application is rebuilt when it is evaluated again
    // (`applyFunctionLiteralWith`). A node over other operands is another
    // expression, and the source text of this node does not describe it.
    const result = new BoxedFunction(
      this.engine,
      this._operator,
      ops,
      sameOps
        ? {
            metadata: {
              latex: this.verbatimLatex,
              sourceOffsets: this.sourceOffsets,
            },
          }
        : undefined
    );
    result._def = this._def;
    if (sameOps) result._parseScope = this._parseScope;
    return result;
  }

  private _isBoundToLibraryDefinition(): boolean {
    let scope = this.engine.context?.lexicalScope;
    if (scope === undefined || scope === null || this._def === undefined)
      return false;
    while (scope.parent) scope = scope.parent;
    return scope.bindings.get(this._operator) === this._def;
  }

  /**
   * Is this node written-out DATA that evaluates to itself under `options`:
   * a canonical `List` or `Tuple` whose every element is a number literal,
   * a failed cell, or such a `List` or `Tuple` in turn?
   *
   * A failed cell is an `Error` node that holds no symbol at any depth (the
   * error code, its arguments and the `where` operand are strings, numbers
   * and applications of them). An `Error` node is a final value: it never
   * evaluates its operands, and it evaluates to itself under every option,
   * so it is data too, and this method answers `true` for such a node. A
   * list in which every cell failed was evaluated again at each use, cell by
   * cell, and every walk of its symbols (the free variables, the dependency
   * snapshot of a memo, the own-binding walk of a stored value) visited the
   * operands of each `Error`: a loop that grew such a list by one cell per
   * turn (`fs = [...fs, g("a")]` in Epsil, where the call `g("a")` fails)
   * took 11.5 s for 3200 turns, against 0.7 s when only one cell failed.
   *
   * A number literal evaluates to itself, and under a numeric approximation
   * it does when `N()` answers the same object (a machine number, or a
   * big-number float already at the working precision; an exact rational
   * does not). A list or tuple of such elements evaluates to an equal node,
   * so the node itself is the answer. The general route evaluates every
   * element as a function expression and builds a new node: 25 ms for a list
   * of ten thousand points, paid at every use of a symbol that holds one —
   * the stored-value memo leaves a written-out list out on purpose — and
   * the new node starts with empty caches, so its type, 7 to 10 ms more for
   * that list, is computed again as well.
   *
   * The answer is computed once per node, in one walk of the elements: a
   * node's definition is bound when it is made canonical, and whether `N()`
   * of a number literal is that literal does not depend on the precision of
   * the engine. Any evaluation option other than `numericApproximation`
   * takes the general route.
   */
  _isLiteralData(options?: Partial<EvaluateOptions>): boolean {
    // A list that holds its numbers unboxed is data under every option, and
    // the walk below would read its operands, which boxes every number.
    if (this._numericStore !== undefined) return true;
    if (
      this._operator !== 'List' &&
      this._operator !== 'Tuple' &&
      this._operator !== 'Error'
    )
      return false;
    let numeric = false;
    if (options !== undefined)
      for (const k in options) {
        if (k !== 'numericApproximation') return false;
        numeric = options.numericApproximation === true;
      }
    if (this._literalData === undefined) {
      // The node must be bound to the LIBRARY's `List` or `Tuple`. A host can
      // declare an operator of its own under either name, with an `evaluate`
      // handler that answers something else, and that handler must run.
      let level: 0 | 1 | 2 =
        this.isCanonical && this._isBoundToLibraryDefinition() ? 2 : 0;
      if (this._operator === 'Error') {
        if (level !== 0 && !holdsOnlyData(this)) level = 0;
        this._literalData = level;
        return this._literalData >= (numeric ? 2 : 1);
      }
      for (const op of this._ops) {
        if (level === 0) break;
        if (isNumber(op)) {
          if (level === 2 && op.N() !== op) level = 1;
        } else if (op instanceof BoxedFunction) {
          // A list that holds its numbers unboxed is its own value under
          // every option, and asking it would box them.
          if (op._numericStore !== undefined) continue;
          op._isLiteralData();
          level = Math.min(level, op._literalData ?? 0) as 0 | 1 | 2;
        } else level = 0;
      }
      this._literalData = level;
    }
    return this._literalData >= (numeric ? 2 : 1);
  }

  /**
   * The INERT rule of the evaluate memo: an ordinary canonical function node
   * (not a lazy collection view, not a lazy head) evaluated on the
   * synchronous route under the default options takes the memo path of
   * `_memoizedLazyCollectionValue`, with the same key (generation, world
   * epoch, ambient scope, facts side, object dependencies), the same purity
   * and settled-only gates, and one store gate of its own
   * (`_storeLazyCollectionValue`): only a SYMBOLIC result that is not a
   * collection value is kept. A node that evaluates to a number or to a list
   * literal stores nothing — such a value is cheap to produce again and
   * would be retained for the node's lifetime.
   *
   * Why: a value that stayed symbolic — an inert `PointList` head whose
   * columns wait for a slider, an accessor read of it — was walked again on
   * every evaluation of an expression that held it, and the walk built a
   * fresh copy each time. A user function applied to its own result,
   * `f^k(P)`, whose body reads its argument four times, re-walked the
   * previous level four times per level: 1.9 s at depth 7 and out of heap at
   * depth 8 (Tycho ledger row 380, `neyret/51a4237846`, user ruling
   * 2026-10-17 that an already-evaluated inert tree at the same state
   * should cost nothing). With the memo each level walks the previous one
   * once: 0.45 s at depth 7, and the levels share one tree.
   *
   * Synchronous route only (see `evaluateAsync`): a node whose operator has
   * only an `evaluateAsync` handler stays inert on this route, and the
   * asynchronous route must run the handler rather than be served that
   * entry. A lazy head is left out as it is for a lazy collection view (the
   * `def.lazy` test): `Add` and `Multiply` carry the flag for their folding
   * canonical handlers, so the arithmetic skeleton around an inert node is
   * rebuilt while the inert nodes themselves answer from their memo. The
   * entry is always generation-keyed and the result is never primed as its
   * own value (`_lazyCollectionMemoKey`, `_storeLazyCollectionValue`): a
   * call with constant operands can read a free variable of its body, and a
   * handler's result is not an evaluated value.
   */
  private _isMemoizableInertEvaluation(
    options?: Partial<EvaluateOptions>
  ): boolean {
    if ((options?.materialization ?? false) !== false) return false;
    if ((options?.numericApproximation ?? false) !== false) return false;
    // A transient precision or angular-unit window
    // (`_withTransientPrecision`, `_withTransientAngularUnit`) changes what
    // a node evaluates to and advances no version the memo keys on, so the
    // memo is neither read nor written inside one, as the other value memos
    // do (`_atTransientConfiguration`): in a degree-mode engine `Sin(30)` is
    // `1/2`, and inside a radian window it stays `sin(30)`.
    if (this.engine._atTransientConfiguration) return false;
    if (!this.isCanonical) return false;
    const def = this.operatorDefinition;
    if (!def || def.lazy === true) return false;
    if (this.isLazyCollection) return false;
    return true;
  }

  /**
   * Is this node in the set Change 1 of
   * `docs/COLLECTIONS-MODEL.md` memoizes — a
   * lazy collection VIEW that reaches `_computeValue`'s generic operand walk
   * (step 4) and rebuilds an equivalent node on every call?
   *
   * The conditions are the plan's: canonical, a lazy collection, and the
   * definition NOT `lazy` (a def-lazy view — `Map`, `Filter`, … — has its
   * operands held by `holdMap`, so there is no repeat walk to eliminate).
   *
   * **The `evaluate`-handler exclusion is gone** (the plan's named follow-up,
   * "the over-threshold `Insert`/`DeleteAt`/`ReplaceAt`/`ChunkBy` blowup").
   * The operators it excluded — `Insert`, `DeleteAt`, `ReplaceAt`, `ChunkBy`,
   * `Partition`, `Repeat`, `SlidingWindow` — have handlers that merely DECLINE
   * past `MAX_SIZE_EAGER_COLLECTION`, landing on the very step-4 rebuild this
   * memo exists to stop repeating; an indexed-update loop past 100 elements
   * was the workload left unfixed. Admitting them is sound under the SAME key,
   * both when the handler declines and when it accepts: those handlers are
   * deterministic functions of their (evaluated) operands, so under an
   * unchanged (generation, epoch, scope) key a re-run would decline — or
   * materialize — identically, and any change to an operand's VALUE bumps the
   * generation and misses. That is also why the memo may be consulted BEFORE
   * the handler runs rather than only on the declined path: same key, same
   * verdict. (Impurity is excluded separately, by the purity gate in
   * `_lazyCollectionMemoKey`; a per-instance `isLazy` handler that answers
   * `false` — 2-ary `Repeat` — never reaches here at all.)
   *
   * Being a lazy view with an `evaluate` handler IS the conditional-handler
   * regime, so no other operator class is swept in by THIS rule; the regime
   * inventory is pinned in `test/compute-engine/lazy-collection-regimes.test.ts`.
   * The inert rule (`_isMemoizableInertEvaluation`) is the second rule of the
   * same memo, for ordinary nodes on the synchronous route only.
   *
   * DEFAULT options only: `materialization` selects step 3 and
   * `numericApproximation` step 3b, both of which return something other than
   * the step-4 rebuild. Every non-default combination takes today's path,
   * untouched and unmemoized. The same test gates the ASYNC entry point
   * (`_memoizedLazyCollectionValueAsync`), which shares this memo — the two
   * paths must agree on the eligibility of a lazy view, or one could serve
   * the other an entry it would not have made itself. The asynchronous route
   * never reads an entry stored for an ordinary node: it takes the memo path
   * only when this rule holds, and the inert rule is for the synchronous
   * route alone.
   *
   * One further exclusion, for RETENTION (see the retention contract on
   * `_memoizedLazyCollectionValue`): an operator with an `elementMemo`
   * (`Iterate`) whose instance is not a FINITE collection. The memo pins the
   * evaluated view forever, and that view's element cache grows with the
   * deepest access ever made — unbounded for an infinite collection, and
   * never released. Before the memo each `evaluate()` produced a transient
   * result whose element cache died with it; keeping that property is worth
   * more than memoizing an infinite view.
   */
  private _isMemoizableLazyCollection(
    options?: Partial<EvaluateOptions>,
    sharesSourceValues = false
  ): boolean {
    if ((options?.materialization ?? false) !== false) return false;
    if ((options?.numericApproximation ?? false) !== false) return false;
    // Not inside a transient configuration window: see the same test in
    // `_isMemoizableInertEvaluation`.
    if (this.engine._atTransientConfiguration) return false;
    if (!this.isCanonical) return false;
    const def = this.operatorDefinition;
    if (!def || def.lazy === true) return false;
    if (!this.isLazyCollection) return false;
    if (def.collection?.elementMemo === true) {
      // The finiteness of a view over an eager operand (`Join(src(1), [4])`)
      // is known only after the operand is evaluated. Called from
      // `evaluate()` or `evaluateAsync()`, the values that this read
      // computes are kept for the operand step of the same evaluation, which
      // then does not evaluate the operand again (`eager-source-values.ts`).
      const finite = sharesSourceValues
        ? readSharingEagerSourceValues(this, () => this.isFiniteCollection)
        : this.isFiniteCollection;
      if (finite !== true) return false;
    }
    return true;
  }

  /**
   * The memoized fall-through evaluation of a lazy collection view (Change 1
   * of `docs/COLLECTIONS-MODEL.md`), and of an ordinary node under the inert
   * rule (`_isMemoizableInertEvaluation`). The first
   * `evaluate()` runs today's walk byte-for-byte — it is load-bearing: it is
   * what resolves a symbol operand to its value and what performs an
   * effectful operand's effects. Only the REPEAT walks are eliminated.
   *
   * **Dual key, and why the constant one is the whole point.** `Assign` bumps
   * `ce._anyVersion`, and an accumulator (`xs := Append(xs, v)` in a loop)
   * assigns every iteration — a memo keyed only on the current generation is
   * invalidated by the loop's own writes and never hits, leaving the loop
   * quadratic. So, exactly the split `get type` uses: a node whose operands
   * are all constant and which is pure gets a generation-INDEPENDENT entry
   * (`generation: undefined`) — no value write can make it stale; everything
   * else gets a generation-gated entry, so `Append(xs, y)` still re-resolves
   * `y` after `y := …`. (`isConstant` on a function IS `ops.every(isConstant)
   * && isPure`, so the two tests below are that conjunction, spelled to keep
   * the purity gate explicit.)
   *
   * **Two axes the generation does not cover**, stamped alongside it:
   * - `_lazyValueEpoch` (`ce._worldVersion`), checked on BOTH kinds of
   *   entry. "Constant" means no value write can change it, not that nothing
   *   can: `ce.precision = …` runs `_reset()` and purges caches precisely
   *   because stored numeric content is now stale, and `assume`/`forget` and
   *   redefinitions move meaning the same way. The epoch is deliberately NOT
   *   bumped by value writes, so the accumulator's O(n) survives.
   * - `_lazyValueScope` (the ambient lexical scope), checked on the
   *   generation-gated entry only — the generation does not move when an
   *   already-populated scope is re-pushed, but the symbol operands of a
   *   non-constant entry resolve by name through that chain.
   *
   * **Retention.** A memo entry pins the evaluated view for the lifetime of
   * the node — and a lazy view is not a small object: an operator with an
   * `elementMemo` accumulates a per-instance element cache that grows with
   * the deepest access ever made. For a finite collection that is bounded by
   * the collection (and by `ELEMENT_MEMO_CAP`); for an INFINITE one it is
   * bounded by nothing, so such nodes are excluded from the memo entirely —
   * see `_isMemoizableLazyCollection`.
   *
   * **Purity gate.** An impure node is never memoized: `Append(xs, Random())`
   * must re-draw on every `evaluate()`.
   *
   * **Both directions, one gate.** The result `R` of the walk is a freshly
   * rebuilt node whose own memo is empty, and in an accumulator iteration
   * *k*'s `op1` is iteration *k−1*'s RESULT — produced, never evaluated — so
   * without priming `R`'s memo with `R` itself the loop stays O(n²).
   * `evaluate` is idempotent there: `R`'s operands are already evaluated.
   * Both writes share ONE gate — they happen only when the computation
   * settled without consuming a provisional (re-entrant) edge; a provisional
   * computation memoizes NEITHER direction, since self-priming a provisional
   * `R` would freeze a wrong value harder than today's no-cache behavior.
   *
   * **NOT the shared `cachedValue()` helper**, for the reason spelled out on
   * `_effects`: it stamps the generation BEFORE computing, so a re-entrant
   * read returns the previous generation's value as fresh — and a
   * self-referential binding (`xs := Append(xs, 1)`) is exactly the shape
   * that re-enters. Mechanics follow `_effectsOf` instead: in-flight marker,
   * stamp only AFTER a computation that consumed no provisional edge.
   */
  private _memoizedLazyCollectionValue(
    options?: Partial<EvaluateOptions>
  ): Expression {
    const hit = this._lazyCollectionMemoHit();
    if (hit !== undefined) return hit;

    const generation = this.engine._anyVersion;

    if (this._lazyValueInFlight) {
      // A re-entrant evaluate of this very node. Take today's uncached path —
      // unchanged behavior — and mark the pass so neither computation is
      // frozen.
      if (CACHE_STATS) recordCache('lazyValue', 'declineCycle');
      _lazyValueProvisionalReads += 1;
      return this._computeValue(options)();
    }

    // `CE_CACHE_STATS` only: the entry being replaced, for wasted-recompute
    // detection after the store below.
    const prevValue = CACHE_STATS ? this._value.value : null;
    const prevGeneration = this._value.generation;
    const prevEpoch = this._lazyValueEpoch;

    this._lazyValueInFlight = true;
    const before = _lazyValueProvisionalReads;
    const cyclesBefore = cycleDetectionCount();
    let result: Expression;
    // Collect the mutable-object field reads this evaluation performs, so the
    // entry can be dropped by a later store to any object it read. A throw
    // unwinds past the store below, so the collector is closed in the
    // `finally` and its contents are simply discarded — a failed computation
    // commits neither a value nor dependencies.
    beginObjectDeps();
    let objectDeps: ObjectDeps | undefined;
    try {
      result = this._computeValue(options)();
    } finally {
      this._lazyValueInFlight = false;
      objectDeps = endObjectDeps();
    }
    // The settled-only gate, on BOTH provisional channels: this memo's own
    // re-entrancy marker, and the symbol-binding cycle guard, whose
    // fail-closed answers are provisional in exactly the same way. A
    // self-referential binding (`xs := Append(xs, 1)`) travels the second
    // one: evaluated through the symbol it answers `[1]` (the inner
    // dereference fails closed), evaluated directly `[1, 1]` — freezing
    // either as the node's value would make the answer depend on which
    // route ran first.
    if (
      _lazyValueProvisionalReads !== before ||
      cycleDetectionCount() !== cyclesBefore
    ) {
      if (CACHE_STATS) recordCache('lazyValue', 'declineStore');
      return result;
    }

    this._storeLazyCollectionValue(result, generation, options, objectDeps);

    // `CE_CACHE_STATS` only: the read above was classified `missGeneration`
    // exactly when a same-epoch, generation-keyed entry was present; if the
    // recompute reproduced it, the invalidation was spurious.
    if (
      CACHE_STATS &&
      prevValue !== null &&
      prevEpoch === this.engine._worldVersion &&
      prevGeneration !== undefined &&
      prevGeneration !== generation &&
      result.isSame(prevValue)
    )
      recordCache('lazyValue', 'missGenerationWasted');

    return result;
  }

  /** The memo READ of {@link _memoizedLazyCollectionValue}, shared with its
   * async twin. No key is computed: whatever is in the slot was stamped with
   * a key that is correct for it — an entry with no generation is one that no
   * value write can invalidate, a generation-gated entry is valid for that
   * generation and that resolution environment only. Both kinds expire at a
   * semantic epoch change. This keeps the hot path (a re-read of an
   * already-evaluated constant view) free of the purity/constancy walk.
   *
   * The suppression stamp is checked on BOTH kinds of entry — see
   * {@link _lazyValueFactsHidden}. */
  private _lazyCollectionMemoHit(): Expression | undefined {
    const factsHidden = this.engine._factsHidden();
    if (
      this._value.value !== null &&
      this._lazyValueEpoch === this.engine._worldVersion &&
      this._lazyValueFactsHidden === factsHidden &&
      (this._value.generation === undefined ||
        (this._value.generation === this.engine._anyVersion &&
          this._lazyValueScope === this.engine.context?.lexicalScope)) &&
      // A store to a mutable object advances no engine generation and no
      // epoch, so an entry whose value was derived from an object field
      // carries its own `(object, version)` stamps and is checked here.
      objectDepsValid(this._value.objectDeps)
    ) {
      // A hit reads nothing, so an enclosing cache-backed computation would
      // otherwise commit as if this value had no dependencies at all and go
      // on serving it after a store. Hand this entry's (just validated)
      // dependencies outward.
      mergeObjectDeps(this._value.objectDeps);
      if (CACHE_STATS)
        recordCache(
          'lazyValue',
          this._value.generation === undefined ? 'hitConstant' : 'hit'
        );
      return this._value.value;
    }
    if (CACHE_STATS) {
      if (this._value.value === null) recordCache('lazyValue', 'missCold');
      else if (this._lazyValueEpoch !== this.engine._worldVersion)
        recordCache('lazyValue', 'missEpoch');
      else if (this._lazyValueFactsHidden !== factsHidden)
        // The entry answers the other side of a fact-suppression window.
        // Counted with the epoch misses: both are a change of what the engine
        // shows the computation, not a change of a value.
        recordCache('lazyValue', 'missEpoch');
      else if (this._value.generation !== this.engine._anyVersion)
        recordCache('lazyValue', 'missGeneration');
      else recordCache('lazyValue', 'missScope');
    }
    return undefined;
  }

  /** The memo WRITE of {@link _memoizedLazyCollectionValue} — both directions
   * — shared with its async twin. The caller has already cleared the
   * settled-only gate; `generation` is the one observed BEFORE the walk. */
  private _storeLazyCollectionValue(
    result: Expression,
    generation: number,
    options?: Partial<EvaluateOptions>,
    objectDeps?: ObjectDeps
  ): void {
    // The inert rule (`_isMemoizableInertEvaluation`) keeps a SYMBOLIC
    // result only: a function node that is not a collection value. A number
    // or a list literal is cheap to produce again and would be retained for
    // the node's lifetime. Tested first: it is a few field reads, where the
    // object walk below is a traversal of the result.
    if (
      !this.isLazyCollection &&
      !(result instanceof BoxedFunction && result.isCollection !== true)
    ) {
      if (CACHE_STATS) recordCache('lazyValue', 'declineStore');
      return;
    }
    // A payload that transitively holds a mutable object is never memoized:
    // the entry would keep that object alive for the node's lifetime (ruling
    // B12), and the object's own contents are not part of what the version
    // stamps validate. This covers the self-priming write below too, which is
    // why the check sits ahead of both.
    if (containsObject(result)) {
      if (CACHE_STATS) recordCache('lazyValue', 'declineStore');
      return;
    }
    const key = this._lazyCollectionMemoKey(generation);
    if (CACHE_STATS && key === false) recordCache('lazyValue', 'declineStore');
    if (key !== false) {
      this._value.generation = key;
      this._value.value = result;
      this._value.objectDeps = objectDeps;
      // Sampled AFTER the walk, like the element memo's stamp: a bump the
      // walk itself caused (signature inference) is absorbed rather than
      // making the entry born stale.
      this._lazyValueEpoch = this.engine._worldVersion;
      this._lazyValueScope = this.engine.context?.lexicalScope;
      // Which side of a fact-suppression window this walk ran on. Sampled
      // here rather than before the walk: a walk that raised the depth itself
      // has lowered it again by now, so what is recorded is the state the
      // result belongs to.
      this._lazyValueFactsHidden = this.engine._factsHidden();
    }

    // Prime the result's own memo with itself — but only with the
    // generation-INDEPENDENT key. `R` was produced, never evaluated, so the
    // priming asserts idempotence rather than observing it; that assertion is
    // sound exactly when nothing can make `R` stale (its operands are all
    // constant and it is pure), which is also the only case the accumulator
    // needs. Priming a generation-keyed `R` would freeze a guess about a node
    // whose value depends on mutable state — the self-referential binding
    // `xs := Append(xs, 1)`, whose `R` is a live view of `xs` and does NOT
    // evaluate to itself.
    if (result !== this && result instanceof BoxedFunction) {
      // A result of the inert rule is NOT primed: an evaluate handler returns
      // its expression without evaluating it, so `f(1)` whose handler answers
      // `g(1)` would freeze `g(1)` as its own value where `g(1)` evaluates
      // to `2`. Only a result that is itself a constant lazy view is primed,
      // as before.
      if (
        result._value.value === null &&
        result._isMemoizableLazyCollection(options) &&
        result._lazyCollectionMemoKey(generation) === undefined
      ) {
        result._value.generation = undefined;
        result._value.value = result;
        // Same epoch axis as the write above; no scope stamp is needed for a
        // constant entry, which resolves no symbol through the ambient chain.
        result._lazyValueEpoch = this.engine._worldVersion;
        // The suppression stamp IS needed: it guards the constant entry too.
        result._lazyValueFactsHidden = this.engine._factsHidden();
      }
    }
  }

  /** The memo key of {@link _memoizedLazyCollectionValue}: `undefined` for a
   * constant, pure lazy collection view (no value write can make it stale —
   * the epoch axis still applies), the generation otherwise (always, for a
   * node under the inert rule), or `false` when the node is impure and must
   * not be memoized at all. */
  private _lazyCollectionMemoKey(
    generation: number
  ): number | undefined | false {
    if (!this.isPure) return false;
    // The inert rule (`_isMemoizableInertEvaluation`) never takes the
    // constant key: constant OPERANDS do not make the evaluation of an
    // ordinary node constant. A user function applied to a literal,
    // `f(1)` with `f(u) = u + x`, reads the free `x` of its body, and a
    // value write advances the generation, not the world epoch, so a
    // constant entry answered `x + 1` after `x := 2`. The generation key
    // follows the write. The constant key is kept for a lazy collection
    // view, whose accumulator loop depends on it (see the memo's comment).
    if (!this.isLazyCollection) return generation;
    return this._ops.every((x) => x.isConstant) ? undefined : generation;
  }

  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<Expression> {
    // Same as `evaluate()`: a store-backed list is its own value.
    if (this._numericStore !== undefined) return Promise.resolve(this);
    // Checkpoint quiescence (`checkpoint.ts`): an async evaluation suspended
    // at an `await` holds its eval context across the suspension and hands
    // control back to the host, so — unlike a synchronous evaluation, which
    // the host simply cannot interleave a call with — it is invisible to the
    // eval-context depth check. Counting it is what lets `checkpoint()` and
    // `restore()` refuse rather than rewind state an evaluation is still
    // standing on. Decremented in a `finally` on the promise, so a rejection
    // does not strand the count.
    // Host capabilities (`ce.effects`): an asynchronous evaluation captures
    // the registry when it starts and carries it in its options, which every
    // nested `evaluateAsync(options)` call receives. An engine field cannot
    // hold it: while this evaluation is suspended at an `await`, another one
    // may run on the same engine with a different registry. A synchronous
    // evaluation that is already running (this call comes from one of its
    // handlers) passes its own registry on.
    //
    // The evaluation-context stack (`EvaluateOptions._contextStack`), which
    // holds the scopes of the scoped operators the evaluation is inside,
    // travels the same way. A call without one captures a copy of the
    // engine's stack as it is now: for a call from the host, of the engine's
    // own array; for a call from the synchronous part of a handler
    // (`ce.box(…).evaluateAsync()` with no options), of the stack of the
    // enclosing evaluation, which then holds the scope of its index. Without
    // this capture, the nested evaluation saw that scope only until its
    // first `await`.
    //
    // A call that receives the stack of a pending asynchronous evaluation in
    // its options is a part of that evaluation, and uses that array. Any
    // other call starts a new asynchronous evaluation, on its own copy of
    // the stack (`beginAsyncEvaluation`, `evaluation-epoch.ts`): the copy
    // carries the number of the evaluation, which the sticky rule of an
    // unresolved call and the runs of a `Block` read, and the counts that
    // tell whether a `Block` is a program (`runsAsProgram()`,
    // `library/control-structures.ts`). So the number of this evaluation
    // does not depend on other evaluations that run at the same time. An
    // evaluation that pushes a frame it holds across an `await` (a scoped
    // operator, step 4 of the asynchronous driver) pushes it on a copy of
    // its own stack, which carries the same number (`copyContextStack`).
    let evaluation = asyncEvaluationOf(options?._contextStack);
    let contextStack = options?._contextStack;
    if (evaluation === undefined)
      ({ stack: contextStack, evaluation } = beginAsyncEvaluation(
        this.engine,
        contextStack
      ));
    const effects =
      options?._effects ??
      this.engine._evaluationEffects ??
      this.engine.effects;
    // The precision window is captured the same way: an evaluation started
    // inside the window of a `N(x, p)` call (a user handler that passes its
    // operand to `evaluateAsync` with options of its own) runs its later
    // slices inside that window too (`EvaluateOptions._precisionWindow`).
    if (
      options?._effects === undefined ||
      options._contextStack !== contextStack ||
      (options._precisionWindow === undefined &&
        (this.engine._atTransientPrecision ||
          this.engine._requestedPrecision !== undefined))
    )
      options = {
        ...options,
        _effects: effects,
        _contextStack: contextStack,
        _precisionWindow:
          options?._precisionWindow ?? capturedPrecisionWindow(this.engine),
      };
    this.engine._inFlightAsyncEvaluations += 1;
    evaluation.pending += 1;
    let promise: Promise<Expression>;
    try {
      // The driver runs synchronously up to its first `await`, and that
      // part evaluates synchronously in places — the application of a
      // user-defined function, the materialization of a collection. Publish
      // the captured registry in the engine slot for that part, so those
      // evaluations inherit it; the slot is restored when the driver first
      // suspends (`runWithEvaluationEffects` returns when the promise is
      // created, not when it settles).
      promise = runWithEvaluationEffects(
        this.engine,
        effects,
        () => this._evaluateAsyncUncounted(options),
        options._contextStack,
        options._precisionWindow
      );
    } catch (error) {
      this.engine._inFlightAsyncEvaluations -= 1;
      evaluation.pending -= 1;
      releaseKeptEagerSourceValues(this.engine);
      throw error;
    }
    return promise
      .then((result) => {
        recordEvaluatedError(this, result);
        return options?.numericApproximation
          ? indeterminateAsNaN(result)
          : result;
      })
      .finally(() => {
        this.engine._inFlightAsyncEvaluations -= 1;
        evaluation.pending -= 1;
        releaseKeptEagerSourceValues(this.engine);
      });
  }

  private _evaluateAsyncUncounted(
    options?: Partial<EvaluateOptions>
  ): Promise<Expression> {
    // As in `evaluate()`: a result of evaluating a call whose head had no
    // value, made in this top-level evaluation, evaluates its operands only
    // (`EVALUATED_UNRESOLVED_CALLS`), before `_canonicalToEvaluate()` can box
    // it again against a later definition of the name.
    if (isStickyUnresolvedCall(this))
      return evaluatedUnresolvedCallAsync(this, options);
    const canonical = this._canonicalToEvaluate();
    // The recursive delegations below re-enter the PUBLIC entry point, so a
    // nested evaluation is counted too — the check is "is any async
    // evaluation open", not "how many", and a balanced count is easier to
    // trust than a re-entrancy carve-out.
    if (canonical) return delegateEvaluationAsync(canonical, options);
    // A kept value of a pure eager source, as in `evaluate()`. The value was
    // computed by a synchronous evaluation, and `evaluate()` cannot run an
    // operator that has only an `evaluateAsync` handler: such an expression
    // is evaluated here.
    if (
      !options?.numericApproximation &&
      (options?.materialization ?? false) === false
    ) {
      const kept = keptEagerSourceValue(this);
      if (kept !== undefined && !hasAsyncOnlyApplication(this, true))
        return Promise.resolve(kept);
    }
    // The finiteness read of a view over an eager operand evaluates the
    // operand, as in `evaluate()`. Its values are taken out of the shared
    // store in the `finally` below, before the first `await`, and are given
    // to the operand step of this evaluation only: while this evaluation
    // waits, other evaluations run on the same engine and use the shared
    // store. Taking them out in a `finally` also clears the shared store when
    // the read throws.
    let memoizable: boolean;
    let sourceValues: EagerSourceValues | undefined;
    try {
      // The inert rule (`_isMemoizableInertEvaluation`) is for the
      // synchronous route only: a node whose operator has only an
      // `evaluateAsync` handler stays inert on that route, and the entry it
      // stores must not be served here in place of running the handler.
      memoizable = this._isMemoizableLazyCollection(options, true);
    } finally {
      sourceValues = detachEagerSourceValues(this);
    }
    const result = memoizable
      ? this._memoizedLazyCollectionValueAsync(options, sourceValues)
      : this._computeValueAsync(options, sourceValues)();
    // A value that the operand step did not use (the evaluation was
    // cancelled, threw, or found its value in the memo) is discarded when
    // the evaluation ends.
    return sourceValues === undefined
      ? result
      : result.finally(() => sourceValues.clear());
  }

  /**
   * The async twin of {@link _memoizedLazyCollectionValue} — the "Async"
   * follow-up of
   * `docs/COLLECTIONS-MODEL.md`. It is the SAME
   * memo, not a parallel one: a settled entry written by `evaluate()` is a
   * valid async hit and vice versa, under the same eligibility test, the same
   * dual key, and the same epoch/scope/settled/purity gates.
   *
   * What async adds:
   * - **An in-flight promise slot.** Concurrent `evaluateAsync()` calls on the
   *   same node share one walk. The slot must be installed BEFORE the walk
   *   starts, not when the call returns: `_computeValueAsync`'s synchronous
   *   prefix runs the whole operand walk whenever no operand actually
   *   suspends, so a second caller in the same tick would otherwise start a
   *   second walk. Hence the microtask hop.
   * - **Cancellation.** An aborted or rejected computation (an `AbortSignal`
   *   fired inside a handler, a `CancellationError`, any throw) memoizes
   *   NEITHER direction — the write below is only reached by a fulfilled walk
   *   — and clears the slot, so a later call recomputes. A canceled walk must
   *   never poison the memo.
   *
   * The settled-only gate samples its two provisional channels across
   * `await`s, so a cycle detected — or a provisional read taken — by ANY
   * evaluation interleaved with this one also suppresses the write. That is
   * fail-closed (no entry), never a wrong entry.
   */
  private _memoizedLazyCollectionValueAsync(
    options?: Partial<EvaluateOptions>,
    sourceValues?: EagerSourceValues
  ): Promise<Expression> {
    const hit = this._lazyCollectionMemoHit();
    if (hit !== undefined) return Promise.resolve(hit);

    if (this._lazyValuePending !== undefined) {
      const previous = this._lazyValuePendingOptions;
      // The context stacks are compared by their frames, not by identity:
      // each asynchronous evaluation has its own copy of the stack, with its
      // own top-level evaluation number (`beginAsyncEvaluation`,
      // `evaluation-epoch.ts`). So a caller of another evaluation joins the
      // walk, and receives a value computed under the number of the first
      // caller. This is the same as a hit in the settled memo, which also
      // gives a value computed by an earlier evaluation: only a walk that
      // passed the eligibility test of the memo (a pure lazy collection)
      // gets here, and its value does not depend on the evaluation number.
      if (
        previous?.signal === options?.signal &&
        previous?._effects === options?._effects &&
        sameContextFrames(previous?._contextStack, options?._contextStack) &&
        previous?._precisionWindow?.working ===
          options?._precisionWindow?.working &&
        previous?._precisionWindow?.requested ===
          options?._precisionWindow?.requested &&
        this._lazyValuePendingGeneration === this.engine._anyVersion &&
        this._lazyValuePendingEpoch === this.engine._worldVersion
      )
        return this._lazyValuePending;
      // Each caller owns its cancellation and resolution environment. A
      // different caller must not join a walk that captured someone else's.
      return Promise.resolve().then(() =>
        this.engine.withEvaluationContext(options, () =>
          this._settledLazyCollectionValueAsync(options, sourceValues)
        )
      );
    }

    const pending: Promise<Expression> = Promise.resolve()
      .then(() =>
        this.engine.withEvaluationContext(options, () =>
          this._settledLazyCollectionValueAsync(options, sourceValues)
        )
      )
      .finally(() => {
        if (this._lazyValuePending === pending) {
          this._lazyValuePending = undefined;
          this._lazyValuePendingOptions = undefined;
          this._lazyValuePendingGeneration = undefined;
          this._lazyValuePendingEpoch = undefined;
        }
      });
    this._lazyValuePending = pending;
    this._lazyValuePendingOptions = options;
    this._lazyValuePendingGeneration = this.engine._anyVersion;
    this._lazyValuePendingEpoch = this.engine._worldVersion;
    return pending;
  }

  /** The walk + settled-only gate + memo write of
   * {@link _memoizedLazyCollectionValueAsync}. Mirrors the sync body, minus
   * the `_lazyValueInFlight` marker: a re-entrant read of this node arrives on
   * the SYNC path (see `_lazyValuePending`), where that marker lives. */
  private async _settledLazyCollectionValueAsync(
    options?: Partial<EvaluateOptions>,
    sourceValues?: EagerSourceValues
  ): Promise<Expression> {
    // A synchronous `evaluate()` may have filled the memo while this
    // computation waited for its microtask — it ignores the pending slot by
    // design, and its entry is as valid here as one of our own.
    const hit = this._lazyCollectionMemoHit();
    if (hit !== undefined) return hit;

    const generation = this.engine._anyVersion;
    const before = _lazyValueProvisionalReads;
    const cyclesBefore = cycleDetectionCount();
    // The object-dependency collector cannot be used here: it brackets a
    // dynamic extent of the host call stack, and every `await` below breaks
    // that extent. This path therefore SAMPLES the global field-read counter
    // instead and declines to memoize at all if any object field was read
    // while it ran — the same fail-closed sampling the two provisional
    // channels beside it use, and for the same reason: no entry is always
    // safe, a dependency-free entry derived from a field is not.
    const objectReadsBefore = objectReadCount();

    const result = await this._computeValueAsync(options, sourceValues)();

    if (
      _lazyValueProvisionalReads !== before ||
      cycleDetectionCount() !== cyclesBefore ||
      objectReadCount() !== objectReadsBefore
    ) {
      if (CACHE_STATS) recordCache('lazyValue', 'declineStore');
      return result;
    }

    this.engine.withEvaluationContext(options, () =>
      this._storeLazyCollectionValue(result, generation, options)
    );

    return result;
  }

  /**
   * `evaluate()` yields a canonical value: an expression that is not
   * canonical must therefore evaluate to the same value as its canonical
   * form. Structural and raw trees have not run canonicalization, so the
   * work canonicalization does — resolving parse sugar, and above all
   * declaring the bound variables of a binder (`Sum`, `Product`,
   * `Integrate`, …) in its local scope — has not happened. Evaluating them
   * in place either does nothing (a raw tree has no definition to dispatch
   * to) or, for a binder, silently computes a DIFFERENT value from an
   * unbound index. Route them through the canonical form instead.
   *
   * Returns the expression to evaluate in our place, or `undefined` to
   * evaluate this expression directly.
   *
   * Canonicalization is not guaranteed to produce a canonical expression:
   * an invalid tree canonicalizes to itself, and an operator whose canonical
   * handler declines can hand back another non-canonical node. Requiring
   * `isCanonical` of the result (not merely a different node) is what keeps
   * this from recursing forever.
   */
  private _canonicalToEvaluate(): Expression | undefined {
    // A call that its callee refused when it was boxed is evaluated with the
    // function that the name holds now, at the top of the expression or in
    // an operand at any depth (`_recheckedTree()`).
    if (!this.isValid) {
      const rechecked = this._recheckedTree();
      if (rechecked !== this) return rechecked;
    } else {
      // A call that its callee accepted, when the definition of the name
      // changed after the call was boxed, is evaluated as the same call
      // boxed against the definition as it is now (`_reboxedForCallee()`):
      // the new function can refuse the operands, or give other parameter
      // names to the named arguments.
      const reboxed = this._reboxedForCallee();
      if (reboxed !== undefined) return reboxed;
    }
    // Only the two non-canonical TIERS are routed. `isCanonical` is false for
    // a third shape — an expression that WAS canonicalized but whose operator
    // has no definition (`_def === undefined`) — and re-canonicalizing that
    // one would rebuild the identical tree on every single `evaluate()` call
    // (a 4x slowdown of the compilation and factorization paths, which
    // evaluate definition-less nodes in a loop).
    if (this._def !== null && !this._isStructural) return undefined;
    const canonical = this.canonical;
    return canonical.isCanonical ? canonical : undefined;
  }

  N(): Expression {
    // `evaluate()` maps an `Indeterminate` result to `NaN` under a numeric
    // approximation (`indeterminateAsNaN()`).
    return this.evaluate({ numericApproximation: true });
  }

  solve(
    vars?: Iterable<string> | string | Expression | Iterable<Expression>
  ):
    | null
    | ReadonlyArray<Expression>
    | Record<string, Expression>
    | Array<Record<string, Expression>> {
    // An equation that holds a residue class is not solved (see
    // `evaluateSolve()`): `null`, as for any equation the solver cannot
    // solve, and not an empty list of roots.
    if (containsResidueClass(this)) return null;

    const varNames = normalizedUnknownsForSolve(vars ?? this.unknowns);

    // Handle List or And of equations (system of equations)
    if (this.operator === 'List' || this.operator === 'And') {
      const result = solveSystem(this.engine, this.ops, varNames);
      if (result !== null) return result;
    }

    // Handle Or: solve each operand independently, merge results
    if (this.operator === 'Or') {
      return solveOr(this.ops, varNames);
    }

    // Existing univariate solving
    if (varNames.length !== 1) return null;

    // Linear congruence `Congruent(lhs, rhs, m)` in one unknown: emit the
    // parametric residue family. Decline (undefined) falls through to the
    // ordinary root finder.
    if (this.operator === 'Congruent') {
      const congruenceRoots = solveCongruence(this.engine, this, varNames[0]);
      if (congruenceRoots !== undefined)
        return filterRootsByAssumptions(
          this.engine,
          congruenceRoots,
          varNames[0]
        );
    }

    // A list of roots that is only a part of the roots is not an answer:
    // `null`, as for an equation the solver cannot solve. This is the case
    // when the unknown is in a function that the root finder cannot invert
    // and that is not periodic (`(x - 1)·BesselJ(0, x) = 0` gives only `1`),
    // and when a factor of a product gives no root and is not shown to have
    // none (`(x - 2)(x + e^x) = 0` gives only `2`). A root template that the
    // host added to `ce.solveRules` is accepted. See
    // `partialRootListReason()`.
    const stats = { candidates: false, undecided: false };
    const roots = findUnivariateRoots(this, varNames[0], 0, undefined, stats);
    if (roots === null) return null;
    if (partialRootListReason(this, varNames[0], roots, stats) !== undefined)
      return null;
    // Route in-scope bound assumptions on the unknown through the same root
    // filter the domain pipeline uses: `assume(n > 0)` should drop the negative
    // root of `n^2 = 16`. Applied at this OUTER boundary (not inside the
    // recursive `findUnivariateRoots`, which re-enters with substituted
    // variables) so both `expr.solve('n')` and the `Solve` operator benefit.
    const kept = filterRootsByAssumptions(this.engine, roots, varNames[0]);
    // One root of each family of a periodic equation: `sin(x) = -1` gives
    // `-π/2` and not also `3π/2` (`withoutPeriodicDuplicates()`).
    if (kept.length > 0)
      return withoutPeriodicDuplicates(this.engine, this, varNames[0], kept);
    // An empty list states that there is no root. It is the answer only when
    // the `Solve` operator gives it too (`emptyRootsAnswer()`): `e^x = x + 2`
    // has roots that the root finder cannot find, and the answer is `null`.
    // An identity (`x = x`) gives a list with one free parameter.
    const answer = emptyRootsAnswer(
      this.engine,
      this,
      varNames[0],
      stats,
      false
    );
    return answer === undefined ? null : isFunction(answer) ? answer.ops : [];
  }

  get isCollection(): boolean {
    // An invalid tree is not a collection, except a `List` or `Set` literal
    // that holds a failed cell, and a collection operator whose only errors
    // sit in the cells of such literals (`isInvalidNonCollection()`): a walk
    // of their elements gives the failed cell as the value of that element.
    if (isInvalidNonCollection(this)) return false;
    const def = this.baseDefinition?.collection;

    // A collection has at least a count handler and an iterator
    console.assert(
      !def || (def.count !== undefined && def.iterator !== undefined)
    );

    if (def === undefined) return false;
    // An operator whose collection-ness depends on its operands (e.g. `When`,
    // a collection only when the value it guards is one) opts out per-instance.
    return def.isCollection?.(this) ?? true;
  }

  /**
   * True if this instance explicitly opted out of being a collection via an
   * `isCollection` handler returning false (e.g. a `Tuple`-valued `When`).
   * Its remaining collection handlers are inert and must not be consulted.
   *
   * Note this is deliberately narrower than `!isCollection`: an *eager*
   * collection operator (e.g. `UnicodeScalars`) has no collection handlers at
   * all until it is evaluated, and must still go through the
   * materialize-then-iterate path in `each()`.
   */
  private get _optedOutOfCollection(): boolean {
    return this.baseDefinition?.collection?.isCollection?.(this) === false;
  }

  get isIndexedCollection(): boolean {
    if (isInvalidNonCollection(this)) return false;
    const def = this.baseDefinition?.collection;

    // If there is no `at` handler, it is definitely not indexed
    if (!def?.at) return false;

    // An operator that opted out of being a collection for THIS instance is
    // not an indexed collection either — the handlers are present but inert,
    // and reporting otherwise contradicts `isCollection` (e.g. a `Tuple`-
    // valued `When`, which is deliberately not broadcast over).
    if (this._optedOutOfCollection) return false;

    // If there is an `at` handler, it _may_ be indexed.
    // We check the actual result type, e.g. Map has an at handler
    // (to access its keys), but can be indexed or not, depending on the
    // input collection.
    //
    // The type is read WITH its absence arm, so a restricted list,
    // `[1,2]{c}`, typed `missing | vector<integer^2>` and held as one `When`
    // while its condition is undecided (user decision 2026-09-25), answers
    // `false` here although it enumerates its cells (`isCollection` is
    // `true`). That is deliberate: the broadcast machinery decides what to
    // map over cell by cell through this predicate
    // (`isFiniteBroadcastParticipant`), and a conditional value must be
    // threaded WHOLE instead (`threadConditional`): `Sin([1,2,3]{0<t})` is
    // `[sin 1, sin 2, sin 3]{0<t}`, `Missing` once `t = -1`, where a
    // cell-by-cell map gave `[NaN, NaN, NaN]`.
    if (this.type.matches('indexed_collection<any>')) return true;

    // An ABSTRACT collection type (`collection<T>`: not indexed, not a set,
    // not keyed) does not decide the kind of the value, it only admits
    // several kinds. A kind-preserving operator (`Map`, `Filter`, `Scan`)
    // reports that type over a symbol DECLARED `collection<T>`, and such a
    // symbol can hold a list, a set or a range. The answer then follows the
    // values the operands hold now, the same way a symbol answers from its
    // value (`BoxedSymbol.isIndexedCollection`): the node is indexed when
    // every collection operand holds an indexed value. This is what makes
    // `Map(x -> 2x, P)`, with `P` declared `collection<number>` and holding
    // `[3, 1, 1]`, materialize as the list `[6, 2, 2]` (order and duplicates
    // kept) and take part in a broadcast (`Map(x -> 2x, P) + 1`), where it
    // used to materialize as `Set(6, 2)`. With `P` holding a set, the answer
    // stays `false` and the result is a set. The static type is not changed:
    // it stays `collection<T>`, a supertype of every kind `P` may hold.
    //
    // Canonicalization and type derivation read this predicate too (the
    // `indexed` fact of an operand descriptor, the `Subscript` to `At`
    // rewrite, the lone-operand rule of `Add`), so for such a node they
    // follow the value the source holds when they run, exactly as they
    // already do for a bare symbol declared `collection<T>`. That value
    // dependence is the symbol's contract extended to the lazy nodes built
    // over it, not an oversight.
    return (
      isAbstractCollectionType(this.type) &&
      abstractSourcesHoldIndexedValues(this)
    );
  }

  get isLazyCollection(): boolean {
    if (isInvalidNonCollection(this)) return false;
    if (this._optedOutOfCollection) return false;
    return this.baseDefinition?.collection?.isLazy?.(this) ?? false;
  }

  contains(rhs: Expression): boolean | undefined {
    if (this._optedOutOfCollection) return undefined;
    // A handler that walks the collection (the `contains` of `Take` or
    // `Filter`) can meet an inner collection that it cannot walk: its
    // `false` misses those elements, and its `true` can come from an element
    // that is not one (the iterator of `FlatMap` gives a valueless symbol of
    // a list type as one element). The answer is then not known (see
    // `unlessWalkMissedElements()`).
    return unlessWalkMissedElements(() =>
      this.baseDefinition?.collection?.contains?.(this, rhs)
    );
  }

  /**
   * Memoized computation of a nullary collection facet (`count`, `isEmpty`,
   * `isFinite`) — the fix for the canonicalization-time facet-probe storm
   * (Tycho item 182). These facets are *queries*: the engine already assumes
   * a repeated read at the same state returns the same answer (callers
   * double-read them freely), yet the handlers behind them can be arbitrarily
   * expensive — a `Range(0, Length(D)-1)` count probe numerically evaluates
   * its bound, which for a comprehension-valued `D` re-scans the
   * comprehension's clause domains on EVERY probe. One document-open was
   * measured at 210K such probes (84% of the whole open), and without a
   * deadline the cascade's allocation churn exhausts a 4 GB heap.
   *
   * Invalidation is DEPENDENCY-PRECISE, riding the element memo's machinery
   * (`snapshotMemoDeps`/`memoDepsStillValid`,
   * `docs/COLLECTIONS-MODEL.md`): an
   * entry is valid while `ce._worldVersion` is unmoved (assume/forget,
   * redefinition, configuration) AND every free-symbol dependency still has
   * the same inner definition, `_writeVersion`, and name resolution. A
   * `ce._anyVersion` ("generation") key was tried first and REFUTED by
   * measurement (2026-08-14): the probe cascade itself constructs broadcast
   * lambdas, and each construction's parameter declare plus its now-dirty
   * scope pop advance `any` (~104K bumps in one 5 s parse) — a
   * generation-keyed entry was invalidated by the very computation it
   * cached, the fourth instance of the self-invalidation class (after
   * inference{valueType}, the 2^depth shape-query double-read, and item
   * 181's clean pops). Unrelated declares move NO dependency, so this memo
   * is immune; a shadowing declare of a name the computation resolves is
   * caught by the per-dependency resolution re-check.
   *
   * No purity gate, deliberately: an impure node's VALUE is nondeterministic
   * by contract (`Random()` re-draws), but its facets are shape queries, and
   * the element memo already applies to impure instances by ruling
   * (`docs/RANDOMNESS-MODEL.md` §6 — repeated reads of one instance are one
   * draw set). Requiring purity would exclude exactly the instances the
   * storm hammers (a comprehension whose BODY calls user functions is impure
   * even when its clause domains are pure).
   *
   * Settled-only store, like the lazy-collection value memo: a computation
   * that consumed a provisional answer — a symbol-binding cycle edge
   * (`cycleDetectionCount`, which every `BoxedSymbol` facet delegation
   * routes through), or a re-entrant lazy-collection evaluate
   * (`_lazyValueProvisionalReads`) — is returned uncached. An instance
   * `snapshotMemoDeps` deems ineligible (a dependency no version tracks) is
   * simply never stored — recomputed per read, exactly today's behavior. A
   * deadline/timeout cancellation THROWS through this helper, so nothing
   * partial is ever stored.
   */
  private _memoizedFacet<T extends number | bigint | boolean | undefined>(
    facet: 'count' | 'isEmpty' | 'isFinite',
    compute: () => T
  ): T {
    const ce = this.engine;
    const factsHidden = ce._factsHidden();
    const slot = this._facetMemo;
    if (
      slot !== undefined &&
      slot.worldVersion === ce._worldVersion &&
      slot.factsHidden === factsHidden
    ) {
      const entry = slot[facet] as FacetEntry<T> | undefined;
      if (entry !== undefined) {
        // A store to a mutable object moves neither `_worldVersion` nor any
        // symbol dependency, so a facet answer derived from a field carries
        // its own `(object, version)` stamps and is checked here; serving it
        // also hands those stamps to any enclosing collector, since a hit
        // performs no reads of its own.
        if (
          memoDepsStillValid(this, slot.deps) &&
          objectDepsValid(entry.objectDeps)
        ) {
          mergeObjectDeps(entry.objectDeps);
          if (CACHE_STATS) recordCache('collectionFacet', 'hit');
          return entry.value;
        }
        if (CACHE_STATS) recordCache('collectionFacet', 'missDependency');
      } else if (CACHE_STATS) recordCache('collectionFacet', 'missCold');
    } else if (CACHE_STATS) {
      recordCache(
        'collectionFacet',
        slot === undefined ? 'missCold' : 'missEpoch'
      );
    }

    const cyclesBefore = cycleDetectionCount();
    const provisionalBefore = _lazyValueProvisionalReads;
    const iterationBreachesBefore = iterationLimitCancellationCount();
    const incompleteWalksBefore = incompleteWalkCount();
    _facetComputeCount += 1;
    // A facet answer is a number or a boolean, so it can never CONTAIN an
    // object; it can perfectly well be DERIVED from one's fields, though
    // (`Count(p.friends)`), which is what the collector records. A `compute()`
    // that throws (a deadline cancellation) unwinds past every store below,
    // so the collector is closed in the `finally` and discarded.
    beginObjectDeps();
    let value: T;
    let objectDeps: ObjectDeps | undefined;
    try {
      value = compute();
    } finally {
      objectDeps = endObjectDeps();
    }
    // A computation that walked the collection (the `isEmpty` of `Filter`
    // reads a first element) and met an inner collection that it cannot
    // walk has no answer: the walk missed elements, and an element that it
    // gave can be a valueless symbol of a list type (see
    // `incomplete-walks.ts`). The answer is not known, and it is not stored.
    if (incompleteWalkCount() !== incompleteWalksBefore) {
      if (CACHE_STATS) recordCache('collectionFacet', 'declineCycle');
      return undefined as T;
    }
    if (
      cycleDetectionCount() !== cyclesBefore ||
      _lazyValueProvisionalReads !== provisionalBefore ||
      // A computation that gave up on `engine.iterationLimit` (the
      // `countOrUndefinedOnIterationLimit`-style handlers convert the
      // cancellation to an "unknown" answer) is limit-DEGRADED: a raised
      // limit could produce a definite answer, and `iterationLimit` writes
      // advance no axis this memo's keys observe. Never frozen — recomputed
      // per read, which is exactly the pre-memo behavior for such answers.
      iterationLimitCancellationCount() !== iterationBreachesBefore
    ) {
      if (CACHE_STATS) recordCache('collectionFacet', 'declineCycle');
      return value;
    }

    // Stamp with the POST-compute world version and, when the existing
    // snapshot no longer holds (or none exists), a POST-compute dependency
    // snapshot: a bump or self-write the computation itself performed (a
    // dependent comprehension count installs its own index values while
    // enumerating) is absorbed rather than making the entry born-stale —
    // the element memo's commit discipline.
    const world = ce._worldVersion;
    let target = this._facetMemo;
    if (
      target === undefined ||
      target.worldVersion !== world ||
      target.factsHidden !== factsHidden ||
      !memoDepsStillValid(this, target.deps)
    ) {
      const deps = snapshotMemoDeps(this);
      if (deps === undefined) {
        // Ineligible (a dependency no version tracks): never stored.
        if (CACHE_STATS) recordCache('collectionFacet', 'declineStore');
        return value;
      }
      target = { worldVersion: world, factsHidden, deps };
      this._facetMemo = target;
    }
    // The (facet → T) pairing is maintained by the three call sites (`count`
    // is the only `number`-valued facet), which the keyed slot type cannot
    // express generically — hence the `unknown` hop.
    (target as unknown as Record<typeof facet, FacetEntry<T>>)[facet] = {
      value,
      objectDeps,
    };
    return value;
  }

  get count(): number | bigint | undefined {
    if (this._optedOutOfCollection) return undefined;
    return this._memoizedFacet('count', () => {
      // A DECLARED count handler owns the answer, including its `undefined`.
      // `normalizeCount()` converts a `bigint` count that is a safe integer
      // to a `number`, so a `bigint` reaches readers only for a count that a
      // `number` cannot hold exactly.
      const handler = this.operatorDefinition?.collection?.count;
      if (handler !== undefined) return normalizeCount(handler(this));
      // An EAGER producer with no collection handlers may still know its own
      // length without evaluating (`Sort` preserves its source's, `Chunk`
      // answers `k`) — the `count` twin of `canEnumerate`. It owns the answer,
      // including its `undefined`.
      const elementCount = this.operatorDefinition?.elementCount;
      if (elementCount !== undefined) return elementCount(this);
      // Deliberately NOT falling back to the declared type here, the way a
      // SYMBOL's `count` does. An application's collection type can be an
      // artifact of the vacuous lift rather than a promise: `Total([1, 2])`
      // with `Total` undeclared types `list<unknown^2>` on a bare engine, yet
      // `each()` provably walks nothing, and a bound head with a genuinely
      // sized return (`L(1)` under `L: (number) -> vector<2>`) is not
      // distinguishable from it at this point — both have no operator
      // definition and both auto-declare their head. Reporting 2 for the
      // first is `count` outrunning the walk — promising elements that `at()`
      // cannot deliver — which is settled as `undefined`; the invariant is
      // pinned by `test/compute-engine/tycho-item-167-broadcast-count.test.ts`
      // ("count does not outrun the walk"). A declared SYMBOL has no such
      // ambiguity: its type is the user's own declaration.
      return this._broadcastCount();
    });
  }

  /**
   * The element count of an un-evaluated arithmetic BROADCAST, read from the
   * operands instead of by materializing (Tycho item 167).
   *
   * The broadcasting arithmetic operators (`Add`, `Multiply`, …) carry no
   * collection handlers — broadcasting is not a collection operator, it is a
   * property of how they evaluate — so `count` was `undefined` for `[1,2,3]+1`
   * even though the type says `vector<integer^3>`, and for
   * `2(1..99)/99-1` even though the `Range` inside it reports 99. A caller that
   * wants to prove finiteness before deciding whether to evaluate (a
   * comprehension-domain guard, say) then had no way to do so short of the
   * eager walk it was trying to avoid.
   *
   * Reading the operands is exact here because the length rule for a LIFTED
   * operator is agreement, not zip-to-shortest (`docs/BROADCAST-MODEL.md`): a
   * scalar operand is a lift and never participates, and two participants of
   * different lengths are `incompatible-dimensions`, not a shorter result. So
   * the result length is the participants' common length — and when they
   * disagree, or any one of them is unknown, this reports `undefined` rather
   * than guessing.
   *
   * Deliberately NOT extended to `isCollection`/`isFiniteCollection`: those
   * report `false`/`undefined` for a `list<number>` by design, and
   * consumers rely on that. This answers the LENGTH question only.
   *
   * Gated on `broadcastable === true` (2026-08-12): agreement is the length
   * rule for a LIFTING operator only. Ungated, it answered the OPERANDS' length
   * for any bound, handler-less, collection-typed operator — so a RESHAPING
   * operator inherited its source's length (`Chunk([1,2,3], 2)` reported 3,
   * true count 2). An operator that does know its length without evaluating
   * says so with an `elementCount` handler; the rest honestly report
   * `undefined`.
   */
  private _broadcastCount(): number | bigint | undefined {
    // Only a collection-SHAPED result can have an element count. `Add(1, 2)`
    // types `integer` and must keep answering `undefined`. UNKEYED:
    // broadcast lifts over element collections only, so a keyed-typed result
    // (never produced by an admitted broadcast) stays `undefined`.
    if (!typeCouldBeUnkeyedCollection(this.type.type)) return undefined;
    // An UNBOUND head does not broadcast (Tycho item 169). An undeclared call
    // binds vacuously (item 152) and its result type lifts over a collection
    // argument, so `Total([1, 2])` types `list<unknown^2>` and looks countable
    // — but there is no evaluation rule to produce those elements, and `each()`
    // walks none. Reading the operand count there reported 2 for a collection
    // that can never yield an element, and the disagreement propagated: `x +
    // Total([1, 2])` counted 2 through `Add` while walking 0. A count nobody
    // can walk is worse than no count, so this is the same `undefined`
    // `Add([1,2], [1,2,3])` already gets.
    //
    // Nor does a bound head that does not LIFT: agreement is the length rule
    // for a broadcasting operator only. Every other collection-typed operator
    // decides its own length — and answers it with `elementCount` when it
    // can. One more shape is read here: a user function literal applied to a
    // collection argument (`_lambdaBroadcastCount`).
    if (this.operatorDefinition?.broadcastable !== true)
      return this._lambdaBroadcastCount();
    const ops = this.ops;
    if (ops === undefined) return undefined;
    let count: number | bigint | undefined;
    for (const op of ops) {
      // A scalar operand is a LIFT, not a participant. Broadcast participants
      // are UNKEYED collections only — keyed operands are never admitted.
      if (!typeCouldBeUnkeyedCollection(op.type.type)) continue;
      const c = op.count;
      if (c === undefined) return undefined;
      if (count === undefined) count = c;
      else if (count !== c) return undefined;
    }
    return count;
  }

  /**
   * The element count of an un-evaluated broadcast CALL of a user function
   * literal — `S(L)` with `S := x ↦ (x, x²)` and `L` a counted list — read
   * from the mapped argument, as `_broadcastCount` reads the participants of
   * a lifted arithmetic operator (Tycho item 326, 2026-09-28: `S(L)` and
   * `d·S(L)` typed `list<tuple<…>>` yet answered `undefined`, while `d·L`
   * answered the length).
   *
   * The count never outruns the walk: `each()` evaluates the call, which
   * yields a lazy view over the mapped argument (the first element of a call
   * over two million elements arrives in milliseconds), so the elements
   * delivered are exactly the argument's.
   *
   * Answered for the PLAIN shape only, where the application's collection
   * type can come from nothing but the lambda broadcast: a function literal
   * (assigned bare, or declared then assigned) whose parameters are all
   * scalar, whose signature is neither polymorphic nor declares a
   * `broadcastable<T>` or point-typed slot (each of those maps by its own
   * plan), called with no numeric tuple (a tuple binds whole and the
   * application types `any`). The participants are the operands
   * `lambdaBroadcastType` maps, read through the shared
   * `isLambdaBroadcastParticipant`, so type and count cannot disagree on who
   * participates; the result's own shape does not matter, since a
   * collection-valued per-element result nests INSIDE the mapped length
   * (`f := x ↦ [x, -x]` over `[1, 2]` is `list<vector<2>>` with two
   * elements). The agreement rule is the lifted operator's: a disagreement
   * or an unknown participant length answers `undefined`, and so does a
   * participant that is a lone scalar-or-collection union, whose own count
   * is unknown.
   *
   * Two more shapes are left unanswered on purpose. A call whose argument
   * count the signature does not admit (`g(L, L)` for `g := x ↦ 2x`) is an
   * error at evaluation, so it has no elements to count. A lambda operator
   * definition with no signature at all is treated as scalar by the type
   * derivation (`paramsAreScalar` answers `true` for it) but answers
   * `undefined` here; that can only withhold a count, never overstate one.
   * An overload set is read through the arm the call resolves to
   * (`resolvedArm`), as the type derivation reads it. A multi-clause
   * definition never reaches this arm: it derives `broadcastable`, so the
   * lifted-operator rule above answers for it.
   */
  private _lambdaBroadcastCount(): number | bigint | undefined {
    const ops = this.ops;
    if (ops === undefined) return undefined;
    let source: Type | undefined;
    const def = this.operatorDefinition;
    if (def !== undefined) {
      if (!isLambdaDef(def)) return undefined;
      source = def.signature?.type;
    } else {
      const valueDef = this.valueDefinition;
      if (valueDef === undefined) return undefined;
      if (!isFunction(valueDef.value, 'Function')) return undefined;
      // A bare `function` wildcard declaration carries no signature of its
      // own: the assigned literal's type is the only one there is, as the
      // type derivation reads it.
      const declared = valueDef.type.type;
      source = isWildcardFunctionType(declared)
        ? (valueDef.value.type.type ?? declared)
        : declared;
    }
    if (source === undefined) return undefined;
    const sig = resolvedArm(this, source) ?? source;
    if (isPolymorphicType(sig)) return undefined;
    if (typeof sig === 'string' || sig.kind !== 'signature') return undefined;
    if (!paramsAreScalar(sig)) return undefined;
    if (
      broadcastableParamSlots(sig) !== undefined ||
      pointListParamSlots(sig) !== undefined
    )
      return undefined;
    const required = sig.args?.length ?? 0;
    const optional = sig.optArgs?.length ?? 0;
    if (ops.length < required) return undefined;
    if (sig.variadicArg === undefined && ops.length > required + optional)
      return undefined;
    if (ops.some((x) => isNumericTuple(x))) return undefined;
    let count: number | bigint | undefined;
    for (const op of ops) {
      if (!isLambdaBroadcastParticipant(op)) continue;
      // A symbol typed `string | list<number>` (or `tuple<…> | list<…>`)
      // participates by its type, but when it holds a string or a tuple,
      // the call binds that value whole: it supplies no cells, and its
      // `count` (the number of characters, or of components) is not the
      // length of the result.
      if (isTextAtom(op) || isTuple(op)) continue;
      const c = op.count;
      if (c === undefined) return undefined;
      if (count === undefined) count = c;
      else if (count !== c) return undefined;
    }
    return count;
  }

  get isEmptyCollection(): boolean | undefined {
    if (!this.isCollection) return undefined;
    const handler = this.operatorDefinition?.collection?.isEmpty;
    if (handler === undefined) return undefined;
    return this._memoizedFacet('isEmpty', () => handler(this));
  }

  get isFiniteCollection(): boolean | undefined {
    if (!this.isCollection) return undefined;
    const handler = this.operatorDefinition?.collection?.isFinite;
    if (handler === undefined) return undefined;
    return this._memoizedFacet('isFinite', () => handler(this));
  }

  get isEnumerableCollection(): boolean | undefined {
    if (isInvalidNonCollection(this)) return false;
    if (this.baseDefinition?.collection !== undefined) {
      // Handlers present: they own the answer. An instance that opted out of
      // being a collection has inert handlers and nothing to walk.
      if (this._optedOutOfCollection) return false;
      const handler = this.operatorDefinition?.collection?.isEnumerable;
      // A DECLARED handler owns all three states — its `undefined` means
      // "cannot tell cheaply" and must not collapse to the default.
      if (handler === undefined) return true;
      return handler(this);
    }

    // No collection handlers: an *eager* collection operator (`Characters`,
    // `Divisors`) only materializes when evaluated. An adopted one exposes
    // its decline test — the `canEnumerate` precondition — and owns all
    // three states, exactly like a declared `isEnumerable` handler above.
    const can = this.operatorDefinition?.canEnumerate;
    if (can !== undefined) return can(this);

    // An UNBOUND head binds vacuously (item 152): its result can look
    // collection-shaped through the lift (`Total([1, 2])` types
    // `list<unknown^2>` on a bare engine), but there is no evaluation rule
    // to produce elements — `each()` provably walks nothing and there is
    // nothing to materialize. That is the facet's definite `false` (an
    // empty walk means NOTHING), the enumerability twin of
    // `_broadcastCount`'s `undefined` (Tycho item-169 ruling, 2026-08-12).
    if (this.operatorDefinition === undefined) return false;

    // Broadcast tier (Tycho item-169 ruling, 2026-08-12): a broadcasting
    // operator's collection-ness is a lift over its operands, and both
    // access routes deliver through the materialize fallbacks — so the
    // facet answers from the participants, the enumerability twin of
    // `_broadcastCount`. `true` is a kept promise under three gates:
    // - a participant that is definitively unwalkable makes the whole
    //   broadcast unwalkable (`x + Total([1, 2])`, `x + Linspace(a, 1, 3)`)
    //   — a definite `false`;
    // - the participants must AGREE on a length (`_broadcastCount`), else
    //   evaluation is `incompatible-dimensions` with an empty walk;
    // - evaluation must be draw-free (`isDrawFreeBroadcast`) so `at()`
    //   reads stay coherent: an impure PARTICIPANT (`RandomShuffle(xs)+1`)
    //   caps the answer at `undefined` — its walk works, but per-index
    //   reads cannot promise draw coherence. Impure lifted SCALARS
    //   (`[1, 2] + RandomInteger(1, 10)`) do not demote the answer.
    if (
      this.operatorDefinition.broadcastable === true &&
      typeCouldBeUnkeyedCollection(this.type.type)
    ) {
      let result: boolean | undefined = true;
      for (const op of this.ops) {
        // A scalar operand is a LIFT, not a participant (UNKEYED, as in
        // `_broadcastCount`: keyed operands are never admitted to broadcast).
        if (!typeCouldBeUnkeyedCollection(op.type.type)) continue;
        const e = op.isEnumerableCollection;
        if (e === false) return false;
        if (e === undefined) result = undefined;
      }
      if (this._broadcastCount() === undefined) return undefined;
      if (!isDrawFreeBroadcast(this)) return undefined;
      return result;
    }

    // Unadopted: a collection-typed application is undecidable here rather
    // than false (`each()`/`at()` walk it through the materialize fallbacks).
    // Anything that cannot be a collection at all cannot be walked. WIDE
    // deliberately (2026-08-14): a dictionary/record-typed application IS
    // walkable through the fallbacks — evaluation yields the keyed value,
    // whose own `each()` walks its pairs — so answering a definite `false`
    // for it was wrong; it now answers `undefined` like every other
    // collection-typed unadopted application.
    return typeCouldBeCollection(this.type.type) ? undefined : false;
  }

  each(): Generator<Expression> {
    // An operator that opted out of being a collection for THIS instance has
    // inert handlers: enumerate nothing rather than iterate a scalar.
    if (this._optedOutOfCollection) return (function* () {})();

    // Element memo (Tycho item 126): a flagged lazy operator serves a
    // repeated walk of an unmodified instance from its cached elements
    // instead of re-evaluating the element function.
    const memoized = this.operatorDefinition?.collection?.elementMemo === true;
    const memoEngine = this.engine;
    if (memoized) {
      const cached = validElementMemo(this);
      // Serve only a COMPLETE cache — a partial prefix (fill-to-n path)
      // covers `at()` reads, not a whole-collection walk.
      if (cached?.complete) {
        // Paranoid canary (design §3, dependency-precise invalidation):
        // under CE_MEMO_PARANOID, cross-check the served cache against a
        // live re-walk. A divergence means a dependency-closure leak —
        // under precise invalidation that is a stale-serve correctness
        // bug, not a spurious refill. Pure bodies only: an impure body
        // (Random) legitimately differs on a re-walk by ruling. The
        // enter/exit latch prevents re-entry (the re-walk, `isPure`, or a
        // diagnostic serialization can reach `each()` again — `toString()`
        // MATERIALIZES a collection); messages deliberately avoid
        // serializing `this` for the same reason.
        if (elementMemoParanoid() && enterParanoidCheck()) {
          try {
            if (this.isPure) {
              const live =
                this.operatorDefinition?.collection?.iterator?.(this);
              if (live) {
                const cachedEls = cached.elements;
                let i = 0;
                let r = live.next();
                while (!r.done && i < cachedEls.length) {
                  console.assert(
                    r.value.isSame(cachedEls[i]),
                    `CE_MEMO_PARANOID: element memo diverged at index ${i + 1} of a ${this.operator} instance`
                  );
                  i++;
                  r = live.next();
                }
                console.assert(
                  r.done === true && i === cachedEls.length,
                  `CE_MEMO_PARANOID: element memo length diverged for a ${this.operator} instance`
                );
              }
            }
          } finally {
            exitParanoidCheck();
          }
        }
        const elements = cached.elements;
        return (function* () {
          let i = 0;
          for (const el of elements) {
            // Match the live path's deadline cadence — a capped cache can
            // still hold 100k elements.
            if ((++i & 0xff) === 0) checkDeadline(memoEngine._deadlineFrame);
            yield el;
          }
        })();
      }
    }

    let iter = this.operatorDefinition?.collection?.iterator?.(this);

    if (!iter) {
      // No lazy iterator of our own. An *eager* collection operator (e.g.
      // `UnicodeScalars(s)`, `Characters(s)`) only materializes a concrete
      // collection when evaluated; a lazy op that wraps such a source
      // (`Map`, `Filter`, `Reduce`, …) keeps it un-evaluated and would
      // otherwise iterate nothing. Evaluate once and iterate the materialized
      // result by building its iterator here (not via `evaluated.each()`),
      // so this branch is never re-entered — no recursion.
      const evaluated = this.evaluate();
      if (evaluated !== this) {
        iter = evaluated.operatorDefinition?.collection?.iterator?.(evaluated);

        // An eager producer can materialize to a collection VALUE that is not
        // a function expression at all, and therefore has no operator
        // definition to read an `iterator` handler from: `StringJoin(xs)` and
        // `Sort("cb")` both evaluate to a `BoxedString`, whose grapheme
        // clusters live behind the value's own `each()`. Without this, such a
        // node enumerated NOTHING while still reporting a non-zero `count`
        // from its `elementCount` handler, and every consumer that walks
        // instead of indexing silently dropped its elements —
        // `Join("a", Sort("cb"))` answered `"a"` rather than `"abc"`.
        // Delegating to `each()` is safe precisely BECAUSE the value is not a
        // function: only `BoxedFunction.each()` can reach this branch, so the
        // no-recursion property the comment above relies on still holds.
        if (!iter && !isFunction(evaluated)) iter = evaluated.each();
      }

      // Return an empty generator if no iterator is defined
      if (!iter) return (function* () {})();
    }

    const engine = this.engine;
    const source: Iterator<Expression, undefined> = (function* () {
      let result = iter.next();
      let i = 0;
      while (!result.done) {
        // Enumeration can be unbounded (infinite or very large lazy
        // collections): respect the engine evaluation deadline.
        if ((++i & 0xff) === 0) checkDeadline(engine._deadlineFrame);
        yield result.value;
        result = iter.next();
      }
      return undefined;
    })();

    // A memoized instance records this walk and commits it as the element
    // cache if (and only if) it is drained to completion. A provably
    // infinite instance (`Iterate`, a `Map` over an infinite `Range`) can
    // never complete a drain, so recording would be pure buffering waste —
    // skip it. (`undefined` finiteness still records: the drain may finish.)
    if (memoized && this.isFiniteCollection !== false)
      return elementMemoRecordingStream(this, source);

    return source as Generator<Expression>;
  }

  at(index: number): Expression | undefined {
    if (this._optedOutOfCollection) return undefined;
    const handler = this.operatorDefinition?.collection?.at;
    if (!handler) return this._materializedAt(index);

    // Centralize negative-index normalization so every collection `at`
    // handler gets a 1-based positive index. Most handlers reject `index < 1`
    // outright (e.g. `Range`, `Linspace`, `Zip`, `Scan`); only a handful
    // normalize negatives themselves. Normalizing here makes negative indexing
    // uniform (so `Last`, `At(xs, -1)`, and `Reverse`'s back-to-front walk all
    // work) without materializing infinite or unknown-length sources.
    let idx = index;
    if (index < 0) {
      // A negative index only makes sense for a finite collection with a known
      // count. Infinite or unknown-count sources stay undefined (no
      // materialization, no hang).
      if (this.isFiniteCollection !== true) return undefined;
      // A count that is not a safe integer (a `bigint`) cannot be used as a
      // `number` index. The position from the end is then a `bigint` too,
      // and only an `atBigint` handler can take it (`Last` of
      // `Permutations(Range(1, 25))`, which has 25! elements).
      const bigCount = this.count;
      if (typeof bigCount === 'bigint') {
        const atBigint = this.operatorDefinition?.collection?.atBigint;
        if (atBigint === undefined || !Number.isInteger(index))
          return undefined;
        const position = bigCount + 1n + BigInt(index);
        if (position < 1n) return undefined;
        return unlessWalkMissedElements(() => atBigint(this, position));
      }
      const count = smallCount(this);
      if (count === undefined || !Number.isFinite(count)) return undefined;
      idx = count + 1 + index;
      if (idx < 1) return undefined;
    }

    // Element memo: serve from a covering cached prefix — AFTER negative
    // normalization, so `at(-1)` on a walked impure instance returns the
    // memoized last element rather than re-deriving (a fresh draw would
    // break one-instance-one-draw-set coherence). On a miss (or an
    // uncovered index) fall through to the handler's own random-access path
    // unchanged — a first `at(n)` is never converted into an O(n) fill.
    if (idx >= 1 && this.operatorDefinition?.collection?.elementMemo === true) {
      const cached = elementMemoAt(this, idx);
      if (cached !== undefined) return cached;
    }

    // A handler that walks a collection to find the element at `idx` (the
    // `at` of `FlatMap`, and of a view such as `Filter` that walks its
    // source) can meet an inner collection that it cannot walk. The element
    // it finds is then not known to be at `idx`, so the answer is
    // `undefined` (see `unlessWalkMissedElements()`).
    return unlessWalkMissedElements(() => handler(this, idx));
  }

  /**
   * Indexed-route twin of `each()`'s eager-source fallback (see the
   * materialize-then-iterate note there, and
   * `docs/COLLECTIONS-MODEL.md`). An EAGER
   * collection operator (`Divisors`, `Characters`, `Eigenvalues`, …) has no
   * collection handlers — its collection exists only as its `evaluate()`
   * result. The streaming route materializes on demand; without this twin,
   * every wrapper that reads its source by index (`Take`, `Drop`, `Reverse`,
   * `Rest`, `Slice`, `RotateLeft` — see `takeIterator`) walked such a source
   * as EMPTY, a definite wrong value on fully-ground input:
   * `Filter(Take(Divisors(12), 3), _ > 1)` answered `[]`.
   *
   * Gates:
   * - Collection-typed only: `at()` is probed speculatively on all kinds of
   *   expressions; a scalar-typed application must not pay an evaluation.
   * - DRAW-FREE only (pure, or a broadcast whose impurity is confined to
   *   lifted scalars — see `isDrawFreeBroadcast`): an impure producer whose
   *   evaluation draws, re-evaluated across generations, would serve
   *   elements of DIFFERENT draws (`Take(RandomShuffle(xs), 2)` mixing two
   *   shuffles) — incoherent. That case stays declined; tracked with the
   *   ROADMAP draw-coherence item.
   * - The evaluated form is cached per (instance, generation) — the
   *   `sgn`/`type` idiom, constant+pure entries generation-independent.
   *
   * Negative indices are handled by the DELEGATED call: the evaluated form is
   * a materialized `List` with real `count`/`at` handlers, so `at(-1)`
   * normalizes there — it cannot here (no `count`).
   */
  private _materializedAt(index: number): Expression | undefined {
    if (!this.isValid) return undefined;
    // UNKEYED: `at()` here is POSITIONAL, and a keyed-typed application can
    // never answer it — `BoxedDictionary` has no `at` handler at all — so
    // paying an evaluation for a `dictionary`/`record`-typed application
    // would buy a guaranteed `undefined`, violating the "a non-indexable
    // application must not pay an evaluation" gate above.
    if (!typeCouldBeUnkeyedCollection(this.type.type)) return undefined;
    // Draw-free rather than pure (item-169 ruling, 2026-08-12): a BROADCAST
    // whose impurity is confined to scalar (lifted) operands evaluates to a
    // structural distribute with the impure calls left unevaluated —
    // `[1, 2] + RandomInteger(1, 10)` → `[1 + RandomInteger(…), …]`, zero
    // draws — so serving `at()` from the cached evaluation is coherent with
    // `each()`, and re-evaluation across generations rebuilds the identical
    // structure. An impure producer whose evaluation DOES draw
    // (`RandomShuffle(xs)`, or a broadcast over one) stays declined: reads
    // spanning generations would mix draw sets.
    if (!isDrawFreeBroadcast(this)) return undefined;
    // An adopted eager producer that declares evaluation would decline saves
    // the evaluation (and keeps the walk's silence honest).
    const can = this.operatorDefinition?.canEnumerate?.(this);
    if (can === false) return undefined;

    // Keyed on the engine generation unconditionally: an all-constant, pure
    // node's answer still moves when its OPERATOR's definition is rewritten
    // in place, so a generation-independent key would never expire. The full
    // account is on the same key in `get type`.
    const gen = this.engine._cacheGeneration();
    const evaluated = cachedValue(
      this._eagerSource,
      gen,
      () => this.evaluate(),
      undefined,
      this.engine
    );
    // Drift tripwire (dev only): a `canEnumerate` handler that vouched `true`
    // must be backed by an evaluation that actually produced the collection.
    console.assert(
      can !== true || (evaluated !== this && evaluated.isCollection),
      `canEnumerate for "${this.operator}" answered true but evaluate() declined`
    );
    if (evaluated === this) return undefined;
    // Evaluation may DECLINE into an equal-but-distinct instance; delegating
    // to another handler-less function expression would re-enter this
    // fallback. Non-function results (a string, a dictionary) dispatch their
    // own `at` overrides, which cannot re-enter.
    if (
      isFunction(evaluated) &&
      evaluated.operatorDefinition?.collection?.at === undefined
    )
      return undefined;
    return evaluated.at(index);
  }

  get(index: Expression | string): Expression | undefined {
    if (this._optedOutOfCollection) return undefined;
    if (typeof index === 'string')
      return this.operatorDefinition?.collection?.at?.(this, index);

    if (!isString(index)) return undefined;
    return this.operatorDefinition?.collection?.at?.(this, index.string);
  }

  indexWhere(predicate: (element: Expression) => boolean): number | undefined {
    if (this._optedOutOfCollection) return undefined;
    if (this.operatorDefinition?.collection?.indexWhere)
      return this.operatorDefinition.collection.indexWhere(this, predicate);
    if (!this.isIndexedCollection) return undefined;
    if (!this.isFiniteCollection) return undefined;
    // 1-based, matching the `indexWhere` collection handlers and `IndexOf`.
    let i = 1;
    for (const x of this.each()) {
      if (predicate(x)) return i;
      i += 1;
    }
    return undefined;
  }

  subsetOf(rhs: Expression, strict: boolean): boolean | undefined {
    // Not a collection: it has no elements to be contained in `rhs`.
    if (this._optedOutOfCollection) return false;
    // A missing handler means "cannot say", not "no" — a hard `false` here
    // would be a claim, and callers (`Subset`, `SubsetEqual`, …) rely on
    // `undefined` to stay unevaluated instead of answering wrongly.
    return this.operatorDefinition?.collection?.subsetOf?.(this, rhs, strict);
  }

  /** Splice `Spread` operands (`f(...p)`) into the operand list.
   *
   * Returns `null` when no operand is a `Spread` (the common case, one cheap
   * scan); the spliced operand list when every spread argument evaluated to a
   * tuple; `this` when a spread argument has not (yet) resolved to a value
   * (the call stays symbolic — a `Spread` operand must never reach positional
   * parameter binding); or an error expression when it resolved to a definite
   * non-tuple value (only tuples spread — a `List` does not).
   */
  private _spliceSpreadOps(): ReadonlyArray<Expression> | Expression | null {
    // A `Function` literal has no argument list: its operands are the body
    // and the PARAMETERS, and a `Spread` among them is a REST PARAMETER
    // (`(a, ...rest) => …`) — the name the application binds a tuple to.
    // Splicing it would evaluate that name and replace the parameter with
    // whatever a same-named symbol holds where the literal happens to be
    // evaluated. A literal is evaluated as the callee operand of the call
    // that applies it, so an inner rest parameter stopped shadowing an outer
    // one of the same name.
    if (this._operator === 'Function') return null;
    if (!this._ops.some((x) => x.operator === 'Spread')) return null;
    const spliced: Expression[] = [];
    for (let i = 0; i < this._ops.length; i++) {
      const x = this._ops[i];
      if (x.operator !== 'Spread' || !isFunction(x) || x.nops !== 1) {
        spliced.push(x);
        continue;
      }
      // Exact evaluation deliberately: only the tuple STRUCTURE is needed
      // here; a `numericApproximation` option applies to the rebuilt call.
      const v = x.op1.canonical.evaluate();
      if (isFunction(v, 'Tuple')) spliced.push(...v.ops);
      else if (isNumber(v) || isString(v) || isFunction(v, 'List'))
        return this.engine.typeError('tuple', v.type, x.op1);
      else if (!v.isValid && this._absorbsEvaluatedOperandError()) {
        // The spread argument evaluated to an error (`f(...g(x))` for a `g`
        // that fails): a demanded operand's error is this node's value
        // (`docs/ERROR-MODEL.md` §3), exactly as it would be in a positional
        // slot — not an unresolved spread that keeps the call symbolic.
        const err = errorValue(v, { operator: this._operator, index: i + 1 });
        if (err !== undefined) return err;
        return this;
      } else return this;
    }
    return spliced;
  }

  /**
   * The error of an argument a USER FUNCTION refused, with THIS node's hop on
   * its breadcrumb — or `undefined` when `result` is not that shape.
   *
   * A function literal applied to an argument its annotated parameter
   * rejects answers the inert application with the argument marked
   * (`Apply((n) => n + 1, Error(incompatible-type, "b"))`, the document form
   * of the refusal; `makeLambda` in `function-utils.ts`). Collapsing that
   * form through `errorValue` would record the hop as `Apply` argument 2 —
   * the internal representation — where the user wrote `bump("b")`: the hop
   * is this node's operator, and the position is the argument's own (the
   * callee occupies the first operand of `Apply`).
   */
  private _refusedArgumentError(result: Expression): Expression | undefined {
    if (this._operator === 'Apply' || !isFunction(result, 'Apply'))
      return undefined;
    const ops = result.ops;
    for (let i = 1; i < ops.length; i++) {
      if (ops[i].isValid) continue;
      const err = errorValue(ops[i], { operator: this._operator, index: i });
      if (err !== undefined) return err;
    }
    return undefined;
  }

  /**
   * True when this node is a collection view that can refuse its source for
   * having no positions: a collection head (`Reverse`, `Take`, `Rest`,
   * `Zip`, …) that is not a collection literal (`List`, `Set`, `Tuple`) and
   * not an observer. See {@link _refusedUnindexedSourceError}.
   */
  private _mayRefuseUnindexedSource(): boolean {
    if (!isCollectionHead(this)) return false;
    if (COLLECTION_LITERAL_HEADS.has(this._operator)) return false;
    const def = this._def ?? undefined;
    return !(
      def !== undefined &&
      isOperatorDef(def) &&
      def.operator.inspectsErrors
    );
  }

  /**
   * The error of a positional collection view (`Reverse`, `Take`, `Drop`,
   * `Rest`, `Most`, `Slice`, the rotations, `Zip`) whose collection operand
   * has no positions (a set, a dictionary), with this node's hop on its
   * breadcrumb — or `undefined` when `result` is not that shape.
   *
   * The declared `indexed_collection` parameter refuses such an operand when
   * the call is boxed: the operand is replaced by an `incompatible-type`
   * error (`Reverse(Error(…, Set(1, 2, 3)))`). The same happens when the
   * view is boxed again after its operand is evaluated (`Reverse(c)` with
   * `c := Set(1, 2, 3)`). A collection head does not bubble the error of an
   * operand, because a failed element of a collection stays in its place.
   * But the refused source is not an element: no part of the view can be
   * computed. So the value of the view is the error itself, with the frame
   * of the view, as for an operator with an `evaluate` handler (`Sort(c)`,
   * `First(c)`).
   *
   * Only an error with no breadcrumb is read: the one that the boxing of
   * this node made. An error with a breadcrumb was made somewhere else.
   */
  private _refusedUnindexedSourceError(
    result: Expression
  ): Expression | undefined {
    if (!isFunction(result) || result.operator !== this._operator)
      return undefined;
    const ops = result.ops;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!isFunction(op, 'Error') || op.nops !== 2) continue;
      const code = op.op1;
      if (!isFunction(code, 'ErrorCode') || code.nops < 2) continue;
      const [kind, expected] = code.ops;
      if (!isString(kind) || kind.string !== 'incompatible-type') continue;
      if (
        !isString(expected) ||
        !expected.string.startsWith('indexed_collection')
      )
        continue;
      const source = op.op2;
      if (!source.isCollection || source.isIndexedCollection) continue;
      return errorValue(op, { operator: this._operator, index: i + 1 });
    }
    return undefined;
  }

  /**
   * The error carried by a broadcast LIFT that has just been evaluated
   * (`evaluateBroadcastLiftsOnce`), with this node's hop on its breadcrumb,
   * or `undefined` when no lifted operand evaluated to one.
   *
   * A lift is a scalar operand evaluated once and repeated into every cell
   * (`[1, 2] ^ Length(5)`). If its value is an error, every cell would be
   * that error and the broadcast would answer a list of error cells — a
   * frozen container hiding a decided failure of a DEMANDED operand, which
   * `docs/ERROR-MODEL.md` §3 makes the node's value instead. Only lifted
   * operands are read (`bops[i] !== ops[i]`): a collection operand that
   * supplies cells keeps a failed cell in place, as the freeze rule says.
   */
  private _liftedOperandError(
    bops: ReadonlyArray<Expression>
  ): Expression | undefined {
    if (!this._absorbsEvaluatedOperandError()) return undefined;
    for (let i = 0; i < bops.length; i++) {
      const lifted = bops[i];
      if (lifted === this._ops[i] || lifted.isValid) continue;
      const err = errorValue(lifted, {
        operator: this._operator,
        index: i + 1,
      });
      if (err !== undefined) return err;
    }
    return undefined;
  }

  /**
   * The value of an INVALID expression — one whose tree embeds an `Error` —
   * or `undefined` to let the `evaluate` handler run anyway.
   * See `docs/LANGUAGE-MODEL.md`.
   *
   * Three outcomes:
   *
   * - **Rung 2, function application**: a direct call `f(err)` of a USER
   *   function — a symbol bound to a `Function` literal (a value definition)
   *   or to an operator definition built from one (`f(x) := …`) — evaluates
   *   to the error itself (the first embedded one, for an operand that merely
   *   *embeds* an error like `"a" + 1`). `Apply`/`Pipe` reach the same rule
   *   through `apply()`. A built-in operator (`Sin(err)`, `err + 1`) is
   *   deliberately NOT an application: it stays inert until rung 3, which is
   *   also what keeps `x |> f` ≡ `f(x)` for every callee.
   * - **Observers** (`inspectsErrors`): the handler runs — `Match` decides on
   *   an error subject, `Type`/`IsError` report on it.
   * - **Rung 3, every other operator**: bubble as well (`err + 1` → err,
   *   `Sin(err)` → err) — error is the absorbing element of strict evaluation,
   *   and the bubbled value carries a breadcrumb of the frames it passed
   *   through (§2a).
   * - **Collections**: a collection-headed node — `List`, `Tuple`, `Set`,
   *   `Range`, `Take`, … — never bubbles its own operands' errors. An error
   *   in an element is a failure of that CELL, not of the container, so the
   *   collection freezes with the error in place and stays iterable. Keyed on
   *   collection-ness (the definition's `collection` handler block), not on
   *   laziness — see §6a.2.
   * - **Selecting operators** (`selectsOperands`): absorption is DEFERRED to
   *   after the handler, so an error in an operand the operator never chooses
   *   does not bubble — see `_defersErrorAbsorption`.
   */
  private _invalidValue(): Expression | undefined {
    const def = this._def ?? undefined;
    if (def === undefined) return this;

    // An operand holds a call that its callee refused when it was boxed, and
    // the callee was not replaced yet (else `_canonicalToEvaluate()` would
    // have evaluated the node boxed again in this place). An operand can
    // still replace the callee before the handler evaluates the call
    // (`Block(Assign(h, u ↦ 7), h("a") + 1)`), so the error is not certain
    // yet (`_holdsRefusedCall()`). Run the handler, and absorb an error from
    // its result (`_absorbsErrorAfterHandler()`). A collection runs its
    // handler too, which evaluates its other cells, and keeps the error of
    // the refused cell in place (a collection absorbs no error after its
    // handler): with `a := 5`, `[a, h("abc")]` is `[5, Error(…)]`, not
    // `[a, Error(…)]`.
    if (this._holdsRefusedCall()) return undefined;

    if (isValueDef(def)) {
      // A value-def head is a callee only when its value is a FUNCTION — the
      // same test `applyFunctionLiteral` makes. When it is not (`a := 5;
      // a(err)`), this is not an application at all: let the handler run so
      // the CALLEE problem is reported (`applyFunctionLiteral`'s `typeError`
      // path) rather than the argument's error.
      const value = calleeValue(this, def.value);
      if (!value?.type.matches('function')) return undefined;
      const d = this._operandErrorDisposition();
      if (d === 'evaluate') return undefined;
      return d === 'freeze' ? this : d;
    }

    if (
      isOperatorDef(def) &&
      def.operator instanceof _BoxedOperatorDefinition &&
      def.operator._isLambda
    ) {
      const err = this._firstOperandError();
      if (err !== undefined) return err;
    }

    if (isOperatorDef(def) && def.operator.inspectsErrors) return undefined;

    // Rung 4: an operator that SELECTS among its operands propagates only
    // what it demands, so absorption is DEFERRED past its handler rather
    // than done here — see `_defersErrorAbsorption`.
    if (this._defersErrorAbsorption()) return undefined;

    const d = this._operandErrorDisposition();
    if (d === 'evaluate') return undefined;
    // Rung 3: a collection freezes with the failed cell in place; everything
    // else bubbles.
    if (d === 'freeze' || isCollectionHead(this)) return this;
    return d;
  }

  /**
   * What this node's operands' errors make of the node, once the
   * demanded-operands rule has been applied to them:
   *
   * - an `Error` — an error is reachable in an operand without crossing a
   *   SELECTING operator, so it is this node's value (rung 3; a collection
   *   turns that into a freeze instead — see `_invalidValue`);
   * - `'evaluate'` — every error left in the tree sits behind a selecting
   *   operand, which decides for itself whether it demands the failing arm.
   *   Nothing outside that operand can say, so this node must EVALUATE and
   *   absorb whatever its result carries (`_absorbsErrorAfterHandler`). This
   *   is what makes the demanded-operands rule hold under COMPOSITION:
   *   `1 + If(True, 5, <error>)` is `6` and `[If(True, 5, <error>)]` is
   *   `[5]`, exactly as the bare `If` is `5`. The same answer is given
   *   when every error that remains sits in a cell of a `List` or `Set`
   *   literal (`failedCellsAreIterable`): such a literal is a collection
   *   value, so the handler reads it and gives the failed cell as the value
   *   of its element (`Length([1, <error>])` is `2`, `Map(f, [1, <error>])`
   *   applies `f` to the error). An error that the handler demands is in its
   *   result and bubbles from there.
   * - `'freeze'` — the errors that remain sit inside collection-literal
   *   operands, which no error walk descends into, and one of them is in a
   *   `Tuple`, `Dictionary` or `KeyValuePair` literal (`f((1, <error>))`), so
   *   the node keeps them in place and stays as it is.
   */
  private _operandErrorDisposition(): Expression | 'evaluate' | 'freeze' {
    const err = this._firstOperandError();
    if (err !== undefined) return err;
    if (this._ops.some((x) => potentialErrorValue(x) !== undefined))
      return 'evaluate';
    if (failedCellsAreIterable(this)) return 'evaluate';
    return 'freeze';
  }

  /**
   * True when this node's error absorption happens AFTER its handler has run
   * rather than before it — the set of nodes `_invalidValue()` deliberately
   * lets through.
   *
   * Two populations: a selecting operator, whose own operands may be dead
   * code (`_defersErrorAbsorption`), and any node whose errors all sit behind
   * such an operand (`_operandErrorDisposition` answering `'evaluate'`). Both
   * owe an absorption on the RESULT, because that is where the question they
   * postponed is finally answered.
   *
   * Excluded, as at every absorption site: an observer, entitled to see the
   * error and answer about it, and a collection, which keeps a failed cell in
   * place instead of bubbling it.
   */
  private _absorbsErrorAfterHandler(): boolean {
    if (this.isValid) return false;
    // An UNBOUND node (`_def` is null, not undefined) has no handler to
    // absorb after, and `_invalidValue` answers `this` for it.
    const def = this._def ?? undefined;
    if (def === undefined) return false;
    if (isOperatorDef(def) && def.operator.inspectsErrors) return false;
    if (isCollectionHead(this)) return false;
    if (this._defersErrorAbsorption() || this._holdsRefusedCall()) return true;
    return this._operandErrorDisposition() === 'evaluate';
  }

  /**
   * True when an error that appears in an operand only by EVALUATING it —
   * the node itself was valid at boxing time (`Sin(Length(5))`,
   * `1 + f(x)` for a user function that fails) — bubbles as this node's
   * value before the handler runs. `docs/ERROR-MODEL.md` §3 makes no
   * distinction between an error present at boxing and one produced by
   * evaluating a demanded operand (`Sin(err) → err`; `Sin(If(False, 5,
   * err))` is the error "because the selection demanded the failing arm and
   * the error is then the operand's value"), so the exclusions are the same
   * as at every other absorption site: an observer (`inspectsErrors`) is
   * entitled to see the error, a collection head keeps a failed cell in
   * place, and a selecting operator holds its operands and decides for
   * itself. An UNBOUND node has no handler to protect.
   *
   * Until 2026-09-03 this case was excluded outright ("no error minted
   * during this evaluation changes its propagation"), which left
   * `Sin(Length(5))` as the invalid tree `sin(Error(…))` — an inert answer
   * to a decided failure, which §1 forbids.
   */
  private _absorbsEvaluatedOperandError(): boolean {
    const def = this._def ?? undefined;
    if (def === undefined) return false;
    if (isOperatorDef(def) && def.operator.inspectsErrors) return false;
    if (isCollectionHead(this)) return false;
    return !this._defersErrorAbsorption();
  }

  /**
   * True when this node's error absorption waits until after the handler has
   * run, instead of happening before it.
   *
   * A `selectsOperands` operator propagates an error only from an operand it
   * actually DEMANDS (`docs/ERROR-MODEL.md` §3, the demanded-operands rule):
   * an error in an arm the operator never selects is dead code, so
   * `If(True, 5, <error>)` answers `5` and `And(False, <error>)` answers
   * `False`. Absorbing before the handler runs cannot express that, because
   * at that point nothing has decided which operands the handler will ask
   * for.
   *
   * Deferring, rather than skipping, is what keeps the dual obligation: an
   * operand the handler DOES demand comes back as the error (an `Error` node
   * evaluates to itself), the error is therefore embedded in the handler's
   * result, and the deferred absorption in `_computeValue` bubbles it.
   *
   * The flag is what limits this to operators that genuinely choose. Applying
   * it to every `lazy` operator was measured and is wrong: most lazy handlers
   * demand all of their operands, and several answer something else entirely
   * when a demanded operand is unusable — `Numerator(<error>)` answered
   * `Nothing`, and `D(<error>, x)` threw out of the handler — so their errors
   * must keep being absorbed before the handler runs.
   *
   * The boxed tree is untouched either way: `isValid` stays `false` and the
   * diagnostic stays in place for editors and static analysis; only what
   * `evaluate()` and `N()` select changes.
   *
   * Excluded, matching the rungs above: an observer, which is entitled to see
   * the error and answer about it; and a collection head, whose failed cell
   * is frozen in place rather than bubbled at all.
   *
   * The same predicate governs the error WALKS (`errorValue`,
   * `potentialErrorValue`), which is why it lives in `error-value.ts`: a node
   * that defers its own absorption must equally be opaque to the absorption
   * an ENCLOSING node performs, or composition would undo the deferral —
   * `1 + If(True, 5, <error>)` would fail where the bare `If` answers `5`.
   */
  private _defersErrorAbsorption(): boolean {
    return defersErrorAbsorption(this);
  }

  /** The error carried by the first operand that is — or embeds — one, with
   * this node pushed onto its breadcrumb (§2a). */
  private _firstOperandError(): Expression | undefined {
    for (let i = 0; i < this._ops.length; i++) {
      const err = errorValue(this._ops[i], {
        operator: this._operator,
        index: i + 1,
      });
      if (err !== undefined) return err;
    }
    return undefined;
  }

  /**
   * The error this node's RESULT carries, or `undefined` when it carries
   * none — the late half of the absorption `_absorbsErrorAfterHandler`
   * describes.
   *
   * `errorValue` does not descend into a selecting head (§3), so a result
   * that is still an application of a selecting operator — an undecided `If`,
   * a `Coalesce` waiting on a value — yields nothing here and stays inert
   * with its diagnostic in place, which is the point of deferring.
   */
  private _resultError(
    result: Expression,
    since: number
  ): Expression | undefined {
    if (isFunction(result, 'Error')) {
      // A bare error IS already this node's value, so there is nothing to
      // absorb — except a breadcrumb for a SELECTING operator, whose handler
      // hands back the demanded operand's error with no record of which
      // operand that was.
      if (!this._defersErrorAbsorption()) return undefined;
      // An error that the handler of THIS node made with the frame of this
      // node already in its breadcrumb (the `unexpected-argument` error of a
      // surplus operand, `surplusOperandError()`) names its operand: no
      // operand holds it, so the search below would add a wrong frame for
      // operand 1. The record is per node, so an enclosing node that returns
      // the same error still adds its own frame (`markErrorFramedByNode()`,
      // `error-value.ts`).
      if (isErrorFramedByNode(result, this)) return undefined;
      return withErrorFrames(result, [this._deferredErrorFrame(result, since)]);
    }
    return errorValue(result);
  }

  /**
   * The breadcrumb frame for an error a selecting operator returned: the
   * operand position the error came from.
   *
   * The handler returns the error as a bare value, so the position has to be
   * recovered here, by finding the operand whose own tree holds that same
   * error. The comparison is on the error's CODE and context — the operands
   * still carry the error as authored, while the returned copy may have grown
   * breadcrumb frames from hops taken inside the operand
   * (`If(Sin(<error>), 1, 2)` returns it with `{Sin, 1}` already recorded).
   *
   * An error that the EVALUATION of an operand made is held by no operand:
   * the branch `g("a")` of `If(n = 2, g("a"), n)`, where `g` is a user
   * function whose body fails, is valid when it is boxed. Such an error is
   * found first, by the record of the evaluation that returned it
   * (`errorEvaluatedFrom`): when that evaluation is the evaluation of an
   * operand of this node, the frame names that operand, which is the branch
   * the handler took. This also tells apart two operands that hold
   * byte-identical errors. `since` is the value of `errorRecordCount` when
   * the evaluation of this node began; a record with a stamp that is not
   * larger was made by an earlier evaluation, and is not used.
   *
   * An error the handler minted itself rather than took from an operand
   * falls back to operand 1 — the position every selecting operator in the
   * library always demands (the condition of `If`/`Which`, the first operand
   * of `And`/`Or`/`Coalesce`) — so the operator hop is recorded even when
   * the exact position is not recoverable.
   */
  private _deferredErrorFrame(err: Expression, since: number): ErrorFrame {
    const origin = errorEvaluatedFrom.get(err);
    if (origin !== undefined && origin.stamp > since) {
      const index = this._ops.indexOf(origin.node);
      if (index >= 0) return { operator: this._operator, index: index + 1 };
    }
    const core = errorOpsWithoutTrace(err);
    for (let i = 0; i < this._ops.length; i++) {
      const op = this._ops[i];
      if (op.isValid) continue;
      const candidate = potentialErrorValue(op);
      if (candidate === undefined) continue;
      const candidateCore = errorOpsWithoutTrace(candidate);
      if (candidateCore.length !== core.length) continue;
      if (candidateCore.every((x, j) => x.isSame(core[j])))
        return { operator: this._operator, index: i + 1 };
    }
    return { operator: this._operator, index: 1 };
  }

  /**
   * The component-wise map over TUPLE arguments of a user function whose
   * parameters are declared as scalars (`declaredScalarTupleCells`), for
   * the evaluated arguments `tail` of this application. The declared types
   * are the annotations of the function literal and, when the signature of
   * the definition was declared and not inferred, that signature.
   * `undefined` for an operator that is not a function literal.
   */
  private _declaredScalarTupleCells(
    def: BoxedOperatorDefinition | undefined,
    tail: ReadonlyArray<Expression>
  ): ReturnType<typeof declaredScalarTupleCells> {
    const literal = lambdaLiteralOf(def);
    if (def === undefined || literal === undefined) return undefined;
    const isScalarParam = declaredScalarParams(
      literal,
      def.inferredSignature ? undefined : def.signature?.type
    );
    if (isScalarParam === undefined) return undefined;
    return declaredScalarTupleCells(this.engine, isScalarParam, tail);
  }

  _computeValue(options?: Partial<EvaluateOptions>): () => Expression {
    const compute = this._computeValueUnabsorbed(options);
    if (this.isValid) {
      // A node valid at boxing time. Step 4-err bubbles an operand that
      // evaluates to an error — but only for operands the framework
      // evaluates. A LAZY operator that demands every operand (`Add`,
      // `Multiply`) evaluates them inside its handler, so such an error
      // surfaces in its RESULT instead: `1 + Length(5)` came back as the
      // invalid tree `1 + Error(…)`. `docs/ERROR-MODEL.md` §3 makes that
      // error the node's value, under the same exclusions
      // (`_absorbsEvaluatedOperandError`). A SELECTING operator is excluded
      // there because it decides for itself, but the demanded arm's error it
      // returns still owes the operator hop on its breadcrumb, which
      // `_resultError` adds. The predicates depend only on the definition,
      // so they are read here, once, and an excluded node — an observer, a
      // collection head — keeps the unwrapped `compute`. A valid result, the
      // common case, pays one cached `isValid` read; a frozen collection or
      // an undecided selection in the result is returned as it is
      // (`errorValue` does not descend into them).
      const selecting = this._defersErrorAbsorption();
      if (!selecting && !this._absorbsEvaluatedOperandError()) {
        if (!this._mayRefuseUnindexedSource()) return compute;
        return () => {
          const result = compute();
          if (result.isValid) return result;
          return this._refusedUnindexedSourceError(result) ?? result;
        };
      }
      return () => {
        // Read before the evaluation, for `_deferredErrorFrame()`.
        const since = errorRecordCount;
        const result = compute();
        if (result.isValid) return result;
        if (selecting) return this._resultError(result, since) ?? result;
        return (
          this._refusedArgumentError(result) ?? errorValue(result) ?? result
        );
      };
    }
    // The late half of the demanded-operands rule
    // (`_absorbsErrorAfterHandler`): the handler runs on the invalid tree,
    // and only an error that reached its RESULT — i.e. one a selection
    // actually demanded — bubbles.
    if (!this._absorbsErrorAfterHandler()) {
      if (!this._mayRefuseUnindexedSource()) return compute;
      return () => {
        const result = compute();
        return this._refusedUnindexedSourceError(result) ?? result;
      };
    }
    return () => {
      const since = errorRecordCount;
      const result = compute();
      return this._errorAfterHandler(result, since) ?? result;
    };
  }

  /** The error that bubbles from the result of the handler of an invalid
   * node (`_absorbsErrorAfterHandler()`), or `undefined`.
   *
   * A node that holds a call its callee refused when it was boxed runs its
   * handler (`_invalidValue()`). When the callee is the same after the
   * handler, the call is still refused, and the value of the node is the
   * error of its operands, as when the handler does not run. The breadcrumb
   * then names the operands of this node, and not the internal form of the
   * handler result (the `Multiply` handler can answer a `Divide`). */
  private _errorAfterHandler(
    result: Expression,
    since: number
  ): Expression | undefined {
    if (
      !result.isValid &&
      this._holdsRefusedCall() &&
      !this._defersErrorAbsorption() &&
      this._recheckedTree() === this
    ) {
      const err = this._firstOperandError();
      if (err !== undefined) return err;
    }
    return this._resultError(result, since);
  }

  private _computeValueUnabsorbed(
    options?: Partial<EvaluateOptions>
  ): () => Expression {
    return () => {
      // Cooperative deadline checkpoint on the per-node evaluation path.
      // Specialized loops (collection enumeration, polynomial GCD, Rubi
      // matching) carry their own checks, but handler-driven evaluation —
      // e.g. a user-function body whose parameter substitution multiplies
      // the tree at every nesting level — never reaches them: without this
      // check such an evaluation exhausts the heap instead of honoring an
      // enclosing `withTimeLimit` span's deadline.
      checkDeadlineEvery(this.engine._deadlineFrame, 0x3ff);

      if (!this._def) return this;
      if (!this.isValid) {
        const invalid = this._invalidValue();
        if (invalid !== undefined) return invalid;
      }

      //
      // 0/ Splice spread arguments — `f(...p)` — before any application,
      // broadcast or hold logic (including user function literals in step
      // 1): the elements of a spread tuple are ordinary positional
      // arguments. Rebuilding through `ce.function` runs the arity/type
      // validation that was deferred at canonicalization.
      //
      const spliced = this._spliceSpreadOps();
      if (spliced !== null) {
        if (!Array.isArray(spliced)) return spliced as Expression;
        return this.engine
          .function(this.operator, spliced as Expression[])
          .evaluate(options);
      }

      const numericApproximation = options?.numericApproximation ?? false;

      const materialization = options?.materialization ?? false;

      //
      // 1/ Check if the operator is a function literal
      //

      if (isValueDef(this._def))
        return applyFunctionLiteral(this, this._def.value, options);

      const def = this._def.operator;

      // 1b/ A lazy collection operator holds its callback: a symbol that
      // holds an error at the callback parameter gives that error.
      if (def.lazy === true && this._localScope === undefined) {
        const heldError = heldErrorCallback(this, def);
        if (heldError !== undefined) return heldError;
      }

      //
      // 2/ Broadcast if applicable
      // Skip broadcasting for Add/Multiply with tensors - they have their own
      // element-wise handling in addTensors/mulTensors.
      // Add/Multiply also skip when some operand is a RAW function expression
      // that is not (yet) a collection: zipping it here would repeat it as a
      // scalar, and its per-element re-evaluation could expand into a
      // collection (e.g. `s(p_0)·PointList(…)`) — an N×N cartesian blow-up
      // instead of the elementwise zip. Those shapes broadcast soundly in
      // `add()`/`mul()`, which run on EVALUATED operands. (They are already
      // excluded from the post-evaluation steps 3b/4b for the same reason.)
      //
      // O(rank) candidate check (§D4.2 hot-path contract): dispatch must
      // never pay the O(cells) type computation per broadcast evaluation.
      // Kernel entries (addTensors/mulTensors) fully qualify + pack, and
      // DECLINE non-qualified candidates back to the generic broadcast path.
      const hasTensors = this.ops!.some((x) => candidateShape(x) !== null);
      // An operator whose handlers own evaluated-operand broadcasting defers
      // an unevaluated function operand to them (the veto described above).
      const hasRawOperand =
        def.broadcastExemptions.includes('evaluated-operands') &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      const operatorBroadcast =
        def.broadcastable &&
        // A user function — a function literal, or a multi-clause definition
        // — has its OWN broadcast arm (step 2b) and takes it even when the
        // definition is `broadcastable`: an annotated literal assigned bare
        // derives that flag from `paramsAreScalar` (`engine-declarations.ts`),
        // and a clause set derives it the same way (`multi-clause.ts`). The
        // two arms now agree on the empty source as well — both answer the
        // empty list, which is also what the declare-then-assign VALUE route
        // answers — but a user function still belongs to step 2b, which binds
        // the literal's own parameters.
        !isUserFunctionDef(def) &&
        !hasRawOperand &&
        // A call with an operand past the declared arity is refused whole
        // by its handler, never fanned over a surplus collection operand.
        !hasSurplusOperands(def, this.ops!) &&
        this.ops!.some((x) => isFiniteBroadcastParticipant(x)) &&
        // A set has no positions, so it cannot supply cells. At a number
        // parameter the operator is not broadcast, and the handler gets the
        // whole set, as it does beside a scalar. At another parameter the
        // set is used whole in every cell (`unindexedOperandBroadcast`).
        unindexedOperandBroadcast(def, this.ops!) !== 'veto' &&
        !skipBroadcastForVectorOps(def, hasTensors, this.ops!) &&
        !pointIsOneLegOf(this.operator, this.ops!);
      // An operand that is collection-TYPED but carries no collection value
      // yet would be spliced whole into every cell as a scalar, freezing an
      // outer product into the result (`hasUnresolvedCollectionOperand`).
      // Decline, so the application stays symbolic and zips once the operand
      // resolves. Read from the RAW operands, which can over-decline for one
      // that only BECOMES a collection when the lifts are evaluated below
      // (`Divide(Range(0, n), n)`): that costs nothing, because the
      // post-evaluation broadcast (step 4b) re-decides the same question on
      // resolved operands.
      const unresolvedBroadcastOperand =
        operatorBroadcast === true &&
        hasUnresolvedCollectionOperand(this.ops!, isBroadcastableCollection);
      // A length disagreement among the operands that DO have values outranks
      // the veto: no assignment to the unresolved operand can reconcile 2
      // elements against 3, so the application is the same error it would be
      // without that operand rather than an inert form waiting on a value.
      if (unresolvedBroadcastOperand) {
        const mismatch = broadcastLengthMismatch(this.engine, this.ops!);
        if (mismatch) return mismatch;
      }
      if (operatorBroadcast && !unresolvedBroadcastOperand) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Sin(Filter(…))`, whose count is
        // `undefined`; the eager zip would truncate it to one element) — return
        // the lazy `Map` form (e.g. `Sin(Range(1,1e8))` → `Map(Sin,
        // Range(1,1e8))`) instead of materializing every element. Operands whose
        // collection-ness or size only resolves at evaluation (a symbolic-length
        // `Range`, an infinite `Cycle`) are not finite-reported here and are left
        // to the post-evaluation broadcast (step 4b) once their count is known.
        // Broadcast rulings (2026-07-24): operands lifted into every cell are
        // evaluated ONCE, and a length mismatch is an error, not a truncation.
        // Both run BEFORE the lazy form is built: the lazy `Map` zips to the
        // shortest source, so deferring them would make the SIZE of a
        // collection decide the semantics — a mismatch erroring under the eager
        // threshold and silently truncating above it.
        const bops = this._evaluatesExponentExactly(options)
          ? [
              ...evaluateBroadcastLiftsOnce(
                [this._ops![0]],
                options,
                this.operator
              ),
              normalizeLiftedAbsence(
                this._ops![1],
                exactIntegerOperand(this._ops![1], options)
              ),
            ]
          : evaluateBroadcastLiftsOnce(this._ops!, options, this.operator);
        const liftError = this._liftedOperandError(bops);
        if (liftError !== undefined) return liftError;
        // An integer power of a square matrix is the matrix power, not the
        // element-wise power. See `squareMatrixPower()`.
        if (this.operator === 'Power' && this._isBoundToLibraryDefinition()) {
          const matrixPower = squareMatrixPower(
            this.engine,
            bops,
            options,
            this._ops![1]
          );
          if (matrixPower !== undefined) return matrixPower.evaluate(options);
        }
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;
        // A lift can be a set only when it is evaluated: `At([Set(1, 2), 3],
        // 1)` has the type `integer | set<integer>`. Decide again on the
        // evaluated operands. For a `'veto'`, apply the operator to them
        // without a broadcast: the gate above then declines for the set, as
        // it does for a set that is an operand as written.
        const unindexed = unindexedOperandBroadcast(def, bops);
        if (unindexed === 'veto')
          return this._withSameBinding(bops).evaluate(options);

        // Under `.N()`, a lazy `Map` operand is read through its numeric
        // callback (`lazyMapNumericApproximation`), as `Map(f, xs).N()`
        // reads it. The cells are built from the elements of the operand,
        // and the exact callback computes each element exactly first: with
        // `H = Sum(1/k, k, 1, 6000)`, `Sin(Map(Sin, [H])).N()` computed the
        // exact `H`, a rational with thousands of digits, where
        // `Map(Sin, [H]).N()` reads `H` numerically. A jump operator keeps
        // the exact elements: its handler reads the exact value of an
        // exact operand near the jump (`Floor(Map(x ↦ x, [(25! − 1)/24!]))`
        // is `[24]`, where the float of the element is 25).
        const cellOps =
          numericApproximation && !JUMP_BROADCAST_OPERATORS.has(this.operator)
            ? bops.map(
                (op) =>
                  (op.isLazyCollection &&
                    lazyMapNumericApproximation(this.engine, op)) ||
                  op
              )
            : bops;

        const lazy = withCallableBinding(this, () =>
          lazyBroadcastMapIfNeeded(
            this.engine,
            this.operator,
            cellOps,
            isBroadcastableCollection,
            numericApproximation
          )
        );
        if (lazy) return lazy;

        const items =
          unindexed === 'lift' ? zipLiftingUnindexed(cellOps) : zip(cellOps);
        if (!items) return this.engine._fn('List', []);

        const results: Expression[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;
          results.push(this._withSameBinding(value).evaluate(options));
        }

        // Always wrap in a `List` — even a single-element broadcast — so the
        // value matches the `list<E>` broadcast type (the type handler never
        // unwraps a singleton). Mirrors the lambda broadcast in step 4b.
        //
        // A broadcast over a lone EMPTY collection operand answers the EMPTY
        // LIST, not the erasure marker `Nothing`: `Sin([])` is `[]`, as
        // `2·[]` and a user function applied to an empty source already were
        // (rule of 2026-09-21, `docs/BROADCAST-MODEL.md`). An empty operand
        // beside a NON-empty one is a length mismatch instead, and the check
        // above has already answered `incompatible-dimensions` for it.
        //
        // An absent cell of a list of POINTS (`Sin([Missing, (3, 4)])`)
        // reaches the cell application as the bare `Missing` symbol, and the
        // numeric operator answers `NaN` for it. The type of this application
        // says the cell is `missing | tuple<…>`, so an absent point, which is
        // `Missing`. `markAbsentPointCells()` makes that correction, the same
        // one the `Add` and `Multiply` handlers make.
        return markAbsentPointCells(
          this.engine,
          this,
          this.engine._fn('List', results)
        );
      }

      //
      // 2b/ Broadcast user-defined function literals over indexed collections
      // When a function defined via `ce.assign('f', x \mapsto ...)` is applied
      // to a list (or other finite indexed collection) and the function's
      // parameters are scalar, map the function over the collection.
      // Note: tuples are excluded (`!isTuple`) — a `Tuple` is an atomic value
      // (a point/vector), bound whole to the parameter, never mapped over.
      //
      const scalarUserFunction = isUserFunctionDef(def) && paramsAreScalar(def);
      const lambdaElementwise =
        scalarUserFunction &&
        this.ops!.some((x) => isFiniteBroadcastParticipant(x));
      // Same veto as step 2, for the lambda arm: a collection-TYPED operand
      // with no value yet must not be bound as a per-element scalar. Unlike
      // step 2 this arm HOLDS rather than falling through, because falling
      // through applies the lambda to the whole operands and inlines its body —
      // the same capture, one rank up. With `g(a, b) = (a, b)` and a valueless
      // `s: list<number>`, `g([1, 2], s)` was inlined as `([1, 2], s)`, which
      // re-evaluates to the tuple of lists `([1,2], [10,20])` once
      // `s := [10, 20]`, where a fresh call zips to the point list
      // `[(1, 10), (2, 20)]`.
      // The hold does not need a sibling that already HAS a collection value:
      // with `h(n: integer) = n + 1` and a valueless `xs: list<integer>`,
      // `h(xs)` alone was applied to the symbol and refused by argument
      // validation as `incompatible-type` (or by clause dispatch as
      // `no-matching-clause`), where the argument maps element-wise as soon
      // as it has a value. The honest answer is the held application, which
      // a later evaluation broadcasts once `xs` is assigned.
      // Only a SYMBOL with no value is held on that ground
      // (`isValuelessCollectionSymbol`): an operand that merely becomes a
      // collection when evaluated (`k(lst(3))`) is left to the
      // post-evaluation broadcast (step 4b), and a symbol that holds a
      // scalar under a `number | list<number>` declaration applies at once.
      if (
        (lambdaElementwise &&
          hasUnresolvedCollectionOperand(
            this.ops!,
            isBroadcastableCollection
          )) ||
        (scalarUserFunction && this.ops!.some(isValuelessCollectionSymbol))
      ) {
        // A length disagreement among the operands that DO have values is
        // DEFINITE — no assignment to the unresolved one can reconcile 2
        // elements against 3 — so it is reported instead of held.
        const mismatch = broadcastLengthMismatch(this.engine, this.ops!);
        if (mismatch) return mismatch;
        return this.engine.function(
          this.operator,
          this.ops!.map((x) => x.evaluate(operandOptions(options)))
        );
      }
      if (lambdaElementwise) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — map the lambda lazily.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (step 4b/3b) once their count resolves.
        // Broadcast rulings (2026-07-24) — see step 2 above (both run before
        // the lazy form, so size does not decide the semantics).
        const bops = evaluateBroadcastLiftsOnce(
          this._ops!,
          options,
          this.operator
        );
        const liftError = this._liftedOperandError(bops);
        if (liftError !== undefined) return liftError;
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = withCallableBinding(this, () =>
          lazyBroadcastMapIfNeeded(
            this.engine,
            this.operator,
            bops,
            isBroadcastableCollection,
            numericApproximation
          )
        );
        if (lazy) return lazy;

        const items = zipBroadcast(bops, isBroadcastableCollection);
        if (items) {
          const results: Expression[] = [];
          // A THROWN element failure aborts the whole broadcast, so it cannot
          // carry a breadcrumb — its message is enriched instead. One `try`
          // around the loop, so a successful broadcast pays nothing.
          try {
            while (true) {
              const { done, value } = items.next();
              if (done) break;
              results.push(this._withSameBinding(value).evaluate(options));
            }
          } catch (e) {
            throw withBroadcastThrowContext(
              e,
              this.operator,
              bops,
              results.length + 1
            );
          }
          return this.engine._fn(
            'List',
            annotateBroadcastErrors(
              this.operator,
              listedBroadcastCells(this.engine, results, numericApproximation)
            )
          );
        }
      }

      //
      // 2c/ Broadcast over the slots a DECLARED `broadcastable<T>` signature
      // marks elementwise (Option A, ratified 2026-08-08 —
      // docs/plans/2026-08-08-broadcastable-param-semantics.md). Step 2b above
      // never reaches these: `paramsAreScalar` is false for such a signature
      // (a `broadcastable<T>` is not a scalar type), by design — the gate here
      // is the DECLARATION, per slot, not the absence of evidence. Rule 1
      // (broadcast-wins): a collection argument maps even when `T` would admit
      // it whole. Rule 2 (one rank down) lives in `declaredBroadcastElement`.
      //
      const declaredPlan = broadcastableParamSlots(def);
      const declaredLiteral = declaredPlan && lambdaLiteralOf(def);
      if (
        declaredPlan &&
        declaredLiteral &&
        // Enter only when a MAPPABLE slot actually holds a collection. Testing
        // "any operand is a collection" instead would evaluate the scalar
        // lifts below for a broadcast `setupDeclaredBroadcast` then declines
        // (no mapped slot), and the ordinary application in the tail would
        // evaluate them a SECOND time: `f(Random(), L)` under
        // `(broadcastable<number>, list<number>)` drew twice, against the
        // evaluate-once ruling (2026-07-24).
        //
        // The predicate MUST be the same one handed to `declaredBroadcast`
        // below: a gate that admits more than the broadcast itself does (an
        // `isFiniteIndexedCollection` gate lets a STRING through, while
        // `isFiniteBroadcastParticipant` treats a string as broadcast-atomic)
        // enters the branch for operands the broadcast will then decline.
        someMappableCollection(this.ops!, declaredPlan, (x) =>
          isFiniteBroadcastParticipant(x)
        )
      ) {
        // Broadcast rulings (2026-07-24), as in steps 2/2b: lifted operands are
        // evaluated ONCE, and the length check runs before the lazy form so the
        // SIZE of a source never decides the semantics.
        const declaredOps = evaluateBroadcastLiftsOnce(
          this._ops!,
          options,
          this.operator
        );
        const liftError = this._liftedOperandError(declaredOps);
        if (liftError !== undefined) return liftError;
        const mapped = declaredBroadcast(
          this.engine,
          this.operator,
          declaredLiteral,
          declaredPlan,
          declaredOps,
          (x) => isFiniteBroadcastParticipant(x),
          options
        );
        if (mapped) return mapped;
      }

      //
      // 2c'/ A LAZY operator over a collection operand that can be absent as
      // a whole (`resolveAbsentableLazyOperands`): the operand is evaluated.
      // When it is absent, the answer is the marker of the codomain, as the
      // absence test (step 4a) answers for an operand that is evaluated.
      // Otherwise the operator is evaluated over the collection the operand
      // holds.
      //
      // The display preview of a view does not evaluate its operands (see
      // `heldEagerSources()`), and the preview check of step 3 answers for it.
      if (!isDisplayPreviewOf(this, options)) {
        const resolved = resolveAbsentableLazyOperands(
          this.operator,
          def,
          this._ops!,
          (x) => x.evaluate(operandOptions(options))
        );
        if (resolved !== undefined) {
          if ('error' in resolved) return resolved.error;
          if (resolved.absent) return absentScalarMarker(this.engine, this);
          return this._withParseScope(() =>
            this.engine.function(this._operator, resolved.ops)
          ).evaluate(options);
        }
      }

      //
      // 2c''/ A LAZY operator over a source that is not a collection value
      // yet (`heldEagerSources`): an element read `At(t, 1)`, an eager
      // operator, a call of a user function. The source is evaluated once,
      // and the operator is evaluated again over its value. An error value
      // is the value of the node.
      //
      {
        const resolved = resolveHeldEagerSources(this, def, options);
        if (resolved !== undefined) {
          if ('error' in resolved) return resolved.error;
          return this._withParseScope(() =>
            this.engine.function(this._operator, resolved.ops)
          ).evaluate(options);
        }
      }

      //
      // 2d/ A lazy collection that PROMISES a string
      //
      const preserved = evaluateStringPreservingCollection(this, def);
      if (preserved) return preserved;

      //
      // 3/ Handle evaluation of lazy collections. A view over an operand that
      // is not a collection value yet is materialized after its operands are
      // evaluated (`materializesAfterOperands`).
      //
      // The display preview of a view over an operand that is not a
      // collection value yet is the view as written. This test comes before
      // the test for a node that can be absent: the type of such a view can
      // include `missing`, and the evaluation of the operands (step 4) then
      // evaluated the operand for the preview. It applies to a view with an
      // `evaluate` handler too (`Dedup`): the handler declines for the
      // preview, and the materialization of its result evaluated the operand.
      if (previewHoldsEagerOperand(this, options)) return this;
      if (materialization !== false && !def.evaluate && this.isLazyCollection) {
        if (
          !mayBeAbsentAsWhole(this) &&
          !materializesAfterOperands(this, def, options)
        )
          return materialize(this, def, options);
      }

      //
      // 3a/ A view that reads its source by a position computed from the
      // count of the source (`Reverse`, `Most`, `RotateLeft`, `RotateRight`)
      // cannot be enumerated over a finite source with no count
      // (`FlatMap([1, 2], x ↦ [x, x])`), so a consumer of its value (`Sum`,
      // `Max`, `First`) stayed unevaluated. Its evaluation lists the source
      // ONCE, and the value is the same view over that list
      // (`viewOverListedSource()`), which a consumer can walk. When the
      // source cannot be listed, the evaluation continues as before. The
      // materialization of step 3 does the same listing.
      //
      if (
        materialization === false &&
        !def.evaluate &&
        this.isLazyCollection &&
        !isDisplayPreviewOf(this, options)
      ) {
        const listedView = viewOverListedSource(this);
        if (listedView) return listedView.evaluate(options);
      }

      //
      // 3b/ `.N()` of an already-evaluated lazy `Map` (the hybrid-laziness
      // broadcast form): the `Map` has no `evaluate` handler, so without this
      // step the `numericApproximation` flag would be dropped and elements
      // would keep evaluating EXACTLY on access. Rewrap the mapping function
      // in `N` so elements float on access — laziness preserved. Runs after
      // step 3 so an explicit materialization still wins.
      //
      if (numericApproximation && !def.evaluate && this.isLazyCollection) {
        const nLazy = lazyMapNumericApproximation(this.engine, this);
        if (nLazy) return nLazy;
      }

      //
      // 4/ Evaluate the applicable operands in the current scope
      //
      // Without `materialization`: that option describes the result, and a
      // lazy operand must reach the handler in its lazy form
      // (`operandOptions`).
      // Under `.N()`, an operand at an `integer`-typed parameter is evaluated
      // EXACTLY (`exactIntegerOperand()`): the handler reads such an operand
      // as an integer, and the float of a large one is rounded to the
      // working precision before it is read, so `DigitSum(2^1000).N()` gave
      // 84 where the digit sum is 1366.
      // The exponent of a `Power` whose value decides between the matrix
      // power and the element-wise power is evaluated exactly too
      // (`evaluatesExponentExactly()`).
      const exactExponent = this._evaluatesExponentExactly(options);
      const exactIntegerAt = numericApproximation
        ? integerParameterPositions(def)
        : undefined;
      const tail = holdMap(this, (x, index) =>
        (exactIntegerAt !== undefined && exactIntegerAt(index)) ||
        (exactExponent && index === 1)
          ? exactIntegerOperand(x, options)
          : // A value that the finiteness read of this evaluation computed
            // for the operand (`_isMemoizableLazyCollection()`); such a read
            // happens under a plain `evaluate()` only.
            (takeEagerSourceValue(this, x) ??
            x.evaluate(operandOptions(options)))
      );

      //
      // 4-err/ An operand has now evaluated to an error — either one held
      // back by the demanded-operands rule whose arm a selection did demand,
      // or one MINTED by this evaluation (`Sin(Length(5))`, `1 + f(x)` for a
      // failing user function). Either way the error is that operand's
      // VALUE, and an error value in an operand position bubbles like any
      // other (rung 3; `docs/ERROR-MODEL.md` §3 draws no line between the
      // two). Absorbing it HERE, before the handler, is what keeps a handler
      // from answering something else about an operand it cannot use —
      // `Sin(<error>)` must be the error, not `NaN` — and what keeps the
      // fallback below from re-boxing the operator over the error into an
      // invalid tree.
      //
      // The gate depends on how the node arrived: a node that was invalid at
      // boxing time uses the late-absorption predicate (which excludes a
      // selecting operator scanning its OWN operands — `tail` still holds
      // them unevaluated, and there an error is precisely the arm whose
      // demand is not decided yet, so the absorption belongs on the result
      // instead); a node that was valid uses `_absorbsEvaluatedOperandError`,
      // the same exclusions without the invalid-tree premise. The scan
      // itself costs one cached `isValid` read per operand.
      //
      const absorbsOperandErrors = this.isValid
        ? this._absorbsEvaluatedOperandError()
        : this._absorbsErrorAfterHandler() && !this._defersErrorAbsorption();
      if (absorbsOperandErrors) {
        for (let i = 0; i < tail.length; i++) {
          if (tail[i].isValid || this._holdsRefusedOperand(tail, i)) continue;
          const err = errorValue(tail[i], {
            operator: this._operator,
            index: i + 1,
          });
          if (err !== undefined) return err;
        }
      }

      // The resolved overload arm for the Contract B gates below, computed
      // at most once per evaluation: both the NaN-policy gate and the
      // partiality gate consult it, and re-deriving a cold-path overload
      // resolution twice in one call is waste.
      let cbArmCache: Type | undefined;
      let cbArmComputed = false;
      const contractBArm = (): Type | undefined => {
        if (!cbArmComputed) {
          cbArmComputed = true;
          cbArmCache =
            def instanceof _BoxedOperatorDefinition
              ? resolvedArm(this, def.signature.type)
              : undefined;
        }
        return cbArmCache;
      };
      // Explicitly `boolean`: the raw type-predicate result would narrow
      // `def` to `never` past the negations in the gates below (the
      // predicate names the whole class).
      const cbIsUserFn: boolean = isUserFunctionDef(def);

      //
      // 4a-0/ Contract B NaN-policy gate (`docs/ERROR-MODEL.md` §4). Runs
      // BEFORE the missing-value gate so the stronger channel wins when both
      // fire (§4 composition rule step 3: a `reject`-slot `NaN` → `Error`
      // beats a propagating absence → `NaN`). The gate reads the RESOLVED
      // per-slot policy: for every operator whose carriers still admit `nan`
      // the policy is `'inert'` and the gate stands down — `NaN` is an
      // ordinary domain member there and the handler owns it — so behavior
      // only binds as signatures migrate to precise Contract B carriers (or
      // declare `nanBehavior` explicitly). Runs on the EVALUATED tail, so
      // sibling operands' effects and evaluation counts never change (§4
      // composition rule step 2). The collection-shape stand-down and the
      // per-element broadcast re-entry are the missing gate's (4a below);
      // this test must stay in lockstep with its twin in `evaluateAsync`
      // (step 3a-0).
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        // Lazy operators are a sanctioned opt-out (`docs/ERROR-MODEL.md`
        // §4): they own their operand handling — a held operand's NaN can
        // carry operator-specific meaning (`WithRandomSeed` answers its own
        // structured out-of-range error for a NaN seed) — and the dispatch
        // conformance check excludes them for the same reason.
        def.lazy !== true &&
        // User functions (lambdas, multi-clause definitions) are a
        // sanctioned opt-out too: their own dispatch owns the NaN — a
        // clause guarded on `NaN` or `infinity` must SEE the value, and a
        // wide fallback clause must catch it — exactly why the dispatch
        // conformance check (`genericRuntimeConformance`) excludes them.
        !cbIsUserFn &&
        // An application never answers `isNaN === true` (its getter answers
        // `false` or `undefined`), but asking it derives the operand's TYPE
        // — for a symbolic residue that survived evaluation, a derivation
        // nothing else reads. Only a literal or a symbol can hold the marker.
        tail.some((x) => !isFunction(x) && x.isNaN === true) &&
        // The collection stand-down is scoped to BROADCASTABLE operators:
        // only there does the element-wise broadcast re-enter this gate per
        // cell. A non-broadcastable operator takes a collection operand as
        // an ordinary whole value, so the policy on its scalar slots still
        // applies.
        !(
          def.broadcastable === true &&
          tail.some((x) => x.isCollection || x.type.matches('collection<any>'))
        )
      ) {
        // Per-overload attachment (`docs/ERROR-MODEL.md` §4): the derived
        // per-slot policy reads the RESOLVED arm's carriers when the call
        // resolved an overload set; a plain signature answers `undefined`
        // here at trivial cost.
        const nanArm = contractBArm();
        let sawPropagate = false;
        for (let i = 0; i < tail.length; i++) {
          if (tail[i].isNaN !== true) continue;
          const policy = def.resolvedNanBehaviorAt(i, nanArm);
          if (policy === 'reject')
            return this.engine.error([
              'unexpected-argument',
              tail[i].toString(),
            ]);
          if (policy === 'propagate') sawPropagate = true;
        }
        // Across channels the stronger verdict wins (`docs/ERROR-MODEL.md`
        // §4, composition rule step 3): when the MISSING channel is about
        // to reject — an absent operand at a `reject` operator, decided by
        // the missing gate below — that Error beats this quiet NaN, so fall
        // through instead of answering.
        // The answer is `NaN`, except that an `Indeterminate` operand is
        // forwarded when no operand is `NaN` or a float
        // (`nanOperandAnswer()`): `Sin(Indeterminate)` is `Indeterminate`.
        // A numeric approximation always answers `NaN`.
        if (
          sawPropagate &&
          !(
            def.resolvedMissingBehavior === 'reject' &&
            tail.some(isAbsentScalarSymbol)
          )
        )
          return numericApproximation
            ? this.engine.NaN
            : nanOperandAnswer(this.engine, tail);
      }

      //
      // 4a-1/ Contract B partiality channels (`docs/ERROR-MODEL.md` §4;
      // Phase D of `docs/plans/2026-08-30-error-model-implementation.md`).
      // `requires` is the contract precondition — provably false → the
      // Error channel (§2 rule 6). `definedWhen` is the mathematical
      // domain condition — provably false → the codomain marker (§2 rule
      // 4): `NaN` into a numeric codomain, `Missing` — the one primitive
      // quiet datum — into a settled non-numeric or indeterminate one,
      // read off the RESOLVED arm for an overload set. Runs on the
      // evaluated tail, after the NaN row (the §4 behavior table orders
      // the NaN policy first), with the broadcast stand-down of the
      // sibling gates. An `undefined` verdict (undecidable for these
      // arguments) falls through to the handler. Lockstep twin:
      // `evaluateAsync` step 3a-1.
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        // Lazy operators and user functions are sanctioned opt-outs — see
        // the NaN gate above.
        def.lazy !== true &&
        !cbIsUserFn &&
        (def.requires !== undefined || def.definedWhen !== undefined) &&
        !(
          def.broadcastable === true &&
          tail.some((x) => x.isCollection || x.type.matches('collection<any>'))
        )
      ) {
        // The predicates carry a never-throw purity contract, but a
        // violation must not crash evaluation: a throw reads as
        // "undecidable", exactly the fall-through verdict.
        let requiresVerdict: boolean | undefined;
        try {
          requiresVerdict = def.requires?.(tail);
        } catch {
          requiresVerdict = undefined;
        }
        if (requiresVerdict === false)
          return this.engine.error([
            'evaluation-error',
            `the arguments do not satisfy the precondition of ${this.operator}`,
          ]);
        let definedVerdict: boolean | undefined;
        try {
          definedVerdict = def.definedWhen?.(tail);
        } catch {
          definedVerdict = undefined;
        }
        if (definedVerdict === false) {
          // The codomain marker (`docs/ERROR-MODEL.md` §2 rule 4), read
          // off the RESOLVED arm for an overload set: into a numeric
          // codomain, the indeterminate form `Indeterminate` (`Mod(5, 0)`,
          // `Fract(∞)`: the operands are inside the carrier, and the
          // operation has no value there), or `NaN` when an operand is a
          // float (`indeterminateFormAnswer()`); `Missing` — the one
          // primitive quiet datum — for a settled non-numeric or
          // indeterminate one.
          const markerArm = contractBArm();
          const resultT =
            functionResult(markerArm ?? def.signature.type) ?? 'unknown';
          return isSubtype(resultT, 'number')
            ? indeterminateFormAnswer(this.engine, tail)
            : this.engine.Missing;
        }
      }

      //
      // 4a/ Missing-value behavior gate (§3.E of the missing-value typing
      // design). A `propagate` operator with an absent SCALAR operand
      // (`Missing`, `Undefined`, or a `NaN`) answers the quiet marker of its
      // own codomain
      // (`absentScalarMarker`, `validate.ts`): `NaN` in a numeric result cell
      // (I6 absorption), and the position-preserving `Missing` when the
      // application is typed anything else — a point, a collection, or a type
      // that is not provably numeric. The gate applies only when NO operand
      // is a collection: a scalar-vs-collection application
      // (`Add(Missing, matrix)`) broadcasts the absence per cell through the
      // operator's own kernel (packing demotion, tensor-view). Under an
      // element-wise broadcast (step 2 above) the gate re-enters per element
      // (`Sin([1,Missing,3])` → `[Sin(1), NaN, Sin(3)]`). A `reject` operator
      // errors at an absent operand in BOTH strict modes (the behavior gate,
      // not validation).
      //
      if (def instanceof _BoxedOperatorDefinition) {
        const behavior = def.resolvedMissingBehavior;
        // The gate fires on an absence SYMBOL — `Missing` or `Undefined`
        // — and only when no operand is collection-shaped: both conditions
        // live in `hasAbsentScalarOperand` (`validate.ts`), which the async
        // twin (step 3a) and the lazy `Add`/`Multiply` handlers share, so
        // the three routes decide the same question the same way.
        // The gate stands aside beside a collection operand for a
        // BROADCASTABLE operator only, where the absence lands in each cell
        // (`Add(Missing, matrix)`). A collection operator that is not
        // broadcastable (`Zip(L, Missing)`, `Dot(P, Missing)`) computes on
        // the whole operand, so an absent one makes the whole answer absent:
        // the marker of the codomain (user decision 2026-09-25).
        if (
          (behavior === 'propagate' || behavior === 'reject') &&
          (def.broadcastable
            ? hasAbsentScalarOperand(tail)
            : tail.some(
                (x, i) =>
                  // A `propagate` operator answers the marker only for an
                  // absent operand at a position that strips `missing`
                  // (`missingStrip`). At any other position the handler
                  // receives the absent operand and gives its own answer:
                  // `Contains([1, 2], Missing)` is `False`, because a search
                  // for an absent value finds nothing (user decision
                  // 2026-09-26).
                  (behavior === 'reject' || def.stripsMissingAt(i)) &&
                  isAbsentScalarSymbol(x)
              ))
        ) {
          if (behavior === 'reject')
            return this.engine.error([
              'unexpected-argument',
              // Name the operand that is actually absent: the gate accepts
              // both `Missing` and `Undefined`, so a fixed `Missing` in the
              // message would misreport an `Undefined` operand.
              (
                tail.find(isAbsentScalarSymbol) ?? this.engine.Missing
              ).toString(),
            ]);
          return absentScalarMarker(this.engine, this);
        }
        // The default for an operator with no absence behavior of its own
        // (`pass-through`): an absent operand at a position whose declared
        // parameter excludes absence is an `incompatible-type` error naming
        // that parameter, as a user function answers for the same argument
        // (`refusesAbsentOperandAt`, `boxed-operator-definition.ts`; user
        // decision P2, 2026-10-21). The handler no longer sees the marker.
        if (behavior === 'pass-through') {
          const k = tail.findIndex(
            (x, i) => isAbsentScalarSymbol(x) && def.refusesAbsentOperandAt(i)
          );
          if (k >= 0)
            // With the breadcrumb a handler's own refusal carries: the
            // operator and the 1-based position of the refused operand.
            return withErrorFrames(
              this.engine.typeError(
                def.declaredParameterTypeAt(k) ?? 'value',
                tail[k].type,
                tail[k]
              ),
              [{ operator: this._operator, index: k + 1 }]
            );
        }
      }

      //
      // 4b/ Broadcast over operands that only became collections *after*
      // evaluation — e.g. `Sqrt(Multiply(A, B))`, where the product evaluates
      // to a matrix. The pre-evaluation broadcast (step 2) misses these because
      // the raw operand is not yet a collection. `Add`/`Multiply` are excluded:
      // they have dedicated tensor handling (addTensors/mulTensors). This reuses
      // the already-evaluated `tail`, so scalar calls (`Sin(x)`) pay only a
      // cheap collection test.
      //
      // The same post-evaluation lift also fires for a user function literal
      // with scalar parameters (`ce.assign('k', x ↦ …)`) whose argument only
      // EVALUATES to a finite indexed collection (e.g. `k(lst(3))`, where
      // `lst(3)` reduces to `[3, -3]`). The pre-evaluation lambda broadcast
      // (step 2b) misses these because the raw operand is not yet a collection;
      // this maps ANY lambda body element-wise (not only arithmetic bodies that
      // broadcast internally), returning a `List` — matching the
      // `broadcastable<E>` application typing. Tuples stay atomic (`!isTuple`);
      // a collection-typed parameter makes `paramsAreScalar` false so the
      // argument binds whole.
      //
      const lambdaBroadcast = isUserFunctionDef(def) && paramsAreScalar(def);
      // For a LAZY operator the `tail` may still hold RAW operands whose
      // finiteness is unresolved (`Equal(Characters(s), Reverse(Characters(s)))`):
      // those must fold whole-collection, so the gate stays on the strict
      // `isKnownFinitenessBroadcast` (excludes `isFiniteCollection ===
      // undefined`). For a NON-lazy operator the operands reaching this gate are
      // already evaluated, so unknown finiteness is a genuinely-unresolved source
      // (a symbolic-length `Range`) — admit it too via `isUnknownLengthBroadcast`
      // so `Sin(Range(1,n))` lazifies into a `Map` like `Add(Range(1,n),1)` does.
      const isPostEvalBroadcastOperand = (x: Expression): boolean =>
        isKnownFinitenessBroadcast(x) ||
        (def.lazy !== true && isUnknownLengthBroadcast(x));
      const postEvalBroadcast =
        (lambdaBroadcast ||
          // An `'evaluated-operands'` exemption means the operator's own
          // evaluate handler maps operands that only became collections at
          // evaluation; this generic post-evaluation arm must not re-map them.
          (def.broadcastable &&
            !def.broadcastExemptions.includes('evaluated-operands') &&
            // A call with an operand past the declared arity is refused
            // whole by its handler, never fanned over a surplus collection
            // operand (`hasSurplusOperands`, as in step 2).
            !hasSurplusOperands(def, tail) &&
            // A set has no positions, so it cannot supply cells. At a number
            // parameter the operator is not broadcast, and the handler gets
            // the whole set. At another parameter the set is used whole in
            // every cell (`unindexedOperandBroadcast`). A user function
            // (`lambdaBroadcast`) lifts a set whole into every cell, so it
            // is not affected.
            unindexedOperandBroadcast(def, tail) !== 'veto')) &&
        !skipBroadcastForVectorOps(def, false, tail) &&
        !pointIsOneLegOf(this.operator, tail) &&
        tail.some(isPostEvalBroadcastOperand);
      // The same veto as the pre-evaluation steps, decided here on the
      // EVALUATED `tail`: an operand that is collection-typed but still
      // valueless (a declared-but-unassigned `list<number>` symbol) must not
      // be spliced into every cell as a scalar
      // (`hasUnresolvedCollectionOperand`) — except when the operands that DO
      // have values already disagree in length, which no later assignment can
      // reconcile, and which is reported as the error it would be without the
      // unresolved operand.
      const unresolvedTailOperand =
        postEvalBroadcast &&
        hasUnresolvedCollectionOperand(tail, isBroadcastableCollection);
      if (unresolvedTailOperand) {
        const mismatch = broadcastLengthMismatch(this.engine, tail);
        if (mismatch) return mismatch;
      }
      if (postEvalBroadcast && !unresolvedTailOperand) {
        // An operand that only became a square matrix at evaluation
        // (`Power(Add(B, B), 2)`) takes the matrix power, as in step 2. See
        // `squareMatrixPower()`.
        if (this.operator === 'Power' && this._isBoundToLibraryDefinition()) {
          const matrixPower = squareMatrixPower(
            this.engine,
            tail,
            options,
            this._ops![1]
          );
          if (matrixPower !== undefined) return matrixPower.evaluate(options);
        }
        // Hybrid laziness: past the eager threshold — and for a materialized
        // infinite (`Cycle`) or uncountable-finite (`Filter`) source, gated by
        // `isKnownFinitenessBroadcast` so a not-yet-resolved operand held raw by
        // a lazy operator is left to fold — return the lazy `Map` form over the
        // already-evaluated `tail`.
        // Length-mismatch ruling (2026-07-24), before the lazy form so size
        // does not decide the semantics. `tail` is already evaluated, so the
        // purity half (evaluate lifted operands once) does not apply here.
        const mismatch = broadcastLengthMismatch(this.engine, tail);
        if (mismatch) return mismatch;

        // Under `.N()`, a jump operator (`Floor`, `Sign`, ...) maps over the
        // exact sources (`exactJumpLazyBroadcastOperands()`).
        const lazy = withCallableBinding(this, () =>
          lazyBroadcastMapIfNeeded(
            this.engine,
            this.operator,
            exactJumpLazyBroadcastOperands(this, tail, numericApproximation) ??
              tail,
            isBroadcastableCollection,
            numericApproximation
          )
        );
        if (lazy) return lazy;

        // For a user function a tuple (a point) is lifted whole into every
        // cell, not zipped; a builtin operator zips it (a tuple zipped
        // against a list supplies cells, pinned by its tests).
        // Under `.N()`, a jump operator (`Floor`, `Sign`, ...) builds its
        // cells from the exact elements when a float is near a jump
        // (`exactJumpBroadcastOperands()`).
        const items = lambdaBroadcast
          ? zipBroadcast(tail, isBroadcastableCollection)
          : // A set at a parameter that is not a number type is used whole in
            // every cell (`unindexedOperandBroadcast`).
            (unindexedOperandBroadcast(def, tail) === 'lift'
              ? zipLiftingUnindexed
              : zip)(
              exactJumpBroadcastOperands(this, tail, numericApproximation) ??
                tail
            );
        if (items) {
          const results: Expression[] = [];
          // Element-wise context, for the LAMBDA broadcast only (see step 2b):
          // a builtin `broadcastable` operator keeps its historical errors.
          try {
            while (true) {
              const { done, value } = items.next();
              if (done) break;
              results.push(this._withSameBinding(value).evaluate(options));
            }
          } catch (e) {
            if (!lambdaBroadcast) throw e;
            throw withBroadcastThrowContext(
              e,
              this.operator,
              tail,
              results.length + 1
            );
          }
          // A broadcast always yields a `List`, even for a single-element
          // collection, so the value matches the `list<E>` broadcast type.
          // An operand that became the EMPTY collection only at evaluation
          // — `Sin(f())` with `f` answering `[]` — yields the empty list, the
          // same answer a literal `[]` gets in step 2 (rule of 2026-09-21,
          // `docs/BROADCAST-MODEL.md`). A computed empty source and a literal
          // one must not answer differently.
          if (lambdaBroadcast)
            return this.engine._fn(
              'List',
              annotateBroadcastErrors(
                this.operator,
                listedBroadcastCells(this.engine, results, numericApproximation)
              )
            );
          // An absent point cell answers `Missing`, not `NaN` (see step 2).
          return markAbsentPointCells(
            this.engine,
            this,
            this.engine._fn('List', results)
          );
        }
      }

      //
      // 4t/ Component-wise broadcast over TUPLE operands — `Sin((1, 2))` is
      // `(sin 1, sin 2)`, the rule the arithmetic operators already apply to
      // `(1, 2) · 3` and the one the JavaScript compile target applies when it
      // maps a scalar kernel over a tuple's array. Placed AFTER step 4b so a
      // mixed tuple-and-list application keeps its existing meaning (the list
      // supplies the cells, the tuple is lifted whole into each of them), and
      // decided on the evaluated `tail` so an operand that only becomes a
      // tuple at evaluation broadcasts like a literal one.
      //
      // Under `.N()`, a jump operator (`Floor`, `Sign`, ...) builds its cells
      // from the exact components when a float is near a jump
      // (`exactJumpBroadcastOperands()`).
      const tupleCells = tupleBroadcastCells(
        this,
        def,
        exactJumpBroadcastOperands(this, tail, numericApproximation) ?? tail
      );
      if (tupleCells !== undefined) {
        if (!Array.isArray(tupleCells)) return tupleCells;
        return this.engine._fn(
          'Tuple',
          tupleCells.map((cell) =>
            this._withSameBinding(cell).evaluate(options)
          )
        );
      }

      //
      // 4t-user/ A user function maps over a TUPLE argument at a parameter
      // declared as a scalar, as `Sin` does in step 4t
      // (`declaredScalarTupleCells`, user decision 2026-10-03): with
      // `h := (u: real) ↦ 2u`, `h((a, b))` is `(2a, 2b)`. A parameter with
      // no declared type binds the tuple whole.
      //
      {
        const userCells = this._declaredScalarTupleCells(def, tail);
        if (userCells === 'hold')
          return this._withParseScope(() =>
            this.engine.function(this.operator, tail)
          );
        if (userCells !== undefined) {
          if (!Array.isArray(userCells)) return userCells;
          return this.engine._fn(
            'Tuple',
            annotateBroadcastErrors(
              this.operator,
              listedBroadcastCells(
                this.engine,
                userCells.map((cell) =>
                  this._withSameBinding(cell).evaluate(options)
                ),
                numericApproximation
              )
            )
          );
        }
      }

      //
      // 4b-decl/ The post-evaluation twin of step 2c: a DECLARED
      // `broadcastable<T>` slot whose argument only BECAME a finite indexed
      // collection after evaluation (`f(lst(3))`). `tail` is already evaluated,
      // so the purity half of the broadcast ruling does not apply here.
      //
      if (declaredPlan && declaredLiteral) {
        const mapped = declaredBroadcast(
          this.engine,
          this.operator,
          declaredLiteral,
          declaredPlan,
          tail,
          isPostEvalBroadcastOperand,
          options
        );
        if (mapped) return mapped;
      }

      //
      // 4b-point/ A list of points at a parameter declared as a point maps
      // over the points (`pointListParamSlots`, user decision 2026-09-25).
      // Decided on the evaluated `tail`, so a `PointList` or a symbol holding
      // a list of points is seen as the list it evaluates to.
      //
      const pointPlan = pointListParamSlots(def);
      const pointLiteral = pointPlan && lambdaLiteralOf(def);
      if (pointPlan && pointLiteral) {
        const mapped = pointListBroadcast(
          this.engine,
          this.operator,
          pointLiteral,
          pointPlan,
          tail,
          tail.length === this.ops.length ? this.ops : undefined,
          options
        );
        if (mapped) return mapped;
      }

      //
      // 4c/ Thread over conditional values (`When`/`Which`) — lift the
      // conditional outward so arithmetic and function application flow
      // through it (design: docs/plans/2026-07-12-conditional-values-design.md,
      // "Threading rules"). Structurally the same lift as the broadcast steps
      // above; gated on `broadcastable` and reusing the evaluated `tail`, so a
      // scalar call pays only a cheap `isFunction` test. Logic operators are
      // excluded: Kleene logic is not strict (`And(Undefined, False)` stays
      // `False`), so lifting a guard out of them would be unsound. `Add`/
      // `Multiply` are NOT excluded (unlike step 4b): threading them before the
      // arithmetic evaluate handler is what stops a fold from silently dropping
      // a guard (`When − When`, `0·When`; see decision 5).
      //
      // An operator that is not broadcastable threads the positions its
      // `threadsConditionals` flag selects (`Dot`, `PointX`, `At`, …: the
      // operators that read a point or a vector whole). For those positions,
      // a `List` whose every cell is restricted by the same condition — the
      // value of a restricted list whose condition is not decided — is first
      // read back as that restricted list (`regroupRestrictedCells`).
      //
      // The cheap test of the lift is made first, so that an application with
      // no `When`, `Which` or `List` operand does not create the steps.
      if (
        tail.some(
          (x) =>
            isFunction(x, 'When') ||
            isFunction(x, 'Which') ||
            isFunction(x, 'List')
        )
      ) {
        const threaded = runMaterialization(
          threadConditionalOperands(this, def, tail, options),
          options
        );
        if (threaded) return threaded;
      }

      //
      // 4d/ Generic runtime conformance (R1/R8 — §4.4 of
      // docs/plans/2026-08-22-type-handlers-on-types.md). With overlap
      // admission at boxing, a handler can receive a concrete wrong-kind
      // value through a permissively-typed operand (an `any`-typed symbol,
      // an overlap-admitted symbol) — and handlers written against the
      // strict gate then misbehave (`FactorInteger(2.5)` silently rounds
      // via `toBigint`). Check each EVALUATED concrete operand against the
      // declared parameter before the handler runs; a refuted value yields
      // the same `incompatible-type` error the static gate mints for a
      // literal, a symbolic operand is left alone. Runs after the broadcast
      // and threading steps so their semantics win, and per cell on the
      // broadcast route (each cell re-enters evaluation). Excluded: lazy
      // operators (their operands are raw here — they keep their own
      // guards, §4.4/P4), user functions whose signature is derived from
      // their literal or from their clauses (`apply()` and the clause
      // dispatch run the runtime check themselves), inferred signatures (a
      // guess must not refute), and non-strict engines (O8 —
      // `strict: false` opts out of argument checking as such). A function
      // literal under a signature DECLARED on its name has the scalar
      // parameters of the declaration checked here
      // (`declaredScalarConformance`).
      //
      // A set at a numeric parameter of a built-in broadcastable operator is
      // an error. The broadcast steps above decline for such a set, and this
      // check applies with or without `strict`, as the handlers of `Power`
      // and `Sin` do (`unindexedCollectionOperandError`). It also applies to
      // an operator with no `evaluate` handler, such as the color
      // constructor `Rgb`, which broadcasts over a list.
      if (def.lazy !== true) {
        const unindexed = unindexedCollectionOperandError(
          this.engine,
          def,
          tail
        );
        if (unindexed !== undefined) return unindexed;
      }
      if (
        this.engine.strict &&
        def.lazy !== true &&
        def.evaluate !== undefined
      ) {
        const nonconforming = genericRuntimeConformance(this.engine, def, tail);
        if (nonconforming !== undefined) return nonconforming;
      }

      //
      // 5/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined;

      if (isScoped) {
        this.engine._pushEvalContext(this._localScope!, undefined, {
          ambient: true,
        });
      }

      //
      // 6/ Call the `evaluate` handler
      //
      // An absent value at a declared numeric parameter of a function
      // literal is read as `NaN` (`declaredLambdaOperands`).
      const handlerOperands = declaredLambdaOperands(this.engine, def, tail);
      const walksBefore = walksMeasuredBy(def, handlerOperands);
      const failuresBefore = failedWalksMeasuredBy(def);
      let evalResult: Expression | undefined;
      try {
        evalResult = def.evaluate?.(handlerOperands, {
          numericApproximation,
          engine: this.engine,
          materialization: materialization,
          // The node itself, so a handler can reach its RAW (pre-numericized)
          // operands — `tail` has already been evaluated. See
          // `EvaluateHandlerOptions.expression`.
          expression: this,
          // The digits requested by an enclosing `N(x, p)`, else the
          // precision of the engine. Only for a numeric approximation: an
          // exact evaluation has no precision.
          precision: numericApproximation
            ? (this.engine._requestedPrecision ?? this.engine.precision)
            : undefined,
          // Set by the enclosing `evaluate()`; the fallback covers a caller
          // that reaches this step without going through it.
          effects: this.engine._evaluationEffects ?? this.engine.effects,
        });
        // A copy of a library definition under another name keeps its head
        // (`withOwnHead()`): the library handler of `Sin` returns `Sin(x)`
        // for `MySin(x)`, and the nodes that the handler builds with the
        // name `Sin` get the name `MySin`.
        evalResult = withOwnHead(
          this.engine,
          this._operator,
          'evaluate',
          def.evaluate,
          evalResult,
          () => tail
        );
      } catch (e) {
        // An assignment to a constant keeps the source range of the
        // `Assign` node that made it, so that Epsil can match it to the
        // static report of the same assignment.
        noteConstantAssignmentSite(e, this._operator, this.sourceOffsets);
        evalResult = handlerThrowToErrorValue(
          this.engine,
          e,
          def,
          this._operator
        );
      } finally {
        if (isScoped) this.engine._popEvalContext();
      }
      // A handler that read a walk which missed elements stays unevaluated.
      // When the walk FAILED (a comprehension over a domain that is an
      // error value, `noteFailedWalk()`), that error is the result.
      if (handlerWalkMissedElements(walksBefore))
        evalResult = handlerWalkFailure(walksBefore);
      else evalResult ??= handlerWalkFailure(failuresBefore);

      // Fallback to a symbolic result if we could not evaluate. For a SCOPED
      // operator with NO evaluate handler (a lazy scoped collection —
      // `Comprehension`), whose operands did not change (all held), return
      // THIS instance rather than re-boxing: re-canonicalizing would create a
      // FRESH local scope with fresh bindings while the already-canonical
      // children keep their bindings into the original scope — a split that
      // makes the children blind to any value later installed in the new
      // scope (a comprehension walk's index values). All other operators must
      // keep re-boxing: the re-canonicalization of the tail is load-bearing
      // both for non-scoped operators (e.g. the broadcast/tensor contraction
      // of `Multiply` on operands that became collections) and for scoped
      // operators WITH a handler that declined (e.g. a symbolic `Sum`, whose
      // re-canonicalization performs big-op cleanups the rubi pipeline
      // depends on).
      const result =
        evalResult ??
        (isScoped &&
        def.evaluate === undefined &&
        this.isCanonical &&
        tail.every((x, i) => x === this._ops[i])
          ? this
          : this._withParseScope(() =>
              this.engine.function(this._operator, tail)
            ));

      // 6a/ String preservation, re-checked on the RESULT. Step 2d could only
      // see the node as authored, whose type may be a union that resolves to
      // `string` only once the operands are evaluated (see
      // `evaluateStringPreservingResult`). Declines leave `result` untouched.
      const preservedResult = evaluateStringPreservingResult(result);
      if (preservedResult !== result) return preservedResult;

      // 6b/ A lazy collection answered by the handler is materialized as
      // asked (`materializeLazyResult`).
      const materializedResult = materializeLazyResult(
        result,
        options,
        handlerMaterializedElements(def, this._operator, result)
      );
      if (materializedResult !== result) return materializedResult;

      // 6c/ Pole-aware numeric evaluation: at a known pole, N() yields
      // ComplexInfinity rather than NaN/garbage (analytic-property store).
      if (numericApproximation)
        return applyPoleOverride(this.engine, this._operator, tail, result);
      return result;
    };
  }

  /** `sourceValues` holds the values of eager operands that the finiteness
   * read of this evaluation computed (`_evaluateAsyncUncounted()`). */
  _computeValueAsync(
    options?: Partial<EvaluateOptions>,
    sourceValues?: EagerSourceValues
  ): () => Promise<Expression> {
    const compute = this._computeValueAsyncUnabsorbed(options, sourceValues);
    // Late error absorption, mirroring `_computeValue` — both branches.
    if (this.isValid) {
      const selecting = this._defersErrorAbsorption();
      if (!selecting && !this._absorbsEvaluatedOperandError()) {
        if (!this._mayRefuseUnindexedSource()) return compute;
        return async () => {
          const result = await compute();
          if (result.isValid) return result;
          return this._refusedUnindexedSourceError(result) ?? result;
        };
      }
      return async () => {
        const since = errorRecordCount;
        const result = await compute();
        if (result.isValid) return result;
        if (selecting) return this._resultError(result, since) ?? result;
        return (
          this._refusedArgumentError(result) ?? errorValue(result) ?? result
        );
      };
    }
    if (!this._absorbsErrorAfterHandler()) {
      if (!this._mayRefuseUnindexedSource()) return compute;
      return async () => {
        const result = await compute();
        return this._refusedUnindexedSourceError(result) ?? result;
      };
    }
    return async () => {
      const since = errorRecordCount;
      const result = await compute();
      return this._errorAfterHandler(result, since) ?? result;
    };
  }

  private _computeValueAsyncUnabsorbed(
    options?: Partial<EvaluateOptions>,
    sourceValues?: EagerSourceValues
  ): () => Promise<Expression> {
    return async () => {
      // Cooperative deadline checkpoint — see `_computeValue`.
      checkDeadlineEvery(this.engine._deadlineFrame, 0x3ff);

      if (!this._def) return this;
      if (!this.isValid) {
        const invalid = this._invalidValue();
        if (invalid !== undefined) return invalid;
      }

      // 0/ Splice spread arguments — mirrors the sync path (the spread
      // argument itself resolves synchronously; the rebuilt call continues
      // async).
      const spliced = this._spliceSpreadOps();
      if (spliced !== null) {
        if (!Array.isArray(spliced)) return spliced as Expression;
        return this.engine
          .function(this.operator, spliced as Expression[])
          .evaluateAsync(options);
      }

      const numericApproximation = options?.numericApproximation ?? false;

      //
      // 1/ Check if the operator is a function literal
      //

      if (isValueDef(this._def))
        return applyFunctionLiteralAsync(this, this._def.value, options);

      const def = this._def.operator;

      // 1b/ See the synchronous route.
      if (def.lazy === true && this._localScope === undefined) {
        const heldError = heldErrorCallback(this, def);
        if (heldError !== undefined) return heldError;
      }

      //
      // 2/ Broadcast if applicable
      // Add/Multiply skip when some operand is a RAW function expression that
      // is not (yet) a collection — zipping it as a repeated scalar
      // cartesian-explodes when it evaluates to a collection; `add()`/`mul()`
      // broadcast those soundly on EVALUATED operands (see the sync path).
      //
      // O(rank) candidate check (§D4.2 hot-path contract): dispatch must
      // never pay the O(cells) type computation per broadcast evaluation.
      // Kernel entries (addTensors/mulTensors) fully qualify + pack, and
      // DECLINE non-qualified candidates back to the generic broadcast path.
      const hasTensors = this.ops!.some((x) => candidateShape(x) !== null);
      // As on the sync path: an operator whose handlers own evaluated-operand
      // broadcasting defers an unevaluated function operand to them.
      const hasRawOperand =
        (def?.broadcastExemptions.includes('evaluated-operands') ?? false) &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      const operatorBroadcast =
        def?.broadcastable &&
        // Mirrors the sync path: a user function (a function literal or a
        // multi-clause definition) takes its own step-2b arm.
        !isUserFunctionDef(def) &&
        !hasRawOperand &&
        // A surplus operand keeps the call whole (mirrors the sync path).
        !hasSurplusOperands(def, this.ops!) &&
        this.ops!.some((x) => isFiniteBroadcastParticipant(x)) &&
        // A set has no positions (mirrors the sync path).
        unindexedOperandBroadcast(def, this.ops!) !== 'veto' &&
        !skipBroadcastForVectorOps(def, hasTensors, this.ops!) &&
        !pointIsOneLegOf(this.operator, this.ops!);
      // The veto and the definite-mismatch exception of the sync step 2,
      // unchanged: an operand that is collection-TYPED but carries no
      // collection value yet would be spliced whole into every cell as a
      // scalar, while a length disagreement among the operands that DO have
      // values is an error no later assignment can reconcile.
      const unresolvedBroadcastOperand =
        operatorBroadcast === true &&
        hasUnresolvedCollectionOperand(this.ops!, isBroadcastableCollection);
      if (unresolvedBroadcastOperand) {
        const mismatch = broadcastLengthMismatch(this.engine, this.ops!);
        if (mismatch) return mismatch;
      }
      if (operatorBroadcast && !unresolvedBroadcastOperand) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — return the lazy `Map` form.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (mirrors the sync path).
        // Broadcast rulings (2026-07-24) — mirrors the sync path in step 2,
        // including running before the lazy form.
        const bops = this._evaluatesExponentExactly(options)
          ? [
              ...(await evaluateBroadcastLiftsOnceAsync(
                [this._ops![0]],
                options,
                this.operator
              )),
              normalizeLiftedAbsence(
                this._ops![1],
                await exactIntegerOperandAsync(this._ops![1], options)
              ),
            ]
          : await evaluateBroadcastLiftsOnceAsync(
              this._ops!,
              options,
              this.operator
            );
        const liftError = this._liftedOperandError(bops);
        if (liftError !== undefined) return liftError;
        // The matrix power of a square matrix (mirrors the sync path).
        if (this.operator === 'Power' && this._isBoundToLibraryDefinition()) {
          const matrixPower = squareMatrixPower(
            this.engine,
            bops,
            options,
            this._ops![1]
          );
          if (matrixPower !== undefined)
            return matrixPower.evaluateAsync(options);
        }
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;
        // A lift can be a set only when it is evaluated (mirrors the sync
        // path).
        const unindexed = unindexedOperandBroadcast(def, bops);
        if (unindexed === 'veto')
          return this._withSameBinding(bops).evaluateAsync(options);

        // A lazy `Map` operand is read through its numeric callback under
        // `.N()`, except by a jump operator (mirrors the sync path).
        const cellOps =
          numericApproximation && !JUMP_BROADCAST_OPERATORS.has(this.operator)
            ? bops.map(
                (op) =>
                  (op.isLazyCollection &&
                    lazyMapNumericApproximation(this.engine, op)) ||
                  op
              )
            : bops;

        const lazy = withCallableBinding(this, () =>
          lazyBroadcastMapIfNeeded(
            this.engine,
            this.operator,
            cellOps,
            isBroadcastableCollection,
            numericApproximation
          )
        );
        if (lazy) return lazy;

        const items =
          unindexed === 'lift' ? zipLiftingUnindexed(cellOps) : zip(cellOps);
        if (!items) return this.engine._fn('List', []);

        const results: Promise<Expression>[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;

          results.push(this._withSameBinding(value).evaluateAsync(options));
        }

        // Always wrap in a `List` — even a single-element broadcast — so the
        // value matches the `list<E>` broadcast type, and a lone empty
        // operand answers the empty list (mirrors the sync path). An absent
        // point cell answers `Missing`, not `NaN` (mirrors the sync path).
        return Promise.all(results).then((resolved) =>
          markAbsentPointCells(
            this.engine,
            this,
            this.engine._fn('List', resolved)
          )
        );
      }

      //
      // 2b/ Broadcast user-defined function literals over indexed collections.
      // Mirrors the sync path in `_computeValue`.
      //
      const scalarUserFunction = isUserFunctionDef(def) && paramsAreScalar(def);
      const lambdaElementwise =
        scalarUserFunction &&
        this.ops!.some((x) => isFiniteBroadcastParticipant(x));
      // The veto and the hold of the sync step 2b, unchanged — a collection-
      // TYPED operand with no value yet must not be bound as a per-element
      // scalar, and declining alone would let the lambda be applied to the
      // whole operands and its body inlined, which is the same capture one rank
      // up.
      // The hold does not need a sibling that already HAS a collection value:
      // with `h(n: integer) = n + 1` and a valueless `xs: list<integer>`,
      // `h(xs)` alone was applied to the symbol and refused by argument
      // validation as `incompatible-type` (or by clause dispatch as
      // `no-matching-clause`), where the argument maps element-wise as soon
      // as it has a value. The honest answer is the held application, which
      // a later evaluation broadcasts once `xs` is assigned.
      // Only a SYMBOL with no value is held on that ground
      // (`isValuelessCollectionSymbol`): an operand that merely becomes a
      // collection when evaluated (`k(lst(3))`) is left to the
      // post-evaluation broadcast (step 4b), and a symbol that holds a
      // scalar under a `number | list<number>` declaration applies at once.
      if (
        (lambdaElementwise &&
          hasUnresolvedCollectionOperand(
            this.ops!,
            isBroadcastableCollection
          )) ||
        (scalarUserFunction && this.ops!.some(isValuelessCollectionSymbol))
      ) {
        const mismatch = broadcastLengthMismatch(this.engine, this.ops!);
        if (mismatch) return mismatch;
        const held = await Promise.all(
          this.ops!.map((x) => x.evaluateAsync(operandOptions(options)))
        );
        // The held application is built after the `await` above, when the
        // engine does not keep the registry and the context stack of this
        // evaluation installed: put them in place for the build.
        return runWithEvaluationEffects(
          this.engine,
          options?._effects ??
            this.engine._evaluationEffects ??
            this.engine.effects,
          () => this.engine.function(this.operator, held),
          options?._contextStack,
          options?._precisionWindow
        );
      }
      if (lambdaElementwise) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — map the lambda lazily.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (step 4b/3b) once their count resolves.
        // Broadcast rulings (2026-07-24) — mirrors the sync path in step 2b,
        // including running before the lazy form.
        const bops = await evaluateBroadcastLiftsOnceAsync(
          this._ops!,
          options,
          this.operator
        );
        const liftError = this._liftedOperandError(bops);
        if (liftError !== undefined) return liftError;
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = withCallableBinding(this, () =>
          lazyBroadcastMapIfNeeded(
            this.engine,
            this.operator,
            bops,
            isBroadcastableCollection,
            numericApproximation
          )
        );
        if (lazy) return lazy;

        const items = zipBroadcast(bops, isBroadcastableCollection);
        if (items) {
          const results: Promise<Expression>[] = [];
          while (true) {
            const { done, value } = items.next();
            if (done) break;
            // `Promise.all` cannot attribute a rejection to a slot, but each
            // promise is created in a KNOWN one: enrich per element, where the
            // index is still in hand. The outer handler below stays as a
            // backstop and does not double-annotate (the enrichment is
            // idempotent).
            const index = results.length + 1;
            results.push(
              this.engine
                ._fn(this.operator, value)
                .evaluateAsync(options)
                .catch((e) => {
                  throw withBroadcastThrowContext(
                    e,
                    this.operator,
                    bops,
                    index
                  );
                })
            );
          }
          // Element-wise context — mirrors the sync step 2b.
          // The listing of the cells evaluates synchronously after the
          // `await`, so it runs with the capability registry and the context
          // stack of this evaluation put in place again.
          return Promise.all(results).then(
            (resolved) =>
              this.engine.withEvaluationContext(options, () =>
                this.engine._fn(
                  'List',
                  annotateBroadcastErrors(
                    this.operator,
                    listedBroadcastCells(
                      this.engine,
                      resolved,
                      numericApproximation
                    )
                  )
                )
              ),
            (e) => {
              throw withBroadcastThrowContext(e, this.operator, bops);
            }
          );
        }
      }

      //
      // 2b-decl/ Broadcast over the slots a DECLARED `broadcastable<T>`
      // signature marks elementwise — mirrors the sync step 2c.
      //
      const declaredPlan = broadcastableParamSlots(def);
      const declaredLiteral = declaredPlan && lambdaLiteralOf(def);
      if (
        declaredPlan &&
        declaredLiteral &&
        // Evaluate-once, and the same predicate as the broadcast below, as in
        // the sync step 2c — see the note there.
        someMappableCollection(this.ops!, declaredPlan, (x) =>
          isFiniteBroadcastParticipant(x)
        )
      ) {
        const declaredOps = await evaluateBroadcastLiftsOnceAsync(
          this._ops!,
          options,
          this.operator
        );
        const liftError = this._liftedOperandError(declaredOps);
        if (liftError !== undefined) return liftError;
        const mapped = await declaredBroadcastAsync(
          this.engine,
          this.operator,
          declaredLiteral,
          declaredPlan,
          declaredOps,
          (x) => isFiniteBroadcastParticipant(x),
          options
        );
        if (mapped) return mapped;
      }

      //
      // 2c/ Handle evaluation of lazy collections — mirrors the sync path's
      // step 3 (the "Async" follow-up of
      // `docs/COLLECTIONS-MODEL.md`: the async
      // path had NO materialization step at all, so every `materialization`
      // form silently returned the lazy view). All four forms — `false`,
      // `true`, an integer, `[head, tail]` — now behave as they do
      // synchronously. The walk of `materialize()` is shared rather than
      // duplicated (`materializationSteps`), and `materializeAsync()` awaits
      // each element it keeps, so an element that applies an operator with
      // only an `evaluateAsync` handler (`Map(AsyncOnly, [1, 2])`) holds the
      // value of that application.
      //
      // A lazy operator over a collection operand that can be absent as a
      // whole: mirrors the sync path's step 2c'. The operand is evaluated on
      // the asynchronous route, so an operand that holds an
      // asynchronous-only application is evaluated as its operator would
      // evaluate it.
      if (!isDisplayPreviewOf(this, options)) {
        const resolved = await resolveAbsentableLazyOperandsAsync(
          this.operator,
          def,
          this._ops!,
          (x) => x.evaluateAsync(operandOptions(options))
        );
        if (resolved !== undefined) {
          if ('error' in resolved) return resolved.error;
          if (resolved.absent) return absentScalarMarker(this.engine, this);
          // The call is rebuilt after an `await`, so it is canonicalized in
          // the context of this evaluation (the scope of an enclosing `Sum`
          // index, for example), not in the global scope.
          return await this.engine
            .withEvaluationContext(options, () =>
              this._withParseScope(() =>
                this.engine.function(this._operator, resolved.ops)
              )
            )
            .evaluateAsync(options);
        }
      }

      // A lazy operator over a source that is not a collection value yet:
      // mirrors the sync path's step 2c''. The source is evaluated on the
      // asynchronous route.
      {
        const resolved = await resolveHeldEagerSourcesAsync(this, def, options);
        if (resolved !== undefined) {
          if ('error' in resolved) return resolved.error;
          // As above: the call is rebuilt after an `await`.
          return await this.engine
            .withEvaluationContext(options, () =>
              this._withParseScope(() =>
                this.engine.function(this._operator, resolved.ops)
              )
            )
            .evaluateAsync(options);
        }
      }

      // A lazy collection that PROMISES a string — mirrors the sync path's
      // step 2d. The join is synchronous (a string is finite and its
      // characters are already segmented), so there is no async variant.
      const preserved = evaluateStringPreservingCollection(this, def);
      if (preserved) return preserved;

      const materialization = options?.materialization ?? false;
      // As on the sync route (step 3): a node that can be absent as a whole
      // is evaluated the ordinary way (`mayBeAbsentAsWhole`), and a view over
      // an operand that is not a collection value yet is materialized after
      // its operands are evaluated (`materializesAfterOperands`).
      // The display preview of a view over an operand that is not a
      // collection value yet is the view as written. This test comes before
      // the test for a node that can be absent: the type of such a view can
      // include `missing`, and the evaluation of the operands (step 4) then
      // evaluated the operand for the preview. It applies to a view with an
      // `evaluate` handler too (`Dedup`): the handler declines for the
      // preview, and the materialization of its result evaluated the operand.
      if (previewHoldsEagerOperand(this, options)) return this;
      if (materialization !== false && !def.evaluate && this.isLazyCollection) {
        if (
          !mayBeAbsentAsWhole(this) &&
          !materializesAfterOperands(this, def, options)
        )
          return await materializeAsync(this, def, options);
      }

      // A view that reads its source by a position computed from the count
      // of the source, over a finite source with no count: mirrors the sync
      // path's step 3a. The source is listed once, and the value is the same
      // view over that list (`viewOverListedSource()`).
      if (
        materialization === false &&
        !def.evaluate &&
        this.isLazyCollection &&
        !isDisplayPreviewOf(this, options)
      ) {
        const listedView = viewOverListedSource(this);
        if (listedView) return await listedView.evaluateAsync(options);
      }

      //
      // 2d/ `.N()` of an already-evaluated lazy `Map` — mirrors the sync
      // path's step 3b. Runs after the materialization step above, so an
      // explicit materialization still wins.
      //
      if (numericApproximation && !def.evaluate && this.isLazyCollection) {
        const nLazy = lazyMapNumericApproximation(this.engine, this);
        if (nLazy) return nLazy;
      }

      //
      // 3/ Evaluate the applicable operands
      //

      // Resolve all the operand promises. Without `materialization`, as on
      // the sync route's step 4 (`operandOptions`).
      // An operand at an `integer`-typed parameter is evaluated exactly
      // under `.N()`, as on the sync route's step 4 (`exactIntegerOperand()`).
      // The exponent of a `Power` is evaluated exactly when its value decides
      // the matrix power, as on the sync route's step 4.
      const exactExponent = this._evaluatesExponentExactly(options);
      const exactIntegerAt = numericApproximation
        ? integerParameterPositions(def)
        : undefined;
      // A value that the finiteness read of this evaluation computed for the
      // operand is used as on the sync route. The read evaluated the operand
      // synchronously, and `evaluate()` cannot run an operator that has only
      // an `evaluateAsync` handler: for an operand that holds or names such
      // an operator, the value of the read is not the value of the operand
      // on this route, and the operand is evaluated here.
      const readValue = (x: Expression): Expression | undefined =>
        sourceValues?.has(x) && !hasAsyncOnlyApplication(x, true)
          ? takeDetachedEagerSourceValue(sourceValues, x)
          : undefined;
      const tail = await holdMapAsync(this, async (x, index) =>
        (exactIntegerAt !== undefined && exactIntegerAt(index)) ||
        (exactExponent && index === 1)
          ? await exactIntegerOperandAsync(x, options)
          : (readValue(x) ?? (await x.evaluateAsync(operandOptions(options))))
      );

      //
      // 3-err/ Parity with the sync path's step 4-err: an operand that
      // evaluated to an error is this node's value, before the handler runs.
      //
      const absorbsOperandErrors = this.isValid
        ? this._absorbsEvaluatedOperandError()
        : this._absorbsErrorAfterHandler() && !this._defersErrorAbsorption();
      if (absorbsOperandErrors) {
        for (let i = 0; i < tail.length; i++) {
          if (tail[i].isValid || this._holdsRefusedOperand(tail, i)) continue;
          const err = errorValue(tail[i], {
            operator: this._operator,
            index: i + 1,
          });
          if (err !== undefined) return err;
        }
      }

      // The resolved overload arm for the Contract B gates below, computed
      // at most once per evaluation — see the sync path's twin.
      let cbArmCache: Type | undefined;
      let cbArmComputed = false;
      const contractBArm = (): Type | undefined => {
        if (!cbArmComputed) {
          cbArmComputed = true;
          cbArmCache =
            def instanceof _BoxedOperatorDefinition
              ? resolvedArm(this, def.signature.type)
              : undefined;
        }
        return cbArmCache;
      };
      // Explicitly `boolean` — see the sync path's twin.
      const cbIsUserFn: boolean = isUserFunctionDef(def);

      //
      // 3a-0/ Contract B NaN-policy gate — parity with the sync path's step
      // 4a-0 (the two must stay in lockstep). Before the missing gate so the
      // stronger channel wins; inert for every wide-carrier operator.
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        // Lazy operators are a sanctioned opt-out (`docs/ERROR-MODEL.md`
        // §4): they own their operand handling — a held operand's NaN can
        // carry operator-specific meaning (`WithRandomSeed` answers its own
        // structured out-of-range error for a NaN seed) — and the dispatch
        // conformance check excludes them for the same reason.
        def.lazy !== true &&
        // User functions (lambdas, multi-clause definitions) are a
        // sanctioned opt-out too: their own dispatch owns the NaN — a
        // clause guarded on `NaN` or `infinity` must SEE the value, and a
        // wide fallback clause must catch it — exactly why the dispatch
        // conformance check (`genericRuntimeConformance`) excludes them.
        !cbIsUserFn &&
        // An application never answers `isNaN === true` (its getter answers
        // `false` or `undefined`), but asking it derives the operand's TYPE
        // — for a symbolic residue that survived evaluation, a derivation
        // nothing else reads. Only a literal or a symbol can hold the marker.
        tail.some((x) => !isFunction(x) && x.isNaN === true) &&
        // The collection stand-down is scoped to BROADCASTABLE operators:
        // only there does the element-wise broadcast re-enter this gate per
        // cell. A non-broadcastable operator takes a collection operand as
        // an ordinary whole value, so the policy on its scalar slots still
        // applies.
        !(
          def.broadcastable === true &&
          tail.some((x) => x.isCollection || x.type.matches('collection<any>'))
        )
      ) {
        // Per-overload attachment (`docs/ERROR-MODEL.md` §4): the derived
        // per-slot policy reads the RESOLVED arm's carriers when the call
        // resolved an overload set; a plain signature answers `undefined`
        // here at trivial cost.
        const nanArm = contractBArm();
        let sawPropagate = false;
        for (let i = 0; i < tail.length; i++) {
          if (tail[i].isNaN !== true) continue;
          const policy = def.resolvedNanBehaviorAt(i, nanArm);
          if (policy === 'reject')
            return this.engine.error([
              'unexpected-argument',
              tail[i].toString(),
            ]);
          if (policy === 'propagate') sawPropagate = true;
        }
        // Across channels the stronger verdict wins (`docs/ERROR-MODEL.md`
        // §4, composition rule step 3): when the MISSING channel is about
        // to reject — an absent operand at a `reject` operator, decided by
        // the missing gate below — that Error beats this quiet NaN, so fall
        // through instead of answering.
        // The answer is `NaN`, except that an `Indeterminate` operand is
        // forwarded when no operand is `NaN` or a float
        // (`nanOperandAnswer()`): `Sin(Indeterminate)` is `Indeterminate`.
        // A numeric approximation always answers `NaN`.
        if (
          sawPropagate &&
          !(
            def.resolvedMissingBehavior === 'reject' &&
            tail.some(isAbsentScalarSymbol)
          )
        )
          return numericApproximation
            ? this.engine.NaN
            : nanOperandAnswer(this.engine, tail);
      }

      //
      // 3a-1/ Contract B partiality channels — parity with the sync path's
      // step 4a-1 (the two must stay in lockstep). `requires` false →
      // Error; `definedWhen` false → the codomain marker: `NaN` for a
      // numeric codomain, `Missing` otherwise, per the resolved arm.
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        // Lazy operators and user functions are sanctioned opt-outs — see
        // the NaN gate above.
        def.lazy !== true &&
        !cbIsUserFn &&
        (def.requires !== undefined || def.definedWhen !== undefined) &&
        !(
          def.broadcastable === true &&
          tail.some((x) => x.isCollection || x.type.matches('collection<any>'))
        )
      ) {
        // The predicates carry a never-throw purity contract, but a
        // violation must not crash evaluation: a throw reads as
        // "undecidable", exactly the fall-through verdict.
        let requiresVerdict: boolean | undefined;
        try {
          requiresVerdict = def.requires?.(tail);
        } catch {
          requiresVerdict = undefined;
        }
        if (requiresVerdict === false)
          return this.engine.error([
            'evaluation-error',
            `the arguments do not satisfy the precondition of ${this.operator}`,
          ]);
        let definedVerdict: boolean | undefined;
        try {
          definedVerdict = def.definedWhen?.(tail);
        } catch {
          definedVerdict = undefined;
        }
        if (definedVerdict === false) {
          // The codomain marker (`docs/ERROR-MODEL.md` §2 rule 4), read
          // off the RESOLVED arm for an overload set: into a numeric
          // codomain, the indeterminate form `Indeterminate` (`Mod(5, 0)`,
          // `Fract(∞)`: the operands are inside the carrier, and the
          // operation has no value there), or `NaN` when an operand is a
          // float (`indeterminateFormAnswer()`); `Missing` — the one
          // primitive quiet datum — for a settled non-numeric or
          // indeterminate one.
          const markerArm = contractBArm();
          const resultT =
            functionResult(markerArm ?? def.signature.type) ?? 'unknown';
          return isSubtype(resultT, 'number')
            ? indeterminateFormAnswer(this.engine, tail)
            : this.engine.Missing;
        }
      }

      //
      // 3a/ Missing-value behavior gate (§3.E) — parity with the sync path's
      // step 4a. A `propagate` operator with an absent scalar operand — the
      // `Missing` or `Undefined` symbol, no collection operand — yields the
      // quiet marker of its own codomain
      // (`absentScalarMarker`): `NaN` into a numeric application type,
      // `Missing` otherwise. A `reject` operator errors.
      // "No collection operand" is collection-SHAPED, not the `isCollection`
      // capability — see the sync gate (step 4a) for why the two must gain
      // this disjunct together.
      //
      if (def instanceof _BoxedOperatorDefinition) {
        const behavior = def.resolvedMissingBehavior;
        // The gate stands aside beside a collection operand for a
        // BROADCASTABLE operator only, where the absence lands in each cell
        // (`Add(Missing, matrix)`). A collection operator that is not
        // broadcastable (`Zip(L, Missing)`, `Dot(P, Missing)`) computes on
        // the whole operand, so an absent one makes the whole answer absent:
        // the marker of the codomain (user decision 2026-09-25).
        if (
          (behavior === 'propagate' || behavior === 'reject') &&
          (def.broadcastable
            ? hasAbsentScalarOperand(tail)
            : tail.some(
                (x, i) =>
                  // A `propagate` operator answers the marker only for an
                  // absent operand at a position that strips `missing`
                  // (`missingStrip`). At any other position the handler
                  // receives the absent operand and gives its own answer:
                  // `Contains([1, 2], Missing)` is `False`, because a search
                  // for an absent value finds nothing (user decision
                  // 2026-09-26).
                  (behavior === 'reject' || def.stripsMissingAt(i)) &&
                  isAbsentScalarSymbol(x)
              ))
        ) {
          if (behavior === 'reject')
            return this.engine.error([
              'unexpected-argument',
              // Name the operand that is actually absent: the gate accepts
              // both `Missing` and `Undefined`, so a fixed `Missing` in the
              // message would misreport an `Undefined` operand.
              (
                tail.find(isAbsentScalarSymbol) ?? this.engine.Missing
              ).toString(),
            ]);
          return absentScalarMarker(this.engine, this);
        }
        // The default for an operator with no absence behavior of its own
        // (`pass-through`): an absent operand at a position whose declared
        // parameter excludes absence is an `incompatible-type` error naming
        // that parameter, as a user function answers for the same argument
        // (`refusesAbsentOperandAt`, `boxed-operator-definition.ts`; user
        // decision P2, 2026-10-21). The handler no longer sees the marker.
        if (behavior === 'pass-through') {
          const k = tail.findIndex(
            (x, i) => isAbsentScalarSymbol(x) && def.refusesAbsentOperandAt(i)
          );
          if (k >= 0)
            // With the breadcrumb a handler's own refusal carries: the
            // operator and the 1-based position of the refused operand.
            return withErrorFrames(
              this.engine.typeError(
                def.declaredParameterTypeAt(k) ?? 'value',
                tail[k].type,
                tail[k]
              ),
              [{ operator: this._operator, index: k + 1 }]
            );
        }
      }

      //
      // 3b/ Broadcast over operands that only became collections after
      // evaluation (mirrors `_computeValue` step 4b, including the
      // post-evaluation lambda broadcast for scalar-parameter function
      // literals whose argument only becomes a collection after evaluation).
      //
      const lambdaBroadcast = isUserFunctionDef(def) && paramsAreScalar(def);
      // Same post-eval finiteness refinement as the sync path (finding 3):
      // a lazy operator keeps the strict gate; a non-lazy one also admits an
      // unresolved-finiteness source (symbolic-length `Range`).
      const isPostEvalBroadcastOperand = (x: Expression): boolean =>
        isKnownFinitenessBroadcast(x) ||
        (def.lazy !== true && isUnknownLengthBroadcast(x));
      // An operator with ONLY an `evaluateAsync` handler is broadcast here
      // too, as in the pre-evaluation step 2a: each cell is evaluated with
      // `evaluateAsync()`. Before, this step did not run for such an
      // operator, and its handler received the whole list:
      // `AsyncOnly([1, 2] {0<t})` with `t = 1` gave `NaN`, where
      // `AsyncOnly([1, 2])` gave `[AsyncOnly(1), AsyncOnly(2)]` evaluated
      // cell by cell. Past the eager threshold the value is the lazy `Map`
      // that step 2a gives for the same collection: its mapping applies
      // synchronously on `at`, and `materialization` evaluates each element
      // with `evaluateAsync()` (`materializeAsync()`).
      const postEvalBroadcast =
        (lambdaBroadcast ||
          // As on the sync path: an `'evaluated-operands'` exemption means
          // the operator's own evaluate handler owns this case.
          (def.broadcastable &&
            !def.broadcastExemptions.includes('evaluated-operands') &&
            // A surplus operand keeps the call whole (mirrors the sync path).
            !hasSurplusOperands(def, tail) &&
            // A set has no positions (mirrors the sync path).
            unindexedOperandBroadcast(def, tail) !== 'veto')) &&
        !skipBroadcastForVectorOps(def, false, tail) &&
        !pointIsOneLegOf(this.operator, tail) &&
        tail.some(isPostEvalBroadcastOperand);
      // The veto and the definite-mismatch exception of the sync step 4b,
      // unchanged: a collection-typed but still valueless operand must not be
      // spliced into every cell as a scalar, while a length disagreement among
      // the operands that DO have values is an error no later assignment can
      // reconcile.
      const unresolvedTailOperand =
        postEvalBroadcast &&
        hasUnresolvedCollectionOperand(tail, isBroadcastableCollection);
      if (unresolvedTailOperand) {
        const mismatch = broadcastLengthMismatch(this.engine, tail);
        if (mismatch) return mismatch;
      }
      if (postEvalBroadcast && !unresolvedTailOperand) {
        // The matrix power of a square matrix (mirrors the sync step 4b).
        if (this.operator === 'Power' && this._isBoundToLibraryDefinition()) {
          const matrixPower = squareMatrixPower(
            this.engine,
            tail,
            options,
            this._ops![1]
          );
          if (matrixPower !== undefined)
            return matrixPower.evaluateAsync(options);
        }
        // Hybrid laziness: past the eager threshold — and always for an
        // unknown/infinite-length source — return the lazy `Map` form over the
        // already-evaluated `tail` (mirrors the sync path).
        // Length-mismatch ruling (2026-07-24) — mirrors the sync step 4b,
        // before the lazy form; `tail` is already evaluated, so the purity half
        // does not apply.
        const mismatch = broadcastLengthMismatch(this.engine, tail);
        if (mismatch) return mismatch;

        // Under `.N()`, a jump operator (`Floor`, `Sign`, ...) maps over the
        // exact sources (`exactJumpLazyBroadcastOperands()`).
        const lazy = withCallableBinding(this, () =>
          lazyBroadcastMapIfNeeded(
            this.engine,
            this.operator,
            exactJumpLazyBroadcastOperands(this, tail, numericApproximation) ??
              tail,
            isBroadcastableCollection,
            numericApproximation
          )
        );
        if (lazy) return lazy;

        // For a user function a tuple (a point) is lifted whole into every
        // cell, not zipped; a builtin operator zips it (a tuple zipped
        // against a list supplies cells, pinned by its tests).
        // The async twin of the exact cells of a jump operator in the sync
        // step 4b (`exactJumpBroadcastOperands()`).
        const items = lambdaBroadcast
          ? zipBroadcast(tail, isBroadcastableCollection)
          : // A set at a parameter that is not a number type is used whole in
            // every cell (`unindexedOperandBroadcast`).
            (unindexedOperandBroadcast(def, tail) === 'lift'
              ? zipLiftingUnindexed
              : zip)(
              exactJumpBroadcastOperands(this, tail, numericApproximation) ??
                tail
            );
        if (items) {
          const results: Promise<Expression>[] = [];
          while (true) {
            const { done, value } = items.next();
            if (done) break;
            const p = this.engine
              ._fn(this.operator, value)
              .evaluateAsync(options);
            // Per-element rejection context, for the LAMBDA broadcast only (a
            // builtin `broadcastable` operator keeps its historical errors):
            // `Promise.all` cannot attribute a rejection to a slot, but each
            // promise is created in a KNOWN one. The outer handler below stays
            // as a backstop and does not double-annotate.
            const index = results.length + 1;
            results.push(
              lambdaBroadcast
                ? p.catch((e) => {
                    throw withBroadcastThrowContext(
                      e,
                      this.operator,
                      tail,
                      index
                    );
                  })
                : p
            );
          }
          // A lambda broadcast always yields a `List` (mirroring step 2b),
          // and carries the element-wise context on its failures. The listing
          // of the cells evaluates synchronously after the `await`, so it
          // runs with the capability registry and the context stack of this
          // evaluation put in place again.
          if (lambdaBroadcast)
            return Promise.all(results).then(
              (resolved) =>
                this.engine.withEvaluationContext(options, () =>
                  this.engine._fn(
                    'List',
                    annotateBroadcastErrors(
                      this.operator,
                      listedBroadcastCells(
                        this.engine,
                        resolved,
                        numericApproximation
                      )
                    )
                  )
                ),
              (e) => {
                throw withBroadcastThrowContext(e, this.operator, tail);
              }
            );
          // An operand that became the EMPTY collection only at evaluation
          // yields the empty list, the same answer a literal `[]` gets
          // (rule of 2026-09-21, `docs/BROADCAST-MODEL.md`; mirrors the sync
          // path's step 4b). An absent point cell answers `Missing`, not
          // `NaN` (mirrors the sync path).
          return Promise.all(results).then((resolved) =>
            markAbsentPointCells(
              this.engine,
              this,
              this.engine._fn('List', resolved)
            )
          );
        }
      }

      //
      // 3t/ Component-wise broadcast over TUPLE operands — the async twin of
      // the sync step 4t.
      //
      if (def) {
        const tupleCells = tupleBroadcastCells(
          this,
          def,
          exactJumpBroadcastOperands(this, tail, numericApproximation) ?? tail
        );
        if (tupleCells !== undefined) {
          if (!Array.isArray(tupleCells)) return tupleCells;
          const resolved = await Promise.all(
            tupleCells.map((cell) =>
              this._withSameBinding(cell).evaluateAsync(options)
            )
          );
          return this.engine._fn('Tuple', resolved);
        }
      }

      //
      // 3t-user/ The async twin of the sync step 4t-user.
      //
      {
        const userCells = this._declaredScalarTupleCells(def, tail);
        if (userCells === 'hold')
          return this._withParseScope(() =>
            this.engine.function(this.operator, tail)
          );
        if (userCells !== undefined) {
          if (!Array.isArray(userCells)) return userCells;
          const resolved = await Promise.all(
            userCells.map((cell) =>
              this._withSameBinding(cell).evaluateAsync(options)
            )
          );
          // The listing of the cells evaluates synchronously after the
          // `await`: put the capability registry and the context stack of
          // this evaluation in place again.
          return this.engine.withEvaluationContext(options, () =>
            this.engine._fn(
              'Tuple',
              annotateBroadcastErrors(
                this.operator,
                listedBroadcastCells(
                  this.engine,
                  resolved,
                  numericApproximation
                )
              )
            )
          );
        }
      }

      //
      // 3b-decl/ The post-evaluation twin of step 2b-decl — mirrors the sync
      // step 4b-decl.
      //
      if (declaredPlan && declaredLiteral) {
        const mapped = await declaredBroadcastAsync(
          this.engine,
          this.operator,
          declaredLiteral,
          declaredPlan,
          tail,
          isPostEvalBroadcastOperand,
          options
        );
        if (mapped) return mapped;
      }

      //
      // 3b-point/ The async twin of the sync step 4b-point.
      //
      const pointPlan = pointListParamSlots(def);
      const pointLiteral = pointPlan && lambdaLiteralOf(def);
      if (pointPlan && pointLiteral) {
        const mapped = await pointListBroadcastAsync(
          this.engine,
          this.operator,
          pointLiteral,
          pointPlan,
          tail,
          tail.length === this.ops.length ? this.ops : undefined,
          options
        );
        if (mapped) return mapped;
      }

      //
      // 3b-cond/ Thread over conditional values (`When`/`Which`) — the async
      // twin of the sync step 4c, with the same rules
      // (`threadConditionalOperands`): `Sin(When(3, c))` is `When(Sin(3), c)`
      // on both routes. On this route each application of the operator to
      // the values is evaluated with `evaluateAsync()`
      // (`runMaterializationAsync()`), so an operator that has only an
      // `evaluateAsync` handler is lifted too: its handler gets the value,
      // not the conditional operand.
      // The lift resumes after an `await`, so the context of this evaluation
      // (the scope of an enclosing `Sum` index, for example) is put in place
      // for each of its steps. A lazy operator's held operands are evaluated
      // by the lift with `evaluate()`, which cannot run an asynchronous-only
      // descendant: those are awaited first, as for the handler in step 5
      // (`awaitAsyncOnlyDescendants`).
      //
      // A cheap test first, the same one as the lift makes: only a `When`, a
      // `Which` or a `List` operand can be lifted, so an application with
      // none of them awaits nothing here.
      if (
        tail.some(
          (x) =>
            isFunction(x, 'When') ||
            isFunction(x, 'Which') ||
            isFunction(x, 'List')
        )
      ) {
        const threadTail =
          def.lazy === true &&
          this.engine._hasAsyncOnlyOperator &&
          !def.selectsOperands &&
          !def.scoped &&
          def.holdClass !== 'quote'
            ? await awaitAsyncOnlyDescendants(tail, options)
            : tail;
        const threaded = await runMaterializationAsync(
          this.engine,
          threadConditionalOperands(this, def, threadTail, options),
          options
        );
        if (threaded) return threaded;
      }

      //
      // 3c/ Generic runtime conformance — the async twin of the sync
      // step 4d (see that comment for the rationale and the exclusions).
      //
      // A set at a numeric parameter of a built-in broadcastable operator is
      // an error (mirrors the sync step 4d).
      if (def.lazy !== true) {
        const unindexed = unindexedCollectionOperandError(
          this.engine,
          def,
          tail
        );
        if (unindexed !== undefined) return unindexed;
      }
      if (
        this.engine.strict &&
        def.lazy !== true &&
        (def.evaluateAsync !== undefined || def.evaluate !== undefined)
      ) {
        const nonconforming = genericRuntimeConformance(this.engine, def, tail);
        if (nonconforming !== undefined) return nonconforming;
      }

      // 4/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined;

      // The local scope must stay in force until the handler completes, and
      // an `evaluateAsync` handler suspends at each `await`. While it is
      // suspended, another evaluation can run on the same engine: a second
      // `evaluateAsync()`, or an operand of this evaluation that is evaluated
      // at the same time. If the frame of the local scope were on the
      // engine's own stack, those evaluations would see it on top and resolve
      // their symbols against it, and this evaluation would resume with their
      // frames above its own. A `Sum` would then assign its index in the
      // scope of another `Sum`.
      //
      // So this evaluation pushes its frame on its OWN copy of the stack: the
      // stack it inherited (from the options of the enclosing asynchronous
      // evaluation, or the engine's stack at the start of a new evaluation)
      // plus the new frame. The engine's stack does not change. The copy
      // travels to the handler and to every nested evaluation in
      // `opts._contextStack`, and each synchronous segment of the handler
      // puts it in place of the engine's stack while it runs
      // (`runWithEvaluationEffects`, `withEvaluationEffects`), exactly as the
      // capability registry travels in `opts._effects` and the working
      // precision in `opts._precisionWindow`. A nested scoped
      // evaluation makes its own copy in turn, so two operands evaluated at
      // the same time do not see the frames of each other.
      const engine = this.engine;
      const effects =
        options?._effects ?? engine._evaluationEffects ?? engine.effects;
      const contextStack = isScoped
        ? copyContextStack(options?._contextStack ?? engine._evalContextStack)
        : options?._contextStack;
      if (isScoped) {
        runWithEvaluationEffects(
          engine,
          effects,
          () =>
            engine._pushEvalContext(
              asyncScopeActivation(engine, this._localScope!),
              undefined
            ),
          contextStack,
          options?._precisionWindow
        );
      }
      const localContext = isScoped
        ? contextStack![contextStack!.length - 1]
        : undefined;

      //
      // 5/ Call the `evaluate` handler
      //
      let value: Expression | undefined;
      let handlerMissedElements = false;
      // The error of a walk that failed in the handler (`handlerWalkFailure()`).
      let handlerFailure: Expression | undefined;
      // The same, for the synchronous part of an `evaluateAsync` handler.
      let asyncSliceFailure: Expression | undefined;
      try {
        const opts: Partial<EvaluateOptions> & {
          engine: ComputeEngine;
          expression: Expression;
          precision: number | undefined;
          effects: EffectHandlers;
        } = {
          numericApproximation,
          engine,
          signal: options?.signal,
          // An `evaluateAsync` handler passes these options to the operands
          // it awaits; the registry, the context stack and the working
          // precision must go with them.
          _effects: effects,
          _contextStack: contextStack,
          _precisionWindow: options?._precisionWindow,
          materialization: options?.materialization,
          // See the matching comment (and `EvaluateHandlerOptions.expression`)
          // on the sync path.
          expression: this,
          // See the matching comment on the sync path. The options are built
          // after the operands were awaited, outside any slice of this
          // evaluation, so the digits come from the precision window the
          // evaluation carries, not from the engine field, which another
          // evaluation may have set.
          precision: numericApproximation
            ? (options?._precisionWindow?.requested ??
              engine._requestedPrecision ??
              engine.precision)
            : undefined,
          effects,
        };
        // AWAIT INSIDE THE `try`: an `evaluateAsync` handler returns at its
        // first suspension point, not at completion, so popping on the
        // handler's *return* tore the local scope down while the handler was
        // still running. Anything the resumed handler did then ran against
        // the enclosing scope: a big operator whose reduction outlives one
        // `runAsync` chunk (>16ms) assigned its loop index globally — leaking
        // it, clobbering an outer binding of the same name, and throwing
        // `Cannot assign a value to the constant "i"` for the commonest index
        // spelling of all, since global `i` is `ImaginaryUnit`. Holding the
        // context across the await is what makes the async lane's scoping
        // match the sync lane's.
        // A lazy operator's SYNCHRONOUS handler evaluates its held operands
        // itself, and cannot run an asynchronous-only descendant: await those
        // first and hand the handler the operands with the values in place
        // (`awaitAsyncOnlyDescendants`). Only an operator that DEMANDS every
        // held operand qualifies — a relation, `Element`, an arithmetic
        // fold. One that SELECTS among them (`If`, `Which`, a short-circuit
        // connective: `selectsOperands`) would have an unreachable arm run;
        // one that SCOPES them (`Block`, a big operator) orders and binds
        // their evaluation itself; one that QUOTES them holds data. An
        // `evaluateAsync` handler awaits its own operands.
        const demandsOperands =
          def.lazy === true &&
          def.evaluateAsync === undefined &&
          !def.selectsOperands &&
          !def.scoped &&
          def.holdClass !== 'quote';
        // An operator whose handler only evaluates its operands
        // (`evaluatesOperands`) has them evaluated here, in order, so that a
        // long operand yields and honors the abort signal; the handler then
        // evaluates values. Not under `.N()`: a comparison near a tie
        // re-reads the operand as written to decide it exactly.
        // An absent value at a declared numeric parameter of a function
        // literal is read as `NaN` (`declaredLambdaOperands`).
        const declaredOps = declaredLambdaOperands(this.engine, def, tail);
        let handlerOps: ReadonlyArray<Expression> = declaredOps;
        let operandsEvaluated = false;
        if (
          demandsOperands &&
          def.evaluatesOperands &&
          def.evaluate !== undefined &&
          !numericApproximation
        ) {
          const operandOpts = {
            ...operandOptions(options),
            _effects: effects,
            _contextStack: contextStack,
            _precisionWindow: options?._precisionWindow,
          };
          const values: Expression[] = [];
          for (const x of tail) values.push(await x.evaluateAsync(operandOpts));
          // What an absent value (`Missing`) means can depend on the declared
          // type of the operand it came from (`x: number | missing` reads as
          // `NaN`), which only the operand as written carries: at such a
          // position the handler gets the operand as written, as on the
          // synchronous route, and evaluates it again (a symbol read); the
          // other positions keep their value, so no long operand runs twice.
          handlerOps = values.map((v, i) =>
            isAbsentScalarSymbol(v) ? tail[i] : v
          );
          // An operand kept as written may hold an asynchronous-only
          // operator, which the synchronous handler cannot evaluate.
          if (this.engine._hasAsyncOnlyOperator)
            handlerOps = await awaitAsyncOnlyDescendants(handlerOps, options);
          operandsEvaluated = true;
        } else if (this.engine._hasAsyncOnlyOperator && demandsOperands)
          handlerOps = await awaitAsyncOnlyDescendants(tail, options);
        // The handler call itself is synchronous (an `evaluateAsync` handler
        // returns its promise at its first `await`). For that synchronous
        // part, publish this evaluation's registry in the engine slot, so
        // that a handler which evaluates operands with the synchronous
        // `evaluate()` — every `lazy` operator with a synchronous handler
        // does — gives them this registry and not the one another,
        // concurrent evaluation installed. The context stack of this
        // evaluation is put in place for the same part, for the same reason.
        // Both are restored before the `await`. The numeric request of this
        // evaluation is put in its engine slot for the same part
        // (`IComputeEngine._numericRequest`), and restored before the
        // `await` too: a collection handler reads it there.
        //
        // The result of a synchronous handler that read a walk that missed
        // elements is not used, as on the synchronous route
        // (`walksMeasuredBy()`). The call is measured inside the synchronous
        // slice, where no other evaluation can run, so the result does not
        // depend on a concurrent evaluation. A handler that answers a
        // promise (`evaluateAsync`, a user function) is not measured here:
        // its walks measure their own pulls (`MeasuredWalk`).
        value = await runWithEvaluationEffects(
          engine,
          effects,
          () => {
            const enclosingNumericRequest = engine._numericRequest;
            engine._numericRequest = numericApproximation;
            try {
              if (def.evaluateAsync !== undefined) {
                // A walk that failed in the synchronous part of the call
                // (before its first `await`), where no other evaluation can
                // run, gives its error to a handler that declines
                // (`failedWalksMeasuredBy()`).
                const failuresBefore = failedWalksMeasuredBy(def);
                const answer = def.evaluateAsync(declaredOps, opts);
                asyncSliceFailure = handlerWalkFailure(failuresBefore);
                return answer;
              }
              // A user function: the body statements are awaited.
              const applyAwaiting = (
                def.evaluate as
                  | {
                      applyAwaiting?: (
                        xs: ReadonlyArray<Expression>,
                        o: typeof opts
                      ) =>
                        | Promise<Expression | undefined>
                        | Expression
                        | undefined;
                    }
                  | undefined
              )?.applyAwaiting;
              if (applyAwaiting !== undefined)
                return applyAwaiting(handlerOps, opts);
              const walksBefore = walksMeasuredBy(def, handlerOps);
              const failuresBefore = failedWalksMeasuredBy(def);
              let declined = false;
              try {
                const answer = def.evaluate?.(handlerOps, opts);
                declined = answer === undefined;
                return answer;
              } finally {
                handlerMissedElements = handlerWalkMissedElements(walksBefore);
                if (handlerMissedElements)
                  handlerFailure = handlerWalkFailure(walksBefore);
                else if (declined) {
                  handlerFailure = handlerWalkFailure(failuresBefore);
                  handlerMissedElements = handlerFailure !== undefined;
                }
              }
            } finally {
              engine._numericRequest = enclosingNumericRequest;
            }
          },
          contextStack,
          options?._precisionWindow
        );
        if (handlerMissedElements) value = handlerFailure;
        else value ??= asyncSliceFailure;
        // A handler that answers `undefined` leaves the operator as it is;
        // over evaluated operands that is the operator over the values, as
        // an inert comparison answers on the synchronous route.
        if (value === undefined && operandsEvaluated)
          value = engine._fn(this._operator, [...handlerOps]);
      } catch (e) {
        // As on the synchronous route: keep the source range of the `Assign`
        // node that made an assignment to a constant.
        noteConstantAssignmentSite(e, this._operator, this.sourceOffsets);
        value = handlerThrowToErrorValue(this.engine, e, def, this._operator);
        // An error that a handler throws after it read a walk that missed
        // elements is not used either (the synchronous route does the same).
        if (handlerMissedElements) value = handlerFailure;
      } finally {
        // The frame is on this evaluation's own stack, not on the engine's
        // stack: remove it from there.
        if (localContext)
          runWithEvaluationEffects(
            engine,
            effects,
            () => engine._removeEvalContext(localContext),
            contextStack,
            options?._precisionWindow
          );
      }

      // The rest runs after the `await` above, so the engine slot is empty
      // again; the string-preservation check and the pole override evaluate
      // synchronously and must see this evaluation's registry and context
      // stack.
      const inContext = <T>(fn: () => T): T =>
        runWithEvaluationEffects(
          engine,
          effects,
          fn,
          contextStack,
          options?._precisionWindow
        );
      // Handler-less scoped-operator no-operand-change identity: see the
      // matching comment in the sync path (avoids re-canonicalizing a lazy
      // scoped collection into a fresh, split-off local scope; every other
      // operator keeps the load-bearing re-box).
      const result = inContext(
        () =>
          value ??
          (isScoped &&
          def.evaluate === undefined &&
          def.evaluateAsync === undefined &&
          this.isCanonical &&
          tail.every((x, i) => x === this._ops[i])
            ? this
            : this._withParseScope(() => engine.function(this._operator, tail)))
      );

      // 5a/ String preservation, re-checked on the RESULT. The step that
      // ran before evaluation could only see the node as authored, whose
      // type may be a union that resolves to `string` only once the
      // operands are evaluated (see `evaluateStringPreservingResult`).
      // Declines leave `result` untouched. Twin of step 6a in the sync
      // path.
      const preservedResult = inContext(() =>
        evaluateStringPreservingResult(result)
      );
      if (preservedResult !== result) return preservedResult;

      // 5b/ A lazy collection answered by the handler is materialized as
      // asked (`materializeLazyResult`); twin of step 6b in the sync path.
      // The elements are awaited (`materializeLazyResultAsync`), in the
      // registry and the context stack of this evaluation.
      if ((options?.materialization ?? false) !== false) {
        const materializedResult = await materializeLazyResultAsync(
          result,
          {
            ...options,
            _effects: effects,
            _contextStack: contextStack,
          },
          handlerMaterializedElements(def, this._operator, result)
        );
        if (materializedResult !== result) return materializedResult;
      }

      // 5c/ Pole-aware numeric evaluation (see the sync path).
      if (numericApproximation)
        return inContext(() =>
          applyPoleOverride(engine, this._operator, tail, result)
        );
      return result;
    };
  }
}

/**
 * Does `op` supply the CELLS of an element-wise broadcast (rather than being
 * lifted into every cell)? Mirrors the participation test at each broadcast
 * site: a tuple is an atomic value (a point/vector), never mapped over.
 */
function isBroadcastParticipant(op: Expression): boolean {
  return isFiniteBroadcastParticipant(op);
}

/**
 * Heads that read a tuple operand as a POINT and answer its NORM — one
 * scalar, not one result per component: `|(3, 4)|` is 5, and
 * `Hypot((3, 4), 12)` is 13, because the point enters the sum of squares
 * through its norm. Both compute that in their own `evaluate` handlers
 * (`evaluateAbs` routes a tuple to `Norm`) and type it with `pointNormType`,
 * so the component-wise broadcast must leave a tuple operand to them.
 *
 * Spelled as a head list here rather than as a `'tuples'` entry in each
 * definition's `broadcastExemptions`, because ANY declared exemption also
 * makes the JavaScript compile target fail closed for that head — which
 * would take away the element-wise `Abs([3, -4])` and `Hypot([3, 6], 4)`
 * lowerings these heads still have and want.
 */
const TUPLE_NORM_HEADS: ReadonlySet<string> = new Set(['Abs', 'Hypot']);

/**
 * Does a point operand hold the operator broadcast back, so that the head's
 * own evaluate handler consumes it as ONE value?
 *
 * Under a head in {@link TUPLE_NORM_HEADS} a point is one leg — its norm —
 * never a source of cells, so the list broadcast must not run over the
 * application: with it, `Hypot((3, 4), [1, 2])` zipped the point's components
 * against the list (`[√10, √20]`). Held back, the `Hypot` handler builds
 * `√(Norm(P)² + y²)`, whose arithmetic broadcasts the list leg on its own:
 * `[√26, √29]`, one hypotenuse per element with the point's norm as a leg. The
 * same construction settles a point whose component is a LIST: `Norm(([1, 2],
 * 3))` is the list `[√10, √13]` (one point per element), so
 * `Hypot(([1, 2], 3), [4, 5])` is its zip with the other leg, `[√26, √38]` —
 * which is what the compiled lane answers (`tryCompileBroadcast` rewrites the
 * point leg to `Norm`). The participant test of the broadcast
 * (`isFiniteBroadcastParticipant`) already excludes tuples; this keeps the
 * broadcast's own gate in step with the `zip` that pulls the cells, which
 * admits any collection. Component-wise heads are untouched: there a tuple
 * beside a list still supplies cells positionally (`Power((1, 2), [3, 4])` is
 * `[1, 16]`, pinned in `tuple-broadcast.test.ts`).
 */
function pointIsOneLegOf(
  operator: string,
  ops: ReadonlyArray<Expression>
): boolean {
  if (!TUPLE_NORM_HEADS.has(operator)) return false;
  return ops.some((x) => isTuple(x));
}

/**
 * Does an application of `operator` map a TUPLE operand component-wise?
 *
 * A tuple is an atomic value (a point, a vector) almost everywhere, but a
 * `broadcastable` head applied to one maps over its components, exactly as
 * it maps over the elements of a list: `Sin((1, 2))` is `(sin 1, sin 2)`.
 * Four families of heads are excluded, so a tuple stays atomic wherever the
 * engine already gives it a meaning of its own:
 *
 * - a head declaring the `'tuples'` broadcast exemption computes the shape in
 *   its own handlers: `Add`, `Multiply`, `Negate`, `Subtract` and `Divide`
 *   combine points component-wise there;
 * - the heads in {@link TUPLE_NORM_HEADS}, which read a point's norm;
 * - the relational heads compare a point as ONE value, so
 *   `Equal((1, 2), (1, 2))` is the scalar `True` and `Less((1, 2), 3)` stays
 *   inert rather than fanning out to a pair of booleans. The compiled kernels
 *   refuse a tuple operand on those heads for the same reason instead of
 *   looking inside its array representation;
 * - a USER FUNCTION binds a tuple argument WHOLE to a scalar parameter, so
 *   `f((1, 2))` passes the point to `f`. That arm is the lambda broadcast
 *   (step 2b/4b), which excludes tuples deliberately; a lambda reaches this
 *   predicate at all only because `broadcastable` is derived from
 *   `paramsAreScalar` for an annotated literal assigned bare.
 */
export function broadcastsOverTuples(
  operator: string,
  def: BoxedOperatorDefinition
): boolean {
  return (
    def.broadcastable === true &&
    !def.broadcastExemptions.includes('tuples') &&
    !TUPLE_NORM_HEADS.has(operator) &&
    !isRelationalOperator(operator) &&
    !isLambdaDef(def) &&
    !isUserFunctionDef(def)
  );
}

/**
 * Whether the tuple arm of a scalar-or-collection union operand is typed as
 * a cell of its own by the arm-by-arm typing of such a union
 * (`armwiseUnionBroadcastResultType`, `collection-utils.ts`): every head
 * that `broadcastsOverTuples` admits, and also a head whose own type handler
 * types a tuple operand (the `'tuples'` exemption: `Add`, `Multiply`,
 * `Divide`, which sum or scale points themselves). A norm head reads a point
 * as one value whose norm is a number, a relational operator compares it
 * whole, and a lambda or user function is typed by its own broadcast arm:
 * none of them is typed arm by arm.
 */
export function typesTupleArmsAsCells(
  operator: string,
  def: BoxedOperatorDefinition
): boolean {
  return (
    def.broadcastable === true &&
    !TUPLE_NORM_HEADS.has(operator) &&
    !isRelationalOperator(operator) &&
    !isLambdaDef(def) &&
    !isUserFunctionDef(def)
  );
}

/**
 * The per-cell operand lists of a component-wise broadcast of `operator` over
 * the TUPLE operands in `tail`.
 *
 * Answers `undefined` when this application is not such a broadcast, and an
 * error expression when two tuple operands disagree in length — a mismatch is
 * an error, never a truncation to the shorter one, which is the same ruling
 * and the same `incompatible-dimensions` error the list broadcast applies.
 *
 * Consulted on EVALUATED operands, so an operand that only becomes a tuple at
 * evaluation (`Sin(3 · (1, 2))`) broadcasts like a literal one. Every operand
 * that supplies cells must be a tuple: a mixed tuple-and-list application
 * keeps its existing meaning, where the list supplies the cells and the tuple
 * is lifted whole into each of them.
 */
function tupleBroadcastCells(
  expr: Expression,
  def: BoxedOperatorDefinition,
  tail: ReadonlyArray<Expression>
): Expression[][] | Expression | undefined {
  if (!broadcastsOverTuples(expr.operator, def)) return undefined;
  if (skipBroadcastForVectorOps(def, false, tail)) return undefined;
  if (!tail.some(isTupleBroadcastParticipant)) return undefined;
  // A function applied to each coordinate of a tuple with a LIST coordinate
  // (a data tuple such as `Tuple(A, B)` with `A`, `B` lists, not a point) is
  // an error, as the arithmetic operators are (see
  // `listCoordinateTupleOperandError`). This covers `Power` and its canonical
  // forms `Sqrt` (`x^(1/2)`) and `Root` (`x^(1/n)`), and every other operator
  // that applies to each coordinate: `Sin`, `Ln`, `Floor`, `Arctan2`, … (user
  // decision 2026-09-25). Without this, `Sin(Tuple([1, 2], 3))` gave the
  // tuple of lists `([sin(1), sin(2)], sin(3))`, which is neither a point nor
  // a list of points, so no consumer can use it. A list of points is written
  // `PointList(A, B)`, or `(A, B)` in LaTeX.
  const listTuple = listCoordinateTupleOperandError(expr.engine, tail);
  if (listTuple !== undefined) return listTuple;

  const ce = expr.engine;
  let length: number | undefined;
  for (const op of tail) {
    if (isTupleBroadcastParticipant(op)) {
      const n = smallCount(op);
      if (n === undefined) return undefined;
      if (length === undefined) length = n;
      else if (n !== length)
        return ce.error('incompatible-dimensions', `${length} vs ${n}`);
      continue;
    }
    // An operand that is not a tuple but would supply cells of its own at the
    // `zip` below leaves this application alone: a list leaves it to the list
    // broadcast, which ran before this one, and a non-indexed collection such
    // as a set has no component-wise meaning here at all. The test must be
    // `zip`'s OWN participation predicate, because `zip` is what pulls the
    // cells a few lines down: a set is not an indexed collection, so a
    // narrower gate would pass it through and then let it fan the tuple out
    // over its members.
    if (zipParticipates(op)) return undefined;
  }
  if (length === undefined || length === 0) return undefined;

  const items = zip(tail);
  const cells: Expression[][] = [];
  while (true) {
    const { done, value } = items.next();
    if (done) break;
    cells.push(value);
  }
  // A tuple whose components cannot all be walked (a lazy view that runs dry
  // before its advertised count) is left inert rather than silently shortened.
  return cells.length === length ? cells : undefined;
}

/**
 * The operators whose result jumps at a point, and which a broadcast maps
 * cell by cell with the handler of a scalar operand: `Floor`, `Ceil`,
 * `Truncate` and `Fract` jump at an integer (the step forms
 * `Floor(x, step)`, … where `x/|step|` is an integer), `Round` at a half-integer,
 * `Sign` and `Heaviside` at 0, and `Mod(a, m)` where `a/m` is an integer
 * (either operand can be the collection). Under `.N()`, the handler of such an operator uses the exact
 * value of an exact operand when the float of the operand is near the jump
 * (`exactRoundingOperand()` in `library/arithmetic.ts`). The comparisons
 * (`Less`, `Equal`, ...) are not in this set: they are lazy, their handler
 * builds the cells from the operands before approximation, and it applies
 * the same rule (`exactPairAtNearTie()` in `library/relational-operator.ts`).
 */
const JUMP_BROADCAST_OPERATORS: ReadonlyMap<
  string,
  'integer' | 'half' | 'zero' | 'quotient'
> = new Map([
  ['Floor', 'integer'],
  ['Ceil', 'integer'],
  ['Truncate', 'integer'],
  ['Fract', 'integer'],
  ['Round', 'half'],
  ['Sign', 'zero'],
  ['Heaviside', 'zero'],
  ['Mod', 'quotient'],
]);

/**
 * Under `.N()`, the operands of a broadcast of a jump operator
 * (`JUMP_BROADCAST_OPERATORS`) with the collection operands replaced by
 * their exact elements, or `undefined` when the operands in `tail` decide
 * the result.
 *
 * `tail` holds the operands after their numeric approximation. A broadcast
 * builds its cells from these, so the handler of each cell sees a float and
 * has no exact operand to use: at 21 digits, the third element of
 * `Range(1, 3)/3` is `0.999…`, and its floor is `0`, not `1`. So when the
 * float of some element is near a jump of the operator, each pure
 * collection operand is replaced: a `List` or `Tuple` literal by itself (its
 * elements are then evaluated in their cells, and the handler applies its
 * scalar rule to each), and another expression by its exact value. The
 * handler of each cell then sees an exact operand before its approximation.
 *
 * Far from a jump, and for all the other operators, nothing is done, so an
 * ordinary broadcast has no extra cost: an exact evaluation can cost much
 * more than the numeric one.
 */
function exactJumpBroadcastOperands(
  expr: Expression,
  tail: ReadonlyArray<Expression>,
  numericApproximation: boolean
): ReadonlyArray<Expression> | undefined {
  if (!numericApproximation) return undefined;
  const jump = JUMP_BROADCAST_OPERATORS.get(expr.operator);
  if (jump === undefined) return undefined;
  if (!isFunction(expr)) return undefined;
  const ops = expr.ops;
  if (ops.length !== tail.length) return undefined;
  const ce = expr.engine;

  let scale = 1;
  // `Floor(x, step)`, `Ceil(x, step)` and `Truncate(x, step)` jump where
  // `x/|step|` is an integer, and `Round(x, step)` where it is a
  // half-integer, so the float of an element is divided by the step. When
  // the step is not a non-zero real number literal, every element is taken
  // as near a jump.
  if ((jump === 'integer' || jump === 'half') && tail.length > 1) {
    const step = tail[1];
    if (
      !isNumber(step) ||
      step.isComplex ||
      step.isFinite !== true ||
      step.re === 0
    )
      scale = NaN;
    else scale = 1 / Math.abs(step.re);
  }
  // `Mod(a, m)` jumps where `a/m` is an integer. When one operand is a real
  // number literal and the other a collection, an element is near a jump
  // when its quotient with that literal is near an integer. In all other
  // cases (two collections), every element is taken as near a jump.
  let dividend: number | undefined;
  let divisor: number | undefined;
  if (jump === 'quotient') {
    const real = (x: Expression | undefined): number | undefined =>
      x !== undefined && isNumber(x) && !x.isComplex && x.isFinite === true
        ? x.re
        : undefined;
    divisor = real(tail[1]);
    if (divisor === undefined) dividend = real(tail[0]);
    if (divisor === 0 || (divisor === undefined && dividend === undefined))
      scale = NaN;
  }
  const isNearJump = (x: Expression): boolean => {
    if (!isNumber(x) || x.isExact || x.isComplex || x.isFinite !== true)
      return false;
    if (Number.isNaN(scale)) return true;
    if (jump === 'zero') return Math.abs(x.re) <= nearJumpTolerance(ce);
    if (jump === 'quotient') {
      const q = divisor !== undefined ? x.re / divisor : dividend! / x.re;
      return !Number.isFinite(q) || isNearRoundingJumpValue(ce, q, false);
    }
    return isNearRoundingJumpValue(ce, x.re * scale, jump === 'half');
  };
  const isCellCollection = (x: Expression): boolean =>
    isFunction(x, 'List') || isFunction(x, 'Tuple');
  // The elements of a nested collection are examined too: the cells of
  // `Floor([[0.999…]])` are built by a second broadcast, over the inner
  // list, and that broadcast sees only the float when the outer one did
  // not put back the exact inner list.
  const hasNearJumpElement = (x: Expression): boolean =>
    isCellCollection(x) &&
    isFunction(x) &&
    x.ops.some((y) => isNearJump(y) || hasNearJumpElement(y));
  if (!tail.some(hasNearJumpElement)) return undefined;

  let changed = false;
  const result = tail.map((x, i) => {
    if (!isCellCollection(x) || !isFunction(x)) return x;
    const original = ops[i];
    // `isTransitivelyPure()`, not `isPure`: a symbol whose stored value is
    // impure (`L` holds `Range(1, 300) + Random()`) is pure by `isPure`, but
    // its exact evaluation below would evaluate the stored value again.
    if (original === x || !isTransitivelyPure(original)) return x;
    const sameShape = (y: Expression) =>
      isFunction(y) && y.operator === x.operator && y.nops === x.nops;
    if (sameShape(original)) {
      changed = true;
      return original;
    }
    // A float literal in `original` does not make every element a float:
    // the first element of `Abs([q, 1.5])` stays the exact `q`. So the exact
    // value is used when it has an element that is not a float.
    const exact = original.evaluate();
    if (!sameShape(exact)) return x;
    if (hasInexactNumberLiteral(original) && !hasExactElement(exact)) return x;
    changed = true;
    return exact;
  });
  return changed ? withExactScalarOperands(result, ops) : undefined;
}

/**
 * True when some element of the `List` or `Tuple` `expr`, or of a `List` or
 * `Tuple` nested in it, is not a float number literal.
 */
function hasExactElement(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  return expr.ops.some((x) =>
    isFunction(x, 'List') || isFunction(x, 'Tuple')
      ? hasExactElement(x)
      : !isNumber(x) || x.isExact
  );
}

/**
 * `operands` with each scalar operand whose value before the numeric
 * approximation (in `originals`) is exact put back as that exact value. When
 * the cells of a broadcast of a jump operator are built from exact elements,
 * an exact scalar operand must be exact too: the step of `Floor(L, 1/3)` is
 * approximated with the list, and `Floor(1, 0.333…)` is `0.999…`, not `1`.
 * The exact value is an exact number literal, or the exact value of a pure
 * expression with no float in it (a symbol that holds `1/3`).
 */
function withExactScalarOperands(
  operands: ReadonlyArray<Expression>,
  originals: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  return operands.map((x, i) => {
    const original = originals[i];
    if (!isNumber(x) || original === undefined) return x;
    if (isNumber(original)) return original.isExact ? original : x;
    if (!isTransitivelyPure(original) || hasInexactNumberLiteral(original))
      return x;
    const exact = original.evaluate();
    return isNumber(exact) && exact.isExact ? exact : x;
  });
}

/**
 * True when `expr` has a float number literal (`1.5`) in its tree. The
 * exact evaluation of such an expression gives floats too, so it is not
 * made again to get exact values.
 */
function hasInexactNumberLiteral(expr: Expression): boolean {
  if (isNumber(expr)) return !expr.isExact;
  return isFunction(expr) && expr.ops.some(hasInexactNumberLiteral);
}

/**
 * Under `.N()`, the operands of a LAZY broadcast (`lazyBroadcastMapIfNeeded()`)
 * of a jump operator (`JUMP_BROADCAST_OPERATORS`) with each pure collection
 * operand replaced by its exact value, or `undefined` when the broadcast is
 * not lazy or nothing is replaced.
 *
 * A lazy broadcast (more than `MAX_SIZE_EAGER_COLLECTION` elements, or a
 * source of unknown length) maps the operator over its sources, so a source
 * approximated before the map gives each cell a float, and the result can
 * be on the wrong side of a jump: at 21 digits, the floor of the third
 * element of `Range(1, 300)/3` was `0`. Over the exact source, the handler
 * of each cell sees an exact operand and applies its scalar rule. The
 * elements are not examined first, as the eager broadcast does
 * (`exactJumpBroadcastOperands()`), because this would materialize the
 * lazy source.
 */
function exactJumpLazyBroadcastOperands(
  expr: Expression,
  tail: ReadonlyArray<Expression>,
  numericApproximation: boolean
): ReadonlyArray<Expression> | undefined {
  if (!numericApproximation) return undefined;
  if (!JUMP_BROADCAST_OPERATORS.has(expr.operator)) return undefined;
  if (!isFunction(expr)) return undefined;
  const ops = expr.ops;
  if (ops.length !== tail.length) return undefined;
  // The same test as `lazyBroadcastMapIfNeeded()`: the broadcast is lazy
  // when some source has an unknown or infinite length, or more than
  // `MAX_SIZE_EAGER_COLLECTION` elements (the lengths of the sources were
  // already checked to agree).
  const isLazySource = (x: Expression): boolean => {
    if (!isBroadcastableCollection(x)) return false;
    const n = x.count;
    return (
      x.isFiniteCollection !== true ||
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n > MAX_SIZE_EAGER_COLLECTION
    );
  };
  if (!tail.some(isLazySource)) return undefined;
  // When every operand is typed integer (scalars and collection elements
  // alike), the approximated values are the integers themselves and there
  // is no fractional part to push across a jump. The exact source is then
  // not needed, and the approximated lazy source is kept: rebuilding it
  // from the exact source removed the approximation marker that a chain of
  // lazy maps uses to fuse its levels (`lowerMapSpine()`).
  if (
    ops.every(
      (x) => x.type.matches('integer') || x.type.matches('collection<integer>')
    )
  )
    return undefined;

  let changed = false;
  const result = tail.map((x, i) => {
    if (!isBroadcastableCollection(x)) return x;
    const original = ops[i];
    // `isTransitivelyPure()`, not `isPure`: a symbol whose stored value is
    // impure (`L` holds `Range(1, 300) + Random()`) is pure by `isPure`, but
    // its exact evaluation below would evaluate the stored value again.
    // A float literal in `original` is not a reason to keep `x`: it does not
    // make every element a float (the first element of
    // `Abs(Join([q], Range(1, 300), [1.5]))` stays the exact `q`), and the
    // elements of a lazy source are not examined.
    if (original === x || !isTransitivelyPure(original)) return x;
    const exact = original.evaluate();
    if (!isBroadcastableCollection(exact) || exact.count !== x.count) return x;
    changed = true;
    return exact;
  });
  return changed ? withExactScalarOperands(result, ops) : undefined;
}

/**
 * Record the element-wise application on the errors a LAMBDA broadcast
 * produced, so a failure that only happened because the argument was a
 * collection says so (`while applying 'skipWs' element-wise over 4 elements
 * (element 2)`). Returns `results` untouched when every element succeeded.
 *
 * Cost on the happy path is a single `isValid` read per element — the value
 * the enclosing `_fn('List', …)` computes for each element anyway (it is
 * memoized on the node), so a successful broadcast pays nothing extra.
 *
 * The map over the components of a tuple (`declaredScalarTupleCells`) and
 * the map of `Apply` over a list (`applyLiteralMapped`, `library/core.ts`)
 * record it too.
 */
export function annotateBroadcastErrors(
  operator: string,
  results: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (results.every((x) => x.isValid)) return results;
  return results.map((x, i) =>
    x.isValid
      ? x
      : withBroadcastFrame(x, {
          operator,
          index: i + 1,
          length: results.length,
        })
  );
}

/** Errors that already carry an element-wise context (see
 * `withBroadcastThrowContext`). */
const BROADCAST_CONTEXTED = new WeakSet<Error>();

/**
 * Append the element-wise context to an error THROWN out of an element
 * evaluation (`if` on a non-boolean, a cap breach, …). Such a failure never
 * becomes an `Error` value — it aborts the whole broadcast — so the breadcrumb
 * has nowhere to live and the message is enriched instead.
 *
 * The error object is returned as-is (message mutated in place) so its
 * prototype survives: a `CancellationError` must keep answering to the
 * cap-breach handling upstream, and its message is string-matched by hosts —
 * so it is left alone entirely.
 *
 * Idempotent: the same error passing through a SECOND broadcast layer is
 * returned untouched. The async arms wrap each element's promise (which knows
 * its index) and still keep the outer `Promise.all` handler; a nested
 * broadcast rethrows through the enclosing loop's `catch`. In both cases the
 * innermost — most specific, index-carrying — context is the one kept.
 */
function withBroadcastThrowContext(
  e: unknown,
  operator: string,
  ops: ReadonlyArray<Expression>,
  index?: number
): unknown {
  if (!(e instanceof Error) || e.name === 'CancellationError') return e;
  if (BROADCAST_CONTEXTED.has(e)) return e;
  BROADCAST_CONTEXTED.add(e);
  const participant = ops.find(isBroadcastParticipant);
  const length =
    participant === undefined ? undefined : smallCount(participant);
  e.message = `${e.message} (${broadcastContextMessage(operator, length, index)})`;
  return e;
}

/**
 * The matrix power for `Power(base, exponent)` when the base is a square
 * matrix value and the exponent is an integer, as an unevaluated
 * `MatrixPower` call, or the `expected-square-matrix` error when the base
 * is a matrix value that is not square. `undefined` when the element-wise
 * broadcast of `Power` must apply.
 *
 * Canonicalization writes `A^n` as `MatrixPower(A, n)` when the type of `A`
 * is a matrix and `n` is an integer (`canonicalPower()` in
 * `arithmetic-power.ts`). A `Power` that is built before its base has a
 * value cannot get that rewrite: `B^2`, parsed when `B` has no value, stays
 * a scalar `Power`. When `B` then holds a matrix, the broadcast maps the
 * scalar power over the entries and gives the element-wise square. The
 * broadcast calls this function first, so that `B^2` gives the same matrix
 * power as `B^2` parsed after the assignment.
 *
 * The result is a matrix power only when all of these conditions are true:
 * - the exponent is a number literal that is an integer (`0` gives the
 *   identity matrix, a negative integer gives a power of the inverse),
 * - the base value is a nested list of rank 2, with as many rows as
 *   columns,
 * - every entry of the base is a number (the base value has a `matrix`
 *   type).
 * A non-integer exponent, a vector, a ragged list and a list with entries
 * that are not numbers keep the element-wise broadcast. A matrix that is not
 * square gives the `expected-square-matrix` error, as `MatrixPower` does,
 * except under the exponent 1.
 *
 * The exponent `-1` never reaches this function when the base has no value
 * at canonicalization: `B^{-1}` canonicalizes to `Divide(1, B)`, and the
 * division of a number by a matrix is element-wise. So `B^{-1}` built
 * before `B` holds a matrix is the matrix of the reciprocals, while
 * `B^{-1}` parsed after the assignment is `Inverse(B)`. This is a user
 * decision: the rewrite to a division stays, because `x^{-1}` and `1/x`
 * must remain one expression for every scalar `x`.
 *
 * `ops` are the operands of the `Power` as the broadcast sees them. A base
 * that is a symbol is read through its value. A base that is a function
 * expression other than a `List` is evaluated only when its type is a
 * matrix. The broadcast after the evaluation of the operands calls this
 * function with operands that are already evaluated.
 */
function squareMatrixPower(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined,
  written: Expression | undefined
): Expression | undefined {
  if (ops.length !== 2) return undefined;
  const [base, exponent] = ops;
  // The exponent is already evaluated, and the matrix power needs a number.
  if (!isNumber(exponent) || exponent.isInteger !== true) return undefined;
  const isMatrixValue = (x: Expression): boolean =>
    x.type.type !== 'never' && x.type.matches('matrix');
  const readValue =
    isSymbol(base) ||
    (isFunction(base) && base.operator !== 'List' && isMatrixValue(base));
  const value = readValue ? base.evaluate(operandOptions(options)) : base;
  if (!isFunction(value, 'List')) return undefined;
  // The shape is read before the exponent: a base that is not a matrix (a
  // vector) has no matrix power, whatever the exponent. The type of a
  // `List` value has both extents, so the shape is known.
  const shape = matrixShapeOf(value.type);
  if (shape !== 'square' && shape !== 'non-square') return undefined;
  // The written exponent decides, not its value: see `isSquareMatrixPower`.
  if (!isMatrixPowerExponent(written ?? exponent, exponent)) return undefined;
  if (shape === 'square') return ce.function('MatrixPower', [value, exponent]);
  // `B^2` parsed after `B` holds a matrix that is not square is
  // `MatrixPower(B, 2)`, which is the `expected-square-matrix` error. The
  // same `Power` built before the assignment gives the same error. The
  // exponent 1 keeps the broadcast, which gives the matrix itself.
  if (exponent.re !== 1)
    return ce.error('expected-square-matrix', value.toString());
  return undefined;
}

/**
 * Whether the exponent of a `Power` of a matrix value makes the matrix
 * power, for the evaluation of the `Power` (`squareMatrixPower()`).
 * `written` is the exponent as written, `evaluated` its value.
 *
 * The written exponent decides when its form tells (`integerExponentOf`): an
 * exact integer literal is a matrix power, a float literal is an
 * element-wise power, and an expression typed `integer` is a matrix power
 * whatever value it evaluates to (`n + 1.0` with `n: integer`). The value
 * decides only for an expression whose type is not `integer`: an exact
 * integer value is a matrix power. Under a numeric approximation such an
 * exponent is evaluated exactly, once (`evaluatesExponentExactly()`), so
 * that `evaluated` holds the exact integer and `evaluate()` and `.N()`
 * decide alike.
 */
function isMatrixPowerExponent(
  written: Expression,
  evaluated: Expression
): boolean {
  const known = integerExponentOf(written);
  if (known !== undefined) return known;
  return isExactIntegerLiteral(evaluated);
}

/**
 * Whether the evaluation of `expr`, a `Power`, under the options `options`
 * evaluates the exponent exactly (`exactIntegerOperand()`): an exact integer
 * value is kept as it is, and any other value is then approximated, from
 * that one result. This applies under a numeric approximation when only the
 * value of the exponent can decide between the matrix power and the
 * element-wise power (`integerExponentOf()` answers `undefined`) and the
 * base may be a matrix (its type is not a number type).
 *
 * Under `.N()` an exact integer value would otherwise be a float, and the
 * float `2.0` is an element-wise power while the exact `2` is a matrix
 * power: `B^k` with `k: real` holding 2 gave the element-wise power under
 * `.N()` and the matrix power under `evaluate()`. Evaluating the exponent a
 * second time to read its exact value would repeat its side effects.
 */
function evaluatesExponentExactly(
  expr: Expression,
  options: Partial<EvaluateOptions> | undefined
): boolean {
  if (options?.numericApproximation !== true) return false;
  if (!isFunction(expr, 'Power') || expr.nops !== 2) return false;
  if (integerExponentOf(expr.op2) !== undefined) return false;
  // A collection exponent is broadcast over, and is not read here.
  if (isBroadcastParticipant(expr.op2)) return false;
  return !isSubtype(expr.op1.type.type, 'number');
}

/**
 * Whether the written exponent `exponent` is an integer exponent of a matrix
 * power: `true` for an exact integer literal and for an expression that is
 * not a literal and whose type is `integer`, `false` for any other number
 * literal (a float, even `2.0`, and a non-integer), and `undefined` for an
 * expression whose type is not `integer`, which only its value decides.
 */
function integerExponentOf(exponent: Expression): boolean | undefined {
  if (isNumber(exponent)) return isExactIntegerLiteral(exponent);
  if (isSubtype(exponent.type.type, 'integer')) return true;
  return undefined;
}

/**
 * The shape of a matrix type for a matrix power: `'square'` or
 * `'non-square'` when the type is a matrix (its entries are numbers) of rank
 * 2 with two known extents, `'unknown'` when an extent is not known, and
 * `'none'` when the type is not a matrix (a vector, a ragged list, a list of
 * entries that are not numbers, a scalar, or the empty type `never`).
 */
function matrixShapeOf(
  baseType: BoxedType
): 'square' | 'non-square' | 'unknown' | 'none' {
  if (baseType.type === 'never' || !baseType.matches('matrix')) return 'none';
  const dims = staticCollectionDims(baseType.type);
  if (dims === null || dims.length !== 2) return 'unknown';
  const [rows, columns] = dims;
  if (rows < 0 || columns < 0) return 'unknown';
  return rows === columns ? 'square' : 'non-square';
}

/**
 * Whether `Power(base, exponent)` is an integer power of a matrix that is
 * not square, decided from the type of the base and from the exponent:
 * the base type is a matrix (its entries are numbers) of rank 2 with two
 * known extents that are not equal, and the exponent is an integer other
 * than the literal 1 (an integer number literal, or an expression whose type
 * is an integer).
 *
 * Such a power is the `expected-square-matrix` error: canonicalization
 * writes it as `MatrixPower(base, exponent)` when the base type is a matrix
 * (`canonicalPower()` in `arithmetic-power.ts`), and `MatrixPower` refuses a
 * matrix that is not square. The exponent 1 is excluded, because `A^1`
 * canonicalizes to `A`. The evaluation of a `Power` (`squareMatrixPower()`)
 * and its compilation (`compileExpr()` in `compilation/base-compiler.ts`)
 * use this function, so that a `Power` built before its base holds the
 * matrix does not compute the element-wise power instead.
 */
export function isNonSquareMatrixPower(
  baseType: BoxedType,
  exponent: Expression
): boolean {
  if (matrixShapeOf(baseType) !== 'non-square') return false;
  return integerExponentOf(exponent) === true && !exponent.isSame(1);
}

/**
 * Whether `x` is a number literal with an exact integer value. A float with
 * an integer value (`2.0`) is not one: a float exponent of a matrix is an
 * element-wise power (`isSquareMatrixPower`).
 */
function isExactIntegerLiteral(x: Expression): boolean {
  return isNumber(x) && x.isExact && x.isInteger === true;
}

/**
 * Whether `Power(base, exponent)` is the matrix power `MatrixPower(base,
 * exponent)` or the element-wise power, decided from the type of the base
 * and from the exponent. The evaluation of a `Power` (`squareMatrixPower()`)
 * and the compilation of a `Power` (`compileExpr()` in
 * `compilation/base-compiler.ts`) both use this function, so that compiled
 * code computes the same power as `evaluate()`.
 *
 * - `true`: a matrix power. The base type is a matrix (its entries are
 *   numbers) of rank 2 with two known extents that are equal, and the
 *   exponent is an integer: an EXACT integer number literal, or an
 *   expression that is not a literal and whose type is an integer.
 * - `false`: an element-wise power. The base type is not a matrix (a vector,
 *   a ragged list, a list of entries that are not numbers, a scalar, or the
 *   empty type `never`), or it is a matrix with two known extents that are
 *   not equal, or the exponent is a number literal that is not an exact
 *   integer.
 * - `undefined`: the type does not tell. The base type is a matrix with an
 *   extent that is not known, or the exponent is not a literal and its type
 *   is not an integer. Only the value at run time can decide.
 *
 * A float exponent is never a matrix power, even when its value is an
 * integer, as a float exponent is never a polynomial degree: a float is not
 * an integer. So `[[1, 2], [3, 4]]^{2.0}` is `[[1, 4], [9, 16]]`, the square
 * of each entry, as `M^{2.5}` is the power of each entry, and `M^2` is the
 * matrix power `[[7, 10], [15, 22]]` (user decision). Canonicalization
 * applies the same rule (`canonicalPower()` in `arithmetic-power.ts`).
 *
 * The rule reads the exponent as WRITTEN, never its value, so that every
 * route gives the same power (`integerExponentOf`):
 * - an exact integer literal is a matrix power;
 * - any other number literal, a float such as `2.0` included, is an
 *   element-wise power;
 * - an expression that is not a literal and whose type is `integer` is a
 *   matrix power, whatever value it evaluates to: `M^{n + 1.0}` with
 *   `n: integer`, `M^{Floor(5/2)}`, and `M^n` with `n` holding `2.0` are
 *   matrix powers under `evaluate()`, under `.N()` (which makes their value
 *   a float) and in compiled code;
 * - for an expression whose type is not `integer`, this function answers
 *   `undefined` and compilation declines. The evaluation then decides from
 *   the exact value of the exponent: under `.N()` the exponent is evaluated
 *   exactly, once, and that value is approximated afterwards, so that
 *   `evaluate()` and `.N()` agree and a side effect of the exponent runs
 *   once (`isMatrixPowerExponent`, `evaluatesExponentExactly`).
 */
export function isSquareMatrixPower(
  baseType: BoxedType,
  exponent: Expression
): boolean | undefined {
  const shape = matrixShapeOf(baseType);
  if (shape === 'none' || shape === 'non-square') return false;
  const integer = integerExponentOf(exponent);
  if (integer === false) return false;
  return shape === 'square' && integer === true ? true : undefined;
}

/**
 * Evaluate the operands that are LIFTED into every cell, once.
 *
 * RULING (user-ratified 2026-07-24): broadcast operands are evaluated ONCE and
 * the operation then maps over cells — the NumPy/Julia/R model, in which
 * broadcasting is an operation on VALUES. `zip` repeats a lifted operand's
 * *expression* in every cell, so an impure scalar was drawn per element:
 * `L < Random()` produced a different number for each comparison, while the
 * arithmetic broadcast (`L + Random()`) had always drawn once. A per-cell draw
 * is written explicitly instead: `Map(l ↦ l < Random(), L)`.
 *
 * Cell-supplying operands are left untouched — their elements ARE the values
 * being traversed, so `[Random(), Random()]` still draws per cell. Evaluation
 * can REVEAL a collection (a raw call returning a list), so participation is
 * re-derived from the returned operands by the caller, not from the originals.
 */
function evaluateBroadcastLiftsOnce(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined,
  operator: string
): ReadonlyArray<Expression> {
  if (
    !ops.some((op) => !isBroadcastParticipant(op) || literalMayEraseElement(op))
  )
    return ops;
  const erasing = erasingLiteralOptions(options, operator);
  // A lift is an operand: evaluated without `materialization`
  // (`operandOptions`), or a lift that reveals a lazy collection (a user
  // function returning `Range(1, n)`) would broadcast over its display
  // preview, placeholder included.
  //
  // A list literal with an element that may evaluate to `Nothing` is
  // evaluated too, so that the broadcast walks the elements the list keeps
  // (`literalMayEraseElement`); for a jump operator under `.N()` only its
  // erasure is resolved (`erasingLiteralOptions`).
  const lifted = ops.map((op) =>
    isBroadcastParticipant(op)
      ? literalMayEraseElement(op)
        ? erasingLiteralValue(op, erasing, options)
        : op
      : normalizeLiftedAbsence(op, op.evaluate(operandOptions(options)) ?? op)
  );
  // For a jump operator under `.N()`, a scalar lift that is an exact number
  // is put back exact as well (`withExactScalarOperands`): the cells are
  // built from these operands as they are, and a step or a modulus that
  // reached each cell as a float put the cell on the wrong side of a jump:
  // `Floor([1], 1/3).N()` was `[0.999…]` where `Floor(1, 1/3).N()` is `1`,
  // and `Mod([1], 1/3).N()` was `[1e-21]` where `Mod(1, 1/3).N()` is `0`.
  return isExactJumpLift(erasing, options)
    ? withExactScalarOperands(lifted, ops)
    : lifted;
}

/** Async mirror of `evaluateBroadcastLiftsOnce`. */
async function evaluateBroadcastLiftsOnceAsync(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined,
  operator: string
): Promise<ReadonlyArray<Expression>> {
  if (
    !ops.some((op) => !isBroadcastParticipant(op) || literalMayEraseElement(op))
  )
    return ops;
  const erasing = erasingLiteralOptions(options, operator);
  // Awaited together, not in sequence: the lifts are independent, and the sync
  // mirror evaluates them without ordering either.
  const lifted = await Promise.all(
    ops.map(async (op) =>
      isBroadcastParticipant(op)
        ? literalMayEraseElement(op)
          ? await erasingLiteralValueAsync(op, erasing, options)
          : op
        : normalizeLiftedAbsence(
            op,
            (await op.evaluateAsync(operandOptions(options))) ?? op
          )
    )
  );
  // The exact scalar lifts of a jump operator, as in the sync mirror.
  return isExactJumpLift(erasing, options)
    ? withExactScalarOperands(lifted, ops)
    : lifted;
}

/**
 * The options that `evaluateBroadcastLiftsOnce` evaluates a list literal
 * with an element that may erase (`literalMayEraseElement`) with: the
 * operand options (`operandOptions`), except that for a broadcast of a jump
 * operator (`JUMP_BROADCAST_OPERATORS`) under `.N()` the literal is
 * evaluated EXACTLY. The literal is evaluated here only so that the
 * broadcast walks the elements it keeps; under `.N()` that evaluation also
 * approximated every surviving element, so the cells were built from floats
 * and the handler of each cell had no exact operand to apply its jump rule
 * to: `Floor([If(c, 1, Nothing), q]).N()` with `c := False` and the exact
 * `q = (25! − 1)/24!` was `[25]` where `Floor([q]).N()` and `Floor(q).N()`
 * are `[24]` and `24`, and `Mod([…, q], 1).N()` was `[0]` where `Mod([q],
 * 1).N()` is `[1]`. Evaluated exactly, the literal resolves its erasure the
 * same way (the condition of an `If` is evaluated as it is), its survivors
 * stay exact, and the broadcast that follows builds its cells from the
 * literal as it is, so each cell's handler applies its jump rule to an exact
 * operand before it approximates the result. Only the erasure is resolved,
 * in fact (`erasingLiteralValue`): an exact evaluation of every survivor
 * could cost much more than the cells' own approximation, which reads the
 * exact value only near a jump. (The post-evaluation broadcast
 * of steps 4b and 4t has its own recovery, `exactJumpBroadcastOperands`;
 * the operands returned here never reach it.) For every other operator the
 * approximation of the survivors is kept: the cells need floats, and an
 * exact evaluation can cost much more.
 */
function erasingLiteralOptions(
  options: Partial<EvaluateOptions> | undefined,
  operator: string
): Partial<EvaluateOptions> | undefined {
  const base = operandOptions(options);
  if (
    options?.numericApproximation !== true ||
    !JUMP_BROADCAST_OPERATORS.has(operator)
  )
    return base;
  return { ...base, numericApproximation: false };
}

/**
 * The value that `evaluateBroadcastLiftsOnce` lifts for the list literal
 * `op`, which has an element that may erase, given the options
 * `erasingLiteralOptions` chose. For a jump operator under `.N()` (the
 * chosen options are exact), only the erasure of the literal is
 * resolved (`literalWithErasureResolved`): the elements that may erase are
 * evaluated, and the others are kept as written, so that the cells are those
 * of the same literal without the erased elements. An exact evaluation of
 * the whole literal evaluated every survivor exactly:
 * `Floor([If(c, 1, Nothing), H]).N()` with `H = Sum(1/k, k, 1, 6000)` took
 * 7 s, where `Floor([H]).N()` takes 0.1 s. When the erasure cannot be
 * resolved (a condition with no value yet), the literal is evaluated with
 * the chosen options.
 *
 * The selective resolution applies only to a literal that is transitively
 * pure (`isTransitivelyPure`). It evaluates the elements that may erase
 * before the elements that come before them, and an undecided erasure
 * evaluates the literal a second time. With an impure function `Tick()`
 * that sets `c` to `False` and returns 1, and `c` set to `True`,
 * `Floor([Tick(), If(c, 2, Nothing)]).N()` was `[1, 2]` where the literal
 * has the value `[1]`. Any other literal is evaluated once, in order, with
 * the chosen options.
 */
function erasingLiteralValue(
  op: Expression,
  erasing: Partial<EvaluateOptions> | undefined,
  options: Partial<EvaluateOptions> | undefined
): Expression {
  if (isExactJumpLift(erasing, options) && isTransitivelyPure(op)) {
    const resolved = literalWithErasureResolved(op, erasing);
    if (resolved !== undefined) return resolved;
  }
  return op.evaluate(erasing) ?? op;
}

/** Async mirror of `erasingLiteralValue`: the elements are evaluated with
 * `evaluateAsync` (`literalWithErasureResolvedAsync`), so that an element
 * whose condition needs an operator with only an `evaluateAsync` handler
 * gets its value. */
async function erasingLiteralValueAsync(
  op: Expression,
  erasing: Partial<EvaluateOptions> | undefined,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression> {
  if (isExactJumpLift(erasing, options) && isTransitivelyPure(op)) {
    const resolved = await literalWithErasureResolvedAsync(op, erasing);
    if (resolved !== undefined) return resolved;
  }
  return (await op.evaluateAsync(erasing)) ?? op;
}

/**
 * Whether `erasingLiteralOptions` chose the exact options of a jump
 * operator under `.N()`: the caller asked for a numeric approximation and
 * the chosen options do not. The test reads the options, not their
 * identity: with `materialization` set, `operandOptions` returns a new
 * object at each call, so an identity test with it was always false, and
 * the exact scalar operands of a jump operator (`withExactScalarOperands`)
 * were put back for every operator.
 */
function isExactJumpLift(
  erasing: Partial<EvaluateOptions> | undefined,
  options: Partial<EvaluateOptions> | undefined
): boolean {
  return (
    options?.numericApproximation === true &&
    erasing?.numericApproximation === false
  );
}

/**
 * Carry a numeric slot's absence convention across the evaluate-once
 * substitution.
 *
 * Substituting a lifted operand with its VALUE erases the declared type the
 * comparison handlers' absence read keys on: an operand typed `number | missing`
 * that evaluates to the `Missing` symbol must be read as `NaN` (IEEE), because
 * `NaN` is that slot's honest absence value (I6 domain normalization). Without
 * this, the same operand answered `False` as a scalar (`Less(1, x)`) and
 * `Missing` under a broadcast (`Less([1,2], x)`) — Kleene where the scalar path
 * is IEEE. `readComparisonAbsence` in `library/relational-operator.ts` applies
 * the identical rule on the non-broadcast path.
 */
function normalizeLiftedAbsence(
  original: Expression,
  evaluated: Expression
): Expression {
  if (!isSymbol(evaluated, 'Missing')) return evaluated;
  return numericMissingSlot(original.type.type)
    ? original.engine.NaN
    : evaluated;
}

/**
 * True when the generic element-wise broadcast (fan-out and result-type
 * lift) must NOT apply to this application, because the operator's own
 * handlers give the present operand shapes their dedicated semantics. The
 * operator declares which shapes it owns with the `broadcastExemptions`
 * definition flag; this predicate supplies the SHAPE TESTS — which operand
 * configurations trigger each declared exemption — so the per-operator fact
 * lives in the definition and only the generic mechanism lives here.
 */
function skipBroadcastForVectorOps(
  def: BoxedOperatorDefinition | undefined,
  hasTensors: boolean,
  ops: ReadonlyArray<Expression>
): boolean {
  // An operator that declares no exemption never stands down, whatever its
  // operands are (`skipBroadcastForVectorOpsOnViews` answers false before it
  // reads a view). This check runs on every evaluation of every application,
  // so do not build the operand views in that case.
  const exemptions = def?.broadcastExemptions;
  if (exemptions === undefined || exemptions.length === 0) return false;
  return skipBroadcastForVectorOpsOnViews(
    def,
    hasTensors,
    ops.map(viewOfExpression)
  );
}

/**
 * The broadcast lift's view of an operand EXPRESSION: each fact is read
 * lazily through the value-level predicate this route always used, so a
 * predicate runs only when the arm that needs it does.
 *
 * The facts are getters on the class prototype, not on an object literal: an
 * object literal with getters creates one closure per getter and a slow
 * (dictionary-mode) object for each operand, and views are built on every
 * evaluation of an application whose operator declares broadcast exemptions
 * (`Add`, `Multiply`, ...).
 */
class ExpressionOperandView implements BroadcastOperandView {
  constructor(private readonly x: Expression) {}
  // Lazy too: the value path asks `skipBroadcastForVectorOps` before it
  // needs any type, and an operator without exemptions answers without
  // reading one — a type read is a derivation, possibly recursive.
  get type(): Type {
    return this.x.type.type;
  }
  get isSymbol(): boolean {
    return isSymbol(this.x);
  }
  get isApplication(): boolean {
    return isFunction(this.x);
  }
  get declaredTopSymbol(): boolean {
    if (!isSymbol(this.x)) return false;
    const def = this.x.valueDefinition;
    if (def === undefined || def.inferredType === true) return false;
    const t = resolveTypeAlias(this.x.type.type);
    return t === 'any' || t === 'value';
  }
  get isCollection(): boolean {
    return this.x.isCollection;
  }
  get finiteBroadcastParticipant(): boolean {
    return isFiniteBroadcastParticipant(this.x);
  }
  get tuple(): boolean {
    return isTuple(this.x);
  }
  get textAtom(): boolean {
    return isTextAtom(this.x);
  }
  get tensorShape(): boolean {
    return candidateShape(this.x) !== null;
  }
  get matrixFact(): boolean {
    return this.x.type.facts.matrix;
  }
  get typeIsUnknown(): boolean {
    return this.x.type.isUnknown;
  }
  get holdsUnindexedCollection(): boolean {
    return holdsUnindexedCollection(this.x);
  }
}

/** Whether `x` holds a collection value now whose kind is DECIDED as not
 * indexed, such as a symbol declared `collection<T>` that holds a set. See
 * `BroadcastOperandView.holdsUnindexedCollection`.
 *
 * `isIndexedCollection` alone cannot answer this: it is `false` both for a
 * set and for a value whose kind is not decided yet. A `Map` or a `Filter`
 * over a symbol declared `collection<number>` that holds no value is a
 * collection (`isCollection` is `true`) that is not known to be indexed, but
 * it becomes a list as soon as the symbol is given a list. So the answer is
 * `true` only when {@link collectionKindDecided} says the kind is decided. */
function holdsUnindexedCollection(x: Expression): boolean {
  if (!x.isCollection || x.isIndexedCollection === true) return false;
  return collectionKindDecided(x, 0);
}

/**
 * Whether the collection kind of `x` (indexed or not) is decided by values
 * that exist now, rather than left open by an abstract collection type
 * (`isAbstractCollectionType`).
 *
 * - An expression whose own type is not abstract (a `Set`, a list, a
 *   dictionary) has its kind in its type: decided.
 * - A symbol is decided when it holds a value whose kind is decided. A
 *   symbol that holds no value is not decided: its declaration admits a list
 *   and a set.
 * - An application of an abstract type (`Map(f, P)` with `P` declared
 *   `collection<T>`) takes its kind from its abstract-typed source
 *   operands (see `abstractSourcesHoldIndexedValues`), so it is decided
 *   when it has such an operand and every one of them is decided.
 *
 * The descent is bounded: a chain of symbols deeper than the bound (or a
 * cycle of symbols that hold each other) answers `false`, which keeps the
 * application typed as possibly a collection.
 */
function collectionKindDecided(x: Expression, depth: number): boolean {
  if (depth > 16) return false;
  if (isSymbol(x)) {
    const value = x.value;
    return value !== undefined && collectionKindDecided(value, depth + 1);
  }
  if (!isAbstractCollectionType(x.type)) return true;
  if (!isFunction(x)) return false;
  let found = false;
  for (const op of collectionSourceOperands(x)) {
    if (!isKindOpenOperandType(op.type.type)) continue;
    if (!collectionKindDecided(op, depth + 1)) return false;
    found = true;
  }
  return found;
}

export function viewOfExpression(x: Expression): BroadcastOperandView {
  return new ExpressionOperandView(x);
}

/**
 * Broadcastable logic operators excluded from conditional-value threading.
 * Kleene logic is not strict — `And(Undefined, False)` must stay `False` — so
 * lifting a `When` guard out of them would be unsound (design decision 2/9).
 */
const CONDITIONAL_THREADING_SKIP = new Set([
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
 * Step 4c of the evaluation of a function expression, shared by the
 * synchronous and the asynchronous routes: lift a conditional operand
 * (`When`/`Which`) of the evaluated operands `tail` out of the application
 * `expr`, so that the operator applies to the values and the result carries
 * the condition (`Sin(When(3, c))` is `When(Sin(3), c)`). Returns `undefined`
 * when there is nothing to lift.
 *
 * A broadcastable operator lifts a conditional at any position, except the
 * logic operators (`CONDITIONAL_THREADING_SKIP`). An operator that is not
 * broadcastable lifts it at the positions that its `threadsConditionals`
 * flag selects; at those positions a `List` whose every cell has the same
 * condition is first read back as that restricted list
 * (`regroupRestrictedCells`).
 *
 * The lift is written once for the two routes, as steps
 * (`ConditionalThreadingSteps`): it yields each application of the operator
 * to the values, and it receives the value of that application back. The
 * synchronous route runs the steps with `runMaterialization()`, which
 * evaluates each application with `evaluate()`, and the asynchronous route
 * with `runMaterializationAsync()`, which evaluates it with
 * `evaluateAsync()`. So an operator that has only an `evaluateAsync`
 * handler is lifted on the asynchronous route too: `AsyncOnly(1 {0<t})` is
 * `AsyncOnly(1) {0<t}` there, with the handler applied to `1`.
 */
function* threadConditionalOperands(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  tail: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): ConditionalThreadingSteps {
  const ce = expr.engine;
  if (def.broadcastable && !CONDITIONAL_THREADING_SKIP.has(expr.operator)) {
    if (!tail.some((x) => isFunction(x, 'When') || isFunction(x, 'Which')))
      return undefined;
    return yield* threadConditional(
      ce,
      expr.operator,
      tail,
      def.lazy === true,
      options,
      expr,
      def.resolvedMissingBehavior === 'propagate'
    );
  }
  if (
    def.threadsConditionals === false ||
    // A cheap test first, so that an application with no conditional
    // operand (the common case) allocates nothing: only a `When`, a
    // `Which`, or a `List` (which can hold restricted cells) at a
    // threaded position can be lifted.
    !tail.some(
      (x, i) =>
        def.threadsConditionalsAt(i) &&
        (isFunction(x, 'When') ||
          isFunction(x, 'Which') ||
          isFunction(x, 'List'))
    )
  )
    return undefined;
  const threadsAt = (i: number) => def.threadsConditionalsAt(i);
  const regrouped = tail.map((x, i) =>
    threadsAt(i) ? regroupRestrictedCells(ce, x) : x
  );
  if (
    !regrouped.some(
      (x, i) =>
        threadsAt(i) && (isFunction(x, 'When') || isFunction(x, 'Which'))
    )
  )
    return undefined;
  return yield* threadConditional(
    ce,
    expr.operator,
    regrouped,
    def.lazy === true,
    options,
    expr,
    def.resolvedMissingBehavior === 'propagate',
    threadsAt
  );
}

/**
 * `x` read back as a restricted list when it is the EVALUATED form of one, or
 * `x` itself otherwise.
 *
 * With its condition undecided, a restricted list `When([a, b], c)`
 * evaluates to the list of its restricted cells `[When(a, c), When(b, c)]`
 * (the `When` evaluate handler distributes the condition, so that the value
 * is a collection). An operator that reads the list whole — the inner
 * product of a vector, the norm, the coordinates of a list of points — gets
 * no point or number from such a cell. When every cell of the `List` is
 * restricted by the same condition, this returns `When([a, b], c)`, so that
 * the conditional-value lift moves the condition out of the application:
 * `Dot([1 {c}, 2 {c}], [1, 1])` is `Dot([1, 2], [1, 1]) {c}`, that is
 * `3 {c}`. A nested `List` whose cells regroup to the same condition counts
 * as a restricted cell.
 *
 * A list whose cells have different conditions (the value of an element-wise
 * restriction, `When(L, [c₁, c₂])`), or where only some cells are
 * restricted, is returned unchanged: there is no single condition to move
 * out, and only the operator knows whether it maps over the cells.
 */
function regroupRestrictedCells(ce: ComputeEngine, x: Expression): Expression {
  if (!isFunction(x, 'List') || x.nops === 0) return x;
  let guard: Expression | undefined;
  const bodies: Expression[] = [];
  for (const op of x.ops) {
    const cell = isFunction(op, 'List') ? regroupRestrictedCells(ce, op) : op;
    if (!isFunction(cell, 'When') || cell.nops !== 2) return x;
    // A cell restricted by a LIST of conditions is itself an element-wise
    // restriction, not one cell of a restricted list.
    if (isFunction(cell.op2, 'List')) return x;
    if (guard === undefined) guard = cell.op2;
    else if (!guard.isSame(cell.op2)) return x;
    bodies.push(cell.op1);
  }
  return ce._fn('When', [ce._fn('List', bodies), guard!]);
}

/**
 * True when `value` already carries the condition of every guard in
 * `guards` (all the same condition): it is `When(v, g)`, or a `List` or
 * `Tuple` whose every cell is. Restricting it again would give
 * `When(When(v, g), g)`, which prints as `v {g} {g}`: the `When` evaluate
 * handler distributes a condition into the cells of a list without merging
 * it with the condition a cell already has.
 */
function sameRestriction(
  value: Expression,
  guards: ReadonlyArray<Expression>
): boolean {
  const g = guards[0];
  if (g === undefined || !guards.every((x) => x.isSame(g))) return false;
  const restricted = (x: Expression): boolean =>
    isFunction(x, 'When') && x.nops === 2 && x.op2.isSame(g);
  if (restricted(value)) return true;
  return (
    (isFunction(value, 'List') || isFunction(value, 'Tuple')) &&
    value.nops > 0 &&
    value.ops.every(restricted)
  );
}

/**
 * `value` with `guard` applied to each of its cells, through nested lists
 * and the coordinates of a point: a `List` or a `Tuple` answers the same
 * container over its restricted cells, and any other value the restricted
 * value itself (`When(value, guard)`, evaluated). Used by `threadConditional`
 * when a scalar restriction lands in the cells of a broadcast result.
 */
function restrictCells(
  ce: ComputeEngine,
  value: Expression,
  guard: Expression,
  options: Partial<EvaluateOptions> | undefined
): Expression {
  if (isFunction(value, 'List') || isFunction(value, 'Tuple'))
    return ce._fn(
      value.operator,
      value.ops.map((cell) => restrictCells(ce, cell, guard, options))
    );
  return ce._fn('When', [value, guard]).evaluate(options);
}

/**
 * The error of a symbol that holds an error value, at the callback parameter
 * of the lazy operator `expr`, with the frame of the call. Returns
 * `undefined` when there is no such operand.
 *
 * A lazy operator holds its operands, so they are not evaluated before the
 * handler runs, and the rule "an operand whose value is an error makes the
 * call evaluate to that error" does not see the value of a symbol. With `w`
 * holding the error of `Ln("a")` (`isErrorTypedOperand()`), `Filter([1, 2],
 * w)`, `Any([1, 2], w)` and `Reduce([1, 2], w)` cannot apply `w`, so they
 * evaluate to the error of `w`, as the eager `Sort([2, 1], w)` does.
 *
 * Only the parameters that {@link callbackSlots} gives are checked. The
 * caller runs this only for a node with no scope of its own, so the symbol
 * is read in the scope where the operator applies its callback.
 */
function heldErrorCallback(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition
): Expression | undefined {
  for (const i of callbackSlots(def)) {
    const op = expr.ops[i];
    if (op === undefined || !isSymbol(op) || isWildcard(op)) continue;
    // A symbol with no value definition is not canonicalized: that would
    // declare it.
    if (!isValueDef(expr.engine.lookupDefinition(op.symbol))) continue;
    const symbol = op.isCanonical ? op : op.canonical;
    if (!isErrorTypedOperand(symbol)) continue;
    return errorValue(symbol.evaluate(), {
      operator: expr.operator,
      index: i + 1,
    });
  }
  return undefined;
}

/** The result of {@link callbackSlots} for each definition, with the
 * `_writeVersion` of the definition when it was computed. A definition can
 * change in place (a signature write, an update, a snapshot restore), and
 * each change increases its `_writeVersion`, so a different version means
 * that the result must be computed again. */
const CALLBACK_SLOTS = new WeakMap<
  BoxedOperatorDefinition,
  { version: number; slots: readonly number[] }
>();

/**
 * The positions of the callback parameters of a lazy operator: the required
 * and optional parameters whose type is a signature, or a union of
 * signatures (`predicate: (T) -> boolean` of `Filter`, `mapping: (T) -> U` of
 * `Map`). These are the lazy collection operators (`Any`, `Filter`, `Map`,
 * `Reduce`, `MaxBy`, ...).
 *
 * A parameter typed with the bare type `function` is not a callback
 * parameter here: the operators that have one (`Integrate`, `Limit`, `ND`,
 * `Pipe`, `Rule`, ...) can read the operand as an expression, or bind a
 * symbol of that name. An operator that selects among its operands
 * (`selectsOperands`) or inspects errors (`inspectsErrors`) has no callback
 * parameter here either: it decides itself what an error operand gives.
 */
function callbackSlots(def: BoxedOperatorDefinition): readonly number[] {
  const cached = CALLBACK_SLOTS.get(def);
  if (cached !== undefined && cached.version === def._writeVersion)
    return cached.slots;
  const found: number[] = [];
  const sig = def.signature.type;
  if (
    def.lazy === true &&
    !def.selectsOperands &&
    !def.inspectsErrors &&
    typeof sig !== 'string' &&
    sig.kind === 'signature'
  ) {
    const params = [...(sig.args ?? []), ...(sig.optArgs ?? [])];
    params.forEach((p, i) => {
      if (isSignatureParam(p.type)) found.push(i);
    });
  }
  CALLBACK_SLOTS.set(def, { version: def._writeVersion, slots: found });
  return found;
}

/** True when the parameter type `t` is a signature, or a union whose every
 * member is a signature. */
function isSignatureParam(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') return false;
  if (r.kind === 'signature') return true;
  return r.kind === 'union' && r.types.every((a) => isSignatureParam(a));
}

/**
 * Threading pre-pass for conditional values (`When`/`Which`), modeled on the
 * broadcast lift (step 4b). Given the already-evaluated `tail` of operator
 * `op`, lift a conditional operand outward:
 *
 * - **When (T1–T3), guard-outermost normal form:** if any operand is a `When`,
 *   strip each `When` to its value and collect its guard, then wrap the
 *   *evaluated* `op(strippedTail)` in a single `When` whose guard is the
 *   conjunction of the collected guards and re-evaluate. `When`'s canonical
 *   handler And-folds the guards and its evaluate handler resolves a decidable
 *   guard (T4/T5), so a True guard collapses to the bare value and a False
 *   guard to `Undefined`. Evaluating the inner application is what lets a fold
 *   run inside the guard (`0·x → 0`, `x − x → 0`) and an inner `Which`
 *   distribute (yielding `When(Which(…), g)`, decision 6).
 * - **Which (T6/T7), only when no `When` operand is present:** distribute over
 *   the lexicographic cross-product of branches — a non-`Which` operand is a
 *   single unconditional branch, each branch's condition is the `And` of the
 *   selected operands' conditions, and the branch value is `op` applied to the
 *   selected values. Lexicographic order preserves first-true-wins without a
 *   disjointness requirement. Cost-gated (decision 10): a product above 16
 *   branches stays inert (returns `undefined`).
 *
 * `lazy` operators (`Add`/`Multiply`/relations) reach the pre-pass with an
 * *un-evaluated* tail, so operands are evaluated here first — this both
 * surfaces a conditional nested under a lazy operand (e.g. `Negate(When)` in
 * `When − When`) and is a cheap cache hit for the already-evaluated tail of a
 * strict operator.
 *
 * `threadsAt` restricts the lift to some operand positions (the
 * `threadsConditionals` flag of an operator that is not broadcastable): a
 * conditional operand in another position is left in place, as a plain
 * operand. When it is given, a result that already carries the lifted
 * condition is not restricted a second time (`sameRestriction`).
 *
 * Returns `undefined` when there is nothing to thread, so the caller falls
 * through to normal evaluation — except for a `lazy` operator whose tail was
 * evaluated here and no longer holds a conditional, where the folded
 * application of the already-evaluated tail is returned to avoid re-evaluating
 * the operands.
 *
 * Each application of `op` to the values is yielded, not evaluated here: the
 * runner of the steps evaluates it (see `threadConditionalOperands`).
 */
function* threadConditional(
  ce: ComputeEngine,
  op: string,
  rawTail: ReadonlyArray<Expression>,
  lazy: boolean,
  options: Partial<EvaluateOptions> | undefined,
  application: Expression,
  propagate: boolean,
  threadsAt?: (i: number) => boolean
): ConditionalThreadingSteps {
  const tail = lazy
    ? rawTail.map((x) => x.evaluate(operandOptions(options)))
    : rawTail;
  const isThreaded = (x: Expression, i: number, head: 'When' | 'Which') =>
    isFunction(x, head) && (threadsAt === undefined || threadsAt(i));

  // --- `When` lift (guard-outermost) ---
  if (tail.some((x, i) => isThreaded(x, i, 'When'))) {
    const guards: Expression[] = [];
    const stripped = tail.map((x, i) => {
      if (isThreaded(x, i, 'When') && isFunction(x)) {
        guards.push(x.op2);
        return x.op1;
      }
      return x;
    });
    // Two operands restricted by the same condition (`Cross(P {c}, Q {c})`)
    // are restricted once.
    const distinct =
      threadsAt === undefined
        ? guards
        : guards.filter((g, k) => guards.findIndex((h) => h.isSame(g)) === k);
    const guard = distinct.length === 1 ? distinct[0] : ce._fn('And', distinct);
    const inner = yield ce._fn(op, stripped);
    // An error of the inner application (two points of different widths) is
    // an error whatever the condition, as it is once the condition holds.
    if (
      threadsAt !== undefined &&
      (isFunction(inner, 'Error') || sameRestriction(inner, distinct))
    )
      return inner;
    // A SCALAR restriction beside a collection or a point operand of a
    // broadcastable operator lands in each cell of the result:
    // `[1,2,3] + 2{c}` is `[3{c}, 4{c}, 5{c}]` and `2{c}·(1,2)` is
    // `(2{c}, 4{c})`, each cell `NaN` once `c` fails — exactly what the same
    // expression answers when `2{c}` is evaluated first (a masked number is
    // `NaN`, user decision 2026-09-25) and what the compiled code emits.
    // Restricting the whole result instead, `[3,4,5]{c}`, made it absent as
    // a whole (`Missing`) on this route while the fresh route answered
    // `[NaN, NaN, NaN]`. A restricted COLLECTION or POINT operand
    // (`[1,2]{c} + 1`, `P{c} + (1,1)`) still restricts the whole result: it
    // is one restriction over that value. When both kinds meet
    // (`[1,2]{a>0} + 2{b>0}`) the guards are kept APART, the scalar one in
    // the cells and the collection one around the whole result,
    // `[3{b>0}, 4{b>0}]{a>0}`: folded into one cell-wise conjunction the
    // result forgot that the list was one restriction, and answered
    // `[NaN, NaN]` once `a` failed where the fresh route answers `Missing`
    // for the absent list (that route then reads `Missing + 2{b>0}` as the
    // scalar `NaN{b>0}`, an absent value carrying no shape: recorded in
    // `ROADMAP.md`).
    if (
      threadsAt === undefined &&
      stripped.some((x) => x.isCollection || isTuple(x))
    ) {
      const cellGuards: Expression[] = [];
      const wholeGuards: Expression[] = [];
      for (const x of tail) {
        if (!isFunction(x, 'When')) continue;
        const scalar =
          !x.op1.isCollection &&
          !isTuple(x.op1) &&
          !x.op1.type.matches('collection<any>');
        (scalar ? cellGuards : wholeGuards).push(x.op2);
      }
      // A scalar guard that also restricts a collection operand
      // (`2{c}·P{c}`) is implied by the whole restriction: `(2, 4){c}`, not
      // `(2{c}, 4{c}){c}`.
      const cellOnly = cellGuards.filter(
        (g) => !wholeGuards.some((w) => w.isSame(g))
      );
      if (cellOnly.length > 0) {
        const cellGuard =
          cellOnly.length === 1 ? cellOnly[0] : ce._fn('And', cellOnly);
        const cells = restrictCells(ce, inner, cellGuard, options);
        if (wholeGuards.length === 0) return cells;
        const wholeGuard =
          wholeGuards.length === 1
            ? wholeGuards[0]
            : ce._fn('And', wholeGuards);
        return ce._fn('When', [cells, wholeGuard]).evaluate(options);
      }
    }
    return ce._fn('When', [inner, guard]).evaluate(options);
  }

  // --- `Which` distribution ---
  if (tail.some((x, i) => isThreaded(x, i, 'Which'))) {
    // Each operand contributes a list of (condition, value) branches; a
    // non-`Which` operand is a single unconditional branch (condition = null).
    const branchSets = tail.map((x, i) => {
      if (isThreaded(x, i, 'Which') && isFunction(x)) {
        const branches: { cond: Expression | null; value: Expression }[] = [];
        const ops = x.ops;
        for (let k = 0; k + 1 < ops.length; k += 2)
          branches.push({ cond: ops[k], value: ops[k + 1] });
        return branches;
      }
      return [{ cond: null as Expression | null, value: x }];
    });

    // Cost gate (decision 10): product of branch counts.
    let count = 1;
    for (const bs of branchSets) count *= bs.length;
    if (count > 16) return undefined;

    // Lexicographic cross-product: the first operand varies slowest, so every
    // lexicographically earlier branch has a false conjunct at the selected
    // point — first-true-wins is preserved without disjointness.
    let combos: { conds: Expression[]; value: Expression[] }[] = [
      { conds: [], value: [] },
    ];
    for (const bs of branchSets) {
      const next: typeof combos = [];
      for (const combo of combos)
        for (const b of bs)
          next.push({
            conds: b.cond ? [...combo.conds, b.cond] : combo.conds,
            value: [...combo.value, b.value],
          });
      combos = next;
    }

    const resultOps: Expression[] = [];
    for (const combo of combos) {
      const cond =
        combo.conds.length === 0
          ? ce.True
          : combo.conds.length === 1
            ? combo.conds[0]
            : ce._fn('And', combo.conds);
      resultOps.push(cond, yield ce._fn(op, combo.value));
    }
    return ce._fn('Which', resultOps).evaluate(options);
  }

  // Nothing (left) to thread. For a `lazy` operator we already evaluated the
  // tail above to inspect it — a `When`/`Which` operand that reduced to a plain
  // value during that evaluation (e.g. a `Which` whose selected branch has no
  // free variables, `2·{cond: x, y}`) leaves no conditional to lift. Return the
  // folded application of the already-evaluated tail so the caller does not
  // evaluate the operands a *second* time: falling through to `undefined` would
  // have the operator's own handler re-evaluate the raw tail, doubling the work
  // (and re-running any effectful selected branch). For a non-`lazy` operator
  // `tail === rawTail` was already evaluated by the caller, so there is nothing
  // to reuse — fall through.
  if (lazy) {
    // A conditional operand that evaluated to `Missing` (a restriction whose
    // condition is false) leaves an absent scalar in the tail. The folded
    // application below no longer holds the conditional's value type, so its
    // own absence gate would read a numeric type and answer `NaN`: `3·P{c}`,
    // with `P` a point, answered `NaN` when `c` is false. The marker is read
    // off the type of THIS application instead, as the absence gate of a
    // strict operator reads it: `Missing` when that type, less its `missing`
    // arm, is not numeric (`missing | tuple<integer, integer>` for `3·P{c}`),
    // and `NaN` otherwise.
    if (
      propagate &&
      hasAbsentScalarOperand(tail) &&
      tail.every((x) => x.isValid) &&
      !isSubtype(stripMissingFromType(application.type.type), 'number')
    )
      return absentScalarMarker(ce, application);
    // The same loss of type happens beside a list: a restricted point that
    // evaluated to `Missing` is, in the folded application, a bare absent
    // scalar, so each cell it meets answers `NaN` (`P{c} · [10, 20, 30]` was
    // `[NaN, NaN, NaN]` when `c` is false). The cell type of THIS
    // application, `missing | tuple<…>`, says each cell is a point, and an
    // absent point is `Missing`.
    return markAbsentPointCells(ce, application, yield ce._fn(op, tail));
  }

  return undefined;
}

/**
 * Is `x` an operand a user function literal maps over when applied to it?
 * A materialized finite collection, or a collection-TYPED operand (Tycho
 * item 73): `h(L+1)` / `h(2L)` — an unevaluated expression statically typed
 * as a list/vector broadcasts through the lambda at runtime (the post-eval
 * lambda-broadcast arm maps it element-wise), so the static type must be
 * the lifted list as well, exactly as at the generic wrapper's arm 1.
 *
 * ONE predicate for the two readers that must agree: the application's
 * type (`lambdaBroadcastType`) and its element count
 * (`BoxedFunction._lambdaBroadcastCount`). A scalar operand is a lift and
 * never participates.
 */
function isLambdaBroadcastParticipant(x: Expression): boolean {
  return (
    isFiniteBroadcastParticipant(x) ||
    isBroadcastCollectionType(x) ||
    isFixedShapeCollection(x)
  );
}

/**
 * The type of a call of a function literal with an argument that may be
 * absent as a whole and is otherwise a numeric tuple, at a scalar or open
 * parameter (`isNumericTupleArgumentType`): `missing | tuple<integer,
 * integer>` (an index read `L[k]` that can be out of range), or `missing |
 * tuple<missing, missing>` (the literal `(Missing, Missing)`, which
 * evaluates to `Missing`). Each arm of the argument types the call on its
 * own. With `f := x ↦ (-x, x)`, the `missing` arm gives `tuple<number,
 * missing>`, as `f(Missing)` is `(NaN, Missing)`, and the tuple arm gives
 * `any`, as `f((1, 2))` does (`lambdaBroadcastType`). The union of the two
 * is `any`.
 *
 * The caller asks only after the derivation from the body
 * (`callResultType`) declined: that derivation types each arm from the
 * body, and gives a precise answer for a body that passes the argument
 * through (`p ↦ p` over `L[k]` is `missing | tuple<number, number,
 * number>`). The conditions are those of the numeric-tuple rule of
 * `lambdaBroadcastType`: the parameter reaches the body, and the result was
 * inferred or is a number type. The descriptor route applies the same rule
 * in the same order (`deriveApplicationType`).
 */
function wholeAbsentTupleArgumentType(
  ops: ReadonlyArray<Expression>,
  perElementResult: Type,
  inferredResult: boolean,
  literal: Expression | undefined
): Type | undefined {
  if (
    (inferredResult || isSubtype(perElementResult, 'number')) &&
    ops.some(
      (x, i) =>
        isNumericTupleArgumentType(x.type.type) &&
        parameterReachesBody(literal, i)
    )
  )
    return 'any';
  return undefined;
}

/**
 * Application-site broadcast typing for a USER FUNCTION LITERAL — a lambda
 * (`ce.assign('g', x ↦ …)`), whether it resolves through an operator
 * definition or a value definition. Both routes in `type()` call this ONE
 * helper so the two spellings of the same assignment cannot drift apart.
 *
 * `perElementResult` is the already-instantiated signature result. For a
 * lambda application the per-element result IS the signature result
 * (`f := x ↦ [x, -x]` maps EACH element to `[x, -x]`, so the element type is
 * `list<number>`, not its unwrapped `number`) — callers pass it verbatim,
 * never `broadcastElementType` of it, which would unwrap a collection-valued
 * return and mis-type `f([1, 2])` as `list<number>` instead of
 * `list<list<number>>`.
 *
 * `slots` is the declared `broadcastable<T>` slot plan when the signature
 * declares one (Option A): a collection-typed slot binds its argument whole
 * and never lifts. `inferredResult` is true when the signature result was
 * inferred from the body rather than declared by the user.
 *
 * Returns the broadcast-typed result, or `undefined` when no broadcast
 * typing applies and the caller's scalar result stands.
 */
function lambdaBroadcastType(
  ops: ReadonlyArray<Expression>,
  perElementResult: Type,
  slots: ReturnType<typeof broadcastableParamSlots>,
  inferredResult: boolean,
  generic = false,
  // The per-element result derived from the body for the mapped operands
  // (`derivedBroadcastElementResult`), called once the lift is known to
  // apply; `undefined` keeps `perElementResult`. `operandTypes` has the
  // same meaning as the parameter of this function with that name.
  derive?: (
    mappedAt: ReadonlyArray<boolean>,
    operandTypes?: ReadonlyArray<Type | undefined>
  ) => Type | undefined,
  // The function literal that is applied, when it is known.
  literal?: Expression,
  // For a generic literal: the instantiated result of the call when each
  // operand with a type in `arms` has that type and the other operands keep
  // their types. It lets union operands be typed arm by arm
  // (`operandArms`).
  instantiateWith?: (arms: ReadonlyArray<Type | undefined>) => Type | undefined,
  // The type to read for each operand in place of the type of the operand
  // expression, or `undefined` to read the expression. An operand with such
  // a type takes part in the broadcast, unless `wholeAt` marks it. Only the
  // typing arm by arm (`byArms` below) gives it, to type the arms of union
  // operands.
  operandTypes?: ReadonlyArray<Type | undefined>,
  // The operands of `operandTypes` that bind whole: their type is an arm
  // that the broadcast does not map (a `set`, a scalar), and the call passes
  // their value whole to the literal at each element of the mapped operands.
  wholeAt?: ReadonlyArray<boolean>
): Type | undefined {
  const typeAt = (i: number): Type => operandTypes?.[i] ?? ops[i].type.type;
  // A numeric-tuple argument binds WHOLE to a scalar parameter (atomic,
  // never mapped), then the body's own arithmetic decides the shape:
  // `g := x ↦ 2x` gives `g((1,2)) = 2·(1,2) = (2,4)`, a tuple, while
  // `x ↦ Abs(x)` gives the norm, a scalar. The signature result describes a
  // scalar argument, whether it was inferred or declared (a declared
  // `(real) -> real` called with a tuple evaluates to a tuple), so it does
  // not bound the value, and the body's shape is not statically knowable —
  // return `any`. (Typing the body with the parameter typed as the tuple was
  // tried on 2026-09-26: the descriptor-based derivation gave wrong narrow
  // types for a nested user call inside a list. It also gave them for
  // `P·Norm(P)`, but that one is fixed: the `Multiply` type handler now
  // widens the components of a tuple by a scalar factor known only by its
  // type, as it does for a declared scalar.)
  // A DECLARED result that is not a number type is kept: a generic
  // `(x: T) -> T where T` instantiates `T` to the tuple, and a declared
  // tuple result describes the tuple argument.
  // A tuple with an open component (`(a, a)` for a parameter `a` of an
  // enclosing function literal, or for an undeclared symbol) is treated the
  // same way, because it is a numeric tuple when the component holds a
  // number (`mayBeNumericTupleType`). A tuple bound to a parameter that the
  // body of `literal` never reads does not change the value, and the
  // signature result stands (`parameterReachesBody`). A tuple with an absent
  // component (`(1, Missing)`) is a numeric tuple too, as it is for the
  // arithmetic handlers (`isNumericTupleType`). An argument that may be
  // absent as a whole (`missing | tuple<integer, integer>`) is not read
  // here: the derivation from the body (`callResultType`) types it first,
  // and `wholeAbsentTupleArgumentType` applies this rule only when that
  // derivation declines.
  if (
    ops.some(
      (_x, i) =>
        (isNumericTupleType(typeAt(i)) || mayBeNumericTupleType(typeAt(i))) &&
        parameterReachesBody(literal, i)
    ) &&
    (inferredResult || isSubtype(perElementResult, 'number'))
  )
    return 'any';

  const mappable = (i: number) => slots === undefined || slots.at(i).mappable;
  const participates = (i: number) =>
    mappable(i) &&
    wholeAt?.[i] !== true &&
    (operandTypes?.[i] !== undefined || isLambdaBroadcastParticipant(ops[i]));
  const mapped = ops.filter((_x, i) => participates(i));
  const mappedTypes = ops.flatMap((_x, i) =>
    participates(i) ? [typeAt(i)] : []
  );
  // The result of the call for one combination of arms of the operands at
  // `indices`: `combo[k]` is the arm of the operand `indices[k]`, with its
  // type and whether the broadcast maps it. A generic literal reads the
  // result from its type solver (`instantiateWith`). Another literal derives
  // it from its body (`derive`): through the broadcast below when an arm is
  // mapped, and with each operand typed as its arm when every arm binds
  // whole.
  const comboResult = (
    indices: ReadonlyArray<number>,
    combo: ReadonlyArray<OperandArm>
  ): Type | undefined => {
    const types: Array<Type | undefined> = ops.map(() => undefined);
    const whole: boolean[] = ops.map(() => false);
    indices.forEach((i, k) => {
      types[i] = combo[k].type;
      whole[i] = !combo[k].mapped;
    });
    const armResult = generic ? instantiateWith?.(types) : perElementResult;
    if (armResult === undefined) return undefined;
    if (combo.some((arm) => arm.mapped))
      return (
        lambdaBroadcastType(
          ops,
          armResult,
          slots,
          inferredResult,
          generic,
          derive,
          literal,
          undefined,
          types,
          whole
        ) ?? armResult
      );
    // The numeric-tuple rule above, for these arms. It applies only when
    // the function has a value (`literal`): the body may then compute on
    // the tuple and give a value of another shape. A function with no value
    // does not evaluate, and the call keeps the signature result.
    if (
      literal !== undefined &&
      indices.some(
        (i, k) =>
          (isNumericTupleType(combo[k].type) ||
            mayBeNumericTupleType(combo[k].type)) &&
          parameterReachesBody(literal, i)
      ) &&
      (inferredResult || isSubtype(armResult, 'number'))
    )
      return 'any';
    if (generic) return armResult;
    // When the body gives no type for the arms, the signature result
    // stands, as it does for a call over operands of those types alone.
    return (
      derive?.(
        ops.map(() => false),
        types
      ) ?? armResult
    );
  };
  // The type of the call when the operands at `indices` are typed arm by
  // arm (`operandArms`), or `undefined` when that typing does not apply.
  // The call maps a value of a mapped arm at its leaves and passes a value
  // of another arm whole, and each operand takes its value independently of
  // the others, so the answer is the union of the results over every
  // combination of one arm for each operand. With
  // `h: (x: T, y: T) -> tuple<T, T>` and `a, b: collection<integer>`,
  // `h(a, b)` is `[(1, 3), (2, 4)]` for two lists, `(Set(1, 2), Set(3, 4))`
  // for two sets, and `[(1, Set(3, 4)), (2, Set(3, 4))]` for a list and a
  // set. An operand of `indices` that has no such arms must be one that the
  // broadcast maps (a list), and it is mapped in every combination;
  // otherwise the typing does not apply. When the number of combinations
  // is more than `MAX_OPERAND_ARM_COMBINATIONS`, the answer is `any`, which
  // holds every value.
  const byArms = (indices: ReadonlyArray<number>): Type | undefined => {
    if (slots !== undefined || operandTypes !== undefined) return undefined;
    if (generic ? instantiateWith === undefined : derive === undefined)
      return undefined;
    const armsAt: Array<ReadonlyArray<OperandArm>> = [];
    let split = false;
    for (const i of indices) {
      const arms = operandArms(typeAt(i));
      if (arms !== undefined) {
        split = true;
        armsAt.push(arms);
        continue;
      }
      const t = expandAliasesForLift(typeAt(i));
      if (t === null || !isMappedActual(t)) return undefined;
      armsAt.push([{ type: typeAt(i), mapped: true }]);
    }
    if (!split) return undefined;
    const count = armsAt.reduce((n, arms) => n * arms.length, 1);
    if (count > MAX_OPERAND_ARM_COMBINATIONS) return 'any';
    const results: Type[] = [];
    const combo: OperandArm[] = [];
    const visit = (k: number): boolean => {
      if (k === armsAt.length) {
        const r = comboResult(indices, combo);
        if (r === undefined) return false;
        results.push(r);
        return true;
      }
      for (const arm of armsAt[k]) {
        combo[k] = arm;
        if (!visit(k + 1)) return false;
      }
      return true;
    };
    if (!visit(0)) return undefined;
    return reduceType({ kind: 'union', types: results });
  };
  if (mapped.length > 0) {
    // A literal over operands whose types are unions with an arm that the
    // broadcast does not map (a `set`, a tuple, a scalar, an abstract
    // `collection`) is typed arm by arm (`byArms`).
    const byArm = byArms(
      ops.flatMap((_x, i) => (participates(i) ? [i] : []))
    );
    if (byArm !== undefined) return byArm;

    // D10 (§4.4, re-ruled 2026-08-04): `perElementResult` is the
    // PER-ELEMENT result — the solver bound each lift-admitted operand's
    // element type — so the ordinary wrap below is the whole answer. It
    // reproduces the retired echo short-circuit on the bare-echo shape
    // (`f([1,2,3])` under `(T) -> T where T` is `vector<…^3>`, since `T`
    // binds `integer` and the wrap re-adds the operand's rank) and
    // fixes the variable-MENTIONING shapes the short-circuit could not
    // reach.
    // As at the generic wrapper's arm 1: when every mapped operand is a
    // LONE scalar-or-collection union (a valueless `u: number |
    // list<number>`, with no operand that is definitely a collection), the
    // application is not a collection and the result carries the union
    // through — `f(u)` for `f := x ↦ 2x` types
    // `number | list<number>`, the same as `2u`, instead of
    // the definite `list<E>` that `u := 5` contradicts.
    const loneUnionResult = loneUnionBroadcastResultType(
      mappedTypes,
      perElementResult
    );
    if (loneUnionResult !== undefined) return loneUnionResult;

    // From here the lift applies: the per-element result is the body's
    // type with each mapped operand typed as its cell, when that can be
    // derived. A generic literal is not derived: its type solver bound the
    // type parameter, and `perElementResult` is that instantiation.
    if (!generic && derive !== undefined)
      perElementResult =
        derive(
          ops.map((_x, i) => participates(i)),
          operandTypes
        ) ?? perElementResult;

    // A collection-valued per-element result keeps the plain nested lift
    // (`f := x ↦ [x,-x]` over `[1,2]` → `list<vector<2>>`): installing the
    // collection result as the element of a dimensioned list mixes
    // encodings and breaks `evaluated ⊆ declared` (the value is a rank-2
    // tensor with scalar leaves).
    const collectionValued =
      isSubtype(perElementResult, COLLECTION_SHAPE_TYPE) ||
      (typeof perElementResult !== 'string' &&
        perElementResult.kind === 'union' &&
        perElementResult.types.some((m) =>
          isSubtype(m, COLLECTION_SHAPE_TYPE)
        ));
    // One list level per rank the broadcast descends: a nested list is
    // mapped at its leaves (`nestedBroadcastResultType`). A declared
    // `broadcastable<T>` slot plan (`slots`) maps exactly one rank, and
    // takes one level. A GENERIC signature takes the shape-aware typing
    // below: the call maps the literal over the leaves of its operand, so
    // the value has the operand's rank (`g := (x: T) -> tuple<T, T>` over
    // `[[1, 2], [3, 4]]` is `[[(1, 1), (2, 2)], [(3, 3), (4, 4)]]`, a
    // `matrix<tuple<integer, integer>^(2x2)>`). One list level around the
    // result, `list<tuple<integer, integer>>`, does not hold that value: a
    // list is read by its elements, and the elements of the value are rows
    // of tuples. The shape-aware typing applies only when the type solver
    // bound the type parameter to the leaves of every operand
    // (`genericLiftLevels`); otherwise the result is wrapped once for each
    // level the solver removed, as before. An operand with rows of
    // different lengths gives a value whose rows differ in length, and the
    // result is wrapped in plain lists, one for each level of the operand.
    const shapeAwareGeneric = generic && slots === undefined;
    if (shapeAwareGeneric) {
      const levels = genericLiftLevels(mappedTypes);
      if (levels === 'nested')
        return nestedBroadcastResultType(mappedTypes, perElementResult);
      if (levels !== undefined) {
        // When the leaf the solver reached may still be a list (`any`, the
        // element of a `list<any>`), the call maps that list at its leaves
        // too, and an element of the innermost level is a cell or a list of
        // any depth: `list<R | list<any>>`.
        let wrapped = levels.leafMayBeList
          ? widen(perElementResult, { kind: 'list', elements: 'any' })
          : perElementResult;
        for (let k = 0; k < levels.levels; k++)
          wrapped = broadcastResultType(wrapped);
        return wrapped;
      }
    }
    if (collectionValued && !shapeAwareGeneric)
      return generic || slots !== undefined
        ? broadcastResultType(perElementResult)
        : nestedBroadcastResultType(mappedTypes, perElementResult);
    // Shape-aware (§D6.1): the map preserves the source's structure. When
    // the mapped operands have different ranks (a matrix beside a list),
    // the shape-aware form gives one plain list level, but the value is
    // mapped to the DEEPEST rank (`[[1,2],[3,4]]` beside `[5,6]` gives a
    // matrix), so the nested form, which wraps one level per rank of the
    // deepest operand, is the one the value is a member of. A declared slot
    // plan keeps the shape-aware form, for the reason given above (one rank
    // is its whole lift).
    const types = mappedTypes;
    // The source's shape is kept when the per-element result may carry
    // dimensions (a result that cannot be a list: a number, a boolean, a
    // tuple), and spelled as nested plain lists otherwise
    // (`shapedBroadcastResultType`).
    const shaped = shapedBroadcastResultType(types, perElementResult);
    if (slots !== undefined) return shaped;
    const nested = nestedBroadcastResultType(types, perElementResult);
    const result = listRank(nested) > listRank(shaped) ? nested : shaped;
    // A generic literal over an operand whose rank is not known (a
    // `tensor<integer>`): a result that cannot be a list is a tensor of
    // unknown rank (`tensor<R>`; `x ↦ (x, x)` gives a
    // `tensor<tuple<integer, integer>>`), but no type spells a nesting of
    // unknown depth whose cells may be lists, and the shaped form is then
    // the rank-1 reading `list<R>`, which holds the value only when the
    // operand has rank 1.
    // When some operand is not known to have rank 1, the elements of the
    // value may be `R` or a list, so the answer is `list<R | list<any>>`.
    // One mapped operand whose type is a union of lists of known ranks
    // (`list<integer> | matrix<integer>`) is typed arm by arm instead: a
    // value of the operand is a value of one arm, and the call over it has
    // the shape of that arm (`unionArmsGenericResult`).
    if (
      shapeAwareGeneric &&
      typeof result === 'object' &&
      result.kind === 'list' &&
      result.dimensions === undefined &&
      listRank(result) === listRank(perElementResult) + 1 &&
      !types.every((t) => staticCollectionDims(t)?.length === 1)
    )
      return (
        unionArmsGenericResult(types, perElementResult) ?? {
          kind: 'list',
          elements: widen(perElementResult, { kind: 'list', elements: 'any' }),
        }
      );
    return result;
  }
  // No operand is a statically-visible collection, but an operand's
  // collection-ness may not be statically knowable — it might broadcast at
  // runtime or stay scalar, so the honest result is `broadcastable<E>`, not
  // a definite `list<E>`. An operand of an ABSTRACT collection type
  // (`collection<T>`) is such an operand: it may hold a list or a range,
  // which the call maps over, or a set, which it does not map over (the
  // same rule as arm 2 of `broadcastLiftType`, `broadcast-lift-type.ts`).
  // An operand that holds a set now is typed from that value: the call does
  // not map over it.
  const triggers = ops.flatMap((x, i) =>
    mappable(i) &&
    (isPossiblyCollectionTyped(x) ||
      (abstractCollectionCell(x.type.type) !== undefined &&
        !holdsUnindexedCollection(x)))
      ? [i]
      : []
  );
  if (triggers.length > 0) {
    // A generic literal over operands of an abstract collection type
    // (`collection<integer>`) is typed arm by arm: the call maps a value
    // that is a list or a range at its leaves, and passes a set whole, so
    // the result is the union of the mapped and whole readings over the
    // operands (`byArms`). The `broadcastable` of the instantiated result
    // below does not hold the mapped values: the type solver bound the type
    // parameter to the whole collection, not to its elements.
    if (generic) {
      const byArm = byArms(triggers);
      if (byArm !== undefined) return byArm;
    }
    // A top-typed trigger gives a numeric application the top type (see
    // `topTypeOfTriggers` in `broadcast-lift-type.ts`); the cell of an
    // abstract collection is such a trigger too, as in `broadcastLiftType`.
    const top = topTypeOfTriggers(
      ops.flatMap((x, i) => {
        if (!mappable(i)) return [];
        if (isPossiblyCollectionTyped(x)) return [{ type: x.type.type }];
        const cell = abstractCollectionCell(x.type.type);
        return cell !== undefined && !holdsUnindexedCollection(x)
          ? [{ type: cell.cell }]
          : [];
      }),
      perElementResult
    );
    if (top !== undefined) return top;
    return broadcastableOf(perElementResult);
  }
  return undefined;
}

/**
 * For a call of a generic function literal that broadcasts over operands of
 * the types `types`: the number of list levels (`levels`) to wrap around
 * the instantiated result when the type solver did not bind the type
 * parameter to the leaves of an operand, or `undefined` when the
 * shape-aware typing applies (the solver reached the leaves of every
 * operand, or an operand is a tensor of unknown rank or a
 * `broadcastable`).
 *
 * The solver binds a parameter at a mapped slot to one element of the
 * operand, peeled through every list level (`liftedElementTypeOf`,
 * `common/type/instantiate.ts`), and the call maps the literal over the
 * leaves of the operand. This function counts the levels the same way, for
 * a list and for an `indexed_collection`. The peel stops at an element
 * that is not a list: when that element may still be a list (`any`, the
 * element of a `list<any>`), the instantiated result describes that
 * element, not a leaf, and the shape-aware typing would add levels that the
 * result already stands for, so the result is wrapped once for each peeled
 * level, and `leafMayBeList` is set: the call maps such an element at its
 * leaves too, so the caller widens the cell with `list<any>`. A tensor of
 * unknown rank is peeled once, to `U | tensor<U>`, and takes the
 * shape-aware typing, which gives a result of unknown rank. A
 * `broadcastable<T>` takes the shape-aware typing too, since its value is
 * a `T` or a collection of `T`. A union of mapped collections is peeled arm
 * by arm, as the solver peels it. An operand that the solver does not peel
 * (a union with an arm that is not a mapped collection, a top type) gives
 * one level, as before, with `leafMayBeList` set for a top type or a bare
 * collection name.
 *
 * The answer is `'nested'` when the peel of a list operand reaches a union
 * that has a list member. The rows of a ragged list (`[[1], [2, 3]]`, a
 * `list<vector<integer^1> | vector<integer^2>>`) are such a union: the
 * solver peels each row to its leaves and binds the parameter to their
 * join (`integer`), and the call maps each row to its leaves, so the
 * value is `[[(1, 1)], [(2, 2), (3, 3)]]` for `x ↦ (x, x)`. The rows of the
 * value differ in length, so the caller wraps the result in plain lists,
 * one level for each level of the operand
 * (`nestedBroadcastResultType`): `list<list<tuple<integer, integer>>>`.
 * When the members reach their leaves at different depths, or a member is
 * not a list (`[1, [2, 3]]`), each element of the value has its own depth,
 * and `nestedBroadcastResultType` gives `list<any>`.
 */
function genericLiftLevels(
  types: ReadonlyArray<Type>
): { levels: number; leafMayBeList: boolean } | 'nested' | undefined {
  let levels = 0;
  let incomplete = false;
  let unknownRank = false;
  let ragged = false;
  const read = (t0: Type, seen0: AliasDescent): boolean => {
    // The alias is unfolded under the descent guard: an alias that names
    // itself as a union arm (`type alias lcyc = lcyc | list<integer>`)
    // unfolds to the same union each time. When the guard cuts it, the
    // operand is read as not peeled, and the result takes one level.
    const unfolded = unfoldAliasOnDescent(t0, seen0);
    if (unfolded === undefined) return false;
    const t = unfolded.type;
    const seen = unfolded.seen;
    if (typeof t === 'object' && t.kind === 'union')
      return t.types.every((m) => read(m, seen));
    if (typeof t === 'object' && t.kind === 'list' && t.dimensions === null) {
      unknownRank = true;
      return true;
    }
    // A `broadcastable<T>` holds a `T` or a collection of `T`: the depth of
    // its value is not known, whatever `T` is. The solver binds the
    // parameter to the leaves of `T` (`liftedElementTypeOf`), and the
    // shape-aware typing gives a result of any depth (a tensor of unknown
    // rank when `T` cannot hold a list).
    if (typeof t === 'object' && t.kind === 'broadcastable') {
      unknownRank = true;
      return true;
    }
    if (
      typeof t !== 'object' ||
      !(t.kind === 'list' || t.kind === 'indexed_collection')
    )
      return false;
    let e = collectionElementType(t);
    if (e === undefined) return false;
    let depth = 1;
    // The solver peels the element of an `indexed_collection` to its
    // leaves, as it peels the element of a list (`liftedElementTypeOf`),
    // and the levels are counted the same way.
    if (t.kind === 'list' || t.kind === 'indexed_collection') {
      while (typeof e === 'object' && e.kind === 'list') {
        // The leaves of a tensor of unknown rank are its cells, as the
        // solver reads them (`peelListLevels`, `common/type/instantiate.ts`).
        // Each element of the operand is a tensor with its own rank
        // (`[[1, 2], [[3]]]` is a `list<tensor<integer>>`), so the elements
        // of the value can have different depths, and the result takes the
        // nested form.
        if (e.dimensions === null) {
          ragged = true;
          e = e.elements;
          break;
        }
        const next = collectionElementType(e);
        if (next === undefined) break;
        e = next;
        depth += 1;
      }
      if (
        typeof e === 'object' &&
        e.kind === 'union' &&
        e.types.some((m) => typeof m === 'object' && m.kind === 'list')
      )
        ragged = true;
    }
    levels = Math.max(levels, depth);
    if (mayBeListElement(e, descendIntoConstructor(seen))) incomplete = true;
    return true;
  };
  // A transparent alias is read through its definition, as the type solver
  // reads it (`expandAliasesForLift`, `common/type/instantiate.ts`): the
  // solver binds the parameter to the leaves under the alias, and the levels
  // must be counted to the same leaves. An alias that nests itself in a list
  // element has leaves at a depth the type does not bound; the solver then
  // binds the parameter to `any`, and the result takes the nested form,
  // which is `list<any>` for such an operand.
  //
  // An operand that the solver does not peel binds the parameter whole, and
  // the result takes one level. When the operand is a top type or a bare
  // collection name (`any`, `list`), the call maps a value of it at its
  // leaves, which can be at any depth, so `leafMayBeList` is set and the
  // caller widens the cell with `list<any>`.
  for (const t0 of types) {
    const t = expandAliasesForLift(t0);
    if (t === null) return 'nested';
    if (!read(t, undefined))
      return {
        levels: 1,
        leafMayBeList: typeof t === 'string' && mayBeListElement(t, undefined),
      };
  }
  if (unknownRank) return undefined;
  if (ragged) return 'nested';
  // The peel stopped at an element that may still be a list (`any` for a
  // `list<any>` operand): the call maps that element at its leaves too.
  return incomplete ? { levels, leafMayBeList: true } : undefined;
}

/** Whether a value of the element type `t` may be a list: a top type, a
 * bare collection name, a list or an abstract indexed collection, or a
 * union with such an arm. The alias is unfolded under the descent guard
 * `seen`, and an alias that the guard cuts (it names itself as a union arm)
 * answers `true`: nothing is known about its values. */
function mayBeListElement(t0: Type, seen0: AliasDescent): boolean {
  const unfolded = unfoldAliasOnDescent(t0, seen0);
  if (unfolded === undefined) return true;
  const t = unfolded.type;
  const seen = unfolded.seen;
  if (typeof t === 'string')
    return (
      t === 'any' ||
      t === 'unknown' ||
      t === 'value' ||
      t === 'expression' ||
      t === 'list' ||
      t === 'collection' ||
      t === 'indexed_collection'
    );
  if (
    t.kind === 'list' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'broadcastable'
  )
    return true;
  if (t.kind === 'union') return t.types.some((m) => mayBeListElement(m, seen));
  return false;
}

/**
 * The per-element result of a BROADCAST user-function call, derived from
 * the body, or `undefined` when nothing is derived.
 *
 * `lambdaBroadcastType` wraps a per-element result in one list level per
 * rank. Its callers hand it the instantiated signature result, which for a
 * lambda whose result was inferred from the body is the body's type with
 * every parameter `unknown`. A parameter that flows into the result
 * unchanged — `f(x, y, z) := (−y, z, x)` — is therefore `unknown` in that
 * result (`tuple<number, unknown, unknown>`), and the lifted type carried
 * the `unknown` into every cell, although the call maps a number into each
 * cell: `f([1, 2], [3, 4], [5, 6])` evaluates to `[(−3, 5, 1), (−4, 6, 2)]`
 * and typed `list<tuple<number, unknown, unknown>>`. A scalar call never
 * had the gap, because `callResultType` derives its type from the body with
 * each parameter typed as its argument. This helper does the same for the
 * broadcast call: each mapped operand (a `mappable` slot that is a
 * `isLambdaBroadcastParticipant`) is described by the LEAF cell type the
 * broadcast maps over (`broadcastLeafType`), every other operand by itself,
 * and the body's type under those descriptors is the per-element result.
 * `callResultType` keeps its guards — the result is accepted only when it
 * is a subtype of `perElementResult`, and a recursive or unsupported body
 * answers `undefined` — so a caller that gets `undefined` lifts the
 * signature result as before. `lambdaBroadcastType` calls this helper
 * after its early exits (a numeric-tuple argument, a lone scalar-or-list
 * union) and not for a generic literal, whose type solver binds the type
 * parameter itself. The motivating case is a chain of rotation helpers
 * whose innermost one is a pass-through, called with a list of angles
 * (Tycho ledger row 373).
 */
function derivedBroadcastElementResult(
  expr: BoxedFunction,
  mappedAt: ReadonlyArray<boolean>,
  perElementResult: Type,
  oneRank: boolean,
  // The type to read for each operand in place of the type of the operand
  // expression (one arm of its union type), or `undefined` to read the
  // expression.
  operandTypes?: ReadonlyArray<Type | undefined>
): Type | undefined {
  const args: OperandDescriptor[] = [];
  // By position, not by identity: one boxed expression may fill a mapped
  // slot and a slot that binds whole.
  for (const [i, x] of expr.ops.entries()) {
    const t = operandTypes?.[i];
    if (mappedAt[i]) {
      // A declared `broadcastable<T>` slot plan maps exactly one rank (a
      // nested row binds whole), so the cell is the element one rank down;
      // a scalar-parameter broadcast descends to the leaves.
      const cell = oneRank
        ? collectionElementType(resolveTypeAlias(t ?? x.type.type))
        : broadcastLeafType(t ?? x.type.type);
      if (cell === undefined) return undefined;
      args.push(describeType(cell));
    } else args.push(t !== undefined ? describeType(t) : describeOperand(x));
  }
  return callResultType(
    expr.engine,
    expr.operator,
    args,
    perElementResult,
    (h, a) => deriveApplicationType(expr.engine, h, a),
    expr.valueDefinition !== undefined
      ? { value: expr.valueDefinition }
      : expr.operatorDefinition !== undefined
        ? { operator: expr.operatorDefinition }
        : undefined
  );
}

/**
 * The type of the cells a scalar-parameter broadcast maps over in a
 * collection of type `t`: the element type, descended through nested
 * indexed collections to the leaves, as `nestedBroadcastResultType`
 * descends them (a list of lists is mapped at its leaves; a tuple, a string
 * or a non-indexed collection is a cell). `undefined` for a type with no
 * element type (a bare `list`), for a union (whose cells may differ), and
 * for a nesting deeper than any type nests in practice.
 */
function broadcastLeafType(t0: Type): Type | undefined {
  const MAX_RANK = 8;
  let t = resolveTypeAlias(t0);
  for (let d = 0; d < MAX_RANK; d++) {
    if (typeof t === 'object' && t.kind === 'union') return undefined;
    if (typeof t === 'object' && t.kind === 'tuple') return t;
    if (isSubtype(t, 'string')) return t;
    if (!isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)) return t;
    const e = collectionElementType(t);
    if (e === undefined) return undefined;
    t = resolveTypeAlias(e);
  }
  return undefined;
}

/** The type solver's view of the operands `ops`, with each operand that has
 * a type in `arms` read as having that type (one arm of its union type). */
function operandActualsWithArms(
  ops: ReadonlyArray<Expression>,
  arms: ReadonlyArray<Type | undefined>
): SolveActual[] {
  return ops.map((x, i) => {
    const actual = actualOfOperand(x);
    const arm = arms[i];
    if (arm === undefined) return actual;
    return {
      type: arm,
      literal: actual.literal,
      valid: actual.valid,
      inferable: actual.inferable,
      get liftable(): boolean {
        return actual.liftable;
      },
    };
  });
}

/** One arm of the type of an operand of a broadcast call (`operandArms`):
 * its type, and whether the broadcast maps a value of it. */
type OperandArm = { readonly type: Type; readonly mapped: boolean };

/** The largest number of combinations of arms (`operandArms`) that a call
 * is typed over, one result for each combination. A call over more
 * combinations is typed `any`. */
const MAX_OPERAND_ARM_COMBINATIONS = 8;

/**
 * The arms of the type `t0` of an operand of a broadcast call, when `t0` is
 * a union with an arm that the broadcast maps and an arm that it does not
 * map: one arm for the union of the arms that the broadcast maps
 * (`mapped: true`), and one arm for each other arm (`mapped: false`).
 * `undefined` when the rule does not apply.
 *
 * The type solver binds the type parameter of a generic literal to such a
 * union as a whole (`liftedElementTypeOf`, `common/type/instantiate.ts`).
 * But the call passes a value of an arm that is not mapped (a `set`, a
 * tuple, a scalar) whole to the literal, and maps a value of a mapped arm
 * at its leaves, so one answer for the whole union does not describe the
 * values. With `f: (x: T) -> tuple<T, T>` and
 * `u: list<integer> | set<integer>`, `f(u)` is `[(1, 1), (2, 2)]` for
 * `u := [1, 2]` and `(Set(1, 2), Set(1, 2))` for `u := Set(1, 2)`. The
 * caller types the call once for the mapped arms, typed together as one
 * operand that the broadcast maps (`list<tuple<integer, integer>>`), and
 * once for each other arm, typed as an operand that binds whole
 * (`tuple<set<integer>, set<integer>>`), and joins the results.
 *
 * An arm of an abstract collection type (`collection<integer>`, or a `t0`
 * that is such a type and not a union) has values that the call maps (a
 * list, a range) and values that it passes whole (a set, a dictionary), so
 * it gives both readings: it is an arm that binds whole, and its indexed
 * counterpart (`indexed_collection<integer>`) joins the mapped arms. With
 * the same `f` and `c: collection<integer>`, `f(c)` is `[(1, 1), (2, 2)]`
 * for `c := [1, 2]` and `(Set(1, 2), Set(1, 2))` for `c := Set(1, 2)`.
 *
 * The rule applies when `t0`, read through its transparent aliases, has at
 * least one arm that the call maps (`isMappedActual`, or an abstract
 * collection) and at least one arm that it passes whole. It does not apply
 * when another arm that is not a mapped kind may still hold a list (a top
 * type): the call can map a value of such an arm or pass it whole, and its
 * values have no indexed counterpart to type.
 */
function operandArms(t0: Type): ReadonlyArray<OperandArm> | undefined {
  const t = expandAliasesForLift(t0);
  if (t === null) return undefined;
  const arms = typeof t === 'object' && t.kind === 'union' ? t.types : [t];
  const mappedArms: Type[] = [];
  const wholeArms: Type[] = [];
  for (const arm of arms) {
    if (isMappedActual(arm)) {
      mappedArms.push(arm);
      continue;
    }
    wholeArms.push(arm);
    const indexed = indexedReadingOfAbstractCollection(arm);
    if (indexed !== undefined) mappedArms.push(indexed);
    else if (mayBeListElement(arm, undefined)) return undefined;
  }
  if (mappedArms.length === 0 || wholeArms.length === 0) return undefined;
  return [
    {
      type:
        mappedArms.length === 1
          ? mappedArms[0]
          : { kind: 'union', types: mappedArms },
      mapped: true,
    },
    ...wholeArms.map((type) => ({ type, mapped: false })),
  ];
}

/** The indexed counterpart of an abstract collection type: `indexed_collection<E>`
 * for `collection<E>`, and `indexed_collection` for a bare `collection`.
 * `undefined` for another type. A value of the counterpart is a value of
 * `t0` that a broadcast maps (a list, a range). */
function indexedReadingOfAbstractCollection(t0: Type): Type | undefined {
  const t = resolveTypeAlias(t0);
  if (t === 'collection') return 'indexed_collection';
  if (typeof t === 'object' && t.kind === 'collection')
    return { kind: 'indexed_collection', elements: t.elements };
  return undefined;
}

/**
 * The result type of a call of a generic function literal over ONE mapped
 * operand whose type `types[0]` is a union of list types, typed arm by arm:
 * the union of the shape-aware results for each arm
 * (`shapedBroadcastResultType`). `perElementResult` is the instantiated
 * result for one leaf, which the type solver bound from the join of the
 * leaves of every arm. For `(x: T) -> tuple<T, T>` over
 * `v: list<integer> | matrix<integer>`, a value of `v` is a list of
 * integers, whose image is a list of tuples, or a matrix, whose image is a
 * rectangle of tuples: the answer is
 * `list<tuple<integer, integer>> | matrix<tuple<integer, integer>>`. A
 * union is kept rather than a join: the join of the two arms is one list
 * whose rows may differ in length, which loses the matrix shape. The shaped
 * result of the whole union has no rank to spell for a result that is not
 * numeric, and the caller's fallback gives `list<R | list<any>>`.
 *
 * `undefined` when there is not exactly one operand, when it is not a
 * union, or when an arm is not a list whose rank is known: a list whose
 * elements may be lists, or a tensor of unknown rank.
 */
function unionArmsGenericResult(
  types: ReadonlyArray<Type>,
  perElementResult: Type
): Type | undefined {
  if (types.length !== 1) return undefined;
  const t = resolveTypeAlias(types[0]);
  if (typeof t !== 'object' || t.kind !== 'union') return undefined;
  const results: Type[] = [];
  for (const arm of t.types) {
    const r = resolveTypeAlias(arm);
    if (typeof r !== 'object' || r.kind !== 'list') return undefined;
    if (r.dimensions === null) return undefined;
    if (r.dimensions === undefined && staticCollectionDims(r) === null)
      return undefined;
    results.push(shapedBroadcastResultType([arm], perElementResult));
  }
  return reduceType({ kind: 'union', types: results });
}

/** The number of list levels of `t` (a dimensioned list counts one per
 * dimension): 0 for a non-list, 1 for `list<integer>`, 2 for
 * `list<list<integer>>` and for `matrix<integer^(2x2)>`. */
function listRank(t: Type): number {
  if (typeof t !== 'object' || t.kind !== 'list') return 0;
  return (t.dimensions?.length ?? 1) + listRank(t.elements);
}

/** True when `expr` holds no symbol at any depth: it is a string, a number,
 * or an application whose operands are such expressions. Used for the
 * operands of an `Error` node (`BoxedFunction._isLiteralData()`).
 *
 * The walk visits each node once, with an explicit stack. A payload can
 * share a subtree between several operands (`t₀ = 1`, `tₙ₊₁ = F(tₙ, tₙ)`):
 * a walk of every path visits such a payload of depth 60 2⁶⁰ times, and a
 * recursive walk of a deep payload can overflow the stack. */
function holdsOnlyData(expr: Expression): boolean {
  const visited = new Set<Expression>();
  const stack: Expression[] = [expr];
  while (stack.length > 0) {
    const x = stack.pop()!;
    if (isString(x) || isNumber(x)) continue;
    if (!isFunction(x)) return false;
    if (visited.has(x)) continue;
    visited.add(x);
    for (const op of x.ops) stack.push(op);
  }
  return true;
}

/** The definition half (value or operator) of the binding `def`, which a
 * call records to know later whether its callee changed
 * (`BoxedFunction._calleeStamp`). */
function calleeHalf(
  def: BoxedDefinition | undefined | null
): { _writeVersion: number } | undefined {
  if (!def) return undefined;
  if (isOperatorDef(def)) return def.operator;
  if (isValueDef(def)) return def.value;
  return undefined;
}

function type(expr: BoxedFunction): Type | BoxedType {
  // A call that its callee refused when it was boxed has the type of the
  // same call boxed against the function that the name holds now, as its
  // value has, at the top of the expression or in an operand at any depth
  // (`_recheckedTree()`).
  if (!expr.isValid) {
    const rechecked = expr._recheckedTree();
    if (rechecked !== expr) return rechecked.type;
    // A `List` or `Set` literal that holds a failed cell is still a
    // collection: an error in an element is a failure of that cell, not of
    // the container, which keeps its length and its other cells
    // (`docs/ERROR-MODEL.md` §3). So it is not typed `error`: its type is
    // given by the type handler of the literal, which types a failed cell
    // as `unknown` (`literalElementType()`, `library/collections.ts`).
    // Typed `error`, the list was a scalar to the operators that read its
    // type: `ListJoin(fs, [2])` with `fs := [Error(…)]` wrapped the list as
    // one element, and a variable declared `list` refused the value. A
    // literal that is not bound (a raw node) is typed `error` as before.
    // A collection operator whose only errors sit in the cells of such
    // literals (`Map(f, [1, <error>])`, `Reverse([1, <error>])`) is a
    // collection too, typed by its own type handler: it materializes as a
    // list when its source is a list, and not as a set.
    if (isInvalidNonCollection(expr) || expr.operatorDefinition === undefined)
      return 'error';
  }
  // A call that its callee accepted has the type of the same call boxed
  // against the definition that the name holds now, when that definition
  // changed after the call was boxed (`_reboxedForCallee()`).
  const reboxed = expr._reboxedForCallee();
  if (reboxed !== undefined) return reboxed.type;

  // Is this a 'Function' expression?
  // The arrow — parameters, result AND effect specifier — is built by the
  // single Stage 2 construction seam (`effects-inference.ts`). Nothing else in
  // the engine may assemble a `Function` literal's signature: a second builder
  // silently reintroduces the inline-callback gap. Guarded by
  // `test/compute-engine/effects-seam.test.ts`.
  if (expr.operator === 'Function') return functionLiteralSignatureType(expr);

  // A call to a function whose clause body is being canonicalized under the
  // recursion knot of `DefineFunction` (`IComputeEngine._recursionKnots`)
  // types `unknown` while the call still resolves to the knot's placeholder
  // binding: the placeholder's bare `function` type says nothing about the
  // result, and the broadcast lift below would guess one from a collection
  // argument. The binding is compared by identity AND by shape (an
  // INFERRED value binding typed the bare `function`, which is what the
  // knot declares for an undeclared name): the install converts the SAME
  // record into the clause's operator definition in place, so identity
  // alone would still match a caller repaired during the install, whose
  // call must be typed from the installed clause; and a name the author
  // declared with the wildcard `function` type is a declaration, typed as
  // it always was. A call that resolves to another binding of the name (a
  // local of the same name) is typed as usual.
  const knot = expr.engine._recursionKnots.get(expr.operator);
  if (knot !== undefined) {
    const binding = expr.engine.lookupDefinition(expr.operator);
    if (
      binding === knot.binding &&
      isValueDef(binding) &&
      binding.value.inferredType &&
      binding.value.type.type === 'function'
    )
      return 'unknown';
  }

  // Is there a definition associated with the operator of the function?
  const def = expr.operatorDefinition;
  if (def) {
    // Arithmetic over a tuple with a list coordinate (`Tuple(A, B) + (1, 1)`
    // with `A`, `B` lists), or a function applied to each coordinate of such
    // a tuple (`Sin(Tuple(A, B))`), always evaluates to an `incompatible-type`
    // error: the tuple is data, not a point (`listCoordinateTupleOperandError`
    // in `validate.ts`). The static type says so. The numeric-argument check
    // of an enclosing arithmetic expression lets an `error`-typed operand
    // through unchanged (`checkNumericArgs`), so the one real error surfaces
    // at evaluation.
    if (
      appliesToListCoordinateTuple(
        expr.operator,
        broadcastsOverTuples(expr.operator, def),
        expr.ops.map((x) => x.type.type)
      )
    )
      return 'error';
    // A sum of a point (or a list of points) and a collection of numbers
    // (`L + (1, 1)` with `L := [0, 1, 2, 3]`) evaluates to a collection of
    // `incompatible-type` errors, one for each `number + point` element, so
    // the static type is `error` (`addsPointToNumberCollection`). This is
    // the behavior of the library `Add` and `Subtract`: a user definition
    // that replaces the operator gives its own result type, with the same
    // test as the derivation from operand types (`runsLibraryCanonicalForm`).
    if (
      runsLibraryCanonicalForm(expr.engine, expr.operator, def) &&
      addsPointToNumberCollection(
        expr.operator,
        expr.ops.map((x) => x.type.type)
      )
    )
      return 'error';
    const sig =
      def.signature instanceof BoxedType
        ? def.signature.type
        : typeof def.signature === 'string'
          ? parseType(def.signature, expr.engine._typeResolver)
          : def.signature;

    // An overload set resolves to its most-specific viable arm, and the result
    // type is read off THAT arm (`docs/TYPE-SYSTEM.md`). Note the asymmetry
    // with operand inference, which uses the
    // JOIN over every viable arm (§4.3): a result type wants the most precise
    // arm, an operand constraint must be the weakest — conflating them
    // reintroduces the §4.5 unsoundness. The exception is an operand whose
    // type does not decide the arm (`unknown`, `any`, or a type that only
    // overlaps a parameter), which leaves several arms possible at run time:
    // `resolvedArm` then joins their results.
    // Resolved ON FIRST READ: the resolution and the arm solve below walk
    // every operand through overload resolution, and when a `type` handler
    // answers (every collection head, most numeric heads) their result is
    // discarded. A `Join` accumulator with hundreds of operands was paying
    // both for nothing on every turn. The readers are all downstream of the
    // handler call: the declared result (when the handler declines) and the
    // Contract B adjustment.
    let resolvedMemo: Type | undefined;
    let resolvedComputed = false;
    const resolvedOf = (): Type | undefined => {
      if (!resolvedComputed) {
        resolvedComputed = true;
        resolvedMemo = resolvedArm(expr, sig) ?? sig;
      }
      return resolvedMemo;
    };
    let sigResult: Type = 'unknown';

    // The DECLARED `broadcastable<T>` slot plan of this definition (Option A,
    // ratified 2026-08-08 — see `broadcastableParamSlots`). `undefined` for
    // every built-in and every inferred lambda, and for an OVERLOAD set, whose
    // evaluation and typing both stay on the pre-declaration path (a known gap,
    // recorded in the plan doc's open rulings).
    const declaredSlots = broadcastableParamSlots(def);

    // A polytype arm's declared result is OPEN (`functionResult` hands back
    // the pattern), and an open type must never escape as an expression's
    // `.type` (§4.2 ground invariant). Solve the arm at this call site and
    // substitute; an unsolvable residue falls back to `unknown`, never to a
    // variable. The solve mirrors `validateArguments`' — same gates, same
    // bindings — for the same reason `resolvedArm` recomputes its policies.
    // An operand that can be absent as a whole, at an operator that moves
    // cells without computing from them, is typed from its present type,
    // absent cells kept (`absentCellsPresentType`): it binds the
    // type variables and is given to the type handler with that type, and
    // its whole absence goes to the absorption below.
    // Only a position that strips `missing` (`missingStrip`) of an operator
    // that propagates absence is read this way: at another position (the
    // inserted value of `Insert`) the operand goes into the result whole,
    // its `missing` arm included, and the absorption that adds the whole
    // absence back runs for a `propagate` operator only.
    const cellsPresent =
      def.resolvedMissingBehavior === 'propagate' &&
      movesAbsentCells(expr.operator)
        ? expr.ops.map((x, i) =>
            def.stripsMissingAt(i) && x.type.facts.containsMissing
              ? absentCellsPresentType(expr.operator, x.type.type)
              : undefined
          )
        : undefined;
    const hasCellsPresent = cellsPresent?.some((t) => t !== undefined) === true;

    const declaredResultType = (): Type => {
      const resolved = resolvedOf();
      const ctx: ArmInferenceContext = {
        // The SAME gate `box.ts` hands `validateArguments` (§4.5: validation
        // and result typing solve one constraint problem) — per position when
        // the signature declares `broadcastable<T>` slots.
        threadable:
          declaredSlots === undefined || def.broadcastable === true
            ? def.broadcastable
            : (i: number) => declaredSlots.at(i).mappable,
        // An operand absent only in its cells, at an operator that moves
        // cells without computing from them, binds the type variables with
        // its `missing` arm (`passesAbsentCellsThrough`). So does the present
        // type of an operand that can also be absent as a whole
        // (`cellsPresent`).
        stripMissing: (i) =>
          def.stripsMissingAt(i) &&
          cellsPresent?.[i] === undefined &&
          !passesAbsentCellsThrough(expr.operator, expr.ops[i].type.type),
        lazy: def.lazy,
      };
      const instantiated = hasCellsPresent
        ? instantiatedResultTypeOverActuals(
            resolved,
            expr.ops.map((x, i) => {
              const actual = actualOfOperand(x);
              const present = cellsPresent?.[i];
              if (present === undefined) return actual;
              return {
                type: present,
                literal: actual.literal,
                valid: actual.valid,
                inferable: actual.inferable,
                get liftable(): boolean {
                  return actual.liftable;
                },
              };
            }),
            ctx
          )
        : instantiatedResultType(resolved, expr.ops, ctx);
      return instantiated ?? functionResult(resolved) ?? 'unknown';
    };

    // Missing-value absorption (§3.B of the missing-value typing design). When
    // this application resolves to `propagate` and some operand carries a
    // `missing` arm, the base result is absorbed: every `missing` arm is
    // stripped and every numeric result cell widens to `number` (an absent
    // numeric cell contributes `NaN` — Q2/I6). Gated on `typeContainsMissing`,
    // so a Missing-free program's type is byte-identical.
    //
    // An `Undefined` operand is an absence too: the runtime gate reads it as
    // `Missing` (`isAbsentScalarSymbol`, `validate.ts`), so `Undefined + 1`
    // is `NaN` and `Undefined · [1, 2, 3]` is `[NaN, NaN, NaN]`. Its declared
    // type is `unknown`, which a join drops, so without this the result
    // claimed the type of the present operands (`integer`,
    // `vector<integer^3>`). For the absorption it is typed `missing`.
    //
    // An operand absent only in its cells, at an operator that reorders or
    // selects cells without computing from them (`Sort`, `Reverse`), is a
    // present collection whose absent cells stay in the result as they are:
    // it takes no part in the absorption (`passesAbsentCellsThrough`).
    //
    // A negated or scaled absence in a sum (`(1, 2) - Missing`, which is
    // `Add(Negate(Missing), (1, 2))`) is an absent addend too, as the `Add`
    // evaluate handler reads it: the difference beside a point is `Missing`.
    // The term itself is typed `number` (`-Missing` alone is `NaN`), so
    // without this the sum was typed `number | tuple<…>`.
    const absentTerm = (x: Expression): boolean =>
      isAbsentScalarSymbol(x) ||
      (expr.operator === 'Add' && isFunction(x) && isAbsentScalarTerm(x));
    const passedThrough = expr.ops.map((x) =>
      passesAbsentCellsThrough(expr.operator, x.type.type)
    );
    // A position that does not strip `missing` (`missingStrip`) takes no
    // part in the absorption: the handler answers for an absent operand
    // there (the searched value of `Contains` is not found).
    // Computed only when an absence is absorbed (`maybeAbsorb`): for a list
    // literal of thousands of elements, typed at each turn of a loop that
    // grows it, the eager map was a quarter of the typing.
    // An operand typed from its present type (`cellsPresent`) takes part
    // with its whole absence only: its cells move into the result as they
    // are, so they do not make the result cells `NaN`.
    const absenceTypes = (): Type[] =>
      expr.ops.map((x, i) => {
        if (!def.stripsMissingAt(i)) return stripMissingFromType(x.type.type);
        if (absentTerm(x)) return 'missing';
        if (passedThrough[i]) return stripMissingFromType(x.type.type);
        const present = cellsPresent?.[i];
        if (present !== undefined)
          return {
            kind: 'union',
            types: ['missing', stripMissingFromType(present)],
          };
        return x.type.type;
      });
    const absorbMissing =
      def.resolvedMissingBehavior === 'propagate' &&
      expr.ops.some(
        (x, i) =>
          // Only a position that strips `missing` (`missingStrip`) makes the
          // result absent. At another position the handler answers for the
          // absent operand itself, as the runtime absence gate says.
          def.stripsMissingAt(i) &&
          ((x.type.facts.containsMissing && !passedThrough[i]) || absentTerm(x))
      );

    // Conditional-value threading (`threadsConditionals`) for an operator
    // that does not propagate absence: a threaded operand that can be absent
    // as a whole (a restriction, typed `missing | T`) is given to the type
    // handler as its present type `T`. For a `handle` operator the result
    // gains a `missing` arm, because such an operator answers `Missing` for
    // an absent operand (`threadedPresentType`, `broadcast-lift-type.ts`).
    // For a `reject` or `pass-through` operator an absent operand is an
    // error, which the type of the success does not describe.
    const threadedPresent =
      def.threadsConditionals !== false &&
      def.resolvedMissingBehavior !== 'propagate'
        ? expr.ops.map((x, i) =>
            def.threadsConditionalsAt(i) && x.type.facts.containsMissing
              ? threadedPresentType(x.type.type)
              : undefined
          )
        : undefined;
    const threadedAbsence =
      def.resolvedMissingBehavior === 'handle' &&
      threadedPresent?.some((t) => t !== undefined) === true;

    // Contract B derived application type (`docs/ERROR-MODEL.md` §4; Phase
    // C of `docs/plans/2026-08-30-error-model-implementation.md`). Applied
    // only when NO per-operator type handler answered: a handler's claim
    // is already conditioned on the evidence it read (`gammaPoleType`
    // claims a pole-free tier only for an operand proven off the poles),
    // so widening it would degrade the sharper authority. The candidacy test
    // (`typeHasNanFreeNumericCell`) keeps the adjustment byte-invisible
    // everywhere the result type is not yet precise: a result whose
    // numeric cells already admit `nan` (bare `number`) is left alone. A
    // broadcast-lifted collection result is widened PER CELL
    // (`list<real | nan>`) — under a broadcast the propagated `NaN` lands
    // in individual cells. `typeHandlerAnswered` is settled before any
    // adjusted return runs: every def-path return except the
    // lambda-broadcast one funnels through `maybeAbsorb`, all after the
    // handler block below, and the lambda-broadcast return calls
    // `applyContractB` directly (it must not pick up the missing-value
    // absorption, which never applied on that path).
    let typeHandlerAnswered = false;
    let boxedHandlerResult: BoxedType | undefined;
    const applyContractB = (t: Type): Type => {
      if (typeHandlerAnswered) return t;
      if (!(def instanceof _BoxedOperatorDefinition)) return t;
      // Cheap candidacy: with no declared partiality the only possible
      // adjustment is the NaN arm, which needs a nan-free numeric cell. A
      // DECLARED partiality can mark any codomain — rule 4's `Missing`
      // for the settled non-numeric ones — so it always consults the
      // adjustment. Overload sets participate implicitly: the adjustment
      // no longer gates on the raw signature's codomain, and `t` is the
      // resolved arm's instantiated result.
      const declaresPartiality =
        def.definedWhen !== undefined || def.partiality === 'may-marker';
      // A codomain that already admits `nan` as a whole and in every
      // numeric cell (bare `number`) has nothing to gain. A non-numeric
      // codomain (`tuple<real, real>`, `list<number>`) does NOT admit the
      // bare `NaN` the runtime gate answers for a scalar NaN operand, so
      // it consults the adjustment as well.
      if (
        !declaresPartiality &&
        !typeHasNanFreeNumericCell(t) &&
        isSubtype('nan', t)
      )
        return t;
      // `resolved` is the arm this call resolved to (or the plain
      // signature): the NaN-evidence derivation inside must read the SAME
      // carriers the runtime gates read, or an overload's numeric arm
      // propagates NaN at runtime while the derived type stays NaN-free.
      const adjust = def.contractBResultAdjustment(expr.ops, resolvedOf());
      if (adjust === 'none') return t;
      // A scalar NaN operand in a `propagate` slot makes the VALUE of the
      // whole application `NaN`, whatever the codomain's shape: the NaN
      // gate answers the bare marker before the handler runs (`AbsArg(NaN)`
      // is `NaN`, not `(NaN, NaN)`). So the proven case is exactly `nan`,
      // and the may-carry case is a top-level `| nan` arm — never a
      // per-cell widening, which is reserved for a broadcast lift, where
      // the NaN lands in individual cells (`'widen-nan-cells'`).
      if (adjust === 'is-nan') return 'nan';
      if (adjust === 'widen-nan') return widenWithNan(t);
      if (adjust === 'is-marker') {
        // The value IS the codomain marker (`docs/ERROR-MODEL.md` §2 rule
        // 4): `nan` for a numeric codomain, `missing` for a settled
        // non-numeric one, the per-arm markers for a union. A
        // collection-shaped result (a broadcast lift) is not a
        // whole-codomain claim — the failure lands per cell — so it
        // degrades to the cell widening.
        if (
          typeof t !== 'string' &&
          (t.kind === 'list' ||
            t.kind === 'collection' ||
            t.kind === 'indexed_collection' ||
            t.kind === 'broadcastable' ||
            t.kind === 'tuple')
        )
          return widenCellsWithMarker(t);
        return codomainMarkerType(t);
      }
      if (adjust === 'widen-marker') return widenCellsWithMarker(t);
      // `'widen-nan-cells'`: the NaN evidence rides in a broadcast operand's
      // elements, so the lifted result widens per cell (`list<real | nan>`).
      return widenNumericCellsWithNan(t);
    };
    const maybeAbsorb = (t: Type): Type | BoxedType => {
      const absorbed = (): Type => {
        const r = absorbOperandAbsence(
          t,
          absenceTypes(),
          ABSENT_CELLS_STAY_MISSING.has(expr.operator),
          def.broadcastable
        );
        // An absent cell answered as it is keeps its `missing` arm
        // (`withPresentCellAbsence`).
        return hasCellsPresent ? withPresentCellAbsence(t, r) : r;
      };
      const result = applyContractB(
        absorbMissing
          ? absorbed()
          : threadedAbsence
            ? withThreadedAbsence(t)
            : t
      );
      return result === boxedHandlerResult?.type ? boxedHandlerResult : result;
    };

    // The type each operand is described with for a call of the type handler
    // (`undefined`: the operand's own type). Set by the main handler call
    // below, and read again by the per-cell calls of the broadcast lift, so
    // that every call of the handler sees the same operand types.
    let handlerOperandType: (i: number) => Type | undefined = () => undefined;

    // If there is a type handler, call it. Strip-before-validate (§3.B step 3):
    // for a `propagate`/`handle` operator with an absent operand, convey the
    // stripped operand types via the `operandTypes` context override — a
    // handler consults `options.operandTypes[i]` before `ops[i].type` (no proxy
    // expressions, no interaction with the `_type` cache).
    if (typeof def.type === 'function') {
      // An operand that passes its absent cells through
      // (`passesAbsentCellsThrough`) is given to the handler as it is.
      const stripsAny =
        (def.resolvedMissingBehavior === 'propagate' ||
          def.resolvedMissingBehavior === 'handle') &&
        expr.ops.some(
          (x, i) =>
            def.stripsMissingAt(i) &&
            x.type.facts.containsMissing &&
            !passedThrough[i]
        );
      // A `missing` component of a tuple operand is an absent coordinate of
      // a point. An operator that READS coordinates (`PointY`,
      // `ABSENT_CELLS_STAY_MISSING`) answers it as it is, so its handler sees
      // the tuple unchanged: `PointY((1, Missing))` is typed `missing`. Any
      // other operator computes with it, and an absent coordinate contributes
      // `NaN`, so a component that is only absent is typed `nan` rather than
      // the bottom `never`, which would make the whole tuple uninhabited.
      const tupleComponents = ABSENT_CELLS_STAY_MISSING.has(expr.operator)
        ? 'keep'
        : 'nan';
      // An operand typed from its present type (`cellsPresent`) is given to
      // the handler with that type, its absent cells kept.
      const operandTypes = stripsAny
        ? expr.ops.map((x, i) =>
            def.stripsMissingAt(i) &&
            x.type.facts.containsMissing &&
            !passedThrough[i]
              ? (cellsPresent?.[i] ??
                stripMissingFromType(x.type.type, tupleComponents))
              : undefined
          )
        : undefined;
      // A `type` handler receives one descriptor per operand and no
      // expressions, so it cannot touch engine state; the guard turns any
      // state write into an immediate error in tests.
      //
      // The missing-strip override folds into the descriptor's type ONLY
      // for a `propagate` operator, where the handler must not see
      // `missing` arms. A `handle` operator's handler OWNS the absence
      // semantics — `Coalesce` strips every arm but the last itself, and
      // pre-stripping the last operand made its result falsely promise
      // presence (`Coalesce(1, m)` with `m: integer | missing` must type
      // `integer | missing`).
      //
      // Descriptors are built OUTSIDE the guarded window: they are the
      // handler's input, and a child operand's own type derivation during
      // `describe` must not be attributed to this handler.
      let calculatedType: BoxedType | undefined;
      const strippedFor = (i: number) => {
        if (def.resolvedMissingBehavior !== 'propagate')
          return threadedPresent?.[i];
        // An `Undefined` operand is typed as the bare `missing` marker it
        // stands for in a numeric slot, so the handler types it exactly as
        // it types `Missing` (its declared type, `unknown`, made
        // `Negate(Undefined)` an `unknown` result).
        if (absentTerm(expr.ops[i])) return 'missing';
        const stripped = operandTypes?.[i];
        // A BARE `missing` operand strips to `never`, and a `never`-typed
        // descriptor proves numeric claims vacuously (`never` is the
        // bottom type, so it matches `real`): `Sin(Missing)` would claim
        // `real` where the unstripped `missing` claims `number`. There is
        // no present-value component to type for a bare marker, so the
        // descriptor keeps the operand's own type and the absorption
        // machinery downstream owns the absent case; the strip applies
        // only to genuine unions (`integer | missing` → `integer`).
        if (stripped === 'never') return undefined;
        return stripped;
      };
      handlerOperandType = strippedFor;
      // One descriptor memo for the whole application: a node shared
      // between two operands is described once (see `DescriptorMemo`).
      // Allocated only when two operands could share a node.
      const walk: DescriptorMemo | undefined =
        expr.ops.length > 1 ? new Map() : undefined;
      // The callee of `Apply` that reads a `Function` literal from a field
      // of a constant dictionary (`lib.D(…)`) is described as that literal:
      // the call evaluates as the literal applied, which maps over a
      // collection or a tuple argument, and the handler types the call as
      // the same call of the inline literal (`constantFieldLiteral`).
      const descriptors = expr.ops.map((x, i) =>
        describeOperand(
          i === 0 && expr.operator === 'Apply'
            ? (constantFieldLiteral(x) ?? x)
            : x,
          strippedFor(i),
          walk
        )
      );
      calculatedType = guardedTypeHandlerCall(expr.engine, expr.operator, () =>
        def.type!(descriptors, typeHandlerContext(expr.engine))
      );
      // An operand typed `never` (the EMPTY type — a symbol declared with
      // an empty range, `integer<2<..<3>`) has no value, so no application
      // of it has one: the result is `never`. Applied AFTER the handler,
      // on the descriptors it already derived — never by reading operand
      // types ahead of dispatch, which forced derivation in a different
      // order and made the constant folder's memo, hence the COMPILED
      // OUTPUT, run-dependent (measured: 2 distinct outputs of one
      // source). The handler's own answer is wrong for `never`: the
      // bottom type matches every type, `matrix` included, so shape arms
      // fire vacuously.
      // A number literal is never `never`, and reading its descriptor type
      // would build its literal type — which a container handler (`Tuple`,
      // `List`) deliberately never asks for — so literal operands are
      // skipped here.
      // Coalesce derives reachability itself: a failing fallback need not
      // be evaluated, so it cannot erase every earlier successful result.
      if (
        !(expr.operator === 'Coalesce' && def.selectsOperands) &&
        descriptors.some((d, i) => !isNumber(expr.ops[i]) && d.type === 'never')
      )
        calculatedType = BoxedType.forResult(
          'never',
          expr.engine._typeResolver
        );
      if (calculatedType) {
        typeHandlerAnswered = true;
        // An answer that strips to `never` (a handler that read an absent
        // operand) takes the signature's declared result as its codomain
        // (`withCodomainForAbsentAnswer`).
        boxedHandlerResult = BoxedType.forResult(
          withCodomainForAbsentAnswer(
            BoxedType.forResult(calculatedType, expr.engine._typeResolver).type,
            def,
            expr.ops.map((x) => x.type.type)
          ),
          expr.engine._typeResolver
        );
        sigResult = boxedHandlerResult.type;
        // Literal types are handler-visible only (`_literalType`, ruling O9
        // first half): a handler that echoes one into its result must not
        // store an over-specific contract nobody wrote (`tuple<1, 2>`), so
        // every handler result is widened back to ordinary types here — the
        // single place a handler result is stored. Ranges (`real<0..>`)
        // pass through untouched. An INTERNED result (`internType`) holds
        // primitive names only, so it is already widened and the walk is
        // skipped — this is the container handlers' hot path, one result
        // per point of a point list.
        // BoxedType.forResult() owns this normalization and shares it for
        // immutable result types, along with their lazily computed facts.
      }
    } else if (
      !(expr.operator === 'Coalesce' && def.selectsOperands) &&
      expr.ops.some((x) => x.type.type === 'never')
    ) {
      // The same rule both handler shapes apply above, for a head with NO
      // type handler: an operand typed `never` has no value, so the
      // application has none either, whatever the declared result says
      // (`Fract(x)` for an empty-typed `x` is `never`, not `real<0..1>`).
      sigResult = 'never';
    }
    // The handler declined (or there is none): the result is the declared
    // one, solved at this call site.
    if (!typeHandlerAnswered && sigResult !== 'never')
      sigResult = declaredResultType();
    // With no per-operator type handler, the declared result type is taken
    // verbatim. Do not add a generic argument-based narrowing here (e.g.
    // narrowing a handler-less `-> number` result to the join of the operand
    // types): "the operator maps its argument kinds to the same kind" is a
    // per-operator fact, never an engine-wide default — the mean of two
    // integers is not an integer, and `BigO(3)` is never a number at all. An
    // operator for which the premise holds opts in with the shared
    // `kindClosureType` handler (`library/type-handlers.ts`).

    // Honest typing for list broadcast: when this operator will broadcast
    // element-wise over a finite indexed collection operand, its value is a
    // List, so its declared type must be the broadcast list type — not the
    // scalar per-element type the handler computed. The predicate matches the
    // value path so type and value never disagree: a materialized finite
    // collection (`isFiniteIndexedCollection`, step 2 / step 4b), OR an operand
    // whose declared type is an unbounded list / indexed-collection that will
    // materialize into a List at evaluation (`isBroadcastCollectionType` — a
    // symbolic-length `Range`, or an un-evaluated broadcast result like `R^2`).
    // Numeric tuples/points and tensor Add/Multiply (dedicated component-wise
    // typing) stay untouched via `skipBroadcastForVectorOps`.
    // The TYPING twin of the two evaluation guards (steps 2/4): a user function
    // literal has its OWN broadcast arm below, and an annotated literal
    // assigned bare now derives `broadcastable` from `paramsAreScalar`
    // (`engine-declarations.ts`), so it would otherwise be captured HERE. The
    // lambda arm types the result from the body of the literal, and keeps a
    // collection-valued result as the result for one element:
    // `f := (x: number) -> list<number>` applied to `[1,2]` evaluates to
    // `[[1,1],[2,2]]` and must type `list<list<number>>`, not `vector<2>`.
    // This arm keeps such a result only when it is shown to be the result
    // for one element (`perElementCollection` in `broadcastLiftType`).
    // A DECLARED `broadcastable<T>` parameter is an elementwise contract too
    // (Option A, ratified 2026-08-08 — Tycho defect 157(1)), so its application
    // must type exactly like the inferred path: definite collection → `list<R>`
    // (arm 1), possibly-collection → `broadcastable<R>` (arm 2). `broadcastable`
    // is DERIVED from `paramsAreScalar`, which answers false for such a
    // signature, so without this gate the DECLARED spelling typed strictly
    // WEAKER (bare `unknown`) than the `(number)` one it is meant to refine.
    // (`declaredSlots` is computed above, next to the arm resolution.)
    if ((def.broadcastable || declaredSlots) && !isLambdaDef(def)) {
      // The type handler called again with the operands in `cells` typed as
      // one cell of a broadcast (`cells[i]`), for the per-cell results the
      // lift reads. Every other operand is described exactly as for the main
      // handler call above (`handlerOperandType`: the `missing` arm removed
      // for a `propagate` operator), and an answer that strips to `never`
      // takes the declared codomain (`withCodomainForAbsentAnswer`), as the
      // main answer does. `undefined` when no operand has a cell or the
      // handler declines. With `byTypeOnly`, a retyped operand is described
      // by its cell type alone, without the operand's structure: the cell is
      // one ARM of a declared union (`armwiseUnionBroadcastResultType`), so
      // it states what the value is, where the structure (an application
      // of `Negate` over the union-typed symbol) would say the value is
      // unproven and keep a handler from rejecting an arm it rejects at
      // boxing.
      const cellHandlerResult = (
        cells: ReadonlyArray<Type | undefined>,
        byTypeOnly = false
      ): Type | undefined => {
        if (typeof def.type !== 'function') return undefined;
        if (cells.every((c) => c === undefined)) return undefined;
        const descriptors = expr.ops.map((x, i) => {
          const cell = cells[i];
          if (cell === undefined)
            return describeOperand(x, handlerOperandType(i));
          return byTypeOnly ? describeType(cell) : describeOperand(x, cell);
        });
        const t = guardedTypeHandlerCall(expr.engine, expr.operator, () =>
          def.type!(descriptors, typeHandlerContext(expr.engine))
        );
        if (t === undefined) return undefined;
        return withCodomainForAbsentAnswer(
          BoxedType.forResult(t, expr.engine._typeResolver).type,
          def,
          expr.ops.map((x) => x.type.type)
        );
      };
      // The lift itself is shared with the descriptor route
      // (`broadcastLiftType`, `broadcast-lift-type.ts`); the operands are
      // viewed through the value-level predicates this route always read.
      const lifted = broadcastLiftType({
        def,
        views: expr.ops.map(viewOfExpression),
        sigResult,
        sigResultIsPerElement: !typeHandlerAnswered,
        mappable:
          declaredSlots === undefined
            ? undefined
            : (i: number) => declaredSlots.at(i).mappable,
        broadcastsOverTuples: broadcastsOverTuples(expr.operator, def),
        armwiseTupleArms: typesTupleArmsAsCells(expr.operator, def),
        // O(rank) candidate check — see the §D4.2 note at the sibling sites.
        hasTensors: expr.ops.some((x) => candidateShape(x) !== null),
        unionCellResult: () =>
          cellHandlerResult(
            expr.ops.map((x) => scalarOrListUnionCellType(x.type.type))
          ),
        // The handler typed again with each trigger of the abstract
        // collection lift typed as its cell (`abstractCollectionCell`): the
        // per-element result of a broadcast that may or may not happen.
        abstractCellResult: (cells) => cellHandlerResult(cells),
        // The handler typed with each union trigger typed as one of its
        // arms, by type alone (`armwiseUnionBroadcastResultType`).
        armCellResult: (cells) => cellHandlerResult(cells, true),
      });
      if (lifted !== undefined) return maybeAbsorb(lifted);
    }

    // A list of points at a parameter declared as a point: the application
    // maps over the points and answers `list<R>` (`pointListParamSlots`).
    if (def instanceof _BoxedOperatorDefinition && def._isLambda) {
      const pointType = pointListApplicationType(
        pointListParamSlots(def),
        expr.ops,
        sigResult
      );
      if (pointType !== undefined) return applyContractB(pointType);
      // A tuple at a parameter declared as a scalar: the application maps
      // over the components (`declaredScalarTupleCells`) and answers the
      // tuple of the results (`declaredScalarTupleType`).
      const isScalarParam = declaredScalarParams(
        lambdaLiteralOf(def),
        def.inferredSignature ? undefined : def.signature?.type
      );
      const tupleType =
        isScalarParam &&
        declaredScalarTupleType(
          isScalarParam,
          expr.ops.map((x) => x.type.type),
          sigResult,
          paramsAreScalar(def)
        );
      if (tupleType) return applyContractB(tupleType);
    }

    // A PARTIAL application of a function literal held by an operator
    // definition is typed as the function of its remaining parameters
    // (`curriedSignature`), for the reason given on the value-definition
    // route below.
    if (def instanceof _BoxedOperatorDefinition && def._isLambda) {
      const base = resolvedOf() ?? sig;
      const curried =
        base === undefined ? undefined : curriedSignature(base, expr.ops);
      if (curried !== undefined) return curried;
    }

    if (
      def instanceof _BoxedOperatorDefinition &&
      def._isLambda &&
      (paramsAreScalar(def) || declaredSlots)
    ) {
      // The TWIN of the value-definition route below (generic-function-literals
      // design §2.5); the shared broadcast typing lives in
      // `lambdaBroadcastType`. A lambda operator definition can carry a
      // DECLARED POLYTYPE (a generic function literal), so the arm is
      // instantiated at the LAMBDA's own `threadable` reading.
      // `def.broadcastable` is DERIVED from `paramsAreScalar` for a
      // bare-assigned lambda (and stays false on other lambda routes), but
      // this arm is only reached under the `paramsAreScalar(def)` guard above
      // — which is precisely the statement that the runtime broadcasts here —
      // so the D10 lift is admitted unconditionally, exactly as
      // `paramsAreScalar(sig)` does on the value route. A ground signature
      // yields `undefined` and keeps `sigResult` untouched.
      const instantiated = instantiatedResultType(resolvedOf(), expr.ops, {
        threadable: true,
      });
      const lambdaResult = instantiated ?? sigResult;
      // The per-element result is derived from the body when it can be
      // (`derivedBroadcastElementResult`): the signature result types a
      // pass-through parameter `unknown`.
      const lifted = lambdaBroadcastType(
        expr.ops,
        lambdaResult,
        declaredSlots,
        def.inferredSignature,
        instantiated !== undefined,
        (mappedAt, operandTypes) =>
          derivedBroadcastElementResult(
            expr,
            mappedAt,
            lambdaResult,
            declaredSlots !== undefined,
            operandTypes
          ),
        lambdaLiteralOf(def),
        (arms) =>
          instantiatedResultTypeOverActuals(
            resolvedOf(),
            operandActualsWithArms(expr.ops, arms),
            { threadable: true }
          )
      );
      // Through `applyContractB` directly, NOT `maybeAbsorb`: the
      // missing-value absorption never applied on this return, and the
      // Contract B adjustment must still see a future scalar-numeric
      // lift rather than silently skipping the derivation.
      if (lifted !== undefined) return applyContractB(lifted);
    }

    if (!typeHandlerAnswered) {
      const inferred = callResultType(
        expr.engine,
        expr.operator,
        expr.ops.map((x) => describeOperand(x)),
        sigResult,
        (h, a) => deriveApplicationType(expr.engine, h, a),
        { operator: def }
      );
      if (inferred !== undefined) return maybeAbsorb(inferred);
    }
    // An argument that may be absent as a whole and is otherwise a numeric
    // tuple, at a scalar parameter of a function literal: `any`, when the
    // derivation from the body declined (`wholeAbsentTupleArgumentType`).
    if (
      def instanceof _BoxedOperatorDefinition &&
      def._isLambda &&
      (paramsAreScalar(def) || declaredSlots)
    ) {
      const whole = wholeAbsentTupleArgumentType(
        expr.ops,
        sigResult,
        def.inferredSignature,
        lambdaLiteralOf(def)
      );
      if (whole !== undefined) return applyContractB(whole);
    }
    return maybeAbsorb(sigResult);
  }

  // Is this a function literal?
  // e.g. f := (x) -> x + 1
  if (expr.valueDefinition) {
    // A `:=` registration whose declared signature is preserved on the value
    // definition (e.g. `ce.declare('f', '(number) -> number')` then assigning a
    // matching lambda) resolves here rather than through an operator
    // definition. Mirror the same application-site broadcast typing as the
    // operator-def lambda path above, keeping the DECLARED signature
    // authoritative: a collection-typed parameter binds its argument whole, so
    // `paramsAreScalar` is false and the scalar result is preserved.
    // As at the operator-def site above: an overload set resolves to its
    // most-specific viable arm for the RESULT type (§6 of the overload design).
    // A bare `function` WILDCARD declaration carries no signature of its own —
    // the assigned literal's type is the only one there is (the same source
    // the narrowing sink in `box.ts` reads), so read it here; otherwise the
    // wildcard's absent parameter types read as scalar and the application is
    // broadcast-typed (`list<unknown^3>`) while the value is the scalar the
    // literal computes.
    // An operand typed `never` has no value, so the application has none:
    // the same rule the operator-definition route applies (with and without
    // a type handler), so a declare-then-assign function agrees with a
    // library operator on an empty-typed argument.
    if (expr.ops.some((x) => x.type.type === 'never')) return 'never';
    // The assigned literal is read under the name it is held by, as in
    // `applyFunctionLiteral` (`namedLiteralSignatureType`). A signature
    // INFERRED from the literal is read the same way.
    const declaredType = expr.valueDefinition.type.type;
    const heldValue = expr.valueDefinition.value;
    const sigSource =
      heldValue === undefined
        ? declaredType
        : isWildcardFunctionType(declaredType)
          ? namedLiteralSignatureType(expr.operator, heldValue)
          : expr.valueDefinition.inferredType
            ? namedLiteralSignatureType(expr.operator, heldValue, declaredType)
            : declaredType;
    const sig = resolvedArm(expr, sigSource) ?? sigSource;
    // A call with fewer arguments than the literal's fixed parameters is a
    // PARTIAL application, and its value is the function of the remaining
    // parameters (`makeLambda` curries it: `g := (a, b) ↦ a + b` makes
    // `g(f)` the literal `(_) ↦ _ + f`). Its type is that function's, not the
    // literal's result: typed `number`, `g(f)` was read as a shorthand body
    // over `f` by a callback slot that re-reads it once `g` has a value
    // (`canonicalFunctionLiteral`), where `Apply(g(f), x)`, which evaluates
    // its callee first, applied the curried value. The rules under which
    // `makeLambda` does NOT curry are excluded: a rest parameter (the
    // variadic tail collects a short argument list), an optional parameter,
    // and a generic literal (refused with an error).
    const curried = curriedSignature(sig, expr.ops);
    if (curried !== undefined) return curried;
    // As on the operator-def route: a polytype arm is instantiated at the call
    // site so no open type escapes as the expression's `.type` (§4.2). The
    // solve sees the SAME `threadable` gate this route hands
    // `validateArguments` (`box.ts`), so validation and result typing solve one
    // constraint problem (§4.5).
    // A DECLARED `broadcastable<T>` slot is threadable BY DECLARATION (Option
    // A): `paramsAreScalar` answers false for it — that is the inference gate —
    // so without this the declare-then-assign spelling typed strictly weaker
    // than the plain-scalar one it refines, while the value path now maps.
    const valueSlots = broadcastableParamSlots(sig);
    const threadable = paramsAreScalar(sig) || valueSlots !== undefined;
    const sigResult =
      instantiatedResultType(sig, expr.ops, {
        // Per position when the signature declares `broadcastable<T>` slots —
        // the same gate `box.ts` hands `validateArguments` (§4.5).
        threadable:
          valueSlots === undefined || paramsAreScalar(sig)
            ? threadable
            : (i: number) => valueSlots.at(i).mappable,
      }) ??
      functionResult(sig) ??
      'unknown';
    // A list of points at a parameter declared as a point: the application
    // maps over the points and answers `list<R>` (`pointListParamSlots`).
    const pointType = pointListApplicationType(
      pointListParamSlots(sig),
      expr.ops,
      sigResult
    );
    if (pointType !== undefined) return pointType;
    // A tuple at a parameter declared as a scalar, as on the
    // operator-definition route above.
    const isScalarParam = declaredScalarParams(
      expr.valueDefinition.value ?? undefined,
      expr.valueDefinition.inferredType || isWildcardFunctionType(declaredType)
        ? undefined
        : declaredType
    );
    const tupleType =
      isScalarParam &&
      declaredScalarTupleType(
        isScalarParam,
        expr.ops.map((x) => x.type.type),
        sigResult,
        threadable
      );
    if (tupleType) return tupleType;
    if (threadable) {
      // The shared broadcast typing (`lambdaBroadcastType`) is the same one
      // the operator-def lambda route above applies; `sigResult` is already
      // the instantiated per-element result on this route.
      const lifted = lambdaBroadcastType(
        expr.ops,
        sigResult,
        valueSlots,
        // A bare `function` declaration gives no signature, so the signature
        // read above is the one inferred from the assigned literal, and its
        // result is inferred too.
        expr.valueDefinition.inferredType ||
          isWildcardFunctionType(declaredType),
        isPolymorphicType(sig),
        // As on the operator-definition route: the body's per-element
        // result when it can be derived (`derivedBroadcastElementResult`).
        (mappedAt, operandTypes) =>
          derivedBroadcastElementResult(
            expr,
            mappedAt,
            sigResult,
            valueSlots !== undefined,
            operandTypes
          ),
        heldValue,
        // Read only when the signature declares no `broadcastable<T>` slot,
        // where every position is threadable on this branch.
        (arms) =>
          instantiatedResultTypeOverActuals(
            sig,
            operandActualsWithArms(expr.ops, arms),
            { threadable: true }
          )
      );
      if (lifted !== undefined) return lifted;
    }
    return (
      callResultType(
        expr.engine,
        expr.operator,
        expr.ops.map((x) => describeOperand(x)),
        sigResult,
        (h, a) => deriveApplicationType(expr.engine, h, a),
        { value: expr.valueDefinition }
      ) ??
      // As on the operator-definition route: an argument that may be absent
      // as a whole and is otherwise a numeric tuple
      // (`wholeAbsentTupleArgumentType`).
      (threadable
        ? wholeAbsentTupleArgumentType(
            expr.ops,
            sigResult,
            expr.valueDefinition.inferredType ||
              isWildcardFunctionType(declaredType),
            heldValue
          )
        : undefined) ??
      sigResult
    );
  }

  // We want to return the result of evaluating the function, so since
  // we don't know (somehow?) we return 'unknown', not 'function', which
  // is the type of the function itself, not of its result.
  return 'unknown';
}

/** The boxed form of the signature `declaredScalarConformance` checks
 * against, kept per definition so that the conformance plan, which is cached
 * by the identity of the boxed signature, is built once and not at every
 * call. `source` is the type it was boxed from: a definition whose declared
 * signature is replaced gets a new entry. */
const declaredConformanceSignatures = new WeakMap<
  object,
  { source: Type; boxed: BoxedType }
>();

/**
 * Check the EVALUATED arguments `ops` of a user function against the SCALAR
 * parameter types its author DECLARED (`declared`), and return the
 * `incompatible-type` error for the first argument that does not fit, or
 * `undefined` when the call conforms (user decision 2026-09-30).
 *
 * A function declared with `ce.declare('f', { signature })` and then
 * assigned its body is checked at boxing against the STATIC type of each
 * argument. When the static type is not known (an argument typed `unknown`,
 * or a computation whose value only exists at evaluation), nothing checked
 * the VALUE against a scalar parameter: only a non-scalar declared type is
 * written on the stored literal (`ascribeDeclaredParameterTypes`,
 * `engine-declarations.ts`), and the application checks only the parameters
 * the literal annotates. So `f` declared `(integer) -> unknown` answered
 * `2.5` for the value `1.5`, a declared `string` parameter received
 * `Missing`, and a declared `boolean` parameter received `5`, where the same
 * function written as an Epsil `function` with annotations answers an
 * error. This check closes that difference without writing the scalar type
 * on the literal, which would change how the body is canonicalized.
 *
 * What is checked, and what is not:
 *
 * - Only a parameter whose declared type is scalar. A parameter typed as a
 *   collection, a tuple, a function, `any` or `unknown` is exempt
 *   (`runtimeCheckExemptParam`): the first three are checked by the
 *   application, the last two promise nothing. `declared` must therefore
 *   spell a placeholder slot `unknown` or `any`, not the type inferred for
 *   it.
 * - Only a concrete value. A symbolic argument is left alone.
 * - A collection (a list, a tuple) at a scalar parameter of a function that
 *   broadcasts is not an error: the function is applied to its elements.
 * - `NaN` at a numeric parameter is accepted, and an absent value
 *   (`Missing`, `Undefined`) at a numeric parameter is left to the body,
 *   which computes `NaN` with it. An absent value at any other scalar
 *   parameter is refused, unless the declared type has a `missing` member.
 */
function declaredScalarConformance(
  ce: ComputeEngine,
  cacheKey: object,
  declared: Type,
  broadcastable: boolean,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (typeof declared === 'string' || declared.kind !== 'signature')
    return undefined;
  const paramAt = (i: number): Type | undefined => {
    const args = declared.args ?? [];
    if (i < args.length) return args[i].type;
    const opt = declared.optArgs ?? [];
    if (i < args.length + opt.length) return opt[i - args.length].type;
    return declared.variadicArg?.type;
  };
  const isNumericParam = (i: number): boolean => {
    const p = paramAt(i);
    return p !== undefined && isSubtype(p, 'number');
  };
  for (let i = 0; i < ops.length; i++) {
    if (!isAbsentScalarSymbol(ops[i])) continue;
    const p = paramAt(i);
    if (
      p === undefined ||
      runtimeCheckExemptParam(p) ||
      isSubtype(p, 'number') ||
      provablyAdmits('missing', p)
    )
      continue;
    return ce.typeError(p, ops[i].type, ops[i]);
  }
  let entry = declaredConformanceSignatures.get(cacheKey);
  if (entry === undefined || entry.source !== declared) {
    entry = { source: declared, boxed: ce.type(declared) };
    declaredConformanceSignatures.set(cacheKey, entry);
  }
  return runtimeConformanceError(
    ce,
    cacheKey,
    entry.boxed,
    broadcastable,
    ops,
    // `NaN` is accepted at a numeric parameter and checked anywhere else.
    (i) => (isNumericParam(i) ? 'handle' : 'reject')
  );
}

/**
 * The evaluated arguments `ops` of a user function, with an absent value
 * (`Missing`, `Undefined`) at a parameter whose DECLARED type is numeric
 * replaced by `NaN`, or `ops` itself when there is none.
 *
 * A numeric parameter reads an absent argument as `NaN`
 * (`docs/ERROR-MODEL.md`, ruling of 2026-09-30 on an absent argument at an
 * annotated parameter). A function literal reads it so for the parameters
 * it annotates (`makeLambda`, `function-utils.ts`), but the scalar types of
 * a signature declared on the name are not written on the literal (see
 * {@link declaredScalarConformance}), so the body received the absent value:
 * `g(Missing)` answered `Missing` for `g` declared `(number) -> unknown` and
 * assigned `x ↦ x`, where an Epsil `function g(x: number) { x }` answers
 * `NaN`.
 */
function absentAsNaNAtDeclaredNumericParams(
  ce: ComputeEngine,
  declared: Type,
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (typeof declared === 'string' || declared.kind !== 'signature') return ops;
  const args = declared.args ?? [];
  const opt = declared.optArgs ?? [];
  const paramAt = (i: number): Type | undefined =>
    i < args.length
      ? args[i].type
      : i < args.length + opt.length
        ? opt[i - args.length].type
        : declared.variadicArg?.type;
  if (
    !ops.some((x, i) => {
      const p = paramAt(i);
      return (
        isAbsentScalarSymbol(x) && p !== undefined && isSubtype(p, 'number')
      );
    })
  )
    return ops;
  return ops.map((x, i) => {
    const p = paramAt(i);
    return isAbsentScalarSymbol(x) && p !== undefined && isSubtype(p, 'number')
      ? ce.NaN
      : x;
  });
}

/**
 * The asynchronous route of {@link applyFunctionLiteral}: the arguments are
 * awaited with `evaluateAsync`, and the body of the function literal runs
 * its statements with `evaluateStatementsAsync` (`awaitStatements`), so that
 * `f(400000)` with `f(n) = Σ 1/k²` yields and honors the abort signal. Every
 * other step (broadcast, conformance, currying) is the synchronous one.
 */
async function applyFunctionLiteralAsync(
  expr: BoxedFunction,
  def: BoxedValueDefinition,
  options?: Partial<EvaluateOptions>
): Promise<Expression> {
  const engine = expr.engine;
  // This application keeps its frames on its own copy of the context stack,
  // as a scoped operator does (step 4 of `evaluateAsync`).
  const effects =
    options?._effects ?? engine._evaluationEffects ?? engine.effects;
  const contextStack = copyContextStack(
    options?._contextStack ?? engine._evalContextStack
  );
  const carried = {
    ...options,
    _effects: effects,
    _contextStack: contextStack,
    _precisionWindow: options?._precisionWindow,
  };
  // The callee is read once, before the arguments are evaluated, and handed
  // to the application: an argument that reassigns the function (an
  // `Assign` in it) must not change which literal is applied, as it does
  // not on the synchronous route, where the one read precedes the
  // arguments.
  const value = calleeValue(expr, def);
  let ops: Expression[] | undefined;
  // An operator named by the value evaluates its operands itself
  // (`operatorCallee()`), so they are not evaluated here.
  if (
    value &&
    value.type.matches('function') &&
    !value.type.isUnknown &&
    operatorCallee(engine, value) === undefined
  ) {
    ops = [];
    for (const x of expr.ops)
      ops.push(await x.evaluateAsync(operandOptions(carried)));
  }
  return await runWithEvaluationEffects(
    engine,
    effects,
    () => applyFunctionLiteralWith(expr, def, carried, value, ops, true),
    contextStack,
    options?._precisionWindow
  );
}

/** The name of the operator that `value` names, when `value` is the symbol
 * of an operator definition (`g` holds `Floor`; `aliasH` holds `bob_H`,
 * and `bob_H` is lazy). A call through the variable then applies that
 * operator to the operands as written, as the direct call does: with
 * `y := 10`, `aliasH(y·z)` and `bob_H(y·z)` both give `Hold(y·z)`, and not
 * `Hold(10z)`. `undefined` otherwise. */
function operatorCallee(
  ce: ComputeEngine,
  value: Expression
): { name: string; binding: BoxedDefinition } | undefined {
  if (!isSymbol(value)) return undefined;
  const name = value.symbol;
  const own =
    value.valueDefinition !== undefined
      ? { value: value.valueDefinition }
      : value.operatorDefinition !== undefined
        ? { operator: value.operatorDefinition }
        : undefined;
  const binding = callableBindingInContext(ce, name, own);
  return binding !== undefined && isOperatorDef(binding)
    ? { name, binding }
    : undefined;
}

/** The function literal that an application of `expr` applies: the value
 * of its definition, read now. */
function calleeValue(
  expr: BoxedFunction,
  def: BoxedValueDefinition
): Expression | undefined {
  const binding = callableBindingInContext(expr.engine, expr.operator, {
    value: def,
  });
  return binding !== undefined && 'value' in binding
    ? binding.value.value
    : undefined;
}

/**
 * The results of evaluating a call whose head had no value (the call over
 * its evaluated operands, which `applyFunctionLiteralWith` returns
 * unresolved), each with the number of the top-level evaluation that made
 * it (`topLevelEvaluationEpoch`, `evaluation-epoch.ts`).
 *
 * Such a result is sticky for the rest of the top-level evaluation that
 * made it: when it is evaluated again in that evaluation, its operands are
 * evaluated, but its head is not resolved, even when the name was assigned
 * after the result was made. So a `Sum` whose term assigns `h` at `k = 2`
 * keeps the `h(1)` that it computed at `k = 1`, and a later statement of a
 * nested block that reads a stored `g(3)` after `g := k ↦ k²` reads `g(3)`.
 * A later top-level evaluation (the next statement of an Epsil program, the
 * next statement of a `Block` that the host evaluates, a host call of
 * `r.evaluate()`) resolves the head of the result again, as it resolves any
 * other call: with `r = g(3).evaluate()`, then `ce.assign('g', k ↦ k²)`,
 * `r.evaluate()` is `9`.
 *
 * The original, unevaluated call is never marked: it keeps its
 * forward-reference behavior, and evaluating it after the name is defined
 * applies the definition, in the same top-level evaluation too. The `h(k)`
 * in the body of a `Sum` is one node that is evaluated at each value of
 * `k`, so it must resolve at `k = 2`, after the assignment of `h` at
 * `k = 2`. That is why the result of an evaluation of the original is a
 * copy of it (`evaluatedUnresolvedCall`). An expression rebuilt from a
 * marked one (`subs()`, the canonical rebuild of a parent) is a new object,
 * is not marked, and resolves its head as before.
 *
 * Decided in `docs/plans/2026-10-21-function-declaration-hoisting.md`, rule 1
 * ("A sticky unresolved call").
 */
const EVALUATED_UNRESOLVED_CALLS = new WeakMap<Expression, number>();

/**
 * For an original call (a call that is not sticky now), the last result of
 * evaluating it that `evaluatedUnresolvedCall` made: the top-level evaluation
 * of that result, the operands it was made over, and the result. When the
 * original is evaluated again in the same top-level evaluation and its
 * operands evaluate to the same objects, that result is returned again. A
 * parent that compares the identity of its operands then does not rebuild
 * itself at each evaluation. A result of an earlier top-level evaluation is
 * not reused: a stored value can hold it, and it must keep its own number.
 */
const UNRESOLVED_CALL_RESULTS = new WeakMap<
  Expression,
  { epoch: number; ops: ReadonlyArray<Expression>; result: Expression }
>();

/** True when `expr` is a result of evaluating a call whose head had no
 * value, made in the current top-level evaluation of its engine
 * (`EVALUATED_UNRESOLVED_CALLS`). */
function isStickyUnresolvedCall(expr: Expression): boolean {
  const epoch = EVALUATED_UNRESOLVED_CALLS.get(expr);
  return epoch !== undefined && epoch === topLevelEvaluationEpoch(expr.engine);
}

/** Mark `expr` as a result of evaluating a call whose head had no value, in
 * the current top-level evaluation (`EVALUATED_UNRESOLVED_CALLS`). */
function markUnresolvedCall(expr: Expression): void {
  EVALUATED_UNRESOLVED_CALLS.set(expr, topLevelEvaluationEpoch(expr.engine));
}

/**
 * The unresolved call `expr` over `ops`, with the binding of `expr`, marked
 * for the current top-level evaluation (`EVALUATED_UNRESOLVED_CALLS`).
 *
 * When `expr` is sticky now, the result is `expr` itself if `ops` are its
 * operands. Otherwise `expr` is an original call, which is never marked, so
 * the result is a copy of it, even when `ops` are its own operands. The copy
 * made by the last evaluation of `expr` in this top-level evaluation is
 * returned again when `ops` are the same objects
 * (`UNRESOLVED_CALL_RESULTS`).
 */
function evaluatedUnresolvedCall(
  expr: BoxedFunction,
  ops: ReadonlyArray<Expression>
): Expression {
  const epoch = topLevelEvaluationEpoch(expr.engine);
  if (EVALUATED_UNRESOLVED_CALLS.get(expr) === epoch) {
    const result = expr._withSameBinding(ops);
    markUnresolvedCall(result);
    return result;
  }
  const last = UNRESOLVED_CALL_RESULTS.get(expr);
  if (
    last !== undefined &&
    last.epoch === epoch &&
    last.ops.length === ops.length &&
    last.ops.every((x, i) => x === ops[i])
  )
    return last.result;
  const result = expr._withSameBinding(ops, true);
  markUnresolvedCall(result);
  UNRESOLVED_CALL_RESULTS.set(expr, { epoch, ops: [...ops], result });
  return result;
}

/** The asynchronous twin of the evaluation of a sticky call in
 * `BoxedFunction.evaluate()`: the operands are evaluated with
 * `evaluateAsync`, in order. The result is made after an `await`, so the
 * context stack of this evaluation, which carries its number
 * (`topLevelEvaluationEpoch`), is put in place of the engine's stack for
 * that step. Without it, the result was marked with the number of the
 * engine, was not sticky for the rest of this evaluation, and a later read
 * of it after the name of its head was assigned resolved the call. */
async function evaluatedUnresolvedCallAsync(
  expr: BoxedFunction,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression> {
  const ops: Expression[] = [];
  for (const x of expr.ops)
    ops.push(await x.evaluateAsync(operandOptions(options)));
  return expr.engine.withEvaluationContext(options, () =>
    evaluatedUnresolvedCall(expr, ops)
  );
}

/**
 * Run `evaluate`, the evaluation of the canonical form of an expression that
 * is not canonical, in place of the evaluation of that expression, with
 * `_delegatedEvaluations` raised. The evaluation that delegates and the
 * evaluation of the canonical form are one evaluation for the host: a raw
 * or structural `Block` that the host evaluates directly is evaluated by its
 * canonical form one level deeper, and its evaluate handler must still see
 * that it is the outermost evaluation (`runsAsProgram()`,
 * `library/control-structures.ts`).
 */
function delegateEvaluation<T>(ce: ComputeEngine, evaluate: () => T): T {
  ce._delegatedEvaluations += 1;
  try {
    return evaluate();
  } finally {
    ce._delegatedEvaluations -= 1;
  }
}

/**
 * The asynchronous twin of `delegateEvaluation`: `canonical.evaluateAsync()`
 * in place of the evaluation of the expression that is not canonical, with
 * the count of delegations of the asynchronous evaluation that `options`
 * belong to (`AsyncEvaluation.delegated`, `evaluation-epoch.ts`) raised
 * until it settles. The `Block` handler of the canonical form runs after a
 * first suspension, when the synchronous part of this call has returned, so
 * the count is kept for as long as the delegating call is counted in the
 * pending calls of that evaluation.
 */
function delegateEvaluationAsync(
  canonical: Expression,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression> {
  const evaluation = asyncEvaluationOf(options?._contextStack);
  if (evaluation === undefined) return canonical.evaluateAsync(options);
  evaluation.delegated += 1;
  let promise: Promise<Expression>;
  try {
    promise = canonical.evaluateAsync(options);
  } catch (error) {
    evaluation.delegated -= 1;
    throw error;
  }
  return promise.finally(() => {
    evaluation.delegated -= 1;
  });
}

function applyFunctionLiteral(
  expr: BoxedFunction,
  def: BoxedValueDefinition,
  options?: Partial<EvaluateOptions>
): Expression {
  return applyFunctionLiteralWith(
    expr,
    def,
    options,
    calleeValue(expr, def)
  ) as Expression;
}

/**
 * `value` is the literal to apply (`calleeValue`), read by the caller before
 * anything else ran. `evaluatedOps` are the arguments when the caller has
 * evaluated them already. With `awaitBody`, the final application of the
 * literal may answer a `Promise` (`ApplyOptions.awaitStatements`); no other
 * step does.
 */
function applyFunctionLiteralWith(
  expr: BoxedFunction,
  def: BoxedValueDefinition,
  options: Partial<EvaluateOptions> | undefined,
  value: Expression | undefined,
  evaluatedOps?: Expression[],
  awaitBody = false
): Expression | Promise<Expression> {
  if (value && !value.type.matches('function')) {
    if (!value.isValid) return expr;
    return expr.engine.typeError('function', value.type, value.toString());
  }

  // The variable holds the name of an operator (`g := Floor`, or a lazy
  // `aliasH := bob_H`): the operator is applied to the operands as they
  // were written, and evaluates them itself, exactly as the direct call
  // does. A lazy operator must not see them evaluated at all; an operator
  // that uses the exact value of an exact operand under `.N()` (`Floor`,
  // `exactRoundingOperand` in `library/arithmetic.ts`) does so through the
  // variable too, where the approximated operands lost it: `g((25! −
  // 1)/24!).N()` was 25.
  const operatorName =
    value === undefined ? undefined : operatorCallee(expr.engine, value);
  if (operatorName !== undefined) {
    const call = callableApplication(
      expr.engine,
      operatorName.name,
      expr.ops,
      operatorName.binding
    );
    return awaitBody ? call.evaluateAsync(options) : call.evaluate(options);
  }

  if (!value || value.type.isUnknown) {
    // The cached `_def` may be a function-typed *value* placeholder (created
    // by the `Assign`/`Declare` canonical pass, e.g. a block-local one-step
    // definition `f(x) = …` inside a function body) while the runtime
    // `ce.assign` created an *operator* definition, which
    // `_getSymbolValue` cannot read. If the symbol now resolves to an
    // operator definition, dispatch through it, with the operands as they
    // were written: the operator definition evaluates them itself, and
    // under `.N()` it records them behind the activations of its function
    // literal, so that the body reads an exact argument as written. The
    // approximated operands lost it: `Block(h := x ↦ Floor(x), h((25! −
    // 1)/24!)).N()` was 25, where the correct value is 24. Otherwise stay
    // symbolic over the evaluated operands.
    const opDef = callableBindingInContext(expr.engine, expr.operator, {
      value: def,
    });
    if (opDef && isOperatorDef(opDef)) {
      const call = callableApplication(
        expr.engine,
        expr.operator,
        expr.ops,
        opDef
      );
      return awaitBody ? call.evaluateAsync(options) : call.evaluate(options);
    }
    // A call of a local of a block that has no value yet in this run (a
    // `let` local before its `let`, an assignment local of a function body
    // before its first assignment) is the `read-before-declaration` error,
    // as a read of the symbol is. The arguments are not evaluated.
    if (value === undefined) {
      const unset = readBeforeDeclarationError(
        expr.engine,
        expr.operator,
        opDef,
        expr.sourceOffsets
      );
      if (unset !== undefined) return unset;
    }
    const evaluated =
      evaluatedOps ?? expr.ops.map((x) => x.evaluate(operandOptions(options)));
    // A name with no binding in the current scope: the application was
    // bound in a scope that is not on the chain now (the scope of a block
    // whose run ended, read again by an enclosing `Sum`). A rebuild through
    // `ce.function()` would declare the name in the current scope, and a
    // later assignment would write that binding (`_withSameBinding`). The
    // application keeps the binding it has.
    //
    // Evaluating the result again in the same top-level evaluation does not
    // resolve its head (`EVALUATED_UNRESOLVED_CALLS`).
    if (
      isForwardCallReference(def) ||
      (opDef === undefined && expr._parseScope === undefined)
    )
      return evaluatedUnresolvedCall(expr, evaluated);
    const rebuilt = expr._withParseScope(() =>
      expr.engine.function(expr.operator, evaluated)
    );
    if (
      rebuilt !== expr &&
      isFunction(rebuilt) &&
      rebuilt.operator === expr.operator
    )
      markUnresolvedCall(rebuilt);
    return rebuilt;
  }

  // The arguments are operands: evaluated without `materialization`
  // (`operandOptions`), so a body that reads a lazy argument as a collection
  // reads the whole collection, not its display preview. The body itself
  // keeps the caller's options, since it produces the result.
  const ops =
    evaluatedOps ?? expr.ops.map((x) => x.evaluate(operandOptions(options)));
  // The breadcrumb of a surplus argument (`ApplyOptions.arityFrame`): this
  // call's head, whose first argument is its first operand.
  const arityFrame = { operator: expr.operator, firstArgumentIndex: 1 };

  // Broadcast if any operand is a finite indexed collection and the
  // function's parameter types are scalar. Zip operands and apply
  // pointwise, returning a List of results. Tuples are excluded
  // (`!isTuple`): a `Tuple` is an atomic value, bound whole, never mapped.
  // The DECLARED signature is authoritative for the broadcast decision when
  // present (a `:=` registration preserves it on the value definition — see
  // the declared-signature reconciliation): a collection-typed parameter
  // (e.g. `(tuple | list<tuple>) -> any`) binds its argument WHOLE. The
  // literal's own inferred type is only the fallback.
  //
  // The literal's type is read under the name it is held by, so that a
  // collection passed in a self-call types its parameter as on the
  // operator-definition route (`namedLiteralSignatureType`). A signature
  // INFERRED from the literal (`let r = (n, s) => …`) is read the same way.
  const declaredType = def.type?.type;
  const broadcastGateType =
    typeof declaredType === 'object' && declaredType.kind === 'signature'
      ? def.inferredType
        ? namedLiteralSignatureType(expr.operator, value, declaredType)
        : declaredType
      : namedLiteralSignatureType(expr.operator, value);
  // The check of the evaluated arguments against the scalar parameter types
  // the author declared (`declaredScalarConformance`). Only for a DECLARED
  // signature: an inferred one is a reading of the literal, which checks its
  // own annotations when it is applied. A signature declared with
  // placeholder slots is read as it was written (`_signatureSkeleton`), so
  // that a slot the author left `unknown` checks nothing.
  //
  // `mapsCollections` says that a collection argument at a scalar parameter
  // is mapped over, so it is not an error of the argument as a whole (each
  // element is checked where it is applied).
  const scalarConformance = (
    args: ReadonlyArray<Expression>,
    mapsCollections = paramsAreScalar(broadcastGateType)
  ): Expression | undefined =>
    !expr.engine.strict || def.inferredType || declaredType === undefined
      ? undefined
      : declaredScalarConformance(
          expr.engine,
          def,
          def._signatureSkeleton ?? declaredType,
          mapsCollections,
          args
        );
  // The arguments as the literal receives them: an absent value at a
  // numeric parameter of the DECLARED signature is read as `NaN`
  // (`absentAsNaNAtDeclaredNumericParams`), under the same conditions as the
  // conformance check above.
  const declaredArgs = (
    args: ReadonlyArray<Expression>
  ): ReadonlyArray<Expression> =>
    !expr.engine.strict || def.inferredType || declaredType === undefined
      ? args
      : absentAsNaNAtDeclaredNumericParams(
          expr.engine,
          def._signatureSkeleton ?? declaredType,
          args
        );
  // The arguments are evaluated, so an infinite source (`Range(1, +∞)`,
  // `Cycle`) or one of unknown length maps too (`isUnknownLengthBroadcast`),
  // lazily, as at the operator-definition post-evaluation broadcast (step 4b).
  // It used to be bound whole: `H(Range(1, +∞))` with `H := x ↦ (x, x)`
  // declared `function` was the tuple `(Range(1, +∞), Range(1, +∞))`, while
  // the same function assigned undeclared, and the call's type, mapped.
  const broadcastsElementwise =
    ops.some(
      (x) => isFiniteBroadcastParticipant(x) || isUnknownLengthBroadcast(x)
    ) && paramsAreScalar(broadcastGateType);
  // The parameters declared as scalars, by the literal's annotations or by
  // the DECLARED signature (an inferred one does not count): a tuple
  // argument there maps over its components (`declaredScalarParams`).
  const isScalarParam = declaredScalarParams(
    value,
    def.inferredType || declaredType === undefined
      ? undefined
      : (def._signatureSkeleton ?? declaredType)
  );
  // As at the operator-def broadcast steps: a collection-TYPED argument with
  // no collection value yet must not be bound as a per-element scalar
  // (`hasUnresolvedCollectionOperand`). Skipping the broadcast is not enough on
  // its own — execution would continue into the ordinary application at the end
  // of this function and INLINE the literal, which is the same capture one rank
  // up: `g([1, 2], s)` for `g(a, b) = (a, b)` and a valueless `s: list<number>`
  // came back `([1, 2], s)`, which re-evaluates to the tuple of lists
  // `([1,2], [10,20])` once `s := [10, 20]`, where a fresh call zips to the
  // point list `[(1, 10), (2, 20)]`. Hold the named application over the
  // evaluated arguments instead, the way the declined application at the end of
  // this function does, so re-evaluating it once the argument resolves
  // broadcasts.
  // The hold does not need a sibling that already has a collection value. A
  // function with scalar parameters applied to a valueless `w: list<real>`
  // alone is typed as the mapped collection (`list<real>`), so binding `w`
  // whole gives a value of a different shape: `f(w)` for `f := u ↦ 7`
  // declared `(real) -> real` gave `7`. The operator-definition route
  // (step 2b of `_computeValue`) and the function-literal route
  // (`applyLiteralMapped`, `library/core.ts`) hold this application too.
  // An argument whose type cannot hold an indexed collection (a set or a
  // dictionary) is not held, because it is never mapped over
  // (`isUnresolvedMappableOperand`).
  if (
    paramsAreScalar(broadcastGateType) &&
    ops.some(
      (x) => !isBroadcastableCollection(x) && isUnresolvedMappableOperand(x)
    )
  ) {
    // A length disagreement among the arguments that DO have values is
    // DEFINITE — no assignment to the unresolved one can reconcile 2 elements
    // against 3 — so it is reported rather than held.
    const mismatch = broadcastLengthMismatch(expr.engine, ops);
    if (mismatch) return mismatch;
    return expr._withParseScope(() => expr.engine.function(expr.operator, ops));
  }
  if (broadcastsElementwise) {
    // Collections of different lengths are an error, not a truncation (the
    // broadcast rulings of 2026-07-24, as at step 2b): the zip below stops
    // at the shortest source, so `f([1, 2], [1, 2, 3])` gave `[2, 4]`.
    const mismatch = broadcastLengthMismatch(expr.engine, ops);
    if (mismatch) return mismatch;
    // Hybrid laziness, as at the operator-def lambda broadcast (step 2b):
    // past the eager threshold — or for a provably-finite collection of
    // unknown size — return the lazy `Map` form instead of materializing.
    // The `Map` body references the function by NAME (`g(_1)`), so each
    // element re-dispatches through this path on a scalar at drain time.
    const lazy = withCallableBinding(expr, () =>
      lazyBroadcastMapIfNeeded(
        expr.engine,
        expr.operator,
        ops,
        isBroadcastableCollection,
        options?.numericApproximation ?? false
      )
    );
    if (lazy) return lazy;

    // A tuple (a point) is lifted whole into every cell, not zipped.
    const items = zipBroadcast(ops, isBroadcastableCollection);
    if (items) {
      const results: Expression[] = [];
      // Element-wise context, exactly as at the operator-def lambda broadcast
      // (step 2b): this arm applies a user function VALUE (the wildcard
      // `ce.declare('f', 'function')` + assign route lands here rather than on
      // an operator definition), so there is no builtin to shield. The context
      // names the SYMBOL being applied — `applyFunctionLiteral` is only reached
      // through a named value definition, so an anonymous literal never gets
      // here. A THROWN element failure aborts the broadcast and cannot carry a
      // breadcrumb, so its message is enriched instead.
      // A cell whose element the literal refuses is that error, as on the
      // operator-definition route, not the inert `Apply` of the literal
      // (`refusedLiteralArgumentError`).
      const appliedOrRefused = (
        result: Expression,
        cell: ReadonlyArray<Expression>
      ) =>
        refusedLiteralArgumentError(result, cell, expr.operator, 0) ?? result;
      if (awaitBody) {
        return (async () => {
          const inContext = <T>(fn: () => T): T =>
            expr.engine.withEvaluationContext(options, fn);
          try {
            while (true) {
              const { done, value: zipped } = inContext(() => items.next());
              if (done) break;
              const applied = await inContext(() =>
                zipped.some(
                  (x, i) =>
                    isFiniteBroadcastParticipant(x) ||
                    (isScalarParam?.(i) === true &&
                      isTupleBroadcastParticipant(x))
                )
                  ? expr.engine
                      ._fn(expr.operator, zipped)
                      .evaluateAsync(options)
                  : (scalarConformance(zipped) ??
                    apply(value, declaredArgs(zipped), {
                      ...options,
                      awaitStatements: true,
                      arityFrame,
                    }))
              );
              results.push(inContext(() => appliedOrRefused(applied, zipped)));
            }
          } catch (e) {
            throw withBroadcastThrowContext(
              e,
              expr.operator,
              ops,
              results.length + 1
            );
          }
          return inContext(() =>
            expr.engine._fn(
              'List',
              annotateBroadcastErrors(
                expr.operator,
                listedBroadcastCells(
                  expr.engine,
                  results,
                  options?.numericApproximation
                )
              )
            )
          );
        })();
      }
      try {
        while (true) {
          const { done, value: zipped } = items.next();
          if (done) break;
          // A broadcast maps to the scalar LEAVES: when a zipped row is itself
          // a broadcast-admitted collection (a rank≥2 source), re-dispatch
          // through the operator name so this arm applies again, exactly as the
          // operator-def routes do (steps 2/2b/4b re-enter `_computeValue` via
          // `_fn(operator, …).evaluate()`). Applying the literal to the row
          // directly would bind the whole row to a scalar parameter and stop at
          // rank 1, disagreeing with the D10 leaf-rank typing.
          // A row with a tuple at a parameter declared as a scalar is
          // re-dispatched too, so that the tuple maps over its components
          // (`declaredScalarTupleCells`, below).
          results.push(
            zipped.some(
              (x, i) =>
                isFiniteBroadcastParticipant(x) ||
                (isScalarParam?.(i) === true && isTupleBroadcastParticipant(x))
            )
              ? expr.engine._fn(expr.operator, zipped).evaluate(options)
              : (scalarConformance(zipped) ??
                  appliedOrRefused(
                    apply(value, declaredArgs(zipped), {
                      ...options,
                      arityFrame,
                    }),
                    zipped
                  ))
          );
        }
      } catch (e) {
        throw withBroadcastThrowContext(
          e,
          expr.operator,
          ops,
          results.length + 1
        );
      }
      return expr.engine._fn(
        'List',
        annotateBroadcastErrors(
          expr.operator,
          listedBroadcastCells(
            expr.engine,
            results,
            options?.numericApproximation
          )
        )
      );
    }
  }

  // A TUPLE argument at a parameter declared as a scalar maps over its
  // components (`declaredScalarTupleCells`, user decision 2026-10-03): the
  // value-definition twin of `_computeValue`'s step 4t-user. With `f`
  // declared `function` and assigned `(u: real) ↦ 7`, `f((a, b))` is
  // `(7, 7)`. A call with a symbol that has no value and a tuple type is
  // held.
  if (isScalarParam !== undefined) {
    const cells = declaredScalarTupleCells(expr.engine, isScalarParam, ops);
    if (cells === 'hold')
      return expr._withParseScope(() =>
        expr.engine.function(expr.operator, ops)
      );
    if (cells !== undefined) {
      if (!Array.isArray(cells)) return cells;
      if (awaitBody) {
        return (async () => {
          const results: Expression[] = [];
          for (const cell of cells)
            results.push(
              await expr.engine.withEvaluationContext(options, () =>
                expr.engine._fn(expr.operator, cell).evaluateAsync(options)
              )
            );
          return expr.engine.withEvaluationContext(options, () =>
            expr.engine._fn(
              'Tuple',
              annotateBroadcastErrors(
                expr.operator,
                listedBroadcastCells(
                  expr.engine,
                  results,
                  options?.numericApproximation
                )
              )
            )
          );
        })();
      }
      return expr.engine._fn(
        'Tuple',
        annotateBroadcastErrors(
          expr.operator,
          listedBroadcastCells(
            expr.engine,
            cells.map((cell) =>
              expr.engine._fn(expr.operator, cell).evaluate(options)
            ),
            options?.numericApproximation
          )
        )
      );
    }
  }

  // The two maps below (the declared-`broadcastable<T>` map and the map
  // over a list of points) apply the function once per element, and check
  // the elements of each mapped argument, and of the collections beside it,
  // in the cell where they are applied. A SCALAR argument beside them is not
  // checked by the maps, so it is checked here: the verdict for a scalar
  // slot must not depend on the shape of the other arguments. Collection
  // arguments are left to the maps (`mapsCollections`).
  const scalarBesideMap = scalarConformance(ops, true);
  if (scalarBesideMap !== undefined) return scalarBesideMap;

  const applyWhole = (): Expression | Promise<Expression> => {
    // The value is a function literal. Apply the arguments to it, threading
    // the caller's options — `numericApproximation` is honored inside the
    // function's scope frame (see makeLambda), preserving lexical scoping. A
    // declined application (a recursive definition re-entered with a symbolic
    // argument, which is not unrolled) keeps its name over the EVALUATED
    // operands — `R(3, 0, y)` for `R(3, Sin(0), y)`, the same inert form an
    // operator-definition-backed literal leaves — rather than becoming an
    // `Apply` of the literal.
    const nonconforming = scalarConformance(ops);
    if (nonconforming !== undefined) return nonconforming;
    // Under `.N()`, the written operands are recorded behind the
    // activations (`exactArgumentSources`), so that a jump in the body
    // (`Floor(x)`) reads the exact value of `x` where the float is near the
    // jump, as `Floor(y)` does for a global `y`: `f((25! − 1)/24!).N()` for
    // `f := x ↦ Floor(x)` was 25 where `Floor((25! − 1)/24!).N()` is 24.
    // The arguments themselves stay the approximations: nothing is
    // evaluated twice, and the exact evaluation is paid only by a re-read.
    const exactSources =
      options?.numericApproximation === true && ops.length === expr.ops.length
        ? exactArgumentSources(expr.engine, expr.ops)
        : undefined;
    return apply(
      value,
      declaredArgs(ops),
      awaitBody
        ? { ...options, awaitStatements: true, arityFrame, exactSources }
        : { ...options, arityFrame, exactSources },
      'bubble',
      expr._withParseScope(() => expr.engine.function(expr.operator, ops))
    );
  };
  const pointPlan = pointListParamSlots(broadcastGateType);
  const applyPointOrWhole = (): Expression | Promise<Expression> => {
    if (pointPlan) {
      const canonicalOps =
        ops.length === expr.ops.length ? expr.ops : undefined;
      if (awaitBody)
        return pointListBroadcastAsync(
          expr.engine,
          expr.operator,
          value,
          pointPlan,
          ops,
          canonicalOps,
          options
        ).then(
          (mapped) =>
            mapped ?? expr.engine.withEvaluationContext(options, applyWhole)
        );
      const mapped = pointListBroadcast(
        expr.engine,
        expr.operator,
        value,
        pointPlan,
        ops,
        canonicalOps,
        options
      );
      if (mapped) return mapped;
    }
    return applyWhole();
  };
  const declaredPlan = broadcastableParamSlots(broadcastGateType);
  if (declaredPlan) {
    if (awaitBody)
      return declaredBroadcastAsync(
        expr.engine,
        expr.operator,
        value,
        declaredPlan,
        ops,
        (x) => isFiniteBroadcastParticipant(x),
        options
      ).then(
        (mapped) =>
          mapped ??
          expr.engine.withEvaluationContext(options, applyPointOrWhole)
      );
    const mapped = declaredBroadcast(
      expr.engine,
      expr.operator,
      value,
      declaredPlan,
      ops,
      (x) => isFiniteBroadcastParticipant(x),
      options
    );
    if (mapped) return mapped;
  }
  return applyPointOrWhole();
}

/**
 * When `sig` is an overload set (an intersection of signatures), the arm this
 * application resolves to — the most-specific one whose parameters admit
 * `expr.ops`. `undefined` for a plain signature, for a non-overload type, and
 * when no arm fits. In that last case the caller falls back to
 * `functionResult` of the whole intersection, which is the §5.1 join over
 * every arm's result — NOT `unknown`; the operands have usually been marked
 * invalid by `validateArguments`, so the imprecision is not load-bearing.
 * The exception is a valid call with no selected arm: on the route of a
 * function held by a symbol, an operand whose type only overlaps a
 * parameter is kept (`keepProvisionalOperands()` in `box.ts`). Then the arm
 * the resolution records in `unresolved` is returned: with `r: real` and
 * `G: ((T) -> T where T: integer) & ((string) -> string)`, `G(r)` is typed
 * `integer` (the result of the first arm read at its bound), not `string`.
 *
 * Two cases return the selected arm with a JOINED result instead: when the
 * arms dispatch on values and the operands leave the dispatch open (the
 * value-arm join below), and when the operand types leave more than one arm
 * possible at run time and those arms have different results (the
 * undecided-operand join below): an operand typed `unknown` or `any`, or one
 * whose type only overlaps an arm's parameter. In both cases the call can take more than
 * one arm at run time, so its result type is the join of their results.
 *
 * **The resolution computed at validation time wins** (phase 2c): the
 * construction site attached it to the call (`_resolvedOverload`), and it
 * records the arm the operands were actually validated against — under trial
 * admission, which the prefilter-only re-derivation below cannot reproduce.
 * The re-derivation is the COLD path, for expressions that never validated
 * (non-strict mode, non-canonical construction): typing-only resolution
 * needs no writes and tolerates the wider prefilter candidate set.
 *
 * **The cold path's policies must match the ones validation would use.** They
 * are recomputed here because `.type` is a getter reached on paths that never
 * ran validation (a lazy operator is the clearest case — its operands are
 * unbound, so type filtering there is noise).
 *
 * Result typing only — see `overload.ts` for why operand *inference* must use
 * the join over every viable arm instead.
 */
function resolvedArm(
  expr: BoxedFunction,
  sig: Readonly<Type> | undefined
): Type | undefined {
  const arms = overloadArms(sig);
  if (!arms) return undefined;
  const def = expr.operatorDefinition;
  const policies = {
    lazy: def?.lazy,
    threadable: def?.broadcastable,
    couldBeUnkeyedCollection: couldBeUnkeyedCollectionOperand,
  };
  const { selected, selectedInstance, undecidedResults, unresolved } =
    expr._resolvedOverload ??
    resolveOverload(expr.engine, expr.ops, arms, policies);
  if (selected === undefined)
    return expr.ops.every((x) => x.isValid) ? unresolved : undefined;

  // Value-arm JOIN (function-polymorphism design §4.4): when an arm
  // dispatches on VALUES, the boolean filter drops arms a symbolic operand
  // leaves genuinely open (`f(0) -> string` & `f(n: integer) -> integer`
  // called on an operand typed `integer`: runtime may take either arm).
  // `triStateSelect` — the SAME decision procedure the runtime selector
  // runs — says whether dispatch is decided: `selected` keeps that arm's
  // exact result (`f(0)` types `string`); `blocked` joins the results of
  // every non-refuted arm. Gated on value components — declared overload
  // sets without them keep the boolean-selected arm byte-identically.
  // Skipped for lazy operators (operands unbound; their types refute
  // nothing meaningful).
  //
  // The tri-state pass runs on the INSTANTIATED arms (§4.2 ground invariant):
  // `armAdmission`/`isMoreSpecific` compare parameters and the `blocked`
  // branch WIDENS results, none of which may see an open pattern. Index-aligned
  // with `arms`, so `verdict.index`/`nonRefuted` carry over unchanged; the
  // identity on a set with no generic arm.
  if (!def?.lazy && arms.some(armHasValueParam)) {
    const ground = instantiateArms(
      arms,
      expr.ops,
      policies,
      expr.engine._typeResolver
    );
    const verdict = triStateSelect(expr.ops, ground);
    if (verdict.kind === 'selected') return ground[verdict.index];
    if (verdict.kind === 'blocked')
      return {
        ...(selectedInstance ?? selected),
        result: widen(...verdict.nonRefuted.map((i) => ground[i].result)),
      };
  }

  // Undecided-operand JOIN. An operand typed `unknown` or `any` refutes no
  // arm, and an operand whose type only overlaps a parameter (a
  // `collection` at a `string` parameter) may or may not be a value that
  // arm takes. Then `selected` is only one of the arms the call can take at
  // run time: the most specific, or the first one declared when they are
  // incomparable. Its result alone would claim more than is known:
  // `Slice(s, 1, 2)` on an untyped `s` is a string when `s` is a string and
  // a list otherwise, and reading the list arm alone made a string consumer
  // (`Characters`) refuse a correct call. The result is then the join of
  // the results of every arm the call can take (`undecidedResults`, built
  // by `resolveOverload`). It is set only in this case, and holds GROUND
  // types, so no open type reaches `widen`. An arm whose result is `unknown` makes the join `unknown`:
  // `widen` would drop it and claim the other arms' results. When every
  // such arm has the same result, the selected arm is kept unchanged. A
  // lazy operator never joins: its operands are unbound, and
  // `undecidedResults` is never set for it.
  // One arm only: its result can be more precise than the result of its
  // instance. A type variable that the solver absorbed from an operand
  // typed `error` with no error value (a symbol declared `error` with no
  // value) reads `unknown` in the instance, and `undecidedResults` reads it
  // at its declared bound (`undecidedResultOf()` in `overload.ts`): with
  // `Reverse: ((T) -> T where T: string) & …`, `Reverse(e)` is typed
  // `string`, not `unknown`.
  if (
    !def?.lazy &&
    undecidedResults?.length === 1 &&
    selectedInstance !== undefined &&
    selectedInstance.result === 'unknown' &&
    undecidedResults[0] !== 'unknown'
  )
    return { ...selectedInstance, result: undecidedResults[0] };
  if (!def?.lazy && undecidedResults && undecidedResults.length > 1) {
    const first = undecidedResults[0];
    const allSame = undecidedResults.every(
      (r) => r === first || (isSubtype(r, first) && isSubtype(first, r))
    );
    if (!allSame)
      return {
        ...(selectedInstance ?? selected),
        result: undecidedResults.some((r) => r === 'unknown')
          ? 'unknown'
          : widen(...undecidedResults),
      };
  }
  return selected;
}

/** Returns true when every formal parameter of a signature is a scalar
 * type (not a collection/list/tuple/function).
 *
 * Accepts either a `Type` (typically from a function-typed value) or a
 * `BoxedOperatorDefinition` (whose `signature.type` is inspected).
 *
 * Conservative: unknown/any and non-signature types are treated as scalar,
 * which makes this a permissive default for inferred lambda signatures.
 *
 * NOTE: deep-imported by `vscode-epsil/src/debug-worker.ts` — moving or
 * renaming this export must update that import (vscode-epsil has no test
 * harness to catch the break).
 * @internal
 */
/**
 * The value requirement an `inferOperandTypes` handler receives for a result
 * requirement `t`, or `undefined` when `t` says nothing an operand could
 * learn: the loose types (`any`, `unknown`, `value`), the absence types
 * (`nothing`, and a requirement that is only `missing`), and a function type
 * (a result that must be callable says nothing about a collection element).
 * An absence arm is stripped first: a `handle` operator's parameter
 * `number | missing` requires `number` of the present value.
 */
function operandRequirement(t: Type): Type | undefined {
  const r = stripMissingFromType(t);
  if (
    r === 'never' ||
    r === 'any' ||
    r === 'unknown' ||
    r === 'value' ||
    r === 'nothing'
  )
    return undefined;
  if (isSubtype(r, 'function')) return undefined;
  return r;
}

/**
 * A symbol that can hold a collection but has no collection value yet, such
 * as `xs` after `ce.declare('xs', 'list<integer>')`, or `q` after
 * `ce.declare('q', 'real | list<real>')`. A user function with scalar
 * parameters applied to such a symbol is HELD by steps 2b of `_computeValue`
 * and of its asynchronous twin: if the symbol later gets a list value, the
 * argument maps element-wise, so neither an `incompatible-type` refusal nor
 * a value computed from the whole symbol is an honest answer before then.
 * With `h := u ↦ 7` and a valueless `q: real | list<real>`, `h(q)` gave `7`,
 * which is wrong once `q := [1, 2]` (the call then gives `[7, 7]`).
 *
 * The test is the one that the function-literal routes apply
 * (`isUnresolvedMappableOperand`): `Apply(u ↦ 7, q)` in `library/core.ts`
 * and a declared function assigned a literal (`applyFunctionLiteral`), so
 * that these routes hold the same calls. A type that only ADMITS a
 * collection (a union with a list branch, `broadcastable<T>`, `collection`)
 * counts. A tuple and a string do not count, because each is bound whole to
 * the parameter.
 *
 * A type that cannot hold an indexed collection (a set, a dictionary, or a
 * union of a scalar and a set) does not count either: such a value is never
 * mapped over, so the call is applied now, and it gives the same result
 * (an `incompatible-type` error for a `real` parameter, for example) as it
 * gives when the symbol has a value.
 *
 * Only a SYMBOL is tested: an operand that becomes a collection only when
 * it is evaluated (`k(lst(3))`) is left to the post-evaluation broadcast
 * (step 4b).
 *
 * A symbol that holds a value other than a symbol is decided on that value
 * by the other steps, and is not held here. The type of such a symbol is its
 * declared type, so the type test alone would hold `h(q)` when `q` holds `3`
 * under a `real | list<real>` declaration. The function-literal routes do
 * not need this check, because they test the arguments after evaluation.
 */
function isValuelessCollectionSymbol(x: Expression): boolean {
  if (!isSymbol(x)) return false;
  const v = x.value;
  if (v !== undefined && !isSymbol(v)) return false;
  return isUnresolvedMappableOperand(x);
}

/**
 * An operand that has no collection value yet
 * (`isUnresolvedCollectionOperand`) and whose type can hold an indexed
 * collection, so that a later value can make a function with scalar
 * parameters map over it. A call of such a function with this operand is
 * HELD, and evaluating it again after the operand has a value maps it.
 *
 * A set or a dictionary is never mapped over. Thus an operand of such a
 * type (also a union of a scalar and a set) is not held: the call is
 * applied now and gives the result that it gives when the operand has a
 * value, for example an `incompatible-type` error for a `real` parameter.
 *
 * All three routes of a call use this test, so that they hold the same
 * calls: step 2b of `_computeValue` (through `isValuelessCollectionSymbol`),
 * a declared function assigned a literal (`applyFunctionLiteral`), and
 * `Apply` of a function literal (`applyLiteralMaps` and
 * `applyLiteralMapped` in `library/core.ts`).
 */
export function isUnresolvedMappableOperand(x: Expression): boolean {
  return (
    isUnresolvedCollectionOperand(x) &&
    couldMatch(x.type.type, INDEXED_COLLECTION_SHAPE_TYPE)
  );
}

/** Is `t` a declared parameter type that makes a tuple argument map over its
 * components: a number type (`real`, `integer`, `number`, ...) or `boolean`,
 * other than the empty types. A `string` is not one: a string is a
 * collection of characters, not a scalar. */
export function isDeclaredScalarType(t: Type | undefined): boolean {
  if (t === undefined || t === 'never' || t === 'nothing') return false;
  return isSubtype(t, 'number') || isSubtype(t, 'boolean');
}

/**
 * For each parameter position of a user function, whether its author
 * DECLARED the parameter as a scalar, a number or a boolean
 * (`isDeclaredScalarType`): the function literal annotates it (`u: real`,
 * `n: integer`, `p: boolean`), or the signature declared for a named
 * function (`ce.declare('k', '(real) -> real')`) gives such a type at that
 * position. `literal` is the function literal, and `declared` is the
 * declared signature, when there is one. The answer is `undefined` when no
 * parameter is declared as a scalar.
 *
 * A TUPLE argument at such a parameter maps over its components
 * (`declaredScalarTupleCells`), as the library functions do: `Sin((a, b))`
 * gives `(sin(a), sin(b))` and `Not((True, False))` gives `(False, True)`.
 * So `Apply((u: real) ↦ 2u, (a, b))` gives `(2a, 2b)` (user decisions
 * 2026-10-03). A parameter whose type is only inferred from the body (`u ↦
 * 2u` infers `u: number`) is not declared, and it binds a tuple argument
 * whole, as before.
 */
export function declaredScalarParams(
  literal: Expression | undefined,
  declared?: Type
): ((i: number) => boolean) | undefined {
  const slots: boolean[] = [];
  if (typeof declared === 'object' && declared.kind === 'signature') {
    [...(declared.args ?? []), ...(declared.optArgs ?? [])].forEach(
      (arg, i) => {
        if (isDeclaredScalarType(arg.type)) slots[i] = true;
      }
    );
  }
  if (literal !== undefined && isFunction(literal, 'Function')) {
    literal.ops.slice(1).forEach((param, i) => {
      if (isDeclaredScalarType(functionLiteralParameterType(param)))
        slots[i] = true;
    });
  }
  if (!slots.some((x) => x === true)) return undefined;
  return (i) => slots[i] === true;
}

/**
 * Is `x` a symbol with no value whose type is a tuple, or a union with a
 * tuple branch (`p: tuple<real, real>`)? At a parameter declared as a
 * number, a call with such an argument is HELD, as a call with a list symbol
 * that has no value is held (`isUnresolvedMappableOperand`): when the symbol
 * gets a tuple value, the call maps over its components, so a value
 * computed now from the whole symbol would have a different shape (`7`
 * where `(7, 7)` is the answer for `(u: real) ↦ 7`).
 */
function isValuelessTupleSymbol(x: Expression): boolean {
  if (!isSymbol(x) || x.value !== undefined) return false;
  const tupleShaped = (t: Type) =>
    isTupleShapedType(resolveTypeReference(t) ?? t);
  const t = resolveTypeReference(x.type.type) ?? x.type.type;
  if (tupleShaped(t)) return true;
  return (
    typeof t === 'object' && t.kind === 'union' && t.types.some(tupleShaped)
  );
}

/**
 * The component-wise map of a user function over its TUPLE arguments at
 * parameters declared as scalars (`declaredScalarParams`). `ops` are the
 * evaluated arguments. The answer is one of these:
 *
 * - `undefined`: no such argument is a tuple. The arguments are bound as
 *   before.
 * - `'hold'`: such an argument is a symbol with no value whose type is a
 *   tuple (`isValuelessTupleSymbol`). The caller keeps the call
 *   unevaluated.
 * - an error expression: two such tuples have different lengths
 *   (`incompatible-dimensions`, as for two lists), or a tuple has a list
 *   coordinate (`([1, 2], [3, 4])` is data, not a point; the same error
 *   `Sin(([1, 2], [3, 4]))` gives, `listCoordinateTupleOperandError`).
 * - the argument lists of the cells: cell `k` has the component `k` of each
 *   mapped tuple, and every other argument whole. The caller applies the
 *   function to each cell, and the result is the tuple of these values. A
 *   component that is itself a tuple maps again when its cell is applied.
 *
 * A list argument is not mapped here: the list broadcast, which runs first,
 * maps it, and each of its cells can then map over a tuple.
 */
export function declaredScalarTupleCells(
  ce: ComputeEngine,
  isScalarParam: (i: number) => boolean,
  ops: ReadonlyArray<Expression>
): Expression[][] | Expression | 'hold' | undefined {
  if (ops.some((x, i) => isScalarParam(i) && isValuelessTupleSymbol(x)))
    return 'hold';
  const maps = (x: Expression, i: number) =>
    isScalarParam(i) && isTupleBroadcastParticipant(x);
  if (!ops.some(maps)) return undefined;
  const tuples = ops.filter(maps);
  const listTuple = listCoordinateTupleOperandError(ce, tuples);
  if (listTuple !== undefined) return listTuple;
  let length: number | undefined;
  for (const x of tuples) {
    const n = smallCount(x);
    if (n === undefined) return undefined;
    if (length === undefined) length = n;
    else if (n !== length)
      return ce.error('incompatible-dimensions', `${length} vs ${n}`);
  }
  if (length === undefined || length === 0) return undefined;
  const components = ops.map((x, i) =>
    maps(x, i) ? [...(x.each() ?? [])] : undefined
  );
  if (components.some((c) => c !== undefined && c.length !== length))
    return undefined;
  return Array.from({ length }, (_, k) =>
    ops.map((x, i) => components[i]?.[k] ?? x)
  );
}

/**
 * The error of an argument that a function literal refused, when `result`
 * is the inert application that `apply()` (`function-utils.ts`) returns for
 * it: an `Apply` of the literal whose argument `k` is now an `Error`, where
 * the argument `args[k - 1]` given to the literal was valid. The error is
 * the value of the call, with the breadcrumb frame `operator` and the
 * position `k + offset` of the argument in that call, as a call of a named
 * function gives it (`_refusedArgumentError`). `undefined` for any other
 * result.
 *
 * An argument that was already invalid (a list with a failed cell) is not
 * changed: such an application stays as it is written.
 */
export function refusedLiteralArgumentError(
  result: Expression,
  args: ReadonlyArray<Expression>,
  operator: string,
  offset: number
): Expression | undefined {
  if (!isFunction(result, 'Apply') || result.isValid) return undefined;
  if (!isFunction(result.op1, 'Function')) return undefined;
  const ops = result.ops;
  for (let k = 1; k < ops.length; k++) {
    if (!isFunction(ops[k], 'Error')) continue;
    const arg = args[k - 1];
    if (arg === undefined || !arg.isValid) continue;
    return errorValue(ops[k], { operator, index: k + offset });
  }
  return undefined;
}

/**
 * The type of a call of a user function whose arguments map over TUPLES at
 * parameters declared as scalars (`declaredScalarTupleCells`), or
 * `undefined` when no argument type at such a parameter is a tuple or a list
 * of tuples. `cellResult` is the type of the function's value for one
 * component.
 *
 * A tuple type gives a tuple of the same length, with `cellResult` for each
 * number component and the same rule again for a tuple component:
 * `tuple<real, real>` gives `tuple<R, R>`. A list of tuples gives the list
 * of these tuples, because the list broadcast maps each tuple in turn. The
 * answer is `any` when two arguments have different shapes, or when a tuple
 * has a component that is not a number or a tuple (the call is then an
 * error).
 *
 * `listsMap` says whether the function maps over a list argument (its
 * parameters are all scalars). When it does, a list beside the tuple
 * supplies cells of its own, and the answer is `any`. When it does not, the
 * list is bound whole in each cell, and the call is the tuple of the cells:
 * `(u: real, w: list<real>) ↦ u + Length(w)` applied to `(1, 2)` and a list
 * is `tuple<real, real>`.
 */
export function declaredScalarTupleType(
  isScalarParam: (i: number) => boolean,
  argTypes: ReadonlyArray<Type>,
  cellResult: Type,
  listsMap = true
): Type | undefined {
  const resolve = (t: Type) => resolveTypeReference(t) ?? t;
  const hasTuple = (t: Type, depth = 0): boolean => {
    const r = resolve(t);
    if (typeof r !== 'object' || depth > 8) return false;
    if (r.kind === 'tuple') return true;
    if (r.kind !== 'list') return false;
    return hasTuple(r.elements, depth + 1);
  };
  // `inTuple`: a list inside a tuple is a list coordinate, and the call is
  // then an error, not a map.
  const mapped = (t: Type, depth = 0, inTuple = false): Type | undefined => {
    const r = resolve(t);
    if (depth > 8) return undefined;
    if (typeof r === 'object' && r.kind === 'tuple') {
      const elements: { type: Type }[] = [];
      for (const e of r.elements) {
        const m = mapped(e.type, depth + 1, true);
        if (m === undefined) return undefined;
        elements.push({ type: m });
      }
      return { kind: 'tuple', elements };
    }
    if (typeof r === 'object' && r.kind === 'list') {
      if (inTuple) return undefined;
      const m = mapped(r.elements, depth + 1);
      return m === undefined ? undefined : { ...r, elements: m };
    }
    // A component of unknown type (`(a, b)` for undeclared `a`, `b`) is
    // applied as a scalar, and typed as such a call is typed.
    return isSubtype(r, 'number') ||
      isSubtype(r, 'boolean') ||
      r === 'unknown' ||
      r === 'any'
      ? cellResult
      : undefined;
  };
  const shapes = argTypes.filter((t, i) => isScalarParam(i) && hasTuple(t));
  if (shapes.length === 0) return undefined;
  // Another argument that is a collection supplies cells of its own, when
  // the function maps over a list, and the shape of the result then depends
  // on both.
  if (
    listsMap &&
    argTypes.some(
      (t, i) =>
        !(isScalarParam(i) && hasTuple(t)) &&
        isSubtype(resolve(t), INDEXED_COLLECTION_SHAPE_TYPE) &&
        !isTupleShapedType(resolve(t))
    )
  )
    return 'any';
  const result = mapped(shapes[0]);
  if (result === undefined) return 'any';
  if (shapes.slice(1).some((t) => !isSubtype(mapped(t) ?? 'any', result)))
    return 'any';
  return result;
}

export function paramsAreScalar(
  source: BoxedOperatorDefinition | Type
): boolean {
  const sigType = isOperatorDefinition(source)
    ? source.signature?.type
    : source;
  if (!sigType) return true;
  // The type-only reading lives in a leaf module because the callback
  // admission in `boxed-expression/validate.ts` needs it too, and that module
  // cannot import this one (this one imports it).
  return signatureParamsAreScalar(sigType);
}

/**
 * One parameter slot's role in a DECLARED-`broadcastable<T>` application
 * (`docs/plans/2026-08-08-broadcastable-param-semantics.md`).
 *
 * - `mappable`: a collection argument at this slot is MAPPED element-wise.
 *   True for a declared `broadcastable<T>` slot (rule 1, broadcast-wins) and
 *   for a plain SCALAR slot (which is what the inferred all-scalar route
 *   already does). False for a collection-, tuple- or function-typed slot:
 *   those consume their argument WHOLE.
 * - `elements`: the type an ELEMENT mapped through this slot must satisfy —
 *   the declared `T` for a `broadcastable<T>` slot, and the slot's own
 *   declared type for a plain scalar sibling (an element mapped through it
 *   binds to that parameter, so it must satisfy exactly what a whole argument
 *   would have had to). This is the per-element contract rule 3 checks after
 *   the one rank of descent. `undefined` only for a whole-bound slot, whose
 *   argument `validateArguments` checks as usual.
 * - `declared`: this slot was written `broadcastable<T>`. It is what puts the
 *   whole signature on the declared-broadcast route; a scalar slot alone
 *   never does (that is the INFERRED route's business, gated by
 *   `paramsAreScalar`).
 */
type BroadcastSlot = {
  mappable: boolean;
  elements?: Type;
  declared?: boolean;
};

/** The per-slot broadcast plan of a signature: `at(i)` describes argument
 * position `i` (optional and variadic positions included). */
export type BroadcastSlotPlan = { at: (i: number) => BroadcastSlot };

const WHOLE_SLOT: BroadcastSlot = { mappable: false };

/** Memoized per SIGNATURE TYPE object — the plan is a pure function of the
 * declared signature, and definitions hold theirs for their lifetime, so the
 * O(#params) walk runs once per declaration rather than once per application
 * (§D4.2 hot-path contract). `null` records "no broadcastable slot", the
 * overwhelmingly common answer. */
const BROADCAST_SLOT_PLANS = new WeakMap<object, BroadcastSlotPlan | null>();

/**
 * The per-slot broadcast plan of `source`, or `undefined` when its signature
 * declares NO `broadcastable<T>` parameter — which is every built-in and every
 * inferred lambda signature, so every existing caller keeps its
 * `paramsAreScalar` gate untouched and pays only this lookup.
 *
 * A DECLARED `broadcastable<T>` parameter is an elementwise contract (Option A,
 * ratified 2026-08-08): the slot maps an indexed-collection argument even when
 * `T` would admit the collection whole. `paramsAreScalar` answers `false` for
 * such a signature (a `broadcastable<T>` is not a scalar type) and MUST keep
 * doing so — that is the inference-driven gate, and the declaration-driven one
 * is this plan.
 * @internal
 */
export function broadcastableParamSlots(
  source: BoxedOperatorDefinition | Type | undefined
): BroadcastSlotPlan | undefined {
  if (source === undefined) return undefined;
  const sigType = isOperatorDefinition(source)
    ? source.signature?.type
    : source;
  if (!sigType || typeof sigType === 'string') return undefined;
  if (sigType.kind !== 'signature') return undefined;

  const cached = BROADCAST_SLOT_PLANS.get(sigType);
  if (cached !== undefined) return cached ?? undefined;

  const slotOf = (t: Type): BroadcastSlot => {
    const s = substituteDeclaredBounds(sigType.typeParams, t);
    if (typeof s !== 'string' && s.kind === 'broadcastable')
      return { mappable: true, elements: s.elements, declared: true };
    // A function-typed slot is a higher-order callback: bind whole. Same
    // reading as `paramsAreScalar`'s exemption — it never vetoes the OTHER
    // slots, which per-slot gating gives for free.
    if (isSubtype(s, 'function')) return WHOLE_SLOT;
    // A plain SCALAR sibling is mapped too (that is what the inferred
    // all-scalar route does), so it needs an element contract of its own: the
    // element binds to THIS parameter, so it must satisfy the parameter's own
    // declared type. Without it `(broadcastable<number>, number)` mapped a
    // `list<string>` through the second slot unchecked into an untyped body.
    return isScalarType(s) ? { mappable: true, elements: s } : WHOLE_SLOT;
  };

  const slots = [...(sigType.args ?? []), ...(sigType.optArgs ?? [])].map(
    (arg) => slotOf(arg.type)
  );
  const rest = sigType.variadicArg
    ? slotOf(sigType.variadicArg.type)
    : WHOLE_SLOT;

  // Only a DECLARED `broadcastable<T>` slot puts a signature on this route —
  // an all-scalar signature keeps its `paramsAreScalar` gate untouched.
  const plan =
    slots.some((s) => s.declared) || rest.declared
      ? { at: (i: number) => slots[i] ?? rest }
      : null;
  BROADCAST_SLOT_PLANS.set(sigType, plan);
  return plan ?? undefined;
}

/** Memoized per SIGNATURE TYPE object, as `BROADCAST_SLOT_PLANS`. `null`
 * records "no parameter is declared as a point". */
const POINT_SLOT_PLANS = new WeakMap<object, BroadcastSlotPlan | null>();

/**
 * The per-slot plan of the POINT-LIST map of `source`, or `undefined` when no
 * required or optional parameter of its signature is declared as a point (a
 * plain tuple type, see `isPointParameterType`). An overload set declines, as
 * in `broadcastableParamSlots`.
 *
 * A user function whose parameter is declared as a point, called with a list
 * of points at that parameter, answers the list of its values at each point
 * (user decision 2026-09-25): `k := P ↦ |P − (4, 0)|` declared
 * `(tuple<real, real>) -> real` and applied to `PointList([1, 2], 3)` is
 * `[k((1, 3)), k((2, 3))]`. A point slot of the plan is `mappable` with the
 * point type as its `elements` contract, so the declared-broadcast machinery
 * (`declaredBroadcast`) binds each point whole and checks it against the
 * parameter. Every other slot binds its argument whole. The operands the map
 * applies to are the ones {@link mapsAsPointList} accepts, never a single
 * point and never a list whose elements are not known to be points.
 *
 * This plan is separate from the `broadcastable<T>` plan on purpose: a
 * signature with a point parameter is not a broadcastable signature, and the
 * consumers of that plan (the threadable validation gate, the compile gate
 * for broadcastable parameters) must not see it.
 * @internal
 */
export function pointListParamSlots(
  source: BoxedOperatorDefinition | Type | undefined
): BroadcastSlotPlan | undefined {
  if (source === undefined) return undefined;
  const sigType = isOperatorDefinition(source)
    ? source.signature?.type
    : source;
  if (!sigType || typeof sigType === 'string') return undefined;
  if (sigType.kind !== 'signature') return undefined;

  const cached = POINT_SLOT_PLANS.get(sigType);
  if (cached !== undefined) return cached ?? undefined;

  const slots = [...(sigType.args ?? []), ...(sigType.optArgs ?? [])].map(
    (arg): BroadcastSlot => {
      const t = substituteDeclaredBounds(sigType.typeParams, arg.type);
      return isPointParameterType(t)
        ? { mappable: true, elements: t }
        : WHOLE_SLOT;
    }
  );
  const plan = slots.some((s) => s.mappable)
    ? { at: (i: number) => slots[i] ?? WHOLE_SLOT }
    : null;
  POINT_SLOT_PLANS.set(sigType, plan);
  return plan ?? undefined;
}

/**
 * Whether operand `x`, at a slot of the point-list plan `plan`
 * (`pointListParamSlots`), is a list of points the application maps over:
 * the slot is a point slot, and `x` is a list (not a tuple) whose type says
 * its elements are points of the parameter's type
 * (`isPointListArgumentType`). `finite` additionally requires a value the
 * map can enumerate now (`isFiniteBroadcastParticipant`); the typing reads
 * the type alone.
 *
 * With `finite`, an EMPTY list is mapped too, and answers the empty list.
 * `PointList(x, y)` with `x = []` is typed `list<tuple<real, real>>` when the
 * call is canonicalized, so the call is typed as a map (`list<R>`), but its
 * value `[]` is typed `list<never>`, which does not say its elements are
 * points. The compiled map answers `[]` for it, and the interpreter agrees.
 */
function mapsAsPointList(
  plan: BroadcastSlotPlan,
  i: number,
  x: Expression,
  finite: boolean
): boolean {
  const slot = plan.at(i);
  if (!slot.mappable || slot.elements === undefined) return false;
  if (isTuple(x)) return false;
  if (finite && isFunction(x, 'List') && x.nops === 0) return true;
  if (finite && !isFiniteBroadcastParticipant(x)) return false;
  return isPointListArgumentType(x.type.type, slot.elements);
}

/**
 * The type of an application whose point-list map applies
 * (`pointListParamSlots`): `list<R>` for the declared result `R`, when an
 * operand at a point slot is typed as a list of points. `undefined` when no
 * operand is.
 *
 * The absences the map absorbs (`pointListAbsence`) are in the type: an
 * operand that may be absent as a whole (`list<tuple<…>> | missing`) adds
 * `missing` to the result, and one whose points may be absent
 * (`list<missing | tuple<…>>`) adds `missing` to the result's element type.
 */
function pointListApplicationType(
  plan: BroadcastSlotPlan | undefined,
  ops: ReadonlyArray<Expression>,
  result: Type
): Type | undefined {
  if (plan === undefined) return undefined;
  const mapped = ops.filter((x, i) => mapsAsPointList(plan, i, x, false));
  if (mapped.length === 0) return undefined;
  let wholeAbsent = false;
  let cellAbsent = false;
  for (const x of mapped) {
    const present = withoutTopLevelMissing(x.type.type);
    if (present !== x.type.type) wholeAbsent = true;
    const element = collectionElementType(
      resolveTypeReference(present) ?? present
    );
    if (element !== undefined && typeContainsMissing(element))
      cellAbsent = true;
  }
  const list: Type = {
    kind: 'list',
    elements: cellAbsent
      ? { kind: 'union', types: [result, 'missing'] }
      : result,
  };
  return wholeAbsent ? { kind: 'union', types: [list, 'missing'] } : list;
}

/** `t` without its top-level `missing` arm (`list<X> | missing` → `list<X>`),
 * or `t` itself when it has none. The element type is not changed. */
function withoutTopLevelMissing(t: Type): Type {
  if (typeof t === 'string' || t.kind !== 'union') return t;
  if (!t.types.includes('missing')) return t;
  const arms = t.types.filter((x) => x !== 'missing');
  if (arms.length === 0) return 'never';
  return arms.length === 1 ? arms[0] : { kind: 'union', types: arms };
}

/**
 * The absences the point-list map absorbs (see `pointListParamSlots`), for
 * one application with the EVALUATED operands `ops` and the canonical
 * operands `canonicalOps`:
 *
 * - `whole`: an operand at a point slot is absent (`Missing`) and its
 *   canonical type, without its `missing` arm, is a list of points
 *   (`(A, B)\{0 < t\}` with `t < 0`). There is no list to map over, so the
 *   call answers `Missing`, the absence of the whole argument.
 * - `cells`: the positions of the absent points of a mapped list
 *   (`[(3, 4)\{0 < t\}, (6, 8)]` with `t < 0` has an absent point at 0).
 *   The function applied to `Missing` there is an `incompatible-type` error
 *   (a point parameter does not admit `Missing`), so that cell of the result
 *   is replaced by `Missing` (`markAbsentPointListCells`).
 */
function pointListAbsence(
  plan: BroadcastSlotPlan,
  ops: ReadonlyArray<Expression>,
  canonicalOps: ReadonlyArray<Expression> | undefined
): { whole: boolean; cells: Set<number> } {
  const cells = new Set<number>();
  let whole = false;
  ops.forEach((x, i) => {
    const slot = plan.at(i);
    if (!slot.mappable || slot.elements === undefined) return;
    if (isAbsentScalarSymbol(x)) {
      const c = canonicalOps?.[i];
      if (
        c !== undefined &&
        !isTuple(c) &&
        isPointListArgumentType(c.type.type, slot.elements)
      )
        whole = true;
      return;
    }
    if (
      !isFunction(x, 'List') ||
      !mapsAsEvaluatedPointList(plan, i, x, canonicalOps)
    )
      return;
    x.ops.forEach((cell, j) => {
      if (isAbsentScalarSymbol(cell)) cells.add(j);
    });
  });
  return { whole, cells };
}

/** `result` with the cells at `cells` replaced by `Missing`, when `result`
 * is a `List` (see `pointListAbsence`). */
function markAbsentPointListCells(
  ce: Expression['engine'],
  result: Expression | undefined,
  cells: Set<number>
): Expression | undefined {
  if (result === undefined || cells.size === 0) return result;
  if (!isFunction(result, 'List')) return result;
  return ce._fn(
    'List',
    result.ops.map((x, j) => (cells.has(j) ? ce.Missing : x))
  );
}

/**
 * Whether the EVALUATED operand `x` at slot `i` is a list of points the map
 * applies to. This is `mapsAsPointList`, with one more case: a non-empty
 * `List` whose cells are ALL absent (`Missing` or `Undefined`), when the
 * canonical operand `canonicalOps[i]` is typed as a list of points. The
 * evaluated type of such a list (`list<missing>`) does not say that its
 * elements are points, but the canonical operand does:
 * `k([(3, 4)\{0 < t\}])` with `t < 0` evaluates its argument to
 * `[Missing]`, and the call answers `[Missing]`, as it does when only some
 * of the points are absent.
 */
function mapsAsEvaluatedPointList(
  plan: BroadcastSlotPlan,
  i: number,
  x: Expression,
  canonicalOps: ReadonlyArray<Expression> | undefined
): boolean {
  if (mapsAsPointList(plan, i, x, true)) return true;
  const slot = plan.at(i);
  if (!slot.mappable || slot.elements === undefined) return false;
  if (!isFunction(x, 'List') || x.nops === 0) return false;
  if (!x.ops.every((cell) => isAbsentScalarSymbol(cell))) return false;
  const c = canonicalOps?.[i];
  return (
    c !== undefined &&
    !isTuple(c) &&
    isPointListArgumentType(c.type.type, slot.elements)
  );
}

/**
 * Run the point-list map for one application (see `pointListParamSlots`), or
 * return `undefined` when no operand at a point slot is a list of points. The
 * operands `ops` must already be evaluated; `canonicalOps` are the operands
 * of the canonical application, whose types decide whether an absent operand
 * stood for a list of points (`pointListAbsence`).
 */
function pointListBroadcast(
  ce: Expression['engine'],
  operator: string,
  literal: Expression,
  plan: BroadcastSlotPlan,
  ops: ReadonlyArray<Expression>,
  canonicalOps: ReadonlyArray<Expression> | undefined,
  options: Partial<EvaluateOptions> | undefined
): Expression | undefined {
  const absence = pointListAbsence(plan, ops, canonicalOps);
  if (absence.whole) return ce.Missing;
  if (!ops.some((x, i) => mapsAsEvaluatedPointList(plan, i, x, canonicalOps)))
    return undefined;
  return markAbsentPointListCells(
    ce,
    declaredBroadcast(
      ce,
      operator,
      literal,
      plan,
      ops,
      (x, i) => mapsAsEvaluatedPointList(plan, i, x, canonicalOps),
      options
    ),
    absence.cells
  );
}

/** The asynchronous twin of {@link pointListBroadcast}. */
async function pointListBroadcastAsync(
  ce: Expression['engine'],
  operator: string,
  literal: Expression,
  plan: BroadcastSlotPlan,
  ops: ReadonlyArray<Expression>,
  canonicalOps: ReadonlyArray<Expression> | undefined,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression | undefined> {
  const absence = pointListAbsence(plan, ops, canonicalOps);
  if (absence.whole) return ce.Missing;
  if (!ops.some((x, i) => mapsAsEvaluatedPointList(plan, i, x, canonicalOps)))
    return undefined;
  return markAbsentPointListCells(
    ce,
    await declaredBroadcastAsync(
      ce,
      operator,
      literal,
      plan,
      ops,
      (x, i) => mapsAsEvaluatedPointList(plan, i, x, canonicalOps),
      options
    ),
    absence.cells
  );
}

/**
 * Does ANY arm of `source` DECLARE a `broadcastable<T>` parameter?
 *
 * An overload set (an intersection of signatures) has no single slot plan —
 * `broadcastableParamSlots` declines it, because which arm a call binds is a
 * per-call question this function does not answer — but a gate that must FAIL
 * CLOSED still needs to know. That is the compile gate: whichever arm wins at
 * run time, emitted scalar (or leaf-descending) code for a broadcastable arm
 * is silently wrong, and silently wrong is forbidden (D6). Conservative by
 * construction: one broadcastable arm speaks for the set.
 * @internal
 */
export function declaresBroadcastableParam(
  source: BoxedOperatorDefinition | Type | undefined
): boolean {
  if (source === undefined) return false;
  if (broadcastableParamSlots(source) !== undefined) return true;
  const sigType = isOperatorDefinition(source)
    ? source.signature?.type
    : source;
  const arms = overloadArms(sigType);
  return (
    arms !== undefined &&
    arms.some((arm) => broadcastableParamSlots(arm) !== undefined)
  );
}

/**
 * Does a MAPPABLE slot of `plan` hold a collection operand? The entry gate of
 * the declared-broadcast arms: entering when only a WHOLE-bound slot holds one
 * would evaluate the arms' scalar lifts for a map that then declines, and the
 * ordinary application in the tail would evaluate them again (the evaluate-once
 * ruling, `docs/BROADCAST-MODEL.md`).
 */
function someMappableCollection(
  ops: ReadonlyArray<Expression>,
  plan: BroadcastSlotPlan,
  isCollection: (x: Expression) => boolean
): boolean {
  return ops.some(
    (x, i) => plan.at(i).mappable && isCollection(x) && !isTuple(x)
  );
}

/**
 * Set up the DECLARED-`broadcastable<T>` element-wise map for one application
 * (Option A). Returns:
 * - `undefined` when NO slot maps — a scalar argument binds directly (rule 4)
 *   and the caller falls through to ordinary application;
 * - `{ value }` for a terminal result: the strict length-mismatch error
 *   (`docs/BROADCAST-MODEL.md`), the lazy `Map` form, or the held application
 *   for a mappable slot whose operand is collection-typed but valueless;
 * - `{ rows, mapped, mask }` for the eager loop — `rows` yields full argument
 *   rows (mapped slots take the element, every other slot is spliced whole,
 *   i.e. lifted), `mapped` is the participating operands, for error context.
 */
function setupDeclaredBroadcast(
  ce: Expression['engine'],
  operator: string,
  literal: Expression,
  plan: BroadcastSlotPlan,
  ops: ReadonlyArray<Expression>,
  isBroadcastOperand: (x: Expression, i: number) => boolean,
  numericApproximation: boolean
):
  | { value: Expression; rows?: undefined }
  | {
      value?: undefined;
      rows: Iterator<Expression[]>;
      mapped: Expression[];
      mask: boolean[];
    }
  | undefined {
  const mask = ops.map(
    (x, i) => plan.at(i).mappable && isBroadcastOperand(x, i)
  );
  if (!mask.some((m) => m)) return undefined;

  const mapped = ops.filter((_, i) => mask[i]);
  // Strict length policy, over the MAPPED slots only: a collection bound whole
  // at a non-mapped slot is not a broadcast participant and must not mismatch.
  // Checked BEFORE the veto below: a disagreement among the mapped slots that
  // DO have values is definite — no assignment to an unresolved slot can
  // reconcile 2 elements against 3 — so it is reported rather than held.
  const mismatch = broadcastLengthMismatch(ce, mapped);
  if (mismatch) return { value: mismatch };

  // A MAPPABLE slot holding an operand that is collection-typed but has no
  // collection value yet is not in the mask, so the rows below would lift it
  // whole into every cell — the per-element scalar capture
  // `hasUnresolvedCollectionOperand` describes. Hold the named application
  // instead of freezing an outer product into the result: merely returning
  // `undefined` would hand the arguments to the ordinary application in the
  // caller's tail, which binds them whole and INLINES the literal's body — the
  // same capture one rank up for a body such as `(a, b) ↦ (a, b)`.
  // A NON-mappable slot is passed to the veto as if it were a participant, so
  // that it is ignored: binding its argument whole is what the declaration
  // asks for, with a value or without.
  if (
    hasUnresolvedCollectionOperand(
      ops,
      (_x, i) => !plan.at(i).mappable || mask[i]
    )
  )
    return { value: ce.function(operator, ops) };

  const lazy = lazyBroadcastMapIfNeeded(
    ce,
    operator,
    ops,
    (_x, i) => mask[i],
    numericApproximation,
    // The mismatch check above already ran over the mapped slots; re-running it
    // inside the funnel would see the whole-bound operands too. `callee` is the
    // one-rank arrest (rule 2) — see `lazyBroadcastMap`.
    //
    // `paramTypes` carries rule 3 onto the lazy route: the map's parameter at
    // a mapped slot is DECLARED the slot's element type, so applying the
    // mapping function to a violating element produces the same loud
    // `incompatible-type` the eager loop's `declaredBroadcastElement` produces
    // — instead of silently re-broadcasting a nested element through the body.
    // Semantics must not depend on the source's SIZE.
    {
      strictLengths: false,
      callee: literal,
      paramTypes: (i: number) => (mask[i] ? plan.at(i).elements : undefined),
    }
  );
  if (lazy) return { value: lazy };

  const inner = zip(mapped);
  const rows: Iterator<Expression[]> = {
    next() {
      const { done, value } = inner.next();
      if (done) return { done: true, value: undefined };
      const row: Expression[] = [];
      let k = 0;
      for (let i = 0; i < ops.length; i++)
        row.push(mask[i] ? value[k++] : ops[i]);
      return { done: false, value: row };
    },
  };
  return { rows, mapped, mask };
}

/**
 * Run the DECLARED-`broadcastable<T>` element-wise map (Option A) for one
 * application, or return `undefined` when no slot maps (the caller falls
 * through to ordinary whole-argument application — rule 4).
 *
 * Shared by the pre- and post-evaluation arms of both `_computeValue` and
 * `_computeValueAsync`; the arms differ only in which operands they hand over
 * and which finiteness predicate admits them.
 */
function declaredBroadcast(
  ce: Expression['engine'],
  operator: string,
  literal: Expression,
  plan: BroadcastSlotPlan,
  ops: ReadonlyArray<Expression>,
  isBroadcastOperand: (x: Expression, i: number) => boolean,
  options: Partial<EvaluateOptions> | undefined
): Expression | undefined {
  const setup = setupDeclaredBroadcast(
    ce,
    operator,
    literal,
    plan,
    ops,
    isBroadcastOperand,
    options?.numericApproximation ?? false
  );
  if (!setup) return undefined;
  if (setup.value) return setup.value;

  const results: Expression[] = [];
  // A THROWN element failure aborts the whole broadcast, so it cannot carry a
  // breadcrumb — its message is enriched instead (as in step 2b).
  try {
    while (true) {
      const { done, value } = setup.rows.next();
      if (done) break;
      results.push(
        declaredBroadcastElement(ce, literal, plan, value, setup.mask).evaluate(
          options
        )
      );
    }
  } catch (e) {
    throw withBroadcastThrowContext(
      e,
      operator,
      setup.mapped,
      results.length + 1
    );
  }
  return ce._fn(
    'List',
    annotateBroadcastErrors(
      operator,
      listedBroadcastCells(ce, results, options?.numericApproximation)
    )
  );
}

/** The asynchronous twin of {@link declaredBroadcast}. */
async function declaredBroadcastAsync(
  ce: Expression['engine'],
  operator: string,
  literal: Expression,
  plan: BroadcastSlotPlan,
  ops: ReadonlyArray<Expression>,
  isBroadcastOperand: (x: Expression, i: number) => boolean,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression | undefined> {
  const setup = setupDeclaredBroadcast(
    ce,
    operator,
    literal,
    plan,
    ops,
    isBroadcastOperand,
    options?.numericApproximation ?? false
  );
  if (!setup) return undefined;
  if (setup.value) return setup.value;

  const results: Promise<Expression>[] = [];
  while (true) {
    const { done, value } = setup.rows.next();
    if (done) break;
    // As in the async step 2b: `Promise.all` cannot attribute a rejection to a
    // slot, but each promise is created in a KNOWN one.
    const index = results.length + 1;
    results.push(
      declaredBroadcastElement(ce, literal, plan, value, setup.mask)
        .evaluateAsync(options)
        .catch((e) => {
          throw withBroadcastThrowContext(e, operator, setup.mapped, index);
        })
    );
  }
  // The listing of the cells evaluates synchronously after the `await`, so
  // it runs with the capability registry and the context stack of this
  // evaluation put in place again.
  return Promise.all(results).then(
    (resolved) =>
      ce.withEvaluationContext(options, () =>
        ce._fn(
          'List',
          annotateBroadcastErrors(
            operator,
            listedBroadcastCells(ce, resolved, options?.numericApproximation)
          )
        )
      ),
    (e) => {
      throw withBroadcastThrowContext(e, operator, setup.mapped);
    }
  );
}

/**
 * The per-element application of a declared-`broadcastable<T>` map: the
 * expression to evaluate for one row.
 *
 * ONE RANK DOWN (rule 2). The element binds to the parameter WHOLE, even when
 * it is itself a collection — so this must NOT re-enter the application
 * pipeline by name (`f(row)`), which would re-fire the very gate that produced
 * this row and descend to the leaves, reproducing the unannotated default.
 * `Apply(⟨literal⟩, …)` is the bind-whole route: its callee is an expression,
 * not a symbol, so it never canonicalizes back to a named application.
 *
 * `T` CHECKS PER ELEMENT (rule 3). After the one rank of descent an element
 * must satisfy the slot's declared element type; a violation becomes a loud
 * `Error` value in that element's cell rather than a silent further descent
 * (`broadcastable<T>` itself would admit the nested collection). Only a
 * PROVABLE violation errors — an element of unknown type still binds, exactly
 * as `validateArguments` defers a provisional type.
 */
function declaredBroadcastElement(
  ce: Expression['engine'],
  literal: Expression,
  plan: BroadcastSlotPlan,
  row: ReadonlyArray<Expression>,
  mask: ReadonlyArray<boolean>
): Expression {
  for (let i = 0; i < row.length; i++) {
    if (!mask[i]) continue;
    const t = plan.at(i).elements;
    if (t === undefined) continue;
    const el = row[i];
    if (el.type.isUnknown || el.type.matches(t)) continue;
    // The boxed element, not its rendering: a diagnostic raised while a
    // broadcast cell is being computed reads a deliberately widened type,
    // and `typeError` recovers the precise one by re-reading the operand it
    // is given here (`createTypeErrorExpression`). A string `where` carries
    // no type to re-read.
    return ce.typeError(t, el.type, el);
  }
  // The element binds whole: a collection element is not mapped again
  // (`ApplyWhole`; `Apply` maps a scalar-parameter literal over it).
  return ce._fn('ApplyWhole', [literal, ...row]);
}

/** The function literal a declared-`broadcastable<T>` map applies per element,
 * or `undefined` when this definition has no literal to bind against (a
 * declared-but-unassigned operator: there is nothing to apply, so evaluation
 * stays symbolic and only the TYPE reflects the map). */
function lambdaLiteralOf(
  def: BoxedOperatorDefinition | undefined
): Expression | undefined {
  return def instanceof _BoxedOperatorDefinition && def._isLambda
    ? def._lambdaLiteral
    : undefined;
}

/** True when this operator definition is backed by a user function literal
 * (`ce.assign('f', x ↦ …)`), which has its own broadcast arms (steps 2b/4b).
 * @internal
 */
function isLambdaDef(def: BoxedOperatorDefinition | undefined): boolean {
  return def instanceof _BoxedOperatorDefinition && def._isLambda;
}

/** True when this operator definition is USER code that a collection argument
 * auto-broadcasts through (steps 2b/4b, and the matching type-handler arm): a
 * function literal (`ce.assign('f', x ↦ …)`) or a multi-clause definition
 * (`fib(0) = 0; fib(1) = 1; fib(n) = …`), whose call `fib(5..10)` must map
 * `fib` over the range rather than bind the whole range to `n` — for a
 * recursive body that would never reach a base clause. Excluded: a HOLD
 * definition (`lazy`), whose operands are unevaluated expressions, and a
 * BINDER (`scoped`), whose operands include a bound symbol; neither takes
 * elements to map over. `paramsAreScalar` remains the second half of every
 * gate: a clause whose parameter is declared as a collection binds it whole.
 * @internal
 */
function isUserFunctionDef(
  def: BoxedOperatorDefinition | undefined
): def is _BoxedOperatorDefinition {
  if (!(def instanceof _BoxedOperatorDefinition)) return false;
  // The predicate itself lives on the definition
  // (`isUserFunctionDefinition`), where the Contract B resolution also
  // consults it — one source of truth for "whose machinery owns the
  // exceptional operands".
  return def.isUserFunctionDefinition;
}

/**
 * Convert a CRASH escaping a BUILT-IN, NON-LAZY `evaluate` handler into an
 * error value on the expression, and RETHROW everything else (§4.4 of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`: the `try` around the
 * handler call had a `finally` but no `catch`, so an exception thrown inside
 * a handler escaped `evaluate()` and crashed the caller — e.g. the unguarded
 * `CONDITIONS[name]` lookup, a `TypeError`, before it was guarded).
 *
 * A "crash" is a native fault class only — `TypeError`, `RangeError`,
 * `ReferenceError`: the shapes an engine bug produces, never something a
 * handler throws on purpose. Everything else is a DELIBERATE throw and must
 * keep unwinding:
 * - a `CancellationError` (deadline, iteration limit) aborts the whole
 *   evaluation;
 * - plain `Error` diagnostics are contract, pinned as throws by the suite —
 *   a predicate that returns a non-boolean is a hard error
 *   (`collections.test.ts`, Count/Filter), a mistyped key function throws
 *   with a spelling suggestion (GroupBy), an element-wise failure throws
 *   enriched with broadcast context (`withBroadcastThrowContext`);
 * - a LAZY operator's throw: `Assign`'s redefinition discipline throws by
 *   contract (`attrs-bag-encoding.test.ts` pins it), and a lazy handler owns
 *   its operands' evaluation, errors included;
 * - a USER function's throw: its body runs user statements, whose
 *   contractual throws (an `Assign` to a constant) must reach the caller as
 *   they do at the top level. Over-application of a literal is not a throw
 *   any more: it is the `unexpected-argument` error value (`makeLambda`,
 *   `function-utils.ts`).
 *
 * The native classes are safe to test with `instanceof` across the
 * host/plugin bundle boundary (they are platform globals, not re-bundled
 * engine code); engine-defined classes are not, which is why this file
 * tests `CancellationError` by NAME.
 */
function handlerThrowToErrorValue(
  ce: ComputeEngine,
  e: unknown,
  def: BoxedOperatorDefinition,
  operator: string
): Expression {
  // A denied host capability is a property of the program's environment, not
  // an engine defect: it becomes the operator's `capability-denied` error
  // value whatever the operator is (`lazy` and user-defined included). The
  // check is by name, not `instanceof`: a plugin bundle re-bundles engine
  // code, and a class identity does not survive that boundary.
  if (e instanceof Error && e.name === 'CapabilityDeniedError')
    return ce.error(
      ['capability-denied', (e as { capability?: string }).capability ?? ''],
      operator
    );
  if (!(
    e instanceof TypeError ||
    e instanceof RangeError ||
    e instanceof ReferenceError
  ))
    throw e;
  // Defensive only: `CancellationError` extends plain `Error`, so the gate
  // above already rethrew it. This line exists so that WIDENING the
  // instanceof set can never start swallowing cancellations.
  if (e.name === 'CancellationError') throw e;
  // Explicitly `boolean`: the raw type-predicate result would narrow `def`
  // to `never` past the negation (the predicate names the whole class).
  const isUserFn: boolean = isUserFunctionDef(def);
  if (def.lazy === true || isUserFn) throw e;
  // A native fault is an engine defect, never a property of the input, so it
  // carries its own code, `internal-error`, distinct from the
  // `evaluation-error` that a legitimate domain failure reports. It also
  // carries the stack, so a bug report can be traced without re-running the
  // crash. The stack is the third part of the `ErrorCode`, trimmed to its
  // first frames: the full trace repeats the engine's dispatch frames and
  // adds nothing to a report. See `docs/ERROR-MODEL.md` §1 "The response
  // channels".
  const stack = (e.stack ?? '').split('\n').slice(0, 8).join('\n');
  return ce.error(['internal-error', e.message, stack], operator);
}

/**
 * The declared type of the parameter at position `i` of a built-in operator,
 * or `undefined` when it cannot be found: the definition has no single
 * signature (an overloaded signature, for example), or no parameter is at
 * that position.
 */
function declaredParameterType(
  def: BoxedOperatorDefinition,
  i: number
): Type | undefined {
  const sig = def.signature.type;
  if (typeof sig === 'string' || sig.kind !== 'signature') return undefined;
  const args = sig.args ?? [];
  const optArgs = sig.optArgs ?? [];
  if (i < args.length) return args[i].type;
  if (i < args.length + optArgs.length) return optArgs[i - args.length].type;
  return sig.variadicArg?.type;
}

/**
 * How the element-wise broadcast of a built-in operator treats an operand
 * that is a collection with no positions (a set, an interval, a dictionary —
 * see `isUnindexedCollectionOperand`). Such an operand cannot be paired with
 * the cells of a list by position.
 *
 * - `undefined`: no operand is such a collection.
 * - `'veto'`: such an operand is at a parameter whose declared type is a
 *   number type, or at a parameter whose type cannot be found. The operator
 *   is not broadcast. It gets the whole operand, and a numeric operator gives
 *   the `incompatible-type` error for it (`unindexedCollectionOperandError`).
 * - `'lift'`: each such operand is at a parameter that is not a number type,
 *   for example the `any` parameters of `String`. The operator is broadcast
 *   over the other collections, and the operand is used whole in every cell,
 *   as a scalar is: `String([1, 2], Set(3, 4))` is a list of two strings.
 *
 * The ordering comparisons (`ORDERING_RELATIONS`) answer `'veto'`, although
 * their parameters are declared `any`: they declare `any` for the chain form
 * (`a < b < c`), quantities and `Missing`, but they order numbers, and a set
 * has no order with a number. Their handler then gets the whole set beside
 * the list, and answers the `incompatible-type` error
 * (`broadcastComparison`, `library/relational-operator.ts`):
 * `Less(Set(5, 6), [1, 2])` is that error, not
 * `[Set(5, 6) < 1, Set(5, 6) < 2]`.
 */
function unindexedOperandBroadcast(
  def: BoxedOperatorDefinition,
  ops: ReadonlyArray<Expression>
): 'veto' | 'lift' | undefined {
  if (!ops.some(isUnindexedCollectionOperand)) return undefined;
  if (
    def instanceof _BoxedOperatorDefinition &&
    ORDERING_RELATIONS.has(def.name)
  )
    return 'veto';
  for (let i = 0; i < ops.length; i++) {
    if (!isUnindexedCollectionOperand(ops[i])) continue;
    const param = declaredParameterType(def, i);
    if (param === undefined || isSubtype(param, 'number')) return 'veto';
  }
  return 'lift';
}

/** The broadcastable comparisons that order their operands. `Greater` and
 * `GreaterEqual` are boxed as `Less` and `LessEqual` with the operands
 * swapped, and are listed for a definition that keeps its own head. See
 * `unindexedOperandBroadcast`. */
const ORDERING_RELATIONS: ReadonlySet<string> = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
]);

/**
 * The rows of the element-wise broadcast of a built-in operator over `ops`
 * when `unindexedOperandBroadcast()` answers `'lift'`: each operand that is a
 * collection with no positions is used whole in every row, and the other
 * collections supply the cells, as in `zip`.
 */
function zipLiftingUnindexed(
  ops: ReadonlyArray<Expression>
): Iterator<Expression[]> {
  return zipBroadcast(
    ops,
    (x) => zipParticipates(x) && !isUnindexedCollectionOperand(x)
  );
}

/**
 * The collection literals. Their operands are elements, so an error in one
 * of them is a failed element and is never the refusal of a source (see
 * `_refusedUnindexedSourceError()`).
 */
const COLLECTION_LITERAL_HEADS = new Set(['List', 'Set', 'Tuple']);

/**
 * The `incompatible-type` error for an operand that is a collection with no
 * positions (a set, an interval, a dictionary — see
 * `isUnindexedCollectionOperand`) at a NUMERIC parameter of a built-in
 * broadcastable operator, or `undefined`.
 *
 * Such an operand is not a number, and the broadcast steps do not map the
 * operator over it, because a set cannot be paired with the cells of a list
 * by position (`unindexedOperandBroadcast`). This check gives every such
 * operator the same error, before its handler runs: `Floor(Set(1.5, 2.5))`,
 * `Mod(5, Set(2, 3))` and `Power(Set(1, 2), 2)` are each
 * `Error(ErrorCode("incompatible-type", "number", …), …)`. Some handlers
 * (`Power`, `Sin`, `Add`) also refuse such an operand themselves with
 * `nonNumericOperandError`.
 *
 * The generic runtime conformance check (`runtimeConformanceError`) does not
 * do this: at a broadcastable operator it leaves every operand that could
 * be a collection to the broadcast steps.
 *
 * Only these operands are checked:
 * - an operand at a parameter whose declared type is a number type. A
 *   parameter that can take a set (`Element`, `Union`, the `any` parameters
 *   of `String`) is not affected;
 * - for an operator with ONE signature. An overloaded signature is left to
 *   its handler;
 * - for a library operator, not a user function: a user function lifts a
 *   set whole into each cell of its own broadcast.
 *
 * `Abs` of a set is not an error: `|S|` is the number of elements of `S`,
 * and the `Abs` evaluate handler gives `Count(S)` (`isCardinalityOperand`).
 */
function unindexedCollectionOperandError(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition | undefined,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (!(def instanceof _BoxedOperatorDefinition)) return undefined;
  if (def.broadcastable !== true || def.lazy === true) return undefined;
  if (!ops.some(isUnindexedCollectionOperand)) return undefined;
  const isUserFn: boolean = isUserFunctionDef(def);
  if (isUserFn) return undefined;
  if (def.name === 'Abs' && ops.length === 1 && isCardinalityOperand(ops[0]))
    return undefined;
  for (let i = 0; i < ops.length; i++) {
    if (!isUnindexedCollectionOperand(ops[i])) continue;
    const param = declaredParameterType(def, i);
    if (param === undefined || !isSubtype(param, 'number')) continue;
    const err = nonNumericOperandError(ce, [ops[i]]);
    if (err !== undefined) return err;
  }
  return undefined;
}

/**
 * The evaluated operands `ops` that the `evaluate` handler of the operator
 * definition `def` receives: for a function literal under a signature
 * DECLARED on its name (the case {@link genericRuntimeConformance} checks
 * with `declaredScalarConformance`), an absent value at a numeric parameter
 * of the declaration is read as `NaN`
 * ({@link absentAsNaNAtDeclaredNumericParams}). `ops` itself otherwise.
 */
function declaredLambdaOperands(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition | undefined,
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (!ce.strict || !(def instanceof _BoxedOperatorDefinition)) return ops;
  if (def.lazy === true || def.inferredSignature) return ops;
  if (!isUserFunctionDef(def) || !def._isLambda || def._derivedSignature)
    return ops;
  return absentAsNaNAtDeclaredNumericParams(
    ce,
    def._validationSignature ?? def.signature.type,
    ops
  );
}

/**
 * The dispatch-site gate for the generic runtime conformance check
 * (`runtimeConformanceError`, `validate.ts` — R1/R8, §4.4 of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`), shared by the sync
 * step 4d and its async twin. Beyond the call sites' cheap gates
 * (strict engine, non-lazy, handler present), excluded here:
 *
 * - a definition that is not a `_BoxedOperatorDefinition` (no signature to
 *   check against);
 * - an INFERRED signature: it is a guess subject to revision, and a guess
 *   must never refute a value;
 * - a definition with a CUSTOM `canonical` handler: for those, boxing never
 *   runs the declared-signature validation — the handler plus the lenient
 *   `checkNumericArgs` re-validation are the admission authority, and (as
 *   the re-validation comment in `box.ts` puts it) "their declared
 *   signatures are looser than what their handlers legitimately accept":
 *   `Apply(3, 5)` is a constant nullary despite the `symbol` parameter,
 *   `Degrees(i)` flows through the linear conversion despite `(real)`.
 *   Enforcing the declared signature here would refuse at evaluation what
 *   boxing deliberately admits on the literal route;
 * - a user function whose signature is DERIVED from its literal, or a
 *   multi-clause definition: `apply()` runs the runtime validation of the
 *   annotated parameters itself, and a multi-clause definition keeps its
 *   own dispatch and its `no-matching-clause` error (`multi-clause.ts`).
 *
 * One user function IS checked here: a function literal under a signature
 * DECLARED on its name. `apply()` checks only what the literal annotates, so
 * the scalar parameter types of the declaration are checked by
 * `declaredScalarConformance`.
 */
function genericRuntimeConformance(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition | undefined,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (!(def instanceof _BoxedOperatorDefinition)) return undefined;
  if (def.lazy === true || def.inferredSignature) return undefined;
  // `Sqrt`, `Ln` and `Log` are checked here although their library
  // definitions have a `canonical` handler (`numericCanonicalHandler`,
  // `canonical-numeric.ts`). They got that handler on 2026-10-01 only so
  // that a copy of the definition keeps the canonical form; before, they had
  // no handler and this check applied to them. The other arithmetic
  // operators with that handler had a custom handler before, and stay
  // skipped.
  if (def.canonical !== undefined) {
    const numeric = numericCanonicalHandlerName(def.canonical);
    if (numeric !== 'Sqrt' && numeric !== 'Ln' && numeric !== 'Log')
      return undefined;
  }
  const isUserFn: boolean = isUserFunctionDef(def);
  if (isUserFn) {
    // A function literal under a signature its author DECLARED on the name
    // (`ce.declare(f, { signature })`, then the body assigned a second
    // time, which keeps the operator representation): the scalar parameter
    // types of the declaration are checked here, as they are when the same
    // function is held as a value (`declaredScalarConformance`). A
    // signature DERIVED from the literal is not: the literal checks its own
    // annotations when it is applied, and the types of its bare parameters
    // are inferences. A multi-clause definition keeps its own dispatch.
    if (!def._isLambda || def._derivedSignature) return undefined;
    return declaredScalarConformance(
      ce,
      def,
      def._validationSignature ?? def.signature.type,
      def.broadcastable === true,
      ops
    );
  }
  return runtimeConformanceError(
    ce,
    def,
    def.signature,
    def.broadcastable === true,
    ops,
    // Contract B NaN policy: an operand the boxing admission carved in must
    // not be re-refuted at dispatch (`docs/ERROR-MODEL.md` §4).
    (i) => def.resolvedNanBehaviorAt(i)
  );
}

function isOperatorDefinition(
  source: BoxedOperatorDefinition | Type
): source is BoxedOperatorDefinition {
  return typeof source === 'object' && source !== null && 'signature' in source;
}

/**
 * The STRING a lazy collection promised, when its declared result type says
 * `string` — otherwise `undefined`, leaving evaluation to take its ordinary
 * course.
 *
 * The element-selecting collection operators (`Reverse`, `Rest`, `Most`,
 * `Take`, `Drop`, `Slice`, `RotateLeft`, `RotateRight`, `Filter`, `TakeWhile`,
 * `DropWhile`, `Dedup`) each return a subset or a reordering of the source's
 * own elements, so each is closed over strings and declares a
 * `(string, …) -> string` overload arm. A node that resolved to that arm must
 * evaluate to a string VALUE; without this step it would evaluate to its lazy
 * view, or — under an explicit `materialization` request — to a `List` of its
 * characters, either of which contradicts the type it just reported. See
 * `docs/STRING_ROADMAP.md`, "String preservation rule".
 *
 * It lives HERE, keyed on the declared type, rather than in an `evaluate`
 * handler on each of those operators, because the presence of an `evaluate`
 * handler is exactly what tells the step below that an operator materializes
 * itself: adding one to `Take` disabled materialization for every list and
 * range source (measured: 24 failures in `test/compute-engine/collections.test.ts`).
 *
 * Laziness is not lost by being eager here — a string is always finite, and
 * its characters are already segmented and in memory.
 *
 * RE-SEGMENTATION CAVEAT: concatenating the selected characters can MERGE
 * adjacent grapheme clusters or split one apart, so the result may hold a
 * different number of characters than were selected — reversing `"xé"`
 * written as `x` + `e` + COMBINING ACUTE ACCENT puts the combining mark first,
 * where it attaches to nothing and stands as a character of its own. A
 * character-selecting operation is closed over strings but NOT over character
 * COUNTS; that is inherent to Unicode segmentation, not a defect
 * (`docs/STRING_ROADMAP.md`, design constraint 3).
 */
function evaluateStringPreservingCollection(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition
): Expression | undefined {
  // The walk below goes through `each()`, which falls back to `evaluate()`
  // when the operator has no `iterator` handler of its own — that would
  // re-enter this very method. Requiring the handler keeps the step to the
  // lazy collection operators it is about, with no re-entrancy.
  if (def.collection?.iterator === undefined) return undefined;
  if (!expr.isLazyCollection) return undefined;
  if (!expr.type.matches('string')) return undefined;
  // The walk must be known to terminate, or an unwalkable source (a symbolic
  // bound, an operand that cannot be enumerated) would silently answer `""`
  // for a string the operator never actually computed. Two independent proofs
  // are accepted, either one sufficient:
  //
  // 1. The node states a finite element count. This is the ordinary case: the
  //    source is a literal string, list or range, and every operator in the
  //    family reports a count derived from it.
  //
  // 2. Failing that, every operand is `string`-TYPED and each one carries
  //    POSITIVE evidence that its characters can be walked. Every value of
  //    type `string` is a finite sequence of grapheme clusters, and the
  //    operators this step serves only ever re-emit elements drawn from their
  //    operands, so a walk over walkable string operands cannot diverge. This
  //    proof is what lets `Join("a", StringJoin(["b"]))` materialize: an
  //    unevaluated EAGER producer cannot state an element count without
  //    evaluating (its `elementCount` handler is required to be
  //    evaluation-free), so the enclosing `Join` reports no count and no
  //    finiteness even though both operands are finite. Without it the node
  //    evaluated to a `Join` expression that printed as `"ab"` but was not a
  //    string value at all (`.string` was `undefined`).
  //
  //    Evidence must be affirmative; "has not said no" is not evidence. A
  //    string-TYPED operand whose characters are out of reach walks to
  //    nothing, and the type proof alone would then answer `""` for
  //    `Reverse(s)` and drop the operand from `Join(s, "a")`. Two such
  //    operands leave enumerability UNDECIDED rather than `false`: a producer
  //    over a declared-but-unassigned symbol (`StringJoin(xs)` with
  //    `xs: string` unassigned) and a producer over an infinite source
  //    (`StringJoin(<infinite Map>)`). Both stay unevaluated, both yield
  //    nothing from `each()`, and admitting them made `Join("a",
  //    StringJoin(xs))` answer `"a"`. So an operand is accepted only if it IS
  //    a string value, or reports itself enumerable or finite, or EVALUATES to
  //    something that does.
  //
  // A node whose finiteness is definitively `false` is refused under either
  // proof.
  if (expr.isFiniteCollection === false) return undefined;
  const count = expr.count;
  const hasFiniteCount =
    expr.isFiniteCollection === true &&
    count !== undefined &&
    Number.isFinite(count);
  const isWalkableNow = (op: Expression) =>
    isString(op) ||
    op.isEnumerableCollection === true ||
    op.isFiniteCollection === true;
  const operandsAreWalkableStrings =
    expr.ops.length > 0 &&
    expr.ops.every((op) => {
      if (!op.type.matches('string')) return false;
      if (isWalkableNow(op)) return true;
      // An unevaluated eager producer answers no enumerability question
      // without being run, so it is run once. `StringJoin(["b"])` answers with
      // the string; `StringJoin(xs)` over an unassigned symbol, and a
      // `StringJoin` over an infinite source, answer with themselves and are
      // refused.
      return isWalkableNow(op.evaluate());
    });
  if (!hasFiniteCount && !operandsAreWalkableStrings) return undefined;

  const parts: string[] = [];
  for (const c of expr.each()) {
    if (!isCharacter(c) && !isString(c)) return undefined;
    parts.push(c.string);
  }
  return expr.engine.string(parts.join(''));
}

/**
 * Post-evaluation twin of the string-preservation step (step 2d of
 * `_computeValue`), applied to the node that evaluation actually produced.
 *
 * Step 2d runs on the node as authored, and it requires the node's type to
 * MATCH `string` exactly. A `type` handler that reads a raw operand's STATIC
 * type can only report a union there: `Slice(xs, RangeOf(xs, needle))` types
 * as `nothing | string`, because `RangeOf` is honestly typed `range | nothing`
 * (the needle may be absent) and a slice over an absent span is `Nothing`.
 * `nothing | string` does not match `string`, so step 2d declines. Once the
 * operands have been evaluated the span is a concrete `2..3`, and the node
 * rebuilt from them types exactly `string` — but step 2d has already run by
 * then, and the evaluation result is memoized, so it would never see the
 * resolved node. Re-checking here is what makes
 * `Slice("abcd", RangeOf("abcd", "bc"))` evaluate to the string value `"bc"`
 * rather than to a lazy view that merely PRINTS as one (its `.string` was
 * `undefined`).
 *
 * Widening step 2d's gate to accept unions would NOT be an equivalent fix: a
 * `nothing | string` node whose span really is absent must evaluate to
 * `Nothing`, which the ordinary evaluation path already produces. Only a node
 * that has resolved to `string` may be materialized into one.
 *
 * Returns the original result unchanged when the check does not apply or
 * declines, so a lazy view stays lazy.
 */
function evaluateStringPreservingResult(result: Expression): Expression {
  if (!(result instanceof BoxedFunction)) return result;
  const def = result.operatorDefinition;
  if (!def) return result;
  // `evaluateStringPreservingCollection` applies its own gates: an `iterator`
  // collection handler (which also rules out re-entrancy through `each()`),
  // laziness, an exact `string` type, and a proof that the walk terminates.
  return evaluateStringPreservingCollection(result, def) ?? result;
}

/**
 * Whether the value of `expr` can be the absent value instead of a
 * collection: its type is a union with a `missing` member of its own
 * (`list<integer> | missing`). A `missing` member of the ELEMENT type
 * (`list<integer | missing>`, a list with absent cells) does not count: that
 * value is always a collection.
 *
 * Such a node is not materialized before its operands are evaluated (step 3
 * of the evaluation). The walk of the unevaluated node cannot tell an absent
 * source from an empty one, and its type is not a list type, so the literal
 * was built as a `Set`: `Append(At(x, 1), 2)`, with `x` a list of lists
 * whose first row is `[3, 1, 2]`, materialized to `Set(3, 1, 2)` (the
 * duplicate `2` lost), and `Reverse` of a restricted list whose condition is
 * false materialized to `Set(NaN)`. The ordinary evaluation answers for both
 * cases: the absence test answers the marker for an absent operand, and the
 * result over a present operand is a list, which is then materialized
 * (`materializeLazyResult`).
 */
function mayBeAbsentAsWhole(expr: Expression): boolean {
  return threadedPresentType(expr.type.type) !== undefined;
}

/**
 * The operands of a LAZY operator that propagates absence, with each
 * collection operand that can be absent as a whole replaced by its value; or
 * `undefined` when no operand is replaced. `absent` is true when a replaced
 * operand is the absent value.
 *
 * A lazy operator (`Map`, `Filter`, `Reduce`, `Any`) holds its operands, so
 * the absence test of the evaluation (step 4a) sees an absent operand only
 * when `Missing` is written in the source. An absence that the operand
 * COMPUTES was not seen: with `x` a list of lists, `Filter(At(x, 7), p)` and
 * `Reduce(At(x, 7), Add, 0)` stayed unevaluated when `x` has no seventh row,
 * where `Length(At(x, 7))`, whose operand is evaluated, is `NaN`. The present
 * case failed too: the type of the operand, `list<integer> | missing`, is not
 * a collection type, so the lazy view did not read it as a source, and
 * `Map(f, At(x, 1))` stayed unevaluated.
 *
 * Each operand at a position that strips `missing` (`missingStrip`) that
 * `isAbsentableCollectionOperand` (`validate.ts`) admits is evaluated, and
 * replaced by its value when `settledAbsentableValue` says the value settles
 * the question. When the value of such an operand is an error, that error,
 * with the frame of this operator, is the result (`error`), even when
 * another operand is absent: an error is absorbing, and the absence of an
 * operand does not hide it. The operand is evaluated once: the operator is evaluated
 * again over the value, not over the operand. A second evaluation of an
 * operand whose value does not settle the question (an unassigned symbol
 * declared `list<integer> | missing`, a restriction whose condition is not
 * decided) is answered by the lazy-collection evaluate memo: ten nested
 * views over such an operand evaluate in the same time as one (measured
 * 2026-09-30).
 *
 * An operator that binds a variable (`scoped`) is left alone: the operand
 * can mention the bound variable, which has no value here. A broadcastable
 * operator (`Multiply`, `Add`) is left alone too: beside a collection
 * operand its absent operand lands in each cell of the result
 * (`[1, 2, 3] · P` with the restricted point `P` absent is three absent
 * cells, not one absent value), which its own handler computes.
 */
function resolveAbsentableLazyOperands(
  operator: string,
  def: BoxedOperatorDefinition,
  ops: ReadonlyArray<Expression>,
  evaluate: (x: Expression) => Expression
): AbsentableLazyOperands | undefined {
  const positions = absentableLazyOperandPositions(def, ops);
  if (positions.length === 0) return undefined;
  return settleAbsentableLazyOperands(
    operator,
    ops,
    positions,
    positions.map((i) => evaluate(ops[i]))
  );
}

/** `resolveAbsentableLazyOperands` on the asynchronous evaluation route: the
 * operands are evaluated with the asynchronous evaluator. */
async function resolveAbsentableLazyOperandsAsync(
  operator: string,
  def: BoxedOperatorDefinition,
  ops: ReadonlyArray<Expression>,
  evaluate: (x: Expression) => Promise<Expression>
): Promise<AbsentableLazyOperands | undefined> {
  const positions = absentableLazyOperandPositions(def, ops);
  if (positions.length === 0) return undefined;
  const values: Expression[] = [];
  for (const i of positions) values.push(await evaluate(ops[i]));
  return settleAbsentableLazyOperands(operator, ops, positions, values);
}

/** The positions of the operands `resolveAbsentableLazyOperands` evaluates:
 * none for an operator the rule does not apply to. */
function absentableLazyOperandPositions(
  def: BoxedOperatorDefinition,
  ops: ReadonlyArray<Expression>
): number[] {
  if (
    def.lazy !== true ||
    def.scoped !== false ||
    def.broadcastable ||
    def.resolvedMissingBehavior !== 'propagate'
  )
    return [];
  const positions: number[] = [];
  for (let i = 0; i < ops.length; i++)
    if (def.stripsMissingAt(i) && isAbsentableCollectionOperand(ops[i]))
      positions.push(i);
  return positions;
}

/** The result of `resolveAbsentableLazyOperands`: the operands with the
 * values that settle the question, or the first error among the values. */
type AbsentableLazyOperands =
  { ops: ReadonlyArray<Expression>; absent: boolean } | { error: Expression };

/** The operands with each evaluated operand whose value settles the question
 * (`settledAbsentableValue`) replaced by that value, or the first error
 * among the values; see `resolveAbsentableLazyOperands`. */
function settleAbsentableLazyOperands(
  operator: string,
  ops: ReadonlyArray<Expression>,
  positions: ReadonlyArray<number>,
  values: ReadonlyArray<Expression>
): AbsentableLazyOperands | undefined {
  // The errors are read first: an error is the result even when another
  // operand is absent. A collection with an error in one element is not an
  // error (`errorValue()` does not look into a collection), and is kept.
  for (const [k, i] of positions.entries()) {
    const error = errorValue(values[k], { operator, index: i + 1 });
    if (error !== undefined) return { error };
  }
  let resolved: Expression[] | undefined;
  let absent = false;
  positions.forEach((i, k) => {
    const value = settledAbsentableValue(values[k]);
    if (value === undefined) return;
    if (isAbsentScalarSymbol(value)) absent = true;
    resolved ??= [...ops];
    resolved[i] = value;
  });
  return resolved === undefined ? undefined : { ops: resolved, absent };
}

/**
 * Whether `x`, an operand that a lazy operator holds, is a source collection
 * that is not a collection value yet: an application that has no collection
 * handlers (an element read `At(t, 1)`, an eager operator such as `Sort`, a
 * call of a user function), or a symbol whose value is such an application.
 * Such an operand has a value only when it is evaluated: before that, its
 * `isFiniteCollection` and `isEnumerableCollection` are `undefined`. A
 * symbol whose value is a scalar (`n := 5` with `n` declared `unknown`) is
 * also such an operand: its value is known, and it is selected so that
 * `settleHeldEagerSources()` reports the `incompatible-type` error at
 * evaluation, where the boxing admitted the symbol.
 *
 * A function literal is not such an operand. A held conditional (`When`,
 * `Which`, `If`) is not one either: the evaluation lifts it out of the
 * operator (step 4c). A symbol whose value mentions the symbol itself is not
 * one either: its value is not resolved (see `mapSource()` in
 * `library/collections.ts`).
 */
function isHeldEagerSource(x: Expression): boolean {
  if (isFunction(x, 'Function') || x.isCollection) return false;
  if (isFunction(x))
    return (
      x.operator !== 'When' && x.operator !== 'Which' && x.operator !== 'If'
    );
  if (!isSymbol(x) || x.valueDefinition?.isSelfReferential) return false;
  const value = x.value;
  if (value === undefined) return false;
  if (isFunction(value)) return isHeldEagerSource(value);
  // A symbol whose value is a scalar (a symbol declared `unknown` and
  // assigned `5`). The boxing admits it: a canonical form does not read the
  // value of a symbol (`checkCollectionOperand()` in `validate.ts`). The
  // evaluation reads the value, and a value that cannot be a collection is
  // an `incompatible-type` error (`settleHeldEagerSources()`).
  return !value.isCollection;
}

/**
 * Whether `options` are those of the display preview (`toString()`, the
 * `latex` getter, `toLatex()` without a `materialization` option) and `expr`
 * is a lazy view. The preview passes the exact `DISPLAY_MATERIALIZATION`
 * object, so an explicit `materialization: [5, 5]` is not the preview.
 */
function isDisplayPreviewOf(
  expr: Expression,
  options: Partial<EvaluateOptions> | undefined
): boolean {
  return (
    options?.materialization === DISPLAY_MATERIALIZATION &&
    expr.isLazyCollection
  );
}

/** A source collection held by a lazy operator, see `heldEagerSources()`. */
type HeldEagerSource = {
  /** The position of the operand that holds the source. */
  index: number;
  /** The source: the operand itself, or the collection of the `Element`
   * clause at that operand. */
  source: Expression;
  /** The collection type that the value of the source must have, or
   * `undefined` when a value that is not a collection is accepted (the
   * operand of a broadcast). */
  expected: 'collection' | 'indexed_collection' | undefined;
};

/**
 * The sources of a LAZY operator that are not collection values yet
 * (`isHeldEagerSource`), or an empty array.
 *
 * A lazy operator holds its operands, and a source that is not a collection
 * value has no collection handlers. A lazy view over it cannot walk it, and
 * an operator with a handler cannot read it: with `t` a pair of lists,
 * `Dedup(At(t, 1))`, `Scan(At(t, 1), f)` and `ArgMax(At(t, 1))` stayed
 * unevaluated, and `Numerator(At(t, 1))` read the list as one number. The
 * sources are:
 * - for an operator of `COLLECTION_SOURCE_OPERATORS` (`Map`, `Filter`,
 *   `Reduce`, `ArgMax`, `Dedup`, ...), the operands at a slot whose declared
 *   type is a collection type (`collectionSourceSlot()`);
 * - for a `Comprehension`, the collection of its first `Element` clause,
 *   when it does not mention the index of a clause. The collection of a
 *   later clause can mention the index of an earlier clause, which has no
 *   value here;
 * - for a lazy broadcastable operator with numeric parameters (`Numerator`,
 *   `Denominator`), each operand at a numeric parameter whose type is a
 *   collection type. The value is then broadcast as a literal list is. An
 *   operator whose `evaluate` handler does the broadcast itself (`Add`,
 *   `Multiply`, `'evaluated-operands'`) is not included.
 *
 * The display preview (`toString()`, the `latex` getter and `toLatex()`
 * without a `materialization` option) evaluates a lazy view with the exact
 * `DISPLAY_MATERIALIZATION` object, and a lazy VIEW gets no sources there:
 * printing a view must not evaluate its operands, so a view over a symbolic
 * carrier prints as written (`\mathrm{Join}(q)`). The preview evaluates
 * the elements of a view with the same options. An element that is not a
 * view (`Reduce(At(t, 1), Add, 0)`) still gets its sources, so that its
 * value is printed.
 */
function heldEagerSources(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options: Partial<EvaluateOptions> | undefined
): HeldEagerSource[] {
  if (def.lazy !== true) return [];
  if (isDisplayPreviewOf(expr, options)) return [];
  const ops = expr.ops;
  if (def.scoped !== false) {
    if (expr.operator !== 'Comprehension') return [];
    const clause = ops[1];
    if (!isFunction(clause, 'Element') || clause.nops < 2) return [];
    const source = clause.op2;
    if (!isHeldEagerSource(source)) return [];
    const indexes = ops
      .slice(1)
      .flatMap((c) => (isFunction(c, 'Element') ? c.op1.symbols : []));
    if (indexes.length > 0 && source.has(indexes)) return [];
    return [{ index: 1, source, expected: 'collection' }];
  }
  const sources: HeldEagerSource[] = [];
  if (isCollectionSourceOperator(expr.operator)) {
    ops.forEach((x, index) => {
      // A restricted collection, `[1,3,5]{0<t}`, is one held `When` over the
      // list, and step 4c threads it whole at a position the operator
      // threads (`threadsConditionals`): the operation is computed on the
      // list and the result is restricted by the condition. Such an operand
      // is not a source here. The held `When` presents its cells through
      // its collection handlers, but it is not an indexed collection, so
      // the test for a collection without positions below refused it with
      // an `incompatible-type` error before step 4c could thread it:
      // `ArgMax([1,3,5]{0<t})` and `Scan([1,3,5]{0<t}, Add)` were errors.
      if (
        def.threadsConditionalsAt(index) &&
        (isFunction(x, 'When') || isFunction(x, 'Which'))
      )
        return;
      const held = isHeldEagerSource(x);
      // A collection without positions (a set held by a symbol of a wider
      // declared type) at a slot that reads its source by position is a
      // source too: its value is refused by `settleHeldEagerSources()`.
      if (!held && !(x.isCollection && !x.isIndexedCollection)) return;
      const expected = collectionSourceSlot(def.signature.type, index);
      if (expected === undefined) return;
      if (held || expected === 'indexed_collection')
        sources.push({ index, source: x, expected });
    });
    return sources;
  }
  if (
    def.broadcastable &&
    !def.broadcastExemptions.includes('evaluated-operands')
  ) {
    const signature = def.signature.type;
    if (typeof signature === 'string' || signature.kind !== 'signature')
      return [];
    ops.forEach((x, index) => {
      const slot = signatureSlotType(signature, index);
      if (slot === undefined || !isSubtype(slot, 'number')) return;
      if (isHeldEagerSource(x) && isTypedAsCollection(x))
        sources.push({ index, source: x, expected: undefined });
    });
  }
  return sources;
}

/**
 * The result of evaluating the held sources of a lazy operator once
 * (`heldEagerSources()`): the operands with each source replaced by its
 * value, an error that is the value of the node, or `undefined` when no
 * source has a value that settles anything.
 *
 * - A value that is an error is the value of the node, with a breadcrumb that
 *   names the operator and the position of the operand.
 * - A collection value without positions (a set, a dictionary) at a slot
 *   declared `indexed_collection` is an `incompatible-type` error, the error
 *   that the boxing gives for such a literal operand (`ArgMax(Set(3, 1))`).
 * - A value that is a collection, or the absent value, replaces the source.
 *   The node is then evaluated again over the value, and the source is not
 *   evaluated again.
 * - A value that cannot be a collection (its type is disjoint from every
 *   collection type, such as the number `5`) at a source slot is an
 *   `incompatible-type` error, the error that the boxing gives for a
 *   literal operand of an eager collection operator (`Sort(5)`).
 * - Any other value (the source stays symbolic) leaves the source as it is.
 */
function settleHeldEagerSources(
  expr: BoxedFunction,
  sources: ReadonlyArray<HeldEagerSource>,
  values: ReadonlyArray<Expression>
): { ops: ReadonlyArray<Expression> } | { error: Expression } | undefined {
  const ce = expr.engine;
  let ops: Expression[] | undefined;
  for (let k = 0; k < sources.length; k++) {
    const { index, source, expected } = sources[k];
    const value = values[k];
    const frame = { operator: expr.operator, index: index + 1 };
    if (!value.isValid) return { error: errorValue(value, frame) ?? value };
    // A slot that reads its source by position (`ArgMax`, `Differences`)
    // refuses a value without positions (a set, a dictionary). The boxing
    // refuses such a literal operand, but a symbol of a wider declared type
    // (`collection<integer>`, `unknown`) can hold one, and the operator then
    // read the set in its iteration order: `ArgMax(c)` with `c := Set(3, 1)`
    // gave `1`.
    if (
      expected === 'indexed_collection' &&
      value.isCollection &&
      !value.isIndexedCollection
    ) {
      const error = ce.typeError(expected, value.type, value);
      return { error: errorValue(error, frame) ?? error };
    }
    if (value === source || value.isSame(source)) continue;
    if (value.isCollection || isAbsentScalarSymbol(value)) {
      ops ??= [...expr.ops];
      const operand = ops[index];
      ops[index] =
        operand === source
          ? value
          : ce._fn('Element', [
              (operand as BoxedFunction).op1,
              value,
              ...(operand as BoxedFunction).ops.slice(2),
            ]);
      continue;
    }
    if (
      expected !== undefined &&
      value.type.isDisjointFrom(COLLECTION_SHAPE_TYPE)
    ) {
      const error = ce.typeError(expected, value.type, value);
      return { error: errorValue(error, frame) ?? error };
    }
  }
  return ops === undefined ? undefined : { ops };
}

/**
 * Evaluate once each held source of a lazy operator that is not a
 * collection value yet, see `heldEagerSources()` and
 * `settleHeldEagerSources()`.
 */
function resolveHeldEagerSources(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options: Partial<EvaluateOptions> | undefined
): { ops: ReadonlyArray<Expression> } | { error: Expression } | undefined {
  const sources = heldEagerSources(expr, def, options);
  if (sources.length === 0) return undefined;
  return settleHeldEagerSources(
    expr,
    sources,
    sources.map(({ source }) => source.evaluate(operandOptions(options)))
  );
}

/** `resolveHeldEagerSources` on the asynchronous evaluation route: the
 * sources are evaluated with the asynchronous evaluator.
 *
 * This function can run after an `await` of the caller, and the settlement
 * runs after the `await` of each source. The discovery of the sources and
 * the settlement read types and bindings, and build canonical expressions,
 * so they run in the context of the evaluation
 * (`engine.withEvaluationContext()`): otherwise they see the global scope,
 * not the scope of an enclosing `Sum` index or of a function activation.
 * The asynchronous evaluation of each source is not in that bracket: the
 * options carry the context to that evaluation. */
async function resolveHeldEagerSourcesAsync(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options: Partial<EvaluateOptions> | undefined
): Promise<
  { ops: ReadonlyArray<Expression> } | { error: Expression } | undefined
> {
  const ce = expr.engine;
  const sources = ce.withEvaluationContext(options, () =>
    heldEagerSources(expr, def, options)
  );
  if (sources.length === 0) return undefined;
  const values: Expression[] = [];
  for (const { source } of sources)
    values.push(await source.evaluateAsync(operandOptions(options)));
  return ce.withEvaluationContext(options, () =>
    settleHeldEagerSources(expr, sources, values)
  );
}

/**
 * Whether `expr` is a lazy view evaluated for the display preview
 * (`isDisplayPreviewOf`) and one of its operands is typed as a collection but
 * is not a collection value yet (`isHeldEagerSource`). The preview then
 * prints the view as written, and does not materialize it.
 *
 * The walk of such an operand evaluates it, and so do the facets of the view
 * that the materialization reads before the walk: `Join(src(1), [4])`
 * evaluated `src(1)` three times to print one preview, once for
 * `isFiniteCollection`, once for `count` (both through `eagerViewSource()` in
 * `library/collections.ts`) and once for the walk. Printing an unevaluated
 * view does not evaluate its operands: `Join(src(1), [4])` prints
 * `\mathrm{Join}(\mathrm{src}(1), [4])`, and its value is printed after an
 * evaluation, which evaluates the operand once (step 4).
 *
 * A view whose evaluation has an effect (`previewRunsEffect`) prints as
 * written too. Its operands can be collection values, but the walk of the
 * preview evaluates each element it gives, and the facets and the handler of
 * the view (`Dedup` compares its elements) evaluate the cells: printing
 * `Dedup([1, H(1), 2])` with `H` declared `pure: false` called `H` twice,
 * and a preview over `Random()` gave a different list at each print.
 * Printing must not run a side effect, so `Reverse([1, H(1), 2])` prints
 * `Reverse([1, H(1), 2])`.
 */
function previewHoldsEagerOperand(
  expr: BoxedFunction,
  options: Partial<EvaluateOptions> | undefined
): boolean {
  if (!isDisplayPreviewOf(expr, options)) return false;
  if (previewRunsEffect(expr)) return true;
  return expr.ops.some((x) => isTypedAsCollection(x) && isHeldEagerSource(x));
}

/**
 * Whether the evaluation of the view `expr` can have an effect: a call of a
 * function declared `pure: false`, a draw of `Random`, a write to a variable
 * that `expr` does not declare itself.
 *
 * Two tests come first, because the runtime effects (`isPure`) count as
 * pure a call of a callback parameter (`w ↦ w(1)`) and a function literal
 * held as data, and the preview can call such a function:
 * - a call of the index of an `Element` clause whose source is not proven to
 *   supply only pure functions (see below);
 * - a `Function` literal anywhere in `expr` whose inferred effects are not
 *   pure: `Map(w ↦ w(1), [a ↦ H(a)])` called `H`.
 *
 * Then a view that is pure by the runtime effects has no effect. The
 * runtime effects of the other views are conservative in two ways that are
 * wrong for a preview:
 * - the runtime effects report `scope` for each `Assign` and `Declare`, also
 *   for a write to a local variable that a `Block` of the view declares
 *   (`[(s := 2;) for n = 1..3]`). The inference of the effects of a function
 *   literal with `expr` as its body decides instead: it reports `scope` only
 *   for a write to a variable that the body does not declare (see "Scope
 *   writes" in `docs/EFFECTS-MODEL.md`);
 * - the runtime effects report `any` for a call of the index of an `Element`
 *   clause (`[q(1) for q in [a ↦ 0, a ↦ a + 5]]`): the index has no
 *   definition. The call of an index is pure only when each function that
 *   the source of the index can supply is proven pure
 *   (`indexCallVerdicts`). Such an index is a parameter of the function
 *   literal, and the inference does not count the call of an unannotated
 *   parameter. A call of any other index is an effect, tested first. That
 *   test does not use the inference: the preview can run in the scope of
 *   the view, where the index has a definition, and the inference then
 *   counts its call as pure (`[q(1) for q in [a ↦ H(a)]]` called `H`).
 */
function previewRunsEffect(expr: BoxedFunction): boolean {
  const ce = expr.engine;
  const verdicts = indexCallVerdicts(expr);
  for (const [index, pure] of verdicts)
    if (!pure && callsIndex(expr, index)) return true;
  const held = heldFunctionLiterals(expr);
  if (held === undefined || held.some((f) => !isPreviewPureLiteral(f)))
    return true;
  if (expr.isPure) return false;
  // The function literals of the view are proven pure above. The runtime
  // effects and the inference both project the effects of a literal at an
  // invoking position (the callback of a `Map`, of a `Tabulate`), and the
  // inference does not know the block locals of the literal, so each
  // literal is replaced by a literal with no body here.
  // The parameters are boxed `raw`: a canonical symbol would declare an
  // undeclared index in the current scope, and printing must not declare a
  // symbol.
  const literal = ce._fn('Function', [
    withoutLiteralBodies(expr),
    ...[
      ...[...verdicts].filter(([, pure]) => pure).map(([index]) => index),
      ...blockLocalParameters(expr, new Set(verdicts.keys())),
    ].map((name) => ce.box(name, { form: 'raw' })),
  ]);
  return !isPureEffectSet(inferFunctionLiteralEffects(ce, literal).effects);
}

/**
 * Whether the inferred effects of the function literal `f` are pure, when
 * the block locals of `f` are not counted (`blockLocalParameters`).
 *
 * The inference counts a write as confined after a `Declare` of the name,
 * or when the name is a local that the canonicalization of a `Block` made
 * for an assignment statement of the block (`withBlockLocals()`,
 * `effects-inference.ts`). An assignment in a `Block` to a name that no
 * outer scope declares makes a LOCAL of the block, also when the assignment
 * is not a statement of the block, but then the binding has no mark that
 * the inference reads, and the inference does not resolve a call of a
 * local. So in `k ↦ Block(If(k = 2, h := (z ↦ 2z)), h(k))` the write to `h`
 * and the call of `h` have no effect outside the call, but the inference
 * reports a write to an outer `h` and a call of an unknown function.
 */
function isPreviewPureLiteral(f: Expression): boolean {
  const ce = f.engine;
  if (isPureEffectSet(inferFunctionLiteralEffects(ce, f).effects)) return true;
  if (!isFunction(f, 'Function')) return false;
  const params = new Set(f.ops.slice(1).flatMap(functionLiteralParameterNames));
  const locals = blockLocalParameters(f, params);
  if (locals.length === 0) return false;
  const literal = ce._fn('Function', [
    ...f.ops,
    ...locals.map((name) => ce.box(name, { form: 'raw' })),
  ]);
  return isPureEffectSet(inferFunctionLiteralEffects(ce, literal).effects);
}

/**
 * The names bound in the scope of a `Block` of `expr`, other than those of
 * `exclude`, that can be parameters of a function literal with `expr` as its
 * body for the inference of its effects.
 *
 * A name bound in the scope of a block is a local of the block: an
 * assignment to a name that an outer scope declares writes the outer
 * binding, and the block scope does not bind that name (`canonicalBlock()`,
 * `library/control-structures.ts`). A parameter is confined at entry, so a
 * write to it is not an effect, and the inference does not count the call
 * of an unannotated parameter. A local that `expr` calls is a parameter only
 * when no `Declare` binds it and each assignment to it is a `Function`
 * literal, which `isPreviewPureLiteral` checks too: `h := H` followed by
 * `h(1)` calls `H`.
 */
function blockLocalParameters(
  expr: Expression,
  exclude: ReadonlySet<string>
): string[] {
  const names = new Set<string>();
  for (const block of expr.getSubexpressions('Block')) {
    const bindings = block.localScope?.bindings;
    if (bindings === undefined) continue;
    for (const [name, def] of bindings)
      if (isValueDef(def) && !exclude.has(name)) names.add(name);
  }
  const writes = (operator: string, name: string) =>
    expr
      .getSubexpressions(operator)
      .filter((x) => isFunction(x) && x.op1.symbols.includes(name));
  return [...names].filter(
    (name) =>
      !callsIndex(expr, name) ||
      (writes('Declare', name).length === 0 &&
        writes('Assign', name).every(
          (x) =>
            isFunction(x) && isSymbol(x.op1) && isFunction(x.op2, 'Function')
        ))
  );
}

/**
 * Whether `f`, an element of the source of a comprehension index, is a
 * function whose application is proven pure:
 * - a `Function` literal whose inferred effects are pure;
 * - the symbol of an operator definition that is pure: a library function
 *   (`Sin`), a function declared `pure: true`, or a user function whose
 *   inferred effects are pure;
 * - a symbol whose value is such a `Function` literal.
 *
 * So `[f(0) for f in [Sin, Cos]]` prints `[0, 1]`, while with `H` declared
 * `pure: false`, `[f(0) for f in [H]]` prints as written. Anything else (a
 * symbol with no definition, a call that returns a function) is not proven.
 */
function isPreviewPureFunction(ce: ComputeEngine, f: Expression): boolean {
  const pureLiteral = (x: Expression | undefined): boolean =>
    x !== undefined &&
    isFunction(x, 'Function') &&
    isPureEffectSet(inferFunctionLiteralEffects(ce, x).effects);
  if (pureLiteral(f)) return true;
  if (!isSymbol(f)) return false;
  const def = ce.lookupDefinition(f.symbol);
  if (def === undefined) return false;
  if (isOperatorDef(def)) return def.operator.pure;
  return isValueDef(def) && pureLiteral(def.value.value);
}

/** `expr`, with the body of each `Function` literal replaced by `Nothing`.
 * The parameters are kept. */
function withoutLiteralBodies(expr: Expression): Expression {
  if (!isFunction(expr)) return expr;
  const ce = expr.engine;
  if (expr.operator === 'Function')
    return ce._fn('Function', [ce.Nothing, ...expr.ops.slice(1)]);
  const ops = expr.ops.map(withoutLiteralBodies);
  if (ops.every((x, i) => x === expr.ops[i])) return expr;
  return ce._fn(expr.operator, ops);
}

/**
 * For each index of the `Element` clauses of `expr`, whether a call of the
 * index is proven pure: the index is one symbol, and its source is a `List`
 * or `Set` literal of functions that are proven pure
 * (`isPreviewPureFunction`). With `H` declared `pure: false`, a call of the
 * index of `[q(1) for q in [a ↦ H(a)]]` is not pure, and neither is a call
 * of an index whose source is a symbol, a view or any other expression: the
 * functions such a source supplies are not known before the evaluation. A
 * call of an index of two clauses is pure only when both clauses qualify.
 */
function indexCallVerdicts(expr: BoxedFunction): Map<string, boolean> {
  const ce = expr.engine;
  const verdicts = new Map<string, boolean>();
  for (const clause of expr.getSubexpressions('Element')) {
    if (!isFunction(clause)) continue;
    const source = clause.op2;
    const pure =
      isSymbol(clause.op1) &&
      (isFunction(source, 'List') || isFunction(source, 'Set')) &&
      source.ops.every((f) => isPreviewPureFunction(ce, f));
    for (const s of clause.op1.symbols)
      verdicts.set(s, pure && (verdicts.get(s) ?? true));
  }
  return verdicts;
}

/**
 * The most symbols that `heldFunctionLiterals()` follows from a symbol of
 * the view to the symbol whose value it reads.
 */
const HELD_VALUE_CHAIN_LIMIT = 16;

/**
 * The `Function` literals of `expr`, and those of the values of the symbols
 * of `expr`: with `fs := [a ↦ H(a)]`, the preview of `Map(w ↦ w(1), fs)`
 * calls the literal of `fs`. The values of the symbols in a value are read
 * too, at any depth: with `fs := gs` and `gs := [a ↦ H(a)]`, the preview
 * calls the literal of `gs`. Reading the value of a symbol does not
 * evaluate anything. Each symbol is read once, so a cycle (`p := q`,
 * `q := p`) ends.
 *
 * `undefined` when a chain of more than `HELD_VALUE_CHAIN_LIMIT` symbols
 * has a value at its end: the literals are then not known, and the caller
 * counts the view as not pure.
 */
function heldFunctionLiterals(expr: Expression): Expression[] | undefined {
  const ce = expr.engine;
  const literals = [...expr.getSubexpressions('Function')];
  const visited = new Set<string>();
  // Each entry is a symbol and the number of symbols on the chain from a
  // symbol of `expr` to it. The entries are read in order (breadth first),
  // so a symbol is read with its shortest chain.
  const pending: [string, number][] = expr.symbols.map((name) => [name, 1]);
  for (let i = 0; i < pending.length; i++) {
    const [name, depth] = pending[i];
    if (visited.has(name)) continue;
    visited.add(name);
    const def = ce.lookupDefinition(name);
    if (!isValueDef(def)) continue;
    const value = def.value.value;
    if (value === undefined || value === null) continue;
    if (depth > HELD_VALUE_CHAIN_LIMIT) return undefined;
    literals.push(...value.getSubexpressions('Function'));
    for (const next of value.symbols) pending.push([next, depth + 1]);
  }
  return literals;
}

/** Whether `expr` calls the symbol `name`: an application with `name` as
 * its operator (`q(1)`), or an `Apply` of it (`Apply(q, 1)`). */
function callsIndex(expr: Expression, name: string): boolean {
  if (expr.getSubexpressions(name).length > 0) return true;
  return expr
    .getSubexpressions('Apply')
    .some((x) => isFunction(x) && isSymbol(x.op1) && x.op1.symbol === name);
}

/**
 * Whether the materialization of the lazy view `expr` must wait until its
 * operands are evaluated: the operator evaluates its operands (it is not
 * `lazy`), and an operand that is typed as a collection is not a collection
 * value yet (`isHeldEagerSource`).
 *
 * The materialization step (step 3) runs before the operands are evaluated,
 * and the walk of such an operand cannot start, so `materialize()` returned
 * the view as written: `Reverse(At(t, 1)).evaluate({ materialization: true
 * })` was `Reverse(At(t, 1))`. When this is true, the step is skipped: the
 * operands are evaluated (step 4), and the view over their values is
 * materialized (`materializeLazyResult`, step 6b).
 *
 * The display preview is not included (see `heldEagerSources()`): printing
 * an expression must not evaluate its operands.
 */
function materializesAfterOperands(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options: Partial<EvaluateOptions> | undefined
): boolean {
  if (def.lazy === true) return false;
  if (isDisplayPreviewOf(expr, options)) return false;
  return expr.ops.some((x) => isTypedAsCollection(x) && isHeldEagerSource(x));
}

/**
 * Whether the type of `x`, without its absence option, is a collection type.
 *
 * An element read can be out of range, so its type can include `missing`:
 * with `t` an undeclared list of lists, `At(t, 1)` is typed
 * `missing | vector<integer^1> | vector<integer^3>`. That type does not
 * match a collection type, but every value of it that is present is a
 * collection. The type `missing` alone is not a collection type.
 */
function isTypedAsCollection(x: Expression): boolean {
  const t = stripMissingFromType(x.type.type);
  return t !== 'never' && isSubtype(t, COLLECTION_SHAPE_TYPE);
}

/**
 * The options an OPERAND is evaluated with: the caller's options, minus
 * `materialization`.
 *
 * That option describes the RESULT of the evaluation ("if the result is a
 * lazy collection, materialize it"; `EvaluateOptions`). Forwarded to the
 * operands, it materialized a lazy operand with no `evaluate` handler (a
 * `Range`, a lazy `Map`) into the DISPLAY preview — the first five and the
 * last five elements with a `ContinuationPlaceholder` between them — before
 * the operator's handler read it, and the handler then counted or searched
 * the preview: `Length(Range(1, 5000))` was `11`, `IndexOf(Range(1, 5000),
 * 4000)` was `0` and `Contains(Range(1, 5000), 4000)` was `False` under
 * `evaluate({ materialization: true })` (found 2026-09-29 by the fix for
 * issue #368). A handler reads a lazy operand through `each()`, `at()` and
 * `count`, so the lazy form is what it must receive. The result is still
 * materialized as asked: a lazy node with no handler goes through
 * `materialize()`, and a `List` literal materializes its elements in its own
 * handler, which reads the option from the handler options, not from the
 * operand evaluation.
 */
function operandOptions(
  options: Partial<EvaluateOptions> | undefined
): Partial<EvaluateOptions> | undefined {
  if (options === undefined || (options.materialization ?? false) === false)
    return options;
  return { ...options, materialization: false };
}

/** Memoized per SIGNATURE TYPE object, as `BROADCAST_SLOT_PLANS` is: the
 * positions are a pure function of the declared signature. `null` records
 * "no `integer` parameter", the common answer. */
const INTEGER_PARAMETER_POSITIONS = new WeakMap<
  object,
  ((index: number) => boolean) | null
>();

/**
 * The test "is the parameter at this position declared `integer` (or a
 * subtype) in EVERY arm of the signature of `def`", or `undefined` when no
 * position is. A position past the required and optional parameters reads
 * the variadic parameter. A signature with no parameter types (the bare
 * `function` type, an inferred lambda with unknown parameters) has no such
 * position. The position `-1`, which `holdMap()` gives to an operand lifted
 * out of a nested application of an associative operator, is never an
 * integer position.
 *
 * Under `.N()`, the operands at these positions are evaluated exactly
 * (`exactIntegerOperand()`): the handler reads them as integers, and a
 * float that was rounded to the working precision does not hold the
 * integer it stands for.
 */
function integerParameterPositions(
  def: BoxedOperatorDefinition
): ((index: number) => boolean) | undefined {
  const sig = def.signature?.type;
  if (sig === undefined || typeof sig === 'string') return undefined;
  const memo = INTEGER_PARAMETER_POSITIONS.get(sig);
  if (memo !== undefined) return memo ?? undefined;
  const arms = signatureArms(sig);
  const typeAt = (arm: FunctionSignature, i: number): Type | undefined => {
    const required = arm.args?.length ?? 0;
    if (i < required) return arm.args![i].type;
    const optional = arm.optArgs?.length ?? 0;
    if (i < required + optional) return arm.optArgs![i - required].type;
    return arm.variadicArg?.type;
  };
  const isIntegerAt = (i: number): boolean =>
    arms !== undefined &&
    arms.length > 0 &&
    arms.every((arm) => {
      const t = typeAt(arm, i);
      return t !== undefined && isSubtype(t, 'integer');
    });
  // The longest positional list of the arms bounds the positions to test;
  // a variadic parameter extends the last position to every later one.
  const width = Math.max(
    0,
    ...(arms ?? []).map(
      (arm) =>
        (arm.args?.length ?? 0) +
        (arm.optArgs?.length ?? 0) +
        (arm.variadicArg !== undefined ? 1 : 0)
    )
  );
  const positions: boolean[] = [];
  for (let i = 0; i < width; i++) positions.push(isIntegerAt(i));
  const variadic =
    arms !== undefined &&
    arms.length > 0 &&
    arms.every((arm) => arm.variadicArg !== undefined) &&
    positions[width - 1] === true;
  const result = positions.some((x) => x)
    ? (index: number) =>
        index < 0
          ? false
          : index < positions.length
            ? positions[index]
            : variadic
    : null;
  INTEGER_PARAMETER_POSITIONS.set(sig, result);
  return result ?? undefined;
}

/**
 * Under `.N()`, the value of the operand `x` at an `integer`-typed
 * parameter. The operand is evaluated ONCE, exactly. When the result is a
 * number literal, or a `List` or `Tuple` literal whose elements are all
 * number literals, it is returned as it is. Otherwise the numeric
 * approximation of that result is returned, as for any other operand.
 *
 * The handler reads such an operand as an integer (`toBigint`), and the
 * float of a large integer is rounded to the working precision before it
 * is read: `DigitSum(2^1000).N()` read the 302-digit operand at 21 digits
 * and gave 84 where the digit sum is 1366. An exact evaluation gives the
 * integer the handler needs; a float operand (`DigitSum(1234.0)`) is a
 * number literal too and is returned as it is. A list of number literals is
 * kept exact for the same reason: an operator that broadcasts over a list at
 * an integer parameter reads each element as an integer. A result that
 * stays symbolic (an unknown, an exact constant the handler cannot read) is
 * approximated numerically, so that an operator with a numeric fallback
 * keeps its answer.
 *
 * The numeric approximation is computed from the exact RESULT, not from the
 * written operand: evaluating the operand a second time would repeat its
 * effects (an assignment in a `Block`, a `Print`, a user operator with side
 * effects) and would cost a second evaluation.
 */
function exactIntegerOperand(
  x: Expression,
  options: Partial<EvaluateOptions> | undefined
): Expression {
  const exact = x.evaluate({
    ...(operandOptions(options) ?? {}),
    numericApproximation: false,
  });
  if (isExactIntegerOperandValue(exact)) return exact;
  return exact.evaluate({
    ...(operandOptions(options) ?? {}),
    numericApproximation: true,
  });
}

/** The asynchronous twin of `exactIntegerOperand()`: one exact evaluation,
 * then the numeric approximation of its result when it is not kept. */
async function exactIntegerOperandAsync(
  x: Expression,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression> {
  // The spread already copies the captured registry (`_effects`) and the
  // context stack; `_effects` is named again only so that the source-text
  // audit in `effects-registry.test.ts`, which reads the object literal,
  // finds it.
  const nested = operandOptions(options) ?? {};
  const exact = await x.evaluateAsync({
    ...nested,
    numericApproximation: false,
    _effects: nested._effects,
  });
  if (isExactIntegerOperandValue(exact)) return exact;
  return await exact.evaluateAsync({
    ...nested,
    numericApproximation: true,
    _effects: nested._effects,
  });
}

/** True when `x`, the exact value of an operand at an `integer`-typed
 * parameter, is passed to the handler as it is: a number literal, or a
 * `List` or `Tuple` literal whose elements are all number literals. */
function isExactIntegerOperandValue(x: Expression): boolean {
  if (isNumber(x)) return true;
  return (
    (isFunction(x, 'List') || isFunction(x, 'Tuple')) &&
    x.ops.every((op) => isNumber(op))
  );
}

/**
 * A handler's result, materialized when the caller asked for it and the
 * result is a LAZY collection: a view past the eager threshold
 * (`Insert(Range(1, 200), 2, 99)`, `Partition(Range(1, 300), 3)`), or a
 * `ListJoin` a spread literal folds to. Step 3 materializes a lazy node with
 * NO handler before its operands are evaluated; a node WITH a handler
 * reaches this point instead, and since its operands are evaluated without
 * the option (`operandOptions`), this is the only place the option can be
 * honored for such a result. Before the operands stopped materializing, these
 * views were only ever built over a preview and so materialized "by
 * accident", with the preview's content.
 */
/** The container literals whose elements the `materialization` option
 * descends into (`materializeLazyResult`). `List` is listed so that a list
 * NESTED in another container is evaluated again with the option; as a
 * result head its own `evaluate` handler has already materialized its
 * elements. */
const CONTAINER_LITERAL_HEADS: ReadonlySet<string> = new Set([
  'Tuple',
  'Pair',
  'Triple',
  'Set',
  'List',
]);

function materializeLazyResult(
  result: Expression,
  options: Partial<EvaluateOptions> | undefined,
  elementsMaterialized = false
): Expression {
  if ((options?.materialization ?? false) === false) return result;
  const failure: WalkFailure = {};
  return unlessWalkFailed(
    result,
    runMaterialization(
      lazyResultSteps(result, options, elementsMaterialized),
      options,
      failure
    ),
    failure
  );
}

/** The asynchronous twin of `materializeLazyResult()`: each element is
 * evaluated with `evaluateAsync()` (see `materializeAsync()`). */
function materializeLazyResultAsync(
  result: Expression,
  options: Partial<EvaluateOptions> | undefined,
  elementsMaterialized = false
): Promise<Expression> {
  if ((options?.materialization ?? false) === false)
    return Promise.resolve(result);
  const failure: WalkFailure = {};
  return runMaterializationAsync(
    result.engine,
    lazyResultSteps(result, options, elementsMaterialized),
    options,
    failure
  ).then((value) => unlessWalkFailed(result, value, failure));
}

/**
 * Whether the handler of `operator` (definition `def`) already evaluated
 * each element of its container literal `result` with the options of the
 * evaluation, `materialization` included. This is true of the `List` and
 * `Set` literals: they are `lazy`, and their handlers evaluate each element
 * with the options. The elements of such a result are not evaluated again
 * (`lazyResultSteps()`): each level of `[[[…]]]` evaluated its nested list a
 * second time, so the cost doubled with each level of nesting.
 */
function handlerMaterializedElements(
  def: BoxedOperatorDefinition,
  operator: string,
  result: Expression
): boolean {
  return (
    def.lazy === true &&
    result.operator === operator &&
    CONTAINER_LITERAL_HEADS.has(operator)
  );
}

/** The steps of `materializeLazyResult()`: see `MaterializationSteps`.
 * `elementsMaterialized` is true when the handler that computed `result`
 * already evaluated its elements with the options
 * (`handlerMaterializedElements()`). */
function* lazyResultSteps(
  result: Expression,
  options: Partial<EvaluateOptions> | undefined,
  elementsMaterialized: boolean
): MaterializationSteps {
  if (!(result instanceof BoxedFunction)) return result;
  // A container LITERAL's elements are part of the result, so the option
  // descends into them: `(Take(xs, 3), 1)` is a pair holding the
  // materialized list (the Epsil CLI's `--json` output relies on this,
  // `src/cli/format.ts`). The elements were evaluated as operands, without
  // the option; a lazy element, or a nested container, is evaluated again
  // with it. A `List` literal does this in its own handler, and a lazy `Set`
  // (a comprehension) is a view, materialized below, not a literal. A
  // dictionary element is evaluated again too: its evaluation evaluates
  // each value with the options, so a lazy value (`Range(1, 200)`) is
  // materialized.
  if (
    CONTAINER_LITERAL_HEADS.has(result.operator) &&
    !result.isLazyCollection
  ) {
    if (elementsMaterialized) return result;
    const descends = (op: Expression) =>
      op.isLazyCollection ||
      CONTAINER_LITERAL_HEADS.has(op.operator) ||
      isDictionary(op);
    if (!result.ops.some(descends)) return result;
    const ops: Expression[] = [];
    for (const op of result.ops) ops.push(descends(op) ? yield op : op);
    return result.engine.function(result.operator, ops);
  }
  if (!result.isLazyCollection) return result;
  // A held conditional over a collection (`[5, 10] {0 < t}`, a `When` whose
  // guard is not decided) is a lazy collection too, but it is a HELD form,
  // not a view: walking it reads its restricted cells and builds a `Set` of
  // them (`holdsConditionalValue`, `collection-utils.ts`, names the same
  // three heads). Left as it is, it prints as the held list with its guard.
  const h = result.operator;
  if (h === 'When' || h === 'Which' || h === 'If') return result;
  const def = result.operatorDefinition;
  if (def === undefined) return result;
  return yield* materializationSteps(result, def, options);
}

/**  Eagerly evaluate xs by iterating over its elements.
 *
 * If the `materialization` option is `true` and the collection is finite,
 * evaluate every element. A finite collection with more elements than
 * `engine.maxCollectionSize` stays in its lazy form. An infinite collection,
 * or one whose finiteness is not known, cannot be walked to its end, so it
 * gets the display preview (`DISPLAY_MATERIALIZATION`) instead.
 *
 * Each element is evaluated with the same options, so with `true` an element
 * that is itself a finite lazy collection is also fully materialized. The
 * total cost can reach `maxCollectionSize²` element evaluations. This is
 * intended: the option promises the full result.
 *
 * If the option is a number, evaluate that many elements, half in the head
 * and half in the tail.
 *
 * If the option is a tuple [head, tail], evaluate that many elements in the
 * head and that many elements in the tail.
 */
function materialize(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options?: Partial<EvaluateOptions>
): Expression {
  const failure: WalkFailure = {};
  return unlessWalkFailed(
    expr,
    runMaterialization(
      materializationSteps(expr, def, options),
      options,
      failure
    ),
    failure
  );
}

/**
 * The error of the first walk that failed (`noteFailedWalk()`) in a step of
 * a materialization (`measureWalkFailure()`).
 */
type WalkFailure = { error?: Expression };

/**
 * Run `step`, one synchronous step of a materialization (a pull from the
 * walk of the collection), and keep in `failure` the error of a walk that
 * failed during it. Only the steps are measured, not the evaluation of the
 * elements between them. On the asynchronous route, the evaluation of an
 * element can `await`, and another evaluation can then record a failed walk
 * of its own: that record is not read here, because no step runs during
 * the `await`.
 */
function measureWalkFailure<T>(
  failure: WalkFailure | undefined,
  step: () => T
): T {
  if (failure === undefined || failure.error !== undefined) return step();
  const before = incompleteWalkCount();
  try {
    return step();
  } finally {
    const error = failedWalkErrorSince(before);
    if (isExpression(error)) failure.error = error;
  }
}

/**
 * The result of the materialization of `expr`, or the error of a walk that
 * failed during it (`failure`, see `measureWalkFailure()`) when the
 * materialization kept the lazy form. A comprehension over a domain that is
 * an error value has that error as its value: its materialization is the
 * error, not the comprehension as written.
 */
function unlessWalkFailed(
  expr: Expression,
  result: Expression,
  failure: WalkFailure
): Expression {
  if (result !== expr || failure.error === undefined) return result;
  return failure.error;
}

/**
 * The asynchronous twin of `materialize()`: each element is evaluated with
 * `evaluateAsync()`. The synchronous iterator of a view cannot run an
 * operator that has only an `evaluateAsync` handler: the elements of
 * `Map(AsyncOnly, [1, 2])` are the applications `AsyncOnly(1)` and
 * `AsyncOnly(2)`, and `evaluate()` leaves them as they are. With this, they
 * are awaited, and the list holds their values.
 */
function materializeAsync(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options?: Partial<EvaluateOptions>
): Promise<Expression> {
  const failure: WalkFailure = {};
  return runMaterializationAsync(
    expr.engine,
    materializationSteps(expr, def, options),
    options,
    failure
  ).then((value) => unlessWalkFailed(expr, value, failure));
}

/**
 * The steps of a materialization. The walk is written once for the
 * synchronous and the asynchronous routes: it yields each element that must
 * be evaluated, and it receives the value of that element back.
 * `runMaterialization()` evaluates the elements with `evaluate()`, and
 * `runMaterializationAsync()` with `evaluateAsync()`. An error that the
 * evaluation of an element throws is thrown into the walk at the `yield`, so
 * the walk handles it as it handles an error of its own iterator.
 */
type MaterializationSteps<R = Expression> = Generator<
  Expression,
  R,
  Expression
>;

/** The steps of the conditional-value lift (`threadConditionalOperands`):
 * the same protocol as `MaterializationSteps`, with `undefined` as the
 * result when there is nothing to lift. */
type ConditionalThreadingSteps = MaterializationSteps<Expression | undefined>;

/** Run the steps of a materialization, and evaluate each element that they
 * yield with `evaluate(options)`. */
function runMaterialization<R>(
  steps: MaterializationSteps<R>,
  options: Partial<EvaluateOptions> | undefined,
  failure?: WalkFailure
): R {
  let step = measureWalkFailure(failure, () => steps.next());
  while (!step.done) {
    let value: Expression;
    try {
      value = step.value.evaluate(options);
    } catch (e) {
      step = measureWalkFailure(failure, () => steps.throw(e));
      continue;
    }
    const received = value;
    step = measureWalkFailure(failure, () => steps.next(received));
  }
  return step.value;
}

/** Run the steps of a materialization, and evaluate each element that they
 * yield with `evaluateAsync(options)`. The walk resumes after an `await`, and
 * its iterator applies the callbacks of the view synchronously, so each
 * resumption runs in the evaluation context that `options` carry
 * (`withEvaluationContext()`): the host capability registry and the scopes
 * of the enclosing scoped operators. */
async function runMaterializationAsync<R>(
  ce: ComputeEngine,
  steps: MaterializationSteps<R>,
  options: Partial<EvaluateOptions> | undefined,
  failure?: WalkFailure
): Promise<R> {
  let step = measureWalkFailure(failure, () =>
    ce.withEvaluationContext(options, () => steps.next())
  );
  while (!step.done) {
    let value: Expression;
    try {
      value = await step.value.evaluateAsync(options);
    } catch (e) {
      step = measureWalkFailure(failure, () =>
        ce.withEvaluationContext(options, () => steps.throw(e))
      );
      continue;
    }
    const received = value;
    step = measureWalkFailure(failure, () =>
      ce.withEvaluationContext(options, () => steps.next(received))
    );
  }
  return step.value;
}

/**
 * The value of `incompleteWalkCount()` before a call of the `evaluate`
 * handler of `def`, or `undefined` when the result of the handler is not
 * measured (see {@link handlerWalkMissedElements}).
 *
 * The result of a handler that walked a collection and met an inner
 * collection that it could not walk (`incomplete-walks.ts`) is not used: the
 * handler read a walk that missed elements, so its answer can be wrong
 * (`Sum(Take(FlatMap([1, 2], x ↦ Join([x], v)), 3))` was `0` for a valueless
 * `v`), and the operator stays unevaluated. This applies to every handler
 * that walks a collection, so each handler does not have to measure its own
 * walk.
 *
 * Only a handler with a collection operand is measured: a handler with no
 * collection operand (`Factorial`, `Add` of numbers) walks no collection of
 * its own, and an incomplete walk in an expression that it evaluates is not
 * a reason to discard its result.
 *
 * Two kinds of handler are not measured, because they evaluate expressions
 * whose own reads stay unevaluated after an incomplete walk, and the result
 * that holds such a read is correct:
 * - the handler of a `lazy` operator evaluates its operands itself (`If`,
 *   `Block`, `Assign`). To discard its result would also run its side
 *   effects again at the next evaluation. A lazy operator that walks a
 *   collection measures its own walk (`Any`, `All`, with `MeasuredWalk`);
 * - a user function (`isUserFunctionDefinition`) evaluates its body.
 *
 * A nested evaluation whose result is a value (a number, `x + Sum(…)`)
 * takes back the incomplete walks that it recorded (`evaluate()`), so the
 * callback of a measured handler (`GroupBy([1, 2, 3], x ↦ x + Sum(…))`)
 * does not make the handler discard its result.
 */
function walksMeasuredBy(
  def: BoxedOperatorDefinition,
  operands: ReadonlyArray<Expression>
): number | undefined {
  if (def.lazy === true || def.isUserFunctionDefinition) return undefined;
  if (!operands.some(isCollectionOperand)) return undefined;
  return incompleteWalkCount();
}

/** True when `op` is a collection, or an expression of a collection type
 * (a valueless symbol declared `list<integer>`). */
function isCollectionOperand(op: Expression): boolean {
  if (isNumber(op)) return false; // a number literal is never a collection
  return op.isCollection || op.type.matches('collection<any>');
}

/**
 * True when the result of a nested evaluation is a value that its caller
 * cannot walk again to reach the elements that an incomplete walk missed: a
 * result that is not a collection (`2 + Sum(Take(…))`, a number), or a `List`
 * or `Tuple` literal whose elements are values.
 *
 * Such an evaluation takes back the incomplete walks that it recorded
 * (`takeBackIncompleteWalks()`): its result is correct, and an unevaluated
 * read in it is a correct result too. A result that is another collection
 * (`Sort(FlatMap(…))` unevaluated, a lazy view) keeps them: a caller that
 * walks it reads it through an evaluation that can yield nothing
 * (`BoxedFunction.each()` evaluates an eager source), and the caller must
 * know that the walk missed elements.
 */
function resultHoldsNoIncompleteWalk(result: Expression): boolean {
  if (result.operator === 'List' || result.operator === 'Tuple')
    return result.isLazyCollection !== true;
  return !isCollectionOperand(result);
}

/** True when an incomplete walk was recorded after `walksBefore`, the value
 * that {@link walksMeasuredBy} gave before the call of the handler. */
function handlerWalkMissedElements(walksBefore: number | undefined): boolean {
  return walksBefore !== undefined && incompleteWalkCount() !== walksBefore;
}

/**
 * The value of `incompleteWalkCount()` before a call of the `evaluate`
 * handler of `def`, for a handler whose decline (an `undefined` answer) is
 * replaced by the error of a walk that failed during the call
 * (`handlerWalkFailure()`), or `undefined` for a user function.
 *
 * This applies to the handlers that {@link walksMeasuredBy} does not
 * measure: a `lazy` operator that walks a collection (`Sum` over a
 * comprehension whose domain is an error value) declines when the walk
 * misses elements, and the error is then its value. A handler that answers
 * keeps its answer: a nested evaluation that met the failed walk gave the
 * error as its own value. A user function evaluates its body, which
 * answers.
 */
function failedWalksMeasuredBy(
  def: BoxedOperatorDefinition
): number | undefined {
  if (def.isUserFunctionDefinition) return undefined;
  return incompleteWalkCount();
}

/**
 * The error of a walk that failed after `walksBefore` (`noteFailedWalk()`),
 * or `undefined`. A handler that read such a walk answers this error: the
 * collection it read has the error as its value (a comprehension over a
 * domain that is an error value). Any other walk that missed elements gives
 * `undefined`, and the operator stays unevaluated.
 */
function handlerWalkFailure(
  walksBefore: number | undefined
): Expression | undefined {
  if (walksBefore === undefined) return undefined;
  const error = failedWalkErrorSince(walksBefore);
  return isExpression(error) ? error : undefined;
}

/**
 * A walk of a collection that can be started again: a new walk gives first
 * the elements that the earlier walks pulled from the iterator, then pulls
 * the next ones from the same iterator. So the callbacks of the collection
 * (the function of a `Map` or of a `FlatMap`) are applied once for each
 * element, even when the materialization walks the collection more than
 * once. An error of the iterator is given again to each later walk at the
 * same place.
 *
 * Ending a walk before the end (a `break`) closes the iterator, so a walk
 * that is ended this way must be the last one.
 *
 * `incomplete` is true when a pull from the iterator met an inner collection
 * that the iterator could not walk (`incomplete-walks.ts`): the walk then
 * misses elements, and its elements are not the elements of the collection.
 * Only the pulls are measured, so an evaluation of an element between two
 * pulls does not count.
 */
class RepeatableWalk {
  private readonly pulled: Expression[] = [];
  private ended = false;
  private failed = false;
  private error: unknown;
  incomplete = false;

  constructor(private readonly iter: Iterator<Expression>) {}

  /**
   * A walk of `expr`. The call of `expr.each()` is measured too, because the
   * iterator of some views pulls from its source when it is made (the
   * iterator of `Differences` reads the first element of its source).
   */
  static of(expr: Expression): RepeatableWalk {
    const before = incompleteWalkCount();
    const walk = new RepeatableWalk(expr.each());
    if (incompleteWalkCount() !== before) walk.incomplete = true;
    return walk;
  }

  walk(): IterableIterator<Expression> {
    let i = 0;
    const next = (): IteratorResult<Expression> => {
      if (i < this.pulled.length)
        return { done: false, value: this.pulled[i++] };
      if (this.failed) throw this.error;
      if (this.ended) return { done: true, value: undefined };
      let step: IteratorResult<Expression>;
      const before = incompleteWalkCount();
      try {
        step = this.iter.next();
      } catch (e) {
        this.ended = this.failed = true;
        this.error = e;
        throw e;
      } finally {
        if (incompleteWalkCount() !== before) this.incomplete = true;
      }
      if (step.done) {
        this.ended = true;
        return { done: true, value: undefined };
      }
      this.pulled.push(step.value);
      i += 1;
      return step;
    };
    const walk: IterableIterator<Expression> = {
      next,
      return: () => {
        this.close();
        return { done: true, value: undefined };
      },
      [Symbol.iterator]: () => walk,
    };
    return walk;
  }

  /** Close the iterator, when it has not ended. */
  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.iter.return?.(undefined);
  }
}

/**
 * When the materialization of a collection whose `isEmpty` facet gives no
 * answer can go on, because a walk of the collection decides the emptiness:
 * the walk, which has pulled the first element. Otherwise, `undefined`.
 *
 * Some facets give no answer because the answer needs a callback, and a
 * facet does not apply one: the emptiness of `FlatMap([1, 2, 3], x ↦ [x, x])`
 * depends on the results of its callback, so the emptiness of
 * `Take(FlatMap([1, 2, 3], x ↦ [x, x]), 3)` is not known either, and the
 * `Take` stayed unevaluated. Materialization applies the callbacks anyway, so
 * it can pull the first element itself. It then continues the same walk
 * (`RepeatableWalk`), so a callback that is not pure is not applied again to
 * the first element.
 *
 * This is done only for a collection that is known to be finite and
 * enumerable. A first element decides that the collection is not empty. An
 * iterator that ends at once decides that the collection is empty
 * (`Take(FlatMap([1, 2], x ↦ []), 1)` is `[]`): a collection that claims to
 * be enumerable yields all its elements. Each view must keep this contract
 * also over a finite source with no count, or with a `bigint` count:
 * - a view that reads its source by a position computed from the count of
 *   the source (`Reverse`, `Most`, `RotateLeft`, `RotateRight`) yields
 *   nothing then, so it claims not to be enumerable then
 *   (`enumerableFromSmallSource()`, `library/collections.ts`). `Cycle`
 *   reads its source in order instead (`cycleWalk()`, same file);
 * - a view that reads its source at a positive position (`Take`, `Drop`,
 *   `Rest` read their source with `at()`) needs an `at()` that gives each
 *   element with no count. The windows of `Partition` and `SlidingWindow`
 *   (`windowedCollectionOps()`, `collection-utils.ts`) are read from the
 *   positions of the source for this reason: when they needed the count,
 *   `Take(Partition(FlatMap([1, 2, 3], x ↦ [x, x]), 2), 1)` was `[]`.
 *
 * The walk does not decide, and the lazy form stays, when:
 * - the walk met an inner collection that it could not walk
 *   (`RepeatableWalk.incomplete`): the `FlatMap` of a callback that returns
 *   `Join([x], v)` for a valueless `v`. Its walk misses the elements of `v`,
 *   so an empty walk is not an empty collection;
 * - the walk gives up with `iteration-limit-exceeded` (a `Filter` with a long
 *   run of rejected elements).
 */
function walkDecidesEmptiness(expr: Expression): RepeatableWalk | undefined {
  if (expr.isFiniteCollection !== true) return undefined;
  if (expr.isEnumerableCollection !== true) return undefined;
  const walk = RepeatableWalk.of(expr);
  try {
    walk.walk().next();
    if (walk.incomplete) {
      walk.close();
      return undefined;
    }
    return walk;
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
}

/** The steps of `materialize()`: see `MaterializationSteps`. */
function* materializationSteps(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options?: Partial<EvaluateOptions>
): MaterializationSteps {
  // A view whose only errors sit in the cells of a `List` or `Set` literal
  // is materialized like a valid one: each element it gives is a value,
  // the failed cell included (`Reverse([1, <error>])` is `[<error>, 1]`).
  if (isInvalidNonCollection(expr) || options?.materialization === false)
    return expr;

  // A view that reads its source by a position computed from the count of
  // the source (`Reverse`, `Most`, `RotateLeft`, `RotateRight`) cannot walk a
  // finite source with no count (`FlatMap([1, 2, 3], x ↦ [x, x])`). The
  // source is listed ONCE, and the same view over that list is materialized
  // (`viewOverListedSource()`). Reading the source from the end one index at
  // a time would walk it again for each element.
  const listedView = viewOverListedSource(expr);
  if (listedView === null) return expr;
  if (listedView instanceof BoxedFunction)
    return yield* materializationSteps(listedView, def, options);

  // Emptiness indeterminate (e.g. Range(1, n) with a symbolic bound): the
  // collection cannot be enumerated, so fabricating a literal would collapse
  // it (previously to the 1-element list [1]). Keep the lazy form, unless a
  // walk can decide the emptiness (`walkDecidesEmptiness`). The walks below
  // then continue that walk.
  let walk: RepeatableWalk | undefined;
  if (expr.isEmptyCollection === undefined) {
    walk = walkDecidesEmptiness(expr);
    if (walk === undefined) return expr;
  }

  // A source that provably cannot be walked yet — a collection-typed symbol
  // with no value (`Join([1], v)` for a declared, unassigned `v`) — yields
  // nothing from `each()`, and a walk over nothing is indistinguishable from
  // a walk that found nothing: the literal built from it would silently DROP
  // that operand (`Join([1], v)` answered `[1]`, `Append(v, 2)` answered
  // `[2]`). The emptiness gate above does not catch this, because a `Join`
  // with one literal non-empty operand is provably non-empty. Keep the lazy
  // form, exactly as `Length(v)` and `Reverse(v)` stay symbolic. A view that
  // is provably EMPTY is exempt: `Zip([], v)` cannot be walked either, but
  // its literal is `[]` whatever `v` turns out to hold.
  if (expr.isEmptyCollection !== true && expr.isEnumerableCollection === false)
    return expr;

  const option = options?.materialization ?? false;

  // Static-type indexed-ness, with a value-aware fallback: a lazy wrapper
  // over a declared-`unknown` symbol holding an indexed collection (e.g. a
  // `Filter(L, …)` whose type is its source's `unknown`) sheds indexed-ness
  // statically — without the fallback its preview would render with a
  // misleading `Set` head and no tail. The fallback only applies when the
  // static type is indeterminate, and consults the SOURCE operand's
  // value-aware indexed-ness (a symbol holding a `List` reports indexed; one
  // holding a `Set` does not) — NOT an `at(1)` probe, which misclassifies
  // operators like `Filter` that answer `at` by sequential scan over
  // non-indexed sources.
  //
  // A static type that is an ABSTRACT collection (`collection<T>` over a
  // symbol declared with that type) is resolved by `isIndexedCollection`
  // itself, from the values the operands hold now.
  const t = expr.type.type;
  const isIndexed =
    expr.isIndexedCollection ||
    ((t === 'unknown' || t === 'any' || t === 'value') &&
      def.collection?.at !== undefined &&
      expr.nops > 0 &&
      expr.op1.isIndexedCollection === true);
  const isFinite = expr.isFiniteCollection;

  // `true` asks for EVERY element of a finite collection (issue #380: it
  // used to give the 5 + 5 display preview, which the option's documentation
  // does not describe). The walk is bounded by `maxCollectionSize`: a
  // collection that turns out to be larger stays lazy, as an indexed one
  // with a known count larger than the cap does below.
  const full = option === true && isFinite === true;
  const materialization: number | readonly [number, number] = full
    ? expr.engine.maxCollectionSize
    : typeof option === 'boolean'
      ? DISPLAY_MATERIALIZATION
      : option;

  // Leave oversized indexed collections in their lazy form. Consumers
  // can detect the size via `.count` without risking OOM.
  if (isIndexed && isFinite) {
    const count = expr.count;
    if (count !== undefined && count > expr.engine.maxCollectionSize) {
      walk?.close();
      return expr;
    }
  }

  // A full materialization of a collection with no known count must not
  // evaluate up to `maxCollectionSize` elements and then discard them when
  // the collection turns out to be larger. Count the elements first, without
  // evaluating them, and stop at the cap. The walk below gives the same
  // elements again, without pulling them from the iterator again
  // (`RepeatableWalk`), and evaluates them. A walk that gives up with `iteration-limit-exceeded` (an
  // unbroken run of duplicates, or a keyed merge over an element that is not
  // an entry) is not a size result: the walk below meets the same
  // cancellation and handles it.
  if (full && !expr.isEmptyCollection && expr.count === undefined) {
    const cap = expr.engine.maxCollectionSize;
    let n = 0;
    walk ??= RepeatableWalk.of(expr);
    try {
      for (const _ of walk.walk()) {
        n += 1;
        if (n > cap) return expr;
      }
    } catch (e) {
      if (
        !(e instanceof CancellationError) ||
        e.cause !== 'iteration-limit-exceeded'
      )
        throw e;
    }
    // A walk that missed elements (see `RepeatableWalk.incomplete`) cannot
    // give the full list.
    if (walk.incomplete) return expr;
  }

  const xs: Expression[] = [];

  if (!expr.isEmptyCollection) {
    // The head+tail rendering needs the exact `count` (it indexes the tail
    // from the end). A collection can be provably FINITE without knowing its
    // count — `Take(xs, 10)` over a source that may exhaust early, a `Filter`
    // of a finite list — and there the head+tail branch fabricated a trailing
    // `ContinuationPlaceholder` for a collection that had already ended.
    // Finiteness and exact count are separate questions: fall back to the
    // head-only walk, which probes the iterator for a genuine continuation.
    if (full || !isIndexed || !isFinite || expr.count === undefined) {
      //
      // If we're not indexed, or not finite (or of unknown length), we can
      // only materialize the head
      //
      const last =
        typeof materialization === 'number'
          ? materialization
          : materialization[0];
      // The walk is a `RepeatableWalk` also when no walk was started above,
      // so that a walk that missed elements is detected below.
      walk ??= RepeatableWalk.of(expr);
      const iter = walk.walk();
      try {
        for (const x of iter) {
          if (xs.length === last) {
            // A full materialization that reaches the size cap leaves the
            // collection lazy rather than returning a truncated list.
            if (full) return expr;
            // Reaching another element with the head already full means the
            // collection continues past the preview, so mark the tail. `x`
            // ITSELF is that element — testing `iter.next()` instead asked
            // about the element AFTER `x`, so a collection of exactly
            // `last + 1` elements dropped its final one and reported no
            // continuation at all (a 6-element lazy set previewed as 5
            // elements with no `...`).
            xs.push(expr.engine.symbol('ContinuationPlaceholder'));
            break;
          }
          xs.push(yield x);
        }
      } catch (e) {
        // A deduplicating enumeration gives up on an unbroken run of
        // duplicates (`Join(Set(1), Repeat(1))`, `Map(x -> 1, Integers)`) by
        // throwing `iteration-limit-exceeded`. A walk that cannot get past
        // such a run IS a continuation, which is exactly what the placeholder
        // means, so the preview ends with `...` rather than propagating the
        // cancellation. Letting it escape made `evaluate()` THROW and
        // `toString()` render an error string for expressions that had
        // previewed fine — and reaching this walk at all is new, because the
        // explicit `isEmpty`/`isFinite` handlers these operators now declare
        // stopped `materialize()` bailing early on an undefined emptiness.
        // Any other cancellation (deadline/timeout) still propagates.
        if (
          !(e instanceof CancellationError) ||
          e.cause !== 'iteration-limit-exceeded'
        )
          throw e;
        // A keyed merge (a `Join` or `Append` that adopts the dictionary kind
        // of an operand) gives up on an element that is not a key-value
        // entry, and attaches that element as the error's `value`
        // (`keyedMergeIterator`, `library/collections.ts`). That is not a
        // continuation: the collection cannot be formed at all. Answer a
        // type error that names the element. A placeholder here made the
        // `Dictionary` built below report the internal
        // `ContinuationPlaceholder` symbol as the offending entry.
        if (isExpression(e.value))
          return expr.engine.typeError(
            parseType('tuple<string, any>'),
            e.value.type,
            e.value
          );
        xs.push(expr.engine.symbol('ContinuationPlaceholder'));
      }
      // A walk that missed elements gives the wrong elements: the
      // `FlatMap` of a callback that returns `Join([x], v)` for a valueless
      // `v` listed `[1, 2]` for the elements of `v` too. Keep the lazy form.
      if (walk.incomplete) return expr;
    } else {
      //
      // We are indexed and finite, so we can materialize the head and tail
      //
      const [headSize, tailSize]: readonly [number, number] =
        typeof materialization === 'number'
          ? [
              Math.ceil(materialization / 2),
              materialization - Math.ceil(materialization / 2),
            ]
          : materialization;

      // Materialize the head
      let i = 1;
      const iter = walk?.walk() ?? expr.each();
      for (const x of iter) {
        xs.push(yield x);
        i += 1;
        if (i > headSize) break;
      }

      // Nothing enumerable despite claiming elements (e.g. Linspace with a
      // symbolic endpoint: concrete count, but its iterator declines): keep
      // the lazy form rather than fabricate a placeholder literal.
      if (xs.length === 0) return expr;

      const count = smallCount(expr);
      if (count === undefined || count <= headSize) {
        // If the collection is smaller than the head, we don't need to evaluate the tail
        if (count === undefined || xs.length < count)
          xs.push(expr.engine.symbol('ContinuationPlaceholder'));
      } else {
        // Materialize the tail
        // Ensure tail doesn't overlap with head and add ContinuationPlaceholder if needed
        const tailStartIndex = Math.max(headSize + 1, count - tailSize + 1);

        // Add ContinuationPlaceholder if there's a gap between head and tail
        if (count > headSize + tailSize) {
          xs.push(expr.engine.symbol('ContinuationPlaceholder'));
        }

        i = tailStartIndex;
        while (i <= count) {
          const x = expr.at(i);
          if (!x) break;
          xs.push(yield x);
          i += 1;
        }
      }
    }
  }

  // A collection that claims elements but yielded none cannot be enumerated
  // (e.g. Linspace with a symbolic endpoint, whose iterator declines): keep
  // the lazy form rather than fabricate an empty or placeholder literal.
  if (xs.length === 0 && expr.isEmptyCollection === false) return expr;

  //
  // Convert to a List, Set or Dictionary depending on the type of
  // the collection.
  //

  const elttype = def.collection?.elttype?.(expr);
  if (elttype && isSubtype(elttype, 'tuple<string, any>')) {
    // If the collection is a collection of key-value pairs,
    // we convert it to a Dictionary
    return expr.engine.function('Dictionary', xs);
  }

  // An element of a lazy indexed view that is `Nothing` (the result of a
  // `Map` callback that answers `Nothing`) is an element of the view: the
  // view counts it (`Length`), and `at()` and `each()` give it. So the
  // display preview of the view (`toString()`, the `latex` getter,
  // `toLatex()` with no `materialization` option) keeps it, in its position:
  // `Map(x ↦ If(x > 1, Nothing, x), [1, 2])` prints `[1, Nothing]`, not `[1]`
  // (user decision 2026-10-20). `_fn` builds that preview list without the
  // canonical form of a `List` literal, which erases a `Nothing` element.
  //
  // Any other materialization (`evaluate({ materialization: true })`, an
  // explicit bound) turns the view into a list, and a list erases a
  // `Nothing` element as a list literal does (`[1, Nothing]` is `[1]`).
  // Keeping it there gave a list that printed two elements but counted one,
  // because the collection handlers of a `List` read it as a literal whose
  // `Nothing` elements are erased. A `Set` has no positions, and always
  // erases it.
  if (isIndexed && isDisplayPreviewOf(expr, options))
    return expr.engine._fn('List', xs);

  // `Nothing` is an ERASURE marker: a lazy stream element that materialized
  // as `Nothing` is spliced out of the resulting collection (§3.G).
  // `Missing` is preserved. (The `ContinuationPlaceholder` sentinel is not
  // `Nothing`, so it survives.)
  const materialized = xs.filter((x) => !isSymbol(x, 'Nothing'));

  if (isIndexed) return expr.engine._fn('List', materialized);

  return expr.engine.function('Set', [...materialized]);
}

/**
 * Whether `type` is a collection type that does not fix the kind of its
 * value: it matches `collection<any>`, but it is not an indexed collection, a
 * set, a dictionary or a record. A value of such a type may be a list, a set
 * or a range. The test is the one on plain types, `isAbstractCollectionTypeOf`
 * (`broadcast-lift-type.ts`), applied to the type the boxed type holds; the
 * bottom type `never` answers `false` (it has no value, so there is no kind
 * to decide).
 */
function isAbstractCollectionType(type: BoxedType): boolean {
  return isAbstractCollectionTypeOf(type.type);
}

/**
 * Whether the SOURCES of `expr` hold indexed collection values now. A source
 * is an operand whose own static type is an abstract collection
 * (`isAbstractCollectionType`), or a type that says nothing (`unknown`,
 * `any`, `value`, see `isKindOpenOperandType`): those operands are what left
 * the kind of the node undecided. An operand with a concrete type does not
 * decide anything here, because the node's static type already accounts for
 * it.
 *
 * A symbol answers from the value it holds, not from its declared type, so a
 * symbol declared `collection<number>` that holds `[3, 1, 1]` answers `true`
 * and one that holds `Set(3, 1)` answers `false`. A source that holds no
 * value yet answers `false`: nothing says that it will hold a list. The
 * answer is `false` too when there is no source.
 *
 * Only the operands in the source positions of the operator are read
 * (`collectionSourceOperands`): the appended elements of an `Append` and the
 * seed of a `Scan` are not sources, even when their type is an abstract
 * collection.
 */
function abstractSourcesHoldIndexedValues(expr: BoxedFunction): boolean {
  let found = false;
  for (const op of collectionSourceOperands(expr)) {
    if (!isKindOpenOperandType(op.type.type)) continue;
    if (op.isIndexedCollection !== true) return false;
    found = true;
  }
  return found;
}

// The descriptor route's broadcast lift reads three things about an
// operator definition that are defined in this module (see
// `installBroadcastLiftHooks` for why they are installed rather than
// imported).
installBroadcastLiftHooks({
  mappableSlot: (def) => {
    const slots = broadcastableParamSlots(def);
    return slots === undefined ? 'no-plan' : (i) => slots.at(i).mappable;
  },
  broadcastsOverTuples,
  typesTupleArmsAsCells,
  // The same gate as the expression route's: only a lambda-literal
  // definition is kept out of the shared arms (it has its own broadcast arm
  // there); a user-defined operator goes through them.
  isLambda: (def) => isLambdaDef(def),
});

/**
 * The final map of a numeric approximation: an `Indeterminate` result is the
 * float `NaN`. A numeric route always ends in the IEEE `NaN`, whatever a
 * producer knew about the exactness of its operands; some producers cannot
 * know it, since a product is rebuilt through `Product.asExpression()`
 * without the `numericApproximation` option under `.N()`. Applied to the
 * result of `evaluate({ numericApproximation: true })`, which
 * `BoxedFunction.N()` calls, and of its asynchronous twin
 * (`BoxedNumber.N()` answers `NaN` for the literal itself).
 *
 * The map reaches the cells of a `List` or a `Tuple` result, at any depth:
 * a broadcast or a matrix kernel computes its cells with the arithmetic
 * methods (`.mul()`, `.add()`), which do not know that the route is numeric,
 * so `[0, 1]·∞` and `MatrixPower([[∞, 0], [0, 1]], 2)` would otherwise keep an
 * `Indeterminate` cell under `.N()`. Other heads are not entered: their
 * operands are not values of the result.
 *
 * Provenance: `docs/plans/2026-09-28-indeterminate-value.md` §4 and §6
 * (Phase 2).
 */
function indeterminateAsNaN(result: Expression): Expression {
  if (result.isIndeterminate) return result.engine.NaN;
  if (
    !isFunction(result) ||
    (result.operator !== 'List' && result.operator !== 'Tuple')
  )
    return result;
  let changed = false;
  const ops = result.ops.map((x) => {
    const y = indeterminateAsNaN(x);
    if (y !== x) changed = true;
    return y;
  });
  return changed ? result.engine.function(result.operator, ops) : result;
}

/**
 * True when the context stacks `a` and `b` hold the same frames, in the
 * same order: the two evaluations resolve names in the same scopes. Each
 * asynchronous evaluation that the host starts has its own copy of the
 * engine's stack (`beginAsyncEvaluation`, `evaluation-epoch.ts`), so two such
 * evaluations started at the same point have two arrays with the same
 * frames.
 */
function sameContextFrames(
  a: ReadonlyArray<object> | undefined,
  b: ReadonlyArray<object> | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((frame, i) => frame === b[i]);
}

/**
 * The precision window in force on `engine` when an asynchronous evaluation
 * starts without one in its options: the working precision when the engine
 * is inside a transient window (`_withTransientPrecision`, the window of a
 * `N(x, p)` call), and the digits requested by the enclosing `N(x, p)` call.
 * `undefined` when neither is set.
 */
function capturedPrecisionWindow(
  engine: ComputeEngine
): PrecisionWindow | undefined {
  const working = engine._atTransientPrecision ? engine.precision : undefined;
  const requested = engine._requestedPrecision;
  if (working === undefined && requested === undefined) return undefined;
  return { working, requested };
}

function asyncScopeActivation(ce: ComputeEngine, scope: Scope): Scope {
  const ambient = ambientChainParent(ce.context?.lexicalScope, scope);
  let parent = ambient ?? scope.parent;
  // An ambient descendant can carry intervening locals. Only look for the
  // parent's activation when the ambient chain cannot be used, such as a
  // re-entrant evaluation of this same scoped node.
  if (ambient === undefined) {
    for (let i = ce._evalContextStack.length - 1; i >= 0; i--) {
      const active = ce._evalContextStack[i].lexicalScope;
      if (scopeActivationTemplate(active) === scope.parent) {
        parent = active;
        break;
      }
    }
  }
  const result: Scope = { ...scope, parent, bindings: new Map() };
  for (const [name, binding] of scope.bindings) {
    if (isValueDef(binding)) {
      const value = binding.value as BoxedValueDefinition & {
        _cloneForActivation(): BoxedValueDefinition;
      };
      result.bindings.set(name, {
        ...binding,
        value: value._cloneForActivation(),
      });
    } else result.bindings.set(name, binding);
  }
  registerScopeActivation(result, scope);
  return result;
}
