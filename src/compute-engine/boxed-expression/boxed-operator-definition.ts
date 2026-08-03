import type {
  EffectLabel,
  EffectSet,
  FunctionSignature,
  Type,
  TypeString,
} from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import {
  hasDeclaredEffectLabel,
  isEffectSubset,
  isPureEffectSet,
  normalizeEffectSet,
  normalizeStatedEffectSet,
  sameEffectSet,
  sameEffectSetSpelling,
} from '../../common/type/effects.js';
import {
  EffectContractError,
  inferFunctionLiteralEffects,
  inferredCollectionParameterType,
  signatureEffects,
  stripArrowEffects,
} from './effects-inference.js';

import type {
  OperatorDefinition,
  Expression,
  BoxedOperatorDefinition,
  LambdaDefinition,
  CollectionHandlers,
  OperatorCompileHandler,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Scope,
  Sign,
  BindingSiteSelector,
} from '../global-types.js';

import { applicable } from '../function-utils.js';

import { DEFAULT_COMPLEXITY } from './constants.js';
import { isFunction } from './type-guards.js';
import {
  functionLiteralBody,
  functionLiteralParameters,
} from './function-literal.js';
import { functionResult, signatureArms } from '../../common/type/utils.js';
import { parseType } from '../../common/type/parse.js';
import { typeToString } from '../../common/type/serialize.js';
import { isSubtype } from '../../common/type/subtype.js';
import { defaultCollectionHandlers } from '../collection-utils.js';
import { registerProvisionalDependents } from './provisional-application.js';

const OPERATOR_DEF_KEYS = new Set([
  // Base
  'engine',
  'name',
  'description',
  'keywords',
  'examples',
  'wikidata',
  'url',

  // Function Flags
  'lazy',
  'scoped',
  'bindingSites',
  'broadcastable',
  'inspectsErrors',
  'missingBehavior',
  'missingStrip',
  'associative',
  'commutative',
  'commutativeOrder',
  'idempotent',
  'involution',
  'pure',
  'effects',
  'effectsDeclared',
  'frameProtocol',
  'invokes',
  'discharges',
  'holdClass',
  'drawsRandom',
  'readsRandomFrame',

  'inferredSignature',
  'signature',
  'type',
  'sgn',
  'even',
  'complexity',

  'canonical',
  'evaluate',
  'evaluateAsync',
  'evalDimension',
  'compile',

  'eq',
  'neq',
  'cmp',

  // Collection Handlers
  'collection',
]);

/**
 * Normalize a definition's `signature` to a `Type`/`TypeString` the local
 * bundle can box.
 *
 * When an operator definition is built by spreading an existing boxed
 * definition (`{ ...ce.lookupDefinition('At').operator, evaluate }`), its
 * `signature` field is a `BoxedType` instance. Detect it by duck-typing on its
 * inner `type` property and `matches` method — NOT `instanceof BoxedType`,
 * which fails across a host/plugin bundle boundary (see the cross-bundle
 * identity hazard in CLAUDE.md) — and unwrap it to its inner `Type` so a fresh,
 * local `BoxedType` can be constructed from it. A plain `Type`/`TypeString` is
 * returned unchanged.
 */
function normalizeSignatureField(
  sig: BoxedType | Type | TypeString
): Type | TypeString {
  if (
    typeof sig === 'object' &&
    sig !== null &&
    'type' in sig &&
    typeof (sig as { matches?: unknown }).matches === 'function'
  )
    return (sig as BoxedType).type;
  return sig as Type | TypeString;
}

/**
 * True when every parameter of a function signature is a numeric type (subtype
 * of `number`). Mirrors the `allParamsNumeric` gate used for the numeric
 * canonicalization fast-path; a signature with no parameters (or a non-signature
 * type) returns `false`. Used for the default resolution of `missingBehavior`
 * (§3.A): an undeclared, non-inferred, all-numeric signature resolves to
 * `propagate`.
 */
function signatureAllParamsNumeric(signature: Type): boolean {
  if (typeof signature === 'string') return false;
  if (signature.kind !== 'signature') return false;
  const params: Type[] = [
    ...(signature.args?.map((x) => x.type) ?? []),
    ...(signature.optArgs?.map((x) => x.type) ?? []),
    ...(signature.variadicArg ? [signature.variadicArg.type] : []),
  ];
  if (params.length === 0) return false;
  return params.every((t) => isSubtype(t, 'number'));
}

export class _BoxedOperatorDefinition implements BoxedOperatorDefinition {
  engine: ComputeEngine;

  name: string;
  description?: string | string[];
  keywords?: string[];
  url?: string;
  wikidata?: string;

  broadcastable = false;
  inspectsErrors = false;
  missingBehavior?: 'reject' | 'propagate' | 'handle';
  missingStrip: 'all' | number[] = 'all';
  associative = false;
  commutative = false;
  commutativeOrder: ((a: Expression, b: Expression) => number) | undefined;
  idempotent = false;
  involution = false;

  /** The canonical effect set, cached for getter speed. Kept in lockstep with
   * `signature.type.effects` by {@link _setEffects} — the signature is the one
   * source of truth and the two must never disagree.
   * @internal */
  private _effects: EffectSet | undefined = undefined;

