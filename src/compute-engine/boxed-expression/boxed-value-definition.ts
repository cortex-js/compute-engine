import type {
  Expression,
  ExpressionInput,
  ValueDefinition,
  BoxedValueDefinition,
  CollectionHandlers,
  IComputeEngine as ComputeEngine,
  TypeProvenanceEntry,
} from '../global-types.js';
import type { FunctionInterface } from '../types-expression.js';
import {
  callsReach,
  calleeHomesDeclarationCount,
  collectCalleeHomes,
  declaredResultMemoKey,
  noteCalleeHomes,
  inListHypothesisPass,
  resultUnderDeclaredParameters,
  verifiedListHypothesis,
  beginSignatureDerivation,
  endSignatureDerivation,
  noteReentrantSignatureRead,
  reentrantSignatureReadCount,
  type SignatureDerivationFrame,
  withSignatureResult,
  type HomeScope,
} from './declared-parameter-result.js';

import type { EffectSet, Type, TypeString } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  collectionElementType,
  containsSignatureArm,
  functionResult,
  isValidType,
  isWildcardFunctionType,
  resolveTypeAlias,
  signatureEffects,
  widen,
} from '../../common/type/utils.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { reduceType } from '../../common/type/reduce.js';

import { defaultCollectionHandlers } from '../collection-utils.js';
import {
  type FactIndex,
  contextAssumedValues,
  contextAssumptions,
  getFactIndex,
  isDeclaredTypeOnly,
  isValueShielded,
  typeFor,
} from './constraint-subject.js';
import type { LatexString } from '../latex-syntax/types.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { cycleDetectionCount } from './cycle-guard.js';
import {
  type MemoDeps,
  memoDepsStillValid,
  snapshotMemoDeps as snapshotTypeDeps,
} from './collection-element-memo.js';
import {
  hasSignaturePlaceholder,
  inferFunctionLiteralEffects,
  matchesDeclaredTypeAxes,
  refineDeclaredPlaceholders,
  withArrowEffects,
} from './effects-inference.js';
import { isEffectSubset, unionEffectSets } from '../../common/type/effects.js';
import { declaredTypeError } from './type-compatibility-error.js';
import {
  functionLiteralDeclaredSignature,
  functionLiteralParameterName,
  functionLiteralParameterType,
  functionLiteralReturnType,
  isDestructuringParameter,
  isRestParameter,
  noteDefinitionCapturedTypes,
} from './function-literal.js';
import { isLatexString } from '../latex-syntax/utils.js';
import { parse as parseLatex } from '../latex-syntax/latex-syntax.js';
import { ConfigurationChangeListener } from '../../common/configuration-change.js';
import { CACHE_STATS, recordBump } from '../../common/cache-stats.js';
import type { CheckpointHookKind } from '../checkpoint-journal.js';
import { noteSymbolValue } from './residue-class-value-hook.js';

/**
 * Record this definition record's mutable state in the active checkpoint
 * journal window, once per window — the value-write, type-write and
 * bare-field definition funnels ("State coverage" in
 * `docs/CHECKPOINT-MODEL.md`; the mechanism is `checkpoint-journal.ts`).
 *
 * ONE key for the whole record rather than one per field: the snapshot is the
 * complete mutable field set, so a per-field key would take more snapshots to
 * cover the same state and restore it no more faithfully. `kind` therefore
 * only classifies the write for the bypass canary — it does not select what
 * is captured.
 *
 * A single field read when no checkpoint is live, which is every session that
 * never takes one; the snapshot itself is built only on the FIRST write to
 * this record in the window.
 *
 * Serves BOTH definition classes — the two snapshot tuples are different, but
 * the journaling protocol around them is not, and each half of a binding is
 * its own object, so the two never collide on a key.
 */
export function journalDefinitionRecord(
  ce: ComputeEngine,
  def: {
    _checkpointSnapshot(): unknown;
    _restoreCheckpointSnapshot(snapshot: unknown): void;
  },
  kind: CheckpointHookKind
): void {
  const w = ce._checkpointWindow;
  if (w === undefined) return;
  if (!w.claim(def, CHECKPOINT_DEF_KEY, kind)) return;
  const snapshot = def._checkpointSnapshot();
  w.push(() => def._restoreCheckpointSnapshot(snapshot));
}

/** The single journal key under which a definition record's whole mutable
 * field set is recorded — see {@link journalDefinitionRecord}. Shared with the
 * operator-definition hook so that a record whose two halves are both written
 * in one window still takes one snapshot per HALF, keyed on the half object.
 */
export const CHECKPOINT_DEF_KEY = 'definition-fields';

/**
 * ### THEORY OF OPERATIONS
 *
 * - The `_value` field IS the current value of the symbol. There is no
 *   separate "evaluation context" values map — the definition object is the
 *   single source of truth.
 *
 * - The `set value()` setter increments `ce._anyVersion` so that cached
 *   results depending on this symbol are invalidated.
 *
 * - The value or type of a constant cannot be changed.
 *
 * - When the type is changed, the value is preserved if it is compatible
 *   with the new type, otherwise it is reset to no value.
 *
 * - When the value is changed, the type is unaffected, and the setter does
 *   not check the value against the type: a definition declared `integer`
 *   keeps the string `"abc"` written to it. `ce.assign()` is the route that
 *   checks a value against the declared type (and types a function literal
 *   with the declared signature). A value written here that is not of the
 *   type is caught later, when a function literal that reads the symbol is
 *   called or compiled (`capturedValueMismatch()`, `function-utils.ts`).
 *
 */

/**
 * Does a trusted (standard-library) definition's value inhabit its declared
 * type? Decided EMPIRICALLY: the value is numericized and the concrete
 * result decides membership exactly (a literal's value always decides — the
 * 2026-08-12 admission ruling). Answers `true` — cannot refute — when the
 * value does not numericize to a number literal or evaluation fails (a
 * library-load ordering issue must not turn into a false alarm). Reached
 * only from inside a `console.assert`, so the production build never runs
 * it.
 */
function trustedValueInhabitsDeclaredType(
  ce: ComputeEngine,
  value: Expression,
  type: BoxedType
): boolean {
  try {
    const n = value.N();
    if (!isNumber(n)) return true;
    return matchesDeclaredTypeAxes(ce, n.type, type, false, n, '');
  } catch {
    return true;
  }
}

/** The definitions whose `_liveValueType()` read is running. A read of the
 * same definition from inside it (two stored values that read each other)
 * is answered without the memo, and the reads around it store nothing. */
const LIVE_TYPE_IN_FLIGHT = new Set<object>();
/** The number of such re-entrant reads so far. Compared before and after a
 * computation, as `cycleDetectionCount()` is. */
