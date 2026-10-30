import type {
  Expression,
  BoxedDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  IComputeEngine,
  Scope,
} from '../global-types';

import { isDictionary, isFunction, isObject, isSymbol } from './type-guards';
import { isValueDef, isOperatorDef } from './definition-guards';
import { bindingInContext } from './binders';
import { withAmbientChain } from './ambient-chain';
import { CACHE_STATS, recordCache } from '../../common/cache-stats';
import {
  accumulateObjectDeps,
  beginObjectDeps,
  endObjectDeps,
  mergeObjectDeps,
  objectDepsValid,
  type ObjectDeps,
} from './object-deps';
import { containsObject } from './object-walk';
import { subscriptEvaluateReads } from './transitive-purity';
import { sequenceReadStopCount } from './sequence-read-stops';
import { incompleteWalkCount } from './incomplete-walks';
import { uncachedHostCallCount } from './host-handler-changes';

/**
 * Element memoization for lazy collection operators (Tycho item 126).
 *
 * Generalizes the `Comprehension` element memo (Tycho items 23.1/38, in
 * `library/control-structures.ts`) to any lazy operator that evaluates a
 * function per element (`Map`, `Filter`, `Tabulate`, …). An operator opts in
 * with the `elementMemo` flag on its collection handlers; the memo itself is
 * applied at the single consumption seam, `BoxedFunction.each()`/`at()`, so
 * the operators' own iterator handlers stay untouched.
 *
 * Invalidation is DEPENDENCY-PRECISE (2026-08-02,
 * `docs/COLLECTIONS-MODEL.md`). Every
 * engine input that can change what an element evaluates to now bumps a
 * counter — including the configuration inputs (`tolerance` bumps directly,
 * `precision`/`angularUnit` through `_reset()`) — so the memo needs exactly
 * two axes and nothing else:
 *
 * - `ce._worldVersion` equality — the RARE global events for which no
 *   per-dependency tracking exists: `assume`/`forget` (and assumption-dirty
 *   scope pops), operator/type redefinition, signature inference, `_reset()`,
 *   and configuration changes. Deliberately NOT bumped by value writes, so an
 *   unrelated `assign()` (a per-frame slider tick, Tycho item 127) does not
 *   cold every memo in the engine.
 * - Per-dependency checks — value writes, including ephemeral index writes,
 *   which bump only the index definition's `_writeVersion`, so a memoized
 *   instance that references an ENCLOSING binder's index (nested in a `Sum`)
 *   still refills per iteration.
 *
 * Where the Comprehension memo resolves dependencies by name through the
 * instance's own lexical scope, the flagged operators are not scoped (a
 * canonical `Map` has no `localScope`), so dependencies are keyed off each
 * free symbol OCCURRENCE's own binding — which is exactly the resolution
 * evaluation follows for a canonical symbol. A shadowing declaration
 * elsewhere does not change what the occurrence's binding resolves to, so it
 * needs no invalidation; an `updateDef` swap shows through
 * `occurrence.valueDefinition` identity, and value/type writes through the
 * definition's `_writeVersion`.
 *
 * The memo deliberately applies to IMPURE element bodies too (ruling,
 * 2026-08-02, `docs/RANDOMNESS-MODEL.md` §6): repeated reads of one instance
 * are one draw set. Coherence holds between semantic mutations — the memo is
 * a cache, not a replay guarantee.
 */

interface ElementMemoDep {
  /** A canonical symbol occurrence inside the instance. Re-read at
   * validation time: `occurrence.valueDefinition` resolves through the
   * occurrence's binding wrapper, so an `updateDef` swap of the inner
   * definition is an identity change here. */
  occurrence: Expression;
  /** The dependency's name — a symbol's spelling, or the operator name of a
   * value-bound application head. Used for the ambient-resolution axis. */
  name: string;
  /** The inner value definition at fill time. `undefined` for an
   * OPERATOR-ONLY dependency (a walked user-lambda head with no value-def
   * side — see `resolvedOperator`), whose validity rests on the resolution
   * re-check alone. */
  valueDef?: BoxedValueDefinition;
  /** `valueDef._writeVersion` at fill time (absent with `valueDef`). */
  version?: number;
  /** The binding the instance's RESOLUTION scope chain resolved `name` to
   * at fill time (`undefined` when the chain has no such binding).
   * A non-constant symbol's VALUE is read by walking the scope chain for
   * the innermost binding of its name, skipping only a call frame's
   * parameter activation of some other binding (`bindingInContext`,
   * `binders.ts`) — not through the occurrence's pinned binding — so a
   * shadowing declaration changes what a walk reads while bumping no
   * counter and touching no tracked definition. Re-resolving the same way
   * at validation catches it, and a foreign activation — which the walk
   * skips — does not invalidate. Which chain matters: a SCOPED instance
   * (`Comprehension`) walks under its own captured `localScope`, so an
   * ambient shadow is invisible to it and must not invalidate (a spurious
   * refill re-draws an impure body); an unscoped instance (`Map`) resolves
   * through the ambient chain at walk time. See `depResolutionScope`. */
  resolved: BoxedDefinition | undefined;
  /**
   * This entry tracks the binding the walk's resolution chain resolves
   * `name` to, which is NOT the occurrence's own binding — a declaration in
   * a scope the instance is evaluated in that shadows the occurrence's
   * binding with a value of its own. The walk reads the shadow, so its write
   * version and stored value are dependencies too. Validated by resolution:
   * the chain must still resolve the name to this binding, and the binding
   * must be unwritten since.
   */
  shadow?: true;
  /** Set on an OPERATOR dependency — a walked user-lambda head, or a
   * FORWARD REFERENCE (the occurrence's pinned binding is a valueless
   * auto-declared value definition because the name was used before it was
   * defined, and the resolution chain heals it to an operator definition).
   * This is that operator definition: the INNER object of the resolved
   * tagged wrapper. Identity is compared at validation instead of the outer
   * wrapper's: `BoxedDefinition` wrappers are mutated IN PLACE on
   * redefinition (that is the tagged-literal design's stated purpose), so
   * an `assign('f', 5)` that swaps the wrapper's operator side for a value
   * leaves the outer identity intact while this inner identity changes —
   * and that kind swap advances NO version axis (`redefine
   * {callableAfter: false}` is zero-mask), so the identity comparison is
   * the ONLY thing that catches it. A same-kind redefinition is covered by
   * the `worldVersion` axis (`redefine {callableAfter: true}` advances
   * `world`). */
  resolvedOperator?: BoxedOperatorDefinition;
  /**
   * Set on a BINDING-SITE dependency, recorded only for a snapshot taken
   * with `bindingSites` (see `snapshotMemoDeps`). The occurrence is a
   * variable bound inside the instance: a parameter of a `Function` literal,
   * the index of a binder, or a parameter of a user function whose body the
   * walk reads. A value memo does not depend on such a variable, because the
   * evaluation installs its value. A TYPE read does: `BoxedSymbol.sgn` reads
   * the value of the variable by name through the current scope chain
   * (`bindingInContext`), and the type of the instance is derived without
   * the scope of the node that binds the variable. Inside a call frame
   * whose parameter has the same name, that read finds the parameter's
   * value: the type of `Map(x ↦ √x, [1, 2])` is `vector<real^2>` inside a
   * call `f(1)` with the parameter `x`, and `vector<complex^2>` outside.
   * This is the definition of the occurrence; validated by resolving the
   * name again from the current scope, which must give the same binding.
   */
  site?: BoxedValueDefinition;
  /** `site._writeVersion` at fill time, on a binding-site dependency. A type
   * read also reads the definition of the occurrence itself (`BoxedSymbol`
   * reads its type there, and a function literal derives its result type
   * from the type of its body), so a write of that definition (a retyped
   * parameter, an inference that narrows it, a loop-index write) changes
   * the type of the instance. */
  siteVersion?: number;
  /** `resolvedOperator._writeVersion` at fill time, recorded only for a
   * snapshot taken with `bindingSites`. A write of the signature of an
   * operator (the public `signature` setter, which any operator definition
   * has, a library one included) changes the type of each application of
   * that operator, and advances only this counter of the definition and the
   * `any` cache axis, which a type memo keyed on the dependencies does not
   * read. */
  operatorVersion?: number;
}

