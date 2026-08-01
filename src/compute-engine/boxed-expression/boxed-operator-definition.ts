import type {
  EffectSet,
  FunctionSignature,
  Type,
  TypeString,
} from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import {
  hasDeclaredEffectLabel,
  isPureEffectSet,
  normalizeEffectSet,
  sameEffectSet,
  unionEffectSets,
} from '../../common/type/effects.js';

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
import { isSubtype } from '../../common/type/subtype.js';
import { defaultCollectionHandlers } from '../collection-utils.js';

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
  'frameProtocol',
  'invokes',
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

  /** The latent effects of applying this operator. `undefined` is the empty
   * set (pure); `'any'` is the top ("unknown effects"). */
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

  /** `false` when no operand position invokes a function-valued operand — the
   * pure containers and constructors, which only store the value. */
  invokes = true;

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
   * (`infer()`/`update()`) is reflected immediately.
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

  /**
   * Install `effects` as the definition's effect set, attaching it to the
   * signature — the one source of truth — and refreshing the cache the derived
   * getters read.
   *
   * The signature `Type` is REBUILT, never mutated: types may be interned or
   * shared, so an in-place write would leak this operator's effects into every
   * other holder of the same object.
   * @internal
   */
  private _setEffects(effects: EffectSet | undefined): void {
    this._effects = effects;
    const t = this.signature.type;
    if (typeof t === 'string' || t.kind !== 'signature') return;
    if (sameEffectSet(t.effects, effects)) return;
    const next: FunctionSignature = { ...t };
    if (effects === undefined) delete next.effects;
    else next.effects = effects;
    this.signature = new BoxedType(next, this.engine._typeResolver);
  }

  /**
   * Re-attach the definition's current effect set to the signature after the
   * signature object was REPLACED by type inference (here, or in
   * `BoxedFunction.infer()`). The cached `_effects` is authoritative in that
   * situation: a rebuilt signature is assembled from the type-inference fields
   * alone, so without this the arrow would serialize pure while the definition
   * still reports its effects — the two must never disagree.
   * @internal
   */
  _resyncEffects(): void {
    this._setEffects(this._effects);
  }

  infer(sig: Type): void {
    const newSig = new BoxedType(sig, this.engine._typeResolver);
    if (!newSig.matches(this.signature))
      throw new Error(
        `Operator Definition "${this.name}": inferred signature "${newSig}" does not match current signature "${this.signature}"`
      );
    if (this.inferredSignature) {
      this.signature = newSig;
      this._resyncEffects();
    }
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
    let effects: StatedEffects =
      def.effects === undefined
        ? UNSTATED_EFFECTS
        : { stated: true, effects: normalizeEffectSet(def.effects) };
    // Whether the body inference below positively observed a draw. Only the
    // inference sets it: an explicit declaration is authoritative on its own.
    let inferredDraws = false;

    this.frameProtocol = def.frameProtocol ?? this.frameProtocol;
    this.invokes = def.invokes ?? this.invokes;
    this.readsRandomFrame = def.readsRandomFrame ?? this.readsRandomFrame;
    this.complexity = def.complexity ?? this.complexity;

    if (def.signature) {
      const oldSig = normalizeSignatureField(def.signature);
      const newSig = this.engine.type(oldSig);
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
      const sigEffects = signatureEffects(this.signature.type);
      if (sigEffects !== undefined) {
        if (effects.stated && !sameEffectSet(effects.effects, sigEffects))
          throw new Error(
            `Operator Definition "${this.name}": the 'effects' field and the effects on the signature "${this.signature}" disagree`
          );
        effects = { stated: true, effects: sigEffects };
      }
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
        const bodyType = body.type.toString();
        const paramTypes = params.map(() => 'unknown').join(', ');
        this.signature = new BoxedType(
          `(${paramTypes}) -> ${bodyType}`,
          this.engine._typeResolver
        );
      }

      // Mark this operator definition as backed by a user-defined function
      // literal. Enables auto-broadcasting at apply time.
      if (isFunction(boxedFn) && boxedFn.operator === 'Function') {
        this._isLambda = true;
        this._lambdaLiteral = boxedFn;

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
        if (!effects.stated || def.readsRandomFrame === undefined) {
          const inferred = inferLambdaFlags(this.engine, boxedFn);
          if (!effects.stated) {
            effects = { stated: true, effects: inferred.effects };
            inferredDraws = inferred.draws;
          }
          if (def.readsRandomFrame === undefined)
            this.readsRandomFrame = inferred.readsRandomFrame;
        }
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
 * The effects attached to a signature type's arrow, if any.
 *
 * An INTERSECTION of signatures is the overload-set representation (see
 * `overloadArms` in `overload.ts` — matched here rather than imported, which
 * would close a cycle through `boxed-expression/utils.ts`). The definition-wide
 * derived getters read the UNION of the arms' effects ("One source of truth"
 * and "Overloads" in `docs/EFFECTS-MODEL.md`): an overload with one
 * effect-bearing arm is not a pure definition. A MIXED intersection is not a
 * callable overload set and still contributes nothing.
 */
function signatureEffects(t: Type): EffectSet | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'signature') return t.effects;
  if (t.kind !== 'intersection') return undefined;
  const arms = signatureArms(t);
  if (arms === undefined) return undefined;
  let effects: EffectSet | undefined = undefined;
  for (const arm of arms) effects = unionEffectSets(effects, arm.effects);
  return effects;
}

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
 * Infer the effect set of an operator definition backed by a user `Function`
 * literal, from the heads its body applies, plus the peer `readsRandomFrame`
 * runtime field (which is NOT an effect — see the noise-floor convention in
 * `docs/EFFECTS-MODEL.md`).
 *
 * The rule is a one-way accumulation: a body starts pure (the empty set) and
 * unions in the effects of every head with a KNOWN definition. The derived
 * `pure` / `drawsRandom` getters then read out of the stamped set, so the
 * relationships they used to encode by hand hold structurally: `{random}`
 * makes the definition both drawing and impure, `{scope}` impure but owing the
 * stream nothing.
 *
 * Three deliberate limits, all failing in the OPTIMISTIC direction (a
 * definition that stays pure when it should not), which is why they are worth
 * stating rather than hiding:
 *
 * - **A head with no operator definition is treated as pure.** That covers the
 *   higher-order case — `f(g) := g()` cannot know what `g` will be — and an
 *   as-yet-undeclared name. Treating unknown heads as impure would instead
 *   mark most user functions impure, losing `isConstant`, the `Map` lowering
 *   fast path, and the type/sgn caches for them.
 * - **Flags are read from the callee's definition, not re-derived from its
 *   body**, so composition works only when definitions are made in dependency
 *   order: `f() := g()` written BEFORE `g` is defined sees no definition for
 *   `g` and stays pure. Redefining `f` after `g` re-runs the inference.
 * - **A self-call is neutral** — the definition being constructed still holds
 *   the defaults — so a recursive function is classified by the rest of its
 *   body, which is where any draw or write actually appears.
 *
 * `Hold` is NOT skipped: `Hold(Random())` marks the definition as drawing even
 * though nothing draws until `Release`. That is the conservative direction
 * (the cost is a lost optimization) and it keeps the walk a plain structural
 * scan.
 *
 * The literal arrives in `'raw'` form, so its nodes are UNBOUND and
 * `operatorDefinition` is `undefined` throughout — the lookup by name is the
 * load-bearing path here, not a fallback (same shape as `isImpureHead` in
 * `library/map-lowering.ts`).
 */