let liveTypeReentries = 0;
export class _BoxedValueDefinition
  implements BoxedValueDefinition, ConfigurationChangeListener
{
  readonly name: string; /** Used for debugging and error messages */

  wikidata?: string;
  description?: string | string[];
  keywords?: string[];
  /** The usage examples, each one line of Epsil source. A definition may
   * give a single string; it is stored as a one-element list. */
  examples?: string[];
  url?: string;

  private _engine: ComputeEngine;

  private _unsubscribeFromConfigurationChange?: () => void;

  // The defValue is the value as specified in the original definition.
  // It is used to update the actual value when the environment changes,
  // for example when the precision of the Compute Engine is changed.
  private _defValue?:
    | LatexString
    | ExpressionInput
    | ((ce: ComputeEngine) => ExpressionInput | null);

  // If `null`, the value needs to be recalculated from _defValue
  // If `undefined`, the value is not defined (for example, the symbol `True` does not have a value: the symbol itself *is* the value)
  private _value: Expression | undefined | null;

  // True if `_value` refers to this symbol by name (a self-referential
  // binding like `a := a + 1`). Computed once whenever the value is set.
  private _isSelfReferential = false;

  // If `null`, the type is the type of the value
  // Note that `_type` may be different (wider) than the value's type
  private _type: BoxedType | undefined | null;

  // If true, the `_type` is inferred
  inferredType = false;

  /** True for a block-local binding that `canonicalBlock` hoisted for a
   * `let` (or a block-introducing assignment) before the block's statements
   * were canonicalized, so that a reference from a nested block finds it. Such
   * a binding is `unknown`-typed until its statement runs or a literal
   * initializer types it; it is NOT a free mathematical symbol, so the
   * generic-symbol fold that reads an unknown bare symbol as a number
   * (`classifyCellD`, `library/collections.ts`) does not apply to it: in
   * `let c = match … ; out = join(out, [c])` the literal `[c]` is a `list`,
   * not a `vector<1>`, and `out` is not typed `list<number>` from it.
   * @internal */
  _blockLocal = false;

  /** The declared PLACEHOLDER SKELETON, when the declaration's type was a
   * bare collection constructor (`list`, `set`, `dictionary`, `collection`,
   * `indexed_collection` — each constrains collection kind without restricting
   * contents). The skeleton is the CONTRACT and never
   * moves; `_type` then carries the current element REFINEMENT, recomputed
   * from each assignment (`docs/INFERENCE_ROADMAP.md`, Phase 1 — ruled
   * 2026-08-18: re-refine on re-assignment; element only; `typeof` shows
   * the refinement). Assignment compatibility is checked against the
   * skeleton, so `a: list` still refuses `a = 42` after refining to
   * `list<integer>`, while `a = ["x"]` re-refines. `undefined` for
   * every other declaration. */
  _placeholderSkeleton: Type | undefined = undefined;

  /** The declared function signature as written, when it has `unknown`
   * slots (`hasSignaturePlaceholder`), such as `(unknown) -> unknown`. An
   * `unknown` slot is a placeholder, not a contract, so the signature this
   * definition reports is DERIVED on each read: the skeleton refined from
   * the current type of the stored function value
   * (`refineDeclaredPlaceholders`). Thus the result slot follows the body.
   * When a head that the body calls is bound after this assignment, the
   * reported result changes with the body's type, as it does for a symbol
   * declared with the bare `function` type. Each new assignment is checked
   * against the skeleton, not against an earlier refinement. `undefined`
   * for every other declaration. Read only while `inferredType` is false:
   * an inferred signature is revised by `_reviseInferredType` instead. */
  _signatureSkeleton: Type | undefined = undefined;

  /** The bare symbol an untyped `let` of this block local was initialized
   * from, when that symbol is itself an untyped, valueless, inferred binding
   * (a bare parameter of the enclosing function: `let out = acc`). Recorded
   * by the `Declare` canonical handler (`recordInitializerEvidence`,
   * `library/core.ts`), cleared by every later assignment to the local
   * (`joinAssignmentEvidence`, same file) and read by
   * `BoxedSymbol._inferWithoutFacts` (`boxed-symbol.ts`): the first use that
   * narrows this local narrows what it holds, which is the initializer's
   * value while no assignment has replaced it, so the same requirement is
   * written on the initializer as long as it is still untyped. Without it
   * `let out = acc; out = [...out, c]` left
   * `acc` untyped, and a call `f([1, 2])` broadcast over the list instead of
   * passing it whole (row 339 of the Tycho ledger,
   * `tycho/docs/COMPUTE_ENGINE.md`). Set once, at the declaration; a
   * checkpoint restores it with the binding. */
  _initializerAlias: Expression | undefined = undefined;

  /** True when an assignment to this binding recorded the type of its value
   * at canonicalization time (`joinAssignmentEvidence`, `library/core.ts`).
   * The static type of a valueless binding with this flag is the join of the
   * types of its assigned values only. A use of the binding (an argument at
   * a typed parameter) does not narrow it (`BoxedSymbol._inferWithoutFacts`,
   * `boxed-symbol.ts`), and the first assignment replaces a type that came
   * from uses only. The order of the uses and the assignments in a block
   * then does not change the static type. A narrowing by a use cannot be
   * part of that type: a meet with the uses is not sound, because it can
   * exclude a value that an assignment gives (`v = [1.5]` and a use at a
   * `list<integer>` parameter gave `vector<integer^1>`). */
  _assignmentEvidence: boolean = false;

  /** Memo of the signature derived from `_signatureSkeleton`, keyed on the
   * identities of the skeleton and of the stored value's type object. It is
   * not state, so a checkpoint does not capture it: a restore that changes
   * either key makes the memo miss. */
  private _signatureMemo:
    | {
        skeleton: Type;
        value: Expression;
        valueType: string;
        versions: string;
        /** The home scopes of the declared functions the body calls,
         * transitively (`collectCalleeHomes`), and the declarations counted
         * along their chains when the result was derived. */
        calleeHomes: HomeScope[];
        calleeCount: number;
        type: BoxedType;
        /** The engine's semantic, world and definition versions when the
         * result was derived: they move when a value is written, and when a
         * function is redefined or retyped. */
        definitions: string;
        /** The definitions that the free symbols of the body resolved to
         * when the result was derived (`_freeSymbolDefinitions`). */
        freeDefinitions: ReadonlyArray<object | undefined>;
      }
    | undefined = undefined;

  /** True while `_deriveSignature` reads the stored value's type. A
   * transient re-entrancy guard, not state. */
  private _derivingSignature = false;

  /** The result type a RECURSIVE call of the stored function reads while
   * `_deriveSignature` verifies its list hypothesis: the re-entrant read
   * answers the recorded type with its result slot replaced by this type.
   * `undefined` outside that pass, where the re-entrant read answers the
   * recorded type unchanged. Transient, not state. */
  private _recursionResult: Type | undefined = undefined;

  /** The skeleton that {@link _wildcardRecursiveSignature} derives the
   * signature from, with the function literal it was built for, or no
   * skeleton when that literal does not call itself (then with the engine
   * versions the answer was read at). Rebuilt when the stored literal
   * changes; the skeleton object stays the same between reads so that the
   * signature memo, which keys on its identity, can hit. Not state. */
  private _wildcardSkeleton:
    | {
        literal: Expression;
        versions: string;
        skeleton: BoxedType | undefined;
      }
    | undefined = undefined;

  // History of writes to this definition's type (see `TypeProvenanceEntry`
  // in `types-definitions.ts` and the phase-1 design in
  // `docs/TYPE-SYSTEM.md`). Declared here
  // — rather than assigned on demand — so recording provenance does not
  // change the object's shape; allocated on the first recorded write.
  // Explicit declarations and value-promoted types record no entry (they
  // are derivable from `inferredType`), so most definitions never allocate.
  _typeProvenance: TypeProvenanceEntry[] | undefined = undefined;

  // Annotation provenance on the EFFECTS axis of a function-typed declaration
  // — the effects-axis analog of `inferredType` (`docs/EFFECTS-MODEL.md`,
  // "Annotation provenance"). True when the declaration STATED the arrow's
  // effects (a non-empty specifier, or the `pure` keyword, which the type
  // itself cannot record). False — the default — leaves effects on the
  // inferred track.
  effectsDeclared = false;

  // If `true`, the value or type cannot be changed
  _isConstant = false;

  // Debug tombstone (`binding-tombstone.ts`): where and in which scope this
  // binding was discarded. Only ever set when `ce._debugBindings` is on;
  // declared here (rather than assigned on demand) so turning the flag on does
  // not change the object's shape.
  _deadStack: string | undefined = undefined;
  _deadScope: string | undefined = undefined;

  // The STATIC binding this definition is a per-call activation of, when it is
  // a `Function` call frame's parameter binding (`markActivation`,
  // `binders.ts`; `docs/SCOPING-MODEL.md`).
  // Declared here — rather than assigned on demand — so a call frame's
  // definition keeps the same object shape as every other one.
  _activationOf: BoxedValueDefinition | undefined = undefined;

  // A runtime copy of an ordinary scoped binding. Unlike a parameter
  // activation, this binding can escape in a lazy collection's result.
  _scopeActivationOf: BoxedValueDefinition | undefined = undefined;

  // True when this binding is a SHIELD: a valueless shadow declared solely to
  // hide an enclosing binding's value (`withValueShield` in `utils.ts`,
  // `simplifyValueBlind` in `simplify.ts`). Read by `evaluateInOwnBindings`'s
  // restriction 2 (`markShieldDeclaration`, `binders.ts`;
  // `docs/SCOPING-MODEL.md`). Declared here —
  // rather than assigned on demand — so a shield keeps the same object shape
  // as every other definition.
  _isShield: true | undefined = undefined;

  // True when this binding was created to shadow a standard-library operator
  // used as a bare value (`N + 1`, `S / D`). This provenance belongs to the
  // binding itself; replacing the definition naturally discards the marker.
  _isDevolvedShadow: true | undefined = undefined;

  // Bumped on every semantic change to THIS definition (value write, type
  // change, disposal). Used with binding-identity re-resolution to validate
  // per-dependency caches (the `Comprehension` element memo) without an
  // engine-global invalidation.
  _writeVersion = 0;

  // If 'never', the symbol is replaced by its value during canonicalization.
  // If 'evaluate', the symbol is replaced by its value during evaluation.
  // If 'N', the symbol is replaced during a numeric evaluation.
  holdUntil: 'never' | 'evaluate' | 'N' = 'evaluate';

  // Those optional handlers are used to compare the symbol with other
  // symbols or values. This is useful for example with sets
  eq?: (a: Expression) => boolean | undefined;
  neq?: (a: Expression) => boolean | undefined;
  cmp?: (a: Expression) => '=' | '>' | '<' | undefined;

  // This optional handler is used to do collection operations on the symbol
  collection?: CollectionHandlers;

  // This optional handler is used to evaluate subscripted expressions of this symbol
  subscriptEvaluate?: (
    subscript: Expression,
    options: { engine: ComputeEngine; numericApproximation?: boolean }
  ) => Expression | undefined;

  constructor(
    ce: ComputeEngine,
    name: string,
    def: Partial<ValueDefinition>,
    options?: {
      /** Set by the standard-library install route only
       * (`setSymbolDefinitions`): the library's declared types are
       * TRUSTED, so a value whose STATIC type cannot witness the
       * declaration (an unevaluated constant such as `GoldenRatio`'s
       * `(1+√5)/2` against a value-bracket range) is not refused — it is
       * validated EMPIRICALLY instead, under `console.assert`, which the
       * production build strips. User `ce.declare` never sets this and
       * keeps the throwing check. (User-ruled 2026-08-23.) */
      trustedLibraryDefinition?: boolean;
    }
  ) {
    this._engine = ce;
    this.name = name;
    // The whole constructor is a type WRITE: the `declare(name, { value })`
    // route derives `_type` from the value it is handed, and that derived type
    // is a contract the next `forget()` must not falsify. Running the body
    // with the assumptions hidden is what keeps `declare q real; assume q > 3;
    // declare M { type: list, value: [q] }` storing `list<real>` rather than
    // `list<real<3<..>>` (`docs/plans/2026-08-29-assumptions-as-facts-type.md`
    // §2.4). Everything else the body does — validation, handler copying — is
    // unaffected by the hiding, so the bracket spans the whole of it rather
    // than the derivation alone.
    ce._withoutFacts(() => this._construct(def, options));
  }

  private _construct(
    def: Partial<ValueDefinition>,
    options?: { trustedLibraryDefinition?: boolean }
  ): void {
    const ce = this._engine;

    if (def.wikidata) this.wikidata = def.wikidata;
    if (def.description) this.description = def.description;
    if (def.keywords) this.keywords = def.keywords;
    if (def.examples !== undefined)
      this.examples =
        typeof def.examples === 'string' ? [def.examples] : [...def.examples];
    if (def.url) this.url = def.url;

    if (def.holdUntil) this.holdUntil = def.holdUntil;

    if (def.isConstant) {
      this._isConstant = def.isConstant;
      // Note it's OK for a constant to have no value (e.g. True)
      this._defValue = def.value;
    }

    if (def.type) {
      // Note: the type can be narrowed or widened. The canonicalization
      // handlers cannot make assumptions based on the type.
      // A type STRING may name a type declared in this engine's scopes, so it
      // has to be parsed against the resolver — without it `{ type: "point" }`
      // fails to parse and reports the user type as invalid. And `isValidType`
      // takes a `Type`, not a `BoxedType`: handing it the wrapper made every
      // `{ type: ce.type(…) }` declaration report "invalid".
      const type =
        def.type instanceof BoxedType
          ? def.type.type
          : parseType(def.type, ce._typeResolver);
      if (!isValidType(type))
        throw new Error(
          [`Symbol "${this.name}"`, `The type "${def.type}" is invalid `].join(
            '\n|   '
          )
        );

      this._type = new BoxedType(type, ce._typeResolver);
      this.inferredType = def.inferred ?? false;
      if (!this.inferredType)
        this._placeholderSkeleton = placeholderSkeletonOf(type);
      if (hasSignaturePlaceholder(type)) this._signatureSkeleton = type;
    }

    this.effectsDeclared = def.effectsDeclared ?? false;

    this._value = dynamicValue(this._engine, def.value);
    // As in the `value` setter: record the captured types of a function
    // literal that the definition is made with (`noteDefinitionCapturedTypes()`).
    if (this._value && isFunction(this._value, 'Function'))
      noteDefinitionCapturedTypes(this, this._value);
    this._isSelfReferential = isSelfReferentialValue(this.name, this._value);
    noteSymbolValue(this._engine, this._value);

    if (this._value) {
      if (!this._type || this._type.isUnknown) {
        // Infer the type from the value if no type is specified
        if (this.isConstant) {
          // If this is a constant, the type is exactly the type of the value
          this._type = this._value.type;
          this.inferredType = false;
        } else {
          // If this is a variable, we "promote" the inferred type based on the value's type
          this._type = inferTypeFromValue(ce, this._value);
          this.inferredType = true;
        }
      } else {
        // If the value is not compatible with the type, throw.
        //
        // Judged PER AXIS (`docs/EFFECTS-MODEL.md`, "Annotation provenance"):
        // parameters and result are the declared axes, but the effects axis is
        // judged by its own provenance. A `Function` literal's arrow always
        // carries the effects the body walk INFERRED, so a `{scope}` closure
        // stored under a declaration written `(number) -> number` — a bare
        // slot, i.e. the inferred track — must not fail the covariant
        // `matches()`. When the declaration STATED effects (a non-empty
        // specifier, or `pure`) they are a contract and are checked here too.
        if (
          !matchesDeclaredTypeAxes(
            ce,
            this._value.type,
            this._type,
            this.effectsDeclared,
            this._value,
            this.name
          )
        ) {
          if (options?.trustedLibraryDefinition) {
            // A trusted (standard-library) declaration is the author's
            // knowledge, which may exceed what the value's static type can
            // witness — the whole point of a value-bracket type on an
            // expression-valued constant. Validate it empirically instead:
            // numericize the value and let the concrete result decide
            // membership exactly. Development builds get a loud assert on a
            // wrong bracket; the production build strips the call (and the
            // evaluation inside it) entirely.
            console.assert(
              trustedValueInhabitsDeclaredType(ce, this._value, this._type),
              `Symbol "${this.name}": the standard-library value "${this._value.toString()}" does not inhabit the declared type "${this._type.toString()}"`
            );
          } else {
            throw declaredTypeError(this.name, this._value, this._type);
          }
        }
        // A symbol with no value and no type as the value of a DECLARED type
        // is a use of that symbol at the declared type: narrow it, as the
        // assignment route does (`assignFn`, `engine-declarations.ts`).
        // Without this, `ce.declare('r', { type: 'real', value: zz })` left
        // `zz` typed `unknown`, a type that the declared `real` does not
        // contain.
        else if (
          !this.inferredType &&
          isSymbol(this._value) &&
          this._value.type.isUnknown &&
          this._value.value === undefined
        ) {
          const contract = this._placeholderSkeleton ?? this._type.type;
          this._value._infer(() => contract, 'narrow');
        }
        // A declared placeholder skeleton refines from the initializer,
        // exactly as it refines from an assignment (Phase 1 rulings, ruled
        // 2026-08-18): `let a: list = [1, 2, 3]` reports
        // `list<integer>` just as the split `let a: list; a = [1,2,3]`
        // does.
        if (this._placeholderSkeleton !== undefined) {
          const refined = refineConstructorPlaceholder(
            this._placeholderSkeleton,
            this._value.type.type
          );
          if (refined !== this._type.type)
            this._type = new BoxedType(refined, ce._typeResolver);
        }
      }
    }

    if (def.eq) this.eq = def.eq;
    if (def.neq) this.neq = def.neq;
    if (def.cmp) this.cmp = def.cmp;

    if (def.collection) {
      this.collection = defaultCollectionHandlers(def.collection);
    }

    if (def.subscriptEvaluate) this.subscriptEvaluate = def.subscriptEvaluate;

    if (this.holdUntil === 'never' && !this.isConstant)
      throw new Error(
        [
          `Symbol "${this.name}"`,
          `The "holdUntil" property cannot be "never" for a non-constant symbol`,
        ].join('\n|   ')
      );

    // Only constants need to react to configuration changes: their value may
    // be precision-dependent (e.g. `Pi`, `EulerGamma`) and must be recomputed
    // from `_defValue` when the precision or angular unit changes. See
    // `onConfigurationChange()`. Non-constants and operator definitions don't
    // listen, which keeps engine construction cheap.
    if (this.isConstant)
      this._unsubscribeFromConfigurationChange =
        ce._listenToConfigurationChange(this);
  }

  /** For debugging */
  toJSON() {
    const result: Record<string, unknown> = {
      name: this.name,
      isConstant: this._isConstant,
    };
    if (this.wikidata) result.wikidata = this.wikidata;
    if (this.description) result.description = this.description;
    if (this.keywords) result.keywords = this.keywords;
    if (this.examples) result.examples = this.examples;
    if (this.url) result.url = this.url;
    if (this._type) result.type = this._type.toString();
    result.inferredType = this.inferredType;
    result.holdUntil = this.holdUntil;
    if (this.collection) result.collection = this.collection;

    return result;
  }

  get isConstant(): boolean {
    return this._isConstant;
  }

  get isSelfReferential(): boolean {
    return this._isSelfReferential;
  }

  /** The value STORED on this definition — what `assign()`, a
   * `declare(name, { value })` or a library constant put here — with no
   * assumed value overlaid on it.
   *
   * This is the write path's read: a definition is USER-VALUED when this is
   * defined, and a value an `assume(x = …)` put in force is not stored here
   * at all (it lives in the context's assumed-value overlay, which the scope
   * that assumed it discards on its pop). */
  get storedValue(): Expression | undefined {
    // While `_withTransientPrecision` runs a function, the precision is not
    // the working precision of the engine. The value of a constant (`Pi`)
    // is then computed again at the current precision and not stored: the
    // stored value keeps the working precision, and a value stored here
    // would be read later at the working precision.
    if (
      this._isConstant &&
      this._defValue !== undefined &&
      this._engine._atTransientConfiguration
    )
      return dynamicValue(this._engine, this._defValue);
    if (this._value === null)
      this._value = dynamicValue(this._engine, this._defValue);
    return this._value;
  }

  /** For a constant, its value computed again from `_defValue` at the
   * current precision. The result is not stored: the stored value keeps the
   * working precision of the engine. The assumed-value overlay of the
   * `value` getter is ignored on purpose: a constant has no assumed value.
   * Read it only inside `_withTransientPrecision` (the exact ordering in
   * `compare.ts`). */
  _valueAtCurrentPrecision(): Expression | undefined {
    if (!this._isConstant) return undefined;
    return dynamicValue(this._engine, this._defValue);
  }

  /**
   * The value this definition has in the CURRENT state: the assumed value the
   * context puts in force, else the stored one.
   *
   * `undefined` while a recording-time shield hides this definition, so that
   * `assume()` records a predicate about the SYMBOL rather than folding it
   * through the value (`w := 5; assume(w > 0)`; see `withShieldedValues`).
   */
  private _effectiveValue(): Expression | undefined {
    if (isValueShielded(this)) return undefined;
    const overlay = contextAssumedValues(this._engine);
    if (overlay.size !== 0) {
      const assumed = overlay.get(this);
      if (assumed !== undefined) return assumed;
    }
    return this.storedValue;
  }

  get value(): Expression | undefined {
    return this._effectiveValue();
  }

  set value(v: Expression | undefined) {
    if (this._isConstant)
      throw new Error(`Cannot set value of constant "${this.name}"`);
    // No-op dispatch guard (design §4, step 5): re-writing the IDENTICAL
    // value object is a state-identical write, and suppression is TOTAL —
    // no event, no axis advance, no `_writeVersion` (a spurious local bump
    // would cold the element memo's per-dependency entries). Object
    // identity ONLY: structural equality (`.isSame`) is syntactic, not
    // binding-identity, and must not suppress (design §4's predicate table).
    if (v !== undefined && v === this._value) return;
    // Checkpoint journal (funnel 1): the WHOLE coupled tuple, not just
    // `_value` — a value write also moves `_isSelfReferential`, and the type
    // setter next door moves `_value` — recorded once per window, after the
    // no-op guard above so a suppressed write journals nothing.
    journalDefinitionRecord(this._engine, this, 'value-write');
    const prev = this._value;
    this._value = v;
    // The type of a definition that holds a function literal is inferred
    // from the literal now: record the types of the bindings that its body
    // reads from outside it, so that a call after one of them changed type
    // is checked (`capturedTypesWidened()`, `function-literal.ts`).
    // (User decision 2026-10-25, option (c) of CE-473 in `ROADMAP.md`.)
    if (v !== undefined && isFunction(v, 'Function'))
      noteDefinitionCapturedTypes(this, v);
    this._isSelfReferential = isSelfReferentialValue(this.name, v);
    noteSymbolValue(this._engine, v);

    const ephemeral = this._engine._ephemeralWriteDepth > 0;
    // `callable` classification (design §4): the write is callable-relevant
    // when either side is (or contains, one level down) a `Function`
    // literal, or the definition's EFFECTIVE type carries a signature arm
    // anywhere (deep — the R1 list-of-callbacks shape). A declared type is
    // authoritative for type-level reach; otherwise the effective type
    // derives from the value, on each side of the swap.
    //
    // Unconditional since migration step 3: the `callable` axis (which keys
    // `BoxedFunction._effects`) is this flag's live consumer, and the cost —
    // O(size of the traversed type/value fragment), a couple of property
    // reads for scalar writes — is budgeted in the design's §3 ("pay for
    // precision at write sites, never at read sites").
    const litCallable = (x0: Expression | null | undefined): boolean => {
      if (x0 == null) return false;
      const x = x0 as {
        operator?: string;
        ops?: ReadonlyArray<{ operator?: string }> | null;
        _numericStore?: readonly number[];
      };
      if (x.operator === 'Function') return true;
      // A store-backed list (`ce.list()`) holds numbers only: no `Function`
      // literal inside, and reading its `ops` would box every element.
      if (x._numericStore !== undefined) return false;
      return x.ops?.some((o) => o.operator === 'Function') ?? false;
    };
    let callable = litCallable(prev) || litCallable(v);
    if (!callable) {
      if (this._type != null) callable = containsSignatureArm(this._type.type);
      else
        callable =
          containsSignatureArm(prev?.type?.type) ||
          containsSignatureArm(v?.type?.type);
    }
    this._engine._noteStateEvent({ kind: 'value-write', ephemeral, callable });

    if (CACHE_STATS)
      recordBump(ephemeral ? 'ephemeralValueWrite' : 'valueWrite');
    this._writeVersion += 1;
    // Axis advancement comes from the `value-write` event above: ephemeral
    // loop-index writes (big-op/comprehension index assigns) advance the
    // `any` axis and this definition's `_writeVersion` but NOT `semantic` —
    // they must not invalidate mutation-keyed caches of expressions that
    // don't reference the index (the event's `ephemeral` flag carries this).
  }

  /** Snapshot the coupled type/value slots for an exact later restore —
   * see `_restoreTypeSlots`. The result is OPAQUE to callers (typed
   * `unknown` on the public interface): it captures private fields,
   * including states the public setters cannot express (`_type === null`
   * means "type derived from the value"), so peeking or constructing one
   * outside this class is meaningless.
   * @internal */
  _typeSlotSnapshot(): unknown {
    return {
      _type: this._type,
      _value: this._value,
      _defValue: this._defValue,
      inferredType: this.inferredType,
      _isSelfReferential: this._isSelfReferential,
      // The two skeletons are written by the same type setter as `_type`, so
      // a restore without them would leave a skeleton that no longer
      // matches the restored type.
      _placeholderSkeleton: this._placeholderSkeleton,
      _signatureSkeleton: this._signatureSkeleton,
      // The evidence flag decides how the next write joins the type, so it
      // is restored with the type.
      _assignmentEvidence: this._assignmentEvidence,
      // Effects annotation provenance rides in the tuple: the typed-`let`
      // upgrade writes it alongside `type`/`inferredType`
      // (`docs/EFFECTS-MODEL.md`, rollback
      // completeness), so a restore without it would leave the contract
      // bit stale.
      effectsDeclared: this.effectsDeclared,
    };
  }

  /** Restore the slots captured by `_typeSlotSnapshot`, verbatim and
   * setter-bypassing. The public `type` setter is a computed view — it
   * always allocates a fresh `BoxedType`, and writing `unknown` through it
   * WIPES `_value`/`_defValue` — so a faithful restore must write the
   * private fields directly. `_isSelfReferential` rides along because the
   * value setter recomputes it on every value write; restoring `_value`
   * without it would leave the recursion guard stale. `_writeVersion` is
   * deliberately bumped, not restored: monotone invalidation counters only
   * ever advance (over-invalidation is a recompute; resurrection of a
   * stale cache entry would be a wrong answer). Phase 2a of
   * `docs/TYPE-SYSTEM.md`.
   * @internal */
  _restoreTypeSlots(snapshot: unknown): void {
    const s = snapshot as {
      _type: BoxedType | undefined | null;
      _value: Expression | undefined | null;
      _defValue:
        | LatexString
        | ExpressionInput
        | ((ce: ComputeEngine) => ExpressionInput | null)
        | undefined;
      inferredType: boolean;
      _isSelfReferential: boolean;
      _placeholderSkeleton: Type | undefined;
      _signatureSkeleton: Type | undefined;
      _assignmentEvidence: boolean;
      effectsDeclared: boolean;
    };
    this._type = s._type;
    this._assignmentEvidence = s._assignmentEvidence;
    this._placeholderSkeleton = s._placeholderSkeleton;
    this._signatureSkeleton = s._signatureSkeleton;
    this._value = s._value;
    this._defValue = s._defValue;
    this.inferredType = s.inferredType;
    this._isSelfReferential = s._isSelfReferential;
    this.effectsDeclared = s.effectsDeclared;
    this._writeVersion += 1;
  }

  /**
   * Snapshot EVERY mutable field of this record, for the checkpoint journal
   * (`checkpoint-journal.ts`, and "State coverage" in
   * `docs/CHECKPOINT-MODEL.md`). Deliberately
   * a different, wider tuple than {@link _typeSlotSnapshot}: that one covers
   * the six slots an inference re-derivation can move, and a checkpoint has
   * to rewind a whole cell's worth of arbitrary program writes.
   *
   * **Review rule: adding a mutable field to this class means extending this
   * snapshot and its restore.** The completeness of the tuple is what makes
   * the restore observationally equivalent to a fresh engine, and a field
   * left out is silently carried across a rewind. The drift guard is
   * `test/compute-engine/checkpoint-journal.test.ts`, which compares this
   * tuple's key set against the record's own property names and fails on any
   * field that is neither captured nor listed there as deliberately excluded.
   *
   * Excluded, each for a stated reason: `name` and `_engine` are identity and
   * never move; `_writeVersion` is a monotone invalidation counter, which the
   * restore BUMPS rather than restores (over-invalidation is a recompute,
   * resurrecting a stale cache entry is a wrong answer); and
   * `_unsubscribeFromConfigurationChange` is a live subscription handle owned
   * by {@link dispose}, so writing an older one back would either double-
   * unsubscribe or strand a listener.
   *
   * The result is OPAQUE to callers (typed `unknown`): it captures private
   * fields and states no public setter can express — `_type === null` means
   * "type derived from the value" — so constructing or peeking at one outside
   * this class is meaningless.
   * @internal */
  _checkpointSnapshot(): unknown {
    return {
      wikidata: this.wikidata,
      description: this.description,
      keywords: this.keywords,
      examples: this.examples,
      url: this.url,
      _defValue: this._defValue,
      _value: this._value,
      _isSelfReferential: this._isSelfReferential,
      _type: this._type,
      inferredType: this.inferredType,
      _blockLocal: this._blockLocal,
      _placeholderSkeleton: this._placeholderSkeleton,
      _signatureSkeleton: this._signatureSkeleton,
      _initializerAlias: this._initializerAlias,
      _assignmentEvidence: this._assignmentEvidence,
      // COPIED, not aliased: provenance is appended to in place, so a
      // snapshot sharing the array would grow with the writes it exists to
      // undo and restore the post-write history.
      _typeProvenance: this._typeProvenance?.slice(),
      effectsDeclared: this.effectsDeclared,
      _isConstant: this._isConstant,
      _deadStack: this._deadStack,
      _deadScope: this._deadScope,
      _activationOf: this._activationOf,
      _scopeActivationOf: this._scopeActivationOf,
      _isShield: this._isShield,
      _isDevolvedShadow: this._isDevolvedShadow,
      // A definition disposed inside a checkpoint window comes back alive on
      // restore, like every other field of the record: the record object is
      // restored in place and live expressions still hold it by identity.
      disposed: this.disposed,
      holdUntil: this.holdUntil,
      eq: this.eq,
      neq: this.neq,
      cmp: this.cmp,
      collection: this.collection,
      subscriptEvaluate: this.subscriptEvaluate,
    };
  }

  /** A private runtime binding for an asynchronous activation of a binder.
   * Copy the definition's state without sharing its subscription handle or
   * re-inferring its type. The template remains alive for later evaluations. */
  _cloneForActivation(): _BoxedValueDefinition {
    const result = new _BoxedValueDefinition(this._engine, this.name, {});
    result._restoreCheckpointSnapshot(this._checkpointSnapshot());
    result.disposed = false;
    result._deadStack = undefined;
    result._deadScope = undefined;
    result._scopeActivationOf = this._scopeActivationOf ?? this;
    if (
      (this as unknown as { _isBinderVariable?: true })._isBinderVariable ===
      true
    )
      (
        result as _BoxedValueDefinition & { _isBinderVariable?: true }
      )._isBinderVariable = true;
    return result;
  }

  /** Restore the fields captured by {@link _checkpointSnapshot}, verbatim and
   * setter-bypassing — the public `type` setter is a computed view that
   * allocates a fresh `BoxedType` and wipes `_value`/`_defValue` on a write
   * to `unknown`, so a faithful restore must write the private fields. The
   * record OBJECT is never replaced: live boxed expressions hold it by
   * identity.
   * @internal */
  _restoreCheckpointSnapshot(snapshot: unknown): void {
    const s = snapshot as ReturnType<
      _BoxedValueDefinition['_checkpointSnapshot']
    > &
      Record<string, unknown>;
    this.wikidata = s.wikidata as string | undefined;
    this.description = s.description as string | string[] | undefined;
    this.keywords = s.keywords as string[] | undefined;
    this.examples = s.examples as string[] | undefined;
    this.url = s.url as string | undefined;
    this._defValue = s._defValue as typeof this._defValue;
    this._value = s._value as typeof this._value;
    this._isSelfReferential = s._isSelfReferential as boolean;
    this._type = s._type as typeof this._type;
    this.inferredType = s.inferredType as boolean;
    this._blockLocal = s._blockLocal as boolean;
    this._placeholderSkeleton = s._placeholderSkeleton as Type | undefined;
    this._signatureSkeleton = s._signatureSkeleton as Type | undefined;
    this._initializerAlias = s._initializerAlias as Expression | undefined;
    this._assignmentEvidence = s._assignmentEvidence as boolean;
    this._typeProvenance = s._typeProvenance as
      TypeProvenanceEntry[] | undefined;
    this.effectsDeclared = s.effectsDeclared as boolean;
    this._isConstant = s._isConstant as boolean;
    this._deadStack = s._deadStack as string | undefined;
    this._deadScope = s._deadScope as string | undefined;
    this._activationOf = s._activationOf as BoxedValueDefinition | undefined;
    this._scopeActivationOf = s._scopeActivationOf as
      BoxedValueDefinition | undefined;
    this._isShield = s._isShield as true | undefined;
    this._isDevolvedShadow = s._isDevolvedShadow as true | undefined;
    this.disposed = s.disposed as boolean;
    this.holdUntil = s.holdUntil as 'never' | 'evaluate' | 'N';
    this.eq = s.eq as typeof this.eq;
    this.neq = s.neq as typeof this.neq;
    this.cmp = s.cmp as typeof this.cmp;
    this.collection = s.collection as CollectionHandlers | undefined;
    this.subscriptEvaluate =
      s.subscriptEvaluate as typeof this.subscriptEvaluate;
    this._writeVersion += 1;
  }

  /**
   * The type this definition DECLARES — its contract. Built from the
   * declaration and the stored value only, never from an assumption, so a
   * type derived from it and stored elsewhere stays true when a fact is
   * retracted (`docs/plans/2026-08-29-assumptions-as-facts-type.md` §2.2).
   *
   * This is the read for the write path, for provenance and for a hover: use
   * {@link type} for what is known in the current state.
   */
  get declaredType(): BoxedType {
    const t = this._type;
    if (t === undefined || t === null)
      return this.storedValue?.type ?? BoxedType.unknown;
    if (this._signatureSkeleton !== undefined && !this.inferredType)
      return this._deriveSignature(t, this._signatureSkeleton);
    return this._reviseInferredType(t);
  }

  /** The signature skeleton refined from the stored value's CURRENT type.
   * Nothing is written. The value is a function literal, or a symbol that
   * names a function (`f := g`). The value's type is itself a memo that a
   * new binding of a head it calls invalidates, so this reading follows that
   * binding. Without a value (declared, not yet assigned) the recorded type
   * is the answer.
   *
   * A recursive body reads its own definition's type while its type is
   * computed. The re-entrant read gets the recorded type and is not
   * memoized, so the cycle stops after one level. */
  private _deriveSignature(recorded: BoxedType, skeleton: Type): BoxedType {
    const v = this.storedValue;
    if (v === undefined) return recorded;
    if (this._derivingSignature) {
      noteReentrantSignatureRead(this);
      const candidate = this._recursionResult;
      if (candidate === undefined) return recorded;
      return new BoxedType(
        withSignatureResult(recorded.type, candidate),
        this._engine._typeResolver
      );
    }
    const frame = beginSignatureDerivation(this);
    try {
      return this._deriveSignatureOnce(recorded, skeleton, v, frame);
    } finally {
      endSignatureDerivation(frame);
    }
  }

  /**
   * The signature of the RECURSIVE function literal held by a binding that is
   * declared with the bare `function` type, or `undefined` when the binding is
   * not declared `function`, holds no function literal, or the literal does
   * not call itself (directly or through the functions it calls).
   *
   * A bare `function` declaration has no signature of its own, so a call of
   * the binding is typed by the literal's own type. That type is computed
   * from the body, and the recursive call in the body reads the literal's
   * type again: the cache answers that re-entrant read with the type the
   * literal had before (`cachedValue`, `cache.ts`), which was computed when
   * the binding held no value. With `R(i) = {i = 0: 0, R(i−1) + S(1, 2,
   * R(i−1))}` and `S` a function whose body calls another user function,
   * that earlier type is wide, and `R(3)` was typed `any`, where the same
   * functions without the declaration type it `number`.
   *
   * The signature is derived as for a binding declared with a signature
   * whose slots are `unknown` (`ce.declare('R', '(unknown) -> unknown')`):
   * the skeleton has one slot per parameter of the literal (its annotation,
   * or `unknown`) and the result `unknown`, and {@link _deriveSignature}
   * types the body under it, with the recursive call reading the skeleton,
   * and verifies the result (`verifiedListHypothesis`). The effects of the
   * literal's own type are kept on the derived signature: the skeleton
   * declares none, and a pure signature for a body that draws a random
   * number would let a partial application be typed as a pure function.
   *
   * These literals keep their own type: one with a rest or a destructuring
   * parameter, one whose author wrote its result type or its full signature
   * (that is a contract, possibly a generic one `where T`), and one with a
   * parameter annotation that names a type variable. The skeleton has no
   * `where` clause, so a type variable copied into it is not quantified,
   * and building the derived type threw `unresolved-type-variable`.
   * @internal
   */
  _wildcardRecursiveSignature(): Type | undefined {
    const t = this._type;
    if (t === undefined || t === null || !isWildcardFunctionType(t.type))
      return undefined;
    const literal = this.storedValue;
    if (literal === undefined || !isFunction(literal, 'Function'))
      return undefined;
    // Whether the literal calls itself depends on the definitions of the
    // functions it calls, so the answer is kept with the engine versions
    // that a new definition or assignment moves (`declaredResultMemoKey`),
    // and read again when they move. The skeleton object is kept while the
    // answer stays the same, because the signature memo of
    // `_deriveSignature` keys on its identity.
    let cached = this._wildcardSkeleton;
    if (cached === undefined || cached.literal !== literal) {
      cached = { literal, versions: '', skeleton: undefined };
      this._wildcardSkeleton = cached;
    }
    const versions = declaredResultMemoKey(this._engine, literal);
    if (cached.versions !== versions) {
      const recursive = this._isDerivableRecursiveLiteral(literal);
      if (!recursive) cached.skeleton = undefined;
      else if (cached.skeleton === undefined)
        cached.skeleton = new BoxedType(
          {
            kind: 'signature',
            args: literal.ops.slice(1).map((p) => ({
              type: functionLiteralParameterType(p) ?? 'unknown',
            })),
            result: 'unknown',
          },
          this._engine._typeResolver
        );
      cached.versions = versions;
    }
    if (cached.skeleton === undefined) return undefined;
    const derived = this._deriveSignature(
      cached.skeleton,
      cached.skeleton.type
    ).type;
    const own = literal.type.type;
    if (
      typeof derived !== 'object' ||
      derived.kind !== 'signature' ||
      derived.effects !== undefined ||
      typeof own !== 'object' ||
      own.kind !== 'signature' ||
      own.effects === undefined
    )
      return derived;
    return { ...derived, effects: own.effects };
  }

  /** True when `literal` calls the function this binding names, directly or
   * through the functions it calls, and its signature can be derived from a
   * skeleton of `unknown` slots (see {@link _wildcardRecursiveSignature}). */
  private _isDerivableRecursiveLiteral(
    literal: Expression & FunctionInterface
  ): boolean {
    const params = literal.ops.slice(1);
    if (params.some((p) => isRestParameter(p) || isDestructuringParameter(p)))
      return false;
    if (
      functionLiteralReturnType(literal) !== undefined ||
      functionLiteralDeclaredSignature(literal) !== undefined
    )
      return false;
    if (
      params.some((p) => {
        const annotation = functionLiteralParameterType(p);
        return annotation !== undefined && isPolymorphicType(annotation);
      })
    )
      return false;
    return callsReach(literal, this.name);
  }

  /** The body of {@link _deriveSignature}, run inside the derivation frame
   * `frame` (`beginSignatureDerivation`). */
  private _deriveSignatureOnce(
    recorded: BoxedType,
    skeleton: Type,
    v: Expression,
    frame: SignatureDerivationFrame
  ): BoxedType {
    let valueType: BoxedType;
    // The recursive calls in the body read the provisional signature while
    // the type of the stored literal is computed, and the types of the body
    // nodes computed from it are cached. With the skeleton's `unknown`
    // result, they are wider than the settled signature gives, and a later
    // reader gets them: with `R(i, x, y) := R(i − 1, x, y) + 0.5·S(x, y,
    // R(i − 1, x, y))`, after an evaluation moved the cache generation, a
    // compilation of the body read `0.5·S(…)` as `list<…> | number | tuple`
    // and declined it as "may be a collection at run time". So when an
    // earlier derivation of the same literal under the same skeleton
    // settled a result, the recursive calls of the stored literal read that
    // result instead (the hypothesis), and the cached body types are those
    // of the recursive calls typed by that earlier result.
    //
    // The result that this derivation stores is read from the type of the
    // stored literal, as in the first derivation, so when a hypothesis is
    // read it is computed under the hypothesis: f(H) for the earlier result
    // H. That is sound when f(H) contains the result of the body, which
    // holds when H does, that is, when H is still the result of the body:
    // the conditions below check that nothing H depends on has changed.
    // When f(H) differs from H, the next derivation reads f(H). The tests
    // (`census-head-new-declines.test.ts`: a nested list, a nested tuple,
    // the ndqj7hupta functions) find f(H) = H. Deriving the stored result on
    // a fresh boxing of the body instead (`rebox`), so that it never depends
    // on H, was measured and rejected: the fresh boxing reads the skeleton's
    // `unknown` for the recursive calls, and the signature of `r(n) :=
    // If(n ≤ 0, 0, s + r(n − 1))` became `unknown` instead of `number`
    // (`tycho-row-426-apply-lambda-type.test.ts`, case 12).
    //
    // When the signature is derived again and the earlier result is NOT
    // read, the stored result is derived on a fresh boxing of the body
    // (`rebox` below): the type of the stored literal can be outdated then.
    // With `a := 5`, `R(i) := If(i ≤ 0, 0, R(i − 1) + a)` and then `a := [1,
    // 2]`, the signature read from that type stayed `number` while `R(2)`
    // is a list.
    //
    // The earlier result is read only when nothing it depends on can have
    // changed since:
    // - no value was written and no function was redefined or retyped (the
    //   semantic, world and definition versions): after `a := [1, 2]` in the
    //   example above, the earlier `number` is outdated;
    // - no declaration was added in the home scopes of the functions the
    //   body calls (`calleeHomesDeclarationCount`);
    // - the free symbols of the body resolve to the same definitions from
    //   the scope of the read (`_freeSymbolDefinitions`). This is a
    //   conservative check: a scope that declares one of them again (a
    //   probe that declares it `broadcastable<…>`) does not read the earlier
    //   result, and a scope that declares other symbols (a `Block` with a
    //   local) does. The scope of the read itself is not compared: after a
    //   `Block` evaluated a call of `R`, the read in the scope of the block
    //   did not reuse the result, and the body types were wide again.
    // For a body whose result grows at each step (`R(i) := If(i ≤ 0, 0,
    // [R(i − 1)])`), the signature and the body types stay the same from
    // one cache generation to the next (`census-head-new-declines.test.ts`).
    const previous = this._signatureMemo;
    const derivedBefore =
      previous !== undefined &&
      previous.skeleton === skeleton &&
      previous.value === v &&
      callsItselfDirectly(v, this.name);
    const hypothesis =
      derivedBefore &&
      previous.definitions === this._definitionsKey() &&
      calleeHomesDeclarationCount(previous.calleeHomes) ===
        previous.calleeCount &&
      sameDefinitions(previous.freeDefinitions, this._freeSymbolDefinitions(v))
        ? functionResult(previous.type.type)
        : undefined;
    this._derivingSignature = true;
    this._recursionResult = hypothesis;
    try {
      valueType = v.type;
    } finally {
      this._derivingSignature = false;
      this._recursionResult = undefined;
    }
    // The memo keys on the value's type by CONTENT: the object is rebuilt
    // whenever the cache generation moves, which the computation below does
    // itself. It also keys on the engine versions that move when the result
    // under the declared parameter types (below) can change, read AFTER the
    // computation so that its own declarations are included
    // (`declaredResultMemoKey`). Without both, the memo never hit, and every
    // read re-boxed the body and the bodies of the functions it calls.
    const valueTypeKey = typeToString(valueType.type);
    const memo = this._signatureMemo;
    if (
      memo !== undefined &&
      memo.skeleton === skeleton &&
      memo.value === v &&
      memo.valueType === valueTypeKey &&
      memo.versions === declaredResultMemoKey(this._engine, v) &&
      calleeHomesDeclarationCount(memo.calleeHomes) === memo.calleeCount
    )
      return this._noted(memo.type, memo.calleeHomes);
    // The stored literal reads its scalar parameters as `unknown`; its
    // result under the DECLARED parameter types is the accurate one to
    // report (`resultUnderDeclaredParameters`).
    // Computing it boxes the body again, and a recursive body reads this
    // signature: the guard makes that read answer the recorded type, as for
    // the value's type above. Without it, each level boxed the body again,
    // without end.
    // The home scopes of the declared functions the body calls are recorded
    // while the result is derived (`collectCalleeHomes`).
    let typedResult: Type | undefined;
    let calleeHomes: HomeScope[];
    this._derivingSignature = true;
    try {
      ({ result: typedResult, homes: calleeHomes } = collectCalleeHomes(() =>
        resultUnderDeclaredParameters(
          this._engine,
          v,
          skeleton,
          derivedBefore && hypothesis === undefined
            ? { rebox: true }
            : undefined
        )
      ));
    } finally {
      this._derivingSignature = false;
    }
    // A self-recursive body whose result is an abstract collection is
    // re-typed under the hypothesis that the result is a list, and the
    // hypothesis is kept only when that pass bears it out
    // (`verifiedListHypothesis`, which explains the rule). The re-entrant
    // read of a recursive call answers the hypothesis through
    // `_recursionResult`.
    const verified = verifiedListHypothesis(
      this._engine,
      v,
      skeleton,
      this.name,
      typedResult ?? functionResult(valueType.type),
      (candidate, thunk) => {
        this._recursionResult = candidate;
        this._derivingSignature = true;
        try {
          return thunk();
        } finally {
          this._derivingSignature = false;
          this._recursionResult = undefined;
        }
      }
    );
    if (verified !== undefined) {
      typedResult = verified.result;
      calleeHomes = verified.homes;
    }
    const refined = refineDeclaredPlaceholders(
      skeleton,
      typedResult === undefined
        ? valueType.type
        : withSignatureResult(valueType.type, typedResult)
    );
    const type =
      refined === recorded.type
        ? recorded
        : new BoxedType(refined, this._engine._typeResolver);
    // Not stored while an inference rollback frame is open: its undo restores
    // declarations and types by raw writes that advance no counter of the
    // key, so a result computed in the discarded trial would still match
    // after the rollback.
    // Nor while a list-hypothesis pass of any definition runs: this
    // derivation may have read a hypothesis that is then refuted
    // (`inListHypothesisPass`). Nor when it read the provisional signature
    // of a function whose own derivation was still running
    // (`noteReentrantSignatureRead`).
    if (
      this._engine._rollbackFrames.length === 0 &&
      !inListHypothesisPass() &&
      !frame.tainted
    )
      this._signatureMemo = {
        skeleton,
        value: v,
        valueType: valueTypeKey,
        versions: declaredResultMemoKey(this._engine, v),
        calleeHomes,
        calleeCount: calleeHomesDeclarationCount(calleeHomes),
        type,
        definitions: this._definitionsKey(),
        freeDefinitions: this._freeSymbolDefinitions(v),
      };
    return this._noted(type, calleeHomes);
  }

  /** The engine state that the reuse of an earlier derivation's result as
   * the hypothesis of the recursive calls depends on (see
   * {@link _deriveSignatureOnce}): the engine versions, and whether the
   * assumptions are hidden. A result derived with the assumptions visible
   * (`x > 0` makes `x > 0` the value `True`) must not be read while they
   * are hidden (`_withoutFacts()`), where the same call can also be
   * `False`; hiding them moves none of the versions. */
  private _definitionsKey(): string {
    const ce = this._engine;
    return `${ce._semanticVersion}:${ce._worldVersion}:${ce._definitionVersion}:${ce._factsHidden() ? 1 : 0}`;
  }

  /** The definitions that the free symbols of the function literal `v` (its
   * symbols other than its parameters) resolve to in the current scope, in
   * the order of `v.symbols`. */
  private _freeSymbolDefinitions(
    v: Expression
  ): ReadonlyArray<object | undefined> {
    const params = isFunction(v, 'Function')
      ? new Set(v.ops.slice(1).map((p) => functionLiteralParameterName(p)))
      : new Set<string | undefined>();
    return v.symbols
      .filter((name) => !params.has(name))
      .map((name) => this._engine.lookupDefinition(name));
  }

  /** `type`, after recording this function's home scope and the home scopes
   * its derived result depends on (`calleeHomes`) for a derivation of
   * another declared function that reads this signature
   * (`noteCalleeHomes`). */
  private _noted(
    type: BoxedType,
    calleeHomes: readonly HomeScope[]
  ): BoxedType {
    const literal = this.storedValue;
    if (literal !== undefined) noteCalleeHomes(literal, calleeHomes);
    return type;
  }

  /**
   * The type known in the CURRENT state: the declared type narrowed by
   * everything the assumptions in force prove about this definition.
   *
   * The single site where the two channels meet. A fact contributes only to
   * the definition its assertion was recorded against, so a name re-declared
   * in an inner scope keeps its own type and the facts about the enclosing
   * definition stay with that one. A definition holding a STORED value takes
   * its type from the value alone: an assumption about such a symbol is
   * CHECKED against the value when it is made and never retypes it.
   *
   * A definition marked by `withDeclaredTypeOnly` also takes the declared
   * type: the facts are not merged. A compilation marks a `vars`-mapped input
   * (`withVarsValuesHidden` in `compilation/vars-inputs.ts`) so that it reads
   * as the input of its declared type; without this, `assume(a = 4)` would
   * narrow `a` to an integer and a compiled `⌊a⌋` would drop the floor. The
   * value shield of `assume()` (`withShieldedValues`) does not have this
   * effect: it also hides a value put in force by an assumption, and the
   * facts about that symbol must still apply while it records a new fact.
   *
   * The operands are intersected as one type NODE and reduced once — the meet
   * (`narrow()`) would answer `never` for `real & !2`, which is exactly the
   * shape a disequality fact contributes.
   */
  get type(): BoxedType {
    const declared = this.declaredType;
    const ce = this._engine;
    if (contextAssumptions(ce).size === 0) return declared;
    // A constant is never a fact's subject (`soleSelfSubject` filters it out),
    // so there is nothing to merge — and answering before the `storedValue`
    // probe below matters: reading that value FORCES a constant's lazy value,
    // which for a precision-dependent constant such as `Pi` is a full
    // evaluation this getter has no need of.
    if (this._isConstant) return declared;
    if (this.storedValue !== undefined) return declared;
    if (isDeclaredTypeOnly(this)) return declared;

    const index = getFactIndex(ce);
    const contributions = typeFor(index, this);
    if (contributions.length === 0) return declared;

    // The index is rebuilt whenever the facts change (a new engine generation
    // or a mutation of the store), so keying on its identity is what heals
    // this cache on `assume()`, `forget()`, a scope change and a checkpoint
    // restore alike; `_writeVersion` covers a write to the declaration.
    const cached = this._effectiveType;
    if (
      cached !== undefined &&
      cached.index === index &&
      cached.writeVersion === this._writeVersion
    )
      return cached.type;

    const merged = new BoxedType(
      reduceType({
        kind: 'intersection',
        types: [declared.type, ...contributions],
      }),
      ce._typeResolver
    );
    this._effectiveType = {
      index,
      writeVersion: this._writeVersion,
      type: merged,
    };
    return merged;
  }

  /** Memo for {@link type}'s merge, keyed on the fact index it was computed
   * from and on this record's own write counter. */
  private _effectiveType:
    { index: FactIndex; writeVersion: number; type: BoxedType } | undefined =
    undefined;

  /**
   * Revision of an INFERRED type against its own value (user-ruled
   * 2026-08-16: "inference doesn't have to be broadest, it has to be more
   * likely, and is subject to revision").
   *
   * An assignment commits the LIKELY type of the assigned value — `C_0 :=
   * Σ_k Which(C = U_k, k, True, 0)` with `C` still `unknown` types `number`,
   * the scalar reading — and records it here as `_type` with `inferredType`
   * set. When the value is an EXPRESSION whose type depends on other symbols,
   * that guess can be refuted later without any write to this definition:
   * once `C := [10, 30]`, the same value types `vector<integer^2>`, and a
   * frozen `number` no longer contains the value the symbol actually holds
   * (measured 2026-08-16; `ROADMAP.md`, "An `unknown`-typed symbol compared
   * to a SCALAR types the relation scalar"). A DECLARED type is a contract
   * and is never touched (`inferredType` false); a literal value's type
   * cannot move, so only a function-shaped value is re-checked — and NOT a
   * `Function` LITERAL: a lambda's type is its signature, and when a type
   * alias it mentions is re-declared the protocol machinery re-settles
   * conformances over that signature itself (`engine-protocols.ts`,
   * conformance re-activation); a read-time retype here would pre-empt that
   * decision (measured 2026-08-16 against
   * `test/compute-engine/protocol-type-redefinition.test.ts`: two joint-cause
   * refusals turned into silent acceptances). Callable signatures stay on
   * that path; this revision is for DATA values whose expression depends on
   * other symbols.
   *
   * The revision is a LIVE READ WITH NO WRITE (R4 of the type-handler
   * design, `docs/plans/2026-08-22-type-handlers-on-types.md` §4.2,
   * re-ratified 2026-08-22): compute the value's current type — read
   * through {@link _liveValueType}, a memo keyed on the identity of the
   * value, `ce._worldVersion`, the facts-hidden state and a dependency
   * snapshot of the value (each definition it reads with its write version,
   * the binding each bound variable's name resolves to with the write
   * version of the variable's own definition, and each applied operator
   * with its write version), so this is cheap until one of them changes —
   * and answer with it when it refutes the recorded guess; answer with the
   * recorded type when the live type is unknown or still admits it.
   * NOTHING is written: no `_type`, no `_writeVersion` bump, no journal
   * entry, no `type-write` event. Whatever changed the value's type moved
   * a key of that memo, so the next read computes the type again; the
   * event this getter used to emit was a second advance for a change that
   * was already covered — the item-219 hazard — and its generation gate was
   * keyed on `_semanticVersion` while the value-type memo was keyed on
   * `_anyVersion`, which is the staleness defect §2.5 records. A value whose live type is still ADMITTED by the guess (a
   * subtype) leaves the likely type in place. Self-referential bindings
   * (`a := a + 1`) are skipped: reading their value's type reads this
   * type. Mutual recursion terminates through the expression type memo's
   * in-flight window (`cache.ts`), which answers a re-entrant read with
   * the previous value.
   */
  private _reviseInferredType(recorded: BoxedType): BoxedType {
    if (!this.inferredType || this._isConstant || this._isSelfReferential)
      return recorded;
    const v = this.storedValue;
    if (v === undefined || !isFunction(v)) return recorded;
    if (v.operator === 'Function')
      return this._reviseLiteralArrowEffects(recorded, v);
    const live = this._liveValueType(v);
    if (live.isUnknown || live.matches(recorded)) return recorded;
    return live;
  }

  /** The memo of {@link _liveValueType}. */
  private _liveTypeMemo:
    | {
        value: Expression;
        worldVersion: number;
        factsHidden: boolean;
        deps: MemoDeps;
        type: BoxedType;
      }
    | undefined = undefined;

  /**
   * The current type of `v`, the stored value of this definition, memoized
   * on the bindings that `v` reads and not on the `any` axis.
   *
   * `v.type` is memoized on the `any` axis, and each call of a function
   * literal advances that axis when its frame is popped (the frame binds
   * the values of the parameters, `discardEvalContext` in
   * `engine-scope.ts`). So with `X(l) := C_0[l]`, where `C_0` holds a chain
   * such as `Sum(If(C = U[i], i, 0), i = 1..Length(U))` over lazy
   * collections, each call `X(i)` derived the type of the whole chain again
   * through this definition, although nothing the chain reads had changed.
   *
   * The entry is valid while these hold:
   *
   * - The stored value is the same expression object (an assignment stores
   *   a new one).
   * - The world version is unmoved: an assumption, a `forget()`, a scope pop
   *   that reverts an assumption, a redefinition of a function and a change
   *   of the configuration advance it. The facts-hidden state is the same.
   * - The dependency snapshot of `v` still validates
   *   (`snapshotMemoDeps`/`memoDepsStillValid`,
   *   `collection-element-memo.ts`). It holds each value definition that
   *   `v` reads, transitively through stored values and the bodies of user
   *   functions, with its write version: a value write, a type write
   *   (a declaration, an inference) and a loop-index write each advance the
   *   version of the definition they write. It holds the binding each name
   *   resolves to from the current scope, so a declaration that shadows a
   *   name, or a call frame that binds it, misses. With `bindingSites` it
   *   also holds what the name of each variable bound INSIDE `v` resolves
   *   to, because a type read finds the value of such a variable by name
   *   (`ElementMemoDep.site`), with the write version of the variable's own
   *   definition, and each operator `v` applies with its write version, which
   *   a write of the operator's signature advances.
   *
   * Nothing is served or stored inside a value shield (`_withValueShieldKey`,
   * where `_cacheGeneration()` is not derived from the `any` axis): the
   * shield hides values that existing expressions read by name, and runs
   * under a cache key of its own for that reason. A type computed while a
   * read of the type of this same definition was already running, or while
   * a cycle guard cut a read short (`cycleDetectionCount`), or that read
   * the provisional signature of a function whose derivation was running
   * (`reentrantSignatureReadCount`), is a provisional answer and is not
   * stored. Nor is a type computed while an inference rollback frame is
   * open or a list-hypothesis pass runs (`inListHypothesisPass`), as for
   * the signature memo.
   */
  private _liveValueType(v: Expression): BoxedType {
    const ce = this._engine;
    if (ce._cacheGeneration() >> 1 !== ce._anyVersion) return v.type;
    if (LIVE_TYPE_IN_FLIGHT.has(this)) {
      liveTypeReentries += 1;
      return v.type;
    }
    const memo = this._liveTypeMemo;
    if (
      memo !== undefined &&
      memo.value === v &&
      memo.worldVersion === ce._worldVersion &&
      memo.factsHidden === ce._factsHidden() &&
      memoDepsStillValid(v, memo.deps)
    ) {
      return memo.type;
    }
    const reentriesBefore = liveTypeReentries;
    const cyclesBefore = cycleDetectionCount();
    const signatureReadsBefore = reentrantSignatureReadCount();
    LIVE_TYPE_IN_FLIGHT.add(this);
    let type: BoxedType;
    try {
      type = v.type;
    } finally {
      LIVE_TYPE_IN_FLIGHT.delete(this);
    }
    if (
      liveTypeReentries !== reentriesBefore ||
      cycleDetectionCount() !== cyclesBefore ||
      reentrantSignatureReadCount() !== signatureReadsBefore
    )
      return type;
    // Not stored while an inference rollback frame is open, or while a
    // list-hypothesis pass runs: the rollback restores declarations and
    // types by writes that advance no key of this memo, and a refuted
    // hypothesis retires nothing, so the entry would be served after the
    // provisional state it was computed in is gone.
    if (ce._rollbackFrames.length !== 0 || inListHypothesisPass()) return type;
    const deps = snapshotTypeDeps(v, { bindingSites: true });
    if (deps !== undefined)
      this._liveTypeMemo = {
        value: v,
        worldVersion: ce._worldVersion,
        factsHidden: ce._factsHidden(),
        deps,
        type,
      };
    return type;
  }

  /** The effects of a stored `Function` literal, when a walk of its body
   * reads an effect set that is derived from the conformance registry (a
   * protocol dispatcher), memoized on the literal and on the version of the
   * registry. `null` when the walk reads no such set. */
  private _literalRegistryEffects:
    | {
        literal: Expression;
        version: number;
        effects: EffectSet | undefined | null;
      }
    | undefined = undefined;

  /**
   * The recorded inferred type of a binding that holds the `Function`
   * literal `v`, with the effects of its arrow brought up to date.
   *
   * The recorded type is the arrow of the literal when it was assigned. When
   * the body of the literal calls a protocol dispatcher, directly or through
   * other functions, the effects of the literal depend on the conformances
   * registered at the time of the call. A later conformance can add an
   * effect: with `let g = (x) => speak(x)`, a conformance whose `speak`
   * writes an outer variable makes `g` a `scope` function. So the effects of
   * the arrow are the union of the recorded effects and the effects of a new
   * walk of the body. The other parts of the recorded type do not change. A
   * literal whose walk reads no registry-derived set keeps the recorded
   * type, and its body is walked again only when the registry changes.
   */
  private _reviseLiteralArrowEffects(
    recorded: BoxedType,
    v: Expression
  ): BoxedType {
    const ce = this._engine;
    const version = ce._conformanceVersion;
    let memo = this._literalRegistryEffects;
    if (memo === undefined || memo.literal !== v || memo.version !== version) {
      let effects: EffectSet | undefined | null = null;
      try {
        const inferred = inferFunctionLiteralEffects(ce, v, {
          selfName: this.name,
        });
        if (inferred.consultsRegistry) effects = inferred.effects;
      } catch {
        // A walk that cannot run says nothing new about the body.
        effects = null;
      }
      memo = { literal: v, version, effects };
      this._literalRegistryEffects = memo;
    }
    if (memo.effects === null || memo.effects === undefined) return recorded;
    const before = signatureEffects(recorded.type);
    if (isEffectSubset(memo.effects, before)) return recorded;
    return new BoxedType(
      withArrowEffects(recorded.type, unionEffectSets(before, memo.effects)!),
      ce._typeResolver
    );
  }

  set type(t: Type | TypeString | BoxedType) {
    // The public accessor keeps its `Type`-valued shape and delegates to the
    // thunk API, so a caller cannot bypass the fact-blind bracket. A function
    // is never a `Type`, so one reaching here is a thunk handed to the wrong
    // entry point — say so instead of storing a nonsense type.
    if (typeof t === 'function')
      throw new Error(
        `The type of "${this.name}" was set to a function. Use "_setType()" to compute a type inside the write's fact-blind bracket.`
      );
    const callableBefore = containsSignatureArm(this._type?.type);
    this._setType(() => t);
    // Report the write, so that values cached against the engine's cache
    // generation (the `_type` and `_sgn` caches of expressions that read
    // this type) are computed again. `_setType()` reports no event, because
    // each internal caller reports its own event. A refused write throws
    // before this point and reports nothing.
    this._engine._noteStateEvent({
      kind: 'type-write',
      callableBefore,
      callableAfter: containsSignatureArm(this._type!.type),
    });
  }

  /** Write this definition's declared type, deriving it with the assumptions
   * hidden.
   *
   * This method reports no state event. The caller must report the event
   * that fits the write (`type-write`, `inference`, or none when a value
   * write that follows advances the cache axes). The public `type` setter
   * reports a `type-write` event.
   *
   * The thunk runs inside the bracket together with the write itself, so both
   * the type stored and the decisions that chose it are a function of the
   * declarations and the stored values alone
   * (`docs/plans/2026-08-29-assumptions-as-facts-type.md` §2.4). A caller
   * whose decision phase reads the incumbent type must read `declaredType`,
   * and must do so inside its own bracket or inside this thunk.
   * @internal */
  _setType(thunk: () => Type | TypeString | BoxedType): void {
    this._engine._withoutFacts(() => this._writeType(thunk()));
  }

  private _writeType(t: Type | TypeString | BoxedType): void {
    if (this._isConstant)
      throw new Error(
        `The type of the constant "${this.name}" cannot be changed`
      );

    // Checkpoint journal (funnel 2): the type setter is a hidden VALUE
    // writer — a write to `unknown` below wipes `_defValue`/`_value` and
    // reports no `value-write` event — so it journals the same coupled tuple
    // the value setter does. Recorded after the constant guard, so a refused
    // write leaves the window untouched.
    journalDefinitionRecord(this._engine, this, 'type-write');

    this._type =
      t instanceof BoxedType ? t : new BoxedType(t, this._engine._typeResolver);
    this._writeVersion += 1;

    // Maintain the placeholder skeleton on every EXPLICIT type write: a
    // retype to a bare constructor (re)establishes the placeholder, and a
    // retype to anything else CLEARS a stale one — without this, a symbol
    // declared `list`, refined, then explicitly retyped `list<integer>`
    // kept its old `list` skeleton, so later assignments were checked
    // against the stale bare contract and could re-refine right past the
    // new explicit one (review catch, 2026-08-18). Element-REFINEMENT
    // writes use `_setElementRefinement` below, which preserves the
    // skeleton by construction.
    this._placeholderSkeleton = placeholderSkeletonOf(this._type.type);
    // The same rule for a signature skeleton: a write of a signature with
    // `unknown` slots (re)establishes it, any other write clears it. The
    // skeleton is not gated on `inferredType` here, because some callers
    // write the type first and clear `inferredType` after the write
    // (`symbol.type = …`, the typed `let` upgrade); `declaredType` reads the
    // skeleton only when the type is not inferred.
    this._signatureSkeleton = hasSignaturePlaceholder(this._type.type)
      ? this._type.type
      : undefined;
    this._signatureMemo = undefined;

    // Are we resetting the type/value?
    if (this._type.isUnknown) {
      this._defValue = undefined;
      this._value = undefined;
    }
  }

  /** Install an element REFINEMENT of the placeholder skeleton
   * (`refineConstructorPlaceholder`) — a type write that must NOT disturb
   * `_placeholderSkeleton`, unlike the public `type` setter above.
   * @internal */
  _setElementRefinement(t: BoxedType): void {
    // Fact-blind like every other type write, so that a refinement derived
    // from an assigned value keeps standing after the assumptions change. The
    // DECISION that produced `t` belongs to the caller's own bracket.
    this._engine._withoutFacts(() => {
      // Checkpoint journal (funnel 2): same coupled tuple as the setters
      // above.
      journalDefinitionRecord(this._engine, this, 'type-write');
      this._type = t;
      this._writeVersion += 1;
    });
  }

  onConfigurationChange(): void {
    // Force the value to be recalculated based on the original definition
    if (this.isConstant) this._value = null;
  }

  /** Set by `dispose()` and never cleared except by a checkpoint restore.
   *
   * An assumption is recorded against a DEFINITION, so a definition whose
   * scope is gone leaves assertions about a value that no longer exists.
   * Three readers act on this flag: the fact index skips an assertion any of
   * whose subjects is disposed (`collectTypeContributions`,
   * `boxed-expression/constraint-subject.ts`); a checkpoint restore drops
   * those assertions and the assumed-value overlay entries keyed by a
   * disposed definition (`restoreAssumptions`, `checkpoint.ts`); and the
   * `assume()` transaction's consistency pass ignores a disposed definition
   * when it re-reads what the applied facts prove (`assume.ts`). */
  disposed = false;

  dispose(): void {
    this.disposed = true;
    this._writeVersion += 1;
    this._unsubscribeFromConfigurationChange?.();
    this._unsubscribeFromConfigurationChange = undefined;
  }

  /** Stop listening to configuration changes, and do nothing else: unlike
   * `dispose()`, the definition is not marked as disposed. `updateDef()`
   * calls it on the value definition that a binding no longer holds (a
   * redefinition, or `ce.undeclare()`), because the engine's configuration
   * tracker holds each listener strongly and would otherwise keep the
   * replaced definition in memory for the engine's lifetime.
   *
   * Return `true` when a subscription was released. The caller then records
   * an undo that calls {@link _resubscribeConfigurationChange}, because a
   * checkpoint restore or an inference rollback can put this definition back
   * in its binding.
   * @internal */
  _releaseConfigurationChange(): boolean {
    const unsubscribe = this._unsubscribeFromConfigurationChange;
    if (unsubscribe === undefined) return false;
    unsubscribe();
    this._unsubscribeFromConfigurationChange = undefined;
    return true;
  }

  /** Listen to configuration changes again after
   * {@link _releaseConfigurationChange}, with the same listener (this
   * definition). The value is cleared, as for a configuration change, because
   * a change made while the definition was not listening was not seen. Does
   * nothing when the definition already listens or is disposed.
   * @internal */
  _resubscribeConfigurationChange(): void {
    if (this._unsubscribeFromConfigurationChange !== undefined) return;
    if (this.disposed || !this.isConstant) return;
    this._unsubscribeFromConfigurationChange =
      this._engine._listenToConfigurationChange(this);
    this.onConfigurationChange();
  }
}