interface ElementMemoCache {
  /** `ce._worldVersion` snapshot taken AFTER the fill, so any bump the walk
   * itself causes is absorbed. Covers the rare global events AND every
   * engine-configuration input (tolerance/precision/angular unit), which is
   * why no separate configuration stamps are kept. */
  worldVersion: number;
  /** Whether the assumptions were hidden (`ce._factsHidden()`) while
   * the elements were computed. A walk evaluates elements, and an element can
   * be shaped by an assumed value or by a symbol's effective type, so the same
   * instance has two element lists and an entry may only be served to a read
   * on the same side of a fact-blind bracket
   * (`docs/plans/2026-08-30-assumptions-memo-inventory.md`). A boolean rather
   * than a bit in `worldVersion`, because a suppression window moves no
   * axis. */
  factsHidden: boolean;
  deps: ElementMemoDep[];
  /** True when `elements` is the whole collection. `each()` serves only
   * complete entries; `at()`/`elementMemoFillTo` serve any covering prefix.
   * Partial entries are written by the fill-to-n path (`Comprehension`) and
   * by a recording walk that was abandoned or overflowed the cap. */
  complete: boolean;
  elements: Expression[];
  /** Elements computed one at a time by `at()` reads of a PURE instance,
   * keyed by their 1-based position, for the positions that `elements`
   * does not cover (`elementMemoComputeCell`). A view that reads its source
   * by position (`At(xs, I)`, `Zip(xs, …)`) reads each element of the
   * source through `at()`, and a chain of such views over one another read
   * each inner element again for every outer element: the cost grew by a
   * factor of about 40 for each level of the chain (CE-516). */
  cells?: Map<number, Expression>;
  /** The mutable objects whose FIELDS the walk read, with their versions at
   * read time (`object-deps.ts`). A store bumps no engine version and moves no
   * symbol dependency, so an element computed from `p.age` would otherwise be
   * served forever; these stamps are what invalidate it. Objects reached as
   * operands are refused outright by `snapshotDeps` — this covers the other
   * route, where the walk reaches one through a symbol's stored value. */
  objectDeps?: ObjectDeps;
}

/** Keyed on the boxed instance. A `WeakMap` so an unreferenced collection
 * (and its cached elements) is collectable. */
const elementMemoCaches = new WeakMap<Expression, ElementMemoCache>();

/** `CE_DEBUG_DEPS`: log why `snapshotDeps` declares an instance ineligible
 * (which gate, which name). A diagnosis aid for "this instance never
 * memoizes" investigations — the facet-probe storm of Tycho item 182 was
 * root-caused with it. Env-gated like `CE_DEBUG_BINDINGS`; read once at
 * module load. */
const DEBUG_DEPS: boolean =
  typeof process !== 'undefined' &&
  process.env?.CE_DEBUG_DEPS !== undefined &&
  process.env.CE_DEBUG_DEPS !== '0';

/**
 * Debug canary (design §3): under `CE_MEMO_PARANOID=1`, the `each()` seam
 * cross-checks every served complete cache against a live re-walk (pure
 * bodies only) and `console.assert`s on divergence — a dependency-closure
 * leak that precise invalidation would otherwise convert into a silent
 * stale serve. Environment-gated like `CE_DEBUG_BINDINGS`; a testing aid,
 * not a semantic mode.
 */
export function elementMemoParanoid(): boolean {
  return (
    !paranoidCheckActive &&
    typeof process !== 'undefined' &&
    process.env?.CE_MEMO_PARANOID !== undefined &&
    process.env.CE_MEMO_PARANOID !== '0'
  );
}

/** Re-entrancy latch for the canary. The cross-check's own work can reach
 * `each()` again — an element body reading another memoized collection, or
 * anything that serializes the instance (`toString()` MATERIALIZES a
 * collection to render it) — and a canary-within-a-canary recurses
 * exponentially. While a check is running, `elementMemoParanoid()` reports
 * false. */
let paranoidCheckActive = false;

/** Begin a canary cross-check; returns false when one is already active
 * (caller must then skip). Pair with `exitParanoidCheck` in a `finally`. */
export function enterParanoidCheck(): boolean {
  if (paranoidCheckActive) return false;
  paranoidCheckActive = true;
  return true;
}

export function exitParanoidCheck(): void {
  paranoidCheckActive = false;
}

/**
 * Cap the memoized prefix: beyond this many elements the walk stops
 * buffering and never commits, so an enormous finite domain cannot pin an
 * arbitrarily large array in memory.
 */
export const ELEMENT_MEMO_CAP = 100_000;

/**
 * The value definitions a node BINDS for the walk: the parameter sites of a
 * `Function` literal, and the binding sites a BINDER operator declares (a
 * `Comprehension`'s indices, a `Series`' expansion variable — the
 * operator's own `bindingSites` selector is the authority). These are the
 * walk's own machinery, not dependencies: a parameter is supplied by the
 * walk itself (an activation copy in a fresh call scope), and a binder's
 * index is written during the walk and RESTORED to valueless afterwards
 * (`ComprehensionIndexFrame` save→install→restore). Tracking one would
 * either churn or trip the valueless-binding gate, which would mark every
 * lambda-bearing instance ineligible.
 *
 * Deliberately NOT included: the local bindings of scoped subexpressions. A
 * nested `Sum`'s index definition holds the value its last iteration wrote,
 * so it self-stabilizes as an ordinary dep (only this instance's own walks
 * write it); and an AUTO-DECLARED unknown living in the same scope (a free
 * symbol the body references but nothing has assigned) must stay visible to
 * the valueless-binding gate — a later `assign` of that name installs a
 * value in a different definition, which no version or counter tracks.
 *
 * The exclusion these definitions receive is POSITIONAL: it holds only
 * while the walk is inside the node that binds them (see `visit`). The same
 * static binding can occur elsewhere in the tree and mean something else
 * there. A call substitutes each parameter's value into its result
 * (`bindingKeyedSubs`, `function-utils.ts`), and a closure copy made by
 * `captureClosures` keeps the template's parameter operands, so a `Fold`
 * whose step returns a lazy `Map` over its own state embeds, in each step's
 * literal, the previous step's copy of the SAME `Map` lambda. The free `i`
 * in the step body and the parameter `i` of that embedded copy carry one
 * binding: inside the copy it is the copy's parameter; outside it, it
 * denotes the enclosing call's activation — a dependency that changes with
 * every element of the `Map`. Excluding it for the whole tree let the
 * application memo serve one element's result for all of them (issue #438,
 * `test/compute-engine/review-collection-regressions.test.ts`).
 */
function boundDefsOf(expr: Expression): BoxedValueDefinition[] {
  const out: BoxedValueDefinition[] = [];
  if (!isFunction(expr)) return out;
  if (expr.operator === 'Function') {
    for (let i = 1; i < expr.nops; i++) {
      const op = expr.ops[i];
      const site = isFunction(op, 'Typed') ? op.op1 : op;
      if (isSymbol(site) && site.valueDefinition !== undefined)
        out.push(site.valueDefinition);
    }
    return out;
  }
  const sites = expr.operatorDefinition?.bindingSites?.(expr.ops, 'post');
  if (sites)
    for (const s of sites) {
      let node: Expression | undefined = expr;
      for (const p of s.path) node = isFunction(node) ? node.ops[p] : undefined;
      if (isSymbol(node) && node.valueDefinition !== undefined)
        out.push(node.valueDefinition);
    }
  return out;
}

/**
 * The scope chain an instance's WALK resolves free names through. A scoped
 * instance (`Comprehension`) pushes its own captured `localScope` around
 * every element (`ComprehensionIndexFrame`), so its resolution environment
 * is that chain — stable across callers, blind to ambient shadows. An
 * unscoped instance (`Map` — a canonical `Map` carries no scope of its own)
 * resolves through whatever chain is current at walk time, i.e. the ambient
 * one, signalled here by `undefined`.
 */
function depResolutionScope(expr: Expression): Scope | undefined {
  return isFunction(expr) && expr.isScoped ? expr.localScope : undefined;
}

/**
 * Run `fn` with a scoped instance's `localScope` chained onto the ambient
 * scope the way its walk chains it (`withAmbientChain`): a comprehension
 * evaluated in a child scope that shadows one of its free names reads the
 * child's binding, so its dependencies must be snapshotted and re-checked
 * through that same chain, or a count computed under one scope is served
 * under another.
 */
function underWalkChain<T>(expr: Expression, fn: () => T): T {
  return withAmbientChain(
    expr.engine.context?.lexicalScope,
    depResolutionScope(expr),
    fn
  );
}

/** The binding `scope`'s chain — or, when `scope` is `undefined`, the
 * engine's CURRENT chain — resolves `name` to; the same resolution
 * `_getSymbolValue` performs for a non-constant symbol's value. Inline
 * chain walk (importing `lookup` from `function-utils` would cycle). */
function resolveDepBinding(
  ce: IComputeEngine,
  scope: Scope | undefined,
  name: string,
  own?: BoxedValueDefinition
): BoxedDefinition | undefined {
  // A SYMBOL occurrence's value dependency resolves the way the evaluator
  // reads that occurrence's value (see `ElementMemoDep.resolved`); an
  // application head — a walked user-lambda operator, or a value-bound
  // head — is looked up by name, as applications are.
  if (own !== undefined)
    return bindingInContext(ce, name, own, scope ?? ce.context?.lexicalScope);
  let s: Scope | undefined = scope ?? ce.context?.lexicalScope;
  while (s) {
    const def = s.bindings.get(name);
    if (def) return def;
    s = s.parent ?? undefined;
  }
  return undefined;
}

