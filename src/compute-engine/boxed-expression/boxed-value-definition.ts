import type {
  Expression,
  ExpressionInput,
  ValueDefinition,
  BoxedValueDefinition,
  CollectionHandlers,
  IComputeEngine as ComputeEngine,
  TypeProvenanceEntry,
} from '../global-types.js';

import type { Type, TypeString } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import {
  collectionElementType,
  containsSignatureArm,
  isValidType,
  widen,
} from '../../common/type/utils.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { reduceType } from '../../common/type/reduce.js';

import { defaultCollectionHandlers } from '../collection-utils.js';
import {
  type FactIndex,
  contextAssumedValues,
  contextAssumptions,
  getFactIndex,
  isValueShielded,
  typeFor,
} from './constraint-subject.js';
import type { LatexString } from '../latex-syntax/types.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { isFunction, isNumber } from './type-guards.js';
import { matchesDeclaredTypeAxes } from './effects-inference.js';
import { declaredTypeError } from './type-compatibility-error.js';
import { isLatexString } from '../latex-syntax/utils.js';
import { parse as parseLatex } from '../latex-syntax/latex-syntax.js';
import { ConfigurationChangeListener } from '../../common/configuration-change.js';
import { CACHE_STATS, recordBump } from '../../common/cache-stats.js';
import type { CheckpointHookKind } from '../checkpoint-journal.js';

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
 * - When the value is changed, the type is unaffected. If the value is not
 *   compatible with the type (setting a def with a numeric type to a value
 *   of `True` for example), the value is discarded.
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

export class _BoxedValueDefinition
  implements BoxedValueDefinition, ConfigurationChangeListener
{
  readonly name: string; /** Used for debugging and error messages */

  wikidata?: string;
  description?: string | string[];
  keywords?: string[];
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

  /** The declared PLACEHOLDER SKELETON, when the declaration's type was a
   * bare collection constructor (`list`, `set`, `dictionary`, `collection`,
   * `indexed_collection` — each the `<unknown>` synonym: "some X of values,
   * elements to be determined"). The skeleton is the CONTRACT and never
   * moves; `_type` then carries the current element REFINEMENT, recomputed
   * from each assignment (`docs/INFERENCE_ROADMAP.md`, Phase 1 — ruled
   * 2026-08-18: re-refine on re-assignment; element only; `typeof` shows
   * the refinement). Assignment compatibility is checked against the
   * skeleton, so `a: list` still refuses `a = 42` after refining to
   * `list<integer>`, while `a = ["x"]` re-refines. `undefined` for
   * every other declaration. */
  _placeholderSkeleton: Type | undefined = undefined;

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
      if (!this.inferredType && isConstructorPlaceholderType(type))
        this._placeholderSkeleton = type;
    }

    this.effectsDeclared = def.effectsDeclared ?? false;

    this._value = dynamicValue(this._engine, def.value);
    this._isSelfReferential = isSelfReferentialValue(this.name, this._value);

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
    if (this._value === null)
      this._value = dynamicValue(this._engine, this._defValue);
    return this._value;
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
    this._isSelfReferential = isSelfReferentialValue(this.name, v);

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
      };
      if (x.operator === 'Function') return true;
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
      effectsDeclared: boolean;
    };
    this._type = s._type;
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
      url: this.url,
      _defValue: this._defValue,
      _value: this._value,
      _isSelfReferential: this._isSelfReferential,
      _type: this._type,
      inferredType: this.inferredType,
      _placeholderSkeleton: this._placeholderSkeleton,
      // COPIED, not aliased: provenance is appended to in place, so a
      // snapshot sharing the array would grow with the writes it exists to
      // undo and restore the post-write history.
      _typeProvenance: this._typeProvenance?.slice(),
      effectsDeclared: this.effectsDeclared,
      _isConstant: this._isConstant,
      _deadStack: this._deadStack,
      _deadScope: this._deadScope,
      _activationOf: this._activationOf,
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
    this.url = s.url as string | undefined;
    this._defValue = s._defValue as typeof this._defValue;
    this._value = s._value as typeof this._value;
    this._isSelfReferential = s._isSelfReferential as boolean;
    this._type = s._type as typeof this._type;
    this.inferredType = s.inferredType as boolean;
    this._placeholderSkeleton = s._placeholderSkeleton as Type | undefined;
    this._typeProvenance = s._typeProvenance as
      | TypeProvenanceEntry[]
      | undefined;
    this.effectsDeclared = s.effectsDeclared as boolean;
    this._isConstant = s._isConstant as boolean;
    this._deadStack = s._deadStack as string | undefined;
    this._deadScope = s._deadScope as string | undefined;
    this._activationOf = s._activationOf as BoxedValueDefinition | undefined;
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
    return this._reviseInferredType(t);
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
    | { index: FactIndex; writeVersion: number; type: BoxedType }
    | undefined = undefined;

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
   * re-ratified 2026-08-22): compute the value's current type — itself a
   * memo keyed on `ce._anyVersion`, so this is cheap after the first read
   * of a generation — and answer with it when it refutes the recorded
   * guess; answer with the recorded type when the live type is unknown or
   * still admits it. NOTHING is written: no `_type`, no `_writeVersion`
   * bump, no journal entry, no `type-write` event. Whatever changed the
   * value's type already advanced the `any` axis (or invalidated the
   * memo's object dependencies), so consumers keyed on that axis re-read;
   * the event this getter used to emit was a second advance for a change
   * the first had already covered — the item-219 hazard — and its
   * generation gate was keyed on `_semanticVersion` while the value-type
   * memo is keyed on `_anyVersion`, which is the staleness defect §2.5
   * records. A value whose live type is still ADMITTED by the guess (a
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
    if (v.operator === 'Function') return recorded;
    const live = v.type;
    if (live.isUnknown || live.matches(recorded)) return recorded;
    return live;
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
    this._setType(() => t);
  }

  /** Write this definition's declared type, deriving it with the assumptions
   * hidden.
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
    this._placeholderSkeleton = isConstructorPlaceholderType(this._type.type)
      ? this._type.type
      : undefined;

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

/** Is this declared type a bare collection constructor — the `<unknown>`
 * synonym, whose ELEMENT slot is a refinable placeholder? (The synonym
 * normalization collapses `list<unknown>` to the bare name, so the bare
 * strings are the complete trigger set.) */
export function isConstructorPlaceholderType(t: Type): boolean {
  return (
    t === 'list' ||
    t === 'set' ||
    t === 'dictionary' ||
    t === 'collection' ||
    t === 'indexed_collection'
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
  switch (skeleton) {
    case 'list':
    case 'indexed_collection':
    case 'collection': {
      // `collectionElementType` also knows the PRIMITIVE indexed
      // collections' elements (`string` → `character`, `range` →
      // `integer`), so a string-form value type is not rejected up front:
      // `a: indexed_collection; a = "abc"` refines to
      // `indexed_collection<character>` (review catch, 2026-08-18).
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
      const values =
        valueType.kind === 'dictionary'
          ? valueType.values
          : valueType.kind === 'record'
            ? widen(...Object.values(valueType.elements))
            : undefined;
      if (values === undefined || values === 'unknown') return skeleton;
      return { kind: 'dictionary', values };
    }
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