function dynamicValue(
  ce: ComputeEngine,
  value:
    | undefined
    | LatexString
    | ExpressionInput
    | ((ce: ComputeEngine) => ExpressionInput | null)
) {
  if (value === undefined) return undefined;

  if (isLatexString(value))
    return ce.expr(parseLatex(value as string) ?? 'Undefined');

  if (typeof value === 'function') return ce.expr(value(ce) ?? 'Undefined');

  if (value instanceof _BoxedExpression) return value;

  return ce.expr(value);
}

/**
 * A binding is self-referential when its value mentions the symbol being
 * defined (e.g. `a := a + 1` over an unbound `a`). Resolving such a value
 * would re-resolve the symbol without end, overflowing the stack in `.N()`
 * and in collection-shape queries. We detect it once, at assignment time, by
 * a structural symbol scan — `.symbols` includes bound occurrences too, so
 * this over-approximates the pathological self-shadowing case
 * (`a := \sum_{a=…} a`), which then degrades to a symbolic result rather than
 * crashing. That trade is deliberate.
 */
function isSelfReferentialValue(
  name: string,
  value: Expression | undefined | null
): boolean {
  return !!value && value.symbols.includes(name);
}

/**
 * The placeholder skeleton a declared type denotes, or `undefined` when the
 * declared type is a contract that never moves.
 *
 * A declaration whose contents are left to inference refines its element
 * part from each assignment while its kind stays the contract (user
 * decisions D2, D3 and rule R7 of
 * `docs/plans/2026-10-21-unknown-inference-marker.md`, 2026-10-21):
 *
 * - a bare collection family name: `list`, `set`, `dictionary`,
 *   `collection`, `indexed_collection`, and, since D3, `tuple` and `record`
 *   (the slot types, or the field types, come from the assigned value);
 * - the same families with an explicit `unknown` content argument
 *   (`list<unknown>`, `dictionary<unknown>`), an explicit request to infer
 *   that until D2 was read as a fixed content contract;
 * - a transparent alias of one of those (`type L = list`): an alias IS its
 *   definition, so it carries the definition's instruction.
 *
 * - a collection type with an `unknown` at a NESTED position
 *   (`tuple<unknown, integer>`, `list<list<unknown>>`, `record{a: unknown}`,
 *   `dictionary<list<unknown>>`). The skeleton is then the resolved type
 *   itself, and each assignment replaces only its `unknown` positions with
 *   the types the value has at those positions (the later slice of
 *   decision D2).
 *
 * An explicit content contract (`list<any>`, `list<integer>`,
 * `tuple<integer, string>`) is never a placeholder. The answer is the
 * resolved skeleton, which `refineConstructorPlaceholder` reads.
 */
