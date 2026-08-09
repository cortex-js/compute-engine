import type {
  Expression,
  BoxedDefinition,
  BoxedValueDefinition,
  IComputeEngine,
  Scope,
} from '../global-types';

import { isDictionary, isFunction, isSymbol } from './type-guards';
import { isValueDef } from './utils';
import { CACHE_STATS, recordCache } from '../../common/cache-stats';

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
 * - `ce._semanticEpoch` equality — the RARE global events for which no
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
  /** The inner value definition at fill time. */
  valueDef: BoxedValueDefinition;
  /** `valueDef._writeVersion` at fill time. */
  version: number;
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
}

interface ElementMemoCache {
  /** `ce._semanticEpoch` snapshot taken AFTER the fill, so any bump the walk
   * itself causes is absorbed. Covers the rare global events AND every
   * engine-configuration input (tolerance/precision/angular unit), which is
   * why no separate configuration stamps are kept. */
  semanticEpoch: number;
  deps: ElementMemoDep[];
  /** True when `elements` is the whole collection. `each()` serves only
   * complete entries; `at()`/`elementMemoFillTo` serve any covering prefix.
   * Partial entries are written by the fill-to-n path (`Comprehension`) and
   * by a recording walk that was abandoned or overflowed the cap. */
  complete: boolean;
  elements: Expression[];
}

/** Keyed on the boxed instance. A `WeakMap` so an unreferenced collection
 * (and its cached elements) is collectable. */
const elementMemoCaches = new WeakMap<Expression, ElementMemoCache>();

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
 * Snapshot the instance's free-symbol dependencies, one per distinct value
 * definition. Only value-definition bindings are versioned: an operator
 * redefinition or signature inference always bumps `ce._semanticEpoch`, so
 * operator-bound symbols are covered by the global axis.
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
  const deps: ElementMemoDep[] = [];
  let eligible = true;

  /** Record a value-definition dependency reached through `occurrence`
   * (a symbol operand, or an application whose head is value-bound). */
  const visitValueDef = (
    occurrence: Expression,
    valueDef: BoxedValueDefinition
  ): void => {
    const name = isSymbol(occurrence) ? occurrence.symbol : occurrence.operator;
    // A valueless, non-constant binding is trackable ONLY when it is the
    // definition the instance's resolution chain resolves its name to (a
    // declared symbol used symbolically, e.g. under assumptions): a later
    // `assign` then writes THIS definition (version bump), and a chain
    // change is caught by the resolution axis. A valueless def the chain
    // cannot reach (an auto-declared unknown inside a literal's body scope)
    // is the hazard: `assign` takes the DECLARE path and installs the value
    // in a DIFFERENT definition, bumping neither the tracked version nor
    // `_semanticEpoch` — such an instance is ineligible.
    if (valueDef.value === undefined && !valueDef.isConstant) {
      const resolved = resolveDepBinding(ce, depScope, name);
      if (!isValueDef(resolved) || resolved.value !== valueDef) {
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
    // own free symbols into the instance's meaning — `Map(xs, f)` with
    // `f(x) = x + q` depends on `q`, which appears nowhere in the tree.
    // No global counter tracks a reassignment of `q` (a plain value write
    // never bumps `_semanticEpoch`; the DECLARE path a never-declared `q`
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
      } else if (e.operatorDefinition === undefined && e.isCanonical === false)
        eligible = false;
      return;
    }
    // A dictionary's entries are not walked here; a symbol dependency hiding
    // in one would go untracked, so a dictionary operand is conservatively
    // ineligible rather than silently under-keyed.
    if (isDictionary(e)) {
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
      // (`Map(xs, f)` applied with `f` a stored literal) reaches that
      // binding through operator position, where no symbol operand appears —
      // track it like a symbol dependency.
      const headDef = e.valueDefinition;
      if (headDef !== undefined && !excluded.has(headDef) && !seen.has(headDef))
        visitValueDef(e, headDef);
      // A USER-DEFINED operator head (`f8(x)` after `ce.assign('f8', x ↦ …)`
      // creates an operator definition) needs no dep entry — redefinition and
      // signature inference always bump `_semanticEpoch` — but its
      // lambda BODY carries transitive symbol dependencies exactly like a
      // stored value, so walk it (with its parameter names skipped: their
      // occurrences bind to valueless body-scope definitions, which are the
      // walk's own bindings, not dependencies). Built-in operators have no
      // lambda.
      const opDef = e.operatorDefinition;
      const lambda = opDef?.lambda;
      if (lambda !== undefined && !seenOperators.has(opDef!)) {
        seenOperators.add(opDef!);
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
      }
      for (const op of e.ops) visit(op, skipNames);
    }
  };
  visit(expr);

  return eligible ? deps : undefined;
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
  if (entry.semanticEpoch !== ce._semanticEpoch) {
    if (CACHE_STATS) recordCache('elementMemo', 'missEpoch');
    return undefined;
  }
  // NO `_mutationGeneration` fast path here: an ephemeral loop-index write
  // bumps the index definition's `_writeVersion` but NOT
  // `_mutationGeneration`, so generation equality does NOT prove the
  // dependencies are unchanged. The loop below IS the ephemeral-write
  // detector — it is what makes a memoized instance nested under a `Sum`
  // refill per iteration. Do not "optimize" it away.
  const depScope = depResolutionScope(expr);
  for (const d of entry.deps) {
    if (d.occurrence.valueDefinition !== d.valueDef) {
      if (CACHE_STATS) recordCache('elementMemo', 'missDependency');
      return undefined;
    }
    if (d.valueDef._writeVersion !== d.version) {
      if (CACHE_STATS) recordCache('elementMemo', 'missDependency');
      return undefined;
    }
    // Resolution axis: shadowing declarations bump no counter and touch no
    // tracked definition, but change what a walk computes (see
    // `ElementMemoDep.resolved`).
    if (resolveDepBinding(ce, depScope, d.name) !== d.resolved) {
      if (CACHE_STATS) recordCache('elementMemo', 'missDependency');
      return undefined;
    }
  }
  if (CACHE_STATS) recordCache('elementMemo', 'hit');
  return entry;
}