  /** Set by the lambda-body inference when the walk POSITIVELY observed frame
   * participation — an explicit `random` in a head's effect set, or a
   * `frameProtocol: 'seed'` head — regardless of what the union then collapsed
   * to. `'any'` absorbs `{random}` and the derived {@link drawsRandom} requires
   * an EXPLICIT label, so a body mixing an `{any}` head (a legacy `pure: false`
   * declaration) with a real draw would otherwise report `drawsRandom: false`
   * and let `WithRandomSeed` release a frame with pending draws.
   *
   * NOT part of the effect set: the Stage 1 lattice has no carrier for
   * "definitely draws AND unknown else". An internal, inference-only bridge —
   * Stage 2's `effectsOf` runtime channel dissolves it. Never set from an
   * explicit declaration, which is authoritative on its own, and restamped in
   * lockstep with {@link _effects} so a re-inference cannot leave it stale.
   * @internal */
  private _inferredDraws = false;

  /** Annotation provenance (`docs/EFFECTS-MODEL.md`, "Annotation provenance"):
   * the EFFECTS-axis analog of {@link inferredSignature}. True when the AUTHOR
   * stated the effect set — an effect-bearing signature specifier, the `pure`
   * keyword in the specifier slot, or the `effects:` field (including
   * `effects: []`, "stated as pure") — rather than the body inference having
   * produced it. It is a cache of the one fact the SIGNATURE now records:
   * `signatureEffects(signature.type) !== undefined`, where the stated-pure
   * arrow carries `[]` and the unstated one carries nothing.
   *
   * What it gates: the definition-annotation check, and with it the revision
   * gate. `false` is the INFERRED track — a body assignment stamps, and a
   * re-assignment freely RE-stamps, whatever the walk infers. `true` makes the
   * set a CONTRACT: every assigned body must satisfy `inferred ⊆ declared`,
   * and the stored arrow keeps the DECLARED set rather than being re-stamped
   * to the tighter inferred one.
   *
   * The legacy `pure`/`drawsRandom` flags deliberately do NOT set it — they
   * are an override ("not pure"), not a contract, and a `pure: true`
   * declaration over a drawing body stays the documented escape hatch. A
   * return-type-only `Typed(body, T)` ascription likewise carries no effect
   * contract. */
  effectsDeclared = false;

  /** The latent effects of applying this operator. `undefined` (and its
   * stated-pure twin `[]`) is the empty set (pure); `'any'` is the top
   * ("unknown effects"). */
  get effects(): EffectSet | undefined {
    return this._effects;
  }

  /** Derived: "no impurity label is present". NOT set-emptiness — a future
   * non-impurity label (e.g. `async`) must not break caching by mere
   * set-nonemptiness. `'any'` reports conservatively (not pure). */
  get pure(): boolean {
    return isPureEffectSet(this._effects);
  }

  /** Derived: `random` EXPLICITLY ∈ effects, ∨ `frameProtocol === 'seed'`. The
   * second term is `WithRandomSeed`, which delimits the frame rather than
   * drawing from it.
   *
   * `'any'` does NOT satisfy this — unlike {@link pure}, where it reports
   * conservatively impure. Frame participation requires explicit declaration:
   * conservatism inverts on the frame axis (pinning forever is the harm), and
   * not-pinning is the shipped `?? false` semantics of the pending-draw walk.
   * See the `any` ruling under "Labels and lattice".
   *
   * The third term is {@link _inferredDraws}: a draw the body inference
   * positively SAW is retained even when the union collapsed to `'any'`. That
   * is not a weakening of the ruling — `'any'` alone still never satisfies
   * this getter, only an observed draw does. */
  get drawsRandom(): boolean {
    if (this.frameProtocol === 'seed') return true;
    if (this._inferredDraws) return true;
    return hasDeclaredEffectLabel(this._effects, 'random');
  }

  /** The frame protocol this operator delimits (`'seed'` for
   * `WithRandomSeed`), or `undefined`. Kind-valued, not boolean. */
  frameProtocol: 'seed' | undefined = undefined;

  /** Which operand positions may INVOKE a function-valued operand: a uniform
   * boolean (`false` for the pure containers and constructors, the storing
   * writers and the selecting conditionals), or a normalized map from 0-based
   * operand index to a boolean whose missing indices default to `true`. Read
   * through {@link invokesAt} / {@link invokesNone}, never directly. */
  invokes: boolean | { readonly [operandIndex: number]: boolean } = true;

  /** Per operand position (0-based), the effects this operator ABSORBS rather
   * than re-emits — `WithRandomSeed`'s `{ 1: ['random'] }` on its held body.
   * `undefined` (the default) discharges nothing, which is the sound default:
   * propagation is what gives `Map(xs, f)` per-call-site precision. */
  discharges:
    | { readonly [operandIndex: number]: readonly EffectLabel[] }
    | undefined = undefined;

  /** How a HELD operand position is treated by the projection rule:
   * `'evaluate'` (may-evaluate — the operator may evaluate the operand under
   * itself, so it contributes, minus any discharge) or `'quote'` (`Hold` —
   * never evaluated, contribution ∅). */
  holdClass: 'evaluate' | 'quote' | 'release' = 'evaluate';