/**
 * Snapshot the instance's dependencies: one entry per distinct value
 * definition (version-tracked via `_writeVersion`), plus one per walked
 * user-lambda operator head. Operator entries exist because the world axis
 * covers only SAME-KIND operator redefinitions — an operator→scalar kind
 * swap emits the zero-mask `redefine {callableAfter: false}` and advances
 * no version at all, so it is caught by re-resolving the name and comparing
 * the inner operator-definition identity instead (see
 * `ElementMemoDep.resolvedOperator`).
 *
 * Returns `undefined` when the instance is ineligible for memoization: a
 * symbol occurrence with no binding at all resolves dynamically through the
 * ambient context at walk time, which a per-instance cache cannot track.
 */
function snapshotDeps(
  expr: Expression,
  rawOperands = false,
  bindingSites = false
): ElementMemoDep[] | undefined {
  return underWalkChain(expr, () =>
    snapshotDepsUnderChain(expr, rawOperands, bindingSites)
  );
}

/**
 * `rawOperands`: whether a DIRECT operand of `expr` that is a raw symbol —
 * a callback written as a bare name, `Filter(xs, isEven)` — is recorded as a
 * dependency on what the name resolves to, instead of making the instance
 * ineligible. Only the element memo asks for it: the instance it snapshots
 * is the lazy collection itself, whose walk resolves such an operand by name
 * through the scope chain at each application. The other memos that share
 * this snapshot keep the ineligibility. For a sequence's terms, a
 * function's applications and a symbol's stored value, the snapshotted
 * expression is not a lazy instance, and a raw symbol in it is not resolved
 * by a walk: when every snapshot resolved raw operands, the term memo of a
 * sequence served an outdated term. The collection-facet memo
 * (`BoxedFunction._memoizedFacet`) does snapshot the lazy instance itself,
 * and could opt in on the same terms; it stays conservative on purpose: its
 * reads of such an instance go through `each()`, which the element memo
 * already serves, so the facet of a named-callback instance costs one
 * served walk, and the opt-in is kept to the one memo that was measured.
 */
