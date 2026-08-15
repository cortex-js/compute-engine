import type {
  Expression,
  BoxedDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  IComputeEngine,
  Scope,
} from '../global-types';

import { isDictionary, isFunction, isObject, isSymbol } from './type-guards';
import { isValueDef, isOperatorDef } from './utils';
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
 * `docs/plans/2026-08-02-dependency-precise-memo-invalidation.md`). Every
 * engine input that can change what an element evaluates to now bumps a
 * counter — including the configuration inputs (`tolerance` bumps directly,
 * `precision`/`angularUnit` through `_reset()`) — so the memo needs exactly
 * two axes and nothing else:
 *
 * - `ce._worldVersion` equality — the RARE global events for which no
 *   per-dependency tracking exists: `assume`/`forget` (and assumption-dirty
 *   scope pops), operator/type redefinition, signature inference, `reset()`,
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
   * Non-constant symbol VALUES resolve by name through a scope chain
   * (`BoxedSymbol._value` → `_getSymbolValue`), not through the occurrence's
   * pinned binding — so a shadowing declaration changes what a walk computes
   * while bumping no counter and touching no tracked definition.
   * Re-resolving at validation catches it. Which chain matters: a SCOPED
   * instance (`Comprehension`) walks under its own captured `localScope`, so
   * an ambient shadow is invisible to it and must not invalidate (a
   * spurious refill re-draws an impure body); an unscoped instance (`Map`)
   * resolves through the ambient chain at walk time. See
   * `depResolutionScope`. */
  resolved: BoxedDefinition | undefined;
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
}