  readsRandomFrame = false;

  complexity = DEFAULT_COMPLEXITY;

  lazy = false;

  /** Normalized from the declaration's `scoped` flag: `true` for
   * `scoped: true` AND for a binding-site selector, which implies a scope. */
  scoped = false;

  /** The binding-site selector, when the declaration's `scoped` flag was one.
   * `undefined` for a plain `scoped: true` (a scope with no syntactic bound
   * variables — `Block`, the quantifiers) and for an unscoped operator. */
  bindingSites?: BindingSiteSelector;

  /** Normalize the union-typed `scoped` declaration into the boolean the
   * engine reads plus the selector the canonicalization hook consumes.
   *
   * `spread` is the already-normalized selector of a definition built by
   * spreading a BOXED definition (`{ ...ce.lookupDefinition('Sum').operator,
   * evaluate }`), whose `scoped` is the boolean rather than the selector.
   * Honoring it keeps such an override a binder, the same reason
   * `normalizeSignatureField` accepts an already-boxed `signature`. */
  private setScoped(
    scoped: boolean | BindingSiteSelector | undefined,
    spread?: BindingSiteSelector
  ): void {
    if (scoped === undefined && spread === undefined) return;
    if (typeof scoped === 'function') {
      this.bindingSites = scoped;
      this.scoped = true;
    } else if (scoped === undefined || scoped) {
      this.bindingSites = spread ?? this.bindingSites;
      this.scoped = scoped ?? this.scoped;
    } else {
      this.bindingSites = undefined;
      this.scoped = false;
    }
  }

  signature: BoxedType;
  inferredSignature = true;

  /** True if this operator definition was created from a user-defined
   * function literal (e.g. via `ce.assign('f', ce.parse('x \\mapsto x^2'))`).
   * Used to enable auto-broadcasting when applied to indexed collections.
   * @internal
   */
  _isLambda = false;

  /** When this operator definition was created from a user-defined function
   * literal (`_isLambda === true`), this holds the boxed `Function` literal
   * it was built from. Lets a *bare* symbol bound to this definition resolve
   * to a first-class function value in value position (e.g. returning a
   * locally-defined `helper` from a function body so it can escape its
   * defining scope). `undefined` for built-in operators.
   * @internal
   */
  _lambdaLiteral?: Expression;

  /** Public, traversable view of a user-defined function literal: its
   * parameters and body. `undefined` for built-in operators. Backed by the
   * internal `_lambdaLiteral`. */
  get lambda(): LambdaDefinition | undefined {
    const literal = this._lambdaLiteral;
    if (literal === undefined || !isFunction(literal, 'Function'))
      return undefined;
    // The stored literal may be non-canonical: a MathJSON `evaluate` handler is
    // boxed with `form:'raw'` (see the constructor), so its body is a raw
    // expression rather than the canonical scoped `Block` the parse/assign
    // route produces. Canonicalize the literal (in its captured scope) so the
    // public view mirrors that route — a consumer manipulating the body must
    // get a canonical, scoped expression usable in arithmetic. Canonicalizing
    // an already-canonical literal is a no-op.
    const canonical = literal.canonical;
    if (!isFunction(canonical, 'Function')) return undefined;
    const body = functionLiteralBody(canonical);
    if (body === undefined) return undefined;
    return { parameters: functionLiteralParameters(canonical), body };
  }

  type?: (
    ops: ReadonlyArray<Expression>,
    options: {
      engine: ComputeEngine;
      operandTypes?: ReadonlyArray<Type | undefined>;
    }
  ) => BoxedType | Type | TypeString | undefined;

  sgn?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Sign | undefined;

  eq?: (a: Expression, b: Expression) => boolean | undefined;
  neq?: (a: Expression, b: Expression) => boolean | undefined;

  even?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => boolean | undefined;