export function placeholderSkeletonOf(t: Type): Type | undefined {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string')
    return isConstructorPlaceholderType(r) ? r : undefined;
  switch (r.kind) {
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
      // A list with dimensions (`list<unknown^3>`) states a shape, which is
      // a contract on its own; only the shapeless spelling is a placeholder.
      if (r.kind === 'list' && r.dimensions !== undefined) return undefined;
      if (r.elements === 'unknown') return r.kind;
      break;
    case 'dictionary':
      if (r.values === 'unknown') return 'dictionary';
      break;
  }
  return hasNestedUnknownPosition(r) ? r : undefined;
}

/**
 * The type at each content position of a collection type that the nested
 * refinement reads: the elements of a shapeless list, set, collection or
 * indexed collection, the values of a dictionary, the slots of a tuple and
 * the fields of a record. A list with dimensions states a shape, and a
 * union, a function type or an alias at a nested position is a contract of
 * its own, so these have no content positions here.
 */
function contentPositions(t: Type): Type[] {
  if (typeof t === 'string') return [];
  switch (t.kind) {
    case 'list':
      return t.dimensions === undefined ? [t.elements] : [];
    case 'set':
    case 'collection':
    case 'indexed_collection':
      return [t.elements];
    case 'dictionary':
      return [t.values];
    case 'tuple':
      return t.elements.map((x) => x.type);
    case 'record':
      return Object.values(t.elements);
    default:
      return [];
  }
}