function snapshotDepsUnderChain(
  expr: Expression,
  rawOperands: boolean,
  bindingSites: boolean
): ElementMemoDep[] | undefined {
  const ce = expr.engine;
  const depScope = depResolutionScope(expr);
  /** The bindings of the nodes the walk is currently inside (see
   * `boundDefsOf`): a parameter site of an enclosing literal, or an
   * enclosing binder's index. Entered and left with the node in `visit`. */
  let excluded = new Set<BoxedValueDefinition>();
  /** Walk an independently defined expression — a stored value, a user
   * operator's lambda body, a sequence handler's registered read — with NO
   * positional exclusion inherited from the occurrence that reached it: the
   * bindings of the literals and binders around that occurrence in the
   * instance tree do not enclose the expression, which is evaluated in its
   * own environment, so a binding of theirs occurring in it is a dependency
   * there. The expression's own literals and binders exclude their bindings
   * as usual, while the walk is inside them. */
  const visitAcrossDefinitionBoundary = (
    e: Expression,
    skipNames?: ReadonlySet<string>
  ): void => {
    const saved = excluded;
    excluded = new Set();
    try {
      visit(e, skipNames);
    } finally {
      excluded = saved;
    }
  };

  const seen = new Set<BoxedValueDefinition>();
  /** User-defined operator heads whose lambda body was already walked —
   * terminates self- and mutually-recursive function definitions. */
  const seenOperators = new Set<object>();
  /** NAMES for which an operator dependency entry was already recorded.
   * Recording is deduplicated per NAME, not per operator object: two names
   * can be bound to the same operator definition, and rebinding whichever
   * name happened to be encountered second must still invalidate — the
   * `seenOperators` dedup above is about traversal cost only. */
  const seenOperatorNames = new Set<string>();
  /** The `subscriptEvaluate` handlers whose registered reads were already
   * walked — terminates a sequence whose recurrence reads the sequence, or
   * two sequences that read each other. */
  const seenHandlers = new Set<object>();
  const deps: ElementMemoDep[] = [];
  let eligible = true;

  /** The variables already recorded by `visitBindingSite`. */
  const seenSites = new Set<BoxedValueDefinition>();
  /** With `bindingSites`, record what the name of the bound variable
   * `occurrence` resolves to from the current scope (see
   * `ElementMemoDep.site`). When the name resolves to another binding that
   * holds a value, a read of the variable by name sees that value, and no
   * stamp of this snapshot follows it: the instance is ineligible. A
   * valueless other binding is recorded with its write version, since an
   * assignment to it gives the read a value. */
  const visitBindingSite = (occurrence: Expression): void => {
    if (!bindingSites || !isSymbol(occurrence)) return;
    const own = occurrence.valueDefinition;
    if (own === undefined) {
      eligible = false;
      return;
    }
    if (seenSites.has(own)) return;
    seenSites.add(own);
    const name = occurrence.symbol;
    const resolved = resolveDepBinding(ce, undefined, name, own);
    const other =
      isValueDef(resolved) && resolved.value !== own
        ? resolved.value
        : undefined;
    if (other !== undefined && other.value !== undefined) {
      if (DEBUG_DEPS)
        console.log(`[deps] ineligible: bound '${name}' reads a value`);
      eligible = false;
      return;
    }
    deps.push({
      occurrence,
      name,
      site: own,
      siteVersion: own._writeVersion,
      resolved,
      ...(other !== undefined
        ? { valueDef: other, version: other._writeVersion }
        : {}),
    });
  };

  /** Walk a USER-DEFINED operator's lambda body for transitive
   * dependencies, recording the operator itself as a dependency (shared by
   * the applied-head branch of `visit` and the forward-reference heal;
   * `recordDep: false` when the caller records its own entry for this
   * occurrence). The dep entry is what catches an operator→scalar KIND
   * SWAP: `redefine {callableAfter: false}` is a zero-mask event — it
   * advances NEITHER `worldVersion` nor any tracked `_writeVersion` — so
   * "redefinition always bumps the world axis" holds only for same-kind
   * redefinitions, and without the entry a memo kept serving a walked
   * lambda after `assign('f', 5)` replaced it with a scalar. Validation
   * re-resolves the name and compares the INNER operator identity (see
   * `ElementMemoDep.resolvedOperator`).
   * The body's free names are resolved against the INSTANCE's chain, like
   * every other occurrence: closures re-root at evaluation
   * (`captureClosures`), so that is the chain the walk actually reads —
   * see the resolution note on `visitValueDef`. */
  const visitLambdaBody = (
    occurrence: Expression,
    name: string,
    opDef: NonNullable<Expression['operatorDefinition']>,
    recordDep: boolean
  ): void => {
    const lambda = opDef.lambda;
    // A snapshot for a type read records every operator the instance
    // applies, with or without a lambda, with its write version (see
    // `ElementMemoDep.operatorVersion`). A value memo records only the
    // operators with a lambda.
    if (lambda === undefined && !bindingSites) return;
    if (recordDep && !seenOperatorNames.has(name)) {
      seenOperatorNames.add(name);
      deps.push({
        occurrence,
        name,
        resolved: resolveDepBinding(ce, depScope, name),
        resolvedOperator: opDef,
        ...(bindingSites ? { operatorVersion: opDef._writeVersion } : {}),
      });
    }
    if (lambda === undefined) return;
    if (seenOperators.has(opDef)) return;
    seenOperators.add(opDef);
    // A nested literal inside this body excludes its own parameters while
    // the walk is inside it (`visit`), so a helper that builds its own lazy
    // collection is not disqualified by the valueless gate seeing an inner
    // literal's parameter binding.
    // DEFINITION BOUNDARY (see the stored-value branch): the skip set
    // is built FRESH from this lambda's OWN parameters — never seeded
    // from the caller's, whose spellings mean something else in this
    // definition's environment.
    const bodySkip = new Set<string>();
    for (const p of lambda.parameters) bodySkip.add(p.name);
    visitAcrossDefinitionBoundary(lambda.body, bodySkip);
  };

  /** Record a value-definition dependency reached through `occurrence`
   * (a symbol operand, or an application whose head is value-bound). */
  const visitValueDef = (
    occurrence: Expression,
    valueDef: BoxedValueDefinition,
    /** `valueDef` is the binding the walk chain resolves the occurrence's
     * name to, not the occurrence's own (see `ElementMemoDep.shadow`). */
    viaChain = false
  ): void => {
    const name = isSymbol(occurrence) ? occurrence.symbol : occurrence.operator;
    // A valueless, non-constant binding needs the resolution chain's
    // testimony before it is trackable. Resolution here is deliberately the
    // INSTANCE's chain even for an occurrence deep inside a walked lambda
    // body: closures re-root at evaluation (`captureClosures`), so a body's
    // free names resolve through the chain current at WALK time, not
    // through the canonicalization-time body scope — a dependency recorded
    // against the body's own chain would keep validating while an ambient
    // `assign` changed what the walk computes (measured: the Map
    // auto-compile re-enable test served a stale symbolic drain). Three
    // cases:
    if (valueDef.value === undefined && !valueDef.isConstant) {
      const resolved = resolveDepBinding(
        ce,
        depScope,
        name,
        isSymbol(occurrence) ? valueDef : undefined
      );
      // (1) FORWARD-REFERENCE HEAL: the occurrence pinned a valueless
      // auto-declared value binding (the name was used before it was
      // defined — `R := M ↦ R_xz(…)` parsed before `assign('R_xz', …)`),
      // and the chain now resolves the name to an OPERATOR definition. The
      // walk reads the name BY CHAIN, so the operator definition is the
      // real dependency, and it is trackable: a same-kind redefinition
      // bumps `worldVersion`, a kind swap or rebinding changes the inner
      // identity recorded in `resolvedOperator`, and the pinned valueless
      // binding is never written through (writes go by name to the chain
      // target). Its lambda body carries transitive symbol dependencies
      // exactly like an applied user-operator head, so walk it.
      if (isOperatorDef(resolved)) {
        seen.add(valueDef);
        // This entry carries the name's resolution, so the per-name
        // operator-dep dedup in `visitLambdaBody` must not add another.
        seenOperatorNames.add(name);
        deps.push({
          occurrence,
          name,
          valueDef,
          version: valueDef._writeVersion,
          resolved,
          resolvedOperator: resolved.operator,
          ...(bindingSites
            ? { operatorVersion: resolved.operator._writeVersion }
            : {}),
        });
        visitLambdaBody(occurrence, name, resolved.operator, false);
        return;
      }
      // (2) The chain resolves the name to NOTHING — an auto-declared free
      // of a lambda body (`R_xz`'s `c`), or any symbol used before any
      // reachable declaration. Trackable with `resolved: undefined`: the
      // walk currently reads the name as unbound, and the one event that
      // changes that — a binding for the name becoming reachable
      // (`assign`/`declare` at any level of the chain) — flips the
      // re-resolution from `undefined` to that binding and invalidates.
      // (This replaces the blanket ineligibility that made every
      // lambda-body free permanently uncacheable.)
      if (resolved === undefined) {
        seen.add(valueDef);
        deps.push({
          occurrence,
          name,
          valueDef,
          version: valueDef._writeVersion,
          resolved: undefined,
        });
        return;
      }
      // (3) The chain resolves to a DIFFERENT value binding than the pinned
      // one: `assign` would write the chain target while the occurrence keeps
      // reading its pinned def (or vice versa — which one the walk consults
      // depends on constness and route), so neither version stream alone is
      // trustworthy.
      //
      // That is an argument for tracking BOTH, not for giving up: a write to
      // either binding must invalidate, and recording two deps says exactly
      // that. Over-invalidation is safe here (it costs a refill), whereas
      // declaring the instance ineligible costs the memo entirely — measured
      // at 47,439 declines on ONE canonicalization of Tycho's item-186
      // witness, all of them this branch on a single lambda-body free, each
      // one re-running `scanIndependentClauses` and re-constructing broadcast
      // lambdas (Tycho item 186; the 182 storm's shape through the element
      // memo).
      //
      // Only when the chain target is itself a VALUE binding: its inner
      // definition carries the `_writeVersion` that makes the second stream
      // checkable. A chain target that is not a value binding leaves nothing
      // to compare, so that stays ineligible.
      if (isValueDef(resolved) && resolved.value !== valueDef) {
        seen.add(valueDef);
        // Stream 1 — the occurrence's PINNED binding.
        deps.push({
          occurrence,
          name,
          valueDef,
          version: valueDef._writeVersion,
          resolved,
        });
        // Stream 2 — the binding the chain actually resolves the name to.
        if (!seen.has(resolved.value))
          visitValueDef(occurrence, resolved.value, true);
        return;
      }
      if (!isValueDef(resolved)) {
        if (DEBUG_DEPS)
          console.log(
            `[deps] ineligible: valueless '${name}' not chain-resolved`
          );
        eligible = false;
        return;
      }
    }
    seen.add(valueDef);
    const chainResolved = resolveDepBinding(
      ce,
      depScope,
      name,
      isSymbol(occurrence) ? valueDef : undefined
    );
    deps.push({
      occurrence,
      name,
      valueDef,
      version: valueDef._writeVersion,
      resolved: chainResolved,
      ...(viaChain ? { shadow: true as const } : {}),
    });
    // The chain resolves the name to a DIFFERENT value binding than the
    // occurrence's own — a shadowing declaration in the scope the instance
    // is evaluated in (`withAmbientChain`). The walk reads that binding, so
    // it is a dependency of its own: its write version, and the free
    // symbols of its stored value.
    if (
      !viaChain &&
      isValueDef(chainResolved) &&
      chainResolved.value !== valueDef &&
      !seen.has(chainResolved.value)
    )
      visitValueDef(occurrence, chainResolved.value, true);
    // TRANSITIVE dependencies: a symbol bound by reference to a stored
    // value (a helper function literal, a bound list) pulls that value's
    // own free symbols into the instance's meaning — `Map(f, xs)` with
    // `f(x) = x + q` depends on `q`, which appears nowhere in the tree.
    // No global counter tracks a reassignment of `q` (a plain value write
    // never bumps `_worldVersion`; the DECLARE path a never-declared `q`
    // takes bumps nothing relevant either), so the value must be walked.
    // The `seen` set terminates self- and mutually-recursive definitions.
    const stored = valueDef.value;
    if (stored !== undefined) {
      // A stored value that is IMPURE to evaluate (`r := Random()`, which
      // draws again at each read of `r`) has a different value at each
      // read. No stamp of the definition can express that (a read writes
      // nothing), so an instance that reads such a symbol is not
      // memoizable: a memoized `f(1)`, with `f(x) := x + r`, would answer a
      // second `f(1)` of the same seeded frame with the first draw, where a
      // second evaluation draws again. A stored function literal is pure to
      // evaluate (applying it is another matter, and the walk of its body
      // below finds what it reads), so a helper function is not affected.
      if (!stored.isPure) {
        if (DEBUG_DEPS)
          console.log(`[deps] ineligible: '${name}' holds an impure value`);
        eligible = false;
        return;
      }
      // DEFINITION BOUNDARY: a stored value is an independently defined
      // expression that resolves names in ITS OWN environment — the
      // caller's parameter names must NOT be inherited, or a helper reading
      // a global that happens to share a caller-parameter's spelling would
      // have that dependency silently dropped (a stale serve under
      // epoch-only validation). The stored literal's own parameters are
      // excluded by `visit` while the walk is inside that literal, so no
      // name skips are needed here.
      visitAcrossDefinitionBoundary(stored, undefined);
    }
  };

  /** `skipNames` are the parameter names of the lambda bodies enclosing this
   * walk position: their occurrences bind to valueless body-scope
   * definitions that the valueless gate must not see. Scoped to the walk —
   * a same-named symbol elsewhere in the instance is still tracked. */
  /** Function nodes already walked, per skip set: a subtree reached through
   * several operands (a value that shares its operands — a user function
   * applied to its own previous result) records the same dependencies each
   * time, so it is walked once per skip set rather than once per path, which
   * is what keeps this walk linear in the number of distinct nodes instead of
   * exponential in the nesting depth. Keyed on the skip set's IDENTITY: one
   * set is carried through a whole lambda body, and `undefined` is the
   * instance's own tree.
   *
   * The value is the set of bindings that were EXCLUDED when the node was
   * walked (see `boundDefsOf`): every dependency of the subtree outside that
   * set is recorded. A second visit under an exclusion set that covers the
   * recorded one has nothing to add and is skipped. A second visit under a
   * smaller set — the same node reached inside a literal that binds `i` and
   * then outside it, where `i` is a dependency — walks the subtree again,
   * and the recorded set shrinks to the intersection, which is the set
   * outside of which every dependency is now recorded. The empty set is
   * shared, not copied: most nodes are walked under no exclusion at all. */
  const visited = new Map<Expression, Map<object, Set<BoxedValueDefinition>>>();
  const NO_SKIP = {};
  const NO_EXCLUSION: Set<BoxedValueDefinition> = new Set();
  const visit = (e: Expression, skipNames?: ReadonlySet<string>): void => {
    if (!eligible) return;
    if (isFunction(e)) {
      const skipKey: object = skipNames ?? NO_SKIP;
      let under = visited.get(e);
      if (under === undefined) {
        under = new Map();
        visited.set(e, under);
      }
      const walkedUnder = under.get(skipKey);
      if (walkedUnder !== undefined) {
        let covered = true;
        for (const def of walkedUnder)
          if (!excluded.has(def)) {
            covered = false;
            break;
          }
        if (covered) return;
        for (const def of walkedUnder)
          if (!excluded.has(def)) walkedUnder.delete(def);
      } else
        under.set(
          skipKey,
          excluded.size === 0 ? NO_EXCLUSION : new Set(excluded)
        );
    }
    if (isSymbol(e)) {
      if (skipNames?.has(e.symbol)) {
        visitBindingSite(e);
        return;
      }
      const valueDef = e.valueDefinition;
      if (valueDef !== undefined) {
        if (excluded.has(valueDef)) {
          visitBindingSite(e);
          return;
        }
        if (seen.has(valueDef)) return;
        visitValueDef(e, valueDef);
        // A symbol with a `subscriptEvaluate` handler, such as a sequence
        // `B` with `B_n = B_{n−1} + x`: `B_k` evaluates the expressions that
        // the handler registered (its recurrence, base values and
        // constraints), and the symbols that they read (`x`) are not in the
        // instance. Walk them as a stored value is walked: each is an
        // independent definition, so no parameter name of the caller is
        // skipped. A handler that registered nothing adds no dependency.
        const handler = valueDef.subscriptEvaluate;
        if (handler !== undefined && !seenHandlers.has(handler)) {
          seenHandlers.add(handler);
          for (const read of subscriptEvaluateReads(handler) ?? []) {
            if (read === undefined || read === null) continue;
            visitAcrossDefinitionBoundary(read, undefined);
          }
        }
      } else if (e.operatorDefinition !== undefined) {
        visitLambdaBody(e, e.symbol, e.operatorDefinition, true);
      } else if (e.isCanonical === false) {
        // Declared callbacks are canonical and tracked through their binding
        // above. An unresolved raw callback name can acquire a declaration
        // later, so its current resolution is a dependency too. Track a
        // resolved operator and its body, or the variable holding a literal;
        // an unresolved name keeps the instance ineligible for caching.
        // Only direct operands of the element memo use this compatibility
        // path. Raw symbols nested in other expressions stay ineligible.
        const resolved =
          rawOperands && isFunction(expr) && expr.ops.includes(e)
            ? resolveDepBinding(ce, depScope, e.symbol)
            : undefined;
        if (isOperatorDef(resolved)) {
          const name = e.symbol;
          if (!seenOperatorNames.has(name)) {
            seenOperatorNames.add(name);
            deps.push({
              occurrence: e,
              name,
              resolved,
              resolvedOperator: resolved.operator,
            });
          }
          visitLambdaBody(e, name, resolved.operator, false);
          return;
        }
        if (isValueDef(resolved)) {
          if (!excluded.has(resolved.value) && !seen.has(resolved.value))
            visitValueDef(e, resolved.value, true);
          return;
        }
        if (DEBUG_DEPS)
          console.log(`[deps] ineligible: unbound symbol '${e.symbol}'`);
        eligible = false;
      }
      return;
    }
    // A dictionary's entries are not walked here; a symbol dependency hiding
    // in one would go untracked, so a dictionary operand is conservatively
    // ineligible rather than silently under-keyed.
    if (isDictionary(e)) {
      if (DEBUG_DEPS) console.log('[deps] ineligible: dictionary operand');
      eligible = false;
      return;
    }
    // An OBJECT is mutable and identity-bearing: a memoized element derived
    // from one would be served after a store changed the field it read, and
    // the memo entry would keep the object alive for the engine's lifetime.
    // Neither the epoch key nor the symbol-dependency walk can express "this
    // object at this version", so an object operand is refused outright.
    if (isObject(e)) {
      if (DEBUG_DEPS) console.log('[deps] ineligible: object operand');
      eligible = false;
      return;
    }
    if (!isFunction(e)) return;
    // The bindings this node declares — a literal's parameters, a binder's
    // indices — are excluded for the walk of ITS subtree only, and released
    // when the walk leaves it: the same binding outside this node is a
    // dependency (see `boundDefsOf`). A binding an enclosing node already
    // excluded stays excluded after this one is left.
    const entered: BoxedValueDefinition[] = [];
    for (const def of boundDefsOf(e))
      if (!excluded.has(def)) {
        excluded.add(def);
        entered.push(def);
      }
    try {
      // An application whose HEAD is a symbol bound to a value definition
      // (`Map(f, xs)` applied with `f` a stored literal) reaches that
      // binding through operator position, where no symbol operand appears —
      // track it like a symbol dependency.
      const headDef = e.valueDefinition;
      if (headDef !== undefined && !excluded.has(headDef) && !seen.has(headDef))
        visitValueDef(e, headDef);
      // A USER-DEFINED operator head (`f8(x)` after `ce.assign('f8', x ↦ …)`
      // creates an operator definition): its lambda BODY carries transitive
      // symbol dependencies exactly like a stored value, so walk it (with
      // its parameter names skipped: their occurrences bind to valueless
      // body-scope definitions, which are the walk's own bindings, not
      // dependencies) — and record the operator itself as a dependency,
      // because a same-kind redefinition bumps `_worldVersion` but an
      // operator→scalar KIND SWAP does not (see `visitLambdaBody`).
      // Built-in operators have no lambda: no walk, and an entry only in a
      // snapshot for a type read (`bindingSites`), which tracks the write
      // version of each applied operator's signature.
      const opDef = e.operatorDefinition;
      if (opDef !== undefined) visitLambdaBody(e, e.operator, opDef, true);
      // A store-backed list (`ce.list()`) holds numbers only: no dependency
      // inside it, and reading its `ops` would box every element. Other
      // written-out data (a list of numbers and failed cells,
      // `_isLiteralData()`) holds no symbol, so no dependency either.
      if (e._numericStore !== undefined || e._isLiteralData()) return;
      for (const op of e.ops) visit(op, skipNames);
    } finally {
      for (const def of entered) excluded.delete(def);
    }
  };
  visit(expr);

  return eligible ? deps : undefined;
}