  canonical?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine; scope: Scope | undefined }
  ) => Expression | null;

  evaluate?: (
    ops: ReadonlyArray<Expression>,
    options: Partial<EvaluateOptions> & { engine: ComputeEngine }
  ) => Expression | undefined;

  evaluateAsync?: (
    ops: ReadonlyArray<Expression>,
    options: Partial<EvaluateOptions> & { engine: ComputeEngine }
  ) => Promise<Expression | undefined>;

  evalDimension?: (
    ops: ReadonlyArray<Expression>,
    options: Partial<EvaluateOptions> & { engine: ComputeEngine }
  ) => Expression;

  compile?: OperatorCompileHandler;

  collection?: CollectionHandlers;

  constructor(ce: ComputeEngine, name: string, def: OperatorDefinition) {
    this.name = name;
    this.engine = ce;

    if (def.signature) {
      this.inferredSignature = false;
      this.signature = new BoxedType(
        normalizeSignatureField(def.signature),
        ce._typeResolver
      );
    } else this.signature = new BoxedType('(any*) -> unknown');

    this.update(def);
  }

  /** For debugging */
  toJSON() {
    const result: Record<string, unknown> = { name: this.name };
    if (this.wikidata) result.wikidata = this.wikidata;
    if (this.description) result.description = this.description;
    if (this.keywords) result.keywords = this.keywords;
    if (this.url) result.url = this.url;
    result.broadcastable = this.broadcastable;
    result.associative = this.associative;
    result.commutative = this.commutative;
    result.idempotent = this.idempotent;
    result.involution = this.involution;
    result.pure = this.pure;
    result.drawsRandom = this.drawsRandom;
    result.readsRandomFrame = this.readsRandomFrame;
    result.lazy = this.lazy;
    result.complexity = this.complexity;
    result.scoped = this.scoped;
    result.signature = this.signature.toString();
    result.inferredSignature = this.inferredSignature;

    if (this.collection) result.collection = this.collection;

    return result;
  }

  /**
   * The *resolved* missing-value behavior (§3.A of the missing-value typing
   * design). Computed from the declared {@link missingBehavior} and the current
   * signature on every access — never cached, so a signature mutation
   * (`update()`, `BoxedFunction.infer()`) is reflected immediately.
   */
  get resolvedMissingBehavior():
    | 'reject'
    | 'propagate'
    | 'handle'
    | 'pass-through' {
    if (this.missingBehavior) return this.missingBehavior;
    // undeclared ∧ ¬inferredSignature ∧ allParamsNumeric(sig) → propagate
    if (
      !this.inferredSignature &&
      signatureAllParamsNumeric(this.signature.type)
    )
      return 'propagate';
    return 'pass-through';
  }

  stripsMissingAt(i: number): boolean {
    const b = this.resolvedMissingBehavior;
    if (b !== 'propagate' && b !== 'handle') return false;
    return this.missingStrip === 'all' || this.missingStrip.includes(i);
  }

  /** True if operand position `i` may INVOKE a function-valued operand.
   * A map's missing indices default to `true` — the conservative answer. */
  invokesAt(i: number): boolean {
    const invokes = this.invokes;
    if (typeof invokes === 'boolean') return invokes;
    return invokes[i] ?? true;
  }

  /** True when NO position invokes. The only sound uniform answer: a map does
   * not know how many operands an application has, so it can never claim
   * "none" — `invokes: false` is the spelling for that. */
  get invokesNone(): boolean {
    return this.invokes === false;
  }

  /**
   * Install `effects` as the definition's effect set, attaching it to the
   * signature — the one source of truth — and refreshing the cache the derived
   * getters read.
   *
   * The signature `Type` is REBUILT, never mutated: types may be interned or
   * shared, so an in-place write would leak this operator's effects into every
   * other holder of the same object.
   *
   * The skip-rebuild guard compares SPELLINGS, not sets: a stated-pure `[]`
   * and an absent specifier denote the same set but serialize differently
   * (`(n) pure -> n` vs `(n) -> n`), so installing one over the other is a
   * real change the arrow has to record.
   * @internal
   */
  private _setEffects(effects: EffectSet | undefined): void {
    this._effects = effects;
    const t = this.signature.type;
    if (typeof t === 'string' || t.kind !== 'signature') return;
    if (sameEffectSetSpelling(t.effects, effects)) return;
    const next: FunctionSignature = { ...t };
    if (effects === undefined) delete next.effects;
    else next.effects = effects;
    this.signature = new BoxedType(next, this.engine._typeResolver);
  }

  /**
   * Re-attach the definition's current effect set to the signature after the
   * signature object was REPLACED by type inference
   * (`BoxedFunction.infer()`). The cached `_effects` is authoritative in that
   * situation: a rebuilt signature is assembled from the type-inference fields
   * alone, so without this the arrow would serialize pure while the definition
   * still reports its effects — the two must never disagree.
   * @internal
   */
  _resyncEffects(): void {
    this._setEffects(this._effects);
  }

  update(def: OperatorDefinition): void {
    if (this.engine.strict) {
      for (const key in def) {
        // Silently ignore private fields so that spreading an existing boxed
        // operator definition (`{ ...ce.lookupDefinition('At').operator }`) to
        // override a handler is accepted: such a spread carries private keys
        // (`_isLambda`, `_lambdaLiteral`, …) that are intentionally absent
        // from `OPERATOR_DEF_KEYS`. Its public engine-internal keys
        // (`engine`, `name`, `inferredSignature`) are already listed there and
        // need no carve-out. A genuine typo key (e.g. `evaluete`) is neither
        // private nor listed, and still throws.
        if (key.startsWith('_')) continue;
        if (!OPERATOR_DEF_KEYS.has(key))
          throw new Error(
            `Operator Definition "${this.name}": unexpected key "${key}"`
          );
      }
    }

    if ('name' in def && def.name !== this.name)
      throw new Error(
        `Operator Definition "${this.name}": cannot change name to "${def.name}"`
      );

    if ('engine' in def && def.engine !== this.engine)
      throw new Error(
        `Operator Definition "${this.name}": cannot change engine`
      );

    this.lazy = def.lazy ?? this.lazy;
    this.setScoped(
      def.scoped,
      (def as Partial<BoxedOperatorDefinition>).bindingSites
    );

    const idempotent = def.idempotent ?? this.idempotent;
    const involution = def.involution ?? this.involution;

    if (idempotent && involution)
      throw new Error(
        `Operator Definition "${this.name}": the 'idempotent' and 'involution' flags are mutually exclusive`
      );
    this.idempotent = idempotent;
    this.involution = involution;

    this.description = def.description ?? this.description;
    this.keywords = def.keywords ?? this.keywords;
    this.collection = def.collection ?? this.collection;
    this.url = def.url ?? this.url;
    this.wikidata = def.wikidata ?? this.wikidata;

    this.broadcastable = def.broadcastable ?? this.broadcastable;
    this.inspectsErrors = def.inspectsErrors ?? this.inspectsErrors;
    this.missingBehavior = def.missingBehavior ?? this.missingBehavior;
    this.missingStrip = def.missingStrip ?? this.missingStrip;
    this.associative = def.associative ?? this.associative;
    this.commutative = def.commutative ?? this.commutative;
    this.commutativeOrder = def.commutativeOrder ?? this.commutativeOrder;

    if (this.commutativeOrder && !this.commutative)
      throw new Error(
        `Operator Definition "${this.name}": the 'commutativeOrder' handler requires the 'commutative' flag`
      );

    // If the lazy flag is set, the arguments are not canonicalized, so they
    // cannot be associative, commutative, idempotent, or involution
    // if (
    //   def.lazy &&
    //   (def.associative || def.commutative || def.idempotent || def.involution)
    // )
    //   throw new Error(
    //     `Operator Definition "${name}": the 'lazy' flag is incompatible with the 'associative', 'commutative', 'idempotent', and 'involution' flags`
    //   );

    if (
      def.canonical &&
      (def.associative || def.commutative || def.idempotent || def.involution)
    )
      throw new Error(
        `Operator Definition "${this.name}": the 'canonical' handler is incompatible with the 'associative', 'commutative', 'idempotent', and 'involution' flags`
      );

    // --- Effects (`docs/EFFECTS-MODEL.md`, "One source of truth") ----------
    // The legacy `pure` / `drawsRandom` flags remain valid authoring sugar,
    // translated once here by the normative truth table. The `effects:` field
    // (or an effect-annotated signature string) is the precise surface; when
    // both are given and disagree this is a registration error, never silent
    // precedence.
    const legacy = legacyFlagEffects(this.name, def.pure, def.drawsRandom);
    // `effects: []` is the programmatic twin of the `pure` keyword: it states
    // the empty set, so it normalizes to `[]` (not `undefined`) and reaches
    // the signature as the stated spelling.
    let effects: StatedEffects =
      def.effects === undefined
        ? UNSTATED_EFFECTS
        : { stated: true, effects: normalizeStatedEffectSet(def.effects) };
    // Whether the body inference below positively observed a draw. Only the
    // inference sets it: an explicit declaration is authoritative on its own.
    let inferredDraws = false;
    // Annotation provenance (`docs/EFFECTS-MODEL.md`, "Annotation provenance").
    // The `effects:` field is one of the two spellings that make the effect set
    // a CONTRACT; the other — an effect-bearing specifier on the signature — is
    // detected below. Deliberately NOT set by the legacy `pure`/`drawsRandom`
    // sugar, which promises only "not pure" and is an override, not a contract.
    if (def.effects !== undefined) this.effectsDeclared = true;

    this.frameProtocol = def.frameProtocol ?? this.frameProtocol;
    if (def.invokes !== undefined)
      this.invokes = normalizeInvokes(this.name, def.invokes);
    if (def.discharges !== undefined)
      this.discharges = normalizeDischarges(this.name, def.discharges);
    this.holdClass = def.holdClass ?? this.holdClass;
    this.readsRandomFrame = def.readsRandomFrame ?? this.readsRandomFrame;
    this.complexity = def.complexity ?? this.complexity;

    if (def.signature) {
      const oldSig = normalizeSignatureField(def.signature);
      const sigType = parseType(oldSig, this.engine._typeResolver);
      const newSig = this.engine.type(sigType);
      if (oldSig && !newSig.matches(this.engine.type(oldSig))) {
        throw new Error(
          `Operator Definition "${this.name}": signature "${newSig}" does not match "${oldSig}"`
        );
      }
      this.signature = newSig;

      if ('inferredSignature' in def)
        this.inferredSignature = def.inferredSignature as boolean;

      // Effects written in the signature's specifier slot are the same
      // statement as the `effects:` field. (This is also how the effects of a
      // definition built by spreading a boxed one survive the spread: the
      // derived `pure`/`drawsRandom` getters live on the prototype and are not
      // copied, but the effect-bearing `signature` is.)
      // `pure` in the slot is the explicitly-stated EMPTY set — `effects: []`
      // on the arrow — so a stated specifier with no labels is still a
      // CONTRACT, the same input as the `effects: []` field. Stated-ness is
      // therefore just "the arrow carries an effect set at all".
      const sigEffects = signatureEffects(this.signature.type);
      if (sigEffects !== undefined) {
        if (effects.stated && !sameEffectSet(effects.effects, sigEffects))
          throw new Error(
            `Operator Definition "${this.name}": the 'effects' field and the effects on the signature "${this.signature}" disagree`
          );
        effects = { stated: true, effects: sigEffects };
        this.effectsDeclared = true;
      }

      assertArmsDistinguishableWithoutEffects(this.name, this.signature.type);
    }

    if (legacy.stated) {
      if (effects.stated) {
        if (!sameEffectSet(effects.effects, legacy.effects))
          throw new Error(
            `Operator Definition "${this.name}": the declared effects and the 'pure'/'drawsRandom' flags disagree`
          );
      } else effects = legacy;
    }

    this.type = def.type ?? this.type;
    this.evaluateAsync = def.evaluateAsync ?? this.evaluateAsync;
    this.canonical = def.canonical ?? this.canonical;
    this.evalDimension = def.evalDimension ?? this.evalDimension;
    this.sgn = def.sgn ?? this.sgn;
    this.even = def.even ?? this.even;
    this.compile = def.compile ?? this.compile;
    this.eq = def.eq ?? this.eq;
    this.neq = def.neq ?? this.neq;
    this.setScoped(
      def.scoped,
      (def as Partial<BoxedOperatorDefinition>).bindingSites
    );
    this.lazy = def.lazy ?? this.lazy;

    if (def.collection)
      this.collection = defaultCollectionHandlers(def.collection);

    // An `isCollection` handler declares that collection-ness is decided
    // per-instance from the operands (e.g. `When`, a collection only when the
    // value it guards is one). Such an operator's result type is legitimately
    // not a collection type in general, so skip the static signature check.
    if (this.collection && !this.collection.isCollection) {
      // If we have collection handlers, the result type must be a collection
      const resultType = functionResult(this.signature.type);
      if (!resultType)
        throw new Error(
          `Operator Definition "${this.name}": a collection handler is defined, but the signature "${this.signature}" does not have a result type`
        );
      if (!isSubtype(resultType, 'collection'))
        throw new Error(
          `Operator Definition "${this.name}": a collection handler is defined, but the signature "${this.signature}" is not a collection type`
        );
      if (isSubtype(resultType, 'indexed_collection') && !this.collection.at) {
        throw new Error(
          `Operator Definition "${this.name}" returns an indexed collection, but the 'at' handler is missing`
        );
      }
      // @fixme: this warning cannot reliably be checked, because some functions (Map, Filter) return an indexed collection if the input is indexed. Would need support for type arguments in signatures.
      // if (!isSubtype(resultType, 'indexed_collection') && this.collection.at) {
      //   throw new Error(
      //     `Operator Definition "${this.name}" returns a non-indexed collection, but the 'at' handler is defined`
      //   );
      // }
    }

    let evaluate: _BoxedOperatorDefinition['evaluate'] | undefined = undefined;
    if (def.evaluate && typeof def.evaluate !== 'function') {
      // If the function is scoped, create a local scope
      const scope: Scope | undefined = this.scoped
        ? {
            parent: this.engine.context.lexicalScope,
            bindings: new Map(),
          }
        : undefined;
      const boxedFn = this.engine.expr(def.evaluate, {
        form: 'raw',
        scope,
      });
      if (!boxedFn.isValid)
        throw Error(`Invalid function ${boxedFn.toString()}`);

      // If no explicit signature was provided and the evaluate handler is a
      // Function expression, infer the signature from the function parameters
      // and body type.
      if (
        this.inferredSignature &&
        isFunction(boxedFn) &&
        boxedFn.operator === 'Function'
      ) {
        const body = boxedFn.ops[0];
        const params = boxedFn.ops.slice(1);
        // The signature is assembled as a Type OBJECT, never as a string that
        // is re-parsed: a body type may REFERENCE a type declared inside the
        // body's own scope (`function f(a) { type inner = …; inner(a, a) }`),
        // and that name is not resolvable from the declaration site the
        // definition is installed at — serializing it to `"(unknown) -> inner"`
        // and re-parsing here threw "Unknown type". The `TypeReference` object
        // carries its own `def`, so it stays usable wherever it escapes to.
        const signature: Type = {
          kind: 'signature',
          // A parameter slot is `unknown` unless the body's uses inferred a
          // COLLECTION type for it (`v[1]` narrows `v` through `At`'s
          // signature): surfacing that keeps `paramsAreScalar` false, so a
          // list argument is applied to the function rather than broadcast
          // element-wise over it. Same rule, same helper as the literal's own
          // arrow (`functionLiteralSignatureType`).
          ...(params.length > 0
            ? {
                args: params.map((p) => ({
                  type: inferredCollectionParameterType(p) ?? 'unknown',
                })),
              }
            : {}),
          result: body.type.type,
        };
        this.signature = new BoxedType(signature, this.engine._typeResolver);
      }

      // Mark this operator definition as backed by a user-defined function
      // literal. Enables auto-broadcasting at apply time.
      if (isFunction(boxedFn) && boxedFn.operator === 'Function') {
        this._isLambda = true;
        this._lambdaLiteral = boxedFn;

        // If the body froze a juxtaposition as multiplication only because its
        // leading symbol had no function definition yet, wait on that symbol:
        // definition order must not change semantics
        // (`provisional-application.ts`).
        registerProvisionalDependents(this.engine, boxedFn, this);

        // Derive the effect set from the BODY unless the caller stated it (as
        // `effects:`, as an effect-annotated signature, or as the legacy
        // `pure` / `drawsRandom` sugar). A user function is otherwise born
        // pure — the empty effect set — so `f() := Random()` would
        // claim to be a pure — hence CONSTANT — expression while drawing from
        // the stream on every call. Two things break on that lie:
        // `Add`/`Multiply` keep a PURE operand raw under `.N()` and
        // re-evaluate it (drawing twice, see `library/arithmetic.ts`), and
        // `WithRandomSeed`'s pending-draw gate is keyed on `drawsRandom`, so a
        // partially-evaluated body calling `f` loses its frame and silently
        // resumes with LIVE draws (the Tycho item 104 failure).
        // `readsRandomFrame` is inferred alongside them, for the same gate: a
        // body calling a stochastic ESTIMATOR (`Integrate`) depends on the
        // frame without consuming its indices, so a call that could not finish
        // must keep the frame too.
        const inferred = inferFunctionLiteralEffects(this.engine, boxedFn, {
          selfName: this.name,
        });
        // The definition-annotation CHECK. An explicit effect annotation is a
        // contract, accepted iff `inferred ⊆ declared` (over-declaring
        // weakens, and is allowed). The contract is the set the AUTHOR stated
        // — this update's, or the one a previous update declared and this one
        // says nothing about (re-`Assign`ing a body must not silently rewrite
        // a declared contract into whatever the new body infers).
        //
        // The trusted-annotation escape (v5): when the walk saw an UNRESOLVED
        // named head the check cannot run — the head is opaque at this moment,
        // the same residual trust class as an opaque host declaration — so the
        // annotation installs as stated and is NOT revalidated when the head
        // later resolves (no dependency tracking).
        const declared: StatedEffects | undefined = this.effectsDeclared
          ? effects.stated
            ? effects
            : { stated: true, effects: this._effects }
          : undefined;
        if (declared !== undefined) {
          if (
            !inferred.unresolvedHead &&
            !isEffectSubset(inferred.effects, declared.effects)
          )
            throw new EffectContractError(
              this.name,
              declared.effects,
              inferred.effects
            );
          effects = declared;
          // A declared contract is authoritative on frame participation too,
          // but a draw the walk positively SAW is retained: an `any` contract
          // absorbs `{random}`, and `drawsRandom` requires an explicit label.
          inferredDraws = inferred.draws;
        } else if (!effects.stated) {
          effects = { stated: true, effects: inferred.effects };
          inferredDraws = inferred.draws;
        }
        if (def.readsRandomFrame === undefined)
          this.readsRandomFrame = inferred.readsRandomFrame;
      }

      const fn = applicable(boxedFn);
      // Thread the caller's options (esp. `numericApproximation` from
      // `.N()`) into the lambda: the approximation is applied INSIDE the
      // function's scope frame (see makeLambda), never by re-evaluating
      // the result in the caller's dynamic context — which would break
      // lexical scoping.
      evaluate = (xs, options) => fn(xs, options);
      Object.defineProperty(evaluate, 'toString', {
        value: () => boxedFn.toString(),
      }); // For debugging/_printScope
    } else if (typeof def.evaluate === 'function') {
      evaluate = def.evaluate;
    } else {
      evaluate = this.evaluate;
    }

    this.evaluate = evaluate;

    // Attach the resolved effect set to the (possibly just-rebuilt) signature.
    // Re-stamping the retained set is what keeps a signature-only update from
    // silently dropping the effects.
    this._setEffects(effects.stated ? effects.effects : this._effects);
    // The inference-only draw bit moves in lockstep with the effect set: an
    // update that STATES effects (explicitly, or by re-running the body
    // inference) replaces it, so a redefinition cannot leave it stale; one that
    // states nothing retains it, exactly as it retains `_effects`.
    if (effects.stated) this._inferredDraws = inferredDraws;
  }
}