/** Is there an `unknown` at a content position of `t`, at any depth? */
function hasNestedUnknownPosition(t: Type): boolean {
  return contentPositions(t).some(
    (x) => x === 'unknown' || hasNestedUnknownPosition(x)
  );
}

/**
 * Refine a skeleton that has `unknown` at nested positions from the type of
 * an assigned value. Each `unknown` position takes the type the value has at
 * the same position, raw (not assignment-widened), as the element of a bare
 * `list` does. All other positions keep the skeleton's type, so the result
 * is always a subtype of the skeleton. When the value's type cannot be read
 * at a position, that position stays `unknown`. A value whose type is a
 * union is refined arm by arm, and the results are joined.
 */
function refineNestedUnknown(skeleton: Type, valueType: Type): Type {
  if (skeleton === 'unknown')
    return valueType === 'never' ? skeleton : valueType;
  if (typeof skeleton === 'string' || !hasNestedUnknownPosition(skeleton))
    return skeleton;
  valueType = resolveTypeAlias(valueType);
  if (typeof valueType !== 'string' && valueType.kind === 'union') {
    const arms = valueType.types.map((x) => refineNestedUnknown(skeleton, x));
    if (arms.some((x) => x === skeleton)) return skeleton;
    return widen(...arms);
  }
  switch (skeleton.kind) {
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection': {
      const elements = collectionElementType(valueType);
      if (elements === undefined) return skeleton;
      const refined = refineNestedUnknown(skeleton.elements, elements);
      if (refined === skeleton.elements) return skeleton;
      return { ...skeleton, elements: refined } as Type;
    }
    case 'dictionary': {
      if (typeof valueType === 'string') return skeleton;
      // Only a closed record (the type of a dictionary value) lists every
      // field of its values. An open record type can have other fields, of
      // any type, so it leaves the skeleton.
      const values =
        valueType.kind === 'dictionary'
          ? valueType.values
          : valueType.kind === 'record' && valueType.closed === true
            ? widen(...Object.values(valueType.elements))
            : undefined;
      if (values === undefined) return skeleton;
      const refined = refineNestedUnknown(skeleton.values, values);
      if (refined === skeleton.values) return skeleton;
      return { kind: 'dictionary', values: refined };
    }
    case 'tuple': {
      if (
        typeof valueType === 'string' ||
        valueType.kind !== 'tuple' ||
        valueType.elements.length !== skeleton.elements.length
      )
        return skeleton;
      const vt = valueType;
      let changed = false;
      const elements = skeleton.elements.map((slot, i) => {
        const refined = refineNestedUnknown(slot.type, vt.elements[i].type);
        if (refined === slot.type) return slot;
        changed = true;
        return { ...slot, type: refined };
      });
      return changed ? { kind: 'tuple', elements } : skeleton;
    }
    case 'record': {
      if (typeof valueType === 'string' || valueType.kind !== 'record')
        return skeleton;
      const vt = valueType;
      let changed = false;
      const elements: Record<string, Type> = {};
      for (const [key, field] of Object.entries(skeleton.elements)) {
        const valueField = vt.elements[key];
        const refined =
          valueField === undefined
            ? field
            : refineNestedUnknown(field, valueField);
        if (refined !== field) changed = true;
        elements[key] = refined;
      }
      return changed ? { kind: 'record', elements } : skeleton;
    }
    default:
      return skeleton;
  }
}