function inferLambdaFlags(
  ce: ComputeEngine,
  literal: Expression
): {
  effects: EffectSet | undefined;
  readsRandomFrame: boolean;
  draws: boolean;
} {
  // A parameter shadows any same-named operator for the whole body, so
  // `f(Random) := Random` must not be read as a draw.
  const params = new Set(functionLiteralParameters(literal).map((p) => p.name));

  let effects: EffectSet | undefined = undefined;
  // `f(a) := Integrate(...)` must keep the seed frame for the same reason the
  // built-in estimator does: a call that could not finish still depends on it.
  // A peer runtime field, not an effect: a framed estimate is reproducible,
  // which is exactly what `pure` claims.
  let readsRandomFrame = false;
  // Frame participation the walk POSITIVELY observed, kept separately from the
  // union because `any` absorbs `{random}` and the derived `drawsRandom` reads
  // only EXPLICIT labels: a body calling both an `{any}` head and a real draw
  // collapses to `{any}` and would otherwise report no draw at all. Stored on
  // the definition as `_inferredDraws` (an inference-only Stage 1 bridge).
  let draws = false;

  const visit = (expr: Expression): void => {
    // Saturated: nothing further can change the answer.
    if (effects === 'any' && readsRandomFrame && draws) return;
    if (!isFunction(expr)) return;

    const head = expr.operator;
    if (head !== 'Function' && !params.has(head)) {
      const def = expr.operatorDefinition ?? operatorDefinitionOf(ce, head);
      if (def?.readsRandomFrame === true) readsRandomFrame = true;
      // Read from the callee's DERIVED getter, so an explicit `random`, a
      // frame-protocol head, and a callee whose own inference saw a draw all
      // propagate — the same composition rule as the effect union.
      if (def?.drawsRandom === true) draws = true;
      // A head that participates in the seed frame through a FRAME PROTOCOL
      // rather than through its own effect set (`WithRandomSeed`) still makes
      // this body owe the outer frame. Its Stage 1 effect set is the
      // placeholder `any` — standing in for its HELD body, whose effects are
      // unknowable until Stage 2 projection — so `{random}` is contributed in
      // its place. Unioning the placeholder instead would DEFEAT the
      // propagation: `any` absorbs, and the derived `drawsRandom` requires an
      // EXPLICIT `random` (frame participation requires explicit
      // declaration — see the `any` ruling).
      if (def?.frameProtocol === 'seed')
        effects = unionEffectSets(effects, ['random']);
      else if (def) effects = unionEffectSets(effects, def.effects);
    }

    for (const op of expr.ops) visit(op);
  };

  visit(literal);
  return { effects, readsRandomFrame, draws };
}

/** The operator definition bound to `name`, or `undefined` when `name` is
 * undeclared or holds a value rather than an operator. */
function operatorDefinitionOf(
  ce: ComputeEngine,
  name: string
): BoxedOperatorDefinition | undefined {
  const def = ce.lookupDefinition(name);
  return def && 'operator' in def ? def.operator : undefined;
}