/** An effect set together with whether this declaration said anything about
 * effects at all — "unstated" and "stated as pure" are different inputs. */
type StatedEffects = { stated: boolean; effects: EffectSet | undefined };

const UNSTATED_EFFECTS: StatedEffects = { stated: false, effects: undefined };

/**
 * Translate the legacy `pure` / `drawsRandom` authoring flags into an effect
 * set. The normative truth table (`docs/EFFECTS-MODEL.md`, "One source of
 * truth — and the flag migration"):
 *
 * | `pure`          | `drawsRandom`    | effects                          |
 * |-----------------|------------------|----------------------------------|
 * | `true`/omitted  | `false`/omitted  | ∅ (pure)                         |
 * | `false`         | `true`           | `{random}`                       |
 * | omitted         | `true`           | `{random}`                       |
 * | `false`         | `false`/omitted  | `{any}` — unclassified impurity  |
 * | `true`          | `true`           | registration error               |
 *
 * The `{any}` row is deliberate: `pure: false` promises only "not pure", and
 * an opaque host function may be entropy or IO (`RandomExpression` is the live
 * counterexample). `{scope}` — and every other capability label — is only ever
 * assigned EXPLICITLY.
 *
 * Both flags omitted is not the first row: it is no statement at all, and must
 * not override an effect-annotated signature.
 */
