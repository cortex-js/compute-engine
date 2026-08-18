import type { Complex } from 'complex-esm';
import type { OneOf } from '../common/one-of.js';
import type { MathJsonSymbol, MathJsonNumberObject } from '../math-json.js';
import type {
  DeclarationOrigin,
  Type,
  TypeString,
  TypeResolver,
  TypeReference,
  TypeParameter,
  TypeParamsOption,
} from '../common/type/types.js';
import type { BoxedType } from '../common/type/boxed-type.js';
import type { ConfigurationChangeListener } from '../common/configuration-change.js';
import type { StateEvent } from './engine-configuration-lifecycle.js';
import type { DeadlineFrame } from '../common/interruptible.js';
import type { MapAutoCompileStats } from './map-auto-compile-stats.js';
export type { MapAutoCompileStats } from './map-auto-compile-stats.js';
import type {
  ParseLatexOptions,
  SerializeLatexOptions,
} from './latex-syntax/types.js';
import type {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from './numeric-value/types.js';
import type { BigNum, Rational } from './numerics/types.js';
import type { RandomSeedFrame, RandomSubstream } from './numerics/random.js';
import type { EngineBoxingState } from './engine-boxing-state.js';
import type { InferenceRollbackFrame } from './inference-rollback.js';

import type { Expression, ExpressionInput } from './types-expression.js';
import type { FunctionProperties } from './function-properties/types.js';
export type {
  FunctionProperties,
  FunctionPropertyRecord,
} from './function-properties/types.js';
import type {
  Metadata,
  CanonicalOptions,
  FormOption,
  BoxedSubstitution,
} from './types-serialization.js';
import type {
  AngularUnit,
  SymbolDefinition,
  OperatorDefinition,
  ValueDefinition,
  BoxedDefinition,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
  InterpretResult,
  BoxedValueDefinition,
  BoxedOperatorDefinition,
} from './types-definitions.js';
import type {
  AssumeResult,
  Rule as KernelRule,
  BoxedRule as KernelBoxedRule,
  BoxedRuleSet as KernelBoxedRuleSet,
  RulePurpose,
  RuleStep as KernelRuleStep,
  AssignValue as KernelAssignValue,
  Scope as KernelScope,
  InspectableScope as KernelInspectableScope,
  NarrowingSink as KernelNarrowingSink,
  EvalContext as KernelEvalContext,
} from './types-kernel-evaluation.js';
import type {
  LanguageTarget,
  CompilationResult,
  IntervalJsCompilationTarget,
  JavaScriptCompilationTarget,
} from './compilation/types.js';

export type { RulePurpose } from './types-kernel-evaluation.js';

type Rule = KernelRule<Expression, ExpressionInput, IComputeEngine>;
type BoxedRule = KernelBoxedRule<Expression, IComputeEngine>;
type BoxedRuleSet = KernelBoxedRuleSet<Expression, IComputeEngine>;
type RuleStep = KernelRuleStep<Expression>;
type AssignValue = KernelAssignValue<
  Expression,
  ExpressionInput,
  IComputeEngine
>;
type Scope = KernelScope<BoxedDefinition>;
type InspectableScope = KernelInspectableScope<BoxedDefinition>;
type NarrowingSink = KernelNarrowingSink<BoxedDefinition>;
type EvalContext = KernelEvalContext<Expression, BoxedDefinition>;

/** Minimal interface for a LaTeX parser/serializer.
 *  Structurally compatible with `LatexSyntax` without importing it. */
export interface ILatexSyntax {
  parse(
    latex: string,
    options?: Partial<ParseLatexOptions>
  ): import('../math-json/types.js').MathJsonExpression | null;
  serialize(
    expr: import('../math-json/types.js').MathJsonExpression,
    options?: Record<string, unknown>
  ): string;

  /** Named dictionary entries with their LaTeX trigger strings, for reverse
   *  library search (`ce.searchDefinitions()`). Optional: MathJSON-only
   *  builds and minimal injected syntaxes may not implement it. */
  getNamedTriggers?(): ReadonlyArray<{ name: string; triggers: string[] }>;
}

export type OperatorInfo = {
  kind: 'function' | 'opaque';
  signature?: BoxedType;

  /**
   * `true` when the operator's definition provides an evaluation rule — an
   * `evaluate` handler or a `collection` handler — so that applying it can
   * produce a computed result. `false` for a registered-but-inert head that
   * only parses/serializes (e.g. `Triangle`), which is returned unchanged by
   * `evaluate()`.
   *
   * This is a "has an evaluation rule" signal, **not** a guarantee that the
   * head computes. A few common heads reduce only through a `canonical`
   * rewrite to a different operator and therefore report `false` even though
   * they do compute: `Exp` (→ `Power`), `Square` (→ `Power`), `Complex`,
   * and `Greater` (→ `Less`). Equivalent to `kind === 'function'`.
   *
   * Conversely, this is a per-operator capability, not per-call inertness:
   * a head can report `true` yet return typical applications unevaluated —
   * e.g. `Element` and `ForAll` have `evaluate` handlers but stay symbolic
   * unless the proposition can be decided (`Element(x, RealNumbers)` echoes
   * back when nothing is known about `x`).
   */
  canEvaluate: boolean;
};

export type SymbolInfo = {
  kind: 'constant' | 'variable';
  type: BoxedType;
};

/** One result of `ce.searchDefinitions()`. */
export type DefinitionSearchResult = {
  /** The canonical identifier, e.g. `'GCD'`. Always resolvable via
   * `ce.lookupDefinition(id)`. */
  id: MathJsonSymbol;

  /** The kind of definition, using the same semantics as
   * `operatorInfo()`/`symbolInfo()`:
   * - `'function'` — an operator with an `evaluate` or `collection` handler
   * - `'opaque'` — a registered-but-inert operator head
   * - `'constant'` — a constant value symbol (e.g. `Pi`)
   * - `'variable'` — a declared, non-constant value symbol
   */
  kind: 'function' | 'opaque' | 'constant' | 'variable';
};

/** @internal */
/** A symbolic-integration provider: given an integrand and the integration
 * variable, returns a closed-form antiderivative (an expression in `variable`),
 * or `null` when it cannot integrate it. See `IComputeEngine._integrationProvider`.
 *
 * When an optional `trace` accumulator is passed (by `expr.explain('Integrate')`),
 * the provider appends a curated, whole-state step chain describing how the
 * antiderivative was found. The argument is backward-compatible: the plain
 * `Integrate` evaluator calls the provider with two arguments and never traces. */
export type IntegrationProvider = (
  integrand: Expression,
  variable: string,
  trace?: RuleStep[]
) => Expression | null;

//
// ── Protocols (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix A) ─────────────────────
//
// A protocol is a set of function and property REQUIREMENTS a type may declare
// itself to satisfy (`type string is Hashable`). Protocol records live in the
// engine-level `_protocolRegistry` and, like type records, mutate IN PLACE
// (captured references must see the update).
//

/** One requirement of a protocol. A `function` member's signature is stored
 * VERBATIM, with `Self` unsubstituted: `Self` is a textual substitution token
 * (ruling P12), never a type the registry can resolve. */
export type ProtocolMember =
  | { kind: 'function'; signature: string }
  | { kind: 'readonly' | 'readwrite'; type: string };

/**
 * One write of inference evidence onto a definition, as delivered to
 * `IComputeEngine._noteInferenceWrite` — the single emission point whose
 * subscribers are the provenance history, the fresh-inference set, and the
 * narrowing sink. See `docs/plans/2026-08-13-inference-provenance-journal.md`
 * (phase 1).
 */
export type InferenceWriteEvent = {
  /** The symbol whose binding was written. */
  name: string;
  /** The binding wrapper, as the narrowing sink consumes it. */
  binding: BoxedDefinition;
  /** The definition object the write landed on — the carrier of the
   * `_typeProvenance` history. Exactly one of the two definition shapes. */
  target: BoxedValueDefinition | BoxedOperatorDefinition;
  /** The value definition written, when the write was on a value binding —
   * what the fresh-inference set (`_freshlyInferred`) tracks. Omitted for
   * signature writes on operator definitions. */
  valueDef?: BoxedValueDefinition;
  /** The type before the write. */
  from: BoxedType;
  /** The type the write installed. */
  to: BoxedType;
  /** `'inferred'` for `_infer()` writes, `'assumed'` for writes by the
   * assumptions machinery. */
  kind: 'inferred' | 'assumed';
};

/**
 * The ambient canonicalization context recorded as the `cause` of provenance
 * entries: the operator expression being canonicalized when an inference
 * write fires. Kept as the operator name + the operand array as the
 * canonicalizer received it (possibly raw MathJSON — canonicalization has
 * not run yet); `expr` is the non-canonical materialization, built lazily on
 * the first write that records it (writes are rare — building an expression
 * per canonicalization would not be).
 */
export type InferenceCauseContext = {
  operator: string;
  ops: ReadonlyArray<ExpressionInput>;
  expr?: Expression;
};

/** A HOST (JavaScript) implementation of a protocol member. A callback carries
 * no type information the engine can read, so — like a host-declared operator
 * handler — it is TRUSTED: only member-name coverage is checked, never its
 * signature. Boxed in a wrapper so it stays distinguishable from an Epsil
 * function literal (design P10). */
export type JSImplementation = {
  /** The host callback. */
  host: ProtocolHostHandler;
};

/** A host callback implementing one protocol member. Its arguments arrive as
 * boxed engine values (the receiver first, per P1); its result is boxed by the
 * engine. The engine cannot type-check it — that is what "trusted" means
 * here. */
export type ProtocolHostHandler = (...args: Expression[]) => unknown;

/** One conformance edge: "this target type conforms to this protocol".
 * Conformances are add-only (monotone); only their implementations replace. */
export type ConformanceRecord = {
  /** The conforming type — named and ground (Appendix A "Conformance
   * targets"). */
  target: Type;
  /** The target's canonical serialization: the dedup/replace key. For a
   * CONDITIONAL edge it also carries the clause, so two different conditions on
   * one head are two keys (and collide under the one-per-head rule) rather than
   * one silently replacing the other. */
  targetKey: string;
  /** CONDITIONAL conformance (Appendix A "Conditional Conformance"): the
   * variables the trailing `where` clause binds, with their bounds and `is`
   * entries. When present, {@link ConformanceRecord.target} is a HEAD PATTERN
   * (`list<T>`) rather than a ground type, and the edge applies to exactly
   * those instantiations whose arguments satisfy the clause. */
  where?: TypeParameter[];
  /** Member name → implementation: an Epsil function literal, or a
   * {@link JSImplementation} wrapper for a host callback. Property handlers
   * ride under the mangled keys `__get__<name>` / `__set__<name>`. Validated
   * against the protocol's requirements before it is stored (P17).
   *
   * This is the MERGED map dispatch reads: it holds the author's entries
   * ({@link ConformanceRecord._authored}) plus any accessors the engine
   * synthesized for property requirements the target's stored fields satisfy
   * (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Objects and protocols"). */
  impl?: Record<string, Expression | JSImplementation>;
  /** The implementation block as the AUTHOR wrote it — the statement's `is P
   * { … }` block, or the host API's three flattened buckets — before the
   * engine merged its synthesized field-backed accessors into
   * {@link ConformanceRecord.impl}.
   *
   * Stored rather than derived from `impl`, because the two questions the
   * engine asks of it cannot be answered by inspecting the merged map: an
   * author's EMPTY block (`type P is Nameable { }`) and no block at all both
   * leave the merged map holding nothing but synthesized accessors, yet an
   * empty block still claims the edge — a second implementation of it is
   * `protocol-implementation-duplicate`, and it does not inherit a
   * supertype's implementation, while a block-less edge does both. */
  _authored?: Record<string, Expression | JSImplementation>;
  /** Where {@link ConformanceRecord.impl} came from, when it was installed
   * from INSIDE an Epsil batch (ruling P47): the batch id
   * ({@link IComputeEngine._epsilBatchId}) and the identity of the
   * implementation BLOCK expression that installed it. A second, DIFFERENT
   * block for the same (type, protocol) pair in the SAME batch is
   * `protocol-implementation-duplicate`; a re-implementation in a later batch
   * replaces. The block identity is what tells a genuine second block from
   * the SAME statement re-registering — one statement installs its block up
   * to three times per batch (the static pre-pass canonicalizes it, then the
   * evaluation loop canonicalizes and evaluates it), each time rebuilding the
   * record around the very same block expression.
   *
   * Absent for an implementation installed outside any batch (a box-route
   * `DeclareConformance`) or by the host, both of which replace without
   * error. */
  _implOrigin?: { batch: number; block?: Expression };
  /** No implementation yet: an end-of-batch `protocol-implementation-pending`
   * warning (ruling P3). A SEMANTIC protocol (no members) is never pending. */
  pending: boolean;
  /** WHY {@link ConformanceRecord.pending} is set, when the edge was left
   * pending by a RE-SETTLEMENT rather than by never having been implemented:
   * a protocol replacement, or a redefinition of the target type. Without it
   * the end-of-batch warning names only the pair, which for a re-settled edge
   * is the least informative half of the story — an edge that read fine in the
   * previous cell is now pending, and the reason is the requirement or the
   * layout that moved under it. Carries the `implementationProblem` message,
   * or a description of what the target's new layout no longer satisfies.
   *
   * Absent on an edge that is not pending, and on one pending only because no
   * implementation has been written yet. */
  _pendingReason?: string;
  declaredByStatement: boolean;
};

/** A protocol declaration and every conformance registered against it. */
export type ProtocolRecord = {
  name: string;
  members: Record<string, ProtocolMember>;
  conformances: ConformanceRecord[];
  declaredByStatement: boolean;
  /** REDEFINITION DISCIPLINE — which compilation unit and which declaring
   * STATEMENT this record came from
   * (`docs/plans/2026-08-14-redefinition-discipline.md`). The DECLARATION-level
   * counterpart of {@link ConformanceRecord._implOrigin}, which stamps
   * implementation blocks: a second `protocol` statement for this name in the
   * same batch is `protocol-redefinition`, while a later batch replaces.
   * Absent on a box-route or host-API declaration, which replace freely. */
  _declOrigin?: DeclarationOrigin;
};

/** The host-API shape of a protocol's requirements. A flat
 * `Record<string, string>` cannot represent properties, hence the three
 * buckets (Appendix A "Host API"). */
export type ProtocolMembersInput = {
  functions?: Record<string, string>;
  readonly?: Record<string, string>;
  readwrite?: Record<string, string>;
};

/** The host-API shape of an IMPLEMENTATION block. Property handlers are given
 * under their surface names (`getters.hash`), not under the internal
 * `__get__hash` mangling (Appendix A "Properties": the mangling is an
 * implementation detail, not part of the public surface). */
export type ProtocolImplementationInput = {
  functions?: Record<string, ProtocolHostHandler>;
  getters?: Record<string, ProtocolHostHandler>;
  setters?: Record<string, ProtocolHostHandler>;
};

export interface IComputeEngine {
  /** The LatexSyntax instance used for LaTeX parsing/serialization.
   *  `undefined` when no LatexSyntax was provided to the constructor.
   */
  readonly latexSyntax: ILatexSyntax | undefined;

  /** @internal Returns the LatexSyntax instance or throws if unavailable. */
  _requireLatexSyntax(): ILatexSyntax;

  /** @internal An optional symbolic-integration provider. When set, the
   * `Integrate` evaluator consults it for an indefinite antiderivative before
   * falling back to the built-in `antiderivative()`. Returns a closed-form
   * antiderivative (an expression in `variable`), or `null`/an inert
   * `Integrate` when it cannot integrate the integrand. This is the slot the
   * opt-in `loadIntegrationRules()` (Rubi rule driver) registers into. */
  _integrationProvider?: IntegrationProvider;

  /** Engine-wide LaTeX parse/serialize options (e.g. `decimalSeparator`).
   *  Merged into every `parse()` and `toLatex()` call between LatexSyntax
   *  defaults and per-call overrides. */
  latexOptions: Partial<ParseLatexOptions & SerializeLatexOptions>;

  // Common symbols
  readonly True: Expression;
  readonly False: Expression;
  readonly Pi: Expression;
  readonly E: Expression;
  readonly Nothing: Expression;
  /** The `Missing` symbol: an absent value whose position is preserved. */
  readonly Missing: Expression;

  readonly Zero: Expression;
  readonly One: Expression;
  readonly Half: Expression;
  readonly NegativeOne: Expression;
  readonly Two: Expression;
  /** ImaginaryUnit */
  readonly I: Expression;
  readonly NaN: Expression;
  readonly PositiveInfinity: Expression;
  readonly NegativeInfinity: Expression;
  readonly ComplexInfinity: Expression;

  readonly context: EvalContext;
  contextStack: ReadonlyArray<EvalContext>;

  /** @internal */
  _evalContextStack: EvalContext[];

  /** @internal */
  _isVerifying: boolean;

  /** @internal */
  readonly isVerifying: boolean;

  /** @internal */
  readonly _typeResolver: TypeResolver;

  /** The engine-level type registry: one namespace of declared types per
   * engine, world state alongside symbol assignment. Types are NOT lexically
   * scoped — a name means the same thing everywhere in the engine, for the
   * engine's lifetime (see `docs/plans/2026-08-10-global-type-registry.md`).
   * All reads and writes go through `_typeResolver` / `declareType()`.
   * @internal */
  readonly _typeRegistry: Record<string, TypeReference>;

  /** Capture the type registry's state; the returned thunk restores it.
   * Used by the Epsil static pre-pass to discard its canonicalization-time
   * type registrations (see `ComputeEngine._typeRegistryRollbackPoint`).
   * @internal */
  _typeRegistryRollbackPoint(): () => void;

  /** The engine-level PROTOCOL registry — the second kind of registry entry
   * the global-type-registry design pre-writes (its §5), not a second scoping
   * regime. Protocols are engine-global, like types: a protocol name means the
   * same thing everywhere in the engine, for the engine's lifetime.
   *
   * Protocol names are NOT types (ruling P8): they never enter
   * `_typeRegistry`, `knownTypeNames` or the type resolver.
   * @internal */
  readonly _protocolRegistry: Record<string, ProtocolRecord>;

  /** Capture the protocol registry's state; the returned thunk restores it.
   * The protocol mirror of {@link _typeRegistryRollbackPoint}, invoked by the
   * Epsil static pre-pass alongside it.
   * @internal */
  _protocolRegistryRollbackPoint(): () => void;

  /** A monotone counter that advances on every mutation of the protocol /
   * conformance registry — a protocol declaration or re-declaration, a
   * conformance edge, an implementation block, and the static pre-pass's
   * registry rollback.
   *
   * It is the cache key of the DERIVED dispatcher effect unions
   * (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
   * effect"): a protocol function requirement with a BARE specifier imposes
   * no effect bound, and the dispatcher's effect set is the union of the
   * inferred effects of the registered conforming implementations. That union
   * is recomputed lazily, and — per that section's implementation note, "the
   * effects cache's key must include the conformance registry among its
   * axes" — a memo of it is valid only while both this counter and
   * {@link _callableVersion} are unchanged.
   *
   * READ-ONLY: advanced only through
   * {@link _noteConformanceRegistryChange}.
   * @internal */
  readonly _conformanceVersion: number;

  /** Advance {@link _conformanceVersion}. Called at every protocol /
   * conformance registry mutation site, adjacent to the `config` state event
   * those sites already report.
   * @internal */
  _noteConformanceRegistryChange(): void;

  /** The stack of open inference **rollback frames**
   * (`inference-rollback.ts`; phase 2b of
   * `docs/plans/2026-08-13-inference-tx-design.md`). While a frame is open,
   * every inference-driven mutation site journals an undo entry into the
   * innermost frame; `_withRolledBackInference` replays them (strict LIFO)
   * when the frame closes. Empty on the fast path — every journaling hook
   * is one length check.
   * @internal */
  _rollbackFrames: InferenceRollbackFrame[];

  /**
   * Run `fn` with a rollback frame open and ALWAYS roll the frame back — on
   * normal return AND on throw (the body's error is rethrown after the
   * undo). Returns `fn`'s value. Always-rollback by design: a trial's
   * outcome is a *decision*, not state, and the static checking pass checks
   * and then discards — there is no commit form.
   *
   * Must be called inside a boxing-pass window (`_inferenceTxDepth > 0`);
   * open one with {@link _withBoxingPassWindow} when the caller is not
   * already inside `box()`/`parse()`.
   *
   * An expression or definition created inside the frame must not be
   * evaluated, canonicalized against, or resolved for symbol lookup after
   * the rollback; retention for *rendering* (`toString()`) is permitted.
   *
   * `options.forbidsRepairs` marks a repair-free TRIAL frame (phase 2c):
   * the construction-level repairs assert they never run under one.
   * @internal */
  _withRolledBackInference<T>(
    fn: () => T,
    options?: { forbidsRepairs?: boolean }
  ): T;

  /**
   * Run `fn` inside one boxing-pass window (the `_inferenceTxDepth` /
   * `_boxingEpoch` / `_freshlyInferred` lifecycle that `box()` and
   * `parse()` open around themselves). For callers — the Epsil static
   * checking pass — that need a rollback frame to span several `box()`
   * calls: a rollback frame must nest strictly inside ONE window, so the
   * caller opens this window first and the per-statement `box()` windows
   * nest inside it.
   * @internal */
  _withBoxingPassWindow<T>(fn: () => T): T;

  /** Declare a protocol (Appendix A "Host API"). Throws on error, including
   * on re-declaration — the Epsil statement route replaces instead (P5). */
  declareProtocol(name: string, members: ProtocolMembersInput): void;

  /** Implement `protocol` for `type`, declaring the conformance edge if it is
   * not already registered (Appendix A "Host API").
   *
   * THROWS on every error — the host channel; the Epsil statement route
   * returns error VALUES instead. A second host implementation of the same
   * (type, protocol) pair throws rather than replacing (P5).
   *
   * The callbacks are JavaScript functions, so they carry no signature the
   * engine can check: they are trusted like host-declared operator handlers,
   * and only member-name coverage, unknown members and a `set` handler on a
   * `readonly` property are validated.
   *
   * `options.where` declares a CONDITIONAL conformance: `type` is then a HEAD
   * PATTERN naming the variables (`'list<T>'`) and `where` is the clause SOURCE
   * that binds them (`'where T is Comparable'`; the `where` word may be
   * omitted). A malformed clause, or a head variable the clause does not bind,
   * throws. */
  declareProtocolImplementation(
    type: string,
    protocol: string,
    impl: ProtocolImplementationInput,
    options?: { where?: string }
  ): void;

  /** Depth of enclosing static type-check passes (the Epsil pre-pass).
   * Non-zero while `staticDiagnostics` canonicalizes a program under its
   * 'epsil:static-check' frame; the `DeclareType` top-level surrogate check
   * requires BOTH the frame name and this counter, so a host `pushScope`
   * with the same name cannot forge the surrogate.
   * @internal */
  _staticTypeCheckDepth: number;

  /** The id of the Epsil BATCH currently executing — one `executeEpsil` run,
   * spanning BOTH its static pre-pass and its evaluation loop — or
   * `undefined` outside any batch. Set by `executeEpsil` (the same posture as
   * {@link IComputeEngine._staticTypeCheckDepth}: a batch is an `src/epsil`
   * notion, the engine only holds the flag) and read by the protocol
   * registry, which stamps every implementation it installs inside a batch so
   * that a SECOND implementation block for the same (type, protocol) pair in
   * one batch is `protocol-implementation-duplicate`, while a
   * re-implementation in a later batch replaces (ruling P47).
   * @internal */
  _epsilBatchId: number | undefined;

  /** `true` only while the Epsil interpreter is canonicalizing or evaluating a
   * top-level statement whose AST head is `DeclareType`, `DeclareSumType` or
   * `DeclareProtocol` — the REDEFINITION DISCIPLINE's statement-route marker
   * (`docs/plans/2026-08-14-redefinition-discipline.md`).
   *
   * {@link IComputeEngine._epsilBatchId} alone cannot play this part: it is
   * ambient for the WHOLE `executeEpsil` extent, so a `ce.box(["DeclareType",
   * …]).evaluate()` performed re-entrantly from a host operator's evaluate
   * handler would run with a batch live and be mistaken for a statement of the
   * program — after which the program's own declaration of that name would
   * falsely report `type-redefinition`. The marker says WHICH ROUTE is
   * declaring; the batch id says which unit.
   *
   * Set by `src/epsil/execute-epsil.ts` and `src/epsil/static-diagnostics.ts`
   * around the statement they process, and SAVED AND CLEARED by each
   * `Declare*` handler for the duration of its own body, so a declaration made
   * re-entrantly from inside one sees no marker. It is not consumed by being
   * read: one statement registers up to three times per batch (pre-pass
   * canonicalize, eval-loop canonicalize, evaluate) and all three must be
   * stamped, or the statement's own re-registration looks like a duplicate.
   * @internal */
  _epsilDeclarationRoute: boolean;

  /** Absolute time beyond which evaluation should not proceed.
   * @internal
   */
  deadline: number | undefined;

  /** Absolute time beyond which evaluation should not proceed
   * @internal
   */
  _deadline?: number;

  /** The full deadline frame (effective deadline plus attribution).
   * @internal
   */
  _deadlineFrame?: DeadlineFrame;

  /** The innermost active `WithRandomSeed` frame (see
   * `withRandomSeedFrame`), or `undefined` when random draws are live.
   * @internal
   */
  _randomFrame?: RandomSeedFrame;

  /** Time remaining before _deadline
   * @internal
   */
  _timeRemaining: number;

  /** Instrumentation counters for the auto-compilation of lazy-`Map` element
   * lambdas on numeric drains: how many compile attempts were made, how many
   * elements a compiled function served, how many dependency re-validations,
   * recompiles, per-element interpreter fallbacks and NaN double-checks
   * occurred. This is the only surface that says whether a given `Map` drain
   * compiled, re-validated or fell back.
   *
   * ## Read the counters BEFORE stringifying anything
   *
   * The instrument has several ways of handing a careful reader numbers that
   * look right and are not. None throws or warns, so start with the one that
   * fires on the most reflexive debugging action there is — printing the
   * value:
   *
   * ```ts
   * const before = { ...ce._mapAutoCompileStats };
   * const r = ce.parse(MAP).N();
   * console.log(r.evaluate().toString());        // ← "just looking at it"
   * const d = delta(before, ce._mapAutoCompileStats);  // attempts 1, hits 10
   * ```
   *
   * That reads as "`evaluate()` compiles 10 elements". It does not:
   * `evaluate()` compiles NOTHING, and `toString()` is the consumer.
   * Serializing a lazy result materializes a fixed 10-element preview
   * regardless of the drain size, so stringifying inside a measured region
   * both does work and RELOCATES the attribution onto whatever call preceded
   * it. The reader ends up with a coherent, wrong causal picture in which
   * nothing looks off.
   *
   * ## Three gates, all of which fail as zeros
   *
   * The counters move only when all three hold, and a zero means "the
   * instrument was inert", not "the path did not run":
   *
   * 1. `ce.precision === 'machine'`. At the default bignum-preferred
   *    precision the float tier never attempts — correctly, since at bignum
   *    the interpreter produces digits float64 cannot match.
   * 2. A numeric route: `.N()`, or `.evaluate()` on an `N(…)`-marked body. A
   *    bare `.evaluate()` reports zero at any drain size.
   * 3. The lazy result must actually be CONSUMED. `.N()` on a `Map` returns a
   *    lazy collection; if nothing iterates it, nothing compiles.
   *
   * "Consumed" is narrower than "touched" — measured one call at a time at
   * n = 2000, machine precision, `Range`-sourced, as `attempts`/`compiledHits`:
   *
   * ```text
   *   .N()          0 / 0      builds the lazy collection, compiles nothing
   *   .evaluate()   0 / 0      compiles NOTHING
   *   .toString()   1 / 10     serializing materializes a 10-element preview
   *   [...each()]   1 / 2000   the whole drain
   *   .at(1500)     1 / 1      exactly one element
   *   .count        0 / 0      answers structurally
   *   .json         0 / 0      answers structurally
   * ```
   *
   * ## Scope: the counters and the cache do not match
   *
   * The counters are process-global and cumulative, not per-engine — every
   * engine returns the same object and `new ComputeEngine()` does not reset
   * it — so absolute reads are meaningless and a multi-engine process
   * aggregates. Always take DELTAS across the region you are measuring.
   *
   * The compile CACHE has a different scope from the counters, which is worth
   * stating side by side because the natural assumption is that they match:
   * the cache keys on the expression SHAPE (re-parsing does not defeat it) and
   * is PER-ENGINE, while the counters are MODULE-WIDE. So a second measurement
   * of the same `Map` shape in the same engine reads 0/0. Comparing routes by
   * running them in sequence — the natural way to build the table above —
   * gives a real number for the first route and zeros for the rest, which
   * reads as "only `each()` compiles". Measure each route in a FRESH engine,
   * and still take deltas.
   *
   * One more source-shape property that is not a defect: `iterationLimit`
   * never gates the counters, but it does bound the DRAIN for a
   * COMPREHENSION-sourced collection, because the limit is spent materializing
   * the comprehension before the `Map` ever drains. A `Range`-sourced
   * collection is lazy and costs no iterations. So an instrument sourced from
   * a comprehension must raise `iterationLimit` above the element count.
   *
   * Reachable at runtime with no stability promise, like the other
   * `_`-prefixed members: the shape and the counter set may change.
   * @internal
   */
  readonly _mapAutoCompileStats: MapAutoCompileStats;

  /** Names defined by a library that was NOT one of the engine's standard
   * libraries, i.e. a `LibraryDefinition` object supplied by the caller to the
   * constructor's `libraries` option. Caller-supplied libraries are installed
   * into the SYSTEM scope (bootstrap runs between `pushScope('system')` and
   * `pushScope('global')`), so scope identity alone cannot tell an
   * engine-authored definition from a caller-authored one; this set records the
   * provenance. Populated once, at bootstrap.
   * @internal */
  readonly _customLibraryOperators: Set<string>;

  /** The `any` invalidation axis (read-only; advanced only through
   * `_noteStateEvent`). @internal */
  readonly _anyVersion: number;

  /** Semantic-mutation counter (see `ComputeEngine._semanticVersion`).
   * @internal */
  readonly _semanticVersion: number;

  /** Rarely-bumped global-semantics counter (see
   * `ComputeEngine._worldVersion`).
   * @internal */
  readonly _worldVersion: number;

  /** The `callable` invalidation axis (read-only; advanced only through
   * `_noteStateEvent`) — keys `BoxedFunction._effects`. @internal */
  readonly _callableVersion: number;

  /** When > 0, value writes are ephemeral loop-index writes.
   * @internal */
  _ephemeralWriteDepth: number;

  /** The state-event choke point
   * (`docs/plans/2026-08-09-state-event-invalidation-axes.md` §3): write
   * sites report what happened; the lifecycle's dispatch table
   * (`axisMaskOf`) decides which invalidation axes advance. Since the
   * step-2b cutover this is the SOLE writer of the axes — the axis members
   * below are read-only.
   * @internal */
  _noteStateEvent(event: StateEvent): void;

  /** Depth of nested top-level boxing operations (see
   * `beginInferenceTransaction` in `box.ts`).
   * @internal */
  _inferenceTxDepth: number;

  /** Monotonically increasing count of OUTERMOST boxing operations —
   * incremented when `_inferenceTxDepth` transitions 0 → 1, constant for
   * the duration of that pass. Stamped onto provenance entries
   * (`TypeProvenanceEntry.epoch`) so "was this entry recorded by the pass
   * running now?" is one integer comparison instead of a containment walk
   * over the tree being canonicalized.
   * @internal */
  _boxingEpoch: number;

  /** Per-engine state for construction-local boxing repairs.
   * @internal */
  readonly _boxingState: EngineBoxingState<Scope>;

  /** When true, a discarded scope tombstones its value definitions and the
   * symbol resolution sites throw on a use of a dead binding
   * (`boxed-expression/binding-tombstone.ts`). Defaults from the
   * `CE_DEBUG_BINDINGS` environment variable.
   * @internal */
  _debugBindings: boolean;

  /** Value definitions whose type was first inferred (unknown → concrete)
   * during the current top-level boxing operation — the forward-computed
   * provenance for `repairFreshMatrixInference`'s eligibility. Lazily
   * allocated; `null` when empty or no boxing is in progress.
   * @internal */
  _freshlyInferred: Set<BoxedValueDefinition> | null;

  /** The single emission point for a write of inference evidence onto a
   * definition's type (or an operator definition's signature). Every
   * subscriber of "a definition's type was changed by inference" hangs off
   * this call: the provenance history (`_typeProvenance`), the
   * fresh-inference set (`_freshlyInferred`), and the narrowing sink
   * (`_narrowingSink`). Callers emit only for writes that actually changed
   * the type — no-op re-inferences are skipped at the write site. This is
   * deliberately NOT `_noteStateEvent`: that channel is the sole writer of
   * the cache-invalidation axes and stays payload-free; this one is passive
   * data recording with no invalidation effects.
   * @internal */
  _noteInferenceWrite(event: InferenceWriteEvent): void;

  /** The expression whose canonicalization is currently running — the
   * ambient `cause` recorded by `_noteInferenceWrite` into provenance
   * entries. Installed (saved/restored, so nesting resolves to the
   * innermost) around operator canonicalization; `null` outside. Stored as
   * operator + operands and materialized into a non-canonical expression
   * only when a write actually records it, so the hot path pays two field
   * writes and nothing else.
   * @internal */
  _inferenceCause: InferenceCauseContext | null;

  /**
   * Run `fn` with at most `ms` milliseconds (numeric form) or `limit.ms`
   * (object form, which also accepts an attribution `label`). A tighter
   * enclosing span preempts this limit; use the label and
   * `CancellationError.attribution`/`spans` to tell which limit fired.
   *
   * **⚠️ `fn` MUST be synchronous.** The span is restored in a synchronous
   * `finally`, so a `Promise`-returning (`async`) callback hands control back
   * at its first `await` while the span is still open: work that resumes after
   * that point runs **outside** the deadline and is never cancelled (see
   * `docs/TIMEOUT-MODEL.md` §6.4). For asynchronous cancellation use
   * `expr.evaluateAsync({ signal })` with an `AbortSignal` instead.
   */
  withTimeLimit<T>(
    limit: number | { ms: number; label?: string },
    fn: () => T extends Promise<unknown> ? never : T
  ): T;

  iterationLimit: number;

  recursionLimit: number;

  maxCollectionSize: number;

  chop(n: number): number;
  chop(n: BigNum): BigNum | 0;
  chop(n: number | BigNum): number | BigNum;

  bignum: (a: string | number | bigint | BigNum) => BigNum;

  complex: (a: number | Complex, b?: number) => Complex;

  /** @internal */
  _numericValue(
    value:
      | number
      | bigint
      | OneOf<[BigNum | NumericValueData | ExactNumericValueData]>
  ): NumericValue;

  set precision(p: number | 'machine' | 'auto');
  get precision(): number;

  tolerance: number;

  /** @internal Draw the next uniform in [0, 1) — from the innermost
   *  `WithRandomSeed` frame when one is active, otherwise `Math.random()`. */
  _random(): number;

  /** @internal A private stream for the stochastic ESTIMATORS, derived from
   *  the ambient `WithRandomSeed` frame but consuming NO indices from it.
   *  `tag` (a structural hash) selects which sub-stream. Live outside a frame.
   *  See `docs/plans/2026-07-28-derived-substreams.md`. */
  _substream(tag: number): RandomSubstream;

  angularUnit: AngularUnit;

  costFunction: (expr: Expression) => number;

  /** The rules used by `.simplify()` when no explicit `rules` option is passed.
   *  Initialized to the built-in simplification rules.
   *  Users can `push()` additional rules or replace the entire array. */
  simplificationRules: Rule[];

  /** The rules used by `solve()` to find roots of univariate expressions.
   *  Each rule matches a normalized equation `f(_x) = 0` — the unknown is
   *  the wildcard `_x` — and `replace` produces a root expression.
   *  Conditions should reject matches where other wildcards capture `_x`.
   *  Candidate roots are validated against the original equation, so an
   *  over-eager template degrades to a no-op rather than a wrong answer.
   *  Initialized to the built-in root-finding rules; `push()` to extend,
   *  assign to replace. */
  solveRules: Rule[];

  /** The rules used by `solve()` to transform an equation into equivalent,
   *  easier-to-solve forms before root-finding (e.g. `ln f(x) → f(x) - 1`).
   *  Same conventions and extension pattern as `solveRules`. */
  harmonizationRules: Rule[];

  strict: boolean;

  /** Whether the engine may implicitly generate and execute compiled code as
   * a performance optimization (auto-compiled `Map` drains, compiled numeric
   * quadrature/limit kernels). `'auto'` (default) attempts implicit
   * compilation and latches to `'off'` engine-wide on the first CSP
   * `EvalError`; `'off'` never attempts it. Explicit `compile()` is exempt.
   */
  jit: 'auto' | 'off';

  expr(
    expr: NumericValue | ExpressionInput,
    options?: {
      form?: FormOption;
      scope?: Scope;
    }
  ): Expression;

  /** @deprecated Use `expr()` instead. */
  box(
    expr: NumericValue | ExpressionInput,
    options?: {
      form?: FormOption;
      scope?: Scope;
    }
  ): Expression;

  /**
   * Parse a LaTeX string and return a boxed expression.
   *
   * This is a convenience method equivalent to `ce.expr(parse(latex))`,
   * but uses the engine's symbol definitions for better parsing accuracy.
   *
   * `options.scope` RECEIVES the parse's writes: the whole parse runs with
   * that scope as the current lexical scope, so name resolution (including
   * the parser's symbol oracle) walks `scope → parents`, and every
   * auto-declare and inference lands rooted there. Discarding the scope
   * discards the writes. Use `ce.createScope()` to make one that can be read
   * back.
   *
   * `options.speculative` leaves NO trace in the engine's type state: the
   * parse runs inside a transient scope (auto-declares land there and are
   * discarded with it), and every ambient symbol whose type is currently
   * inferred is shadowed in that scope with its current type — so a
   * narrowing use in `latex` refines the discarded shadow instead of
   * persistently narrowing the ambient symbol. Use it for derive-style
   * parses that only READ the result (its type, structure, or
   * serialization): the result's bindings refer to the discarded scope, so
   * do not retain, evaluate, or compare it against later expressions.
   * Mutually exclusive with `scope`.
   */
  parse(
    latex: string,
    options?: Partial<ParseLatexOptions> & {
      form?: FormOption;
      scope?: Scope;
      speculative?: boolean;
    }
  ): Expression;
  parse(
    latex: string | null,
    options?: Partial<ParseLatexOptions> & {
      form?: FormOption;
      scope?: Scope;
      speculative?: boolean;
    }
  ): Expression | null;

  /**
   * The symbols that appear in function-application syntax `f(…)` in `latex`
   * but are not defined as functions in the current scope (so they parse as
   * implicit multiplication or are left unresolved). Scope-aware and
   * side-effect-free. Intended to flag calls to undefined functions in tools
   * such as notebooks; intersect with {@link Expression.freeVariables}
   * to drop deliberate multiplication of defined values.
   *
   * Only parenthesized-group application is detected: a symbol juxtaposed
   * with a matrix environment (`\mathrm{Eigenvalues}\begin{pmatrix}…`) is
   * not reported, since a matrix never reaches the symbol-with-delimiter
   * juxtaposition analysis.
   */
  appliedNonFunctions(latex: string): string[];

  function(
    name: string,
    ops: ReadonlyArray<ExpressionInput>,
    options?: {
      metadata?: Metadata;
      form?: FormOption;
      scope?: Scope;
    }
  ): Expression;

  /**
   * This is a primitive to create a boxed function.
   *
   * In general, consider using `ce.expr()` or `ce.function()` or
   * `canonicalXXX()` instead.
   *
   * The caller must ensure that the arguments are in canonical form:
   * - arguments are `canonical()`
   * - arguments are sorted
   * - arguments are flattened and desequenced
   *
   * @internal
   */
  _fn(
    name: string,
    ops: ReadonlyArray<Expression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      scope?: Scope;
    }
  ): Expression;

  /**
   * Construct an **object** — the engine's mutable value kind — of the
   * nominal type named `typeName`, with the given stored fields (insertion
   * order is the declared field order).
   *
   * The nominal type is resolved once and PINNED on the instance, a fresh
   * identity is minted for every call, and the result is always canonical and
   * always already evaluated.
   *
   * This is the ONLY construction path for objects until the user-facing
   * named-argument constructor lands: `box()`/`parse()` never mint one, which
   * is what makes "a parsed snapshot is a record under the `Object`
   * provenance head, never an object" true by construction.
   *
   * Throws when a field value is an object belonging to a different engine
   * (`object-foreign-engine`).
   *
   * @internal
   */
  _object(
    typeName: string,
    slots: Iterable<readonly [string, Expression]> | Record<string, Expression>,
    metadata?: Metadata,
    /** The resolved nominal type to PIN on the instance, when the caller has
     * it. Required for a PARAMETERIZED object type, whose name alone resolves
     * to the bare declaration record: `Cell<integer>` — the applied reference
     * the call site solved for — is what the constructed value's type must be.
     * Ignored unless it names `typeName`. */
    pinnedType?: BoxedType
  ): Expression;

  /** @internal Compile a boxed expression. */
  _compile(
    expr: Expression,
    options?: Record<string, unknown>
  ): CompilationResult;

  /**
   * @internal Get a registered compilation target by name.
   *
   * The two built-in executable targets are typed concretely so their compiled
   * `run` needs no cast: `interval-js` accepts `number | Interval` variables
   * and returns `IntervalResult`; `javascript` accepts `number | ComplexResult`
   * variables (plain reals or complex domain-coloring inputs) and returns
   * `number | ComplexResult`. Any other name (source-only or custom targets)
   * falls back to the generic `LanguageTarget<Expression>`.
   */
  _getCompilationTarget(
    name: 'interval-js'
  ): IntervalJsCompilationTarget<Expression> | undefined;
  _getCompilationTarget(
    name: 'javascript'
  ): JavaScriptCompilationTarget<Expression> | undefined;
  _getCompilationTarget(name: string): LanguageTarget<Expression> | undefined;

  /** @internal Return the names of all registered compilation targets. */
  _listCompilationTargets(): string[];

  /** @internal Register a compilation target. */
  _registerCompilationTarget(
    name: string,
    target: LanguageTarget<Expression>
  ): void;

  /** @internal Remove a registered compilation target. */
  _unregisterCompilationTarget(name: string): void;

  /** @internal Fu trigonometric simplification algorithm */
  _fuAlgorithm(
    expr: Expression,
    options?: Record<string, unknown>
  ): RuleStep | undefined;

  number(
    value:
      | number
      | bigint
      | string
      | NumericValue
      | MathJsonNumberObject
      | BigNum
      | Complex
      | Rational,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): Expression;

  symbol(
    sym: string,
    options?: {
      canonical?: CanonicalOptions;
      metadata?: Metadata;
      autoDeclare?: boolean;
    }
  ): Expression;

  string(s: string, metadata?: Metadata): Expression;

  /**
   * Create a boxed character — one user-perceived character.
   *
   * `s` must be exactly one grapheme cluster after NFC normalization; use the
   * `CharacterFrom` operator when the content is not known to satisfy that, as
   * it reports a diagnostic instead.
   */
  character(s: string, metadata?: Metadata): Expression;

  error(message: string | string[], where?: string): Expression;

  typeError(
    expectedType: Type,
    actualType: undefined | Type | BoxedType,
    where?: ExpressionInput
  ): Expression;

  hold(expr: ExpressionInput): Expression;

  tuple(...elements: ReadonlyArray<number>): Expression;
  tuple(...elements: ReadonlyArray<Expression>): Expression;

  type(type: Type | TypeString | BoxedType): BoxedType;

  rules(
    rules:
      | Rule
      | ReadonlyArray<Rule | BoxedRule>
      | BoxedRuleSet
      | undefined
      | null,
    options?: {
      canonical?: boolean;
      /** Default purpose applied to any rule in the set that doesn't carry
       *  its own `purpose` tag (a per-rule tag takes precedence). */
      purpose?: RulePurpose;
    }
  ): BoxedRuleSet;

  getRuleSet(
    id?: 'harmonization' | 'solve-univariate' | 'standard-simplification'
  ): BoxedRuleSet | undefined;

  pushScope(scope?: Scope, name?: string): void;
  popScope(): void;

  createScope(
    bindings?: Record<string, Type | TypeString | BoxedDefinition>,
    parent?: Scope
  ): InspectableScope;

  /**
   *
   * When a new eval context is created, it has slots for the local variables
   * from the current lexical scope. It also copies the current set of
   * assumptions.
   *
   * Need a pointer to the current lexical scope (may have a scope chain without an evaluation context). Each lexical scope includes a pointer to the parent scope (it's a DAG).
   *
   * If a function is "scoped" (has a `scoped` flag), create a new lexical scope
   * when the function is canonicalized, store the scope with the function
   * definition (if the function has a lazy flag, and a canonical handler, it
   * can behave like a scoped function, but a scoped flag is convenient,
   * it would still evaluate the arguments).
   *
   * Note: if an expression is not canonical, evaluating it return itself.
   * This is important to support arguments that are just symbol names
   * (they are not canonicalized).
   *
   * When the function expression is evaluated, if it is "scoped", push the
   * scope associated with the function (maybe not?) and a matching eval
   * context, including all the symbols in the lexical scope (including
   * constants). Need some way to indicate that a symbol maps to an argument
   * (in value definition?).
   *
   * When searching the value of a symbol, start with the current
   * eval context, then the previous one.
   *
   * When looking for a definition, start with the lexical scope of the
   * current eval context, then the parent lexical context.
   *
   * @internal */
  _pushEvalContext(scope: Scope, name?: string): void;

  /** @internal */
  _popEvalContext(): void;

  /**
   * Remove one specific evaluation context, wherever it currently sits on the
   * stack — used by the asynchronous path, whose frame may not be on top by
   * the time it unwinds.
   * @internal */
  _removeEvalContext(context: EvalContext): void;

  /**
   * Temporarily sets the lexical scope to the provided scope, then
   * executes the function `f` in that scope and returns the result.
   * @internal */
  _inScope<T>(scope: Scope | undefined, f: () => T): T;

  /**
   * Execute `f` in a **resolve-only** region: while it runs, boxing a symbol
   * resolves the name against the scope chain as usual, but a name that
   * resolves to nothing stays UNBOUND instead of being auto-declared into the
   * current scope. Partial canonical forms (`canonical: ['Number']`) run this
   * way — their output is not fully canonical, so they follow the structural
   * symbol contract and write nothing to the caller's scope.
   * See `docs/plans/2026-08-04-parse-scope-control-design.md` A1.
   * @internal */
  _resolveOnly<T>(f: () => T): T;

  /** Depth of the enclosing {@link _resolveOnly} regions; auto-declaration is
   * suppressed while it is positive.
   * @internal */
  _resolveOnlyDepth: number;

  /**
   * Where `_infer()` routes the narrowings it performs while a parse/box runs
   * against a `createScope()` product. `undefined` — the normal case — is the
   * gate that keeps the capture off.
   * @internal */
  _narrowingSink: NarrowingSink | undefined;

  /**
   * For internal use. Use `ce.declare()` instead.
   * @internal */
  _declareSymbolValue(
    name: MathJsonSymbol,
    def: Partial<ValueDefinition>,
    scope?: Scope
  ): BoxedDefinition;

  /**
   * For internal use. Use `ce.declare()` instead.
   * @internal */
  _declareSymbolOperator(
    name: string,
    def: OperatorDefinition,
    scope?: Scope
  ): BoxedDefinition;

  /**
   * The symbol denoting `scope`'s OWN binding for `name` — how a binder's
   * variable (a `Function` parameter, a `Sum` index, `D`'s variable) is built.
   *
   * Unlike `symbol()`, which resolves a NAME through the scope chain and
   * short-circuits to the interned constant for `Pi`, `e`, `i`, ..., this reads
   * the scope's bindings map, which is the authority for what a binder binds.
   * `undefined` when the scope has no value binding for the name.
   * @internal */
  _bindingSymbol(name: MathJsonSymbol, scope: Scope): Expression | undefined;

  /**
   * Push a set of parameter names that, while canonicalizing a function body,
   * shadow any same-named constant (`i`, `e`, ...) so they resolve as ordinary
   * local variables. Balanced with `_popShadowedParameters`. Optional `types`
   * carry declared types for annotated parameters so the auto-declaration
   * during body canonicalization uses the declared (non-inferred) type.
   * @internal */
  _pushShadowedParameters(
    names: ReadonlyArray<string>,
    types?: ReadonlyMap<string, Type>
  ): void;
  /** @internal */
  _popShadowedParameters(): void;
  /** True if `name` is an active shadowed parameter (see above). @internal */
  _isShadowedParameter(name: string): boolean;
  /** The declared type of an active shadowed parameter, if any. @internal */
  _shadowedParameterType(name: string): Type | undefined;
  /** The scope enclosing the construct that shadows `name` — the scope a
   * function literal whose parameter is `name` is written in, or the scope
   * enclosing a `Block` that declares `name`. A resolution of `name` must stop
   * before reaching this scope: anything found at or above it belongs to the
   * enclosing context, which the parameter (or block local) shadows.
   * `undefined` when `name` is not an active shadowed parameter. @internal */
  _shadowedParameterBoundary(name: string): Scope | undefined;
  /** The binding already auto-declared for an active shadowed parameter during
   * the current body's canonicalization, if any. @internal */
  _shadowedParameterDef(name: string): BoxedDefinition | undefined;
  /** Cache the binding auto-declared for an active shadowed parameter so later
   * references reuse it. @internal */
  _setShadowedParameterDef(name: string, def: BoxedDefinition): void;
  /** The bindings cached on the TOP shadowed-parameter frame — read just
   * before popping it so a literal's parameter declarations can adopt the
   * binding the body's references accumulated type evidence on. @internal */
  _currentShadowedParameterDefs(): ReadonlyMap<string, BoxedDefinition>;

  /** Enter a user-function application, throwing a `CancellationError`
   * (`cause: 'recursion-depth-exceeded'`) when `recursionLimit` is exceeded.
   * Balanced with `_exitRecursion`. @internal */
  _enterRecursion(): void;
  /** Leave a user-function application. Balanced with `_enterRecursion`.
   * @internal */
  _exitRecursion(): void;

  /**
   * Use `ce.expr(id)` instead
   * @internal */
  _getSymbolValue(id: MathJsonSymbol): Expression | undefined;
  /**
   * Use `ce.assign(id, value)` instead.
   * @internal */
  _setSymbolValue(
    id: MathJsonSymbol,
    value: Expression | boolean | number | undefined
  ): void;

  /** A list of the function calls to the current evaluation context */
  trace: ReadonlyArray<string>;

  lookupDefinition(id: MathJsonSymbol): undefined | BoxedDefinition;

  assign(ids: { [id: MathJsonSymbol]: AssignValue }): IComputeEngine;
  assign(id: MathJsonSymbol, value: AssignValue): IComputeEngine;
  assign(
    arg1: MathJsonSymbol | { [id: MathJsonSymbol]: AssignValue },
    arg2?: AssignValue
  ): IComputeEngine;

  declareType(
    name: string,
    type: Type | TypeString | BoxedType,
    options?: {
      alias?: boolean;
      fromStatement?: boolean;
      mint?: boolean;
      typeParams?: TypeParamsOption;
    }
  ): void;

  declare(symbols: {
    [id: MathJsonSymbol]: Type | TypeString | Partial<SymbolDefinition>;
  }): IComputeEngine;
  declare(
    id: MathJsonSymbol,
    def: Type | TypeString | Partial<SymbolDefinition>,
    scope?: Scope
  ): IComputeEngine;
  declare(
    arg1:
      | MathJsonSymbol
      | {
          [id: MathJsonSymbol]: Type | TypeString | Partial<SymbolDefinition>;
        },
    arg2?: Type | TypeString | Partial<SymbolDefinition>,
    arg3?: Scope
  ): IComputeEngine;

  assume(predicate: Expression | string): AssumeResult;

  /**
   * Declare a sequence with a recurrence relation.
   *
   * @example
   * ```typescript
   * // Fibonacci sequence
   * ce.declareSequence('F', {
   *   base: { 0: 0, 1: 1 },
   *   recurrence: 'F_{n-1} + F_{n-2}',
   * });
   * ce.parse('F_{10}').evaluate();  // → 55
   * ```
   */
  declareSequence(name: string, def: SequenceDefinition): IComputeEngine;

  /**
   * Get the status of a sequence definition.
   *
   * @example
   * ```typescript
   * ce.parse('F_0 := 0').evaluate();
   * ce.getSequenceStatus('F');
   * // → { status: 'pending', hasBase: true, hasRecurrence: false, baseIndices: [0] }
   * ```
   */
  getSequenceStatus(name: string): SequenceStatus;

  /**
   * Get information about a defined sequence.
   * Returns `undefined` if the symbol is not a sequence.
   */
  getSequence(name: string): SequenceInfo | undefined;

  /**
   * List all defined sequences.
   * Returns an array of sequence names.
   */
  listSequences(): string[];

  /**
   * Check if a symbol is a defined sequence.
   */
  isSequence(name: string): boolean;

  /**
   * Clear the memoization cache for a sequence.
   * If no name is provided, clears caches for all sequences.
   */
  clearSequenceCache(name?: string): void;

  /**
   * Get the memoization cache for a sequence.
   * Returns a Map of index → value, or `undefined` if not a sequence or memoization is disabled.
   *
   * For single-index sequences, keys are numbers.
   * For multi-index sequences, keys are comma-separated strings (e.g., '5,2').
   */
  getSequenceCache(name: string): Map<number | string, Expression> | undefined;

  /**
   * Generate a list of sequence terms from start to end (inclusive).
   *
   * @param name - The sequence name
   * @param start - Starting index (inclusive)
   * @param end - Ending index (inclusive)
   * @param step - Step size (default: 1)
   * @returns Array of BoxedExpressions, or undefined if not a sequence
   *
   * @example
   * ```typescript
   * ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
   * ce.getSequenceTerms('F', 0, 10);
   * // → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
   * ```
   */
  getSequenceTerms(
    name: string,
    start: number,
    end: number,
    step?: number
  ): Expression[] | undefined;

  /**
   * Look up sequences in OEIS by their terms.
   *
   * @param terms - Array of sequence terms to search for
   * @param options - Optional configuration (timeout, maxResults)
   * @returns Promise resolving to array of matching sequences
   *
   * @example
   * ```typescript
   * const results = await ce.lookupOEIS([0, 1, 1, 2, 3, 5, 8, 13]);
   * // → [{ id: 'A000045', name: 'Fibonacci numbers', ... }]
   * ```
   */
  lookupOEIS(
    terms: (number | Expression)[],
    options?: OEISOptions
  ): Promise<OEISSequenceInfo[]>;

  /**
   * Check if a defined sequence matches an OEIS sequence.
   *
   * @param name - Name of the defined sequence
   * @param count - Number of terms to check (default: 10)
   * @param options - Optional configuration
   * @returns Promise with match results including OEIS matches and generated terms
   *
   * @example
   * ```typescript
   * ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
   * const result = await ce.checkSequenceOEIS('F', 10);
   * // → { matches: [{ id: 'A000045', name: 'Fibonacci numbers', ... }], terms: [0, 1, 1, ...] }
   * ```
   */
  checkSequenceOEIS(
    name: string,
    count?: number,
    options?: OEISOptions
  ): Promise<{ matches: OEISSequenceInfo[]; terms: number[] }>;

  /**
   * Interpret a notational expression, then propose OEIS-attributed closed
   * forms for it (the async v4 of the `Interpret` ladder).
   *
   * `result.expression` is exactly what the synchronous `Interpret` head
   * returns (a `Sum`/`Product`, or the input unchanged); `result.candidates`
   * are OEIS-attributed closed forms, each verified to reproduce every
   * extracted sample exactly. This is the only interpretation path that
   * performs a network lookup. Too few samples, being offline, a timeout, or an
   * empty result all yield an empty candidate list rather than a rejection.
   *
   * @param expr - The (typically inert, continuation-bearing) expression
   * @param options - OEIS request options (timeout, maxResults)
   *
   * @example
   * ```typescript
   * const { expression, candidates } = await ce.interpret(
   *   ce.parse('1 + 3 + 6 + 10 + \\cdots + n')
   * );
   * ```
   */
  interpret(expr: Expression, options?: OEISOptions): Promise<InterpretResult>;

  forget(symbol?: MathJsonSymbol | MathJsonSymbol[]): void;

  ask(pattern: Expression): BoxedSubstitution[];

  verify(query: Expression | string): boolean | undefined;

  /** @internal */
  _shouldContinueExecution(): boolean;

  /** @internal */
  _checkContinueExecution(): void;

  /** @internal */
  _cache<T>(name: string, build: () => T, purge?: (t: T) => T | undefined): T;

  /** @internal */
  _reset(): void;

  /** @internal */
  _listenToConfigurationChange(tracker: ConfigurationChangeListener): () => void;

  /**
   * Introspect a registered operator head.
   *
   * Returns `undefined` if no definition is registered in this engine.
   * Otherwise returns `{ kind, signature? }` where `kind` is `'function'`
   * when the operator has an `evaluate` or `collection` handler, and
   * `'opaque'` when it is declared as a typed-but-opaque node (e.g.,
   * `Triangle`, `Sphere`).
   *
   * Use this to classify heads encountered in parsed MathJSON without
   * maintaining a parallel list of "known" operators.
   */
  operatorInfo(head: string): OperatorInfo | undefined;

  /**
   * Convert a LaTeX identifier string to its canonical MathJSON name without
   * declaring the symbol in the engine scope.
   *
   * Examples:
   * - `'R_{3}'` → `'R_3'`
   * - `'\\theta_x'` → `'theta_x'`
   * - `'\\alpha'` → `'alpha'`
   * - `'1 + 2'` → `''` (not an identifier)
   *
   * Use this instead of `ce.parse(latex).symbol` when you need the canonical
   * name without the side-effect of auto-declaring the symbol.
   */
  normalizeIdentifier(latex: string): string;

  /**
   * Return introspection metadata for a symbol (value definition) in the
   * current scope chain.
   *
   * - `kind: 'constant'` when the symbol is a CE-registered constant
   *   (e.g. `Pi`, `True`, `ExponentialE`).
   * - `kind: 'variable'` for declared but non-constant value symbols
   *   (e.g. after `ce.declare('a', 'real')`).
   *
   * Returns `undefined` for unknown names and for names that resolve to
   * operator/function definitions (use `operatorInfo()` for those — the
   * two methods are non-overlapping).
   */
  symbolInfo(name: string): SymbolInfo | undefined;

  /**
   * Reverse library search: map plain-text concept keywords to a ranked list
   * of matching identifiers in the current scope chain (standard library plus
   * any user declarations).
   *
   * The query is a string (tokenized on whitespace) or an array of strings;
   * tokens are OR-ed — a definition matches when **any** token matches — and
   * definitions matching more tokens, or matching them more exactly, rank
   * higher.
   *
   * Every returned `id` resolves via `ce.lookupDefinition(id)`; chain that
   * call for full detail.
   */
  searchDefinitions(
    query: string | string[],
    options?: { limit?: number }
  ): DefinitionSearchResult[];

  /**
   * Given a `name` that is **not** a known operator, return the closest known
   * operator name — a "did you mean" suggestion — or `undefined` when nothing
   * is close enough. Powers the Epsil `unknown-function` diagnostic.
   *
   * Matching is conservative and applied in priority order (first match wins):
   * case-insensitive exact match, singular/plural, Damerau–Levenshtein
   * distance (≤ 2 for names of length ≥ 6, ≤ 1 for length 5, never for
   * shorter names), then a prefix match against exactly one operator. Ties
   * prefer the candidate sharing the longest prefix with the query.
   *
   * ```ts
   * ce.suggestOperatorName('Quartile'); // → 'Quartiles'
   * ce.suggestOperatorName('foo');      // → undefined
   * ```
   */
  suggestOperatorName(name: string): string | undefined;

  /**
   * Return the known analytic properties of an operator — poles, zeros, branch
   * points/cuts, residues, holomorphic/meromorphic domains — drawn from the
   * Fungrim-derived metadata store, or `undefined` if none are recorded.
   *
   * ```ts
   * ce.functionProperties('Gamma')?.poles?.toString(); // 'NonPositiveIntegers'
   * ```
   *
   * The set-valued accessors (`poles`, `zeros`, ...) return a boxed set for the
   * unconditional record of that kind; parametric / conditional records (e.g.
   * residues that depend on parameters) are available via `entries`.
   */
  functionProperties(name: string): FunctionProperties | undefined;

  /** Debug representation, e.g. for `JSON.stringify()`. */
  toJSON(): string;

  /** Print the evaluation-context stack to the console.
   * @internal */
  _printStack(options?: { details?: boolean; maxDepth?: number }): void;
}

declare module './types-expression.js' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ExpressionComputeEngine extends IComputeEngine {}
}

declare module './types-definitions.js' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ComputeEngine extends IComputeEngine {}
}