/**
 * The dependency snapshot of `expr` for a dependency-precise memo, or
 * `undefined` when the instance is ineligible (see `snapshotDeps`). This is
 * the public entry to this module's dependency machinery. The element memo
 * does not call it: it calls `snapshotDeps` directly, with the same rules
 * except one: a direct raw-symbol operand of the instance (a callback named
 * bare) is a dependency for the element memo only (`rawOperands` of
 * `snapshotDepsUnderChain`), so the facet memo of such an instance stays
 * ineligible. The returned value
 * is opaque: hold it and hand it back to `memoDepsStillValid`.
 *
 * `bindingSites`: also record, for each variable bound inside the instance,
 * the binding its name resolves to from the current scope (see
 * `ElementMemoDep.site`) with the write version of the variable's own
 * definition, and each operator the instance applies with the write version
 * of its definition (`ElementMemoDep.operatorVersion`). A memo of the TYPE
 * of the instance needs them; a memo of its value does not.
 *
 * Many memos call this function: the collection-facet memo, the sequence
 * term memo (`sequence.ts`), the application memo (`function-utils.ts`), the
 * stored-value memo of a symbol (`boxed-symbol.ts`), the type memo of a
 * value definition (`boxed-value-definition.ts`), the declined-derivative
 * memo (`library/calculus.ts`), the `Slice` bounds memo
 * (`library/collections.ts`) and the probe cache of `symbolic/limit.ts`. A
 * change to the eligibility rules here changes all of them: to let one memo
 * store more instances, widen the eligibility in that caller, not here.
 */
export function snapshotMemoDeps(
  expr: Expression,
  options?: { bindingSites?: boolean }
): MemoDeps | undefined {
  return snapshotDeps(expr, false, options?.bindingSites === true);
}

/** Opaque dependency snapshot — see {@link snapshotMemoDeps}. */
export type MemoDeps = ElementMemoDep[];

/**
 * Are all of `deps` (a snapshot taken by {@link snapshotMemoDeps} on this
 * same `expr`) still current? Checks, per dependency: the occurrence still
 * resolves to the same inner value definition (an `updateDef` swap is an
 * identity change), the definition's `_writeVersion` is unmoved (value
 * writes, INCLUDING ephemeral loop-index writes — this loop is the
 * ephemeral-write detector, do not "optimize" it away behind a
 * `_semanticVersion` fast path), and the instance's resolution chain still
 * resolves the name to the same binding (shadowing declarations bump no
 * counter and touch no tracked definition, but change what a walk computes —
 * see `ElementMemoDep.resolved`). Callers must ALSO check their entry's
 * `worldVersion` stamp against `ce._worldVersion`; that axis is not this
 * function's job.
 */
export function memoDepsStillValid(expr: Expression, deps: MemoDeps): boolean {
  return underWalkChain(expr, () => memoDepsStillValidUnderChain(expr, deps));
}