function legacyFlagEffects(
  name: string,
  pure: boolean | undefined,
  drawsRandom: boolean | undefined
): StatedEffects {
  if (pure === undefined && drawsRandom === undefined) return UNSTATED_EFFECTS;
  if (pure === true && drawsRandom === true)
    throw new Error(
      `Operator Definition "${name}": the 'pure' and 'drawsRandom' flags are contradictory — a draw from the random stream is not pure`
    );
  if (drawsRandom === true) return { stated: true, effects: ['random'] };
  if (pure === false) return { stated: true, effects: 'any' };
  return { stated: true, effects: undefined };
}

/**
 * Arms of an overload set that differ **only** by their effect specifier are a
 * definition error (`docs/EFFECTS-MODEL.md`, "Overloads").
 *
 * Selection is a typing concern driven by the ARGUMENT types; effects merely
 * break a tie between arms already equally specific there. Two arms identical
 * modulo effects therefore leave the tie-break as the only discriminator, and
 * it would silently pick the pure one at every call site — an overload set that
 * cannot express what its author wrote. Rejected at registration, like every
 * other definition contradiction.
 *
 * Only an INTERSECTION is an overload set (see `overloadArms`); a plain
 * signature has a single arm, and a union of signatures is not resolved to one.
 */
function assertArmsDistinguishableWithoutEffects(
  name: string,
  type: Type
): void {
  if (typeof type === 'string' || type.kind !== 'intersection') return;
  const arms = signatureArms(type);
  if (arms === undefined || arms.length < 2) return;
  // Pairwise, on the arms with their effect specifier stripped: identical
  // shapes are a conflict exactly when the effect sets differ (identical arms
  // are a plain duplicate, which the type reducer already collapses).
  const stripped = arms.map((arm) => typeToString(stripArrowEffects(arm)));
  for (let i = 0; i < arms.length; i++)
    for (let j = i + 1; j < arms.length; j++)
      if (
        stripped[i] === stripped[j] &&
        !sameEffectSet(arms[i].effects, arms[j].effects)
      )
        throw new Error(
          `Operator Definition "${name}": the overload arms "${typeToString(
            arms[i]
          )}" and "${typeToString(
            arms[j]
          )}" differ only by their effects; overload arms must be distinguishable by their argument types`
        );
}