/** Is this declared type a bare collection family whose element refinement
 * is tracked separately from its unrestricted declared contract? The
 * explicit `<unknown>` spellings and the transparent aliases are read by
 * `placeholderSkeletonOf`, which callers use; this predicate answers for the
 * primitive names alone. */
export function isConstructorPlaceholderType(t: Type): boolean {
  return (
    t === 'list' ||
    t === 'set' ||
    t === 'dictionary' ||
    t === 'collection' ||
    t === 'indexed_collection' ||
    t === 'tuple' ||
    t === 'record'
  );
  // NOTE deliberately NOT `t === 'function'`: a bare `function` declaration
  // is the WILDCARD-CALLEE contract, and its type deliberately stays bare
  // through every assignment — adopting the assigned signature would turn a
  // permissive forward declaration into an arity/parameter contract (no
  // currying, box-time `unexpected-argument`, callback-arity refusals) that
  // a later re-assignment would have to satisfy. See the wildcard-callee
  // block in `box.ts` (`isWildcardFunctionType`) and task P2 of
  // `docs/plans/2026-08-22-type-handlers-on-types.md` §4.6, which attempted
  // the adoption on 2026-08-22 and reverted it against those pins.
}

/**
 * The Phase 1 placeholder refinement (`docs/INFERENCE_ROADMAP.md`, ruled
 * 2026-08-18): a declared bare-constructor skeleton adopts the assigned
 * value's ELEMENT type — element only (rank and length stay open: the user
 * wrote `list`, so list-ness of any shape is the contract), raw (elements
 * are not assignment-widened, matching what an unannotated `b = [1,2,3]`
 * records). Returns the skeleton unchanged when the value's element type
 * cannot be read (the refinement is best-effort; the contract already
 * admitted the value).
 */