interface ElementMemoCache {
  /** `ce._worldVersion` snapshot taken AFTER the fill, so any bump the walk
   * itself causes is absorbed. Covers the rare global events AND every
   * engine-configuration input (tolerance/precision/angular unit), which is
   * why no separate configuration stamps are kept. */
  worldVersion: number;
  deps: ElementMemoDep[];
  /** True when `elements` is the whole collection. `each()` serves only
   * complete entries; `at()`/`elementMemoFillTo` serve any covering prefix.
   * Partial entries are written by the fill-to-n path (`Comprehension`) and
   * by a recording walk that was abandoned or overflowed the cap. */
  complete: boolean;
  elements: Expression[];
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
 * Collect the value definitions of every `Function` literal's PARAMETER
 * sites in the tree. Parameters are supplied by the walk itself (activation
 * copies in a fresh call scope), never assigned from outside, and their
 * static bindings hold no value — without this exclusion the valueless-
 * binding gate below would mark every lambda-bearing instance ineligible.
 *
 * Deliberately NOT excluded: the local bindings of scoped subexpressions. A
 * nested `Sum`'s index definition holds the value its last iteration wrote,
 * so it self-stabilizes as an ordinary dep (only this instance's own walks
 * write it); and an AUTO-DECLARED unknown living in the same scope (a free
 * symbol the body references but nothing has assigned) must stay visible to
 * the valueless-binding gate — a later `assign` of that name installs a
 * value in a different definition, which no version or counter tracks.
 */
function collectParameterDefs(
  expr: Expression,
  out: Set<BoxedValueDefinition>
): void {
  if (!isFunction(expr)) return;
  if (expr.operator === 'Function') {
    for (let i = 1; i < expr.nops; i++) {
      const op = expr.ops[i];
      const site = isFunction(op, 'Typed') ? op.op1 : op;
      if (isSymbol(site) && site.valueDefinition !== undefined)
        out.add(site.valueDefinition);
    }
  }
  for (const op of expr.ops) collectParameterDefs(op, out);
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

/** The binding `scope`'s chain — or, when `scope` is `undefined`, the
 * engine's CURRENT chain — resolves `name` to; the same resolution
 * `_getSymbolValue` performs for a non-constant symbol's value. Inline
 * chain walk (importing `lookup` from `function-utils` would cycle). */
function resolveDepBinding(
  ce: IComputeEngine,
  scope: Scope | undefined,
  name: string
): BoxedDefinition | undefined {
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
function snapshotDeps(expr: Expression): ElementMemoDep[] | undefined {
  const ce = expr.engine;
  const depScope = depResolutionScope(expr);
  const excluded = new Set<BoxedValueDefinition>();
  collectParameterDefs(expr, excluded);

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
  const deps: ElementMemoDep[] = [];
  let eligible = true;

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
    if (lambda === undefined) return;
    if (recordDep && !seenOperatorNames.has(name)) {
      seenOperatorNames.add(name);
      deps.push({
        occurrence,
        name,
        resolved: resolveDepBinding(ce, depScope, name),
        resolvedOperator: opDef,
      });
    }
    if (seenOperators.has(opDef)) return;
    seenOperators.add(opDef);
    // Mirror the stored-value branch: pre-register NESTED literals'
    // parameter sites anywhere in this body, so a helper that builds its
    // own lazy collection is not wrongly disqualified by the valueless
    // gate seeing an inner literal's parameter binding.
    collectParameterDefs(lambda.body, excluded);
    // DEFINITION BOUNDARY (see the stored-value branch): the skip set
    // is built FRESH from this lambda's OWN parameters — never seeded
    // from the caller's, whose spellings mean something else in this
    // definition's environment.
    const bodySkip = new Set<string>();
    for (const p of lambda.parameters) bodySkip.add(p.name);
    visit(lambda.body, bodySkip);
  };

  /** Record a value-definition dependency reached through `occurrence`
   * (a symbol operand, or an application whose head is value-bound). */
  const visitValueDef = (
    occurrence: Expression,
    valueDef: BoxedValueDefinition
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
      const resolved = resolveDepBinding(ce, depScope, name);
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
        seen.add(resolved.value);
        deps.push({
          occurrence,
          name,
          valueDef: resolved.value,
          version: resolved.value._writeVersion,
          resolved,
        });
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
    deps.push({
      occurrence,
      name,
      valueDef,
      version: valueDef._writeVersion,
      resolved: resolveDepBinding(ce, depScope, name),
    });
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
      // The stored value's own binding sites (a helper literal's
      // parameters) are as excluded as the instance's own.
      collectParameterDefs(stored, excluded);
      // DEFINITION BOUNDARY: a stored value is an independently defined
      // expression that resolves names in ITS OWN environment — the
      // caller's parameter names must NOT be inherited, or a helper reading
      // a global that happens to share a caller-parameter's spelling would
      // have that dependency silently dropped (a stale serve under
      // epoch-only validation). The stored literal's own parameters are
      // covered by the SITE-def exclusion above, so no name skips are
      // needed here at all.
      visit(stored, undefined);
    }
  };

  /** `skipNames` are the parameter names of the lambda bodies enclosing this
   * walk position: their occurrences bind to valueless body-scope
   * definitions that the valueless gate must not see. Scoped to the walk —
   * a same-named symbol elsewhere in the instance is still tracked. */
  const visit = (e: Expression, skipNames?: ReadonlySet<string>): void => {
    if (!eligible) return;
    if (isSymbol(e)) {
      if (skipNames?.has(e.symbol)) return;
      const valueDef = e.valueDefinition;
      if (valueDef !== undefined) {
        if (excluded.has(valueDef) || seen.has(valueDef)) return;
        visitValueDef(e, valueDef);
      } else if (
        e.operatorDefinition === undefined &&
        e.isCanonical === false
      ) {
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
    if (isFunction(e)) {
      // A BINDER's declared binding sites (a Comprehension's indices, a
      // Series' expansion variable) are the walk's own machinery, not
      // dependencies: their definitions are written during the walk and
      // RESTORED to valueless afterwards (`ComprehensionIndexFrame`
      // save→install→restore), so tracking one would either churn or trip
      // the valueless gate. The operator's own `bindingSites` selector is
      // the authority on which operands those are.
      const sites = e.operatorDefinition?.bindingSites?.(e.ops, 'post');
      if (sites)
        for (const s of sites) {
          let node: Expression | undefined = e;
          for (const p of s.path)
            node = isFunction(node) ? node.ops[p] : undefined;
          if (isSymbol(node) && node.valueDefinition !== undefined)
            excluded.add(node.valueDefinition);
        }
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
      // Built-in operators have no lambda: no walk, no entry.
      const opDef = e.operatorDefinition;
      if (opDef !== undefined) visitLambdaBody(e, e.operator, opDef, true);
      for (const op of e.ops) visit(op, skipNames);
    }
  };
  visit(expr);

  return eligible ? deps : undefined;
}

/**
 * The dependency snapshot of `expr` for a dependency-precise memo, or
 * `undefined` when the instance is ineligible (see `snapshotDeps`). The
 * public seam of this module's dependency machinery, shared by the element
 * memo and the collection-facet memo (`BoxedFunction._memoizedFacet`) so the
 * two can never diverge on what counts as a dependency. The returned value
 * is opaque: hold it and hand it back to `memoDepsStillValid`.
 */
export function snapshotMemoDeps(expr: Expression): MemoDeps | undefined {
  return snapshotDeps(expr);
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
  const ce = expr.engine;
  const depScope = depResolutionScope(expr);
  for (const d of deps) {
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
    const r = resolveDepBinding(ce, depScope, d.name);
    if (d.resolvedOperator !== undefined) {
      // An operator dependency (a walked user lambda, or a healed forward
      // reference) compares the INNER operator-definition identity: the
      // outer tagged wrapper is mutated in place on redefinition, so its
      // identity proves nothing — an operator→scalar kind swap keeps the
      // wrapper and swaps the inner (and bumps no version axis at all).
      if (!isOperatorDef(r)) return false;
      if (r.operator !== d.resolvedOperator) return false;
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
  const entry = elementMemoCaches.get(expr);
  if (!entry) {
    if (CACHE_STATS) recordCache('elementMemo', 'missCold');
    return undefined;
  }
  const ce = expr.engine;
  if (entry.worldVersion !== ce._worldVersion) {
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
  // Serving the entry performs no field reads, so an enclosing cache-backed
  // computation would commit dependency-free and go on serving these elements
  // after a store. Hand the (just validated) stamps outward.
  mergeObjectDeps(entry.objectDeps);
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
  objectDeps: ObjectDeps | undefined
): void {
  // A partial entry with nothing in it would only churn the cache.
  if (!complete && buffer.length === 0) return;
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
  const endDeps = snapshotDeps(expr);
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
  elementMemoCaches.set(expr, {
    worldVersion: expr.engine._worldVersion,
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
export function* elementMemoRecordingStream(
  expr: Expression,
  iter: Iterator<Expression, undefined>
): Generator<Expression> {
  const ce = expr.engine;
  const buffer: Expression[] = [];
  let overflow = false;
  let suspendedWrite = false;
  let suspendedEpochChange = false;
  let drained = false;
  // Dependencies are static in the tree, so a pre-walk snapshot is valid; it
  // is the baseline the end-of-walk snapshot is diffed against.
  const startDeps = snapshotDeps(expr);
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
  let gen = ce._semanticVersion;
  let epoch = ce._worldVersion;
  try {
    let result = pull();
    // Bumps INSIDE `next()` are the walk's own and are absorbed; only a bump
    // observed across a yield boundary is the consumer's. Configuration
    // changes (tolerance/precision/angular unit/jit) bump
    // `_semanticVersion` too, so a mid-walk config change also raises
    // these flags.
    gen = ce._semanticVersion;
    epoch = ce._worldVersion;
    while (!result.done) {
      if (buffer.length < ELEMENT_MEMO_CAP) buffer.push(result.value);
      else overflow = true;
      yield result.value;
      // Resumed: anything that moved while we were suspended was the
      // consumer, not the element body.
      if (ce._semanticVersion !== gen) suspendedWrite = true;
      if (ce._worldVersion !== epoch) suspendedEpochChange = true;
      result = pull();
      gen = ce._semanticVersion;
      epoch = ce._worldVersion;
    }
    drained = true;
  } finally {
    // The final boundary: covers the suspended gap between the last yield
    // and this `finally` (abrupt closure), and — conservatively — a bump
    // made by an element evaluation that THREW (a deadline mid-`next()`);
    // declining that prefix loses nothing of value.
    if (ce._semanticVersion !== gen) suspendedWrite = true;
    if (ce._worldVersion !== epoch) suspendedEpochChange = true;
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
      suspendedEpochChange,
      drained && !overflow,
      objectDeps
    );
  }
}

/**
 * Ensure the instance's memo holds at least the first `n` elements (or the
 * whole collection, if shorter) and return the prefix. The fill path for
 * operators with NO random access of their own (`Comprehension`): without a
 * prefix cache, `at(i)` called for i = 1…n costs O(n²) walks (Tycho item
 * 23.1). The stream is not resumable, so extending a valid-but-short prefix
 * restarts from scratch — fine for the reported pattern (repeated reads at
 * stable indices).
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
 * shorter than the `n` elements this fill produces (or was invalid).
 */
export function elementMemoFillTo(
  expr: Expression,
  n: number,
  makeStream: () => Iterator<Expression, undefined>
): ReadonlyArray<Expression> {
  const cached = validElementMemo(expr);
  if (cached && (cached.complete || cached.elements.length >= n))
    return cached.elements;

  const limit = Math.min(n, ELEMENT_MEMO_CAP);
  const elements: Expression[] = [];
  let complete = false;
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
  const deps = complete || expr.isPure ? snapshotDeps(expr) : undefined;
  // …and the same payload rule: an element holding a mutable object is never
  // memoized, because the entry would keep that object alive (ruling B12) and
  // its contents are not part of what the version stamps validate.
  if (deps !== undefined && !elements.some(containsObject)) {
    const ce = expr.engine;
    elementMemoCaches.set(expr, {
      worldVersion: ce._worldVersion,
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
  const cached = validElementMemo(expr);
  if (!cached) return undefined;
  if (cached.elements.length >= index) return cached.elements[index - 1];
  return undefined;
}
