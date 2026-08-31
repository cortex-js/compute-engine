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
  OperatorTypeHandlerOnExpressions,
  OperatorTypeHandlerOnTypes,
  Expression,
  BoxedOperatorDefinition,
  LambdaDefinition,
  CollectionHandlers,
  OperatorCompileHandler,
  EvaluateOptions,
  EvaluateHandlerOptions,
  IComputeEngine as ComputeEngine,
  Scope,
  Sign,
  BindingSiteSelector,
  BroadcastExemption,
  TypeProvenanceEntry,
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
import { readTypeVariablesAsBounds } from '../../common/type/instantiate.js';
import { typeToString } from '../../common/type/serialize.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import { defaultCollectionHandlers } from '../collection-utils.js';
import { registerProvisionalDependents } from './provisional-application.js';
import { latestDeclaredEffectsSite } from './effects-provenance.js';
import { journalDefinitionRecord } from './boxed-value-definition.js';

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
  'broadcastExemptions',
  'inspectsErrors',
  'selectsOperands',
  'namedArgumentsRequired',
  'missingBehavior',
  'missingStrip',
  'nanBehavior',
  'partiality',
  'definedWhen',
  'requires',
  'associative',
  'commutative',
  'commutativeMatch',
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
  'typeHandlerKind',
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
  'canEnumerate',
  'elementCount',
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

/**
 * The declared carrier type of parameter position `i` (0-based): the
 * required parameters first, then the optional ones, and past both every
 * position belongs to the variadic parameter. `undefined` for a
 * non-signature type and for a position beyond a non-variadic signature.
 * Used by the Contract B NaN-policy resolution
 * ({@link _BoxedOperatorDefinition.resolvedNanBehaviorAt}).
 *
 * An OVERLOAD SET deliberately answers `undefined` — and the resolution
 * therefore answers `'inert'`, the conservative floor: with several arms
 * there is no single carrier to derive a policy from, so the operator
 * keeps plain carrier semantics until it declares `nanBehavior`
 * explicitly (or until per-arm derivation lands — a Phase C/E item of
 * `docs/plans/2026-08-30-error-model-implementation.md`).
 */
function parameterTypeAt(signature: Type, i: number): Type | undefined {
  if (typeof signature === 'string') return undefined;
  if (signature.kind !== 'signature') return undefined;
  const req = signature.args ?? [];
  if (i < req.length) return req[i].type;
  const opt = signature.optArgs ?? [];
  if (i < req.length + opt.length) return opt[i - req.length].type;
  return signature.variadicArg?.type;
}

export class _BoxedOperatorDefinition implements BoxedOperatorDefinition {
  engine: ComputeEngine;

  name: string;
  description?: string | string[];
  keywords?: string[];
  url?: string;
  wikidata?: string;

  broadcastable = false;
  broadcastExemptions: ReadonlyArray<BroadcastExemption> = [];