export function refineConstructorPlaceholder(
  skeleton: Type,
  valueType: Type
): Type {
  // The value's own type can be a transparent alias (`k: cyc := [1, 2]`
  // with `type alias cyc = cyc | list<integer>`); the refinement reads its
  // structure.
  valueType = resolveTypeAlias(valueType);
  // A skeleton with `unknown` at nested positions is a structured type, not
  // a family name (`placeholderSkeletonOf`).
  if (typeof skeleton !== 'string')
    return refineNestedUnknown(skeleton, valueType);
  switch (skeleton) {
    case 'list':
    case 'indexed_collection':
    case 'collection': {
      // `collectionElementType` also knows the PRIMITIVE indexed
      // collections' elements (`string` → `character`, `range` →
      // `integer`), so a string-form value type is not rejected up front:
      // `a: indexed_collection; a = "abc"` refines to
      // `indexed_collection<character>` (review catch, 2026-08-18).
      // An element type that is a bare `unknown` says nothing yet, so the
      // skeleton stays; a union with an `unknown` arm (`integer | unknown`,
      // what the join keeps for `[opq(1), 2]` under decision D4) is kept, as
      // it does say something about the resolved cells.
      const elements = collectionElementType(valueType);
      if (elements === undefined || elements === 'unknown') return skeleton;
      return { kind: skeleton, elements } as Type;
    }
    case 'set':
      if (
        typeof valueType === 'string' ||
        valueType.kind !== 'set' ||
        valueType.elements === 'unknown'
      )
        return skeleton;
      return { kind: 'set', elements: valueType.elements };
    case 'dictionary': {
      if (typeof valueType === 'string') return skeleton;
      // Only a closed record (the type of a dictionary value) lists every
      // field of its values. An open record type can have other fields, of
      // any type, so it leaves the skeleton.
      const values =
        valueType.kind === 'dictionary'
          ? valueType.values
          : valueType.kind === 'record' && valueType.closed === true
            ? widen(...Object.values(valueType.elements))
            : undefined;
      if (values === undefined || values === 'unknown') return skeleton;
      return { kind: 'dictionary', values };
    }
    // A bare `tuple` takes the assigned tuple's slot types, names included
    // (`t: tuple := (1, Missing)` reports `tuple<integer, missing>`); the
    // next assignment re-refines, with another arity if it has one. A value
    // that is not a tuple (the declaration admits only tuples, so this is a
    // value whose static type is wider, such as `indexed_collection`) leaves
    // the skeleton. (User decision D3, 2026-10-21.)
    case 'tuple':
      if (typeof valueType === 'string' || valueType.kind !== 'tuple')
        return skeleton;
      return { kind: 'tuple', elements: valueType.elements };
    // A bare `record` takes the assigned record's field types
    // (`r: record := {a: 1}` reports `record{a: integer}`); the record stays
    // open, so a later field is still admitted by the contract. (D3.)
    case 'record':
      if (typeof valueType === 'string' || valueType.kind !== 'record')
        return skeleton;
      return { kind: 'record', elements: valueType.elements };
    default:
      return skeleton;
  }
}