/**
 * Did none of `endDeps` move relative to `startDeps`? Requires a start
 * snapshot, the same dependency count, and — for every end dependency — a
 * start dependency on the SAME `valueDef` object with an equal `version` and
 * an identical resolved binding. (Dependencies are one per distinct value
 * definition, so matching on `valueDef` identity is unambiguous.)
 */
function depsUnmoved(
  startDeps: ElementMemoDep[] | undefined,
  endDeps: ElementMemoDep[]
): boolean {
  if (startDeps === undefined) return false;
  if (startDeps.length !== endDeps.length) return false;
  for (const d of endDeps) {
    const s = startDeps.find((x) => x.valueDef === d.valueDef);
    if (s === undefined) return false;
    if (s.version !== d.version) return false;
    if (s.resolved !== d.resolved) return false;
  }
  return true;
}

/**
 * Commit a recorded walk's buffer, if the walk is certifiable.
 *
 * `suspendedWrite` means the consumer bumped `_mutationGeneration` while the
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
  complete: boolean
): void {
  // A partial entry with nothing in it would only churn the cache.
  if (!complete && buffer.length === 0) return;
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
    semanticEpoch: expr.engine._semanticEpoch,
    deps: endDeps,
    complete,
    elements: buffer,
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
  // The boundary samples live OUTSIDE the try: an abrupt closure (a `break`
  // jumps from the yield straight into the `finally`) skips the loop's
  // post-yield comparison, so the `finally` must re-compare against the last
  // sample or a pull-mutate-break consumer would commit a prefix stamped
  // with the post-mutation state (the second reviewer-round catch).
  let gen = ce._mutationGeneration;
  let epoch = ce._semanticEpoch;
  try {
    let result = iter.next();
    // Bumps INSIDE `next()` are the walk's own and are absorbed; only a bump
    // observed across a yield boundary is the consumer's. Configuration
    // changes (tolerance/precision/angular unit/jit) bump
    // `_mutationGeneration` too, so a mid-walk config change also raises
    // these flags.
    gen = ce._mutationGeneration;
    epoch = ce._semanticEpoch;
    while (!result.done) {
      if (buffer.length < ELEMENT_MEMO_CAP) buffer.push(result.value);
      else overflow = true;
      yield result.value;
      // Resumed: anything that moved while we were suspended was the
      // consumer, not the element body.
      if (ce._mutationGeneration !== gen) suspendedWrite = true;
      if (ce._semanticEpoch !== epoch) suspendedEpochChange = true;
      result = iter.next();
      gen = ce._mutationGeneration;
      epoch = ce._semanticEpoch;
    }
    drained = true;
  } finally {
    // The final boundary: covers the suspended gap between the last yield
    // and this `finally` (abrupt closure), and — conservatively — a bump
    // made by an element evaluation that THREW (a deadline mid-`next()`);
    // declining that prefix loses nothing of value.
    if (ce._mutationGeneration !== gen) suspendedWrite = true;
    if (ce._semanticEpoch !== epoch) suspendedEpochChange = true;
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
      drained && !overflow
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
    if (!complete) iter.return?.();
  }

  // Same purity gate as `commitRecordedWalk`: a PARTIAL prefix of an impure
  // instance would be replaced by a later re-drawing complete walk, so
  // `at()` reads before and after would disagree — partials are pure-only.
  const deps = complete || expr.isPure ? snapshotDeps(expr) : undefined;
  if (deps !== undefined) {
    const ce = expr.engine;
    elementMemoCaches.set(expr, {
      semanticEpoch: ce._semanticEpoch,
      deps,
      complete,
      elements,
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