/**
 * Validate and canonicalize an `invokes:` declaration — a uniform boolean, or
 * a map from 0-based operand index to a boolean.
 *
 * Fails closed, like {@link normalizeDischarges}: a non-integer or negative
 * index, or a non-boolean value, is a registration error rather than a
 * silently ignored declaration that would leave the operator over- (or worse,
 * under-) reporting the latent half of its operands' effects.
 *
 * Entries that are `true` are the default and are dropped; a map that says
 * nothing else collapses to the uniform `true`.
 */
function normalizeInvokes(
  name: string,
  invokes: boolean | { readonly [operandIndex: number]: boolean }
): boolean | { readonly [operandIndex: number]: boolean } {
  if (typeof invokes === 'boolean') return invokes;
  const result: { [operandIndex: number]: boolean } = {};
  let count = 0;
  for (const key of Object.keys(invokes)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0)
      throw new Error(
        `Operator Definition "${name}": the 'invokes' field is keyed by operand index; "${key}" is not one`
      );
    const value = invokes[index];
    if (typeof value !== 'boolean')
      throw new Error(
        `Operator Definition "${name}": the 'invokes' entry at operand ${index} must be a boolean`
      );
    if (value) continue;
    result[index] = false;
    count += 1;
  }
  return count === 0 ? true : result;
}