/** The assignment-widening table at the TYPE level: the type a symbol's
 * inferred type takes when a value of type `t` is assigned to it. The same
 * table `inferTypeFromValue` applies to a value — factored out so the Epsil
 * static pre-pass can widen a DESTRUCTURED leaf, where only the component
 * TYPE (not a value expression) is in hand.
 *
 * Each rung widens the narrow type of a value to the TIER that names the kind
 * of value it is, so that a second assignment of the same kind does not have
 * to retype the symbol. `infinity` and `nan` need rungs of their own because
 * they are disjoint from `real` and from `complex`: an infinite value or a NaN
 * reaches none of the finite rungs. `x := oo` therefore takes `infinity`,
 * which keeps a later `x := -oo` legal, and `x := NaN` takes `nan` rather than
 * the wider `number`, which would hide the marker. */
export function widenAssignedType(ce: ComputeEngine, t: Type): Type {
  // `never` is the bottom type, so it matches every row of the table below,
  // and the first row read it as `integer`. A value typed `never` has no
  // value to widen: keep it, and let the caller decide what it means.
  if (t === 'never') return 'never';
  const bt = ce.type(t);
  if (bt.matches('integer')) return 'integer';
  if (bt.matches('rational')) return 'real';
  if (bt.matches('real')) return 'real';
  if (bt.matches('complex')) return 'number';
  if (bt.matches('infinity')) return 'infinity';
  if (bt.matches('nan')) return 'nan';
  // A boolean VALUE type (`true`, the claim of a proven comparison) widens
  // to the tier `boolean`: the claim is a proof over the symbols' types and
  // assumptions at assignment time, and a stored `true` would have no
  // rewind when `forget()` or a scope pop retracts one of those
  // assumptions (only the assumed symbol's own writes are rewound).
  if (bt.matches('boolean')) return 'boolean';
  return t;
}

export function inferTypeFromValue(
  ce: ComputeEngine,
  value: Expression | undefined
): BoxedType {
  if (!value) return ce.type('unknown');

  // Note: the order of the checks is important, we want to promote the type
  // to the most specific type possible based on the value's type.

  if (value.type.matches('integer')) {
    // An integer value, ranged or not, promotes to the bare tier `integer`:
    // x = 2 => integer
    return ce.type('integer');
  }

  if (value.type.matches('rational')) {
    // If the value matches a rational number, we promote the type to `real`
    // x = 1/2 => real
    return ce.type('real');
  }

  if (value.type.matches('real')) {
    // If the value matches a real number, we promote the type to `real`
    // x = 3.14 => real
    return ce.type('real');
  }

  if (value.type.matches('complex')) {
    // If the value is complex (3+2i) or imaginary (-4i), we promote the type to `number`
    // x = 3+2i => number
    return ce.type('number');
  }

  if (value.type.matches('infinity')) {
    // An infinite value is not a real number and not a complex number, so it
    // reaches none of the rungs above. It promotes to its own tier, which
    // keeps every infinity assignable to the same symbol.
    // x = oo => infinity, x = -oo => infinity, x = ~oo => infinity
    return ce.type('infinity');
  }

  if (value.type.matches('nan')) {
    // NaN promotes to its own tier as well. The wider `number` would admit
    // every finite value too, and so would hide the fact that the symbol
    // holds the not-a-number marker.
    // x = NaN => nan
    return ce.type('nan');
  }

  if (value.type.matches('boolean')) {
    // A boolean value type widens to `boolean` for the reason given at
    // `widenAssignedType`: the proof it records may be retracted later.
    // x = (a < b) => boolean
    return ce.type('boolean');
  }
  // No promotion for other types.
  // @todo: could consider promoting `list<T>` to `list` or...?
  return value.type;
}

/** True when the two lists hold the same definitions, in the same order. */
function sameDefinitions(
  a: ReadonlyArray<object | undefined>,
  b: ReadonlyArray<object | undefined>
): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

/** True when the body of the function literal `v` calls `name` itself,
 * not only through another function. The reuse of an earlier result and the
 * fresh boxing of a re-derivation (`_deriveSignatureOnce`) apply to such a
 * literal only. For a mutually recursive pair (`F` calls `G`, `G` calls
 * `F`), the fresh boxing derives the signature of each function again
 * inside the derivation of the other, and the result printed differently
 * (`set<any>` instead of `set`, `recursive-function-result-type.test.ts`):
 * such a pair keeps the derivation it had without them. */
function callsItselfDirectly(v: Expression, name: string): boolean {
  if (!isFunction(v, 'Function')) return false;
  const visit = (e: Expression): boolean =>
    (isFunction(e) && (e.operator === name || e.ops.some(visit))) || false;
  return visit(v.ops[0]);
}
