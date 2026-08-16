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
} from '../global-types.js';

import {
  broadcastLengthMismatch,
  isBroadcastableCollection,
  isBroadcastCollectionType,
  isDrawFreeBroadcast,
  isFiniteIndexedCollection,
  isFixedShapeCollection,
  isKnownFinitenessBroadcast,
  isLinearAlgebraCollection,
  isNumericTuple,
  couldBeUnkeyedCollectionOperand,
  isPossiblyCollectionTyped,
  isTuple,
  isUnknownLengthBroadcast,
  typeCouldBeCollection,
  typeCouldBeUnkeyedCollection,
  lazyBroadcastMapIfNeeded,
  lazyMapNumericApproximation,
  zip,
} from '../collection-utils.js';
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
  isNumber,
  isFunction,
  isString,
  isSymbol,
  isContinuationOperand,
  isFoldBarrierProduct,
} from './type-guards.js';
import {
  armHasValueParam,
  instantiateArms,
  type OverloadResolution,
  overloadArms,
  resolveOverload,
  triStateSelect,
} from './overload.js';
import { candidateShape } from './tensor-view.js';
import {
  instantiatedResultType,
  substituteDeclaredBounds,
} from './generic-instantiation.js';
import type {
  EffectLabel,
  FunctionSignature,
  NumericPrimitiveType,
} from '../../common/type/types.js';
import { Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';
import { isSubtype } from '../../common/type/subtype.js';
import { NUMERIC_TYPES } from '../../common/type/primitive.js';
import {
  absorbNumericAbsence,
  broadcastElementType,
  broadcastResultType,
  broadcastShapedResultType,
  functionResult,
  isSignatureType,
  isWildcardFunctionType,
  narrow,
  numericMissingSlot,
  staticCollectionDims,
  stripMissingFromType,
  typeContainsMissing,
  widen,
} from '../../common/type/utils.js';
import { NumericValue } from '../numeric-value/types.js';
import type { BigDecimal } from '../../big-decimal/index.js';

import { findUnivariateRoots } from './solve.js';
import { filterRootsByAssumptions } from './solve-domain.js';
import { solveSystem, solveOr } from './solve-system.js';
import { solveCongruence } from './solve-congruence.js';
import { replace } from './rules.js';
import { negate } from './negate.js';
import { simplifyValueBlind } from './simplify.js';
import { explainExpression } from './explain.js';
import { canonicalMultiply, mul, div, Product } from './arithmetic-mul-div.js';
import { add } from './arithmetic-add.js';
import { pow } from './arithmetic-power.js';
import { asSmallInteger } from './numerics.js';
import { gcd } from '../numerics/numeric.js';
import { activeRollbackFrame } from '../inference-rollback.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { DEFAULT_COMPLEXITY, sortOperands } from './order.js';
import {
  hashCode,
  isOperatorDef,
  isValueDef,
  normalizedUnknownsForSolve,
} from './utils.js';
import {
  broadcastContextMessage,
  errorValue,
  isCollectionHead,
  withBroadcastFrame,
} from './error-value.js';
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
import { cachedValue, CachedValue } from './cache.js';
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
import { apply, lookupApplicable } from '../function-utils.js';
import { functionLiteralSignatureType } from './effects-inference.js';
import { isScalarType } from './function-literal.js';
import { applicationEffects, publicEffects } from './effects-of.js';
import type { ComputedEffects } from '../../common/type/effects.js';
import { isPureComputedEffects } from '../../common/type/effects.js';
import {
  checkDeadline,
  iterationLimitCancellationCount,
} from '../../common/interruptible.js';
import {
  applyPoleOverride,
  isEligibleRealRewrite,
  onBranchCut,
} from '../function-properties/index.js';

/** When `materialization` is true, display 10 items if the collection is
 * infinite, otherwise 5 from the head and 5 from the tail
 */
const DEFAULT_MATERIALIZATION: [number, number] = [5, 5] as const;

/** One memoized collection-facet answer (see `BoxedFunction._facetMemo`). The
 * value is wrapped so that a facet legitimately answering `undefined` is
 * distinguishable from one not yet computed. `objectDeps` is recorded PER
 * FACET rather than shared with the slot's symbol-dependency snapshot: the
 * three facets are computed independently, and a `count` that read a mutable
 * object's field must not drag an `isEmpty` that read nothing into being
 * invalidated with it. */
type FacetEntry<T> = { value: T; objectDeps?: ObjectDeps };

/** Tick counter for the cooperative deadline checkpoint in
 * `_computeValue`/`_computeValueAsync`. Module-scoped (shared across
 * engines): the check reads the owning engine's deadline, the counter only
 * paces how often `Date.now()` is consulted. */
let _evalTick = 0;

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

export class BoxedFunction
  extends _BoxedExpression
  implements FunctionInterface
{
  override readonly _kind = 'function';

  // The operator of the function expression
  private readonly _operator: string;

  // The operands of the function expression
  private readonly _ops: ReadonlyArray<Expression>;

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

  /** The overload resolution this call was VALIDATED against, attached by
   * the construction site (`box.ts`) when the operator's signature is an
   * overload set (phase 2c of
   * `docs/plans/2026-08-13-inference-tx-design.md`). Result typing
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
   * step 3 of `docs/plans/2026-08-09-state-event-invalidation-axes.md` — on
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
   * `docs/plans/2026-08-09-lazy-collection-evaluate-design.md`). Cleared when
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
        deps: MemoDeps;
        count?: FacetEntry<number | undefined>;
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
   * change the answer. `-1` is "never computed" (generations start at 0). */
  private _typeGeneration = -1;

  constructor(
    ce: ComputeEngine,
    operator: string,
    ops: ReadonlyArray<Expression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      structural?: boolean;
      scope?: Scope;
    }
  ) {
    super(ce, options?.metadata);

    this._operator = operator;
    this._ops = ops;
    this._localScope = options?.scope;

    this._isStructural = options?.structural ?? false;
    if (options?.canonical || this._isStructural) this.bind();
    // `null` is "not bound" — as documented on `_def`, and as distinct from
    // the `undefined` `bind()` leaves when it finds no definition. Only
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
    for (const op of this._ops) h = ((h << 1) ^ op.hash) | 0;

    h = (h ^ hashCode(this._operator)) | 0;
    this._hash = h;
    return h;
  }

  /**
   * For function expressions, `infer()` infers the result type of the function
   * based on the provided type and inference mode.
   */
  infer(t: Type, inferenceMode?: 'narrow' | 'widen'): boolean {
    const def = this.operatorDefinition;
    if (!def || !def.inferredSignature) return false;

    // Inside a resolve-only region (`ce._resolveOnly()`: partial forms,
    // serialization) a read must not write inference onto a definition —
    // every call site is fire-and-forget, so declining is safe.
    if (this.engine._resolveOnlyDepth > 0) return false;

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
          def.signature = signature;
          def._resyncEffects();
        },
      });
    };

    // If the signature was inferred, refine it by narrowing the result
    if (def.signature.is('function')) {
      journalSignature();
      def.signature = new BoxedType(
        { kind: 'signature', result: t },
        this.engine._typeResolver
      );
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
      def.signature = new BoxedType(nextSig, this.engine._typeResolver);
    }

    // The signature OBJECT was replaced. Re-attach the definition's effect set
    // so the arrow and the cached `_effects` the derived `pure`/`drawsRandom`
    // getters read stay in lockstep — otherwise an inferred `random` lambda
    // serializes pure the moment its result type is inferred.
    def._resyncEffects();

    // Signature inference mutates a SHARED operator definition in place: a
    // semantic change other expressions may depend on.
    this.engine._noteStateEvent({ kind: 'inference' });

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

  bind(): void {
    // Operator (function-application) position: an inner binding that
    // provably cannot be applied — a user symbol `N = 85` shadowing the
    // built-in `N` operator — defers to an outer applicable definition.
    this._def = lookupApplicable(
      this._operator,
      this._localScope ?? this.engine.context.lexicalScope,
      this.engine
    );
  }

  reset(): void {
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
    return this._ops.every((x) => x.isConstant) && this.isPure;
  }

  get json(): MathJsonExpression {
    const s = this.structural;
    const ops = isFunction(s) ? s.ops : this._ops;
    return [this._operator, ...ops.map((x) => x.json)];
  }

  get operator(): string {
    return this._operator;
  }

  get ops(): ReadonlyArray<Expression> {
    return this._ops;
  }

  get nops(): number {
    return this._ops.length;
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
    this._isValid =
      this._operator !== 'Error' && this._ops.every((x) => x?.isValid);
    return this._isValid;
  }

  /** Note: if the expression is not canonical, this will return a canonical
   * version of the expression in the current lexical scope.
   */
  get canonical(): Expression {
    if (this.isCanonical || !this.isValid) return this;
    // Thread the source position through (a raw statement's `.canonical` is
    // how a `Block`/`Loop` body canonicalizes — without this, no statement
    // inside a scoped operator can be mapped back to source). `latex` is
    // deliberately NOT threaded here: the canonical form is a different
    // expression, for which verbatim source LaTeX would be a lie.
    return this.engine.function(
      this._operator,
      this._ops,
      this.sourceOffsets !== undefined
        ? { metadata: { sourceOffsets: this.sourceOffsets } }
        : undefined
    );
  }

  get structural(): Expression {
    if (this.isStructural) return this;
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
        if (!c.isOne) coef = coef.mul(c);
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
        return [coef.sqrt(), rest];
      }
      // √(k·u) = √k·√u only holds for k ≥ 0: for k < 0 it splits off a
      // constant imaginary phase, but the true value is region-dependent
      // (±i·√|k|·√|u| across u = 0). Fold the sign into the radicand
      // instead: √(k·u) = √|k|·√(−u).
      if (coef.sgn() === -1)
        return [coef.neg().sqrt(), ce.function('Sqrt', [rest.neg()])];
      return [coef.sqrt(), ce.function('Sqrt', [rest])];
    }

    if (isFunction(expr, 'Root')) {
      const exp = expr.op2.re;
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
      if (!root.isExact && (!rest.isSame(1) || coef.isExact))
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
   * Note: the result is bound to the current scope, not the scope of the
   * original expression.
   * <!-- This may or may not be desirable -->
   */
  subs(
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

    if (!ops.every((x) => x.isValid))
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

    return this.engine.function(this._operator, ops, { form });
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
    // Does the operator name match?
    if (typeof v === 'string') {
      if (this._operator === v) return true;
    } else if (v.includes(this._operator)) return true;

    // Do any of the operands match?
    return this._ops.some((x) => x.has(v));
  }

  /**
   * The nominal value of a `Measurement(value, error)`, or `undefined` for
   * every other operator.
   *
   * `Measurement` types as its nominal's scalar type (see `measurementType()`),
   * so `Integrate(…).N()` reports `finite_real` and `isNumber === true`. The
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

    // Operands first — see the note on the same conjunction in `get type`.
    const gen =
      this._ops.every((x) => x.isConstant) && this.isPure
        ? undefined
        : this.engine._anyVersion;
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
    // structural analysis can — e.g. `Ln(0)` types `non_finite_number`. That
    // type is exactly the signed infinities (PositiveInfinity,
    // NegativeInfinity — no NaN member, and no ComplexInfinity, which is
    // typed `complex`), so it entails "is infinite". The type is already
    // computed and cached at this point (consulted by `isNumber` on entry).
    const t = this.type;
    if (!t.isUnknown && isSubtype(t.type, 'non_finite_number')) return true;
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
        // `non_finite_number`, and `Divide` then folded `1/(3·|(1, 2)|)` to a
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
    if (this.isNonPositive === true || this.isReal === false) return false;
    return undefined;
  }

  get _isNegativeOne(): boolean | undefined {
    if (this.isNonNegative === true || this.isReal === false) return false;
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
    if (this.operator === 'Abs' || this.operator === 'Negate') return this;
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

    const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

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

    // (-x)^n = (-1)^n x^n
    if (this.operator === 'Negate') {
      if (e !== undefined) {
        if (e % 2 === 0) return this.op1.root(exp);
        return this.op1.root(exp).neg();
      }
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

    // ln_c(a/b) = ln_c(a) - ln_c(b) — both operands real-eligible and not
    // provably on the cut (D3/D4 generic-real convention). (Unconstrained
    // operands round-trip through the ln-combine rule, so this leaves `ln(x/y)`
    // unchanged; it drives `ln(1/x) → -ln(x)`.)
    if (this.operator === 'Divide') {
      const num = this.op1;
      const den = this.op2;
      if (
        (num.isNonNegative === true ||
          (isEligibleRealRewrite(num) &&
            onBranchCut(this.engine, 'Ln', num) !== true)) &&
        (den.isNonNegative === true ||
          (isEligibleRealRewrite(den) &&
            onBranchCut(this.engine, 'Ln', den) !== true))
      )
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

  get isNumber(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    return isSubtype(this.type.type, 'number');
  }

  get isInteger(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    return isSubtype(this.type.type, 'integer');
  }

  get isRational(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    // integers are rationals
    return isSubtype(this.type.type, 'rational');
  }

  get isReal(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    // rationals and integers are real
    return isSubtype(this.type.type, 'real');
  }

  get isFunctionExpression(): true {
    return true;
  }

  /** The type of the value of the function */
  get type(): BoxedType {
    const generation = this.engine._anyVersion;
    // Fast path: the cache was already consulted at this generation, so the
    // key it was consulted with — which costs a purity projection and an
    // `isConstant` subtree walk — is necessarily the same one now. See
    // `_typeGeneration`.
    //
    // This path bypasses `cachedValue`, so it repeats that helper's two
    // object-dependency duties itself: an entry whose recorded
    // `(object, version)` pairs no longer hold must NOT be served (a field
    // store advances no engine generation, so `_typeGeneration` alone cannot
    // see it), and a served entry must fold its dependencies into any
    // enclosing collector, since a hit performs no field reads of its own.
    if (
      this._typeGeneration === generation &&
      this._type.value !== null &&
      objectDepsValid(this._type.objectDeps)
    ) {
      mergeObjectDeps(this._type.objectDeps);
      if (CACHE_STATS) recordCache('type', 'hitFastPath');
      return this._type.value ?? BoxedType.unknown;
    }

    // `isConstant` is tested FIRST: it fails at the first free variable — the
    // overwhelmingly common case for a row being canonicalized — whereas
    // `isPure` runs the whole effect projection, which resolves symbol
    // operands through their bindings and can force a stored function
    // literal's arrow. Both are side-effect-free predicates, so the order is
    // free; only the cost differs.
    const gen =
      this._ops.every((x) => x.isConstant) && this.isPure
        ? undefined
        : this.engine._anyVersion;
    const compute = (): BoxedType =>
      new BoxedType(type(this), this.engine._typeResolver);
    const result =
      cachedValue(
        this._type,
        gen,
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
    // A deadline is armed only by an enclosing `withTimeLimit` span; work
    // outside a span runs unbounded. Evaluation checkpoints the ambient
    // deadline (`engine._deadlineFrame`) if one is in effect.
    const canonical = this._canonicalToEvaluate();
    if (canonical) return canonical.evaluate(options);
    if (this._isMemoizableLazyCollection(options))
      return this._memoizedLazyCollectionValue(options);
    return this._computeValue(options)();
  }

  /**
   * Is this node in the set Change 1 of
   * `docs/plans/2026-08-09-lazy-collection-evaluate-design.md` memoizes — a
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
   * regime, so no other operator class is swept in; the regime inventory is
   * pinned in `test/compute-engine/lazy-collection-regimes.test.ts`.
   *
   * DEFAULT options only: `materialization` selects step 3 and
   * `numericApproximation` step 3b, both of which return something other than
   * the step-4 rebuild. Every non-default combination takes today's path,
   * untouched and unmemoized. The same test gates the ASYNC entry point
   * (`_memoizedLazyCollectionValueAsync`), which shares this memo — the two
   * paths must agree on eligibility or one could serve the other an entry it
   * would not have made itself.
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
    options?: Partial<EvaluateOptions>
  ): boolean {
    if ((options?.materialization ?? false) !== false) return false;
    if ((options?.numericApproximation ?? false) !== false) return false;
    if (!this.isCanonical) return false;
    const def = this.operatorDefinition;
    if (!def || def.lazy === true) return false;
    if (!this.isLazyCollection) return false;
    if (
      def.collection?.elementMemo === true &&
      this.isFiniteCollection !== true
    )
      return false;
    return true;
  }

  /**
   * The memoized fall-through evaluation of a lazy collection view (Change 1
   * of `docs/plans/2026-08-09-lazy-collection-evaluate-design.md`). The first
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
   * already-evaluated constant view) free of the purity/constancy walk. */
  private _lazyCollectionMemoHit(): Expression | undefined {
    if (
      this._value.value !== null &&
      this._lazyValueEpoch === this.engine._worldVersion &&
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
      }
    }
  }

  /** The memo key of {@link _memoizedLazyCollectionValue}: `undefined` for a
   * constant, pure node (no value write can make it stale — the epoch axis
   * still applies), the generation otherwise, or `false` when the node is
   * impure and must not be memoized at all. */
  private _lazyCollectionMemoKey(
    generation: number
  ): number | undefined | false {
    if (!this.isPure) return false;
    return this._ops.every((x) => x.isConstant) ? undefined : generation;
  }

  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<Expression> {
    const canonical = this._canonicalToEvaluate();
    if (canonical) return canonical.evaluateAsync(options);
    if (this._isMemoizableLazyCollection(options))
      return this._memoizedLazyCollectionValueAsync(options);
    return this._computeValueAsync(options)();
  }

  /**
   * The async twin of {@link _memoizedLazyCollectionValue} — the "Async"
   * follow-up of
   * `docs/plans/2026-08-09-lazy-collection-evaluate-design.md`. It is the SAME
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
    options?: Partial<EvaluateOptions>
  ): Promise<Expression> {
    const hit = this._lazyCollectionMemoHit();
    if (hit !== undefined) return Promise.resolve(hit);

    if (this._lazyValuePending !== undefined) return this._lazyValuePending;

    const pending: Promise<Expression> = Promise.resolve()
      .then(() => this._settledLazyCollectionValueAsync(options))
      .finally(() => {
        if (this._lazyValuePending === pending)
          this._lazyValuePending = undefined;
      });
    this._lazyValuePending = pending;
    return pending;
  }

  /** The walk + settled-only gate + memo write of
   * {@link _memoizedLazyCollectionValueAsync}. Mirrors the sync body, minus
   * the `_lazyValueInFlight` marker: a re-entrant read of this node arrives on
   * the SYNC path (see `_lazyValuePending`), where that marker lives. */
  private async _settledLazyCollectionValueAsync(
    options?: Partial<EvaluateOptions>
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

    const result = await this._computeValueAsync(options)();

    if (
      _lazyValueProvisionalReads !== before ||
      cycleDetectionCount() !== cyclesBefore ||
      objectReadCount() !== objectReadsBefore
    ) {
      if (CACHE_STATS) recordCache('lazyValue', 'declineStore');
      return result;
    }

    this._storeLazyCollectionValue(result, generation, options);

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
    return this.evaluate({ numericApproximation: true });
  }

  solve(
    vars?: Iterable<string> | string | Expression | Iterable<Expression>
  ):
    | null
    | ReadonlyArray<Expression>
    | Record<string, Expression>
    | Array<Record<string, Expression>> {
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

    const roots = findUnivariateRoots(this, varNames[0]);
    if (roots === null) return null;
    // Route in-scope bound assumptions on the unknown through the same root
    // filter the domain pipeline uses: `assume(n > 0)` should drop the negative
    // root of `n^2 = 16`. Applied at this OUTER boundary (not inside the
    // recursive `findUnivariateRoots`, which re-enters with substituted
    // variables) so both `expr.solve('n')` and the `Solve` operator benefit.
    return filterRootsByAssumptions(this.engine, roots, varNames[0]);
  }

  get isCollection(): boolean {
    if (!this.isValid) return false;
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
    if (!this.isValid) return false;
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
    // input collection

    return this.type.matches('indexed_collection');
  }

  get isLazyCollection(): boolean {
    if (!this.isValid) return false;
    if (this._optedOutOfCollection) return false;
    return this.baseDefinition?.collection?.isLazy?.(this) ?? false;
  }

  contains(rhs: Expression): boolean | undefined {
    if (this._optedOutOfCollection) return undefined;
    return this.baseDefinition?.collection?.contains?.(this, rhs);
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
   * `docs/plans/2026-08-02-dependency-precise-memo-invalidation.md`): an
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
  private _memoizedFacet<T extends number | boolean | undefined>(
    facet: 'count' | 'isEmpty' | 'isFinite',
    compute: () => T
  ): T {
    const ce = this.engine;
    const slot = this._facetMemo;
    if (slot !== undefined && slot.worldVersion === ce._worldVersion) {
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
      !memoDepsStillValid(this, target.deps)
    ) {
      const deps = snapshotMemoDeps(this);
      if (deps === undefined) {
        // Ineligible (a dependency no version tracks): never stored.
        if (CACHE_STATS) recordCache('collectionFacet', 'declineStore');
        return value;
      }
      target = { worldVersion: world, deps };
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

  get count(): number | undefined {
    if (this._optedOutOfCollection) return undefined;
    return this._memoizedFacet('count', () => {
      // A DECLARED count handler owns the answer, including its `undefined`.
      const handler = this.operatorDefinition?.collection?.count;
      if (handler !== undefined) return handler(this);
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
   * even though the type says `vector<finite_integer^3>`, and for
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
   * report `false`/`undefined` for a `list<finite_number>` by design, and
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
  private _broadcastCount(): number | undefined {
    // Only a collection-SHAPED result can have an element count. `Add(1, 2)`
    // types `finite_integer` and must keep answering `undefined`. UNKEYED:
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
    // decides its own length — and answers it with `elementCount` when it can.
    if (this.operatorDefinition?.broadcastable !== true) return undefined;
    const ops = this.ops;
    if (ops === undefined) return undefined;
    let count: number | undefined;
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
    if (!this.isValid) return false;
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
      if (evaluated !== this)
        iter = evaluated.operatorDefinition?.collection?.iterator?.(evaluated);

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
      const count = this.count;
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

    return handler(this, idx);
  }

  /**
   * Indexed-route twin of `each()`'s eager-source fallback (see the
   * materialize-then-iterate note there, and
   * `docs/plans/2026-08-11-eager-collection-enumerability.md`). An EAGER
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

    const gen =
      this._ops.every((x) => x.isConstant) && this.isPure
        ? undefined
        : this.engine._anyVersion;
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
    if (!this._ops.some((x) => x.operator === 'Spread')) return null;
    const spliced: Expression[] = [];
    for (const x of this._ops) {
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
      else return this;
    }
    return spliced;
  }

  /**
   * The value of an INVALID expression — one whose tree embeds an `Error` —
   * or `undefined` to let the `evaluate` handler run anyway.
   * See `docs/plans/2026-07-31-error-propagation-design.md`.
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
   */
  private _invalidValue(): Expression | undefined {
    const def = this._def ?? undefined;
    if (def === undefined) return this;

    if (isValueDef(def)) {
      // A value-def head is a callee only when its value is a FUNCTION — the
      // same test `applyFunctionLiteral` makes. When it is not (`a := 5;
      // a(err)`), this is not an application at all: let the handler run so
      // the CALLEE problem is reported (`applyFunctionLiteral`'s `typeError`
      // path) rather than the argument's error.
      const value = def.value.isConstant
        ? def.value.value
        : this.engine._getSymbolValue(this._operator);
      if (!value?.type.matches('function')) return undefined;
      return this._firstOperandError() ?? this;
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

    // Rung 3: a collection freezes with the failed cell in place; everything
    // else bubbles.
    if (isCollectionHead(this)) return this;

    return this._firstOperandError() ?? this;
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

  _computeValue(options?: Partial<EvaluateOptions>): () => Expression {
    return () => {
      // Cooperative deadline checkpoint on the per-node evaluation path.
      // Specialized loops (collection enumeration, polynomial GCD, Rubi
      // matching) carry their own checks, but handler-driven evaluation —
      // e.g. a user-function body whose parameter substitution multiplies
      // the tree at every nesting level — never reaches them: without this
      // check such an evaluation exhausts the heap instead of honoring an
      // enclosing `withTimeLimit` span's deadline.
      if ((++_evalTick & 0x3ff) === 0)
        checkDeadline(this.engine._deadlineFrame);

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
      const hasRawOperand =
        (this.operator === 'Add' || this.operator === 'Multiply') &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      if (
        def.broadcastable &&
        // A user function literal has its OWN broadcast arm (step 2b) and takes
        // it even when the definition is `broadcastable` — an annotated literal
        // assigned bare now derives that flag from `paramsAreScalar`
        // (`engine-declarations.ts`). The two arms agree except on the empty
        // source, where this one answers `Nothing` and step 2b answers `[]` —
        // and `[]` is what the declare-then-assign VALUE route answers, so a
        // lambda must not be captured here.
        !isLambdaDef(def) &&
        !hasRawOperand &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        !skipBroadcastForVectorOps(this.operator, hasTensors, this.ops!)
      ) {
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
        const bops = evaluateBroadcastLiftsOnce(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
        if (!items) return this.engine.Nothing;

        const results: Expression[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;
          results.push(this.engine._fn(this.operator, value).evaluate(options));
        }

        if (results.length === 0) return this.engine.Nothing;
        // Always wrap in a `List` — even a single-element broadcast — so the
        // value matches the `list<E>` broadcast type (the type handler never
        // unwraps a singleton). Mirrors the lambda broadcast in step 4b.
        return this.engine._fn('List', results);
      }

      //
      // 2b/ Broadcast user-defined function literals over indexed collections
      // When a function defined via `ce.assign('f', x \mapsto ...)` is applied
      // to a list (or other finite indexed collection) and the function's
      // parameters are scalar, map the function over the collection.
      // Note: tuples are excluded (`!isTuple`) — a `Tuple` is an atomic value
      // (a point/vector), bound whole to the parameter, never mapped over.
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        paramsAreScalar(def)
      ) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — map the lambda lazily.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (step 4b/3b) once their count resolves.
        // Broadcast rulings (2026-07-24) — see step 2 above (both run before
        // the lazy form, so size does not decide the semantics).
        const bops = evaluateBroadcastLiftsOnce(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
        if (items) {
          const results: Expression[] = [];
          // A THROWN element failure aborts the whole broadcast, so it cannot
          // carry a breadcrumb — its message is enriched instead. One `try`
          // around the loop, so a successful broadcast pays nothing.
          try {
            while (true) {
              const { done, value } = items.next();
              if (done) break;
              results.push(
                this.engine._fn(this.operator, value).evaluate(options)
              );
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
            annotateBroadcastErrors(this.operator, results)
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
        someMappableCollection(this.ops!, declaredPlan, (x) =>
          isFiniteIndexedCollection(x)
        )
      ) {
        // Broadcast rulings (2026-07-24), as in steps 2/2b: lifted operands are
        // evaluated ONCE, and the length check runs before the lazy form so the
        // SIZE of a source never decides the semantics.
        const mapped = declaredBroadcast(
          this.engine,
          this.operator,
          declaredLiteral,
          declaredPlan,
          evaluateBroadcastLiftsOnce(this._ops!, options),
          (x) => isFiniteIndexedCollection(x) && !isTuple(x),
          options
        );
        if (mapped) return mapped;
      }

      //
      // 3/ Handle evaluation of lazy collections
      //
      if (materialization !== false && !def.evaluate && this.isLazyCollection)
        return materialize(this, def, options);

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
      const tail = holdMap(this, (x) => x.evaluate(options));

      //
      // 4a/ Missing-value behavior gate (§3.E of the missing-value typing
      // design). A `propagate` operator with an absent SCALAR operand
      // (`Missing`, or a `NaN`) yields `NaN` in the numeric result cell (I6
      // absorption) — but only when NO operand is a collection: a
      // scalar-vs-collection application (`Add(Missing, matrix)`) broadcasts
      // the absence per cell through the operator's own kernel (packing
      // demotion, tensor-view). Under an element-wise broadcast (step 2 above)
      // the gate re-enters per element (`Sin([1,Missing,3])` →
      // `[Sin(1), NaN, Sin(3)]`). A `reject` operator errors at an absent
      // operand in BOTH strict modes (the behavior gate, not validation).
      //
      if (def instanceof _BoxedOperatorDefinition) {
        const behavior = def.resolvedMissingBehavior;
        // The gate fires on the `Missing` SYMBOL only: a `NaN` operand already
        // propagates through numeric evaluation natively (and some operators —
        // e.g. `Rgb` — give a literal `NaN` operand a bespoke meaning), so it
        // must NOT be hijacked here.
        if (
          (behavior === 'propagate' || behavior === 'reject') &&
          tail.some((x) => isSymbol(x, 'Missing')) &&
          // "No collection operand" must be read as collection-SHAPED, not as
          // the `isCollection` CAPABILITY: an operand declared `list<number>`
          // with no value yet is destined to broadcast, but cannot be
          // enumerated now. Testing only `isCollection` fired the scalar gate
          // for it, so `Add(Missing, L)` committed a scalar `NaN` where the
          // same expression gives `[NaN, NaN]` once `L` is assigned. With the
          // disjunct the gate stands down and the application stays symbolic
          // until the value arrives, which is the honest undecided answer.
          // This test must stay in lockstep with its twin in `evaluateAsync`
          // (step 3a) — the two gates decide the same question on two routes.
          !tail.some((x) => x.isCollection || x.type.matches('collection'))
        ) {
          if (behavior === 'reject')
            return this.engine.error([
              'unexpected-argument',
              this.engine.Missing.toString(),
            ]);
          return this.engine.NaN;
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
      const lambdaBroadcast =
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        paramsAreScalar(def);
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
      if (
        (lambdaBroadcast ||
          (def.broadcastable &&
            this.operator !== 'Add' &&
            this.operator !== 'Multiply')) &&
        !skipBroadcastForVectorOps(this.operator, false, tail) &&
        tail.some(isPostEvalBroadcastOperand)
      ) {
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

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          tail,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(tail);
        if (items) {
          const results: Expression[] = [];
          // Element-wise context, for the LAMBDA broadcast only (see step 2b):
          // a builtin `broadcastable` operator keeps its historical errors.
          try {
            while (true) {
              const { done, value } = items.next();
              if (done) break;
              results.push(
                this.engine._fn(this.operator, value).evaluate(options)
              );
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
          if (lambdaBroadcast)
            return this.engine._fn(
              'List',
              annotateBroadcastErrors(this.operator, results)
            );
          if (results.length > 0) return this.engine._fn('List', results);
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
      if (
        def.broadcastable &&
        !CONDITIONAL_THREADING_SKIP.has(this.operator) &&
        tail.some((x) => isFunction(x, 'When') || isFunction(x, 'Which'))
      ) {
        const threaded = threadConditional(
          this.engine,
          this.operator,
          tail,
          def.lazy === true,
          options
        );
        if (threaded) return threaded;
      }

      //
      // 5/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined;

      if (isScoped) {
        this.engine._pushEvalContext(this._localScope!);
      }

      //
      // 6/ Call the `evaluate` handler
      //
      let evalResult: Expression | undefined;
      try {
        evalResult = def.evaluate?.(tail, {
          numericApproximation,
          engine: this.engine,
          materialization: materialization,
          // The node itself, so a handler can reach its RAW (pre-numericized)
          // operands — `tail` has already been evaluated. See
          // `EvaluateHandlerOptions.expression`.
          expression: this,
        });
      } finally {
        if (isScoped) this.engine._popEvalContext();
      }

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
          : this.engine.function(this._operator, tail));

      // 6b/ Pole-aware numeric evaluation: at a known pole, N() yields
      // ComplexInfinity rather than NaN/garbage (analytic-property store).
      if (numericApproximation)
        return applyPoleOverride(this.engine, this._operator, tail, result);
      return result;
    };
  }

  _computeValueAsync(
    options?: Partial<EvaluateOptions>
  ): () => Promise<Expression> {
    return async () => {
      // Cooperative deadline checkpoint — see `_computeValue`.
      if ((++_evalTick & 0x3ff) === 0)
        checkDeadline(this.engine._deadlineFrame);

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
        return applyFunctionLiteral(this, this._def.value, options);

      const def = this._def.operator;

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
      const hasRawOperand =
        (this.operator === 'Add' || this.operator === 'Multiply') &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      if (
        def?.broadcastable &&
        // Mirrors the sync path: a lambda takes its own step-2b arm.
        !isLambdaDef(def) &&
        !hasRawOperand &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        !skipBroadcastForVectorOps(this.operator, hasTensors, this.ops!)
      ) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — return the lazy `Map` form.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (mirrors the sync path).
        // Broadcast rulings (2026-07-24) — mirrors the sync path in step 2,
        // including running before the lazy form.
        const bops = await evaluateBroadcastLiftsOnceAsync(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
        if (!items) return this.engine.Nothing;

        const results: Promise<Expression>[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;

          results.push(
            this.engine._fn(this.operator, value).evaluateAsync(options)
          );
        }

        if (results.length === 0) return this.engine.Nothing;
        // Always wrap in a `List` — even a single-element broadcast — so the
        // value matches the `list<E>` broadcast type (mirrors the sync path).
        return Promise.all(results).then((resolved) =>
          this.engine._fn('List', resolved)
        );
      }

      //
      // 2b/ Broadcast user-defined function literals over indexed collections.
      // Mirrors the sync path in `_computeValue`.
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        paramsAreScalar(def)
      ) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — map the lambda lazily.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (step 4b/3b) once their count resolves.
        // Broadcast rulings (2026-07-24) — mirrors the sync path in step 2b,
        // including running before the lazy form.
        const bops = await evaluateBroadcastLiftsOnceAsync(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
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
          return Promise.all(results).then(
            (resolved) =>
              this.engine._fn(
                'List',
                annotateBroadcastErrors(this.operator, resolved)
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
        // Evaluate-once, as in the sync step 2c — see the note there.
        someMappableCollection(this.ops!, declaredPlan, (x) =>
          isFiniteIndexedCollection(x)
        )
      ) {
        const mapped = await declaredBroadcastAsync(
          this.engine,
          this.operator,
          declaredLiteral,
          declaredPlan,
          await evaluateBroadcastLiftsOnceAsync(this._ops!, options),
          (x) => isFiniteIndexedCollection(x) && !isTuple(x),
          options
        );
        if (mapped) return mapped;
      }

      //
      // 2c/ Handle evaluation of lazy collections — mirrors the sync path's
      // step 3 (the "Async" follow-up of
      // `docs/plans/2026-08-09-lazy-collection-evaluate-design.md`: the async
      // path had NO materialization step at all, so every `materialization`
      // form silently returned the lazy view). All four forms — `false`,
      // `true`, an integer, `[head, tail]` — now behave as they do
      // synchronously. `materialize()` is shared rather than duplicated: it
      // enumerates lazily and evaluates the few elements it keeps
      // SYNCHRONOUSLY, so an element whose operator has an `evaluateAsync`
      // handler but no `evaluate` one would not run it — the same divergence
      // the `!def.evaluate` gate below already has, and no collection operator
      // is in that shape today.
      //
      const materialization = options?.materialization ?? false;
      if (materialization !== false && !def.evaluate && this.isLazyCollection)
        return materialize(this, def, options);

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

      // Resolve all the operand promises
      const tail = await holdMapAsync(
        this,
        async (x) => await x.evaluateAsync(options)
      );

      //
      // 3a/ Missing-value behavior gate (§3.E) — parity with the sync path's
      // step 4a. A `propagate` operator with an absent `Missing` scalar operand
      // (no collection operand) yields `NaN`; a `reject` operator errors.
      // "No collection operand" is collection-SHAPED, not the `isCollection`
      // capability — see the sync gate (step 4a) for why the two must gain
      // this disjunct together.
      //
      if (def instanceof _BoxedOperatorDefinition) {
        const behavior = def.resolvedMissingBehavior;
        if (
          (behavior === 'propagate' || behavior === 'reject') &&
          tail.some((x) => isSymbol(x, 'Missing')) &&
          !tail.some((x) => x.isCollection || x.type.matches('collection'))
        ) {
          if (behavior === 'reject')
            return this.engine.error([
              'unexpected-argument',
              this.engine.Missing.toString(),
            ]);
          return this.engine.NaN;
        }
      }

      //
      // 3b/ Broadcast over operands that only became collections after
      // evaluation (mirrors `_computeValue` step 4b, including the
      // post-evaluation lambda broadcast for scalar-parameter function
      // literals whose argument only becomes a collection after evaluation).
      //
      const lambdaBroadcast =
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        paramsAreScalar(def);
      // Same post-eval finiteness refinement as the sync path (finding 3):
      // a lazy operator keeps the strict gate; a non-lazy one also admits an
      // unresolved-finiteness source (symbolic-length `Range`).
      const isPostEvalBroadcastOperand = (x: Expression): boolean =>
        isKnownFinitenessBroadcast(x) ||
        (def.lazy !== true && isUnknownLengthBroadcast(x));
      // The lazy `Map` returned here applies its mapping SYNCHRONOUSLY on
      // `at`/iteration, so take the lazy arm only when the per-element call is
      // sync-applicable: the operator has a synchronous `evaluate` handler, or
      // this is a function-literal application (`lambdaBroadcast`, always sync).
      // An operator with ONLY an `evaluateAsync` handler would otherwise yield
      // inert per-element results and bypass async cancellation, so it falls
      // through to the async materialization/inert behavior below.
      const isSyncApplicable = lambdaBroadcast || def.evaluate !== undefined;
      if (
        (lambdaBroadcast ||
          (def.broadcastable &&
            this.operator !== 'Add' &&
            this.operator !== 'Multiply')) &&
        isSyncApplicable &&
        !skipBroadcastForVectorOps(this.operator, false, tail) &&
        tail.some(isPostEvalBroadcastOperand)
      ) {
        // Hybrid laziness: past the eager threshold — and always for an
        // unknown/infinite-length source — return the lazy `Map` form over the
        // already-evaluated `tail` (mirrors the sync path).
        // Length-mismatch ruling (2026-07-24) — mirrors the sync step 4b,
        // before the lazy form; `tail` is already evaluated, so the purity half
        // does not apply.
        const mismatch = broadcastLengthMismatch(this.engine, tail);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          tail,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(tail);
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
          // and carries the element-wise context on its failures.
          if (lambdaBroadcast)
            return Promise.all(results).then(
              (resolved) =>
                this.engine._fn(
                  'List',
                  annotateBroadcastErrors(this.operator, resolved)
                ),
              (e) => {
                throw withBroadcastThrowContext(e, this.operator, tail);
              }
            );
          if (results.length > 0)
            return Promise.all(results).then((resolved) =>
              this.engine._fn('List', resolved)
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

      // 4/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined;

      // This path holds its context across an `await` (see below), so by the
      // time it unwinds its frame is NOT necessarily on top: another
      // evaluation on the same engine may have pushed above it. Both popping
      // the top and unwinding by depth would then destroy a frame belonging to
      // something still running, disposing its bindings out from under it — so
      // capture the frame and remove it by IDENTITY instead.
      //
      // This keeps one evaluation from corrupting another's scope, but it does
      // not make concurrent async evaluation on a single engine *correct*: the
      // context stack is engine-global mutable state, so while this evaluation
      // is suspended its scope is the engine's current one, and anything else
      // entering the engine in that window — a second `evaluateAsync`, or plain
      // synchronous work from a timer or event handler — resolves against it.
      // Making that sound needs per-evaluation (task-local) context
      // propagation across every await in the async path, not just this one.
      // Until then: one engine per concurrent evaluation.
      if (isScoped) {
        this.engine._pushEvalContext(this._localScope!);
      }
      const localContext = isScoped ? this.engine.context : undefined;

      //
      // 5/ Call the `evaluate` handler
      //
      const engine = this.engine;

      let value: Expression | undefined;
      try {
        const opts: Partial<EvaluateOptions> & {
          engine: ComputeEngine;
          expression: Expression;
        } = {
          numericApproximation,
          engine,
          signal: options?.signal,
          materialization: options?.materialization,
          // See the matching comment (and `EvaluateHandlerOptions.expression`)
          // on the sync path.
          expression: this,
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
        value = await (def.evaluateAsync?.(tail, opts) ??
          def.evaluate?.(tail, opts));
      } finally {
        if (localContext) this.engine._removeEvalContext(localContext);
      }

      // Handler-less scoped-operator no-operand-change identity: see the
      // matching comment in the sync path (avoids re-canonicalizing a lazy
      // scoped collection into a fresh, split-off local scope; every other
      // operator keeps the load-bearing re-box).
      const result =
        value ??
        (isScoped &&
        def.evaluate === undefined &&
        def.evaluateAsync === undefined &&
        this.isCanonical &&
        tail.every((x, i) => x === this._ops[i])
          ? this
          : engine.function(this._operator, tail));
      // 5b/ Pole-aware numeric evaluation (see the sync path).
      if (numericApproximation)
        return applyPoleOverride(engine, this._operator, tail, result);
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
  return isFiniteIndexedCollection(op) && !isTuple(op);
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
 */
function annotateBroadcastErrors(
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
  const length = ops.find(isBroadcastParticipant)?.count;
  e.message = `${e.message} (${broadcastContextMessage(operator, length, index)})`;
  return e;
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
  options: Partial<EvaluateOptions> | undefined
): ReadonlyArray<Expression> {
  if (!ops.some((op) => !isBroadcastParticipant(op))) return ops;
  return ops.map((op) =>
    isBroadcastParticipant(op)
      ? op
      : normalizeLiftedAbsence(op, op.evaluate(options) ?? op)
  );
}

/** Async mirror of `evaluateBroadcastLiftsOnce`. */
async function evaluateBroadcastLiftsOnceAsync(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): Promise<ReadonlyArray<Expression>> {
  if (!ops.some((op) => !isBroadcastParticipant(op))) return ops;
  // Awaited together, not in sequence: the lifts are independent, and the sync
  // mirror evaluates them without ordering either.
  return await Promise.all(
    ops.map(async (op) =>
      isBroadcastParticipant(op)
        ? op
        : normalizeLiftedAbsence(op, (await op.evaluateAsync(options)) ?? op)
    )
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
 * Vector-space operators over numeric tuples (points/vectors in ℝⁿ) must not
 * be broadcast into a List: they have dedicated component-wise handling in
 * `add`/`mul`/`negate`/`canonicalDivide`. This mirrors the tensor carve-out
 * (which stays limited to Add/Multiply). See
 * `docs/plans/2026-07-07-tuple-point-semantics.md`.
 */
function skipBroadcastForVectorOps(
  operator: string,
  hasTensors: boolean,
  ops: ReadonlyArray<Expression>
): boolean {
  if (hasTensors && (operator === 'Add' || operator === 'Multiply'))
    return true;
  // A matrix-valued operand that is NOT a raw tensor node — most often a SYMBOL
  // whose value is a matrix (`isTensor` keys on the node kind, so `hasTensors`
  // misses it), or any expression statically typed `matrix` — must also route to
  // the dedicated tensor handling (`addTensors`/`mulTensors`). Otherwise
  // element-wise broadcasting Hadamards two matrices where `Multiply` must
  // contract (the matrix product), diverging from the matrix-literal and
  // matrix-returning-application paths (which already reach `mulTensors`). Keyed
  // on the static type, so no value is resolved on the scalar hot path; a
  // `vector<n>` operand does not match `matrix`, so vector Hadamard is unchanged.
  if (
    (operator === 'Add' || operator === 'Multiply') &&
    ops.some((x) => x.type.matches('matrix'))
  )
    return true;
  if (
    (operator === 'Add' ||
      operator === 'Multiply' ||
      operator === 'Negate' ||
      operator === 'Subtract' ||
      operator === 'Divide') &&
    ops.some((x) => isTuple(x))
  )
    return true;
  // `Equal`/`NotEqual` broadcast only in the list-vs-scalar case (Desmos
  // `L[d=4]`). When two or more operands are collections, keep the whole-list
  // (structural/mathematical) equality semantics — `Equal(L, M)` stays a scalar
  // boolean rather than a list of element-wise comparisons. Any collection
  // counts, not just finite indexed ones: `Equal(Set(…), List(…))` must not
  // broadcast over the list either. See
  // docs/plans/2026-07-07-desmos-list-filtering.md (highest-risk item).
  //
  // An operand that may only BECOME a collection at evaluation — a top-typed
  // application such as `q(2)` declared `(number) -> unknown`, or a
  // `broadcastable<T>` node — counts too (Tycho item 41): fanning the literal
  // out pre-evaluation while the opaque operand later evaluates to a
  // collection compounded two broadcasts into a cartesian nest
  // (`L(1) = [1,2]` → 2×2 lists of booleans) instead of the documented
  // whole-collection boolean. Skipping defers to the `Equal`/`NotEqual`
  // evaluate handler, which sees EVALUATED operands and re-applies the same
  // rule with full information (element-wise for list-vs-scalar via
  // `broadcastComparison`, whole-collection equality for two collections) —
  // so a possibly-collection operand that turns out scalar still broadcasts
  // element-wise, unchanged.
  //
  // An operand DEFINITELY typed as a collection counts as well: an
  // application such as `L(1)` under `L: (number) -> vector<2>` is a
  // collection VALUE the moment it evaluates, but it is not a collection NODE
  // (`isCollection` is false on an application) and its concrete type is
  // neither top nor `broadcastable`, so both predicates above miss it and the
  // pre-evaluation broadcast fanned `L(1) = [1,2]` elementwise. Surfaced when
  // placeholder-signature refinement (2026-08-15) started giving such
  // applications their concrete collection types.
  if (
    (operator === 'Equal' || operator === 'NotEqual') &&
    ops.filter(
      (x) =>
        x.isCollection ||
        isPossiblyCollectionTyped(x) ||
        x.type.matches('collection')
    ).length >= 2
  )
    return true;
  return false;
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
 * Returns `undefined` when there is nothing to thread, so the caller falls
 * through to normal evaluation — except for a `lazy` operator whose tail was
 * evaluated here and no longer holds a conditional, where the folded
 * application of the already-evaluated tail is returned to avoid re-evaluating
 * the operands.
 */
function threadConditional(
  ce: ComputeEngine,
  op: string,
  rawTail: ReadonlyArray<Expression>,
  lazy: boolean,
  options: Partial<EvaluateOptions> | undefined
): Expression | undefined {
  const tail = lazy ? rawTail.map((x) => x.evaluate(options)) : rawTail;

  // --- `When` lift (guard-outermost) ---
  if (tail.some((x) => isFunction(x, 'When'))) {
    const guards: Expression[] = [];
    const stripped = tail.map((x) => {
      if (isFunction(x, 'When')) {
        guards.push(x.op2);
        return x.op1;
      }
      return x;
    });
    const guard = guards.length === 1 ? guards[0] : ce._fn('And', guards);
    const inner = ce._fn(op, stripped).evaluate(options);
    return ce._fn('When', [inner, guard]).evaluate(options);
  }

  // --- `Which` distribution ---
  if (tail.some((x) => isFunction(x, 'Which'))) {
    // Each operand contributes a list of (condition, value) branches; a
    // non-`Which` operand is a single unconditional branch (condition = null).
    const branchSets = tail.map((x) => {
      if (isFunction(x, 'Which')) {
        const branches: { cond: Expression | null; value: Expression }[] = [];
        const ops = x.ops;
        for (let i = 0; i + 1 < ops.length; i += 2)
          branches.push({ cond: ops[i], value: ops[i + 1] });
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
      resultOps.push(cond, ce._fn(op, combo.value).evaluate(options));
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
  if (lazy) return ce._fn(op, tail).evaluate(options);

  return undefined;
}

/** Return the type of the value of the expression, without actually
 * evaluating it */
function type(expr: BoxedFunction): Type {
  if (!expr.isValid) return 'error';

  // Is this a 'Function' expression?
  // The arrow — parameters, result AND effect specifier — is built by the
  // single Stage 2 construction seam (`effects-inference.ts`). Nothing else in
  // the engine may assemble a `Function` literal's signature: a second builder
  // silently reintroduces the inline-callback gap. Guarded by
  // `test/compute-engine/effects-seam.test.ts`.
  if (expr.operator === 'Function') return functionLiteralSignatureType(expr);

  // Is there a definition associated with the operator of the function?
  const def = expr.operatorDefinition;
  if (def) {
    const sig =
      def.signature instanceof BoxedType
        ? def.signature.type
        : typeof def.signature === 'string'
          ? parseType(def.signature, expr.engine._typeResolver)
          : def.signature;

    // An overload set resolves to its most-specific viable arm, and the result
    // type is read off THAT arm (`docs/plans/2026-07-25-overload-resolution-
    // design.md` §6). Note the asymmetry with operand inference, which uses the
    // JOIN over every viable arm (§4.3): a result type wants the most precise
    // arm, an operand constraint must be the weakest — conflating them
    // reintroduces the §4.5 unsoundness.
    const resolved = resolvedArm(expr, sig) ?? sig;
    let sigResult = functionResult(resolved) ?? 'unknown';

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
    {
      const instantiated = instantiatedResultType(resolved, expr.ops, {
        // The SAME gate `box.ts` hands `validateArguments` (§4.5: validation
        // and result typing solve one constraint problem) — per position when
        // the signature declares `broadcastable<T>` slots.
        threadable:
          declaredSlots === undefined || def.broadcastable === true
            ? def.broadcastable
            : (i: number) => declaredSlots.at(i).mappable,
        stripMissing: (i) => def.stripsMissingAt(i),
        lazy: def.lazy,
      });
      if (instantiated !== undefined) sigResult = instantiated;
    }

    // Missing-value absorption (§3.B of the missing-value typing design). When
    // this application resolves to `propagate` and some operand carries a
    // `missing` arm, the base result is absorbed: every `missing` arm is
    // stripped and every numeric result cell widens to `number` (an absent
    // numeric cell contributes `NaN` — Q2/I6). Gated on `typeContainsMissing`,
    // so a Missing-free program's type is byte-identical.
    const absorbMissing =
      def.resolvedMissingBehavior === 'propagate' &&
      expr.ops.some((x) => typeContainsMissing(x.type.type));
    const maybeAbsorb = (t: Type): Type =>
      absorbMissing ? absorbNumericAbsence(t) : t;

    // If there is a type handler, call it. Strip-before-validate (§3.B step 3):
    // for a `propagate`/`handle` operator with an absent operand, convey the
    // stripped operand types via the `operandTypes` context override — a
    // handler consults `options.operandTypes[i]` before `ops[i].type` (no proxy
    // expressions, no interaction with the `_type` cache).
    if (typeof def.type === 'function') {
      const stripsAny =
        (def.resolvedMissingBehavior === 'propagate' ||
          def.resolvedMissingBehavior === 'handle') &&
        expr.ops.some(
          (x, i) => def.stripsMissingAt(i) && typeContainsMissing(x.type.type)
        );
      const operandTypes = stripsAny
        ? expr.ops.map((x, i) =>
            def.stripsMissingAt(i) && typeContainsMissing(x.type.type)
              ? stripMissingFromType(x.type.type)
              : undefined
          )
        : undefined;
      const calculatedType = def.type(expr.ops, {
        engine: expr.engine,
        operandTypes,
      });
      if (calculatedType) {
        if (calculatedType instanceof BoxedType)
          sigResult = calculatedType.type;
        else
          sigResult =
            parseType(calculatedType, expr.engine._typeResolver) ?? sigResult;
      }
    } else if (
      expr.ops.length > 0 &&
      (sigResult === 'number' || sigResult === 'finite_number')
    ) {
      // No explicit type handler and signature result is a broad numeric
      // type: try to narrow based on argument types.
      // E.g., if signature says "number" but all args are "integer",
      // narrow result to "finite_integer".
      //
      // This is a closure assumption (the operator maps its argument kinds to
      // the same kind) — sound only when the operands are provably finite. For
      // an operator with no type handler we cannot assume finite-in → finite-out
      // (e.g. an unknown `f` may send ∞ to a finite value), so a non-finite (or
      // unknown-finiteness) operand must not narrow the result finiteness
      // (SYMBOLIC P0-15). Gate the narrowing on every operand being provably
      // finite.
      const argTypes = expr.ops.map((op) => op.type.type);
      if (
        expr.ops.every((op) => op.isFinite === true) &&
        argTypes.every(
          (t) =>
            typeof t === 'string' &&
            NUMERIC_TYPES.includes(t as NumericPrimitiveType)
        )
      ) {
        const widened = widen(...argTypes);
        if (typeof widened === 'string' && isSubtype(widened, sigResult))
          sigResult = widened;
      }
    }

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
    // two arms disagree on a collection-valued result: this one applies
    // `broadcastElementType` (unwrapping it), the lambda arm deliberately does
    // not — `f := (x: number) -> list<number>` applied to `[1,2]` evaluates to
    // `[[1,1],[2,2]]` and must type `list<list<number>>`, not `vector<2>`.
    // A DECLARED `broadcastable<T>` parameter is an elementwise contract too
    // (Option A, ratified 2026-08-08 — Tycho defect 157(1)), so its application
    // must type exactly like the inferred path: definite collection → `list<R>`
    // (arm 1), possibly-collection → `broadcastable<R>` (arm 2). `broadcastable`
    // is DERIVED from `paramsAreScalar`, which answers false for such a
    // signature, so without this gate the DECLARED spelling typed strictly
    // WEAKER (bare `unknown`) than the `(number)` one it is meant to refine.
    // (`declaredSlots` is computed above, next to the arm resolution.)
    if ((def.broadcastable || declaredSlots) && !isLambdaDef(def)) {
      // O(rank) candidate check — see the §D4.2 note at the sibling sites.
      const hasTensors = expr.ops.some((x) => candidateShape(x) !== null);
      // `Equal`/`NotEqual` over TWO OR MORE definite collections is
      // whole-value equality — a scalar `boolean`, never a broadcast (see
      // `skipBroadcastForVectorOps`). That skip tests value-level
      // `isCollection`, which an unevaluated `Multiply`/`Add` intermediate
      // (typed `vector<n>` but with no collection handler) does not satisfy —
      // so mirror the same ≥2 rule at the TYPE level here, or
      // `Equal(10⁴·[1,2,3], 10⁴·[4,5,6])` would type `list<boolean>` while
      // evaluating to the scalar `False`. A SINGLE collection operand keeps
      // the lift (a collection-vs-scalar comparison genuinely broadcasts to
      // a boolean mask), and possibly-collection operands keep arm 2's
      // `broadcastable<boolean>` (sound for every outcome, including the
      // whole-value one).
      const typeLevelEqualitySkip =
        (expr.operator === 'Equal' || expr.operator === 'NotEqual') &&
        expr.ops.filter((x) => x.isCollection || isLinearAlgebraCollection(x))
          .length >= 2;
      if (
        !typeLevelEqualitySkip &&
        !skipBroadcastForVectorOps(expr.operator, hasTensors, expr.ops)
      ) {
        // Arm 1 (statically-visible collection) — PRIORITY. A materialized
        // finite indexed collection, an operand whose declared type is an
        // unbounded list / indexed-collection, or — when the handler's own
        // result COLLAPSED to a scalar — an operand whose type is a
        // FIXED-SHAPE (dimensioned) `vector<n>`/`matrix` unevaluated
        // intermediate such as `10^4·[1,2,3]` (`isFixedShapeCollection`; Tycho
        // 19.2's inlined-broadcast probe: without this trigger `sin(10^4·[…])`
        // collapsed to scalar `number` and `At` hard-rejected a provably-list
        // base). The fixed-shape trigger is deliberately NARROWER than
        // `isLinearAlgebraCollection` — a generic `collection`-kind operand may
        // be a non-indexed `set` the value path never broadcasts, and the
        // dimensionless list/indexed-collection case is already covered by the
        // `isBroadcastCollectionType` disjunct above. All matched operands
        // definitely produce a `List` at evaluation, so the honest type is the
        // concrete `list<E>`.
        //
        // The fixed-shape trigger DEFERS to a handler that GENUINELY computes
        // collection results — an ALLOWLIST, not a shape test: only
        // `Add`/`Multiply` (their own matrix/vector branches, which type
        // `matrix + scalar` as `matrix` and keep the honest widen only for
        // possibly-non-indexed `collection`/`set` operands — see `addType`)
        // and `Negate` (passes `x.type` through). Re-wrapping those would
        // collapse an honest `matrix` to an unbounded `list<…>` (it broke
        // `-M → matrix` and `det(M+N)`). Every OTHER handler that produces a
        // collection-bearing type over a collection operand did so by naive
        // `widen(…)` — e.g. `Remainder(10⁴·[1,2,3], 7)` widening to
        // `finite_integer | vector<3>` while the value ALWAYS broadcasts to a
        // list — and must be repaired to the definite `list<E>`, so the
        // allowlist is the ONLY thing that defers (a shape test on
        // `sigResult` cannot tell a deliberate union from a widen artifact).
        //
        // For the two pre-existing triggers the handler computed the scalar
        // per-element result. Some handlers leak the collection type or a
        // `scalar | list<E>` union (a naive `widen(…)` over a collection
        // operand); `broadcastElementType` unwraps both so the wrapper does
        // not nest a list or a union inside the broadcast result.
        const handlerOwnsCollectionTyping =
          expr.operator === 'Add' ||
          expr.operator === 'Multiply' ||
          expr.operator === 'Negate';
        const deferToHandler =
          handlerOwnsCollectionTyping &&
          (isSubtype(sigResult, 'collection') ||
            (typeof sigResult !== 'string' &&
              sigResult.kind === 'union' &&
              sigResult.types.some((m) => isSubtype(m, 'collection'))));
        const broadcastingOps = expr.ops.filter(
          (x, i) =>
            // Per-slot when the signature DECLARES `broadcastable<T>` slots: an
            // operand a collection-typed slot binds WHOLE never lifts the
            // result (the value path binds it whole too).
            (declaredSlots === undefined || declaredSlots.at(i).mappable) &&
            ((isFiniteIndexedCollection(x) && !isTuple(x)) ||
              isBroadcastCollectionType(x) ||
              (!deferToHandler && isFixedShapeCollection(x)))
        );
        if (broadcastingOps.length > 0) {
          // The wrapper below assumes `sigResult` is the SCALAR per-element
          // result, and unwraps one rank off it before re-shaping. ONE case
          // breaks that assumption — `sigResult` is already the WHOLE
          // broadcast result — producing a mixed encoding, a rank-2
          // `list<vector<E^2>^(2x2)>` where the value is a plain
          // `matrix<E^(2x2)>` (rank 1 round-tripped by luck, which is why this
          // only ever showed at rank ≥ 2):
          //
          //  An ALLOWLISTED handler that owns its own collection typing
          //  (`deferToHandler`): `Negate` passes `x.type` through, so
          //  `Negate([[1,2],[3,4]])` IS the operand's matrix. The gate
          //  already existed but only dropped the `isFixedShapeCollection`
          //  disjunct, which covers a matrix-TYPED symbol (`-M → matrix`)
          //  and misses a matrix LITERAL — that one still entered
          //  `broadcastingOps` via `isFiniteIndexedCollection` and got
          //  re-wrapped.
          //
          // What keeps a `sigResult` ON the wrapper path is a SHAPELESS
          // collection (`staticCollectionDims` is `null`) — this conjunct
          // decides alone (a union is never a `kind: 'list'` object, so it is
          // shapeless too): the `indexed_collection<integer>` of
          // `-Range(1,5)` is upgraded by the wrapper to the definite
          // `list<integer>`, and `Add(S, 1)`'s union is the widen artifact the
          // wrapper repairs. Note this arm is `Negate`-only today:
          // `Add`/`Multiply` are diverted by `skipBroadcastForVectorOps`
          // before arm 1 ever sees a shape-bearing operand.
          //
          // A POLYTYPE arm needs no second case any more (D10, re-ruled
          // 2026-08-04): the solver binds a lift-admitted operand's ELEMENT
          // type, so a `Chop`/`Conjugate` echo instantiates to the per-element
          // result and the wrapper below re-lifts it — the answer the retired
          // `liftedEchoPositions` short-circuit used to hand back verbatim,
          // and the correct one for a variable-MENTIONING result too. Ground
          // non-allowlisted operators (`Sin`, `Sqrt`) have neither an echo nor
          // a collection `sigResult` and fall through unchanged.
          if (
            deferToHandler &&
            isSubtype(sigResult, 'collection') &&
            staticCollectionDims(sigResult) !== null
          )
            return maybeAbsorb(sigResult);

          // Rank/shape-aware lift (§D6.1): mirror the operands'
          // statically-provable structure — `Sqrt(M)` with `M: matrix<2x2>`
          // types `list<finite_number^2x2>`, statically compatible with
          // `matrix` signature parameters. Falls back to the plain unbounded
          // `list<E>` whenever the shape is not provable from every
          // broadcasting operand (see `broadcastShapedResultType`).
          return maybeAbsorb(
            broadcastShapedResultType(
              broadcastingOps.map((x) => x.type.type),
              broadcastElementType(sigResult)
            )
          );
        }

        // Arm 2 (possibly-collection, step 2 phase C). No operand is a
        // statically-visible collection, but some operand's collection-ness is
        // not statically knowable — an application typed `unknown`/`any`/`value`
        // (e.g. an undeclared `h(x)`), or an already-`broadcastable<…>` node
        // (nested arithmetic). It might broadcast at runtime or stay scalar, so
        // the honest result is `broadcastable<E>` (not a definite `list<E>`).
        // `broadcastElementType(sigResult)` unwraps an already-broadcastable
        // `sigResult` (Add/Multiply handlers compute their own broadcastable
        // type), keeping the arm idempotent — never `broadcastable<broadcastable<…>>`.
        if (
          expr.ops.some(
            (x, i) =>
              (declaredSlots === undefined || declaredSlots.at(i).mappable) &&
              isPossiblyCollectionTyped(x)
          )
        )
          return maybeAbsorb({
            kind: 'broadcastable',
            elements: broadcastElementType(sigResult),
          });
      }
    }

    // Honest typing for user function-literal broadcast (Tycho 19.2). A lambda
    // operator definition (`ce.assign('g', x ↦ …)`) with scalar parameters:
    //  - Applied to a statically-visible finite collection argument, the runtime
    //    broadcasts element-wise (step 2b in `_computeValue`), producing a
    //    `List` — so the honest type is the concrete `list<E>`, not the scalar
    //    signature result computed above.
    //  - Applied to a POSSIBLY-collection argument (`broadcastable<…>` or a
    //    top-typed call, `isPossiblyCollectionTyped`), NO pre-evaluation step 2b
    //    fires (that gate only matches statically-visible finite indexed
    //    collections). The static type stays `broadcastable<E>` — NOT a definite
    //    `List` — because collection-ness is not statically provable here. At
    //    RUNTIME, however, the post-eval lambda-broadcast arm (step 4b sync /
    //    step 3b async in `_computeValue`) maps EVERY body element-wise — not
    //    only arithmetic bodies that broadcast internally — once the argument
    //    evaluates to a finite indexed collection, producing a `List`. So a
    //    non-arithmetic body (`x ↦ If(x > 0, 1, -1)`) applied to something that
    //    evaluates to a list is now mapped, not left inert.
    // The scalar-ness gate mirrors the runtime (declared signature authoritative
    // via `paramsAreScalar`; tuples atomic, bound whole, never mapped). A
    // collection-typed PARAMETER makes `paramsAreScalar` false, so a lambda that
    // consumes a whole collection keeps its scalar result unchanged.
    // A DECLARED `broadcastable<T>` slot enters here too (Option A): the
    // declaration is the gate, in place of `paramsAreScalar`'s all-or-nothing
    // inference verdict, and it lifts exactly the slots it marks.
    if (
      def instanceof _BoxedOperatorDefinition &&
      def._isLambda &&
      (paramsAreScalar(def) || declaredSlots)
    ) {
      // A numeric-tuple argument binds WHOLE to a scalar parameter (atomic,
      // never mapped), then the body's own arithmetic broadcasts it
      // element-wise (`g := x ↦ 2x`; `g((1,2))` evaluates `2·(1,2) = (2,4)`).
      // The INFERRED scalar signature result therefore disagrees with the
      // value, and we can't statically know the body's shape — return `any`.
      // A DECLARED signature is authoritative (the user promised the result
      // type), so it is left untouched below.
      if (def.inferredSignature && expr.ops.some((x) => isNumericTuple(x)))
        return 'any';
      // The TWIN of the value-definition arm below (generic-function-literals
      // design §2.5). A lambda operator definition can now carry a DECLARED
      // POLYTYPE (a generic function literal), so this arm instantiates the
      // arm at the LAMBDA's own `threadable` reading.
      // `def.broadcastable` is now DERIVED from `paramsAreScalar` for a
      // bare-assigned lambda (and stays false on other lambda routes), but
      // this arm is only reached under the `paramsAreScalar(def)` guard above
      // — which is precisely the statement that the runtime broadcasts here —
      // so the D10 lift is admitted unconditionally, exactly as
      // `paramsAreScalar(sig)` does on the value route. A ground signature
      // yields `undefined` and keeps `sigResult` untouched.
      const lambdaResult =
        instantiatedResultType(resolved, expr.ops, { threadable: true }) ??
        sigResult;
      // For a lambda application the per-element result IS the signature result
      // (`f := x ↦ [x, -x]` maps EACH element to `[x, -x]`, so the element type
      // is `list<number>`, not its unwrapped `number`). Use `sigResult`
      // verbatim — NOT `broadcastElementType(sigResult)`, which would unwrap a
      // collection-valued return and mis-type `f([1, 2])` as `list<number>`
      // instead of `list<list<number>>`.
      {
        const mapped = expr.ops.filter(
          (x, i) =>
            // Per-slot under a DECLARED `broadcastable<T>` signature: a
            // collection-typed slot binds its argument whole and never lifts.
            (declaredSlots === undefined || declaredSlots.at(i).mappable) &&
            ((isFiniteIndexedCollection(x) && !isTuple(x)) ||
              // Collection-TYPED operands too (Tycho item 73): `h(L+1)` /
              // `h(2L)` — an unevaluated expression statically typed as a
              // list/vector broadcasts through the lambda at runtime (the
              // post-eval lambda-broadcast arm maps it element-wise), so the
              // static type must be the lifted list as well, exactly as at
              // the generic wrapper's arm 1.
              isBroadcastCollectionType(x) ||
              isFixedShapeCollection(x))
        );
        if (mapped.length > 0) {
          // D10 (§4.4, re-ruled 2026-08-04): `lambdaResult` is the PER-ELEMENT
          // result — the solver bound each lift-admitted operand's element
          // type — so the ordinary wrap below is the whole answer. It
          // reproduces the retired echo short-circuit on the bare-echo shape
          // (`f([1,2,3])` under `(T) -> T where T` is `vector<…^3>`, since
          // `T` binds `finite_integer` and the wrap re-adds the operand's
          // rank) and fixes the variable-MENTIONING shapes the short-circuit
          // could not reach.
          // A collection-valued per-element result keeps the plain nested
          // lift (`f := x ↦ [x,-x]` over `[1,2]` → `list<vector<2>>`):
          // installing the collection result as the element of a dimensioned
          // list mixes encodings and breaks `evaluated ⊆ declared` (the
          // value is a rank-2 tensor with scalar leaves).
          const collectionValued =
            isSubtype(lambdaResult, 'collection') ||
            (typeof lambdaResult !== 'string' &&
              lambdaResult.kind === 'union' &&
              lambdaResult.types.some((m) => isSubtype(m, 'collection')));
          if (collectionValued) return broadcastResultType(lambdaResult);
          // Shape-aware (§D6.1): the map preserves the source's structure.
          return broadcastShapedResultType(
            mapped.map((x) => x.type.type),
            lambdaResult
          );
        }
      }
      if (
        expr.ops.some(
          (x, i) =>
            (declaredSlots === undefined || declaredSlots.at(i).mappable) &&
            isPossiblyCollectionTyped(x)
        )
      )
        return {
          kind: 'broadcastable',
          elements: lambdaResult,
        };
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
    const declaredType = expr.valueDefinition.type.type;
    const sigSource = isWildcardFunctionType(declaredType)
      ? (expr.valueDefinition.value?.type.type ?? declaredType)
      : declaredType;
    const sig = resolvedArm(expr, sigSource) ?? sigSource;
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
    if (threadable) {
      // As at the operator-def lambda site above: a numeric-tuple argument
      // binds whole to a scalar parameter and the body broadcasts it, so an
      // INFERRED signature result disagrees with the value — return `any`. A
      // DECLARED signature (`inferredType` false) is authoritative and kept.
      if (
        expr.valueDefinition.inferredType &&
        expr.ops.some((x) => isNumericTuple(x))
      )
        return 'any';
      // The per-element result IS the signature result for a lambda application
      // (see the operator-def lambda site above): use `sigResult` verbatim so a
      // collection-valued return types as `list<list<…>>` rather than being
      // flattened by `broadcastElementType`.
      {
        const mapped = expr.ops.filter(
          (x, i) =>
            // Per-slot under a DECLARED `broadcastable<T>` signature, as at the
            // operator-def lambda site above.
            (valueSlots === undefined || valueSlots.at(i).mappable) &&
            ((isFiniteIndexedCollection(x) && !isTuple(x)) ||
              // Collection-TYPED operands too (Tycho item 73): `h(L+1)` /
              // `h(2L)` — an unevaluated expression statically typed as a
              // list/vector broadcasts through the lambda at runtime (the
              // post-eval lambda-broadcast arm maps it element-wise), so the
              // static type must be the lifted list as well, exactly as at
              // the generic wrapper's arm 1.
              isBroadcastCollectionType(x) ||
              isFixedShapeCollection(x))
        );
        // Shape-aware (§D6.1), as at the operator-def lambda site above —
        // including the collection-valued-result exception.
        if (mapped.length > 0) {
          // D10 (§4.4, re-ruled 2026-08-04): as at the operator-def lambda
          // site above, `sigResult` is already the PER-ELEMENT result, so the
          // ordinary wrap below is the whole answer on this route too.
          const collectionValued =
            isSubtype(sigResult, 'collection') ||
            (typeof sigResult !== 'string' &&
              sigResult.kind === 'union' &&
              sigResult.types.some((m) => isSubtype(m, 'collection')));
          if (collectionValued) return broadcastResultType(sigResult);
          return broadcastShapedResultType(
            mapped.map((x) => x.type.type),
            sigResult
          );
        }
      }
      if (
        expr.ops.some(
          (x, i) =>
            (valueSlots === undefined || valueSlots.at(i).mappable) &&
            isPossiblyCollectionTyped(x)
        )
      )
        return {
          kind: 'broadcastable',
          elements: sigResult,
        };
    }
    return sigResult;
  }

  // We want to return the result of evaluating the function, so since
  // we don't know (somehow?) we return 'unknown', not 'function', which
  // is the type of the function itself, not of its result.
  return 'unknown';
}

function applyFunctionLiteral(
  expr: BoxedFunction,
  def: BoxedValueDefinition,
  options?: Partial<EvaluateOptions>
): Expression {
  const value = def.isConstant
    ? def.value
    : expr.engine._getSymbolValue(expr.operator);

  if (value && !value.type.matches('function')) {
    if (!value.isValid) return expr;
    return expr.engine.typeError('function', value.type, value.toString());
  }

  const ops = expr.ops.map((x) => x.evaluate(options));
  if (!value || value.type.isUnknown) {
    // The cached `_def` may be a function-typed *value* placeholder (created
    // by the `Assign`/`Declare` canonical pass, e.g. a block-local one-step
    // definition `f(x) = …` inside a function body) while the runtime
    // `ce.assign` created an *operator* definition, which
    // `_getSymbolValue` cannot read. If the symbol now resolves to an
    // operator definition, dispatch through it; otherwise stay symbolic.
    const opDef = expr.engine.lookupDefinition(expr.operator);
    if (opDef && isOperatorDef(opDef))
      return expr.engine.function(expr.operator, ops).evaluate(options);
    return expr.engine.function(expr.operator, ops);
  }

  // Broadcast if any operand is a finite indexed collection and the
  // function's parameter types are scalar. Zip operands and apply
  // pointwise, returning a List of results. Tuples are excluded
  // (`!isTuple`): a `Tuple` is an atomic value, bound whole, never mapped.
  // The DECLARED signature is authoritative for the broadcast decision when
  // present (a `:=` registration preserves it on the value definition — see
  // the declared-signature reconciliation): a collection-typed parameter
  // (e.g. `(tuple | list<tuple>) -> any`) binds its argument WHOLE. The
  // literal's own inferred type is only the fallback.
  const declaredType = def.type?.type;
  const broadcastGateType =
    typeof declaredType === 'object' && declaredType.kind === 'signature'
      ? declaredType
      : value.type.type;
  if (
    ops.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
    paramsAreScalar(broadcastGateType)
  ) {
    // Hybrid laziness, as at the operator-def lambda broadcast (step 2b):
    // past the eager threshold — or for a provably-finite collection of
    // unknown size — return the lazy `Map` form instead of materializing.
    // The `Map` body references the function by NAME (`g(_1)`), so each
    // element re-dispatches through this path on a scalar at drain time.
    const lazy = lazyBroadcastMapIfNeeded(
      expr.engine,
      expr.operator,
      ops,
      isBroadcastableCollection,
      options?.numericApproximation ?? false
    );
    if (lazy) return lazy;

    const items = zip(ops);
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
          results.push(
            zipped.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))
              ? expr.engine._fn(expr.operator, zipped).evaluate(options)
              : apply(value, zipped, options)
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
        annotateBroadcastErrors(expr.operator, results)
      );
    }
  }

  // The declared-`broadcastable<T>` elementwise map (Option A) — the value-def
  // twin of `_computeValue`'s step 2c. This is the route the
  // declare-then-assign spelling takes (`ce.declare('f',
  // '(broadcastable<value>) -> unknown')` then `ce.assign('f', x ↦ …)`), which
  // resolves to a VALUE definition rather than an operator definition. Reached
  // only when the broadcast above declined: `paramsAreScalar` is false for a
  // `broadcastable<T>` signature by design.
  const declaredPlan = broadcastableParamSlots(broadcastGateType);
  if (declaredPlan) {
    const mapped = declaredBroadcast(
      expr.engine,
      expr.operator,
      value,
      declaredPlan,
      ops,
      (x) => isFiniteIndexedCollection(x) && !isTuple(x),
      options
    );
    if (mapped) return mapped;
  }

  // The value is a function literal. Apply the arguments to it, threading
  // the caller's options — `numericApproximation` is honored inside the
  // function's scope frame (see makeLambda), preserving lexical scoping.
  return apply(value, ops, options);
}

/**
 * When `sig` is an overload set (an intersection of signatures), the arm this
 * application resolves to — the most-specific one whose parameters admit
 * `expr.ops`. `undefined` for a plain signature, for a non-overload type, and
 * when no arm fits. In that last case the caller falls back to
 * `functionResult` of the whole intersection, which is the §5.1 join over
 * every arm's result — NOT `unknown`; the operands have already been marked
 * invalid by `validateArguments`, so the imprecision is not load-bearing.
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
  const { selected, selectedInstance } =
    expr._resolvedOverload ??
    resolveOverload(expr.engine, expr.ops, arms, policies);
  if (selected === undefined) return undefined;

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
export function paramsAreScalar(
  source: BoxedOperatorDefinition | Type
): boolean {
  const sigType = isOperatorDefinition(source)
    ? source.signature?.type
    : source;
  if (!sigType || typeof sigType === 'string') return true;
  if (sigType.kind !== 'signature') return true;
  const args = [
    ...(sigType.args ?? []),
    ...(sigType.optArgs ?? []),
    ...(sigType.variadicArg ? [sigType.variadicArg] : []),
  ];
  // A QUANTIFIED parameter is read at its declared bound (§4.5): `T:
  // indexed_collection` can only ever denote a collection, so `(T) -> T` binds
  // its argument WHOLE exactly as the ground `(indexed_collection) -> …` does,
  // and no site may lift/thread over it. An unbounded variable keeps the scalar
  // default, and a ground signature (no `typeParams`) is untouched.
  return args.every((arg) => {
    const t = substituteDeclaredBounds(sigType.typeParams, arg.type);
    // A FUNCTION-typed parameter is a higher-order CALLBACK slot: its argument
    // is a function, never a collection, so it can never itself be broadcast
    // over — and it must not veto broadcasting of the OTHER parameters. This
    // predicate is all-or-nothing across the parameter list, so without the
    // exemption a single `(A) -> B` annotation silently switched off
    // broadcasting for every parameter of the function: `map(f, t.children)`
    // stopped mapping the moment `f` was annotated.
    //
    // The INFERENCE path already takes exactly this position — see
    // `inferredCollectionParameterType` (effects-inference.ts), which exempts
    // "a function-typed one (a higher-order callback slot)" so the
    // `broadcastable<T>` lift keeps firing. Before this, a DECLARED `(A) -> B`
    // parameter disagreed with an INFERRED one of the same shape.
    //
    // A COLLECTION-typed parameter deliberately still vetoes: it consumes a
    // whole collection, and suppressing the lift is what keeps a nested
    // collection argument from being descended into elementwise.
    if (isSubtype(t, 'function')) return true;
    return isScalarType(t);
  });
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
 *   (`docs/BROADCAST-MODEL.md`) or the lazy `Map` form;
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
  isBroadcastOperand: (x: Expression) => boolean,
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
  const mask = ops.map((x, i) => plan.at(i).mappable && isBroadcastOperand(x));
  if (!mask.some((m) => m)) return undefined;

  const mapped = ops.filter((_, i) => mask[i]);
  // Strict length policy, over the MAPPED slots only: a collection bound whole
  // at a non-mapped slot is not a broadcast participant and must not mismatch.
  const mismatch = broadcastLengthMismatch(ce, mapped);
  if (mismatch) return { value: mismatch };

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
  isBroadcastOperand: (x: Expression) => boolean,
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
  return ce._fn('List', annotateBroadcastErrors(operator, results));
}

/** The asynchronous twin of {@link declaredBroadcast}. */
async function declaredBroadcastAsync(
  ce: Expression['engine'],
  operator: string,
  literal: Expression,
  plan: BroadcastSlotPlan,
  ops: ReadonlyArray<Expression>,
  isBroadcastOperand: (x: Expression) => boolean,
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
  return Promise.all(results).then(
    (resolved) => ce._fn('List', annotateBroadcastErrors(operator, resolved)),
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
    return ce.typeError(t, el.type, el.toString());
  }
  return ce._fn('Apply', [literal, ...row]);
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

function isOperatorDefinition(
  source: BoxedOperatorDefinition | Type
): source is BoxedOperatorDefinition {
  return typeof source === 'object' && source !== null && 'signature' in source;
}

/**  Eagerly evaluate xs by iterating over its elements.
 *
 * If eager is true, evaluate DEFAULT_MATERIALIZATION elements.
 *
 * If eager is a number, evaluate that many elements, half in the head and
 * half in the tail.
 *
 * If eager is a tuple [head, tail], evaluate that many elements in the head and
 * that many elements in the tail.
 */
function materialize(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options?: Partial<EvaluateOptions>
): Expression {
  if (!expr.isValid || options?.materialization === false) return expr;

  // Emptiness indeterminate (e.g. Range(1, n) with a symbolic bound): the
  // collection cannot be enumerated, so fabricating a literal would collapse
  // it (previously to the 1-element list [1]). Keep the lazy form.
  if (expr.isEmptyCollection === undefined) return expr;

  let materialization = options?.materialization ?? false;
  if (typeof materialization === 'boolean')
    materialization = DEFAULT_MATERIALIZATION;

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
  const t = expr.type.type;
  const isIndexed =
    expr.isIndexedCollection ||
    ((t === 'unknown' || t === 'any' || t === 'value') &&
      def.collection?.at !== undefined &&
      expr.nops > 0 &&
      expr.op1.isIndexedCollection === true);
  const isFinite = expr.isFiniteCollection;

  // Leave oversized indexed collections in their lazy form. Consumers
  // can detect the size via `.count` without risking OOM.
  if (isIndexed && isFinite) {
    const count = expr.count;
    if (count !== undefined && count > expr.engine.maxCollectionSize)
      return expr;
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
    if (!isIndexed || !isFinite || expr.count === undefined) {
      //
      // If we're not indexed, or not finite (or of unknown length), we can
      // only materialize the head
      //
      const last =
        typeof materialization === 'number'
          ? materialization
          : materialization[0];
      const iter = expr.each();
      for (const x of iter) {
        if (xs.length === last) {
          // If we have more elements, add a ContinuationPlaceholder
          if (!iter.next().done)
            xs.push(expr.engine.symbol('ContinuationPlaceholder'));
          break;
        }
        xs.push(x.evaluate(options));
      }
    } else {
      //
      // We are indexed and finite, so we can materialize the head and tail
      //
      const [headSize, tailSize]: [number, number] =
        typeof materialization === 'number'
          ? [
              Math.ceil(materialization / 2),
              materialization - Math.ceil(materialization / 2),
            ]
          : materialization;

      // Materialize the head
      let i = 1;
      const iter = expr.each();
      for (const x of iter) {
        xs.push(x.evaluate(options));
        i += 1;
        if (i > headSize) break;
      }

      // Nothing enumerable despite claiming elements (e.g. Linspace with a
      // symbolic endpoint: concrete count, but its iterator declines): keep
      // the lazy form rather than fabricate a placeholder literal.
      if (xs.length === 0) return expr;

      const count = expr.count;
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
          xs.push(x.evaluate(options));
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

  // `Nothing` is an ERASURE marker: a lazy stream element that materialized as
  // `Nothing` (e.g. a `Map` body producing `Nothing`) is spliced out of the
  // resulting collection (§3.G). `Missing` is preserved. (The
  // `ContinuationPlaceholder` sentinel is not `Nothing`, so it survives.)
  const materialized = xs.filter((x) => !isSymbol(x, 'Nothing'));

  if (isIndexed) return expr.engine._fn('List', materialized);

  return expr.engine.function('Set', [...materialized]);
}