function memoDepsStillValidUnderChain(
  expr: Expression,
  deps: MemoDeps
): boolean {
  const ce = expr.engine;
  const depScope = depResolutionScope(expr);
  for (const d of deps) {
    if (d.site !== undefined) {
      // A binding-site dependency: the name of the bound variable must
      // resolve from the current scope to the same binding as at fill time,
      // and a valueless other binding it resolved to must be unwritten.
      // The definition of the occurrence itself must be unwritten.
      if (d.site._writeVersion !== d.siteVersion) return false;
      const r = resolveDepBinding(ce, undefined, d.name, d.site);
      if (r !== d.resolved) return false;
      const other = isValueDef(r) && r.value !== d.site ? r.value : undefined;
      if (other !== d.valueDef) return false;
      if (other !== undefined && other._writeVersion !== d.version)
        return false;
      continue;
    }
    if (d.shadow === true && d.valueDef !== undefined) {
      // The binding the chain resolved to must be unwritten, and the chain
      // must still resolve the name to it.
      if (d.valueDef._writeVersion !== d.version) return false;
      const r = resolveDepBinding(
        ce,
        depScope,
        d.name,
        isSymbol(d.occurrence) ? d.occurrence.valueDefinition : undefined
      );
      if (!isValueDef(r) || r.value !== d.valueDef) return false;
      continue;
    }
    // An OPERATOR-ONLY dependency (no `valueDef`) has no pinned value
    // binding to compare or version to read; its validity is the resolution
    // re-check below.
    if (d.valueDef !== undefined) {
      if (d.occurrence.valueDefinition !== d.valueDef) {
        // The pinned binding's inner definition was replaced. When BOTH the
        // fill-time definition and the current one are VALUELESS, this is a
        // re-auto-declare, not a semantic change: a definition holding no
        // value never supplies what a walk reads — the name resolves through
        // the scope chain, which the re-resolution check below validates.
        // Bare-symbol canonicalization performs exactly such a swap on a
        // lambda-body free (`ce.symbol(name)` auto-declares the name and
        // `updateDef` replaces the shared wrapper's inner definition in
        // place), so failing on identity here made every snapshot that
        // walked such a body born-stale: each facet probe recomputed, the
        // recompute re-canonicalized the body and swapped the binding again,
        // and one `ce.parse` built ~460K broadcast lambdas before timing out
        // (ROADMAP.md "Tycho item 186"). Identity — and the `_writeVersion`
        // continuity that hangs off it — is load-bearing only when either
        // side holds a value.
        const cur = d.occurrence.valueDefinition;
        if (
          cur === undefined ||
          cur.value !== undefined ||
          d.valueDef.value !== undefined
        )
          return false;
      } else if (d.valueDef._writeVersion !== d.version) return false;
    }
    // A value dependency re-resolves through the occurrence's CURRENT binding
    // (the inner definition may have been swapped in place since the fill —
    // see above), exactly as the fill did through the one it had then.
    const r = resolveDepBinding(
      ce,
      depScope,
      d.name,
      d.resolvedOperator === undefined &&
        d.valueDef !== undefined &&
        isSymbol(d.occurrence)
        ? (d.occurrence.valueDefinition ?? d.valueDef)
        : undefined
    );
    if (d.resolvedOperator !== undefined) {
      // An operator dependency (a walked user lambda, or a healed forward
      // reference) compares the INNER operator-definition identity: the
      // outer tagged wrapper is mutated in place on redefinition, so its
      // identity proves nothing — an operator→scalar kind swap keeps the
      // wrapper and swaps the inner (and bumps no version axis at all).
      if (!isOperatorDef(r)) return false;
      if (r.operator !== d.resolvedOperator) return false;
      // In a snapshot for a type read, the signature must be unwritten.
      if (
        d.operatorVersion !== undefined &&
        d.resolvedOperator._writeVersion !== d.operatorVersion
      )
        return false;
    } else if (r !== d.resolved) return false;
  }
  return true;
}

/** The still-valid cache for this instance, or `undefined`. Check
 * `complete` before serving a whole-collection read — a partial prefix (from
 * `elementMemoFillTo`, or from an abandoned/overflowed recording walk) covers
 * only `at()`-style reads. */
export function validElementMemo(
  expr: Expression
): { elements: ReadonlyArray<Expression>; complete: boolean } | undefined {
  const entry = validEntryOf(expr);
  if (entry === undefined) return undefined;
  // Serving the entry performs no field reads, so an enclosing cache-backed
  // computation would commit dependency-free and go on serving these elements
  // after a store. Hand the (just validated) stamps outward.
  mergeObjectDeps(entry.objectDeps);
  return entry;
}

/** The still-valid cache entry for this instance, or `undefined`. Unlike
 * `validElementMemo`, this does not hand the entry's object dependencies to
 * the enclosing collectors: the caller does that only when it serves an
 * element of the entry. */
function validEntryOf(expr: Expression): ElementMemoCache | undefined {
  const ce = expr.engine;
  // Inside a transient precision window (`_withTransientPrecision`, the
  // window of a `N(x, p)` call), the elements that a read would compute have
  // more digits than the ones a memo holds, and the ones a read inside the
  // window would store would be served later at the precision of the
  // engine: no entry is served or stored there (see the store sites).
  if (ce._atTransientConfiguration) return undefined;
  const entry = elementMemoCaches.get(expr);
  if (!entry) {
    if (CACHE_STATS) recordCache('elementMemo', 'missCold');
    return undefined;
  }
  if (entry.worldVersion !== ce._worldVersion) {
    if (CACHE_STATS) recordCache('elementMemo', 'missEpoch');
    return undefined;
  }
  if (entry.factsHidden !== ce._factsHidden()) {
    if (CACHE_STATS) recordCache('elementMemo', 'missEpoch');
    return undefined;
  }
  if (!memoDepsStillValid(expr, entry.deps)) {
    if (CACHE_STATS) recordCache('elementMemo', 'missDependency');
    return undefined;
  }
  // A store to a mutable object advances neither `_worldVersion` nor any
  // symbol dependency's `_writeVersion`, so an entry whose elements were
  // computed from object fields is validated against its own recorded
  // `(object, version)` stamps.
  if (!objectDepsValid(entry.objectDeps)) {
    if (CACHE_STATS) recordCache('elementMemo', 'missDependency');
    return undefined;
  }
  if (CACHE_STATS) recordCache('elementMemo', 'hit');
  return entry;
}

/**
 * Did none of `endDeps` move relative to `startDeps`? Requires a start
 * snapshot, the same dependency count, and — for every end dependency — a
 * start dependency on the SAME `valueDef`/`resolvedOperator`/`name` triple
 * with an equal `version` and an identical resolved binding. (Value
 * dependencies are one per distinct value definition and operator
 * dependencies one per distinct operator definition, so the triple is
 * unambiguous — `valueDef` alone no longer is, since operator-only entries
 * all carry `valueDef: undefined`.)
 */
function depsUnmoved(
  startDeps: ElementMemoDep[] | undefined,
  endDeps: ElementMemoDep[]
): boolean {
  if (startDeps === undefined) return false;
  if (startDeps.length !== endDeps.length) return false;
  for (const d of endDeps) {
    const s = startDeps.find(
      (x) =>
        x.valueDef === d.valueDef &&
        x.resolvedOperator === d.resolvedOperator &&
        x.name === d.name
    );
    if (s === undefined) return false;
    if (s.version !== d.version) return false;
    if (s.resolved !== d.resolved) return false;
  }
  return true;
}

/**
 * Commit a recorded walk's buffer, if the walk is certifiable.
 *
 * `suspendedWrite` means the consumer bumped `_semanticVersion` while the
 * generator was suspended between two pulls. That alone does not condemn the
 * buffer: a write to a NON-dependency cannot mix it (a consumer loop that
 * assigns an unrelated accumulator between pulls must not permanently block
 * commits), so we diff the dependency snapshot taken before the walk against
 * the one taken after. A suspended write that DID move a dependency is
 * indistinguishable from a genuinely mixed before/after buffer — decline. A
 * body's own self-writes to a dependency raise no suspended flag and keep
 * committing, preserving the ruled absorb behavior.
 *
 * `suspendedEpochChange` — the consumer changed the world globally
 * (`assume`, a redefinition, a tolerance/precision change) between two pulls.
 * That has NO per-dependency counterpart to diff against, and the entry would
 * be stamped with the POST-change epoch, certifying a mixed buffer as valid
 * under the new world. Unconditionally fatal.
 */
function commitRecordedWalk(
  expr: Expression,
  buffer: Expression[],
  startDeps: ElementMemoDep[] | undefined,
  suspendedWrite: boolean,
  suspendedEpochChange: boolean,
  complete: boolean,
  objectDeps: ObjectDeps | undefined,
  sequenceStopsBefore: number,
  incompleteWalksBefore: number,
  hostCallsBefore: number
): void {
  // A partial entry with nothing in it would only churn the cache.
  if (!complete && buffer.length === 0) return;
  // An element computed by host code that no memo may keep a result across
  // (a host operator that does not state its purity, or a host handler that
  // changed state) is not committed (`host-handler-changes.ts`).
  if (uncachedHostCallCount() !== hostCallsBefore) return;
  // A read of a sequence term was stopped while the walk ran (too many
  // terms, or a recursion that is too deep): an element can hold that
  // declined term, and a later read can give it. Such a buffer is not
  // committed (`sequence-read-stops.ts`).
  if (sequenceReadStopCount() !== sequenceStopsBefore) return;
  // The walk met an inner collection that it could not walk (a `FlatMap`
  // whose callback returned `Join([x], v)` for a valueless `v`), so the
  // buffer misses elements. A later walk that read it would not see that
  // (`incomplete-walks.ts`).
  if (incompleteWalkCount() !== incompleteWalksBefore) return;
  // An element that IS (or transitively holds) a mutable object is never
  // memoized: the entry would keep it alive for as long as the collection
  // instance lives (ruling B12), and its contents are not part of what the
  // version stamps validate.
  if (buffer.some(containsObject)) return;
  // PARTIAL entries are for PURE instances only. `each()` refuses partials,
  // so a later complete walk of an impure instance re-draws from scratch and
  // replaces the prefix — an `at(1)` read before and after that walk would
  // observe two different draws for the same element of the same instance,
  // breaking one-instance/one-draw-set coherence. A COMPLETE commit of an
  // impure walk is fine: it IS the instance's draw set.
  if (!complete && !expr.isPure) return;
  if (suspendedEpochChange) return;
  const endDeps = snapshotDeps(expr, true);
  if (endDeps === undefined) return;
  if (suspendedWrite && !depsUnmoved(startDeps, endDeps)) return;
  // Never shrink coverage: a still-valid entry that already covers at least
  // as much (or is complete) outranks a prefix. A complete drain always wins.
  if (!complete) {
    const existing = validElementMemo(expr);
    if (
      existing &&
      (existing.complete || existing.elements.length >= buffer.length)
    )
      return;
  }
  // Elements computed inside a transient precision window are not stored
  // (see `validElementMemo`).
  if (expr.engine._atTransientConfiguration) return;
  elementMemoCaches.set(expr, {
    worldVersion: expr.engine._worldVersion,
    factsHidden: expr.engine._factsHidden(),
    deps: endDeps,
    complete,
    elements: buffer,
    objectDeps,
  });
}