  inspectsErrors = false;
  selectsOperands = false;
  namedArgumentsRequired = false;
  missingBehavior?: 'reject' | 'propagate' | 'handle';
  missingStrip: 'all' | number[] = 'all';
  /** Contract B per-parameter NaN policy (`docs/ERROR-MODEL.md` §4). A single
   * value applies to every slot; an array is per-slot with holes falling back
   * to the derived default. Read through {@link resolvedNanBehaviorAt}. */
  nanBehavior?:
    | 'reject'
    | 'propagate'
    | 'handle'
    | ReadonlyArray<'reject' | 'propagate' | 'handle' | undefined>;
  /** Contract B partiality claim; `undefined` resolves to `'may-marker'`,
   * the sound default. Read through {@link resolvedPartiality}. */
  partiality?: 'total' | 'may-marker';
  /** Named mathematical domain condition — `false` routes to the codomain
   * marker channel. Its presence IS the partiality declaration (asserted
   * mutually exclusive with `partiality: 'total'` in `_update`). */
  definedWhen?: (ops: ReadonlyArray<Expression>) => boolean | undefined;
  /** Contract precondition — `false` routes to the `Error` channel. */
  requires?: (ops: ReadonlyArray<Expression>) => boolean | undefined;
  associative = false;
  commutative = false;
  /** Backing store for `commutativeMatch`: `undefined` until EXPLICITLY
   * set, so the default can follow `commutative` however the two flags are
   * updated over time — a partial `_update({ commutative: … })` must never
   * clobber an explicit `commutativeMatch`, and vice versa. */
  private _commutativeMatch: boolean | undefined;
  /** Permutation matching without the canonical operand sort — see
   * `OperatorDefinition.commutativeMatch`. Defaults to `commutative`. */
  get commutativeMatch(): boolean {
    return this._commutativeMatch ?? this.commutative;
  }
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
    this._refreshDerivedEffects();
    return this._effects;
  }

  /** Derived: "no impurity label is present". NOT set-emptiness — a future
   * non-impurity label (e.g. `async`) must not break caching by mere
   * set-nonemptiness. `'any'` reports conservatively (not pure). */
  get pure(): boolean {
    this._refreshDerivedEffects();
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
    this._refreshDerivedEffects();
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
   * propagation is what gives `Map(f, xs)` per-call-site precision. */
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

  /** Backing store for the {@link signature} accessor pair. Every read that
   * could run WHILE a derived-effects refresh is in progress must go through
   * this field, never through the accessor, or the refresh recurses. */
  private _signature!: BoxedType;

  /** The operator's arrow type, including its effect specifier.
   *
   * Reading it first runs {@link _refreshDerivedEffects}, so a definition
   * whose effect set is LAZILY DERIVED (see {@link _deriveEffects}) reports a
   * signature that reflects the current world rather than the one in force
   * when the definition was installed. The fast path — the overwhelmingly
   * common one — is a single `undefined` test on `_deriveEffects`.
   *
   * The accessor pair is installed as an OWN property of each instance (see
   * the constructor), not on the prototype: the documented
   * "spread a boxed definition and override a handler" idiom
   * (`{ ...ce.lookupDefinition('At').operator, evaluate }`, see
   * `test/compute-engine/declare-spread-override.test.ts`) copies own
   * enumerable properties only, and it relies on the signature — the carrier
   * of both the parameter types and the effect specifier — surviving the
   * spread. */
  declare signature: BoxedType;
  inferredSignature = true;

  /** A lazily-evaluated override of this definition's effect set, or
   * `undefined` for the ordinary case where {@link _effects} is simply what
   * was declared or inferred at install time.
   *
   * Installed on exactly two kinds of definitions:
   *
   * - A PROTOCOL DISPATCHER. A protocol function requirement with a bare
   *   effect specifier imposes no bound; the dispatcher's effect set is the
   *   union of the inferred effects of the registered conforming
   *   implementations, which changes as conformances register
   *   (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
   *   effect"). `engine-protocols.ts` installs a deriver computing that
   *   union.
   * - A LAMBDA-BACKED definition whose body inference consulted such a
   *   derived union, directly or through a callee. Its install-time effect
   *   stamp would go stale the moment a later conformance widens the union,
   *   so it re-runs its own body inference instead of freezing.
   *
   * The closure owns its memoization — version-stamped on the engine's
   * `_conformanceVersion` and `_callableVersion` — and its own re-entrancy
   * guard; nothing here caches its result beyond the `_effects` it installs.
   * The getters apply what it returns through {@link _setEffects}, so
   * `_effects` and the signature's arrow stay in lockstep. */
  _deriveEffects: (() => EffectSet | undefined) | undefined = undefined;

  /** Re-evaluate {@link _deriveEffects}, if any, and install its result.
   *
   * Called at the top of every getter whose answer depends on the effect set
   * ({@link effects}, {@link pure}, {@link drawsRandom}, {@link signature}).
   * The no-deriver fast path is one field test. */
  private _refreshDerivedEffects(): void {
    const derive = this._deriveEffects;
    if (derive === undefined) return;
    const derived = derive();
    if (!sameEffectSetSpelling(derived, this._effects))
      this._setEffects(derived);
  }

  // History of writes to this definition's signature — the operator-side
  // analog of `BoxedValueDefinition._typeProvenance` (see
  // `TypeProvenanceEntry` in `types-definitions.ts`). Declared upfront for
  // shape stability; allocated on the first recorded write. NOT a
  // user-definition key (`OPERATOR_DEF_KEYS` above): it is engine-written
  // state, never supplied by a definition author.
  _typeProvenance: TypeProvenanceEntry[] | undefined = undefined;

  /** See `OperatorDefinition._derivedSignature`. */
  _derivedSignature = false;

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

  /** True if this operator definition is a user MULTI-CLAUSE function — a set
   * of `f(0) = …`, `f(n) = …` clauses installed by `defineFunctionClause`
   * (`multi-clause.ts`), dispatched at call time by clause selection. Set at
   * install time, alongside the clause-storage marker.
   *
   * Read by `isUserFunctionDef()` (`boxed-function.ts`): a multi-clause
   * function is user code exactly like a function-literal one (`_isLambda`),
   * so a call whose argument is a finite indexed collection auto-broadcasts
   * over it — `fib(5..10)` maps `fib` per element instead of binding the
   * whole range to `n` (which for a recursive body never reaches a base
   * clause). Hold (`lazy`) and binder (`scoped`) definitions are excluded by
   * the predicate, not by this flag: their operands are expressions/symbols,
   * never elements to map over.
   * @internal
   */
  _isMultiClause = false;

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

  /** Which shape the stored `type` handler takes — `'expressions'` (legacy,
   * a function of the operand expressions) or `'types'` (a function of
   * operand descriptors that cannot touch engine state). Dispatch reads
   * this flag, never the handler's parameter count. Travels with the
   * handler: an update that supplies a `type` handler resets the kind to
   * what that update declares. */
  typeHandlerKind: 'expressions' | 'types' = 'expressions';

  type?: OperatorTypeHandlerOnExpressions | OperatorTypeHandlerOnTypes;

  sgn?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Sign | undefined;

  /** See `OperatorDefinition.eq` (types-definitions.ts) for `prover`. */
  eq?: (a: Expression, b: Expression, prover?: boolean) => boolean | undefined;
  neq?: (a: Expression, b: Expression) => boolean | undefined;

  /** The eager producer's enumerability precondition — see the
   * `canEnumerate` contract on `OperatorDefinition` (types-definitions.ts). */
  canEnumerate?: (expr: Expression) => boolean | undefined;

  /** The eager producer's element count — see the `elementCount` contract on
   * `OperatorDefinition` (types-definitions.ts). */
  elementCount?: (expr: Expression) => number | undefined;

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
    options: EvaluateHandlerOptions
  ) => Expression | undefined;

  evaluateAsync?: (
    ops: ReadonlyArray<Expression>,
    options: EvaluateHandlerOptions
  ) => Promise<Expression | undefined>;

  evalDimension?: (
    ops: ReadonlyArray<Expression>,
    options: Partial<EvaluateOptions> & { engine: ComputeEngine }
  ) => Expression;

  compile?: OperatorCompileHandler;

  collection?: CollectionHandlers;

  /** The accessor pair installed as each instance's OWN `signature` property.
   * A single shared descriptor object, so every instance takes the same
   * hidden-class transition and reads stay monomorphic. */
  private static readonly _SIGNATURE_DESCRIPTOR: PropertyDescriptor = {
    enumerable: true,
    configurable: true,
    get(this: _BoxedOperatorDefinition): BoxedType {
      this._refreshDerivedEffects();
      return this._signature;
    },
    set(this: _BoxedOperatorDefinition, value: BoxedType) {
      // The public accessor keeps its type-valued shape and delegates to the
      // thunk API, so no write can bypass the fact-blind bracket. A function
      // is never a signature, so one arriving here is a thunk handed to the
      // wrong entry point.
      if (typeof value === 'function')
        throw new Error(
          `The signature of "${this.name}" was set to a function. Use "_setSignature()" to compute a signature inside the write's fact-blind bracket.`
        );
      this._setSignature(() => value);
    },
  };

  /** Write this definition's signature, deriving it with the assumptions
   * hidden.
   *
   * A signature is a CONTRACT: `assume(p > 3); f := x ↦ (p > 2)` must store
   * `(unknown) -> boolean`, not the `-> true` the fact would prove, because
   * the next statement can retract the fact while the stored signature stays
   * (`docs/plans/2026-08-29-assumptions-as-facts-type.md` §2.4). The thunk
   * runs inside the bracket with the write, so the derivation and the write
   * see the same, fact-free, state.
   * @internal */
  _setSignature(thunk: () => BoxedType): void {
    this.engine._withoutFacts(() => {
      this._signature = thunk();
    });
  }

  constructor(ce: ComputeEngine, name: string, def: OperatorDefinition) {
    Object.defineProperty(
      this,
      'signature',
      _BoxedOperatorDefinition._SIGNATURE_DESCRIPTOR
    );
    this.name = name;
    this.engine = ce;

    if (def.signature) {
      this.inferredSignature = false;
      this.signature = new BoxedType(
        normalizeSignatureField(def.signature),
        ce._typeResolver
      );
    } else this.signature = new BoxedType('(any*) -> unknown');

    this._update(def);
  }

  /** For debugging */
  toJSON() {
    const result: Record<string, unknown> = { name: this.name };
    if (this.wikidata) result.wikidata = this.wikidata;
    if (this.description) result.description = this.description;
    if (this.keywords) result.keywords = this.keywords;
    if (this.url) result.url = this.url;
    result.broadcastable = this.broadcastable;
    result.broadcastExemptions = this.broadcastExemptions;
    result.associative = this.associative;
    result.commutative = this.commutative;
    // Only an EXPLICIT commutativeMatch is cloned; a derived one keeps
    // deriving from `commutative` in the clone.
    if (this._commutativeMatch !== undefined)
      result.commutativeMatch = this._commutativeMatch;
    result.idempotent = this.idempotent;
    result.involution = this.involution;
    result.pure = this.pure;
    result.drawsRandom = this.drawsRandom;
    result.readsRandomFrame = this.readsRandomFrame;
    result.lazy = this.lazy;
    result.complexity = this.complexity;
    result.scoped = this.scoped;
    // R-D5: GROUND display — see `typeToDisplayString`.
    result.signature = typeToString(this.signature.type);
    result.inferredSignature = this.inferredSignature;

    if (this.collection) result.collection = this.collection;

    return result;
  }

  /**
   * The *resolved* missing-value behavior (§3.A of the missing-value typing
   * design). Computed from the declared `missingBehavior` flag of
   * {@link OperatorDefinitionFlags} and the current
   * signature on every access — never cached, so a signature mutation
   * (`_update()`, `BoxedFunction._infer()`) is reflected immediately.
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
   * The *resolved* Contract B NaN policy for parameter position `i`
   * (`docs/ERROR-MODEL.md` §4). For a USER-DEFINED callable the
   * higher-order conservative floor is ABSOLUTE — always `'inert'`, an
   * explicit declaration included: the callable's own application
   * machinery owns every exceptional operand, and the runtime gates
   * exclude user functions unconditionally, so honoring a declaration
   * here would split the type story from the runtime story. Otherwise an
   * explicit `nanBehavior` declaration wins, and the policy is derived
   * from the CURRENT signature — never cached, like
   * {@link resolvedMissingBehavior}:
   *
   * - An inferred signature carries no authored carrier, so it derives
   *   nothing: `'inert'`.
   * - A carrier that ADMITS `nan` (bare `number`, `any`, a union with
   *   `nan`) leaves the channel `'inert'`: `NaN` is an ordinary domain
   *   member there and the handler owns it — the status quo for every
   *   operator that has not migrated to a precise Contract B carrier.
   * - A precise carrier that excludes `nan` gets the §4 mechanical
   *   default: `'propagate'` when the carrier is a subtype of `complex`
   *   that is not a subtype of `integer` AND the result type is numeric
   *   (a quiet failure must speak the codomain's vocabulary);
   *   `'reject'` otherwise (an index, a digit count, a dimension).
   */
  resolvedNanBehaviorAt(
    i: number,
    /** The RESOLVED overload arm to derive from, when the caller has one
     * (the runtime gates read it off `_resolvedOverload`): per-arm
     * carriers give per-arm derived policies — the "attach per overload"
     * clause of `docs/ERROR-MODEL.md` §4 for everything derivable.
     * Explicit `nanBehavior` declarations remain operator-level. */
    armSignature?: Type
  ): 'reject' | 'propagate' | 'handle' | 'inert' {
    // The higher-order conservative floor (`docs/ERROR-MODEL.md` §4,
    // "Policies are part of a callable's contract"): a USER-DEFINED
    // callable has UNKNOWN NaN behavior, so nothing is derived from its
    // declared signature — its own application machinery (runtime
    // validation, clause dispatch) owns every exceptional operand. The
    // floor is ABSOLUTE — checked before an explicit declaration — so
    // that this resolution can never disagree with the runtime gates,
    // which exclude user functions unconditionally. Making the floor
    // structural HERE, rather than at each consumer, is what keeps the
    // boxing admission from carving a `NaN` into an annotated lambda's
    // precise carrier, and makes any future consumer floor-safe by
    // construction. The runtime-gate exclusions in `boxed-function.ts`
    // remain as the belt.
    if (this.isUserFunctionDefinition) return 'inert';
    const declared = this.nanBehavior;
    if (declared !== undefined) {
      if (typeof declared === 'string') return declared;
      const slot = declared[i];
      if (slot !== undefined) return slot;
    }
    if (this.inferredSignature) return 'inert';
    const sig = armSignature ?? this.signature.type;
    const carrier = parameterTypeAt(sig, i);
    if (carrier === undefined) return 'inert';
    if (isSubtype('nan', carrier)) return 'inert';
    const resultIsNumeric =
      typeof sig !== 'string' &&
      sig.kind === 'signature' &&
      isSubtype(sig.result, 'number');
    if (
      resultIsNumeric &&
      isSubtype(carrier, 'complex') &&
      !isSubtype(carrier, 'integer')
    )
      return 'propagate';
    return 'reject';
  }

  /**
   * The *resolved* Contract B partiality of the declaration: a declared
   * `definedWhen` predicate IS the partiality condition (`'defined-when'`),
   * an explicit `partiality` claim stands, and the omitted default is the
   * sound `'may-marker'`.
   */
  get resolvedPartiality(): 'total' | 'may-marker' | 'defined-when' {
    if (this.definedWhen) return 'defined-when';
    return this.partiality ?? 'may-marker';
  }

  /**
   * True for a USER-DEFINED callable: a function-literal (lambda)
   * definition, or an unscoped strict multi-clause definition. These are
   * the sanctioned opt-outs of the Contract B machinery — their own
   * application machinery (runtime validation, clause dispatch) owns
   * every exceptional operand, and the higher-order conservative floor
   * (`docs/ERROR-MODEL.md` §4) says a consumer may assume nothing
   * sharper than `may-marker` with unknown NaN behavior about them.
   * The single source of truth for the predicate — the dispatch-site
   * `isUserFunctionDef` (`boxed-function.ts`) delegates here.
   */
  get isUserFunctionDefinition(): boolean {
    if (this._isLambda) return true;
    return this._isMultiClause && this.lazy !== true && !this.scoped;
  }

  /**
   * The Contract B adjustment to a derived application RESULT type
   * (`docs/ERROR-MODEL.md` §4: the application type is
   * `S | marker(S) | nan`, narrowing to exactly `S` only when both the
   * partiality and every propagating slot are discharged). Answers for the
   * CURRENT arguments:
   *
   * - `'is-marker'` — the declared `definedWhen` condition is provably
   *   false for these arguments: the value IS the codomain marker (§2
   *   rule 4 — `NaN` for a numeric codomain, `Missing` for a settled
   *   non-numeric one; the consumer maps the verdict to its codomain).
   * - `'widen-marker'` — a DECLARED partiality is undischarged
   *   (`definedWhen` undecided for these arguments, or an explicit
   *   `may-marker`): every cell of the result gains its marker arm.
   * - `'widen-nan'` — only the NaN evidence fires: a `propagate` slot's
   *   argument may be `NaN`, so numeric cells gain `| nan`. A declared
   *   `total` discharges the partiality but never this arm.
   * - `'none'` — no adjustment.
   *
   * One deliberate scope guard, MEASURED not assumed: the UNDECLARED
   * partiality default (`may-marker` by omission) contributes NO arm —
   * binding it engine-wide broke 126 tests across 28 suites (the Phase C
   * measurement in `docs/plans/2026-08-30-error-model-implementation.md`)
   * by silently defeating `matches('integer')`-style type-keyed guards,
   * so the omitted default binds only through explicit declarations until
   * the Phase F migration.
   */
  contractBResultAdjustment(
    ops: ReadonlyArray<Expression>,
    /** The RESOLVED overload arm, when the caller has one: the NaN
     * evidence below derives per-slot policies from ITS carriers, keeping
     * the derived type in step with the runtime gates (which pass the
     * same arm to `resolvedNanBehaviorAt`). */
    armSignature?: Type
  ): 'none' | 'widen-nan' | 'widen-marker' | 'is-marker' {
    // The higher-order conservative floor — see `resolvedNanBehaviorAt`,
    // whose ordering this mirrors: ABSOLUTE for user-defined callables,
    // explicit declarations included. A user callable's application types
    // through its own lambda and multi-clause arms; the floor forbids
    // ASSUMING anything sharper about it, the measured churn policy (the
    // Phase C note) forbids silently WIDENING it, and the runtime gates
    // never fire for it — so an adjustment here would put a claim in the
    // type that no runtime channel backs.
    if (this.isUserFunctionDefinition) return 'none';
    if (this.definedWhen) {
      let v: boolean | undefined;
      try {
        v = this.definedWhen(ops);
      } catch {
        // This runs inside the cached `.type` derivation, which a
        // throwing predicate must not crash: an exception means the
        // condition could not be decided for these arguments, which is
        // exactly the undischarged verdict.
        v = undefined;
      }
      if (v === false) return 'is-marker';
      if (v === undefined) return 'widen-marker';
      // Proven defined: the partiality is discharged — fall through to
      // the NaN-evidence arm below.
    } else if (this.partiality === 'may-marker') return 'widen-marker';
    // No undischarged partiality claim: the only possible adjustment is
    // the NaN arm — a `propagate` slot whose argument may carry a `NaN`.
    for (let i = 0; i < ops.length; i++) {
      if (this.resolvedNanBehaviorAt(i, armSignature) !== 'propagate')
        continue;
      const opT = ops[i].type.type;
      // A PROVEN NaN in a propagating slot makes the application's value
      // NaN — the sharp type is exactly the marker, not a widened union
      // (`Heaviside(NaN).type` is `nan`, not `rational<0..1> | nan`).
      // Testing only the may-carry direction below missed this: `nan` is
      // not a subtype of the NaN value singleton, so a proven-NaN
      // argument derived NO arm and the stored type excluded the very
      // value the application has. The bottom type is excluded first:
      // `never` is a subtype of everything, and a `never`-typed operand
      // means "no possible value" — a contradiction — not "proven NaN".
      if (opT !== 'never' && isSubtype(opT, 'nan')) return 'is-marker';
      if (isSubtype('nan', opT)) return 'widen-nan';
    }
    return 'none';
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
    // Read the BACKING field, not the `signature` accessor: `_setEffects` runs
    // inside `_refreshDerivedEffects`, and the accessor's getter starts by
    // calling that refresh — going through it here would recurse.
    const t = this._signature.type;
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
   * (`BoxedFunction._infer()`). The cached `_effects` is authoritative in that
   * situation: a rebuilt signature is assembled from the type-inference fields
   * alone, so without this the arrow would serialize pure while the definition
   * still reports its effects — the two must never disagree.
   * @internal
   */
  _resyncEffects(): void {
    this._setEffects(this._effects);
  }

  /**
   * Build the {@link _deriveEffects} closure for a lambda-backed definition
   * whose body inference consulted a conformance-registry-derived effect set.
   *
   * Re-running the walk over `literal` is the whole computation: everything
   * the body reads (a dispatcher's union, a callee's own derived stamp) is
   * read live through the refreshing accessors. Two things bound the cost:
   *
   * - **Memoization** on the pair of monotone counters that can change the
   *   answer — the engine's conformance-registry version (a new conformer can
   *   widen a dispatcher's union) and its `callable` version (reassigning an
   *   ordinary function re-derives its effects). Unchanged pair ⇒ the last
   *   result, which is exactly what `_effects` holds.
   * - **A re-entrancy guard**, returning the current `_effects` uncached: a
   *   body that reaches its own definition through a dispatcher would
   *   otherwise recurse, and the partially-built value is the sound answer
   *   for the cycle (every non-cyclic contribution is unioned on the way).
   *
   * `_inferredDraws` — and, when the definition's frame-participation bit is
   * inference-managed (`restampFrameRead`), `readsRandomFrame` — are updated
   * in lockstep with the returned set, exactly as the install-time stamp
   * does: a re-derivation must not leave either frame field describing an
   * older walk. A caller-declared `readsRandomFrame` is authoritative and is
   * never overwritten, mirroring the install-time `def.readsRandomFrame ===
   * undefined` gate.
   *
   * The refresh may run inside an inference ROLLBACK FRAME
   * (`inference-rollback.ts`), whose undo restores definitions through raw
   * slot writes and advances no version counter. A refresh that stamped its
   * memo there would keep serving a set inferred from the discarded trial
   * world after the rollback — the stamps would still match. So while any
   * frame is open the closure computes and applies, but does NOT stamp: the
   * first read after the frame closes recomputes against the restored world
   * and corrects every field it touched.
   */
  private _makeLiteralEffectsDeriver(
    literal: Expression,
    restampFrameRead: boolean
  ): () => EffectSet | undefined {
    let stampedConformance = -1;
    let stampedCallable = -1;
    let inFlight = false;
    return (): EffectSet | undefined => {
      if (inFlight) return this._effects;
      const ce = this.engine;
      if (
        stampedConformance === ce._conformanceVersion &&
        stampedCallable === ce._callableVersion
      )
        return this._effects;
      inFlight = true;
      try {
        const reInferred = inferFunctionLiteralEffects(ce, literal, {
          selfName: this.name,
        });
        this._inferredDraws = reInferred.draws;
        if (restampFrameRead)
          this.readsRandomFrame = reInferred.readsRandomFrame;
        if (ce._rollbackFrames.length === 0) {
          stampedConformance = ce._conformanceVersion;
          stampedCallable = ce._callableVersion;
        }
        return reInferred.effects;
      } finally {
        inFlight = false;
      }
    };
  }

  /** Snapshot every field that a provisional re-derivation —
   * `installRebuiltLiteral` calling `_update({ evaluate: rebuilt })` on a
   * PRE-EXISTING definition (`function-utils.ts`) — can mutate, for an
   * exact later restore by an inference rollback frame. The result is
   * OPAQUE to callers (typed `unknown` on the public interface): it
   * captures private fields (`_effects`, `_inferredDraws`), so constructing
   * or peeking at one outside this class is meaningless. Only the fields an
   * `{ evaluate }`-only update can touch are captured; a full-definition
   * `_update()` on a pre-existing object never happens inside a rollback
   * frame (redefinition routes go through `updateDef`, whose half-swap the
   * frame journals separately).
   * @internal */
  _rederivationSnapshot(): unknown {
    return {
      signature: this.signature,
      inferredSignature: this.inferredSignature,
      _isLambda: this._isLambda,
      _lambdaLiteral: this._lambdaLiteral,
      evaluate: this.evaluate,
      evaluateAsync: this.evaluateAsync,
      readsRandomFrame: this.readsRandomFrame,
      effectsDeclared: this.effectsDeclared,
      _effects: this._effects,
      _inferredDraws: this._inferredDraws,
      _deriveEffects: this._deriveEffects,
    };
  }

  /** Restore the fields captured by `_rederivationSnapshot`, verbatim. No
   * `_resyncEffects()` follows: the captured `signature`/`_effects` pair
   * was consistent when snapshotted, and a verbatim restore keeps it so —
   * re-syncing would rebuild the signature and defeat the
   * identity-preserving restore.
   * @internal */
  _restoreRederivationSnapshot(snapshot: unknown): void {
    const s = snapshot as {
      signature: BoxedType;
      inferredSignature: boolean;
      _isLambda: boolean;
      _lambdaLiteral: Expression | undefined;
      evaluate: _BoxedOperatorDefinition['evaluate'];
      evaluateAsync: _BoxedOperatorDefinition['evaluateAsync'];
      readsRandomFrame: boolean;
      effectsDeclared: boolean;
      _effects: EffectSet | undefined;
      _inferredDraws: boolean;
      _deriveEffects: (() => EffectSet | undefined) | undefined;
    };
    // The lazy effect deriver round-trips with the rest: the `_update()` being
    // undone may have installed one (its body inference consulted a
    // registry-derived union) or cleared one, and leaving that state behind
    // would keep re-deriving — or stop re-deriving — against the literal the
    // rollback just discarded.
    this._deriveEffects = s._deriveEffects;
    this.signature = s.signature;
    this.inferredSignature = s.inferredSignature;
    this._isLambda = s._isLambda;
    this._lambdaLiteral = s._lambdaLiteral;
    this.evaluate = s.evaluate;
    this.evaluateAsync = s.evaluateAsync;
    this.readsRandomFrame = s.readsRandomFrame;
    this.effectsDeclared = s.effectsDeclared;
    this._effects = s._effects;
    this._inferredDraws = s._inferredDraws;
  }

  /**
   * Snapshot EVERY mutable field of this record, for the checkpoint journal
   * (`checkpoint-journal.ts`, and "State coverage" in
   * `docs/CHECKPOINT-MODEL.md`) — the in-place operator-update funnel.
   * Wider than {@link _rederivationSnapshot}, which captures only what an
   * `{ evaluate }`-only update can touch: a checkpoint has to rewind a full
   * redefinition, which `_update` can drive through every field below.
   *
   * **Review rule: adding a mutable field to this class means extending this
   * snapshot and its restore.** A field left out is silently carried across a
   * rewind. The drift guard is
   * `test/compute-engine/checkpoint-journal.test.ts`, which compares this
   * tuple's key set against the record's own property names.
   *
   * `_signature` is read directly, never through the `signature` accessor:
   * the getter runs {@link _refreshDerivedEffects} first, so snapshotting
   * through it would re-derive a lazily-derived effect set as a side effect
   * of taking a checkpoint. Excluded: `name` and `engine` are identity and
   * never move.
   * @internal */
  _checkpointSnapshot(): unknown {
    return {
      description: this.description,
      keywords: this.keywords,
      url: this.url,
      wikidata: this.wikidata,
      broadcastable: this.broadcastable,
      broadcastExemptions: this.broadcastExemptions,
      inspectsErrors: this.inspectsErrors,
      selectsOperands: this.selectsOperands,
      namedArgumentsRequired: this.namedArgumentsRequired,
      missingBehavior: this.missingBehavior,
      missingStrip: this.missingStrip,
      nanBehavior: this.nanBehavior,
      partiality: this.partiality,
      definedWhen: this.definedWhen,
      requires: this.requires,
      associative: this.associative,
      commutative: this.commutative,
      _commutativeMatch: this._commutativeMatch,
      commutativeOrder: this.commutativeOrder,
      idempotent: this.idempotent,
      involution: this.involution,
      _effects: this._effects,
      _inferredDraws: this._inferredDraws,
      effectsDeclared: this.effectsDeclared,
      frameProtocol: this.frameProtocol,
      invokes: this.invokes,
      discharges: this.discharges,
      holdClass: this.holdClass,
      readsRandomFrame: this.readsRandomFrame,
      complexity: this.complexity,
      lazy: this.lazy,
      scoped: this.scoped,
      bindingSites: this.bindingSites,
      _signature: this._signature,
      inferredSignature: this.inferredSignature,
      _deriveEffects: this._deriveEffects,
      // COPIED, not aliased: provenance is appended to in place.
      _typeProvenance: this._typeProvenance?.slice(),
      _derivedSignature: this._derivedSignature,
      _isLambda: this._isLambda,
      _lambdaLiteral: this._lambdaLiteral,
      _isMultiClause: this._isMultiClause,
      type: this.type,
      typeHandlerKind: this.typeHandlerKind,
      sgn: this.sgn,
      eq: this.eq,
      neq: this.neq,
      canEnumerate: this.canEnumerate,
      elementCount: this.elementCount,
      even: this.even,
      canonical: this.canonical,
      evaluate: this.evaluate,
      evaluateAsync: this.evaluateAsync,
      evalDimension: this.evalDimension,
      compile: this.compile,
      collection: this.collection,
    };
  }

  /** Restore the fields captured by {@link _checkpointSnapshot}, verbatim.
   * No `_resyncEffects()` follows and the record object is never replaced,
   * for the same two reasons as {@link _restoreRederivationSnapshot}: the
   * captured signature/effect pair was consistent when snapshotted, and live
   * boxed expressions hold the record by identity.
   * @internal */
  _restoreCheckpointSnapshot(snapshot: unknown): void {
    const s = snapshot as Record<string, any>;
    this.description = s.description;
    this.keywords = s.keywords;
    this.url = s.url;
    this.wikidata = s.wikidata;
    this.broadcastable = s.broadcastable;
    this.broadcastExemptions = s.broadcastExemptions ?? [];
    this.inspectsErrors = s.inspectsErrors;
    this.selectsOperands = s.selectsOperands;
    this.namedArgumentsRequired = s.namedArgumentsRequired;
    this.missingBehavior = s.missingBehavior;
    this.missingStrip = s.missingStrip;
    this.nanBehavior = s.nanBehavior;
    this.partiality = s.partiality;
    this.definedWhen = s.definedWhen;
    this.requires = s.requires;
    this.associative = s.associative;
    this.commutative = s.commutative;
    this._commutativeMatch = s._commutativeMatch;
    this.commutativeOrder = s.commutativeOrder;
    this.idempotent = s.idempotent;
    this.involution = s.involution;
    this._effects = s._effects;
    this._inferredDraws = s._inferredDraws;
    this.effectsDeclared = s.effectsDeclared;
    this.frameProtocol = s.frameProtocol;
    this.invokes = s.invokes;
    this.discharges = s.discharges;
    this.holdClass = s.holdClass;
    this.readsRandomFrame = s.readsRandomFrame;
    this.complexity = s.complexity;
    this.lazy = s.lazy;
    this.scoped = s.scoped;
    this.bindingSites = s.bindingSites;
    // Written through the private field, not the `signature` accessor, so the
    // restore does not run the derived-effects refresh against the state it is
    // in the middle of rewinding. `_deriveEffects` is restored FIRST for the
    // same reason the rederivation restore does it: leaving a deriver behind
    // would keep re-deriving against the definition the restore discarded.
    this._deriveEffects = s._deriveEffects;
    this._signature = s._signature;
    this.inferredSignature = s.inferredSignature;
    this._typeProvenance = s._typeProvenance;
    this._derivedSignature = s._derivedSignature;
    this._isLambda = s._isLambda;
    this._lambdaLiteral = s._lambdaLiteral;
    this._isMultiClause = s._isMultiClause;
    this.type = s.type;
    this.typeHandlerKind = s.typeHandlerKind;
    this.sgn = s.sgn;
    this.eq = s.eq;
    this.neq = s.neq;
    this.canEnumerate = s.canEnumerate;
    this.elementCount = s.elementCount;
    this.even = s.even;
    this.canonical = s.canonical;
    this.evaluate = s.evaluate;
    this.evaluateAsync = s.evaluateAsync;
    this.evalDimension = s.evalDimension;
    this.compile = s.compile;
    this.collection = s.collection;
  }

  _update(def: OperatorDefinition): void {
    // Checkpoint journal (funnel 6): `_update` is an IN-PLACE mutation that
    // can move the signature, the handlers, the effect set and the lambda
    // literal without any binding-half swap, so the window has to hold this
    // record's whole field set. Recorded on ENTRY, before any of this
    // method's own writes, because `_update` is not transactional: it assigns
    // `lazy`, `scoped` and `bindingSites` before the idempotent/involution
    // exclusion throws, and the handler fields before the collection-handler
    // signature checks throw. A rejected update therefore leaves the record
    // partially mutated, and only a snapshot taken ahead of the first write
    // captures the true pre-update state whatever later throw lands.
    journalDefinitionRecord(this.engine, this, 'redefine');

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
    this.broadcastExemptions =
      def.broadcastExemptions ?? this.broadcastExemptions;
    this.inspectsErrors = def.inspectsErrors ?? this.inspectsErrors;
    this.selectsOperands = def.selectsOperands ?? this.selectsOperands;
    // `selectsOperands` says the operator decides at evaluation WHICH held
    // operands to evaluate, so it is meaningless without `lazy`: a strict
    // operator's operands are all evaluated before its handler is called, and
    // there is nothing left to select. Deferred error absorption keys on the
    // flag, so setting it on a strict operator would silently stop that
    // operator's operand errors from bubbling.
    console.assert(
      !this.selectsOperands || this.lazy,
      `Operator Definition "${this.name}": 'selectsOperands' requires 'lazy'`
    );
    this.namedArgumentsRequired =
      def.namedArgumentsRequired ?? this.namedArgumentsRequired;
    this.missingBehavior = def.missingBehavior ?? this.missingBehavior;
    this.missingStrip = def.missingStrip ?? this.missingStrip;
    this.nanBehavior = def.nanBehavior ?? this.nanBehavior;
    this.partiality = def.partiality ?? this.partiality;
    this.definedWhen = def.definedWhen ?? this.definedWhen;
    this.requires = def.requires ?? this.requires;
    // `definedWhen` IS the partiality declaration (the named condition), so
    // combining it with the claim "no such condition exists" is contradictory.
    if (this.partiality === 'total' && this.definedWhen)
      throw new Error(
        `Operator Definition "${this.name}": 'partiality: "total"' and 'definedWhen' are mutually exclusive — the 'definedWhen' predicate IS the partiality condition`
      );
    this.associative = def.associative ?? this.associative;
    this.commutative = def.commutative ?? this.commutative;
    // Permutation matching WITHOUT canonical sorting. The default (follow
    // `commutative`) lives in the getter, so it tracks later `commutative`
    // updates; only an explicit value is stored here — a partial update
    // that touches `commutative` alone must never clobber it.
    if (def.commutativeMatch !== undefined)
      this._commutativeMatch = def.commutativeMatch;
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
    let declaresEffectsNow = def.effects !== undefined;

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

      if ('_derivedSignature' in def)
        this._derivedSignature = def._derivedSignature as boolean;

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
        declaresEffectsNow = true;
      }

      assertArmsDistinguishableWithoutEffects(this.name, this.signature.type);
    }

    // Annotation provenance is REPLACED by an update that restates the effect
    // surface, never merged into it — the same rule the signature itself
    // follows. Redefining `function caller(t: T) -> integer { … }` with no
    // annotation RETRACTS the `pure` its previous definition declared; leaving
    // the old contract in force would make it impossible to widen an annotation
    // by rewriting the function, which is the only way an author can retire a
    // contract that is holding something else back (a conformance refused for
    // widening it, say). An update that supplies neither an `effects:` field nor
    // a signature is not restating anything, so it leaves the provenance alone.
    // `def.effects !== undefined` is not a second disjunct here: it already
    // implies `declaresEffectsNow`, so a SIGNATURE is the only thing that can
    // restate the surface without stating effects.
    if (declaresEffectsNow) this.effectsDeclared = true;
    else if (def.signature !== undefined) this.effectsDeclared = false;

    if (legacy.stated) {
      if (effects.stated) {
        if (!sameEffectSet(effects.effects, legacy.effects))
          throw new Error(
            `Operator Definition "${this.name}": the declared effects and the 'pure'/'drawsRandom' flags disagree`
          );
      } else effects = legacy;
    }

    // The handler-shape flag travels WITH the handler: an update that
    // supplies a `type` handler resets the kind to what that update declares
    // (absent flag = the legacy expressions shape), and an update that
    // supplies none keeps both the stored handler and its kind.
    if (def.type !== undefined) {
      this.type = def.type;
      this.typeHandlerKind =
        def.typeHandlerKind === 'types' ? 'types' : 'expressions';
    }
    this.evaluateAsync = def.evaluateAsync ?? this.evaluateAsync;
    this.canonical = def.canonical ?? this.canonical;
    this.evalDimension = def.evalDimension ?? this.evalDimension;
    this.sgn = def.sgn ?? this.sgn;
    this.even = def.even ?? this.even;
    this.compile = def.compile ?? this.compile;
    this.eq = def.eq ?? this.eq;
    this.neq = def.neq ?? this.neq;
    this.canEnumerate = def.canEnumerate ?? this.canEnumerate;
    this.elementCount = def.elementCount ?? this.elementCount;
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
      // Every free type variable read as its declared bound (`unknown` when
      // unbounded) — the D6 bound-reading this SUBJECT-LESS check uses (§5.1
      // of the type-variables design). It is what makes a migrated identity
      // echo (`(T) -> T where T: indexed_collection`) count as possibly
      // indexed, and it keeps an open type out of `isSubtype`/`couldMatch`.
      const declaredType = readTypeVariablesAsBounds(this.signature.type);
      // If we have collection handlers, the result type must be a collection
      const resultType = functionResult(declaredType);
      if (!resultType)
        throw new Error(
          `Operator Definition "${this.name}": a collection handler is defined, but the signature "${this.signature}" does not have a result type`
        );
      if (!isSubtype(resultType, COLLECTION_SHAPE_TYPE))
        throw new Error(
          `Operator Definition "${this.name}": a collection handler is defined, but the signature "${this.signature}" is not a collection type`
        );
      if (
        isSubtype(resultType, INDEXED_COLLECTION_SHAPE_TYPE) &&
        !this.collection.at
      ) {
        throw new Error(
          `Operator Definition "${this.name}" returns an indexed collection, but the 'at' handler is missing`
        );
      }
      // The ARM-AWARE `at`-handler rule (§6 of the type-variables design).
      // The old blanket check ("a non-indexed result must not define `at`")
      // was disabled because `Map`/`Filter` return an indexed collection only
      // when their input is one — a conditional `at` handler is legitimate.
      // The honest rule is per ARM: an `at` handler is an error only when NO
      // arm could return an indexed collection. Mixed indexed/non-indexed arms
      // with one conditional handler are legal and produce no warning.
      if (this.collection.at && !couldReturnIndexedCollection(declaredType))
        throw new Error(
          `Operator Definition "${this.name}": an 'at' handler is defined, but no arm of the signature "${this.signature}" can return an indexed collection`
        );
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
        // The whole derivation runs inside `_setSignature`'s fact-blind
        // bracket: the body's type and each parameter's inferred collection
        // type are read there, so an assumption in force when the definition
        // is installed cannot reach the stored arrow. Without it,
        // `assume(p > 3); f := x ↦ (p > 2)` froze `(unknown) -> true`, which
        // survived `forget(p)`.
        this._setSignature(() => {
          const body = boxedFn.ops[0];
          const params = boxedFn.ops.slice(1);
          // The signature is assembled as a Type OBJECT, never as a string
          // that is re-parsed: a body type may REFERENCE a type declared
          // inside the body's own scope
          // (`function f(a) { type inner = …; inner(a, a) }`), and that name
          // is not resolvable from the declaration site the definition is
          // installed at — serializing it to `"(unknown) -> inner"` and
          // re-parsing here threw "Unknown type". The `TypeReference` object
          // carries its own `def`, so it stays usable wherever it escapes to.
          const signature: Type = {
            kind: 'signature',
            // A parameter slot is `unknown` unless the body's uses inferred a
            // COLLECTION type for it (`v[1]` narrows `v` through `At`'s
            // signature): surfacing that keeps `paramsAreScalar` false, so a
            // list argument is applied to the function rather than broadcast
            // element-wise over it. Same rule, same helper as the literal's
            // own arrow (`functionLiteralSignatureType`).
            ...(params.length > 0
              ? {
                  args: params.map((p) => ({
                    type: inferredCollectionParameterType(p) ?? 'unknown',
                  })),
                }
              : {}),
            result: body.type.type,
          };
          return new BoxedType(signature, this.engine._typeResolver);
        });
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
              inferred.effects,
              // This definition's OWN effects-axis history: correct for the
              // one in-place `_update()` (the provisional re-derivation
              // cascade, where `this` is the contract's prior holder), and
              // automatically `undefined` during construction (fresh
              // object, empty history) — which is also the right answer for
              // a construction-stated contract.
              latestDeclaredEffectsSite(this)
            );
          effects = declared;
          // A declared contract is authoritative on frame participation too,
          // but a draw the walk positively SAW is retained: an `any` contract
          // absorbs `{random}`, and `drawsRandom` requires an explicit label.
          inferredDraws = inferred.draws;
          // A declared contract never re-derives: the stated set is what
          // callers may rely on, and noticing that a later conformance has
          // made it false is the widening guard's job, not this cache's.
          this._deriveEffects = undefined;
        } else if (!effects.stated) {
          // The default-`!scope` ceiling (ruled 2026-08-15): a definition
          // with NO effect annotation guarantees it does not mutate the
          // world — escaping writes are opt-in via the `scope` label. The
          // trigger is the walk's PROVEN-mutation bit, never the `scope`
          // label of the inferred set: `{any}` from an unresolved
          // forward-referenced head must stay optimistic (the v5
          // dependency-order ruling), or mutual recursion breaks. Anonymous
          // literals are not gated — they have no annotation surface (the
          // lambda specifier slot is deferred) and are never installed here;
          // their arrows still carry the inferred `scope` honestly.
          if (inferred.escapingWrite)
            throw new EffectContractError(
              this.name,
              undefined,
              inferred.effects,
              undefined,
              /* scopeDefault */ true
            );
          effects = { stated: true, effects: inferred.effects };
          inferredDraws = inferred.draws;
          // If the walk consulted an effect set that is itself derived from
          // the conformance registry — a protocol dispatcher's union over the
          // conformers of a BARE requirement — freezing what it saw would go
          // stale the moment the next conformance widens that union. Install a
          // deriver that re-runs this very inference instead. Otherwise clear
          // any deriver a previous definition of this name installed: a
          // redefinition must not keep re-deriving from a discarded body.
          this._deriveEffects = inferred.consultsRegistry
            ? this._makeLiteralEffectsDeriver(
                boxedFn,
                def.readsRandomFrame === undefined
              )
            : undefined;
        } else this._deriveEffects = undefined;
        if (def.readsRandomFrame === undefined)
          this.readsRandomFrame = inferred.readsRandomFrame;
      }

      const fn = applicable(boxedFn);
      // Thread the caller's options (esp. `numericApproximation` from
      // `.N()`) into the lambda: the approximation is applied INSIDE the
      // function's scope frame (see makeLambda), never by re-evaluating
      // the result in the caller's dynamic context — which would break
      // lexical scoping.
      //
      // A `lazy` definition backed by a literal (a host `ce.declare('f', {
      // lazy: true, evaluate: ‹Function literal› })`) receives its operands
      // unevaluated; the literal must then bind them as written rather than
      // evaluate them itself, or the flag would be silently undone one level
      // down. Read at call time, so a later `_update({ lazy })` is honored.
      evaluate = (xs, options) =>
        fn(xs, this.lazy ? { ...options, holdArguments: true } : options);
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
 * True when SOME arm of `type` could return an indexed collection — the
 * arm-aware half of the `at`-handler check (§6 of the type-variables design).
 *
 * `couldMatch`, not `isSubtype`: the question is "could this ever be indexed",
 * so a `collection<…>` result (`Map`'s) counts. `type` must already carry the
 * D6 bound-reading (variables replaced by their bounds).
 */
function couldReturnIndexedCollection(type: Type): boolean {
  const arms = (typeof type !== 'string' && type.kind === 'intersection'
    ? signatureArms(type)
    : undefined) ?? [type];
  return arms.some((arm) => {
    const result = functionResult(arm);
    if (result === undefined) return false;
    return couldBeIndexed(result);
  });
}

/**
 * The per-result-node half of {@link couldReturnIndexedCollection}.
 *
 * `couldMatch` compares collection kinds LIKE WITH LIKE, so a parameterized
 * `collection<T>` result answers `false` against the bare `indexed_collection`
 * primitive even though `indexed_collection` is a SUBKIND of `collection`, not
 * a sibling (`Filter`'s bare `collection` result answers `true` only because
 * the fallback is assignability). Ask the question the rule means — could this
 * value be an indexed collection of its own element type.
 *
 * The repair must DISTRIBUTE over a union: `couldMatch` itself distributes, so
 * a result written `collection<number> | set<number>` answers `false` for the
 * `collection` member and would drop straight through a whole-node test — the
 * definition would then reject an `at` handler despite a possibly-indexed arm.
 */
function couldBeIndexed(result: Type): boolean {
  if (couldMatch(result, 'indexed_collection')) return true;
  if (typeof result !== 'object') return false;
  if (result.kind === 'collection')
    return couldMatch(result, {
      kind: 'indexed_collection',
      elements: result.elements,
    });
  if (result.kind === 'union') return result.types.some(couldBeIndexed);
  return false;
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
