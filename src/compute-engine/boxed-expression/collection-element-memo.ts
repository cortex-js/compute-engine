import type {
  Expression,
  BoxedDefinition,
  BoxedValueDefinition,
  IComputeEngine,
  Scope,
} from '../global-types';

import { isDictionary, isFunction, isSymbol } from './type-guards';
import { isValueDef } from './utils';

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
 * Invalidation is two-axis, mirroring the Comprehension memo:
 *
 * - `ce._mutationGeneration` — bumped by every semantic mutation but not by
 *   plain scope push/pop or ephemeral loop-index writes, so unrelated scoped
 *   evaluations between two walks stay warm.
 * - Per-dependency versions — ephemeral index writes bump only the index
 *   definition's `_writeVersion`, so a memoized instance that references an
 *   ENCLOSING binder's index (nested in a `Sum`) still refills per iteration.
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
  /** `ce._mutationGeneration` snapshot taken AFTER the fill, so any bump the
   * walk itself causes (a side-effecting body) is absorbed. */
  mutationGeneration: number;
  deps: ElementMemoDep[];
  /** Engine-configuration stamps: none of these bump `_mutationGeneration`,
   * but each can change what an element evaluates to, so a change must cold
   * the memo (mirrors the map-auto-compile cache's tolerance stamp). */
  tolerance: number;
  precision: number;
  angularUnit: string;
  /** True when `elements` is the whole collection. `each()` serves only
   * complete entries; `at()` serves any covering prefix. Partial entries are
   * written only by `elementMemoFillTo` (the fill-to-n path operators
   * without random access use, e.g. `Comprehension`); the recording stream
   * commits only complete drains. */
  complete: boolean;
  elements: Expression[];
}

/** Keyed on the boxed instance. A `WeakMap` so an unreferenced collection
 * (and its cached elements) is collectable. */
const elementMemoCaches = new WeakMap<Expression, ElementMemoCache>();

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
 * redefinition or signature inference always bumps `ce._mutationGeneration`,
 * so operator-bound symbols are covered by the global axis.
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
    valueDef: BoxedValueDefinition,
    skipNames?: ReadonlySet<string>
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
    // `_mutationGeneration` — such an instance is ineligible.
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
    // Reassigning `q` when it was never declared takes the DECLARE path,
    // which does not bump `_mutationGeneration` (item-38: parameter
    // activation declares per element), so the global axis cannot be
    // relied on — the value must be walked. The `seen` set terminates
    // self- and mutually-recursive definitions.
    const stored = valueDef.value;
    if (stored !== undefined) {
      // The stored value's own binding sites (a helper literal's
      // parameters) are as excluded as the instance's own.
      collectParameterDefs(stored, excluded);
      visit(stored, skipNames);
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
        visitValueDef(e, valueDef, skipNames);
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
        visitValueDef(e, headDef, skipNames);
      // A USER-DEFINED operator head (`f8(x)` after `ce.assign('f8', x ↦ …)`
      // creates an operator definition) needs no dep entry — redefinition and
      // signature inference always bump `_mutationGeneration` — but its
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
        const bodySkip = new Set(skipNames);
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
 * `complete` before serving a whole-collection read — a partial prefix
 * (from `elementMemoFillTo`) covers only `at()`-style reads. */
export function validElementMemo(
  expr: Expression
): { elements: ReadonlyArray<Expression>; complete: boolean } | undefined {
  const entry = elementMemoCaches.get(expr);
  if (!entry) return undefined;
  const ce = expr.engine;
  if (entry.mutationGeneration !== ce._mutationGeneration) return undefined;
  if (
    entry.tolerance !== ce.tolerance ||
    entry.precision !== ce.precision ||
    entry.angularUnit !== ce.angularUnit
  )
    return undefined;
  const depScope = depResolutionScope(expr);
  for (const d of entry.deps) {
    if (d.occurrence.valueDefinition !== d.valueDef) return undefined;
    if (d.valueDef._writeVersion !== d.version) return undefined;
    // Resolution axis: shadowing declarations bump no counter and touch no
    // tracked definition, but change what a walk computes (see
    // `ElementMemoDep.resolved`).
    if (resolveDepBinding(ce, depScope, d.name) !== d.resolved)
      return undefined;
  }
  return entry;
}

/** The engine state a SUSPENDED walk can be corrupted by: a semantic
 * mutation or a configuration change made by the CONSUMER between two
 * pulls. Sampled after every `iter.next()` and compared on resume. */
function externalStamp(ce: IComputeEngine): string {
  return `${ce._mutationGeneration}|${ce.tolerance}|${ce.precision}|${ce.angularUnit}`;
}

/**
 * Buffer a walk of `iter` and commit it as this instance's element memo on a
 * COMPLETE drain. An early-abandoned walk (`Take`, `First`, a thrown
 * deadline) never reaches the commit, so a partial buffer is never cached as
 * complete; a walk that overflows the cap streams through without caching.
 *
 * The dependency snapshot and the generation stamp are both taken AFTER the
 * drain: bumps caused by the walk itself (parameter activations, a
 * side-effecting body) are absorbed, exactly as in the Comprehension memo.
 * Bumps made by the CONSUMER while the generator is suspended are a
 * different matter — a mutation between two pulls splits the buffer into a
 * before/after mix that the post-drain stamp would wrongly certify as
 * uniform, so the stamp is sampled after every `next()` and a change
 * observed across a yield boundary marks the walk dirty (streams through,
 * never commits).
 */
export function* elementMemoRecordingStream(
  expr: Expression,
  iter: Iterator<Expression, undefined>
): Generator<Expression> {
  const ce = expr.engine;
  const buffer: Expression[] = [];
  let overflow = false;
  let dirty = false;
  let drained = false;
  try {
    let result = iter.next();
    let stamp = externalStamp(ce);
    while (!result.done) {
      if (buffer.length < ELEMENT_MEMO_CAP) buffer.push(result.value);
      else overflow = true;
      yield result.value;
      // Resumed: anything that moved while we were suspended was the
      // consumer, not the element body.
      if (externalStamp(ce) !== stamp) dirty = true;
      result = iter.next();
      stamp = externalStamp(ce);
    }
    drained = true;
  } finally {
    // Forward early abandonment (`break`, `Take`, `.return()`) to the
    // wrapped iterator so a future handler with cleanup semantics is closed
    // deterministically rather than left suspended until GC.
    if (!drained) iter.return?.();
  }
  if (overflow || dirty) return;
  const deps = snapshotDeps(expr);
  if (deps === undefined) return;
  elementMemoCaches.set(expr, {
    mutationGeneration: ce._mutationGeneration,
    deps,
    tolerance: ce.tolerance,
    precision: ce.precision,
    angularUnit: ce.angularUnit,
    complete: true,
    elements: buffer,
  });
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
 * the suspended-mutation hazard of the recording stream does not apply; the
 * stamp and dependency snapshot are taken AFTER the fill, absorbing the
 * walk's own bumps. An ineligible instance (see `snapshotDeps`) fills and
 * returns the prefix without committing anything.
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

  const deps = snapshotDeps(expr);
  if (deps !== undefined) {
    const ce = expr.engine;
    elementMemoCaches.set(expr, {
      mutationGeneration: ce._mutationGeneration,
      deps,
      tolerance: ce.tolerance,
      precision: ce.precision,
      angularUnit: ce.angularUnit,
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