/**
 * Buffer a walk of `iter` and commit it as this instance's element memo.
 *
 * A walk drained to completion without overflowing the cap commits a
 * `complete` entry. An abandoned walk (`Take`, `First`, a consumer `break`, a
 * thrown deadline) or one that overflowed the cap commits its buffer as a
 * `complete: false` PREFIX (Tycho item 127, ask 2): `each()` still re-walks —
 * it serves only complete entries — but `at()` and `elementMemoFillTo` serve
 * any covering prefix, so a budget-bounded sampling walk's work is not lost.
 *
 * The dependency snapshot and the epoch stamp are taken AFTER the drain:
 * bumps caused by the walk itself (parameter activations, a side-effecting
 * body) are absorbed, exactly as in the Comprehension memo. Writes made by
 * the CONSUMER while the generator is suspended are a different matter — see
 * `commitRecordedWalk`; the boundary flag below is what detects them.
 */
/** The counts that a recorded walk compares at its commit, sampled when the
 * walk starts (`elementMemoWalkBaseline()`). */
export type ElementMemoWalkBaseline = {
  sequenceStops: number;
  incompleteWalks: number;
  hostCalls: number;
};

/**
 * Sample the counts that a recorded walk compares at its commit. The caller
 * samples them BEFORE it builds the iterator of the walk: building it can
 * evaluate an operand (the iterator of `Join` walks its operands at once,
 * and a finiteness read evaluates an eager source), and host code that runs
 * then is part of the walk (`host-handler-changes.ts`). A generator cannot
 * sample them itself: its body runs at the first `next()`.
 */
export function elementMemoWalkBaseline(): ElementMemoWalkBaseline {
  return {
    sequenceStops: sequenceReadStopCount(),
    incompleteWalks: incompleteWalkCount(),
    hostCalls: uncachedHostCallCount(),
  };
}

/**
 * Record a walk of `iter` (see the comment above `ElementMemoWalkBaseline`).
 *
 * This function is not a generator, so its body runs when the caller calls
 * it, and not at the first `next()`. It samples the dependency snapshot of
 * the instance, the semantic version, the world version and the lexical
 * scope at that time. The caller calls it after it built the iterator and
 * before it returns the stream to the consumer. An iterator that reads its
 * operands when it is built (`Join`, `Filter`) holds the elements of the
 * values it read, so a change made by the consumer between the return of
 * `each()` and the first pull must be compared like a change made between
 * two pulls: a write to a dependency moves it against this snapshot, and a
 * change of the world version or of the scope prevents the commit. Changes
 * made while the iterator was built are the walk's own and are absorbed, the
 * same as changes made inside `next()`.
 *
 * Without `baseline`, the counts are sampled here too.
 */
export function elementMemoRecordingStream(
  expr: Expression,
  iter: Iterator<Expression, undefined>,
  baseline?: ElementMemoWalkBaseline
): Generator<Expression> {
  const ce = expr.engine;
  return recordingStream(expr, iter, baseline ?? elementMemoWalkBaseline(), {
    // Dependencies are static in the tree, so a pre-walk snapshot is valid;
    // it is the baseline the end-of-walk snapshot is diffed against.
    deps: snapshotDeps(expr, true),
    semanticVersion: ce._semanticVersion,
    worldVersion: ce._worldVersion,
    scope: ce.context?.lexicalScope,
  });
}

function* recordingStream(
  expr: Expression,
  iter: Iterator<Expression, undefined>,
  baseline: ElementMemoWalkBaseline,
  boundary: {
    deps: ElementMemoDep[] | undefined;
    semanticVersion: number;
    worldVersion: number;
    scope: unknown;
  }
): Generator<Expression> {
  const ce = expr.engine;
  const buffer: Expression[] = [];
  let overflow = false;
  let suspendedWrite = false;
  let suspendedEpochChange = false;
  /** The consumer changed the ambient scope while the generator was
   * suspended (a scope popped or pushed between two pulls). A scoped
   * instance reads a shadowing declaration of that scope
   * (`withAmbientChain`), so the elements pulled before and after the
   * change may come from two environments; such a buffer is never
   * committed. Neither engine version moves for an ordinary scope change. */
  let suspendedScopeChange = false;
  let drained = false;
  const startDeps = boundary.deps;
  // A stop of a sequence read between the baseline and the commit, also one
  // made by the consumer between two pulls, prevents the commit.
  const sequenceStopsBefore = baseline.sequenceStops;
  const incompleteWalksBefore = baseline.incompleteWalks;
  const hostCallsBefore = baseline.hostCalls;
  /** The mutable-object field reads made by the walk itself. A collector is
   * opened around each PULL rather than around the whole generator: the
   * generator suspends at every `yield`, and a collector left open across
   * that boundary would collect the CONSUMER's reads (which belong to the
   * consumer's own cache entry, not to this one) and would be popped out of
   * order by any collector the consumer opens. */
  let objectDeps: ObjectDeps | undefined;
  const pull = (): IteratorResult<Expression, undefined> => {
    beginObjectDeps();
    try {
      return iter.next();
    } finally {
      objectDeps = accumulateObjectDeps(objectDeps, endObjectDeps());
    }
  };
  // The boundary samples live OUTSIDE the try: an abrupt closure (a `break`
  // jumps from the yield straight into the `finally`) skips the loop's
  // post-yield comparison, so the `finally` must re-compare against the last
  // sample or a pull-mutate-break consumer would commit a prefix stamped
  // with the post-mutation state (the second reviewer-round catch).
  // The first sample is the one taken when the stream was created
  // (`elementMemoRecordingStream()`), so the gap between `each()` and the
  // first pull is compared like the gap between two pulls.
  let gen = boundary.semanticVersion;
  let epoch = boundary.worldVersion;
  let ambient: unknown = boundary.scope;
  try {
    if (ce._semanticVersion !== gen) suspendedWrite = true;
    if (ce._worldVersion !== epoch) suspendedEpochChange = true;
    if (ce.context?.lexicalScope !== ambient) suspendedScopeChange = true;
    let result = pull();
    // Bumps INSIDE `next()` are the walk's own and are absorbed; only a bump
    // observed across a yield boundary is the consumer's. Configuration
    // changes (tolerance/precision/angular unit/jit) bump
    // `_semanticVersion` too, so a mid-walk config change also raises
    // these flags.
    gen = ce._semanticVersion;
    epoch = ce._worldVersion;
    ambient = ce.context?.lexicalScope;
    while (!result.done) {
      if (buffer.length < ELEMENT_MEMO_CAP) buffer.push(result.value);
      else overflow = true;
      yield result.value;
      // Resumed: anything that moved while we were suspended was the
      // consumer, not the element body.
      if (ce._semanticVersion !== gen) suspendedWrite = true;
      if (ce._worldVersion !== epoch) suspendedEpochChange = true;
      if (ce.context?.lexicalScope !== ambient) suspendedScopeChange = true;
      result = pull();
      gen = ce._semanticVersion;
      epoch = ce._worldVersion;
      ambient = ce.context?.lexicalScope;
    }
    drained = true;
  } finally {
    // The final boundary: covers the suspended gap between the last yield
    // and this `finally` (abrupt closure), and — conservatively — a bump
    // made by an element evaluation that THREW (a deadline mid-`next()`);
    // declining that prefix loses nothing of value.
    if (ce._semanticVersion !== gen) suspendedWrite = true;
    if (ce._worldVersion !== epoch) suspendedEpochChange = true;
    if (ce.context?.lexicalScope !== ambient) suspendedScopeChange = true;
    // Forward early abandonment (`break`, `Take`, `.return()`) to the
    // wrapped iterator so a future handler with cleanup semantics is closed
    // deterministically rather than left suspended until GC.
    if (!drained) iter.return?.();
    // Runs during exception unwinding too (a thrown deadline): the elements
    // produced so far are valid, so they are committed as a prefix. Nothing
    // here returns or throws, so a propagating exception is not swallowed.
    commitRecordedWalk(
      expr,
      buffer,
      startDeps,
      suspendedWrite,
      suspendedEpochChange || suspendedScopeChange,
      drained && !overflow,
      objectDeps,
      sequenceStopsBefore,
      incompleteWalksBefore,
      hostCallsBefore
    );
  }
}