/**
 * Validate and canonicalize a `discharges:` declaration — a map from 0-based
 * operand index to the labels the operator absorbs at that position.
 *
 * Fails closed, like {@link normalizeEffectSet}: a non-integer index, a
 * negative index, an unknown label or `'any'` (the top is not dischargeable —
 * a discharge set is finite by construction) is a registration error, never a
 * silently ignored declaration that would leave the operator propagating what
 * it claims to absorb.
 */
function normalizeDischarges(
  name: string,
  discharges: { readonly [operandIndex: number]: readonly EffectLabel[] }
): { readonly [operandIndex: number]: readonly EffectLabel[] } | undefined {
  const result: { [operandIndex: number]: readonly EffectLabel[] } = {};
  let count = 0;
  for (const key of Object.keys(discharges)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0)
      throw new Error(
        `Operator Definition "${name}": the 'discharges' field is keyed by operand index; "${key}" is not one`
      );
    const labels = normalizeEffectSet(discharges[index]);
    if (labels === undefined) continue;
    if (labels === 'any')
      throw new Error(
        `Operator Definition "${name}": 'any' cannot be discharged at operand ${index}; a discharge set is a finite set of labels`
      );
    result[index] = labels;
    count += 1;
  }
  return count === 0 ? undefined : result;
}
