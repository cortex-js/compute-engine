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

import { defaultCollectionHandlers } from '../collection-utils.js';
import type { LatexString } from '../latex-syntax/types.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { isFunction } from './type-guards.js';
import { matchesDeclaredTypeAxes } from './effects-inference.js';
import { declaredTypeError } from './type-compatibility-error.js';
import { isLatexString } from '../latex-syntax/utils.js';
import { parse as parseLatex } from '../latex-syntax/latex-syntax.js';
import { ConfigurationChangeListener } from '../../common/configuration-change.js';
import { CACHE_STATS, recordBump } from '../../common/cache-stats.js';

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
   * `list<finite_integer>`, while `a = ["x"]` re-refines. `undefined` for
   * every other declaration. */
  _placeholderSkeleton: Type | undefined = undefined;

  // History of writes to this definition's type (see `TypeProvenanceEntry`
  // in `types-definitions.ts` and the phase-1 design in
  // `docs/plans/2026-08-13-inference-provenance-journal.md`). Declared here
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
  // `binders.ts`; `docs/plans/2026-07-26-binder-mechanism-design.md` §2.1).
  // Declared here — rather than assigned on demand — so a call frame's
  // definition keeps the same object shape as every other one.
  _activationOf: BoxedValueDefinition | undefined = undefined;

  // True when this binding is a SHIELD: a valueless shadow declared solely to
  // hide an enclosing binding's value (`withValueShield` in `utils.ts`,
  // `simplifyValueBlind` in `simplify.ts`). Read by `evaluateInOwnBindings`'s
  // restriction 2 (`markShieldDeclaration`, `binders.ts`;
  // `docs/plans/2026-07-26-binder-mechanism-design.md` §4). Declared here —
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

  constructor(ce: ComputeEngine, name: string, def: Partial<ValueDefinition>) {
    this._engine = ce;
    this.name = name;

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
          throw declaredTypeError(this.name, this._value, this._type);
        }
        // A declared placeholder skeleton refines from the initializer,
        // exactly as it refines from an assignment (Phase 1 rulings, ruled
        // 2026-08-18): `let a: list = [1, 2, 3]` reports
        // `list<finite_integer>` just as the split `let a: list; a = [1,2,3]`
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

  get value(): Expression | undefined {
    if (this._value === null)
      this._value = dynamicValue(this._engine, this._defValue);
    return this._value;
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
      // (`docs/plans/2026-08-13-effects-axis-provenance.md`, rollback
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
   * `docs/plans/2026-08-13-inference-tx-design.md`.
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

  get type(): BoxedType {
    const t = this._type;
    if (t === undefined || t === null)
      return this._value?.type ?? BoxedType.unknown;
    return this._reviseInferredType(t);
  }

  // The semantic generation (`ce._semanticVersion`) at which the inferred
  // type was last checked against the value's live type — see
  // `_reviseInferredType`. `-1` = never checked.
  private _revisionVersion = -1;

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
   * The check runs at most once per semantic generation per definition (an
   * integer compare on the hot path otherwise; the value's own `type` is
   * memoized per generation), and applies the rule the assign path already
   * uses when a guess is incompatible with its value (D11,
   * `engine-declarations.ts`): adopt the value's own current type. A value
   * whose live type is still ADMITTED by the guess (a subtype) leaves the
   * likely type in place. Self-referential bindings (`a := a + 1`) are
   * skipped: reading their value's type reads this type.
   *
   * This is a deliberate, bounded exception to this file's "pay for
   * precision at write sites, never at read sites" principle (`set value`
   * below): the refuting event is a write to a DIFFERENT definition (the
   * dependency's), which cannot reach this one at its own write site without
   * a dependency graph the engine does not keep. The generation gate is what
   * bounds the exception — after the first read of a generation, the getter
   * is back to an integer compare.
   *
   * When the type actually moves, the same `type-write` state event every
   * other def-retype site pairs with the write is emitted (its axis mask is
   * `any` only — R5, `engine-configuration-lifecycle.ts` — so emitting from
   * a read path cannot advance `semantic` and re-trigger this gate): a
   * G-keyed `_type`/`_sgn` memo on a compound expression must see the
   * revision even if the event that made it due had, for some future axis
   * table, not advanced `any` itself.
   */
  private _reviseInferredType(recorded: BoxedType): BoxedType {
    if (!this.inferredType || this._isConstant || this._isSelfReferential)
      return recorded;
    const v = this._value;
    if (v === undefined || v === null || !isFunction(v)) return recorded;
    if (v.operator === 'Function') return recorded;
    const generation = this._engine._semanticVersion;
    if (generation === this._revisionVersion) return recorded;
    this._revisionVersion = generation;
    const live = v.type;
    if (live.isUnknown || live.matches(recorded)) return recorded;
    this._engine._noteStateEvent({
      kind: 'type-write',
      callableBefore: containsSignatureArm(recorded.type),
      callableAfter: containsSignatureArm(live.type),
    });
    this._type = live;
    this._writeVersion += 1;
    return live;
  }

  set type(t: Type | TypeString | BoxedType) {
    if (this._isConstant)
      throw new Error(
        `The type of the constant "${this.name}" cannot be changed`
      );

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
    this._type = t;
    this._writeVersion += 1;
  }

  onConfigurationChange(): void {
    // Force the value to be recalculated based on the original definition
    if (this.isConstant) this._value = null;
  }

  dispose(): void {
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
 * TYPE (not a value expression) is in hand. */
export function widenAssignedType(ce: ComputeEngine, t: Type): Type {
  const bt = ce.type(t);
  if (bt.matches('integer')) return 'integer';
  if (bt.matches('rational')) return 'real';
  if (bt.matches('real')) return 'real';
  if (bt.matches('complex')) return 'number';
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
    // If the value matches an integer (or a finite_integer), we promote the type to `integer`
    // x = 2 => integer
    return ce.type('integer');
  }

  if (value.type.matches('rational')) {
    // If the value matches a rational number, we promote the type to `real`
    // x = 1/2 => real
    return ce.type('real');
  }

  if (value.type.matches('real')) {
    // If the value matches a real number (or `finite_real_number`), we promote the type to `real`
    // x = 3.14 => real
    // x = oo => real
    return ce.type('real');
  }

  if (value.type.matches('complex')) {
    // If the value is complex (3+2i) or imaginary (-4i), we promote the type to `number`
    // x = 3+2i => number
    return ce.type('number');
  }
  // No promotion for other types.
  // @todo: could consider promoting `list<T>` to `list` or...?
  return value.type;
}