/**
 * Ensure the instance's memo holds at least the first `n` elements (or the
 * whole collection, if shorter) and return the prefix. The fill path for
 * operators with NO random access of their own (`Comprehension`): without a
 * prefix cache, `at(i)` called for i = 1…n costs O(n²) walks (Tycho item
 * 23.1).
 *
 * The stream is not resumable, so extending a valid-but-short prefix
 * restarts from scratch. A fill that stopped exactly at `n` therefore made a
 * SEQUENTIAL scan quadratic all the same: `[l[i] for i = 1…Length(l)]` over a
 * lazy `l` asked for prefixes of length 1, 2, 3, … and each ask re-ran the
 * body from the first element, 1 + 2 + … + n runs in all. A chain of such
 * helpers (a Desmos terrain: `d(s(u(d(s(u(b))))))`, each level four times
 * longer than the one below) paid that at every level — 10, 139 and 2186
 * body runs for lists of 4, 16 and 64 elements, and the four-level document
 * never finished. So the fill is GEOMETRIC: it takes the prefix to at least
 * twice the length it already holds, which makes the refills 1, 2, 4, 8, …
 * and a scan of `n` elements cost fewer than `2n` body runs, while a lone
 * `at(1)` on a long lazy collection still computes one element. A stream
 * shorter than the target simply completes, so nothing past the collection's
 * end is ever asked for.
 *
 * Fills at most `ELEMENT_MEMO_CAP` elements; a caller asking beyond the cap
 * should stream directly instead. The drain is synchronous (no yields), so
 * the suspended-write hazard of the recording stream does not apply; the
 * epoch stamp and dependency snapshot are taken AFTER the fill, absorbing the
 * walk's own bumps. An ineligible instance (see `snapshotDeps`) fills and
 * returns the prefix without committing anything.
 *
 * Coverage never shrinks: the early return above already keeps a valid entry
 * that is complete or at least `n` long, and any entry we do replace was
 * shorter than the elements this fill produces (or was invalid).
 */
export function elementMemoFillTo(
  expr: Expression,
  n: number,
  makeStream: () => Iterator<Expression, undefined>
): ReadonlyArray<Expression> {
  const cached = validElementMemo(expr);
  if (cached && (cached.complete || cached.elements.length >= n))
    return cached.elements;

  const limit = Math.min(
    Math.max(n, 2 * (cached?.elements.length ?? 0)),
    ELEMENT_MEMO_CAP
  );
  const elements: Expression[] = [];
  let complete = false;
  const sequenceStopsBefore = sequenceReadStopCount();
  const incompleteWalksBefore = incompleteWalkCount();
  const hostCallsBefore = uncachedHostCallCount();
  const iter = makeStream();
  // The drain is synchronous and uninterrupted by consumer code, so ONE
  // collector brackets the whole of it: every mutable-object field read below
  // belongs to this entry. It is closed in the `finally` so a throw (a
  // deadline cancellation) discards it along with the uncommitted prefix.
  beginObjectDeps();
  let objectDeps: ObjectDeps | undefined;
  try {
    while (elements.length < limit) {
      const r = iter.next();
      if (r.done) {
        complete = true;
        break;
      }
      elements.push(r.value);
    }
  } finally {
    objectDeps = endObjectDeps();
    if (!complete) iter.return?.();
  }

  // Same purity gate as `commitRecordedWalk`: a PARTIAL prefix of an impure
  // instance would be replaced by a later re-drawing complete walk, so
  // `at()` reads before and after would disagree — partials are pure-only.
  const deps = complete || expr.isPure ? snapshotDeps(expr, true) : undefined;
  // …and the same payload rule: an element holding a mutable object is never
  // memoized, because the entry would keep that object alive (ruling B12) and
  // its contents are not part of what the version stamps validate.
  // …and a fill during which a read of a sequence term was stopped is not
  // committed: an element can hold the declined term, which a later read
  // can give (`sequence-read-stops.ts`).
  // …and a fill that met an inner collection that it could not walk is not
  // committed: it misses elements (`incomplete-walks.ts`).
  if (
    deps !== undefined &&
    !elements.some(containsObject) &&
    sequenceReadStopCount() === sequenceStopsBefore &&
    incompleteWalkCount() === incompleteWalksBefore &&
    // Host code that no memo may keep a result across
    // (`host-handler-changes.ts`).
    uncachedHostCallCount() === hostCallsBefore &&
    // Elements computed inside a transient precision window are not stored
    // (see `validElementMemo`).
    !expr.engine._atTransientConfiguration
  ) {
    const ce = expr.engine;
    elementMemoCaches.set(expr, {
      worldVersion: ce._worldVersion,
      factsHidden: ce._factsHidden(),
      deps,
      complete,
      elements,
      objectDeps,
    });
  }
  return elements;
}

/** TEST-ONLY: drop an instance's element memo, so a test of a layer BELOW
 * the memo (e.g. the map-auto-compile cache) can force a re-walk. */
export function _clearElementMemoForTest(expr: Expression): void {
  elementMemoCaches.delete(expr);
}

/**
 * Serve `at(index)` from a covering cached prefix. Returns `undefined` when
 * the cache does not cover the index — including a complete cache asked past
 * its end, where the caller's own `at` handler is the authority on
 * out-of-range behavior.
 */
export function elementMemoAt(
  expr: Expression,
  index: number
): Expression | undefined {
  if (!Number.isInteger(index) || index < 1) return undefined;
  const cached = validEntryOf(expr);
  if (!cached) return undefined;
  const value =
    cached.elements.length >= index
      ? cached.elements[index - 1]
      : cached.cells?.get(index);
  if (value === undefined) return undefined;
  mergeObjectDeps(cached.objectDeps);
  return value;
}

/**
 * Compute `at(index)` of an instance with `compute`, and keep the element
 * in the instance's memo so that the next `at(index)` is served by
 * `elementMemoAt` until a dependency of the instance changes. The memo is
 * validated by the same dependencies as a recorded walk (the free symbols
 * of the instance and, through their values, what those depend on), so a
 * write to a symbol that the element depends on (`ce.assign`) makes the
 * next read compute the element again. The declarations of the parameters
 * of a call do not change these dependencies, so a read made while a
 * callback runs can be served too.
 *
 * Only ONE element is computed: a first `at(n)` is not made into a fill of
 * the first `n` elements.
 *
 * The element is not kept when:
 * - the instance is impure: a cell of an impure instance would be replaced
 *   by a later complete walk that draws again, and two reads of the same
 *   position would then differ (the rule for partial prefixes in
 *   `commitRecordedWalk`);
 * - the read is in a transient precision window (`validElementMemo`);
 * - the element is, or holds, a mutable object (the rule of
 *   `commitRecordedWalk`);
 * - a read of a sequence term was stopped, or a walk missed elements, while
 *   the element was computed;
 * - the instance already holds `ELEMENT_MEMO_CAP` cells, so that the cells
 *   of an infinite collection read at many positions stay bounded.
 */
export function elementMemoComputeCell(
  expr: Expression,
  index: number,
  compute: () => Expression | undefined
): Expression | undefined {
  const ce = expr.engine;
  if (!Number.isInteger(index) || index < 1) return compute();
  if (ce._atTransientConfiguration || !expr.isPure) return compute();
  const sequenceStopsBefore = sequenceReadStopCount();
  const incompleteWalksBefore = incompleteWalkCount();
  const hostCallsBefore = uncachedHostCallCount();
  let value: Expression | undefined;
  let objectDeps: ObjectDeps | undefined;
  beginObjectDeps();
  try {
    value = compute();
  } finally {
    objectDeps = endObjectDeps();
  }
  if (
    value === undefined ||
    containsObject(value) ||
    sequenceReadStopCount() !== sequenceStopsBefore ||
    incompleteWalkCount() !== incompleteWalksBefore ||
    // Host code that no memo may keep a result across
    // (`host-handler-changes.ts`).
    uncachedHostCallCount() !== hostCallsBefore ||
    ce._atTransientConfiguration
  )
    return value;
  // The entry is validated AFTER the computation, so a dependency that the
  // computation itself wrote, or a change of the world version that it
  // caused, replaces the entry instead of adding a cell to it.
  const entry = validEntryOf(expr);
  if (entry !== undefined) {
    // A computation that filled a prefix itself (`Comprehension` reads its
    // elements through `elementMemoFillTo`) needs no cell.
    if (entry.elements.length >= index) return value;
    if ((entry.cells?.size ?? 0) >= ELEMENT_MEMO_CAP) return value;
    entry.cells ??= new Map();
    entry.cells.set(index, value);
    entry.objectDeps = accumulateObjectDeps(entry.objectDeps, objectDeps);
    return value;
  }
  const deps = snapshotDeps(expr, true);
  if (deps === undefined) return value;
  elementMemoCaches.set(expr, {
    worldVersion: ce._worldVersion,
    factsHidden: ce._factsHidden(),
    deps,
    complete: false,
    elements: [],
    cells: new Map([[index, value]]),
    objectDeps,
  });
  return value;
}
